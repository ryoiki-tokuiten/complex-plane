import { state, context } from '../store/state.js';
import { requestDomainRedraw, requestUiRedraw } from '../rendering/redraw-scheduler.js';
import {
    fitConformalGridOutputViewport
} from './ui-updates.js';
import { pauseUploadedVideoPlayback } from '../utils/raster-media.js';
import { downloadCanvasImage } from '../utils/dom-utils.js';
import {
    isGraphViewSupported,
    isFullGridPerspectiveSupported,
    disposeTransformationGraphRenderer
} from '../rendering/transformation-graph.js';
import { syncGridDensityControls } from './grid-density-controls.js';
import { refreshPanelEdgeHandles } from './panel-layout-manager.js';
import { setNavigationModeEnabled } from '../navigation-plane.js';
import { updateDynamicPlotting } from './dynamic-plotting-state.js';
import { getDefaultInputShapeForManifold } from '../rendering/manifold-registry.js';

let menuElement = null;
let submenuElement = null;
let submenuBridgeElement = null;
let isMenuOpen = false;
let submenuCloseTimer = null;
const SUBMENU_CLOSE_DELAY_MS = 350;
const PROPAGATION_EVENTS = [
    'pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup',
    'wheel', 'click', 'input', 'change', 'touchstart', 'touchmove', 'touchend'
];
const STAGED_PANELS = {
    taylor: ['taylor_series_options_detail_div', 'taylor_panel_staging', 'taylor_series_exact_panel'],
    domain: ['domain_coloring_options_div', 'domain_coloring_panel_staging', 'domain_coloring_exact_panel'],
    manifold: ['manifold_options_div', 'manifold_panel_staging', 'manifold_exact_panel'],
    riemann: ['riemann_surface_options_div', 'riemann_surface_panel_staging', 'riemann_surface_exact_panel']
};
const propagationBoundaries = new WeakSet();
const CHECK_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
const DOWNLOAD_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
const SUBMENU_ARROW = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

function bindPropagationBoundary(element) {
    if (!element || propagationBoundaries.has(element)) return;
    PROPAGATION_EVENTS.forEach(type => element.addEventListener(type, event => event.stopPropagation()));
    propagationBoundaries.add(element);
}

function appendDivider(container) {
    const divider = document.createElement('div');
    divider.className = 'plane-context-menu-divider';
    container.appendChild(divider);
}

function setMenuItemChecked(button, checked) {
    button.setAttribute('aria-checked', String(Boolean(checked)));
    button.classList.toggle('checked', Boolean(checked));
    const mark = button.querySelector('.plane-context-menu-check');
    if (mark) mark.innerHTML = checked ? CHECK_ICON : '';
}

function createMenuItem(item, topLevel = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plane-context-menu-item';
    if (!topLevel && item.id) button.id = item.id;
    if (item.disabled) {
        button.classList.add('disabled');
        button.disabled = true;
    }

    if (item.type === 'checkbox') {
        button.setAttribute('role', 'menuitemcheckbox');
        const mark = document.createElement('span');
        mark.className = 'plane-context-menu-check';
        button.appendChild(mark);
        setMenuItemChecked(button, item.checked);
    } else if (topLevel) {
        button.setAttribute('role', 'menuitem');
        const icon = document.createElement('span');
        icon.className = 'plane-context-menu-icon';
        if (item.icon === 'download') icon.innerHTML = DOWNLOAD_ICON;
        button.appendChild(icon);
    }

    const label = document.createElement('span');
    label.className = 'plane-context-menu-label';
    label.textContent = item.label;
    button.appendChild(label);
    return button;
}

function cancelSubmenuClose() {
    if (submenuCloseTimer) clearTimeout(submenuCloseTimer);
    submenuCloseTimer = null;
}

function scheduleSubmenuClose() {
    cancelSubmenuClose();
    submenuCloseTimer = setTimeout(hideSubmenu, SUBMENU_CLOSE_DELAY_MS);
}

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

    submenuElement.addEventListener('mouseenter', cancelSubmenuClose);
    submenuElement.addEventListener('mouseleave', scheduleSubmenuClose);

    bindPropagationBoundary(submenuElement);

    return submenuElement;
}

