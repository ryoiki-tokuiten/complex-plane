import { requestUiRedraw } from './redraw-scheduler.js';
import { getDomainPaletteStops } from '../constants/domain-palettes.js';
import { runtime } from '../store/runtime.js';
import { generateDiscreteSource } from '../analysis/discrete-sources.js';
import { generateSequenceBindingSeries, synchronizeSequenceBindings } from '../analysis/sequence-bindings.js';
import { computeTaylorSeriesCoefficients } from '../native/map-runtime.js';
import { compileNativeDynamicAggregate } from '../native/complex-engine.js';
import {
    domainDynamicsSignature,
    freezeDomainDynamicsSnapshot
} from '../native/domain-engine.js';
import {
    normalizeOrbitColoringMode
} from '../constants/rendering.js';
import { normalizeDomainDynamicsChainCount } from '../constants/domain-dynamics.js';
import { preciseViewportSnapshot } from '../native/precise-viewport.js';
import { requireVisibleViewport } from '../utils/viewport.js';
import {
    requireFiniteComplex,
    requireFiniteNumber,
    requireInteger
} from '../utils/numeric-contracts.js';
import { clonePlain } from '../utils/clone-utils.js';
import { signal } from '@preact/signals';

const SUPPORTED_FUNCTIONS = new Set([
    'sin',
    'cos',
    'tan',
    'sec',
    'exp',
    'ln',
    'sinh',
    'tanh',
    'asin',
    'atan',
    'gamma',
    'loggamma',
    'bessel',
    'power',
    'mobius',
    'zeta',
    'polynomial',
    'algebraic_chaining'
]);

let nextJobId = 1;
let activeSignature = null;
let activeJobId = 0;

function paletteStops(paletteId) {
    const stops = getDomainPaletteStops(paletteId);
    if (stops.length < 2) throw new Error(`Domain palette ${paletteId} has fewer than two stops.`);
    return stops;
}

function planeRanges(planeParams) {
    requireVisibleViewport(planeParams, 'Domain-dynamics viewport');
    return {
        xRange: planeParams.currentVisXRange.slice(0, 2),
        yRange: planeParams.currentVisYRange.slice(0, 2)
    };
}

function domainViewportSnapshot(planeParams, width, height) {
    const precise = preciseViewportSnapshot(planeParams);
    if (precise) {
        const xSpan = 7 * 10 ** -precise.zoomPower;
        const ySpan = xSpan * height / width;
        if (!(xSpan > 0) || !(ySpan > 0)) {
            throw new Error('Domain-dynamics viewport span is outside the supported MPFR exponent range.');
        }
        return {
            width,
            height,
            centerRe: precise.centerRe,
            centerIm: precise.centerIm,
            xSpan: String(xSpan),
            ySpan: String(ySpan),
            precisionBits: precise.precisionBits
        };
    }

    const ranges = planeRanges(planeParams);
    const xSpan = ranges.xRange[1] - ranges.xRange[0];
    const ySpan = ranges.yRange[1] - ranges.yRange[0];
    return {
        width,
        height,
        centerRe: String((ranges.xRange[0] + ranges.xRange[1]) * 0.5),
        centerIm: String((ranges.yRange[0] + ranges.yRange[1]) * 0.5),
        xSpan: String(xSpan),
        ySpan: String(ySpan),
        precisionBits: 256
    };
}

export function matchesPlanarDomainViewport(viewport, planeParams) {
    if (!viewport || !planeParams) return false;

    const current = domainViewportSnapshot(planeParams, planeParams.width, planeParams.height);
    return viewport.width === current.width &&
        viewport.height === current.height &&
        viewport.centerRe === current.centerRe &&
        viewport.centerIm === current.centerIm &&
        viewport.xSpan === current.xSpan &&
        viewport.ySpan === current.ySpan &&
        viewport.precisionBits === current.precisionBits;
}

function normalizeChainMode(mode) {
    if (mode !== 'zero_seed' && mode !== 'recursion') {
        throw new Error(`Unsupported domain-dynamics chain mode: ${mode}`);
    }
    return mode;
}

