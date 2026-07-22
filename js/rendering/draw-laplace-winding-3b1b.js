import { state } from '../store/state.js';
import { COLOR_TEXT_ON_CANVAS } from '../constants/colors.js';
import { mapToCanvasCoords } from '../utils/canvas-utils.js';
import { drawAxes, drawGrid, drawTipToTailVectors, drawSpiral } from './canvas-primitives.js';

// 3Blue1Brown-Quality Laplace Winding Visualization
// Shows f(t)·e^(-st) building up over time with vectors and labels

/**
 * Draw unified full-canvas Laplace winding visualization
 * Shows f(t)·e^(-st) spiral AND tip-to-tail integral geometry in one view
 */
export function drawLaplaceWindingPremium(ctx, signal, planeParams) {
    if (!signal || signal.length === 0) {
        ctx.save();
        ctx.fillStyle = COLOR_TEXT_ON_CANVAS;
        ctx.font = '16px "SF Pro Text", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No signal data available', planeParams.width / 2, planeParams.height / 2);
        ctx.restore();
        return;
    }

    if (signal.length > 1000) {
        const step = Math.floor(signal.length / 500);
        signal = signal.filter((_, i) => i % step === 0);
    }

    ctx.save();

    ctx.fillStyle = 'rgba(8, 10, 18, 1)';
    ctx.fillRect(0, 0, planeParams.width, planeParams.height);

    const sigma = state.laplaceSigma || 0;
    const omega = state.laplaceOmega || 1;
    const windingData = computeLaplaceWindingData(signal, sigma, omega);
    if (windingData.points.length === 0) { ctx.restore(); return; }

    // A single shared viewport keeps panning and zoom identical to the app's
    // planar/domain-coloring pipeline. The spiral and its integral remain
    // distinct through their rendering styles rather than separate canvases.
    drawGrid(ctx, planeParams);
    drawAxes(ctx, planeParams, 'Re', 'Im');
    drawSpiral(ctx, windingData, planeParams);
    drawTipToTailVectors(ctx, windingData, planeParams, {
        style: 'enhanced',
        numVectors: 12,
        showLabels: (planeParams.scale.x + planeParams.scale.y) / 2 > 800
    });

    ctx.restore();
}


/**
 * Compute e^(-st) spiral data (no f(t) modulation)
 */
export function computeExponentialSpiralData(signal, sigma, omega) {
    const points = [];

    // Animation time parameter
    const animTime = state.laplaceAnimationTime !== undefined ? state.laplaceAnimationTime : 1.0;
    const maxT = signal[signal.length - 1].t * animTime;

    for (let i = 0; i < signal.length; i++) {
        const pt = signal[i];
        if (pt.t > maxT) break;

        const t = pt.t;

        // Pure e^(-st) = e^(-(σ + jω)t)
        const expFactor = Math.exp(-sigma * t);
        const angle = -omega * t;
        const real = expFactor * Math.cos(angle);
        const imag = expFactor * Math.sin(angle);

        points.push({
            t: t,
            real: real,
            imag: imag,
            magnitude: expFactor,
            phase: angle
        });
    }

    return {
        points: points,
        maxT: maxT,
        animTime: animTime
    };
}

/**
 * Compute winding path data with animation support
 */
export function computeLaplaceWindingData(signal, sigma, omega) {
    const points = [];
    let integralReal = 0;
    let integralImag = 0;

    // Animation time parameter (0 to 1)
    const animTime = state.laplaceAnimationTime !== undefined ? state.laplaceAnimationTime : 1.0;
    const maxT = signal[signal.length - 1].t * animTime;

    for (let i = 0; i < signal.length; i++) {
        const pt = signal[i];
        if (pt.t > maxT) break;

        const t = pt.t;
        const ft = pt.value;

        // Compute e^(-st) = e^(-(σ + jω)t)
        const expFactor = Math.exp(-sigma * t);
        const angle = -omega * t;
        const eCos = expFactor * Math.cos(angle);
        const eSin = expFactor * Math.sin(angle);

        // f(t) · e^(-st)
        const real = ft * eCos;
        const imag = ft * eSin;

        points.push({
            t: t,
            real: real,
            imag: imag,
            ft: ft,
            expReal: eCos,
            expImag: eSin,
            expMag: expFactor,
            expPhase: angle
        });

        integralReal += real;
        integralImag += imag;
    }

    // Normalize integral (Riemann sum approximation)
    const dt = signal.length > 1 ? signal[1].t - signal[0].t : 0.01;
    integralReal *= dt;
    integralImag *= dt;

    return {
        points: points,
        integral: { real: integralReal, imag: integralImag },
        maxT: maxT,
        animTime: animTime
    };
}

/**
 * Draw the winding spiral path with progressive coloring (3b1b style!)
 * Uses perceptually uniform color gradient showing time evolution
 */
