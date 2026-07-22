import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { state, zPlaneParams } from '../store/state.js';
import { buildMappedTransformProfileKey, getChainedTransformFunction } from '../math-utils.js';
import { compileExpression } from '../math/expression/evaluator.js';
import { POLE_MAGNITUDE_THRESHOLD } from '../constants/numerical.js';

const BACKGROUND = 0x070812;
const CAMERA_HOME = Object.freeze({ x: 6.0, y: 5.0, z: 8.0 });
const SURFACE_SIZE = 6.0;
const SURFACE_HEIGHT = 3.5;
const DEFAULT_SAMPLE_SEGMENTS = 96;
const RENDER_SEGMENTS = 192;
const HALF_SURFACE = SURFACE_SIZE * 0.5;
const HALF_HEIGHT = SURFACE_HEIGHT * 0.5;
const CLAMP_LIMIT = 8.0;
const INV_TWO_PI = 1 / (2 * Math.PI);
const PALETTE_LUT_SIZE = 1024;
const PALETTE_LUT_MASK = PALETTE_LUT_SIZE - 1;
const COMPLEX_ZERO_EPSILON = 1e-15;
const RECIPROCAL_POLE_CAP = POLE_MAGNITUDE_THRESHOLD * 2;

const INPUT_PRESET = Object.freeze({
    GENERIC: 0,
    X: 1,
    Y: 2,
    ZERO: 3,
    X_PLUS_Y: 4,
    X_MINUS_Y: 5,
    X_TIMES_Y: 6,
    TWO_X_PLUS_Y: 7,
    SIN_X_PLUS_COS_Y: 8,
    X2_MINUS_Y2: 9
});

const OUTPUT_COMPONENT = Object.freeze({
    REAL: 0,
    IMAG: 1,
    MAGNITUDE: 2
});

const TRANSFORM_KERNEL = Object.freeze({
    CALL: 0,
    IDENTITY: 1,
    SQUARE: 2,
    RECIPROCAL: 3,
    EXP: 4,
    SIN: 5,
    COS: 6
});

const PALETTE_HEX = Object.freeze({
    ocean: [0x001b2e, 0x005f73, 0x0a9396, 0x94d2bd, 0xe9d8a6],
    cyberpunk: [0x11001c, 0x3a0ca3, 0xf72585, 0x4cc9f0, 0xfaff00],
    copper: [0x170f0a, 0x5c2e12, 0xb85c24, 0xf6aa52, 0xffecd1],
    forest: [0x03190e, 0x0b3d20, 0x2d6a4f, 0x95d5b2, 0xfff3b0],
    viridis: [0x440154, 0x3b528b, 0x21908d, 0x5dc963, 0xfde725],
    sunset: [0x12001f, 0x3c096c, 0x9d174d, 0xf97316, 0xfef3c7]
});

export let active3DRenderer = null;

function isFiniteNumber(value) {
    return typeof value === 'number' && value === value && value !== Infinity && value !== -Infinity;
}

function clamp01(value) {
    return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

function hexChannel(hex, shift) {
    return ((hex >> shift) & 255) / 255;
}

function writeInterpolatedHex(target, offset, a, b, t) {
    const ar = hexChannel(a, 16);
    const ag = hexChannel(a, 8);
    const ab = hexChannel(a, 0);
    target[offset] = ar + (hexChannel(b, 16) - ar) * t;
    target[offset + 1] = ag + (hexChannel(b, 8) - ag) * t;
    target[offset + 2] = ab + (hexChannel(b, 0) - ab) * t;
}

function createPaletteLut(hexStops) {
    const lut = new Float32Array(PALETTE_LUT_SIZE * 3);
    if (!hexStops || hexStops.length === 0) return lut;
    if (hexStops.length === 1) {
        for (let i = 0, offset = 0; i < PALETTE_LUT_SIZE; i += 1, offset += 3) {
            writeInterpolatedHex(lut, offset, hexStops[0], hexStops[0], 0);
        }
        return lut;
    }

    const lastSegment = hexStops.length - 1;
    for (let i = 0, offset = 0; i < PALETTE_LUT_SIZE; i += 1, offset += 3) {
        const scaled = i / (PALETTE_LUT_SIZE - 1) * lastSegment;
        const segment = Math.min(lastSegment - 1, scaled | 0);
        writeInterpolatedHex(lut, offset, hexStops[segment], hexStops[segment + 1], scaled - segment);
    }
    return lut;
}

const PALETTE_LUTS = Object.freeze(Object.fromEntries(
    Object.entries(PALETTE_HEX).map(([name, stops]) => [name, createPaletteLut(stops)])
));

export function paletteLutFor(name) {
    return PALETTE_LUTS[name] || PALETTE_LUTS.sunset;
}

function writePaletteColor(lut, ratio, colors, offset) {
    const lutOffset = ((clamp01(ratio) * PALETTE_LUT_MASK + 0.5) | 0) * 3;
    colors[offset] = lut[lutOffset];
    colors[offset + 1] = lut[lutOffset + 1];
    colors[offset + 2] = lut[lutOffset + 2];
}

function makeAxisLabel(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 144;
    const context = canvas.getContext('2d');
    context.font = '700 58px "STIX Two Math", "Cambria Math", serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = 'rgba(0, 0, 0, 0.55)';
    context.shadowBlur = 14;
    context.fillStyle = color;
    context.fillText(text, 192, 72);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false
    }));
    sprite.scale.set(1.35, 0.5, 1);
    return sprite;
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