function dynamicAggregateSnapshot(runtimeState) {
    const config = runtimeState?.dynamicPlotting;
    const reductionKind = config?.reduction?.kind;
    if (!config?.enabled || config.mode !== 'aggregate' ||
        (reductionKind !== 'sum' && reductionKind !== 'product')) return null;

    if (!config.source || !config.term || !config.playback || typeof config.pointExpression !== 'string') {
        throw new Error('Domain dynamics requires complete dynamic aggregate configuration.');
    }
    if (config.reduction.invalidPolicy !== 'stop' && config.reduction.invalidPolicy !== 'skip') {
        throw new Error(`Unsupported dynamic invalid policy: ${config.reduction.invalidPolicy}.`);
    }
    const source = generateDiscreteSource(clonePlain(config.source));

    const requestedVisibleCount = Number(config.playback?.visibleCount);
    if (!Number.isFinite(requestedVisibleCount)) {
        throw new Error('Domain dynamics requires a finite dynamic visible count.');
    }
    const visibleCount = Math.max(0, Math.min(source.records.length, Math.floor(requestedVisibleCount)));

    if (config.term.kind !== 'expression' && config.term.kind !== 'selected-function') {
        throw new Error(`Unsupported dynamic term kind: ${config.term.kind}.`);
    }
    const termExpression = config.term.kind === 'expression' ? config.term.expression : 'selected(z)';
    if (typeof termExpression !== 'string' || !Array.isArray(config.term.bindings)) {
        throw new Error('Domain dynamics requires explicit dynamic term bindings.');
    }
    const bindings = synchronizeSequenceBindings(termExpression, config.term.bindings);

    const bindingResult = generateSequenceBindingSeries(bindings, visibleCount, {
        aggregateParameter: { re: 0, im: 0 }
    });
    return compileNativeDynamicAggregate({
        pointExpression: config.pointExpression,
        term: clonePlain(config.term),
        bindings: clonePlain(bindings),
        reductionKind,
        invalidPolicy: config.reduction.invalidPolicy,
        sourceRecords: source.records.slice(0, visibleCount).map(record => ({
            ordinal: record.ordinal,
            domainValue: clonePlain(record.domainValue)
        })),
        bindingSeries: clonePlain(bindingResult.series)
    });
}

function taylorSnapshot(runtimeState, functionKey) {
    if (!runtimeState?.taylorSeriesEnabled) return null;

    const center = clonePlain(runtimeState.taylorSeriesCenter);
    const order = requireInteger(runtimeState.taylorSeriesOrder, 'Taylor order');
    if (order < 0) throw new Error('Taylor order must be non-negative.');
    const coefficients = computeTaylorSeriesCoefficients(functionKey, center, order);
    if (!Array.isArray(coefficients) || coefficients.length < order + 1) {
        throw new Error('Native Taylor coefficient generation returned incomplete data.');
    }
    const radius = Number(runtimeState.taylorSeriesConvergenceRadius);
    if ((!Number.isFinite(radius) && radius !== Infinity) || radius < 0) {
        throw new Error('Taylor convergence radius must be non-negative or infinite.');
    }

    return {
        center,
        order,
        radius,
        coefficients: clonePlain(coefficients)
    };
}

