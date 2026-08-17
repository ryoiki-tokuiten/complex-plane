import test from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/store/state.js';
import {
    buildMappedTransformProfileKey,
    buildTaylorSeriesCoefficientCacheKey,
    getChainedTransformFunction
} from '../js/native/map-runtime.js';

function snapshotState(keys) {
    return Object.fromEntries(keys.map(key => [key, state[key]]));
}

function factor(func, chainedFunc = 'none') {
    return {
        func,
        chainedFunc,
        power: 1,
        reciprocal: false,
        log: false,
        exp: false
    };
}

test('algebraic profile keys observe nested polynomial and Mobius dependencies', () => {
    const keys = ['algebraicChainingEnabled', 'algebraicChainingTerms', 'polynomialN', 'polynomialCoeffs', 'mobiusA'];
    const before = snapshotState(keys);

    try {
        state.polynomialN = 1;
        state.algebraicChainingEnabled = true;
        state.polynomialCoeffs = [{ re: 1, im: 0 }, { re: 2, im: 0 }];
        state.mobiusA = { re: 1, im: 0 };
        state.algebraicChainingTerms = [{
            coeff: { re: 1, im: 0 },
            factors: [factor('polynomial'), factor('sin', 'mobius')]
        }];

        const initial = buildMappedTransformProfileKey('algebraic_chaining');
        state.polynomialCoeffs[0].re = 3;
        const polynomialEdit = buildMappedTransformProfileKey('algebraic_chaining');
        state.mobiusA.im = 0.5;
        const mobiusEdit = buildMappedTransformProfileKey('algebraic_chaining');
        state.algebraicChainingEnabled = false;
        const disabled = buildMappedTransformProfileKey('algebraic_chaining');

        assert.notEqual(polynomialEdit, initial);
        assert.notEqual(mobiusEdit, polynomialEdit);
        assert.notEqual(disabled, mobiusEdit);
        assert.match(buildMappedTransformProfileKey('polynomial'), /\|n:1\|p0:/);
    } finally {
        Object.assign(state, before);
    }
});

test('Taylor coefficient keys observe the contour radius used for computation', () => {
    const keys = [
        'currentFunction', 'taylorSeriesEnabled', 'taylorSeriesCenter',
        'taylorSeriesOrder', 'taylorSeriesConvergenceRadius',
        'riemannSphereViewEnabled', 'splitViewEnabled', 'chainingEnabled'
    ];
    const before = snapshotState(keys);

    try {
        Object.assign(state, {
            currentFunction: 'sin',
            taylorSeriesEnabled: true,
            taylorSeriesCenter: { re: 0, im: 0 },
            taylorSeriesOrder: 4,
            riemannSphereViewEnabled: false,
            splitViewEnabled: false,
            chainingEnabled: false
        });
        state.taylorSeriesConvergenceRadius = 0.5;
        const first = buildTaylorSeriesCoefficientCacheKey('sin', { re: 0, im: 0 }, 4);
        const firstTransform = getChainedTransformFunction('sin');
        state.taylorSeriesConvergenceRadius = 1;
        const second = buildTaylorSeriesCoefficientCacheKey('sin', { re: 0, im: 0 }, 4);
        const secondTransform = getChainedTransformFunction('sin');

        assert.notEqual(second, first);
        assert.notEqual(secondTransform, firstTransform);
        assert.match(second, /\|radius:/);
    } finally {
        Object.assign(state, before);
    }
});
