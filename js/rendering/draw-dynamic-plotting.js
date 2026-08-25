import { state } from '../store/state.js';
import {
    formatDynamicValue,
    getDynamicPlotResult,
    isDynamicAggregateActive
} from '../analysis/dynamic-plotting.js';
import { mapToCanvasCoords } from '../utils/canvas-utils.js';
import { requireFiniteNumber, requireInteger, isFiniteComplex } from '../utils/numeric-contracts.js';

const COLORS = Object.freeze({
    input: '#78a6c8',
    term: '#d8dee9',
    partial: 'rgba(167, 139, 250, 0.58)',
    vector: 'rgba(196, 181, 253, 0.42)',
    final: '#5fc7a0',
    invalid: '#fb7185',
    label: 'rgba(245, 247, 255, 0.9)',
    labelBackground: 'rgba(8, 10, 18, 0.78)'
});

function displayConfig() {
    const display = state.dynamicPlotting?.display;
    if (!display || typeof display !== 'object') throw new Error('Dynamic plotting requires display configuration.');
    return display;
}

function pointRadius() {
    const value = requireFiniteNumber(displayConfig().pointRadius, 'Dynamic point radius');
    return Math.max(2, Math.min(6, value));
}

function drawMarker(ctx, planeParams, value, options = {}) {
    if (!isFiniteComplex(value)) return;
    const canvasPoint = mapToCanvasCoords(value.re, value.im, planeParams);
    const radius = options.radius ?? pointRadius();
    const color = options.color || COLORS.term;
    const variant = options.variant || 'solid';

    ctx.save();
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, radius, 0, 2 * Math.PI);
    if (variant !== 'outline') {
        ctx.fillStyle = color;
        ctx.fill();
    }
    ctx.lineWidth = variant === 'outline' ? 1.35 : 1;
    ctx.strokeStyle = variant === 'outline' ? color : 'rgba(10, 13, 22, 0.82)';
    ctx.stroke();

    if (options.selected || variant === 'final') {
        ctx.beginPath();
        ctx.arc(canvasPoint.x, canvasPoint.y, radius + 2.2, 0, 2 * Math.PI);
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = options.selected
            ? 'rgba(255, 255, 255, 0.82)'
            : 'rgba(95, 199, 160, 0.58)';
        ctx.stroke();
    }
    ctx.restore();

    if (options.label) drawLabel(ctx, canvasPoint, options.label, radius);
}

function drawLabel(ctx, point, label, radius) {
    ctx.save();
    ctx.font = "10px 'SF Mono', 'Roboto Mono', monospace";
    const metrics = ctx.measureText(label);
    const width = metrics.width + 8;
    const height = 17;
    const x = point.x + radius + 5;
    const y = point.y - height - 3;

    ctx.fillStyle = COLORS.labelBackground;
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const corner = Math.min(4, width / 2, height / 2);
    ctx.moveTo(x + corner, y);
    ctx.lineTo(x + width - corner, y);
    ctx.arcTo(x + width, y, x + width, y + corner, corner);
    ctx.lineTo(x + width, y + height - corner);
    ctx.arcTo(x + width, y + height, x + width - corner, y + height, corner);
    ctx.lineTo(x + corner, y + height);
    ctx.arcTo(x, y + height, x, y + height - corner, corner);
    ctx.lineTo(x, y + corner);
    ctx.arcTo(x, y, x + corner, y, corner);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.label;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 4, y + height / 2);
    ctx.restore();
}

function drawPath(ctx, planeParams, points, options = {}) {
    if (!Array.isArray(points) || points.length < 2) return;

    ctx.save();
    ctx.strokeStyle = options.color || COLORS.partial;
    ctx.lineWidth = options.width || 1.8;
    ctx.globalAlpha = options.alpha ?? 0.9;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (options.dash) ctx.setLineDash(options.dash);

    let open = false;
    ctx.beginPath();
    for (const value of points) {
        if (!isFiniteComplex(value)) {
            if (open) ctx.stroke();
            ctx.beginPath();
            open = false;
            continue;
        }

        const point = mapToCanvasCoords(value.re, value.im, planeParams);
        if (!open) {
            ctx.moveTo(point.x, point.y);
            open = true;
        } else {
            ctx.lineTo(point.x, point.y);
        }
    }
    if (open) ctx.stroke();
    ctx.restore();
}

function drawArrow(ctx, planeParams, from, to, color = COLORS.vector) {
    if (!isFiniteComplex(from) || !isFiniteComplex(to)) return;
    const start = mapToCanvasCoords(from.re, from.im, planeParams);
    const end = mapToCanvasCoords(to.re, to.im, planeParams);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 2) return;

    const ux = dx / length;
    const uy = dy / length;
    const headLength = Math.min(9, Math.max(4, length * 0.18));
    const headWidth = headLength * 0.55;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - ux * headLength - uy * headWidth, end.y - uy * headLength + ux * headWidth);
    ctx.lineTo(end.x - ux * headLength + uy * headWidth, end.y - uy * headLength - ux * headWidth);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function selected(sample) {
    return sample.id === state.dynamicPlotting?.selectedSampleId;
}

