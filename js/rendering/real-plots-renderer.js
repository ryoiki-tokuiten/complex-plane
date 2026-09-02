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
import { REAL_SURFACE_FRAME } from '../constants/surface-rendering.js';
import { paletteLutFor } from '../constants/surface-palettes.js';
import { setupVisualParameters } from '../utils/dom-utils.js';
import { requestUiRedraw } from './redraw-scheduler.js';
import { clearThreeGroup, createCanvasTextSprite, disposeThreeObject } from './three-utils.js';
import { requireVisibleViewport } from '../utils/viewport.js';
import { requireFiniteNumber, requireInteger } from '../utils/numeric-contracts.js';
import { getCanvasBackgroundColor } from '../frontend/theme.js';

const BACKGROUND = 0x070812;
const DEFAULT_CAMERA = Object.freeze({ x: 6.0, y: 5.0, z: 8.0 });
const DEFAULT_CAMERA_TARGET = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_FRAME = Object.freeze({
    width: 6,
    depth: 6,
    yMin: -1.75,
    yMax: 1.75,
    floorY: -1.75
});
const rendererByContainer = new WeakMap();

export function applySurfaceCoordinateZoom(event, currentZoom, updateZoom) {
    event.preventDefault();
    const deltaY = Number(event.deltaY);
    if (!Number.isFinite(deltaY) || deltaY === 0) return;

    const oldZoom = requireFiniteNumber(currentZoom, 'Surface coordinate zoom');
    if (oldZoom <= 0) throw new Error('Surface coordinate zoom must be positive.');
    const factor = deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
    const nextZoom = Math.max(
        MIN_STATE_ZOOM_LEVEL,
        Math.min(MAX_STATE_ZOOM_LEVEL, oldZoom * factor)
    );
    if (nextZoom !== oldZoom) updateZoom(nextZoom, oldZoom);
}

function makeAxisLabel(text, color, scale = [1.35, 0.5, 1]) {
    return createCanvasTextSprite(THREE, text, {
        color,
        scale,
        fontSize: 58,
        shadowColor: 'rgba(0, 0, 0, 0.55)',
        shadowBlur: 14
    });
}

function formatCoord(value) {
    if (Math.abs(value) < 1e-10) return '0';
    if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) return value.toExponential(2);
    const text = value.toFixed(2);
    return text.endsWith('.00') ? text.slice(0, -3) : text;
}

function normalizeArray(value, Type, label) {
    if (!(value instanceof Type)) {
        throw new Error(`${label} must be a ${Type.name}.`);
    }
    return value;
}

