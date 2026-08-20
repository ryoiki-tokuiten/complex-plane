import { state as appState, zPlaneParams } from '../store/state.js';
import { runtime } from '../store/runtime.js';
import { eventBus } from '../store/events.js';
import {
    COLOR_PROBE_MARKER, COLOR_PROBE_NEIGHBORHOOD, COLOR_TEXT_ON_CANVAS,
    COLOR_CAUCHY_CONTOUR_Z, COLOR_CAUCHY_CONTOUR_W,
    COLOR_PARTICLE, COLOR_FOCI,
    COLOR_PROBE_CONFORMAL_LINE_W_H, COLOR_PROBE_CONFORMAL_LINE_W_V,
    COLOR_PROBE_CONFORMAL_LINE_Z_H, COLOR_PROBE_CONFORMAL_LINE_Z_V,
    STREAMLINE_COLOR_MIN_MAG, STREAMLINE_COLOR_MAX_MAG
} from '../constants/colors.js';
import {
    TWO_PI, MIN_POINTS_ADAPTIVE, DEFAULT_POINTS_PER_LINE, ZETA_POLE,
    ZETA_REFLECTION_POINT_RE, PROBE_CROSSHAIR_SIZE_FACTOR
} from '../constants/numerical.js';
import { LINE_WIDTH_NORMAL, PARTICLE_RADIUS } from '../constants/rendering.js';
import { mapToCanvasCoords } from '../utils/canvas-utils.js';
import { requireVisibleViewport } from '../utils/viewport.js';
import { requireFiniteNumber } from '../utils/numeric-contracts.js';
import {
    getMappedTransformProfile, nativeOptionsForActiveMap
} from '../native/map-runtime.js';
import {
    traceStreamlines, getStreamlineColorByMagnitude
} from '../analysis/streamline.js';
import {
    isRasterInputShape
} from '../utils/raster-media.js';
import { drawImageWithWebGL } from './draw-image-webgl.js';
import {
    generateCurrentInputShapePointSets,
    generateRadialDiscreteStepPointSets
} from './shape-generators.js';
import { hslToRgb } from './canvas-primitives.js';
import { filterGraphFullGridPointSets } from './transformation-graph.js';
import { surfaceStageHasBranches } from '../analysis/riemann-surface.js';
import {
    buildNativePlanarLine,
    buildNativePlanarLines,
    buildNativePlanarPolyline,
    buildNativeVectorField,
    evaluateNativePoints,
    nativeMapOptions,
    projectNativePrecisePixels,
    projectNativePrecisePixelsToCanvas,
    projectNativeValuesToPrecise
} from '../native/complex-engine.js';

const EPSILON = 1e-9;
const DEGENERATE_SEGMENT_EPSILON = 1e-12;
const STREAMLINE_COLOR_BUCKETS = 32;
const STREAMLINE_STEP_BUDGET = 12000;
const STREAMLINE_INTERACTION_STEP_BUDGET = 3500;
const STREAMLINE_MAX_STEPS_PER_PATH = 650;
const PROBE_NEIGHBORHOOD_SEGMENTS = 60;

const PROBE_MARKER_RADIUS = 5;
const CONSTANT_POINT_RADIUS = 7;
const FOCI_RADIUS = 4;
const PARTICLE_REFERENCE_FPS = 60;
const PARTICLE_MAX_DELTA_SECONDS = 0.05;
const ZETA_CURVE_MIN_SEGMENTS = 24;
const ZETA_CURVE_MAX_SEGMENTS = 768;
const ZETA_CURVE_MAX_DEPTH = 8;
const ZETA_CURVE_TOLERANCE_SQ = 2.25;
const ZETA_CURVE_MAX_SEGMENT_LENGTH_SQ = 24 * 24;

const streamlineProgressState = {
    key: null,
    nextSeedOffset: 0,
    redrawScheduled: false
};

const LINEAR_SOURCE_POINT_SET_ROLES = new Set([
    'grid-horizontal',
    'grid-vertical',
    'polar-angular',
    'logpolar-angular',
    'line-horizontal',
    'line-vertical'
]);

const PATH2D_MIN_POINTS = 64;
const STATIC_CURVE_TOLERANCE_PX_SQ = 0.001;
const INTERACTION_CURVE_TOLERANCE_PX_SQ = 1;
const STATIC_MAX_SEGMENT_PX_SQ = 4 * 4;
const INTERACTION_MAX_SEGMENT_PX_SQ = 36 * 36;
const MAX_TRANSFORM_SUBDIVISION_DEPTH = 16;

// One transformed-grid geometry pipeline is shared by every W-plane stage.
// Bulk evaluators accelerate sampling where available; all lines then use the
// same clipping, discontinuity detection, simplification, and cache semantics.
const TRANSFORM_GRID_RENDER_LIMIT_HEADROOM = 1.25;
const TRANSFORM_GRID_STATIC_TOLERANCE_SQ = 0.01;
const TRANSFORM_GRID_INTERACTION_TOLERANCE_SQ = 0.36;
const TRANSFORM_GRID_OUTPUT_SAMPLES = Math.max(DEFAULT_POINTS_PER_LINE, 512);
const TRANSFORM_GRID_INTERACTION_OUTPUT_SAMPLES = Math.max(DEFAULT_POINTS_PER_LINE, 256);
const transformGridGeometryCaches = new WeakMap();

function getPathConstructorForContext(ctx) {
    if (typeof Path2D !== 'function') throw new Error('Planar rendering requires Path2D.');
    if (!ctx || typeof ctx.stroke !== 'function') throw new Error('Planar rendering requires a 2D canvas context.');
    return Path2D;
}

const DEFAULT_COLOR_RESOLVER = pointSet => pointSet.color;
const DEFAULT_LINE_WIDTH_RESOLVER = pointSet => pointSet.lineWidth || LINE_WIDTH_NORMAL;
const IDENTITY_POINT_SET_PREPARE = pointSet => pointSet;

function hasFastCanvasMapping(planeParams) {
    return !!(
        planeParams &&
        planeParams.origin &&
        planeParams.scale &&
        isFiniteNumber(planeParams.origin.x) &&
        isFiniteNumber(planeParams.origin.y) &&
        isFiniteNumber(planeParams.scale.x) &&
        isFiniteNumber(planeParams.scale.y)
    );
}

function canvasXFast(re, planeParams) {
    return planeParams.origin.x + re * planeParams.scale.x;
}

function canvasYFast(im, planeParams) {
    return planeParams.origin.y - im * planeParams.scale.y;
}

function moveOrLineTo(ctx, pathOpen, x, y) {
    if (pathOpen) {
        ctx.lineTo(x, y);
        return true;
    }

    ctx.moveTo(x, y);
    return true;
}

function strokeOpenPath(ctx, pathOpen) {
    if (pathOpen) {
        ctx.stroke();
    }
    ctx.beginPath();
    return false;
}

function strokeComplexArrayOnPlane(ctx, planeParams, points) {
    const path = buildComplexPath2D(ctx, planeParams, points);
    if (path) {
        ctx.stroke(path);
        return;
    }

    const fastMap = hasFastCanvasMapping(planeParams);
    let pathOpen = false;

    ctx.beginPath();

    for (let i = 0, length = points.length; i < length; i++) {
        const point = points[i];

        if (!isRenderableComplexPoint(point)) {
            pathOpen = strokeOpenPath(ctx, pathOpen);
            continue;
        }

        if (fastMap) {
            pathOpen = moveOrLineTo(
                ctx,
                pathOpen,
                canvasXFast(point.re, planeParams),
                canvasYFast(point.im, planeParams)
            );
            continue;
        }

        const canvasPoint = mapToCanvasCoords(point.re, point.im, planeParams);
        if (isFiniteCanvasPoint(canvasPoint)) {
            pathOpen = moveOrLineTo(ctx, pathOpen, canvasPoint.x, canvasPoint.y);
        } else {
            pathOpen = strokeOpenPath(ctx, pathOpen);
        }
    }

    if (pathOpen) {
        ctx.stroke();
    }
}

