import test from 'node:test';
import assert from 'node:assert/strict';

import {
    continuationNativeSheet,
    evaluateNativeSheets,
    findNativePreimages,
    nativeMapOptions
} from '../js/native/complex-engine.js';
import { isPointInsideContour } from '../js/analysis/cauchy.js';
import { completeNativeMapOptions, completeRuntimeState } from './helpers/native-map.js';

function evaluateOnSheet(functionKey, point, sheet, runtimeState) {
    const map = nativeMapOptions(runtimeState, {
        functionKey,
        chainingEnabled: runtimeState.chainingEnabled,
        chainCount: runtimeState.chainingEnabled ? runtimeState.chainCount : 1
    });
    const result = evaluateNativeSheets(map, [point], [sheet]);
    return result.valid[0] ? result.values[0] : { re: NaN, im: NaN };
}

test('continuation counts oriented crossings of ray and drawn branch cuts', () => {
    const path = [{ re: -1, im: -1 }, { re: -1, im: 1 }];
    assert.equal(Math.abs(continuationNativeSheet(path, 'ray', Math.PI, [])), 1);
    assert.equal(Math.abs(continuationNativeSheet(path, 'draw', Math.PI, [{ re: -2, im: 0 }, { re: 0, im: 0 }])), 1);
});

test('drawn-cut crossings are stable at polyline vertices', () => {
    const cut = [{ re: -1, im: -1 }, { re: 0, im: 0 }, { re: 1, im: -1 }];
    const crossing = continuationNativeSheet(
        [{ re: 0, im: -1 }, { re: 0, im: 1 }], 'draw', Math.PI, cut
    );
    assert.equal(Math.abs(crossing), 1);
});

test('continued logarithm changes by one sheet increment', () => {
    const baseState = { logBase: { re: Math.E, im: 0 }, branchCutType: 'ray', branchCutAngle: Math.PI, chainingEnabled: false };
    const principal = evaluateOnSheet('ln', { re: 1, im: 0 }, 0, completeRuntimeState(baseState));
    const next = evaluateOnSheet('ln', { re: 1, im: 0 }, 1, completeRuntimeState(baseState));
    assert.ok(Math.abs(next.im - principal.im - Math.PI * 2) < 1e-10);
});

test('continued logarithm uses the selected ray as its argument boundary', () => {
    const runtimeState = { logBase: { re: Math.E, im: 0 }, branchCutType: 'ray', branchCutAngle: 0, chainingEnabled: false };
    const value = evaluateOnSheet('ln', { re: 0, im: 1 }, 0, completeRuntimeState(runtimeState));
    assert.ok(Math.abs(value.im + Math.PI * 1.5) < 1e-10);
});

test('continued inverse sine alternates reflected sheets', () => {
    const runtimeState = { branchCutType: 'ray', branchCutAngle: Math.PI, chainingEnabled: false };
    const z = { re: 0.25, im: 0.4 };
    const principal = evaluateOnSheet('asin', z, 0, completeRuntimeState(runtimeState));
    const adjacent = evaluateOnSheet('asin', z, 1, completeRuntimeState(runtimeState));
    assert.ok(Math.abs(adjacent.re - (Math.PI - principal.re)) < 1e-10);
    assert.ok(Math.abs(adjacent.im + principal.im) < 1e-10);
});

test('continued algebraic maps preserve custom input expressions and recursive c', () => {
    const runtimeState = {
        algebraicChainingZExpr: 'z + 1',
        algebraicChainingTerms: [{
            coeff: { re: 1, im: 0 },
            factors: [{ func: 'power', power: 1 }, { func: 'c', power: 1 }]
        }],
        fractionalPowerN: 1,
        chainingEnabled: true,
        chainingMode: 'recursion',
        chainCount: 2,
        branchCutType: 'ray',
        branchCutAngle: Math.PI
    };
    const value = evaluateOnSheet('algebraic_chaining', { re: 2, im: 0 }, 0, completeRuntimeState(runtimeState));
    assert.ok(Math.abs(value.re - 14) < 1e-10);
    assert.ok(Math.abs(value.im) < 1e-10);
});

test('continued algebraic custom expressions use the active sheet', () => {
    const runtimeState = {
        algebraicChainingZExpr: 'sqrt(z) + ln(z)',
        algebraicChainingTerms: [{ coeff: { re: 1, im: 0 }, factors: [{ func: 'cos', power: 1 }] }],
        chainingEnabled: false,
        branchCutType: 'ray',
        branchCutAngle: Math.PI,
        logBase: { re: Math.E, im: 0 }
    };
    const principal = evaluateOnSheet('algebraic_chaining', { re: 1, im: 0 }, 0, completeRuntimeState(runtimeState));
    const next = evaluateOnSheet('algebraic_chaining', { re: 1, im: 0 }, 1, completeRuntimeState(runtimeState));
    assert.ok(Math.hypot(next.re - principal.re, next.im - principal.im) > 1);
});

test('preimage explorer finds and deduplicates both square roots', () => {
    const roots = findNativePreimages({
        target: { re: 1, im: 0 },
        map: completeNativeMapOptions({
            functionKey: 'polynomial', chainingEnabled: false, polynomialN: 2,
            polynomialCoeffs: [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }]
        }),
        xRange: [-2, 2],
        yRange: [-2, 2],
        density: 18,
        maxIterations: 28
    });
    assert.equal(roots.length, 2);
    assert.ok(roots.some(root => Math.hypot(root.re - 1, root.im) < 1e-5));
    assert.ok(roots.some(root => Math.hypot(root.re + 1, root.im) < 1e-5));
});

test('polygon contours support inside tests', () => {
    const params = { points: [{ re: 0, im: 0 }, { re: 2, im: 0 }, { re: 0, im: 2 }, { re: 0, im: 0 }] };
    assert.equal(isPointInsideContour({ re: 0.25, im: 0.25 }, 'contour', params), true);
    assert.equal(isPointInsideContour({ re: 2, im: 2 }, 'contour', params), false);
});
