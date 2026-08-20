import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildRealPlotSurface,
    validateRealPlotExpression
} from '../js/rendering/real-plots-renderer.js';

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
        mapOptions: { functionKey: 'identity', chainingEnabled: false },
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
