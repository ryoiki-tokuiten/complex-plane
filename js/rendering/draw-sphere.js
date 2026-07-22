import { state, zPlaneParams } from '../store/state.js';
import {
    COLOR_SPHERE_OUTLINE, COLOR_PROBE_MARKER, COLOR_PROBE_NEIGHBORHOOD, COLOR_SPHERE_GRID,
    COLOR_PROBE_CONFORMAL_LINE_Z_H, COLOR_PROBE_CONFORMAL_LINE_Z_V,
    COLOR_PROBE_CONFORMAL_LINE_W_H, COLOR_PROBE_CONFORMAL_LINE_W_V
} from '../constants/colors.js';
import { NUM_POINTS_CURVE, PROBE_CROSSHAIR_SIZE_FACTOR } from '../constants/numerical.js';
import { SPHERE_GRID_LINE_DEPTH_EFFECT, SPHERE_GRID_LINE_MAX_WIDTH_W, SPHERE_GRID_LINE_MAX_WIDTH_Z } from '../constants/rendering.js';
import { evaluateMappedTransform, getMappedTransformProfile, isNumericallyStable } from '../math-utils.js';
import { complexToSphere, rotate3D, projectSphereToCanvas2D } from '../utils/canvas-utils.js';
import { isRasterInputShape } from '../utils/raster-media.js';
import { generateCurrentInputShapePointSets, generateCurrentMappedInputShapePointSets } from './shape-generators.js';

export function drawRiemannSphereBase(ctx, cSP) {
    const { centerX: cX, centerY: cY, radius: r } = cSP;

    ctx.save();
    ctx.strokeStyle = state.gridColor1 || COLOR_SPHERE_OUTLINE;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 1.0;
    ctx.beginPath();
    ctx.arc(cX, cY, r, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
}

export function drawSphereMappedPoint(ctx, cSP, value, col, radius = 6, options = {}) {
    const spherePoint = complexToSphere(value.re, value.im);
    const rotatedSpherePoint = rotate3D(spherePoint, cSP.rotX, cSP.rotY);
    const canvasPoint = projectSphereToCanvas2D(rotatedSpherePoint, cSP.centerX, cSP.centerY, cSP.radius);
    if (!canvasPoint.isVisible) return;

    ctx.save();
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, radius, 0, 2 * Math.PI);
    if (options.variant !== 'outline') {
        ctx.fillStyle = col;
        ctx.fill();
    }
    ctx.lineWidth = options.variant === 'outline' ? 1.35 : 1;
    ctx.strokeStyle = options.variant === 'outline'
        ? col
        : 'rgba(10, 13, 22, 0.82)';
    ctx.stroke();
    if (options.variant === 'final') {
        ctx.beginPath();
        ctx.arc(canvasPoint.x, canvasPoint.y, radius + 2, 0, 2 * Math.PI);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(95, 199, 160, 0.58)';
        ctx.stroke();
    }
    ctx.restore();
}

