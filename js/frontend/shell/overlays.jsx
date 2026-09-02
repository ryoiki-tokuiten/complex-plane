/** @jsxImportSource preact */
import { Ui } from '../ui-element.jsx';
import { RangeControl } from '../components/range-control.jsx';

const DOMAIN_RANGES = [
  ['domain_brightness_slider', 'Brightness:', 'domain_brightness_value_display', '1.0', '0.5', '1.5', '0.05', 'Adjust overall brightness of the domain coloring'],
  ['domain_contrast_slider', 'Contrast:', 'domain_contrast_value_display', '1.0', '0.5', '2.0', '0.05', 'Adjust contrast of the domain coloring'],
  ['domain_saturation_slider', 'Saturation:', 'domain_saturation_value_display', '1.0', '0.0', '1.0', '0.05', 'Adjust color saturation of the domain coloring'],
  ['domain_lightness_cycles_slider', 'Lightness Cycles:', 'domain_lightness_cycles_value_display', '1.00', '0.0', '4.0', '0.25', '0 disables magnitude lightness modulation; higher values add optional magnitude shading']
];

const RIEMANN_RANGES = [
  ['riemann_surface_resolution_slider', 'Resolution:', 'riemann_surface_resolution_value_display', '50', '5', '50', '1', 'Geometric detail of the Riemann surface mesh'],
  ['riemann_surface_sheets_slider', 'Visible Sheets:', 'riemann_surface_sheets_value_display', '5', '1', '9', '2', 'Number of branch sheets rendered at once'],
  ['riemann_surface_branch_center_slider', 'Branch Center k:', 'riemann_surface_branch_center_value_display', '0', '-20', '20', '1', 'Move the visible window through the infinite branch family'],
  ['riemann_surface_height_scale_slider', 'Height Scale:', 'riemann_surface_height_scale_value_display', '1.00', '0.15', '2.5', '0.05'],
  ['riemann_surface_height_clip_slider', 'Height Clip:', 'riemann_surface_height_clip_value_display', '8.0', '0.5', '40', '0.5', 'Symmetric value range mapped into the surface height']
];

function RangeControls({ model, controls, labelClass = '' }) {
  return controls.map(([id, label, outputId, value, min, max, step, tooltip]) =>
    <RangeControl key={id} model={model} id={id} name={id} label={label}
      labelClass={labelClass} outputId={outputId} outputValue={value}
      min={min} max={max} step={step} value={value} data-tooltip={tooltip} />
  );
}

