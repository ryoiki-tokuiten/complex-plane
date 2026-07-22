import { state } from '../store/state.js';

// Laplace Transform Analysis Module
// Handles time domain signal generation and Laplace transform calculations
// F(s) = ∫₀^∞ f(t)e^(-st) dt where s = σ + jω

/**
 * Generate time domain signal for Laplace analysis
 * @param {string} funcType - Type of signal function
 * @param {number} frequency - Frequency parameter (ω)
 * @param {number} damping - Damping parameter (σ)
 * @param {number} amplitude - Signal amplitude
 * @param {number} timeWindow - Time window in seconds
 * @param {number} samples - Number of samples
 * @returns {Array} Array of {t, value} objects
 */
export function generateLaplaceTimeDomainSignal(funcType, frequency, damping, amplitude, timeWindow, samples) {
    const signal = [];
    const dt = timeWindow / samples;
    const omega = 2 * Math.PI * frequency;
    
    for (let i = 0; i < samples; i++) {
        const t = i * dt;
        let value = 0;
        
        switch(funcType) {
            case 'step': // Unit step u(t)
                value = amplitude;
                break;
                
            case 'exponential': // Exponential decay e^(-at)
                value = amplitude * Math.exp(-damping * t);
                break;
                
            case 'sine': // Sine wave
                value = amplitude * Math.sin(omega * t);
                break;
                
            case 'cosine': // Cosine wave
                value = amplitude * Math.cos(omega * t);
                break;
                
            case 'damped_sine': // Damped sine: e^(-σt)·sin(ωt)
                value = amplitude * Math.exp(-damping * t) * Math.sin(omega * t);
                break;
                
            case 'damped_cosine': // Damped cosine: e^(-σt)·cos(ωt)
                value = amplitude * Math.exp(-damping * t) * Math.cos(omega * t);
                break;
                
            case 'ramp': // Ramp function: t·u(t)
                value = amplitude * t;
                break;
                
            case 'impulse': // Impulse (approximated as very narrow pulse)
                value = (t < dt * 2) ? amplitude / dt : 0;
                break;
                
            case 'exponential_sine': // e^(at)·sin(ωt) - growing oscillation
                value = amplitude * Math.exp(damping * 0.3 * t) * Math.sin(omega * t);
                break;
                
            case 'underdamped': // Underdamped system (ζ < 1)
                const zeta = 0.3; // damping ratio
                const wd = omega * Math.sqrt(1 - zeta * zeta);
                value = amplitude * Math.exp(-zeta * omega * t) * Math.sin(wd * t);
                break;
                
            case 'critically_damped': // Critically damped (ζ = 1)
                value = amplitude * (1 + omega * t) * Math.exp(-omega * t);
                break;
                
            case 'overdamped': // Overdamped (ζ > 1)
                const zeta2 = 1.5;
                const term1 = Math.exp((-zeta2 + Math.sqrt(zeta2 * zeta2 - 1)) * omega * t);
                const term2 = Math.exp((-zeta2 - Math.sqrt(zeta2 * zeta2 - 1)) * omega * t);
                value = amplitude * 0.5 * (term1 + term2);
                break;
                
            default:
                value = amplitude * Math.exp(-damping * t) * Math.sin(omega * t);
        }
        
        signal.push({ t, value });
    }
    
    return signal;
}

/**
 * Compute closed-form Laplace Transform for known functions
 * @param {string} funcType - Type of signal
 * @param {number} sigmaS - Real part of s
 * @param {number} omegaS - Imaginary part of s
 * @param {Object} params - Additional parameters (frequency, damping, amplitude)
 * @returns {Object} {real, imag, magnitude, phase} or null if no closed form
 */
