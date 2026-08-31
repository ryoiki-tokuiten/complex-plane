import { state, context, subscribeState, mutateState, zPlaneParams, wPlaneParams, laplaceComPlaneParams, laplaceSpectrumPlaneParams, sliderParamKeys } from '../store/state.js';
import { runtime } from '../store/runtime.js';
import { setupVisualParameters, updateChainingColumns } from '../utils/dom-utils.js';
import { loadUploadedMediaFile, toggleUploadedVideoPlayback, pauseUploadedVideoPlayback, startVideoProcessingLoop, syncVideoPlaybackUI, getMediaSource, isMediaInputShape } from '../utils/raster-media.js';
import { initPlaneContextMenu, hidePlaneContextMenu } from './plane-context-menu.js';
import { updatePlaneViewportRanges, mapCanvasToWorldCoords, setPlaneViewport } from '../utils/canvas-utils.js';
import { requireFiniteComplex, requireFiniteNumber } from '../utils/numeric-contracts.js';
import { clonePlain } from '../utils/clone-utils.js';
import {
    requestDomainRedraw as requestScheduledDomainRedraw,
    requestUiRedraw as requestScheduledUiRedraw
} from '../rendering/redraw-scheduler.js';
import {
    setLaplaceSurfaceViewport,
    updateLaplaceEvaluationPoint,
    updateLaplaceTransform
} from '../analysis/laplace-transform.js';
import { ZOOM_IN_FACTOR, ZOOM_OUT_FACTOR, MIN_STATE_ZOOM_LEVEL, MAX_STATE_ZOOM_LEVEL } from '../constants/numerical.js';
import {
    updateDomainPaletteCirclePanel,
    updateSurfacePaletteCirclePanel
} from '../rendering/draw-palette-preview.js';
import {
    ORBIT_COLORING_MODES,
    normalizeOrbitColoringMode
} from '../constants/rendering.js';
import { syncLaplacePlayPauseButton, updateCustomFormulaPreview, syncComplexParameterControls } from './ui-updates.js';
import { syncGridDensityControls } from './grid-density-controls.js';
import {
    bindGridShapePicker,
    initializeGridShapeControlsFromDOM,
    positionGridShapeControls,
    setGridShapeParameter
} from './grid-shape-controls.js';
import { GRID_SHAPE_PARAMETERS } from '../constants/grid-shapes.js';
import { stopLaplaceAnimation, toggleLaplaceAnimation, resetLaplaceAnimation, showFullLaplaceSpiral } from '../rendering/laplace-animation.js';
import { setNavigationModeEnabled, setNavigationKey, stopNavigationLoop, initializeNavigationStateFromControls } from '../navigation-plane.js';
import { toggleAnimation } from './animation.js';
import { initializePolynomialCoeffs } from './polynomial-ui.js';
import { resizeScalarSurface } from '../rendering/real-plots-renderer.js';
import { applyTheme, loadThemePreferences } from './theme-manager.js';
import { applyFractalPreset, isFractalPresetKey } from '../analysis/fractal-presets.js';
import { initPanelLayoutManager, refreshPanelEdgeHandles, refreshPanelLayout } from './panel-layout-manager.js';
import { resolveActiveMap } from '../math/active-map.js';
import { compileExpression } from '../math/expression/index.js';
import { nativeOptionsForActiveMap } from '../native/map-runtime.js';
import {
    disposeTransformationGraphRenderer,
    isFullGridPerspectiveSupported,
    isGraphViewSupported,
    resizeTransformationGraphRenderer,
    selectGraphInputFromCanvasPoint
} from '../rendering/transformation-graph.js';
import { disposeRealPlotsRenderer, disposeScalarSurface, validateRealPlotExpression } from '../rendering/real-plots-renderer.js';
import { appendAlgebraicTerm } from '../math/algebraic-term-utils.js';
import { openThemeModal } from '../frontend/theme-state.js';
import { resetAllPanelLayouts } from './panel-layout-manager.js';
import { isFoldableInputShape } from '../rendering/shape-generators.js';
import {
    continuationNativeSheet,
    evaluateNativeSheets,
    findNativePreimages,
    nativeMapOptions
} from '../native/complex-engine.js';
import { getDefaultInputShapeForManifold } from '../rendering/manifold-registry.js';
import { getRiemannSurfaceCanvas, resetRiemannSurfaceViews } from '../rendering/webgl-riemann-surface.js';
import { findNearestDynamicSample, formatDynamicSampleTooltip } from '../rendering/draw-dynamic-plotting.js';
import { drawFourier3DPipeline } from '../rendering/fourier-3d-pipeline.js';
import { showDynamicTooltip, hideDynamicTooltip } from './tooltip.js';

const { controls = {} } = context;

let zCanvas;
let wCanvas;
let uiEventListenersBound = false;
let transformViewportSnapshot = null;
let algebraicChainingSourceFunction = null;
let nonFractalSavedState = null;
const fractalSavedStates = {};
let lastActiveFractalKey = 'mandelbrot';

const FRACTAL_RESTORE_KEYS = [
    'currentFunction', 'currentFunctionPreset', 'algebraicChainingEnabled', 'chainingEnabled',
    'chainingMode', 'chainSeed', 'chainCount', 'orbitColoringMode', 'domainColoringEnabled',
    'domainColoringKeyVisible', 'currentInputShape', 'domainPalette', 'polynomialN', 'polynomialCoeffs',
    'algebraicChainingTerms', 'algebraicChainingZExpr',
    'realPlotsEnabled', 'realPlotsInputExpr', 'realPlotsImagExpr', 'realPlotsOutputComponent',
    'realPlotsHeightScale', 'realPlotsBrightness', 'realPlotsContrast', 'realPlotsSaturation',
    'realPlotsColorMode'
];

const PASSIVE_LISTENER_OPTIONS = Object.freeze({ passive: true });
const PASSIVE_CAPTURE_LISTENER_OPTIONS = Object.freeze({ passive: true, capture: true });
const ACTIVE_LISTENER_OPTIONS = Object.freeze({ passive: false });
const DEFAULT_FRAME_DELAY = 0;

let palettePanelFrameId = 0;
let pendingPalettePanelRefresh = false;

const canvasInteractionContexts = { z: null, w: null };
const canvasContextByElement = new WeakMap();
const fullscreenOrigins = new WeakMap();
const EMPTY_RECT = Object.freeze({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });

function createPointerSnapshot() {
    return {
        clientX: 0,
        clientY: 0,
        button: 0,
        buttons: 0,
        deltaY: 0,
        hasData: false
    };
}

function createCanvasInteractionContext(planeType) {
    const ctx = canvasContext(planeType);
    ctx.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    ctx.pos = { x: 0, y: 0 };
    ctx.pendingMove = createPointerSnapshot();
    ctx.pendingWheel = createPointerSnapshot();
    ctx.clickStart = { x: 0, y: 0 };
    ctx.hasDragged = false;
    ctx.hasFreshRect = false;

    if (ctx.canvas) canvasContextByElement.set(ctx.canvas, ctx);
    return ctx;
}

const COMPLEX_PARTS = ['re', 'im'];
const MOBIUS_PARAMS = ['A', 'B', 'C', 'D'];

const DOMAIN_DIRTY_STATE_KEYS = new Set([
    'a0', 'b0', 'circleR',
    'mediaSize', 'mediaOpacity', 'mediaAspectRatio', 'mediaVersion', 'vectorFieldScale',
    'zPlaneZoom', 'wPlaneZoom', 'fractionalPowerN', 'manifoldSurfaceOpacity', 'manifoldGridOpacity'
]);

const SIMPLE_SLIDER_BINDINGS = [
    ['gridDensitySlider', 'gridDensity', parseInteger],
    ['riemannSurfaceResolutionSlider', 'riemannSurfaceResolution', parseInteger],
    ['neighborhoodSizeSlider', 'probeNeighborhoodSize'],
    ['manifoldSurfaceOpacitySlider', 'manifoldSurfaceOpacity'],
    ['manifoldGridOpacitySlider', 'manifoldGridOpacity'],
    ['riemannSurfaceSheetsSlider', 'riemannSurfaceSheets', parseInteger],
    ['riemannSurfaceBranchCenterSlider', 'riemannSurfaceBranchCenter', parseInteger],
    ['riemannSurfaceHeightScaleSlider', 'riemannSurfaceHeightScale'],
    ['gridSurface3DHeightScaleSlider', 'foldSurfaceHeightScale'],
    ['riemannSurfaceHeightClipSlider', 'riemannSurfaceHeightClip']
].map(([controlKey, stateKey, parser = parseFloat]) => ({ controlKey, stateKey, parser }));

const SIMPLE_CHECKBOX_BINDINGS = [
    ['riemannSurfaceWireframeCb', 'riemannSurfaceWireframe'],
    ['arbitraryShapeClosedCb', 'arbitraryShapeClosed']
].map(([controlKey, stateKey]) => ({ controlKey, stateKey }));

const SIMPLE_SELECTOR_BINDINGS = [
    ['laplaceComComponentSelector', 'laplaceComComponent'],
    ['riemannSurfaceComponentSelector', 'riemannSurfaceComponent']
].map(([controlKey, stateKey]) => ({ controlKey, stateKey }));

const BINDERS = [
    bindBaseParameterControls,
    bindAlgebraicChainingControls,
    bindMobiusControls,
    bindFunctionButtons,
    bindImageControls,
    bindVideoControls,
    bindPolynomialControls,
    bindDomainColoringControls,
    bindViewControls,
    bindNavigationControls,
    bindVectorFieldControls,
    bindTaylorControls,
    bindRadialAndZetaControls,
    bindGridShapeControls,
    bindGridShapePicker,
    bindParticleControls,
    bindLaplaceControls,
    bindChainingControls,
    bindSimpleControlRemainder,
    bindCanvasInteractions,
    bindCanvasRectInvalidation,
    bindTopControlsToggle,
    bindFullscreenControls,
    bindThemeControls,
    bindDomainPaletteCirclePanelListeners,
    bindSurfacePaletteCirclePanelListeners,
    bindGraphControls,
    bindRealPlotsControls,
    bindContourControls,
    bindRequestedExplorerControls,
    initPanelLayoutManager
];

function bindRequestedExplorerControls() {
    const setArbitraryShapeMode = mode => {
        state.arbitraryShapeMode = mode === 'draw' ? 'draw' : 'parametric';
        requestUiRedraw();
    };
    bindControlListener('arbitraryShapeParametricModeBtn', 'click', () => setArbitraryShapeMode('parametric'));
    bindControlListener('arbitraryShapeDrawModeBtn', 'click', () => setArbitraryShapeMode('draw'));
    const bindNumber = (key, stateKey) => bindControlListener(key, 'input', (_event, input) => {
        const value = Number(input.value);
        if (Number.isFinite(value)) state[stateKey] = value;
        requestUiRedraw();
    });
    bindNumber('arbitraryShapeTMinInput', 'arbitraryShapeTMin');
    bindNumber('arbitraryShapeTMaxInput', 'arbitraryShapeTMax');
    bindControlListener('arbitraryShapeExpressionInput', 'input', (_event, input) => {
        state.arbitraryShapeExpression = input.value;
        updateCustomFormulaPreview(input, controls.arbitraryShapeExpressionMath, { allowedVariables: ['t'] });
        requestUiRedraw();
    });
    updateCustomFormulaPreview(controls.arbitraryShapeExpressionInput, controls.arbitraryShapeExpressionMath, {
        allowedVariables: ['t']
    });
    bindControlListener('clearArbitraryShapeBtn', 'click', () => {
        state.arbitraryShapePoints = [];
        requestUiRedraw();
    });
    bindControlListener('branchCutTypeSelector', 'change', (_event, selector) => {
        state.branchCutType = selector.value;
        state.branchDrawMode = null;
        resetContinuationForCutChange();
        requestUiRedraw();
    });
    bindControlListener('branchCutAngleSlider', 'input', (_event, slider) => {
        state.branchCutAngle = Number(slider.value);
        resetContinuationForCutChange();
        requestUiRedraw();
    });
    bindControlListener('drawBranchCutBtn', 'click', () => {
        state.branchCutType = 'draw';
        state.branchDrawMode = 'cut';
        resetContinuationForCutChange();
        if (controls.branchCutTypeSelector) controls.branchCutTypeSelector.value = 'draw';
        requestUiRedraw();
    });
    bindControlListener('drawContinuationPathBtn', 'click', () => {
        state.branchDrawMode = 'path';
        requestUiRedraw();
    });
    bindControlListener('clearContinuationPathBtn', 'click', () => {
        state.branchDrawMode = null;
        state.continuationPath = [];
        state.continuationValues = [];
        state.continuationSheet = 0;
        state.continuationValue = null;
        state.riemannSurfaceBranchCenter = 0;
        requestUiRedraw();
    });
}

