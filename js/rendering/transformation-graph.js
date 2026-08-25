import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { state, zPlaneParams } from '../store/state.js';
import { resolveActiveMap } from '../math/active-map.js';
import { NUM_POINTS_CURVE } from '../constants/numerical.js';
import { mapCanvasToWorldCoords, mapToCanvasCoords } from '../utils/canvas-utils.js';
import {
    buildInputShapeGeometryConfig,
    generateInputShapePointSets
} from './shape-generators.js';
import { disposeThreeObject } from './three-utils.js';
import { buildLaplaceWinding } from '../analysis/laplace-transform.js';
import { requireFiniteNumber, requireInteger } from '../utils/numeric-contracts.js';

const GRAPHABLE_INPUT_SHAPES = new Set([
    'grid_cartesian',
    'grid_polar',
    'grid_logpolar',
    'grid_logcartesian',
    'line',
    'circle',
    'ellipse',
    'arbitrary'
]);
const GRID_INPUT_SHAPES = new Set([
    'grid_cartesian',
    'grid_polar',
    'grid_logpolar',
    'grid_logcartesian'
]);

const BACKGROUND = 0x05060b;
const AXIS_COLOR = 0xaeb8cc;
const GRID_COLOR = 0x43506b;
const INPUT_TICK_COLOR = 0xf3f6ff;
const RE_COLOR = 0xffd45f;
const IM_COLOR = 0x5dd8e8;
const TRACE_COLOR = 0xdfe8ff;
const FOCUS_BOX_COLOR = 0xffd43b;
const INTERSECTION_COLOR = 0xf8fafc;
const RE_EMISSIVE = 0x4c3504;
const IM_EMISSIVE = 0x053846;
const SELECTION_STROKE = 'rgba(255, 220, 120, 0.95)';
const SELECTION_GLOW = 'rgba(255, 199, 92, 0.28)';
const SAMPLE_COUNT = 241;
const FULL_GRID_SAMPLE_COUNT = 161;
const INPUT_AXIS_HALF = 4.4;
const OUTPUT_AXIS_HALF = 2.05;
const DEPTH_AXIS_HALF = 2.05;
const MAX_TICK_LABELS = 5;
const CURVE_RADIUS = 0.026;
const AXIS_RADIUS = 0.014;
const GRID_RADIUS = 0.0045;
const TRACE_RADIUS = 0.014;
const FRUSTUM_HEIGHT = 6.3;
const FRUSTUM_MIN_HALF_WIDTH = 5.65;
const FULL_GRID_FRAME_SPACING = 7.5;
const FOURIER_RING_RADIUS = 0.72;
const EPSILON = 1e-10;

let activeGraphRenderer = null;
let graphDataCache = null;
let fullGridDataCache = null;

function isFiniteComplex(value) {
    return Number.isFinite(value?.re) && Number.isFinite(value?.im);
}

function finitePoint(point) {
    return point && Number.isFinite(point.re) && Number.isFinite(point.im);
}

function pointSetPoints(pointSet, label = 'Transformation-graph point set') {
    if (!Array.isArray(pointSet?.points)) throw new Error(`${label} requires a points array.`);
    return pointSet.points;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function normalizedNumber(value) {
    return Math.abs(value) < EPSILON ? 0 : value;
}

function trimFixed(text) {
    return text
        .replace(/(\.\d*?[1-9])0+$/u, '$1')
        .replace(/\.0+$/u, '');
}

function formatNumber(value) {
    const normalized = normalizedNumber(value);
    const abs = Math.abs(normalized);
    if (!Number.isFinite(normalized)) return 'NaN';
    if (abs >= 1000 || (abs > 0 && abs < 0.001)) return normalized.toExponential(2);
    if (abs >= 100) return trimFixed(normalized.toFixed(1));
    if (abs >= 10) return trimFixed(normalized.toFixed(2));
    return trimFixed(normalized.toFixed(3));
}

function formatComplexPoint(point) {
    const re = normalizedNumber(point.re);
    const im = normalizedNumber(point.im);
    const reText = formatNumber(re);
    const imText = formatNumber(Math.abs(im));

    if (im === 0) return reText;
    if (re === 0) return `${im < 0 ? '-' : ''}${imText}i`;
    return `${reText} ${im < 0 ? '-' : '+'} ${imText}i`;
}

export function isGraphViewSupported(shape = state.currentInputShape) {
    return GRAPHABLE_INPUT_SHAPES.has(shape);
}

export function isFullGridPerspectiveSupported(shape = state.currentInputShape) {
    return GRID_INPUT_SHAPES.has(shape);
}

function graphModeActive() {
    return state.graphViewEnabled
        && !state.laplaceModeEnabled;
}

function getGraphPointSets(planeParams = zPlaneParams, curvePoints = null) {
    if (!isGraphViewSupported()) return [];

    const config = buildInputShapeGeometryConfig(planeParams, {
        curvePoints: curvePoints ?? Math.max(SAMPLE_COUNT * 2, Math.min(NUM_POINTS_CURVE, 1000))
    });

    const pointSets = generateInputShapePointSets(config);
    if (!Array.isArray(pointSets)) throw new Error('Input-shape generation must return point sets.');
    pointSets.forEach((set, index) => pointSetPoints(set, `Transformation-graph point set ${index}`));
    return pointSets.filter(set => set.points.length > 1);
}

function pointSegmentDistanceSq(point, start, end) {
    const dx = end.re - start.re;
    const dy = end.im - start.im;
    const lenSq = dx * dx + dy * dy;

    if (lenSq <= EPSILON) {
        const sx = point.re - start.re;
        const sy = point.im - start.im;
        return sx * sx + sy * sy;
    }

    const t = clamp(((point.re - start.re) * dx + (point.im - start.im) * dy) / lenSq, 0, 1);
    const nearestRe = start.re + dx * t;
    const nearestIm = start.im + dy * t;
    const ox = point.re - nearestRe;
    const oy = point.im - nearestIm;
    return ox * ox + oy * oy;
}

function pointSetDistanceSq(point, pointSet) {
    const points = pointSetPoints(pointSet);
    let best = Infinity;

    for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1];
        const end = points[index];
        if (!finitePoint(start) || !finitePoint(end)) continue;
        best = Math.min(best, pointSegmentDistanceSq(point, start, end));
    }

    return best;
}

function defaultLineIndex(pointSets) {
    if (!pointSets.length) return -1;

    if (state.currentInputShape === 'grid_polar' || state.currentInputShape === 'grid_logpolar') {
        const circular = pointSets
            .map((set, index) => ({ set, index }))
            .filter(item => String(item.set.role || '').includes('radial'));

        if (circular.length) {
            return circular[Math.floor(circular.length * 0.5)].index;
        }
    }

    let bestIndex = 0;
    let bestDistanceSq = Infinity;
    const origin = { re: 0, im: 0 };
    pointSets.forEach((set, index) => {
        const distanceSq = pointSetDistanceSq(origin, set);
        if (distanceSq < bestDistanceSq) {
            bestDistanceSq = distanceSq;
            bestIndex = index;
        }
    });

    return bestIndex;
}

function prefersCircularPolarSelection(pointSet) {
    return (state.currentInputShape === 'grid_polar' || state.currentInputShape === 'grid_logpolar')
        && String(pointSet?.role || '').includes('radial');
}

function selectedLineIndex(pointSets, commitShapeChange = false) {
    const candidates = pointSets
        .map((set, index) => ({ set, index }))
        .filter(({ set }) => !state.graphFullGridEnabled
            || state.graphLayerLockEnabled
            || pointSetMatchesGridFamily(set));
    if (!candidates.length) return -1;

    const selectedIndex = Math.floor(Number(state.graphSelectedLineIndex));
    const selectionIsValid = state.graphSelectedShape === state.currentInputShape
        && Number.isFinite(selectedIndex)
        && candidates.some(candidate => candidate.index === selectedIndex);
    if (!selectionIsValid) {
        const defaultCandidates = state.graphFullGridEnabled && state.graphLayerLockEnabled
            ? candidates.filter(({ set }) => pointSetMatchesGridFamily(set))
            : candidates;
        const localIndex = defaultLineIndex(defaultCandidates.map(candidate => candidate.set));
        const nextIndex = defaultCandidates[localIndex]?.index ?? -1;
        if (commitShapeChange) {
            state.graphSelectedShape = state.currentInputShape;
            state.graphSelectedLineIndex = nextIndex;
        }
        return nextIndex;
    }

    return selectedIndex;
}

export function selectGraphInputFromCanvasPoint(canvasX, canvasY, planeParams = zPlaneParams) {
    if (!state.graphViewEnabled || !isGraphViewSupported()) return false;

    const world = mapCanvasToWorldCoords(canvasX, canvasY, planeParams);
    const probe = { re: world.x, im: world.y };
    if (!finitePoint(probe)) return false;

    const pointSets = getGraphPointSets(planeParams);
    const lockedIndex = selectedLineIndex(pointSets, false);
    const lockedFamily = gridFamilyForPointSet(pointSets[lockedIndex]);
    const candidates = pointSets
        .map((set, index) => ({ set, index }))
        .filter(({ set, index }) => {
            if (!state.graphFullGridEnabled) return true;
            if (!state.graphLayerLockEnabled) return pointSetMatchesGridFamily(set);
            return index === lockedIndex || gridFamilyForPointSet(set) !== lockedFamily;
        });
    if (!candidates.length) return false;

    const xRange = planeParams.currentVisXRange;
    const viewportWidth = requireFiniteNumber(planeParams.width, 'Transformation-graph viewport width');
    if (viewportWidth <= 0) throw new Error('Transformation-graph viewport width must be positive.');
    const worldPerPixel = Math.abs((xRange[1] - xRange[0]) / viewportWidth);
    const toleranceSq = (worldPerPixel * 14) ** 2;

    let bestIndex = -1;
    let bestDistanceSq = Infinity;
    let bestPreferred = false;
    candidates.forEach(({ set, index }) => {
        const distanceSq = pointSetDistanceSq(probe, set);
        const preferred = prefersCircularPolarSelection(set);
        const nearTie = Math.abs(distanceSq - bestDistanceSq) <= toleranceSq * 0.02;
        if (distanceSq < bestDistanceSq || (nearTie && preferred && !bestPreferred)) {
            bestDistanceSq = distanceSq;
            bestIndex = index;
            bestPreferred = preferred;
        }
    });

    if (bestIndex < 0 || bestDistanceSq > toleranceSq) return false;

    state.graphSelectedShape = state.currentInputShape;
    state.graphSelectedLineIndex = bestIndex;
    if (state.graphFullGridEnabled && state.graphLayerLockEnabled) {
        state.graphGridFamily = gridFamilyForPointSet(pointSets[bestIndex]);
    }
    state.graphSelectionRevision = (state.graphSelectionRevision || 0) + 1;
    return true;
}

