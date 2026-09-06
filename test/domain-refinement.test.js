import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainRefinement } from '../js/rendering/domain/refinement.js';

const offsets = [[-.375, -.125], [.125, -.375], [.375, .125], [-.125, .375]];
function key(sample, width) {
    const pixel = Math.floor(sample / 4), [x, y] = offsets[sample % 4];
    return `${pixel % width + x},${Math.floor(pixel / width) + y}`;
}

test('refinement clusters pending samples by pixel without repeated centers or premature precision escalation', () => {
    const plan = new DomainRefinement(16, 6, 256);
    let pending = Array.from({ length: 384 }, (_, i) => i);
    const visited = new Set();
    const coveredSamples = new Set();
    let rounds = 0;
    while (pending.length) {
        const sites = plan.next(pending);
        const chosen = new Set(sites.map(({ x, y }) => `${x},${y}`));
        assert.equal(sites.length, 32);
        for (const point of chosen) { assert.ok(!visited.has(point)); visited.add(point); }
        for (const sample of sites.activeSamples) { coveredSamples.add(sample); }
        pending = pending.filter(sample => !coveredSamples.has(sample));
        rounds++;
    }
    assert.equal(rounds, 3);
    assert.equal(visited.size, 96);
    assert.equal(coveredSamples.size, 384);
    assert.equal(plan.precision, 256, 'coverage progress does not unnecessarily raise precision');
    assert.deepEqual(plan.next(pending), []);
});

test('stalled samples receive higher effort and eventually fail explicitly at numerical limits', () => {
    const plan = new DomainRefinement(1, 1, 4096);
    const pending = new Uint32Array([2]);
    assert.equal(plan.next(pending).length, 1);
    assert.equal(plan.precision, 4096);
    assert.equal(plan.next(pending).length, 1);
    assert.equal(plan.precision, 8192);
    assert.equal(plan.terms, 32);
    assert.equal(plan.next(pending).length, 1);
    assert.equal(plan.precision, 16384);
    assert.equal(plan.terms, 64);
    assert.throws(() => plan.next(pending), /Cannot certify 1 domain samples.*16384-bit/);
});

test('reference coverage and precision escalation belong to a single viewport job', () => {
    const old = new DomainRefinement(8, 8, 256);
    old.next([20]); old.next([20]);
    const next = new DomainRefinement(8, 8, 256);
    assert.equal(next.precision, 256);
    assert.deepEqual(next.next([20]), old.next([20]));
    assert.equal(next.precision, 256);
});
