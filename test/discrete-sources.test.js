import test from 'node:test';
import assert from 'node:assert/strict';

import {
    generateDiscreteSource,
    parseCustomPointText
} from '../js/analysis/discrete-sources.js';

const values = config => generateDiscreteSource(config).records.map(record => record.domainValue);
const realValues = config => values(config).map(value => value.re);

test('integer sources preserve explicit and symmetric ordering', () => {
    assert.deepEqual(
        realValues({ kind: 'integers', count: 5, start: -3, step: 2, ordering: 'ascending' }),
        [-3, -1, 1, 3, 5]
    );
    assert.deepEqual(
        realValues({ kind: 'integers', count: 7, start: 1, step: 1, ordering: 'symmetric', includeZero: true }),
        [0, 1, -1, 2, -2, 3, -3]
    );
});

test('arithmetic, geometric, and harmonic progressions follow their general terms', () => {
    assert.deepEqual(
        generateDiscreteSource({ kind: 'arithmetic', count: 5, start: 3, step: -2 })
            .records.map(record => record.domainValue.re),
        [3, 1, -1, -3, -5]
    );
    assert.deepEqual(
        realValues({ kind: 'geometric', count: 5, start: 2, ratio: -3 }),
        [2, -6, 18, -54, 162]
    );
    assert.deepEqual(
        realValues({ kind: 'harmonic', count: 4, start: 2, step: 2 }),
        [1 / 2, 1 / 4, 1 / 6, 1 / 8]
    );
});

test('progressions omit undefined and overflowing values with diagnostics', () => {
    const harmonic = generateDiscreteSource({
        kind: 'harmonic',
        count: 3,
        start: 0,
        step: 1
    });
    assert.deepEqual(
        harmonic.records.map(record => record.domainValue.re),
        [1, 1 / 2]
    );
    assert.match(harmonic.diagnostics.join(' '), /undefined/);

    const geometric = generateDiscreteSource({
        kind: 'geometric',
        count: 4,
        start: 1e308,
        ratio: 10
    });
    assert.equal(geometric.records.length, 1);
    assert.match(geometric.diagnostics.join(' '), /numeric range/);
});

test('prime generation matches known values and bounded ranges', () => {
    assert.deepEqual(
        generateDiscreteSource({ kind: 'primes', count: 4, min: 10, max: 30 })
            .records.map(record => record.domainValue.re),
        [11, 13, 17, 19]
    );
    assert.deepEqual(
        generateDiscreteSource({ kind: 'primes', count: 3, min: 100000 })
            .records.map(record => record.domainValue.re),
        [100003, 100019, 100043]
    );
    const inverted = generateDiscreteSource({ kind: 'primes', count: 3, min: 20, max: 10 });
    assert.equal(inverted.records.length, 0);
    assert.match(inverted.diagnostics.join(' '), /contains 0 values/);
});

test('Gaussian-prime generation follows the exact axis and norm criteria', () => {
    const generated = new Set(values({
        kind: 'gaussian_primes', count: 80, bound: 12,
        associatePolicy: 'all', includeConjugates: true
    }).map(value => `${value.re},${value.im}`));
    for (const prime of ['1,1', '2,1', '3,0', '7,0']) assert.equal(generated.has(prime), true);
    for (const composite of ['5,0', '2,2', '0,0']) assert.equal(generated.has(composite), false);
});

test('Gaussian-prime ordering and associate policies are deterministic', () => {
    const all = values({
        kind: 'gaussian_primes', count: 12,
        bound: 6,
        associatePolicy: 'all',
        includeConjugates: true
    });
    assert.deepEqual(all.slice(0, 4), [
        { re: -1, im: -1 },
        { re: 1, im: -1 },
        { re: 1, im: 1 },
        { re: -1, im: 1 }
    ]);

    const representatives = values({
        kind: 'gaussian_primes', count: 20,
        bound: 8,
        associatePolicy: 'representatives',
        includeConjugates: false
    });
    assert.ok(representatives.every(value => value.re > 0 && value.im >= 0));
});

test('Gaussian searches expand automatically to satisfy large requested counts', () => {
    const generated = generateDiscreteSource({
        kind: 'gaussian_primes',
        count: 1200,
        bound: 12,
        boundType: 'norm',
        associatePolicy: 'all',
        includeConjugates: true
    });

    assert.equal(generated.records.length, 1200);
    assert.deepEqual(generated.diagnostics, []);
});

test('custom point text accepts Cartesian pairs and conventional complex notation', () => {
    assert.deepEqual(parseCustomPointText('1,2; 3-4i; i; -i; 5'), [
        { re: 1, im: 2 },
        { re: 3, im: -4 },
        { re: 0, im: 1 },
        { re: 0, im: -1 },
        { re: 5, im: 0 }
    ]);
});

test('generated sequences support complex formulas and filters with safety diagnostics', () => {
    const generated = generateDiscreteSource({
        kind: 'expression',
        count: 4,
        generatorExpression: 'j + i*j',
        filterExpression: 'gcd(j, 2) == 1',
        maxAttempts: 20,
        timeBudgetMs: 100
    });
    assert.deepEqual(
        generated.records.map(record => record.domainValue),
        [
            { re: 1, im: 1 },
            { re: 3, im: 3 },
            { re: 5, im: 5 },
            { re: 7, im: 7 }
        ]
    );

    const exhausted = generateDiscreteSource({
        kind: 'expression',
        count: 3,
        generatorExpression: 'j',
        filterExpression: 'false',
        maxAttempts: 5,
        timeBudgetMs: 100
    });
    assert.equal(exhausted.records.length, 0);
    assert.ok(exhausted.diagnostics.length > 0);

    const recoverable = generateDiscreteSource({
        kind: 'expression',
        count: 3,
        generatorExpression: '1 / j',
        maxAttempts: 10,
        timeBudgetMs: 100
    });
    assert.deepEqual(
        recoverable.records.map(record => record.domainValue.re),
        [1, 1 / 2, 1 / 3]
    );
    assert.match(recoverable.diagnostics.join(' '), /Division by zero/);
});