function strokeCanvasPairs(ctx, points) {
    let open = false;
    ctx.beginPath();
    for (let index = 0; index < points.length; index += 2) {
        const x = points[index];
        const y = points[index + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            open = false;
            continue;
        }
        if (open) ctx.lineTo(x, y);
        else { ctx.moveTo(x, y); open = true; }
    }
    if (open) ctx.stroke();
}

function drawCanvasPointPairs(ctx, points, color, lineWidth) {
    ctx.fillStyle = color;
    const radius = Math.max(1.5, lineWidth * 0.75);
    for (let index = 0; index < points.length; index += 2) {
        const x = points[index];
        const y = points[index + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, TWO_PI);
        ctx.fill();
    }
}

function preciseMappedGeometry(pointSet, planeParams, mappedTransform, map) {
    const outputViewport = planeParams.preciseViewport && {
        ...planeParams.preciseViewport,
        width: planeParams.width,
        height: planeParams.height
    };
    const mapOptions = mappedTransform ? nativeMapOptions(appState, {
        functionKey: mappedTransform.functionKey,
        ...mappedTransform.nativeMapOptions,
        stage: map?.stage,
        derivativeOrder: map?.presentation === 'derivative' ? 1 : 0
    }) : nativeMapOptions(appState, { functionKey: 'identity', chainingEnabled: false, chainCount: 1 });
    if (pointSet.canvasPoints && zPlaneParams.preciseViewport) {
        const inputViewport = {
            ...zPlaneParams.preciseViewport,
            width: zPlaneParams.width,
            height: zPlaneParams.height
        };
        if (outputViewport) {
            return projectNativePrecisePixels({
                mapOptions,
                inputViewport,
                outputViewport,
                mapPoints: !!mappedTransform
            }, pointSet.canvasPoints);
        }
        if (mappedTransform) {
            return projectNativePrecisePixelsToCanvas({
                mapOptions,
                inputViewport,
                outputOrigin: planeParams.origin,
                outputScale: planeParams.scale,
                mapPoints: true
            }, pointSet.canvasPoints);
        }
        return pointSet.canvasPoints;
    }
    if (!outputViewport) return null;
    return projectNativeValuesToPrecise({
        mapOptions,
        outputViewport,
        mapPoints: !!mappedTransform
    }, pointSet.points);
}

function appendWorldPointToPath(ctx, planeParams, fastMap, pathOpen, re, im) {
    if (fastMap) {
        return moveOrLineTo(ctx, pathOpen, canvasXFast(re, planeParams), canvasYFast(im, planeParams));
    }

    const canvasPoint = mapToCanvasCoords(re, im, planeParams);
    return isFiniteCanvasPoint(canvasPoint)
        ? moveOrLineTo(ctx, pathOpen, canvasPoint.x, canvasPoint.y)
        : strokeOpenPath(ctx, pathOpen);
}

function buildPath2DFromComplexArray(PathCtor, planeParams, points) {
    const path = new PathCtor();
    let pathOpen = false;

    for (let i = 0, length = points.length; i < length; i++) {
        const point = points[i];

        if (!isRenderableComplexPoint(point)) {
            pathOpen = false;
            continue;
        }

        const x = canvasXFast(point.re, planeParams);
        const y = canvasYFast(point.im, planeParams);

        if (pathOpen) {
            path.lineTo(x, y);
        } else {
            path.moveTo(x, y);
            pathOpen = true;
        }
    }

    return path;
}

function buildComplexPath2D(ctx, planeParams, points) {
    if (!Array.isArray(points) || points.length < PATH2D_MIN_POINTS || !hasFastCanvasMapping(planeParams)) {
        return null;
    }
    return buildPath2DFromComplexArray(getPathConstructorForContext(ctx), planeParams, points);
}

function getAdaptiveTransformRenderTuning() {
    const interacting = isViewportManipulationActive();
    return {
        toleranceSq: interacting ? INTERACTION_CURVE_TOLERANCE_PX_SQ : STATIC_CURVE_TOLERANCE_PX_SQ,
        maxSegmentSq: interacting ? INTERACTION_MAX_SEGMENT_PX_SQ : STATIC_MAX_SEGMENT_PX_SQ,
        maxDepth: appState.chainingEnabled && appState.chainCount > 25
            ? 0
            : MAX_TRANSFORM_SUBDIVISION_DEPTH
    };
}

function buildAdaptiveTransformedPolyline(planeParams, mappedTransform, points, renderLimit, jumpThresholdSq, tuning, map = null) {
    return buildNativePlanarPolyline({
        map: nativeMapOptions(appState, {
            functionKey: mappedTransform.functionKey,
            ...mappedTransform.nativeMapOptions,
            stage: map?.stage,
            derivativeOrder: map?.presentation === 'derivative' ? 1 : 0
        }),
        points,
        originX: planeParams.origin.x,
        originY: planeParams.origin.y,
        scaleX: planeParams.scale.x,
        scaleY: planeParams.scale.y,
        renderLimit,
        jumpThresholdSq,
        toleranceSq: tuning.toleranceSq,
        maxSegmentSq: tuning.maxSegmentSq,
        maxDepth: tuning.maxDepth,
        hasBranchCuts: surfaceStageHasBranches(appState),
        branchCutType: appState.branchCutType,
        branchCutAngle: appState.branchCutAngle,
        branchCutPoints: appState.branchCutPoints
    });
}

function buildPath2DFromTransformedPolyline(PathCtor, polyline) {
    const path = new PathCtor();
    let open = false;
    for (let index = 0; index < polyline.length; index += 2) {
        const x = polyline[index];
        const y = polyline[index + 1];
        if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
            open = false;
            continue;
        }
        if (open) path.lineTo(x, y);
        else {
            path.moveTo(x, y);
            open = true;
        }
    }
    return path;
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getPlaneXRanges(planeParams) {
    return requireVisibleViewport(planeParams).currentVisXRange;
}

function getPlaneYRanges(planeParams) {
    return requireVisibleViewport(planeParams).currentVisYRange;
}

