const ZERO = Object.freeze({ re: 0, im: 0 });
const ONE = Object.freeze({ re: 1, im: 0 });
const TWO_PI = 2 * Math.PI;
const DEFAULT_FRACTIONAL_POWER = 0.5;
const DOMAIN_LIGHTNESS_MIN = 0.34;
const DOMAIN_LIGHTNESS_MAX = 0.72;
const DOMAIN_LIGHTNESS_DETAIL_BASE = 0.72;
const DOMAIN_LIGHTNESS_DETAIL_SCALE = 0.28;
import { compileExpression } from '../math/expression/evaluator.js';
import {
    ORBIT_COLORING_MODES,
    normalizeOrbitColoringMode
} from '../constants/rendering.js';

const DYNAMICS_ESCAPE_RADIUS = 1e4;
const DYNAMICS_ESCAPE_RADIUS_SQ = DYNAMICS_ESCAPE_RADIUS * DYNAMICS_ESCAPE_RADIUS;
const DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE = 1e8;
const ORBIT_ATTRACTOR_CONVERGENCE_EPSILON = 1e-7;
const ORBIT_ATTRACTOR_CONVERGENCE_EPSILON_SQ =
    ORBIT_ATTRACTOR_CONVERGENCE_EPSILON * ORBIT_ATTRACTOR_CONVERGENCE_EPSILON;
const NUM_ZETA_TERMS_DIRECT_SUM = 100;
const NUM_ZETA_TERMS_ETA_SERIES = 500;
const NUM_ZETA_HASSE_LEVELS = 32;
const ZETA_REFLECTION_POINT_RE = 1.0;
const DEFAULT_PALETTE_STOPS = Object.freeze([
    Object.freeze([1, 0, 0]),
    Object.freeze([0, 1, 0]),
    Object.freeze([0, 1, 1]),
    Object.freeze([0, 0, 1]),
    Object.freeze([1, 0, 0])
]);

const zetaLogIntegerCache = [0, 0];
const zetaHasseBinomialRowsCache = new Map();
const NO_ACCELERATOR = Object.freeze({ type: 'none' });
let lastDynamicsAcceleratorSnapshot = null;
let lastDynamicsAccelerator = NO_ACCELERATOR;

function finite(value) {
    return Number.isFinite(value);
}

function complex(re = 0, im = 0) {
    return { re, im };
}

function toComplex(value, im = 0) {
    if (value && typeof value === 'object') {
        return complex(Number(value.re ?? value.real ?? 0), Number(value.im ?? value.imag ?? 0));
    }
    return complex(Number(value ?? 0), Number(im ?? 0));
}

function scalarRe(value) {
    return value && typeof value === 'object'
        ? Number(value.re ?? value.real ?? 0)
        : Number(value ?? 0);
}

function scalarIm(value) {
    return value && typeof value === 'object'
        ? Number(value.im ?? value.imag ?? 0)
        : 0;
}

function validComplex(value) {
    return !!value && finite(value.re) && finite(value.im);
}

function complexAdd(a, b) {
    const z = toComplex(a);
    const w = toComplex(b);
    return { re: z.re + w.re, im: z.im + w.im };
}

function complexSub(a, b) {
    const z = toComplex(a);
    const w = toComplex(b);
    return { re: z.re - w.re, im: z.im - w.im };
}

function complexMul(a, b) {
    const z = toComplex(a);
    const w = toComplex(b);
    return {
        re: z.re * w.re - z.im * w.im,
        im: z.re * w.im + z.im * w.re
    };
}

function complexScalarMul(scale, z) {
    const value = toComplex(z);
    return { re: scale * value.re, im: scale * value.im };
}

function complexDivide(a, b) {
    const n = toComplex(a);
    const d = toComplex(b);
    const absRe = Math.abs(d.re);
    const absIm = Math.abs(d.im);
    const scale = Math.max(absRe, absIm);

    if (scale < 1e-15) return { re: NaN, im: NaN };

    if (absRe >= absIm) {
        const ratio = d.im / d.re;
        const divisor = d.re + d.im * ratio;
        return {
            re: (n.re + n.im * ratio) / divisor,
            im: (n.im - n.re * ratio) / divisor
        };
    }

    const ratio = d.re / d.im;
    const divisor = d.im + d.re * ratio;
    return {
        re: (n.re * ratio + n.im) / divisor,
        im: (n.im * ratio - n.re) / divisor
    };
}

function expSafe(x) {
    if (x > 700) return Math.exp(700);
    if (x < -745) return 0;
    return Math.exp(x);
}

function complexExp(z) {
    const value = toComplex(z);
    const magnitude = expSafe(value.re);
    return {
        re: magnitude * Math.cos(value.im),
        im: magnitude * Math.sin(value.im)
    };
}

function complexLn(z) {
    const value = toComplex(z);
    if (value.re === 0 && value.im === 0) return { re: -Infinity, im: 0 };
    return {
        re: Math.log(Math.hypot(value.re, value.im)),
        im: Math.atan2(value.im, value.re)
    };
}

function complexRealBasePow(baseRe, expRe) {
    if (baseRe >= 0) {
        return { re: expSafe(expRe * Math.log(baseRe)), im: 0 };
    }

    const magnitude = expSafe(expRe * Math.log(-baseRe));
    const doubledExponent = expRe * 2;
    if (Number.isSafeInteger(doubledExponent)) {
        switch (((doubledExponent % 4) + 4) % 4) {
            case 0: return { re: magnitude, im: 0 };
            case 1: return { re: 0, im: magnitude };
            case 2: return { re: -magnitude, im: 0 };
            case 3: return { re: 0, im: -magnitude };
        }
    }

    const angle = expRe * Math.PI;
    return {
        re: magnitude * Math.cos(angle),
        im: magnitude * Math.sin(angle)
    };
}

function complexIntegerPow(base, exponent) {
    if (exponent === 0) return { re: 1, im: 0 };
    if (exponent === 1) return { re: base.re, im: base.im };
    if (exponent === -1) return complexDivide(ONE, base);

    const negative = exponent < 0;
    let n = Math.abs(exponent);
    let acc = ONE;
    let current = base;

    while (n > 0) {
        if (n % 2 === 1) {
            acc = complexMul(acc, current);
        }
        n = Math.floor(n / 2);
        if (n > 0) {
            current = complexMul(current, current);
        }
    }

    return negative ? complexDivide(ONE, acc) : acc;
}

function complexPow(base, exponent) {
    const b = toComplex(base);
    const e = toComplex(exponent);
    if (b.re === 0 && b.im === 0) {
        if (e.re > 0 || (e.re === 0 && e.im !== 0)) return { re: 0, im: 0 };
        if (e.re === 0 && e.im === 0) return { re: 1, im: 0 };
    }
    if (e.im === 0 && Number.isSafeInteger(e.re)) {
        return complexIntegerPow(b, e.re);
    }
    if (b.im === 0 && e.im === 0) {
        return complexRealBasePow(b.re, e.re);
    }
    return complexExp(complexMul(e, complexLn(b)));
}

function complexReciprocal(z) {
    return complexDivide(ONE, z);
}

function complexCos(z) {
    const value = toComplex(z);
    return {
        re: Math.cos(value.re) * Math.cosh(value.im),
        im: -Math.sin(value.re) * Math.sinh(value.im)
    };
}

function complexSin(z) {
    const value = toComplex(z);
    return {
        re: Math.sin(value.re) * Math.cosh(value.im),
        im: Math.cos(value.re) * Math.sinh(value.im)
    };
}

function complexTan(z) {
    return complexDivide(complexSin(z), complexCos(z));
}

function complexSec(z) {
    return complexDivide(ONE, complexCos(z));
}

function complexSinh(z) {
    const value = toComplex(z);
    return {
        re: Math.sinh(value.re) * Math.cos(value.im),
        im: Math.cosh(value.re) * Math.sin(value.im)
    };
}

function complexCosh(z) {
    const value = toComplex(z);
    return {
        re: Math.cosh(value.re) * Math.cos(value.im),
        im: Math.sinh(value.re) * Math.sin(value.im)
    };
}

function complexTanh(z) {
    return complexDivide(complexSinh(z), complexCosh(z));
}

function ensureZetaLogIntegerCache(maxN) {
    const target = Math.max(1, Math.floor(maxN));
    for (let n = zetaLogIntegerCache.length; n <= target; n += 1) {
        zetaLogIntegerCache[n] = Math.log(n);
    }
}

function positiveRealPowFromLog(logBase, expRe, expIm) {
    const magnitude = expSafe(expRe * logBase);
    const angle = expIm * logBase;
    return { re: magnitude * Math.cos(angle), im: magnitude * Math.sin(angle) };
}

function complexRiemannZetaDirect(a, b, numTerms) {
    if (a <= 1.0) return { re: NaN, im: NaN };
    ensureZetaLogIntegerCache(numTerms);
    let sum = { re: 0, im: 0 };
    for (let n = 1; n <= numTerms; n += 1) {
        sum = complexAdd(sum, positiveRealPowFromLog(zetaLogIntegerCache[n], -a, -b));
    }
    return sum;
}

function complexRiemannZetaEta(a, b, numTerms) {
    if (a === 1 && b === 0) return { re: Infinity, im: NaN };
    ensureZetaLogIntegerCache(numTerms);
    let sum = { re: 0, im: 0 };
    for (let n = 1; n <= numTerms; n += 1) {
        const term = positiveRealPowFromLog(zetaLogIntegerCache[n], -a, -b);
        sum = complexAdd(sum, complexScalarMul(n % 2 === 0 ? -1 : 1, term));
    }
    const denominator = complexSub(ONE, positiveRealPowFromLog(Math.log(2), 1 - a, -b));
    return complexDivide(sum, denominator);
}

function zetaHasseRows(maxLevel) {
    if (zetaHasseBinomialRowsCache.has(maxLevel)) return zetaHasseBinomialRowsCache.get(maxLevel);
    const rows = Array.from({ length: maxLevel }, (_, n) => {
        const row = new Array(n + 1);
        row[0] = 1;
        for (let k = 1; k <= n; k += 1) row[k] = row[k - 1] * (n - k + 1) / k;
        return row;
    });
    zetaHasseBinomialRowsCache.set(maxLevel, rows);
    return rows;
}

const zetaHasseCollapsedCache = new Map();

function zetaHasseCollapsedTerms(maxLevel) {
    let cached = zetaHasseCollapsedCache.get(maxLevel);
    if (cached) return cached;

    const rows = zetaHasseRows(maxLevel);
    const coeffs = new Float64Array(maxLevel);
    const logs = new Float64Array(maxLevel);

    for (let k = 0; k < maxLevel; k += 1) {
        logs[k] = Math.log(k + 1);
        let coeff = 0;
        const sign = k & 1 ? -1 : 1;
        for (let n = k; n < maxLevel; n += 1) {
            coeff += sign * rows[n][k] * Math.pow(2, -n - 1);
        }
        coeffs[k] = coeff;
    }

    cached = { coeffs, logs, length: maxLevel };
    zetaHasseCollapsedCache.set(maxLevel, cached);
    return cached;
}

function complexRiemannZetaHasse(a, b, numLevels) {
    if (a === 1 && b === 0) return { re: Infinity, im: NaN };
    const denominator = complexSub(ONE, positiveRealPowFromLog(Math.log(2), 1 - a, -b));
    if (Math.abs(denominator.re) < 1e-14 && Math.abs(denominator.im) < 1e-14) {
        return complexRiemannZetaEta(a, b, NUM_ZETA_TERMS_ETA_SERIES);
    }

    const rows = zetaHasseRows(numLevels);
    ensureZetaLogIntegerCache(numLevels + 1);
    let outerSum = { re: 0, im: 0 };

    for (let n = 0; n < numLevels; n += 1) {
        let inner = { re: 0, im: 0 };
        for (let k = 0; k <= n; k += 1) {
            const coeff = (k % 2 === 0 ? 1 : -1) * rows[n][k];
            const term = positiveRealPowFromLog(zetaLogIntegerCache[k + 1], -a, -b);
            inner = complexAdd(inner, complexScalarMul(coeff, term));
        }
        outerSum = complexAdd(outerSum, complexScalarMul(Math.pow(2, -n - 1), inner));
    }

    return complexDivide(outerSum, denominator);
}

function complexRiemannZeta(z, continuationEnabled) {
    const value = toComplex(z);
    if (!continuationEnabled) {
        return value.re > ZETA_REFLECTION_POINT_RE
            ? complexRiemannZetaDirect(value.re, value.im, NUM_ZETA_TERMS_DIRECT_SUM)
            : { re: NaN, im: NaN };
    }
    if (value.re === 1 && value.im === 0) return { re: Infinity, im: NaN };
    if (value.re === 0 && value.im === 0) return { re: -0.5, im: 0 };
    if (value.im === 0 && value.re < 0 && value.re % 2 === 0) return { re: 0, im: 0 };
    return complexRiemannZetaHasse(value.re, value.im, NUM_ZETA_HASSE_LEVELS);
}

function complexMobius(z, snapshot) {
    const value = toComplex(z);
    const numerator = complexAdd(complexMul(snapshot.mobiusA, value), snapshot.mobiusB);
    const denominator = complexAdd(complexMul(snapshot.mobiusC, value), snapshot.mobiusD);
    return complexDivide(numerator, denominator);
}

function complexPolynomial(z, snapshot) {
    const value = toComplex(z);
    const degree = Math.max(0, Math.floor(Number(snapshot.polynomialN) || 0));
    let acc = { re: 0, im: 0 };
    for (let k = degree; k >= 0; k -= 1) {
        acc = complexAdd(complexMul(acc, value), snapshot.polynomialCoeffs?.[k] ?? ZERO);
    }
    return acc;
}

function complexPoincare(z) {
    const value = toComplex(z);
    if (value.im <= 1e-9) return { re: NaN, im: NaN };
    const sqrtIm = Math.sqrt(value.im);
    return { re: value.re / sqrtIm, im: sqrtIm };
}

function evaluateBuiltin(functionKey, z, snapshot, evalContext) {
    switch (functionKey) {
        case 'cos': return complexCos(z);
        case 'sin': return complexSin(z);
        case 'tan': return complexTan(z);
        case 'sec': return complexSec(z);
        case 'exp': return complexExp(z);
        case 'ln': return complexLn(z);
        case 'reciprocal': return complexReciprocal(z);
        case 'sinh': return complexSinh(z);
        case 'cosh': return complexCosh(z);
        case 'tanh': return complexTanh(z);
        case 'power': return complexPow(z, { re: snapshot.fractionalPowerN ?? DEFAULT_FRACTIONAL_POWER, im: 0 });
        case 'mobius': return complexMobius(z, snapshot);
        case 'polynomial': return complexPolynomial(z, snapshot);
        case 'poincare': return complexPoincare(z);
        case 'zeta': return complexRiemannZeta(z, !!snapshot.zetaContinuationEnabled);
        case 'algebraic_chaining': return evaluateAlgebraicChaining(z, snapshot, evalContext);
        case 'c': return toComplex(evalContext?.c ?? z);
        default: return null;
    }
}

function algebraicParameter(context, fallback) {
    return toComplex(context?.c ?? fallback);
}

function evaluateFunctionBlock(block, z, snapshot, context) {
    if (!block || block.func === 'none') return toComplex(z);

    let arg = toComplex(z);
    if (block.chainedFunc && block.chainedFunc !== 'none') {
        arg = block.chainedFunc === 'c'
            ? algebraicParameter(context, arg)
            : evaluateBuiltin(block.chainedFunc, arg, snapshot, context);
        if (!validComplex(arg)) return { re: NaN, im: NaN };
    }

    let value = block.func === 'c'
        ? algebraicParameter(context, arg)
        : evaluateBuiltin(block.func, arg, snapshot, context);
    if (!validComplex(value)) return { re: NaN, im: NaN };

    if (block.power !== undefined && block.power !== 1) value = complexPow(value, { re: Number(block.power), im: 0 });
    if (block.reciprocal) value = complexReciprocal(value);
    if (block.log) value = complexLn(value);
    if (block.exp) value = complexExp(value);

    return value;
}

function evaluateAlgebraicTerm(term, z, snapshot, context) {
    if (!term) return { re: NaN, im: NaN };
    let value = toComplex(term.coeff ?? ONE);
    for (const factor of term.factors ?? []) {
        if (!factor || factor.func === 'none') break;
        value = complexMul(value, evaluateFunctionBlock(factor, z, snapshot, context));
    }
    return value;
}

let algebraicZExprCompiled = null;
let algebraicZExprCacheKey = null;

function evaluateAlgebraicChaining(z, snapshot, context = null) {
    const terms = snapshot.algebraicChainingTerms;
    if (!snapshot.algebraicChainingEnabled || !Array.isArray(terms) || terms.length === 0) {
        return { re: 0, im: 0 };
    }

    let point = toComplex(z);

    if (snapshot.algebraicChainingZExpr && snapshot.algebraicChainingZExpr !== 'z') {
        if (algebraicZExprCacheKey !== snapshot.algebraicChainingZExpr) {
            try {
                algebraicZExprCompiled = compileExpression(snapshot.algebraicChainingZExpr, { allowedVariables: ['z'] });
            } catch {
                algebraicZExprCompiled = null;
            }
            algebraicZExprCacheKey = snapshot.algebraicChainingZExpr;
        }
        if (!algebraicZExprCompiled) return { re: NaN, im: NaN };
        try {
            const result = algebraicZExprCompiled({ z: point });
            if (typeof result === 'number') {
                point = { re: result, im: 0 };
            } else if (result && typeof result === 'object' && 're' in result) {
                point = { re: result.re, im: result.im || 0 };
            } else {
                return { re: NaN, im: NaN };
            }
            if (!validComplex(point)) return { re: NaN, im: NaN };
        } catch {
            return { re: NaN, im: NaN };
        }
    }

    const evalContext = context || { c: point };
    let sum = { re: 0, im: 0 };
    for (const term of terms) {
        const value = evaluateAlgebraicTerm(term, point, snapshot, evalContext);
        if (!validComplex(value)) return { re: NaN, im: NaN };
        sum = complexAdd(sum, value);
    }
    return sum;
}

function plainAlgebraicFactor(factor) {
    return !!factor &&
        (!factor.chainedFunc || factor.chainedFunc === 'none') &&
        !factor.reciprocal &&
        !factor.log &&
        !factor.exp &&
        Number(factor.power ?? 1) === 1;
}

function scaledComplex(value, scale) {
    return complexMul(toComplex(value), toComplex(scale));
}

function addIntoCoeff(coeffs, index, value) {
    const current = coeffs[index] || ZERO;
    coeffs[index] = complexAdd(current, value);
}

