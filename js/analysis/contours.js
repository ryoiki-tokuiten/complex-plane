import {
    generateNativeContourPoints,
    classifyNativeContourSingularities
} from '../native/complex-engine.js';

export function isPointInsideContour(point, contourType, params) {
    if (!point || !params) return false;
    const polygonContours = contourType === 'contours'
        ? (params.contours || [])
        : (contourType === 'contour' && Array.isArray(params.points) ? [params.points] : []);
    const results = classifyNativeContourSingularities(contourType, params, polygonContours, 0, [point]);
    return results[0]?.inside ?? false;
}

export function getContourPoints(type, params, stepCount) {
    return generateNativeContourPoints(type, params, stepCount);
}

