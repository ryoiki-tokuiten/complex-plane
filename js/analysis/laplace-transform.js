import { state } from '../store/state.js';
import {
    buildNativeLaplaceWinding,
    buildNativeLaplaceAnalysis,
    buildNativeLaplaceSurface,
    generateNativeTransformSignal,
    computeNativeSpectrum
} from '../native/complex-engine.js';
import { LAPLACE_SURFACE_FRAME } from '../constants/surface-rendering.js';
import { paletteColor, paletteLutFor } from '../constants/surface-palettes.js';
import { requireFiniteNumber, requireInteger } from '../utils/numeric-contracts.js';

/**
 * Closed-form Laplace families are the only signals with pole/zero metadata.
 * Every other signal still uses the same sampled Laplace integral and surface
 * machinery; it simply has no analytic feature markers to report.
 */
export const ANALYTICAL_LAPLACE_FUNCTIONS = Object.freeze(new Set([
    'step', 'exponential', 'sine', 'cosine', 'damped_sine', 'damped_cosine',
    'ramp', 'impulse', 'exponential_sine', 'underdamped',
    'critically_damped', 'overdamped'
]));

let windingCache = null;
let surfaceGeometryCache = null;
let laplaceSurfaceRevision = 0;

function currentOptions() {
    if (typeof state.laplaceFunction !== 'string' || !state.laplaceFunction) {
        throw new Error('Laplace analysis requires a function key.');
    }
    return {
        functionKey: state.laplaceFunction,
        frequency: requireFiniteNumber(state.laplaceFrequency, 'Laplace frequency'),
        damping: requireFiniteNumber(state.laplaceDamping, 'Laplace damping'),
        amplitude: requireFiniteNumber(state.laplaceAmplitude, 'Laplace amplitude'),
        timeWindow: requireFiniteNumber(state.laplaceTimeWindow, 'Laplace time window'),
        sampleCount: requireInteger(state.laplaceSamples, 'Laplace sample count')
    };
}

function emptyWindingFrame() {
    return {
        points: [],
        weighted: [],
        envelope: [],
        integral: { real: 0, imag: 0 },
        maxRadius: 1,
        maxAmplitude: 0,
        sigma: 0,
        omega: 0,
        animTime: 1
    };
}

/**
 * The single winding entry point for both transforms.
 *
 * Fourier is the exact sigma = 0 slice, with omega expressed in radians per
 * second. Callers that expose cycles per second convert with 2π before they
 * reach this function.
 */
export function buildLaplaceWinding(signal, options = {}) {
    if (!Array.isArray(signal) || signal.length === 0) return emptyWindingFrame();
    if (signal.length < 2) {
        throw new Error('Laplace winding requires at least two signal samples.');
    }

    const sigma = requireFiniteNumber(
        options.sigma === undefined ? state.laplaceSigma : options.sigma,
        'Laplace sigma'
    );
    const omega = requireFiniteNumber(
        options.omega === undefined ? state.laplaceOmega : options.omega,
        'Laplace omega'
    );
    const progress = requireFiniteNumber(
        options.progress === undefined ? state.laplaceAnimationTime : options.progress,
        'Laplace animation progress'
    );
    return buildNativeLaplaceWinding(signal, sigma, omega, progress);
}

export function getLaplaceFrameData(
    signal = state.laplaceTimeDomainSignal,
    progress = state.laplaceAnimationTime
) {
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
    const value = buildLaplaceWinding(signal, {
        sigma,
        omega,
        progress: animationProgress
    });
    windingCache = { signal, sigma, omega, progress: animationProgress, value };
    return value;
}

export function generateLaplaceSignal(funcType, frequency, amplitude, timeWindow, samples) {
    return generateNativeTransformSignal(
        funcType,
        requireFiniteNumber(frequency, 'Laplace frequency'),
        requireFiniteNumber(amplitude, 'Laplace amplitude'),
        requireFiniteNumber(timeWindow, 'Laplace time window'),
        requireInteger(samples, 'Laplace sample count'),
        Math.floor(Math.random() * 0x7fffffff)
    );
}