function sampleLabel(sample) {
    if (!displayConfig().showLabels) return null;
    if (!sample.symbolValues || typeof sample.symbolValues !== 'object' || Array.isArray(sample.symbolValues)) {
        throw new Error(`Dynamic sample ${sample.id} requires symbol values.`);
    }
    const symbols = Object.entries(sample.symbolValues)
        .slice(0, 3)
        .map(([name, value]) => `${name}=${formatDynamicValue(value, 3)}`);
    return [`j=${sample.ordinal}`, `d=${sample.label}`, ...symbols].join(', ');
}

function drawInvalid(ctx, planeParams, sample, value) {
    if (!displayConfig().showInvalid || !isFiniteComplex(value)) return;
    const point = mapToCanvasCoords(value.re, value.im, planeParams);
    const radius = pointRadius() + 1;

    ctx.save();
    ctx.strokeStyle = COLORS.invalid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(point.x - radius, point.y - radius);
    ctx.lineTo(point.x + radius, point.y + radius);
    ctx.moveTo(point.x + radius, point.y - radius);
    ctx.lineTo(point.x - radius, point.y + radius);
    ctx.stroke();
    ctx.restore();
}

function partialValue(sample) {
    if (displayConfig().productView === 'normalized' && sample.partial?.normalized) {
        return sample.partial.normalized;
    }
    return sample.partial?.value || null;
}

function drawReduction(ctx, planeParams, samples, reduction) {
    if (reduction.kind === 'none') return;

    const partials = samples.map(partialValue);
    if (displayConfig().showPartialPath) {
        drawPath(ctx, planeParams, partials, { color: COLORS.partial, width: 1.5 });
    }

    if (displayConfig().showVectors && reduction.kind === 'sum') {
        let previous = { re: 0, im: 0 };
        for (const sample of samples) {
            const current = partialValue(sample);
            if (isFiniteComplex(current)) {
                drawArrow(ctx, planeParams, previous, current);
                previous = current;
            }
        }
    }

    const final = [...partials].reverse().find(isFiniteComplex);
    if (final) {
        drawMarker(ctx, planeParams, final, {
            color: COLORS.final,
            radius: pointRadius() + 1.2,
            variant: 'final',
            label: displayConfig().showLabels ? `${reduction.kind}=${formatDynamicValue(final, 4)}` : null
        });
    }
}

function drawTermSamples(ctx, planeParams, samples) {
    if (!displayConfig().showTermPoints) return;

    samples.forEach(sample => {
        if (sample.status !== 'valid') {
            drawInvalid(ctx, planeParams, sample, sample.termValue);
            return;
        }
        drawMarker(ctx, planeParams, sample.termValue, {
            color: COLORS.term,
            selected: selected(sample),
            label: sampleLabel(sample)
        });
    });
}

export function drawDynamicZPlane(ctx, planeParams) {
    if (!state.dynamicPlotting?.enabled || !displayConfig().showInputPoints) return;

    const result = getDynamicPlotResult();
    if (!result) return;
    const samples = result.visibleSamples;

    if (displayConfig().showInputPath) {
        drawPath(ctx, planeParams, samples.map(sample => sample.inputPoint), {
            color: 'rgba(96, 165, 250, 0.55)',
            width: 1.4,
            dash: [4, 4]
        });
    }

    samples.forEach(sample => {
        if (sample.status !== 'valid') drawInvalid(ctx, planeParams, sample, sample.inputPoint);
        drawMarker(ctx, planeParams, sample.inputPoint, {
            color: COLORS.input,
            variant: 'outline',
            selected: selected(sample),
            label: sampleLabel(sample)
        });
    });
}

function drawMappedSamples(ctx, planeParams, transform, stageIndex) {
    const result = getDynamicPlotResult({ transform, stageIndex });
    if (!result) return;
    const samples = result.visibleSamples;

    drawTermSamples(ctx, planeParams, samples);
    drawReduction(ctx, planeParams, samples, result.reduction);
}

function drawAggregateStage(ctx, planeParams, transform, stageIndex) {
    const result = getDynamicPlotResult({ stageIndex });
    if (!result) return;

    if (stageIndex === 0) {
        drawTermSamples(ctx, planeParams, result.visibleSamples);
        drawReduction(ctx, planeParams, result.visibleSamples, result.reduction);
    }

    const s = result.aggregateParameter;
    const stageValue = typeof transform === 'function' ? transform(s.re, s.im) : result.reduction.finalValue;
    if (isFiniteComplex(stageValue)) {
        drawMarker(ctx, planeParams, stageValue, {
            color: COLORS.final,
            radius: pointRadius() + 1.2,
            variant: 'final',
            label: displayConfig().showLabels ? `F(${formatDynamicValue(s, 3)})` : null
        });
    }
}