function nearlyZero(value) {
    return Math.abs(value) < 1e-12;
}

function isIdentityPolynomial(snapshot) {
    const degree = Math.max(0, Math.floor(Number(snapshot.polynomialN) || 0));
    if (degree !== 1) return false;
    const c0 = toComplex(snapshot.polynomialCoeffs?.[0] ?? ZERO);
    const c1 = toComplex(snapshot.polynomialCoeffs?.[1] ?? ZERO);
    return nearlyZero(c0.re) && nearlyZero(c0.im) &&
        nearlyZero(c1.re - 1) && nearlyZero(c1.im);
}

function createPolynomialParameterAccelerator(snapshot) {
    if (
        snapshot.functionKey !== 'algebraic_chaining' ||
        !snapshot.algebraicChainingEnabled ||
        !Array.isArray(snapshot.algebraicChainingTerms) ||
        (snapshot.algebraicChainingZExpr && snapshot.algebraicChainingZExpr !== 'z')
    ) {
        return null;
    }

    const degree = Math.max(0, Math.floor(Number(snapshot.polynomialN) || 0));
    const coeffs = Array.from({ length: degree + 1 }, () => ({ re: 0, im: 0 }));
    let cCoeff = { re: 0, im: 0 };
    let hasPolynomial = false;
    let hasParameter = false;

    for (const term of snapshot.algebraicChainingTerms) {
        const termCoeff = toComplex(term?.coeff ?? ONE);
        const factors = Array.isArray(term?.factors)
            ? term.factors.filter(factor => factor && factor.func && factor.func !== 'none')
            : [];

        if (!factors.length) {
            addIntoCoeff(coeffs, 0, termCoeff);
            continue;
        }

        if (factors.length !== 1 || !plainAlgebraicFactor(factors[0])) return null;

        const factor = factors[0];
        if (factor.func === 'polynomial') {
            for (let k = 0; k <= degree; k += 1) {
                addIntoCoeff(coeffs, k, scaledComplex(snapshot.polynomialCoeffs?.[k] ?? ZERO, termCoeff));
            }
            hasPolynomial = true;
            continue;
        }

        if (factor.func === 'c') {
            cCoeff = complexAdd(cCoeff, termCoeff);
            hasParameter = true;
            continue;
        }

        return null;
    }

    return hasPolynomial
        ? {
            type: 'polynomial-parameter',
            degree,
            coeffs,
            coeffsRe: coeffs.map(coeff => coeff.re),
            coeffsIm: coeffs.map(coeff => coeff.im),
            cCoeff,
            cCoeffRe: cCoeff.re,
            cCoeffIm: cCoeff.im,
            hasParameter
        }
        : null;
}

function laurentFactorExponent(factor, snapshot) {
    if (!factor || factor.func !== 'polynomial' || !isIdentityPolynomial(snapshot)) return null;
    if (factor.chainedFunc && factor.chainedFunc !== 'none') return null;
    if (factor.log || factor.exp) return null;

    const power = Number(factor.power ?? 1);
    if (!Number.isInteger(power) || power < 0) return null;
    return factor.reciprocal ? -power : power;
}

function createLaurentParameterAccelerator(snapshot) {
    if (
        snapshot.functionKey !== 'algebraic_chaining' ||
        !snapshot.algebraicChainingEnabled ||
        !Array.isArray(snapshot.algebraicChainingTerms) ||
        (snapshot.algebraicChainingZExpr && snapshot.algebraicChainingZExpr !== 'z')
    ) {
        return null;
    }

    const terms = [];
    let cCoeff = { re: 0, im: 0 };
    let hasParameter = false;

    for (const term of snapshot.algebraicChainingTerms) {
        const termCoeff = toComplex(term?.coeff ?? ONE);
        const factors = Array.isArray(term?.factors)
            ? term.factors.filter(factor => factor && factor.func && factor.func !== 'none')
            : [];

        if (!factors.length) {
            terms.push({ exponent: 0, coeffRe: termCoeff.re, coeffIm: termCoeff.im });
            continue;
        }

        if (factors.length !== 1) return null;

        const factor = factors[0];
        if (factor.func === 'c' && plainAlgebraicFactor(factor)) {
            cCoeff = complexAdd(cCoeff, termCoeff);
            hasParameter = true;
            continue;
        }

        const exponent = laurentFactorExponent(factor, snapshot);
        if (exponent === null) return null;
        terms.push({ exponent, coeffRe: termCoeff.re, coeffIm: termCoeff.im });
    }

    return terms.length
        ? {
            type: 'laurent-parameter',
            terms,
            exponents: Int16Array.from(terms, term => term.exponent),
            coeffsRe: Float64Array.from(terms, term => term.coeffRe),
            coeffsIm: Float64Array.from(terms, term => term.coeffIm),
            monomialExponent: terms.length === 1 ? terms[0].exponent : 0,
            monomialCoeffRe: terms.length === 1 ? terms[0].coeffRe : 0,
            monomialCoeffIm: terms.length === 1 ? terms[0].coeffIm : 0,
            isPositiveMonomial: terms.length === 1 && terms[0].exponent >= 0 && terms[0].exponent <= 4,
            cCoeff,
            cCoeffRe: cCoeff.re,
            cCoeffIm: cCoeff.im,
            hasParameter
        }
        : null;
}

function evaluateLaurentInto(accelerator, zr, zi, cr, ci, out) {
    const exponents = accelerator.exponents;
    const coeffsRe = accelerator.coeffsRe;
    const coeffsIm = accelerator.coeffsIm;
    let sumRe = 0;
    let sumIm = 0;

    for (let i = 0; i < exponents.length; i += 1) {
        const exponent = exponents[i];
        const absExp = exponent < 0 ? -exponent : exponent;
        let powRe;
        let powIm;

        switch (absExp) {
            case 0:
                powRe = 1;
                powIm = 0;
                break;
            case 1:
                powRe = zr;
                powIm = zi;
                break;
            case 2:
                powRe = zr * zr - zi * zi;
                powIm = 2 * zr * zi;
                break;
            case 3: {
                const zr2 = zr * zr;
                const zi2 = zi * zi;
                powRe = zr * (zr2 - 3 * zi2);
                powIm = zi * (3 * zr2 - zi2);
                break;
            }
            case 4: {
                const zr2 = zr * zr;
                const zi2 = zi * zi;
                const zri = zr * zi;
                powRe = zr2 * zr2 - 6 * zr2 * zi2 + zi2 * zi2;
                powIm = 4 * zri * (zr2 - zi2);
                break;
            }
            default: {
                let n = absExp;
                let baseRe = zr;
                let baseIm = zi;
                powRe = 1;
                powIm = 0;
                while (n > 0) {
                    if (n & 1) {
                        const nextRe = powRe * baseRe - powIm * baseIm;
                        powIm = powRe * baseIm + powIm * baseRe;
                        powRe = nextRe;
                    }
                    n >>= 1;
                    if (n > 0) {
                        const nextBaseRe = baseRe * baseRe - baseIm * baseIm;
                        baseIm = 2 * baseRe * baseIm;
                        baseRe = nextBaseRe;
                    }
                }
                break;
            }
        }

        if (exponent < 0) {
            const denom = powRe * powRe + powIm * powIm;
            if (denom < 1e-300) {
                out[0] = NaN;
                out[1] = NaN;
                return out;
            }
            powIm = -powIm / denom;
            powRe /= denom;
        }

        const coeffRe = coeffsRe[i];
        const coeffIm = coeffsIm[i];
        sumRe += coeffRe * powRe - coeffIm * powIm;
        sumIm += coeffRe * powIm + coeffIm * powRe;
    }

    if (accelerator.hasParameter) {
        sumRe += accelerator.cCoeffRe * cr - accelerator.cCoeffIm * ci;
        sumIm += accelerator.cCoeffRe * ci + accelerator.cCoeffIm * cr;
    }

    out[0] = sumRe;
    out[1] = sumIm;
    return out;
}

function evaluateLaurentParameterAccelerator(accelerator, z, c) {
    const value = toComplex(z);
    const parameter = toComplex(c);

    if (accelerator.isPositiveMonomial) {
        const zr = value.re;
        const zi = value.im;
        let powRe;
        let powIm;
        switch (accelerator.monomialExponent) {
            case 0:
                powRe = 1;
                powIm = 0;
                break;
            case 1:
                powRe = zr;
                powIm = zi;
                break;
            case 2:
                powRe = zr * zr - zi * zi;
                powIm = 2 * zr * zi;
                break;
            case 3: {
                const zr2 = zr * zr;
                const zi2 = zi * zi;
                powRe = zr * (zr2 - 3 * zi2);
                powIm = zi * (3 * zr2 - zi2);
                break;
            }
            case 4: {
                const zr2 = zr * zr;
                const zi2 = zi * zi;
                const zri = zr * zi;
                powRe = zr2 * zr2 - 6 * zr2 * zi2 + zi2 * zi2;
                powIm = 4 * zri * (zr2 - zi2);
                break;
            }
            default:
                powRe = NaN;
                powIm = NaN;
        }

        return {
            re: accelerator.monomialCoeffRe * powRe - accelerator.monomialCoeffIm * powIm +
                accelerator.cCoeffRe * parameter.re - accelerator.cCoeffIm * parameter.im,
            im: accelerator.monomialCoeffRe * powIm + accelerator.monomialCoeffIm * powRe +
                accelerator.cCoeffRe * parameter.im + accelerator.cCoeffIm * parameter.re
        };
    }

    const out = evaluateLaurentInto(accelerator, value.re, value.im, parameter.re, parameter.im, [0, 0]);
    return { re: out[0], im: out[1] };
}



const VMF_IDENTITY = 0;
const VMF_C = 1;
const VMF_COS = 2;
const VMF_SIN = 3;
const VMF_TAN = 4;
const VMF_SEC = 5;
const VMF_EXP = 6;
const VMF_LN = 7;
const VMF_RECIPROCAL = 8;
const VMF_SINH = 9;
const VMF_COSH = 10;
const VMF_TANH = 11;
const VMF_POWER = 12;
const VMF_MOBIUS = 13;
const VMF_POLYNOMIAL = 14;
const VMF_POINCARE = 15;
const VMF_ZETA = 16;
const VMF_APPLY_POWER = 32;

const EXPR_PUSH_Z = 1;
const EXPR_PUSH_C = 2;
const EXPR_PUSH_CONST = 3;
const EXPR_NEG = 4;
const EXPR_ADD = 5;
const EXPR_SUB = 6;
const EXPR_MUL = 7;
const EXPR_DIV = 8;
const EXPR_POW = 9;
const EXPR_FUNC = 10;

function vmFunctionCode(functionKey) {
    switch (functionKey) {
        case undefined:
        case null:
        case 'none': return VMF_IDENTITY;
        case 'c': return VMF_C;
        case 'cos': return VMF_COS;
        case 'sin': return VMF_SIN;
        case 'tan': return VMF_TAN;
        case 'sec': return VMF_SEC;
        case 'exp': return VMF_EXP;
        case 'ln':
        case 'log': return VMF_LN;
        case 'reciprocal': return VMF_RECIPROCAL;
        case 'sinh': return VMF_SINH;
        case 'cosh': return VMF_COSH;
        case 'tanh': return VMF_TANH;
        case 'power': return VMF_POWER;
        case 'mobius': return VMF_MOBIUS;
        case 'polynomial': return VMF_POLYNOMIAL;
        case 'poincare': return VMF_POINCARE;
        case 'zeta': return VMF_ZETA;
        default: return -1;
    }
}

function appendVmFunction(ops, args, functionKey) {
    const code = vmFunctionCode(functionKey);
    if (code < 0) return false;
    if (code !== VMF_IDENTITY) {
        ops.push(code);
        args.push(0);
    }
    return true;
}

function compilePrimitiveAlgebraicBlock(factor, ops, args) {
    if (!factor || factor.func === 'none') return true;

    if (Array.isArray(factor.chain)) {
        for (let i = 0; i < factor.chain.length; i += 1) {
            const step = factor.chain[i];
            if (!appendVmFunction(ops, args, typeof step === 'string' ? step : step?.func)) return false;
        }
    } else if (Array.isArray(factor.pipeline)) {
        for (let i = 0; i < factor.pipeline.length; i += 1) {
            const step = factor.pipeline[i];
            if (!appendVmFunction(ops, args, typeof step === 'string' ? step : step?.func)) return false;
        }
    } else {
        if (factor.chainedFunc && factor.chainedFunc !== 'none') {
            if (!appendVmFunction(ops, args, factor.chainedFunc)) return false;
        }
        if (factor.func && factor.func !== 'none') {
            if (!appendVmFunction(ops, args, factor.func)) return false;
        }
    }

    if (factor.power !== undefined && Number(factor.power) !== 1) {
        ops.push(VMF_APPLY_POWER);
        args.push(Number(factor.power));
    }
    if (factor.reciprocal) {
        ops.push(VMF_RECIPROCAL);
        args.push(0);
    }
    if (factor.log) {
        ops.push(VMF_LN);
        args.push(0);
    }
    if (factor.exp) {
        ops.push(VMF_EXP);
        args.push(0);
    }
    return true;
}

function tokenizePrimitiveExpression(expr) {
    const tokens = [];
    const text = String(expr || '').trim();
    let i = 0;
    while (i < text.length) {
        const ch = text.charCodeAt(i);
        if (ch <= 32) { i += 1; continue; }
        const c = text[i];
        if ((ch >= 48 && ch <= 57) || c === '.') {
            const start = i;
            i += 1;
            while (i < text.length) {
                const code = text.charCodeAt(i);
                if ((code >= 48 && code <= 57) || text[i] === '.') { i += 1; continue; }
                if ((text[i] === 'e' || text[i] === 'E') && i + 1 < text.length) {
                    let j = i + 1;
                    if (text[j] === '+' || text[j] === '-') j += 1;
                    if (j < text.length && text.charCodeAt(j) >= 48 && text.charCodeAt(j) <= 57) {
                        i = j + 1;
                        while (i < text.length && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) i += 1;
                        continue;
                    }
                }
                break;
            }
            const value = Number(text.slice(start, i));
            if (!Number.isFinite(value)) return null;
            tokens.push({ type: 'number', value });
            continue;
        }
        if ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || c === '_') {
            const start = i;
            i += 1;
            while (i < text.length) {
                const code = text.charCodeAt(i);
                if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
                    (code >= 48 && code <= 57) || text[i] === '_') {
                    i += 1;
                } else {
                    break;
                }
            }
            tokens.push({ type: 'ident', value: text.slice(start, i).toLowerCase() });
            continue;
        }
        if (c === '+' || c === '-' || c === '*' || c === '/' || c === '^' || c === '(' || c === ')' || c === ',') {
            tokens.push({ type: c, value: c });
            i += 1;
            continue;
        }
        return null;
    }
    return tokens;
}

function expressionFunctionCode(name) {
    return vmFunctionCode(name === 'sqrt' ? 'power' : name);
}

function compilePrimitiveExpression(expr) {
    if (!expr || expr === 'z') return null;
    if (expr && typeof expr === 'object') return compilePrimitiveExpressionAst(expr);

    const tokens = tokenizePrimitiveExpression(expr);
    if (!tokens || tokens.length === 0) return null;

    const output = [];
    const ops = [];
    const constants = [];
    let prevValue = false;
    const precedence = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3, 'neg': 4 };
    const rightAssoc = { '^': true, 'neg': true };

    function pushOperator(op) {
        while (ops.length) {
            const top = ops[ops.length - 1];
            if (top === '(' || top.type === 'func') break;
            const tp = precedence[top];
            const opPrec = precedence[op];
            if (tp > opPrec || (tp === opPrec && !rightAssoc[op])) output.push({ type: 'op', value: ops.pop() });
            else break;
        }
        ops.push(op);
    }

    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (token.type === 'number') {
            output.push({ type: 'const', value: token.value, im: 0 });
            prevValue = true;
            continue;
        }
        if (token.type === 'ident') {
            const name = token.value;
            const next = tokens[i + 1];
            if (next && next.type === '(') {
                ops.push({ type: 'func', value: name });
                prevValue = false;
                continue;
            }
            if (name === 'z' || name === 'c') output.push({ type: name });
            else if (name === 'i') output.push({ type: 'const', value: 0, im: 1 });
            else if (name === 'pi') output.push({ type: 'const', value: Math.PI, im: 0 });
            else if (name === 'e') output.push({ type: 'const', value: Math.E, im: 0 });
            else return null;
            prevValue = true;
            continue;
        }
        if (token.type === '(') {
            ops.push('(');
            prevValue = false;
            continue;
        }
        if (token.type === ')') {
            while (ops.length && ops[ops.length - 1] !== '(') output.push({ type: 'op', value: ops.pop() });
            if (!ops.length) return null;
            ops.pop();
            if (ops.length && ops[ops.length - 1].type === 'func') output.push(ops.pop());
            prevValue = true;
            continue;
        }
        if (token.type === ',') {
            while (ops.length && ops[ops.length - 1] !== '(') output.push({ type: 'op', value: ops.pop() });
            if (!ops.length) return null;
            prevValue = false;
            continue;
        }
        if (token.type === '+' || token.type === '-' || token.type === '*' || token.type === '/' || token.type === '^') {
            const op = token.type === '-' && !prevValue ? 'neg' : token.type;
            if (token.type === '+' && !prevValue) continue;
            pushOperator(op);
            prevValue = false;
            continue;
        }
        return null;
    }
    while (ops.length) {
        const op = ops.pop();
        if (op === '(') return null;
        output.push(op.type === 'func' ? op : { type: 'op', value: op });
    }

    const opcodes = [];
    const opcodeArgs = [];
    for (let i = 0; i < output.length; i += 1) {
        const item = output[i];
        switch (item.type) {
            case 'z': opcodes.push(EXPR_PUSH_Z); opcodeArgs.push(0); break;
            case 'c': opcodes.push(EXPR_PUSH_C); opcodeArgs.push(0); break;
            case 'const':
                opcodes.push(EXPR_PUSH_CONST);
                opcodeArgs.push(constants.length);
                constants.push(item.value, item.im || 0);
                break;
            case 'op':
                switch (item.value) {
                    case 'neg': opcodes.push(EXPR_NEG); break;
                    case '+': opcodes.push(EXPR_ADD); break;
                    case '-': opcodes.push(EXPR_SUB); break;
                    case '*': opcodes.push(EXPR_MUL); break;
                    case '/': opcodes.push(EXPR_DIV); break;
                    case '^': opcodes.push(EXPR_POW); break;
                    default: return null;
                }
                opcodeArgs.push(0);
                break;
            case 'func': {
                let code;
                if (item.value === 'sqrt') {
                    code = VMF_APPLY_POWER;
                    opcodes.push(EXPR_FUNC);
                    opcodeArgs.push(code);
                    constants.push(0.5, 0);
                } else {
                    code = expressionFunctionCode(item.value);
                    if (code < 0 || code === VMF_IDENTITY || code === VMF_C || code === VMF_POLYNOMIAL ||
                        code === VMF_MOBIUS || code === VMF_POINCARE || code === VMF_ZETA) return null;
                    opcodes.push(EXPR_FUNC);
                    opcodeArgs.push(code);
                }
                break;
            }
            default: return null;
        }
    }

    const stackCapacity = Math.max(4, output.length + 1);
    return {
        opcodes: Int16Array.from(opcodes),
        args: Float64Array.from(opcodeArgs),
        constants: Float64Array.from(constants),
        stackRe: new Float64Array(stackCapacity),
        stackIm: new Float64Array(stackCapacity),
        scratch: new Float64Array(2)
    };
}

