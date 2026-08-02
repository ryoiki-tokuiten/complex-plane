// js/utils/canvas-utils.js

export function mapToCanvasCoords(wX,wY,p){return{x:p.origin.x+wX*p.scale.x,y:p.origin.y-wY*p.scale.y};}
export function mapCanvasToWorldCoords(cX,cY,p){
    if (p.scale.x === 0 || p.scale.y === 0) return { x: NaN, y: NaN};
    return{x:(cX-p.origin.x)/p.scale.x,y:(p.origin.y-cY)/p.scale.y};
}
export function complexToSphere(re,im){if(isNaN(re)||isNaN(im)||!isFinite(re)||!isFinite(im))return{x:NaN,y:NaN,z:NaN};const scale=Math.max(Math.abs(re),Math.abs(im));if(scale===0)return{x:0,y:0,z:-1};if(scale<=1){const radiusSq=re*re+im*im;const d=radiusSq+1;return{x:2*re/d,y:2*im/d,z:(radiusSq-1)/d};}const inverseScale=1/scale;const normalizedRe=re*inverseScale;const normalizedIm=im*inverseScale;const inverseScaleSq=inverseScale*inverseScale;const normalizedRadiusSq=normalizedRe*normalizedRe+normalizedIm*normalizedIm;const d=normalizedRadiusSq+inverseScaleSq;return{x:2*normalizedRe*inverseScale/d,y:2*normalizedIm*inverseScale/d,z:(normalizedRadiusSq-inverseScaleSq)/d};}
export function sphereToComplex(p3d){if(Math.abs(p3d.z-1)<1e-9)return{re:Infinity,im:Infinity};const den=1-p3d.z;if(Math.abs(den)<1e-9)return{re:p3d.x>0?Infinity:(p3d.x<0?-Infinity:0),im:p3d.y>0?Infinity:(p3d.y<0?-Infinity:0)};return{re:p3d.x/den,im:p3d.y/den};}
export function rotate3D(p3D,rX,rY){if(isNaN(p3D.x))return{x:NaN,y:NaN,z:NaN};const cY=Math.cos(rY),sY=Math.sin(rY),cX=Math.cos(rX),sX=Math.sin(rX);let x1=p3D.x*cY+p3D.z*sY,y1=p3D.y,z1=-p3D.x*sY+p3D.z*cY;return{x:x1,y:y1*cX-z1*sX,z:y1*sX+z1*cX};}
export function inverseRotate3D(p3D_r,rX,rY){if(isNaN(p3D_r.x))return{x:NaN,y:NaN,z:NaN};const cY=Math.cos(-rY),sY=Math.sin(-rY),cX=Math.cos(-rX),sX=Math.sin(-rX);let x1=p3D_r.x,y1=p3D_r.y*cX-p3D_r.z*sX,z1=p3D_r.y*sX+p3D_r.z*cX;return{x:x1*cY+z1*sY,y:y1,z:-x1*sY+z1*cY};}
export function projectSphereToCanvas2D(p3D_r,sCX,sCY,sR){if(isNaN(p3D_r.x))return{x:NaN,y:NaN,isVisible:false};return{x:sCX+p3D_r.x*sR,y:sCY-p3D_r.y*sR,isVisible:p3D_r.z>=0};}

export function updatePlaneViewportRanges(planeParams) {
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
