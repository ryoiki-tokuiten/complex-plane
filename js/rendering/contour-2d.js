import { state, context, zPlaneParams } from '../store/state.js';
import { getFinalMapStageIndex, resolveActiveMap } from '../math/active-map.js';
import { getChainedTransformFunction } from '../math-utils.js';
import { paletteLutFor, sampleRealPlotSurface } from './real-plots-renderer.js';
import { drawAxes, drawGrid } from './canvas-primitives.js';
import { domainColorForValue } from './domain-coloring.js';

const MAX_CANVAS_DPR = 2.5;
const CONTOUR_SAMPLE_MIN = 192;
const CONTOUR_SAMPLE_MAX = 768;
const CONTOUR_SAMPLE_PIXEL_STEP = 1.15;
const RIEMANN_CHAINED_SAMPLE_MAX = 512;
const RIEMANN_DEEP_CHAIN_SAMPLE_MAX = 384;
const RIEMANN_EXTREME_CHAIN_SAMPLE_MAX = 320;
const INVALID_COLOR = Object.freeze([6, 8, 15]);
const FALLBACK_RANGE = Object.freeze([-3.5, 3.5]);

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, value) {
    if (edge0 === edge1) return value < edge0 ? 0 : 1;
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function readRange(range, fallback = FALLBACK_RANGE) {
    return Array.isArray(range) && range.length >= 2
        ? [
            finiteNumber(+range[0]) ? +range[0] : fallback[0],
            finiteNumber(+range[1]) ? +range[1] : fallback[1]
        ]
        : [...fallback];
}

function resizeContourCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.floor(rect.width || 300));
    const cssHeight = Math.max(1, Math.floor(rect.height || 300));
    const devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const dpr = clamp(devicePixelRatio, 1, MAX_CANVAS_DPR);
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));

    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }

    return { cssWidth, cssHeight, width, height, dpr };
}

function getContourInterval() {
    const interval = Number(state.contourInterval);
    return Number.isFinite(interval) && interval > 1e-9 ? interval : 0.5;
}

function getContourThickness() {
    const thickness = Number(state.contourThickness);
    return Number.isFinite(thickness) && thickness > 0 ? thickness : 1.5;
}

function contourSampleLength(pixelLength, maxSamples = CONTOUR_SAMPLE_MAX) {
    return Math.max(2, Math.round(clamp(
        Math.ceil(pixelLength / CONTOUR_SAMPLE_PIXEL_STEP),
        CONTOUR_SAMPLE_MIN,
        maxSamples
    )));
}

function riemannContourSampleMax() {
    if (!state.chainingEnabled) return CONTOUR_SAMPLE_MAX;
    const chainCount = Math.max(1, Math.floor(Number(state.chainCount) || 1));
    if (chainCount > 25) return RIEMANN_EXTREME_CHAIN_SAMPLE_MAX;
    if (chainCount > 8) return RIEMANN_DEEP_CHAIN_SAMPLE_MAX;
    return RIEMANN_CHAINED_SAMPLE_MAX;
}

function distanceToContour(value, interval) {
    return Math.abs(value - Math.round(value / interval) * interval);
}

function componentFromComplex(value, component) {
    if (!value || !Number.isFinite(value.re) || !Number.isFinite(value.im)) return NaN;

    switch (component) {
        case 'real':
            return value.re;
        case 'magnitude':
            return Math.hypot(value.re, value.im);
        case 'phase':
            return Math.atan2(value.im, value.re);
        case 'imag':
        case 'imaginary':
        default:
            return value.im;
    }
}

function makePlaneParams(width, height) {
    const xRange = readRange(zPlaneParams.currentVisXRange);
    const yRange = readRange(zPlaneParams.currentVisYRange, [-3, 3]);
    const xSpan = xRange[1] - xRange[0] || 1;
    const ySpan = yRange[1] - yRange[0] || 1;

    return {
        width,
        height,
        origin: {
            x: -xRange[0] * width / xSpan,
            y: yRange[1] * height / ySpan
        },
        scale: {
            x: width / xSpan,
            y: height / ySpan
        },
        currentVisXRange: xRange,
        currentVisYRange: yRange
    };
}

function getRiemannContourMap() {
    const pipelineMap = context.riemannSurfaceContourPipeline?.map;
    if (typeof pipelineMap?.evaluate === 'function') return pipelineMap.evaluate;
    return resolveActiveMap(getFinalMapStageIndex()).evaluate;
}