class SurfaceMeshStore {
    constructor() {
        this.contourUniforms = {
            uContoursEnabled: { value: 0.0 },
            uContourInterval: { value: 0.5 },
            uContourThickness: { value: 1.5 }
        };
        this.geometry = null;
        this.material = this.#createSurfaceMaterial();
        this.wireMaterial = this.#createWireMaterial();
        const initialGeometry = new THREE.BufferGeometry();
        this.geometry = initialGeometry;
        this.mesh = new THREE.Mesh(initialGeometry, this.material);
        this.wireframe = new THREE.Mesh(initialGeometry, this.wireMaterial);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.wireframe.renderOrder = 2;
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

        material.onBeforeCompile = shader => {
            shader.uniforms.uContoursEnabled = contourUniforms.uContoursEnabled;
            shader.uniforms.uContourInterval = contourUniforms.uContourInterval;
            shader.uniforms.uContourThickness = contourUniforms.uContourThickness;

            shader.vertexShader =
                'attribute float contourValue;\nvarying float v_contourValue;\nvarying vec3 v_worldNormalFast;\n' +
                shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <beginnormal_vertex>',
                `#include <beginnormal_vertex>
                v_worldNormalFast = normalize(normalMatrix * objectNormal);`
            );
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                v_contourValue = contourValue;`
            );

            shader.fragmentShader =
                'varying float v_contourValue;\nvarying vec3 v_worldNormalFast;\nuniform float uContoursEnabled;\nuniform float uContourInterval;\nuniform float uContourThickness;\n' +
                shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <dithering_fragment>',
                `#include <dithering_fragment>
                vec3 viewRimNormal = normalize(v_worldNormalFast);
                float fresnelBoost = pow(1.0 - clamp(abs(viewRimNormal.z), 0.0, 1.0), 2.6);
                gl_FragColor.rgb += vec3(0.08, 0.13, 0.20) * fresnelBoost;
                if (uContoursEnabled > 0.5) {
                    float valDeriv = length(vec2(dFdx(v_contourValue), dFdy(v_contourValue)));
                    if (valDeriv > 1.0e-6) {
                        float safeInterval = max(uContourInterval, 1.0e-6);
                        float contourCoord = v_contourValue / safeInterval;
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
        return new THREE.MeshBasicMaterial({
            color: 0xf4f8ff,
            transparent: true,
            opacity: 0.04,
            depthWrite: false,
            wireframe: true
        });
    }

    setData(data) {
        const positions = normalizeArray(data.positions, Float32Array, 'Surface positions');
        const normals = normalizeArray(data.normals, Float32Array, 'Surface normals');
        const colors = normalizeArray(data.colors, Float32Array, 'Surface colors');
        const contourValues = normalizeArray(data.contourValues, Float32Array, 'Surface contour values');
        const indices = normalizeArray(data.indices, Uint32Array, 'Surface indices');
        if (!positions.length || positions.length % 3 || normals.length !== positions.length ||
            colors.length !== positions.length || contourValues.length !== positions.length / 3) {
            throw new Error('Surface geometry attribute lengths are inconsistent.');
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('contourValue', new THREE.BufferAttribute(contourValues, 1));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        geometry.computeBoundingSphere?.();

        this.geometry?.dispose?.();
        this.geometry = geometry;
        this.mesh.geometry = geometry;
        this.wireframe.geometry = geometry;
    }

    setContours({ enabled, interval, thickness }) {
        const contourInterval = requireFiniteNumber(interval, 'Surface contour interval');
        const contourThickness = requireFiniteNumber(thickness, 'Surface contour thickness');
        if (contourInterval <= 0 || contourThickness <= 0) {
            throw new Error('Surface contour interval and thickness must be positive.');
        }
        this.contourUniforms.uContoursEnabled.value = enabled ? 1.0 : 0.0;
        this.contourUniforms.uContourInterval.value = contourInterval;
        this.contourUniforms.uContourThickness.value = contourThickness;
    }

    dispose() {
        this.geometry?.dispose?.();
        this.material.dispose?.();
        this.wireMaterial.dispose?.();
    }
}

class ScalarSurfaceRenderer {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
        const initialBg = new THREE.Color(getCanvasBackgroundColor());
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(initialBg, 0.028);

        this.camera = new THREE.PerspectiveCamera(38, 1, 0.08, 120);
        this.camera.position.set(DEFAULT_CAMERA.x, DEFAULT_CAMERA.y, DEFAULT_CAMERA.z);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
            stencil: false,
            depth: true
        });
        this.renderer.setClearColor(initialBg);
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
        this.controls.enableZoom = options.coordinateWheelZoom ? false : true;
        this.controls.target.set(DEFAULT_CAMERA_TARGET.x, DEFAULT_CAMERA_TARGET.y, DEFAULT_CAMERA_TARGET.z);
        this.controls.minDistance = 0.1;
        this.controls.maxDistance = 200;
        this.controls.update();
        this.controls.addEventListener('change', () => this.render());

        this.coordinateWheelHandler = options.coordinateWheelZoom
            ? event => options.coordinateWheelZoom(event)
            : null;
        if (this.coordinateWheelHandler) {
            this.renderer.domElement.addEventListener('wheel', this.coordinateWheelHandler, { passive: false });
        }
        this.renderer.domElement.addEventListener('dblclick', () => this.resetCamera());

        this.surfaceGroup = new THREE.Group();
        this.frameGroup = new THREE.Group();
        this.overlayGroup = new THREE.Group();
        this.scene.add(this.surfaceGroup, this.frameGroup, this.overlayGroup);

        this.surfaceStore = new SurfaceMeshStore();
        this.surfaceGroup.add(this.surfaceStore.mesh, this.surfaceStore.wireframe);
        this.frameKey = '';
        this.overlayKey = '';
        this.geometryKey = null;
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
        this.resize();
        this.#addLights();
        this.render();
    }

    #syncPixelRatio() {
        const ratio = window.devicePixelRatio || 1;
        this.renderer.setPixelRatio(Math.min(ratio, 2.75));
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

    #buildFrame(frame = DEFAULT_FRAME) {
        clearThreeGroup(this.frameGroup);
        const width = requireFiniteNumber(frame.width, 'Surface frame width');
        const depth = requireFiniteNumber(frame.depth, 'Surface frame depth');
        const yMin = requireFiniteNumber(frame.yMin, 'Surface frame minimum height');
        const yMax = requireFiniteNumber(frame.yMax, 'Surface frame maximum height');
        const floorY = requireFiniteNumber(frame.floorY ?? yMin, 'Surface frame floor height');
        if (width <= 0 || depth <= 0 || yMin >= yMax) throw new Error('Surface frame dimensions are invalid.');

