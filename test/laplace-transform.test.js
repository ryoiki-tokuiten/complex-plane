import test from 'node:test';
import assert from 'node:assert/strict';

import { buildNativeLaplaceWinding } from '../js/native/complex-engine.js';

test('native Laplace winding owns damping, rotation, integration, and animation cutoff', () => {
    const signal = [
        { t: 0, value: 1 },
        { t: 1, value: 1 },
        { t: 2, value: 1 }
    ];
    const frame = buildNativeLaplaceWinding(signal, Math.log(2), Math.PI / 2, 0.5);

    assert.equal(frame.points.length, 2);
    assert.ok(Math.abs(frame.points[0].real - 1) < 1e-12);
    assert.ok(Math.abs(frame.points[0].imag) < 1e-12);
    assert.ok(Math.abs(frame.points[1].real) < 1e-12);
    assert.ok(Math.abs(frame.points[1].imag + 0.5) < 1e-12);
    assert.deepEqual(Array.from(frame.weighted), [1, 0.5, 0.25]);
    assert.deepEqual(Array.from(frame.envelope), [1, 0.5, 0.25]);
    assert.ok(Math.abs(frame.integral.real - 1) < 1e-12);
    assert.ok(Math.abs(frame.integral.imag + 0.5) < 1e-12);
    assert.equal(frame.maxAmplitude, 1);
});

test('native Laplace winding rejects malformed samples instead of substituting zero', () => {
    assert.throws(
        () => buildNativeLaplaceWinding([{ t: 0, value: 1 }, { t: 1, value: NaN }], 0, 1, 1),
        /must be finite/
    );
});
