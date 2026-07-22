import { state, context, zPlaneParams, wPlaneParams } from './store/state.js';
import { runtime } from './store/runtime.js';
import { eventBus } from './store/events.js';
import { ROCKET_DATA_URIS } from './rocket-assets.js';
import { getChainedTransformFunction } from './math-utils.js';
import { updatePlaneViewportRanges } from './utils/canvas-utils.js';
import { drawImageWithWebGL } from './rendering/draw-image-webgl.js';
import { drawPlanarTransformedLine, drawComplexLineSetOnPlane } from './rendering/draw-planar.js';
import { setupVisualParameters } from './utils/dom-utils.js';

const { controls } = context;

const NAVIGATION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
let navigationAnimationFrame = null;

// ── Rocket image assets ────────────────────────────────────────────────────────
// Images are loaded from base64 data: URIs (defined in rocket-assets.js).
// data: URLs are always same-origin — gl.texImage2D accepts them on file:// too.
const NAVIGATION_ROCKET_IMAGES = {
    '+x': null,
    '-x': null,
    '+y': null,
    '-y': null,
};

(function preloadRocketImages() {
    Object.entries(ROCKET_DATA_URIS).forEach(([key, dataUri]) => {
        const img = new Image();
        img.onload = () => { NAVIGATION_ROCKET_IMAGES[key] = img; };
        img.src = dataUri;
    });
}());

/**
 * Given a heading angle (radians, from Math.atan2), pick the best directional
 * rocket image. The four images correspond to the four cardinal half-planes:
 *   +x  →  -π/4  .. +π/4
 *   +y  →  +π/4  .. +3π/4
 *   -x  →  +3π/4 .. π  |  -π .. -3π/4
 *   -y  →  -3π/4 .. -π/4
 */
function getRocketImageForHeading(heading) {
    const QUARTER = Math.PI / 4;
    const abs = Math.abs(heading);
    if (abs <= QUARTER) {
        return NAVIGATION_ROCKET_IMAGES['+x'];
    } else if (abs >= 3 * QUARTER) {
        return NAVIGATION_ROCKET_IMAGES['-x'];
    } else if (heading > 0) {
        return NAVIGATION_ROCKET_IMAGES['+y'];
    } else {
        return NAVIGATION_ROCKET_IMAGES['-y'];
    }
}

function isFiniteComplexPoint(point) {
    return point &&
        Number.isFinite(point.re) &&
        Number.isFinite(point.im);
}

function isNavigationFormTarget(target) {
    return !!(target && target.closest && target.closest('input, select, textarea, button, [contenteditable="true"]'));
}

function readNavigationControlValue(controlKey, fallback, parser = parseFloat) {
    const control = controls[controlKey];
    if (!control) return fallback;
    const value = parser(control.value);
    return Number.isNaN(value) ? fallback : value;
}

export function initializeNavigationStateFromControls() {
    state.navigationSize = readNavigationControlValue('navigationSizeSlider', state.navigationSize);
    state.navigationOpacity = readNavigationControlValue('navigationOpacitySlider', state.navigationOpacity);
    state.navigationSpeed = readNavigationControlValue('navigationSpeedSlider', state.navigationSpeed);
    state.navigationTrailLength = readNavigationControlValue('navigationTrailLengthSlider', state.navigationTrailLength, value => parseInt(value, 10));
    state.navigationModeEnabled = controls.enableNavigationModeCb ? controls.enableNavigationModeCb.checked : state.navigationModeEnabled;
    syncNavigationControls();
}

export function syncNavigationControls() {
    const inSpecialMode = state.fourierModeEnabled || state.laplaceModeEnabled;
    if (controls.navigationParamsBlock) {
        controls.navigationParamsBlock.classList.toggle('hidden', inSpecialMode);
    }
    if (controls.enableNavigationModeCb) {
        controls.enableNavigationModeCb.checked = state.navigationModeEnabled && !inSpecialMode;
        controls.enableNavigationModeCb.disabled = inSpecialMode;
    }
    if (controls.navigationControlsContainer) {
        controls.navigationControlsContainer.classList.toggle('hidden', !state.navigationModeEnabled || inSpecialMode);
    }
    const keyhintOverlay = document.getElementById('navigation_keyhint_overlay');
    if (keyhintOverlay) {
        keyhintOverlay.classList.toggle('hidden', !state.navigationModeEnabled || inSpecialMode);
    }
    if (controls.navigationSizeValueDisplay) controls.navigationSizeValueDisplay.textContent = state.navigationSize.toFixed(2);
    if (controls.navigationOpacityValueDisplay) controls.navigationOpacityValueDisplay.textContent = state.navigationOpacity.toFixed(2);
    if (controls.navigationSpeedValueDisplay) controls.navigationSpeedValueDisplay.textContent = state.navigationSpeed.toFixed(2);
    if (controls.navigationTrailLengthValueDisplay) controls.navigationTrailLengthValueDisplay.textContent = state.navigationTrailLength;
}

