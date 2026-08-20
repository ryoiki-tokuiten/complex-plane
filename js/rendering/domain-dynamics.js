import { eventBus } from '../store/events.js';
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

const TILE_SIZE = 256;
const MAX_WORKERS = 6;
const RENDER_SETTLE_MS = 8;
const SUPPORTED_FUNCTIONS = new Set([
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
let activeBackend = null;
let activeJobId = 0;
let pendingStartTimer = 0;

function cloneComplex(value) {
    const complex = requireFiniteComplex(value, 'Domain dynamics parameter');
    return { re: complex.re, im: complex.im };
}

function cloneComplexList(values) {
    if (!Array.isArray(values)) throw new Error('Domain dynamics requires a complex-value array.');
    return values.map(value => cloneComplex(value));
}

function clonePlainData(value) {
    if (Array.isArray(value)) return value.map(clonePlainData);
    if (!value || typeof value !== 'object') return value;

    const clone = {};
    for (const [key, nested] of Object.entries(value)) {
        clone[key] = clonePlainData(nested);
    }
    return clone;
}

function cloneAlgebraicTerms(terms) {
    if (!Array.isArray(terms)) throw new Error('Domain dynamics requires an algebraic term array.');
    return terms.map((term, index) => {
        if (!Array.isArray(term?.factors)) {
            throw new Error(`Domain dynamics algebraic term ${index} requires a factor array.`);
        }
        return {
            coeff: cloneComplex(term?.coeff),
            factors: term.factors.map(clonePlainData)
        };
    });
}

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

function normalizeChainMode(mode) {
    if (mode !== 'zero_seed' && mode !== 'recursion') {
        throw new Error(`Unsupported domain-dynamics chain mode: ${mode}`);
    }
    return mode;
}

function dynamicParameters(config) {
    if (!Array.isArray(config.parameters)) throw new Error('Domain dynamics requires a dynamic parameter array.');
    return Object.fromEntries(config.parameters.map(parameter => {
        const name = String(parameter?.name ?? '').trim();
        const value = Number(parameter?.value);
        if (!name || !Number.isFinite(value)) {
            throw new Error('Domain-dynamics parameters require a name and finite value.');
        }
        return [name, { re: value, im: 0 }];
    }));
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
    const parameters = dynamicParameters(config);
    const source = generateDiscreteSource(clonePlainData(config.source), { parameters });

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
        aggregateParameter: { re: 0, im: 0 },
        parameters
    });
    return compileNativeDynamicAggregate({
        pointExpression: config.pointExpression,
        term: clonePlainData(config.term),
        bindings: clonePlainData(bindings),
        reductionKind,
        invalidPolicy: config.reduction.invalidPolicy,
        parameters,
        sourceRecords: source.records.slice(0, visibleCount).map(record => ({
            ordinal: record.ordinal,
            domainValue: cloneComplex(record.domainValue)
        })),
        bindingSeries: clonePlainData(bindingResult.series)
    });
}

function taylorSnapshot(runtimeState, functionKey) {
    if (!runtimeState?.taylorSeriesEnabled) return null;

    const center = cloneComplex(runtimeState.taylorSeriesCenter);
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
        coefficients: clonePlainData(coefficients)
    };
}

