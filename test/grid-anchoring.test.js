import test from 'node:test';
import assert from 'node:assert/strict';

import {
    generateInputShapePointSets,
    generateCurrentInputShapePointSets
} from '../js/rendering/shape-generators.js';
import { state } from '../js/store/state.js';
import { drawAxes, drawGrid } from '../js/rendering/canvas-primitives.js';
import { GRID_SHAPE_DEFAULTS } from '../js/constants/grid-shapes.js';

const generate = (currentInputShape, config) => generateInputShapePointSets({
    currentInputShape,
    currentFunction: 'identity',
    zetaContinuationEnabled: false,
    gridParameters: GRID_SHAPE_DEFAULTS,
    ...config
});

test('Cartesian grid lines are evenly distributed across the visible range', () => {
    const config = {
        xRange: [-2.2, 2.2],
        yRange: [-1.8, 1.8],
        gridDensity: 10,
        curvePoints: 100,
        currentFunction: 'identity',
        zetaContinuationEnabled: false
    };

    const pointSets = generate('grid_cartesian', config);
    
    // Check that we got line sets
    assert.ok(pointSets.length > 0);

    // Get the unique x coordinates of the vertical grid lines
    const xCoords = [];
    const yCoords = [];

    for (const set of pointSets) {
        if (set.role === 'grid-vertical') {
            // All points in a vertical line have the same x coordinate
            xCoords.push(set.points[0].re);
        } else if (set.role === 'grid-horizontal') {
            yCoords.push(set.points[0].im);
        }
    }

    assert.ok(xCoords.length > 0);
    assert.ok(yCoords.length > 0);

    // With linearlySampledRange, gridDensity=10 produces 11 points (inclusive of both endpoints)
    // spanning evenly from xRange[0] to xRange[1]
    assert.equal(xCoords.length, 11);
    assert.equal(yCoords.length, 11);

    // Verify evenly spaced: check that the step between consecutive x coords is constant
    xCoords.sort((a, b) => a - b);
    const stepX = (config.xRange[1] - config.xRange[0]) / config.gridDensity;
    for (let i = 0; i < xCoords.length; i++) {
        const expected = config.xRange[0] + i * stepX;
        assert.ok(Math.abs(xCoords[i] - expected) < 1e-9,
            `x[${i}] = ${xCoords[i]}, expected ${expected}`);
    }
});

test('Cartesian grid line count scales with gridDensity', () => {
    const config1 = {
        xRange: [-2.2, 2.2],
        yRange: [-1.8, 1.8],
        gridDensity: 5,
        curvePoints: 100,
        currentFunction: 'identity',
        zetaContinuationEnabled: false
    };

    const config2 = {
        xRange: [-2.2, 2.2],
        yRange: [-1.8, 1.8],
        gridDensity: 20,
        curvePoints: 100,
        currentFunction: 'identity',
        zetaContinuationEnabled: false
    };

    const sets1 = generate('grid_cartesian', config1);
    const sets2 = generate('grid_cartesian', config2);

    const xCount1 = sets1.filter(s => s.role === 'grid-vertical').length;
    const xCount2 = sets2.filter(s => s.role === 'grid-vertical').length;

    // gridDensity=5 -> 6 lines, gridDensity=20 -> 21 lines
    assert.equal(xCount1, 6);
    assert.equal(xCount2, 21);
});

test('Dots grid density controls the two-dimensional point count', () => {
    const base = { xRange: [-2, 2], yRange: [-1, 1], curvePoints: 50 };
    assert.equal(generate('grid_dots', { ...base, gridDensity: 5 })[0].points.length, 36);
    assert.equal(generate('grid_dots', { ...base, gridDensity: 20 })[0].points.length, 441);
});

test('custom grid families produce finite, styled point sets', () => {
    const base = {
        xRange: [-3.5, 3.5],
        yRange: [-3, 3],
        gridDensity: 12,
        curvePoints: 160,
        currentFunction: 'identity',
        zetaContinuationEnabled: false
    };
    const shapes = [
        'grid_rectilinear', 'grid_nonorthogonal', 'grid_triangular',
        'grid_curvilinear', 'grid_spiral', 'grid_irregular'
    ];

    shapes.forEach(shape => {
        const pointSets = generate(shape, base);
        assert.ok(pointSets.length > 0, `${shape} should contain lines`);
        assert.ok(pointSets.every(set => set.color && set.points.length > 1));
        assert.ok(pointSets.every(set => set.points.every(point =>
            Number.isFinite(point.re) && Number.isFinite(point.im)
        )));
    });
});

