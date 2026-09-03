import test from 'node:test';
import assert from 'node:assert/strict';

import {
    compileExpression,
    composeProductExpression,
    decomposeProductExpression
} from '../js/math/expression/index.js';

function approxComplex(actual, expected, epsilon = 1e-10) {
    assert.ok(actual && expected, 'expected complex values');
    const scale = Math.max(1, Math.hypot(expected.re, expected.im));
    assert.ok(Math.abs(actual.re - expected.re) <= epsilon * scale, `${actual.re} ~= ${expected.re}`);
    assert.ok(Math.abs(actual.im - expected.im) <= epsilon * scale, `${actual.im} ~= ${expected.im}`);
}

test('product-term decomposition preserves powers, factorials, and denominator placement', () => {
    const source = 'x^n / n!';
    const factors = decomposeProductExpression(source);

    assert.equal(factors.length, 2);
    assert.deepEqual(
        factors.map(factor => ({
            base: factor.base,
            exponent: factor.exponent,
            wrapper: factor.wrapper,
            denominator: factor.denominator
        })),
        [
            { base: 'x', exponent: 'n', wrapper: 'none', denominator: false },
            { base: 'n', exponent: '', wrapper: 'factorial', denominator: true }
        ]
    );

    const rebuilt = compileExpression(composeProductExpression(factors), {
        allowedVariables: ['x', 'n']
    });
    const value = rebuilt({ x: { re: 3, im: 0 }, n: { re: 4, im: 0 } });
    assert.ok(Math.abs(value.re - 3.375) < 1e-12);
    assert.ok(Math.abs(value.im) < 1e-12);
});

test('product-term decomposition round-trips semantic values across wrappers and denominators', () => {
    const terms = [
        'z^2', 'tan(z)', '(x+1)^n', 'cos(theta)^2', 'abs(z)'
    ];
    const environment = {
        z: { re: 1.2, im: -0.4 },
        x: { re: 0.7, im: 0.2 },
        n: { re: 3, im: 0 },
        theta: { re: 0.35, im: 0 }
    };

    for (let i = 0; i < terms.length; i++) {
        for (let j = 0; j < terms.length; j++) {
            const compound = `${terms[i]} / ${terms[j]}`;
            const factors = decomposeProductExpression(compound);
            const reconstructed = composeProductExpression(factors);
            const original = compileExpression(compound, { allowedVariables: ['z', 'x', 'n', 'theta'] });
            const rebuilt = compileExpression(reconstructed, { allowedVariables: ['z', 'x', 'n', 'theta'] });

            approxComplex(rebuilt(environment), original(environment));
        }
    }
});
