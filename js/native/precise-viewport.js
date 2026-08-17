import { precisePixelCoordinate } from './complex-engine.js';

export const PRECISE_ZOOM_THRESHOLD = 14;

function precisionFor(zoomPower) {
    return Math.max(256, Math.min(4096, Math.ceil((Math.abs(zoomPower) + 30) * Math.LOG2E * Math.LN10)));
}

function planeCenter(planeParams) {
    const xRange = planeParams.currentVisXRange || planeParams.xRange;
    const yRange = planeParams.currentVisYRange || planeParams.yRange;
    return {
        re: (Number(xRange[0]) + Number(xRange[1])) * 0.5,
        im: (Number(yRange[0]) + Number(yRange[1])) * 0.5
    };
}

function updateSize(planeParams) {
    if (!planeParams.preciseViewport) return;
    planeParams.preciseViewport.width = Math.max(1, Math.floor(planeParams.width));
    planeParams.preciseViewport.height = Math.max(1, Math.floor(planeParams.height));
}

export function isPreciseViewport(planeParams) {
    return !!planeParams?.preciseViewport;
}

export function synchronizePreciseViewport(planeParams, zoom) {
    const exactPower = Math.log10(Number(zoom));
    if (!Number.isFinite(exactPower) || exactPower < PRECISE_ZOOM_THRESHOLD) {
        if (planeParams.preciseViewport) leavePreciseViewport(planeParams, Number.isFinite(exactPower) ? exactPower : 0);
        return false;
    }
    const zoomPower = Math.max(PRECISE_ZOOM_THRESHOLD, Math.round(exactPower));
    if (!planeParams.preciseViewport) {
        const center = planeCenter(planeParams);
        planeParams.preciseViewport = {
            centerRe: String(center.re),
            centerIm: String(center.im),
            zoomPower,
            precisionBits: precisionFor(zoomPower),
            width: Math.max(1, Math.floor(planeParams.width)),
            height: Math.max(1, Math.floor(planeParams.height))
        };
    } else {
        planeParams.preciseViewport.zoomPower = zoomPower;
        planeParams.preciseViewport.precisionBits = precisionFor(zoomPower);
        updateSize(planeParams);
    }
    return true;
}

export function leavePreciseViewport(planeParams, zoomPower) {
    const viewport = planeParams.preciseViewport;
    if (!viewport) return;
    const centerRe = Number(viewport.centerRe);
    const centerIm = Number(viewport.centerIm);
    const xSpan = 7 * 10 ** -zoomPower;
    const ySpan = xSpan * planeParams.height / planeParams.width;
    const xRange = planeParams.currentVisXRange || planeParams.xRange;
    const yRange = planeParams.currentVisYRange || planeParams.yRange;
    xRange[0] = centerRe - xSpan * 0.5;
    xRange[1] = centerRe + xSpan * 0.5;
    yRange[0] = centerIm - ySpan * 0.5;
    yRange[1] = centerIm + ySpan * 0.5;
    planeParams.preciseViewport = null;
}

export function panPreciseViewport(planeParams, deltaX, deltaY) {
    const viewport = planeParams.preciseViewport;
    if (!viewport) throw new Error('Precise pan requires an active precise viewport.');
    const center = precisePixelCoordinate(
        viewport,
        viewport.width * 0.5 - deltaX - 0.5,
        viewport.height * 0.5 - deltaY - 0.5
    );
    viewport.centerRe = center.re;
    viewport.centerIm = center.im;
}

export function zoomPreciseViewportAt(planeParams, pixelX, pixelY, direction) {
    const viewport = planeParams.preciseViewport;
    if (!viewport) throw new Error('Precise zoom requires an active precise viewport.');
    const anchor = precisePixelCoordinate(viewport, pixelX - 0.5, pixelY - 0.5);
    viewport.zoomPower = Math.max(PRECISE_ZOOM_THRESHOLD, viewport.zoomPower + Math.sign(direction));
    viewport.precisionBits = precisionFor(viewport.zoomPower);
    const centeredOnAnchor = { ...viewport, centerRe: anchor.re, centerIm: anchor.im };
    const center = precisePixelCoordinate(
        centeredOnAnchor,
        viewport.width - pixelX - 0.5,
        viewport.height - pixelY - 0.5
    );
    viewport.centerRe = center.re;
    viewport.centerIm = center.im;
    return viewport.zoomPower;
}

export function anchorPreciseViewport(planeParams, anchorRe, anchorIm, pixelX, pixelY) {
    const viewport = planeParams.preciseViewport;
    if (!viewport) throw new Error('Precise anchoring requires an active precise viewport.');
    const centeredOnAnchor = { ...viewport, centerRe: String(anchorRe), centerIm: String(anchorIm) };
    const center = precisePixelCoordinate(
        centeredOnAnchor,
        viewport.width - pixelX - 0.5,
        viewport.height - pixelY - 0.5
    );
    viewport.centerRe = center.re;
    viewport.centerIm = center.im;
}

export function preciseViewportSnapshot(planeParams) {
    const viewport = planeParams?.preciseViewport;
    if (!viewport) return null;
    updateSize(planeParams);
    return {
        centerRe: viewport.centerRe,
        centerIm: viewport.centerIm,
        zoomPower: viewport.zoomPower,
        precisionBits: viewport.precisionBits,
        width: viewport.width,
        height: viewport.height
    };
}
