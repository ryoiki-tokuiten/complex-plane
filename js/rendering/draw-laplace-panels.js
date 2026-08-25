import { state } from '../store/state.js';
import { COLOR_CANVAS_BACKGROUND } from '../constants/colors.js';
import { mapToCanvasCoords } from '../utils/canvas-utils.js';
import { drawAxes, drawGrid, drawTipToTailVectors, drawSpiral, drawArrowHead } from './canvas-primitives.js';

export function drawLaplaceTimeDomain(ctx, signal, planeParams, frameData) {
    if (!Array.isArray(signal) || signal.length < 2 || frameData?.weighted?.length !== signal.length ||
        frameData?.envelope?.length !== signal.length) {
        throw new Error('Laplace time-domain rendering requires complete native frame data.');
    }

    ctx.save();
    ctx.fillStyle = COLOR_CANVAS_BACKGROUND;
    ctx.fillRect(0, 0, planeParams.width, planeParams.height);
    drawGrid(ctx, planeParams);
    drawAxes(ctx, planeParams, "Time (t)", "f(t)");

    const sigma = frameData.sigma;
    const maxAmp = frameData.maxAmplitude;
    const progress = Math.max(0, Math.min(1, frameData.animTime ?? 1));
    const timeWindow = signal.at(-1)?.t || 1;
    const windingTime = timeWindow * progress;

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(100, 200, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    signal.forEach((pt, i) => {
        const c = mapToCanvasCoords(pt.t, pt.value, planeParams);
        if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(255, 100, 150, 0.5)';
    ctx.shadowBlur = 8;
    for (let i = 0; i < signal.length; i++) {
        const pt = signal[i];
        const canvasPos = mapToCanvasCoords(pt.t, frameData.weighted[i], planeParams);
        const t = i / signal.length;
        ctx.strokeStyle = `hsla(${340 - t * 20}, 90%, 65%, ${0.7 + t * 0.3})`;
        if (i > 0) {
            const prevPos = mapToCanvasCoords(signal[i - 1].t, frameData.weighted[i - 1], planeParams);
            ctx.beginPath();
            ctx.moveTo(prevPos.x, prevPos.y);
            ctx.lineTo(canvasPos.x, canvasPos.y);
            ctx.stroke();
        }
    }
    ctx.shadowBlur = 0;

    if (Math.abs(sigma) > 0.01) {
        ctx.strokeStyle = sigma > 0 ? 'rgba(255, 200, 100, 0.4)' : 'rgba(100, 255, 200, 0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        signal.forEach((pt, i) => {
            const c = mapToCanvasCoords(pt.t, frameData.envelope[i], planeParams);
            if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y);
        });
        ctx.stroke();

        ctx.beginPath();
        signal.forEach((pt, i) => {
            const c = mapToCanvasCoords(pt.t, -frameData.envelope[i], planeParams);
            if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
    }

    const step = Math.max(1, Math.floor(signal.length / 50));
    for (let i = 0; i < signal.length; i += step) {
        const pt = signal[i];
        const canvasPos = mapToCanvasCoords(pt.t, frameData.weighted[i], planeParams);
        const isPast = pt.t <= windingTime;
        const damping = maxAmp > 0 ? frameData.envelope[i] / maxAmp : 0;
        const dampingIntensity = sigma > 0 ? damping : Math.min(1, damping);

        ctx.beginPath();
        ctx.arc(canvasPos.x, canvasPos.y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = isPast ? `rgba(255, 100, 200, ${0.12 * dampingIntensity})` : 'rgba(100, 150, 200, 0.08)';
        ctx.fill();

        const grad = ctx.createRadialGradient(canvasPos.x, canvasPos.y, 0, canvasPos.x, canvasPos.y, 3);
        grad.addColorStop(0, isPast ? 'rgba(255, 180, 230, 1)' : 'rgba(120, 160, 210, 0.55)');
        grad.addColorStop(1, isPast ? 'rgba(255, 100, 180, 0.9)' : 'rgba(80, 120, 170, 0.35)');
        ctx.beginPath();
        ctx.arc(canvasPos.x, canvasPos.y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = grad;
        ctx.fill();
        if (isPast) {
            ctx.strokeStyle = 'rgba(255, 210, 240, 0.85)';
            ctx.lineWidth = 1.25;
            ctx.stroke();
        }
    }

    if (progress > 0 && progress <= 1) {
        const cursorX = mapToCanvasCoords(windingTime, 0, planeParams).x;
        const cursor = ctx.createLinearGradient(cursorX, 0, cursorX, planeParams.height);
        cursor.addColorStop(0, 'rgba(255, 180, 100, 0.3)');
        cursor.addColorStop(0.5, 'rgba(255, 150, 100, 0.9)');
        cursor.addColorStop(1, 'rgba(255, 180, 100, 0.3)');
        ctx.strokeStyle = cursor;
        ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(255, 150, 100, 0.6)';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(cursorX, 0); ctx.lineTo(cursorX, planeParams.height);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255, 200, 150, 1)';
        ctx.font = 'bold 11px "SF Pro Text", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`t = ${windingTime.toFixed(2)}s`, cursorX, 16);
    }
    ctx.restore();
}

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

    const label = 'Center of Mass', labelX = result.x + 15, labelY = result.y - 8;
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

export function drawLaplaceWindingVisualization(ctx, signal, planeParams, frameData, options = {}) {
    if (!Array.isArray(signal) || signal.length < 2 || !Array.isArray(frameData?.points)) {
        throw new Error('Laplace winding rendering requires complete native frame data.');
    }

    ctx.save();
    ctx.fillStyle = 'rgba(8, 10, 18, 1)';
    ctx.fillRect(0, 0, planeParams.width, planeParams.height);

    if (frameData.points.length === 0) {
        ctx.restore();
        drawPolesAndZerosOverlay(ctx, planeParams);
        return;
    }

    drawGrid(ctx, planeParams);
    drawAxes(ctx, planeParams, 'Real', 'Imaginary');
    drawReferenceOrbit(ctx, frameData, planeParams);
    drawRadialWindingVectors(ctx, frameData, planeParams);
    drawSpiral(ctx, frameData, planeParams, { baseColor: { r: 255, g: 100, b: 200 } });
    drawWindingSamples(ctx, frameData, planeParams);
    if (options.showIntegralEvaluation !== false) {
        drawTipToTailVectors(ctx, frameData, planeParams, {
            style: 'enhanced',
            numVectors: 16,
            animTime: 1,
            showLabels: (planeParams.scale.x + planeParams.scale.y) / 2 > 800,
        });
        drawIntegralResult(ctx, frameData, planeParams);
    }

    const origin = mapToCanvasCoords(0, 0, planeParams);
    const grad = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, 6);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(1, 'rgba(180, 200, 255, 0.8)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = 'rgba(100, 150, 255, 1)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    drawPolesAndZerosOverlay(ctx, planeParams);
}

export function drawLaplaceSpectrum(canvas, spectrum) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = Math.max(1, Math.floor(canvas.clientWidth || canvas.width || 420));
    const height = Math.max(1, Math.floor(canvas.clientHeight || canvas.height || 320));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLOR_CANVAS_BACKGROUND;
    ctx.fillRect(0, 0, width, height);

    if (!Array.isArray(spectrum) || spectrum.length === 0) {
        ctx.fillStyle = 'rgba(200, 220, 255, 0.7)';
        ctx.font = '12px "SF Pro Text", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Spectrum appears after a signal is generated', width / 2, height / 2);
        return;
    }

    const visible = spectrum.slice(0, Math.max(1, Math.floor(spectrum.length / 2)));
    const maximum = Math.max(Number.EPSILON, ...visible.map(point => point.magnitude || 0));
    const padding = { top: 18, right: 10, bottom: 22, left: 28 };
    const plotWidth = Math.max(1, width - padding.left - padding.right);
    const plotHeight = Math.max(1, height - padding.top - padding.bottom);
    const barWidth = plotWidth / visible.length;

    ctx.strokeStyle = 'rgba(180, 220, 240, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, height - padding.bottom);
    ctx.lineTo(width - padding.right, height - padding.bottom);
    ctx.stroke();

    visible.forEach((point, index) => {
        const magnitude = Math.max(0, point.magnitude || 0);
        const barHeight = (magnitude / maximum) * plotHeight;
        const x = padding.left + index * barWidth;
        const y = height - padding.bottom - barHeight;
        const gradient = ctx.createLinearGradient(x, y, x, height - padding.bottom);
        gradient.addColorStop(0, 'rgba(255, 220, 120, 0.95)');
        gradient.addColorStop(1, 'rgba(160, 120, 255, 0.35)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x + 0.5, y, Math.max(1, barWidth - 1), barHeight);
    });

    ctx.fillStyle = 'rgba(200, 220, 255, 0.75)';
    ctx.font = '10px "SF Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('DFT magnitude', padding.left, 12);
    ctx.textAlign = 'center';
    ctx.fillText('frequency bin k', width / 2, height - 5);
    ctx.textAlign = 'right';
    ctx.fillText(maximum.toFixed(2), padding.left - 4, padding.top + 4);
}

export function drawPolesAndZerosOverlay(ctx, planeParams) {
    const showPolesZeros = state.laplaceShowPolesZeros !== false;
    const showROC = state.laplaceShowROC !== false;
    if ((!showPolesZeros && !showROC) || (!state.laplacePoles && !state.laplaceZeros && !state.laplaceROC)) return;

    ctx.save();
    if (showROC && state.laplaceROC && state.laplaceROC.boundary !== null) {
        const boundaryCanvas = mapToCanvasCoords(state.laplaceROC.boundary, 0, planeParams);
        ctx.fillStyle = 'rgba(100, 255, 150, 0.08)';
        ctx.fillRect(boundaryCanvas.x, 0, planeParams.width - boundaryCanvas.x, planeParams.height);
        ctx.strokeStyle = 'rgba(100, 255, 150, 0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(boundaryCanvas.x, 0); ctx.lineTo(boundaryCanvas.x, planeParams.height);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(100, 255, 150, 0.9)';
        ctx.font = 'italic 11px "SF Pro Text", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('ROC', boundaryCanvas.x + 8, 20);
    }

    if (showPolesZeros && Array.isArray(state.laplaceZeros)) {
        for (const zero of state.laplaceZeros) {
            const canvas = mapToCanvasCoords(zero.sigma, zero.omega, planeParams);
            ctx.beginPath();
            ctx.arc(canvas.x, canvas.y, 12, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(100, 200, 255, 0.15)';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(canvas.x, canvas.y, 8, 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(100, 200, 255, 0.9)';
            ctx.lineWidth = 2.5;
            ctx.stroke();
            if (zero.label) {
                ctx.fillStyle = 'rgba(150, 220, 255, 0.9)';
                ctx.font = '10px "SF Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText(zero.label, canvas.x, canvas.y + 20);
            }
        }
    }

    if (showPolesZeros && Array.isArray(state.laplacePoles)) {
        for (const pole of state.laplacePoles) {
            const canvas = mapToCanvasCoords(pole.sigma, pole.omega, planeParams);
            ctx.beginPath();
            ctx.arc(canvas.x, canvas.y, 18, 0, 2 * Math.PI);
            const glow = ctx.createRadialGradient(canvas.x, canvas.y, 0, canvas.x, canvas.y, 18);
            glow.addColorStop(0, 'rgba(255, 150, 100, 0.4)');
            glow.addColorStop(1, 'rgba(255, 150, 100, 0)');
            ctx.fillStyle = glow;
            ctx.fill();

            const size = 10;
            ctx.strokeStyle = 'rgba(255, 150, 100, 1)';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(canvas.x - size, canvas.y - size); ctx.lineTo(canvas.x + size, canvas.y + size);
            ctx.moveTo(canvas.x + size, canvas.y - size); ctx.lineTo(canvas.x - size, canvas.y + size);
            ctx.stroke();

            if (pole.label) {
                ctx.font = '10px "SF Mono", monospace';
                const labelWidth = ctx.measureText(pole.label).width;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.fillRect(canvas.x - labelWidth / 2 - 2, canvas.y + 16, labelWidth + 4, 14);
                ctx.fillStyle = 'rgba(255, 180, 120, 1)';
                ctx.textAlign = 'center';
                ctx.fillText(pole.label, canvas.x, canvas.y + 26);
            }
        }
    }
    ctx.restore();
}