export function computeLaplaceSpectrum(signal) {
    if (!Array.isArray(signal) || signal.length === 0) return [];
    return computeNativeSpectrum(signal.map((sample, index) =>
        requireFiniteNumber(sample?.value, `Laplace sample ${index}`)));
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

function emptyROC() {
    return {
        rocType: 'entire',
        boundary: null,
        description: 'Entire s-plane (finite sampled signal)'
    };
}

function surfaceRanges(options, analysis = null) {
    let minSigma = -3;
    let maxSigma = 2;
    let maxOmegaMagnitude = Math.max(5, options.frequency * 2 * Math.PI);

    if (analysis?.poles?.length) {
        let poleMinSigma = Infinity;
        let poleMaxSigma = -Infinity;
        for (const pole of analysis.poles) {
            poleMinSigma = Math.min(poleMinSigma, pole.sigma);
            poleMaxSigma = Math.max(poleMaxSigma, pole.sigma);
            maxOmegaMagnitude = Math.max(maxOmegaMagnitude, Math.abs(pole.omega));
        }
        minSigma = Math.min(-1, poleMinSigma - 2, analysis.rocBoundary - 3);
        maxSigma = Math.max(1, poleMaxSigma + 2, analysis.rocBoundary + 3);
    }

    return {
        sigmaRange: Object.freeze([minSigma, maxSigma]),
        omegaRange: Object.freeze([-(maxOmegaMagnitude + 2), maxOmegaMagnitude + 2]),
        sigmaSteps: 70,
        omegaSteps: 70
    };
}

function setLaplaceSurface(options, signal, analysis = null) {
    const ranges = surfaceRanges(options, analysis);
    state.laplaceSurface = Object.freeze({
        ...options,
        ...ranges,
        revision: ++laplaceSurfaceRevision,
        sampled: !ANALYTICAL_LAPLACE_FUNCTIONS.has(options.functionKey),
        signal: Object.freeze(signal.slice())
    });
}

function updateLaplaceEvaluationPoint() {
    if (!state.laplaceModeEnabled) return;
    const signal = state.laplaceTimeDomainSignal;
    if (!Array.isArray(signal) || signal.length < 2) {
        state.laplaceCurrentValue = null;
        state.laplaceComSweep = [];
        return;
    }
    const winding = buildLaplaceWinding(signal, {
        sigma: requireFiniteNumber(state.laplaceSigma, 'Laplace sigma'),
        omega: requireFiniteNumber(state.laplaceOmega, 'Laplace omega'),
        progress: 1
    });
    const real = winding.integral.real;
    const imag = winding.integral.imag;
    state.laplaceCurrentValue = {
        real,
        imag,
        magnitude: Math.hypot(real, imag),
        phase: Math.atan2(imag, real)
    };
    state.laplaceComSweep = computeCenterOfMassFrequencySweep(signal);
}

export { updateLaplaceEvaluationPoint };

export function setLaplaceSurfaceViewport(sigmaRange, omegaRange, viewportZoom) {
    state.laplaceSurface = Object.freeze({
        ...state.laplaceSurface,
        sigmaRange: Object.freeze([...sigmaRange]),
        omegaRange: Object.freeze([...omegaRange]),
        viewportZoom
    });
}

export function scaleLaplaceSurfaceViewport(factor, viewportZoom) {
    const scale = range => {
        const center = (range[0] + range[1]) * 0.5;
        const halfSpan = (range[1] - range[0]) * factor * 0.5;
        return [center - halfSpan, center + halfSpan];
    };
    setLaplaceSurfaceViewport(
        scale(state.laplaceSurface.sigmaRange),
        scale(state.laplaceSurface.omegaRange),
        viewportZoom
    );
}

export function updateLaplaceTransform() {
    if (!state.laplaceModeEnabled) return;
    const options = currentOptions();
    let signal;

    if (ANALYTICAL_LAPLACE_FUNCTIONS.has(options.functionKey)) {
        const analysis = buildNativeLaplaceAnalysis(options);
        signal = analysis.samples;
        state.laplacePoles = analysis.poles.map(point => ({ ...point, label: featureLabel(point) }));
        state.laplaceZeros = analysis.zeros.map(point => ({ ...point, label: featureLabel(point) }));
        state.laplaceROC = Number.isFinite(analysis.rocBoundary)
            ? {
                rocType: 'right_half',
                boundary: analysis.rocBoundary,
                description: `ROC: σ > ${analysis.rocBoundary.toFixed(2)} (right-sided signal)`
            }
            : emptyROC();
        setLaplaceSurface(options, signal, analysis);
    } else {
        signal = generateLaplaceSignal(
            options.functionKey,
            options.frequency,
            options.amplitude,
            options.timeWindow,
            options.sampleCount
        );
        state.laplacePoles = [];
        state.laplaceZeros = [];
        state.laplaceROC = emptyROC();
        setLaplaceSurface(options, signal);
    }

    state.laplaceTimeDomainSignal = signal;
    state.laplaceSpectrum = computeLaplaceSpectrum(signal);
    state.laplaceComSweep = computeCenterOfMassFrequencySweep(signal);
    updateLaplaceEvaluationPoint();
}

export function computeCenterOfMassFrequencySweep(signal, options = {}) {
    if (!Array.isArray(signal) || signal.length < 2) return [];

    const sigma = requireFiniteNumber(
        options.sigma === undefined ? state.laplaceSigma : options.sigma,
        'Laplace sigma'
    );
    const maxFreq = requireFiniteNumber(
        options.maxFreq === undefined ? Math.max(10, (state.laplaceFrequency || 2) * 2.5) : options.maxFreq,
        'COM max frequency'
    );
    const minFreq = requireFiniteNumber(options.minFreq === undefined ? 0 : options.minFreq, 'COM min frequency');
    const steps = requireInteger(options.steps === undefined ? 300 : options.steps, 'COM sweep steps');

    const n = signal.length;
    const t0 = signal[0].t;
    const t1 = signal[n - 1].t;
    const totalT = Math.max(1e-6, t1 - t0);

    const weightedValues = new Float64Array(n);
    const times = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        times[i] = signal[i].t;
        const damping = sigma !== 0 ? Math.exp(Math.max(-700, Math.min(700, -sigma * times[i]))) : 1;
        weightedValues[i] = signal[i].value * damping;
    }

    const sweep = [];
    for (let s = 0; s <= steps; s++) {
        const freq = minFreq + (s / steps) * (maxFreq - minFreq);
        const omega = 2 * Math.PI * freq;

        let sumRe = 0;
        let sumIm = 0;
        for (let i = 0; i < n; i++) {
            const dt = (i === 0
                ? (times[1] - times[0])
                : i === n - 1
                    ? (times[n - 1] - times[n - 2])
                    : (times[i + 1] - times[i - 1]) * 0.5);
            const angle = -omega * times[i];
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            sumRe += weightedValues[i] * cos * dt;
            sumIm += weightedValues[i] * sin * dt;
        }

        const real = sumRe / totalT;
        const imag = sumIm / totalT;
        const magnitude = Math.hypot(real, imag);

        sweep.push({
            freq,
            omega,
            real,
            imag,
            magnitude
        });
    }
    return sweep;
}

