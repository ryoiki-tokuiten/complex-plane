// js/store/state.js

import { createObservableStore } from './observable-store.js';
import {
    DEFAULT_CANVAS_WIDTH,
    DEFAULT_CANVAS_HEIGHT
} from '../constants/rendering.js';
import { GRID_SHAPE_DEFAULTS } from '../constants/grid-shapes.js';

export const zPlaneInitialRanges = { x: [-3.5, 3.5], y: [-3.0, 3.0] };
export const wPlaneInitialRanges = { x: [-6.5, 6.5], y: [-6.5, 6.5] };

export const zPlaneParams = {
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
    origin: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    currentVisXRange: [...zPlaneInitialRanges.x],
    currentVisYRange: [...zPlaneInitialRanges.y],
    preciseViewport: null
};

export const wPlaneParams = {
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
    origin: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    currentVisXRange: [...wPlaneInitialRanges.x],
    currentVisYRange: [...wPlaneInitialRanges.y],
    preciseViewport: null
};

export const laplaceComInitialRanges = { x: [0, 8], y: [-1.2, 1.2] };
export const laplaceSpectrumInitialRanges = { x: [-0.5, 16.5], y: [0, 1.5] };

export const laplaceComPlaneParams = {
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
    origin: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    currentVisXRange: [...laplaceComInitialRanges.x],
    currentVisYRange: [...laplaceComInitialRanges.y],
    preciseViewport: null
};

export const laplaceSpectrumPlaneParams = {
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
    origin: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    currentVisXRange: [...laplaceSpectrumInitialRanges.x],
    currentVisYRange: [...laplaceSpectrumInitialRanges.y],
    preciseViewport: null
};

export const sliderParamKeys = ['a0', 'b0', 'circleR', 'fractionalPowerN'];

