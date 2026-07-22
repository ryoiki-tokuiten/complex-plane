import { state } from '../store/state.js';
import { TWO_PI, NUM_POINTS_CURVE, ZETA_REFLECTION_POINT_RE } from '../constants/numerical.js';
import {
    COLOR_Z_GRID_HORZ, COLOR_Z_GRID_VERT,
    COLOR_Z_GRID_ZETA_UNDEFINED_SUM_REGION,
    COLOR_INPUT_SHAPE_Z, COLOR_INPUT_LINE_IM_Z
} from '../constants/colors.js';
import { LINE_WIDTH_THIN, LINE_WIDTH_NORMAL, LINE_WIDTH_THICK } from '../constants/rendering.js';

const EPSILON = 1e-9;
const MIN_VISIBLE_RADIUS = 0.1;
const MIN_LOGPOLAR_RADIUS = 0.05;
const RADIAL_DISCRETE_STEP_COLOR = 'rgba(255, 255, 0, 0.7)';
const UNIT_CIRCLE_CACHE_LIMIT = 256;

const RADIAL_STEP_DOMAIN_DEFAULT = Object.freeze({ min: -5, max: 5 });
const RADIAL_STEP_DOMAINS = Object.freeze({
    cos: Object.freeze({ min: 0, max: Math.PI / 2 }),
    sin: Object.freeze({ min: 0, max: Math.PI / 2 }),
    tan: Object.freeze({ min: 0, max: Math.PI / 2 }),
    sec: Object.freeze({ min: 0, max: Math.PI / 2 }),
    exp: Object.freeze({ min: -5, max: 5 }),
    ln: Object.freeze({ min: 0.01, max: 10 }),
    polynomial: Object.freeze({ min: 0, max: 5 }),
    mobius: Object.freeze({ min: -5, max: 5 }),
    reciprocal: Object.freeze({ min: -5, max: 5 }),
    zeta: Object.freeze({ min: -10, max: 10 })
});

const RADIAL_STEP_SINGULARITIES = Object.freeze({
    zeta: value => Math.abs(value - 1.0) < EPSILON,
    reciprocal: value => Math.abs(value) < EPSILON,
    ln: value => value <= EPSILON
});

/*
 * The public contract still returns arrays of { re, im } points. Internally we
 * remove callback-heavy sampling, transient range arrays, spread/slice/filter
 * churn, and repeated full-circle trig. The single cache below stores immutable
 * unit-circle coordinate tables; callers receive fresh point objects, so no
 * downstream mutation can corrupt cached numeric data.
 */
const UNIT_CIRCLE_CACHE = new Map();

const emptyPointSets = () => [];
function defaultRange() {
    return [-1, 1];
}

function isRangeLike(value) {
    return Array.isArray(value) && value.length >= 2;
}

function firstRange(rangeA, rangeB) {
    if (isRangeLike(rangeA)) return rangeA;
    if (isRangeLike(rangeB)) return rangeB;
    return defaultRange();
}

function integerAtLeast(value, minimum) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue)
        ? Math.max(minimum, Math.floor(numericValue))
        : minimum;
}

function unitCircleTable(segments) {
    let table = UNIT_CIRCLE_CACHE.get(segments);
    if (table !== undefined) return table;

    table = new Float64Array((segments + 1) << 1);
    for (let index = 0, offset = 0; index <= segments; index += 1, offset += 2) {
        const angle = (index / segments) * TWO_PI;
        table[offset] = Math.cos(angle);
        table[offset + 1] = Math.sin(angle);
    }

    if (UNIT_CIRCLE_CACHE.size >= UNIT_CIRCLE_CACHE_LIMIT) {
        UNIT_CIRCLE_CACHE.delete(UNIT_CIRCLE_CACHE.keys().next().value);
    }
    UNIT_CIRCLE_CACHE.set(segments, table);
    return table;
}

function cartesianSegment(startRe, startIm, endRe, endIm, segments) {
    const count = integerAtLeast(segments, 1);
    const points = new Array(count + 1);
    const stepRe = (endRe - startRe) / count;
    const stepIm = (endIm - startIm) / count;
    let re = startRe;
    let im = startIm;

    for (let index = 0; index < count; index += 1) {
        points[index] = { re, im };
        re += stepRe;
        im += stepIm;
    }
    points[count] = { re: endRe, im: endIm };

    return points;
}

