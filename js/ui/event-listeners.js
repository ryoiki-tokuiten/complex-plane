import { state, context, subscribeState, mutateState, zPlaneParams, wPlaneParams, wPlaneInitialRanges, sphereViewParams, sliderParamKeys } from '../store/state.js';
import { runtime } from '../store/runtime.js';
import { eventBus } from '../store/events.js';
import { setupVisualParameters, updateChainingColumns, updateChainingTitles } from '../utils/dom-utils.js';
import { processUploadedImageSource, loadUploadedVideoFile, toggleUploadedVideoPlayback, pauseUploadedVideoPlayback, startVideoProcessingLoop, syncVideoPlaybackUI, getRasterSourceForShape, isRasterInputShape } from '../utils/raster-media.js';
import { updatePlaneViewportRanges, mapCanvasToWorldCoords } from '../utils/canvas-utils.js';
import {
    anchorPreciseViewport,
    leavePreciseViewport,
    panPreciseViewport,
    synchronizePreciseViewport,
    zoomPreciseViewportAt,
    shouldBePrecise
} from '../native/precise-viewport.js';
import { requestRedrawAll } from '../rendering/redraw-scheduler.js';
import { updateFourierTransform } from '../analysis/fourier-transform.js';
import { updateLaplaceTransform, updateLaplaceEvaluationPoint } from '../analysis/laplace-transform.js';
import { ZOOM_IN_FACTOR, ZOOM_OUT_FACTOR, MIN_STATE_ZOOM_LEVEL, MAX_STATE_ZOOM_LEVEL } from '../constants/numerical.js';
import {
    SPHERE_SENSITIVITY,
    SPHERE_INITIAL_ROT_X,
    SPHERE_INITIAL_ROT_Y,
    ORBIT_COLORING_MODES,
    normalizeOrbitColoringMode
} from '../constants/rendering.js';
import { syncLaplacePlayPauseButton, syncTaylorSeriesCenterStatus, updateDomainColoringKey, syncParameterControlsPanelVisibility, syncRiemannTransformationUI, syncTransformControlPanels, updateCustomFormulaPreview } from './ui-updates.js';
import { syncGridDensityControls } from './grid-density-controls.js';
import { stopLaplaceAnimation, toggleLaplaceAnimation, resetLaplaceAnimation, showFullLaplaceSpiral } from '../rendering/laplace-animation.js';
import { toggleRiemannTransformationAnimationZ, toggleRiemannTransformationAnimationW, syncRiemannTransformationPlayPauseButton } from '../rendering/riemann-transformation-animation.js';
import { setNavigationModeEnabled, followNavigationViewports, resetNavigationVehicle, setNavigationKey, stopNavigationLoop, initializeNavigationStateFromControls } from '../navigation-plane.js';
import { toggleAnimation } from './animation.js';
import { initializePolynomialCoeffs } from './polynomial-ui.js';
import { updateLaplace3DSurface, resizeLaplace3DSurface } from '../rendering/laplace-3d-surface.js';
import { getRiemannSurfaceCanvas, resetRiemannSurfaceViews } from '../rendering/webgl-riemann-surface.js';
import { applyTheme, domainPalettes, realPlotsPalettes, loadThemePreferences, persistThemePreferences } from './theme-manager.js';
import { applyFractalPreset, isFractalPresetKey } from '../analysis/fractal-presets.js';
import {
    initializeDynamicPlottingUI,
    syncDynamicPlottingUI
} from './dynamic-plotting-ui.js';
import { domainColorForValue } from '../rendering/domain-coloring.js';
import { resolveActiveMap } from '../math/active-map.js';
import {
    disposeTransformationGraphRenderer,
    isFullGridPerspectiveSupported,
    isGraphViewSupported,
    resizeTransformationGraphRenderer,
    selectGraphInputFromCanvasPoint
} from '../rendering/transformation-graph.js';
import {
    generateTissotIndicatrices,
    selectStableTissotIndicatrices,
    getTissotViewportBounds
} from '../analysis/tissot.js';
import { disposeRealPlotsRenderer, validateRealPlotExpression } from '../rendering/real-plots-renderer.js';
import { appendAlgebraicTerm } from '../frontend/components/algebraic-term-editor.jsx';
import { openThemeModal } from '../frontend/components/theme-modal.jsx';
import { isFoldableInputShape } from '../rendering/shape-generators.js';
import { findPreimages } from '../analysis/preimage.js';
import { continuationSheetForPath, evaluateOnSheet } from '../analysis/branch-continuation.js';

const { controls = {} } = context;

let zCanvas;
let wCanvas;
let uiEventListenersBound = false;
let transformViewportSnapshot = null;
let algebraicChainingSourceFunction = null;
let fractalRestoreSnapshot = null;

const FRACTAL_RESTORE_KEYS = [
    'currentFunction', 'currentFunctionPreset', 'algebraicChainingEnabled', 'chainingEnabled',
    'chainingMode', 'chainCount', 'orbitColoringMode', 'domainColoringEnabled',
    'currentInputShape', 'domainPalette', 'polynomialN', 'polynomialCoeffs',
    'algebraicChainingTerms'
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
    ctx.pendingSphereMove = createPointerSnapshot();
    ctx.clickStart = { x: 0, y: 0 };
    ctx.hasDragged = false;
    ctx.hasFreshRect = false;

    if (ctx.canvas) canvasContextByElement.set(ctx.canvas, ctx);
    return ctx;
}

const COMPLEX_PARTS = ['re', 'im'];
const MOBIUS_PARAMS = ['A', 'B', 'C', 'D'];

const DOMAIN_DIRTY_STATE_KEYS = new Set([
    'a0', 'b0', 'circleR', 'ellipseA', 'ellipseB',
    'imageSize', 'imageOpacity', 'videoSize', 'videoOpacity', 'vectorFieldScale',
    'zPlaneZoom', 'wPlaneZoom', 'fractionalPowerN', 'threeSphereOpacity', 'sphereGridOpacity'
]);

const BASIC_SLIDER_BINDINGS = [
    ['gridDensitySlider', 'gridDensity', parseInteger],
    ['riemannSurfaceResolutionSlider', 'riemannSurfaceResolution', parseInteger],
    ['neighborhoodSizeSlider', 'probeNeighborhoodSize'],
    ['vectorFieldScaleSlider', 'vectorFieldScale'],
    ['vectorArrowThicknessSlider', 'vectorArrowThickness'],
    ['vectorArrowHeadSizeSlider', 'vectorArrowHeadSize'],
    ['streamlineStepSizeSlider', 'streamlineStepSize'],
    ['streamlineMaxLengthSlider', 'streamlineMaxLength', parseInteger],
    ['streamlineThicknessSlider', 'streamlineThickness'],
    ['streamlineSeedDensityFactorSlider', 'streamlineSeedDensityFactor'],
    ['radialDiscreteStepsCountSlider', 'radialDiscreteStepsCount', parseInteger],
    ['threeSphereOpacitySlider', 'threeSphereOpacity'],
    ['sphereGridOpacitySlider', 'sphereGridOpacity'],
    ['taylorSeriesOrderSlider', 'taylorSeriesOrder', parseInteger],
    ['particleDensitySlider', 'particleDensity', parseInteger],
    ['particleSpeedSlider', 'particleSpeed'],
    ['particleMaxLifetimeSlider', 'particleMaxLifetime', parseInteger],
    ['imageSizeSlider', 'imageSize'],
    ['imageOpacitySlider', 'imageOpacity'],
    ['videoFpsSlider', 'videoProcessingFps', parseInteger],
    ['videoSizeSlider', 'videoSize'],
    ['videoOpacitySlider', 'videoOpacity'],
    ['laplaceAnimationSpeedSlider', 'laplaceAnimationSpeed'],
    ['fourierFrequencySlider', 'fourierFrequency'],
    ['fourierAmplitudeSlider', 'fourierAmplitude'],
    ['fourierTimeWindowSlider', 'fourierTimeWindow'],
    ['fourierSamplesSlider', 'fourierSamples', parseInteger],
    ['fourierWindingFrequencySlider', 'fourierWindingFrequency'],
    ['fourierWindingTimeSlider', 'fourierWindingTime'],
    ['laplaceFrequencySlider', 'laplaceFrequency'],
    ['laplaceDampingSlider', 'laplaceDamping'],
    ['laplaceSigmaSlider', 'laplaceSigma'],
    ['laplaceOmegaSlider', 'laplaceOmega'],
    ['laplaceClipHeightSlider', 'laplaceClipHeight'],
    ['riemannSurfaceSheetsSlider', 'riemannSurfaceSheets', parseInteger],
    ['riemannSurfaceBranchCenterSlider', 'riemannSurfaceBranchCenter', parseInteger],
    ['riemannSurfaceHeightScaleSlider', 'riemannSurfaceHeightScale'],
    ['gridSurface3DHeightScaleSlider', 'foldSurfaceHeightScale'],
    ['imageSurface3DHeightScaleSlider', 'foldSurfaceHeightScale'],
    ['videoSurface3DHeightScaleSlider', 'foldSurfaceHeightScale'],
    ['riemannSurfaceHeightClipSlider', 'riemannSurfaceHeightClip']
].map(([controlKey, stateKey, parser = parseFloat]) => ({ controlKey, stateKey, parser }));

const BASIC_CHECKBOX_BINDINGS = [
    ['showZerosPolesCb', 'showZerosPoles'],
    ['showCriticalPointsCb', 'showCriticalPoints'],
    ['enableCauchyIntegralModeCb', 'cauchyIntegralModeEnabled'],
    ['enableSplitViewCb', 'splitViewEnabled'],
    ['enableVectorFieldCb', 'vectorFieldEnabled'],
    ['enableStreamlineFlowCb', 'streamlineFlowEnabled'],
    ['enableRadialDiscreteStepsCb', 'radialDiscreteStepsEnabled'],
    ['enableRiemannSphereCb', 'riemannSphereViewEnabled'],
    ['enableThreeSphereCb', 'threeSphereEnabled'],
    ['enableRiemannTransformationCb', 'riemannTransformationEnabled'],
    ['enableTaylorSeriesCb', 'taylorSeriesEnabled'],
    ['enableTaylorSeriesCustomCenterCb', 'taylorSeriesCustomCenterEnabled'],
    ['laplaceShowRocCb', 'laplaceShowROC'],
    ['laplaceShowPolesZerosCb', 'laplaceShowPolesZeros'],
    ['laplaceShowFourierLineCb', 'laplaceShowFourierLine'],
    ['laplaceAnimationLoopCb', 'laplaceAnimationLoop'],
    ['enableParticleAnimationCb', 'particleAnimationEnabled'],
    ['enableDomainColoringCb', 'domainColoringEnabled'],
    ['enableRiemannSurfaceCb', 'riemannSurfaceEnabled'],
    ['riemannSurfaceWireframeCb', 'riemannSurfaceWireframe'],
    ['arbitraryShapeClosedCb', 'arbitraryShapeClosed']
].map(([controlKey, stateKey]) => ({ controlKey, stateKey }));

