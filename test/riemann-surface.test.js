import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    algebraicExpressionHasBranches,
    baseExpressionHasBranches,
    dynamicExpressionHasBranches,
    getBranchWindowLabel,
    getVisibleBranchIndices
} from '../js/analysis/riemann-surface.js';
import {
    buildRiemannSurfaceMathLibrary,
    getRiemannSurfaceGridData,
    getRiemannSurfaceProgramSignature
} from '../js/rendering/webgl-riemann-surface.js';

function makeState(overrides = {}) {
    return {
        currentFunction: 'cos',
        fractionalPowerN: 0.5,
        algebraicChainingTerms: [],
        algebraicChainingZExpr: 'z',
        taylorSeriesEnabled: false,
        chainingEnabled: false,
        chainingMode: 'recursion',
        ...overrides
    };
}

test('single-valued functions collapse to the principal sheet', () => {
    const runtimeState = makeState({ currentFunction: 'cos' });
    assert.equal(baseExpressionHasBranches(runtimeState), false);
    assert.deepEqual(getVisibleBranchIndices(9, 12, false), [0]);
});

test('logarithm and non-integer powers expose branch sheets', () => {
    assert.equal(baseExpressionHasBranches(makeState({ currentFunction: 'ln' })), true);
    assert.equal(baseExpressionHasBranches(makeState({
        currentFunction: 'power',
        fractionalPowerN: 0.5
    })), true);
    assert.equal(baseExpressionHasBranches(makeState({
        currentFunction: 'power',
        fractionalPowerN: 3
    })), false);
});

test('algebraic chaining detects branch-bearing functions and modifiers', () => {
    const terms = [{
        coeff: { re: 1, im: 0 },
        factors: [{
            func: 'exp',
            chainedFunc: 'cos',
            power: 0.5,
            reciprocal: false,
            log: false,
            exp: false
        }]
    }];
    assert.equal(algebraicExpressionHasBranches(terms, makeState()), true);

    terms[0].factors[0].power = 2;
    terms[0].factors[0].log = true;
    assert.equal(algebraicExpressionHasBranches(terms, makeState()), true);
});

test('algebraic custom z expressions contribute branch metadata', () => {
    const runtimeState = makeState({
        currentFunction: 'algebraic_chaining',
        algebraicChainingZExpr: 'sqrt(z)',
        algebraicChainingTerms: [{ coeff: { re: 1, im: 0 }, factors: [{ func: 'cos' }] }]
    });
    assert.equal(baseExpressionHasBranches(runtimeState), true);
});

test('Taylor surfaces are single-valued polynomial approximations', () => {
    const runtimeState = makeState({
        currentFunction: 'ln',
        taylorSeriesEnabled: true
    });
    assert.equal(baseExpressionHasBranches(runtimeState), false);
});

test('recursive chaining modes do not introduce sheets without a branch-bearing base map', () => {
    const recursionState = makeState({ chainingEnabled: true, chainingMode: 'recursion' });
    assert.equal(baseExpressionHasBranches(recursionState), false);

    const zeroSeedState = makeState({ chainingEnabled: true, chainingMode: 'zero_seed' });
    assert.equal(baseExpressionHasBranches(zeroSeedState), false);
});