function resetContinuationForCutChange() {
    state.continuationPath = [];
    state.continuationValues = [];
    state.continuationSheet = 0;
    state.continuationValue = null;
    state.riemannSurfaceBranchCenter = 0;
}

function parseInteger(value) {
    return parseInt(value, 10);
}

function $(id) {
    return document.getElementById(id);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function frame(callback) {
    return requestAnimationFrame(callback);
}

function laterFrame(callback, delay = DEFAULT_FRAME_DELAY) {
    frame(() => setTimeout(callback, delay));
}

function setStyles(element, styles) {
    if (element) Object.assign(element.style, styles);
}

function clearStyles(element, keys) {
    if (!element) return;
    keys.forEach(key => {
        element.style[key] = '';
    });
}

function hidden(element, shouldHide) {
    if (element) element.classList.toggle('hidden', Boolean(shouldHide));
}

function display(element, visible) {
    hidden(element, !visible);
}

function checked(controlKey, value) {
    if (controls[controlKey]) controls[controlKey].checked = Boolean(value);
}

function setOrbitColoringMode(mode) {
    state.orbitColoringMode = normalizeOrbitColoringMode(mode);
}

function resetOrbitColoringMode() {
    setOrbitColoringMode(ORBIT_COLORING_MODES.value);
}

function parseControlValue(control, parser = parseFloat) {
    if (!control) throw new Error('Cannot read a missing UI control.');
    return requireFiniteNumber(parser(control.value), `Control ${control.id || '(unnamed)'}`);
}

function bindElementListener(element, eventName, handler, options) {
    if (!element) return;

    element.addEventListener(eventName, event => handler(event, element), options);
}

function bindControlListener(controlKey, eventName, handler, options) {
    bindElementListener(controls[controlKey], eventName, handler, options);
}

function readSliderState(controlKey, stateKey, parser = parseFloat) {
    const control = controls[controlKey];
    if (control) state[stateKey] = parseControlValue(control, parser);
    return state[stateKey];
}

function readCheckboxState(controlKey, stateKey) {
    const control = controls[controlKey];
    if (control) state[stateKey] = control.checked;
    return state[stateKey];
}

function readSelectorState(controlKey, stateKey) {
    const control = controls[controlKey];
    if (control) state[stateKey] = control.value;
    return state[stateKey];
}

function shouldMarkDomainDirty(controlKey, stateKey) {
    return DOMAIN_DIRTY_STATE_KEYS.has(stateKey) ||
        controlKey.startsWith('mobius') ||
        controlKey.startsWith('domain');
}

function bindSlider(controlKey, stateKey, parser = parseFloat, customCallback = null) {
    bindControlListener(controlKey, 'input', (event, slider) => {
        state[stateKey] = parseControlValue(slider, parser);

        if (customCallback) {
            customCallback(state[stateKey], slider, event);
            return;
        }

        requestDomainRedraw(shouldMarkDomainDirty(controlKey, stateKey));
    });
}

function bindCheckbox(controlKey, stateKey, customCallback = null) {
    bindControlListener(controlKey, 'change', (event, checkbox) => {
        state[stateKey] = checkbox.checked;

        if (customCallback) {
            customCallback(event, checkbox.checked, checkbox);
            return;
        }

        requestUiRedraw();
    });
}

function bindSelector(controlKey, stateKey, customCallback = null) {
    bindControlListener(controlKey, 'change', (event, selector) => {
        state[stateKey] = selector.value;

        if (customCallback) {
            customCallback(event, selector.value, selector);
            return;
        }

        requestDomainRedraw(true);
    });
}

function bindSimpleControlRemainder() {
    SIMPLE_SLIDER_BINDINGS.forEach(({ controlKey, stateKey, parser }) => bindSlider(controlKey, stateKey, parser));
    SIMPLE_CHECKBOX_BINDINGS.forEach(({ controlKey, stateKey }) => bindCheckbox(controlKey, stateKey));
    SIMPLE_SELECTOR_BINDINGS.forEach(({ controlKey, stateKey }) => bindSelector(controlKey, stateKey));
}

function isDomainPalettePanelOpen() {
    const panel = $('domain_palette_circle_panel');
    return Boolean(panel && !panel.classList.contains('hidden'));
}

function flushPalettePanelRefresh() {
    palettePanelFrameId = 0;
    if (!pendingPalettePanelRefresh) return;

    pendingPalettePanelRefresh = false;
    updateDomainPaletteCirclePanel();
}

function scheduleRedraw(markDomainDirty = false, refreshPalettePanel = false) {
    if (markDomainDirty) requestScheduledDomainRedraw();
    else requestScheduledUiRedraw();

    if (refreshPalettePanel) {
        pendingPalettePanelRefresh = true;
        if (!palettePanelFrameId) palettePanelFrameId = frame(flushPalettePanelRefresh);
    }
}

function requestUiRedraw() {
    scheduleRedraw(false, false);
}

function requestDomainRedraw(markDomainDirty = false) {
    scheduleRedraw(markDomainDirty, isDomainPalettePanelOpen());
}

function requestAlgebraicRedraw() {
    requestDomainRedraw(true);
}

function updateCategoryNavState(activeCategory) {
    const complexBtn = document.getElementById('toggle_complex_functions_btn');
    const customBtn = document.getElementById('select_custom_complex_btn');
    const fractalsBtn = document.getElementById('toggle_fractals_btn');
    const realPlotsBtn = document.getElementById('select_real_plots_btn');
    const laplaceBtn = document.getElementById('select_laplace_btn');

    if (complexBtn) complexBtn.classList.toggle('active', activeCategory === 'complex_functions');
    if (customBtn) customBtn.classList.toggle('active', activeCategory === 'custom_complex');
    if (fractalsBtn) fractalsBtn.classList.toggle('active', activeCategory === 'fractals');
    if (realPlotsBtn) realPlotsBtn.classList.toggle('active', activeCategory === 'real_plots');
    if (laplaceBtn) laplaceBtn.classList.toggle('active', activeCategory === 'laplace');

    const complexGrid = document.getElementById('complex_functions_grid_container');
    const fractalsGrid = document.getElementById('fractals_grid_container');
    if (complexGrid) complexGrid.classList.toggle('hidden', activeCategory !== 'complex_functions');
    if (fractalsGrid) fractalsGrid.classList.toggle('hidden', activeCategory !== 'fractals');
}

function setActiveFunctionButton(activeKey) {
    Object.entries(controls.funcButtons || {}).forEach(([key, button]) => {
        if (!button) return;
        const active = key === activeKey;
        button.classList.toggle('active', active);
        button.classList.toggle('btn-primary', active);
        button.classList.toggle('btn-outline-secondary', !active);
    });

    if (activeKey === 'laplace') {
        updateCategoryNavState('laplace');
    } else if (isFractalPresetKey(activeKey)) {
        updateCategoryNavState('fractals');
    } else if (state.realPlotsEnabled) {
        updateCategoryNavState('real_plots');
    } else if (activeKey === 'custom_complex' || state.algebraicChainingEnabled) {
        updateCategoryNavState('custom_complex');
    } else {
        updateCategoryNavState('complex_functions');
    }
}

function updateModePanels() {
    refreshPanelEdgeHandles(true);
}

function disableAlgebraicChaining() {
    if (!state.algebraicChainingEnabled) {
        algebraicChainingSourceFunction = null;
        return;
    }

    state.algebraicChainingEnabled = false;
    algebraicChainingSourceFunction = null;
}

function disableOutputChaining() {
    if (!state.chainingEnabled) return;

    state.chainingEnabled = false;
    updateChainingColumns(1);
}

function restoreNormalPlaneLayout() {
    hidden(controls.zPlaneColumn, false);
    hidden(controls.wPlaneColumn, false);
}

function refreshPlanesAfterLayoutChange() {
    frame(() => {
        setupVisualParameters(false, false);
        requestUiRedraw();
    });
}

function disableRealPlots() {
    hidden(controls.realPlotsControlsContainer, true);
    if (!state.realPlotsEnabled) return;
    state.realPlotsEnabled = false;
    if (!state.riemannSurfaceEnabled) {
        state.show2DContourPlot = false;
    }
    disposeRealPlotsRenderer();
    restoreNormalPlaneLayout();
    refreshPlanesAfterLayoutChange();
}

function disableLaplaceMode() {
    if (!state.laplaceModeEnabled) return;
    stopLaplaceAnimation();
    disposeScalarSurface('laplace_3d_container');
    state.laplaceModeEnabled = false;
    restoreNormalViewports();
}

function disableGraphView() {
    state.graphViewEnabled = false;
    state.graphFullGridEnabled = false;
    state.graphLayerLockEnabled = false;
    state.graphFourierEnabled = false;
    state.graphTraceEnabled = false;
    state.graphSelectedShape = '';
    if (state.isGraphFullScreen && controls.toggleFullscreenGraphBtn) {
        controls.toggleFullscreenGraphBtn.click();
    }

    hidden(controls.graphColumn, true);
    disposeTransformationGraphRenderer();
    refreshPlanesAfterLayoutChange();
    updateModePanels();
}

function syncChainingControlsFromState() {
    if (state.chainingMode !== 'zero_seed') state.chainingMode = 'recursion';
    updateChainingColumns(state.chainingEnabled ? state.chainCount : 1);
}

function syncAlgebraicControlsFromState() {
    if (controls.algebraicChainingZInput) {
        controls.algebraicChainingZInput.value = state.algebraicChainingZExpr || 'z';
        updateCustomFormulaPreview(
            controls.algebraicChainingZInput,
            controls.algebraicChainingZMath,
            { allowedVariables: ['z'] }
        );
    }
}

function captureStateSnapshot() {
    return Object.fromEntries(FRACTAL_RESTORE_KEYS.map(key => [key, clonePlain(state[key])]));
}

function restoreStateSnapshot(snapshot, nextFunction = null) {
    if (!snapshot) return false;
    FRACTAL_RESTORE_KEYS.forEach(key => {
        if (snapshot[key] !== undefined) {
            state[key] = clonePlain(snapshot[key]);
        }
    });
    if (nextFunction) {
        state.currentFunction = nextFunction;
        state.currentFunctionPreset = null;
    }
    syncChainingControlsFromState();
    syncAlgebraicControlsFromState();
    return true;
}

function saveCurrentFractalState() {
    const activeKey = isFractalPresetKey(state.currentFunctionPreset)
        ? state.currentFunctionPreset
        : (isFractalPresetKey(state.currentFunction) ? state.currentFunction : lastActiveFractalKey);
    if (isFractalPresetKey(activeKey)) {
        fractalSavedStates[activeKey] = captureStateSnapshot();
        lastActiveFractalKey = activeKey;
    }
}

function restoreNonFractalState(nextFunction = null) {
    if (!nonFractalSavedState && !isFractalPresetKey(state.currentFunction) && !isFractalPresetKey(state.currentFunctionPreset)) {
        return false;
    }
    saveCurrentFractalState();
    const snapshot = nonFractalSavedState;
    nonFractalSavedState = null;
    if (snapshot) {
        restoreStateSnapshot(snapshot, nextFunction);
        return true;
    }
    return false;
}

function activateFractalPreset(key) {
    const leavingTransform = state.laplaceModeEnabled;
    if (state.laplaceModeEnabled) stopLaplaceAnimation();

    if (!isFractalPresetKey(state.currentFunctionPreset) && !isFractalPresetKey(state.currentFunction)) {
        if (!nonFractalSavedState) nonFractalSavedState = captureStateSnapshot();
    } else {
        saveCurrentFractalState();
    }

    lastActiveFractalKey = key;

    if (fractalSavedStates[key]) {
        restoreStateSnapshot(fractalSavedStates[key]);
        state.currentFunction = 'algebraic_chaining';
        state.currentFunctionPreset = key;
        state.algebraicChainingEnabled = true;
        state.chainingEnabled = true;
    } else {
        const preset = applyFractalPreset(state, key);
        if (!preset) return false;
    }

    if (leavingTransform) restoreNormalViewports();
    syncChainingControlsFromState();
    syncAlgebraicControlsFromState();
    display(controls.algebraicChainingControlsContainer, true);
    updateModePanels();
    setActiveFunctionButton(key);
    requestDomainRedraw(true);
    return true;
}


function copyRange(range) {
    return Array.isArray(range) ? [...range] : null;
}

function snapshotNormalViewports() {
    if (transformViewportSnapshot) return;

    transformViewportSnapshot = {
        z: {
            xRange: copyRange(zPlaneParams.currentVisXRange),
            yRange: copyRange(zPlaneParams.currentVisYRange)
        },
        w: {
            xRange: copyRange(wPlaneParams.currentVisXRange),
            yRange: copyRange(wPlaneParams.currentVisYRange)
        },
        zZoom: state.zPlaneZoom,
        wZoom: state.wPlaneZoom
    };
}

function restoreNormalViewports() {
    const snapshot = transformViewportSnapshot;
    transformViewportSnapshot = null;
    if (!snapshot) return;

    if (snapshot.z.xRange && snapshot.z.yRange) {
        zPlaneParams.currentVisXRange.splice(0, 2, ...snapshot.z.xRange);
        zPlaneParams.currentVisYRange.splice(0, 2, ...snapshot.z.yRange);
    }
    if (snapshot.w.xRange && snapshot.w.yRange) {
        wPlaneParams.currentVisXRange.splice(0, 2, ...snapshot.w.xRange);
        wPlaneParams.currentVisYRange.splice(0, 2, ...snapshot.w.yRange);
    }

    state.zPlaneZoom = snapshot.zZoom;
    state.wPlaneZoom = snapshot.wZoom;
}

function fitTransformViewports() {
    const signal = state.laplaceTimeDomainSignal;
    if (!signal?.length) return;

    setupVisualParameters(false, false);
    const timeWindow = Math.max(1, signal.at(-1)?.t || state.laplaceTimeWindow || 5);
    const amplitude = Math.max(1, ...signal.map(point => Math.abs(point.value)));
    const timePadding = Math.max(0.25, timeWindow * 0.06);
    const amplitudePadding = Math.max(0.35, amplitude * 0.24);

    setPlaneViewport(
        zPlaneParams,
        [-timePadding, timeWindow + timePadding],
        [-amplitude - amplitudePadding, amplitude + amplitudePadding]
    );

    let windingRadius = amplitude * 1.35;
    const dt = signal.length > 1 ? signal[1].t - signal[0].t : 0.01;
    let sumRe = 0;
    let sumIm = 0;
    signal.forEach(point => {
        const weight = Math.exp(-(state.laplaceSigma || 0) * point.t);
        const angle = -(state.laplaceOmega || 1) * point.t;
        const re = point.value * weight * Math.cos(angle);
        const im = point.value * weight * Math.sin(angle);
        sumRe += re * dt;
        sumIm += im * dt;
        windingRadius = Math.max(windingRadius, Math.hypot(re, im), Math.hypot(sumRe, sumIm));
    });
    windingRadius = Math.max(1, windingRadius * 1.35);
    setPlaneViewport(wPlaneParams, [-windingRadius, windingRadius], [-windingRadius, windingRadius]);

    state.zPlaneZoom = 1;
    state.wPlaneZoom = 1;
}

function activateFunctionMode(key) {
    disableRealPlots();
    if (isFractalPresetKey(key) && activateFractalPreset(key)) return;

    const restoringFractalState = Boolean(nonFractalSavedState || isFractalPresetKey(state.currentFunction) || isFractalPresetKey(state.currentFunctionPreset));
    if (restoringFractalState) {
        restoreNonFractalState(key);
    }

    const enteringLaplace = key === 'laplace';
    const enteringTransform = enteringLaplace;
    const leavingTransform = state.laplaceModeEnabled && !enteringTransform;

    if (state.laplaceModeEnabled && !enteringLaplace) {
        stopLaplaceAnimation();
        disposeScalarSurface('laplace_3d_container');
    }
    if (enteringTransform && isMediaInputShape() && runtime.media.video) pauseUploadedVideoPlayback();

    if (enteringTransform) snapshotNormalViewports();

    if (enteringTransform) {
        disableGraphView();
        disableRealPlots();
        disableRiemannSurface();
    }

    if (!restoringFractalState) {
        disableAlgebraicChaining();
        disableOutputChaining();
    }

    state.currentFunction = key;
    state.currentFunctionPreset = null;
    if (!restoringFractalState) resetOrbitColoringMode();
    state.laplaceModeEnabled = enteringLaplace;

    if (enteringTransform && state.navigationModeEnabled) setNavigationModeEnabled(false);

    if (enteringLaplace) {
        updateLaplaceTransform();
        showFullLaplaceSpiral();
    }

    if (enteringTransform) fitTransformViewports();
    else if (leavingTransform) restoreNormalViewports();

    updateModePanels();
    setActiveFunctionButton(key);
    requestDomainRedraw(true);
}

function complexState(key) {
    return requireFiniteComplex(state[key], `State ${key}`);
}

function initializeMobiusState() {
    MOBIUS_PARAMS.forEach(param => {
        const stateKey = `mobius${param}`;
        const value = { ...complexState(stateKey) };
        COMPLEX_PARTS.forEach(part => {
            const slider = controls[`mobius${param}${part === 're' ? 'Re' : 'Im'}Slider`];
            if (slider) value[part] = parseControlValue(slider, parseFloat);
        });
        state[stateKey] = value;
    });
}

function initializeScalarBindings() {
    sliderParamKeys.forEach(key => readSliderState(`${key}Slider`, key));
    SIMPLE_SLIDER_BINDINGS.forEach(({ controlKey, stateKey, parser }) => readSliderState(controlKey, stateKey, parser));
    SIMPLE_CHECKBOX_BINDINGS.forEach(({ controlKey, stateKey }) => readCheckboxState(controlKey, stateKey));
    SIMPLE_SELECTOR_BINDINGS.forEach(({ controlKey, stateKey }) => readSelectorState(controlKey, stateKey));
    initializeGridShapeControlsFromDOM();
    initializeMobiusState();
    initializeNavigationStateFromControls();
}

export function initializeStateFromControls() {
    initializeScalarBindings();
    syncGridDensityControls();
    updateModePanels();
    setActiveFunctionButton(state.currentFunction);
    syncVideoPlaybackUI();
}

function bindAnimatedSlider(slider, updateState, playButton, speedSelector) {
    if (!slider || !playButton || !speedSelector) return;
    bindElementListener(playButton, 'click', () => toggleAnimation(slider, updateState, playButton, speedSelector));
}

function bindBaseParameterControls() {
    sliderParamKeys.forEach(key => {
        bindSlider(`${key}Slider`, key);
        bindAnimatedSlider(
            controls[`${key}Slider`],
            value => {
                state[key] = value;
            },
            controls[`play${key[0].toUpperCase()}${key.slice(1)}Btn`],
            controls[`speed${key[0].toUpperCase()}${key.slice(1)}Selector`]
        );
    });
}

function bindGridShapeControls() {
    Object.entries(GRID_SHAPE_PARAMETERS).forEach(([shape, definition]) => {
        definition.controls.forEach(controlDefinition => {
            bindElementListener($(controlDefinition.controlId), 'input', (_event, slider) => {
                setGridShapeParameter(
                    shape,
                    controlDefinition.key,
                    parseControlValue(slider, parseFloat)
                );
                requestDomainRedraw(true);
            });
        });
    });
}

function bindMobiusControls() {
    MOBIUS_PARAMS.forEach(param => COMPLEX_PARTS.forEach(part => {
        const stateKey = `mobius${param}`;
        const partKey = part === 're' ? 'Re' : 'Im';
        const sliderKey = `mobius${param}${partKey}Slider`;

        bindControlListener(sliderKey, 'input', (_event, slider) => {
            state[stateKey] = {
                ...complexState(stateKey),
                [part]: parseControlValue(slider, parseFloat)
            };
            requestDomainRedraw(true);
        });

        bindAnimatedSlider(
            controls[sliderKey],
            value => {
                state[stateKey] = { ...complexState(stateKey), [part]: value };
            },
            controls[`playMobius${param}${partKey}Btn`],
            controls[`speedMobius${param}${partKey}Selector`]
        );
    }));
}

function bindFunctionButtons() {
    // 1. Category Nav: Complex Functions
    bindControlListener('toggleComplexFunctionsBtn', 'click', () => {
        if (state.realPlotsEnabled) {
            disableRealPlots();
        }
        disableLaplaceMode();
        if (nonFractalSavedState || isFractalPresetKey(state.currentFunction) || isFractalPresetKey(state.currentFunctionPreset)) {
            restoreNonFractalState();
        }
        if (state.algebraicChainingEnabled) {
            disableAlgebraicChaining();
        }
        const funcToRestore = (!isFractalPresetKey(state.currentFunction) && state.currentFunction !== 'laplace' && state.currentFunction !== 'algebraic_chaining' && state.currentFunction)
            ? state.currentFunction
            : 'cos';
        activateFunctionMode(funcToRestore);
        updateCategoryNavState('complex_functions');
    });

    // 2. Category Nav: Custom Complex Function (Algebraic Chaining)
    bindControlListener('selectCustomComplexBtn', 'click', () => {
        if (state.realPlotsEnabled) {
            disableRealPlots();
        }
        disableLaplaceMode();
        if (nonFractalSavedState || isFractalPresetKey(state.currentFunction) || isFractalPresetKey(state.currentFunctionPreset)) {
            restoreNonFractalState();
        }

        const currentFunction = state.currentFunction === 'algebraic_chaining'
            ? (algebraicChainingSourceFunction || state.algebraicChainingTerms?.[0]?.factors?.[0]?.func || 'cos')
            : state.currentFunction;

        if (currentFunction !== 'algebraic_chaining' && (!state.algebraicChainingTerms || state.algebraicChainingTerms.length === 0)) {
            algebraicChainingSourceFunction = currentFunction;
            mutateState('algebraicChainingTerms', terms => {
                const firstFactor = terms?.[0]?.factors?.[0];
                if (firstFactor) {
                    firstFactor.func = currentFunction;
                    firstFactor.chainedFunc = 'none';
                }
            }, 'algebraicChainingTerms.factor.func');
        }

        state.algebraicChainingEnabled = true;
        state.currentFunction = 'algebraic_chaining';
        state.currentFunctionPreset = null;
        checked('enableAlgebraicChainingCb', true);

        setActiveFunctionButton('custom_complex');
        display(controls.algebraicChainingControlsContainer, true);
        hidden(controls.algebraicChainingParams, false);
        hidden(controls.realPlotsControlsContainer, true);
        hidden(controls.laplaceSpecificControls, true);
        updateModePanels();
        syncComplexParameterControls();
        requestAlgebraicRedraw();
    });

    // 3. Category Nav: Fractals
    bindControlListener('toggleFractalsBtn', 'click', () => {
        if (state.realPlotsEnabled) {
            disableRealPlots();
        }
        disableLaplaceMode();
        if (state.algebraicChainingEnabled && !isFractalPresetKey(state.currentFunctionPreset)) {
            disableAlgebraicChaining();
        }
        const fractalKey = isFractalPresetKey(state.currentFunctionPreset)
            ? state.currentFunctionPreset
            : (isFractalPresetKey(state.currentFunction) ? state.currentFunction : lastActiveFractalKey || 'mandelbrot');
        activateFunctionMode(fractalKey);
        updateCategoryNavState('fractals');
    });

    // 4. Category Nav: Real Plots button
    bindControlListener('selectRealPlotsBtn', 'click', () => {
        disableLaplaceMode();
        disableGraphView();
        disableRiemannSurface();

        if (nonFractalSavedState || isFractalPresetKey(state.currentFunction) || isFractalPresetKey(state.currentFunctionPreset)) {
            restoreNonFractalState();
        }

        state.realPlotsEnabled = true;
        state.show2DContourPlot = false;

        if (state.currentFunction === 'laplace' || isFractalPresetKey(state.currentFunction) || !state.currentFunction) {
            state.currentFunction = 'cos';
        }

        hidden(controls.realPlotsControlsContainer, false);
        hidden(controls.realPlotsColumn, false);
        hidden(controls.zPlaneColumn, true);
        hidden(controls.wPlaneColumn, true);
        hidden(controls.laplaceSpecificControls, true);
        hidden(controls.coreApplicationControls, true);

        updateCategoryNavState('real_plots');
        refreshPlanesAfterLayoutChange();
        requestUiRedraw();
    });

    // Standard function & fractal & laplace buttons
    Object.entries(controls.funcButtons || {}).forEach(([key, button]) => {
        if (key === 'custom_complex' || key === 'real_plots') return;
        bindElementListener(button, 'click', () => activateFunctionMode(key));
    });
}

function firstFile(event) {
    return event.target.files && event.target.files[0];
}

function bindImageControls() {
    bindControlListener('mediaUploadInput', 'change', event => {
        const file = firstFile(event);
        if (file) loadUploadedMediaFile(file);
    });

    bindSlider('mediaSizeSlider', 'mediaSize', parseFloat, () => requestDomainRedraw(true));
    bindSlider('mediaOpacitySlider', 'mediaOpacity', parseFloat, () => requestDomainRedraw(true));
}

function bindVideoControls() {
    bindControlListener('videoPlayPauseBtn', 'click', () => toggleUploadedVideoPlayback());

    bindSlider('videoFpsSlider', 'videoProcessingFps', parseInteger, () => {
        syncVideoPlaybackUI();
        if (state.videoIsPlaying && isMediaInputShape()) startVideoProcessingLoop();
        requestUiRedraw();
    });
}

function bindDomainColoringControls() {
    bindCheckbox('showDomainColoringKeyCb', 'domainColoringKeyVisible');
    bindElementListener(controls.orbitColoringModeSelect, 'change', event => {
        setOrbitColoringMode(event.target.value);
        state.currentFunctionPreset = null;
        requestDomainRedraw(true);
    });


    ['domainBrightness', 'domainContrast', 'domainSaturation', 'domainLightnessCycles']
        .forEach(key => bindSlider(`${key}Slider`, key, parseFloat, () => requestDomainRedraw(true)));
}

function disableRiemannSurface() {
    state.riemannSurfaceEnabled = false;
    hidden(controls.riemannSurfaceOptionsDiv, true);
    state.show2DContourPlot = false;
    hidden(controls.contour2DColumn, true);
}

function syncFoldSurfaceControls() {
    const isFoldActive = Boolean(
        state.foldSurface3dEnabled &&
        (isFoldableInputShape(state.currentInputShape) || isMediaInputShape())
    );
    hidden(controls.wPlaneFoldsOverlay, !isFoldActive);
}

function syncGridFoldDensity(useFoldDefault = false) {
    syncGridDensityControls({ applyFoldDefault: useFoldDefault });
}

function disableFoldSurface3d() {
    state.foldSurface3dEnabled = false;
    syncGridFoldDensity();
    syncFoldSurfaceControls();
}

function smoothZoomPlane(planeType, factor, steps = 10) {
    const isW = planeType === 'w';
    const isRealPlots = planeType === 'real_plots';
    const ctx = isW ? canvasInteractionContexts.w : canvasInteractionContexts.z;
    if (!ctx?.canvas || !ctx?.params) return;

    const pos = { x: ctx.canvas.width * 0.5, y: ctx.canvas.height * 0.5 };
    const stepFactor = Math.pow(factor, 1 / steps);
    let remaining = steps;

    function frame() {
        if (remaining-- <= 0) return;
        zoomPlaneAt(ctx, pos, stepFactor);
        if (isRealPlots) requestScheduledUiRedraw();
        if (remaining > 0) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

function bindCanvasZoomControls() {
    const ZOOM_FACTOR = 1.35;
    const bindBtn = (id, planeType, factor) => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                smoothZoomPlane(planeType, factor);
            });
        }
    };

    bindBtn('zoom_in_z_btn', 'z', ZOOM_FACTOR);
    bindBtn('zoom_out_z_btn', 'z', 1 / ZOOM_FACTOR);
    bindBtn('zoom_in_w_btn', 'w', ZOOM_FACTOR);
    bindBtn('zoom_out_w_btn', 'w', 1 / ZOOM_FACTOR);
    bindBtn('zoom_in_real_plots_btn', 'real_plots', ZOOM_FACTOR);
    bindBtn('zoom_out_real_plots_btn', 'real_plots', 1 / ZOOM_FACTOR);
}

