import { COLOR_GRID_LINES, COLOR_AXES, COLOR_TEXT_ON_CANVAS } from '../constants/colors.js';
import { TWO_PI } from '../constants/numerical.js';
import { LINE_WIDTH_THIN, LINE_WIDTH_NORMAL, LINE_WIDTH_THICK } from '../constants/rendering.js';
import { mapToCanvasCoords } from '../utils/canvas-utils.js';
import { state } from '../store/state.js';

/**
 * Shared canvas primitives used across planar, Fourier, and Laplace renderers.
 */

export function getCanvasPlaneRanges(params) {
    return {
        xRange: params.currentVisXRange || params.xRange || [0, 0],
        yRange: params.currentVisYRange || params.yRange || [0, 0]
    };
}

export function createRgbTuple(r, g, b) {
    const rgb = [r, g, b];
    rgb.r = r;
    rgb.g = g;
    rgb.b = b;
    return rgb;
}

export function parseHslString(hsl) {
    if (typeof hsl !== 'string') return null;
    const match = hsl.match(/hsl\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*\)/i);
    if (!match) return null;

    return {
        h: parseFloat(match[1]) / 360,
        s: parseFloat(match[2]) / 100,
        l: parseFloat(match[3]) / 100
    };
}

export function hslToRgb(h, s, l) {
    if (typeof h === 'string') {
        const parsed = parseHslString(h);
        return parsed ? hslToRgb(parsed.h, parsed.s, parsed.l) : createRgbTuple(0, 0, 0);
    }

    let r;
    let g;
    let b;

    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = function (p, q, t) {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }

    return createRgbTuple(
        Math.round(r * 255),
        Math.round(g * 255),
        Math.round(b * 255)
    );
}

function drawGridLines(ctx, params, stepX = 1, stepY = 1, color = COLOR_GRID_LINES) {
    const { xRange, yRange } = getCanvasPlaneRanges(params);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();

    const xStart = Math.ceil(xRange[0] / stepX) * stepX;
    const xEnd = Math.floor(xRange[1] / stepX) * stepX;
    // The tolerance must scale with the grid spacing; a fixed world-unit
    // tolerance turns deep-zoom grids into long phantom loops.
    const xTolerance = Math.abs(stepX) * 1e-6;
    for (let x = xStart; x <= xEnd + xTolerance; x += stepX) {
        if (Math.abs(x) > Math.max(Math.abs(xRange[0]), Math.abs(xRange[1])) + stepX && x !== 0) continue;
        const canvasX = mapToCanvasCoords(x, 0, params).x;
        ctx.moveTo(canvasX, 0);
        ctx.lineTo(canvasX, params.height);
    }

    const yStart = Math.ceil(yRange[0] / stepY) * stepY;
    const yEnd = Math.floor(yRange[1] / stepY) * stepY;
    const yTolerance = Math.abs(stepY) * 1e-6;
    for (let y = yStart; y <= yEnd + yTolerance; y += stepY) {
        if (Math.abs(y) > Math.max(Math.abs(yRange[0]), Math.abs(yRange[1])) + stepY && y !== 0) continue;
        const canvasY = mapToCanvasCoords(0, y, params).y;
        ctx.moveTo(0, canvasY);
        ctx.lineTo(params.width, canvasY);
    }

    ctx.stroke();
    ctx.restore();
}

export function calculateGridStep(span, targetCount = 10) {
    const rawStep = span / targetCount;
    if (rawStep <= 0) return 1;
    const log = Math.log10(rawStep);
    const power = Math.floor(log);
    const base = Math.pow(10, power);
    const ratio = rawStep / base;

    let step;
    if (ratio < 1.5) step = 1;
    else if (ratio < 3) step = 2;
    else if (ratio < 7) step = 5;
    else step = 10;

    return step * base;
}

