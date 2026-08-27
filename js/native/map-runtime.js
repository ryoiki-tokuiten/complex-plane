import { state, subscribeState } from '../store/state.js';
import { DEFAULT_TAYLOR_SERIES_CENTER, MAX_POLY_DEGREE } from '../constants/numerical.js';
import { normalizeDomainDynamicsChainCount } from '../constants/domain-dynamics.js';
import {
    computeNativeTaylorCoefficients,
    evaluateNativeAlgebraic,
    evaluateNativePoints,
    nativeMapOptions
} from './complex-engine.js';
import { requireFiniteComplex, finiteComplex } from '../utils/numeric-contracts.js';

const INVALID = Object.freeze({ re: NaN, im: NaN });
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
    'chainingMode', 'chainSeed', 'chainCount', 'algebraicChainingEnabled', 'algebraicChainingZExpr',
    'algebraicChainingTerms', 'taylorSeriesEnabled', 'taylorSeriesOrder',
    'taylorSeriesCenter', 'taylorSeriesConvergenceRadius', 'dynamicPlotting'
]));

function asPoint(re, im) {
    return re && typeof re === 'object'
        ? { re: Number(re.re), im: Number(re.im) }
        : { re: Number(re), im: Number(im) };
}

function evaluateMap(options, point) {
    const result = evaluateNativePoints(options, [point]);
    return result.valid[0] ? result.values[0] : { ...INVALID };
}

function nativeTransform(functionKey) {
    const transform = (re, im, context = null) => {
        const point = asPoint(re, im);
        if (!finiteComplex(point)) return { ...INVALID };
        const options = nativeMapOptions(state, {
            functionKey,
            chainingEnabled: false,
            chainCount: 1,
            derivativeOrder: 0
        });
        if (functionKey === 'algebraic_chaining' && context?.c) {
            const result = evaluateNativeAlgebraic(options, [point], [asPoint(context.c)]);
            return result.valid[0] ? result.values[0] : { ...INVALID };
        }
        return evaluateMap(options, point);
    };
    Object.defineProperty(transform, 'nativeMapOptions', {
        value: Object.freeze({ functionKey, chainingEnabled: false, chainCount: 1, derivativeOrder: 0 })
    });
    return transform;
}

export const transformFunctions = Object.freeze(Object.fromEntries([
    'identity', 'sin', 'cos', 'tan', 'sec', 'exp', 'ln', 'sinh',
    'tanh', 'asin', 'atan', 'gamma', 'loggamma', 'bessel', 'power', 'mobius', 'zeta',
    'polynomial', 'algebraic_chaining'
].map(key => [key, nativeTransform(key)])));

export function mappedTransformNumberKey(value) {
    if (!Number.isFinite(value)) throw new Error(`Native map profile requires a finite number: ${value}.`);
    return value.toFixed(12);
}

export function mappedTransformComplexKey(value) {
    if (!finiteComplex(value)) throw new Error('Native map profile requires a finite complex value.');
    return `${mappedTransformNumberKey(value.re)},${mappedTransformNumberKey(value.im)}`;
}

function boundedPolynomialDegree() {
    if (!Number.isInteger(state.polynomialN) || state.polynomialN < 0 || state.polynomialN > MAX_POLY_DEGREE) {
        throw new Error(`Native polynomial degree must be an integer from 0 to ${MAX_POLY_DEGREE}.`);
    }
    return state.polynomialN;
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
    if (!Array.isArray(terms)) throw new Error('Native algebraic terms must be an array.');
    return terms.map((term, termIndex) => {
        if (!Array.isArray(term?.factors)) throw new Error(`Native algebraic term ${termIndex} requires factors.`);
        return [
            termIndex,
            mappedTransformComplexKey(term.coeff),
            ...term.factors.map((factor, factorIndex) => {
                if (!factor || typeof factor.func !== 'string' || typeof factor.chainedFunc !== 'string') {
                    throw new Error(`Native algebraic factor ${termIndex}:${factorIndex} is malformed.`);
                }
                return [
                    factorIndex, factor.func, factor.chainedFunc,
                    mappedTransformNumberKey(factor.power), factor.reciprocal ? 1 : 0,
                    factor.log ? 1 : 0, factor.exp ? 1 : 0
                ].join(':');
            })
        ].join('|');
    }).join('||');
}

function algebraicUses(terms, functionKey) {
    if (!Array.isArray(terms)) throw new Error('Native algebraic terms must be an array.');
    return terms.some((term, termIndex) => {
        if (!Array.isArray(term?.factors)) throw new Error(`Native algebraic term ${termIndex} requires factors.`);
        return term.factors.some(factor =>
            factor?.func === functionKey || factor?.chainedFunc === functionKey
        );
    });
}