function isFiniteCanvasPoint(point) {
    return !!point && isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

function withSavedContext(ctx, draw) {
    ctx.save();
    try {
        return draw();
    } finally {
        ctx.restore();
    }
}

function configureRoundStroke(ctx, color, lineWidth) {
    if (color !== undefined) {
        ctx.strokeStyle = color;
    }
    if (lineWidth !== undefined) {
        ctx.lineWidth = lineWidth;
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
}

function setOptionalCanvasState(ctx, options) {
    if (options.lineDash && typeof ctx.setLineDash === 'function') {
        ctx.setLineDash(options.lineDash);
    }
    if (options.globalAlpha !== undefined) {
        ctx.globalAlpha = options.globalAlpha;
    }
}

function toCanvasPoint(point, planeParams) {
    return isRenderableComplexPoint(point)
        ? mapToCanvasCoords(point.re, point.im, planeParams)
        : null;
}

function drawCircleMarker(ctx, canvasPoint, radius, fillStyle, strokeStyle, lineWidth) {
    if (!isFiniteCanvasPoint(canvasPoint)) {
        return;
    }

    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, radius, 0, TWO_PI);

    if (fillStyle) {
        ctx.fillStyle = fillStyle;
        ctx.fill();
    }

    if (strokeStyle && lineWidth) {
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = strokeStyle;
        ctx.stroke();
    }
}

function drawWorldCircle(ctx, planeParams, center, radius, segments) {
    if (!isRenderableComplexPoint(center) || !isFiniteNumber(radius)) {
        return;
    }

    const pointCount = Math.max(3, Math.floor(requireFiniteNumber(segments, 'World-circle segment count')));
    const fastMap = hasFastCanvasMapping(planeParams);
    let pathOpen = false;

    ctx.beginPath();

    for (let i = 0; i <= pointCount; i++) {
        const angle = (i / pointCount) * TWO_PI;
        pathOpen = appendWorldPointToPath(
            ctx,
            planeParams,
            fastMap,
            pathOpen,
            center.re + radius * Math.cos(angle),
            center.im + radius * Math.sin(angle)
        );
    }

    if (pathOpen) {
        ctx.stroke();
    }
}

function isWithinComplexLimit(point, limit) {
    return isRenderableComplexPoint(point) &&
        Math.abs(point.re) <= limit &&
        Math.abs(point.im) <= limit;
}

function isCanvasPointNearViewport(point, planeParams) {
    if (!isFiniteCanvasPoint(point)) {
        return false;
    }

    const width = requireFiniteNumber(planeParams.width, 'Planar viewport width');
    const height = requireFiniteNumber(planeParams.height, 'Planar viewport height');
    const margin = Math.max(width, height) * 2;

    return point.x > -margin &&
        point.x < width + margin &&
        point.y > -margin &&
        point.y < height + margin;
}

function getTransformGridTuning() {
    const interacting = isViewportManipulationActive();
    return {
        toleranceSq: interacting ? TRANSFORM_GRID_INTERACTION_TOLERANCE_SQ : TRANSFORM_GRID_STATIC_TOLERANCE_SQ,
        outputSamples: interacting ? TRANSFORM_GRID_INTERACTION_OUTPUT_SAMPLES : TRANSFORM_GRID_OUTPUT_SAMPLES
    };
}

// The public render limit is an off-screen numerical safety guard, not a visual
// clip rectangle. Bucket it with modest headroom so translating the output
// viewport does not invalidate otherwise identical transformed geometry.
function getTransformGridRenderSafetyLimit(renderLimit) {
    if (!(renderLimit > 0) || !Number.isFinite(renderLimit)) return renderLimit;
    const requested = renderLimit * TRANSFORM_GRID_RENDER_LIMIT_HEADROOM;
    return 2 ** Math.ceil(Math.log2(requested));
}

function buildOriginRelativePath(PathCtor, points, scaleX, scaleY) {
    const path = new PathCtor();
    let open = false;
    for (let at = 0; at < points.length; at += 2) {
        const re = points[at];
        const im = points[at + 1];
        if (!Number.isFinite(re) || !Number.isFinite(im)) {
            open = false;
            continue;
        }
        const x = re * scaleX;
        const y = -im * scaleY;
        if (open) path.lineTo(x, y);
        else { path.moveTo(x, y); open = true; }
    }
    return path;
}

function createTransformGridGeometry(points) {
    return { points, path: null, pathConstructor: null };
}

function drawTransformGridGeometry(ctx, planeParams, geometry, color) {
    const points = geometry?.points || geometry;
    if (!points) return;
    ctx.strokeStyle = color;
    configureRoundStroke(ctx);

    const PathCtor = getPathConstructorForContext(ctx);
    if (!geometry || typeof ctx.translate !== 'function') {
        throw new Error('Transformed-grid rendering requires cached geometry and canvas transforms.');
    }
    if (!geometry.path || geometry.pathConstructor !== PathCtor) {
        geometry.path = buildOriginRelativePath(PathCtor, points, planeParams.scale.x, planeParams.scale.y);
        geometry.pathConstructor = PathCtor;
    }
    ctx.save();
    try {
        ctx.translate(planeParams.origin.x, planeParams.origin.y);
        ctx.stroke(geometry.path);
    } finally {
        ctx.restore();
    }
}

function getTransformGridGeometryCache(mappedTransform) {
    const cacheOwner = mappedTransform?.renderCacheOwner || mappedTransform;
    let cache = transformGridGeometryCaches.get(cacheOwner);
    if (!cache) {
        cache = new Map();
        transformGridGeometryCaches.set(cacheOwner, cache);
    }
    return cache;
}

function transformGridGeometryKey(start, end, sampleCount, planeParams, renderLimit, jumpThresholdSq, toleranceSq) {
    return `${sampleCount}|${start.re}|${start.im}|${end.re}|${end.im}|${planeParams.scale.x}|${planeParams.scale.y}|${renderLimit}|${jumpThresholdSq}|${toleranceSq}`;
}

function buildTransformGridGeometry(mappedTransform, start, end, sampleCount, planeParams, renderLimit, jumpThresholdSq, toleranceSq, map = null) {
    return buildNativePlanarLine({
        map: nativeMapOptions(appState, {
            functionKey: mappedTransform.functionKey,
            ...mappedTransform.nativeMapOptions,
            stage: map?.stage,
            derivativeOrder: map?.presentation === 'derivative' ? 1 : 0
        }),
        start,
        end,
        sampleCount,
        scaleX: planeParams.scale.x,
        scaleY: planeParams.scale.y,
        renderLimit,
        jumpThresholdSq,
        toleranceSq,
        hasBranchCuts: surfaceStageHasBranches(appState),
        branchCutType: appState.branchCutType,
        branchCutAngle: appState.branchCutAngle,
        branchCutPoints: appState.branchCutPoints
    });
}

function drawTransformedLinearPointSet(ctx, planeParams, mappedTransform, pointSet, color, map = null) {
    const endpoints = getPointSetEndpoints(pointSet);
    if (!endpoints) return false;

    const start = endpoints.start;
    const end = endpoints.end;
    const renderLimit = getTransformGridRenderSafetyLimit(getPlanarTransformRenderLimit(planeParams));
    const jumpThresholdSq = getViewportJumpThresholdSq(planeParams);
    const tuning = getTransformGridTuning();
    const sampleCount = tuning.outputSamples;
    const cache = getTransformGridGeometryCache(mappedTransform);
    const cacheKey = transformGridGeometryKey(
        start, end, sampleCount, planeParams, renderLimit, jumpThresholdSq, tuning.toleranceSq
    );
    const cached = cache.get(cacheKey);
    if (cached) {
        drawTransformGridGeometry(ctx, planeParams, cached, color);
        return true;
    }

    const points = buildTransformGridGeometry(
        mappedTransform, start, end, sampleCount, planeParams, renderLimit, jumpThresholdSq, tuning.toleranceSq, map
    );
    if (cache.size >= 2048) cache.clear();
    const entry = createTransformGridGeometry(points);
    cache.set(cacheKey, entry);
    drawTransformGridGeometry(ctx, planeParams, entry, color);
    return true;
}

function prepareNativeLinearGeometries(planeParams, mappedTransform, pointSets, startIndex, endIndex, map) {
    const renderLimit = getTransformGridRenderSafetyLimit(getPlanarTransformRenderLimit(planeParams));
    const jumpThresholdSq = getViewportJumpThresholdSq(planeParams);
    const tuning = getTransformGridTuning();
    const sampleCount = tuning.outputSamples;
    const cache = getTransformGridGeometryCache(mappedTransform);
    const missing = [];
    for (let index = startIndex; index < endIndex; index += 1) {
        const pointSet = pointSets[index];
        if (!pointSet || !LINEAR_SOURCE_POINT_SET_ROLES.has(pointSet.role) || !Array.isArray(pointSet.points)) continue;
        const endpoints = getPointSetEndpoints(pointSet);
        if (!endpoints) continue;
        const cacheKey = transformGridGeometryKey(
            endpoints.start, endpoints.end, sampleCount, planeParams,
            renderLimit, jumpThresholdSq, tuning.toleranceSq
        );
        if (!cache.has(cacheKey)) missing.push({ ...endpoints, sampleCount, cacheKey });
    }
    if (!missing.length) return;
    const geometries = buildNativePlanarLines({
        map: nativeMapOptions(appState, {
            functionKey: mappedTransform.functionKey,
            ...mappedTransform.nativeMapOptions,
            stage: map?.stage,
            derivativeOrder: map?.presentation === 'derivative' ? 1 : 0
        }),
        lines: missing,
        scaleX: planeParams.scale.x,
        scaleY: planeParams.scale.y,
        renderLimit,
        jumpThresholdSq,
        toleranceSq: tuning.toleranceSq,
        hasBranchCuts: surfaceStageHasBranches(appState),
        branchCutType: appState.branchCutType,
        branchCutAngle: appState.branchCutAngle,
        branchCutPoints: appState.branchCutPoints
    });
    if (cache.size + geometries.length >= 2048) cache.clear();
    for (let index = 0; index < geometries.length; index += 1) {
        cache.set(missing[index].cacheKey, createTransformGridGeometry(geometries[index]));
    }
}


function getViewportJumpThresholdSq(planeParams) {
    const xRange = getPlaneXRanges(planeParams);
    const yRange = getPlaneYRanges(planeParams);
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];

    return (spanX * spanX + spanY * spanY) * 4;
}