export function drawGrid(ctx, params, options = {}) {
    const { xRange, yRange } = getCanvasPlaneRanges(params);
    if (!xRange || !yRange) return;

    const spanX = xRange[1] - xRange[0];
    const spanY = yRange[1] - yRange[0];

    const targetCount = options.targetCount ?? (state?.gridDensity ?? 10);
    const stepX = calculateGridStep(spanX, targetCount);
    const stepY = calculateGridStep(spanY, targetCount);

    let minorStepX = stepX / 5;
    let minorStepY = stepY / 5;

    // Check if major step base ratio is 2, in which case 4 subdivisions are cleaner than 5
    const ratioX = stepX / Math.pow(10, Math.floor(Math.log10(stepX)));
    if (Math.abs(ratioX - 2) < 1e-6) {
        minorStepX = stepX / 4;
    }
    const ratioY = stepY / Math.pow(10, Math.floor(Math.log10(stepY)));
    if (Math.abs(ratioY - 2) < 1e-6) {
        minorStepY = stepY / 4;
    }

    const minorColor = options.minorColor ?? 'rgba(40, 60, 80, 0.15)';
    const majorColor = options.majorColor ?? 'rgba(60, 80, 100, 0.3)';

    // Extract alpha opacities from rgba strings
    let minorAlpha = 0.15;
    const minorMatch = minorColor.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d\.]+)\s*\)/);
    if (minorMatch) {
        minorAlpha = parseFloat(minorMatch[1]);
    }
    let majorAlpha = 0.3;
    const majorMatch = majorColor.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d\.]+)\s*\)/);
    if (majorMatch) {
        majorAlpha = parseFloat(majorMatch[1]);
    }

    // Dynamic fade-out based on pixel spacing
    const scaleX = params.scale?.x ?? 1;
    const pixelSpacingX = stepX * scaleX;

    // Smoothly fade out minor grid lines if they get too close (between 45 and 90 pixels)
    const minorFade = Math.max(0, Math.min(1, (pixelSpacingX - 45) / 45));
    const finalMinorColor = minorFade > 0 
        ? minorColor.replace(/[\d\.]+\)$/, `${(minorAlpha * minorFade).toFixed(3)})`) 
        : 'rgba(0,0,0,0)';

    // Smoothly fade out major grid lines if they get extremely close (between 15 and 35 pixels)
    const majorFade = Math.max(0, Math.min(1, (pixelSpacingX - 15) / 20));
    const finalMajorColor = majorFade > 0 
        ? majorColor.replace(/[\d\.]+\)$/, `${(majorAlpha * majorFade).toFixed(3)})`) 
        : 'rgba(0,0,0,0)';

    if (minorFade > 0) {
        drawGridLines(ctx, params, minorStepX, minorStepY, finalMinorColor);
    }
    if (majorFade > 0) {
        drawGridLines(ctx, params, stepX, stepY, finalMajorColor);
    }
}

export function normalizeAxesOptions(labelOrOptions, maybeYLabel) {
    if (typeof labelOrOptions === 'string' || typeof maybeYLabel === 'string') {
        return {
            xLabel: labelOrOptions || 'Re',
            yLabel: maybeYLabel || 'Im',
            showAxisLabels: true,
            showTicks: true,
            showTickLabels: true,
            showOriginDot: false,
            color: COLOR_AXES,
            lineWidth: LINE_WIDTH_THIN
        };
    }

    const options = labelOrOptions || {};
    return {
        xLabel: options.xLabel || 'Re',
        yLabel: options.yLabel || 'Im',
        showAxisLabels: options.labels !== false,
        showTicks: options.ticks === true,
        showTickLabels: options.tickLabels === true,
        showOriginDot: options.originDot !== false,
        glow: !!options.glow,
        color: options.color || 'rgba(100, 180, 255, 0.6)',
        lineWidth: options.lineWidth || LINE_WIDTH_NORMAL
    };
}