function getOrCreateSubmenuBridgeElement() {
    if (submenuBridgeElement && document.body.contains(submenuBridgeElement)) {
        return submenuBridgeElement;
    }
    submenuBridgeElement = document.createElement('div');
    submenuBridgeElement.id = 'plane_context_submenu_bridge';
    submenuBridgeElement.className = 'plane-context-submenu-bridge hidden';
    submenuBridgeElement.addEventListener('mouseenter', cancelSubmenuClose);
    submenuBridgeElement.addEventListener('mouseleave', scheduleSubmenuClose);
    document.body.appendChild(submenuBridgeElement);
    return submenuBridgeElement;
}

function restoreStagedPanels() {
    Object.values(STAGED_PANELS).forEach(([panelId, stagingId]) => {
        const panel = document.getElementById(panelId);
        const staging = document.getElementById(stagingId);
        if (panel?.parentNode && staging && panel.parentNode !== staging) staging.appendChild(panel);
    });
}

function stagedPanelSubmenu(name) {
    const [panelId, , itemId] = STAGED_PANELS[name];
    return [{
        type: 'custom',
        id: itemId,
        render(container) {
            const panel = document.getElementById(panelId);
            if (!panel) return;
            panel.classList.remove('hidden');
            container.appendChild(panel);
            bindPropagationBoundary(panel);
        }
    }];
}

function hideSubmenu() {
    cancelSubmenuClose();
    restoreStagedPanels();
    if (submenuElement) {
        submenuElement.classList.add('hidden');
        submenuElement.innerHTML = '';
    }
    submenuBridgeElement?.classList.add('hidden');
}

export function hidePlaneContextMenu() {
    hideSubmenu();
    if (!menuElement || !isMenuOpen) return;
    menuElement.classList.add('hidden');
    menuElement.innerHTML = '';
    isMenuOpen = false;
}

function enableFoldSurface3d() {
    state.riemannSurfaceEnabled = false;
    state.manifold3dViewEnabled = false;
    state.manifoldTransformationEnabled = false;
}

function disableFoldSurface3d() {
    state.foldSurface3dEnabled = false;
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
    window.dispatchEvent(new Event('resize'));
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
    requestUiRedraw();
}

function ensureGraphViewEnabled() {
    if (!state.graphViewEnabled) toggleGraphView();
    return state.graphViewEnabled;
}

function ensureFullGridEnabled() {
    if (!ensureGraphViewEnabled()) return false;
    if (!state.graphFullGridEnabled) toggleFullGrid();
    return state.graphFullGridEnabled;
}

