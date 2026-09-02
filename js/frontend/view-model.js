import { h } from 'preact';
import { state, context, sliderParamKeys, zPlaneParams, wPlaneParams, wPlaneInitialRanges } from '../store/state.js';
import { runtime } from '../store/runtime.js';
import { resolveActiveMap } from '../math/active-map.js';
import { DEFAULT_TAYLOR_SERIES_CENTER, CRITICAL_POINT_EPSILON, MIN_STATE_ZOOM_LEVEL, MAX_STATE_ZOOM_LEVEL } from '../constants/numerical.js';
import {
    ORBIT_COLORING_MODE_LABELS,
    normalizeOrbitColoringMode
} from '../constants/rendering.js';
import { findTaylorCenterPreset, formatTaylorNumericValue, getChainingTitleHTML } from '../utils/dom-utils.js';
import { baseExpressionHasBranches } from '../analysis/riemann-surface.js';
import { domainPalettes } from '../constants/domain-palettes.js';
import { getDynamicFunctionFormulaHtml } from '../analysis/dynamic-plotting.js';
import { compileExpression, createExpressionMathML } from '../math/expression/index.js';
import { isFoldableInputShape } from '../rendering/shape-generators.js';
import { CUSTOM_GRID_INPUT_SHAPE_SET } from '../constants/grid-shapes.js';
import { getManifold } from '../rendering/manifold-registry.js';
import { requireFiniteComplex, requireFiniteNumber, isFiniteComplex } from '../utils/numeric-contracts.js';
import { generateTissotIndicatrices, selectStableTissotIndicatrices, getTissotViewportBounds } from '../analysis/tissot.js';
import { nativeOptionsForActiveMap } from '../native/map-runtime.js';
import { setPlaneViewport } from '../utils/canvas-utils.js';
import { controlKeyFromId } from '../ui/control-registry.js';
import { getCauchyDisplay, getWindingDisplay } from '../analysis/cauchy.js';
import { isGraphViewSupported } from '../rendering/transformation-graph.js';

const { controls = {} } = context;
const modelProps = new Map();

function patchProps(key, patch) {
    modelProps.set(key, { ...modelProps.get(key), ...patch });
}

function patchClass(key, name, enabled) {
    const current = modelProps.get(key) || {};
    patchProps(key, { $classes: { ...current.$classes, [name]: Boolean(enabled) } });
}

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
}

const HIDDEN_CLASS = 'hidden';
const VISUALLY_HIDDEN_CLASS = 'hidden-visually';
const EPS = 1e-9;

export function syncLaplacePlayPauseButton() {
    setText('laplacePlayPauseBtn', state.laplaceAnimationPlaying ? 'Pause' : 'Play');
}

const CENTER_LABELS = {
    line: [
        'Fixed Re(z) (<code>a<sub>0</sub></code>):',
        'Fixed Im(z) (<code>b<sub>0</sub></code>):'
    ],
    media: [
        'Media Center Re (<code>a<sub>0</sub></code>):',
        'Media Center Im (<code>b<sub>0</sub></code>):'
    ],
    default: [
        'Center Re(z<sub>0</sub>) (<code>a<sub>0</sub></code>):',
        'Center Im(z<sub>0</sub>) (<code>b<sub>0</sub></code>):'
    ]
};

const INPUT_SHAPE_TITLE_SUFFIX = {
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
    navigate: ': Navigation',
    empty_grid: ': Empty'
};

const SHAPE_SPECIFIC_GROUPS = {
    circle: 'circleRSliderGroup'
};

const SIMPLE_FUNCTION_LABELS = {
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
};

const FUNCTION_ARGUMENT_HTML = {
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
};

