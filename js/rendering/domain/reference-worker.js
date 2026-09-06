import { compileDomainProgram } from '../../native/complex-engine.js';

let cachedSnapshotKey = null;
let cachedProgram = null;

function getProgram(snapshot) {
    const key = JSON.stringify([
        snapshot.viewport.width,
        snapshot.viewport.height,
        snapshot.viewport.centerRe,
        snapshot.viewport.centerIm,
        snapshot.viewport.xSpan,
        snapshot.viewport.ySpan,
        snapshot.functionKey,
        snapshot.chainingEnabled,
        snapshot.chainMode,
        snapshot.chainCount,
        snapshot.selectedFormula,
        snapshot.customExpression
    ]);
    if (cachedProgram && cachedSnapshotKey === key) {
        return cachedProgram;
    }
    if (cachedProgram) {
        cachedProgram.dispose();
        cachedProgram = null;
    }
    cachedProgram = compileDomainProgram(snapshot);
    cachedSnapshotKey = key;
    return cachedProgram;
}

self.onmessage = async ({ data }) => {
    if (data.type === 'evaluate') {
        const { id, snapshot, sites, precision, terms, chainCount } = data;
        try {
            const program = getProgram(snapshot);
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
            if (!stride) {
                self.postMessage({
                    type: 'result',
                    id,
                    count: 0,
                    headers: new Float32Array(0),
                    coefficients: new Float32Array(0),
                    steps: new Float32Array(0),
                    stride: 0
                });
                return;
            }
            self.postMessage({
                type: 'result',
                id,
                count,
                headers,
                coefficients,
                steps,
                stride
            }, [headers.buffer, coefficients.buffer, steps.buffer]);
        } catch (error) {
            self.postMessage({ type: 'error', id, message: error.message });
        }
    } else if (data.type === 'dispose') {
        if (cachedProgram) {
            cachedProgram.dispose();
            cachedProgram = null;
            cachedSnapshotKey = null;
        }
    }
};

self.postMessage({ type: 'ready' });
