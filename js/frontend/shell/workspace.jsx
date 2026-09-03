/** @jsxImportSource preact */
import { Ui } from '../ui-element.jsx';
import { AnimationSpeedSelect } from '../components/animation-speed-select.jsx';
import { RiemannSurfaceHud } from '../components/riemann-surface-hud.jsx';
import { attachWorkspace, snapIndicator, workspaceExtent } from '../../ui/panel-layout-manager.js';
import { Icon } from '../components/icon.jsx';

export function Workspace() {
  return (
    <>
      <Ui as="section" id={"canvases_section"}>
        <div class={"canvas-row two-column-layout"} ref={attachWorkspace}>
          <Ui as="div" id={"z_plane_column"} class={"plane-column"}>
            <div class={"canvas-header-line"}>
              <h2 class={"section-title"}>
                <Ui as="span" id={"z-plane-title"}>
                  z-plane (Input:
                  <code>z = a + ib</code>
                  )
                </Ui>
              </h2>
              <div class={"canvas-header-controls"}>
                <Ui as="div" id={"input_shape_picker"} class={"input-shape-picker"} />
                <Ui as="button" id={"toggle_fullscreen_z_btn"} class={"icon-button canvas-icon-button"} type={"button"} data-tooltip={"Toggle fullscreen view for z-plane"} aria-label={"Toggle fullscreen view for z-plane"}>
                  <Icon name="maximize-2" />
                  <span class={"hidden-visually"}>Toggle fullscreen view for z-plane</span>
                </Ui>
              </div>
            </div>
            <Ui as="div" id={"z_plane_canvas_wrapper"} class={"canvas-layer-host"}>
              <Ui as="canvas" id={"z_plane_canvas"} />
              <Ui as="div" id={"z_plane_rendering_indicator"} class={"domain-rendering-indicator hidden"} />
              <Ui as="div" id={"z_plane_probe_info"} class={"probe-info-overlay hidden"} />
              <Ui as="div" id={"z_plane_threejs_container"} class={"hidden canvas-overlay"} />
              <Ui as="div" id={"z_plane_transformation_overlay"} class={"transformation-hud hidden"} />
              <Ui as="div" id={"domain_coloring_key"} class={"hidden"} />
              <Ui as="div" id={"navigation_keyhint_overlay"} class={"navigation-keyhint-overlay hidden"} />
              <Ui as="div" id={"z_plane_shape_controls_overlay"} class={"canvas-shape-controls-overlay hidden"}>
                <Ui as="div" id={"common_params_sliders"} class={"canvas-shape-controls-group"}>
                  <div class={"control-group"}>
                    <label for={"a0_slider"}>
                      <Ui as="span" id={"a0_label_desc"}>
                        Real part of z (
                        <code>
                          a
                          <sub>0</sub>
                        </code>
                        )
                      </Ui>
                      :
                      <Ui as="output" id={"a0_value_display"}>
                        0.80
                      </Ui>
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"a0_slider"} name={"a0_slider"} min={"-5"} max={"5"} step={"0.05"} value={"0.0"} data-tooltip={"Adjusts real part (a0) of z for line input, or center for shapes"} />
                      <Ui as="button" id={"play_a0_btn"} data-tooltip={"Animate the real part (a0)"}>
                        Play
                      </Ui>
                      <AnimationSpeedSelect id="speed_a0_selector" tooltip="Select animation speed for real part (a0)" />
                    </div>
                  </div>
                  <div class={"control-group"}>
                    <label for={"b0_slider"}>
                      <Ui as="span" id={"b0_label_desc"}>
                        Imaginary part of z (
                        <code>
                          b
                          <sub>0</sub>
                        </code>
                        )
                      </Ui>
                      :
                      <Ui as="output" id={"b0_value_display"}>
                        0.50
                      </Ui>
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"b0_slider"} name={"b0_slider"} min={"-5"} max={"5"} step={"0.05"} value={"0.0"} data-tooltip={"Adjusts imaginary part (b0) of z for line input, or center for shapes"} />
                      <Ui as="button" id={"play_b0_btn"} data-tooltip={"Animate the imaginary part (b0)"}>
                        Play
                      </Ui>
                      <AnimationSpeedSelect id="speed_b0_selector" tooltip="Select animation speed for imaginary part (b0)" />
                    </div>
                  </div>
                </Ui>
                <Ui as="div" id={"shape_params_sliders"} class={"canvas-shape-controls-group hidden"}>
                  <Ui as="div" id={"circleR_slider_group"} class={"hidden control-group"}>
                    <label for={"circleR_slider"}>
                      Radius (R):
                      <Ui as="output" id={"circleR_value_display"}>
                        1.0
                      </Ui>
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"circleR_slider"} name={"circleR_slider"} min={"0.1"} max={"10"} step={"0.05"} value={"1.0"} data-tooltip={"Adjusts radius (R) of the circle input shape"} />
                      <Ui as="button" id={"play_circleR_btn"} data-tooltip={"Animate circle radius (R)"}>
                        Play
                      </Ui>
                      <AnimationSpeedSelect id="speed_circleR_selector" tooltip="Select animation speed for circle radius (R)" />
                    </div>
                  </Ui>
                </Ui>
              </Ui>
              <Ui as="div" id={"grid_shape_controls_overlay"} class={"canvas-grid-controls-overlay hidden"} aria-label={"Grid tuning controls"} aria-hidden={"true"}>
                <div class={"canvas-grid-controls-header"}>
                  <span data-grid-shape-title>Grid tuning</span>
                  <span class={"canvas-grid-controls-kicker"}>z-plane</span>
                </div>
                <Ui as="div" id={"grid_shape_controls_groups"} />
              </Ui>
              <Ui as="div" id={"radial_discrete_steps_options_div"} class={"canvas-radial-steps-overlay hidden"}>
                <div class={"control-group"}>
                  <label for={"radial_discrete_steps_count_slider"}>
                    Radial Steps:
                    <Ui as="output" id={"radial_discrete_steps_count_value_display"}>
                      200
                    </Ui>
                  </label>
                  <div class={"slider-container"}>
                    <Ui as="input" type={"range"} id={"radial_discrete_steps_count_slider"} name={"radial_discrete_steps_count_slider"} min={"0"} max={"800"} step={"1"} value={"200"} data-tooltip={"Adjust the number of discrete radial steps"} />
                  </div>
                </div>
              </Ui>
              <Ui as="div" id={"vector_flow_canvas_overlay"} class={"canvas-vector-flow-overlay hidden"}>
                <Ui as="div" id={"vector_field_options_div"} class={"vector-flow-column hidden"}>
                  <div class={"vector-flow-column-header"}>Vector Field</div>
                  <div class={"vector-flow-row"}>
                    <label for={"vector_field_scale_slider"}>Scale:</label>
                    <Ui as="input" type={"range"} id={"vector_field_scale_slider"} name={"vector_field_scale_slider"} min={"0.01"} max={"2.0"} step={"0.01"} value={"1.0"} data-tooltip={"Adjust vector length"} />
                    <Ui as="output" id={"vector_field_scale_value_display"}>
                      1.00
                    </Ui>
                  </div>
                  <div class={"vector-flow-row"}>
                    <label for={"vector_arrow_thickness_slider"}>Thickness:</label>
                    <Ui as="input" type={"range"} id={"vector_arrow_thickness_slider"} name={"vector_arrow_thickness_slider"} min={"0.5"} max={"5"} step={"0.1"} value={"1.5"} data-tooltip={"Adjust arrow thickness"} />
                    <Ui as="output" id={"vector_arrow_thickness_value_display"}>
                      1.5
                    </Ui>
                  </div>
                  <div class={"vector-flow-row"}>
                    <label for={"vector_arrow_head_size_slider"}>Head Size:</label>
                    <Ui as="input" type={"range"} id={"vector_arrow_head_size_slider"} name={"vector_arrow_head_size_slider"} min={"2"} max={"15"} step={"0.5"} value={"2"} data-tooltip={"Adjust arrow head size"} />
                    <Ui as="output" id={"vector_arrow_head_size_value_display"}>
                      2
                    </Ui>
                  </div>
                </Ui>
                <Ui as="div" id={"streamline_options_details_div"} class={"vector-flow-column hidden"}>
                  <div class={"vector-flow-column-header"}>Streamlines</div>
                  <div class={"vector-flow-row"}>
                    <label for={"streamline_step_size_slider"}>Step Size:</label>
                    <Ui as="input" type={"range"} id={"streamline_step_size_slider"} name={"streamline_step_size_slider"} min={"0.005"} max={"0.3"} step={"0.005"} value={"0.06"} data-tooltip={"Step length relative to viewport"} />
                    <Ui as="output" id={"streamline_step_size_value_display"}>
                      0.06
                    </Ui>
                  </div>
                  <div class={"vector-flow-row"}>
                    <label for={"streamline_max_length_slider"}>Max Length:</label>
                    <Ui as="input" type={"range"} id={"streamline_max_length_slider"} name={"streamline_max_length_slider"} min={"50"} max={"2000"} step={"50"} value={"400"} data-tooltip={"Max integration steps"} />
                    <Ui as="output" id={"streamline_max_length_value_display"}>
                      400
                    </Ui>
                  </div>
                  <div class={"vector-flow-row"}>
                    <label for={"streamline_thickness_slider"}>Thickness:</label>
                    <Ui as="input" type={"range"} id={"streamline_thickness_slider"} name={"streamline_thickness_slider"} min={"0.5"} max={"4.0"} step={"0.1"} value={"1.5"} data-tooltip={"Streamline line thickness"} />
                    <Ui as="output" id={"streamline_thickness_value_display"}>
                      1.5
                    </Ui>
                  </div>
                  <div class={"vector-flow-row"}>
                    <label for={"streamline_seed_density_factor_slider"}>Density:</label>
                    <Ui as="input" type={"range"} id={"streamline_seed_density_factor_slider"} name={"streamline_seed_density_factor_slider"} min={"0.2"} max={"2.0"} step={"0.05"} value={"0.8"} data-tooltip={"Seed density relative to grid"} />
                    <Ui as="output" id={"streamline_seed_density_factor_value_display"}>
                      0.8
                    </Ui>
                  </div>
                </Ui>
                <Ui as="div" id={"particle_animation_details_div"} class={"vector-flow-column hidden"}>
                  <div class={"vector-flow-column-header"}>Particle Motion</div>
                  <div class={"vector-flow-row"}>
                    <label for={"particle_density_slider"}>Density:</label>
                    <Ui as="input" type={"range"} id={"particle_density_slider"} min={"10"} max={"1000"} step={"10"} value={"150"} data-tooltip={"Number of particles"} />
                    <Ui as="output" id={"particle_density_value_display"}>
                      150
                    </Ui>
                  </div>
                  <div class={"vector-flow-row"}>
                    <label for={"particle_speed_slider"}>Speed:</label>
                    <Ui as="input" type={"range"} id={"particle_speed_slider"} min={"0.005"} max={"0.2"} step={"0.005"} value={"0.04"} data-tooltip={"Particle drift speed"} />
                    <Ui as="output" id={"particle_speed_value_display"}>
                      0.04
                    </Ui>
                  </div>
                  <div class={"vector-flow-row"}>
                    <label for={"particle_max_lifetime_slider"}>Lifetime:</label>
                    <Ui as="input" type={"range"} id={"particle_max_lifetime_slider"} min={"50"} max={"1500"} step={"50"} value={"300"} data-tooltip={"Particle max frames"} />
                    <Ui as="output" id={"particle_max_lifetime_value_display"}>
                      300
                    </Ui>
                  </div>
                </Ui>
              </Ui>
              <Ui as="div" id={"z_plane_zoom_controls"} class={"canvas-zoom-controls"} aria-label={"Z-plane zoom controls"}>
                <Ui as="button" id={"zoom_in_z_btn"} class={"canvas-zoom-btn"} type={"button"} data-tooltip={"Zoom in (z-plane)"} aria-label={"Zoom in z-plane"}>
                  <Icon name="plus" />
                </Ui>
                <div class={"canvas-zoom-btn-divider"} />
                <Ui as="button" id={"zoom_out_z_btn"} class={"canvas-zoom-btn"} type={"button"} data-tooltip={"Zoom out (z-plane)"} aria-label={"Zoom out z-plane"}>
                  <Icon name="minus" />
                </Ui>
              </Ui>
            </Ui>
          </Ui>
          <Ui as="div" id={"w_plane_column"} class={"plane-column"}>
            <div class={"canvas-header-line"}>
              <h2 class={"section-title"}>
                <Ui as="span" id={"w-plane-title"}>
                  w-plane (Output:
                  <Ui as="code" id={"w-plane-title-func"}>
                    w = cos(z)
                  </Ui>
                  )
                </Ui>
              </h2>
              <div class={"canvas-header-controls"}>
                <Ui as="div" id={"w_plane_analysis_info"} />
                <Ui as="label" id={"zeta_continuation_toggle"} for={"enable_zeta_continuation_cb"} class={"viz-toggle-card graph-trace-toggle hidden"} data-tooltip={"Toggle analytic continuation for ζ(z) beyond Re(z) > 1"}>
                  <Ui as="input" type={"checkbox"} id={"enable_zeta_continuation_cb"} />
                  <span class={"custom-checkbox-visual"} />
                  <span>Analytical Continuation</span>
                </Ui>
                <Ui as="button" id={"toggle_fullscreen_w_btn"} class={"icon-button canvas-icon-button"} type={"button"} data-tooltip={"Toggle fullscreen view for w-plane"} aria-label={"Toggle fullscreen view for w-plane"}>
                  <Icon name="maximize-2" />
                  <span class={"hidden-visually"}>Toggle fullscreen view for w-plane</span>
                </Ui>
              </div>
            </div>
            <Ui as="div" id={"w_plane_canvas_wrapper"} class={"canvas-layer-host"}>
              <Ui as="canvas" id={"w_plane_canvas"} />
              <RiemannSurfaceHud />
              <Ui as="div" id={"w_plane_threejs_container"} class={"hidden canvas-overlay"} />
              <Ui as="div" id={"w_plane_three_container"} class={"hidden fill-container"} />
              <Ui as="div" id={"w_plane_probe_info"} class={"probe-info-overlay hidden"} />
              <Ui as="div" id={"w_plane_transformation_overlay"} class={"transformation-hud hidden"} />
              <Ui as="div" id={"w_plane_folds_overlay"} class={"canvas-shape-controls-overlay hidden"}>
                <div class={"control-group"}>
                  <label for={"grid_surface_3d_height_scale_slider"}>
                    <span>3D Folds Height:</span>
                    <Ui as="output" id={"grid_surface_3d_height_scale_value_display"}>
                      1.00
                    </Ui>
                  </label>
                  <div class={"slider-container"}>
                    <Ui as="input" type={"range"} id={"grid_surface_3d_height_scale_slider"} min={"0.15"} max={"2.5"} step={"0.05"} value={"1.0"} data-tooltip={"Scale the height of the 3D surface folds"} />
                  </div>
                </div>
              </Ui>
              <Ui as="div" id={"cauchy_integral_results_info"} class={"cauchy-info-overlay hidden analysis-copy"} />
              <Ui as="div" id={"w_plane_zoom_controls"} class={"canvas-zoom-controls"} aria-label={"W-plane zoom controls"}>
                <Ui as="button" id={"zoom_in_w_btn"} class={"canvas-zoom-btn"} type={"button"} data-tooltip={"Zoom in (w-plane)"} aria-label={"Zoom in w-plane"}>
                  <Icon name="plus" />
                </Ui>
                <div class={"canvas-zoom-btn-divider"} />
                <Ui as="button" id={"zoom_out_w_btn"} class={"canvas-zoom-btn"} type={"button"} data-tooltip={"Zoom out (w-plane)"} aria-label={"Zoom out w-plane"}>
                  <Icon name="minus" />
                </Ui>
              </Ui>
            </Ui>
          </Ui>
          <Ui as="div" id={"laplace_spectrum_column"} class={"hidden auxiliary-surface-column"}>
            <div class={"canvas-header-line"}>
              <h2 class={"section-title"}>Discrete Spectrum</h2>
              <div class={"canvas-header-controls"}>
                <Ui as="button" id={"toggle_fullscreen_laplace_spectrum_btn"} class={"icon-button canvas-icon-button"} type={"button"} data-tooltip={"Toggle fullscreen view for Discrete Spectrum"} aria-label={"Toggle fullscreen view for Discrete Spectrum"}>
                  <Icon name="maximize-2" />
                  <span class={"hidden-visually"}>Toggle fullscreen view for Discrete Spectrum</span>
                </Ui>
              </div>
            </div>
            <div class={"flex-relative-host"}>
              <Ui as="canvas" id={"laplace_spectrum_canvas"} width={"420"} height={"320"} aria-label={"Discrete Fourier spectrum magnitude"} />
            </div>
          </Ui>
          <Ui as="div" id={"laplace_com_column"} class={"hidden auxiliary-surface-column"}>
            <div class={"canvas-header-line"}>
              <h2 class={"section-title"}>
                <Ui as="span" id={"laplace_com_title_label"}>
                  Center of Mass vs Frequency
                </Ui>
              </h2>
              <div class={"canvas-header-controls canvas-header-control-row"}>
                <div class={"control-row"}>
                  <label class={"compact-label"} for={"laplace_com_component_selector"}>Plot:</label>
                  <Ui as="select" id={"laplace_com_component_selector"} class={"control-select compact-control-select"}>
                    <option value={"both"} selected>Both (X & Y)</option>
                    <option value={"x"}>X-coord: Re(COM)</option>
                    <option value={"y"}>Y-coord: Im(COM)</option>
                    <option value={"magnitude"}>Magnitude |COM|</option>
                  </Ui>
                </div>
                <Ui as="button" id={"toggle_fullscreen_laplace_com_btn"} class={"icon-button canvas-icon-button"} type={"button"} data-tooltip={"Toggle fullscreen view for Center of Mass Graph"} aria-label={"Toggle fullscreen view for Center of Mass Graph"}>
                  <Icon name="maximize-2" />
                  <span class={"hidden-visually"}>Toggle fullscreen view for Center of Mass Graph</span>
                </Ui>
              </div>
            </div>
            <div class={"flex-relative-host"}>
              <Ui as="canvas" id={"laplace_com_canvas"} width={"420"} height={"320"} aria-label={"Center of mass against frequency graph"} />
            </div>
          </Ui>
          <Ui as="div" id={"fourier_3d_column"} class={"hidden auxiliary-surface-column"}>
            <div class={"canvas-header-line"}>
              <h2 class={"section-title"}>
                <Ui as="span" id={"fourier_3d_title_label"}>
                  3D Fourier Decomposition & Sum
                </Ui>
              </h2>
              <div class={"canvas-header-controls canvas-header-control-row"}>
                <div class={"control-row"}>
                  <label class={"compact-label"} for={"laplace_fourier_3d_count_slider"}>
                    Parallel Graphs:
                    <Ui as="output" id={"laplace_fourier_3d_count_value_display"} class={"slider-value small-output"}>
                      4
                    </Ui>
                  </label>
                  <Ui as="input" type={"range"} id={"laplace_fourier_3d_count_slider"} min={"1"} max={"12"} step={"1"} value={"4"} class={"control-slider compact-control-slider"} style={"width: 85px;"} />
                </div>
                <Ui as="button" id={"toggle_fullscreen_fourier_3d_btn"} class={"icon-button canvas-icon-button"} type={"button"} data-tooltip={"Toggle fullscreen view for 3D Fourier Decomposition"} aria-label={"Toggle fullscreen view for 3D Fourier Decomposition"}>
                  <Icon name="maximize-2" />
                  <span class={"hidden-visually"}>Toggle fullscreen view for 3D Fourier Decomposition</span>
                </Ui>
              </div>
            </div>
            <div class={"flex-relative-host"}>
              <Ui as="div" id={"fourier_3d_container"} class={"fill-container"} />
            </div>
          </Ui>
          <Ui as="div" id={"graph_column"} class={"hidden"}>
            <div class={"canvas-header-line"}>
              <h2 class={"section-title"}>
                <Ui as="span" id={"graph_title_label"}>
                  Graph
                </Ui>
              </h2>
              <div class={"canvas-header-controls"}>
                <Ui as="select" id={"graph_grid_family_selector"} class={"canvas-shape-select graph-family-select hidden"} aria-label={"Choose grid family"}>
                  <option value={"primary"}>Horizontal</option>
                  <option value={"secondary"}>Vertical</option>
                </Ui>
                <Ui as="label" id={"graph_fourier_toggle"} for={"enable_graph_fourier_cb"} class={"viz-toggle-card graph-trace-toggle"} data-tooltip={"Wind both graph components into their Fourier domains"}>
                  <Ui as="input" type={"checkbox"} id={"enable_graph_fourier_cb"} />
                  <span class={"custom-checkbox-visual"} />
                  <span>Fourier</span>
                </Ui>
                <Ui as="label" id={"graph_trace_toggle"} for={"enable_graph_trace_cb"} class={"viz-toggle-card graph-trace-toggle"} data-tooltip={"Show the combined 3D Re/Im trace"}>
                  <Ui as="input" type={"checkbox"} id={"enable_graph_trace_cb"} />
                  <span class={"custom-checkbox-visual"} />
                  <span>Trace</span>
                </Ui>
                <Ui as="button" id={"toggle_fullscreen_graph_btn"} class={"icon-button canvas-icon-button"} type={"button"} data-tooltip={"Toggle fullscreen view for Graph"} aria-label={"Toggle fullscreen view for Graph"}>
                  <Icon name="maximize-2" />
                  <span class={"hidden-visually"}>Toggle fullscreen view for Graph</span>
                </Ui>
              </div>
            </div>
            <Ui as="div" id={"graph_container"} class={"flex-relative-host"}>
              <Ui as="div" id={"graph_3d_container"} class={"fill-relative"} />
            </Ui>
          </Ui>
          <Ui as="div" id={"laplace_3d_column"} class={"hidden auxiliary-surface-column"}>
            <div class={"canvas-header-line"}>
              <h2 class={"section-title"}>
                <Ui as="span" id={"laplace_3d_title_label"}>
                  3D Surface: |F(s)| Magnitude
                </Ui>
              </h2>
              <div class={"canvas-header-controls"}>
                <Ui as="button" id={"toggle_fullscreen_laplace_3d_btn"} class={"icon-button canvas-icon-button"} type={"button"} data-tooltip={"Toggle fullscreen view for 3D surface"} aria-label={"Toggle fullscreen view for 3D surface"}>
                  <Icon name="maximize-2" />
                  <span class={"hidden-visually"}>Toggle fullscreen view for 3D surface</span>
                </Ui>
              </div>
            </div>
            <div class={"flex-relative-host"}>
              <Ui as="div" id={"laplace_3d_container"} class={"fill-container"} />
            </div>
          </Ui>
          <Ui as="div" id={"real_plots_column"} class={"hidden"}>
            <div class={"canvas-header-line"}>
              <h2 class={"section-title"}>
                <Ui as="span" id={"real_plots_title_label"}>
                  Real Plot (3D Surface)
                </Ui>
              </h2>
              <div class={"canvas-header-controls canvas-header-control-row"}>
                <div class={"control-row"}>
                  <label class={"compact-label"}>Display Component:</label>
                  <Ui as="select" id={"real_plots_output_component"} class={"control-select compact-control-select"}>
                    <option value={"real"} selected>Real Part: Re(f)</option>
                    <option value={"imag"}>Imaginary Part: Im(f)</option>
                    <option value={"magnitude"}>Magnitude: |f|</option>
                  </Ui>
                </div>
                <Ui as="label" id={"zeta_continuation_toggle_real_plots"} for={"enable_zeta_continuation_real_plots_cb"} class={"viz-toggle-card graph-trace-toggle hidden"} data-tooltip={"Toggle analytic continuation for ζ(z) beyond Re(z) > 1"}>
                  <Ui as="input" type={"checkbox"} id={"enable_zeta_continuation_real_plots_cb"} />
                  <span class={"custom-checkbox-visual"} />
                  <span>Analytical Continuation</span>
                </Ui>
                <Ui as="button" id={"toggle_fullscreen_real_plots_btn"} class={"icon-button canvas-icon-button"} type={"button"} data-tooltip={"Toggle fullscreen view for Real Plot"} aria-label={"Toggle fullscreen view for Real Plot"}>
                  <Icon name="maximize-2" />
                  <span class={"hidden-visually"}>Toggle fullscreen view for Real Plot</span>
                </Ui>
              </div>
            </div>
            <div class={"flex-relative-host"}>
              <Ui as="div" id={"real_plots_container"} class={"fill-relative"}>
                <Ui as="div" id={"real_plots_3d_container"} class={"fill-container"} />
                <Ui as="div" id={"real_plots_zoom_controls"} class={"canvas-zoom-controls"} aria-label={"Real plots zoom controls"}>
                  <Ui as="button" id={"zoom_in_real_plots_btn"} class={"canvas-zoom-btn"} type={"button"} data-tooltip={"Zoom in (Real Plot)"} aria-label={"Zoom in real plot"}>
                    <Icon name="plus" />
                  </Ui>
                  <div class={"canvas-zoom-btn-divider"} />
                  <Ui as="button" id={"zoom_out_real_plots_btn"} class={"canvas-zoom-btn"} type={"button"} data-tooltip={"Zoom out (Real Plot)"} aria-label={"Zoom out real plot"}>
                    <Icon name="minus" />
                  </Ui>
                </Ui>
              </Ui>
            </div>
          </Ui>
          <Ui as="div" id={"contour_2d_column"} class={"plane-column hidden"}>
            <div class={"canvas-header-line"}>
              <h2 class={"section-title"}>
                <span>2D Contour Plot</span>
              </h2>
              <div class={"canvas-header-controls"}>
                <Ui as="button" id={"toggle_fullscreen_contour_2d_btn"} class={"icon-button canvas-icon-button"} type={"button"} data-tooltip={"Toggle fullscreen view for 2D Contour Plot"} aria-label={"Toggle fullscreen view for 2D Contour Plot"}>
                  <Icon name="maximize-2" />
                  <span class={"hidden-visually"}>Toggle fullscreen view for 2D Contour Plot</span>
                </Ui>
              </div>
            </div>
            <div class={"canvas-fill-host"}>
              <Ui as="canvas" id={"contour_2d_canvas"} />
            </div>
          </Ui>
          <div id="panel_snap_indicator" class={`panel-snap-indicator${snapIndicator.value ? ' is-active' : ''}`}
            style={snapIndicator.value || undefined} />
          <div class="workspace-bounds-extender" style={workspaceExtent.value} />
        </div>
      </Ui>
    </>
  );
}
