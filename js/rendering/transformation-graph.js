import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { state, zPlaneParams } from '../store/state.js';
import { resolveActiveMap } from '../math/active-map.js';
import { NUM_POINTS_CURVE } from '../constants/numerical.js';
import { mapCanvasToWorldCoords, mapToCanvasCoords } from '../utils/canvas-utils.js';
import {
    buildInputShapeGeometryConfig,
    generateInputShapePointSets
} from './shape-generators.js';

const GRAPHABLE_INPUT_SHAPES = new Set([
    'grid_cartesian',
    'grid_polar',
    'grid_logpolar',
    'grid_logcartesian',
    'line',
    'circle',
    'ellipse'
]);

const BACKGROUND = 0x05060b;
const AXIS_COLOR = 0xaeb8cc;
const GRID_COLOR = 0x43506b;
const INPUT_TICK_COLOR = 0xf3f6ff;
const RE_COLOR = 0xffd45f;
const IM_COLOR = 0x5dd8e8;
const TRACE_COLOR = 0xdfe8ff;
const RE_EMISSIVE = 0x4c3504;
const IM_EMISSIVE = 0x053846;
const SELECTION_STROKE = 'rgba(255, 220, 120, 0.95)';
const SELECTION_GLOW = 'rgba(255, 199, 92, 0.28)';
const SAMPLE_COUNT = 241;
const INPUT_AXIS_HALF = 4.4;
const OUTPUT_AXIS_HALF = 2.05;
const DEPTH_AXIS_HALF = 2.05;
const MAX_TICK_LABELS = 5;
const CURVE_RADIUS = 0.026;
const AXIS_RADIUS = 0.014;
const GRID_RADIUS = 0.0045;
const TRACE_RADIUS = 0.014;
const FRUSTUM_HEIGHT = 6.3;
const FRUSTUM_MIN_HALF_WIDTH = 5.65;
const EPSILON = 1e-10;

let activeGraphRenderer = null;

function isFiniteComplex(value) {
    return Number.isFinite(value?.re) && Number.isFinite(value?.im);
}

function finitePoint(point) {
    return point && Number.isFinite(point.re) && Number.isFinite(point.im);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function normalizedNumber(value) {
    return Math.abs(value) < EPSILON ? 0 : value;
}

function trimFixed(text) {
    return text
        .replace(/(\.\d*?[1-9])0+$/u, '$1')
        .replace(/\.0+$/u, '');
}

function formatNumber(value) {
    const normalized = normalizedNumber(value);
    const abs = Math.abs(normalized);
    if (!Number.isFinite(normalized)) return 'NaN';
    if (abs >= 1000 || (abs > 0 && abs < 0.001)) return normalized.toExponential(2);
    if (abs >= 100) return trimFixed(normalized.toFixed(1));
    if (abs >= 10) return trimFixed(normalized.toFixed(2));
    return trimFixed(normalized.toFixed(3));
}

function formatComplexPoint(point) {
    const re = normalizedNumber(point.re);
    const im = normalizedNumber(point.im);
    const reText = formatNumber(re);
    const imText = formatNumber(Math.abs(im));

    if (im === 0) return reText;
    if (re === 0) return `${im < 0 ? '-' : ''}${imText}i`;
    return `${reText} ${im < 0 ? '-' : '+'} ${imText}i`;
}

export function isGraphViewSupported(shape = state.currentInputShape) {
    return GRAPHABLE_INPUT_SHAPES.has(shape);
}

function getGraphPointSets(planeParams = zPlaneParams) {
    if (!isGraphViewSupported()) return [];

    const config = buildInputShapeGeometryConfig(planeParams, {
        curvePoints: Math.max(SAMPLE_COUNT * 2, Math.min(NUM_POINTS_CURVE, 1000))
    });

    return generateInputShapePointSets(config)
        .filter(set => Array.isArray(set?.points) && set.points.length > 1);
}

function pointSegmentDistanceSq(point, start, end) {
    const dx = end.re - start.re;
    const dy = end.im - start.im;
    const lenSq = dx * dx + dy * dy;

    if (lenSq <= EPSILON) {
        const sx = point.re - start.re;
        const sy = point.im - start.im;
        return sx * sx + sy * sy;
    }

    const t = clamp(((point.re - start.re) * dx + (point.im - start.im) * dy) / lenSq, 0, 1);
    const nearestRe = start.re + dx * t;
    const nearestIm = start.im + dy * t;
    const ox = point.re - nearestRe;
    const oy = point.im - nearestIm;
    return ox * ox + oy * oy;
}

function pointSetDistanceSq(point, pointSet) {
    const points = pointSet?.points || [];
    let best = Infinity;

    for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1];
        const end = points[index];
        if (!finitePoint(start) || !finitePoint(end)) continue;
        best = Math.min(best, pointSegmentDistanceSq(point, start, end));
    }

    return best;
}

