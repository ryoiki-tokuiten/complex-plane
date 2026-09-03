import test from 'node:test';
import assert from 'node:assert/strict';

import {
    continuationNativeSheet,
    evaluateNativeSheets,
    findNativePreimages,
    nativeMapOptions
} from '../js/native/complex-engine.js';
import { findZerosAndPoles } from '../js/analysis/feature-detection.js';
import { getCauchyDisplay, isPointInsideContour, performCauchyAnalysis } from '../js/analysis/cauchy.js';
import { state, zPlaneParams } from '../js/store/state.js';
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

test('continuation counts oriented crossings of ray branch cuts', () => {
    const path = [{ re: -1, im: -1 }, { re: -1, im: 1 }];
    assert.equal(Math.abs(continuationNativeSheet(path, Math.PI)), 1);
});

test('continued logarithm changes by one sheet increment', () => {
    const baseState = { logBase: { re: Math.E, im: 0 }, branchCutAngle: Math.PI, chainingEnabled: false };
    const principal = evaluateOnSheet('ln', { re: 1, im: 0 }, 0, completeRuntimeState(baseState));
    const next = evaluateOnSheet('ln', { re: 1, im: 0 }, 1, completeRuntimeState(baseState));
    assert.ok(Math.abs(next.im - principal.im - Math.PI * 2) < 1e-10);
});

test('continued logarithm uses the selected ray as its argument boundary', () => {
    const runtimeState = { logBase: { re: Math.E, im: 0 }, branchCutAngle: 0, chainingEnabled: false };
    const value = evaluateOnSheet('ln', { re: 0, im: 1 }, 0, completeRuntimeState(runtimeState));
    assert.ok(Math.abs(value.im + Math.PI * 1.5) < 1e-10);
});

test('continued inverse sine alternates reflected sheets', () => {
    const runtimeState = { branchCutAngle: Math.PI, chainingEnabled: false };
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
        branchCutAngle: Math.PI,
        logBase: { re: Math.E, im: 0 }
    };
    const principal = evaluateOnSheet('algebraic_chaining', { re: 1, im: 0 }, 0, completeRuntimeState(runtimeState));
    const next = evaluateOnSheet('algebraic_chaining', { re: 1, im: 0 }, 1, completeRuntimeState(runtimeState));
    assert.ok(Math.hypot(next.re - principal.re, next.im - principal.im) > 1);
});