function compilePrimitiveExpressionAst(node) {
    const output = [];
    function walk(n) {
        if (n === null || n === undefined) return false;
        if (typeof n === 'number') { output.push({ type: 'const', value: n, im: 0 }); return true; }
        if (typeof n === 'string') {
            if (n === 'z' || n === 'c') { output.push({ type: n }); return true; }
            return false;
        }
        if (typeof n !== 'object') return false;
        const kind = n.type || n.kind;
        if (kind === 'number' || kind === 'literal' || 'value' in n && typeof n.value === 'number') {
            output.push({ type: 'const', value: Number(n.value), im: Number(n.im ?? n.imag ?? 0) });
            return true;
        }
        if (kind === 'variable' || kind === 'identifier') {
            const name = String(n.name || n.value || '').toLowerCase();
            if (name !== 'z' && name !== 'c') return false;
            output.push({ type: name });
            return true;
        }
        const op = n.op || n.operator;
        if (op && (n.left !== undefined || n.right !== undefined)) {
            if (op === 'neg' || op === 'unary-') {
                if (!walk(n.argument ?? n.right)) return false;
                output.push({ type: 'op', value: 'neg' });
                return true;
            }
            if (!walk(n.left) || !walk(n.right)) return false;
            output.push({ type: 'op', value: op });
            return true;
        }
        const fn = n.func || n.name || (kind === 'call' ? n.callee : null);
        if (fn) {
            const args = n.args || n.arguments || (n.argument !== undefined ? [n.argument] : []);
            if (!args.length || !walk(args[0])) return false;
            output.push({ type: 'func', value: String(fn).toLowerCase() });
            return true;
        }
        return false;
    }
    if (!walk(node)) return null;
    return compilePrimitiveExpressionFromPostfix(output);
}

function compilePrimitiveExpressionFromPostfix(output) {
    const opcodes = [];
    const opcodeArgs = [];
    const constants = [];
    for (let i = 0; i < output.length; i += 1) {
        const item = output[i];
        if (item.type === 'z') { opcodes.push(EXPR_PUSH_Z); opcodeArgs.push(0); continue; }
        if (item.type === 'c') { opcodes.push(EXPR_PUSH_C); opcodeArgs.push(0); continue; }
        if (item.type === 'const') {
            opcodes.push(EXPR_PUSH_CONST); opcodeArgs.push(constants.length); constants.push(Number(item.value), Number(item.im || 0)); continue;
        }
        if (item.type === 'op') {
            const map = { 'neg': EXPR_NEG, '+': EXPR_ADD, '-': EXPR_SUB, '*': EXPR_MUL, '/': EXPR_DIV, '^': EXPR_POW };
            const code = map[item.value];
            if (!code) return null;
            opcodes.push(code); opcodeArgs.push(0); continue;
        }
        if (item.type === 'func') {
            const code = item.value === 'sqrt' ? VMF_APPLY_POWER : expressionFunctionCode(item.value);
            if (code < 0 || code === VMF_IDENTITY || code === VMF_C || code === VMF_POLYNOMIAL ||
                code === VMF_MOBIUS || code === VMF_POINCARE || code === VMF_ZETA) return null;
            opcodes.push(EXPR_FUNC); opcodeArgs.push(code); continue;
        }
        return null;
    }
    const stackCapacity = Math.max(4, output.length + 1);
    return {
        opcodes: Int16Array.from(opcodes),
        args: Float64Array.from(opcodeArgs),
        constants: Float64Array.from(constants),
        stackRe: new Float64Array(stackCapacity),
        stackIm: new Float64Array(stackCapacity),
        scratch: new Float64Array(2)
    };
}

function powComplexComponents(baseRe, baseIm, expRe, expIm, out) {
    if (baseRe === 0 && baseIm === 0) {
        if (expRe > 0 || (expRe === 0 && expIm !== 0)) {
            out[0] = 0;
            out[1] = 0;
            return out;
        }
        if (expRe === 0 && expIm === 0) {
            out[0] = 1;
            out[1] = 0;
            return out;
        }
    }
    const logR = Math.log(Math.hypot(baseRe, baseIm));
    const theta = Math.atan2(baseIm, baseRe);
    const real = expRe * logR - expIm * theta;
    const angle = expRe * theta + expIm * logR;
    const magnitude = expSafe(real);
    out[0] = magnitude * Math.cos(angle);
    out[1] = magnitude * Math.sin(angle);
    return out;
}

function evaluatePrimitiveExpressionInto(expr, zr, zi, cr, ci, out) {
    const stackRe = expr.stackRe;
    const stackIm = expr.stackIm;
    const constants = expr.constants;
    const opcodes = expr.opcodes;
    const args = expr.args;
    let sp = 0;
    for (let i = 0; i < opcodes.length; i += 1) {
        switch (opcodes[i]) {
            case EXPR_PUSH_Z:
                stackRe[sp] = zr;
                stackIm[sp] = zi;
                sp += 1;
                break;
            case EXPR_PUSH_C:
                stackRe[sp] = cr;
                stackIm[sp] = ci;
                sp += 1;
                break;
            case EXPR_PUSH_CONST: {
                const k = args[i] | 0;
                stackRe[sp] = constants[k];
                stackIm[sp] = constants[k + 1];
                sp += 1;
                break;
            }
            case EXPR_NEG:
                stackRe[sp - 1] = -stackRe[sp - 1];
                stackIm[sp - 1] = -stackIm[sp - 1];
                break;
            case EXPR_ADD:
                sp -= 1;
                stackRe[sp - 1] += stackRe[sp];
                stackIm[sp - 1] += stackIm[sp];
                break;
            case EXPR_SUB:
                sp -= 1;
                stackRe[sp - 1] -= stackRe[sp];
                stackIm[sp - 1] -= stackIm[sp];
                break;
            case EXPR_MUL: {
                sp -= 1;
                const ar = stackRe[sp - 1];
                const ai = stackIm[sp - 1];
                const br = stackRe[sp];
                const bi = stackIm[sp];
                stackRe[sp - 1] = ar * br - ai * bi;
                stackIm[sp - 1] = ar * bi + ai * br;
                break;
            }
            case EXPR_DIV:
                sp -= 1;
                divideComponents(stackRe[sp - 1], stackIm[sp - 1], stackRe[sp], stackIm[sp], expr.scratch);
                stackRe[sp - 1] = expr.scratch[0];
                stackIm[sp - 1] = expr.scratch[1];
                break;
            case EXPR_POW:
                sp -= 1;
                powComplexComponents(stackRe[sp - 1], stackIm[sp - 1], stackRe[sp], stackIm[sp], expr.scratch);
                stackRe[sp - 1] = expr.scratch[0];
                stackIm[sp - 1] = expr.scratch[1];
                break;
            case EXPR_FUNC:
                if ((args[i] | 0) === VMF_APPLY_POWER) {
                    powRealComponents(stackRe[sp - 1], stackIm[sp - 1], 0.5, expr.scratch);
                } else {
                    evaluatePrimitiveVmFunctionInto(null, args[i] | 0, stackRe[sp - 1], stackIm[sp - 1], cr, ci, expr.scratch);
                }
                stackRe[sp - 1] = expr.scratch[0];
                stackIm[sp - 1] = expr.scratch[1];
                break;
            default:
                out[0] = NaN;
                out[1] = NaN;
                return out;
        }
    }
    out[0] = sp === 1 ? stackRe[0] : NaN;
    out[1] = sp === 1 ? stackIm[0] : NaN;
    return out;
}

function zetaComponents(re, im, continuationEnabled, out) {
    if (!continuationEnabled) {
        if (re <= ZETA_REFLECTION_POINT_RE) {
            out[0] = NaN;
            out[1] = NaN;
            return out;
        }
        ensureZetaLogIntegerCache(NUM_ZETA_TERMS_DIRECT_SUM);
        let sumRe = 0;
        let sumIm = 0;
        for (let n = 1; n <= NUM_ZETA_TERMS_DIRECT_SUM; n += 1) {
            const logN = zetaLogIntegerCache[n];
            const magnitude = expSafe(-re * logN);
            const angle = -im * logN;
            sumRe += magnitude * Math.cos(angle);
            sumIm += magnitude * Math.sin(angle);
        }
        out[0] = sumRe;
        out[1] = sumIm;
        return out;
    }

    if (re === 1 && im === 0) {
        out[0] = Infinity;
        out[1] = NaN;
        return out;
    }
    if (re === 0 && im === 0) {
        out[0] = -0.5;
        out[1] = 0;
        return out;
    }
    if (im === 0 && re < 0 && re % 2 === 0) {
        out[0] = 0;
        out[1] = 0;
        return out;
    }

    const log2 = Math.log(2);
    const denMagnitude = expSafe((1 - re) * log2);
    const denAngle = -im * log2;
    const denRe = 1 - denMagnitude * Math.cos(denAngle);
    const denIm = -denMagnitude * Math.sin(denAngle);
    const denMag = denRe * denRe + denIm * denIm;
    if (denMag < 1e-28) {
        ensureZetaLogIntegerCache(NUM_ZETA_TERMS_ETA_SERIES);
        let etaRe = 0;
        let etaIm = 0;
        for (let n = 1; n <= NUM_ZETA_TERMS_ETA_SERIES; n += 1) {
            const logN = zetaLogIntegerCache[n];
            const sign = n % 2 === 0 ? -1 : 1;
            const magnitude = sign * expSafe(-re * logN);
            const angle = -im * logN;
            etaRe += magnitude * Math.cos(angle);
            etaIm += magnitude * Math.sin(angle);
        }
        return divideComponents(etaRe, etaIm, denRe, denIm, out);
    }

    const terms = zetaHasseCollapsedTerms(NUM_ZETA_HASSE_LEVELS);
    const coeffs = terms.coeffs;
    const logs = terms.logs;
    let outerRe = 0;
    let outerIm = 0;
    for (let k = 0; k < terms.length; k += 1) {
        const logK = logs[k];
        const magnitude = coeffs[k] * expSafe(-re * logK);
        const angle = -im * logK;
        outerRe += magnitude * Math.cos(angle);
        outerIm += magnitude * Math.sin(angle);
    }
    return divideComponents(outerRe, outerIm, denRe, denIm, out);
}

function evaluatePrimitiveVmFunctionInto(accelerator, code, re, im, cr, ci, out) {
    switch (code) {
        case VMF_IDENTITY:
            out[0] = re;
            out[1] = im;
            return out;
        case VMF_C:
            out[0] = cr;
            out[1] = ci;
            return out;
        case VMF_COS:
            out[0] = Math.cos(re) * Math.cosh(im);
            out[1] = -Math.sin(re) * Math.sinh(im);
            return out;
        case VMF_SIN:
            out[0] = Math.sin(re) * Math.cosh(im);
            out[1] = Math.cos(re) * Math.sinh(im);
            return out;
        case VMF_TAN: {
            const sinRe = Math.sin(re) * Math.cosh(im);
            const sinIm = Math.cos(re) * Math.sinh(im);
            const cosRe = Math.cos(re) * Math.cosh(im);
            const cosIm = -Math.sin(re) * Math.sinh(im);
            return divideComponents(sinRe, sinIm, cosRe, cosIm, out);
        }
        case VMF_SEC: {
            const cosRe = Math.cos(re) * Math.cosh(im);
            const cosIm = -Math.sin(re) * Math.sinh(im);
            return divideComponents(1, 0, cosRe, cosIm, out);
        }
        case VMF_EXP:
            return expComponents(re, im, out);
        case VMF_LN:
            return lnComponents(re, im, out);
        case VMF_RECIPROCAL:
            return divideComponents(1, 0, re, im, out);
        case VMF_SINH:
            out[0] = Math.sinh(re) * Math.cos(im);
            out[1] = Math.cosh(re) * Math.sin(im);
            return out;
        case VMF_COSH:
            out[0] = Math.cosh(re) * Math.cos(im);
            out[1] = Math.sinh(re) * Math.sin(im);
            return out;
        case VMF_TANH: {
            const sinhRe = Math.sinh(re) * Math.cos(im);
            const sinhIm = Math.cosh(re) * Math.sin(im);
            const coshRe = Math.cosh(re) * Math.cos(im);
            const coshIm = Math.sinh(re) * Math.sin(im);
            return divideComponents(sinhRe, sinhIm, coshRe, coshIm, out);
        }
        case VMF_POWER:
            return powRealComponents(re, im, accelerator ? accelerator.fractionalPowerN : DEFAULT_FRACTIONAL_POWER, out);
        case VMF_MOBIUS:
            return mobiusComponentsCompiled(accelerator, re, im, out);
        case VMF_POLYNOMIAL:
            return polynomialComponentsCompiled(accelerator, re, im, out);
        case VMF_POINCARE:
            if (im <= 1e-9) {
                out[0] = NaN;
                out[1] = NaN;
                return out;
            }
            out[1] = Math.sqrt(im);
            out[0] = re / out[1];
            return out;
        case VMF_ZETA:
            return zetaComponents(re, im, !!accelerator?.zetaContinuationEnabled, out);
        case VMF_APPLY_POWER:
            return powRealComponents(re, im, DEFAULT_FRACTIONAL_POWER, out);
        default:
            out[0] = NaN;
            out[1] = NaN;
            return out;
    }
}



function createCompiledAlgebraicAccelerator(snapshot) {
    if (
        snapshot.functionKey !== 'algebraic_chaining' ||
        !snapshot.algebraicChainingEnabled ||
        !Array.isArray(snapshot.algebraicChainingTerms) ||
        snapshot.algebraicChainingTerms.length === 0
    ) {
        return null;
    }

    const zExpr = snapshot.algebraicChainingZExpr && snapshot.algebraicChainingZExpr !== 'z'
        ? compilePrimitiveExpression(snapshot.algebraicChainingZExpr)
        : null;
    if (snapshot.algebraicChainingZExpr && snapshot.algebraicChainingZExpr !== 'z' && !zExpr) {
        return null;
    }

    const degree = Math.max(0, Math.floor(Number(snapshot.polynomialN) || 0));
    const polynomialCoeffsRe = new Float64Array(degree + 1);
    const polynomialCoeffsIm = new Float64Array(degree + 1);
    for (let k = 0; k <= degree; k += 1) {
        const coeff = toComplex(snapshot.polynomialCoeffs?.[k] ?? ZERO);
        polynomialCoeffsRe[k] = coeff.re;
        polynomialCoeffsIm[k] = coeff.im;
    }

    const mobiusA = toComplex(snapshot.mobiusA ?? ONE);
    const mobiusB = toComplex(snapshot.mobiusB ?? ZERO);
    const mobiusC = toComplex(snapshot.mobiusC ?? ZERO);
    const mobiusD = toComplex(snapshot.mobiusD ?? ONE);
    const termCoeffRe = [];
    const termCoeffIm = [];
    const termFactorStart = [];
    const termFactorEnd = [];
    const factorOpStart = [];
    const factorOpEnd = [];
    const ops = [];
    const args = [];
    let maxOps = 0;

    const terms = snapshot.algebraicChainingTerms;
    for (let t = 0; t < terms.length; t += 1) {
        const term = terms[t];
        const coeff = toComplex(term?.coeff ?? ONE);
        termCoeffRe.push(coeff.re);
        termCoeffIm.push(coeff.im);
        termFactorStart.push(factorOpStart.length);

        const rawFactors = Array.isArray(term?.factors) ? term.factors : [];
        for (let f = 0; f < rawFactors.length; f += 1) {
            const raw = rawFactors[f];
            if (!raw || raw.func === 'none') break;
            const start = ops.length;
            if (!compilePrimitiveAlgebraicBlock(raw, ops, args)) return null;
            factorOpStart.push(start);
            factorOpEnd.push(ops.length);
            if (ops.length - start > maxOps) maxOps = ops.length - start;
        }
        termFactorEnd.push(factorOpStart.length);
    }

    return {
        type: 'compiled-algebraic',
        // Flat bytecode-like layout. Hot evaluation walks typed arrays only; no factor
        // objects, temporary complex values, or per-pixel closures are allocated.
        termCoeffRe: Float64Array.from(termCoeffRe),
        termCoeffIm: Float64Array.from(termCoeffIm),
        termFactorStart: Int32Array.from(termFactorStart),
        termFactorEnd: Int32Array.from(termFactorEnd),
        factorOpStart: Int32Array.from(factorOpStart),
        factorOpEnd: Int32Array.from(factorOpEnd),
        ops: Int16Array.from(ops),
        opArgs: Float64Array.from(args),
        polynomialDegree: degree,
        polynomialCoeffsRe,
        polynomialCoeffsIm,
        mobiusARe: mobiusA.re,
        mobiusAIm: mobiusA.im,
        mobiusBRe: mobiusB.re,
        mobiusBIm: mobiusB.im,
        mobiusCRe: mobiusC.re,
        mobiusCIm: mobiusC.im,
        mobiusDRe: mobiusD.re,
        mobiusDIm: mobiusD.im,
        fractionalPowerN: Number(snapshot.fractionalPowerN ?? DEFAULT_FRACTIONAL_POWER),
        zetaContinuationEnabled: !!snapshot.zetaContinuationEnabled,
        zExpr,
        scratch: new Float64Array(Math.max(8, (maxOps + 4) * 2))
    };
}

function powIntegerComponents(re, im, exponent, out) {
    let n = exponent < 0 ? -exponent : exponent;
    let accRe = 1;
    let accIm = 0;
    let baseRe = re;
    let baseIm = im;

    while (n > 0) {
        if (n & 1) {
            const nextRe = accRe * baseRe - accIm * baseIm;
            accIm = accRe * baseIm + accIm * baseRe;
            accRe = nextRe;
        }
        n >>= 1;
        if (n > 0) {
            const nextBaseRe = baseRe * baseRe - baseIm * baseIm;
            baseIm = 2 * baseRe * baseIm;
            baseRe = nextBaseRe;
        }
    }

    if (exponent < 0) return divideComponents(1, 0, accRe, accIm, out);
    out[0] = accRe;
    out[1] = accIm;
    return out;
}

