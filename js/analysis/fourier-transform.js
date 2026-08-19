import { state } from '../store/state.js';
import {
    buildNativeFourierWinding,
    computeNativeFourierSpectrum,
    generateNativeFourierSignal
} from '../native/complex-engine.js';

/**
 * Generate time domain signal using native C signal generator
 */
export function generateTimeDomainSignal(funcType, frequency, amplitude, timeWindow, samples) {
    const count = Math.max(1, Math.floor(Number(samples) || 128));
    const freq = Number(frequency) || 0;
    const amp = Number(amplitude) || 0;
    const win = Number(timeWindow) > 0 ? Number(timeWindow) : 1;
    return generateNativeFourierSignal(funcType, freq, amp, win, count, Math.floor(Math.random() * 0x7fffffff));
}

/**
 * Compute Discrete Fourier Transform (DFT) / Spectrum using native C FFT
 */
export function computeDFT(signal) {
    if (!Array.isArray(signal) || signal.length === 0) return [];
    const values = signal.map(sample => Number(sample?.value) || 0);
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

    const windingFrequency = Number.isFinite(options.windingFrequency)
        ? Math.max(0, options.windingFrequency)
        : Math.max(0, state.fourierWindingFrequency || 1);
    const progress = Number.isFinite(options.progress)
        ? Math.max(0, Math.min(1, options.progress))
        : Math.max(0, Math.min(1, state.fourierWindingTime || 0));
    const timeWindow = Number.isFinite(options.timeWindow)
        ? Math.max(Number.EPSILON, options.timeWindow)
        : Math.max(Number.EPSILON, state.fourierTimeWindow || signal.at(-1)?.t || 1);

    return buildNativeFourierWinding(signal, windingFrequency, progress, timeWindow);
}

/**
 * Update Fourier transform calculations
 */
export function updateFourierTransform() {
    if (!state.fourierModeEnabled) return;
    
    const funcType = state.fourierFunction || 'sine';
    const frequency = state.fourierFrequency || 1.0;
    const amplitude = state.fourierAmplitude || 1.0;
    const timeWindow = state.fourierTimeWindow || 4.0;
    const samples = state.fourierSamples || 128;
    
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