test('custom grid controls alter their corresponding geometry', () => {
    const base = {
        xRange: [-2, 2],
        yRange: [-2, 2],
        gridDensity: 10,
        curvePoints: 120,
        currentFunction: 'identity',
        zetaContinuationEnabled: false
    };
    const defaultSpiral = generate('grid_spiral', base);
    const widerSpiral = generate('grid_spiral', {
        ...base,
        gridParameters: { spiral: { turns: 4, tightness: 0.8, arms: 2 } }
    });
    assert.notDeepEqual(widerSpiral[0].points, defaultSpiral[0].points);

    const defaultIrregular = generate('grid_irregular', base);
    const uniform = generate('grid_irregular', {
        ...base,
        gridParameters: { irregular: { variation: 0, clustering: 0 } }
    });
    const defaultSteps = defaultIrregular
        .filter(set => set.role === 'grid-horizontal')
        .map(set => set.points[0].im);
    const uniformSteps = uniform
        .filter(set => set.role === 'grid-horizontal')
        .map(set => set.points[0].im);
    assert.notDeepEqual(defaultSteps, uniformSteps);
});

test('parametric and drawn arbitrary shapes share the closed point-set contract', () => {
    const parametric = generate('arbitrary', {
        arbitraryShapeMode: 'parametric', arbitraryShapeExpression: 'exp(i*t)',
        arbitraryShapeTMin: 0, arbitraryShapeTMax: Math.PI * 2, arbitraryShapeClosed: true,
        curvePoints: 64, gridDensity: 5
    });
    assert.equal(parametric.length, 1);
    assert.ok(Math.hypot(parametric[0].points[0].re - parametric[0].points.at(-1).re,
        parametric[0].points[0].im - parametric[0].points.at(-1).im) < 1e-9);

    const drawn = generate('arbitrary', {
        arbitraryShapeMode: 'draw', arbitraryShapePoints: [{ re: 0, im: 0 }, { re: 1, im: 0 }, { re: 0, im: 1 }],
        arbitraryShapeClosed: true, curvePoints: 32, gridDensity: 5
    });
    assert.deepEqual(drawn[0].points.at(-1), drawn[0].points[0]);
});

test('drawn arbitrary shapes preserve appended strokes without connecting them', () => {
    const drawn = generate('arbitrary', {
        arbitraryShapeMode: 'draw',
        arbitraryShapePoints: [
            { re: 0, im: 0 }, { re: 1, im: 0 }, { re: 0, im: 1 }, null,
            { re: 2, im: 2 }, { re: 3, im: 2 }, { re: 2, im: 3 }
        ],
        arbitraryShapeClosed: true, curvePoints: 32, gridDensity: 5
    });
    assert.equal(drawn.length, 2);
    assert.deepEqual(drawn[0].points.at(-1), drawn[0].points[0]);
    assert.deepEqual(drawn[1].points.at(-1), drawn[1].points[0]);
});

test('Polar grid radial circles are evenly distributed up to max radius', () => {
    const config = {
        xRange: [-2.0, 2.0],
        yRange: [-2.0, 2.0],
        gridDensity: 10,
        curvePoints: 100
    };

    const pointSets = generate('grid_polar', config);
    const radialCircles = pointSets.filter(s => s.role === 'polar-radial');

    assert.ok(radialCircles.length > 0);
    assert.equal(radialCircles.length, 10);

    // Compute the radius of each circle
    const radii = radialCircles.map(s => {
        const pt = s.points[0];
        return Math.sqrt(pt.re * pt.re + pt.im * pt.im);
    }).sort((a, b) => a - b);

    // Max visible radius is 2.0.
    // Radii should be evenly spaced: (1/10)*2, (2/10)*2, ..., (10/10)*2
    const maxRadius = 2.0;
    for (let i = 0; i < radii.length; i++) {
        const expected = ((i + 1) / config.gridDensity) * maxRadius;
        assert.ok(Math.abs(radii[i] - expected) < 1e-9,
            `radius[${i}] = ${radii[i]}, expected ${expected}`);
    }
});

