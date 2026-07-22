import { state as appState, zPlaneParams } from '../store/state.js';
import { runtime } from '../store/runtime.js';
import { eventBus } from '../store/events.js';
import {
    COLOR_PROBE_MARKER, COLOR_PROBE_NEIGHBORHOOD, COLOR_TEXT_ON_CANVAS,
    COLOR_Z_GRID_HORZ, COLOR_CAUCHY_CONTOUR_Z, COLOR_CAUCHY_CONTOUR_W,
    COLOR_PARTICLE, COLOR_FOCI,
    COLOR_PROBE_CONFORMAL_LINE_W_H, COLOR_PROBE_CONFORMAL_LINE_W_V,
    COLOR_PROBE_CONFORMAL_LINE_Z_H, COLOR_PROBE_CONFORMAL_LINE_Z_V,
    STREAMLINE_COLOR_MIN_MAG, STREAMLINE_COLOR_MAX_MAG
} from '../constants/colors.js';
import {
    TWO_PI, MIN_POINTS_ADAPTIVE, MAX_POINTS_ADAPTIVE_DEFAULT,
    ADAPTIVE_ANCHOR_DENSITY, DEFAULT_POINTS_PER_LINE, ZETA_POLE,
    ZETA_REFLECTION_POINT_RE, PROBE_CROSSHAIR_SIZE_FACTOR
} from '../constants/numerical.js';
import { LINE_WIDTH_NORMAL, PARTICLE_RADIUS } from '../constants/rendering.js';
import { mapToCanvasCoords } from '../utils/canvas-utils.js';
import {
    getMappedTransformProfile, evaluateMappedTransform, isNumericallyStable,
    transformFunctions
} from '../math-utils.js';
import {
    calculateStreamline, getVectorFieldValueAtPoint,
    getStreamlineColorByMagnitude, getVectorEvaluator
} from '../analysis/streamline.js';
import { isRasterInputShape } from '../utils/raster-media.js';
import { drawImageWithWebGL } from './draw-image-webgl.js';
import {
    generateCurrentInputShapePointSets,
    generateCurrentMappedInputShapePointSets,
    generateRadialDiscreteStepPointSets
} from './shape-generators.js';
import { hslToRgb } from './canvas-primitives.js';

const EPSILON = 1e-9;
const DEGENERATE_SEGMENT_EPSILON = 1e-12;
const STREAMLINE_COLOR_BUCKETS = 32;
const STREAMLINE_FRAME_BUDGET_MS = 8;
const STREAMLINE_INTERACTION_FRAME_BUDGET_MS = 4;
const STREAMLINE_STEP_BUDGET = 12000;
const STREAMLINE_INTERACTION_STEP_BUDGET = 3500;
const STREAMLINE_MAX_STEPS_PER_PATH = 650;
const PROBE_NEIGHBORHOOD_SEGMENTS = 60;
const PROBE_MARKER_RADIUS = 5;
const CONSTANT_POINT_RADIUS = 7;
const FOCI_RADIUS = 4;
const DEFAULT_VIEW_RANGE = Object.freeze([-1, 1]);
const INVALID_COMPLEX_POINT = Object.freeze({ re: NaN, im: NaN });

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


const CANVAS_PATH_CACHE = new WeakMap();
const TRANSFORMED_PATH_CACHE = new WeakMap();
const PREPARED_POINT_SET_CACHE = new WeakMap();

const PREPARED_POINT_SET_CACHE_ASSOCIATIVITY = 12;
const PATH_CACHE_MIN_POINTS = 64;
const PATH_CACHE_ASSOCIATIVITY = 4;
const TRANSFORM_SAMPLE_PROBES = 9;
const STATIC_CURVE_TOLERANCE_PX_SQ = 0.22;
const INTERACTION_CURVE_TOLERANCE_PX_SQ = 1.45;
const STATIC_MAX_SEGMENT_PX_SQ = 24 * 24;
const INTERACTION_MAX_SEGMENT_PX_SQ = 56 * 56;
const MAX_TRANSFORM_SUBDIVISION_DEPTH = 9;
const HASH_OFFSET_BASIS = 2166136261 >>> 0;
const HASH_PRIME = 16777619;

function getPathConstructor() {
    return typeof Path2D === 'function' ? Path2D : null;
}

function getPathConstructorForContext(ctx) {
    const PathCtor = getPathConstructor();
    if (!PathCtor || !ctx || typeof ctx.stroke !== 'function') {
        return null;
    }

    if (typeof CanvasRenderingContext2D === 'function' && ctx instanceof CanvasRenderingContext2D) {
        return PathCtor;
    }

    if (typeof OffscreenCanvasRenderingContext2D === 'function' && ctx instanceof OffscreenCanvasRenderingContext2D) {
        return PathCtor;
    }

    return null;
}

function mixHashInt(hash, value) {
    return Math.imul((hash ^ value) >>> 0, HASH_PRIME) >>> 0;
}

function mixHashFloat(hash, value) {
    if (!Number.isFinite(value)) {
        return mixHashInt(hash, 0x7fc00000);
    }

    // Quantization avoids pathological cache misses from sub-ulp transform noise while
    // preserving far more precision than a canvas pixel needs for a path identity guard.
    return mixHashInt(hash, Math.trunc(value * 1048576) | 0);
}

function getPointAtOrNull(points, index) {
    return index >= 0 && index < points.length ? points[index] : null;
}

function pointSentinelsMatch(entry, points) {
    const length = points.length;
    const first = getPointAtOrNull(points, 0);
    const middle = getPointAtOrNull(points, length >> 1);
    const last = getPointAtOrNull(points, length - 1);

    return entry.length === length &&
        entry.first === first &&
        entry.middle === middle &&
        entry.last === last &&
        entry.firstRe === (first && first.re) &&
        entry.firstIm === (first && first.im) &&
        entry.middleRe === (middle && middle.re) &&
        entry.middleIm === (middle && middle.im) &&
        entry.lastRe === (last && last.re) &&
        entry.lastIm === (last && last.im);
}

function writePointSentinels(entry, points) {
    const length = points.length;
    const first = getPointAtOrNull(points, 0);
    const middle = getPointAtOrNull(points, length >> 1);
    const last = getPointAtOrNull(points, length - 1);

    entry.length = length;
    entry.first = first;
    entry.middle = middle;
    entry.last = last;
    entry.firstRe = first && first.re;
    entry.firstIm = first && first.im;
    entry.middleRe = middle && middle.re;
    entry.middleIm = middle && middle.im;
    entry.lastRe = last && last.re;
    entry.lastIm = last && last.im;
}

function planeCacheFieldsMatch(entry, planeParams) {
    return entry.originX === planeParams.origin.x &&
        entry.originY === planeParams.origin.y &&
        entry.scaleX === planeParams.scale.x &&
        entry.scaleY === planeParams.scale.y;
}

function writePlaneCacheFields(entry, planeParams) {
    entry.originX = planeParams.origin.x;
    entry.originY = planeParams.origin.y;
    entry.scaleX = planeParams.scale.x;
    entry.scaleY = planeParams.scale.y;
}

