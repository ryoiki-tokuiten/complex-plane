import { state, context } from './store/state.js';
import { runtime } from './store/runtime.js';
import { setupCanvasReferences, setupVisualParameters } from './utils/dom-utils.js';
import { initializePolynomialCoeffs } from './store/polynomial-state.js';
import { createFrontendActions } from './frontend/actions.js';
import { initializeDynamicPlottingEngine } from './analysis/dynamic-plotting.js';
import { renderApplicationFrame } from './rendering/application-renderer.js';
import {
    configureRedrawScheduler,
    requestDomainRedraw
} from './rendering/redraw-scheduler.js';
import { mountApplication } from './frontend/application.jsx';
import { installUiActions } from './frontend/ui-element.jsx';
import { startManifoldRuntimeSynchronization } from './frontend/controllers/manifold-runtime-controller.js';

configureRedrawScheduler(renderApplicationFrame);

function setup() {
    window.__runtime = runtime;
    window.__state = state;
    window.__context = context;
    initializeDynamicPlottingEngine();
    mountApplication(document.getElementById('app'));
    setupCanvasReferences();
    setupVisualParameters(true, true);
    initializePolynomialCoeffs(state.polynomialN, false);

    installUiActions(createFrontendActions());
    startManifoldRuntimeSynchronization();
    requestDomainRedraw();
}

setup();
