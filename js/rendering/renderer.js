import { state, context, zPlaneParams as defaultZPlaneParams, wPlaneParams as defaultWPlaneParams } from '../store/state.js';
import { runtime } from '../store/runtime.js';
import {
    COLOR_CRITICAL_POINT_Z,
    COLOR_CRITICAL_VALUE_W,
    COLOR_FTA_C_MARKER,
    COLOR_W_ORIGIN_GLOW
} from '../constants/colors.js';
import {
    getCanvasBackgroundColor,
    getCanvasTextColor,
    getCanvasGridColors
} from '../frontend/theme.js';
import { MAX_POLY_DEGREE, ZETA_REFLECTION_POINT_RE } from '../constants/numerical.js';
import {
    ORIGIN_GLOW_DURATION_MS,
    PLANAR_CANVAS_SUPERSAMPLE,
    normalizeOrbitColoringMode
} from '../constants/rendering.js';
import { mapToCanvasCoords } from '../utils/canvas-utils.js';
import { resolveActiveMap } from '../math/active-map.js';
import { nativeOptionsForActiveMap } from '../native/map-runtime.js';
import { buildRasterSurfaceMesh, getImageRenderStage } from './draw-image-webgl.js';
import {
    getActiveMediaRaster,
    isMediaInputShape
} from '../utils/raster-media.js';
import { drawLaplaceWindingVisualization, drawLaplaceTimeDomain } from './draw-laplace-panels.js';
import { getLaplaceFrameData } from '../analysis/laplace-transform.js';
import { ThreeManifoldsRenderer } from './3d-manifolds-renderer.js';
import { buildNativeGridFold, findNativePreimages } from '../native/complex-engine.js';
import {
    generateCurrentInputShapePointSets,
    buildInputShapeGeometryConfig,
    isFoldableInputShape
} from './shape-generators.js';
import { drawGraphSelectionOverlay, filterGraphFullGridPointSets } from './transformation-graph.js';
import { hideRiemannSurface, renderRiemannSurface } from './webgl-riemann-surface.js';
import { requireVisibleViewport } from '../utils/viewport.js';
import { requireFiniteNumber, requireInteger, isFiniteComplex } from '../utils/numeric-contracts.js';
import { drawAxes, drawGrid } from './canvas-primitives.js';
import {
    drawZerosAndPolesMarkers,
    drawCriticalPointMarker
} from './draw-primitives.js';
import {
    drawPlanarInputShape,
    drawPlanarTransformedShape,
    createPlanarTransformedShapeRenderJob,
    drawPlanarProbe,
    drawPlanarTransformedProbe,
    drawConformalIndicatrices,
    drawStreamlinesOnZPlane,
    updateAndDrawParticles,
    drawPlanarInputOverlays,
    drawZPlaneVectorField
} from './draw-planar.js';
import { requestRedrawAll, requestUiRedraw } from './redraw-scheduler.js';
import { drawPlanarTaylorApproximation } from './taylor-series.js';
import { drawNavigationLayer } from '../navigation-plane.js';
import { renderPlanarDomainColoring } from './domain-coloring.js';
import { matchesPlanarDomainViewport } from './domain-dynamics.js';
import { updateWindingNumberDisplay } from '../analysis/cauchy.js';
import {
    getDynamicPlottingCacheKey
} from '../analysis/dynamic-plotting.js';
import {
    drawDynamicWPlane,
    drawDynamicZPlane
} from './draw-dynamic-plotting.js';
import { generateTissotIndicatrices, selectStableTissotIndicatrices } from '../analysis/tissot.js';
import { baseExpressionHasBranches } from '../analysis/riemann-surface.js';