        const grid = new THREE.GridHelper(Math.max(width, depth) * 1.5, 32, 0x5b5f92, 0x242846);
        grid.position.y = floorY - 0.01;
        this.frameGroup.add(grid);

        const floorGeometry = new THREE.PlaneGeometry(Math.max(width, depth) * 5.5, Math.max(width, depth) * 5.5);
        const floor = new THREE.Mesh(floorGeometry, new THREE.ShadowMaterial({ opacity: 0.32 }));
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = floorY - 0.025;
        floor.receiveShadow = true;
        this.frameGroup.add(floor);

        const axisLabels = frame.axisLabels ?? {};
        const axisColor = 'rgba(232, 239, 255, 0.96)';
        const xLabel = makeAxisLabel(axisLabels.x ?? 'x', axisColor);
        xLabel.position.set(width * 0.5 + 0.4, floorY, 0);
        const zLabel = makeAxisLabel(axisLabels.z ?? 'y', axisColor);
        zLabel.position.set(0, floorY, depth * 0.5 + 0.4);
        const yLabel = makeAxisLabel(axisLabels.y ?? 'z', axisColor);
        yLabel.position.set(0, yMax + 0.4, 0);
        this.frameGroup.add(xLabel, zLabel, yLabel);

        const bounds = frame.coordinateBounds;
        if (bounds?.xRange && bounds?.zRange) {
            this.coordinateLabels = {
                bottomLeft: this.#createCoordinateLabel('rgba(232, 239, 255, 0.68)'),
                bottomRight: this.#createCoordinateLabel('rgba(232, 239, 255, 0.68)'),
                topLeft: this.#createCoordinateLabel('rgba(232, 239, 255, 0.68)'),
                topRight: this.#createCoordinateLabel('rgba(232, 239, 255, 0.68)')
            };
            const yLevel = floorY - 0.05;
            const offset = 0.55;
            this.coordinateLabels.bottomLeft.sprite.position.set(-width * 0.5 - offset, yLevel, -depth * 0.5 - offset);
            this.coordinateLabels.bottomRight.sprite.position.set(width * 0.5 + offset, yLevel, -depth * 0.5 - offset);
            this.coordinateLabels.topLeft.sprite.position.set(-width * 0.5 - offset, yLevel, depth * 0.5 + offset);
            this.coordinateLabels.topRight.sprite.position.set(width * 0.5 + offset, yLevel, depth * 0.5 + offset);
            Object.values(this.coordinateLabels).forEach(label => this.frameGroup.add(label.sprite));
            this.coordinateBoundsKey = '';
            this.#syncCoordinateLabels(bounds);
        } else {
            this.coordinateLabels = null;
            this.coordinateBoundsKey = '';
        }
        this.frame = frame;
    }

    #createCoordinateLabel(color) {
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

    #syncCoordinateLabels(bounds) {
        if (!this.coordinateLabels) return;
        const xRange = bounds.xRange;
        const zRange = bounds.zRange;
        const boundsKey = `${xRange[0]}|${xRange[1]}|${zRange[0]}|${zRange[1]}`;
        if (boundsKey === this.coordinateBoundsKey) return;
        this.coordinateBoundsKey = boundsKey;
        const xMin = formatCoord(xRange[0]);
        const xMax = formatCoord(xRange[1]);
        const zMin = formatCoord(zRange[0]);
        const zMax = formatCoord(zRange[1]);
        this.coordinateLabels.bottomLeft.updateText(`(${xMin}, ${zMin})`);
        this.coordinateLabels.bottomRight.updateText(`(${xMax}, ${zMin})`);
        this.coordinateLabels.topLeft.updateText(`(${xMin}, ${zMax})`);
        this.coordinateLabels.topRight.updateText(`(${xMax}, ${zMax})`);
    }

    #addOverlays(overlays = []) {
        clearThreeGroup(this.overlayGroup);
        overlays.forEach(overlay => {
            if (overlay.type === 'line') {
                const geometry = new THREE.BufferGeometry().setFromPoints(
                    overlay.points.map(point => new THREE.Vector3(point[0], point[1], point[2]))
                );
                const Material = overlay.dashed ? THREE.LineDashedMaterial : THREE.LineBasicMaterial;
                const line = new THREE.Line(geometry, new Material({
                    color: overlay.color,
                    ...(overlay.dashed ? { dashSize: 0.15, gapSize: 0.09 } : {}),
                    transparent: true,
                    opacity: overlay.opacity ?? 0.8,
                    depthWrite: false
                }));
                if (overlay.dashed) line.computeLineDistances();
                this.overlayGroup.add(line);
                return;
            }
            if (overlay.type === 'plane') {
                const mesh = new THREE.Mesh(
                    new THREE.PlaneGeometry(overlay.width, overlay.depth),
                    new THREE.MeshBasicMaterial({
                        color: overlay.color,
                        transparent: true,
                        opacity: overlay.opacity ?? 0.08,
                        side: THREE.DoubleSide,
                        depthWrite: false
                    })
                );
                mesh.rotation.x = overlay.rotationX ?? -Math.PI / 2;
                mesh.position.set(...overlay.position);
                this.overlayGroup.add(mesh);
                return;
            }
            if (overlay.type === 'marker') {
                const geometry = overlay.shape === 'zero'
                    ? new THREE.TorusGeometry(0.12, 0.032, 8, 20)
                    : new THREE.OctahedronGeometry(0.14, 1);
                const marker = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: overlay.color }));
                if (overlay.shape === 'zero') marker.rotation.x = Math.PI * 0.5;
                marker.position.set(...overlay.position);
                this.overlayGroup.add(marker);
            }
        });
    }

    update(view) {
        if (!view || typeof view.buildGeometry !== 'function') {
            throw new Error('Scalar surface views require a geometry builder.');
        }
        if (view.geometryKey !== this.geometryKey) {
            this.surfaceStore.setData(view.buildGeometry());
            this.geometryKey = view.geometryKey;
        }
        if (view.frameKey !== this.frameKey) {
            this.#buildFrame(view.frame);
            this.frameKey = view.frameKey;
        } else if (view.frame?.coordinateBounds) {
            this.#syncCoordinateLabels(view.frame.coordinateBounds);
        }
        if (view.overlaysKey !== this.overlayKey) {
            this.#addOverlays(view.overlays);
            this.overlayKey = view.overlaysKey;
        }
        this.surfaceStore.setContours(view.contours ?? {
            enabled: false,
            interval: 0.5,
            thickness: 1.5
        });
        this.render();
    }

    resetCamera() {
        this.camera.position.set(DEFAULT_CAMERA.x, DEFAULT_CAMERA.y, DEFAULT_CAMERA.z);
        this.controls.target.set(DEFAULT_CAMERA_TARGET.x, DEFAULT_CAMERA_TARGET.y, DEFAULT_CAMERA_TARGET.z);
        this.controls.update();
        this.render();
    }

    resize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (!width || !height) return;
        this.#syncPixelRatio();
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
        this.render();
    }

    render() {
        const bg = new THREE.Color(getCanvasBackgroundColor());
        this.renderer.setClearColor(bg);
        if (this.scene.fog) this.scene.fog.color = bg;
        this.renderer.render(this.scene, this.camera);
    }

    dispose() {
        this.resizeObserver?.disconnect();
        if (this.coordinateWheelHandler) {
            this.renderer.domElement.removeEventListener('wheel', this.coordinateWheelHandler);
        }
        this.controls.dispose();
        this.surfaceStore.dispose();
        disposeThreeObject(this.scene);
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}

