import test from 'node:test';
import assert from 'node:assert/strict';

import { traceStreamlines } from '../js/analysis/streamline.js';
import { buildNativeVectorField, nativeMapOptions } from '../js/native/complex-engine.js';
import { state } from '../js/store/state.js';

const planeParams = Object.freeze({
    currentVisXRange: Object.freeze([-2, 2]),
    currentVisYRange: Object.freeze([-2, 2])
});

const streamlineState = Object.freeze({
    vectorFieldFunction: 'f(z)',
    streamlineStepSize: 0.02,
    streamlineMaxLength: 200
});

function snapshotState(keys) {
    return Object.fromEntries(keys.map(key => [key, state[key]]));
}

function restoreState(snapshot) {
    Object.assign(state, snapshot);
}

function factor(func, overrides = {}) {
    return { func, chainedFunc: 'none', power: 1, reciprocal: false, log: false, exp: false, ...overrides };
}

test('native streamline tracing stops immediately on invalid vectors', () => {
    const paths = traceStreamlines([{ x: 0, y: 0 }], {
        functionKey: 'poincare', chainCount: 1
    }, planeParams, streamlineState);
    assert.deepEqual(paths, [[]]);
});

test('native vector-field job omits invalid map samples', () => {
    const vectors = buildNativeVectorField({
        map: { functionKey: 'poincare', chainCount: 1 },
        xRange: [-1, 1], yRange: [-1, 1], density: 8, inverse: false
    });
    assert.ok(vectors.length > 0);
    assert.ok(vectors.every(vector => vector.y > 1e-9 && Number.isFinite(vector.re) && Number.isFinite(vector.im)));
});

test('native normalized RK2 streamline preserves circular flow geometry', () => {
    const stepSize = 0.001;
    const map = {
        functionKey: 'algebraic_chaining', chainCount: 1,
        algebraicChainingZExpr: 'z',
        polynomialN: 1,
        polynomialCoeffs: [{ re: 0, im: 0 }, { re: 1, im: 0 }],
        algebraicChainingTerms: [{ coeff: { re: 0, im: 1 }, factors: [factor('polynomial')] }]
    };
    const [path] = traceStreamlines(
        [{ x: 1, y: 0 }], map,
        planeParams,
        { vectorFieldFunction: 'f(z)', streamlineStepSize: stepSize, streamlineMaxLength: 1000 }
    );
    assert.equal(path.length, 1000);
    const maxDrift = Math.max(...path.map(point => Math.abs(point.x * point.x + point.y * point.y - 1)));
    const expectedAngle = (path.length - 1) * stepSize * 4 * 0.1;
    assert.ok(maxDrift < 1e-9, `radius drift exceeded RK2 tolerance: ${maxDrift}`);
    assert.ok(Math.abs(Math.atan2(path.at(-1).y, path.at(-1).x) - expectedAngle) < 1e-6);
});

test('native algebraic streamlines stay finite and honor max-step budgets', () => {
    const keys = ['currentFunction', 'algebraicChainingEnabled', 'algebraicChainingZExpr',
        'algebraicChainingTerms', 'polynomialN', 'polynomialCoeffs', 'chainingEnabled',
        'chainingMode', 'chainCount'];
    const before = snapshotState(keys);
    try {
        Object.assign(state, {
            currentFunction: 'algebraic_chaining', algebraicChainingEnabled: true,
            algebraicChainingZExpr: 'z', polynomialN: 1,
            polynomialCoeffs: [{ re: 0, im: 0 }, { re: 1, im: 0 }],
            algebraicChainingTerms: [
                { coeff: { re: 2 / 3, im: 0 }, factors: [factor('polynomial')] },
                { coeff: { re: 1 / 3, im: 0 }, factors: [factor('polynomial', { power: 2, reciprocal: true })] }
            ],
            chainingEnabled: true, chainingMode: 'recursion', chainCount: 8
        });
        const [path] = traceStreamlines(
            [{ x: 1.2, y: 0.35 }], nativeMapOptions(state), planeParams,
            { vectorFieldFunction: 'f(z)', streamlineStepSize: 0.006, streamlineMaxLength: 400 },
            { maxSteps: 80 }
        );
        assert.ok(path.length > 20 && path.length <= 80);
        assert.ok(path.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.magnitude)));
    } finally {
        restoreState(before);
    }
});
