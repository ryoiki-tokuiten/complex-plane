import { state, context, zPlaneParams, wPlaneParams, wPlaneInitialRanges, zPlaneInitialRanges, laplaceComPlaneParams, laplaceSpectrumPlaneParams } from '../store/state.js';
import { bindGenericPlaneInteractions } from '../ui/event-listeners.js';
import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from '../constants/rendering.js';
import { TAYLOR_CENTER_PRESETS } from '../constants/numerical.js';
import { updatePlaneViewportRanges } from './canvas-utils.js';
import { synchronizePreciseViewport } from '../native/precise-viewport.js';
import { disposeRiemannSurface } from '../rendering/webgl-riemann-surface.js';
import { eventBus } from '../store/events.js';
import { registerControls } from '../ui/control-registry.js';
import { requireInteger } from './numeric-contracts.js';

const { controls } = context;

let zCanvas, wCanvas, zCtx, wCtx, zDomainColorCanvas, zDomainColorCtx;
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

export function setupDOMReferences() {
    zCanvas = document.getElementById('z_plane_canvas'); wCanvas = document.getElementById('w_plane_canvas');
    zCtx = zCanvas.getContext('2d');
    zCtx.imageSmoothingEnabled = true;
    zCtx.imageSmoothingQuality = 'high';
    wCtx = wCanvas.getContext('2d');
    wCtx.imageSmoothingEnabled = true;
    wCtx.imageSmoothingQuality = 'high';

    registerControls(document, controls);
    controls.cauchy_integral_results_info = controls.cauchyIntegralResultsInfo;
    controls.zPlaneCanvas = zCanvas;
    controls.wPlaneCanvas = wCanvas;

    zDomainColorCanvas = document.createElement('canvas');
    zDomainColorCtx = zDomainColorCanvas.getContext('2d');

    wCanvasList = [wCanvas];
    wCtxList = [wCtx];
    wPlaneParamsList = [wPlaneParams];
    wPlaneThreeContainersList = [controls.wPlaneThreeContainer];

    controls.funcButtons = Object.fromEntries(
        [...document.querySelectorAll('[id^="select_"][id$="_btn"]')]
            .map(button => [button.id.slice(7, -4), button])
    );
    
    const requiredControls = [
        'zPlaneCanvas', 'wPlaneCanvas',
        'inputShapeSelector', 'gridDensitySlider',
        'functionControlsPanel', 'visualizationOptionsPanel',
        'commonParamsSliders',
        'shapeParamsSliders', 'mobiusParamsSliders', 'polynomialParamsSliders',
        'enableDomainColoringCb', 'showZerosPolesCb', 'showCriticalPointsCb',
        'enableManifold3DCb', 'enableVectorFieldCb',
        'zPlaneZoomSlider', 'wPlaneZoomSlider'
    ];

    const missingControls = requiredControls.filter(key => !controls[key]);
    if (missingControls.length > 0) {
        console.error(`Essential controls not found: ${missingControls.join(', ')}`);
    }
    context.zCanvas = zCanvas;
    context.wCanvas = wCanvas;
    context.zCtx = zCtx;
    context.wCtx = wCtx;
    context.zDomainColorCanvas = zDomainColorCanvas;
    context.zDomainColorCtx = zDomainColorCtx;
    context.wCanvasList = wCanvasList;
    context.wCtxList = wCtxList;
    context.wPlaneParamsList = wPlaneParamsList;
    context.wPlaneThreeContainersList = wPlaneThreeContainersList;
}

export function setupCanvasBaseParams(planeParams, canvasElement, isFullscreen = false) {
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

    if (canvasElement === zCanvas) {
        if (zDomainColorCanvas && zDomainColorCanvas.width !== planeParams.width) zDomainColorCanvas.width = planeParams.width;
        if (zDomainColorCanvas && zDomainColorCanvas.height !== planeParams.height) zDomainColorCanvas.height = planeParams.height;
    }
}

