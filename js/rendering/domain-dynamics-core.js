const ZERO = Object.freeze({ re: 0, im: 0 });
const ONE = Object.freeze({ re: 1, im: 0 });
const TWO_PI = 2 * Math.PI;
const DEFAULT_FRACTIONAL_POWER = 0.5;
const DOMAIN_LIGHTNESS_MIN = 0.34;
const DOMAIN_LIGHTNESS_MAX = 0.72;
const DOMAIN_LIGHTNESS_DETAIL_BASE = 0.72;
const DOMAIN_LIGHTNESS_DETAIL_SCALE = 0.28;
// Squared magnitude is faster than Math.hypot on the color hot path; this guard
// preserves overflow behavior before taking that fast path.
const HYPOT_FAST_OVERFLOW_GUARD = Math.sqrt(Number.MAX_VALUE / 2);
const IS_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;
import { compileExpression } from '../math/expression/evaluator.js';
import { parseExpression } from '../math/expression/parser.js';
import {
    DYNAMICS_ESCAPE_RADIUS_SQ,
    DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE,
    DOMAIN_DYNAMICS_EXPONENT_MAX,
    DOMAIN_DYNAMICS_EXPONENT_MIN,
    DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE,
    domainDynamicsChainBailsOut,
    domainDynamicsLogMagnitude,
    domainDynamicsSmoothIteration,
    isFiniteDomainDynamicsValue,
    normalizeDomainDynamicsChainCount
} from '../constants/domain-dynamics.js';
import {
    ORBIT_COLORING_MODES,
    normalizeOrbitColoringMode
} from '../constants/rendering.js';
import {
    complexAsin,
    complexAtan,
    complexBesselJ,
    complexGamma,
    complexLogGamma
} from '../math-utils.js';
import { generateSequenceBindingSeries } from '../analysis/sequence-bindings.js';

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
const NO_ACCELERATOR = Object.freeze({
    type: 'none',
    // Component evaluation is synchronous and non-reentrant. A module-owned pair
    // removes one typed-array allocation from every public scalar evaluation.
    scratch: new Float64Array(2)
});
const dynamicsAcceleratorCache = new WeakMap();
const dynamicAggregateEvaluatorCache = new WeakMap();
const immutableDynamicsSnapshots = new WeakSet();
const colorContextCache = new WeakMap();
const renderHueLutCache = [];
const RENDER_HUE_LUT_CACHE_LIMIT = 8;
const RENDER_HUE_LUT_SIZE = 4096;
const INV_RENDER_HUE_LUT_SIZE = 1 / RENDER_HUE_LUT_SIZE;
const INV_TWO_PI = 1 / TWO_PI;

// Rendering uses a max-error ~2e-4 rad atan2 approximation. Public scalar color
// helpers retain Math.atan2 exactly; only dense rasterization takes this path.
function fastAtan2(y, x) {
    const ax = x < 0 ? -x : x;
    const ay = y < 0 ? -y : y;
    const max = ax > ay ? ax : ay;
    if (max === 0) return 0;
    const a = (ax < ay ? ax : ay) / max;
    const z = a * a;
    let angle = (((-0.0464964749 * z + 0.15931422) * z - 0.327622764) * z * a) + a;
    if (ay > ax) angle = Math.PI * 0.5 - angle;
    if (x < 0) angle = Math.PI - angle;
    return y < 0 ? -angle : angle;
}

function writePreSaturatedHueColor(data, idx, hue, lightness, context) {
    const scaled = hue * RENDER_HUE_LUT_SIZE;
    let i0 = scaled | 0;
    if (i0 >= RENDER_HUE_LUT_SIZE) i0 = RENDER_HUE_LUT_SIZE - 1;
    const f = scaled - i0;
    const i1 = i0 + 1;
    const base = i0 * 3;
    const next = i1 * 3;
    const lut = context.hueLut;
    const r0 = lut[base];
    const g0 = lut[base + 1];
    const b0 = lut[base + 2];
    const r = r0 + (lut[next] - r0) * f;
    const g = g0 + (lut[next + 1] - g0) * f;
    const b = b0 + (lut[next + 2] - b0) * f;
    let a;
    let bias;
    if (lightness < 0.5) {
        a = lightness * 2;
        bias = 0;
    } else {
        bias = lightness * 2 - 1;
        a = 1 - bias;
    }
    data[idx] = byteFromUnit(a * r + bias);
    data[idx + 1] = byteFromUnit(a * g + bias);
    data[idx + 2] = byteFromUnit(a * b + bias);
    data[idx + 3] = 255;
}

function deepFreeze(value, seen = new WeakSet()) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) {
        return value;
    }

    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    return Object.freeze(value);
}

export function freezeDomainDynamicsSnapshot(snapshot) {
    if (snapshot && typeof snapshot === 'object') {
        deepFreeze(snapshot);
        immutableDynamicsSnapshots.add(snapshot);
    }
    return snapshot;
}

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
    return !!value && isFiniteDomainDynamicsValue(value.re, value.im);
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
    if (x > DOMAIN_DYNAMICS_EXPONENT_MAX) return Math.exp(DOMAIN_DYNAMICS_EXPONENT_MAX);
    if (x < DOMAIN_DYNAMICS_EXPONENT_MIN) return 0;
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

function complexLn(z, snapshot = null) {
    const value = toComplex(z);
    if (value.re === 0 && value.im === 0) return { re: -Infinity, im: 0 };
    let argument = Math.atan2(value.im, value.re);
    if (snapshot?.branchCutType === 'ray') {
        const angle = Number.isFinite(snapshot.branchCutAngle) ? snapshot.branchCutAngle : Math.PI;
        while (argument > angle) argument -= TWO_PI;
        while (argument <= angle - TWO_PI) argument += TWO_PI;
    }
    return {
        re: Math.log(Math.hypot(value.re, value.im)),
        im: argument
    };
}

function complexExpWithBase(z, snapshot) {
    const value = toComplex(z);
    const base = toComplex(snapshot?.expBase ?? { re: Math.E, im: 0 });
    const baseLog = complexLn(base);
    return complexExp({
        re: value.re * baseLog.re - value.im * baseLog.im,
        im: value.re * baseLog.im + value.im * baseLog.re
    });
}