function drawPreimageMarkers(ctx, planeParams, points, target = false) {
    if (!Array.isArray(points) || points.length === 0) return;
    ctx.save();
    ctx.fillStyle = target ? '#fb7185' : '#facc15';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    for (const point of points) {
        if (!Number.isFinite(point?.re) || !Number.isFinite(point?.im)) continue;
        const canvas = mapToCanvasCoords(point.re, point.im, planeParams);
        ctx.beginPath();
        ctx.arc(canvas.x, canvas.y, target ? 6 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
    ctx.restore();
}

function drawContinuationValues(ctx, planeParams) {
    const points = state.continuationValues;
    if (!Array.isArray(points) || points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 3;
    ctx.beginPath();
    let active = false;
    for (const point of points) {
        if (!Number.isFinite(point?.re) || !Number.isFinite(point?.im)) { active = false; continue; }
        const canvas = mapToCanvasCoords(point.re, point.im, planeParams);
        if (active) ctx.lineTo(canvas.x, canvas.y);
        else { ctx.moveTo(canvas.x, canvas.y); active = true; }
    }
    ctx.stroke();
    ctx.restore();
}

let wCanvas;
let zCtx;
let wCtx;
let zDomainColorCanvas;
let zDomainColorCtx;
let wCanvasList;
let wCtxList;
let wPlaneParamsList;
let wPlaneThreeContainersList;
const wStaticThreeRenderers = new WeakMap();

const { controls } = context;

let zPlaneParams = defaultZPlaneParams;
let wPlaneParams = defaultWPlaneParams;

let wPlanarTransformedLayerCache;
let wPlanarTransformedLayerCacheList = [];
let wPlanarRenderDeadline = Infinity;
let wPlanarWorkPerformed = false;

const W_PLANAR_FRAME_BUDGET_MS = 8;
const W_PLANAR_POINT_SET_BATCH_SIZE = 8;

const zPlanarInputLayerCache = createLayerCache();
const zFlowLayerCache = createLayerCache();
const conformalIndicatrixCache = { key: null, value: [] };

// Snapshot trackers preserve exact cache invalidation while avoiding per-frame key strings and GC churn.
const planarKeyTrackers = new WeakMap();
const zFlowKeyTracker = { values: [], cursor: 0, changed: true, key: null };
const PLANAR_STATE_DEPENDENCIES = Object.freeze([
    'currentFunction', 'mapPresentation', 'currentInputShape', 'gridDensity',
    'gridParameters',
    'a0', 'b0', 'circleR', 'themeId',
    'arbitraryShapeMode', 'arbitraryShapeExpression', 'arbitraryShapeTMin', 'arbitraryShapeTMax',
    'arbitraryShapeClosed', 'arbitraryShapePoints',
    'branchCutAngle',
    'mediaSize', 'mediaOpacity', 'mediaAspectRatio', 'mediaVersion',
    'cauchyIntegralModeEnabled', 'graphViewEnabled', 'graphFullGridEnabled', 'graphGridFamily',
    'graphLayerLockEnabled',
    'graphSelectedShape', 'graphSelectedLineIndex'
]);
const DOMAIN_STATE_DEPENDENCIES = Object.freeze([
    'domainPalette', 'domainBrightness', 'domainContrast',
    'domainSaturation', 'domainLightnessCycles'
]);
const TAYLOR_LAYER_DEPENDENCIES = Object.freeze([
    'taylorSeriesOrder', 'taylorSeriesConvergenceRadius'
]);

function beginDependencyScan(tracker) {
    tracker.cursor = 0;
    tracker.changed = false;
}

function captureDependency(tracker, value) {
    const index = tracker.cursor++;
    const previous = tracker.values[index];
    if (previous !== value && !(previous !== previous && value !== value)) {
        tracker.values[index] = value;
        tracker.changed = true;
    }
}

function captureComplexDependency(tracker, point) {
    const exists = Boolean(point);
    captureDependency(tracker, exists);
    if (exists) {
        captureDependency(tracker, point.re);
        captureDependency(tracker, point.im);
    }
}

function captureStateDependencies(tracker, keys) {
    for (let index = 0; index < keys.length; index += 1) {
        captureDependency(tracker, state[keys[index]]);
    }
}

function endDependencyScan(tracker) {
    if (tracker.values.length !== tracker.cursor) {
        tracker.values.length = tracker.cursor;
        tracker.changed = true;
    }
    return tracker.changed;
}

function getPlanarKeyTracker(params) {
    let tracker = planarKeyTrackers.get(params);
    if (!tracker) {
        tracker = { values: [], cursor: 0, changed: true, key: null };
        planarKeyTrackers.set(params, tracker);
    }
    return tracker;
}

function createLayerCache() {
    return {
        key: null,
        pendingKey: null,
        canvas: null,
        ctx: null,
        renderJob: null,
        nextPointSet: 0
    };
}

function isPanning(panState) {
    return Boolean(panState?.isPanning);
}

function invalidateCache(cache) {
    if (cache) {
        cache.key = null;
        cache.pendingKey = null;
        cache.renderJob = null;
        cache.nextPointSet = 0;
    }
}

function syncZRenderContext() {
    zCtx = context.zCtx;
    zDomainColorCanvas = context.zDomainColorCanvas;
    zDomainColorCtx = context.zDomainColorCtx;
}

function syncWRenderContext() {
    wCanvas = context.wCanvas;
    wCtx = context.wCtx;
    wCanvasList = context.wCanvasList;
    wCtxList = context.wCtxList;
    wPlaneParamsList = context.wPlaneParamsList;
    wPlaneThreeContainersList = context.wPlaneThreeContainersList;

    const externalCaches = context.wPlanarTransformedLayerCacheList;
    if (Array.isArray(externalCaches)) wPlanarTransformedLayerCacheList = externalCaches;
    else context.wPlanarTransformedLayerCacheList = wPlanarTransformedLayerCacheList;
}

function drawCanvasLayer(ctx, drawCallback) {
    if (!ctx || typeof drawCallback !== 'function') {
        return false;
    }
    drawCallback(ctx);
    return true;
}

function withCanvasState(ctx, draw) {
    if (!ctx || typeof draw !== 'function') {
        return;
    }

    ctx.save();

    try {
        draw();
    } finally {
        ctx.restore();
    }
}

function compositePlanarLayer(cache, targetCtx, planeParams) {
    targetCtx.save?.();
    try {
        if (targetCtx.imageSmoothingEnabled !== undefined) targetCtx.imageSmoothingEnabled = true;
        if (targetCtx.imageSmoothingQuality !== undefined) targetCtx.imageSmoothingQuality = 'high';
        targetCtx.drawImage(
            cache.canvas,
            0, 0, cache.canvas.width, cache.canvas.height,
            0, 0, planeParams.width, planeParams.height
        );
    } finally {
        targetCtx.restore?.();
    }
}

function preparePlanarLayer(cache, planeParams, renderScale, clear) {
    const width = Math.max(1, Math.ceil(planeParams.width * renderScale));
    const height = Math.max(1, Math.ceil(planeParams.height * renderScale));
    const resized = cache.canvas.width !== width || cache.canvas.height !== height;
    if (resized) {
        cache.canvas.width = width;
        cache.canvas.height = height;
        invalidateCache(cache);
    }
    if (clear) {
        cache.ctx.setTransform(1, 0, 0, 1, 0, 0);
        cache.ctx.clearRect(0, 0, width, height);
    }
    cache.ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    return resized;
}

// Every cached and uncached planar vector layer uses this same supersampled Canvas path.
function renderThroughCache(cache, targetCtx, planeParams, cacheKey, enabled, render, renderUncached = render) {
    if (!targetCtx || !planeParams || typeof render !== 'function') return true;
    const renderScale = isMediaInputShape(state.currentInputShape) ? 1 : PLANAR_CANVAS_SUPERSAMPLE;

    if (enabled && cache?.canvas && cache.key === cacheKey) {
        compositePlanarLayer(cache, targetCtx, planeParams);
        return true;
    }
    if (!cache || planeParams.width <= 0 || planeParams.height <= 0 || typeof document === 'undefined') return false;

    if (!cache.canvas) {
        cache.canvas = document.createElement('canvas');
        cache.ctx = cache.canvas.getContext('2d');
        if (!cache.ctx) {
            cache.canvas = null;
            return false;
        }
    }

    if (!enabled) {
        invalidateCache(cache);
        preparePlanarLayer(cache, planeParams, renderScale, true);
        const complete = renderUncached(cache.ctx, cacheKey, true) !== false;
        compositePlanarLayer(cache, targetCtx, planeParams);
        return complete;
    }

    const resized = preparePlanarLayer(cache, planeParams, renderScale, false);
    const fresh = resized || cache.pendingKey !== cacheKey;
    if (fresh) {
        preparePlanarLayer(cache, planeParams, renderScale, true);
        cache.pendingKey = cacheKey;
    }

    const complete = render(cache.ctx, cacheKey, fresh) !== false;
    if (complete) {
        cache.key = cacheKey;
        cache.pendingKey = null;
    } else {
        cache.key = null;
    }

    compositePlanarLayer(cache, targetCtx, planeParams);
    return complete;
}

function normalizedPolynomialDegree() {
    const degree = requireInteger(state.polynomialN, 'Renderer polynomial degree');
    if (degree < 0 || degree > MAX_POLY_DEGREE) {
        throw new Error(`Renderer polynomial degree must be from zero through ${MAX_POLY_DEGREE}.`);
    }
    return degree;
}

function captureNamedTransformDependencies(tracker, name) {
    switch (name) {
        case 'mobius':
            captureComplexDependency(tracker, state.mobiusA);
            captureComplexDependency(tracker, state.mobiusB);
            captureComplexDependency(tracker, state.mobiusC);
            captureComplexDependency(tracker, state.mobiusD);
            return;
        case 'polynomial': {
            const degree = normalizedPolynomialDegree();
            const coeffs = state.polynomialCoeffs;
            captureDependency(tracker, degree);
            for (let index = 0; index <= degree; index += 1) {
                if (!Array.isArray(coeffs) || !coeffs[index]) {
                    throw new Error(`Renderer polynomial coefficient ${index} is missing.`);
                }
                captureComplexDependency(tracker, coeffs[index]);
            }
            return;
        }
        case 'power':
            captureDependency(tracker, state.fractionalPowerN);
            return;
        case 'exp':
            captureComplexDependency(tracker, state.expBase);
            return;
        case 'ln':
            captureComplexDependency(tracker, state.logBase);
            return;
        case 'bessel':
            captureComplexDependency(tracker, state.besselOrder);
            return;
        default:
            return;
    }
}

function captureAlgebraicDependencies(tracker) {
    const terms = Array.isArray(state.algebraicChainingTerms) ? state.algebraicChainingTerms : [];
    captureDependency(tracker, Boolean(state.algebraicChainingEnabled));
    captureDependency(tracker, terms.length);
    captureDependency(tracker, state.algebraicChainingZExpr || 'z');

    for (let termIndex = 0; termIndex < terms.length; termIndex += 1) {
        const term = terms[termIndex];
        const factors = Array.isArray(term?.factors) ? term.factors : [];
        captureComplexDependency(tracker, term?.coeff);
        captureDependency(tracker, factors.length);

        for (let factorIndex = 0; factorIndex < factors.length; factorIndex += 1) {
            const factor = factors[factorIndex];
            const exists = Boolean(factor);
            captureDependency(tracker, exists);
            if (!exists) continue;

            captureDependency(tracker, factor.func);
            if (factor.func === 'none') continue;

            captureDependency(tracker, factor.chainedFunc);
            captureDependency(tracker, factor.power);
            captureDependency(tracker, Boolean(factor.reciprocal));
            captureDependency(tracker, Boolean(factor.log));
            captureDependency(tracker, Boolean(factor.exp));
            if (factor.log) captureComplexDependency(tracker, state.logBase);
            if (factor.exp) captureComplexDependency(tracker, state.expBase);
            captureNamedTransformDependencies(tracker, factor.func);
            if (factor.chainedFunc !== factor.func) {
                captureNamedTransformDependencies(tracker, factor.chainedFunc);
            }
        }
    }
}

function scanPlanarLayerDependencies(isWPlane, tracker) {
    const params = isWPlane ? wPlaneParams : zPlaneParams;
    const taylorEnabled = isWPlane && state.taylorSeriesEnabled;
    beginDependencyScan(tracker);
    captureDependency(tracker, isWPlane);
    captureDependency(tracker, taylorEnabled);

    if (taylorEnabled) {
        captureComplexDependency(tracker, state.taylorSeriesCenter);
        captureStateDependencies(tracker, TAYLOR_LAYER_DEPENDENCIES);
    }

    captureStateDependencies(tracker, PLANAR_STATE_DEPENDENCIES);
    captureDependency(tracker, Boolean(state.conformalGridEnabled));
    captureDependency(tracker, Boolean(state.zetaContinuationEnabled));
    captureDependency(tracker, state.gridColor1);
    captureDependency(tracker, state.gridColor2);
    captureDependency(tracker, state.videoProcessingFps);
    captureDependency(tracker, getDynamicPlottingCacheKey());

    const domainEnabled = Boolean(state.domainColoringEnabled);
    captureDependency(tracker, domainEnabled);
    if (domainEnabled) {
        captureStateDependencies(tracker, DOMAIN_STATE_DEPENDENCIES);
        captureDependency(tracker, normalizeOrbitColoringMode(state.orbitColoringMode));
    }

    requireVisibleViewport(zPlaneParams, 'Planar cache viewport');
    const sourceX = zPlaneParams.currentVisXRange;
    const sourceY = zPlaneParams.currentVisYRange;
    captureDependency(tracker, sourceX[0]);
    captureDependency(tracker, sourceX[1]);
    captureDependency(tracker, sourceY[0]);
    captureDependency(tracker, sourceY[1]);
    captureDependency(tracker, params?.origin?.x);
    captureDependency(tracker, params?.origin?.y);
    captureDependency(tracker, params?.scale?.x);
    captureDependency(tracker, params?.scale?.y);
    captureDependency(tracker, params?.width);
    captureDependency(tracker, params?.height);

    if (state.currentFunction === 'algebraic_chaining') {
        captureAlgebraicDependencies(tracker);
    } else {
        captureNamedTransformDependencies(tracker, state.currentFunction);
    }

    const chainingEnabled = Boolean(state.chainingEnabled);
    captureDependency(tracker, chainingEnabled);
    if (chainingEnabled) {
        captureDependency(tracker, state.chainingMode);
        captureComplexDependency(tracker, state.chainSeed);
        captureDependency(tracker, state.chainCount);
        captureDependency(tracker, normalizeOrbitColoringMode(state.orbitColoringMode));
    }
    return endDependencyScan(tracker);
}

let nextLayerCacheKeyRevision = 1;

function createLayerCacheKey(prefix) {
    const revision = nextLayerCacheKeyRevision++;
    return `${prefix}:${revision}`;
}

function buildPlanarLayerCacheKey(isWPlane) {
    const params = isWPlane ? wPlaneParams : zPlaneParams;
    const tracker = getPlanarKeyTracker(params);
    if (scanPlanarLayerDependencies(isWPlane, tracker) || tracker.key === null) {
        tracker.key = createLayerCacheKey(isWPlane ? 'w' : 'z');
    }
    return tracker.key;
}

function scanZFlowLayerDependencies(tracker) {
    beginDependencyScan(tracker);
    captureDependency(tracker, buildPlanarLayerCacheKey(false));
    captureDependency(tracker, Boolean(state.vectorFieldEnabled || state.streamlineFlowEnabled));
    captureDependency(tracker, state.vectorFieldFunction);
    captureDependency(tracker, Boolean(state.streamlineFlowEnabled));
    captureDependency(tracker, state.vectorFieldScale);
    captureDependency(tracker, state.vectorArrowThickness);
    captureDependency(tracker, state.vectorArrowHeadSize);
    captureDependency(tracker, state.streamlineStepSize);
    captureDependency(tracker, state.streamlineMaxLength);
    captureDependency(tracker, state.streamlineThickness);
    captureDependency(tracker, state.streamlineSeedDensityFactor);
    if (state.vectorFieldEnabled && !state.streamlineFlowEnabled) {
        captureDependency(tracker, state.domainBrightness);
    }
    return endDependencyScan(tracker);
}

function buildZFlowLayerCacheKey() {
    if (scanZFlowLayerDependencies(zFlowKeyTracker) || zFlowKeyTracker.key === null) {
        zFlowKeyTracker.key = createLayerCacheKey('z-flow');
    }
    return zFlowKeyTracker.key;
}

function shouldUseWPlanarTransformedLayerCache() {
    return !state.manifold3dViewEnabled
        && !state.navigationModeEnabled
        && !(isMediaInputShape() && runtime.media.video)
        && !isPanning(runtime.interaction.panZ)
        && !isPanning(runtime.interaction.panW);
}

function shouldUseZPlanarInputLayerCache() {
    return !state.navigationModeEnabled
        && !state.vectorFieldEnabled
        && !(state.manifold3dViewEnabled && state.manifoldTransformationEnabled)
        && !(isMediaInputShape() && runtime.media.video)
        && !isPanning(runtime.interaction.panZ);
}

function shouldUseZFlowLayerCache() {
    return (state.vectorFieldEnabled || state.streamlineFlowEnabled)
        && !(state.manifold3dViewEnabled && state.manifoldTransformationEnabled)
        && !isPanning(runtime.interaction.panZ);
}

function fillCanvasBackground(ctx, planeParams) {
    if (!ctx || !planeParams) {
        return;
    }

    ctx.fillStyle = getCanvasBackgroundColor();
    ctx.fillRect(0, 0, planeParams.width, planeParams.height);
}

function drawDomainOrSolidBackground(ctx, domainCanvas, planeParams) {
    if (state.domainColoringEnabled && domainCanvas) {
        withCanvasState(ctx, () => {
            fillCanvasBackground(ctx, planeParams);
            if (matchesPlanarDomainViewport(runtime.rendering.domainViewport, planeParams)) {
                ctx.drawImage(domainCanvas, 0, 0);
            }
        });
        return;
    }

    fillCanvasBackground(ctx, planeParams);
}

function getPlaneRanges(planeParams) {
    requireVisibleViewport(planeParams);
    const [xMin, xMax] = planeParams.currentVisXRange;
    const [yMin, yMax] = planeParams.currentVisYRange;

    return { xMin, xMax, yMin, yMax };
}

function drawZetaUndefinedRegionOverlay(ctx, planeParams) {
    if (state.currentFunction !== 'zeta' || state.zetaContinuationEnabled) {
        return;
    }

    const { xMin, xMax, yMin, yMax } = getPlaneRanges(planeParams);

    if (![xMin, xMax, yMin, yMax].every(Number.isFinite)) {
        return;
    }

    const xBoundary = ZETA_REFLECTION_POINT_RE;
    const xMaxRect = Math.min(xBoundary, xMax);

    if (xMaxRect <= xMin) {
        return;
    }

    const topLeft = mapToCanvasCoords(xMin, yMax, planeParams);
    const bottomRight = mapToCanvasCoords(xMaxRect, yMin, planeParams);

    withCanvasState(ctx, () => {
        ctx.fillStyle = 'rgba(30,30,60,0.35)';
        ctx.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
        ctx.fillStyle = 'rgba(180,180,220,0.6)';
        ctx.font = "italic 11px 'SF Pro Text',sans-serif";
        ctx.textAlign = 'center';

        if (xMaxRect - xMin > 50 / planeParams.scale.x) {
            const textXWorld = (xMin + xMaxRect) / 2;
            const textYWorld = yMin + 0.2 * (yMax - yMin);
            const textCanvas = mapToCanvasCoords(textXWorld, textYWorld, planeParams);

            ctx.fillText(`Re(z) ≤ ${xBoundary.toFixed(1)} (Undefined by Sum)`, textCanvas.x, textCanvas.y);
        }
    });
}

function drawTaylorConvergenceOverlay(ctx, planeParams) {
    if (!state.taylorSeriesEnabled || !isFiniteComplex(state.taylorSeriesCenter)) {
        return;
    }

    const radius = state.taylorSeriesConvergenceRadius;
    const centerCanvas = mapToCanvasCoords(
        state.taylorSeriesCenter.re,
        state.taylorSeriesCenter.im,
        planeParams
    );

    if (Number.isFinite(radius) && radius > 1e-9) {
        const radiusCanvas = radius * planeParams.scale.x;

        if (radiusCanvas >= Math.max(planeParams.width, planeParams.height) * 2) {
            return;
        }

        withCanvasState(ctx, () => {
            ctx.fillStyle = state.gridColor2;
            ctx.strokeStyle = state.gridColor2;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(centerCanvas.x, centerCanvas.y, radiusCanvas, 0, 2 * Math.PI);
            ctx.globalAlpha = 0.2;
            ctx.fill();
            ctx.globalAlpha = 0.5;
            ctx.stroke();
        });

        return;
    }

    if (radius === 0) {
        withCanvasState(ctx, () => {
            ctx.fillStyle = state.gridColor2;
            ctx.globalAlpha = 0.5;
            ctx.beginPath();
            ctx.arc(centerCanvas.x, centerCanvas.y, 2, 0, 2 * Math.PI);
            ctx.fill();
        });
    }
}

function drawTaylorPickerReticle(ctx, planeParams, isZ) {
    if ((!state.taylorSeriesCanvasClickCenterEnabled && !state.canvasClickPickerTarget) || !state.taylorSeriesHoverPoint) return;
    if (state.taylorSeriesHoverPoint.isZ !== isZ) return;

    const { world } = state.taylorSeriesHoverPoint;
    const pt = mapToCanvasCoords(world.x, world.y, planeParams);
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;

    withCanvasState(ctx, () => {
        // Glowing circle around mouse
        const radius = 24;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = state.gridColor2;
        ctx.globalAlpha = 0.2;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = state.gridColor2;
        ctx.globalAlpha = 0.95;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Inner center dot
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = state.gridColor2;
        ctx.stroke();

        // Subtle crosshairs
        ctx.beginPath();
        ctx.moveTo(pt.x - 32, pt.y);
        ctx.lineTo(pt.x - 10, pt.y);
        ctx.moveTo(pt.x + 10, pt.y);
        ctx.lineTo(pt.x + 32, pt.y);
        ctx.moveTo(pt.x, pt.y - 32);
        ctx.lineTo(pt.x, pt.y - 10);
        ctx.moveTo(pt.x, pt.y + 10);
        ctx.lineTo(pt.x, pt.y + 32);
        ctx.strokeStyle = state.gridColor2;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Coordinate text badge
        const reVal = Number(world.x);
        const imVal = Number(world.y);
        const reStr = reVal.toFixed(2);
        const imSign = imVal < 0 ? '−' : '+';
        const imStr = Math.abs(imVal).toFixed(2);
        const text = `z₀ = ${reStr} ${imSign} ${imStr}i`;

        ctx.font = '600 11px system-ui, -apple-system, sans-serif';
        const textWidth = ctx.measureText(text).width;
        const badgeX = pt.x + 18;
        const badgeY = pt.y - 18;

        ctx.fillStyle = getCanvasBackgroundColor();
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(badgeX - 5, badgeY - 13, textWidth + 10, 18, 5);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = getCanvasTextColor();
        ctx.fillText(text, badgeX, badgeY);
    });
}

function drawPolynomialOriginMarkerOverlay(ctx, planeParams) {
    if (
        state.currentFunction !== 'polynomial'
        || state.currentInputShape !== 'circle'
        || !state.polynomialCoeffs?.length
    ) {
        return;
    }

    const cValue = state.polynomialCoeffs[0];

    if (!isFiniteComplex(cValue)) {
        return;
    }

    const canvasPoint = mapToCanvasCoords(cValue.re, cValue.im, planeParams);

    withCanvasState(ctx, () => {
        ctx.fillStyle = COLOR_FTA_C_MARKER;
        ctx.beginPath();
        ctx.arc(canvasPoint.x, canvasPoint.y, 5, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = getCanvasTextColor();
        ctx.font = "10px 'SF Pro Text', sans-serif";
        ctx.textAlign = 'center';
        ctx.fillText('P(0)', canvasPoint.x, canvasPoint.y - 10);
    });
}

function drawWOriginGlowOverlay(ctx, planeParams) {
    const startedAt = requireFiniteNumber(runtime.rendering.wOriginGlowTime, 'W-origin glow timestamp');

    if (startedAt <= 0) {
        return;
    }

    const elapsed = Date.now() - startedAt;

    if (elapsed >= ORIGIN_GLOW_DURATION_MS) {
        runtime.rendering.wOriginGlowTime = 0;
        return;
    }

    const glowAlpha = 1 - elapsed / ORIGIN_GLOW_DURATION_MS;
    const originCanvas = mapToCanvasCoords(0, 0, planeParams);

    withCanvasState(ctx, () => {
        ctx.fillStyle = COLOR_W_ORIGIN_GLOW.replace('0.7', (glowAlpha * 0.7).toFixed(2));
        ctx.beginPath();
        ctx.arc(originCanvas.x, originCanvas.y, 8 + (1 - glowAlpha) * 12, 0, 2 * Math.PI);
        ctx.fill();
    });
}

function getConformalIndicatrixData(map) {
    requireVisibleViewport(zPlaneParams, 'Conformal-grid viewport');
    const xRange = zPlaneParams.currentVisXRange;
    const yRange = zPlaneParams.currentVisYRange;
    const key = [
        map.signature,
        state.gridDensity,
        xRange[0], xRange[1],
        yRange[0], yRange[1]
    ].join('|');

    if (conformalIndicatrixCache.key !== key) {
        conformalIndicatrixCache.key = key;
        conformalIndicatrixCache.value = selectStableTissotIndicatrices(
            generateTissotIndicatrices(nativeOptionsForActiveMap(map), xRange, yRange, state.gridDensity, 72)
        );
    }
    return conformalIndicatrixCache.value;
}

function renderZPlaneFlowLayer(targetCtx, planeParams, map, cacheMeta = null) {
    if (!state.streamlineFlowEnabled) {
        drawZPlaneVectorField(targetCtx, planeParams, map);
        return true;
    }

    let complete = true;
    const rendered = drawCanvasLayer(targetCtx, layerCtx => {
        complete = drawStreamlinesOnZPlane(layerCtx, planeParams, state, map, {
            cacheKey: cacheMeta?.cacheKey || null,
            fresh: cacheMeta ? !!cacheMeta.fresh : true
        }) !== false;
    });
    return rendered && complete;
}

function drawCriticalMarkers(ctx, planeParams, points, color) {
    if (!Array.isArray(points)) return;
    for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        if (!isFiniteComplex(point)) continue;
        drawCriticalPointMarker(ctx, mapToCanvasCoords(point.re, point.im, planeParams), color);
    }
}

export function drawZPlaneContent(timestamp) {
    syncZRenderContext();

    if (state.laplaceModeEnabled) {
        if (zCtx && zPlaneParams) {
            const signal = state.laplaceTimeDomainSignal;
            drawLaplaceTimeDomain(zCtx, signal, zPlaneParams, getLaplaceFrameData(signal));
        }
        return;
    }

    // The ordinary planar path below uses the active-map evaluator for shapes,
    // overlays, and transformed geometry. Domain coloring is a separate pixel
    // pipeline: it snapshots state and dispatches native RGBA tile work to
    // workers rather than evaluating through this map object.
    const map = resolveActiveMap();
    if (state.manifoldTransformationEnabled) {
        return;
    }

    if (state.domainColoringEnabled && context.domainColoringDirty && zDomainColorCtx) {
        renderPlanarDomainColoring(zDomainColorCtx, zPlaneParams);
    }
    if (!zCtx || !zPlaneParams) {
        if (state.navigationModeEnabled) {
            invalidateCache(zFlowLayerCache);
            invalidateCache(zPlanarInputLayerCache);
            drawNavigationLayer(zCtx, zPlaneParams);
        } else if (state.vectorFieldEnabled || state.streamlineFlowEnabled) {
            invalidateCache(zPlanarInputLayerCache);
            buildZFlowLayerCacheKey();
        } else {
            invalidateCache(zFlowLayerCache);
            buildPlanarLayerCacheKey(false);
        }
        if (state.conformalGridEnabled) getConformalIndicatrixData(map);
        if (!state.particleAnimationEnabled || state.navigationModeEnabled) {
            runtime.particlesLastUpdateTime = null;
        }
        return;
    }

    drawDomainOrSolidBackground(zCtx, zDomainColorCanvas, zPlaneParams);
    drawAxes(zCtx, zPlaneParams, 'Re(z)', 'Im(z)');
    drawZetaUndefinedRegionOverlay(zCtx, zPlaneParams);
    if (!state.domainColoringEnabled
        && !state.navigationModeEnabled
        && !state.vectorFieldEnabled
        && !state.streamlineFlowEnabled
        && state.currentInputShape !== 'empty_grid') {
        const gridColors = getCanvasGridColors();
        drawGrid(zCtx, zPlaneParams, {
            targetCount: state.gridDensity,
            minorColor: gridColors.minorColor,
            majorColor: gridColors.majorColor
        });
    }

    if (state.navigationModeEnabled) {
        invalidateCache(zFlowLayerCache);
        invalidateCache(zPlanarInputLayerCache);
        drawNavigationLayer(zCtx, zPlaneParams);
    } else if (state.vectorFieldEnabled || state.streamlineFlowEnabled) {
        invalidateCache(zPlanarInputLayerCache);
        const cacheKey = buildZFlowLayerCacheKey();
        renderThroughCache(
            zFlowLayerCache,
            zCtx,
            zPlaneParams,
            cacheKey,
            shouldUseZFlowLayerCache(),
            (targetCtx, key, fresh) => renderZPlaneFlowLayer(
                targetCtx,
                zPlaneParams,
                map,
                { cacheKey: key, fresh }
            )
        );
    } else {
        invalidateCache(zFlowLayerCache);
        renderThroughCache(
            zPlanarInputLayerCache,
            zCtx,
            zPlaneParams,
            buildPlanarLayerCacheKey(false),
            shouldUseZPlanarInputLayerCache(),
            cacheCtx => drawPlanarInputShape(cacheCtx, zPlaneParams)
        );
        if (state.radialDiscreteStepsEnabled || baseExpressionHasBranches(state)) {
            drawPlanarInputOverlays(zCtx, zPlaneParams);
        }
    }

    if (state.dynamicPlotting?.enabled) drawDynamicZPlane(zCtx, zPlaneParams);
    if (!state.navigationModeEnabled) {
        if (state.showZerosPoles) {
            drawCanvasLayer(zCtx, layerCtx => {
                drawZerosAndPolesMarkers(layerCtx, zPlaneParams);
            });
        }
        if (state.showCriticalPoints && state.criticalPoints?.length) {
            drawCanvasLayer(zCtx, layerCtx => {
                drawCriticalMarkers(layerCtx, zPlaneParams, state.criticalPoints, COLOR_CRITICAL_POINT_Z);
            });
        }
    }
    if (state.graphViewEnabled) drawGraphSelectionOverlay(zCtx, zPlaneParams);
    if (state.conformalGridEnabled) {
        const indicatrices = getConformalIndicatrixData(map);
        drawCanvasLayer(zCtx, layerCtx => {
            drawConformalIndicatrices(layerCtx, zPlaneParams, indicatrices, 'source');
        });
    }
    if (state.taylorSeriesEnabled && !state.navigationModeEnabled) {
        drawTaylorConvergenceOverlay(zCtx, zPlaneParams);
    }
    if (state.probeActive && !state.navigationModeEnabled && !isPanning(runtime.interaction.panZ)) {
        drawCanvasLayer(zCtx, layerCtx => {
            drawPlanarProbe(layerCtx, zPlaneParams);
        });
    }
    if (state.preimageExplorerEnabled && state.preimageRoots.length) {
        drawCanvasLayer(zCtx, layerCtx => drawPreimageMarkers(layerCtx, zPlaneParams, state.preimageRoots));
    }
    if (state.taylorSeriesCanvasClickCenterEnabled || state.canvasClickPickerTarget) {
        drawCanvasLayer(zCtx, layerCtx => drawTaylorPickerReticle(layerCtx, zPlaneParams, true));
    }

    if (!state.particleAnimationEnabled || state.navigationModeEnabled) {
        runtime.particlesLastUpdateTime = null;
    } else {
        updateAndDrawParticles(zCtx, zPlaneParams, state, map, timestamp);
    }
}

function ensureWPlaneCache(index) {
    while (wPlanarTransformedLayerCacheList.length <= index) {
        wPlanarTransformedLayerCacheList.push(createLayerCache());
    }

    return wPlanarTransformedLayerCacheList[index];
}

function setWThreeHidden(hidden) {
    const container = controls.wPlaneThreeContainer;
    if (hidden) wStaticThreeRenderers.get(container)?.stopAnimationLoop();
}

function setWPresentation(mode) {
    setWThreeHidden(mode !== 'three');
    if (mode === 'three') {
        const container = controls.wPlaneThreeContainer;
        if (container?.style && wPlaneParams?.width && wPlaneParams?.height) {
            container.style.width = `${wPlaneParams.width}px`;
            container.style.height = `${wPlaneParams.height}px`;
        }
    }
}

// A scalar scope keeps multi-plane rendering re-entrant without allocating closure/context objects.
function renderSingleWPlane(index, map, isSpecialMode, options) {
    const previousCanvas = wCanvas;
    const previousCtx = wCtx;
    const previousParams = wPlaneParams;
    const previousThreeContainer = controls.wPlaneThreeContainer;
    const previousCache = wPlanarTransformedLayerCache;

    wCanvas = wCanvasList?.[index];
    wCtx = wCtxList?.[index];
    wPlaneParams = wPlaneParamsList?.[index];
    controls.wPlaneThreeContainer = wPlaneThreeContainersList?.[index];
    wPlanarTransformedLayerCache = ensureWPlaneCache(index);

    try {
        if (!wCtx || !wPlaneParams) return;
        if (isSpecialMode) {
            hideRiemannSurface(wCanvas);
            setWPresentation('canvas');
            if (state.laplaceModeEnabled) {
                const signal = state.laplaceTimeDomainSignal;
                drawLaplaceWindingVisualization(
                    wCtx,
                    signal,
                    wPlaneParams,
                    getLaplaceFrameData(signal),
                    { showIntegralEvaluation: !state.laplaceHideIntegralEvaluation }
                );
            }
            return;
        }
        if (renderRiemannSurfaceIfEnabled(index, map, options.renderRiemannSurface !== false)) {
            return;
        }
        if (state.manifoldTransformationEnabled || state.manifold3dViewEnabled) {
            setWPresentation('hidden');
            return;
        }
        if (state.foldSurface3dEnabled) {
            if (isMediaInputShape(state.currentInputShape)) {
                renderThreeWRasterSurface(map);
                return;
            }
            if (isFoldableInputShape(state.currentInputShape)) {
                renderThreeWGridFold(map);
                return;
            }
        }

        setWPresentation('canvas');
        fillCanvasBackground(wCtx, wPlaneParams);
        drawAxes(wCtx, wPlaneParams, 'Re(w)', 'Im(w)');
        drawPolynomialOriginMarkerOverlay(wCtx, wPlaneParams);
        drawWOriginGlowOverlay(wCtx, wPlaneParams);
        if (!state.navigationModeEnabled && state.currentInputShape !== 'empty_grid') {
            const gridColors = getCanvasGridColors();
            drawGrid(wCtx, wPlaneParams, {
                targetCount: state.gridDensity,
                minorColor: gridColors.minorColor,
                majorColor: gridColors.majorColor
            });
        }

        if (state.taylorSeriesEnabled
            && map.presentation !== 'derivative'
            && !state.navigationModeEnabled) {
            const cacheKey = buildPlanarLayerCacheKey(true);
            renderThroughCache(
                wPlanarTransformedLayerCache,
                wCtx,
                wPlaneParams,
                cacheKey,
                shouldUseWPlanarTransformedLayerCache(),
                drawTaylorApproximationLayer,
                targetCtx => drawCanvasLayer(targetCtx, drawTaylorApproximationLayer)
            );
        } else {
            renderWPlanarTransformedShape(index, map);
        }

        if (state.dynamicPlotting?.enabled) {
            drawDynamicWPlane(wCtx, wPlaneParams, map.evaluate, index);
        }
        if (state.preimageExplorerEnabled && state.preimageTarget) {
            drawCanvasLayer(wCtx, layerCtx => {
                drawPreimageMarkers(layerCtx, wPlaneParams, [state.preimageTarget], true);
                if (state.preimageStatus) {
                    layerCtx.fillStyle = '#ffffff';
                    layerCtx.font = '12px sans-serif';
                    layerCtx.fillText(state.preimageStatus, 12, 20);
                }
            });
        }
        if (state.continuationValues.length > 1) {
            drawCanvasLayer(wCtx, layerCtx => drawContinuationValues(layerCtx, wPlaneParams));
        }
        if (state.showCriticalPoints
            && !state.navigationModeEnabled
            && Array.isArray(state.criticalValues)
            && state.criticalValues.length > 0) {
            drawCanvasLayer(wCtx, layerCtx => {
                drawCriticalMarkers(layerCtx, wPlaneParams, state.criticalValues, COLOR_CRITICAL_VALUE_W);
            });
        }
        if (state.probeActive && !state.navigationModeEnabled) {
            drawCanvasLayer(wCtx, layerCtx => {
                drawPlanarTransformedProbe(layerCtx, wPlaneParams, map);
            });
        }
        if (state.conformalGridEnabled) {
            const indicatrices = getConformalIndicatrixData(map);
            drawCanvasLayer(wCtx, layerCtx => {
                drawConformalIndicatrices(layerCtx, wPlaneParams, indicatrices, 'mapped');
            });
        }
        if (state.taylorSeriesCanvasClickCenterEnabled || state.canvasClickPickerTarget) {
            drawCanvasLayer(wCtx, layerCtx => drawTaylorPickerReticle(layerCtx, wPlaneParams, false));
        }
        if (index === 0) updateWindingNumberDisplay();
    } finally {
        wCanvas = previousCanvas;
        wCtx = previousCtx;
        wPlaneParams = previousParams;
        controls.wPlaneThreeContainer = previousThreeContainer;
        wPlanarTransformedLayerCache = previousCache;
    }
}

function renderRiemannSurfaceIfEnabled(index, map, enabled) {
    if (!state.riemannSurfaceEnabled) {
        hideRiemannSurface(wCanvas);
        return false;
    }

    if (wPlaneParams?.preciseViewport) {
        hideRiemannSurface(wCanvas);
        setWThreeHidden(true);
        setWPresentation('canvas');
        fillCanvasBackground(wCtx, wPlaneParams);
        wCtx.save();
        wCtx.fillStyle = getCanvasTextColor();
        wCtx.font = '13px sans-serif';
        wCtx.textAlign = 'center';
        wCtx.fillText('Riemann surface is unavailable beyond GPU precision.', wPlaneParams.width * 0.5, 28);
        wCtx.restore();
        return true;
    }

    setWThreeHidden(true);
    if (!enabled) return true;

    const stage = state.chainingEnabled && state.chainCount > 25
        ? state.chainCount
        : index + 1;
    context.riemannSurfaceContourPipeline = { index, stage, map };
    if (!wCanvas) throw new Error('Riemann surface rendering requires a W-plane canvas.');
    renderRiemannSurface(wCanvas, { stage, map, planeIndex: index });
    wCanvas.classList?.toggle('hidden', true);
    return true;
}

function prepareThreeWRenderer() {
    const container = controls.wPlaneThreeContainer;
    if (!container) {
        throw new Error('Three-dimensional W-plane rendering requires its container.');
    }

    setWPresentation('three');
    let renderer = wStaticThreeRenderers.get(container);
    if (!renderer) {
        renderer = new ThreeManifoldsRenderer(container, 'w');
        wStaticThreeRenderers.set(container, renderer);
    }
    renderer.onFoldTargetSelected = target => {
        const map = resolveActiveMap();
        const xRange = zPlaneParams.currentVisXRange;
        const yRange = zPlaneParams.currentVisYRange;
        state.preimageTarget = target;
        state.preimageRoots = findNativePreimages({
            density: 18,
            maxIterations: 28,
            map: nativeOptionsForActiveMap(map),
            target,
            xRange,
            yRange
        });
        state.preimageStatus = `${state.preimageRoots.length} preimage${state.preimageRoots.length === 1 ? '' : 's'}`;
        requestUiRedraw();
    };
    return renderer;
}

function renderThreeWRasterSurface(map) {
    const raster = getActiveMediaRaster();
    if (!raster) {
        throw new Error('Raster fold rendering requires a decoded raster source.');
    }

    const threeRenderer = prepareThreeWRenderer();

    const xRange = wPlaneParams.currentVisXRange;
    const yRange = wPlaneParams.currentVisYRange;
    const rasterStage = getImageRenderStage(map);
    const surfaceKey = [
        rasterStage,
        map.signature,
        raster.token,
        raster.center.re,
        raster.center.im,
        raster.size.width,
        raster.size.height,
        state.foldSurfaceHeightScale,
        xRange[0], xRange[1], yRange[0], yRange[1]
    ].join('|');

    let surface = threeRenderer.rasterSurfaceKey === surfaceKey
        ? threeRenderer.rasterSurfaceData
        : null;
    if (!surface) {
        surface = buildRasterSurfaceMesh(wPlaneParams, map, raster);
        threeRenderer.rasterSurfaceKey = surfaceKey;
    }

    threeRenderer.setRasterSurface(
        surface,
        raster.source,
        raster.opacity,
        state.foldSurfaceHeightScale
    );

    threeRenderer.setFoldPreimageMarkers(state.preimageRoots, state.preimageTarget, map);

    threeRenderer.render();
}

function renderThreeWGridFold(map) {
    const threeRenderer = prepareThreeWRenderer();

    const geometryConfig = buildInputShapeGeometryConfig(zPlaneParams, {
        currentFunction: state.currentFunction,
        zetaContinuationEnabled: state.zetaContinuationEnabled,
        gridDensity: state.gridDensity,
        curvePoints: 250
    });
    const outputXRange = wPlaneParams.currentVisXRange;
    const outputYRange = wPlaneParams.currentVisYRange;
    const surfaceKey = [
        map.signature,
        JSON.stringify(geometryConfig),
        state.gridColor1,
        state.gridColor2,
        state.graphViewEnabled,
        state.graphFullGridEnabled,
        state.graphGridFamily,
        state.graphLayerLockEnabled,
        state.graphSelectedShape,
        state.graphSelectedLineIndex,
        state.foldSurfaceHeightScale,
        outputXRange[0], outputXRange[1],
        outputYRange[0], outputYRange[1]
    ].join('|');

    let surface = threeRenderer.gridFoldSurfaceKey === surfaceKey
        ? threeRenderer.gridFoldSurfaceData
        : null;
    if (!surface) {
        const generatedPointSets = generateCurrentInputShapePointSets(zPlaneParams, geometryConfig);
        const pointSets = state.graphViewEnabled && state.graphFullGridEnabled
            ? filterGraphFullGridPointSets(generatedPointSets)
            : generatedPointSets;
        surface = buildNativeGridFold({
            mapOptions: nativeOptionsForActiveMap(map),
            sourceXRange: geometryConfig.xRange,
            outputXRange,
            outputYRange,
            heightScale: state.foldSurfaceHeightScale
        }, pointSets);
        threeRenderer.gridFoldSurfaceKey = surfaceKey;
    }

    threeRenderer.setGridFoldSurface(surface, state.foldSurfaceHeightScale);

    threeRenderer.setFoldPreimageMarkers(state.preimageRoots, state.preimageTarget, map);

    threeRenderer.render();
}

function drawTaylorApproximationLayer(ctx) {
    drawPlanarTaylorApproximation(
        ctx,
        wPlaneParams,
        state.currentFunction,
        state.taylorSeriesCenter,
        state.taylorSeriesOrder,
        state.gridColor2,
        state.gridColor1,
        { includeAxes: false }
    );
}

function drawWTransformedShape(_index, map, targetCtx, options = null) {
    if (!map || !Number.isInteger(map.stage)) {
        throw new Error('W-plane transformed rendering requires a resolved native map stage.');
    }
    const drawOptions = { ...options, index: map.stage };
    return drawPlanarTransformedShape(targetCtx, wPlaneParams, map, drawOptions);
}

function drawWTransformedShapeChunk(index, map, targetCtx, fresh) {
    const cache = wPlanarTransformedLayerCache;

    if (fresh || !cache.renderJob) {
        cache.renderJob = createPlanarTransformedShapeRenderJob(map);
        cache.nextPointSet = 0;
    }

    const renderJob = cache.renderJob;
    const pointSets = renderJob.pointSets;

    if (!Array.isArray(pointSets) || pointSets.length === 0 || renderJob.transformProfile?.isConstant) {
        const rendered = drawWTransformedShape(index, map, targetCtx, { renderJob });
        if (rendered) {
            cache.renderJob = null;
            cache.nextPointSet = 0;
        }
        return rendered;
    }

    while (cache.nextPointSet < pointSets.length &&
        (!wPlanarWorkPerformed || performance.now() < wPlanarRenderDeadline)) {
        const startIndex = cache.nextPointSet;
        const endIndex = Math.min(pointSets.length, startIndex + W_PLANAR_POINT_SET_BATCH_SIZE);

        drawWTransformedShape(index, map, targetCtx, {
            renderJob,
            startIndex,
            endIndex,
            includeOverlays: endIndex === pointSets.length
        });

        cache.nextPointSet = endIndex;
        wPlanarWorkPerformed = true;
    }

    if (cache.nextPointSet < pointSets.length) {
        return false;
    }

    cache.renderJob = null;
    cache.nextPointSet = 0;
    return true;
}

function renderWPlanarTransformedShape(index, map) {
    if (state.navigationModeEnabled) {
        invalidateCache(wPlanarTransformedLayerCache);
        drawNavigationLayer(wCtx, wPlaneParams, map.evaluate);
        return;
    }

    const cacheKey = buildPlanarLayerCacheKey(true);
    const enabled = shouldUseWPlanarTransformedLayerCache();
    const complete = renderThroughCache(
        wPlanarTransformedLayerCache,
        wCtx,
        wPlaneParams,
        cacheKey,
        enabled,
        (cacheCtx, _cacheKey, fresh) => drawWTransformedShapeChunk(index, map, cacheCtx, fresh),
        targetCtx => drawWTransformedShape(index, map, targetCtx)
    );
    if (!complete) requestRedrawAll();
}

export function drawWPlaneContent(options = {}) {
    syncWRenderContext();
    context.riemannSurfaceContourPipeline = null;
    wPlanarRenderDeadline = performance.now() + W_PLANAR_FRAME_BUDGET_MS;
    wPlanarWorkPerformed = false;

    try {
        if (!Array.isArray(wCanvasList)
            || !Array.isArray(wCtxList)
            || !Array.isArray(wPlaneParamsList)
            || wCanvasList.length === 0) {
            throw new Error('W-plane rendering requires initialized canvas, context, and viewport lists.');
        }
        if (state.laplaceModeEnabled) {
            renderSingleWPlane(0, null, true, options);
            return;
        }
        const requested = requireInteger(state.chainCount, 'W-plane chain count');
        if (requested < 1 || requested > 1024) {
            throw new Error('W-plane chain count must be from one through 1024.');
        }
        if (state.chainingEnabled && state.chainCount > 25) {
            renderSingleWPlane(0, resolveActiveMap(requested - 1), false, options);
            return;
        }

        const available = wCanvasList.length;
        const count = state.chainingEnabled ? requested : 1;
        if (available < count || wCtxList.length < count || wPlaneParamsList.length < count) {
            throw new Error(`W-plane rendering requires ${count} initialized output planes; found ${available}.`);
        }
        for (let index = 0; index < count; index += 1) {
            renderSingleWPlane(index, resolveActiveMap(index), false, options);
        }
    } finally {
        wPlanarRenderDeadline = Infinity;
        wPlanarWorkPerformed = false;
    }
}