export function computeClosedFormLaplace(funcType, sigmaS, omegaS, params) {
    const { frequency, damping, amplitude } = params;
    const omega = 2 * Math.PI * frequency;
    const a = damping;
    
    // s = σ + jω
    const s_real = sigmaS;
    const s_imag = omegaS;
    
    let F_real = 0;
    let F_imag = 0;
    
    switch(funcType) {
        case 'step': // L{u(t)} = 1/s
            // F(s) = 1/s = 1/(σ + jω) = (σ - jω)/(σ² + ω²)
            const denom_step = s_real * s_real + s_imag * s_imag;
            if (denom_step > 0.001) {
                F_real = amplitude * s_real / denom_step;
                F_imag = -amplitude * s_imag / denom_step;
            }
            break;
            
        case 'exponential': // L{e^(-at)} = 1/(s+a)
            const s_plus_a_real = s_real + a;
            const s_plus_a_imag = s_imag;
            const denom_exp = s_plus_a_real * s_plus_a_real + s_plus_a_imag * s_plus_a_imag;
            if (denom_exp > 0.001) {
                F_real = amplitude * s_plus_a_real / denom_exp;
                F_imag = -amplitude * s_plus_a_imag / denom_exp;
            }
            break;
            
        case 'sine': // L{sin(ωt)} = ω/(s² + ω²)
            const s_sq = s_real * s_real - s_imag * s_imag;
            const s_sq_imag = 2 * s_real * s_imag;
            const denom_real = s_sq + omega * omega;
            const denom_imag = s_sq_imag;
            const denom_mag_sq = denom_real * denom_real + denom_imag * denom_imag;
            if (denom_mag_sq > 0.001) {
                F_real = amplitude * omega * denom_real / denom_mag_sq;
                F_imag = -amplitude * omega * denom_imag / denom_mag_sq;
            }
            break;
            
        case 'cosine': // L{cos(ωt)} = s/(s² + ω²)
            const s_sq_cos = s_real * s_real - s_imag * s_imag;
            const s_sq_imag_cos = 2 * s_real * s_imag;
            const denom_real_cos = s_sq_cos + omega * omega;
            const denom_imag_cos = s_sq_imag_cos;
            const denom_mag_sq_cos = denom_real_cos * denom_real_cos + denom_imag_cos * denom_imag_cos;
            if (denom_mag_sq_cos > 0.001) {
                // Numerator is s = σ + jω
                const num_real = s_real * denom_real_cos + s_imag * denom_imag_cos;
                const num_imag = s_imag * denom_real_cos - s_real * denom_imag_cos;
                F_real = amplitude * num_real / denom_mag_sq_cos;
                F_imag = amplitude * num_imag / denom_mag_sq_cos;
            }
            break;
            
        case 'damped_sine': // L{e^(-at)sin(ωt)} = ω/((s+a)² + ω²)
            const s_plus_a_ds_real = s_real + a;
            const s_plus_a_ds_imag = s_imag;
            const sq_real = s_plus_a_ds_real * s_plus_a_ds_real - s_plus_a_ds_imag * s_plus_a_ds_imag;
            const sq_imag = 2 * s_plus_a_ds_real * s_plus_a_ds_imag;
            const denom_ds_real = sq_real + omega * omega;
            const denom_ds_imag = sq_imag;
            const denom_ds_mag_sq = denom_ds_real * denom_ds_real + denom_ds_imag * denom_ds_imag;
            if (denom_ds_mag_sq > 0.001) {
                F_real = amplitude * omega * denom_ds_real / denom_ds_mag_sq;
                F_imag = -amplitude * omega * denom_ds_imag / denom_ds_mag_sq;
            }
            break;
            
        case 'damped_cosine': // L{e^(-at)cos(ωt)} = (s+a)/((s+a)² + ω²)
            const s_plus_a_dc_real = s_real + a;
            const s_plus_a_dc_imag = s_imag;
            const sq_dc_real = s_plus_a_dc_real * s_plus_a_dc_real - s_plus_a_dc_imag * s_plus_a_dc_imag;
            const sq_dc_imag = 2 * s_plus_a_dc_real * s_plus_a_dc_imag;
            const denom_dc_real = sq_dc_real + omega * omega;
            const denom_dc_imag = sq_dc_imag;
            const denom_dc_mag_sq = denom_dc_real * denom_dc_real + denom_dc_imag * denom_dc_imag;
            if (denom_dc_mag_sq > 0.001) {
                const num_dc_real = s_plus_a_dc_real * denom_dc_real + s_plus_a_dc_imag * denom_dc_imag;
                const num_dc_imag = s_plus_a_dc_imag * denom_dc_real - s_plus_a_dc_real * denom_dc_imag;
                F_real = amplitude * num_dc_real / denom_dc_mag_sq;
                F_imag = amplitude * num_dc_imag / denom_dc_mag_sq;
            }
            break;
            
        case 'ramp': // L{t·u(t)} = 1/s²
            const s_sq_ramp = s_real * s_real - s_imag * s_imag;
            const s_sq_imag_ramp = 2 * s_real * s_imag;
            const denom_ramp_mag_sq = s_sq_ramp * s_sq_ramp + s_sq_imag_ramp * s_sq_imag_ramp;
            if (denom_ramp_mag_sq > 0.001) {
                F_real = amplitude * s_sq_ramp / denom_ramp_mag_sq;
                F_imag = -amplitude * s_sq_imag_ramp / denom_ramp_mag_sq;
            }
            break;
            
        case 'impulse': // L{δ(t)} = 1
            F_real = amplitude;
            F_imag = 0;
            break;
            
        case 'exponential_sine': {
            const a_es = -damping * 0.3;
            const s_plus_a_es_real = s_real + a_es;
            const s_plus_a_es_imag = s_imag;
            const sq_es_real = s_plus_a_es_real * s_plus_a_es_real - s_plus_a_es_imag * s_plus_a_es_imag;
            const sq_es_imag = 2 * s_plus_a_es_real * s_plus_a_es_imag;
            const denom_es_real = sq_es_real + omega * omega;
            const denom_es_imag = sq_es_imag;
            const denom_es_mag_sq = denom_es_real * denom_es_real + denom_es_imag * denom_es_imag;
            if (denom_es_mag_sq > 0.001) {
                F_real = amplitude * omega * denom_es_real / denom_es_mag_sq;
                F_imag = -amplitude * omega * denom_es_imag / denom_es_mag_sq;
            }
            break;
        }
            
        case 'underdamped': {
            const zeta = 0.3;
            const wd = omega * Math.sqrt(1 - zeta * zeta);
            const a_ud = zeta * omega;
            const s_plus_a_ud_real = s_real + a_ud;
            const s_plus_a_ud_imag = s_imag;
            const sq_ud_real = s_plus_a_ud_real * s_plus_a_ud_real - s_plus_a_ud_imag * s_plus_a_ud_imag;
            const sq_ud_imag = 2 * s_plus_a_ud_real * s_plus_a_ud_imag;
            const denom_ud_real = sq_ud_real + wd * wd;
            const denom_ud_imag = sq_ud_imag;
            const denom_ud_mag_sq = denom_ud_real * denom_ud_real + denom_ud_imag * denom_ud_imag;
            if (denom_ud_mag_sq > 0.001) {
                F_real = amplitude * wd * denom_ud_real / denom_ud_mag_sq;
                F_imag = -amplitude * wd * denom_ud_imag / denom_ud_mag_sq;
            }
            break;
        }
            
        case 'critically_damped': {
            const a_cd = omega;
            const s_plus_a_cd_real = s_real + a_cd;
            const s_plus_a_cd_imag = s_imag;
            const denom_cd_real = s_plus_a_cd_real * s_plus_a_cd_real - s_plus_a_cd_imag * s_plus_a_cd_imag;
            const denom_cd_imag = 2 * s_plus_a_cd_real * s_plus_a_cd_imag;
            const denom_cd_mag_sq = denom_cd_real * denom_cd_real + denom_cd_imag * denom_cd_imag;
            
            const num_cd_real = s_real + 2 * omega;
            const num_cd_imag = s_imag;
            
            if (denom_cd_mag_sq > 0.001) {
                F_real = amplitude * (num_cd_real * denom_cd_real + num_cd_imag * denom_cd_imag) / denom_cd_mag_sq;
                F_imag = amplitude * (num_cd_imag * denom_cd_real - num_cd_real * denom_cd_imag) / denom_cd_mag_sq;
            }
            break;
        }
            
        case 'overdamped': {
            const zeta2 = 1.5;
            const root = Math.sqrt(zeta2 * zeta2 - 1);
            const a1 = (-zeta2 + root) * omega;
            const a2 = (-zeta2 - root) * omega;
            
            const s_minus_a1_real = s_real - a1;
            const s_minus_a1_imag = s_imag;
            const mag_sq_1 = s_minus_a1_real * s_minus_a1_real + s_minus_a1_imag * s_minus_a1_imag;
            
            const s_minus_a2_real = s_real - a2;
            const s_minus_a2_imag = s_imag;
            const mag_sq_2 = s_minus_a2_real * s_minus_a2_real + s_minus_a2_imag * s_minus_a2_imag;
            
            let f1_real = 0, f1_imag = 0, f2_real = 0, f2_imag = 0;
            if (mag_sq_1 > 0.001) {
                f1_real = s_minus_a1_real / mag_sq_1;
                f1_imag = -s_minus_a1_imag / mag_sq_1;
            }
            if (mag_sq_2 > 0.001) {
                f2_real = s_minus_a2_real / mag_sq_2;
                f2_imag = -s_minus_a2_imag / mag_sq_2;
            }
            
            F_real = amplitude * 0.5 * (f1_real + f2_real);
            F_imag = amplitude * 0.5 * (f1_imag + f2_imag);
            break;
        }
            
        default:
            F_real = 0;
            F_imag = 0;
            break;
    }
    
    const magnitude = Math.sqrt(F_real * F_real + F_imag * F_imag);
    const phase = Math.atan2(F_imag, F_real);
    
    return { real: F_real, imag: F_imag, magnitude, phase };
}