export function buildMappedTransformProfileKey(functionKey = state.currentFunction) {
    const parts = [
        `f:${functionKey}`,
        `zetaC:${state.zetaContinuationEnabled ? 1 : 0}`,
        `frac:${mappedTransformNumberKey(state.fractionalPowerN)}`,
        `expBase:${mappedTransformComplexKey(state.expBase)}`,
        `logBase:${mappedTransformComplexKey(state.logBase)}`,
        `besselOrder:${mappedTransformComplexKey(state.besselOrder)}`,
        `branch:${state.branchCutType}:${mappedTransformNumberKey(state.branchCutAngle)}`
    ];
    if (functionKey === 'mobius') appendMobius(parts);
    else if (functionKey === 'polynomial') appendPolynomial(parts);
    else if (functionKey === 'algebraic_chaining') {
        const terms = state.algebraicChainingTerms;
        parts.push(`algOn:${state.algebraicChainingEnabled ? 1 : 0}`);
        parts.push(`alg:${serializeAlgebraicTerms(terms)}`);
        parts.push(`algZ:${state.algebraicChainingZExpr}`);
        if (algebraicUses(terms, 'mobius')) appendMobius(parts, 'algM');
        if (algebraicUses(terms, 'polynomial')) appendPolynomial(parts, 'algP');
    }
    return parts.join('|');
}

