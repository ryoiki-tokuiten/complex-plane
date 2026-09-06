const jitter = [[-0.375, -0.125], [0.125, -0.375], [0.375, 0.125], [-0.125, 0.375]];
const MAX_PRECISION = 16384;
const MAX_TERMS = 64;

// Clusters unresolved pending samples by pixel so subpixels share a single
// high-precision reference orbit.
export class DomainRefinement {
    constructor(width, height, precision, batchLimit = 32) {
        this.width = width;
        this.precision = precision;
        this.terms = 16;
        this.batchLimit = batchLimit;
        this.attempted = new Uint8Array(width * height * 4);
    }
    next(pending) {
        if (!pending || !pending.length) return [];
        let available = 0;
        for (let i = 0; i < pending.length; i++) {
            if (!this.attempted[pending[i]]) available++;
        }
        if (!available) {
            if (this.precision === MAX_PRECISION && this.terms === MAX_TERMS) {
                throw new Error(`Cannot certify ${pending.length} domain samples after trying their reference centers at ${MAX_PRECISION}-bit reference precision and ${MAX_TERMS} terms.`);
            }
            this.precision = Math.min(MAX_PRECISION, this.precision * 2);
            this.terms = Math.min(MAX_TERMS, this.terms * 2);
            this.attempted.fill(0);
        }
        const pixelMap = new Map();
        for (let i = 0; i < pending.length; i++) {
            const s = pending[i];
            if (this.attempted[s]) continue;
            const px = Math.floor(s / 4);
            let list = pixelMap.get(px);
            if (!list) {
                list = [];
                pixelMap.set(px, list);
            }
            list.push(s);
        }
        if (pixelMap.size === 0) return [];
        const limit = this.batchLimit || 32;
        const count = Math.min(limit, pixelMap.size);
        const sites = [];
        const activeSamplesList = [];
        const activeRefIndicesList = [];
        let refIdx = 0;

        for (const [px, subpixels] of pixelMap) {
            if (refIdx >= count) break;
            const lead = subpixels[0];
            this.attempted[lead] = 1;
            const offset = jitter[lead % 4];
            sites.push({
                x: (px % this.width) + offset[0],
                y: Math.floor(px / this.width) + offset[1],
                sample: lead
            });
            for (let j = 0; j < subpixels.length; j++) {
                const s = subpixels[j];
                activeSamplesList.push(s);
                activeRefIndicesList.push(refIdx);
            }
            refIdx++;
        }
        sites.activeSamples = new Uint32Array(activeSamplesList);
        sites.activeRefIndices = new Uint32Array(activeRefIndicesList);
        return sites;
    }
}