function canonicalExpression(expression) {
    return String(expression || 'x')
        .toLowerCase()
        .replace(/[\s_]+/g, '')
        .replace(/−/g, '-')
        .replace(/\*\*/g, '^')
        .replace(/²/g, '^2')
        .replace(/·/g, '*');
}

function presetType(expr) {
    switch (canonicalExpression(expr)) {
        case 'x': return INPUT_PRESET.X;
        case 'y': return INPUT_PRESET.Y;
        case '0': return INPUT_PRESET.ZERO;
        case 'x+y': case 'y+x': return INPUT_PRESET.X_PLUS_Y;
        case 'x-y': return INPUT_PRESET.X_MINUS_Y;
        case 'x*y': case 'xy': return INPUT_PRESET.X_TIMES_Y;
        case '2x+y': case '2*x+y': case 'x+x+y': case 'y+2x': case 'y+2*x': return INPUT_PRESET.TWO_X_PLUS_Y;
        case 'sin(x)+cos(y)': case 'cos(y)+sin(x)': return INPUT_PRESET.SIN_X_PLUS_COS_Y;
        case 'x*x-y*y': case 'x^2-y^2': return INPUT_PRESET.X2_MINUS_Y2;
        default: return INPUT_PRESET.GENERIC;
    }
}

const compiledPresetCache = new Map();

function getCompiledPreset(preset) {
    if (!compiledPresetCache.has(preset)) {
        try {
            compiledPresetCache.set(preset, compileExpression(preset, { allowedVariables: ['x', 'y'] }));
        } catch {
            compiledPresetCache.set(preset, null);
        }
    }
    return compiledPresetCache.get(preset);
}

class InputEvaluator {
    static #cache = new Map();

    static for(expression) {
        const key = expression || 'x';
        let evaluator = this.#cache.get(key);
        if (!evaluator) {
            evaluator = new InputEvaluator(key);
            this.#cache.set(key, evaluator);
        }
        return evaluator;
    }

    constructor(expression) {
        this.expression = expression || 'x';
        this.type = presetType(this.expression);
        this.compiled = this.type === INPUT_PRESET.GENERIC ? getCompiledPreset(this.expression) : null;
        this.scope = {
            x: { re: 0, im: 0 },
            y: { re: 0, im: 0 }
        };
    }

    write(x, y, out) {
        switch (this.type) {
            case INPUT_PRESET.X:
                out[0] = x; out[1] = 0; return;
            case INPUT_PRESET.Y:
                out[0] = y; out[1] = 0; return;
            case INPUT_PRESET.ZERO:
                out[0] = 0; out[1] = 0; return;
            case INPUT_PRESET.X_PLUS_Y:
                out[0] = x + y; out[1] = 0; return;
            case INPUT_PRESET.X_MINUS_Y:
                out[0] = x - y; out[1] = 0; return;
            case INPUT_PRESET.X_TIMES_Y:
                out[0] = x * y; out[1] = 0; return;
            case INPUT_PRESET.TWO_X_PLUS_Y:
                out[0] = 2 * x + y; out[1] = 0; return;
            case INPUT_PRESET.SIN_X_PLUS_COS_Y:
                out[0] = Math.sin(x) + Math.cos(y); out[1] = 0; return;
            case INPUT_PRESET.X2_MINUS_Y2:
                out[0] = x * x - y * y; out[1] = 0; return;
            default:
                this.writeCompiled(x, y, out);
        }
    }

    writeCompiled(x, y, out) {
        const compiled = this.compiled;
        if (!compiled) {
            out[0] = x;
            out[1] = 0;
            return;
        }

        const scope = this.scope;
        scope.x.re = x;
        scope.x.im = 0;
        scope.y.re = y;
        scope.y.im = 0;

        try {
            const result = compiled(scope);
            if (typeof result === 'number') {
                out[0] = isFiniteNumber(result) ? result : 0;
                out[1] = 0;
            } else if (result && typeof result === 'object') {
                const re = result.re;
                const im = result.im || 0;
                out[0] = isFiniteNumber(re) ? re : 0;
                out[1] = isFiniteNumber(im) ? im : 0;
            } else {
                out[0] = 0;
                out[1] = 0;
            }
        } catch {
            out[0] = 0;
            out[1] = 0;
        }
    }
}

class StaticSurfaceTopology {
    constructor(segments = DEFAULT_SAMPLE_SEGMENTS) {
        this.segments = Math.max(1, segments | 0);
        this.stride = this.segments + 1;
        this.vertexCount = this.stride * this.stride;
        const indexCount = this.segments * this.segments * 6;
        const IndexArray = this.vertexCount > 65535 ? Uint32Array : Uint16Array;
        this.indices = new IndexArray(indexCount);
        this.gridX = new Float32Array(this.vertexCount);
        this.gridZ = new Float32Array(this.vertexCount);
        this.#buildGrid();
        this.#buildIndices();
    }

    #buildGrid() {
        const scale = SURFACE_SIZE / this.segments;
        let index = 0;
        for (let j = 0; j <= this.segments; j += 1) {
            const z = j * scale - HALF_SURFACE;
            for (let i = 0; i <= this.segments; i += 1) {
                this.gridX[index] = i * scale - HALF_SURFACE;
                this.gridZ[index] = z;
                index += 1;
            }
        }
    }

    #buildIndices() {
        let write = 0;
        const stride = this.stride;
        for (let j = 0; j < this.segments; j += 1) {
            const row = j * stride;
            const next = row + stride;
            for (let i = 0; i < this.segments; i += 1) {
                const a = row + i;
                const b = a + 1;
                const c = next + i;
                const d = c + 1;
                this.indices[write++] = a;
                this.indices[write++] = c;
                this.indices[write++] = b;
                this.indices[write++] = b;
                this.indices[write++] = c;
                this.indices[write++] = d;
            }
        }
    }
}

