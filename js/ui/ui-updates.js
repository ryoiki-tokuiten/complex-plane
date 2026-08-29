import { state, context, sliderParamKeys, zPlaneParams, wPlaneParams, wPlaneInitialRanges } from '../store/state.js';
import { runtime } from '../store/runtime.js';
import { resolveActiveMap } from '../math/active-map.js';
import { DEFAULT_TAYLOR_SERIES_CENTER, CRITICAL_POINT_EPSILON, MIN_STATE_ZOOM_LEVEL, MAX_STATE_ZOOM_LEVEL } from '../constants/numerical.js';
import {
    ORBIT_COLORING_MODE_LABELS,
    normalizeOrbitColoringMode
} from '../constants/rendering.js';
import { syncVideoPlaybackUI } from '../utils/raster-media.js';
import { findTaylorCenterPreset, formatTaylorNumericValue, getChainingTitleHTML } from '../utils/dom-utils.js';
import { refreshPanelEdgeHandles } from './panel-layout-manager.js';
import { syncNavigationControls } from '../navigation-plane.js';
import {
    getBranchWindowLabel,
    getVisibleBranchIndices,
    baseExpressionHasBranches
} from '../analysis/riemann-surface.js';
import { domainPalettes } from './theme-manager.js';
import { startManifoldTransformationAnimation, stopManifoldTransformationAnimation, syncManifoldTransformationPlayPauseButton, initThreeJSRenderers, buildThreeJSMeshes, syncManifoldSliders, disposeThreeJSRenderers } from '../rendering/manifold-transformation-animation.js';
import { getDynamicFunctionFormulaHtml } from '../analysis/dynamic-plotting.js';
import { compileExpression, createExpressionMathML } from '../math/expression/index.js';
import { createFormulaFragment } from './dom-components.js';
import { isFoldableInputShape } from '../rendering/shape-generators.js';
import { isFullGridPerspectiveSupported, isGraphViewSupported } from '../rendering/transformation-graph.js';
import { getManifold } from '../rendering/manifold-registry.js';
import { requireFiniteComplex, requireFiniteNumber, finiteComplex } from '../utils/numeric-contracts.js';
import { syncGridShapeControls } from './grid-shape-controls.js';
import { generateTissotIndicatrices, selectStableTissotIndicatrices, getTissotViewportBounds } from '../analysis/tissot.js';
import { nativeOptionsForActiveMap } from '../native/map-runtime.js';
import { setPlaneViewport } from '../utils/canvas-utils.js';

const { controls = {} } = context;

