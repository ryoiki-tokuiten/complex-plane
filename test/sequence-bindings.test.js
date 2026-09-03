import test from 'node:test';
import assert from 'node:assert/strict';

import {
    generateSequenceBindingSeries,
    synchronizeSequenceBindings
} from '../js/analysis/sequence-bindings.js';

test('term symbols receive independent synchronized sequence bindings', () => {
    const bindings = synchronizeSequenceBindings('x^n / n!', [
        { symbol: 'x', kind: 'primes', min: 2 },
        { symbol: 'n', kind: 'expression', generatorExpression: '2j + 1' }
    ]);
    const generated = generateSequenceBindingSeries(bindings, 4);

    assert.deepEqual(generated.environments.map(environment => environment.x.re), [2, 3, 5, 7]);
    assert.deepEqual(generated.environments.map(environment => environment.n.re), [1, 3, 5, 7]);
});

test('free real and complex symbols use the plotted aggregate parameter', () => {
    const generated = generateSequenceBindingSeries([
        { symbol: 'x', kind: 'parameter' },
        { symbol: 't', kind: 'parameter_real' }
    ], 2, {
        aggregateParameter: { re: 1.5, im: -0.75 }
    });

    assert.deepEqual(generated.environments[0].x, { re: 1.5, im: -0.75 });
    assert.deepEqual(generated.environments[1].t, { re: 1.5, im: 0 });
});

test('symbol bindings support geometric and harmonic progressions', () => {
    const generated = generateSequenceBindingSeries([
        { symbol: 'g', kind: 'geometric', start: 3, ratio: 2 },
        { symbol: 'h', kind: 'harmonic', start: 2, step: 2 }
    ], 4);

    assert.deepEqual(generated.series.g.map(value => value.re), [3, 6, 12, 24]);
    assert.deepEqual(generated.series.h.map(value => value.re), [1 / 2, 1 / 4, 1 / 6, 1 / 8]);
});

test('expression sequence bindings preserve their native filter program', () => {
    const generated = generateSequenceBindingSeries([{
        symbol: 'q',
        kind: 'expression',
        generatorExpression: 'j + 1',
        filterExpression: 'mod(d, 2) == 0'
    }], 4);

    assert.deepEqual(generated.series.q.map(value => value.re), [2, 4, 6, 8]);
    assert.deepEqual(generated.environments.map(environment => environment.q.re), [2, 4, 6, 8]);
});

test('geometric sequence bindings match the exact finite partial-sum formula', () => {
    const generated = generateSequenceBindingSeries([
        { symbol: 'z', kind: 'geometric', start: 3, ratio: -0.5 }
    ], 12);

    const series = generated.series.z;
    const values = series.map(value => value.re);
    const partialSum = values.reduce((sum, value) => sum + value, 0);
    const expectedSum = 3 * (1 - Math.pow(-0.5, 12)) / (1 - -0.5);

    assert.deepEqual(values.slice(0, 5), [3, -1.5, 0.75, -0.375, 0.1875]);
    assert.ok(Math.abs(partialSum - expectedSum) < 1e-14, `${partialSum} ~= ${expectedSum}`);
    assert.deepEqual(generated.environments[11].z, series[11]);
});
