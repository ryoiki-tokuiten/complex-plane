import { compileDomainProgram } from '../../native/complex-engine.js';
import { DomainGpu } from './gpu.js';
import { DomainRefinement } from './refinement.js';
import { ReferencePool } from './reference-pool.js';

let active = null, pendingJob = null, running = false, gpu = null;
const pool = new ReferencePool();
const yieldWork = () => new Promise(resolve => setTimeout(resolve, 0));

async function render(job) {
    const { snapshot, id } = job;
    let program;
    const started = performance.now();
    const timing = { referenceMilliseconds: 0, prepareMilliseconds: 0, gpuMilliseconds: 0, transferMilliseconds: 0 };
    try {
        self.postMessage({type: 'progress', jobId: id, stage: 'Compiling expression'});
        program = compileDomainProgram(snapshot);
        if (job.cancelled) return;
        gpu ??= new DomainGpu(new OffscreenCanvas(snapshot.viewport.width, snapshot.viewport.height));
        gpu.begin(snapshot);
        const { width, height } = snapshot.viewport;
        const totalSamples = width * height * 4;
        let sites = [{ x: (width - 1) / 2, y: (height - 1) / 2, sample: 0 }];
        let activeSamples = null;
        let activeRefIndices = null;
        const batchLimit = Math.min(8192, Math.max(1024, Math.floor(Math.sqrt(width * height) * 16)));
        const refinement = new DomainRefinement(width, height, Math.max(program.minimumPrecision, snapshot.viewport.precisionBits, 128), batchLimit);
        const maxEffortPrecision = Math.min(16384, Math.max(program.minimumPrecision, snapshot.viewport.precisionBits * 2, 512));
        let referenceCount = 0, passes = 0, submittedSamples = 0, publishedSamples = 0;
        while (!job.cancelled) {
            const { terms, precision } = refinement;
            self.postMessage({
                type: 'progress',
                jobId: id,
                stage: 'Computing reference batch',
                terms,
                precisionBits: precision,
                pendingSamples: gpu.pendingSamples?.length ?? totalSamples
            });

            const numWorkers = Math.min(pool.workers.length || 1, sites.length);
            const sliceSamples = Array.from({ length: numWorkers }, () => []);
            const sliceRefIndices = Array.from({ length: numWorkers }, () => []);
            if (activeSamples && activeRefIndices) {
                for (let i = 0; i < activeSamples.length; i++) {
                    const ref = activeRefIndices[i];
                    const k = Math.min(numWorkers - 1, Math.floor(ref * numWorkers / sites.length));
                    const start = Math.floor(k * sites.length / numWorkers);
                    sliceSamples[k].push(activeSamples[i]);
                    sliceRefIndices[k].push(ref - start);
                }
            }
            const typedSliceSamples = sliceSamples.map(arr => new Uint32Array(arr));
            const typedSliceRefIndices = sliceRefIndices.map(arr => new Uint32Array(arr));

            let lastYield = performance.now();
            let mark = performance.now();
            await pool.evaluateStreaming(program, snapshot, sites, {
                precision,
                terms,
                chainCount: program.chainCount
            }, async (batchResult, sliceIndex, sliceStart) => {
                if (job.cancelled) return;
                const { headers, coefficients, steps, stride, count } = batchResult;
                referenceCount += count;
                timing.referenceMilliseconds += performance.now() - mark;

                const batchActiveSamples = activeSamples ? typedSliceSamples[sliceIndex] : null;
                const batchActiveRefIndices = activeRefIndices ? typedSliceRefIndices[sliceIndex] : null;
                if (batchActiveSamples && batchActiveSamples.length === 0) return;

                mark = performance.now();
                gpu.prepare(program, terms, headers, coefficients, batchActiveSamples, batchActiveRefIndices);
                timing.prepareMilliseconds += performance.now() - mark;

                mark = performance.now();
                await gpu.batch(steps, {
                    initial: true,
                    iteration: 0,
                    count: program.chainCount,
                    depth: program.chainCount,
                    publish: true
                });
                timing.gpuMilliseconds += performance.now() - mark;
                passes++;
                submittedSamples += gpu.activeSamples;

                mark = performance.now();
                const bitmap = gpu.present();
                timing.transferMilliseconds += performance.now() - mark;
                self.postMessage({
                    type: 'frame',
                    jobId: id,
                    bitmap,
                    stats: {
                        completedSamples: publishedSamples,
                        totalSamples,
                        ...timing,
                        references: referenceCount,
                        passes,
                        submittedSamples,
                        precisionBits: precision,
                        terms,
                        wallMilliseconds: performance.now() - started
                    }
                }, [bitmap]);

                mark = performance.now();
                if (performance.now() - lastYield >= 8) {
                    await yieldWork();
                    lastYield = performance.now();
                }
            });

            if (job.cancelled) return;

            mark = performance.now();
            const progress = gpu.progress();
            timing.transferMilliseconds += performance.now() - mark;
            publishedSamples = progress.completedSamples;

            if (progress.completedSamples === progress.totalSamples) {
                mark = performance.now();
                const bitmap = gpu.present();
                timing.transferMilliseconds += performance.now() - mark;
                self.postMessage({
                    type: 'frame',
                    jobId: id,
                    bitmap,
                    stats: {
                        ...progress,
                        ...timing,
                        references: referenceCount,
                        passes,
                        submittedSamples,
                        precisionBits: precision,
                        terms,
                        wallMilliseconds: performance.now() - started
                    }
                }, [bitmap]);
                self.postMessage({ type: 'complete', jobId: id });
                return;
            }

            if (refinement.precision > maxEffortPrecision) {
                sites = [];
                activeSamples = null;
                activeRefIndices = null;
            } else {
                sites = refinement.next(gpu.pendingSamples);
                activeSamples = sites.activeSamples ?? null;
                activeRefIndices = sites.activeRefIndices ?? null;
            }

            if (!sites || sites.length === 0) {
                mark = performance.now();
                const bitmap = gpu.present();
                timing.transferMilliseconds += performance.now() - mark;
                self.postMessage({
                    type: 'frame',
                    jobId: id,
                    bitmap,
                    stats: {
                        ...progress,
                        ...timing,
                        references: referenceCount,
                        passes,
                        submittedSamples,
                        precisionBits: precision,
                        terms,
                        wallMilliseconds: performance.now() - started
                    }
                }, [bitmap]);
                self.postMessage({ type: 'complete', jobId: id });
                return;
            }
            await yieldWork();
        }
    } catch (error) {
        if (!job.cancelled) self.postMessage({ type: 'error', jobId: id, message: error?.message || String(error) });
    } finally {
        program?.dispose();
    }
}
// One GPU owner and a latest-job queue. Cancellation is observed between bounded
// submissions; viewport changes retain compiled shaders and allocated buffers.
async function drain() {
    if (running) return;
    running = true;
    try {
        while (pendingJob) {
            const job = pendingJob; pendingJob = null; active = job;
            await render(job);
            active = null;
        }
    } finally { running = false; }
}
self.onmessage = event => {
    const message = event.data;
    if (message.type === 'start') {
        if (active) { active.cancelled = true; pool?.cancel(); }
        pendingJob = { id: message.jobId, snapshot: message.snapshot, cancelled: false };
        void drain();
    } else if (message.type === 'cancel') {
        if (active?.id === message.jobId) { active.cancelled = true; pool?.cancel(); }
        if (pendingJob?.id === message.jobId) pendingJob = null;
    } else throw new Error(`Unknown domain worker message: ${message.type}`);
};

self.postMessage({ type: 'ready' });