export function drawGraphSelectionOverlay(ctx, planeParams = zPlaneParams) {
    if (!ctx || !state.graphViewEnabled || !isGraphViewSupported()) return;

    const pointSets = getGraphPointSets(planeParams);
    const index = selectedLineIndex(pointSets, false);
    const selected = pointSets[index];
    if (!selected) return;
    const points = pointSetPoints(selected, 'Selected transformation-graph point set');

    const drawPath = () => {
        let started = false;
        points.forEach(point => {
            if (!finitePoint(point)) {
                started = false;
                return;
            }
            const canvasPoint = mapToCanvasCoords(point.re, point.im, planeParams);
            if (!started) {
                ctx.moveTo(canvasPoint.x, canvasPoint.y);
                started = true;
            } else {
                ctx.lineTo(canvasPoint.x, canvasPoint.y);
            }
        });
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    drawPath();
    ctx.strokeStyle = SELECTION_GLOW;
    ctx.lineWidth = 9;
    ctx.stroke();

    ctx.beginPath();
    drawPath();
    ctx.strokeStyle = SELECTION_STROKE;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.restore();
}

function cumulativeDistances(points) {
    const distances = new Float64Array(points.length);
    let total = 0;

    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        const distance = finitePoint(previous) && finitePoint(current)
            ? Math.hypot(current.re - previous.re, current.im - previous.im)
            : 0;
        total += distance;
        distances[index] = total;
    }

    return { distances, total };
}

function resamplePolyline(points, count = SAMPLE_COUNT) {
    const safePoints = points.filter(finitePoint);
    if (safePoints.length === 0) return [];
    if (safePoints.length === 1 || count <= 1) return [safePoints[0]];

    const { distances, total } = cumulativeDistances(safePoints);
    if (total <= EPSILON) {
        return Array.from({ length: count }, (_, index) => safePoints[Math.min(safePoints.length - 1, index % safePoints.length)]);
    }

    const samples = new Array(count);
    let segment = 1;

    for (let index = 0; index < count; index += 1) {
        const targetDistance = total * (index / (count - 1));
        while (segment < distances.length - 1 && distances[segment] < targetDistance) {
            segment += 1;
        }

        const start = safePoints[segment - 1];
        const end = safePoints[segment];
        const span = distances[segment] - distances[segment - 1];
        const t = span > EPSILON ? (targetDistance - distances[segment - 1]) / span : 0;
        samples[index] = {
            re: lerp(start.re, end.re, t),
            im: lerp(start.im, end.im, t)
        };
    }

    return samples;
}

function linearComponentScale(samples, component) {
    let maximum = 0;
    samples.forEach(sample => {
        if (!isFiniteComplex(sample.output)) return;
        maximum = Math.max(maximum, Math.abs(sample.output[component]));
    });
    return Math.max(EPSILON, maximum);
}

function normalizedComponentScale(samples, component) {
    const values = [];
    samples.forEach(sample => {
        if (!isFiniteComplex(sample.output)) return;
        values.push(Math.abs(sample.output[component]));
    });
    if (!values.length) return 1;
    values.sort((a, b) => a - b);
    const maxValue = values[values.length - 1];
    if (maxValue <= EPSILON) return 1;
    const p90 = values[Math.floor((values.length - 1) * 0.9)] || maxValue;
    const robust = Math.max(EPSILON, p90 * 1.2);
    return maxValue <= robust * 1.35 ? maxValue : robust;
}

function pointSetLabel(pointSet) {
    const points = pointSetPoints(pointSet);
    const first = points.find(finitePoint);
    const last = [...points].reverse().find(finitePoint);
    const role = String(pointSet?.role || '');
    if (!first) return role;
    if (role.includes('horizontal')) return `Im(z) = ${formatNumber(first.im)}`;
    if (role.includes('vertical')) return `Re(z) = ${formatNumber(first.re)}`;
    if (role.includes('radial')) return `|z| = ${formatNumber(Math.hypot(first.re, first.im))}`;
    if (role.includes('angular')) {
        const direction = last || first;
        return `arg(z) = ${formatNumber(Math.atan2(direction.im, direction.re))}`;
    }
    return formatComplexPoint(first);
}

function evaluateSamples(inputSamples, map) {
    const outputs = map.evaluateBatch(inputSamples);
    return inputSamples.map((input, index) => {
        const t = inputSamples.length <= 1 ? 0 : index / (inputSamples.length - 1);
        return { input: { re: input.re, im: input.im }, output: outputs[index], t };
    });
}

function evaluateSample(input, t, map) {
    const output = map.evaluate(input.re, input.im);
    return { input: { re: input.re, im: input.im }, output, t };
}

function polylineParameterAtPoint(points, target) {
    const safePoints = points.filter(finitePoint);
    if (safePoints.length < 2) return 0;
    const { distances, total } = cumulativeDistances(safePoints);
    if (total <= EPSILON) return 0;

    let bestDistanceSq = Infinity;
    let bestDistance = 0;
    for (let index = 1; index < safePoints.length; index += 1) {
        const start = safePoints[index - 1];
        const end = safePoints[index];
        const dx = end.re - start.re;
        const dy = end.im - start.im;
        const segmentLengthSq = dx * dx + dy * dy;
        const mix = segmentLengthSq <= EPSILON
            ? 0
            : clamp(((target.re - start.re) * dx + (target.im - start.im) * dy) / segmentLengthSq, 0, 1);
        const re = lerp(start.re, end.re, mix);
        const im = lerp(start.im, end.im, mix);
        const distanceSq = (target.re - re) ** 2 + (target.im - im) ** 2;
        if (distanceSq >= bestDistanceSq) continue;
        bestDistanceSq = distanceSq;
        bestDistance = distances[index - 1] + Math.sqrt(segmentLengthSq) * mix;
    }
    return clamp(bestDistance / total, 0, 1);
}

function insertMappedSample(samples, mappedSample, t) {
    const next = {
        input: { ...mappedSample.input },
        output: { ...mappedSample.output },
        t: clamp(t, 0, 1)
    };
    const existingIndex = samples.findIndex(sample => Math.abs(sample.t - next.t) <= 1e-8);
    if (existingIndex >= 0) samples[existingIndex] = next;
    else {
        samples.push(next);
        samples.sort((left, right) => left.t - right.t);
    }
    return next;
}

function gridIntersectionPoint(leftSet, rightSet) {
    const leftRole = String(leftSet?.role || '');
    const rightRole = String(rightSet?.role || '');
    const horizontal = leftRole.includes('horizontal') ? leftSet
        : rightRole.includes('horizontal') ? rightSet : null;
    const vertical = leftRole.includes('vertical') ? leftSet
        : rightRole.includes('vertical') ? rightSet : null;
    if (horizontal && vertical) {
        const horizontalPoint = horizontal.points.find(finitePoint);
        const verticalPoint = vertical.points.find(finitePoint);
        if (horizontalPoint && verticalPoint) {
            return { re: verticalPoint.re, im: horizontalPoint.im };
        }
    }

    const circle = leftRole.includes('radial') ? leftSet
        : rightRole.includes('radial') ? rightSet : null;
    const ray = leftRole.includes('angular') ? leftSet
        : rightRole.includes('angular') ? rightSet : null;
    if (!circle || !ray) return null;
    const circlePoint = circle.points.find(finitePoint);
    const direction = [...ray.points].reverse().find(point =>
        finitePoint(point) && Math.hypot(point.re, point.im) > EPSILON
    );
    if (!circlePoint || !direction) return null;
    const radius = Math.hypot(circlePoint.re, circlePoint.im);
    const directionMagnitude = Math.hypot(direction.re, direction.im);
    return {
        re: radius * direction.re / directionMagnitude,
        im: radius * direction.im / directionMagnitude
    };
}

function selectEvenly(items, maximum) {
    if (items.length <= maximum) return items;
    return Array.from({ length: maximum }, (_, index) =>
        items[Math.round(index * (items.length - 1) / (maximum - 1))]
    );
}

export function pointSetMatchesGridFamily(
    pointSet,
    shape = state.currentInputShape,
    family = state.graphGridFamily
) {
    const role = String(pointSet?.role || '');
    const primary = family !== 'secondary';
    const polar = shape === 'grid_polar' || shape === 'grid_logpolar';
    if (polar) return primary ? role.includes('radial') : role.includes('angular');
    return primary ? role.includes('horizontal') : role.includes('vertical');
}

function gridFamilyForPointSet(pointSet, shape = state.currentInputShape) {
    const role = String(pointSet?.role || '');
    const polar = shape === 'grid_polar' || shape === 'grid_logpolar';
    if (polar) return role.includes('radial') ? 'primary' : 'secondary';
    return role.includes('horizontal') ? 'primary' : 'secondary';
}

export function filterGraphFullGridPointSets(pointSets) {
    if (!state.graphFullGridEnabled) return pointSets;
    if (!state.graphLayerLockEnabled) {
        return pointSets.filter(pointSet => pointSetMatchesGridFamily(pointSet));
    }

    const lockedIndex = selectedLineIndex(pointSets, false);
    const lockedFamily = gridFamilyForPointSet(pointSets[lockedIndex]);
    return pointSets.filter((pointSet, index) =>
        index === lockedIndex || gridFamilyForPointSet(pointSet) !== lockedFamily
    );
}