function findReusableCacheEntry(cacheRoot, predicate) {
    let previous = null;
    let entry = cacheRoot;
    let depth = 0;

    while (entry && depth < PATH_CACHE_ASSOCIATIVITY) {
        if (predicate(entry)) {
            if (previous) {
                previous.next = entry.next;
                entry.next = cacheRoot;
            }
            return entry;
        }

        previous = entry;
        entry = entry.next;
        depth++;
    }

    return null;
}

function pushPathCacheEntry(cacheMap, points, entry) {
    const head = cacheMap.get(points) || null;
    entry.next = head;

    let cursor = entry;
    for (let depth = 1; cursor && cursor.next && depth < PATH_CACHE_ASSOCIATIVITY; depth++) {
        cursor = cursor.next;
    }
    if (cursor) {
        cursor.next = null;
    }

    cacheMap.set(points, entry);
}

function getTransformScopedPathCache(points, mappedTransform, createIfMissing) {
    if (!mappedTransform || (typeof mappedTransform !== 'object' && typeof mappedTransform !== 'function')) {
        return null;
    }

    let byTransform = TRANSFORMED_PATH_CACHE.get(points);
    if (!byTransform) {
        if (!createIfMissing) return null;
        byTransform = new WeakMap();
        TRANSFORMED_PATH_CACHE.set(points, byTransform);
    }

    return byTransform;
}