const BASIC_SELECTOR_BINDINGS = [
    ['inputShapeSelector', 'currentInputShape'],
    ['vectorFieldFunctionSelector', 'vectorFieldFunction'],
    ['fourierFunctionSelector', 'fourierFunction'],
    ['laplaceFunctionSelector', 'laplaceFunction'],
    ['laplaceVizModeSelector', 'laplaceVizMode'],
    ['riemannSurfaceComponentSelector', 'riemannSurfaceComponent']
].map(([controlKey, stateKey]) => ({ controlKey, stateKey }));

const SPECIAL_SLIDERS = new Set([
    'vectorFieldScaleSlider', 'vectorArrowThicknessSlider', 'vectorArrowHeadSizeSlider',
    'streamlineStepSizeSlider', 'streamlineMaxLengthSlider', 'streamlineThicknessSlider',
    'streamlineSeedDensityFactorSlider', 'particleDensitySlider', 'particleSpeedSlider',
    'particleMaxLifetimeSlider', 'imageSizeSlider', 'imageOpacitySlider',
    'videoFpsSlider', 'videoSizeSlider', 'videoOpacitySlider',
    'zPlaneZoomSlider', 'wPlaneZoomSlider', 'taylorSeriesOrderSlider',
    'radialDiscreteStepsCountSlider', 'laplaceAnimationSpeedSlider',
    'fourierFrequencySlider', 'fourierAmplitudeSlider', 'fourierTimeWindowSlider',
    'fourierSamplesSlider', 'fourierWindingFrequencySlider', 'fourierWindingTimeSlider',
    'laplaceFrequencySlider', 'laplaceDampingSlider', 'laplaceSigmaSlider',
    'laplaceOmegaSlider', 'laplaceClipHeightSlider'
]);

const SPECIAL_CHECKBOXES = new Set([
    'enableSplitViewCb', 'enableVectorFieldCb', 'enableStreamlineFlowCb',
    'enableRadialDiscreteStepsCb', 'enableRiemannSphereCb', 'enableRiemannSurfaceCb',
    'enableThreeSphereCb', 'enableTaylorSeriesCb', 'enableTaylorSeriesCustomCenterCb',
    'laplaceShowRocCb', 'laplaceShowPolesZerosCb',
    'laplaceShowFourierLineCb', 'laplaceAnimationLoopCb', 'enableParticleAnimationCb',
    'enableDomainColoringCb', 'enableCauchyIntegralModeCb'
]);

const SPECIAL_SELECTORS = new Set([
    'inputShapeSelector',
    'vectorFieldFunctionSelector',
    'fourierFunctionSelector',
    'laplaceFunctionSelector',
    'laplaceVizModeSelector'
]);

const SPHERE_VIEW_BUTTONS = {
    sphereViewNorthBtn: { rotX: -Math.PI / 2 + 0.01, rotY: 0 },
    sphereViewSouthBtn: { rotX: Math.PI / 2 - 0.01, rotY: 0 },
    sphereViewEastBtn: { rotX: 0, rotY: -Math.PI / 2 },
    sphereViewWestBtn: { rotX: 0, rotY: Math.PI / 2 },
    sphereViewFrontBtn: { rotX: 0, rotY: 0 },
    sphereViewResetBtn: { rotX: SPHERE_INITIAL_ROT_X, rotY: SPHERE_INITIAL_ROT_Y }
};

const BINDERS = [
    bindBaseParameterControls,
    bindAlgebraicChainingControls,
    bindDynamicPlottingControls,
    bindMobiusControls,
    bindFunctionButtons,
    bindImageControls,
    bindVideoControls,
    bindPolynomialControls,
    bindDerivativeControls,
    bindConformalGridControls,
    bindDomainColoringControls,
    bindViewControls,
    bindNavigationControls,
    bindVectorFieldControls,
    bindTaylorControls,
    bindRadialAndZetaControls,
    bindParticleControls,
    bindFourierControls,
    bindLaplaceControls,
    bindCollapseControls,
    bindChainingControls,
    bindSimpleControlRemainder,
    bindCanvasInteractions,
    bindCanvasRectInvalidation,
    bindTopControlsToggle,
    bindFullscreenControls,
    bindThemeControls,
    bindDomainPaletteCirclePanelListeners,
    bindRealPlotsPaletteCirclePanelListeners,
    bindGraphControls,
    bindRealPlotsControls,
    bindContourControls,
    bindRequestedExplorerControls
];

function syncPreimageCheckboxes(value) {
    for (const key of ['gridPreimageExplorerCb', 'imagePreimageExplorerCb', 'videoPreimageExplorerCb']) {
        if (controls[key]) controls[key].checked = value;
    }
}

function bindRequestedExplorerControls() {
    for (const key of ['gridPreimageExplorerCb', 'imagePreimageExplorerCb', 'videoPreimageExplorerCb']) {
        bindControlListener(key, 'change', (_event, checkbox) => {
            state.preimageExplorerEnabled = checkbox.checked;
            if (!checkbox.checked) {
                state.preimageTarget = null;
                state.preimageRoots = [];
                state.preimageStatus = '';
            }
            syncPreimageCheckboxes(checkbox.checked);
            requestUiRedraw();
        });
    }
    bindCheckbox('enableCauchyIntegralModeCb', 'cauchyIntegralModeEnabled', (_event, enabled) => {
        syncParameterControlsPanelVisibility();
        requestUiRedraw();
    });
    const setArbitraryShapeMode = mode => {
        state.arbitraryShapeMode = mode === 'draw' ? 'draw' : 'parametric';
        syncParameterControlsPanelVisibility();
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
        syncParameterControlsPanelVisibility();
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

function bindDynamicPlottingControls() {
    initializeDynamicPlottingUI({
        requestRedraw: markDomainDirty => requestDomainRedraw(markDomainDirty)
    });
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
    return typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(callback)
        : setTimeout(callback, DEFAULT_FRAME_DELAY);
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
    const normalized = normalizeOrbitColoringMode(mode);
    state.orbitColoringMode = normalized;
    if (controls.orbitColoringModeSelect) controls.orbitColoringModeSelect.value = normalized;
}

function resetOrbitColoringMode() {
    setOrbitColoringMode(ORBIT_COLORING_MODES.value);
}

function syncOrbitColoringModeControl() {
    const normalized = normalizeOrbitColoringMode(state.orbitColoringMode);
    state.orbitColoringMode = normalized;
    if (controls.orbitColoringModeSelect) controls.orbitColoringModeSelect.value = normalized;
    hidden(controls.orbitColoringModeGroup, !(state.domainColoringEnabled && state.chainingEnabled));
}

function syncDomainColoringKeyVisibility() {
    hidden(
        controls.domainColoringKey,
        !state.domainColoringEnabled || !state.domainColoringKeyVisible
    );
}

function parseControlValue(control, parser = parseFloat, fallback = 0) {
    if (!control) return fallback;
    const value = parser(control.value);
    return typeof value === 'number' && Number.isNaN(value) ? fallback : value;
}

function bindElementListener(element, eventName, handler, options) {
    if (!element) return;

    element.addEventListener(eventName, event => {
        try {
            handler(event, element);
        } catch (error) {
            console.error(`Error in ${element.id || element.nodeName || 'element'} ${eventName} listener:`, error);
        }
    }, options);
}

function bindControlListener(controlKey, eventName, handler, options) {
    bindElementListener(controls[controlKey], eventName, handler, options);
}

function readSliderState(controlKey, stateKey, parser = parseFloat) {
    const control = controls[controlKey];
    if (control) state[stateKey] = parseControlValue(control, parser, state[stateKey]);
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
        state[stateKey] = parseControlValue(slider, parser, state[stateKey]);

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
    BASIC_SLIDER_BINDINGS
        .filter(({ controlKey }) => !SPECIAL_SLIDERS.has(controlKey))
        .forEach(({ controlKey, stateKey, parser }) => bindSlider(controlKey, stateKey, parser));

    BASIC_CHECKBOX_BINDINGS
        .filter(({ controlKey }) => !SPECIAL_CHECKBOXES.has(controlKey))
        .forEach(({ controlKey, stateKey }) => bindCheckbox(controlKey, stateKey));

    BASIC_SELECTOR_BINDINGS
        .filter(({ controlKey }) => !SPECIAL_SELECTORS.has(controlKey))
        .forEach(({ controlKey, stateKey }) => bindSelector(controlKey, stateKey));
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
    if (markDomainDirty) context.domainColoringDirty = true;
    requestRedrawAll();

    if (refreshPalettePanel) {
        pendingPalettePanelRefresh = true;
        if (!palettePanelFrameId) palettePanelFrameId = frame(flushPalettePanelRefresh);
    }
}

function requestUiRedraw() {
    scheduleRedraw(false, false);
}

export function requestDomainRedraw(markDomainDirty = false) {
    scheduleRedraw(markDomainDirty, isDomainPalettePanelOpen());
}

function requestAlgebraicRedraw() {
    requestDomainRedraw(!(state.riemannSurfaceEnabled || state.realPlotsEnabled));
}

export function setActiveFunctionButton(activeKey) {
    Object.entries(controls.funcButtons || {}).forEach(([key, button]) => {
        if (!button) return;
        const active = key === activeKey;
        button.classList.toggle('active', active);
        button.classList.toggle('btn-primary', active);
        button.classList.toggle('btn-outline-secondary', !active);
    });
}

function updateModePanels() {
    syncTransformControlPanels();
    syncLaplacePlayPauseButton();
    syncParameterControlsPanelVisibility();
}

function disableAlgebraicChaining() {
    if (!state.algebraicChainingEnabled) {
        algebraicChainingSourceFunction = null;
        return;
    }

    state.algebraicChainingEnabled = false;
    algebraicChainingSourceFunction = null;
    checked('enableAlgebraicChainingCb', false);
    display(controls.algebraicChainingControlsContainer, false);
}

function disableOutputChaining() {
    if (!state.chainingEnabled) return;

    state.chainingEnabled = false;
    checked('enableChainingCb', false);
    display(controls.chainingControlsContainer, false);
    updateChainingColumns(1);
}

function restoreRealPlotsLayout() {
    const dynamicParams = $('dynamic_plotting_params');
    const algParams = $('algebraic_chaining_params');
    const chainParams = $('chaining_params');
    if (dynamicParams && algParams && chainParams) {
        dynamicParams.parentNode.insertBefore(chainParams, dynamicParams);
        dynamicParams.parentNode.insertBefore(algParams, dynamicParams);
    }

    hidden(controls.zPlaneColumn, false);
    hidden(controls.wPlaneColumn, false);
}

function refreshPlanesAfterLayoutChange() {
    const refresh = () => {
        setupVisualParameters(false, false);
        requestUiRedraw();
    };
    requestAnimationFrame(() => {
        refresh();
        setTimeout(refresh, 360);
    });
}

function disableRealPlots() {
    if (!state.realPlotsEnabled) return;
    state.realPlotsEnabled = false;
    checked('enableRealPlotsCb', false);
    hidden(controls.realPlotsControlsContainer, true);
    hidden(controls.realPlotsColumn, true);
    if (!state.riemannSurfaceEnabled) {
        state.show2DContourPlot = false;
        hidden(controls.contour2DColumn, true);
    }
    disposeRealPlotsRenderer();
    restoreRealPlotsLayout();
    refreshPlanesAfterLayoutChange();
}

function disableGraphView() {
    state.graphViewEnabled = false;
    state.graphFullGridEnabled = false;
    state.graphLayerLockEnabled = false;
    state.graphFourierEnabled = false;
    state.graphTraceEnabled = false;
    state.graphSelectedShape = '';
    checked('enableGraphViewCb', false);
    checked('viewFullGridPerspectiveBtn', false);
    checked('enableGraphLayerLockCb', false);
    checked('enableGraphFourierCb', false);
    checked('enableGraphTraceCb', false);
    syncGridDensityControls();

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
    checked('enableChainingCb', state.chainingEnabled);
    display(controls.chainingControlsContainer, state.chainingEnabled);
    if (controls.chainModeSelector) controls.chainModeSelector.value = state.chainingMode;
    if (controls.chainCountSlider) controls.chainCountSlider.value = state.chainCount;
    if (controls.chainCountValueDisplay) controls.chainCountValueDisplay.textContent = state.chainCount;
    updateChainingColumns(state.chainingEnabled ? state.chainCount : 1);
    updateChainingTitles();
}

function syncAlgebraicControlsFromState() {
    checked('enableAlgebraicChainingCb', state.algebraicChainingEnabled);
    display(controls.algebraicChainingControlsContainer, state.algebraicChainingEnabled);
}

function syncDomainControlsFromState() {
    checked('enableDomainColoringCb', state.domainColoringEnabled);
    checked('showDomainColoringKeyCb', state.domainColoringKeyVisible);
    hidden(controls.domainColoringOptionsDiv, !state.domainColoringEnabled);
    syncDomainColoringKeyVisibility();
    syncOrbitColoringModeControl();
    updateDomainColoringKey();
}

function syncInputShapeControlFromState() {
    if (controls.inputShapeSelector) controls.inputShapeSelector.value = state.currentInputShape;
}

function cloneRestoreValue(value) {
    if (Array.isArray(value)) return value.map(cloneRestoreValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneRestoreValue(entry)]));
    }
    return value;
}

