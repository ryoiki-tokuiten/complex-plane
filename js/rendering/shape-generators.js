import { state } from '../store/state.js';
import { NUM_POINTS_CURVE } from '../constants/numerical.js';
import {
    COLOR_Z_GRID_ZETA_UNDEFINED_SUM_REGION,
    COLOR_INPUT_SHAPE_Z, COLOR_INPUT_LINE_IM_Z
} from '../constants/colors.js';
import { LINE_WIDTH_THIN, LINE_WIDTH_NORMAL, LINE_WIDTH_THICK } from '../constants/rendering.js';
import {
    generateNativeInputShape,
    generateNativeRadialSteps,
    generateNativeViewportGridPixels,
    nativeMapOptions
} from '../native/complex-engine.js';
import { requireVisibleViewport } from '../utils/viewport.js';

const RADIAL_DISCRETE_STEP_COLOR = 'rgba(255, 255, 0, 0.7)';
const GENERAL_RADIAL_STEP_DOMAIN = Object.freeze({ min: -5, max: 5 });
const RADIAL_STEP_DOMAINS = Object.freeze({
    identity: GENERAL_RADIAL_STEP_DOMAIN,
    sin: Object.freeze({ min: 0, max: Math.PI / 2 }),
    cos: Object.freeze({ min: 0, max: Math.PI / 2 }),
    tan: Object.freeze({ min: 0, max: Math.PI / 2 }),
    sec: Object.freeze({ min: 0, max: Math.PI / 2 }),
    exp: Object.freeze({ min: -5, max: 5 }),
    ln: Object.freeze({ min: 0.01, max: 10 }),
    sinh: GENERAL_RADIAL_STEP_DOMAIN,
    tanh: GENERAL_RADIAL_STEP_DOMAIN,
    asin: GENERAL_RADIAL_STEP_DOMAIN,
    atan: GENERAL_RADIAL_STEP_DOMAIN,
    gamma: GENERAL_RADIAL_STEP_DOMAIN,
    loggamma: GENERAL_RADIAL_STEP_DOMAIN,
    bessel: GENERAL_RADIAL_STEP_DOMAIN,
    power: GENERAL_RADIAL_STEP_DOMAIN,
    polynomial: Object.freeze({ min: 0, max: 5 }),
    mobius: Object.freeze({ min: -5, max: 5 }),
    zeta: Object.freeze({ min: -10, max: 10 }),
    algebraic_chaining: GENERAL_RADIAL_STEP_DOMAIN
});

const GRID_INPUT_SHAPES = new Set([
    'grid_cartesian', 'grid_polar', 'grid_logpolar', 'grid_logcartesian', 'grid_dots'
]);

function integerAtLeast(value, minimum) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < minimum) {
        throw new Error(`Input-shape geometry requires an integer sample count of at least ${minimum}.`);
    }
    return numeric;
}

export function getVisiblePlaneRanges(planeParams) {
    const params = requireVisibleViewport(planeParams, 'Input-shape viewport');
    return {
        xRange: params.currentVisXRange,
        yRange: params.currentVisYRange
    };
}

export function buildInputShapeGeometryConfig(planeParams, options = {}) {
    const ranges = getVisiblePlaneRanges(planeParams);
    return {
        currentInputShape: options.currentInputShape ?? state.currentInputShape,
        currentFunction: options.currentFunction ?? state.currentFunction,
        zetaContinuationEnabled: options.zetaContinuationEnabled ?? state.zetaContinuationEnabled,
        xRange: options.xRange ?? ranges.xRange,
        yRange: options.yRange ?? ranges.yRange,
        gridDensity: integerAtLeast(options.gridDensity ?? state.gridDensity, 1),
        curvePoints: integerAtLeast(options.curvePoints ?? NUM_POINTS_CURVE, 8),
        a0: options.a0 ?? state.a0,
        b0: options.b0 ?? state.b0,
        circleR: options.circleR ?? state.circleR,
        arbitraryShapeMode: options.arbitraryShapeMode ?? state.arbitraryShapeMode,
        arbitraryShapeExpression: options.arbitraryShapeExpression ?? state.arbitraryShapeExpression,
        arbitraryShapeTMin: options.arbitraryShapeTMin ?? state.arbitraryShapeTMin,
        arbitraryShapeTMax: options.arbitraryShapeTMax ?? state.arbitraryShapeTMax,
        arbitraryShapeClosed: options.arbitraryShapeClosed ?? state.arbitraryShapeClosed,
        arbitraryShapePoints: options.arbitraryShapePoints ?? state.arbitraryShapePoints,
        preciseViewport: planeParams?.preciseViewport ? {
            ...planeParams.preciseViewport,
            width: planeParams.width,
            height: planeParams.height
        } : null
    };
}

