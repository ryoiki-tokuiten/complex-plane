import { state, subscribeState } from './store/state.js';
import { runtime } from './store/runtime.js';
import { compileExpression } from './math/expression/evaluator.js';

let cachesDirty = true;
const mappedProfileCache = new Map();
const chainedFuncCache = new Map();

const TRANSFORM_STATE_KEYS = new Set([
    'a0', 'b0', 'currentFunction', 'mapPresentation',
    'mobiusA', 'mobiusB', 'mobiusC', 'mobiusD',
    'polynomialN', 'polynomialCoeffs', 'fractionalPowerN',
    'zetaContinuationEnabled', 'chainingEnabled', 'chainingMode', 'chainCount',
    'algebraicChainingEnabled', 'algebraicChainingZExpr', 'algebraicChainingTerms',
    'taylorSeriesEnabled', 'taylorSeriesOrder', 'taylorSeriesCenter',
    'dynamicPlotting', 'fourierModeEnabled', 'laplaceModeEnabled'
]);

subscribeState(() => {
    cachesDirty = true;
    invalidateHotPathCaches();
}, TRANSFORM_STATE_KEYS);

import {
    POLE_MAGNITUDE_THRESHOLD,
    MAX_POLY_DEGREE,
    DEFAULT_TAYLOR_SERIES_CENTER,
    TWO_PI,
    PI,
    ZETA_REFLECTION_POINT_RE,
    NUM_ZETA_TERMS_DIRECT_SUM,
    NUM_ZETA_TERMS_ETA_SERIES,
    NUM_ZETA_HASSE_LEVELS
} from './constants/numerical.js';

// This module is intentionally built around a tiny complex-number kernel.

const ZERO = Object.freeze({ re: 0, im: 0 });
const ONE = Object.freeze({ re: 1, im: 0 });
const NAN_COMPLEX = Object.freeze({ re: NaN, im: NaN });
const COMPLEX_ZERO_EPSILON = 1e-15;
const COMPLEX_ZERO_MAG_SQ = 1e-30;
const DEFAULT_FRACTIONAL_POWER = 0.5;
const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);
const LN_2 = Math.log(2);
let activeTransformProvider = null;

const isObject = value => value !== null && typeof value === 'object';
const finite = Number.isFinite;
const realOf = value => value?.re ?? value?.real ?? 0;
const imagOf = value => value?.im ?? value?.imag ?? 0;
const argRe = value => isObject(value) ? realOf(value) : (value ?? 0);
const argIm = (value, fallback = 0) => isObject(value) ? imagOf(value) : (fallback ?? 0);
const resultComplex = (re, im) => ({ re, im });

function divideRaw(nRe, nIm, dRe, dIm) {
    const absRe = Math.abs(dRe);
    const absIm = Math.abs(dIm);
    const scale = Math.max(absRe, absIm);

    if (scale < COMPLEX_ZERO_EPSILON) {
        const numMagSq = nRe * nRe + nIm * nIm;
        if (numMagSq < COMPLEX_ZERO_MAG_SQ) return { re: NaN, im: NaN };
        if (Math.abs(nRe) < COMPLEX_ZERO_EPSILON && Math.abs(nIm) < COMPLEX_ZERO_EPSILON) {
            return { re: 0, im: 0 };
        }

        const largeValue = POLE_MAGNITUDE_THRESHOLD * 2;
        const safeScale = largeValue / Math.sqrt(numMagSq);
        return { re: nRe * safeScale, im: nIm * safeScale };
    }

    if (absRe >= absIm) {
        const ratio = dIm / dRe;
        const divisor = dRe + dIm * ratio;
        return {
            re: (nRe + nIm * ratio) / divisor,
            im: (nIm - nRe * ratio) / divisor
        };
    }

    const ratio = dRe / dIm;
    const divisor = dIm + dRe * ratio;
    return {
        re: (nRe * ratio + nIm) / divisor,
        im: (nIm * ratio - nRe) / divisor
    };
}

function divideRawInto(nRe, nIm, dRe, dIm, out, offset = 0) {
    const absRe = Math.abs(dRe);
    const absIm = Math.abs(dIm);
    const scale = Math.max(absRe, absIm);

    if (scale < COMPLEX_ZERO_EPSILON) {
        const numMagSq = nRe * nRe + nIm * nIm;
        if (numMagSq < COMPLEX_ZERO_MAG_SQ) {
            out[offset] = NaN;
            out[offset + 1] = NaN;
            return out;
        }
        if (Math.abs(nRe) < COMPLEX_ZERO_EPSILON && Math.abs(nIm) < COMPLEX_ZERO_EPSILON) {
            out[offset] = 0;
            out[offset + 1] = 0;
            return out;
        }

        const largeValue = POLE_MAGNITUDE_THRESHOLD * 2;
        const safeScale = largeValue / Math.sqrt(numMagSq);
        out[offset] = nRe * safeScale;
        out[offset + 1] = nIm * safeScale;
        return out;
    }

    if (absRe >= absIm) {
        const ratio = dIm / dRe;
        const divisor = dRe + dIm * ratio;
        out[offset] = (nRe + nIm * ratio) / divisor;
        out[offset + 1] = (nIm - nRe * ratio) / divisor;
        return out;
    }

    const ratio = dRe / dIm;
    const divisor = dIm + dRe * ratio;
    out[offset] = (nRe * ratio + nIm) / divisor;
    out[offset + 1] = (nIm * ratio - nRe) / divisor;
    return out;
}

function reciprocalRaw(re, im) {
    if (re === 0 && im === 0) return { re: NaN, im: NaN };
    return divideRaw(1, 0, re, im);
}

function multiplyRaw(aRe, aIm, bRe, bIm) {
    return { re: aRe * bRe - aIm * bIm, im: aRe * bIm + aIm * bRe };
}

function expRaw(re, im) {
    const magnitude = expSafe(re);
    return { re: magnitude * Math.cos(im), im: magnitude * Math.sin(im) };
}

function expRawInto(re, im, out, offset = 0) {
    const magnitude = expSafe(re);
    out[offset] = magnitude * Math.cos(im);
    out[offset + 1] = magnitude * Math.sin(im);
    return out;
}

function logHypot(re, im) {
    const absRe = Math.abs(re);
    const absIm = Math.abs(im);
    const scale = absRe > absIm ? absRe : absIm;
    if (scale === 0) return -Infinity;
    // The square path is dramatically cheaper than Math.hypot and is exact enough
    // for the bounded rendering domain; the scaled path preserves overflow safety.
    if (scale < 1e154 && scale > 1e-154) return 0.5 * Math.log(re * re + im * im);
    return Math.log(Math.hypot(re, im));
}

