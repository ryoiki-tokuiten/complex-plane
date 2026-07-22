import { state, subscribeState } from '../../store/state.js';
import { updateTitlesAndGlobalUI } from '../../ui/ui-updates.js';

// Render results and animation cursors never change the controls. Excluding them keeps
// the DOM completely off hot drawing paths while every user-facing setting remains
// automatically covered when the state schema grows.
const NON_UI_STATE_KEYS = new Set([
    'criticalPoints', 'criticalValues', 'dynamicPlotting', 'fourierDFTResult',
    'fourierTimeDomainSignal', 'fullscreenWIndex', 'graphSelectedLineIndex',
    'graphSelectedShape', 'graphSelectionRevision', 'imageContentVersion',
    'isContour2DFullScreen', 'isGraphFullScreen', 'isLaplace3DFullScreen',
    'isRealPlotsFullScreen',
    'isWFullScreen', 'isZFullScreen', 'laplaceAnimationTime', 'laplaceCurrentValue',
    'laplacePoles', 'laplaceROC', 'laplaceSurface', 'laplaceTimeDomainSignal',
    'laplaceZeros', 'poles', 'polynomialCoeffs', 'probeZ', 'realPlotsCameraNeedsReset',
    'realPlotsCameraTargetMath', 'riemannTransformationProgressW',
    'riemannTransformationProgressZ', 'videoFrameVersion', 'zeros'
]);

const UI_STATE_KEYS = Object.freeze(Object.keys(state).filter(key => !NON_UI_STATE_KEYS.has(key)));

let pending = false;
let unsubscribe = null;

function synchronize() {
    pending = false;
    updateTitlesAndGlobalUI();
}

function schedule() {
    if (pending) return;
    pending = true;
    queueMicrotask(synchronize);
}

export function startUiSynchronization() {
    if (unsubscribe) return unsubscribe;
    unsubscribe = subscribeState(schedule, UI_STATE_KEYS);
    synchronize();
    return () => {
        unsubscribe?.();
        unsubscribe = null;
        pending = false;
    };
}
