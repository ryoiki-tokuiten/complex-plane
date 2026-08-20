export function requireFiniteRange(range, label) {
    if (!Array.isArray(range) || range.length < 2 ||
        !Number.isFinite(range[0]) || !Number.isFinite(range[1]) ||
        !(range[1] > range[0])) {
        throw new Error(`${label} requires a finite increasing range.`);
    }
    return range;
}

export function requireVisibleViewport(planeParams, label = 'Plane viewport') {
    if (!planeParams || typeof planeParams !== 'object') {
        throw new Error(`${label} is missing.`);
    }
    requireFiniteRange(planeParams.currentVisXRange, `${label} x-axis`);
    requireFiniteRange(planeParams.currentVisYRange, `${label} y-axis`);
    return planeParams;
}