const PI = Math.PI;

function sampledLaplaceValue(signal, sigma, omega) {
    let real = 0;
    let imag = 0;
    for (let index = 0; index < signal.length - 1; index += 1) {
        const left = signal[index];
        const right = signal[index + 1];
        const dt = right.t - left.t;
        if (!(dt > 0)) continue;

        const leftScale = Math.exp(Math.max(-700, Math.min(700, -sigma * left.t)));
        const rightScale = Math.exp(Math.max(-700, Math.min(700, -sigma * right.t)));
        const leftAngle = -omega * left.t;
        const rightAngle = -omega * right.t;
        const leftReal = left.value * leftScale * Math.cos(leftAngle);
        const rightReal = right.value * rightScale * Math.cos(rightAngle);
        const leftImag = left.value * leftScale * Math.sin(leftAngle);
        const rightImag = right.value * rightScale * Math.sin(rightAngle);
        real += (leftReal + rightReal) * dt * 0.5;
        imag += (leftImag + rightImag) * dt * 0.5;
    }
    return { real, imag };
}

function buildSampledLaplaceSurface(surface, { mode, clipHeight }) {
    if (!surface?.sampled || !Array.isArray(surface.signal)) {
        throw new Error('Sampled Laplace surface data is required.');
    }
    if (!['magnitude', 'phase', 'combined'].includes(mode)) {
        throw new Error(`Unsupported Laplace surface mode: ${mode}.`);
    }
    const clip = requireFiniteNumber(clipHeight, 'Laplace clip height');
    if (clip <= 0) throw new Error('Laplace clip height must be positive.');
    const sigmaSteps = requireInteger(surface.sigmaSteps, 'Laplace sigma steps');
    const omegaSteps = requireInteger(surface.omegaSteps, 'Laplace omega steps');
    const [minSigma, maxSigma] = surface.sigmaRange;
    const [minOmega, maxOmega] = surface.omegaRange;
    const columns = sigmaSteps + 1;
    const rows = omegaSteps + 1;
    const vertexCount = columns * rows;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const magnitudeValues = new Float32Array(vertexCount);
    const phaseValues = new Float32Array(vertexCount);
    const indices = new Uint32Array(sigmaSteps * omegaSteps * 6);
    const sigmaStep = (maxSigma - minSigma) / sigmaSteps;
    const omegaStep = (maxOmega - minOmega) / omegaSteps;

    for (let row = 0; row < rows; row += 1) {
        const omega = minOmega + row * omegaStep;
        for (let column = 0; column < columns; column += 1) {
            const sigma = minSigma + column * sigmaStep;
            const index = row * columns + column;
            const offset = index * 3;
            const value = sampledLaplaceValue(surface.signal, sigma, omega);
            const magnitude = Math.min(clip, Math.max(0, Math.hypot(value.real, value.imag)));
            const phase = Math.atan2(value.imag, value.real);
            magnitudeValues[index] = magnitude;
            phaseValues[index] = phase;
            positions[offset] = ((sigma - (minSigma + maxSigma) * 0.5) / (maxSigma - minSigma)) * LAPLACE_SURFACE_FRAME.width;
            positions[offset + 1] = mode === 'phase'
                ? Math.max(-1, Math.min(1, phase / PI)) * (LAPLACE_SURFACE_FRAME.height * 0.5)
                : Math.log1p(magnitude) / Math.log1p(clip) * LAPLACE_SURFACE_FRAME.height;
            positions[offset + 2] = ((omega - (minOmega + maxOmega) * 0.5) / (maxOmega - minOmega)) * LAPLACE_SURFACE_FRAME.depth;
        }
    }

    for (let row = 0; row < rows; row += 1) {
        const down = row ? row - 1 : row;
        const up = row < omegaSteps ? row + 1 : row;
        for (let column = 0; column < columns; column += 1) {
            const left = column ? column - 1 : column;
            const right = column < sigmaSteps ? column + 1 : column;
            const index = row * columns + column;
            const dx = positions[(row * columns + right) * 3 + 1] - positions[(row * columns + left) * 3 + 1];
            const dz = positions[(up * columns + column) * 3 + 1] - positions[(down * columns + column) * 3 + 1];
            const sx = positions[(row * columns + right) * 3] - positions[(row * columns + left) * 3];
            const sz = positions[(up * columns + column) * 3 + 2] - positions[(down * columns + column) * 3 + 2];
            const nx = sx ? -dx / sx : 0;
            const nz = sz ? -dz / sz : 0;
            const inverse = 1 / Math.sqrt(nx * nx + nz * nz + 1);
            normals[index * 3] = nx * inverse;
            normals[index * 3 + 1] = inverse;
            normals[index * 3 + 2] = nz * inverse;
        }
    }

    let cursor = 0;
    for (let row = 0; row < omegaSteps; row += 1) {
        for (let column = 0; column < sigmaSteps; column += 1) {
            const a = row * columns + column;
            const b = a + 1;
            const c = a + columns;
            const d = c + 1;
            indices[cursor++] = a;
            indices[cursor++] = c;
            indices[cursor++] = b;
            indices[cursor++] = b;
            indices[cursor++] = c;
            indices[cursor++] = d;
        }
    }

    return { positions, normals, magnitudeValues, phaseValues, indices, minSigma, maxSigma, minOmega, maxOmega };
}

