import { state, zPlaneParams } from '../store/state.js';
import { LINE_WIDTH_NORMAL } from '../constants/rendering.js';
import { createTaylorApproximationTransform } from '../native/map-runtime.js';
import { generateCurrentInputShapePointSets } from './shape-generators.js';
import { drawPointSetCollectionOnPlane } from './draw-planar.js';
import { drawAxes } from './canvas-primitives.js';

const TAYLOR_Y_AXIS_ROLES = new Set([
    'grid-horizontal',
    'polar-angular',
    'logpolar-angular',
    'line-horizontal'
]);

export function getTaylorPointSetColor(pointSet, axisColorX, axisColorY) {
    return TAYLOR_Y_AXIS_ROLES.has(pointSet.role) ? axisColorY : axisColorX;
}

export function drawPlanarTaylorApproximation(
    ctx,
    wPlaneParamsOriginal,
    originalFuncKey,
    taylorCenter,
    taylorOrder,
    axisColorX,
    axisColorY,
    options = {}
) {
    if (options.includeAxes !== false) {
        drawAxes(
            ctx,
            wPlaneParamsOriginal,
            {
                xLabel: 'Re(w_approx)',
                yLabel: 'Im(w_approx)',
                color: axisColorX || 'rgba(100, 180, 255, 0.6)'
            }
        );
    }

    const taylorApproxFunc = createTaylorApproximationTransform(
        originalFuncKey,
        taylorCenter,
        taylorOrder
    );
    const pointSets = generateCurrentInputShapePointSets(zPlaneParams, {
        currentFunction: state.currentFunction,
        zetaContinuationEnabled: state.zetaContinuationEnabled
    });

    drawPointSetCollectionOnPlane(ctx, wPlaneParamsOriginal, pointSets, {
        transformFunc: taylorApproxFunc,
        colorResolver: pointSet => getTaylorPointSetColor(pointSet, axisColorX, axisColorY),
        lineWidthResolver: pointSet => pointSet.lineWidth || LINE_WIDTH_NORMAL
    });
}
