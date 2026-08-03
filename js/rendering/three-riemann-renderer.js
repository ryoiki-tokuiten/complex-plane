import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { state } from '../store/state.js';
import { requestRedrawAll } from './redraw-scheduler.js';
import { getChainedTransformFunction } from '../math-utils.js';
import { normalizeDomainDynamicsChainCount } from '../constants/domain-dynamics.js';


const COLOR_BACKGROUND = 0x0b0914;
const SPHERE_RADIUS = 5.0;

function getSphereCoordinate(u, v, radius = SPHERE_RADIUS) {
    const r2 = u * u + v * v;
    const R2 = radius * radius;
    const denom = r2 + 4 * R2 + 1e-10; 
    
    const x = (4 * R2 * u) / denom;
    const y = (2 * radius * r2) / denom;
    const z = (4 * R2 * v) / denom;
    
    return { x, y, z };
}

function usableRange(range) {
    return Array.isArray(range) && range.length >= 2 &&
        Number.isFinite(range[0]) && Number.isFinite(range[1]) && range[1] > range[0]
        ? range
        : null;
}

function isInsideRange(value, range) {
    return !range || (value >= range[0] && value <= range[1]);
}

export function buildGridFoldLineData(pointSets, transform, options = {}) {
    if (!Array.isArray(pointSets) || typeof transform !== 'function') return null;

    const sourceXRange = usableRange(options.sourceXRange);
    const outputXRange = usableRange(options.outputXRange);
    const outputYRange = usableRange(options.outputYRange);
    const rawLines = [];
    let minMappedX = Infinity;
    let maxMappedX = -Infinity;
    let minMappedY = Infinity;
    let maxMappedY = -Infinity;
    let minSourceX = Infinity;
    let maxSourceX = -Infinity;

    for (const pointSet of pointSets) {
        if (!Array.isArray(pointSet?.points)) continue;

        let line = [];
        const flushLine = () => {
            if (line.length >= 2) {
                rawLines.push({ points: line, color: pointSet.color });
                for (const point of line) {
                    minMappedX = Math.min(minMappedX, point.mappedRe);
                    maxMappedX = Math.max(maxMappedX, point.mappedRe);
                    minMappedY = Math.min(minMappedY, point.mappedIm);
                    maxMappedY = Math.max(maxMappedY, point.mappedIm);
                    minSourceX = Math.min(minSourceX, point.sourceRe);
                    maxSourceX = Math.max(maxSourceX, point.sourceRe);
                }
            }
            line = [];
        };

        for (const sourcePoint of pointSet.points) {
            if (!Number.isFinite(sourcePoint?.re) || !Number.isFinite(sourcePoint?.im)) {
                flushLine();
                continue;
            }

            let mappedPoint = null;
            try {
                mappedPoint = transform(sourcePoint.re, sourcePoint.im);
            } catch {
                mappedPoint = null;
            }

            if (!Number.isFinite(mappedPoint?.re) || !Number.isFinite(mappedPoint?.im) ||
                !isInsideRange(mappedPoint.re, outputXRange) ||
                !isInsideRange(mappedPoint.im, outputYRange)) {
                flushLine();
                continue;
            }

            line.push({
                sourceRe: sourcePoint.re,
                mappedRe: mappedPoint.re,
                mappedIm: mappedPoint.im
            });
        }
        flushLine();
    }

    if (rawLines.length === 0) return { lines: [] };

    const sourceMin = sourceXRange?.[0] ?? minSourceX;
    const sourceMax = sourceXRange?.[1] ?? maxSourceX;
    const sourceCenter = (sourceMin + sourceMax) * 0.5;
    const mappedCenterX = (minMappedX + maxMappedX) * 0.5;
    const mappedCenterY = (minMappedY + maxMappedY) * 0.5;
    const span = Math.max(
        maxMappedX - minMappedX,
        maxMappedY - minMappedY,
        sourceMax - sourceMin,
        1e-6
    );
    const scale = (2 * SPHERE_RADIUS) / span;

    return {
        lines: rawLines.map(rawLine => {
            const positions = new Float32Array(rawLine.points.length * 3);
            for (let index = 0; index < rawLine.points.length; index += 1) {
                const point = rawLine.points[index];
                const offset = index * 3;
                positions[offset] = (point.mappedRe - mappedCenterX) * scale;
                positions[offset + 1] = (point.sourceRe - sourceCenter) * scale;
                positions[offset + 2] = (point.mappedIm - mappedCenterY) * scale;
            }
            return { positions, color: rawLine.color };
        })
    };
}

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
        this.transformFunction = null;
        this.transformKey = null;
        this.chainCount = 1;
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
        const widthSegments = Math.max(8, gridDensity * 2);
        const heightSegments = Math.max(8, gridDensity);
        
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

    setTransform(transformFunction, chainCount = 1, transformKey = null) {
        const nextTransform = typeof transformFunction === 'function' ? transformFunction : null;
        const nextChainCount = normalizeDomainDynamicsChainCount(chainCount);
        const nextTransformKey = transformKey === null ? nextTransform : transformKey;
        const changed = this.transformKey !== nextTransformKey || this.chainCount !== nextChainCount;
        this.transformFunction = nextTransform;
        this.transformKey = nextTransformKey;
        this.chainCount = nextChainCount;
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
            this.controls.target.set(0, 0, 0);
            this.controls.update();
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
        if (this.dragPlane) this.dragPlane.visible = true;
        if (changed) {
            this.controls.target.set(0, SPHERE_RADIUS * 0.5, 0);
            this.controls.update();
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
            const { bounds, sourceCenter, sourceSize, vertices, mappedPositions, indices } = data;
            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;

            for (let i = 0; i < mappedPositions.length; i += 2) {
                const x = bounds.x0 + (mappedPositions[i] + 1) * bounds.xSpan * 0.5;
                const y = bounds.y0 + (mappedPositions[i + 1] + 1) * bounds.ySpan * 0.5;
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            }

            const outputSpan = Math.max(maxX - minX, maxY - minY, sourceSize.width, 1e-6);
            const scale = (2 * SPHERE_RADIUS) / outputSpan;
            const centerX = (minX + maxX) * 0.5;
            const centerY = (minY + maxY) * 0.5;
            const positions = new Float32Array(vertices.length / 2 * 3);
            const uvs = new Float32Array(vertices.length);

            for (let i = 0; i < vertices.length; i += 2) {
                const vertexIndex = (i / 2) * 3;
                const mappedX = bounds.x0 + (mappedPositions[i] + 1) * bounds.xSpan * 0.5;
                const mappedY = bounds.y0 + (mappedPositions[i + 1] + 1) * bounds.ySpan * 0.5;
                const sourceRe = sourceCenter.re + (vertices[i] * 2 - 1) * sourceSize.width * 0.5;
                positions[vertexIndex] = (mappedX - centerX) * scale;
                positions[vertexIndex + 1] = (sourceRe - sourceCenter.re) * scale * nextHeightScale;
                positions[vertexIndex + 2] = (mappedY - centerY) * scale;
                uvs[i] = vertices[i];
                uvs[i + 1] = 1 - vertices[i + 1];
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
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

        const nextOpacity = Math.max(0, Math.min(1, Number(opacity) || 0));
        if (material.opacity !== nextOpacity) {
            material.opacity = nextOpacity;
            material.needsUpdate = true;
        }
        this.renderDirty = true;
        return true;
    }

    setGridFoldSurface(data, heightScale = 1) {
        if (!data) return false;

        this.setFoldSurfaceMode('grid');
        const nextHeightScale = Number.isFinite(Number(heightScale))
            ? Math.max(0, Number(heightScale))
            : 1;
        if (this.gridFoldSurfaceData === data && this.gridFoldHeightScale === nextHeightScale) return true;

        while (this.gridFoldSurfaceGroup.children.length > 0) {
            const line = this.gridFoldSurfaceGroup.children[0];
            this.gridFoldSurfaceGroup.remove(line);
            line.geometry.dispose();
            line.material.dispose();
        }

        for (const lineData of data.lines || []) {
            if (!(lineData.positions instanceof Float32Array) || lineData.positions.length < 6) continue;

            const geometry = new THREE.BufferGeometry();
            const positions = lineData.positions.slice();
            for (let index = 1; index < positions.length; index += 3) {
                positions[index] *= nextHeightScale;
            }
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

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

        this.gridFoldSurfaceData = data;
        this.gridFoldHeightScale = nextHeightScale;
        this.renderDirty = true;
        return true;
    }

    buildGridFromPointSets(pointSets, progressOverride = undefined) {
        this.resize();
        this.setSphereMode();

        // Clear lines
        while(this.linesGroup.children.length > 0) {
            const child = this.linesGroup.children[0];
            child.geometry.dispose();
            child.material.dispose();
            this.linesGroup.remove(child);
        }

        // Constant mathematical scale factor where unit circle projects to equator
        this.scale = 2 * SPHERE_RADIUS;

        const transformFunc = this.planeType === 'w'
            ? (this.transformFunction || getChainedTransformFunction())
            : null;

        for (const pointSet of pointSets) {
            if (!pointSet || !pointSet.points || pointSet.points.length < 2) continue;
            
            const pts = pointSet.points;
            const count = pts.length;

            let colorHex = 0xa78bfa;
            if (pointSet.color) {
                try {
                    colorHex = new THREE.Color(pointSet.color);
                } catch {}
            }

            const material = new THREE.LineBasicMaterial({
                color: colorHex,
                transparent: true,
                opacity: 0.6,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });

            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(count * 3);
            const startPositions = new Float32Array(count * 3);
            const targetPositions = new Float32Array(count * 3);

            for (let i = 0; i < count; i++) {
                const pt = pts[i];
                const mappedPt = transformFunc && pt && Number.isFinite(pt.re) && Number.isFinite(pt.im) 
                    ? transformFunc(pt.re, pt.im) 
                    : pt;

                let u = NaN;
                let v = NaN;
                let tx = NaN;
                let ty = NaN;
                let tz = NaN;

                if (mappedPt && Number.isFinite(mappedPt.re) && Number.isFinite(mappedPt.im)) {
                    u = mappedPt.re * this.scale;
                    v = mappedPt.im * this.scale;
                    const target = getSphereCoordinate(u, v, SPHERE_RADIUS);
                    tx = target.x;
                    ty = target.y;
                    tz = target.z;
                }

                startPositions[i * 3] = Number.isFinite(u) ? u : NaN;
                startPositions[i * 3 + 1] = 0;
                startPositions[i * 3 + 2] = Number.isFinite(v) ? v : NaN;

                targetPositions[i * 3] = Number.isFinite(tx) ? tx : NaN;
                targetPositions[i * 3 + 1] = Number.isFinite(ty) ? ty : NaN;
                targetPositions[i * 3 + 2] = Number.isFinite(tz) ? tz : NaN;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.userData = { start: startPositions, target: targetPositions };
            
            const line = new THREE.Line(geometry, material);
            this.linesGroup.add(line);
        }

        // Apply geometry snapping
        const progress = progressOverride !== undefined 
            ? progressOverride 
            : (this.planeType === 'z' ? state.riemannTransformationProgressZ : state.riemannTransformationProgressW);
        this.lastGeometryProgress = null;
        this.lastGeometryStateKey = '';
        this.updateGeometry(progress);
        this.render();
    }

    clearDynamicOverlay() {
        if (!this.dynamicOverlayGroup) return;

        while (this.dynamicOverlayGroup.children.length > 0) {
            const child = this.dynamicOverlayGroup.children[0];
            this.dynamicOverlayGroup.remove(child);
            child.geometry?.dispose();
            if (Array.isArray(child.material)) {
                child.material.forEach(material => material.dispose());
            } else {
                child.material?.dispose();
            }
        }
    }

    setDynamicOverlay(data, cacheKey = null) {
        if (cacheKey !== null && this.dynamicOverlayCacheKey === cacheKey) return false;
        this.clearDynamicOverlay();
        this.dynamicOverlayCacheKey = cacheKey;
        if (!data) {
            this.renderDirty = true;
            return true;
        }

        const spherePositions = values => {
            const positions = [];
            for (const value of values || []) {
                if (!Number.isFinite(value?.re) || !Number.isFinite(value?.im)) continue;
                const projected = getSphereCoordinate(
                    value.re * this.scale,
                    value.im * this.scale,
                    SPHERE_RADIUS
                );
                positions.push(projected.x, projected.y, projected.z);
            }
            return positions;
        };

        const pointPositions = spherePositions(data.points);
        if (pointPositions.length > 0) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute(
                'position',
                new THREE.Float32BufferAttribute(pointPositions, 3)
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
                new THREE.Float32BufferAttribute(pathPositions, 3)
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
                new THREE.Float32BufferAttribute(finalPositions, 3)
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
        
        const u = this.probePoint.re * this.scale;
        const v = this.probePoint.im * this.scale;

        const flatPos = new THREE.Vector3(u, 0, v);
        const sphereTarget = getSphereCoordinate(u, v, SPHERE_RADIUS);
        const spherePos = new THREE.Vector3(sphereTarget.x, sphereTarget.y, sphereTarget.z);

        const progress = this.planeType === 'z' ? state.riemannTransformationProgressZ : state.riemannTransformationProgressW;
        const easedProgress = -(Math.cos(Math.PI * progress) - 1) / 2;

        this.activeMarker.position.lerpVectors(flatPos, spherePos, easedProgress);
        this.sphereMarker.position.copy(spherePos);

        const positions = this.projectionRay.geometry.attributes.position.array;
        positions[0] = 0; positions[1] = SPHERE_RADIUS * 2; positions[2] = 0;
        positions[3] = u; positions[4] = 0; positions[5] = v;
        
        this.projectionRay.geometry.attributes.position.needsUpdate = true;
        this.projectionRay.computeLineDistances();
    }

    updateGeometry(progress) {
        const easedProgress = -(Math.cos(Math.PI * progress) - 1) / 2;
        const progressChanged = this.lastGeometryProgress !== progress;
        let changed = progressChanged;

        if (progressChanged) {
            this.linesGroup.children.forEach(line => {
                const positions = line.geometry.attributes.position.array;
                const start = line.geometry.userData.start;
                const target = line.geometry.userData.target;

                for (let i = 0; i < positions.length; i++) {
                    positions[i] = start[i] + (target[i] - start[i]) * easedProgress;
                }
                line.geometry.attributes.position.needsUpdate = true;
            });
        }

        this.updateSphereMaterial();

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

    updateSphereMaterial() {
        if (!this.ghostSphere) return;

        if (this.ghostSphere.material instanceof THREE.ShaderMaterial) {
            this.ghostSphere.material.dispose();
            this.ghostSphere.material = null;
        }
        if (!this.ghostSphere.material || this.ghostSphere.material.type !== 'MeshBasicMaterial') {
            this.ghostSphere.material = new THREE.MeshBasicMaterial({ 
                color: 0x2a254a, 
                transparent: true, 
                depthWrite: false, 
                blending: THREE.AdditiveBlending 
            });
        }
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
        this.scene.traverse((object) => {
            if (object.geometry) object.geometry.dispose();
            if (object.material) {
                if (object.material.map) object.material.map.dispose();
                if (Array.isArray(object.material)) {
                    object.material.forEach(mat => mat.dispose());
                } else {
                    object.material.dispose();
                }
            }
        });
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