function buildLaplaceColors(paletteName, mode, clipHeight, geometry) {
    const colors = new Float32Array(geometry.positions.length);
    const palette = paletteLutFor(paletteName ?? state.surfacePalette);
    const logClip = Math.log1p(clipHeight);
    for (let index = 0, offset = 0; index < geometry.magnitudeValues.length; index += 1, offset += 3) {
        const ratio = mode === 'magnitude'
            ? Math.log1p(geometry.magnitudeValues[index]) / logClip
            : (geometry.phaseValues[index] + PI) / (2 * PI);
        paletteColor(palette, ratio, colors, offset);
    }
    return colors;
}

export function buildLaplaceSurfaceGeometry(surface, options = {}) {
    if (!surface) throw new Error('Laplace surface data is required.');
    const key = laplaceSurfaceGeometryKey(surface, options);
    if (surfaceGeometryCache?.key === key) return surfaceGeometryCache.geometry;
    const mode = options.mode ?? state.laplaceVizMode;
    const clipHeight = requireFiniteNumber(
        options.clipHeight ?? state.laplaceClipHeight,
        'Laplace clip height'
    );
    if (clipHeight <= 0) throw new Error('Laplace clip height must be positive.');
    const geometry = surface.sampled
        ? buildSampledLaplaceSurface(surface, { mode, clipHeight })
        : buildNativeLaplaceSurface(surface, { mode, clipHeight });
    const result = {
        ...geometry,
        colors: buildLaplaceColors(options.palette ?? state.surfacePalette, mode, clipHeight, geometry),
        contourValues: mode === 'phase' ? geometry.phaseValues : geometry.magnitudeValues
    };
    surfaceGeometryCache = { key, geometry: result };
    return result;
}

