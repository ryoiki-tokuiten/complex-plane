import { state, zPlaneParams } from '../store/state.js';
import { resolveActiveMap } from '../math/active-map.js';
import {
    estimateNativeResidue,
    evaluateNativePoints,
    findNativePolynomialRoots,
    findNativePreimages
} from '../native/complex-engine.js';
import { nativeOptionsForActiveMap, resolveNativeMapOptions } from '../native/map-runtime.js';
import {
    CRITICAL_POINT_FIND_GRID_SIZE,
    TWO_PI,
    ZERO_POLE_GRID_SIZE,
    ZETA_POLE
} from '../constants/numerical.js';
import { requireVisibleViewport } from '../utils/viewport.js';

function cacheKey(active) {
    requireVisibleViewport(zPlaneParams, 'Feature-detection viewport');
    return [
        active.signature,
        zPlaneParams.currentVisXRange.join(','), zPlaneParams.currentVisYRange.join(',')
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

function activeNativeMap(active, derivativeOrder = null) {
    return derivativeOrder === null
        ? nativeOptionsForActiveMap(active)
        : resolveNativeMapOptions(state.currentFunction, active.stage, derivativeOrder);
}

let criticalKey = null;

export function findCriticalPoints() {
    if (!state.showCriticalPoints || (state.manifold3dViewEnabled && state.manifoldTransformationEnabled) ||
        zPlaneParams.preciseViewport) {
        state.criticalPoints = [];
        state.criticalValues = [];
        criticalKey = null;
        return;
    }
    const active = resolveActiveMap();
    const key = cacheKey(active);
    if (key === criticalKey) return;
    const xRange = zPlaneParams.currentVisXRange;
    const yRange = zPlaneParams.currentVisYRange;
    const map = activeNativeMap(active);
    const simple = active.presentation === 'function' && !map.chainingEnabled && !map.taylor && !map.dynamicAggregate;
    const span = Math.max(xRange[1] - xRange[0], yRange[1] - yRange[0]);
    const merge = Math.max(1e-8, span * 1e-7);
    let points = [];
    if (simple && ['exp', 'tan', 'ln'].includes(state.currentFunction)) {
        points = [];
    } else if (simple && ['sin', 'cos', 'sec'].includes(state.currentFunction)) {
        const offset = state.currentFunction === 'sin' ? 0.5 : 0;
        for (let n = Math.ceil(xRange[0] / Math.PI - offset) - 1;
            n <= Math.floor(xRange[1] / Math.PI - offset) + 1; n += 1) {
            points.push({ re: (n + offset) * Math.PI, im: 0 });
        }
    } else {
        const derivativeMap = activeNativeMap(active, active.presentation === 'derivative' ? 2 : 1);
        points = findNativePreimages({
            map: derivativeMap,
            target: { re: 0, im: 0 }, xRange, yRange,
            density: Math.min(32, CRITICAL_POINT_FIND_GRID_SIZE), maxIterations: 30
        });
        points = certifyCandidates(derivativeMap, points, points, 1, span);
    }
    state.criticalPoints = unique(points.filter(point => inRange(point, xRange, yRange, merge)), merge)
        .map(({ analysisRadius: _, ...point }) => point);
    const values = evaluateNativePoints(map, state.criticalPoints);
    state.criticalValues = values.values.map((value, index) => values.valid[index] ? value : { re: NaN, im: NaN });
    criticalKey = key;
}

let zerosPolesKey = null;

function decoratePole(map, point) {
    const residue = point.residue ?? estimateNativeResidue(map, point, point.analysisRadius, 160);
    const { analysisRadius: _, ...pole } = point;
    return { ...pole, type: 'pole', order: point.order ?? 1, residue };
}

function lattice(range, offset, period, imaginary = false) {
    const points = [];
    for (let n = Math.ceil((range[0] - offset) / period); n <= Math.floor((range[1] - offset) / period); n++) {
        points.push(imaginary ? { re: 0, im: offset + n * period, order: 1 }
            : { re: offset + n * period, im: 0, order: 1 });
    }
    return points;
}

const magnitudeSquared = value => value.re * value.re + value.im * value.im;
const multiply = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const subtract = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });

function divide(a, b) {
    const denominator = magnitudeSquared(b);
    if (denominator === 0) throw new Error('Cannot divide by a zero complex coefficient.');
    return {
        re: (a.re * b.re + a.im * b.im) / denominator,
        im: (a.im * b.re - a.re * b.im) / denominator
    };
}

