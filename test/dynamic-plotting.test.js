import test from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/store/state.js';
import {
    applyDynamicPlottingPreset,
    getDynamicPlotResult,
    initializeDynamicPlottingEngine,
    invalidateDynamicPlotting
} from '../js/analysis/dynamic-plotting.js';
import { buildDynamicAggregateGLSL, compileCustomExpressionToGLSL } from '../js/math/expression/glsl.js';
import { transformFunctions } from '../js/native/map-runtime.js';
import {
    dynamicExpressionHasBranches,
    baseExpressionHasBranches
} from '../js/analysis/riemann-surface.js';

function configure(overrides) {
    Object.assign(state.dynamicPlotting, {
        enabled: true,
        mode: 'aggregate',
        source: {
            kind: 'integers',
            count: 10,
            start: 1,
            step: 1,
            ordering: 'ascending'
        },
        pointExpression: 'd',
        term: { kind: 'expression', expression: '1/d^2' },
        reduction: { kind: 'sum', invalidPolicy: 'stop' },
        aggregateParameter: { re: 2, im: 0 },
        playback: {
            visibleCount: 10,
            playing: false,
            speed: 10,
            loop: false
        },
        ...overrides
    });
    invalidateDynamicPlotting();
}

test('dynamic mapping keeps source, input, term, and partial values synchronized', () => {
    configure({
        mode: 'map',
        source: { kind: 'integers', count: 3, start: 1, step: 1, ordering: 'ascending' },
        term: { kind: 'selected-function', expression: 'selected(z)' },
        reduction: { kind: 'sum', invalidPolicy: 'stop' },
        playback: { visibleCount: 2, playing: false, speed: 10, loop: false }
    });

    const previousN = state.polynomialN;
    const previousCoefficients = state.polynomialCoeffs;
    state.polynomialN = 2;
    state.polynomialCoeffs = [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }];
    const result = getDynamicPlotResult({ transform: transformFunctions.polynomial });
    state.polynomialN = previousN;
    state.polynomialCoeffs = previousCoefficients;
    assert.equal(result.visibleSamples.length, 2);
    assert.deepEqual(result.samples.map(sample => sample.termValue), [
        { re: 1, im: 0 },
        { re: 4, im: 0 },
        { re: 9, im: 0 }
    ]);
    assert.deepEqual(result.samples.map(sample => sample.partial?.value), [
        { re: 1, im: 0 },
        { re: 5, im: 0 },
        { re: 14, im: 0 }
    ]);
});

test('visible-term playback reports the visible prefix and empty identities', () => {
    configure({
        source: { kind: 'integers', count: 3, start: 1, step: 1, ordering: 'ascending' },
        term: { kind: 'expression', expression: 'd' },
        reduction: { kind: 'sum', invalidPolicy: 'stop' },
        playback: { visibleCount: 1, playing: false, speed: 10, loop: false }
    });

    let result = getDynamicPlotResult();
    assert.equal(result.validCount, 1);
    assert.deepEqual(result.reduction.finalValue, { re: 1, im: 0 });

    state.dynamicPlotting.playback.visibleCount = 2;
    result = getDynamicPlotResult();
    assert.equal(result.validCount, 2);
    assert.deepEqual(result.reduction.finalValue, { re: 3, im: 0 });

    state.dynamicPlotting.playback.visibleCount = 0;
    result = getDynamicPlotResult();
    assert.deepEqual(result.reduction.finalValue, { re: 0, im: 0 });

    state.dynamicPlotting.reduction.kind = 'product';
    invalidateDynamicPlotting();
    result = getDynamicPlotResult();
    assert.deepEqual(result.reduction.finalValue, { re: 1, im: 0 });
    assert.equal(result.reduction.product.logAbs, 0);
});

test('large aggregates retain exact evaluation beyond the former background threshold', () => {
    configure({
        source: { kind: 'integers', count: 100, start: 1, step: 1, ordering: 'ascending' },
        playback: { visibleCount: 100, playing: false, speed: 10, loop: false }
    });
    assert.equal(getDynamicPlotResult().visibleSamples.length, 100);
});

test('point formulas can use s and selected-function mode ignores inactive formula errors', () => {
    configure({
        mode: 'map',
        source: { kind: 'integers', count: 2, start: 1, step: 1, ordering: 'ascending' },
        pointExpression: 'd + s',
        term: { kind: 'selected-function', expression: '(' },
        reduction: { kind: 'none', invalidPolicy: 'stop' },
        aggregateParameter: { re: 2, im: 0 },
        playback: { visibleCount: 2, playing: false, speed: 10, loop: false }
    });

    const result = getDynamicPlotResult({ transform: transformFunctions.identity });
    assert.deepEqual(result.visibleSamples.map(sample => sample.inputPoint), [
        { re: 3, im: 0 },
        { re: 4, im: 0 }
    ]);
});