function requireContainer(container) {
    if (!container) throw new Error('A scalar surface container is required.');
    return container;
}

export function drawScalarSurface(container, view, rendererOptions = {}) {
    const target = requireContainer(typeof container === 'string' ? document.getElementById(container) : container);
    let renderer = rendererByContainer.get(target);
    if (!renderer) {
        renderer = new ScalarSurfaceRenderer(target, rendererOptions);
        rendererByContainer.set(target, renderer);
    }
    renderer.update(view);
}

export function resizeScalarSurface(container) {
    const target = typeof container === 'string' ? document.getElementById(container) : container;
    if (target) rendererByContainer.get(target)?.resize();
}

export function disposeScalarSurface(container) {
    const target = typeof container === 'string' ? document.getElementById(container) : container;
    if (!target) return;
    const renderer = rendererByContainer.get(target);
    if (!renderer) return;
    renderer.dispose();
    rendererByContainer.delete(target);
}

const DEFAULT_SAMPLE_SEGMENTS = 96;
const RENDER_SEGMENTS = 192;

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
    const funcKey = state.algebraicChainingEnabled ? 'algebraic_chaining' : state.currentFunction;
    return [
        buildMappedTransformProfileKey(funcKey),
        buildMappedTransformProfileKey('mobius'),
        buildMappedTransformProfileKey('polynomial'),
        buildMappedTransformProfileKey('algebraic_chaining'),
        state.algebraicChainingEnabled ? 1 : 0,
        state.chainingEnabled ? 1 : 0,
        state.chainCount,
        state.chainingMode,
        state.chainSeed?.re,
        state.chainSeed?.im,
        state.taylorSeriesEnabled ? 1 : 0,
        state.taylorSeriesOrder,
        state.taylorSeriesCenter?.re,
        state.taylorSeriesCenter?.im,
        state.realPlotsInputExpr,
        state.realPlotsImagExpr,
        state.realPlotsOutputComponent,
        state.surfacePalette,
        state.realPlotsBrightness ?? 0.5,
        state.realPlotsContrast ?? 1.0,
        state.realPlotsSaturation ?? 1.0,
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
    const funcKey = options.mapOptions?.functionKey ?? (state.algebraicChainingEnabled ? 'algebraic_chaining' : state.currentFunction);
    const activeMap = getMappedTransformProfile(funcKey);
    return {
        mapOptions: nativeMapOptions(state, {
            ...activeMap.nativeMapOptions,
            functionKey: funcKey,
            chainingEnabled: Boolean(state.chainingEnabled),
            chainCount: state.chainingEnabled ? (state.chainCount || 1) : 1,
            chainingMode: state.chainingMode || 'recursion',
            chainSeed: state.chainSeed || { re: 0, im: 0 },
            ...options.mapOptions
        }),
        xRange: options.xRange ?? zPlaneParams.currentVisXRange,
        yRange: options.yRange ?? zPlaneParams.currentVisYRange,
        inputUPreset,
        inputVPreset,
        inputUProgram: expressionProgram(inputExpr, inputUPreset),
        inputVProgram: expressionProgram(imagExpr, inputVPreset),
        component: outputComponentMode(options.outputComponent ?? state.realPlotsOutputComponent),
        palette: paletteLutFor(options.palette ?? state.surfacePalette, {
            brightness: options.brightness ?? state.realPlotsBrightness ?? 0.5,
            contrast: options.contrast ?? state.realPlotsContrast ?? 1.0,
            saturation: options.saturation ?? state.realPlotsSaturation ?? 1.0
        })
    };
}

