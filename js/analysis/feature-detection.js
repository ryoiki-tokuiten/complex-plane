import { state, zPlaneParams } from '../store/state.js';
import { resolveActiveMap } from '../math/active-map.js';
import {
    estimateNativeResidue,
    evaluateNativePoints,
    findNativePolynomialRoots,
    findNativePreimages,
    nativeMapOptions
} from '../native/complex-engine.js';
import { getAlgebraicStructureSignatureShared } from '../rendering/webgl-shared.js';
import {
    CRITICAL_POINT_FIND_GRID_SIZE,
    ZP_CP_CHECK_DISTANCE_FACTOR,
    ZERO_POLE_GRID_SIZE,
    ZETA_POLE
} from '../constants/numerical.js';

function cacheKey() {
    return [
        state.currentFunction, state.mapPresentation, state.chainingEnabled, state.chainCount,
        getAlgebraicStructureSignatureShared(state.algebraicChainingTerms),
        state.algebraicChainingZExpr || 'z', JSON.stringify(state.polynomialCoeffs),
        JSON.stringify([state.mobiusA, state.mobiusB, state.mobiusC, state.mobiusD]),
        state.fractionalPowerN, state.zetaContinuationEnabled,
        zPlaneParams.currentVisXRange?.join(','), zPlaneParams.currentVisYRange?.join(',')
    ].join('|');
}

function inRange(point, xRange, yRange, padding) {
    return point.re >= xRange[0] - padding && point.re <= xRange[1] + padding &&
        point.im >= yRange[0] - padding && point.im <= yRange[1] + padding;
}

function unique(points, distance) {
    const result = [];
    for (const point of points) {
        if (!result.some(other => Math.hypot(other.re - point.re, other.im - point.im) <= distance)) {
            result.push(point);
        }
    }
    return result;
}

function activeNativeMap(derivativeOrder = null) {
    const active = resolveActiveMap();
    return nativeMapOptions(state, {
        stage: active.stage,
        derivativeOrder: derivativeOrder ?? (active.presentation === 'derivative' ? 1 : 0)
    });
}

let criticalKey = null;

export function findCriticalPoints() {
    if (!state.showCriticalPoints || (state.riemannSphereViewEnabled && !state.splitViewEnabled) ||
        zPlaneParams.preciseViewport) {
        state.criticalPoints = [];
        state.criticalValues = [];
        criticalKey = null;
        return;
    }
    const key = cacheKey();
    if (key === criticalKey) return;
    criticalKey = key;
    const active = resolveActiveMap();
    const xRange = zPlaneParams.currentVisXRange;
    const yRange = zPlaneParams.currentVisYRange;
    const merge = (xRange[1] - xRange[0]) / CRITICAL_POINT_FIND_GRID_SIZE * ZP_CP_CHECK_DISTANCE_FACTOR;
    let points = [];
    if (active.presentation !== 'derivative' && ['exp', 'tan', 'ln'].includes(state.currentFunction)) {
        points = [];
    } else if (active.presentation !== 'derivative' && ['cos', 'sec'].includes(state.currentFunction)) {
        for (let n = Math.ceil(xRange[0] / Math.PI) - 1;
            n <= Math.floor(xRange[1] / Math.PI) + 1; n += 1) {
            points.push({ re: n * Math.PI, im: 0 });
        }
    } else {
        points = findNativePreimages({
            map: activeNativeMap(active.presentation === 'derivative' ? 2 : 1),
            target: { re: 0, im: 0 }, xRange, yRange,
            density: Math.min(32, CRITICAL_POINT_FIND_GRID_SIZE), maxIterations: 30
        });
    }
    state.criticalPoints = unique(points.filter(point => inRange(point, xRange, yRange, merge)), merge);
    const values = evaluateNativePoints(activeNativeMap(), state.criticalPoints);
    state.criticalValues = values.values.map((value, index) => values.valid[index] ? value : { re: NaN, im: NaN });
}

let zerosPolesKey = null;

function decoratePole(map, point) {
    const residue = estimateNativeResidue(map, point, 1e-5, 160);
    return { ...point, type: 'pole', order: 'unknown', residue };
}

export function findZerosAndPoles() {
    if (!state.showZerosPoles || (state.riemannSphereViewEnabled && !state.splitViewEnabled) ||
        zPlaneParams.preciseViewport) {
        state.zeros = [];
        state.poles = [];
        zerosPolesKey = null;
        return;
    }
    const key = cacheKey();
    if (key === zerosPolesKey) return;
    zerosPolesKey = key;
    const xRange = zPlaneParams.currentVisXRange;
    const yRange = zPlaneParams.currentVisYRange;
    const merge = (xRange[1] - xRange[0]) / ZERO_POLE_GRID_SIZE * ZP_CP_CHECK_DISTANCE_FACTOR;
    const map = activeNativeMap();
    const single = !state.chainingEnabled || state.chainCount <= 1;
    let zeros = [];
    let poles = [];

    if (single && state.currentFunction === 'exp') {
        zeros = [];
    } else if (single && state.currentFunction === 'cos') {
        for (let n = Math.ceil(xRange[0] / Math.PI - 0.5) - 1;
            n <= Math.floor(xRange[1] / Math.PI - 0.5) + 1; n += 1) {
            zeros.push({ re: (n + 0.5) * Math.PI, im: 0 });
        }
    } else if (single && state.currentFunction === 'tan') {
        for (let n = Math.ceil(xRange[0] / Math.PI) - 1;
            n <= Math.floor(xRange[1] / Math.PI) + 1; n += 1) {
            zeros.push({ re: n * Math.PI, im: 0 });
        }
    } else if (single && state.currentFunction === 'polynomial') {
        zeros = findNativePolynomialRoots([...state.polynomialCoeffs].reverse());
    } else {
        zeros = findNativePreimages({
            map, target: { re: 0, im: 0 }, xRange, yRange,
            density: Math.min(32, ZERO_POLE_GRID_SIZE), maxIterations: 30
        });
    }

    if (single && ['exp', 'cos', 'polynomial'].includes(state.currentFunction)) {
        poles = [];
    } else if (single && ['tan', 'sec'].includes(state.currentFunction)) {
        for (let n = Math.ceil(xRange[0] / Math.PI - 0.5) - 1;
            n <= Math.floor(xRange[1] / Math.PI - 0.5) + 1; n += 1) {
            poles.push({ re: (n + 0.5) * Math.PI, im: 0 });
        }
    } else if (single && state.currentFunction === 'ln') {
        poles = [{ re: 0, im: 0 }];
    } else {
        poles = findNativePreimages({
            map, target: { re: 0, im: 0 }, xRange, yRange,
            density: Math.min(32, ZERO_POLE_GRID_SIZE), maxIterations: 30, inverseOutput: true
        });
    }
    if (state.currentFunction === 'zeta' && inRange(ZETA_POLE, xRange, yRange, 0)) poles.push({ ...ZETA_POLE });
    if (state.currentFunction === 'zeta' && state.zetaContinuationEnabled) {
        for (let real = -2; real >= Math.floor(xRange[0]); real -= 2) {
            if (real <= xRange[1]) zeros.push({ re: real, im: 0 });
        }
    }
    state.zeros = unique(zeros.filter(point => inRange(point, xRange, yRange, merge)), merge)
        .map(point => ({ ...point, type: 'zero', order: null, residue: null }));
    state.poles = unique(poles.filter(point => inRange(point, xRange, yRange, merge)), merge)
        .map(point => decoratePole(map, point));
}
