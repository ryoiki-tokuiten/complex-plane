import { state, context, zPlaneParams as defaultZPlaneParams, wPlaneParams as defaultWPlaneParams, sphereViewParams } from '../store/state.js';
import { runtime } from '../store/runtime.js';
import {
    COLOR_CANVAS_BACKGROUND,
    COLOR_TEXT_ON_CANVAS,
    COLOR_CRITICAL_POINT_Z,
    COLOR_CRITICAL_VALUE_W,
    COLOR_FTA_C_MARKER,
    COLOR_W_ORIGIN_GLOW
} from '../constants/colors.js';
import { MAX_POLY_DEGREE, ZETA_REFLECTION_POINT_RE } from '../constants/numerical.js';
import {
    ORIGIN_GLOW_DURATION_MS,
    normalizeOrbitColoringMode
} from '../constants/rendering.js';
import { mapToCanvasCoords } from '../utils/canvas-utils.js';
import { resolveActiveMap } from '../math/active-map.js';
import {
    drawWithWebGLCapture,
    drawPlanarTransformedShapeHybrid,
    drawPlanarInputShapeHybrid
} from './webgl-planar.js';
import { buildRasterSurfaceMesh, getImageRenderChainIndex } from './draw-image-webgl.js';
import {
    getRasterSourceForShape,
    getRasterSizeForShape,
    getRasterAspectRatioForShape,
    getRasterOpacityForShape,
    isRasterInputShape
} from '../utils/raster-media.js';
import { drawWindingVisualization, drawTimeDomainSignal } from './draw-fourier-winding.js';
import { drawLaplaceWindingVisualization, drawLaplaceTimeDomain } from './draw-laplace-panels.js';
import { ThreeRiemannRenderer, buildGridFoldLineData } from './three-riemann-renderer.js';
import {
    generateCurrentInputShapePointSets,
    buildInputShapeGeometryConfig,
    isFoldableInputShape
} from './shape-generators.js';
import { drawGraphSelectionOverlay } from './transformation-graph.js';
import { hideRiemannSurface, renderRiemannSurface } from './webgl-riemann-surface.js';
import { drawAxes, drawGrid } from './canvas-primitives.js';
import {
    drawZerosAndPolesMarkers,
    drawCriticalPointMarker
} from './draw-primitives.js';
import {
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
import { requestRedrawAll } from './redraw-scheduler.js';
import { drawPlanarTaylorApproximation } from './taylor-series.js';
import { drawNavigationLayer } from '../navigation-plane.js';
import { renderPlanarDomainColoring } from './domain-coloring.js';
import { drawRiemannSphereBase, drawSphereGridAndShape, drawSphereProbeAndNeighborhood } from './draw-sphere.js';
import { updateWindingNumberDisplay } from '../analysis/cauchy.js';
import {
    getDynamicPlottingCacheKey
} from '../analysis/dynamic-plotting.js';
import {
    drawDynamicSphere,
    drawDynamicWPlane,
    drawDynamicZPlane,
    getDynamicSphereSceneData
} from './draw-dynamic-plotting.js';
import { generateTissotIndicatrices, selectStableTissotIndicatrices } from '../analysis/tissot.js';
import { findPreimages } from '../analysis/preimage.js';
import { surfaceStageHasBranches } from '../analysis/riemann-surface.js';

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
let sphereViewWParamsList;
const wStaticThreeRenderers = new WeakMap();

const { controls } = context;

let zPlaneParams = defaultZPlaneParams;
let wPlaneParams = defaultWPlaneParams;

let wPlanarTransformedLayerCache;
let wPlanarTransformedLayerCacheList = [];
let wPlanarRenderDeadline = Infinity;
let wPlanarWorkPerformed = false;

const W_PLANAR_FRAME_BUDGET_MS = 8;

const zPlanarInputLayerCache = createLayerCache();
const zFlowLayerCache = createLayerCache();
const conformalIndicatrixCache = { key: null, value: [] };

// Snapshot trackers preserve exact cache invalidation while avoiding per-frame key strings and GC churn.
const planarKeyTrackers = new WeakMap();
const zFlowKeyTracker = { values: [], cursor: 0, changed: true, key: null };
const PLANAR_STATE_DEPENDENCIES = Object.freeze([
    'currentFunction', 'mapPresentation', 'currentInputShape', 'gridDensity',
    'a0', 'b0', 'circleR', 'ellipseA', 'ellipseB', 'themeId',
    'arbitraryShapeMode', 'arbitraryShapeExpression', 'arbitraryShapeTMin', 'arbitraryShapeTMax',
    'arbitraryShapeClosed', 'arbitraryShapePoints',
    'branchCutType', 'branchCutAngle', 'branchCutPoints',
    'imageSize', 'imageOpacity', 'videoSize', 'videoOpacity',
    'cauchyIntegralModeEnabled', 'graphViewEnabled', 'graphFullGridEnabled', 'graphGridFamily',
    'graphLayerLockEnabled',
    'graphSelectedShape', 'graphSelectedLineIndex'
]);
const DOMAIN_STATE_DEPENDENCIES = Object.freeze([
    'domainPalette', 'domainBrightness', 'domainContrast',
    'domainSaturation', 'domainLightnessCycles'
]);
const TAYLOR_LAYER_DEPENDENCIES = Object.freeze([
    'taylorSeriesOrder', 'taylorSeriesConvergenceRadius',
    'taylorSeriesColorAxisX', 'taylorSeriesColorAxisY'
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

function isFiniteComplex(value) {
    return Number.isFinite(value?.re) && Number.isFinite(value?.im);
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
    sphereViewWParamsList = context.sphereViewWParamsList;

    const externalCaches = context.wPlanarTransformedLayerCacheList;
    if (Array.isArray(externalCaches)) wPlanarTransformedLayerCacheList = externalCaches;
    else context.wPlanarTransformedLayerCacheList = wPlanarTransformedLayerCacheList;
}

function drawPlaneLayer(ctx, planeParams, planeKey, drawCallback) {
    if (!ctx || !planeParams || typeof drawCallback !== 'function') {
        return false;
    }

    if (drawWithWebGLCapture(ctx, planeParams, planeKey, drawCallback)) {
        return true;
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

// The cache protocol is synchronous and allocation-free on steady-state hits.
function renderThroughCache(cache, targetCtx, planeParams, cacheKey, enabled, render, renderDirect = render) {
    if (!targetCtx || !planeParams || typeof render !== 'function') return true;

    if (enabled && cache?.canvas && cache.key === cacheKey) {
        targetCtx.drawImage(cache.canvas, 0, 0);
        return true;
    }
    if (!enabled) {
        invalidateCache(cache);
        return renderDirect(targetCtx, cacheKey, true) !== false;
    }
    if (!cache || planeParams.width <= 0 || planeParams.height <= 0 || typeof document === 'undefined') {
        return renderDirect(targetCtx, cacheKey, true) !== false;
    }

    if (!cache.canvas) {
        cache.canvas = document.createElement('canvas');
        cache.ctx = cache.canvas.getContext('2d');
        if (!cache.ctx) {
            cache.canvas = null;
            return renderDirect(targetCtx, cacheKey, true) !== false;
        }
    }
    if (cache.canvas.width !== planeParams.width || cache.canvas.height !== planeParams.height) {
        cache.canvas.width = planeParams.width;
        cache.canvas.height = planeParams.height;
        invalidateCache(cache);
    }

    const fresh = cache.pendingKey !== cacheKey;
    if (fresh) {
        cache.ctx.setTransform(1, 0, 0, 1, 0, 0);
        cache.ctx.clearRect(0, 0, cache.canvas.width, cache.canvas.height);
        cache.pendingKey = cacheKey;
    }

    const complete = render(cache.ctx, cacheKey, fresh) !== false;
    if (complete) {
        cache.key = cacheKey;
        cache.pendingKey = null;
    } else {
        cache.key = null;
    }

    targetCtx.drawImage(cache.canvas, 0, 0);
    return complete;
}

function normalizedPolynomialDegree() {
    const degree = Number.isFinite(state.polynomialN) ? state.polynomialN : 0;
    return Math.max(0, Math.min(MAX_POLY_DEGREE, degree));
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
                captureComplexDependency(tracker, Array.isArray(coeffs) ? coeffs[index] || null : null);
            }
            return;
        }
        case 'power':
            captureDependency(tracker, state.fractionalPowerN ?? 0.5);
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
    captureDependency(tracker, state.gridColor1 || '');
    captureDependency(tracker, state.gridColor2 || '');
    captureDependency(tracker, state.imageContentVersion || 0);
    captureDependency(tracker, state.videoProcessingFps || 0);
    captureDependency(tracker, state.videoFrameVersion || 0);
    captureDependency(tracker, getDynamicPlottingCacheKey());

    const domainEnabled = Boolean(state.domainColoringEnabled);
    captureDependency(tracker, domainEnabled);
    if (domainEnabled) {
        captureStateDependencies(tracker, DOMAIN_STATE_DEPENDENCIES);
        captureDependency(tracker, normalizeOrbitColoringMode(state.orbitColoringMode));
    }

    const sourceX = zPlaneParams?.currentVisXRange;
    const sourceY = zPlaneParams?.currentVisYRange;
    captureDependency(tracker, sourceX?.[0]);
    captureDependency(tracker, sourceX?.[1]);
    captureDependency(tracker, sourceY?.[0]);
    captureDependency(tracker, sourceY?.[1]);
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
    return !state.riemannSphereViewEnabled
        && !state.splitViewEnabled
        && !state.navigationModeEnabled
        && state.currentInputShape !== 'video'
        && !isPanning(runtime.interaction.panZ)
        && !isPanning(runtime.interaction.panW);
}

function shouldUseZPlanarInputLayerCache() {
    return !state.navigationModeEnabled
        && !state.vectorFieldEnabled
        && !(state.riemannSphereViewEnabled && !state.splitViewEnabled)
        && state.currentInputShape !== 'video'
        && !isPanning(runtime.interaction.panZ);
}

function shouldUseZFlowLayerCache() {
    return (state.vectorFieldEnabled || state.streamlineFlowEnabled)
        && !(state.riemannSphereViewEnabled && !state.splitViewEnabled)
        && !isPanning(runtime.interaction.panZ);
}

function fillCanvasBackground(ctx, planeParams) {
    if (!ctx || !planeParams) {
        return;
    }

    ctx.fillStyle = COLOR_CANVAS_BACKGROUND;
    ctx.fillRect(0, 0, planeParams.width, planeParams.height);
}

function drawDomainOrSolidBackground(ctx, domainCanvas, planeParams) {
    if (state.domainColoringEnabled && domainCanvas) {
        withCanvasState(ctx, () => {
            const isProcessing = !planeParams.currentVisXRange
                ? runtime.rendering.processingWDomainDynamics
                : runtime.rendering.processingZDomainDynamics;
            if (isProcessing) {
                ctx.filter = 'blur(3px)';
            }
            fillCanvasBackground(ctx, planeParams);
            ctx.drawImage(domainCanvas, 0, 0);
        });
        return;
    }

    fillCanvasBackground(ctx, planeParams);
}

function getPlaneRanges(planeParams) {
    const [xMin, xMax] = planeParams?.currentVisXRange || planeParams?.xRange || [];
    const [yMin, yMax] = planeParams?.currentVisYRange || planeParams?.yRange || [];

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
            ctx.fillStyle = state.taylorSeriesColorConvergenceDiskFill;
            ctx.strokeStyle = state.taylorSeriesColorConvergenceDiskStroke;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(centerCanvas.x, centerCanvas.y, radiusCanvas, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
        });

        return;
    }

    if (radius === 0) {
        withCanvasState(ctx, () => {
            ctx.fillStyle = state.taylorSeriesColorConvergenceDiskStroke;
            ctx.beginPath();
            ctx.arc(centerCanvas.x, centerCanvas.y, 2, 0, 2 * Math.PI);
            ctx.fill();
        });
    }
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

        ctx.fillStyle = COLOR_TEXT_ON_CANVAS;
        ctx.font = "10px 'SF Pro Text', sans-serif";
        ctx.textAlign = 'center';
        ctx.fillText('P(0)', canvasPoint.x, canvasPoint.y - 10);
    });
}

