import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { disposeThreeObject } from './three-utils.js';
import { getCanvasBackgroundColor } from '../frontend/theme.js';

function addLights(scene) {
    scene.add(new THREE.AmbientLight(0xffffff, 0.34));
    scene.add(new THREE.HemisphereLight(0xe9f1ff, 0x050510, 1.55));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(5, 7, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8ed8ff, 1.15);
    rim.position.set(-5, 3, -5);
    scene.add(rim);
}

export function createOrthographicSceneHost(container, {
    cameraBounds,
    cameraTarget,
    cameraOffset,
    cameraDistance,
    background,
    getFrustum,
    getSize = () => ({ width: container.clientWidth || 1, height: container.clientHeight || 1 }),
    render
}) {
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(...cameraBounds);
    const target = new THREE.Vector3(...cameraTarget);
    camera.position.copy(target).add(
        new THREE.Vector3(...cameraOffset).normalize().multiplyScalar(cameraDistance)
    );

    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        depth: true,
        stencil: false,
        preserveDrawingBuffer: true
    });
    renderer.setClearColor(new THREE.Color(getCanvasBackgroundColor()));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    Object.assign(controls, {
        enableDamping: false,
        enablePan: true,
        enableZoom: true,
        zoomToCursor: true,
        screenSpacePanning: true
    });
    controls.target.copy(target);
    controls.update();
    controls.saveState();
    controls.addEventListener('change', render);

    const contentGroup = new THREE.Group();
    scene.add(contentGroup);
    addLights(scene);

    const host = { scene, camera, renderer, controls, contentGroup };
    const syncPixelRatio = () => renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    host.resize = () => {
        const { width, height } = getSize();
        const { halfWidth, halfHeight } = getFrustum(width / height);
        syncPixelRatio();
        Object.assign(camera, {
            left: -halfWidth,
            right: halfWidth,
            top: halfHeight,
            bottom: -halfHeight
        });
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        render();
    };
    host.resizeObserver = new ResizeObserver(host.resize);
    host.resizeObserver.observe(container);
    host.disposeSceneHost = () => {
        host.resizeObserver.disconnect();
        controls.dispose();
        disposeThreeObject(scene);
        renderer.dispose();
        renderer.domElement.remove();
    };
    return host;
}