function bindViewControls() {
    bindCanvasZoomControls();

    bindSelector('manifoldShapeSelector', 'selectedManifold', () => {
        if (!isMediaInputShape()) {
            const defaultShape = getDefaultInputShapeForManifold(state.selectedManifold);
            state.currentInputShape = defaultShape;
        }
        requestDomainRedraw(true);
    });

    const onTransformationToggled = () => {
        if (state.manifoldTransformationEnabled) {
            if (state.domainColoringEnabled) {
                state.domainColoringEnabled = false;
            }
            disableFoldSurface3d();
            if (!state.manifold3dViewEnabled) {
                state.manifold3dViewEnabled = true;
            }
            if (state.riemannSurfaceEnabled) {
                disableRiemannSurface();
            }
            state.manifoldTransformationProgressZ = 0.0;
            state.manifoldTransformationProgressW = 0.0;
            state.manifoldTransformationPlayingZ = true;
            state.manifoldTransformationPlayingW = true;
        } else {
            state.manifoldTransformationPlayingZ = false;
            state.manifoldTransformationPlayingW = false;
            state.manifoldTransformationProgressW = 1.0;
        }
        requestDomainRedraw(true);
    };
    bindCheckbox('enableManifoldTransformationCb', 'manifoldTransformationEnabled', onTransformationToggled);

    bindControlListener('riemannSurfaceResetViewBtn', 'click', () => resetRiemannSurfaceViews());
}

