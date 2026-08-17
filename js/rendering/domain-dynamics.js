import { eventBus } from '../store/events.js';
import { getDomainPaletteStops } from '../constants/domain-palettes.js';
import { runtime } from '../store/runtime.js';
import { generateDiscreteSource } from '../analysis/discrete-sources.js';
import { generateSequenceBindingSeries, synchronizeSequenceBindings } from '../analysis/sequence-bindings.js';
import { computeTaylorSeriesCoefficients } from '../native/map-runtime.js';
import { compileNativeDynamicAggregate } from '../native/complex-engine.js';
import {
    domainDynamicsSignature,
    freezeDomainDynamicsSnapshot,
    isDomainDynamicsSnapshot
} from '../native/domain-engine.js';
import {
    normalizeOrbitColoringMode
} from '../constants/rendering.js';
import { normalizeDomainDynamicsChainCount } from '../constants/domain-dynamics.js';
import { preciseViewportSnapshot } from '../native/precise-viewport.js';

const PASS_SCALES = Object.freeze([16, 4, 1]);
const TILE_SIZE = 64;
const MAX_WORKERS = 16;
const SUPPORTED_FUNCTIONS = new Set([
    'cos',
    'sin',
    'tan',
    'sec',
    'exp',
    'ln',
    'reciprocal',
    'sinh',
    'cosh',
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
    'poincare',
    'algebraic_chaining'
]);

let nextJobId = 1;
let activeSignature = null;
let activeBackend = null;
let activeJobId = 0;

function cloneComplex(value, fallback = { re: 0, im: 0 }) {
    const re = Number(value?.re);
    const im = Number(value?.im);
    return {
        re: Number.isFinite(re) ? re : fallback.re,
        im: Number.isFinite(im) ? im : fallback.im
    };
}

function cloneComplexList(values) {
    return Array.isArray(values) ? values.map(value => cloneComplex(value)) : [];
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
    return Array.isArray(terms)
        ? terms.map(term => ({
            coeff: cloneComplex(term?.coeff, { re: 1, im: 0 }),
            factors: Array.isArray(term?.factors)
                ? term.factors.map(clonePlainData)
                : []
        }))
        : [];
}

function paletteStops(paletteId) {
    const stops = getDomainPaletteStops(paletteId);
    return stops.length >= 2 ? stops : [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0]];
}

function planeRanges(planeParams) {
    const xRange = planeParams?.currentVisXRange || planeParams?.xRange;
    const yRange = planeParams?.currentVisYRange || planeParams?.yRange;
    return Array.isArray(xRange) && Array.isArray(yRange)
        ? { xRange: [Number(xRange[0]), Number(xRange[1])], yRange: [Number(yRange[0]), Number(yRange[1])] }
        : null;
}

function normalizeChainMode(mode) {
    return mode === 'zero_seed' ? 'zero_seed' : 'recursion';
}

function dynamicAggregateSnapshot(runtimeState) {
    const config = runtimeState?.dynamicPlotting;
    const reductionKind = config?.reduction?.kind;
    if (!config?.enabled || config.mode !== 'aggregate' ||
        (reductionKind !== 'sum' && reductionKind !== 'product')) return null;

    let source;
    try {
        const parameters = Object.fromEntries((config.parameters || [])
            .map(parameter => [String(parameter?.name || ''), {
                re: Number(parameter?.value) || 0,
                im: 0
            }])
            .filter(([name]) => name));
        source = generateDiscreteSource(clonePlainData(config.source || {}), { parameters });
    } catch {
        return null;
    }

    const requestedVisibleCount = Number(config.playback?.visibleCount);
    const visibleCount = Number.isFinite(requestedVisibleCount)
        ? Math.max(0, Math.min(source.records.length, Math.floor(requestedVisibleCount)))
        : source.records.length;

    const termExpression = String(config.term?.expression ?? 'z');
    const bindings = synchronizeSequenceBindings(termExpression, config.term?.bindings || []);

    const bindingResult = generateSequenceBindingSeries(bindings, visibleCount, {
        aggregateParameter: { re: 0, im: 0 },
        parameters: Object.fromEntries((config.parameters || [])
            .map(parameter => [String(parameter?.name || ''), {
                re: Number(parameter?.value) || 0,
                im: 0
            }])
            .filter(([name]) => name))
    });
    const aggregate = {
        pointExpression: String(config.pointExpression ?? 'd'),
        term: clonePlainData(config.term || { kind: 'expression', expression: 'z', bindings: [] }),
        bindings: clonePlainData(bindings),
        reductionKind,
        invalidPolicy: config.reduction?.invalidPolicy === 'skip' ? 'skip' : 'stop',
        parameters: Object.fromEntries((config.parameters || [])
            .map(parameter => [String(parameter?.name || ''), {
                re: Number(parameter?.value) || 0,
                im: 0
            }])
            .filter(([name]) => name)),
        sourceRecords: source.records.slice(0, visibleCount).map(record => ({
            ordinal: record.ordinal,
            domainValue: cloneComplex(record.domainValue)
        })),
        bindingSeries: clonePlainData(bindingResult.series)
    };
    aggregate.native = compileNativeDynamicAggregate(aggregate);
    return aggregate;
}