function captureFractalState() {
    return Object.fromEntries(FRACTAL_RESTORE_KEYS.map(key => [key, cloneRestoreValue(state[key])]));
}

function restoreFractalState(nextFunction) {
    const snapshot = fractalRestoreSnapshot;
    if (!snapshot) return false;

    fractalRestoreSnapshot = null;
    FRACTAL_RESTORE_KEYS.forEach(key => {
        if (key !== 'currentFunction' && key !== 'currentFunctionPreset') {
            state[key] = cloneRestoreValue(snapshot[key]);
        }
    });
    state.currentFunction = nextFunction;
    state.currentFunctionPreset = null;
    syncChainingControlsFromState();
    syncAlgebraicControlsFromState();
    syncDomainControlsFromState();
    syncInputShapeControlFromState();
    return true;
}

function activateFractalPreset(key) {
    const leavingTransform = state.fourierModeEnabled || state.laplaceModeEnabled;
    if (state.laplaceModeEnabled) stopLaplaceAnimation();

    if (!fractalRestoreSnapshot) fractalRestoreSnapshot = captureFractalState();
    const preset = applyFractalPreset(state, key);
    if (!preset) return false;

    if (leavingTransform) restoreNormalViewports();
    syncChainingControlsFromState();
    syncAlgebraicControlsFromState();
    syncDomainControlsFromState();
    syncInputShapeControlFromState();
    updateModePanels();
    setActiveFunctionButton(key);
    syncParameterControlsPanelVisibility();
    if (state.dynamicPlotting?.enabled) syncDynamicPlottingUI();
    requestDomainRedraw(true);
    return true;
}

function setPlaneViewport(planeParams, xRange, yRange) {
    const xSpan = Math.max(1e-6, xRange[1] - xRange[0]);
    const ySpan = Math.max(1e-6, yRange[1] - yRange[0]);
    const scale = Math.min(planeParams.width / xSpan, planeParams.height / ySpan);
    const centerX = (xRange[0] + xRange[1]) * 0.5;
    const centerY = (yRange[0] + yRange[1]) * 0.5;
    const targetXRange = planeParams.currentVisXRange || planeParams.xRange;
    const targetYRange = planeParams.currentVisYRange || planeParams.yRange;

    targetXRange[0] = xRange[0];
    targetXRange[1] = xRange[1];
    targetYRange[0] = yRange[0];
    targetYRange[1] = yRange[1];
    planeParams.scale.x = planeParams.scale.y = scale;
    planeParams.origin.x = planeParams.width * 0.5 - centerX * scale;
    planeParams.origin.y = planeParams.height * 0.5 + centerY * scale;
    updatePlaneViewportRanges(planeParams);
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
            xRange: copyRange(wPlaneParams.xRange),
            yRange: copyRange(wPlaneParams.yRange)
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
        wPlaneParams.xRange.splice(0, 2, ...snapshot.w.xRange);
        wPlaneParams.yRange.splice(0, 2, ...snapshot.w.yRange);
    }

    state.zPlaneZoom = snapshot.zZoom;
    state.wPlaneZoom = snapshot.wZoom;
    if (controls.zPlaneZoomSlider) controls.zPlaneZoomSlider.value = String(Math.log10(snapshot.zZoom || 1));
    if (controls.wPlaneZoomSlider) controls.wPlaneZoomSlider.value = String(Math.log10(snapshot.wZoom || 1));
}

function fitTransformViewports() {
    const signal = state.fourierModeEnabled
        ? state.fourierTimeDomainSignal
        : state.laplaceTimeDomainSignal;
    if (!signal?.length) return;

    setupVisualParameters(false, false);
    const timeWindow = Math.max(1, signal.at(-1)?.t || state.fourierTimeWindow || 5);
    const amplitude = Math.max(1, ...signal.map(point => Math.abs(point.value)));
    const timePadding = Math.max(0.25, timeWindow * 0.06);
    const amplitudePadding = Math.max(0.35, amplitude * 0.24);

    setPlaneViewport(
        zPlaneParams,
        [-timePadding, timeWindow + timePadding],
        [-amplitude - amplitudePadding, amplitude + amplitudePadding]
    );

    let windingRadius = amplitude * 1.35;
    if (state.laplaceModeEnabled) {
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
    }
    windingRadius = Math.max(1, windingRadius * 1.35);
    setPlaneViewport(wPlaneParams, [-windingRadius, windingRadius], [-windingRadius, windingRadius]);

    state.zPlaneZoom = 1;
    state.wPlaneZoom = 1;
    if (controls.zPlaneZoomSlider) controls.zPlaneZoomSlider.value = '0';
    if (controls.wPlaneZoomSlider) controls.wPlaneZoomSlider.value = '0';
}

function activateFunctionMode(key) {
    disableRealPlots();
    if (isFractalPresetKey(key) && activateFractalPreset(key)) return;

    const restoringFractalState = Boolean(fractalRestoreSnapshot);
    if (restoringFractalState) restoreFractalState(key);

    const enteringFourier = key === 'fourier';
    const enteringLaplace = key === 'laplace';
    const enteringTransform = enteringFourier || enteringLaplace;
    const leavingTransform = (state.fourierModeEnabled || state.laplaceModeEnabled) && !enteringTransform;

    if (state.laplaceModeEnabled && !enteringLaplace) stopLaplaceAnimation();
    if (enteringTransform && state.currentInputShape === 'video') pauseUploadedVideoPlayback();

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
    state.fourierModeEnabled = enteringFourier;
    state.laplaceModeEnabled = enteringLaplace;

    if (enteringTransform && state.navigationModeEnabled) setNavigationModeEnabled(false);
    if (enteringFourier) updateFourierTransform();

    if (enteringLaplace) {
        updateLaplaceTransform();
        showFullLaplaceSpiral();
    }

    if (enteringTransform) fitTransformViewports();
    else if (leavingTransform) restoreNormalViewports();

    updateModePanels();
    setActiveFunctionButton(key);
    if (state.dynamicPlotting?.enabled) syncDynamicPlottingUI();
    requestDomainRedraw(true);
}

function readImageFile(file, callback) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
        const img = new Image();
        img.onload = () => callback(img);
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function processUploadedImage(img) {
    if (processUploadedImageSource(img)) requestDomainRedraw(true);
}

function complexState(key) {
    return state[key] || (state[key] = { re: 0, im: 0 });
}

function initializeMobiusState() {
    MOBIUS_PARAMS.forEach(param => {
        const stateKey = `mobius${param}`;
        const value = { ...complexState(stateKey) };
        COMPLEX_PARTS.forEach(part => {
            const slider = controls[`mobius${param}${part === 're' ? 'Re' : 'Im'}Slider`];
            if (slider) value[part] = parseControlValue(slider, parseFloat, value[part]);
        });
        state[stateKey] = value;
    });
}