test('Basel and Euler presets evaluate finite approximations accurately', () => {
    applyDynamicPlottingPreset('basel');
    state.dynamicPlotting.enabled = true;
    state.dynamicPlotting.playback.visibleCount = 200;
    invalidateDynamicPlotting();
    const basel = getDynamicPlotResult();
    assert.ok(Math.abs(basel.reduction.finalValue.re - Math.PI ** 2 / 6) < 0.006);

    applyDynamicPlottingPreset('euler_product');
    state.dynamicPlotting.enabled = true;
    state.dynamicPlotting.playback.visibleCount = 80;
    invalidateDynamicPlotting();
    const euler = getDynamicPlotResult({
        aggregateParameter: { re: 2, im: 0 },
        transform: transformFunctions.identity
    }).reduction.finalValue;
    assert.ok(Math.abs(euler.re - Math.PI ** 2 / 6) < 0.01);
    assert.ok(Math.abs(euler.im) < 1e-10);
});

test('independent symbol sequences evaluate one synchronized general term per index', () => {
    configure({
        source: { kind: 'naturals', count: 3, start: 0, step: 1, ordering: 'ascending' },
        term: {
            kind: 'expression',
            expression: 'x^n / n!',
            bindings: [
                { symbol: 'x', kind: 'primes', min: 2 },
                { symbol: 'n', kind: 'expression', generatorExpression: 'j + 1' }
            ]
        },
        reduction: { kind: 'sum', invalidPolicy: 'stop' },
        playback: { visibleCount: 3, playing: false, speed: 10, loop: false }
    });

    const result = getDynamicPlotResult();
    assert.deepEqual(result.samples.map(sample => sample.symbolValues.x.re), [2, 3, 5]);
    assert.deepEqual(result.samples.map(sample => sample.symbolValues.n.re), [1, 2, 3]);
    assert.ok(Math.abs(result.samples[0].termValue.re - 2) < 1e-12);
    assert.ok(Math.abs(result.samples[1].termValue.re - 4.5) < 1e-12);
    assert.ok(Math.abs(result.samples[2].termValue.re - 125 / 6) < 1e-12);
});

test('aggregate reductions skip isolated singular terms without losing later valid terms', () => {
    configure({
        source: { kind: 'integers', count: 3, start: 1, step: 1, ordering: 'ascending' },
        term: { kind: 'expression', expression: '1 / (d - s)' },
        reduction: { kind: 'sum', invalidPolicy: 'skip' },
        aggregateParameter: { re: 2, im: 0 },
        playback: { visibleCount: 3, playing: false, speed: 10, loop: false }
    });

    const result = getDynamicPlotResult({
        aggregateParameter: { re: 2, im: 0 }
    });

    assert.deepEqual(result.samples.map(sample => sample.reductionStatus), ['included', 'skipped', 'included']);
    assert.deepEqual(result.reduction.finalValue, { re: 0, im: 0 });
});

test('exponential-series preset exposes x as a free parameter and converges to exp(x)', () => {
    applyDynamicPlottingPreset('exponential_series');
    state.dynamicPlotting.enabled = true;
    state.dynamicPlotting.playback.visibleCount = 24;
    invalidateDynamicPlotting();

    const result = getDynamicPlotResult({
        aggregateParameter: { re: 1, im: 0 }
    });
    assert.ok(Math.abs(result.reduction.finalValue.re - Math.E) < 1e-12);
    assert.ok(Math.abs(result.reduction.finalValue.im) < 1e-12);
});

test('active transform provider exposes aggregate functions to existing transform paths', async () => {
    configure({
        source: { kind: 'integers', count: 4, start: 1, step: 1, ordering: 'ascending' },
        term: { kind: 'expression', expression: 's^d' },
        reduction: { kind: 'sum', invalidPolicy: 'stop' },
        playback: { visibleCount: 4, playing: false, speed: 10, loop: false }
    });
    initializeDynamicPlottingEngine();

    const { getEffectiveBaseTransformFunction } = await import('../js/native/map-runtime.js');
    const transform = getEffectiveBaseTransformFunction('cos');
    const value = transform(0.5, 0);
    assert.ok(Math.abs(value.re - 0.9375) < 1e-12);
    assert.ok(Math.abs(value.im) < 1e-12);
});

