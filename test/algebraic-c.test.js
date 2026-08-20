import test from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../js/store/state.js';
import { DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE } from '../js/constants/domain-dynamics.js';
import {
    getEffectiveBaseTransformFunction,
    getMappedTransformProfile,
    getChainedTransformFunction,
    getChainedStageTransformFunction
} from '../js/native/map-runtime.js';
import {
    evaluateAlgebraicChaining,
    evaluateAlgebraicTerm,
    evaluateDomainColoringMappedTransform
} from './helpers/native-map.js';

function snapshotState(keys) {
    return Object.fromEntries(keys.map(key => [key, state[key]]));
}

function restoreState(snapshot) {
    Object.assign(state, snapshot);
}

function approxComplex(actual, expected, epsilon = 1e-12) {
    assert.ok(actual, 'expected a complex value');
    const scale = Math.max(1, Math.hypot(expected.re, expected.im));
    assert.ok(Math.abs(actual.re - expected.re) <= epsilon * scale, `${actual.re} ~= ${expected.re}`);
    assert.ok(Math.abs(actual.im - expected.im) <= epsilon * scale, `${actual.im} ~= ${expected.im}`);
}

function factor(func, overrides = {}) {
    return {
        func,
        chainedFunc: 'none',
        power: 1,
        reciprocal: false,
        log: false,
        exp: false,
        ...overrides
    };
}

function configureQuadraticParameterChain(chainCount, chainingMode = 'recursion') {
    Object.assign(state, {
        currentFunction: 'algebraic_chaining',
        algebraicChainingEnabled: true,
        algebraicChainingZExpr: 'z',
        polynomialN: 2,
        polynomialCoeffs: [
            { re: 0, im: 0 },
            { re: 0, im: 0 },
            { re: 1, im: 0 }
        ],
        algebraicChainingTerms: [
            { coeff: { re: 1, im: 0 }, factors: [factor('polynomial')] },
            { coeff: { re: 1, im: 0 }, factors: [factor('c')] }
        ],
        chainingEnabled: true,
        chainingMode,
        chainCount
    });
}

test('algebraic term cache observes in-place term edits', () => {
    const before = snapshotState(['algebraicChainingZExpr']);
    const term = { coeff: { re: 1, im: 0 }, factors: [factor('cos')] };
    const z = { re: Math.PI / 2, im: 0 };

    try {
        state.algebraicChainingZExpr = 'z';
        approxComplex(evaluateAlgebraicTerm(term, z), { re: 0, im: 0 });
        term.factors[0].func = 'exp';
        approxComplex(evaluateAlgebraicTerm(term, { re: 0, im: 0 }), { re: 1, im: 0 });
        term.coeff.re = 2;
        approxComplex(evaluateAlgebraicTerm(term, { re: 0, im: 0 }), { re: 2, im: 0 });
        term.factors[0].func = 'missing_transform';
        assert.throws(() => evaluateAlgebraicTerm(term, z), /Unsupported native algebraic function/);
    } finally {
        restoreState(before);
    }
});

test('invalid algebraic z expressions fail at the native boundary', () => {
    const before = snapshotState(['algebraicChainingEnabled', 'algebraicChainingZExpr', 'algebraicChainingTerms']);
    try {
        Object.assign(state, {
            algebraicChainingEnabled: true,
            algebraicChainingZExpr: 'bad +',
            algebraicChainingTerms: [{ coeff: { re: 1, im: 0 }, factors: [factor('c')] }]
        });
        assert.throws(() => evaluateAlgebraicChaining(2, 0), /Expected a value/);
    } finally {
        restoreState(before);
    }
});

function iterateQuadraticParameter(c, count, bailout = Infinity) {
    let current = { re: c.re, im: c.im };

    for (let index = 0; index < count; index += 1) {
        current = {
            re: current.re * current.re - current.im * current.im + c.re,
            im: 2 * current.re * current.im + c.im
        };

        if (!Number.isFinite(current.re) || !Number.isFinite(current.im)) break;
        if (Math.max(Math.abs(current.re), Math.abs(current.im)) >= bailout) break;
    }

    return current;
}

