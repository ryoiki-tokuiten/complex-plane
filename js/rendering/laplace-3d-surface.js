import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { state } from '../store/state.js';
import { disposeThreeObject } from './three-utils.js';

const BACKGROUND = 0x0b0914;
const CAMERA_HOME = Object.freeze({ x: 7.8, y: 6.3, z: 8.6 });
const SURFACE_WIDTH = 6.8;
const SURFACE_DEPTH = 6.2;
const SURFACE_HEIGHT = 4.4;
const rendererByContainer = new WeakMap();

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function valueKey(value) {
    return Number(finite(value)).toFixed(9);
}

function clearGroup(group) {
    while (group.children.length) {
        const child = group.children[0];
        group.remove(child);
        disposeThreeObject(child);
    }
}

function buildGrid(surface) {
    const sigmas = [...new Set(surface.map(point => valueKey(point.sigma)))].map(Number).sort((a, b) => a - b);
    const omegas = [...new Set(surface.map(point => valueKey(point.omega)))].map(Number).sort((a, b) => a - b);
    const points = new Map(surface.map(point => [`${valueKey(point.sigma)}:${valueKey(point.omega)}`, point]));
    return { sigmas, omegas, points };
}

function surfaceValue(point, mode, clipHeight) {
    if (!point) return { height: -SURFACE_HEIGHT * 0.5, color: new THREE.Color(0x111827) };

    const phase = finite(point.phase);
    const magnitude = Math.min(Math.max(0, finite(point.magnitude)), clipHeight);
    const magnitudeRatio = Math.log1p(magnitude) / Math.log1p(clipHeight);
    const height = mode === 'phase'
        ? clamp(phase / Math.PI, -1, 1) * (SURFACE_HEIGHT * 0.5)
        : magnitudeRatio * SURFACE_HEIGHT;

    const color = new THREE.Color();
    if (mode === 'combined' || mode === 'phase') {
        color.setHSL((phase / (Math.PI * 2) + 1) % 1, 0.82, mode === 'combined'
            ? 0.32 + magnitudeRatio * 0.33
            : 0.53);
    } else {
        color.setHSL(0.66 - magnitudeRatio * 0.72, 0.82, 0.28 + magnitudeRatio * 0.34);
    }

    return { height, color };
}

function coordinate(value, min, max, span) {
    const range = max - min || 1;
    return ((value - (min + max) * 0.5) / range) * span;
}

function makeAxisLabel(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    context.font = '600 42px "STIX Two Math", serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = color;
    context.fillText(text, 128, 48);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false
    }));
    sprite.scale.set(1.25, 0.47, 1);
    return sprite;
}

class LaplaceSurfaceRenderer {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(BACKGROUND, 0.035);
        this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
        this.camera.position.set(CAMERA_HOME.x, CAMERA_HOME.y, CAMERA_HOME.z);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setClearColor(BACKGROUND);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.container.replaceChildren(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = false;
        this.controls.enablePan = true;
        this.controls.enableZoom = true;
        this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
        this.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
        this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
        this.controls.target.set(0, 1.15, 0);
        this.controls.minDistance = 4;
        this.controls.maxDistance = 22;
        this.controls.update();
        this.controls.addEventListener('change', () => this.render());

        this.surfaceGroup = new THREE.Group();
        this.overlayGroup = new THREE.Group();
        this.scene.add(this.surfaceGroup, this.overlayGroup);

        this.scene.add(new THREE.HemisphereLight(0xa5b4fc, 0x090714, 1.7));
        const keyLight = new THREE.DirectionalLight(0xf4e8ff, 2.8);
        keyLight.position.set(5, 8, 6);
        this.scene.add(keyLight);
        const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.45);
        rimLight.position.set(-7, 4, -5);
        this.scene.add(rimLight);