function getFirstVisibleColor(pointSets, colorResolver) {
    if (!Array.isArray(pointSets)) throw new Error('Point-set rendering requires an array.');
    const pointSet = pointSets.find(candidate => candidate && colorResolver(candidate));
    if (!pointSet) throw new Error('Constant-map rendering requires a visible point-set color.');
    return colorResolver(pointSet);
}

function createGridSeeds(planeParams, renderState) {
    const xRange = getPlaneXRanges(planeParams);
    const yRange = getPlaneYRanges(planeParams);
    const densityValue = Math.min(40, requireFiniteNumber(
        renderState.gridDensity * renderState.streamlineSeedDensityFactor,
        'Streamline seed density'
    ));
    const rows = Math.max(2, Math.floor(densityValue));
    const cols = rows;
    const seeds = [];

    for (let row = 0; row <= rows; row++) {
        const y = yRange[0] + (row / rows) * (yRange[1] - yRange[0]);

        for (let col = 0; col <= cols; col++) {
            const x = xRange[0] + (col / cols) * (xRange[1] - xRange[0]);
            seeds.push(x, y);
        }
    }

    return seeds;
}

function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function getStreamlineProgressKey(planeParams, renderState, options) {
    if (options && typeof options.cacheKey === 'string') {
        return options.cacheKey;
    }

    const xRange = getPlaneXRanges(planeParams);
    const yRange = getPlaneYRanges(planeParams);

    return [
        renderState.currentFunction,
        renderState.vectorFieldFunction,
        requireFiniteNumber(renderState.streamlineStepSize, 'Streamline step size'),
        requireFiniteNumber(renderState.streamlineMaxLength, 'Streamline maximum length'),
        requireFiniteNumber(renderState.streamlineSeedDensityFactor, 'Streamline seed-density factor'),
        xRange[0],
        xRange[1],
        yRange[0],
        yRange[1],
        planeParams.width,
        planeParams.height
    ].join('|');
}

function resetStreamlineProgress(key) {
    streamlineProgressState.key = key;
    streamlineProgressState.nextSeedOffset = 0;
}

function getStreamlineRenderBudget() {
    const interacting = isInteractionActive();

    return {
        stepBudget: interacting ? STREAMLINE_INTERACTION_STEP_BUDGET : STREAMLINE_STEP_BUDGET
    };
}

function scheduleStreamlineProgressRedraw() {
    if (streamlineProgressState.redrawScheduled) {
        return;
    }

    streamlineProgressState.redrawScheduled = true;
    const request = () => {
        streamlineProgressState.redrawScheduled = false;
        eventBus.emit('redraw:all');
    };

    if (typeof setTimeout === 'function') {
        setTimeout(request, 0);
    } else {
        request();
    }
}

function getBucketIndex(magnitude, minMagnitude, magnitudeRange) {
    const normalized = clamp((magnitude - minMagnitude) / magnitudeRange, 0, 1);
    return Math.round(normalized * STREAMLINE_COLOR_BUCKETS);
}

function syncParticlePool(renderState, planeParams) {
    const particles = runtime.particles;
    const targetDensity = Math.max(0, Math.floor(requireFiniteNumber(
        renderState.particleDensity,
        'Particle density'
    )));

    if (particles.length < targetDensity) {
        const xRange = getPlaneXRanges(planeParams);
        const yRange = getPlaneYRanges(planeParams);
        const minX = xRange[0];
        const minY = yRange[0];
        const spanX = xRange[1] - minX;
        const spanY = yRange[1] - minY;

        for (let i = particles.length; i < targetDensity; i++) {
            particles.push({
                x: minX + Math.random() * spanX,
                y: minY + Math.random() * spanY,
                lifetime: 0
            });
        }
    } else if (particles.length > targetDensity) {
        particles.length = targetDensity;
    }
}

function getParticleSpeed(planeParams, renderState) {
    const xRange = getPlaneXRanges(planeParams);
    const yRange = getPlaneYRanges(planeParams);
    const viewSpan = Math.max(xRange[1] - xRange[0], yRange[1] - yRange[0]);

    return requireFiniteNumber(renderState.particleSpeed, 'Particle speed') *
        viewSpan * 0.1 * PARTICLE_REFERENCE_FPS;
}

function getParticleDeltaSeconds(timestamp) {
    const now = isFiniteNumber(timestamp) ? timestamp : nowMs();
    const previous = runtime.particlesLastUpdateTime;
    runtime.particlesLastUpdateTime = now;

    if (!isFiniteNumber(previous) || now < previous) {
        return 0;
    }

    return clamp((now - previous) / 1000, 0, PARTICLE_MAX_DELTA_SECONDS);
}

function getProbeCrosshairEndpoints(center, radius) {
    return {
        horizontal: [
            { re: center.re - radius, im: center.im },
            { re: center.re + radius, im: center.im }
        ],
        vertical: [
            { re: center.re, im: center.im - radius },
            { re: center.re, im: center.im + radius }
        ]
    };
}

function drawProbeSegment(ctx, planeParams, startWorld, endWorld, color) {
    const startIsValid = isRenderableComplexPoint(startWorld);
    const endIsValid = isRenderableComplexPoint(endWorld);

    if (!startIsValid || !endIsValid) {
        return;
    }

    const startCanvas = mapToCanvasCoords(startWorld.re, startWorld.im, planeParams);
    const endCanvas = mapToCanvasCoords(endWorld.re, endWorld.im, planeParams);

    if (!isCanvasPointNearViewport(startCanvas, planeParams) ||
        !isCanvasPointNearViewport(endCanvas, planeParams)) {
        return;
    }

    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(startCanvas.x, startCanvas.y);
    ctx.lineTo(endCanvas.x, endCanvas.y);
    ctx.stroke();
}

function isInteractionActive() {
    return !!(
        runtime.interaction.panZ.isPanning ||
        runtime.interaction.panW.isPanning ||
        appState.particleAnimationEnabled
    );
}

function isViewportManipulationActive() {
    return !!(
        runtime.interaction.panZ.isPanning ||
        runtime.interaction.panW.isPanning
    );
}

function probeNeighborhoodPoints(center, radius) {
    return Array.from({ length: PROBE_NEIGHBORHOOD_SEGMENTS + 1 }, (_, index) => {
        const angle = (index / PROBE_NEIGHBORHOOD_SEGMENTS) * TWO_PI;
        return {
            re: center.re + radius * Math.cos(angle),
            im: center.im + radius * Math.sin(angle)
        };
    });
}

function drawMappedProbeNeighborhood(ctx, planeParams, mappedPoints, renderLimit) {
    if (!Array.isArray(mappedPoints)) {
        return;
    }

    const fastMap = hasFastCanvasMapping(planeParams);
    let pathOpen = false;
    let pathWasBroken = false;

    ctx.beginPath();

    for (const wPoint of mappedPoints) {
        if (!isWithinComplexLimit(wPoint, renderLimit)) {
            pathOpen = strokeOpenPath(ctx, pathOpen);
            pathWasBroken = true;
            continue;
        }

        pathOpen = appendWorldPointToPath(ctx, planeParams, fastMap, pathOpen, wPoint.re, wPoint.im);
    }

    if (pathOpen) {
        if (!pathWasBroken) {
            ctx.closePath();
        }
        ctx.stroke();
    }
}