function pushTransformScopedPathCacheEntry(byTransform, mappedTransform, entry) {
    const head = byTransform.get(mappedTransform) || null;
    entry.next = head;

    let cursor = entry;
    for (let depth = 1; cursor && cursor.next && depth < PATH_CACHE_ASSOCIATIVITY; depth++) {
        cursor = cursor.next;
    }
    if (cursor) cursor.next = null;

    byTransform.set(mappedTransform, entry);
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
    const cachedPath = getCachedComplexPath2D(ctx, planeParams, points);
    if (cachedPath) {
        ctx.stroke(cachedPath);
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

function strokeComplexIterableOnPlane(ctx, planeParams, points) {
    if (!points || typeof points[Symbol.iterator] !== 'function') {
        return;
    }

    const fastMap = hasFastCanvasMapping(planeParams);
    let pathOpen = false;

    ctx.beginPath();

    for (const point of points) {
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


function getCachedComplexPath2D(ctx, planeParams, points) {
    const PathCtor = getPathConstructorForContext(ctx);
    if (!PathCtor || !Array.isArray(points) || points.length < PATH_CACHE_MIN_POINTS || !hasFastCanvasMapping(planeParams)) {
        return null;
    }

    const cacheRoot = CANVAS_PATH_CACHE.get(points);
    const cachedEntry = cacheRoot && findReusableCacheEntry(cacheRoot, entry =>
        entry.kind === 'complex' &&
        planeCacheFieldsMatch(entry, planeParams) &&
        pointSentinelsMatch(entry, points)
    );

    if (cachedEntry) {
        if (cachedEntry !== cacheRoot) {
            CANVAS_PATH_CACHE.set(points, cachedEntry);
        }
        return cachedEntry.path;
    }

    const path = buildPath2DFromComplexArray(PathCtor, planeParams, points);
    const entry = { kind: 'complex', path, next: null };
    writePlaneCacheFields(entry, planeParams);
    writePointSentinels(entry, points);
    pushPathCacheEntry(CANVAS_PATH_CACHE, points, entry);
    return path;
}

function getTransformSampleHash(mappedTransform, points) {
    const length = points.length;
    if (length === 0) {
        return HASH_OFFSET_BASIS;
    }

    const evalContext = { re: 0, im: 0 };
    const sampleCount = Math.min(TRANSFORM_SAMPLE_PROBES, length);
    let hash = HASH_OFFSET_BASIS;
    hash = mixHashInt(hash, String(appState.currentFunction).length);

    for (let probe = 0; probe < sampleCount; probe++) {
        const index = sampleCount === 1
            ? 0
            : Math.floor((probe * (length - 1)) / (sampleCount - 1));
        const point = points[index];

        if (!isRenderableComplexPoint(point)) {
            hash = mixHashInt(hash, 0x9e3779b9);
            continue;
        }

        const mapped = evaluateProfilePoint(mappedTransform, point.re, point.im, evalContext);
        if (!isRenderableComplexPoint(mapped)) {
            hash = mixHashInt(hash, 0x85ebca6b);
            continue;
        }

        hash = mixHashFloat(hash, mapped.re);
        hash = mixHashFloat(hash, mapped.im);
    }

    return hash >>> 0;
}

function getAdaptiveTransformRenderTuning() {
    const interacting = isViewportManipulationActive();
    return {
        toleranceSq: interacting ? INTERACTION_CURVE_TOLERANCE_PX_SQ : STATIC_CURVE_TOLERANCE_PX_SQ,
        maxSegmentSq: interacting ? INTERACTION_MAX_SEGMENT_PX_SQ : STATIC_MAX_SEGMENT_PX_SQ,
        maxDepth: MAX_TRANSFORM_SUBDIVISION_DEPTH
    };
}

function isMappedPointUsableForPath(mappedRe, mappedIm, renderLimit) {
    return isFiniteNumber(mappedRe) &&
        isFiniteNumber(mappedIm) &&
        Math.abs(mappedRe) <= renderLimit &&
        Math.abs(mappedIm) <= renderLimit;
}

function appendPointToPathObject(path, pathState, x, y) {
    if (pathState.open) {
        path.lineTo(x, y);
    } else {
        path.moveTo(x, y);
        pathState.open = true;
    }
}

function breakPathObject(pathState) {
    pathState.open = false;
}

function appendAdaptiveTransformedSegment(path, pathState, planeParams, mappedTransform, renderLimit, tuning, evalContext,
    z0Re, z0Im, w0Re, w0Im, x0, y0,
    z1Re, z1Im, w1Re, w1Im, x1, y1,
    depth) {
    if (depth < tuning.maxDepth) {
        const midZRe = (z0Re + z1Re) * 0.5;
        const midZIm = (z0Im + z1Im) * 0.5;
        const midMapped = evaluateProfilePoint(mappedTransform, midZRe, midZIm, evalContext);

        if (!isRenderableComplexPoint(midMapped) || !isMappedPointUsableForPath(midMapped.re, midMapped.im, renderLimit)) {
            // A singular or clipped midpoint means the projected curve is not a
            // continuous visible segment. Restart at the far endpoint instead of
            // drawing a false bridge across the discontinuity.
            breakPathObject(pathState);
            appendPointToPathObject(path, pathState, x1, y1);
            return;
        }

        const midX = canvasXFast(midMapped.re, planeParams);
        const midY = canvasYFast(midMapped.im, planeParams);
        const chordMidX = (x0 + x1) * 0.5;
        const chordMidY = (y0 + y1) * 0.5;
        const errorX = midX - chordMidX;
        const errorY = midY - chordMidY;
        const segmentX = x1 - x0;
        const segmentY = y1 - y0;

        if (errorX * errorX + errorY * errorY > tuning.toleranceSq ||
            segmentX * segmentX + segmentY * segmentY > tuning.maxSegmentSq) {
            const nextDepth = depth + 1;
            appendAdaptiveTransformedSegment(path, pathState, planeParams, mappedTransform, renderLimit, tuning, evalContext,
                z0Re, z0Im, w0Re, w0Im, x0, y0,
                midZRe, midZIm, midMapped.re, midMapped.im, midX, midY,
                nextDepth);
            appendAdaptiveTransformedSegment(path, pathState, planeParams, mappedTransform, renderLimit, tuning, evalContext,
                midZRe, midZIm, midMapped.re, midMapped.im, midX, midY,
                z1Re, z1Im, w1Re, w1Im, x1, y1,
                nextDepth);
            return;
        }
    }

    appendPointToPathObject(path, pathState, x1, y1);
}

function buildAdaptiveTransformedPath(PathCtor, planeParams, mappedTransform, points, renderLimit, jumpThresholdSq, tuning) {
    const path = new PathCtor();
    const pathState = { open: false };
    const evalContext = { re: 0, im: 0 };
    let hasPrevious = false;
    let previousZRe = 0;
    let previousZIm = 0;
    let previousMappedRe = 0;
    let previousMappedIm = 0;
    let previousX = 0;
    let previousY = 0;

    for (let i = 0, length = points.length; i < length; i++) {
        const zPoint = points[i];

        if (!isRenderableComplexPoint(zPoint)) {
            hasPrevious = false;
            breakPathObject(pathState);
            continue;
        }

        const mappedPoint = evaluateProfilePoint(mappedTransform, zPoint.re, zPoint.im, evalContext);
        if (!isRenderableComplexPoint(mappedPoint)) {
            hasPrevious = false;
            breakPathObject(pathState);
            continue;
        }

        const mappedRe = mappedPoint.re;
        const mappedIm = mappedPoint.im;

        if (hasPrevious) {
            const deltaRe = mappedRe - previousMappedRe;
            const deltaIm = mappedIm - previousMappedIm;
            if (deltaRe * deltaRe + deltaIm * deltaIm > jumpThresholdSq) {
                hasPrevious = false;
                breakPathObject(pathState);
            }
        }

        if (!isMappedPointUsableForPath(mappedRe, mappedIm, renderLimit)) {
            hasPrevious = false;
            breakPathObject(pathState);
            continue;
        }

        const x = canvasXFast(mappedRe, planeParams);
        const y = canvasYFast(mappedIm, planeParams);

        if (!hasPrevious) {
            appendPointToPathObject(path, pathState, x, y);
        } else {
            appendAdaptiveTransformedSegment(path, pathState, planeParams, mappedTransform, renderLimit, tuning, evalContext,
                previousZRe, previousZIm, previousMappedRe, previousMappedIm, previousX, previousY,
                zPoint.re, zPoint.im, mappedRe, mappedIm, x, y,
                0);
        }

        hasPrevious = true;
        previousZRe = zPoint.re;
        previousZIm = zPoint.im;
        previousMappedRe = mappedRe;
        previousMappedIm = mappedIm;
        previousX = x;
        previousY = y;
    }

    return path;
}


function transformedCacheEntryMatches(entry, planeParams, points, renderLimit, jumpThresholdSq, sampleHash, tuning) {
    return entry.kind === 'transformed' &&
        entry.renderLimit === renderLimit &&
        entry.jumpThresholdSq === jumpThresholdSq &&
        entry.sampleHash === sampleHash &&
        entry.toleranceSq === tuning.toleranceSq &&
        entry.maxSegmentSq === tuning.maxSegmentSq &&
        entry.functionKey === appState.currentFunction &&
        planeCacheFieldsMatch(entry, planeParams) &&
        pointSentinelsMatch(entry, points);
}

function getCachedTransformedPath2D(ctx, planeParams, mappedTransform, points, renderLimit, jumpThresholdSq) {
    const PathCtor = getPathConstructorForContext(ctx);
    if (!PathCtor || !Array.isArray(points) || points.length < PATH_CACHE_MIN_POINTS || !hasFastCanvasMapping(planeParams) || !mappedTransform) {
        return null;
    }

    const tuning = getAdaptiveTransformRenderTuning();
    const sampleHash = getTransformSampleHash(mappedTransform, points);
    const byTransform = getTransformScopedPathCache(points, mappedTransform, true);
    const cacheRoot = byTransform && byTransform.get(mappedTransform);
    const cachedEntry = cacheRoot && findReusableCacheEntry(cacheRoot, entry =>
        transformedCacheEntryMatches(entry, planeParams, points, renderLimit, jumpThresholdSq, sampleHash, tuning)
    );

    if (cachedEntry) {
        if (cachedEntry !== cacheRoot) {
            byTransform.set(mappedTransform, cachedEntry);
        }
        return cachedEntry.path;
    }

    const path = buildAdaptiveTransformedPath(PathCtor, planeParams, mappedTransform, points, renderLimit, jumpThresholdSq, tuning);
    const entry = {
        kind: 'transformed',
        path,
        next: null,
        renderLimit,
        jumpThresholdSq,
        sampleHash,
        toleranceSq: tuning.toleranceSq,
        maxSegmentSq: tuning.maxSegmentSq,
        functionKey: appState.currentFunction
    };
    writePlaneCacheFields(entry, planeParams);
    writePointSentinels(entry, points);
    if (byTransform) {
        pushTransformScopedPathCacheEntry(byTransform, mappedTransform, entry);
    }
    return path;
}

function hslToRgbCss(h, s, l) {
    let r;
    let g;
    let b;

    if (s === 0) {
        r = l;
        g = l;
        b = l;
    } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        let tr = h + 1 / 3;
        let tg = h;
        let tb = h - 1 / 3;

        if (tr < 0) tr += 1;
        if (tr > 1) tr -= 1;
        if (tg < 0) tg += 1;
        if (tg > 1) tg -= 1;
        if (tb < 0) tb += 1;
        if (tb > 1) tb -= 1;

        r = tr < 1 / 6 ? p + (q - p) * 6 * tr : tr < 1 / 2 ? q : tr < 2 / 3 ? p + (q - p) * (2 / 3 - tr) * 6 : p;
        g = tg < 1 / 6 ? p + (q - p) * 6 * tg : tg < 1 / 2 ? q : tg < 2 / 3 ? p + (q - p) * (2 / 3 - tg) * 6 : p;
        b = tb < 1 / 6 ? p + (q - p) * 6 * tb : tb < 1 / 2 ? q : tb < 2 / 3 ? p + (q - p) * (2 / 3 - tb) * 6 : p;
    }

    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function finiteOr(value, fallback) {
    return isFiniteNumber(value) ? value : fallback;
}

function isUsableRange(range) {
    return Array.isArray(range) &&
        range.length >= 2 &&
        isFiniteNumber(range[0]) &&
        isFiniteNumber(range[1]);
}

function getPlaneRange(planeParams, currentKey, fallbackKey) {
    if (planeParams && isUsableRange(planeParams[currentKey])) {
        return planeParams[currentKey];
    }
    if (planeParams && isUsableRange(planeParams[fallbackKey])) {
        return planeParams[fallbackKey];
    }
    return DEFAULT_VIEW_RANGE;
}

function getPlaneXRanges(planeParams) {
    return getPlaneRange(planeParams, 'currentVisXRange', 'xRange');
}

function getPlaneYRanges(planeParams) {
    return getPlaneRange(planeParams, 'currentVisYRange', 'yRange');
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

function strokeSegmentedCanvasPath(ctx, items, resolveCanvasPoint) {
    if (!items || typeof items[Symbol.iterator] !== 'function') {
        return;
    }

    ctx.beginPath();
    let segmentOpen = false;

    for (const item of items) {
        const canvasPoint = resolveCanvasPoint(item);

        if (!isFiniteCanvasPoint(canvasPoint)) {
            if (segmentOpen) {
                ctx.stroke();
                ctx.beginPath();
                segmentOpen = false;
            }
            continue;
        }

        if (segmentOpen) {
            ctx.lineTo(canvasPoint.x, canvasPoint.y);
        } else {
            ctx.moveTo(canvasPoint.x, canvasPoint.y);
            segmentOpen = true;
        }
    }

    if (segmentOpen) {
        ctx.stroke();
    }
}

function createCirclePoints(center, radius, segments) {
    const pointCount = Math.max(3, Math.floor(finiteOr(segments, PROBE_NEIGHBORHOOD_SEGMENTS)));
    const points = [];

    for (let i = 0; i <= pointCount; i++) {
        const angle = (i / pointCount) * TWO_PI;
        points.push({
            re: center.re + radius * Math.cos(angle),
            im: center.im + radius * Math.sin(angle)
        });
    }

    return points;
}

function drawWorldCircle(ctx, planeParams, center, radius, segments) {
    if (!isRenderableComplexPoint(center) || !isFiniteNumber(radius)) {
        return;
    }

    const pointCount = Math.max(3, Math.floor(finiteOr(segments, PROBE_NEIGHBORHOOD_SEGMENTS)));
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

function isStableRenderableComplexPoint(point) {
    return isRenderableComplexPoint(point) && isNumericallyStable(point);
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

    const width = finiteOr(planeParams.width, 0);
    const height = finiteOr(planeParams.height, 0);
    const margin = Math.max(width, height) * 2;

    return point.x > -margin &&
        point.x < width + margin &&
        point.y > -margin &&
        point.y < height + margin;
}

function evaluateProfilePoint(mappedTransform, re, im, evalContext = null) {
    return evaluateMappedTransform(
        mappedTransform,
        re,
        im,
        appState.currentFunction,
        evalContext
    ) || INVALID_COMPLEX_POINT;
}

function createProfileEvaluator(mappedTransform) {
    return (re, im) => evaluateProfilePoint(mappedTransform, re, im);
}

function getViewportJumpThresholdSq(planeParams) {
    const xRange = getPlaneXRanges(planeParams);
    const yRange = getPlaneYRanges(planeParams);
    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];

    return (spanX * spanX + spanY * spanY) * 4;
}

function breakOpenPath(ctx, pathState) {
    if (pathState.open) {
        ctx.stroke();
    }
    ctx.beginPath();
    pathState.open = false;
}

function appendCanvasPointToPath(ctx, pathState, canvasPoint) {
    if (pathState.open) {
        ctx.lineTo(canvasPoint.x, canvasPoint.y);
    } else {
        ctx.moveTo(canvasPoint.x, canvasPoint.y);
        pathState.open = true;
    }
}

function getFirstVisibleColor(pointSets, colorResolver, fallback) {
    if (!Array.isArray(pointSets)) {
        return fallback;
    }

    const pointSet = pointSets.find(candidate => candidate && colorResolver(candidate));
    return pointSet ? colorResolver(pointSet) : fallback;
}

function createGridSeeds(planeParams, renderState) {
    const xRange = getPlaneXRanges(planeParams);
    const yRange = getPlaneYRanges(planeParams);
    const densityValue = Math.min(40, finiteOr(renderState.gridDensity * renderState.streamlineSeedDensityFactor, 0));
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
        finiteOr(renderState.streamlineStepSize, 0),
        finiteOr(renderState.streamlineMaxLength, 0),
        finiteOr(renderState.streamlineSeedDensityFactor, 0),
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
        frameMs: interacting ? STREAMLINE_INTERACTION_FRAME_BUDGET_MS : STREAMLINE_FRAME_BUDGET_MS,
        stepBudget: interacting ? STREAMLINE_INTERACTION_STEP_BUDGET : STREAMLINE_STEP_BUDGET
    };
}

function shouldStopStreamlinePass(deadline, tracedSteps, stepBudget) {
    return tracedSteps >= stepBudget || nowMs() >= deadline;
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

function getRandomPointInView(planeParams) {
    const xRange = getPlaneXRanges(planeParams);
    const yRange = getPlaneYRanges(planeParams);

    return {
        x: xRange[0] + Math.random() * (xRange[1] - xRange[0]),
        y: yRange[0] + Math.random() * (yRange[1] - yRange[0]),
        lifetime: 0
    };
}

function syncParticlePool(renderState, planeParams) {
    const particles = runtime.particles;
    const targetDensity = Math.max(0, Math.floor(finiteOr(renderState.particleDensity, 0)));

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

function writeNormalizedParticleVector(x, y, vectorEvaluator, out) {
    const vector = vectorEvaluator ? vectorEvaluator(x, y) : null;

    if (!vector || !isFiniteNumber(vector.vx) || !isFiniteNumber(vector.vy)) {
        return false;
    }

    const magnitudeSq = vector.vx * vector.vx + vector.vy * vector.vy;
    if (magnitudeSq < EPSILON * EPSILON || !Number.isFinite(magnitudeSq)) {
        return false;
    }

    const inverseMagnitude = 1 / Math.sqrt(magnitudeSq);
    out.x = vector.vx * inverseMagnitude;
    out.y = vector.vy * inverseMagnitude;
    return true;
}

function getNormalizedParticleVector(x, y, vectorEvaluator) {
    const out = { x: 0, y: 0 };
    return writeNormalizedParticleVector(x, y, vectorEvaluator, out) ? out : null;
}

function advanceParticleRK2(particle, speed, renderState, vectorEvaluator = null) {
    const first = { x: 0, y: 0 };
    const second = { x: 0, y: 0 };

    if (!writeNormalizedParticleVector(particle.x, particle.y, vectorEvaluator, first)) {
        return false;
    }

    const midpointX = particle.x + first.x * speed * 0.5;
    const midpointY = particle.y + first.y * speed * 0.5;
    const hasSecond = writeNormalizedParticleVector(midpointX, midpointY, vectorEvaluator, second);
    const direction = hasSecond ? second : first;

    particle.x += direction.x * speed;
    particle.y += direction.y * speed;
    return true;
}

function shouldRespawnParticle(particle, planeParams, renderState) {
    const xRange = getPlaneXRanges(planeParams);
    const yRange = getPlaneYRanges(planeParams);

    return particle.lifetime > renderState.particleMaxLifetime ||
        particle.x < xRange[0] ||
        particle.x > xRange[1] ||
        particle.y < yRange[0] ||
        particle.y > yRange[1] ||
        !Number.isFinite(particle.x) ||
        !Number.isFinite(particle.y);
}

function getParticleSpeed(planeParams, renderState) {
    const xRange = getPlaneXRanges(planeParams);
    const yRange = getPlaneYRanges(planeParams);
    const viewSpan = Math.max(xRange[1] - xRange[0], yRange[1] - yRange[0]);

    return finiteOr(renderState.particleSpeed, 0) * viewSpan * 0.1;
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

function transformProbeEndpoint(point, transformFunc, shouldTransform) {
    return shouldTransform ? transformFunc(point.re, point.im) : point;
}

function drawProbeSegment(ctx, planeParams, startWorld, endWorld, color, requireStability) {
    const startIsValid = requireStability
        ? isStableRenderableComplexPoint(startWorld)
        : isRenderableComplexPoint(startWorld);
    const endIsValid = requireStability
        ? isStableRenderableComplexPoint(endWorld)
        : isRenderableComplexPoint(endWorld);

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

function getClosestPointOnInfiniteLine(startPoint, endPoint, targetPoint) {
    const vectorRe = endPoint.re - startPoint.re;
    const vectorIm = endPoint.im - startPoint.im;
    const pointToTargetRe = startPoint.re - targetPoint.re;
    const pointToTargetIm = startPoint.im - targetPoint.im;
    const lengthSq = vectorRe * vectorRe + vectorIm * vectorIm;

    if (Math.abs(lengthSq) < DEGENERATE_SEGMENT_EPSILON) {
        return startPoint;
    }

    const t = -(pointToTargetRe * vectorRe + pointToTargetIm * vectorIm) / lengthSq;
    return {
        re: startPoint.re + t * vectorRe,
        im: startPoint.im + t * vectorIm
    };
}

function isZetaDirectSeriesSegment(startPoint, endPoint, evalPoint) {
    return appState.currentFunction === 'zeta' &&
        !appState.zetaContinuationEnabled &&
        (
            (startPoint.re <= ZETA_REFLECTION_POINT_RE && endPoint.re <= ZETA_REFLECTION_POINT_RE) ||
            evalPoint.re <= ZETA_REFLECTION_POINT_RE
        );
}

function nudgeIfAtZetaPole(point) {
    const atPole = Math.abs(point.re - ZETA_POLE.re) < EPSILON &&
        Math.abs(point.im - ZETA_POLE.im) < EPSILON;

    return atPole
        ? { re: ZETA_POLE.re + 1e-7, im: ZETA_POLE.im + 1e-7 }
        : point;
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

function getAdaptiveSamplingBounds() {
    if (isViewportManipulationActive()) {
        return {
            minPoints: Math.max(360, Math.floor(MIN_POINTS_ADAPTIVE * 0.3)),
            maxPoints: Math.max(2800, Math.floor(MAX_POINTS_ADAPTIVE_DEFAULT * 0.38)),
            anchorDensity: Math.max(260, Math.floor(ADAPTIVE_ANCHOR_DENSITY * 0.36))
        };
    }

    return {
        minPoints: Math.max(1100, Math.floor(MIN_POINTS_ADAPTIVE * 0.92)),
        maxPoints: Math.max(7800, Math.floor(MAX_POINTS_ADAPTIVE_DEFAULT * 0.92)),
        anchorDensity: Math.max(780, Math.floor(ADAPTIVE_ANCHOR_DENSITY * 0.92))
    };
}

function drawMappedProbeNeighborhood(ctx, planeParams, center, radius, transformFunc, renderLimit) {
    if (!isRenderableComplexPoint(center) || !isFiniteNumber(radius) || typeof transformFunc !== 'function') {
        return;
    }

    const fastMap = hasFastCanvasMapping(planeParams);
    let pathOpen = false;
    let pathWasBroken = false;

    ctx.beginPath();

    for (let i = 0; i <= PROBE_NEIGHBORHOOD_SEGMENTS; i++) {
        const angle = (i / PROBE_NEIGHBORHOOD_SEGMENTS) * TWO_PI;
        const wPoint = transformFunc(
            center.re + radius * Math.cos(angle),
            center.im + radius * Math.sin(angle)
        );

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

function getArrowColor(vector, brightness) {
    return getArrowColorFromComponents(vector.re, vector.im, brightness);
}

function getArrowColorFromComponents(re, im, brightness) {
    const phase = Math.atan2(im, re);
    let hue = (phase / TWO_PI) % 1.0;

    if (hue < 0) {
        hue += 1.0;
    }

    const magnitude = Math.sqrt(re * re + im * im);
    const lightness = clamp(0.35 + Math.log(1.0 + magnitude) * 0.08 * brightness, 0.2, 0.85);

    return hslToRgbCss(hue, 0.85, lightness);
}

function drawVectorArrow(ctx, origin, direction, length, headSize) {
    const tipX = origin.x + direction.x * length;
    const tipY = origin.y - direction.y * length;
    const baseCenterX = tipX - direction.x * headSize * 2.5;
    const baseCenterY = tipY + direction.y * headSize * 2.5;
    const perpendicularX = -direction.y;
    const perpendicularY = -direction.x;

    const leftX = baseCenterX + perpendicularX * headSize;
    const leftY = baseCenterY - perpendicularY * headSize;
    const rightX = baseCenterX - perpendicularX * headSize;
    const rightY = baseCenterY + perpendicularY * headSize;

    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fill();
}

export function isRenderableComplexPoint(point) {
    return !!(
        point &&
        isFiniteNumber(point.re) &&
        isFiniteNumber(point.im)
    );
}

export function drawComplexLineSetOnPlane(ctx, planeParams, points) {
    if (Array.isArray(points)) {
        strokeComplexArrayOnPlane(ctx, planeParams, points);
        return;
    }

    strokeComplexIterableOnPlane(ctx, planeParams, points);
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

    withSavedContext(ctx, () => {
        configureRoundStroke(ctx);
        setOptionalCanvasState(ctx, options);

        if (mappedTransform && mappedTransform.isConstant) {
            const color = getFirstVisibleColor(
                pointSets,
                colorResolver,
                appState.gridColor1 || COLOR_Z_GRID_HORZ
            );
            drawConstantMappedPoint(ctx, planeParams, mappedTransform.constantValue, color);
            return;
        }

        for (let i = 0, length = pointSets.length; i < length; i++) {
            const preparedPointSet = preparePointSet(pointSets[i], transformFunc);

            if (!preparedPointSet || !Array.isArray(preparedPointSet.points)) {
                continue;
            }

            const color = colorResolver(preparedPointSet);
            const lineWidth = lineWidthResolver(preparedPointSet);

            if (!color || !lineWidth) {
                continue;
            }

            ctx.lineWidth = lineWidth;

            if (mappedTransform) {
                drawPlanarTransformedLine(ctx, planeParams, mappedTransform, preparedPointSet.points, color);
            } else {
                ctx.strokeStyle = color;
                strokeComplexArrayOnPlane(ctx, planeParams, preparedPointSet.points);
            }
        }
    });
}

export function drawRadialDiscreteSteps(ctx, planeParams, currentFunctionKey, stepsCount) {
    const transformFunc = transformFunctions[currentFunctionKey];

    if (typeof transformFunc !== 'function') {
        return;
    }

    const generatedPointSets = generateRadialDiscreteStepPointSets(currentFunctionKey, transformFunc, stepsCount);
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

        const vectorEvaluator = getVectorEvaluator(map, state.vectorFieldFunction);
        const budget = getStreamlineRenderBudget();
        const deadline = nowMs() + budget.frameMs;

        let tracedSteps = 0;
        let nextSeedOffset = seedStartOffset;

        for (let i = seedStartOffset; i < seeds.length; i += 2) {
            if (shouldStopStreamlinePass(deadline, tracedSteps, budget.stepBudget)) {
                completed = false;
                nextSeedOffset = i;
                break;
            }

            const path = calculateStreamline(
                seeds[i],
                seeds[i + 1],
                vectorEvaluator,
                planeParams,
                state,
                {
                    maxSteps: Math.min(
                        STREAMLINE_MAX_STEPS_PER_PATH,
                        Math.max(1, budget.stepBudget - tracedSteps)
                    ),
                    shouldContinue: () => nowMs() < deadline
                }
            );
            nextSeedOffset = i + 2;
            tracedSteps += Math.max(1, Array.isArray(path) ? path.length : 0);

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

    const pointSets = generateCurrentInputShapePointSets(planeParams, {
        currentFunction: appState.currentFunction,
        zetaContinuationEnabled: appState.zetaContinuationEnabled
    });
    const highlightContour = appState.cauchyIntegralModeEnabled &&
        (inputShape === 'circle' || inputShape === 'ellipse');

    drawPointSetCollectionOnPlane(ctx, planeParams, pointSets, {
        colorResolver: pointSet => highlightContour && pointSet.role === 'shape-curve'
            ? COLOR_CAUCHY_CONTOUR_Z
            : pointSet.color,
        lineWidthResolver: pointSet => highlightContour && pointSet.role === 'shape-curve'
            ? 3.5
            : (pointSet.lineWidth || LINE_WIDTH_NORMAL)
    });
}

export function initializeSingleParticle(planeParams) {
    return getRandomPointInView(planeParams);
}

export function updateAndDrawParticles(ctx, planeParams, state, map) {
    if (!state.particleAnimationEnabled) {
        runtime.particles.length = 0;
        return;
    }

    syncParticlePool(state, planeParams);

    withSavedContext(ctx, () => {
        ctx.fillStyle = COLOR_PARTICLE;
        ctx.beginPath();

        const speed = getParticleSpeed(planeParams, state);
        const halfSpeed = speed * 0.5;
        const vectorEvaluator = getVectorEvaluator(map, state.vectorFieldFunction);
        const xRange = getPlaneXRanges(planeParams);
        const yRange = getPlaneYRanges(planeParams);
        const minX = xRange[0];
        const maxX = xRange[1];
        const minY = yRange[0];
        const maxY = yRange[1];
        const spawnSpanX = maxX - minX;
        const spawnSpanY = maxY - minY;
        const maxLifetime = state.particleMaxLifetime;
        const fastMap = hasFastCanvasMapping(planeParams);
        const particles = runtime.particles;

        for (let i = 0, length = particles.length; i < length; i++) {
            const particle = particles[i];
            particle.lifetime++;

            let vector = vectorEvaluator ? vectorEvaluator(particle.x, particle.y) : null;
            let alive = !!(vector && isFiniteNumber(vector.vx) && isFiniteNumber(vector.vy));

            if (alive) {
                let magnitudeSq = vector.vx * vector.vx + vector.vy * vector.vy;
                alive = magnitudeSq >= EPSILON * EPSILON && Number.isFinite(magnitudeSq);

                if (alive) {
                    const inverseMagnitude = 1 / Math.sqrt(magnitudeSq);
                    const firstX = vector.vx * inverseMagnitude;
                    const firstY = vector.vy * inverseMagnitude;
                    const midpointX = particle.x + firstX * halfSpeed;
                    const midpointY = particle.y + firstY * halfSpeed;
                    vector = vectorEvaluator(midpointX, midpointY);

                    if (vector && isFiniteNumber(vector.vx) && isFiniteNumber(vector.vy)) {
                        magnitudeSq = vector.vx * vector.vx + vector.vy * vector.vy;
                        if (magnitudeSq >= EPSILON * EPSILON && Number.isFinite(magnitudeSq)) {
                            const secondInverseMagnitude = 1 / Math.sqrt(magnitudeSq);
                            particle.x += vector.vx * secondInverseMagnitude * speed;
                            particle.y += vector.vy * secondInverseMagnitude * speed;
                        } else {
                            particle.x += firstX * speed;
                            particle.y += firstY * speed;
                        }
                    } else {
                        particle.x += firstX * speed;
                        particle.y += firstY * speed;
                    }
                }
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

export function drawConformalityProbeSegments(ctx, planeParams, center_world, tf, isWPlane) {
    if (!isRenderableComplexPoint(center_world)) {
        return;
    }

    if (isWPlane && typeof tf !== 'function') {
        return;
    }

    const segmentRadius = appState.probeNeighborhoodSize / PROBE_CROSSHAIR_SIZE_FACTOR;
    const endpoints = getProbeCrosshairEndpoints(center_world, segmentRadius);
    const horizontalColor = isWPlane
        ? COLOR_PROBE_CONFORMAL_LINE_W_H
        : COLOR_PROBE_CONFORMAL_LINE_Z_H;
    const verticalColor = isWPlane
        ? COLOR_PROBE_CONFORMAL_LINE_W_V
        : COLOR_PROBE_CONFORMAL_LINE_Z_V;

    withSavedContext(ctx, () => {
        configureRoundStroke(ctx, undefined, 2);

        const horizontalStart = transformProbeEndpoint(endpoints.horizontal[0], tf, isWPlane);
        const horizontalEnd = transformProbeEndpoint(endpoints.horizontal[1], tf, isWPlane);
        const verticalStart = transformProbeEndpoint(endpoints.vertical[0], tf, isWPlane);
        const verticalEnd = transformProbeEndpoint(endpoints.vertical[1], tf, isWPlane);

        drawProbeSegment(ctx, planeParams, horizontalStart, horizontalEnd, horizontalColor, isWPlane);
        drawProbeSegment(ctx, planeParams, verticalStart, verticalEnd, verticalColor, isWPlane);
    });
}

export function drawPlanarProbe(ctx, planeParams, _map = null) {
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

        drawConformalityProbeSegments(ctx, planeParams, appState.probeZ, null, false);
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

export function drawPlanarTransformedLine(ctx, planeParams, mappedTransform, z_pts, col) {
    if (!z_pts || z_pts.length === 0 || !mappedTransform) {
        return;
    }

    const renderLimit = getPlanarTransformRenderLimit(planeParams);
    const jumpThresholdSq = getViewportJumpThresholdSq(planeParams);
    const cachedPath = getCachedTransformedPath2D(ctx, planeParams, mappedTransform, z_pts, renderLimit, jumpThresholdSq);

    ctx.strokeStyle = col;
    if (cachedPath) {
        configureRoundStroke(ctx);
        ctx.stroke(cachedPath);
        return;
    }

    const fastMap = hasFastCanvasMapping(planeParams);
    const evalContext = { re: 0, im: 0 };

    ctx.strokeStyle = col;
    configureRoundStroke(ctx);
    ctx.beginPath();

    let pathOpen = false;
    let hasLastMappedPoint = false;
    let lastMappedRe = 0;
    let lastMappedIm = 0;

    for (let i = 0, length = z_pts.length; i < length; i++) {
        const zPoint = z_pts[i];

        if (!isRenderableComplexPoint(zPoint)) {
            pathOpen = strokeOpenPath(ctx, pathOpen);
            hasLastMappedPoint = false;
            continue;
        }

        const mappedPoint = evaluateProfilePoint(mappedTransform, zPoint.re, zPoint.im, evalContext);

        if (!isRenderableComplexPoint(mappedPoint)) {
            pathOpen = strokeOpenPath(ctx, pathOpen);
            hasLastMappedPoint = false;
            continue;
        }

        const mappedRe = mappedPoint.re;
        const mappedIm = mappedPoint.im;

        if (hasLastMappedPoint) {
            const deltaRe = mappedRe - lastMappedRe;
            const deltaIm = mappedIm - lastMappedIm;

            if (deltaRe * deltaRe + deltaIm * deltaIm > jumpThresholdSq) {
                pathOpen = strokeOpenPath(ctx, pathOpen);
            }
        }

        hasLastMappedPoint = true;
        lastMappedRe = mappedRe;
        lastMappedIm = mappedIm;

        if (Math.abs(mappedRe) > renderLimit || Math.abs(mappedIm) > renderLimit) {
            pathOpen = strokeOpenPath(ctx, pathOpen);
            continue;
        }

        pathOpen = appendWorldPointToPath(ctx, planeParams, fastMap, pathOpen, mappedRe, mappedIm);
    }

    if (pathOpen) {
        ctx.stroke();
    }
}

export function findIntersectionWithViewport(p1, p2, planeParams) {
    if (!isFiniteCanvasPoint(p1) || !isFiniteCanvasPoint(p2)) {
        return null;
    }

    const xmin = 0;
    const xmax = planeParams.width;
    const ymin = 0;
    const ymax = planeParams.height;
    let t = Infinity;

    if (p2.y < ymin && p1.y >= ymin) {
        t = Math.min(t, (ymin - p1.y) / (p2.y - p1.y));
    }
    if (p2.y > ymax && p1.y <= ymax) {
        t = Math.min(t, (ymax - p1.y) / (p2.y - p1.y));
    }
    if (p2.x < xmin && p1.x >= xmin) {
        t = Math.min(t, (xmin - p1.x) / (p2.x - p1.x));
    }
    if (p2.x > xmax && p1.x <= xmax) {
        t = Math.min(t, (xmax - p1.x) / (p2.x - p1.x));
    }

    if (Number.isFinite(t) && t >= 0 && t <= 1) {
        return {
            x: p1.x + t * (p2.x - p1.x),
            y: p1.y + t * (p2.y - p1.y)
        };
    }

    return null;
}

export function calculateDynamicPointsForSegment(p1_world, p2_world, tf) {
    if (!isRenderableComplexPoint(p1_world) ||
        !isRenderableComplexPoint(p2_world) ||
        typeof tf !== 'function') {
        return DEFAULT_POINTS_PER_LINE;
    }

    const vectorRe = p2_world.re - p1_world.re;
    const vectorIm = p2_world.im - p1_world.im;
    const lengthSq = vectorRe * vectorRe + vectorIm * vectorIm;
    let evalRe = p1_world.re;
    let evalIm = p1_world.im;

    if (Math.abs(lengthSq) >= DEGENERATE_SEGMENT_EPSILON) {
        const pointToTargetRe = p1_world.re - ZETA_POLE.re;
        const pointToTargetIm = p1_world.im - ZETA_POLE.im;
        const t = -(pointToTargetRe * vectorRe + pointToTargetIm * vectorIm) / lengthSq;
        evalRe += t * vectorRe;
        evalIm += t * vectorIm;
    }

    if (appState.currentFunction === 'zeta' &&
        !appState.zetaContinuationEnabled &&
        (
            (p1_world.re <= ZETA_REFLECTION_POINT_RE && p2_world.re <= ZETA_REFLECTION_POINT_RE) ||
            evalRe <= ZETA_REFLECTION_POINT_RE
        )) {
        return Math.max(240, Math.floor(MIN_POINTS_ADAPTIVE * 0.5));
    }

    if (Math.abs(evalRe - ZETA_POLE.re) < EPSILON && Math.abs(evalIm - ZETA_POLE.im) < EPSILON) {
        evalRe = ZETA_POLE.re + 1e-7;
        evalIm = ZETA_POLE.im + 1e-7;
    }

    const mappedEvalPoint = tf(evalRe, evalIm);
    if (!isStableRenderableComplexPoint(mappedEvalPoint)) {
        return Math.max(1800, Math.floor(MAX_POINTS_ADAPTIVE_DEFAULT * 0.6));
    }

    const bounds = getAdaptiveSamplingBounds();
    const diameterEstimate = Math.sqrt(mappedEvalPoint.re * mappedEvalPoint.re + mappedEvalPoint.im * mappedEvalPoint.im);
    const sampleCount = Math.round(bounds.anchorDensity * diameterEstimate);

    return clamp(sampleCount, bounds.minPoints, bounds.maxPoints);
}

export function generateLinearSegmentPoints(startPoint, endPoint, sampleCount) {
    const steps = Math.max(1, Math.floor(finiteOr(sampleCount, 1)));
    const points = new Array(steps + 1);
    const startRe = startPoint.re;
    const startIm = startPoint.im;
    const stepRe = (endPoint.re - startRe) / steps;
    const stepIm = (endPoint.im - startIm) / steps;

    for (let i = 0; i <= steps; i++) {
        points[i] = {
            re: startRe + stepRe * i,
            im: startIm + stepIm * i
        };
    }

    return points;
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

export function preparePointSetForMappedPlane(pointSet, transformFunc, options = {}) {
    if (!pointSet || !LINEAR_SOURCE_POINT_SET_ROLES.has(pointSet.role)) {
        return pointSet;
    }

    const endpoints = getPointSetEndpoints(pointSet);
    if (!endpoints) {
        return pointSet;
    }

    const sampleCount = options.sampleCountResolver
        ? options.sampleCountResolver(pointSet, endpoints, transformFunc)
        : DEFAULT_POINTS_PER_LINE;
    const normalizedSampleCount = Math.max(2, sampleCount);
    let preparedCache = PREPARED_POINT_SET_CACHE.get(pointSet);
    if (!preparedCache) {
        preparedCache = new Map();
        PREPARED_POINT_SET_CACHE.set(pointSet, preparedCache);
    }

    const cached = preparedCache.get(normalizedSampleCount);
    if (cached &&
        cached.start === endpoints.start &&
        cached.end === endpoints.end &&
        cached.startRe === endpoints.start.re &&
        cached.startIm === endpoints.start.im &&
        cached.endRe === endpoints.end.re &&
        cached.endIm === endpoints.end.im) {
        preparedCache.delete(normalizedSampleCount);
        preparedCache.set(normalizedSampleCount, cached);
        return cached.preparedPointSet;
    }

    const preparedPointSet = Object.assign({}, pointSet, {
        points: generateLinearSegmentPoints(
            endpoints.start,
            endpoints.end,
            normalizedSampleCount
        )
    });

    if (!preparedCache.has(normalizedSampleCount) && preparedCache.size >= PREPARED_POINT_SET_CACHE_ASSOCIATIVITY) {
        preparedCache.delete(preparedCache.keys().next().value);
    } else {
        preparedCache.delete(normalizedSampleCount);
    }

    preparedCache.set(normalizedSampleCount, {
        start: endpoints.start,
        end: endpoints.end,
        startRe: endpoints.start.re,
        startIm: endpoints.start.im,
        endRe: endpoints.end.re,
        endIm: endpoints.end.im,
        preparedPointSet
    });

    return preparedPointSet;
}

export function drawFunctionFociOverlay(ctx, planeParams) {
    if (appState.currentFunction !== 'cos' && appState.currentFunction !== 'sin') {
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
    return appState.currentInputShape === 'line' &&
        (appState.currentFunction === 'cos' || appState.currentFunction === 'sin');
}

export function shouldDrawPlanarInputRadialOverlay() {
    return appState.radialDiscreteStepsEnabled && appState.currentFunction !== 'poincare';
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
}

export function drawPlanarTransformedShape(ctx, planeParams, tf, options = {}) {
    const includeGeometry = options.includeGeometry !== false;
    const includeOverlays = options.includeOverlays !== false;
    const inputShape = appState.currentInputShape;
    const highlightContour = appState.cauchyIntegralModeEnabled &&
        (inputShape === 'circle' || inputShape === 'ellipse');

    if (includeGeometry) {
        if (isRasterInputShape(inputShape)) {
            drawImageWithWebGL(ctx, planeParams, true, options.index || 0, options.map || null);
        } else {
            const pointSets = generateCurrentMappedInputShapePointSets(zPlaneParams, {
                currentFunction: appState.currentFunction,
                zetaContinuationEnabled: appState.zetaContinuationEnabled
            });
            const transformProfile = getMappedTransformProfile(appState.currentFunction, tf);

            drawPointSetCollectionOnPlane(ctx, planeParams, pointSets, {
                transformFunc: tf,
                transformProfile,
                colorResolver: pointSet => highlightContour && pointSet.role === 'shape-curve'
                    ? COLOR_CAUCHY_CONTOUR_W
                    : pointSet.color,
                lineWidthResolver: pointSet => highlightContour && pointSet.role === 'shape-curve'
                    ? 3.5
                    : (pointSet.lineWidth || LINE_WIDTH_NORMAL),
                preparePointSet: pointSet => preparePointSetForMappedPlane(pointSet, tf, {
                    sampleCountResolver: (currentPointSet, endpoints, transformFunc) => appState.currentFunction === 'zeta'
                        ? calculateDynamicPointsForSegment(endpoints.start, endpoints.end, transformFunc)
                        : DEFAULT_POINTS_PER_LINE
                })
            });
        }
    }

    if (includeOverlays && shouldDrawPlanarFunctionFociOverlay()) {
        drawFunctionFociOverlay(ctx, planeParams);
    }
}



export function drawPlanarTransformedProbe(ctx, planeParams, map) {
    withSavedContext(ctx, () => {
        const renderLimit = getPlanarTransformRenderLimit(planeParams);
        const transform = map?.evaluate;
        if (typeof transform !== 'function') return;
        const probeWorldPoint = transform(appState.probeZ.re, appState.probeZ.im);

        if (isStableRenderableComplexPoint(probeWorldPoint)) {
            const probeCanvasPoint = mapToCanvasCoords(probeWorldPoint.re, probeWorldPoint.im, planeParams);
            drawCircleMarker(ctx, probeCanvasPoint, PROBE_MARKER_RADIUS, COLOR_PROBE_MARKER);
        }

        configureRoundStroke(ctx, COLOR_PROBE_NEIGHBORHOOD, 1.5);
        drawMappedProbeNeighborhood(
            ctx,
            planeParams,
            appState.probeZ,
            appState.probeNeighborhoodSize,
            transform,
            renderLimit
        );
        drawConformalityProbeSegments(
            ctx,
            planeParams,
            appState.probeZ,
            transform,
            true
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
    drawVectorFieldCPU(ctx, planeParams, map);
}

export function drawVectorFieldCPU(ctx, planeParams, map) {
    const xRange = getPlaneXRanges(planeParams);
    const yRange = getPlaneYRanges(planeParams);
    const density = clamp(Math.floor(finiteOr(appState.gridDensity, 0) * 0.75), 5, 25);
    const dx = (xRange[1] - xRange[0]) / density;
    const dy = (yRange[1] - yRange[0]) / density;
    const arrowScale = appState.vectorFieldScale || 1;
    const thickness = appState.vectorArrowThickness || 1.5;
    const headSize = appState.vectorArrowHeadSize || 8;
    const brightness = appState.domainBrightness || 1;
    const cellPixels = Math.min(planeParams.width / density, planeParams.height / density);
    const arrowLength = cellPixels * 0.38 * arrowScale;
    const arrowHeadSize = cellPixels * headSize * 0.04;
    const fastMap = hasFastCanvasMapping(planeParams);

    withSavedContext(ctx, () => {
        configureRoundStroke(ctx, undefined, thickness);

        for (let i = 0; i <= density; i++) {
            const x = xRange[0] + i * dx;

            for (let j = 0; j <= density; j++) {
                const y = yRange[0] + j * dy;
                const vector = getVectorFieldValueAtPoint(
                    x,
                    y,
                    map,
                    appState.vectorFieldFunction
                );

                if (!vector) {
                    continue;
                }

                const magnitudeSq = vector.re * vector.re + vector.im * vector.im;
                if (magnitudeSq < EPSILON * EPSILON || !Number.isFinite(magnitudeSq)) {
                    continue;
                }

                const inverseMagnitude = 1 / Math.sqrt(magnitudeSq);
                const directionX = vector.re * inverseMagnitude;
                const directionY = vector.im * inverseMagnitude;
                const color = getArrowColorFromComponents(vector.re, vector.im, brightness);
                const originX = fastMap ? canvasXFast(x, planeParams) : mapToCanvasCoords(x, y, planeParams).x;
                const originY = fastMap ? canvasYFast(y, planeParams) : mapToCanvasCoords(x, y, planeParams).y;
                const tipX = originX + directionX * arrowLength;
                const tipY = originY - directionY * arrowLength;
                const baseCenterX = tipX - directionX * arrowHeadSize * 2.5;
                const baseCenterY = tipY + directionY * arrowHeadSize * 2.5;
                const perpendicularX = -directionY;
                const perpendicularY = -directionX;
                const leftX = baseCenterX + perpendicularX * arrowHeadSize;
                const leftY = baseCenterY - perpendicularY * arrowHeadSize;
                const rightX = baseCenterX - perpendicularX * arrowHeadSize;
                const rightY = baseCenterY + perpendicularY * arrowHeadSize;

                ctx.strokeStyle = color;
                ctx.fillStyle = color;
                ctx.lineWidth = thickness;
                ctx.beginPath();
                ctx.moveTo(originX, originY);
                ctx.lineTo(tipX, tipY);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(tipX, tipY);
                ctx.lineTo(leftX, leftY);
                ctx.lineTo(rightX, rightY);
                ctx.closePath();
                ctx.fill();
            }
        }
    });
}
