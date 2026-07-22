// js/store/state.js

import { createObservableStore } from './observable-store.js';
import {
    DEFAULT_CANVAS_WIDTH,
    DEFAULT_CANVAS_HEIGHT,
    SPHERE_INITIAL_ROT_X,
    SPHERE_INITIAL_ROT_Y
} from '../constants/rendering.js';

export const zPlaneInitialRanges = { x: [-3.5, 3.5], y: [-3.0, 3.0] };
export const wPlaneInitialRanges = { x: [-6.5, 6.5], y: [-6.5, 6.5] };

export const zPlaneParams = {
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
    origin: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    currentVisXRange: [...zPlaneInitialRanges.x],
    currentVisYRange: [...zPlaneInitialRanges.y]
};

export const wPlaneParams = {
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
    origin: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    xRange: [...wPlaneInitialRanges.x],
    yRange: [...wPlaneInitialRanges.y]
};

export const sphereViewParams = {
    z: { rotX: SPHERE_INITIAL_ROT_X, rotY: SPHERE_INITIAL_ROT_Y, dragging: false, lastMouseX: 0, lastMouseY: 0, radius: 0, centerX: 0, centerY: 0 },
    w: { rotX: SPHERE_INITIAL_ROT_X, rotY: SPHERE_INITIAL_ROT_Y, dragging: false, lastMouseX: 0, lastMouseY: 0, radius: 0, centerX: 0, centerY: 0 }
};

export const sliderParamKeys = ['a0', 'b0', 'circleR', 'ellipseA', 'ellipseB', 'fractionalPowerN'];