function getVectorFieldSubmenuItems() {
    return [
        {
            id: 'vector_field_sub_item',
            label: 'Vector Field',
            type: 'checkbox',
            checked: Boolean(state.vectorFieldEnabled),
            keepOpenOnClick: true,
            onClick: () => {
                state.vectorFieldEnabled = !state.vectorFieldEnabled;
                if (state.vectorFieldEnabled) {
                    state.streamlineFlowEnabled = false;
                }
                requestDomainRedraw(true);
                requestUiRedraw();
            }
        },
        {
            id: 'streamlines_sub_item',
            label: 'Streamlines',
            type: 'checkbox',
            checked: Boolean(state.streamlineFlowEnabled),
            keepOpenOnClick: true,
            onClick: () => {
                state.streamlineFlowEnabled = !state.streamlineFlowEnabled;
                if (state.streamlineFlowEnabled) {
                    state.vectorFieldEnabled = false;
                }
                requestDomainRedraw(true);
                requestUiRedraw();
            }
        },
        {
            id: 'particle_motion_sub_item',
            label: 'Particle Motion',
            type: 'checkbox',
            checked: Boolean(state.particleAnimationEnabled),
            keepOpenOnClick: true,
            onClick: () => {
                state.particleAnimationEnabled = !state.particleAnimationEnabled;
                if (state.particleAnimationEnabled && !state.vectorFieldEnabled && !state.streamlineFlowEnabled) {
                    state.vectorFieldEnabled = true;
                }
                requestDomainRedraw(true);
                requestUiRedraw();
            }
        }
    ];
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
            onClick: () => downloadCanvasImage(context.zCanvas, 'z-plane.png')
        },
        { type: 'divider' },
        {
            id: 'domain_coloring_z',
            label: 'Domain Coloring',
            type: 'checkbox',
            checked: Boolean(state.domainColoringEnabled),
            children: stagedPanelSubmenu('domain'),
            onClick: () => {
                state.domainColoringEnabled = !state.domainColoringEnabled;
                if (state.domainColoringEnabled) {
                    if (state.manifold3dViewEnabled) {
                        state.manifold3dViewEnabled = false;
                        state.manifoldTransformationEnabled = false;
                    }
                    if (state.currentInputShape !== 'empty_grid') {
                        if (state.currentInputShape === 'media' && state.videoIsPlaying) {
                            pauseUploadedVideoPlayback();
                        }
                        state.currentInputShape = 'empty_grid';
                    }
                }
                requestDomainRedraw(true);
                requestUiRedraw();
            }
        },
        {
            id: 'analysis_z',
            label: 'Analysis',
            type: 'menuitem',
            children: [
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
                        requestUiRedraw();
                    }
                },
                {
                    id: 'conformal_grid',
                    label: 'Conformal Grid',
                    type: 'checkbox',
                    checked: Boolean(state.conformalGridEnabled),
                    onClick: () => {
                        state.conformalGridEnabled = !state.conformalGridEnabled;
                        if (state.conformalGridEnabled) {
                            if (state.currentInputShape === 'media' && state.videoIsPlaying) {
                                pauseUploadedVideoPlayback();
                            }
                            state.currentInputShape = 'empty_grid';
                            if (context.controls?.inputShapeSelector) {
                                context.controls.inputShapeSelector.value = 'empty_grid';
                            }
                            fitConformalGridOutputViewport();
                        }
                        requestUiRedraw();
                    }
                }
            ]
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
                requestDomainRedraw();
            }
        });
        items.push({
            id: 'taylor_series_z',
            label: 'Taylor Series',
            type: 'checkbox',
            checked: Boolean(state.taylorSeriesEnabled),
            children: stagedPanelSubmenu('taylor'),
            onClick: () => {
                state.taylorSeriesEnabled = !state.taylorSeriesEnabled;
                requestDomainRedraw(true);
            }
        });
    }

    items.push({
        id: 'vector_field_z',
        label: 'Vector Field',
        type: 'checkbox',
        checked: Boolean(state.vectorFieldEnabled || state.streamlineFlowEnabled || state.particleAnimationEnabled),
        getSubmenu: getVectorFieldSubmenuItems,
        onClick: () => {
            const isAnyActive = state.vectorFieldEnabled || state.streamlineFlowEnabled || state.particleAnimationEnabled;
            if (isAnyActive) {
                state.vectorFieldEnabled = false;
                state.streamlineFlowEnabled = false;
                state.particleAnimationEnabled = false;
            } else {
                state.vectorFieldEnabled = true;
                state.streamlineFlowEnabled = false;
            }
            requestDomainRedraw(true);
            requestUiRedraw();
        }
    });

    items.push({
        id: 'take_radial_steps',
        label: 'Take radial steps',
        type: 'checkbox',
        checked: Boolean(state.radialDiscreteStepsEnabled),
        onClick: () => {
            state.radialDiscreteStepsEnabled = !state.radialDiscreteStepsEnabled;
            requestDomainRedraw();
        }
    });

    items.push({
        id: 'dynamic_plotting_z',
        label: 'Dynamic Plotting',
        type: 'checkbox',
        checked: Boolean(state.dynamicPlotting?.enabled),
        onClick: () => {
            const nextEnabled = !state.dynamicPlotting?.enabled;
            updateDynamicPlotting(dynamic => {
                dynamic.enabled = nextEnabled;
                if (!nextEnabled) dynamic.playback.playing = false;
            }, { preservePreset: true });
        }
    });

    return items;
}