function powRealComponents(re, im, exponent, out) {
    if (Number.isInteger(exponent) && exponent >= -8 && exponent <= 8) {
        return powIntegerComponents(re, im, exponent, out);
    }
    lnComponents(re, im, out);
    return expComponents(out[0] * exponent, out[1] * exponent, out);
}

function polynomialComponentsCompiled(accelerator, re, im, out) {
    let zr = accelerator.polynomialCoeffsRe[accelerator.polynomialDegree] || 0;
    let zi = accelerator.polynomialCoeffsIm[accelerator.polynomialDegree] || 0;
    for (let k = accelerator.polynomialDegree - 1; k >= 0; k -= 1) {
        const nextRe = zr * re - zi * im + (accelerator.polynomialCoeffsRe[k] || 0);
        zi = zr * im + zi * re + (accelerator.polynomialCoeffsIm[k] || 0);
        zr = nextRe;
    }
    out[0] = zr;
    out[1] = zi;
    return out;
}

function mobiusComponentsCompiled(accelerator, re, im, out) {
    const nr = accelerator.mobiusARe * re - accelerator.mobiusAIm * im + accelerator.mobiusBRe;
    const ni = accelerator.mobiusARe * im + accelerator.mobiusAIm * re + accelerator.mobiusBIm;
    const dr = accelerator.mobiusCRe * re - accelerator.mobiusCIm * im + accelerator.mobiusDRe;
    const di = accelerator.mobiusCRe * im + accelerator.mobiusCIm * re + accelerator.mobiusDIm;
    return divideComponents(nr, ni, dr, di, out);
}

function evaluatePrimitiveFactorInto(accelerator, start, end, zr, zi, cr, ci, out) {
    const ops = accelerator.ops;
    const args = accelerator.opArgs;
    let ar = zr;
    let ai = zi;
    for (let i = start; i < end; i += 1) {
        switch (ops[i]) {
            case VMF_C:
                ar = cr;
                ai = ci;
                break;
            case VMF_COS: {
                const nr = Math.cos(ar) * Math.cosh(ai);
                ai = -Math.sin(ar) * Math.sinh(ai);
                ar = nr;
                break;
            }
            case VMF_SIN: {
                const nr = Math.sin(ar) * Math.cosh(ai);
                ai = Math.cos(ar) * Math.sinh(ai);
                ar = nr;
                break;
            }
            case VMF_TAN: {
                const sinRe = Math.sin(ar) * Math.cosh(ai);
                const sinIm = Math.cos(ar) * Math.sinh(ai);
                const cosRe = Math.cos(ar) * Math.cosh(ai);
                const cosIm = -Math.sin(ar) * Math.sinh(ai);
                divideComponents(sinRe, sinIm, cosRe, cosIm, out);
                ar = out[0];
                ai = out[1];
                break;
            }
            case VMF_SEC: {
                const cosRe = Math.cos(ar) * Math.cosh(ai);
                const cosIm = -Math.sin(ar) * Math.sinh(ai);
                divideComponents(1, 0, cosRe, cosIm, out);
                ar = out[0];
                ai = out[1];
                break;
            }
            case VMF_EXP: {
                const magnitude = expSafe(ar);
                const nr = magnitude * Math.cos(ai);
                ai = magnitude * Math.sin(ai);
                ar = nr;
                break;
            }
            case VMF_LN: {
                if (ar === 0 && ai === 0) {
                    ar = -Infinity;
                    ai = 0;
                } else {
                    const nr = Math.log(Math.hypot(ar, ai));
                    ai = Math.atan2(ai, ar);
                    ar = nr;
                }
                break;
            }
            case VMF_RECIPROCAL:
                divideComponents(1, 0, ar, ai, out);
                ar = out[0];
                ai = out[1];
                break;
            case VMF_SINH: {
                const nr = Math.sinh(ar) * Math.cos(ai);
                ai = Math.cosh(ar) * Math.sin(ai);
                ar = nr;
                break;
            }
            case VMF_COSH: {
                const nr = Math.cosh(ar) * Math.cos(ai);
                ai = Math.sinh(ar) * Math.sin(ai);
                ar = nr;
                break;
            }
            case VMF_TANH: {
                const sinhRe = Math.sinh(ar) * Math.cos(ai);
                const sinhIm = Math.cosh(ar) * Math.sin(ai);
                const coshRe = Math.cosh(ar) * Math.cos(ai);
                const coshIm = Math.sinh(ar) * Math.sin(ai);
                divideComponents(sinhRe, sinhIm, coshRe, coshIm, out);
                ar = out[0];
                ai = out[1];
                break;
            }
            case VMF_POWER:
                powRealComponents(ar, ai, accelerator.fractionalPowerN, out);
                ar = out[0];
                ai = out[1];
                break;
            case VMF_MOBIUS: {
                const nr = accelerator.mobiusARe * ar - accelerator.mobiusAIm * ai + accelerator.mobiusBRe;
                const ni = accelerator.mobiusARe * ai + accelerator.mobiusAIm * ar + accelerator.mobiusBIm;
                const dr = accelerator.mobiusCRe * ar - accelerator.mobiusCIm * ai + accelerator.mobiusDRe;
                const di = accelerator.mobiusCRe * ai + accelerator.mobiusCIm * ar + accelerator.mobiusDIm;
                divideComponents(nr, ni, dr, di, out);
                ar = out[0];
                ai = out[1];
                break;
            }
            case VMF_POLYNOMIAL: {
                let pr = accelerator.polynomialCoeffsRe[accelerator.polynomialDegree] || 0;
                let pi = accelerator.polynomialCoeffsIm[accelerator.polynomialDegree] || 0;
                for (let k = accelerator.polynomialDegree - 1; k >= 0; k -= 1) {
                    const nr = pr * ar - pi * ai + (accelerator.polynomialCoeffsRe[k] || 0);
                    pi = pr * ai + pi * ar + (accelerator.polynomialCoeffsIm[k] || 0);
                    pr = nr;
                }
                ar = pr;
                ai = pi;
                break;
            }
            case VMF_POINCARE:
                if (ai <= 1e-9) {
                    ar = NaN;
                    ai = NaN;
                } else {
                    const sqrtIm = Math.sqrt(ai);
                    ar /= sqrtIm;
                    ai = sqrtIm;
                }
                break;
            case VMF_ZETA:
                zetaComponents(ar, ai, !!accelerator.zetaContinuationEnabled, out);
                ar = out[0];
                ai = out[1];
                break;
            case VMF_APPLY_POWER:
                powRealComponents(ar, ai, args[i], out);
                ar = out[0];
                ai = out[1];
                break;
            case VMF_IDENTITY:
            default:
                break;
        }
    }
    out[0] = ar;
    out[1] = ai;
    return out;
}



function evaluateCompiledAlgebraicInto(accelerator, zr, zi, cr, ci, out) {
    let pointRe = zr;
    let pointIm = zi;
    const scratch = accelerator.scratch;
    if (accelerator.zExpr) {
        evaluatePrimitiveExpressionInto(accelerator.zExpr, zr, zi, cr, ci, scratch);
        pointRe = scratch[0];
        pointIm = scratch[1];
        if (!(pointRe === pointRe && pointIm === pointIm && finite(pointRe) && finite(pointIm))) {
            out[0] = NaN;
            out[1] = NaN;
            return out;
        }
    }

    const termCoeffRe = accelerator.termCoeffRe;
    const termCoeffIm = accelerator.termCoeffIm;
    const termFactorStart = accelerator.termFactorStart;
    const termFactorEnd = accelerator.termFactorEnd;
    const factorOpStart = accelerator.factorOpStart;
    const factorOpEnd = accelerator.factorOpEnd;
    let sumRe = 0;
    let sumIm = 0;

    for (let t = 0; t < termCoeffRe.length; t += 1) {
        let termRe = termCoeffRe[t];
        let termIm = termCoeffIm[t];
        const fEnd = termFactorEnd[t];

        for (let f = termFactorStart[t]; f < fEnd; f += 1) {
            evaluatePrimitiveFactorInto(accelerator, factorOpStart[f], factorOpEnd[f], pointRe, pointIm, cr, ci, scratch);
            const fr = scratch[0];
            const fi = scratch[1];
            const nextRe = termRe * fr - termIm * fi;
            termIm = termRe * fi + termIm * fr;
            termRe = nextRe;
        }

        if (!(termRe === termRe && termIm === termIm && finite(termRe) && finite(termIm))) {
            out[0] = NaN;
            out[1] = NaN;
            return out;
        }
        sumRe += termRe;
        sumIm += termIm;
    }

    out[0] = sumRe;
    out[1] = sumIm;
    return out;
}

function evaluateCompiledAlgebraicAccelerator(accelerator, z, c) {
    const value = toComplex(z);
    const parameter = toComplex(c);
    const out = evaluateCompiledAlgebraicInto(accelerator, value.re, value.im, parameter.re, parameter.im, accelerator.scratch);
    return { re: out[0], im: out[1] };
}

function definitelyInsideUnitQuadraticCardioidOrBulb(cr, ci) {
    const xMinusQuarter = cr - 0.25;
    const ciSq = ci * ci;
    const q = xMinusQuarter * xMinusQuarter + ciSq;
    if (q * (q + xMinusQuarter) <= 0.25 * ciSq) return true;
    const xPlusOne = cr + 1;
    return xPlusOne * xPlusOne + ciSq <= 0.0625;
}


function createDirectBuiltinAccelerator(snapshot) {
    switch (snapshot?.functionKey) {
        case 'polynomial': {
            const { degree, coeffsRe, coeffsIm } = directPolynomialCoefficientArrays(snapshot);
            return { type: 'direct-polynomial', degree, coeffsRe, coeffsIm, scratch: new Float64Array(2) };
        }
        case 'mobius':
            return {
                type: 'direct-mobius',
                aRe: scalarRe(snapshot.mobiusA),
                aIm: scalarIm(snapshot.mobiusA),
                bRe: scalarRe(snapshot.mobiusB),
                bIm: scalarIm(snapshot.mobiusB),
                cRe: scalarRe(snapshot.mobiusC),
                cIm: scalarIm(snapshot.mobiusC),
                dRe: scalarRe(snapshot.mobiusD),
                dIm: scalarIm(snapshot.mobiusD),
                scratch: new Float64Array(2)
            };
        case 'zeta':
            return { type: 'direct-zeta', zetaContinuationEnabled: !!snapshot.zetaContinuationEnabled, scratch: new Float64Array(2) };
        default:
            return null;
    }
}

function evaluateDirectPolynomialInto(accelerator, re, im, out) {
    const coeffsRe = accelerator.coeffsRe;
    const coeffsIm = accelerator.coeffsIm;
    let zr = coeffsRe[accelerator.degree];
    let zi = coeffsIm[accelerator.degree];
    for (let k = accelerator.degree - 1; k >= 0; k -= 1) {
        const nextRe = zr * re - zi * im + coeffsRe[k];
        zi = zr * im + zi * re + coeffsIm[k];
        zr = nextRe;
    }
    out[0] = zr;
    out[1] = zi;
    return out;
}

function evaluateDirectMobiusInto(accelerator, re, im, out) {
    const nr = accelerator.aRe * re - accelerator.aIm * im + accelerator.bRe;
    const ni = accelerator.aRe * im + accelerator.aIm * re + accelerator.bIm;
    const dr = accelerator.cRe * re - accelerator.cIm * im + accelerator.dRe;
    const di = accelerator.cRe * im + accelerator.cIm * re + accelerator.dIm;
    return divideComponents(nr, ni, dr, di, out);
}

function acceleratorResultObject(out) {
    return { re: out[0], im: out[1] };
}

function createDynamicsAccelerator(snapshot) {
    if (snapshot === lastDynamicsAcceleratorSnapshot) return lastDynamicsAccelerator;

    const accelerator =
        createPolynomialParameterAccelerator(snapshot) ||
        createLaurentParameterAccelerator(snapshot) ||
        createCompiledAlgebraicAccelerator(snapshot) ||
        createDirectBuiltinAccelerator(snapshot) ||
        NO_ACCELERATOR;

    lastDynamicsAcceleratorSnapshot = snapshot;
    lastDynamicsAccelerator = accelerator;
    return accelerator;
}

function evaluatePolynomialParameterAccelerator(accelerator, z, c) {
    const value = toComplex(z);
    let acc = accelerator.coeffs[accelerator.degree] || ZERO;
    for (let k = accelerator.degree - 1; k >= 0; k -= 1) {
        acc = complexAdd(complexMul(acc, value), accelerator.coeffs[k] || ZERO);
    }
    return accelerator.hasParameter
        ? complexAdd(acc, complexMul(accelerator.cCoeff, c))
        : acc;
}

function evaluateBase(snapshot, value, c, accelerator = NO_ACCELERATOR) {
    if (accelerator.type === 'polynomial-parameter') {
        return evaluatePolynomialParameterAccelerator(accelerator, value, c);
    }
    if (accelerator.type === 'laurent-parameter') {
        return evaluateLaurentParameterAccelerator(accelerator, value, c);
    }
    if (accelerator.type === 'compiled-algebraic') {
        return evaluateCompiledAlgebraicAccelerator(accelerator, value, c);
    }
    if (accelerator.type === 'direct-polynomial') {
        const point = toComplex(value);
        return acceleratorResultObject(evaluateDirectPolynomialInto(accelerator, point.re, point.im, accelerator.scratch));
    }
    if (accelerator.type === 'direct-mobius') {
        const point = toComplex(value);
        return acceleratorResultObject(evaluateDirectMobiusInto(accelerator, point.re, point.im, accelerator.scratch));
    }
    if (accelerator.type === 'direct-zeta') {
        const point = toComplex(value);
        return acceleratorResultObject(zetaComponents(point.re, point.im, accelerator.zetaContinuationEnabled, accelerator.scratch));
    }
    return evaluateBuiltin(snapshot.functionKey, value, snapshot, { c });
}

function exceedsChainBailout(value) {
    return Math.max(Math.abs(value?.re ?? 0), Math.abs(value?.im ?? 0)) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE;
}

function validOrNull(value) {
    return validComplex(value) ? value : null;
}

function snapshotChainCount(snapshot) {
    return Math.max(1, Math.floor(Number(snapshot.chainCount) || 1));
}

function snapshotSupportsOrbitTrace(snapshot) {
    const chainMode = snapshot?.chainMode || 'recursion';
    return !!snapshot?.chainingEnabled &&
        !snapshot?.isWPlaneColoring &&
        snapshotChainCount(snapshot) > 1 &&
        (chainMode === 'recursion' || chainMode === 'zero_seed');
}

function resolveOrbitColoringMode(snapshot) {
    const mode = normalizeOrbitColoringMode(snapshot?.orbitColoringMode);
    if (mode === ORBIT_COLORING_MODES.value) return mode;
    return snapshotSupportsOrbitTrace(snapshot) ? mode : ORBIT_COLORING_MODES.value;
}

function snapshotUsesValueColoring(snapshot) {
    return resolveOrbitColoringMode(snapshot) === ORBIT_COLORING_MODES.value;
}

function snapshotUsesEscapeColoring(snapshot) {
    return resolveOrbitColoringMode(snapshot) === ORBIT_COLORING_MODES.escape;
}

function evaluatePolynomialParameterInto(accelerator, zr, zi, cr, ci, out) {
    let nr = accelerator.coeffsRe[accelerator.degree] || 0;
    let ni = accelerator.coeffsIm[accelerator.degree] || 0;
    for (let k = accelerator.degree - 1; k >= 0; k -= 1) {
        const tr = nr * zr - ni * zi + (accelerator.coeffsRe[k] || 0);
        ni = nr * zi + ni * zr + (accelerator.coeffsIm[k] || 0);
        nr = tr;
    }
    if (accelerator.hasParameter) {
        nr += accelerator.cCoeffRe * cr - accelerator.cCoeffIm * ci;
        ni += accelerator.cCoeffRe * ci + accelerator.cCoeffIm * cr;
    }
    out[0] = nr;
    out[1] = ni;
    return out;
}

function evaluateComponentBaseInto(snapshot, accelerator, zr, zi, cr, ci, out) {
    switch (accelerator.type) {
        case 'compiled-algebraic':
            return evaluateCompiledAlgebraicInto(accelerator, zr, zi, cr, ci, out);
        case 'laurent-parameter':
            return evaluateLaurentInto(accelerator, zr, zi, cr, ci, out);
        case 'polynomial-parameter':
            return evaluatePolynomialParameterInto(accelerator, zr, zi, cr, ci, out);
        case 'direct-polynomial':
            return evaluateDirectPolynomialInto(accelerator, zr, zi, out);
        case 'direct-mobius':
            return evaluateDirectMobiusInto(accelerator, zr, zi, out);
        case 'direct-zeta':
            return zetaComponents(zr, zi, accelerator.zetaContinuationEnabled, out);
        case 'none':
            return evaluateBuiltinComponents(snapshot.functionKey, zr, zi, snapshot, out);
        default:
            return null;
    }
}

function evaluateDomainDynamicsValueComponents(snapshot, re, im, accelerator) {
    const scratch = accelerator.scratch || new Float64Array(2);
    const count = snapshotChainCount(snapshot);
    const mode = snapshot.chainMode || 'recursion';

    if (!snapshot.chainingEnabled || (count <= 1 && mode !== 'zero_seed')) {
        if (!evaluateComponentBaseInto(snapshot, accelerator, re, im, re, im, scratch)) return null;
        const vr = scratch[0];
        const vi = scratch[1];
        return vr === vr && vi === vi && finite(vr) && finite(vi) ? { re: vr, im: vi } : null;
    }

    if (mode === 'zero_seed') {
        let currentRe = 0;
        let currentIm = 0;
        let lastRe = NaN;
        let lastIm = NaN;
        let hasLast = false;
        for (let i = 0; i < count; i += 1) {
            if (!evaluateComponentBaseInto(snapshot, accelerator, currentRe, currentIm, re, im, scratch)) return null;
            currentRe = scratch[0];
            currentIm = scratch[1];
            if (!(currentRe === currentRe && currentIm === currentIm && finite(currentRe) && finite(currentIm))) {
                return hasLast ? { re: lastRe, im: lastIm } : null;
            }
            lastRe = currentRe;
            lastIm = currentIm;
            hasLast = true;
            if ((currentRe < 0 ? -currentRe : currentRe) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                (currentIm < 0 ? -currentIm : currentIm) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) {
                return { re: currentRe, im: currentIm };
            }
        }
        return hasLast ? { re: currentRe, im: currentIm } : null;
    }

    if (!evaluateComponentBaseInto(snapshot, accelerator, re, im, re, im, scratch)) return null;
    let currentRe = scratch[0];
    let currentIm = scratch[1];
    if (!(currentRe === currentRe && currentIm === currentIm && finite(currentRe) && finite(currentIm))) return null;
    let lastRe = currentRe;
    let lastIm = currentIm;
    if ((currentRe < 0 ? -currentRe : currentRe) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
        (currentIm < 0 ? -currentIm : currentIm) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) {
        return { re: currentRe, im: currentIm };
    }

    for (let i = 1; i < count; i += 1) {
        if (!evaluateComponentBaseInto(snapshot, accelerator, currentRe, currentIm, re, im, scratch)) {
            return { re: lastRe, im: lastIm };
        }
        currentRe = scratch[0];
        currentIm = scratch[1];
        if (!(currentRe === currentRe && currentIm === currentIm && finite(currentRe) && finite(currentIm))) {
            return { re: lastRe, im: lastIm };
        }
        lastRe = currentRe;
        lastIm = currentIm;
        if ((currentRe < 0 ? -currentRe : currentRe) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
            (currentIm < 0 ? -currentIm : currentIm) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) {
            return { re: currentRe, im: currentIm };
        }
    }

    return { re: currentRe, im: currentIm };
}

