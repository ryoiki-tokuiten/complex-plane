import { state, subscribeState } from '../../store/state.js';
import {
    disposeThreeJSRenderers,
    initThreeJSRenderers,
    startManifoldTransformationAnimation,
    syncManifoldRenderers
} from '../../rendering/manifold-transformation-animation.js';
import { MAP_RUNTIME_STATE_KEYS } from '../../native/map-runtime.js';

const RUNTIME_KEYS = new Set([
    'manifold3dViewEnabled', 'manifoldTransformationEnabled',
    'manifoldTransformationPlayingZ', 'manifoldTransformationPlayingW',
    'selectedManifold', 'currentInputShape',
    'gridDensity', 'gridParameters', 'a0', 'b0', 'circleR',
    'arbitraryShapeMode', 'arbitraryShapeExpression', 'arbitraryShapeTMin',
    'arbitraryShapeTMax', 'arbitraryShapeClosed', 'arbitraryShapePoints',
    'gridColor1', 'gridColor2', 'mediaSize', 'mediaAspectRatio', 'mediaVersion',
    ...MAP_RUNTIME_STATE_KEYS
]);

let active = false;

function synchronize() {
    if (!state.manifold3dViewEnabled) {
        if (active) disposeThreeJSRenderers();
        active = false;
        return;
    }

    active = true;
    initThreeJSRenderers();
    syncManifoldRenderers();
    const playing = state.manifoldTransformationEnabled &&
        (state.manifoldTransformationPlayingZ || state.manifoldTransformationPlayingW);
    if (playing) startManifoldTransformationAnimation();
}

export function startManifoldRuntimeSynchronization() {
    const unsubscribe = subscribeState(synchronize, RUNTIME_KEYS);
    synchronize();
    return unsubscribe;
}
