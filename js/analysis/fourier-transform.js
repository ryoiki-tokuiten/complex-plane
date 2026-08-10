import { state } from '../store/state.js';

// Fourier Transform Analysis Module
// Handles time domain signal generation and Fourier transform calculations

/**
 * Generate time domain signal
 * @param {string} funcType - Type of signal function
 * @param {number} frequency - Frequency in Hz
 * @param {number} amplitude - Signal amplitude
 * @param {number} timeWindow - Time window in seconds
 * @param {number} samples - Number of samples
 * @returns {Array} Array of {t, value} objects
 */
export function generateTimeDomainSignal(funcType, frequency, amplitude, timeWindow, samples) {
    const signal = [];
    const dt = timeWindow / samples;
    const omega = 2 * Math.PI * frequency;
    
    for (let i = 0; i < samples; i++) {
        const t = i * dt;
        let value = 0;
        
        switch(funcType) {
            // Basic waves
            case 'sine':
                value = amplitude * Math.sin(omega * t);
                break;
            case 'cosine':
                value = amplitude * Math.cos(omega * t);
                break;
            case 'square':
                value = amplitude * Math.sign(Math.sin(omega * t));
                break;
            case 'sawtooth':
                value = amplitude * (2 * ((omega * t / (2 * Math.PI)) % 1) - 1);
                break;
            case 'triangle': {
                const phase = (omega * t / (2 * Math.PI)) % 1;
                value = amplitude * (4 * Math.abs(phase - 0.5) - 1);
                break;
            }
            
            // Modulated signals
            case 'am': { // Amplitude Modulation
                const carrier = omega;
                const modulation = omega / 4;
                value = amplitude * (1 + 0.5 * Math.sin(modulation * t)) * Math.sin(carrier * t);
                break;
            }
            case 'fm': { // Frequency Modulation
                const modulationIndex = 2;
                const modFreq = omega / 5;
                value = amplitude * Math.sin(omega * t + modulationIndex * Math.sin(modFreq * t));
                break;
            }
            case 'chirp': { // Frequency Sweep
                const startFreq = omega;
                const endFreq = omega * 3;
                const instantFreq = startFreq + (endFreq - startFreq) * (t / timeWindow);
                value = amplitude * Math.sin(instantFreq * t);
                break;
            }
            
            // Transient signals
            case 'damped_sine': { // Damped sine
                const dampingFactor = 1.5 / timeWindow;
                value = amplitude * Math.exp(-dampingFactor * t) * Math.sin(omega * t);
                break;
            }
            case 'exponential': { // Exponential decay
                const decayRate = 2 / timeWindow;
                value = amplitude * Math.exp(-decayRate * t);
                break;
            }
            case 'gaussian': { // Gaussian pulse
                const sigma = timeWindow / 8;
                const center = timeWindow / 2;
                value = amplitude * Math.exp(-Math.pow(t - center, 2) / (2 * sigma * sigma));
                break;
            }
            case 'pulse': { // Rectangular pulse
                const pulseStart = timeWindow * 0.3;
                const pulseEnd = timeWindow * 0.7;
                value = (t >= pulseStart && t <= pulseEnd) ? amplitude : 0;
                break;
            }
            
            // Complex waveforms
            case 'harmonics': { // Harmonic series
                value = 0;
                for (let h = 1; h <= 5; h++) {
                    value += (amplitude / h) * Math.sin(h * omega * t);
                }
                break;
            }
            case 'beat': { // Beat frequency
                const freq1 = omega;
                const freq2 = omega * 1.1;
                value = amplitude * 0.5 * (Math.sin(freq1 * t) + Math.sin(freq2 * t));
                break;
            }
            case 'noise': // White noise
                value = amplitude * (2 * Math.random() - 1);
                break;
                
            default:
                value = amplitude * Math.sin(omega * t);
        }
        
        signal.push({ t, value });
    }
    
    return signal;
}

/**
 * Custom Fast Fourier Transform (Cooley-Tukey)
 * @param {Array} real - Array of real values
 * @returns {Array} Array of {re, im} complex objects
 */
