import { state, subscribeState } from '../store/state.js';
import { DEFAULT_TAYLOR_SERIES_CENTER, MAX_POLY_DEGREE, ZETA_REFLECTION_POINT_RE } from '../constants/numerical.js';
import { normalizeDomainDynamicsChainCount } from '../constants/domain-dynamics.js';
import {
    computeNativeTaylorCoefficients,
    evaluateNativeAlgebraic,
    evaluateNativePoints,
    nativeMapOptions
} from './complex-engine.js';

const INVALID = Object.freeze({ re: NaN, im: NaN });
const DEFAULT_FRACTIONAL_POWER = 0.5;
const CONSTANT_STENCIL = Object.freeze([
    { re: 0, im: 0 }, { re: 1, im: 0 }, { re: -1, im: 0.75 },
    { re: 0.5, im: -1 }, { re: 2.25, im: 0.25 }, { re: -2, im: -0.5 },
    { re: 1.75, im: 1.25 }, { re: -1.5, im: -1.25 }, { re: 0.25, im: 2 },
    { re: -0.75, im: -2 }, { re: 2, im: -1.75 }, { re: -2.25, im: 1.5 },
    { re: 0.33, im: -2.5 }, { re: 2.75, im: 2.25 }, { re: -2.5, im: -2.25 }
]);

const profileCache = new Map();
const chainedCache = new Map();
const taylorCache = { key: null, coefficients: null };
let cacheDirty = true;
let activeTransformProvider = null;

subscribeState(() => {
    cacheDirty = true;
    profileCache.clear();
    chainedCache.clear();
}, new Set([
    'currentFunction', 'mapPresentation', 'mobiusA', 'mobiusB', 'mobiusC', 'mobiusD',
    'polynomialN', 'polynomialCoeffs', 'fractionalPowerN', 'expBase', 'logBase', 'besselOrder',
    'branchCutType', 'branchCutAngle', 'zetaContinuationEnabled', 'chainingEnabled',
    'chainingMode', 'chainCount', 'algebraicChainingEnabled', 'algebraicChainingZExpr',
    'algebraicChainingTerms', 'taylorSeriesEnabled', 'taylorSeriesOrder',
    'taylorSeriesCenter', 'taylorSeriesConvergenceRadius', 'dynamicPlotting'
]));

function asPoint(re, im) {
    return re && typeof re === 'object'
        ? { re: Number(re.re), im: Number(re.im) }
        : { re: Number(re), im: Number(im) };
}

function finiteComplex(value) {
    return Number.isFinite(value?.re) && Number.isFinite(value?.im);
}

function evaluateMap(options, point) {
    try {
        const result = evaluateNativePoints(options, [point]);
        return result.valid[0] ? result.values[0] : { ...INVALID };
    } catch {
        return { ...INVALID };
    }
}

function nativeTransform(functionKey) {
    const transform = (re, im, context = null) => {
        const point = asPoint(re, im);
        if (!finiteComplex(point)) return { ...INVALID };
        const options = nativeMapOptions(state, {
            functionKey,
            chainingEnabled: false,
            chainCount: 1,
            derivativeMode: false
        });
        if (functionKey === 'algebraic_chaining' && context?.c) {
            try {
                const result = evaluateNativeAlgebraic(options, [point], [asPoint(context.c)]);
                return result.valid[0] ? result.values[0] : { ...INVALID };
            } catch {
                return { ...INVALID };
            }
        }
        return evaluateMap(options, point);
    };
    Object.defineProperty(transform, 'nativeFunctionKey', { value: functionKey });
    Object.defineProperty(transform, 'nativeMapOptions', {
        value: Object.freeze({ functionKey, chainingEnabled: false, chainCount: 1 })
    });
    return transform;
}

export const transformFunctions = Object.freeze(Object.fromEntries([
    'identity', 'cos', 'sin', 'tan', 'sec', 'exp', 'ln', 'reciprocal', 'sinh', 'cosh',
    'tanh', 'asin', 'atan', 'gamma', 'loggamma', 'bessel', 'power', 'mobius', 'zeta',
    'polynomial', 'poincare', 'algebraic_chaining'
].map(key => [key, nativeTransform(key)])));

export function evaluateAlgebraicTerm(term, re, im, context = null) {
    const point = asPoint(re, im);
    const parameter = asPoint(context?.c || point);
    try {
        const result = evaluateNativeAlgebraic(nativeMapOptions(state, {
            functionKey: 'algebraic_chaining',
            algebraicChainingEnabled: true,
            algebraicChainingTerms: [term],
            chainingEnabled: false,
            chainCount: 1,
            derivativeMode: false
        }), [point], [parameter]);
        return result.valid[0] ? result.values[0] : { ...INVALID };
    } catch {
        return { ...INVALID };
    }
}

