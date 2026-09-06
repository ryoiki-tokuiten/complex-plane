import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/store/state.js';
import { nativeMapOptions, compileDomainProgram } from '../js/native/complex-engine.js';
import { domainLayout, domainRegisters } from '../js/rendering/domain/program.js';

function snapshot(overrides = {}) {
    return {
        ...nativeMapOptions(state, { functionKey: 'polynomial', chainingEnabled: false, polynomialN: 1, polynomialCoeffs: [{ re: 0, im: 0 }, { re: 1, im: 0 }], ...overrides }),
        orbitColoringMode: 'value', paletteStops: [[1,0,0],[0,1,0],[1,0,0]],
        style: { brightness: 1, contrast: 1, saturation: 1, lightnessCycles: 1 },
        viewport: { width: 4, height: 4, centerRe: '0', centerIm: '0', xSpan: '2', ySpan: '2', precisionBits: 256 },
        ...overrides
    };
}
function number(data, offset) {
    return (data[offset] + data[offset + 4]) * 2 ** data[offset + 2];
}

test('C domain compilation removes unused operations and uses one graph for direct and chained maps', () => {
    const a = compileDomainProgram(snapshot());
    const b = compileDomainProgram(snapshot({ chainingEnabled: true, chainCount: 900, chainMode: 'recursion' }));
    try {
        assert.deepEqual(a.nodes, b.nodes);
        assert.equal(a.nodes.length, 8); // identity needs only z and c inputs
        assert.equal(a.output, 0);
        assert.equal(a.chainCount, 1); assert.equal(b.chainCount, 900);
    } finally { a.dispose(); b.dispose(); }
});

test('reference export retains sub-double coordinate residuals and deep sample steps', () => {
    const p = compileDomainProgram(snapshot({ viewport: { width: 4, height: 4, centerRe: '1.00000000000000000000000000000000000000000000000000000000000000000000000000000001', centerIm: '0', xSpan: '4e-82', ySpan: '4e-82', precisionBits: 128 } }));
    try {
        assert.ok(p.minimumPrecision > 300);
        const r = p.reference({ x: 1.5, y: 1.5, precision: p.minimumPrecision, terms: 16 });
        try {
            const bs = 8;
            assert.ok(Math.abs(number(r.header, 2 * bs) / 1e-82 - 1) < 1e-7);
            assert.ok(r.header[3 * bs + 1] < 0);
            assert.equal(r.stride, domainLayout(p.nodes, 16).stride);
            assert.ok(r.next(16).every(Number.isFinite));
        } finally { r.dispose(); }
    } finally { p.dispose(); }
});

test('Arb references compute all registered functions without borrowing a CPU pixel renderer', () => {
    for (const functionKey of ['sin','cos','tan','sec','exp','ln','sinh','tanh','asin','atan','gamma','loggamma','bessel','power','mobius','zeta','polynomial']) {
        const s = snapshot({ functionKey, zetaContinuationEnabled: true, viewport: { width: 4, height: 4, centerRe: '1.25', centerIm: '0.5', xSpan: '0.01', ySpan: '0.01', precisionBits: 256 } });
        const p = compileDomainProgram(s);
        try {
            const r = p.reference({ x: 1.5, y: 1.5, precision: 256, terms: 16 });
            try {
                const data = r.next(1), { offsets } = domainLayout(p.nodes, 16);
                assert.ok(data.every(Number.isFinite), functionKey);
                assert.notEqual(data[offsets[p.output] + 2], 2000000, `${functionKey} reference must be finite`);
                assert.ok(data[offsets[p.output] + 3] >= 0);
            } finally { r.dispose(); }
        } finally { p.dispose(); }
    }
});

test('reference lifetimes are checked and disposal is idempotent', () => {
    const p = compileDomainProgram(snapshot());
    const r = p.reference({ x: 0, y: 0, precision: 256, terms: 16 });
    p.dispose(); p.dispose(); r.dispose();
    assert.throws(() => r.next(1), /disposed/);
    assert.throws(() => p.reference({}), /disposed/);
});

test('reference batching preserves the same orbit as a single request', () => {
    const p = compileDomainProgram(snapshot({ functionKey: 'cos', chainingEnabled: true, chainCount: 20, chainMode: 'recursion' }));
    const options = { x: 0, y: 0, precision: 256, terms: 16 };
    const a = p.reference(options), b = p.reference(options);
    try {
        const whole = a.next(20), first = b.next(7);
        const target = new Float32Array(13 * b.stride + 8).fill(-777);
        b.next(13, target, 4);
        assert.deepEqual(whole.subarray(0, first.length), first);
        assert.deepEqual(whole.subarray(first.length), target.subarray(4, -4));
        assert.ok(target.subarray(0, 4).every(value => value === -777));
        assert.ok(target.subarray(-4).every(value => value === -777));
    } finally { a.dispose(); b.dispose(); p.dispose(); }
});

test('SSA register reuse preserves shared operands and the final result', () => {
    // A long recurrence that repeatedly uses a shared constant. Only the current
    // value and that constant are live, irrespective of expression length.
    const nodes = [0,0,0,0, 1,0,0,0, 2,0,0,0];
    let previous = 0;
    for (let i = 3; i < 103; i++) { nodes.push(3, previous, 2, 0); previous = i; }
    const program = new Uint32Array(nodes), plan = domainRegisters(program, previous);
    assert.equal(plan.count, 2);
    const registers = [];
    for (let i = 0; i < program.length / 4; i++) {
        const [destination, a, b] = plan.instructions[i];
        const op = program[i * 4];
        registers[destination] = op === 0 ? 7 : op === 1 ? 0 : op === 2 ? 1 : registers[a] + registers[b];
    }
    assert.equal(registers[plan.output], 107);
});