const topologyCache = new Map();

function topologyFor(segments) {
    const safeSegments = Math.max(1, Math.floor(Number(segments) || DEFAULT_SAMPLE_SEGMENTS));
    let topology = topologyCache.get(safeSegments);
    if (!topology) {
        topology = new StaticSurfaceTopology(safeSegments);
        topologyCache.set(safeSegments, topology);
    }
    return topology;
}

class SurfaceMeshStore {
    constructor(segments = RENDER_SEGMENTS) {
        this.topology = topologyFor(segments);
        this.segments = this.topology.segments;
        this.vertexCount = this.topology.vertexCount;
        this.positions = new Float32Array(this.vertexCount * 3);
        this.normals = new Float32Array(this.vertexCount * 3);
        this.colors = new Float32Array(this.vertexCount * 3);
        this.rawValues = new Float32Array(this.vertexCount);
        this.values = new Float64Array(this.vertexCount);
        this.phases = new Float32Array(this.vertexCount);
        this.u = new Float64Array(2);
        this.v = new Float64Array(2);

        this.contourUniforms = {
            uContoursEnabled: { value: 0.0 },
            uContourInterval: { value: 0.5 },
            uContourThickness: { value: 1.5 }
        };

        this.geometry = this.#createGeometry();
        this.material = this.#createSurfaceMaterial();
        this.wireMaterial = this.#createWireMaterial();
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.wireframe = new THREE.Mesh(this.geometry, this.wireMaterial);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.wireframe.renderOrder = 2;
        this.lastBoundsKey = '';
    }

