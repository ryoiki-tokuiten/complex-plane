import { state, context, sliderParamKeys } from '../store/state.js';
import { getChainedTransformFunction } from '../math-utils.js';
import { resolveActiveMap } from '../math/active-map.js';
import { DEFAULT_TAYLOR_SERIES_CENTER, CRITICAL_POINT_EPSILON } from '../constants/numerical.js';
import {
    ORBIT_COLORING_MODE_LABELS,
    normalizeOrbitColoringMode
} from '../constants/rendering.js';
import { updatePolynomialCoeffDisplays } from './polynomial-ui.js';
import { syncVideoPlaybackUI } from '../utils/raster-media.js';
import { findTaylorCenterPreset, formatTaylorNumericValue, getChainingTitleHTML } from '../utils/dom-utils.js';
import { syncNavigationControls } from '../navigation-plane.js';
import {
    getBranchWindowLabel,
    getVisibleBranchIndices,
    surfaceStageHasBranches
} from '../analysis/riemann-surface.js';
import { renderDomainPalettesUI, domainPalettes, renderRealPlotsPalettesUI, realPlotsPalettes } from './theme-manager.js';
import { startRiemannTransformationAnimation, stopRiemannTransformationAnimation, syncRiemannTransformationPlayPauseButton, initThreeJSRenderers, buildThreeJSMeshes, syncRiemannSliders, disposeThreeJSRenderers } from '../rendering/riemann-transformation-animation.js';
import { getDynamicFunctionFormulaHtml } from '../analysis/dynamic-plotting.js';
import { createExpressionMathML } from '../math/expression/index.js';
import { createFormulaFragment } from './dom-components.js';

const { controls = {} } = context;

const HIDDEN_CLASS = 'hidden';
const VISUALLY_HIDDEN_CLASS = 'hidden-visually';
const EPS = 1e-9;

export function syncLaplacePlayPauseButton() {
    if (controls.laplacePlayPauseBtn) {
        controls.laplacePlayPauseBtn.textContent = state.laplaceAnimationPlaying ? '⏸ Pause' : '▶ Play';
    }
}

const TRANSFORM_MODE_PARAMETER_GROUPS = Object.freeze([
    'commonParamsSliders',
    'mobiusParamsSliders',
    'polynomialParamsSliders',
    'fractionalPowerParamsSliders',
    'shapeParamsSliders',
    'chainingParamsBlock',
    'algebraicChainingParamsBlock',
    'dynamicPlottingParams'
]);

const TRANSFORM_MODE_VISUALIZATION_PANELS = Object.freeze([
    'visualizationOptionsPanel',
    'zetaSpecificControlsDiv',
    'riemannSphereOptionsDiv',
    'riemannSurfaceOptionsDiv',
    'sphereViewControlsDiv',
    'vectorFlowOptionsContent'
]);

