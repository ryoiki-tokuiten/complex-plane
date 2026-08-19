import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFourierWinding } from '../js/analysis/fourier-transform.js';

const TOLERANCE = 1e-12;

function assertClose(actual, expected, message) {
    assert.ok(
        Math.abs(actual - expected) <= TOLERANCE,
        `${message}: expected ${expected}, received ${actual}`
    );
}

function assertWindingPoint(actual, expected, message) {
    assert.equal(actual.t, expected.t, `${message} time`);
    assert.equal(actual.value, expected.value, `${message} value`);
    assertClose(actual.re, expected.re, `${message} real component`);
    assertClose(actual.im, expected.im, `${message} imaginary component`);
}

test('Fourier winding computes wound points and center of mass', () => {
    const signal = [
        { t: 0, value: 2 },
        { t: 0.25, value: 2 },
        { t: 0.5, value: 2 },
        { t: 0.75, value: 2 }
    ];

    const winding = buildFourierWinding(signal, {
        windingFrequency: 1,
        progress: 1,
        timeWindow: 1
    });

    assert.equal(winding.points.length, 4);
    assert.deepEqual(
        winding.points.map(({ t, value }) => ({ t, value })),
        signal
    );

    const expectedPoints = [
        { re: 2, im: 0 },
        { re: 0, im: -2 },
        { re: -2, im: 0 },
        { re: 0, im: 2 }
    ];
    winding.points.forEach((point, index) => {
        assertClose(point.re, expectedPoints[index].re, `point ${index} real component`);
        assertClose(point.im, expectedPoints[index].im, `point ${index} imaginary component`);
    });
    assertClose(winding.centerOfMass.re, 0, 'center-of-mass real component');
    assertClose(winding.centerOfMass.im, 0, 'center-of-mass imaginary component');
    assertClose(winding.referenceRadius, 2.2, 'reference radius');
});

test('Fourier winding keeps zero progress at the initial sample', () => {
    const winding = buildFourierWinding([
        { t: 0, value: 3 },
        { t: 0.5, value: 4 }
    ], {
        windingFrequency: 1,
        progress: 0,
        timeWindow: 1
    });

    assert.equal(winding.points.length, 1);
    assertWindingPoint(winding.points[0], { re: 3, im: 0, t: 0, value: 3 }, 'initial point');
    assertClose(winding.centerOfMass.re, 3, 'zero-progress center-of-mass real component');
    assertClose(winding.centerOfMass.im, 0, 'zero-progress center-of-mass imaginary component');
    assertClose(winding.referenceRadius, 4.4, 'zero-progress reference radius');
});

test('Fourier winding includes samples through the partial-progress cutoff', () => {
    const winding = buildFourierWinding([
        { t: 0, value: 1 },
        { t: 0.25, value: 2 },
        { t: 0.5, value: 3 },
        { t: 0.75, value: 8 }
    ], {
        windingFrequency: 0,
        progress: 0.5,
        timeWindow: 1
    });

    const expectedPoints = [
        { re: 1, im: 0, t: 0, value: 1 },
        { re: 2, im: 0, t: 0.25, value: 2 },
        { re: 3, im: 0, t: 0.5, value: 3 }
    ];
    assert.equal(winding.points.length, expectedPoints.length);
    winding.points.forEach((point, index) => {
        assertWindingPoint(point, expectedPoints[index], `partial point ${index}`);
    });
    assertClose(winding.centerOfMass.re, 2, 'partial center-of-mass real component');
    assertClose(winding.centerOfMass.im, 0, 'partial center-of-mass imaginary component');
    assertClose(winding.referenceRadius, 8.8, 'partial-progress reference radius');
});

test('generateTimeDomainSignal generates signals natively', async () => {
    const { generateTimeDomainSignal } = await import('../js/analysis/fourier-transform.js');
    const sineSignal = generateTimeDomainSignal('sine', 1, 2, 1, 4);
    assert.equal(sineSignal.length, 4);
    assertClose(sineSignal[0].value, 0, 'sine sample 0');
    assertClose(sineSignal[1].value, 2, 'sine sample 1');
    assertClose(sineSignal[2].value, 0, 'sine sample 2');
    assertClose(sineSignal[3].value, -2, 'sine sample 3');
});

test('computeDFT computes spectrum natively', async () => {
    const { computeDFT } = await import('../js/analysis/fourier-transform.js');
    const signal = [{ value: 1 }, { value: 0 }, { value: -1 }, { value: 0 }];
    const spectrum = computeDFT(signal);
    assert.equal(spectrum.length, 4);
    assert.equal(spectrum[0].k, 0);
    assertClose(spectrum[0].real, 0, 'DC real');
    assertClose(spectrum[1].real, 0.5, 'fundamental real');
    assertClose(spectrum[1].imag, 0, 'fundamental imag');
});

