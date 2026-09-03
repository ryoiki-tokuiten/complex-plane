/** @jsxImportSource preact */
import { h } from 'preact';
import { computed, signal } from '@preact/signals';
import { context } from '../store/state.js';
import { controlKeyFromId } from './control-key.js';
import { buildViewModel } from './view-model.js';
import { PolynomialCoefficients } from './components/polynomial-coefficients.jsx';
import { ComplexParameterEditor } from './components/complex-parameter-editor.jsx';
import { AlgebraicTermEditor } from './components/algebraic-term-editor.jsx';
import { PaletteGuide } from './components/palette-guide.jsx';
import { ThemeModal } from './components/theme-modal.jsx';
import { DynamicPlottingStudio } from './components/dynamic-plotting-studio.jsx';
import {
    ActiveDomainPaletteName,
    ActiveSurfacePaletteName,
    DomainPaletteOptions,
    SurfacePaletteOptions
} from './components/theme-and-palette-options.jsx';
import { GridShapeControls } from './components/grid-shape-controls.jsx';
import { InputShapePicker } from './components/input-shape-picker.jsx';
import { PanelEdgeControls } from './components/panel-edge-controls.jsx';
import { getPanelProps } from '../ui/panel-layout-manager.js';
import { ManifoldTransformationControls } from './components/manifold-transformation-controls.jsx';
import { NavigationKeyHints } from './components/navigation-key-hints.jsx';
import { VideoPlaybackButton, VideoPlaybackStatus } from './components/video-playback-status.jsx';
import { DomainRenderingIndicator } from './components/domain-rendering-indicator.jsx';

const SLOTS = {
    polynomial_coeffs_container: PolynomialCoefficients,
    taylor_complex_points_ui_container: () => <ComplexParameterEditor stateKey="taylorSeriesCustomCenter" label="z0" />,
    chain_seed_ui_container: () => <ComplexParameterEditor stateKey="chainSeed" label="z₀" />,
    exp_base_ui_container: () => <ComplexParameterEditor stateKey="expBase" label="a" pickLabel="Pick a base on canvas" />,
    log_base_ui_container: () => <ComplexParameterEditor stateKey="logBase" label="a" pickLabel="Pick a base on canvas" />,
    bessel_order_ui_container: () => <ComplexParameterEditor stateKey="besselOrder" label="ν" />,
    algebraic_terms_list: AlgebraicTermEditor,
    frontend_modal_root: ThemeModal,
    dynamic_plotting_root: DynamicPlottingStudio,
    grid_shape_controls_groups: GridShapeControls,
    input_shape_picker: InputShapePicker,
    navigation_keyhint_overlay: NavigationKeyHints,
    video_play_pause_btn: VideoPlaybackButton,
    video_status_display: VideoPlaybackStatus,
    z_plane_rendering_indicator: DomainRenderingIndicator,
    z_plane_transformation_overlay: () => <ManifoldTransformationControls plane="z" />,
    w_plane_transformation_overlay: () => <ManifoldTransformationControls plane="w" />,
    domain_palette_circles: DomainPaletteOptions,
    real_plots_palette_circles: SurfacePaletteOptions,
    laplace_surface_palette_circles: SurfacePaletteOptions,
    active_domain_palette_name: ActiveDomainPaletteName,
    active_real_plots_palette_name: ActiveSurfacePaletteName,
    active_laplace_surface_palette_name: ActiveSurfacePaletteName,
    domain_palette_circle_panel: () => <PaletteGuide type="domain" />,
    real_plots_palette_circle_panel: () => <PaletteGuide type="real" />
};

const ROOT_SLOTS = new Set([
    'input_shape_picker', 'navigation_keyhint_overlay', 'video_play_pause_btn',
    'video_status_display', 'z_plane_rendering_indicator'
]);
const WORKSPACE_PANELS = new Set([
    'z_plane_column', 'w_plane_column', 'laplace_spectrum_column', 'laplace_com_column',
    'fourier_3d_column', 'graph_column', 'laplace_3d_column', 'real_plots_column',
    'contour_2d_column'
]);

const viewProps = computed(buildViewModel);
const actionProps = signal(new Map());

export function installUiActions(actions) {
    actionProps.value = actions;
}

function saveControl(id, element) {
    const key = controlKeyFromId(id);
    if (element) context.controls[key] = element;
    else delete context.controls[key];
}

export function Ui({ as, id, children, ...staticProps }) {
    const key = controlKeyFromId(id);
    const panel = WORKSPACE_PANELS.has(id) ? getPanelProps(id) : null;
    const dynamicProps = viewProps.value.get(key) || {};
    const actions = actionProps.value.get(key) || {};
    const Slot = SLOTS[id];
    if (Slot && ROOT_SLOTS.has(id)) {
        return <Slot />;
    }
    const slotChildren = Object.hasOwn(dynamicProps, 'children')
        ? dynamicProps.children
        : Slot
            ? <Slot />
            : children;
    const renderedChildren = WORKSPACE_PANELS.has(id)
        ? <>{slotChildren}<PanelEdgeControls panelId={id} /></>
        : slotChildren;
    const props = {
        ...staticProps,
        ...dynamicProps,
        ...actions,
        id,
        ref: element => saveControl(id, element)
    };
    delete props.children;
    if (dynamicProps.$classes) {
        const classes = new Set(String(staticProps.class || '').split(/\s+/).filter(Boolean));
        Object.entries(dynamicProps.$classes).forEach(([name, enabled]) => {
            enabled ? classes.add(name) : classes.delete(name);
        });
        props.class = [...classes].join(' ');
        delete props.$classes;
    }
    if (panel) {
        props.style = panel.style;
        props.class = `${props.class || ''}${panel.dragging ? ' is-dragging' : ''}${panel.resizing ? ' is-resizing' : ''}${panel.edgeVisible ? ' show-edge-handle' : ''}`;
        props.onPointerDown = panel.onPointerDown;
        props.onPointerMove = panel.onPointerMove;
        props.onPointerLeave = panel.onPointerLeave;
    }
    return h(as, props, renderedChildren);
}