export function drawAxes(ctx, params, labelOrOptions, maybeYLabel) {
    const options = normalizeAxesOptions(labelOrOptions, maybeYLabel);
    const origin = mapToCanvasCoords(0, 0, params);
    const { xRange, yRange } = getCanvasPlaneRanges(params);

    ctx.save();
    if (ctx.imageSmoothingEnabled !== undefined) ctx.imageSmoothingEnabled = false;
    ctx.strokeStyle = options.color;
    ctx.fillStyle = COLOR_TEXT_ON_CANVAS;
    ctx.lineWidth = options.lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (options.glow) {
        ctx.shadowColor = options.color;
        ctx.shadowBlur = 5;
    }

    ctx.beginPath();
    ctx.moveTo(0, origin.y);
    ctx.lineTo(params.width, origin.y);
    ctx.moveTo(origin.x, 0);
    ctx.lineTo(origin.x, params.height);
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (options.showOriginDot) {
        ctx.beginPath();
        ctx.arc(origin.x, origin.y, 3, 0, TWO_PI);
        ctx.fill();
    }

    if (options.showAxisLabels) {
        ctx.font = "11px 'SF Pro Text', sans-serif";
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(options.yLabel, origin.x + 5, 5);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(options.xLabel, params.width - 5, origin.y - 5);
    }

    if (options.showTicks) {
        ctx.font = "10px 'SF Pro Text', sans-serif";

        const getPrecision = (step) => {
            if (step >= 1) return 0;
            return Math.ceil(-Math.log10(step));
        };

        const formatLabel = (val, prec, step) => {
            if (Math.abs(val) < 1e-3 * step) return '0';
            const s = val.toFixed(prec);
            return parseFloat(s) === 0 ? '0' : s;
        };

        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const spanX = xRange[1] - xRange[0];
        const stepX = calculateGridStep(spanX, 10);
        const xStart = Math.ceil(xRange[0] / stepX) * stepX;
        const xEnd = Math.floor(xRange[1] / stepX) * stepX;
        const precisionX = getPrecision(stepX);
        const xTolerance = Math.abs(stepX) * 1e-6;

        for (let x = xStart; x <= xEnd + xTolerance; x += stepX) {
            const tick = mapToCanvasCoords(x, 0, params);
            const label = formatLabel(x, precisionX, stepX);
            if (options.showTickLabels) {
                ctx.fillText(label, tick.x, tick.y + 5);
            }
            ctx.beginPath();
            ctx.moveTo(tick.x, tick.y - 3);
            ctx.lineTo(tick.x, tick.y + 3);
            ctx.stroke();
        }

        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        const spanY = yRange[1] - yRange[0];
        const stepY = calculateGridStep(spanY, 10);
        const yStart = Math.ceil(yRange[0] / stepY) * stepY;
        const yEnd = Math.floor(yRange[1] / stepY) * stepY;
        const precisionY = getPrecision(stepY);
        const yTolerance = Math.abs(stepY) * 1e-6;

        for (let y = yStart; y <= yEnd + yTolerance; y += stepY) {
            const tick = mapToCanvasCoords(0, y, params);
            let label = formatLabel(y, precisionY, stepY);
            if (Math.abs(y) < 1e-3 && Math.abs(origin.x - tick.x) < params.width - 10 && label !== '0') {
                label = '';
            }
            if (options.showTickLabels && label !== '') {
                ctx.fillText(label, tick.x - 5, tick.y);
            }
            ctx.beginPath();
            ctx.moveTo(tick.x - 3, tick.y);
            ctx.lineTo(tick.x + 3, tick.y);
            ctx.stroke();
        }
    }

    if (ctx.imageSmoothingEnabled !== undefined) ctx.imageSmoothingEnabled = true;
    ctx.restore();
}

export function drawArrowHead(ctx, x, y, angle, size, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
        x - size * Math.cos(angle - Math.PI / 6),
        y - size * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
        x - size * Math.cos(angle + Math.PI / 6),
        y - size * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
}

export function drawArrow(ctx, fromX, fromY, toX, toY, color = 'white', headLength = 8, lineWidth = LINE_WIDTH_NORMAL) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const angle = Math.atan2(toY - fromY, toX - fromX);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    drawArrowHead(ctx, toX, toY, angle, headLength, color);
    ctx.restore();
}

