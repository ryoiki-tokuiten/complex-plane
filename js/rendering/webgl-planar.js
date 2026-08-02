import { state, context } from '../store/state.js';
import { runtime } from '../store/runtime.js';
import {
    createWebGLProgramShared,
    getWebGLBackendInfoShared
} from './webgl-shared.js';
import {
    createPlanarTransformedShapeRenderJob,
    drawPlanarTransformedShape,
    drawPlanarInputShape,
    shouldDrawPlanarFunctionFociOverlay
} from './draw-planar.js';
import { WEBGL_LINE_BATCH_LIMIT, WEBGL_SUPERSAMPLE_FACTOR } from '../constants/rendering.js';

const { webglSupport } = context;

const CFG = Object.freeze({
    minSegmentLength: 1e-8,
    closePathEpsilon: 1e-6,
    colorCacheLimit: 512,
    maxSupersample: 1.32,
    maxBaseSupersample: 1.25,
    defaultSupersample: 1.15,
    interactionSupersample: 1,
    qualitySupersample: 1.06,
    maxDprBoost: 1.04,
});

const WEBGL_CONTEXT_ATTRIBUTES = Object.freeze({
    antialias: true,
    alpha: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance'
});

const LINE_MODE = 'line';
const DEFAULT_RGBA = Object.freeze([1, 1, 1, 1]);
const IDENTITY_TRANSFORM = Object.freeze([1, 0, 0, 1, 0, 0]);

const LINE_VERTEX_SOURCE = lines(
    'attribute vec2 a_position;',
    'uniform vec2 u_resolution;',
    'uniform float u_scale;',
    'void main() {',
    '  vec2 scaledPosition = a_position * u_scale;',
    '  vec2 zeroToOne = scaledPosition / u_resolution;',
    '  vec2 clipSpace = zeroToOne * 2.0 - 1.0;',
    '  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);',
    '}'
);

const LINE_FRAGMENT_SOURCE = lines(
    'precision mediump float;',
    'uniform vec4 u_color;',
    'void main() {',
    '  gl_FragColor = u_color;',
    '}'
);

const CAPTURE_STATE_KEYS = Object.freeze([
    'strokeStyle',
    'fillStyle',
    'lineWidth',
    'lineJoin',
    'lineCap',
    'miterLimit',
    'globalAlpha',
    'font',
    'textAlign',
    'textBaseline',
    'globalCompositeOperation',
    '_lineDash'
]);