function supportsComponentValueEvaluation(snapshot, accelerator) {
    if (accelerator.type === 'compiled-algebraic' ||
        accelerator.type === 'laurent-parameter' ||
        accelerator.type === 'polynomial-parameter' ||
        accelerator.type === 'direct-polynomial' ||
        accelerator.type === 'direct-mobius' ||
        accelerator.type === 'direct-zeta') return true;
    if (accelerator.type !== 'none') return false;
    const mode = snapshot.chainMode || 'recursion';
    if (mode !== 'recursion' && mode !== 'zero_seed') return false;
    return !!evaluateBuiltinComponents(snapshot.functionKey, 0.125, -0.25, snapshot, new Float64Array(2));
}

export function evaluateDomainDynamicsValue(snapshot, re, im, accelerator = createDynamicsAccelerator(snapshot)) {
    if (supportsComponentValueEvaluation(snapshot, accelerator)) {
        return evaluateDomainDynamicsValueComponents(snapshot, re, im, accelerator);
    }

    const count = snapshotChainCount(snapshot);
    const c = { re, im };

    if (!snapshot.chainingEnabled || (count <= 1 && snapshot.chainMode !== 'zero_seed')) {
        return validOrNull(evaluateBase(snapshot, c, c, accelerator));
    }

    if (snapshot.chainMode === 'zero_seed') {
        let current = { re: 0, im: 0 };
        let lastFinite = null;
        for (let i = 0; i < count; i += 1) {
            current = validOrNull(evaluateBase(snapshot, current, c, accelerator));
            if (!current) return lastFinite;
            lastFinite = current;
            if (exceedsChainBailout(current)) return current;
        }
        return current;
    }

    let current = validOrNull(evaluateBase(snapshot, c, c, accelerator));
    if (!current) return null;
    let lastFinite = current;
    if (exceedsChainBailout(lastFinite)) return lastFinite;

    for (let i = 1; i < count; i += 1) {
        current = validOrNull(evaluateBase(snapshot, current, c, accelerator));
        if (!current) return lastFinite;
        lastFinite = current;
        if (exceedsChainBailout(current)) return current;
    }

    return current;
}

function paletteColor(stops, h) {
    const palette = Array.isArray(stops) && stops.length >= 2 ? stops : DEFAULT_PALETTE_STOPS;
    const hue = Math.min(0.999999, Math.max(0, h));
    const value = hue * (palette.length - 1);
    const idx = Math.min(palette.length - 2, Math.floor(value));
    const t = value - idx;
    const a = palette[idx];
    const b = palette[idx + 1];
    return [
        a[0] * (1 - t) + b[0] * t,
        a[1] * (1 - t) + b[1] * t,
        a[2] * (1 - t) + b[2] * t
    ];
}

function applyLightnessAndSaturation(rgb, lightness, saturation) {
    let [r, g, b] = rgb;
    if (lightness < 0.5) {
        const t = lightness / 0.5;
        r *= t;
        g *= t;
        b *= t;
    } else {
        const t = (lightness - 0.5) / 0.5;
        r = r * (1 - t) + t;
        g = g * (1 - t) + t;
        b = b * (1 - t) + t;
    }

    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray * (1 - saturation) + r * saturation;
    g = gray * (1 - saturation) + g * saturation;
    b = gray * (1 - saturation) + b * saturation;

    return [
        byteFromUnit(r),
        byteFromUnit(g),
        byteFromUnit(b)
    ];
}

function magnitudeLightness(logMod, cycles) {
    if (!finite(logMod)) return DOMAIN_LIGHTNESS_MAX;
    if (cycles <= 0.0001) return 0.5;
    const detail = Math.max(0.05, cycles);
    const tone = (2 / Math.PI) * Math.atan(
        logMod * (DOMAIN_LIGHTNESS_DETAIL_BASE + detail * DOMAIN_LIGHTNESS_DETAIL_SCALE)
    );
    return DOMAIN_LIGHTNESS_MIN + (DOMAIN_LIGHTNESS_MAX - DOMAIN_LIGHTNESS_MIN) * tone;
}

export function domainColorForValue(value, snapshot) {
    if (!validComplex(value)) return [0, 0, 0];
    const phase = Math.atan2(value.im, value.re);
    const modValue = Math.hypot(value.re, value.im);
    if (!finite(modValue)) return [0, 0, 0];

    const style = snapshot.style || {};
    const logMod = Math.log1p(modValue);
    const lightnessBase = magnitudeLightness(logMod, Number(style.lightnessCycles) || 0);
    const contrast = finite(style.contrast) ? style.contrast : 1;
    const brightness = finite(style.brightness) ? style.brightness : 1;
    const saturation = finite(style.saturation) ? style.saturation : 1;
    const lightness = Math.min(0.95, Math.max(0.05, (0.5 + (lightnessBase - 0.5) * contrast) * brightness));
    const finalSaturation = Math.min(1, Math.max(0, saturation));
    let hue = (phase / TWO_PI) % 1;
    if (hue < 0) hue += 1;
    return applyLightnessAndSaturation(paletteColor(snapshot.paletteStops, hue), lightness, finalSaturation);
}

function dynamicsEscapeColor(smoothIteration, count, snapshot) {
    const t = Math.max(0, Math.min(1, smoothIteration / Math.max(1, count)));
    const style = snapshot.style || {};
    const baseColor = paletteColor(snapshot.paletteStops, Math.min(t, 0.9999));
    const lightnessBase = 0.22 + 0.58 * Math.pow(t, 0.65);
    const contrast = finite(style.contrast) ? style.contrast : 1;
    const brightness = finite(style.brightness) ? style.brightness : 1;
    const saturation = finite(style.saturation) ? style.saturation : 1;
    const lightness = Math.min(0.95, Math.max(0.05, (0.5 + (lightnessBase - 0.5) * contrast) * brightness));
    return applyLightnessAndSaturation(baseColor, lightness, Math.min(1, Math.max(0, saturation)));
}

function dynamicsPhaseEventColor(value, intensity, snapshot) {
    if (!validComplex(value)) return [0, 0, 0];
    const phase = Math.atan2(value.im, value.re);
    const modValue = Math.hypot(value.re, value.im);
    if (!finite(modValue)) return [0, 0, 0];

    let hue = (phase / TWO_PI) % 1;
    if (hue < 0) hue += 1;

    const t = Math.max(0, Math.min(1, intensity));
    const style = snapshot.style || {};
    const baseColor = paletteColor(snapshot.paletteStops, hue);
    const lightnessBase = 0.24 + 0.58 * Math.pow(t, 0.55);
    const contrast = finite(style.contrast) ? style.contrast : 1;
    const brightness = finite(style.brightness) ? style.brightness : 1;
    const saturation = finite(style.saturation) ? style.saturation : 1;
    const lightness = Math.min(0.95, Math.max(0.05, (0.5 + (lightnessBase - 0.5) * contrast) * brightness));
    return applyLightnessAndSaturation(baseColor, lightness, Math.min(1, Math.max(0, saturation)));
}

function convergenceIntensity(iteration, count) {
    return 1 - Math.max(0, Math.min(1, (iteration - 1) / Math.max(1, count)));
}

function escapeSmoothIteration(iteration, count, magSq, next) {
    const magnitude = Math.sqrt(Math.max(magSq, DYNAMICS_ESCAPE_RADIUS));
    let smoothIteration = iteration + 1;
    if (next && finite(magnitude) && magnitude > 1.0001) {
        const smoothAdjust = Math.log(
            Math.max(Math.log(magnitude) / Math.log(DYNAMICS_ESCAPE_RADIUS), 1e-6)
        ) / Math.LN2;
        smoothIteration = Math.max(0, Math.min(count, smoothIteration - smoothAdjust));
    }
    return smoothIteration;
}

function byteFromUnit(value) {
    if (value <= 0) return 0;
    if (value >= 1) return 255;
    return (value * 255 + 0.5) | 0;
}

function writeRgb(data, idx, r, g, b) {
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = 255;
}

export function writeBlack(data, idx) {
    writeRgb(data, idx, 0, 0, 0);
}

function paletteComponents(stops, h) {
    const palette = Array.isArray(stops) && stops.length >= 2 ? stops : DEFAULT_PALETTE_STOPS;
    const hue = Math.min(0.999999, Math.max(0, h));
    const value = hue * (palette.length - 1);
    const idx = Math.min(palette.length - 2, Math.floor(value));
    const t = value - idx;
    const a = palette[idx];
    const b = palette[idx + 1];
    return {
        r: a[0] * (1 - t) + b[0] * t,
        g: a[1] * (1 - t) + b[1] * t,
        b: a[2] * (1 - t) + b[2] * t
    };
}

function writeStyledColor(data, idx, baseR, baseG, baseB, lightness, saturation) {
    let r = baseR;
    let g = baseG;
    let b = baseB;

    if (lightness < 0.5) {
        const t = lightness / 0.5;
        r *= t;
        g *= t;
        b *= t;
    } else {
        const t = (lightness - 0.5) / 0.5;
        r = r * (1 - t) + t;
        g = g * (1 - t) + t;
        b = b * (1 - t) + t;
    }

    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray * (1 - saturation) + r * saturation;
    g = gray * (1 - saturation) + g * saturation;
    b = gray * (1 - saturation) + b * saturation;

    writeRgb(
        data,
        idx,
        Math.min(255, Math.max(0, Math.round(r * 255))),
        Math.min(255, Math.max(0, Math.round(g * 255))),
        Math.min(255, Math.max(0, Math.round(b * 255)))
    );
}

function styleValues(snapshot) {
    const style = snapshot.style || {};
    return {
        brightness: finite(style.brightness) ? style.brightness : 1,
        contrast: finite(style.contrast) ? style.contrast : 1,
        saturation: Math.min(1, Math.max(0, finite(style.saturation) ? style.saturation : 1)),
        lightnessCycles: Number(style.lightnessCycles) || 0
    };
}

function colorContext(snapshot) {
    const style = snapshot.style || {};
    const palette = Array.isArray(snapshot.paletteStops) && snapshot.paletteStops.length >= 2
        ? snapshot.paletteStops
        : DEFAULT_PALETTE_STOPS;
    const length = palette.length;
    const paletteR = new Float64Array(length);
    const paletteG = new Float64Array(length);
    const paletteB = new Float64Array(length);
    for (let i = 0; i < length; i += 1) {
        const stop = palette[i];
        paletteR[i] = stop[0];
        paletteG[i] = stop[1];
        paletteB[i] = stop[2];
    }
    return {
        palette,
        paletteR,
        paletteG,
        paletteB,
        paletteLast: length - 1,
        brightness: finite(style.brightness) ? style.brightness : 1,
        contrast: finite(style.contrast) ? style.contrast : 1,
        saturation: Math.min(1, Math.max(0, finite(style.saturation) ? style.saturation : 1)),
        lightnessCycles: Number(style.lightnessCycles) || 0
    };
}

function writeStyledColorComponents(data, idx, baseR, baseG, baseB, lightness, saturation) {
    let r = baseR;
    let g = baseG;
    let b = baseB;

    if (lightness < 0.5) {
        const t = lightness / 0.5;
        r *= t;
        g *= t;
        b *= t;
    } else {
        const t = (lightness - 0.5) / 0.5;
        r = r * (1 - t) + t;
        g = g * (1 - t) + t;
        b = b * (1 - t) + t;
    }

    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray * (1 - saturation) + r * saturation;
    g = gray * (1 - saturation) + g * saturation;
    b = gray * (1 - saturation) + b * saturation;

    data[idx] = byteFromUnit(r);
    data[idx + 1] = byteFromUnit(g);
    data[idx + 2] = byteFromUnit(b);
    data[idx + 3] = 255;
}

function writeDomainColorWithContext(data, idx, re, im, context) {
    if (!finite(re) || !finite(im)) {
        writeBlack(data, idx);
        return;
    }

    const modValue = Math.hypot(re, im);
    if (!finite(modValue)) {
        writeBlack(data, idx);
        return;
    }

    const logMod = Math.log1p(modValue);
    const lightnessBase = magnitudeLightness(logMod, context.lightnessCycles);
    const lightness = Math.min(0.95, Math.max(0.05, (0.5 + (lightnessBase - 0.5) * context.contrast) * context.brightness));
    let hue = (Math.atan2(im, re) / TWO_PI) % 1;
    if (hue < 0) hue += 1;

    const value = Math.min(0.999999, Math.max(0, hue)) * context.paletteLast;
    const paletteIndex = Math.min(context.paletteLast - 1, Math.floor(value));
    const t = value - paletteIndex;
    const inverse = 1 - t;
    writeStyledColorComponents(
        data,
        idx,
        context.paletteR[paletteIndex] * inverse + context.paletteR[paletteIndex + 1] * t,
        context.paletteG[paletteIndex] * inverse + context.paletteG[paletteIndex + 1] * t,
        context.paletteB[paletteIndex] * inverse + context.paletteB[paletteIndex + 1] * t,
        lightness,
        context.saturation
    );
}

function writeDynamicsEscapeColorWithContext(data, idx, smoothIteration, count, context) {
    const tRaw = smoothIteration / Math.max(1, count);
    const t = tRaw <= 0 ? 0 : tRaw >= 1 ? 1 : tRaw;
    const hue = t < 0.9999 ? t : 0.9999;
    const value = hue * context.paletteLast;
    const paletteIndex = Math.min(context.paletteLast - 1, Math.floor(value));
    const blend = value - paletteIndex;
    const inverse = 1 - blend;
    const lightnessBase = 0.22 + 0.58 * Math.pow(t, 0.65);
    const lightness = Math.min(0.95, Math.max(0.05, (0.5 + (lightnessBase - 0.5) * context.contrast) * context.brightness));
    writeStyledColorComponents(
        data,
        idx,
        context.paletteR[paletteIndex] * inverse + context.paletteR[paletteIndex + 1] * blend,
        context.paletteG[paletteIndex] * inverse + context.paletteG[paletteIndex + 1] * blend,
        context.paletteB[paletteIndex] * inverse + context.paletteB[paletteIndex + 1] * blend,
        lightness,
        context.saturation
    );
}

export function writeDomainColor(data, idx, re, im, snapshot) {
    if (!finite(re) || !finite(im)) {
        writeBlack(data, idx);
        return;
    }

    const modValue = Math.hypot(re, im);
    if (!finite(modValue)) {
        writeBlack(data, idx);
        return;
    }

    const style = styleValues(snapshot);
    const phase = Math.atan2(im, re);
    const logMod = Math.log1p(modValue);
    const lightnessBase = magnitudeLightness(logMod, style.lightnessCycles);
    const lightness = Math.min(0.95, Math.max(0.05, (0.5 + (lightnessBase - 0.5) * style.contrast) * style.brightness));
    let hue = (phase / TWO_PI) % 1;
    if (hue < 0) hue += 1;
    const base = paletteComponents(snapshot.paletteStops, hue);
    writeStyledColor(data, idx, base.r, base.g, base.b, lightness, style.saturation);
}

export function writeDynamicsEscapeColor(data, idx, smoothIteration, count, snapshot) {
    const style = styleValues(snapshot);
    const t = Math.max(0, Math.min(1, smoothIteration / Math.max(1, count)));
    const base = paletteComponents(snapshot.paletteStops, Math.min(t, 0.9999));
    const lightnessBase = 0.22 + 0.58 * Math.pow(t, 0.65);
    const lightness = Math.min(0.95, Math.max(0.05, (0.5 + (lightnessBase - 0.5) * style.contrast) * style.brightness));
    writeStyledColor(data, idx, base.r, base.g, base.b, lightness, style.saturation);
}

function traceOrbitForPoint(snapshot, re, im, accelerator = createDynamicsAccelerator(snapshot), detectConvergence = true) {
    const count = snapshotChainCount(snapshot);
    const c = { re, im };
    let current = snapshot.chainMode === 'zero_seed' ? { re: 0, im: 0 } : c;
    let lastFinite = validComplex(current) ? current : null;

    for (let i = 0; i < count; i += 1) {
        const next = validOrNull(evaluateBase(snapshot, current, c, accelerator));
        const magSq = next ? next.re * next.re + next.im * next.im : DYNAMICS_ESCAPE_RADIUS_SQ;
        const tooLarge = next && (
            magSq > DYNAMICS_ESCAPE_RADIUS_SQ ||
            Math.max(Math.abs(next.re), Math.abs(next.im)) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE
        );

        if (!next || tooLarge) {
            return {
                escaped: true,
                converged: false,
                smoothIteration: escapeSmoothIteration(i, count, magSq, next),
                iteration: i + 1,
                value: next || lastFinite,
                count
            };
        }

        const deltaRe = next.re - current.re;
        const deltaIm = next.im - current.im;
        const deltaSq = deltaRe * deltaRe + deltaIm * deltaIm;
        const convergenceScale = Math.max(1, magSq);
        if (detectConvergence && deltaSq <= ORBIT_ATTRACTOR_CONVERGENCE_EPSILON_SQ * convergenceScale) {
            return {
                escaped: false,
                converged: true,
                smoothIteration: i + 1,
                iteration: i + 1,
                value: next,
                count
            };
        }

        current = next;
        lastFinite = next;
    }

    return {
        escaped: false,
        converged: false,
        smoothIteration: count,
        iteration: count,
        value: lastFinite,
        count
    };
}

