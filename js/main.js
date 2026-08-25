import { state, context, zPlaneParams } from './store/state.js';
import { runtime } from './store/runtime.js';
import { eventBus } from './store/events.js';
import { setupDOMReferences, setupVisualParameters } from './utils/dom-utils.js';
import { initializePolynomialCoeffs } from './ui/polynomial-ui.js';
import { setupEventListeners, setActiveFunctionButton, initializeStateFromControls, getCachedCanvasEventPosition } from './ui/event-listeners.js';
import { initializeTooltips, showDynamicTooltip, hideDynamicTooltip } from './ui/tooltip.js';
import { mapCanvasToWorldCoords } from './utils/canvas-utils.js';
import { initializeDynamicPlottingEngine } from './analysis/dynamic-plotting.js';
import {
    findNearestDynamicSample,
    formatDynamicSampleTooltip
} from './rendering/draw-dynamic-plotting.js';
import { renderApplicationFrame } from './rendering/application-renderer.js';
import {
    configureRedrawScheduler,
    requestDomainRedraw,
    requestUiRedraw
} from './rendering/redraw-scheduler.js';
import { mountFrontend } from './frontend/mount-frontend.jsx';
import { startUiSynchronization } from './frontend/controllers/ui-sync-controller.js';

const { controls } = context;
configureRedrawScheduler(renderApplicationFrame);

function initializeAnimationSpeedSelectors() {
    document.querySelectorAll('.animation-speed-selector').forEach(select => {
        const defaultOption = Array.from(select.options).find(option => option.value === '1') ||
            Array.from(select.options).find(option => option.defaultSelected) ||
            select.options[0];

        Array.from(select.options).forEach(option => {
            option.selected = option === defaultOption;
        });
    });
}

function setup() {
    window.__runtime = runtime;
    window.__state = state;
    window.__context = context;
    initializeDynamicPlottingEngine();
    setupDOMReferences();
    setupVisualParameters(true, true);
    initializeStateFromControls();

    initializePolynomialCoeffs(state.polynomialN, false);
    mountFrontend();

    if (!controls.funcButtons[state.currentFunction]) {
        state.currentFunction = 'cos';
        setActiveFunctionButton('cos');
    }
    if (controls.inputShapeSelector) {
        controls.inputShapeSelector.value = state.currentInputShape;
    }

    initializeAnimationSpeedSelectors();

    setupEventListeners();
    startUiSynchronization();
    initializeTooltips();
    setupCanvasTooltipEvents();
    requestDomainRedraw();
}

function setupCanvasTooltipEvents() {
    const bindPlaneTooltip = (canvas, plane, planeParams) => {
        if (!canvas || !planeParams) return;
        const tooltipPos = { x: 0, y: 0 };
        const probeWorld = { re: 0, im: 0 };

        canvas.addEventListener('mousemove', (event) => {
            const pos = getCachedCanvasEventPosition(canvas, event, tooltipPos);
            if (!pos) return;

            const worldCoords = mapCanvasToWorldCoords(pos.x, pos.y, planeParams);
            probeWorld.re = worldCoords.x;
            probeWorld.im = worldCoords.y;

            let foundItem = null;
            const xRange = planeParams.currentVisXRange;
            const clickRadiusWorld = xRange[1] - xRange[0];
            const tolerance = (clickRadiusWorld / planeParams.width) * 5;

            const dynamicSample = findNearestDynamicSample(probeWorld, plane, {
                worldSpan: clickRadiusWorld,
                pixelWidth: planeParams.width,
                tolerance: tolerance * 2
            });
            if (dynamicSample) {
                foundItem = formatDynamicSampleTooltip(dynamicSample);
            }

            if (!foundItem && plane === 'z' && state.poles && state.showZerosPoles) {
                for (const pole of state.poles) {
                    if (Math.abs(pole.re - probeWorld.re) < tolerance && Math.abs(pole.im - probeWorld.im) < tolerance) {
                        let content = `<b>Singularity</b><br>z = ${pole.re.toFixed(3)} + ${pole.im.toFixed(3)}i`;
                        content += `<br>Type: ${pole.type || 'Unknown'}`;
                        if (pole.type === 'pole' && pole.order) {
                            content += `<br>Order: ${pole.order}`;
                        }
                        if (pole.residue && typeof pole.residue.re === 'number' && typeof pole.residue.im === 'number' &&
                            isFinite(pole.residue.re) && isFinite(pole.residue.im)) {
                            content += `<br>Residue: ${pole.residue.re.toFixed(3)} + ${pole.residue.im.toFixed(3)}i`;
                        }
                        foundItem = content;
                        break;
                    }
                }
            }

            if (!foundItem && plane === 'z' && state.zeros && state.showZerosPoles) {
                for (const zero of state.zeros) {
                    if (Math.abs(zero.re - probeWorld.re) < tolerance && Math.abs(zero.im - probeWorld.im) < tolerance) {
                        foundItem = `<b>Zero</b><br>z = ${zero.re.toFixed(3)} + ${zero.im.toFixed(3)}i`;
                        break;
                    }
                }
            }

            if (!foundItem && plane === 'z' && state.criticalPoints && state.showCriticalPoints) {
                for (const cp of state.criticalPoints) {
                    if (Math.abs(cp.re - probeWorld.re) < tolerance && Math.abs(cp.im - probeWorld.im) < tolerance) {
                        foundItem = `<b>Critical Point</b><br>z = ${cp.re.toFixed(3)} + ${cp.im.toFixed(3)}i`;
                        break;
                    }
                }
            }

            if (foundItem) {
                showDynamicTooltip(foundItem, event.pageX, event.pageY);
            } else {
                hideDynamicTooltip();
            }
        }, { passive: true });

        canvas.addEventListener('mouseout', () => {
            hideDynamicTooltip();
        });
    };

    bindPlaneTooltip(controls.zPlaneCanvas, 'z', zPlaneParams);
    bindPlaneTooltip(controls.wPlaneCanvas, 'w', context.wPlaneParamsList?.[0]);
}

// Event bus subscriptions for asynchronous redraw signals. The scheduler owns
// the actual dirty-bit and RAF invalidation policy for every caller.
eventBus.on('redraw:all', () => {
    requestUiRedraw();
});

eventBus.on('redraw:domain', (markDirty) => {
    requestDomainRedraw(markDirty !== false);
});

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

window.addEventListener('resize', () => {
    setupVisualParameters(false, false); 
    requestDomainRedraw();
});
