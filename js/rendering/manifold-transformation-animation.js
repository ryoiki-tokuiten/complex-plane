import { state, context, zPlaneParams } from '../store/state.js';
import { ThreeManifoldsRenderer } from './3d-manifolds-renderer.js';
import { generateCurrentInputShapePointSets } from './shape-generators.js';
import { resolveActiveMap } from '../math/active-map.js';
import { getMediaSource, isMediaInputShape } from '../utils/raster-media.js';

const ANIMATION_DURATION = 4.0;
const BOUNCE_PAUSE_TIME = 1.0;

const PLANE_CONFIGS = {
    z: {
        containerKey: 'zPlaneThreejsContainer',
        progressKey: 'manifoldTransformationProgressZ',
        playingKey: 'manifoldTransformationPlayingZ',
        speedKey: 'manifoldTransformationSpeedZ',
        generator: generateCurrentInputShapePointSets
    },
    w: {
        containerKey: 'wPlaneThreejsContainer',
        progressKey: 'manifoldTransformationProgressW',
        playingKey: 'manifoldTransformationPlayingW',
        speedKey: 'manifoldTransformationSpeedW',
        generator: generateCurrentInputShapePointSets
    }
};

class PlaneController {
    constructor(id, config) {
        this.id = id;
        this.config = config;
        this.renderer = null;

        this.direction = 1;
        this.pauseTimer = 0;

        this.cache = {
            map: null,
            buildInputs: []
        };
    }

    init() {
        if (this.renderer) return;
        const container = context.controls[this.config.containerKey];
        if (!container) return;
        this.renderer = new ThreeManifoldsRenderer(container, this.id);
    }

    build(map = this.id === 'w' ? resolveActiveMap() : null) {
        if (!this.renderer) return;
        this.cache.map = map;

        this.renderer.setTransform(map);
        this.renderer.setManifold(state.selectedManifold);

        let initialProgress = state[this.config.progressKey] ?? 0;
        if (!state.manifoldTransformationEnabled && this.id === 'w') {
            initialProgress = 1.0;
        }

        if (isMediaInputShape()) {
            const source = getMediaSource();
            if (source) {
                this.renderer.buildRasterManifold(source, initialProgress);
                return;
            }
        }

        // Expanded wide domain parameters for rich grid coverage across entire manifold
        const range = 14.0;
        const expandedParams = {
            ...zPlaneParams,
            minX: -range,
            maxX: range,
            minY: -range,
            maxY: range
        };

        const pointSets = this.config.generator(expandedParams, {
            currentFunction: state.currentFunction,
            zetaContinuationEnabled: state.zetaContinuationEnabled,
            curvePoints: 350,
            gridDensity: Math.max(state.gridDensity, 20)
        });

        this.renderer.buildGridFromPointSets(pointSets, initialProgress);
    }

    updateAnimation(deltaTime) {
        const isPlaying = state[this.config.playingKey];
        if (!isPlaying) return false;

        if (this.pauseTimer > 0) {
            this.pauseTimer -= deltaTime;
            return true;
        }

        const speed = state[this.config.speedKey] || 1.0;
        const deltaProgress = (deltaTime * speed) / ANIMATION_DURATION;
        let progress = state[this.config.progressKey] + this.direction * deltaProgress;

        if (progress >= 1.0) {
            progress = 1.0;
            this.direction = -1;
            this.pauseTimer = BOUNCE_PAUSE_TIME;
        } else if (progress <= 0.0) {
            progress = 0.0;
            this.direction = 1;
            this.pauseTimer = BOUNCE_PAUSE_TIME;
        }

        state[this.config.progressKey] = progress;
        return true;
    }

    updateProbe(probeZ) {
        if (!this.renderer) return;
        if (!probeZ) {
            this.renderer.updateProbe(null);
            return;
        }
        this.renderer.updateProbe(probeZ);
    }

    syncRuntime() {
        const map = this.id === 'w' ? resolveActiveMap() : null;
        const buildInputs = [
            state.selectedManifold, state.currentInputShape, state.currentFunction,
            state.zetaContinuationEnabled, state.gridDensity, state.gridParameters,
            state.a0, state.b0, state.circleR,
            state.arbitraryShapeMode, state.arbitraryShapeExpression,
            state.arbitraryShapeTMin, state.arbitraryShapeTMax,
            state.arbitraryShapeClosed, state.arbitraryShapePoints,
            state.gridColor1, state.gridColor2,
            state.mediaSize, state.mediaAspectRatio, state.mediaVersion,
            map?.signature
        ];
        if (buildInputs.some((value, index) => value !== this.cache.buildInputs[index])) {
            this.cache.buildInputs = buildInputs;
            this.build(map);
        }
    }