export function buildPlanarDomainDynamicsSnapshot(runtimeState, planeParams, options = null) {
    if (!runtimeState || !planeParams) throw new Error('Domain dynamics requires state and plane parameters.');
    const preciseViewport = preciseViewportSnapshot(planeParams);
    const ranges = preciseViewport ? null : planeRanges(planeParams);
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
        expBase: cloneComplex(runtimeState.expBase),
        logBase: cloneComplex(runtimeState.logBase),
        besselOrder: cloneComplex(runtimeState.besselOrder),
        chainingEnabled: runtimeState.chainingEnabled,
        chainMode: normalizeChainMode(runtimeState.chainingMode),
        chainCount: normalizeDomainDynamicsChainCount(runtimeState.chainCount),
        orbitColoringMode,
        algebraicChainingEnabled: runtimeState.algebraicChainingEnabled,
        algebraicChainingTerms: cloneAlgebraicTerms(runtimeState.algebraicChainingTerms),
        algebraicChainingZExpr: clonePlainData(runtimeState.algebraicChainingZExpr),
        mobiusA: cloneComplex(runtimeState.mobiusA),
        mobiusB: cloneComplex(runtimeState.mobiusB),
        mobiusC: cloneComplex(runtimeState.mobiusC),
        mobiusD: cloneComplex(runtimeState.mobiusD),
        polynomialN,
        polynomialCoeffs: cloneComplexList(runtimeState.polynomialCoeffs),
        fractionalPowerN,
        branchCutType: runtimeState.branchCutType,
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
        viewport: preciseViewport || {
            width,
            height,
            xRange: ranges.xRange,
            yRange: ranges.yRange
        }
    };

    if (snapshot.polynomialCoeffs.length !== snapshot.polynomialN + 1 ||
        (snapshot.branchCutType !== 'draw' && snapshot.branchCutType !== 'ray')) {
        throw new Error('Domain dynamics received invalid native map or style parameters.');
    }

    return freezeDomainDynamicsSnapshot(snapshot);
}

function canUseWorker() {
    return typeof Worker !== 'undefined' && typeof URL !== 'undefined';
}

function workerCount() {
    if (typeof navigator === 'undefined' || !Number.isFinite(navigator.hardwareConcurrency)) {
        throw new Error('Domain dynamics requires a finite browser hardware-concurrency value.');
    }
    const cores = navigator.hardwareConcurrency;
    return Math.max(1, Math.min(MAX_WORKERS, cores));
}

function createTileList(width, height) {
    const tiles = [];
    for (let y = 0; y < height; y += TILE_SIZE) {
        for (let x = 0; x < width; x += TILE_SIZE) {
            tiles.push({
                x,
                y,
                width: Math.min(TILE_SIZE, width - x),
                height: Math.min(TILE_SIZE, height - y),
                scale: 1,
                adaptiveQuality: true
            });
        }
    }
    return tiles;
}

function createImageDataFromPixels(pixels, width, height) {
    if (typeof ImageData === 'undefined') {
        throw new Error('Domain dynamics requires ImageData support.');
    }
    return new ImageData(pixels, width, height);
}

function createStagingTarget(targetCtx, viewport) {
    const ownerDocument = targetCtx.canvas?.ownerDocument;
    if (!ownerDocument || typeof ownerDocument.createElement !== 'function') {
        throw new Error('Domain dynamics requires a canvas-backed rendering target.');
    }
    const canvas = ownerDocument.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Domain dynamics could not allocate its final-frame canvas.');
    return { canvas, context };
}

function commitFinalFrame(job) {
    job.targetCtx.save();
    try {
        job.targetCtx.setTransform(1, 0, 0, 1, 0, 0);
        job.targetCtx.clearRect(0, 0, job.snapshot.viewport.width, job.snapshot.viewport.height);
        job.targetCtx.drawImage(job.staging.canvas, 0, 0);
    } finally {
        job.targetCtx.restore();
    }
}

function snapshotViewport(viewport) {
    return Object.freeze(viewport.xRange
        ? { width: viewport.width, height: viewport.height,
            xRange: [...viewport.xRange], yRange: [...viewport.yRange] }
        : { ...viewport });
}

function setDomainProcessing(isProcessing) {
    runtime.rendering.processingDomainDynamics = isProcessing;

    if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
        const indicator = document.getElementById('z_plane_rendering_indicator');
        if (indicator) {
            if (isProcessing) {
                indicator.classList.remove('hidden');
            } else {
                indicator.classList.add('hidden');
            }
        }
    }
}

class WorkerNativeDomainDynamicsBackend {
    constructor() {
        this.id = 'worker-native';
        this.workers = [];
        this.queue = [];
        this.queueIndex = 0;
        this.remainingTiles = 0;
        this.activeJob = null;
    }

