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

    targetRangeX[0] = (0 - origin.x) / scale.x;         
    targetRangeX[1] = (width - origin.x) / scale.x;     
    targetRangeY[0] = (origin.y - height) / scale.y;    
    targetRangeY[1] = (origin.y - 0) / scale.y;         
}

export function setPlaneViewport(planeParams, xRange, yRange) {
    const xSpan = Math.max(1e-6, xRange[1] - xRange[0]);
    const ySpan = Math.max(1e-6, yRange[1] - yRange[0]);
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
    updatePlaneViewportRanges(planeParams);
}