export function setNavigationModeEnabled(enabled) {
    if (enabled && (state.fourierModeEnabled || state.laplaceModeEnabled)) {
        enabled = false;
    }

    state.navigationModeEnabled = enabled;
    state.probeActive = false;

    if (enabled) {
        state.riemannSphereViewEnabled = false;
        state.splitViewEnabled = false;
        state.threeSphereEnabled = false;
        if (controls.enableRiemannSphereCb) controls.enableRiemannSphereCb.checked = false;
        if (controls.enableSplitViewCb) controls.enableSplitViewCb.checked = false;
        if (controls.enableThreeSphereCb) controls.enableThreeSphereCb.checked = false;
        followNavigationViewports();
    } else {
        runtime.navigation.keys = {};
        stopNavigationLoop();
    }

    syncNavigationControls();
}

export function resetNavigationVehicle() {
    runtime.navigation.position = { re: 0, im: 0 };
    runtime.navigation.heading = 0;
    runtime.navigation.trail = [];
    setupVisualParameters(true, true);
    followNavigationViewports();
    eventBus.emit('redraw:domain', true);
}

function getNavigationInputVector() {
    const keys = runtime.navigation.keys || {};
    let x = 0;
    let y = 0;
    if (keys.ArrowLeft) x -= 1;
    if (keys.ArrowRight) x += 1;
    if (keys.ArrowUp) y += 1;
    if (keys.ArrowDown) y -= 1;
    const mag = Math.hypot(x, y);
    return mag > 0 ? { x: x / mag, y: y / mag } : null;
}

function hasNavigationInput() {
    return !!getNavigationInputVector();
}

export function setNavigationKey(event, pressed) {
    if (!state.navigationModeEnabled || !NAVIGATION_KEYS.has(event.key) || isNavigationFormTarget(event.target)) {
        return false;
    }

    event.preventDefault();
    runtime.navigation.keys[event.key] = pressed;

    // Visual feedback on the keyhint widget
    const keyToDirection = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const dir = keyToDirection[event.key];
    if (dir) {
        const el = document.querySelector(`.keyhint-key [data-lucide="arrow-${dir}"]`);
        if (el && el.parentElement) {
            el.parentElement.classList.toggle('active', pressed);
        }
    }

    if (pressed) startNavigationLoop();
    return true;
}

function startNavigationLoop() {
    if (navigationAnimationFrame || !state.navigationModeEnabled) return;
    runtime.navigation.lastTime = performance.now();
    navigationAnimationFrame = requestAnimationFrame(updateNavigationLoop);
}

export function stopNavigationLoop() {
    if (navigationAnimationFrame) {
        cancelAnimationFrame(navigationAnimationFrame);
        navigationAnimationFrame = null;
    }
}

function updateNavigationLoop(now) {
    navigationAnimationFrame = null;
    if (!state.navigationModeEnabled || !hasNavigationInput()) return;

    const viewportShifted = updateNavigationVehicle(now);
    eventBus.emit('redraw:domain', Boolean(viewportShifted && state.domainColoringEnabled));

    if (hasNavigationInput()) {
        navigationAnimationFrame = requestAnimationFrame(updateNavigationLoop);
    }
}

function updateNavigationVehicle(now) {
    const direction = getNavigationInputVector();
    if (!direction) return false;

    const dt = Math.min(0.05, Math.max(0.001, (now - (runtime.navigation.lastTime || now)) / 1000));
    runtime.navigation.lastTime = now;

    const xSpan = zPlaneParams.currentVisXRange[1] - zPlaneParams.currentVisXRange[0];
    const ySpan = zPlaneParams.currentVisYRange[1] - zPlaneParams.currentVisYRange[0];
    const speed = state.navigationSpeed * Math.max(xSpan, ySpan) * 0.12;

    runtime.navigation.position.re += direction.x * speed * dt;
    runtime.navigation.position.im += direction.y * speed * dt;
    runtime.navigation.heading = Math.atan2(direction.y, direction.x);

    runtime.navigation.trail.push({ ...runtime.navigation.position });
    const maxTrail = Math.max(0, Math.floor(state.navigationTrailLength));
    if (runtime.navigation.trail.length > maxTrail) {
        runtime.navigation.trail.splice(0, runtime.navigation.trail.length - maxTrail);
    }

    return followNavigationViewports();
}

function centerPlaneOnNavigationPoint(planeParams, point, panState) {
    if (!isFiniteComplexPoint(point) || (panState && panState.isPanning)) return false;

    const nextOriginX = planeParams.width / 2 - point.re * planeParams.scale.x;
    const nextOriginY = planeParams.height / 2 + point.im * planeParams.scale.y;
    const shifted = Math.abs(nextOriginX - planeParams.origin.x) > 0.01 ||
        Math.abs(nextOriginY - planeParams.origin.y) > 0.01;

    planeParams.origin.x = nextOriginX;
    planeParams.origin.y = nextOriginY;
    updatePlaneViewportRanges(planeParams);
    return shifted;
}

