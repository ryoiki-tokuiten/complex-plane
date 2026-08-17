import { state, zPlaneParams } from '../store/state.js';
import {
    COLOR_SPHERE_OUTLINE, COLOR_PROBE_MARKER, COLOR_PROBE_NEIGHBORHOOD, COLOR_SPHERE_GRID,
    COLOR_PROBE_CONFORMAL_LINE_Z_H, COLOR_PROBE_CONFORMAL_LINE_Z_V,
    COLOR_PROBE_CONFORMAL_LINE_W_H, COLOR_PROBE_CONFORMAL_LINE_W_V
} from '../constants/colors.js';
import { NUM_POINTS_CURVE, PROBE_CROSSHAIR_SIZE_FACTOR } from '../constants/numerical.js';
import {
    SPHERE_GRID_LINE_DEPTH_EFFECT,
    SPHERE_GRID_LINE_MAX_WIDTH_W,
    SPHERE_GRID_LINE_MAX_WIDTH_Z
} from '../constants/rendering.js';
import {
    buildNativeSphereLines,
    buildNativeSphereProbe,
    nativeMapOptions,
    projectNativeSpherePoints
} from '../native/complex-engine.js';
import { isRasterInputShape } from '../utils/raster-media.js';
import { generateCurrentInputShapePointSets } from './shape-generators.js';

function sphereMap(map, isMapped) {
    if (!isMapped) return null;
    if (!map) throw new Error('Mapped sphere geometry requires a native map.');
    return nativeMapOptions(state, {
        stage: map.stage,
        derivativeMode: map.presentation === 'derivative',
        ...(map.evaluate?.nativeMapOptions || map.nativeMapOptions || {})
    });
}

export function drawRiemannSphereBase(ctx, sphere) {
    ctx.save();
    ctx.strokeStyle = state.gridColor1 || COLOR_SPHERE_OUTLINE;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(sphere.centerX, sphere.centerY, sphere.radius, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
}

export function drawSphereMappedPoint(ctx, sphere, value, color, radius = 6, options = {}) {
    const projected = projectNativeSpherePoints({ sphere, mapPoints: false }, [value]);
    if (!projected.visible[0]) return;
    const x = projected.positions[0];
    const y = projected.positions[1];
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    if (options.variant !== 'outline') {
        ctx.fillStyle = color;
        ctx.fill();
    }
    ctx.lineWidth = options.variant === 'outline' ? 1.35 : 1;
    ctx.strokeStyle = options.variant === 'outline' ? color : 'rgba(10, 13, 22, 0.82)';
    ctx.stroke();
    if (options.variant === 'final') {
        ctx.beginPath();
        ctx.arc(x, y, radius + 2, 0, 2 * Math.PI);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(95, 199, 160, 0.58)';
        ctx.stroke();
    }
    ctx.restore();
}

function drawSphereTokens(ctx, tokens, color, isMapped) {
    if (!tokens?.length) return;
    const baseLineWidth = SPHERE_GRID_LINE_DEPTH_EFFECT
        ? (isMapped ? SPHERE_GRID_LINE_MAX_WIDTH_W : SPHERE_GRID_LINE_MAX_WIDTH_Z)
        : (isMapped ? 1.5 : 1);
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let open = false;
    for (let offset = 0; offset < tokens.length; offset += 3) {
        const x = tokens[offset];
        const y = tokens[offset + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            if (open) ctx.stroke();
            ctx.beginPath();
            open = false;
            continue;
        }
        if (!open) {
            const depth = tokens[offset + 2];
            ctx.lineWidth = SPHERE_GRID_LINE_DEPTH_EFFECT
                ? Math.max(0.5, baseLineWidth * (0.4 + 0.6 * depth))
                : baseLineWidth;
            ctx.moveTo(x, y);
            open = true;
        } else ctx.lineTo(x, y);
    }
    if (open) ctx.stroke();
}

export function drawMappedLineSetOnSphere(ctx, sphere, sourceLines, color, options = {}) {
    const isMapped = options.mapPoints === true;
    const geometry = buildNativeSphereLines({
        sphere,
        mapPoints: isMapped,
        mapOptions: sphereMap(options.map, isMapped)
    }, sourceLines);
    geometry.forEach(tokens => drawSphereTokens(ctx, tokens, color, isMapped));
}

export function getSpherePointSetColor(pointSet) {
    return pointSet.color || COLOR_SPHERE_GRID;
}

export function drawSphereGridAndShape(ctx, sphere, isMapped, map = null) {
    if (isRasterInputShape(state.currentInputShape)) return;
    const pointSets = generateCurrentInputShapePointSets(zPlaneParams, {
        currentFunction: state.currentFunction,
        zetaContinuationEnabled: state.zetaContinuationEnabled,
        curvePoints: NUM_POINTS_CURVE
    });
    const geometry = buildNativeSphereLines({
        sphere,
        mapPoints: isMapped,
        mapOptions: sphereMap(map, isMapped)
    }, pointSets.map(set => set.points));
    geometry.forEach((tokens, index) => {
        drawSphereTokens(ctx, tokens, getSpherePointSetColor(pointSets[index]), isMapped);
    });
}

export function drawSphereProbeAndNeighborhood(ctx, sphere, source, neighborhoodSize, map = null) {
    const isMapped = !!map;
    const geometry = buildNativeSphereProbe({
        sphere,
        source,
        neighborhoodSize,
        crosshairFactor: PROBE_CROSSHAIR_SIZE_FACTOR,
        mapPoints: isMapped,
        mapOptions: sphereMap(map, isMapped)
    });
    if (geometry.center.visible) {
        ctx.save();
        ctx.fillStyle = COLOR_PROBE_MARKER;
        ctx.beginPath();
        ctx.arc(geometry.center.x, geometry.center.y, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
    }
    const colors = isMapped
        ? [COLOR_PROBE_NEIGHBORHOOD, COLOR_PROBE_CONFORMAL_LINE_W_H, COLOR_PROBE_CONFORMAL_LINE_W_V]
        : [COLOR_PROBE_NEIGHBORHOOD, COLOR_PROBE_CONFORMAL_LINE_Z_H, COLOR_PROBE_CONFORMAL_LINE_Z_V];
    geometry.lines.forEach((tokens, index) => drawSphereTokens(ctx, tokens, colors[index], isMapped));
}