/**
 * Compute Laplace transform over a grid of s values for 3D surface
 * @param {string} funcType - Function type
 * @param {Object} params - Parameters {frequency, damping, amplitude}
 * @param {Array} signal - Time domain signal (for numerical fallback)
 * @param {number} timeWindow - Time window
 * @param {Object} grid - {sigmaRange, omegaRange, sigmaSteps, omegaSteps}
 * @returns {Array} Grid of {sigma, omega, magnitude, phase} values
 */
export function computeLaplaceSurface(funcType, params, signal, timeWindow, grid) {
    const { sigmaRange, omegaRange, sigmaSteps, omegaSteps } = grid;
    const surface = [];
    
    const dSigma = (sigmaRange[1] - sigmaRange[0]) / sigmaSteps;
    const dOmega = (omegaRange[1] - omegaRange[0]) / omegaSteps;
    
    for (let i = 0; i <= sigmaSteps; i++) {
        for (let j = 0; j <= omegaSteps; j++) {
            const sigma = sigmaRange[0] + i * dSigma;
            const omega = omegaRange[0] + j * dOmega;
            
            const result = computeClosedFormLaplace(funcType, sigma, omega, params);
            
            if (result) {
                surface.push({
                    sigma,
                    omega,
                    magnitude: result.magnitude,
                    phase: result.phase,
                    real: result.real,
                    imag: result.imag
                });
            }
        }
    }
    
    return surface;
}