const rawState = {
    a0: 0.0, b0: 0.0,
    circleR: 1.0, ellipseA: 1.5, ellipseB: 0.7,
    mobiusA: { re: 1, im: 0 },
    mobiusB: { re: 0, im: 0 },
    mobiusC: { re: 0, im: 0 },
    mobiusD: { re: 1, im: 0 },
    polynomialN: 2,
    polynomialCoeffs: [], 
    fractionalPowerN: 0.5,
    currentFunction: 'cos', 
    mapPresentation: 'function',
    conformalGridEnabled: false,
    currentInputShape: 'grid_cartesian',
    domainColoringEnabled: false,
    gridDensity: 15,
    riemannSurfaceResolution: 50,
    showZerosPoles: false,
    showCriticalPoints: false,
    probeActive: false,
    probeZ: { re: 0, im: 0 },
    probeNeighborhoodSize: 0.2,
    riemannSphereViewEnabled: false,
    riemannTransformationEnabled: false,
    riemannTransformationProgressZ: 0.0,
    riemannTransformationPlayingZ: true,
    riemannTransformationProgressW: 0.0,
    riemannTransformationPlayingW: true,
    splitViewEnabled: false, 
    zPlaneZoom: 1.0,
    wPlaneZoom: 1.0,
    zeros: [],
    poles: [],
    criticalPoints: [],
    criticalValues: [],
    zetaContinuationEnabled: false,
    wOriginGlowTime: 0,
    previousWindingNumber: null,

    vectorFieldEnabled: false,
    vectorFieldFunction: 'f(z)',
    vectorFieldScale: 0.1,
    vectorArrowThickness: 1.5,
    vectorArrowHeadSize: 6,
    streamlineFlowEnabled: false,
    streamlineStepSize: 0.06,
    streamlineMaxLength: 400,
    streamlineThickness: 1.5,
    streamlineSeedDensityFactor: 0.8,

    imageResolution: 300,
    imageSize: 2.0,
    imageOpacity: 1.0,
    imageAspectRatio: 1.0,
    imageContentVersion: 0,
    uploadedImage: null,

    videoResolution: 300,
    videoProcessingFps: 60,
    videoSize: 2.0,
    videoOpacity: 1.0,
    videoAspectRatio: 1.0,
    videoFrameVersion: 0,
    uploadedVideo: null,
    uploadedVideoUrl: '',
    videoIsPlaying: false,
    videoStatusMessage: 'No video loaded.',
    videoProcessingLoopHandle: null,
    videoLastProcessedWallTime: 0,
    videoLastProcessedMediaTime: -1,

    panStateZ: { isPanning: false, panStart: { x: 0, y: 0 }, panStartOrigin: { x: 0, y: 0 } },
    panStateW: { isPanning: false, panStart: { x: 0, y: 0 }, panStartOrigin: { x: 0, y: 0 } },

    isZFullScreen: false,
    isWFullScreen: false,
    fullscreenWIndex: 0,
    topControlsCollapsed: false,
    verticalLayoutEnabled: undefined,

    cauchyIntegralModeEnabled: false,

    domainBrightness: 1.0,
    domainContrast: 1.0,
    domainSaturation: 1.0,
    domainLightnessCycles: 1.0,
    domainPalette: 'arctic-frost',

    themeId: 'rose',
    gridColor1: '#FB923C',
    gridColor2: '#C084FC',
    radialDiscreteStepsEnabled: false,
    radialDiscreteStepsCount: 200, 

    taylorSeriesEnabled: false,
    taylorSeriesOrder: 3,
    taylorSeriesCenter: { re: 0, im: 0 }, 
    taylorSeriesConvergenceRadius: Infinity,
    taylorSeriesCustomCenterEnabled: false,
    taylorSeriesCustomCenter: { re: 0, im: 0 },
    taylorSeriesColorAxisX: 'rgba(200, 150, 255, 0.7)',
    taylorSeriesColorAxisY: 'rgba(255, 150, 100, 0.7)',
    taylorSeriesColorConvergenceDiskFill: 'rgba(150, 150, 150, 0.2)',
    taylorSeriesColorConvergenceDiskStroke: 'rgba(150, 150, 150, 0.5)',

    particleAnimationEnabled: false,
    particleDensity: 150,
    particleSpeed: 0.04,
    particleMaxLifetime: 300,
    particles: [], 

    vectorFlowOptionsEnabled: false, 
    globalViewOptionsEnabled: false,
    threeSphereEnabled: false,
    threeSphereOpacity: 0.10,
    sphereGridOpacity: 0.0,
    riemannSurfaceEnabled: false,
    riemannSurfaceSheets: 5,
    riemannSurfaceBranchCenter: 0,
    riemannSurfaceComponent: 'imaginary',
    riemannSurfaceHeightScale: 1.0,
    riemannSurfaceHeightClip: 8.0,
    riemannSurfaceWireframe: true,
    contoursEnabled: false,
    contourInterval: 0.5,
    contourThickness: 1.5,
    webglLineRenderingEnabled: true,
    webglDomainColoringEnabled: true,
    webglGpuStressMode: false,

    fourierModeEnabled: false,
    fourierFunction: 'sine',
    fourierFrequency: 1.0,
    fourierAmplitude: 1.0,
    fourierTimeWindow: 4.0,
    fourierSamples: 128,
    fourierTimeDomainSignal: [],
    fourierDFTResult: [],
    fourierWindingFrequency: 1.0, 
    fourierWindingTime: 1.0, 

    laplaceModeEnabled: false,
    laplaceFunction: 'exponential',
    laplaceFrequency: 2.0,
    laplaceDamping: 0.5,
    laplaceSigma: 0.0,
    laplaceOmega: 1.0,
    laplaceAmplitude: 1.0,
    laplaceShowROC: true,
    laplaceVizMode: 'magnitude',
    laplaceClipHeight: 10,
    laplaceShowPolesZeros: true,
    laplaceShowFourierLine: true,
    laplaceAnimationTime: 1.0,
    laplaceAnimationPlaying: false,
    laplaceAnimationSpeed: 3.0,
    laplaceAnimationLoop: true,
    laplaceTimeDomainSignal: [],
    laplaceSurface: [],
    laplacePoles: [],
    laplaceZeros: [],
    laplaceStability: null,
    laplaceCurrentValue: null,
    laplaceROC: null,
    isLaplace3DFullScreen: false,
    realPlotsEnabled: false,
    realPlotsInputExpr: 'x',
    realPlotsInputIsCustom: false,
    realPlotsImagExpr: '0',
    realPlotsImagIsCustom: false,
    realPlotsOutputComponent: 'real',
    realPlotsPalette: 'viridis',
    realPlotsColorMode: 'height',
    realPlotsHeightScale: 1.0,
    isRealPlotsFullScreen: false,
    realPlotsCameraTargetMath: null,
    realPlotsCameraNeedsReset: false,
    graphViewEnabled: false,
    graphSelectedShape: '',
    graphSelectedLineIndex: 0,
    graphSelectionRevision: 0,
    graphTraceEnabled: false,
    isGraphFullScreen: false,
    show2DContourPlot: false,
    isContour2DFullScreen: false,
    chainingEnabled: false,
    chainingMode: 'recursion',
    chainCount: 1,
    currentFunctionPreset: null,
    orbitColoringMode: 'value',

    algebraicChainingEnabled: false,
    algebraicChainingZExpr: 'z',
    algebraicChainingTerms: [
        {
            coeff: { re: 1.0, im: 0.0 },
            factors: [
                { func: 'cos', chainedFunc: 'none', power: 1.0, reciprocal: false, log: false, exp: false }
            ]
        }
    ],

    dynamicPlotting: {
        enabled: false,
        mode: 'map',
        source: {
            kind: 'naturals',
            count: 50,
            start: 0,
            step: 1,
            ratio: 2,
            ordering: 'ascending',
            includeZero: false,
            includeNegative: false,
            min: 2,
            max: '',
            bound: 12,
            boundType: 'norm',
            associatePolicy: 'all',
            includeConjugates: true,
            points: [],
            pointsText: '0,0; 1,0; 0,1; -1,0; 0,-1',
            generatorExpression: 'j',
            filterExpression: ''
        },
        pointExpression: 'd',
        term: {
            kind: 'expression',
            expression: 'z',
            bindings: []
        },
        reduction: {
            kind: 'none',
            invalidPolicy: 'stop'
        },
        aggregateParameter: { re: 2, im: 0 },
        parameters: [
            { id: 'k', name: 'k', value: 1, min: -5, max: 5, step: 0.05 }
        ],
        playback: {
            visibleCount: 50,
            playing: false,
            speed: 12,
            loop: true,
            followResult: false
        },
        display: {
            showInputPoints: true,
            showInputPath: false,
            showTermPoints: true,
            showPartialPath: true,
            showVectors: true,
            showLabels: false,
            showInvalid: true,
            colorMode: 'semantic',
            productView: 'orbit',
            pointRadius: 3
        },
        selectedSampleId: null,
        preset: 'custom'
    },

    navigationModeEnabled: false,
    navigationPosition: { re: 0, im: 0 },
    navigationHeading: 0,
    navigationSize: 0.55,
    navigationOpacity: 0.9,
    navigationSpeed: 1.1,
    navigationTrailLength: 0,
    navigationKeys: {},
    navigationTrail: [],
    navigationLastTime: 0,
    isProcessingZDomainDynamics: false,
    isProcessingWDomainDynamics: false
};

