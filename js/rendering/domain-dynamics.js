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
import { clonePlain } from '../utils/clone-utils.js';

const TILE_SIZE = 64;
const MAX_WORKERS = 16;
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
    const source = generateDiscreteSource(clonePlain(config.source), { parameters });

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
        term: clonePlain(config.term),
        bindings: clonePlain(bindings),
        reductionKind,
        invalidPolicy: config.reduction.invalidPolicy,
        parameters,
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
        viewport: domainViewportSnapshot(planeParams, width, height)
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

function clearRenderTarget(job) {
    job.targetCtx.save();
    try {
        job.targetCtx.setTransform(1, 0, 0, 1, 0, 0);
        job.targetCtx.clearRect(0, 0, job.snapshot.viewport.width, job.snapshot.viewport.height);
    } finally {
        job.targetCtx.restore();
    }
}

function snapshotViewport(viewport) {
    return Object.freeze({ ...viewport });
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
            startedAt: performance.now(),
            workerMilliseconds: 0,
            maximumTileMilliseconds: 0
        };
        clearRenderTarget(this.activeJob);
        runtime.rendering.domainViewport = snapshotViewport(job.snapshot.viewport);
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
            entry.jobId = 0;
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
            const entry = { worker, busy: false, ready: false, jobId: 0 };
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
            entry.jobId = 0;
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
            worker.jobId = 0;
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
        entry.jobId = job.id;
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
            if (this.activeJob && !this.activeJob.cancelled && !this.activeJob.complete) {
                entry.worker.postMessage({
                    type: 'start',
                    jobId: this.activeJob.id,
                    snapshot: this.activeJob.snapshot
                });
                this.dispatchWorker(entry);
            }
            return;
        }

        if (message?.jobId !== entry.jobId) return;
        entry.busy = false;
        entry.jobId = 0;
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
            job.targetCtx.putImageData(image, message.tile.x, message.tile.y);
            const tileMilliseconds = Number(message.renderMilliseconds);
            if (!Number.isFinite(tileMilliseconds) || tileMilliseconds < 0) {
                this.cancel(job.id);
                throw new Error('Native domain worker returned invalid timing data.');
            }
            job.workerMilliseconds += tileMilliseconds;
            job.maximumTileMilliseconds = Math.max(job.maximumTileMilliseconds, tileMilliseconds);
            this.remainingTiles -= 1;
            runtime.rendering.domainDynamicsStats = Object.freeze({
                ...runtime.rendering.domainDynamicsStats,
                completedTiles: runtime.rendering.domainDynamicsStats.completedTiles + 1
            });
            eventBus.emit('redraw:all');
        } else {
            this.cancel(job.id);
            throw new Error(`Unsupported native domain worker message: ${message.type}.`);
        }

        if (this.remainingTiles === 0) {
            job.complete = true;
            runtime.rendering.domainViewport = snapshotViewport(job.snapshot.viewport);
            setDomainProcessing(false);
            this.queue = [];
            this.queueIndex = 0;
            this.workers.forEach(entry => {
                entry.busy = false;
                entry.jobId = 0;
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

export function renderPlanarDomainDynamics(targetCtx, planeParams, snapshot) {
    if (!targetCtx || !planeParams || !snapshot) {
        throw new Error('Domain dynamics rendering requires a target, plane parameters, and snapshot.');
    }

    const signature = domainDynamicsSignature(snapshot);
    if (signature === activeSignature) return true;

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

    activeBackend = selectDomainDynamicsBackend();
    activeBackend.start(job);
    setDomainProcessing(true);
    return true;
}

export function cancelPlanarDomainDynamics() {
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