export function drawMappedLineSetOnSphere(ctx, cSP, z_pts_src_arr, col, isWP, mappedTransform) {
    const { centerX: cX, centerY: cY, radius: r, rotX, rotY } = cSP;
    ctx.strokeStyle = col; 
    
    let baseLineWidth = isWP ? SPHERE_GRID_LINE_MAX_WIDTH_W : SPHERE_GRID_LINE_MAX_WIDTH_Z;
    if (!SPHERE_GRID_LINE_DEPTH_EFFECT) { 
        baseLineWidth = isWP ? 1.5 : 1.0;
    }
    ctx.lineWidth = baseLineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';


    z_pts_src_arr.forEach(z_pts_src => {
        if (!z_pts_src || z_pts_src.length === 0) return;

        ctx.beginPath();
        let firstVisiblePointInCurrentPath = true;
        let lastProjectedPoint = null; 
        let lastTransformedPoint = null;
        const jumpThresholdSq = 1e8; // ~31622 units - very large jumps indicate discontinuities

        for (const z_orig of z_pts_src) {
            if (!z_orig || z_orig.re === undefined || z_orig.im === undefined) { 
                if (lastProjectedPoint && lastProjectedPoint.isVisible && !firstVisiblePointInCurrentPath) {
                    ctx.stroke(); 
                }
                ctx.beginPath(); 
                firstVisiblePointInCurrentPath = true;
                lastProjectedPoint = null;
                lastTransformedPoint = null;
                continue;
            }

            const transformedPoint = isWP
                ? evaluateMappedTransform(
                    mappedTransform,
                    z_orig.re,
                    z_orig.im,
                    state.currentFunction,
                    { c: z_orig }
                )
                : z_orig;

            if (!transformedPoint || isNaN(transformedPoint.re) || isNaN(transformedPoint.im) || !isFinite(transformedPoint.re) || !isFinite(transformedPoint.im)) {
                if (lastProjectedPoint && lastProjectedPoint.isVisible && !firstVisiblePointInCurrentPath) {
                    ctx.stroke();
                }
                ctx.beginPath();
                firstVisiblePointInCurrentPath = true;
                lastProjectedPoint = null;
                lastTransformedPoint = null;
                continue;
            }

            // Jump detection in w-plane before projecting to sphere
            if (lastTransformedPoint !== null) {
                const distSq = (transformedPoint.re - lastTransformedPoint.re) ** 2 + (transformedPoint.im - lastTransformedPoint.im) ** 2;
                if (distSq > jumpThresholdSq) {
                    if (lastProjectedPoint && lastProjectedPoint.isVisible && !firstVisiblePointInCurrentPath) {
                        ctx.stroke();
                    }
                    ctx.beginPath();
                    firstVisiblePointInCurrentPath = true;
                    lastProjectedPoint = null;
                }
            }
            lastTransformedPoint = transformedPoint;

            const spherePoint = complexToSphere(transformedPoint.re, transformedPoint.im);
            const rotatedSpherePoint = rotate3D(spherePoint, rotX, rotY);
            const canvasPoint = projectSphereToCanvas2D(rotatedSpherePoint, cX, cY, r);
            
            const currentProjectedPoint = { ...canvasPoint, rotatedZ: rotatedSpherePoint.z };


            if (currentProjectedPoint.isVisible) {
                if (firstVisiblePointInCurrentPath || (lastProjectedPoint && !lastProjectedPoint.isVisible)) {
                    if (SPHERE_GRID_LINE_DEPTH_EFFECT) {
                        const depthFactor = Math.max(0, currentProjectedPoint.rotatedZ); 
                        const modulatedLineWidth = baseLineWidth * (0.4 + 0.6 * depthFactor); 
                        ctx.lineWidth = Math.max(0.5, modulatedLineWidth); 
                    } else {
                        ctx.lineWidth = baseLineWidth;
                    }
                    ctx.moveTo(currentProjectedPoint.x, currentProjectedPoint.y);
                    if (firstVisiblePointInCurrentPath) firstVisiblePointInCurrentPath = false;
                } else {
                    ctx.lineTo(currentProjectedPoint.x, currentProjectedPoint.y);
                }
            } else { 
                if (lastProjectedPoint && lastProjectedPoint.isVisible && !firstVisiblePointInCurrentPath) { 
                    
                    ctx.lineTo(currentProjectedPoint.x, currentProjectedPoint.y); 
                    ctx.stroke();
                    ctx.beginPath(); 
                    firstVisiblePointInCurrentPath = true;
                }
            }
            lastProjectedPoint = currentProjectedPoint;
        }
        if (lastProjectedPoint && lastProjectedPoint.isVisible && !firstVisiblePointInCurrentPath) {
            ctx.stroke(); 
        }
    });
}

export function getSpherePointSetColor(pointSet) {
    return pointSet.color || COLOR_SPHERE_GRID;
}