function defaultLineIndex(pointSets) {
    if (!pointSets.length) return -1;

    if (state.currentInputShape === 'grid_polar' || state.currentInputShape === 'grid_logpolar') {
        const circular = pointSets
            .map((set, index) => ({ set, index }))
            .filter(item => String(item.set.role || '').includes('radial'));

        if (circular.length) {
            return circular[Math.floor(circular.length * 0.5)].index;
        }
    }

    let bestIndex = 0;
    let bestDistanceSq = Infinity;
    const origin = { re: 0, im: 0 };
    pointSets.forEach((set, index) => {
        const distanceSq = pointSetDistanceSq(origin, set);
        if (distanceSq < bestDistanceSq) {
            bestDistanceSq = distanceSq;
            bestIndex = index;
        }
    });

    return bestIndex;
}

function prefersCircularPolarSelection(pointSet) {
    return (state.currentInputShape === 'grid_polar' || state.currentInputShape === 'grid_logpolar')
        && String(pointSet?.role || '').includes('radial');
}

function selectedLineIndex(pointSets, commitShapeChange = false) {
    if (!pointSets.length) return -1;

    if (state.graphSelectedShape !== state.currentInputShape) {
        const nextIndex = defaultLineIndex(pointSets);
        if (commitShapeChange) {
            state.graphSelectedShape = state.currentInputShape;
            state.graphSelectedLineIndex = nextIndex;
        }
        return nextIndex;
    }

    const raw = Math.floor(Number(state.graphSelectedLineIndex));
    if (!Number.isFinite(raw)) return defaultLineIndex(pointSets);
    return clamp(raw, 0, pointSets.length - 1);
}

export function selectGraphInputFromCanvasPoint(canvasX, canvasY, planeParams = zPlaneParams) {
    if (!state.graphViewEnabled || !isGraphViewSupported()) return false;

    const world = mapCanvasToWorldCoords(canvasX, canvasY, planeParams);
    const probe = { re: world.x, im: world.y };
    if (!finitePoint(probe)) return false;

    const pointSets = getGraphPointSets(planeParams);
    if (!pointSets.length) return false;

    const xRange = planeParams.currentVisXRange || planeParams.xRange || [-1, 1];
    const worldPerPixel = Math.abs((xRange[1] - xRange[0]) / Math.max(1, planeParams.width || 1));
    const toleranceSq = (worldPerPixel * 14) ** 2;

    let bestIndex = -1;
    let bestDistanceSq = Infinity;
    let bestPreferred = false;
    pointSets.forEach((set, index) => {
        const distanceSq = pointSetDistanceSq(probe, set);
        const preferred = prefersCircularPolarSelection(set);
        const nearTie = Math.abs(distanceSq - bestDistanceSq) <= toleranceSq * 0.02;
        if (distanceSq < bestDistanceSq || (nearTie && preferred && !bestPreferred)) {
            bestDistanceSq = distanceSq;
            bestIndex = index;
            bestPreferred = preferred;
        }
    });

    if (bestIndex < 0 || bestDistanceSq > toleranceSq) return false;

    state.graphSelectedShape = state.currentInputShape;
    state.graphSelectedLineIndex = bestIndex;
    state.graphSelectionRevision = (state.graphSelectionRevision || 0) + 1;
    return true;
}

