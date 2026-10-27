import { requireVisibleViewport } from '../utils/viewport.js';

function precisionFor(zoomPower) {
    return Math.max(256, Math.min(4096, Math.ceil((Math.abs(zoomPower) + 30) * Math.LOG2E * Math.LN10)));
}

function planeCenter(planeParams) {
    requireVisibleViewport(planeParams, 'Precise viewport');
    const xRange = planeParams.currentVisXRange;
    const yRange = planeParams.currentVisYRange;
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

function shouldBePrecise(planeParams, zoom) {
    const center = planeCenter(planeParams);
    const maxCoord = Math.max(Math.abs(center.re), Math.abs(center.im), 1.0);
    const z = Number(zoom);
    if (!Number.isFinite(z) || z <= 0) throw new Error('Precise viewport requires a finite positive zoom.');
    if (!Number.isFinite(planeParams.width) || planeParams.width <= 0) {
        throw new Error('Precise viewport requires a finite positive width.');
    }
    const span = 7 / z;
    const pixelSpan = span / planeParams.width;
    return pixelSpan <= maxCoord * 1.0e-100;
}

export function synchronizePreciseViewport(planeParams, zoom) {
    const exactPower = Math.log10(Number(zoom));
    if (!Number.isFinite(exactPower)) throw new Error('Precise viewport requires finite zoom power.');
    if (!shouldBePrecise(planeParams, zoom)) {
        if (planeParams.preciseViewport) leavePreciseViewport(planeParams, exactPower);
        return false;
    }
    const zoomPower = exactPower;
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

function leavePreciseViewport(planeParams, zoomPower) {
    const viewport = planeParams.preciseViewport;
    if (!viewport) return;
    const centerRe = Number(viewport.centerRe);
    const centerIm = Number(viewport.centerIm);
    const xSpan = 7 * 10 ** -zoomPower;
    const ySpan = xSpan * planeParams.height / planeParams.width;
    const xRange = planeParams.currentVisXRange;
    const yRange = planeParams.currentVisYRange;
    xRange[0] = centerRe - xSpan * 0.5;
    xRange[1] = centerRe + xSpan * 0.5;
    yRange[0] = centerIm - ySpan * 0.5;
    yRange[1] = centerIm + ySpan * 0.5;
    planeParams.preciseViewport = null;
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