    #createGeometry() {
        const geometry = new THREE.BufferGeometry();
        const position = new THREE.BufferAttribute(this.positions, 3);
        const normal = new THREE.BufferAttribute(this.normals, 3);
        const color = new THREE.BufferAttribute(this.colors, 3);
        const rawValue = new THREE.BufferAttribute(this.rawValues, 1);
        position.setUsage?.(THREE.DynamicDrawUsage);
        normal.setUsage?.(THREE.DynamicDrawUsage);
        color.setUsage?.(THREE.DynamicDrawUsage);
        rawValue.setUsage?.(THREE.DynamicDrawUsage);
        geometry.setAttribute('position', position);
        geometry.setAttribute('normal', normal);
        geometry.setAttribute('color', color);
        geometry.setAttribute('rawValue', rawValue);
        geometry.setIndex(new THREE.BufferAttribute(this.topology.indices, 1));
        return geometry;
    }

    #createSurfaceMaterial() {
        const contourUniforms = this.contourUniforms;
        const material = new THREE.MeshPhysicalMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            roughness: 0.18,
            metalness: 0.16,
            clearcoat: 1.0,
            clearcoatRoughness: 0.055,
            transmission: 0.08,
            ior: 1.58,
            thickness: 0.72,
            specularIntensity: 1.0,
            transparent: true,
            opacity: 0.975,
            envMapIntensity: 1.35
        });

        material.onBeforeCompile = (shader) => {
            shader.uniforms.uContoursEnabled = contourUniforms.uContoursEnabled;
            shader.uniforms.uContourInterval = contourUniforms.uContourInterval;
            shader.uniforms.uContourThickness = contourUniforms.uContourThickness;

            shader.vertexShader = 'attribute float rawValue;\nvarying float v_heightVal;\nvarying vec3 v_worldNormalFast;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <beginnormal_vertex>',
                `#include <beginnormal_vertex>
                v_worldNormalFast = normalize(normalMatrix * objectNormal);`
            );
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                v_heightVal = rawValue;`
            );

            shader.fragmentShader = 'varying float v_heightVal;\nvarying vec3 v_worldNormalFast;\nuniform float uContoursEnabled;\nuniform float uContourInterval;\nuniform float uContourThickness;\n' + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <dithering_fragment>',
                `#include <dithering_fragment>
                vec3 viewRimNormal = normalize(v_worldNormalFast);
                float fresnelBoost = pow(1.0 - clamp(abs(viewRimNormal.z), 0.0, 1.0), 2.6);
                gl_FragColor.rgb += vec3(0.08, 0.13, 0.20) * fresnelBoost;
                if (uContoursEnabled > 0.5) {
                    float valDeriv = length(vec2(dFdx(v_heightVal), dFdy(v_heightVal)));
                    if (valDeriv > 1.0e-6) {
                        float safeInterval = max(uContourInterval, 1.0e-6);
                        float contourCoord = v_heightVal / safeInterval;
                        float distToContour = abs(contourCoord - floor(contourCoord + 0.5)) * safeInterval;
                        float pixelDist = distToContour / valDeriv;
                        float lineIntensity = 1.0 - smoothstep(max(0.0, uContourThickness - 0.8), uContourThickness + 0.8, pixelDist);
                        float contourLum = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
                        vec3 contourInk = contourLum < 0.57 ? vec3(0.965, 0.976, 1.0) : vec3(0.025, 0.030, 0.055);
                        gl_FragColor.rgb = mix(gl_FragColor.rgb, contourInk, lineIntensity * 0.88);
                    }
                }`
            );
        };

        return material;
    }

    #createWireMaterial() {
        const MaterialCtor = THREE.MeshBasicMaterial || THREE.LineBasicMaterial;
        return new MaterialCtor({
            color: 0xf4f8ff,
            transparent: true,
            opacity: 0.04,
            depthWrite: false,
            wireframe: true
        });
    }

    markDirty() {
        const geometry = this.geometry;
        geometry.getAttribute('position').needsUpdate = true;
        geometry.getAttribute('normal').needsUpdate = true;
        geometry.getAttribute('color').needsUpdate = true;
        geometry.getAttribute('rawValue').needsUpdate = true;
        geometry.computeBoundingSphere?.();
    }

    dispose() {
        this.geometry.dispose?.();
        this.material.dispose?.();
        this.wireMaterial.dispose?.();
    }
}

function formatCoord(value) {
    if (Math.abs(value) < 1e-10) return '0';
    if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) return value.toExponential(2);
    const text = value.toFixed(2);
    return text.endsWith('.00') ? text.slice(0, -3) : text;
}

function outputComponentMode(component) {
    if (component === 'imag') return OUTPUT_COMPONENT.IMAG;
    if (component === 'magnitude') return OUTPUT_COMPONENT.MAGNITUDE;
    return OUTPUT_COMPONENT.REAL;
}

function outputAxisLabel(component) {
    if (component === 'imag') return 'z = Im(f)';
    if (component === 'magnitude') return 'z = |f|';
    return 'z = Re(f)';
}

function realPlotSurfaceKey() {
    const xRange = zPlaneParams.currentVisXRange || [];
    const yRange = zPlaneParams.currentVisYRange || [];
    return [
        buildMappedTransformProfileKey(state.currentFunction),
        buildMappedTransformProfileKey('mobius'),
        buildMappedTransformProfileKey('polynomial'),
        state.chainingEnabled ? 1 : 0,
        state.chainCount,
        state.chainingMode,
        state.taylorSeriesEnabled ? 1 : 0,
        state.taylorSeriesOrder,
        state.taylorSeriesCenter?.re,
        state.taylorSeriesCenter?.im,
        state.realPlotsInputExpr,
        state.realPlotsImagExpr,
        state.realPlotsOutputComponent,
        state.realPlotsPalette,
        state.realPlotsColorMode,
        state.realPlotsHeightScale,
        xRange[0],
        xRange[1],
        yRange[0],
        yRange[1]
    ].join('|');
}

function isScalarInputType(type) {
    return type !== INPUT_PRESET.GENERIC;
}

function evalScalarInput(type, x, y) {
    switch (type) {
        case INPUT_PRESET.X: return x;
        case INPUT_PRESET.Y: return y;
        case INPUT_PRESET.ZERO: return 0;
        case INPUT_PRESET.X_PLUS_Y: return x + y;
        case INPUT_PRESET.X_MINUS_Y: return x - y;
        case INPUT_PRESET.X_TIMES_Y: return x * y;
        case INPUT_PRESET.TWO_X_PLUS_Y: return 2 * x + y;
        case INPUT_PRESET.SIN_X_PLUS_COS_Y: return Math.sin(x) + Math.cos(y);
        case INPUT_PRESET.X2_MINUS_Y2: return x * x - y * y;
        default: return x;
    }
}

function softClampHeight(value) {
    const abs = Math.abs(value);
    if (abs <= CLAMP_LIMIT) return value;
    return (value < 0 ? -1 : 1) * (CLAMP_LIMIT + Math.tanh(abs - CLAMP_LIMIT));
}

function expSafeForPlot(value) {
    if (value > 700) return Math.exp(700);
    if (value < -745) return 0;
    return Math.exp(value);
}

function writeReciprocalKernel(re, im, out) {
    if (re === 0 && im === 0) {
        out[0] = NaN;
        out[1] = NaN;
        return out;
    }

    const absRe = Math.abs(re);
    const absIm = Math.abs(im);
    const scale = Math.max(absRe, absIm);

    if (scale < COMPLEX_ZERO_EPSILON) {
        out[0] = RECIPROCAL_POLE_CAP;
        out[1] = 0;
        return out;
    }

    if (absRe >= absIm) {
        const ratio = im / re;
        const divisor = re + im * ratio;
        out[0] = 1 / divisor;
        out[1] = -ratio / divisor;
        return out;
    }

    const ratio = re / im;
    const divisor = im + re * ratio;
    out[0] = ratio / divisor;
    out[1] = -1 / divisor;
    return out;
}

function transformKernelKind(transformFunc) {
    const meta = transformFunc?.realPlotsKernel ?? transformFunc?.realPlotKernel ?? transformFunc?.kernel;
    const kind = typeof meta === 'string' ? meta : meta?.kind;
    switch (String(kind || '').toLowerCase()) {
        case 'identity': case 'id': return TRANSFORM_KERNEL.IDENTITY;
        case 'square': case 'z2': return TRANSFORM_KERNEL.SQUARE;
        case 'reciprocal': case 'inverse': case 'inv': return TRANSFORM_KERNEL.RECIPROCAL;
        case 'exp': case 'exponential': return TRANSFORM_KERNEL.EXP;
        case 'sin': return TRANSFORM_KERNEL.SIN;
        case 'cos': return TRANSFORM_KERNEL.COS;
        default: break;
    }

    const name = String(transformFunc?.name || '').toLowerCase();
    if (name === 'identity' || name === 'id') return TRANSFORM_KERNEL.IDENTITY;
    if (name === 'square' || name === 'z2') return TRANSFORM_KERNEL.SQUARE;
    if (name === 'reciprocal' || name === 'inverse' || name === 'complexreciprocal') return TRANSFORM_KERNEL.RECIPROCAL;
    if (name === 'expc' || name === 'exp' || name === 'complexexp') return TRANSFORM_KERNEL.EXP;
    if (name === 'complexsin') return TRANSFORM_KERNEL.SIN;
    if (name === 'complexcos') return TRANSFORM_KERNEL.COS;
    return TRANSFORM_KERNEL.CALL;
}

function writeHeightfieldNormals(positions, normals, segments, gridStep) {
    const stride = segments + 1;
    const inverseCell = 1 / (2 * gridStep);
    for (let j = 0; j <= segments; j += 1) {
        const row = j * stride;
        const prevRow = (j === 0 ? 0 : j - 1) * stride;
        const nextRow = (j === segments ? segments : j + 1) * stride;
        for (let i = 0; i <= segments; i += 1) {
            const iPrev = i === 0 ? 0 : i - 1;
            const iNext = i === segments ? segments : i + 1;
            const index = row + i;
            const centerOffset = index * 3;
            const nx = -(positions[(row + iNext) * 3 + 1] - positions[(row + iPrev) * 3 + 1]) * inverseCell;
            const nz = -(positions[(nextRow + i) * 3 + 1] - positions[(prevRow + i) * 3 + 1]) * inverseCell;
            const invLen = 1 / Math.sqrt(nx * nx + nz * nz + 1);
            normals[centerOffset] = nx * invLen;
            normals[centerOffset + 1] = invLen;
            normals[centerOffset + 2] = nz * invLen;
        }
    }
}

function selectRawValue(re, im, outputMode) {
    if (outputMode === OUTPUT_COMPONENT.IMAG) return im;
    if (outputMode === OUTPUT_COMPONENT.MAGNITUDE) return Math.sqrt(re * re + im * im);
    return re;
}

function finishSampleGeometry({ segments, vertexCount, topology, positions, normals, colors, rawValues, values, phases, minZ, maxZ, usePhaseColor, paletteLut, heightFactor }) {
    const spanZ = maxZ - minZ || 1.0;
    const inverseSpanZ = 1 / spanZ;
    for (let index = 0, offset = 0; index < vertexCount; index += 1, offset += 3) {
        const rawValue = values[index];
        rawValues[index] = rawValue;
        positions[offset] = topology.gridX[index];
        positions[offset + 1] = softClampHeight(rawValue) * heightFactor;
        positions[offset + 2] = topology.gridZ[index];
        writePaletteColor(
            paletteLut,
            usePhaseColor ? phases[index] : (rawValue - minZ) * inverseSpanZ,
            colors,
            offset
        );
    }
    writeHeightfieldNormals(positions, normals, segments, SURFACE_SIZE / segments);
}

function sampleValuesPass(transformFunc, config, catchPerVertex) {
    const {
        segments, values, phases, u, v, xMin, yMin, xScale, yScale,
        inputU, inputV, inputUType, inputVType, scalarInputs, outputMode, invalidValue,
        usePhaseColor, kernelKind
    } = config;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let finiteResultCount = 0;
    let vertex = 0;
    const fastXY = scalarInputs && inputUType === INPUT_PRESET.X && inputVType === INPUT_PRESET.Y;
    const fastX0 = scalarInputs && inputUType === INPUT_PRESET.X && inputVType === INPUT_PRESET.ZERO;
    const hasKernel = kernelKind !== TRANSFORM_KERNEL.CALL;
    const kernelOut = hasKernel ? (config.kernelOut || (config.kernelOut = new Float64Array(2))) : null;

    for (let j = 0; j <= segments; j += 1) {
        const yVal = yMin + j * yScale;
        for (let i = 0; i <= segments; i += 1) {
            const xVal = xMin + i * xScale;
            let zInRe;
            let zInIm;
            if (fastXY) {
                zInRe = xVal;
                zInIm = yVal;
            } else if (fastX0) {
                zInRe = xVal;
                zInIm = 0;
            } else if (scalarInputs) {
                zInRe = evalScalarInput(inputUType, xVal, yVal);
                zInIm = evalScalarInput(inputVType, xVal, yVal);
            } else {
                inputU.write(xVal, yVal, u);
                inputV.write(xVal, yVal, v);
                zInRe = u[0] - v[1];
                zInIm = u[1] + v[0];
            }

            let rawValue = invalidValue;
            let phase = 0.5;
            if (hasKernel) {
                let outRe;
                let outIm;
                switch (kernelKind) {
                    case TRANSFORM_KERNEL.IDENTITY:
                        outRe = zInRe; outIm = zInIm; break;
                    case TRANSFORM_KERNEL.SQUARE:
                        outRe = zInRe * zInRe - zInIm * zInIm; outIm = 2 * zInRe * zInIm; break;
                    case TRANSFORM_KERNEL.RECIPROCAL: {
                        writeReciprocalKernel(zInRe, zInIm, kernelOut);
                        outRe = kernelOut[0];
                        outIm = kernelOut[1];
                        break;
                    }
                    case TRANSFORM_KERNEL.EXP: {
                        const expRe = expSafeForPlot(zInRe);
                        outRe = expRe * Math.cos(zInIm); outIm = expRe * Math.sin(zInIm); break;
                    }
                    case TRANSFORM_KERNEL.SIN:
                        outRe = Math.sin(zInRe) * Math.cosh(zInIm); outIm = Math.cos(zInRe) * Math.sinh(zInIm); break;
                    case TRANSFORM_KERNEL.COS:
                        outRe = Math.cos(zInRe) * Math.cosh(zInIm); outIm = -Math.sin(zInRe) * Math.sinh(zInIm); break;
                    default:
                        outRe = 0; outIm = 0;
                }
                if (isFiniteNumber(outRe) && isFiniteNumber(outIm)) {
                    finiteResultCount += 1;
                    rawValue = selectRawValue(outRe, outIm, outputMode);
                    if (usePhaseColor) phase = (Math.atan2(outIm, outRe) + Math.PI) * INV_TWO_PI;
                }
            } else if (catchPerVertex) {
                try {
                    const result = transformFunc(zInRe, zInIm);
                    if (result && isFiniteNumber(result.re) && isFiniteNumber(result.im)) {
                        finiteResultCount += 1;
                        rawValue = selectRawValue(result.re, result.im, outputMode);
                        if (usePhaseColor) phase = (Math.atan2(result.im, result.re) + Math.PI) * INV_TWO_PI;
                    }
                } catch {
                    rawValue = invalidValue;
                    phase = 0.5;
                }
            } else {
                const result = transformFunc(zInRe, zInIm);
                if (result && isFiniteNumber(result.re) && isFiniteNumber(result.im)) {
                    finiteResultCount += 1;
                    rawValue = selectRawValue(result.re, result.im, outputMode);
                    if (usePhaseColor) phase = (Math.atan2(result.im, result.re) + Math.PI) * INV_TWO_PI;
                }
            }

            values[vertex] = rawValue;
            if (phases) phases[vertex] = phase;
            if (isFiniteNumber(rawValue)) {
                if (rawValue < minZ) minZ = rawValue;
                if (rawValue > maxZ) maxZ = rawValue;
            }
            vertex += 1;
        }
    }

    return { minZ, maxZ, finiteResultCount };
}


export function sampleRealPlotSurface(transformFunc, options = {}) {
    const segments = Math.max(1, Math.floor(Number(options.segments) || DEFAULT_SAMPLE_SEGMENTS));
    const valuesOnly = options.valuesOnly === true;
    const topology = valuesOnly ? null : options.topology || topologyFor(segments);
    const stride = segments + 1;
    const vertexCount = valuesOnly ? stride * stride : topology.vertexCount;
    const positions = valuesOnly ? null : options.positions || new Float32Array(vertexCount * 3);
    const normals = valuesOnly ? null : options.normals || new Float32Array(vertexCount * 3);
    const colors = valuesOnly ? null : options.colors || new Float32Array(vertexCount * 3);
    const rawValues = valuesOnly ? null : options.rawValues || new Float32Array(vertexCount);
    const values = options.values || new Float64Array(vertexCount);
    const phases = valuesOnly ? null : options.phases || new Float32Array(vertexCount);
    const u = options.u || new Float64Array(2);
    const v = options.v || new Float64Array(2);
    const xRange = options.xRange || zPlaneParams.currentVisXRange;
    const yRange = options.yRange || zPlaneParams.currentVisYRange;
    const xMin = xRange[0];
    const yMin = yRange[0];
    const xScale = (xRange[1] - xMin) / segments;
    const yScale = (yRange[1] - yMin) / segments;
    const inputU = InputEvaluator.for(options.inputExpr ?? state.realPlotsInputExpr);
    const inputV = InputEvaluator.for(options.imagExpr ?? state.realPlotsImagExpr);
    const inputUType = inputU.type;
    const inputVType = inputV.type;
    const scalarInputs = isScalarInputType(inputUType) && isScalarInputType(inputVType);
    const outputMode = outputComponentMode(options.outputComponent ?? state.realPlotsOutputComponent);
    const invalidValue = options.invalidAsNaN === true ? NaN : 0;
    const heightScale = options.heightScale !== undefined
        ? options.heightScale
        : state.realPlotsHeightScale !== undefined ? state.realPlotsHeightScale : 1.0;
    const usePhaseColor = (options.colorMode ?? state.realPlotsColorMode) === 'phase';
    const paletteLut = paletteLutFor(options.palette || state.realPlotsPalette || 'sunset');
    const heightFactor = (HALF_HEIGHT * heightScale) / CLAMP_LIMIT;
    const kernelKind = transformKernelKind(transformFunc);

    const config = {
        segments, values, phases, u, v, xMin, yMin, xScale, yScale,
        inputU, inputV, inputUType, inputVType, scalarInputs, outputMode, invalidValue,
        usePhaseColor, kernelKind
    };

    let sample;
    try {
        sample = sampleValuesPass(transformFunc, config, false);
    } catch {
        sample = sampleValuesPass(transformFunc, config, true);
    }

    const minValue = sample.finiteResultCount > 0 ? sample.minZ : NaN;
    const maxValue = sample.finiteResultCount > 0 ? sample.maxZ : NaN;

    if (valuesOnly) {
        return {
            segments,
            vertexCount,
            values,
            minValue,
            maxValue,
            finiteResultCount: sample.finiteResultCount
        };
    }

    finishSampleGeometry({
        segments,
        vertexCount,
        topology,
        positions,
        normals,
        colors,
        rawValues,
        values,
        phases,
        minZ: sample.finiteResultCount > 0 ? sample.minZ : 0,
        maxZ: sample.finiteResultCount > 0 ? sample.maxZ : 0,
        usePhaseColor,
        paletteLut,
        heightFactor
    });

    return {
        segments,
        vertexCount,
        positions,
        normals,
        colors,
        values,
        rawValues,
        phases,
        minValue,
        maxValue,
        finiteResultCount: sample.finiteResultCount
    };
}

class RealPlots3DRenderer {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(BACKGROUND, 0.028);

        this.camera = new THREE.PerspectiveCamera(38, 1, 0.08, 120);
        this.camera.position.set(CAMERA_HOME.x, CAMERA_HOME.y, CAMERA_HOME.z);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
            stencil: false,
            depth: true
        });
        this.renderer.setClearColor(BACKGROUND);
        this.#syncPixelRatio();
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.08;
        this.container.replaceChildren(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = false;
        this.controls.dampingFactor = 0.05;
        this.controls.enablePan = true;
        this.controls.enableZoom = true;
        this.controls.zoomToCursor = true;
        this.controls.target.set(0, 0, 0);
        this.controls.minDistance = 0.1;
        this.controls.maxDistance = 200;
        this.controls.update();
        this.controls.addEventListener('change', () => {
            this.#syncMathCameraTarget();
            this.render();
        });

        this.surfaceGroup = new THREE.Group();
        this.scene.add(this.surfaceGroup);
        this.surfaceStore = new SurfaceMeshStore(RENDER_SEGMENTS);
        this.surfaceGroup.add(this.surfaceStore.mesh, this.surfaceStore.wireframe);

        this.zLabelText = '';
        this.coordBoundsKey = '';
        this.addReferenceFrame();
        this.renderer.domElement.addEventListener('dblclick', () => this.resetCamera());

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
        this.resize();

        this.render();
    }

    #syncPixelRatio() {
        const ratio = window.devicePixelRatio || 1;
        this.renderer.setPixelRatio(Math.min(ratio, 2.75));
    }

    #syncMathCameraTarget() {
        const target = this.controls.target;
        if (Math.abs(target.x) > 0.001 || Math.abs(target.z) > 0.001) {
            const xSpan = zPlaneParams.currentVisXRange[1] - zPlaneParams.currentVisXRange[0];
            const ySpan = zPlaneParams.currentVisYRange[1] - zPlaneParams.currentVisYRange[0];
            const mathOffsetX = (target.x / SURFACE_SIZE) * xSpan;
            const mathOffsetY = (target.z / SURFACE_SIZE) * ySpan;
            const zWorldCenterX = (zPlaneParams.currentVisXRange[0] + zPlaneParams.currentVisXRange[1]) * 0.5;
            const zWorldCenterY = (zPlaneParams.currentVisYRange[0] + zPlaneParams.currentVisYRange[1]) * 0.5;
            state.realPlotsCameraTargetMath = {
                x: zWorldCenterX + mathOffsetX,
                y: zWorldCenterY - mathOffsetY
            };
        } else {
            state.realPlotsCameraTargetMath = null;
        }
    }

    createCoordinateLabel(color) {
        const canvas = document.createElement('canvas');
        canvas.width = 768;
        canvas.height = 192;
        const context = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthWrite: false
        }));
        sprite.scale.set(2.15, 0.54, 1);

        return {
            sprite,
            canvas,
            context,
            texture,
            text: '',
            updateText(text) {
                if (text === this.text) return;
                this.text = text;
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.font = '600 64px "STIX Two Math", "Cambria Math", serif';
                context.textAlign = 'center';
                context.textBaseline = 'middle';
                context.shadowColor = 'rgba(0, 0, 0, 0.65)';
                context.shadowBlur = 18;
                context.fillStyle = color;
                context.fillText(text, 384, 96);
                texture.needsUpdate = true;
            }
        };
    }

    addReferenceFrame() {
        const grid = new THREE.GridHelper(8, 32, 0x5b5f92, 0x242846);
        grid.position.y = -HALF_HEIGHT - 0.01;
        this.scene.add(grid);

        const floorGeo = new THREE.PlaneGeometry(34, 34);
        const floorMat = new THREE.ShadowMaterial({ opacity: 0.32 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -HALF_HEIGHT - 0.025;
        floor.receiveShadow = true;
        this.scene.add(floor);

        const xLabel = makeAxisLabel('x', 'rgba(232, 239, 255, 0.96)');
        xLabel.position.set(HALF_SURFACE + 0.4, -HALF_HEIGHT, 0);

        const yLabel = makeAxisLabel('y', 'rgba(232, 239, 255, 0.96)');
        yLabel.position.set(0, -HALF_HEIGHT, HALF_SURFACE + 0.4);

        this.zLabel = makeAxisLabel('z = Re(f)', 'rgba(232, 239, 255, 0.96)');
        this.zLabel.position.set(0, HALF_HEIGHT + 0.4, 0);
        this.zLabelText = 'z = Re(f)';
        this.scene.add(xLabel, yLabel, this.zLabel);

        this.coordLabels = {
            bottomLeft: this.createCoordinateLabel('rgba(232, 239, 255, 0.68)'),
            bottomRight: this.createCoordinateLabel('rgba(232, 239, 255, 0.68)'),
            topLeft: this.createCoordinateLabel('rgba(232, 239, 255, 0.68)'),
            topRight: this.createCoordinateLabel('rgba(232, 239, 255, 0.68)')
        };

        const yLevel = -HALF_HEIGHT - 0.05;
        const offset = 0.55;
        this.coordLabels.bottomLeft.sprite.position.set(-HALF_SURFACE - offset, yLevel, -HALF_SURFACE - offset);
        this.coordLabels.bottomRight.sprite.position.set(HALF_SURFACE + offset, yLevel, -HALF_SURFACE - offset);
        this.coordLabels.topLeft.sprite.position.set(-HALF_SURFACE - offset, yLevel, HALF_SURFACE + offset);
        this.coordLabels.topRight.sprite.position.set(HALF_SURFACE + offset, yLevel, HALF_SURFACE + offset);
        this.scene.add(
            this.coordLabels.bottomLeft.sprite,
            this.coordLabels.bottomRight.sprite,
            this.coordLabels.topLeft.sprite,
            this.coordLabels.topRight.sprite
        );

        this.#addLights();
    }

    #addLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.18));
        this.scene.add(new THREE.HemisphereLight(0xb8c7ff, 0x05040a, 1.6));

        const keyLight = new THREE.DirectionalLight(0xfff4ea, 4.1);
        keyLight.position.set(6.5, 12.5, 7.5);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = 4096;
        keyLight.shadow.mapSize.height = 4096;
        keyLight.shadow.camera.near = 0.35;
        keyLight.shadow.camera.far = 34;
        keyLight.shadow.camera.left = -7;
        keyLight.shadow.camera.right = 7;
        keyLight.shadow.camera.top = 7;
        keyLight.shadow.camera.bottom = -7;
        keyLight.shadow.bias = -0.00012;
        this.scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0x8ec5ff, 1.15);
        fillLight.position.set(-5, 5, 4);
        this.scene.add(fillLight);

        const rimLight = new THREE.DirectionalLight(0x60a5fa, 2.1);
        rimLight.position.set(-7, 4.5, -7);
        this.scene.add(rimLight);

        if (THREE.RectAreaLight) {
            const areaLight = new THREE.RectAreaLight(0xffffff, 2.2, 7, 4);
            areaLight.position.set(0, 5.5, -5);
            areaLight.lookAt?.(0, 0, 0);
            this.scene.add(areaLight);
        }
    }

    resetCamera() {
        this.camera.position.set(CAMERA_HOME.x, CAMERA_HOME.y, CAMERA_HOME.z);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    resize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (!width || !height) return;
        this.#syncPixelRatio();
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        this.render();
    }

    updateSurface(transformFunc, surfaceKey) {
        if (state.realPlotsCameraNeedsReset) {
            this.camera.position.x -= this.controls.target.x;
            this.camera.position.z -= this.controls.target.z;
            this.controls.target.set(0, 0, 0);
            this.controls.update();
            state.realPlotsCameraNeedsReset = false;
        }

        const store = this.surfaceStore;
        store.contourUniforms.uContoursEnabled.value = state.contoursEnabled ? 1.0 : 0.0;
        store.contourUniforms.uContourInterval.value = state.contourInterval !== undefined ? +state.contourInterval : 0.5;
        store.contourUniforms.uContourThickness.value = state.contourThickness !== undefined ? +state.contourThickness : 1.5;

        if (surfaceKey && surfaceKey === this.surfaceKey) {
            this.render();
            return;
        }

        this.#syncOutputLabel();
        this.#syncCoordinateLabels();
        this.#sampleSurface(transformFunc);
        this.surfaceKey = surfaceKey;
        this.surfaceStore.markDirty();
        this.render();
    }

    #syncOutputLabel() {
        const labelText = outputAxisLabel(state.realPlotsOutputComponent);
        if (labelText === this.zLabelText) return;
        this.scene.remove(this.zLabel);
        this.zLabel.material.map?.dispose?.();
        this.zLabel.material.dispose?.();
        this.zLabel = makeAxisLabel(labelText, 'rgba(232, 239, 255, 0.96)');
        this.zLabel.position.set(0, HALF_HEIGHT + 0.4, 0);
        this.zLabelText = labelText;
        this.scene.add(this.zLabel);
    }

    #syncCoordinateLabels() {
        const xMin = zPlaneParams.currentVisXRange[0];
        const xMax = zPlaneParams.currentVisXRange[1];
        const yMin = zPlaneParams.currentVisYRange[0];
        const yMax = zPlaneParams.currentVisYRange[1];
        const boundsKey = `${xMin}|${xMax}|${yMin}|${yMax}`;
        if (boundsKey === this.coordBoundsKey) return;
        this.coordBoundsKey = boundsKey;
        const fXMin = formatCoord(xMin);
        const fXMax = formatCoord(xMax);
        const fYMin = formatCoord(yMin);
        const fYMax = formatCoord(yMax);
        this.coordLabels.bottomLeft.updateText(`(${fXMin}, ${fYMin})`);
        this.coordLabels.bottomRight.updateText(`(${fXMax}, ${fYMin})`);
        this.coordLabels.topLeft.updateText(`(${fXMin}, ${fYMax})`);
        this.coordLabels.topRight.updateText(`(${fXMax}, ${fYMax})`);
    }

    #sampleSurface(transformFunc) {
        const store = this.surfaceStore;
        const result = sampleRealPlotSurface(transformFunc, {
            segments: store.segments,
            topology: store.topology,
            positions: store.positions,
            normals: store.normals,
            colors: store.colors,
            rawValues: store.rawValues,
            values: store.values,
            phases: store.phases,
            u: store.u,
            v: store.v
        });
        store.minValue = result.minValue;
        store.maxValue = result.maxValue;
    }

    dispose() {
        this.resizeObserver?.disconnect();
        this.controls.dispose();
        this.surfaceStore?.dispose();
        disposeObject(this.scene);
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}

export function drawRealPlot() {
    const container3d = document.getElementById('real_plots_3d_container');
    if (!active3DRenderer && container3d) {
        active3DRenderer = new RealPlots3DRenderer(container3d);
    }

    const transformFunc = getChainedTransformFunction(state.currentFunction);
    active3DRenderer?.updateSurface(transformFunc, realPlotSurfaceKey());
}

export function disposeRealPlotsRenderer() {
    if (active3DRenderer) {
        active3DRenderer.dispose();
        active3DRenderer = null;
    }
}
