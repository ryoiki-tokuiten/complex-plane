import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { state } from '../store/state.js';
import { requestRedrawAll } from './redraw-scheduler.js';
import {
    buildNativeFoldPreimageMarkers,
    buildNativeRiemannProbe,
    buildNativeRiemannSphereGeometry,
    buildNativeRiemannSpherePositions,
    interpolateNativeGeometry,
    nativeMapOptions
} from '../native/complex-engine.js';
import { disposeThreeObject } from './three-utils.js';


const COLOR_BACKGROUND = 0x0b0914;
const SPHERE_RADIUS = 5.0;

export class ThreeRiemannRenderer {
    constructor(containerElement, planeType = 'z') {
        this.container = containerElement;
        this.planeType = planeType;
        this.scale = 2 * SPHERE_RADIUS;
        this.isDragging = false;
        this.probePoint = null;
        this.animationHandle = null;
        this.renderDirty = true;
        this.lastGeometryProgress = null;
        this.lastGeometryStateKey = '';
        this.mapOptions = null;
        this.transformKey = null;
        this.sphereGeometryData = null;
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
        this.container.__threeRiemannRenderer = this;
    }

    initScene() {
        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(COLOR_BACKGROUND, 0.012);

        // Camera setup
        const aspect = this.container.clientWidth / this.container.clientHeight || 1;
        this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
        this.camera.position.set(25, 20, 35);

        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(COLOR_BACKGROUND);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        
        // Clear old children if any
        this.container.replaceChildren();
        this.container.appendChild(this.renderer.domElement);

        // Orbit controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.target.set(0, SPHERE_RADIUS * 0.5, 0);
        this.controls.addEventListener('change', () => {
            this.renderDirty = true;
            this.startAnimationLoop();
        });

        // Static Grid
        this.staticGrid = new THREE.GridHelper(60, 40, 0x222233, 0x1a1a25);
        this.staticGrid.position.y = -0.1;
        this.scene.add(this.staticGrid);

        this.ghostSphere = new THREE.Mesh(
            new THREE.SphereGeometry(SPHERE_RADIUS, 64, 64).translate(0, SPHERE_RADIUS, 0),
            new THREE.MeshBasicMaterial({ 
                color: 0x2a254a, 
                transparent: true, 
                opacity: 0.0, 
                depthWrite: false, 
                blending: THREE.AdditiveBlending 
            })
        );
        this.scene.add(this.ghostSphere);

        // Intrinsic Sphere Latitude/Longitude Grid
        const gridDensity = state.gridDensity !== undefined ? state.gridDensity : 12;
        const widthSegments = Math.max(8, gridDensity * 4);
        const heightSegments = Math.max(8, gridDensity*2);
        
        const sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, widthSegments, heightSegments).translate(0, SPHERE_RADIUS, 0);
        const wireframeGeo = new THREE.WireframeGeometry(sphereGeo);
        
        this.wireframeSphere = new THREE.LineSegments(
            wireframeGeo,
            new THREE.LineBasicMaterial({
                color: 0x8888aa,
                transparent: true,
                opacity: 0.15,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            })
        );
        this.wireframeSphere.userData = { widthSegments, heightSegments };
        this.scene.add(this.wireframeSphere);