export function setupVisualParameters(updateZFromSlider = true, updateWFromSlider = true) {
    const zIsFullscreen = state.isZFullScreen;
    const wIsFullscreen = state.isWFullScreen;

    let zWorldCenterX = (zPlaneParams.currentVisXRange[0] + zPlaneParams.currentVisXRange[1]) / 2;
    let zWorldCenterY = (zPlaneParams.currentVisYRange[0] + zPlaneParams.currentVisYRange[1]) / 2;

    let wWorldCenterX = (wPlaneParams.currentVisXRange[0] + wPlaneParams.currentVisXRange[1]) / 2;
    let wWorldCenterY = (wPlaneParams.currentVisYRange[0] + wPlaneParams.currentVisYRange[1]) / 2;

    setupCanvasBaseParams(zPlaneParams, zCanvas, zIsFullscreen);

    if (wCanvasList && wCanvasList.length > 0) {
        for (let i = 0; i < wCanvasList.length; i++) {
            const isThisWFullscreen = wIsFullscreen && (state.fullscreenWIndex === i);
            setupCanvasBaseParams(wPlaneParamsList[i], wCanvasList[i], isThisWFullscreen);
        }
    } else {
        setupCanvasBaseParams(wPlaneParams, wCanvas, wIsFullscreen);
    }

    let zIsPrecise = !!zPlaneParams.preciseViewport;
    if (updateZFromSlider) { 
        const zoomZ = state.zPlaneZoom;
        zIsPrecise = synchronizePreciseViewport(zPlaneParams, zoomZ);
    }
    if (!zIsPrecise) {
        const initialXSpanZ = zPlaneInitialRanges.x[1] - zPlaneInitialRanges.x[0];
        const initialYSpanZ = zPlaneInitialRanges.y[1] - zPlaneInitialRanges.y[0];
        if (initialXSpanZ > 0 && initialYSpanZ > 0) {
            const baseScaleZ = Math.min(zPlaneParams.width / initialXSpanZ, zPlaneParams.height / initialYSpanZ);
            const scaleZ = baseScaleZ * (state.zPlaneZoom || 1);
            zPlaneParams.scale.x = zPlaneParams.scale.y = scaleZ; 
            zPlaneParams.origin.x = (zPlaneParams.width / 2) - zWorldCenterX * scaleZ;
            zPlaneParams.origin.y = (zPlaneParams.height / 2) + zWorldCenterY * scaleZ; 
            updatePlaneViewportRanges(zPlaneParams);
        }
    }

    let wIsPrecise = !!wPlaneParams.preciseViewport;
    if (updateWFromSlider) { 
        const zoomW = state.wPlaneZoom;
        wIsPrecise = synchronizePreciseViewport(wPlaneParams, zoomW);
    }
    if (!wIsPrecise) {
        const initialXSpanW = wPlaneInitialRanges.x[1] - wPlaneInitialRanges.x[0];
        const initialYSpanW = wPlaneInitialRanges.y[1] - wPlaneInitialRanges.y[0];
        if (initialXSpanW > 0 && initialYSpanW > 0) {
            const baseScaleW = Math.min(wPlaneParams.width / initialXSpanW, wPlaneParams.height / initialYSpanW);
            const scaleW = baseScaleW * (state.wPlaneZoom || 1);
            wPlaneParams.scale.x = wPlaneParams.scale.y = scaleW;
            wPlaneParams.origin.x = (wPlaneParams.width / 2) - wWorldCenterX * scaleW;
            wPlaneParams.origin.y = (wPlaneParams.height / 2) + wWorldCenterY * scaleW;
            updatePlaneViewportRanges(wPlaneParams);
        }
    }

    // Propagate zoom/pan to all recursive planes
    if (!wIsPrecise && wPlaneParamsList && wPlaneParamsList.length > 1) {
        const initialXSpanW = wPlaneInitialRanges.x[1] - wPlaneInitialRanges.x[0];
        const initialYSpanW = wPlaneInitialRanges.y[1] - wPlaneInitialRanges.y[0];
        for (let i = 1; i < wPlaneParamsList.length; i++) {
            const p = wPlaneParamsList[i];
            const baseScaleP = Math.min(p.width / initialXSpanW, p.height / initialYSpanW);
            const scaleP = baseScaleP * (state.wPlaneZoom || 1);
            p.scale.x = p.scale.y = scaleP;
            p.origin.x = (p.width / 2) - wWorldCenterX * scaleP;
            p.origin.y = (p.height / 2) + wWorldCenterY * scaleP;
            updatePlaneViewportRanges(p);
        }
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

    eventBus.emit('layout:canvas');
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

function renderChainingTitle(target, index, derivative = false) {
    const code = document.createElement('code');
    code.id = `w-plane-title-func_${index}`;
    code.textContent = getChainingTitleHTML(index, state.chainingMode);
    target.replaceChildren(
        document.createTextNode(`${getChainedOutputLabel()} (Chain ${index}: ${derivative ? 'Derivative of ' : ''}`),
        code,
        document.createTextNode(')')
    );
}

export function updateChainingTitles() {
    if (!wCanvasList) return;
    for (let i = 1; i < wCanvasList.length; i++) {
        const titleSpan = document.getElementById(`w-plane-title_${i}`);
        if (titleSpan) {
            renderChainingTitle(titleSpan, i, state.mapPresentation === 'derivative');
        }
    }
}

function getChainedOutputLabel() {
    if (state.riemannSurfaceEnabled) return 'Riemann surface';
    if (state.manifold3dViewEnabled) {
        return '3D Manifold';
    }
    return 'w-plane';
}

export function updateChainingColumns(count) {
    if (!wCanvasList || wCanvasList.length === 0) {
        wCanvasList = [wCanvas];
        wCtxList = [wCtx];
        wPlaneParamsList = [wPlaneParams];
        wPlaneThreeContainersList = [controls.wPlaneThreeContainer];
    }
    
    const chainCount = requireInteger(count, 'Chaining column count');
    if (chainCount < 1 || chainCount > 1024) {
        throw new Error('Chaining column count must be from one through 1024.');
    }
    const displayCount = chainCount > 25 ? 1 : chainCount;
    const canvasesRow = document.querySelector('.canvas-row.two-column-layout');
    if (!canvasesRow) return;

    if (wCanvasList.length === displayCount) {
        context.wCanvasList = wCanvasList;
        context.wCtxList = wCtxList;
        context.wPlaneParamsList = wPlaneParamsList;
        context.wPlaneThreeContainersList = wPlaneThreeContainersList;
        return;
    }

    // Create more planes if needed
    while (wCanvasList.length < displayCount) {
        const i = wCanvasList.length;
        
        // Clone the w-plane column
        const originalCol = document.getElementById('w_plane_column');
        const newCol = originalCol.cloneNode(true);
        newCol.id = `w_plane_column_${i}`;
        
        // Remove cloned edge handle bars so the layout manager recreates them with fresh event listeners
        newCol.querySelectorAll('.panel-edge-handle-bar').forEach(el => el.remove());
        
        // Update IDs within the new column
        const titleSpan = newCol.querySelector('#w-plane-title');
        if (titleSpan) {
            titleSpan.id = `w-plane-title_${i}`;
            renderChainingTitle(titleSpan, i);
        }

        newCol.querySelectorAll('.riemann-surface-canvas, .riemann-surface-hud').forEach(element => {
            element.remove();
        });
        
        const newCanvas = newCol.querySelector('#w_plane_canvas');
        if (newCanvas) {
            newCanvas.id = `w_plane_canvas_${i}`;
        }
        
        const newThreeContainer = newCol.querySelector('#w_plane_three_container');
        if (newThreeContainer) {
            newThreeContainer.id = `w_plane_three_container_${i}`;
        }

        // Make fullscreen toggle IDs unique for event delegation
        const fsBtn = newCol.querySelector('#toggle_fullscreen_w_btn');
        if (fsBtn) {
            fsBtn.id = `toggle_fullscreen_w_btn_${i}`;
        }


        
        const probeInfo = newCol.querySelector('#w_plane_probe_info');
        if (probeInfo) probeInfo.id = `w_plane_probe_info_${i}`;
        
        const cauchyInfo = newCol.querySelector('#cauchy_integral_results_info');
        if (cauchyInfo) cauchyInfo.id = `cauchy_integral_results_info_${i}`;

        // Position new column cleanly in whiteboard coordinates next to previous column
        const prevCol = (i === 1) ? originalCol : document.getElementById(`w_plane_column_${i-1}`);
        if (prevCol) {
            const prevLeft = prevCol.offsetLeft || parseInt(prevCol.style.left, 10) || 0;
            const prevTop = prevCol.offsetTop || parseInt(prevCol.style.top, 10) || 24;
            const prevWidth = prevCol.offsetWidth || parseInt(prevCol.style.width, 10) || 540;
            const prevHeight = prevCol.offsetHeight || parseInt(prevCol.style.height, 10) || 480;
            newCol.style.left = `${prevLeft + prevWidth + 24}px`;
            newCol.style.top = `${prevTop}px`;
            newCol.style.width = `${prevWidth}px`;
            newCol.style.height = `${prevHeight}px`;
        }

        // Append to DOM
        canvasesRow.appendChild(newCol);
        
        // Setup contexts and params
        const ctx = newCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        const params = {
            width: DEFAULT_CANVAS_WIDTH, height: DEFAULT_CANVAS_HEIGHT,
            origin: {x:0, y:0}, scale: {x:1, y:1},
            currentVisXRange: [...wPlaneInitialRanges.x],
            currentVisYRange: [...wPlaneInitialRanges.y]
        };
        
        wCanvasList.push(newCanvas);
        wCtxList.push(ctx);
        wPlaneParamsList.push(params);
        wPlaneThreeContainersList.push(newThreeContainer);

        // Allow pan/zoom in chained canvases
        bindGenericPlaneInteractions(newCanvas, params, () => eventBus.emit('redraw:domain'));
    }
    
    // Remove planes if needed
    while (wCanvasList.length > displayCount) {
        const i = wCanvasList.length - 1;
        const colToRemove = document.getElementById(`w_plane_column_${i}`);
        disposeRiemannSurface(wCanvasList[i]);
        wPlaneThreeContainersList[i]?.__threeManifoldsRenderer?.dispose();
        if (colToRemove) {
            canvasesRow.removeChild(colToRemove);
        }
        wCanvasList.pop();
        wCtxList.pop();
        wPlaneParamsList.pop();
        wPlaneThreeContainersList.pop();
        context.wPlanarTransformedLayerCacheList?.pop();
    }
    
    // Update the original w_plane title if needed
    const wPlaneTitleFunc = document.getElementById('w-plane-title-func');
    if (wPlaneTitleFunc && displayCount > 1) {
        wPlaneTitleFunc.textContent = getChainingTitleHTML(0, state.chainingMode);
    }
    
    setupVisualParameters(false, false);
    context.wCanvasList = wCanvasList;
    context.wCtxList = wCtxList;
    context.wPlaneParamsList = wPlaneParamsList;
    context.wPlaneThreeContainersList = wPlaneThreeContainersList;
}