test('Grid-style input shapes use active grid theme colors', () => {
    const previousGridColor1 = state.gridColor1;
    const previousGridColor2 = state.gridColor2;
    state.gridColor1 = '#112233';
    state.gridColor2 = '#445566';

    try {
        const baseConfig = {
            xRange: [-2.0, 2.0],
            yRange: [-2.0, 2.0],
            gridDensity: 4,
            curvePoints: 32
        };

        const polarSets = generate('grid_polar', baseConfig);
        assert.equal(polarSets.find(set => set.role === 'polar-angular').color, state.gridColor1);
        assert.equal(polarSets.find(set => set.role === 'polar-radial').color, state.gridColor2);

        const logPolarSets = generate('grid_logpolar', baseConfig);
        assert.equal(logPolarSets.find(set => set.role === 'logpolar-angular').color, state.gridColor1);
        assert.equal(logPolarSets.find(set => set.role === 'logpolar-radial').color, state.gridColor2);

        const logCartesianSets = generate('grid_logcartesian', baseConfig);
        assert.equal(logCartesianSets.find(set => set.role === 'grid-horizontal').color, state.gridColor1);
        assert.equal(logCartesianSets.find(set => set.role === 'grid-vertical').color, state.gridColor2);
    } finally {
        state.gridColor1 = previousGridColor1;
        state.gridColor2 = previousGridColor2;
    }
});

test('Log-Cartesian grid lines are exponentially distributed and scale with density', () => {
    const config = {
        xRange: [-2.0, 2.0],
        yRange: [-2.0, 2.0],
        gridDensity: 10,
        curvePoints: 100
    };

    const pointSets = generate('grid_logcartesian', config);
    assert.ok(pointSets.length > 0);

    const xCoords = [];
    const yCoords = [];

    for (const set of pointSets) {
        if (set.role === 'grid-vertical') {
            xCoords.push(set.points[0].re);
        } else if (set.role === 'grid-horizontal') {
            yCoords.push(set.points[0].im);
        }
    }

    // gridDensity = 10 -> 11 steps -> 22 positive & negative values per axis
    assert.equal(xCoords.length, 22);
    assert.equal(yCoords.length, 22);

    // Check that positive coordinates are strictly increasing
    const posX = xCoords.filter(x => x > 0).sort((a, b) => a - b);
    assert.equal(posX.length, 11);

    // Verify exponential spacing by checking log-linear spacing
    const logPosX = posX.map(x => Math.log(x));
    const step = logPosX[1] - logPosX[0];
    for (let i = 1; i < logPosX.length - 1; i++) {
        const currentStep = logPosX[i + 1] - logPosX[i];
        assert.ok(Math.abs(currentStep - step) < 1e-9, `Step mismatch at index ${i}`);
    }
});

test('Zeta continuation Cartesian grid is not split at the continuation boundary', () => {
    const gridDensity = 4;
    const planeParams = {
        currentVisXRange: [-2, 2],
        currentVisYRange: [-1, 1]
    };

    const pointSets = generateCurrentInputShapePointSets(planeParams, {
        currentInputShape: 'grid_cartesian',
        currentFunction: 'zeta',
        zetaContinuationEnabled: true,
        gridDensity,
        curvePoints: 40
    });

    const horizontalSets = pointSets.filter(set => set.role === 'grid-horizontal');
    const verticalSets = pointSets.filter(set => set.role === 'grid-vertical');

    assert.equal(horizontalSets.length, gridDensity + 1);
    assert.equal(verticalSets.length, gridDensity + 1);
    assert.equal(pointSets.length, (gridDensity + 1) * 2);

    for (const set of horizontalSets) {
        assert.equal(set.points[0].re, planeParams.currentVisXRange[0]);
        assert.equal(set.points[set.points.length - 1].re, planeParams.currentVisXRange[1]);
    }
});

test('canvas grid and tick loops stay bounded at deep zoom', () => {
    const calls = { moveTo: 0 };
    const ctx = {
        save() {},
        restore() {},
        beginPath() {},
        moveTo() { calls.moveTo += 1; },
        lineTo() {},
        stroke() {},
        fillText() {},
        arc() {},
        fill() {}
    };
    const zoom = 1e12;
    const span = 7 / zoom;
    const params = {
        width: 800,
        height: 600,
        scale: { x: 800 / span, y: 600 / span },
        origin: { x: 400, y: 300 },
        currentVisXRange: [-span / 2, span / 2],
        currentVisYRange: [-span / 2, span / 2]
    };

    drawGrid(ctx, params, { targetCount: 10 });
    drawAxes(ctx, params, { labels: false, ticks: true, tickLabels: false });

    assert.ok(calls.moveTo < 500, `deep-zoom grid emitted ${calls.moveTo} segments`);
});
