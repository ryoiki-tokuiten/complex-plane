import { eventBus } from '../store/events.js';
import { getDomainPaletteStops } from '../constants/domain-palettes.js';
import { runtime } from '../store/runtime.js';
import {
    createDomainDynamicsTileRenderer,
    domainDynamicsSignature,
    freezeDomainDynamicsSnapshot,
    isDomainDynamicsSnapshot
} from './domain-dynamics-core.js';
import {
    normalizeOrbitColoringMode
} from '../constants/rendering.js';
import { normalizeDomainDynamicsChainCount } from '../constants/domain-dynamics.js';

const PASS_SCALES = Object.freeze([16, 4, 1]);
const TILE_SIZE = 64;
const MAX_WORKERS = 16;
const MAX_TILE_RETRIES = 2;
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
    'power',
    'mobius',
    'zeta',
    'polynomial',
    'poincare',
    'algebraic_chaining'
]);
const WORKER_UNSUPPORTED_FUNCTIONS = new Set(['asin', 'atan', 'gamma', 'loggamma', 'bessel']);

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

export function buildPlanarDomainDynamicsSnapshot(runtimeState, planeParams, options = null) {
    const ranges = planeRanges(planeParams);
    if (!runtimeState || !planeParams || !ranges) return null;

    const functionKey = runtimeState.currentFunction;
    if (!SUPPORTED_FUNCTIONS.has(functionKey)) return null;
    const naturalBase = value => Math.abs((value?.re ?? Math.E) - Math.E) < 1e-12 && Math.abs(value?.im || 0) < 1e-12;
    const terms = runtimeState.algebraicChainingTerms || [];
    const algebraicUses = predicate => terms.some(term => (term?.factors || []).some(factor =>
        factor && factor.func !== 'none' && predicate(factor)
    ));
    if (functionKey === 'algebraic_chaining' && algebraicUses(factor =>
        WORKER_UNSUPPORTED_FUNCTIONS.has(factor.func) || WORKER_UNSUPPORTED_FUNCTIONS.has(factor.chainedFunc)
    )) return null;
    if (!naturalBase(runtimeState.expBase) && (functionKey === 'exp' ||
        (functionKey === 'algebraic_chaining' && algebraicUses(factor => factor.func === 'exp' || factor.chainedFunc === 'exp' || factor.exp)))) return null;
    if (!naturalBase(runtimeState.logBase) && (functionKey === 'ln' ||
        (functionKey === 'algebraic_chaining' && algebraicUses(factor => factor.func === 'ln' || factor.chainedFunc === 'ln' || factor.log)))) return null;
    const orbitColoringMode = normalizeOrbitColoringMode(runtimeState.orbitColoringMode);

    const snapshot = {
        isWPlaneColoring: !!options?.isWPlaneColoring,
        functionKey,
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
        taylorSeriesEnabled: !!runtimeState.taylorSeriesEnabled,
        dynamicAggregateEnabled: !!runtimeState.dynamicPlotting?.enabled,
        style: {
            brightness: Number(runtimeState.domainBrightness) || 1,
            contrast: Number(runtimeState.domainContrast) || 1,
            saturation: Number(runtimeState.domainSaturation) || 1,
            lightnessCycles: Number(runtimeState.domainLightnessCycles) || 0
        },
        paletteStops: paletteStops(runtimeState.domainPalette),
        viewport: {
            width: Math.max(1, Math.floor(Number(planeParams.width) || 1)),
            height: Math.max(1, Math.floor(Number(planeParams.height) || 1)),
            xRange: ranges.xRange,
            yRange: ranges.yRange
        }
    };

    if (snapshot.taylorSeriesEnabled || snapshot.dynamicAggregateEnabled) return null;
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

function tileKey(tile) {
    return `${tile.x}:${tile.y}:${tile.width}:${tile.height}:${tile.scale}:${tile.qualityOnly ? 'q' : 'b'}`;
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

class WorkerCpuDomainDynamicsBackend {
    constructor() {
        this.id = 'worker-cpu';
        this.workers = [];
        this.queue = [];
        this.queueIndex = 0;
        this.activeJob = null;
        this.pass = null;
        this.inlineTimer = null;
        this.failed = false;
    }

    start(job) {
        this.cancel();
        this.activeJob = {
            ...job,
            cancelled: false,
            passIndex: -1,
            renderTile: createDomainDynamicsTileRenderer(job.snapshot)
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
        if (this.inlineTimer) {
            clearTimeout(this.inlineTimer);
            this.inlineTimer = null;
        }
        if (cancelledJobId) {
            this.workers.forEach(entry => entry.worker.postMessage({ type: 'cancel', jobId: cancelledJobId }));
        }
    }

    ensureWorkers() {
        if (!canUseWorker() || this.failed || this.workers.length) return;
        try {
            const count = workerCount();
            for (let i = 0; i < count; i += 1) {
                const worker = new Worker(new URL('./domain-dynamics-worker.js', import.meta.url), { type: 'module' });
                const entry = { worker, busy: false };
                worker.onmessage = event => this.handleWorkerMessage(entry, event.data);
                worker.onerror = error => {
                    console.warn('Domain dynamics worker failed; falling back to inline tiles.', error?.message || error);
                    this.failed = true;
                    this.workers.forEach(item => item.worker.terminate());
                    this.workers = [];
                    this.restartInline();
                };
                this.workers.push(entry);
            }
        } catch (error) {
            console.warn('Domain dynamics workers unavailable; falling back to inline tiles.', error?.message || error);
            this.failed = true;
            this.workers = [];
        }
    }

    initializeWorkerJobs(job) {
        if (!this.workers.length || this.failed) return;
        this.workers.forEach(entry => {
            entry.worker.postMessage({
                type: 'start',
                jobId: job.id,
                snapshot: job.snapshot
            });
        });
    }

    restartInline() {
        const job = this.activeJob;
        if (!job || job.cancelled) return;
        const currentScale = this.pass?.scale || PASS_SCALES[0];
        const startIndex = Math.max(0, PASS_SCALES.indexOf(currentScale));
        job.passIndex = startIndex - 1;
        this.queue = [];
        this.queueIndex = 0;
        this.pass = null;
        this.startNextPass();
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
            tileRetries: new Map(),
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

        if (this.workers.length && !this.failed) {
            this.workers.forEach(worker => this.dispatchWorker(worker));
        } else {
            this.processInlineTiles();
        }
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
            console.warn('Domain dynamics tile failed:', message.message);
            const key = tileKey(message.tile);
            const retries = pass.tileRetries.get(key) || 0;
            if (retries < MAX_TILE_RETRIES) {
                pass.tileRetries.set(key, retries + 1);
                this.queue.push(message.tile);
                return;
            }

            console.warn('Domain dynamics render invalidated after repeated tile failure.');
            this.cancel(job.id);
            if (pendingJobTimeout) {
                clearTimeout(pendingJobTimeout);
                pendingJobTimeout = null;
            }
            if (activeJobId === job.id) {
                activeSignature = null;
                activeJobId = 0;
            }
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
                if (this.workers.length && !this.failed) {
                    this.workers.forEach(worker => this.dispatchWorker(worker));
                }
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

    processInlineTiles() {
        const job = this.activeJob;
        const pass = this.pass;
        if (!job || job.cancelled || !pass) return;

        const runOne = () => {
            const currentJob = this.activeJob;
            const currentPass = this.pass;
            if (!currentJob || currentJob.cancelled || currentPass !== pass) return;

            const tile = this.queue[this.queueIndex];
            if (!tile) return;
            this.queueIndex += 1;

            try {
                const pixels = currentJob.renderTile(tile);
                this.handleTileMessage({
                    type: 'tile',
                    jobId: currentJob.id,
                    passId: currentPass.id,
                    tile,
                    pixels
                });
            } catch (error) {
                this.handleTileMessage({
                    type: 'error',
                    jobId: currentJob.id,
                    passId: currentPass.id,
                    tile,
                    message: error?.message || String(error)
                });
            }

            if (this.queueIndex < this.queue.length && this.pass === currentPass && !currentJob.cancelled) {
                this.inlineTimer = setTimeout(runOne, 0);
            }
        };

        this.inlineTimer = setTimeout(runOne, 0);
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
    if (!selected.start(job)) {
        activeBackend = workerBackend;
        workerBackend.start(job);
    }

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