export function drawDynamicWPlane(ctx, planeParams, transform, stageIndex = 0) {
    if (!state.dynamicPlotting?.enabled) return;

    if (isDynamicAggregateActive()) {
        drawAggregateStage(ctx, planeParams, transform, stageIndex);
    } else {
        drawMappedSamples(ctx, planeParams, transform, stageIndex);
    }
}

export function getDynamicManifoldSceneData(options = {}) {
    if (!state.dynamicPlotting?.enabled) return null;

    const stageIndex = options.stageIndex === undefined
        ? 0
        : requireInteger(options.stageIndex, 'Dynamic manifold stage');
    const transform = options.transform;
    const aggregateActive = isDynamicAggregateActive();
    const result = getDynamicPlotResult({
        transform: aggregateActive ? undefined : transform,
        stageIndex
    });
    if (!result) return null;

    const points = [];
    let path = [];
    let finalPoint = null;

    if (aggregateActive) {
        if (stageIndex === 0 && displayConfig().showTermPoints) {
            points.push(...result.visibleSamples.map(sample => sample.termValue).filter(isFiniteComplex));
        }
        if (stageIndex === 0 && displayConfig().showPartialPath) {
            path = result.visibleSamples.map(partialValue).filter(isFiniteComplex);
        }

        const s = result.aggregateParameter;
        const stageValue = typeof transform === 'function'
            ? transform(s.re, s.im)
            : result.reduction.finalValue;
        finalPoint = isFiniteComplex(stageValue) ? stageValue : null;
    } else {
        if (displayConfig().showTermPoints) {
            points.push(...result.visibleSamples.map(sample => sample.termValue).filter(isFiniteComplex));
        }
        if (displayConfig().showPartialPath && result.reduction.kind !== 'none') {
            path = result.visibleSamples.map(partialValue).filter(isFiniteComplex);
            finalPoint = [...path].reverse().find(isFiniteComplex) || null;
        }
    }

    return {
        points,
        path,
        finalPoint,
        pointSize: pointRadius()
    };
}

export const getDynamicSphereSceneData = getDynamicManifoldSceneData;

export function findNearestDynamicSample(worldPoint, plane = 'z', options = {}) {
    if (!state.dynamicPlotting?.enabled || !isFiniteComplex(worldPoint)) return null;

    const result = getDynamicPlotResult({
        transform: plane === 'w' && !isDynamicAggregateActive() ? options.transform : undefined,
        stageIndex: options.stageIndex === undefined
            ? 0
            : requireInteger(options.stageIndex, 'Dynamic sample stage')
    });
    if (!result) return null;

    const span = requireFiniteNumber(options.worldSpan, 'Dynamic sample world span');
    const pixelWidth = requireFiniteNumber(options.pixelWidth, 'Dynamic sample pixel width');
    if (span <= 0 || pixelWidth <= 0) throw new Error('Dynamic sample span and pixel width must be positive.');
    const tolerance = options.tolerance === undefined
        ? span / pixelWidth * 10
        : requireFiniteNumber(options.tolerance, 'Dynamic sample tolerance');
    if (tolerance < 0) throw new Error('Dynamic sample tolerance must be non-negative.');
    const toleranceSq = tolerance * tolerance;
    let best = null;
    let bestDistanceSq = Infinity;

    for (const sample of result.visibleSamples) {
        const candidates = plane === 'z'
            ? [sample.inputPoint]
            : [sample.termValue, partialValue(sample)];

        for (const value of candidates) {
            if (!isFiniteComplex(value)) continue;
            const dx = value.re - worldPoint.re;
            const dy = value.im - worldPoint.im;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq <= toleranceSq && distanceSq < bestDistanceSq) {
                bestDistanceSq = distanceSq;
                best = sample;
            }
        }
    }

    return best;
}

export function formatDynamicSampleTooltip(sample) {
    if (!sample) return '';
    const lines = [
        '<b>Dynamic Plotting</b>',
        `j = ${sample.ordinal}`,
        `d = ${formatDynamicValue(sample.domainValue)}`,
        `z = ${formatDynamicValue(sample.inputPoint)}`
    ];
    if (sample.termValue) lines.push(`a_j = ${formatDynamicValue(sample.termValue)}`);
    if (sample.partial?.value) lines.push(`partial = ${formatDynamicValue(sample.partial.value)}`);
    if (sample.status !== 'valid') lines.push(`status = ${sample.status}`);
    if (sample.error) lines.push(sample.error);
    return lines.join('<br>');
}