function mobiusFeatures() {
    const { mobiusA: a, mobiusB: b, mobiusC: c, mobiusD: d } = state;
    const determinant = subtract(multiply(a, d), multiply(b, c));
    if (magnitudeSquared(c) === 0 && magnitudeSquared(d) === 0) {
        throw new Error('Zero/pole analysis is undefined for a Möbius map with zero denominator.');
    }
    if (magnitudeSquared(determinant) === 0) {
        if (magnitudeSquared(a) === 0 && magnitudeSquared(b) === 0) {
            throw new Error('The zero Möbius map has no isolated zeros.');
        }
        return { zeros: [], poles: [] };
    }
    return {
        zeros: magnitudeSquared(a) === 0 ? [] : [{ ...divide({ re: -b.re, im: -b.im }, a), order: 1 }],
        poles: magnitudeSquared(c) === 0 ? [] : [{
            ...divide({ re: -d.re, im: -d.im }, c), order: 1,
            residue: divide({ re: -determinant.re, im: -determinant.im }, multiply(c, c))
        }]
    };
}

function simpleFeaturePlan(xRange, yRange) {
    const real = (offset = 0) => lattice(xRange, offset, Math.PI);
    const imaginary = (offset = 0) => lattice(yRange, offset, Math.PI, true);
    switch (state.currentFunction) {
        case 'identity': return { zeros: [{ re: 0, im: 0, order: 1 }], poles: [] };
        case 'exp': return { zeros: [], poles: [] };
        case 'sin': return { zeros: real(), poles: [] };
        case 'cos': return { zeros: real(Math.PI / 2), poles: [] };
        case 'tan': return {
            zeros: real(),
            poles: real(Math.PI / 2).map(point => ({ ...point, residue: { re: -1, im: 0 } }))
        };
        case 'sec': return {
            zeros: [],
            poles: real(Math.PI / 2).map(point => ({
                ...point, residue: { re: -1 / Math.sin(point.re), im: 0 }
            }))
        };
        case 'sinh': return { zeros: imaginary(), poles: [] };
        case 'tanh': return {
            zeros: imaginary(),
            poles: imaginary(Math.PI / 2).map(point => ({ ...point, residue: { re: 1, im: 0 } }))
        };
        case 'ln': return { zeros: [{ re: 1, im: 0, order: 1 }], poles: [] };
        case 'asin':
        case 'atan': return { zeros: [{ re: 0, im: 0, order: 1 }], poles: [] };
        case 'gamma': {
            const poles = [];
            let factorial = 1;
            for (let n = 0; -n >= xRange[0]; n++) {
                poles.push({ re: -n, im: 0, order: 1, residue: { re: (n % 2 ? -1 : 1) / factorial, im: 0 } });
                factorial *= n + 1;
            }
            return { zeros: [], poles };
        }
        case 'loggamma':
        case 'bessel': return { zeros: null, poles: [] };
        case 'power': {
            const exponent = state.fractionalPowerN;
            if (!Number.isInteger(exponent)) return { zeros: [], poles: [] };
            if (exponent > 0) return { zeros: [{ re: 0, im: 0, order: exponent }], poles: [] };
            if (exponent < 0) return {
                zeros: [],
                poles: [{ re: 0, im: 0, order: -exponent, residue: { re: exponent === -1 ? 1 : 0, im: 0 } }]
            };
            return { zeros: [], poles: [] };
        }
        case 'mobius': return mobiusFeatures();
        case 'polynomial': {
            if (state.polynomialCoeffs.every(coefficient => magnitudeSquared(coefficient) === 0)) {
                throw new Error('The zero polynomial has no isolated zeros.');
            }
            return {
                zeros: findNativePolynomialRoots([...state.polynomialCoeffs].reverse(), {
                    maxIterations: 1000, tolerance: 1e-7
                }),
                poles: []
            };
        }
        case 'zeta': return {
            zeros: state.zetaContinuationEnabled ? null : [],
            poles: [{ ...ZETA_POLE, order: 1, residue: { re: 1, im: 0 } }]
        };
        default: return null;
    }
}

function winding(values, valid, start, count) {
    if (valid.slice(start, start + count).some(value => !value)) return null;
    let previous = Math.atan2(values[start + count - 1].im, values[start + count - 1].re);
    let total = 0;
    for (let index = 0; index < count; index++) {
        const value = values[start + index];
        if (value.re === 0 && value.im === 0) return null;
        const angle = Math.atan2(value.im, value.re);
        let delta = angle - previous;
        if (delta > Math.PI) delta -= TWO_PI;
        else if (delta < -Math.PI) delta += TWO_PI;
        total += delta;
        previous = angle;
    }
    const result = total / TWO_PI;
    const integer = Math.round(result);
    return Math.abs(result - integer) <= 0.08 ? integer : null;
}