/**
 * Find poles and zeros from analytical formulas
 * @param {string} funcType - Function type
 * @param {Object} params - Parameters
 * @returns {Object} {poles: Array, zeros: Array}
 */
export function findPolesZeros(funcType, params) {
    const { frequency, damping } = params;
    const omega = 2 * Math.PI * frequency;
    const a = damping;
    
    const poles = [];
    const zeros = [];
    
    switch(funcType) {
        case 'step': // F(s) = 1/s → pole at s = 0
            poles.push({ sigma: 0, omega: 0, label: 's = 0' });
            break;
            
        case 'exponential': // F(s) = 1/(s+a) → pole at s = -a
            poles.push({ sigma: -a, omega: 0, label: `s = ${-a.toFixed(2)}` });
            break;
            
        case 'sine': // F(s) = ω/(s² + ω²) → poles at s = ±jω
            poles.push({ sigma: 0, omega: omega, label: `s = j${omega.toFixed(2)}` });
            poles.push({ sigma: 0, omega: -omega, label: `s = -j${omega.toFixed(2)}` });
            zeros.push({ sigma: 0, omega: 0, label: 's = 0' });
            break;
            
        case 'cosine': // F(s) = s/(s² + ω²) → poles at s = ±jω
            poles.push({ sigma: 0, omega: omega, label: `s = j${omega.toFixed(2)}` });
            poles.push({ sigma: 0, omega: -omega, label: `s = -j${omega.toFixed(2)}` });
            break;
            
        case 'damped_sine': // F(s) = ω/((s+a)² + ω²) → poles at s = -a ± jω
            poles.push({ sigma: -a, omega: omega, label: `s = ${-a.toFixed(2)} + j${omega.toFixed(2)}` });
            poles.push({ sigma: -a, omega: -omega, label: `s = ${-a.toFixed(2)} - j${omega.toFixed(2)}` });
            break;
            
        case 'damped_cosine': // F(s) = (s+a)/((s+a)² + ω²)
            poles.push({ sigma: -a, omega: omega, label: `s = ${-a.toFixed(2)} + j${omega.toFixed(2)}` });
            poles.push({ sigma: -a, omega: -omega, label: `s = ${-a.toFixed(2)} - j${omega.toFixed(2)}` });
            zeros.push({ sigma: -a, omega: 0, label: `s = ${-a.toFixed(2)}` });
            break;
            
        case 'ramp': // F(s) = 1/s² → double pole at s = 0
            poles.push({ sigma: 0, omega: 0, label: 's = 0 (×2)', order: 2 });
            break;
            
        case 'impulse': // F(s) = 1 → no poles or zeros
            break;
            
        case 'exponential_sine': { // e^(at)sin(ωt) -> a_es = damping * 0.3
            const a_es = damping * 0.3;
            poles.push({ sigma: a_es, omega: omega, label: `s = ${a_es.toFixed(2)} + j${omega.toFixed(2)}` });
            poles.push({ sigma: a_es, omega: -omega, label: `s = ${a_es.toFixed(2)} - j${omega.toFixed(2)}` });
            break;
        }
            
        case 'underdamped': {
            const zeta = 0.3;
            const wd = omega * Math.sqrt(1 - zeta * zeta);
            const a_ud = -zeta * omega;
            poles.push({ sigma: a_ud, omega: wd, label: `s = ${a_ud.toFixed(2)} + j${wd.toFixed(2)}` });
            poles.push({ sigma: a_ud, omega: -wd, label: `s = ${a_ud.toFixed(2)} - j${wd.toFixed(2)}` });
            break;
        }
            
        case 'critically_damped': {
            const a_cd = -omega;
            poles.push({ sigma: a_cd, omega: 0, label: `s = ${a_cd.toFixed(2)} (×2)`, order: 2 });
            break;
        }
            
        case 'overdamped': {
            const zeta2 = 1.5;
            const root = Math.sqrt(zeta2 * zeta2 - 1);
            const a1 = (-zeta2 + root) * omega;
            const a2 = (-zeta2 - root) * omega;
            poles.push({ sigma: a1, omega: 0, label: `s = ${a1.toFixed(2)}` });
            poles.push({ sigma: a2, omega: 0, label: `s = ${a2.toFixed(2)}` });
            break;
        }
    }
    
    return { poles, zeros };
}

