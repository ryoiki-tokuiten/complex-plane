import { state } from '../store/state.js';
import {
    buildNativeFourierWinding,
    computeNativeFourierSpectrum,
    generateNativeFourierSignal
} from '../native/complex-engine.js';
import { requireFiniteNumber, requireInteger } from '../utils/numeric-contracts.js';

/**
 * Generate time domain signal using native C signal generator
 */
export function generateTimeDomainSignal(funcType, frequency, amplitude, timeWindow, samples) {
    const count = requireInteger(samples, 'Fourier sample count');
    const freq = requireFiniteNumber(frequency, 'Fourier frequency');
    const amp = requireFiniteNumber(amplitude, 'Fourier amplitude');
    const win = requireFiniteNumber(timeWindow, 'Fourier time window');
    return generateNativeFourierSignal(funcType, freq, amp, win, count, Math.floor(Math.random() * 0x7fffffff));
}

/**
 * Compute Discrete Fourier Transform (DFT) / Spectrum using native C FFT
 */
export function computeDFT(signal) {
    if (!Array.isArray(signal) || signal.length === 0) return [];
    const values = signal.map((sample, index) =>
        requireFiniteNumber(sample?.value, `Fourier sample ${index}`));
    return computeNativeFourierSpectrum(values);
}

/**
 * Build the winding-domain geometry using native C winding job
 */
export function buildFourierWinding(signal, options = {}) {
    if (!Array.isArray(signal) || signal.length === 0) {
        return {
            points: [],
            centerOfMass: { re: 0, im: 0 },
            referenceRadius: 1,
            vectorStep: 1
        };
    }

    const windingFrequency = requireFiniteNumber(
        options.windingFrequency === undefined ? state.fourierWindingFrequency : options.windingFrequency,
        'Fourier winding frequency'
    );
    const progress = requireFiniteNumber(
        options.progress === undefined ? state.fourierWindingTime : options.progress,
        'Fourier winding progress'
    );
    const timeWindow = requireFiniteNumber(
        options.timeWindow === undefined ? state.fourierTimeWindow : options.timeWindow,
        'Fourier winding time window'
    );

    return buildNativeFourierWinding(signal, windingFrequency, progress, timeWindow);
}

/**
 * Update Fourier transform calculations
 */
export function updateFourierTransform() {
    if (!state.fourierModeEnabled) return;
    
    const funcType = state.fourierFunction;
    const frequency = state.fourierFrequency;
    const amplitude = state.fourierAmplitude;
    const timeWindow = state.fourierTimeWindow;
    const samples = state.fourierSamples;
    
    state.fourierTimeDomainSignal = generateTimeDomainSignal(
        funcType,
        frequency,
        amplitude,
        timeWindow,
        samples
    );
    
    if (state.fourierTimeDomainSignal && state.fourierTimeDomainSignal.length > 0) {
        state.fourierDFTResult = computeDFT(state.fourierTimeDomainSignal);
    } else {
        state.fourierDFTResult = [];
    }
}
