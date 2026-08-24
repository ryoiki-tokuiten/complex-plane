import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { state, zPlaneParams } from '../store/state.js';
import { buildMappedTransformProfileKey, getMappedTransformProfile } from '../native/map-runtime.js';
import { parseExpression } from '../math/expression/parser.js';
import {
    buildNativeRealSurface,
    compileNativeExpressionProgram,
    nativeMapOptions,
    renderNativeRealContour
} from '../native/complex-engine.js';
import {
    MAX_STATE_ZOOM_LEVEL,
    MIN_STATE_ZOOM_LEVEL,
    ZOOM_IN_FACTOR,
    ZOOM_OUT_FACTOR
} from '../constants/numerical.js';
import { setupVisualParameters } from '../utils/dom-utils.js';
import { requestUiRedraw } from './redraw-scheduler.js';
import { disposeThreeObject } from './three-utils.js';
import { requireVisibleViewport } from '../utils/viewport.js';
import { requireFiniteNumber, requireInteger } from '../utils/numeric-contracts.js';

const BACKGROUND = 0x070812;
const CAMERA_HOME = Object.freeze({ x: 6.0, y: 5.0, z: 8.0 });
const SURFACE_SIZE = 6.0;
const SURFACE_HEIGHT = 3.5;
const DEFAULT_SAMPLE_SEGMENTS = 96;
const RENDER_SEGMENTS = 192;
const HALF_SURFACE = SURFACE_SIZE * 0.5;
const HALF_HEIGHT = SURFACE_HEIGHT * 0.5;
const PALETTE_LUT_SIZE = 1024;

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

const PALETTE_HEX = Object.freeze({
    ocean: [0x001b2e, 0x005f73, 0x0a9396, 0x94d2bd, 0xe9d8a6],
    cyberpunk: [0x11001c, 0x3a0ca3, 0xf72585, 0x4cc9f0, 0xfaff00],
    copper: [0x170f0a, 0x5c2e12, 0xb85c24, 0xf6aa52, 0xffecd1],
    forest: [0x03190e, 0x0b3d20, 0x2d6a4f, 0x95d5b2, 0xfff3b0],
    viridis: [0x440154, 0x3b528b, 0x21908d, 0x5dc963, 0xfde725],
    sunset: [0x12001f, 0x3c096c, 0x9d174d, 0xf97316, 0xfef3c7]
});

export let active3DRenderer = null;

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
    if (!Array.isArray(hexStops) || hexStops.length < 2) {
        throw new Error('Real-plot palettes require at least two color stops.');
    }
    const lut = new Float32Array(PALETTE_LUT_SIZE * 3);
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