function lines(...sourceLines) {
    return sourceLines.join('\n');
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveFinite(value) {
    return isFiniteNumber(value) && value > 0;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function rgba(r, g, b, a = 1) {
    return [r, g, b, a];
}

function createCanvasElement() {
    return typeof document !== 'undefined' && typeof document.createElement === 'function'
        ? document.createElement('canvas')
        : null;
}

function createWebGLContext(canvas) {
    return canvas && (
        canvas.getContext('webgl2', WEBGL_CONTEXT_ATTRIBUTES) ||
        canvas.getContext('webgl', WEBGL_CONTEXT_ATTRIBUTES)
    );
}

function createGpuResourceTracker(gl) {
    const resources = {
        programs: [],
        buffers: []
    };

    return {
        program(program) {
            if (program) resources.programs.push(program);
            return program;
        },
        buffer(buffer) {
            if (buffer) resources.buffers.push(buffer);
            return buffer;
        },
        release() {
            resources.buffers.forEach(buffer => gl.deleteBuffer(buffer));
            resources.programs.forEach(program => gl.deleteProgram(program));
        }
    };
}

function hasMissingLineLocations(locations) {
    return locations.aPosition < 0 ||
        locations.uResolution === null ||
        locations.uScale === null ||
        locations.uColor === null;
}

function getLineLocations(gl, program) {
    return {
        aPosition: gl.getAttribLocation(program, 'a_position'),
        uResolution: gl.getUniformLocation(program, 'u_resolution'),
        uScale: gl.getUniformLocation(program, 'u_scale'),
        uColor: gl.getUniformLocation(program, 'u_color')
    };
}

function destroyWebGLLineRenderer(renderer) {
    if (!renderer || !renderer.gl) return;
    const gl = renderer.gl;
    if (renderer.positionBuffer) gl.deleteBuffer(renderer.positionBuffer);
    if (renderer.program) gl.deleteProgram(renderer.program);
}

export function createWebGLLineRenderer() {
    const canvas = createCanvasElement();
    const gl = createWebGLContext(canvas);
    if (!canvas || !gl) return null;

    const tracker = createGpuResourceTracker(gl);
    const fail = () => {
        tracker.release();
        return null;
    };

    const program = tracker.program(createWebGLProgramShared(gl, LINE_VERTEX_SOURCE, LINE_FRAGMENT_SOURCE));
    const positionBuffer = tracker.buffer(gl.createBuffer());

    if (!program || !positionBuffer) {
        return fail();
    }

    const lineLocations = getLineLocations(gl, program);
    if (hasMissingLineLocations(lineLocations)) {
        return fail();
    }

    return {
        canvas,
        gl,
        backendInfo: getWebGLBackendInfoShared(gl),
        program,
        positionBuffer,
        aPosition: lineLocations.aPosition,
        uResolution: lineLocations.uResolution,
        uScale: lineLocations.uScale,
        uColor: lineLocations.uColor,
        colorCache: new Map(),
        renderScale: 1,
        viewWidth: 0,
        viewHeight: 0
    };
}

function isLineRendererInteractionActive() {
    return !!(state && (
        (runtime.interaction.panZ && runtime.interaction.panZ.isPanning) ||
        (runtime.interaction.panW && runtime.interaction.panW.isPanning) ||
        state.particleAnimationEnabled
    ));
}

export function getWebGLSupersampleScale() {
    const configured = isFiniteNumber(WEBGL_SUPERSAMPLE_FACTOR)
        ? WEBGL_SUPERSAMPLE_FACTOR
        : CFG.defaultSupersample;
    const baseScale = clamp(configured, 1, CFG.maxBaseSupersample);

    if (isLineRendererInteractionActive()) {
        return CFG.interactionSupersample;
    }

    const qualityBoost = state && (
        state.fourierModeEnabled ||
        state.laplaceModeEnabled ||
        state.streamlineFlowEnabled
    )
        ? CFG.qualitySupersample
        : 1;
    const dprBoost = typeof window !== 'undefined' && isFiniteNumber(window.devicePixelRatio)
        ? clamp(window.devicePixelRatio, 1, CFG.maxDprBoost)
        : 1;

    return Math.min(CFG.maxSupersample, baseScale * qualityBoost * dprBoost);
}

function resolveRenderScale(renderScaleOverride) {
    return isPositiveFinite(renderScaleOverride)
        ? renderScaleOverride
        : getWebGLSupersampleScale();
}

export function ensureWebGLRendererSize(renderer, width, height, renderScaleOverride = null) {
    if (!renderer || !renderer.canvas || !renderer.gl || width <= 0 || height <= 0) return;

    const renderScale = resolveRenderScale(renderScaleOverride);
    const internalWidth = Math.max(1, Math.round(width * renderScale));
    const internalHeight = Math.max(1, Math.round(height * renderScale));

    if (renderer.canvas.width !== internalWidth) renderer.canvas.width = internalWidth;
    if (renderer.canvas.height !== internalHeight) renderer.canvas.height = internalHeight;

    renderer.renderScale = internalWidth / width;
    renderer.viewWidth = width;
    renderer.viewHeight = height;
    renderer.gl.viewport(0, 0, internalWidth, internalHeight);
}

export function clampToUnit(value) {
    return Math.min(1, Math.max(0, value));
}

function parseHexColor(color) {
    const hex = color.startsWith('#') ? color.slice(1) : '';
    if (hex.length !== 3 && hex.length !== 6) return null;

    const expanded = hex.length === 3
        ? [...hex].map(char => `${char}${char}`).join('')
        : hex;
    if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;

    const value = Number.parseInt(expanded, 16);
    return rgba(
        ((value >> 16) & 255) / 255,
        ((value >> 8) & 255) / 255,
        (value & 255) / 255,
        1
    );
}

function splitFunctionalColorArgs(body) {
    if (body.includes(',')) {
        return body.split(',').map(part => part.trim()).filter(Boolean);
    }

    const [componentText, alphaText] = body.split('/').map(part => part.trim());
    const parts = componentText.split(/\s+/).filter(Boolean);
    if (alphaText) parts.push(alphaText);
    return parts;
}

function parseRgbComponent(token) {
    const value = Number.parseFloat(token);
    if (!Number.isFinite(value)) return null;
    return clampToUnit(token.trim().endsWith('%') ? value / 100 : value / 255);
}

function parseAlphaComponent(token) {
    const value = Number.parseFloat(token);
    if (!Number.isFinite(value)) return null;
    return clampToUnit(token.trim().endsWith('%') ? value / 100 : value);
}

function parseFunctionalColor(color) {
    const match = color.match(/^(rgba?)\((.*)\)$/);
    if (!match) return null;

    const [, kind, body] = match;
    const parts = splitFunctionalColorArgs(body);
    const expectedLength = kind === 'rgba' ? 4 : 3;
    if (parts.length !== expectedLength && !(kind === 'rgb' && parts.length === 4)) return null;

    const channels = parts.slice(0, 3).map(parseRgbComponent);
    if (channels.some(value => value === null)) return null;

    const alpha = parts.length === 4 ? parseAlphaComponent(parts[3]) : 1;
    return alpha === null ? null : rgba(channels[0], channels[1], channels[2], alpha);
}

function getScratchColorContext() {
    if (parseCssColorToRgba._scratchCtx) return parseCssColorToRgba._scratchCtx;

    const scratchCanvas = createCanvasElement();
    parseCssColorToRgba._scratchCtx = scratchCanvas ? scratchCanvas.getContext('2d') : null;
    return parseCssColorToRgba._scratchCtx;
}

function parseCanvasNormalizedColor(colorString) {
    const scratchCtx = getScratchColorContext();
    if (!scratchCtx) return null;

    scratchCtx.fillStyle = '#000000';
    scratchCtx.fillStyle = colorString;
    const normalized = scratchCtx.fillStyle;

    return normalized && normalized !== colorString
        ? parseCssColorToRgba(normalized)
        : null;
}

export function parseCssColorToRgba(colorString) {
    if (typeof colorString !== 'string') {
        return rgba(...DEFAULT_RGBA);
    }

    const raw = colorString.trim();
    if (!raw) return rgba(...DEFAULT_RGBA);

    const color = raw.toLowerCase();
    return parseHexColor(color) ||
        parseFunctionalColor(color) ||
        parseCanvasNormalizedColor(raw) ||
        rgba(...DEFAULT_RGBA);
}

function boundedCacheSet(cache, key, value) {
    if (cache.size >= CFG.colorCacheLimit) {
        cache.delete(cache.keys().next().value);
    }
    cache.set(key, value);
    return value;
}

export function getCachedWebGLColor(renderer, colorString, alphaMultiplier) {
    const alpha = Number.isFinite(alphaMultiplier) ? alphaMultiplier : 1;
    const cache = renderer && renderer.colorCache;
    const cacheKey = `${String(colorString)}|${alpha.toFixed(4)}`;

    if (cache && cache.has(cacheKey)) return cache.get(cacheKey);

    const parsed = parseCssColorToRgba(colorString);
    parsed[3] = clampToUnit(parsed[3] * alpha);

    return cache instanceof Map
        ? boundedCacheSet(cache, cacheKey, parsed)
        : parsed;
}

function cloneCaptureState(ctx) {
    return Object.fromEntries(CAPTURE_STATE_KEYS.map(key => [
        key,
        Array.isArray(ctx[key]) ? ctx[key].slice() : ctx[key]
    ]));
}

function restoreCaptureState(ctx, snapshot) {
    for (const key of CAPTURE_STATE_KEYS) {
        ctx[key] = Array.isArray(snapshot[key]) ? snapshot[key].slice() : snapshot[key];
    }
}

function isFinitePoint(x, y) {
    return Number.isFinite(x) && Number.isFinite(y);
}

export class PolylineCaptureContext {
    constructor() {
        this.strokeStyle = 'rgba(255, 255, 255, 1)';
        this.fillStyle = 'rgba(255, 255, 255, 1)';
        this.lineWidth = 1;
        this.lineJoin = 'miter';
        this.lineCap = 'butt';
        this.miterLimit = 10;
        this.globalAlpha = 1;
        this.globalCompositeOperation = 'source-over';
        this.font = '10px sans-serif';
        this.textAlign = 'left';
        this.textBaseline = 'alphabetic';

        this._lineDash = [];
        this._stateStack = [];
        this._subpaths = [];
        this._activeSubpath = null;
        this._batches = [];
        this._unsupportedOperations = new Set();
    }

    _markUnsupported(operation) {
        this._unsupportedOperations.add(operation);
    }

    _startSubpath(x, y) {
        if (!isFinitePoint(x, y)) {
            this._activeSubpath = null;
            return null;
        }

        const subpath = { points: [x, y], closed: false };
        this._subpaths.push(subpath);
        this._activeSubpath = subpath;
        return subpath;
    }

    _ensureSubpath(x, y) {
        return this._activeSubpath || this._startSubpath(x, y);
    }

    _pushBatch(mode, pointsArray, colorString, lineWidth = 1, alphaMultiplier = 1) {
        if (!Array.isArray(pointsArray) || pointsArray.length < 4) return;
        this._batches.push({
            mode,
            points: new Float32Array(pointsArray),
            color: colorString,
            lineWidth,
            alphaMultiplier,
            lineJoin: this.lineJoin,
            lineCap: this.lineCap,
            miterLimit: this.miterLimit,
            globalCompositeOperation: this.globalCompositeOperation,
            closed: false
        });
    }

    save() {
        this._stateStack.push(cloneCaptureState(this));
    }

    restore() {
        const snapshot = this._stateStack.pop();
        if (snapshot) restoreCaptureState(this, snapshot);
    }

    beginPath() {
        this._subpaths = [];
        this._activeSubpath = null;
    }

    moveTo(x, y) {
        this._startSubpath(x, y);
    }

    lineTo(x, y) {
        if (!isFinitePoint(x, y)) {
            this._activeSubpath = null;
            return;
        }

        const subpath = this._ensureSubpath(x, y);
        if (subpath) subpath.points.push(x, y);
    }

    closePath() {
        const subpath = this._activeSubpath;
        if (!subpath || subpath.points.length < 4) return;

        const points = subpath.points;
        const last = points.length - 2;
        const shouldClose = Math.abs(points[0] - points[last]) > CFG.closePathEpsilon ||
            Math.abs(points[1] - points[last + 1]) > CFG.closePathEpsilon;

        if (shouldClose) points.push(points[0], points[1]);
        subpath.closed = true;
    }

    stroke() {
        if (this._lineDash.length > 0) {
            this._markUnsupported('setLineDash');
            return;
        }

        if (this.globalCompositeOperation !== 'source-over') {
            this._markUnsupported('globalCompositeOperation');
            return;
        }

        if (!Number.isFinite(this.lineWidth) || this.lineWidth <= 0 ||
            !Number.isFinite(this.globalAlpha) || this.globalAlpha < 0 || this.globalAlpha > 1) {
            this._markUnsupported('strokeState');
            return;
        }

        if (typeof this.strokeStyle !== 'string') {
            this._markUnsupported('strokeStyle');
            return;
        }

        if (!['butt', 'round', 'square'].includes(this.lineCap)) {
            this._markUnsupported('lineCap');
            return;
        }

        if (!['miter', 'round', 'bevel'].includes(this.lineJoin)) {
            this._markUnsupported('lineJoin');
            return;
        }
        if (!Number.isFinite(this.miterLimit) || this.miterLimit <= 0) {
            this._markUnsupported('miterLimit');
            return;
        }

        for (const subpath of this._subpaths) {
            if (subpath && subpath.points.length >= 4) {
                this._pushBatch(LINE_MODE, subpath.points, this.strokeStyle, this.lineWidth, this.globalAlpha);
                this._batches[this._batches.length - 1].closed = subpath.closed;
            }
        }
    }

    strokeRect(x, y, width, height) {
        if (!isFinitePoint(x, y) || !isFinitePoint(width, height)) return;
        if (this.globalCompositeOperation !== 'source-over') {
            this._markUnsupported('globalCompositeOperation');
            return;
        }
        if (!Number.isFinite(this.lineWidth) || this.lineWidth <= 0 ||
            !Number.isFinite(this.globalAlpha) || this.globalAlpha < 0 || this.globalAlpha > 1) {
            this._markUnsupported('strokeState');
            return;
        }
        if (typeof this.strokeStyle !== 'string') {
            this._markUnsupported('strokeStyle');
            return;
        }
        if (!['butt', 'round', 'square'].includes(this.lineCap) ||
            !['miter', 'round', 'bevel'].includes(this.lineJoin) ||
            !Number.isFinite(this.miterLimit) || this.miterLimit <= 0) {
            this._markUnsupported('strokeRectStyle');
            return;
        }
        this._pushBatch(
            LINE_MODE,
            [x, y, x + width, y, x + width, y + height, x, y + height, x, y],
            this.strokeStyle,
            this.lineWidth,
            this.globalAlpha
        );
        this._batches[this._batches.length - 1].closed = true;
    }

    setLineDash(value) {
        this._lineDash = Array.isArray(value) ? value.filter(Number.isFinite) : [];
    }

    getLineDash() {
        return this._lineDash.slice();
    }

    measureText(text) {
        return { width: String(text || '').length * 7 };
    }

    getBatches() {
        return this._batches;
    }

    hasUnsupportedOperations() {
        return this._unsupportedOperations.size > 0;
    }

    isCaptureSupported() {
        return !this.hasUnsupportedOperations();
    }

    arc() { this._markUnsupported('arc'); }
    ellipse() { this._markUnsupported('ellipse'); }
    rect() { this._markUnsupported('rect'); }
    fill() { this._markUnsupported('fill'); }
    fillRect() { this._markUnsupported('fillRect'); }
    clearRect() { this._markUnsupported('clearRect'); }
    drawImage() { this._markUnsupported('drawImage'); }
    fillText() { this._markUnsupported('fillText'); }
    strokeText() { this._markUnsupported('strokeText'); }
    clip() { this._markUnsupported('clip'); }
    translate() { this._markUnsupported('translate'); }
    rotate() { this._markUnsupported('rotate'); }
    scale() { this._markUnsupported('scale'); }
    transform() { this._markUnsupported('transform'); }

    setTransform(...args) {
        const isIdentity = args.length === IDENTITY_TRANSFORM.length &&
            args.every((value, index) => value === IDENTITY_TRANSFORM[index]);
        if (!isIdentity) this._markUnsupported('setTransform');
    }
}

function forEachRenderableSegment(points, visit) {
    for (let i = 0; i <= points.length - 4; i += 2) {
        const x0 = points[i];
        const y0 = points[i + 1];
        const x1 = points[i + 2];
        const y1 = points[i + 3];
        if (!isFinitePoint(x0, y0) || !isFinitePoint(x1, y1)) continue;

        const dx = x1 - x0;
        const dy = y1 - y0;
        const length = Math.hypot(dx, dy);
        if (length < CFG.minSegmentLength) continue;

        visit(x0, y0, x1, y1, dx, dy, length);
    }
}

function countRenderableSegments(points) {
    let count = 0;
    forEachRenderableSegment(points, () => { count += 1; });
    return count;
}

function writeSegmentTriangles(output, offset, x0, y0, x1, y1, dx, dy, length, halfWidth) {
    const nx = -dy / length;
    const ny = dx / length;
    const ox = nx * halfWidth;
    const oy = ny * halfWidth;

    const p0Lx = x0 + ox;
    const p0Ly = y0 + oy;
    const p0Rx = x0 - ox;
    const p0Ry = y0 - oy;
    const p1Lx = x1 + ox;
    const p1Ly = y1 + oy;
    const p1Rx = x1 - ox;
    const p1Ry = y1 - oy;

    output.set([
        p0Lx, p0Ly, p0Rx, p0Ry, p1Lx, p1Ly,
        p1Lx, p1Ly, p0Rx, p0Ry, p1Rx, p1Ry
    ], offset);
}

export function buildPolylineTriangles(points, halfWidth) {
    if (!(points instanceof Float32Array) || points.length < 4 || !isPositiveFinite(halfWidth)) {
        return null;
    }

    const segmentCount = countRenderableSegments(points);
    if (segmentCount === 0) return null;

    const output = new Float32Array(segmentCount * 12);
    let offset = 0;
    forEachRenderableSegment(points, (x0, y0, x1, y1, dx, dy, length) => {
        writeSegmentTriangles(output, offset, x0, y0, x1, y1, dx, dy, length, halfWidth);
        offset += 12;
    });

    return output;
}

function appendRoundDiskTriangles(output, centerX, centerY, radius) {
    const segments = 12;
    for (let i = 0; i < segments; i += 1) {
        const angle0 = (i / segments) * Math.PI * 2;
        const angle1 = ((i + 1) / segments) * Math.PI * 2;
        output.push(
            centerX, centerY,
            centerX + Math.cos(angle0) * radius, centerY + Math.sin(angle0) * radius,
            centerX + Math.cos(angle1) * radius, centerY + Math.sin(angle1) * radius
        );
    }
}

function appendSegmentTriangleVertices(output, x0, y0, x1, y1, halfWidth) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (length < CFG.minSegmentLength) return;

    const ox = -dy / length * halfWidth;
    const oy = dx / length * halfWidth;
    output.push(
        x0 + ox, y0 + oy, x0 - ox, y0 - oy, x1 + ox, y1 + oy,
        x1 + ox, y1 + oy, x0 - ox, y0 - oy, x1 - ox, y1 - oy
    );
}

function appendJoinTriangles(output, points, index, lastIndex, halfWidth, lineJoin, miterLimit, closed) {
    if (!closed && (index === 0 || index === lastIndex)) return;

    const closedVertexCount = lastIndex + 1;
    const previousIndex = closed ? (index + lastIndex) % closedVertexCount : index - 1;
    const nextIndex = closed ? (index + 1) % closedVertexCount : index + 1;
    const px = points[index * 2];
    const py = points[index * 2 + 1];
    const previousX = points[previousIndex * 2];
    const previousY = points[previousIndex * 2 + 1];
    const nextX = points[nextIndex * 2];
    const nextY = points[nextIndex * 2 + 1];
    const incomingLength = Math.hypot(px - previousX, py - previousY);
    const outgoingLength = Math.hypot(nextX - px, nextY - py);
    if (incomingLength < CFG.minSegmentLength || outgoingLength < CFG.minSegmentLength) return;

    const incomingX = (px - previousX) / incomingLength;
    const incomingY = (py - previousY) / incomingLength;
    const outgoingX = (nextX - px) / outgoingLength;
    const outgoingY = (nextY - py) / outgoingLength;
    const incomingNormalX = -incomingY;
    const incomingNormalY = incomingX;
    const outgoingNormalX = -outgoingY;
    const outgoingNormalY = outgoingX;
    const turn = incomingX * outgoingY - incomingY * outgoingX;

    if (Math.abs(turn) < 1e-6) {
        if (lineJoin === 'round' && incomingX * outgoingX + incomingY * outgoingY < 0) {
            appendRoundDiskTriangles(output, px, py, halfWidth);
        }
        return;
    }

    const side = turn > 0 ? 1 : -1;
    const outer0X = px + side * incomingNormalX * halfWidth;
    const outer0Y = py + side * incomingNormalY * halfWidth;
    const outer1X = px + side * outgoingNormalX * halfWidth;
    const outer1Y = py + side * outgoingNormalY * halfWidth;

    if (lineJoin === 'round') {
        appendRoundDiskTriangles(output, px, py, halfWidth);
        return;
    }

    let joinX = px;
    let joinY = py;
    let useMiter = lineJoin === 'miter';
    if (useMiter) {
        const miterX = side * (incomingNormalX + outgoingNormalX);
        const miterY = side * (incomingNormalY + outgoingNormalY);
        const miterLength = Math.hypot(miterX, miterY);
        const miterDot = miterX * side * outgoingNormalX + miterY * side * outgoingNormalY;
        if (miterLength > 0 && miterDot > 1e-6) {
            const miterScale = halfWidth / miterDot;
            joinX = px + miterX * miterScale;
            joinY = py + miterY * miterScale;
            useMiter = Math.hypot(joinX - px, joinY - py) <= halfWidth * miterLimit;
        } else {
            useMiter = false;
        }
    }

    output.push(
        outer0X, outer0Y,
        useMiter ? joinX : px, useMiter ? joinY : py,
        outer1X, outer1Y
    );
}

function buildStyledPolylineTriangles(points, halfWidth, lineJoin, lineCap, miterLimit, closed) {
    const segments = buildPolylineTriangles(points, halfWidth);
    if (!segments) return null;

    const extra = [];
    const pointCount = points.length / 2;
    const lastIndex = closed && pointCount > 1 &&
        Math.abs(points[0] - points[points.length - 2]) <= CFG.closePathEpsilon &&
        Math.abs(points[1] - points[points.length - 1]) <= CFG.closePathEpsilon
        ? pointCount - 2
        : pointCount - 1;

    for (let index = 0; index <= lastIndex; index += 1) {
        const isEndpoint = !closed && (index === 0 || index === lastIndex);
        if (isEndpoint && lineCap === 'round') {
            appendRoundDiskTriangles(extra, points[index * 2], points[index * 2 + 1], halfWidth);
        } else if (!isEndpoint) {
            appendJoinTriangles(extra, points, index, lastIndex, halfWidth, lineJoin, miterLimit, closed);
        }
    }

    if (!closed && lineCap === 'square') {
        const firstLength = Math.hypot(points[2] - points[0], points[3] - points[1]);
        const lastOffset = lastIndex * 2;
        const previousOffset = (lastIndex - 1) * 2;
        const lastLength = Math.hypot(
            points[lastOffset] - points[previousOffset],
            points[lastOffset + 1] - points[previousOffset + 1]
        );
        if (firstLength >= CFG.minSegmentLength) {
            const dx = (points[2] - points[0]) / firstLength;
            const dy = (points[3] - points[1]) / firstLength;
            appendSegmentTriangleVertices(
                extra,
                points[0] - dx * halfWidth,
                points[1] - dy * halfWidth,
                points[0],
                points[1],
                halfWidth
            );
        }
        if (lastLength >= CFG.minSegmentLength) {
            const dx = (points[lastOffset] - points[previousOffset]) / lastLength;
            const dy = (points[lastOffset + 1] - points[previousOffset + 1]) / lastLength;
            appendSegmentTriangleVertices(
                extra,
                points[lastOffset],
                points[lastOffset + 1],
                points[lastOffset] + dx * halfWidth,
                points[lastOffset + 1] + dy * halfWidth,
                halfWidth
            );
        }
    }

    if (extra.length === 0) return segments;
    const output = new Float32Array(segments.length + extra.length);
    output.set(segments);
    output.set(extra, segments.length);
    return output;
}

function prepareLinePass(renderer, width, height) {
    if (!renderer.program || !renderer.positionBuffer) return false;

    const gl = renderer.gl;
    ensureWebGLRendererSize(renderer, width, height, 1);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(renderer.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.positionBuffer);
    gl.enableVertexAttribArray(renderer.aPosition);
    gl.vertexAttribPointer(renderer.aPosition, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(renderer.uResolution, renderer.canvas.width, renderer.canvas.height);
    gl.uniform1f(renderer.uScale, renderer.renderScale);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    return true;
}

function getBatchHalfWidth(batch, renderScale) {
    return Math.max(0.5, batch.lineWidth * renderScale * 0.5);
}

function getBatchTriangleLayers(batch, renderScale) {
    const halfWidth = getBatchHalfWidth(batch, renderScale);
    const featherWidth = halfWidth >= 1 ? Math.max(0.2, renderScale * 0.18) : 0;
    const layers = [];

    if (featherWidth > 0) {
        const outer = buildStyledPolylineTriangles(
            batch.points,
            halfWidth + featherWidth,
            batch.lineJoin,
            batch.lineCap,
            batch.miterLimit,
            batch.closed
        );
        if (outer && outer.length >= 6) layers.push({ triangles: outer, alphaScale: 0.16 });
    }

    const inner = buildStyledPolylineTriangles(
        batch.points,
        halfWidth,
        batch.lineJoin,
        batch.lineCap,
        batch.miterLimit,
        batch.closed
    );
    if (inner && inner.length >= 6) layers.push({ triangles: inner, alphaScale: 1 });

    return layers;
}

function drawLineTriangles(renderer, triangles, rgba, alphaScale) {
    const gl = renderer.gl;
    gl.uniform4f(renderer.uColor, rgba[0], rgba[1], rgba[2], clampToUnit(rgba[3] * alphaScale));
    gl.bufferData(gl.ARRAY_BUFFER, triangles, gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, triangles.length / 2);
}

function isRenderableLineBatch(batch) {
    return batch &&
        batch.mode === LINE_MODE &&
        batch.points instanceof Float32Array &&
        batch.points.length >= 4 &&
        typeof batch.color === 'string' &&
        Number.isFinite(batch.lineWidth) &&
        batch.lineWidth > 0 &&
        Number.isFinite(batch.alphaMultiplier) &&
        batch.alphaMultiplier >= 0 &&
        batch.alphaMultiplier <= 1 &&
        batch.globalCompositeOperation === 'source-over' &&
        Number.isFinite(batch.miterLimit) &&
        batch.miterLimit > 0 &&
        ['butt', 'round', 'square'].includes(batch.lineCap) &&
        ['miter', 'round', 'bevel'].includes(batch.lineJoin);
}

export function renderWebGLPolylineBatches(renderer, width, height, batches) {
    if (!renderer || !renderer.gl || !Array.isArray(batches)) return false;
    if (!prepareLinePass(renderer, width, height)) return false;

    let totalFloatCount = 0;
    for (const batch of batches) {
        if (!isRenderableLineBatch(batch)) return false;

        const rgba = getCachedWebGLColor(
            renderer,
            batch.color,
            batch.alphaMultiplier
        );

        for (const layer of getBatchTriangleLayers(batch, renderer.renderScale)) {
            totalFloatCount += layer.triangles.length;
            if (totalFloatCount > WEBGL_LINE_BATCH_LIMIT) return false;
            drawLineTriangles(renderer, layer.triangles, rgba, layer.alphaScale);
        }
    }

    return true;
}

function copyToTargetCanvas(ctx, sourceCanvas, width, height) {
    if (!ctx || !sourceCanvas || width <= 0 || height <= 0) return;

    ctx.save();
    if (ctx.imageSmoothingEnabled !== undefined) ctx.imageSmoothingEnabled = true;
    if (ctx.imageSmoothingQuality !== undefined) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, width, height);
    ctx.restore();
}

export function compositeWebGLToCanvas(ctx, renderer, width, height) {
    if (!renderer) return;
    copyToTargetCanvas(ctx, renderer.canvas, width, height);
}

function clearWebGLSupportRenderers() {
    if (!webglSupport || !webglSupport.renderers) return;
    destroyWebGLLineRenderer(webglSupport.renderers.z);
    destroyWebGLLineRenderer(webglSupport.renderers.w);
}

function resetWebGLSupport(reason) {
    if (!webglSupport) return;
    webglSupport.available = false;
    webglSupport.reason = reason;
    webglSupport.renderers.z = null;
    webglSupport.renderers.w = null;
    webglSupport.diagnostics.z = null;
    webglSupport.diagnostics.w = null;
}

function publishWebGLSupport(rendererZ, rendererW) {
    webglSupport.renderers.z = rendererZ;
    webglSupport.renderers.w = rendererW;
    webglSupport.diagnostics.z = rendererZ.backendInfo || null;
    webglSupport.diagnostics.w = rendererW.backendInfo || null;
    webglSupport.available = true;
    webglSupport.reason = 'ready';
}

function logWebGLSupportStatus() {
    const diag = webglSupport.diagnostics.z || webglSupport.diagnostics.w;
    if (!diag) {
        console.info('WebGL line rendering enabled.');
        return;
    }

    const rendererLabel = diag.unmaskedRenderer || diag.renderer || 'unknown renderer';
    const vendorLabel = diag.unmaskedVendor || diag.vendor || 'unknown vendor';
    const message = `WebGL line rendering ${diag.softwareBackend ? 'is running on a software backend' : 'enabled on'} ${vendorLabel} | ${rendererLabel}.`;

    if (diag.softwareBackend) {
        console.warn(message);
    } else {
        console.info(message);
    }
}

export function initializeWebGLLineSupport() {
    clearWebGLSupportRenderers();
    resetWebGLSupport('disabled-or-unavailable');

    if (!state || !state.webglLineRenderingEnabled) {
        webglSupport.reason = 'disabled';
        return;
    }

    const rendererZ = createWebGLLineRenderer();
    const rendererW = createWebGLLineRenderer();

    if (!rendererZ || !rendererW) {
        destroyWebGLLineRenderer(rendererZ);
        destroyWebGLLineRenderer(rendererW);
        webglSupport.reason = 'context-or-program-init-failed';
        console.info('WebGL line rendering unavailable, using 2D canvas fallback.');
        return;
    }

    publishWebGLSupport(rendererZ, rendererW);
    logWebGLSupportStatus();
}

export function getWebGLRendererForPlane(planeKey) {
    if (!webglSupport || !webglSupport.renderers) return null;
    return planeKey === 'z' ? webglSupport.renderers.z : webglSupport.renderers.w;
}

function canUseWebGLLines(ctx, planeParams, planeKey, drawCallback) {
    return !!(
        state &&
        state.webglLineRenderingEnabled &&
        webglSupport &&
        webglSupport.available &&
        ctx &&
        planeParams &&
        getWebGLRendererForPlane(planeKey) &&
        typeof drawCallback === 'function'
    );
}

export function drawWithWebGLCapture(ctx, planeParams, planeKey, drawCallback) {
    if (!canUseWebGLLines(ctx, planeParams, planeKey, drawCallback)) return false;

    const captureCtx = new PolylineCaptureContext();
    drawCallback(captureCtx);

    if (!captureCtx.isCaptureSupported()) return false;

    const batches = captureCtx.getBatches();
    if (!batches || batches.length === 0) return false;

    const renderer = getWebGLRendererForPlane(planeKey);
    if (!renderWebGLPolylineBatches(renderer, planeParams.width, planeParams.height, batches)) {
        return false;
    }

    compositeWebGLToCanvas(ctx, renderer, planeParams.width, planeParams.height);
    return true;
}

export function drawPlanarTransformedShapeHybrid(ctx, planeParams, tf, planeKey, map = null, options = null) {
    const drawOptions = {
        ...options,
        map,
        index: options?.index,
        renderJob: options?.renderJob || createPlanarTransformedShapeRenderJob(tf)
    };

    const geometryRendered = drawWithWebGLCapture(ctx, planeParams, planeKey, (captureCtx) => {
        drawPlanarTransformedShape(captureCtx, planeParams, tf, { ...drawOptions, includeOverlays: false });
    });

    if (!geometryRendered) {
        drawPlanarTransformedShape(ctx, planeParams, tf, { ...drawOptions, includeOverlays: false });
    }

    if (options?.includeOverlays !== false && shouldDrawPlanarFunctionFociOverlay()) {
        drawPlanarTransformedShape(ctx, planeParams, tf, { ...drawOptions, includeGeometry: false });
    }

    return true;
}

export function drawPlanarInputShapeHybrid(ctx, planeParams, planeKey) {
    const renderedByCapture = drawWithWebGLCapture(ctx, planeParams, planeKey, (captureCtx) => {
        drawPlanarInputShape(captureCtx, planeParams);
    });
    if (renderedByCapture) return true;

    drawPlanarInputShape(ctx, planeParams);
    return true;
}