function bindNavigationControls() {
    bindElementListener(document, 'keydown', event => setNavigationKey(event, true));
    bindElementListener(document, 'keyup', event => setNavigationKey(event, false));
    bindElementListener(window, 'blur', () => {
        runtime.navigation.keys = {};
        stopNavigationLoop();
    });
}

function bindVectorFieldControls() {
    [
        ['vectorFieldScaleSlider', 'vectorFieldScale'],
        ['vectorArrowThicknessSlider', 'vectorArrowThickness'],
        ['vectorArrowHeadSizeSlider', 'vectorArrowHeadSize'],
        ['streamlineStepSizeSlider', 'streamlineStepSize'],
        ['streamlineMaxLengthSlider', 'streamlineMaxLength', parseInteger],
        ['streamlineThicknessSlider', 'streamlineThickness'],
        ['streamlineSeedDensityFactorSlider', 'streamlineSeedDensityFactor']
    ].forEach(([controlKey, stateKey, parser = parseFloat]) => bindSlider(controlKey, stateKey, parser));
}

function bindTaylorControls() {
    bindSlider('taylorSeriesOrderSlider', 'taylorSeriesOrder', parseInteger);

    const pickBtn = document.getElementById('pick_taylor_center_canvas_btn');
    if (pickBtn) {
        pickBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            state.taylorSeriesCanvasClickCenterEnabled = !state.taylorSeriesCanvasClickCenterEnabled;
            if (!state.taylorSeriesCanvasClickCenterEnabled) {
                state.taylorSeriesHoverPoint = null;
            } else {
                hidePlaneContextMenu();
            }
            requestUiRedraw();
        });
    }

    const taylorDiv = document.getElementById('taylor_series_options_detail_div');
    if (taylorDiv) {
        ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'wheel', 'click', 'input', 'change', 'touchstart', 'touchmove', 'touchend'].forEach(evt => {
            taylorDiv.addEventListener(evt, e => e.stopPropagation());
        });
    }
}

function bindPolynomialControls() {
    bindSlider('polynomialNSlider', 'polynomialN', parseInteger, value => {
        initializePolynomialCoeffs(value, true);
        requestDomainRedraw(true);
    });
}

function bindRadialAndZetaControls() {
    bindSlider('radialDiscreteStepsCountSlider', 'radialDiscreteStepsCount', parseInteger);
    bindControlListener('toggleZetaContinuationBtn', 'click', () => {
        state.zetaContinuationEnabled = !state.zetaContinuationEnabled;
        requestDomainRedraw(true);
    });
}

function bindParticleControls() {
    bindSlider('particleDensitySlider', 'particleDensity', parseInteger, () => {
        runtime.particles.length = 0;
        requestUiRedraw();
    });
    bindSlider('particleSpeedSlider', 'particleSpeed');
    bindSlider('particleMaxLifetimeSlider', 'particleMaxLifetime', parseInteger);
}

function bindLaplaceControls() {
    bindSelector('laplaceFunctionSelector', 'laplaceFunction', () => {
        updateLaplaceTransform();
        requestUiRedraw();
    });

    ['laplaceFrequency', 'laplaceDamping', 'laplaceAmplitude', 'laplaceTimeWindow', 'laplaceSamples'].forEach(key => bindSlider(
        `${key}Slider`,
        key,
        key === 'laplaceSamples' ? parseInteger : parseFloat,
        () => {
            if (state.laplaceModeEnabled) updateLaplaceTransform();
            requestUiRedraw();
        }
    ));

    ['laplaceSigmaSlider', 'laplaceOmegaSlider', 'laplaceWindingFrequencySlider'].forEach(controlKey => {
        const stateKey = controlKey === 'laplaceSigmaSlider' ? 'laplaceSigma' : 'laplaceOmega';
        bindSlider(controlKey, stateKey, parseFloat, () => {
            if (stateKey === 'laplaceOmega') {
                ['laplaceOmegaSlider', 'laplaceWindingFrequencySlider'].forEach(key => {
                    if (controls[key]) controls[key].value = String(state.laplaceOmega);
                });
            }
            if (state.laplaceModeEnabled) updateLaplaceEvaluationPoint();
            requestUiRedraw();
        });
    });

    bindControlListener('laplaceFourierSliceBtn', 'click', () => {
        state.laplaceSigma = 0;
        if (controls.laplaceSigmaSlider) controls.laplaceSigmaSlider.value = '0';
        if (state.laplaceModeEnabled) updateLaplaceEvaluationPoint();
        requestUiRedraw();
    });

    bindSelector('laplaceVizModeSelector', 'laplaceVizMode', () => {
        requestUiRedraw();
    });
    bindSlider('laplaceClipHeightSlider', 'laplaceClipHeight', parseFloat, () => {
        requestUiRedraw();
    });

    bindSlider('laplaceFourier3DCountSlider', 'fourier3DParallelGraphs', parseInteger, () => {
        requestUiRedraw();
    });

    [
        ['laplaceShowRocCb', 'laplaceShowROC'],
        ['laplaceShowPolesZerosCb', 'laplaceShowPolesZeros'],
        ['laplaceShowFourierLineCb', 'laplaceShowFourierLine'],
        ['laplaceHideIntegralEvaluationCb', 'laplaceHideIntegralEvaluation'],
        ['laplaceHide3DSurfaceCb', 'laplaceHide3DSurface'],
        ['laplaceShowSpectrumCb', 'laplaceShowSpectrum'],
        ['laplaceAnimationLoopCb', 'laplaceAnimationLoop']
    ].forEach(([controlKey, stateKey]) => bindCheckbox(controlKey, stateKey));

    bindSlider('laplaceAnimationSpeedSlider', 'laplaceAnimationSpeed', parseFloat, () => {
        if (controls.laplaceAnimationSpeedDisplay) {
            controls.laplaceAnimationSpeedDisplay.textContent = state.laplaceAnimationSpeed.toFixed(1);
        }
        syncLaplacePlayPauseButton();
    });
    bindSlider('laplaceAnimationTimeSlider', 'laplaceAnimationTime', parseFloat, () => {
        stopLaplaceAnimation();
        requestUiRedraw();
    });

    [
        ['laplacePlayPauseBtn', toggleLaplaceAnimation],
        ['laplaceResetBtn', resetLaplaceAnimation],
        ['laplaceShowFullBtn', showFullLaplaceSpiral]
    ].forEach(([controlKey, fn]) => bindControlListener(controlKey, 'click', () => {
        fn();
        frame(syncLaplacePlayPauseButton);
    }));

}

