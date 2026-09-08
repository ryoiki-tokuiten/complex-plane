const jitter = [[-0.375, -0.125], [0.125, -0.375], [0.375, 0.125], [-0.125, 0.375]];
const MAX_PRECISION = 16384;
const MAX_TERMS = 64;

// One plan belongs to one viewport job. A sweep gives every still-unresolved
// sample a reference at its own position before increasing numerical effort.
export class DomainRefinement {
    constructor(width, height, precision) {
        this.width = width;
        this.precision = precision;
        this.terms = 16;
        this.attempted = new Uint8Array(width * height * 4);
    }
    next(pending) {
        if (!pending.length) return [];
        let available = 0;
        for (const sample of pending) if (!this.attempted[sample]) available++;
        if (!available) {
            if (this.precision === MAX_PRECISION && this.terms === MAX_TERMS) {
                throw new Error(`Cannot certify ${pending.length} domain samples after trying their reference centers at ${MAX_PRECISION}-bit reference precision and ${MAX_TERMS} terms.`);
            }
            this.precision = Math.min(MAX_PRECISION, this.precision * 2);
            this.terms = Math.min(MAX_TERMS, this.terms * 2);
            this.attempted.fill(0);
            available = pending.length;
        }
        const count = Math.min(32, available), sites = [];
        let rank = 0;
        for (const sample of pending) {
            if (this.attempted[sample]) continue;
            const target = Math.floor((sites.length + 0.5) * available / count);
            if (rank++ !== target) continue;
            this.attempted[sample] = 1;
            const pixel = Math.floor(sample / 4), offset = jitter[sample % 4];
            sites.push({ x: pixel % this.width + offset[0], y: Math.floor(pixel / this.width) + offset[1] });
            if (sites.length === count) break;
        }
        return sites;
    }
}