test('algebraic chaining can hold original input as c during recursion', () => {
    const keys = [
        'currentFunction',
        'algebraicChainingEnabled',
        'algebraicChainingTerms',
        'polynomialN',
        'polynomialCoeffs',
        'chainingEnabled',
        'chainingMode',
        'chainCount'
    ];
    const before = snapshotState(keys);

    try {
        Object.assign(state, {
            currentFunction: 'algebraic_chaining',
            algebraicChainingEnabled: true,
            polynomialN: 2,
            polynomialCoeffs: [
                { re: 0, im: 0 },
                { re: 0, im: 0 },
                { re: 1, im: 0 }
            ],
            algebraicChainingTerms: [
                {
                    coeff: { re: 1, im: 0 },
                    factors: [{ func: 'polynomial', chainedFunc: 'none', power: 1, reciprocal: false, log: false, exp: false }]
                },
                {
                    coeff: { re: 1, im: 0 },
                    factors: [{ func: 'c', chainedFunc: 'none', power: 1, reciprocal: false, log: false, exp: false }]
                }
            ],
            chainingEnabled: true,
            chainingMode: 'recursion',
            chainCount: 2
        });

        assert.deepEqual(
            evaluateAlgebraicChaining({ re: 3, im: 0 }, undefined, { c: { re: 2, im: 0 } }),
            { re: 11, im: 0 }
        );

        const chained = getChainedTransformFunction('algebraic_chaining');
        assert.deepEqual(chained(2, 0), { re: 38, im: 0 });

        state.chainingMode = 'zero_seed';
        state.chainCount = 2;
        const zeroSeed = getChainedTransformFunction('algebraic_chaining');
        assert.deepEqual(zeroSeed(2, 0), { re: 6, im: 0 });
    } finally {
        restoreState(before);
    }
});

test('explicit c context bypasses mapped constant shortcuts during chaining', () => {
    const keys = [
        'currentFunction',
        'algebraicChainingEnabled',
        'algebraicChainingTerms',
        'polynomialN',
        'polynomialCoeffs',
        'chainingEnabled',
        'chainingMode',
        'chainCount'
    ];
    const before = snapshotState(keys);

    try {
        Object.assign(state, {
            currentFunction: 'algebraic_chaining',
            algebraicChainingEnabled: true,
            polynomialN: 1,
            polynomialCoeffs: [
                { re: 0, im: 0 },
                { re: 1, im: 0 }
            ],
            algebraicChainingTerms: [
                {
                    coeff: { re: 1, im: 0 },
                    factors: [{ func: 'polynomial', chainedFunc: 'none', power: 1, reciprocal: false, log: false, exp: false }]
                },
                {
                    coeff: { re: -1, im: 0 },
                    factors: [{ func: 'c', chainedFunc: 'none', power: 1, reciprocal: false, log: false, exp: false }]
                }
            ],
            chainingEnabled: true,
            chainingMode: 'zero_seed',
            chainCount: 2
        });

        const zeroSeed = getChainedTransformFunction('algebraic_chaining');
        assert.deepEqual(zeroSeed(2, 0), { re: -4, im: 0 });
    } finally {
        restoreState(before);
    }
});

test('deep escaped recursion still provides a finite domain-coloring value', () => {
    const keys = [
        'currentFunction',
        'algebraicChainingEnabled',
        'algebraicChainingTerms',
        'polynomialN',
        'polynomialCoeffs',
        'chainingEnabled',
        'chainingMode',
        'chainCount'
    ];
    const before = snapshotState(keys);

    try {
        Object.assign(state, {
            currentFunction: 'algebraic_chaining',
            algebraicChainingEnabled: true,
            polynomialN: 2,
            polynomialCoeffs: [
                { re: 0, im: 0 },
                { re: 0, im: 0 },
                { re: 1, im: 0 }
            ],
            algebraicChainingTerms: [
                {
                    coeff: { re: 1, im: 0 },
                    factors: [{ func: 'polynomial', chainedFunc: 'none', power: 1, reciprocal: false, log: false, exp: false }]
                },
                {
                    coeff: { re: 1, im: 0 },
                    factors: [{ func: 'c', chainedFunc: 'none', power: 1, reciprocal: false, log: false, exp: false }]
                }
            ],
            chainingEnabled: true,
            chainingMode: 'recursion',
            chainCount: 25
        });

        const baseProfile = getMappedTransformProfile(
            'algebraic_chaining',
            getEffectiveBaseTransformFunction('algebraic_chaining')
        );
        const mapped = evaluateDomainColoringMappedTransform(baseProfile, 2, 0, 'algebraic_chaining');

        assert.ok(Number.isFinite(mapped.re));
        assert.ok(Number.isFinite(mapped.im));
    } finally {
        restoreState(before);
    }
});