    render(progress) {
        if (!this.renderer) return;
        this.renderer.updateGeometry(progress);
        if (this.renderer.renderDirty) this.renderer.render();
    }

    resetTemporalState() {
        this.direction = 1;
        this.pauseTimer = 0;
    }

    dispose() {
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }
        this.cache.buildInputs = [];
    }
}

const controllers = Object.entries(PLANE_CONFIGS).map(([id, config]) => new PlaneController(id, config));
let animationHandle = null;
let lastFrameTime = 0;

export function initThreeJSRenderers() {
    for (let i = 0; i < controllers.length; i++) controllers[i].init();
}

export function startManifoldTransformationAnimation() {
    if (animationHandle || !state.manifoldTransformationEnabled ||
        (!state.manifoldTransformationPlayingZ && !state.manifoldTransformationPlayingW)) return;
    lastFrameTime = performance.now();

    function animateFrame(timestamp) {
        if (!state.manifoldTransformationEnabled) {
            animationHandle = null;
            return;
        }

        const rawDelta = (timestamp - lastFrameTime) / 1000;
        const deltaTime = Number.isFinite(rawDelta) && rawDelta > 0 ? Math.min(rawDelta, 0.1) : 0.016;
        lastFrameTime = timestamp;

        let isAnyPlaneMoving = false;

        // 1. Animation Pipeline
        for (let i = 0; i < controllers.length; i++) {
            if (controllers[i].updateAnimation(deltaTime)) {
                isAnyPlaneMoving = true;
            }
        }

        if (isMediaInputShape() && state.videoIsPlaying) {
            isAnyPlaneMoving = true;
        }

        // 2. Spatial Probe Pipeline
        const activeProbe = (state.probeActive && state.probeZ) ? state.probeZ : null;
        for (let i = 0; i < controllers.length; i++) {
            controllers[i].updateProbe(activeProbe);
        }

        // 3. WebGL Render Pipeline
        for (let i = 0; i < controllers.length; i++) {
            controllers[i].render(state[controllers[i].config.progressKey]);
        }

        if (!isAnyPlaneMoving) {
            animationHandle = null;
            return;
        }

        animationHandle = requestAnimationFrame(animateFrame);
    }
    animationHandle = requestAnimationFrame(animateFrame);
}

export function stopManifoldTransformationAnimation() {
    if (animationHandle) {
        cancelAnimationFrame(animationHandle);
        animationHandle = null;
    }
    state.manifoldTransformationPlayingZ = false;
    state.manifoldTransformationPlayingW = false;
}

export function toggleManifoldTransformationAnimation(plane) {
    const controller = controllers.find(candidate => candidate.id === plane);
    if (!controller) throw new Error(`Unknown manifold plane: ${plane}.`);
    const key = controller.config.playingKey;
    state[key] = !state[key];
    if (state.manifoldTransformationPlayingZ || state.manifoldTransformationPlayingW) {
        startManifoldTransformationAnimation();
    }
}

export function setManifoldTransformationProgress(plane, progress) {
    const controller = controllers.find(candidate => candidate.id === plane);
    if (!controller) throw new Error(`Unknown manifold plane: ${plane}.`);
    const value = Math.max(0, Math.min(1, Number(progress)));
    state[controller.config.playingKey] = false;
    state[controller.config.progressKey] = value;
    controller.resetTemporalState();
    controller.render(value);
}

export function setManifoldTransformationSpeed(plane, speed) {
    const config = PLANE_CONFIGS[plane];
    if (!config) throw new Error(`Unknown manifold plane: ${plane}.`);
    state[config.speedKey] = Number(speed);
}

export function syncManifoldRenderers() {
    for (let i = 0; i < controllers.length; i++) controllers[i].syncRuntime();
}

export function disposeThreeJSRenderers() {
    if (animationHandle) {
        cancelAnimationFrame(animationHandle);
        animationHandle = null;
    }
    for (let i = 0; i < controllers.length; i++) controllers[i].dispose();
}
