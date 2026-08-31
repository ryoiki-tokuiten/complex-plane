import { state, context, zPlaneParams } from '../store/state.js';
import { renderRealPlotContour } from './real-plots-renderer.js';
import { buildLaplaceSurfaceGeometry } from '../analysis/laplace-transform.js';
import { drawAxes, drawGrid } from './canvas-primitives.js';
import { getDomainPaletteStops } from '../constants/domain-palettes.js';
import { renderNativeMapContour } from '../native/complex-engine.js';
import { nativeOptionsForActiveMap } from '../native/map-runtime.js';
import { requireFiniteRange } from '../utils/viewport.js';
import { requireFiniteNumber } from '../utils/numeric-contracts.js';

const MAX_CANVAS_DPR = 2.5;

function readRange(range, name) {
    return requireFiniteRange(range, name);
}

function resizeContourCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.floor(requireFiniteNumber(rect.width, 'Contour canvas width'));
    const cssHeight = Math.floor(requireFiniteNumber(rect.height, 'Contour canvas height'));
    const devicePixelRatio = requireFiniteNumber(window.devicePixelRatio, 'Device pixel ratio');
    if (cssWidth < 1 || cssHeight < 1 || devicePixelRatio <= 0) {
        throw new Error('Contour rendering requires a visible canvas and a positive device pixel ratio.');
    }
    const dpr = Math.min(Math.max(devicePixelRatio, 1), MAX_CANVAS_DPR);
    const width = Math.round(cssWidth * dpr);
    const height = Math.round(cssHeight * dpr);

    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }

    return { cssWidth, cssHeight, width, height, dpr };
}

function getContourInterval() {
    const interval = requireFiniteNumber(state.contourInterval, 'Contour interval');
    if (interval <= 1e-9) throw new Error('Contour interval must exceed 1e-9.');
    return interval;
}

function getContourThickness() {
    const thickness = requireFiniteNumber(state.contourThickness, 'Contour thickness');
    if (thickness <= 0) throw new Error('Contour thickness must be positive.');
    return thickness;
}

function makePlaneParams(width, height, requestedXRange, requestedYRange) {
    const xRange = readRange(requestedXRange ?? zPlaneParams.currentVisXRange, '2D contour x-axis');
    const yRange = readRange(requestedYRange ?? zPlaneParams.currentVisYRange, '2D contour y-axis');
    const xSpan = xRange[1] - xRange[0];
    const ySpan = yRange[1] - yRange[0];

    return {
        width,
        height,
        origin: {
            x: -xRange[0] * width / xSpan,
            y: yRange[1] * height / ySpan
        },
        scale: {
            x: width / xSpan,
            y: height / ySpan
        },
        currentVisXRange: xRange,
        currentVisYRange: yRange
    };
}

function getRiemannContourMap() {
    const pipelineMap = context.riemannSurfaceContourPipeline?.map;
    if (!pipelineMap) throw new Error('Riemann contour rendering requires an initialized native map pipeline.');
    return pipelineMap;
}

function putNativePixels(ctx, width, height, pixels) {
    if (!(pixels instanceof Uint8ClampedArray) || pixels.length !== width * height * 4) {
        throw new Error('Native contour renderer returned an invalid pixel buffer.');
    }
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
}

function renderRiemannHeightField(ctx, width, height) {
    const xRange = readRange(zPlaneParams.currentVisXRange, 'Riemann contour x-axis');
    const yRange = readRange(zPlaneParams.currentVisYRange, 'Riemann contour y-axis');
    const map = getRiemannContourMap();
    const pixels = renderNativeMapContour({
        mapOptions: nativeOptionsForActiveMap(map),
        xRange,
        yRange,
        width,
        height,
        component: state.riemannSurfaceComponent,
        contoursEnabled: state.contoursEnabled,
        contourInterval: getContourInterval(),
        contourThickness: getContourThickness(),
        paletteStops: getDomainPaletteStops(state.domainPalette),
        style: {
            brightness: state.domainBrightness,
            contrast: state.domainContrast,
            saturation: state.domainSaturation,
            lightnessCycles: state.domainLightnessCycles
        }
    });
    putNativePixels(ctx, width, height, pixels);
}

function renderLaplaceHeightField(ctx, width, height) {
    const surface = state.laplaceSurface;
    if (!surface) throw new Error('Laplace contour rendering requires surface data.');
    const geometry = buildLaplaceSurfaceGeometry(surface, {
        mode: state.laplaceVizMode,
        clipHeight: state.laplaceClipHeight,
        palette: state.surfacePalette
    });
    const columns = surface.sigmaSteps + 1;
    const rows = surface.omegaSteps + 1;
    putNativePixels(ctx, width, height, renderRealPlotContour({
        scalarGrid: {
            values: geometry.contourValues,
            colors: geometry.colors,
            sourceWidth: columns,
            sourceHeight: rows
        },
        width,
        height,
        contoursEnabled: state.contoursEnabled,
        contourInterval: getContourInterval(),
        contourThickness: getContourThickness()
    }));
}

function drawPlaneOverlay(ctx, cssWidth, cssHeight, dpr, labels, xRange, yRange) {
    const params = makePlaneParams(cssWidth, cssHeight, xRange, yRange);

    ctx.save();
    ctx.scale(dpr, dpr);
    drawGrid(ctx, params, {
        targetCount: 12,
        minorColor: 'rgba(128, 137, 255, 0.08)',
        majorColor: 'rgba(128, 137, 255, 0.15)'
    });
    drawAxes(ctx, params, {
        xLabel: labels.x,
        yLabel: labels.y,
        ticks: true,
        tickLabels: true,
        originDot: true,
        color: 'rgba(190, 196, 255, 0.55)',
        lineWidth: 1
    });
    ctx.restore();
}

export function draw2DContourPlot(canvas) {
    if (!canvas) throw new Error('2D contour rendering requires a canvas.');

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D contour rendering requires a canvas 2D context.');

    const { cssWidth, cssHeight, width, height, dpr } = resizeContourCanvas(canvas);

    ctx.clearRect(0, 0, width, height);

    if (state.laplaceModeEnabled) {
        const surface = state.laplaceSurface;
        renderLaplaceHeightField(ctx, width, height);
        drawPlaneOverlay(ctx, cssWidth, cssHeight, dpr, { x: 'σ', y: 'jω' }, surface.sigmaRange, surface.omegaRange);
        return;
    }

    if (state.riemannSurfaceEnabled) {
        renderRiemannHeightField(ctx, width, height);
        drawPlaneOverlay(ctx, cssWidth, cssHeight, dpr, { x: 'Re(z)', y: 'Im(z)' });
        return;
    }

    if (state.realPlotsEnabled) {
        const pixels = renderRealPlotContour({
            width,
            height,
            contoursEnabled: state.contoursEnabled,
            contourInterval: getContourInterval(),
            contourThickness: getContourThickness()
        });
        putNativePixels(ctx, width, height, pixels);
        drawPlaneOverlay(ctx, cssWidth, cssHeight, dpr, { x: 'x', y: 'y' });
        return;
    }

    throw new Error('2D contour rendering requires an active Laplace, Riemann, or real-plot mode.');
}