function initializeScalarBindings() {
    sliderParamKeys.forEach(key => readSliderState(`${key}Slider`, key));
    BASIC_SLIDER_BINDINGS.forEach(({ controlKey, stateKey, parser }) => readSliderState(controlKey, stateKey, parser));
    BASIC_CHECKBOX_BINDINGS.forEach(({ controlKey, stateKey }) => readCheckboxState(controlKey, stateKey));
    BASIC_SELECTOR_BINDINGS.forEach(({ controlKey, stateKey }) => readSelectorState(controlKey, stateKey));
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

function bindMobiusControls() {
    MOBIUS_PARAMS.forEach(param => COMPLEX_PARTS.forEach(part => {
        const stateKey = `mobius${param}`;
        const partKey = part === 're' ? 'Re' : 'Im';
        const sliderKey = `mobius${param}${partKey}Slider`;

        bindControlListener(sliderKey, 'input', (_event, slider) => {
            state[stateKey] = {
                ...complexState(stateKey),
                [part]: parseControlValue(slider, parseFloat, 0)
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
    Object.entries(controls.funcButtons || {}).forEach(([key, button]) => {
        bindElementListener(button, 'click', () => activateFunctionMode(key));
    });
}

function firstFile(event) {
    return event.target.files && event.target.files[0];
}

function bindImageControls() {
    bindControlListener('imageUploadInput', 'change', event => {
        const file = firstFile(event);
        if (file) readImageFile(file, processUploadedImage);
    });

    bindSlider('imageSizeSlider', 'imageSize', parseFloat, () => requestDomainRedraw(true));
    bindSlider('imageOpacitySlider', 'imageOpacity', parseFloat, () => requestDomainRedraw(true));
}

function bindVideoControls() {
    bindControlListener('videoUploadInput', 'change', event => {
        const file = firstFile(event);
        if (file) loadUploadedVideoFile(file);
    });

    bindControlListener('videoPlayPauseBtn', 'click', () => toggleUploadedVideoPlayback());

    bindSlider('videoFpsSlider', 'videoProcessingFps', parseInteger, () => {
        syncVideoPlaybackUI();
        if (state.videoIsPlaying && state.currentInputShape === 'video') startVideoProcessingLoop();
        requestUiRedraw();
    });
    bindSlider('videoSizeSlider', 'videoSize', parseFloat, () => requestDomainRedraw(true));
    bindSlider('videoOpacitySlider', 'videoOpacity', parseFloat, () => requestDomainRedraw(true));
}

function bindDomainColoringControls() {
    bindCheckbox('enableDomainColoringCb', 'domainColoringEnabled', () => {
        if (state.domainColoringEnabled) {
            if (state.riemannSphereViewEnabled) {
                state.riemannSphereViewEnabled = false;
                checked('enableRiemannSphereCb', false);
                state.riemannTransformationEnabled = false;
                checked('enableRiemannTransformationCb', false);
                hidden(controls.threeSphereOptionsDiv, true);
                hidden(controls.riemannSphereOptionsDiv, true);
                syncRiemannTransformationUI();
                updateChainingTitles();
            }
            if (state.riemannTransformationEnabled) {
                state.riemannTransformationEnabled = false;
                checked('enableRiemannTransformationCb', false);
                syncRiemannTransformationUI();
            }
            if (state.currentInputShape !== 'empty_grid') {
                if (state.currentInputShape === 'video' && state.videoIsPlaying) {
                    pauseUploadedVideoPlayback();
                }
                state.currentInputShape = 'empty_grid';
                if (controls.inputShapeSelector) controls.inputShapeSelector.value = 'empty_grid';
            }
        }
        hidden(controls.domainColoringOptionsDiv, !state.domainColoringEnabled);
        syncDomainColoringKeyVisibility();
        syncOrbitColoringModeControl();
        requestDomainRedraw(true);
    });

    bindCheckbox('showDomainColoringKeyCb', 'domainColoringKeyVisible', () => {
        syncDomainColoringKeyVisibility();
        requestUiRedraw();
    });
    checked('showDomainColoringKeyCb', state.domainColoringKeyVisible);

    syncOrbitColoringModeControl();
    bindElementListener(controls.orbitColoringModeSelect, 'change', event => {
        setOrbitColoringMode(event.target.value);
        state.currentFunctionPreset = null;
        updateDomainColoringKey();
        requestDomainRedraw(true);
    });

    [
        ['grid_color_1_input', 'grid_color_1_picker_wrapper', 'gridColor1'],
        ['grid_color_2_input', 'grid_color_2_picker_wrapper', 'gridColor2']
    ].forEach(([inputId, wrapperId, stateKey]) => {
        bindElementListener($(inputId), 'input', event => {
            state[stateKey] = event.target.value;
            setStyles($(wrapperId), { backgroundColor: state[stateKey] });
            persistThemePreferences();
            requestUiRedraw();
        });
    });

    ['domainBrightness', 'domainContrast', 'domainSaturation', 'domainLightnessCycles']
        .forEach(key => bindSlider(`${key}Slider`, key, parseFloat, () => requestDomainRedraw(true)));
}

function bindDerivativeControls() {
    if (controls.enableDerivativeCb) {
        controls.enableDerivativeCb.checked = state.mapPresentation === 'derivative';
    }

    bindElementListener(controls.enableDerivativeCb, 'change', event => {
        state.mapPresentation = event.target.checked ? 'derivative' : 'function';
        context.domainColoringDirty = true;
        syncRiemannTransformationUI();
        updateChainingTitles();
        requestUiRedraw();
    });
}

function fitConformalGridOutputViewport() {
    const indicatrices = selectStableTissotIndicatrices(generateTissotIndicatrices(
        resolveActiveMap(),
        zPlaneParams.currentVisXRange,
        zPlaneParams.currentVisYRange,
        state.gridDensity,
        72
    ));
    const bounds = getTissotViewportBounds(indicatrices);
    if (!bounds) return;

    setPlaneViewport(wPlaneParams, bounds.xRange, bounds.yRange);

    const span = Math.max(
        bounds.xRange[1] - bounds.xRange[0],
        bounds.yRange[1] - bounds.yRange[0]
    );
    const initialSpan = Math.max(
        wPlaneInitialRanges.x[1] - wPlaneInitialRanges.x[0],
        wPlaneInitialRanges.y[1] - wPlaneInitialRanges.y[0]
    );
    state.wPlaneZoom = clamp(initialSpan / span, MIN_STATE_ZOOM_LEVEL, MAX_STATE_ZOOM_LEVEL);
    if (controls.wPlaneZoomSlider) {
        controls.wPlaneZoomSlider.value = String(Math.log10(state.wPlaneZoom));
    }
}

function bindConformalGridControls() {
    bindCheckbox('enableConformalGridCb', 'conformalGridEnabled', () => {
        if (state.conformalGridEnabled) {
            if (state.currentInputShape === 'video' && state.videoIsPlaying) {
                pauseUploadedVideoPlayback();
            }
            state.currentInputShape = 'empty_grid';
            if (controls.inputShapeSelector) controls.inputShapeSelector.value = 'empty_grid';
            fitConformalGridOutputViewport();
        }
        requestUiRedraw();
    });
}

function disableRiemannSurface() {
    state.riemannSurfaceEnabled = false;
    checked('enableRiemannSurfaceCb', false);
    hidden(controls.riemannSurfaceOptionsDiv, true);
    if (!state.realPlotsEnabled) {
        state.show2DContourPlot = false;
        hidden(controls.contour2DColumn, true);
    }
}

function syncFoldSurfaceControls() {
    checked('gridSurface3DCb', state.foldSurface3dEnabled);
    checked('imageSurface3DCb', state.foldSurface3dEnabled);
    checked('videoSurface3DCb', state.foldSurface3dEnabled);
    hidden(
        controls.gridSurface3DOptions,
        !state.foldSurface3dEnabled || !isFoldableInputShape(state.currentInputShape)
    );
    hidden(
        controls.imageSurface3DOptions,
        !state.foldSurface3dEnabled || state.currentInputShape !== 'image'
    );
    hidden(
        controls.videoSurface3DOptions,
        !state.foldSurface3dEnabled || state.currentInputShape !== 'video'
    );
}

function syncGridFoldDensity(useFoldDefault = false) {
    syncGridDensityControls({ applyFoldDefault: useFoldDefault });
}

function enableFoldSurface3d() {
    disableRiemannSurface();
    if (state.navigationModeEnabled) setNavigationModeEnabled(false);
    Object.assign(state, {
        riemannSphereViewEnabled: false,
        riemannTransformationEnabled: false,
        splitViewEnabled: false,
        threeSphereEnabled: false
    });
    [
        'enableRiemannSphereCb',
        'enableRiemannTransformationCb',
        'enableSplitViewCb',
        'enableThreeSphereCb'
    ].forEach(key => checked(key, false));
    hidden(controls.riemannSphereOptionsDiv, true);
    hidden(controls.threeSphereOptionsDiv, true);
    syncRiemannTransformationUI();
    updateChainingTitles();
}

function bindFoldSurfaceControl(controlKey) {
    bindCheckbox(controlKey, 'foldSurface3dEnabled', () => {
        if (state.foldSurface3dEnabled) enableFoldSurface3d();
        syncGridFoldDensity(controlKey === 'gridSurface3DCb' && state.foldSurface3dEnabled);
        syncFoldSurfaceControls();
        requestDomainRedraw(true);
    });
}

function disableFoldSurface3d() {
    state.foldSurface3dEnabled = false;
    syncGridFoldDensity();
    syncFoldSurfaceControls();
}

function bindViewControls() {
    bindFoldSurfaceControl('gridSurface3DCb');

    bindCheckbox('enableSplitViewCb', 'splitViewEnabled', () => {
        if (state.splitViewEnabled) {
            disableFoldSurface3d();
            if (state.riemannSurfaceEnabled) disableRiemannSurface();
            if (state.riemannTransformationEnabled) {
                state.riemannTransformationEnabled = false;
                checked('enableRiemannTransformationCb', false);
            }
        }
        syncRiemannTransformationUI();
        updateChainingTitles();
        requestDomainRedraw(true);
    });

    [
        ['zPlaneZoomSlider', 'zPlaneZoom', [true, false]],
        ['wPlaneZoomSlider', 'wPlaneZoom', [false, true]]
    ].forEach(([controlKey, stateKey, args]) => bindSlider(controlKey, stateKey, (val) => Math.pow(10, parseFloat(val)), () => {
        setupVisualParameters(...args);
        requestDomainRedraw(true);
    }));

    bindCheckbox('enableRiemannSphereCb', 'riemannSphereViewEnabled', () => {
        if (state.riemannSphereViewEnabled) {
            disableFoldSurface3d();
            if (state.riemannSurfaceEnabled) disableRiemannSurface();

            if (state.domainColoringEnabled) {
                state.domainColoringEnabled = false;
                checked('enableDomainColoringCb', false);
                hidden(controls.domainColoringOptionsDiv, true);
                hidden(controls.domainColoringKey, true);
                state.currentInputShape = 'grid_cartesian';
                if (controls.inputShapeSelector) controls.inputShapeSelector.value = 'grid_cartesian';
            }

            if (!state.threeSphereEnabled) {
                state.threeSphereEnabled = true;
                checked('enableThreeSphereCb', true);
                hidden(controls.threeSphereOptionsDiv, false);
            }
            if (!state.splitViewEnabled) {
                state.splitViewEnabled = true;
                checked('enableSplitViewCb', true);
            }
        } else {
            state.riemannTransformationEnabled = false;
            state.threeSphereEnabled = false;
            state.splitViewEnabled = false;
            checked('enableRiemannTransformationCb', false);
            checked('enableThreeSphereCb', false);
            checked('enableSplitViewCb', false);
            hidden(controls.threeSphereOptionsDiv, true);
        }
        hidden(controls.riemannSphereOptionsDiv, !state.riemannSphereViewEnabled);
        syncRiemannTransformationUI();
        updateChainingTitles();
        requestDomainRedraw(true);
    });

    bindCheckbox('enableThreeSphereCb', 'threeSphereEnabled', () => {
        if (state.threeSphereEnabled) {
            disableFoldSurface3d();
            if (state.riemannTransformationEnabled) {
                state.riemannTransformationEnabled = false;
                checked('enableRiemannTransformationCb', false);
                syncRiemannTransformationUI();
            }
        }
        hidden(controls.threeSphereOptionsDiv, !state.threeSphereEnabled);
        updateChainingTitles();
        requestUiRedraw();
    });

    bindCheckbox('enableRiemannTransformationCb', 'riemannTransformationEnabled', () => {
        if (state.riemannTransformationEnabled) {
            disableFoldSurface3d();
            if (!state.riemannSphereViewEnabled) {
                state.riemannSphereViewEnabled = true;
                checked('enableRiemannSphereCb', true);
                hidden(controls.riemannSphereOptionsDiv, false);
            }
            if (state.riemannSurfaceEnabled) {
                disableRiemannSurface();
            }
            if (state.domainColoringEnabled) {
                state.domainColoringEnabled = false;
                checked('enableDomainColoringCb', false);
                hidden(controls.domainColoringOptionsDiv, true);
                hidden(controls.domainColoringKey, true);
            }
            if (state.splitViewEnabled) {
                state.splitViewEnabled = false;
                checked('enableSplitViewCb', false);
            }
            if (state.threeSphereEnabled) {
                state.threeSphereEnabled = false;
                checked('enableThreeSphereCb', false);
                hidden(controls.threeSphereOptionsDiv, true);
            }
        }
        syncRiemannTransformationUI();
        updateChainingTitles();
        requestDomainRedraw(true);
    });

    bindCheckbox('enableRiemannSurfaceCb', 'riemannSurfaceEnabled', () => {
        if (state.riemannSurfaceEnabled) {
            disableFoldSurface3d();
            disableRealPlots();
            Object.assign(state, { riemannSphereViewEnabled: false, riemannTransformationEnabled: false, splitViewEnabled: false, threeSphereEnabled: false });
            ['enableRiemannSphereCb', 'enableRiemannTransformationCb', 'enableSplitViewCb', 'enableThreeSphereCb'].forEach(key => checked(key, false));
            if (state.navigationModeEnabled) setNavigationModeEnabled(false);
        }

        hidden(controls.riemannSurfaceOptionsDiv, !state.riemannSurfaceEnabled);
        hidden(controls.riemannSphereOptionsDiv, true);
        updateChainingTitles();
        requestDomainRedraw(true);
    });

    const transSliderZ = document.getElementById('z_transformation_progress_slider');
    if (transSliderZ) {
        bindElementListener(transSliderZ, 'input', event => {
            state.riemannTransformationPlayingZ = false;
            state.riemannTransformationProgressZ = parseFloat(event.target.value);
            syncRiemannTransformationPlayPauseButton();
            requestDomainRedraw(true);
        });
    }

    const transPlayPauseBtnZ = document.getElementById('z_transformation_play_pause_btn');
    if (transPlayPauseBtnZ) {
        bindElementListener(transPlayPauseBtnZ, 'click', () => {
            toggleRiemannTransformationAnimationZ();
        });
    }

    const transSliderW = document.getElementById('w_transformation_progress_slider');
    if (transSliderW) {
        bindElementListener(transSliderW, 'input', event => {
            state.riemannTransformationPlayingW = false;
            state.riemannTransformationProgressW = parseFloat(event.target.value);
            syncRiemannTransformationPlayPauseButton();
            requestDomainRedraw(true);
        });
    }

    const transPlayPauseBtnW = document.getElementById('w_transformation_play_pause_btn');
    if (transPlayPauseBtnW) {
        bindElementListener(transPlayPauseBtnW, 'click', () => {
            toggleRiemannTransformationAnimationW();
        });
    }

    bindControlListener('riemannSurfaceResetViewBtn', 'click', () => resetRiemannSurfaceViews());

    Object.entries(SPHERE_VIEW_BUTTONS).forEach(([controlKey, rotation]) => {
        bindControlListener(controlKey, 'click', () => {
            [sphereViewParams.z, sphereViewParams.w].forEach(params => Object.assign(params, rotation));
            requestDomainRedraw(true);
        });
    });
}

function bindNavigationControls() {
    bindControlListener('enableNavigationModeCb', 'change', (_event, checkbox) => {
        setNavigationModeEnabled(checkbox.checked);
        if (state.navigationModeEnabled) disableFoldSurface3d();
        requestDomainRedraw(true);
    });

    bindSlider('navigationSizeSlider', 'navigationSize', parseFloat, () => {
        const shifted = followNavigationViewports();
        requestDomainRedraw(Boolean(shifted && state.domainColoringEnabled));
    });
    bindSlider('navigationOpacitySlider', 'navigationOpacity', parseFloat, () => requestDomainRedraw(false));
    bindSlider('navigationSpeedSlider', 'navigationSpeed', parseFloat, () => requestDomainRedraw(false));
    bindSlider('navigationTrailLengthSlider', 'navigationTrailLength', parseInteger, () => {
        if (runtime.navigation.trail.length > state.navigationTrailLength) {
            runtime.navigation.trail.splice(0, runtime.navigation.trail.length - state.navigationTrailLength);
        }
        requestDomainRedraw(false);
    });

    bindControlListener('navigationResetBtn', 'click', () => resetNavigationVehicle());
    bindElementListener(document, 'keydown', event => setNavigationKey(event, true));
    bindElementListener(document, 'keyup', event => setNavigationKey(event, false));
    bindElementListener(window, 'blur', () => {
        runtime.navigation.keys = {};
        stopNavigationLoop();
    });
}

function bindVectorFieldControls() {
    bindCheckbox('enableVectorFieldCb', 'vectorFieldEnabled', () => {
        hidden(controls.vectorFieldOptionsDiv, !state.vectorFieldEnabled);
        requestDomainRedraw(true);
    });

    bindSelector('vectorFieldFunctionSelector', 'vectorFieldFunction', () => requestUiRedraw());

    [
        ['vectorFieldScaleSlider', 'vectorFieldScale'],
        ['vectorArrowThicknessSlider', 'vectorArrowThickness'],
        ['vectorArrowHeadSizeSlider', 'vectorArrowHeadSize'],
        ['streamlineStepSizeSlider', 'streamlineStepSize'],
        ['streamlineMaxLengthSlider', 'streamlineMaxLength', parseInteger],
        ['streamlineThicknessSlider', 'streamlineThickness'],
        ['streamlineSeedDensityFactorSlider', 'streamlineSeedDensityFactor']
    ].forEach(([controlKey, stateKey, parser = parseFloat]) => bindSlider(controlKey, stateKey, parser));
    bindCheckbox('enableStreamlineFlowCb', 'streamlineFlowEnabled');
}

function bindTaylorControls() {
    bindCheckbox('enableTaylorSeriesCb', 'taylorSeriesEnabled', () => {
        hidden(controls.taylorSeriesOptionsDetailDiv, !state.taylorSeriesEnabled);
        requestUiRedraw();
    });

    bindSlider('taylorSeriesOrderSlider', 'taylorSeriesOrder', parseInteger);

    bindCheckbox('enableTaylorSeriesCustomCenterCb', 'taylorSeriesCustomCenterEnabled', () => {
        hidden(controls.taylorSeriesCustomCenterInputsDiv, !state.taylorSeriesCustomCenterEnabled);
        syncTaylorSeriesCenterStatus();
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
    bindCheckbox('enableRadialDiscreteStepsCb', 'radialDiscreteStepsEnabled');
    bindSlider('radialDiscreteStepsCountSlider', 'radialDiscreteStepsCount', parseInteger);
    bindControlListener('toggleZetaContinuationBtn', 'click', () => {
        state.zetaContinuationEnabled = !state.zetaContinuationEnabled;
        requestDomainRedraw(true);
    });
}

function bindParticleControls() {
    bindCheckbox('enableParticleAnimationCb', 'particleAnimationEnabled', () => {
        hidden(controls.particleAnimationDetailsDiv, !state.particleAnimationEnabled);
        if (!state.particleAnimationEnabled) runtime.particles.length = 0;
        requestUiRedraw();
    });

    bindSlider('particleDensitySlider', 'particleDensity', parseInteger, () => {
        runtime.particles.length = 0;
        requestUiRedraw();
    });
    bindSlider('particleSpeedSlider', 'particleSpeed');
    bindSlider('particleMaxLifetimeSlider', 'particleMaxLifetime', parseInteger);
}

function bindFourierControls() {
    bindSelector('fourierFunctionSelector', 'fourierFunction', () => {
        updateFourierTransform();
        requestUiRedraw();
    });

    [
        ['fourierFrequency', parseFloat],
        ['fourierAmplitude', parseFloat],
        ['fourierTimeWindow', parseFloat],
        ['fourierSamples', parseInteger]
    ].forEach(([key, parser]) => bindSlider(`${key}Slider`, key, parser, () => {
        updateFourierTransform();
        requestUiRedraw();
    }));

    bindSlider('fourierWindingFrequencySlider', 'fourierWindingFrequency');
    bindSlider('fourierWindingTimeSlider', 'fourierWindingTime');
}

function bindLaplaceControls() {
    bindSelector('laplaceFunctionSelector', 'laplaceFunction', () => {
        updateLaplaceTransform();
        requestUiRedraw();
    });

    ['laplaceFrequency', 'laplaceDamping'].forEach(key => bindSlider(`${key}Slider`, key, parseFloat, () => {
        updateLaplaceTransform();
        requestUiRedraw();
    }));

    ['laplaceSigma', 'laplaceOmega'].forEach(key => bindSlider(`${key}Slider`, key, parseFloat, () => {
        updateLaplaceEvaluationPoint();
        requestUiRedraw();
    }));

    bindSelector('laplaceVizModeSelector', 'laplaceVizMode', () => {
        updateLaplace3DSurface();
        requestUiRedraw();
    });
    bindSlider('laplaceClipHeightSlider', 'laplaceClipHeight', parseFloat, () => {
        updateLaplace3DSurface();
        requestUiRedraw();
    });

    [
        ['laplaceShowRocCb', 'laplaceShowROC'],
        ['laplaceShowPolesZerosCb', 'laplaceShowPolesZeros'],
        ['laplaceShowFourierLineCb', 'laplaceShowFourierLine'],
        ['laplaceAnimationLoopCb', 'laplaceAnimationLoop']
    ].forEach(([controlKey, stateKey]) => bindCheckbox(controlKey, stateKey));

    bindSlider('laplaceAnimationSpeedSlider', 'laplaceAnimationSpeed', parseFloat, () => {
        if (controls.laplaceAnimationSpeedDisplay) {
            controls.laplaceAnimationSpeedDisplay.textContent = state.laplaceAnimationSpeed.toFixed(1);
        }
        syncLaplacePlayPauseButton();
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

function isSphereInteractionActive(isZCanvas) {
    return isZCanvas
        ? state.riemannSphereViewEnabled && !state.splitViewEnabled
        : state.riemannSphereViewEnabled || state.splitViewEnabled;
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

function invalidateAllCanvasRects() {
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

export function getCachedCanvasEventPosition(canvas, event, out = { x: 0, y: 0 }) {
    if (!canvas || !event) return null;

    const ctx = canvasContextByElement.get(canvas);
    const rect = ctx
        ? canvasRect(ctx)
        : typeof canvas.getBoundingClientRect === 'function'
            ? canvas.getBoundingClientRect()
            : EMPTY_RECT;

    out.x = event.clientX - (rect.left || 0);
    out.y = event.clientY - (rect.top || 0);
    return out;
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

function handleCanvasMoveNow(ctx, pointer) {
    if (isSphereInteractionActive(ctx.isZ)) return;

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
                const delta = continuationSheetForPath(nextPoints.slice(-2), state.branchCutType, state.branchCutAngle, state.branchCutPoints);
                const sheet = state.continuationSheet + delta;
                const value = evaluateOnSheet(state.currentFunction, nextPoints[nextPoints.length - 1], sheet, state);
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
    if (isSphereInteractionActive(ctx.isZ)) return;
    if (event.button !== 0) return;

    refreshCanvasRect(ctx);
    updatePointerSnapshot(ctx.pendingMove, event);
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
            state.continuationValue = evaluateOnSheet(state.currentFunction, state[key][0], 0, state);
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
    if (finishCanvasStroke(ctx) || isSphereInteractionActive(ctx.isZ)) return;
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
    requestUiRedraw();
}

function handleCanvasLeave(ctx) {
    if (finishCanvasStroke(ctx)) return;
    if (isSphereInteractionActive(ctx.isZ)) return;

    ctx.pendingMove.hasData = false;
    invalidateCanvasRect(ctx);

    if (ctx.pan.isPanning) {
        ctx.pan.isPanning = false;
        ctx.canvas.style.cursor = 'crosshair';
        context.domainColoringDirty = true;
    }

    updateProbe(ctx, null, false);
    requestUiRedraw();
}

function zoomPlaneAt(ctx, pos, factor) {
    const zoomKey = ctx.isZ ? 'zPlaneZoom' : 'wPlaneZoom';
    const oldZoom = state[zoomKey] || 1;
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
    if (isSphereInteractionActive(ctx.isZ)) return;

    const pos = canvasPosition(ctx, ctx.pendingWheel);
    const factor = ctx.pendingWheel.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
    zoomPlaneAt(ctx, pos, factor);
}

function handleCanvasWheel(ctx, event) {
    if (isSphereInteractionActive(ctx.isZ)) return;

    event.preventDefault();
    canvasRect(ctx);
    updatePointerSnapshot(ctx.pendingWheel, event);
    flushCanvasWheel(ctx);
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

    bindContourCanvasInteractions();
}

function bindContourCanvasInteractions() {
    const contourCanvas = document.getElementById('contour_2d_canvas');
    if (!contourCanvas) return;

    let isPanning = false;
    let startX = 0;
    let startY = 0;
    let startXRange = [-3.5, 3.5];
    let startYRange = [-3.5, 3.5];

    contourCanvas.addEventListener('mousedown', event => {
        if (event.button !== 0) return;
        isPanning = true;
        startX = event.clientX;
        startY = event.clientY;
        startXRange = [...(zPlaneParams.currentVisXRange || [-3.5, 3.5])];
        startYRange = [...(zPlaneParams.currentVisYRange || [-3.5, 3.5])];
    }, PASSIVE_LISTENER_OPTIONS);

    bindElementListener(window, 'mousemove', event => {
        if (!isPanning) return;
        const rect = contourCanvas.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        const xSpan = startXRange[1] - startXRange[0];
        const ySpan = startYRange[1] - startYRange[0];
        const shiftX = -dx * (xSpan / width);
        const shiftY = dy * (ySpan / height);
        zPlaneParams.currentVisXRange = [startXRange[0] + shiftX, startXRange[1] + shiftX];
        zPlaneParams.currentVisYRange = [startYRange[0] + shiftY, startYRange[1] + shiftY];
        zPlaneParams.origin.x = -zPlaneParams.currentVisXRange[0] * zPlaneParams.scale.x;
        zPlaneParams.origin.y = zPlaneParams.currentVisYRange[1] * zPlaneParams.scale.y;
        requestDomainRedraw(true);
        requestRedrawAll();
    }, PASSIVE_LISTENER_OPTIONS);

    bindElementListener(window, 'mouseup', () => {
        isPanning = false;
    }, PASSIVE_LISTENER_OPTIONS);

    contourCanvas.addEventListener('wheel', event => {
        event.preventDefault();
        const rect = contourCanvas.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        const px = clamp(event.clientX - rect.left, 0, width);
        const py = clamp(event.clientY - rect.top, 0, height);
        const xRange = zPlaneParams.currentVisXRange || [-3.5, 3.5];
        const yRange = zPlaneParams.currentVisYRange || [-3.5, 3.5];
        const xSpan = xRange[1] - xRange[0];
        const ySpan = yRange[1] - yRange[0];
        const u = xRange[0] + (px / width) * xSpan;
        const v = yRange[1] - (py / height) * ySpan;
        const factor = event.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
        const newXSpan = xSpan / factor;
        const newYSpan = ySpan / factor;
        const newX0 = u - (px / width) * newXSpan;
        const newY1 = v + (py / height) * newYSpan;
        zPlaneParams.currentVisXRange = [newX0, newX0 + newXSpan];
        zPlaneParams.currentVisYRange = [newY1 - newYSpan, newY1];
        state.zPlaneZoom = clamp((state.zPlaneZoom || 1) * factor, MIN_STATE_ZOOM_LEVEL, MAX_STATE_ZOOM_LEVEL);
        zPlaneParams.scale.x = zPlaneParams.width / (newXSpan || 1);
        zPlaneParams.scale.y = zPlaneParams.height / (newYSpan || 1);
        zPlaneParams.origin.x = -newX0 * zPlaneParams.scale.x;
        zPlaneParams.origin.y = newY1 * zPlaneParams.scale.y;
        requestDomainRedraw(true);
        requestRedrawAll();
    }, ACTIVE_LISTENER_OPTIONS);
}

function bindCanvasRectInvalidation() {
    bindElementListener(window, 'resize', invalidateAllCanvasRects, PASSIVE_LISTENER_OPTIONS);
    bindElementListener(window, 'scroll', invalidateAllCanvasRects, PASSIVE_CAPTURE_LISTENER_OPTIONS);
    bindElementListener(document, 'scroll', invalidateAllCanvasRects, PASSIVE_CAPTURE_LISTENER_OPTIONS);
    eventBus.on('layout:canvas', invalidateAllCanvasRects);
}

function contextForCanvasEvent(event) {
    return canvasContextByElement.get(event.currentTarget || event.target);
}

function onCanvasMouseMove(event) {
    const ctx = contextForCanvasEvent(event);
    if (!ctx) return;
    if (isSphereInteractionActive(ctx.isZ)) scheduleSphereMouseMove(ctx, event);
    else scheduleCanvasMove(ctx, event);
}

function onCanvasMouseDown(event) {
    const ctx = contextForCanvasEvent(event);
    if (!ctx) return;
    if (isSphereInteractionActive(ctx.isZ)) handleSphereMouseDown(event, ctx.planeType);
    else handleCanvasDown(ctx, event);
}

function onCanvasMouseUp(event) {
    const ctx = contextForCanvasEvent(event);
    if (!ctx) return;
    if (isSphereInteractionActive(ctx.isZ)) handleSphereMouseUp(ctx.planeType);
    else handleCanvasUp(ctx, event);
}

function onCanvasMouseLeave(event) {
    const ctx = contextForCanvasEvent(event);
    if (!ctx) return;
    if (isSphereInteractionActive(ctx.isZ)) handleSphereMouseUp(ctx.planeType);
    else handleCanvasLeave(ctx);
    invalidateCanvasRect(ctx);
}

function onCanvasWheel(event) {
    const ctx = contextForCanvasEvent(event);
    if (ctx) handleCanvasWheel(ctx, event);
}

function onCanvasClick(event) {
    const ctx = contextForCanvasEvent(event);
    if (!ctx || isSphereInteractionActive(ctx.isZ)) return;
    if (ctx.hasDragged) {
        ctx.hasDragged = false;
        return;
    }

    refreshCanvasRect(ctx);
    updatePointerSnapshot(ctx.pendingMove, event);
    const pos = canvasPosition(ctx, ctx.pendingMove);
    if (!ctx.isZ && state.preimageExplorerEnabled) {
        const target = mapCanvasToWorldCoords(pos.x, pos.y, ctx.params);
        const map = resolveActiveMap();
        const xRange = zPlaneParams.currentVisXRange || zPlaneParams.xRange;
        const yRange = zPlaneParams.currentVisYRange || zPlaneParams.yRange;
        state.preimageTarget = { re: target.x, im: target.y };
        state.preimageRoots = findPreimages(state.preimageTarget, map, { xRange, yRange });
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

function restoreFullscreenOrigin(element, fallback = null, restoreSize = false) {
    const origin = fullscreenOrigins.get(element);
    const parent = origin?.parent || fallback;
    if (parent) parent.appendChild(element);
    if (restoreSize) {
        element.style.width = origin?.width || '';
        element.style.height = origin?.height || '';
    }
    fullscreenOrigins.delete(element);
}

function toggleFullscreenPanel({ container, column, stateKey, closeButton, onResize }) {
    const shell = controls.fullscreenContainer;
    if (!container || !shell) return;

    state[stateKey] = !state[stateKey];

    if (state[stateKey]) {
        rememberFullscreenOrigin(container);
        setStyles(shell, fullscreenStyles('#000'));
        attachCloseButton(shell, () => closeButton.click());
        setStyles(container, { width: '100%', height: '100%' });
        shell.appendChild(container);
        document.body.appendChild(shell);
        shell.classList.remove('hidden');
        if (column) column.classList.add('hidden-visually');
    } else {
        restoreFullscreenOrigin(container);
        setStyles(container, { width: '100%', height: '100%' });
        resetFullscreenShell(shell);
        if (column) column.classList.remove('hidden-visually');
    }

    laterFrame(onResize, state[stateKey] ? 150 : 100);
}

function bindFullscreenControls() {
    bindControlListener('toggleFullscreenZBtn', 'click', () => handleFullScreenToggle('z'));
    bindControlListener('toggleFullscreenWBtn', 'click', () => handleFullScreenToggle('w', 0));
    bindControlListener('toggleFullscreenLaplace3DBtn', 'click', toggleLaplace3DFullscreen);

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
        if (state.isGraphFullScreen && controls.toggleFullscreenGraphBtn) {
            controls.toggleFullscreenGraphBtn.click();
        }
    });
}

function toggleLaplace3DFullscreen() {
    const container = controls.laplace3DContainer;
    toggleFullscreenPanel({
        container,
        column: controls.laplace3DColumn,
        stateKey: 'isLaplace3DFullScreen',
        closeButton: controls.toggleFullscreenLaplace3DBtn,
        onResize: () => resizeLaplace3DSurface(container)
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

function refreshCanvasLayoutAfterTopControlsToggle() {
    const refresh = () => {
        setupVisualParameters(false, false);
        requestDomainRedraw(true);
    };
    frame(refresh);
    setTimeout(refresh, 50);
    setTimeout(refresh, 150);
    setTimeout(refresh, 280);
    setTimeout(refresh, 350);
}

function bindTopControlsToggle() {
    const toggle = () => {
        state.topControlsCollapsed = !state.topControlsCollapsed;
        syncTopControlsCollapseState();
        refreshCanvasLayoutAfterTopControlsToggle();
    };

    bindControlListener('toggleTopControlsBtn', 'click', toggle);
    bindControlListener('toggleTopControlsCollapsedBtn', 'click', toggle);
}

function triggerPlaneLayoutRefresh() {
    const refresh = () => {
        setupVisualParameters(false, false);
        requestDomainRedraw(true);
    };
    refresh();
    setTimeout(refresh, 340);
}

function bindCollapseControls() {
    [
        ['collapseZBtn', 'expandZBtn', controls.zPlaneColumn],
        ['collapseWBtn', 'expandWBtn', controls.wPlaneColumn]
    ].forEach(([collapseKey, expandKey, column]) => {
        bindControlListener(collapseKey, 'click', () => {
            if (!column) return;
            column.classList.add('plane-collapsed');
            triggerPlaneLayoutRefresh();
        });
        bindControlListener(expandKey, 'click', () => {
            if (!column) return;
            column.classList.remove('plane-collapsed');
            triggerPlaneLayoutRefresh();
        });
    });
}

export function setupEventListeners() {
    zCanvas = context.zCanvas;
    wCanvas = context.wCanvas;

    if (uiEventListenersBound) return;
    uiEventListenersBound = true;

    subscribeState(() => syncLaplacePlayPauseButton(), 'laplaceAnimationPlaying');
    subscribeState(() => updateDomainPaletteCirclePanel(), 'domainPalette');
    subscribeState(() => updateRealPlotsPaletteCirclePanel(), 'realPlotsPalette');
    BINDERS.forEach(fn => fn());

    syncTopControlsCollapseState();
    updateModePanels();
}

function bindChainingControls() {
    bindSelector('inputShapeSelector', 'currentInputShape', (_event, value) => {
        if (value !== 'video' && state.videoIsPlaying) {
            pauseUploadedVideoPlayback();
        } else if (value === 'video' && runtime.media.video && state.videoIsPlaying) {
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
    });

    bindElementListener(controls.chainCountSlider, 'change', () => {
        updateChainingColumns(state.chainingEnabled ? state.chainCount : 1);
        requestUiRedraw();
    });

    bindElementListener(controls.enableChainingCb, 'change', event => {
        state.chainingEnabled = event.target.checked;
        state.currentFunctionPreset = null;
        display(controls.chainingControlsContainer, state.chainingEnabled);
        syncOrbitColoringModeControl();
        updateChainingColumns(state.chainingEnabled ? state.chainCount : 1);
        syncParameterControlsPanelVisibility();
        requestUiRedraw();
    });

    bindElementListener(controls.chainModeSelector, 'change', event => {
        state.chainingMode = event.target.value === 'zero_seed' ? 'zero_seed' : 'recursion';
        state.currentFunctionPreset = null;
        syncOrbitColoringModeControl();
        updateChainingTitles();
        requestUiRedraw();
    });

    bindElementListener(controls.gridViewBtn, 'click', () => {
        const row = document.querySelector('.canvas-row.two-column-layout');
        if (!row) return;
        const active = row.classList.toggle('chaining-grid-view');
        controls.gridViewBtn.textContent = active ? '⊟ Exit Grid View' : '⊞ Grid View';
        window.dispatchEvent(new Event('resize'));
    });
}

function bindThemeControls() {
    loadThemePreferences();
    applyTheme(state.themeId, { preserveGridColors: true });
    bindControlListener('themeSelectorBtn', 'click', openThemeModal);
}

function sphereParams(planeType) {
    return planeType === 'z' ? sphereViewParams.z : sphereViewParams.w;
}

function canvasFor(planeType) {
    return planeType === 'z' ? zCanvas : wCanvas;
}

function handleSphereMouseDown(event, planeType) {
    const params = sphereParams(planeType);
    if (!isSphereInteractionActive(planeType === 'z')) return;

    const canvas = canvasFor(planeType);
    if (!canvas) return;

    params.dragging = true;
    params.lastMouseX = event.clientX;
    params.lastMouseY = event.clientY;
    canvas.style.cursor = 'grabbing';
}

function applySphereMouseMove(planeType, pointer) {
    const params = sphereParams(planeType);
    if (!isSphereInteractionActive(planeType === 'z')) return;

    const canvas = canvasFor(planeType);
    if (!canvas || !params.dragging) return;

    params.rotY += (pointer.clientX - params.lastMouseX) * SPHERE_SENSITIVITY;
    params.rotX += (pointer.clientY - params.lastMouseY) * SPHERE_SENSITIVITY;
    params.lastMouseX = pointer.clientX;
    params.lastMouseY = pointer.clientY;
    requestDomainRedraw(true);
}

function flushSphereMouseMove(ctx) {
    if (!ctx.pendingSphereMove.hasData) return;
    ctx.pendingSphereMove.hasData = false;
    applySphereMouseMove(ctx.planeType, ctx.pendingSphereMove);
}

function scheduleSphereMouseMove(ctx, event) {
    updatePointerSnapshot(ctx.pendingSphereMove, event);
    flushSphereMouseMove(ctx);
}

function handleSphereMouseUp(planeType) {
    const params = sphereParams(planeType);

    if (planeType === 'z') {
        context.draggingProbeOnSphere = false;
    }

    if (!isSphereInteractionActive(planeType === 'z') && !params.dragging) return;

    params.dragging = false;
    const ctx = canvasInteractionContexts[planeType];
    if (ctx) {
        ctx.pendingSphereMove.hasData = false;
    }
    const canvas = canvasFor(planeType);
    if (canvas) {
        canvas.style.cursor = 'crosshair';
    }
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
        (state.threeSphereEnabled && state.riemannSphereViewEnabled) ||
        (state.foldSurface3dEnabled && (
            isFoldableInputShape(state.currentInputShape) ||
            (isRasterInputShape(state.currentInputShape) && getRasterSourceForShape(state.currentInputShape))
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
    const shell = controls.fullscreenContainer;

    if (!target.element || !shell) {
        console.error('Fullscreen target element not found for plane:', planeType, 'index:', index);
        return;
    }

    setPlaneFullscreen(target.isZ, !isPlaneFullscreen(target.isZ), index);
    const entering = isPlaneFullscreen(target.isZ);

    if (entering) {
        rememberFullscreenOrigin(target.element);
        setStyles(shell, fullscreenStyles('var(--color-background-dark)'));
        attachCloseButton(shell, () => handleFullScreenToggle(planeType, index));
        shell.appendChild(target.element);
        document.body.appendChild(shell);
        shell.classList.remove('hidden');
        if (target.card) target.card.classList.add('hidden-visually');
        setStyles(target.element, { width: '100%', height: '100%' });

        if (target.isThree && target.canvas) target.canvas.classList.add('hidden');
    } else {
        restoreFullscreenOrigin(target.element, target.card?.querySelector('div'), true);
        resetFullscreenShell(shell);
        if (target.card) target.card.classList.remove('hidden-visually');
        if (target.isThree && target.canvas) target.canvas.classList.remove('hidden');

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
        setActiveFunctionButton(enabled ? currentFunction : state.currentFunction);
        if (!enabled) algebraicChainingSourceFunction = null;

        syncParameterControlsPanelVisibility();
        requestAlgebraicRedraw();
    });

    bindElementListener(controls.addAlgebraicTermBtn, 'click', () => {
        appendAlgebraicTerm();
    });

    bindControlListener('algebraicChainingZInput', 'input', () => {
        const val = controls.algebraicChainingZInput?.value || 'z';
        state.algebraicChainingZExpr = val;
        updateCustomFormulaPreview(controls.algebraicChainingZInput, controls.algebraicChainingZMath, { allowedVariables: ['z'] });
        requestAlgebraicRedraw();
    });

    bindControlListener('algebraicChainingZInput', 'change', () => {
        const val = controls.algebraicChainingZInput?.value || 'z';
        state.algebraicChainingZExpr = val;
        updateCustomFormulaPreview(controls.algebraicChainingZInput, controls.algebraicChainingZMath, { allowedVariables: ['z'] });
        requestAlgebraicRedraw();
    });
}

function drawPaletteCircleAnnotations(ctx, cx, cy, rOuter, rInner) {
    const rootStyle = getComputedStyle(document.documentElement);
    const borderColor = rootStyle.getPropertyValue('--border-color') || 'rgba(255, 255, 255, 0.15)';
    const textColor = rootStyle.getPropertyValue('--text-color') || '#FAFAFA';

    ctx.save();

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(cx - rOuter, cy);
    ctx.lineTo(cx + rOuter, cy);
    ctx.moveTo(cx, cy - rOuter);
    ctx.lineTo(cx, cy + rOuter);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.font = '500 13px Outfit, Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('0', cx + rOuter + 16, cy);
    ctx.fillText('π/2', cx, cy - rOuter - 16);
    ctx.fillText('π', cx - rOuter - 16, cy);
    ctx.fillText('3π/2', cx, cy + rOuter + 16);

    ctx.restore();
}

export function drawDomainPaletteCircle(canvas, paletteId) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const rOuter = 130;
    const rInner = 95;

    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;

    // Use current state settings for preview
    const tempState = {
        domainPalette: paletteId,
        domainBrightness: state.domainBrightness,
        domainContrast: state.domainContrast,
        domainSaturation: state.domainSaturation,
        domainLightnessCycles: state.domainLightnessCycles
    };

    for (let y = 0; y < h; y++) {
        const dy = -(y - cy);
        for (let x = 0; x < w; x++) {
            const dx = x - cx;
            const r = Math.hypot(dx, dy);

            const idx = (y * w + x) * 4;

            if (r > rOuter + 1.5 || r < rInner - 1.5) {
                continue;
            }

            // Antialiasing for outer boundary
            let alpha = 255;
            if (r > rOuter - 1.5) {
                alpha = Math.max(0, Math.min(255, Math.round((rOuter + 1.5 - r) * 85)));
            } else if (r < rInner + 1.5) {
                alpha = Math.min(alpha, Math.max(0, Math.min(255, Math.round((r - (rInner - 1.5)) * 85))));
            }

            const phase = Math.atan2(dy, dx);

            // Just map phase to color with a fixed standard modulus of 1.0 (no magnitude cycles/shading)
            const rgb = domainColorForValue(Math.cos(phase), Math.sin(phase), {
                ...tempState,
                domainLightnessCycles: 0 // Keep ring clean
            });

            data[idx] = rgb[0];
            data[idx + 1] = rgb[1];
            data[idx + 2] = rgb[2];
            data[idx + 3] = alpha;
        }
    }

    ctx.putImageData(imgData, 0, 0);

    drawPaletteCircleAnnotations(ctx, cx, cy, rOuter, rInner);
}

export function drawAmplitudeStrip(canvas, paletteId) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;

    const tempState = {
        domainPalette: paletteId,
        domainBrightness: state.domainBrightness,
        domainContrast: state.domainContrast,
        domainSaturation: state.domainSaturation,
        domainLightnessCycles: state.domainLightnessCycles
    };

    // Horizontal axis is magnitude at a representative phase, so the strip stays
    // palette-aware without adding a second phase dimension.
    const maxLogMod = Math.log(1e12 + 1);
    const phase = Math.PI;
    const phaseRe = Math.cos(phase);
    const phaseIm = Math.sin(phase);
    for (let x = 0; x < w; x++) {
        const logMod = (x / Math.max(1, w - 1)) * maxLogMod;
        const modVal = Math.expm1(logMod);
        const rgb = domainColorForValue(
            modVal * phaseRe,
            modVal * phaseIm,
            tempState
        );

        for (let y = 0; y < h; y++) {
            const idx = (y * w + x) * 4;
            data[idx] = rgb[0];
            data[idx + 1] = rgb[1];
            data[idx + 2] = rgb[2];
            data[idx + 3] = 255;
        }
    }

    ctx.putImageData(imgData, 0, 0);

    // Draw border
    ctx.save();
    const rootStyle = getComputedStyle(document.documentElement);
    const borderColor = rootStyle.getPropertyValue('--border-color') || 'rgba(255, 255, 255, 0.15)';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0, 0, w, h);
    ctx.restore();
}

export function updateDomainPaletteCirclePanel() {
    const activePalette = domainPalettes.find(p => p.id === state.domainPalette) || domainPalettes[0];
    const title = $('domain_palette_circle_title');
    if (title) title.textContent = activePalette.name;

    const canvas = $('domain_palette_circle_canvas');
    drawDomainPaletteCircle(canvas, state.domainPalette);

    const stripCanvas = $('amplitude_strip_canvas');
    drawAmplitudeStrip(stripCanvas, state.domainPalette);
}

function bindDomainPaletteCirclePanelListeners() {
    bindPalettePanel(
        'view_palette_circle_btn',
        'close_domain_palette_circle_btn',
        'domain_palette_circle_panel',
        updateDomainPaletteCirclePanel
    );
}

export function drawRealPlotsPaletteCircle(canvas, paletteId) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const rOuter = 130;
    const rInner = 95;

    const palette = realPlotsPalettes.find(p => p.id === paletteId) || realPlotsPalettes.find(p => p.id === 'viridis');
    if (!palette) return;

    // CSS gradient colors string parsing
    const colors = palette.colors.split(',').map(c => c.trim());

    // Conic gradient: createConicGradient(angle, x, y).
    // angle 0 is straight UP (12 o'clock). 
    // In our 3D math, phase -PI is at 9 o'clock.
    // To match 9 o'clock, we use angle = -Math.PI/2
    const grad = ctx.createConicGradient(-Math.PI / 2, cx, cy);

    colors.forEach((color, i) => {
        const ratio = i / (colors.length - 1);
        grad.addColorStop(ratio, color);
    });

    // Draw donut
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.arc(cx, cy, rInner, Math.PI * 2, 0, true);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    drawPaletteCircleAnnotations(ctx, cx, cy, rOuter, rInner);
}

export function drawRealPlotsAmplitudeStrip(canvas, paletteId) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const palette = realPlotsPalettes.find(p => p.id === paletteId) || realPlotsPalettes.find(p => p.id === 'viridis');
    if (!palette) return;

    const colors = palette.colors.split(',').map(c => c.trim());
    const grad = ctx.createLinearGradient(0, 0, w, 0);

    colors.forEach((color, i) => {
        const ratio = i / (colors.length - 1);
        grad.addColorStop(ratio, color);
    });

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
}

export function updateRealPlotsPaletteCirclePanel() {
    const activePalette = realPlotsPalettes.find(p => p.id === state.realPlotsPalette) || realPlotsPalettes.find(p => p.id === 'viridis');
    const title = $('real_plots_palette_circle_title');
    if (title && activePalette) title.textContent = activePalette.name;

    const canvas = $('real_plots_palette_circle_canvas');
    drawRealPlotsPaletteCircle(canvas, state.realPlotsPalette);

    const stripCanvas = $('real_plots_amplitude_strip_canvas');
    drawRealPlotsAmplitudeStrip(stripCanvas, state.realPlotsPalette);
}

function bindRealPlotsPaletteCirclePanelListeners() {
    bindPalettePanel(
        'view_real_plots_palette_circle_btn',
        'close_real_plots_palette_circle_btn',
        'real_plots_palette_circle_panel',
        updateRealPlotsPaletteCirclePanel
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
    checked('enableGraphTraceCb', state.graphTraceEnabled);
    checked('enableGraphFourierCb', state.graphFourierEnabled);
    checked('enableGraphFocusBoxCb', state.graphFocusBoxEnabled);
    checked('enableGraphLayerLockCb', state.graphLayerLockEnabled);

    bindCheckbox('enableGraphViewCb', 'graphViewEnabled', (_event, enabled) => {
        if (state.fourierModeEnabled || state.laplaceModeEnabled || !enabled) {
            disableGraphView();
        } else {
            disableRealPlots();
            state.graphFullGridEnabled = false;
            state.graphSelectedShape = '';
        }

        syncGridDensityControls();
        requestUiRedraw();
    });

    bindCheckbox('viewFullGridPerspectiveBtn', 'graphFullGridEnabled', (_event, enabled) => {
        if (!state.graphViewEnabled || !isFullGridPerspectiveSupported(state.currentInputShape)
            || state.fourierModeEnabled || state.laplaceModeEnabled) {
            state.graphFullGridEnabled = false;
            checked('viewFullGridPerspectiveBtn', false);
            return;
        }

        if (enabled) {
            state.graphGridFamily = 'primary';
            state.graphSelectedShape = '';
            if (controls.graphGridFamilySelector) controls.graphGridFamilySelector.value = 'primary';
        } else {
            state.graphLayerLockEnabled = false;
            checked('enableGraphLayerLockCb', false);
            syncGridDensityControls();
        }
        updateModePanels();
        requestUiRedraw();
    });

    bindSelector('graphGridFamilySelector', 'graphGridFamily', () => {
        state.graphSelectedShape = '';
        requestUiRedraw();
    });
    bindCheckbox('enableGraphFocusBoxCb', 'graphFocusBoxEnabled', () => requestUiRedraw());
    bindCheckbox('enableGraphLayerLockCb', 'graphLayerLockEnabled', (_event, enabled) => {
        if (enabled) {
            state.graphTraceEnabled = false;
            state.graphFourierEnabled = false;
            checked('enableGraphTraceCb', false);
            checked('enableGraphFourierCb', false);
        }
        state.graphSelectedShape = '';
        state.graphSelectionRevision = (state.graphSelectionRevision || 0) + 1;
        syncGridDensityControls();
        updateModePanels();
        requestUiRedraw();
    });
    bindCheckbox('enableGraphFourierCb', 'graphFourierEnabled', (_event, enabled) => {
        if (!state.graphViewEnabled || state.fourierModeEnabled || state.laplaceModeEnabled) {
            state.graphFourierEnabled = false;
            checked('enableGraphFourierCb', false);
        } else {
            state.graphFourierEnabled = enabled;
        }
        updateModePanels();
        requestUiRedraw();
    });

    bindCheckbox('enableGraphTraceCb', 'graphTraceEnabled', () => requestUiRedraw());
    bindControlListener('toggleFullscreenGraphBtn', 'click', toggleGraphFullscreen);
}

function toggleGraphFullscreen() {
    toggleFullscreenPanel({
        container: controls.graphContainer,
        column: controls.graphColumn,
        stateKey: 'isGraphFullScreen',
        closeButton: controls.toggleFullscreenGraphBtn,
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
    bindCheckbox('enableRealPlotsCb', 'realPlotsEnabled', (_event, val) => {
        hidden(controls.realPlotsControlsContainer, !val);
        hidden(controls.realPlotsColumn, !val);

        if (val) {
            disableGraphView();
            disableRiemannSurface();
            const rpContainer = controls.realPlotsControlsContainer;
            const algParams = $('algebraic_chaining_params');
            const chainParams = $('chaining_params');
            if (rpContainer && algParams && chainParams) {
                rpContainer.appendChild(algParams);
                rpContainer.appendChild(chainParams);
            }

            hidden(controls.zPlaneColumn, true);
            hidden(controls.wPlaneColumn, true);
        } else {
            restoreRealPlotsLayout();
            disposeRealPlotsRenderer();
        }
        refreshPlanesAfterLayoutChange();
    });

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

    bindSlider('realPlotsHeightScaleSlider', 'realPlotsHeightScale', parseFloat, (val) => {
        if (controls.realPlotsHeightScaleValueDisplay) {
            controls.realPlotsHeightScaleValueDisplay.textContent = val.toFixed(2);
        }
        requestUiRedraw();
    });



    bindControlListener('toggleFullscreenRealPlotsBtn', 'click', toggleRealPlotsFullscreen);
}

function toggleRealPlotsFullscreen() {
    toggleFullscreenPanel({
        container: controls.realPlotsContainer,
        column: controls.realPlotsColumn,
        stateKey: 'isRealPlotsFullScreen',
        closeButton: controls.toggleFullscreenRealPlotsBtn,
        onResize: () => {
            setupVisualParameters(false, false);
            requestUiRedraw();
        }
    });
}

function toggleContour2DFullscreen() {
    toggleFullscreenPanel({
        container: controls.contour2DCanvas,
        column: controls.contour2DColumn,
        stateKey: 'isContour2DFullScreen',
        closeButton: controls.toggleFullscreenContour2DBtn,
        onResize: () => {
            setupVisualParameters(false, false);
            requestUiRedraw();
        }
    });
}

function bindContourControls() {
    ['riemannSurface', 'realPlots'].forEach(prefix => {
        bindCheckbox(`${prefix}ContoursCb`, 'contoursEnabled', requestUiRedraw);
        bindSlider(`${prefix}ContourIntervalSlider`, 'contourInterval', parseFloat, requestUiRedraw);
        bindSlider(`${prefix}ContourThicknessSlider`, 'contourThickness', parseFloat, requestUiRedraw);
        bindControlListener(`${prefix}Show2DContourBtn`, 'click', () => {
            state.show2DContourPlot = !state.show2DContourPlot;
            requestUiRedraw();
        });
    });
    bindControlListener('toggleFullscreenContour2DBtn', 'click', toggleContour2DFullscreen);
}