function styleForRole(role) {
    const horizontal = state.gridColor1;
    const vertical = state.gridColor2;
    if (typeof horizontal !== 'string' || !horizontal || typeof vertical !== 'string' || !vertical) {
        throw new Error('Native input-shape rendering requires both grid colors.');
    }
    switch (role) {
        case 1: return { role: 'grid-horizontal', color: horizontal, lineWidth: LINE_WIDTH_NORMAL };
        case 2: return { role: 'grid-vertical', color: vertical, lineWidth: LINE_WIDTH_NORMAL };
        case 3: return { role: 'grid-vertical', color: COLOR_Z_GRID_ZETA_UNDEFINED_SUM_REGION, lineWidth: LINE_WIDTH_NORMAL };
        case 4: return { role: 'polar-angular', color: horizontal, lineWidth: LINE_WIDTH_NORMAL };
        case 5: return { role: 'polar-radial', color: vertical, lineWidth: LINE_WIDTH_NORMAL };
        case 6: return { role: 'logpolar-angular', color: horizontal, lineWidth: LINE_WIDTH_NORMAL };
        case 7: return { role: 'logpolar-radial', color: vertical, lineWidth: LINE_WIDTH_NORMAL };
        case 8: return { role: 'grid-dots', color: vertical, lineWidth: Math.max(2, LINE_WIDTH_NORMAL) };
        case 9: return { role: 'shape-arbitrary', color: COLOR_INPUT_SHAPE_Z, lineWidth: LINE_WIDTH_THICK };
        case 10: return { role: 'line-horizontal', color: COLOR_INPUT_SHAPE_Z, lineWidth: LINE_WIDTH_THICK };
        case 11: return { role: 'line-vertical', color: COLOR_INPUT_LINE_IM_Z, lineWidth: LINE_WIDTH_THICK };
        case 12: return { role: 'shape-curve', color: COLOR_INPUT_SHAPE_Z, lineWidth: LINE_WIDTH_THICK };
        default: throw new Error(`Unknown native input-shape role ${role}.`);
    }
}

export function generateInputShapePointSets(config) {
    if (['empty_grid', 'media', 'image', 'video'].includes(config?.currentInputShape)) return [];
    const lines = generateNativeInputShape(config, nativeMapOptions(state, {
        functionKey: config.currentFunction,
        chainingEnabled: false,
        chainCount: 1
    }));
    const pointSets = lines.map(line => ({ points: line.points, ...styleForRole(line.role) }));
    if (config.preciseViewport && ['grid_cartesian', 'grid_dots'].includes(config.currentInputShape)) {
        const exact = generateNativeViewportGridPixels(config);
        for (let index = 0; index < pointSets.length; ++index) {
            if (!exact[index]?.canvasPoints) {
                throw new Error(`Native precise input-shape geometry ${index} is missing canvas points.`);
            }
            pointSets[index].canvasPoints = exact[index].canvasPoints;
        }
    }
    return pointSets;
}

export function generateCurrentInputShapePointSets(planeParams, options = {}) {
    return generateInputShapePointSets(buildInputShapeGeometryConfig(planeParams, options));
}

export function generateRadialDiscreteStepPointSets(functionKey, stepsCount, options = {}) {
    const steps = integerAtLeast(stepsCount, 0);
    if (steps < 2) return [];
    const domain = RADIAL_STEP_DOMAINS[functionKey];
    if (!domain) throw new Error(`Radial discrete steps do not support ${functionKey}.`);
    const points = generateNativeRadialSteps(
        nativeMapOptions(state, { functionKey }),
        domain,
        steps,
        integerAtLeast(options.curvePoints ?? NUM_POINTS_CURVE / 2, 24)
    );
    return points.map(line => ({
        points: line,
        color: RADIAL_DISCRETE_STEP_COLOR,
        role: 'radial-discrete-step',
        lineWidth: LINE_WIDTH_THIN
    }));
}

export function isFoldableInputShape(shape) {
    return GRID_INPUT_SHAPES.has(shape) || shape === 'arbitrary';
}