function canvasContext(planeType) {
    return planeType === 'z'
        ? { planeType, canvas: zCanvas, params: zPlaneParams, pan: runtime.interaction.panZ, isZ: true }
        : { planeType, canvas: wCanvas, params: wPlaneParams, pan: runtime.interaction.panW, isZ: false };
}

function refreshCanvasRect(ctx) {
    const rect = ctx.canvas && typeof ctx.canvas.getBoundingClientRect === 'function'
        ? ctx.canvas.getBoundingClientRect()
        : EMPTY_RECT;

    ctx.rect.left = rect.left || 0;
    ctx.rect.top = rect.top || 0;
    ctx.rect.right = rect.right || (ctx.rect.left + (rect.width || ctx.canvas?.width || 0));
    ctx.rect.bottom = rect.bottom || (ctx.rect.top + (rect.height || ctx.canvas?.height || 0));
    ctx.rect.width = rect.width || Math.max(0, ctx.rect.right - ctx.rect.left) || ctx.canvas?.width || 0;
    ctx.rect.height = rect.height || Math.max(0, ctx.rect.bottom - ctx.rect.top) || ctx.canvas?.height || 0;
    ctx.hasFreshRect = true;
    return ctx.rect;
}

function invalidateCanvasRect(ctx) {
    if (ctx) ctx.hasFreshRect = false;
}

export function invalidateAllCanvasRects() {
    Object.values(canvasInteractionContexts).forEach(invalidateCanvasRect);
}

function canvasRect(ctx) {
    return ctx.hasFreshRect ? ctx.rect : refreshCanvasRect(ctx);
}

function updatePointerSnapshot(snapshot, event) {
    snapshot.clientX = event.clientX || 0;
    snapshot.clientY = event.clientY || 0;
    snapshot.button = event.button || 0;
    snapshot.buttons = event.buttons || 0;
    snapshot.deltaY = event.deltaY || 0;
    snapshot.hasData = true;
}

function canvasPosition(ctx, pointer) {
    const rect = canvasRect(ctx);
    ctx.pos.x = pointer.clientX - rect.left;
    ctx.pos.y = pointer.clientY - rect.top;
    return ctx.pos;
}

function nearestPoint(points, world, tolerance) {
    return points.find(point =>
        Math.abs(point.re - world.re) < tolerance &&
        Math.abs(point.im - world.im) < tolerance
    );
}

function updateCanvasTooltip(ctx, event) {
    const world = mapCanvasToWorldCoords(ctx.pos.x, ctx.pos.y, ctx.params);
    const point = { re: world.x, im: world.y };
    const worldSpan = ctx.params.currentVisXRange[1] - ctx.params.currentVisXRange[0];
    const tolerance = worldSpan / ctx.params.width * 5;
    const sample = findNearestDynamicSample(point, ctx.planeType, {
        worldSpan,
        pixelWidth: ctx.params.width,
        tolerance: tolerance * 2
    });
    let content = sample ? formatDynamicSampleTooltip(sample) : null;

    if (!content && ctx.isZ && state.showZerosPoles) {
        const pole = nearestPoint(state.poles, point, tolerance);
        if (pole) {
            content = `<b>Singularity</b><br>z = ${pole.re.toFixed(3)} + ${pole.im.toFixed(3)}i<br>Type: ${pole.type}`;
            if (pole.type === 'pole' && pole.order) content += `<br>Order: ${pole.order}`;
            if (Number.isFinite(pole.residue?.re) && Number.isFinite(pole.residue?.im)) {
                content += `<br>Residue: ${pole.residue.re.toFixed(3)} + ${pole.residue.im.toFixed(3)}i`;
            }
        }
        const zero = !content && nearestPoint(state.zeros, point, tolerance);
        if (zero) content = `<b>Zero</b><br>z = ${zero.re.toFixed(3)} + ${zero.im.toFixed(3)}i`;
    }
    if (!content && ctx.isZ && state.showCriticalPoints) {
        const critical = nearestPoint(state.criticalPoints, point, tolerance);
        if (critical) content = `<b>Critical Point</b><br>z = ${critical.re.toFixed(3)} + ${critical.im.toFixed(3)}i`;
    }

    if (content) showDynamicTooltip(content, event.pageX, event.pageY);
    else hideDynamicTooltip();
}

function canvasPositionInsideCanvas(ctx, pos) {
    const width = ctx.canvas?.width ?? ctx.rect.width;
    const height = ctx.canvas?.height ?? ctx.rect.height;
    return pos.x >= 0 && pos.x <= width && pos.y >= 0 && pos.y <= height;
}

function panPlane(ctx, pos) {
    if (Math.hypot(pos.x - ctx.clickStart.x, pos.y - ctx.clickStart.y) > 3) {
        ctx.hasDragged = true;
    }
    const deltaX = pos.x - ctx.pan.panStart.x;
    const deltaY = pos.y - ctx.pan.panStart.y;
    ctx.params.origin.x = ctx.pan.panStartOrigin.x + deltaX;
    ctx.params.origin.y = ctx.pan.panStartOrigin.y + deltaY;
    updatePlaneViewportRanges(ctx.params);
    requestDomainRedraw(true);
}

function updateProbe(ctx, pos, active = true) {
    if (!ctx.isZ) return;
    if (state.chainingEnabled) {
        state.probeActive = false;
        return;
    }
    if (!active) {
        state.probeActive = false;
        return;
    }

    const world = mapCanvasToWorldCoords(pos.x, pos.y, ctx.params);
    const probe = state.probeZ || (state.probeZ = { re: 0, im: 0 });
    probe.re = world.x;
    probe.im = world.y;
    state.probeActive = true;
}

function startPan(ctx, pos) {
    ctx.pan.isPanning = true;
    ctx.pan.panStart.x = pos.x;
    ctx.pan.panStart.y = pos.y;
    ctx.clickStart.x = pos.x;
    ctx.clickStart.y = pos.y;
    ctx.hasDragged = false;
    ctx.pan.panStartOrigin.x = ctx.params.origin.x;
    ctx.pan.panStartOrigin.y = ctx.params.origin.y;
    ctx.precisePanStart = ctx.params.preciseViewport ? { ...ctx.params.preciseViewport } : null;
    ctx.canvas.style.cursor = 'grabbing';
    updateProbe(ctx, pos, false);
    requestUiRedraw();
}

function evaluateSheetPoint(functionKey, point, sheet) {
    const map = nativeMapOptions(state, {
        functionKey,
        chainingEnabled: state.chainingEnabled,
        chainCount: state.chainingEnabled ? state.chainCount : 1
    });
    const result = evaluateNativeSheets(map, [point], [sheet]);
    return result.valid[0] ? result.values[0] : { re: NaN, im: NaN };
}

function handleCanvasMoveNow(ctx, pointer) {
    const pos = canvasPosition(ctx, pointer);

    if (ctx.isZ && ctx.drawingBranch) {
        const world = mapCanvasToWorldCoords(pos.x, pos.y, ctx.params);
        const key = ctx.drawingBranch === 'cut' ? 'branchCutPoints' : 'continuationPath';
        const points = state[key];
        const last = points[points.length - 1];
        const sampleDistance = 2 / Math.max(Math.abs(ctx.params.scale.x), Math.abs(ctx.params.scale.y), 1);
        if (!last || Math.hypot(world.x - last.re, world.y - last.im) > sampleDistance) {
            const nextPoints = [...points, { re: world.x, im: world.y }];
            state[key] = nextPoints;
            ctx.hasDragged = true;
            if (key === 'continuationPath') {
                const delta = continuationNativeSheet(nextPoints.slice(-2), state.branchCutType, state.branchCutAngle, state.branchCutPoints);
                const sheet = state.continuationSheet + delta;
                const value = evaluateSheetPoint(state.currentFunction, nextPoints[nextPoints.length - 1], sheet);
                state.continuationSheet = sheet;
                state.continuationValue = value;
                state.continuationValues = [...state.continuationValues, value];
                state.riemannSurfaceBranchCenter = sheet;
            }
            requestUiRedraw();
        }
        return;
    }

    if (ctx.isZ && ctx.drawingArbitraryShape) {
        const world = mapCanvasToWorldCoords(pos.x, pos.y, ctx.params);
        const points = state.arbitraryShapePoints;
        const last = points[points.length - 1];
        const sampleDistance = 2 / Math.max(Math.abs(ctx.params.scale.x), Math.abs(ctx.params.scale.y), 1);
        if (!last || Math.hypot(world.x - last.re, world.y - last.im) > sampleDistance) {
            state.arbitraryShapePoints = [...points, { re: world.x, im: world.y }];
            ctx.hasDragged = true;
            requestUiRedraw();
        }
        return;
    }

    if (ctx.pan.isPanning) {
        panPlane(ctx, pos);
        return;
    }

    if (ctx.isZ && state.navigationModeEnabled) {
        state.probeActive = false;
        return;
    }

    if (ctx.isZ && !state.chainingEnabled && !runtime.interaction.panZ.isPanning && !runtime.interaction.panW.isPanning) {
        updateProbe(ctx, pos, true);
        requestUiRedraw();
    }

    if (state.taylorSeriesCanvasClickCenterEnabled) {
        const world = mapCanvasToWorldCoords(pos.x, pos.y, ctx.params);
        state.taylorSeriesHoverPoint = {
            canvasX: pos.x,
            canvasY: pos.y,
            world,
            isZ: ctx.isZ
        };
        requestUiRedraw();
    }
}

function flushCanvasMove(ctx) {
    if (!ctx.pendingMove.hasData) return;
    ctx.pendingMove.hasData = false;
    handleCanvasMoveNow(ctx, ctx.pendingMove);
}

function scheduleCanvasMove(ctx, event) {
    updatePointerSnapshot(ctx.pendingMove, event);
    flushCanvasMove(ctx);
}

