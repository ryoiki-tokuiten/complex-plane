import test from 'node:test';
import assert from 'node:assert/strict';

import { compileExpression } from '../js/math/expression/index.js';
import { state } from '../js/store/state.js';
import {
    NATIVE_FUNCTION_IDS,
    evaluateNativePoints,
    nativeMapOptions
} from '../js/native/complex-engine.js';
import { createDomainDynamicsTileRenderer } from '../js/native/domain-engine.js';
import { buildPlanarDomainDynamicsSnapshot } from '../js/rendering/domain-dynamics.js';
import {
    buildComplexMathLibraryGLSL,
    getWebGLFunctionIdShared
} from '../js/rendering/webgl-shared.js';

function expectedSin({ re, im }) {
    return {
        re: Math.sin(re) * Math.cosh(im),
        im: Math.cos(re) * Math.sinh(im)
    };
}

function assertComplexClose(actual, expected, tolerance = 1e-12) {
    assert.ok(Math.abs(actual.re - expected.re) <= tolerance, `${actual.re} ~= ${expected.re}`);
    assert.ok(Math.abs(actual.im - expected.im) <= tolerance, `${actual.im} ~= ${expected.im}`);
}

test('sin is registered across native maps, expressions, and WebGL dispatch', () => {
    assert.equal(NATIVE_FUNCTION_IDS.sin, 2);
    assert.equal(getWebGLFunctionIdShared('sin', true), 2);

    const shader = buildComplexMathLibraryGLSL({
        usedFids: new Set([2]),
        useZeta: false,
        useGamma: false,
        useBessel: false,
        usePoly: false
    });
    assert.match(shader, /fId - 2\.0/);

    const points = [
        { re: 0, im: 0 },
        { re: Math.PI / 2, im: 0 },
        { re: 0.5, im: 0.2 }
    ];
    const result = evaluateNativePoints(
        nativeMapOptions(state, { functionKey: 'sin', chainingEnabled: false }),
        points
    );
    assert.deepEqual(Array.from(result.valid), [1, 1, 1]);
    result.values.forEach((value, index) => assertComplexClose(value, expectedSin(points[index])));

    const expression = compileExpression('sin(z)', { allowedVariables: ['z'] });
    assertComplexClose(expression({ z: points[2] }), expectedSin(points[2]));
});

test('sin renders through the native domain-dynamics path', () => {
    const keys = [
        'currentFunction', 'chainingEnabled', 'chainCount',
        'algebraicChainingEnabled', 'algebraicChainingTerms'
    ];
    const before = Object.fromEntries(keys.map(key => [key, state[key]]));

    try {
        Object.assign(state, {
            currentFunction: 'sin',
            chainingEnabled: false,
            chainCount: 1,
            algebraicChainingEnabled: false,
            algebraicChainingTerms: []
        });
        const snapshot = buildPlanarDomainDynamicsSnapshot(state, {
            width: 1,
            height: 1,
            currentVisXRange: [Math.PI / 2, Math.PI / 2 + 1],
            currentVisYRange: [0, 1]
        });
        const renderer = createDomainDynamicsTileRenderer(snapshot);
        try {
            const pixel = renderer({ x: 0, y: 0, width: 1, height: 1, scale: 1 });
            assert.equal(pixel.length, 4);
            assert.equal(pixel[3], 255);
            assert.ok(pixel[0] !== 0 || pixel[1] !== 0 || pixel[2] !== 0);
        } finally {
            renderer.dispose();
        }
    } finally {
        Object.assign(state, before);
    }
});
