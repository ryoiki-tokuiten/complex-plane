import { state, zPlaneParams } from '../store/state.js';
import {
    COLOR_SPHERE_OUTLINE, COLOR_PROBE_MARKER, COLOR_PROBE_NEIGHBORHOOD, COLOR_SPHERE_GRID,
    COLOR_PROBE_CONFORMAL_LINE_Z_H, COLOR_PROBE_CONFORMAL_LINE_Z_V,
    COLOR_PROBE_CONFORMAL_LINE_W_H, COLOR_PROBE_CONFORMAL_LINE_W_V
} from '../constants/colors.js';
import { NUM_POINTS_CURVE, PROBE_CROSSHAIR_SIZE_FACTOR } from '../constants/numerical.js';
import { SPHERE_GRID_LINE_DEPTH_EFFECT, SPHERE_GRID_LINE_MAX_WIDTH_W, SPHERE_GRID_LINE_MAX_WIDTH_Z } from '../constants/rendering.js';
import { evaluateMappedTransform, getMappedTransformProfile } from '../math-utils.js';
import { complexToSphere, rotate3D, projectSphereToCanvas2D } from '../utils/canvas-utils.js';
import { isRasterInputShape } from '../utils/raster-media.js';
import { generateCurrentInputShapePointSets } from './shape-generators.js';

const SPHERE_MAX_SEGMENT_CHORD = 0.75;
const SPHERE_MAX_SEGMENT_CHORD_SQ = SPHERE_MAX_SEGMENT_CHORD * SPHERE_MAX_SEGMENT_CHORD;
const SPHERE_CURVE_TOLERANCE_PX = 1.5;
const SPHERE_MAX_SUBDIVISION_DEPTH = 8;

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

function sphereSampleAt(source, cSP, isWP, mappedTransform) {
    if (!source || !Number.isFinite(source.re) || !Number.isFinite(source.im)) {
        return null;
    }

    const transformedPoint = isWP
        ? evaluateMappedTransform(
            mappedTransform,
            source.re,
            source.im,
            state.currentFunction,
            { c: source }
        )
        : source;

    if (!transformedPoint || !Number.isFinite(transformedPoint.re) || !Number.isFinite(transformedPoint.im)) {
        return null;
    }

    const spherePoint = complexToSphere(transformedPoint.re, transformedPoint.im);
    const rotatedSpherePoint = rotate3D(spherePoint, cSP.rotX, cSP.rotY);
    const projectedPoint = projectSphereToCanvas2D(
        rotatedSpherePoint,
        cSP.centerX,
        cSP.centerY,
        cSP.radius
    );
    if (![rotatedSpherePoint.x, rotatedSpherePoint.y, rotatedSpherePoint.z, projectedPoint.x, projectedPoint.y]
        .every(Number.isFinite)) {
        return null;
    }

    return {
        source,
        rotatedSpherePoint,
        projectedPoint: { x: projectedPoint.x, y: projectedPoint.y },
        isVisible: projectedPoint.isVisible
    };
}

function sphereSegmentMidpoint(start, end, cSP, isWP, mappedTransform) {
    return sphereSampleAt({
        re: start.source.re * 0.5 + end.source.re * 0.5,
        im: start.source.im * 0.5 + end.source.im * 0.5
    }, cSP, isWP, mappedTransform);
}

function sphereChordSquared(start, end) {
    const dx = end.rotatedSpherePoint.x - start.rotatedSpherePoint.x;
    const dy = end.rotatedSpherePoint.y - start.rotatedSpherePoint.y;
    const dz = end.rotatedSpherePoint.z - start.rotatedSpherePoint.z;
    return dx * dx + dy * dy + dz * dz;
}

function shouldSubdivideSphereSegment(start, end, midpoint) {
    if (start.isVisible === end.isVisible && start.isVisible !== midpoint.isVisible) {
        return true;
    }

    if (sphereChordSquared(start, end) > SPHERE_MAX_SEGMENT_CHORD_SQ) {
        return true;
    }

    const chordMidX = (start.projectedPoint.x + end.projectedPoint.x) * 0.5;
    const chordMidY = (start.projectedPoint.y + end.projectedPoint.y) * 0.5;
    const errorX = midpoint.projectedPoint.x - chordMidX;
    const errorY = midpoint.projectedPoint.y - chordMidY;
    return errorX * errorX + errorY * errorY > SPHERE_CURVE_TOLERANCE_PX * SPHERE_CURVE_TOLERANCE_PX;
}

function collectSphereSegment(samples, start, end, cSP, isWP, mappedTransform, depth = 0) {
    if (depth >= SPHERE_MAX_SUBDIVISION_DEPTH) {
        if (sphereChordSquared(start, end) > SPHERE_MAX_SEGMENT_CHORD_SQ) {
            samples.push(null);
        }
        samples.push(end);
        return;
    }

    const midpoint = sphereSegmentMidpoint(start, end, cSP, isWP, mappedTransform);
    if (!midpoint) {
        samples.push(null, end);
        return;
    }

    if (shouldSubdivideSphereSegment(start, end, midpoint)) {
        collectSphereSegment(samples, start, midpoint, cSP, isWP, mappedTransform, depth + 1);
        collectSphereSegment(samples, midpoint, end, cSP, isWP, mappedTransform, depth + 1);
        return;
    }

    samples.push(end);
}