function getArrowColorFromComponents(re, im, brightness) {
    const phase = Math.atan2(im, re);
    let hue = (phase / TWO_PI) % 1.0;

    if (hue < 0) {
        hue += 1.0;
    }

    const magnitude = Math.sqrt(re * re + im * im);
    const lightness = clamp(0.35 + Math.log(1.0 + magnitude) * 0.08 * brightness, 0.2, 0.85);

    const rgb = hslToRgb(hue, 0.85, lightness);
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

export function isRenderableComplexPoint(point) {
    return !!(
        point &&
        isFiniteNumber(point.re) &&
        isFiniteNumber(point.im)
    );
}

export function drawComplexLineSetOnPlane(ctx, planeParams, points) {
    if (Array.isArray(points)) strokeComplexArrayOnPlane(ctx, planeParams, points);
}

export function drawPointSetCollectionOnPlane(ctx, planeParams, pointSets, options = {}) {
    if (!Array.isArray(pointSets) || pointSets.length === 0) {
        return;
    }

    const colorResolver = options.colorResolver || DEFAULT_COLOR_RESOLVER;
    const lineWidthResolver = options.lineWidthResolver || DEFAULT_LINE_WIDTH_RESOLVER;
    const preparePointSet = options.preparePointSet || IDENTITY_POINT_SET_PREPARE;
    const transformFunc = options.transformFunc || null;
    const mappedTransform = options.transformProfile ||
        (transformFunc ? getMappedTransformProfile(appState.currentFunction, transformFunc) : null);
    const startIndex = clamp(Math.floor(options.startIndex === undefined
        ? 0
        : requireFiniteNumber(options.startIndex, 'Point-set start index')), 0, pointSets.length);
    const endIndex = clamp(Math.floor(options.endIndex === undefined
        ? pointSets.length
        : requireFiniteNumber(options.endIndex, 'Point-set end index')), startIndex, pointSets.length);

    if (mappedTransform && !mappedTransform.isConstant) {
        prepareNativeLinearGeometries(planeParams, mappedTransform, pointSets, startIndex, endIndex, options.map);
    }

    withSavedContext(ctx, () => {
        configureRoundStroke(ctx);
        setOptionalCanvasState(ctx, options);

        if (mappedTransform && mappedTransform.isConstant) {
            const color = getFirstVisibleColor(
                pointSets,
                colorResolver
            );
            drawConstantMappedPoint(ctx, planeParams, mappedTransform.constantValue, color);
            return;
        }

        for (let i = startIndex; i < endIndex; i++) {
            const sourcePointSet = pointSets[i];
            const preciseGeometry = sourcePointSet && (planeParams.preciseViewport ||
                (mappedTransform && sourcePointSet.canvasPoints && zPlaneParams.preciseViewport))
                ? preciseMappedGeometry(sourcePointSet, planeParams, mappedTransform, options.map)
                : null;
            if (preciseGeometry) {
                const color = colorResolver(sourcePointSet);
                const lineWidth = lineWidthResolver(sourcePointSet);
                if (!color || !lineWidth) continue;
                ctx.lineWidth = lineWidth;
                ctx.strokeStyle = color;
                if (sourcePointSet.role === 'grid-dots') {
                    drawCanvasPointPairs(ctx, preciseGeometry, color, lineWidth);
                } else {
                    strokeCanvasPairs(ctx, preciseGeometry);
                }
                continue;
            }
            if (mappedTransform && sourcePointSet &&
                LINEAR_SOURCE_POINT_SET_ROLES.has(sourcePointSet.role) && Array.isArray(sourcePointSet.points)) {
                const color = colorResolver(sourcePointSet);
                const lineWidth = lineWidthResolver(sourcePointSet);
                if (color && lineWidth) {
                    ctx.lineWidth = lineWidth;
                    drawTransformedLinearPointSet(ctx, planeParams, mappedTransform, sourcePointSet, color, options.map);
                }
                continue;
            }

            const preparedPointSet = preparePointSet(sourcePointSet, transformFunc, planeParams);

            if (!preparedPointSet || !Array.isArray(preparedPointSet.points)) {
                continue;
            }

            const color = colorResolver(preparedPointSet);
            const lineWidth = lineWidthResolver(preparedPointSet);

            if (!color || !lineWidth) {
                continue;
            }

            ctx.lineWidth = lineWidth;

            if (preparedPointSet.role === 'grid-dots') {
                ctx.fillStyle = color;
                const radius = Math.max(1.5, lineWidth * 0.75);
                const mappedPoints = mappedTransform
                    ? evaluateNativePoints(nativeOptionsForActiveMap(options.map), preparedPointSet.points).values
                    : preparedPointSet.points;
                for (const mapped of mappedPoints) {
                    if (!mapped || !Number.isFinite(mapped.re) || !Number.isFinite(mapped.im)) continue;
                    const canvasPoint = mapToCanvasCoords(mapped.re, mapped.im, planeParams);
                    ctx.beginPath();
                    ctx.arc(canvasPoint.x, canvasPoint.y, radius, 0, Math.PI * 2);
                    ctx.fill();
                }
                continue;
            }

            if (mappedTransform) {
                drawPlanarTransformedLine(ctx, planeParams, mappedTransform, preparedPointSet.points, color, options.map);
            } else {
                ctx.strokeStyle = color;
                strokeComplexArrayOnPlane(ctx, planeParams, preparedPointSet.points);
            }
        }
    });
}

export function drawRadialDiscreteSteps(ctx, planeParams, currentFunctionKey, stepsCount) {
    const generatedPointSets = generateRadialDiscreteStepPointSets(currentFunctionKey, stepsCount);
    const radialPointSets = [];

    for (let i = 0, length = generatedPointSets.length; i < length; i++) {
        const pointSet = generatedPointSets[i];
        const points = pointSet && pointSet.points;
        let radiusPoint = null;

        if (Array.isArray(points)) {
            for (let j = 0, pointCount = points.length; j < pointCount; j++) {
                if (points[j]) {
                    radiusPoint = points[j];
                    break;
                }
            }
        }

        if (radiusPoint && Math.abs(radiusPoint.re * planeParams.scale.x) >= 0.5) {
            radialPointSets.push(pointSet);
        }
    }

    drawPointSetCollectionOnPlane(ctx, planeParams, radialPointSets, {
        lineDash: [4, 4]
    });
}

export function drawStreamlinesOnZPlane(ctx, planeParams, state, map, options = null) {
    const progressKey = getStreamlineProgressKey(planeParams, state, options);
    if (options?.fresh || streamlineProgressState.key !== progressKey) {
        resetStreamlineProgress(progressKey);
    }

    let completed = true;

    withSavedContext(ctx, () => {
        ctx.lineWidth = state.streamlineThickness;
        configureRoundStroke(ctx);

        const seeds = createGridSeeds(planeParams, state);
        const seedStartOffset = Math.min(
            streamlineProgressState.nextSeedOffset,
            Math.max(0, seeds.length - (seeds.length % 2))
        );
        const minMagnitude = STREAMLINE_COLOR_MIN_MAG;
        const magnitudeRange = Math.max(EPSILON, STREAMLINE_COLOR_MAX_MAG - minMagnitude);
        const buckets = Array.from(
            { length: STREAMLINE_COLOR_BUCKETS + 1 },
            () => []
        );

        const budget = getStreamlineRenderBudget();
        const maxSteps = Math.min(STREAMLINE_MAX_STEPS_PER_PATH, state.streamlineMaxLength);
        const pathBudget = Math.max(1, Math.floor(budget.stepBudget / Math.max(1, maxSteps)));
        const seedEndOffset = Math.min(seeds.length, seedStartOffset + pathBudget * 2);
        const seedBatch = [];
        for (let offset = seedStartOffset; offset < seedEndOffset; offset += 2) {
            seedBatch.push({ x: seeds[offset], y: seeds[offset + 1] });
        }
        const paths = traceStreamlines(seedBatch, nativeOptionsForActiveMap(map), planeParams, state, { maxSteps });
        const nextSeedOffset = seedEndOffset;

        for (const path of paths) {

            if (!Array.isArray(path) || path.length < 2) {
                continue;
            }

            for (let k = 0; k < path.length - 1; k++) {
                const start = mapToCanvasCoords(path[k].x, path[k].y, planeParams);
                const end = mapToCanvasCoords(path[k + 1].x, path[k + 1].y, planeParams);
                const bucketIndex = getBucketIndex(path[k].magnitude, minMagnitude, magnitudeRange);

                if (isFiniteCanvasPoint(start) && isFiniteCanvasPoint(end)) {
                    buckets[bucketIndex].push(start.x, start.y, end.x, end.y);
                }
            }
        }

        streamlineProgressState.nextSeedOffset = nextSeedOffset;
        if (nextSeedOffset < seeds.length) {
            completed = false;
        }

        for (let bucketIndex = 0; bucketIndex <= STREAMLINE_COLOR_BUCKETS; bucketIndex++) {
            const segments = buckets[bucketIndex];

            if (segments.length === 0) {
                continue;
            }

            ctx.strokeStyle = getStreamlineColorByMagnitude(
                minMagnitude + (bucketIndex / STREAMLINE_COLOR_BUCKETS) * magnitudeRange
            );
            ctx.beginPath();

            for (let i = 0; i < segments.length; i += 4) {
                ctx.moveTo(segments[i], segments[i + 1]);
                ctx.lineTo(segments[i + 2], segments[i + 3]);
            }

            ctx.stroke();
        }
    });

    if (!completed) {
        scheduleStreamlineProgressRedraw();
    }

    return completed;
}

export function drawPlanarInputShape(ctx, planeParams) {
    const inputShape = appState.currentInputShape;

    if (isRasterInputShape(inputShape)) {
        drawImageWithWebGL(ctx, planeParams, false);
        return;
    }

    const generatedPointSets = generateCurrentInputShapePointSets(planeParams, {
        currentFunction: appState.currentFunction,
        zetaContinuationEnabled: appState.zetaContinuationEnabled
    });
    const pointSets = appState.graphFullGridEnabled
        ? filterGraphFullGridPointSets(generatedPointSets)
        : generatedPointSets;
    const highlightContour = appState.cauchyIntegralModeEnabled &&
        (inputShape === 'circle' || inputShape === 'ellipse' || inputShape === 'arbitrary');

    drawPointSetCollectionOnPlane(ctx, planeParams, pointSets, {
        colorResolver: pointSet => highlightContour && (pointSet.role === 'shape-curve' || pointSet.role === 'shape-arbitrary')
            ? COLOR_CAUCHY_CONTOUR_Z
            : pointSet.color,
        lineWidthResolver: pointSet => highlightContour && (pointSet.role === 'shape-curve' || pointSet.role === 'shape-arbitrary')
            ? 3.5
            : (pointSet.lineWidth || LINE_WIDTH_NORMAL)
    });
}

export function updateAndDrawParticles(ctx, planeParams, state, map, timestamp = null) {
    if (!state.particleAnimationEnabled) {
        runtime.particles.length = 0;
        runtime.particlesLastUpdateTime = null;
        return;
    }

    syncParticlePool(state, planeParams);

    withSavedContext(ctx, () => {
        ctx.fillStyle = COLOR_PARTICLE;
        ctx.beginPath();

        const deltaSeconds = getParticleDeltaSeconds(timestamp);
        const distance = getParticleSpeed(planeParams, state) * deltaSeconds;
        const xRange = getPlaneXRanges(planeParams);
        const yRange = getPlaneYRanges(planeParams);
        const minX = xRange[0];
        const maxX = xRange[1];
        const minY = yRange[0];
        const maxY = yRange[1];
        const spawnSpanX = maxX - minX;
        const spawnSpanY = maxY - minY;
        const maxLifetime = Math.max(
            0,
            requireFiniteNumber(state.particleMaxLifetime, 'Particle maximum lifetime')
        ) / PARTICLE_REFERENCE_FPS;
        const fastMap = hasFastCanvasMapping(planeParams);
        const particles = runtime.particles;
        const paths = distance > 0 ? traceStreamlines(
            particles.map(particle => ({ x: particle.x, y: particle.y })),
            nativeOptionsForActiveMap(map),
            planeParams,
            { ...state, streamlineStepSize: distance / Math.max(xRange[1] - xRange[0], yRange[1] - yRange[0]) / 0.1,
                streamlineMaxLength: 2 },
            { maxSteps: 2 }
        ) : particles.map(() => []);

        for (let i = 0, length = particles.length; i < length; i++) {
            const particle = particles[i];
            particle.lifetime = requireFiniteNumber(particle.lifetime, 'Particle lifetime') + deltaSeconds;
            const path = paths[i];
            const alive = path.length >= 2;
            if (alive) {
                particle.x = path[1].x;
                particle.y = path[1].y;
            }

            if (!alive ||
                particle.lifetime > maxLifetime ||
                particle.x < minX ||
                particle.x > maxX ||
                particle.y < minY ||
                particle.y > maxY ||
                !Number.isFinite(particle.x) ||
                !Number.isFinite(particle.y)) {
                particle.x = minX + Math.random() * spawnSpanX;
                particle.y = minY + Math.random() * spawnSpanY;
                particle.lifetime = 0;
            }

            const canvasX = fastMap ? canvasXFast(particle.x, planeParams) : mapToCanvasCoords(particle.x, particle.y, planeParams).x;
            const canvasY = fastMap ? canvasYFast(particle.y, planeParams) : mapToCanvasCoords(particle.x, particle.y, planeParams).y;

            if (
                canvasX >= 0 &&
                canvasX <= planeParams.width &&
                canvasY >= 0 &&
                canvasY <= planeParams.height
            ) {
                ctx.moveTo(canvasX + PARTICLE_RADIUS, canvasY);
                ctx.arc(canvasX, canvasY, PARTICLE_RADIUS, 0, TWO_PI);
            }
        }

        ctx.fill();
    });
}

export function drawConformalityProbeSegments(ctx, planeParams, center_world) {
    if (!isRenderableComplexPoint(center_world)) {
        return;
    }

    const segmentRadius = appState.probeNeighborhoodSize / PROBE_CROSSHAIR_SIZE_FACTOR;
    const endpoints = getProbeCrosshairEndpoints(center_world, segmentRadius);

    withSavedContext(ctx, () => {
        configureRoundStroke(ctx, undefined, 2);
        drawProbeSegment(ctx, planeParams, endpoints.horizontal[0], endpoints.horizontal[1], COLOR_PROBE_CONFORMAL_LINE_Z_H);
        drawProbeSegment(ctx, planeParams, endpoints.vertical[0], endpoints.vertical[1], COLOR_PROBE_CONFORMAL_LINE_Z_V);
    });
}

export function drawPlanarProbe(ctx, planeParams) {
    if (!isRenderableComplexPoint(appState.probeZ)) {
        return;
    }

    withSavedContext(ctx, () => {
        const probeCanvas = mapToCanvasCoords(appState.probeZ.re, appState.probeZ.im, planeParams);
        drawCircleMarker(ctx, probeCanvas, PROBE_MARKER_RADIUS, COLOR_PROBE_MARKER);

        configureRoundStroke(ctx, COLOR_PROBE_NEIGHBORHOOD, 1.5);
        drawWorldCircle(
            ctx,
            planeParams,
            appState.probeZ,
            appState.probeNeighborhoodSize,
            PROBE_NEIGHBORHOOD_SEGMENTS
        );

        drawConformalityProbeSegments(ctx, planeParams, appState.probeZ);
    });
}

export function getPlanarTransformRenderLimit(planeParams) {
    const xRange = getPlaneXRanges(planeParams);
    const yRange = getPlaneYRanges(planeParams);

    return Math.max(
        1,
        Math.abs(xRange[0]),
        Math.abs(xRange[1]),
        Math.abs(yRange[0]),
        Math.abs(yRange[1])
    ) * 10;
}

export function drawConstantMappedPoint(ctx, planeParams, w, col) {
    if (!isRenderableComplexPoint(w)) {
        return;
    }

    withSavedContext(ctx, () => {
        const canvasPoint = mapToCanvasCoords(w.re, w.im, planeParams);
        drawCircleMarker(
            ctx,
            canvasPoint,
            CONSTANT_POINT_RADIUS,
            col,
            'rgba(255, 255, 255, 0.8)',
            2
        );
    });
}

export function drawPlanarTransformedLine(ctx, planeParams, mappedTransform, z_pts, col, map = null) {
    if (!Array.isArray(z_pts) || z_pts.length === 0 || !mappedTransform || !hasFastCanvasMapping(planeParams)) {
        return;
    }

    const renderLimit = getPlanarTransformRenderLimit(planeParams);
    const jumpThresholdSq = getViewportJumpThresholdSq(planeParams);
    const geometry = buildAdaptiveTransformedPolyline(
        planeParams,
        mappedTransform,
        z_pts,
        renderLimit,
        jumpThresholdSq,
        getAdaptiveTransformRenderTuning(),
        map
    );

    ctx.strokeStyle = col;
    configureRoundStroke(ctx);

    const PathCtor = getPathConstructorForContext(ctx);
    ctx.stroke(buildPath2DFromTransformedPolyline(PathCtor, geometry));
}

export function getPointSetEndpoints(pointSet) {
    const points = pointSet && pointSet.points;

    if (!Array.isArray(points)) {
        return null;
    }

    let start = null;
    let end = null;
    let validCount = 0;

    for (let i = 0, length = points.length; i < length; i++) {
        const point = points[i];
        if (point) {
            if (validCount === 0) {
                start = point;
            }
            end = point;
            validCount++;
        }
    }

    return validCount >= 2
        ? { start, end }
        : null;
}

export function drawFunctionFociOverlay(ctx, planeParams) {
    if (appState.currentFunction !== 'cos') {
        return;
    }

    withSavedContext(ctx, () => {
        const focus1Canvas = mapToCanvasCoords(1, 0, planeParams);
        const focus2Canvas = mapToCanvasCoords(-1, 0, planeParams);

        drawCircleMarker(ctx, focus1Canvas, FOCI_RADIUS, COLOR_FOCI);
        drawCircleMarker(ctx, focus2Canvas, FOCI_RADIUS, COLOR_FOCI);

        ctx.font = "10px 'SF Pro Text',sans-serif";
        ctx.textAlign = 'center';
        ctx.fillStyle = COLOR_TEXT_ON_CANVAS;
        ctx.fillText(
            'Foci: ±1',
            planeParams.origin.x,
            focus1Canvas.y + (focus1Canvas.y < 20 ? 15 : -10)
        );
    });
}

export function shouldDrawPlanarFunctionFociOverlay() {
    return appState.currentInputShape === 'line' && appState.currentFunction === 'cos';
}

export function shouldDrawPlanarInputRadialOverlay() {
    return appState.radialDiscreteStepsEnabled;
}

export function drawPlanarInputOverlays(ctx, planeParams) {
    if (shouldDrawPlanarInputRadialOverlay()) {
        drawRadialDiscreteSteps(
            ctx,
            planeParams,
            appState.currentFunction,
            appState.radialDiscreteStepsCount
        );
    }
    const drawOverlayPath = (points, color, dash = []) => {
        if (!Array.isArray(points) || points.length < 2) return;
        withSavedContext(ctx, () => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.setLineDash?.(dash);
            strokeComplexArrayOnPlane(ctx, planeParams, points);
        });
    };
    if (appState.branchCutType === 'draw') {
        drawOverlayPath(appState.branchCutPoints, '#fb7185', [7, 5]);
    } else if (Number.isFinite(appState.branchCutAngle)) {
        const xRange = getPlaneXRanges(planeParams);
        const yRange = getPlaneYRanges(planeParams);
        const length = Math.max(Math.abs(xRange[0]), Math.abs(xRange[1]), Math.abs(yRange[0]), Math.abs(yRange[1])) * 2;
        drawOverlayPath([
            { re: 0, im: 0 },
            { re: length * Math.cos(appState.branchCutAngle), im: length * Math.sin(appState.branchCutAngle) }
        ], '#fb7185', [7, 5]);
    }
    drawOverlayPath(appState.continuationPath, '#22d3ee');
}