function taylorSnapshot(runtimeState, functionKey) {
    if (!runtimeState?.taylorSeriesEnabled) return null;

    const center = cloneComplex(runtimeState.taylorSeriesCenter, { re: 0, im: 0 });
    const order = Math.max(0, Math.floor(Number(runtimeState.taylorSeriesOrder) || 0));
    let coefficients = null;
    try {
        coefficients = computeTaylorSeriesCoefficients(functionKey, center, order);
    } catch {
        coefficients = null;
    }

    return {
        center,
        order,
        radius: Number.isFinite(Number(runtimeState.taylorSeriesConvergenceRadius))
            ? Number(runtimeState.taylorSeriesConvergenceRadius)
            : Infinity,
        coefficients: clonePlainData(coefficients)
    };
}

export function buildPlanarDomainDynamicsSnapshot(runtimeState, planeParams, options = null) {
    const ranges = planeRanges(planeParams);
    const preciseViewport = preciseViewportSnapshot(planeParams);
    if (!runtimeState || !planeParams || (!ranges && !preciseViewport)) return null;

    const functionKey = runtimeState.currentFunction;
    if (!SUPPORTED_FUNCTIONS.has(functionKey)) return null;
    const orbitColoringMode = normalizeOrbitColoringMode(runtimeState.orbitColoringMode);

    const snapshot = {
        isWPlaneColoring: !!options?.isWPlaneColoring,
        derivativeMode: options?.mapPresentation === 'derivative',
        functionKey,
        expBase: cloneComplex(runtimeState.expBase, { re: Math.E, im: 0 }),
        logBase: cloneComplex(runtimeState.logBase, { re: Math.E, im: 0 }),
        besselOrder: cloneComplex(runtimeState.besselOrder),
        chainingEnabled: !!runtimeState.chainingEnabled,
        chainMode: normalizeChainMode(runtimeState.chainingMode),
        chainCount: normalizeDomainDynamicsChainCount(runtimeState.chainCount),
        orbitColoringMode,
        algebraicChainingEnabled: !!runtimeState.algebraicChainingEnabled,
        algebraicChainingTerms: cloneAlgebraicTerms(runtimeState.algebraicChainingTerms),
        algebraicChainingZExpr: clonePlainData(runtimeState.algebraicChainingZExpr || 'z'),
        mobiusA: cloneComplex(runtimeState.mobiusA, { re: 1, im: 0 }),
        mobiusB: cloneComplex(runtimeState.mobiusB),
        mobiusC: cloneComplex(runtimeState.mobiusC),
        mobiusD: cloneComplex(runtimeState.mobiusD, { re: 1, im: 0 }),
        polynomialN: Math.max(0, Math.floor(Number(runtimeState.polynomialN) || 0)),
        polynomialCoeffs: cloneComplexList(runtimeState.polynomialCoeffs),
        fractionalPowerN: Number.isFinite(Number(runtimeState.fractionalPowerN)) ? Number(runtimeState.fractionalPowerN) : 0.5,
        branchCutType: runtimeState.branchCutType === 'ray' ? 'ray' : 'draw',
        branchCutAngle: Number.isFinite(Number(runtimeState.branchCutAngle)) ? Number(runtimeState.branchCutAngle) : Math.PI,
        zetaContinuationEnabled: !!runtimeState.zetaContinuationEnabled,
        taylor: taylorSnapshot(runtimeState, functionKey),
        dynamicAggregate: dynamicAggregateSnapshot(runtimeState),
        style: {
            brightness: Number(runtimeState.domainBrightness) || 1,
            contrast: Number(runtimeState.domainContrast) || 1,
            saturation: Number(runtimeState.domainSaturation) || 1,
            lightnessCycles: Number(runtimeState.domainLightnessCycles) || 0
        },
        paletteStops: paletteStops(runtimeState.domainPalette),
        viewport: preciseViewport || {
            width: Math.max(1, Math.floor(Number(planeParams.width) || 1)),
            height: Math.max(1, Math.floor(Number(planeParams.height) || 1)),
            xRange: ranges.xRange,
            yRange: ranges.yRange
        }
    };

    return isDomainDynamicsSnapshot(snapshot) ? freezeDomainDynamicsSnapshot(snapshot) : null;
}