test('packed state fits WebGL vertex inputs for every mode and derivative pair', () => {
    const nodes = new Uint32Array([0,0,0,0, 1,0,0,0]);
    for (const terms of [16, 32, 64]) {
        const value = domainLayout(nodes, terms, false);
        const attractor = domainLayout(nodes, terms, true);
        assert.equal(value.metadata, 8);
        assert.equal(value.state, 12);
        assert.equal(attractor.state, 24);
        assert.ok(value.state * 2 / 4 + 1 <= 16, 'includes the sample-ID attribute');
        assert.ok(value.state * 2 * 4 <= 255, 'paired attribute stride must satisfy WebGL limits');
        assert.ok(attractor.state / 4 + 1 <= 16);
        assert.ok(attractor.state * 4 <= 255);
        assert.equal(value.stride, attractor.stride, 'packing must not change the native reference layout');
    }
});

test('float reference export encloses rounding and keeps checkpoint differences below float spacing', () => {
    const p = compileDomainProgram(snapshot({ functionKey: 'cos', chainingEnabled: true, chainCount: 100, chainMode: 'recursion', viewport: { width: 4, height: 4, centerRe: '0.5', centerIm: '0', xSpan: '0.01', ySpan: '0.01', precisionBits: 256 } }));
    const r = p.reference({ x: 1.5, y: 1.5, precision: 256, terms: 16 });
    try {
        const data = r.next(64), remaining = r.next(36), layout = domainLayout(p.nodes, 16);
        const first = layout.offsets[p.output], expected = Math.cos(0.5);
        assert.ok(Math.abs(number(data, first) - expected) <= data[first + 3] * 2 ** data[first + 2] + Number.EPSILON);
        // At iteration 100 the Brent checkpoint is iteration 63. Both absolute
        // values round to the same float, but their C-computed difference survives.
        const anchor63 = data[62 * r.stride + first];
        const anchor100 = remaining[35 * r.stride + first];
        const change = number(remaining, 35 * r.stride + layout.checkpointOffset);
        assert.equal(anchor63, anchor100);
        assert.ok(Math.abs(change) > 0 && Math.abs(change) < 1e-6);
    } finally { r.dispose(); p.dispose(); }
});

test('reference recentering exports the origin shift without changing the sample trajectory', () => {
    const p = compileDomainProgram(snapshot({ chainingEnabled: true, chainCount: 4, polynomialCoeffs: [{ re: 3, im: 0 }, { re: 1, im: 0 }] }));
    const r = p.reference({ x: 1.5, y: 1.5, precision: 256, terms: 16 });
    try {
        const data = r.next(4), layout = domainLayout(p.nodes, 16);
        let delta = 0;
        for (let i = 0; i < 4; i++) {
            const at = i * layout.stride;
            assert.equal(number(data, at + layout.offsets[p.output]) + delta, 3 * (i + 1));
            delta += number(data, at + layout.transitionOffset);
        }
        assert.equal(delta, 12);
    } finally { r.dispose(); p.dispose(); }
});

test('division and dyadic scaling survive arbitrary expression compilation', () => {
    const p = compileDomainProgram(snapshot({
        functionKey: 'algebraic_chaining', algebraicChainingZExpr: '(-0.5*i*z)/(1+z)',
        algebraicChainingTerms: [{ coeff: { re: 1, im: 0 }, factors: [{ func: 'polynomial', power: 1 }] }],
        viewport: { width: 4, height: 4, centerRe: '1', centerIm: '1', xSpan: '0.01', ySpan: '0.01', precisionBits: 256 }
    }));
    const r = p.reference({ x: 1.5, y: 1.5, precision: 256, terms: 16 });
    try {
        assert.ok(p.nodes.some((op, i) => i % 4 === 0 && op === 15), 'retain quotient rather than inverse/product');
        assert.ok(p.nodes.some((op, i) => i % 4 === 0 && op === 14), 'exact rotation/scaling is independent of expression spelling');
        const data = r.next(1), offset = domainLayout(p.nodes, 16).offsets[p.output];
        assert.ok(Math.abs(number(data, offset) - 0.1) < 1e-14);
        assert.ok(Math.abs((data[offset + 1] + data[offset + 5]) * 2 ** data[offset + 2] + 0.3) < 1e-14);
    } finally { r.dispose(); p.dispose(); }
});

test('repeated reference origins reuse exact values across batch boundaries', () => {
    const p = compileDomainProgram(snapshot({ functionKey: 'cos', chainingEnabled: true, chainMode: 'recursion', chainCount: 900,
        viewport: { width: 4, height: 4, centerRe: '2', centerIm: '10', xSpan: '0.01', ySpan: '0.01', precisionBits: 256 } }));
    const options = { x: 1.5, y: 1.5, precision: 256, terms: 16 };
    const r = p.reference(options), independent = p.reference(options);
    try {
        const expected = independent.next(1);
        for (const count of [1, 64, 7]) {
            const data = r.next(count);
            for (let i = 0; i < count; i++) assert.deepEqual(data.subarray(i * r.stride, (i + 1) * r.stride), expected);
        }
    } finally { r.dispose(); independent.dispose(); p.dispose(); }
});

test('wide zero-centered viewports do not subtract the zero exponent sentinel', () => {
    const p = compileDomainProgram(snapshot({ viewport: { width: 864, height: 576, centerRe: '0', centerIm: '0', xSpan: '8000', ySpan: '6000', precisionBits: 256 } }));
    try { assert.equal(p.minimumPrecision, 128); } finally { p.dispose(); }
});