export function drawPlanarTransformedShape(ctx, planeParams, map, options = {}) {
    if (typeof map?.evaluate !== 'function') throw new Error('Transformed planar rendering requires an active native map.');
    const includeGeometry = options.includeGeometry !== false;
    const includeOverlays = options.includeOverlays !== false;
    const renderJob = options.renderJob || createPlanarTransformedShapeRenderJob(map);
    const inputShape = renderJob.inputShape;
    let geometryRendered = true;

    if (includeGeometry) {
        if (isRasterInputShape(inputShape)) {
            geometryRendered = drawImageWithWebGL(ctx, planeParams, true, map);
        } else {
            const pointSets = renderJob.pointSets;
            const startIndex = clamp(Math.floor(options.startIndex === undefined
                ? 0
                : requireFiniteNumber(options.startIndex, 'Transformed-shape start index')), 0, pointSets.length);
            const endIndex = clamp(Math.floor(options.endIndex === undefined
                ? pointSets.length
                : requireFiniteNumber(options.endIndex, 'Transformed-shape end index')), startIndex, pointSets.length);

            drawPointSetCollectionOnPlane(ctx, planeParams, pointSets, {
                transformFunc: renderJob.transformFunc,
                transformProfile: renderJob.transformProfile,
                map,
                startIndex,
                endIndex,
                colorResolver: pointSet => renderJob.highlightContour && (pointSet.role === 'shape-curve' || pointSet.role === 'shape-arbitrary')
                    ? COLOR_CAUCHY_CONTOUR_W
                    : pointSet.color,
                lineWidthResolver: pointSet => renderJob.highlightContour && (pointSet.role === 'shape-curve' || pointSet.role === 'shape-arbitrary')
                    ? 3.5
                    : (pointSet.lineWidth || LINE_WIDTH_NORMAL)
            });
        }
    }

    if (includeOverlays && shouldDrawPlanarFunctionFociOverlay()) {
        drawFunctionFociOverlay(ctx, planeParams);
    }

    return geometryRendered;
}