export function orbitColorForPoint(snapshot, re, im, accelerator = createDynamicsAccelerator(snapshot)) {
    const mode = resolveOrbitColoringMode(snapshot);
    if (mode === ORBIT_COLORING_MODES.value) {
        return domainColorForValue(evaluateDomainDynamicsValue(snapshot, re, im, accelerator), snapshot);
    }

    const trace = traceOrbitForPoint(
        snapshot,
        re,
        im,
        accelerator,
        mode === ORBIT_COLORING_MODES.attractor || mode === ORBIT_COLORING_MODES.hybrid
    );
    if (mode === ORBIT_COLORING_MODES.escape) {
        return trace.escaped ? dynamicsEscapeColor(trace.smoothIteration, trace.count, snapshot) : [0, 0, 0];
    }
    if (mode === ORBIT_COLORING_MODES.attractor) {
        return trace.converged
            ? dynamicsPhaseEventColor(trace.value, convergenceIntensity(trace.iteration, trace.count), snapshot)
            : [0, 0, 0];
    }
    if (mode === ORBIT_COLORING_MODES.hybrid) {
        if (trace.escaped) {
            return dynamicsPhaseEventColor(
                trace.value,
                1 - Math.max(0, Math.min(1, trace.smoothIteration / Math.max(1, trace.count))),
                snapshot
            );
        }
        if (trace.converged) {
            return dynamicsPhaseEventColor(trace.value, convergenceIntensity(trace.iteration, trace.count), snapshot);
        }
        return domainColorForValue(trace.value, snapshot);
    }

    return domainColorForValue(evaluateDomainDynamicsValue(snapshot, re, im, accelerator), snapshot);
}

export function colorDomainDynamicsPoint(snapshot, re, im, accelerator = createDynamicsAccelerator(snapshot)) {
    return snapshotUsesValueColoring(snapshot)
        ? domainColorForValue(evaluateDomainDynamicsValue(snapshot, re, im, accelerator), snapshot)
        : orbitColorForPoint(snapshot, re, im, accelerator);
}

export function createDomainDynamicsTileRenderer(snapshot) {
    const accelerator = createDynamicsAccelerator(snapshot);
    return tile => renderDomainDynamicsTile(snapshot, tile, accelerator);
}

function renderPolynomialParameterOrbitTile(snapshot, tile, accelerator) {
    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    const xStep = tile.scale * spanX / snapshot.viewport.width;
    const yStep = -tile.scale * spanY / snapshot.viewport.height;
    const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
    const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
    const count = snapshotChainCount(snapshot);
    const zeroSeed = snapshot.chainMode === 'zero_seed';
    const degree = accelerator.degree;
    const coeffsRe = accelerator.coeffsRe;
    const coeffsIm = accelerator.coeffsIm;
    const cCoeffRe = accelerator.cCoeffRe;
    const cCoeffIm = accelerator.cCoeffIm;
    const hasParameter = accelerator.hasParameter;
    const colors = colorContext(snapshot);

    for (let y = 0; y < tile.height; y += 1) {
        const ci = yStart + y * yStep;
        for (let x = 0; x < tile.width; x += 1) {
            const cr = xStart + x * xStep;
            let zr = zeroSeed ? 0 : cr;
            let zi = zeroSeed ? 0 : ci;
            let smoothIteration = count;
            let escaped = false;

            for (let i = 0; i < count; i += 1) {
                let nr = coeffsRe[degree] || 0;
                let ni = coeffsIm[degree] || 0;

                for (let k = degree - 1; k >= 0; k -= 1) {
                    const tr = nr * zr - ni * zi + (coeffsRe[k] || 0);
                    ni = nr * zi + ni * zr + (coeffsIm[k] || 0);
                    nr = tr;
                }

                if (hasParameter) {
                    nr += cCoeffRe * cr - cCoeffIm * ci;
                    ni += cCoeffRe * ci + cCoeffIm * cr;
                }

                const magSq = nr * nr + ni * ni;
                const absRe = nr < 0 ? -nr : nr;
                const absIm = ni < 0 ? -ni : ni;
                const tooLarge = magSq > DYNAMICS_ESCAPE_RADIUS_SQ ||
                    absRe >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                    absIm >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE;

                if (nr !== nr || ni !== ni || tooLarge) {
                    const magnitude = Math.sqrt(Math.max(magSq, DYNAMICS_ESCAPE_RADIUS));
                    smoothIteration = i + 1;
                    if (finite(magnitude) && magnitude > 1.0001) {
                        const smoothAdjust = Math.log(
                            Math.max(Math.log(magnitude) / Math.log(DYNAMICS_ESCAPE_RADIUS), 1e-6)
                        ) / Math.LN2;
                        smoothIteration = Math.max(0, Math.min(count, smoothIteration - smoothAdjust));
                    }
                    escaped = true;
                    break;
                }

                zr = nr;
                zi = ni;
            }

            const idx = (y * tile.width + x) * 4;
            if (escaped) {
                writeDynamicsEscapeColorWithContext(data, idx, smoothIteration, count, colors);
            } else {
                writeBlack(data, idx);
            }
        }
    }

    return data;
}

function renderPolynomialParameterValueTile(snapshot, tile, accelerator) {
    const mode = snapshot.chainMode || 'recursion';
    if (mode !== 'recursion' && mode !== 'zero_seed') return null;

    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    const xStep = tile.scale * spanX / snapshot.viewport.width;
    const yStep = -tile.scale * spanY / snapshot.viewport.height;
    const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
    const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
    const count = snapshotChainCount(snapshot);
    const zeroSeed = mode === 'zero_seed';
    const degree = accelerator.degree;
    const coeffsRe = accelerator.coeffsRe;
    const coeffsIm = accelerator.coeffsIm;
    const cCoeffRe = accelerator.cCoeffRe;
    const cCoeffIm = accelerator.cCoeffIm;
    const hasParameter = accelerator.hasParameter;
    const colors = colorContext(snapshot);

    for (let y = 0; y < tile.height; y += 1) {
        const ci = yStart + y * yStep;
        for (let x = 0; x < tile.width; x += 1) {
            const cr = xStart + x * xStep;
            let zr = zeroSeed ? 0 : cr;
            let zi = zeroSeed ? 0 : ci;
            let lastRe = NaN;
            let lastIm = NaN;
            const iterations = snapshot.chainingEnabled || zeroSeed ? count : 1;

            for (let i = 0; i < iterations; i += 1) {
                let nr = coeffsRe[degree] || 0;
                let ni = coeffsIm[degree] || 0;

                for (let k = degree - 1; k >= 0; k -= 1) {
                    const tr = nr * zr - ni * zi + (coeffsRe[k] || 0);
                    ni = nr * zi + ni * zr + (coeffsIm[k] || 0);
                    nr = tr;
                }

                if (hasParameter) {
                    nr += cCoeffRe * cr - cCoeffIm * ci;
                    ni += cCoeffRe * ci + cCoeffIm * cr;
                }

                if (!finite(nr) || !finite(ni)) break;

                zr = nr;
                zi = ni;
                lastRe = nr;
                lastIm = ni;
                if ((nr < 0 ? -nr : nr) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                    (ni < 0 ? -ni : ni) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) break;
            }

            writeDomainColorWithContext(data, (y * tile.width + x) * 4, lastRe, lastIm, colors);
        }
    }

    return data;
}

function renderQuadraticPolynomialParameterOrbitTile(snapshot, tile, accelerator) {
    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    const xStep = tile.scale * spanX / snapshot.viewport.width;
    const yStep = -tile.scale * spanY / snapshot.viewport.height;
    const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
    const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
    const count = snapshotChainCount(snapshot);
    const zeroSeed = snapshot.chainMode === 'zero_seed';
    const a0r = accelerator.coeffsRe[0] || 0;
    const a0i = accelerator.coeffsIm[0] || 0;
    const a1r = accelerator.coeffsRe[1] || 0;
    const a1i = accelerator.coeffsIm[1] || 0;
    const a2r = accelerator.coeffsRe[2] || 0;
    const a2i = accelerator.coeffsIm[2] || 0;
    const br = accelerator.cCoeffRe;
    const bi = accelerator.cCoeffIm;
    const hasParameter = accelerator.hasParameter;
    const colors = colorContext(snapshot);

    for (let y = 0; y < tile.height; y += 1) {
        const ci = yStart + y * yStep;
        for (let x = 0; x < tile.width; x += 1) {
            const cr = xStart + x * xStep;
            const paramRe = hasParameter ? br * cr - bi * ci : 0;
            const paramIm = hasParameter ? br * ci + bi * cr : 0;
            let zr = zeroSeed ? 0 : cr;
            let zi = zeroSeed ? 0 : ci;
            let smoothIteration = count;
            let escaped = false;

            for (let i = 0; i < count; i += 1) {
                const z2r = zr * zr - zi * zi;
                const z2i = 2 * zr * zi;
                const nr = a2r * z2r - a2i * z2i + a1r * zr - a1i * zi + a0r + paramRe;
                const ni = a2r * z2i + a2i * z2r + a1r * zi + a1i * zr + a0i + paramIm;
                const magSq = nr * nr + ni * ni;
                const absRe = nr < 0 ? -nr : nr;
                const absIm = ni < 0 ? -ni : ni;
                const tooLarge = magSq > DYNAMICS_ESCAPE_RADIUS_SQ ||
                    absRe >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                    absIm >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE;

                if (nr !== nr || ni !== ni || tooLarge) {
                    const magnitude = Math.sqrt(Math.max(magSq, DYNAMICS_ESCAPE_RADIUS));
                    smoothIteration = i + 1;
                    if (finite(magnitude) && magnitude > 1.0001) {
                        const smoothAdjust = Math.log(
                            Math.max(Math.log(magnitude) / Math.log(DYNAMICS_ESCAPE_RADIUS), 1e-6)
                        ) / Math.LN2;
                        smoothIteration = Math.max(0, Math.min(count, smoothIteration - smoothAdjust));
                    }
                    escaped = true;
                    break;
                }

                zr = nr;
                zi = ni;
            }

            const idx = (y * tile.width + x) * 4;
            if (escaped) {
                writeDynamicsEscapeColorWithContext(data, idx, smoothIteration, count, colors);
            } else {
                writeBlack(data, idx);
            }
        }
    }

    return data;
}

function renderQuadraticPolynomialParameterValueTile(snapshot, tile, accelerator) {
    const mode = snapshot.chainMode || 'recursion';
    if (mode !== 'recursion' && mode !== 'zero_seed') return null;

    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    const xStep = tile.scale * spanX / snapshot.viewport.width;
    const yStep = -tile.scale * spanY / snapshot.viewport.height;
    const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
    const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
    const count = snapshotChainCount(snapshot);
    const zeroSeed = mode === 'zero_seed';
    const a0r = accelerator.coeffsRe[0] || 0;
    const a0i = accelerator.coeffsIm[0] || 0;
    const a1r = accelerator.coeffsRe[1] || 0;
    const a1i = accelerator.coeffsIm[1] || 0;
    const a2r = accelerator.coeffsRe[2] || 0;
    const a2i = accelerator.coeffsIm[2] || 0;
    const br = accelerator.cCoeffRe;
    const bi = accelerator.cCoeffIm;
    const hasParameter = accelerator.hasParameter;
    const colors = colorContext(snapshot);

    for (let y = 0; y < tile.height; y += 1) {
        const ci = yStart + y * yStep;
        for (let x = 0; x < tile.width; x += 1) {
            const cr = xStart + x * xStep;
            const paramRe = hasParameter ? br * cr - bi * ci : 0;
            const paramIm = hasParameter ? br * ci + bi * cr : 0;
            let zr = zeroSeed ? 0 : cr;
            let zi = zeroSeed ? 0 : ci;
            let lastRe = NaN;
            let lastIm = NaN;
            const iterations = snapshot.chainingEnabled || zeroSeed ? count : 1;

            for (let i = 0; i < iterations; i += 1) {
                const z2r = zr * zr - zi * zi;
                const z2i = 2 * zr * zi;
                const nr = a2r * z2r - a2i * z2i + a1r * zr - a1i * zi + a0r + paramRe;
                const ni = a2r * z2i + a2i * z2r + a1r * zi + a1i * zr + a0i + paramIm;
                if (!finite(nr) || !finite(ni)) break;

                zr = nr;
                zi = ni;
                lastRe = nr;
                lastIm = ni;
                if ((nr < 0 ? -nr : nr) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                    (ni < 0 ? -ni : ni) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) break;
            }

            writeDomainColorWithContext(data, (y * tile.width + x) * 4, lastRe, lastIm, colors);
        }
    }

    return data;
}

function renderPolynomialParameterTile(snapshot, tile, accelerator) {
    if (accelerator.type !== 'polynomial-parameter') return null;
    if (!snapshotUsesValueColoring(snapshot) && !snapshotUsesEscapeColoring(snapshot)) return null;
    if (accelerator.degree === 2) {
        return snapshotUsesEscapeColoring(snapshot)
            ? renderQuadraticPolynomialParameterOrbitTile(snapshot, tile, accelerator)
            : renderQuadraticPolynomialParameterValueTile(snapshot, tile, accelerator);
    }
    if (snapshotUsesEscapeColoring(snapshot)) {
        return renderPolynomialParameterOrbitTile(snapshot, tile, accelerator);
    }
    return renderPolynomialParameterValueTile(snapshot, tile, accelerator);
}

function renderQuadraticMonomialParameterOrbitTile(snapshot, tile, accelerator) {
    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    const xStep = tile.scale * spanX / snapshot.viewport.width;
    const yStep = -tile.scale * spanY / snapshot.viewport.height;
    const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
    const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
    const count = snapshotChainCount(snapshot);
    const zeroSeed = snapshot.chainMode === 'zero_seed';
    const ar = accelerator.monomialCoeffRe;
    const ai = accelerator.monomialCoeffIm;
    const br = accelerator.cCoeffRe;
    const bi = accelerator.cCoeffIm;
    const colors = colorContext(snapshot);

    for (let y = 0; y < tile.height; y += 1) {
        const ci = yStart + y * yStep;
        for (let x = 0; x < tile.width; x += 1) {
            const cr = xStart + x * xStep;
            const paramRe = br * cr - bi * ci;
            const paramIm = br * ci + bi * cr;
            const idx = (y * tile.width + x) * 4;
            if (zeroSeed && ar === 1 && ai === 0 && definitelyInsideUnitQuadraticCardioidOrBulb(paramRe, paramIm)) {
                writeBlack(data, idx);
                continue;
            }

            let zr = zeroSeed ? 0 : cr;
            let zi = zeroSeed ? 0 : ci;
            let smoothIteration = count;
            let escaped = false;

            for (let i = 0; i < count; i += 1) {
                const z2r = zr * zr - zi * zi;
                const z2i = 2 * zr * zi;
                const nr = ar * z2r - ai * z2i + paramRe;
                const ni = ar * z2i + ai * z2r + paramIm;
                const magSq = nr * nr + ni * ni;
                const absRe = nr < 0 ? -nr : nr;
                const absIm = ni < 0 ? -ni : ni;
                const tooLarge = magSq > DYNAMICS_ESCAPE_RADIUS_SQ ||
                    absRe >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                    absIm >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE;

                if (nr !== nr || ni !== ni || tooLarge) {
                    const magnitude = Math.sqrt(Math.max(magSq, DYNAMICS_ESCAPE_RADIUS));
                    smoothIteration = i + 1;
                    if (finite(magnitude) && magnitude > 1.0001) {
                        const smoothAdjust = Math.log(
                            Math.max(Math.log(magnitude) / Math.log(DYNAMICS_ESCAPE_RADIUS), 1e-6)
                        ) / Math.LN2;
                        smoothIteration = Math.max(0, Math.min(count, smoothIteration - smoothAdjust));
                    }
                    escaped = true;
                    break;
                }

                zr = nr;
                zi = ni;
            }

            if (escaped) {
                writeDynamicsEscapeColorWithContext(data, idx, smoothIteration, count, colors);
            } else {
                writeBlack(data, idx);
            }
        }
    }

    return data;
}

function renderQuadraticMonomialParameterValueTile(snapshot, tile, accelerator) {
    const mode = snapshot.chainMode || 'recursion';
    if (mode !== 'recursion' && mode !== 'zero_seed') return null;

    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    const xStep = tile.scale * spanX / snapshot.viewport.width;
    const yStep = -tile.scale * spanY / snapshot.viewport.height;
    const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
    const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
    const count = snapshotChainCount(snapshot);
    const zeroSeed = mode === 'zero_seed';
    const ar = accelerator.monomialCoeffRe;
    const ai = accelerator.monomialCoeffIm;
    const br = accelerator.cCoeffRe;
    const bi = accelerator.cCoeffIm;
    const colors = colorContext(snapshot);

    for (let y = 0; y < tile.height; y += 1) {
        const ci = yStart + y * yStep;
        for (let x = 0; x < tile.width; x += 1) {
            const cr = xStart + x * xStep;
            const paramRe = br * cr - bi * ci;
            const paramIm = br * ci + bi * cr;
            let zr = zeroSeed ? 0 : cr;
            let zi = zeroSeed ? 0 : ci;
            let lastRe = NaN;
            let lastIm = NaN;
            const iterations = snapshot.chainingEnabled || zeroSeed ? count : 1;

            for (let i = 0; i < iterations; i += 1) {
                const z2r = zr * zr - zi * zi;
                const z2i = 2 * zr * zi;
                const nr = ar * z2r - ai * z2i + paramRe;
                const ni = ar * z2i + ai * z2r + paramIm;
                if (!finite(nr) || !finite(ni)) break;

                zr = nr;
                zi = ni;
                lastRe = nr;
                lastIm = ni;
                if ((nr < 0 ? -nr : nr) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                    (ni < 0 ? -ni : ni) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) break;
            }

            writeDomainColorWithContext(data, (y * tile.width + x) * 4, lastRe, lastIm, colors);
        }
    }

    return data;
}