function gridFamilySortValue(pointSet) {
    const first = pointSetPoints(pointSet).find(finitePoint);
    if (!first) return 0;
    const role = String(pointSet.role || '');
    if (role.includes('horizontal')) return first.im;
    if (role.includes('vertical')) return first.re;
    if (role.includes('radial')) return Math.hypot(first.re, first.im);
    if (role.includes('angular')) {
        const direction = [...pointSet.points].reverse().find(finitePoint) || first;
        const angle = Math.atan2(direction.im, direction.re);
        return angle < 0 ? angle + Math.PI * 2 : angle;
    }
    return 0;
}

function visibleInputBounds(planeParams = zPlaneParams) {
    return {
        xRange: planeParams.currentVisXRange,
        yRange: planeParams.currentVisYRange
    };
}

function makeFullGridInputKey(map, planeParams = zPlaneParams, lockedIndex = -1) {
    const { xRange, yRange } = visibleInputBounds(planeParams);
    return [
        'full-grid',
        map.signature,
        state.currentInputShape,
        state.graphGridFamily,
        state.graphLayerLockEnabled ? 'locked' : 'separate',
        state.graphLayerLockEnabled ? lockedIndex : '-',
        state.gridDensity,
        state.gridColor1,
        state.gridColor2,
        state.zetaContinuationEnabled ? 1 : 0,
        FULL_GRID_SAMPLE_COUNT,
        xRange[0], xRange[1], yRange[0], yRange[1]
    ].join('|');
}

function buildLockedGridData(pointSets, lockedIndex, map, inputKey, sampleCount) {
    const lockedSet = pointSets[lockedIndex];
    if (!lockedSet) return null;
    const lockedFamily = gridFamilyForPointSet(lockedSet);
    const crossingSets = pointSets
        .map((pointSet, sourceIndex) => ({ pointSet, sourceIndex }))
        .filter(({ pointSet }) => gridFamilyForPointSet(pointSet) !== lockedFamily)
        .sort((left, right) => gridFamilySortValue(left.pointSet) - gridFamilySortValue(right.pointSet));

    const lockedSamples = evaluateSamples(resamplePolyline(lockedSet.points, sampleCount), map);
    const intersections = [];
    const crossingCurves = crossingSets.map(({ pointSet, sourceIndex }) => {
        const input = gridIntersectionPoint(lockedSet, pointSet);
        const lockedT = input ? polylineParameterAtPoint(lockedSet.points, input) : 0;
        const crossingT = input ? polylineParameterAtPoint(pointSet.points, input) : 0;
        const mapped = input ? evaluateSample(input, lockedT, map) : null;
        if (mapped) insertMappedSample(lockedSamples, mapped, lockedT);

        const samples = evaluateSamples(resamplePolyline(pointSet.points, sampleCount), map);
        if (mapped) insertMappedSample(samples, mapped, crossingT);
        if (mapped) {
            intersections.push({
                input: mapped.input,
                output: mapped.output,
                t: lockedT,
                sourceIndex
            });
        }
        return {
            sourceIndex,
            role: pointSet.role || '',
            label: pointSetLabel(pointSet),
            samples,
            intersectionT: lockedT,
            anchorT: crossingT
        };
    });

    const allSamples = [lockedSamples, ...crossingCurves.map(curve => curve.samples)].flat();
    const reScale = normalizedComponentScale(lockedSamples, 're');
    const imScale = normalizedComponentScale(lockedSamples, 'im');
    const lockedCurve = {
        sourceIndex: lockedIndex,
        role: lockedSet.role || '',
        label: pointSetLabel(lockedSet),
        samples: lockedSamples,
        reScale,
        imScale,
        locked: true
    };
    const curves = [lockedCurve, ...crossingCurves].map(curve => ({
        ...curve,
        reScale,
        imScale
    }));
    const finiteCount = allSamples.reduce(
        (count, sample) => count + (isFiniteComplex(sample.output) ? 1 : 0),
        0
    );

    return {
        mode: 'locked-grid',
        geometryKey: inputKey,
        key: makeGraphDisplayKey(inputKey),
        curves,
        lockedCurve: curves[0],
        samples: lockedSamples,
        intersections,
        reScale,
        imScale,
        axisLabel: lockedCurve.label,
        finiteCount
    };
}

function syncFullGridSelection(data, pointSets) {
    const sourceIndex = selectedLineIndex(pointSets, true);
    data.selectedCurveIndex = data.curves.findIndex(curve => curve.sourceIndex === sourceIndex);
    data.selectionKey = [
        state.currentInputShape,
        state.graphGridFamily,
        sourceIndex,
        state.graphSelectionRevision || 0,
        data.curves.length,
        state.graphFocusBoxEnabled ? 1 : 0
    ].join('|');
    data.key = `${makeGraphDisplayKey(data.geometryKey)}|selection:${data.selectionKey}`;
    return data;
}

export function buildFullGridTransformationGraphData(planeParams = zPlaneParams) {
    if (!graphModeActive() || !state.graphFullGridEnabled || !isFullGridPerspectiveSupported()) {
        return null;
    }

    const map = resolveActiveMap();
    const sampleCount = FULL_GRID_SAMPLE_COUNT;
    const pointSets = getGraphPointSets(planeParams, sampleCount * 2);
    const lockedIndex = state.graphLayerLockEnabled ? selectedLineIndex(pointSets, true) : -1;
    if (state.graphLayerLockEnabled && lockedIndex >= 0) {
        state.graphGridFamily = gridFamilyForPointSet(pointSets[lockedIndex]);
    }
    const inputKey = makeFullGridInputKey(map, planeParams, lockedIndex);
    if (fullGridDataCache?.inputKey === inputKey) {
        fullGridDataCache.data.key = makeGraphDisplayKey(inputKey);
        return syncFullGridSelection(fullGridDataCache.data, fullGridDataCache.pointSets);
    }

    if (state.graphLayerLockEnabled) {
        const data = buildLockedGridData(pointSets, lockedIndex, map, inputKey, sampleCount);
        if (!data) return null;
        fullGridDataCache = { inputKey, data, pointSets };
        return syncFullGridSelection(data, pointSets);
    }

    const selectedSets = pointSets
        .map((pointSet, sourceIndex) => ({ pointSet, sourceIndex }))
        .filter(({ pointSet }) => pointSetMatchesGridFamily(pointSet))
        .sort((left, right) => gridFamilySortValue(left.pointSet) - gridFamilySortValue(right.pointSet));
    const curves = selectedSets.map(({ pointSet, sourceIndex }) => {
        const samples = evaluateSamples(resamplePolyline(pointSet.points, sampleCount), map);
        return {
            sourceIndex,
            role: pointSet.role || '',
            label: pointSetLabel(pointSet),
            samples,
            fourierReScale: linearComponentScale(samples, 're'),
            fourierImScale: linearComponentScale(samples, 'im'),
            reScale: normalizedComponentScale(samples, 're'),
            imScale: normalizedComponentScale(samples, 'im')
        };
    });
    const finiteCount = curves.reduce((total, curve) =>
        total + curve.samples.reduce((count, sample) => count + (isFiniteComplex(sample.output) ? 1 : 0), 0), 0);
    const data = {
        mode: 'grid',
        geometryKey: inputKey,
        key: makeGraphDisplayKey(inputKey),
        curves,
        finiteCount
    };
    fullGridDataCache = { inputKey, data, pointSets };
    return syncFullGridSelection(data, pointSets);
}

function makeGraphInputKey(map, lineIndex, planeParams = zPlaneParams) {
    const xRange = planeParams.currentVisXRange;
    const yRange = planeParams.currentVisYRange;
    return [
        map.signature,
        state.currentInputShape,
        state.graphSelectedShape,
        lineIndex,
        state.graphSelectionRevision || 0,
        state.gridDensity,
        state.a0,
        state.b0,
        state.circleR,
        state.ellipseA,
        state.ellipseB,
        SAMPLE_COUNT,
        xRange[0],
        xRange[1],
        yRange[0],
        yRange[1]
    ].join('|');
}

function makeGraphDisplayKey(inputKey) {
    return [
        inputKey,
        `trace:${state.graphTraceEnabled ? 1 : 0}`,
        `fourier:${state.graphFourierEnabled ? 1 : 0}`,
        state.laplaceFrequency,
        state.laplaceAmplitude,
        state.laplaceTimeWindow,
        state.laplaceSamples,
        state.laplaceOmega,
        state.laplaceAnimationTime
    ].join('|');
}

function graphSelectionHint() {
    return state.graphSelectedShape === state.currentInputShape
        ? Math.floor(Number(state.graphSelectedLineIndex))
        : -1;
}

function cachedGraphData(inputKey) {
    if (!graphDataCache || graphDataCache.inputKey !== inputKey) return null;
    graphDataCache.data.key = makeGraphDisplayKey(inputKey);
    return graphDataCache.data;
}

export function buildTransformationGraphData(planeParams = zPlaneParams) {
    if (!graphModeActive() || !isGraphViewSupported()) return null;
    if (state.graphFullGridEnabled) return buildFullGridTransformationGraphData(planeParams);

    const map = resolveActiveMap();
    const provisionalKey = makeGraphInputKey(map, graphSelectionHint(), planeParams);
    const cached = cachedGraphData(provisionalKey);
    if (cached) return cached;

    const pointSets = getGraphPointSets(planeParams);
    const lineIndex = selectedLineIndex(pointSets, true);
    const selected = pointSets[lineIndex];
    if (!selected) return null;

    const inputKey = makeGraphInputKey(map, lineIndex, planeParams);
    const selectedCache = cachedGraphData(inputKey);
    if (selectedCache) return selectedCache;

    const inputSamples = resamplePolyline(selected.points, SAMPLE_COUNT);
    if (inputSamples.length < 2) return null;

    const samples = evaluateSamples(inputSamples, map);
    const finiteCount = samples.reduce((count, sample) => count + (isFiniteComplex(sample.output) ? 1 : 0), 0);

    const data = {
        mode: 'single',
        geometryKey: inputKey,
        key: makeGraphDisplayKey(inputKey),
        samples,
        fourierReScale: linearComponentScale(samples, 're'),
        fourierImScale: linearComponentScale(samples, 'im'),
        reScale: normalizedComponentScale(samples, 're'),
        imScale: normalizedComponentScale(samples, 'im'),
        finiteCount
    };
    graphDataCache = { inputKey, data };
    return data;
}