export function createPlanarTransformedShapeRenderJob(map) {
    if (typeof map?.evaluate !== 'function') throw new Error('Planar render jobs require an active native map.');
    const tf = map.evaluate;
    const inputShape = appState.currentInputShape;
    const generatedPointSets = isRasterInputShape(inputShape)
        ? null
        : generateCurrentInputShapePointSets(zPlaneParams, {
            currentFunction: appState.currentFunction,
            zetaContinuationEnabled: appState.zetaContinuationEnabled
        });
    let pointSets = generatedPointSets;
    if (pointSets && appState.graphViewEnabled) {
        pointSets = appState.graphFullGridEnabled
            ? filterGraphFullGridPointSets(pointSets)
            : pointSets.filter((_pointSet, index) =>
                appState.graphSelectedShape !== inputShape || index === appState.graphSelectedLineIndex
            );
    }

    return {
        inputShape,
        pointSets,
        transformFunc: tf,
        map,
        transformProfile: pointSets
            ? getMappedTransformProfile(appState.currentFunction, tf)
            : null,
        highlightContour: appState.cauchyIntegralModeEnabled &&
            (inputShape === 'circle' || inputShape === 'ellipse' || inputShape === 'arbitrary')
    };
}



export function drawPlanarTransformedProbe(ctx, planeParams, map) {
    withSavedContext(ctx, () => {
        const renderLimit = getPlanarTransformRenderLimit(planeParams);
        const neighborhood = probeNeighborhoodPoints(appState.probeZ, appState.probeNeighborhoodSize);
        const segmentRadius = appState.probeNeighborhoodSize / PROBE_CROSSHAIR_SIZE_FACTOR;
        const endpoints = getProbeCrosshairEndpoints(appState.probeZ, segmentRadius);
        const sourcePoints = [
            appState.probeZ,
            ...neighborhood,
            ...endpoints.horizontal,
            ...endpoints.vertical
        ];
        const mapped = evaluateNativePoints(nativeOptionsForActiveMap(map), sourcePoints).values;
        const probeWorldPoint = mapped[0];

        if (isRenderableComplexPoint(probeWorldPoint)) {
            const probeCanvasPoint = mapToCanvasCoords(probeWorldPoint.re, probeWorldPoint.im, planeParams);
            drawCircleMarker(ctx, probeCanvasPoint, PROBE_MARKER_RADIUS, COLOR_PROBE_MARKER);
        }

        configureRoundStroke(ctx, COLOR_PROBE_NEIGHBORHOOD, 1.5);
        drawMappedProbeNeighborhood(
            ctx,
            planeParams,
            mapped.slice(1, 1 + neighborhood.length),
            renderLimit
        );
        const endpointsOffset = 1 + neighborhood.length;
        configureRoundStroke(ctx, undefined, 2);
        drawProbeSegment(
            ctx, planeParams, mapped[endpointsOffset], mapped[endpointsOffset + 1],
            COLOR_PROBE_CONFORMAL_LINE_W_H
        );
        drawProbeSegment(
            ctx, planeParams, mapped[endpointsOffset + 2], mapped[endpointsOffset + 3],
            COLOR_PROBE_CONFORMAL_LINE_W_V
        );
    });
}

