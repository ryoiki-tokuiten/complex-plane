import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { state, subscribeState } from '../store/state.js';
import { requestUiRedraw } from './redraw-scheduler.js';
import { disposeThreeObject } from './three-utils.js';
import { requireFiniteComplex, requireFiniteNumber, isFiniteComplex } from '../utils/numeric-contracts.js';
import { getManifold, DEFAULT_MANIFOLD_ID } from './manifold-registry.js';
import { buildNativeFoldPreimageMarkers } from '../native/complex-engine.js';
import { nativeOptionsForActiveMap } from '../native/map-runtime.js';
import {
    getRasterDisplayDimensions,
    getRasterOpacityForShape,
    isRasterInputShape
} from '../utils/raster-media.js';

const COLOR_BACKGROUND = 0x07070d;
const CANONICAL_SURFACE_RES = 48;

export class ThreeManifoldsRenderer {
    constructor(containerElement, planeType = 'z') {
        this.container = containerElement;
        this.planeType = planeType;
        this.isDragging = false;
        this.probePoint = null;
        this.animationHandle = null;
        this.renderDirty = true;
        this.lastGeometryProgress = 0.0;
        this.activeMap = null;
        this.transformKey = null;
        this.currentManifoldId = state.selectedManifold || DEFAULT_MANIFOLD_ID;
        this.manifold = getManifold(this.currentManifoldId);

        this.rasterManifoldMesh = null;
        this.rasterManifoldSource = null;
        this.rasterSurfaceMesh = null;
        this.rasterSurfaceData = null;
        this.rasterSurfaceSource = null;
        this.rasterSurfaceHeightScale = 1;
        this.rasterSurfaceKey = null;
        this.gridFoldSurfaceData = null;
        this.gridFoldSurfaceKey = null;
        this.gridFoldHeightScale = 1;
        this.foldSurfaceMode = null;
        this.pointerRect = { left: 0, top: 0, width: 1, height: 1 };
        this.pointerRectValid = false;

        this.initScene();
        this.initInteraction();
        this.container.__threeManifoldsRenderer = this;

        this.unsubscribeOpacities = subscribeState(() => {
            this.updateOpacities(this.lastGeometryProgress);
            this.renderDirty = true;
            this.render();
        }, ['manifoldSurfaceOpacity', 'manifoldGridOpacity']);
    }

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(COLOR_BACKGROUND, 0.009);

        const aspect = this.container.clientWidth / this.container.clientHeight || 1;
        this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
        this.camera.position.set(12, 10, 16);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(COLOR_BACKGROUND);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        this.container.replaceChildren();
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.target.set(0, 2.0, 0);
        this.controls.addEventListener('change', () => {
            this.renderDirty = true;
            this.startAnimationLoop();
        });