export function drawGraphSelectionOverlay(ctx, planeParams = zPlaneParams) {
    if (!ctx || !state.graphViewEnabled || !isGraphViewSupported()) return;

    const pointSets = getGraphPointSets(planeParams);
    const index = selectedLineIndex(pointSets, false);
    const selected = pointSets[index];
    const points = selected?.points || [];

    if (points.length < 2) return;

    const drawPath = () => {
        let started = false;
        points.forEach(point => {
            if (!finitePoint(point)) {
                started = false;
                return;
            }
            const canvasPoint = mapToCanvasCoords(point.re, point.im, planeParams);
            if (!started) {
                ctx.moveTo(canvasPoint.x, canvasPoint.y);
                started = true;
            } else {
                ctx.lineTo(canvasPoint.x, canvasPoint.y);
            }
        });
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    drawPath();
    ctx.strokeStyle = SELECTION_GLOW;
    ctx.lineWidth = 9;
    ctx.stroke();

    ctx.beginPath();
    drawPath();
    ctx.strokeStyle = SELECTION_STROKE;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.restore();
}

function cumulativeDistances(points) {
    const distances = new Float64Array(points.length);
    let total = 0;

    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        const distance = finitePoint(previous) && finitePoint(current)
            ? Math.hypot(current.re - previous.re, current.im - previous.im)
            : 0;
        total += distance;
        distances[index] = total;
    }

    return { distances, total };
}

function resamplePolyline(points, count = SAMPLE_COUNT) {
    const safePoints = points.filter(finitePoint);
    if (safePoints.length === 0) return [];
    if (safePoints.length === 1 || count <= 1) return [safePoints[0]];

    const { distances, total } = cumulativeDistances(safePoints);
    if (total <= EPSILON) {
        return Array.from({ length: count }, (_, index) => safePoints[Math.min(safePoints.length - 1, index % safePoints.length)]);
    }

    const samples = new Array(count);
    let segment = 1;

    for (let index = 0; index < count; index += 1) {
        const targetDistance = total * (index / (count - 1));
        while (segment < distances.length - 1 && distances[segment] < targetDistance) {
            segment += 1;
        }

        const start = safePoints[segment - 1];
        const end = safePoints[segment];
        const span = distances[segment] - distances[segment - 1];
        const t = span > EPSILON ? (targetDistance - distances[segment - 1]) / span : 0;
        samples[index] = {
            re: lerp(start.re, end.re, t),
            im: lerp(start.im, end.im, t)
        };
    }

    return samples;
}

function robustOutputScale(samples) {
    const values = [];

    samples.forEach(sample => {
        if (!isFiniteComplex(sample.output)) return;
        values.push(Math.abs(sample.output.re), Math.abs(sample.output.im));
    });

    if (!values.length) return 1;

    values.sort((a, b) => a - b);
    const maxValue = values[values.length - 1] || 1;
    const p90 = values[Math.floor((values.length - 1) * 0.90)] || maxValue;
    const robust = Math.max(1, p90 * 1.2);

    return maxValue <= robust * 1.35 ? Math.max(1, maxValue) : robust;
}

function makeGraphDataKey(map, lineIndex) {
    const xRange = zPlaneParams.currentVisXRange || [];
    const yRange = zPlaneParams.currentVisYRange || [];
    return [
        map.signature,
        state.currentInputShape,
        state.graphSelectedShape,
        lineIndex,
        state.graphSelectionRevision || 0,
        state.gridDensity,
        state.a0,
        state.b0,
        state.circleR,
        state.ellipseA,
        state.ellipseB,
        state.graphTraceEnabled ? 1 : 0,
        xRange[0],
        xRange[1],
        yRange[0],
        yRange[1]
    ].join('|');
}

