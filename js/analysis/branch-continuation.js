import {
    complexAsin,
    complexAtan,
    complexAdd,
    complexExp,
    complexExpAtBase,
    complexLogGamma,
    complexMul,
    complexReciprocal,
    complexDivide,
    transformFunctions
} from '../math-utils.js';
import { compileExpression } from '../math/expression/evaluator.js';
import { normalizeDomainDynamicsChainCount } from '../constants/domain-dynamics.js';
import { evaluateDynamicAggregateAt } from './dynamic-plotting.js';

const TWO_PI = Math.PI * 2;
const CROSSING_EPSILON = 1e-9;
let algebraicZSource = '';
let algebraicZEvaluator = null;

function segmentCrossing(a, b, c, d) {
    if (![a, b, c, d].every(point => Number.isFinite(point?.re) && Number.isFinite(point?.im))) return null;
    const pathRe = b.re - a.re;
    const pathIm = b.im - a.im;
    const cutRe = d.re - c.re;
    const cutIm = d.im - c.im;
    const denominator = pathRe * cutIm - pathIm * cutRe;
    if (Math.abs(denominator) <= CROSSING_EPSILON) return null;
    const offsetRe = c.re - a.re;
    const offsetIm = c.im - a.im;
    const pathT = (offsetRe * cutIm - offsetIm * cutRe) / denominator;
    const cutT = (offsetRe * pathIm - offsetIm * pathRe) / denominator;
    if (pathT <= CROSSING_EPSILON || pathT > 1 + CROSSING_EPSILON ||
        cutT < -CROSSING_EPSILON || cutT > 1 + CROSSING_EPSILON) return null;
    return { t: pathT, sheet: Math.sign(cutRe * pathIm - cutIm * pathRe) || 1 };
}

function rayCrossing(a, b, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const ar = a.re * cos + a.im * sin;
    const ai = -a.re * sin + a.im * cos;
    const br = b.re * cos + b.im * sin;
    const bi = -b.re * sin + b.im * cos;
    const delta = bi - ai;
    if (Math.abs(delta) <= CROSSING_EPSILON) return null;
    const t = -ai / delta;
    if (t <= CROSSING_EPSILON || t > 1 + CROSSING_EPSILON) return null;
    const x = ar + (br - ar) * t;
    if (x <= CROSSING_EPSILON) return null;
    return { t, sheet: delta > 0 ? 1 : -1 };
}

export function branchCutCrossingForSegment(a, b, branchCutType, branchCutAngle, branchCutPoints) {
    if (branchCutType !== 'draw' || !Array.isArray(branchCutPoints) || branchCutPoints.length < 2) {
        return rayCrossing(a, b, branchCutAngle)?.sheet || 0;
    }
    const crossings = [];
    for (let index = 1; index < branchCutPoints.length; index += 1) {
        const crossing = segmentCrossing(a, b, branchCutPoints[index - 1], branchCutPoints[index]);
        if (crossing) crossings.push(crossing);
    }
    crossings.sort((left, right) => left.t - right.t);
    let sheet = 0;
    let previousT = -Infinity;
    for (const crossing of crossings) {
        if (Math.abs(crossing.t - previousT) <= CROSSING_EPSILON) continue;
        sheet += crossing.sheet;
        previousT = crossing.t;
    }
    return sheet;
}

export function continuationSheetForPath(path, branchCutType, branchCutAngle, branchCutPoints) {
    if (!Array.isArray(path) || path.length < 2) return 0;
    let sheet = 0;
    for (let index = 1; index < path.length; index += 1) {
        const a = path[index - 1];
        const b = path[index];
        sheet += branchCutCrossingForSegment(a, b, branchCutType, branchCutAngle, branchCutPoints);
    }
    return sheet;
}

function branchArgument(z, runtimeState) {
    let argument = Math.atan2(z.im, z.re);
    if (runtimeState.branchCutType !== 'ray') return argument;
    const angle = Number.isFinite(runtimeState.branchCutAngle) ? runtimeState.branchCutAngle : Math.PI;
    while (argument > angle) argument -= TWO_PI;
    while (argument <= angle - TWO_PI) argument += TWO_PI;
    return argument;
}

function naturalLogOnSheet(z, k, runtimeState) {
    return {
        re: Math.log(Math.hypot(z.re, z.im)),
        im: branchArgument(z, runtimeState) + k * TWO_PI
    };
}

function compileAlgebraicZ(source) {
    if (source === algebraicZSource) return algebraicZEvaluator;
    algebraicZSource = source;
    try {
        algebraicZEvaluator = compileExpression(source, { allowedVariables: ['z'] });
    } catch {
        algebraicZEvaluator = null;
    }
    return algebraicZEvaluator;
}

function expressionFunctionEnvironment(z, k, runtimeState, c) {
    return {
        sin: value => evaluateBaseOnSheet('sin', value, k, runtimeState, c),
        cos: value => evaluateBaseOnSheet('cos', value, k, runtimeState, c),
        tan: value => evaluateBaseOnSheet('tan', value, k, runtimeState, c),
        sec: value => evaluateBaseOnSheet('sec', value, k, runtimeState, c),
        exp: value => evaluateBaseOnSheet('exp', value, k, runtimeState, c),
        ln: value => evaluateBaseOnSheet('ln', value, k, runtimeState, c),
        log: value => evaluateBaseOnSheet('ln', value, k, runtimeState, c),
        sqrt: value => {
            const logarithm = naturalLogOnSheet(value, k, runtimeState);
            return complexExp({ re: logarithm.re * 0.5, im: logarithm.im * 0.5 });
        },
        asin: value => evaluateBaseOnSheet('asin', value, k, runtimeState, c),
        atan: value => evaluateBaseOnSheet('atan', value, k, runtimeState, c),
        gamma: value => evaluateBaseOnSheet('gamma', value, k, runtimeState, c),
        loggamma: value => evaluateBaseOnSheet('loggamma', value, k, runtimeState, c),
        bessel: value => evaluateBaseOnSheet('bessel', value, k, runtimeState, c),
        power: value => evaluateBaseOnSheet('power', value, k, runtimeState, c)
    };
}

