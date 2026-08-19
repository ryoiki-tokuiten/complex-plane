import test from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/store/state.js';
import { resolveActiveMap } from '../js/math/active-map.js';

test('resolveActiveMap returns valid native evaluator and derivative', () => {
    const map = resolveActiveMap(0);
    const value = map.evaluate(1, 0);
    assert.ok(Number.isFinite(value.re));
    assert.ok(Number.isFinite(value.im));
});

test('invalid inputs evaluate to NaN in resolveActiveMap', () => {
    const map = resolveActiveMap(0);
    const value = map.evaluate(NaN, 0);
    assert.ok(Number.isNaN(value.re));
    assert.ok(Number.isNaN(value.im));
});

test('active derivative map differentiates the exact output-chain stage', () => {
    const previous = {
        currentFunction: state.currentFunction,
        chainingEnabled: state.chainingEnabled,
        chainingMode: state.chainingMode,
        chainCount: state.chainCount,
        mapPresentation: state.mapPresentation
    };

    try {
        Object.assign(state, {
            currentFunction: 'exp',
            chainingEnabled: true,
            chainingMode: 'recursion',
            chainCount: 2,
            mapPresentation: 'derivative'
        });

        const map = resolveActiveMap(1);
        const value = map.evaluate(0, 0);
        assert.ok(Math.abs(value.re - Math.E) < 1e-5);
        assert.ok(Math.abs(value.im) < 1e-8);
    } finally {
        Object.assign(state, previous);
    }
});

test('the derivative of the active derivative map is the second derivative', () => {
    const previous = {
        currentFunction: state.currentFunction,
        chainingEnabled: state.chainingEnabled,
        chainingMode: state.chainingMode,
        chainCount: state.chainCount,
        mapPresentation: state.mapPresentation
    };

    try {
        Object.assign(state, {
            currentFunction: 'cos',
            chainingEnabled: false,
            mapPresentation: 'derivative'
        });

        const map = resolveActiveMap();
        const value = map.evaluate(0, 0);
        const localDerivative = map.derivative(0, 0);

        assert.ok(Math.abs(value.re) < 1e-8);
        assert.ok(Math.abs(value.im) < 1e-8);
        assert.ok(Math.abs(localDerivative.re + 1) < 1e-5);
        assert.ok(Math.abs(localDerivative.im) < 1e-5);
    } finally {
        Object.assign(state, previous);
    }
});
