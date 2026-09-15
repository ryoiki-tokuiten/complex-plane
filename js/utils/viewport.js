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
    const precise = planeParams.preciseViewport;
    if (precise && ['centerRe', 'centerIm', 'xSpan', 'ySpan'].every(key => typeof precise[key] === 'string') &&
        Number(precise.xSpan) > 0 && Number(precise.ySpan) > 0) return planeParams;
    requireFiniteRange(planeParams.currentVisXRange, `${label} x-axis`);
    requireFiniteRange(planeParams.currentVisYRange, `${label} y-axis`);
    return planeParams;
}