function makeTube(points, {
    color,
    radius = CURVE_RADIUS,
    opacity = 1,
    emissive = 0x000000,
    emissiveIntensity = 0,
    roughness = 0.38,
    metalness = 0.06
} = {}) {
    if (!Array.isArray(points) || points.length < 2) return null;

    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.45);
    const geometry = new THREE.TubeGeometry(curve, Math.max(12, points.length * 2), radius, 10, false);
    const material = new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity,
        roughness,
        metalness,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 0.85
    });

    return new THREE.Mesh(geometry, material);
}

function makeGlowTube(points, color, radius, opacity) {
    const mesh = makeTube(points, {
        color,
        radius,
        opacity,
        emissive: color,
        emissiveIntensity: 0.35,
        roughness: 0.85,
        metalness: 0
    });

    if (mesh) {
        mesh.renderOrder = 1;
        mesh.material.depthWrite = false;
    }

    return mesh;
}

function addSegmentedTube(group, points, options) {
    let segment = [];

    const flush = () => {
        if (segment.length >= 2) {
            const glow = options.glowRadius && options.glowOpacity
                ? makeGlowTube(segment, options.color, options.glowRadius, options.glowOpacity)
                : null;
            const core = makeTube(segment, options);
            if (glow) group.add(glow);
            if (core) group.add(core);
        }
        segment = [];
    };

    points.forEach(point => {
        if (!point) {
            flush();
            return;
        }
        segment.push(point);
    });
    flush();
}

function addSoftLine(group, start, end, options) {
    addSegmentedTube(group, [start, end], options);
}

function addPolyline(group, points, { color = GRID_COLOR, opacity = 1 } = {}) {
    const finitePoints = points.filter(Boolean);
    if (finitePoints.length < 2) return null;
    const geometry = new THREE.BufferGeometry().setFromPoints(finitePoints);
    const material = new THREE.LineBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 0.85
    });
    const line = new THREE.Line(geometry, material);
    group.add(line);
    return line;
}

function addSegmentedPolyline(group, points, options = {}) {
    let segment = [];
    const flush = () => {
        if (segment.length >= 2) addPolyline(group, segment, options);
        segment = [];
    };

    points.forEach(point => {
        if (!point) {
            flush();
            return;
        }
        segment.push(point);
    });
    flush();
}

function addLineSegments(group, segments, {
    color = GRID_COLOR,
    opacity = 1,
    vertexColors = null
} = {}) {
    if (!Array.isArray(segments) || segments.length === 0) return null;
    const positions = new Float32Array(segments.length * 6);
    const colors = vertexColors ? new Float32Array(segments.length * 6) : null;

    segments.forEach(([start, end], index) => {
        const offset = index * 6;
        positions.set([start.x, start.y, start.z, end.x, end.y, end.z], offset);
        if (!colors) return;
        const [startColor, endColor = startColor] = vertexColors[index];
        colors.set([
            startColor.r, startColor.g, startColor.b,
            endColor.r, endColor.g, endColor.b
        ], offset);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
        color: colors ? 0xffffff : color,
        vertexColors: Boolean(colors),
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 0.85
    });
    const lines = new THREE.LineSegments(geometry, material);
    group.add(lines);
    return lines;
}

function appendPolylineSegments(target, points) {
    let previous = null;
    points.forEach(point => {
        if (!point) {
            previous = null;
            return;
        }
        if (previous) target.push([previous, point]);
        previous = point;
    });
}

function addPointCloud(group, points, {
    color,
    size = 4,
    opacity = 1
} = {}) {
    if (!points.length) return null;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.PointsMaterial({
        color,
        size,
        sizeAttenuation: false,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 0.85
    });
    const cloud = new THREE.Points(geometry, material);
    group.add(cloud);
    return cloud;
}

function addMarker(group, point, color, radius = 0.07) {
    const geometry = new THREE.SphereGeometry(radius, 18, 12);
    const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.55,
        roughness: 0.28
    });
    const marker = new THREE.Mesh(geometry, material);
    marker.position.copy(point);
    group.add(marker);
    return marker;
}

function addGlowMarker(group, point, color, radius = 0.14, opacity = 0.16) {
    const geometry = new THREE.SphereGeometry(radius, 18, 12);
    const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false
    });
    const marker = new THREE.Mesh(geometry, material);
    marker.position.copy(point);
    marker.renderOrder = 2;
    group.add(marker);
    return marker;
}

function addArrowHead(group, origin, tip, color = 0xffdc32) {
    const direction = tip.clone().sub(origin);
    const length = direction.length();
    if (length <= EPSILON) return null;
    direction.normalize();
    const geometry = new THREE.ConeGeometry(0.055, 0.15, 14);
    const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.42,
        roughness: 0.32
    });
    const arrow = new THREE.Mesh(geometry, material);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    arrow.position.copy(tip).addScaledVector(direction, -0.075);
    group.add(arrow);
    return arrow;
}

function lineArrowHeadSegments(origin, tip, plane) {
    const direction = tip.clone().sub(origin);
    if (direction.lengthSq() <= EPSILON) return [];
    direction.normalize();
    const normal = plane === 're' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(normal, direction).normalize();
    const back = tip.clone().addScaledVector(direction, -0.12);
    return [
        [tip, back.clone().addScaledVector(side, 0.055)],
        [tip, back.clone().addScaledVector(side, -0.055)]
    ];
}

function addPlane(group, width, height, position, rotation, color, opacity) {
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
    group.add(mesh);
    return mesh;
}

function makeTextSprite(text, {
    color = 'rgba(236, 241, 255, 0.95)',
    fontSize = 46,
    height = 0.28,
    weight = 600,
    maxWidth = 768
} = {}) {
    const padding = 32;
    const font = `${weight} ${fontSize}px "Inter", "Outfit", sans-serif`;
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    measureCtx.font = font;
    const measured = measureCtx.measureText(text);
    const width = Math.min(maxWidth, Math.max(192, Math.ceil(measured.width + padding * 2)));
    const canvasHeight = Math.ceil(fontSize + padding * 2);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = canvasHeight;
    const context = canvas.getContext('2d');
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = color;
    context.shadowColor = 'rgba(0, 0, 0, 0.68)';
    context.shadowBlur = 10;
    context.fillText(text, width / 2, canvasHeight / 2, width - padding);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(height * (width / canvasHeight), height, 1);
    return sprite;
}

function addLabel(group, text, position, options = {}) {
    const sprite = makeTextSprite(text, options);
    sprite.position.copy(position);
    group.add(sprite);
    return sprite;
}

function scaledOutputCoordinate(value, outputScale, halfExtent) {
    if (!Number.isFinite(value)) return NaN;
    const scale = Math.max(EPSILON, outputScale);
    const ratio = value / scale;
    const magnitude = Math.abs(ratio);
    const signed = magnitude <= 1
        ? ratio
        : Math.sign(ratio) * (1 + Math.tanh((magnitude - 1) * 0.55) * 0.18);
    return signed * halfExtent;
}

function graphPointFor(sample, scales, mode, zOffset = 0) {
    if (!isFiniteComplex(sample.output)) return null;

    const x = lerp(-INPUT_AXIS_HALF, INPUT_AXIS_HALF, sample.t);
    const reScale = scales?.reScale || 1;
    const imScale = scales?.imScale || 1;
    const y = scaledOutputCoordinate(sample.output.re, reScale, OUTPUT_AXIS_HALF);
    const z = zOffset + scaledOutputCoordinate(sample.output.im, imScale, DEPTH_AXIS_HALF);

    if (mode === 're') return new THREE.Vector3(x, y, zOffset);
    if (mode === 'im') return new THREE.Vector3(x, 0, z);
    return new THREE.Vector3(x, y, z);
}

function hasGraphPoleJump(previous, sample, scales, components) {
    if (!isFiniteComplex(previous?.output) || !isFiniteComplex(sample?.output)) return false;
    return components.some(component => {
        const scale = component === 're'
            ? scales?.reScale || 1
            : scales?.imScale || 1;
        const left = previous.output[component] / Math.max(EPSILON, scale);
        const right = sample.output[component] / Math.max(EPSILON, scale);
        return left * right < 0
            && Math.abs(left) > 1.05
            && Math.abs(right) > 1.05
            && Math.abs(left - right) > 4;
    });
}

function graphPointsForSamples(samples, scales, mode, zOffset = 0) {
    const components = mode === 're' ? ['re'] : mode === 'im' ? ['im'] : ['re', 'im'];
    const points = [];
    let previous = null;

    samples.forEach(sample => {
        if (hasGraphPoleJump(previous, sample, scales, components)) points.push(null);
        points.push(graphPointFor(sample, scales, mode, zOffset));
        previous = sample;
    });
    return points;
}

function curveIsClosed(curve) {
    const first = curve?.samples?.[0]?.input;
    const last = curve?.samples?.at(-1)?.input;
    return finitePoint(first) && finitePoint(last)
        && Math.hypot(first.re - last.re, first.im - last.im) <= EPSILON;
}

function connectedLayerRatio(sample, curve) {
    if (curve.locked) return 0;
    const anchor = clamp(requireFiniteNumber(curve.anchorT, 'Connected graph anchor'), 0, 1);
    if (curveIsClosed(curve)) {
        let phase = sample.t - anchor;
        phase -= Math.round(phase);
        return phase / 0.5;
    }
    const delta = sample.t - anchor;
    const span = delta < 0 ? anchor : 1 - anchor;
    return delta / Math.max(EPSILON, span);
}

function orderedConnectedSamples(samples, curve) {
    if (curve.locked || !curveIsClosed(curve)) return samples;
    const ordered = samples.slice();
    const first = ordered[0]?.input;
    const last = ordered.at(-1)?.input;
    if (finitePoint(first) && finitePoint(last)
        && Math.hypot(first.re - last.re, first.im - last.im) <= EPSILON) {
        ordered.pop();
    }
    return ordered.sort((left, right) =>
        connectedLayerRatio(left, curve) - connectedLayerRatio(right, curve)
    );
}