function paletteLutFor(name) {
    const palette = PALETTE_LUTS[name];
    if (!palette) throw new Error(`Unsupported real-plot palette: ${name}.`);
    return palette;
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

function canonicalExpression(expression) {
    return String(expression ?? '')
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

export function validateRealPlotExpression(expression) {
    const source = String(expression ?? '').trim();
    if (!source) return 'Expression cannot be empty';
    try {
        compileNativeExpressionProgram(parseExpression(source), ['x', 'y']);
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : 'Invalid expression';
    }
}

class SurfaceMeshStore {
    constructor(segments = RENDER_SEGMENTS) {
        this.segments = Math.max(1, segments | 0);
        this.vertexCount = (this.segments + 1) ** 2;
        this.indices = new Uint32Array(this.segments * this.segments * 6);
        this.positions = new Float32Array(this.vertexCount * 3);
        this.normals = new Float32Array(this.vertexCount * 3);
        this.colors = new Float32Array(this.vertexCount * 3);
        this.rawValues = new Float32Array(this.vertexCount);

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
        geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));
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

    setIndices(indices) {
        if (!indices || indices === this.indices) return;
        this.indices = indices;
        this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
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
    if (component === 'real') return OUTPUT_COMPONENT.REAL;
    if (component === 'imag') return OUTPUT_COMPONENT.IMAG;
    if (component === 'magnitude') return OUTPUT_COMPONENT.MAGNITUDE;
    throw new Error(`Unsupported real-plot component: ${component}.`);
}

function outputAxisLabel(component) {
    if (component === 'real') return 'z = Re(f)';
    if (component === 'imag') return 'z = Im(f)';
    if (component === 'magnitude') return 'z = |f|';
    throw new Error(`Unsupported real-plot component: ${component}.`);
}

function realPlotSurfaceKey() {
    requireVisibleViewport(zPlaneParams, 'Real-plot viewport');
    const xRange = zPlaneParams.currentVisXRange;
    const yRange = zPlaneParams.currentVisYRange;
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

function expressionProgram(source, preset) {
    if (preset !== INPUT_PRESET.GENERIC) return null;
    return compileNativeExpressionProgram(parseExpression(String(source)), ['x', 'y']);
}

function resolveRealPlotDefinition(options) {
    const inputExpr = options.inputExpr ?? state.realPlotsInputExpr;
    const imagExpr = options.imagExpr ?? state.realPlotsImagExpr;
    const inputUPreset = presetType(inputExpr);
    const inputVPreset = presetType(imagExpr);
    const activeMap = getMappedTransformProfile(state.currentFunction);
    return {
        mapOptions: nativeMapOptions(state, {
            ...activeMap.nativeMapOptions,
            ...options.mapOptions
        }),
        xRange: options.xRange ?? zPlaneParams.currentVisXRange,
        yRange: options.yRange ?? zPlaneParams.currentVisYRange,
        inputUPreset,
        inputVPreset,
        inputUProgram: expressionProgram(inputExpr, inputUPreset),
        inputVProgram: expressionProgram(imagExpr, inputVPreset),
        component: outputComponentMode(options.outputComponent ?? state.realPlotsOutputComponent),
        palette: paletteLutFor(options.palette ?? state.realPlotsPalette)
    };
}

export function buildRealPlotSurface(options = {}) {
    const segments = requireInteger(options.segments ?? DEFAULT_SAMPLE_SEGMENTS, 'Real-plot segment count');
    if (segments < 1) throw new Error('Real-plot segment count must be positive.');
    const definition = resolveRealPlotDefinition(options);
    return buildNativeRealSurface({
        ...definition,
        segments,
        heightScale: options.heightScale ?? state.realPlotsHeightScale,
        phaseColor: (options.colorMode ?? state.realPlotsColorMode) === 'phase',
        valuesOnly: options.valuesOnly === true
    });
}

export function renderRealPlotContour(options = {}) {
    const contourInterval = requireFiniteNumber(
        options.contourInterval ?? state.contourInterval,
        'Real-plot contour interval'
    );
    const contourThickness = requireFiniteNumber(
        options.contourThickness ?? state.contourThickness,
        'Real-plot contour thickness'
    );
    if (contourInterval <= 0 || contourThickness <= 0) {
        throw new Error('Real-plot contour interval and thickness must be positive.');
    }
    return renderNativeRealContour({
        ...resolveRealPlotDefinition(options),
        width: requireInteger(options.width, 'Real-plot contour width'),
        height: requireInteger(options.height, 'Real-plot contour height'),
        contoursEnabled: options.contoursEnabled ?? state.contoursEnabled,
        contourInterval,
        contourThickness
    });
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
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.08;
        this.container.replaceChildren(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = false;
        this.controls.enablePan = true;
        // Wheel zoom changes the mathematical viewport below, never the camera.
        this.controls.enableZoom = false;
        this.controls.target.set(0, 0, 0);
        this.controls.minDistance = 0.1;
        this.controls.maxDistance = 200;
        this.controls.update();
        this.controls.addEventListener('change', () => this.render());

        this.coordinateWheelHandler = event => this.#zoomCoordinates(event);
        this.renderer.domElement.addEventListener('wheel', this.coordinateWheelHandler, { passive: false });

        this.surfaceGroup = new THREE.Group();
        this.scene.add(this.surfaceGroup);
        this.surfaceStore = new SurfaceMeshStore(RENDER_SEGMENTS);
        this.surfaceGroup.add(this.surfaceStore.mesh, this.surfaceStore.wireframe);

        this.zLabelText = '';
        this.coordBoundsKey = '';
        this.addReferenceFrame();

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
        this.resize();

        this.render();
    }

    #syncPixelRatio() {
        const ratio = window.devicePixelRatio || 1;
        this.renderer.setPixelRatio(Math.min(ratio, 2.75));
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

    #zoomCoordinates(event) {
        event.preventDefault();

        const deltaY = Number(event.deltaY);
        if (!Number.isFinite(deltaY) || deltaY === 0) return;

        const oldZoom = Number(state.zPlaneZoom);
        if (!Number.isFinite(oldZoom) || oldZoom <= 0) {
            throw new Error('Real-plot coordinate zoom must be positive and finite.');
        }
        const currentZoom = oldZoom;
        const factor = deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
        const nextZoom = Math.max(
            MIN_STATE_ZOOM_LEVEL,
            Math.min(MAX_STATE_ZOOM_LEVEL, currentZoom * factor)
        );
        if (nextZoom === currentZoom) return;

        state.zPlaneZoom = nextZoom;
        // Use the same single viewport path as the z-plane slider. This keeps
        // the state value, coordinate bounds, and surface samples consistent.
        setupVisualParameters(true, false);
        requestUiRedraw();
    }

    updateSurface(surfaceKey) {
        const store = this.surfaceStore;
        store.contourUniforms.uContoursEnabled.value = state.contoursEnabled ? 1.0 : 0.0;
        const contourInterval = requireFiniteNumber(state.contourInterval, 'Real-plot contour interval');
        const contourThickness = requireFiniteNumber(state.contourThickness, 'Real-plot contour thickness');
        if (contourInterval <= 0 || contourThickness <= 0) {
            throw new Error('Real-plot contour interval and thickness must be positive.');
        }
        store.contourUniforms.uContourInterval.value = contourInterval;
        store.contourUniforms.uContourThickness.value = contourThickness;

        if (surfaceKey && surfaceKey === this.surfaceKey) {
            this.render();
            return;
        }

        this.#syncOutputLabel();
        this.#syncCoordinateLabels();
        this.#sampleSurface();
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

    #sampleSurface() {
        const store = this.surfaceStore;
        const result = buildRealPlotSurface({ segments: store.segments });
        store.positions.set(result.positions);
        store.normals.set(result.normals);
        store.colors.set(result.colors);
        store.rawValues.set(result.rawValues);
        store.setIndices(result.indices);
        store.minValue = result.minValue;
        store.maxValue = result.maxValue;
    }

    dispose() {
        this.resizeObserver?.disconnect();
        this.renderer.domElement.removeEventListener('wheel', this.coordinateWheelHandler);
        this.controls.dispose();
        this.surfaceStore?.dispose();
        disposeThreeObject(this.scene);
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}

export function drawRealPlot() {
    const container3d = document.getElementById('real_plots_3d_container');
    if (!active3DRenderer && container3d) {
        active3DRenderer = new RealPlots3DRenderer(container3d);
    }

    active3DRenderer?.updateSurface(realPlotSurfaceKey());
}

export function disposeRealPlotsRenderer() {
    if (active3DRenderer) {
        active3DRenderer.dispose();
        active3DRenderer = null;
    }
}