function renderPositiveMonomialParameterOrbitTile(snapshot, tile, accelerator) {
    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    const xStep = tile.scale * spanX / snapshot.viewport.width;
    const yStep = -tile.scale * spanY / snapshot.viewport.height;
    const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
    const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
    const count = snapshotChainCount(snapshot);
    const zeroSeed = snapshot.chainMode === 'zero_seed';
    const exponent = accelerator.monomialExponent;
    const ar = accelerator.monomialCoeffRe;
    const ai = accelerator.monomialCoeffIm;
    const br = accelerator.cCoeffRe;
    const bi = accelerator.cCoeffIm;
    const colors = colorContext(snapshot);

    for (let y = 0; y < tile.height; y += 1) {
        const ci = yStart + y * yStep;
        for (let x = 0; x < tile.width; x += 1) {
            const cr = xStart + x * xStep;
            const paramRe = br * cr - bi * ci;
            const paramIm = br * ci + bi * cr;
            const idx = (y * tile.width + x) * 4;
            if (zeroSeed && exponent === 2 && ar === 1 && ai === 0 &&
                definitelyInsideUnitQuadraticCardioidOrBulb(paramRe, paramIm)) {
                writeBlack(data, idx);
                continue;
            }
            let zr = zeroSeed ? 0 : cr;
            let zi = zeroSeed ? 0 : ci;
            let smoothIteration = count;
            let escaped = false;

            for (let i = 0; i < count; i += 1) {
                let pr;
                let pi;
                if (exponent === 2) {
                    pr = zr * zr - zi * zi;
                    pi = 2 * zr * zi;
                } else if (exponent === 3) {
                    const zr2 = zr * zr;
                    const zi2 = zi * zi;
                    pr = zr * (zr2 - 3 * zi2);
                    pi = zi * (3 * zr2 - zi2);
                } else if (exponent === 4) {
                    const zr2 = zr * zr;
                    const zi2 = zi * zi;
                    const zri = zr * zi;
                    pr = zr2 * zr2 - 6 * zr2 * zi2 + zi2 * zi2;
                    pi = 4 * zri * (zr2 - zi2);
                } else if (exponent === 1) {
                    pr = zr;
                    pi = zi;
                } else {
                    pr = 1;
                    pi = 0;
                }

                const nr = ar * pr - ai * pi + paramRe;
                const ni = ar * pi + ai * pr + paramIm;
                const magSq = nr * nr + ni * ni;
                const absRe = nr < 0 ? -nr : nr;
                const absIm = ni < 0 ? -ni : ni;
                const tooLarge = magSq > DYNAMICS_ESCAPE_RADIUS_SQ ||
                    absRe >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                    absIm >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE;

                if (nr !== nr || ni !== ni || tooLarge) {
                    const magnitude = Math.sqrt(Math.max(magSq, DYNAMICS_ESCAPE_RADIUS));
                    smoothIteration = i + 1;
                    if (finite(magnitude) && magnitude > 1.0001) {
                        const smoothAdjust = Math.log(
                            Math.max(Math.log(magnitude) / Math.log(DYNAMICS_ESCAPE_RADIUS), 1e-6)
                        ) / Math.LN2;
                        smoothIteration = Math.max(0, Math.min(count, smoothIteration - smoothAdjust));
                    }
                    escaped = true;
                    break;
                }

                zr = nr;
                zi = ni;
            }

            if (escaped) {
                writeDynamicsEscapeColorWithContext(data, idx, smoothIteration, count, colors);
            } else {
                writeBlack(data, idx);
            }
        }
    }

    return data;
}

function renderPositiveMonomialParameterValueTile(snapshot, tile, accelerator) {
    const mode = snapshot.chainMode || 'recursion';
    if (mode !== 'recursion' && mode !== 'zero_seed') return null;

    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    const xStep = tile.scale * spanX / snapshot.viewport.width;
    const yStep = -tile.scale * spanY / snapshot.viewport.height;
    const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
    const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
    const count = snapshotChainCount(snapshot);
    const zeroSeed = mode === 'zero_seed';
    const exponent = accelerator.monomialExponent;
    const ar = accelerator.monomialCoeffRe;
    const ai = accelerator.monomialCoeffIm;
    const br = accelerator.cCoeffRe;
    const bi = accelerator.cCoeffIm;
    const colors = colorContext(snapshot);

    for (let y = 0; y < tile.height; y += 1) {
        const ci = yStart + y * yStep;
        for (let x = 0; x < tile.width; x += 1) {
            const cr = xStart + x * xStep;
            const paramRe = br * cr - bi * ci;
            const paramIm = br * ci + bi * cr;
            let zr = zeroSeed ? 0 : cr;
            let zi = zeroSeed ? 0 : ci;
            let lastRe = NaN;
            let lastIm = NaN;
            const iterations = snapshot.chainingEnabled || zeroSeed ? count : 1;

            for (let i = 0; i < iterations; i += 1) {
                let pr;
                let pi;
                if (exponent === 2) {
                    pr = zr * zr - zi * zi;
                    pi = 2 * zr * zi;
                } else if (exponent === 3) {
                    const zr2 = zr * zr;
                    const zi2 = zi * zi;
                    pr = zr * (zr2 - 3 * zi2);
                    pi = zi * (3 * zr2 - zi2);
                } else if (exponent === 4) {
                    const zr2 = zr * zr;
                    const zi2 = zi * zi;
                    const zri = zr * zi;
                    pr = zr2 * zr2 - 6 * zr2 * zi2 + zi2 * zi2;
                    pi = 4 * zri * (zr2 - zi2);
                } else if (exponent === 1) {
                    pr = zr;
                    pi = zi;
                } else {
                    pr = 1;
                    pi = 0;
                }

                const nr = ar * pr - ai * pi + paramRe;
                const ni = ar * pi + ai * pr + paramIm;
                if (!finite(nr) || !finite(ni)) break;

                zr = nr;
                zi = ni;
                lastRe = nr;
                lastIm = ni;
                if ((nr < 0 ? -nr : nr) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                    (ni < 0 ? -ni : ni) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) break;
            }

            writeDomainColorWithContext(data, (y * tile.width + x) * 4, lastRe, lastIm, colors);
        }
    }

    return data;
}

function renderLaurentParameterOrbitTile(snapshot, tile, accelerator) {
    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    const xStep = tile.scale * spanX / snapshot.viewport.width;
    const yStep = -tile.scale * spanY / snapshot.viewport.height;
    const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
    const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
    const count = snapshotChainCount(snapshot);
    const zeroSeed = snapshot.chainMode === 'zero_seed';
    const scratch = new Float64Array(2);
    const colors = colorContext(snapshot);

    for (let y = 0; y < tile.height; y += 1) {
        const ci = yStart + y * yStep;
        for (let x = 0; x < tile.width; x += 1) {
            const cr = xStart + x * xStep;
            let zr = zeroSeed ? 0 : cr;
            let zi = zeroSeed ? 0 : ci;
            let smoothIteration = count;
            let escaped = false;

            for (let i = 0; i < count; i += 1) {
                evaluateLaurentInto(accelerator, zr, zi, cr, ci, scratch);
                const nr = scratch[0];
                const ni = scratch[1];
                const magSq = nr * nr + ni * ni;
                const absRe = nr < 0 ? -nr : nr;
                const absIm = ni < 0 ? -ni : ni;
                const tooLarge = magSq > DYNAMICS_ESCAPE_RADIUS_SQ ||
                    absRe >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                    absIm >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE;

                if (nr !== nr || ni !== ni || tooLarge) {
                    const magnitude = Math.sqrt(Math.max(magSq, DYNAMICS_ESCAPE_RADIUS));
                    smoothIteration = i + 1;
                    if (finite(magnitude) && magnitude > 1.0001) {
                        const smoothAdjust = Math.log(
                            Math.max(Math.log(magnitude) / Math.log(DYNAMICS_ESCAPE_RADIUS), 1e-6)
                        ) / Math.LN2;
                        smoothIteration = Math.max(0, Math.min(count, smoothIteration - smoothAdjust));
                    }
                    escaped = true;
                    break;
                }

                zr = nr;
                zi = ni;
            }

            const idx = (y * tile.width + x) * 4;
            if (escaped) {
                writeDynamicsEscapeColorWithContext(data, idx, smoothIteration, count, colors);
            } else {
                writeBlack(data, idx);
            }
        }
    }

    return data;
}

function renderLaurentParameterValueTile(snapshot, tile, accelerator) {
    const mode = snapshot.chainMode || 'recursion';
    if (mode !== 'recursion' && mode !== 'zero_seed') return null;

    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    const xStep = tile.scale * spanX / snapshot.viewport.width;
    const yStep = -tile.scale * spanY / snapshot.viewport.height;
    const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
    const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
    const count = snapshotChainCount(snapshot);
    const zeroSeed = mode === 'zero_seed';
    const scratch = new Float64Array(2);
    const colors = colorContext(snapshot);

    for (let y = 0; y < tile.height; y += 1) {
        const ci = yStart + y * yStep;
        for (let x = 0; x < tile.width; x += 1) {
            const cr = xStart + x * xStep;
            let zr = zeroSeed ? 0 : cr;
            let zi = zeroSeed ? 0 : ci;
            let lastRe = NaN;
            let lastIm = NaN;
            const iterations = snapshot.chainingEnabled || zeroSeed ? count : 1;

            for (let i = 0; i < iterations; i += 1) {
                evaluateLaurentInto(accelerator, zr, zi, cr, ci, scratch);
                const nr = scratch[0];
                const ni = scratch[1];

                if (!finite(nr) || !finite(ni)) break;

                zr = nr;
                zi = ni;
                lastRe = nr;
                lastIm = ni;
                if ((nr < 0 ? -nr : nr) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                    (ni < 0 ? -ni : ni) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) break;
            }

            writeDomainColorWithContext(data, (y * tile.width + x) * 4, lastRe, lastIm, colors);
        }
    }

    return data;
}

function renderLaurentParameterTile(snapshot, tile, accelerator) {
    if (accelerator.type !== 'laurent-parameter') return null;
    if (!snapshotUsesValueColoring(snapshot) && !snapshotUsesEscapeColoring(snapshot)) return null;
    if (accelerator.isPositiveMonomial) {
        if (accelerator.monomialExponent === 2) {
            return snapshotUsesEscapeColoring(snapshot)
                ? renderQuadraticMonomialParameterOrbitTile(snapshot, tile, accelerator)
                : renderQuadraticMonomialParameterValueTile(snapshot, tile, accelerator);
        }
        return snapshotUsesEscapeColoring(snapshot)
            ? renderPositiveMonomialParameterOrbitTile(snapshot, tile, accelerator)
            : renderPositiveMonomialParameterValueTile(snapshot, tile, accelerator);
    }
    if (snapshotUsesEscapeColoring(snapshot)) {
        return renderLaurentParameterOrbitTile(snapshot, tile, accelerator);
    }
    return renderLaurentParameterValueTile(snapshot, tile, accelerator);
}

function divideComponents(nr, ni, dr, di, out) {
    const absRe = dr < 0 ? -dr : dr;
    const absIm = di < 0 ? -di : di;
    const scale = absRe > absIm ? absRe : absIm;
    if (scale < 1e-15) {
        out[0] = NaN;
        out[1] = NaN;
        return out;
    }
    if (absRe >= absIm) {
        const ratio = di / dr;
        const divisor = dr + di * ratio;
        out[0] = (nr + ni * ratio) / divisor;
        out[1] = (ni - nr * ratio) / divisor;
        return out;
    }
    const ratio = dr / di;
    const divisor = di + dr * ratio;
    out[0] = (nr * ratio + ni) / divisor;
    out[1] = (ni * ratio - nr) / divisor;
    return out;
}

function expComponents(re, im, out) {
    const magnitude = expSafe(re);
    out[0] = magnitude * Math.cos(im);
    out[1] = magnitude * Math.sin(im);
    return out;
}

function lnComponents(re, im, out) {
    if (re === 0 && im === 0) {
        out[0] = -Infinity;
        out[1] = 0;
        return out;
    }
    out[0] = Math.log(Math.hypot(re, im));
    out[1] = Math.atan2(im, re);
    return out;
}

function evaluateBuiltinComponents(functionKey, re, im, snapshot, out) {
    switch (functionKey) {
        case 'exp':
            return expComponents(re, im, out);
        case 'ln':
            return lnComponents(re, im, out);
        case 'sin':
            out[0] = Math.sin(re) * Math.cosh(im);
            out[1] = Math.cos(re) * Math.sinh(im);
            return out;
        case 'cos':
            out[0] = Math.cos(re) * Math.cosh(im);
            out[1] = -Math.sin(re) * Math.sinh(im);
            return out;
        case 'tan': {
            const sinRe = Math.sin(re) * Math.cosh(im);
            const sinIm = Math.cos(re) * Math.sinh(im);
            const cosRe = Math.cos(re) * Math.cosh(im);
            const cosIm = -Math.sin(re) * Math.sinh(im);
            return divideComponents(sinRe, sinIm, cosRe, cosIm, out);
        }
        case 'sec': {
            const cosRe = Math.cos(re) * Math.cosh(im);
            const cosIm = -Math.sin(re) * Math.sinh(im);
            return divideComponents(1, 0, cosRe, cosIm, out);
        }
        case 'reciprocal':
            return divideComponents(1, 0, re, im, out);
        case 'sinh':
            out[0] = Math.sinh(re) * Math.cos(im);
            out[1] = Math.cosh(re) * Math.sin(im);
            return out;
        case 'cosh':
            out[0] = Math.cosh(re) * Math.cos(im);
            out[1] = Math.sinh(re) * Math.sin(im);
            return out;
        case 'tanh': {
            const sinhRe = Math.sinh(re) * Math.cos(im);
            const sinhIm = Math.cosh(re) * Math.sin(im);
            const coshRe = Math.cosh(re) * Math.cos(im);
            const coshIm = Math.sinh(re) * Math.sin(im);
            return divideComponents(sinhRe, sinhIm, coshRe, coshIm, out);
        }
        case 'power': {
            const exponent = Number(snapshot.fractionalPowerN ?? DEFAULT_FRACTIONAL_POWER);
            lnComponents(re, im, out);
            return expComponents(out[0] * exponent, out[1] * exponent, out);
        }
        case 'mobius': {
            const a = snapshot.mobiusA;
            const b = snapshot.mobiusB;
            const c = snapshot.mobiusC;
            const d = snapshot.mobiusD;
            const ar = scalarRe(a);
            const ai = scalarIm(a);
            const br = scalarRe(b);
            const bi = scalarIm(b);
            const cr = scalarRe(c);
            const ci = scalarIm(c);
            const dr = scalarRe(d);
            const di = scalarIm(d);
            const nr = ar * re - ai * im + br;
            const ni = ar * im + ai * re + bi;
            const denRe = cr * re - ci * im + dr;
            const denIm = cr * im + ci * re + di;
            return divideComponents(nr, ni, denRe, denIm, out);
        }
        case 'polynomial': {
            const degree = Math.max(0, Math.floor(Number(snapshot.polynomialN) || 0));
            const coeffs = snapshot.polynomialCoeffs;
            let zr = scalarRe(coeffs?.[degree]);
            let zi = scalarIm(coeffs?.[degree]);
            for (let k = degree - 1; k >= 0; k -= 1) {
                const coeff = coeffs?.[k];
                const nextRe = zr * re - zi * im + scalarRe(coeff);
                zi = zr * im + zi * re + scalarIm(coeff);
                zr = nextRe;
            }
            out[0] = zr;
            out[1] = zi;
            return out;
        }
        case 'poincare':
            if (im <= 1e-9) {
                out[0] = NaN;
                out[1] = NaN;
                return out;
            }
            out[1] = Math.sqrt(im);
            out[0] = re / out[1];
            return out;
        case 'zeta':
            return zetaComponents(re, im, !!snapshot.zetaContinuationEnabled, out);
        case 'c':
            out[0] = re;
            out[1] = im;
            return out;
        default:
            return null;
    }
}

function renderCompiledAlgebraicValueTile(snapshot, tile, accelerator) {
    if (!snapshotUsesValueColoring(snapshot) || accelerator.type !== 'compiled-algebraic') return null;
    const mode = snapshot.chainMode || 'recursion';
    if (mode !== 'recursion' && mode !== 'zero_seed') return null;

    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    const xStep = tile.scale * spanX / snapshot.viewport.width;
    const yStep = -tile.scale * spanY / snapshot.viewport.height;
    const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
    const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
    const count = snapshotChainCount(snapshot);
    const colors = colorContext(snapshot);
    const scratch = accelerator.scratch;

    for (let y = 0; y < tile.height; y += 1) {
        const ci = yStart + y * yStep;
        for (let x = 0; x < tile.width; x += 1) {
            const cr = xStart + x * xStep;
            let currentRe;
            let currentIm;
            let lastRe = NaN;
            let lastIm = NaN;

            if (!snapshot.chainingEnabled || (count <= 1 && mode !== 'zero_seed')) {
                evaluateCompiledAlgebraicInto(accelerator, cr, ci, cr, ci, scratch);
                currentRe = scratch[0];
                currentIm = scratch[1];
                if (currentRe === currentRe && currentIm === currentIm && finite(currentRe) && finite(currentIm)) {
                    lastRe = currentRe;
                    lastIm = currentIm;
                }
            } else if (mode === 'zero_seed') {
                currentRe = 0;
                currentIm = 0;
                for (let i = 0; i < count; i += 1) {
                    evaluateCompiledAlgebraicInto(accelerator, currentRe, currentIm, cr, ci, scratch);
                    currentRe = scratch[0];
                    currentIm = scratch[1];
                    if (!(currentRe === currentRe && currentIm === currentIm && finite(currentRe) && finite(currentIm))) break;
                    lastRe = currentRe;
                    lastIm = currentIm;
                    if ((currentRe < 0 ? -currentRe : currentRe) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                        (currentIm < 0 ? -currentIm : currentIm) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) break;
                }
            } else {
                evaluateCompiledAlgebraicInto(accelerator, cr, ci, cr, ci, scratch);
                currentRe = scratch[0];
                currentIm = scratch[1];
                if (currentRe === currentRe && currentIm === currentIm && finite(currentRe) && finite(currentIm)) {
                    lastRe = currentRe;
                    lastIm = currentIm;
                    if (!((currentRe < 0 ? -currentRe : currentRe) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                        (currentIm < 0 ? -currentIm : currentIm) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE)) {
                        for (let i = 1; i < count; i += 1) {
                            evaluateCompiledAlgebraicInto(accelerator, currentRe, currentIm, cr, ci, scratch);
                            currentRe = scratch[0];
                            currentIm = scratch[1];
                            if (!(currentRe === currentRe && currentIm === currentIm && finite(currentRe) && finite(currentIm))) break;
                            lastRe = currentRe;
                            lastIm = currentIm;
                            if ((currentRe < 0 ? -currentRe : currentRe) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                                (currentIm < 0 ? -currentIm : currentIm) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) break;
                        }
                    }
                }
            }

            writeDomainColorWithContext(data, (y * tile.width + x) * 4, lastRe, lastIm, colors);
        }
    }

    return data;
}

