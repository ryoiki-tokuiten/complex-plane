import { state, context, mutateState, zPlaneParams, wPlaneParams, laplaceComPlaneParams, laplaceSpectrumPlaneParams, sliderParamKeys } from '../store/state.js';
import { runtime } from '../store/runtime.js';
import { setupVisualParameters } from '../utils/dom-utils.js';
import { loadUploadedMediaFile, pauseUploadedVideoPlayback, startVideoProcessingLoop, publishVideoPlaybackStatus, isMediaInputShape } from '../utils/raster-media.js';
import { hidePlaneContextMenu, openPlaneContextMenu } from './plane-context-menu-state.js';
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
    ORBIT_COLORING_MODES,
    normalizeOrbitColoringMode
} from '../constants/rendering.js';
import { syncGridDensityControls } from './grid-density.js';
import { stopLaplaceAnimation, toggleLaplaceAnimation, resetLaplaceAnimation, showFullLaplaceSpiral } from '../rendering/laplace-animation.js';
import { setNavigationModeEnabled, setNavigationKey, stopNavigationLoop } from '../navigation-plane.js';
import { toggleAnimation } from './animation-controller.js';
import { initializePolynomialCoeffs } from '../store/polynomial-state.js';
import { resizeScalarSurface } from '../rendering/real-plots-renderer.js';
import { applyTheme, loadThemePreferences } from './theme.js';
import { applyFractalPreset, isFractalPresetKey } from '../analysis/fractal-presets.js';
import {
    initPanelLayoutManager,
    refreshPanelLayout,
    resetAllPanelLayouts
} from '../ui/panel-layout-manager.js';
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
import { isFoldableInputShape } from '../rendering/shape-generators.js';
import {
    evaluateNativeSheets,
    findNativePreimages,
    nativeMapOptions
} from '../native/complex-engine.js';
import { getDefaultInputShapeForManifold } from '../rendering/manifold-registry.js';
import { resetRiemannSurfaceViews } from '../rendering/webgl-riemann-surface.js';
import { findNearestDynamicSample, formatDynamicSampleTooltip } from '../rendering/draw-dynamic-plotting.js';
import { drawFourier3DPipeline } from '../rendering/fourier-3d-pipeline.js';
import { showDynamicTooltip, hideDynamicTooltip } from './tooltip-state.js';
import { controlKeyFromId } from './control-key.js';

const { controls = {} } = context;

let zCanvas;
let wCanvas;
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

const uiActions = new Map();
const FUNCTION_KEYS = [
    'cos', 'sin', 'tan', 'sec', 'exp', 'ln', 'sinh', 'tanh', 'asin', 'atan',
    'power', 'mobius', 'zeta', 'gamma', 'loggamma', 'bessel', 'polynomial',
    'mandelbrot', 'newton_fractal', 'laplace'
];

const EVENT_PROP_NAMES = {
    blur: 'onBlur', change: 'onChange', click: 'onClick', contextmenu: 'onContextMenu',
    input: 'onInput', keydown: 'onKeyDown', keyup: 'onKeyUp', mousedown: 'onMouseDown',
    mouseleave: 'onMouseLeave', mousemove: 'onMouseMove', mouseup: 'onMouseUp',
    pointercancel: 'onPointerCancel', pointerdown: 'onPointerDown', pointermove: 'onPointerMove', pointerup: 'onPointerUp',
    wheel: 'onWheel'
};

function registerUiAction(controlKey, eventName, handler) {
    const prop = EVENT_PROP_NAMES[eventName];
    if (!prop) throw new Error(`Unsupported Preact UI event: ${eventName}`);
    const current = uiActions.get(controlKey) || {};
    const previous = current[prop];
    uiActions.set(controlKey, {
        ...current,
        [prop]: previous
            ? event => { previous(event); handler(event, event.currentTarget); }
            : event => handler(event, event.currentTarget)
    });
}

function registerUiProps(controlKey, props) {
    uiActions.set(controlKey, { ...uiActions.get(controlKey), ...props });
}