export function buildPlanarDomainDynamicsSnapshot(runtimeState, planeParams, options = null) {
    if (!runtimeState || !planeParams) throw new Error('Domain dynamics requires state and plane parameters.');
    const width = requireInteger(planeParams.width, 'Domain-dynamics viewport width');
    const height = requireInteger(planeParams.height, 'Domain-dynamics viewport height');
    if (width < 1 || height < 1) {
        throw new Error('Domain dynamics requires positive integer viewport dimensions.');
    }

    const functionKey = runtimeState.currentFunction;
    if (!SUPPORTED_FUNCTIONS.has(functionKey)) {
        throw new Error(`Unsupported native domain-dynamics function: ${functionKey}`);
    }
    const orbitColoringMode = normalizeOrbitColoringMode(runtimeState.orbitColoringMode);

    const polynomialN = requireInteger(runtimeState.polynomialN, 'Domain dynamics polynomial degree');
    if (polynomialN < 0) throw new Error('Domain dynamics polynomial degree must be non-negative.');
    const fractionalPowerN = requireFiniteNumber(runtimeState.fractionalPowerN, 'Domain dynamics fractional power');
    const branchCutAngle = requireFiniteNumber(runtimeState.branchCutAngle, 'Domain dynamics branch-cut angle');
    const mapPresentation = options?.mapPresentation ?? runtimeState.mapPresentation;
    if (mapPresentation !== 'function' && mapPresentation !== 'derivative') {
        throw new Error(`Unsupported domain-dynamics map presentation: ${mapPresentation}.`);
    }
    for (const [name, value] of [
        ['chainingEnabled', runtimeState.chainingEnabled],
        ['algebraicChainingEnabled', runtimeState.algebraicChainingEnabled],
        ['zetaContinuationEnabled', runtimeState.zetaContinuationEnabled]
    ]) {
        if (typeof value !== 'boolean') throw new Error(`Domain dynamics ${name} must be boolean.`);
    }
    const snapshot = {
        derivativeOrder: mapPresentation === 'derivative' ? 1 : 0,
        functionKey,
        expBase: clonePlain(runtimeState.expBase),
        logBase: clonePlain(runtimeState.logBase),
        besselOrder: clonePlain(runtimeState.besselOrder),
        chainingEnabled: runtimeState.chainingEnabled,
        chainMode: normalizeChainMode(runtimeState.chainingMode),
        chainSeed: clonePlain(requireFiniteComplex(runtimeState.chainSeed ?? { re: 0, im: 0 }, 'Domain-dynamics chain seed')),
        chainCount: normalizeDomainDynamicsChainCount(runtimeState.chainCount),
        orbitColoringMode,
        algebraicChainingEnabled: runtimeState.algebraicChainingEnabled,
        algebraicChainingTerms: clonePlain(runtimeState.algebraicChainingTerms),
        algebraicChainingZExpr: clonePlain(runtimeState.algebraicChainingZExpr),
        mobiusA: clonePlain(runtimeState.mobiusA),
        mobiusB: clonePlain(runtimeState.mobiusB),
        mobiusC: clonePlain(runtimeState.mobiusC),
        mobiusD: clonePlain(runtimeState.mobiusD),
        polynomialN,
        polynomialCoeffs: clonePlain(runtimeState.polynomialCoeffs),
        fractionalPowerN,
        branchCutAngle,
        zetaContinuationEnabled: runtimeState.zetaContinuationEnabled,
        taylor: taylorSnapshot(runtimeState, functionKey),
        dynamicAggregate: dynamicAggregateSnapshot(runtimeState),
        style: {
            brightness: requireFiniteNumber(runtimeState.domainBrightness, 'Domain brightness'),
            contrast: requireFiniteNumber(runtimeState.domainContrast, 'Domain contrast'),
            saturation: requireFiniteNumber(runtimeState.domainSaturation, 'Domain saturation'),
            lightnessCycles: requireFiniteNumber(runtimeState.domainLightnessCycles, 'Domain lightness cycles')
        },
        paletteStops: paletteStops(runtimeState.domainPalette),
        viewport: domainViewportSnapshot(planeParams, width, height)
    };

    if (snapshot.polynomialCoeffs.length !== snapshot.polynomialN + 1) {
        throw new Error('Domain dynamics received invalid native map or style parameters.');
    }

    return freezeDomainDynamicsSnapshot(snapshot);
}

function clearRenderTarget(job) {
    job.targetCtx.save();
    try {
        job.targetCtx.setTransform(1, 0, 0, 1, 0, 0);
        job.targetCtx.clearRect(0, 0, job.snapshot.viewport.width, job.snapshot.viewport.height);
    } finally { job.targetCtx.restore(); }
}

export const domainProcessing = signal(false);
export const domainError = signal(null);
function setDomainProcessing(value) {
    runtime.rendering.processingDomainDynamics = value;
    domainProcessing.value = value;
}