/**
 * Analyze system stability based on pole locations
 * @param {Array} poles - Array of pole objects
 * @returns {Object} {stable, message, marginally_stable}
 */
export function analyzeStability(poles) {
    if (!poles || poles.length === 0) {
        return { stable: true, message: 'No poles detected', marginally_stable: false };
    }
    
    let maxRealPart = -Infinity;
    
    for (const pole of poles) {
        if (pole.sigma > maxRealPart) {
            maxRealPart = pole.sigma;
        }
    }
    
    if (maxRealPart < -0.01) {
        return {
            stable: true,
            message: '✓ STABLE: All poles in left-half plane',
            marginally_stable: false,
            color: 'rgba(100, 255, 150, 1)'
        };
    } else if (maxRealPart > 0.01) {
        return {
            stable: false,
            message: '✗ UNSTABLE: Poles in right-half plane',
            marginally_stable: false,
            color: 'rgba(255, 100, 100, 1)'
        };
    } else {
        return {
            stable: false,
            message: '⚠ MARGINALLY STABLE: Poles on jω axis',
            marginally_stable: true,
            color: 'rgba(255, 220, 100, 1)'
        };
    }
}

/**
 * Compute Region of Convergence (ROC) boundaries
 * @param {Array} poles - Array of poles
 * @returns {Object} {rocType, boundary, description}
 */
