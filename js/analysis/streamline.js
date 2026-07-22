import {
    STREAMLINE_COLOR_MIN_MAG,
    STREAMLINE_COLOR_MAX_MAG,
    STREAMLINE_COLOR_LOW_MAG,
    STREAMLINE_COLOR_HIGH_MAG,
    COLOR_STREAMLINE
} from '../constants/colors.js';

const ZERO_VECTOR = Object.freeze({ vx: 0, vy: 0 });
const MIN_VECTOR_MAG_SQ = 1e-18;

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteComplex(value) {
    return !!value && isFiniteNumber(value.re) && isFiniteNumber(value.im);
}

function isFiniteVector(value) {
    return !!value && isFiniteNumber(value.vx) && isFiniteNumber(value.vy);
}

function finiteOr(value, fallback) {
    return isFiniteNumber(value) ? value : fallback;
}

function safeVector(value, fallback = ZERO_VECTOR) {
    return isFiniteVector(value) ? value : fallback;
}

function safeEvaluateComplex(evaluate, x, y) {
    if (typeof evaluate !== 'function' || !isFiniteNumber(x) || !isFiniteNumber(y)) {
        return null;
    }

    try {
        const value = evaluate(x, y);
        return isFiniteComplex(value) ? value : null;
    } catch {
        return null;
    }
}

function vectorFromComplex(value) {
    return isFiniteComplex(value) ? { vx: value.re, vy: value.im } : ZERO_VECTOR;
}

function inverseVectorFromComplex(value) {
    if (!isFiniteComplex(value)) return ZERO_VECTOR;

    const magnitudeSquared = value.re * value.re + value.im * value.im;
    if (!isFiniteNumber(magnitudeSquared) || magnitudeSquared < MIN_VECTOR_MAG_SQ) {
        return ZERO_VECTOR;
    }

    return {
        vx: value.re / magnitudeSquared,
        vy: -value.im / magnitudeSquared
    };
}

function safeEvaluateVector(evaluate, x, y) {
    if (typeof evaluate !== 'function') return ZERO_VECTOR;

    try {
        return safeVector(evaluate(x, y));
    } catch {
        return ZERO_VECTOR;
    }
}

export function getVectorFieldValueAtPoint(x, y, map, vectorFieldType = 'f(z)') {
    const f_z = safeEvaluateComplex(map?.evaluate, x, y);

    if (!isFiniteComplex(f_z)) {
        return { re: 0, im: 0 };
    }

    switch (vectorFieldType) {
        case 'f(z)':
            return { re: f_z.re, im: f_z.im };
        case '1/f(z)': {
            const magnitudeSquared = f_z.re * f_z.re + f_z.im * f_z.im;
            if (!isFiniteNumber(magnitudeSquared) || magnitudeSquared < MIN_VECTOR_MAG_SQ) {
                return { re: 0, im: 0 };
            }
            return {
                re: f_z.re / magnitudeSquared,
                im: -f_z.im / magnitudeSquared
            };
        }
        default:
            return { re: 0, im: 0 };
    }
}

export function getVectorEvaluator(map, vectorFieldType = 'f(z)') {
    switch (vectorFieldType) {
        case 'f(z)':
            return (x, y) => vectorFromComplex(safeEvaluateComplex(map?.evaluate, x, y));
        case '1/f(z)':
            return (x, y) => inverseVectorFromComplex(safeEvaluateComplex(map?.evaluate, x, y));
        default:
            return () => ZERO_VECTOR;
    }
}


export function calculateStreamline(startX, startY, getVectorAtPointCallback, zPlaneParams, state, options = null) {
    const streamlinePoints = [];
    let currentX = startX;
    let currentY = startY;

    const xMin = zPlaneParams.currentVisXRange[0];
    const xMax = zPlaneParams.currentVisXRange[1];
    const yMin = zPlaneParams.currentVisYRange[0];
    const yMax = zPlaneParams.currentVisYRange[1];

    // Scale step size to viewport so it works at any zoom level
    const viewSpan = Math.max(xMax - xMin, yMax - yMin);
    const step = state.streamlineStepSize * viewSpan * 0.1;
    const requestedMaxLength = Math.max(0, Math.floor(finiteOr(state.streamlineMaxLength, 0)));
    const optionMaxSteps = options && isFiniteNumber(options.maxSteps)
        ? Math.max(0, Math.floor(options.maxSteps))
        : requestedMaxLength;
    const maxLength = Math.min(requestedMaxLength, optionMaxSteps);
    const shouldContinue = options && typeof options.shouldContinue === 'function'
        ? options.shouldContinue
        : null;

    if (
        maxLength <= 0 ||
        !isFiniteNumber(step) ||
        step <= 0 ||
        ![currentX, currentY, xMin, xMax, yMin, yMax].every(isFiniteNumber)
    ) {
        return streamlinePoints;
    }

    for (let i = 0; i < maxLength; i++) {
        if (!isFiniteNumber(currentX) || !isFiniteNumber(currentY)) break;
        if (shouldContinue && i > 0 && (i & 7) === 0 && !shouldContinue()) break;
        if (currentX < xMin || currentX > xMax || currentY < yMin || currentY > yMax) break;

        const k1 = safeEvaluateVector(getVectorAtPointCallback, currentX, currentY);
        const k1Mag = Math.hypot(k1.vx, k1.vy);

        if (!isFiniteNumber(k1Mag) || k1Mag < 1e-9) break;
        streamlinePoints.push({ x: currentX, y: currentY, magnitude: k1Mag });

        // Normalize direction — streamlines trace direction, not speed.
        // This prevents explosion when |f(z)| is large (e.g. sinh terms at wide zoom).
        const k1nx = k1.vx / k1Mag, k1ny = k1.vy / k1Mag;

        const midX = currentX + k1nx * step * 0.5;
        const midY = currentY + k1ny * step * 0.5;
        if (!isFiniteNumber(midX) || !isFiniteNumber(midY)) break;

        const k2 = safeEvaluateVector(getVectorAtPointCallback, midX, midY);
        const k2Mag = Math.hypot(k2.vx, k2.vy);

        if (!isFiniteNumber(k2Mag) || k2Mag < 1e-9) {
            currentX += k1nx * step;
            currentY += k1ny * step;
        } else {
            currentX += (k2.vx / k2Mag) * step;
            currentY += (k2.vy / k2Mag) * step;
        }
    }

    return streamlinePoints;
}

export function getStreamlineColorByMagnitude(magnitude) {
    let t = (magnitude - STREAMLINE_COLOR_MIN_MAG) / (STREAMLINE_COLOR_MAX_MAG - STREAMLINE_COLOR_MIN_MAG);
    t = Math.max(0, Math.min(1, t)); 

    const r = Math.round(STREAMLINE_COLOR_LOW_MAG.r * (1 - t) + STREAMLINE_COLOR_HIGH_MAG.r * t);
    const g = Math.round(STREAMLINE_COLOR_LOW_MAG.g * (1 - t) + STREAMLINE_COLOR_HIGH_MAG.g * t);
    const b = Math.round(STREAMLINE_COLOR_LOW_MAG.b * (1 - t) + STREAMLINE_COLOR_HIGH_MAG.b * t);

    let alpha = 0.75; 
    try {
        const parts = COLOR_STREAMLINE.substring(COLOR_STREAMLINE.indexOf('(') + 1, COLOR_STREAMLINE.lastIndexOf(')')).split(/,\s*/);
        if (parts.length === 4) {
            alpha = parseFloat(parts[3]);
        }
    } catch {
        // Fallback
    }

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