export function buildTransformationGraphData(planeParams = zPlaneParams) {
    if (!state.graphViewEnabled || !isGraphViewSupported()) return null;

    const pointSets = getGraphPointSets(planeParams);
    const lineIndex = selectedLineIndex(pointSets, true);
    const selected = pointSets[lineIndex];
    if (!selected) return null;

    const inputSamples = resamplePolyline(selected.points, SAMPLE_COUNT);
    if (inputSamples.length < 2) return null;

    const map = resolveActiveMap();
    const samples = inputSamples.map((input, index) => {
        let output = { re: NaN, im: NaN };
        try {
            output = map.evaluate(input.re, input.im);
        } catch {
            output = { re: NaN, im: NaN };
        }
        const t = inputSamples.length <= 1 ? 0 : index / (inputSamples.length - 1);
        return { input, output, t };
    });
    const outputScale = robustOutputScale(samples);
    const finiteCount = samples.reduce((count, sample) => count + (isFiniteComplex(sample.output) ? 1 : 0), 0);

    return {
        key: makeGraphDataKey(map, lineIndex),
        samples,
        outputScale,
        finiteCount,
        lineIndex,
        pointSetCount: pointSets.length,
        selectedRole: selected.role || ''
    };
}

function disposeObject(object) {
    if (!object) return;

    const geometries = new Set();
    const materials = new Set();
    object.traverse(child => {
        if (child.geometry) geometries.add(child.geometry);
        if (Array.isArray(child.material)) {
            child.material.forEach(material => materials.add(material));
        } else if (child.material) {
            materials.add(child.material);
        }
    });

    geometries.forEach(geometry => geometry.dispose?.());
    materials.forEach(material => {
        material.map?.dispose?.();
        material.dispose?.();
    });
}

function makeTube(points, {
    color,
    radius = CURVE_RADIUS,
    opacity = 1,
    emissive = 0x000000,
    emissiveIntensity = 0,
    roughness = 0.38,
    metalness = 0.06
} = {}) {
    if (!Array.isArray(points) || points.length < 2) return null;

    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.45);
    const geometry = new THREE.TubeGeometry(curve, Math.max(12, points.length * 2), radius, 10, false);
    const material = new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity,
        roughness,
        metalness,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 0.85
    });

    return new THREE.Mesh(geometry, material);
}

function makeGlowTube(points, color, radius, opacity) {
    const mesh = makeTube(points, {
        color,
        radius,
        opacity,
        emissive: color,
        emissiveIntensity: 0.35,
        roughness: 0.85,
        metalness: 0
    });

    if (mesh) {
        mesh.renderOrder = 1;
        mesh.material.depthWrite = false;
    }

    return mesh;
}

function addSegmentedTube(group, points, options) {
    let segment = [];

    const flush = () => {
        if (segment.length >= 2) {
            const glow = options.glowRadius && options.glowOpacity
                ? makeGlowTube(segment, options.color, options.glowRadius, options.glowOpacity)
                : null;
            const core = makeTube(segment, options);
            if (glow) group.add(glow);
            if (core) group.add(core);
        }
        segment = [];
    };

    points.forEach(point => {
        if (!point) {
            flush();
            return;
        }
        segment.push(point);
    });
    flush();
}

function addSoftLine(group, start, end, options) {
    addSegmentedTube(group, [start, end], options);
}

function addPlane(group, width, height, position, rotation, color, opacity) {
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
    group.add(mesh);
    return mesh;
}

function makeTextSprite(text, {
    color = 'rgba(236, 241, 255, 0.95)',
    fontSize = 46,
    height = 0.28,
    weight = 600,
    maxWidth = 768
} = {}) {
    const padding = 32;
    const font = `${weight} ${fontSize}px "Inter", "Outfit", sans-serif`;
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    measureCtx.font = font;
    const measured = measureCtx.measureText(text);
    const width = Math.min(maxWidth, Math.max(192, Math.ceil(measured.width + padding * 2)));
    const canvasHeight = Math.ceil(fontSize + padding * 2);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = canvasHeight;
    const context = canvas.getContext('2d');
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = color;
    context.shadowColor = 'rgba(0, 0, 0, 0.68)';
    context.shadowBlur = 10;
    context.fillText(text, width / 2, canvasHeight / 2, width - padding);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(height * (width / canvasHeight), height, 1);
    return sprite;
}

function addLabel(group, text, position, options = {}) {
    const sprite = makeTextSprite(text, options);
    sprite.position.copy(position);
    group.add(sprite);
    return sprite;
}