export function drawWindingSpiral(ctx, windingData, planeParams) {
    const points = windingData.points;
    if (points.length < 2) return;

    // Draw sample points first (so path draws over them)
    const sampleInterval = Math.max(1, Math.floor(points.length / 40));
    for (let i = 0; i < points.length; i += sampleInterval) {
        const pt = points[i];
        const canvas = mapToCanvasCoords(pt.real, pt.imag, planeParams);
        const progress = i / points.length;

        // Outer glow for sample points
        ctx.beginPath();
        ctx.arc(canvas.x, canvas.y, 5, 0, 2 * Math.PI);
        const glowHue = 180 + progress * 60;
        ctx.fillStyle = `hsla(${glowHue}, 70%, 60%, 0.15)`;
        ctx.fill();

        // Inner point
        ctx.beginPath();
        ctx.arc(canvas.x, canvas.y, 2.5, 0, 2 * Math.PI);
        ctx.fillStyle = `hsla(${glowHue}, 80%, 70%, 0.9)`;
        ctx.fill();
    }

    // Draw each segment with individual coloring (Riemann sum visualization)
    for (let i = 1; i < points.length; i++) {
        const pt0 = points[i - 1];
        const pt1 = points[i];

        const canvas0 = mapToCanvasCoords(pt0.real, pt0.imag, planeParams);
        const canvas1 = mapToCanvasCoords(pt1.real, pt1.imag, planeParams);

        // 3b1b-style color: Blue → Cyan → Teal gradient (perceptually smooth)
        const progress = i / points.length;
        const hue = 180 + progress * 60; // Cyan to blue
        const lightness = 55 + progress * 10; // Slight brightness increase
        const alpha = 0.5 + progress * 0.4; // More visible as we progress

        // Draw segment with thickness variation
        ctx.strokeStyle = `hsla(${hue}, 75%, ${lightness}%, ${alpha})`;
        ctx.lineWidth = 2 + progress * 0.5; // Slight thickness increase
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(canvas0.x, canvas0.y);
        ctx.lineTo(canvas1.x, canvas1.y);
        ctx.stroke();
    }

    // Highlight the most recent segment (current timestep)
    if (points.length > 1 && windingData.animTime < 1.0) {
        const lastIdx = points.length - 1;
        const pt0 = points[lastIdx - 1];
        const pt1 = points[lastIdx];

        const canvas0 = mapToCanvasCoords(pt0.real, pt0.imag, planeParams);
        const canvas1 = mapToCanvasCoords(pt1.real, pt1.imag, planeParams);

        ctx.strokeStyle = 'rgba(255, 230, 100, 1)';
        ctx.lineWidth = 4;
        ctx.shadowColor = 'rgba(255, 200, 50, 0.8)';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(canvas0.x, canvas0.y);
        ctx.lineTo(canvas1.x, canvas1.y);
        ctx.stroke();
        ctx.shadowBlur = 0;
    }
}

/**
 * Draw vector arrows at key sample points with labels
 */
