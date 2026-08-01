import test from 'node:test';
import assert from 'node:assert/strict';

import {
    sampleRealPlotSurface,
    validateRealPlotExpression
} from '../js/rendering/real-plots-renderer.js';
import { transformFunctions } from '../js/math-utils.js';

function allFinite(values) {
    return values.every(Number.isFinite);
}

test('real 3D plot sampling produces finite heightfield buffers for singular functions', () => {
    const sampled = sampleRealPlotSurface(
        (re, im) => {
            const denom = re * re + im * im;
            if (denom === 0) return { re: NaN, im: NaN };
            return { re: re / denom, im: -im / denom };
        },
        {
            segments: 10,
            xRange: [-1, 1],
            yRange: [-1, 1],
            inputExpr: 'x',
            imagExpr: 'y',
            outputComponent: 'magnitude',
            heightScale: 1,
            colorMode: 'phase'
        }
    );

    assert.equal(sampled.vertexCount, 121);
    assert.equal(sampled.finiteResultCount, 120);
    assert.ok(allFinite(sampled.positions));
    assert.ok(allFinite(sampled.normals));
    assert.ok(allFinite(sampled.colors));
    assert.ok(Math.max(...sampled.positions.filter((_value, index) => index % 3 === 1)) <= 2);
    assert.equal(sampled.indices.length, (10 * 10 - 4) * 6);
});

test('real-plot expressions are rejected before render state can use them', () => {
    assert.equal(validateRealPlotExpression('sin(x) + y'), null);
    assert.match(validateRealPlotExpression('sin('), /Expected|expression/i);
    assert.match(validateRealPlotExpression(''), /empty/i);
});

test('real 3D plot sampling preserves the selected real component range', () => {
    const sampled = sampleRealPlotSurface(
        (re, im) => ({ re: re * re - im * im, im: 2 * re * im }),
        {
            segments: 12,
            xRange: [-1, 1],
            yRange: [-1, 1],
            inputExpr: 'x',
            imagExpr: 'y',
            outputComponent: 'real'
        }
    );

    assert.ok(Math.abs(sampled.minValue + 1) < 1e-12);
    assert.ok(Math.abs(sampled.maxValue - 1) < 1e-12);

    for (let offset = 0; offset < sampled.normals.length; offset += 3) {
        const length = Math.hypot(
            sampled.normals[offset],
            sampled.normals[offset + 1],
            sampled.normals[offset + 2]
        );
        assert.ok(Math.abs(length - 1) < 1e-5);
    }
});

test('real 3D plot kernels are explicit and preserve singular samples', () => {
    assert.equal(transformFunctions.sin.realPlotsKernel, 'sin');
    assert.equal(transformFunctions.reciprocal.realPlotsKernel, 'reciprocal');

    const sampled = sampleRealPlotSurface(
        transformFunctions.reciprocal,
        {
            segments: 2,
            xRange: [-1, 1],
            yRange: [-1, 1],
            inputExpr: 'x',
            imagExpr: 'y',
            outputComponent: 'magnitude',
            valuesOnly: true
        }
    );

    assert.equal(sampled.vertexCount, 9);
    assert.equal(sampled.finiteResultCount, 8);
    assert.equal(Number.isNaN(sampled.values[4]), true);

    const nearPole = sampleRealPlotSurface(
        transformFunctions.reciprocal,
        {
            segments: 2,
            xRange: [-1e-16, 1e-16],
            yRange: [0, 0],
            inputExpr: 'x',
            imagExpr: '0',
            outputComponent: 'real',
            valuesOnly: true
        }
    );

    assert.equal(nearPole.values[0], -10000);
    assert.equal(Number.isNaN(nearPole.values[1]), true);
    assert.equal(nearPole.values[2], 10000);

    const tinyComplex = sampleRealPlotSurface(
        transformFunctions.reciprocal,
        {
            segments: 1,
            xRange: [Number.MIN_VALUE, Number.MIN_VALUE],
            yRange: [Number.MIN_VALUE, Number.MIN_VALUE],
            inputExpr: 'x',
            imagExpr: 'y',
            outputComponent: 'real',
            valuesOnly: true
        }
    );
    const expectedDirection = 10000 / Math.sqrt(2);
    assert.ok(Math.abs(tinyComplex.values[0] - expectedDirection) < 1e-9);

    const tinyImaginary = sampleRealPlotSurface(
        transformFunctions.reciprocal,
        {
            segments: 1,
            xRange: [Number.MIN_VALUE, Number.MIN_VALUE],
            yRange: [Number.MIN_VALUE, Number.MIN_VALUE],
            inputExpr: 'x',
            imagExpr: 'y',
            outputComponent: 'imag',
            valuesOnly: true
        }
    );
    assert.ok(Math.abs(tinyImaginary.values[0] + expectedDirection) < 1e-9);
});

test('real 3D plot sampling can use declared kernels without calling the transform', () => {
    const transform = () => {
        throw new Error('declared kernels should not call the object-producing transform');
    };
    Object.defineProperty(transform, 'realPlotsKernel', { value: 'sin' });

    const sampled = sampleRealPlotSurface(
        transform,
        {
            segments: 2,
            xRange: [0, 0],
            yRange: [0, 0],
            inputExpr: 'x',
            imagExpr: '0',
            outputComponent: 'real',
            valuesOnly: true
        }
    );

    assert.equal(sampled.finiteResultCount, 9);
    assert.ok(sampled.values.every(value => Math.abs(value) < 1e-12));
});