function findSphereLimbIntersection(start, end, cSP, isWP, mappedTransform) {
    let low = start;
    let high = end;
    const lowVisible = low.isVisible;

    for (let i = 0; i < 32; i += 1) {
        const midpoint = sphereSegmentMidpoint(low, high, cSP, isWP, mappedTransform);
        if (!midpoint) return null;
        if (midpoint.isVisible === lowVisible) {
            low = midpoint;
        } else {
            high = midpoint;
        }
    }

    return sphereSegmentMidpoint(low, high, cSP, isWP, mappedTransform) || high;
}

function sphereSegmentIsContinuous(start, end) {
    return Number.isFinite(start.projectedPoint.x) &&
        Number.isFinite(start.projectedPoint.y) &&
        Number.isFinite(end.projectedPoint.x) &&
        Number.isFinite(end.projectedPoint.y) &&
        sphereChordSquared(start, end) <= SPHERE_MAX_SEGMENT_CHORD_SQ;
}

function finishSpherePath(ctx, pathState) {
    if (pathState.open) {
        ctx.stroke();
        ctx.beginPath();
    }
    pathState.open = false;
}

function beginSpherePath(ctx, pathState, sample, baseLineWidth) {
    const depthFactor = Math.max(0, sample.rotatedSpherePoint.z);
    const lineWidth = SPHERE_GRID_LINE_DEPTH_EFFECT
        ? Math.max(0.5, baseLineWidth * (0.4 + 0.6 * depthFactor))
        : baseLineWidth;
    ctx.lineWidth = lineWidth;
    ctx.moveTo(sample.projectedPoint.x, sample.projectedPoint.y);
    pathState.open = true;
}

function consumeSphereSample(ctx, pathState, previous, current, cSP, isWP, mappedTransform, baseLineWidth) {
    if (!current) {
        finishSpherePath(ctx, pathState);
        return null;
    }

    if (!previous) {
        if (current.isVisible) beginSpherePath(ctx, pathState, current, baseLineWidth);
        return current;
    }

    if (!sphereSegmentIsContinuous(previous, current)) {
        finishSpherePath(ctx, pathState);
        if (current.isVisible) beginSpherePath(ctx, pathState, current, baseLineWidth);
        return current;
    }

    if (previous.isVisible && current.isVisible) {
        if (!pathState.open) beginSpherePath(ctx, pathState, previous, baseLineWidth);
        ctx.lineTo(current.projectedPoint.x, current.projectedPoint.y);
    } else if (previous.isVisible && !current.isVisible) {
        const limb = findSphereLimbIntersection(previous, current, cSP, isWP, mappedTransform);
        if (limb && pathState.open) ctx.lineTo(limb.projectedPoint.x, limb.projectedPoint.y);
        finishSpherePath(ctx, pathState);
    } else if (!previous.isVisible && current.isVisible) {
        const limb = findSphereLimbIntersection(previous, current, cSP, isWP, mappedTransform);
        finishSpherePath(ctx, pathState);
        if (limb) {
            beginSpherePath(ctx, pathState, limb, baseLineWidth);
            ctx.lineTo(current.projectedPoint.x, current.projectedPoint.y);
        } else {
            beginSpherePath(ctx, pathState, current, baseLineWidth);
        }
    } else {
        finishSpherePath(ctx, pathState);
    }

    return current;
}

export function drawMappedLineSetOnSphere(ctx, cSP, z_pts_src_arr, col, isWP, mappedTransform) {
    ctx.strokeStyle = col;

    const baseLineWidth = SPHERE_GRID_LINE_DEPTH_EFFECT
        ? (isWP ? SPHERE_GRID_LINE_MAX_WIDTH_W : SPHERE_GRID_LINE_MAX_WIDTH_Z)
        : (isWP ? 1.5 : 1.0);
    ctx.lineWidth = baseLineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    z_pts_src_arr.forEach(z_pts_src => {
        if (!z_pts_src || z_pts_src.length === 0) return;

        ctx.beginPath();
        const pathState = { open: false };
        let previous = null;

        for (const source of z_pts_src) {
            const current = sphereSampleAt(source, cSP, isWP, mappedTransform);
            if (!current) {
                previous = consumeSphereSample(
                    ctx,
                    pathState,
                    previous,
                    null,
                    cSP,
                    isWP,
                    mappedTransform,
                    baseLineWidth
                );
                continue;
            }

            const segmentSamples = [];
            if (previous) {
                collectSphereSegment(segmentSamples, previous, current, cSP, isWP, mappedTransform);
            } else {
                segmentSamples.push(current);
            }

            for (const sample of segmentSamples) {
                previous = consumeSphereSample(
                    ctx,
                    pathState,
                    previous,
                    sample,
                    cSP,
                    isWP,
                    mappedTransform,
                    baseLineWidth
                );
            }
        }

        finishSpherePath(ctx, pathState);
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
        ? generateCurrentInputShapePointSets(zPlaneParams, {
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

    if (!centerToDisplayOnSphere || isNaN(centerToDisplayOnSphere.re) || isNaN(centerToDisplayOnSphere.im) || !isFinite(centerToDisplayOnSphere.re) || !isFinite(centerToDisplayOnSphere.im)) {
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