function canUseWorker() {
    return typeof Worker !== 'undefined' && typeof URL !== 'undefined';
}

function workerCount() {
    const cores = typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)
        ? navigator.hardwareConcurrency
        : 4;
    return Math.max(1, Math.min(MAX_WORKERS, cores));
}

function needsAdaptiveQuality(snapshot) {
    return !(snapshot?.chainMode === 'zero_seed' &&
        snapshot?.functionKey !== 'algebraic_chaining' && snapshot?.functionKey !== 'c');
}

function createTileList(passWidth, passHeight, scale) {
    const tiles = [];
    for (let y = 0; y < passHeight; y += TILE_SIZE) {
        for (let x = 0; x < passWidth; x += TILE_SIZE) {
            tiles.push({
                x,
                y,
                width: Math.min(TILE_SIZE, passWidth - x),
                height: Math.min(TILE_SIZE, passHeight - y),
                scale
            });
        }
    }
    return tiles;
}

function createImageDataFromPixels(pixels, width, height) {
    if (typeof ImageData !== 'undefined') return new ImageData(pixels, width, height);
    return null;
}

function drawPassToTarget(job, pass) {
    const ctx = job.targetCtx;
    ctx.save();
    try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, job.snapshot.viewport.width, job.snapshot.viewport.height);
        ctx.imageSmoothingEnabled = pass.scale !== 1;
        if (ctx.imageSmoothingQuality !== undefined) ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
            pass.canvas,
            0, 0, pass.width, pass.height,
            0, 0, job.snapshot.viewport.width, job.snapshot.viewport.height
        );
    } finally {
        ctx.restore();
    }

    eventBus.emit('redraw:all');
}

function clearTarget(targetCtx, viewport) {
    targetCtx.save();
    try {
        targetCtx.setTransform(1, 0, 0, 1, 0, 0);
        targetCtx.clearRect(0, 0, viewport.width, viewport.height);
    } finally {
        targetCtx.restore();
    }
}

function setDomainProcessing(isWPlane, isProcessing) {
    if (isWPlane) {
        runtime.rendering.processingWDomainDynamics = isProcessing;
    } else {
        runtime.rendering.processingZDomainDynamics = isProcessing;
    }

    if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
        const indicatorId = isWPlane ? 'w_plane_refining_indicator' : 'z_plane_refining_indicator';
        const indicator = document.getElementById(indicatorId);
        if (indicator) {
            if (isProcessing) {
                indicator.classList.remove('hidden');
            } else {
                indicator.classList.add('hidden');
            }
        }
    }
}

function setDomainFullResolution(isWPlane, isReady) {
    if (isWPlane) {
        runtime.rendering.wDomainDynamicsHasFullResolution = isReady;
    } else {
        runtime.rendering.zDomainDynamicsHasFullResolution = isReady;
    }
}