    start(job) {
        if (this.activeJob && !this.activeJob.cancelled && !this.activeJob.complete) {
            throw new Error('Domain dynamics cannot start a second native job before cancellation.');
        }
        this.activeJob = {
            ...job,
            cancelled: false,
            complete: false,
            staging: createStagingTarget(job.targetCtx, job.snapshot.viewport),
            startedAt: performance.now(),
            workerMilliseconds: 0,
            maximumTileMilliseconds: 0
        };
        const previous = runtime.rendering.domainDynamicsStats;
        runtime.rendering.domainDynamicsStats = Object.freeze({
            state: 'rendering',
            jobId: job.id,
            width: job.snapshot.viewport.width,
            height: job.snapshot.viewport.height,
            totalTiles: Math.ceil(job.snapshot.viewport.width / TILE_SIZE) *
                Math.ceil(job.snapshot.viewport.height / TILE_SIZE),
            completedTiles: 0,
            completedJobs: previous.completedJobs,
            cancelledJobs: previous.cancelledJobs
        });
        this.ensureWorkers();
        this.initializeWorkerJobs(this.activeJob);
        this.startTiles();
        return true;
    }

    cancel(jobId = null) {
        const job = this.activeJob;
        if (!job || job.complete || job.cancelled || (jobId !== null && job.id !== jobId)) return false;
        job.cancelled = true;
        setDomainProcessing(false);
        this.queue = [];
        this.queueIndex = 0;
        this.remainingTiles = 0;
        this.workers.forEach(entry => {
            entry.busy = false;
            entry.worker.postMessage({ type: 'cancel', jobId: job.id });
        });
        const previous = runtime.rendering.domainDynamicsStats;
        runtime.rendering.domainDynamicsStats = Object.freeze({
            ...previous,
            state: 'cancelled',
            cancelledJobs: previous.cancelledJobs + 1
        });
        return true;
    }

    ensureWorkers() {
        if (this.workers.length) return;
        if (!canUseWorker()) throw new Error('Domain dynamics requires a module Worker.');
        const count = workerCount();
        for (let i = 0; i < count; i += 1) {
            const worker = new Worker(new URL('./domain-dynamics-worker.js', import.meta.url), { type: 'module' });
            const entry = { worker, busy: false, ready: false };
            worker.onmessage = event => this.handleWorkerMessage(entry, event.data);
            worker.onerror = error => {
                this.cancel();
                throw new Error(`Native domain worker failed: ${error?.message || error}`);
            };
            this.workers.push(entry);
        }
    }

    initializeWorkerJobs(job) {
        this.workers.forEach(entry => {
            entry.busy = false;
            if (entry.ready) {
                entry.worker.postMessage({
                    type: 'start',
                    jobId: job.id,
                    snapshot: job.snapshot
                });
            }
        });
    }

    startTiles() {
        const job = this.activeJob;
        if (!job || job.cancelled) return;

        const width = job.snapshot.viewport.width;
        const height = job.snapshot.viewport.height;
        this.queue = createTileList(width, height);
        this.queueIndex = 0;
        this.remainingTiles = this.queue.length;

        this.workers.forEach(worker => {
            worker.busy = false;
            this.dispatchWorker(worker);
        });
    }

    dispatchWorker(entry) {
        const job = this.activeJob;
        if (!entry.ready || !job || job.cancelled || entry.busy || this.remainingTiles === 0) return;

        const tile = this.queue[this.queueIndex];
        if (!tile) return;
        this.queueIndex += 1;

        entry.busy = true;
        const message = {
            type: 'tile',
            jobId: job.id,
            tile
        };
        entry.worker.postMessage(message);
    }

    handleWorkerMessage(entry, message) {
        if (message?.type === 'ready') {
            entry.ready = true;
            if (this.activeJob && !this.activeJob.cancelled) {
                entry.worker.postMessage({
                    type: 'start',
                    jobId: this.activeJob.id,
                    snapshot: this.activeJob.snapshot
                });
                this.dispatchWorker(entry);
            }
            return;
        }

        entry.busy = false;
        this.handleTileMessage(message);
        this.dispatchWorker(entry);
    }