function drawCriticalIndicatrixMarker(ctx, planeParams, center) {
    const point = toCanvasPoint(center, planeParams);
    if (!isFiniteCanvasPoint(point)) return;

    ctx.beginPath();
    ctx.moveTo(point.x - 4, point.y - 4);
    ctx.lineTo(point.x + 4, point.y + 4);
    ctx.moveTo(point.x - 4, point.y + 4);
    ctx.lineTo(point.x + 4, point.y - 4);
    ctx.stroke();
}

export function drawConformalIndicatrices(ctx, planeParams, indicatrices, view) {
    if (!Array.isArray(indicatrices) || indicatrices.length === 0) return;

    const isSource = view === 'source';
    const circleKey = isSource ? 'sourceCircle' : 'mappedCircle';
    const spokeKey = isSource ? 'sourceSpoke' : 'mappedSpoke';
    const arrowheadKey = isSource ? 'sourceArrowhead' : 'mappedArrowhead';

    withSavedContext(ctx, () => {
        for (let i = 0, length = indicatrices.length; i < length; i++) {
            const indicatrix = indicatrices[i];
            configureRoundStroke(ctx, indicatrix.color, 1.25);
            drawComplexLineSetOnPlane(ctx, planeParams, indicatrix[circleKey]);
            configureRoundStroke(ctx, indicatrix.color, 1.65);
            drawComplexLineSetOnPlane(ctx, planeParams, indicatrix[spokeKey]);
            drawComplexLineSetOnPlane(ctx, planeParams, indicatrix[arrowheadKey]);
        }

        if (!isSource) {
            configureRoundStroke(ctx, 'rgba(255, 121, 161, 0.98)', 1.6);
            for (let i = 0, length = indicatrices.length; i < length; i++) {
                const indicatrix = indicatrices[i];
                if (indicatrix.isCritical) {
                    drawCriticalIndicatrixMarker(ctx, planeParams, indicatrix.mappedCenter);
                }
            }
        }

    });
}

export function drawZPlaneVectorField(ctx, planeParams, map) {
    drawNativeVectorField(ctx, planeParams, map);
}

function getCanvasArrowGeometry(originX, originY, directionX, directionY, arrowLength, arrowHeadSize) {
    const directionLength = Math.hypot(directionX, directionY);
    if (!(directionLength > 0) || !Number.isFinite(directionLength)) {
        return null;
    }

    const canvasDirectionX = directionX / directionLength;
    const canvasDirectionY = -directionY / directionLength;
    const canvasPerpendicularX = -canvasDirectionY;
    const canvasPerpendicularY = canvasDirectionX;
    const tipX = originX + canvasDirectionX * arrowLength;
    const tipY = originY + canvasDirectionY * arrowLength;
    const baseCenterX = tipX - canvasDirectionX * arrowHeadSize * 2.5;
    const baseCenterY = tipY - canvasDirectionY * arrowHeadSize * 2.5;

    return {
        tipX,
        tipY,
        leftX: baseCenterX + canvasPerpendicularX * arrowHeadSize,
        leftY: baseCenterY + canvasPerpendicularY * arrowHeadSize,
        rightX: baseCenterX - canvasPerpendicularX * arrowHeadSize,
        rightY: baseCenterY - canvasPerpendicularY * arrowHeadSize
    };
}

function drawNativeVectorField(ctx, planeParams, map) {
    const xRange = getPlaneXRanges(planeParams);
    const yRange = getPlaneYRanges(planeParams);
    const density = clamp(Math.floor(requireFiniteNumber(appState.gridDensity, 'Vector-field density') * 0.75), 5, 25);
    const arrowScale = requireFiniteNumber(appState.vectorFieldScale, 'Vector-field arrow scale');
    const thickness = requireFiniteNumber(appState.vectorArrowThickness, 'Vector-field arrow thickness');
    const headSize = requireFiniteNumber(appState.vectorArrowHeadSize, 'Vector-field arrow-head size');
    const brightness = requireFiniteNumber(appState.domainBrightness, 'Vector-field brightness');
    const cellPixels = Math.min(planeParams.width / density, planeParams.height / density);
    const arrowLength = cellPixels * 0.38 * arrowScale;
    const arrowHeadSize = cellPixels * headSize * 0.04;
    const fastMap = hasFastCanvasMapping(planeParams);
    const vectors = buildNativeVectorField({
        map: nativeOptionsForActiveMap(map),
        xRange,
        yRange,
        density,
        inverse: appState.vectorFieldFunction === '1/f(z)'
    });

    withSavedContext(ctx, () => {
        configureRoundStroke(ctx, undefined, thickness);

        for (const vector of vectors) {
                const x = vector.x;
                const y = vector.y;
                const magnitudeSq = vector.re * vector.re + vector.im * vector.im;

                const inverseMagnitude = 1 / Math.sqrt(magnitudeSq);
                const directionX = vector.re * inverseMagnitude;
                const directionY = vector.im * inverseMagnitude;
                const color = getArrowColorFromComponents(vector.re, vector.im, brightness);
                const originX = fastMap ? canvasXFast(x, planeParams) : mapToCanvasCoords(x, y, planeParams).x;
                const originY = fastMap ? canvasYFast(y, planeParams) : mapToCanvasCoords(x, y, planeParams).y;
                const arrow = getCanvasArrowGeometry(
                    originX,
                    originY,
                    directionX,
                    directionY,
                    arrowLength,
                    arrowHeadSize
                );
                if (!arrow) {
                    continue;
                }

                ctx.strokeStyle = color;
                ctx.fillStyle = color;
                ctx.lineWidth = thickness;
                ctx.beginPath();
                ctx.moveTo(originX, originY);
                ctx.lineTo(arrow.tipX, arrow.tipY);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(arrow.tipX, arrow.tipY);
                ctx.lineTo(arrow.leftX, arrow.leftY);
                ctx.lineTo(arrow.rightX, arrow.rightY);
                ctx.closePath();
                ctx.fill();
        }
    });
}
