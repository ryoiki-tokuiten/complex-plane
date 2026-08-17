import {
    STREAMLINE_COLOR_MIN_MAG,
    STREAMLINE_COLOR_MAX_MAG,
    STREAMLINE_COLOR_LOW_MAG,
    STREAMLINE_COLOR_HIGH_MAG,
    COLOR_STREAMLINE
} from '../constants/colors.js';
import { traceNativeStreamlines } from '../native/complex-engine.js';

export function traceStreamlines(seeds, map, planeParams, renderState, options = null) {
    const xRange = planeParams.currentVisXRange || planeParams.xRange;
    const yRange = planeParams.currentVisYRange || planeParams.yRange;
    const viewSpan = Math.max(xRange[1] - xRange[0], yRange[1] - yRange[0]);
    const requested = Math.max(0, Math.floor(Number(renderState.streamlineMaxLength) || 0));
    const maxSteps = Number.isFinite(options?.maxSteps)
        ? Math.min(requested, Math.max(0, Math.floor(options.maxSteps)))
        : requested;
    return traceNativeStreamlines({
        seeds,
        map,
        xRange,
        yRange,
        stepSize: Number(renderState.streamlineStepSize) * viewSpan * 0.1,
        maxSteps,
        inverse: renderState.vectorFieldFunction === '1/f(z)'
    });
}

export function getStreamlineColorByMagnitude(magnitude) {
    let t = (magnitude - STREAMLINE_COLOR_MIN_MAG) /
        (STREAMLINE_COLOR_MAX_MAG - STREAMLINE_COLOR_MIN_MAG);
    t = Math.max(0, Math.min(1, t));
    const r = Math.round(STREAMLINE_COLOR_LOW_MAG.r * (1 - t) + STREAMLINE_COLOR_HIGH_MAG.r * t);
    const g = Math.round(STREAMLINE_COLOR_LOW_MAG.g * (1 - t) + STREAMLINE_COLOR_HIGH_MAG.g * t);
    const b = Math.round(STREAMLINE_COLOR_LOW_MAG.b * (1 - t) + STREAMLINE_COLOR_HIGH_MAG.b * t);
    const alpha = Number(COLOR_STREAMLINE.slice(COLOR_STREAMLINE.lastIndexOf(',') + 1, -1)) || 0.75;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
