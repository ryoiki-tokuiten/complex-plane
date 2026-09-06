import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/store/state.js';
import { nativeMapOptions, compileDomainProgram } from '../js/native/complex-engine.js';
import { ReferencePool } from '../js/rendering/domain/reference-pool.js';

function makeSnapshot(overrides = {}) {
    return {
        ...nativeMapOptions(state, { functionKey: 'polynomial', chainingEnabled: false, polynomialN: 1, polynomialCoeffs: [{ re: 0, im: 0 }, { re: 1, im: 0 }], ...overrides }),
        orbitColoringMode: 'value', paletteStops: [[1,0,0],[0,1,0],[1,0,0]],
        style: { brightness: 1, contrast: 1, saturation: 1, lightnessCycles: 1 },
        viewport: { width: 100, height: 100, centerRe: '0', centerIm: '0', xSpan: '2', ySpan: '2', precisionBits: 128 },
        ...overrides
    };
}

test('ReferencePool initializes and handles single-site evaluation correctly', async () => {
    const pool = new ReferencePool();
    const snapshot = makeSnapshot();
    const program = compileDomainProgram(snapshot);
    try {
        const sites = [{ x: 50, y: 50, sample: 0 }];
        const result = await pool.evaluate(program, snapshot, sites, {
            precision: 128,
            terms: 16,
            chainCount: 1
        });
        assert.equal(result.count, 1);
        assert.equal(result.headers.length, 52);
        assert.equal(result.headers[48], 50);
        assert.equal(result.headers[49], 50);
        assert.ok(result.stride > 0);
        assert.equal(result.steps.length, 1 * 1 * result.stride);
        assert.ok(result.steps.every(Number.isFinite));
    } finally {
        program.dispose();
        pool.dispose();
    }
});

test('ReferencePool evaluates multiple distributed sites in order', async () => {
    const pool = new ReferencePool();
    const snapshot = makeSnapshot();
    const program = compileDomainProgram(snapshot);
    try {
        const sites = [
            { x: 50, y: 50, sample: 0 },
            { x: 25, y: 25, sample: 1 },
            { x: 75, y: 25, sample: 2 },
            { x: 25, y: 75, sample: 3 },
            { x: 75, y: 75, sample: 4 }
        ];
        const result = await pool.evaluate(program, snapshot, sites, {
            precision: 128,
            terms: 16,
            chainCount: 2
        });
        assert.equal(result.count, 5);
        assert.equal(result.headers.length, 5 * 52);
        for (let i = 0; i < 5; i++) {
            assert.equal(result.headers[i * 52 + 48], sites[i].x);
            assert.equal(result.headers[i * 52 + 49], sites[i].y);
        }
        assert.equal(result.steps.length, 5 * 2 * result.stride);
        assert.ok(result.steps.every(Number.isFinite));
    } finally {
        program.dispose();
        pool.dispose();
    }
});

test('ReferencePool handles empty site array gracefully', async () => {
    const pool = new ReferencePool();
    const snapshot = makeSnapshot();
    const program = compileDomainProgram(snapshot);
    try {
        const result = await pool.evaluate(program, snapshot, [], {
            precision: 128,
            terms: 16,
            chainCount: 1
        });
        assert.equal(result.count, 0);
        assert.equal(result.headers.length, 0);
        assert.equal(result.steps.length, 0);
    } finally {
        program.dispose();
        pool.dispose();
    }
});