test('domain coloring and staged output chains share recursive mode semantics', () => {
    const keys = [
        'currentFunction',
        'algebraicChainingEnabled',
        'algebraicChainingTerms',
        'polynomialN',
        'polynomialCoeffs',
        'chainingEnabled',
        'chainingMode',
        'chainCount'
    ];
    const before = snapshotState(keys);

    try {
        Object.assign(state, {
            currentFunction: 'algebraic_chaining',
            algebraicChainingEnabled: true,
            polynomialN: 2,
            polynomialCoeffs: [
                { re: 0, im: 0 },
                { re: 0, im: 0 },
                { re: 1, im: 0 }
            ],
            algebraicChainingTerms: [
                {
                    coeff: { re: 1, im: 0 },
                    factors: [{ func: 'polynomial', chainedFunc: 'none', power: 1, reciprocal: false, log: false, exp: false }]
                }
            ],
            chainingEnabled: true,
            chainingMode: 'recursion',
            chainCount: 3
        });

        const baseProfile = getMappedTransformProfile(
            'algebraic_chaining',
            getEffectiveBaseTransformFunction('algebraic_chaining')
        );
        const mapped = evaluateDomainColoringMappedTransform(baseProfile, 2, 0, 'algebraic_chaining');
        const stageOne = getChainedStageTransformFunction('algebraic_chaining', 1);
        const stageTwo = getChainedStageTransformFunction('algebraic_chaining', 2);

        assert.deepEqual(mapped, { re: 256, im: 0 });
        assert.deepEqual(stageOne(2, 0), { re: 16, im: 0 });
        assert.deepEqual(stageTwo(2, 0), { re: 256, im: 0 });
    } finally {
        restoreState(before);
    }
});

test('zero-seed depth one evaluates from the seed in domain coloring too', () => {
    const keys = [
        'currentFunction',
        'algebraicChainingEnabled',
        'algebraicChainingTerms',
        'polynomialN',
        'polynomialCoeffs',
        'chainingEnabled',
        'chainingMode',
        'chainCount'
    ];
    const before = snapshotState(keys);

    try {
        Object.assign(state, {
            currentFunction: 'algebraic_chaining',
            algebraicChainingEnabled: true,
            polynomialN: 1,
            polynomialCoeffs: [
                { re: 0, im: 0 },
                { re: 1, im: 0 }
            ],
            algebraicChainingTerms: [
                {
                    coeff: { re: 1, im: 0 },
                    factors: [{ func: 'polynomial', chainedFunc: 'none', power: 1, reciprocal: false, log: false, exp: false }]
                },
                {
                    coeff: { re: 1, im: 0 },
                    factors: [{ func: 'c', chainedFunc: 'none', power: 1, reciprocal: false, log: false, exp: false }]
                }
            ],
            chainingEnabled: true,
            chainingMode: 'zero_seed',
            chainCount: 1
        });

        const baseProfile = getMappedTransformProfile(
            'algebraic_chaining',
            getEffectiveBaseTransformFunction('algebraic_chaining')
        );
        const mapped = evaluateDomainColoringMappedTransform(baseProfile, 2, 0, 'algebraic_chaining');
        const staged = getChainedStageTransformFunction('algebraic_chaining', 0);

        assert.deepEqual(mapped, { re: 2, im: 0 });
        assert.deepEqual(staged(2, 0), { re: 2, im: 0 });
    } finally {
        restoreState(before);
    }
});

