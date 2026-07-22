import { state, context, zPlaneParams, wPlaneParams, sphereViewParams, wPlaneInitialRanges, zPlaneInitialRanges } from '../store/state.js';
import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT, SPHERE_INITIAL_ROT_X, SPHERE_INITIAL_ROT_Y, SPHERE_VIEW_RADIUS_FACTOR } from '../constants/rendering.js';
import { TAYLOR_CENTER_PRESETS } from '../constants/numerical.js';
import { updatePlaneViewportRanges } from './canvas-utils.js';
import { initializeWebGLLineSupport } from '../rendering/webgl-planar.js';
import { initializeWebGLDomainColoringSupport } from '../rendering/webgl-domain-coloring.js';
import { disposeRiemannSurface } from '../rendering/webgl-riemann-surface.js';
import { captureBeforeResize } from '../rendering/domain-dynamics.js';
import { eventBus } from '../store/events.js';
import { registerControls } from '../ui/control-registry.js';

const { controls } = context;

let zCanvas, wCanvas, zCtx, wCtx, zDomainColorCanvas, wDomainColorCanvas, zDomainColorCtx, wDomainColorCtx;
let wCanvasList, wCtxList, wPlaneParamsList, wPlaneThreeContainersList, sphereViewWParamsList;

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

    if (typeof initializeWebGLLineSupport === 'function') {
        initializeWebGLLineSupport();
    }
    if (typeof initializeWebGLDomainColoringSupport === 'function') {
        initializeWebGLDomainColoringSupport();
    }

    registerControls(document, controls);
    controls.cauchy_integral_results_info = controls.cauchyIntegralResultsInfo;
    controls.zPlaneCanvas = zCanvas;
    controls.wPlaneCanvas = wCanvas;

    zDomainColorCanvas = document.createElement('canvas'); wDomainColorCanvas = document.createElement('canvas');
    zDomainColorCtx = zDomainColorCanvas.getContext('2d', { willReadFrequently: true });
    zDomainColorCtx.imageSmoothingEnabled = true;
    zDomainColorCtx.imageSmoothingQuality = 'high';
    wDomainColorCtx = wDomainColorCanvas.getContext('2d', { willReadFrequently: true });
    wDomainColorCtx.imageSmoothingEnabled = true;
    wDomainColorCtx.imageSmoothingQuality = 'high';

    wCanvasList = [wCanvas];
    wCtxList = [wCtx];
    wPlaneParamsList = [wPlaneParams];
    wPlaneThreeContainersList = [controls.wPlaneThreeContainer];
    sphereViewWParamsList = [sphereViewParams.w];

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
        'enableRiemannSphereCb', 'enableSplitViewCb', 'enableVectorFieldCb',
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
    context.wDomainColorCanvas = wDomainColorCanvas;
    context.zDomainColorCtx = zDomainColorCtx;
    context.wDomainColorCtx = wDomainColorCtx;
    context.wCanvasList = wCanvasList;
    context.wCtxList = wCtxList;
    context.wPlaneParamsList = wPlaneParamsList;
    context.wPlaneThreeContainersList = wPlaneThreeContainersList;
    context.sphereViewWParamsList = sphereViewWParamsList;
}