function customFFT(real) {
    const N = real.length;
    if (N <= 1) return [{ re: real[0] || 0, im: 0 }];

    // Pad to next power of 2
    let n2 = 1;
    while (n2 < N) n2 *= 2;
    
    const re = new Array(n2).fill(0);
    const im = new Array(n2).fill(0);
    for (let i = 0; i < N; i++) {
        re[i] = real[i];
    }
    
    // Bit reversal
    let j = 0;
    for (let i = 0; i < n2 - 1; i++) {
        if (i < j) {
            let temp = re[i]; re[i] = re[j]; re[j] = temp;
            temp = im[i]; im[i] = im[j]; im[j] = temp;
        }
        let k = n2 >> 1;
        while (k <= j) { j -= k; k >>= 1; }
        j += k;
    }

    // Cooley-Tukey
    for (let size = 2; size <= n2; size *= 2) {
        const half = size / 2;
        const angle = -2 * Math.PI / size;
        const wRe = Math.cos(angle);
        const wIm = Math.sin(angle);

        for (let i = 0; i < n2; i += size) {
            let uRe = 1;
            let uIm = 0;
            for (let k = 0; k < half; k++) {
                const evenRe = re[i + k];
                const evenIm = im[i + k];
                const oddRe = re[i + k + half];
                const oddIm = im[i + k + half];

                const tRe = uRe * oddRe - uIm * oddIm;
                const tIm = uRe * oddIm + uIm * oddRe;

                re[i + k] = evenRe + tRe;
                im[i + k] = evenIm + tIm;
                re[i + k + half] = evenRe - tRe;
                im[i + k + half] = evenIm - tIm;

                const nextURe = uRe * wRe - uIm * wIm;
                uIm = uRe * wIm + uIm * wRe;
                uRe = nextURe;
            }
        }
    }
    
    const result = new Array(N);
    for (let i = 0; i < N; i++) {
        result[i] = { re: re[i], im: im[i] };
    }
    return result;
}

/**
 * Compute Discrete Fourier Transform (DFT)
 * @param {Array} signal - Array of time domain values
 * @returns {Array} Array of {frequency, real, imag, magnitude, phase} objects
 */
export function computeDFT(signal) {
    if (!signal || signal.length === 0) return [];
    
    // Extract real values
    const values = signal.map(s => s.value);
    
    // Perform FFT using custom implementation
    const fftResult = customFFT(values);
    
    const N = signal.length;
    const dft = [];
    
    for (let k = 0; k < fftResult.length; k++) {
        const comp = fftResult[k];
        
        // Normalize by N
        const real = (comp.re || 0) / N;
        const imag = (comp.im || 0) / N;
        
        const magnitude = Math.sqrt(real * real + imag * imag);
        const phase = Math.atan2(imag, real);
        
        // Frequency in Hz (assuming sample rate matches time window)
        const frequency = k;
        
        dft.push({
            k: k,
            frequency: frequency,
            real: real,
            imag: imag,
            magnitude: magnitude,
            phase: phase
        });
    }
    
    return dft;
}

/**
 * Build the winding-domain geometry shared by the canvas and graph renderers.
 * The caller supplies any real signal; graph mode uses mapped Re/Im samples
 * while standalone Fourier mode uses the generated waveform.
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
    const cutoff = progress * timeWindow;
    const points = [];
    let centerRe = 0;
    let centerIm = 0;
    let maxAmplitude = 0;

    for (let index = 0; index < signal.length; index += 1) {
        const sample = signal[index];
        const t = Number(sample?.t);
        const value = Number(sample?.value);
        if (!Number.isFinite(t) || !Number.isFinite(value)) continue;
        maxAmplitude = Math.max(maxAmplitude, Math.abs(value));
        if (t > cutoff) continue;

        const angle = -2 * Math.PI * windingFrequency * t;
        const re = value * Math.cos(angle);
        const im = value * Math.sin(angle);
        points.push({ re, im, t, value });
        centerRe += re;
        centerIm += im;
    }

    if (points.length > 0) {
        centerRe /= points.length;
        centerIm /= points.length;
    }

    return {
        points,
        centerOfMass: { re: centerRe, im: centerIm },
        referenceRadius: Math.max(Number.EPSILON, maxAmplitude * 1.1),
        vectorStep: Math.max(1, Math.floor(points.length / 50))
    };
}

/**
 * Update Fourier transform calculations
 * Called when parameters change or when entering Fourier mode
 */
export function updateFourierTransform() {
    if (!state.fourierModeEnabled) return;
    
    // Ensure all Fourier parameters have valid values
    const funcType = state.fourierFunction || 'sine';
    const frequency = state.fourierFrequency || 1.0;
    const amplitude = state.fourierAmplitude || 1.0;
    const timeWindow = state.fourierTimeWindow || 4.0;
    const samples = state.fourierSamples || 128;
    
    // Generate time domain signal
    state.fourierTimeDomainSignal = generateTimeDomainSignal(
        funcType,
        frequency,
        amplitude,
        timeWindow,
        samples
    );
    
    // Compute DFT
    if (state.fourierTimeDomainSignal && state.fourierTimeDomainSignal.length > 0) {
        state.fourierDFTResult = computeDFT(state.fourierTimeDomainSignal);
    } else {
        console.error('Failed to generate time domain signal');
        state.fourierDFTResult = [];
    }
}