test('branch windows remain odd, bounded, and centered', () => {
    assert.deepEqual(getVisibleBranchIndices(5, 0, true), [-2, -1, 0, 1, 2]);
    assert.deepEqual(getVisibleBranchIndices(8, 3, true), [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(getVisibleBranchIndices(9, -2, true), [-6, -5, -4, -3, -2, -1, 0, 1, 2]);
    assert.throws(() => getVisibleBranchIndices(99, -2, true), /between 1 and 9/);
    assert.equal(getBranchWindowLabel([-2, -1, 0, 1, 2]), 'sheets k = -2...2');
});

test('dynamic aggregate expressions contribute branch metadata', () => {
    const runtimeState = makeState({
        dynamicPlotting: {
            enabled: true,
            mode: 'aggregate',
            pointExpression: 'd',
            term: { kind: 'expression', expression: 'sqrt(s) + d^(-s)' },
            reduction: { kind: 'sum' }
        }
    });
    assert.equal(dynamicExpressionHasBranches(runtimeState), true);
    assert.equal(baseExpressionHasBranches(runtimeState), true);
});

test('Riemann program signatures keep algebraic parameter edits uniform-backed', () => {
    const runtimeState = makeState({
        currentFunction: 'algebraic_chaining',
        algebraicChainingZExpr: 'z',
        algebraicChainingTerms: [{
            coeff: { re: 1, im: 0 },
            factors: [{
                func: 'exp',
                chainedFunc: 'none',
                power: 1,
                reciprocal: false,
                log: false,
                exp: false
            }]
        }]
    });

    const before = getRiemannSurfaceProgramSignature(runtimeState);
    runtimeState.algebraicChainingTerms[0].coeff.re = 2;
    runtimeState.algebraicChainingTerms[0].factors[0].power = 2.5;
    const afterNumericEdit = getRiemannSurfaceProgramSignature(runtimeState);
    assert.equal(afterNumericEdit, before);

    runtimeState.algebraicChainingTerms[0].factors[0].func = 'cos';
    runtimeState.algebraicChainingTerms[0].factors[0].chainedFunc = 'exp';
    const afterFunctionEdit = getRiemannSurfaceProgramSignature(runtimeState);
    assert.equal(afterFunctionEdit, before);

    runtimeState.algebraicChainingTerms[0].factors[0].log = true;
    runtimeState.algebraicChainingTerms[0].factors[0].reciprocal = true;
    runtimeState.algebraicChainingTerms[0].factors[0].exp = true;
    const afterModifierEdit = getRiemannSurfaceProgramSignature(runtimeState);
    assert.equal(afterModifierEdit, before);
});

test('Riemann shaders specialize their static loop bound to the active chain depth', () => {
    const ordinaryState = makeState({ chainCount: 1 });
    assert.match(
        buildRiemannSurfaceMathLibrary(ordinaryState),
        /const int RIEMANN_SURFACE_ITERATION_LIMIT = 1;/
    );

    const chainedState = makeState({ chainingEnabled: true, chainCount: 37 });
    assert.match(
        buildRiemannSurfaceMathLibrary(chainedState),
        /const int RIEMANN_SURFACE_ITERATION_LIMIT = 37;/
    );

    const before = getRiemannSurfaceProgramSignature(chainedState);
    chainedState.chainCount = 38;
    assert.notEqual(getRiemannSurfaceProgramSignature(chainedState), before);
});

test('drawn branch-cut shader inputs declare their scalar uniforms', async () => {
    const source = await readFile(new URL('../js/rendering/webgl-riemann-surface.js', import.meta.url), 'utf8');
    assert.match(source, /uniform int u_branchCutPointCount;/);
});

test('sheet-aware algebraic expressions use the active cut helpers', () => {
    const runtimeState = makeState({
        currentFunction: 'algebraic_chaining',
        algebraicChainingZExpr: 'sqrt(z) + ln(z)',
        algebraicChainingTerms: [{
            coeff: { re: 1, im: 0 },
            factors: [{ func: 'cos', power: 1 }]
        }]
    });
    const source = buildRiemannSurfaceMathLibrary(runtimeState);
    assert.match(source, /pointTouchesActiveBranchCut/);
    assert.match(source, /dynamicComplexPowOnSheet\(z, vec2\(0\.5, 0\.0\), branchIndex, branchCutWidth\)/);
    assert.match(source, /dynamicLnOnSheet\(z, branchIndex, branchCutWidth\)/);
});

test('Riemann surface grid topology is cached and index-safe', () => {
    const resolution = 64;
    const grid = getRiemannSurfaceGridData(resolution);
    const cached = getRiemannSurfaceGridData(resolution);
    const vertexCount = (resolution + 1) * (resolution + 1);

    assert.equal(cached, grid);
    assert.equal(grid.vertices.length, vertexCount * 2);
    assert.equal(grid.triangles.length, resolution * resolution * 6);
    assert.ok(grid.lines.length > 0);

    for (const index of grid.triangles) {
        assert.ok(index >= 0 && index < vertexCount);
    }
    for (const index of grid.lines) {
        assert.ok(index >= 0 && index < vertexCount);
    }
});
