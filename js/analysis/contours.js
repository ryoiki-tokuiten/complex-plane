import {
    generateNativeContourPoints,
    classifyNativeContourSingularities
} from '../native/complex-engine.js';

export function isPointInsideContour(point, contourType, params) {
    if (!point || !params) throw new Error('Contour classification requires a point and parameters.');
    let polygonContours = [];
    if (contourType === 'contours') {
        if (!Array.isArray(params.contours)) throw new Error('Contour collections require a contours array.');
        polygonContours = params.contours;
    } else if (contourType === 'contour') {
        if (!Array.isArray(params.points)) throw new Error('Polygon contours require a points array.');
        polygonContours = [params.points];
    }
    const results = classifyNativeContourSingularities(contourType, params, polygonContours, 0, [point]);
    if (!results[0]) throw new Error('Native contour classification returned no result.');
    return results[0].inside;
}

export function getContourPoints(type, params, stepCount) {
    return generateNativeContourPoints(type, params, stepCount);
}