function evaluateAlgebraicOnSheet(zInput, k, runtimeState, c) {
    let z = zInput;
    const source = runtimeState.algebraicChainingZExpr || 'z';
    if (source !== 'z') {
        const evaluator = compileAlgebraicZ(source);
        if (!evaluator) return { re: NaN, im: NaN };
        try {
            const value = evaluator({ z, functions: expressionFunctionEnvironment(z, k, runtimeState, c) });
            z = typeof value === 'number' ? { re: value, im: 0 } : value;
        } catch {
            return { re: NaN, im: NaN };
        }
    }

    let sum = { re: 0, im: 0 };
    for (const term of runtimeState.algebraicChainingTerms || []) {
        let termValue = term?.coeff || { re: 1, im: 0 };
        for (const factor of term?.factors || []) {
            if (!factor || factor.func === 'none') break;
            let arg = z;
            if (factor.chainedFunc && factor.chainedFunc !== 'none') {
                arg = factor.chainedFunc === 'c'
                    ? c
                    : evaluateBaseOnSheet(factor.chainedFunc, z, k, runtimeState, c);
            }
            let value = factor.func === 'c'
                ? c
                : evaluateBaseOnSheet(factor.func, arg, k, runtimeState, c);
            if (factor.power !== undefined && factor.power !== 1) {
                const logarithm = naturalLogOnSheet(value, Number.isInteger(factor.power) ? 0 : k, runtimeState);
                value = complexExp({ re: factor.power * logarithm.re, im: factor.power * logarithm.im });
            }
            if (factor.reciprocal) value = complexReciprocal(value);
            if (factor.log) value = evaluateBaseOnSheet('ln', value, k, runtimeState, c);
            if (factor.exp) value = complexExpAtBase(value, runtimeState.expBase);
            termValue = complexMul(termValue, value);
        }
        sum = complexAdd(sum, termValue);
    }
    return sum;
}

function evaluateBaseOnSheet(functionKey, z, k, runtimeState, c) {
    if (functionKey === 'ln') {
        const base = runtimeState.logBase || { re: Math.E, im: 0 };
        const logarithm = naturalLogOnSheet(z, k, runtimeState);
        return complexDivide(logarithm, { re: Math.log(Math.hypot(base.re, base.im)), im: Math.atan2(base.im, base.re) });
    }
    if (functionKey === 'power') {
        const exponent = runtimeState.fractionalPowerN ?? 0.5;
        const logarithm = naturalLogOnSheet(z, k, runtimeState);
        return complexExp({ re: exponent * logarithm.re, im: exponent * logarithm.im });
    }
    if (functionKey === 'asin') {
        const value = complexAsin(z);
        const sign = Math.abs(k) % 2 ? -1 : 1;
        return { re: k * Math.PI + sign * value.re, im: sign * value.im };
    }
    if (functionKey === 'atan') {
        const value = complexAtan(z);
        return { re: value.re + k * Math.PI, im: value.im };
    }
    if (functionKey === 'loggamma') {
        const value = complexLogGamma(z);
        return { re: value.re, im: value.im + k * TWO_PI };
    }
    if (functionKey === 'bessel') {
        const value = transformFunctions.bessel(z.re, z.im);
        const order = runtimeState.besselOrder || { re: 0, im: 0 };
        const multiplier = complexExp({
            re: -k * TWO_PI * order.im,
            im: k * TWO_PI * order.re
        });
        return {
            re: value.re * multiplier.re - value.im * multiplier.im,
            im: value.re * multiplier.im + value.im * multiplier.re
        };
    }
    if (functionKey === 'algebraic_chaining') {
        return evaluateAlgebraicOnSheet(z, k, runtimeState, c);
    }
    if (functionKey === 'exp') return complexExpAtBase(z, runtimeState.expBase);
    return transformFunctions[functionKey]?.(z.re, z.im) || { re: NaN, im: NaN };
}

function evaluateSurfaceBaseOnSheet(functionKey, z, k, runtimeState, c) {
    if (
        runtimeState.dynamicPlotting?.enabled &&
        runtimeState.dynamicPlotting.mode === 'aggregate' &&
        runtimeState.dynamicPlotting.reduction?.kind !== 'none'
    ) {
        return evaluateDynamicAggregateAt(z, (re, im) =>
            evaluateBaseOnSheet(functionKey, { re, im }, k, runtimeState, c));
    }
    return evaluateBaseOnSheet(functionKey, z, k, runtimeState, c);
}

export function evaluateOnSheet(functionKey, z, sheet, runtimeState) {
    const k = Number.isFinite(sheet) ? Math.round(sheet) : 0;
    const c = { re: z.re, im: z.im };
    if (!runtimeState.chainingEnabled) {
        return evaluateSurfaceBaseOnSheet(functionKey, z, k, runtimeState, c);
    }

    const count = normalizeDomainDynamicsChainCount(runtimeState.chainCount);
    let current = runtimeState.chainingMode === 'zero_seed' ? { re: 0, im: 0 } : z;
    for (let index = 0; index < count; index += 1) {
        current = evaluateSurfaceBaseOnSheet(functionKey, current, k, runtimeState, c);
        if (!Number.isFinite(current?.re) || !Number.isFinite(current?.im)) return { re: NaN, im: NaN };
    }
    return current;
}
