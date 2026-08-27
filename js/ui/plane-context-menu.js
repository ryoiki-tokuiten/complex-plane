import { state, context } from '../store/state.js';
import { eventBus } from '../store/events.js';
import {
    syncParameterControlsPanelVisibility,
    syncManifoldTransformationUI,
    syncTransformControlPanels
} from './ui-updates.js';
import { updateChainingTitles, downloadCanvasImage, setupVisualParameters } from '../utils/dom-utils.js';
import {
    isGraphViewSupported,
    isFullGridPerspectiveSupported,
    disposeTransformationGraphRenderer
} from '../rendering/transformation-graph.js';
import { syncGridDensityControls } from './grid-density-controls.js';
import { refreshPanelEdgeHandles } from './panel-layout-manager.js';

let menuElement = null;
let submenuElement = null;
let isMenuOpen = false;
let submenuCloseTimer = null;

function getOrCreateMenuElement() {
    if (menuElement && document.body.contains(menuElement)) {
        return menuElement;
    }
    menuElement = document.createElement('div');
    menuElement.id = 'plane_context_menu';
    menuElement.className = 'plane-context-menu hidden';
    menuElement.setAttribute('role', 'menu');
    document.body.appendChild(menuElement);
    return menuElement;
}

function getOrCreateSubmenuElement() {
    if (submenuElement && document.body.contains(submenuElement)) {
        return submenuElement;
    }
    submenuElement = document.createElement('div');
    submenuElement.id = 'plane_context_submenu';
    submenuElement.className = 'plane-context-menu plane-context-submenu hidden';
    submenuElement.setAttribute('role', 'menu');
    document.body.appendChild(submenuElement);

    submenuElement.addEventListener('mouseenter', () => {
        if (submenuCloseTimer) {
            clearTimeout(submenuCloseTimer);
            submenuCloseTimer = null;
        }
    });

    submenuElement.addEventListener('mouseleave', () => {
        submenuCloseTimer = setTimeout(() => {
            hideSubmenu();
        }, 220);
    });

    return submenuElement;
}

function hideSubmenu() {
    if (submenuCloseTimer) {
        clearTimeout(submenuCloseTimer);
        submenuCloseTimer = null;
    }
    if (submenuElement) {
        submenuElement.classList.add('hidden');
        submenuElement.innerHTML = '';
    }
}

export function hidePlaneContextMenu() {
    hideSubmenu();
    if (!menuElement || !isMenuOpen) return;
    menuElement.classList.add('hidden');
    menuElement.innerHTML = '';
    isMenuOpen = false;
}

function requestDomainRedraw() {
    eventBus.emit('redraw:domain');
}

function requestUiRedraw() {
    eventBus.emit('redraw:ui');
}

function enableFoldSurface3d() {
    state.riemannSurfaceEnabled = false;
    state.manifold3dViewEnabled = false;
    state.manifoldTransformationEnabled = false;
    syncManifoldTransformationUI();
    updateChainingTitles();
}

function disableFoldSurface3d() {
    state.foldSurface3dEnabled = false;
    syncGridDensityControls();
}

function toggleGraphView() {
    const graphSupported = isGraphViewSupported(state.currentInputShape);
    if (!graphSupported) return;
    state.graphViewEnabled = !state.graphViewEnabled;
    if (state.laplaceModeEnabled || !state.graphViewEnabled) {
        state.graphViewEnabled = false;
        state.graphFullGridEnabled = false;
        state.graphLayerLockEnabled = false;
        state.graphFourierEnabled = false;
        state.graphTraceEnabled = false;
        state.graphSelectedShape = '';
        const graphCol = document.getElementById('graph_column');
        if (graphCol) graphCol.classList.add('hidden');
        disposeTransformationGraphRenderer();
    } else {
        state.realPlotsEnabled = false;
        state.graphFullGridEnabled = false;
        state.graphLayerLockEnabled = false;
        state.graphFourierEnabled = false;
        state.graphTraceEnabled = false;
        state.graphSelectedShape = '';
        const graphCol = document.getElementById('graph_column');
        if (graphCol) graphCol.classList.remove('hidden');
    }
    refreshPanelEdgeHandles(true);
    setupVisualParameters(false, false);
    syncGridDensityControls();
    syncParameterControlsPanelVisibility();
    syncTransformControlPanels();
    requestUiRedraw();
    requestAnimationFrame(() => {
        setupVisualParameters(false, false);
        requestUiRedraw();
        setTimeout(() => {
            setupVisualParameters(false, false);
            requestUiRedraw();
        }, 360);
    });
}

