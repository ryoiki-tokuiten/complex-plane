import { state } from '../store/state.js';
import {
    buildNativeLaplaceAnalysis,
    evaluateNativeLaplace
} from '../native/complex-engine.js';

function currentOptions() {
    return {
        functionKey: state.laplaceFunction || 'exponential',
        frequency: Number(state.laplaceFrequency) || 2,
        damping: Number(state.laplaceDamping) || 0.5,
        amplitude: Number(state.laplaceAmplitude) || 1
    };
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
        currentOptions(), Number(state.laplaceSigma) || 0, Number(state.laplaceOmega) || 0
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