export function evaluateAlgebraicChaining(re, im, context = null) {
    const point = asPoint(re, im);
    const parameter = asPoint(context?.c || point);
    try {
        const result = evaluateNativeAlgebraic(nativeMapOptions(state, {
            functionKey: 'algebraic_chaining',
            chainingEnabled: false,
            chainCount: 1,
            derivativeMode: false
        }), [point], [parameter]);
        return result.valid[0] ? result.values[0] : { ...INVALID };
    } catch {
        return { ...INVALID };
    }
}

export function mappedTransformNumberKey(value) {
    return Number.isFinite(value) ? value.toFixed(12) : `${value}`;
}

export function mappedTransformComplexKey(value) {
    return value
        ? `${mappedTransformNumberKey(value.re ?? value.real ?? 0)},${mappedTransformNumberKey(value.im ?? value.imag ?? 0)}`
        : 'none';
}

function boundedPolynomialDegree() {
    return Math.max(0, Math.min(MAX_POLY_DEGREE, Number.isFinite(state.polynomialN) ? state.polynomialN : 0));
}

function appendPolynomial(parts, prefix = '') {
    const degree = boundedPolynomialDegree();
    parts.push(`${prefix}n:${degree}`);
    for (let index = 0; index <= degree; index += 1) {
        parts.push(`${prefix}p${index}:${mappedTransformComplexKey(state.polynomialCoeffs?.[index])}`);
    }
}

function appendMobius(parts, prefix = '') {
    parts.push(
        `${prefix}a:${mappedTransformComplexKey(state.mobiusA)}`,
        `${prefix}b:${mappedTransformComplexKey(state.mobiusB)}`,
        `${prefix}c:${mappedTransformComplexKey(state.mobiusC)}`,
        `${prefix}d:${mappedTransformComplexKey(state.mobiusD)}`
    );
}

function serializeAlgebraicTerms(terms) {
    return (terms || []).map((term, termIndex) => [
        termIndex,
        mappedTransformComplexKey(term?.coeff),
        ...(term?.factors || []).map((factor, factorIndex) => [
            factorIndex, factor?.func ?? 'none', factor?.chainedFunc ?? 'none',
            mappedTransformNumberKey(factor?.power ?? 1), factor?.reciprocal ? 1 : 0,
            factor?.log ? 1 : 0, factor?.exp ? 1 : 0
        ].join(':'))
    ].join('|')).join('||');
}

function algebraicUses(terms, functionKey) {
    return (terms || []).some(term => (term?.factors || []).some(factor =>
        factor?.func === functionKey || factor?.chainedFunc === functionKey
    ));
}

export function buildMappedTransformProfileKey(functionKey = state.currentFunction) {
    const parts = [
        `f:${functionKey}`,
        `zetaC:${state.zetaContinuationEnabled ? 1 : 0}`,
        `frac:${mappedTransformNumberKey(state.fractionalPowerN ?? DEFAULT_FRACTIONAL_POWER)}`,
        `expBase:${mappedTransformComplexKey(state.expBase)}`,
        `logBase:${mappedTransformComplexKey(state.logBase)}`,
        `besselOrder:${mappedTransformComplexKey(state.besselOrder)}`,
        `branch:${state.branchCutType}:${mappedTransformNumberKey(state.branchCutAngle)}`
    ];
    if (functionKey === 'mobius') appendMobius(parts);
    else if (functionKey === 'polynomial') appendPolynomial(parts);
    else if (functionKey === 'algebraic_chaining') {
        const terms = state.algebraicChainingTerms || [];
        parts.push(`algOn:${state.algebraicChainingEnabled ? 1 : 0}`);
        parts.push(`alg:${serializeAlgebraicTerms(terms)}`);
        parts.push(`algZ:${state.algebraicChainingZExpr}`);
        if (algebraicUses(terms, 'mobius')) appendMobius(parts, 'algM');
        if (algebraicUses(terms, 'polynomial')) appendPolynomial(parts, 'algP');
    }
    return parts.join('|');
}

function mapMetadata(transform, functionKey) {
    return {
        functionKey,
        ...(transform?.nativeMapOptions || {}),
        chainingEnabled: transform?.nativeMapOptions?.chainingEnabled ?? false,
        chainCount: transform?.nativeMapOptions?.chainCount ?? 1
    };
}

function constantCluster(values) {
    const samples = values.filter(finiteComplex);
    if (samples.length < 9) return null;
    let best = null;
    let bestCount = 0;
    for (const candidate of samples) {
        const epsilon = 1e-5 + 1e-7 * Math.max(1, Math.hypot(candidate.re, candidate.im));
        let count = 0;
        let sumRe = 0;
        let sumIm = 0;
        for (const sample of samples) {
            if (Math.hypot(sample.re - candidate.re, sample.im - candidate.im) <= epsilon) {
                count += 1;
                sumRe += sample.re;
                sumIm += sample.im;
            }
        }
        if (count > bestCount) {
            bestCount = count;
            best = { re: sumRe / count, im: sumIm / count };
        }
    }
    return best && bestCount / samples.length >= 0.9 ? best : null;
}

