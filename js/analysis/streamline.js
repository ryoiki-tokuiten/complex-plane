import {
    STREAMLINE_COLOR_MIN_MAG,
    STREAMLINE_COLOR_MAX_MAG,
    STREAMLINE_COLOR_LOW_MAG,
    STREAMLINE_COLOR_HIGH_MAG,
    COLOR_STREAMLINE
} from '../constants/colors.js';
import { traceNativeStreamlines } from '../native/complex-engine.js';
import { requireVisibleViewport } from '../utils/viewport.js';
import { requireFiniteNumber, requireInteger } from '../utils/numeric-contracts.js';

export function traceStreamlines(seeds, map, planeParams, renderState, options = null) {
    requireVisibleViewport(planeParams, 'Streamline viewport');
    const xRange = planeParams.currentVisXRange;
    const yRange = planeParams.currentVisYRange;
    const viewSpan = Math.max(xRange[1] - xRange[0], yRange[1] - yRange[0]);
    const requested = requireInteger(renderState.streamlineMaxLength, 'Streamline maximum length');
    if (requested < 1 || requested > 10000) {
        throw new Error('Streamline maximum length must be from one through 10,000.');
    }
    const optionLimit = options?.maxSteps === undefined
        ? requested
        : requireInteger(options.maxSteps, 'Streamline option step limit');
    if (optionLimit < 1 || optionLimit > requested) {
        throw new Error('Streamline option step limit must be positive and not exceed the configured maximum.');
    }
    const stepSize = requireFiniteNumber(renderState.streamlineStepSize, 'Streamline step size');
    if (stepSize <= 0) throw new Error('Streamline step size must be positive.');
    if (renderState.vectorFieldFunction !== 'f(z)' && renderState.vectorFieldFunction !== '1/f(z)') {
        throw new Error(`Unsupported vector-field function: ${renderState.vectorFieldFunction}.`);
    }
    return traceNativeStreamlines({
        seeds,
        map,
        xRange,
        yRange,
        stepSize: stepSize * viewSpan * 0.1,
        maxSteps: optionLimit,
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