function radialSegment(angle, startRadius, endRadius, segments) {
    const count = integerAtLeast(segments, 1);
    const points = new Array(count + 1);
    const radiusStep = (endRadius - startRadius) / count;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let radius = startRadius;

    for (let index = 0; index < count; index += 1) {
        points[index] = { re: radius * cos, im: radius * sin };
        radius += radiusStep;
    }
    points[count] = { re: endRadius * cos, im: endRadius * sin };

    return points;
}

function logarithmicRadialSegment(angle, minLogRadius, maxLogRadius, segments) {
    const count = integerAtLeast(segments, 1);
    const points = new Array(count + 1);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const ratio = Math.exp((maxLogRadius - minLogRadius) / count);
    let radius = Math.exp(minLogRadius);

    for (let index = 0; index <= count; index += 1) {
        points[index] = { re: radius * cos, im: radius * sin };
        radius *= ratio;
    }

    return points;
}

function finitePoint(value) {
    return value !== null && value !== undefined && Number.isFinite(value.re) && Number.isFinite(value.im);
}

function maxVisibleRadius(config) {
    const xRange = config.xRange;
    const yRange = config.yRange;
    const x0 = Math.abs(xRange[0]);
    const x1 = Math.abs(xRange[1]);
    const y0 = Math.abs(yRange[0]);
    const y1 = Math.abs(yRange[1]);
    return Math.max(x0, x1, y0, y1, MIN_VISIBLE_RADIUS);
}

function currentGridPalette() {
    const gridColor1 = state.gridColor1;
    const gridColor2 = state.gridColor2;
    return {
        horizontal: gridColor1 || COLOR_Z_GRID_HORZ,
        vertical: gridColor2 || COLOR_Z_GRID_VERT,
        zetaUndefinedSumRegion: COLOR_Z_GRID_ZETA_UNDEFINED_SUM_REGION
    };
}

function radialStepIsSingular(functionKey, value) {
    const predicate = RADIAL_STEP_SINGULARITIES[functionKey];
    return predicate !== undefined && predicate(value);
}

function makeCirclePoints(cx, cy, radius, segments) {
    const count = integerAtLeast(segments, 1);
    const table = unitCircleTable(count);
    const points = new Array(count + 1);

    for (let index = 0, offset = 0; index <= count; index += 1, offset += 2) {
        points[index] = { re: cx + radius * table[offset], im: cy + radius * table[offset + 1] };
    }

    return points;
}

function makeEllipsePoints(cx, cy, a, b, segments) {
    const count = integerAtLeast(segments, 1);
    const table = unitCircleTable(count);
    const points = new Array(count + 1);

    for (let index = 0, offset = 0; index <= count; index += 1, offset += 2) {
        points[index] = { re: cx + a * table[offset], im: cy + b * table[offset + 1] };
    }

    return points;
}

export function createLineSet(points, color, role, lineWidth) {
    return { points, color, role, lineWidth };
}

export function getVisiblePlaneRanges(planeParams) {
    const params = planeParams ?? {};

    return {
        xRange: firstRange(params.currentVisXRange, params.xRange),
        yRange: firstRange(params.currentVisYRange, params.yRange)
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
        ellipseA: options.ellipseA ?? state.ellipseA,
        ellipseB: options.ellipseB ?? state.ellipseB
    };
}

export function generateCirclePoints(cx, cy, radius, numPoints) {
    return makeCirclePoints(cx, cy, radius, numPoints);
}



export function generateLinePoints(xMin, xMax, y, numPoints) {
    return cartesianSegment(xMin, y, xMax, y, numPoints);
}

export function generateVerticalLinePoints(x, yMin, yMax, numPoints) {
    return cartesianSegment(x, yMin, x, yMax, numPoints);
}

export function generateCartesianGridPointSets(config) {
    const palette = currentGridPalette();
    const sampleCount = integerAtLeast(config.curvePoints / 2, 2);
    const gridDensity = integerAtLeast(config.gridDensity, 1);
    const lineCount = gridDensity + 1;
    const pointSets = new Array(lineCount << 1);
    const xRange = config.xRange;
    const yRange = config.yRange;
    const x0 = xRange[0];
    const x1 = xRange[1];
    const y0 = yRange[0];
    const yStep = (yRange[1] - y0) / gridDensity;
    const xStep = (x1 - x0) / gridDensity;
    const zetaBlocked = config.currentFunction === 'zeta' && !config.zetaContinuationEnabled;

    for (let index = 0; index < lineCount; index += 1) {
        const y = y0 + yStep * index;
        pointSets[index] = createLineSet(
            cartesianSegment(x0, y, x1, y, sampleCount),
            palette.horizontal,
            'grid-horizontal',
            LINE_WIDTH_NORMAL
        );
    }

    for (let index = 0; index < lineCount; index += 1) {
        const x = x0 + xStep * index;
        pointSets[lineCount + index] = createLineSet(
            cartesianSegment(x, yRange[0], x, yRange[1], sampleCount),
            zetaBlocked && x <= ZETA_REFLECTION_POINT_RE ? palette.zetaUndefinedSumRegion : palette.vertical,
            'grid-vertical',
            LINE_WIDTH_NORMAL
        );
    }

    return pointSets;
}

