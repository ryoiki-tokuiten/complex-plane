import { transformNativeViewport } from './complex-engine.js';
import { requireFiniteRange } from '../utils/viewport.js';

function precisionFor(viewport) {
    const center = Math.max(1, Math.abs(Number(viewport.centerRe)), Math.abs(Number(viewport.centerIm)));
    const pixel = Math.min(Number(viewport.xSpan) / viewport.width, Number(viewport.ySpan) / viewport.height);
    return Math.max(256, Math.min(4096, Math.ceil(Math.log2(center) - Math.log2(pixel) + 80)));
}

function fromRanges(planeParams) {
    const x = requireFiniteRange(planeParams.currentVisXRange, 'Viewport x-axis');
    const y = requireFiniteRange(planeParams.currentVisYRange, 'Viewport y-axis');
    const width = Math.max(1, Math.floor(planeParams.width)), height = Math.max(1, Math.floor(planeParams.height));
    return { centerRe: String(x[0] * 0.5 + x[1] * 0.5), centerIm: String(y[0] * 0.5 + y[1] * 0.5),
        xSpan: String(x[1] - x[0]), ySpan: String(y[1] - y[0]), width, height,
        precisionBits: 256, zoom: 1, baseScale: Math.min(width / (x[1] - x[0]), height / (y[1] - y[0])) };
}

// Other geometry renderers may need their existing MPFR projection machinery.
// This selects only their representation; planar domain coloring always
// consumes the same canonical viewport, at every scale.
export function requiresPreciseProjection(planeParams) {
    const viewport = planeParams?.preciseViewport;
    if (!viewport) return false;
    const magnitude = Math.max(1, Math.abs(Number(viewport.centerRe)), Math.abs(Number(viewport.centerIm)));
    const pixel = Math.min(Number(viewport.xSpan) / planeParams.width, Number(viewport.ySpan) / planeParams.height);
    return magnitude * Number.EPSILON > pixel / 16;
}

export function materializeViewport(planeParams) {
    const viewport = planeParams.preciseViewport;
    if (!viewport) return;
    const re = Number(viewport.centerRe), im = Number(viewport.centerIm);
    const sx = Number(viewport.xSpan), sy = Number(viewport.ySpan);
    planeParams.scale.x = planeParams.width / sx; planeParams.scale.y = planeParams.height / sy;
    planeParams.origin.x = planeParams.width * 0.5 - re * planeParams.scale.x;
    planeParams.origin.y = planeParams.height * 0.5 + im * planeParams.scale.y;
    planeParams.currentVisXRange.splice(0, 2, re - sx * 0.5, re + sx * 0.5);
    planeParams.currentVisYRange.splice(0, 2, im - sy * 0.5, im + sy * 0.5);
}

export function synchronizePreciseViewport(planeParams, zoom, baseScale) {
    if (!Number.isFinite(zoom) || zoom <= 0 || !Number.isFinite(baseScale) || baseScale <= 0) {
        throw new Error('Viewport synchronization requires a positive zoom and fitted base scale.');
    }
    let viewport = planeParams.preciseViewport;
    if (!viewport) {
        viewport = fromRanges(planeParams);
        viewport.xSpan = String(planeParams.width / baseScale);
        viewport.ySpan = String(planeParams.height / baseScale);
        viewport.baseScale = baseScale;
    }
    const scale = viewport.zoom / zoom * viewport.baseScale / baseScale;
    const scaleX = scale * planeParams.width / viewport.width;
    const scaleY = scale * planeParams.height / viewport.height;
    const next = { ...viewport, width: planeParams.width, height: planeParams.height, zoom, baseScale };
    next.precisionBits = Math.max(viewport.precisionBits, precisionFor({ ...next,
        xSpan: String(Number(viewport.xSpan) * scaleX), ySpan: String(Number(viewport.ySpan) * scaleY) }));
    if (scaleX !== 1 || scaleY !== 1) Object.assign(next, transformNativeViewport(next, { scaleX, scaleY }));
    planeParams.preciseViewport = next;
    materializeViewport(planeParams);
    return true;
}

export function panPreciseViewport(planeParams, initial, dx, dy) {
    const viewport = initial ?? planeParams.preciseViewport ?? fromRanges(planeParams);
    planeParams.preciseViewport = { ...viewport, ...transformNativeViewport(viewport, {
        shiftX: -dx / viewport.width, shiftY: dy / viewport.height
    }) };
    materializeViewport(planeParams);
}

export function zoomPreciseViewport(planeParams, x, y, oldZoom, zoom) {
    const viewport = planeParams.preciseViewport ?? fromRanges(planeParams), scale = oldZoom / zoom;
    const next = { ...viewport, zoom, baseScale: viewport.baseScale * viewport.zoom / oldZoom, precisionBits: Math.max(viewport.precisionBits,
        precisionFor({ ...viewport, xSpan: String(Number(viewport.xSpan) * scale), ySpan: String(Number(viewport.ySpan) * scale) })) };
    Object.assign(next, transformNativeViewport(next, { scaleX: scale, scaleY: scale,
        shiftX: (x / viewport.width - 0.5) * (1 - scale), shiftY: (0.5 - y / viewport.height) * (1 - scale) }));
    planeParams.preciseViewport = next;
    materializeViewport(planeParams);
}

export function resetPreciseViewport(planeParams) {
    const previous = planeParams.preciseViewport;
    if (!previous) return;
    const viewport = fromRanges(planeParams);
    viewport.zoom = previous.zoom;
    viewport.baseScale = viewport.baseScale / viewport.zoom;
    viewport.precisionBits = precisionFor(viewport);
    planeParams.preciseViewport = viewport;
}

export function recenterPreciseViewport(planeParams, point) {
    const viewport = planeParams.preciseViewport ?? fromRanges(planeParams);
    planeParams.preciseViewport = { ...viewport, centerRe: String(point.re), centerIm: String(point.im) };
    materializeViewport(planeParams);
}

export function preciseViewportSnapshot(planeParams) {
    const viewport = planeParams?.preciseViewport ?? fromRanges(planeParams);
    return { centerRe: viewport.centerRe, centerIm: viewport.centerIm,
        xSpan: viewport.xSpan, ySpan: viewport.ySpan, precisionBits: viewport.precisionBits,
        width: planeParams.width, height: planeParams.height };
}
