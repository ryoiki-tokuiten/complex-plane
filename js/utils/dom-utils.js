import { state, context, zPlaneParams, wPlaneParams, wPlaneInitialRanges, zPlaneInitialRanges, laplaceComPlaneParams, laplaceSpectrumPlaneParams } from '../store/state.js';
import { invalidateAllCanvasRects } from '../frontend/actions.js';
import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from '../constants/rendering.js';
import { TAYLOR_CENTER_PRESETS } from '../constants/numerical.js';
import { updatePlaneViewportRanges } from './canvas-utils.js';
import { synchronizePreciseViewport } from '../native/precise-viewport.js';
import { disposeRiemannSurface } from '../rendering/webgl-riemann-surface.js';
import { requireInteger } from './numeric-contracts.js';

const { controls } = context;

let zCanvas, wCanvas, zCtx, wCtx, zDomainColorCanvas;
let wCanvasList, wCtxList, wPlaneParamsList, wPlaneThreeContainersList;

export function formatTaylorNumericValue(value) {
    if (!Number.isFinite(value)) {
        return '0';
    }

    const normalizedValue = Math.abs(value) < 1e-10 ? 0 : value;
    return Number(normalizedValue.toFixed(6)).toString();
}

export function findTaylorCenterPreset(re, im) {
    return TAYLOR_CENTER_PRESETS.find(preset =>
        Math.abs(preset.re - re) < 1e-9 &&
        Math.abs(preset.im - im) < 1e-9
    ) || null;
}

export function setupCanvasReferences() {
    zCanvas = controls.zPlaneCanvas;
    wCanvas = controls.wPlaneCanvas;
    if (!zCanvas || !wCanvas) throw new Error('Plane canvases must be mounted before renderer initialization.');

    zCtx = zCanvas.getContext('2d');
    zCtx.imageSmoothingEnabled = true;
    zCtx.imageSmoothingQuality = 'high';
    wCtx = wCanvas.getContext('2d');
    wCtx.imageSmoothingEnabled = true;
    wCtx.imageSmoothingQuality = 'high';

    zDomainColorCanvas = controls.zPlaneDomainCanvas;
    if (!zDomainColorCanvas) throw new Error('Domain canvas must be mounted before renderer initialization.');

    wCanvasList = [wCanvas];
    wCtxList = [wCtx];
    wPlaneParamsList = [wPlaneParams];
    wPlaneThreeContainersList = [controls.wPlaneThreeContainer];

    context.zCanvas = zCanvas;
    context.wCanvas = wCanvas;
    context.zCtx = zCtx;
    context.wCtx = wCtx;
    context.zDomainColorCanvas = zDomainColorCanvas;
    context.wCanvasList = wCanvasList;
    context.wCtxList = wCtxList;
    context.wPlaneParamsList = wPlaneParamsList;
    context.wPlaneThreeContainersList = wPlaneThreeContainersList;
}

function setupCanvasBaseParams(planeParams, canvasElement, isFullscreen = false) {
    let newWidth, newHeight;
    if (isFullscreen) {
        const container = canvasElement.parentElement; 
        newWidth = container ? container.clientWidth : DEFAULT_CANVAS_WIDTH;
        newHeight = container ? container.clientHeight : DEFAULT_CANVAS_HEIGHT;
    } else {
        const parentElement = canvasElement.parentElement;
        if (parentElement && parentElement.clientWidth > 50 && parentElement.clientHeight > 50) {
            newWidth = parentElement.clientWidth;
            newHeight = parentElement.clientHeight;
        } else {
            newWidth = DEFAULT_CANVAS_WIDTH;
            newHeight = DEFAULT_CANVAS_HEIGHT;
        }
    }
    // Domain coloring retains every viewport pixel; its GPU validates hardware limits.
    const MAX_CANVAS_DIM = canvasElement === zCanvas ? Infinity : 2560;
    newWidth = Math.min(MAX_CANVAS_DIM, Math.max(1, Math.round(newWidth)));
    newHeight = Math.min(MAX_CANVAS_DIM, Math.max(1, Math.round(newHeight)));

    if (canvasElement.width !== newWidth) canvasElement.width = newWidth;
    if (canvasElement.height !== newHeight) canvasElement.height = newHeight;
    planeParams.width = canvasElement.width;
    planeParams.height = canvasElement.height;

    // The domain render worker resizes its own OffscreenCanvas from the same
    // viewport snapshot. A transferred HTML canvas cannot be resized here.
}

