// js/utils/canvas-utils.js

export function mapToCanvasCoords(wX,wY,p){return{x:p.origin.x+wX*p.scale.x,y:p.origin.y-wY*p.scale.y};}
export function mapCanvasToWorldCoords(cX,cY,p){
    if (p.scale.x === 0 || p.scale.y === 0) return { x: NaN, y: NaN};
    return{x:(cX-p.origin.x)/p.scale.x,y:(p.origin.y-cY)/p.scale.y};
}
export function updatePlaneViewportRanges(planeParams) {
    if (planeParams.preciseViewport) return;
    const { origin, scale, width, height } = planeParams;
    if (width === 0 || height === 0 || scale.x === 0 || scale.y === 0 ||
        !isFinite(scale.x) || !isFinite(scale.y) ||
        !isFinite(origin.x) || !isFinite(origin.y)) {
        return;
    }

    const targetRangeX = planeParams.currentVisXRange ? planeParams.currentVisXRange : planeParams.xRange;
    const targetRangeY = planeParams.currentVisYRange ? planeParams.currentVisYRange : planeParams.yRange;

    targetRangeX[0] = (0 - origin.x) / scale.x;         
    targetRangeX[1] = (width - origin.x) / scale.x;     
    targetRangeY[0] = (origin.y - height) / scale.y;    
    targetRangeY[1] = (origin.y - 0) / scale.y;         
}
