import { state } from '../store/state.js';
import { COLOR_TEXT_ON_CANVAS, COLOR_CANVAS_BACKGROUND } from '../constants/colors.js';
import { mapToCanvasCoords } from '../utils/canvas-utils.js';
import { drawAxes, drawGrid } from './canvas-primitives.js';
import { drawLaplaceWindingPremium } from './draw-laplace-winding-3b1b.js';

// Laplace Transform 3-Panel Visualization
// Professional rendering with time domain, s-plane, and 3D surface

/**
 * Draw LEFT PANEL: Time domain signal with exponential weighting e^(-σt)
 * Shows both original signal f(t) and weighted version f(t)·e^(-σt)
 */
export function drawLaplaceTimeDomain(ctx, signal, planeParams) {
    if (!signal || signal.length === 0) {
        ctx.save();
        ctx.fillStyle = COLOR_TEXT_ON_CANVAS;
        ctx.font = '16px "SF Pro Text", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No signal data', planeParams.width / 2, planeParams.height / 2);
        ctx.restore();
        return;
    }

    ctx.save();

    // Clear canvas
    ctx.fillStyle = COLOR_CANVAS_BACKGROUND;
    ctx.fillRect(0, 0, planeParams.width, planeParams.height);

    // All transform panes use the shared Cartesian grid and world-coordinate zoom.
    drawGrid(ctx, planeParams);
    drawAxes(ctx, planeParams, "Time (t)", "f(t)");

    const sigma = state.laplaceSigma || 0;
    const maxAmp = Math.max(1, ...signal.map(pt => Math.abs(pt.value)));

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
        const weight = Math.exp(-sigma * pt.t);
        const weightedValue = pt.value * weight;

        const canvasPos = mapToCanvasCoords(pt.t, weightedValue, planeParams);

        // Gradient stroke based on position
        const t = i / signal.length;
        const hue = 340 - t * 20;
        ctx.strokeStyle = `hsla(${hue}, 90%, 65%, ${0.7 + t * 0.3})`;

        if (i > 0) {
            const prevPt = signal[i - 1];
            const prevWeight = Math.exp(-sigma * prevPt.t);
            const prevWeightedValue = prevPt.value * prevWeight;
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
            const envelope = Math.exp(-sigma * pt.t) * maxAmp;
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
            const envelope = -Math.exp(-sigma * pt.t) * maxAmp;
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

    // Draw sample points with color coding based on damping
    for (let i = 0; i < signal.length; i += Math.max(1, Math.floor(signal.length / 50))) {
        const pt = signal[i];
        const weight = Math.exp(-sigma * pt.t);
        const weightedValue = pt.value * weight;

        const canvasPos = mapToCanvasCoords(pt.t, weightedValue, planeParams);

        const dampingIntensity = sigma > 0 ? weight : Math.min(1, weight);

        // Outer glow
        ctx.beginPath();
        ctx.arc(canvasPos.x, canvasPos.y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(255, 100, 150, ${0.1 * dampingIntensity})`;
        ctx.fill();

        // Main point
        const gradient = ctx.createRadialGradient(canvasPos.x, canvasPos.y, 0, canvasPos.x, canvasPos.y, 3);
        gradient.addColorStop(0, `rgba(255, 150, ${200 - sigma * 30}, 1)`);
        gradient.addColorStop(1, `rgba(255, 100, 150, 0.9)`);

        ctx.beginPath();
        ctx.arc(canvasPos.x, canvasPos.y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = gradient;
        ctx.fill();
    }

    ctx.restore();
}

/**
 * Draw MIDDLE PANEL: Premium 3b1b-quality winding visualization
 */
export function drawLaplaceWindingVisualization(ctx, signal, planeParams) {
    // Use the new premium renderer
    drawLaplaceWindingPremium(ctx, signal, planeParams);

    // Draw poles and zeros overlay on top
    drawPolesAndZerosOverlay(ctx, planeParams);
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

// drawLaplaceInfoOverlay removed — clean research-tool aesthetic

/**
 * Get display text for Laplace function type
 */
export function getLaplaceFunctionText(funcType) {
    const funcMap = {
        'step': 'Step function',
        'exponential': 'e^(-at)',
        'sine': 'sin(ωt)',
        'cosine': 'cos(ωt)',
        'damped_sine': 'Damped sine: e^(-σt)·sin(ωt)',
        'damped_cosine': 'Damped cosine: e^(-σt)·cos(ωt)',
        'ramp': 'Ramp: t',
        'impulse': 'Impulse δ(t)',
        'exponential_sine': 'Growing sine: e^(at)·sin(ωt)',
        'underdamped': 'Underdamped oscillation',
        'critically_damped': 'Critically damped',
        'overdamped': 'Overdamped'
    };
    return funcMap[funcType] || funcType;
}