function connectedGraphPointFor(sample, curve, mode) {
    if (!isFiniteComplex(sample.output)) return null;
    const inputT = curve.locked ? sample.t : curve.intersectionT;
    const x = lerp(-INPUT_AXIS_HALF, INPUT_AXIS_HALF, inputT);
    const transverse = connectedLayerRatio(sample, curve);
    if (mode === 're') {
        return new THREE.Vector3(
            x,
            scaledOutputCoordinate(sample.output.re, curve.reScale, OUTPUT_AXIS_HALF),
            transverse * DEPTH_AXIS_HALF
        );
    }
    return new THREE.Vector3(
        x,
        transverse * OUTPUT_AXIS_HALF,
        scaledOutputCoordinate(sample.output.im, curve.imScale, DEPTH_AXIS_HALF)
    );
}

function connectedGraphPointsForSamples(samples, curve, mode) {
    const points = [];
    let previous = null;
    const component = mode === 're' ? ['re'] : ['im'];
    orderedConnectedSamples(samples, curve).forEach(sample => {
        if (hasGraphPoleJump(previous, sample, curve, component)) points.push(null);
        points.push(connectedGraphPointFor(sample, curve, mode));
        previous = sample;
    });
    return points;
}

function ringPoints(center, radius, plane) {
    return Array.from({ length: 97 }, (_, index) => {
        const angle = (index / 96) * Math.PI * 2;
        if (plane === 're') {
            return new THREE.Vector3(
                center.x + radius * Math.cos(angle),
                center.y + radius * Math.sin(angle),
                center.z
            );
        }
        return new THREE.Vector3(
            center.x + radius * Math.cos(angle),
            center.y,
            center.z + radius * Math.sin(angle)
        );
    });
}

function windingPointToVector(point, center, plane) {
    const re = (point.real ?? point.re ?? 0) * FOURIER_RING_RADIUS;
    const im = (point.imag ?? point.im ?? 0) * FOURIER_RING_RADIUS;
    if (plane === 're') return new THREE.Vector3(center.x + re, center.y + im, center.z);
    return new THREE.Vector3(center.x + re, center.y, center.z + im);
}

function windingReferenceRadius(winding) {
    return Math.max(0.18, winding.maxRadius || 0);
}

function windingVectorStep(winding) {
    return Math.max(1, Math.floor(winding.points.length / 50));
}

function graphFourierSignal(samples, component, scale) {
    const requested = clamp(requireInteger(state.laplaceSamples, 'Graph transform sample count'), 32, 512);
    let source = samples;
    const firstInput = source[0]?.input;
    const lastInput = source.at(-1)?.input;
    if (finitePoint(firstInput) && finitePoint(lastInput)
        && Math.hypot(firstInput.re - lastInput.re, firstInput.im - lastInput.im) <= EPSILON) {
        source = source.slice(0, -1);
    }
    source = selectEvenly(source, requested);
    const timeWindow = Math.max(EPSILON,
        requireFiniteNumber(state.laplaceTimeWindow, 'Graph transform time window'));
    const amplitudeScale = clamp(
        requireFiniteNumber(state.laplaceAmplitude, 'Graph transform amplitude'), 0.1, 5);
    const traversalFrequency = clamp(
        requireFiniteNumber(state.laplaceFrequency, 'Graph transform frequency'), 0.1, 10);
    const signal = [];
    for (let index = 0; index < requested; index += 1) {
        const normalizedTime = requested <= 1 ? 0 : index / (requested - 1);
        const traversal = normalizedTime * timeWindow * traversalFrequency;
        const phase = traversal - Math.floor(traversal);
        const sourcePosition = phase * Math.max(0, source.length - 1);
        const leftIndex = Math.floor(sourcePosition);
        const rightIndex = Math.min(source.length - 1, leftIndex + 1);
        const left = source[leftIndex];
        const right = source[rightIndex];
        if (!isFiniteComplex(left?.output) || !isFiniteComplex(right?.output)) continue;
        const mix = sourcePosition - leftIndex;
        const value = lerp(left.output[component], right.output[component], mix);
        signal.push({
            t: normalizedTime * timeWindow,
            value: (value / Math.max(EPSILON, scale)) * amplitudeScale
        });
    }
    return signal;
}

function graphFourierWinding(samples, component, scale) {
    const signal = graphFourierSignal(samples, component, scale);
    if (signal.length < 2) return buildLaplaceWinding([]);
    return buildLaplaceWinding(signal, {
        sigma: 0,
        omega: requireFiniteNumber(state.laplaceOmega, 'Graph winding omega'),
        progress: requireFiniteNumber(state.laplaceAnimationTime, 'Graph winding progress')
    });
}

function graphFourierProgress(data) {
    const progress = clamp(requireFiniteNumber(state.laplaceAnimationTime, 'Graph winding progress'), 0, 1);
    const traversalFrequency = clamp(
        requireFiniteNumber(state.laplaceFrequency, 'Graph transform frequency'), 0.1, 10);
    const timeWindow = Math.max(EPSILON,
        requireFiniteNumber(state.laplaceTimeWindow, 'Graph transform time window'));
    const traversed = progress * timeWindow * traversalFrequency;
    const phase = traversed - Math.floor(traversed);
    const cursorProgress = progress === 1 && Math.abs(phase) <= EPSILON ? 1 : phase;
    const activeProgress = traversed >= 1 ? 1 : cursorProgress;
    const lastIndex = Math.max(0, data.samples.length - 1);
    const cursorIndex = Math.min(lastIndex, Math.max(0, Math.floor(cursorProgress * lastIndex)));
    const activeIndex = Math.min(lastIndex, Math.max(0, Math.floor(activeProgress * lastIndex)));
    return {
        progress,
        activeSamples: data.samples.slice(0, activeIndex + 1),
        cursorSample: data.samples[cursorIndex]
    };
}