class DomainBackend {
    constructor() { this.id = 'webgl2-delta'; this.activeJob = null; this.worker = null; this.ready = false; }
    start(job) {
        this.activeJob = { ...job, complete: false, cancelled: false };
        clearRenderTarget(job);
        domainError.value = null;
        runtime.rendering.domainViewport = Object.freeze({ ...job.snapshot.viewport });
        const previous = runtime.rendering.domainDynamicsStats;
        runtime.rendering.domainDynamicsStats = Object.freeze({
            state: 'rendering', jobId: job.id, width: job.snapshot.viewport.width,
            height: job.snapshot.viewport.height, completedSamples: 0,
            totalSamples: job.snapshot.viewport.width * job.snapshot.viewport.height * 4 * (job.snapshot.derivativeOrder ? 2 : 1),
            completedJobs: previous.completedJobs, cancelledJobs: previous.cancelledJobs
        });
        if (typeof Worker === 'undefined') throw new Error('Domain coloring requires a module Worker.');
        if (!this.worker) {
            this.worker = new Worker(new URL('./domain/worker.js', import.meta.url), { type: 'module' });
            const worker = this.worker;
            worker.onmessage = ({ data }) => {
                if (this.worker === worker) this.receive(data);
                else data.bitmap?.close();
            };
            worker.onerror = error => {
                if (this.worker === worker) this.fail(error.message || 'Domain worker failed.');
            };
        }
        setDomainProcessing(true);
        if (this.ready) this.worker.postMessage({ type: 'start', jobId: job.id, snapshot: job.snapshot });
        return true;
    }
    receive(message) {
        const job = this.activeJob;
        if (message.type === 'ready') {
            this.ready = true;
            if (job && !job.cancelled && !job.complete) this.worker.postMessage({ type: 'start', jobId: job.id, snapshot: job.snapshot });
            return;
        }
        if (!job || job.cancelled || job.complete || message.jobId !== job.id) { message.bitmap?.close(); return; }
        if (message.type === 'error') { this.fail(message.message); return; }
        if (message.type === 'progress') {
            runtime.rendering.domainDynamicsStats = Object.freeze({ ...runtime.rendering.domainDynamicsStats, stage: message.stage, terms: message.terms, precisionBits: message.precisionBits, pendingSamples: message.pendingSamples });
        } else if (message.type === 'frame') {
            job.targetCtx.save();
            try {
                job.targetCtx.setTransform(1, 0, 0, 1, 0, 0);
                job.targetCtx.clearRect(0, 0, job.snapshot.viewport.width, job.snapshot.viewport.height);
                job.targetCtx.drawImage(message.bitmap, 0, 0);
            } finally { job.targetCtx.restore(); message.bitmap.close(); }
            runtime.rendering.domainDynamicsStats = Object.freeze({ ...runtime.rendering.domainDynamicsStats, ...message.stats });
        } else if (message.type === 'complete') {
            job.complete = true; setDomainProcessing(false);
            const previous = runtime.rendering.domainDynamicsStats;
            runtime.rendering.domainDynamicsStats = Object.freeze({ ...previous, state: 'complete', completedJobs: previous.completedJobs + 1 });
        } else { this.fail(`Unknown domain renderer message: ${message.type}`); return; }
        requestUiRedraw();
    }
    fail(message) {
        this.worker?.terminate(); this.worker = null; this.ready = false;
        const job = this.activeJob;
        if (job) job.complete = true;
        setDomainProcessing(false); domainError.value = message;
        runtime.rendering.domainDynamicsStats = Object.freeze({ ...runtime.rendering.domainDynamicsStats, state: 'failed', error: message });
        requestUiRedraw();
    }
    shutdown() {
        this.cancel();
        this.worker?.terminate(); this.worker = null; this.ready = false;
    }
    cancel() {
        const job = this.activeJob;
        if (!job || job.complete || job.cancelled) return false;
        job.cancelled = true;
        if (this.ready) this.worker.postMessage({ type: 'cancel', jobId: job.id });
        setDomainProcessing(false);
        const previous = runtime.rendering.domainDynamicsStats;
        runtime.rendering.domainDynamicsStats = Object.freeze({ ...previous, state: 'cancelled', cancelledJobs: previous.cancelledJobs + 1 });
        return true;
    }
}
const backend = new DomainBackend();
export function selectDomainDynamicsBackend() { return backend; }
export function renderPlanarDomainDynamics(targetCtx, planeParams, snapshot) {
    if (!targetCtx || !planeParams || !snapshot) throw new Error('Domain rendering requires a target and snapshot.');
    const signature = domainDynamicsSignature(snapshot);
    if (signature === activeSignature) return true;
    backend.cancel(); activeSignature = signature; activeJobId = nextJobId++;
    try { return backend.start({ id: activeJobId, signature, targetCtx, snapshot }); }
    catch (error) { backend.fail(error.message); return false; }
}
export function cancelPlanarDomainDynamics() {
    backend.shutdown(); activeSignature = null; activeJobId = 0; domainError.value = null;
    runtime.rendering.domainViewport = null;
    const previous = runtime.rendering.domainDynamicsStats;
    runtime.rendering.domainDynamicsStats = Object.freeze({ state: 'idle', completedJobs: previous.completedJobs, cancelledJobs: previous.cancelledJobs });
}
