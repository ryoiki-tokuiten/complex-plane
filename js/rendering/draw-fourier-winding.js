import { state } from '../store/state.js';
import { COLOR_TEXT_ON_CANVAS, COLOR_CANVAS_BACKGROUND } from '../constants/colors.js';
import { mapToCanvasCoords } from '../utils/canvas-utils.js';
import { drawAxes, drawGrid } from './canvas-primitives.js';


// 3Blue1Brown-style Fourier "Winding" Visualization
// This shows the KEY intuition: wrapping the signal around the origin

/**
 * Draw "winding" visualization - signal wrapped around origin at winding frequency
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array} signal - Time domain signal data
 * @param {Object} planeParams - Plane parameters for drawing
 */
export function drawWindingVisualization(ctx, signal, planeParams) {
    if (!signal || signal.length === 0) {
        ctx.save();
        ctx.fillStyle = COLOR_TEXT_ON_CANVAS;
        ctx.font = '16px "SF Pro Text", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No signal data available', planeParams.width / 2, planeParams.height / 2);
        ctx.restore();
        return;
    }

    ctx.save();

    // Clear canvas
    ctx.fillStyle = COLOR_CANVAS_BACKGROUND;
    ctx.fillRect(0, 0, planeParams.width, planeParams.height);

    // The transform view uses the same world-coordinate grid as every other plane.
    drawGrid(ctx, planeParams);
    drawAxes(ctx, planeParams, "Real", "Imaginary");

    // Get winding parameters
    const windingFreq = state.fourierWindingFrequency || 1.0;
    const windingTime = state.fourierWindingTime || 1.0;
    const timeWindow = state.fourierTimeWindow;

    // Calculate winding: g(t) * e^(-2πift)
    const windedPoints = [];
    let centerOfMassX = 0;
    let centerOfMassY = 0;
    let count = 0;

    for (let i = 0; i < signal.length; i++) {
        const pt = signal[i];
        if (pt.t > windingTime * timeWindow) break; // Only up to current time

        const angle = -2 * Math.PI * windingFreq * pt.t;
        const re = pt.value * Math.cos(angle);
        const im = pt.value * Math.sin(angle);

        windedPoints.push({ re, im, t: pt.t, value: pt.value });
        centerOfMassX += re;
        centerOfMassY += im;
        count++;
    }

    if (count > 0) {
        centerOfMassX /= count;
        centerOfMassY /= count;
    }

    // Draw beautiful reference circle with gradient
    const origin = mapToCanvasCoords(0, 0, planeParams);
    const maxSignalAmp = Math.max(...signal.map(pt => Math.abs(pt.value)));
    const circleRadiusWorld = maxSignalAmp * 1.1;
    const circleRadiusCanvas = circleRadiusWorld * planeParams.scale.x;

    // Outer glow
    ctx.strokeStyle = 'rgba(150, 180, 255, 0.1)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, circleRadiusCanvas, 0, 2 * Math.PI);
    ctx.stroke();

    // Main circle
    ctx.strokeStyle = 'rgba(200, 220, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, circleRadiusCanvas, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw the winding path with gradient
    if (windedPoints.length > 1) {
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        // Draw path segments with color gradient based on time
        for (let i = 1; i < windedPoints.length; i++) {
            const t = i / windedPoints.length;
            const hue = 280 + t * 60; // Gradient from purple to pink

            const prevPos = mapToCanvasCoords(windedPoints[i - 1].re, windedPoints[i - 1].im, planeParams);
            const currPos = mapToCanvasCoords(windedPoints[i].re, windedPoints[i].im, planeParams);

            ctx.beginPath();
            ctx.moveTo(prevPos.x, prevPos.y);
            ctx.lineTo(currPos.x, currPos.y);
            ctx.strokeStyle = `hsla(${hue}, 70%, 65%, ${0.3 + t * 0.5})`;
            ctx.stroke();
        }
    }

    // Draw vectors from origin with fading opacity
    const vectorStep = Math.max(1, Math.floor(windedPoints.length / 50));
    for (let i = 0; i < windedPoints.length; i += vectorStep) {
        const wp = windedPoints[i];
        const canvasPos = mapToCanvasCoords(wp.re, wp.im, planeParams);
        const t = i / windedPoints.length;

        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(canvasPos.x, canvasPos.y);
        ctx.strokeStyle = `rgba(100, 180, 255, ${0.1 + t * 0.25})`;
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // Draw winded sample points with gradient and glow
    for (let i = 0; i < windedPoints.length; i++) {
        const wp = windedPoints[i];
        const canvasPos = mapToCanvasCoords(wp.re, wp.im, planeParams);
        const t = i / windedPoints.length;
        const size = 2.5 + t * 1.5;

        // Outer glow
        ctx.beginPath();
        ctx.arc(canvasPos.x, canvasPos.y, size + 3, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(255, 100, 200, ${0.08 + t * 0.12})`;
        ctx.fill();

        // Main point with radial gradient
        const gradient = ctx.createRadialGradient(canvasPos.x, canvasPos.y, 0, canvasPos.x, canvasPos.y, size);
        gradient.addColorStop(0, 'rgba(255, 180, 230, 1)');
        gradient.addColorStop(1, 'rgba(255, 100, 200, 0.9)');

        ctx.beginPath();
        ctx.arc(canvasPos.x, canvasPos.y, size, 0, 2 * Math.PI);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 200, 240, 0.9)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // Draw CENTER OF MASS with beautiful emphasis (KEY insight!)
    const comCanvas = mapToCanvasCoords(centerOfMassX, centerOfMassY, planeParams);
    // Large outer glow
    ctx.beginPath();
    ctx.arc(comCanvas.x, comCanvas.y, 20, 0, 2 * Math.PI);
    const glowGradient = ctx.createRadialGradient(comCanvas.x, comCanvas.y, 0, comCanvas.x, comCanvas.y, 20);
    glowGradient.addColorStop(0, 'rgba(255, 220, 50, 0.3)');
    glowGradient.addColorStop(1, 'rgba(255, 220, 50, 0)');
    ctx.fillStyle = glowGradient;
    ctx.fill();

    // Vector from origin with beautiful gradient
    const vectorGradient = ctx.createLinearGradient(origin.x, origin.y, comCanvas.x, comCanvas.y);
    vectorGradient.addColorStop(0, 'rgba(100, 200, 255, 0.4)');
    vectorGradient.addColorStop(1, 'rgba(255, 220, 50, 1)');

    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(comCanvas.x, comCanvas.y);
    ctx.strokeStyle = vectorGradient;
    ctx.lineWidth = 4;
    ctx.shadowColor = 'rgba(255, 220, 50, 0.6)';
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Arrow head
    const angle = Math.atan2(comCanvas.y - origin.y, comCanvas.x - origin.x);
    const arrowSize = 12;
    ctx.beginPath();
    ctx.moveTo(comCanvas.x, comCanvas.y);
    ctx.lineTo(
        comCanvas.x - arrowSize * Math.cos(angle - Math.PI / 6),
        comCanvas.y - arrowSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
        comCanvas.x - arrowSize * Math.cos(angle + Math.PI / 6),
        comCanvas.y - arrowSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 220, 50, 1)';
    ctx.fill();

    // Center of mass point with radial gradient
    const comGradient = ctx.createRadialGradient(comCanvas.x, comCanvas.y, 0, comCanvas.x, comCanvas.y, 8);
    comGradient.addColorStop(0, 'rgba(255, 255, 200, 1)');
    comGradient.addColorStop(0.7, 'rgba(255, 220, 50, 1)');
    comGradient.addColorStop(1, 'rgba(255, 180, 0, 1)');

    ctx.beginPath();
    ctx.arc(comCanvas.x, comCanvas.y, 8, 0, 2 * Math.PI);
    ctx.fillStyle = comGradient;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Label with background
    const labelText = 'Center of Mass';
    const labelX = comCanvas.x + 15;
    const labelY = comCanvas.y - 8;

    ctx.font = 'bold 13px "SF Pro Display", sans-serif';
    const textWidth = ctx.measureText(labelText).width;

    // Label background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(labelX - 4, labelY - 14, textWidth + 8, 20);

    // Label text
    ctx.fillStyle = 'rgba(255, 240, 100, 1)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(labelText, labelX, labelY);

    // Draw origin with subtle pulse
    const originGradient = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, 6);
    originGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    originGradient.addColorStop(1, 'rgba(180, 200, 255, 0.8)');

    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = originGradient;
    ctx.fill();
    ctx.strokeStyle = 'rgba(100, 150, 255, 1)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
}

/**
 * Draw time domain signal with highlighted current time
 */
export function drawTimeDomainSignal(ctx, signal, planeParams) {
    if (!signal || signal.length === 0) {
        ctx.save();
        ctx.fillStyle = COLOR_TEXT_ON_CANVAS;
        ctx.font = '16px "SF Pro Text", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No signal data available', planeParams.width / 2, planeParams.height / 2);
        ctx.restore();
        return;
    }

    ctx.save();

    ctx.fillStyle = COLOR_CANVAS_BACKGROUND;
    ctx.fillRect(0, 0, planeParams.width, planeParams.height);

    const timeWindow = state.fourierTimeWindow || signal.at(-1)?.t || 1;
    const windingTime = state.fourierWindingTime || 1.0;
    drawGrid(ctx, planeParams);
    drawAxes(ctx, planeParams, 'Time (t)', 'g(t)');

    // Draw the signal curve
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(100, 200, 255, 0.85)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(100, 200, 255, 0.5)';
    ctx.shadowBlur = 8;

    let firstPoint = true;
    for (let i = 0; i < signal.length; i++) {
        const pt = signal[i];
        const { x: cx, y: cy } = mapToCanvasCoords(pt.t, pt.value, planeParams);

        if (firstPoint) { ctx.moveTo(cx, cy); firstPoint = false; }
        else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Draw sample points
    const pointStep = Math.max(1, Math.floor(signal.length / 90));
    for (let i = 0; i < signal.length; i += pointStep) {
        const pt = signal[i];
        const { x: cx, y: cy } = mapToCanvasCoords(pt.t, pt.value, planeParams);
        const isPast = pt.t <= windingTime * timeWindow;

        if (isPast) {
            ctx.beginPath();
            ctx.arc(cx, cy, 5.5, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(255, 100, 200, 0.15)';
            ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(cx, cy, isPast ? 4 : 3, 0, 2 * Math.PI);

        if (isPast) {
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 4);
            grad.addColorStop(0, 'rgba(255, 150, 220, 1)');
            grad.addColorStop(1, 'rgba(255, 100, 200, 0.9)');
            ctx.fillStyle = grad;
        } else {
            ctx.fillStyle = 'rgba(100, 150, 200, 0.4)';
        }
        ctx.fill();

        if (isPast) {
            ctx.strokeStyle = 'rgba(255, 200, 240, 0.8)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    // Time cursor
    if (windingTime > 0 && windingTime <= 1) {
        const cursorX = mapToCanvasCoords(windingTime * timeWindow, 0, planeParams).x;
        const gradient = ctx.createLinearGradient(cursorX, 0, cursorX, planeParams.height);
        gradient.addColorStop(0, 'rgba(255, 180, 100, 0.3)');
        gradient.addColorStop(0.5, 'rgba(255, 150, 100, 0.9)');
        gradient.addColorStop(1, 'rgba(255, 180, 100, 0.3)');

        ctx.strokeStyle = gradient;
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
        ctx.fillText(`t = ${(windingTime * timeWindow).toFixed(2)}s`, cursorX, 16);
    }

    ctx.restore();
}

/**
 * Get display text for Fourier function type
 */
export function getFourierFunctionText(funcType) {
    const funcMap = {
        // Basic waves
        'sine': 'f(t) = A·sin(ωt)',
        'cosine': 'f(t) = A·cos(ωt)',
        'square': 'f(t) = Square Wave',
        'sawtooth': 'f(t) = Sawtooth Wave',
        'triangle': 'f(t) = Triangle Wave',
        // Modulated signals
        'am': 'f(t) = AM Signal',
        'fm': 'f(t) = FM Signal',
        'chirp': 'f(t) = Chirp (Sweep)',
        // Transient signals
        'damped_sine': 'f(t) = Damped Sine',
        'exponential': 'f(t) = Exponential Decay',
        'gaussian': 'f(t) = Gaussian Pulse',
        'pulse': 'f(t) = Rect. Pulse',
        // Complex waveforms
        'harmonics': 'f(t) = Harmonic Series',
        'beat': 'f(t) = Beat Frequency',
        'noise': 'f(t) = White Noise'
    };
    return funcMap[funcType] || 'f(t) = ' + funcType;
}
