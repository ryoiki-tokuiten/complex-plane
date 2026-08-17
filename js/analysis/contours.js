const TWO_PI = Math.PI * 2;

function insidePolygon(point, points) {
    let inside = false;
    for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
        const a = points[index];
        const b = points[previous];
        if (!a || !b) continue;
        if ((a.im > point.im) !== (b.im > point.im) &&
            point.re < (b.re - a.re) * (point.im - a.im) / ((b.im - a.im) || 1e-30) + a.re) {
            inside = !inside;
        }
    }
    return inside;
}

export function isPointInsideContour(point, contourType, params) {
    if (!point || !params) return false;
    if (contourType === 'circle') {
        if (!(params.r > 0)) return false;
        return Math.hypot(point.re - params.cx, point.im - params.cy) < params.r * (1 - 1e-9);
    }
    if (contourType === 'ellipse') {
        if (!(params.a > 0) || !(params.b > 0)) return false;
        const x = (point.re - params.cx) / params.a;
        const y = (point.im - params.cy) / params.b;
        return x * x + y * y < 1 - 1e-9;
    }
    if (contourType === 'contour') return Array.isArray(params.points) && insidePolygon(point, params.points);
    if (contourType === 'contours') {
        let inside = false;
        for (const points of params.contours || []) {
            if (Array.isArray(points) && points.length > 2 && insidePolygon(point, points)) inside = !inside;
        }
        return inside;
    }
    return false;
}

export function getContourPoints(type, params, stepCount) {
    const count = Math.floor(stepCount);
    if (!params || count < 1) return [];
    const points = new Array(count + 1);
    if (type === 'circle' && params.r > 0) {
        for (let index = 0; index <= count; index += 1) {
            const angle = index * TWO_PI / count;
            points[index] = { re: params.cx + params.r * Math.cos(angle), im: params.cy + params.r * Math.sin(angle) };
        }
        return points;
    }
    if (type === 'ellipse' && params.a > 0 && params.b > 0) {
        for (let index = 0; index <= count; index += 1) {
            const angle = index * TWO_PI / count;
            points[index] = { re: params.cx + params.a * Math.cos(angle), im: params.cy + params.b * Math.sin(angle) };
        }
        return points;
    }
    return [];
}
