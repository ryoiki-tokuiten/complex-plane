import { state, zPlaneParams } from '../store/state.js';
import { ThreeRiemannRenderer } from './three-riemann-renderer.js';
import { generateCurrentInputShapePointSets, generateCurrentMappedInputShapePointSets } from './shape-generators.js';
import { resolveActiveMap } from '../math/active-map.js';

/**
 * ARCHITECTURAL DESIGN: Polymorphic Component Encapsulation (High Performance)
 * 
 * KEY OPTIMIZATIONS:
 * 1. Zero-Allocation Loop: Uses a pre-allocated array and classic loops to eliminate GC pressure.
 * 2. Dirty-Checking: DOM updates are strictly gated by state-change detection to prevent layout thrashing.
 * 3. Math Memoization: Transform profiles are cached to eliminate heavy CPU load during probe movement.
 * 4. Pure Polymorphism: Z and W planes are driven entirely by their config descriptors.
 */

const ANIMATION_DURATION = 4.0;
const BOUNCE_PAUSE_TIME = 1.5;

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function createPlaybackIcon(playing) {
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    if (!playing) {
        const path = document.createElementNS(SVG_NAMESPACE, 'path');
        path.setAttribute('d', 'M8 5v14l11-7z');
        svg.appendChild(path);
        return svg;
    }
    for (const x of ['6', '14']) {
        const rect = document.createElementNS(SVG_NAMESPACE, 'rect');
        Object.entries({ x, y: '4', width: '4', height: '16' })
            .forEach(([name, value]) => rect.setAttribute(name, value));
        svg.appendChild(rect);
    }
    return svg;
}

/**
 * Plane Configuration Descriptor
 * Centralizes the divergence between Z and W planes, including mathematical projection strategies.
 */
const PLANE_CONFIGS = {
    z: {
        containerId: 'z_plane_threejs_container',
        sliderId: 'z_transformation_progress_slider',
        buttonId: 'z_transformation_play_pause_btn',
        progressKey: 'riemannTransformationProgressZ',
        playingKey: 'riemannTransformationPlayingZ',
        generator: generateCurrentInputShapePointSets
    },
    w: {
        containerId: 'w_plane_threejs_container',
        sliderId: 'w_transformation_progress_slider',
        buttonId: 'w_transformation_play_pause_btn',
        progressKey: 'riemannTransformationProgressW',
        playingKey: 'riemannTransformationPlayingW',
        generator: generateCurrentMappedInputShapePointSets
    }
};

class PlaneController {
    constructor(id, config) {
        this.id = id;
        this.config = config;
        this.renderer = null;
        
        // Temporal state
        this.direction = 1;
        this.pauseTimer = 0;

        // DOM Cache
        this.ui = { slider: null, button: null };

        // State & Math Cache for Dirty-Checking
        this.cache = {
            progress: null,
            playing: null,
            mapSignature: null,
            map: null
        };
    }

    init() {
        const container = document.getElementById(this.config.containerId);
        if (container) {
            this.renderer = new ThreeRiemannRenderer(container, this.id);
        }
        this.ui.slider = document.getElementById(this.config.sliderId);
        this.ui.button = document.getElementById(this.config.buttonId);
    }

    build() {
        if (!this.renderer) return;
        this.cache.map = this.id === 'w' ? resolveActiveMap() : null;
        this.cache.mapSignature = this.cache.map?.signature || 'source';
        this.renderer.setTransform(this.cache.map?.evaluate || null);
        const pointSets = this.config.generator(zPlaneParams, {
            currentFunction: state.currentFunction,
            zetaContinuationEnabled: state.zetaContinuationEnabled,
            curvePoints: 250,
            gridDensity: state.gridDensity
        });
        this.renderer.buildGridFromPointSets(pointSets);
    }

