import { drawAxes, drawGrid, drawTipToTailVectors, drawSpiral, drawArrowHead } from './canvas-primitives.js';
import { mapToCanvasCoords } from '../utils/canvas-utils.js';

function drawReferenceOrbit(ctx, windingData, planeParams) {
    const origin = mapToCanvasCoords(0, 0, planeParams);
    const radius = Math.max(1, windingData.maxRadius || 1) * Math.abs(planeParams.scale.x);

    ctx.save();
    ctx.strokeStyle = 'rgba(150, 180, 255, 0.10)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, radius, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(200, 220, 255, 0.30)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, radius, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
}

function drawWindingSamples(ctx, windingData, planeParams) {
    const points = windingData.points;
    for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        const canvas = mapToCanvasCoords(point.real, point.imag, planeParams);
        const progress = points.length > 1 ? index / (points.length - 1) : 1;
        const size = 2.5 + progress * 1.5;

        ctx.beginPath();
        ctx.arc(canvas.x, canvas.y, size + 3, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(255, 100, 200, ${0.08 + progress * 0.12})`;
        ctx.fill();

        const gradient = ctx.createRadialGradient(canvas.x, canvas.y, 0, canvas.x, canvas.y, size);
        gradient.addColorStop(0, 'rgba(255, 180, 230, 1)');
        gradient.addColorStop(1, 'rgba(255, 100, 200, 0.9)');
        ctx.beginPath();
        ctx.arc(canvas.x, canvas.y, size, 0, 2 * Math.PI);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 200, 240, 0.9)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

function drawRadialWindingVectors(ctx, windingData, planeParams) {
    const points = windingData.points;
    const origin = mapToCanvasCoords(0, 0, planeParams);
    const step = Math.max(1, Math.floor(points.length / 28));
    ctx.save();
    for (let index = 0; index < points.length; index += step) {
        const point = points[index];
        const canvas = mapToCanvasCoords(point.real, point.imag, planeParams);
        const progress = index / Math.max(1, points.length - 1);
        ctx.strokeStyle = `rgba(100, 180, 255, ${0.10 + progress * 0.25})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(canvas.x, canvas.y);
        ctx.stroke();
    }
    ctx.restore();
}

function drawIntegralResult(ctx, windingData, planeParams) {
    const origin = mapToCanvasCoords(0, 0, planeParams);
    const result = mapToCanvasCoords(windingData.integral.real, windingData.integral.imag, planeParams);

    ctx.save();
    const glow = ctx.createRadialGradient(result.x, result.y, 0, result.x, result.y, 22);
    glow.addColorStop(0, 'rgba(255, 220, 50, 0.32)');
    glow.addColorStop(1, 'rgba(255, 220, 50, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(result.x, result.y, 22, 0, 2 * Math.PI);
    ctx.fill();

    const vector = ctx.createLinearGradient(origin.x, origin.y, result.x, result.y);
    vector.addColorStop(0, 'rgba(100, 200, 255, 0.4)');
    vector.addColorStop(1, 'rgba(255, 220, 50, 1)');
    ctx.strokeStyle = vector;
    ctx.lineWidth = 4;
    ctx.shadowColor = 'rgba(255, 220, 50, 0.6)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(result.x, result.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
    drawArrowHead(ctx, result.x, result.y, Math.atan2(result.y - origin.y, result.x - origin.x), 12, 'rgba(255, 220, 50, 1)');

    const marker = ctx.createRadialGradient(result.x, result.y, 0, result.x, result.y, 8);
    marker.addColorStop(0, 'rgba(255, 255, 200, 1)');
    marker.addColorStop(0.7, 'rgba(255, 220, 50, 1)');
    marker.addColorStop(1, 'rgba(255, 180, 0, 1)');
    ctx.fillStyle = marker;
    ctx.beginPath();
    ctx.arc(result.x, result.y, 8, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    const label = 'Center of Mass';
    const labelX = result.x + 15;
    const labelY = result.y - 8;
    ctx.font = 'bold 13px "SF Pro Display", sans-serif';
    const labelWidth = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(labelX - 4, labelY - 14, labelWidth + 8, 20);
    ctx.fillStyle = 'rgba(255, 240, 100, 1)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, labelX, labelY);
    ctx.restore();
}

// 3Blue1Brown-Quality Laplace Winding Visualization
// Shows f(t)·e^(-st) building up over time with vectors and labels

/**
 * Draw unified full-canvas Laplace winding visualization
 * Shows f(t)·e^(-st) spiral AND tip-to-tail integral geometry in one view
 */
export function drawLaplaceWindingPremium(ctx, signal, planeParams, windingData, options = {}) {
    if (!Array.isArray(signal) || signal.length < 2 || !Array.isArray(windingData?.points)) {
        throw new Error('Laplace winding rendering requires complete native frame data.');
    }

    ctx.save();

    ctx.fillStyle = 'rgba(8, 10, 18, 1)';
    ctx.fillRect(0, 0, planeParams.width, planeParams.height);

    if (windingData.points.length === 0) { ctx.restore(); return; }

    drawGrid(ctx, planeParams);
    drawAxes(ctx, planeParams, 'Real', 'Imaginary');
    drawReferenceOrbit(ctx, windingData, planeParams);
    drawRadialWindingVectors(ctx, windingData, planeParams);
    drawSpiral(ctx, windingData, planeParams, {
        baseColor: { r: 255, g: 100, b: 200 }
    });
    drawWindingSamples(ctx, windingData, planeParams);
    if (options.showIntegralEvaluation !== false) {
        drawTipToTailVectors(ctx, windingData, planeParams, {
            style: 'enhanced',
            numVectors: 16,
            animTime: 1,
            showLabels: (planeParams.scale.x + planeParams.scale.y) / 2 > 800,
        });
        drawIntegralResult(ctx, windingData, planeParams);
    }

    const origin = mapToCanvasCoords(0, 0, planeParams);
    const originGradient = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, 6);
    originGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    originGradient.addColorStop(1, 'rgba(180, 200, 255, 0.8)');
    ctx.fillStyle = originGradient;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = 'rgba(100, 150, 255, 1)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
}
