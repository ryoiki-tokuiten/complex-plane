const finitePoint = value => Number.isFinite(value?.re) && Number.isFinite(value?.im);

export function findPreimages(target, evaluate, bounds, options = {}) {
    if (!finitePoint(target) || typeof evaluate !== 'function') return [];
    const xRange = bounds?.xRange;
    const yRange = bounds?.yRange;
    if (!Array.isArray(xRange) || !Array.isArray(yRange)) return [];

    const density = Math.max(8, Math.min(32, Math.floor(options.density || 18)));
    const span = Math.max(xRange[1] - xRange[0], yRange[1] - yRange[0], 1e-6);
    const tolerance = Math.max(1e-8, span * 2e-6);
    const derivativeStep = Math.max(1e-7, span * 2e-6);
    const mergeDistance = Math.max(tolerance * 12, span / (density * 120));
    const roots = [];

    for (let row = 0; row <= density; row += 1) {
        for (let column = 0; column <= density; column += 1) {
            let re = xRange[0] + (xRange[1] - xRange[0]) * column / density;
            let im = yRange[0] + (yRange[1] - yRange[0]) * row / density;

            for (let iteration = 0; iteration < 28; iteration += 1) {
                const value = evaluate(re, im);
                if (!finitePoint(value)) break;
                const errorRe = value.re - target.re;
                const errorIm = value.im - target.im;
                if (Math.hypot(errorRe, errorIm) <= tolerance) {
                    if (re >= xRange[0] - tolerance && re <= xRange[1] + tolerance &&
                        im >= yRange[0] - tolerance && im <= yRange[1] + tolerance &&
                        !roots.some(root => Math.hypot(root.re - re, root.im - im) <= mergeDistance)) {
                        roots.push({ re, im });
                    }
                    break;
                }

                const xValue = evaluate(re + derivativeStep, im);
                const yValue = evaluate(re, im + derivativeStep);
                if (!finitePoint(xValue) || !finitePoint(yValue)) break;
                const j00 = (xValue.re - value.re) / derivativeStep;
                const j10 = (xValue.im - value.im) / derivativeStep;
                const j01 = (yValue.re - value.re) / derivativeStep;
                const j11 = (yValue.im - value.im) / derivativeStep;
                const determinant = j00 * j11 - j01 * j10;
                if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-14) break;
                const deltaRe = (errorRe * j11 - errorIm * j01) / determinant;
                const deltaIm = (j00 * errorIm - j10 * errorRe) / determinant;
                re -= deltaRe;
                im -= deltaIm;
                if (!Number.isFinite(re) || !Number.isFinite(im) ||
                    Math.abs(re) > span * 100 || Math.abs(im) > span * 100) break;
            }
        }
    }
    roots.sort((a, b) => a.re - b.re || a.im - b.im);
    return roots;
}