        this.addReferenceFrame();
        this.renderer.domElement.addEventListener('dblclick', () => this.resetCamera());
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
        this.resize();
    }

    addReferenceFrame() {
        const grid = new THREE.GridHelper(10, 20, 0x41436e, 0x252844);
        grid.position.y = -0.035;
        this.scene.add(grid);

        const sigmaLabel = makeAxisLabel('σ', 'rgba(216, 228, 255, 0.9)');
        sigmaLabel.position.set(SURFACE_WIDTH * 0.5 + 0.55, 0.15, SURFACE_DEPTH * 0.5 + 0.18);
        const omegaLabel = makeAxisLabel('jω', 'rgba(216, 228, 255, 0.9)');
        omegaLabel.position.set(-SURFACE_WIDTH * 0.5 - 0.52, 0.15, -SURFACE_DEPTH * 0.5 - 0.18);
        const heightLabel = makeAxisLabel('|F(s)|', 'rgba(216, 228, 255, 0.9)');
        heightLabel.position.set(-SURFACE_WIDTH * 0.5 - 0.35, SURFACE_HEIGHT + 0.6, SURFACE_DEPTH * 0.5);
        this.axisLabels = { sigmaLabel, omegaLabel, heightLabel };
        this.scene.add(sigmaLabel, omegaLabel, heightLabel);
    }

    setHeightAxisLabel(mode) {
        const text = mode === 'phase' ? '∠F(s)' : mode === 'combined' ? '|F(s)| + ∠F(s)' : '|F(s)|';
        if (this.heightAxisLabelText === text) return;
        this.heightAxisLabelText = text;

        const previous = this.axisLabels.heightLabel;
        this.scene.remove(previous);
        previous.material.map?.dispose();
        previous.material.dispose();

        const heightLabel = makeAxisLabel(text, 'rgba(216, 228, 255, 0.9)');
        heightLabel.position.set(-SURFACE_WIDTH * 0.5 - 0.35, SURFACE_HEIGHT + 0.6, SURFACE_DEPTH * 0.5);
        this.axisLabels.heightLabel = heightLabel;
        this.scene.add(heightLabel);
    }

    resetCamera() {
        this.camera.position.set(CAMERA_HOME.x, CAMERA_HOME.y, CAMERA_HOME.z);
        this.controls.target.set(0, 1.15, 0);
        this.controls.update();
        this.render();
    }

    update(surface, options) {
        const markers = [
            ...(state.laplacePoles || []).map(point => `p:${point.sigma}:${point.omega}`),
            ...(state.laplaceZeros || []).map(point => `z:${point.sigma}:${point.omega}`)
        ].join('|');
        const signature = `${options.mode}|${options.clipHeight}|${options.showPolesZeros}|${options.showFourierLine}|${markers}`;
        if (surface === this.surface && signature === this.signature) {
            this.render();
            return;
        }
        this.surface = surface;
        this.signature = signature;
        this.buildSurface(surface, options);
        this.render();
    }

    buildSurface(surface, options) {
        clearGroup(this.surfaceGroup);
        clearGroup(this.overlayGroup);
        this.setHeightAxisLabel(options.mode);

        const { sigmas, omegas, points } = buildGrid(surface);
        if (sigmas.length < 2 || omegas.length < 2) return;

        const vertexCount = sigmas.length * omegas.length;
        const positions = new Float32Array(vertexCount * 3);
        const colors = new Float32Array(vertexCount * 3);
        const minSigma = sigmas[0];
        const maxSigma = sigmas.at(-1);
        const minOmega = omegas[0];
        const maxOmega = omegas.at(-1);

        omegas.forEach((omega, row) => {
            sigmas.forEach((sigma, column) => {
                const index = row * sigmas.length + column;
                const point = points.get(`${valueKey(sigma)}:${valueKey(omega)}`);
                const value = surfaceValue(point, options.mode, options.clipHeight);
                positions[index * 3] = coordinate(sigma, minSigma, maxSigma, SURFACE_WIDTH);
                positions[index * 3 + 1] = value.height;
                positions[index * 3 + 2] = coordinate(omega, minOmega, maxOmega, SURFACE_DEPTH);
                colors[index * 3] = value.color.r;
                colors[index * 3 + 1] = value.color.g;
                colors[index * 3 + 2] = value.color.b;
            });
        });

        const indices = [];
        for (let row = 0; row < omegas.length - 1; row += 1) {
            for (let column = 0; column < sigmas.length - 1; column += 1) {
                const a = row * sigmas.length + column;
                const b = a + 1;
                const c = a + sigmas.length;
                const d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            roughness: 0.3,
            metalness: 0.12,
            transparent: true,
            opacity: 0.96
        });
        const mesh = new THREE.Mesh(geometry, material);
        this.surfaceGroup.add(mesh);

        const wireframe = new THREE.LineSegments(
            new THREE.WireframeGeometry(geometry),
            new THREE.LineBasicMaterial({ color: 0xd8e7ff, transparent: true, opacity: 0.14, depthWrite: false })
        );
        wireframe.renderOrder = 2;
        this.surfaceGroup.add(wireframe);

        this.addReferenceOverlays({ minSigma, maxSigma, minOmega, maxOmega, options });
    }

    addReferenceOverlays({ minSigma, maxSigma, minOmega, maxOmega, options }) {
        const toScene = (sigma, omega, y = 0.08) => new THREE.Vector3(
            coordinate(sigma, minSigma, maxSigma, SURFACE_WIDTH),
            y,
            coordinate(omega, minOmega, maxOmega, SURFACE_DEPTH)
        );

        if (options.showFourierLine && minSigma <= 0 && maxSigma >= 0) {
            const geometry = new THREE.BufferGeometry().setFromPoints([
                toScene(0, minOmega, 0.11),
                toScene(0, maxOmega, 0.11)
            ]);
            this.overlayGroup.add(new THREE.Line(geometry, new THREE.LineDashedMaterial({
                color: 0xfde68a, dashSize: 0.15, gapSize: 0.09, transparent: true, opacity: 0.8
            })));
            this.overlayGroup.children.at(-1).computeLineDistances();
        }
        
        if (options.showROC && state.laplaceROC && state.laplaceROC.boundary !== null) {
            const boundary = state.laplaceROC.boundary;
            if (boundary >= minSigma && boundary <= maxSigma) {
                // ROC Line
                const geometry = new THREE.BufferGeometry().setFromPoints([
                    toScene(boundary, minOmega, 0.11),
                    toScene(boundary, maxOmega, 0.11)
                ]);
                this.overlayGroup.add(new THREE.Line(geometry, new THREE.LineDashedMaterial({
                    color: 0x4ade80, dashSize: 0.15, gapSize: 0.09, transparent: true, opacity: 0.8
                })));
                this.overlayGroup.children.at(-1).computeLineDistances();
                
                // ROC Plane (shading)
                const planeGeometry = new THREE.PlaneGeometry(
                    Math.abs(coordinate(maxSigma, minSigma, maxSigma, SURFACE_WIDTH) - coordinate(boundary, minSigma, maxSigma, SURFACE_WIDTH)),
                    SURFACE_DEPTH
                );
                const planeMaterial = new THREE.MeshBasicMaterial({
                    color: 0x4ade80, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false
                });
                const plane = new THREE.Mesh(planeGeometry, planeMaterial);
                plane.rotation.x = -Math.PI / 2;
                plane.position.copy(toScene((maxSigma + boundary) / 2, (minOmega + maxOmega) / 2, 0.01));
                this.overlayGroup.add(plane);
            }
        }

        if (!options.showPolesZeros) return;
        const markerHeight = SURFACE_HEIGHT + 0.16;
        for (const pole of state.laplacePoles || []) {
            const marker = new THREE.Mesh(
                new THREE.OctahedronGeometry(0.14, 1),
                new THREE.MeshBasicMaterial({ color: 0xfb923c })
            );
            marker.position.copy(toScene(pole.sigma, pole.omega, markerHeight));
            this.overlayGroup.add(marker);
        }
        for (const zero of state.laplaceZeros || []) {
            const marker = new THREE.Mesh(
                new THREE.TorusGeometry(0.12, 0.032, 8, 20),
                new THREE.MeshBasicMaterial({ color: 0x67e8f9 })
            );
            marker.rotation.x = Math.PI * 0.5;
            marker.position.copy(toScene(zero.sigma, zero.omega, markerHeight));
            this.overlayGroup.add(marker);
        }
    }

    resize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        if (!width || !height) return;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        this.render();
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    dispose() {
        this.resizeObserver?.disconnect();
        this.controls.dispose();
        disposeThreeObject(this.scene);
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}

