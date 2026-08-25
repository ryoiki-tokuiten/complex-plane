import { state, zPlaneParams } from '../store/state.js';
import { ThreeManifoldsRenderer } from './3d-manifolds-renderer.js';
import { generateCurrentInputShapePointSets } from './shape-generators.js';
import { resolveActiveMap } from '../math/active-map.js';
import { getManifold } from './manifold-registry.js';
import { isRasterInputShape, getRasterSourceForShape } from '../utils/raster-media.js';

const ANIMATION_DURATION = 4.0;
const BOUNCE_PAUSE_TIME = 1.0;

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

const PLANE_CONFIGS = {
    z: {
        containerId: 'z_plane_threejs_container',
        sliderId: 'z_transformation_progress_slider',
        buttonId: 'z_transformation_play_pause_btn',
        titleId: 'z_transformation_title',
        formulaId: 'z_transformation_formula',
        labelId: 'z_transformation_manifold_label',
        speedGroupId: 'z_transformation_speed_group',
        progressKey: 'manifoldTransformationProgressZ',
        playingKey: 'manifoldTransformationPlayingZ',
        speedKey: 'manifoldTransformationSpeedZ',
        generator: generateCurrentInputShapePointSets
    },
    w: {
        containerId: 'w_plane_threejs_container',
        sliderId: 'w_transformation_progress_slider',
        buttonId: 'w_transformation_play_pause_btn',
        titleId: 'w_transformation_title',
        formulaId: 'w_transformation_formula',
        labelId: 'w_transformation_manifold_label',
        speedGroupId: 'w_transformation_speed_group',
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

        this.ui = {
            slider: null,
            button: null,
            title: null,
            formula: null,
            label: null,
            speedGroup: null
        };

        this.cache = {
            progress: null,
            playing: null,
            speed: null,
            manifoldId: null,
            mapSignature: null,
            map: null
        };

        this.boundSliderInput = null;
        this.boundButtonClick = null;
        this.boundSpeedClick = null;
    }

    init() {
        if (!this.renderer) {
            const container = document.getElementById(this.config.containerId);
            if (container) {
                this.renderer = new ThreeManifoldsRenderer(container, this.id);
            }
        }
        this.bindEvents();
    }

    bindEvents() {
        this.unbindEvents();

        this.ui.slider = document.getElementById(this.config.sliderId);
        this.ui.button = document.getElementById(this.config.buttonId);
        this.ui.title = document.getElementById(this.config.titleId);
        this.ui.formula = document.getElementById(this.config.formulaId);
        this.ui.label = document.getElementById(this.config.labelId);
        this.ui.speedGroup = document.getElementById(this.config.speedGroupId);

        if (this.ui.slider) {
            this.boundSliderInput = (e) => {
                const val = parseFloat(e.target.value);
                state[this.config.playingKey] = false;
                state[this.config.progressKey] = val;
                this.resetTemporalState();
                this.render(val);
                this.syncUI();
            };
            this.ui.slider.addEventListener('input', this.boundSliderInput);
        }

        if (this.ui.button) {
            this.boundButtonClick = () => {
                if (this.id === 'z') {
                    toggleManifoldTransformationAnimationZ();
                } else {
                    toggleManifoldTransformationAnimationW();
                }
            };
            this.ui.button.addEventListener('click', this.boundButtonClick);
        }

        if (this.ui.speedGroup) {
            this.boundSpeedClick = (e) => {
                const btn = e.target.closest('.speed-btn');
                if (!btn || !btn.dataset.speed) return;
                const spd = parseFloat(btn.dataset.speed);
                state[this.config.speedKey] = spd;
                this.syncSpeedUI();
            };
            this.ui.speedGroup.addEventListener('click', this.boundSpeedClick);
        }
    }

    unbindEvents() {
        if (this.ui.slider && this.boundSliderInput) {
            this.ui.slider.removeEventListener('input', this.boundSliderInput);
            this.boundSliderInput = null;
        }
        if (this.ui.button && this.boundButtonClick) {
            this.ui.button.removeEventListener('click', this.boundButtonClick);
            this.boundButtonClick = null;
        }
        if (this.ui.speedGroup && this.boundSpeedClick) {
            this.ui.speedGroup.removeEventListener('click', this.boundSpeedClick);
            this.boundSpeedClick = null;
        }
    }

    build() {
        if (!this.renderer) return;
        this.cache.map = this.id === 'w' ? resolveActiveMap() : null;
        this.cache.mapSignature = this.cache.map?.signature || 'source';
        this.cache.manifoldId = state.selectedManifold;

        this.renderer.setTransform(this.cache.map);
        this.renderer.setManifold(state.selectedManifold);

        let initialProgress = state[this.config.progressKey] ?? 0;
        if (!state.manifoldTransformationEnabled && this.id === 'w') {
            initialProgress = 1.0;
        }

        if (isRasterInputShape(state.currentInputShape)) {
            const source = getRasterSourceForShape(state.currentInputShape);
            if (source) {
                this.renderer.buildRasterManifold(source, state.currentInputShape, initialProgress);
                this.syncLabels();
                this.syncSpeedUI();
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
        this.syncLabels();
        this.syncSpeedUI();
    }

    syncLabels() {
        const manifold = getManifold(state.selectedManifold);
        if (this.ui.title) this.ui.title.textContent = manifold.title;
        if (this.ui.formula) this.ui.formula.textContent = manifold.formula;
        if (this.ui.label) this.ui.label.textContent = manifold.name;
    }

    syncSpeedUI() {
        const speed = state[this.config.speedKey] || 1.0;
        if (this.ui.speedGroup) {
            const buttons = this.ui.speedGroup.querySelectorAll('.speed-btn');
            buttons.forEach(btn => {
                const btnSpd = parseFloat(btn.dataset.speed);
                btn.classList.toggle('active', Math.abs(btnSpd - speed) < 0.01);
            });
        }
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

    syncUI() {
        const currentProgress = state[this.config.progressKey];
        const currentPlaying = state[this.config.playingKey];
        const currentManifold = state.selectedManifold;
        const currentSpeed = state[this.config.speedKey];

        if (currentProgress !== this.cache.progress) {
            if (this.ui.slider && document.activeElement !== this.ui.slider) {
                this.ui.slider.value = currentProgress;
            }
            this.cache.progress = currentProgress;
        }

        if (currentPlaying !== this.cache.playing) {
            if (this.ui.button) {
                this.ui.button.replaceChildren(createPlaybackIcon(currentPlaying));
                this.ui.button.classList.toggle('playing', currentPlaying);
            }
            this.cache.playing = currentPlaying;
        }

        if (currentSpeed !== this.cache.speed) {
            this.syncSpeedUI();
            this.cache.speed = currentSpeed;
        }

        const currentInputShape = state.currentInputShape;
        const currentFunction = state.currentFunction;
        const currentA0 = state.a0;
        const currentB0 = state.b0;

        if (currentManifold !== this.cache.manifoldId ||
            currentInputShape !== this.cache.inputShape ||
            currentFunction !== this.cache.functionKey ||
            currentA0 !== this.cache.a0 ||
            currentB0 !== this.cache.b0) {
            this.cache.manifoldId = currentManifold;
            this.cache.inputShape = currentInputShape;
            this.cache.functionKey = currentFunction;
            this.cache.a0 = currentA0;
            this.cache.b0 = currentB0;
            this.build();
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
        if (this.ui.slider && this.boundSliderInput) {
            this.ui.slider.removeEventListener('input', this.boundSliderInput);
            this.boundSliderInput = null;
        }
        if (this.ui.button && this.boundButtonClick) {
            this.ui.button.removeEventListener('click', this.boundButtonClick);
            this.boundButtonClick = null;
        }
        if (this.ui.speedGroup && this.boundSpeedClick) {
            this.ui.speedGroup.removeEventListener('click', this.boundSpeedClick);
            this.boundSpeedClick = null;
        }
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }
        this.ui.slider = null;
        this.ui.button = null;
        this.ui.title = null;
        this.ui.formula = null;
        this.ui.label = null;
        this.ui.speedGroup = null;
    }
}

const controllers = Object.entries(PLANE_CONFIGS).map(([id, config]) => new PlaneController(id, config));
let animationHandle = null;
let lastFrameTime = 0;

export function initThreeJSRenderers() {
    for (let i = 0; i < controllers.length; i++) controllers[i].init();
}

export function buildThreeJSMeshes() {
    for (let i = 0; i < controllers.length; i++) controllers[i].build();
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

        if (state.currentInputShape === 'video' && state.videoIsPlaying) {
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
            syncManifoldTransformationPlayPauseButton();
            return;
        }

        // 4. DOM Sync Pipeline
        syncManifoldSliders();

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
    syncManifoldTransformationPlayPauseButton();
}

export function toggleManifoldTransformationAnimationZ() {
    state.manifoldTransformationPlayingZ = !state.manifoldTransformationPlayingZ;
    syncManifoldTransformationPlayPauseButton();
    if (state.manifoldTransformationPlayingZ || state.manifoldTransformationPlayingW) {
        startManifoldTransformationAnimation();
    }
}

export function toggleManifoldTransformationAnimationW() {
    state.manifoldTransformationPlayingW = !state.manifoldTransformationPlayingW;
    syncManifoldTransformationPlayPauseButton();
    if (state.manifoldTransformationPlayingZ || state.manifoldTransformationPlayingW) {
        startManifoldTransformationAnimation();
    }
}

export function syncManifoldSliders() {
    for (let i = 0; i < controllers.length; i++) controllers[i].syncUI();
}

export function syncManifoldTransformationPlayPauseButton() {
    for (let i = 0; i < controllers.length; i++) controllers[i].syncUI();
}

export function disposeThreeJSRenderers() {
    if (animationHandle) {
        cancelAnimationFrame(animationHandle);
        animationHandle = null;
    }
    for (let i = 0; i < controllers.length; i++) controllers[i].dispose();
}