export function buildRealPlotSurface(options = {}) {
    const segments = requireInteger(options.segments ?? DEFAULT_SAMPLE_SEGMENTS, 'Real-plot segment count');
    if (segments < 1) throw new Error('Real-plot segment count must be positive.');
    const definition = resolveRealPlotDefinition(options);
    const result = buildNativeRealSurface({
        ...definition,
        segments,
        heightScale: options.heightScale ?? state.realPlotsHeightScale,
        phaseColor: (options.colorMode ?? state.realPlotsColorMode) === 'phase',
        valuesOnly: options.valuesOnly === true
    });
    return result.positions ? { ...result, contourValues: result.rawValues } : result;
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
        ...(options.scalarGrid ? {} : resolveRealPlotDefinition(options)),
        scalarGrid: options.scalarGrid,
        width: requireInteger(options.width, 'Real-plot contour width'),
        height: requireInteger(options.height, 'Real-plot contour height'),
        contoursEnabled: options.contoursEnabled ?? state.contoursEnabled,
        contourInterval,
        contourThickness
    });
}

function zoomRealPlotCoordinates(event) {
    applySurfaceCoordinateZoom(event, state.zPlaneZoom, nextZoom => {
        state.zPlaneZoom = nextZoom;
        setupVisualParameters(true, false);
        requestUiRedraw();
    });
}

export function drawRealPlot() {
    const container = document.getElementById('real_plots_3d_container');
    if (!container) return;
    const xRange = [...zPlaneParams.currentVisXRange];
    const yRange = [...zPlaneParams.currentVisYRange];
    const frameKey = [
        outputAxisLabel(state.realPlotsOutputComponent),
        ...xRange,
        ...yRange
    ].join('|');

    drawScalarSurface(container, {
        geometryKey: realPlotSurfaceKey(),
        buildGeometry: () => buildRealPlotSurface({ segments: RENDER_SEGMENTS }),
        frameKey,
        frame: {
            ...REAL_SURFACE_FRAME,
            axisLabels: {
                x: 'x',
                z: 'y',
                y: outputAxisLabel(state.realPlotsOutputComponent)
            },
            coordinateBounds: { xRange, zRange: yRange }
        },
        overlaysKey: '',
        overlays: [],
        contours: {
            enabled: state.contoursEnabled,
            interval: state.contourInterval,
            thickness: state.contourThickness
        }
    }, { coordinateWheelZoom: zoomRealPlotCoordinates });
}

export function disposeRealPlotsRenderer() {
    disposeScalarSurface(document.getElementById('real_plots_3d_container'));
}