function sampleRiemannHeightField(width, height) {
    const xRange = readRange(zPlaneParams.currentVisXRange);
    const yRange = readRange(zPlaneParams.currentVisYRange, [-3, 3]);
    const maxSamples = riemannContourSampleMax();
    const cols = contourSampleLength(width, maxSamples);
    const rows = contourSampleLength(height, maxSamples);
    const values = new Float64Array(cols * rows);
    const colors = new Uint8ClampedArray(cols * rows * 3);
    const transform = getRiemannContourMap();
    const component = state.riemannSurfaceComponent || 'imaginary';
    const xSpan = xRange[1] - xRange[0] || 1;
    const ySpan = yRange[1] - yRange[0] || 1;
    let minValue = Infinity;
    let maxValue = -Infinity;

    for (let row = 0; row < rows; row += 1) {
        const y = yRange[0] + (row / Math.max(1, rows - 1)) * ySpan;
        for (let col = 0; col < cols; col += 1) {
            const x = xRange[0] + (col / Math.max(1, cols - 1)) * xSpan;
            let value = NaN;
            let rgb = INVALID_COLOR;

            try {
                const mapped = transform(x, y);
                if (mapped && Number.isFinite(mapped.re) && Number.isFinite(mapped.im)) {
                    value = componentFromComplex(mapped, component);
                    rgb = domainColorForValue(mapped.re, mapped.im, state);
                }
            } catch {
                value = NaN;
            }

            const index = row * cols + col;
            const colorIndex = index * 3;
            values[index] = value;
            colors[colorIndex] = rgb[0];
            colors[colorIndex + 1] = rgb[1];
            colors[colorIndex + 2] = rgb[2];
            if (Number.isFinite(value)) {
                if (value < minValue) minValue = value;
                if (value > maxValue) maxValue = value;
            }
        }
    }

    return { values, colors, cols, rows, minValue, maxValue };
}

function sampleRealPlotHeightField(width, height) {
    if (!state.realPlotsEnabled) return null;
    const side = contourSampleLength(Math.max(width, height));
    const surface = sampleRealPlotSurface(
        getChainedTransformFunction(state.currentFunction),
        {
            segments: side - 1,
            valuesOnly: true,
            invalidAsNaN: true
        }
    );

    if (!surface?.values || surface.values.length !== side * side) return null;
    return {
        values: surface.values,
        cols: side,
        rows: side,
        minValue: surface.minValue,
        maxValue: surface.maxValue
    };
}

function sampleBilinear(field, gridX, gridY) {
    const { values, cols, rows } = field;
    const x0 = Math.floor(gridX);
    const y0 = Math.floor(gridY);
    const x1 = Math.min(cols - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const tx = gridX - x0;
    const ty = gridY - y0;
    const idx00 = y0 * cols + x0;
    const idx10 = y0 * cols + x1;
    const idx01 = y1 * cols + x0;
    const idx11 = y1 * cols + x1;
    const v00 = values[idx00];
    const v10 = values[idx10];
    const v01 = values[idx01];
    const v11 = values[idx11];

    if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v01) || !Number.isFinite(v11)) {
        return null;
    }

    const top = v00 + (v10 - v00) * tx;
    const bottom = v01 + (v11 - v01) * tx;
    const sample = {
        value: top + (bottom - top) * ty,
        dx: ((v10 - v00) * (1 - ty) + (v11 - v01) * ty) * (cols - 1),
        dy: ((v01 - v00) * (1 - tx) + (v11 - v10) * tx) * (rows - 1)
    };

    if (field.colors) {
        const { colors } = field;
        const c00 = idx00 * 3;
        const c10 = idx10 * 3;
        const c01 = idx01 * 3;
        const c11 = idx11 * 3;
        const wx0 = 1 - tx;
        const wy0 = 1 - ty;
        const w00 = wx0 * wy0;
        const w10 = tx * wy0;
        const w01 = wx0 * ty;
        const w11 = tx * ty;
        sample.r = colors[c00] * w00 + colors[c10] * w10 + colors[c01] * w01 + colors[c11] * w11;
        sample.g = colors[c00 + 1] * w00 + colors[c10 + 1] * w10 + colors[c01 + 1] * w01 + colors[c11 + 1] * w11;
        sample.b = colors[c00 + 2] * w00 + colors[c10 + 2] * w10 + colors[c01 + 2] * w01 + colors[c11 + 2] * w11;
    }

    return sample;
}

function writePixel(data, offset, r, g, b, a = 255) {
    data[offset] = Math.round(clamp(r, 0, 255));
    data[offset + 1] = Math.round(clamp(g, 0, 255));
    data[offset + 2] = Math.round(clamp(b, 0, 255));
    data[offset + 3] = a;
}