export function drawSphereGridAndShape(ctx, cSP, isWP, tf = null) {
    if (isRasterInputShape(state.currentInputShape)) {
        return; // CPU Image mapping removed. Riemann sphere doesn't natively support video textures yet.
    }

    const transformProfile = isWP && typeof tf === 'function'
        ? getMappedTransformProfile(state.currentFunction, tf)
        : null;

    const sourcePointSets = isWP
        ? generateCurrentMappedInputShapePointSets(zPlaneParams, {
            currentFunction: state.currentFunction,
            zetaContinuationEnabled: state.zetaContinuationEnabled,
            curvePoints: NUM_POINTS_CURVE
        })
        : generateCurrentInputShapePointSets(zPlaneParams, {
            currentFunction: state.currentFunction,
            zetaContinuationEnabled: state.zetaContinuationEnabled,
            curvePoints: NUM_POINTS_CURVE
        });

    if (transformProfile && transformProfile.isConstant) {
        const firstColor = (sourcePointSets.find(set => set && set.color) || {}).color || COLOR_SPHERE_GRID;
        drawSphereMappedPoint(ctx, cSP, transformProfile.constantValue, firstColor);
        return;
    }

    sourcePointSets.forEach(set => {
        drawMappedLineSetOnSphere(
            ctx,
            cSP,
            [set.points],
            getSpherePointSetColor(set, isWP),
            isWP,
            transformProfile
        );
    });
}

export function drawSphereProbeAndNeighborhood(ctx, cSP, sourceProbeZ, neighborhoodSize, transformFuncIfWSphere) {
    const isWSphere = typeof transformFuncIfWSphere === 'function';
    const transformProfile = isWSphere ? getMappedTransformProfile(state.currentFunction, transformFuncIfWSphere) : null;
    const centerToDisplayOnSphere = isWSphere
        ? evaluateMappedTransform(
            transformProfile,
            sourceProbeZ.re,
            sourceProbeZ.im,
            state.currentFunction,
            { c: sourceProbeZ }
        )
        : sourceProbeZ;

    if (!centerToDisplayOnSphere || isNaN(centerToDisplayOnSphere.re) || isNaN(centerToDisplayOnSphere.im) || !isFinite(centerToDisplayOnSphere.re) || !isFinite(centerToDisplayOnSphere.im) || !isNumericallyStable(centerToDisplayOnSphere)) {
        return; 
    }

    
    const p3d_center = complexToSphere(centerToDisplayOnSphere.re, centerToDisplayOnSphere.im);
    const p3d_rot_center = rotate3D(p3d_center, cSP.rotX, cSP.rotY);
    const p2d_canvas_center = projectSphereToCanvas2D(p3d_rot_center, cSP.centerX, cSP.centerY, cSP.radius);
    const centerVisible = p2d_canvas_center.isVisible;

    if (centerVisible) {
        ctx.save();
        ctx.fillStyle = COLOR_PROBE_MARKER;
        ctx.beginPath();
        ctx.arc(p2d_canvas_center.x, p2d_canvas_center.y, 4, 0, 2 * Math.PI); 
        ctx.fill();
        ctx.restore();
    }

    
    const n_pts_circle = 30;
    const src_circle_pts = [];
    for (let i = 0; i <= n_pts_circle; i++) {
        const angle = (i / n_pts_circle) * 2 * Math.PI;
        src_circle_pts.push({
            re: sourceProbeZ.re + neighborhoodSize * Math.cos(angle),
            im: sourceProbeZ.im + neighborhoodSize * Math.sin(angle)
        });
    }

    const h_segment = neighborhoodSize / PROBE_CROSSHAIR_SIZE_FACTOR;
    const src_horz_line_pts = [
        { re: sourceProbeZ.re - h_segment, im: sourceProbeZ.im },
        { re: sourceProbeZ.re + h_segment, im: sourceProbeZ.im }
    ];
    const src_vert_line_pts = [
        { re: sourceProbeZ.re, im: sourceProbeZ.im - h_segment },
        { re: sourceProbeZ.re, im: sourceProbeZ.im + h_segment }
    ];

    
    
    const tfForMapping = isWSphere ? transformProfile : null;
    
    drawMappedLineSetOnSphere(ctx, cSP, [src_circle_pts], COLOR_PROBE_NEIGHBORHOOD, isWSphere, tfForMapping);
    drawMappedLineSetOnSphere(ctx, cSP, [src_horz_line_pts], isWSphere ? COLOR_PROBE_CONFORMAL_LINE_W_H : COLOR_PROBE_CONFORMAL_LINE_Z_H, isWSphere, tfForMapping);
    drawMappedLineSetOnSphere(ctx, cSP, [src_vert_line_pts], isWSphere ? COLOR_PROBE_CONFORMAL_LINE_W_V : COLOR_PROBE_CONFORMAL_LINE_Z_V, isWSphere, tfForMapping);
}
