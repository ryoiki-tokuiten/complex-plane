export class ReferencePool {
    constructor(size = null) {
        const concurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
        this.size = size || Math.max(1, Math.min(16, concurrency));
        this.workers = [];
        this.readyPromises = [];
        this.nextJobId = 1;
        this.activeRequests = new Map();
        this.init();
    }

    init() {
        if (typeof Worker === 'undefined') return;
        try {
            const workerUrl = new URL('./reference-worker.js', import.meta.url);
            for (let i = 0; i < this.size; i++) {
                const w = new Worker(workerUrl, { type: 'module' });
                let readyResolve, readyReject;
                const readyPromise = new Promise((resolve, reject) => {
                    readyResolve = resolve;
                    readyReject = reject;
                });
                this.readyPromises.push(readyPromise);
                w.onmessage = ({ data }) => {
                    if (data?.type === 'ready') {
                        readyResolve();
                        return;
                    }
                    this.handleMessage(i, data);
                };
                w.onerror = (err) => {
                    readyReject?.(err);
                    this.handleError(i, err);
                };
                this.workers.push(w);
            }
        } catch {
            this.dispose();
        }
    }

    handleMessage(workerIndex, data) {
        const req = this.activeRequests.get(data.id);
        if (!req) return;
        if (data.type === 'error') {
            req.reject(new Error(data.message));
            this.activeRequests.delete(data.id);
            return;
        }
        if (data.type === 'result') {
            const sliceIndex = req.workerMap.get(workerIndex);
            if (sliceIndex !== undefined) {
                req.results[sliceIndex] = data;
                if (req.onBatch) {
                    try {
                        const promise = req.onBatch(data, sliceIndex, req.sliceOffsets[sliceIndex]);
                        if (promise && typeof promise.then === 'function') {
                            promise.catch(err => {
                                req.reject(err);
                                this.activeRequests.delete(data.id);
                            });
                        }
                    } catch (err) {
                        req.reject(err);
                        this.activeRequests.delete(data.id);
                        return;
                    }
                }
                req.remaining--;
                if (req.remaining === 0) {
                    this.activeRequests.delete(data.id);
                    req.resolve(req.results);
                }
            }
        }
    }

    handleError(workerIndex, err) {
        for (const [id, req] of this.activeRequests) {
            if (req.workerMap.has(workerIndex)) {
                req.reject(new Error(err?.message || 'Reference worker error'));
                this.activeRequests.delete(id);
            }
        }
    }

    async evaluateStreaming(program, snapshot, sites, { precision, terms, chainCount }, onBatch = null) {
        if (!sites || sites.length === 0) {
            return [];
        }

        if (this.workers.length === 0) {
            const count = sites.length;
            const headers = new Float32Array(count * 52);
            let stride = 0;
            let coefficients = null;
            let steps = null;
            for (let i = 0; i < count; i++) {
                const site = sites[i];
                const ref = program.reference({ x: site.x, y: site.y, precision, terms });
                headers.set(ref.header, i * 52);
                headers[i * 52 + 48] = site.x;
                headers[i * 52 + 49] = site.y;
                if (!stride) {
                    stride = ref.stride;
                    coefficients = new Float32Array(ref.coefficients);
                    steps = new Float32Array(count * chainCount * stride);
                }
                for (let iter = 0; iter < chainCount; iter += 64) {
                    const chunk = Math.min(64, chainCount - iter);
                    ref.next(chunk, steps, i * chainCount * stride + iter * stride);
                }
                ref.dispose();
            }
            const singleResult = { headers, coefficients, steps, stride, count };
            if (onBatch) {
                await onBatch(singleResult, 0, 0);
            }
            return [singleResult];
        }

        await Promise.all(this.readyPromises);

        const numWorkers = Math.min(this.workers.length, sites.length);
        const slices = [];
        const sliceOffsets = [];
        for (let k = 0; k < numWorkers; k++) {
            const start = Math.floor(k * sites.length / numWorkers);
            const end = Math.floor((k + 1) * sites.length / numWorkers);
            slices.push(sites.slice(start, end));
            sliceOffsets.push(start);
        }

        const id = this.nextJobId++;
        return new Promise((resolve, reject) => {
            const workerMap = new Map();
            for (let k = 0; k < numWorkers; k++) {
                workerMap.set(k, k);
            }
            this.activeRequests.set(id, {
                resolve,
                reject,
                remaining: numWorkers,
                workerMap,
                sliceOffsets,
                onBatch,
                results: new Array(numWorkers)
            });
            for (let k = 0; k < numWorkers; k++) {
                this.workers[k].postMessage({
                    type: 'evaluate',
                    id,
                    snapshot,
                    sites: slices[k],
                    precision,
                    terms,
                    chainCount
                });
            }
        });
    }

    async evaluate(program, snapshot, sites, options) {
        const workerResults = await this.evaluateStreaming(program, snapshot, sites, options);
        if (!workerResults || workerResults.length === 0) {
            return {
                headers: new Float32Array(0),
                coefficients: new Float32Array(0),
                steps: new Float32Array(0),
                stride: 0,
                count: 0
            };
        }

        const totalCount = sites.length;
        const stride = workerResults[0].stride;
        const coefficients = workerResults[0].coefficients;
        const headers = new Float32Array(totalCount * 52);
        const steps = new Float32Array(totalCount * options.chainCount * stride);

        let siteOffset = 0;
        for (let k = 0; k < workerResults.length; k++) {
            const res = workerResults[k];
            headers.set(res.headers, siteOffset * 52);
            steps.set(res.steps, siteOffset * options.chainCount * stride);
            siteOffset += res.count;
        }

        return {
            headers,
            coefficients,
            steps,
            stride,
            count: totalCount
        };
    }

    cancel() {
        if (this.activeRequests.size === 0) return;
        for (const [id, req] of this.activeRequests) {
            req.reject(new Error('Job cancelled'));
        }
        this.activeRequests.clear();
        for (const w of this.workers) {
            try { w.terminate(); } catch {}
        }
        this.workers = [];
        this.readyPromises = [];
        this.init();
    }

    dispose() {
        this.cancel();
        for (const w of this.workers) {
            try {
                w.postMessage({ type: 'dispose' });
                w.terminate();
            } catch {
                // ignore
            }
        }
        this.workers = [];
    }
}
