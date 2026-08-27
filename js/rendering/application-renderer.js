import { state, context, laplaceComPlaneParams, laplaceSpectrumPlaneParams } from '../store/state.js';
import { findZerosAndPoles, findCriticalPoints } from '../analysis/feature-detection.js';
import { updateTaylorSeriesCenterAndRadius } from '../native/map-runtime.js';
import { performCauchyAnalysis } from '../analysis/cauchy.js';
import { drawZPlaneContent, drawWPlaneContent } from './renderer.js';
import { updateProbeInfo } from '../ui/ui-updates.js';
import { drawLaplaceSpectrum, drawLaplaceComGraph } from './draw-laplace-panels.js';
import { drawFourier3DPipeline, disposeFourier3DPipeline } from './fourier-3d-pipeline.js';
import {
    applySurfaceCoordinateZoom,
    drawRealPlot,
    drawScalarSurface
} from './real-plots-renderer.js';
import {
    buildLaplaceSurfaceGeometry,
    buildLaplaceSurfaceOverlays,
    laplaceSurfaceFrame,
    laplaceSurfaceGeometryKey,
    laplaceSurfaceOverlayKey,
    scaleLaplaceSurfaceViewport
} from '../analysis/laplace-transform.js';
import {
    disposeTransformationGraphRenderer,
    drawTransformationGraph,
    isGraphViewSupported
} from './transformation-graph.js';
import { draw2DContourPlot } from './contour-2d.js';
import { setupVisualParameters } from '../utils/dom-utils.js';
import { requestUiRedraw } from './redraw-scheduler.js';
import { refreshPanelEdgeHandles } from '../ui/panel-layout-manager.js';

const { controls } = context;
let surfaceRedrawFrame = null;

function zoomLaplaceSurfaceCoordinates(event) {
    const surface = state.laplaceSurface;
    if (!surface) return;
    applySurfaceCoordinateZoom(event, surface.viewportZoom ?? 1, (nextZoom, oldZoom) => {
        scaleLaplaceSurfaceViewport(oldZoom / nextZoom, nextZoom);
        requestUiRedraw();
    });
}

function drawLaplaceSurface() {
    const surface = state.laplaceSurface;
    if (!surface) return;
    const mode = state.laplaceVizMode || 'magnitude';
    const options = {
        mode,
        clipHeight: state.laplaceClipHeight,
        palette: state.surfacePalette,
        showPolesZeros: state.laplaceShowPolesZeros === true,
        showFourierLine: state.laplaceShowFourierLine === true,
        showROC: state.laplaceShowROC === true
    };
    drawScalarSurface('laplace_3d_container', {
        geometryKey: laplaceSurfaceGeometryKey(surface, options),
        buildGeometry: () => buildLaplaceSurfaceGeometry(surface, options),
        frameKey: [surface.revision, mode, ...surface.sigmaRange, ...surface.omegaRange].join('|'),
        frame: laplaceSurfaceFrame(surface, mode),
        overlaysKey: laplaceSurfaceOverlayKey(surface, options),
        overlays: buildLaplaceSurfaceOverlays(surface, options),
        contours: {
            enabled: state.contoursEnabled,
            interval: state.contourInterval,
            thickness: state.contourThickness
        }
    }, { coordinateWheelZoom: zoomLaplaceSurfaceCoordinates });
}

function runSurfaceRedraw() {
    surfaceRedrawFrame = null;
    if (state.show2DContourPlot && (state.realPlotsEnabled || state.laplaceModeEnabled)) {
        draw2DContourPlot(controls.contour2DCanvas);
    }
    if (state.realPlotsEnabled) drawRealPlot();
}

function requestSurfaceRedraw() {
    if (!state.realPlotsEnabled && !(state.laplaceModeEnabled && state.show2DContourPlot)) return;
    if (!surfaceRedrawFrame) surfaceRedrawFrame = requestAnimationFrame(runSurfaceRedraw);
}

function syncOptionalColumn(column, shouldHide, onHide) {
    if (!column || column.classList.contains('hidden') === shouldHide) return;
    column.classList.toggle('hidden', shouldHide);
    if (shouldHide) onHide?.();

    refreshPanelEdgeHandles(true);

    const refreshPlanes = () => {
        setupVisualParameters(false, false);
        requestUiRedraw();
    };
    requestAnimationFrame(() => {
        refreshPlanes();
        setTimeout(refreshPlanes, 360);
    });
}

export function renderApplicationFrame(timestamp) {
    const graphActive = state.graphViewEnabled
        && !state.laplaceModeEnabled;
    const zIsPlanar = !(state.manifold3dViewEnabled && state.manifoldTransformationEnabled);
    if (state.showZerosPoles && !state.navigationModeEnabled && zIsPlanar) {
        findZerosAndPoles();
    } else {
        state.zeros = [];
        state.poles = [];
    }
    if (state.showCriticalPoints && !state.navigationModeEnabled && zIsPlanar) {
        findCriticalPoints();
    } else {
        state.criticalPoints = [];
        state.criticalValues = [];
    }

    updateTaylorSeriesCenterAndRadius();
    performCauchyAnalysis();

    if (!state.realPlotsEnabled) {
        drawZPlaneContent(timestamp);
        drawWPlaneContent();
        if (state.show2DContourPlot && state.riemannSurfaceEnabled) {
            draw2DContourPlot(controls.contour2DCanvas);
        }
    }
    updateProbeInfo();

    syncOptionalColumn(
        controls.laplace3DColumn,
        !state.laplaceModeEnabled || state.laplaceHide3DSurface
    );
    syncOptionalColumn(
        controls.laplaceSpectrumColumn,
        !state.laplaceModeEnabled || !state.laplaceShowSpectrum
    );
    syncOptionalColumn(
        controls.laplaceComColumn,
        !state.laplaceModeEnabled || !state.laplaceShowComGraph
    );
    syncOptionalColumn(
        controls.fourier3DColumn,
        !state.laplaceModeEnabled || !state.laplaceShowFourier3D,
        disposeFourier3DPipeline
    );
    if (state.laplaceModeEnabled) {
        if (!state.laplaceHide3DSurface) drawLaplaceSurface();
        if (state.laplaceShowSpectrum && controls.laplaceSpectrumCanvas) {
            const ctx = controls.laplaceSpectrumCanvas.getContext('2d');
            if (ctx) drawLaplaceSpectrum(ctx, state.laplaceSpectrum, laplaceSpectrumPlaneParams);
        }
        if (state.laplaceShowComGraph && controls.laplaceComCanvas) {
            const ctx = controls.laplaceComCanvas.getContext('2d');
            if (ctx) drawLaplaceComGraph(ctx, state.laplaceComSweep, laplaceComPlaneParams);
        }
        if (state.laplaceShowFourier3D) {
            drawFourier3DPipeline();
        }
    }

    syncOptionalColumn(controls.realPlotsColumn, !state.realPlotsEnabled);
    requestSurfaceRedraw();

    syncOptionalColumn(
        controls.graphColumn,
        !graphActive || state.realPlotsEnabled || !isGraphViewSupported(),
        disposeTransformationGraphRenderer
    );
    if (graphActive && !state.realPlotsEnabled) drawTransformationGraph();
}
