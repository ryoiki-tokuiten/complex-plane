import { eventBus } from '../store/events.js';
import { getDomainPaletteStops } from '../constants/domain-palettes.js';
import { state, context } from '../store/state.js';
import { runtime } from '../store/runtime.js';
import {
    createDomainDynamicsTileRenderer,
    domainDynamicsSignature,
    isDomainDynamicsSnapshot,
    renderDomainDynamicsTile
} from './domain-dynamics-core.js';
import {
    normalizeOrbitColoringMode
} from '../constants/rendering.js';

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
    return {
        re: Number.isFinite(Number(value?.re)) ? Number(value.re) : fallback.re,
        im: Number.isFinite(Number(value?.im)) ? Number(value.im) : fallback.im
    };
}

function cloneComplexList(values) {
    return Array.isArray(values) ? values.map(value => cloneComplex(value)) : [];
}

function cloneAlgebraicTerms(terms) {
    return Array.isArray(terms)
        ? terms.map(term => ({
            coeff: cloneComplex(term?.coeff, { re: 1, im: 0 }),
            factors: Array.isArray(term?.factors)
                ? term.factors.map(factor => ({ ...factor }))
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
    const orbitColoringMode = normalizeOrbitColoringMode(runtimeState.orbitColoringMode);

    const snapshot = {
        isWPlaneColoring: !!options?.isWPlaneColoring,
        functionKey,
        chainingEnabled: !!runtimeState.chainingEnabled,
        chainMode: normalizeChainMode(runtimeState.chainingMode),
        chainCount: Math.max(1, Math.floor(Number(runtimeState.chainCount) || 1)),
        orbitColoringMode,
        algebraicChainingEnabled: !!runtimeState.algebraicChainingEnabled,
        algebraicChainingTerms: cloneAlgebraicTerms(runtimeState.algebraicChainingTerms),
        algebraicChainingZExpr: runtimeState.algebraicChainingZExpr || 'z',
        mobiusA: cloneComplex(runtimeState.mobiusA, { re: 1, im: 0 }),
        mobiusB: cloneComplex(runtimeState.mobiusB),
        mobiusC: cloneComplex(runtimeState.mobiusC),
        mobiusD: cloneComplex(runtimeState.mobiusD, { re: 1, im: 0 }),
        polynomialN: Math.max(0, Math.floor(Number(runtimeState.polynomialN) || 0)),
        polynomialCoeffs: cloneComplexList(runtimeState.polynomialCoeffs),
        fractionalPowerN: Number.isFinite(Number(runtimeState.fractionalPowerN)) ? Number(runtimeState.fractionalPowerN) : 0.5,
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
    return isDomainDynamicsSnapshot(snapshot) ? snapshot : null;
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

function passSampleStep(passScale) {
    return passScale;
}

function drawPassToTarget(job, pass) {
    const ctx = job.targetCtx;
    ctx.save();
    try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, job.snapshot.viewport.width, job.snapshot.viewport.height);
        ctx.imageSmoothingEnabled = pass.sampleStep !== 1;
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
        this.activeJob = null;
        this.pass = null;
        this.inlineTimer = null;
        this.failed = false;
    }

    supports() {
        return true;
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
        this.pass = null;
        if (this.inlineTimer) {
            clearTimeout(this.inlineTimer);
            this.inlineTimer = null;
        }
        if (cancelledJobId) {
            this.workers.forEach(entry => entry.worker.postMessage({ type: 'cancel', jobId: cancelledJobId }));
        }
    }

    dispose() {
        this.cancel();
        this.workers.forEach(entry => {
            entry.worker.postMessage({ type: 'dispose' });
            entry.worker.terminate();
        });
        this.workers = [];
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
        const sampleStep = passSampleStep(scale);
        const passWidth = Math.max(1, Math.ceil(job.snapshot.viewport.width / sampleStep));
        const passHeight = Math.max(1, Math.ceil(job.snapshot.viewport.height / sampleStep));
        const canvas = document.createElement('canvas');
        canvas.width = passWidth;
        canvas.height = passHeight;
        const ctx = canvas.getContext('2d');

        this.pass = {
            id: `${job.id}:${scale}`,
            scale,
            sampleStep,
            width: passWidth,
            height: passHeight,
            canvas,
            ctx,
            remaining: 0
        };
        this.queue = createTileList(passWidth, passHeight, sampleStep);
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

        const tile = this.queue.shift();
        if (!tile) return;

        entry.busy = true;
        entry.worker.postMessage({
            type: 'tile',
            jobId: job.id,
            passId: this.pass.id,
            tile
        });
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
            pass.remaining -= 1;
        } else if (message.type === 'tile') {
            const image = createImageDataFromPixels(message.pixels, message.tile.width, message.tile.height);
            if (image) {
                pass.ctx.putImageData(image, message.tile.x, message.tile.y);
            }
            pass.remaining -= 1;
        }

        if (pass.remaining <= 0) {
            drawPassToTarget(job, pass);
            eventBus.emit('redraw:all');
            if (job.passIndex === PASS_SCALES.length - 1) {
                lastCompletedSnapshot[job.snapshot.isWPlaneColoring ? 'w' : 'z'] = job.snapshot;
                setDomainProcessing(job.snapshot.isWPlaneColoring, false);
            }
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

            const tile = this.queue.shift();
            if (!tile) return;

            const pixels = currentJob.renderTile
                ? currentJob.renderTile(tile)
                : renderDomainDynamicsTile(currentJob.snapshot, tile);
            this.handleTileMessage({
                type: 'tile',
                jobId: currentJob.id,
                passId: currentPass.id,
                tile,
                pixels
            });

            if (this.queue.length && this.pass === currentPass && !currentJob.cancelled) {
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

export function domainDynamicsFuncSignature(snapshot) {
    if (!snapshot) return '';
    return JSON.stringify({
        isWPlaneColoring: snapshot.isWPlaneColoring,
        functionKey: snapshot.functionKey,
        chainingEnabled: snapshot.chainingEnabled,
        chainMode: snapshot.chainMode,
        chainCount: snapshot.chainCount,
        orbitColoringMode: snapshot.orbitColoringMode,
        algebraicChainingEnabled: snapshot.algebraicChainingEnabled,
        algebraicChainingTerms: snapshot.algebraicChainingTerms,
        algebraicChainingZExpr: snapshot.algebraicChainingZExpr,
        polynomialN: snapshot.polynomialN,
        polynomialCoeffs: snapshot.polynomialCoeffs,
        mobiusA: snapshot.mobiusA,
        mobiusB: snapshot.mobiusB,
        mobiusC: snapshot.mobiusC,
        mobiusD: snapshot.mobiusD,
        fractionalPowerN: snapshot.fractionalPowerN,
        zetaContinuationEnabled: snapshot.zetaContinuationEnabled,
        style: snapshot.style,
        paletteStops: snapshot.paletteStops
    });
}

export function getCurrentFuncSignature(isWPlane = false) {
    if (!state) return '';
    return JSON.stringify({
        isWPlaneColoring: isWPlane,
        functionKey: state.currentFunction,
        chainingEnabled: !!state.chainingEnabled,
        chainMode: normalizeChainMode(state.chainingMode),
        chainCount: Math.max(1, Math.floor(Number(state.chainCount) || 1)),
        orbitColoringMode: normalizeOrbitColoringMode(state.orbitColoringMode),
        algebraicChainingEnabled: !!state.algebraicChainingEnabled,
        algebraicChainingTerms: state.algebraicChainingTerms,
        algebraicChainingZExpr: state.algebraicChainingZExpr || 'z',
        polynomialN: Math.max(0, Math.floor(Number(state.polynomialN) || 0)),
        polynomialCoeffs: state.polynomialCoeffs,
        mobiusA: state.mobiusA,
        mobiusB: state.mobiusB,
        mobiusC: state.mobiusC,
        mobiusD: state.mobiusD,
        fractionalPowerN: state.fractionalPowerN,
        zetaContinuationEnabled: !!state.zetaContinuationEnabled,
        style: {
            brightness: Number(state.domainBrightness) || 1,
            contrast: Number(state.domainContrast) || 1,
            saturation: Number(state.domainSaturation) || 1,
            lightnessCycles: Number(state.domainLightnessCycles) || 0
        },
        paletteStops: state.domainPalette
    });
}

const staleDomainCanvas = { z: null, w: null };
const staleViewport = { z: null, w: null };
const staleFuncSignature = { z: null, w: null };
const lastCompletedSnapshot = { z: null, w: null };

export function captureBeforeResize() {
    const backend = selectDomainDynamicsBackend();
    
    // Z plane
    const zJob = backend?.activeJob;
    if (zJob && !zJob.snapshot.isWPlaneColoring) {
        captureStaleDomain(context.zDomainColorCanvas || zJob.targetCtx.canvas, zJob.snapshot, false);
    } else if (context.zDomainColorCanvas && lastCompletedSnapshot.z) {
        captureStaleDomain(context.zDomainColorCanvas, lastCompletedSnapshot.z, false);
    }

    // W plane
    const wJob = backend?.activeJob;
    if (wJob && wJob.snapshot.isWPlaneColoring) {
        captureStaleDomain(context.wDomainColorCanvas || wJob.targetCtx.canvas, wJob.snapshot, true);
    } else if (context.wDomainColorCanvas && lastCompletedSnapshot.w) {
        captureStaleDomain(context.wDomainColorCanvas, lastCompletedSnapshot.w, true);
    }
}

export function getStaleDomainData(isWPlane = false) {
    const key = isWPlane ? 'w' : 'z';
    return {
        canvas: staleDomainCanvas[key],
        viewport: staleViewport[key],
        signature: staleFuncSignature[key]
    };
}

function captureStaleDomain(canvas, snapshot, isWPlane = false) {
    if (!canvas || !snapshot || !snapshot.viewport) return;
    const key = isWPlane ? 'w' : 'z';
    if (!staleDomainCanvas[key]) {
        staleDomainCanvas[key] = document.createElement('canvas');
    }
    staleDomainCanvas[key].width = canvas.width;
    staleDomainCanvas[key].height = canvas.height;
    const ctx = staleDomainCanvas[key].getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    staleViewport[key] = JSON.parse(JSON.stringify(snapshot.viewport));
    staleFuncSignature[key] = domainDynamicsFuncSignature(snapshot);
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
        if (activeBackend.activeJob && activeBackend.activeJob.snapshot) {
            captureStaleDomain(targetCtx.canvas, activeBackend.activeJob.snapshot, activeBackend.activeJob.snapshot.isWPlaneColoring);
        }
        activeBackend.cancel(activeJobId);
    }

    activeSignature = signature;
    clearTarget(targetCtx, snapshot.viewport);

    activeJobId = nextJobId;
    nextJobId += 1;

    const job = {
        id: activeJobId,
        targetCtx,
        planeParams,
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

export function disposePlanarDomainDynamics() {
    if (pendingJobTimeout) {
        clearTimeout(pendingJobTimeout);
        pendingJobTimeout = null;
    }
    workerBackend.dispose();
    activeBackend = null;
    activeSignature = null;
    activeJobId = 0;
}