export function Overlays({ model, contextPanel = '' }) {
  return (
    <>
      {!contextPanel && <Ui model={model} as="div" id={"frontend_modal_root"} />}
      {contextPanel === 'domain' && <Ui model={model} as="div" id={"domain_coloring_context_panel"}>
        <Ui model={model} as="div" id={"domain_coloring_options_div"} class={"dependent-settings-block"}>
          <div class={"viz-settings-grid"}>
            <div class={"domain-palette-selector-container"}>
              <div class={"domain-palette-header"}>
                <span class={"domain-palette-selector-label domain-palette-label"}>
                  <span>Domain Palette:</span>
                  <Ui model={model} as="span" id={"active_domain_palette_name"} class={"active-palette-label"} />
                </span>
                <Ui model={model} as="button" id={"view_palette_circle_btn"} class={"view-palette-circle-btn"} type={"button"} data-tooltip={"View color guide circle for active palette"}>
                  View Color Circle
                </Ui>
              </div>
              <Ui model={model} as="div" class={"domain-palette-circles"} id={"domain_palette_circles"} />
            </div>
            <Ui model={model} as="div" class={"control-group"} id={"orbit_coloring_mode_group"}>
              <label for={"orbit_coloring_mode_select"} class={"compact-text"}>Orbit Coloring:</label>
              <Ui model={model} as="select" id={"orbit_coloring_mode_select"} class={"control-select"} data-tooltip={"Choose which orbit observable colors recursive output chains"}>
                <option value={"value"}>Final Value</option>
                <option value={"escape"}>Escape</option>
                <option value={"attractor"}>Attractor</option>
                <option value={"hybrid"}>Hybrid</option>
              </Ui>
            </Ui>
            <RangeControls model={model} controls={DOMAIN_RANGES} labelClass="compact-text" />
            <div class={"control-group viz-control-span-2"}>
              <label for={"show_domain_coloring_key_cb"} class={"slider-label"}>
                <Ui model={model} as="input" type={"checkbox"} id={"show_domain_coloring_key_cb"} />
                <span class={"custom-checkbox-visual"} />
                Show the color key panel
              </label>
            </div>
          </div>
        </Ui>
      </Ui>}
      {contextPanel === 'manifold' && <Ui model={model} as="div" id={"manifold_context_panel"}>
        <Ui model={model} as="div" id={"manifold_options_div"} class={"dependent-settings-block viz-stacked-options"}>
          <div class={"control-group"} style={"margin-bottom: 8px;"}>
            <label for={"manifold_shape_selector"} class={"slider-label"} style={"margin-bottom: 4px; font-weight: 600;"}>3D Manifold Surface:</label>
            <Ui model={model} as="select" id={"manifold_shape_selector"} class={"control-select"} data-tooltip={"Choose the 3D manifold embedding geometry"}>
              <option value={"sphere"} selected>Riemann Sphere (S²)</option>
              <option value={"cylinder"}>Log-Cylinder</option>
              <option value={"torus"}>Complex Torus (T²)</option>
              <option value={"helicoid"}>Riemann Helicoid</option>
              <option value={"catenoid"}>Catenoid Minimal</option>
              <option value={"enneper"}>Enneper Minimal</option>
              <option value={"bonnet"}>Bonnet Isometric Family</option>
              <option value={"klein_bottle"}>Klein Bottle Immersion</option>
              <option value={"pseudosphere"}>Beltrami Pseudosphere (H²)</option>
              <option value={"scherk"}>Scherk Minimal Surface</option>
            </Ui>
          </div>
          <div class={"viz-toggle-grid viz-toggle-grid--compact viz-toggle-grid--single"}>
            <label for={"enable_manifold_transformation_cb"} class={"viz-toggle-card viz-toggle-card--compact"}>
              <Ui model={model} as="input" type={"checkbox"} id={"enable_manifold_transformation_cb"} data-tooltip={"Show continuous morph animation from flat plane into 3D manifold"} />
              <span class={"custom-checkbox-visual"} />
              <span class={"viz-toggle-card-content"}>
                <span class={"viz-toggle-card-title"}>Show Transformation</span>
                <span class={"viz-toggle-card-copy"}>Animate grid morph into 3D manifold.</span>
              </span>
            </label>
          </div>
          <Ui model={model} as="div" id={"manifold_surface_options_div"} class={"dependent-settings-block viz-subdetail-block"}>
            <RangeControls model={model} controls={[
              ['manifold_surface_opacity_slider', 'Surface Opacity:', 'manifold_surface_opacity_value_display', '0.35', '0', '1', '0.05', 'Adjust opacity of the 3D surface mesh'],
              ['manifold_grid_opacity_slider', 'Surface Grid Opacity:', 'manifold_grid_opacity_value_display', '0.25', '0', '1', '0.05', 'Adjust opacity of the manifold intrinsic wireframe grid']
            ]} />
          </Ui>
        </Ui>
      </Ui>}
      {contextPanel === 'riemann' && <Ui model={model} as="div" id={"riemann_surface_context_panel"}>
        <Ui model={model} as="div" id={"riemann_surface_options_div"} class={"dependent-settings-block"}>
          <div class={"viz-settings-grid"}>
            <div class={"control-group"}>
              <label for={"riemann_surface_component_selector"}>Surface Height</label>
              <Ui model={model} as="select" id={"riemann_surface_component_selector"} class={"control-select"} data-tooltip={"Choose the component of w used as surface height"}>
                <option value={"imaginary"} selected>Im(w)</option>
                <option value={"real"}>Re(w)</option>
                <option value={"magnitude"}>|w|</option>
                <option value={"phase"}>arg(w)</option>
              </Ui>
            </div>
            <RangeControls model={model} controls={RIEMANN_RANGES} />
            <div class={"control-group"}>
              <label for={"riemann_surface_wireframe_cb"}>
                <Ui model={model} as="input" type={"checkbox"} id={"riemann_surface_wireframe_cb"} checked />
                <span class={"custom-checkbox-visual"} />
                Surface Grid
              </label>
            </div>
            <div class={"control-group"}>
              <label for={"riemann_surface_contours_cb"} data-tooltip={"Overlay height level contour lines onto the surface"}>
                <Ui model={model} as="input" type={"checkbox"} id={"riemann_surface_contours_cb"} />
                <span class={"custom-checkbox-visual"} />
                Contour Lines
              </label>
            </div>
            <Ui model={model} as="div" id={"riemann_surface_contours_details"} class={"contour-controls-panel contour-controls-panel--grid viz-control-span-2 hidden"}>
              <div class={"control-group contour-slider-field"}>
                <div class={"contour-slider-label"}>
                  <label for={"riemann_surface_contour_interval_slider"}>Contour Interval:</label>
                  <Ui model={model} as="output" id={"riemann_surface_contour_interval_value_display"}>
                    0.50
                  </Ui>
                </div>
                <div class={"slider-container"}>
                  <Ui model={model} as="input" type={"range"} id={"riemann_surface_contour_interval_slider"} min={"0.05"} max={"3.00"} step={"0.05"} value={"0.50"} />
                </div>
              </div>
              <div class={"control-group contour-slider-field"}>
                <div class={"contour-slider-label"}>
                  <label for={"riemann_surface_contour_thickness_slider"}>Contour Thickness:</label>
                  <Ui model={model} as="output" id={"riemann_surface_contour_thickness_value_display"}>
                    1.5
                  </Ui>
                </div>
                <div class={"slider-container"}>
                  <Ui model={model} as="input" type={"range"} id={"riemann_surface_contour_thickness_slider"} min={"0.5"} max={"5.0"} step={"0.1"} value={"1.5"} />
                </div>
              </div>
              <div class={"contour-action-row"}>
                <Ui model={model} as="button" id={"riemann_surface_show_2d_contour_btn"} class={"contour-2d-toggle-btn"} type={"button"}>
                  <i data-lucide={"image"} />
                  <span>Show 2D Contour Plot</span>
                </Ui>
              </div>
            </Ui>
          </div>
          <div class={"riemann-surface-actions"}>
            <Ui model={model} as="button" id={"riemann_surface_reset_view_btn"} type={"button"}>
              Reset View
            </Ui>
          </div>
        </Ui>
      </Ui>}
      {contextPanel === 'taylor' && <Ui model={model} as="div" id={"taylor_context_panel"}>
        <Ui model={model} as="div" id={"taylor_series_options_detail_div"} class={"taylor-series-panel"}>
          <div class={"taylor-series-header"}>
            <div class={"taylor-series-header-copy"}>
              <h4 class={"taylor-series-title"}>Expand Around z0</h4>
            </div>
            <Ui model={model} as="div" id={"taylor_series_center_status"} class={"taylor-series-center-status"}>
              z0 = 0
            </Ui>
          </div>
          <RangeControl model={model} id="taylor_series_order_slider" name="taylor_series_order_slider"
            label="Taylor Series Terms" labelClass="taylor-series-section-label"
            outputId="taylor_series_order_value_display" outputValue="3"
            groupClass="taylor-series-card" min="1" max="15" step="1" value="3"
            data-tooltip="Number of terms (0 to N) in the Taylor series approximation. Higher order is more accurate but computationally intensive." />
          <Ui model={model} as="div" id={"taylor_series_custom_center_inputs_div"} class={"control-group taylor-series-card taylor-series-custom-block"}>
            <Ui model={model} as="div" id={"taylor_complex_points_ui_container"} />
          </Ui>
          <div class={"control-group taylor-series-card taylor-pick-center-card"}>
            <Ui model={model} as="button" type={"button"} id={"pick_taylor_center_canvas_btn"} class={"taylor-pick-center-btn"} data-tooltip={"Click anywhere on the z or w plane canvas to pick that point as the expansion center"}>
              <Ui model={model} as="span" id={"pick_taylor_center_btn_text"}>
                Pick Center on Canvas
              </Ui>
            </Ui>
          </div>
        </Ui>
      </Ui>}
      {!contextPanel && <>
      <Ui model={model} as="div" id={"dynamic_plotting_root"} />
      <Ui model={model} as="div" id={"domain_palette_circle_panel"} class={"dynamic-plotting-controls hidden"} role={"dialog"} aria-modal={"false"} aria-label={"Domain Coloring Guide"} />
      <Ui model={model} as="div" id={"real_plots_palette_circle_panel"} class={"dynamic-plotting-controls hidden"} role={"dialog"} aria-modal={"false"} aria-label={"Real Plots Color Guide"} />
      </>}
    </>
  );
}