function toggleFullGrid() {
    const fullGridSupported = isFullGridPerspectiveSupported(state.currentInputShape);
    if (!state.graphViewEnabled || !fullGridSupported) return;
    state.graphFullGridEnabled = !state.graphFullGridEnabled;
    if (state.graphFullGridEnabled) {
        state.graphGridFamily = 'primary';
        state.graphSelectedShape = '';
        const familySel = document.getElementById('graph_grid_family_selector');
        if (familySel) familySel.value = 'primary';
    } else {
        state.graphLayerLockEnabled = false;
        state.graphSelectedShape = '';
    }
    syncGridDensityControls();
    syncTransformControlPanels();
    requestUiRedraw();
}

function toggleLockLayer() {
    if (!state.graphViewEnabled || !state.graphFullGridEnabled) return;
    state.graphLayerLockEnabled = !state.graphLayerLockEnabled;
    if (state.graphLayerLockEnabled) {
        state.graphTraceEnabled = false;
        state.graphFourierEnabled = false;
    }
    state.graphSelectedShape = '';
    state.graphSelectionRevision = (state.graphSelectionRevision || 0) + 1;
    syncGridDensityControls();
    syncTransformControlPanels();
    requestUiRedraw();
}

function getZPlaneMenuItems() {
    if (Boolean(state.laplaceModeEnabled)) {
        return null;
    }
    const items = [
        {
            id: 'download_image_z',
            label: 'Download Image',
            icon: 'download',
            type: 'action',
            onClick: () => {
                const canvas = context.zCanvas || document.getElementById('z_plane_canvas');
                downloadCanvasImage(canvas, 'z-plane.png');
            }
        },
        { type: 'divider' },
        {
            id: 'show_zeros_poles',
            label: 'Show zeroes & poles',
            type: 'checkbox',
            checked: Boolean(state.showZerosPoles),
            onClick: () => {
                state.showZerosPoles = !state.showZerosPoles;
                requestUiRedraw();
            }
        },
        {
            id: 'show_critical_points',
            label: 'Show critical points',
            type: 'checkbox',
            checked: Boolean(state.showCriticalPoints),
            onClick: () => {
                state.showCriticalPoints = !state.showCriticalPoints;
                requestUiRedraw();
            }
        },
        {
            id: 'cauchy_integral',
            label: 'Cauchy Integral',
            type: 'checkbox',
            checked: Boolean(state.cauchyIntegralModeEnabled),
            onClick: () => {
                state.cauchyIntegralModeEnabled = !state.cauchyIntegralModeEnabled;
                syncParameterControlsPanelVisibility();
                requestUiRedraw();
            }
        },
        {
            id: 'take_radial_steps',
            label: 'Take radial steps',
            type: 'checkbox',
            checked: Boolean(state.radialDiscreteStepsEnabled),
            onClick: () => {
                state.radialDiscreteStepsEnabled = !state.radialDiscreteStepsEnabled;
                syncParameterControlsPanelVisibility();
                requestDomainRedraw();
            }
        }
    ];

    if (state.domainColoringEnabled) {
        items.push({
            id: 'show_derivative_z',
            label: 'Show derivative',
            type: 'checkbox',
            checked: state.mapPresentation === 'derivative',
            onClick: () => {
                state.mapPresentation = state.mapPresentation === 'derivative' ? 'function' : 'derivative';
                syncManifoldTransformationUI();
                updateChainingTitles();
                requestDomainRedraw();
            }
        });
        items.push({
            id: 'taylor_series_z',
            label: 'Taylor Series',
            type: 'checkbox',
            checked: Boolean(state.taylorSeriesEnabled),
            onClick: () => {
                state.taylorSeriesEnabled = !state.taylorSeriesEnabled;
                syncParameterControlsPanelVisibility();
                requestDomainRedraw();
            }
        });
    }

    return items;
}