export function setupCanvasBaseParams(planeParams, canvasElement, sphereViewObj, isFullscreen = false) {
    let newWidth, newHeight;
    if (isFullscreen) {
        const container = canvasElement.parentElement; 
        newWidth = container.clientWidth;
        newHeight = container.clientHeight;
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
    canvasElement.width = newWidth;
    canvasElement.height = newHeight;
    planeParams.width = canvasElement.width;
    planeParams.height = canvasElement.height;

    sphereViewObj.radius = Math.min(planeParams.width, planeParams.height) / 2 * SPHERE_VIEW_RADIUS_FACTOR;
    sphereViewObj.centerX = planeParams.width / 2;
    sphereViewObj.centerY = planeParams.height / 2;

    const domainColorCanvas = (canvasElement === zCanvas) ? zDomainColorCanvas : wDomainColorCanvas;
    domainColorCanvas.width = planeParams.width;
    domainColorCanvas.height = planeParams.height;
}

export function setupVisualParameters(updateZFromSlider = true, updateWFromSlider = true) {
    if (typeof captureBeforeResize === 'function') {
        captureBeforeResize();
    }
    const zIsFullscreen = state.isZFullScreen;
    const wIsFullscreen = state.isWFullScreen;

    let zWorldCenterX = (zPlaneParams.currentVisXRange[0] + zPlaneParams.currentVisXRange[1]) / 2;
    let zWorldCenterY = (zPlaneParams.currentVisYRange[0] + zPlaneParams.currentVisYRange[1]) / 2;

    if (state.realPlotsEnabled && state.realPlotsCameraTargetMath) {
        zWorldCenterX = state.realPlotsCameraTargetMath.x;
        zWorldCenterY = state.realPlotsCameraTargetMath.y;
        // Signal that the physical camera must be reset to match the new math center
        state.realPlotsCameraNeedsReset = true;
        state.realPlotsCameraTargetMath = null;
    }

    let wWorldCenterX = (wPlaneParams.xRange[0] + wPlaneParams.xRange[1]) / 2;
    let wWorldCenterY = (wPlaneParams.yRange[0] + wPlaneParams.yRange[1]) / 2;

    setupCanvasBaseParams(zPlaneParams, zCanvas, sphereViewParams.z, zIsFullscreen);

    if (wCanvasList && wCanvasList.length > 0) {
        for (let i = 0; i < wCanvasList.length; i++) {
            const isThisWFullscreen = wIsFullscreen && (state.fullscreenWIndex === i);
            setupCanvasBaseParams(wPlaneParamsList[i], wCanvasList[i], sphereViewWParamsList[i], isThisWFullscreen);
        }
    } else {
        setupCanvasBaseParams(wPlaneParams, wCanvas, sphereViewParams.w, wIsFullscreen);
    }

    if (updateZFromSlider) { 
        const zoomZ = state.zPlaneZoom;
        const initialXSpanZ = zPlaneInitialRanges.x[1] - zPlaneInitialRanges.x[0];
        const initialYSpanZ = zPlaneInitialRanges.y[1] - zPlaneInitialRanges.y[0];
        const currentXSpanZ = initialXSpanZ / zoomZ;
        const currentYSpanZ = initialYSpanZ / zoomZ;
        zPlaneParams.currentVisXRange[0] = zWorldCenterX - currentXSpanZ / 2;
        zPlaneParams.currentVisXRange[1] = zWorldCenterX + currentXSpanZ / 2;
        zPlaneParams.currentVisYRange[0] = zWorldCenterY - currentYSpanZ / 2;
        zPlaneParams.currentVisYRange[1] = zWorldCenterY + currentYSpanZ / 2;
    }
    const xSpanZ = zPlaneParams.currentVisXRange[1] - zPlaneParams.currentVisXRange[0];
    const ySpanZ = zPlaneParams.currentVisYRange[1] - zPlaneParams.currentVisYRange[0];
    if (xSpanZ === 0 || ySpanZ === 0) { return; }
    const scaleXZ = zPlaneParams.width / xSpanZ;
    const scaleYZ = zPlaneParams.height / ySpanZ;
    zPlaneParams.scale.x = zPlaneParams.scale.y = Math.min(scaleXZ, scaleYZ); 
    zPlaneParams.origin.x = (zPlaneParams.width / 2) - zWorldCenterX * zPlaneParams.scale.x;
    zPlaneParams.origin.y = (zPlaneParams.height / 2) + zWorldCenterY * zPlaneParams.scale.y; 
    updatePlaneViewportRanges(zPlaneParams); 

    if (updateWFromSlider) { 
        const zoomW = state.wPlaneZoom;
        const initialXSpanW = wPlaneInitialRanges.x[1] - wPlaneInitialRanges.x[0];
        const initialYSpanW = wPlaneInitialRanges.y[1] - wPlaneInitialRanges.y[0];
        const currentXSpanW = initialXSpanW / zoomW;
        const currentYSpanW = initialYSpanW / zoomW;
        wPlaneParams.xRange[0] = wWorldCenterX - currentXSpanW / 2;
        wPlaneParams.xRange[1] = wWorldCenterX + currentXSpanW / 2;
        wPlaneParams.yRange[0] = wWorldCenterY - currentYSpanW / 2;
        wPlaneParams.yRange[1] = wWorldCenterY + currentYSpanW / 2;
    }
    const xSpanW = wPlaneParams.xRange[1] - wPlaneParams.xRange[0];
    const ySpanW = wPlaneParams.yRange[1] - wPlaneParams.yRange[0];
    if (xSpanW === 0 || ySpanW === 0) { return; }
    const scaleXW = wPlaneParams.width / xSpanW;
    const scaleYW = wPlaneParams.height / ySpanW;
    wPlaneParams.scale.x = wPlaneParams.scale.y = Math.min(scaleXW, scaleYW);
    wPlaneParams.origin.x = (wPlaneParams.width / 2) - wWorldCenterX * wPlaneParams.scale.x;
    wPlaneParams.origin.y = (wPlaneParams.height / 2) + wWorldCenterY * wPlaneParams.scale.y;
    updatePlaneViewportRanges(wPlaneParams);

    // Propagate zoom/pan to all recursive planes
    if (wPlaneParamsList && wPlaneParamsList.length > 1) {
        for (let i = 1; i < wPlaneParamsList.length; i++) {
            const p = wPlaneParamsList[i];
            p.xRange = [...wPlaneParams.xRange];
            p.yRange = [...wPlaneParams.yRange];
            // Recompute scale and origin per-canvas using its own dimensions
            const pScaleX = p.width / xSpanW;
            const pScaleY = p.height / ySpanW;
            p.scale.x = p.scale.y = Math.min(pScaleX, pScaleY);
            p.origin.x = (p.width / 2) - wWorldCenterX * p.scale.x;
            p.origin.y = (p.height / 2) + wWorldCenterY * p.scale.y;
            updatePlaneViewportRanges(p);
        }
    }

    eventBus.emit('layout:canvas');
}

export function getChainingTitleHTML(i, mode) {
    if (i === 0) {
        return mode === 'zero_seed' ? `w = f(0; c=z)` : `w = f(z)`;
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

    return getNestedHTML(i + 1, mode === 'zero_seed' ? '0' : 'z');
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
    if (state.riemannSphereViewEnabled || state.splitViewEnabled) {
        return state.threeSphereEnabled ? '3D w-sphere' : 'w-sphere';
    }
    return 'w-plane';
}

export function updateChainingColumns(count) {
    if (!wCanvasList || wCanvasList.length === 0) {
        wCanvasList = [wCanvas];
        wCtxList = [wCtx];
        wPlaneParamsList = [wPlaneParams];
        wPlaneThreeContainersList = [controls.wPlaneThreeContainer];
        sphereViewWParamsList = [sphereViewParams.w];
    }
    
    const displayCount = count > 25 ? 1 : Math.max(1, Math.min(25, Math.floor(count)));
    const canvasesRow = document.querySelector('.canvas-row.two-column-layout');
    if (!canvasesRow) return;

    // Create more planes if needed
    while (wCanvasList.length < displayCount) {
        const i = wCanvasList.length;
        
        // Clone the w-plane column
        const originalCol = document.getElementById('w_plane_column');
        const newCol = originalCol.cloneNode(true);
        newCol.id = `w_plane_column_${i}`;
        
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

        // Hide collapse/expand buttons — not relevant for chained panels
        newCol.querySelectorAll('[id^="collapse_w"], [id^="expand_w"]').forEach(el => el.style.display = 'none');
        
        const probeInfo = newCol.querySelector('#w_plane_probe_info');
        if (probeInfo) probeInfo.id = `w_plane_probe_info_${i}`;
        
        const analysisInfo = newCol.querySelector('#w_plane_analysis_info');
        if (analysisInfo) analysisInfo.id = `w_plane_analysis_info_${i}`;
        
        const cauchyInfo = newCol.querySelector('#cauchy_integral_results_info');
        if (cauchyInfo) cauchyInfo.id = `cauchy_integral_results_info_${i}`;
        
        // Append to DOM
        canvasesRow.appendChild(newCol);
        
        // Setup contexts and params
        const ctx = newCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        const params = {
            width: DEFAULT_CANVAS_WIDTH, height: DEFAULT_CANVAS_HEIGHT,
            origin: {x:0, y:0}, scale: {x:1, y:1},
            xRange: [...wPlaneInitialRanges.x], yRange: [...wPlaneInitialRanges.y]
        };
        
        const sphereParams = { 
            rotX: SPHERE_INITIAL_ROT_X, rotY: SPHERE_INITIAL_ROT_Y, 
            dragging: false, lastMouseX: 0, lastMouseY: 0, 
            radius: 0, centerX: 0, centerY: 0 
        };
        
        wCanvasList.push(newCanvas);
        wCtxList.push(ctx);
        wPlaneParamsList.push(params);
        wPlaneThreeContainersList.push(newThreeContainer);
        sphereViewWParamsList.push(sphereParams);
    }
    
    // Remove planes if needed
    while (wCanvasList.length > displayCount) {
        const i = wCanvasList.length - 1;
        const colToRemove = document.getElementById(`w_plane_column_${i}`);
        disposeRiemannSurface(wCanvasList[i]);
        wPlaneThreeContainersList[i]?.__threeRiemannRenderer?.dispose();
        if (colToRemove) {
            canvasesRow.removeChild(colToRemove);
        }
        wCanvasList.pop();
        wCtxList.pop();
        wPlaneParamsList.pop();
        wPlaneThreeContainersList.pop();
        sphereViewWParamsList.pop();
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
    context.sphereViewWParamsList = sphereViewWParamsList;
}