export function getMappedTransformProfile(functionKey = state.currentFunction, transform = null) {
    if (cacheDirty) {
        profileCache.clear();
        chainedCache.clear();
        cacheDirty = false;
    }
    const resolved = transform || transformFunctions[functionKey];
    if (typeof resolved !== 'function') {
        return { functionKey, transformFunc: null, isConstant: false, constantValue: null };
    }
    const cacheable = resolved === transformFunctions[functionKey];
    const key = cacheable ? buildMappedTransformProfileKey(functionKey) : null;
    if (key && profileCache.has(key)) return profileCache.get(key);
    let constantValue = null;
    const metadata = mapMetadata(resolved, functionKey);
    try {
        const result = evaluateNativePoints(nativeMapOptions(state, metadata), CONSTANT_STENCIL);
        constantValue = constantCluster(result.values.filter((_value, index) => result.valid[index]));
    } catch {
        constantValue = null;
    }
    const profile = {
        functionKey,
        transformFunc: resolved,
        nativeMapOptions: metadata,
        renderCacheOwner: resolved,
        isConstant: !!constantValue,
        constantValue
    };
    if (key) profileCache.set(key, profile);
    return profile;
}

export function evaluateMappedTransform(profileOrTransform, re, im, functionKey = state.currentFunction, context = null) {
    const point = asPoint(re, im);
    if (!finiteComplex(point) || (functionKey === 'zeta' && !state.zetaContinuationEnabled && point.re <= ZETA_REFLECTION_POINT_RE)) {
        return null;
    }
    if (profileOrTransform?.isConstant && !context) return { ...profileOrTransform.constantValue };
    const transform = typeof profileOrTransform === 'function'
        ? profileOrTransform
        : profileOrTransform?.transformFunc;
    if (typeof transform !== 'function') return null;
    const value = transform(point.re, point.im, context);
    return finiteComplex(value) ? value : null;
}

export function setActiveTransformProvider(provider) {
    activeTransformProvider = typeof provider === 'function' ? provider : null;
    chainedCache.clear();
}

export function getTaylorContourRadius(center) {
    const configured = Number.isFinite(state.taylorSeriesConvergenceRadius)
        ? state.taylorSeriesConvergenceRadius
        : null;
    if (configured !== null) return configured <= 1e-9 ? 0 : Math.max(1e-3, Math.min(1.25, configured * 0.45));
    const point = asPoint(center);
    return Math.max(0.25, Math.min(1.25, Math.max(1, Math.abs(point.re), Math.abs(point.im)) * 0.35));
}

export function toTaylorCacheNumber(value) {
    return Number.isFinite(value) ? value.toFixed(9) : `${value}`;
}

function appendTaylorComplex(parts, prefix, value) {
    const point = value || DEFAULT_TAYLOR_SERIES_CENTER;
    parts.push(`${prefix}r:${toTaylorCacheNumber(point.re ?? point.real ?? 0)}`);
    parts.push(`${prefix}i:${toTaylorCacheNumber(point.im ?? point.imag ?? 0)}`);
}

export function buildTaylorSeriesCoefficientCacheKey(functionKey, center, order) {
    const point = asPoint(center);
    const parts = [
        `f:${functionKey}`, `order:${order}`, `z0r:${toTaylorCacheNumber(point.re)}`,
        `z0i:${toTaylorCacheNumber(point.im)}`, `radius:${toTaylorCacheNumber(getTaylorContourRadius(point))}`,
        buildMappedTransformProfileKey(functionKey)
    ];
    if (functionKey === 'algebraic_chaining') appendTaylorComplex(parts, 'center', point);
    return parts.join('|');
}

export function computeTaylorSeriesCoefficients(functionKey, center, order) {
    if (!transformFunctions[functionKey]) return null;
    const point = asPoint(center);
    const key = buildTaylorSeriesCoefficientCacheKey(functionKey, point, order);
    if (taylorCache.key === key) return taylorCache.coefficients;
    const radius = getTaylorContourRadius(point);
    const coefficients = radius > 0 ? computeNativeTaylorCoefficients(nativeMapOptions(state, {
        functionKey,
        chainingEnabled: false,
        chainCount: 1,
        derivativeMode: false
    }), point, radius, order) : null;
    taylorCache.key = key;
    taylorCache.coefficients = coefficients;
    return coefficients;
}