        // North Pole indicator
        this.northPole = new THREE.Mesh(
            new THREE.SphereGeometry(0.15, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        this.northPole.position.set(0, SPHERE_RADIUS * 2, 0);
        this.scene.add(this.northPole);

        // Groups
        this.linesGroup = new THREE.Group();
        this.scene.add(this.linesGroup);

        this.dynamicOverlayGroup = new THREE.Group();
        this.dynamicOverlayGroup.renderOrder = 20;
        this.scene.add(this.dynamicOverlayGroup);

        this.rasterSurfaceGroup = new THREE.Group();
        this.rasterSurfaceGroup.visible = false;
        this.scene.add(this.rasterSurfaceGroup);

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

        // Interactive markers
        this.activeMarker = new THREE.Mesh(
            new THREE.SphereGeometry(0.4, 32, 32),
            new THREE.MeshBasicMaterial({ color: 0xf43f5e }) // Pink
        );
        this.sphereMarker = new THREE.Mesh(
            new THREE.SphereGeometry(0.3, 32, 32),
            new THREE.MeshBasicMaterial({ color: 0x22d3ee }) // Cyan
        );

        const rayMaterial = new THREE.LineDashedMaterial({
            color: 0xfcd34d, dashSize: 0.5, gapSize: 0.3, linewidth: 2, transparent: true, opacity: 0.8
        });
        const rayGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, SPHERE_RADIUS * 2, 0),
            new THREE.Vector3(0, 0, 0)
        ]);
        this.projectionRay = new THREE.Line(rayGeo, rayMaterial);
        this.projectionRay.computeLineDistances();

        this.markersGroup.add(this.activeMarker);
        this.markersGroup.add(this.sphereMarker);
        this.markersGroup.add(this.projectionRay);
        this.markersGroup.visible = false;

        // Auto-resizing using ResizeObserver
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.container);
    }

    initInteraction() {
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Invisible plane for raycasting
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
                    const u = intersects[0].point.x / this.scale;
                    const v = intersects[0].point.z / this.scale;
                    state.probeZ = { re: u, im: v };
                    requestRedrawAll();
                }
            });

            this.renderer.domElement.addEventListener('pointermove', (e) => {
                if (!this.isDragging || !state.probeActive) return;

                this.updatePointerNdc(e);

                this.raycaster.setFromCamera(this.mouse, this.camera);
                const intersects = this.raycaster.intersectObject(this.dragPlane);
                if (intersects.length > 0) {
                    const u = intersects[0].point.x / this.scale;
                    const v = intersects[0].point.z / this.scale;
                    state.probeZ = { re: u, im: v };
                    requestRedrawAll();
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
        this.mapOptions = map ? nativeMapOptions(state, {
            stage: map.stage,
            derivativeMode: map.presentation === 'derivative',
            ...(map.evaluate?.nativeMapOptions || map.nativeMapOptions || {})
        }) : null;
        this.transformKey = nextTransformKey;
        if (changed) this.renderDirty = true;
        return changed;
    }

    setFoldSurfaceMode(mode) {
        const changed = this.foldSurfaceMode !== mode;
        this.foldSurfaceMode = mode;
        this.rasterSurfaceGroup.visible = mode === 'raster';
        this.gridFoldSurfaceGroup.visible = mode === 'grid';
        this.staticGrid.visible = true;
        this.ghostSphere.visible = false;
        this.wireframeSphere.visible = false;
        this.northPole.visible = false;
        this.linesGroup.visible = false;
        this.dynamicOverlayGroup.visible = false;
        this.markersGroup.visible = false;
        if (this.dragPlane) this.dragPlane.visible = false;
        if (changed) {
            this.renderDirty = true;
        }
        return changed;
    }

    setSphereMode() {
        const changed = this.foldSurfaceMode !== null;
        this.foldSurfaceMode = null;
        this.rasterSurfaceGroup.visible = false;
        this.gridFoldSurfaceGroup.visible = false;
        this.rasterSurfaceKey = null;
        this.gridFoldSurfaceKey = null;
        this.staticGrid.visible = true;
        this.ghostSphere.visible = true;
        this.wireframeSphere.visible = true;
        this.northPole.visible = true;
        this.linesGroup.visible = true;
        this.dynamicOverlayGroup.visible = true;
        this.markersGroup.visible = Boolean(this.probePoint);
        this.foldPreimageGroup.visible = false;
        this.foldPreimageKey = '';
        if (this.dragPlane) this.dragPlane.visible = true;
        if (changed) {
            this.renderDirty = true;
        }
        return changed;
    }

    setRasterSurface(data, source, opacity = 1, heightScale = 1) {
        if (!data || !source) return false;

        const hasGeometry = Boolean(data.indices?.length);
        const nextHeightScale = Number.isFinite(Number(heightScale))
            ? Math.max(0, Number(heightScale))
            : 1;
        this.setFoldSurfaceMode('raster');

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
            const { foldPositions, foldUvs, foldMapping, indices } = data;

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(foldPositions, 3));
            geometry.setAttribute('uv', new THREE.BufferAttribute(foldUvs, 2));
            geometry.setIndex(new THREE.BufferAttribute(indices, 1));
            geometry.computeBoundingSphere();
            this.rasterSurfaceMesh.geometry.dispose();
            this.rasterSurfaceMesh.geometry = geometry;
            this.foldMapping = foldMapping;
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

        const nextOpacity = Math.max(0, Math.min(1, Number(opacity) || 0));
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
        const nextKey = state.preimageExplorerEnabled && mapping?.scale && target && Array.isArray(roots) && roots.length
            ? [
                this.foldSurfaceMode, heightScale, mapping.mappedCenterX, mapping.mappedCenterY,
                mapping.sourceCenter, mapping.scale, target.re, target.im,
                map?.signature || '', ...roots.flatMap(root => [root?.re, root?.im])
            ].join('|')
            : '';
        if (this.foldPreimageKey === nextKey) return;
        this.foldPreimageKey = nextKey;
        while (this.foldPreimageGroup.children.length) {
            const child = this.foldPreimageGroup.children[0];
            child.geometry?.dispose?.();
            child.material?.dispose?.();
            this.foldPreimageGroup.remove(child);
        }
        this.foldPreimageGroup.clear();
        if (!state.preimageExplorerEnabled || !mapping?.scale || !target || !Array.isArray(roots) || !roots.length) {
            this.foldPreimageGroup.visible = false;
            this.renderDirty = true;
            return;
        }
        const positions = buildNativeFoldPreimageMarkers({
            mapOptions: nativeMapOptions(state, {
                stage: map?.stage,
                derivativeMode: map?.presentation === 'derivative',
                ...(map?.evaluate?.nativeMapOptions || map?.nativeMapOptions || {})
            }),
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

    setGridFoldSurface(data, heightScale = 1) {
        if (!data) return false;

        this.setFoldSurfaceMode('grid');
        this.foldMapping = data.mapping || null;
        const nextHeightScale = Number.isFinite(Number(heightScale))
            ? Math.max(0, Number(heightScale))
            : 1;
        if (this.gridFoldSurfaceData === data && this.gridFoldHeightScale === nextHeightScale) return true;

        disposeThreeObject(this.gridFoldSurfaceGroup);
        this.gridFoldSurfaceGroup.clear();

        for (const lineData of data.lines || []) {
            if (!(lineData.positions instanceof Float32Array) || lineData.positions.length < 6) continue;

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(lineData.positions, 3));

            let color = 0xa78bfa;
            if (lineData.color) {
                try {
                    color = new THREE.Color(lineData.color);
                } catch {}
            }

            const material = new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity: 0.82,
                depthWrite: true
            });
            this.gridFoldSurfaceGroup.add(new THREE.Line(geometry, material));
        }
        for (const pointData of data.points || []) {
            if (!(pointData.positions instanceof Float32Array) || pointData.positions.length < 3) continue;
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(pointData.positions, 3));
            const material = new THREE.PointsMaterial({ color: pointData.color || 0xa78bfa, size: 0.09, sizeAttenuation: true });
            this.gridFoldSurfaceGroup.add(new THREE.Points(geometry, material));
        }

        this.gridFoldSurfaceData = data;
        this.gridFoldHeightScale = nextHeightScale;
        this.renderDirty = true;
        return true;
    }

    buildGridFromPointSets(pointSets, progressOverride = undefined) {
        this.resize();
        this.setSphereMode();
        disposeThreeObject(this.linesGroup);
        this.linesGroup.clear();
        this.scale = 2 * SPHERE_RADIUS;
        const drawableSets = (pointSets || []).filter(pointSet => pointSet?.points?.length >=
            (pointSet.role === 'grid-dots' ? 1 : 2));
        const progress = progressOverride !== undefined
            ? progressOverride
            : (this.planeType === 'z' ? state.riemannTransformationProgressZ : state.riemannTransformationProgressW);
        const nativeGeometry = buildNativeRiemannSphereGeometry({
            mapPoints: this.planeType === 'w',
            mapOptions: this.mapOptions,
            scale: this.scale,
            radius: SPHERE_RADIUS,
            progress
        }, drawableSets);
        this.sphereGeometryData = nativeGeometry;

        drawableSets.forEach((pointSet, setIndex) => {
            let colorHex = 0xa78bfa;
            if (pointSet.color) {
                try {
                    colorHex = new THREE.Color(pointSet.color);
                } catch {}
            }

            const material = pointSet.role === 'grid-dots'
                ? new THREE.PointsMaterial({
                    color: colorHex,
                    size: 0.08,
                    sizeAttenuation: true,
                    transparent: true,
                    opacity: 0.75,
                    depthWrite: false
                })
                : new THREE.LineBasicMaterial({
                    color: colorHex,
                    transparent: true,
                    opacity: 0.6,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false
                });

            const geometry = new THREE.BufferGeometry();
            const start = nativeGeometry.offsets[setIndex] * 3;
            const end = nativeGeometry.offsets[setIndex + 1] * 3;
            const positions = new Float32Array(nativeGeometry.positions.subarray(start, end));
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.userData = { start, end };
            
            const object = pointSet.role === 'grid-dots'
                ? new THREE.Points(geometry, material)
                : new THREE.Line(geometry, material);
            this.linesGroup.add(object);
        });

        this.lastGeometryProgress = progress;
        this.lastGeometryStateKey = '';
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

        const spherePositions = values => buildNativeRiemannSpherePositions(
            (values || []).filter(value => Number.isFinite(value?.re) && Number.isFinite(value?.im)),
            this.scale,
            SPHERE_RADIUS
        );

        const pointPositions = spherePositions(data.points);
        if (pointPositions.length > 0) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute(
                'position',
                new THREE.BufferAttribute(pointPositions, 3)
            );
            const material = new THREE.PointsMaterial({
                color: 0xd8dee9,
                size: Math.max(0.1, Math.min(0.28, Number(data.pointSize) * 0.038)),
                sizeAttenuation: true,
                transparent: true,
                opacity: 0.86,
                depthWrite: false
            });
            this.dynamicOverlayGroup.add(new THREE.Points(geometry, material));
        }
        this.renderDirty = true;

        const pathPositions = spherePositions(data.path);
        if (pathPositions.length >= 6) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute(
                'position',
                new THREE.BufferAttribute(pathPositions, 3)
            );
            const material = new THREE.LineBasicMaterial({
                color: 0xa78bfa,
                transparent: true,
                opacity: 0.56,
                depthWrite: false
            });
            this.dynamicOverlayGroup.add(new THREE.Line(geometry, material));
        }

        const finalPositions = spherePositions(data.finalPoint ? [data.finalPoint] : []);
        if (finalPositions.length === 3) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute(
                'position',
                new THREE.BufferAttribute(finalPositions, 3)
            );
            const material = new THREE.PointsMaterial({
                color: 0x5fc7a0,
                size: 0.3,
                sizeAttenuation: true,
                transparent: true,
                opacity: 0.96,
                depthWrite: false
            });
            this.dynamicOverlayGroup.add(new THREE.Points(geometry, material));
        }
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
        if (!this.probePoint) return;
        const progress = this.planeType === 'z' ? state.riemannTransformationProgressZ : state.riemannTransformationProgressW;
        const geometry = buildNativeRiemannProbe({
            mapPoints: this.planeType === 'w',
            mapOptions: this.mapOptions,
            scale: this.scale,
            radius: SPHERE_RADIUS,
            progress
        }, this.probePoint);
        this.activeMarker.position.fromArray(geometry.active);
        this.sphereMarker.position.fromArray(geometry.sphere);
        const positions = this.projectionRay.geometry.attributes.position.array;
        positions.set(geometry.ray);
        this.projectionRay.geometry.attributes.position.needsUpdate = true;
        this.projectionRay.computeLineDistances();
    }

    updateGeometry(progress) {
        const easedProgress = -(Math.cos(Math.PI * progress) - 1) / 2;
        const progressChanged = this.lastGeometryProgress !== progress;
        let changed = progressChanged;

        if (progressChanged && this.sphereGeometryData) {
            const positions = interpolateNativeGeometry(
                this.sphereGeometryData.start,
                this.sphereGeometryData.target,
                progress
            );
            this.linesGroup.children.forEach(line => {
                const { start, end } = line.geometry.userData;
                line.geometry.attributes.position.array.set(positions.subarray(start, end));
                line.geometry.attributes.position.needsUpdate = true;
            });
        }

        const maxOpacity = state.threeSphereOpacity !== undefined ? state.threeSphereOpacity : 0.15;
        const density = state.gridDensity !== undefined ? state.gridDensity : 12;
        const widthSegments = Math.max(8, density * 2);
        const heightSegments = Math.max(8, density);
        const gridOpacity = state.sphereGridOpacity !== undefined ? state.sphereGridOpacity : 0.0;
        const geometryStateKey = `${easedProgress}|${maxOpacity}|${gridOpacity}|${widthSegments}|${heightSegments}`;
        const geometryStateChanged = this.lastGeometryStateKey !== geometryStateKey;

        if (geometryStateChanged) {
            changed = true;
            this.lastGeometryStateKey = geometryStateKey;
        }

        if (this.ghostSphere.material && geometryStateChanged) {
            this.ghostSphere.material.opacity = Math.pow(easedProgress, 2) * maxOpacity;
        }

        if (this.wireframeSphere) {
            this.wireframeSphere.visible = true;
            if (this.wireframeSphere.userData.widthSegments !== widthSegments || 
                this.wireframeSphere.userData.heightSegments !== heightSegments) {
                changed = true;
                
                this.wireframeSphere.geometry.dispose();
                
                const newSphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, widthSegments, heightSegments).translate(0, SPHERE_RADIUS, 0);
                this.wireframeSphere.geometry = new THREE.WireframeGeometry(newSphereGeo);
                
                this.wireframeSphere.userData = { widthSegments, heightSegments };
            }

            if (geometryStateChanged) {
                this.wireframeSphere.material.opacity = Math.pow(easedProgress, 2) * gridOpacity;
            }
        }

        if (progressChanged) this.updateProbeGeometry();
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
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        if (this.onPointerUpClean) {
            window.removeEventListener('pointerup', this.onPointerUpClean);
        }
        if (this.controls) {
            this.controls.dispose();
        }
        disposeThreeObject(this.scene);
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }
        if (this.container?.__threeRiemannRenderer === this) {
            delete this.container.__threeRiemannRenderer;
        }
    }
}
