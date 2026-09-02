import { state, context } from '../store/state.js';
import { requestDomainRedraw, requestUiRedraw } from '../rendering/redraw-scheduler.js';
import { fitConformalGridOutputViewport } from './view-model.js';
import { pauseUploadedVideoPlayback } from '../utils/raster-media.js';
import { downloadCanvasImage } from '../utils/dom-utils.js';
import { isGraphViewSupported, isFullGridPerspectiveSupported, disposeTransformationGraphRenderer } from '../rendering/transformation-graph.js';
import { syncGridDensityControls } from './grid-density.js';
import { refreshPanelEdgeHandles } from '../ui/panel-layout-manager.js';
import { setNavigationModeEnabled } from '../navigation-plane.js';
import { updateDynamicPlotting } from './dynamic-plotting-state.js';
import { getDefaultInputShapeForManifold } from '../rendering/manifold-registry.js';

function contextPanelSubmenu(panel) { return [{ type: 'custom', panel }]; }

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
        disposeTransformationGraphRenderer();
    } else {
        state.realPlotsEnabled = false;
        state.graphFullGridEnabled = false;
        state.graphLayerLockEnabled = false;
        state.graphFourierEnabled = false;
        state.graphTraceEnabled = false;
        state.graphSelectedShape = '';
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

export function getZPlaneMenuItems() {
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
            children: contextPanelSubmenu('domain'),
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
            children: contextPanelSubmenu('taylor'),
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

export function getWPlaneMenuItems() {
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
            children: contextPanelSubmenu('taylor'),
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
            children: contextPanelSubmenu('manifold'),
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
            children: contextPanelSubmenu('riemann'),
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
