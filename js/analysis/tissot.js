import { buildNativeTissot } from '../native/complex-engine.js';

const INDICATRIX_COLORS = Object.freeze([
    'rgba(80, 219, 255, 0.94)',
    'rgba(94, 239, 202, 0.94)',
    'rgba(143, 234, 122, 0.94)',
    'rgba(231, 226, 112, 0.94)',
    'rgba(255, 184, 105, 0.94)',
    'rgba(255, 137, 146, 0.94)',
    'rgba(255, 122, 199, 0.94)',
    'rgba(215, 145, 255, 0.94)',
    'rgba(164, 158, 255, 0.94)',
    'rgba(112, 174, 255, 0.94)',
    'rgba(92, 211, 255, 0.94)',
    'rgba(99, 232, 215, 0.94)'
]);
const INDICATRIX_SCALE_OUTLIER_FACTOR = 4;
const INDICATRIX_VIEWPORT_PADDING = 0.14;

export function generateTissotIndicatrices(mapOptions, xRange, yRange, density = 8, segments = 72) {
    if (!mapOptions?.functionKey) throw new Error('Tissot geometry requires native map options.');
    return buildNativeTissot({ map: mapOptions, xRange, yRange, density, segments })
        .map((indicatrix, index) => ({
            ...indicatrix,
            color: INDICATRIX_COLORS[index % INDICATRIX_COLORS.length]
        }));
}

function quantile(sortedValues, percentile) {
    if (!sortedValues.length) return NaN;
    const index = (sortedValues.length - 1) * percentile;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const blend = index - lower;
    return sortedValues[lower] * (1 - blend) + sortedValues[upper] * blend;
}

export function selectStableTissotIndicatrices(indicatrices) {
    if (!Array.isArray(indicatrices) || indicatrices.length === 0) return [];

    const radii = indicatrices
        .map(indicatrix => indicatrix.outputRadius)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
    const referenceRadius = quantile(radii, 0.75);
    const maxRadius = Math.max(referenceRadius * INDICATRIX_SCALE_OUTLIER_FACTOR, 1e-9);

    return indicatrices.filter(indicatrix => indicatrix.outputRadius <= maxRadius);
}

export function getTissotViewportBounds(indicatrices) {
    if (!Array.isArray(indicatrices) || indicatrices.length === 0) return null;

    let minRe = Infinity;
    let maxRe = -Infinity;
    let minIm = Infinity;
    let maxIm = -Infinity;

    indicatrices.forEach(indicatrix => {
        indicatrix.mappedCircle.forEach(point => {
            minRe = Math.min(minRe, point.re);
            maxRe = Math.max(maxRe, point.re);
            minIm = Math.min(minIm, point.im);
            maxIm = Math.max(maxIm, point.im);
        });
    });

    if (![minRe, maxRe, minIm, maxIm].every(Number.isFinite)) return null;

    const span = Math.max(maxRe - minRe, maxIm - minIm, 0.5);
    const padding = span * INDICATRIX_VIEWPORT_PADDING;
    return {
        xRange: [minRe - padding, maxRe + padding],
        yRange: [minIm - padding, maxIm + padding]
    };
}