const NORMAL_MODE_VALUE_BINDINGS = Object.freeze([
    { display: 'chainCountValueDisplay', key: 'chainCount', companion: 'chainCountSlider' },
    { display: 'gridDensityValueDisplay', key: 'gridDensity' },
    { display: 'riemannSurfaceResolutionValueDisplay', key: 'riemannSurfaceResolution', companion: 'riemannSurfaceResolutionSlider' },
    { display: 'neighborhoodSizeValueDisplay', key: 'probeNeighborhoodSize', digits: 2 },
    { display: 'vectorFieldScaleValueDisplay', key: 'vectorFieldScale', digits: 2, companion: 'vectorFieldScaleSlider' },
    { display: 'vectorArrowThicknessValueDisplay', key: 'vectorArrowThickness', digits: 1, companion: 'vectorArrowThicknessSlider' },
    { display: 'vectorArrowHeadSizeValueDisplay', key: 'vectorArrowHeadSize', digits: 1, companion: 'vectorArrowHeadSizeSlider' },
    { display: 'domainBrightnessValueDisplay', key: 'domainBrightness', digits: 2, companion: 'domainBrightnessSlider' },
    { display: 'domainContrastValueDisplay', key: 'domainContrast', digits: 2, companion: 'domainContrastSlider' },
    { display: 'domainSaturationValueDisplay', key: 'domainSaturation', digits: 2, companion: 'domainSaturationSlider' },
    { display: 'domainLightnessCyclesValueDisplay', key: 'domainLightnessCycles', digits: 2, companion: 'domainLightnessCyclesSlider' },
    { display: 'mediaSizeValueDisplay', key: 'mediaSize', digits: 1, companion: 'mediaSizeSlider' },
    { display: 'mediaOpacityValueDisplay', key: 'mediaOpacity', digits: 2, companion: 'mediaOpacitySlider' },
    { display: 'videoFpsValueDisplay', key: 'videoProcessingFps', companion: 'videoFpsSlider' },
    {
        display: 'radialDiscreteStepsCountValueDisplay',
        key: 'radialDiscreteStepsCount',
        companion: 'radialDiscreteStepsCountSlider',
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
    { display: 'riemannSurfaceSheetsValueDisplay', key: 'riemannSurfaceSheets', companion: 'riemannSurfaceSheetsSlider' },
    { display: 'riemannSurfaceBranchCenterValueDisplay', key: 'riemannSurfaceBranchCenter', companion: 'riemannSurfaceBranchCenterSlider' },
    { display: 'riemannSurfaceHeightScaleValueDisplay', key: 'riemannSurfaceHeightScale', digits: 2, companion: 'riemannSurfaceHeightScaleSlider' },
    { display: 'gridSurface3DHeightScaleValueDisplay', key: 'foldSurfaceHeightScale', digits: 2, companion: 'gridSurface3DHeightScaleSlider' },
    { display: 'riemannSurfaceHeightClipValueDisplay', key: 'riemannSurfaceHeightClip', digits: 1, companion: 'riemannSurfaceHeightClipSlider' }
]);

const LAPLACE_VALUE_BINDINGS = Object.freeze([
    { display: 'laplaceFrequencyValueDisplay', key: 'laplaceFrequency', digits: 1, companion: 'laplaceFrequencySlider' },
    { display: 'laplaceDampingValueDisplay', key: 'laplaceDamping', digits: 1, companion: 'laplaceDampingSlider' },
    { display: 'laplaceAmplitudeValueDisplay', key: 'laplaceAmplitude', digits: 1, companion: 'laplaceAmplitudeSlider' },
    { display: 'laplaceTimeWindowValueDisplay', key: 'laplaceTimeWindow', digits: 1, companion: 'laplaceTimeWindowSlider' },
    { display: 'laplaceSamplesValueDisplay', key: 'laplaceSamples', companion: 'laplaceSamplesSlider' },
    { display: 'laplaceSigmaValueDisplay', key: 'laplaceSigma', digits: 1, companion: 'laplaceSigmaSlider' },
    { display: 'laplaceOmegaValueDisplay', key: 'laplaceOmega', digits: 1, companion: 'laplaceOmegaSlider' },
    { display: 'laplaceWindingFrequencyValueDisplay', key: 'laplaceOmega', digits: 1, companion: 'laplaceWindingFrequencySlider' },
    { display: 'laplaceAnimationTimeValueDisplay', get: () => Math.round(state.laplaceAnimationTime * 100), companion: 'laplaceAnimationTimeSlider' },
    { display: 'laplaceAnimationSpeedDisplay', key: 'laplaceAnimationSpeed', digits: 1, companion: 'laplaceAnimationSpeedSlider' },
    { display: 'laplaceClipHeightValueDisplay', key: 'laplaceClipHeight', digits: 0, companion: 'laplaceClipHeightSlider' },
    { display: 'laplaceFourier3DCountValueDisplay', key: 'fourier3DParallelGraphs', companion: 'laplaceFourier3DCountSlider' }
]);

function control(key) {
    return controls[key] ?? null;
}

function resolveControl(target) {
    if (!target) return null;
    return typeof target === 'string' ? control(target) : target;
}

function setHidden(target, hidden = true) {
    const key = typeof target === 'string' ? target : target?.id;
    if (key) patchClass(key, HIDDEN_CLASS, hidden);
}

function setActive(target, active = true) {
    const key = typeof target === 'string' ? target : target?.id;
    if (key) patchClass(key, 'active', active);
}

function setText(key, value) {
    if (value !== undefined && value !== null) patchProps(key, { children: String(value) });
}

function setHtml(key, html) {
    patchProps(key, { dangerouslySetInnerHTML: { __html: String(html) }, children: null });
}

function setChecked(key, checked) {
    patchProps(key, { checked: Boolean(checked) });
}

function setDisabled(key, disabled) {
    patchProps(key, { disabled: Boolean(disabled) });
}

function setValue(target, value) {
    const key = typeof target === 'string' ? target : target?.id;
    if (key && value !== undefined && value !== null) patchProps(key, { value });
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
        if (binding.guard && !binding.guard()) continue;
        const value = binding.get ? binding.get() : state[binding.key];
        if (value !== undefined && value !== null) {
            setText(binding.display, binding.digits === undefined ? value : toFixedText(value, binding.digits));
            if (binding.companion) setValue(binding.companion, value);
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

function syncDelegates() {
    syncLaplacePlayPauseButton();
}

export function syncParameterControlsPanelVisibility() {
    setHidden('parameterControlsPanel', false);
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
        const value = state[key];
        if (typeof value !== 'number' || Number.isNaN(value)) continue;
        setValue(`${key}Slider`, value);
        const stepPrecision = 2;
        const basePrecision = highPrecisionKeys.has(key) ? 2 : 1;
        setText(`${key}ValueDisplay`, value.toFixed(Math.max(stepPrecision, basePrecision)));
    }
}

function syncMobiusDisplays() {
    for (const param of ['A', 'B', 'C', 'D']) {
        const value = state[`mobius${param}`];

        if (!value) {
            continue;
        }

        setValue(`mobius${param}ReSlider`, value.re);
        setValue(`mobius${param}ImSlider`, value.im);
        setFixedText(`mobius${param}ReValueDisplay`, value.re, 1);
        setFixedText(`mobius${param}ImValueDisplay`, value.im, 1);
    }
}



function syncPolynomialDisplays() {
    setValue('polynomialNSlider', state.polynomialN);
    setText('polynomialNValueDisplay', state.polynomialN);
}

function syncFractionalPowerDisplays() {
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
    setHidden('algebraicChainingControlsContainer', !state.algebraicChainingEnabled);
    setHidden('chainSeedControl', !state.chainingEnabled || state.chainingMode !== 'zero_seed');
    setValue('inputShapeSelector', state.currentInputShape);

    const shape = state.currentInputShape;
    const activeFunctions = collectActiveFunctionKeys();
    const isLine = shape === 'line';
    const isCircle = shape === 'circle';
    const isMedia = shape === 'media';
    const isGrid = isFoldableInputShape(shape);
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
    const hasBranches = baseExpressionHasBranches(state) || state.currentFunction === 'power';
    setHidden('branchToolsControls', !hasBranches);
    const isFixedBranchCut = ['asin', 'atan', 'loggamma'].includes(state.currentFunction);
    setHidden('branchCutAngleGroup', !hasBranches || isFixedBranchCut);
    setValue('branchCutAngleSlider', state.branchCutAngle);
    setText('branchCutAngleValueDisplay', Math.abs(state.branchCutAngle - Math.PI) < 1e-6 ? 'π' : `${(state.branchCutAngle / Math.PI).toFixed(2)}π`);

    setHidden('drawContinuationPathBtn', !hasBranches);
    setActive('drawContinuationPathBtn', state.branchDrawMode === 'path');
    setText('drawContinuationPathBtn', state.branchDrawMode === 'path' ? 'Drawing Path…' : 'Continue Along Path');

    const continuationDone = Array.isArray(state.continuationPath) && state.continuationPath.length > 1;
    setHidden('resetContinuationBtn', !continuationDone);
    setHidden('mediaUploadControls', !isMedia);
    setHidden('mediaVideoControls', !isMedia || !runtime.media.video);
    setHidden('arbitraryShapeControls', !isArbitrary);
    setValue('arbitraryShapeExpressionInput', state.arbitraryShapeExpression);
    setFormulaPreview('arbitraryShapeExpressionMath', state.arbitraryShapeExpression, { allowedVariables: ['t'] });
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
    const isFoldActive = Boolean(state.foldSurface3dEnabled && (isGrid || isMedia));
    setHidden('wPlaneFoldsOverlay', !isFoldActive);
    setHidden('wPlaneThreeContainer', !isFoldActive);
    setValue('algebraicChainingZInput', state.algebraicChainingZExpr);
    setFormulaPreview('algebraicChainingZMath', state.algebraicChainingZExpr, { allowedVariables: ['z'] });

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
}

function syncTaylorControls() {
    setHidden('taylorSeriesOptionsDetailDiv', !state.taylorSeriesEnabled && state.contextMenuPanel !== 'taylor');
    patchClass('pickTaylorCenterCanvasBtn', 'is-picking', state.taylorSeriesCanvasClickCenterEnabled);
    setText('pickTaylorCenterBtnText', state.taylorSeriesCanvasClickCenterEnabled
        ? 'Click Canvas to Pin z₀…'
        : 'Pick Center on Canvas');
    syncTaylorSeriesCenterStatus();
}

function syncVectorFlowControls() {
    const isAnyActive = Boolean(state.vectorFieldEnabled || state.streamlineFlowEnabled || state.particleAnimationEnabled);
    setHidden('vectorFlowCanvasOverlay', !isAnyActive);
    setHidden('vectorFieldOptionsDiv', !state.vectorFieldEnabled);
    setHidden('streamlineOptionsDetailsDiv', !state.streamlineFlowEnabled);
    setHidden('particleAnimationDetailsDiv', !state.particleAnimationEnabled);
    syncValueBindings(STREAMLINE_VALUE_BINDINGS);
    syncValueBindings(PARTICLE_VALUE_BINDINGS);
}

function syncModeControlPanels() {
    const transformHubActive = state.laplaceModeEnabled || state.graphFourierEnabled;
    setHidden('coreApplicationControls', state.laplaceModeEnabled || state.realPlotsEnabled);
    setHidden('laplaceSpecificControls', !transformHubActive);
    setHidden('realPlotsControlsContainer', !state.realPlotsEnabled);
    setHidden(
        'algebraicChainingParams',
        state.laplaceModeEnabled || !(state.realPlotsEnabled || state.algebraicChainingEnabled)
    );
    setHidden('inputShapeSelector', state.laplaceModeEnabled);
}

function syncRiemannAndTransformDisplays() {
    syncModeControlPanels();
    const graphSource = state.graphFourierEnabled && !state.laplaceModeEnabled;
    patchProps('laplaceCurrentGraphOption', { hidden: !graphSource });
    patchProps('laplaceFunctionSelector', {
        disabled: graphSource,
        value: graphSource ? 'current_graph' : state.laplaceFunction,
        'data-tooltip': graphSource
            ? 'The current graph supplies the signal for the σ = 0 Laplace slice'
            : 'Select the time-domain signal type'
    });
    setText('laplaceSignalSectionTitle', graphSource ? 'Graph Signal' : 'Signal Configuration');
    setText('laplaceFunctionLabel', graphSource ? 'Source' : 'Waveform Type');
    setText('laplaceFrequencyLabel', 'Frequency:');
    setHidden('laplace3DControlsSection', graphSource || state.laplaceHide3DSurface);
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
    setHidden('laplace3DColumn', !state.laplaceModeEnabled || state.laplaceHide3DSurface);
    setHidden('laplaceSpectrumColumn', !state.laplaceModeEnabled || !state.laplaceShowSpectrum);
    setHidden('laplaceComColumn', !state.laplaceModeEnabled || !state.laplaceShowComGraph);
    setHidden('fourier3DColumn', !state.laplaceModeEnabled || !state.laplaceShowFourier3D);
    syncContourControls('laplace');
    syncValueBindings(RIEMANN_VIEW_VALUE_BINDINGS);
    syncValueBindings(LAPLACE_VALUE_BINDINGS);
}

function syncGraphControls() {
    const isPolar = state.currentInputShape === 'grid_polar' || state.currentInputShape === 'grid_logpolar';
    const graphActive = state.graphViewEnabled;

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

    patchProps('graphGridFamilySelector', {
        children: [
            h('option', { value: 'primary' }, isPolar ? 'Circles' : 'Horizontal'),
            h('option', { value: 'secondary' }, isPolar ? 'Lines' : 'Vertical')
        ]
    });

    setHidden('graphColumn', !graphActive || state.realPlotsEnabled || !isGraphViewSupported());
}

function updateSliderLabelsAndDisplay() {
    syncComplexParameterControls();
    syncNormalModeDisplays();
    syncTaylorControls();
    syncVectorFlowControls();
    syncRiemannAndTransformDisplays();
    syncGraphControls();
    syncParameterControlsPanelVisibility();
    syncDelegates();
    Object.entries(context.animationStates).forEach(([sliderId, animation]) => {
        if (sliderId.startsWith('poly_coeff_')) return;
        const buttonKey = controlKeyFromId(`play_${sliderId.replace(/_slider$/, '')}_btn`);
        setText(buttonKey, animation.animating ? 'Pause' : 'Play');
        patchClass(buttonKey, 'active', animation.animating);
    });
}

function getTaylorDisplayCenter() {
    return state.taylorSeriesCustomCenter || state.taylorSeriesCenter || DEFAULT_TAYLOR_SERIES_CENTER;
}

function formatTaylorCenterStatusText(center) {
    const preset = findTaylorCenterPreset(center.re, center.im);
    if (preset) {
        return `z0 = ${preset.label}`;
    }

    const re = formatTaylorNumericValue(center.re);
    const imMagnitude = formatTaylorNumericValue(Math.abs(center.im));
    const sign = center.im >= 0 ? '+' : '-';
    return `z0 = ${re} ${sign} ${imMagnitude}i`;
}

function syncTaylorSeriesCenterStatus() {
    setText('taylorSeriesCenterStatus', formatTaylorCenterStatusText(getTaylorDisplayCenter()));
}

function formatProbeValue(v) {
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

function formatProbeComplex(re, im) {
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
    if (!isFiniteComplex(deriv)) {
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

    if (!isFiniteComplex(pW)) {
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
    const probeCanRender = state.probeActive
        && !(state.manifold3dViewEnabled && state.manifoldTransformationEnabled)
        && !state.navigationModeEnabled
        && !state.laplaceModeEnabled
        && !isPanning(runtime.interaction.panZ)
        && !isPanning(runtime.interaction.panW)
        && isFiniteComplex(state.probeZ);

    if (!probeCanRender) return hideProbeInfo();
    showProbeInfo(
        `z = ${formatProbeComplex(state.probeZ.re, state.probeZ.im)}`,
        transformedProbeHtml()
    );
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

    if (state.realPlotsEnabled) {
        syncRealPlotsUI();
        setText('enableChainingText', 'Enable Output Chaining (z)');
        setText('enableAlgebraicChainingText', 'Enable Algebraic Chaining (z)');
        let compPrefix = 'Re';
        if (state.realPlotsOutputComponent === 'imag') compPrefix = 'Im';
        else if (state.realPlotsOutputComponent === 'magnitude') compPrefix = '|';
        const output = model.hasOutputChain ? 'w' : 'f(z)';
        const displayFormula = state.realPlotsOutputComponent === 'magnitude'
            ? `z = | ${output} |`
            : `z = ${compPrefix}( ${output} )`;
        const zinText = state.realPlotsImagExpr === '0'
            ? state.realPlotsInputExpr
            : `${state.realPlotsInputExpr} + i·${state.realPlotsImagExpr}`;
        setHtml('realPlotsTitleLabel', `Real Plot (3D Surface): ${displayFormula}, where ${output} = ${model.fND}, z = ${zinText}`);
        return;
    } else {
        setText('enableChainingText', 'Enable Output Chaining');
        setText('enableAlgebraicChainingText', 'Enable Algebraic Chaining');
    }

    const zPlaneTitle = defaultZPlaneTitle(model.fND);

    if (state.riemannSurfaceEnabled) {
        setHtml('zPlaneTitle', zPlaneTitle);
        setHtml('wPlaneTitle', `Riemann surface (${model.wOutputDescriptor})`);
        setHidden('cauchyIntegralResultsInfo', true);
        return;
    }

    if (state.manifoldTransformationEnabled && state.manifold3dViewEnabled) {
        const manifold = getManifold(state.selectedManifold);
        setHtml('zPlaneTitle', `z-manifold (Input: Transforming Flat Grid to ${manifold.name})`);
        const mappedGridLabel = state.mapPresentation === 'derivative' ? 'Derivative Grid' : 'Mapped Grid';
        setHtml('wPlaneTitle', `w-manifold (Output: Transforming ${mappedGridLabel} to ${manifold.name})`);
        setHidden('cauchyIntegralResultsInfo', true);
        return;
    }

    if (state.manifold3dViewEnabled) {
        const manifold = getManifold(state.selectedManifold);
        setHtml('zPlaneTitle', zPlaneTitle);
        setHtml('wPlaneTitle', `w-manifold (Output: ${manifold.name})`);
        setHidden('cauchyIntegralResultsInfo', true);
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

function syncContourControls(prefix) {
    setChecked(`${prefix}ContoursCb`, state.contoursEnabled);
    setValue(`${prefix}ContourIntervalSlider`, state.contourInterval);
    setFixedText(`${prefix}ContourIntervalValueDisplay`, state.contourInterval, 2);
    setValue(`${prefix}ContourThicknessSlider`, state.contourThickness);
    setFixedText(`${prefix}ContourThicknessValueDisplay`, state.contourThickness, 1);
    setHidden(`${prefix}ContoursDetails`, !state.contoursEnabled);
}

function syncRiemannSurfaceControls() {
    setHidden(
        'manifoldOptionsDiv',
        (!state.manifold3dViewEnabled || state.riemannSurfaceEnabled) && state.contextMenuPanel !== 'manifold'
    );
    setHidden('riemannSurfaceOptionsDiv', !state.riemannSurfaceEnabled && state.contextMenuPanel !== 'riemann');
    setValue('riemannSurfaceComponentSelector', state.riemannSurfaceComponent);
    setChecked('riemannSurfaceWireframeCb', state.riemannSurfaceWireframe);
    syncContourControls('riemannSurface');

    setHidden(
        'manifoldSurfaceOptionsDiv',
        !state.manifold3dViewEnabled
    );
}

function syncDomainColoringControls() {
    setHidden('domainColoringOptionsDiv', !state.domainColoringEnabled && state.contextMenuPanel !== 'domain');
    setHidden('orbitColoringModeGroup', !(state.domainColoringEnabled && state.chainingEnabled));

    const normalized = normalizeOrbitColoringMode(state.orbitColoringMode);
    state.orbitColoringMode = normalized;
    setValue('orbitColoringModeSelect', normalized);

    setChecked('showDomainColoringKeyCb', state.domainColoringKeyVisible);
    setHidden(
        'domainColoringKey',
        !state.domainColoringEnabled || !state.domainColoringKeyVisible
    );
    updateDomainColoringKey();
}

function syncZetaControls() {
    const isZeta = collectActiveFunctionKeys().has('zeta');
    setHidden('zetaContinuationToggle', !isZeta);
    setHidden('zetaContinuationToggleRealPlots', !isZeta);

    if (isZeta) {
        setChecked('enableZetaContinuationCb', state.zetaContinuationEnabled);
        setChecked('enableZetaContinuationRealPlotsCb', state.zetaContinuationEnabled);
    }
}

function syncFunctionEquationCard() {
    if (state.algebraicChainingEnabled || state.laplaceModeEnabled) {
        setHidden('functionEquationContainer', true);
        setText('functionEquationContainer', '');
        return;
    }

    const func = state.currentFunction;
    if (!['gamma', 'loggamma', 'zeta', 'bessel'].includes(func)) {
        setHidden('functionEquationContainer', true);
        setText('functionEquationContainer', '');
        return;
    }

    setHidden('functionEquationContainer', false);

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

    setHtml('functionEquationContainer', `
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
    `);
}

function syncCanvasZoomControlsUI() {
    const isEnabled = Boolean(state.canvasZoomControlsEnabled);
    const isRiemann = Boolean(state.riemannSurfaceEnabled);
    const isFold = Boolean(state.foldSurface3dEnabled);
    const isManifoldZ = Boolean(state.manifoldTransformationEnabled);
    const isManifoldW = Boolean(state.manifold3dViewEnabled);
    const isGraph = Boolean(state.graphViewEnabled);
    const isLaplace = Boolean(state.laplaceModeEnabled);

    const zZoomVisible = isEnabled && !isRiemann && !isFold && !isManifoldZ && !isGraph && !isLaplace;
    const wZoomVisible = isEnabled && !isRiemann && !isFold && !isManifoldW && !isGraph && !isLaplace;
    const realPlotsZoomVisible = isEnabled && Boolean(state.realPlotsEnabled);

    setHidden('zPlaneZoomControls', !zZoomVisible);
    setHidden('wPlaneZoomControls', !wZoomVisible);
    setHidden('realPlotsZoomControls', !realPlotsZoomVisible);
}

function syncVisualizationOptionControls() {
    setDisabled('inputShapeSelector', state.laplaceModeEnabled);
    syncRiemannSurfaceControls();
    syncDomainColoringControls();
    setHidden('radialDiscreteStepsOptionsDiv', !state.radialDiscreteStepsEnabled);
    syncZetaControls();
    syncFunctionEquationCard();
}

function syncApplicationShell() {
    const categories = {
        complex_functions: 'toggleComplexFunctionsBtn',
        custom_complex: 'selectCustomComplexBtn',
        fractals: 'toggleFractalsBtn',
        real_plots: 'selectRealPlotsBtn',
        laplace: 'selectLaplaceBtn'
    };
    Object.entries(categories).forEach(([category, key]) => setActive(key, state.controlCategory === category));
    setHidden('complexFunctionsGridContainer', state.controlCategory !== 'complex_functions');
    setHidden('fractalsGridContainer', state.controlCategory !== 'fractals');
    const functions = ['cos', 'sin', 'tan', 'sec', 'exp', 'ln', 'sinh', 'tanh', 'asin', 'atan', 'power', 'mobius', 'zeta', 'gamma', 'loggamma', 'bessel', 'polynomial'];
    functions.forEach(key => setActive(
        `select${key[0].toUpperCase()}${key.slice(1)}Btn`,
        state.controlCategory === 'complex_functions' && state.currentFunction === key
    ));
    patchClass('controlsOptionsSection', 'is-collapsed', state.topControlsCollapsed);
    const fullscreenPanels = [
        ['zPlaneColumn', state.isZFullScreen],
        ['wPlaneColumn', state.isWFullScreen && state.fullscreenWIndex === 0],
        ['laplace3DColumn', state.isLaplace3DFullScreen],
        ['laplaceComColumn', state.isLaplaceComFullScreen],
        ['laplaceSpectrumColumn', state.isLaplaceSpectrumFullScreen],
        ['fourier3DColumn', state.isFourier3DFullScreen],
        ['graphColumn', state.isGraphFullScreen],
        ['realPlotsColumn', state.isRealPlotsFullScreen],
        ['contour2DColumn', state.isContour2DFullScreen]
    ];
    fullscreenPanels.forEach(([key, enabled]) => patchClass(key, 'workspace-panel-fullscreen', enabled));
    patchProps('toggleFullscreenZBtn', {
        title: state.isZFullScreen ? 'Exit fullscreen' : 'Toggle fullscreen view for z-plane',
        'data-tooltip': state.isZFullScreen ? 'Exit fullscreen' : 'Toggle fullscreen view for z-plane',
        'aria-label': state.isZFullScreen ? 'Exit z-plane fullscreen' : 'Toggle fullscreen view for z-plane'
    });
    patchProps('toggleFullscreenWBtn', {
        title: state.isWFullScreen ? 'Exit fullscreen' : 'Toggle fullscreen view for w-plane',
        'data-tooltip': state.isWFullScreen ? 'Exit fullscreen' : 'Toggle fullscreen view for w-plane',
        'aria-label': state.isWFullScreen ? 'Exit w-plane fullscreen' : 'Toggle fullscreen view for w-plane'
    });
    setHidden('topControlsCollapsedBar', !state.topControlsCollapsed);
    const toggleLabel = state.topControlsCollapsed ? 'Expand top half panels' : 'Minimize top half panels';
    patchProps('toggleTopControlsBtn', { title: toggleLabel, 'aria-label': toggleLabel, 'data-tooltip': toggleLabel });
    setHidden('domainPaletteCirclePanel', !state.domainPaletteGuideVisible);
    setHidden('realPlotsPaletteCirclePanel', !state.surfacePaletteGuideVisible);
    const customGrid = !state.laplaceModeEnabled && CUSTOM_GRID_INPUT_SHAPE_SET.has(state.currentInputShape);
    const showShapeControls = state.currentInputShape === 'line' || state.currentInputShape === 'circle';
    const showRadialControls = state.radialDiscreteStepsEnabled;
    const showVectorControls = Boolean(
        state.vectorFieldEnabled || state.streamlineFlowEnabled || state.particleAnimationEnabled
    );
    const overlayPositions = showVectorControls
        ? [
            ['vectorFlowCanvasOverlay', 'bottom-right'],
            ...(showRadialControls ? [['radialDiscreteStepsOptionsDiv', 'top-left']] : []),
            ...(showShapeControls ? [['zPlaneShapeControlsOverlay', showRadialControls ? 'top-right' : 'top-left']] : []),
            ...(customGrid ? [['gridShapeControlsOverlay', showRadialControls ? 'top-right' : 'top-left']] : [])
        ]
        : [
            ...(showShapeControls ? [['zPlaneShapeControlsOverlay', 'bottom-right']] : []),
            ...(customGrid ? [['gridShapeControlsOverlay', 'bottom-right']] : []),
            ...(showRadialControls ? [[
                'radialDiscreteStepsOptionsDiv',
                showShapeControls || customGrid ? 'top-left' : 'bottom-left'
            ]] : [])
        ];
    overlayPositions.forEach(([key, position]) => patchProps(key, { 'data-position': position }));
    setHidden('gridShapeControlsOverlay', !customGrid);
    patchProps('gridShapeControlsOverlay', {
        'aria-hidden': String(!customGrid),
        'data-position': overlayPositions.find(([key]) => key === 'gridShapeControlsOverlay')?.[1] || 'bottom-right'
    });
}

function updateTitlesAndGlobalUI() {
    syncApplicationShell();
    updateSliderLabelsAndDisplay();
    updateProbeInfo();
    syncCanvasZoomControlsUI();

    if (!syncTransformModeTitles()) {
        syncPrimaryPlaneTitles();
        syncVisualizationOptionControls();
        syncManifoldTransformationUI();
    }
    const cauchy = getCauchyDisplay();
    setText('wPlaneAnalysisInfo', getWindingDisplay());
    const cauchyHidden = cauchy.hidden || state.laplaceModeEnabled || state.realPlotsEnabled ||
        state.riemannSurfaceEnabled || state.manifold3dViewEnabled;
    setHidden('cauchyIntegralResultsInfo', cauchyHidden);
    if (!cauchyHidden) {
        if (cauchy.html !== null) setHtml('cauchyIntegralResultsInfo', cauchy.html);
        else setText('cauchyIntegralResultsInfo', cauchy.text);
    }
    sync2DContourUI();
}

export function buildViewModel() {
    modelProps.clear();
    updateTitlesAndGlobalUI();
    return new Map(modelProps);
}

function updateDomainColoringKey() {
    const paletteId = state.domainPalette || 'analytic-base';
    const paletteObj = domainPalettes.find(palette => palette.id === paletteId) || domainPalettes[0];
    const orbitMode = normalizeOrbitColoringMode(state.orbitColoringMode);
    const lines = ['<strong>Domain Coloring Key:</strong>'];
    if (paletteObj?.key) {
        lines.push('<span class="domain-key-line">- Color maps to Argument (Angle):</span>');
        for (const item of paletteObj.key) {
            lines.push(`<span class="domain-key-entry"><strong style="color:${item.color}">${item.label}</strong>: Arg = ${item.angle}</span>`);
        }
    }
    if (state.chainingEnabled) {
        lines.push(`<span class="domain-key-note">- Orbit observable: ${ORBIT_COLORING_MODE_LABELS[orbitMode] || orbitMode}</span>`);
    }
    lines.push('<span class="domain-key-note">- Optional lightness shading can emphasize magnitude.</span>');
    setHtml('domainColoringKey', lines.join('<br>'));
}

function syncManifoldTransformationUI() {
    const isManifoldActive = Boolean(state.manifold3dViewEnabled);
    const isTransformActive = Boolean(state.manifoldTransformationEnabled && isManifoldActive);
    const isFoldActive = state.foldSurface3dEnabled &&
        (state.currentInputShape === 'media' || isFoldableInputShape(state.currentInputShape));

    ['zPlaneTransformationOverlay', 'zPlaneThreejsContainer', 'wPlaneTransformationOverlay']
        .forEach(key => setHidden(key, !isTransformActive));
    setHidden('zPlaneCanvas', isTransformActive);
    setHidden('wPlaneThreejsContainer', !isManifoldActive);
    setHidden('wPlaneCanvas', isManifoldActive || state.riemannSurfaceEnabled || isFoldActive);
    setHidden('manifoldOptionsDiv', !isManifoldActive && state.contextMenuPanel !== 'manifold');
    setValue('manifoldShapeSelector', state.selectedManifold);
    setChecked('enableManifoldTransformationCb', state.manifoldTransformationEnabled);

}

function syncRealPlotExpression(part) {
    const statePrefix = `realPlots${part}`;
    const value = state[`${statePrefix}Expr`];
    const custom = state[`${statePrefix}IsCustom`];
    setValue(`${statePrefix}Preset`, custom ? 'custom' : value);
    setHidden(`realPlotsCustom${part}Container`, !custom);
    if (!custom) return;

    setValue(`realPlotsCustom${part}`, value);
    const error = state[`${statePrefix}Error`];
    if (error) {
        setText(`realPlotsCustom${part}Math`, error);
        patchClass(`realPlotsCustom${part}Math`, 'dynamic-math-error', true);
    } else {
        setFormulaPreview(`realPlotsCustom${part}Math`, value);
    }
}

function syncRealPlotsUI() {
    ['Input', 'Imag'].forEach(syncRealPlotExpression);
    setValue('realPlotsColorMode', state.realPlotsColorMode);
    setValue('realPlotsOutputComponent', state.realPlotsOutputComponent);
    for (const name of ['Brightness', 'Contrast', 'Saturation', 'HeightScale']) {
        const value = state[`realPlots${name}`];
        setValue(`realPlots${name}Slider`, value);
        setFixedText(`realPlots${name}ValueDisplay`, value, 2);
    }
    syncContourControls('realPlots');
}

function setFormulaPreview(key, source, options = {}) {
    try {
        compileExpression(String(source).trim(), options);
        setHtml(key, createExpressionMathML(String(source).trim(), options).outerHTML);
        patchClass(key, 'dynamic-math-error', false);
    } catch (error) {
        setText(key, error?.message || String(error));
        patchClass(key, 'dynamic-math-error', true);
    }
}

function sync2DContourUI() {
    const hasSurface = state.realPlotsEnabled || state.riemannSurfaceEnabled || state.laplaceModeEnabled;
    const showContour = state.show2DContourPlot && hasSurface;

    const active = state.show2DContourPlot;
    ['realPlotsShow2DContourBtn', 'riemannSurfaceShow2DContourBtn', 'laplaceShow2DContourBtn']
        .forEach(key => {
            patchClass(key, 'contour-btn-active', active);
            patchProps(key, { 'aria-pressed': String(active) });
        });
    setHidden('contour2DColumn', !showContour);

    if (state.realPlotsEnabled) {
        setHidden('zPlaneColumn', true);
        setHidden('wPlaneColumn', true);
        setHidden('realPlotsColumn', false);
    } else if (state.riemannSurfaceEnabled) {
        setHidden('realPlotsColumn', true);
        setHidden('zPlaneColumn', showContour);
        setHidden('wPlaneColumn', false);
    } else if (state.laplaceModeEnabled) {
        setHidden('realPlotsColumn', true);
    } else {
        setHidden('contour2DColumn', true);
    }

}