function renderCompiledAlgebraicOrbitTile(snapshot, tile, accelerator) {
    if (!snapshotUsesEscapeColoring(snapshot) || accelerator.type !== 'compiled-algebraic') return null;
    const mode = snapshot.chainMode || 'recursion';
    if (mode !== 'recursion' && mode !== 'zero_seed') return null;

    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    const xStep = tile.scale * spanX / snapshot.viewport.width;
    const yStep = -tile.scale * spanY / snapshot.viewport.height;
    const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
    const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
    const count = snapshotChainCount(snapshot);
    const zeroSeed = mode === 'zero_seed';
    const colors = colorContext(snapshot);
    const scratch = accelerator.scratch;

    for (let y = 0; y < tile.height; y += 1) {
        const ci = yStart + y * yStep;
        for (let x = 0; x < tile.width; x += 1) {
            const cr = xStart + x * xStep;
            let zr = zeroSeed ? 0 : cr;
            let zi = zeroSeed ? 0 : ci;
            let smoothIteration = count;
            let escaped = false;

            for (let i = 0; i < count; i += 1) {
                evaluateCompiledAlgebraicInto(accelerator, zr, zi, cr, ci, scratch);
                const nr = scratch[0];
                const ni = scratch[1];
                const magSq = nr * nr + ni * ni;
                const absRe = nr < 0 ? -nr : nr;
                const absIm = ni < 0 ? -ni : ni;
                const tooLarge = magSq > DYNAMICS_ESCAPE_RADIUS_SQ ||
                    absRe >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                    absIm >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE;

                if (nr !== nr || ni !== ni || tooLarge) {
                    const magnitude = Math.sqrt(Math.max(magSq, DYNAMICS_ESCAPE_RADIUS));
                    smoothIteration = i + 1;
                    if (finite(magnitude) && magnitude > 1.0001) {
                        const smoothAdjust = Math.log(
                            Math.max(Math.log(magnitude) / Math.log(DYNAMICS_ESCAPE_RADIUS), 1e-6)
                        ) / Math.LN2;
                        smoothIteration = Math.max(0, Math.min(count, smoothIteration - smoothAdjust));
                    }
                    escaped = true;
                    break;
                }

                zr = nr;
                zi = ni;
            }

            const idx = (y * tile.width + x) * 4;
            if (escaped) {
                writeDynamicsEscapeColorWithContext(data, idx, smoothIteration, count, colors);
            } else {
                writeBlack(data, idx);
            }
        }
    }

    return data;
}

function renderCompiledAlgebraicTile(snapshot, tile, accelerator) {
    if (accelerator.type !== 'compiled-algebraic') return null;
    if (!snapshotUsesValueColoring(snapshot) && !snapshotUsesEscapeColoring(snapshot)) return null;
    return snapshotUsesEscapeColoring(snapshot)
        ? renderCompiledAlgebraicOrbitTile(snapshot, tile, accelerator)
        : renderCompiledAlgebraicValueTile(snapshot, tile, accelerator);
}


function directPolynomialCoefficientArrays(snapshot) {
    const degree = Math.max(0, Math.floor(Number(snapshot.polynomialN) || 0));
    const source = snapshot.polynomialCoeffs;
    const coeffsRe = new Float64Array(degree + 1);
    const coeffsIm = new Float64Array(degree + 1);
    for (let k = 0; k <= degree; k += 1) {
        const coeff = source?.[k];
        coeffsRe[k] = scalarRe(coeff);
        coeffsIm[k] = scalarIm(coeff);
    }
    return { degree, coeffsRe, coeffsIm };
}

function renderDirectPolynomialValueTile(snapshot, tile) {
    if (snapshot.functionKey !== 'polynomial' || !snapshotUsesValueColoring(snapshot)) return null;
    const mode = snapshot.chainMode || 'recursion';
    if (mode !== 'recursion' && mode !== 'zero_seed') return null;

    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    const xStep = tile.scale * spanX / snapshot.viewport.width;
    const yStep = -tile.scale * spanY / snapshot.viewport.height;
    const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
    const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
    const count = snapshotChainCount(snapshot);
    const iterations = snapshot.chainingEnabled || mode === 'zero_seed' ? count : 1;
    const zeroSeed = mode === 'zero_seed';
    const { degree, coeffsRe, coeffsIm } = directPolynomialCoefficientArrays(snapshot);
    const colors = colorContext(snapshot);
    const width = tile.width;
    let idx = 0;

    for (let y = 0; y < tile.height; y += 1) {
        const ci = yStart + y * yStep;
        let cr = xStart;
        for (let x = 0; x < width; x += 1, cr += xStep, idx += 4) {
            let zr = zeroSeed ? 0 : cr;
            let zi = zeroSeed ? 0 : ci;
            let lastRe = NaN;
            let lastIm = NaN;

            for (let i = 0; i < iterations; i += 1) {
                let nr = coeffsRe[degree];
                let ni = coeffsIm[degree];
                for (let k = degree - 1; k >= 0; k -= 1) {
                    const tr = nr * zr - ni * zi + coeffsRe[k];
                    ni = nr * zi + ni * zr + coeffsIm[k];
                    nr = tr;
                }

                if (!(nr === nr && ni === ni && finite(nr) && finite(ni))) break;
                zr = nr;
                zi = ni;
                lastRe = nr;
                lastIm = ni;
                if ((nr < 0 ? -nr : nr) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                    (ni < 0 ? -ni : ni) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) break;
            }

            writeDomainColorWithContext(data, idx, lastRe, lastIm, colors);
        }
    }

    return data;
}


function renderDirectMobiusValueTile(snapshot, tile) {
    if (snapshot.functionKey !== 'mobius' || !snapshotUsesValueColoring(snapshot)) return null;
    const mode = snapshot.chainMode || 'recursion';
    if (mode !== 'recursion') return null;

    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    const xStep = tile.scale * spanX / snapshot.viewport.width;
    const yStep = -tile.scale * spanY / snapshot.viewport.height;
    const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
    const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
    const iterations = snapshot.chainingEnabled ? snapshotChainCount(snapshot) : 1;
    const ar = scalarRe(snapshot.mobiusA);
    const ai = scalarIm(snapshot.mobiusA);
    const br = scalarRe(snapshot.mobiusB);
    const bi = scalarIm(snapshot.mobiusB);
    const mr = scalarRe(snapshot.mobiusC);
    const mi = scalarIm(snapshot.mobiusC);
    const dr = scalarRe(snapshot.mobiusD);
    const di = scalarIm(snapshot.mobiusD);
    const colors = colorContext(snapshot);
    const scratch = new Float64Array(2);
    const width = tile.width;
    let idx = 0;

    for (let y = 0; y < tile.height; y += 1) {
        const ci = yStart + y * yStep;
        let cr = xStart;
        for (let x = 0; x < width; x += 1, cr += xStep, idx += 4) {
            let zr = cr;
            let zi = ci;
            let lastRe = NaN;
            let lastIm = NaN;
            for (let i = 0; i < iterations; i += 1) {
                const nr = ar * zr - ai * zi + br;
                const ni = ar * zi + ai * zr + bi;
                const denRe = mr * zr - mi * zi + dr;
                const denIm = mr * zi + mi * zr + di;
                divideComponents(nr, ni, denRe, denIm, scratch);
                zr = scratch[0];
                zi = scratch[1];
                if (!(zr === zr && zi === zi && finite(zr) && finite(zi))) break;
                lastRe = zr;
                lastIm = zi;
                if ((zr < 0 ? -zr : zr) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                    (zi < 0 ? -zi : zi) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) break;
            }
            writeDomainColorWithContext(data, idx, lastRe, lastIm, colors);
        }
    }

    return data;
}

function renderDirectZetaValueTile(snapshot, tile) {
    if (snapshot.functionKey !== 'zeta' || !snapshotUsesValueColoring(snapshot)) return null;
    const mode = snapshot.chainMode || 'recursion';
    if (mode !== 'recursion') return null;
    if (snapshot.chainingEnabled && snapshotChainCount(snapshot) > 1) return null;

    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    const xStep = tile.scale * spanX / snapshot.viewport.width;
    const yStep = -tile.scale * spanY / snapshot.viewport.height;
    const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
    const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
    const width = tile.width;
    const height = tile.height;
    const colors = colorContext(snapshot);
    const continuation = !!snapshot.zetaContinuationEnabled;

    // ζ(s) is separable per term: exp(-x log n) · cis(-y log n).  Tiles vary x by
    // column and y by row, so cache the expensive transcendental pieces once per
    // column/row instead of inside every pixel×series-term iteration.
    const termCount = continuation ? NUM_ZETA_HASSE_LEVELS : NUM_ZETA_TERMS_DIRECT_SUM;
    const coeffs = continuation ? zetaHasseCollapsedTerms(NUM_ZETA_HASSE_LEVELS).coeffs : null;
    const logs = continuation ? zetaHasseCollapsedTerms(NUM_ZETA_HASSE_LEVELS).logs : null;
    if (!continuation) ensureZetaLogIntegerCache(NUM_ZETA_TERMS_DIRECT_SUM);

    const magByX = new Float64Array(width * termCount);
    const cosSinByY = new Float64Array(height * termCount * 2);

    for (let x = 0; x < width; x += 1) {
        const re = xStart + x * xStep;
        const base = x * termCount;
        for (let t = 0; t < termCount; t += 1) {
            const logN = continuation ? logs[t] : zetaLogIntegerCache[t + 1];
            const coeff = continuation ? coeffs[t] : 1;
            magByX[base + t] = coeff * expSafe(-re * logN);
        }
    }

    for (let y = 0; y < height; y += 1) {
        const im = yStart + y * yStep;
        const base = y * termCount * 2;
        for (let t = 0; t < termCount; t += 1) {
            const logN = continuation ? logs[t] : zetaLogIntegerCache[t + 1];
            const angle = -im * logN;
            cosSinByY[base + (t << 1)] = Math.cos(angle);
            cosSinByY[base + (t << 1) + 1] = Math.sin(angle);
        }
    }

    const log2 = Math.log(2);
    const denMagX = continuation ? new Float64Array(width) : null;
    const denCosSinY = continuation ? new Float64Array(height * 2) : null;
    if (continuation) {
        for (let x = 0; x < width; x += 1) denMagX[x] = expSafe((1 - (xStart + x * xStep)) * log2);
        for (let y = 0; y < height; y += 1) {
            const angle = -(yStart + y * yStep) * log2;
            denCosSinY[y << 1] = Math.cos(angle);
            denCosSinY[(y << 1) + 1] = Math.sin(angle);
        }
    }

    let idx = 0;
    const scratch = continuation ? new Float64Array(2) : null;
    for (let y = 0; y < height; y += 1) {
        const phaseBase = y * termCount * 2;
        let re = xStart;
        for (let x = 0; x < width; x += 1, re += xStep, idx += 4) {
            if (!continuation && re <= ZETA_REFLECTION_POINT_RE) {
                writeBlack(data, idx);
                continue;
            }

            const magBase = x * termCount;
            let sumRe = 0;
            let sumIm = 0;
            for (let t = 0; t < termCount; t += 1) {
                const magnitude = magByX[magBase + t];
                const phase = phaseBase + (t << 1);
                sumRe += magnitude * cosSinByY[phase];
                sumIm += magnitude * cosSinByY[phase + 1];
            }

            if (continuation) {
                const denMag = denMagX[x];
                const denPhase = y << 1;
                const denRe = 1 - denMag * denCosSinY[denPhase];
                const denIm = -denMag * denCosSinY[denPhase + 1];
                if (denRe * denRe + denIm * denIm < 1e-28) {
                    zetaComponents(re, yStart + y * yStep, true, scratch);
                    sumRe = scratch[0];
                    sumIm = scratch[1];
                } else {
                    divideComponents(sumRe, sumIm, denRe, denIm, scratch);
                    sumRe = scratch[0];
                    sumIm = scratch[1];
                }
            }

            writeDomainColorWithContext(data, idx, sumRe, sumIm, colors);
        }
    }

    return data;
}

function renderBuiltinValueTile(snapshot, tile, accelerator) {
    if (!snapshotUsesValueColoring(snapshot) || accelerator.type !== 'none') return null;
    const mode = snapshot.chainMode || 'recursion';
    if (mode !== 'recursion' && mode !== 'zero_seed') return null;
    if (!evaluateBuiltinComponents(snapshot.functionKey, 0.125, -0.25, snapshot, [0, 0])) return null;

    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    const xStep = tile.scale * spanX / snapshot.viewport.width;
    const yStep = -tile.scale * spanY / snapshot.viewport.height;
    const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
    const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
    const count = snapshotChainCount(snapshot);
    const colors = colorContext(snapshot);
    const scratch = new Float64Array(2);

    for (let y = 0; y < tile.height; y += 1) {
        const ci = yStart + y * yStep;
        for (let x = 0; x < tile.width; x += 1) {
            const cr = xStart + x * xStep;
            let currentRe;
            let currentIm;
            let lastRe = NaN;
            let lastIm = NaN;

            if (!snapshot.chainingEnabled || (count <= 1 && mode !== 'zero_seed')) {
                evaluateBuiltinComponents(snapshot.functionKey, cr, ci, snapshot, scratch);
                currentRe = scratch[0];
                currentIm = scratch[1];
                if (currentRe === currentRe && currentIm === currentIm && finite(currentRe) && finite(currentIm)) {
                    lastRe = currentRe;
                    lastIm = currentIm;
                }
            } else if (mode === 'zero_seed') {
                currentRe = 0;
                currentIm = 0;
                for (let i = 0; i < count; i += 1) {
                    evaluateBuiltinComponents(snapshot.functionKey, currentRe, currentIm, snapshot, scratch);
                    currentRe = scratch[0];
                    currentIm = scratch[1];
                    if (!(currentRe === currentRe && currentIm === currentIm && finite(currentRe) && finite(currentIm))) break;
                    lastRe = currentRe;
                    lastIm = currentIm;
                    if ((currentRe < 0 ? -currentRe : currentRe) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                        (currentIm < 0 ? -currentIm : currentIm) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) break;
                }
            } else {
                evaluateBuiltinComponents(snapshot.functionKey, cr, ci, snapshot, scratch);
                currentRe = scratch[0];
                currentIm = scratch[1];
                if (currentRe === currentRe && currentIm === currentIm && finite(currentRe) && finite(currentIm)) {
                    lastRe = currentRe;
                    lastIm = currentIm;
                    if (!((currentRe < 0 ? -currentRe : currentRe) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                        (currentIm < 0 ? -currentIm : currentIm) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE)) {
                        for (let i = 1; i < count; i += 1) {
                            evaluateBuiltinComponents(snapshot.functionKey, currentRe, currentIm, snapshot, scratch);
                            currentRe = scratch[0];
                            currentIm = scratch[1];
                            if (!(currentRe === currentRe && currentIm === currentIm && finite(currentRe) && finite(currentIm))) break;
                            lastRe = currentRe;
                            lastIm = currentIm;
                            if ((currentRe < 0 ? -currentRe : currentRe) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                                (currentIm < 0 ? -currentIm : currentIm) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) break;
                        }
                    }
                }
            }

            writeDomainColorWithContext(data, (y * tile.width + x) * 4, lastRe, lastIm, colors);
        }
    }

    return data;
}

export function renderDomainDynamicsTile(snapshot, tile, accelerator = createDynamicsAccelerator(snapshot)) {
    const accelerated = renderPolynomialParameterTile(snapshot, tile, accelerator) ||
        renderLaurentParameterTile(snapshot, tile, accelerator) ||
        renderCompiledAlgebraicTile(snapshot, tile, accelerator) ||
        renderDirectPolynomialValueTile(snapshot, tile) ||
        renderDirectMobiusValueTile(snapshot, tile) ||
        renderDirectZetaValueTile(snapshot, tile) ||
        renderBuiltinValueTile(snapshot, tile, accelerator);
    if (accelerated) return accelerated;

    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];

    if (snapshotUsesValueColoring(snapshot)) {
        const colors = colorContext(snapshot);
        for (let y = 0; y < tile.height; y += 1) {
            const sampleY = (tile.y + y + 0.5) * tile.scale;
            const im = yRange[1] - (sampleY / snapshot.viewport.height) * spanY;
            for (let x = 0; x < tile.width; x += 1) {
                const sampleX = (tile.x + x + 0.5) * tile.scale;
                const re = xRange[0] + (sampleX / snapshot.viewport.width) * spanX;
                const value = evaluateDomainDynamicsValue(snapshot, re, im, accelerator);
                writeDomainColorWithContext(data, (y * tile.width + x) * 4, value?.re, value?.im, colors);
            }
        }
        return data;
    }

    for (let y = 0; y < tile.height; y += 1) {
        const sampleY = (tile.y + y + 0.5) * tile.scale;
        const im = yRange[1] - (sampleY / snapshot.viewport.height) * spanY;
        for (let x = 0; x < tile.width; x += 1) {
            const sampleX = (tile.x + x + 0.5) * tile.scale;
            const re = xRange[0] + (sampleX / snapshot.viewport.width) * spanX;
            const rgb = colorDomainDynamicsPoint(snapshot, re, im, accelerator);
            const idx = (y * tile.width + x) * 4;
            data[idx] = rgb[0];
            data[idx + 1] = rgb[1];
            data[idx + 2] = rgb[2];
            data[idx + 3] = 255;
        }
    }

    return data;
}

export function domainDynamicsSignature(snapshot) {
    return JSON.stringify({
        functionKey: snapshot.functionKey,
        chainingEnabled: snapshot.chainingEnabled,
        chainMode: snapshot.chainMode,
        chainCount: snapshot.chainCount,
        orbitColoringMode: snapshot.orbitColoringMode,
        algebraicChainingEnabled: snapshot.algebraicChainingEnabled,
        algebraicChainingTerms: snapshot.algebraicChainingTerms,
        algebraicChainingZExpr: snapshot.algebraicChainingZExpr,
        polynomialN: snapshot.polynomialN,
        polynomialCoeffs: snapshot.polynomialCoeffs,
        mobiusA: snapshot.mobiusA,
        mobiusB: snapshot.mobiusB,
        mobiusC: snapshot.mobiusC,
        mobiusD: snapshot.mobiusD,
        fractionalPowerN: snapshot.fractionalPowerN,
        zetaContinuationEnabled: snapshot.zetaContinuationEnabled,
        style: snapshot.style,
        paletteStops: snapshot.paletteStops,
        viewport: snapshot.viewport
    });
}

export function isDomainDynamicsSnapshot(snapshot) {
    const mode = resolveOrbitColoringMode(snapshot);
    return !!snapshot &&
        !snapshot.isWPlaneColoring &&
        snapshot.chainingEnabled &&
        (snapshot.chainCount > 1 || snapshot.chainMode === 'zero_seed') &&
        (
            mode === ORBIT_COLORING_MODES.value ||
            snapshot.chainMode === 'recursion' ||
            snapshot.chainMode === 'zero_seed'
        );
}
