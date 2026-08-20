import { findNativePreimages } from '../native/complex-engine.js';

export function findPreimages(target, mapOptions, bounds, options = {}) {
    if (!Number.isFinite(target?.re) || !Number.isFinite(target?.im)) {
        throw new Error('Preimage search requires a finite target.');
    }
    const xRange = bounds?.xRange;
    const yRange = bounds?.yRange;
    if (!Array.isArray(xRange) || !Array.isArray(yRange)) {
        throw new Error('Preimage search requires viewport bounds.');
    }
    if (!mapOptions?.functionKey) throw new Error('Preimage search requires native map options.');
    return findNativePreimages({
        density: 18,
        maxIterations: 28,
        ...options,
        map: mapOptions,
        target,
        xRange,
        yRange
    });
}
