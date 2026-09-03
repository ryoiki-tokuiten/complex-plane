import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildRealPlotSurface,
    renderRealPlotContour,
    validateRealPlotExpression
} from '../js/rendering/real-plots-renderer.js';
import { renderNativeMapContour } from '../js/native/complex-engine.js';
import { completeNativeMapOptions } from './helpers/native-map.js';

function allFinite(values) {
    return values.every(Number.isFinite);
}

test('native real surface produces finite geometry and omits singular cells', () => {
    const sampled = buildRealPlotSurface({
        mapOptions: {
            functionKey: 'ln',
            chainingEnabled: false
        },
        segments: 10,
        xRange: [-1, 1],
        yRange: [-1, 1],
        inputExpr: 'x',
        imagExpr: 'y',
        outputComponent: 'magnitude',
        heightScale: 1,
        colorMode: 'phase'
    });

    assert.equal(sampled.vertexCount, 121);
    assert.equal(sampled.finiteResultCount, 120);
    assert.ok(allFinite(sampled.positions));
    assert.ok(allFinite(sampled.normals));
    assert.ok(allFinite(sampled.colors));
    assert.equal(sampled.indices.length, (10 * 10 - 4) * 6);
});

test('real-plot expressions are compiled to the native VM before rendering', () => {
    assert.equal(validateRealPlotExpression('cos(x) + y'), null);
    assert.match(validateRealPlotExpression('cos('), /Expected|expression/i);
    assert.match(validateRealPlotExpression(''), /empty/i);
});

test('native real surface preserves component range and unit normals', () => {
    const sampled = buildRealPlotSurface({
        mapOptions: {
            functionKey: 'polynomial',
            chainingEnabled: false,
            polynomialN: 2,
            polynomialCoeffs: [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }]
        },
        segments: 12,
        xRange: [-1, 1],
        yRange: [-1, 1],
        inputExpr: 'x',
        imagExpr: 'y',
        outputComponent: 'real'
    });

    assert.ok(Math.abs(sampled.minValue + 1) < 1e-12);
    assert.ok(Math.abs(sampled.maxValue - 1) < 1e-12);
    for (let offset = 0; offset < sampled.normals.length; offset += 3) {
        const length = Math.hypot(
            sampled.normals[offset], sampled.normals[offset + 1], sampled.normals[offset + 2]
        );
        assert.ok(Math.abs(length - 1) < 1e-5);
    }
});

test('native real surface evaluates generic complex input expressions in one job', () => {
    const sampled = buildRealPlotSurface({
        mapOptions: completeNativeMapOptions({ functionKey: 'identity', chainingEnabled: false }),
        segments: 4,
        xRange: [-1, 1],
        yRange: [-1, 1],
        inputExpr: 'cos(x) + cos(y)',
        imagExpr: 'x^2-y^2',
        outputComponent: 'magnitude',
        valuesOnly: true
    });
    assert.equal(sampled.vertexCount, 25);
    assert.equal(sampled.finiteResultCount, 25);
    assert.ok(sampled.values.every(Number.isFinite));
});

test('native map contour renders mapped values and contour ink in one job', () => {
    const pixels = renderNativeMapContour({
        mapOptions: completeNativeMapOptions({ functionKey: 'identity', chainingEnabled: false }),
        xRange: [-1, 1],
        yRange: [-1, 1],
        width: 24,
        height: 20,
        component: 'real',
        contoursEnabled: true,
        contourInterval: 0.25,
        contourThickness: 1.5,
        paletteStops: [[0.1, 0.2, 0.9], [0.9, 0.2, 0.1]],
        style: { brightness: 1, contrast: 1, saturation: 1, lightnessCycles: 1 }
    });

    assert.equal(pixels.length, 24 * 20 * 4);
    assert.equal(pixels.every((value, index) => index % 4 !== 3 || value === 255), true);
    assert.notDeepEqual(Array.from(pixels.subarray(0, 3)), Array.from(pixels.subarray(pixels.length - 4, pixels.length - 1)));
});

test('real-plot contour rasterization stays inside one native full-resolution job', () => {
    const pixels = renderRealPlotContour({
        mapOptions: completeNativeMapOptions({ functionKey: 'identity', chainingEnabled: false }),
        width: 24,
        height: 20,
        xRange: [-1, 1],
        yRange: [-1, 1],
        inputExpr: 'x',
        imagExpr: 'y',
        outputComponent: 'real',
        palette: 'viridis',
        contoursEnabled: true,
        contourInterval: 0.25,
        contourThickness: 1.5
    });

    assert.equal(pixels.length, 24 * 20 * 4);
    assert.equal(pixels.every((value, index) => index % 4 !== 3 || value === 255), true);
    assert.notDeepEqual(
        Array.from(pixels.subarray(0, 3)),
        Array.from(pixels.subarray(pixels.length - 4, pixels.length - 1))
    );
});
