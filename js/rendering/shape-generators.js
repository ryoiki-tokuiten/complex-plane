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
import {
    CUSTOM_GRID_INPUT_SHAPE_SET
} from '../constants/grid-shapes.js';

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
    'grid_cartesian', 'grid_polar', 'grid_logpolar', 'grid_logcartesian', 'grid_dots',
    ...CUSTOM_GRID_INPUT_SHAPE_SET
]);

const GRID_EPSILON = 1e-9;
const CUSTOM_GRID_ROLES = Object.freeze({
    horizontal: 'grid-horizontal',
    vertical: 'grid-vertical',
    diagonal: 'grid-diagonal',
    curvilinearHorizontal: 'grid-curvilinear-horizontal',
    curvilinearVertical: 'grid-curvilinear-vertical',
    spiralPrimary: 'grid-spiral-primary',
    spiralSecondary: 'grid-spiral-secondary'
});

function integerAtLeast(value, minimum) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < minimum) {
        throw new Error(`Input-shape geometry requires an integer sample count of at least ${minimum}.`);
    }
    return numeric;
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function gridParameter(config, shapeKey, key) {
    const value = Number(config.gridParameters[shapeKey][key]);
    if (!Number.isFinite(value)) throw new Error(`Invalid ${shapeKey}.${key} grid parameter.`);
    return value;
}

function customGridStyles() {
    const horizontal = state.gridColor1;
    const vertical = state.gridColor2;
    if (typeof horizontal !== 'string' || !horizontal || typeof vertical !== 'string' || !vertical) {
        throw new Error('Custom grid rendering requires both grid colors.');
    }
    return { horizontal, vertical };
}

function customGridPointSet(points, role, color) {
    return {
        points,
        role,
        color,
        lineWidth: LINE_WIDTH_NORMAL
    };
}

function customGridSampleCount(config) {
    return Math.max(16, Math.min(320, Math.floor(config.curvePoints / 4)));
}

function sampleSegment(start, end, count) {
    return Array.from({ length: count + 1 }, (_, index) => {
        const t = index / count;
        return {
            re: start.re + (end.re - start.re) * t,
            im: start.im + (end.im - start.im) * t
        };
    });
}

function sampleCurve(callback, count) {
    return Array.from({ length: count + 1 }, (_, index) => callback(index / count));
}

function axisIntervals(density, spacing) {
    return Math.max(1, Math.min(180, Math.round(density / Math.max(spacing, 0.05))));
}

function evenlySpacedValues(minimum, maximum, intervals) {
    return Array.from({ length: intervals + 1 }, (_, index) =>
        minimum + (maximum - minimum) * index / intervals
    );
}

function rectangleCorners(xRange, yRange) {
    return [
        { re: xRange[0], im: yRange[0] },
        { re: xRange[0], im: yRange[1] },
        { re: xRange[1], im: yRange[0] },
        { re: xRange[1], im: yRange[1] }
    ];
}

function normalRange(normal, xRange, yRange) {
    const values = rectangleCorners(xRange, yRange).map(point =>
        normal.x * point.re + normal.y * point.im
    );
    return [Math.min(...values), Math.max(...values)];
}

function clipInfiniteLineToViewport(direction, normal, offset, xRange, yRange) {
    const candidates = [];
    const addCandidate = t => {
        const point = {
            re: direction.x * t + normal.x * offset,
            im: direction.y * t + normal.y * offset
        };
        if (point.re >= xRange[0] - GRID_EPSILON && point.re <= xRange[1] + GRID_EPSILON &&
            point.im >= yRange[0] - GRID_EPSILON && point.im <= yRange[1] + GRID_EPSILON &&
            !candidates.some(candidate => Math.hypot(candidate.point.re - point.re, candidate.point.im - point.im) < GRID_EPSILON)) {
            candidates.push({ t, point });
        }
    };

    if (Math.abs(direction.x) > GRID_EPSILON) {
        [xRange[0], xRange[1]].forEach(x => addCandidate((x - normal.x * offset) / direction.x));
    }
    if (Math.abs(direction.y) > GRID_EPSILON) {
        [yRange[0], yRange[1]].forEach(y => addCandidate((y - normal.y * offset) / direction.y));
    }

    if (candidates.length < 2) return null;
    candidates.sort((a, b) => a.t - b.t);
    return [candidates[0].point, candidates[candidates.length - 1].point];
}