function certifyCandidates(map, candidates, allCandidates, sign, span) {
    if (!candidates.length) return [];
    const samples = 48;
    const points = [];
    const radii = candidates.map(candidate => {
        let radius = span / 300;
        for (const other of allCandidates) {
            const distance = Math.hypot(candidate.re - other.re, candidate.im - other.im);
            if (distance > 0) radius = Math.min(radius, distance / 3);
        }
        return Math.max(span * 1e-7, radius);
    });
    for (let index = 0; index < candidates.length; index++) {
        for (const scale of [1, 0.5]) {
            for (let sample = 0; sample < samples; sample++) {
                const angle = sample / samples * TWO_PI;
                points.push({
                    re: candidates[index].re + radii[index] * scale * Math.cos(angle),
                    im: candidates[index].im + radii[index] * scale * Math.sin(angle)
                });
            }
        }
    }
    const evaluated = evaluateNativePoints(map, points);
    return candidates.flatMap((candidate, index) => {
        const offset = index * samples * 2;
        const outer = winding(evaluated.values, evaluated.valid, offset, samples);
        const inner = winding(evaluated.values, evaluated.valid, offset + samples, samples);
        return outer !== null && outer === inner && Math.sign(outer) === sign
            ? [{ ...candidate, order: Math.abs(outer), analysisRadius: radii[index] * 0.5 }]
            : [];
    });
}

export function findZerosAndPoles() {
    if (!state.showZerosPoles || (state.manifold3dViewEnabled && state.manifoldTransformationEnabled) ||
        zPlaneParams.preciseViewport) {
        state.zeros = [];
        state.poles = [];
        zerosPolesKey = null;
        return;
    }
    const active = resolveActiveMap();
    const key = cacheKey(active);
    if (key === zerosPolesKey) return;
    const xRange = zPlaneParams.currentVisXRange;
    const yRange = zPlaneParams.currentVisYRange;
    const span = Math.max(xRange[1] - xRange[0], yRange[1] - yRange[0]);
    const merge = Math.max(1e-8, span * 1e-7);
    const map = activeNativeMap(active);
    const simple = active.presentation === 'function' && !map.chainingEnabled && !map.taylor && !map.dynamicAggregate;
    const plan = simple ? simpleFeaturePlan(xRange, yRange) : null;
    const density = Math.min(32, ZERO_POLE_GRID_SIZE);
    const candidateDistance = span / (density * 120);
    const search = (inverseOutput, candidateMap = map) => findNativePreimages({
        map: candidateMap, target: { re: 0, im: 0 }, xRange, yRange,
        density, maxIterations: 30, inverseOutput
    });
    let zeroCandidates = plan?.zeros ?? search(false);
    if (simple && state.currentFunction === 'polynomial') {
        zeroCandidates = unique(zeroCandidates, candidateDistance);
    }
    let poleCandidates = plan?.poles ?? search(true);
    if (!plan && active.presentation === 'derivative') {
        poleCandidates = unique([...search(true, activeNativeMap(active, 0)), ...poleCandidates], candidateDistance);
    }
    const allCandidates = [...zeroCandidates, ...poleCandidates];
    const numericalZeros = plan?.zeros === null || !plan || (simple && state.currentFunction === 'polynomial');
    let zeros = numericalZeros
        ? certifyCandidates(map, zeroCandidates, allCandidates, 1, span)
        : zeroCandidates;
    const poles = plan?.poles === null || !plan
        ? certifyCandidates(map, poleCandidates, allCandidates, -1, span)
        : poleCandidates;

    if (simple && state.currentFunction === 'zeta' && state.zetaContinuationEnabled) {
        for (let real = -2; real >= Math.floor(xRange[0]); real -= 2) {
            if (real <= xRange[1]) {
                zeros = zeros.filter(point => Math.hypot(point.re - real, point.im) > candidateDistance);
                zeros.push({ re: real, im: 0, order: 1 });
            }
        }
    }
    state.zeros = unique(zeros.filter(point => inRange(point, xRange, yRange, merge)), merge)
        .map(({ analysisRadius: _, ...point }) => ({ ...point, type: 'zero', order: point.order ?? 1, residue: null }));
    state.poles = unique(poles.filter(point => inRange(point, xRange, yRange, merge)), merge)
        .map(point => decoratePole(map, point));
    zerosPolesKey = key;
}