test('preimage explorer finds and deduplicates both square roots', () => {
    const roots = findNativePreimages({
        target: { re: 1e-10, im: 0 },
        map: completeNativeMapOptions({
            functionKey: 'polynomial', chainingEnabled: false, polynomialN: 2,
            polynomialCoeffs: [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 1e-10, im: 0 }]
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

test('preimage search rejects asymptotic limits as roots', () => {
    for (const [functionKey, inverseOutput] of [['exp', false], ['sec', false], ['sinh', true]]) {
        const roots = findNativePreimages({
            target: { re: 0, im: 0 },
            map: completeNativeMapOptions({ functionKey, chainingEnabled: false, chainCount: 1 }),
            xRange: [-20, 20], yRange: [-20, 20], density: 32, maxIterations: 30, inverseOutput
        });
        assert.deepEqual(roots, [], `${functionKey} produced false roots`);
    }
});

test('feature detection respects analytic families, multiplicity, and the displayed derivative', () => {
    const previousState = Object.fromEntries([
        'showZerosPoles', 'manifold3dViewEnabled', 'manifoldTransformationEnabled', 'mapPresentation',
        'chainingEnabled', 'taylorSeriesEnabled', 'currentFunction', 'polynomialN', 'polynomialCoeffs',
        'currentInputShape', 'a0', 'b0', 'circleR', 'cauchyIntegralModeEnabled',
        'zetaContinuationEnabled', 'algebraicChainingEnabled', 'algebraicChainingZExpr',
        'algebraicChainingTerms', 'chainingMode', 'chainCount'
    ].map(key => [key, state[key]]));
    const previousRanges = [[...zPlaneParams.currentVisXRange], [...zPlaneParams.currentVisYRange]];
    const previousPreciseViewport = zPlaneParams.preciseViewport;
    const coordinates = points => points.map(point =>
        `${point.re.toFixed(6)},${point.im.toFixed(6)},${point.order}`);

    try {
        Object.assign(state, {
            showZerosPoles: true,
            manifold3dViewEnabled: false,
            manifoldTransformationEnabled: false,
            mapPresentation: 'function',
            chainingEnabled: false,
            taylorSeriesEnabled: false
        });
        zPlaneParams.preciseViewport = null;
        zPlaneParams.currentVisXRange = [-6, 6];
        zPlaneParams.currentVisYRange = [-6, 6];

        const cases = [
            ['sec', [], ['-4.712389,0.000000,1', '-1.570796,0.000000,1', '1.570796,0.000000,1', '4.712389,0.000000,1']],
            ['sinh', ['0.000000,-3.141593,1', '0.000000,0.000000,1', '0.000000,3.141593,1'], []],
            ['tanh', ['0.000000,-3.141593,1', '0.000000,0.000000,1', '0.000000,3.141593,1'],
                ['0.000000,-4.712389,1', '0.000000,-1.570796,1', '0.000000,1.570796,1', '0.000000,4.712389,1']],
            ['ln', ['1.000000,0.000000,1'], []],
            ['gamma', [], ['0.000000,0.000000,1', '-1.000000,0.000000,1', '-2.000000,0.000000,1',
                '-3.000000,0.000000,1', '-4.000000,0.000000,1', '-5.000000,0.000000,1', '-6.000000,0.000000,1']]
        ];
        for (const [currentFunction, zeros, poles] of cases) {
            state.currentFunction = currentFunction;
            findZerosAndPoles();
            assert.deepEqual(coordinates(state.zeros), zeros, `${currentFunction} zeros`);
            assert.deepEqual(coordinates(state.poles), poles, `${currentFunction} poles`);
        }

        state.currentFunction = 'sec';
        state.mapPresentation = 'derivative';
        findZerosAndPoles();
        assert.deepEqual(state.zeros.map(point => Math.round(point.re / Math.PI)), [-1, 0, 1]);
        assert.equal(state.poles.length, 4);
        assert.ok(state.poles.every(point => point.order === 2));

        Object.assign(state, {
            currentFunction: 'algebraic_chaining', algebraicChainingEnabled: true,
            algebraicChainingZExpr: 'z',
            algebraicChainingTerms: [{
                coeff: { re: 1, im: 0 },
                factors: [{ func: 'sec', chainedFunc: 'none', power: 1, reciprocal: false, log: false, exp: false }]
            }],
            currentInputShape: 'circle', a0: 0.4, b0: 0, circleR: 5.1,
            cauchyIntegralModeEnabled: true, mapPresentation: 'function'
        });
        findZerosAndPoles();
        assert.equal(state.zeros.length, 0);
        assert.equal(state.poles.length, 4);
        performCauchyAnalysis();
        assert.match(getCauchyDisplay().html, /f\(z\)dz ≈ 0\.000 \+ 6\.283i/);
        assert.match(getCauchyDisplay().html, /2πi ΣRes ≈ 0\.000 \+ 6\.283i/);

        Object.assign(state, {
            currentFunction: 'polynomial', polynomialN: 2,
            polynomialCoeffs: [{ re: 1, im: 0 }, { re: -2, im: 0 }, { re: 1, im: 0 }]
        });
        findZerosAndPoles();
        assert.deepEqual(coordinates(state.zeros), ['1.000000,0.000000,2']);

        Object.assign(state, {
            currentFunction: 'zeta', zetaContinuationEnabled: true,
            polynomialCoeffs: previousState.polynomialCoeffs
        });
        zPlaneParams.currentVisXRange = [-7, 2];
        zPlaneParams.currentVisYRange = [-20, 20];
        findZerosAndPoles();
        for (const real of [-2, -4, -6]) {
            assert.equal(state.zeros.filter(point => point.re === real && point.im === 0).length, 1);
        }
        assert.deepEqual(coordinates(state.poles), ['1.000000,0.000000,1']);

        Object.assign(state, {
            currentFunction: 'algebraic_chaining', algebraicChainingEnabled: true,
            algebraicChainingZExpr: 'z',
            algebraicChainingTerms: [{
                coeff: { re: 1, im: 0 },
                factors: [{ func: 'polynomial', chainedFunc: 'none', power: 1, reciprocal: false, log: false, exp: false }]
            }],
            polynomialN: 2,
            polynomialCoeffs: [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }],
            zetaContinuationEnabled: false, chainingEnabled: true, chainingMode: 'recursion', chainCount: 2
        });
        zPlaneParams.currentVisXRange = [-2, 2];
        zPlaneParams.currentVisYRange = [-2, 2];
        findZerosAndPoles();
        assert.equal(state.zeros.length, 1);
        assert.equal(state.zeros[0].order, 4);
        assert.ok(Math.hypot(state.zeros[0].re, state.zeros[0].im) < 5e-5);

        state.mapPresentation = 'derivative';
        findZerosAndPoles();
        assert.equal(state.zeros.length, 1);
        assert.equal(state.zeros[0].order, 3);
        assert.ok(Math.hypot(state.zeros[0].re, state.zeros[0].im) < 5e-5);
        assert.deepEqual(state.poles, []);
    } finally {
        Object.assign(state, previousState);
        [zPlaneParams.currentVisXRange, zPlaneParams.currentVisYRange] = previousRanges;
        zPlaneParams.preciseViewport = previousPreciseViewport;
    }
});

test('polygon contours support inside tests', () => {
    const params = { points: [{ re: 0, im: 0 }, { re: 2, im: 0 }, { re: 0, im: 2 }, { re: 0, im: 0 }] };
    assert.equal(isPointInsideContour({ re: 0.25, im: 0.25 }, 'contour', params), true);
    assert.equal(isPointInsideContour({ re: 2, im: 2 }, 'contour', params), false);
});