    /**
     * Computes temporal progression. Returns true if actively playing.
     */
    updateAnimation(deltaTime) {
        const isPlaying = state[this.config.playingKey];
        if (!isPlaying) return false;

        if (this.pauseTimer > 0) {
            this.pauseTimer -= deltaTime;
            return true;
        }

        const deltaProgress = deltaTime / ANIMATION_DURATION;
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

    /**
     * Handles polymorphic spatial probe projection.
     */
    updateProbe(probeZ) {
        if (!this.renderer) return;
        if (!probeZ) {
            this.renderer.updateProbe(null);
            return;
        }
        
        const mappedProbe = this.id === 'w'
            ? this.cache.map?.evaluate?.(probeZ.re, probeZ.im)
            : probeZ;
        this.renderer.updateProbe(mappedProbe);
    }

    /**
     * Synchronizes the DOM using dirty-checking to prevent layout thrashing.
     */
    syncUI() {
        const currentProgress = state[this.config.progressKey];
        const currentPlaying = state[this.config.playingKey];

        // Sync Slider (Guarded against contention)
        if (currentProgress !== this.cache.progress) {
            if (this.ui.slider && document.activeElement !== this.ui.slider) {
                this.ui.slider.value = currentProgress;
            }
            this.cache.progress = currentProgress;
        }

        // Sync Button (Guarded against innerHTML thrashing)
        if (currentPlaying !== this.cache.playing) {
            if (this.ui.button) {
                this.ui.button.replaceChildren(createPlaybackIcon(currentPlaying));
                this.ui.button.classList.toggle('playing', currentPlaying);
            }
            this.cache.playing = currentPlaying;
        }
    }

    render(progress) {
        if (!this.renderer) return;
        this.renderer.updateGeometry(progress);
        this.renderer.render();
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
        // Drop DOM references to prevent memory leaks if container is destroyed
        this.ui.slider = null;
        this.ui.button = null;
    }
}

// Pre-allocate controllers to eliminate GC pressure
const controllers = Object.entries(PLANE_CONFIGS).map(([id, config]) => new PlaneController(id, config));
let animationHandle = null;
let lastFrameTime = 0;

/**
 * PUBLIC API - Frozen Signatures for downstream parity
 */

export function initThreeJSRenderers() {
    for (let i = 0; i < controllers.length; i++) controllers[i].init();
}

export function buildThreeJSMeshes() {
    for (let i = 0; i < controllers.length; i++) controllers[i].build();
}

export function startRiemannTransformationAnimation() {
    if (animationHandle) return;
    lastFrameTime = performance.now();

    function animateFrame(timestamp) {
        if (!state.riemannTransformationEnabled) {
            animationHandle = null;
            return;
        }

        const deltaTime = (timestamp - lastFrameTime) / 1000;
        lastFrameTime = timestamp;

        let isAnyPlaneMoving = false;

        // 1. Math Pipeline
        for (let i = 0; i < controllers.length; i++) {
            if (controllers[i].updateAnimation(deltaTime)) {
                isAnyPlaneMoving = true;
            }
        }

        // 2. Spatial Projection Pipeline
        const activeProbe = (state.probeActive && state.probeZ) ? state.probeZ : null;
        for (let i = 0; i < controllers.length; i++) {
            controllers[i].updateProbe(activeProbe);
        }

        // 3. WebGL Render Pipeline
        for (let i = 0; i < controllers.length; i++) {
            controllers[i].render(state[controllers[i].config.progressKey]);
        }

        // 4. DOM Sync Pipeline (Gated)
        if (isAnyPlaneMoving) {
            syncRiemannSliders();
        }

        animationHandle = requestAnimationFrame(animateFrame);
    }
    animationHandle = requestAnimationFrame(animateFrame);
}

export function stopRiemannTransformationAnimation() {
    state.riemannTransformationPlayingZ = false;
    state.riemannTransformationPlayingW = false;
    syncRiemannTransformationPlayPauseButton();
}

export function toggleRiemannTransformationAnimationZ() {
    state.riemannTransformationPlayingZ = !state.riemannTransformationPlayingZ;
    syncRiemannTransformationPlayPauseButton();
    if (state.riemannTransformationPlayingZ || state.riemannTransformationPlayingW) {
        startRiemannTransformationAnimation();
    }
}

export function toggleRiemannTransformationAnimationW() {
    state.riemannTransformationPlayingW = !state.riemannTransformationPlayingW;
    syncRiemannTransformationPlayPauseButton();
    if (state.riemannTransformationPlayingZ || state.riemannTransformationPlayingW) {
        startRiemannTransformationAnimation();
    }
}

export function resetRiemannTransformationAnimation() {
    stopRiemannTransformationAnimation();
    state.riemannTransformationProgressZ = 0.0;
    state.riemannTransformationProgressW = 0.0;
    
    for (let i = 0; i < controllers.length; i++) {
        controllers[i].resetTemporalState();
        controllers[i].render(0);
    }

    syncRiemannSliders();
    syncRiemannTransformationPlayPauseButton();
}

export function syncRiemannSliders() {
    for (let i = 0; i < controllers.length; i++) controllers[i].syncUI();
}

export function syncRiemannTransformationPlayPauseButton() {
    for (let i = 0; i < controllers.length; i++) controllers[i].syncUI();
}

export function disposeThreeJSRenderers() {
    if (animationHandle) {
        cancelAnimationFrame(animationHandle);
        animationHandle = null;
    }
    for (let i = 0; i < controllers.length; i++) controllers[i].dispose();
}

export function renderThreeJSFrame() {
    for (let i = 0; i < controllers.length; i++) {
        controllers[i].render(state[controllers[i].config.progressKey]);
    }
}