export function laplaceSurfaceGeometryKey(surface, options = {}) {
    return [
        surface?.revision,
        ...(surface?.sigmaRange ?? []),
        ...(surface?.omegaRange ?? []),
        options.mode ?? state.laplaceVizMode,
        options.clipHeight ?? state.laplaceClipHeight,
        options.palette ?? state.surfacePalette
    ].join('|');
}

export function laplaceSurfaceFrame(surface, mode = state.laplaceVizMode) {
    const yMin = mode === 'phase' ? -LAPLACE_SURFACE_FRAME.height * 0.5 : 0;
    const yMax = mode === 'phase' ? LAPLACE_SURFACE_FRAME.height * 0.5 : LAPLACE_SURFACE_FRAME.height;
    const heightLabel = mode === 'magnitude'
        ? '|F(s)|'
        : mode === 'phase'
            ? '∠F(s)'
            : '|F(s)| + ∠F(s)';
    return {
        ...LAPLACE_SURFACE_FRAME,
        yMin,
        yMax,
        axisLabels: { x: 'σ', z: 'jω', y: heightLabel },
        coordinateBounds: {
            xRange: [...surface.sigmaRange],
            zRange: [...surface.omegaRange]
        }
    };
}

function laplaceCoordinate(value, min, max, span) {
    const range = max - min;
    if (![value, min, max, span].every(Number.isFinite) || range <= 0) {
        throw new Error('Laplace surface coordinates require finite increasing bounds.');
    }
    return ((value - (min + max) * 0.5) / range) * span;
}