export function computeROC(poles) {
    if (!poles || poles.length === 0) {
        return {
            rocType: 'entire',
            boundary: null,
            description: 'Entire s-plane (no poles)'
        };
    }
    
    // Find rightmost pole (determines ROC for causal signals)
    let rightmostSigma = -Infinity;
    for (const pole of poles) {
        if (pole.sigma > rightmostSigma) {
            rightmostSigma = pole.sigma;
        }
    }
    
    return {
        rocType: 'right_half',
        boundary: rightmostSigma,
        description: `ROC: σ > ${rightmostSigma.toFixed(2)} (right-sided signal)`
    };
}

/**
 * Update ONLY the evaluation point (fast - for slider interaction)
 * Called when σ or ω changes
 */
export function updateLaplaceEvaluationPoint() {
    if (!state.laplaceModeEnabled) return;
    
    const funcType = state.laplaceFunction || 'exponential';
    const frequency = state.laplaceFrequency || 2.0;
    const damping = state.laplaceDamping || 0.5;
    const amplitude = state.laplaceAmplitude || 1.0;
    const sigma = state.laplaceSigma || 0;
    const omega = state.laplaceOmega || 1;
    
    // Quick evaluation at current s point
    state.laplaceCurrentValue = computeClosedFormLaplace(funcType, sigma, omega, { frequency, damping, amplitude });
}

/**
 * Update Laplace transform calculations (full recompute - expensive!)
 * Only call when signal parameters change, not when exploring s-plane
 */
export function updateLaplaceTransform() {
    if (!state.laplaceModeEnabled) return;
    
    const funcType = state.laplaceFunction || 'exponential';
    const frequency = state.laplaceFrequency || 2.0;
    const damping = state.laplaceDamping || 0.5;
    const amplitude = state.laplaceAmplitude || 1.0;
    const timeWindow = 5.0; // Fixed time window for Laplace
    const samples = 256;
    
    // Generate time domain signal
    state.laplaceTimeDomainSignal = generateLaplaceTimeDomainSignal(
        funcType, frequency, damping, amplitude, timeWindow, samples
    );
    
    // Find poles and zeros
    const pz = findPolesZeros(funcType, { frequency, damping, amplitude });
    state.laplacePoles = pz.poles;
    state.laplaceZeros = pz.zeros;
    
    // Compute ROC
    state.laplaceROC = computeROC(pz.poles);
    
    // Analyze stability
    state.laplaceStability = analyzeStability(pz.poles);
    
    // Dynamically calculate grid boundaries based on poles
    let minSigma = -3, maxSigma = 2;
    let maxOmegaMag = 5;

    if (pz.poles && pz.poles.length > 0) {
        let poleMinSigma = Infinity;
        let poleMaxSigma = -Infinity;
        
        for (const pole of pz.poles) {
            poleMinSigma = Math.min(poleMinSigma, pole.sigma);
            poleMaxSigma = Math.max(poleMaxSigma, pole.sigma);
            maxOmegaMag = Math.max(maxOmegaMag, Math.abs(pole.omega));
        }
        
        // Add padding around poles
        minSigma = Math.min(-1, poleMinSigma - 2);
        maxSigma = Math.max(1, poleMaxSigma + 2);
        // Ensure ROC boundary is well-visible
        if (state.laplaceROC && state.laplaceROC.boundary !== null) {
            maxSigma = Math.max(maxSigma, state.laplaceROC.boundary + 3);
            minSigma = Math.min(minSigma, state.laplaceROC.boundary - 3);
        }
    } else {
        // Fallback bounds
        maxOmegaMag = Math.max(5, frequency * 2);
        minSigma = -damping * 2 - 1;
        maxSigma = Math.max(2, damping + 1);
    }
    
    // Compute surface for 3D visualization with higher resolution
    const grid = {
        sigmaRange: [minSigma, maxSigma],
        omegaRange: [-(maxOmegaMag + 2), maxOmegaMag + 2],
        sigmaSteps: 70,  // Increased for smoother surface
        omegaSteps: 70   // Increased for smoother surface
    };
    
    state.laplaceSurface = computeLaplaceSurface(
        funcType,
        { frequency, damping, amplitude },
        state.laplaceTimeDomainSignal,
        timeWindow,
        grid
    );
    
    // Also update evaluation point
    updateLaplaceEvaluationPoint();
}