class WorkerCpuDomainDynamicsBackend {
    constructor() {
        this.id = 'worker-cpu';
        this.workers = [];
        this.queue = [];
        this.queueIndex = 0;
        this.activeJob = null;
        this.pass = null;
    }

    start(job) {
        this.cancel();
        this.activeJob = {
            ...job,
            cancelled: false,
            passIndex: -1
        };
        this.ensureWorkers();
        this.initializeWorkerJobs(this.activeJob);
        this.startNextPass();
        return true;
    }

    cancel(jobId = null) {
        const cancelledJobId = jobId || this.activeJob?.id || null;
        if (this.activeJob && (jobId === null || this.activeJob.id === jobId)) {
            this.activeJob.cancelled = true;
            setDomainProcessing(this.activeJob.snapshot.isWPlaneColoring, false);
        }
        this.queue = [];
        this.queueIndex = 0;
        this.pass = null;
        if (cancelledJobId) {
            this.workers.forEach(entry => entry.worker.postMessage({ type: 'cancel', jobId: cancelledJobId }));
        }
    }

    ensureWorkers() {
        if (this.workers.length) return;
        if (!canUseWorker()) throw new Error('Domain dynamics requires a module Worker.');
        const count = workerCount();
        for (let i = 0; i < count; i += 1) {
            const worker = new Worker(new URL('./domain-dynamics-worker.js', import.meta.url), { type: 'module' });
            const entry = { worker, busy: false };
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
            entry.worker.postMessage({
                type: 'start',
                jobId: job.id,
                snapshot: job.snapshot
            });
        });
    }

    startNextPass() {
        const job = this.activeJob;
        if (!job || job.cancelled) return;

        job.passIndex += 1;

        if (job.passIndex > (job.maxAllowedPassIndex ?? PASS_SCALES.length - 1)) {
            job.passIndex -= 1;
            return;
        }

        if (job.passIndex >= PASS_SCALES.length) {
            this.pass = null;
            return;
        }

        const scale = PASS_SCALES[job.passIndex];
        const passWidth = Math.max(1, Math.ceil(job.snapshot.viewport.width / scale));
        const passHeight = Math.max(1, Math.ceil(job.snapshot.viewport.height / scale));
        const canvas = document.createElement('canvas');
        canvas.width = passWidth;
        canvas.height = passHeight;
        const ctx = canvas.getContext('2d');

        this.pass = {
            id: `${job.id}:${scale}`,
            scale,
            width: passWidth,
            height: passHeight,
            canvas,
            ctx,
            remaining: 0,
            qualityPhase: false,
            refinementTiles: []
        };
        this.queue = createTileList(passWidth, passHeight, scale);
        if (scale === 1 && needsAdaptiveQuality(job.snapshot)) {
            this.queue = this.queue.map(tile => ({ ...tile, deferQuality: true }));
        }
        this.queueIndex = 0;
        this.pass.remaining = this.queue.length;

        if (!this.queue.length) {
            this.startNextPass();
            return;
        }

        this.workers.forEach(worker => this.dispatchWorker(worker));
    }

    dispatchWorker(entry) {
        const job = this.activeJob;
        if (!job || job.cancelled || entry.busy) return;

        const tile = this.queue[this.queueIndex];
        if (!tile) return;
        this.queueIndex += 1;

        entry.busy = true;
        const message = {
            type: 'tile',
            jobId: job.id,
            passId: this.pass.id,
            tile
        };
        if (tile.basePixels instanceof Uint8ClampedArray) {
            entry.worker.postMessage(message, [tile.basePixels.buffer]);
        } else {
            entry.worker.postMessage(message);
        }
    }

    handleWorkerMessage(entry, message) {
        entry.busy = false;
        this.handleTileMessage(message);
        this.dispatchWorker(entry);
    }

    handleTileMessage(message) {
        const job = this.activeJob;
        const pass = this.pass;
        if (!job || job.cancelled || !pass || message.jobId !== job.id || message.passId !== pass.id) return;

        if (message.type === 'error') {
            this.cancel(job.id);
            if (pendingJobTimeout) {
                clearTimeout(pendingJobTimeout);
                pendingJobTimeout = null;
            }
            if (activeJobId === job.id) {
                activeSignature = null;
                activeJobId = 0;
            }
            queueMicrotask(() => { throw new Error(`Native domain tile failed: ${message.message}`); });
            return;
        } else if (message.type === 'tile') {
            const image = createImageDataFromPixels(message.pixels, message.tile.width, message.tile.height);
            if (image) {
                pass.ctx.putImageData(image, message.tile.x, message.tile.y);
            }
            if (pass.scale === 1 && !pass.qualityPhase && message.tile.deferQuality) {
                pass.refinementTiles.push({
                    x: message.tile.x,
                    y: message.tile.y,
                    width: message.tile.width,
                    height: message.tile.height,
                    scale: 1,
                    qualityOnly: true,
                    basePixels: message.pixels
                });
            }
            pass.remaining -= 1;
        }

        if (pass.remaining <= 0) {
            if (pass.scale === 1) {
                // Keep the refining indicator active, but stop softening the image
                // once a native-resolution frame is available.
                setDomainFullResolution(job.snapshot.isWPlaneColoring, true);
            }
            drawPassToTarget(job, pass);

            // The first scale-1 completion is immediately usable full-resolution
            // output. Refine those exact pixels as a second worker phase so adaptive
            // supersampling never blocks first-paint latency.
            if (pass.scale === 1 && !pass.qualityPhase && pass.refinementTiles.length) {
                pass.qualityPhase = true;
                this.queue = pass.refinementTiles;
                pass.refinementTiles = [];
                this.queueIndex = 0;
                pass.remaining = this.queue.length;
                this.workers.forEach(worker => this.dispatchWorker(worker));
                return;
            }

            if (job.passIndex === PASS_SCALES.length - 1) {
                setDomainProcessing(job.snapshot.isWPlaneColoring, false);
            }
            this.queue = [];
            this.queueIndex = 0;
            this.startNextPass();
        }
    }

}

