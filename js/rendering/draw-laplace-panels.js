import { state } from '../store/state.js';
import { COLOR_CANVAS_BACKGROUND } from '../constants/colors.js';
import { mapToCanvasCoords } from '../utils/canvas-utils.js';
import { drawAxes, drawGrid } from './canvas-primitives.js';
import { drawLaplaceWindingPremium } from './draw-laplace-winding-3b1b.js';

// Laplace Transform 3-Panel Visualization
// Professional rendering with time domain, s-plane, and 3D surface

/**
 * Draw LEFT PANEL: Time domain signal with exponential weighting e^(-σt)
 * Shows both original signal f(t) and weighted version f(t)·e^(-σt)
 */
export function drawLaplaceTimeDomain(ctx, signal, planeParams, frameData) {
    if (!Array.isArray(signal) || signal.length < 2 || frameData?.weighted?.length !== signal.length ||
        frameData?.envelope?.length !== signal.length) {
        throw new Error('Laplace time-domain rendering requires complete native frame data.');
    }

    ctx.save();

    // Clear canvas
    ctx.fillStyle = COLOR_CANVAS_BACKGROUND;
    ctx.fillRect(0, 0, planeParams.width, planeParams.height);

    // All transform panes use the shared Cartesian grid and world-coordinate zoom.
    drawGrid(ctx, planeParams);
    drawAxes(ctx, planeParams, "Time (t)", "f(t)");

    const sigma = frameData.sigma;
    const maxAmp = frameData.maxAmplitude;
    const progress = Math.max(0, Math.min(1, frameData.animTime ?? 1));
    const timeWindow = signal.at(-1)?.t || 1;
    const windingTime = timeWindow * progress;

    // Draw ORIGINAL signal f(t) in light blue
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(100, 200, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);

    for (let i = 0; i < signal.length; i++) {
        const pt = signal[i];
        const canvasPos = mapToCanvasCoords(pt.t, pt.value, planeParams);

        if (i === 0) {
            ctx.moveTo(canvasPos.x, canvasPos.y);
        } else {
            ctx.lineTo(canvasPos.x, canvasPos.y);
        }
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw WEIGHTED signal f(t)·e^(-σt) with gradient
    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(255, 100, 150, 0.5)';
    ctx.shadowBlur = 8;

    for (let i = 0; i < signal.length; i++) {
        const pt = signal[i];
        const weightedValue = frameData.weighted[i];

        const canvasPos = mapToCanvasCoords(pt.t, weightedValue, planeParams);

        // Gradient stroke based on position
        const t = i / signal.length;
        const hue = 340 - t * 20;
        ctx.strokeStyle = `hsla(${hue}, 90%, 65%, ${0.7 + t * 0.3})`;

        if (i > 0) {
            const prevPt = signal[i - 1];
            const prevWeightedValue = frameData.weighted[i - 1];
            const prevCanvasPos = mapToCanvasCoords(prevPt.t, prevWeightedValue, planeParams);

            ctx.beginPath();
            ctx.moveTo(prevCanvasPos.x, prevCanvasPos.y);
            ctx.lineTo(canvasPos.x, canvasPos.y);
            ctx.stroke();
        }
    }
    ctx.shadowBlur = 0;

    // Draw exponential envelope e^(-σt)
    if (Math.abs(sigma) > 0.01) {
        ctx.strokeStyle = sigma > 0 ? 'rgba(255, 200, 100, 0.4)' : 'rgba(100, 255, 200, 0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();

        for (let i = 0; i < signal.length; i++) {
            const pt = signal[i];
            const envelope = frameData.envelope[i];
            const canvasPos = mapToCanvasCoords(pt.t, envelope, planeParams);

            if (i === 0) {
                ctx.moveTo(canvasPos.x, canvasPos.y);
            } else {
                ctx.lineTo(canvasPos.x, canvasPos.y);
            }
        }
        ctx.stroke();

        // Negative envelope
        ctx.beginPath();
        for (let i = 0; i < signal.length; i++) {
            const pt = signal[i];
            const envelope = -frameData.envelope[i];
            const canvasPos = mapToCanvasCoords(pt.t, envelope, planeParams);

            if (i === 0) {
                ctx.moveTo(canvasPos.x, canvasPos.y);
            } else {
                ctx.lineTo(canvasPos.x, canvasPos.y);
            }
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Draw sample points with color coding based on damping and animation progress
    for (let i = 0; i < signal.length; i += Math.max(1, Math.floor(signal.length / 50))) {
        const pt = signal[i];
        const weightedValue = frameData.weighted[i];

        const canvasPos = mapToCanvasCoords(pt.t, weightedValue, planeParams);

        const isPast = pt.t <= windingTime;
        const damping = maxAmp > 0 ? frameData.envelope[i] / maxAmp : 0;
        const dampingIntensity = sigma > 0 ? damping : Math.min(1, damping);

        // Outer glow
        ctx.beginPath();
        ctx.arc(canvasPos.x, canvasPos.y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = isPast
            ? `rgba(255, 100, 200, ${0.12 * dampingIntensity})`
            : 'rgba(100, 150, 200, 0.08)';
        ctx.fill();

        // Main point
        const gradient = ctx.createRadialGradient(canvasPos.x, canvasPos.y, 0, canvasPos.x, canvasPos.y, 3);
        gradient.addColorStop(0, isPast ? 'rgba(255, 180, 230, 1)' : 'rgba(120, 160, 210, 0.55)');
        gradient.addColorStop(1, isPast ? 'rgba(255, 100, 180, 0.9)' : 'rgba(80, 120, 170, 0.35)');

        ctx.beginPath();
        ctx.arc(canvasPos.x, canvasPos.y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = gradient;
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
        ctx.moveTo(cursorX, 0);
        ctx.lineTo(cursorX, planeParams.height);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255, 200, 150, 1)';
        ctx.font = 'bold 11px "SF Pro Text", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`t = ${windingTime.toFixed(2)}s`, cursorX, 16);
    }

    ctx.restore();
}

/**
 * Draw MIDDLE PANEL: Premium 3b1b-quality winding visualization
 */
export function drawLaplaceWindingVisualization(ctx, signal, planeParams, frameData, options) {
    drawLaplaceWindingPremium(ctx, signal, planeParams, frameData, options);

    // Draw poles and zeros overlay on top
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

/**
 * Draw poles (×) and zeros (○) on the s-plane with 3b1b quality
 */
export function drawPolesAndZerosOverlay(ctx, planeParams) {
    // Check if user wants to see poles/zeros
    const showPolesZeros = state.laplaceShowPolesZeros !== false;
    const showROC = state.laplaceShowROC !== false;

    if (!showPolesZeros && !showROC) return;
    if (!state.laplacePoles && !state.laplaceZeros && !state.laplaceROC) return;

    ctx.save();

    // Draw ROC (Region of Convergence) first as subtle background
    if (showROC && state.laplaceROC && state.laplaceROC.boundary !== null) {
        const sigma_boundary = state.laplaceROC.boundary;
        const boundaryCanvas = mapToCanvasCoords(sigma_boundary, 0, planeParams);

        // Shade the ROC region
        ctx.fillStyle = 'rgba(100, 255, 150, 0.08)';
        ctx.fillRect(boundaryCanvas.x, 0, planeParams.width - boundaryCanvas.x, planeParams.height);

        // Draw ROC boundary line
        ctx.strokeStyle = 'rgba(100, 255, 150, 0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(boundaryCanvas.x, 0);
        ctx.lineTo(boundaryCanvas.x, planeParams.height);
        ctx.stroke();
        ctx.setLineDash([]);

        // ROC label
        ctx.fillStyle = 'rgba(100, 255, 150, 0.9)';
        ctx.font = 'italic 11px "SF Pro Text", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('ROC', boundaryCanvas.x + 8, 20);
    }

    // Draw ZEROS (○) - less emphasis
    if (showPolesZeros && state.laplaceZeros && state.laplaceZeros.length > 0) {
        for (const zero of state.laplaceZeros) {
            const canvas = mapToCanvasCoords(zero.sigma, zero.omega, planeParams);

            // Outer glow
            ctx.beginPath();
            ctx.arc(canvas.x, canvas.y, 12, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(100, 200, 255, 0.15)';
            ctx.fill();

            // Circle marker
            ctx.beginPath();
            ctx.arc(canvas.x, canvas.y, 8, 0, 2 * Math.PI);
            ctx.strokeStyle = 'rgba(100, 200, 255, 0.9)';
            ctx.lineWidth = 2.5;
            ctx.stroke();

            // Label if provided
            if (zero.label) {
                ctx.fillStyle = 'rgba(150, 220, 255, 0.9)';
                ctx.font = '10px "SF Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText(zero.label, canvas.x, canvas.y + 20);
            }
        }
    }

    // Draw POLES (×) - more emphasis
    if (showPolesZeros && state.laplacePoles && state.laplacePoles.length > 0) {
        for (const pole of state.laplacePoles) {
            const canvas = mapToCanvasCoords(pole.sigma, pole.omega, planeParams);

            // Large glow for poles
            ctx.beginPath();
            ctx.arc(canvas.x, canvas.y, 18, 0, 2 * Math.PI);
            const poleGlow = ctx.createRadialGradient(canvas.x, canvas.y, 0, canvas.x, canvas.y, 18);
            poleGlow.addColorStop(0, 'rgba(255, 150, 100, 0.4)');
            poleGlow.addColorStop(1, 'rgba(255, 150, 100, 0)');
            ctx.fillStyle = poleGlow;
            ctx.fill();

            // X marker (two diagonal lines)
            const size = 10;
            ctx.strokeStyle = 'rgba(255, 150, 100, 1)';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';

            ctx.beginPath();
            ctx.moveTo(canvas.x - size, canvas.y - size);
            ctx.lineTo(canvas.x + size, canvas.y + size);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(canvas.x + size, canvas.y - size);
            ctx.lineTo(canvas.x - size, canvas.y + size);
            ctx.stroke();

            // Label if provided
            if (pole.label) {
                // Background for readability
                ctx.font = '10px "SF Mono", monospace';
                const labelWidth = ctx.measureText(pole.label).width;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.fillRect(canvas.x - labelWidth / 2 - 2, canvas.y + 16, labelWidth + 4, 14);

                // Label text
                ctx.fillStyle = 'rgba(255, 180, 120, 1)';
                ctx.textAlign = 'center';
                ctx.fillText(pole.label, canvas.x, canvas.y + 26);
            }
        }
    }

    ctx.restore();
}