function handleCanvasDown(ctx, event) {
    if (event.button !== 0) return;

    refreshCanvasRect(ctx);
    updatePointerSnapshot(ctx.pendingMove, event);

    if (state.taylorSeriesCanvasClickCenterEnabled) {
        const pos = canvasPosition(ctx, ctx.pendingMove);
        const world = mapCanvasToWorldCoords(pos.x, pos.y, ctx.params);
        state.taylorSeriesCustomCenter = { re: world.x, im: world.y };
        state.taylorSeriesCustomCenterEnabled = true;
        state.taylorSeriesEnabled = true;
        state.taylorSeriesHoverPoint = {
            canvasX: pos.x,
            canvasY: pos.y,
            world,
            isZ: ctx.isZ
        };
        ctx.hasDragged = false;
        requestDomainRedraw(true);
        requestUiRedraw();
        return;
    }
    if (ctx.isZ && state.branchDrawMode) {
        const mode = state.branchDrawMode;
        const pos = canvasPosition(ctx, ctx.pendingMove);
        const world = mapCanvasToWorldCoords(pos.x, pos.y, ctx.params);
        const key = mode === 'cut' ? 'branchCutPoints' : 'continuationPath';
        ctx.hasDragged = false;
        if (mode === 'cut') {
            state.branchCutType = 'draw';
            resetContinuationForCutChange();
        }
        state[key] = [{ re: world.x, im: world.y }];
        if (mode === 'path') {
            state.continuationSheet = 0;
            state.continuationValue = evaluateSheetPoint(state.currentFunction, state[key][0], 0);
            state.continuationValues = [state.continuationValue];
        }
        ctx.drawingBranch = mode;
        requestUiRedraw();
        return;
    }
    if (ctx.isZ && state.currentInputShape === 'arbitrary' && state.arbitraryShapeMode === 'draw') {
        const pos = canvasPosition(ctx, ctx.pendingMove);
        const world = mapCanvasToWorldCoords(pos.x, pos.y, ctx.params);
        ctx.hasDragged = false;
        const points = state.arbitraryShapePoints;
        state.arbitraryShapePoints = points.length
            ? [...points, null, { re: world.x, im: world.y }]
            : [{ re: world.x, im: world.y }];
        ctx.drawingArbitraryShape = true;
        ctx.canvas.style.cursor = 'crosshair';
        requestUiRedraw();
        return;
    }
    startPan(ctx, canvasPosition(ctx, ctx.pendingMove));
}

function finishCanvasStroke(ctx) {
    if (ctx.drawingBranch) {
        ctx.drawingBranch = null;
        state.branchDrawMode = null;
        ctx.hasDragged = true;
        ctx.canvas.style.cursor = 'crosshair';
        requestUiRedraw();
        return true;
    }
    if (ctx.drawingArbitraryShape) {
        ctx.drawingArbitraryShape = false;
        ctx.hasDragged = true;
        ctx.canvas.style.cursor = 'crosshair';
        requestUiRedraw();
        return true;
    }
    return false;
}

function handleCanvasUp(ctx, event) {
    if (finishCanvasStroke(ctx)) return;
    if (event.button !== 0 || !ctx.pan.isPanning) return;

    ctx.pan.isPanning = false;
    ctx.canvas.style.cursor = 'crosshair';
    ctx.pendingMove.hasData = false;

    if (!ctx.isZ) return;

    if (state.navigationModeEnabled) {
        updateProbe(ctx, null, false);
        requestUiRedraw();
        return;
    }

    refreshCanvasRect(ctx);
    updatePointerSnapshot(ctx.pendingMove, event);
    const pos = canvasPosition(ctx, ctx.pendingMove);
    updateProbe(ctx, pos, canvasPositionInsideCanvas(ctx, pos));
    requestDomainRedraw(true);
}

function handleCanvasLeave(ctx) {
    if (finishCanvasStroke(ctx)) return;

    ctx.pendingMove.hasData = false;
    invalidateCanvasRect(ctx);

    const domainDirty = ctx.pan.isPanning;
    if (domainDirty) {
        ctx.pan.isPanning = false;
        ctx.canvas.style.cursor = 'crosshair';
    }

    updateProbe(ctx, null, false);
    if (state.taylorSeriesCanvasClickCenterEnabled) {
        state.taylorSeriesHoverPoint = null;
    }
    if (domainDirty) requestDomainRedraw(true);
    else requestUiRedraw();
}

function zoomPlaneAt(ctx, pos, factor) {
    const zoomKey = ctx.isZ ? 'zPlaneZoom' : 'wPlaneZoom';
    const oldZoom = requireFiniteNumber(state[zoomKey], `${ctx.planeType}-plane zoom`);
    if (oldZoom < MIN_STATE_ZOOM_LEVEL || oldZoom > MAX_STATE_ZOOM_LEVEL) {
        throw new Error(`${ctx.planeType}-plane zoom is outside the supported range.`);
    }
    const nextZoom = clamp(oldZoom * factor, MIN_STATE_ZOOM_LEVEL, MAX_STATE_ZOOM_LEVEL);
    const world = mapCanvasToWorldCoords(pos.x, pos.y, ctx.params);

    state[zoomKey] = nextZoom;
    const applied = nextZoom / oldZoom;
    ctx.params.scale.x *= applied;
    ctx.params.scale.y *= applied;
    ctx.params.origin.x = pos.x - world.x * ctx.params.scale.x;
    ctx.params.origin.y = pos.y + world.y * ctx.params.scale.y;

    updatePlaneViewportRanges(ctx.params);
    requestDomainRedraw(true);
}

function flushCanvasWheel(ctx) {
    if (!ctx.pendingWheel.hasData) return;
    ctx.pendingWheel.hasData = false;

    const pos = canvasPosition(ctx, ctx.pendingWheel);
    const factor = ctx.pendingWheel.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
    zoomPlaneAt(ctx, pos, factor);
}

function handleCanvasWheel(ctx, event) {
    event.preventDefault();
    canvasRect(ctx);
    updatePointerSnapshot(ctx.pendingWheel, event);
    flushCanvasWheel(ctx);
}

function bindViewportInteractions(canvas, { getViewport, setViewport, scaleZoom, onRedraw }) {
    if (!canvas) return;
    let drag = null;

    canvas.addEventListener('mousedown', event => {
        if (event.button !== 0) return;
        const { xRange, yRange } = getViewport();
        drag = { x: event.clientX, y: event.clientY, xRange: [...xRange], yRange: [...yRange] };
    }, PASSIVE_LISTENER_OPTIONS);

    bindElementListener(window, 'mousemove', event => {
        if (!drag) return;
        const rect = canvas.getBoundingClientRect();
        const xSpan = drag.xRange[1] - drag.xRange[0];
        const ySpan = drag.yRange[1] - drag.yRange[0];
        const shiftX = -(event.clientX - drag.x) * xSpan / Math.max(1, rect.width);
        const shiftY = (event.clientY - drag.y) * ySpan / Math.max(1, rect.height);
        setViewport(
            [drag.xRange[0] + shiftX, drag.xRange[1] + shiftX],
            [drag.yRange[0] + shiftY, drag.yRange[1] + shiftY],
            getViewport().zoom
        );
        onRedraw();
    }, PASSIVE_LISTENER_OPTIONS);

    bindElementListener(window, 'mouseup', () => { drag = null; }, PASSIVE_LISTENER_OPTIONS);

    canvas.addEventListener('wheel', event => {
        event.preventDefault();
        const current = getViewport();
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        const px = clamp(event.clientX - rect.left, 0, width);
        const py = clamp(event.clientY - rect.top, 0, height);
        const xSpan = current.xRange[1] - current.xRange[0];
        const ySpan = current.yRange[1] - current.yRange[0];
        const anchorX = current.xRange[0] + px / width * xSpan;
        const anchorY = current.yRange[1] - py / height * ySpan;
        const { factor, zoom = current.zoom } = scaleZoom(current, event.deltaY);
        const nextXSpan = xSpan * factor;
        const nextYSpan = ySpan * factor;
        const xMin = anchorX - px / width * nextXSpan;
        const yMax = anchorY + py / height * nextYSpan;
        setViewport([xMin, xMin + nextXSpan], [yMax - nextYSpan, yMax], zoom);
        onRedraw();
    }, ACTIVE_LISTENER_OPTIONS);
}

export function bindGenericPlaneInteractions(canvas, planeParams, onRedraw) {
    if (!planeParams) return;
    bindViewportInteractions(canvas, {
        getViewport: () => ({
            xRange: planeParams.currentVisXRange,
            yRange: planeParams.currentVisYRange
        }),
        setViewport(xRange, yRange) {
            planeParams.currentVisXRange = xRange;
            planeParams.currentVisYRange = yRange;
            planeParams.scale.x = planeParams.width / (xRange[1] - xRange[0]);
            planeParams.scale.y = planeParams.height / (yRange[1] - yRange[0]);
            planeParams.origin.x = -xRange[0] * planeParams.scale.x;
            planeParams.origin.y = yRange[1] * planeParams.scale.y;
        },
        scaleZoom: (_current, deltaY) => ({ factor: deltaY < 0 ? 0.85 : 1.15 }),
        onRedraw
    });
}

function bindCanvasInteractions() {
    ['z', 'w'].forEach(planeType => {
        const ctx = createCanvasInteractionContext(planeType);
        canvasInteractionContexts[planeType] = ctx;
        if (!ctx.canvas) return;

        ctx.canvas.addEventListener('mousemove', onCanvasMouseMove, PASSIVE_LISTENER_OPTIONS);
        ctx.canvas.addEventListener('mousedown', onCanvasMouseDown, PASSIVE_LISTENER_OPTIONS);
        ctx.canvas.addEventListener('mouseup', onCanvasMouseUp, PASSIVE_LISTENER_OPTIONS);
        ctx.canvas.addEventListener('mouseleave', onCanvasMouseLeave, PASSIVE_LISTENER_OPTIONS);
        ctx.canvas.addEventListener('wheel', onCanvasWheel, ACTIVE_LISTENER_OPTIONS);
        ctx.canvas.addEventListener('click', onCanvasClick, PASSIVE_LISTENER_OPTIONS);
    });

    bindElementListener(window, 'mouseup', event => {
        for (const ctx of Object.values(canvasInteractionContexts)) {
            if (ctx) handleCanvasUp(ctx, event);
        }
    }, PASSIVE_LISTENER_OPTIONS);

    bindGenericPlaneInteractions(controls.laplaceComCanvas, laplaceComPlaneParams, requestUiRedraw);
    bindGenericPlaneInteractions(controls.laplaceSpectrumCanvas, laplaceSpectrumPlaneParams, requestUiRedraw);

    ['z_plane_shape_controls_overlay', 'grid_shape_controls_overlay', 'radial_discrete_steps_options_div'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            ['mousedown', 'mousemove', 'mouseup', 'wheel', 'click', 'pointerdown', 'touchstart'].forEach(evtName => {
                el.addEventListener(evtName, event => event.stopPropagation());
            });
        }
    });

    bindContourCanvasInteractions();
}

function bindContourCanvasInteractions() {
    const contourCanvas = document.getElementById('contour_2d_canvas');
    const getViewport = () => state.laplaceModeEnabled
        ? { xRange: state.laplaceSurface.sigmaRange, yRange: state.laplaceSurface.omegaRange, zoom: state.laplaceSurface.viewportZoom ?? 1 }
        : { xRange: zPlaneParams.currentVisXRange, yRange: zPlaneParams.currentVisYRange, zoom: state.zPlaneZoom };
    bindViewportInteractions(contourCanvas, {
        getViewport,
        setViewport(xRange, yRange, zoom) {
            if (state.laplaceModeEnabled) return setLaplaceSurfaceViewport(xRange, yRange, zoom);
            zPlaneParams.currentVisXRange = xRange;
            zPlaneParams.currentVisYRange = yRange;
            state.zPlaneZoom = zoom;
            zPlaneParams.scale.x = zPlaneParams.width / (xRange[1] - xRange[0]);
            zPlaneParams.scale.y = zPlaneParams.height / (yRange[1] - yRange[0]);
            zPlaneParams.origin.x = -xRange[0] * zPlaneParams.scale.x;
            zPlaneParams.origin.y = yRange[1] * zPlaneParams.scale.y;
        },
        scaleZoom(current, deltaY) {
            const oldZoom = requireFiniteNumber(current.zoom, 'Contour zoom');
            const requested = deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
            const zoom = clamp(oldZoom * requested, MIN_STATE_ZOOM_LEVEL, MAX_STATE_ZOOM_LEVEL);
            return { factor: oldZoom / zoom, zoom };
        },
        onRedraw: () => requestDomainRedraw(true)
    });
}

function refreshCanvasLayout() {
    refreshPanelLayout();
    positionGridShapeControls();
    hidePlaneContextMenu();
    invalidateAllCanvasRects();
    setupVisualParameters(false, false);
    requestDomainRedraw(true);
    requestUiRedraw();
}