const rawState = {
    a0: 0.0, b0: 0.0,
    circleR: 1.0,
    mobiusA: { re: 1, im: 0 },
    mobiusB: { re: 0, im: 0 },
    mobiusC: { re: 0, im: 0 },
    mobiusD: { re: 1, im: 0 },
    polynomialN: 2,
    polynomialCoeffs: [{ re: 1, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }],
    fractionalPowerN: 0.5,
    expBase: { re: Math.E, im: 0 },
    logBase: { re: Math.E, im: 0 },
    besselOrder: { re: 0, im: 0 },
    currentFunction: 'cos', 
    mapPresentation: 'function',
    conformalGridEnabled: false,
    currentInputShape: 'grid_cartesian',
    foldSurface3dEnabled: false,
    foldSurfaceHeightScale: 1.0,
    domainColoringEnabled: false,
    domainColoringKeyVisible: false,
    gridDensity: 15,
    gridParameters: Object.fromEntries(
        Object.entries(GRID_SHAPE_DEFAULTS).map(([shape, parameters]) => [shape, { ...parameters }])
    ),
    riemannSurfaceResolution: 50,
    showZerosPoles: false,
    showCriticalPoints: false,
    probeActive: false,
    probeZ: { re: 0, im: 0 },
    probeNeighborhoodSize: 0.2,
    manifold3dViewEnabled: false,
    selectedManifold: 'sphere',
    manifoldTransformationEnabled: false,
    manifoldTransformationProgressZ: 0.0,
    manifoldTransformationPlayingZ: true,
    manifoldTransformationSpeedZ: 1.0,
    manifoldTransformationProgressW: 0.0,
    manifoldTransformationPlayingW: true,
    manifoldTransformationSpeedW: 1.0,
    zPlaneZoom: 1.0,
    wPlaneZoom: 1.0,
    canvasZoomControlsEnabled: typeof localStorage !== 'undefined' ? localStorage.getItem('complex_canvasZoomControlsEnabled') === 'true' : false,
    zeros: [],
    poles: [],
    criticalPoints: [],
    criticalValues: [],
    zetaContinuationEnabled: false,
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

    mediaSize: 2.0,
    mediaOpacity: 1.0,
    mediaAspectRatio: 1.0,
    mediaVersion: 0,
    videoProcessingFps: 60,
    videoIsPlaying: false,
    videoStatusMessage: 'No video loaded.',

    isZFullScreen: false,
    isWFullScreen: false,
    fullscreenWIndex: 0,
    topControlsCollapsed: false,
    verticalLayoutEnabled: undefined,

    cauchyIntegralModeEnabled: false,
    arbitraryShapeMode: 'draw',
    arbitraryShapeExpression: 'cos(t) + i*sin(t)',
    arbitraryShapeTMin: 0,
    arbitraryShapeTMax: Math.PI * 2,
    arbitraryShapeClosed: true,
    arbitraryShapePoints: [],

    branchCutType: 'ray',
    branchCutAngle: Math.PI,
    branchCutPoints: [],
    continuationPath: [],
    continuationValues: [],
    continuationSheet: 0,
    continuationValue: null,
    branchDrawMode: null,

    preimageExplorerEnabled: false,
    preimageTarget: null,
    preimageRoots: [],
    preimageStatus: '',

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
    taylorSeriesCanvasClickCenterEnabled: false,
    taylorSeriesHoverPoint: null,
    taylorSeriesColorAxisX: 'rgba(200, 150, 255, 0.7)',
    taylorSeriesColorAxisY: 'rgba(255, 150, 100, 0.7)',
    taylorSeriesColorConvergenceDiskFill: 'rgba(150, 150, 150, 0.2)',
    taylorSeriesColorConvergenceDiskStroke: 'rgba(150, 150, 150, 0.5)',

    particleAnimationEnabled: false,
    particleDensity: 150,
    particleSpeed: 0.04,
    particleMaxLifetime: 300,

    manifoldSurfaceOpacity: 0.35,
    manifoldGridOpacity: 0.25,
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
    laplaceModeEnabled: false,
    laplaceFunction: 'exponential',
    laplaceFrequency: 2.0,
    laplaceDamping: 0.5,
    laplaceAmplitude: 1.0,
    laplaceTimeWindow: 4.0,
    laplaceSamples: 1024,
    laplaceSigma: 0.0,
    laplaceOmega: 1.0,
    laplaceShowROC: false,
    laplaceVizMode: 'magnitude',
    laplaceClipHeight: 10,
    laplaceShowPolesZeros: true,
    laplaceShowFourierLine: true,
    laplaceHideIntegralEvaluation: true,
    laplaceHide3DSurface: false,
    laplaceShowSpectrum: true,
    laplaceShowComGraph: true,
    laplaceComComponent: 'both',
    laplaceSyncWindingVector: true,
    laplaceShowBarriers: true,
    laplaceAnimationTime: 1.0,
    laplaceAnimationPlaying: false,
    laplaceAnimationSpeed: 3.0,
    laplaceAnimationLoop: true,
    laplaceTimeDomainSignal: [],
    laplaceSpectrum: [],
    laplaceComSweep: [],
    laplaceSurface: null,
    laplacePoles: [],
    laplaceZeros: [],
    laplaceCurrentValue: null,
    laplaceROC: null,
    isLaplace3DFullScreen: false,
    isLaplaceComFullScreen: false,
    isLaplaceSpectrumFullScreen: false,
    laplaceShowFourier3D: true,
    fourier3DParallelGraphs: 4,
    isFourier3DFullScreen: false,
    realPlotsEnabled: false,
    realPlotsInputExpr: 'x',
    realPlotsInputIsCustom: false,
    realPlotsImagExpr: '0',
    realPlotsImagIsCustom: false,
    realPlotsOutputComponent: 'real',
    surfacePalette: 'viridis',
    realPlotsColorMode: 'height',
    realPlotsHeightScale: 1.0,
    realPlotsBrightness: 0.5,
    realPlotsContrast: 1.0,
    realPlotsSaturation: 1.0,
    isRealPlotsFullScreen: false,
    graphViewEnabled: false,
    graphSelectedShape: '',
    graphSelectedLineIndex: 0,
    graphSelectionRevision: 0,
    graphTraceEnabled: false,
    graphFullGridEnabled: false,
    graphGridFamily: 'primary',
    graphFocusBoxEnabled: true,
    graphLayerLockEnabled: false,
    graphFourierEnabled: false,
    isGraphFullScreen: false,
    show2DContourPlot: false,
    isContour2DFullScreen: false,
    chainingEnabled: false,
    chainingMode: 'recursion',
    chainSeed: { re: 0, im: 0 },
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
    navigationSize: 0.55,
    navigationOpacity: 0.9,
    navigationSpeed: 1.1,
    navigationTrailLength: 0
};

const store = createObservableStore(rawState, {
    normalize(key, value, values) {
        return key === 'probeActive' && value === true && values.chainingEnabled
            ? false
            : value;
    }
});

export const state = store.state;
export const mutateState = store.mutate;
export const subscribeState = store.subscribe;
export const getStateSignal = store.getSignal;

// Preserve the probe/chaining invariant at the state boundary instead of in UI handlers.
subscribeState(({ value }) => {
    if (value && state.probeActive) state.probeActive = false;
}, 'chainingEnabled');

// Preserve mutual exclusivity between domain coloring and 3D manifold modes.
subscribeState(({ value }) => {
    if (value && state.manifold3dViewEnabled) {
        state.manifold3dViewEnabled = false;
        state.manifoldTransformationEnabled = false;
    }
}, 'domainColoringEnabled');

subscribeState(({ value }) => {
    if (value && state.domainColoringEnabled) {
        state.domainColoringEnabled = false;
    }
}, 'manifold3dViewEnabled');

export const context = {
    zCanvas: null,
    wCanvas: null,
    zCtx: null,
    wCtx: null,
    zDomainColorCanvas: null,
    zDomainColorCtx: null,

    wCanvasList: [],
    wCtxList: [],
    wPlaneParamsList: [],
    wPlaneThreeContainersList: [],
    wPlanarTransformedLayerCacheList: [],
    redrawRequest: null,
    redrawQueued: false,
    animationStates: {},
    domainColoringDirty: true,

    controls: {}
};