test('large output-chain depths evaluate iteratively without nested call stacks', () => {
    const keys = [
        'currentFunction',
        'algebraicChainingEnabled',
        'algebraicChainingTerms',
        'polynomialN',
        'polynomialCoeffs',
        'chainingEnabled',
        'chainingMode',
        'chainCount'
    ];
    const before = snapshotState(keys);

    try {
        Object.assign(state, {
            currentFunction: 'algebraic_chaining',
            algebraicChainingEnabled: true,
            polynomialN: 1,
            polynomialCoeffs: [
                { re: 0, im: 0 },
                { re: 1, im: 0 }
            ],
            algebraicChainingTerms: [
                {
                    coeff: { re: 1, im: 0 },
                    factors: [{ func: 'polynomial', chainedFunc: 'none', power: 1, reciprocal: false, log: false, exp: false }]
                }
            ],
            chainingEnabled: true,
            chainingMode: 'recursion',
            chainCount: 512
        });

        const chained = getChainedTransformFunction('algebraic_chaining');
        assert.deepEqual(chained(2, 0), { re: 2, im: 0 });
    } finally {
        restoreState(before);
    }
});

test('deep bounded quadratic recursion matches an independent z^2 + c orbit', () => {
    const keys = [
        'currentFunction',
        'algebraicChainingEnabled',
        'algebraicChainingZExpr',
        'algebraicChainingTerms',
        'polynomialN',
        'polynomialCoeffs',
        'chainingEnabled',
        'chainingMode',
        'chainCount'
    ];
    const before = snapshotState(keys);

    try {
        const c = { re: -0.123, im: 0.745 };
        configureQuadraticParameterChain(80);
        const baseProfile = getMappedTransformProfile(
            'algebraic_chaining',
            getEffectiveBaseTransformFunction('algebraic_chaining')
        );
        const actual = evaluateDomainColoringMappedTransform(baseProfile, c.re, c.im, 'algebraic_chaining');
        const expected = iterateQuadraticParameter(c, state.chainCount);

        approxComplex(actual, expected);
    } finally {
        restoreState(before);
    }
});

test('algebraic modifier chains agree between domain coloring and staged output transforms', () => {
    const keys = [
        'currentFunction',
        'algebraicChainingEnabled',
        'algebraicChainingZExpr',
        'algebraicChainingTerms',
        'polynomialN',
        'polynomialCoeffs',
        'chainingEnabled',
        'chainingMode',
        'chainCount'
    ];
    const before = snapshotState(keys);

    try {
        Object.assign(state, {
            currentFunction: 'algebraic_chaining',
            algebraicChainingEnabled: true,
            algebraicChainingZExpr: 'z',
            polynomialN: 2,
            polynomialCoeffs: [
                { re: 0.1, im: -0.05 },
                { re: 0.4, im: 0.15 },
                { re: -0.2, im: 0.05 }
            ],
            algebraicChainingTerms: [
                { coeff: { re: 0.7, im: -0.2 }, factors: [factor('polynomial')] },
                { coeff: { re: 0.25, im: 0.1 }, factors: [factor('cos', { power: 2 })] },
                { coeff: { re: 0.08, im: -0.04 }, factors: [factor('c')] },
                { coeff: { re: 0.05, im: 0 }, factors: [factor('sinh', { reciprocal: true })] }
            ],
            chainingEnabled: true
        });

        const baseProfile = getMappedTransformProfile(
            'algebraic_chaining',
            getEffectiveBaseTransformFunction('algebraic_chaining')
        );
        const point = { re: 0.35, im: -0.45 };

        for (const mode of ['recursion', 'zero_seed']) {
            state.chainingMode = mode;
            state.chainCount = 4;

            const domainColoring = evaluateDomainColoringMappedTransform(baseProfile, point.re, point.im, 'algebraic_chaining');
            const staged = getChainedStageTransformFunction('algebraic_chaining', state.chainCount - 1);
            const stagedValue = staged(point.re, point.im);
            if (mode === 'zero_seed') {
                assert.equal(Number.isFinite(domainColoring.re) || Number.isFinite(domainColoring.im), false);
                assert.equal(Number.isFinite(stagedValue.re) || Number.isFinite(stagedValue.im), false);
            } else {
                approxComplex(domainColoring, stagedValue);
            }
        }
    } finally {
        restoreState(before);
    }
});