const store = createObservableStore(rawState, {
    normalize(key, value, values) {
        return key === 'probeActive' && value === true && values.chainingEnabled
            ? false
            : value;
    }
});

export const state = store.state;
export const setState = store.set;
export const mutateState = store.mutate;
export const batchStateChanges = store.transaction;
export const subscribeState = store.subscribe;

// Preserve the probe/chaining invariant at the state boundary instead of in UI handlers.
subscribeState(({ value }) => {
    if (value && state.probeActive) state.probeActive = false;
}, 'chainingEnabled');

export const context = {
    zCanvas: null,
    wCanvas: null,
    zCtx: null,
    wCtx: null,
    zDomainColorCanvas: null,
    wDomainColorCanvas: null,
    zDomainColorCtx: null,
    wDomainColorCtx: null,

    wCanvasList: [],
    wCtxList: [],
    wPlaneParamsList: [],
    wPlaneThreeContainersList: [],
    sphereViewWParamsList: [],
    wPlanarTransformedLayerCacheList: [],

    redrawRequest: null,
    redrawQueued: false,
    animationStates: {},
    domainColoringDirty: true,
    domainColoringDirtyQueued: false,

    controls: {},
    polynomialCoeffUIElements: [],

    webglSupport: {
        available: false,
        reason: 'not-initialized',
        renderers: { z: null, w: null },
        diagnostics: { z: null, w: null }
    },

    webglDomainColorSupport: {
        available: false,
        reason: 'not-initialized',
        renderers: { z: null, w: null },
        diagnostics: { z: null, w: null },
        warnedFunctionFallbacks: new Set(),
        warnedRuntimeFallback: false
    }
};