function bindCanvasRectInvalidation() {
    bindElementListener(window, 'resize', refreshCanvasLayout, PASSIVE_LISTENER_OPTIONS);
    bindElementListener(window, 'scroll', invalidateAllCanvasRects, PASSIVE_CAPTURE_LISTENER_OPTIONS);
    bindElementListener(document, 'scroll', invalidateAllCanvasRects, PASSIVE_CAPTURE_LISTENER_OPTIONS);
    bindElementListener(document, 'transitionend', (e) => {
        if (e.target && (e.target.id === 'canvases_section' || e.target.classList?.contains('plane-column') || e.target.classList?.contains('two-column-layout') || e.target.classList?.contains('controls-panel') || e.target.id === 'controls_options_section')) {
            refreshCanvasLayout();
        }
    }, PASSIVE_LISTENER_OPTIONS);
}

function contextForCanvasEvent(event) {
    return canvasContextByElement.get(event.currentTarget || event.target);
}

function onCanvasMouseMove(event) {
    const ctx = contextForCanvasEvent(event);
    if (!ctx) return;
    scheduleCanvasMove(ctx, event);
    updateCanvasTooltip(ctx, event);
}

function onCanvasMouseDown(event) {
    const ctx = contextForCanvasEvent(event);
    if (ctx) handleCanvasDown(ctx, event);
}

function onCanvasMouseUp(event) {
    const ctx = contextForCanvasEvent(event);
    if (ctx) handleCanvasUp(ctx, event);
}

function onCanvasMouseLeave(event) {
    const ctx = contextForCanvasEvent(event);
    if (!ctx) return;
    handleCanvasLeave(ctx);
    invalidateCanvasRect(ctx);
    hideDynamicTooltip();
}

function onCanvasWheel(event) {
    const ctx = contextForCanvasEvent(event);
    if (ctx) handleCanvasWheel(ctx, event);
}

function onCanvasClick(event) {
    const ctx = contextForCanvasEvent(event);
    if (!ctx) return;
    if (ctx.hasDragged) {
        ctx.hasDragged = false;
        return;
    }

    refreshCanvasRect(ctx);
    updatePointerSnapshot(ctx.pendingMove, event);
    const pos = canvasPosition(ctx, ctx.pendingMove);
    if (state.taylorSeriesCanvasClickCenterEnabled) {
        const target = mapCanvasToWorldCoords(pos.x, pos.y, ctx.params);
        state.taylorSeriesCustomCenter = { re: target.x, im: target.y };
        state.taylorSeriesCustomCenterEnabled = true;
        state.taylorSeriesEnabled = true;
        state.taylorSeriesHoverPoint = {
            canvasX: pos.x,
            canvasY: pos.y,
            world: target,
            isZ: ctx.isZ
        };
        requestDomainRedraw(true);
        requestUiRedraw();
        return;
    }
    if (!ctx.isZ && state.preimageExplorerEnabled) {
        const target = mapCanvasToWorldCoords(pos.x, pos.y, ctx.params);
        const map = resolveActiveMap();
        const xRange = zPlaneParams.currentVisXRange;
        const yRange = zPlaneParams.currentVisYRange;
        state.preimageTarget = { re: target.x, im: target.y };
        state.preimageRoots = findNativePreimages({
            density: 18,
            maxIterations: 28,
            map: nativeOptionsForActiveMap(map),
            target: state.preimageTarget,
            xRange,
            yRange
        });
        state.preimageStatus = `${state.preimageRoots.length} preimage${state.preimageRoots.length === 1 ? '' : 's'}`;
        requestUiRedraw();
        return;
    }
    if (!ctx.isZ || !state.graphViewEnabled) return;
    if (selectGraphInputFromCanvasPoint(pos.x, pos.y, ctx.params)) {
        requestUiRedraw();
    }
}

function fullscreenStyles(backgroundColor) {
    return {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        zIndex: '1000',
        backgroundColor
    };
}

function attachCloseButton(container, handler) {
    if (!controls.closeFullscreenBtn || !container) return;
    controls.closeFullscreenBtn.onclick = handler;
    container.appendChild(controls.closeFullscreenBtn);
    controls.closeFullscreenBtn.classList.remove('hidden');
}

function detachCloseButton(container) {
    if (!controls.closeFullscreenBtn) return;
    if (controls.closeFullscreenBtn.parentElement === container) container.removeChild(controls.closeFullscreenBtn);
    controls.closeFullscreenBtn.classList.add('hidden');
}

function removeFromBody(element) {
    if (element && element.parentElement === document.body) document.body.removeChild(element);
}

function resetFullscreenShell(container) {
    if (!container) return;
    container.classList.add('hidden');
    removeFromBody(container);
    detachCloseButton(container);
    clearStyles(container, ['position', 'top', 'left', 'width', 'height', 'zIndex', 'backgroundColor']);
}

function rememberFullscreenOrigin(element) {
    fullscreenOrigins.set(element, {
        parent: element.parentElement,
        width: element.style.width,
        height: element.style.height
    });
}

function restoreFullscreenOrigin(element, restoreSize = false) {
    const origin = fullscreenOrigins.get(element);
    if (!origin?.parent) throw new Error('Fullscreen element has no recorded origin.');
    origin.parent.appendChild(element);
    if (restoreSize) {
        element.style.width = origin.width;
        element.style.height = origin.height;
    }
    fullscreenOrigins.delete(element);
}

function toggleFullscreenContainer({
    container,
    card,
    entering,
    onClose,
    backgroundColor = '#000',
    restoreSize = false,
    onResize = null
}) {
    const shell = controls.fullscreenContainer;
    if (!container || !shell) return;

    if (entering) {
        rememberFullscreenOrigin(container);
        setStyles(shell, fullscreenStyles(backgroundColor));
        attachCloseButton(shell, onClose);
        setStyles(container, { width: '100%', height: '100%' });
        shell.appendChild(container);
        document.body.appendChild(shell);
        shell.classList.remove('hidden');
        if (card) card.classList.add('hidden-visually');
    } else {
        restoreFullscreenOrigin(container, restoreSize);
        setStyles(container, { width: '100%', height: '100%' });
        resetFullscreenShell(shell);
        if (card) card.classList.remove('hidden-visually');
    }

    if (typeof onResize === 'function') {
        laterFrame(onResize, entering ? 150 : 100);
    }
}

function toggleFullscreenPanel({ container, column, stateKey, closeButton, onResize }) {
    if (!container || !controls.fullscreenContainer) return;
    state[stateKey] = !state[stateKey];
    toggleFullscreenContainer({
        container,
        card: column,
        entering: state[stateKey],
        onClose: () => closeButton.click(),
        onResize
    });
}

function bindFullscreenPanelToggle(buttonKey, options) {
    bindControlListener(buttonKey, 'click', () => toggleFullscreenPanel({
        ...options,
        closeButton: controls[buttonKey]
    }));
}

function bindFullscreenControls() {
    bindControlListener('toggleFullscreenZBtn', 'click', () => handleFullScreenToggle('z'));
    bindControlListener('toggleFullscreenWBtn', 'click', () => handleFullScreenToggle('w', 0));
    bindFullscreenPanelToggle('toggleFullscreenLaplace3DBtn', {
        container: controls.laplace3DContainer,
        column: controls.laplace3DColumn,
        stateKey: 'isLaplace3DFullScreen',
        onResize: () => resizeScalarSurface(controls.laplace3DContainer)
    });
    const resizeLaplaceCanvas = () => {
        setupVisualParameters(false, false);
        requestUiRedraw();
    };
    bindFullscreenPanelToggle('toggleFullscreenLaplaceComBtn', {
        container: controls.laplaceComCanvas?.parentElement,
        column: controls.laplaceComColumn,
        stateKey: 'isLaplaceComFullScreen',
        onResize: resizeLaplaceCanvas
    });
    bindFullscreenPanelToggle('toggleFullscreenLaplaceSpectrumBtn', {
        container: controls.laplaceSpectrumCanvas?.parentElement,
        column: controls.laplaceSpectrumColumn,
        stateKey: 'isLaplaceSpectrumFullScreen',
        onResize: resizeLaplaceCanvas
    });
    bindFullscreenPanelToggle('toggleFullscreenFourier3DBtn', {
        container: controls.fourier3DContainer,
        column: controls.fourier3DColumn,
        stateKey: 'isFourier3DFullScreen',
        onResize: drawFourier3DPipeline
    });

    // Event delegation for dynamic chained w-plane fullscreen buttons
    bindElementListener(document, 'click', event => {
        const btn = event.target.closest('[id^="toggle_fullscreen_w_btn_"]');
        if (btn) {
            const index = parseInt(btn.id.replace('toggle_fullscreen_w_btn_', ''), 10);
            if (!isNaN(index)) {
                handleFullScreenToggle('w', index);
            }
        }
    });

    bindElementListener(document, 'keydown', event => {
        if (event.key !== 'Escape') return;
        if (state.isZFullScreen) handleFullScreenToggle('z');
        if (state.isWFullScreen) handleFullScreenToggle('w', state.fullscreenWIndex || 0);
        if (state.isLaplace3DFullScreen && controls.toggleFullscreenLaplace3DBtn) {
            controls.toggleFullscreenLaplace3DBtn.click();
        }
        if (state.isLaplaceComFullScreen && controls.toggleFullscreenLaplaceComBtn) {
            controls.toggleFullscreenLaplaceComBtn.click();
        }
        if (state.isLaplaceSpectrumFullScreen && controls.toggleFullscreenLaplaceSpectrumBtn) {
            controls.toggleFullscreenLaplaceSpectrumBtn.click();
        }
        if (state.isFourier3DFullScreen && controls.toggleFullscreenFourier3DBtn) {
            controls.toggleFullscreenFourier3DBtn.click();
        }
        if (state.isGraphFullScreen && controls.toggleFullscreenGraphBtn) {
            controls.toggleFullscreenGraphBtn.click();
        }
    });
}

function syncTopControlsCollapseState() {
    if (!controls.controlsOptionsSection || !controls.toggleTopControlsBtn || !controls.toggleTopControlsCollapsedBtn || !controls.topControlsCollapsedBar) {
        return;
    }

    const collapsed = Boolean(state.topControlsCollapsed);
    const expandedText = 'Minimize top half panels';
    const collapsedText = 'Expand top half panels';

    controls.controlsOptionsSection.classList.toggle('is-collapsed', collapsed);
    controls.topControlsCollapsedBar.classList.toggle('hidden', !collapsed);

    [
        [controls.toggleTopControlsBtn, expandedText],
        [controls.toggleTopControlsCollapsedBtn, collapsedText]
    ].forEach(([button, text]) => {
        button.dataset.tooltip = text;
        button.title = text;
        button.setAttribute('aria-label', text);
    });
}

function bindTopControlsToggle() {
    const toggle = () => {
        state.topControlsCollapsed = !state.topControlsCollapsed;
        syncTopControlsCollapseState();
        frame(refreshCanvasLayout);
    };

    bindControlListener('toggleTopControlsBtn', 'click', toggle);
    bindControlListener('toggleTopControlsCollapsedBtn', 'click', toggle);
}



export function setupEventListeners() {
    zCanvas = context.zCanvas;
    wCanvas = context.wCanvas;

    if (uiEventListenersBound) return;
    uiEventListenersBound = true;

    subscribeState(() => updateDomainPaletteCirclePanel(), 'domainPalette');
    subscribeState(() => updateSurfacePaletteCirclePanel(), 'surfacePalette');
    BINDERS.forEach(fn => fn());

    initPlaneContextMenu();
    syncTopControlsCollapseState();
    updateModePanels();
}