    handleTileMessage(message) {
        const job = this.activeJob;
        if (!job || job.cancelled || message.jobId !== job.id) return;

        if (message.type === 'error') {
            this.cancel(job.id);
            if (activeJobId === job.id) {
                activeSignature = null;
                activeJobId = 0;
            }
            queueMicrotask(() => { throw new Error(`Native domain worker failed: ${message.message}`); });
            return;
        } else if (message.type === 'tile') {
            const image = createImageDataFromPixels(message.pixels, message.tile.width, message.tile.height);
            job.staging.context.putImageData(image, message.tile.x, message.tile.y);
            const tileMilliseconds = Number(message.renderMilliseconds);
            if (!Number.isFinite(tileMilliseconds) || tileMilliseconds < 0) {
                throw new Error('Native domain worker returned invalid timing data.');
            }
            job.workerMilliseconds += tileMilliseconds;
            job.maximumTileMilliseconds = Math.max(job.maximumTileMilliseconds, tileMilliseconds);
            this.remainingTiles -= 1;
            runtime.rendering.domainDynamicsStats = Object.freeze({
                ...runtime.rendering.domainDynamicsStats,
                completedTiles: runtime.rendering.domainDynamicsStats.completedTiles + 1
            });
        } else {
            throw new Error(`Unsupported native domain worker message: ${message.type}.`);
        }

        if (this.remainingTiles === 0) {
            commitFinalFrame(job);
            job.complete = true;
            runtime.rendering.domainViewport = snapshotViewport(job.snapshot.viewport);
            setDomainProcessing(false);
            this.queue = [];
            this.queueIndex = 0;
            this.workers.forEach(entry => {
                entry.busy = false;
                entry.worker.postMessage({ type: 'cancel', jobId: job.id });
            });
            const previous = runtime.rendering.domainDynamicsStats;
            runtime.rendering.domainDynamicsStats = Object.freeze({
                ...previous,
                state: 'complete',
                wallMilliseconds: performance.now() - job.startedAt,
                workerMilliseconds: job.workerMilliseconds,
                maximumTileMilliseconds: job.maximumTileMilliseconds,
                completedJobs: previous.completedJobs + 1
            });
            eventBus.emit('redraw:all');
        }
    }

}

const workerBackend = new WorkerNativeDomainDynamicsBackend();

export function selectDomainDynamicsBackend() {
    return workerBackend;
}

function startDomainJob(job) {
    if (activeSignature !== job.signature || activeJobId !== job.id) return;
    pendingStartTimer = 0;
    const selected = selectDomainDynamicsBackend();
    activeBackend = selected;
    selected.start(job);
    setDomainProcessing(true);
}

export function renderPlanarDomainDynamics(targetCtx, planeParams, snapshot) {
    if (!targetCtx || !planeParams || !snapshot) {
        throw new Error('Domain dynamics rendering requires a target, plane parameters, and snapshot.');
    }

    const signature = domainDynamicsSignature(snapshot);
    if (signature === activeSignature) return true;

    if (pendingStartTimer) {
        clearTimeout(pendingStartTimer);
        pendingStartTimer = 0;
    }
    if (activeBackend) activeBackend.cancel();

    activeSignature = signature;

    activeJobId = nextJobId;
    nextJobId += 1;

    const job = {
        id: activeJobId,
        signature,
        targetCtx,
        snapshot
    };

    if (runtime.rendering.domainViewport) {
        const previous = runtime.rendering.domainDynamicsStats;
        runtime.rendering.domainDynamicsStats = Object.freeze({
            state: 'scheduled',
            jobId: job.id,
            width: snapshot.viewport.width,
            height: snapshot.viewport.height,
            completedJobs: previous.completedJobs,
            cancelledJobs: previous.cancelledJobs
        });
        pendingStartTimer = setTimeout(() => startDomainJob(job), RENDER_SETTLE_MS);
    } else {
        startDomainJob(job);
    }
    return true;
}

export function cancelPlanarDomainDynamics() {
    if (pendingStartTimer) {
        clearTimeout(pendingStartTimer);
        pendingStartTimer = 0;
    }
    if (activeBackend) activeBackend.cancel();
    activeSignature = null;
    activeJobId = 0;
    runtime.rendering.domainViewport = null;
    const previous = runtime.rendering.domainDynamicsStats;
    runtime.rendering.domainDynamicsStats = Object.freeze({
        state: 'idle',
        completedJobs: previous.completedJobs,
        cancelledJobs: previous.cancelledJobs
    });
}