function appendClippedLineFamily(pointSets, config, {
    direction,
    role,
    color,
    spacing,
    samples,
    intervals
}) {
    const normal = { x: -direction.y, y: direction.x };
    const [offsetMin, offsetMax] = normalRange(normal, config.xRange, config.yRange);
    const span = Math.max(config.xRange[1] - config.xRange[0], config.yRange[1] - config.yRange[0]);
    const requestedIntervals = intervals ?? Math.max(
        1,
        Math.min(180, Math.round((offsetMax - offsetMin) / (span / config.gridDensity * spacing)))
    );
    evenlySpacedValues(offsetMin, offsetMax, requestedIntervals).forEach(offset => {
        const segment = clipInfiniteLineToViewport(
            direction, normal, offset, config.xRange, config.yRange
        );
        if (segment) {
            pointSets.push(customGridPointSet(sampleSegment(segment[0], segment[1], samples), role, color));
        }
    });
}

function generateRectilinearGrid(config) {
    const styles = customGridStyles();
    const samples = customGridSampleCount(config);
    const xIntervals = axisIntervals(config.gridDensity, gridParameter(config, 'rectilinear', 'xSpacing'));
    const yIntervals = axisIntervals(config.gridDensity, gridParameter(config, 'rectilinear', 'ySpacing'));
    const pointSets = [];

    evenlySpacedValues(config.yRange[0], config.yRange[1], yIntervals).forEach(im => {
        pointSets.push(customGridPointSet(
            sampleSegment({ re: config.xRange[0], im }, { re: config.xRange[1], im }, samples),
            CUSTOM_GRID_ROLES.horizontal,
            styles.horizontal
        ));
    });
    evenlySpacedValues(config.xRange[0], config.xRange[1], xIntervals).forEach(re => {
        pointSets.push(customGridPointSet(
            sampleSegment({ re, im: config.yRange[0] }, { re, im: config.yRange[1] }, samples),
            CUSTOM_GRID_ROLES.vertical,
            styles.vertical
        ));
    });
    return pointSets;
}

function generateNonOrthogonalGrid(config) {
    const styles = customGridStyles();
    const samples = customGridSampleCount(config);
    const spacing = gridParameter(config, 'nonOrthogonal', 'spacing');
    const angle = gridParameter(config, 'nonOrthogonal', 'angle') * Math.PI / 180;
    const pointSets = [];
    const span = Math.max(config.xRange[1] - config.xRange[0], config.yRange[1] - config.yRange[0]);
    const intervals = Math.max(1, Math.min(180, Math.round(config.gridDensity / spacing)));

    appendClippedLineFamily(pointSets, config, {
        direction: { x: 1, y: 0 },
        role: CUSTOM_GRID_ROLES.horizontal,
        color: styles.horizontal,
        spacing,
        samples,
        intervals: Math.max(1, Math.min(180, Math.round(
            (config.yRange[1] - config.yRange[0]) / (span / config.gridDensity * spacing)
        )))
    });
    appendClippedLineFamily(pointSets, config, {
        direction: { x: Math.cos(angle), y: Math.sin(angle) },
        role: CUSTOM_GRID_ROLES.vertical,
        color: styles.vertical,
        spacing,
        samples,
        intervals
    });
    return pointSets;
}