const workerBackend = new WorkerCpuDomainDynamicsBackend();

export function selectDomainDynamicsBackend() {
    return workerBackend;
}

let pendingJobTimeout = null;

export function renderPlanarDomainDynamics(targetCtx, planeParams, snapshot) {
    if (!targetCtx || !planeParams || !snapshot) return false;

    const signature = domainDynamicsSignature(snapshot);
    if (signature === activeSignature) return true;

    if (pendingJobTimeout) {
        clearTimeout(pendingJobTimeout);
        pendingJobTimeout = null;
    }

    if (activeBackend) {
        activeBackend.cancel(activeJobId);
    }

    activeSignature = signature;
    clearTarget(targetCtx, snapshot.viewport);
    setDomainFullResolution(snapshot.isWPlaneColoring, false);

    activeJobId = nextJobId;
    nextJobId += 1;

    const job = {
        id: activeJobId,
        targetCtx,
        snapshot,
        maxAllowedPassIndex: 0 // Only run scale 16 pass instantly!
    };

    const selected = selectDomainDynamicsBackend(snapshot);
    activeBackend = selected;
    selected.start(job);

    setDomainProcessing(snapshot.isWPlaneColoring, true);

    // Debounce the heavier passes (scale 4 and scale 1) during zoom/pan storms
    pendingJobTimeout = setTimeout(() => {
        const currentJob = activeBackend?.activeJob;
        if (currentJob && currentJob.id === job.id && !currentJob.cancelled) {
            currentJob.maxAllowedPassIndex = PASS_SCALES.length - 1; // Allow all passes
            if (activeBackend.startNextPass) {
                activeBackend.startNextPass();
            }
        }
    }, 100);

    return true;
}

export function cancelPlanarDomainDynamics() {
    if (pendingJobTimeout) {
        clearTimeout(pendingJobTimeout);
        pendingJobTimeout = null;
    }
    if (activeBackend) activeBackend.cancel(activeJobId);
    activeSignature = null;
    activeJobId = 0;
}