class TransformationGraphRenderer {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-5, 5, 3, -3, 0.08, 5000);
        const cameraTarget = new THREE.Vector3(0.1, 0, 0);
        const cameraOffset = new THREE.Vector3(6.7, 4.9, 6.5).normalize().multiplyScalar(2000);
        this.camera.position.copy(cameraTarget).add(cameraOffset);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
            depth: true,
            stencil: false,
            preserveDrawingBuffer: true
        });
        this.renderer.setClearColor(BACKGROUND);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.syncPixelRatio();
        this.container.replaceChildren(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = false;
        this.controls.enablePan = true;
        this.controls.enableZoom = true;
        this.controls.zoomToCursor = true;
        this.controls.screenSpacePanning = true;
        this.controls.target.copy(cameraTarget);
        this.controls.update();
        this.controls.saveState();
        this.controls.addEventListener('change', () => this.render());

        this.contentGroup = new THREE.Group();
        this.scene.add(this.contentGroup);
        this.addLights();

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
        this.resize();
    }

    syncPixelRatio() {
        const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
        this.renderer.setPixelRatio(Math.min(ratio, 2.5));
    }

    addLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.34));
        this.scene.add(new THREE.HemisphereLight(0xe9f1ff, 0x050510, 1.55));

        const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
        keyLight.position.set(5, 7, 5);
        this.scene.add(keyLight);

        const rimLight = new THREE.DirectionalLight(0x8ed8ff, 1.15);
        rimLight.position.set(-5, 3, -5);
        this.scene.add(rimLight);
    }

    resize() {
        const width = this.container.clientWidth || 1;
        const height = this.container.clientHeight || 1;
        const aspect = width / height;
        let halfHeight = FRUSTUM_HEIGHT * 0.5;
        let halfWidth = halfHeight * aspect;
        if (halfWidth < FRUSTUM_MIN_HALF_WIDTH) {
            halfWidth = FRUSTUM_MIN_HALF_WIDTH;
            halfHeight = halfWidth / Math.max(0.1, aspect);
        }
        this.syncPixelRatio();
        this.camera.left = -halfWidth;
        this.camera.right = halfWidth;
        this.camera.top = halfHeight;
        this.camera.bottom = -halfHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
        this.render();
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    update(data) {
        if (!data) return;
        if (data.key === this.dataKey) {
            this.render();
            return;
        }

        const geometryKey = `${data.mode}|${data.geometryKey}`;
        const traceKey = `${geometryKey}|trace:${state.graphTraceEnabled ? 1 : 0}`;
        const selectionKey = data.mode === 'grid' || data.mode === 'locked-grid'
            ? `${geometryKey}|selection:${data.selectionKey}|box:${state.graphFocusBoxEnabled ? 1 : 0}`
            : `${geometryKey}|selection:off`;
        const fourierKey = state.graphFourierEnabled
            ? [
                geometryKey,
                state.laplaceFrequency,
                state.laplaceAmplitude,
                state.laplaceTimeWindow,
                state.laplaceSamples,
                state.laplaceOmega,
                state.laplaceAnimationTime
            ].join('|')
            : `${geometryKey}|fourier:off`;

        if (this.dataMode !== undefined && data.mode !== this.dataMode) {
            this.controls.reset();
        }
        this.dataMode = data.mode;
        this.dataKey = data.key;
        if (geometryKey !== this.geometryKey) {
            this.rebuildContent(data);
        } else {
            if (traceKey !== this.traceKey) {
                const traceGroup = this.replaceContentLayer('traceGroup');
                this.buildTraceContent(traceGroup, data);
            }
            if (selectionKey !== this.selectionKey) {
                const selectionGroup = this.replaceContentLayer('selectionGroup');
                this.buildSelectionContent(selectionGroup, data);
            }
            if (fourierKey !== this.fourierKey) {
                const fourierGroup = this.replaceContentLayer('fourierGroup');
                this.buildFourierContent(fourierGroup, data);
            }
        }
        this.geometryKey = geometryKey;
        this.traceKey = traceKey;
        this.selectionKey = selectionKey;
        this.fourierKey = fourierKey;
        this.render();
    }

    clearContent() {
        disposeThreeObject(this.contentGroup);
        this.scene.remove(this.contentGroup);
        this.contentGroup = new THREE.Group();
        this.baseGroup = new THREE.Group();
        this.traceGroup = new THREE.Group();
        this.selectionGroup = new THREE.Group();
        this.fourierGroup = new THREE.Group();
        this.contentGroup.add(this.baseGroup, this.traceGroup, this.selectionGroup, this.fourierGroup);
        this.scene.add(this.contentGroup);
    }

    replaceContentLayer(key) {
        const previous = this[key];
        if (previous) {
            disposeThreeObject(previous);
            this.contentGroup.remove(previous);
        }
        const next = new THREE.Group();
        this.contentGroup.add(next);
        this[key] = next;
        return next;
    }

    rebuildContent(data) {
        this.clearContent();
        this.buildBaseContent(this.baseGroup, data);
        this.buildTraceContent(this.traceGroup, data);
        this.buildSelectionContent(this.selectionGroup, data);
        this.buildFourierContent(this.fourierGroup, data);
    }

    buildBaseContent(group, data) {
        if (data.mode === 'locked-grid') {
            this.addLockedGridBase(group, data);
            return;
        }
        if (data.mode === 'grid') {
            this.addFullGridBase(group, data);
            return;
        }
        this.addReferenceFrame(group, data);
        this.addCurves(group, data);
    }

    buildTraceContent(group, data) {
        if (!state.graphTraceEnabled) return;
        if (data.mode === 'locked-grid') return;
        if (data.mode === 'grid') {
            this.addFullGridTrace(group, data);
            return;
        }
        this.addTrace(group, data);
    }

    buildSelectionContent(group, data) {
        if (!state.graphFocusBoxEnabled) return;
        if (data.mode === 'locked-grid') {
            const points = [
                ...connectedGraphPointsForSamples(data.lockedCurve.samples, data.lockedCurve, 're'),
                ...connectedGraphPointsForSamples(data.lockedCurve.samples, data.lockedCurve, 'im')
            ].filter(Boolean);
            if (points.length < 2) return;
            const bounds = new THREE.Box3().setFromPoints(points).expandByScalar(0.22);
            const size = bounds.getSize(new THREE.Vector3());
            const center = bounds.getCenter(new THREE.Vector3());
            const geometry = new THREE.BoxGeometry(
                Math.max(0.12, size.x),
                Math.max(0.12, size.y),
                Math.max(0.12, size.z)
            );
            const box = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
                color: FOCUS_BOX_COLOR,
                transparent: true,
                opacity: 0.018,
                side: THREE.DoubleSide,
                depthWrite: false
            }));
            box.position.copy(center);
            group.add(box);
            const outline = new THREE.LineSegments(
                new THREE.EdgesGeometry(geometry),
                new THREE.LineBasicMaterial({ color: FOCUS_BOX_COLOR, transparent: true, opacity: 0.22 })
            );
            outline.position.copy(center);
            group.add(outline);
            return;
        }
        if (data.mode !== 'grid' || data.selectedCurveIndex < 0) return;
        const laneZ = (data.selectedCurveIndex - (data.curves.length - 1) * 0.5) * FULL_GRID_FRAME_SPACING;
        const geometry = new THREE.BoxGeometry(
            INPUT_AXIS_HALF * 2 + 0.5,
            OUTPUT_AXIS_HALF * 2 + 0.5,
            DEPTH_AXIS_HALF * 2 + 0.5
        );
        const box = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
            color: 0x8ed8ff,
            transparent: true,
            opacity: 0.025,
            side: THREE.DoubleSide,
            depthWrite: false
        }));
        box.position.z = laneZ;
        group.add(box);

        const outline = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({ color: 0x8ed8ff, transparent: true, opacity: 0.14 })
        );
        outline.position.z = laneZ;
        group.add(outline);
    }

    buildFourierContent(group, data) {
        if (!state.graphFourierEnabled) return;
        if (data.mode === 'locked-grid') return;
        if (data.mode === 'grid') {
            this.addFullGridFourierWindings(group, data);
            return;
        }
        this.addFourierWindings(group, data);
    }

    addFullGridBase(group, data) {
        const x0 = -INPUT_AXIS_HALF;
        const x1 = INPUT_AXIS_HALF;
        const y0 = -OUTPUT_AXIS_HALF;
        const y1 = OUTPUT_AXIS_HALF;
        const z0 = -DEPTH_AXIS_HALF;
        const z1 = DEPTH_AXIS_HALF;
        const centerIndex = (data.curves.length - 1) * 0.5;
        const spacing = FULL_GRID_FRAME_SPACING;
        const inputAxes = [];
        const reAxes = [];
        const imAxes = [];
        const reGrid = [];
        const imGrid = [];
        const inputTicks = [];
        const reCurves = [];
        const imCurves = [];

        data.curves.forEach((curve, curveIndex) => {
            const laneZ = (curveIndex - centerIndex) * spacing;
            inputAxes.push([new THREE.Vector3(x0, 0, laneZ), new THREE.Vector3(x1, 0, laneZ)]);
            reAxes.push([new THREE.Vector3(x0, y0, laneZ), new THREE.Vector3(x0, y1, laneZ)]);
            imAxes.push([
                new THREE.Vector3(x0, 0, laneZ + z0),
                new THREE.Vector3(x0, 0, laneZ + z1)
            ]);

            for (let index = 0; index <= 8; index += 1) {
                const x = lerp(x0, x1, index / 8);
                reGrid.push([
                    new THREE.Vector3(x, y0, laneZ),
                    new THREE.Vector3(x, y1, laneZ)
                ]);
                imGrid.push([
                    new THREE.Vector3(x, 0, laneZ + z0),
                    new THREE.Vector3(x, 0, laneZ + z1)
                ]);
            }
            [-1, -0.5, 0, 0.5, 1].forEach(ratio => {
                reGrid.push([
                    new THREE.Vector3(x0, ratio * OUTPUT_AXIS_HALF, laneZ),
                    new THREE.Vector3(x1, ratio * OUTPUT_AXIS_HALF, laneZ)
                ]);
                imGrid.push([
                    new THREE.Vector3(x0, 0, laneZ + ratio * DEPTH_AXIS_HALF),
                    new THREE.Vector3(x1, 0, laneZ + ratio * DEPTH_AXIS_HALF)
                ]);
            });

            const tickCount = Math.min(MAX_TICK_LABELS, curve.samples.length);
            for (let index = 0; index < tickCount; index += 1) {
                const sampleIndex = tickCount === 1
                    ? 0
                    : Math.round((curve.samples.length - 1) * (index / (tickCount - 1)));
                const x = lerp(x0, x1, curve.samples[sampleIndex].t);
                inputTicks.push([
                    new THREE.Vector3(x, -0.07, laneZ),
                    new THREE.Vector3(x, 0.07, laneZ)
                ]);
            }

            const renderSamples = selectEvenly(curve.samples, FULL_GRID_SAMPLE_COUNT);
            appendPolylineSegments(
                reCurves,
                graphPointsForSamples(renderSamples, curve, 're', laneZ)
            );
            appendPolylineSegments(
                imCurves,
                graphPointsForSamples(renderSamples, curve, 'im', laneZ)
            );
            addLabel(group, curve.label, new THREE.Vector3(0, y1 + 0.36, laneZ), {
                color: 'rgba(235, 239, 250, 0.9)',
                height: 0.25,
                fontSize: 40,
                weight: 600
            });
        });

        addLineSegments(group, inputAxes, { color: AXIS_COLOR, opacity: 0.54 });
        addLineSegments(group, reAxes, { color: RE_COLOR, opacity: 0.86 });
        addLineSegments(group, imAxes, { color: IM_COLOR, opacity: 0.86 });
        addLineSegments(group, reGrid, { color: RE_COLOR, opacity: 0.1 });
        addLineSegments(group, imGrid, { color: IM_COLOR, opacity: 0.09 });
        addLineSegments(group, inputTicks, { color: INPUT_TICK_COLOR, opacity: 0.46 });
        addLineSegments(group, reCurves, { color: RE_COLOR });
        addLineSegments(group, imCurves, { color: IM_COLOR });

        if (data.curves.length) {
            const labelLane = (Math.floor(centerIndex) - centerIndex) * spacing;
            addLabel(group, 'Re', new THREE.Vector3(x0 - 0.3, y1 + 0.25, labelLane), {
                color: 'rgba(255, 222, 124, 0.9)',
                height: 0.24,
                fontSize: 42
            });
            addLabel(group, 'Im', new THREE.Vector3(x0 - 0.3, 0, labelLane + z1 + 0.27), {
                color: 'rgba(122, 219, 236, 0.9)',
                height: 0.24,
                fontSize: 42
            });
        }
    }

    addLockedGridBase(group, data) {
        this.addReferenceFrame(group, data);

        const crossingRe = [];
        const crossingIm = [];
        data.curves.forEach(curve => {
            if (!curve.locked) {
                appendPolylineSegments(
                    crossingRe,
                    connectedGraphPointsForSamples(curve.samples, curve, 're')
                );
                appendPolylineSegments(
                    crossingIm,
                    connectedGraphPointsForSamples(curve.samples, curve, 'im')
                );
            }
        });

        addLineSegments(group, crossingRe, { color: RE_COLOR, opacity: 0.72 });
        addLineSegments(group, crossingIm, { color: IM_COLOR, opacity: 0.72 });
        this.addCurves(group, data);

        const reIntersections = data.intersections
            .map(intersection => connectedGraphPointFor({
                input: intersection.input,
                output: intersection.output,
                t: intersection.t
            }, data.lockedCurve, 're'))
            .filter(Boolean);
        const imIntersections = data.intersections
            .map(intersection => connectedGraphPointFor({
                input: intersection.input,
                output: intersection.output,
                t: intersection.t
            }, data.lockedCurve, 'im'))
            .filter(Boolean);
        addPointCloud(group, reIntersections, {
            color: RE_COLOR,
            size: 5,
            opacity: 0.92
        });
        addPointCloud(group, imIntersections, {
            color: IM_COLOR,
            size: 5,
            opacity: 0.92
        });
        addPointCloud(group, [...reIntersections, ...imIntersections], {
            color: INTERSECTION_COLOR,
            size: 2.4,
            opacity: 0.98
        });
    }

    addFullGridTrace(group, data) {
        const traceSegments = [];
        const centerIndex = (data.curves.length - 1) * 0.5;
        const spacing = FULL_GRID_FRAME_SPACING;
        data.curves.forEach((curve, curveIndex) => {
            const laneZ = (curveIndex - centerIndex) * spacing;
            const samples = selectEvenly(curve.samples, FULL_GRID_SAMPLE_COUNT);
            appendPolylineSegments(
                traceSegments,
                graphPointsForSamples(samples, curve, 'trace', laneZ)
            );
        });
        addLineSegments(group, traceSegments, { color: TRACE_COLOR, opacity: 0.5 });
    }

    addReferenceFrame(group, data) {
        const x0 = -INPUT_AXIS_HALF;
        const x1 = INPUT_AXIS_HALF;
        const y0 = -OUTPUT_AXIS_HALF;
        const y1 = OUTPUT_AXIS_HALF;
        const z0 = -DEPTH_AXIS_HALF;
        const z1 = DEPTH_AXIS_HALF;

        addPlane(
            group,
            INPUT_AXIS_HALF * 2,
            OUTPUT_AXIS_HALF * 2,
            new THREE.Vector3(0, 0, 0),
            { x: 0, y: 0, z: 0 },
            RE_COLOR,
            0.025
        );
        addPlane(
            group,
            INPUT_AXIS_HALF * 2,
            DEPTH_AXIS_HALF * 2,
            new THREE.Vector3(0, 0, 0),
            { x: Math.PI / 2, y: 0, z: 0 },
            IM_COLOR,
            0.022
        );

        addSoftLine(group, new THREE.Vector3(x0, 0, 0), new THREE.Vector3(x1, 0, 0), {
            color: AXIS_COLOR,
            radius: AXIS_RADIUS,
            opacity: 0.52,
            emissive: AXIS_COLOR,
            emissiveIntensity: 0.02,
            roughness: 0.72
        });
        addSoftLine(group, new THREE.Vector3(x0, y0, 0), new THREE.Vector3(x0, y1, 0), {
            color: RE_COLOR,
            radius: AXIS_RADIUS,
            opacity: 0.92,
            emissive: RE_EMISSIVE,
            emissiveIntensity: 0.35
        });
        addSoftLine(group, new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x0, 0, z1), {
            color: IM_COLOR,
            radius: AXIS_RADIUS,
            opacity: 0.92,
            emissive: IM_EMISSIVE,
            emissiveIntensity: 0.35
        });

        for (let index = 0; index <= 8; index += 1) {
            const x = lerp(x0, x1, index / 8);
            addSoftLine(group, new THREE.Vector3(x, y0, 0), new THREE.Vector3(x, y1, 0), {
                color: GRID_COLOR,
                radius: GRID_RADIUS,
                opacity: 0.16,
                roughness: 0.9
            });
            addSoftLine(group, new THREE.Vector3(x, 0, z0), new THREE.Vector3(x, 0, z1), {
                color: GRID_COLOR,
                radius: GRID_RADIUS,
                opacity: 0.13,
                roughness: 0.9
            });
        }

        [-1, -0.5, 0, 0.5, 1].forEach(ratio => {
            addSoftLine(
                group,
                new THREE.Vector3(x0, ratio * OUTPUT_AXIS_HALF, 0),
                new THREE.Vector3(x1, ratio * OUTPUT_AXIS_HALF, 0),
                {
                    color: ratio === 0 ? RE_COLOR : GRID_COLOR,
                    radius: ratio === 0 ? GRID_RADIUS * 1.35 : GRID_RADIUS,
                    opacity: ratio === 0 ? 0.24 : 0.11,
                    roughness: 0.9
                }
            );
            addSoftLine(
                group,
                new THREE.Vector3(x0, 0, ratio * DEPTH_AXIS_HALF),
                new THREE.Vector3(x1, 0, ratio * DEPTH_AXIS_HALF),
                {
                    color: ratio === 0 ? IM_COLOR : GRID_COLOR,
                    radius: ratio === 0 ? GRID_RADIUS * 1.35 : GRID_RADIUS,
                    opacity: ratio === 0 ? 0.22 : 0.10,
                    roughness: 0.9
                }
            );
        });

        this.addInputTicks(group, data);
        this.addOutputTicks(group);

        addLabel(group, data.axisLabel || 'Input z', new THREE.Vector3(x1 + 0.68, -0.16, 0), {
            height: 0.34,
            fontSize: 48
        });
        addLabel(group, 'Re', new THREE.Vector3(x0 - 0.35, y1 + 0.38, 0), {
            color: 'rgba(255, 222, 124, 0.96)',
            height: 0.34,
            fontSize: 52
        });
        addLabel(group, 'Im', new THREE.Vector3(x0 - 0.35, 0, z1 + 0.38), {
            color: 'rgba(122, 219, 236, 0.96)',
            height: 0.34,
            fontSize: 52
        });
    }

    addInputTicks(group, data) {
        const count = Math.min(MAX_TICK_LABELS, data.samples.length);
        for (let index = 0; index < count; index += 1) {
            const sampleIndex = count === 1
                ? 0
                : Math.round((data.samples.length - 1) * (index / (count - 1)));
            const sample = data.samples[sampleIndex];
            const x = lerp(-INPUT_AXIS_HALF, INPUT_AXIS_HALF, sample.t);
            addSoftLine(group, new THREE.Vector3(x, -0.08, 0), new THREE.Vector3(x, 0.08, 0), {
                color: INPUT_TICK_COLOR,
                radius: GRID_RADIUS * 1.3,
                opacity: 0.54,
                roughness: 0.9
            });
            addLabel(group, formatComplexPoint(sample.input), new THREE.Vector3(x, -0.38, -0.32), {
                color: 'rgba(235, 239, 250, 0.74)',
                height: 0.22,
                fontSize: 34,
                weight: 500,
                maxWidth: 640
            });
        }
    }

    addOutputTicks(group) {
        [-1, 0, 1].forEach(ratio => {
            const y = ratio * OUTPUT_AXIS_HALF;
            const z = ratio * DEPTH_AXIS_HALF;

            addSoftLine(group, new THREE.Vector3(-INPUT_AXIS_HALF - 0.08, y, 0), new THREE.Vector3(-INPUT_AXIS_HALF + 0.08, y, 0), {
                color: RE_COLOR,
                radius: GRID_RADIUS * 1.25,
                opacity: 0.45,
                roughness: 0.85
            });

            addSoftLine(group, new THREE.Vector3(-INPUT_AXIS_HALF, 0, z - 0.08), new THREE.Vector3(-INPUT_AXIS_HALF, 0, z + 0.08), {
                color: IM_COLOR,
                radius: GRID_RADIUS * 1.25,
                opacity: 0.45,
                roughness: 0.85
            });
        });
    }

    addCurves(group, data) {
        const rePoints = graphPointsForSamples(data.samples, data, 're');
        const imPoints = graphPointsForSamples(data.samples, data, 'im');

        addSegmentedTube(group, rePoints, {
            color: RE_COLOR,
            radius: CURVE_RADIUS,
            glowRadius: CURVE_RADIUS * 2.6,
            glowOpacity: 0.14,
            emissive: RE_EMISSIVE,
            emissiveIntensity: 0.48,
            roughness: 0.24
        });
        addSegmentedTube(group, imPoints, {
            color: IM_COLOR,
            radius: CURVE_RADIUS,
            glowRadius: CURVE_RADIUS * 2.6,
            glowOpacity: 0.13,
            emissive: IM_EMISSIVE,
            emissiveIntensity: 0.48,
            roughness: 0.24
        });
    }

    addTrace(group, data) {
        const tracePoints = graphPointsForSamples(data.samples, data, 'trace');
        addSegmentedTube(group, tracePoints, {
            color: TRACE_COLOR,
            radius: TRACE_RADIUS,
            opacity: 0.54,
            glowRadius: TRACE_RADIUS * 2.4,
            glowOpacity: 0.08,
            emissive: 0x35415d,
            emissiveIntensity: 0.2,
            roughness: 0.5,
            metalness: 0
        });
    }

    addFullGridFourierWindings(group, data) {
        const rings = [];
        const windingPath = [];
        const windingColors = [];
        const spokes = [];
        const samplePoints = [];
        const centerOfMassVectors = [];
        const arrowHeads = [];
        const connectors = [];
        const activeGraph = [];
        const origins = [];
        const centerOfMassPoints = [];
        const cursors = [];
        const gradientColorsByPointCount = new Map();
        const centerIndex = (data.curves.length - 1) * 0.5;
        const spacing = FULL_GRID_FRAME_SPACING;

        data.curves.forEach((curve, curveIndex) => {
            const laneZ = (curveIndex - centerIndex) * spacing;
            const reScale = curve.fourierReScale;
            const imScale = curve.fourierImScale;
            const reWinding = graphFourierWinding(curve.samples, 're', reScale);
            const imWinding = graphFourierWinding(curve.samples, 'im', imScale);
            const maximumRadius = Math.max(
                0.18,
                windingReferenceRadius(reWinding) * FOURIER_RING_RADIUS,
                windingReferenceRadius(imWinding) * FOURIER_RING_RADIUS
            );
            const center = new THREE.Vector3(-INPUT_AXIS_HALF - maximumRadius - 0.34, 0, laneZ);
            origins.push(center);
            connectors.push([
                new THREE.Vector3(center.x + maximumRadius, 0, laneZ),
                new THREE.Vector3(-INPUT_AXIS_HALF, 0, laneZ)
            ]);

            [
                { winding: reWinding, plane: 're' },
                { winding: imWinding, plane: 'im' }
            ].forEach(({ winding, plane }) => {
                const radius = windingReferenceRadius(winding) * FOURIER_RING_RADIUS;
                appendPolylineSegments(rings, ringPoints(center, radius, plane));
                const points = winding.points.map(point => windingPointToVector(point, center, plane));
                let gradientColors = gradientColorsByPointCount.get(points.length);
                if (!gradientColors) {
                    gradientColors = Array.from({ length: Math.max(0, points.length - 1) }, (_, index) => {
                        const denominator = Math.max(1, points.length - 1);
                        const previousProgress = index / denominator;
                        const progress = (index + 1) / denominator;
                        return [
                            new THREE.Color().setHSL((280 + previousProgress * 60) / 360, 0.7, 0.65),
                            new THREE.Color().setHSL((280 + progress * 60) / 360, 0.7, 0.65)
                        ];
                    });
                    gradientColorsByPointCount.set(points.length, gradientColors);
                }
                for (let index = 1; index < points.length; index += 1) {
                    windingPath.push([points[index - 1], points[index]]);
                    windingColors.push(gradientColors[index - 1]);
                }
                for (let index = 0; index < points.length; index += windingVectorStep(winding)) {
                    spokes.push([center, points[index]]);
                }
                const pointStep = Math.max(1, Math.floor(points.length / 90));
                points.forEach((point, index) => {
                    if (index % pointStep === 0) samplePoints.push(point);
                });

                const integral = windingPointToVector(winding.integral, center, plane);
                centerOfMassPoints.push(integral);
                if (center.distanceToSquared(integral) > EPSILON) {
                    centerOfMassVectors.push([center, integral]);
                    arrowHeads.push(...lineArrowHeadSegments(center, integral, plane));
                }
            });

            const { progress, activeSamples, cursorSample } = graphFourierProgress(curve);
            if (progress < 1 - EPSILON) {
                appendPolylineSegments(
                    activeGraph,
                    graphPointsForSamples(activeSamples, curve, 're', laneZ)
                );
                appendPolylineSegments(
                    activeGraph,
                    graphPointsForSamples(activeSamples, curve, 'im', laneZ)
                );
            }
            const reCursor = graphPointFor(cursorSample, curve, 're', laneZ);
            const imCursor = graphPointFor(cursorSample, curve, 'im', laneZ);
            if (reCursor) cursors.push(reCursor);
            if (imCursor) cursors.push(imCursor);
        });

        addLineSegments(group, rings, { color: 0xc8dcff, opacity: 0.32 });
        addLineSegments(group, windingPath, { vertexColors: windingColors, opacity: 0.82 });
        addLineSegments(group, spokes, { color: 0x64b4ff, opacity: 0.24 });
        addPointCloud(group, samplePoints, { color: 0xff64c8, size: 6, opacity: 0.14 });
        addPointCloud(group, samplePoints, { color: 0xffa6df, size: 2.7, opacity: 0.94 });
        addLineSegments(group, centerOfMassVectors, { color: 0xffdc32, opacity: 0.94 });
        addLineSegments(group, arrowHeads, { color: 0xffdc32, opacity: 0.96 });
        addLineSegments(group, connectors, { color: AXIS_COLOR, opacity: 0.36 });
        addPointCloud(group, origins, { color: 0x8eb8ff, size: 7, opacity: 0.18 });
        addPointCloud(group, origins, { color: 0xeaf1ff, size: 3.2, opacity: 0.96 });
        addPointCloud(group, centerOfMassPoints, { color: 0xffdc32, size: 8, opacity: 0.2 });
        addPointCloud(group, centerOfMassPoints, { color: 0xffec8a, size: 3.6, opacity: 0.98 });
        addLineSegments(group, activeGraph, { color: 0xff7bcf, opacity: 0.65 });
        addPointCloud(group, cursors, { color: 0xff9add, size: 7, opacity: 0.2 });
        addPointCloud(group, cursors, { color: 0xffc1e8, size: 3, opacity: 0.96 });
    }

    addFourierWindings(group, data) {
        const reWinding = graphFourierWinding(data.samples, 're', data.fourierReScale);
        const imWinding = graphFourierWinding(data.samples, 'im', data.fourierImScale);
        const maximumRadius = Math.max(
            0.18,
            windingReferenceRadius(reWinding) * FOURIER_RING_RADIUS,
            windingReferenceRadius(imWinding) * FOURIER_RING_RADIUS
        );
        const center = new THREE.Vector3(-INPUT_AXIS_HALF - maximumRadius - 0.34, 0, 0);

        this.addFourierWindingPlane(group, reWinding, {
            center,
            plane: 're',
            label: 'F(Re)'
        });
        this.addFourierWindingPlane(group, imWinding, {
            center,
            plane: 'im',
            label: 'F(Im)'
        });

        const connector = [
            new THREE.Vector3(center.x + maximumRadius, center.y, center.z),
            new THREE.Vector3(-INPUT_AXIS_HALF, 0, 0)
        ];
        addSoftLine(group, connector[0], connector[1], {
            color: AXIS_COLOR,
            radius: GRID_RADIUS,
            opacity: 0.36,
            roughness: 0.9
        });
        addGlowMarker(group, center, 0x8eb8ff, 0.09, 0.18);
        addMarker(group, center, 0xeaf1ff, 0.038);
        this.addFourierSourceProgress(group, data);
    }

    addFourierWindingPlane(group, winding, { center, plane, label }) {
        const radius = windingReferenceRadius(winding) * FOURIER_RING_RADIUS;
        const ring = ringPoints(center, radius, plane);
        addSegmentedTube(group, ring, {
            color: 0x96b4ff,
            radius: 0.024,
            opacity: 0.075,
            emissive: 0x96b4ff,
            emissiveIntensity: 0.2,
            roughness: 0.9,
            metalness: 0
        });
        addPolyline(group, ring, { color: 0xc8dcff, opacity: 0.32 });

        const points = winding.points.map(point => windingPointToVector(point, center, plane));
        if (points.length > 1) {
            const segments = [];
            const colors = [];
            for (let index = 1; index < points.length; index += 1) {
                const progress = index / Math.max(1, points.length - 1);
                const previousProgress = (index - 1) / Math.max(1, points.length - 1);
                const startColor = new THREE.Color().setHSL((280 + previousProgress * 60) / 360, 0.7, 0.65);
                const endColor = new THREE.Color().setHSL((280 + progress * 60) / 360, 0.7, 0.65);
                segments.push([points[index - 1], points[index]]);
                colors.push([startColor, endColor]);
            }
            addLineSegments(group, segments, { vertexColors: colors, opacity: 0.82 });
        }

        const spokes = [];
        for (let index = 0; index < points.length; index += windingVectorStep(winding)) {
            spokes.push([center, points[index]]);
        }
        addLineSegments(group, spokes, { color: 0x64b4ff, opacity: 0.24 });

        const pointStep = Math.max(1, Math.floor(points.length / 90));
        const visiblePoints = points.filter((_point, index) => index % pointStep === 0);
        addPointCloud(group, visiblePoints, { color: 0xff64c8, size: 7, opacity: 0.14 });
        addPointCloud(group, visiblePoints, { color: 0xffa6df, size: 3.2, opacity: 0.94 });

        const integral = windingPointToVector(winding.integral, center, plane);
        if (center.distanceToSquared(integral) > EPSILON) {
            addSoftLine(group, center, integral, {
                color: 0xffdc32,
                radius: 0.018,
                glowRadius: 0.048,
                glowOpacity: 0.14,
                opacity: 0.94,
                emissive: 0xffb400,
                emissiveIntensity: 0.5,
                roughness: 0.3
            });
            addArrowHead(group, center, integral);
        }
        addGlowMarker(group, integral, 0xffdc32, 0.13, 0.2);
        addMarker(group, integral, 0xffdc32, 0.055);

        const labelPosition = plane === 're'
            ? new THREE.Vector3(center.x, center.y + radius + 0.2, center.z)
            : new THREE.Vector3(center.x, center.y, center.z + radius + 0.2);
        addLabel(group, label, labelPosition, {
            color: plane === 're' ? 'rgba(255, 222, 124, 0.9)' : 'rgba(122, 219, 236, 0.9)',
            height: 0.21,
            fontSize: 38
        });
    }

    addFourierSourceProgress(group, data) {
        const { progress, activeSamples, cursorSample } = graphFourierProgress(data);
        if (progress < 1 - EPSILON) {
            const reActive = graphPointsForSamples(activeSamples, data, 're');
            const imActive = graphPointsForSamples(activeSamples, data, 'im');
            addSegmentedPolyline(group, reActive, { color: 0xff7bcf, opacity: 0.68 });
            addSegmentedPolyline(group, imActive, { color: 0xff7bcf, opacity: 0.62 });
        }

        const reCursor = graphPointFor(cursorSample, data, 're');
        const imCursor = graphPointFor(cursorSample, data, 'im');
        if (reCursor) {
            addGlowMarker(group, reCursor, 0xff9add, 0.095, 0.18);
            addMarker(group, reCursor, 0xff9add, 0.035);
        }
        if (imCursor) {
            addGlowMarker(group, imCursor, 0xff9add, 0.095, 0.18);
            addMarker(group, imCursor, 0xff9add, 0.035);
        }
    }

    dispose() {
        this.resizeObserver?.disconnect();
        this.controls?.dispose?.();
        disposeThreeObject(this.scene);
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}

export function drawTransformationGraph(containerId = 'graph_3d_container') {
    if (typeof document === 'undefined') return;

    const column = document.getElementById('graph_column');
    const container = document.getElementById(containerId);
    const columnHidden = column?.classList.contains('hidden');

    if (!graphModeActive() || columnHidden || !container) {
        if (!graphModeActive() || columnHidden) disposeTransformationGraphRenderer();
        return;
    }

    const data = buildTransformationGraphData();
    if (!data || data.finiteCount === 0) {
        disposeTransformationGraphRenderer();
        container.replaceChildren();
        return;
    }

    if (!activeGraphRenderer) {
        activeGraphRenderer = new TransformationGraphRenderer(container);
    }

    activeGraphRenderer.update(data);
}

export function resizeTransformationGraphRenderer() {
    activeGraphRenderer?.resize();
}

export function disposeTransformationGraphRenderer() {
    graphDataCache = null;
    fullGridDataCache = null;
    if (!activeGraphRenderer) return;
    activeGraphRenderer.dispose();
    activeGraphRenderer = null;
}