function getWPlaneMenuItems() {
    if (Boolean(state.laplaceModeEnabled)) {
        return null;
    }
    const isRiemannActive = Boolean(state.riemannSurfaceEnabled || state.riemannSurfaceModeEnabled);
    const isManifoldActive = Boolean(state.manifold3dViewEnabled || state.manifold3DEnabled);
    if (isRiemannActive || isManifoldActive) {
        return null;
    }

    const graphSupported = isGraphViewSupported(state.currentInputShape);
    const fullGridSupported = isFullGridPerspectiveSupported(state.currentInputShape);

    return [
        {
            id: 'download_image_w',
            label: 'Download Image',
            icon: 'download',
            type: 'action',
            onClick: () => {
                const canvas = context.wCanvas || document.getElementById('w_plane_canvas');
                downloadCanvasImage(canvas, 'w-plane.png');
            }
        },
        { type: 'divider' },
        {
            id: 'show_derivative_w',
            label: 'Show Derivative',
            type: 'checkbox',
            checked: state.mapPresentation === 'derivative',
            onClick: () => {
                state.mapPresentation = state.mapPresentation === 'derivative' ? 'function' : 'derivative';
                syncManifoldTransformationUI();
                updateChainingTitles();
                requestDomainRedraw();
            }
        },
        {
            id: 'taylor_series_w',
            label: 'Taylor Series',
            type: 'checkbox',
            checked: Boolean(state.taylorSeriesEnabled),
            onClick: () => {
                state.taylorSeriesEnabled = !state.taylorSeriesEnabled;
                syncParameterControlsPanelVisibility();
                requestDomainRedraw();
            }
        },
        {
            id: 'show_folds_3d',
            label: 'Show folds in 3d',
            type: 'checkbox',
            checked: Boolean(state.foldSurface3dEnabled),
            onClick: () => {
                state.foldSurface3dEnabled = !state.foldSurface3dEnabled;
                if (state.foldSurface3dEnabled) {
                    enableFoldSurface3d();
                } else {
                    disableFoldSurface3d();
                }
                syncGridDensityControls({ applyFoldDefault: state.foldSurface3dEnabled });
                syncParameterControlsPanelVisibility();
                requestDomainRedraw();
            }
        },
        {
            id: 'view_graph',
            label: 'View Graph',
            type: 'checkbox',
            checked: Boolean(state.graphViewEnabled),
            disabled: !graphSupported,
            children: [
                {
                    id: 'enable_graph_view_sub',
                    label: 'View Graph',
                    type: 'checkbox',
                    checked: Boolean(state.graphViewEnabled),
                    disabled: !graphSupported,
                    onClick: () => {
                        toggleGraphView();
                    }
                },
                {
                    id: 'view_full_grid_sub',
                    label: 'Full Grid Perspective',
                    type: 'checkbox',
                    checked: Boolean(state.graphFullGridEnabled),
                    disabled: !state.graphViewEnabled || !fullGridSupported,
                    onClick: () => {
                        toggleFullGrid();
                    }
                },
                {
                    id: 'lock_layer_sub',
                    label: 'Lock Layer',
                    type: 'checkbox',
                    checked: Boolean(state.graphLayerLockEnabled),
                    disabled: !state.graphViewEnabled || !state.graphFullGridEnabled,
                    onClick: () => {
                        toggleLockLayer();
                    }
                }
            ],
            onClick: () => {
                toggleGraphView();
            }
        }
    ];
}