function laplaceFeatureList(value, label) {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
    value.forEach((point, index) => {
        if (!Number.isFinite(point?.sigma) || !Number.isFinite(point?.omega)) {
            throw new Error(`${label} ${index} requires finite sigma and omega coordinates.`);
        }
    });
    return value;
}

export function laplaceSurfaceOverlayKey(surface, options = {}) {
    const poles = laplaceFeatureList(state.laplacePoles, 'Laplace poles');
    const zeros = laplaceFeatureList(state.laplaceZeros, 'Laplace zeros');
    return [
        surface?.revision,
        options.showPolesZeros ? 1 : 0,
        options.showFourierLine ? 1 : 0,
        options.showROC ? 1 : 0,
        state.laplaceROC?.boundary,
        ...poles.flatMap(point => ['p', point.sigma, point.omega]),
        ...zeros.flatMap(point => ['z', point.sigma, point.omega])
    ].join('|');
}

export function buildLaplaceSurfaceOverlays(surface, options = {}) {
    const poles = laplaceFeatureList(state.laplacePoles, 'Laplace poles');
    const zeros = laplaceFeatureList(state.laplaceZeros, 'Laplace zeros');
    const [minSigma, maxSigma] = surface.sigmaRange;
    const [minOmega, maxOmega] = surface.omegaRange;
    const toScene = (sigma, omega, y = 0.08) => [
        laplaceCoordinate(sigma, minSigma, maxSigma, LAPLACE_SURFACE_FRAME.width),
        y,
        laplaceCoordinate(omega, minOmega, maxOmega, LAPLACE_SURFACE_FRAME.depth)
    ];
    const overlays = [];

    if (options.showFourierLine && minSigma <= 0 && maxSigma >= 0) {
        overlays.push({
            type: 'line',
            points: [toScene(0, minOmega, 0.11), toScene(0, maxOmega, 0.11)],
            color: 0xfde68a,
            dashed: true,
            opacity: 0.8
        });
    }

    if (options.showROC && state.laplaceROC?.boundary !== null) {
        const boundary = state.laplaceROC.boundary;
        if (boundary >= minSigma && boundary <= maxSigma) {
            overlays.push({
                type: 'line',
                points: [toScene(boundary, minOmega, 0.11), toScene(boundary, maxOmega, 0.11)],
                color: 0x4ade80,
                dashed: true,
                opacity: 0.8
            });
            overlays.push({
                type: 'plane',
                width: Math.abs(
                    laplaceCoordinate(maxSigma, minSigma, maxSigma, LAPLACE_SURFACE_FRAME.width) -
                    laplaceCoordinate(boundary, minSigma, maxSigma, LAPLACE_SURFACE_FRAME.width)
                ),
                depth: LAPLACE_SURFACE_FRAME.depth,
                color: 0x4ade80,
                opacity: 0.08,
                position: toScene((maxSigma + boundary) / 2, (minOmega + maxOmega) / 2, 0.01)
            });
        }
    }

    if (!options.showPolesZeros) return overlays;
    const markerHeight = laplaceSurfaceFrame(surface, options.mode).yMax + 0.16;
    poles.forEach(point => overlays.push({
        type: 'marker',
        shape: 'pole',
        color: 0xfb923c,
        position: toScene(point.sigma, point.omega, markerHeight)
    }));
    zeros.forEach(point => overlays.push({
        type: 'marker',
        shape: 'zero',
        color: 0x67e8f9,
        position: toScene(point.sigma, point.omega, markerHeight)
    }));
    return overlays;
}
