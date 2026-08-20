import { state } from '../store/state.js';
import {
    buildNativeLaplaceWinding,
    buildNativeLaplaceAnalysis,
    evaluateNativeLaplace
} from '../native/complex-engine.js';
import { requireFiniteNumber } from '../utils/numeric-contracts.js';

let windingCache = null;

function currentOptions() {
    if (typeof state.laplaceFunction !== 'string' || !state.laplaceFunction) {
        throw new Error('Laplace analysis requires a function key.');
    }
    return {
        functionKey: state.laplaceFunction,
        frequency: requireFiniteNumber(state.laplaceFrequency, 'Laplace frequency'),
        damping: requireFiniteNumber(state.laplaceDamping, 'Laplace damping'),
        amplitude: requireFiniteNumber(state.laplaceAmplitude, 'Laplace amplitude')
    };
}

export function getLaplaceFrameData(signal = state.laplaceTimeDomainSignal, progress = state.laplaceAnimationTime) {
    if (!Array.isArray(signal) || signal.length < 2) {
        throw new Error('Laplace frame rendering requires at least two signal samples.');
    }
    const sigma = requireFiniteNumber(state.laplaceSigma, 'Laplace sigma');
    const omega = requireFiniteNumber(state.laplaceOmega, 'Laplace omega');
    const animationProgress = requireFiniteNumber(progress, 'Laplace animation progress');
    if (windingCache?.signal === signal && windingCache.sigma === sigma &&
        windingCache.omega === omega && windingCache.progress === animationProgress) {
        return windingCache.value;
    }
    const value = buildNativeLaplaceWinding(signal, sigma, omega, animationProgress);
    windingCache = { signal, sigma, omega, progress: animationProgress, value };
    return value;
}

function featureLabel(point) {
    const real = Math.abs(point.sigma) < 1e-12 ? 0 : point.sigma;
    const imaginary = Math.abs(point.omega) < 1e-12 ? 0 : point.omega;
    let label;
    if (!imaginary) label = `s = ${real.toFixed(2)}`;
    else if (!real) label = `s = ${imaginary < 0 ? '-' : ''}j${Math.abs(imaginary).toFixed(2)}`;
    else label = `s = ${real.toFixed(2)} ${imaginary < 0 ? '-' : '+'} j${Math.abs(imaginary).toFixed(2)}`;
    return point.order > 1 ? `${label} (×${point.order})` : label;
}

export function updateLaplaceEvaluationPoint() {
    if (!state.laplaceModeEnabled) return;
    state.laplaceCurrentValue = evaluateNativeLaplace(
        currentOptions(),
        requireFiniteNumber(state.laplaceSigma, 'Laplace sigma'),
        requireFiniteNumber(state.laplaceOmega, 'Laplace omega')
    );
}

export function updateLaplaceTransform() {
    if (!state.laplaceModeEnabled) return;
    const options = currentOptions();
    const analysis = buildNativeLaplaceAnalysis({
        ...options,
        timeWindow: 5,
        sampleCount: 256
    });
    state.laplaceTimeDomainSignal = analysis.samples;
    state.laplacePoles = analysis.poles.map(point => ({ ...point, label: featureLabel(point) }));
    state.laplaceZeros = analysis.zeros.map(point => ({ ...point, label: featureLabel(point) }));
    state.laplaceROC = Number.isFinite(analysis.rocBoundary)
        ? {
            rocType: 'right_half',
            boundary: analysis.rocBoundary,
            description: `ROC: σ > ${analysis.rocBoundary.toFixed(2)} (right-sided signal)`
        }
        : { rocType: 'entire', boundary: null, description: 'Entire s-plane (no poles)' };

    let minSigma = -3;
    let maxSigma = 2;
    let maxOmegaMagnitude = 5;
    if (analysis.poles.length) {
        let poleMinSigma = Infinity;
        let poleMaxSigma = -Infinity;
        for (const pole of analysis.poles) {
            poleMinSigma = Math.min(poleMinSigma, pole.sigma);
            poleMaxSigma = Math.max(poleMaxSigma, pole.sigma);
            maxOmegaMagnitude = Math.max(maxOmegaMagnitude, Math.abs(pole.omega));
        }
        minSigma = Math.min(-1, poleMinSigma - 2, analysis.rocBoundary - 3);
        maxSigma = Math.max(1, poleMaxSigma + 2, analysis.rocBoundary + 3);
    } else {
        maxOmegaMagnitude = Math.max(5, options.frequency * 2);
        minSigma = -options.damping * 2 - 1;
        maxSigma = Math.max(2, options.damping + 1);
    }

    state.laplaceSurface = Object.freeze({
        ...options,
        sigmaRange: Object.freeze([minSigma, maxSigma]),
        omegaRange: Object.freeze([-(maxOmegaMagnitude + 2), maxOmegaMagnitude + 2]),
        sigmaSteps: 70,
        omegaSteps: 70
    });
    updateLaplaceEvaluationPoint();
}