test('dynamic expression branch analysis informs Riemann-surface sheets', () => {
    configure({
        term: { kind: 'expression', expression: 'd^(-s) + ln(s)' }
    });
    assert.equal(dynamicExpressionHasBranches(state), true);
    assert.equal(baseExpressionHasBranches(state), true);

    state.dynamicPlotting.term.expression = '1/d^2';
    invalidateDynamicPlotting();
    assert.equal(dynamicExpressionHasBranches(state), false);
});

test('GLSL compiler emits finite-domain and sheet-aware aggregate evaluators', () => {
    configure({
        source: { kind: 'primes', count: 6, min: 2 },
        term: { kind: 'expression', expression: '1/(1-d^(-s))' },
        reduction: { kind: 'product', invalidPolicy: 'stop' },
        playback: { visibleCount: 6, playing: false, speed: 10, loop: false }
    });

    const functionIds = {
        cos: 1, tan: 3, sec: 4, exp: 5, ln: 6,
        mobius: 8, polynomial: 9,
        zeta: 11, sinh: 12, tanh: 14, power: 15
    };
    const compiled = buildDynamicAggregateGLSL(state, name => functionIds[name] || 0);

    assert.equal(compiled.error, null);
    assert.equal(compiled.termCount, 6);
    assert.match(compiled.source, /evaluateDynamicAggregate\(/);
    assert.match(compiled.source, /evaluateDynamicAggregateOnSheet\(/);
    assert.match(compiled.source, /dynamicDomainValue/);
    assert.match(compiled.source, /complexMul\(accumulator, termValue\)/);
});

test('invalid custom GLSL z expressions fail compilation', () => {
    assert.throws(() => compileCustomExpressionToGLSL('bad +', () => 0), /Expected a value/);
});

test('GPU aggregate compilation uses the complete visible term count', () => {
    const functionIds = { cos: 1 };
    configure({
        source: { kind: 'integers', count: 600, start: 1, step: 1, ordering: 'ascending' },
        term: { kind: 'expression', expression: '1/d^2' },
        playback: { visibleCount: 600, playing: false, speed: 10, loop: false }
    });

    const complete = buildDynamicAggregateGLSL(state, name => functionIds[name] || 0);
    assert.equal(complete.error, null);
    assert.equal(complete.termCount, 600);
    assert.match(complete.source, /idx < 600/);

    state.dynamicPlotting.source.count = 10;
    state.dynamicPlotting.playback.visibleCount = 10;
    state.dynamicPlotting.term.expression = 'isPrime(d) ? d : 0';
    assert.throws(
        () => buildDynamicAggregateGLSL(state, name => functionIds[name] || 0),
        /exact CPU backend/
    );
});

test('dynamic aggregate branch continuation evaluates branch sheets natively', async () => {
    const { evaluateNativeSheets, compileNativeDynamicAggregate, nativeMapOptions } = await import('../js/native/complex-engine.js');
    const dynamicAggregate = compileNativeDynamicAggregate({
        pointExpression: 'd',
        term: { kind: 'expression', expression: 'ln(s)' },
        reductionKind: 'sum',
        invalidPolicy: 'stop',
        bindings: [],
        bindingSeries: {},
        sourceRecords: [{ ordinal: 1, domainValue: { re: 1, im: 0 } }]
    });

    const options = nativeMapOptions(state, { dynamicAggregate });
    const points = [{ re: 1, im: 0 }, { re: 1, im: 0 }, { re: 1, im: 0 }];
    const sheets = [0, 1, -1];
    const { values } = evaluateNativeSheets(options, points, sheets);

    assert.equal(values.length, 3);
    assert.ok(Math.abs(values[0].re) < 1e-10);
    assert.ok(Math.abs(values[0].im) < 1e-10);
    assert.ok(Math.abs(values[1].re) < 1e-10);
    assert.ok(Math.abs(values[1].im - 2 * Math.PI) < 1e-10);
    assert.ok(Math.abs(values[2].re) < 1e-10);
    assert.ok(Math.abs(values[2].im + 2 * Math.PI) < 1e-10);
});

test('native dynamic aggregates compile mathematical constants as constants', async () => {
    const { compileNativeDynamicAggregate } = await import('../js/native/complex-engine.js');
    const dynamicAggregate = compileNativeDynamicAggregate({
        pointExpression: 'd',
        term: { kind: 'expression', expression: 'i*d + pi + e' },
        reductionKind: 'sum',
        invalidPolicy: 'stop',
        bindings: [],
        bindingSeries: {},
        sourceRecords: [{ ordinal: 1, domainValue: { re: 1, im: 0 } }]
    });

    assert.deepEqual(dynamicAggregate.variableNames, ['d']);
});
