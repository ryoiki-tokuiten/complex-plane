import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildNativeLaplaceSurface,
    buildNativeLaplaceWinding
} from '../js/native/complex-engine.js';
import {
    buildLaplaceSurfaceGeometry,
    buildLaplaceWinding,
    computeCenterOfMassFrequencySweep,
    computeLaplaceSpectrum,
    generateLaplaceSignal
} from '../js/analysis/laplace-transform.js';

const TOLERANCE = 1e-12;

function assertClose(actual, expected, message) {
    assert.ok(
        Math.abs(actual - expected) <= TOLERANCE,
        `${message}: expected ${expected}, received ${actual}`
    );
}

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

test('Laplace winding at sigma zero is the Fourier winding slice', () => {
    const signal = [
        { t: 0, value: 2 },
        { t: 0.25, value: 2 },
        { t: 0.5, value: 2 },
        { t: 0.75, value: 2 }
    ];
    const winding = buildLaplaceWinding(signal, {
        sigma: 0,
        omega: 2 * Math.PI,
        progress: 1
    });

    assert.deepEqual(winding.points.map(({ t }) => t), signal.map(({ t }) => t));
    const expectedPoints = [
        { real: 2, imag: 0 },
        { real: 0, imag: -2 },
        { real: -2, imag: 0 },
        { real: 0, imag: 2 }
    ];
    winding.points.forEach((point, index) => {
        assertClose(point.real, expectedPoints[index].real, `point ${index} real component`);
        assertClose(point.imag, expectedPoints[index].imag, `point ${index} imaginary component`);
    });
    assertClose(winding.integral.real, 0, 'Fourier slice integral real component');
    assertClose(winding.integral.imag, 0, 'Fourier slice integral imaginary component');
    assert.equal(winding.sigma, 0);
    assert.equal(winding.omega, 2 * Math.PI);
});

test('Laplace transform hub generates rich signals and computes their discrete spectrum', () => {
    const sineSignal = generateLaplaceSignal('sine', 1, 2, 1, 4);
    assert.equal(sineSignal.length, 4);
    assertClose(sineSignal[0].value, 0, 'sine sample 0');
    assertClose(sineSignal[1].value, 2, 'sine sample 1');
    assertClose(sineSignal[2].value, 0, 'sine sample 2');
    assertClose(sineSignal[3].value, -2, 'sine sample 3');

    const spectrum = computeLaplaceSpectrum([
        { t: 0, value: 1 }, { t: 0.25, value: 0 },
        { t: 0.5, value: -1 }, { t: 0.75, value: 0 }
    ]);
    assert.equal(spectrum.length, 4);
    assert.equal(spectrum[0].k, 0);
    assertClose(spectrum[0].real, 0, 'DC real');
    assertClose(spectrum[1].real, 0.5, 'fundamental real');
    assertClose(spectrum[1].imag, 0, 'fundamental imaginary');
});

test('Laplace surface geometry exposes shared-renderer scalar fields', () => {
    const specification = {
        functionKey: 'exponential',
        frequency: 2,
        damping: 0.5,
        amplitude: 1,
        sigmaRange: [-2, 2],
        omegaRange: [-4, 4],
        sigmaSteps: 4,
        omegaSteps: 3
    };
    const nativeSurface = buildNativeLaplaceSurface(specification, {
        mode: 'magnitude',
        clipHeight: 10
    });
    const geometry = buildLaplaceSurfaceGeometry({ ...specification, sampled: false }, {
        mode: 'phase',
        clipHeight: 10,
        palette: 'viridis'
    });

    assert.equal(nativeSurface.positions.length, 5 * 4 * 3);
    assert.equal(nativeSurface.magnitudeValues.length, 5 * 4);
    assert.equal(nativeSurface.phaseValues.length, 5 * 4);
    assert.ok(nativeSurface.magnitudeValues.every(Number.isFinite));
    assert.ok(nativeSurface.phaseValues.every(Number.isFinite));
    assert.equal(geometry.colors.length, geometry.positions.length);
    assert.equal(geometry.contourValues.length, geometry.positions.length / 3);
    assert.ok(geometry.colors.every(Number.isFinite));
});

test('computeCenterOfMassFrequencySweep identifies peak frequency correctly for sinusoidal signal', () => {
    // Generate a 2 Hz cosine wave over 4 seconds
    const N = 256;
    const duration = 4.0;
    const freq = 2.0;
    const signal = Array.from({ length: N }, (_, i) => {
        const t = (i / (N - 1)) * duration;
        return { t, value: Math.cos(2 * Math.PI * freq * t) };
    });

    const sweep = computeCenterOfMassFrequencySweep(signal, {
        sigma: 0,
        minFreq: 0,
        maxFreq: 5,
        steps: 100
    });

    assert.ok(sweep.length > 0);
    // Find frequency at maximum real part (X-coordinate of COM)
    let maxReal = -Infinity;
    let peakFreq = 0;
    sweep.forEach(pt => {
        if (pt.real > maxReal) {
            maxReal = pt.real;
            peakFreq = pt.freq;
        }
    });

    assert.ok(Math.abs(peakFreq - 2.0) <= 0.1, `Expected peak near 2.0 Hz, got ${peakFreq}`);
    assert.ok(maxReal > 0.4, `Expected strong COM peak at resonant frequency, got ${maxReal}`);
});

test('computeCenterOfMassFrequencySweep supports composite signal with dual peaks', () => {
    // Composite: 2 Hz + 3 Hz
    const N = 256;
    const duration = 4.0;
    const signal = Array.from({ length: N }, (_, i) => {
        const t = (i / (N - 1)) * duration;
        return { t, value: Math.cos(2 * Math.PI * 2 * t) + Math.cos(2 * Math.PI * 3 * t) };
    });

    const sweep = computeCenterOfMassFrequencySweep(signal, {
        sigma: 0,
        minFreq: 0,
        maxFreq: 5,
        steps: 200
    });

    // Find local peaks
    const peaks = [];
    for (let i = 1; i < sweep.length - 1; i++) {
        if (sweep[i].real > sweep[i - 1].real && sweep[i].real > sweep[i + 1].real && sweep[i].real > 0.3) {
            peaks.push(sweep[i].freq);
        }
    }

    assert.ok(peaks.some(f => Math.abs(f - 2.0) <= 0.15), 'Expected peak near 2 Hz');
    assert.ok(peaks.some(f => Math.abs(f - 3.0) <= 0.15), 'Expected peak near 3 Hz');
});