function mapMetadata(transform, functionKey) {
    if (!transform?.nativeMapOptions) {
        throw new Error(`Transform ${functionKey} is not owned by the native engine.`);
    }
    return {
        ...transform.nativeMapOptions,
        functionKey
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
    const resolved = transform === null ? transformFunctions[functionKey] : transform;
    if (typeof resolved !== 'function') {
        throw new Error(`Unknown native transform profile: ${functionKey}.`);
    }
    const cacheable = resolved === transformFunctions[functionKey];
    const key = cacheable ? buildMappedTransformProfileKey(functionKey) : null;
    if (key && profileCache.has(key)) return profileCache.get(key);
    let constantValue = null;
    const metadata = mapMetadata(resolved, functionKey);
    const result = evaluateNativePoints(nativeMapOptions(state, metadata), CONSTANT_STENCIL);
    constantValue = constantCluster(result.values.filter((_value, index) => result.valid[index]));
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

export function setActiveTransformProvider(provider) {
    if (typeof provider !== 'function') throw new Error('Active transform provider must be a function.');
    activeTransformProvider = provider;
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
    const point = requireFiniteComplex(value, `Taylor cache ${prefix}`);
    parts.push(`${prefix}r:${toTaylorCacheNumber(point.re)}`);
    parts.push(`${prefix}i:${toTaylorCacheNumber(point.im)}`);
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
    if (!transformFunctions[functionKey]) throw new Error(`Unknown native Taylor transform: ${functionKey}.`);
    const point = asPoint(center);
    const key = buildTaylorSeriesCoefficientCacheKey(functionKey, point, order);
    if (taylorCache.key === key) return taylorCache.coefficients;
    const radius = getTaylorContourRadius(point);
    if (!(radius > 0)) throw new Error('Taylor approximation requires a positive contour radius.');
    const coefficients = computeNativeTaylorCoefficients(nativeMapOptions(state, {
        functionKey,
        chainingEnabled: false,
        chainCount: 1,
        derivativeOrder: 0
    }), point, radius, order);
    taylorCache.key = key;
    taylorCache.coefficients = coefficients;
    return coefficients;
}

export function createTaylorApproximationTransform(functionKey, center, order) {
    const point = asPoint(center);
    const coefficients = computeTaylorSeriesCoefficients(functionKey, point, order);
    const metadata = {
        functionKey,
        chainingEnabled: false,
        chainCount: 1,
        derivativeOrder: 0,
        taylor: { center: point, radius: state.taylorSeriesConvergenceRadius, coefficients }
    };
    const transform = (re, im) => evaluateMap(nativeMapOptions(state, metadata), asPoint(re, im));
    Object.defineProperty(transform, 'nativeMapOptions', { value: metadata });
    return transform;
}

export function getEffectiveBaseTransformFunction(functionKey = state.currentFunction) {
    let transform = transformFunctions[functionKey];
    if (!transform) throw new Error(`Unknown native transform: ${functionKey}.`);
    if (state.taylorSeriesEnabled) {
        transform = createTaylorApproximationTransform(functionKey, state.taylorSeriesCenter, state.taylorSeriesOrder);
    }
    if (activeTransformProvider) {
        const provided = activeTransformProvider({ funcKey: functionKey, baseFunc: transform, state });
        if (typeof provided !== 'function' || !provided.nativeMapOptions) {
            throw new Error('Active transform providers must return a native transform.');
        }
        transform = provided;
    }
    return transform;
}

function stageTransform(functionKey, stage) {
    if (!Number.isInteger(stage) || stage < 0 || stage >= 1024) {
        throw new Error('Native map stage must be an integer from zero through 1023.');
    }
    const base = getEffectiveBaseTransformFunction(functionKey);
    if (!state.chainingEnabled) {
        if (stage !== 0) throw new Error('Unchained native maps expose only stage zero.');
        return base;
    }
    const metadata = {
        ...base.nativeMapOptions,
        functionKey,
        chainingEnabled: true,
        chainCount: stage + 1,
        derivativeOrder: 0,
        stage
    };
    const transform = (re, im) => evaluateMap(nativeMapOptions(state, metadata), asPoint(re, im));
    Object.defineProperty(transform, 'nativeMapOptions', { value: metadata });
    return transform;
}

export function getChainedStageTransformFunction(functionKey = state.currentFunction, stageIndex = 0) {
    if (!Number.isInteger(stageIndex) || stageIndex < 0) {
        throw new Error('Native map stage must be a non-negative integer.');
    }
    const stage = normalizeDomainDynamicsChainCount(stageIndex + 1) - 1;
    return stageTransform(functionKey, stage);
}

export function resolveNativeMapOptions(functionKey = state.currentFunction, stageIndex = 0, derivativeOrder = 0) {
    const transform = getChainedStageTransformFunction(functionKey, stageIndex);
    if (!transform?.nativeMapOptions) {
        throw new Error(`Active transform ${functionKey} is not owned by the native engine.`);
    }
    return nativeMapOptions(state, {
        ...transform.nativeMapOptions,
        functionKey,
        stage: stageIndex,
        derivativeOrder
    });
}

export function nativeOptionsForActiveMap(map) {
    const metadata = map?.evaluate?.nativeMapOptions;
    if (!metadata || !Number.isInteger(map.stage) ||
        (map.presentation !== 'function' && map.presentation !== 'derivative')) {
        throw new Error('Rendering requires a resolved native active map.');
    }
    return nativeMapOptions(state, {
        ...metadata,
        stage: map.stage,
        derivativeOrder: map.presentation === 'derivative' ? 1 : 0
    });
}

export function getChainedTransformFunction(functionKey = state.currentFunction) {
    const chainCount = normalizeDomainDynamicsChainCount(state.chainCount);
    const key = `${functionKey}|${buildMappedTransformProfileKey(functionKey)}|${state.chainingEnabled ? 1 : 0}|${state.chainingMode}|${state.chainSeed?.re}|${state.chainSeed?.im}|${chainCount}|${state.taylorSeriesEnabled ? 1 : 0}|${state.taylorSeriesConvergenceRadius}`;
    if (chainedCache.has(key)) return chainedCache.get(key);
    const transform = state.chainingEnabled
        ? stageTransform(functionKey, chainCount - 1)
        : getEffectiveBaseTransformFunction(functionKey);
    chainedCache.set(key, transform);
    return transform;
}

const ENTIRE_FUNCTIONS = new Set(['exp', 'sin', 'cos', 'polynomial']);

export function updateTaylorSeriesCenterAndRadius() {
    const center = state.taylorSeriesCustomCenter
        ? { re: state.taylorSeriesCustomCenter.re, im: state.taylorSeriesCustomCenter.im }
        : { ...DEFAULT_TAYLOR_SERIES_CENTER };
    if (state.taylorSeriesCenter.re !== center.re || state.taylorSeriesCenter.im !== center.im) {
        state.taylorSeriesCenter = center;
    }
    let nearestDistanceSq = Infinity;
    if (!Array.isArray(state.poles)) throw new Error('Taylor analysis requires a poles array.');
    for (const pole of state.poles) {
        if (!finiteComplex(pole)) continue;
        const dx = pole.re - center.re;
        const dy = pole.im - center.im;
        nearestDistanceSq = Math.min(nearestDistanceSq, dx * dx + dy * dy);
    }
    let radius = Number.isFinite(nearestDistanceSq)
        ? (nearestDistanceSq < 1e-12 ? 0 : Math.sqrt(nearestDistanceSq))
        : (ENTIRE_FUNCTIONS.has(state.currentFunction) ? Infinity : 1000);
    if (state.currentFunction === 'ln' && center.re === 0 && center.im === 0) {
        radius = 0;
    }
    if (state.taylorSeriesConvergenceRadius !== radius) state.taylorSeriesConvergenceRadius = radius;
}
