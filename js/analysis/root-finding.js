import { findNativePolynomialRoots, findNativePreimages } from '../native/complex-engine.js';

export function findPolynomialRoots(coefficients) {
    return findNativePolynomialRoots(coefficients);
}

export function findGeneralRoots(map, bounds, density = 30, options = {}) {
    return findNativePreimages({
        map,
        target: { re: 0, im: 0 },
        xRange: [bounds.xMin, bounds.xMax],
        yRange: [bounds.yMin, bounds.yMax],
        density,
        inverseOutput: !!options.inverseOutput,
        maxIterations: options.maxIterations || 28
    });
}
