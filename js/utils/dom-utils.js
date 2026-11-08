import { state, context, zPlaneParams, wPlaneParams, wPlaneInitialRanges, zPlaneInitialRanges, laplaceComPlaneParams, laplaceSpectrumPlaneParams } from '../store/state.js';
import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from '../constants/rendering.js';
import { TAYLOR_CENTER_PRESETS } from '../constants/numerical.js';
import { updatePlaneViewportRanges } from './canvas-utils.js';
import { invalidateAllCanvasRects } from './canvas-interaction.js';
import { synchronizePreciseViewport } from '../native/precise-viewport.js';
import { bigFixedToNumber, numberToBigFixed } from '../rendering/domain-coloring.js';

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
    // Hard upper limits to prevent runaway canvas memory allocation and GPU/browser crashes
    const MAX_CANVAS_DIM = 2560;
    newWidth = Math.min(MAX_CANVAS_DIM, Math.max(1, Math.round(newWidth)));
    newHeight = Math.min(MAX_CANVAS_DIM, Math.max(1, Math.round(newHeight)));

    if (canvasElement.width !== newWidth) canvasElement.width = newWidth;
    if (canvasElement.height !== newHeight) canvasElement.height = newHeight;
    planeParams.width = canvasElement.width;
    planeParams.height = canvasElement.height;
}

function setupPrimaryPlaneParameters(planeParams, initialRanges, zoom, updateFromSlider) {
    const hasBigCenter = typeof planeParams.centerBigX === 'bigint' && typeof planeParams.centerBigY === 'bigint';
    const worldCenterX = hasBigCenter
        ? bigFixedToNumber(planeParams.centerBigX)
        : (planeParams.currentVisXRange[0] + planeParams.currentVisXRange[1]) / 2;
    const worldCenterY = hasBigCenter
        ? bigFixedToNumber(planeParams.centerBigY)
        : (planeParams.currentVisYRange[0] + planeParams.currentVisYRange[1]) / 2;

    const initialXSpan = initialRanges.x[1] - initialRanges.x[0];
    const initialYSpan = initialRanges.y[1] - initialRanges.y[0];
    if (initialXSpan > 0 && initialYSpan > 0 && updateFromSlider) {
        if (typeof planeParams.centerBigX !== 'bigint') {
            planeParams.centerBigX = numberToBigFixed(worldCenterX);
        }
        if (typeof planeParams.centerBigY !== 'bigint') {
            planeParams.centerBigY = numberToBigFixed(worldCenterY);
        }
        const baseScale = Math.min(planeParams.width / initialXSpan, planeParams.height / initialYSpan);
        const minDim = Math.max(1, Math.min(planeParams.width || 1, planeParams.height || 1));
        const baseRawScale = (0.5 * minDim) / baseScale;
        const zoomLog10 = Math.log10(Math.max(1e-300, Number(zoom) || 1));
        const totalLog10 = Math.max(-300, Math.log10(baseRawScale) - zoomLog10);
        const exp10 = Math.floor(totalLog10);
        planeParams.scaleExp10 = exp10;
        planeParams.scaleMant = Math.pow(10, totalLog10 - exp10);
    }

    if (initialXSpan <= 0 || initialYSpan <= 0) return;

    const baseScale = Math.min(planeParams.width / initialXSpan, planeParams.height / initialYSpan);
    const scale = Math.min(1e300, Math.max(1e-300, baseScale * (zoom || 1)));
    planeParams.scale.x = planeParams.scale.y = scale;
    planeParams.origin.x = Math.min(1e304, Math.max(-1e304, planeParams.width * 0.5 - worldCenterX * scale));
    planeParams.origin.y = Math.min(1e304, Math.max(-1e304, planeParams.height * 0.5 + worldCenterY * scale));
    if (typeof planeParams.centerBigX === 'bigint' && typeof planeParams.centerBigY === 'bigint') {
        planeParams._lastSyncedOriginX = planeParams.origin.x;
        planeParams._lastSyncedOriginY = planeParams.origin.y;
        planeParams._lastSyncedScaleX = planeParams.scale.x;
        planeParams._lastSyncedWidth = planeParams.width;
        planeParams._lastSyncedHeight = planeParams.height;
    }

    let isPrecise = !!planeParams.preciseViewport;
    if (updateFromSlider) isPrecise = synchronizePreciseViewport(planeParams, zoom);
    if (isPrecise) return;

    updatePlaneViewportRanges(planeParams);
}

function setupAuxiliaryPlaneParameters(planeParams, canvasElement, isFullscreen, originAtBottom) {
    setupCanvasBaseParams(planeParams, canvasElement, isFullscreen);
    const xSpan = planeParams.currentVisXRange[1] - planeParams.currentVisXRange[0];
    const ySpan = planeParams.currentVisYRange[1] - planeParams.currentVisYRange[0];
    if (xSpan <= 0 || ySpan <= 0) return;

    planeParams.scale.x = planeParams.width / xSpan;
    planeParams.scale.y = planeParams.height / ySpan;
    planeParams.origin.x = -planeParams.currentVisXRange[0] * planeParams.scale.x;
    planeParams.origin.y = originAtBottom ? planeParams.height - 20 : planeParams.height * 0.5;
    updatePlaneViewportRanges(planeParams);
}

export function setupVisualParameters(updateZFromSlider = true, updateWFromSlider = true) {
    setupCanvasBaseParams(zPlaneParams, zCanvas, state.isZFullScreen);
    setupCanvasBaseParams(wPlaneParams, wCanvas, state.isWFullScreen);
    setupPrimaryPlaneParameters(zPlaneParams, zPlaneInitialRanges, state.zPlaneZoom, updateZFromSlider);
    setupPrimaryPlaneParameters(wPlaneParams, wPlaneInitialRanges, state.wPlaneZoom, updateWFromSlider);

    if (controls.laplaceComCanvas) {
        setupAuxiliaryPlaneParameters(laplaceComPlaneParams, controls.laplaceComCanvas, state.isLaplaceComFullScreen, false);
    }

    if (controls.laplaceSpectrumCanvas) {
        setupAuxiliaryPlaneParameters(laplaceSpectrumPlaneParams, controls.laplaceSpectrumCanvas, state.isLaplaceSpectrumFullScreen, true);
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
    const target = layers[layers.length - 1] || layers[0];
    const image = document.createElement('canvas');
    image.width = target.width;
    image.height = target.height;
    const ctx = image.getContext('2d');
    for (const layer of layers) {
        if (layer) ctx.drawImage(layer, 0, 0, image.width, image.height);
    }
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
