import { compileDomainProgram } from '../../native/complex-engine.js';
import { DomainGpu } from './gpu.js';
import { DomainRefinement } from './refinement.js';

let active = null, pendingJob = null, running = false, gpu = null;
const channel = new MessageChannel();
const yieldWork = () => new Promise(resolve => { channel.port1.onmessage = resolve; channel.port2.postMessage(0); });

async function render(job) {
    const { snapshot, id } = job;
    let program, references = [];
    const started = performance.now();
    const timing = { referenceMilliseconds: 0, prepareMilliseconds: 0, gpuMilliseconds: 0, transferMilliseconds: 0 };
    try {
        self.postMessage({type: 'progress', jobId: id, stage: 'Compiling expression'});
        program = compileDomainProgram(snapshot);
        gpu ??= new DomainGpu(new OffscreenCanvas(snapshot.viewport.width, snapshot.viewport.height));
        gpu.begin(snapshot);
        const { width, height } = snapshot.viewport;
        let sites = [{ x: (width - 1) / 2, y: (height - 1) / 2 }];
        const refinement = new DomainRefinement(width, height, Math.max(program.minimumPrecision, snapshot.viewport.precisionBits, 128));
        let referenceCount = 0, passes = 0, submittedSamples = 0, publishedSamples = 0;
        const eventMode = !snapshot.derivativeOrder && snapshot.orbitColoringMode !== 'value';
        while (!job.cancelled) {
            const { terms, precision } = refinement;
            self.postMessage({type: 'progress', jobId: id, stage: 'Computing reference batch', terms, precisionBits: precision, pendingSamples: gpu.pendingSamples?.length ?? width * height * 4});
            let mark = performance.now();
            for (const site of sites) {
                references.push(program.reference({ ...site, precision, terms }));
                if (performance.now() - mark >= 8) {
                    timing.referenceMilliseconds += performance.now() - mark;
                    await yieldWork();
                    if (job.cancelled) return;
                    mark = performance.now();
                }
            }
            referenceCount += references.length;
            timing.referenceMilliseconds += performance.now() - mark;
            const header = new Float32Array(references.length * 52);
            references.forEach((reference, i) => { header.set(reference.header, i * 52); header.set([sites[i].x, sites[i].y], i * 52 + 48); });
            mark = performance.now();
            gpu.prepare(program, terms, header, references[0].coefficients);
            timing.prepareMilliseconds += performance.now() - mark;
            const stride = references[0].stride;
            const batchSize = Math.max(1, Math.min(64, Math.floor(1024 / (program.nodes.length / 4)), Math.floor(1048576 / (stride * references.length))));
            let progress, lastYield = performance.now(), lastPublish = -64;
            for (let iteration = 0; iteration < program.chainCount && !job.cancelled; iteration += batchSize) {
                const count = Math.min(batchSize, program.chainCount - iteration);
                mark = performance.now();
                const data = new Float32Array(count * stride * references.length);
                for (let i = 0; i < references.length; i++) {
                    references[i].next(count, data, i * count * stride);
                    if (performance.now() - mark >= 8) {
                        timing.referenceMilliseconds += performance.now() - mark;
                        await yieldWork();
                        if (job.cancelled) return;
                        mark = performance.now();
                    }
                }
                timing.referenceMilliseconds += performance.now() - mark;
                const publish = iteration + count === program.chainCount || (eventMode && iteration - lastPublish >= 64);
                mark = performance.now();
                await gpu.batch(data, { initial: iteration === 0, iteration, count, depth: program.chainCount, publish });
                timing.gpuMilliseconds += performance.now() - mark;
                if (job.cancelled) break;
                passes++; submittedSamples += gpu.activeSamples;
                if (publish) {
                    lastPublish = iteration;
                    mark = performance.now();
                    progress = gpu.progress();
                    timing.transferMilliseconds += performance.now() - mark;
                    if (progress.completedSamples > publishedSamples) {
                        mark = performance.now();
                        const bitmap = gpu.present();
                        timing.transferMilliseconds += performance.now() - mark;
                        self.postMessage({ type: 'frame', jobId: id, bitmap, stats: { ...progress, ...timing, references: referenceCount, passes, submittedSamples, precisionBits: precision, terms, wallMilliseconds: performance.now() - started } }, [bitmap]);
                        publishedSamples = progress.completedSamples;
                    }
                    if (progress.completedSamples === progress.totalSamples) break;
                }
                if (performance.now() - lastYield >= 8) { await yieldWork(); lastYield = performance.now(); }
            }
            references.forEach(reference => reference.dispose()); references = [];
            if (job.cancelled) return;
            if (progress.completedSamples === progress.totalSamples) {
                self.postMessage({ type: 'complete', jobId: id }); return;
            }
            sites = refinement.next(gpu.pendingSamples);
            await yieldWork();
        }
    } catch (error) {
        if (!job.cancelled) self.postMessage({ type: 'error', jobId: id, message: error?.message || String(error) });
    } finally {
        references.forEach(reference => reference.dispose()); program?.dispose();
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
        if (active) active.cancelled = true;
        pendingJob = { id: message.jobId, snapshot: message.snapshot, cancelled: false };
        void drain();
    } else if (message.type === 'cancel') {
        if (active?.id === message.jobId) active.cancelled = true;
        if (pendingJob?.id === message.jobId) pendingJob = null;
    } else throw new Error(`Unknown domain worker message: ${message.type}`);
};

self.postMessage({ type: 'ready' });
