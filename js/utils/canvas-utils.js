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