function bindChainingControls() {
    bindSelector('inputShapeSelector', 'currentInputShape', (_event, value) => {
        if (value === 'navigate') {
            setNavigationModeEnabled(true);
        } else if (state.navigationModeEnabled) {
            setNavigationModeEnabled(false);
        }
        if (!isMediaInputShape(value) && state.videoIsPlaying) {
            pauseUploadedVideoPlayback();
        } else if (isMediaInputShape(value) && runtime.media.video && state.videoIsPlaying) {
            startVideoProcessingLoop();
        }
        if (state.graphFullGridEnabled && !isFullGridPerspectiveSupported(value)) {
            state.graphFullGridEnabled = false;
            state.graphLayerLockEnabled = false;
        }
        if (state.graphViewEnabled && !isGraphViewSupported(value)) {
            state.graphViewEnabled = false;
            state.graphFourierEnabled = false;
            disposeTransformationGraphRenderer();
        }
        if (canvasInteractionContexts.z) canvasInteractionContexts.z.drawingArbitraryShape = false;
        syncGridFoldDensity(state.foldSurface3dEnabled && isFoldableInputShape(value));
        requestDomainRedraw(true);
    });

    bindSlider('chainCountSlider', 'chainCount', parseInteger, value => {
        if (controls.chainCountValueDisplay) controls.chainCountValueDisplay.textContent = value;
        updateChainingColumns(state.chainingEnabled ? value : 1);
        requestUiRedraw();
    });

    bindElementListener(controls.enableChainingCb, 'change', event => {
        state.chainingEnabled = event.target.checked;
        state.currentFunctionPreset = null;
        updateChainingColumns(state.chainingEnabled ? state.chainCount : 1);
        requestUiRedraw();
    });

    bindElementListener(controls.chainModeSelector, 'change', event => {
        state.chainingMode = event.target.value === 'zero_seed' ? 'zero_seed' : 'recursion';
        state.currentFunctionPreset = null;
        requestUiRedraw();
    });
}

function bindThemeControls() {
    loadThemePreferences();
    applyTheme(state.themeId, { preserveGridColors: true });
    bindControlListener('themeSelectorBtn', 'click', openThemeModal);
    bindControlListener('resetWorkspaceLayoutBtn', 'click', resetAllPanelLayouts);
}

function fullscreenTarget(planeType, index = 0) {
    const isZ = planeType === 'z';
    if (isZ) {
        return {
            isZ: true,
            isThree: false,
            element: controls.zPlaneCanvasWrapper || zCanvas,
            card: controls.zPlaneColumn
        };
    }

    const canvas = (context.wCanvasList && context.wCanvasList[index]) || wCanvas;
    const card = index === 0 ? controls.wPlaneColumn : document.getElementById(`w_plane_column_${index}`);
    const threeContainer = (context.wPlaneThreeContainersList && context.wPlaneThreeContainersList[index]) || controls.wPlaneThreeContainer;
    const surface = state.riemannSurfaceEnabled ? getRiemannSurfaceCanvas(canvas) : null;
    const isThree = threeContainer && (
        state.manifold3dViewEnabled ||
        (state.foldSurface3dEnabled && (
            isFoldableInputShape(state.currentInputShape) ||
            (isMediaInputShape() && getMediaSource())
        ))
    );

    let element = surface || (isThree ? threeContainer : canvas);
    if (!surface && !isThree) {
        if (index === 0 && controls.wPlaneCanvasWrapper) {
            element = controls.wPlaneCanvasWrapper;
        } else if (canvas && canvas.parentElement) {
            element = canvas.parentElement;
        }
    }

    return {
        isZ: false,
        isThree,
        element,
        card,
        canvas
    };
}

function setPlaneFullscreen(isZ, value, index = 0) {
    if (isZ) {
        state.isZFullScreen = value;
    } else {
        state.isWFullScreen = value;
        state.fullscreenWIndex = value ? index : 0;
    }
}

function isPlaneFullscreen(isZ) {
    return isZ ? state.isZFullScreen : state.isWFullScreen;
}

function handleFullScreenToggle(planeType, index = 0) {
    const target = fullscreenTarget(planeType, index);
    if (!target.element) {
        console.error('Fullscreen target element not found for plane:', planeType, 'index:', index);
        return;
    }

    setPlaneFullscreen(target.isZ, !isPlaneFullscreen(target.isZ), index);
    const entering = isPlaneFullscreen(target.isZ);

    toggleFullscreenContainer({
        container: target.element,
        card: target.card,
        entering,
        onClose: () => handleFullScreenToggle(planeType, index),
        backgroundColor: 'var(--color-background-dark)',
        restoreSize: true
    });

    if (target.isThree && target.canvas) {
        target.canvas.classList.toggle('hidden', entering);
    }
    setupVisualParameters(false, false);

    if (target.isThree) {
        laterFrame(() => {
            if (entering) {
                target.element.classList.remove('hidden');
                setStyles(target.element, { width: '100%', height: '100%' });
            }
            window.dispatchEvent(new Event('resize'));
        }, entering ? 100 : 50);
    }

    requestDomainRedraw(true);
}

function bindAlgebraicChainingControls() {
    if (controls.enableAlgebraicChainingCb) {
        bindElementListener(controls.enableAlgebraicChainingCb, 'change', event => {
            const enabled = event.target.checked;
            const currentFunction = state.currentFunction === 'algebraic_chaining'
                ? algebraicChainingSourceFunction || state.algebraicChainingTerms?.[0]?.factors?.[0]?.func || 'cos'
                : state.currentFunction;

            if (enabled && currentFunction !== 'algebraic_chaining') {
                algebraicChainingSourceFunction = currentFunction;
                mutateState('algebraicChainingTerms', terms => {
                    const firstFactor = terms?.[0]?.factors?.[0];
                    if (firstFactor) {
                        firstFactor.func = currentFunction;
                        firstFactor.chainedFunc = 'none';
                    }
                }, 'algebraicChainingTerms.factor.func');
            }

            state.algebraicChainingEnabled = enabled;
            state.currentFunctionPreset = null;
            display(controls.algebraicChainingControlsContainer, state.algebraicChainingEnabled);

            state.currentFunction = enabled ? 'algebraic_chaining' : (algebraicChainingSourceFunction || 'cos');
            if (state.realPlotsEnabled) {
                updateCategoryNavState('real_plots');
            } else {
                setActiveFunctionButton(enabled ? 'custom_complex' : state.currentFunction);
            }
            if (!enabled) algebraicChainingSourceFunction = null;

            requestAlgebraicRedraw();
        });
    }

    bindElementListener(controls.addAlgebraicTermBtn, 'click', () => {
        appendAlgebraicTerm();
    });

    const updateAlgebraicZExpression = () => {
        const input = controls.algebraicChainingZInput;
        const preview = controls.algebraicChainingZMath;
        const value = String(input?.value ?? '').trim() || 'z';
        updateCustomFormulaPreview(input, preview, { allowedVariables: ['z'] });
        try {
            compileExpression(value, { allowedVariables: ['z'] });
        } catch {
            // Keep the last valid expression active while the user is typing.
            return;
        }
        if (state.algebraicChainingZExpr === value) return;
        state.algebraicChainingZExpr = value;
        requestAlgebraicRedraw();
    };

    bindControlListener('algebraicChainingZInput', 'input', updateAlgebraicZExpression);
    bindControlListener('algebraicChainingZInput', 'change', updateAlgebraicZExpression);
}

function bindDomainPaletteCirclePanelListeners() {
    bindPalettePanel(
        'view_palette_circle_btn',
        'close_domain_palette_circle_btn',
        'domain_palette_circle_panel',
        updateDomainPaletteCirclePanel
    );
}

function bindSurfacePaletteCirclePanelListeners() {
    bindPalettePanel(
        'view_real_plots_palette_circle_btn',
        'close_real_plots_palette_circle_btn',
        'real_plots_palette_circle_panel',
        updateSurfacePaletteCirclePanel
    );
}

function bindPalettePanel(viewButtonId, closeButtonId, panelId, updatePanel) {
    const panel = $(panelId);
    bindElementListener($(viewButtonId), 'click', () => {
        if (!panel) return;
        panel.classList.remove('hidden');
        updatePanel();
    });
    bindElementListener($(closeButtonId), 'click', () => hidden(panel, true));
}

function bindGraphControls() {
    bindSelector('graphGridFamilySelector', 'graphGridFamily', () => {
        state.graphSelectedShape = '';
        requestUiRedraw();
    });
    bindCheckbox('enableGraphFourierCb', 'graphFourierEnabled', (_event, enabled) => {
        if (!state.graphViewEnabled || state.laplaceModeEnabled) {
            state.graphFourierEnabled = false;
        } else {
            state.graphFourierEnabled = enabled;
        }
        updateModePanels();
        requestUiRedraw();
    });

    bindCheckbox('enableGraphTraceCb', 'graphTraceEnabled', () => requestUiRedraw());
    bindFullscreenPanelToggle('toggleFullscreenGraphBtn', {
        container: controls.graphContainer,
        column: controls.graphColumn,
        stateKey: 'isGraphFullScreen',
        onResize: () => {
            resizeTransformationGraphRenderer();
            requestUiRedraw();
        }
    });
}

function bindRealPlotsExpressionControls({ preset, input, expressionKey, customKey }) {
    const showValidation = (field, message) => {
        if (!field) return;
        field.setCustomValidity?.(message || '');
        const display = field.parentElement?.querySelector('.compact-formula-preview');
        if (!display) return;
        if (message) {
            display.textContent = message;
            display.classList.add('dynamic-math-error');
        } else {
            updateCustomFormulaPreview(field, display);
        }
    };

    const commit = (source, custom) => {
        const value = String(source ?? '').trim();
        const error = validateRealPlotExpression(value);
        const field = controls[input];
        if (error) {
            showValidation(field, error);
            return false;
        }
        if (custom) {
            showValidation(field, null);
        } else {
            field?.setCustomValidity?.('');
            const display = field?.parentElement?.querySelector('.compact-formula-preview');
            display?.classList.remove('dynamic-math-error');
        }
        state[expressionKey] = value;
        state[customKey] = custom;
        requestUiRedraw();
        return true;
    };

    bindControlListener(preset, 'change', (_event, selector) => {
        const custom = selector.value === 'custom';
        commit(custom ? controls[input]?.value : selector.value, custom);
    });

    bindControlListener(input, 'input', (_event, field) => {
        commit(field.value, true);
    });
}

function bindRealPlotsControls() {
    bindRealPlotsExpressionControls({
        preset: 'realPlotsInputPreset',
        input: 'realPlotsCustomInput',
        expressionKey: 'realPlotsInputExpr',
        customKey: 'realPlotsInputIsCustom'
    });
    bindRealPlotsExpressionControls({
        preset: 'realPlotsImagPreset',
        input: 'realPlotsCustomImag',
        expressionKey: 'realPlotsImagExpr',
        customKey: 'realPlotsImagIsCustom'
    });

    bindSelector('realPlotsOutputComponent', 'realPlotsOutputComponent', requestUiRedraw);
    bindSelector('realPlotsColorMode', 'realPlotsColorMode', requestUiRedraw);

    ['Brightness', 'Contrast', 'Saturation', 'HeightScale'].forEach(name =>
        bindSlider(`realPlots${name}Slider`, `realPlots${name}`)
    );
    bindFullscreenPanelToggle('toggleFullscreenRealPlotsBtn', {
        container: controls.realPlotsContainer,
        column: controls.realPlotsColumn,
        stateKey: 'isRealPlotsFullScreen',
        onResize: () => {
            setupVisualParameters(false, false);
            requestUiRedraw();
        }
    });
}

function bindContourControls() {
    ['realPlots', 'riemannSurface', 'laplace'].forEach(prefix => {
        bindCheckbox(`${prefix}ContoursCb`, 'contoursEnabled', requestUiRedraw);
        bindSlider(`${prefix}ContourIntervalSlider`, 'contourInterval', parseFloat, requestUiRedraw);
        bindSlider(`${prefix}ContourThicknessSlider`, 'contourThickness', parseFloat, requestUiRedraw);
        bindControlListener(`${prefix}Show2DContourBtn`, 'click', () => {
            state.show2DContourPlot = !state.show2DContourPlot;
            requestUiRedraw();
        });
    });
    bindFullscreenPanelToggle('toggleFullscreenContour2DBtn', {
        container: controls.contour2DCanvas,
        column: controls.contour2DColumn,
        stateKey: 'isContour2DFullScreen',
        onResize: () => {
            setupVisualParameters(false, false);
            requestUiRedraw();
        }
    });
}