export function drawWindingVectors(ctx, windingData, planeParams) {
    const points = windingData.points;
    if (points.length === 0) return;

    const origin = mapToCanvasCoords(0, 0, planeParams);

    // Show vectors at ~8-12 evenly spaced points
    const numVectors = Math.min(10, Math.max(5, Math.floor(points.length / 20)));
    const step = Math.floor(points.length / numVectors);

    for (let i = 0; i < points.length; i += step) {
        const pt = points[i];
        const canvas = mapToCanvasCoords(pt.real, pt.imag, planeParams);

        // Draw vector from origin
        ctx.strokeStyle = 'rgba(100, 200, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(canvas.x, canvas.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Arrow head
        const angle = Math.atan2(canvas.y - origin.y, canvas.x - origin.x);
        const arrowSize = 8;
        ctx.fillStyle = 'rgba(100, 200, 255, 0.6)';
        ctx.beginPath();
        ctx.moveTo(canvas.x, canvas.y);
        ctx.lineTo(
            canvas.x - arrowSize * Math.cos(angle - Math.PI / 6),
            canvas.y - arrowSize * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
            canvas.x - arrowSize * Math.cos(angle + Math.PI / 6),
            canvas.y - arrowSize * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();

        // Point marker
        ctx.fillStyle = 'rgba(150, 220, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(canvas.x, canvas.y, 3, 0, 2 * Math.PI);
        ctx.fill();

        // Label e^(-st) value at select points
        if (i % (step * 2) === 0) {
            const label = `e^{-s·${pt.t.toFixed(1)}}`;
            ctx.fillStyle = 'rgba(180, 220, 255, 0.95)';
            ctx.font = '10px "SF Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(label, canvas.x, canvas.y - 12);
        }
    }
}

/**
 * Draw CENTER OF MASS - THE KEY INSIGHT! (3b1b emphasis)
 * This is what makes the Laplace transform intuitive
 */
export function drawIntegralResult(ctx, windingData, planeParams) {
    const points = windingData.points;
    if (points.length === 0) return;

    const origin = mapToCanvasCoords(0, 0, planeParams);
    const integral = windingData.integral;
    const resultCanvas = mapToCanvasCoords(integral.real, integral.imag, planeParams);

    // STEP 1: Show the spiral "balances" around this point
    // Draw subtle connection lines from sample points to center of mass
    const connectionInterval = Math.max(1, Math.floor(points.length / 12));
    for (let i = 0; i < points.length; i += connectionInterval) {
        const pt = points[i];
        const ptCanvas = mapToCanvasCoords(pt.real, pt.imag, planeParams);

        ctx.strokeStyle = 'rgba(100, 255, 180, 0.08)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(ptCanvas.x, ptCanvas.y);
        ctx.lineTo(resultCanvas.x, resultCanvas.y);
        ctx.stroke();
    }
    ctx.setLineDash([]);

    // STEP 2: Draw partial sums building up (optional, subtle)
    const segmentSkip = Math.max(1, Math.floor(points.length / 15));
    let runningReal = 0;
    let runningImag = 0;

    const dt = points.length > 1 ? (points[1].t - points[0].t) : 0.01;

    for (let i = 0; i < points.length; i += segmentSkip) {
        const pt = points[i];
        runningReal += pt.real * dt;
        runningImag += pt.imag * dt;

        const runningCanvas = mapToCanvasCoords(runningReal, runningImag, planeParams);
        const progress = i / points.length;

        // Tiny dots showing accumulation
        ctx.fillStyle = `rgba(100, 255, 180, ${0.2 + progress * 0.3})`;
        ctx.beginPath();
        ctx.arc(runningCanvas.x, runningCanvas.y, 2, 0, 2 * Math.PI);
        ctx.fill();
    }

    // STEP 3: CENTER OF MASS MARKER - Maximum emphasis!
    // This is THE visualization that makes Laplace transform click

    // Outermost glow (large, subtle)
    ctx.beginPath();
    ctx.arc(resultCanvas.x, resultCanvas.y, 50, 0, 2 * Math.PI);
    const outerGlow = ctx.createRadialGradient(resultCanvas.x, resultCanvas.y, 0, resultCanvas.x, resultCanvas.y, 50);
    outerGlow.addColorStop(0, 'rgba(100, 255, 150, 0.25)');
    outerGlow.addColorStop(0.5, 'rgba(100, 255, 150, 0.12)');
    outerGlow.addColorStop(1, 'rgba(100, 255, 150, 0)');
    ctx.fillStyle = outerGlow;
    ctx.fill();

    // Middle glow (brighter)
    ctx.beginPath();
    ctx.arc(resultCanvas.x, resultCanvas.y, 30, 0, 2 * Math.PI);
    const midGlow = ctx.createRadialGradient(resultCanvas.x, resultCanvas.y, 0, resultCanvas.x, resultCanvas.y, 30);
    midGlow.addColorStop(0, 'rgba(150, 255, 180, 0.5)');
    midGlow.addColorStop(1, 'rgba(100, 255, 150, 0)');
    ctx.fillStyle = midGlow;
    ctx.fill();

    // Vector from origin to final integral
    const vecGradient = ctx.createLinearGradient(origin.x, origin.y, resultCanvas.x, resultCanvas.y);
    vecGradient.addColorStop(0, 'rgba(100, 200, 255, 0.8)');
    vecGradient.addColorStop(1, 'rgba(100, 255, 150, 1)');

    ctx.strokeStyle = vecGradient;
    ctx.lineWidth = 5;
    ctx.shadowColor = 'rgba(100, 255, 150, 0.8)';
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(resultCanvas.x, resultCanvas.y);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Arrow head
    const angle = Math.atan2(resultCanvas.y - origin.y, resultCanvas.x - origin.x);
    const arrowSize = 16;
    ctx.fillStyle = 'rgba(100, 255, 150, 1)';
    ctx.shadowColor = 'rgba(100, 255, 150, 0.6)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(resultCanvas.x, resultCanvas.y);
    ctx.lineTo(
        resultCanvas.x - arrowSize * Math.cos(angle - Math.PI / 6),
        resultCanvas.y - arrowSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
        resultCanvas.x - arrowSize * Math.cos(angle + Math.PI / 6),
        resultCanvas.y - arrowSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    // Result point with gradient
    const pointGradient = ctx.createRadialGradient(resultCanvas.x, resultCanvas.y, 0, resultCanvas.x, resultCanvas.y, 12);
    pointGradient.addColorStop(0, 'rgba(220, 255, 220, 1)');
    pointGradient.addColorStop(0.6, 'rgba(100, 255, 150, 1)');
    pointGradient.addColorStop(1, 'rgba(50, 200, 100, 1)');

    ctx.fillStyle = pointGradient;
    ctx.beginPath();
    ctx.arc(resultCanvas.x, resultCanvas.y, 12, 0, 2 * Math.PI);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 1)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(resultCanvas.x, resultCanvas.y, 12, 0, 2 * Math.PI);
    ctx.stroke();

    // Minimal floating label — no bulky box
    const magnitude = Math.sqrt(integral.real * integral.real + integral.imag * integral.imag);
    const labelX = resultCanvas.x + 18;
    const labelY = resultCanvas.y - 6;

    ctx.font = 'bold 12px "SF Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(180, 255, 200, 0.95)';
    ctx.fillText(`F(s) = ${magnitude.toFixed(3)}`, labelX, labelY);
}