function scaledOutputCoordinate(value, outputScale, halfExtent) {
    if (!Number.isFinite(value)) return NaN;
    const scale = Math.max(EPSILON, outputScale);
    const ratio = value / scale;
    const magnitude = Math.abs(ratio);
    const signed = magnitude <= 1
        ? ratio
        : Math.sign(ratio) * (1 + Math.tanh((magnitude - 1) * 0.55) * 0.18);
    return signed * halfExtent;
}

function graphPointFor(sample, outputScale, mode) {
    if (!isFiniteComplex(sample.output)) return null;

    const x = lerp(-INPUT_AXIS_HALF, INPUT_AXIS_HALF, sample.t);
    const y = scaledOutputCoordinate(sample.output.re, outputScale, OUTPUT_AXIS_HALF);
    const z = scaledOutputCoordinate(sample.output.im, outputScale, DEPTH_AXIS_HALF);

    if (mode === 're') return new THREE.Vector3(x, y, 0);
    if (mode === 'im') return new THREE.Vector3(x, 0, z);
    return new THREE.Vector3(x, y, z);
}

class TransformationGraphRenderer {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(BACKGROUND, 0.032);
        this.camera = new THREE.OrthographicCamera(-5, 5, 3, -3, 0.08, 120);
        this.camera.position.set(6.8, 4.9, 6.5);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
            depth: true,
            stencil: false,
            preserveDrawingBuffer: true
        });
        this.renderer.setClearColor(BACKGROUND);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.syncPixelRatio();
        this.container.replaceChildren(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = false;
        this.controls.enablePan = true;
        this.controls.enableZoom = true;
        this.controls.zoomToCursor = true;
        this.controls.minDistance = 1.8;
        this.controls.maxDistance = 60;
        this.controls.target.set(0.1, 0, 0);
        this.controls.update();
        this.controls.addEventListener('change', () => this.render());

        this.contentGroup = new THREE.Group();
        this.scene.add(this.contentGroup);
        this.addLights();

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
        this.resize();
    }

    syncPixelRatio() {
        const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
        this.renderer.setPixelRatio(Math.min(ratio, 2.5));
    }

    addLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.34));
        this.scene.add(new THREE.HemisphereLight(0xe9f1ff, 0x050510, 1.55));

        const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
        keyLight.position.set(5, 7, 5);
        this.scene.add(keyLight);

        const rimLight = new THREE.DirectionalLight(0x8ed8ff, 1.15);
        rimLight.position.set(-5, 3, -5);
        this.scene.add(rimLight);
    }

    resize() {
        const width = this.container.clientWidth || 1;
        const height = this.container.clientHeight || 1;
        const aspect = width / height;
        let halfHeight = FRUSTUM_HEIGHT * 0.5;
        let halfWidth = halfHeight * aspect;
        if (halfWidth < FRUSTUM_MIN_HALF_WIDTH) {
            halfWidth = FRUSTUM_MIN_HALF_WIDTH;
            halfHeight = halfWidth / Math.max(0.1, aspect);
        }
        this.syncPixelRatio();
        this.camera.left = -halfWidth;
        this.camera.right = halfWidth;
        this.camera.top = halfHeight;
        this.camera.bottom = -halfHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
        this.render();
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    update(data) {
        if (!data) return;
        if (data.key === this.dataKey) {
            this.render();
            return;
        }

        this.dataKey = data.key;
        this.rebuildContent(data);
        this.render();
    }

    clearContent() {
        disposeObject(this.contentGroup);
        this.scene.remove(this.contentGroup);
        this.contentGroup = new THREE.Group();
        this.scene.add(this.contentGroup);
    }

    rebuildContent(data) {
        this.clearContent();
        const group = this.contentGroup;
        this.addReferenceFrame(group, data);
        this.addCurves(group, data);
    }

    addReferenceFrame(group, data) {
        const x0 = -INPUT_AXIS_HALF;
        const x1 = INPUT_AXIS_HALF;
        const y0 = -OUTPUT_AXIS_HALF;
        const y1 = OUTPUT_AXIS_HALF;
        const z0 = -DEPTH_AXIS_HALF;
        const z1 = DEPTH_AXIS_HALF;

        addPlane(
            group,
            INPUT_AXIS_HALF * 2,
            OUTPUT_AXIS_HALF * 2,
            new THREE.Vector3(0, 0, 0),
            { x: 0, y: 0, z: 0 },
            RE_COLOR,
            0.025
        );
        addPlane(
            group,
            INPUT_AXIS_HALF * 2,
            DEPTH_AXIS_HALF * 2,
            new THREE.Vector3(0, 0, 0),
            { x: Math.PI / 2, y: 0, z: 0 },
            IM_COLOR,
            0.022
        );

        addSoftLine(group, new THREE.Vector3(x0, 0, 0), new THREE.Vector3(x1, 0, 0), {
            color: AXIS_COLOR,
            radius: AXIS_RADIUS,
            opacity: 0.52,
            emissive: AXIS_COLOR,
            emissiveIntensity: 0.02,
            roughness: 0.72
        });
        addSoftLine(group, new THREE.Vector3(x0, y0, 0), new THREE.Vector3(x0, y1, 0), {
            color: RE_COLOR,
            radius: AXIS_RADIUS,
            opacity: 0.92,
            emissive: RE_EMISSIVE,
            emissiveIntensity: 0.35
        });
        addSoftLine(group, new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x0, 0, z1), {
            color: IM_COLOR,
            radius: AXIS_RADIUS,
            opacity: 0.92,
            emissive: IM_EMISSIVE,
            emissiveIntensity: 0.35
        });

        for (let index = 0; index <= 8; index += 1) {
            const x = lerp(x0, x1, index / 8);
            addSoftLine(group, new THREE.Vector3(x, y0, 0), new THREE.Vector3(x, y1, 0), {
                color: GRID_COLOR,
                radius: GRID_RADIUS,
                opacity: 0.16,
                roughness: 0.9
            });
            addSoftLine(group, new THREE.Vector3(x, 0, z0), new THREE.Vector3(x, 0, z1), {
                color: GRID_COLOR,
                radius: GRID_RADIUS,
                opacity: 0.13,
                roughness: 0.9
            });
        }

        [-1, -0.5, 0, 0.5, 1].forEach(ratio => {
            addSoftLine(
                group,
                new THREE.Vector3(x0, ratio * OUTPUT_AXIS_HALF, 0),
                new THREE.Vector3(x1, ratio * OUTPUT_AXIS_HALF, 0),
                {
                    color: ratio === 0 ? RE_COLOR : GRID_COLOR,
                    radius: ratio === 0 ? GRID_RADIUS * 1.35 : GRID_RADIUS,
                    opacity: ratio === 0 ? 0.24 : 0.11,
                    roughness: 0.9
                }
            );
            addSoftLine(
                group,
                new THREE.Vector3(x0, 0, ratio * DEPTH_AXIS_HALF),
                new THREE.Vector3(x1, 0, ratio * DEPTH_AXIS_HALF),
                {
                    color: ratio === 0 ? IM_COLOR : GRID_COLOR,
                    radius: ratio === 0 ? GRID_RADIUS * 1.35 : GRID_RADIUS,
                    opacity: ratio === 0 ? 0.22 : 0.10,
                    roughness: 0.9
                }
            );
        });

        this.addInputTicks(group, data);
        this.addOutputTicks(group, data.outputScale);

        addLabel(group, 'Input z', new THREE.Vector3(x1 + 0.68, -0.16, 0), { height: 0.34, fontSize: 48 });
        addLabel(group, 'Re', new THREE.Vector3(x0 - 0.35, y1 + 0.38, 0), {
            color: 'rgba(255, 222, 124, 0.96)',
            height: 0.34,
            fontSize: 52
        });
        addLabel(group, 'Im', new THREE.Vector3(x0 - 0.35, 0, z1 + 0.38), {
            color: 'rgba(122, 219, 236, 0.96)',
            height: 0.34,
            fontSize: 52
        });
    }

    addInputTicks(group, data) {
        const count = Math.min(MAX_TICK_LABELS, data.samples.length);
        for (let index = 0; index < count; index += 1) {
            const sampleIndex = count === 1
                ? 0
                : Math.round((data.samples.length - 1) * (index / (count - 1)));
            const sample = data.samples[sampleIndex];
            const x = lerp(-INPUT_AXIS_HALF, INPUT_AXIS_HALF, sample.t);
            addSoftLine(group, new THREE.Vector3(x, -0.08, 0), new THREE.Vector3(x, 0.08, 0), {
                color: INPUT_TICK_COLOR,
                radius: GRID_RADIUS * 1.3,
                opacity: 0.54,
                roughness: 0.9
            });
            addLabel(group, formatComplexPoint(sample.input), new THREE.Vector3(x, -0.38, -0.32), {
                color: 'rgba(235, 239, 250, 0.74)',
                height: 0.22,
                fontSize: 34,
                weight: 500,
                maxWidth: 640
            });
        }
    }

    addOutputTicks(group) {
        [-1, 0, 1].forEach(ratio => {
            const y = ratio * OUTPUT_AXIS_HALF;
            const z = ratio * DEPTH_AXIS_HALF;

            addSoftLine(group, new THREE.Vector3(-INPUT_AXIS_HALF - 0.08, y, 0), new THREE.Vector3(-INPUT_AXIS_HALF + 0.08, y, 0), {
                color: RE_COLOR,
                radius: GRID_RADIUS * 1.25,
                opacity: 0.45,
                roughness: 0.85
            });

            addSoftLine(group, new THREE.Vector3(-INPUT_AXIS_HALF, 0, z - 0.08), new THREE.Vector3(-INPUT_AXIS_HALF, 0, z + 0.08), {
                color: IM_COLOR,
                radius: GRID_RADIUS * 1.25,
                opacity: 0.45,
                roughness: 0.85
            });
        });
    }

    addCurves(group, data) {
        const rePoints = data.samples.map(sample => graphPointFor(sample, data.outputScale, 're'));
        const imPoints = data.samples.map(sample => graphPointFor(sample, data.outputScale, 'im'));
        const tracePoints = data.samples.map(sample => graphPointFor(sample, data.outputScale, 'trace'));

        addSegmentedTube(group, rePoints, {
            color: RE_COLOR,
            radius: CURVE_RADIUS,
            glowRadius: CURVE_RADIUS * 2.6,
            glowOpacity: 0.14,
            emissive: RE_EMISSIVE,
            emissiveIntensity: 0.48,
            roughness: 0.24
        });
        addSegmentedTube(group, imPoints, {
            color: IM_COLOR,
            radius: CURVE_RADIUS,
            glowRadius: CURVE_RADIUS * 2.6,
            glowOpacity: 0.13,
            emissive: IM_EMISSIVE,
            emissiveIntensity: 0.48,
            roughness: 0.24
        });

        if (state.graphTraceEnabled) {
            addSegmentedTube(group, tracePoints, {
                color: TRACE_COLOR,
                radius: TRACE_RADIUS,
                opacity: 0.54,
                glowRadius: TRACE_RADIUS * 2.4,
                glowOpacity: 0.08,
                emissive: 0x35415d,
                emissiveIntensity: 0.2,
                roughness: 0.5,
                metalness: 0
            });
        }
    }

    dispose() {
        this.resizeObserver?.disconnect();
        this.controls?.dispose?.();
        disposeObject(this.scene);
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}

export function drawTransformationGraph(containerId = 'graph_3d_container') {
    if (typeof document === 'undefined') return;

    const column = document.getElementById('graph_column');
    const container = document.getElementById(containerId);
    const columnHidden = column?.classList.contains('hidden');

    if (!state.graphViewEnabled || columnHidden || !container) {
        if (!state.graphViewEnabled || columnHidden) disposeTransformationGraphRenderer();
        return;
    }

    const data = buildTransformationGraphData();
    if (!data || data.finiteCount === 0) {
        disposeTransformationGraphRenderer();
        container.replaceChildren();
        return;
    }

    if (!activeGraphRenderer) {
        activeGraphRenderer = new TransformationGraphRenderer(container);
    }

    activeGraphRenderer.update(data);
}

export function resizeTransformationGraphRenderer() {
    activeGraphRenderer?.resize();
}

export function disposeTransformationGraphRenderer() {
    if (!activeGraphRenderer) return;
    activeGraphRenderer.dispose();
    activeGraphRenderer = null;
}
