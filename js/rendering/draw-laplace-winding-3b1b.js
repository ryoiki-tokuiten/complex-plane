import { state } from '../store/state.js';
import { COLOR_TEXT_ON_CANVAS } from '../constants/colors.js';
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
 * Compute winding path data with animation support
 */
function computeLaplaceWindingData(signal, sigma, omega) {
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
            t,
            real,
            imag
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
        animTime: animTime
    };
}
