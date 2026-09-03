import test from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/store/state.js';
import { evaluateNativePoints, nativeMapOptions } from '../js/native/complex-engine.js';

function snapshotState() {
    return {
        currentFunction: state.currentFunction,
        chainingEnabled: state.chainingEnabled,
        chainingMode: state.chainingMode,
        chainSeed: state.chainSeed,
        chainCount: state.chainCount
    };
}

function evaluate(point, overrides = {}) {
    const result = evaluateNativePoints(nativeMapOptions(state, overrides), [point]);
    assert.equal(result.valid[0], 1);
    return result.values[0];
}

function assertComplexClose(actual, expected) {
    assert.ok(Math.abs(actual.re - expected.re) < 1e-12, `${actual.re} ~= ${expected.re}`);
    assert.ok(Math.abs(actual.im - expected.im) < 1e-12, `${actual.im} ~= ${expected.im}`);
}

test('seed-mode output chaining starts from the user-provided complex seed', () => {
    const before = snapshotState();
    const seed = { re: 0.25, im: -0.4 };
    const input = { re: 1.2, im: 0.7 };

    try {
        Object.assign(state, {
            currentFunction: 'cos',
            chainingEnabled: true,
            chainingMode: 'zero_seed',
            chainSeed: seed,
            chainCount: 1
        });

        const seeded = evaluate(input);
        const oneStepFromSeed = evaluate(seed, {
            chainingEnabled: false,
            chainMode: 'recursion',
            chainCount: 1
        });
        assertComplexClose(seeded, oneStepFromSeed);

        state.chainCount = 2;
        const twiceSeeded = evaluate(input);
        const twiceDirect = evaluate(oneStepFromSeed, {
            chainingEnabled: false,
            chainMode: 'recursion',
            chainCount: 1
        });
        assertComplexClose(twiceSeeded, twiceDirect);
    } finally {
        Object.assign(state, before);
    }
});