function generateTriangularGrid(config) {
    const styles = customGridStyles();
    const samples = customGridSampleCount(config);
    const size = gridParameter(config, 'triangular', 'size');
    const rotation = gridParameter(config, 'triangular', 'rotation') * Math.PI / 180;
    const pointSets = [];
    const roles = [
        CUSTOM_GRID_ROLES.horizontal,
        CUSTOM_GRID_ROLES.vertical,
        CUSTOM_GRID_ROLES.diagonal
    ];
    const colors = [styles.horizontal, styles.vertical, styles.horizontal];
    const span = Math.max(config.xRange[1] - config.xRange[0], config.yRange[1] - config.yRange[0]);
    const intervals = Math.max(1, Math.min(180, Math.round(config.gridDensity / size)));

    [0, Math.PI / 3, (2 * Math.PI) / 3].forEach((offset, familyIndex) => {
        appendClippedLineFamily(pointSets, config, {
            direction: {
                x: Math.cos(rotation + offset),
                y: Math.sin(rotation + offset)
            },
            role: roles[familyIndex],
            color: colors[familyIndex],
            spacing: size,
            samples,
            intervals: Math.max(1, Math.min(180, Math.round(
                intervals * Math.max(0.65, normalRange({
                    x: -Math.sin(rotation + offset),
                    y: Math.cos(rotation + offset)
                }, config.xRange, config.yRange)[1] - normalRange({
                    x: -Math.sin(rotation + offset),
                    y: Math.cos(rotation + offset)
                }, config.xRange, config.yRange)[0]) / span
            )))
        });
    });
    return pointSets;
}

function generateCurvilinearGrid(config) {
    const styles = customGridStyles();
    const samples = Math.max(24, customGridSampleCount(config));
    const bend = clamp(gridParameter(config, 'curvilinear', 'bend'), 0.15, 1);
    const focus = clamp(gridParameter(config, 'curvilinear', 'focus'), -1, 1);
    const spanX = config.xRange[1] - config.xRange[0];
    const spanY = config.yRange[1] - config.yRange[0];
    const center = {
        re: (config.xRange[0] + config.xRange[1]) / 2 + focus * spanX * 0.35,
        im: config.yRange[0] - spanY * (0.08 + bend * 0.12)
    };
    const halfAngle = Math.PI * (0.22 + bend * 0.3);
    const angleMin = Math.PI / 2 - halfAngle;
    const angleMax = Math.PI / 2 + halfAngle;
    const radiusMin = Math.max(Math.min(spanX, spanY) * 0.045, 0.001);
    const radiusMax = Math.max(spanX, spanY) * (0.95 + bend * 0.8);
    const intervals = Math.max(1, Math.min(180, Math.round(config.gridDensity)));
    const pointSets = [];

    evenlySpacedValues(angleMin, angleMax, intervals).forEach(angle => {
        pointSets.push(customGridPointSet(
            sampleCurve(t => {
                const radius = radiusMin + (radiusMax - radiusMin) * t;
                return {
                    re: center.re + radius * Math.cos(angle),
                    im: center.im + radius * Math.sin(angle)
                };
            }, samples),
            CUSTOM_GRID_ROLES.curvilinearVertical,
            styles.vertical
        ));
    });
    evenlySpacedValues(0, 1, intervals).forEach(t => {
        const radius = radiusMin + (radiusMax - radiusMin) * Math.pow(t, 1 + bend * 1.4);
        pointSets.push(customGridPointSet(
            sampleCurve(angleT => ({
                re: center.re + radius * Math.cos(angleMin + (angleMax - angleMin) * angleT),
                im: center.im + radius * Math.sin(angleMin + (angleMax - angleMin) * angleT)
            }), samples),
            CUSTOM_GRID_ROLES.curvilinearHorizontal,
            styles.horizontal
        ));
    });
    return pointSets;
}

