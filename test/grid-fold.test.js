import test from 'node:test';
import assert from 'node:assert/strict';

import { buildNativeGridFold } from '../js/native/complex-engine.js';
import { isFoldableInputShape } from '../js/rendering/shape-generators.js';
import { completeNativeMapOptions } from './helpers/native-map.js';

test('grid fold view includes grids, dots, and arbitrary shapes', () => {
    for (const shape of ['grid_cartesian', 'grid_logcartesian', 'grid_polar', 'grid_logpolar', 'grid_dots']) {
        assert.equal(isFoldableInputShape(shape), true);
    }
    for (const shape of ['line', 'circle', 'arbitrary', 'image', 'video', 'empty_grid']) {
        assert.equal(isFoldableInputShape(shape), shape === 'arbitrary');
    }
    assert.equal(isFoldableInputShape('arbitrary'), true);
});

test('grid folds separate equal mapped points by source real coordinate', () => {
    const data = buildNativeGridFold({
        mapOptions: completeNativeMapOptions({
            functionKey: 'polynomial', chainingEnabled: false,
            polynomialN: 2,
            polynomialCoeffs: [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }]
        }),
        sourceXRange: [-1, 1], outputXRange: [-2, 2], outputYRange: [-2, 2], heightScale: 1
    }, [
        {
            color: '#123456',
            points: [{ re: -1, im: 0 }, { re: 1, im: 0 }]
        }
    ]);

    assert.equal(data.lines.length, 1);
    assert.equal(data.lines[0].color, '#123456');
    const positions = data.lines[0].positions;
    assert.equal(positions[0], positions.at(-3));
    assert.equal(positions[1], -5);
    assert.equal(positions.at(-2), 5);
    assert.equal(positions[2], 0);
    assert.equal(positions.at(-1), 0);
    assert.ok(positions.every(Number.isFinite));
});

test('dot folds batch points into one typed geometry per color', () => {
    const data = buildNativeGridFold({
        mapOptions: completeNativeMapOptions({
            functionKey: 'polynomial', chainingEnabled: false,
            polynomialN: 2,
            polynomialCoeffs: [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }]
        }),
        sourceXRange: [-1, 1], outputXRange: [-1, 2], outputYRange: [-1, 1], heightScale: 1
    }, [{
        role: 'grid-dots',
        color: '#123456',
        points: [{ re: -1, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }]
    }]);
    assert.equal(data.points.length, 1);
    assert.equal(data.points[0].positions.length, 9);
    assert.equal(data.lines.length, 0);
});

test('grid folds split invalid mapped regions without emitting non-finite geometry', () => {
    const data = buildNativeGridFold({
        mapOptions: completeNativeMapOptions({
            functionKey: 'mobius',
            mobiusA: { re: 0, im: 0 },
            mobiusB: { re: 1, im: 0 },
            mobiusC: { re: 1, im: 0 },
            mobiusD: { re: 0, im: 0 },
            chainingEnabled: false
        }),
        sourceXRange: [-2, 2], outputXRange: [-2, 2], outputYRange: [-1, 1], heightScale: 1
    }, [
        {
            color: '#123456',
            points: [-2, -1, 0, 1, 2].map(re => ({ re, im: 0 }))
        }
    ]);

    assert.equal(data.lines.length, 2);
    assert.ok(data.lines.every(line => line.positions.every(Number.isFinite)));
});