        // Clean Studio Lighting (No artificial colored gradients/spots)
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.65);
        dirLight.position.set(15, 25, 20);
        this.scene.add(dirLight);

        const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
        fillLight.position.set(-15, 10, -15);
        this.scene.add(fillLight);

        // Ambient floor grid
        this.staticGrid = new THREE.GridHelper(60, 48, 0x1e2030, 0x10121c);
        this.staticGrid.position.y = -0.05;
        this.scene.add(this.staticGrid);

        // Canonical 3D Manifold Surface Mesh (Clean Matte Material)
        this.surfaceMaterial = new THREE.MeshStandardMaterial({
            color: 0x121420,
            vertexColors: false,
            roughness: 0.9,
            metalness: 0.05,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: 2.0,
            polygonOffsetUnits: 2.0
        });

        this.wireframeMaterial = new THREE.LineBasicMaterial({
            color: 0x818cf8,
            transparent: true,
            opacity: 0.35,
            depthWrite: false
        });

        this.surfaceMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.surfaceMaterial);
        this.surfaceMesh.renderOrder = 1;
        this.wireframeMesh = new THREE.LineSegments(new THREE.BufferGeometry(), this.wireframeMaterial);
        this.wireframeMesh.renderOrder = 2;
        this.surfaceMesh.visible = false;
        this.wireframeMesh.visible = false;
        this.scene.add(this.surfaceMesh);
        this.scene.add(this.wireframeMesh);

        this.rebuildCanonicalManifoldSurface();

        // Projected Transformation Grid & Shape Lines
        this.linesGroup = new THREE.Group();
        this.linesGroup.renderOrder = 5;
        this.scene.add(this.linesGroup);

        this.dynamicOverlayGroup = new THREE.Group();
        this.dynamicOverlayGroup.renderOrder = 20;
        this.scene.add(this.dynamicOverlayGroup);

        this.rasterSurfaceGroup = new THREE.Group();
        this.rasterSurfaceGroup.visible = false;
        this.scene.add(this.rasterSurfaceGroup);

        this.rasterManifoldGroup = new THREE.Group();
        this.rasterManifoldGroup.visible = true;
        this.scene.add(this.rasterManifoldGroup);

        this.gridFoldSurfaceGroup = new THREE.Group();
        this.gridFoldSurfaceGroup.visible = false;
        this.scene.add(this.gridFoldSurfaceGroup);

        this.foldPreimageGroup = new THREE.Group();
        this.foldPreimageGroup.renderOrder = 50;
        this.foldPreimageGroup.visible = false;
        this.foldPreimageKey = '';
        this.scene.add(this.foldPreimageGroup);

        this.markersGroup = new THREE.Group();
        this.scene.add(this.markersGroup);

        this.activeMarker = new THREE.Mesh(
            new THREE.SphereGeometry(0.32, 32, 32),
            new THREE.MeshBasicMaterial({ color: 0xf43f5e })
        );
        this.targetMarker = new THREE.Mesh(
            new THREE.SphereGeometry(0.28, 32, 32),
            new THREE.MeshBasicMaterial({ color: 0x818cf8 })
        );

        const rayMaterial = new THREE.LineDashedMaterial({
            color: 0xfcd34d,
            dashSize: 0.35,
            gapSize: 0.2,
            linewidth: 2,
            transparent: true,
            opacity: 0.8
        });
        const rayGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, 0)
        ]);
        this.projectionRay = new THREE.Line(rayGeo, rayMaterial);
        this.projectionRay.computeLineDistances();

        this.markersGroup.add(this.activeMarker);
        this.markersGroup.add(this.targetMarker);
        this.markersGroup.add(this.projectionRay);
        this.markersGroup.visible = false;

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.container);
    }

    updateOpacities(progress = 1.0) {
        const baseSurfaceOpacity = typeof state.manifoldSurfaceOpacity === 'number' ? state.manifoldSurfaceOpacity : 0.35;
        const baseGridOpacity = typeof state.manifoldGridOpacity === 'number' ? state.manifoldGridOpacity : 0.25;
        const isTransformationActive = Boolean(state.manifoldTransformationEnabled);
        const isComplete = progress >= 0.995;

        // During transformation, hide the solid surface mesh until completion (t = 1)
        const shouldShowSurface = !isTransformationActive || isComplete;

        if (this.surfaceMaterial) {
            this.surfaceMaterial.vertexColors = false;
            this.surfaceMaterial.color.setHex(0x121420);
            this.surfaceMaterial.opacity = baseSurfaceOpacity;
            this.surfaceMesh.visible = shouldShowSurface && baseSurfaceOpacity > 0.001;
        }

        if (this.wireframeMaterial) {
            this.wireframeMaterial.opacity = baseGridOpacity;
            this.wireframeMesh.visible = shouldShowSurface && baseGridOpacity > 0.001;
        }

        if (this.rasterManifoldMesh && this.rasterManifoldMesh.material) {
            const rasterOpacity = getRasterOpacityForShape(state.currentInputShape) ?? 1.0;
            this.rasterManifoldMesh.material.opacity = Math.max(0.05, rasterOpacity);
        }
        this.renderDirty = true;
    }

    rebuildCanonicalManifoldSurface() {
        if (!this.manifold) return;

        let geometry;

        if (this.currentManifoldId === 'sphere') {
            // Perfect closed full sphere geometry matching SphereManifold (R=5.0)
            const radius = 5.0;
            geometry = new THREE.SphereGeometry(radius, 64, 48);
            geometry.translate(0, radius, 0); // Position South Pole at Y=0 and North Pole at Y=10
        } else {
            const size = CANONICAL_SURFACE_RES;
            const total = size * size;
            const positions = new Float32Array(total * 3);
            const indices = [];

            for (let i = 0; i < size; i++) {
                for (let j = 0; j < size; j++) {
                    const idx = i * size + j;
                    const uNorm = i / (size - 1);
                    const vNorm = j / (size - 1);
                    const domainPt = this.manifold.getDomainPoint(uNorm, vNorm);

                    const projected = this.manifold.project(domainPt.re, domainPt.im);
                    positions[idx * 3] = Number.isFinite(projected.X) ? projected.X : 0;
                    positions[idx * 3 + 1] = Number.isFinite(projected.Y) ? projected.Y : 0;
                    positions[idx * 3 + 2] = Number.isFinite(projected.Z) ? projected.Z : 0;
                }
            }

            for (let i = 0; i < size - 1; i++) {
                for (let j = 0; j < size - 1; j++) {
                    const a = i * size + j;
                    const b = i * size + j + 1;
                    const c = (i + 1) * size + j;
                    const d = (i + 1) * size + j + 1;
                    indices.push(a, b, d);
                    indices.push(a, d, c);
                }
            }

            geometry = new THREE.BufferGeometry();
            geometry.setIndex(indices);
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.computeVertexNormals();
        }

        this.surfaceMesh.geometry.dispose();
        this.surfaceMesh.geometry = geometry;

        this.wireframeMesh.geometry.dispose();
        this.wireframeMesh.geometry = new THREE.WireframeGeometry(geometry);

        this.updateOpacities(this.lastGeometryProgress);
    }

    initInteraction() {
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        const dragPlaneGeo = new THREE.PlaneGeometry(1000, 1000);
        dragPlaneGeo.rotateX(-Math.PI / 2);
        this.dragPlane = new THREE.Mesh(dragPlaneGeo, new THREE.MeshBasicMaterial({ visible: false }));
        this.scene.add(this.dragPlane);

        if (this.planeType === 'z') {
            this.renderer.domElement.addEventListener('pointerdown', (e) => {
                if (!state.probeActive) return;

                this.refreshPointerRect();
                this.updatePointerNdc(e);

                this.raycaster.setFromCamera(this.mouse, this.camera);
                const intersects = this.raycaster.intersectObject(this.dragPlane);
                if (intersects.length > 0) {
                    this.isDragging = true;
                    this.controls.enabled = false;
                    state.probeZ = { re: intersects[0].point.x, im: intersects[0].point.z };
                    requestUiRedraw();
                }
            });

            this.renderer.domElement.addEventListener('pointermove', (e) => {
                if (!this.isDragging || !state.probeActive) return;

                this.updatePointerNdc(e);
                this.raycaster.setFromCamera(this.mouse, this.camera);
                const intersects = this.raycaster.intersectObject(this.dragPlane);
                if (intersects.length > 0) {
                    state.probeZ = { re: intersects[0].point.x, im: intersects[0].point.z };
                    requestUiRedraw();
                }
            });

            const onPointerUp = () => {
                if (this.isDragging) {
                    this.isDragging = false;
                    this.controls.enabled = true;
                }
            };
            window.addEventListener('pointerup', onPointerUp);
            this.onPointerUpClean = onPointerUp;
        } else {
            this.renderer.domElement.addEventListener('click', event => {
                if (!state.preimageExplorerEnabled || !this.onFoldTargetSelected || !this.foldSurfaceMode) return;
                this.refreshPointerRect();
                this.updatePointerNdc(event);
                this.raycaster.params.Line.threshold = 0.18;
                this.raycaster.setFromCamera(this.mouse, this.camera);
                const group = this.foldSurfaceMode === 'raster' ? this.rasterSurfaceGroup : this.gridFoldSurfaceGroup;
                const hit = this.raycaster.intersectObject(group, true)[0];
                const mapping = this.foldMapping;
                if (!hit || !mapping?.scale) return;
                this.onFoldTargetSelected({
                    re: hit.point.x / mapping.scale + mapping.mappedCenterX,
                    im: hit.point.z / mapping.scale + mapping.mappedCenterY
                });
            });
        }
    }

    refreshPointerRect() {
        const element = this.renderer?.domElement;
        const rect = element && typeof element.getBoundingClientRect === 'function'
            ? element.getBoundingClientRect()
            : null;

        this.pointerRect.left = rect?.left || 0;
        this.pointerRect.top = rect?.top || 0;
        this.pointerRect.width = Math.max(1, rect?.width || element?.clientWidth || element?.width || 1);
        this.pointerRect.height = Math.max(1, rect?.height || element?.clientHeight || element?.height || 1);
        this.pointerRectValid = true;
        return this.pointerRect;
    }

    getPointerRect() {
        return this.pointerRectValid ? this.pointerRect : this.refreshPointerRect();
    }

    updatePointerNdc(event) {
        const rect = this.getPointerRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    setTransform(map = null) {
        const nextTransformKey = map?.signature || null;
        const changed = this.transformKey !== nextTransformKey;
        this.activeMap = map;
        this.transformKey = nextTransformKey;
        if (changed) {
            this.renderDirty = true;
        }
        return changed;
    }

    clearManifoldGeometry() {
        if (this.linesGroup) {
            disposeThreeObject(this.linesGroup);
            this.linesGroup.clear();
        }
        if (this.rasterManifoldMesh) {
            disposeThreeObject(this.rasterManifoldMesh);
            if (this.rasterManifoldGroup) this.rasterManifoldGroup.remove(this.rasterManifoldMesh);
            this.rasterManifoldMesh = null;
            this.rasterManifoldSource = null;
        }
        if (this.rasterManifoldGroup) {
            disposeThreeObject(this.rasterManifoldGroup);
            this.rasterManifoldGroup.clear();
        }
    }

    setManifold(manifoldId) {
        if (!manifoldId) manifoldId = DEFAULT_MANIFOLD_ID;
        if (this.currentManifoldId === manifoldId && this.manifold) return false;
        this.currentManifoldId = manifoldId;
        this.manifold = getManifold(manifoldId);
        this.rebuildCanonicalManifoldSurface();
        this.renderDirty = true;
        return true;
    }

    setFoldSurfaceMode(mode) {
        const changed = this.foldSurfaceMode !== mode;
        this.foldSurfaceMode = mode;
        this.clearManifoldGeometry();
        this.rasterSurfaceGroup.visible = mode === 'raster';
        this.rasterManifoldGroup.visible = false;
        this.gridFoldSurfaceGroup.visible = mode === 'grid';
        this.staticGrid.visible = true;
        this.surfaceMesh.visible = false;
        this.wireframeMesh.visible = false;
        this.linesGroup.visible = false;
        this.dynamicOverlayGroup.visible = false;
        this.markersGroup.visible = false;
        if (this.dragPlane) this.dragPlane.visible = false;
        if (changed) {
            this.renderDirty = true;
        }
        return changed;
    }

    setManifoldMode() {
        const changed = this.foldSurfaceMode !== null;
        this.foldSurfaceMode = null;
        this.rasterSurfaceGroup.visible = false;
        this.rasterManifoldGroup.visible = true;
        this.gridFoldSurfaceGroup.visible = false;
        this.rasterSurfaceKey = null;
        this.gridFoldSurfaceKey = null;
        this.staticGrid.visible = true;
        this.linesGroup.visible = true;
        this.dynamicOverlayGroup.visible = true;
        this.markersGroup.visible = Boolean(this.probePoint);
        this.foldPreimageGroup.visible = false;
        this.foldPreimageKey = '';
        if (this.dragPlane) this.dragPlane.visible = true;
        this.setManifold(state.selectedManifold);
        this.updateOpacities(this.lastGeometryProgress);
        if (changed) {
            this.renderDirty = true;
        }
        return changed;
    }

    setSphereMode() {
        return this.setManifoldMode();
    }

    setRasterSurface(data, source, opacity, heightScale) {
        if (!data || typeof data !== 'object') throw new Error('Raster surface data is required.');
        if (!source) throw new Error('Raster surface source is required.');
        if (!(data.indices instanceof Uint16Array)) {
            throw new Error('Raster surface requires native Uint16 indices.');
        }
        if (!(data.foldPositions instanceof Float32Array) || data.foldPositions.length % 3 !== 0 ||
            !(data.foldUvs instanceof Float32Array) || data.foldUvs.length % 2 !== 0 ||
            data.foldPositions.length / 3 !== data.foldUvs.length / 2) {
            throw new Error('Raster surface has malformed native geometry.');
        }
        const foldMapping = data.foldMapping;
        if (!foldMapping || ![
            foldMapping.mappedCenterX, foldMapping.mappedCenterY,
            foldMapping.sourceCenter, foldMapping.scale
        ].every(Number.isFinite) || foldMapping.scale <= 0) {
            throw new Error('Raster surface requires a valid native fold mapping.');
        }

        const hasGeometry = data.indices.length > 0;
        const nextHeightScale = requireFiniteNumber(heightScale, 'Raster height scale');
        if (nextHeightScale <= 0) throw new Error('Raster height scale must be positive.');
        this.setFoldSurfaceMode('raster');
        this.foldMapping = foldMapping;

        if (!this.rasterSurfaceMesh) {
            this.rasterSurfaceMesh = new THREE.Mesh(
                new THREE.BufferGeometry(),
                new THREE.MeshBasicMaterial({
                    side: THREE.DoubleSide,
                    transparent: true,
                    alphaTest: 0.05,
                    depthWrite: true,
                    fog: false
                })
            );
            this.rasterSurfaceGroup.add(this.rasterSurfaceMesh);
        }
        this.rasterSurfaceMesh.visible = hasGeometry;

        if (!hasGeometry) {
            this.rasterSurfaceData = data;
            this.rasterSurfaceHeightScale = nextHeightScale;
        } else if (this.rasterSurfaceData !== data || this.rasterSurfaceHeightScale !== nextHeightScale) {
            const { foldPositions, foldUvs, indices } = data;

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(foldPositions, 3));
            geometry.setAttribute('uv', new THREE.BufferAttribute(foldUvs, 2));
            geometry.setIndex(new THREE.BufferAttribute(indices, 1));
            geometry.computeBoundingSphere();
            this.rasterSurfaceMesh.geometry.dispose();
            this.rasterSurfaceMesh.geometry = geometry;
            this.rasterSurfaceData = data;
            this.rasterSurfaceHeightScale = nextHeightScale;
        }

        const material = this.rasterSurfaceMesh.material;
        if (this.rasterSurfaceSource !== source) {
            material.map?.dispose();
            const isVideo = typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement;
            const texture = isVideo ? new THREE.VideoTexture(source) : new THREE.Texture(source);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.flipY = true;
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.generateMipmaps = false;
            texture.needsUpdate = true;
            material.map = texture;
            this.rasterSurfaceSource = source;
            material.needsUpdate = true;
        }

        const nextOpacity = Math.max(0, Math.min(
            1,
            requireFiniteNumber(opacity, 'Raster opacity')
        ));
        if (material.opacity !== nextOpacity) {
            material.opacity = nextOpacity;
            material.needsUpdate = true;
        }
        this.renderDirty = true;
        return true;
    }

    setFoldPreimageMarkers(roots, target, map) {
        const mapping = this.foldMapping;
        const heightScale = this.foldSurfaceMode === 'raster' ? this.rasterSurfaceHeightScale : this.gridFoldHeightScale;
        let nextKey = '';
        if (state.preimageExplorerEnabled) {
            if (!mapping || !Number.isFinite(mapping.scale) || mapping.scale <= 0) {
                throw new Error('Preimage markers require a valid fold mapping.');
            }
            if (!map?.signature) throw new Error('Preimage markers require an active native map.');
            requireFiniteComplex(target, 'Preimage target');
            if (!Array.isArray(roots)) throw new Error('Preimage roots must be an array.');
            roots.forEach((root, index) => requireFiniteComplex(root, `Preimage root ${index}`));
            if (roots.length) {
                nextKey = [
                    this.foldSurfaceMode, heightScale, mapping.mappedCenterX, mapping.mappedCenterY,
                    mapping.sourceCenter, mapping.scale, target.re, target.im,
                    map.signature, ...roots.flatMap(root => [root.re, root.im])
                ].join('|');
            }
        }
        if (this.foldPreimageKey === nextKey) return;
        this.foldPreimageKey = nextKey;
        while (this.foldPreimageGroup.children.length) {
            const child = this.foldPreimageGroup.children[0];
            child.geometry?.dispose?.();
            child.material?.dispose?.();
            this.foldPreimageGroup.remove(child);
        }
        this.foldPreimageGroup.clear();
        if (!state.preimageExplorerEnabled || !roots.length) {
            this.foldPreimageGroup.visible = false;
            this.renderDirty = true;
            return;
        }
        const positions = buildNativeFoldPreimageMarkers({
            mapOptions: nativeOptionsForActiveMap(map),
            mapping,
            heightScale
        }, roots);
        if (!positions.length) {
            this.foldPreimageGroup.visible = false;
            return;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.foldPreimageGroup.add(new THREE.Points(geometry, new THREE.PointsMaterial({
            color: 0xfacc15, size: 0.2, sizeAttenuation: true, depthTest: false
        })));
        this.foldPreimageGroup.visible = true;
        this.renderDirty = true;
    }

    setGridFoldSurface(data, heightScale) {
        if (!data || typeof data !== 'object') throw new Error('Grid-fold surface data is required.');
        if (!Array.isArray(data.lines) || !Array.isArray(data.points)) {
            throw new Error('Grid-fold surface requires native line and point groups.');
        }
        const mapping = data.mapping;
        if (!mapping || ![
            mapping.mappedCenterX, mapping.mappedCenterY, mapping.sourceCenter, mapping.scale
        ].every(Number.isFinite) || mapping.scale <= 0) {
            throw new Error('Grid-fold surface requires a valid native mapping.');
        }

        this.setFoldSurfaceMode('grid');
        this.foldMapping = mapping;
        const nextHeightScale = requireFiniteNumber(heightScale, 'Grid-fold height scale');
        if (nextHeightScale <= 0) throw new Error('Grid-fold height scale must be positive.');
        if (this.gridFoldSurfaceData === data && this.gridFoldHeightScale === nextHeightScale) return true;

        disposeThreeObject(this.gridFoldSurfaceGroup);
        this.gridFoldSurfaceGroup.clear();

        for (const [index, lineData] of data.lines.entries()) {
            if (!(lineData?.positions instanceof Float32Array) || lineData.positions.length < 6 ||
                lineData.positions.length % 3 !== 0) {
                throw new Error(`Grid-fold line ${index} has malformed native positions.`);
            }
            if (lineData.color === undefined || lineData.color === null) {
                throw new Error(`Grid-fold line ${index} requires a color.`);
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(lineData.positions, 3));

            const color = new THREE.Color(lineData.color);

            const material = new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity: 0.82,
                depthWrite: true
            });
            this.gridFoldSurfaceGroup.add(new THREE.Line(geometry, material));
        }
        for (const [index, pointData] of data.points.entries()) {
            if (!(pointData?.positions instanceof Float32Array) || pointData.positions.length < 3 ||
                pointData.positions.length % 3 !== 0) {
                throw new Error(`Grid-fold point group ${index} has malformed native positions.`);
            }
            if (pointData.color === undefined || pointData.color === null) {
                throw new Error(`Grid-fold point group ${index} requires a color.`);
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(pointData.positions, 3));
            const material = new THREE.PointsMaterial({ color: pointData.color, size: 0.09, sizeAttenuation: true });
            this.gridFoldSurfaceGroup.add(new THREE.Points(geometry, material));
        }

        this.gridFoldSurfaceData = data;
        this.gridFoldHeightScale = nextHeightScale;
        this.renderDirty = true;
        return true;
    }

    buildRasterManifold(source, shape = state.currentInputShape, progressOverride = undefined) {
        if (!source) throw new Error('Raster manifold rendering requires a media source.');
        this.setManifold(state.selectedManifold);
        this.resize();
        this.setManifoldMode();
        this.clearManifoldGeometry();

        const sourceSize = getRasterDisplayDimensions(shape);
        const w = Math.max(0.1, sourceSize.width);
        const h = Math.max(0.1, sourceSize.height);
        const a0 = Number.isFinite(state.a0) ? state.a0 : 0;
        const b0 = Number.isFinite(state.b0) ? state.b0 : 0;
        const xMin = a0 - w / 2;
        const xMax = a0 + w / 2;
        const yMin = b0 - h / 2;
        const yMax = b0 + h / 2;

        const resX = 64;
        const resY = 64;
        const numVerts = (resX + 1) * (resY + 1);

        const positions = new Float32Array(numVerts * 3);
        const uvs = new Float32Array(numVerts * 2);
        const gridData = new Array(numVerts);

        const progress = requireFiniteNumber(
            progressOverride !== undefined
                ? progressOverride
                : (this.planeType === 'z' ? state.manifoldTransformationProgressZ : state.manifoldTransformationProgressW),
            'Raster manifold progress'
        );

        for (let j = 0; j <= resY; j++) {
            const vTex = j / resY;
            const y = yMin + vTex * h;
            for (let i = 0; i <= resX; i++) {
                const uTex = i / resX;
                const x = xMin + uTex * w;
                const idx = j * (resX + 1) + i;

                let u = x;
                let v = y;
                let valid = true;

                if (this.planeType === 'w' && this.activeMap && typeof this.activeMap.evaluate === 'function') {
                    const mapped = this.activeMap.evaluate(x, y);
                    if (Number.isFinite(mapped?.re) && Number.isFinite(mapped?.im)) {
                        u = mapped.re;
                        v = mapped.im;
                    } else {
                        valid = false;
                    }
                }

                gridData[idx] = { u, v, x, y, uTex, vTex, valid };
                uvs[idx * 2] = uTex;
                uvs[idx * 2 + 1] = vTex;

                if (valid) {
                    const morphed = this.manifold.morph(u, v, progress);
                    positions[idx * 3] = Number.isFinite(morphed.X) ? morphed.X : 0;
                    positions[idx * 3 + 1] = Number.isFinite(morphed.Y) ? morphed.Y : 0;
                    positions[idx * 3 + 2] = Number.isFinite(morphed.Z) ? morphed.Z : 0;
                } else {
                    positions[idx * 3] = 0;
                    positions[idx * 3 + 1] = 0;
                    positions[idx * 3 + 2] = 0;
                }
            }
        }

        const indices = [];
        for (let j = 0; j < resY; j++) {
            for (let i = 0; i < resX; i++) {
                const i0 = j * (resX + 1) + i;
                const i1 = i0 + 1;
                const i2 = (j + 1) * (resX + 1) + i;
                const i3 = i2 + 1;

                const g0 = gridData[i0];
                const g1 = gridData[i1];
                const g2 = gridData[i2];
                const g3 = gridData[i3];

                if (!g0.valid || !g1.valid || !g2.valid || !g3.valid) continue;

                if (this.planeType === 'w') {
                    const maxDistSq = 40.0;
                    const d01 = (g0.u - g1.u) ** 2 + (g0.v - g1.v) ** 2;
                    const d02 = (g0.u - g2.u) ** 2 + (g0.v - g2.v) ** 2;
                    const d13 = (g1.u - g3.u) ** 2 + (g1.v - g3.v) ** 2;
                    const d23 = (g2.u - g3.u) ** 2 + (g2.v - g3.v) ** 2;
                    if (d01 > maxDistSq || d02 > maxDistSq || d13 > maxDistSq || d23 > maxDistSq) continue;
                }

                indices.push(i0, i1, i2);
                indices.push(i1, i3, i2);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        geometry.userData = { gridData, isRaster: true };

        const isVideo = typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement;
        const texture = isVideo ? new THREE.VideoTexture(source) : new THREE.Texture(source);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;

        const opacity = getRasterOpacityForShape(shape) ?? 1.0;
        const material = new THREE.MeshStandardMaterial({
            map: texture,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: Math.max(0.05, opacity),
            roughness: 0.7,
            metalness: 0.1,
            depthWrite: true,
            polygonOffset: true,
            polygonOffsetFactor: -1.0,
            polygonOffsetUnits: -1.0
        });

        this.rasterManifoldMesh = new THREE.Mesh(geometry, material);
        this.rasterManifoldMesh.renderOrder = 3;
        this.rasterManifoldGroup.add(this.rasterManifoldMesh);
        this.rasterManifoldSource = source;

        const perimeterSegments = 40;
        const edges = [
            Array.from({ length: perimeterSegments + 1 }, (_, k) => ({ re: xMin + (k / perimeterSegments) * w, im: yMin })),
            Array.from({ length: perimeterSegments + 1 }, (_, k) => ({ re: xMax, im: yMin + (k / perimeterSegments) * h })),
            Array.from({ length: perimeterSegments + 1 }, (_, k) => ({ re: xMax - (k / perimeterSegments) * w, im: yMax })),
            Array.from({ length: perimeterSegments + 1 }, (_, k) => ({ re: xMin, im: yMax - (k / perimeterSegments) * h }))
        ];

        edges.forEach(edgePoints => {
            const count = edgePoints.length;
            const edgePositions = new Float32Array(count * 3);
            const edgeData = new Array(count);
            for (let k = 0; k < count; k++) {
                const pt = edgePoints[k];
                let u = pt.re;
                let v = pt.im;
                if (this.planeType === 'w' && this.activeMap && typeof this.activeMap.evaluate === 'function') {
                    const mapped = this.activeMap.evaluate(pt.re, pt.im);
                    if (Number.isFinite(mapped?.re) && Number.isFinite(mapped?.im)) {
                        u = mapped.re;
                        v = mapped.im;
                    }
                }
                edgeData[k] = { u, v };
                const morphed = this.manifold.morph(u, v, progress);
                edgePositions[k * 3] = Number.isFinite(morphed.X) ? morphed.X : 0;
                edgePositions[k * 3 + 1] = Number.isFinite(morphed.Y) ? morphed.Y : 0;
                edgePositions[k * 3 + 2] = Number.isFinite(morphed.Z) ? morphed.Z : 0;
            }
            const edgeGeom = new THREE.BufferGeometry();
            edgeGeom.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
            edgeGeom.userData = { pointsData: edgeData };
            const edgeMat = new THREE.LineBasicMaterial({
                color: 0x38bdf8,
                transparent: true,
                opacity: 0.9,
                depthWrite: false
            });
            const edgeLine = new THREE.Line(edgeGeom, edgeMat);
            this.linesGroup.add(edgeLine);
        });

        this.lastGeometryProgress = progress;
        this.updateOpacities(progress);
        this.renderDirty = true;
        this.render();
    }

    buildGridFromPointSets(pointSets, progressOverride = undefined) {
        if (!Array.isArray(pointSets)) throw new Error('Manifold point sets must be an array.');
        this.setManifold(state.selectedManifold);
        this.resize();
        this.setManifoldMode();
        this.clearManifoldGeometry();

        const progress = requireFiniteNumber(progressOverride !== undefined
            ? progressOverride
            : (this.planeType === 'z' ? state.manifoldTransformationProgressZ : state.manifoldTransformationProgressW),
        'Manifold morph progress');

        const drawableSets = pointSets.filter(pointSet => Array.isArray(pointSet?.points) &&
            pointSet.points.length >= (pointSet.role === 'grid-dots' ? 1 : 2));

        drawableSets.forEach((pointSet) => {
            const colorHex = new THREE.Color(pointSet.color || 0x818cf8);
            const count = pointSet.points.length;

            const positions = new Float32Array(count * 3);
            const pointsData = new Array(count);

            for (let k = 0; k < count; k++) {
                const pt = pointSet.points[k];
                const x = Number.isFinite(pt?.re) ? pt.re : 0;
                const y = Number.isFinite(pt?.im) ? pt.im : 0;

                let u = x;
                let v = y;
                if (this.planeType === 'w' && this.activeMap && typeof this.activeMap.evaluate === 'function') {
                    const mapped = this.activeMap.evaluate(x, y);
                    if (Number.isFinite(mapped?.re) && Number.isFinite(mapped?.im)) {
                        u = mapped.re;
                        v = mapped.im;
                    }
                }

                pointsData[k] = { u, v };

                const morphed = this.manifold.morph(u, v, progress);
                positions[k * 3] = Number.isFinite(morphed.X) ? morphed.X : 0;
                positions[k * 3 + 1] = Number.isFinite(morphed.Y) ? morphed.Y : 0;
                positions[k * 3 + 2] = Number.isFinite(morphed.Z) ? morphed.Z : 0;
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.userData = { pointsData };

            const material = pointSet.role === 'grid-dots'
                ? new THREE.PointsMaterial({
                    color: colorHex,
                    size: 0.12,
                    sizeAttenuation: true,
                    transparent: true,
                    opacity: 0.95,
                    depthWrite: false,
                    depthTest: true
                })
                : new THREE.LineBasicMaterial({
                    color: colorHex,
                    transparent: true,
                    opacity: 0.95,
                    depthWrite: false,
                    depthTest: true
                });

            const object = pointSet.role === 'grid-dots'
                ? new THREE.Points(geometry, material)
                : new THREE.Line(geometry, material);

            this.linesGroup.add(object);
        });

        this.lastGeometryProgress = progress;
        this.updateOpacities(progress);
        this.renderDirty = true;
        this.render();
    }

    clearDynamicOverlay() {
        if (!this.dynamicOverlayGroup) return;
        disposeThreeObject(this.dynamicOverlayGroup);
        this.dynamicOverlayGroup.clear();
    }

    setDynamicOverlay(data, cacheKey = null) {
        if (cacheKey !== null && this.dynamicOverlayCacheKey === cacheKey) return false;
        this.clearDynamicOverlay();
        this.dynamicOverlayCacheKey = cacheKey;
        if (!data) {
            this.renderDirty = true;
            return true;
        }

        if (!Array.isArray(data.points) || !Array.isArray(data.path)) {
            throw new Error('Dynamic overlays require point and path arrays.');
        }

        const projectValues = values => {
            const positions = new Float32Array(values.length * 3);
            for (let i = 0; i < values.length; i++) {
                const pt = values[i];
                const p3d = this.manifold.project(pt.re, pt.im);
                positions[i * 3] = p3d.X;
                positions[i * 3 + 1] = p3d.Y;
                positions[i * 3 + 2] = p3d.Z;
            }
            return positions;
        };

        const pointPositions = projectValues(data.points);
        if (pointPositions.length > 0) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3));
            const material = new THREE.PointsMaterial({
                color: 0xd8dee9,
                size: 0.18,
                sizeAttenuation: true,
                transparent: true,
                opacity: 0.86,
                depthWrite: false
            });
            this.dynamicOverlayGroup.add(new THREE.Points(geometry, material));
        }

        const pathPositions = projectValues(data.path);
        if (pathPositions.length >= 6) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(pathPositions, 3));
            const material = new THREE.LineBasicMaterial({
                color: 0xa78bfa,
                transparent: true,
                opacity: 0.6,
                depthWrite: false
            });
            this.dynamicOverlayGroup.add(new THREE.Line(geometry, material));
        }

        if (data.finalPoint !== null && isFiniteComplex(data.finalPoint)) {
            const finalPositions = projectValues([data.finalPoint]);
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(finalPositions, 3));
            const material = new THREE.PointsMaterial({
                color: 0x5fc7a0,
                size: 0.35,
                sizeAttenuation: true,
                transparent: true,
                opacity: 0.96,
                depthWrite: false
            });
            this.dynamicOverlayGroup.add(new THREE.Points(geometry, material));
        }

        this.renderDirty = true;
        return true;
    }

    updateProbe(probePoint) {
        if (!probePoint || !Number.isFinite(probePoint.re) || !Number.isFinite(probePoint.im)) {
            const changed = this.markersGroup.visible || this.probePoint !== null;
            this.markersGroup.visible = false;
            this.probePoint = null;
            if (changed) this.renderDirty = true;
            return changed;
        }

        if (this.markersGroup.visible && this.probePoint &&
            this.probePoint.re === probePoint.re && this.probePoint.im === probePoint.im) {
            return false;
        }

        this.markersGroup.visible = true;
        this.probePoint = { re: probePoint.re, im: probePoint.im };
        this.updateProbeGeometry();
        this.renderDirty = true;
        return true;
    }

    updateProbeGeometry() {
        if (!this.probePoint || !this.manifold) return;
        const progress = this.planeType === 'z'
            ? state.manifoldTransformationProgressZ
            : state.manifoldTransformationProgressW;

        const x = this.probePoint.re;
        const y = this.probePoint.im;

        let u = x;
        let v = y;
        if (this.planeType === 'w' && this.activeMap && typeof this.activeMap.evaluate === 'function') {
            const mapped = this.activeMap.evaluate(x, y);
            if (Number.isFinite(mapped?.re) && Number.isFinite(mapped?.im)) {
                u = mapped.re;
                v = mapped.im;
            }
        }

        const activePos = this.manifold.morph(u, v, progress);
        const finalPos = this.manifold.project(u, v);

        this.activeMarker.position.set(activePos.X, activePos.Y, activePos.Z);
        this.targetMarker.position.set(finalPos.X, finalPos.Y, finalPos.Z);

        const positions = this.projectionRay.geometry.attributes.position.array;
        positions[0] = u;
        positions[1] = 0;
        positions[2] = v;
        positions[3] = activePos.X;
        positions[4] = activePos.Y;
        positions[5] = activePos.Z;

        this.projectionRay.geometry.attributes.position.needsUpdate = true;
        this.projectionRay.computeLineDistances();
    }

    updateGeometry(progress) {
        progress = requireFiniteNumber(progress, 'Manifold geometry progress');
        if (progress < 0 || progress > 1) throw new Error('Manifold progress must be between 0 and 1.');

        this.setManifold(state.selectedManifold);

        const progressChanged = this.lastGeometryProgress !== progress;
        let changed = progressChanged;

        if (progressChanged && this.linesGroup && this.manifold) {
            this.linesGroup.children.forEach(obj => {
                const pointsData = obj.geometry?.userData?.pointsData;
                if (!pointsData) return;

                const posArray = obj.geometry.attributes.position.array;
                for (let k = 0; k < pointsData.length; k++) {
                    const pt = pointsData[k];
                    const morphed = this.manifold.morph(pt.u, pt.v, progress);
                    posArray[k * 3] = Number.isFinite(morphed.X) ? morphed.X : 0;
                    posArray[k * 3 + 1] = Number.isFinite(morphed.Y) ? morphed.Y : 0;
                    posArray[k * 3 + 2] = Number.isFinite(morphed.Z) ? morphed.Z : 0;
                }
                obj.geometry.attributes.position.needsUpdate = true;
            });
        }

        if (progressChanged && this.rasterManifoldMesh && this.manifold) {
            const gridData = this.rasterManifoldMesh.geometry?.userData?.gridData;
            if (gridData) {
                const posArray = this.rasterManifoldMesh.geometry.attributes.position.array;
                for (let k = 0; k < gridData.length; k++) {
                    const pt = gridData[k];
                    if (pt.valid) {
                        const morphed = this.manifold.morph(pt.u, pt.v, progress);
                        posArray[k * 3] = Number.isFinite(morphed.X) ? morphed.X : 0;
                        posArray[k * 3 + 1] = Number.isFinite(morphed.Y) ? morphed.Y : 0;
                        posArray[k * 3 + 2] = Number.isFinite(morphed.Z) ? morphed.Z : 0;
                    } else {
                        posArray[k * 3] = 0;
                        posArray[k * 3 + 1] = 0;
                        posArray[k * 3 + 2] = 0;
                    }
                }
                this.rasterManifoldMesh.geometry.attributes.position.needsUpdate = true;
                this.rasterManifoldMesh.geometry.computeVertexNormals();
            }
        }

        if (progressChanged) {
            this.updateProbeGeometry();
            this.updateOpacities(progress);
        }
        this.lastGeometryProgress = progress;
        if (changed) this.renderDirty = true;
        return changed;
    }

    startAnimationLoop() {
        if (this.animationHandle) return;
        const animate = () => {
            this.animationHandle = null;
            const controlsChanged = Boolean(this.controls?.update?.());
            if (controlsChanged || this.renderDirty) this.render();
            if (controlsChanged) this.startAnimationLoop();
        };
        this.animationHandle = requestAnimationFrame(animate);
    }

    stopAnimationLoop() {
        if (this.animationHandle) {
            cancelAnimationFrame(this.animationHandle);
            this.animationHandle = null;
        }
    }

    resize() {
        if (!this.container || !this.camera || !this.renderer) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w === 0 || h === 0) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        this.pointerRectValid = false;
        this.renderDirty = true;
        this.render();
    }

    render() {
        if (!this.renderer || !this.scene || !this.camera) return;
        this.renderer.render(this.scene, this.camera);
        this.renderDirty = false;
    }

    dispose() {
        this.stopAnimationLoop();
        if (this.rasterManifoldMesh) {
            disposeThreeObject(this.rasterManifoldMesh);
            this.rasterManifoldMesh = null;
        }
        if (this.unsubscribeOpacities) {
            this.unsubscribeOpacities();
            this.unsubscribeOpacities = null;
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.onPointerUpClean) {
            window.removeEventListener('pointerup', this.onPointerUpClean);
            this.onPointerUpClean = null;
        }
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentElement) {
                this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
            }
            this.renderer = null;
        }
        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }
    }
}
