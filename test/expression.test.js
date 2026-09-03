import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EXPRESSION_LIMITS,
    ExpressionEvaluationError,
    ExpressionSyntaxError,
    compileExpression,
    parseExpression
} from '../js/math/expression/index.js';
import { state } from '../js/store/state.js';
import { transformFunctions } from '../js/native/map-runtime.js';

function closeComplex(actual, expected, tolerance = 1e-10) {
    assert.ok(Math.abs(actual.re - expected.re) <= tolerance, `real ${actual.re} != ${expected.re}`);
    assert.ok(Math.abs(actual.im - expected.im) <= tolerance, `imag ${actual.im} != ${expected.im}`);
}

test('expression parser respects precedence, right-associative powers, and implicit multiplication', () => {
    const expression = compileExpression('2 + 3d^2^2', { allowedVariables: ['d'] });
    closeComplex(expression({ d: { re: 2, im: 0 } }), { re: 50, im: 0 });

    const negativePower = compileExpression('-2^2');
    closeComplex(negativePower({}), { re: -4, im: 0 });
});

test('real-axis powers do not leak numerical branch residue', () => {
    const expression = compileExpression('x^2 - y^2 + (x*y)^(14)', {
        allowedVariables: ['x', 'y']
    });
    closeComplex(
        expression({ x: { re: -10, im: 0 }, y: { re: 8, im: 0 } }),
        { re: Math.pow(-80, 14) + 36, im: 0 }
    );

    const imaginaryPart = compileExpression('im(cos(x^2 - y^2 + (x*y)^(14)))', {
        allowedVariables: ['x', 'y']
    });
    closeComplex(
        imaginaryPart({ x: { re: -10, im: 0 }, y: { re: 8, im: 0 } }),
        { re: 0, im: 0 }
    );

    const fractionalPowerImaginaryPart = compileExpression('im(cos((x^2 - y^2)^(1.5)))', {
        allowedVariables: ['x', 'y']
    });
    closeComplex(
        fractionalPowerImaginaryPart({ x: { re: 0, im: 0 }, y: { re: 8, im: 0 } }),
        { re: 0, im: 0 }
    );
});

test('complex literals, composition, and helpers evaluate without eval', () => {
    const expression = compileExpression('conj(2 + 3i) + complex(1, -2)');
    closeComplex(expression({}), { re: 3, im: -5 });

    const composed = compileExpression('exp(ln(z))', { allowedVariables: ['z'] });
    closeComplex(composed({ z: { re: 1.25, im: -0.4 } }), { re: 1.25, im: -0.4 }, 1e-9);
});

test('inverse trig, Gamma, log Gamma, and generalized Bessel expressions evaluate', () => {
    closeComplex(compileExpression('asin(0.5)')({}), { re: Math.PI / 6, im: 0 }, 1e-9);
    closeComplex(compileExpression('atan(1)')({}), { re: Math.PI / 4, im: 0 }, 1e-9);
    closeComplex(compileExpression('gamma(5)')({}), { re: 24, im: 0 }, 1e-9);
    closeComplex(compileExpression('loggamma(5)')({}), { re: Math.log(24), im: 0 }, 1e-9);
    closeComplex(compileExpression('bessel(0,0)')({}), { re: 1, im: 0 }, 1e-9);
});

test('configured bases apply consistently to exp and ln expressions', () => {
    const oldExp = state.expBase;
    const oldLog = state.logBase;
    try {
        state.expBase = { re: 2, im: 0 };
        state.logBase = { re: 10, im: 0 };
        closeComplex(compileExpression('exp(3)')({}), { re: 8, im: 0 }, 1e-9);
        closeComplex(compileExpression('ln(100)')({}), { re: 2, im: 0 }, 1e-9);
    } finally {
        state.expBase = oldExp;
        state.logBase = oldLog;
    }
});

test('undefined exponential and logarithm bases stay invalid', () => {
    const oldExp = state.expBase;
    const oldLog = state.logBase;
    try {
        state.expBase = { re: 0, im: 0 };
        state.logBase = { re: 1, im: 0 };
        assert.throws(() => compileExpression('exp(3)')({}), ExpressionEvaluationError);
        assert.throws(() => compileExpression('ln(3)')({}), ExpressionEvaluationError);
    } finally {
        state.expBase = oldExp;
        state.logBase = oldLog;
    }
});

test('conditionals, predicates, factorial, gcd, and custom parameters work', () => {
    const expression = compileExpression(
        'isPrime(j) ? factorial(k) + gcd(j, 6) : 0',
        { allowedVariables: ['j', 'k'] }
    );
    closeComplex(expression({ j: { re: 5, im: 0 }, k: { re: 4, im: 0 } }), { re: 25, im: 0 });
    closeComplex(expression({ j: { re: 6, im: 0 }, k: { re: 4, im: 0 } }), { re: 0, im: 0 });
});

test('selected function calls execute the supplied native map', () => {
    const expression = compileExpression('selected(z) + f(z)', { allowedVariables: ['z'] });
    const selectedFunction = transformFunctions.cos;
    const selected = selectedFunction(2, -1);
    closeComplex(
        expression({ z: { re: 2, im: -1 }, selectedFunction }),
        { re: selected.re * 2, im: selected.im * 2 }
    );
});

test('expression validation reports syntax, variable, and domain errors', () => {
    assert.throws(() => parseExpression('1 + )'), ExpressionSyntaxError);
    assert.throws(
        () => compileExpression('secret + 1', { allowedVariables: ['z'] }),
        ExpressionEvaluationError
    );

    const factorial = compileExpression('2.5!');
    assert.throws(() => factorial({}), /must be an integer/);
});

test('expression boundaries reject unsafe formulas with specific errors', () => {
    assert.throws(() => compileExpression(''), /cannot be empty/);
    assert.throws(() => compileExpression('1e999'), /outside the supported range/);
    assert.throws(
        () => compileExpression('1'.repeat(EXPRESSION_LIMITS.sourceLength + 1)),
        /too long/
    );

    const division = compileExpression('1 / z', { allowedVariables: ['z'] });
    assert.throws(
        () => division({ z: { re: 0, im: 0 } }),
        /Division by zero/
    );

    const negativeFactorial = compileExpression('(-1)!');
    assert.throws(() => negativeFactorial({}), /non-negative/);

    const overflowingFactorial = compileExpression('171!');
    assert.throws(() => overflowingFactorial({}), /must not exceed 170/);
});