export function fitConformalGridOutputViewport() {
    const indicatrices = selectStableTissotIndicatrices(generateTissotIndicatrices(
        nativeOptionsForActiveMap(resolveActiveMap()),
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
    state.wPlaneZoom = Math.min(Math.max(initialSpan / span, MIN_STATE_ZOOM_LEVEL), MAX_STATE_ZOOM_LEVEL);
    if (controls.wPlaneZoomSlider) {
        controls.wPlaneZoomSlider.value = String(Math.log10(state.wPlaneZoom));
    }
}

const HIDDEN_CLASS = 'hidden';
const VISUALLY_HIDDEN_CLASS = 'hidden-visually';
const EPS = 1e-9;

export function syncLaplacePlayPauseButton() {
    if (controls.laplacePlayPauseBtn) {
        controls.laplacePlayPauseBtn.textContent = state.laplaceAnimationPlaying ? '⏸ Pause' : '▶ Play';
    }
}

const CENTER_LABELS = Object.freeze({
    line: [
        'Fixed Re(z) (<code>a<sub>0</sub></code>):',
        'Fixed Im(z) (<code>b<sub>0</sub></code>):'
    ],
    media: [
        'Media Center Re (<code>a<sub>0</sub></code>):',
        'Media Center Im (<code>b<sub>0</sub></code>):'
    ],
    image: [
        'Image Center Re (<code>a<sub>0</sub></code>):',
        'Image Center Im (<code>b<sub>0</sub></code>):'
    ],
    video: [
        'Video Center Re (<code>a<sub>0</sub></code>):',
        'Video Center Im (<code>b<sub>0</sub></code>):'
    ],
    default: [
        'Center Re(z<sub>0</sub>) (<code>a<sub>0</sub></code>):',
        'Center Im(z<sub>0</sub>) (<code>b<sub>0</sub></code>):'
    ]
});

const INPUT_SHAPE_TITLE_SUFFIX = Object.freeze({
    line: ': Lines',
    circle: ': Circle',
    grid_cartesian: ': Cartesian Grid',
    grid_polar: ': Polar Grid',
    grid_logpolar: ': Log-Polar Grid',
    grid_logcartesian: ': Log-Cartesian Grid',
    grid_dots: ': Dots',
    grid_rectilinear: ': Rectilinear Grid',
    grid_nonorthogonal: ': Non-orthogonal Grid',
    grid_triangular: ': Triangular Grid',
    grid_curvilinear: ': Curvilinear Grid',
    grid_spiral: ': Spiral Grid',
    grid_irregular: ': Irregular-spaced Grid',
    arbitrary: ': Arbitrary Shape',
    media: ': Media',
    image: ': Image',
    video: ': Video',
    navigate: ': Navigation',
    empty_grid: ': Empty'
});

const SHAPE_SPECIFIC_GROUPS = Object.freeze({
    circle: 'circleRSliderGroup'
});

const SIMPLE_FUNCTION_LABELS = Object.freeze({
    sin: 'sin',
    cos: 'cos',
    tan: 'tan',
    sec: 'sec',
    exp: 'exp',
    ln: 'ln',
    sinh: 'sinh',
    tanh: 'tanh',
    asin: 'asin',
    atan: 'atan',
    gamma: 'Γ',
    loggamma: 'log Γ',
    bessel: 'Jν'
});

const FUNCTION_ARGUMENT_HTML = Object.freeze({
    sin: 'sin(z)',
    cos: 'cos(z)',
    tan: 'tan(z)',
    sec: 'sec(z)',
    exp: 'e<sup>z</sup>',
    ln: 'ln(z)',
    sinh: 'sinh(z)',
    tanh: 'tanh(z)',
    asin: 'asin(z)',
    atan: 'atan(z)',
    gamma: 'Γ(z)',
    loggamma: 'log Γ(z)',
    bessel: 'J<sub>ν</sub>(z)',
    mobius: 'Möbius(z)',
    zeta: 'ζ(z)',
    polynomial: 'P(z)'
});

const NORMAL_MODE_VALUE_BINDINGS = Object.freeze([
    { display: 'gridDensityValueDisplay', key: 'gridDensity' },
    { display: 'riemannSurfaceResolutionValueDisplay', key: 'riemannSurfaceResolution' },
    { display: 'neighborhoodSizeValueDisplay', key: 'probeNeighborhoodSize', digits: 2 },
    { display: 'zPlaneZoomValueDisplay', get: () => formatZoomValue(state.zPlaneZoom) },
    { display: 'wPlaneZoomValueDisplay', get: () => formatZoomValue(state.wPlaneZoom) },
    { display: 'vectorFieldScaleValueDisplay', key: 'vectorFieldScale', digits: 2 },
    { display: 'vectorArrowThicknessValueDisplay', key: 'vectorArrowThickness', digits: 1, companion: 'vectorArrowThicknessSlider' },
    { display: 'vectorArrowHeadSizeValueDisplay', key: 'vectorArrowHeadSize', digits: 1, companion: 'vectorArrowHeadSizeSlider' },
    { display: 'domainBrightnessValueDisplay', key: 'domainBrightness', digits: 2 },
    { display: 'domainContrastValueDisplay', key: 'domainContrast', digits: 2 },
    { display: 'domainSaturationValueDisplay', key: 'domainSaturation', digits: 2 },
    { display: 'domainLightnessCyclesValueDisplay', key: 'domainLightnessCycles', digits: 2 },
    { display: 'mediaSizeValueDisplay', key: 'mediaSize', digits: 1 },
    { display: 'mediaOpacityValueDisplay', key: 'mediaOpacity', digits: 2 },
    { display: 'imageSizeValueDisplay', key: 'imageSize', digits: 1 },
    { display: 'imageOpacityValueDisplay', key: 'imageOpacity', digits: 2 },
    { display: 'videoFpsValueDisplay', key: 'videoProcessingFps' },
    { display: 'videoSizeValueDisplay', key: 'videoSize', digits: 1 },
    { display: 'videoOpacityValueDisplay', key: 'videoOpacity', digits: 2 },
    {
        display: 'radialDiscreteStepsCountValueDisplay',
        key: 'radialDiscreteStepsCount',
        guard: () => typeof state.radialDiscreteStepsCount === 'number'
    },
    { display: 'taylorSeriesOrderValueDisplay', key: 'taylorSeriesOrder', companion: 'taylorSeriesOrderSlider' }
]);

const STREAMLINE_VALUE_BINDINGS = Object.freeze([
    { display: 'streamlineStepSizeValueDisplay', key: 'streamlineStepSize', digits: 3, companion: 'streamlineStepSizeSlider' },
    { display: 'streamlineMaxLengthValueDisplay', key: 'streamlineMaxLength', companion: 'streamlineMaxLengthSlider' },
    { display: 'streamlineThicknessValueDisplay', key: 'streamlineThickness', digits: 1, companion: 'streamlineThicknessSlider' },
    { display: 'streamlineSeedDensityFactorValueDisplay', key: 'streamlineSeedDensityFactor', digits: 2, companion: 'streamlineSeedDensityFactorSlider' }
]);

const PARTICLE_VALUE_BINDINGS = Object.freeze([
    { display: 'particleDensityValueDisplay', key: 'particleDensity', companion: 'particleDensitySlider' },
    { display: 'particleSpeedValueDisplay', key: 'particleSpeed', digits: 3, companion: 'particleSpeedSlider' },
    { display: 'particleMaxLifetimeValueDisplay', key: 'particleMaxLifetime', companion: 'particleMaxLifetimeSlider' }
]);

const RIEMANN_VIEW_VALUE_BINDINGS = Object.freeze([
    { display: 'manifoldSurfaceOpacityValueDisplay', key: 'manifoldSurfaceOpacity', digits: 2, companion: 'manifoldSurfaceOpacitySlider' },
    { display: 'manifoldGridOpacityValueDisplay', key: 'manifoldGridOpacity', digits: 2, companion: 'manifoldGridOpacitySlider' },
    { display: 'taylorSeriesOrderValueDisplay', key: 'taylorSeriesOrder', companion: 'taylorSeriesOrderSlider' },
    { display: 'riemannSurfaceSheetsValueDisplay', key: 'riemannSurfaceSheets' },
    { display: 'riemannSurfaceBranchCenterValueDisplay', key: 'riemannSurfaceBranchCenter' },
    { display: 'riemannSurfaceHeightScaleValueDisplay', key: 'riemannSurfaceHeightScale', digits: 2 },
    { display: 'gridSurface3DHeightScaleValueDisplay', key: 'foldSurfaceHeightScale', digits: 2 },
    { display: 'mediaSurface3DHeightScaleValueDisplay', key: 'foldSurfaceHeightScale', digits: 2 },
    { display: 'imageSurface3DHeightScaleValueDisplay', key: 'foldSurfaceHeightScale', digits: 2 },
    { display: 'videoSurface3DHeightScaleValueDisplay', key: 'foldSurfaceHeightScale', digits: 2 },
    { display: 'riemannSurfaceHeightClipValueDisplay', key: 'riemannSurfaceHeightClip', digits: 1 }
]);

const LAPLACE_VALUE_BINDINGS = Object.freeze([
    { display: 'laplaceFrequencyValueDisplay', key: 'laplaceFrequency', digits: 1 },
    { display: 'laplaceDampingValueDisplay', key: 'laplaceDamping', digits: 1 },
    { display: 'laplaceAmplitudeValueDisplay', key: 'laplaceAmplitude', digits: 1 },
    { display: 'laplaceTimeWindowValueDisplay', key: 'laplaceTimeWindow', digits: 1 },
    { display: 'laplaceSamplesValueDisplay', key: 'laplaceSamples' },
    { display: 'laplaceSigmaValueDisplay', key: 'laplaceSigma', digits: 1 },
    { display: 'laplaceOmegaValueDisplay', key: 'laplaceOmega', digits: 1 },
    { display: 'laplaceWindingFrequencyValueDisplay', key: 'laplaceOmega', digits: 1 },
    { display: 'laplaceAnimationTimeValueDisplay', get: () => Math.round(state.laplaceAnimationTime * 100), companion: 'laplaceAnimationTimeSlider' },
    { display: 'laplaceClipHeightValueDisplay', key: 'laplaceClipHeight', digits: 0 },
    { display: 'laplaceFourier3DCountValueDisplay', key: 'fourier3DParallelGraphs' }
]);

function control(key) {
    return controls?.[key] ?? null;
}

function resolveControl(target) {
    return typeof target === 'string' ? control(target) : target;
}

function runUiTransaction(_name, action) {
    action();
}

function setHidden(target, hidden = true) {
    const node = resolveControl(target);
    node?.classList?.toggle(HIDDEN_CLASS, Boolean(hidden));
}

function setActive(target, active = true) {
    const node = resolveControl(target);
    node?.classList?.toggle('active', Boolean(active));
}

function setText(key, value) {
    const node = control(key);
    if (node && value !== undefined && value !== null) {
        node.textContent = String(value);
    }
}

function setHtml(key, html) {
    const node = control(key);
    if (node) {
        node.replaceChildren(createFormulaFragment(html));
    }
}

function setChecked(key, checked) {
    const node = control(key);
    if (node && 'checked' in node) {
        node.checked = Boolean(checked);
    }
}

function setDisabled(key, disabled) {
    const node = control(key);
    if (node && 'disabled' in node) {
        node.disabled = Boolean(disabled);
    }
}

function setValue(key, value) {
    const node = control(key);
    if (node && value !== undefined && value !== null && 'value' in node) {
        node.value = value;
    }
}

function toFixedText(value, digits) {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isNaN(number) ? null : number.toFixed(digits);
}

function setFixedText(key, value, digits) {
    const rendered = toFixedText(value, digits);
    if (rendered !== null) {
        setText(key, rendered);
    }
}

function syncValueBindings(bindings) {
    for (const binding of bindings) {
        if (binding.guard && !binding.guard()) {
            continue;
        }

        if (binding.companion && !control(binding.companion)) {
            continue;
        }

        const value = typeof binding.get === 'function'
            ? binding.get()
            : state[binding.key];

        if (value === undefined || value === null) {
            continue;
        }

        if (binding.digits === undefined) {
            setText(binding.display, value);
            continue;
        }

        const rendered = toFixedText(value, binding.digits);
        if (rendered !== null) {
            setText(binding.display, rendered);
        }
    }
}

function requireArray(value, label = 'UI state array') {
    if (!Array.isArray(value)) throw new Error(`${label} is required.`);
    return value;
}

function escapeFormulaText(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function isPanning(panState) {
    return Boolean(panState?.isPanning);
}

function fractionalPowerExponent() {
    const n = typeof state.fractionalPowerN === 'number' ? state.fractionalPowerN : 0.5;
    return Number((n || 0.5).toFixed(2));
}

function syncDisclosure(checkboxKey, contentKey, enabled) {
    setChecked(checkboxKey, enabled);
    setHidden(contentKey, !enabled);
}

function syncDelegates() {
    syncLaplacePlayPauseButton();
    syncVideoPlaybackUI();
    syncNavigationControls();
}

export function syncParameterControlsPanelVisibility() {
    const panel = control('parameterControlsPanel');
    if (!panel?.children) {
        return;
    }

    const hasVisibleContent = Array.from(panel.children).some(child =>
        child?.classList
        && !child.classList.contains(HIDDEN_CLASS)
        && !child.classList.contains(VISUALLY_HIDDEN_CLASS)
    );

    setHidden(panel, !hasVisibleContent);
}

function collectActiveFunctionKeys() {
    const keys = new Set([state.currentFunction]);

    if (!state.algebraicChainingEnabled) {
        return keys;
    }

    for (const term of requireArray(state.algebraicChainingTerms, 'Algebraic terms')) {
        for (const factor of requireArray(term?.factors, 'Algebraic factors')) {
            if (factor?.func) {
                keys.add(factor.func);
            }
            if (factor?.chainedFunc) {
                keys.add(factor.chainedFunc);
            }
        }
    }

    return keys;
}

function syncShapeSpecificParameterGroups(currentShape, showShapeSpecificSliders) {
    setHidden('shapeParamsSliders', !showShapeSpecificSliders);

    if (!showShapeSpecificSliders) {
        return;
    }

    for (const [shape, groupKey] of Object.entries(SHAPE_SPECIFIC_GROUPS)) {
        setHidden(groupKey, currentShape !== shape);
    }
}

function syncCenterLabels(currentShape) {
    const labels = CENTER_LABELS[currentShape] ?? CENTER_LABELS.default;
    setHtml('a0LabelDesc', labels[0]);
    setHtml('b0LabelDesc', labels[1]);
}

function decimalPlacesFromStep(step) {
    const text = String(step ?? '');
    const decimalIndex = text.indexOf('.');

    if (decimalIndex < 0) {
        return 0;
    }

    return text.slice(decimalIndex + 1).length;
}

function syncSliderParamValueDisplays() {
    const highPrecisionKeys = new Set(['a0', 'b0', 'circleR']);

    for (const key of sliderParamKeys) {
        const display = control(`${key}ValueDisplay`);
        const slider = control(`${key}Slider`);
        const value = state[key];

        if (!display || !slider || typeof value !== 'number' || Number.isNaN(value)) {
            continue;
        }

        const stepPrecision = decimalPlacesFromStep(slider.step);
        const basePrecision = highPrecisionKeys.has(key) ? 2 : 1;
        display.textContent = value.toFixed(Math.max(stepPrecision, basePrecision));
    }
}

function syncMobiusDisplays() {
    for (const param of ['A', 'B', 'C', 'D']) {
        const value = state[`mobius${param}`];

        if (!value) {
            continue;
        }

        setFixedText(`mobius${param}_re_value_display`, value.re, 1);
        setFixedText(`mobius${param}_im_value_display`, value.im, 1);
    }
}



function syncPolynomialDisplays() {
    setText('polynomialNValueDisplay', state.polynomialN);
}

function syncFractionalPowerDisplays() {
    if (!control('fractionalPowerNValueDisplay')) {
        return;
    }

    const rendered = state.fractionalPowerN !== undefined
        ? toFixedText(state.fractionalPowerN, 2)
        : '0.50';

    setText('fractionalPowerNValueDisplay', rendered ?? '0.50');
}

export function syncComplexParameterControls() {
    if (state.laplaceModeEnabled) {
        return;
    }

    setHidden('chainingParams', false);
    setHidden('chainingControlsContainer', !state.chainingEnabled);
    setChecked('enableChainingCb', state.chainingEnabled);
    setChecked('enableAlgebraicChainingCb', state.algebraicChainingEnabled);
    setHidden('algebraicChainingParams', !state.realPlotsEnabled && !state.algebraicChainingEnabled);
    setHidden('chainSeedControl', !state.chainingEnabled || state.chainingMode !== 'zero_seed');

    const shape = state.currentInputShape;
    const activeFunctions = collectActiveFunctionKeys();
    const isLine = shape === 'line';
    const isCircle = shape === 'circle';
    const isMedia = shape === 'media' || shape === 'image' || shape === 'video';
    const isImage = shape === 'image';
    const isVideo = shape === 'video';
    const isGrid = isFoldableInputShape(shape);
    const showFoldControl = isGrid || isMedia;
    const isArbitrary = shape === 'arbitrary';
    const showCommonParams = isLine || isCircle;
    const showMediaCenterParams = isMedia;
    const showShapeSpecificSliders = isCircle;
    const isMobiusFunc = activeFunctions.has('mobius');
    const isPolyFunc = activeFunctions.has('polynomial');
    const isPowerFunc = activeFunctions.has('power');
    const hasExp = activeFunctions.has('exp') || requireArray(state.algebraicChainingTerms, 'Algebraic terms')
        .some(term => requireArray(term?.factors, 'Algebraic factors').some(factor => factor?.exp));
    const hasLog = activeFunctions.has('ln') || requireArray(state.algebraicChainingTerms, 'Algebraic terms')
        .some(term => requireArray(term?.factors, 'Algebraic factors').some(factor => factor?.log));

    setHidden('zPlaneShapeControlsOverlay', !showCommonParams);
    setHidden('commonParamsSliders', !showCommonParams);
    setHidden('mobiusParamsSliders', !isMobiusFunc);
    setHidden('polynomialParamsSliders', !isPolyFunc);
    setHidden('fractionalPowerParamsSliders', !isPowerFunc);
    setHidden('expBaseSpecificControls', !hasExp);
    setHidden('logBaseSpecificControls', !hasLog);
    setHidden('besselOrderSpecificControls', !activeFunctions.has('bessel'));
    syncFunctionEquationCard();
    const hasBranches = baseExpressionHasBranches(state);
    setHidden('branchToolsControls', !hasBranches);
    setHidden('branchCutAngleGroup', !hasBranches || state.branchCutType !== 'ray');
    setText('branchCutAngleValueDisplay', Math.abs(state.branchCutAngle - Math.PI) < 1e-6 ? 'π' : `${(state.branchCutAngle / Math.PI).toFixed(2)}π`);
    const continued = state.continuationValue;
    setActive('drawBranchCutBtn', state.branchDrawMode === 'cut');
    setActive('drawContinuationPathBtn', state.branchDrawMode === 'path');
    setText('drawBranchCutBtn', state.branchDrawMode === 'cut' ? 'Drawing Cut…' : 'Draw Cut');
    setText('drawContinuationPathBtn', state.branchDrawMode === 'path' ? 'Drawing Path…' : 'Continue Along Path');
    const continuationText = state.branchDrawMode === 'cut'
        ? 'Drag on the z-plane to place the seam.'
        : state.branchDrawMode === 'path'
            ? 'Drag a path on the z-plane; each seam crossing changes k.'
            : state.continuationPath.length > 1
                ? `Active sheet k = ${state.continuationSheet}${continued ? ` · w ≈ ${continued.re.toFixed(4)} ${continued.im < 0 ? '−' : '+'} ${Math.abs(continued.im).toFixed(4)}i` : ''}`
                : state.branchCutType === 'draw' && state.branchCutPoints.length < 2
                    ? 'Draw a cut, then continue a value along a crossing path.'
                    : 'Cut ready. Continue along a path to move between sheets.';
    setText('continuationStatus', continuationText);
    setHidden('mediaUploadControls', !isMedia);
    setHidden('mediaVideoControls', !isMedia || !runtime.media.video);
    setHidden('imageUploadControls', !isImage);
    setHidden('videoUploadControls', !isVideo);
    setHidden('arbitraryShapeControls', !isArbitrary);
    setActive('arbitraryShapeParametricModeBtn', state.arbitraryShapeMode === 'parametric');
    setActive('arbitraryShapeDrawModeBtn', state.arbitraryShapeMode === 'draw');
    setValue('arbitraryShapeTMinInput', state.arbitraryShapeTMin);
    setValue('arbitraryShapeTMaxInput', state.arbitraryShapeTMax);
    setChecked('arbitraryShapeClosedCb', state.arbitraryShapeClosed);
    setHidden('parametricArbitraryShapeControls', !isArbitrary || state.arbitraryShapeMode !== 'parametric');
    setHidden('drawnArbitraryShapeControls', !isArbitrary || state.arbitraryShapeMode !== 'draw');
    const drawnPointCount = state.arbitraryShapePoints.reduce((count, point) =>
        count + (Number.isFinite(point?.re) && Number.isFinite(point?.im) ? 1 : 0), 0);
    setText('arbitraryShapeDrawStatus', drawnPointCount > 1
        ? `${drawnPointCount} sampled points. Drag again to append another stroke.`
        : 'Drag anywhere on the z-plane. New strokes are appended.');
    setHidden('gridSurface3DControl', !showFoldControl);
    setHidden('gridSurface3DOptions', !isGrid || !state.foldSurface3dEnabled);
    setHidden('mediaSurface3DOptions', !isMedia || !state.foldSurface3dEnabled);
    setHidden('imageSurface3DOptions', !isImage || !state.foldSurface3dEnabled);
    setHidden('videoSurface3DOptions', !isVideo || !state.foldSurface3dEnabled);
    setChecked('gridSurface3DCb', state.foldSurface3dEnabled);
    const isFoldActive = Boolean(state.foldSurface3dEnabled && (isGrid || isMedia || isImage || isVideo || isFoldableInputShape(shape)));
    setHidden('w_plane_folds_overlay', !isFoldActive);

    syncShapeSpecificParameterGroups(shape, showShapeSpecificSliders);

    if (showCommonParams || showMediaCenterParams) {
        syncCenterLabels(shape);
    }

    syncSliderParamValueDisplays();

    if (isMobiusFunc) {
        syncMobiusDisplays();
    }

    if (isPolyFunc) {
        syncPolynomialDisplays();
    }

    if (isPowerFunc) {
        syncFractionalPowerDisplays();
    }
}

function syncNormalModeDisplays() {
    if (state.laplaceModeEnabled) {
        return;
    }

    syncValueBindings(NORMAL_MODE_VALUE_BINDINGS);
    setValue('zPlaneZoomSlider', Math.log10(state.zPlaneZoom || 1));
    setValue('wPlaneZoomSlider', Math.log10(state.wPlaneZoom || 1));
}

export function syncTaylorControls() {
    const detailDiv = document.getElementById('taylor_series_options_detail_div');
    if (detailDiv && detailDiv.parentElement?.id !== 'plane_context_submenu') {
        setHidden('taylorSeriesOptionsDetailDiv', !state.taylorSeriesEnabled);
    } else if (detailDiv) {
        detailDiv.classList.remove('hidden');
    }
    const pickBtn = document.getElementById('pick_taylor_center_canvas_btn');
    const pickBtnText = document.getElementById('pick_taylor_center_btn_text');
    if (pickBtn) {
        pickBtn.classList.toggle('is-picking', Boolean(state.taylorSeriesCanvasClickCenterEnabled));
        if (pickBtnText) {
            pickBtnText.textContent = state.taylorSeriesCanvasClickCenterEnabled
                ? 'Click Canvas to Pin z₀…'
                : 'Pick Center on Canvas';
        }
    }
    syncTaylorSeriesCenterStatus();
}

export function syncVectorFlowControls() {
    const isAnyActive = Boolean(state.vectorFieldEnabled || state.streamlineFlowEnabled || state.particleAnimationEnabled);
    setHidden('vectorFlowCanvasOverlay', !isAnyActive);
    setHidden('vectorFieldOptionsDiv', !state.vectorFieldEnabled);
    setHidden('streamlineOptionsDetailsDiv', !state.streamlineFlowEnabled);
    setHidden('particleAnimationDetailsDiv', !state.particleAnimationEnabled);
    syncValueBindings(STREAMLINE_VALUE_BINDINGS);
    syncValueBindings(PARTICLE_VALUE_BINDINGS);
}

export function syncTransformControlPanels() {
    const transformHubActive = state.laplaceModeEnabled || state.graphFourierEnabled;
    setHidden('coreApplicationControls', state.laplaceModeEnabled);
    setHidden('visualizationOptionsPanel', transformHubActive);
    setHidden('laplaceSpecificControls', !transformHubActive);
    setHidden('inputShapeSelector', state.laplaceModeEnabled);
}

function syncRiemannAndTransformDisplays() {
    syncTransformControlPanels();
    const graphSource = state.graphFourierEnabled && !state.laplaceModeEnabled;
    const sourceSelector = control('laplaceFunctionSelector');
    const graphOption = control('laplaceCurrentGraphOption');
    if (graphOption) graphOption.hidden = !graphSource;
    if (sourceSelector) {
        sourceSelector.disabled = graphSource;
        sourceSelector.value = graphSource ? 'current_graph' : state.laplaceFunction;
        sourceSelector.dataset.tooltip = graphSource
            ? 'The current graph supplies the signal for the σ = 0 Laplace slice'
            : 'Select the time-domain signal type';
    }
    setText('laplaceSignalSectionTitle', graphSource ? 'Graph Signal' : 'Signal Configuration');
    setText('laplaceFunctionLabel', graphSource ? 'Source' : 'Waveform Type');
    setText('laplaceFrequencyLabel', 'Frequency:');
    // Keep the 3D controls available while its canvas is hidden so the user can
    // turn the surface back on. Graph Fourier mode hides the whole section.
    setHidden('laplace3DControlsSection', graphSource);
    setHidden('laplaceAnimationSection', graphSource);
    ['laplaceOmegaSlider', 'laplaceWindingFrequencySlider']
        .forEach(key => setValue(key, state.laplaceOmega));
    setChecked('laplaceHideIntegralEvaluationCb', state.laplaceHideIntegralEvaluation);
    setChecked('laplaceHide3DSurfaceCb', state.laplaceHide3DSurface);
    setChecked('laplaceShowSpectrumCb', state.laplaceShowSpectrum);
    setChecked('laplaceShowComCb', state.laplaceShowComGraph);
    setChecked('laplaceShowFourier3DCb', state.laplaceShowFourier3D);
    setValue('laplaceFourier3DCountSlider', state.fourier3DParallelGraphs || 4);
    setChecked('laplaceSyncWindingVectorCb', state.laplaceSyncWindingVector);
    setChecked('laplaceShowBarriersCb', state.laplaceShowBarriers);
    setValue('laplaceComComponentSelector', state.laplaceComComponent);
    setChecked('laplaceContoursCb', state.contoursEnabled);
    setValue('laplaceContourIntervalSlider', state.contourInterval);
    setText('laplaceContourIntervalValueDisplay', Number(state.contourInterval).toFixed(2));
    setValue('laplaceContourThicknessSlider', state.contourThickness);
    setText('laplaceContourThicknessValueDisplay', Number(state.contourThickness).toFixed(1));
    setHidden('laplaceContoursDetails', !state.contoursEnabled);
    syncValueBindings(RIEMANN_VIEW_VALUE_BINDINGS);
    syncValueBindings(LAPLACE_VALUE_BINDINGS);
}

function syncGraphControls() {
    const fullGridSupported = isFullGridPerspectiveSupported();
    const isPolar = state.currentInputShape === 'grid_polar' || state.currentInputShape === 'grid_logpolar';
    const graphActive = state.graphViewEnabled;

    setHidden('fullGridPerspectiveControl', !fullGridSupported || !graphActive);
    if (controls.enableGraphViewCb) controls.enableGraphViewCb.disabled = !isGraphViewSupported();
    setActive('viewFullGridPerspectiveBtn', state.graphFullGridEnabled);
    setChecked('viewFullGridPerspectiveBtn', state.graphFullGridEnabled);
    setChecked('enableGraphViewCb', state.graphViewEnabled);
    setHidden('graphFocusBoxToggle', !state.graphFullGridEnabled);
    setChecked('enableGraphFocusBoxCb', state.graphFocusBoxEnabled);
    setHidden('graphLayerLockToggle', !state.graphFullGridEnabled);
    setChecked('enableGraphLayerLockCb', state.graphLayerLockEnabled);
    setHidden('graphGridFamilySelector', !state.graphFullGridEnabled);
    setValue('graphGridFamilySelector', state.graphGridFamily);
    setHidden('graphFourierToggle', !graphActive || state.graphLayerLockEnabled);
    setChecked('enableGraphFourierCb', state.graphFourierEnabled);
    setHidden('graphTraceToggle', !graphActive || state.graphLayerLockEnabled);
    setText(
        'graphTitleLabel',
        state.graphFullGridEnabled
            ? state.graphLayerLockEnabled ? 'Locked Layer Perspective' : 'Full Grid Perspective'
            : state.graphFourierEnabled ? 'Graph + Fourier' : 'Graph'
    );

    const familySelector = control('graphGridFamilySelector');
    if (familySelector?.options?.length >= 2) {
        familySelector.options[0].textContent = isPolar ? 'Circles' : 'Horizontal';
        familySelector.options[1].textContent = isPolar ? 'Lines' : 'Vertical';
    }

    if (!graphActive) setHidden('graphColumn', true);
}

export function updateSliderLabelsAndDisplay() {
    runUiTransaction('updateSliderLabelsAndDisplay', () => {
        syncComplexParameterControls();
        syncNormalModeDisplays();
        syncTaylorControls();
        syncVectorFlowControls();
        syncRiemannAndTransformDisplays();
        syncGraphControls();
        syncParameterControlsPanelVisibility();
        syncDelegates();
    });
}

export function getTaylorDisplayCenter() {
    return state.taylorSeriesCustomCenter || state.taylorSeriesCenter || DEFAULT_TAYLOR_SERIES_CENTER;
}

export function formatTaylorCenterStatusText(center) {
    const preset = findTaylorCenterPreset(center.re, center.im);
    if (preset) {
        return `z0 = ${preset.label}`;
    }

    const re = formatTaylorNumericValue(center.re);
    const imMagnitude = formatTaylorNumericValue(Math.abs(center.im));
    const sign = center.im >= 0 ? '+' : '-';
    return `z0 = ${re} ${sign} ${imMagnitude}i`;
}

export function syncTaylorSeriesCenterStatus() {
    if (!control('taylorSeriesCenterStatus')) {
        return;
    }

    setText('taylorSeriesCenterStatus', formatTaylorCenterStatusText(getTaylorDisplayCenter()));
}

export function formatProbeValue(v) {
    if (v === 0) {
        return '0';
    }

    if (typeof v !== 'number' || Number.isNaN(v)) {
        return 'NaN';
    }

    if (!Number.isFinite(v)) {
        return String(v);
    }

    const absV = Math.abs(v);
    return absV >= 0.001 && absV < 1e6
        ? v.toFixed(3)
        : v.toExponential(3);
}

export function formatZoomValue(v) {
    if (typeof v !== 'number' || Number.isNaN(v)) return '1.00';
    if (v >= 1e6 || v < 0.01) return v.toExponential(2);
    return v.toFixed(2);
}

export function formatProbeComplex(re, im) {
    const reStr = formatProbeValue(re);
    const imAbs = Math.abs(im);
    const imSign = im >= 0 ? '+' : '-';
    const imStr = formatProbeValue(imAbs);
    return `${reStr} ${imSign} ${imStr}i`;
}

function hideProbeInfo() {
    setHidden('zPlaneProbeInfo', true);
    setHidden('wPlaneProbeInfo', true);
}

function showProbeInfo(zHtml, wHtml) {
    setHtml('zPlaneProbeInfo', zHtml);
    setHidden('zPlaneProbeInfo', false);
    setHtml('wPlaneProbeInfo', wHtml);
    setHidden('wPlaneProbeInfo', false);
}

function derivativeProbeHtml() {
    const activeMap = resolveActiveMap();
    const derivativeLabel = activeMap.presentation === 'derivative' ? "f''(z)" : "f'(z)";
    const deriv = activeMap.derivative(state.probeZ.re, state.probeZ.im);
    if (!finiteComplex(deriv)) {
        return `${derivativeLabel} calculation failed.<br>Conformality: Unknown<br>`;
    }

    const magDerivSq = deriv.re * deriv.re + deriv.im * deriv.im;
    const isConformal = magDerivSq > CRITICAL_POINT_EPSILON * CRITICAL_POINT_EPSILON;
    const mag = Math.sqrt(magDerivSq);
    const argR = Math.atan2(deriv.im, deriv.re);
    const argD = argR * 180 / Math.PI;

    return [
        `${derivativeLabel} ≈ ${formatProbeComplex(deriv.re, deriv.im)}`,
        isConformal ? 'Conformal at z' : `Not conformal (${derivativeLabel} ≈ 0)`,
        `|${derivativeLabel}| ≈ ${formatProbeValue(mag)} (mag.)`,
        `arg(${derivativeLabel}) ≈ ${argR.toFixed(3)}rad (${argD.toFixed(2)}°) (rot.)`
    ].join('<br>');
}

function transformedProbeHtml() {
    const transform = resolveActiveMap().evaluate;
    const pW = typeof transform === 'function'
        ? transform(state.probeZ.re, state.probeZ.im)
        : null;

    if (!finiteComplex(pW)) {
        return [
            '<strong class="probe-output-error">Output unavailable at this point</strong>',
            'The map reaches a pole or diverges to ∞, so no finite <em>w</em> can be plotted.',
            'Choose another input point or reduce the output-chain depth.',
            'Conformality: unavailable for a non-finite output.'
        ].join('<br>');
    }

    return `w = ${formatProbeComplex(pW.re, pW.im)}<br>${derivativeProbeHtml()}`;
}

export function updateProbeInfo() {
    runUiTransaction('updateProbeInfo', () => {
        const zIsPlanar = !(state.manifold3dViewEnabled && state.manifoldTransformationEnabled);
        const probeCanRender = state.probeActive
            && zIsPlanar
            && !state.navigationModeEnabled
            && !state.laplaceModeEnabled
            && !isPanning(runtime.interaction.panZ)
            && !isPanning(runtime.interaction.panW)
            && finiteComplex(state.probeZ);

        if (!probeCanRender) {
            hideProbeInfo();
            return;
        }

        showProbeInfo(
            `z = ${formatProbeComplex(state.probeZ.re, state.probeZ.im)}`,
            transformedProbeHtml()
        );
    });
}

function formatNumberForFormula(value) {
    const number = requireFiniteNumber(value, 'Formula number');
    return Number(number.toFixed(2));
}

function normalizeComplex(c) {
    const value = requireFiniteComplex(c, 'Formula coefficient');
    return { re: value.re, im: value.im };
}

function formatComplexCoeff(c) {
    const coeff = normalizeComplex(c);

    if (Math.abs(coeff.im) < EPS) {
        if (Math.abs(coeff.re - 1) < EPS) {
            return '';
        }
        if (Math.abs(coeff.re + 1) < EPS) {
            return '-';
        }
        return `${formatNumberForFormula(coeff.re)}`;
    }

    const reStr = Math.abs(coeff.re) < EPS ? '' : `${formatNumberForFormula(coeff.re)}`;
    const sign = coeff.im >= 0 ? '+' : '-';
    const imVal = Math.abs(coeff.im);
    const imStr = Math.abs(imVal - 1) < EPS ? 'i' : `${formatNumberForFormula(imVal)}i`;

    if (reStr === '') {
        return coeff.im >= 0 ? imStr : `-${imStr}`;
    }

    return `(${reStr}${sign}${imStr})`;
}

function baseFunctionHtml(funcKey) {
    if (SIMPLE_FUNCTION_LABELS[funcKey]) {
        return SIMPLE_FUNCTION_LABELS[funcKey];
    }

    switch (funcKey) {
        case 'c':
            return 'c';
        case 'power':
            return `(·)<sup>${fractionalPowerExponent()}</sup>`;
        case 'mobius':
            return 'Möbius';
        case 'zeta':
            return 'ζ';
        case 'polynomial':
            return `P (deg ${state.polynomialN})`;
        default:
            return funcKey;
    }
}

function argumentFunctionHtml(funcKey) {
    const zExpr = state.algebraicChainingZExpr && state.algebraicChainingZExpr !== 'z'
        ? escapeFormulaText(state.algebraicChainingZExpr)
        : 'z';

    if (funcKey === 'c') {
        return 'c';
    }

    if (funcKey === 'power') {
        return `(${zExpr})<sup>${fractionalPowerExponent()}</sup>`;
    }

    const val = FUNCTION_ARGUMENT_HTML[funcKey];
    if (val) {
        return val.replaceAll('z', zExpr);
    }

    return `${funcKey}(${zExpr})`;
}

function formatFuncForFormula(funcKey, termFactor = null) {
    if (!funcKey || funcKey === 'none') {
        return '';
    }

    const zExpr = state.algebraicChainingZExpr && state.algebraicChainingZExpr !== 'z'
        ? escapeFormulaText(state.algebraicChainingZExpr)
        : 'z';

    const base = baseFunctionHtml(funcKey);
    const innerArg = termFactor?.chainedFunc && termFactor.chainedFunc !== 'none'
        ? argumentFunctionHtml(termFactor.chainedFunc)
        : zExpr;

    let result = funcKey === 'c'
        ? 'c'
        : funcKey === 'power'
        ? base.replace('(·)', innerArg)
        : `${base}(${innerArg})`;

    if (!termFactor) {
        return result;
    }

    if (typeof termFactor.power === 'number' && termFactor.power !== 1) {
        result = `(${result})<sup>${formatNumberForFormula(termFactor.power)}</sup>`;
    }

    if (termFactor.reciprocal) {
        result = `1/(${result})`;
    }

    if (termFactor.log) {
        result = `ln(${result})`;
    }

    if (termFactor.exp) {
        result = `e<sup>${result}</sup>`;
    }

    return result;
}

function formatAlgebraicTerm(term) {
    const activeFactors = requireArray(term?.factors, 'Algebraic factors')
        .filter(factor => factor?.func && factor.func !== 'none');
    const factorsStr = activeFactors.map(factor => formatFuncForFormula(factor.func, factor)).join('·');
    const coeffStr = formatComplexCoeff(term?.coeff);

    if (coeffStr === '') {
        return factorsStr || '1';
    }

    if (coeffStr === '-') {
        return `-${factorsStr || '1'}`;
    }

    return factorsStr ? `${coeffStr}·${factorsStr}` : coeffStr;
}

function currentFunctionFormulaHtml() {
    const dynamicFormula = getDynamicFunctionFormulaHtml();
    if (dynamicFormula) {
        return dynamicFormula;
    }

    if (state.currentFunction === 'algebraic_chaining') {
        const terms = requireArray(state.algebraicChainingTerms, 'Algebraic terms');
        return terms.length
            ? terms.map(formatAlgebraicTerm).join(' + ').replace(/\+ \-/g, '- ')
            : '0';
    }

    switch (state.currentFunction) {
        case 'polynomial':
            return `P(z) (deg ${state.polynomialN})`;
        case 'exp':
            return 'e<sup>z</sup>';
        case 'ln':
            return 'ln(z)';
        case 'mobius':
            return '(az+b)/(cz+d)';
        case 'zeta':
            return 'ζ(z)';
        case 'power':
            return 'z<sup>n</sup>';
        case 'sinh':
            return 'sinh(z)';
        case 'tanh':
            return 'tanh(z)';
        default:
            return `${state.currentFunction}(z)`;
    }
}

function compositionSymbol() {
    switch (state.currentFunction) {
        case 'exp':
            return 'e<sup>(·)</sup>';
        case 'ln':
            return 'ln(·)';
        case 'zeta':
            return 'ζ(·)';
        case 'polynomial':
            return `P<sub>deg ${state.polynomialN}</sub>(·)`;
        case 'mobius':
            return 'Möbius(·)';
        case 'power':
            return `(·)<sup>${fractionalPowerExponent()}</sup>`;
        case 'sinh':
            return 'sinh(·)';
        case 'tanh':
            return 'tanh(·)';
        default:
            return `${state.currentFunction}(·)`;
    }
}

function recursiveChainFormula(baseFormula, chainCount) {
    if (chainCount > 3 || state.currentFunction === 'algebraic_chaining') {
        let repeatedF = '';
        for (let i = 0; i < Math.min(chainCount, 3); i++) repeatedF += 'f(';
        repeatedF += '... f(z)';
        for (let i = 0; i < Math.min(chainCount, 3); i++) repeatedF += ')';
        
        return `${repeatedF} <span class="formula-note">[${chainCount} times, where f(z) = ${baseFormula}]</span>`;
    }

    const symbol = compositionSymbol();
    let formula = baseFormula;

    for (let i = 1; i < chainCount; i += 1) {
        formula = symbol.includes('(·)')
            ? symbol.replace('(·)', formula)
            : `${symbol}(${formula})`;
    }

    return formula;
}

function getChainedFormula(baseFormula, chainingMode, chainCount) {
    if (!state.chainingEnabled || chainCount <= 1) {
        return baseFormula;
    }

    switch (chainingMode) {
        case 'zero_seed':
            let repeatedFZero = '';
            const seed = formatChainingSeedForFormula(state.chainSeed);
            for (let i = 0; i < Math.min(chainCount, 3); i++) repeatedFZero += 'f(';
            repeatedFZero += `... f(${seed})`;
            for (let i = 0; i < Math.min(chainCount, 3); i++) repeatedFZero += ')';
            
            return `${repeatedFZero} <span class="formula-note">[${chainCount} times, where f(z, c) = ${baseFormula}]</span>`;
        case 'recursion':
        default:
            return recursiveChainFormula(baseFormula, chainCount);
    }
}

function formatChainingSeedForFormula(seed) {
    const re = formatTaylorNumericValue(seed?.re);
    const imValue = Number(seed?.im);
    const im = formatTaylorNumericValue(Math.abs(imValue));
    if (!imValue) return re;
    if (!Number(seed?.re)) return `${imValue < 0 ? '-' : ''}${im === '1' ? 'i' : `${im}i`}`;
    return `${re}${imValue < 0 ? ' - ' : ' + '}${im}i`;
}

function outputFormulaModel() {
    let fND = currentFunctionFormulaHtml();

    if (state.chainingEnabled && state.chainCount > 1) {
        fND = getChainedFormula(fND, state.chainingMode, state.chainCount);
    }

    const hasOutputChain = state.chainingEnabled && state.chainCount > 1;
    const isSinglePanelChain = state.chainingEnabled && state.chainCount > 25;
    const wOutputFormula = hasOutputChain
        ? getChainingTitleHTML(isSinglePanelChain ? state.chainCount - 1 : 0, state.chainingMode)
        : `w = ${fND}`;

    const chainLabel = isSinglePanelChain ? `Iteration ${state.chainCount}` : 'Chain 0';
    const mappedChainLabel = isSinglePanelChain ? `mapped iteration ${state.chainCount}` : 'mapped chain 0';
    const derivativePrefix = state.mapPresentation === 'derivative' ? 'Derivative of ' : '';

    return {
        fND,
        hasOutputChain,
        wOutputFormula,
        derivativePrefix,
        wOutputDescriptor: `${hasOutputChain ? chainLabel : 'Output'}: ${derivativePrefix}<code id="w-plane-title-func">${wOutputFormula}</code>`,
        mappedWOutputDescriptor: `${hasOutputChain ? mappedChainLabel : 'mapped output'}: ${derivativePrefix}<code id="w-plane-title-func">${wOutputFormula}</code>`
    };
}

function defaultZPlaneTitle(fND) {
    const suffix = INPUT_SHAPE_TITLE_SUFFIX[state.currentInputShape] ?? '';
    let title = `z-plane (Input${suffix})`;
    const showRadialSteps = state.radialDiscreteStepsEnabled;
    const derivativePrefix = state.mapPresentation === 'derivative' ? 'Derivative of ' : '';

    if (state.domainColoringEnabled) {
        title = `z-plane (Output: Domain Coloring of ${derivativePrefix}<code id="z-plane-title-func">w = ${fND}</code>)`;
    } else if (state.vectorFieldEnabled || state.streamlineFlowEnabled) {
        const typeStr = state.streamlineFlowEnabled ? 'Streamlines' : 'Vector Field';
        title = `z-plane (Output: ${typeStr} of ${derivativePrefix}<code id="z-plane-title-func">w = ${fND}</code>)`;
    } else if (showRadialSteps) {
        title = `z-plane (Output: Radial Discrete Steps of ${derivativePrefix}<code id="z-plane-title-func">w = ${fND}</code>)`;
    } else if (state.navigationModeEnabled) {
        title = 'z-plane (Navigation)';
    }

    return title;
}

function syncPrimaryPlaneTitles() {
    const model = outputFormulaModel();

    const chainText = document.getElementById('enable_chaining_text');
    const algText = document.getElementById('enable_algebraic_chaining_text');
    const algLabel = document.querySelector('label[for="enable_algebraic_chaining_cb"]');

    if (state.realPlotsEnabled) {
        syncRealPlotsUI();
        if (chainText) chainText.textContent = 'Enable Output Chaining (z)';
        if (algText) algText.textContent = 'Enable Algebraic Chaining (z)';
        if (algLabel) algLabel.setAttribute('data-tooltip', 'Sum multiple functions together: a*f(z)*g(z) + b*h(z)...');

        const label = document.getElementById('real_plots_title_label');
        if (label) {
            let compPrefix = 'Re';
            if (state.realPlotsOutputComponent === 'imag') compPrefix = 'Im';
            else if (state.realPlotsOutputComponent === 'magnitude') compPrefix = '|';

            let displayFormula = `z = ${compPrefix}( ${model.hasOutputChain ? 'w' : 'f(z)'} )`;
            if (state.realPlotsOutputComponent === 'magnitude') {
                displayFormula = `z = | ${model.hasOutputChain ? 'w' : 'f(z)'} |`;
            }

            const zinText = state.realPlotsImagExpr === '0'
                ? state.realPlotsInputExpr
                : `${state.realPlotsInputExpr} + i·${state.realPlotsImagExpr}`;

            label.replaceChildren(
                document.createTextNode(`Real Plot (3D Surface): ${displayFormula}, where ${model.hasOutputChain ? 'w' : 'f(z)'} = `),
                createFormulaFragment(model.fND),
                document.createTextNode(`, z = ${zinText}`)
            );
        }
        return;
    } else {
        if (chainText) chainText.textContent = 'Enable Output Chaining';
        if (algText) algText.textContent = 'Enable Algebraic Chaining';
        if (algLabel) algLabel.setAttribute('data-tooltip', 'Sum multiple complex functions together: a*f(z)*g(z) + b*h(z)...');
    }

    const zPlaneTitle = defaultZPlaneTitle(model.fND);

    if (state.riemannSurfaceEnabled) {
        setHtml('zPlaneTitle', zPlaneTitle);
        setHtml('wPlaneTitle', `Riemann surface (${model.wOutputDescriptor})`);
        setHidden('cauchy_integral_results_info', true);
        return;
    }

    if (state.manifoldTransformationEnabled && state.manifold3dViewEnabled) {
        const manifold = getManifold(state.selectedManifold);
        setHtml('zPlaneTitle', `z-manifold (Input: Transforming Flat Grid to ${manifold.name})`);
        const mappedGridLabel = state.mapPresentation === 'derivative' ? 'Derivative Grid' : 'Mapped Grid';
        setHtml('wPlaneTitle', `w-manifold (Output: Transforming ${mappedGridLabel} to ${manifold.name})`);
        setHidden('cauchy_integral_results_info', true);
        return;
    }

    if (state.manifold3dViewEnabled) {
        const manifold = getManifold(state.selectedManifold);
        setHtml('zPlaneTitle', zPlaneTitle);
        setHtml('wPlaneTitle', `w-manifold (Output: ${manifold.name})`);
        setHidden('cauchy_integral_results_info', true);
        return;
    }

    setHtml('zPlaneTitle', zPlaneTitle);
    setHtml(
        'wPlaneTitle',
        state.navigationModeEnabled
            ? `w-plane (Mapped Navigation: ${model.derivativePrefix}<code id="w-plane-title-func">${model.wOutputFormula}</code>)`
            : `w-plane (${model.wOutputDescriptor})`
    );
}

function syncTransformModeTitles() {
    if (!state.laplaceModeEnabled) {
        return false;
    }

    setHtml('zPlaneTitle', 'Time Domain (Signal)');
    setHtml('wPlaneTitle', 'Complex Frequency Domain (Laplace winding; Fourier at σ = 0)');
    setDisabled('inputShapeSelector', true);

    const laplace3DTitles = {
        magnitude: '3D Surface: |F(s)| Magnitude',
        phase: '3D Surface: ∠F(s) Phase',
        combined: '3D Surface: Combined View'
    };

    const vizMode = state.laplaceVizMode || 'magnitude';
    setHtml('laplace3DTitleLabel', laplace3DTitles[vizMode] ?? laplace3DTitles.combined);
    return true;
}

function syncRiemannSurfaceControls() {
    setHidden(
        'manifoldOptionsDiv',
        !state.manifold3dViewEnabled || state.riemannSurfaceEnabled
    );
    setHidden('riemannSurfaceOptionsDiv', !state.riemannSurfaceEnabled);
    setChecked('enableRiemannSurfaceCb', state.riemannSurfaceEnabled);
    setValue('riemannSurfaceComponentSelector', state.riemannSurfaceComponent);
    setChecked('riemannSurfaceWireframeCb', state.riemannSurfaceWireframe);
    setChecked('riemannSurfaceContoursCb', state.contoursEnabled);
    setValue('riemannSurfaceContourIntervalSlider', state.contourInterval);
    setText('riemannSurfaceContourIntervalValueDisplay', Number(state.contourInterval).toFixed(2));
    setValue('riemannSurfaceContourThicknessSlider', state.contourThickness);
    setText('riemannSurfaceContourThicknessValueDisplay', Number(state.contourThickness).toFixed(1));
    setHidden('riemannSurfaceContoursDetails', !state.contoursEnabled);

    if (control('riemannSurfaceStatus')) {
        const hasBranches = baseExpressionHasBranches(state);
        const indices = getVisibleBranchIndices(
            state.riemannSurfaceSheets,
            state.riemannSurfaceBranchCenter,
            hasBranches
        );

        setText(
            'riemannSurfaceStatus',
            hasBranches
                ? `GPU branch window: ${getBranchWindowLabel(indices)}`
                : 'GPU surface: this output is single-valued'
        );
    }

    setHidden(
        'manifoldSurfaceOptionsDiv',
        !state.manifold3dViewEnabled
    );
}

function syncDomainColoringControls() {
    setHidden('domainColoringOptionsDiv', !state.domainColoringEnabled);
    setHidden('orbitColoringModeGroup', !(state.domainColoringEnabled && state.chainingEnabled));

    const orbitSelector = control('orbitColoringModeSelect');
    if (orbitSelector) {
        const normalized = normalizeOrbitColoringMode(state.orbitColoringMode);
        state.orbitColoringMode = normalized;
        orbitSelector.value = normalized;
    }

    setChecked('showDomainColoringKeyCb', state.domainColoringKeyVisible);
    setHidden(
        'domainColoringKey',
        !state.domainColoringEnabled || !state.domainColoringKeyVisible
    );
    if (control('domainColoringKey')) {
        updateDomainColoringKey();
    }
}

function syncZetaControls() {
    const container = control('zetaSpecificControls');
    if (!container) {
        return;
    }

    const isZeta = collectActiveFunctionKeys().has('zeta');
    setHidden(container, !isZeta);

    if (!isZeta) {
        return;
    }

    setText(
        'toggleZetaContinuationBtn',
        state.zetaContinuationEnabled
            ? 'Disable Analytic Continuation'
            : 'Enable Analytic Continuation'
    );
    setActive('toggleZetaContinuationBtn', state.zetaContinuationEnabled);
}

function syncFunctionEquationCard() {
    const container = document.getElementById('function_equation_container');
    if (!container) return;

    if (state.algebraicChainingEnabled || state.laplaceModeEnabled) {
        container.classList.add('hidden');
        container.replaceChildren();
        return;
    }

    const func = state.currentFunction;
    if (!['gamma', 'loggamma', 'zeta', 'bessel'].includes(func)) {
        container.classList.add('hidden');
        container.replaceChildren();
        return;
    }

    container.classList.remove('hidden');

    let title = '';
    let badge = '';
    let mathHtml = '';
    let subtext = '';

    if (func === 'gamma') {
        title = 'Γ(z) Evaluation Formula';
        badge = 'Lanczos Approximation';
        mathHtml = `
            <math display="block" xmlns="http://www.w3.org/1998/Math/MathML">
              <mrow>
                <mi mathvariant="normal">Γ</mi><mo stretchy="false">(</mo><mi>z</mi><mo stretchy="false">)</mo>
                <mo>=</mo>
                <msqrt><mrow><mn>2</mn><mi>π</mi></mrow></msqrt>
                <msup>
                  <mrow><mo stretchy="false">(</mo><mi>z</mi><mo>+</mo><mi>g</mi><mo>−</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mo stretchy="false">)</mo></mrow>
                  <mrow><mi>z</mi><mo>−</mo><mfrac><mn>1</mn><mn>2</mn></mfrac></mrow>
                </msup>
                <msup>
                  <mi>e</mi>
                  <mrow><mo>−</mo><mo stretchy="false">(</mo><mi>z</mi><mo>+</mo><mi>g</mi><mo>−</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mo stretchy="false">)</mo></mrow>
                </msup>
                <mrow><mo>[</mo><mrow>
                  <msub><mi>c</mi><mn>0</mn></msub><mo>+</mo>
                  <munderover><mo>∑</mo><mrow><mi>k</mi><mo>=</mo><mn>1</mn></mrow><mi>N</mi></munderover>
                  <mfrac><msub><mi>c</mi><mi>k</mi></msub><mrow><mi>z</mi><mo>−</mo><mn>1</mn><mo>+</mo><mi>k</mi></mrow></mfrac>
                </mrow><mo>]</mo></mrow>
              </mrow>
            </math>
            <math display="block" xmlns="http://www.w3.org/1998/Math/MathML">
              <mrow>
                <mi mathvariant="normal">Γ</mi><mo stretchy="false">(</mo><mi>z</mi><mo stretchy="false">)</mo>
                <mo>=</mo>
                <mfrac>
                  <mi>π</mi>
                  <mrow><mi>sin</mi><mo stretchy="false">(</mo><mi>π</mi><mi>z</mi><mo stretchy="false">)</mo><mspace width="0.16em"/><mi mathvariant="normal">Γ</mi><mo stretchy="false">(</mo><mn>1</mn><mo>−</mo><mi>z</mi><mo stretchy="false">)</mo></mrow>
                </mfrac>
                <mspace width="1em"/><mtext class="math-condition">(for Re(z) &lt; 0.5)</mtext>
              </mrow>
            </math>`;
        subtext = 'Lanczos series (g = 6.5, N = 8) with Euler reflection for left half-plane.';
    } else if (func === 'loggamma') {
        title = 'log Γ(z) Evaluation Formula';
        badge = 'Analytic Continuation';
        mathHtml = `
            <math display="block" xmlns="http://www.w3.org/1998/Math/MathML">
              <mrow>
                <mi>log</mi><mi mathvariant="normal">Γ</mi><mo stretchy="false">(</mo><mi>z</mi><mo stretchy="false">)</mo>
                <mo>=</mo>
                <mfrac><mn>1</mn><mn>2</mn></mfrac><mi>ln</mi><mo stretchy="false">(</mo><mn>2</mn><mi>π</mi><mo stretchy="false">)</mo>
                <mo>+</mo>
                <mrow><mo stretchy="false">(</mo><mi>z</mi><mo>−</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mo stretchy="false">)</mo></mrow>
                <mi>ln</mi><mrow><mo stretchy="false">(</mo><mi>z</mi><mo>+</mo><mi>g</mi><mo>−</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mo stretchy="false">)</mo></mrow>
                <mo>−</mo>
                <mrow><mo stretchy="false">(</mo><mi>z</mi><mo>+</mo><mi>g</mi><mo>−</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mo stretchy="false">)</mo></mrow>
                <mo>+</mo>
                <mi>ln</mi><mrow><mo>[</mo><mrow>
                  <msub><mi>c</mi><mn>0</mn></msub><mo>+</mo>
                  <munderover><mo>∑</mo><mrow><mi>k</mi><mo>=</mo><mn>1</mn></mrow><mi>N</mi></munderover>
                  <mfrac><msub><mi>c</mi><mi>k</mi></msub><mrow><mi>z</mi><mo>−</mo><mn>1</mn><mo>+</mo><mi>k</mi></mrow></mfrac>
                </mrow><mo>]</mo></mrow>
              </mrow>
            </math>
            <math display="block" xmlns="http://www.w3.org/1998/Math/MathML">
              <mrow>
                <mi>log</mi><mi mathvariant="normal">Γ</mi><mo stretchy="false">(</mo><mi>z</mi><mo stretchy="false">)</mo>
                <mo>=</mo>
                <mi>ln</mi><mo stretchy="false">(</mo><mi>π</mi><mo stretchy="false">)</mo>
                <mo>−</mo>
                <mi>ln</mi><mrow><mo stretchy="false">(</mo><mi>sin</mi><mo stretchy="false">(</mo><mi>π</mi><mi>z</mi><mo stretchy="false">)</mo><mo stretchy="false">)</mo></mrow>
                <mo>−</mo>
                <mi>log</mi><mi mathvariant="normal">Γ</mi><mo stretchy="false">(</mo><mn>1</mn><mo>−</mo><mi>z</mi><mo stretchy="false">)</mo>
                <mspace width="1em"/><mtext class="math-condition">(for Re(z) &lt; 0.5)</mtext>
              </mrow>
            </math>`;
        subtext = 'Direct Log-Gamma evaluation with unwrapped phase continuation.';
    } else if (func === 'zeta') {
        if (!state.zetaContinuationEnabled) {
            title = 'ζ(z) Dirichlet Series';
            badge = 'Re(s) > 1 Only';
            mathHtml = `
                <math display="block" xmlns="http://www.w3.org/1998/Math/MathML">
                  <mrow>
                    <mi>ζ</mi><mo stretchy="false">(</mo><mi>s</mi><mo stretchy="false">)</mo>
                    <mo>=</mo>
                    <munderover><mo>∑</mo><mrow><mi>n</mi><mo>=</mo><mn>1</mn></mrow><mi>∞</mi></munderover>
                    <mfrac><mn>1</mn><msup><mi>n</mi><mi>s</mi></msup></mfrac>
                    <mo>=</mo>
                    <mfrac><mn>1</mn><mrow><mn>1</mn><mo>−</mo><msup><mn>2</mn><mrow><mn>1</mn><mo>−</mo><mi>s</mi></mrow></msup></mrow></mfrac>
                    <munderover><mo>∑</mo><mrow><mi>n</mi><mo>=</mo><mn>1</mn></mrow><mi>N</mi></munderover>
                    <mfrac><msup><mrow><mo stretchy="false">(</mo><mo>−</mo><mn>1</mn><mo stretchy="false">)</mo></mrow><mrow><mi>n</mi><mo>−</mo><mn>1</mn></mrow></msup><msup><mi>n</mi><mi>s</mi></msup></mfrac>
                    <mspace width="1em"/><mtext class="math-condition">(Re(s) &gt; 1)</mtext>
                  </mrow>
                </math>`;
            subtext = 'Standard Dirichlet series. Non-convergent for Re(s) ≤ 1.';
        } else {
            title = 'ζ(z) Analytic Continuation';
            badge = 'Dirichlet η(s) & Functional Eq';
            mathHtml = `
                <math display="block" xmlns="http://www.w3.org/1998/Math/MathML">
                  <mrow>
                    <mi>ζ</mi><mo stretchy="false">(</mo><mi>s</mi><mo stretchy="false">)</mo>
                    <mo>=</mo>
                    <mfrac><mrow><mi>η</mi><mo stretchy="false">(</mo><mi>s</mi><mo stretchy="false">)</mo></mrow><mrow><mn>1</mn><mo>−</mo><msup><mn>2</mn><mrow><mn>1</mn><mo>−</mo><mi>s</mi></mrow></msup></mrow></mfrac>
                    <mo>=</mo>
                    <mfrac><mn>1</mn><mrow><mn>1</mn><mo>−</mo><msup><mn>2</mn><mrow><mn>1</mn><mo>−</mo><mi>s</mi></mrow></msup></mrow></mfrac>
                    <munderover><mo>∑</mo><mrow><mi>n</mi><mo>=</mo><mn>1</mn></mrow><mi>N</mi></munderover>
                    <mfrac><msup><mrow><mo stretchy="false">(</mo><mo>−</mo><mn>1</mn><mo stretchy="false">)</mo></mrow><mrow><mi>n</mi><mo>−</mo><mn>1</mn></mrow></msup><msup><mi>n</mi><mi>s</mi></msup></mfrac>
                    <mspace width="1em"/><mtext class="math-condition">(s ≠ 1)</mtext>
                  </mrow>
                </math>
                <math display="block" xmlns="http://www.w3.org/1998/Math/MathML">
                  <mrow>
                    <mi>ζ</mi><mo stretchy="false">(</mo><mi>s</mi><mo stretchy="false">)</mo>
                    <mo>=</mo>
                    <msup><mn>2</mn><mi>s</mi></msup>
                    <msup><mi>π</mi><mrow><mi>s</mi><mo>−</mo><mn>1</mn></mrow></msup>
                    <mi>sin</mi><mrow><mo stretchy="false">(</mo><mfrac><mrow><mi>π</mi><mi>s</mi></mrow><mn>2</mn></mfrac><mo stretchy="false">)</mo></mrow>
                    <mi mathvariant="normal">Γ</mi><mo stretchy="false">(</mo><mn>1</mn><mo>−</mo><mi>s</mi><mo stretchy="false">)</mo>
                    <mi>ζ</mi><mo stretchy="false">(</mo><mn>1</mn><mo>−</mo><mi>s</mi><mo stretchy="false">)</mo>
                    <mspace width="1em"/><mtext class="math-condition">(Re(s) &lt; 0)</mtext>
                  </mrow>
                </math>`;
            subtext = 'Analytic continuation via alternating Dirichlet Eta series and Riemann functional reflection.';
        }
    } else if (func === 'bessel') {
        title = 'J_ν(z) Bessel Series';
        badge = 'Order ν Power Series';
        mathHtml = `
            <math display="block" xmlns="http://www.w3.org/1998/Math/MathML">
              <mrow>
                <msub><mi>J</mi><mi>ν</mi></msub><mo stretchy="false">(</mo><mi>z</mi><mo stretchy="false">)</mo>
                <mo>=</mo>
                <msup><mrow><mo stretchy="false">(</mo><mfrac><mi>z</mi><mn>2</mn></mfrac><mo stretchy="false">)</mo></mrow><mi>ν</mi></msup>
                <munderover><mo>∑</mo><mrow><mi>k</mi><mo>=</mo><mn>0</mn></mrow><mi>∞</mi></munderover>
                <mfrac><msup><mrow><mo stretchy="false">(</mo><mo>−</mo><mn>1</mn><mo stretchy="false">)</mo></mrow><mi>k</mi></msup><mrow><mi>k</mi><mo>!</mo><mspace width="0.16em"/><mi mathvariant="normal">Γ</mi><mo stretchy="false">(</mo><mi>ν</mi><mo>+</mo><mi>k</mi><mo>+</mo><mn>1</mn><mo stretchy="false">)</mo></mrow></mfrac>
                <msup><mrow><mo stretchy="false">(</mo><mfrac><mi>z</mi><mn>2</mn></mfrac><mo stretchy="false">)</mo></mrow><mrow><mn>2</mn><mi>k</mi></mrow></msup>
              </mrow>
            </math>
            <math display="block" xmlns="http://www.w3.org/1998/Math/MathML">
              <mrow>
                <msub><mi>J</mi><mrow><mo>−</mo><mi>n</mi></mrow></msub><mo stretchy="false">(</mo><mi>z</mi><mo stretchy="false">)</mo>
                <mo>=</mo>
                <msup><mrow><mo stretchy="false">(</mo><mo>−</mo><mn>1</mn><mo stretchy="false">)</mo></mrow><mi>n</mi></msup>
                <msub><mi>J</mi><mi>n</mi></msub><mo stretchy="false">(</mo><mi>z</mi><mo stretchy="false">)</mo>
                <mspace width="1em"/><mtext class="math-condition">(for integer n)</mtext>
              </mrow>
            </math>`;
        subtext = 'Frobenius power series expansion of the Bessel function of the first kind.';
    }

    container.innerHTML = `
        <div class="function-equation-card">
            <div class="function-equation-header">
                <span class="function-equation-title">${title}</span>
                <span class="function-equation-badge">${badge}</span>
            </div>
            <div class="function-equation-content">
                ${mathHtml}
            </div>
            <div class="function-equation-subtext">${subtext}</div>
        </div>
    `;
}

function syncVisualizationOptionControls() {
    const transformHubActive = state.laplaceModeEnabled || state.graphFourierEnabled;
    setHidden('visualizationOptionsPanel', transformHubActive);
    setDisabled('inputShapeSelector', state.laplaceModeEnabled);
    syncRiemannSurfaceControls();
    syncDomainColoringControls();
    setHidden('radialDiscreteStepsOptionsDiv', !state.radialDiscreteStepsEnabled);
    syncZetaControls();
    syncFunctionEquationCard();
}

export function updateTitlesAndGlobalUI() {
    runUiTransaction('updateTitlesAndGlobalUI', () => {
        updateSliderLabelsAndDisplay();
        updateProbeInfo();

        if (syncTransformModeTitles()) {
            sync2DContourUI();
            syncGridShapeControls();
            return;
        }

        syncPrimaryPlaneTitles();
        syncVisualizationOptionControls();
        syncManifoldTransformationUI();
        sync2DContourUI();
        syncGridShapeControls();
    });
}

export function updateDomainColoringKey() {
    const keyDiv = control('domainColoringKey');
    if (!keyDiv) {
        return;
    }

    const paletteId = state.domainPalette || 'analytic-base';
    const paletteObj = domainPalettes.find(palette => palette.id === paletteId) || domainPalettes[0];
    const orbitMode = normalizeOrbitColoringMode(state.orbitColoringMode);
    const content = document.createDocumentFragment();
    const appendLine = (text, className = '') => {
        const line = document.createElement('span');
        line.className = className;
        line.textContent = text;
        content.append(line, document.createElement('br'));
    };

    const title = document.createElement('strong');
    title.textContent = 'Domain Coloring Key:';
    content.append(title, document.createElement('br'));
    if (paletteObj?.key) {
        appendLine('- Color maps to Argument (Angle):', 'domain-key-line');
        for (const item of paletteObj.key) {
            const row = document.createElement('span');
            row.className = 'domain-key-entry';
            const label = document.createElement('strong');
            label.style.color = item.color;
            label.textContent = item.label;
            row.append(label, document.createTextNode(`: Arg = ${item.angle}`));
            content.append(row, document.createElement('br'));
        }
    }
    if (state.chainingEnabled) {
        appendLine(`- Orbit observable: ${ORBIT_COLORING_MODE_LABELS[orbitMode] || orbitMode}`, 'domain-key-note');
    }
    appendLine('- Optional lightness shading can emphasize magnitude.', 'domain-key-note');
    keyDiv.replaceChildren(content);
}

export function syncManifoldTransformationUI() {
    const isManifoldActive = Boolean(state.manifold3dViewEnabled);
    const isTransformActive = Boolean(state.manifoldTransformationEnabled && isManifoldActive);

    const overlayZ = document.getElementById('z_plane_transformation_overlay');
    const containerZ = document.getElementById('z_plane_threejs_container');
    const canvasZ = document.getElementById('z_plane_canvas');

    const overlayW = document.getElementById('w_plane_transformation_overlay');
    const containerW = document.getElementById('w_plane_threejs_container');
    const canvasW = document.getElementById('w_plane_canvas');

    // Left panel (Z): In Mode 1 (3D Manifolds), Z is 2D canvas. Only in Mode 2 (Show Transformation) does Z switch to 3D.
    if (overlayZ) overlayZ.classList.toggle('hidden', !isTransformActive);
    if (containerZ) containerZ.classList.toggle('hidden', !isTransformActive);
    if (canvasZ) canvasZ.classList.toggle('hidden', isTransformActive);

    // Right panel (W): Shows 3D Manifold whenever 3D Manifolds is enabled. Shows HUD overlay during transformation.
    if (overlayW) overlayW.classList.toggle('hidden', !isTransformActive);
    if (containerW) containerW.classList.toggle('hidden', !isManifoldActive);
    if (canvasW) canvasW.classList.toggle('hidden', isManifoldActive);

    const manifoldOptionsDiv = document.getElementById('manifold_options_div');
    if (manifoldOptionsDiv) {
        manifoldOptionsDiv.classList.toggle('hidden', !isManifoldActive);
    }

    const selector = document.getElementById('manifold_shape_selector');
    if (selector && selector.value !== state.selectedManifold) {
        selector.value = state.selectedManifold || 'sphere';
    }

    const manifoldCb = document.getElementById('enable_manifold_3d_cb');
    if (manifoldCb && manifoldCb.checked !== state.manifold3dViewEnabled) {
        manifoldCb.checked = state.manifold3dViewEnabled;
    }

    const transCb = document.getElementById('enable_manifold_transformation_cb');
    if (transCb && transCb.checked !== state.manifoldTransformationEnabled) {
        transCb.checked = state.manifoldTransformationEnabled;
    }

    if (isManifoldActive) {
        initThreeJSRenderers();
        buildThreeJSMeshes();
        if (isTransformActive) {
            startManifoldTransformationAnimation();
        } else {
            stopManifoldTransformationAnimation();
            syncManifoldSliders();
        }
        syncManifoldTransformationPlayPauseButton();
    } else {
        stopManifoldTransformationAnimation();
        disposeThreeJSRenderers();
    }
}

export function syncRealPlotsUI() {
    const inputPreset = document.getElementById('real_plots_input_preset');
    const imagPreset = document.getElementById('real_plots_imag_preset');
    const customInputContainer = document.getElementById('real_plots_custom_input_container');
    const customImagContainer = document.getElementById('real_plots_custom_imag_container');
    const customInput = document.getElementById('real_plots_custom_input');
    const customImag = document.getElementById('real_plots_custom_imag');
    const customInputMath = document.getElementById('real_plots_custom_input_math');
    const customImagMath = document.getElementById('real_plots_custom_imag_math');

    if (!inputPreset || !imagPreset) return;

    const uVal = state.realPlotsInputExpr || 'x';
    const vVal = state.realPlotsImagExpr || '0';

    if (!state.realPlotsInputIsCustom) {
        inputPreset.value = uVal;
        if (customInputContainer) customInputContainer.classList.add('hidden');
    } else {
        inputPreset.value = 'custom';
        if (customInputContainer) customInputContainer.classList.remove('hidden');
        if (customInput && customInput.value !== uVal) {
            customInput.value = uVal;
        }
        updateCustomFormulaPreview(customInput, customInputMath);
    }

    if (!state.realPlotsImagIsCustom) {
        imagPreset.value = vVal;
        if (customImagContainer) customImagContainer.classList.add('hidden');
    } else {
        imagPreset.value = 'custom';
        if (customImagContainer) customImagContainer.classList.remove('hidden');
        if (customImag && customImag.value !== vVal) {
            customImag.value = vVal;
        }
        updateCustomFormulaPreview(customImag, customImagMath);
    }

    const colorModeEl = document.getElementById('real_plots_color_mode');
    if (colorModeEl && state.realPlotsColorMode) {
        colorModeEl.value = state.realPlotsColorMode;
    }

    const outputCompEl = document.getElementById('real_plots_output_component');
    if (outputCompEl && state.realPlotsOutputComponent) {
        outputCompEl.value = state.realPlotsOutputComponent;
    }

    const brightnessSlider = document.getElementById('real_plots_brightness_slider');
    const brightnessDisplay = document.getElementById('real_plots_brightness_value_display');
    if (brightnessSlider && state.realPlotsBrightness !== undefined) {
        brightnessSlider.value = String(state.realPlotsBrightness);
        if (brightnessDisplay) {
            brightnessDisplay.textContent = Number(state.realPlotsBrightness).toFixed(2);
        }
    }

    const contrastSlider = document.getElementById('real_plots_contrast_slider');
    const contrastDisplay = document.getElementById('real_plots_contrast_value_display');
    if (contrastSlider && state.realPlotsContrast !== undefined) {
        contrastSlider.value = String(state.realPlotsContrast);
        if (contrastDisplay) {
            contrastDisplay.textContent = Number(state.realPlotsContrast).toFixed(2);
        }
    }

    const saturationSlider = document.getElementById('real_plots_saturation_slider');
    const saturationDisplay = document.getElementById('real_plots_saturation_value_display');
    if (saturationSlider && state.realPlotsSaturation !== undefined) {
        saturationSlider.value = String(state.realPlotsSaturation);
        if (saturationDisplay) {
            saturationDisplay.textContent = Number(state.realPlotsSaturation).toFixed(2);
        }
    }

    const heightScaleSlider = document.getElementById('real_plots_height_scale_slider');
    const heightScaleDisplay = document.getElementById('real_plots_height_scale_value_display');
    if (heightScaleSlider && state.realPlotsHeightScale !== undefined) {
        heightScaleSlider.value = String(state.realPlotsHeightScale);
        if (heightScaleDisplay) {
            heightScaleDisplay.textContent = Number(state.realPlotsHeightScale).toFixed(2);
        }
    }

    // Sync Real Plots Contours
    setChecked('realPlotsContoursCb', state.contoursEnabled);
    setValue('realPlotsContourIntervalSlider', state.contourInterval);
    setText('realPlotsContourIntervalValueDisplay', Number(state.contourInterval).toFixed(2));
    setValue('realPlotsContourThicknessSlider', state.contourThickness);
    setText('realPlotsContourThicknessValueDisplay', Number(state.contourThickness).toFixed(1));
    setHidden('realPlotsContoursDetails', !state.contoursEnabled);
}

export function updateCustomFormulaPreview(inputEl, displayEl, options = {}) {
    if (!inputEl || !displayEl) return;
    displayEl.replaceChildren();
    const source = inputEl.value.trim();
    try {
        compileExpression(source, options);
        const mathNode = createExpressionMathML(source, options);
        displayEl.appendChild(mathNode);
        displayEl.classList.remove('dynamic-math-error');
        inputEl.setCustomValidity('');
    } catch (error) {
        const message = error?.message || String(error);
        displayEl.textContent = message;
        displayEl.classList.add('dynamic-math-error');
        inputEl.setCustomValidity(message);
    }
}

export function sync2DContourUI() {
    const hasSurface = state.realPlotsEnabled || state.riemannSurfaceEnabled || state.laplaceModeEnabled;
    if (!hasSurface) state.show2DContourPlot = false;
    const showContour = state.show2DContourPlot && hasSurface;

    // Toggle button active states and labels
    const active = state.show2DContourPlot;
    [
        control('riemannSurfaceShow2DContourBtn'),
        control('realPlotsShow2DContourBtn'),
        control('laplaceShow2DContourBtn')
    ].forEach(btn => {
        if (btn) {
            btn.classList.toggle('contour-btn-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            const textSpan = btn.querySelector('span');
            if (textSpan) {
                textSpan.textContent = active ? 'Hide 2D Contour Plot' : 'Show 2D Contour Plot';
            }
            const icon = btn.querySelector('[data-lucide]');
            if (icon) {
                icon.setAttribute('data-lucide', active ? 'image-off' : 'image');
            }
        }
    });

    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }

    // Update column visibility
    const contourCol = control('contour2DColumn');
    if (contourCol) {
        contourCol.classList.toggle('hidden', !showContour);
    }

    if (state.realPlotsEnabled) {
        // Real plots active: z_plane and w_plane are hidden, real_plots is visible
        const zCard = control('zPlaneColumn');
        const wCard = control('wPlaneColumn');
        const rpCol = control('realPlotsColumn');
        if (zCard) zCard.classList.add('hidden');
        if (wCard) wCard.classList.add('hidden');
        if (rpCol) rpCol.classList.remove('hidden');
    } else if (state.riemannSurfaceEnabled) {
        // Riemann surface active:
        // If showContour is true, hide the z-plane column so the 3D Riemann and 2D contour views sit side by side.
        // If showContour is false, restore both plane columns.
        const zCard = control('zPlaneColumn');
        const wCard = control('wPlaneColumn');
        const rpCol = control('realPlotsColumn');
        if (rpCol) rpCol.classList.add('hidden');
        if (zCard) {
            zCard.classList.toggle('hidden', showContour);
        }
        if (wCard) {
            wCard.classList.remove('hidden');
        }
    } else if (state.laplaceModeEnabled) {
        control('realPlotsColumn')?.classList.add('hidden');
    } else {
        // Neither 3D plot is active: hide the 2D contour plot column
        if (contourCol) {
            contourCol.classList.add('hidden');
        }
    }

    refreshPanelEdgeHandles();
}
