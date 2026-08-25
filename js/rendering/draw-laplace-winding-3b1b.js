import { drawAxes, drawGrid, drawTipToTailVectors, drawSpiral } from './canvas-primitives.js';

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

    // A single shared viewport keeps panning and zoom identical to the app's
    // planar/domain-coloring pipeline. The spiral and its integral remain
    // distinct through their rendering styles rather than separate canvases.
    drawGrid(ctx, planeParams);
    drawAxes(ctx, planeParams, 'Re', 'Im');
    drawSpiral(ctx, windingData, planeParams);
    if (options.showIntegralEvaluation !== false) {
        drawTipToTailVectors(ctx, windingData, planeParams, {
            style: 'enhanced',
            numVectors: 12,
            animTime: 1,
            showLabels: (planeParams.scale.x + planeParams.scale.y) / 2 > 800
        });
    }

    ctx.restore();
}