test('escaped quadratic recursion returns the deterministic domain-coloring bailout value', () => {
    const keys = [
        'currentFunction',
        'algebraicChainingEnabled',
        'algebraicChainingZExpr',
        'algebraicChainingTerms',
        'polynomialN',
        'polynomialCoeffs',
        'chainingEnabled',
        'chainingMode',
        'chainCount'
    ];
    const before = snapshotState(keys);

    try {
        const c = { re: 2, im: 2 };
        configureQuadraticParameterChain(512);
        const baseProfile = getMappedTransformProfile(
            'algebraic_chaining',
            getEffectiveBaseTransformFunction('algebraic_chaining')
        );
        const actual = evaluateDomainColoringMappedTransform(baseProfile, c.re, c.im, 'algebraic_chaining');
        const expected = iterateQuadraticParameter(c, state.chainCount, DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE);

        assert.ok(Number.isFinite(actual.re));
        assert.ok(Number.isFinite(actual.im));
        assert.ok(Math.max(Math.abs(actual.re), Math.abs(actual.im)) >= DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE);
        approxComplex(actual, expected);
    } finally {
        restoreState(before);
    }
});

test('equivalent native algebraic expressions agree across output modes', () => {
    const keys = [
        'currentFunction',
        'algebraicChainingEnabled',
        'algebraicChainingZExpr',
        'algebraicChainingTerms',
        'polynomialN',
        'polynomialCoeffs',
        'chainingEnabled',
        'chainingMode',
        'chainCount'
    ];
    const before = snapshotState(keys);
    const point = { re: 0.2, im: -0.15 };

    try {
        Object.assign(state, {
            currentFunction: 'algebraic_chaining',
            algebraicChainingEnabled: true,
            polynomialN: 2,
            polynomialCoeffs: [
                { re: 0.2, im: 0.1 },
                { re: -0.3, im: 0.05 },
                { re: 0.08, im: -0.02 }
            ],
            algebraicChainingTerms: [
                { coeff: { re: 0.42, im: -0.17 }, factors: [factor('cos', { chainedFunc: 'exp', power: 2 })] },
                { coeff: { re: -0.3, im: 0.11 }, factors: [factor('sinh', { reciprocal: true })] },
                { coeff: { re: 0.07, im: 0.05 }, factors: [factor('ln', { chainedFunc: 'polynomial', exp: true })] },
                { coeff: { re: 0.2, im: -0.08 }, factors: [factor('c')] }
            ],
            chainingEnabled: true
        });

        for (const mode of ['recursion', 'zero_seed']) {
            state.chainingMode = mode;
            state.chainCount = 3;

            state.algebraicChainingZExpr = 'z';
            let profile = getMappedTransformProfile(
                'algebraic_chaining',
                getEffectiveBaseTransformFunction('algebraic_chaining')
            );
            const directExpression = evaluateDomainColoringMappedTransform(profile, point.re, point.im, 'algebraic_chaining');

            state.algebraicChainingZExpr = 'z + 0';
            profile = getMappedTransformProfile(
                'algebraic_chaining',
                getEffectiveBaseTransformFunction('algebraic_chaining')
            );
            const equivalentExpression = evaluateDomainColoringMappedTransform(profile, point.re, point.im, 'algebraic_chaining');

            if (mode === 'zero_seed') {
                assert.equal(Number.isFinite(directExpression.re) || Number.isFinite(directExpression.im), false);
                assert.equal(Number.isFinite(equivalentExpression.re) || Number.isFinite(equivalentExpression.im), false);
            } else {
                approxComplex(directExpression, equivalentExpression, 1e-12);
            }
        }
    } finally {
        restoreState(before);
    }
});