export function followNavigationViewports() {
    let shifted = centerPlaneOnNavigationPoint(zPlaneParams, runtime.navigation.position, runtime.interaction.panZ);

    const transformFunc = getChainedTransformFunction(state.currentFunction);
    if (typeof transformFunc !== 'function') return shifted;

    // Center w-plane on the mapped point of the vehicle position
    const mappedCenter = transformFunc(runtime.navigation.position.re, runtime.navigation.position.im);
    shifted = centerPlaneOnNavigationPoint(wPlaneParams, mappedCenter, runtime.interaction.panW) || shifted;
    return shifted;
}

// ── Image state injection for the existing pipeline ────────────────────────────
//
// Instead of custom drawing, we temporarily set the rocket PNG as the active
// image (runtime.media.image, state.currentInputShape='image', etc.) so that the
// existing drawPlanarInputShape / drawPlanarTransformedShape / drawImageWithWebGL
// pipeline processes it exactly like a user-uploaded image.
//
// applyNavigationImageState()  → swaps state in
// restoreNavigationImageState() → restores the previous state
//
// These are called by the renderer AROUND the normal shape-drawing calls.

let _navImageStateSaved = null;

function applyNavigationImageState(pos) {
    const img = getRocketImageForHeading(runtime.navigation.heading);
    if (!img || !(img instanceof HTMLImageElement) || !img.complete || img.naturalWidth === 0) {
        return false;
    }

    // Save existing state
    _navImageStateSaved = {
        currentInputShape: state.currentInputShape,
        uploadedImage: runtime.media.image,
        imageAspectRatio: state.imageAspectRatio,
        imageSize: state.imageSize,
        imageOpacity: state.imageOpacity,
        a0: state.a0,
        b0: state.b0,
        imageContentVersion: state.imageContentVersion,
    };

    // Inject the rocket image as the active raster source
    state.currentInputShape = 'image';
    runtime.media.image = img;
    state.imageAspectRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
    state.imageSize = state.navigationSize * 2;
    state.imageOpacity = state.navigationOpacity;
    state.a0 = pos.re;
    state.b0 = pos.im;
    state.imageContentVersion = _navImageStateSaved.imageContentVersion + 1;

    return true;
}

function restoreNavigationImageState() {
    if (!_navImageStateSaved) return;

    state.currentInputShape = _navImageStateSaved.currentInputShape;
    runtime.media.image = _navImageStateSaved.uploadedImage;
    state.imageAspectRatio = _navImageStateSaved.imageAspectRatio;
    state.imageSize = _navImageStateSaved.imageSize;
    state.imageOpacity = _navImageStateSaved.imageOpacity;
    state.a0 = _navImageStateSaved.a0;
    state.b0 = _navImageStateSaved.b0;
    state.imageContentVersion = _navImageStateSaved.imageContentVersion;

    _navImageStateSaved = null;
}

function drawNavigationTrail(ctx, planeParams, transformFunc) {
    if (!runtime.navigation.trail || runtime.navigation.trail.length < 2 || state.navigationTrailLength <= 0) return;

    ctx.save();
    ctx.globalAlpha = Math.min(0.34, state.navigationOpacity * 0.45);
    ctx.strokeStyle = 'rgba(126, 228, 255, 0.55)';
    ctx.lineWidth = 1.1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (transformFunc) {
        drawPlanarTransformedLine(ctx, planeParams, transformFunc, runtime.navigation.trail, 'rgba(126, 228, 255, 0.55)');
    } else {
        drawComplexLineSetOnPlane(ctx, planeParams, runtime.navigation.trail);
    }
    ctx.restore();
}

/**
 * drawNavigationLayer — called by renderer.js for both z-plane and w-plane.
 *
 * This function injects the rocket image into the global state, then calls the
 * SAME pipeline that the regular image-upload feature uses:
 *   - Z-plane: drawImageWithWebGL(ctx, planeParams, false)
 *   - W-plane: drawImageWithWebGL(ctx, planeParams, false, 0)
 *
 * Since the position is pre-mapped via the global JS transform function,
 * WebGL is called with isWP = false (identity mapping) on both planes to render
 * the vehicle correctly without distortions or branch-cut issues.
 */
export function drawNavigationLayer(ctx, planeParams, planeKey, transformFunc = null) {
    if (!state.navigationModeEnabled) return;

    // Draw trail
    drawNavigationTrail(ctx, planeParams, transformFunc);

    // Compute the correct position of the vehicle in this plane's coordinates
    const pos = transformFunc
        ? transformFunc(runtime.navigation.position.re, runtime.navigation.position.im)
        : runtime.navigation.position;

    if (!pos || isNaN(pos.re) || isNaN(pos.im) || !isFinite(pos.re) || !isFinite(pos.im)) {
        return;
    }

    // Inject the rocket image into state, centering it at pos
    if (!applyNavigationImageState(pos)) return;

    try {
        if (typeof drawImageWithWebGL === 'function') {
            drawImageWithWebGL(ctx, planeParams, false, 0);
        }
    } finally {
        restoreNavigationImageState();
    }
}

// Alias kept for any renderer.js call sites that use this name directly.
export function drawNavigationVehicle(ctx, planeParams, transformFunc = null) {
    drawNavigationLayer(ctx, planeParams, null, transformFunc);
}