export function createTaylorApproximationTransform(functionKey, center, order) {
    const point = asPoint(center);
    const coefficients = computeTaylorSeriesCoefficients(functionKey, point, order);
    const metadata = coefficients ? {
        functionKey,
        chainingEnabled: false,
        chainCount: 1,
        derivativeMode: false,
        taylor: { center: point, radius: state.taylorSeriesConvergenceRadius, coefficients }
    } : null;
    const transform = (re, im) => metadata
        ? evaluateMap(nativeMapOptions(state, metadata), asPoint(re, im))
        : { ...INVALID };
    if (metadata) Object.defineProperty(transform, 'nativeMapOptions', { value: metadata });
    Object.defineProperty(transform, 'nativeFunctionKey', { value: functionKey });
    return transform;
}

export function getEffectiveBaseTransformFunction(functionKey = state.currentFunction) {
    let transform = transformFunctions[functionKey] || transformFunctions.identity;
    if (state.taylorSeriesEnabled && (!state.riemannSphereViewEnabled || state.splitViewEnabled)) {
        transform = createTaylorApproximationTransform(functionKey, state.taylorSeriesCenter, state.taylorSeriesOrder);
    }
    if (activeTransformProvider) {
        const provided = activeTransformProvider({ funcKey: functionKey, baseFunc: transform, state });
        if (typeof provided === 'function') transform = provided;
    }
    return transform;
}

function stageTransform(functionKey, stage) {
    const base = getEffectiveBaseTransformFunction(functionKey);
    if (!state.chainingEnabled) return base;
    const metadata = {
        ...base.nativeMapOptions,
        functionKey,
        chainingEnabled: true,
        chainCount: Math.max(1, stage + 1),
        derivativeMode: false,
        stage
    };
    const transform = (re, im) => evaluateMap(nativeMapOptions(state, metadata), asPoint(re, im));
    Object.defineProperty(transform, 'nativeMapOptions', { value: metadata });
    Object.defineProperty(transform, 'nativeFunctionKey', { value: functionKey });
    return transform;
}

export function getChainedStageTransformFunction(functionKey = state.currentFunction, stageIndex = 0) {
    const stage = normalizeDomainDynamicsChainCount(Math.floor(Number(stageIndex)) + 1) - 1;
    return stageTransform(functionKey, stage);
}

export function getChainedTransformFunction(functionKey = state.currentFunction) {
    const chainCount = normalizeDomainDynamicsChainCount(state.chainCount);
    const key = `${functionKey}|${buildMappedTransformProfileKey(functionKey)}|${state.chainingEnabled ? 1 : 0}|${state.chainingMode}|${chainCount}|${state.taylorSeriesEnabled ? 1 : 0}|${state.taylorSeriesConvergenceRadius}`;
    if (chainedCache.has(key)) return chainedCache.get(key);
    const transform = state.chainingEnabled
        ? stageTransform(functionKey, chainCount - 1)
        : getEffectiveBaseTransformFunction(functionKey);
    chainedCache.set(key, transform);
    return transform;
}

export function evaluateDomainColoringMappedTransform(_profile, re, im, functionKey = state.currentFunction) {
    const count = normalizeDomainDynamicsChainCount(state.chainCount);
    const options = nativeMapOptions(state, {
        functionKey,
        chainingEnabled: state.chainingEnabled,
        chainCount: state.chainingEnabled ? count : 1
    });
    return evaluateMap(options, asPoint(re, im));
}

const ENTIRE_FUNCTIONS = new Set(['exp', 'sin', 'cos', 'polynomial']);

export function updateTaylorSeriesCenterAndRadius() {
    state.taylorSeriesCenter = state.taylorSeriesCustomCenterEnabled
        ? { re: state.taylorSeriesCustomCenter.re, im: state.taylorSeriesCustomCenter.im }
        : { ...DEFAULT_TAYLOR_SERIES_CENTER };
    let nearestDistanceSq = Infinity;
    for (const pole of state.poles || []) {
        if (!finiteComplex(pole)) continue;
        const dx = pole.re - state.taylorSeriesCenter.re;
        const dy = pole.im - state.taylorSeriesCenter.im;
        nearestDistanceSq = Math.min(nearestDistanceSq, dx * dx + dy * dy);
    }
    state.taylorSeriesConvergenceRadius = Number.isFinite(nearestDistanceSq)
        ? (nearestDistanceSq < 1e-12 ? 0 : Math.sqrt(nearestDistanceSq))
        : (ENTIRE_FUNCTIONS.has(state.currentFunction) ? Infinity : 1000);
    if (state.currentFunction === 'ln' && state.taylorSeriesCenter.re === 0 && state.taylorSeriesCenter.im === 0) {
        state.taylorSeriesConvergenceRadius = 0;
    }
}