export function generatePolarGridPointSets(config) {
    const palette = currentGridPalette();
    const maxRadius = maxVisibleRadius(config);
    const angularLineCount = integerAtLeast(Math.max(4, config.gridDensity), 4);
    const gridDensity = integerAtLeast(config.gridDensity, 1);
    const pointSets = new Array(angularLineCount + gridDensity);

    for (let index = 0; index < angularLineCount; index += 1) {
        const angle = (index / angularLineCount) * TWO_PI;
        pointSets[index] = createLineSet(
            radialSegment(angle, 0, maxRadius, config.curvePoints),
            palette.horizontal,
            'polar-angular',
            LINE_WIDTH_NORMAL
        );
    }

    for (let index = 0; index < gridDensity; index += 1) {
        const radius = ((index + 1) / config.gridDensity) * maxRadius;
        pointSets[angularLineCount + index] = createLineSet(
            makeCirclePoints(0, 0, radius, config.curvePoints),
            palette.vertical,
            'polar-radial',
            LINE_WIDTH_NORMAL
        );
    }

    return pointSets;
}

export function generateLogPolarGridPointSets(config) {
    const palette = currentGridPalette();
    const maxRadius = maxVisibleRadius(config);
    const minLogRadius = Math.log(MIN_LOGPOLAR_RADIUS);
    const maxLogRadius = Math.log(maxRadius);
    const angularLineCount = integerAtLeast(Math.max(4, config.gridDensity), 4);
    const gridDensity = integerAtLeast(config.gridDensity, 1);
    const pointSets = new Array(angularLineCount + gridDensity + 1);
    const radialRatio = Math.exp((maxLogRadius - minLogRadius) / gridDensity);
    let radius = Math.exp(minLogRadius);

    for (let index = 0; index < angularLineCount; index += 1) {
        const angle = (index / angularLineCount) * TWO_PI;
        pointSets[index] = createLineSet(
            logarithmicRadialSegment(angle, minLogRadius, maxLogRadius, config.curvePoints),
            palette.horizontal,
            'logpolar-angular',
            LINE_WIDTH_NORMAL
        );
    }

    for (let index = 0; index <= gridDensity; index += 1) {
        pointSets[angularLineCount + index] = createLineSet(
            makeCirclePoints(0, 0, radius, config.curvePoints),
            palette.vertical,
            'logpolar-radial',
            LINE_WIDTH_NORMAL
        );
        radius *= radialRatio;
    }

    return pointSets;
}

export function generateLogCartesianGridPointSets(config) {
    const palette = currentGridPalette();
    const sampleCount = integerAtLeast(config.curvePoints / 2, 2);
    const gridDensity = integerAtLeast(config.gridDensity, 1);
    const xRange = config.xRange;
    const yRange = config.yRange;

    const minVal = MIN_LOGPOLAR_RADIUS;

    const xMax = Math.max(Math.abs(xRange[0]), Math.abs(xRange[1]));
    const yMax = Math.max(Math.abs(yRange[0]), Math.abs(yRange[1]));

    const xLimit = Math.max(xMax, minVal * 2);
    const yLimit = Math.max(yMax, minVal * 2);

    const logXMin = Math.log(minVal);
    const logXMax = Math.log(xLimit);
    const logYMin = Math.log(minVal);
    const logYMax = Math.log(yLimit);

    const xValues = [];
    const yValues = [];

    for (let index = 0; index <= gridDensity; index += 1) {
        const logX = logXMin + (logXMax - logXMin) * (index / gridDensity);
        const valX = Math.exp(logX);
        xValues.push(valX);
        xValues.push(-valX);

        const logY = logYMin + (logYMax - logYMin) * (index / gridDensity);
        const valY = Math.exp(logY);
        yValues.push(valY);
        yValues.push(-valY);
    }

    const pointSets = [];
    const zetaBlocked = config.currentFunction === 'zeta' && !config.zetaContinuationEnabled;

    // Horizontal lines (constant y)
    yValues.forEach(y => {
        pointSets.push(createLineSet(
            cartesianSegment(xRange[0], y, xRange[1], y, sampleCount),
            palette.horizontal,
            'grid-horizontal',
            LINE_WIDTH_NORMAL
        ));
    });

    // Vertical lines (constant x)
    xValues.forEach(x => {
        pointSets.push(createLineSet(
            cartesianSegment(x, yRange[0], x, yRange[1], sampleCount),
            zetaBlocked && x <= ZETA_REFLECTION_POINT_RE ? palette.zetaUndefinedSumRegion : palette.vertical,
            'grid-vertical',
            LINE_WIDTH_NORMAL
        ));
    });

    return pointSets;
}

