// js/utils/canvas-utils.js

import { requireVisibleViewport } from './viewport.js';

export function mapToCanvasCoords(wX,wY,p){return{x:p.origin.x+wX*p.scale.x,y:p.origin.y-wY*p.scale.y};}
export function mapCanvasToWorldCoords(cX,cY,p){
    if (!Number.isFinite(p?.scale?.x) || !Number.isFinite(p?.scale?.y) ||
        p.scale.x === 0 || p.scale.y === 0) {
        throw new Error('Canvas projection requires finite non-zero plane scales.');
    }
    return{x:(cX-p.origin.x)/p.scale.x,y:(p.origin.y-cY)/p.scale.y};
}
export function updatePlaneViewportRanges(planeParams) {
    if (planeParams.preciseViewport) return;
    requireVisibleViewport(planeParams);
    const { origin, scale, width, height } = planeParams;
    if (width === 0 || height === 0 || scale.x === 0 || scale.y === 0 ||
        !isFinite(scale.x) || !isFinite(scale.y) ||
        !isFinite(origin.x) || !isFinite(origin.y)) {
        throw new Error('Plane viewport updates require finite non-zero geometry.');
    }

    const targetRangeX = planeParams.currentVisXRange;
    const targetRangeY = planeParams.currentVisYRange;

    let x0 = (0 - origin.x) / scale.x;
    let x1 = (width - origin.x) / scale.x;
    if (!(x1 > x0)) {
        const centerX = (width * 0.5 - origin.x) / scale.x;
        const halfSpanX = Math.max(
            Math.abs((width * 0.5) / scale.x),
            Math.abs(centerX) * Number.EPSILON * 2,
            Number.MIN_VALUE
        );
        x0 = centerX - halfSpanX;
        x1 = centerX + halfSpanX;
    }

    let y0 = (origin.y - height) / scale.y;
    let y1 = (origin.y - 0) / scale.y;
    if (!(y1 > y0)) {
        const centerY = (origin.y - height * 0.5) / scale.y;
        const halfSpanY = Math.max(
            Math.abs((height * 0.5) / scale.y),
            Math.abs(centerY) * Number.EPSILON * 2,
            Number.MIN_VALUE
        );
        y0 = centerY - halfSpanY;
        y1 = centerY + halfSpanY;
    }

    targetRangeX[0] = x0;
    targetRangeX[1] = x1;
    targetRangeY[0] = y0;
    targetRangeY[1] = y1;
}

export function setPlaneViewport(planeParams, xRange, yRange) {
    const xSpan = Math.max(Number.MIN_VALUE, xRange[1] - xRange[0]);
    const ySpan = Math.max(Number.MIN_VALUE, yRange[1] - yRange[0]);
    const scale = Math.min(planeParams.width / xSpan, planeParams.height / ySpan);
    const centerX = (xRange[0] + xRange[1]) * 0.5;
    const centerY = (yRange[0] + yRange[1]) * 0.5;
    const targetXRange = planeParams.currentVisXRange;
    const targetYRange = planeParams.currentVisYRange;

    targetXRange[0] = xRange[0];
    targetXRange[1] = xRange[1];
    targetYRange[0] = yRange[0];
    targetYRange[1] = yRange[1];
    planeParams.scale.x = planeParams.scale.y = scale;
    planeParams.origin.x = planeParams.width * 0.5 - centerX * scale;
    planeParams.origin.y = planeParams.height * 0.5 + centerY * scale;
    planeParams.preciseViewport = null;
    planeParams.centerBigX = undefined;
    planeParams.centerBigY = undefined;
    planeParams.scaleMant = undefined;
    planeParams.scaleExp10 = undefined;
    planeParams._lastSyncedOriginX = undefined;
    updatePlaneViewportRanges(planeParams);
}
