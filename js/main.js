import { state, context } from './store/state.js';
import { runtime } from './store/runtime.js';
import { setupDOMReferences, setupVisualParameters } from './utils/dom-utils.js';
import { initializePolynomialCoeffs } from './store/polynomial-state.js';
import { createFrontendActions } from './frontend/actions.js';
import { initializeDynamicPlottingEngine } from './analysis/dynamic-plotting.js';
import { renderApplicationFrame } from './rendering/application-renderer.js';
import {
    configureRedrawScheduler,
    requestDomainRedraw
} from './rendering/redraw-scheduler.js';
import { mountApplication } from './frontend/application.jsx';
import { setUiActions, startUiSynchronization } from './frontend/controllers/ui-sync-controller.js';
import { startManifoldRuntimeSynchronization } from './frontend/controllers/manifold-runtime-controller.js';

configureRedrawScheduler(renderApplicationFrame);

function setup() {
    window.__runtime = runtime;
    window.__state = state;
    window.__context = context;
    initializeDynamicPlottingEngine();
    mountApplication(document.getElementById('app'));
    setupDOMReferences();
    setupVisualParameters(true, true);
    initializePolynomialCoeffs(state.polynomialN, false);

    setUiActions(createFrontendActions());
    startUiSynchronization();
    startManifoldRuntimeSynchronization();
    requestDomainRedraw();
}

if (document.readyState === 'complete') {
    setup();
} else {
    window.addEventListener('load', setup);
}
