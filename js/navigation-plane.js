import { state, context, zPlaneParams, wPlaneParams } from './store/state.js';
import { runtime } from './store/runtime.js';
import { requestDomainRedraw } from './rendering/redraw-scheduler.js';
import { ROCKET_DATA_URIS } from './rocket-assets.js';
import { getChainedTransformFunction } from './native/map-runtime.js';
import { updatePlaneViewportRanges } from './utils/canvas-utils.js';
import { drawRasterWithWebGL } from './rendering/draw-image-webgl.js';
import { drawPlanarTransformedLine, drawComplexLineSetOnPlane } from './rendering/draw-planar.js';
import { isFiniteComplex } from './utils/numeric-contracts.js';
import { getMediaDisplayDimensions } from './utils/raster-media.js';

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

(() => {
    if (typeof Image === 'undefined') return;
    Object.entries(ROCKET_DATA_URIS).forEach(([key, dataUri]) => {
        const img = new Image();
        img.onload = () => { NAVIGATION_ROCKET_IMAGES[key] = img; };
        img.src = dataUri;
    });
})();

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

function isNavigationFormTarget(target) {
    return !!(target && target.closest && target.closest('input, select, textarea, button, [contenteditable="true"]'));
}

export function initializeNavigationStateFromControls() {
    state.navigationSize ||= 0.55;
    state.navigationOpacity ||= 0.9;
    state.navigationSpeed ||= 1.1;
    state.navigationTrailLength ||= 0;
    syncNavigationControls();
}

export function syncNavigationControls() {
    const inSpecialMode = state.laplaceModeEnabled;
    const keyhintOverlay = document.getElementById('navigation_keyhint_overlay');
    if (keyhintOverlay) {
        keyhintOverlay.classList.toggle('hidden', !state.navigationModeEnabled || inSpecialMode);
    }
}

export function setNavigationModeEnabled(enabled) {
    if (enabled && state.laplaceModeEnabled) {
        enabled = false;
    }

    state.navigationModeEnabled = enabled;
    state.probeActive = false;

    if (enabled) {
        state.manifold3dViewEnabled = false;
        state.manifoldTransformationEnabled = false;
        if (controls.enableManifoldTransformationCb) controls.enableManifoldTransformationCb.checked = false;
        followNavigationViewports();
    } else {
        runtime.navigation.keys = {};
        stopNavigationLoop();
    }

    syncNavigationControls();
}

function getNavigationInputVector() {
    const keys = runtime.navigation.keys;
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
        throw new Error('Navigation runtime requires a key-state object.');
    }
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
    requestDomainRedraw(Boolean(viewportShifted && state.domainColoringEnabled));

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
    if (!isFiniteComplex(point) || (panState && panState.isPanning)) return false;

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

export function drawNavigationLayer(ctx, planeParams, transformFunc = null) {
    if (!state.navigationModeEnabled) return;

    drawNavigationTrail(ctx, planeParams, transformFunc);

    const pos = transformFunc
        ? transformFunc(runtime.navigation.position.re, runtime.navigation.position.im)
        : runtime.navigation.position;
    if (!isFiniteComplex(pos)) return;

    const source = getRocketImageForHeading(runtime.navigation.heading);
    if (!source?.complete || !source.naturalWidth) return;
    drawRasterWithWebGL(ctx, planeParams, false, null, {
        source,
        token: 0,
        center: pos,
        size: getMediaDisplayDimensions(
            state.navigationSize * 2,
            source.naturalWidth / Math.max(1, source.naturalHeight)
        ),
        opacity: state.navigationOpacity
    });
}
