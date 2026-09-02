/** @jsxImportSource preact */
import { useEffect, useRef } from 'preact/hooks';
import { state } from '../../store/state.js';
import { useAppState } from '../state-hooks.js';
import { requestDomainRedraw, requestUiRedraw } from '../../rendering/redraw-scheduler.js';
import { persistThemePreferences } from '../theme.js';
import { refreshPanelEdgeHandles } from '../../ui/panel-layout-manager.js';
import { ThemeOptions } from './theme-and-palette-options.jsx';
import { gridDensityMax } from '../grid-density.js';

import { isThemeModalOpen, closeThemeModal } from '../theme-state.js';

function refreshLayout() {
    window.dispatchEvent(new Event('resize'));
}

function GridColor({ index, stateKey }) {
    const color = useAppState(stateKey);
    return (
        <div class="circle-color-picker-wrapper">
            <div class="circle-color-picker" id={`grid_color_${index}_picker_wrapper`} style={{ backgroundColor: color }}>
                <input type="color" id={`grid_color_${index}_input`} value={color} onInput={event => {
                    state[stateKey] = event.currentTarget.value;
                    persistThemePreferences();
                    requestDomainRedraw();
                }} />
            </div>
            <span class="circle-color-picker-label">Grid Line {index}</span>
        </div>
    );
}

function GridDensityControl({ model, revision }) {
    const density = state.gridDensity ?? 15;
    return (
        <div class="control-group theme-modal-slider-group">
            <label for="grid_density_slider" class="theme-slider-label">
                <span>Grid Density:</span>
                <output id="grid_density_value_display" class="theme-slider-output" key={density}>{density}</output>
            </label>
            <div class="slider-container theme-slider-container">
                <input type="range" id="grid_density_slider" name="grid_density_slider"
                    min="5" max={gridDensityMax(state)} step="1" value={density}
                    data-tooltip="Number of lines in the z-plane input grid"
                    onInput={event => {
                        const val = parseInt(event.currentTarget.value, 10);
                        state.gridDensity = val;
                        requestDomainRedraw(true);
                    }} />
            </div>
        </div>
    );
}

function ProbeNeighborhoodControl() {
    const size = useAppState('probeNeighborhoodSize') ?? 0.2;
    return (
        <div class="control-group theme-modal-slider-group">
            <label for="neighborhood_size_slider" class="theme-slider-label">
                <span>Probe (r<sub>local</sub>):</span>
                <output id="neighborhood_size_value_display" class="theme-slider-output">{Number(size).toFixed(2)}</output>
            </label>
            <div class="slider-container theme-slider-container">
                <input type="range" id="neighborhood_size_slider" name="neighborhood_size_slider"
                    min="0.05" max="0.5" step="0.01" value={size}
                    data-tooltip="Probe radius (r_local) for f'(z) and local properties"
                    onInput={event => {
                        const val = parseFloat(event.currentTarget.value);
                        state.probeNeighborhoodSize = val;
                        requestUiRedraw();
                    }} />
            </div>
        </div>
    );
}

function GridOpacityControl() {
    const opacity = useAppState('backgroundGridOpacity') ?? 1.0;
    return (
        <div class="control-group theme-modal-slider-group">
            <label for="background_grid_opacity_slider" class="theme-slider-label">
                <span>Grid Opacity:</span>
                <output id="background_grid_opacity_value_display" class="theme-slider-output">{Math.round(opacity * 100)}%</output>
            </label>
            <div class="slider-container theme-slider-container">
                <input type="range" id="background_grid_opacity_slider" name="background_grid_opacity_slider"
                    min="0" max="2.5" step="0.05" value={opacity}
                    data-tooltip="Background grid opacity across all canvases"
                    onInput={event => {
                        state.backgroundGridOpacity = parseFloat(event.currentTarget.value);
                        requestDomainRedraw(true);
                    }} />
            </div>
        </div>
    );
}

export function ThemeModal({ model, revision }) {
    const vertical = useAppState('verticalLayoutEnabled');
    const canvasZoomControls = useAppState('canvasZoomControlsEnabled');
    const layoutApplied = useRef(false);

    useEffect(() => {
        if (vertical === undefined) {
            state.verticalLayoutEnabled = localStorage.getItem('complex_verticalLayoutEnabled') === 'true';
            return;
        }
        localStorage.setItem('complex_verticalLayoutEnabled', String(vertical));
        if (typeof document !== 'undefined') {
            document.body?.classList?.toggle('vertical-layout', Boolean(vertical));
            document.querySelector?.('.application-root')?.classList?.toggle('vertical-layout', Boolean(vertical));
        }
        refreshPanelEdgeHandles(true);
        const needsRefresh = vertical || layoutApplied.current;
        layoutApplied.current = true;
        if (needsRefresh) refreshLayout();
    }, [vertical]);

    useEffect(() => {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('complex_canvasZoomControlsEnabled', String(Boolean(canvasZoomControls)));
        }
    }, [canvasZoomControls]);

    const close = closeThemeModal;
    return (
        <div id="theme_modal" class={isThemeModalOpen.value ? '' : 'hidden'}>
            <div class="theme-modal-backdrop" id="theme_modal_backdrop" onClick={close} />
            <div class="theme-modal-content">
                <button id="close_theme_modal_btn" class="theme-modal-close-btn" aria-label="Close theme modal"
                    onClick={close}><i data-lucide="x" /></button>
                <div class="theme-modal-header">
                    <h2>Themes & Display</h2>
                    <p>Select application theme, accent colors, layout, and visualization controls.</p>
                </div>
                <div class="theme-list-container" id="theme_list_container"><ThemeOptions /></div>

                <div class="theme-modal-section">
                    <div class="theme-modal-sliders-row">
                        <GridDensityControl model={model} revision={revision} />
                        <GridOpacityControl />
                        <ProbeNeighborhoodControl />
                    </div>
                </div>

                <div class="theme-modal-section">
                    <div class="control-group theme-modal-control-group">
                        <label for="enable_vertical_layout_cb" class="slider-label"
                            data-tooltip="Switch to vertical layout: panels on left, planes on right">
                            <input type="checkbox" id="enable_vertical_layout_cb"
                                checked={Boolean(vertical)} onChange={event => {
                                    state.verticalLayoutEnabled = event.currentTarget.checked;
                                }} />
                            <span class="custom-checkbox-visual" />
                            Enable Vertical Layout
                        </label>
                    </div>
                    <div class="control-group theme-modal-control-group">
                        <label for="enable_canvas_zoom_controls_cb" class="slider-label"
                            data-tooltip="Show smooth zoom (+ / -) controls on the bottom-right corner of canvases">
                            <input type="checkbox" id="enable_canvas_zoom_controls_cb"
                                checked={Boolean(canvasZoomControls)} onChange={event => {
                                    state.canvasZoomControlsEnabled = event.currentTarget.checked;
                                }} />
                            <span class="custom-checkbox-visual" />
                            Enable On-Canvas Zoom (+ / -)
                        </label>
                    </div>
                </div>

                <div class="theme-modal-section">
                    <h3>Custom Grid Colors</h3>
                    <div class="grid-color-pickers-container">
                        <GridColor index="1" stateKey="gridColor1" />
                        <GridColor index="2" stateKey="gridColor2" />
                    </div>
                </div>
            </div>
        </div>
    );
}