function complexLnWithBase(z, snapshot) {
    const value = toComplex(z);
    const logarithm = complexLn(value, snapshot);
    const baseLog = complexLn(toComplex(snapshot?.logBase ?? { re: Math.E, im: 0 }));
    return complexDivide(logarithm, baseLog);
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

function complexPow(base, exponent, snapshot = null) {
    const b = toComplex(base);
    const e = toComplex(exponent);
    if (b.re === 0 && b.im === 0) {
        if (e.re > 0 || (e.re === 0 && e.im !== 0)) return { re: 0, im: 0 };
        if (e.re === 0 && e.im === 0) return { re: 1, im: 0 };
    }
    if (e.im === 0 && Number.isSafeInteger(e.re)) {
        return complexIntegerPow(b, e.re);
    }
    return complexExp(complexMul(e, complexLn(b, snapshot)));
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
    const value = toComplex(z);
    const sinRe = Math.sin(value.re);
    const cosRe = Math.cos(value.re);
    const sinhIm = Math.sinh(value.im);
    const coshIm = Math.cosh(value.im);
    return complexDivide(
        { re: sinRe * coshIm, im: cosRe * sinhIm },
        { re: cosRe * coshIm, im: -sinRe * sinhIm }
    );
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
    const value = toComplex(z);
    const sinhRe = Math.sinh(value.re);
    const coshRe = Math.cosh(value.re);
    const sinIm = Math.sin(value.im);
    const cosIm = Math.cos(value.im);
    return complexDivide(
        { re: sinhRe * cosIm, im: coshRe * sinIm },
        { re: coshRe * cosIm, im: sinhRe * sinIm }
    );
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
        case 'exp': return complexExpWithBase(z, snapshot);
        case 'ln': return complexLnWithBase(z, snapshot);
        case 'reciprocal': return complexReciprocal(z);
        case 'sinh': return complexSinh(z);
        case 'cosh': return complexCosh(z);
        case 'tanh': return complexTanh(z);
        case 'asin': return complexAsin(z.re, z.im);
        case 'atan': return complexAtan(z.re, z.im);
        case 'gamma': return complexGamma(z.re, z.im);
        case 'loggamma': return complexLogGamma(z.re, z.im);
        case 'bessel': return complexBesselJ(z.re, z.im, snapshot.besselOrder);
        case 'power': return complexPow(z, { re: snapshot.fractionalPowerN ?? DEFAULT_FRACTIONAL_POWER, im: 0 }, snapshot);
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

    if (block.power !== undefined && block.power !== 1) value = complexPow(value, { re: Number(block.power), im: 0 }, snapshot);
    if (block.reciprocal) value = complexReciprocal(value);
    if (block.log) value = complexLnWithBase(value, snapshot);
    if (block.exp) value = complexExpWithBase(value, snapshot);

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
                point = { re: result.re, im: result.im };
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
            hasParameter,
            canonicalUnitQuadratic: degree === 2 && hasParameter &&
                coeffs[0].re === 0 && coeffs[0].im === 0 &&
                coeffs[1].re === 0 && coeffs[1].im === 0 &&
                coeffs[2].re === 1 && coeffs[2].im === 0 &&
                cCoeff.re === 1 && cCoeff.im === 0,
            scratch: new Float64Array(2)
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
            hasParameter,
            scratch: new Float64Array(2)
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
const VMF_ASIN = 17;
const VMF_ATAN = 18;
const VMF_GAMMA = 19;
const VMF_LOGGAMMA = 20;
const VMF_BESSEL = 21;
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
        case 'asin': return VMF_ASIN;
        case 'atan': return VMF_ATAN;
        case 'gamma': return VMF_GAMMA;
        case 'loggamma': return VMF_LOGGAMMA;
        case 'bessel': return VMF_BESSEL;
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

function expressionFunctionCode(name) {
    return vmFunctionCode(name === 'sqrt' ? 'power' : name);
}

function compilePrimitiveExpression(expr) {
    if (!expr || expr === 'z') return null;
    if (expr && typeof expr === 'object') return compilePrimitiveExpressionAst(expr);
    try {
        return compilePrimitiveExpressionAst(parseExpression(String(expr)));
    } catch {
        return null;
    }
}

function compilePrimitiveExpressionAst(node) {
    const output = [];
    function walk(n) {
        if (n === null || n === undefined) return false;
        if (typeof n === 'number') { output.push({ type: 'const', value: n, im: 0 }); return true; }
        if (typeof n === 'string') {
            const name = n.toLowerCase();
            if (name === 'z' || name === 'c') { output.push({ type: name }); return true; }
            if (name === 'i') { output.push({ type: 'const', value: 0, im: 1 }); return true; }
            if (name === 'pi') { output.push({ type: 'const', value: Math.PI, im: 0 }); return true; }
            if (name === 'e') { output.push({ type: 'const', value: Math.E, im: 0 }); return true; }
            return false;
        }
        if (typeof n !== 'object') return false;
        const kind = n.type || n.kind;
        if (kind === 'number' || kind === 'literal' || ('value' in n && typeof n.value === 'number')) {
            const literal = n.value && typeof n.value === 'object' ? n.value : n;
            output.push({
                type: 'const',
                value: Number(literal.re ?? literal.real ?? literal.value),
                im: Number(literal.im ?? literal.imag ?? n.im ?? n.imag ?? 0)
            });
            return true;
        }
        if (kind === 'variable' || kind === 'identifier') {
            const name = String(n.name || n.value || '').toLowerCase();
            return walk(name);
        }
        if (kind === 'group') return walk(n.expression);
        if (kind === 'unary') {
            if (n.op === '+') return walk(n.argument);
            if (n.op !== '-') return false;
            if (!walk(n.argument)) return false;
            output.push({ type: 'op', value: 'neg' });
            return true;
        }
        if (kind === 'postfix') return false;
        if (kind === 'binary') {
            if (!['+', '-', '*', '/', '^'].includes(n.op)) return false;
            if (!walk(n.left) || !walk(n.right)) return false;
            output.push({ type: 'op', value: n.op });
            return true;
        }
        const op = n.op || n.operator;
        if (op && (n.left !== undefined || n.right !== undefined)) {
            if (op === 'neg' || op === 'unary-') {
                if (!walk(n.argument ?? n.right)) return false;
                output.push({ type: 'op', value: 'neg' });
                return true;
            }
            if (!['+', '-', '*', '/', '^'].includes(op)) return false;
            if (!walk(n.left) || !walk(n.right)) return false;
            output.push({ type: 'op', value: op });
            return true;
        }
        const fn = kind === 'call' ? (n.name || n.callee) : (n.func || n.name);
        if (fn) {
            const args = n.args || n.arguments || (n.argument !== undefined ? [n.argument] : []);
            if (args.length !== 1 || !walk(args[0])) return false;
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

function evaluatePrimitiveExpressionInto(expr, zr, zi, cr, ci, out, accelerator = null) {
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
                    evaluatePrimitiveVmFunctionInto(accelerator, args[i] | 0, stackRe[sp - 1], stackIm[sp - 1], cr, ci, expr.scratch);
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
            const sinX = Math.sin(re);
            const cosX = Math.cos(re);
            const sinhY = Math.sinh(im);
            const coshY = Math.cosh(im);
            return divideComponents(sinX * coshY, cosX * sinhY, cosX * coshY, -sinX * sinhY, out);
        }
        case VMF_SEC: {
            const cosRe = Math.cos(re) * Math.cosh(im);
            const cosIm = -Math.sin(re) * Math.sinh(im);
            return divideComponents(1, 0, cosRe, cosIm, out);
        }
        case VMF_EXP:
            return accelerator
                ? expBaseComponents(re, im, accelerator.expBaseRe, accelerator.expBaseIm, out)
                : expComponents(re, im, out);
        case VMF_LN:
            return accelerator
                ? lnBaseComponents(re, im, accelerator.logBaseRe, accelerator.logBaseIm, out)
                : lnComponents(re, im, out);
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
            const sinhX = Math.sinh(re);
            const coshX = Math.cosh(re);
            const sinY = Math.sin(im);
            const cosY = Math.cos(im);
            return divideComponents(sinhX * cosY, coshX * sinY, coshX * cosY, sinhX * sinY, out);
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
        case VMF_ASIN: {
            const value = complexAsin(re, im);
            out[0] = value.re;
            out[1] = value.im;
            return out;
        }
        case VMF_ATAN: {
            const value = complexAtan(re, im);
            out[0] = value.re;
            out[1] = value.im;
            return out;
        }
        case VMF_GAMMA: {
            const value = complexGamma(re, im);
            out[0] = value.re;
            out[1] = value.im;
            return out;
        }
        case VMF_LOGGAMMA: {
            const value = complexLogGamma(re, im);
            out[0] = value.re;
            out[1] = value.im;
            return out;
        }
        case VMF_BESSEL: {
            const value = complexBesselJ(re, im, accelerator?.besselOrder || { re: 0, im: 0 });
            out[0] = value.re;
            out[1] = value.im;
            return out;
        }
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
    const fractionalPowerN = Number(snapshot.fractionalPowerN ?? DEFAULT_FRACTIONAL_POWER);
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
            const end = ops.length;
            factorOpStart.push(start);
            factorOpEnd.push(end);
            if (end - start > maxOps) maxOps = end - start;
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
        expBaseRe: scalarRe(snapshot.expBase ?? { re: Math.E, im: 0 }),
        expBaseIm: scalarIm(snapshot.expBase),
        logBaseRe: scalarRe(snapshot.logBase ?? { re: Math.E, im: 0 }),
        logBaseIm: scalarIm(snapshot.logBase),
        besselOrder: toComplex(snapshot.besselOrder),
        mobiusARe: mobiusA.re,
        mobiusAIm: mobiusA.im,
        mobiusBRe: mobiusB.re,
        mobiusBIm: mobiusB.im,
        mobiusCRe: mobiusC.re,
        mobiusCIm: mobiusC.im,
        mobiusDRe: mobiusD.re,
        mobiusDIm: mobiusD.im,
        fractionalPowerN,
        zetaContinuationEnabled: !!snapshot.zetaContinuationEnabled,
        zExpr,
        scratch: new Float64Array(Math.max(8, (maxOps + 4) * 2))
    };
}

function powIntegerComponents(re, im, exponent, out) {
    const negative = exponent < 0;
    const nAbs = negative ? -exponent : exponent;
    let directRe;
    let directIm;
    switch (nAbs) {
        case 0:
            out[0] = 1; out[1] = 0; return out;
        case 1:
            directRe = re; directIm = im; break;
        case 2:
            directRe = re * re - im * im; directIm = 2 * re * im; break;
        case 3: {
            const re2 = re * re; const im2 = im * im;
            directRe = re * (re2 - 3 * im2); directIm = im * (3 * re2 - im2); break;
        }
        case 4: {
            const re2 = re * re; const im2 = im * im;
            directRe = re2 * re2 - 6 * re2 * im2 + im2 * im2;
            directIm = 4 * re * im * (re2 - im2); break;
        }
        default:
            directRe = NaN; directIm = NaN;
    }
    if (nAbs <= 4) {
        if (negative) return divideComponents(1, 0, directRe, directIm, out);
        out[0] = directRe; out[1] = directIm; return out;
    }

    let n = nAbs;
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

    if (negative) return divideComponents(1, 0, accRe, accIm, out);
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
                const sinX = Math.sin(ar);
                const cosX = Math.cos(ar);
                const sinhY = Math.sinh(ai);
                const coshY = Math.cosh(ai);
                divideComponents(sinX * coshY, cosX * sinhY, cosX * coshY, -sinX * sinhY, out);
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
                expBaseComponents(ar, ai, accelerator.expBaseRe, accelerator.expBaseIm, out);
                ar = out[0];
                ai = out[1];
                break;
            }
            case VMF_LN: {
                lnBaseComponents(ar, ai, accelerator.logBaseRe, accelerator.logBaseIm, out);
                ar = out[0];
                ai = out[1];
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
                const sinhX = Math.sinh(ar);
                const coshX = Math.cosh(ar);
                const sinY = Math.sin(ai);
                const cosY = Math.cos(ai);
                divideComponents(sinhX * cosY, coshX * sinY, coshX * cosY, sinhX * sinY, out);
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
            case VMF_ASIN: {
                const value = complexAsin(ar, ai);
                ar = value.re;
                ai = value.im;
                break;
            }
            case VMF_ATAN: {
                const value = complexAtan(ar, ai);
                ar = value.re;
                ai = value.im;
                break;
            }
            case VMF_GAMMA: {
                const value = complexGamma(ar, ai);
                ar = value.re;
                ai = value.im;
                break;
            }
            case VMF_LOGGAMMA: {
                const value = complexLogGamma(ar, ai);
                ar = value.re;
                ai = value.im;
                break;
            }
            case VMF_BESSEL: {
                const value = complexBesselJ(ar, ai, accelerator.besselOrder);
                ar = value.re;
                ai = value.im;
                break;
            }
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
        evaluatePrimitiveExpressionInto(accelerator.zExpr, zr, zi, cr, ci, scratch, accelerator);
        pointRe = scratch[0];
        pointIm = scratch[1];
        if (!isFiniteDomainDynamicsValue(pointRe, pointIm)) {
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
    const cacheable = !!snapshot && typeof snapshot === 'object' &&
        immutableDynamicsSnapshots.has(snapshot);
    if (cacheable) {
        const cached = dynamicsAcceleratorCache.get(snapshot);
        if (cached) return cached;
    }

    const accelerator =
        createPolynomialParameterAccelerator(snapshot) ||
        createLaurentParameterAccelerator(snapshot) ||
        createCompiledAlgebraicAccelerator(snapshot) ||
        createDirectBuiltinAccelerator(snapshot) ||
        NO_ACCELERATOR;

    if (cacheable) dynamicsAcceleratorCache.set(snapshot, accelerator);
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

function dynamicExpressionFunctions(snapshot) {
    return {
        exp: value => complexExpWithBase(value, snapshot),
        ln: value => complexLnWithBase(value, snapshot),
        log: value => complexLnWithBase(value, snapshot),
        bessel: (value, _environment, args) => {
            const order = args?.length > 1 ? toComplex(args[0]) : snapshot.besselOrder;
            const point = toComplex(value);
            return complexBesselJ(point.re, point.im, order);
        }
    };
}

function createDynamicAggregateEvaluator(snapshot) {
    if (!snapshot.dynamicAggregate) return null;
    const cached = dynamicAggregateEvaluatorCache.get(snapshot);
    if (cached) return cached;

    const dynamic = snapshot.dynamicAggregate;
    const bindingSymbols = (dynamic.bindings || [])
        .map(binding => String(binding?.symbol || '').trim())
        .filter(Boolean);
    const parameterSymbols = Object.keys(dynamic.parameters || {});
    const allowedVariables = [
        'c', 'd', 'j', 's', 'z',
        ...parameterSymbols,
        ...bindingSymbols
    ];

    let point;
    let term = null;
    try {
        point = compileExpression(dynamic.pointExpression, { allowedVariables });
        if (dynamic.term?.kind !== 'selected-function') {
            term = compileExpression(String(dynamic.term?.expression ?? 'z'), { allowedVariables });
        }
    } catch {
        point = null;
    }

    const evaluator = { dynamic, point, term };
    dynamicAggregateEvaluatorCache.set(snapshot, evaluator);
    return evaluator;
}

function evaluateDynamicAggregate(snapshot, value, accelerator) {
    const evaluator = createDynamicAggregateEvaluator(snapshot);
    if (!evaluator?.point || (evaluator.dynamic.term?.kind !== 'selected-function' && !evaluator.term)) {
        return null;
    }

    const dynamic = evaluator.dynamic;
    const point = toComplex(value);
    const selectedFunction = (re, im) => evaluateBase(
        snapshot,
        { re, im },
        { re, im },
        accelerator,
        true
    );
    const functions = dynamicExpressionFunctions(snapshot);
    let bindings;
    try {
        bindings = generateSequenceBindingSeries(
            dynamic.bindings || [],
            dynamic.sourceRecords.length,
            {
                aggregateParameter: point,
                parameters: dynamic.parameters || {}
            }
        );
    } catch {
        return null;
    }

    let sumRe = 0;
    let sumIm = 0;
    let compensationRe = 0;
    let compensationIm = 0;
    let productRe = 1;
    let productIm = 0;

    for (let index = 0; index < dynamic.sourceRecords.length; index += 1) {
        const record = dynamic.sourceRecords[index];
        const environment = {
            ...(dynamic.parameters || {}),
            ...(bindings.environments[index] || {}),
            d: record.domainValue,
            j: { re: record.ordinal, im: 0 },
            s: point,
            c: point,
            selectedFunction,
            functions
        };

        let inputPoint;
        let termValue;
        try {
            inputPoint = toComplex(evaluator.point(environment));
            termValue = evaluator.dynamic.term?.kind === 'selected-function'
                ? selectedFunction(inputPoint.re, inputPoint.im)
                : toComplex(evaluator.term({ ...environment, z: inputPoint }));
        } catch {
            inputPoint = null;
            termValue = null;
        }

        if (!validComplex(inputPoint) || !validComplex(termValue)) {
            if (dynamic.invalidPolicy === 'skip') continue;
            return null;
        }

        if (dynamic.reductionKind === 'sum') {
            const nextRe = sumRe + termValue.re;
            const nextIm = sumIm + termValue.im;
            compensationRe += Math.abs(sumRe) >= Math.abs(termValue.re)
                ? sumRe - nextRe + termValue.re
                : termValue.re - nextRe + sumRe;
            compensationIm += Math.abs(sumIm) >= Math.abs(termValue.im)
                ? sumIm - nextIm + termValue.im
                : termValue.im - nextIm + sumIm;
            sumRe = nextRe;
            sumIm = nextIm;
        } else {
            const nextRe = productRe * termValue.re - productIm * termValue.im;
            productIm = productRe * termValue.im + productIm * termValue.re;
            productRe = nextRe;
            if (!Number.isFinite(productRe) || !Number.isFinite(productIm)) return null;
        }
    }

    return dynamic.reductionKind === 'sum'
        ? { re: sumRe + compensationRe, im: sumIm + compensationIm }
        : { re: productRe, im: productIm };
}

function evaluateTaylorApproximation(snapshot, value) {
    const taylor = snapshot.taylor;
    if (!taylor || !Array.isArray(taylor.coefficients) || taylor.coefficients.length === 0) {
        return null;
    }

    const point = toComplex(value);
    const center = toComplex(taylor.center);
    const radius = Number(taylor.radius);
    const deltaRe = point.re - center.re;
    const deltaIm = point.im - center.im;
    if (Number.isFinite(radius) && deltaRe * deltaRe + deltaIm * deltaIm > radius * radius * 1.000001) {
        return null;
    }

    let sumRe = 0;
    let sumIm = 0;
    for (let index = taylor.coefficients.length - 1; index >= 0; index -= 1) {
        const coefficient = taylor.coefficients[index];
        const nextRe = sumRe * deltaRe - sumIm * deltaIm + scalarRe(coefficient);
        sumIm = sumRe * deltaIm + sumIm * deltaRe + scalarIm(coefficient);
        sumRe = nextRe;
    }
    return validComplex({ re: sumRe, im: sumIm }) ? { re: sumRe, im: sumIm } : null;
}

function evaluateBase(snapshot, value, c, accelerator = NO_ACCELERATOR, skipDynamic = false) {
    if (snapshot.dynamicAggregate && !skipDynamic) {
        return evaluateDynamicAggregate(snapshot, value, accelerator);
    }
    if (snapshot.taylor) {
        return evaluateTaylorApproximation(snapshot, value);
    }
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
    return !!value && domainDynamicsChainBailsOut(value.re, value.im);
}

function validOrNull(value) {
    return validComplex(value) ? value : null;
}

function snapshotChainCount(snapshot) {
    return normalizeDomainDynamicsChainCount(snapshot.chainCount);
}

function snapshotSupportsOrbitTrace(snapshot) {
    const chainMode = snapshot?.chainMode || 'recursion';
    return !!snapshot?.chainingEnabled &&
        !snapshot?.isWPlaneColoring &&
        snapshotChainCount(snapshot) > 1 &&
        (chainMode === 'recursion' || chainMode === 'zero_seed');
}

function resolveOrbitColoringMode(snapshot) {
    if (snapshot?.derivativeMode) return ORBIT_COLORING_MODES.value;
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
    const detectFixedPoint = count >= 64;

    if (!snapshot.chainingEnabled || (count <= 1 && mode !== 'zero_seed')) {
        if (!evaluateComponentBaseInto(snapshot, accelerator, re, im, re, im, scratch)) return null;
        const vr = scratch[0];
        const vi = scratch[1];
        return isFiniteDomainDynamicsValue(vr, vi) ? { re: vr, im: vi } : null;
    }

    if (mode === 'zero_seed') {
        let currentRe = 0;
        let currentIm = 0;
        let lastRe = NaN;
        let lastIm = NaN;
        let hasLast = false;
        for (let i = 0; i < count; i += 1) {
            const previousRe = currentRe;
            const previousIm = currentIm;
            if (!evaluateComponentBaseInto(snapshot, accelerator, currentRe, currentIm, re, im, scratch)) return null;
            currentRe = scratch[0];
            currentIm = scratch[1];
            if (!isFiniteDomainDynamicsValue(currentRe, currentIm)) {
                return hasLast ? { re: lastRe, im: lastIm } : null;
            }
            lastRe = currentRe;
            lastIm = currentIm;
            hasLast = true;
            if (detectFixedPoint && Object.is(currentRe, previousRe) && Object.is(currentIm, previousIm)) {
                return { re: currentRe, im: currentIm };
            }
            if (domainDynamicsChainBailsOut(currentRe, currentIm)) {
                return { re: currentRe, im: currentIm };
            }
        }
        return hasLast ? { re: currentRe, im: currentIm } : null;
    }

    if (!evaluateComponentBaseInto(snapshot, accelerator, re, im, re, im, scratch)) return null;
    let currentRe = scratch[0];
    let currentIm = scratch[1];
    if (!isFiniteDomainDynamicsValue(currentRe, currentIm)) return null;
    let lastRe = currentRe;
    let lastIm = currentIm;
    if (detectFixedPoint && Object.is(currentRe, re) && Object.is(currentIm, im)) return { re: currentRe, im: currentIm };
    if (domainDynamicsChainBailsOut(currentRe, currentIm)) {
        return { re: currentRe, im: currentIm };
    }

    for (let i = 1; i < count; i += 1) {
        if (!evaluateComponentBaseInto(snapshot, accelerator, currentRe, currentIm, re, im, scratch)) {
            return { re: lastRe, im: lastIm };
        }
        currentRe = scratch[0];
        currentIm = scratch[1];
        if (!isFiniteDomainDynamicsValue(currentRe, currentIm)) {
            return { re: lastRe, im: lastIm };
        }
        if (detectFixedPoint && Object.is(currentRe, lastRe) && Object.is(currentIm, lastIm)) {
            return { re: currentRe, im: currentIm };
        }
        lastRe = currentRe;
        lastIm = currentIm;
        if (domainDynamicsChainBailsOut(currentRe, currentIm)) {
            return { re: currentRe, im: currentIm };
        }
    }

    return { re: currentRe, im: currentIm };
}

function supportsComponentValueEvaluation(snapshot, accelerator) {
    if (snapshot.dynamicAggregate || snapshot.taylor) return false;
    if (accelerator.type === 'compiled-algebraic' ||
        accelerator.type === 'laurent-parameter' ||
        accelerator.type === 'polynomial-parameter' ||
        accelerator.type === 'direct-polynomial' ||
        accelerator.type === 'direct-mobius' ||
        accelerator.type === 'direct-zeta') return true;
    if (accelerator.type !== 'none') return false;
    const mode = snapshot.chainMode || 'recursion';
    if (mode !== 'recursion' && mode !== 'zero_seed') return false;
    return supportsBuiltinComponentEvaluation(snapshot.functionKey);
}

function supportsComponentOrbitEvaluation(snapshot, accelerator) {
    if (!supportsComponentValueEvaluation(snapshot, accelerator)) return false;
    if (accelerator.type !== 'none') return true;
    if (snapshot.functionKey === 'c') return false;
    return !(snapshot.branchCutType === 'ray' &&
        (snapshot.functionKey === 'ln' || snapshot.functionKey === 'power'));
}

export function evaluateDomainDynamicsValue(snapshot, re, im, accelerator = createDynamicsAccelerator(snapshot), skipDerivative = false) {
    if (snapshot.derivativeMode && !skipDerivative) {
        const h = 1e-6 * Math.max(1, Math.abs(re), Math.abs(im));
        const left = evaluateDomainDynamicsValue(snapshot, re - h, im, accelerator, true);
        const right = evaluateDomainDynamicsValue(snapshot, re + h, im, accelerator, true);
        if (!left || !right) return null;
        const scale = 0.5 / h;
        const derivativeRe = (right.re - left.re) * scale;
        const derivativeIm = (right.im - left.im) * scale;
        return isFiniteDomainDynamicsValue(derivativeRe, derivativeIm)
            ? { re: derivativeRe, im: derivativeIm }
            : null;
    }

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
    const logMod = domainDynamicsLogMagnitude(value.re, value.im);
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

function escapeSmoothIteration(iteration, count, next) {
    return next
        ? domainDynamicsSmoothIteration(iteration, count, next.re, next.im)
        : iteration + 1;
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

// Deep zoom can map many adjacent screen samples to the exact same IEEE-754
// coordinate. Evaluate each distinct coordinate pair once, then replicate pixels.
function axisHasDuplicateSamples(start, step, count) {
    // Skip the scan unless the step is near the rounding resolution of this axis.
    // The generous bound is conservative: it may scan unnecessarily, but cannot
    // suppress exact duplicate detection.
    const end = start + (count - 1) * step;
    const scale = Math.max(1, Math.abs(start), Math.abs(end), Math.abs(end - start));
    if (Math.abs(step) > 8 * Number.EPSILON * scale) return false;

    let previous = start;
    for (let i = 1; i < count; i += 1) {
        const current = start + i * step;
        if (Object.is(current, previous)) return true;
        previous = current;
    }
    return false;
}

function renderDuplicateSampleValueTile(snapshot, tile, accelerator) {
    if (!snapshotUsesValueColoring(snapshot) ||
        !supportsComponentValueEvaluation(snapshot, accelerator)) return null;

    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    const xStep = tile.scale * spanX / snapshot.viewport.width;
    const yStep = -tile.scale * spanY / snapshot.viewport.height;
    const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
    const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
    const duplicateX = axisHasDuplicateSamples(xStart, xStep, tile.width);
    const duplicateY = axisHasDuplicateSamples(yStart, yStep, tile.height);
    if (!duplicateX && !duplicateY) return null;

    const data = new Uint8ClampedArray(tile.width * tile.height * 4);
    const colors = colorContext(snapshot);
    let rowStart = 0;
    while (rowStart < tile.height) {
        const im = yStart + rowStart * yStep;
        let rowEnd = rowStart + 1;
        while (rowEnd < tile.height && Object.is(yStart + rowEnd * yStep, im)) rowEnd += 1;

        let columnStart = 0;
        while (columnStart < tile.width) {
            const re = xStart + columnStart * xStep;
            let columnEnd = columnStart + 1;
            while (columnEnd < tile.width && Object.is(xStart + columnEnd * xStep, re)) columnEnd += 1;

            const value = evaluateDomainDynamicsValueComponents(snapshot, re, im, accelerator);
            const first = (rowStart * tile.width + columnStart) * 4;
            writeDomainColorWithContext(data, first, value?.re, value?.im, colors);
            const r = data[first];
            const g = data[first + 1];
            const b = data[first + 2];
            const a = data[first + 3];
            for (let y = rowStart; y < rowEnd; y += 1) {
                let idx = (y * tile.width + columnStart) * 4;
                for (let x = columnStart; x < columnEnd; x += 1, idx += 4) {
                    data[idx] = r;
                    data[idx + 1] = g;
                    data[idx + 2] = b;
                    data[idx + 3] = a;
                }
            }
            columnStart = columnEnd;
        }
        rowStart = rowEnd;
    }
    return data;
}

export function writeBlack(data, idx) {
    writeRgb(data, idx, 0, 0, 0);
}

// Escape renderers are black-dominant. Preinitializing opacity lets every proven
// bounded pixel become a zero-write fast path while preserving RGBA output.
function createSolidRgbaBuffer(pixelCount, r, g, b, a = 255) {
    const data = new Uint8ClampedArray(pixelCount * 4);
    if (IS_LITTLE_ENDIAN) {
        const packed = (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
        new Uint32Array(data.buffer).fill(packed);
        return data;
    }
    for (let idx = 0; idx < data.length; idx += 4) {
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
    }
    return data;
}

function createOpaqueBlackBuffer(pixelCount) {
    return createSolidRgbaBuffer(pixelCount, 0, 0, 0, 255);
}

function sharedHueLuts(palette, saturation, brightness) {
    const length = palette.length;
    let entry = null;
    for (let e = renderHueLutCache.length - 1; e >= 0; e -= 1) {
        const candidate = renderHueLutCache[e];
        if (candidate.saturation !== saturation || candidate.length !== length) continue;
        let same = true;
        for (let i = 0; i < length; i += 1) {
            const stop = palette[i];
            const base = i * 3;
            if (candidate.palette[base] !== stop[0] || candidate.palette[base + 1] !== stop[1] ||
                candidate.palette[base + 2] !== stop[2]) { same = false; break; }
        }
        if (same) { entry = candidate; break; }
    }
    if (!entry) {
        const paletteFlat = new Float64Array(length * 3);
        for (let i = 0; i < length; i += 1) {
            const stop = palette[i], base = i * 3;
            paletteFlat[base] = stop[0]; paletteFlat[base + 1] = stop[1]; paletteFlat[base + 2] = stop[2];
        }
        const paletteLast = length - 1;
        const hueLut = new Float32Array((RENDER_HUE_LUT_SIZE + 1) * 3);
        const inverseSaturation = 1 - saturation;
        for (let i = 0; i <= RENDER_HUE_LUT_SIZE; i += 1) {
            const hue = i === RENDER_HUE_LUT_SIZE ? 0.999999 : i * INV_RENDER_HUE_LUT_SIZE;
            const value = hue * paletteLast;
            const p = Math.min(paletteLast - 1, Math.floor(value));
            const blend = value - p, inverse = 1 - blend;
            const a = p * 3, b = a + 3;
            const r = paletteFlat[a] * inverse + paletteFlat[b] * blend;
            const g = paletteFlat[a + 1] * inverse + paletteFlat[b + 1] * blend;
            const blue = paletteFlat[a + 2] * inverse + paletteFlat[b + 2] * blend;
            const gray = 0.299 * r + 0.587 * g + 0.114 * blue;
            const out = i * 3;
            hueLut[out] = gray * inverseSaturation + r * saturation;
            hueLut[out + 1] = gray * inverseSaturation + g * saturation;
            hueLut[out + 2] = gray * inverseSaturation + blue * saturation;
        }
        entry = { saturation, length, palette: paletteFlat, hueLut, flat: [] };
        renderHueLutCache.push(entry);
        if (renderHueLutCache.length > RENDER_HUE_LUT_CACHE_LIMIT) renderHueLutCache.shift();
    }

    let flatHueLut = null;
    for (let i = entry.flat.length - 1; i >= 0; i -= 1) {
        if (entry.flat[i].brightness === brightness) { flatHueLut = entry.flat[i].lut; break; }
    }
    if (!flatHueLut) {
        const flatLightness = Math.min(0.95, Math.max(0.05, 0.5 * brightness));
        flatHueLut = new Uint32Array(RENDER_HUE_LUT_SIZE + 1);
        if (IS_LITTLE_ENDIAN) {
            for (let i = 0; i <= RENDER_HUE_LUT_SIZE; i += 1) {
                const base = i * 3;
                let scale, bias;
                if (flatLightness < 0.5) { scale = flatLightness * 2; bias = 0; }
                else { bias = flatLightness * 2 - 1; scale = 1 - bias; }
                const r = byteFromUnit(scale * entry.hueLut[base] + bias);
                const g = byteFromUnit(scale * entry.hueLut[base + 1] + bias);
                const b = byteFromUnit(scale * entry.hueLut[base + 2] + bias);
                flatHueLut[i] = (255 << 24) | (b << 16) | (g << 8) | r;
            }
        }
        entry.flat.push({ brightness, lut: flatHueLut });
        if (entry.flat.length > 4) entry.flat.shift();
    }
    return { hueLut: entry.hueLut, flatHueLut };
}

function colorContext(snapshot) {
    const style = snapshot.style || {};
    const palette = Array.isArray(snapshot.paletteStops) && snapshot.paletteStops.length >= 2
        ? snapshot.paletteStops
        : DEFAULT_PALETTE_STOPS;
    const length = palette.length;
    const brightness = finite(style.brightness) ? style.brightness : 1;
    const contrast = finite(style.contrast) ? style.contrast : 1;
    const saturation = Math.min(1, Math.max(0, finite(style.saturation) ? style.saturation : 1));
    const lightnessCycles = Number(style.lightnessCycles) || 0;
    const cached = colorContextCache.get(snapshot);
    if (cached &&
        cached.palette === palette &&
        cached.paletteLast === length - 1 &&
        cached.brightness === brightness &&
        cached.contrast === contrast &&
        cached.saturation === saturation &&
        cached.lightnessCycles === lightnessCycles) {
        let unchanged = true;
        for (let i = 0; i < length; i += 1) {
            const stop = palette[i];
            if (cached.paletteR[i] !== stop[0] ||
                cached.paletteG[i] !== stop[1] ||
                cached.paletteB[i] !== stop[2]) {
                unchanged = false;
                break;
            }
        }
        if (unchanged) return cached;
    }

    const paletteR = new Float64Array(length);
    const paletteG = new Float64Array(length);
    const paletteB = new Float64Array(length);
    for (let i = 0; i < length; i += 1) {
        const stop = palette[i];
        paletteR[i] = stop[0];
        paletteG[i] = stop[1];
        paletteB[i] = stop[2];
    }
    const paletteLast = length - 1;
    const sharedLuts = sharedHueLuts(palette, saturation, brightness);
    const hueLut = sharedLuts.hueLut;
    const flatHueLut = sharedLuts.flatHueLut;
    const context = {
        palette,
        paletteR,
        paletteG,
        paletteB,
        paletteLast,
        hueLut,
        flatHueLut,
        brightness,
        contrast,
        saturation,
        lightnessCycles,
        // Zero detail makes lightness magnitude-independent, so the renderer can
        // avoid hypot/log1p for the overwhelmingly common flat-lightness style.
        needsMagnitudeDetail: lightnessCycles > 0.0001
    };
    colorContextCache.set(snapshot, context);
    return context;
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
    const absRe = re < 0 ? -re : re;
    const absIm = im < 0 ? -im : im;
    if (!(absRe < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE) ||
        !(absIm < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE)) {
        writeBlack(data, idx);
        return;
    }

    let lightnessBase = 0.5;
    if (context.needsMagnitudeDetail) {
        // Below the overflow guard, finite components mathematically guarantee a
        // finite Euclidean norm. Avoid a redundant sqrt/hypot before the log-magnitude
        // helper, which already performs the magnitude work needed for shading.
        if ((absRe > HYPOT_FAST_OVERFLOW_GUARD || absIm > HYPOT_FAST_OVERFLOW_GUARD) &&
            !finite(Math.hypot(re, im))) {
            writeBlack(data, idx);
            return;
        }
        lightnessBase = magnitudeLightness(domainDynamicsLogMagnitude(re, im), context.lightnessCycles);
    } else if ((re < 0 ? -re : re) > HYPOT_FAST_OVERFLOW_GUARD ||
        (im < 0 ? -im : im) > HYPOT_FAST_OVERFLOW_GUARD) {
        if (!finite(Math.hypot(re, im))) {
            writeBlack(data, idx);
            return;
        }
    }
    let hue = fastAtan2(im, re) * INV_TWO_PI;
    if (hue < 0) hue += 1;
    if (!context.needsMagnitudeDetail && IS_LITTLE_ENDIAN && (idx & 3) === 0) {
        let lutIndex = (hue * RENDER_HUE_LUT_SIZE + 0.5) | 0;
        if (lutIndex > RENDER_HUE_LUT_SIZE) lutIndex = RENDER_HUE_LUT_SIZE;
        const packed = context.flatHueLut[lutIndex];
        data[idx] = packed & 255;
        data[idx + 1] = (packed >>> 8) & 255;
        data[idx + 2] = (packed >>> 16) & 255;
        data[idx + 3] = 255;
        return;
    }
    const lightness = Math.min(0.95, Math.max(0.05, (0.5 + (lightnessBase - 0.5) * context.contrast) * context.brightness));
    writePreSaturatedHueColor(data, idx, hue, lightness, context);
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

function writeDynamicsPhaseEventColorWithContext(data, idx, re, im, intensity, context) {
    if (!isFiniteDomainDynamicsValue(re, im)) {
        writeBlack(data, idx);
        return;
    }
    const modValue = Math.hypot(re, im);
    if (!finite(modValue)) {
        writeBlack(data, idx);
        return;
    }
    let hue = fastAtan2(im, re) * INV_TWO_PI;
    if (hue < 0) hue += 1;
    const t = intensity <= 0 ? 0 : intensity >= 1 ? 1 : intensity;
    const lightnessBase = 0.24 + 0.58 * Math.pow(t, 0.55);
    const lightness = Math.min(0.95, Math.max(0.05,
        (0.5 + (lightnessBase - 0.5) * context.contrast) * context.brightness));
    writePreSaturatedHueColor(data, idx, hue, lightness, context);
}

function createComponentOrbitPointWriter(snapshot, accelerator, colors = colorContext(snapshot)) {
    const mode = resolveOrbitColoringMode(snapshot);
    if (mode === ORBIT_COLORING_MODES.value || !supportsComponentOrbitEvaluation(snapshot, accelerator)) return null;
    const count = snapshotChainCount(snapshot);
    const zeroSeed = snapshot.chainMode === 'zero_seed';
    const detectConvergence = mode === ORBIT_COLORING_MODES.attractor || mode === ORBIT_COLORING_MODES.hybrid;
    const scratch = accelerator.scratch || NO_ACCELERATOR.scratch;

    return (data, idx, cr, ci, targetIsOpaqueBlack = false) => {
        let currentRe = zeroSeed ? 0 : cr;
        let currentIm = zeroSeed ? 0 : ci;
        let lastRe = currentRe;
        let lastIm = currentIm;
        let hasLast = isFiniteDomainDynamicsValue(currentRe, currentIm);
        let event = 0; // 1 escaped, 2 converged
        let eventIteration = count;
        let smoothIteration = count;
        let eventRe = lastRe;
        let eventIm = lastIm;

        for (let i = 0; i < count; i += 1) {
            if (!evaluateComponentBaseInto(snapshot, accelerator, currentRe, currentIm, cr, ci, scratch)) {
                event = 1;
                eventIteration = i + 1;
                smoothIteration = i + 1;
                eventRe = lastRe;
                eventIm = lastIm;
                break;
            }
            const nextRe = scratch[0];
            const nextIm = scratch[1];
            const nextFinite = isFiniteDomainDynamicsValue(nextRe, nextIm);
            const magSq = nextFinite ? nextRe * nextRe + nextIm * nextIm : DYNAMICS_ESCAPE_RADIUS_SQ;
            const absRe = nextRe < 0 ? -nextRe : nextRe;
            const absIm = nextIm < 0 ? -nextIm : nextIm;
            const tooLarge = nextFinite && (
                magSq > DYNAMICS_ESCAPE_RADIUS_SQ ||
                absRe >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                absIm >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE
            );

            if (!nextFinite || tooLarge) {
                event = 1;
                eventIteration = i + 1;
                smoothIteration = nextFinite
                    ? domainDynamicsSmoothIteration(i, count, nextRe, nextIm)
                    : i + 1;
                eventRe = nextFinite ? nextRe : lastRe;
                eventIm = nextFinite ? nextIm : lastIm;
                break;
            }

            if (detectConvergence) {
                const deltaRe = nextRe - currentRe;
                const deltaIm = nextIm - currentIm;
                const deltaSq = deltaRe * deltaRe + deltaIm * deltaIm;
                const convergenceScale = Math.max(1, magSq);
                if (deltaSq <= ORBIT_ATTRACTOR_CONVERGENCE_EPSILON_SQ * convergenceScale) {
                    event = 2;
                    eventIteration = i + 1;
                    smoothIteration = i + 1;
                    eventRe = nextRe;
                    eventIm = nextIm;
                    lastRe = nextRe;
                    lastIm = nextIm;
                    hasLast = true;
                    break;
                }
            }

            currentRe = nextRe;
            currentIm = nextIm;
            lastRe = nextRe;
            lastIm = nextIm;
            hasLast = true;
        }

        if (mode === ORBIT_COLORING_MODES.escape) {
            if (event === 1) writeDynamicsEscapeColorWithContext(data, idx, smoothIteration, count, colors);
            else if (!targetIsOpaqueBlack) writeBlack(data, idx);
            return;
        }
        if (mode === ORBIT_COLORING_MODES.attractor) {
            if (event === 2) {
                writeDynamicsPhaseEventColorWithContext(
                    data, idx, eventRe, eventIm,
                    1 - Math.max(0, Math.min(1, (eventIteration - 1) / Math.max(1, count))),
                    colors
                );
            } else if (!targetIsOpaqueBlack) {
                writeBlack(data, idx);
            }
            return;
        }
        if (event === 1) {
            writeDynamicsPhaseEventColorWithContext(
                data, idx, eventRe, eventIm,
                1 - Math.max(0, Math.min(1, smoothIteration / Math.max(1, count))),
                colors
            );
        } else if (event === 2) {
            writeDynamicsPhaseEventColorWithContext(
                data, idx, eventRe, eventIm,
                1 - Math.max(0, Math.min(1, (eventIteration - 1) / Math.max(1, count))),
                colors
            );
        } else if (hasLast) {
            writeDomainColorWithContext(data, idx, lastRe, lastIm, colors);
        } else {
            writeBlack(data, idx);
        }
    };
}

function renderComponentOrbitTile(snapshot, tile, accelerator, writePoint = null) {
    const mode = resolveOrbitColoringMode(snapshot);
    if (mode === ORBIT_COLORING_MODES.value || !supportsComponentOrbitEvaluation(snapshot, accelerator)) return null;
    const opaqueBlack = mode === ORBIT_COLORING_MODES.escape || mode === ORBIT_COLORING_MODES.attractor;
    const frame = createDomainTileFrame(snapshot, tile, opaqueBlack);
    const { data, width, height, xStep, yStep, xStart, yStart, colors } = frame;
    const pointWriter = writePoint || createComponentOrbitPointWriter(snapshot, accelerator, colors);

    for (let y = 0; y < height; y += 1) {
        const ci = yStart + y * yStep;
        for (let x = 0; x < width; x += 1) {
            const cr = xStart + x * xStep;
            const idx = (y * width + x) * 4;
            pointWriter(data, idx, cr, ci, opaqueBlack);
        }
    }
    return data;
}

function createComponentOrbitTileRenderer(snapshot, accelerator) {
    const writePoint = createComponentOrbitPointWriter(snapshot, accelerator);
    if (!writePoint) return null;
    const renderTile = tile => renderComponentOrbitTile(snapshot, tile, accelerator, writePoint);
    renderTile.writePoint = writePoint;
    return renderTile;
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
            (next.re < 0 ? -next.re : next.re) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
            (next.im < 0 ? -next.im : next.im) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE
        );

        if (!next || tooLarge) {
            return {
                escaped: true,
                converged: false,
                smoothIteration: escapeSmoothIteration(i, count, next),
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

function createDomainTileFrame(snapshot, tile, opaqueBlack = false) {
    const xRange = snapshot.viewport.xRange;
    const yRange = snapshot.viewport.yRange;
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];
    return {
        data: opaqueBlack
            ? createOpaqueBlackBuffer(tile.width * tile.height)
            : new Uint8ClampedArray(tile.width * tile.height * 4),
        width: tile.width,
        height: tile.height,
        xStep: tile.scale * spanX / snapshot.viewport.width,
        yStep: -tile.scale * spanY / snapshot.viewport.height,
        xStart: xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width,
        yStart: yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height,
        colors: colorContext(snapshot)
    };
}

function renderSimpleValueTile(snapshot, tile, step, options = {}) {
    const mode = snapshot.chainMode || 'recursion';
    if (mode !== 'recursion' && mode !== 'zero_seed') return null;

    const frame = createDomainTileFrame(snapshot, tile);
    const { data, width, height, xStep, yStep, xStart, yStart, colors } = frame;
    const count = snapshotChainCount(snapshot);
    const zeroSeed = mode === 'zero_seed';
    const iterations = snapshot.chainingEnabled || zeroSeed ? count : 1;
    const out = options.scratch || new Float64Array(2);
    const incrementalX = !!options.incrementalX;
    const parameterMode = !!options.parameterMode;

    for (let y = 0; y < height; y += 1) {
        const ci = yStart + y * yStep;
        let cr = xStart;
        for (let x = 0; x < width; x += 1) {
            const sampleRe = incrementalX ? cr : xStart + x * xStep;
            let paramRe = 0;
            let paramIm = 0;
            if (parameterMode) {
                paramRe = options.cCoeffRe * sampleRe - options.cCoeffIm * ci;
                paramIm = options.cCoeffRe * ci + options.cCoeffIm * sampleRe;
            }

            let zr = zeroSeed ? 0 : sampleRe;
            let zi = zeroSeed ? 0 : ci;
            let lastRe = NaN;
            let lastIm = NaN;
            for (let i = 0; i < iterations; i += 1) {
                step(zr, zi, sampleRe, ci, paramRe, paramIm, out);
                const nr = out[0];
                const ni = out[1];
                const absRe = nr < 0 ? -nr : nr;
                const absIm = ni < 0 ? -ni : ni;
                if (!(absRe < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE) ||
                    !(absIm < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE)) break;

                zr = nr;
                zi = ni;
                lastRe = nr;
                lastIm = ni;
                if (absRe >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                    absIm >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) break;
            }

            writeDomainColorWithContext(data, (y * width + x) * 4, lastRe, lastIm, colors);
            if (incrementalX) cr += xStep;
        }
    }

    return data;
}

function renderFixedPointValueTile(snapshot, tile, step, options = {}) {
    const mode = snapshot.chainMode || 'recursion';
    if (mode !== 'recursion' && mode !== 'zero_seed') return null;

    const frame = createDomainTileFrame(snapshot, tile);
    const { data, width, height, xStep, yStep, xStart, yStart, colors } = frame;
    const count = snapshotChainCount(snapshot);
    const zeroSeed = mode === 'zero_seed';
    const detectFixedPoint = count >= 64;
    const out = options.scratch || new Float64Array(2);
    const parameterMode = !!options.parameterMode;

    for (let y = 0; y < height; y += 1) {
        const ci = yStart + y * yStep;
        for (let x = 0; x < width; x += 1) {
            const cr = xStart + x * xStep;
            let paramRe = 0;
            let paramIm = 0;
            if (parameterMode) {
                paramRe = options.cCoeffRe * cr - options.cCoeffIm * ci;
                paramIm = options.cCoeffRe * ci + options.cCoeffIm * cr;
            }

            let currentRe;
            let currentIm;
            let lastRe = NaN;
            let lastIm = NaN;

            if (!snapshot.chainingEnabled || (count <= 1 && mode !== 'zero_seed')) {
                step(cr, ci, cr, ci, paramRe, paramIm, out);
                currentRe = out[0];
                currentIm = out[1];
                if ((currentRe < 0 ? -currentRe : currentRe) < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE &&
                    (currentIm < 0 ? -currentIm : currentIm) < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE) {
                    lastRe = currentRe;
                    lastIm = currentIm;
                }
            } else if (mode === 'zero_seed') {
                currentRe = 0;
                currentIm = 0;
                for (let i = 0; i < count; i += 1) {
                    const previousRe = currentRe;
                    const previousIm = currentIm;
                    step(currentRe, currentIm, cr, ci, paramRe, paramIm, out);
                    currentRe = out[0];
                    currentIm = out[1];
                    const absRe = currentRe < 0 ? -currentRe : currentRe;
                    const absIm = currentIm < 0 ? -currentIm : currentIm;
                    if (!(absRe < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE) ||
                        !(absIm < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE)) break;
                    lastRe = currentRe;
                    lastIm = currentIm;
                    if (detectFixedPoint && Object.is(currentRe, previousRe) && Object.is(currentIm, previousIm)) break;
                    if (absRe >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                        absIm >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) break;
                }
            } else {
                step(cr, ci, cr, ci, paramRe, paramIm, out);
                currentRe = out[0];
                currentIm = out[1];
                let absRe = currentRe < 0 ? -currentRe : currentRe;
                let absIm = currentIm < 0 ? -currentIm : currentIm;
                if (absRe < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE &&
                    absIm < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE) {
                    lastRe = currentRe;
                    lastIm = currentIm;
                    if (detectFixedPoint && Object.is(currentRe, cr) && Object.is(currentIm, ci)) {
                        writeDomainColorWithContext(data, (y * width + x) * 4, lastRe, lastIm, colors);
                        continue;
                    }
                    if (absRe < DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE &&
                        absIm < DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) {
                        for (let i = 1; i < count; i += 1) {
                            step(currentRe, currentIm, cr, ci, paramRe, paramIm, out);
                            currentRe = out[0];
                            currentIm = out[1];
                            absRe = currentRe < 0 ? -currentRe : currentRe;
                            absIm = currentIm < 0 ? -currentIm : currentIm;
                            if (!(absRe < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE) ||
                                !(absIm < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE)) break;
                            if (detectFixedPoint && Object.is(currentRe, lastRe) && Object.is(currentIm, lastIm)) break;
                            lastRe = currentRe;
                            lastIm = currentIm;
                            if (absRe >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE ||
                                absIm >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) break;
                        }
                    }
                }
            }

            writeDomainColorWithContext(data, (y * width + x) * 4, lastRe, lastIm, colors);
        }
    }

    return data;
}

function createEscapePointWriter(snapshot, step, options = {}) {
    const zeroSeed = snapshot.chainMode === 'zero_seed';
    const count = snapshotChainCount(snapshot);
    const out = options.scratch || new Float64Array(2);
    const parameterMode = !!options.parameterMode;
    const colors = colorContext(snapshot);

    return (data, idx, cr, ci, targetIsOpaqueBlack = false) => {
        let paramRe = 0;
        let paramIm = 0;
        if (parameterMode) {
            paramRe = options.cCoeffRe * cr - options.cCoeffIm * ci;
            paramIm = options.cCoeffRe * ci + options.cCoeffIm * cr;
        }
        if (options.skipCardioid && zeroSeed && definitelyInsideUnitQuadraticCardioidOrBulb(paramRe, paramIm)) {
            if (!targetIsOpaqueBlack) writeBlack(data, idx);
            return;
        }

        let zr = zeroSeed ? 0 : cr;
        let zi = zeroSeed ? 0 : ci;
        let smoothIteration = count;
        let escaped = false;

        for (let i = 0; i < count; i += 1) {
            step(zr, zi, cr, ci, paramRe, paramIm, out);
            const nr = out[0];
            const ni = out[1];
            const magSq = nr * nr + ni * ni;
            const absRe = nr < 0 ? -nr : nr;
            const absIm = ni < 0 ? -ni : ni;
            const tooLarge = !(absRe < DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) ||
                !(absIm < DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) ||
                magSq > DYNAMICS_ESCAPE_RADIUS_SQ;

            if (tooLarge) {
                smoothIteration = domainDynamicsSmoothIteration(i, count, nr, ni);
                escaped = true;
                break;
            }

            zr = nr;
            zi = ni;
        }

        if (escaped) {
            writeDynamicsEscapeColorWithContext(data, idx, smoothIteration, count, colors);
        } else if (!targetIsOpaqueBlack) {
            writeBlack(data, idx);
        }
    };
}

function createEscapeTileRenderer(snapshot, step, options = {}) {
    const opaqueBlack = !!options.opaqueBlack && snapshot.chainMode === 'zero_seed';
    const writePoint = createEscapePointWriter(snapshot, step, options);
    const renderTile = tile => {
        const frame = createDomainTileFrame(snapshot, tile, opaqueBlack);
        const { data, width, height, xStep, yStep, xStart, yStart } = frame;

        for (let y = 0; y < height; y += 1) {
            const ci = yStart + y * yStep;
            for (let x = 0; x < width; x += 1) {
                const cr = xStart + x * xStep;
                writePoint(data, (y * width + x) * 4, cr, ci, opaqueBlack);
            }
        }

        return data;
    };
    renderTile.writePoint = writePoint;
    return renderTile;
}

function createPolynomialParameterStep(accelerator, quadratic = false) {
    if (quadratic) {
        const a0r = accelerator.coeffsRe[0] || 0;
        const a0i = accelerator.coeffsIm[0] || 0;
        const a1r = accelerator.coeffsRe[1] || 0;
        const a1i = accelerator.coeffsIm[1] || 0;
        const a2r = accelerator.coeffsRe[2] || 0;
        const a2i = accelerator.coeffsIm[2] || 0;
        return (zr, zi, _cr, _ci, paramRe, paramIm, out) => {
            const z2r = zr * zr - zi * zi;
            const z2i = 2 * zr * zi;
            out[0] = a2r * z2r - a2i * z2i + a1r * zr - a1i * zi + a0r + paramRe;
            out[1] = a2r * z2i + a2i * z2r + a1r * zi + a1i * zr + a0i + paramIm;
            return out;
        };
    }

    const degree = accelerator.degree;
    const coeffsRe = accelerator.coeffsRe;
    const coeffsIm = accelerator.coeffsIm;
    return (zr, zi, _cr, _ci, paramRe, paramIm, out) => {
        let nr = coeffsRe[degree] || 0;
        let ni = coeffsIm[degree] || 0;
        for (let k = degree - 1; k >= 0; k -= 1) {
            const tr = nr * zr - ni * zi + (coeffsRe[k] || 0);
            ni = nr * zi + ni * zr + (coeffsIm[k] || 0);
            nr = tr;
        }
        if (accelerator.hasParameter) {
            nr += paramRe;
            ni += paramIm;
        }
        out[0] = nr;
        out[1] = ni;
        return out;
    };
}

function createMonomialParameterStep(accelerator) {
    const exponent = accelerator.monomialExponent;
    const ar = accelerator.monomialCoeffRe;
    const ai = accelerator.monomialCoeffIm;
    return (zr, zi, _cr, _ci, paramRe, paramIm, out) => {
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
        out[0] = ar * pr - ai * pi + paramRe;
        out[1] = ar * pi + ai * pr + paramIm;
        return out;
    };
}

function createLaurentParameterStep(accelerator) {
    return (zr, zi, cr, ci, _paramRe, _paramIm, out) => evaluateLaurentInto(accelerator, zr, zi, cr, ci, out);
}

function createBuiltinComponentStep(functionKey, snapshot) {
    switch (functionKey) {
        case 'exp':
            return (re, im, out) => expBaseComponents(
                re,
                im,
                scalarRe(snapshot.expBase ?? { re: Math.E, im: 0 }),
                scalarIm(snapshot.expBase),
                out
            );
        case 'ln':
            return (re, im, out) => lnBaseComponents(
                re,
                im,
                scalarRe(snapshot.logBase ?? { re: Math.E, im: 0 }),
                scalarIm(snapshot.logBase),
                out
            );
        case 'sin':
            return (re, im, out) => {
                out[0] = Math.sin(re) * Math.cosh(im);
                out[1] = Math.cos(re) * Math.sinh(im);
                return out;
            };
        case 'cos':
            return (re, im, out) => {
                out[0] = Math.cos(re) * Math.cosh(im);
                out[1] = -Math.sin(re) * Math.sinh(im);
                return out;
            };
        case 'tan':
            return (re, im, out) => {
                const sinX = Math.sin(re);
                const cosX = Math.cos(re);
                const sinhY = Math.sinh(im);
                const coshY = Math.cosh(im);
                return divideComponents(sinX * coshY, cosX * sinhY, cosX * coshY, -sinX * sinhY, out);
            };
        case 'sec':
            return (re, im, out) => {
                const cosRe = Math.cos(re) * Math.cosh(im);
                const cosIm = -Math.sin(re) * Math.sinh(im);
                return divideComponents(1, 0, cosRe, cosIm, out);
            };
        case 'reciprocal':
            return (re, im, out) => divideComponents(1, 0, re, im, out);
        case 'sinh':
            return (re, im, out) => {
                out[0] = Math.sinh(re) * Math.cos(im);
                out[1] = Math.cosh(re) * Math.sin(im);
                return out;
            };
        case 'cosh':
            return (re, im, out) => {
                out[0] = Math.cosh(re) * Math.cos(im);
                out[1] = Math.sinh(re) * Math.sin(im);
                return out;
            };
        case 'tanh':
            return (re, im, out) => {
                const sinhX = Math.sinh(re);
                const coshX = Math.cosh(re);
                const sinY = Math.sin(im);
                const cosY = Math.cos(im);
                return divideComponents(sinhX * cosY, coshX * sinY, coshX * cosY, sinhX * sinY, out);
            };
        case 'asin':
            return (re, im, out) => {
                const value = complexAsin(re, im);
                out[0] = value.re;
                out[1] = value.im;
                return out;
            };
        case 'atan':
            return (re, im, out) => {
                const value = complexAtan(re, im);
                out[0] = value.re;
                out[1] = value.im;
                return out;
            };
        case 'gamma':
            return (re, im, out) => {
                const value = complexGamma(re, im);
                out[0] = value.re;
                out[1] = value.im;
                return out;
            };
        case 'loggamma':
            return (re, im, out) => {
                const value = complexLogGamma(re, im);
                out[0] = value.re;
                out[1] = value.im;
                return out;
            };
        case 'bessel':
            return (re, im, out) => {
                const value = complexBesselJ(re, im, snapshot.besselOrder);
                out[0] = value.re;
                out[1] = value.im;
                return out;
            };
        case 'power': {
            const exponent = Number(snapshot.fractionalPowerN ?? DEFAULT_FRACTIONAL_POWER);
            return (re, im, out) => powRealComponents(re, im, exponent, out);
        }
        case 'poincare':
            return (re, im, out) => {
                if (im <= 1e-9) { out[0] = NaN; out[1] = NaN; return out; }
                const sqrtIm = Math.sqrt(im);
                out[0] = re / sqrtIm;
                out[1] = sqrtIm;
                return out;
            };
        case 'zeta': {
            const continuation = !!snapshot.zetaContinuationEnabled;
            return (re, im, out) => zetaComponents(re, im, continuation, out);
        }
        default:
            return null;
    }
}

function separableBuiltinKind(functionKey, snapshot = null) {
    if (functionKey === 'exp') {
        const base = snapshot?.expBase;
        if (Math.abs(scalarRe(base ?? { re: Math.E, im: 0 }) - Math.E) > 1e-12 ||
            Math.abs(scalarIm(base)) > 1e-12) return null;
    }
    switch (functionKey) {
        case 'sin': case 'cos': case 'tan': case 'sec':
        case 'exp': case 'sinh': case 'cosh': case 'tanh': case 'poincare':
            return functionKey;
        default:
            return null;
    }
}

function buildSeparableAxisTable(kind, start, step, count, axis) {
    const values = new Float64Array(count * 2);
    for (let i = 0; i < count; i += 1) {
        const v = start + i * step;
        const j = i << 1;
        if (axis === 'x') {
            switch (kind) {
                case 'sin': case 'cos': case 'tan': case 'sec':
                    values[j] = Math.sin(v); values[j + 1] = Math.cos(v); break;
                case 'exp':
                    values[j] = expSafe(v); values[j + 1] = 0; break;
                case 'sinh': case 'cosh': case 'tanh':
                    values[j] = Math.sinh(v); values[j + 1] = Math.cosh(v); break;
                case 'poincare':
                    values[j] = v; values[j + 1] = 0; break;
                default: break;
            }
        } else {
            switch (kind) {
                case 'sin': case 'cos': case 'tan': case 'sec':
                    values[j] = Math.sinh(v); values[j + 1] = Math.cosh(v); break;
                case 'exp': case 'sinh': case 'cosh': case 'tanh':
                    values[j] = Math.sin(v); values[j + 1] = Math.cos(v); break;
                case 'poincare': {
                    const root = v > 1e-9 ? Math.sqrt(v) : NaN;
                    values[j] = root; values[j + 1] = v; break;
                }
                default: break;
            }
        }
    }
    return values;
}

function writeConstantTileColor(snapshot, tile, re, im) {
    const sample = new Uint8ClampedArray(4);
    writeDomainColorWithContext(sample, 0, re, im, colorContext(snapshot));
    return createSolidRgbaBuffer(tile.width * tile.height, sample[0], sample[1], sample[2], sample[3]);
}

function renderSeparableBuiltinValueTile(snapshot, tile, kind, step, axisCache, scratch) {
    const mode = snapshot.chainMode || 'recursion';
    if (mode !== 'recursion' && mode !== 'zero_seed') return null;
    const count = snapshotChainCount(snapshot);

    if (mode === 'zero_seed') {
        let zr = 0, zi = 0, lastRe = NaN, lastIm = NaN;
        const detectFixedPoint = count >= 64;
        for (let i = 0; i < count; i += 1) {
            const previousRe = zr, previousIm = zi;
            step(zr, zi, scratch);
            zr = scratch[0]; zi = scratch[1];
            const absRe = zr < 0 ? -zr : zr;
            const absIm = zi < 0 ? -zi : zi;
            if (!(absRe < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE) || !(absIm < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE)) break;
            lastRe = zr; lastIm = zi;
            if (detectFixedPoint && Object.is(zr, previousRe) && Object.is(zi, previousIm)) break;
            if (absRe >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE || absIm >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) break;
        }
        return writeConstantTileColor(snapshot, tile, lastRe, lastIm);
    }

    const frame = createDomainTileFrame(snapshot, tile);
    const { data, width, height, xStep, yStep, xStart, yStart, colors } = frame;
    const xKey = `${kind}:x:${tile.scale}:${tile.x}:${width}`;
    const yKey = `${kind}:y:${tile.scale}:${tile.y}:${height}`;
    let xValues = axisCache.get(xKey);
    if (!xValues) { xValues = buildSeparableAxisTable(kind, xStart, xStep, width, 'x'); axisCache.set(xKey, xValues); }
    let yValues = axisCache.get(yKey);
    if (!yValues) { yValues = buildSeparableAxisTable(kind, yStart, yStep, height, 'y'); axisCache.set(yKey, yValues); }
    const iterations = snapshot.chainingEnabled ? count : 1;
    const detectFixedPoint = count >= 64;

    for (let y = 0; y < height; y += 1) {
        const yj = y << 1;
        const ya = yValues[yj], yb = yValues[yj + 1];
        for (let x = 0; x < width; x += 1) {
            const xj = x << 1;
            const xa = xValues[xj], xb = xValues[xj + 1];
            let zr, zi;
            switch (kind) {
                case 'sin': zr = xa * yb; zi = xb * ya; break;
                case 'cos': zr = xb * yb; zi = -xa * ya; break;
                case 'tan': divideComponents(xa * yb, xb * ya, xb * yb, -xa * ya, scratch); zr = scratch[0]; zi = scratch[1]; break;
                case 'sec': divideComponents(1, 0, xb * yb, -xa * ya, scratch); zr = scratch[0]; zi = scratch[1]; break;
                case 'exp': zr = xa * yb; zi = xa * ya; break;
                case 'sinh': zr = xa * yb; zi = xb * ya; break;
                case 'cosh': zr = xb * yb; zi = xa * ya; break;
                case 'tanh': divideComponents(xa * yb, xb * ya, xb * yb, xa * ya, scratch); zr = scratch[0]; zi = scratch[1]; break;
                case 'poincare': zr = xa / ya; zi = ya; break;
                default: zr = NaN; zi = NaN; break;
            }

            let lastRe = NaN, lastIm = NaN;
            let absRe = zr < 0 ? -zr : zr;
            let absIm = zi < 0 ? -zi : zi;
            if (absRe < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE && absIm < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE) {
                lastRe = zr; lastIm = zi;
                const cr = xStart + x * xStep;
                const ci = yStart + y * yStep;
                if (!(detectFixedPoint && Object.is(zr, cr) && Object.is(zi, ci)) &&
                    absRe < DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE && absIm < DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) {
                    for (let i = 1; i < iterations; i += 1) {
                        step(zr, zi, scratch);
                        zr = scratch[0]; zi = scratch[1];
                        absRe = zr < 0 ? -zr : zr;
                        absIm = zi < 0 ? -zi : zi;
                        if (!(absRe < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE) || !(absIm < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE)) break;
                        if (detectFixedPoint && Object.is(zr, lastRe) && Object.is(zi, lastIm)) break;
                        lastRe = zr; lastIm = zi;
                        if (absRe >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE || absIm >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) break;
                    }
                }
            }
            writeDomainColorWithContext(data, (y * width + x) * 4, lastRe, lastIm, colors);
        }
    }
    return data;
}

function createAcceleratedTileRenderer(snapshot, accelerator) {
    if (snapshot.derivativeMode || snapshot.dynamicAggregate || snapshot.taylor) return null;

    const value = snapshotUsesValueColoring(snapshot);
    const escape = snapshotUsesEscapeColoring(snapshot);
    if (!value && !escape) {
        return supportsComponentOrbitEvaluation(snapshot, accelerator)
            ? createComponentOrbitTileRenderer(snapshot, accelerator)
            : null;
    }

    if (accelerator.type === 'polynomial-parameter') {
        const quadratic = accelerator.degree === 2;
        const step = createPolynomialParameterStep(accelerator, quadratic);
        const options = {
            parameterMode: accelerator.hasParameter,
            cCoeffRe: accelerator.cCoeffRe,
            cCoeffIm: accelerator.cCoeffIm,
            scratch: accelerator.scratch,
            opaqueBlack: quadratic && accelerator.canonicalUnitQuadratic,
            skipCardioid: quadratic && accelerator.canonicalUnitQuadratic
        };
        return escape
            ? createEscapeTileRenderer(snapshot, step, options)
            : tile => renderSimpleValueTile(snapshot, tile, step, options);
    }

    if (accelerator.type === 'laurent-parameter') {
        const monomial = accelerator.isPositiveMonomial;
        const quadratic = monomial && accelerator.monomialExponent === 2;
        const step = monomial
            ? createMonomialParameterStep(accelerator)
            : createLaurentParameterStep(accelerator);
        const options = monomial
            ? {
                parameterMode: true,
                cCoeffRe: accelerator.cCoeffRe,
                cCoeffIm: accelerator.cCoeffIm,
                scratch: accelerator.scratch,
                skipCardioid: quadratic && accelerator.monomialCoeffRe === 1 && accelerator.monomialCoeffIm === 0
            }
            : { scratch: accelerator.scratch };
        return escape
            ? createEscapeTileRenderer(snapshot, step, options)
            : tile => renderSimpleValueTile(snapshot, tile, step, options);
    }

    if (accelerator.type === 'compiled-algebraic') {
        const step = (zr, zi, cr, ci, _paramRe, _paramIm, out) =>
            evaluateCompiledAlgebraicInto(accelerator, zr, zi, cr, ci, out);
        return escape
            ? createEscapeTileRenderer(snapshot, step, { scratch: accelerator.scratch })
            : tile => renderFixedPointValueTile(snapshot, tile, step, { scratch: accelerator.scratch });
    }

    if (accelerator.type === 'direct-polynomial') {
        const { degree, coeffsRe, coeffsIm } = accelerator;
        const step = (zr, zi, _cr, _ci, _paramRe, _paramIm, out) => {
            let nr = coeffsRe[degree];
            let ni = coeffsIm[degree];
            for (let k = degree - 1; k >= 0; k -= 1) {
                const tr = nr * zr - ni * zi + coeffsRe[k];
                ni = nr * zi + ni * zr + coeffsIm[k];
                nr = tr;
            }
            out[0] = nr;
            out[1] = ni;
            return out;
        };
        if (value) return tile => renderSimpleValueTile(snapshot, tile, step, {
            incrementalX: true,
            scratch: accelerator.scratch
        });
    }

    if (accelerator.type === 'direct-mobius') {
        const { aRe, aIm, bRe, bIm, cRe, cIm, dRe, dIm } = accelerator;
        const step = (zr, zi, _cr, _ci, _paramRe, _paramIm, out) => {
            const nr = aRe * zr - aIm * zi + bRe;
            const ni = aRe * zi + aIm * zr + bIm;
            const denRe = cRe * zr - cIm * zi + dRe;
            const denIm = cRe * zi + cIm * zr + dIm;
            return divideComponents(nr, ni, denRe, denIm, out);
        };
        if (value) return tile => renderSimpleValueTile(snapshot, tile, step, {
            incrementalX: true,
            scratch: accelerator.scratch
        });
    }

    if (accelerator.type === 'direct-zeta') {
        if (value) return tile => renderDirectZetaValueTile(snapshot, tile, accelerator);
    }

    if (accelerator.type === 'none' && supportsBuiltinComponentEvaluation(snapshot.functionKey)) {
        const componentStep = createBuiltinComponentStep(snapshot.functionKey, snapshot);
        if (!componentStep) return null;
        const step = (zr, zi, _cr, _ci, _paramRe, _paramIm, out) => componentStep(zr, zi, out);
        const separable = separableBuiltinKind(snapshot.functionKey, snapshot);
        if (value && separable) {
            const axisCache = new Map();
            return tile => renderSeparableBuiltinValueTile(
                snapshot, tile, separable, componentStep, axisCache, accelerator.scratch
            );
        }
        if (value) return tile => renderFixedPointValueTile(snapshot, tile, step, { scratch: accelerator.scratch });
    }

    if (!value && supportsComponentOrbitEvaluation(snapshot, accelerator)) {
        return createComponentOrbitTileRenderer(snapshot, accelerator);
    }
    return null;
}

const acceleratedTileRendererCache = new WeakMap();

function getAcceleratedTileRenderer(snapshot, accelerator) {
    if (immutableDynamicsSnapshots.has(snapshot)) {
        const cached = acceleratedTileRendererCache.get(snapshot);
        if (cached) return cached;
        const renderer = createAcceleratedTileRenderer(snapshot, accelerator);
        acceleratedTileRendererCache.set(snapshot, renderer);
        return renderer;
    }
    return createAcceleratedTileRenderer(snapshot, accelerator);
}

function evaluateRasterValueInto(snapshot, re, im, accelerator, out) {
    if (!supportsComponentValueEvaluation(snapshot, accelerator)) return false;
    const scratch = accelerator.scratch || NO_ACCELERATOR.scratch;
    const count = snapshotChainCount(snapshot);
    const mode = snapshot.chainMode || 'recursion';
    const detectFixedPoint = count >= 64;

    if (!snapshot.chainingEnabled || (count <= 1 && mode !== 'zero_seed')) {
        if (!evaluateComponentBaseInto(snapshot, accelerator, re, im, re, im, scratch)) return false;
        const vr = scratch[0], vi = scratch[1];
        if (!isFiniteDomainDynamicsValue(vr, vi)) return false;
        out[0] = vr; out[1] = vi;
        return true;
    }

    if (mode === 'zero_seed') {
        let zr = 0, zi = 0, lastRe = NaN, lastIm = NaN, hasLast = false;
        for (let i = 0; i < count; i += 1) {
            const previousRe = zr, previousIm = zi;
            if (!evaluateComponentBaseInto(snapshot, accelerator, zr, zi, re, im, scratch)) break;
            const nr = scratch[0], ni = scratch[1];
            if (!isFiniteDomainDynamicsValue(nr, ni)) break;
            zr = nr; zi = ni; lastRe = nr; lastIm = ni; hasLast = true;
            if ((detectFixedPoint && Object.is(nr, previousRe) && Object.is(ni, previousIm)) ||
                domainDynamicsChainBailsOut(nr, ni)) break;
        }
        if (!hasLast) return false;
        out[0] = lastRe; out[1] = lastIm;
        return true;
    }

    if (!evaluateComponentBaseInto(snapshot, accelerator, re, im, re, im, scratch)) return false;
    let zr = scratch[0], zi = scratch[1];
    if (!isFiniteDomainDynamicsValue(zr, zi)) return false;
    let lastRe = zr, lastIm = zi;
    if ((detectFixedPoint && Object.is(zr, re) && Object.is(zi, im)) || domainDynamicsChainBailsOut(zr, zi)) {
        out[0] = zr; out[1] = zi;
        return true;
    }
    for (let i = 1; i < count; i += 1) {
        if (!evaluateComponentBaseInto(snapshot, accelerator, zr, zi, re, im, scratch)) break;
        const nr = scratch[0], ni = scratch[1];
        if (!isFiniteDomainDynamicsValue(nr, ni)) break;
        if (detectFixedPoint && Object.is(nr, lastRe) && Object.is(ni, lastIm)) {
            lastRe = nr; lastIm = ni;
            break;
        }
        zr = nr; zi = ni; lastRe = nr; lastIm = ni;
        if (domainDynamicsChainBailsOut(nr, ni)) break;
    }
    out[0] = lastRe; out[1] = lastIm;
    return true;
}

const ADAPTIVE_AA_EDGE_THRESHOLD = 80;
const ADAPTIVE_AA_SUBPIXEL_GRID_SIZE = 4;
const ADAPTIVE_AA_SUBPIXEL_SAMPLE_COUNT = ADAPTIVE_AA_SUBPIXEL_GRID_SIZE ** 2;
const ADAPTIVE_AA_SUBPIXEL_OFFSETS = Object.freeze(
    Array.from(
        { length: ADAPTIVE_AA_SUBPIXEL_GRID_SIZE },
        (_, index) => (index + 0.5) / ADAPTIVE_AA_SUBPIXEL_GRID_SIZE - 0.5
    )
);

// Smooth pixels keep the one-sample result. Every detected discontinuity receives
// the same 4x4 subpixel integration, independent of which worker tile contains it;
// this avoids quality-tier boundaries becoming visible as a tile grid.
function createAdaptiveQualityEnhancer(snapshot, accelerator, acceleratedPointWriter = null) {
    let mask = new Uint8Array(0);
    const subpixelRgba = new Uint8ClampedArray(4);
    const subpixelValue = new Float64Array(2);
    const valueColoring = snapshotUsesValueColoring(snapshot);
    const componentValue = valueColoring && supportsComponentValueEvaluation(snapshot, accelerator);
    const colors = colorContext(snapshot);
    const componentOrbitPoint = !valueColoring
        ? acceleratedPointWriter || createComponentOrbitPointWriter(snapshot, accelerator, colors)
        : null;

    function ensureCapacity(pixelCount) {
        if (mask.length < pixelCount) mask = new Uint8Array(pixelCount);
    }

    function markEdges(data, width, height) {
        const pixels = width * height;
        mask.fill(0, 0, pixels);
        let count = 0;
        const threshold = ADAPTIVE_AA_EDGE_THRESHOLD;

        // Visit each horizontal/vertical pixel pair exactly once and mark both
        // endpoints. This is equivalent to four-neighbor edge detection but halves
        // the comparison work and removes Math.max/Math.abs call overhead.
        for (let y = 0; y < height; y += 1) {
            let p = y * width;
            let i = p << 2;
            for (let x = 1; x < width; x += 1, p += 1, i += 4) {
                const j = i + 4;
                let d0 = data[i] - data[j]; if (d0 < 0) d0 = -d0;
                let d1 = data[i + 1] - data[j + 1]; if (d1 < 0) d1 = -d1;
                let d2 = data[i + 2] - data[j + 2]; if (d2 < 0) d2 = -d2;
                if (d0 >= threshold || d1 >= threshold || d2 >= threshold) {
                    if (!mask[p]) { mask[p] = 1; count += 1; }
                    if (!mask[p + 1]) { mask[p + 1] = 1; count += 1; }
                }
            }
        }
        for (let y = 1; y < height; y += 1) {
            let top = (y - 1) * width;
            let bottom = y * width;
            let i = top << 2;
            let j = bottom << 2;
            for (let x = 0; x < width; x += 1, top += 1, bottom += 1, i += 4, j += 4) {
                let d0 = data[i] - data[j]; if (d0 < 0) d0 = -d0;
                let d1 = data[i + 1] - data[j + 1]; if (d1 < 0) d1 = -d1;
                let d2 = data[i + 2] - data[j + 2]; if (d2 < 0) d2 = -d2;
                if (d0 >= threshold || d1 >= threshold || d2 >= threshold) {
                    if (!mask[top]) { mask[top] = 1; count += 1; }
                    if (!mask[bottom]) { mask[bottom] = 1; count += 1; }
                }
            }
        }
        return count;
    }

    function supersampleSparseEdges(data, tile) {
        const width = tile.width;
        const height = tile.height;
        const xRange = snapshot.viewport.xRange;
        const yRange = snapshot.viewport.yRange;
        const spanX = xRange[1] - xRange[0];
        const spanY = yRange[1] - yRange[0];
        const xStep = tile.scale * spanX / snapshot.viewport.width;
        const yStep = -tile.scale * spanY / snapshot.viewport.height;
        const xStart = xRange[0] + (tile.x + 0.5) * tile.scale * spanX / snapshot.viewport.width;
        const yStart = yRange[1] - (tile.y + 0.5) * tile.scale * spanY / snapshot.viewport.height;
        const sampleOffsets = ADAPTIVE_AA_SUBPIXEL_OFFSETS;
        const sampleCount = ADAPTIVE_AA_SUBPIXEL_SAMPLE_COUNT;
        const sampleGridSize = ADAPTIVE_AA_SUBPIXEL_GRID_SIZE;

        for (let y = 0; y < height; y += 1) {
            const im = yStart + y * yStep;
            for (let x = 0; x < width; x += 1) {
                const p = y * width + x;
                if (!mask[p]) continue;
                const re = xStart + x * xStep;
                let sumR = 0;
                let sumG = 0;
                let sumB = 0;
                for (let sampleY = 0; sampleY < sampleGridSize; sampleY += 1) {
                    const sampleIm = im + yStep * sampleOffsets[sampleY];
                    for (let sampleX = 0; sampleX < sampleGridSize; sampleX += 1) {
                        const sampleRe = re + xStep * sampleOffsets[sampleX];
                        if (componentValue) {
                            if (evaluateRasterValueInto(snapshot, sampleRe, sampleIm, accelerator, subpixelValue)) {
                                writeDomainColorWithContext(
                                    subpixelRgba,
                                    0,
                                    subpixelValue[0],
                                    subpixelValue[1],
                                    colors
                                );
                            } else {
                                writeBlack(subpixelRgba, 0);
                            }
                            sumR += subpixelRgba[0];
                            sumG += subpixelRgba[1];
                            sumB += subpixelRgba[2];
                        } else if (componentOrbitPoint) {
                            componentOrbitPoint(subpixelRgba, 0, sampleRe, sampleIm);
                            sumR += subpixelRgba[0];
                            sumG += subpixelRgba[1];
                            sumB += subpixelRgba[2];
                        } else {
                            const rgb = colorDomainDynamicsPoint(snapshot, sampleRe, sampleIm, accelerator);
                            sumR += rgb[0];
                            sumG += rgb[1];
                            sumB += rgb[2];
                        }
                    }
                }
                const i = p << 2;
                data[i] = Math.floor((sumR + sampleCount * 0.5) / sampleCount);
                data[i + 1] = Math.floor((sumG + sampleCount * 0.5) / sampleCount);
                data[i + 2] = Math.floor((sumB + sampleCount * 0.5) / sampleCount);
                data[i + 3] = 255;
            }
        }
    }

    return (data, tile) => {
        if (!data || tile.scale !== 1 || tile.width < 2 || tile.height < 2) return data;
        const pixelCount = tile.width * tile.height;
        ensureCapacity(pixelCount);
        const edgeCount = markEdges(data, tile.width, tile.height);
        if (edgeCount === 0) return data;
        supersampleSparseEdges(data, tile);
        return data;
    };
}

export function createDomainDynamicsTileRenderer(snapshot) {
    const accelerator = createDynamicsAccelerator(snapshot);
    const accelerated = getAcceleratedTileRenderer(snapshot, accelerator);
    const enhanceQuality = createAdaptiveQualityEnhancer(snapshot, accelerator, accelerated?.writePoint);
    const spatiallyConstantZeroSeed = snapshot?.chainMode === 'zero_seed' &&
        snapshot?.functionKey !== 'algebraic_chaining' && snapshot?.functionKey !== 'c';
    let constantRgba = null;

    function renderBaseTile(tile) {
        if (spatiallyConstantZeroSeed) {
            if (!constantRgba) {
                const rgb = colorDomainDynamicsPoint(snapshot, 0, 0, accelerator);
                constantRgba = [rgb[0], rgb[1], rgb[2], 255];
            }
            return createSolidRgbaBuffer(
                tile.width * tile.height,
                constantRgba[0], constantRgba[1], constantRgba[2], constantRgba[3]
            );
        }
        const duplicateSampleTile = renderDuplicateSampleValueTile(snapshot, tile, accelerator);
        return duplicateSampleTile || accelerated?.(tile) || renderGenericDomainDynamicsTile(snapshot, tile, accelerator);
    }

    function enhanceQualityWithHalo(pixels, tile) {
        if (tile.scale !== 1 || tile.width < 2 || tile.height < 2) {
            return pixels;
        }
        const viewportWidth = Math.max(1, Math.floor(snapshot.viewport.width));
        const viewportHeight = Math.max(1, Math.floor(snapshot.viewport.height));
        const leftHalo = tile.x > 0 ? 1 : 0;
        const topHalo = tile.y > 0 ? 1 : 0;
        const rightHalo = tile.x + tile.width < viewportWidth ? 1 : 0;
        const bottomHalo = tile.y + tile.height < viewportHeight ? 1 : 0;

        if (!(leftHalo || topHalo || rightHalo || bottomHalo)) {
            return enhanceQuality(pixels, tile);
        }

        const paddedTile = {
            x: tile.x - leftHalo,
            y: tile.y - topHalo,
            width: tile.width + leftHalo + rightHalo,
            height: tile.height + topHalo + bottomHalo,
            scale: 1,
            deferQuality: true
        };
        const paddedStride = paddedTile.width << 2;
        const sourceStride = tile.width << 2;
        const padded = new Uint8ClampedArray(paddedStride * paddedTile.height);

        if (topHalo) {
            padded.set(renderBaseTile({ ...paddedTile, height: 1 }), 0);
        }
        if (bottomHalo) {
            const bottom = renderBaseTile({
                ...paddedTile,
                y: tile.y + tile.height,
                height: 1
            });
            padded.set(bottom, (paddedTile.height - 1) * paddedStride);
        }
        if (leftHalo) {
            const left = renderBaseTile({
                x: paddedTile.x,
                y: tile.y,
                width: 1,
                height: tile.height,
                scale: 1,
                deferQuality: true
            });
            for (let y = 0; y < tile.height; y += 1) {
                const sourceOffset = y << 2;
                const targetOffset = (y + topHalo) * paddedStride;
                padded.set(left.subarray(sourceOffset, sourceOffset + 4), targetOffset);
            }
        }
        if (rightHalo) {
            const right = renderBaseTile({
                x: tile.x + tile.width,
                y: tile.y,
                width: 1,
                height: tile.height,
                scale: 1,
                deferQuality: true
            });
            const targetX = paddedTile.width - 1;
            for (let y = 0; y < tile.height; y += 1) {
                const sourceOffset = y << 2;
                const targetOffset = ((y + topHalo) * paddedTile.width + targetX) << 2;
                padded.set(right.subarray(sourceOffset, sourceOffset + 4), targetOffset);
            }
        }
        for (let y = 0; y < tile.height; y += 1) {
            const sourceOffset = y * sourceStride;
            const targetOffset = (y + topHalo) * paddedStride + (leftHalo << 2);
            padded.set(pixels.subarray(sourceOffset, sourceOffset + sourceStride), targetOffset);
        }

        enhanceQuality(padded, paddedTile);
        for (let y = 0; y < tile.height; y += 1) {
            const sourceOffset = (y + topHalo) * paddedStride + (leftHalo << 2);
            const targetOffset = y * sourceStride;
            pixels.set(padded.subarray(sourceOffset, sourceOffset + sourceStride), targetOffset);
        }
        return pixels;
    }

    return tile => {
        // Internal progressive-quality protocol. Existing callers never set these
        // fields and therefore retain the synchronous high-quality result.
        if (tile?.qualityOnly) {
            const pixels = tile.basePixels;
            if (spatiallyConstantZeroSeed) {
                return pixels instanceof Uint8ClampedArray ? pixels : renderBaseTile(tile);
            }
            if (pixels instanceof Uint8ClampedArray && pixels.length === tile.width * tile.height * 4) {
                return enhanceQualityWithHalo(pixels, tile);
            }
            return enhanceQualityWithHalo(renderBaseTile(tile), tile);
        }
        const data = renderBaseTile(tile);
        if (spatiallyConstantZeroSeed || tile?.deferQuality) return data;
        return enhanceQualityWithHalo(data, tile);
    };
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

function expBaseComponents(re, im, baseRe, baseIm, out) {
    const baseLogRe = Math.log(Math.hypot(baseRe, baseIm));
    const baseLogIm = Math.atan2(baseIm, baseRe);
    return expComponents(
        re * baseLogRe - im * baseLogIm,
        re * baseLogIm + im * baseLogRe,
        out
    );
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

function lnBaseComponents(re, im, baseRe, baseIm, out) {
    lnComponents(re, im, out);
    const baseLogRe = Math.log(Math.hypot(baseRe, baseIm));
    const baseLogIm = Math.atan2(baseIm, baseRe);
    return divideComponents(out[0], out[1], baseLogRe, baseLogIm, out);
}

function evaluateBuiltinComponents(functionKey, re, im, snapshot, out) {
    switch (functionKey) {
        case 'exp':
            return expBaseComponents(
                re,
                im,
                scalarRe(snapshot.expBase ?? { re: Math.E, im: 0 }),
                scalarIm(snapshot.expBase),
                out
            );
        case 'ln':
            return lnBaseComponents(
                re,
                im,
                scalarRe(snapshot.logBase ?? { re: Math.E, im: 0 }),
                scalarIm(snapshot.logBase),
                out
            );
        case 'sin':
            out[0] = Math.sin(re) * Math.cosh(im);
            out[1] = Math.cos(re) * Math.sinh(im);
            return out;
        case 'cos':
            out[0] = Math.cos(re) * Math.cosh(im);
            out[1] = -Math.sin(re) * Math.sinh(im);
            return out;
        case 'tan': {
            const sinX = Math.sin(re);
            const cosX = Math.cos(re);
            const sinhY = Math.sinh(im);
            const coshY = Math.cosh(im);
            return divideComponents(sinX * coshY, cosX * sinhY, cosX * coshY, -sinX * sinhY, out);
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
            const sinhX = Math.sinh(re);
            const coshX = Math.cosh(re);
            const sinY = Math.sin(im);
            const cosY = Math.cos(im);
            return divideComponents(sinhX * cosY, coshX * sinY, coshX * cosY, sinhX * sinY, out);
        }
        case 'asin': {
            const value = complexAsin(re, im);
            out[0] = value.re;
            out[1] = value.im;
            return out;
        }
        case 'atan': {
            const value = complexAtan(re, im);
            out[0] = value.re;
            out[1] = value.im;
            return out;
        }
        case 'gamma': {
            const value = complexGamma(re, im);
            out[0] = value.re;
            out[1] = value.im;
            return out;
        }
        case 'loggamma': {
            const value = complexLogGamma(re, im);
            out[0] = value.re;
            out[1] = value.im;
            return out;
        }
        case 'bessel': {
            const value = complexBesselJ(re, im, snapshot.besselOrder);
            out[0] = value.re;
            out[1] = value.im;
            return out;
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

function supportsBuiltinComponentEvaluation(functionKey) {
    switch (functionKey) {
        case 'exp':
        case 'ln':
        case 'sin':
        case 'cos':
        case 'tan':
        case 'sec':
        case 'reciprocal':
        case 'sinh':
        case 'cosh':
        case 'tanh':
        case 'asin':
        case 'atan':
        case 'gamma':
        case 'loggamma':
        case 'bessel':
        case 'power':
        case 'mobius':
        case 'polynomial':
        case 'poincare':
        case 'zeta':
        case 'c':
            return true;
        default:
            return false;
    }
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

function renderDirectZetaValueTile(snapshot, tile, accelerator) {
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
    const termCount = continuation ? NUM_ZETA_HASSE_LEVELS : NUM_ZETA_TERMS_DIRECT_SUM;
    const collapsed = continuation ? zetaHasseCollapsedTerms(NUM_ZETA_HASSE_LEVELS) : null;
    const coeffs = collapsed?.coeffs || null;
    const logs = collapsed?.logs || null;
    if (!continuation) ensureZetaLogIntegerCache(NUM_ZETA_TERMS_DIRECT_SUM);

    // Axis transcendental tables are invariant across sibling tiles. Persist them
    // on the snapshot accelerator, keyed by exact tile geometry, so progressive
    // 64x64 tiling computes each x-column and y-row basis only once per pass.
    const cache = accelerator?.type === 'direct-zeta' ? accelerator : null;
    if (cache && !cache.axisTables) cache.axisTables = new Map();
    const xKey = cache ? `${continuation ? 1 : 0}:x:${tile.scale}:${tile.x}:${width}` : null;
    const yKey = cache ? `${continuation ? 1 : 0}:y:${tile.scale}:${tile.y}:${height}` : null;

    let xTable = xKey ? cache.axisTables.get(xKey) : null;
    if (!xTable) {
        const magByX = new Float64Array(width * termCount);
        for (let x = 0; x < width; x += 1) {
            const re = xStart + x * xStep;
            const base = x * termCount;
            for (let t = 0; t < termCount; t += 1) {
                const logN = continuation ? logs[t] : zetaLogIntegerCache[t + 1];
                const coeff = continuation ? coeffs[t] : 1;
                magByX[base + t] = coeff * expSafe(-re * logN);
            }
        }
        let denMagX = null;
        if (continuation) {
            const log2 = Math.log(2);
            denMagX = new Float64Array(width);
            for (let x = 0; x < width; x += 1) denMagX[x] = expSafe((1 - (xStart + x * xStep)) * log2);
        }
        xTable = { magByX, denMagX };
        if (xKey) cache.axisTables.set(xKey, xTable);
    }

    let yTable = yKey ? cache.axisTables.get(yKey) : null;
    if (!yTable) {
        const cosSinByY = new Float64Array(height * termCount * 2);
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
        let denCosSinY = null;
        if (continuation) {
            const log2 = Math.log(2);
            denCosSinY = new Float64Array(height * 2);
            for (let y = 0; y < height; y += 1) {
                const angle = -(yStart + y * yStep) * log2;
                denCosSinY[y << 1] = Math.cos(angle);
                denCosSinY[(y << 1) + 1] = Math.sin(angle);
            }
        }
        yTable = { cosSinByY, denCosSinY };
        if (yKey) cache.axisTables.set(yKey, yTable);
    }

    const magByX = xTable.magByX;
    const cosSinByY = yTable.cosSinByY;
    const denMagX = xTable.denMagX;
    const denCosSinY = yTable.denCosSinY;
    const scratch = continuation ? (cache?.scratch || new Float64Array(2)) : null;

    // Four-column blocking keeps four independent complex sums in registers while
    // sharing each row-phase load. Each pixel still accumulates t=0..N-1 in the
    // original order, so the byte output remains deterministic and unchanged.
    for (let y = 0; y < height; y += 1) {
        const phaseBase = y * termCount * 2;
        let x = 0;
        let re = xStart;
        for (; x + 3 < width; x += 4) {
            const b0 = x * termCount;
            const b1 = b0 + termCount;
            const b2 = b1 + termCount;
            const b3 = b2 + termCount;
            let sr0 = 0, si0 = 0, sr1 = 0, si1 = 0;
            let sr2 = 0, si2 = 0, sr3 = 0, si3 = 0;
            for (let t = 0; t < termCount; t += 1) {
                const phase = phaseBase + (t << 1);
                const c = cosSinByY[phase];
                const q = cosSinByY[phase + 1];
                let m = magByX[b0 + t]; sr0 += m * c; si0 += m * q;
                m = magByX[b1 + t]; sr1 += m * c; si1 += m * q;
                m = magByX[b2 + t]; sr2 += m * c; si2 += m * q;
                m = magByX[b3 + t]; sr3 += m * c; si3 += m * q;
            }

            const re0 = re;
            const re1 = re0 + xStep;
            const re2 = re1 + xStep;
            const re3 = re2 + xStep;
            if (continuation) {
                const denPhase = y << 1;
                const dc = denCosSinY[denPhase];
                const ds = denCosSinY[denPhase + 1];
                let denMag = denMagX[x];
                let denRe = 1 - denMag * dc, denIm = -denMag * ds;
                if (denRe * denRe + denIm * denIm < 1e-28) zetaComponents(re0, yStart + y * yStep, true, scratch);
                else divideComponents(sr0, si0, denRe, denIm, scratch);
                sr0 = scratch[0]; si0 = scratch[1];

                denMag = denMagX[x + 1]; denRe = 1 - denMag * dc; denIm = -denMag * ds;
                if (denRe * denRe + denIm * denIm < 1e-28) zetaComponents(re1, yStart + y * yStep, true, scratch);
                else divideComponents(sr1, si1, denRe, denIm, scratch);
                sr1 = scratch[0]; si1 = scratch[1];

                denMag = denMagX[x + 2]; denRe = 1 - denMag * dc; denIm = -denMag * ds;
                if (denRe * denRe + denIm * denIm < 1e-28) zetaComponents(re2, yStart + y * yStep, true, scratch);
                else divideComponents(sr2, si2, denRe, denIm, scratch);
                sr2 = scratch[0]; si2 = scratch[1];

                denMag = denMagX[x + 3]; denRe = 1 - denMag * dc; denIm = -denMag * ds;
                if (denRe * denRe + denIm * denIm < 1e-28) zetaComponents(re3, yStart + y * yStep, true, scratch);
                else divideComponents(sr3, si3, denRe, denIm, scratch);
                sr3 = scratch[0]; si3 = scratch[1];
            }

            let idx = (y * width + x) * 4;
            if (!continuation && re0 <= ZETA_REFLECTION_POINT_RE) writeBlack(data, idx);
            else writeDomainColorWithContext(data, idx, sr0, si0, colors);
            idx += 4;
            if (!continuation && re1 <= ZETA_REFLECTION_POINT_RE) writeBlack(data, idx);
            else writeDomainColorWithContext(data, idx, sr1, si1, colors);
            idx += 4;
            if (!continuation && re2 <= ZETA_REFLECTION_POINT_RE) writeBlack(data, idx);
            else writeDomainColorWithContext(data, idx, sr2, si2, colors);
            idx += 4;
            if (!continuation && re3 <= ZETA_REFLECTION_POINT_RE) writeBlack(data, idx);
            else writeDomainColorWithContext(data, idx, sr3, si3, colors);
            re = re3 + xStep;
        }

        for (; x < width; x += 1, re += xStep) {
            const magBase = x * termCount;
            let sumRe = 0, sumIm = 0;
            for (let t = 0; t < termCount; t += 1) {
                const phase = phaseBase + (t << 1);
                const magnitude = magByX[magBase + t];
                sumRe += magnitude * cosSinByY[phase];
                sumIm += magnitude * cosSinByY[phase + 1];
            }
            if (continuation) {
                const denPhase = y << 1;
                const denMag = denMagX[x];
                const denRe = 1 - denMag * denCosSinY[denPhase];
                const denIm = -denMag * denCosSinY[denPhase + 1];
                if (denRe * denRe + denIm * denIm < 1e-28) zetaComponents(re, yStart + y * yStep, true, scratch);
                else divideComponents(sumRe, sumIm, denRe, denIm, scratch);
                sumRe = scratch[0]; sumIm = scratch[1];
            }
            const idx = (y * width + x) * 4;
            if (!continuation && re <= ZETA_REFLECTION_POINT_RE) writeBlack(data, idx);
            else writeDomainColorWithContext(data, idx, sumRe, sumIm, colors);
        }
    }

    return data;
}

function renderGenericDomainDynamicsTile(snapshot, tile, accelerator) {
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

export function renderDomainDynamicsTile(snapshot, tile, accelerator = createDynamicsAccelerator(snapshot)) {
    const duplicateSampleTile = snapshot.derivativeMode
        ? null
        : renderDuplicateSampleValueTile(snapshot, tile, accelerator);
    if (duplicateSampleTile) return duplicateSampleTile;
    const accelerated = getAcceleratedTileRenderer(snapshot, accelerator);
    return accelerated?.(tile) || renderGenericDomainDynamicsTile(snapshot, tile, accelerator);
}

export function domainDynamicsSignature(snapshot) {
    return JSON.stringify({
        functionKey: snapshot.functionKey,
        derivativeMode: !!snapshot.derivativeMode,
        expBase: snapshot.expBase,
        logBase: snapshot.logBase,
        besselOrder: snapshot.besselOrder,
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
        branchCutType: snapshot.branchCutType,
        branchCutAngle: snapshot.branchCutAngle,
        zetaContinuationEnabled: snapshot.zetaContinuationEnabled,
        taylor: snapshot.taylor,
        dynamicAggregate: snapshot.dynamicAggregate,
        style: snapshot.style,
        paletteStops: snapshot.paletteStops,
        viewport: snapshot.viewport
    });
}

export function isDomainDynamicsSnapshot(snapshot) {
    const mode = resolveOrbitColoringMode(snapshot);
    return !!snapshot &&
        !snapshot.isWPlaneColoring &&
        (
            mode === ORBIT_COLORING_MODES.value ||
            snapshot.chainMode === 'recursion' ||
            snapshot.chainMode === 'zero_seed'
        );
}