function renderHeightField(ctx, width, height, field, paletteName) {
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;
    const useFieldColors = !!field.colors;
    const paletteLut = useFieldColors ? null : paletteLutFor(paletteName || 'viridis');
    const minValue = Number.isFinite(field.minValue) ? field.minValue : 0;
    const maxValue = Number.isFinite(field.maxValue) ? field.maxValue : minValue + 1;
    const span = Math.abs(maxValue - minValue) > 1e-9 ? maxValue - minValue : 1;
    const invSpan = 1 / span;
    const contourInterval = getContourInterval();
    const contourThickness = getContourThickness();
    const contourEnabled = !!state.contoursEnabled;
    const invWidth = 1 / Math.max(1, width - 1);
    const invHeight = 1 / Math.max(1, height - 1);

    for (let py = 0; py < height; py += 1) {
        const unitY = 1 - py * invHeight;
        const gridY = unitY * (field.rows - 1);

        for (let px = 0; px < width; px += 1) {
            const unitX = px * invWidth;
            const gridX = unitX * (field.cols - 1);
            const sample = sampleBilinear(field, gridX, gridY);
            const dataIdx = (py * width + px) * 4;

            if (!sample || !Number.isFinite(sample.value)) {
                writePixel(data, dataIdx, INVALID_COLOR[0], INVALID_COLOR[1], INVALID_COLOR[2]);
                continue;
            }

            let r;
            let g;
            let b;

            if (useFieldColors) {
                r = sample.r;
                g = sample.g;
                b = sample.b;
            } else {
                const normalized = clamp((sample.value - minValue) * invSpan, 0, 1);
                const lutOffset = Math.floor(normalized * 1023 + 0.5) * 3;
                r = paletteLut[lutOffset] * 255;
                g = paletteLut[lutOffset + 1] * 255;
                b = paletteLut[lutOffset + 2] * 255;
            }

            if (contourEnabled) {
                const dxPerPixel = sample.dx * invWidth;
                const dyPerPixel = sample.dy * invHeight;
                const gradient = Math.hypot(dxPerPixel, dyPerPixel);

                if (gradient > 1e-12) {
                    const pixelDistance = distanceToContour(sample.value, contourInterval) / gradient;
                    const lineIntensity = 1 - smoothstep(
                        Math.max(0, contourThickness - 0.75),
                        contourThickness + 0.75,
                        pixelDistance
                    );
                    const lineMix = lineIntensity * clamp(0.62 + contourThickness * 0.08, 0.66, 1);
                    const useLightInk = 0.2126 * r + 0.7152 * g + 0.0722 * b < 145;
                    const ink = useLightInk ? [246, 249, 255] : [8, 10, 18];
                    r = r * (1 - lineMix) + ink[0] * lineMix;
                    g = g * (1 - lineMix) + ink[1] * lineMix;
                    b = b * (1 - lineMix) + ink[2] * lineMix;
                }
            }

            writePixel(data, dataIdx, r, g, b);
        }
    }

    ctx.putImageData(imgData, 0, 0);
}

function drawPlaneOverlay(ctx, cssWidth, cssHeight, dpr, labels) {
    const params = makePlaneParams(cssWidth, cssHeight);

    ctx.save();
    ctx.scale(dpr, dpr);
    drawGrid(ctx, params, {
        targetCount: 12,
        minorColor: 'rgba(128, 137, 255, 0.08)',
        majorColor: 'rgba(128, 137, 255, 0.15)'
    });
    drawAxes(ctx, params, {
        xLabel: labels.x,
        yLabel: labels.y,
        ticks: true,
        tickLabels: true,
        originDot: true,
        color: 'rgba(190, 196, 255, 0.55)',
        lineWidth: 1
    });
    ctx.restore();
}

export function draw2DContourPlot(canvas) {
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { cssWidth, cssHeight, width, height, dpr } = resizeContourCanvas(canvas);
    if (width === 0 || height === 0) return;

    ctx.clearRect(0, 0, width, height);

    if (state.riemannSurfaceEnabled) {
        const field = sampleRiemannHeightField(width, height);
        renderHeightField(ctx, width, height, field);
        drawPlaneOverlay(ctx, cssWidth, cssHeight, dpr, { x: 'Re(z)', y: 'Im(z)' });
        return;
    }

    const field = sampleRealPlotHeightField(width, height);
    if (!field) return;

    renderHeightField(ctx, width, height, field, state.realPlotsPalette || 'viridis');
    drawPlaneOverlay(ctx, cssWidth, cssHeight, dpr, { x: 'x', y: 'y' });
}
