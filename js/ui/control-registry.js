const CONTROL_ALIASES = Object.freeze({
    zCanvasWrapper: 'z_plane_canvas_wrapper',
    wCanvasWrapper: 'w_plane_canvas_wrapper',
    zCanvasCard: 'z_plane_column',
    wCanvasCard: 'w_plane_column',
    chainingParamsBlock: 'chaining_params',
    algebraicChainingParamsBlock: 'algebraic_chaining_params',
    fourierSpecificControlsDiv: 'fourier_specific_controls',
    laplaceSpecificControlsDiv: 'laplace_specific_controls',
    laplaceShowROCCb: 'laplace_show_roc_cb',
    domainColoringKeyDiv: 'domain_coloring_key',
    zetaSpecificControlsDiv: 'zeta_specific_controls',
    navigationParamsBlock: 'navigation_params',
    toggleFullscreenLaplace3DBtn: 'toggle_fullscreen_laplace_3d_btn',
    laplace3DColumn: 'laplace_3d_column',
    laplace3DContainer: 'laplace_3d_container',
    contour2DColumn: 'contour_2d_column',
    contour2DCanvas: 'contour_2d_canvas',
    riemannSurfaceShow2DContourBtn: 'riemann_surface_show_2d_contour_btn',
    realPlotsShow2DContourBtn: 'real_plots_show_2d_contour_btn',
    toggleFullscreenContour2DBtn: 'toggle_fullscreen_contour_2d_btn',
    graph3DContainer: 'graph_3d_container'
});

export function controlKeyFromId(id) {
    return String(id).replace(/[-_]+([A-Za-z0-9])/g, (_, character) => character.toUpperCase());
}

export function registerControls(root, target) {
    root.querySelectorAll('[id]').forEach(element => {
        target[controlKeyFromId(element.id)] = element;
    });
    Object.entries(CONTROL_ALIASES).forEach(([key, id]) => {
        target[key] = root.getElementById(id);
    });
    return target;
}