function generateSpiralGrid(config) {
    const styles = customGridStyles();
    const turns = clamp(gridParameter(config, 'spiral', 'turns'), 0.5, 5);
    const tightness = clamp(gridParameter(config, 'spiral', 'tightness'), 0.2, 1.5);
    const arms = Math.round(clamp(gridParameter(config, 'spiral', 'arms'), 1, 6));
    const samples = Math.max(48, Math.min(480, customGridSampleCount(config) * 2));
    const center = {
        re: (config.xRange[0] + config.xRange[1]) / 2,
        im: (config.yRange[0] + config.yRange[1]) / 2
    };
    const maxRadius = Math.hypot(
        config.xRange[1] - config.xRange[0],
        config.yRange[1] - config.yRange[0]
    ) * 0.58;
    const minRadius = Math.max(maxRadius * 0.018, 0.001);
    const growthPower = 0.45 + tightness * 0.7;
    const pointSets = [];

    const addSpiralFamily = (phaseOffset, role, color) => {
        for (let arm = 0; arm < arms; arm += 1) {
            const phase = phaseOffset + (arm * 2 * Math.PI) / arms;
            pointSets.push(customGridPointSet(
                sampleCurve(t => {
                    const radius = minRadius * Math.exp(
                        Math.log(maxRadius / minRadius) * Math.pow(t, growthPower)
                    );
                    const angle = phase + turns * 2 * Math.PI * t;
                    return {
                        re: center.re + radius * Math.cos(angle),
                        im: center.im + radius * Math.sin(angle)
                    };
                }, samples),
                role,
                color
            ));
        }
    };

    addSpiralFamily(0, CUSTOM_GRID_ROLES.spiralPrimary, styles.horizontal);
    addSpiralFamily(Math.PI / arms, CUSTOM_GRID_ROLES.spiralSecondary, styles.vertical);
    return pointSets;
}

function irregularValues(minimum, maximum, intervals, variation, clustering, phase) {
    if (variation <= 0) return evenlySpacedValues(minimum, maximum, intervals);

    const weights = Array.from({ length: intervals }, (_, index) => {
        const t = (index + 0.5) / intervals;
        const wave = 0.5 + 0.5 * Math.sin((index + 1) * 2.17 + phase);
        const clusterWave = Math.cos((t - 0.5) * Math.PI * (2.5 + Math.abs(clustering) * 2));
        return Math.max(0.12, 1 + variation * (wave - 0.35 + clustering * 0.45 * clusterWave));
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let progress = 0;
    return [minimum, ...weights.map(weight => {
        progress += weight / total;
        return minimum + (maximum - minimum) * progress;
    })];
}

function generateIrregularGrid(config) {
    const styles = customGridStyles();
    const variation = clamp(gridParameter(config, 'irregular', 'variation'), 0, 0.8);
    const clustering = clamp(gridParameter(config, 'irregular', 'clustering'), -1, 1);
    const intervals = Math.max(2, Math.min(180, Math.round(config.gridDensity)));
    const samples = customGridSampleCount(config);
    const pointSets = [];
    const yValues = irregularValues(config.yRange[0], config.yRange[1], intervals, variation, clustering, 0.8);
    const xValues = irregularValues(config.xRange[0], config.xRange[1], intervals, variation, clustering, 2.4);

    yValues.forEach(im => pointSets.push(customGridPointSet(
        sampleSegment({ re: config.xRange[0], im }, { re: config.xRange[1], im }, samples),
        CUSTOM_GRID_ROLES.horizontal,
        styles.horizontal
    )));
    xValues.forEach(re => pointSets.push(customGridPointSet(
        sampleSegment({ re, im: config.yRange[0] }, { re, im: config.yRange[1] }, samples),
        CUSTOM_GRID_ROLES.vertical,
        styles.vertical
    )));
    return pointSets;
}

const CUSTOM_GRID_GENERATORS = Object.freeze({
    grid_rectilinear: generateRectilinearGrid,
    grid_nonorthogonal: generateNonOrthogonalGrid,
    grid_triangular: generateTriangularGrid,
    grid_curvilinear: generateCurvilinearGrid,
    grid_spiral: generateSpiralGrid,
    grid_irregular: generateIrregularGrid
});

function getVisiblePlaneRanges(planeParams) {
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
        gridParameters: options.gridParameters ?? state.gridParameters,
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
    if (['empty_grid', 'navigate', 'media'].includes(config?.currentInputShape)) return [];
    if (CUSTOM_GRID_INPUT_SHAPE_SET.has(config?.currentInputShape)) {
        const generator = CUSTOM_GRID_GENERATORS[config.currentInputShape];
        if (!generator) throw new Error(`Missing custom grid generator for ${config.currentInputShape}.`);
        return generator(config);
    }
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