const canvasInteractionContexts = { z: null, w: null };
const canvasContextByElement = new WeakMap();
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
        requestUiRedraw();
    });
    bindControlListener('clearArbitraryShapeBtn', 'click', () => {
        state.arbitraryShapePoints = [];
        requestUiRedraw();
    });

    bindControlListener('branchCutAngleSlider', 'input', (_event, slider) => {
        state.branchCutAngle = Number(slider.value);
        resetContinuationForCutChange();
        requestUiRedraw();
    });
    bindControlListener('drawContinuationPathBtn', 'click', () => {
        state.branchDrawMode = state.branchDrawMode === 'path' ? null : 'path';
        requestUiRedraw();
    });
    bindControlListener('resetContinuationBtn', 'click', () => {
        state.branchDrawMode = null;
        resetContinuationForCutChange();
        requestUiRedraw();
    });
}

function resetContinuationForCutChange() {
    state.continuationPath = [];
    state.continuationValues = [];
    state.continuationSheet = 0;
    state.continuationValue = null;
    state.continuationAngle = null;
    state.riemannSurfaceBranchCenter = 0;
}

function parseInteger(value) {
    return parseInt(value, 10);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function laterFrame(callback, delay = 0) {
    requestAnimationFrame(() => setTimeout(callback, delay));
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

function bindControlListener(controlKey, eventName, handler) {
    registerUiAction(controlKey, eventName, handler);
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

function requestUiRedraw() {
    requestScheduledUiRedraw();
}

function requestDomainRedraw(markDomainDirty = false) {
    if (markDomainDirty) requestScheduledDomainRedraw();
    else requestScheduledUiRedraw();
}

function requestAlgebraicRedraw() {
    requestDomainRedraw(true);
}

function updateCategoryNavState(activeCategory) {
    state.controlCategory = activeCategory;
}

function setActiveFunctionButton(activeKey) {
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
}

function refreshPlanesAfterLayoutChange() {
    requestAnimationFrame(() => {
        setupVisualParameters(false, false);
        requestUiRedraw();
    });
}

function disableRealPlots() {
    if (!state.realPlotsEnabled) return;
    state.realPlotsEnabled = false;
    if (!state.riemannSurfaceEnabled) {
        state.show2DContourPlot = false;
    }
    disposeRealPlotsRenderer();
    refreshPlanesAfterLayoutChange();
}

function disableLaplaceMode() {
    if (!state.laplaceModeEnabled) return;
    stopLaplaceAnimation();
    disposeScalarSurface(controls.laplace3DContainer);
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
    state.isGraphFullScreen = false;

    disposeTransformationGraphRenderer();
    refreshPlanesAfterLayoutChange();
}

function syncChainingControlsFromState() {
    if (state.chainingMode !== 'zero_seed') state.chainingMode = 'recursion';
}

function syncAlgebraicControlsFromState() {
    state.algebraicChainingZExpr ||= 'z';
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
        disposeScalarSurface(controls.laplace3DContainer);
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

    setActiveFunctionButton(key);
    requestDomainRedraw(true);
}

function complexState(key) {
    return requireFiniteComplex(state[key], `State ${key}`);
}

const ANIMATION_RANGES = {
    a0: [-5, 5, .05],
    b0: [-5, 5, .05],
    circleR: [.1, 10, .05],
    fractionalPowerN: [-5, 5, .05]
};

function bindAnimatedSlider(key, getValue, update, range = ANIMATION_RANGES[key]) {
    const sliderId = `${key}_slider`;
    bindControlListener(controlKeyFromId(`play_${key}_btn`), 'click', () => toggleAnimation({
        id: sliderId,
        value: getValue(),
        min: range[0],
        max: range[1],
        step: range[2],
        speedId: `speed_${key}_selector`,
        update
    }));
}

function bindBaseParameterControls() {
    sliderParamKeys.forEach(key => {
        bindSlider(`${key}Slider`, key);
        bindAnimatedSlider(
            key,
            () => state[key],
            value => { state[key] = value; }
        );
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
            `mobius${param}_${part}`,
            () => complexState(stateKey)[part],
            value => {
                state[stateKey] = { ...complexState(stateKey), [part]: value };
            },
            [-5, 5, .1]
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
        setActiveFunctionButton('custom_complex');
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

        updateCategoryNavState('real_plots');
        refreshPlanesAfterLayoutChange();
        requestUiRedraw();
    });

    // Standard function & fractal & laplace buttons
    FUNCTION_KEYS.forEach(key => bindControlListener(
        controlKeyFromId(`select_${key}_btn`), 'click', () => activateFunctionMode(key)
    ));
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
    bindSlider('videoFpsSlider', 'videoProcessingFps', parseInteger, () => {
        publishVideoPlaybackStatus();
        if (state.videoIsPlaying && isMediaInputShape()) startVideoProcessingLoop();
        requestUiRedraw();
    });
}

function bindDomainColoringControls() {
    bindCheckbox('showDomainColoringKeyCb', 'domainColoringKeyVisible');
    bindControlListener('orbitColoringModeSelect', 'change', event => {
        setOrbitColoringMode(event.target.value);
        state.currentFunctionPreset = null;
        requestDomainRedraw(true);
    });


    ['domainBrightness', 'domainContrast', 'domainSaturation', 'domainLightnessCycles']
        .forEach(key => bindSlider(`${key}Slider`, key, parseFloat, () => requestDomainRedraw(true)));
}

function disableRiemannSurface() {
    state.riemannSurfaceEnabled = false;
    state.show2DContourPlot = false;
}

function syncGridFoldDensity(useFoldDefault = false) {
    syncGridDensityControls({ applyFoldDefault: useFoldDefault });
}

function disableFoldSurface3d() {
    state.foldSurface3dEnabled = false;
    syncGridFoldDensity();
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
        registerUiAction(controlKeyFromId(id), 'click', event => {
            event.preventDefault();
            event.stopPropagation();
            smoothZoomPlane(planeType, factor);
        });
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
    document.addEventListener('keydown', event => setNavigationKey(event, true));
    document.addEventListener('keyup', event => setNavigationKey(event, false));
    window.addEventListener('blur', () => {
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
    bindControlListener('pickTaylorCenterCanvasBtn', 'click', event => {
        event.stopPropagation();
        state.taylorSeriesCanvasClickCenterEnabled = !state.taylorSeriesCanvasClickCenterEnabled;
        if (!state.taylorSeriesCanvasClickCenterEnabled) state.taylorSeriesHoverPoint = null;
        else hidePlaneContextMenu();
        requestUiRedraw();
    });
}

function bindPolynomialControls() {
    bindSlider('polynomialNSlider', 'polynomialN', parseInteger, value => {
        initializePolynomialCoeffs(value, true);
        requestDomainRedraw(true);
    });
}

function bindRadialAndZetaControls() {
    bindSlider('radialDiscreteStepsCountSlider', 'radialDiscreteStepsCount', parseInteger);
    bindCheckbox('enableZetaContinuationCb', 'zetaContinuationEnabled', () => {
        requestDomainRedraw(true);
    });
    bindCheckbox('enableZetaContinuationRealPlotsCb', 'zetaContinuationEnabled', () => {
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
            }
            if (state.laplaceModeEnabled) updateLaplaceEvaluationPoint();
            requestUiRedraw();
        });
    });

    bindControlListener('laplaceFourierSliceBtn', 'click', () => {
        state.laplaceSigma = 0;
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
    state.probeZ = { re: world.x, im: world.y };
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

function getBaseBranchArgument(point, branchCutAngle) {
    if (!point || !Number.isFinite(point.re) || !Number.isFinite(point.im)) return 0;
    const isFixedCut = ['asin', 'atan', 'loggamma'].includes(state.currentFunction);
    let arg = Math.atan2(point.im, point.re);
    if (!isFixedCut && Number.isFinite(branchCutAngle)) {
        while (arg > branchCutAngle) arg -= 2 * Math.PI;
        while (arg <= branchCutAngle - 2 * Math.PI) arg += 2 * Math.PI;
    }
    return arg;
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
        const points = state.continuationPath;
        const last = points[points.length - 1];
        const sampleDistance = 2 / Math.max(Math.abs(ctx.params.scale.x), Math.abs(ctx.params.scale.y), 1);
        if (!last || Math.hypot(world.x - last.re, world.y - last.im) > sampleDistance) {
            const nextPoints = [...points, { re: world.x, im: world.y }];
            state.continuationPath = nextPoints;
            ctx.hasDragged = true;
            const prev = points[points.length - 1];
            const curr = nextPoints[nextPoints.length - 1];
            let dTheta = Math.atan2(curr.im, curr.re) - Math.atan2(prev.im, prev.re);
            while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
            while (dTheta <= -Math.PI) dTheta += 2 * Math.PI;
            const nextAngle = (state.continuationAngle ?? getBaseBranchArgument(prev, state.branchCutAngle)) + dTheta;
            state.continuationAngle = nextAngle;

            const baseArg = getBaseBranchArgument(curr, state.branchCutAngle);
            const sheet = Math.round((nextAngle - baseArg) / (2 * Math.PI));
            const value = evaluateSheetPoint(state.currentFunction, curr, sheet);
            state.continuationSheet = sheet;
            state.continuationValue = value;
            state.continuationValues = [...state.continuationValues, value];
            state.riemannSurfaceBranchCenter = sheet;
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

    if (state.taylorSeriesCanvasClickCenterEnabled || state.canvasClickPickerTarget) {
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

    const pickerTarget = state.canvasClickPickerTarget || (state.taylorSeriesCanvasClickCenterEnabled ? 'taylorSeriesCustomCenter' : null);
    if (pickerTarget) {
        const pos = canvasPosition(ctx, ctx.pendingMove);
        const world = mapCanvasToWorldCoords(pos.x, pos.y, ctx.params);
        state[pickerTarget] = { re: world.x, im: world.y };
        if (pickerTarget === 'taylorSeriesCustomCenter') {
            state.taylorSeriesCustomCenterEnabled = true;
            state.taylorSeriesEnabled = true;
        }
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
    if (ctx.isZ && state.branchDrawMode === 'path') {
        const pos = canvasPosition(ctx, ctx.pendingMove);
        const world = mapCanvasToWorldCoords(pos.x, pos.y, ctx.params);
        ctx.hasDragged = false;
        state.continuationPath = [{ re: world.x, im: world.y }];
        state.continuationSheet = 0;
        state.continuationAngle = getBaseBranchArgument(state.continuationPath[0], state.branchCutAngle);
        state.continuationValue = evaluateSheetPoint(state.currentFunction, state.continuationPath[0], 0);
        state.continuationValues = [state.continuationValue];
        ctx.drawingBranch = 'path';
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
    if (state.taylorSeriesCanvasClickCenterEnabled || state.canvasClickPickerTarget) {
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

export function createViewportInteractionProps({ getViewport, setViewport, scaleZoom, onRedraw }) {
    let drag = null;

    const end = event => {
        drag = null;
        if (event?.currentTarget?.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };
    return {
    onPointerDown(event) {
        if (event.button !== 0) return;
        const { xRange, yRange } = getViewport();
        drag = { x: event.clientX, y: event.clientY, xRange: [...xRange], yRange: [...yRange] };
        event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event) {
        if (!drag) return;
        const rect = event.currentTarget.getBoundingClientRect();
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
    },
    onPointerUp: end,
    onPointerCancel: end,
    onWheel(event) {
        event.preventDefault();
        const current = getViewport();
        const rect = event.currentTarget.getBoundingClientRect();
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
    }
    };
}

export function createPlaneViewportProps(planeParams, onRedraw) {
    if (!planeParams) return;
    return createViewportInteractionProps({
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

        const key = planeType === 'z' ? 'zPlaneCanvas' : 'wPlaneCanvas';
        bindControlListener(key, 'mousemove', onCanvasMouseMove);
        bindControlListener(key, 'mousedown', onCanvasMouseDown);
        bindControlListener(key, 'mouseup', onCanvasMouseUp);
        bindControlListener(key, 'mouseleave', onCanvasMouseLeave);
        bindControlListener(key, 'wheel', onCanvasWheel);
        bindControlListener(key, 'click', onCanvasClick);
        const wrapperKey = planeType === 'z' ? 'zPlaneCanvasWrapper' : 'wPlaneCanvasWrapper';
        bindControlListener(wrapperKey, 'contextmenu', event => {
            if (event.target.closest?.('canvas')) openPlaneContextMenu(event, planeType);
        });
    });

    window.addEventListener('mouseup', event => {
        for (const ctx of Object.values(canvasInteractionContexts)) {
            if (ctx) handleCanvasUp(ctx, event);
        }
    }, PASSIVE_LISTENER_OPTIONS);

    registerUiProps('laplaceComCanvas', createPlaneViewportProps(laplaceComPlaneParams, requestUiRedraw));
    registerUiProps('laplaceSpectrumCanvas', createPlaneViewportProps(laplaceSpectrumPlaneParams, requestUiRedraw));

    ['z_plane_shape_controls_overlay', 'grid_shape_controls_overlay', 'radial_discrete_steps_options_div'].forEach(id => {
        ['mousedown', 'mousemove', 'mouseup', 'wheel', 'click', 'pointerdown']
            .forEach(eventName => registerUiAction(controlKeyFromId(id), eventName, event => event.stopPropagation()));
    });

    bindContourCanvasInteractions();
}

function bindContourCanvasInteractions() {
    const getViewport = () => state.laplaceModeEnabled
        ? { xRange: state.laplaceSurface.sigmaRange, yRange: state.laplaceSurface.omegaRange, zoom: state.laplaceSurface.viewportZoom ?? 1 }
        : { xRange: zPlaneParams.currentVisXRange, yRange: zPlaneParams.currentVisYRange, zoom: state.zPlaneZoom };
    registerUiProps('contour2DCanvas', createViewportInteractionProps({
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
    }));
}

function refreshCanvasLayout() {
    refreshPanelLayout();
    hidePlaneContextMenu();
    invalidateAllCanvasRects();
    setupVisualParameters(false, false);
    requestDomainRedraw(true);
    requestUiRedraw();
}

function bindCanvasRectInvalidation() {
    window.addEventListener('resize', refreshCanvasLayout, PASSIVE_LISTENER_OPTIONS);
    window.addEventListener('scroll', invalidateAllCanvasRects, PASSIVE_CAPTURE_LISTENER_OPTIONS);
    document.addEventListener('scroll', invalidateAllCanvasRects, PASSIVE_CAPTURE_LISTENER_OPTIONS);
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
    const clickPickerTarget = state.canvasClickPickerTarget || (state.taylorSeriesCanvasClickCenterEnabled ? 'taylorSeriesCustomCenter' : null);
    if (clickPickerTarget) {
        const target = mapCanvasToWorldCoords(pos.x, pos.y, ctx.params);
        state[clickPickerTarget] = { re: target.x, im: target.y };
        if (clickPickerTarget === 'taylorSeriesCustomCenter') {
            state.taylorSeriesCustomCenterEnabled = true;
            state.taylorSeriesEnabled = true;
        }
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

function toggleFullscreenPanel({ stateKey, onResize }) {
    state[stateKey] = !state[stateKey];
    if (typeof onResize === 'function') laterFrame(onResize, state[stateKey] ? 150 : 100);
    requestUiRedraw();
}

function bindFullscreenPanelToggle(buttonKey, options) {
    bindControlListener(buttonKey, 'click', () => toggleFullscreenPanel(options));
}

function bindFullscreenControls() {
    bindControlListener('toggleFullscreenZBtn', 'click', () => handleFullScreenToggle('z'));
    bindControlListener('toggleFullscreenWBtn', 'click', () => handleFullScreenToggle('w', 0));
    bindFullscreenPanelToggle('toggleFullscreenLaplace3DBtn', {
        stateKey: 'isLaplace3DFullScreen',
        onResize: () => resizeScalarSurface(controls.laplace3DContainer)
    });
    const resizeLaplaceCanvas = () => {
        setupVisualParameters(false, false);
        requestUiRedraw();
    };
    bindFullscreenPanelToggle('toggleFullscreenLaplaceComBtn', {
        stateKey: 'isLaplaceComFullScreen',
        onResize: resizeLaplaceCanvas
    });
    bindFullscreenPanelToggle('toggleFullscreenLaplaceSpectrumBtn', {
        stateKey: 'isLaplaceSpectrumFullScreen',
        onResize: resizeLaplaceCanvas
    });
    bindFullscreenPanelToggle('toggleFullscreenFourier3DBtn', {
        stateKey: 'isFourier3DFullScreen',
        onResize: drawFourier3DPipeline
    });

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        if (state.isZFullScreen) handleFullScreenToggle('z');
        if (state.isWFullScreen) handleFullScreenToggle('w', state.fullscreenWIndex || 0);
        state.isLaplace3DFullScreen = false;
        state.isLaplaceComFullScreen = false;
        state.isLaplaceSpectrumFullScreen = false;
        state.isFourier3DFullScreen = false;
        state.isGraphFullScreen = false;
        requestAnimationFrame(refreshCanvasLayout);
    });
}

function bindTopControlsToggle() {
    const toggle = () => {
        state.topControlsCollapsed = !state.topControlsCollapsed;
        requestAnimationFrame(refreshCanvasLayout);
    };

    bindControlListener('toggleTopControlsBtn', 'click', toggle);
    bindControlListener('toggleTopControlsCollapsedBtn', 'click', toggle);
}



export function createFrontendActions() {
    zCanvas = context.zCanvas;
    wCanvas = context.wCanvas;

    BINDERS.forEach(fn => fn());

    return uiActions;
}

function bindChainingControls() {
    bindSlider('chainCountSlider', 'chainCount', parseInteger, () => {
        requestUiRedraw();
    });

    bindControlListener('enableChainingCb', 'change', event => {
        state.chainingEnabled = event.target.checked;
        state.currentFunctionPreset = null;
        requestUiRedraw();
    });

    bindControlListener('chainModeSelector', 'change', event => {
        state.chainingMode = event.target.value === 'zero_seed' ? 'zero_seed' : 'recursion';
        state.currentFunctionPreset = null;
        requestUiRedraw();
    });
}

export function selectInputShape(value) {
    state.currentInputShape = value;
    if (value === 'navigate') setNavigationModeEnabled(true);
    else if (state.navigationModeEnabled) setNavigationModeEnabled(false);
    if (!isMediaInputShape(value) && state.videoIsPlaying) pauseUploadedVideoPlayback();
    else if (isMediaInputShape(value) && runtime.media.video && state.videoIsPlaying) startVideoProcessingLoop();
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
}

function bindThemeControls() {
    loadThemePreferences();
    applyTheme(state.themeId, { preserveGridColors: true });
    bindControlListener('themeSelectorBtn', 'click', openThemeModal);
    bindControlListener('resetWorkspaceLayoutBtn', 'click', resetAllPanelLayouts);
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

export function handleFullScreenToggle(planeType, index = 0) {
    const isZ = planeType === 'z';
    setPlaneFullscreen(isZ, !isPlaneFullscreen(isZ), index);
    setupVisualParameters(false, false);
    laterFrame(() => window.dispatchEvent(new Event('resize')), isPlaneFullscreen(isZ) ? 100 : 50);
    requestDomainRedraw(true);
}

function bindAlgebraicChainingControls() {
    bindControlListener('enableAlgebraicChainingCb', 'change', event => {
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
            state.currentFunction = enabled ? 'algebraic_chaining' : (algebraicChainingSourceFunction || 'cos');
            if (state.realPlotsEnabled) {
                updateCategoryNavState('real_plots');
            } else {
                setActiveFunctionButton(enabled ? 'custom_complex' : state.currentFunction);
            }
            if (!enabled) algebraicChainingSourceFunction = null;

            requestAlgebraicRedraw();
    });

    bindControlListener('addAlgebraicTermBtn', 'click', () => {
        appendAlgebraicTerm();
    });

    const updateAlgebraicZExpression = (_event, input) => {
        const value = String(input?.value ?? '').trim() || 'z';
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
    bindPalettePanel('view_palette_circle_btn', 'domain_palette_circle_panel');
}

function bindSurfacePaletteCirclePanelListeners() {
    bindPalettePanel('view_real_plots_palette_circle_btn', 'real_plots_palette_circle_panel');
}

function bindPalettePanel(viewButtonId, panelId) {
    registerUiAction(controlKeyFromId(viewButtonId), 'click', () => {
        if (panelId === 'domain_palette_circle_panel') state.domainPaletteGuideVisible = true;
        else state.surfacePaletteGuideVisible = true;
    });
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
        requestUiRedraw();
    });

    bindCheckbox('enableGraphTraceCb', 'graphTraceEnabled', () => requestUiRedraw());
    bindFullscreenPanelToggle('toggleFullscreenGraphBtn', {
        stateKey: 'isGraphFullScreen',
        onResize: () => {
            resizeTransformationGraphRenderer();
            requestUiRedraw();
        }
    });
}

function bindRealPlotsExpressionControls({ preset, input, expressionKey, customKey }) {
    const errorKey = `${expressionKey.slice(0, -4)}Error`;

    const commit = (source, custom) => {
        const value = String(source ?? '').trim();
        const error = validateRealPlotExpression(value);
        state[errorKey] = error || '';
        if (error) {
            return false;
        }
        state[expressionKey] = value;
        state[customKey] = custom;
        requestUiRedraw();
        return true;
    };

    bindControlListener(preset, 'change', (_event, selector) => {
        const custom = selector.value === 'custom';
        commit(custom ? state[expressionKey] : selector.value, custom);
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
        stateKey: 'isContour2DFullScreen',
        onResize: () => {
            setupVisualParameters(false, false);
            requestUiRedraw();
        }
    });
}