export function setupVisualParameters(updateZFromSlider = true, updateWFromSlider = true) {
    const zIsFullscreen = state.isZFullScreen;
    const wIsFullscreen = state.isWFullScreen;

    setupCanvasBaseParams(zPlaneParams, zCanvas, zIsFullscreen);
    setupCanvasBaseParams(wPlaneParams, wCanvas, wIsFullscreen);

    for (const [plane, ranges, zoom, fromSlider] of [
        [zPlaneParams, zPlaneInitialRanges, state.zPlaneZoom, updateZFromSlider],
        [wPlaneParams, wPlaneInitialRanges, state.wPlaneZoom, updateWFromSlider]
    ]) {
        const fittedScale = Math.min(plane.width / (ranges.x[1] - ranges.x[0]),
            plane.height / (ranges.y[1] - ranges.y[0]));
        const previous = plane.preciseViewport;
        const baseScale = !fromSlider && previous
            ? previous.baseScale * Math.min(plane.width / previous.width, plane.height / previous.height)
            : fittedScale;
        synchronizePreciseViewport(plane, fromSlider ? zoom : previous?.zoom ?? zoom, baseScale);
    }



    if (controls.laplaceComCanvas) {
        setupCanvasBaseParams(laplaceComPlaneParams, controls.laplaceComCanvas, state.isLaplaceComFullScreen);
        const xSpan = laplaceComPlaneParams.currentVisXRange[1] - laplaceComPlaneParams.currentVisXRange[0];
        const ySpan = laplaceComPlaneParams.currentVisYRange[1] - laplaceComPlaneParams.currentVisYRange[0];
        if (xSpan > 0 && ySpan > 0) {
            laplaceComPlaneParams.scale.x = laplaceComPlaneParams.width / xSpan;
            laplaceComPlaneParams.scale.y = laplaceComPlaneParams.height / ySpan;
            laplaceComPlaneParams.origin.x = -laplaceComPlaneParams.currentVisXRange[0] * laplaceComPlaneParams.scale.x;
            laplaceComPlaneParams.origin.y = laplaceComPlaneParams.height * 0.5;
            updatePlaneViewportRanges(laplaceComPlaneParams);
        }
    }

    if (controls.laplaceSpectrumCanvas) {
        setupCanvasBaseParams(laplaceSpectrumPlaneParams, controls.laplaceSpectrumCanvas, state.isLaplaceSpectrumFullScreen);
        const xSpan = laplaceSpectrumPlaneParams.currentVisXRange[1] - laplaceSpectrumPlaneParams.currentVisXRange[0];
        const ySpan = laplaceSpectrumPlaneParams.currentVisYRange[1] - laplaceSpectrumPlaneParams.currentVisYRange[0];
        if (xSpan > 0 && ySpan > 0) {
            laplaceSpectrumPlaneParams.scale.x = laplaceSpectrumPlaneParams.width / xSpan;
            laplaceSpectrumPlaneParams.scale.y = laplaceSpectrumPlaneParams.height / ySpan;
            laplaceSpectrumPlaneParams.origin.x = -laplaceSpectrumPlaneParams.currentVisXRange[0] * laplaceSpectrumPlaneParams.scale.x;
            laplaceSpectrumPlaneParams.origin.y = laplaceSpectrumPlaneParams.height - 20;
            updatePlaneViewportRanges(laplaceSpectrumPlaneParams);
        }
    }

    invalidateAllCanvasRects();
}

export function getChainingTitleHTML(i, mode) {
    const seed = mode === 'zero_seed' ? formatChainingSeed(state.chainSeed) : 'z';
    if (i === 0) {
        return mode === 'zero_seed' ? `w = f(${seed}; c=z)` : `w = f(z)`;
    }
    
    const getNestedHTML = (count, innerText) => {
        if (count <= 3) {
            let res = innerText;
            for(let k = 0; k < count; k++) res = `f(${res})`;
            return `w = ${res}`;
        }
        let res = '';
        for (let k = 0; k < 3; k++) res += 'f(';
        res += `... f(${innerText})`;
        for (let k = 0; k < 3; k++) res += ')';
        return `w = ${res}`;
    };

    return getNestedHTML(i + 1, seed);
}

function formatChainingSeed(seed) {
    const re = formatTaylorNumericValue(seed?.re);
    const imValue = Number(seed?.im);
    const im = formatTaylorNumericValue(Math.abs(imValue));
    if (!imValue) return re;
    if (!Number(seed?.re)) return `${imValue < 0 ? '-' : ''}${im === '1' ? 'i' : `${im}i`}`;
    return `${re} ${imValue < 0 ? '-' : '+'} ${im}i`;
}


export function composeCanvasLayers(layers) {
    const image = document.createElement('canvas');
    image.width = layers[0].width;
    image.height = layers[0].height;
    const ctx = image.getContext('2d');
    for (const layer of layers) ctx.drawImage(layer, 0, 0);
    return image;
}

export function downloadCanvasImage(canvas, filename = 'complex-plane.png') {
    if (!canvas) return;
    try {
        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error('Failed to download canvas image:', error);
    }
}