const CENTER_LABELS = Object.freeze({
    line: [
        'Fixed Re(z) (<code>a<sub>0</sub></code>):',
        'Fixed Im(z) (<code>b<sub>0</sub></code>):'
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
    line: ': Lines)',
    circle: ': Circle)',
    ellipse: ': Ellipse)',
    grid_cartesian: ': Cartesian Grid)',
    grid_polar: ': Polar Grid)',
    grid_logpolar: ': Log-Polar Grid)',
    grid_logcartesian: ': Log-Cartesian Grid)',
    image: ': Image)',
    video: ': Video)',
    empty_grid: ': Empty)'
});

const SHAPE_SPECIFIC_GROUPS = Object.freeze({
    circle: 'circleRSliderGroup',
    ellipse: 'ellipseParamsSliderGroup'
});

const SIMPLE_FUNCTION_LABELS = Object.freeze({
    cos: 'cos',
    sin: 'sin',
    tan: 'tan',
    sec: 'sec',
    exp: 'exp',
    ln: 'ln',
    sinh: 'sinh',
    cosh: 'cosh',
    tanh: 'tanh'
});

const FUNCTION_ARGUMENT_HTML = Object.freeze({
    cos: 'cos(z)',
    sin: 'sin(z)',
    tan: 'tan(z)',
    sec: 'sec(z)',
    exp: 'e<sup>z</sup>',
    ln: 'ln(z)',
    sinh: 'sinh(z)',
    cosh: 'cosh(z)',
    tanh: 'tanh(z)',
    reciprocal: '1/z',
    mobius: 'Möbius(z)',
    zeta: 'ζ(z)',
    polynomial: 'P(z)',
    poincare: 'Poincare(z)'
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
    { display: 'imageResolutionValueDisplay', key: 'imageResolution' },
    { display: 'imageSizeValueDisplay', key: 'imageSize', digits: 1 },
    { display: 'imageOpacityValueDisplay', key: 'imageOpacity', digits: 2 },
    { display: 'videoResolutionValueDisplay', key: 'videoResolution' },
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
    { display: 'threeSphereOpacityValueDisplay', key: 'threeSphereOpacity', digits: 2, companion: 'threeSphereOpacitySlider' },
    { display: 'sphereGridOpacityValueDisplay', key: 'sphereGridOpacity', digits: 2, companion: 'sphereGridOpacitySlider' },
    { display: 'taylorSeriesOrderValueDisplay', key: 'taylorSeriesOrder', companion: 'taylorSeriesOrderSlider' },
    { display: 'riemannSurfaceSheetsValueDisplay', key: 'riemannSurfaceSheets' },
    { display: 'riemannSurfaceBranchCenterValueDisplay', key: 'riemannSurfaceBranchCenter' },
    { display: 'riemannSurfaceHeightScaleValueDisplay', key: 'riemannSurfaceHeightScale', digits: 2 },
    { display: 'riemannSurfaceHeightClipValueDisplay', key: 'riemannSurfaceHeightClip', digits: 1 }
]);

const FOURIER_VALUE_BINDINGS = Object.freeze([
    { display: 'fourierFrequencyValueDisplay', key: 'fourierFrequency', digits: 1 },
    { display: 'fourierAmplitudeValueDisplay', key: 'fourierAmplitude', digits: 1 },
    { display: 'fourierTimeWindowValueDisplay', key: 'fourierTimeWindow', digits: 1 },
    { display: 'fourierSamplesValueDisplay', key: 'fourierSamples' },
    { display: 'fourierWindingFrequencyValueDisplay', key: 'fourierWindingFrequency', digits: 1 },
    { display: 'fourierWindingTimeValueDisplay', get: () => Math.round(state.fourierWindingTime * 100) }
]);

const LAPLACE_VALUE_BINDINGS = Object.freeze([
    { display: 'laplaceFrequencyValueDisplay', key: 'laplaceFrequency', digits: 1 },
    { display: 'laplaceDampingValueDisplay', key: 'laplaceDamping', digits: 1 },
    { display: 'laplaceSigmaValueDisplay', key: 'laplaceSigma', digits: 1 },
    { display: 'laplaceOmegaValueDisplay', key: 'laplaceOmega', digits: 1 },
    { display: 'laplaceClipHeightValueDisplay', key: 'laplaceClipHeight', digits: 0 }
]);

function control(key) {
    return controls?.[key] ?? null;
}

function resolveControl(target) {
    return typeof target === 'string' ? control(target) : target;
}

function runUiTransaction(name, action) {
    try {
        action();
    } catch (error) {
        console.error(`Error in ${name}:`, error);
    }
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
        node.innerHTML = html;
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

function setStyleColor(key, color) {
    const node = control(key);
    if (node?.style && color) {
        node.style.color = color;
    }
}

function isFixedRenderable(value) {
    return typeof value === 'number' && !Number.isNaN(value);
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

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function escapeFormulaText(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function finiteComplex(value) {
    return Number.isFinite(value?.re) && Number.isFinite(value?.im);
}

function isPanning(panState) {
    return Boolean(panState?.isPanning);
}

function fractionalPowerExponent() {
    const n = typeof state.fractionalPowerN === 'number' ? state.fractionalPowerN : 0.5;
    return Number((n || 0.5).toFixed(2));
}

function hideControls(keys) {
    for (const key of keys) {
        setHidden(key, true);
    }
}

function syncDisclosure(checkboxKey, contentKey, enabled) {
    setChecked(checkboxKey, enabled);
    setHidden(contentKey, !enabled);
}

function syncPointEditor(editorKey, points) {
    const editor = context?.[editorKey];
    if (typeof editor?.setPoints === 'function') {
        editor.setPoints(points, false);
    }
}

function syncDelegates() {
    for (const delegate of [
        syncLaplacePlayPauseButton,
        syncVideoPlaybackUI,
        syncNavigationControls
    ]) {
        if (typeof delegate === 'function') {
            delegate();
        }
    }
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

    for (const term of safeArray(state.algebraicChainingTerms)) {
        for (const factor of safeArray(term?.factors)) {
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
    updatePolynomialCoeffDisplays();
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

function syncComplexParameterControls() {
    if (state.fourierModeEnabled || state.laplaceModeEnabled) {
        hideControls(TRANSFORM_MODE_PARAMETER_GROUPS);
        return;
    }

    setHidden('chainingParamsBlock', false);
    setHidden('algebraicChainingParamsBlock', false);
    setHidden('dynamicPlottingParams', false);

    const shape = state.currentInputShape;
    const activeFunctions = collectActiveFunctionKeys();
    const isLine = shape === 'line';
    const isCircle = shape === 'circle';
    const isEllipse = shape === 'ellipse';
    const isImage = shape === 'image';
    const isVideo = shape === 'video';
    const showCommonParams = isLine || isCircle || isEllipse;
    const showMediaCenterParams = isImage || isVideo;
    const showShapeSpecificSliders = isCircle || isEllipse;
    const isMobiusFunc = activeFunctions.has('mobius');
    const isPolyFunc = activeFunctions.has('polynomial');
    const isPowerFunc = activeFunctions.has('power');

    setHidden('commonParamsSliders', !(showCommonParams || showMediaCenterParams));
    setHidden('mobiusParamsSliders', !isMobiusFunc);
    setHidden('polynomialParamsSliders', !isPolyFunc);
    setHidden('fractionalPowerParamsSliders', !isPowerFunc);
    setHidden('imageUploadControls', !isImage);
    setHidden('videoUploadControls', !isVideo);

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
    if (state.fourierModeEnabled || state.laplaceModeEnabled) {
        return;
    }

    syncValueBindings(NORMAL_MODE_VALUE_BINDINGS);
    setValue('zPlaneZoomSlider', Math.log10(state.zPlaneZoom || 1));
    setValue('wPlaneZoomSlider', Math.log10(state.wPlaneZoom || 1));
}

function syncTaylorControls() {
    syncDisclosure('enableTaylorSeriesCb', 'taylorSeriesOptionsDetailDiv', state.taylorSeriesEnabled);
    syncDisclosure(
        'enableTaylorSeriesCustomCenterCb',
        'taylorSeriesCustomCenterInputsDiv',
        state.taylorSeriesCustomCenterEnabled
    );

    syncTaylorSeriesCenterStatus();
    syncPointEditor('taylorCenterUI', [state.taylorSeriesCustomCenter]);
}

function syncVectorFlowControls() {
    setChecked('enableVectorFieldCb', state.vectorFieldEnabled);
    setHidden('vectorFieldOptionsDiv', !state.vectorFieldEnabled);

    setChecked('enableStreamlineFlowCb', state.streamlineFlowEnabled);
    setHidden('streamlineOptionsDetailsDiv', !state.streamlineFlowEnabled);
    syncValueBindings(STREAMLINE_VALUE_BINDINGS);

    syncValueBindings(PARTICLE_VALUE_BINDINGS);
    setChecked('enableParticleAnimationCb', state.particleAnimationEnabled);
    setHidden('particleAnimationDetailsDiv', !state.particleAnimationEnabled);
}

function syncRiemannAndTransformDisplays() {
    syncValueBindings(RIEMANN_VIEW_VALUE_BINDINGS);
    syncValueBindings(FOURIER_VALUE_BINDINGS);
    syncValueBindings(LAPLACE_VALUE_BINDINGS);

    const stability = state.laplaceStability;
    if (control('laplaceStabilityDisplay') && stability) {
        setText('laplaceStabilityDisplay', stability.message || 'Analyzing…');
        setStyleColor('laplaceStabilityDisplay', stability.color);
    }
}

export function updateSliderLabelsAndDisplay() {
    runUiTransaction('updateSliderLabelsAndDisplay', () => {
        syncComplexParameterControls();
        syncNormalModeDisplays();
        syncTaylorControls();
        syncParameterControlsPanelVisibility();
        syncVectorFlowControls();
        syncRiemannAndTransformDisplays();
        syncDelegates();
    });
}

export function getTaylorDisplayCenter() {
    return state.taylorSeriesCustomCenterEnabled
        ? state.taylorSeriesCustomCenter
        : DEFAULT_TAYLOR_SERIES_CENTER;
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

export function syncTaylorSeriesPresetSelection() {
    syncPointEditor('taylorCenterUI', [state.taylorSeriesCustomCenter]);
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
    if (state.currentFunction === 'poincare') {
        return [
            "f'(z): N/A for Poincare map",
            'Conformality: N/A'
        ].join('<br>') + '<br>';
    }

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
        const zIsPlanar = !state.riemannSphereViewEnabled || state.splitViewEnabled;
        const probeCanRender = state.probeActive
            && zIsPlanar
            && !state.navigationModeEnabled
            && !state.fourierModeEnabled
            && !state.laplaceModeEnabled
            && !isPanning(state.panStateZ)
            && !isPanning(state.panStateW)
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

function formatNumberForFormula(value, fallback = 0) {
    const number = typeof value === 'number' ? value : fallback;
    return Number(number.toFixed(2));
}

function normalizeComplex(c, fallbackRe = 1, fallbackIm = 0) {
    const re = typeof c?.re === 'number' && !Number.isNaN(c.re) ? c.re : fallbackRe;
    const im = typeof c?.im === 'number' && !Number.isNaN(c.im) ? c.im : fallbackIm;
    return { re, im };
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
        case 'reciprocal':
            return 'reciprocal';
        case 'mobius':
            return 'Möbius';
        case 'zeta':
            return 'ζ';
        case 'polynomial':
            return `P (deg ${state.polynomialN})`;
        case 'poincare':
            return 'Poincare';
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
        : funcKey === 'reciprocal'
            ? `1/${innerArg}`
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
    const activeFactors = safeArray(term?.factors).filter(factor => factor?.func && factor.func !== 'none');
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
        const terms = safeArray(state.algebraicChainingTerms);
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
        case 'reciprocal':
            return '1/z';
        case 'mobius':
            return '(az+b)/(cz+d)';
        case 'zeta':
            return 'ζ(z)';
        case 'poincare':
            return 'Poincare Map';
        case 'power':
            return 'z<sup>n</sup>';
        case 'sinh':
            return 'sinh(z)';
        case 'cosh':
            return 'cosh(z)';
        case 'tanh':
            return 'tanh(z)';
        default:
            return `${state.currentFunction}(z)`;
    }
}

function compactRecursionSymbol() {
    switch (state.currentFunction) {
        case 'polynomial':
            return `P<sub>deg ${state.polynomialN}</sub>`;
        case 'mobius':
            return 'Möbius';
        case 'zeta':
            return 'ζ';
        case 'power':
            return `z<sup>${fractionalPowerExponent()}</sup>`;
        default:
            return state.currentFunction;
    }
}

function compositionSymbol() {
    switch (state.currentFunction) {
        case 'exp':
            return 'e<sup>(·)</sup>';
        case 'ln':
            return 'ln(·)';
        case 'reciprocal':
            return '1/(·)';
        case 'zeta':
            return 'ζ(·)';
        case 'polynomial':
            return `P<sub>deg ${state.polynomialN}</sub>(·)`;
        case 'mobius':
            return 'Möbius(·)';
        case 'power':
            return `(·)<sup>${fractionalPowerExponent()}</sup>`;
        case 'poincare':
            return 'Poincare(·)';
        case 'sinh':
            return 'sinh(·)';
        case 'cosh':
            return 'cosh(·)';
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
            for (let i = 0; i < Math.min(chainCount, 3); i++) repeatedFZero += 'f(';
            repeatedFZero += '... f(0)';
            for (let i = 0; i < Math.min(chainCount, 3); i++) repeatedFZero += ')';
            
            return `${repeatedFZero} <span class="formula-note">[${chainCount} times, where f(z, c) = ${baseFormula}]</span>`;
        case 'recursion':
        default:
            return recursiveChainFormula(baseFormula, chainCount);
    }
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

    const chainLabel = isSinglePanelChain ? `Chain ${state.chainCount - 1}` : 'Chain 0';
    const mappedChainLabel = isSinglePanelChain ? `mapped chain ${state.chainCount - 1}` : 'mapped chain 0';
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
    const suffix = INPUT_SHAPE_TITLE_SUFFIX[state.currentInputShape] ?? ')';
    let title = `z-plane (Input${suffix})`;
    const showRadialSteps = state.radialDiscreteStepsEnabled && state.currentFunction !== 'poincare';
    const derivativePrefix = state.mapPresentation === 'derivative' ? 'Derivative of ' : '';

    if (state.domainColoringEnabled) {
        const prefix = state.riemannSphereViewEnabled && !state.splitViewEnabled ? 'z-sphere' : 'z-plane';
        title = `${prefix} (Output: Domain Coloring of ${derivativePrefix}<code id="z-plane-title-func">w = ${fND}</code>)`;
    } else if (state.vectorFieldEnabled || state.streamlineFlowEnabled) {
        const typeStr = state.streamlineFlowEnabled ? 'Streamlines' : 'Vector Field';
        title = `z-plane (Output: ${typeStr} [${state.vectorFieldFunction}] of ${derivativePrefix}<code id="z-plane-title-func">w = ${fND}</code>)`;
    } else if (showRadialSteps) {
        title = `z-plane (Output: Radial Discrete Steps of ${derivativePrefix}<code id="z-plane-title-func">w = ${fND}</code>)`;
    } else if (state.navigationModeEnabled && (!state.riemannSphereViewEnabled || state.splitViewEnabled)) {
        title = 'z-plane (Navigation)';
    }

    return title;
}

function splitViewZPlaneTitle(fND) {
    const showRadialSteps = state.radialDiscreteStepsEnabled && state.currentFunction !== 'poincare';
    const derivativePrefix = state.mapPresentation === 'derivative' ? 'Derivative of ' : '';

    if (state.domainColoringEnabled) {
        return `z-plane (Output: Domain Coloring of ${derivativePrefix}<code id="z-plane-title-func">w = ${fND}</code>)`;
    }

    if (state.vectorFieldEnabled || state.streamlineFlowEnabled) {
        const typeStr = state.streamlineFlowEnabled ? 'Streamlines' : 'Vector Field';
        return `z-plane (Output: ${typeStr} [${state.vectorFieldFunction}] of ${derivativePrefix}<code id="z-plane-title-func">w = ${fND}</code>)`;
    }

    if (showRadialSteps) {
        return `z-plane (Output: Radial Discrete Steps of ${derivativePrefix}<code id="z-plane-title-func">w = ${fND}</code>)`;
    }

    return `z-plane (Input Grid: ${String(state.currentInputShape ?? '').replace(/_/g, ' ')})`;
}

function sphereWPlaneTitle(model) {
    const sphereLabel = state.threeSphereEnabled ? '3D w-sphere' : 'w-sphere';

    return state.domainColoringEnabled
        ? `${sphereLabel} (Codomain coloring; ${model.mappedWOutputDescriptor})`
        : `${sphereLabel} (${model.wOutputDescriptor})`;
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

    if (state.splitViewEnabled) {
        setHtml('zPlaneTitle', splitViewZPlaneTitle(model.fND));
        setHtml('wPlaneTitle', sphereWPlaneTitle(model));
        setHidden('cauchy_integral_results_info', true);
        return;
    }

    if (state.riemannSphereViewEnabled && state.riemannTransformationEnabled && !state.splitViewEnabled) {
        setHtml('zPlaneTitle', 'z-sphere (Input: Transforming Flat Grid to Sphere)');
        const mappedGridLabel = state.mapPresentation === 'derivative' ? 'Derivative Grid' : 'Mapped Grid';
        setHtml('wPlaneTitle', `w-sphere (Output: Transforming ${mappedGridLabel} to Sphere)`);
        setHidden('cauchy_integral_results_info', true);
        return;
    }

    if (state.riemannSphereViewEnabled) {
        setHtml(
            'zPlaneTitle',
            state.domainColoringEnabled
                ? `z-sphere (Output: Domain Coloring of ${model.derivativePrefix}<code id="z-plane-title-func">w = ${model.fND}</code>)`
                : 'z-sphere (Input)'
        );
        setHtml('wPlaneTitle', sphereWPlaneTitle(model));
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
    if (state.fourierModeEnabled) {
        setHtml('zPlaneTitle', 'Time Domain (Signal)');
        setHtml('wPlaneTitle', 'Frequency Domain (Fourier Transform)');
        setDisabled('inputShapeSelector', true);
        hideControls(TRANSFORM_MODE_VISUALIZATION_PANELS);
        return true;
    }

    if (!state.laplaceModeEnabled) {
        return false;
    }

    setHtml('zPlaneTitle', 'Time Domain (Signal)');
    setHtml('wPlaneTitle', 'Complex Frequency Domain (Winding)');
    setDisabled('inputShapeSelector', true);

    const laplace3DTitles = {
        magnitude: '3D Surface: |F(s)| Magnitude',
        phase: '3D Surface: ∠F(s) Phase',
        combined: '3D Surface: Combined View'
    };

    const vizMode = state.laplaceVizMode || 'magnitude';
    setHtml('laplace3DTitleLabel', laplace3DTitles[vizMode] ?? laplace3DTitles.combined);
    hideControls(TRANSFORM_MODE_VISUALIZATION_PANELS);
    return true;
}

function syncRiemannSurfaceControls() {
    setHidden(
        'riemannSphereOptionsDiv',
        !state.riemannSphereViewEnabled || state.riemannSurfaceEnabled
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
        const hasBranches = surfaceStageHasBranches(state, 1);
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
        'threeSphereOptionsDiv',
        !(state.riemannSphereViewEnabled && state.threeSphereEnabled)
    );
    setHidden(
        'sphereViewControlsDiv',
        !(state.riemannSphereViewEnabled || state.splitViewEnabled)
    );
}

function syncDomainColoringControls() {
    setHidden('domainColoringOptionsDiv', !state.domainColoringEnabled);
    setHidden('orbitColoringModeGroup', !(state.domainColoringEnabled && state.chainingEnabled));

    const paletteCirclesContainer = typeof document !== 'undefined'
        ? document.getElementById('domain_palette_circles')
        : null;

    if (paletteCirclesContainer && typeof renderDomainPalettesUI === 'function') {
        renderDomainPalettesUI(paletteCirclesContainer);
    }

    for (const selector of [
        control('domainPaletteSelect'),
        control('riemannSurfacePaletteSelect')
    ]) {
        if (selector) {
            selector.value = state.domainPalette || 'analytic-base';
        }
    }

    const orbitSelector = control('orbitColoringModeSelect');
    if (orbitSelector) {
        const normalized = normalizeOrbitColoringMode(state.orbitColoringMode);
        state.orbitColoringMode = normalized;
        orbitSelector.value = normalized;
    }

    setHidden('domainColoringKeyDiv', !state.domainColoringEnabled);
    if (control('domainColoringKeyDiv')) {
        updateDomainColoringKey();
    }
}

function syncZetaControls() {
    const container = control('zetaSpecificControlsDiv');
    if (!container) {
        return;
    }

    const isZeta = state.currentFunction === 'zeta';
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

function syncPoincareRestrictions() {
    const isPoincare = state.currentFunction === 'poincare';

    setDisabled('showZerosPolesCb', isPoincare);
    setDisabled('showCriticalPointsCb', isPoincare);
    setDisabled('enableCauchyIntegralModeCb', isPoincare);

    if (isPoincare) {
        setChecked('showZerosPolesCb', false);
        setChecked('showCriticalPointsCb', false);
        setChecked('enableCauchyIntegralModeCb', false);
        state.showZerosPoles = false;
        state.showCriticalPoints = false;
        state.cauchyIntegralModeEnabled = false;
    }

    setDisabled('enableRadialDiscreteStepsCb', isPoincare);
    if (isPoincare && control('enableRadialDiscreteStepsCb')) {
        setChecked('enableRadialDiscreteStepsCb', false);
        setHidden('radialDiscreteStepsOptionsDiv', true);
    }

    setDisabled('enableTaylorSeriesCb', isPoincare);
    if (isPoincare && control('enableTaylorSeriesCb')) {
        setChecked('enableTaylorSeriesCb', false);
        state.taylorSeriesEnabled = false;
        setHidden('taylorSeriesOptionsDetailDiv', true);
    }
}

function syncVisualizationOptionControls() {
    setHidden('visualizationOptionsPanel', false);
    setDisabled('inputShapeSelector', false);
    syncRiemannSurfaceControls();
    syncDomainColoringControls();
    setHidden('radialDiscreteStepsOptionsDiv', !state.radialDiscreteStepsEnabled);
    syncZetaControls();
    syncPoincareRestrictions();
}

export function updateTitlesAndGlobalUI() {
    runUiTransaction('updateTitlesAndGlobalUI', () => {
        updateSliderLabelsAndDisplay();
        updateProbeInfo();

        if (syncTransformModeTitles()) {
            return;
        }

        syncPrimaryPlaneTitles();
        syncVisualizationOptionControls();
        syncRiemannTransformationUI();
        sync2DContourUI();
    });
}

export function updateDomainColoringKey() {
    const keyDiv = control('domainColoringKeyDiv');
    if (!keyDiv) {
        return;
    }

    const paletteId = state.domainPalette || 'analytic-base';
    const paletteObj = domainPalettes.find(palette => palette.id === paletteId) || domainPalettes[0];
    const orbitMode = normalizeOrbitColoringMode(state.orbitColoringMode);
    const lines = ['<strong>Domain Coloring Key:</strong><br>'];

    if (paletteObj?.key) {
        lines.push('<span style="display:inline-block; margin-bottom: 4px;">- Color maps to Argument (Angle):</span><br>');

        for (const item of paletteObj.key) {
            lines.push(
                `&nbsp;&nbsp;&nbsp;<span style="color:${item.color}; font-weight:bold; text-shadow: 0 0 2px rgba(0,0,0,0.5);">${item.label}</span>: Arg = ${item.angle}<br>`
            );
        }
    }

    if (state.chainingEnabled) {
        lines.push(
            `<span style="display:inline-block; margin-top: 4px;">- Orbit observable: ${ORBIT_COLORING_MODE_LABELS[orbitMode] || orbitMode}</span><br>`
        );
    }
    lines.push('<span style="display:inline-block; margin-top: 4px;">- Optional lightness shading can emphasize magnitude.</span>');
    keyDiv.innerHTML = lines.join('');
}

export function syncRiemannTransformationUI() {
    const showOverlay = state.riemannSphereViewEnabled && state.riemannTransformationEnabled && !state.splitViewEnabled;
    
    // Z plane UI
    const overlayZ = document.getElementById('z_plane_transformation_overlay');
    const containerZ = document.getElementById('z_plane_threejs_container');
    if (overlayZ) overlayZ.classList.toggle('hidden', !showOverlay);
    if (containerZ) containerZ.classList.toggle('hidden', !showOverlay);

    // W plane UI
    const overlayW = document.getElementById('w_plane_transformation_overlay');
    const containerW = document.getElementById('w_plane_threejs_container');
    if (overlayW) overlayW.classList.toggle('hidden', !showOverlay);
    if (containerW) containerW.classList.toggle('hidden', !showOverlay);
    
    if (showOverlay) {
        initThreeJSRenderers();
        buildThreeJSMeshes();
        startRiemannTransformationAnimation();
        syncRiemannTransformationPlayPauseButton();
        syncRiemannSliders();
    } else {
        stopRiemannTransformationAnimation();
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

    const paletteCirclesContainer = document.getElementById('real_plots_palette_circles');
    if (paletteCirclesContainer && typeof renderRealPlotsPalettesUI === 'function') {
        renderRealPlotsPalettesUI(paletteCirclesContainer);
    }

    const paletteNameLabel = document.getElementById('active_real_plots_palette_name');
    if (paletteNameLabel) {
        const activePalette = realPlotsPalettes.find(p => p.id === state.realPlotsPalette) || realPlotsPalettes.find(p => p.id === 'viridis');
        if (activePalette) paletteNameLabel.textContent = activePalette.name;
    }

    const colorModeEl = document.getElementById('real_plots_color_mode');
    if (colorModeEl && state.realPlotsColorMode) {
        colorModeEl.value = state.realPlotsColorMode;
    }

    const outputCompEl = document.getElementById('real_plots_output_component');
    if (outputCompEl && state.realPlotsOutputComponent) {
        outputCompEl.value = state.realPlotsOutputComponent;
    }

    const heightScaleSlider = document.getElementById('real_plots_height_scale_slider');
    const heightScaleDisplay = document.getElementById('real_plots_height_scale_value_display');
    if (heightScaleSlider && state.realPlotsHeightScale !== undefined) {
        heightScaleSlider.value = String(state.realPlotsHeightScale);
        if (heightScaleDisplay) {
            heightScaleDisplay.textContent = state.realPlotsHeightScale.toFixed(2);
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

export function updateCustomFormulaPreview(inputEl, displayEl) {
    if (!inputEl || !displayEl) return;
    displayEl.replaceChildren();
    const source = inputEl.value.trim() || '0';
    try {
        const mathNode = createExpressionMathML(source);
        displayEl.appendChild(mathNode);
        displayEl.classList.remove('dynamic-math-error');
    } catch (error) {
        displayEl.textContent = error?.message || String(error);
        displayEl.classList.add('dynamic-math-error');
    }
}

export function sync2DContourUI() {
    const is3D = state.realPlotsEnabled || state.riemannSurfaceEnabled;
    const showContour = state.show2DContourPlot && is3D;

    // Toggle button active states and labels
    const active = state.show2DContourPlot;
    [control('riemannSurfaceShow2DContourBtn'), control('realPlotsShow2DContourBtn')].forEach(btn => {
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
        const zCard = control('zCanvasCard');
        const wCard = control('wCanvasCard');
        const rpCol = control('realPlotsColumn');
        if (zCard) zCard.classList.add('hidden');
        if (wCard) wCard.classList.add('hidden');
        if (rpCol) rpCol.classList.remove('hidden');
    } else if (state.riemannSurfaceEnabled) {
        // Riemann surface active:
        // If showContour is true, we hide zCanvasCard so we only have wCanvasCard (3D Riemann) and contour2DColumn (2D contour) side-by-side!
        // If showContour is false, we restore zCanvasCard and wCanvasCard.
        const zCard = control('zCanvasCard');
        const wCard = control('wCanvasCard');
        const rpCol = control('realPlotsColumn');
        if (rpCol) rpCol.classList.add('hidden');
        if (zCard) {
            zCard.classList.toggle('hidden', showContour);
        }
        if (wCard) {
            wCard.classList.remove('hidden');
        }
    } else {
        // Neither 3D plot is active: hide the 2D contour plot column
        if (contourCol) {
            contourCol.classList.add('hidden');
        }
    }
}