function powRealBaseRaw(baseRe, expRe) {
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

function powRealBaseInto(baseRe, expRe, out, offset = 0) {
    const value = powRealBaseRaw(baseRe, expRe);
    out[offset] = value.re;
    out[offset + 1] = value.im;
    return out;
}

function powIntegerRaw(re, im, exponent) {
    if (exponent === 0) return { re: 1, im: 0 };
    if (exponent === 1) return { re, im };
    if (exponent === -1) return reciprocalRaw(re, im);

    const negative = exponent < 0;
    let n = Math.abs(exponent);
    let accRe = 1;
    let accIm = 0;
    let baseRe = re;
    let baseIm = im;

    while (n > 0) {
        if (n % 2 === 1) {
            const nextRe = accRe * baseRe - accIm * baseIm;
            accIm = accRe * baseIm + accIm * baseRe;
            accRe = nextRe;
        }
        n = Math.floor(n / 2);
        if (n > 0) {
            const nextBaseRe = baseRe * baseRe - baseIm * baseIm;
            baseIm = 2 * baseRe * baseIm;
            baseRe = nextBaseRe;
        }
    }

    return negative ? reciprocalRaw(accRe, accIm) : { re: accRe, im: accIm };
}

function powIntegerInto(re, im, exponent, out, offset = 0) {
    if (exponent === 0) {
        out[offset] = 1;
        out[offset + 1] = 0;
        return out;
    }
    if (exponent === 1) {
        out[offset] = re;
        out[offset + 1] = im;
        return out;
    }

    const negative = exponent < 0;
    let n = Math.abs(exponent);
    let accRe = 1;
    let accIm = 0;
    let baseRe = re;
    let baseIm = im;

    while (n > 0) {
        if (n % 2 === 1) {
            const nextRe = accRe * baseRe - accIm * baseIm;
            accIm = accRe * baseIm + accIm * baseRe;
            accRe = nextRe;
        }
        n = Math.floor(n / 2);
        if (n > 0) {
            const nextBaseRe = baseRe * baseRe - baseIm * baseIm;
            baseIm = 2 * baseRe * baseIm;
            baseRe = nextBaseRe;
        }
    }

    if (negative) {
        return divideRawInto(1, 0, accRe, accIm, out, offset);
    }
    out[offset] = accRe;
    out[offset + 1] = accIm;
    return out;
}

function powRaw(baseRe, baseIm, expRe, expIm) {
    if (baseRe === 0 && baseIm === 0) {
        if (expRe > 0 || (expRe === 0 && expIm !== 0)) return { re: 0, im: 0 };
        if (expRe === 0 && expIm === 0) return { re: 1, im: 0 };
    }

    if (expIm === 0 && Number.isSafeInteger(expRe)) {
        return powIntegerRaw(baseRe, baseIm, expRe);
    }

    if (baseIm === 0 && expIm === 0) {
        return powRealBaseRaw(baseRe, expRe);
    }

    const lnRe = logHypot(baseRe, baseIm);
    const lnIm = Math.atan2(baseIm, baseRe);
    const outRe = expRe * lnRe - expIm * lnIm;
    const outIm = expRe * lnIm + expIm * lnRe;
    return expRaw(outRe, outIm);
}

function powRawInto(baseRe, baseIm, expRe, expIm, out, offset = 0) {
    if (baseRe === 0 && baseIm === 0) {
        if (expRe > 0 || (expRe === 0 && expIm !== 0)) {
            out[offset] = 0;
            out[offset + 1] = 0;
            return out;
        }
        if (expRe === 0 && expIm === 0) {
            out[offset] = 1;
            out[offset + 1] = 0;
            return out;
        }
    }

    if (expIm === 0 && Number.isSafeInteger(expRe)) {
        return powIntegerInto(baseRe, baseIm, expRe, out, offset);
    }

    if (baseIm === 0 && expIm === 0) {
        return powRealBaseInto(baseRe, expRe, out, offset);
    }

    const lnRe = logHypot(baseRe, baseIm);
    const lnIm = Math.atan2(baseIm, baseRe);
    return expRawInto(expRe * lnRe - expIm * lnIm, expRe * lnIm + expIm * lnRe, out, offset);
}

function positiveRealPowComponents(logBase, expRe, expIm) {
    const magnitude = expSafe(expRe * logBase);
    const angle = expIm * logBase;
    return { re: magnitude * Math.cos(angle), im: magnitude * Math.sin(angle) };
}

function zetaEtaDenominator(a, b) {
    const magnitude = expSafe((1 - a) * LN_2);
    const angle = -b * LN_2;
    return { re: 1 - magnitude * Math.cos(angle), im: -magnitude * Math.sin(angle) };
}

const hypotComplex = value => Math.hypot(value.re, value.im);
const cloneComplex = value => ({ re: value.re, im: value.im });
const complex = (re = 0, im = 0) => ({ re, im });

function toComplex(value, im = 0) {
    return isObject(value) ? complex(realOf(value), imagOf(value)) : complex(value ?? 0, im ?? 0);
}

function normalizeUnaryComplexArgs(a, b) {
    return isObject(a) ? toComplex(a) : complex(a ?? 0, b ?? 0);
}

function normalizeBinaryComplexArgs(left, right) {
    return [toComplex(left), toComplex(right)];
}

function validComplex(value) {
    return !!value && finite(value.re) && finite(value.im);
}

function invalidComplex(value) {
    return !validComplex(value);
}

function finiteComplexOrNaN(value) {
    return validComplex(value) ? value : { re: NaN, im: NaN };
}

function addInto(target, value, scale = 1) {
    target.re += value.re * scale;
    target.im += value.im * scale;
    return target;
}

function scalarComplex(value, scale) {
    return { re: value.re * scale, im: value.im * scale };
}

function zeroLike() {
    return { re: 0, im: 0 };
}


let polynomialKernelRef = null;
let polynomialKernelDegree = -1;
let polynomialKernelRe = new Float64Array(0);
let polynomialKernelIm = new Float64Array(0);
let polynomialEvalKernel = null;
let algebraicKernelTerms = null;
let algebraicKernelZExpr = null;
let algebraicKernelPolynomialRef = null;
let algebraicKernelPolynomialDegree = -1;
let algebraicKernelMobiusA = null;
let algebraicKernelMobiusB = null;
let algebraicKernelMobiusC = null;
let algebraicKernelMobiusD = null;
let algebraicKernel = null;
let algebraicTermKernelCache = new WeakMap();

function invalidateHotPathCaches() {
    polynomialKernelRef = null;
    polynomialKernelDegree = -1;
    polynomialKernelRe = new Float64Array(0);
    polynomialKernelIm = new Float64Array(0);
    polynomialEvalKernel = null;
    algebraicKernelTerms = null;
    algebraicKernelZExpr = null;
    algebraicKernelPolynomialRef = null;
    algebraicKernelPolynomialDegree = -1;
    algebraicKernelMobiusA = null;
    algebraicKernelMobiusB = null;
    algebraicKernelMobiusC = null;
    algebraicKernelMobiusD = null;
    algebraicTermKernelCache = new WeakMap();
    algebraicKernel = null;
}

export function withMaxMag(res, ...inputs) {
    return res;
}

export function isNumericallyStable(w) {
    return true;
}

export function complexAdd(z1, z2) {
    const z1Obj = z1 !== null && typeof z1 === 'object';
    const z2Obj = z2 !== null && typeof z2 === 'object';
    const aRe = z1Obj ? (z1.re !== undefined ? z1.re : (z1.real ?? 0)) : (z1 ?? 0);
    const aIm = z1Obj ? (z1.im !== undefined ? z1.im : (z1.imag ?? 0)) : 0;
    const bRe = z2Obj ? (z2.re !== undefined ? z2.re : (z2.real ?? 0)) : (z2 ?? 0);
    const bIm = z2Obj ? (z2.im !== undefined ? z2.im : (z2.imag ?? 0)) : 0;
    return { re: aRe + bRe, im: aIm + bIm };
}

export function complexSub(z1, z2) {
    const z1Obj = z1 !== null && typeof z1 === 'object';
    const z2Obj = z2 !== null && typeof z2 === 'object';
    const aRe = z1Obj ? (z1.re !== undefined ? z1.re : (z1.real ?? 0)) : (z1 ?? 0);
    const aIm = z1Obj ? (z1.im !== undefined ? z1.im : (z1.imag ?? 0)) : 0;
    const bRe = z2Obj ? (z2.re !== undefined ? z2.re : (z2.real ?? 0)) : (z2 ?? 0);
    const bIm = z2Obj ? (z2.im !== undefined ? z2.im : (z2.imag ?? 0)) : 0;
    return { re: aRe - bRe, im: aIm - bIm };
}

export function complexMul(z1, z2) {
    const z1Obj = z1 !== null && typeof z1 === 'object';
    const z2Obj = z2 !== null && typeof z2 === 'object';
    const aRe = z1Obj ? (z1.re !== undefined ? z1.re : (z1.real ?? 0)) : (z1 ?? 0);
    const aIm = z1Obj ? (z1.im !== undefined ? z1.im : (z1.imag ?? 0)) : 0;
    const bRe = z2Obj ? (z2.re !== undefined ? z2.re : (z2.real ?? 0)) : (z2 ?? 0);
    const bIm = z2Obj ? (z2.im !== undefined ? z2.im : (z2.imag ?? 0)) : 0;
    return { re: aRe * bRe - aIm * bIm, im: aRe * bIm + aIm * bRe };
}

export function complexScalarMul(s, z) {
    return { re: s * argRe(z), im: s * argIm(z) };
}

export function complexDivide(num, den) {
    const nObj = num !== null && typeof num === 'object';
    const dObj = den !== null && typeof den === 'object';
    return divideRaw(
        nObj ? (num.re !== undefined ? num.re : (num.real ?? 0)) : (num ?? 0),
        nObj ? (num.im !== undefined ? num.im : (num.imag ?? 0)) : 0,
        dObj ? (den.re !== undefined ? den.re : (den.real ?? 0)) : (den ?? 0),
        dObj ? (den.im !== undefined ? den.im : (den.imag ?? 0)) : 0
    );
}

export function complexAbs(z) {
    return Math.hypot(argRe(z), argIm(z));
}

export function complexArg(z) {
    return Math.atan2(argIm(z), argRe(z));
}

export function _cosh(x) { return Math.cosh(x); }
export function _sinh(x) { return Math.sinh(x); }

export function complexCos(a, b) {
    const obj = isObject(a);
    const re = obj ? (a.re ?? a.real ?? 0) : (a ?? 0);
    const im = obj ? (a.im ?? a.imag ?? 0) : (b ?? 0);
    const cosh = Math.cosh(im);
    const sinh = Math.sinh(im);
    return { re: Math.cos(re) * cosh, im: -Math.sin(re) * sinh };
}

export function complexSin(a, b) {
    const obj = isObject(a);
    const re = obj ? (a.re ?? a.real ?? 0) : (a ?? 0);
    const im = obj ? (a.im ?? a.imag ?? 0) : (b ?? 0);
    const cosh = Math.cosh(im);
    const sinh = Math.sinh(im);
    return { re: Math.sin(re) * cosh, im: Math.cos(re) * sinh };
}

export function complexTan(a, b) {
    const obj = isObject(a);
    const re = obj ? (a.re ?? a.real ?? 0) : (a ?? 0);
    const im = obj ? (a.im ?? a.imag ?? 0) : (b ?? 0);
    const denominator = Math.cos(2 * re) + Math.cosh(2 * im);
    return { re: Math.sin(2 * re) / denominator, im: Math.sinh(2 * im) / denominator };
}

export function complexSec(a, b) {
    const obj = isObject(a);
    const re = obj ? (a.re ?? a.real ?? 0) : (a ?? 0);
    const im = obj ? (a.im ?? a.imag ?? 0) : (b ?? 0);
    const cRe = Math.cos(re) * Math.cosh(im);
    const cIm = -Math.sin(re) * Math.sinh(im);
    return divideRaw(1, 0, cRe, cIm);
}

export function expSafe(x) {
    if (x > 700) return Math.exp(700);
    if (x < -745) return 0;
    return Math.exp(x);
}

export function complexExp(a, b) {
    const obj = isObject(a);
    return expRaw(obj ? (a.re ?? a.real ?? 0) : (a ?? 0), obj ? (a.im ?? a.imag ?? 0) : (b ?? 0));
}

export function complexLn(a, b) {
    const obj = isObject(a);
    const re = obj ? (a.re ?? a.real ?? 0) : (a ?? 0);
    const im = obj ? (a.im ?? a.imag ?? 0) : (b ?? 0);
    if (re === 0 && im === 0) return { re: -Infinity, im: 0 };
    return { re: logHypot(re, im), im: Math.atan2(im, re) };
}

export function complexReciprocal(a, b) {
    const obj = isObject(a);
    return reciprocalRaw(obj ? (a.re ?? a.real ?? 0) : (a ?? 0), obj ? (a.im ?? a.imag ?? 0) : (b ?? 0));
}

export function complexSinh(a, b) {
    const obj = isObject(a);
    const re = obj ? (a.re ?? a.real ?? 0) : (a ?? 0);
    const im = obj ? (a.im ?? a.imag ?? 0) : (b ?? 0);
    const cosh = Math.cosh(re);
    const sinh = Math.sinh(re);
    return { re: sinh * Math.cos(im), im: cosh * Math.sin(im) };
}

export function complexCosh(a, b) {
    const obj = isObject(a);
    const re = obj ? (a.re ?? a.real ?? 0) : (a ?? 0);
    const im = obj ? (a.im ?? a.imag ?? 0) : (b ?? 0);
    const cosh = Math.cosh(re);
    const sinh = Math.sinh(re);
    return { re: cosh * Math.cos(im), im: sinh * Math.sin(im) };
}

export function complexTanh(a, b) {
    const obj = isObject(a);
    const re = obj ? (a.re ?? a.real ?? 0) : (a ?? 0);
    const im = obj ? (a.im ?? a.imag ?? 0) : (b ?? 0);
    const denominator = Math.cosh(2 * re) + Math.cos(2 * im);
    return { re: Math.sinh(2 * re) / denominator, im: Math.sin(2 * im) / denominator };
}

export function complexPowerFractional(a, b) {
    const re = argRe(a);
    const im = argIm(a, b);
    const n = state.fractionalPowerN !== undefined ? state.fractionalPowerN : DEFAULT_FRACTIONAL_POWER;
    if (re === 0 && im === 0) return { re: 0, im: 0 };
    return powRaw(re, im, n, 0);
}

export function complexPow(base_re, base_im, exp_re, exp_im) {
    let baseRe;
    let baseIm;
    let expRe;
    let expIm;

    if (isObject(base_re)) {
        baseRe = realOf(base_re);
        baseIm = imagOf(base_re);
        if (isObject(base_im) && exp_re === undefined) {
            expRe = realOf(base_im);
            expIm = imagOf(base_im);
        } else {
            expRe = base_im ?? 0;
            expIm = exp_re ?? 0;
        }
    } else {
        baseRe = base_re ?? 0;
        baseIm = base_im ?? 0;
        if (isObject(exp_re) && exp_im === undefined) {
            expRe = realOf(exp_re);
            expIm = imagOf(exp_re);
        } else {
            expRe = exp_re ?? 0;
            expIm = exp_im ?? 0;
        }
    }

    return powRaw(baseRe, baseIm, expRe, expIm);
}

export function C(re, im) {
    const input = isObject(re) ? re : null;
    const value = input ? toComplex(input) : complex(re ?? 0, im ?? 0);
    const obj = {
        re: value.re,
        im: value.im,
        _maxMag: input?._maxMag ?? Math.hypot(value.re, value.im),
        get real() { return this.re; },
        get imag() { return this.im; },
        add(other) {
            const result = complexAdd(this, other);
            return withMaxMag(C(result), this, other);
        },
        subtract(other) {
            const result = complexSub(this, other);
            return withMaxMag(C(result), this, other);
        },
        multiply(other) {
            const result = complexMul(this, other);
            return withMaxMag(C(result), this, other);
        },
        divide(other) {
            const o = toComplex(other);
            const magSq = o.re * o.re + o.im * o.im;
            if (magSq < COMPLEX_ZERO_MAG_SQ) return C(NaN, NaN);
            const result = complexDivide(this, o);
            return withMaxMag(C(result), this, other);
        },
        abs() {
            return Math.hypot(this.re, this.im);
        },
        arg() {
            return Math.atan2(this.im, this.re);
        },
        clone() {
            const result = C(this.re, this.im);
            result._maxMag = this._maxMag;
            return result;
        },
        equals(other, tolerance) {
            const tol = tolerance ?? 1e-12;
            const o = toComplex(other);
            return Math.abs(this.re - o.re) < tol && Math.abs(this.im - o.im) < tol;
        },
        isFinite() {
            return finite(this.re) && finite(this.im);
        },
        conjugate() {
            const result = C(this.re, -this.im);
            result._maxMag = this._maxMag;
            return result;
        },
        negate() {
            const result = C(-this.re, -this.im);
            result._maxMag = this._maxMag;
            return result;
        }
    };
    return obj;
}

C.power = function (base, exp) {
    const result = complexPow(base, exp);
    return C(result.re, result.im);
};

export const Complex = C;

const LANCZOS_G = 7;
const LANCZOS_P = Object.freeze([
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7
]);

const zetaLogIntegerCache = [0, 0];
const zetaEvalCache = new Map();
const ZETA_EVAL_CACHE_MAX = 180000;

export function ensureZetaLogIntegerCache(maxN) {
    if (!finite(maxN) || maxN < 1) return;
    const target = Math.floor(maxN);
    for (let n = zetaLogIntegerCache.length; n <= target; n++) {
        zetaLogIntegerCache[n] = Math.log(n);
    }
}

export function complexPositiveRealPowFromLog(logBase, expRe, expIm) {
    return positiveRealPowComponents(logBase, expRe, expIm);
}

export function getZetaEvalCacheKey(a, b, continuationEnabled) {
    return `${continuationEnabled ? 1 : 0}:${Math.round(a * 1e7)}:${Math.round(b * 1e7)}`;
}

export function readZetaEvalCache(cacheKey) {
    const cached = zetaEvalCache.get(cacheKey);
    return cached ? cloneComplex(cached) : null;
}

export function writeZetaEvalCache(cacheKey, value) {
    if (!cacheKey || !value) return;
    if (zetaEvalCache.size >= ZETA_EVAL_CACHE_MAX) zetaEvalCache.clear();
    zetaEvalCache.set(cacheKey, cloneComplex(value));
}

function zetaInteractionThrottled() {
    return !!(
        runtime.interaction.panZ?.isPanning ||
        runtime.interaction.panW?.isPanning ||
        state.particleAnimationEnabled
    );
}

function dynamicWorkload(base, floor, ratio) {
    return zetaInteractionThrottled() ? Math.max(floor, Math.floor(base * ratio)) : base;
}

export function getDynamicZetaDirectTerms() {
    return dynamicWorkload(NUM_ZETA_TERMS_DIRECT_SUM, 40, 0.65);
}

export function getDynamicZetaHasseLevels() {
    return dynamicWorkload(NUM_ZETA_HASSE_LEVELS, 14, 0.62);
}

export function complexGamma(re, im) {
    const zRe = argRe(re);
    const zIm = argIm(re, im);

    if (zRe < 0.5) {
        const reflected = complexGamma(1 - zRe, -zIm);
        const sinRe = Math.sin(PI * zRe) * _cosh(PI * zIm);
        const sinIm = Math.cos(PI * zRe) * _sinh(PI * zIm);
        const denomRe = sinRe * reflected.re - sinIm * reflected.im;
        const denomIm = sinRe * reflected.im + sinIm * reflected.re;
        return divideRaw(PI, 0, denomRe, denomIm);
    }

    const zmRe = zRe - 1;
    const zmIm = zIm;
    let lRe = LANCZOS_P[0];
    let lIm = 0;

    for (let k = 1; k < LANCZOS_P.length; k++) {
        const q = divideRaw(LANCZOS_P[k], 0, zmRe + k, zmIm);
        lRe += q.re;
        lIm += q.im;
    }

    const tRe = zRe + LANCZOS_G - 0.5;
    const tIm = zIm;
    const powered = powRaw(tRe, tIm, zRe - 0.5, zIm);
    const decayed = expRaw(-tRe, -tIm);
    const pdRe = powered.re * decayed.re - powered.im * decayed.im;
    const pdIm = powered.re * decayed.im + powered.im * decayed.re;

    return {
        re: SQRT_TWO_PI * (pdRe * lRe - pdIm * lIm),
        im: SQRT_TWO_PI * (pdRe * lIm + pdIm * lRe)
    };
}

export function complexRiemannZeta_DirectSum(a, b, numTerms) {
    if (a <= 1.0) return { re: NaN, im: NaN };

    ensureZetaLogIntegerCache(numTerms);
    let sumRe = 0;
    let sumIm = 0;

    for (let n = 1; n <= numTerms; n++) {
        const logN = zetaLogIntegerCache[n];
        const magnitude = expSafe(-a * logN);
        const angle = -b * logN;
        sumRe += magnitude * Math.cos(angle);
        sumIm += magnitude * Math.sin(angle);
    }

    return { re: sumRe, im: sumIm };
}

export function complexRiemannZeta_EtaSeries(a, b, numTerms) {
    if (a === 1 && b === 0) return { re: Infinity, im: NaN };

    ensureZetaLogIntegerCache(numTerms);
    let etaRe = 0;
    let etaIm = 0;

    for (let n = 1; n <= numTerms; n++) {
        const logN = zetaLogIntegerCache[n];
        const magnitude = expSafe(-a * logN);
        const angle = -b * logN;
        const sign = n % 2 === 0 ? -1 : 1;
        etaRe += sign * magnitude * Math.cos(angle);
        etaIm += sign * magnitude * Math.sin(angle);
    }

    const denominator = zetaEtaDenominator(a, b);

    if (Math.abs(denominator.re) < 1e-14 && Math.abs(denominator.im) < 1e-14) {
        const etaMagSq = etaRe * etaRe + etaIm * etaIm;
        if (Math.abs(etaRe) < 1e-10 && Math.abs(etaIm) < 1e-10) return { re: NaN, im: NaN };
        if (etaMagSq < 1e-20) return { re: 0, im: 0 };

        const scale = (POLE_MAGNITUDE_THRESHOLD * 1.5) / Math.sqrt(etaMagSq);
        return { re: etaRe * scale, im: etaIm * scale };
    }

    return divideRaw(etaRe, etaIm, denominator.re, denominator.im);
}

const zetaHasseBinomialRowsCache = {};

export function getZetaHasseBinomialRows(maxLevel) {
    if (zetaHasseBinomialRowsCache[maxLevel]) return zetaHasseBinomialRowsCache[maxLevel];

    const rows = Array.from({ length: maxLevel }, (_, n) => {
        const row = new Array(n + 1);
        row[0] = 1;
        for (let k = 1; k <= n; k++) row[k] = row[k - 1] * (n - k + 1) / k;
        return row;
    });

    zetaHasseBinomialRowsCache[maxLevel] = rows;
    return rows;
}

const zetaHasseCombinedCoefficientsCache = new Map();

function getZetaHasseCombinedCoefficients(maxLevel) {
    const level = Math.max(0, Math.floor(maxLevel));
    const cached = zetaHasseCombinedCoefficientsCache.get(level);
    if (cached) return cached;

    const coeffs = new Float64Array(level + 1);
    for (let n = 0; n < level; n++) {
        let binomial = 1;
        const rowScale = Math.pow(2, -n - 1);
        for (let k = 0; k <= n; k++) {
            coeffs[k + 1] += (k % 2 === 0 ? 1 : -1) * binomial * rowScale;
            binomial = binomial * (n - k) / (k + 1);
        }
    }

    zetaHasseCombinedCoefficientsCache.set(level, coeffs);
    return coeffs;
}


export function complexRiemannZeta_HasseSeries(a, b, numLevels) {
    if (a === 1 && b === 0) return { re: Infinity, im: NaN };

    const denominator = zetaEtaDenominator(a, b);
    if (Math.abs(denominator.re) < 1e-14 && Math.abs(denominator.im) < 1e-14) {
        return complexRiemannZeta_EtaSeries(a, b, NUM_ZETA_TERMS_ETA_SERIES);
    }

    const coeffs = getZetaHasseCombinedCoefficients(numLevels);
    ensureZetaLogIntegerCache(numLevels);

    let sumRe = 0;
    let sumIm = 0;
    let maxTermMag = 0;

    for (let n = 1; n <= numLevels; n++) {
        const coeff = coeffs[n];
        const logN = zetaLogIntegerCache[n];
        const magnitude = expSafe(-a * logN);
        const angle = -b * logN;
        const termRe = magnitude * Math.cos(angle);
        const termIm = magnitude * Math.sin(angle);
        sumRe += coeff * termRe;
        sumIm += coeff * termIm;
        maxTermMag = Math.max(maxTermMag, Math.abs(coeff) * Math.hypot(termRe, termIm));
    }

    return withMaxMag(divideRaw(sumRe, sumIm, denominator.re, denominator.im), maxTermMag, denominator);
}

export function complexRiemannZeta(a, b) {
    const s = isObject(a) ? toComplex(a) : complex(a, b);
    const continuationEnabled = !!state.zetaContinuationEnabled;
    const cacheKey = getZetaEvalCacheKey(s.re, s.im, continuationEnabled);
    const cached = readZetaEvalCache(cacheKey);
    if (cached) return cached;

    let result;

    if (!continuationEnabled) {
        result = s.re > ZETA_REFLECTION_POINT_RE
            ? complexRiemannZeta_DirectSum(s.re, s.im, getDynamicZetaDirectTerms())
            : { re: NaN, im: NaN };
        writeZetaEvalCache(cacheKey, result);
        return result;
    }

    if (s.re === 1 && s.im === 0) result = { re: Infinity, im: NaN };
    else if (s.re === 0 && s.im === 0) result = { re: -0.5, im: 0 };
    else if (s.im === 0 && s.re < 0 && s.re % 2 === 0) result = { re: 0, im: 0 };
    else result = complexRiemannZeta_HasseSeries(s.re, s.im, getDynamicZetaHasseLevels());

    writeZetaEvalCache(cacheKey, result);
    return result;
}

export function complexMobius(z_re, z_im) {
    const zRe = argRe(z_re);
    const zIm = argIm(z_re, z_im);
    const a = state.mobiusA || ZERO;
    const b = state.mobiusB || ZERO;
    const c = state.mobiusC || ZERO;
    const d = state.mobiusD || ONE;

    const ar = realOf(a);
    const ai = imagOf(a);
    const br = realOf(b);
    const bi = imagOf(b);
    const cr = realOf(c);
    const ci = imagOf(c);
    const dr = realOf(d);
    const di = imagOf(d);

    const numRe = ar * zRe - ai * zIm + br;
    const numIm = ar * zIm + ai * zRe + bi;
    const denRe = cr * zRe - ci * zIm + dr;
    const denIm = cr * zIm + ci * zRe + di;
    return divideRaw(numRe, numIm, denRe, denIm);
}


function createPolynomialEvalKernel(degree) {
    if (degree > 64) return null;
    let code = `'use strict';let accRe=0,accIm=0;`;
    for (let k = degree; k >= 0; k--) {
        code += `const nr_${k}=accRe*zRe-accIm*zIm;`;
        code += `accIm=accRe*zIm+accIm*zRe+${jsNumber(polynomialKernelIm[k] || 0)};`;
        code += `accRe=nr_${k}+${jsNumber(polynomialKernelRe[k] || 0)};`;
    }
    code += `out[offset]=accRe;out[offset+1]=accIm;return out;`;
    try {
        return Function(`return function polynomialEvalKernel(zRe,zIm,out,offset){${code}};`)();
    } catch (error) {
        return null;
    }
}

function refreshPolynomialKernel(coeffs, degree) {
    const size = degree + 1;
    if (polynomialKernelRe.length < size) {
        polynomialKernelRe = new Float64Array(size);
        polynomialKernelIm = new Float64Array(size);
    }

    for (let i = 0; i <= degree; i++) {
        const coeff = coeffs?.[i];
        polynomialKernelRe[i] = coeff ? realOf(coeff) : 0;
        polynomialKernelIm[i] = coeff ? imagOf(coeff) : 0;
    }

    polynomialKernelRef = coeffs;
    polynomialKernelDegree = degree;
    polynomialEvalKernel = createPolynomialEvalKernel(degree);
}

function complexPolynomialRawInto(zRe, zIm, out, offset = 0) {
    const degree = Math.max(0, Math.floor(finite(state.polynomialN) ? state.polynomialN : 0));
    const coeffs = state.polynomialCoeffs;
    if (coeffs !== polynomialKernelRef || degree !== polynomialKernelDegree) {
        refreshPolynomialKernel(coeffs, degree);
    }

    if (polynomialEvalKernel) return polynomialEvalKernel(zRe, zIm, out, offset);

    let accRe = 0;
    let accIm = 0;
    const coeffRe = polynomialKernelRe;
    const coeffIm = polynomialKernelIm;

    for (let k = degree; k >= 0; k--) {
        const nextRe = accRe * zRe - accIm * zIm;
        accIm = accRe * zIm + accIm * zRe + coeffIm[k];
        accRe = nextRe + coeffRe[k];
    }

    out[offset] = accRe;
    out[offset + 1] = accIm;
    return out;
}

export function complexPolynomial(z_re, z_im) {
    const out = complexPolynomialRawInto(argRe(z_re), argIm(z_re, z_im), POLYNOMIAL_EXPORT_SCRATCH);
    return { re: out[0], im: out[1] };
}

const POLYNOMIAL_EXPORT_SCRATCH = new Float64Array(2);

export function complexPoincareCustomMetric(a, b) {
    const z = normalizeUnaryComplexArgs(a, b);
    if (z.im <= 1e-9) return { re: NaN, im: NaN };
    const sqrtIm = Math.sqrt(z.im);
    return { re: z.re / sqrtIm, im: sqrtIm };
}


const ALGEBRAIC_RAW_SUPPORTED = new Set([
    'c',
    'cos',
    'sin',
    'tan',
    'sec',
    'exp',
    'ln',
    'reciprocal',
    'sinh',
    'cosh',
    'tanh',
    'power',
    'mobius',
    'zeta',
    'polynomial',
    'poincare'
]);

const ALG_TMP = new Float64Array(8);

function writeContextParameter(ctxRe, ctxIm, out, offset) {
    out[offset] = ctxRe;
    out[offset + 1] = ctxIm;
    return out;
}

function complexMobiusRawInto(zRe, zIm, out, offset = 0) {
    const a = state.mobiusA || ZERO;
    const b = state.mobiusB || ZERO;
    const c = state.mobiusC || ZERO;
    const d = state.mobiusD || ONE;
    const ar = realOf(a);
    const ai = imagOf(a);
    const br = realOf(b);
    const bi = imagOf(b);
    const cr = realOf(c);
    const ci = imagOf(c);
    const dr = realOf(d);
    const di = imagOf(d);
    return divideRawInto(
        ar * zRe - ai * zIm + br,
        ar * zIm + ai * zRe + bi,
        cr * zRe - ci * zIm + dr,
        cr * zIm + ci * zRe + di,
        out,
        offset
    );
}

function evaluateRawTransformInto(func, re, im, ctxRe, ctxIm, out, offset = 0) {
    switch (func) {
        case 'c':
            return writeContextParameter(ctxRe, ctxIm, out, offset);
        case 'sin': {
            const cosh = Math.cosh(im);
            const sinh = Math.sinh(im);
            out[offset] = Math.sin(re) * cosh;
            out[offset + 1] = Math.cos(re) * sinh;
            return out;
        }
        case 'cos': {
            const cosh = Math.cosh(im);
            const sinh = Math.sinh(im);
            out[offset] = Math.cos(re) * cosh;
            out[offset + 1] = -Math.sin(re) * sinh;
            return out;
        }
        case 'tan': {
            const denominator = Math.cos(2 * re) + Math.cosh(2 * im);
            out[offset] = Math.sin(2 * re) / denominator;
            out[offset + 1] = Math.sinh(2 * im) / denominator;
            return out;
        }
        case 'sec': {
            const cRe = Math.cos(re) * Math.cosh(im);
            const cIm = -Math.sin(re) * Math.sinh(im);
            return divideRawInto(1, 0, cRe, cIm, out, offset);
        }
        case 'exp':
            return expRawInto(re, im, out, offset);
        case 'ln':
            out[offset] = re === 0 && im === 0 ? -Infinity : logHypot(re, im);
            out[offset + 1] = re === 0 && im === 0 ? 0 : Math.atan2(im, re);
            return out;
        case 'reciprocal':
            return divideRawInto(1, 0, re, im, out, offset);
        case 'sinh': {
            const cosh = Math.cosh(re);
            const sinh = Math.sinh(re);
            out[offset] = sinh * Math.cos(im);
            out[offset + 1] = cosh * Math.sin(im);
            return out;
        }
        case 'cosh': {
            const cosh = Math.cosh(re);
            const sinh = Math.sinh(re);
            out[offset] = cosh * Math.cos(im);
            out[offset + 1] = sinh * Math.sin(im);
            return out;
        }
        case 'tanh': {
            const denominator = Math.cosh(2 * re) + Math.cos(2 * im);
            out[offset] = Math.sinh(2 * re) / denominator;
            out[offset + 1] = Math.sin(2 * im) / denominator;
            return out;
        }
        case 'power':
            return powRawInto(re, im, state.fractionalPowerN !== undefined ? state.fractionalPowerN : DEFAULT_FRACTIONAL_POWER, 0, out, offset);
        case 'mobius':
            return complexMobiusRawInto(re, im, out, offset);
        case 'polynomial':
            return complexPolynomialRawInto(re, im, out, offset);
        case 'poincare':
            if (im <= 1e-9) {
                out[offset] = NaN;
                out[offset + 1] = NaN;
                return out;
            }
            out[offset + 1] = Math.sqrt(im);
            out[offset] = re / out[offset + 1];
            return out;
        case 'zeta': {
            const z = complexRiemannZeta(re, im);
            out[offset] = z.re;
            out[offset + 1] = z.im;
            return out;
        }
        default:
            return null;
    }
}

function powSmallIntegerInto(re, im, exponent, out, offset = 0) {
    // Exact low-degree complex powers avoid generic log/exp exponentiation in algebraic hot paths.
    if (exponent === 0) {
        out[offset] = 1;
        out[offset + 1] = 0;
        return out;
    }
    if (exponent === 1) {
        out[offset] = re;
        out[offset + 1] = im;
        return out;
    }
    if (exponent === 2) {
        out[offset] = re * re - im * im;
        out[offset + 1] = 2 * re * im;
        return out;
    }
    if (exponent === 3) {
        const re2 = re * re - im * im;
        const im2 = 2 * re * im;
        out[offset] = re2 * re - im2 * im;
        out[offset + 1] = re2 * im + im2 * re;
        return out;
    }
    let accRe = 1;
    let accIm = 0;
    let baseRe = re;
    let baseIm = im;
    let n = exponent | 0;
    while (n > 0) {
        if (n & 1) {
            const nextRe = accRe * baseRe - accIm * baseIm;
            accIm = accRe * baseIm + accIm * baseRe;
            accRe = nextRe;
        }
        n >>>= 1;
        if (n) {
            const nextBaseRe = baseRe * baseRe - baseIm * baseIm;
            baseIm = 2 * baseRe * baseIm;
            baseRe = nextBaseRe;
        }
    }
    out[offset] = accRe;
    out[offset + 1] = accIm;
    return out;
}

function isFastPositiveIntegerPower(value) {
    return Number.isInteger(value) && value >= 0 && value <= 16;
}

function applyAlgebraicModifiersInto(factor, out, offset = 0) {
    if (factor.power !== undefined && factor.power !== 1) {
        if (isFastPositiveIntegerPower(factor.power)) {
            powSmallIntegerInto(out[offset], out[offset + 1], factor.power, out, offset);
        } else {
            powRawInto(out[offset], out[offset + 1], factor.power, 0, out, offset);
        }
    }
    if (factor.reciprocal) {
        divideRawInto(1, 0, out[offset], out[offset + 1], out, offset);
    }
    if (factor.log) {
        const re = out[offset];
        const im = out[offset + 1];
        out[offset] = re === 0 && im === 0 ? -Infinity : logHypot(re, im);
        out[offset + 1] = re === 0 && im === 0 ? 0 : Math.atan2(im, re);
    }
    if (factor.exp) {
        expRawInto(out[offset], out[offset + 1], out, offset);
    }
    return out;
}

function factorIsRawCompilable(factor) {
    if (!factor || factor.func === 'none') return true;
    if (!ALGEBRAIC_RAW_SUPPORTED.has(factor.func)) return false;
    if (factor.chainedFunc && factor.chainedFunc !== 'none' && !ALGEBRAIC_RAW_SUPPORTED.has(factor.chainedFunc)) return false;
    return !(factor.power !== undefined && factor.power !== 1 && typeof factor.power !== 'number');
}


function jsNumber(value) {
    return Number.isFinite(value) ? String(value) : (Number.isNaN(value) ? 'NaN' : (value < 0 ? '-Infinity' : 'Infinity'));
}

// The generated algebraic kernel snapshots stable state-dependent transforms.
// Polynomial and Mobius factors are lowered into straight-line arithmetic so the
// render hot path pays for math only, not state lookup or tiny helper dispatch.
function emitPolynomialInline(inRe, inIm, outRe, outIm, tag) {
    const degree = boundedPolynomialDegree();
    let code = `let ${outRe}=0,${outIm}=0;`;
    for (let k = degree; k >= 0; k--) {
        const coeff = state.polynomialCoeffs?.[k];
        const cr = jsNumber(coeff ? realOf(coeff) : 0);
        const ci = jsNumber(coeff ? imagOf(coeff) : 0);
        code += `const pnr_${tag}_${k}=${outRe}*(${inRe})-${outIm}*(${inIm});`;
        code += `${outIm}=${outRe}*(${inIm})+${outIm}*(${inRe})+${ci};`;
        code += `${outRe}=pnr_${tag}_${k}+${cr};`;
    }
    return code;
}

function emitMobiusInline(inRe, inIm, outRe, outIm, tag) {
    const a = state.mobiusA || ZERO;
    const b = state.mobiusB || ZERO;
    const c = state.mobiusC || ZERO;
    const d = state.mobiusD || ONE;
    const ar = jsNumber(realOf(a));
    const ai = jsNumber(imagOf(a));
    const br = jsNumber(realOf(b));
    const bi = jsNumber(imagOf(b));
    const cr = jsNumber(realOf(c));
    const ci = jsNumber(imagOf(c));
    const dr = jsNumber(realOf(d));
    const di = jsNumber(imagOf(d));
    return `const mnr_${tag}=(${ar})*(${inRe})-(${ai})*(${inIm})+(${br}),` +
        `mni_${tag}=(${ar})*(${inIm})+(${ai})*(${inRe})+(${bi}),` +
        `mdr_${tag}=(${cr})*(${inRe})-(${ci})*(${inIm})+(${dr}),` +
        `mdi_${tag}=(${cr})*(${inIm})+(${ci})*(${inRe})+(${di});` +
        `divideRawInto(mnr_${tag},mni_${tag},mdr_${tag},mdi_${tag},tmp,0);` +
        `let ${outRe}=tmp[0],${outIm}=tmp[1];`;
}

function emitRawTransform(func, inRe, inIm, outRe, outIm, tag) {
    switch (func) {
        case 'c':
            return `let ${outRe}=ctxRe,${outIm}=ctxIm;`;
        case 'sin':
            return `const cosh_${tag}=Math.cosh(${inIm}),sinh_${tag}=Math.sinh(${inIm});let ${outRe}=Math.sin(${inRe})*cosh_${tag},${outIm}=Math.cos(${inRe})*sinh_${tag};`;
        case 'cos':
            return `const cosh_${tag}=Math.cosh(${inIm}),sinh_${tag}=Math.sinh(${inIm});let ${outRe}=Math.cos(${inRe})*cosh_${tag},${outIm}=-Math.sin(${inRe})*sinh_${tag};`;
        case 'tan':
            return `const den_${tag}=Math.cos(2*(${inRe}))+Math.cosh(2*(${inIm}));let ${outRe}=Math.sin(2*(${inRe}))/den_${tag},${outIm}=Math.sinh(2*(${inIm}))/den_${tag};`;
        case 'sec':
            return `const cre_${tag}=Math.cos(${inRe})*Math.cosh(${inIm}),cim_${tag}=-Math.sin(${inRe})*Math.sinh(${inIm});divideRawInto(1,0,cre_${tag},cim_${tag},tmp,0);let ${outRe}=tmp[0],${outIm}=tmp[1];`;
        case 'exp':
            return `expRawInto(${inRe},${inIm},tmp,0);let ${outRe}=tmp[0],${outIm}=tmp[1];`;
        case 'ln':
            return `let ${outRe}=(${inRe})===0&&(${inIm})===0?-Infinity:logHypot(${inRe},${inIm}),${outIm}=(${inRe})===0&&(${inIm})===0?0:Math.atan2(${inIm},${inRe});`;
        case 'reciprocal':
            return `divideRawInto(1,0,${inRe},${inIm},tmp,0);let ${outRe}=tmp[0],${outIm}=tmp[1];`;
        case 'sinh':
            return `const cosh_${tag}=Math.cosh(${inRe}),sinh_${tag}=Math.sinh(${inRe});let ${outRe}=sinh_${tag}*Math.cos(${inIm}),${outIm}=cosh_${tag}*Math.sin(${inIm});`;
        case 'cosh':
            return `const cosh_${tag}=Math.cosh(${inRe}),sinh_${tag}=Math.sinh(${inRe});let ${outRe}=cosh_${tag}*Math.cos(${inIm}),${outIm}=sinh_${tag}*Math.sin(${inIm});`;
        case 'tanh':
            return `const den_${tag}=Math.cosh(2*(${inRe}))+Math.cos(2*(${inIm}));let ${outRe}=Math.sinh(2*(${inRe}))/den_${tag},${outIm}=Math.sin(2*(${inIm}))/den_${tag};`;
        case 'power':
            return `powRawInto(${inRe},${inIm},state.fractionalPowerN!==undefined?state.fractionalPowerN:0.5,0,tmp,0);let ${outRe}=tmp[0],${outIm}=tmp[1];`;
        case 'mobius':
            return emitMobiusInline(inRe, inIm, outRe, outIm, tag);
        case 'polynomial':
            return emitPolynomialInline(inRe, inIm, outRe, outIm, tag);
        case 'poincare':
            return `let ${outRe},${outIm};if((${inIm})<=1e-9){${outRe}=NaN;${outIm}=NaN;}else{${outIm}=Math.sqrt(${inIm});${outRe}=(${inRe})/${outIm};}`;
        case 'zeta':
            return `const zeta_${tag}=complexRiemannZeta(${inRe},${inIm});let ${outRe}=zeta_${tag}.re,${outIm}=zeta_${tag}.im;`;
        default:
            return null;
    }
}

function emitModifiers(factor, reVar, imVar, tag) {
    let code = '';
    if (factor.power !== undefined && factor.power !== 1) {
        if (isFastPositiveIntegerPower(factor.power)) {
            const n = factor.power | 0;
            if (n === 0) {
                code += `${reVar}=1;${imVar}=0;`;
            } else if (n === 2) {
                code += `const pr_${tag}=${reVar},pi_${tag}=${imVar};${reVar}=pr_${tag}*pr_${tag}-pi_${tag}*pi_${tag};${imVar}=2*pr_${tag}*pi_${tag};`;
            } else if (n === 3) {
                code += `const ar_${tag}=${reVar},ai_${tag}=${imVar},br_${tag}=ar_${tag}*ar_${tag}-ai_${tag}*ai_${tag},bi_${tag}=2*ar_${tag}*ai_${tag};${reVar}=br_${tag}*ar_${tag}-bi_${tag}*ai_${tag};${imVar}=br_${tag}*ai_${tag}+bi_${tag}*ar_${tag};`;
            } else {
                code += `powSmallIntegerInto(${reVar},${imVar},${n},tmp,0);${reVar}=tmp[0];${imVar}=tmp[1];`;
            }
        } else {
            code += `powRawInto(${reVar},${imVar},${jsNumber(factor.power)},0,tmp,0);${reVar}=tmp[0];${imVar}=tmp[1];`;
        }
    }
    if (factor.reciprocal) {
        code += `divideRawInto(1,0,${reVar},${imVar},tmp,0);${reVar}=tmp[0];${imVar}=tmp[1];`;
    }
    if (factor.log) {
        code += `const lr_${tag}=${reVar},li_${tag}=${imVar};${reVar}=lr_${tag}===0&&li_${tag}===0?-Infinity:logHypot(lr_${tag},li_${tag});${imVar}=lr_${tag}===0&&li_${tag}===0?0:Math.atan2(li_${tag},lr_${tag});`;
    }
    if (factor.exp) {
        code += `expRawInto(${reVar},${imVar},tmp,0);${reVar}=tmp[0];${imVar}=tmp[1];`;
    }
    return code;
}


function isExpLogIdentityFactor(factor) {
    return !!(
        factor &&
        factor.func === 'ln' &&
        factor.exp === true &&
        !factor.log &&
        !factor.reciprocal &&
        (factor.power === undefined || factor.power === 1)
    );
}



function createGeneratedAlgebraicKernel(compiledTerms) {
    let code = `'use strict';const tmp=scratch;let sumRe=0,sumIm=0;`;
    for (let i = 0; i < compiledTerms.length; i++) {
        const term = compiledTerms[i];
        code += `let vr_${i}=${jsNumber(term.coeffRe)},vi_${i}=${jsNumber(term.coeffIm)};`;
        const factors = term.factors;
        for (let j = 0; j < factors.length; j++) {
            const factor = factors[j];
            if (!factor || factor.func === 'none') break;
            const tag = `${i}_${j}`;
            let argRe = 'zRe';
            let argIm = 'zIm';
            if (factor.chainedFunc && factor.chainedFunc !== 'none') {
                const chRe = `chr_${tag}`;
                const chIm = `chi_${tag}`;
                const emitted = emitRawTransform(factor.chainedFunc, argRe, argIm, chRe, chIm, `c_${tag}`);
                if (!emitted) return null;
                code += emitted;
                argRe = chRe;
                argIm = chIm;
            }
            const fr = `fr_${tag}`;
            const fi = `fi_${tag}`;
            if (isExpLogIdentityFactor(factor)) {
                code += `let ${fr}=${argRe},${fi}=${argIm};`;
            } else {
                const emitted = emitRawTransform(factor.func, argRe, argIm, fr, fi, `f_${tag}`);
                if (!emitted) return null;
                code += emitted;
                code += emitModifiers(factor, fr, fi, `m_${tag}`);
            }
            code += `const nr_${tag}=vr_${i}*${fr}-vi_${i}*${fi};vi_${i}=vr_${i}*${fi}+vi_${i}*${fr};vr_${i}=nr_${tag};`;
        }
        code += `if(!finite(vr_${i})||!finite(vi_${i})){out[offset]=NaN;out[offset+1]=NaN;return out;}sumRe+=vr_${i};sumIm+=vi_${i};`;
    }
    code += `out[offset]=sumRe;out[offset+1]=sumIm;return out;`;

    try {
        const raw = Function(
            'scratch',
            'Math',
            'state',
            'finite',
            'logHypot',
            'divideRawInto',
            'expRawInto',
            'powRawInto',
            'powSmallIntegerInto',
            'complexRiemannZeta',
            `return function generatedAlgebraicKernel(zRe,zIm,ctxRe,ctxIm,out,offset){${code}};`
        )(
            ALG_TMP,
            Math,
            state,
            finite,
            logHypot,
            divideRawInto,
            expRawInto,
            powRawInto,
            powSmallIntegerInto,
            complexRiemannZeta
        );

        const wrapper = (zRe, zIm, context = null, directCtxIm = undefined, out = null, offset = 0) => {
            const directContext = typeof context === 'number';
            const contextC = !directContext && context && context.c !== undefined && context.c !== null ? context.c : null;
            const ctxRe = directContext ? context : (contextC ? argRe(contextC) : zRe);
            const ctxIm = directContext ? (directCtxIm ?? 0) : (contextC ? argIm(contextC) : zIm);
            if (out) return raw(zRe, zIm, ctxRe, ctxIm, out, offset);
            raw(zRe, zIm, ctxRe, ctxIm, ALG_TMP, 0);
            return { re: ALG_TMP[0], im: ALG_TMP[1] };
        };
        wrapper.raw = raw;
        return wrapper;
    } catch (error) {
        return null;
    }
}

function createCompiledAlgebraicKernel(terms) {
    if (!Array.isArray(terms) || state.algebraicChainingZExpr && state.algebraicChainingZExpr !== 'z') {
        return null;
    }

    const compiledTerms = new Array(terms.length);
    for (let i = 0; i < terms.length; i++) {
        const term = terms[i];
        if (!term) return null;
        const factors = term.factors ?? [];
        for (const factor of factors) {
            if (!factorIsRawCompilable(factor)) return null;
            if (!factor || factor.func === 'none') break;
        }
        compiledTerms[i] = {
            coeffRe: realOf(term.coeff ?? ONE),
            coeffIm: imagOf(term.coeff ?? ONE),
            factors
        };
    }

    const generatedKernel = createGeneratedAlgebraicKernel(compiledTerms);
    if (generatedKernel) return generatedKernel;

    return (zRe, zIm, context = null, directCtxIm = undefined, out = null, offset = 0) => {
        let sumRe = 0;
        let sumIm = 0;
        const tmp = ALG_TMP;
        const directContext = typeof context === 'number';
        const contextC = !directContext && context && context.c !== undefined && context.c !== null ? context.c : null;
        const ctxRe = directContext ? context : (contextC ? argRe(contextC) : zRe);
        const ctxIm = directContext ? (directCtxIm ?? 0) : (contextC ? argIm(contextC) : zIm);

        for (let i = 0; i < compiledTerms.length; i++) {
            const term = compiledTerms[i];
            const factors = term.factors;
            let valueRe = term.coeffRe;
            let valueIm = term.coeffIm;

            for (let j = 0; j < factors.length; j++) {
                const factor = factors[j];
                if (!factor || factor.func === 'none') break;

                let argRe = zRe;
                let argIm = zIm;
                const chainedFunc = factor.chainedFunc;
                if (chainedFunc && chainedFunc !== 'none') {
                    const chained = evaluateRawTransformInto(chainedFunc, argRe, argIm, ctxRe, ctxIm, tmp, 0);
                    if (!chained) return null;
                    argRe = tmp[0];
                    argIm = tmp[1];
                }

                const out = evaluateRawTransformInto(factor.func, argRe, argIm, ctxRe, ctxIm, tmp, 2);
                if (!out) return null;
                applyAlgebraicModifiersInto(factor, tmp, 2);

                const factorRe = tmp[2];
                const factorIm = tmp[3];
                const nextRe = valueRe * factorRe - valueIm * factorIm;
                valueIm = valueRe * factorIm + valueIm * factorRe;
                valueRe = nextRe;
            }

            if (!finite(valueRe) || !finite(valueIm)) {
                if (out) {
                    out[offset] = NaN;
                    out[offset + 1] = NaN;
                    return out;
                }
                return { re: NaN, im: NaN };
            }
            sumRe += valueRe;
            sumIm += valueIm;
        }

        if (out) {
            out[offset] = sumRe;
            out[offset + 1] = sumIm;
            return out;
        }
        return { re: sumRe, im: sumIm };
    };
}

function getCompiledAlgebraicKernel(terms) {
    const polynomialRef = state.polynomialCoeffs;
    const polynomialDegree = boundedPolynomialDegree();
    const mobiusA = state.mobiusA;
    const mobiusB = state.mobiusB;
    const mobiusC = state.mobiusC;
    const mobiusD = state.mobiusD;
    if (
        terms !== algebraicKernelTerms ||
        state.algebraicChainingZExpr !== algebraicKernelZExpr ||
        polynomialRef !== algebraicKernelPolynomialRef ||
        polynomialDegree !== algebraicKernelPolynomialDegree ||
        mobiusA !== algebraicKernelMobiusA ||
        mobiusB !== algebraicKernelMobiusB ||
        mobiusC !== algebraicKernelMobiusC ||
        mobiusD !== algebraicKernelMobiusD
    ) {
        algebraicKernelTerms = terms;
        algebraicKernelZExpr = state.algebraicChainingZExpr;
        algebraicKernelPolynomialRef = polynomialRef;
        algebraicKernelPolynomialDegree = polynomialDegree;
        algebraicKernelMobiusA = mobiusA;
        algebraicKernelMobiusB = mobiusB;
        algebraicKernelMobiusC = mobiusC;
        algebraicKernelMobiusD = mobiusD;
        algebraicKernel = createCompiledAlgebraicKernel(terms);
    }
    return algebraicKernel;
}

function algebraicParameter(context, fallback) {
    return toComplex(context?.c ?? fallback);
}

export function evaluateFunctionBlock(block, z_re, z_im, context = null) {
    if (!block || block.func === 'none') {
        return isObject(z_re) ? z_re : { re: z_re, im: z_im };
    }

    const zRe = argRe(z_re);
    const zIm = argIm(z_re, z_im);

    if (factorIsRawCompilable(block)) {
        const contextC = context && context.c !== undefined && context.c !== null ? context.c : null;
        const ctxRe = contextC ? argRe(contextC) : zRe;
        const ctxIm = contextC ? argIm(contextC) : zIm;
        let inRe = zRe;
        let inIm = zIm;

        if (block.chainedFunc && block.chainedFunc !== 'none') {
            evaluateRawTransformInto(block.chainedFunc, inRe, inIm, ctxRe, ctxIm, ALG_TMP, 0);
            inRe = ALG_TMP[0];
            inIm = ALG_TMP[1];
        }

        const raw = evaluateRawTransformInto(block.func, inRe, inIm, ctxRe, ctxIm, ALG_TMP, 2);
        if (raw) {
            if (isExpLogIdentityFactor(block)) {
                ALG_TMP[2] = inRe;
                ALG_TMP[3] = inIm;
            } else {
                applyAlgebraicModifiersInto(block, ALG_TMP, 2);
            }
            return { re: ALG_TMP[2], im: ALG_TMP[3] };
        }
    }

    let arg = { re: zRe, im: zIm };

    if (block.chainedFunc && block.chainedFunc !== 'none') {
        if (block.chainedFunc === 'c') {
            arg = algebraicParameter(context, arg);
        } else {
            const chained = transformFunctions[block.chainedFunc];
            if (!chained) return NAN_COMPLEX;
            arg = chained(arg);
        }
    }

    let value;
    if (block.func === 'c') {
        value = algebraicParameter(context, arg);
    } else {
        const base = transformFunctions[block.func];
        if (!base) return NAN_COMPLEX;
        value = base(arg);
    }

    if (block.power !== undefined && block.power !== 1) value = complexPow(value, block.power, 0);
    if (block.reciprocal) value = complexReciprocal(value);
    if (block.log) value = complexLn(value);
    if (block.exp) value = complexExp(value);

    return value;
}

export function evaluateAlgebraicTerm(term, z_re, z_im, context = null) {
    if (!term) return { re: NaN, im: NaN };

    const signature = `${state.algebraicChainingZExpr || 'z'}|${serializeAlgebraicTerms([term])}|${buildMappedTransformProfileKey('polynomial')}|${buildMappedTransformProfileKey('mobius')}`;
    let cached = algebraicTermKernelCache.get(term);
    if (!cached || cached.signature !== signature) {
        cached = { signature, kernel: createCompiledAlgebraicKernel([term]) || null };
        algebraicTermKernelCache.set(term, cached);
    }
    const kernel = cached.kernel;
    if (kernel?.raw) {
        const zRe = argRe(z_re);
        const zIm = argIm(z_re, z_im);
        const contextC = context && context.c !== undefined && context.c !== null ? context.c : null;
        const ctxRe = contextC ? argRe(contextC) : zRe;
        const ctxIm = contextC ? argIm(contextC) : zIm;
        kernel.raw(zRe, zIm, ctxRe, ctxIm, ALG_TMP, 0);
        return { re: ALG_TMP[0], im: ALG_TMP[1] };
    }

    let value = toComplex(term.coeff ?? ONE);
    const z = { re: argRe(z_re), im: argIm(z_re, z_im) };
    const evalContext = context || { c: z };

    for (const factor of term.factors ?? []) {
        if (!factor || factor.func === 'none') break;
        value = complexMul(value, evaluateFunctionBlock(factor, z, undefined, evalContext));
    }

    return value;
}

let algebraicZExprCompiled = null;
let algebraicZExprCacheKey = null;

export function evaluateAlgebraicChaining(z_re, z_im, context = null) {
    const terms = state.algebraicChainingTerms;
    if (!state.algebraicChainingEnabled || !Array.isArray(terms) || terms.length === 0) {
        return { re: 0, im: 0 };
    }

    const zInputRe = argRe(z_re);
    const zInputIm = argIm(z_re, z_im);
    const compiledKernel = getCompiledAlgebraicKernel(terms);
    if (compiledKernel) {
        if (compiledKernel.raw) {
            const contextC = context && context.c !== undefined && context.c !== null ? context.c : null;
            const ctxRe = contextC ? argRe(contextC) : zInputRe;
            const ctxIm = contextC ? argIm(contextC) : zInputIm;
            compiledKernel.raw(zInputRe, zInputIm, ctxRe, ctxIm, ALG_TMP, 0);
            return { re: ALG_TMP[0], im: ALG_TMP[1] };
        }
        const compiledResult = compiledKernel(zInputRe, zInputIm, context);
        if (compiledResult) return compiledResult;
    }

    let z = { re: zInputRe, im: zInputIm };

    if (state.algebraicChainingZExpr && state.algebraicChainingZExpr !== 'z') {
        if (algebraicZExprCacheKey !== state.algebraicChainingZExpr) {
            try {
                algebraicZExprCompiled = compileExpression(state.algebraicChainingZExpr, { allowedVariables: ['z'] });
            } catch (e) {
                algebraicZExprCompiled = null;
            }
            algebraicZExprCacheKey = state.algebraicChainingZExpr;
        }
        if (!algebraicZExprCompiled) return NAN_COMPLEX;
        try {
            const result = algebraicZExprCompiled({ z });
            if (typeof result === 'number') {
                z = { re: result, im: 0 };
            } else if (result && typeof result === 'object' && 're' in result) {
                z = { re: result.re, im: result.im || 0 };
            } else {
                return NAN_COMPLEX;
            }
            if (invalidComplex(z)) return NAN_COMPLEX;
        } catch (e) {
            return NAN_COMPLEX;
        }
    }

    const evalContext = context || { c: z };
    let sum = { re: 0, im: 0 };

    for (const term of terms) {
        const value = evaluateAlgebraicTerm(term, z, undefined, evalContext);
        if (invalidComplex(value)) return { re: NaN, im: NaN };
        sum = complexAdd(sum, value);
    }

    return sum;
}

export const transformFunctions = {
    cos: complexCos,
    sin: complexSin,
    tan: complexTan,
    sec: complexSec,
    exp: complexExp,
    ln: complexLn,
    reciprocal: complexReciprocal,
    sinh: complexSinh,
    cosh: complexCosh,
    tanh: complexTanh,
    power: complexPowerFractional,
    mobius: complexMobius,
    zeta: complexRiemannZeta,
    polynomial: complexPolynomial,
    poincare: complexPoincareCustomMetric,
    algebraic_chaining: evaluateAlgebraicChaining
};

const REAL_PLOT_KERNELS = Object.freeze({
    cos: 'cos',
    sin: 'sin',
    exp: 'exp',
    reciprocal: 'reciprocal'
});

for (const [key, kernel] of Object.entries(REAL_PLOT_KERNELS)) {
    Object.defineProperty(transformFunctions[key], 'realPlotsKernel', {
        value: kernel,
        enumerable: false,
        configurable: false
    });
}

const MAPPED_TRANSFORM_ABS_EPSILON = 1e-5;
const MAPPED_TRANSFORM_REL_EPSILON = 1e-7;
const MAPPED_TRANSFORM_MIN_AGREEMENT_RATIO = 0.9;
const MAPPED_TRANSFORM_MIN_CONSTANT_SAMPLES = 9;
const DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE = 1e18;
const MAPPED_TRANSFORM_DIAGNOSTIC_STENCIL = Object.freeze([
    Object.freeze({ re: 0, im: 0 }),
    Object.freeze({ re: 1, im: 0 }),
    Object.freeze({ re: -1, im: 0.75 }),
    Object.freeze({ re: 0.5, im: -1 }),
    Object.freeze({ re: 2.25, im: 0.25 }),
    Object.freeze({ re: -2, im: -0.5 }),
    Object.freeze({ re: 1.75, im: 1.25 }),
    Object.freeze({ re: -1.5, im: -1.25 }),
    Object.freeze({ re: 0.25, im: 2 }),
    Object.freeze({ re: -0.75, im: -2 }),
    Object.freeze({ re: 2, im: -1.75 }),
    Object.freeze({ re: -2.25, im: 1.5 }),
    Object.freeze({ re: 0.33, im: -2.5 }),
    Object.freeze({ re: 2.75, im: 2.25 }),
    Object.freeze({ re: -2.5, im: -2.25 })
]);

let mappedTransformProfileCacheKey = null;
let mappedTransformProfileCacheValue = null;

export function mappedTransformNumberKey(value) {
    return finite(value) ? value.toFixed(12) : `${value}`;
}

export function mappedTransformComplexKey(value) {
    if (!value) return 'none';
    return `${mappedTransformNumberKey(realOf(value))},${mappedTransformNumberKey(imagOf(value))}`;
}

function boundedPolynomialDegree() {
    return Math.max(0, Math.min(MAX_POLY_DEGREE, finite(state.polynomialN) ? state.polynomialN : 0));
}

function appendPolynomialProfileParts(parts, prefix = 'p') {
    const degree = boundedPolynomialDegree();
    parts.push(`n:${degree}`);
    for (let i = 0; i <= degree; i++) {
        parts.push(`${prefix}${i}:${mappedTransformComplexKey(state.polynomialCoeffs?.[i])}`);
    }
}

function serializeAlgebraicTerms(terms) {
    if (!Array.isArray(terms)) return '[]';

    return terms.map((term, termIndex) => {
        const coeff = mappedTransformComplexKey(term?.coeff);
        const factors = (term?.factors ?? []).map((factor, factorIndex) => [
            termIndex,
            factorIndex,
            factor?.func ?? 'none',
            factor?.chainedFunc ?? 'none',
            mappedTransformNumberKey(factor?.power ?? 1),
            factor?.reciprocal ? 1 : 0,
            factor?.log ? 1 : 0,
            factor?.exp ? 1 : 0
        ].join(':')).join(';');

        return `${termIndex}|${coeff}|${factors}`;
    }).join('||');
}

export function buildMappedTransformProfileKey(functionKey) {
    const parts = [
        `f:${functionKey}`,
        `zetaC:${state.zetaContinuationEnabled ? 1 : 0}`,
        `frac:${mappedTransformNumberKey(state.fractionalPowerN !== undefined ? state.fractionalPowerN : DEFAULT_FRACTIONAL_POWER)}`
    ];

    if (functionKey === 'mobius') {
        parts.push(
            `a:${mappedTransformComplexKey(state.mobiusA)}`,
            `b:${mappedTransformComplexKey(state.mobiusB)}`,
            `c:${mappedTransformComplexKey(state.mobiusC)}`,
            `d:${mappedTransformComplexKey(state.mobiusD)}`
        );
    } else if (functionKey === 'polynomial') {
        appendPolynomialProfileParts(parts);
    } else if (functionKey === 'algebraic_chaining') {
        parts.push(`alg:${serializeAlgebraicTerms(state.algebraicChainingTerms)}`);
        parts.push(`algZ:${state.algebraicChainingZExpr}`);
    }

    return parts.join('|');
}

export function cloneMappedComplex(value) {
    return value ? { re: value.re, im: value.im } : null;
}

export function isValidMappedTransformValue(value) {
    return !!(
        value &&
        typeof value.re === 'number' &&
        typeof value.im === 'number' &&
        finite(value.re) &&
        finite(value.im) &&
        isNumericallyStable(value)
    );
}

export function shouldSkipMappedTransformPoint(functionKey, zPoint) {
    return functionKey === 'zeta' &&
        !state.zetaContinuationEnabled &&
        zPoint &&
        zPoint.re <= ZETA_REFLECTION_POINT_RE;
}

export function evaluateRawMappedTransform(transformFunc, zPoint, functionKey = state.currentFunction, evalContext = null) {
    if (!transformFunc || !zPoint || zPoint.re === undefined || zPoint.im === undefined) return null;
    if (shouldSkipMappedTransformPoint(functionKey, zPoint)) return null;

    const mapped = transformFunc(zPoint.re, zPoint.im, evalContext);
    return isValidMappedTransformValue(mapped) ? mapped : null;
}

export function getMappedTransformTolerance(value) {
    return MAPPED_TRANSFORM_ABS_EPSILON +
        MAPPED_TRANSFORM_REL_EPSILON * Math.max(1, Math.hypot(value.re, value.im));
}

export function getMappedConstantCluster(samples, minSamples = MAPPED_TRANSFORM_MIN_CONSTANT_SAMPLES) {
    if (!samples || samples.length < minSamples) return null;

    let bestValue = null;
    let bestCount = 0;

    for (const candidate of samples) {
        const eps = getMappedTransformTolerance(candidate);
        const epsSq = eps * eps;
        let count = 0;
        let sumRe = 0;
        let sumIm = 0;

        for (const sample of samples) {
            const dRe = sample.re - candidate.re;
            const dIm = sample.im - candidate.im;

            if (dRe * dRe + dIm * dIm <= epsSq) {
                count++;
                sumRe += sample.re;
                sumIm += sample.im;
            }
        }

        if (count > bestCount) {
            bestCount = count;
            bestValue = { re: sumRe / count, im: sumIm / count };
        }
    }

    const agreement = samples.length ? bestCount / samples.length : 0;
    return bestValue && agreement >= MAPPED_TRANSFORM_MIN_AGREEMENT_RATIO
        ? { value: bestValue, agreement, validCount: samples.length }
        : null;
}

export function detectMappedConstantTransform(transformFunc, functionKey = state.currentFunction) {
    const samples = [];

    for (const point of MAPPED_TRANSFORM_DIAGNOSTIC_STENCIL) {
        const mapped = evaluateRawMappedTransform(transformFunc, point, functionKey);
        if (mapped) samples.push(mapped);
    }

    return getMappedConstantCluster(samples);
}

export function getMappedTransformProfile(functionKey = state.currentFunction, transformFunc = null) {
    const resolvedTransform = transformFunc || transformFunctions[functionKey];

    if (typeof resolvedTransform !== 'function') {
        return { functionKey, transformFunc: null, isConstant: false, constantValue: null };
    }

    const cacheable = resolvedTransform === transformFunctions[functionKey];
    if (cacheable) {
        if (cachesDirty) {
            mappedProfileCache.clear();
            chainedFuncCache.clear();
            cachesDirty = false;
        }
        const cached = mappedProfileCache.get(functionKey);
        if (cached) {
            return cached;
        }
    }

    const constant = detectMappedConstantTransform(resolvedTransform, functionKey);
    const profile = {
        functionKey,
        transformFunc: resolvedTransform,
        isConstant: !!constant,
        constantValue: constant ? constant.value : null,
        constantAgreement: constant ? constant.agreement : 0,
        constantSampleCount: constant ? constant.validCount : 0
    };

    if (cacheable) {
        mappedProfileCache.set(functionKey, profile);
    }

    return profile;
}


function evaluateRawMappedTransformXY(transformFunc, re, im, functionKey = state.currentFunction, evalContext = null) {
    if (!transformFunc) return null;
    if (functionKey === 'zeta' && !state.zetaContinuationEnabled && re <= ZETA_REFLECTION_POINT_RE) return null;
    const mapped = transformFunc(re, im, evalContext);
    return isValidMappedTransformValue(mapped) ? mapped : null;
}

export function evaluateMappedTransform(profileOrTransform, re, im, functionKey = state.currentFunction, evalContext = null) {
    if (!profileOrTransform) return null;

    if (typeof profileOrTransform === 'function') {
        return evaluateRawMappedTransformXY(profileOrTransform, re, im, functionKey, evalContext);
    }

    if (!evalContext && profileOrTransform.isConstant && profileOrTransform.constantValue) {
        return cloneMappedComplex(profileOrTransform.constantValue);
    }

    const resolvedKey = profileOrTransform.functionKey || functionKey;
    if (resolvedKey === 'algebraic_chaining' && profileOrTransform.transformFunc === transformFunctions.algebraic_chaining) {
        const terms = state.algebraicChainingTerms;
        const kernel = state.algebraicChainingEnabled && Array.isArray(terms) && terms.length !== 0 ? getCompiledAlgebraicKernel(terms) : null;
        if (kernel?.raw) {
            const contextC = evalContext && evalContext.c !== undefined && evalContext.c !== null ? evalContext.c : null;
            const ctxRe = contextC ? argRe(contextC) : re;
            const ctxIm = contextC ? argIm(contextC) : im;
            kernel.raw(re, im, ctxRe, ctxIm, ALG_TMP, 0);
            return finite(ALG_TMP[0]) && finite(ALG_TMP[1]) ? { re: ALG_TMP[0], im: ALG_TMP[1] } : null;
        }
    }

    return evaluateRawMappedTransformXY(
        profileOrTransform.transformFunc,
        re,
        im,
        resolvedKey,
        evalContext
    );
}

function exceedsDomainColorChainBailout(value) {
    return Math.max(Math.abs(value?.re ?? 0), Math.abs(value?.im ?? 0)) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE;
}

export function getEffectiveBaseTransformFunction(funcKey = state.currentFunction) {
    let baseFunc = transformFunctions[funcKey];
    if (!baseFunc) return (re, im) => ({ re, im });

    if (state.taylorSeriesEnabled && (!state.riemannSphereViewEnabled || state.splitViewEnabled)) {
        baseFunc = createTaylorApproximationTransform(
            funcKey,
            state.taylorSeriesCenter,
            state.taylorSeriesOrder
        );
    }

    if (typeof activeTransformProvider === 'function') {
        const provided = activeTransformProvider({ funcKey, baseFunc, state });
        if (typeof provided === 'function') {
            baseFunc = provided;
        }
    }

    return baseFunc;
}

export function setActiveTransformProvider(provider) {
    activeTransformProvider = typeof provider === 'function' ? provider : null;
}

function validOrNull(value) {
    return isValidMappedTransformValue(value) ? value : null;
}

function chainStageIndex(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
}

function evaluateChainBase(profileOrTransform, value, functionKey, c) {
    if (!validComplex(value)) return null;
    return validOrNull(evaluateMappedTransform(
        profileOrTransform,
        value.re,
        value.im,
        functionKey,
        { c }
    ));
}

function evaluateFastAlgebraicMappedChain(re, im, stageIndex, returnLastFinite) {
    const terms = state.algebraicChainingTerms;
    const kernel = state.algebraicChainingEnabled && Array.isArray(terms) && terms.length !== 0 ? getCompiledAlgebraicKernel(terms) : null;
    const raw = kernel?.raw || null;
    if (!raw) return undefined;

    const tmp = ALG_TMP;
    const stage = chainStageIndex(stageIndex);
    const cRe = re;
    const cIm = im;
    let currentRe;
    let currentIm;
    let lastRe = NaN;
    let lastIm = NaN;
    let hasLast = false;

    if (state.chainingMode === 'zero_seed') {
        currentRe = 0;
        currentIm = 0;
        for (let i = 0; i <= stage; i++) {
            raw(currentRe, currentIm, cRe, cIm, tmp, 0);
            currentRe = tmp[0];
            currentIm = tmp[1];
            if (!finite(currentRe) || !finite(currentIm)) {
                return returnLastFinite && hasLast ? { re: lastRe, im: lastIm } : null;
            }
            lastRe = currentRe;
            lastIm = currentIm;
            hasLast = true;
            if (Math.max(Math.abs(currentRe), Math.abs(currentIm)) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) {
                return returnLastFinite ? { re: currentRe, im: currentIm } : null;
            }
        }
        return hasLast ? { re: lastRe, im: lastIm } : null;
    }

    raw(re, im, cRe, cIm, tmp, 0);
    currentRe = tmp[0];
    currentIm = tmp[1];
    if (!finite(currentRe) || !finite(currentIm)) return null;
    lastRe = currentRe;
    lastIm = currentIm;
    if (Math.max(Math.abs(currentRe), Math.abs(currentIm)) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) {
        return returnLastFinite ? { re: currentRe, im: currentIm } : null;
    }

    for (let i = 1; i <= stage; i++) {
        raw(currentRe, currentIm, cRe, cIm, tmp, 0);
        currentRe = tmp[0];
        currentIm = tmp[1];
        if (!finite(currentRe) || !finite(currentIm)) {
            return returnLastFinite ? { re: lastRe, im: lastIm } : null;
        }
        lastRe = currentRe;
        lastIm = currentIm;
        if (Math.max(Math.abs(currentRe), Math.abs(currentIm)) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) {
            return returnLastFinite ? { re: currentRe, im: currentIm } : null;
        }
    }

    return { re: currentRe, im: currentIm };
}

function evaluateMappedChainStage(profileOrTransform, re, im, functionKey, stageIndex, options = null) {
    const returnLastFinite = !!options?.returnLastFinite;
    if (functionKey === 'algebraic_chaining' && profileOrTransform?.transformFunc === transformFunctions.algebraic_chaining) {
        const fast = evaluateFastAlgebraicMappedChain(re, im, stageIndex, returnLastFinite);
        if (fast !== undefined) return fast;
    }

    const c = { re, im };
    const stage = chainStageIndex(stageIndex);

    if (state.chainingMode === 'zero_seed') {
        let current = { re: 0, im: 0 };
        let lastFinite = null;

        for (let i = 0; i <= stage; i += 1) {
            current = evaluateChainBase(profileOrTransform, current, functionKey, c);
            if (!current) return returnLastFinite ? lastFinite : null;
            lastFinite = current;
            if (exceedsDomainColorChainBailout(current)) return returnLastFinite ? current : null;
        }

        return current;
    }

    let current = evaluateMappedTransform(profileOrTransform, re, im, functionKey, { c });
    if (!current) return null;

    let lastFinite = validOrNull(current);
    if (!lastFinite || exceedsDomainColorChainBailout(lastFinite)) return returnLastFinite ? lastFinite : null;

    for (let i = 1; i <= stage; i += 1) {
        current = evaluateChainBase(profileOrTransform, current, functionKey, c);
        if (!current) return returnLastFinite ? lastFinite : null;

        lastFinite = current;
        if (exceedsDomainColorChainBailout(current)) return returnLastFinite ? current : null;
    }

    return current;
}

export function evaluateDomainColoringMappedTransform(profileOrTransform, re, im, functionKey = state.currentFunction) {
    if (!state.chainingEnabled || (state.chainCount <= 1 && state.chainingMode !== 'zero_seed')) {
        return evaluateMappedTransform(profileOrTransform, re, im, functionKey, { c: { re, im } });
    }

    return evaluateMappedChainStage(
        profileOrTransform,
        re,
        im,
        functionKey,
        Math.floor(Number(state.chainCount) || 1) - 1,
        { returnLastFinite: true }
    );
}

function createFastAlgebraicChainedTransform(stage) {
    const kernel = getCompiledAlgebraicKernel(state.algebraicChainingTerms);
    if (!kernel) return null;
    const rawKernel = kernel.raw || null;

    return (re, im) => {
        const tmp = ALG_TMP;
        const cRe = re;
        const cIm = im;
        let currentRe;
        let currentIm;
        let lastRe = NaN;
        let lastIm = NaN;

        if (state.chainingMode === 'zero_seed') {
            currentRe = 0;
            currentIm = 0;
            for (let i = 0; i <= stage; i++) {
                if (rawKernel) rawKernel(currentRe, currentIm, cRe, cIm, tmp, 0);
                else kernel(currentRe, currentIm, cRe, cIm, tmp, 0);
                currentRe = tmp[0];
                currentIm = tmp[1];
                if (!finite(currentRe) || !finite(currentIm)) return { re: NaN, im: NaN };
                lastRe = currentRe;
                lastIm = currentIm;
                if (Math.max(Math.abs(currentRe), Math.abs(currentIm)) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) break;
            }
            return { re: lastRe, im: lastIm };
        }

        if (rawKernel) rawKernel(re, im, cRe, cIm, tmp, 0);
        else kernel(re, im, cRe, cIm, tmp, 0);
        currentRe = tmp[0];
        currentIm = tmp[1];
        if (!finite(currentRe) || !finite(currentIm)) return { re: NaN, im: NaN };
        if (Math.max(Math.abs(currentRe), Math.abs(currentIm)) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) return { re: NaN, im: NaN };
        for (let i = 1; i <= stage; i++) {
            if (rawKernel) rawKernel(currentRe, currentIm, cRe, cIm, tmp, 0);
            else kernel(currentRe, currentIm, cRe, cIm, tmp, 0);
            currentRe = tmp[0];
            currentIm = tmp[1];
            if (!finite(currentRe) || !finite(currentIm)) return { re: NaN, im: NaN };
            if (Math.max(Math.abs(currentRe), Math.abs(currentIm)) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) return { re: NaN, im: NaN };
        }

        return { re: currentRe, im: currentIm };
    };
}

function createChainedTransformForStage(funcKey, stageIndex, baseFunc) {
    const stage = chainStageIndex(stageIndex);
    if (funcKey === 'algebraic_chaining' && baseFunc === transformFunctions.algebraic_chaining) {
        const fast = createFastAlgebraicChainedTransform(stage);
        if (fast) return fast;
    }

    const baseProfile = getMappedTransformProfile(funcKey, baseFunc);

    return (re, im) => {
        const mapped = evaluateMappedChainStage(baseProfile, re, im, funcKey, stage);
        return mapped || { re: NaN, im: NaN };
    };
}

export function getChainedStageTransformFunction(funcKey = state.currentFunction, stageIndex = 0) {
    const baseFunc = getEffectiveBaseTransformFunction(funcKey);

    if (!state.chainingEnabled) {
        return baseFunc;
    }

    return createChainedTransformForStage(funcKey, stageIndex, baseFunc);
}

export function getChainedTransformFunction(funcKey = state.currentFunction) {
    if (cachesDirty) {
        mappedProfileCache.clear();
        chainedFuncCache.clear();
        cachesDirty = false;
    }

    const cached = chainedFuncCache.get(funcKey);
    if (cached) {
        return cached;
    }

    const baseFunc = getEffectiveBaseTransformFunction(funcKey);

    let resultFunc;
    if (!state.chainingEnabled || (state.chainCount <= 1 && state.chainingMode !== 'zero_seed')) {
        resultFunc = baseFunc;
    } else {
        const stageIndex = Math.max(0, Math.floor(Number(state.chainCount) || 1) - 1);
        resultFunc = createChainedTransformForStage(funcKey, stageIndex, baseFunc);
    }

    chainedFuncCache.set(funcKey, resultFunc);
    return resultFunc;
}

const CONTOUR_GENERATORS = {
    circle: {
        valid: ({ r }) => r > 0,
        point: ({ cx, cy, r }, t) => ({ re: cx + r * Math.cos(t), im: cy + r * Math.sin(t) }),
        inside: (point, { cx, cy, r }, toleranceFactor) => {
            if (r <= 0) return false;
            const dx = point.re - cx;
            const dy = point.im - cy;
            return dx * dx + dy * dy < r * r * toleranceFactor;
        }
    },
    ellipse: {
        valid: ({ a, b }) => a > 0 && b > 0,
        point: ({ cx, cy, a, b }, t) => ({ re: cx + a * Math.cos(t), im: cy + b * Math.sin(t) }),
        inside: (point, { cx, cy, a, b }, toleranceFactor) => {
            if (a <= 0 || b <= 0) return false;
            const x = (point.re - cx) / a;
            const y = (point.im - cy) / b;
            return x * x + y * y < toleranceFactor;
        }
    }
};

export function getContourPoints(shapeType, params, numSteps) {
    const shape = CONTOUR_GENERATORS[shapeType];
    const steps = Math.floor(numSteps);

    if (!shape || !params || !shape.valid(params) || !finite(steps) || steps < 1) return [];

    const points = new Array(steps + 1);
    for (let i = 0; i <= steps; i++) {
        points[i] = shape.point(params, (i / steps) * TWO_PI);
    }
    return points;
}

export function numericalLineIntegral(transformFunc, contourPoints) {
    if (!contourPoints || contourPoints.length < 2) return { re: 0, im: 0 };

    let totalRe = 0;
    let totalIm = 0;

    for (let i = 0; i < contourPoints.length - 1; i++) {
        const z0 = contourPoints[i];
        const z1 = contourPoints[i + 1];
        const dzRe = z1.re - z0.re;
        const dzIm = z1.im - z0.im;
        const value = transformFunc((z0.re + z1.re) * 0.5, (z0.im + z1.im) * 0.5);

        if (invalidComplex(value)) return { re: NaN, im: NaN };
        totalRe += value.re * dzRe - value.im * dzIm;
        totalIm += value.re * dzIm + value.im * dzRe;
    }

    return { re: totalRe, im: totalIm };
}

export function isPointInsideContour(point, contourType, params) {
    const shape = CONTOUR_GENERATORS[contourType];
    return !!shape && !!params && shape.inside(toComplex(point), params, 1 - 1e-9);
}

export function estimateResidue(transformFunc, pole, epsilonRadius, numSteps) {
    const centerRe = argRe(pole);
    const centerIm = argIm(pole);
    const radius = Math.max(epsilonRadius, 1e-6);
    const points = getContourPoints('circle', { cx: centerRe, cy: centerIm, r: radius }, numSteps);

    if (!points.length) return { re: NaN, im: NaN };

    const integral = numericalLineIntegral(transformFunc, points);
    if (invalidComplex(integral)) return { re: NaN, im: NaN };

    return divideRaw(integral.re, integral.im, 0, TWO_PI);
}

export function factorial(n) {
    if (n < 0) return NaN;
    if (n === 0 || n === 1) return 1;

    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
}

export function isFiniteComplex(c) {
    return !!c && finite(c.re) && finite(c.im);
}

export function getTaylorDerivativeStep(zComplex, order, hBase = 1e-4) {
    const z = toComplex(zComplex);
    const scale = Math.max(1, Math.abs(z.re), Math.abs(z.im));
    const multiplier = ({ 1: 1, 2: 2, 3: 8, 4: 24 })[order] || Math.max(24, order * order * 2);
    return hBase * multiplier * scale;
}

const DERIVATIVE_STENCILS = Object.freeze({
    1: Object.freeze({ denominator: h => 2 * h, offsets: Object.freeze([-1, 1]), weights: Object.freeze([-1, 1]) }),
    2: Object.freeze({ denominator: h => h * h, offsets: Object.freeze([-1, 0, 1]), weights: Object.freeze([1, -2, 1]) }),
    3: Object.freeze({ denominator: h => 2 * h * h * h, offsets: Object.freeze([-2, -1, 1, 2]), weights: Object.freeze([-1, 2, -2, 1]) }),
    4: Object.freeze({ denominator: h => h * h * h * h, offsets: Object.freeze([-2, -1, 0, 1, 2]), weights: Object.freeze([1, -4, 6, -4, 1]) })
});

function applyDerivativeStencil(funcWrapper, zComplex, h, stencil) {
    const z = toComplex(zComplex);
    const sum = { re: 0, im: 0 };

    for (let i = 0; i < stencil.offsets.length; i++) {
        const value = funcWrapper({ re: z.re + stencil.offsets[i] * h, im: z.im });
        if (!isFiniteComplex(value)) return { re: NaN, im: NaN };
        addInto(sum, value, stencil.weights[i]);
    }

    return complexDivide(sum, { re: stencil.denominator(h), im: 0 });
}

export function numericDerivativeNthOrder(funcWrapper, zComplex, order, h_base = 1e-5) {
    if (order < 1) return funcWrapper(zComplex);

    const z = toComplex(zComplex);
    const h = getTaylorDerivativeStep(z, order, h_base);
    const stencil = DERIVATIVE_STENCILS[order];

    if (stencil) return applyDerivativeStencil(funcWrapper, z, h, stencil);

    console.warn(`numericDerivativeNthOrder not implemented for order ${order} using general recursive method (less accurate).`);
    const plus = numericDerivativeNthOrder(funcWrapper, { re: z.re + h, im: z.im }, order - 1, h);
    const minus = numericDerivativeNthOrder(funcWrapper, { re: z.re - h, im: z.im }, order - 1, h);

    if (!isFiniteComplex(plus) || !isFiniteComplex(minus)) return { re: NaN, im: NaN };
    return complexDivide(complexSub(plus, minus), { re: 2 * h, im: 0 });
}

const taylorSeriesCoefficientCache = {
    key: null,
    coefficients: null
};

export function toTaylorCacheNumber(value) {
    return finite(value) ? value.toFixed(9) : `${value}`;
}

export function appendTaylorCacheComplexParts(parts, prefix, value) {
    const safeValue = value || DEFAULT_TAYLOR_SERIES_CENTER;
    parts.push(`${prefix}r:${toTaylorCacheNumber(realOf(safeValue))}`);
    parts.push(`${prefix}i:${toTaylorCacheNumber(imagOf(safeValue))}`);
}

function appendTaylorPolynomialParts(parts, prefix) {
    const degree = boundedPolynomialDegree();
    parts.push(`${prefix}polyN:${degree}`);
    for (let i = 0; i <= degree; i++) {
        appendTaylorCacheComplexParts(parts, `${prefix}p${i}`, state.polynomialCoeffs?.[i] ?? null);
    }
}

function appendTaylorMobiusParts(parts, prefix) {
    appendTaylorCacheComplexParts(parts, `${prefix}mA`, state.mobiusA);
    appendTaylorCacheComplexParts(parts, `${prefix}mB`, state.mobiusB);
    appendTaylorCacheComplexParts(parts, `${prefix}mC`, state.mobiusC);
    appendTaylorCacheComplexParts(parts, `${prefix}mD`, state.mobiusD);
}

export function buildTaylorSeriesCoefficientCacheKey(functionKey, z0Complex, order) {
    const z0 = toComplex(z0Complex);
    const parts = [
        `f:${functionKey}`,
        `order:${order}`,
        `z0r:${toTaylorCacheNumber(z0.re)}`,
        `z0i:${toTaylorCacheNumber(z0.im)}`
    ];

    if (functionKey === 'zeta') {
        parts.push(`zetaC:${state.zetaContinuationEnabled ? 1 : 0}`);
    } else if (functionKey === 'mobius') {
        appendTaylorMobiusParts(parts, '');
    } else if (functionKey === 'polynomial') {
        appendTaylorPolynomialParts(parts, '');
    } else if (functionKey === 'algebraic_chaining') {
        const terms = state.algebraicChainingTerms ?? [];
        parts.push(`algTerms:${terms.length}`);
        parts.push(`algZExpr:${state.algebraicChainingZExpr || 'z'}`);

        terms.forEach((term, termIndex) => {
            parts.push(`t${termIndex}:${(term.factors ?? []).map(factor => factor.func).join(',')}`);
            appendTaylorCacheComplexParts(parts, `t${termIndex}c`, term.coeff);

            (term.factors ?? []).forEach((factor, factorIndex) => {
                if (factor.func === 'none') return;

                const prefix = `t${termIndex}f${factorIndex}`;
                parts.push(`${prefix}chain:${factor.chainedFunc}`);
                parts.push(`${prefix}pow:${toTaylorCacheNumber(factor.power)}`);
                parts.push(`${prefix}recip:${factor.reciprocal ? 1 : 0}`);
                parts.push(`${prefix}log:${factor.log ? 1 : 0}`);
                parts.push(`${prefix}exp:${factor.exp ? 1 : 0}`);

                if (factor.func === 'mobius' || factor.chainedFunc === 'mobius') appendTaylorMobiusParts(parts, prefix);
                if (factor.func === 'polynomial' || factor.chainedFunc === 'polynomial') appendTaylorPolynomialParts(parts, prefix);
                if (factor.func === 'power' || factor.chainedFunc === 'power') {
                    parts.push(`${prefix}fracN:${toTaylorCacheNumber(state.fractionalPowerN !== undefined ? state.fractionalPowerN : DEFAULT_FRACTIONAL_POWER)}`);
                }
            });
        });
    }

    return parts.join('|');
}

export function getTaylorContourRadius(z0Complex) {
    const convergenceRadius = state && finite(state.taylorSeriesConvergenceRadius)
        ? state.taylorSeriesConvergenceRadius
        : null;

    if (convergenceRadius !== null) {
        return convergenceRadius <= 1e-9 ? 0 : Math.max(1e-3, Math.min(1.25, convergenceRadius * 0.45));
    }

    const z0 = toComplex(z0Complex);
    const centerScale = Math.max(1, Math.abs(z0.re), Math.abs(z0.im));
    return Math.max(0.25, Math.min(1.25, centerScale * 0.35));
}

function cacheTaylorCoefficients(cacheKey, coefficients) {
    taylorSeriesCoefficientCache.key = cacheKey;
    taylorSeriesCoefficientCache.coefficients = coefficients;
    return coefficients;
}

function computeCauchyCoefficients(originalTransformFunc, z0Complex, contourPoints, order) {
    const integrals = Array.from({ length: order + 1 }, zeroLike);

    for (let i = 0; i < contourPoints.length - 1; i++) {
        const a = contourPoints[i];
        const b = contourPoints[i + 1];
        const dz = complexSub(b, a);
        const mid = { re: (a.re + b.re) / 2, im: (a.im + b.im) / 2 };
        const functionValue = originalTransformFunc(mid.re, mid.im);

        if (!isFiniteComplex(functionValue)) return null;

        const delta = { re: mid.re - z0Complex.re, im: mid.im - z0Complex.im };
        const inverseDelta = complexReciprocal(delta);

        if (!isFiniteComplex(inverseDelta)) return null;

        let inversePower = inverseDelta;

        for (let n = 0; n <= order; n++) {
            addInto(integrals[n], complexMul(complexMul(functionValue, inversePower), dz));
            inversePower = complexMul(inversePower, inverseDelta);
        }
    }

    const coefficients = integrals.map(integral => complexDivide(integral, { re: 0, im: TWO_PI }));
    return coefficients.every(isFiniteComplex) ? coefficients : null;
}


function computeCauchyCoefficientsOnCircle(originalTransformFunc, z0Complex, radius, stepCount, order) {
    const accRe = new Float64Array(order + 1);
    const accIm = new Float64Array(order + 1);
    let prevRe = z0Complex.re + radius;
    let prevIm = z0Complex.im;

    for (let i = 1; i <= stepCount; i++) {
        const t = (i / stepCount) * TWO_PI;
        const currRe = z0Complex.re + radius * Math.cos(t);
        const currIm = z0Complex.im + radius * Math.sin(t);
        const dzRe = currRe - prevRe;
        const dzIm = currIm - prevIm;
        const midRe = (prevRe + currRe) * 0.5;
        const midIm = (prevIm + currIm) * 0.5;
        const functionValue = originalTransformFunc(midRe, midIm);

        if (!isFiniteComplex(functionValue)) return null;

        const deltaRe = midRe - z0Complex.re;
        const deltaIm = midIm - z0Complex.im;
        const denom = deltaRe * deltaRe + deltaIm * deltaIm;
        if (!(denom > 0) || !finite(denom)) return null;

        const invRe = deltaRe / denom;
        const invIm = -deltaIm / denom;
        let powRe = invRe;
        let powIm = invIm;

        for (let n = 0; n <= order; n++) {
            const fpRe = functionValue.re * powRe - functionValue.im * powIm;
            const fpIm = functionValue.re * powIm + functionValue.im * powRe;
            accRe[n] += fpRe * dzRe - fpIm * dzIm;
            accIm[n] += fpRe * dzIm + fpIm * dzRe;

            const nextRe = powRe * invRe - powIm * invIm;
            powIm = powRe * invIm + powIm * invRe;
            powRe = nextRe;
        }

        prevRe = currRe;
        prevIm = currIm;
    }

    const coefficients = new Array(order + 1);
    for (let n = 0; n <= order; n++) {
        coefficients[n] = { re: accIm[n] / TWO_PI, im: -accRe[n] / TWO_PI };
        if (!isFiniteComplex(coefficients[n])) return null;
    }
    return coefficients;
}

export function computeTaylorSeriesCoefficients(originalTransformFuncKey, z0Complex, order) {
    const originalTransformFunc = transformFunctions[originalTransformFuncKey];
    if (!originalTransformFunc) {
        console.error('Taylor: Original transform function not found for key:', originalTransformFuncKey);
        return null;
    }

    const z0 = { re: argRe(z0Complex), im: argIm(z0Complex) };
    const cacheKey = buildTaylorSeriesCoefficientCacheKey(originalTransformFuncKey, z0, order);

    if (taylorSeriesCoefficientCache.key === cacheKey) {
        return taylorSeriesCoefficientCache.coefficients;
    }

    const radius = getTaylorContourRadius(z0);
    if (!(radius > 0)) return cacheTaylorCoefficients(cacheKey, null);

    const contourStepCount = Math.max(192, 48 * (order + 1));
    return cacheTaylorCoefficients(
        cacheKey,
        computeCauchyCoefficientsOnCircle(originalTransformFunc, z0, radius, contourStepCount, order)
    );
}

export function evaluateTaylorSeries(coefficients, zInputComplex, z0Complex) {
    if (!Array.isArray(coefficients) || coefficients.length === 0) return { re: NaN, im: NaN };

    const deltaRe = argRe(zInputComplex) - argRe(z0Complex);
    const deltaIm = argIm(zInputComplex) - argIm(z0Complex);
    let sumRe = 0;
    let sumIm = 0;

    for (let n = coefficients.length - 1; n >= 0; n--) {
        const mulRe = sumRe * deltaRe - sumIm * deltaIm;
        const mulIm = sumRe * deltaIm + sumIm * deltaRe;
        const coefficient = coefficients[n];
        if (isFiniteComplex(coefficient)) {
            sumRe = mulRe + coefficient.re;
            sumIm = mulIm + coefficient.im;
        } else {
            sumRe = mulRe;
            sumIm = mulIm;
        }
    }

    return { re: sumRe, im: sumIm };
}

const ENTIRE_FUNCTIONS = new Set(['exp', 'sin', 'cos', 'polynomial']);

export function updateTaylorSeriesCenterAndRadius() {
    state.taylorSeriesCenter = state.taylorSeriesCustomCenterEnabled
        ? { re: state.taylorSeriesCustomCenter.re, im: state.taylorSeriesCustomCenter.im }
        : { re: DEFAULT_TAYLOR_SERIES_CENTER.re, im: DEFAULT_TAYLOR_SERIES_CENTER.im };

    let minDistanceSq = Infinity;
    let nearestPole = null;

    if (Array.isArray(state.poles)) {
        for (const pole of state.poles) {
            if (!pole || typeof pole.re !== 'number' || typeof pole.im !== 'number' || !finite(pole.re) || !finite(pole.im)) {
                continue;
            }

            const dx = pole.re - state.taylorSeriesCenter.re;
            const dy = pole.im - state.taylorSeriesCenter.im;
            const distanceSq = dx * dx + dy * dy;

            if (distanceSq < minDistanceSq) {
                minDistanceSq = distanceSq;
                nearestPole = pole;
            }
        }
    }

    if (nearestPole) {
        state.taylorSeriesConvergenceRadius = minDistanceSq < 1e-12 ? 0 : Math.sqrt(minDistanceSq);
    } else {
        state.taylorSeriesConvergenceRadius = ENTIRE_FUNCTIONS.has(state.currentFunction) ? Infinity : 1000;
    }

    if (
        state.currentFunction === 'ln' &&
        state.taylorSeriesCenter.re === 0 &&
        state.taylorSeriesCenter.im === 0
    ) {
        state.taylorSeriesConvergenceRadius = 0;
    }
}

export function isWithinTaylorConvergenceRegion(zInputComplex, z0Complex) {
    const radius = state.taylorSeriesConvergenceRadius;
    if (!finite(radius)) return true;

    const z = toComplex(zInputComplex);
    const z0 = toComplex(z0Complex);
    const dx = z.re - z0.re;
    const dy = z.im - z0.im;

    return dx * dx + dy * dy <= radius * radius * 1.000001;
}

export function createTaylorApproximationTransform(functionKey, taylorCenter, taylorOrder) {
    const z0 = { re: taylorCenter.re, im: taylorCenter.im };
    const coefficients = computeTaylorSeriesCoefficients(functionKey, z0, taylorOrder);

    return (re, im) => {
        if (!coefficients) return { re: NaN, im: NaN };

        const input = { re, im };
        if (!isWithinTaylorConvergenceRegion(input, z0)) return { re: NaN, im: NaN };

        const result = evaluateTaylorSeries(coefficients, input, z0);
        return { re: result.re, im: result.im };
    };
}
