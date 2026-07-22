import { state, context } from '../store/state.js';
import { findZerosAndPoles, findCriticalPoints } from '../analysis/feature-detection.js';
import { updateTaylorSeriesCenterAndRadius } from '../math-utils.js';
import { performCauchyAnalysis } from '../analysis/cauchy.js';
import { drawZPlaneContent, drawWPlaneContent } from './renderer.js';
import { updateTitlesAndGlobalUI } from '../ui/ui-updates.js';
import { drawLaplace3DSurface } from './laplace-3d-surface.js';
import { drawRealPlot } from './real-plots-renderer.js';
import {
    disposeTransformationGraphRenderer,
    drawTransformationGraph,
    isGraphViewSupported
} from './transformation-graph.js';
import { draw2DContourPlot } from './contour-2d.js';
import { setupVisualParameters } from '../utils/dom-utils.js';
import { requestRedrawAll } from './redraw-scheduler.js';

const { controls } = context;
const SURFACE_REDRAW_DELAY_MS = 90;
const SURFACE_REDRAW_MAX_WAIT_MS = 240;
let surfaceRedrawTimer = null;
let surfaceRedrawFrame = null;
let surfaceRedrawFirstRequestTime = 0;

function runSurfaceRedraw() {
    surfaceRedrawFrame = null;
    surfaceRedrawFirstRequestTime = 0;
    try {
        if (state.riemannSurfaceEnabled && !state.realPlotsEnabled) {
            drawWPlaneContent({ renderRiemannSurface: true });
        }
        if (state.realPlotsEnabled) drawRealPlot();
        if (state.show2DContourPlot && (state.realPlotsEnabled || state.riemannSurfaceEnabled)) {
            draw2DContourPlot(controls.contour2DCanvas);
        }
    } catch (error) {
        console.error('Error during deferred surface redraw:', error);
    }
}

function requestSurfaceRedraw() {
    if (!state.realPlotsEnabled && !state.riemannSurfaceEnabled) return;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!surfaceRedrawFirstRequestTime) surfaceRedrawFirstRequestTime = now;
    if (surfaceRedrawTimer) clearTimeout(surfaceRedrawTimer);
    if (surfaceRedrawFrame) {
        cancelAnimationFrame(surfaceRedrawFrame);
        surfaceRedrawFrame = null;
    }

    const delay = now - surfaceRedrawFirstRequestTime >= SURFACE_REDRAW_MAX_WAIT_MS
        ? 0
        : SURFACE_REDRAW_DELAY_MS;
    surfaceRedrawTimer = setTimeout(() => {
        surfaceRedrawTimer = null;
        surfaceRedrawFrame = requestAnimationFrame(runSurfaceRedraw);
    }, delay);
}

function syncOptionalColumn(column, shouldHide, onHide) {
    if (!column || column.classList.contains('hidden') === shouldHide) return;
    column.classList.toggle('hidden', shouldHide);
    if (shouldHide) onHide?.();

    const refreshPlanes = () => {
        setupVisualParameters(false, false);
        requestRedrawAll();
    };
    requestAnimationFrame(() => {
        refreshPlanes();
        setTimeout(refreshPlanes, 360);
    });
}

export function renderApplicationFrame() {
    const zIsPlanar = !state.riemannSphereViewEnabled || state.splitViewEnabled;
    if (state.showZerosPoles && !state.navigationModeEnabled && zIsPlanar && state.currentFunction !== 'poincare') {
        findZerosAndPoles();
    } else {
        state.zeros = [];
        state.poles = [];
    }
    if (state.showCriticalPoints && !state.navigationModeEnabled && zIsPlanar && state.currentFunction !== 'poincare') {
        findCriticalPoints();
    } else {
        state.criticalPoints = [];
        state.criticalValues = [];
    }

    updateTaylorSeriesCenterAndRadius();
    performCauchyAnalysis();

    if (!state.realPlotsEnabled) {
        drawZPlaneContent();
        drawWPlaneContent({ renderRiemannSurface: !state.riemannSurfaceEnabled });
    }
    updateTitlesAndGlobalUI();

    syncOptionalColumn(controls.laplace3DColumn, !state.laplaceModeEnabled);
    if (state.laplaceModeEnabled) drawLaplace3DSurface('laplace_3d_container');

    syncOptionalColumn(controls.realPlotsColumn, !state.realPlotsEnabled);
    requestSurfaceRedraw();

    syncOptionalColumn(
        controls.graphColumn,
        !state.graphViewEnabled || state.realPlotsEnabled || !isGraphViewSupported(),
        disposeTransformationGraphRenderer
    );
    if (state.graphViewEnabled && !state.realPlotsEnabled) drawTransformationGraph();
}