export function generateLineShapePointSets(config) {
    const sampleCount = integerAtLeast(config.curvePoints, 2);
    const xRange = config.xRange;
    const yRange = config.yRange;

    return [
        createLineSet(
            cartesianSegment(xRange[0], config.b0, xRange[1], config.b0, sampleCount),
            COLOR_INPUT_SHAPE_Z,
            'line-horizontal',
            LINE_WIDTH_THICK
        ),
        createLineSet(
            cartesianSegment(config.a0, yRange[0], config.a0, yRange[1], sampleCount),
            COLOR_INPUT_LINE_IM_Z,
            'line-vertical',
            LINE_WIDTH_THICK
        )
    ];
}

const GEOMETRIC_POINT_FACTORIES = Object.freeze({
    circle: config => makeCirclePoints(config.a0, config.b0, config.circleR, config.curvePoints),
    ellipse: config => makeEllipsePoints(config.a0, config.b0, config.ellipseA, config.ellipseB, config.curvePoints)
});

export function generateGeometricShapePointSets(config) {
    const buildPoints = GEOMETRIC_POINT_FACTORIES[config.currentInputShape];

    return buildPoints === undefined
        ? []
        : [createLineSet(buildPoints(config), COLOR_INPUT_SHAPE_Z, 'shape-curve', LINE_WIDTH_THICK)];
}

const INPUT_SHAPE_GENERATORS = Object.freeze({
    grid_cartesian: generateCartesianGridPointSets,
    grid_polar: generatePolarGridPointSets,
    grid_logpolar: generateLogPolarGridPointSets,
    grid_logcartesian: generateLogCartesianGridPointSets,
    line: generateLineShapePointSets,
    circle: generateGeometricShapePointSets,
    ellipse: generateGeometricShapePointSets,
    empty_grid: emptyPointSets,
    image: emptyPointSets,
    video: emptyPointSets
});

export function generateInputShapePointSets(config) {
    const generator = INPUT_SHAPE_GENERATORS[config?.currentInputShape];
    return generator === undefined ? [] : generator(config);
}

export function generateCurrentInputShapePointSets(planeParams, options = {}) {
    return generateInputShapePointSets(buildInputShapeGeometryConfig(planeParams, options));
}

export function generateCurrentMappedInputShapePointSets(planeParams, options = {}) {
    return generateCurrentInputShapePointSets(planeParams, options);
}

export function getRadialDiscreteStepDomain(functionKey) {
    const domain = RADIAL_STEP_DOMAINS[functionKey] ?? RADIAL_STEP_DOMAIN_DEFAULT;
    return { min: domain.min, max: domain.max };
}

export function generateRadialDiscreteStepPointSets(functionKey, transformFunc, stepsCount, options = {}) {
    const steps = integerAtLeast(stepsCount, 0);

    if (steps < 2 || typeof transformFunc !== 'function') {
        return [];
    }

    const domain = RADIAL_STEP_DOMAINS[functionKey] ?? RADIAL_STEP_DOMAIN_DEFAULT;
    const circlePointCount = integerAtLeast(options.curvePoints ?? NUM_POINTS_CURVE / 2, 24);
    const denominator = steps - 1;
    const delta = domain.max - domain.min;
    const sets = [];

    for (let index = 0; index < steps; index += 1) {
        const x = domain.min + delta * (index / denominator);

        if (radialStepIsSingular(functionKey, x)) {
            continue;
        }

        const transformedPoint = transformFunc(x, 0);

        if (!finitePoint(transformedPoint)) {
            continue;
        }

        const radius = Math.hypot(transformedPoint.re, transformedPoint.im);

        if (radius > 0) {
            sets.push(createLineSet(
                makeCirclePoints(0, 0, radius, circlePointCount),
                RADIAL_DISCRETE_STEP_COLOR,
                'radial-discrete-step',
                LINE_WIDTH_THIN
            ));
        }
    }

    return sets;
}