function drawWOriginGlowOverlay(ctx, planeParams) {
    const startedAt = Number(runtime.rendering.wOriginGlowTime) || 0;

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

function visiblePlaneRange(planeParams, currentKey, fallbackKey) {
    const range = planeParams?.[currentKey] || planeParams?.[fallbackKey];
    return Array.isArray(range) && range.length >= 2 ? range : [-1, 1];
}

function getConformalIndicatrixData(map) {
    const xRange = visiblePlaneRange(zPlaneParams, 'currentVisXRange', 'xRange');
    const yRange = visiblePlaneRange(zPlaneParams, 'currentVisYRange', 'yRange');
    const key = [
        map.signature,
        state.gridDensity,
        xRange[0], xRange[1],
        yRange[0], yRange[1]
    ].join('|');

    if (conformalIndicatrixCache.key !== key) {
        conformalIndicatrixCache.key = key;
        conformalIndicatrixCache.value = selectStableTissotIndicatrices(
            generateTissotIndicatrices(map, xRange, yRange, state.gridDensity, 72)
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
    const rendered = drawPlaneLayer(targetCtx, planeParams, 'z', layerCtx => {
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

    if (state.fourierModeEnabled) {
        if (zCtx && zPlaneParams) drawTimeDomainSignal(zCtx, state.fourierTimeDomainSignal, zPlaneParams);
        return;
    }
    if (state.laplaceModeEnabled) {
        if (zCtx && zPlaneParams) drawLaplaceTimeDomain(zCtx, state.laplaceTimeDomainSignal, zPlaneParams);
        return;
    }

    const map = resolveActiveMap();
    if (state.riemannSphereViewEnabled && !state.splitViewEnabled) {
        if (!zCtx || !zPlaneParams) return;
        const sphereParams = sphereViewParams.z;
        fillCanvasBackground(zCtx, zPlaneParams);
        drawPlaneLayer(zCtx, zPlaneParams, 'z', layerCtx => {
            drawRiemannSphereBase(layerCtx, sphereParams);
            drawSphereGridAndShape(layerCtx, sphereParams, false);
            drawDynamicSphere(layerCtx, sphereParams, { isWPlane: false });
            if (state.probeActive) {
                drawSphereProbeAndNeighborhood(
                    layerCtx,
                    sphereParams,
                    state.probeZ,
                    state.probeNeighborhoodSize,
                    null
                );
            }
        });
        return;
    }

    if (state.domainColoringEnabled && context.domainColoringDirty && zDomainColorCtx) {
        renderPlanarDomainColoring(zDomainColorCtx, zPlaneParams, false, map);
    }
    if (!zCtx || !zPlaneParams) {
        if (state.navigationModeEnabled) {
            invalidateCache(zFlowLayerCache);
            invalidateCache(zPlanarInputLayerCache);
            drawNavigationLayer(zCtx, zPlaneParams, 'z');
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
        drawGrid(zCtx, zPlaneParams, {
            targetCount: state.gridDensity,
            minorColor: 'rgba(128, 137, 255, 0.04)',
            majorColor: 'rgba(128, 137, 255, 0.12)'
        });
    }

    if (state.navigationModeEnabled) {
        invalidateCache(zFlowLayerCache);
        invalidateCache(zPlanarInputLayerCache);
        drawNavigationLayer(zCtx, zPlaneParams, 'z');
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
            cacheCtx => drawPlanarInputShapeHybrid(cacheCtx, zPlaneParams, 'z')
        );
        if ((state.radialDiscreteStepsEnabled && state.currentFunction !== 'poincare') || surfaceStageHasBranches(state)) {
            drawPlanarInputOverlays(zCtx, zPlaneParams);
        }
    }

    if (state.dynamicPlotting?.enabled) drawDynamicZPlane(zCtx, zPlaneParams);
    if (!state.navigationModeEnabled) {
        if (state.showZerosPoles) {
            drawPlaneLayer(zCtx, zPlaneParams, 'z', layerCtx => {
                drawZerosAndPolesMarkers(layerCtx, zPlaneParams);
            });
        }
        if (state.showCriticalPoints && state.criticalPoints?.length) {
            drawPlaneLayer(zCtx, zPlaneParams, 'z', layerCtx => {
                drawCriticalMarkers(layerCtx, zPlaneParams, state.criticalPoints, COLOR_CRITICAL_POINT_Z);
            });
        }
    }
    if (state.graphViewEnabled) drawGraphSelectionOverlay(zCtx, zPlaneParams);
    if (state.conformalGridEnabled) {
        const indicatrices = getConformalIndicatrixData(map);
        drawPlaneLayer(zCtx, zPlaneParams, 'z', layerCtx => {
            drawConformalIndicatrices(layerCtx, zPlaneParams, indicatrices, 'source');
        });
    }
    if (state.taylorSeriesEnabled && !state.navigationModeEnabled) {
        drawTaylorConvergenceOverlay(zCtx, zPlaneParams);
    }
    if (state.probeActive && !state.navigationModeEnabled && !isPanning(runtime.interaction.panZ)) {
        drawPlaneLayer(zCtx, zPlaneParams, 'z', layerCtx => {
            drawPlanarProbe(layerCtx, zPlaneParams);
        });
    }
    if (state.preimageExplorerEnabled && state.preimageRoots.length) {
        drawPlaneLayer(zCtx, zPlaneParams, 'z', layerCtx => drawPreimageMarkers(layerCtx, zPlaneParams, state.preimageRoots));
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
    container?.classList?.toggle('hidden', hidden);
    if (hidden) wStaticThreeRenderers.get(container)?.stopAnimationLoop();
}

function setWPresentation(mode) {
    wCanvas?.classList?.toggle('hidden', mode !== 'canvas');
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
    const previousSphereParams = sphereViewParams.w;
    const previousCache = wPlanarTransformedLayerCache;

    wCanvas = wCanvasList?.[index];
    wCtx = wCtxList?.[index];
    wPlaneParams = wPlaneParamsList?.[index];
    controls.wPlaneThreeContainer = wPlaneThreeContainersList?.[index];
    sphereViewParams.w = sphereViewWParamsList?.[index];
    wPlanarTransformedLayerCache = ensureWPlaneCache(index);

    try {
        if (!wCtx || !wPlaneParams) return;
        if (isSpecialMode) {
            hideRiemannSurface(wCanvas);
            setWPresentation('canvas');
            if (state.fourierModeEnabled) {
                drawWindingVisualization(wCtx, state.fourierTimeDomainSignal, wPlaneParams);
            } else if (state.laplaceModeEnabled) {
                drawLaplaceWindingVisualization(wCtx, state.laplaceTimeDomainSignal, wPlaneParams);
            }
            return;
        }
        if (renderRiemannSurfaceIfEnabled(index, map, options.renderRiemannSurface !== false)) return;
        if (state.riemannTransformationEnabled) {
            setWPresentation('hidden');
            return;
        }
        if (state.foldSurface3dEnabled) {
            if (isRasterInputShape(state.currentInputShape)) {
                renderThreeWRasterSurface(map, index);
                return;
            }
            if (isFoldableInputShape(state.currentInputShape)) {
                renderThreeWGridFold(map);
                return;
            }
        }

        const isRiemannW = state.riemannSphereViewEnabled || state.splitViewEnabled;
        if (state.threeSphereEnabled && isRiemannW) {
            renderThreeWPlane(map, index);
            return;
        }

        setWPresentation('canvas');
        if (!isRiemannW) {
            fillCanvasBackground(wCtx, wPlaneParams);
            drawAxes(wCtx, wPlaneParams, 'Re(w)', 'Im(w)');
            drawPolynomialOriginMarkerOverlay(wCtx, wPlaneParams);
            drawWOriginGlowOverlay(wCtx, wPlaneParams);
            if (!state.navigationModeEnabled && state.currentInputShape !== 'empty_grid') {
                drawGrid(wCtx, wPlaneParams, {
                    targetCount: state.gridDensity,
                    minorColor: 'rgba(128, 137, 255, 0.04)',
                    majorColor: 'rgba(128, 137, 255, 0.12)'
                });
            }
        }

        if (state.taylorSeriesEnabled
            && map.presentation !== 'derivative'
            && !isRiemannW
            && !state.navigationModeEnabled) {
            const cacheKey = buildPlanarLayerCacheKey(true);
            renderThroughCache(
                wPlanarTransformedLayerCache,
                wCtx,
                wPlaneParams,
                cacheKey,
                shouldUseWPlanarTransformedLayerCache(),
                drawTaylorApproximationLayer,
                targetCtx => drawPlaneLayer(targetCtx, wPlaneParams, 'w', drawTaylorApproximationLayer)
            );
        } else if (isRiemannW) {
            const sphereParams = sphereViewParams.w;
            fillCanvasBackground(wCtx, wPlaneParams);
            drawPlaneLayer(wCtx, wPlaneParams, 'w', layerCtx => {
                drawRiemannSphereBase(layerCtx, sphereParams);
                drawSphereGridAndShape(layerCtx, sphereParams, true, map.evaluate);
                drawDynamicSphere(layerCtx, sphereParams, {
                    isWPlane: true,
                    transform: map.evaluate,
                    stageIndex: index
                });
            });
        } else {
            renderWPlanarTransformedShape(index, map);
        }

        if (!isRiemannW && state.dynamicPlotting?.enabled) {
            drawDynamicWPlane(wCtx, wPlaneParams, map.evaluate, index);
        }
        if (!isRiemannW && state.preimageExplorerEnabled && state.preimageTarget) {
            drawPlaneLayer(wCtx, wPlaneParams, 'w', layerCtx => {
                drawPreimageMarkers(layerCtx, wPlaneParams, [state.preimageTarget], true);
                if (state.preimageStatus) {
                    layerCtx.fillStyle = '#ffffff';
                    layerCtx.font = '12px sans-serif';
                    layerCtx.fillText(state.preimageStatus, 12, 20);
                }
            });
        }
        if (!isRiemannW && state.continuationValues.length > 1) {
            drawPlaneLayer(wCtx, wPlaneParams, 'w', layerCtx => drawContinuationValues(layerCtx, wPlaneParams));
        }
        if (state.showCriticalPoints
            && !state.navigationModeEnabled
            && !isRiemannW
            && Array.isArray(state.criticalValues)
            && state.criticalValues.length > 0) {
            drawPlaneLayer(wCtx, wPlaneParams, 'w', layerCtx => {
                drawCriticalMarkers(layerCtx, wPlaneParams, state.criticalValues, COLOR_CRITICAL_VALUE_W);
            });
        }
        if (state.probeActive && !state.navigationModeEnabled) {
            drawPlaneLayer(wCtx, wPlaneParams, 'w', layerCtx => {
                if (isRiemannW) {
                    drawSphereProbeAndNeighborhood(
                        layerCtx,
                        sphereViewParams.w,
                        state.probeZ,
                        state.probeNeighborhoodSize,
                        map.evaluate
                    );
                } else {
                    drawPlanarTransformedProbe(layerCtx, wPlaneParams, map);
                }
            });
        }
        if (state.conformalGridEnabled && !isRiemannW) {
            const indicatrices = getConformalIndicatrixData(map);
            drawPlaneLayer(wCtx, wPlaneParams, 'w', layerCtx => {
                drawConformalIndicatrices(layerCtx, wPlaneParams, indicatrices, 'mapped');
            });
        }
        if (!isRiemannW && index === 0) updateWindingNumberDisplay(map.evaluate);
    } finally {
        wCanvas = previousCanvas;
        wCtx = previousCtx;
        wPlaneParams = previousParams;
        controls.wPlaneThreeContainer = previousThreeContainer;
        sphereViewParams.w = previousSphereParams;
        wPlanarTransformedLayerCache = previousCache;
    }
}

function renderRiemannSurfaceIfEnabled(index, map, enabled) {
    if (!state.riemannSurfaceEnabled) {
        hideRiemannSurface(wCanvas);
        return false;
    }

    setWThreeHidden(true);
    if (!enabled) return true;

    const stage = state.chainingEnabled && state.chainCount > 25
        ? state.chainCount
        : index + 1;
    context.riemannSurfaceContourPipeline = { index, stage, map };
    if (wCanvas && renderRiemannSurface(wCanvas, { stage, map })) {
        wCanvas?.classList?.toggle('hidden', true);
        return true;
    }

    wCanvas?.classList?.toggle('hidden', false);
    return false;
}

function prepareThreeWRenderer() {
    const container = controls.wPlaneThreeContainer;
    if (!container) {
        wCanvas?.classList?.toggle('hidden', false);
        return null;
    }

    setWPresentation('three');
    let renderer = wStaticThreeRenderers.get(container);
    if (!renderer) {
        renderer = new ThreeRiemannRenderer(container, 'w');
        wStaticThreeRenderers.set(container, renderer);
    }
    renderer.onFoldTargetSelected = target => {
        const map = resolveActiveMap();
        const xRange = zPlaneParams.currentVisXRange || zPlaneParams.xRange;
        const yRange = zPlaneParams.currentVisYRange || zPlaneParams.yRange;
        state.preimageTarget = target;
        state.preimageRoots = findPreimages(target, map.evaluate, { xRange, yRange });
        state.preimageStatus = `${state.preimageRoots.length} preimage${state.preimageRoots.length === 1 ? '' : 's'}`;
        requestRedrawAll();
    };
    return renderer;
}

function renderThreeWPlane(map, stageIndex) {
    const threeRenderer = prepareThreeWRenderer();
    if (!threeRenderer) return;

    threeRenderer.setSphereMode();

    const stage = state.chainingEnabled && state.chainCount > 25
        ? Math.max(0, state.chainCount - 1)
        : stageIndex;
    const transformChanged = threeRenderer.setTransform(map.evaluate, stage + 1, map.signature);

    const gridConfigObj = buildInputShapeGeometryConfig(zPlaneParams, {
        currentFunction: state.currentFunction,
        zetaContinuationEnabled: state.zetaContinuationEnabled,
        gridDensity: state.gridDensity
    });
    const gridConfigKey = `${map.signature}:${JSON.stringify(gridConfigObj)}`;

    // Skip rebuilding heavy 3D geometries continuously during 2D canvas drag-panning.
    // The pointerup redraw will rebuild any stale geometry.
    if (threeRenderer.lastGridConfigKey !== gridConfigKey
        && !runtime.interaction.panZ.isPanning
        && !runtime.interaction.panW.isPanning) {
        threeRenderer.lastGridConfigKey = gridConfigKey;

        const wPointSets = generateCurrentInputShapePointSets(zPlaneParams, {
            currentFunction: state.currentFunction,
            zetaContinuationEnabled: state.zetaContinuationEnabled,
            curvePoints: 250,
            gridDensity: state.gridDensity
        });

        threeRenderer.buildGridFromPointSets(wPointSets, 1.0);
    }

    const geometryChanged = threeRenderer.updateGeometry(1.0);
    const overlayChanged = threeRenderer.setDynamicOverlay(
        getDynamicSphereSceneData({ transform: map.evaluate, stageIndex }),
        `${stageIndex}:${getDynamicPlottingCacheKey()}`
    );

    let probeChanged = false;
    if (state.probeActive && state.probeZ) {
        const wProbe = map.evaluate(state.probeZ.re, state.probeZ.im);
        probeChanged = threeRenderer.updateProbe(wProbe);
    } else {
        probeChanged = threeRenderer.updateProbe(null);
    }

    if (transformChanged || geometryChanged || overlayChanged || probeChanged) {
        threeRenderer.render();
    }
}

function renderThreeWRasterSurface(map, stageIndex) {
    const rasterShape = state.currentInputShape;
    const source = getRasterSourceForShape(rasterShape);

    if (!source) {
        setWPresentation('canvas');
        return;
    }

    const threeRenderer = prepareThreeWRenderer();
    if (!threeRenderer) return;

    const xRange = wPlaneParams.currentVisXRange || wPlaneParams.xRange;
    const yRange = wPlaneParams.currentVisYRange || wPlaneParams.yRange;
    const rasterStage = getImageRenderChainIndex(stageIndex, map);
    const rasterSize = getRasterSizeForShape(rasterShape);
    const rasterAspectRatio = getRasterAspectRatioForShape(rasterShape);
    const rasterContentVersion = rasterShape === 'image' ? state.imageContentVersion : 0;
    const surfaceKey = [
        rasterStage,
        map?.signature || '',
        rasterShape,
        rasterContentVersion,
        state.a0,
        state.b0,
        rasterSize,
        rasterAspectRatio,
        xRange[0], xRange[1], yRange[0], yRange[1]
    ].join('|');

    let surface = threeRenderer.rasterSurfaceKey === surfaceKey
        ? threeRenderer.rasterSurfaceData
        : null;
    if (!surface) {
        surface = buildRasterSurfaceMesh(wPlaneParams, map);
        if (surface) threeRenderer.rasterSurfaceKey = surfaceKey;
    }

    if (!threeRenderer.setRasterSurface(
        surface,
        source,
        getRasterOpacityForShape(rasterShape),
        state.foldSurfaceHeightScale
    )) {
        threeRenderer.rasterSurfaceKey = null;
        setWPresentation('canvas');
        return;
    }

    threeRenderer.setFoldPreimageMarkers(state.preimageRoots, state.preimageTarget, map.evaluate);

    threeRenderer.render();
}

function renderThreeWGridFold(map) {
    const threeRenderer = prepareThreeWRenderer();
    if (!threeRenderer) return;

    const geometryConfig = buildInputShapeGeometryConfig(zPlaneParams, {
        currentFunction: state.currentFunction,
        zetaContinuationEnabled: state.zetaContinuationEnabled,
        gridDensity: state.gridDensity,
        curvePoints: 250
    });
    const outputXRange = wPlaneParams.currentVisXRange || wPlaneParams.xRange;
    const outputYRange = wPlaneParams.currentVisYRange || wPlaneParams.yRange;
    const surfaceKey = [
        map.signature,
        JSON.stringify(geometryConfig),
        state.gridColor1,
        state.gridColor2,
        outputXRange[0], outputXRange[1],
        outputYRange[0], outputYRange[1]
    ].join('|');

    let surface = threeRenderer.gridFoldSurfaceKey === surfaceKey
        ? threeRenderer.gridFoldSurfaceData
        : null;
    if (!surface) {
        const pointSets = generateCurrentInputShapePointSets(zPlaneParams, geometryConfig);
        surface = buildGridFoldLineData(pointSets, map.evaluate, {
            sourceXRange: geometryConfig.xRange,
            outputXRange,
            outputYRange
        });
        if (surface) threeRenderer.gridFoldSurfaceKey = surfaceKey;
    }

    if (!threeRenderer.setGridFoldSurface(surface, state.foldSurfaceHeightScale)) {
        threeRenderer.gridFoldSurfaceKey = null;
        setWPresentation('canvas');
        return;
    }

    threeRenderer.setFoldPreimageMarkers(state.preimageRoots, state.preimageTarget, map.evaluate);

    threeRenderer.render();
}

function drawTaylorApproximationLayer(ctx) {
    drawPlanarTaylorApproximation(
        ctx,
        wPlaneParams,
        state.currentFunction,
        state.taylorSeriesCenter,
        state.taylorSeriesOrder,
        state.taylorSeriesColorAxisX,
        state.taylorSeriesColorAxisY,
        { includeAxes: false }
    );
}

function drawWTransformedShape(index, map, targetCtx, options = null) {
    const stageIndex = Number.isFinite(map?.stage) ? map.stage : index;
    const drawOptions = { ...options, index: stageIndex, map };

    if (index === 0) {
        return drawPlanarTransformedShapeHybrid(targetCtx, wPlaneParams, map.evaluate, 'w', map, drawOptions);
    }

    return drawPlanarTransformedShape(targetCtx, wPlaneParams, map.evaluate, drawOptions);
}

function drawWTransformedShapeChunk(index, map, targetCtx, fresh) {
    const cache = wPlanarTransformedLayerCache;

    if (fresh || !cache.renderJob) {
        cache.renderJob = createPlanarTransformedShapeRenderJob(map.evaluate, map);
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
        const endIndex = startIndex + 1;

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
        drawNavigationLayer(wCtx, wPlaneParams, 'w', map.evaluate);
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
            || wCanvasList.length === 0) return;
        if (state.fourierModeEnabled || state.laplaceModeEnabled) {
            renderSingleWPlane(0, null, true, options);
            return;
        }
        if (state.chainingEnabled && state.chainCount > 25) {
            renderSingleWPlane(0, resolveActiveMap(Math.max(0, state.chainCount - 1)), false, options);
            return;
        }

        const available = wCanvasList.length;
        const requested = Number.isFinite(state.chainCount) ? state.chainCount : 0;
        const count = state.chainingEnabled ? Math.max(0, Math.min(requested, available)) : 1;
        for (let index = 0; index < count; index += 1) {
            renderSingleWPlane(index, resolveActiveMap(index), false, options);
        }
    } finally {
        wPlanarRenderDeadline = Infinity;
        wPlanarWorkPerformed = false;
    }
}
