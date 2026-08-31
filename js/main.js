import { state, context } from './store/state.js';
import { runtime } from './store/runtime.js';
import { setupDOMReferences, setupVisualParameters } from './utils/dom-utils.js';
import { initializePolynomialCoeffs } from './ui/polynomial-ui.js';
import { setupEventListeners, initializeStateFromControls } from './ui/event-listeners.js';
import { initializeTooltips } from './ui/tooltip.js';
import { initializeDynamicPlottingEngine } from './analysis/dynamic-plotting.js';
import { renderApplicationFrame } from './rendering/application-renderer.js';
import {
    configureRedrawScheduler,
    requestDomainRedraw
} from './rendering/redraw-scheduler.js';
import { mountFrontend, mountFrontendControls } from './frontend/mount-frontend.jsx';
import { startUiSynchronization } from './frontend/controllers/ui-sync-controller.js';

const { controls } = context;
configureRedrawScheduler(renderApplicationFrame);

function initializeAnimationSpeedSelectors() {
    document.querySelectorAll('.animation-speed-selector').forEach(select => {
        if (![...select.options].some(option => option.value === '1')) {
            throw new Error(`Animation speed selector ${select.id} requires a 1x option.`);
        }
        select.value = '1';
    });
}

function setup() {
    window.__runtime = runtime;
    window.__state = state;
    window.__context = context;
    initializeDynamicPlottingEngine();
    mountFrontendControls();
    setupDOMReferences();
    setupVisualParameters(true, true);
    initializeStateFromControls();

    initializePolynomialCoeffs(state.polynomialN, false);
    mountFrontend();

    initializeAnimationSpeedSelectors();

    setupEventListeners();
    startUiSynchronization();
    initializeTooltips();
    requestDomainRedraw();
}

if (document.readyState === 'complete') {
    setup();
    hidePreloader();
} else {
    window.addEventListener('load', () => {
        setup();
        hidePreloader();
    });
}

function hidePreloader() {
    if (controls.preloader) {
        controls.preloader.style.opacity = '0';
        setTimeout(() => {
            controls.preloader.style.display = 'none';
        }, 500); 
    }
}