function renderSubmenu(parentBtn, children) {
    if (!children || children.length === 0) return;
    const sub = getOrCreateSubmenuElement();
    sub.innerHTML = '';

    children.forEach(child => {
        if (child.type === 'divider') {
            const divider = document.createElement('div');
            divider.className = 'plane-context-menu-divider';
            sub.appendChild(divider);
            return;
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'plane-context-menu-item';
        if (child.disabled) {
            btn.classList.add('disabled');
            btn.disabled = true;
        }

        if (child.type === 'checkbox') {
            btn.setAttribute('role', 'menuitemcheckbox');
            btn.setAttribute('aria-checked', child.checked ? 'true' : 'false');
            if (child.checked) {
                btn.classList.add('checked');
            }

            const checkSpan = document.createElement('span');
            checkSpan.className = 'plane-context-menu-check';
            checkSpan.innerHTML = child.checked ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : '';
            btn.appendChild(checkSpan);
        }

        const labelSpan = document.createElement('span');
        labelSpan.className = 'plane-context-menu-label';
        labelSpan.textContent = child.label;
        btn.appendChild(labelSpan);

        btn.addEventListener('click', event => {
            event.stopPropagation();
            hidePlaneContextMenu();
            if (!child.disabled && typeof child.onClick === 'function') {
                child.onClick();
            }
        });

        sub.appendChild(btn);
    });

    sub.classList.remove('hidden');

    const parentRect = parentBtn.getBoundingClientRect();
    const subRect = sub.getBoundingClientRect();
    const margin = 8;

    let subX = parentRect.right + 2;
    if (subX + subRect.width > window.innerWidth - margin) {
        subX = parentRect.left - subRect.width - 2;
    }
    if (subX < margin) subX = margin;

    let subY = parentRect.top;
    if (subY + subRect.height > window.innerHeight - margin) {
        subY = window.innerHeight - subRect.height - margin;
    }
    if (subY < margin) subY = margin;

    sub.style.left = `${subX}px`;
    sub.style.top = `${subY}px`;
}

function renderMenu(items, x, y) {
    if (!items || items.length === 0) {
        hidePlaneContextMenu();
        return;
    }

    hideSubmenu();

    const menu = getOrCreateMenuElement();
    menu.innerHTML = '';

    items.forEach(item => {
        if (item.type === 'divider') {
            const divider = document.createElement('div');
            divider.className = 'plane-context-menu-divider';
            menu.appendChild(divider);
            return;
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'plane-context-menu-item';
        if (item.disabled) {
            btn.classList.add('disabled');
            btn.disabled = true;
        }

        if (item.type === 'checkbox') {
            btn.setAttribute('role', 'menuitemcheckbox');
            btn.setAttribute('aria-checked', item.checked ? 'true' : 'false');
            if (item.checked) {
                btn.classList.add('checked');
            }

            const checkSpan = document.createElement('span');
            checkSpan.className = 'plane-context-menu-check';
            checkSpan.innerHTML = item.checked ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : '';
            btn.appendChild(checkSpan);
        } else {
            btn.setAttribute('role', 'menuitem');
            const iconSpan = document.createElement('span');
            iconSpan.className = 'plane-context-menu-icon';
            if (item.icon === 'download') {
                iconSpan.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
            }
            btn.appendChild(iconSpan);
        }

        const labelSpan = document.createElement('span');
        labelSpan.className = 'plane-context-menu-label';
        labelSpan.textContent = item.label;
        btn.appendChild(labelSpan);

        if (item.children && item.children.length > 0) {
            btn.classList.add('has-submenu');
            const arrowSpan = document.createElement('span');
            arrowSpan.className = 'plane-context-menu-arrow';
            arrowSpan.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
            btn.appendChild(arrowSpan);

            btn.addEventListener('mouseenter', () => {
                if (submenuCloseTimer) {
                    clearTimeout(submenuCloseTimer);
                    submenuCloseTimer = null;
                }
                renderSubmenu(btn, item.children);
            });

            btn.addEventListener('mouseleave', () => {
                submenuCloseTimer = setTimeout(() => {
                    hideSubmenu();
                }, 220);
            });

            btn.addEventListener('click', event => {
                event.stopPropagation();
                if (!item.disabled && typeof item.onClick === 'function') {
                    hidePlaneContextMenu();
                    item.onClick();
                } else {
                    renderSubmenu(btn, item.children);
                }
            });
        } else {
            btn.addEventListener('mouseenter', () => {
                hideSubmenu();
            });

            btn.addEventListener('click', event => {
                event.stopPropagation();
                hidePlaneContextMenu();
                if (!item.disabled && typeof item.onClick === 'function') {
                    item.onClick();
                }
            });
        }

        menu.appendChild(btn);
    });

    menu.classList.remove('hidden');
    isMenuOpen = true;

    // Position menu and clamp to viewport
    const menuRect = menu.getBoundingClientRect();
    const margin = 8;
    const maxX = window.innerWidth - menuRect.width - margin;
    const maxY = window.innerHeight - menuRect.height - margin;

    const posX = Math.max(margin, Math.min(x, maxX));
    const posY = Math.max(margin, Math.min(y, maxY));

    menu.style.left = `${posX}px`;
    menu.style.top = `${posY}px`;
}

export function handlePlaneContextMenu(event, planeType) {
    event.preventDefault();
    event.stopPropagation();

    const items = planeType === 'z' ? getZPlaneMenuItems() : getWPlaneMenuItems();
    if (!items) {
        hidePlaneContextMenu();
        return;
    }

    renderMenu(items, event.clientX, event.clientY);
}

export function initPlaneContextMenu() {
    const zWrapper = document.getElementById('z_plane_canvas_wrapper');
    const wWrapper = document.getElementById('w_plane_canvas_wrapper');
    const zCanvas = document.getElementById('z_plane_canvas');
    const wCanvas = document.getElementById('w_plane_canvas');

    if (zWrapper) {
        zWrapper.addEventListener('contextmenu', event => handlePlaneContextMenu(event, 'z'));
    } else if (zCanvas) {
        zCanvas.addEventListener('contextmenu', event => handlePlaneContextMenu(event, 'z'));
    }

    if (wWrapper) {
        wWrapper.addEventListener('contextmenu', event => handlePlaneContextMenu(event, 'w'));
    } else if (wCanvas) {
        wCanvas.addEventListener('contextmenu', event => handlePlaneContextMenu(event, 'w'));
    }

    // Completely disable native context menu on all canvas elements in the workspace
    document.querySelectorAll('canvas').forEach(canvas => {
        canvas.addEventListener('contextmenu', event => {
            event.preventDefault();
        });
    });

    // Dismiss context menu on click outside or escape
    window.addEventListener('click', event => {
        if (isMenuOpen && menuElement && !menuElement.contains(event.target) && (!submenuElement || !submenuElement.contains(event.target))) {
            hidePlaneContextMenu();
        }
    }, { capture: true, passive: true });

    window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && isMenuOpen) {
            hidePlaneContextMenu();
        }
    }, { passive: true });

    window.addEventListener('resize', hidePlaneContextMenu, { passive: true });
}
