import { state, subscribeState } from '../../store/state.js';
import { buildViewModel } from '../view-model.js';
import { refreshApplication } from '../application.jsx';

// Render results and animation cursors never change the controls. Excluding them keeps
// the DOM completely off hot drawing paths while every user-facing setting remains
// automatically covered when the state schema grows.
const NON_UI_STATE_KEYS = new Set([
    'criticalPoints', 'criticalValues', 'dynamicPlotting', 'laplaceSpectrum',
    'graphSelectedLineIndex',
    'graphSelectedShape', 'graphSelectionRevision', 'mediaVersion',
    'laplaceAnimationTime', 'laplaceCurrentValue',
    'laplacePoles', 'laplaceROC', 'laplaceSurface', 'laplaceTimeDomainSignal',
    'laplaceZeros', 'poles', 'polynomialCoeffs',
    'manifoldTransformationProgressW',
    'manifoldTransformationProgressZ', 'zeros'
]);

const UI_STATE_KEYS = Object.freeze(Object.keys(state).filter(key => !NON_UI_STATE_KEYS.has(key)));

let pending = false;
let unsubscribe = null;
let revision = 0;
let actions = new Map();

function synchronize() {
    pending = false;
    refreshApplication({ props: buildViewModel(), actions, revision: ++revision });
}

export function setUiActions(nextActions) {
    actions = nextActions;
    synchronize();
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