export function drawTipToTailVectors(ctx, windingData, params, options = {}) {
    const {
        numVectors = 12,
        style = 'enhanced',
        animTime = windingData.animTime || 1.0,
        showLabels = false
    } = options;
    const points = windingData.points;
    if (points.length === 0) return;

    const dt = points.length > 1 ? (points[1].t - points[0].t) : 0.01;
    const step = Math.max(1, Math.floor(points.length / numVectors));
    const originX = params.origin.x;
    const originY = params.origin.y;
    const maxIndex = Math.floor(points.length * animTime);
    let runningReal = 0;
    let runningImag = 0;

    for (let i = 0; i < points.length && i < maxIndex; i += step) {
        const pt = points[i];
        const vecReal = pt.real * dt * step;
        const vecImag = pt.imag * dt * step;

        const startX = originX + runningReal * params.scale.x;
        const startY = originY - runningImag * params.scale.y;

        runningReal += vecReal;
        runningImag += vecImag;

        const endX = originX + runningReal * params.scale.x;
        const endY = originY - runningImag * params.scale.y;
        const isLast = i + step >= maxIndex;
        const progress = i / points.length;

        let strokeColor;
        let lineWidth;
        let arrowSize;
        if (style === 'optimized') {
            strokeColor = isLast ? 'rgba(255, 230, 100, 0.9)' : 'rgba(200, 150, 255, 0.6)';
            lineWidth = isLast ? LINE_WIDTH_THICK : 2;
            arrowSize = isLast ? 10 : 7;
        } else {
            const hue = 280 + progress * 60;
            const alpha = isLast ? 1.0 : (0.7 + progress * 0.3);
            strokeColor = isLast ? 'rgba(255, 230, 100, 0.95)' : `hsla(${hue}, 75%, 65%, ${alpha})`;
            lineWidth = isLast ? 4 : 2.5;
            arrowSize = isLast ? 10 : 8;
        }

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        drawArrowHead(ctx, endX, endY, Math.atan2(endY - startY, endX - startX), arrowSize, strokeColor);

        if (showLabels && i % (step * 2) === 0 && pt.t > 0) {
            ctx.fillStyle = 'rgba(255, 220, 180, 0.9)';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`t=${pt.t.toFixed(1)}`, (startX + endX) / 2, ((startY + endY) / 2) - 8);
        }
    }

    const integral = windingData.integral;
    const resultX = originX + integral.real * params.scale.x;
    const resultY = originY - integral.imag * params.scale.y;

    ctx.fillStyle = 'rgba(150, 255, 180, 1)';
    ctx.beginPath();
    ctx.arc(resultX, resultY, 6, 0, TWO_PI);
    ctx.fill();
}

export function drawSpiral(ctx, data, params, options = {}) {
    const { baseColor = { r: 150, g: 200, b: 255 }, enhanced = true } = options;
    const points = data.points;
    if (points.length < 2) return;

    if (!enhanced) {
        ctx.strokeStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, 1)`;
        ctx.lineWidth = LINE_WIDTH_NORMAL;
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const x = params.origin.x + points[i].real * params.scale.x;
            const y = params.origin.y - points[i].imag * params.scale.y;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        return;
    }

    const maxSegments = 20;
    const segmentSize = Math.max(1, Math.floor(points.length / maxSegments));
    for (let i = 0; i < points.length - 1; i += segmentSize) {
        const endIdx = Math.min(i + segmentSize, points.length - 1);
        const progress = i / points.length;
        const alpha = 0.6 + progress * 0.4;

        ctx.strokeStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${alpha})`;
        ctx.lineWidth = 2 + progress;
        ctx.beginPath();
        for (let j = i; j <= endIdx; j++) {
            const x = params.origin.x + points[j].real * params.scale.x;
            const y = params.origin.y - points[j].imag * params.scale.y;
            if (j === i) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
}