function getWPlaneMenuItems() {
    if (Boolean(state.laplaceModeEnabled)) {
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
            onClick: () => downloadCanvasImage(context.wCanvas, 'w-plane.png')
        },
        { type: 'divider' },
        {
            id: 'show_derivative_w',
            label: 'Show Derivative',
            type: 'checkbox',
            checked: state.mapPresentation === 'derivative',
            onClick: () => {
                state.mapPresentation = state.mapPresentation === 'derivative' ? 'function' : 'derivative';
                requestDomainRedraw();
            }
        },
        {
            id: 'taylor_series_w',
            label: 'Taylor Series',
            type: 'checkbox',
            checked: Boolean(state.taylorSeriesEnabled),
            children: stagedPanelSubmenu('taylor'),
            onClick: () => {
                state.taylorSeriesEnabled = !state.taylorSeriesEnabled;
                requestDomainRedraw(true);
            }
        },
        {
            id: 'inverse_preimage_explorer_w',
            label: 'Inverse / Preimage Explorer',
            type: 'checkbox',
            checked: Boolean(state.preimageExplorerEnabled),
            onClick: () => {
                state.preimageExplorerEnabled = !state.preimageExplorerEnabled;
                if (!state.preimageExplorerEnabled) {
                    state.preimageTarget = null;
                    state.preimageRoots = [];
                    state.preimageStatus = '';
                }
                requestUiRedraw();
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
                requestDomainRedraw();
            }
        },
        {
            id: 'manifold_3d_w',
            label: '3D Manifolds',
            type: 'checkbox',
            checked: Boolean(state.manifold3dViewEnabled),
            children: stagedPanelSubmenu('manifold'),
            onClick: () => {
                state.manifold3dViewEnabled = !state.manifold3dViewEnabled;
                if (state.manifold3dViewEnabled) {
                    state.domainColoringEnabled = false;
                    disableFoldSurface3d();
                    if (state.riemannSurfaceEnabled) {
                        state.riemannSurfaceEnabled = false;
                        state.show2DContourPlot = false;
                    }
                    state.manifoldTransformationEnabled = false;
                    state.manifoldTransformationProgressW = 1.0;

                    const defaultShape = getDefaultInputShapeForManifold(state.selectedManifold);
                    state.currentInputShape = defaultShape;
                } else {
                    state.manifoldTransformationEnabled = false;
                }
                requestDomainRedraw(true);
                requestUiRedraw();
            }
        },
        {
            id: 'riemann_surface_w',
            label: 'Riemann Surface',
            type: 'checkbox',
            checked: Boolean(state.riemannSurfaceEnabled),
            children: stagedPanelSubmenu('riemann'),
            onClick: () => {
                state.riemannSurfaceEnabled = !state.riemannSurfaceEnabled;
                if (state.riemannSurfaceEnabled) {
                    disableFoldSurface3d();
                    state.realPlotsEnabled = false;
                    Object.assign(state, { manifold3dViewEnabled: false, manifoldTransformationEnabled: false });
                    if (state.navigationModeEnabled) setNavigationModeEnabled(false);
                } else {
                    state.show2DContourPlot = false;
                }
                requestDomainRedraw(true);
                requestUiRedraw();
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
                    disabled: !fullGridSupported,
                    onClick: () => {
                        if (ensureGraphViewEnabled()) toggleFullGrid();
                    }
                },
                {
                    id: 'lock_layer_sub',
                    label: 'Lock Layer',
                    type: 'checkbox',
                    checked: Boolean(state.graphLayerLockEnabled),
                    disabled: !fullGridSupported,
                    onClick: () => {
                        if (state.graphLayerLockEnabled || ensureFullGridEnabled()) {
                            toggleLockLayer();
                        }
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
    restoreStagedPanels();
    sub.innerHTML = '';

    children.forEach(child => {
        if (child.type === 'divider') {
            appendDivider(sub);
            return;
        }

        if (child.type === 'custom' && typeof child.render === 'function') {
            child.render(sub);
            return;
        }

        const btn = createMenuItem(child);

        btn.addEventListener('click', event => {
            event.stopPropagation();
            if (child.keepOpenOnClick) {
                if (!child.disabled && typeof child.onClick === 'function') {
                    child.onClick();
                    if (parentBtn && typeof parentBtn._getSubmenuItems === 'function') {
                        renderSubmenu(parentBtn, parentBtn._getSubmenuItems());
                    } else {
                        child.checked = !child.checked;
                        setMenuItemChecked(btn, child.checked);
                    }
                }
            } else {
                hidePlaneContextMenu();
                if (!child.disabled && typeof child.onClick === 'function') {
                    child.onClick();
                }
            }
        });

        sub.appendChild(btn);
    });

    sub.classList.remove('hidden');

    const parentRect = parentBtn.getBoundingClientRect();
    const margin = 8;
    const offset = 10;
    const maxHeight = Math.max(120, window.innerHeight - 2 * margin);

    sub.style.maxHeight = `${maxHeight}px`;
    sub.style.overflowY = 'auto';
    sub.style.overflowX = 'hidden';

    const subRect = sub.getBoundingClientRect();

    let subX = parentRect.right + offset;
    if (subX + subRect.width > window.innerWidth - margin) {
        subX = parentRect.left - subRect.width - offset;
    }
    if (subX < margin) subX = margin;

    let subY = parentRect.top - 4;
    if (subY + subRect.height > window.innerHeight - margin) {
        subY = window.innerHeight - subRect.height - margin;
    }
    if (subY < margin) subY = margin;

    sub.style.left = `${subX}px`;
    sub.style.top = `${subY}px`;

    const opensRight = subX >= parentRect.right;
    const gapLeft = opensRight ? parentRect.right : subX + subRect.width;
    const gapRight = opensRight ? subX : parentRect.left;
    const gapTop = Math.min(parentRect.top, subY);
    const gapBottom = Math.max(parentRect.bottom, subY + subRect.height);
    const bridge = getOrCreateSubmenuBridgeElement();
    bridge.style.left = `${gapLeft}px`;
    bridge.style.top = `${gapTop}px`;
    bridge.style.width = `${Math.max(0, gapRight - gapLeft)}px`;
    bridge.style.height = `${Math.max(0, gapBottom - gapTop)}px`;
    bridge.classList.toggle('hidden', gapRight <= gapLeft);
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
            appendDivider(menu);
            return;
        }

        const btn = createMenuItem(item, true);

        const getChildren = () => typeof item.getSubmenu === 'function' ? item.getSubmenu() : item.children;
        const children = getChildren();
        if (children && children.length > 0) {
            btn.classList.add('has-submenu');
            const arrow = document.createElement('span');
            arrow.className = 'plane-context-menu-arrow';
            arrow.innerHTML = SUBMENU_ARROW;
            btn.appendChild(arrow);
            btn._getSubmenuItems = getChildren;

            btn.addEventListener('mouseenter', () => {
                cancelSubmenuClose();
                renderSubmenu(btn, getChildren());
            });

            btn.addEventListener('mouseleave', scheduleSubmenuClose);

            btn.addEventListener('click', event => {
                event.stopPropagation();
                if (!item.disabled && typeof item.onClick === 'function') {
                    hidePlaneContextMenu();
                    item.onClick();
                } else {
                    renderSubmenu(btn, getChildren());
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

function handlePlaneContextMenu(event, planeType) {
    event.preventDefault();
    event.stopPropagation();

    if (state.taylorSeriesCanvasClickCenterEnabled) {
        state.taylorSeriesCanvasClickCenterEnabled = false;
        state.taylorSeriesHoverPoint = null;
        requestUiRedraw();
        return;
    }

    const items = planeType === 'z' ? getZPlaneMenuItems() : getWPlaneMenuItems();
    if (!items) {
        hidePlaneContextMenu();
        return;
    }

    renderMenu(items, event.clientX, event.clientY);
}

export function initPlaneContextMenu() {
    document.getElementById('canvases_section').addEventListener('contextmenu', event => {
        const wrapper = event.target.closest?.('#z_plane_canvas_wrapper, #w_plane_canvas_wrapper');
        if (wrapper) {
            handlePlaneContextMenu(event, wrapper.id.startsWith('z_') ? 'z' : 'w');
        } else if (event.target.closest?.('canvas')) {
            event.preventDefault();
        }
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

}