function getRenderer(container) {
    let renderer = rendererByContainer.get(container);
    if (!renderer) {
        renderer = new LaplaceSurfaceRenderer(container);
        rendererByContainer.set(container, renderer);
    }
    return renderer;
}

function setEmptyState(container) {
    container.replaceChildren();
    const message = document.createElement('div');
    message.className = 'three-surface-placeholder';
    message.textContent = 'Computing surface…';
    container.appendChild(message);
}

/** Render the Laplace transform surface with the shared Three.js stack. */
export function drawLaplace3DSurface(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const surface = state.laplaceSurface;
    if (!Array.isArray(surface) || surface.length === 0) {
        const existing = rendererByContainer.get(container);
        if (existing) existing.dispose();
        rendererByContainer.delete(container);
        setEmptyState(container);
        return;
    }

    const renderer = getRenderer(container);
    renderer.update(surface, {
        mode: state.laplaceVizMode || 'magnitude',
        clipHeight: Math.max(0.001, finite(state.laplaceClipHeight, 10)),
        showPolesZeros: state.laplaceShowPolesZeros !== false,
        showFourierLine: state.laplaceShowFourierLine !== false,
        showROC: state.laplaceShowROC !== false
    });
}

export function resizeLaplace3DSurface(container = document.getElementById('laplace_3d_container')) {
    if (container) rendererByContainer.get(container)?.resize();
}

export function updateLaplace3DSurface() {
    if (state.laplaceModeEnabled) drawLaplace3DSurface('laplace_3d_container');
}
