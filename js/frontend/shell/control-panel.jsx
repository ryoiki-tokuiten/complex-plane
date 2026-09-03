/** @jsxImportSource preact */
import { Ui } from '../ui-element.jsx';
import { MobiusCoefficientControls } from '../components/mobius-coefficient-controls.jsx';
import { AnimationSpeedSelect } from '../components/animation-speed-select.jsx';
import { Icon } from '../components/icon.jsx';

export function ControlPanel() {
  return (
    <>
      <Ui as="section" id={"controls_options_section"}>
        <Ui as="div" id={"top_controls_collapsed_bar"} class={"controls-collapsed-bar hidden"}>
          <span class={"controls-collapsed-label"}>Controls</span>
          <Ui as="button" id={"toggle_top_controls_collapsed_btn"} class={"icon-button top-controls-toggle-btn"} type={"button"} data-tooltip={"Expand top half panels"} aria-label={"Expand top half panels"}>
            <Icon name="maximize-2" />
            <span class={"hidden-visually"}>Expand top half panels</span>
          </Ui>
        </Ui>
        <Ui as="div" id={"controls_panels_row"}>
          <Ui as="div" id={"function-controls-panel"} class={"controls-panel"}>
            <div class={"panel-category-nav"}>
              <div class={"category-nav-btn-group"}>
                <Ui as="button" id={"toggle_complex_functions_btn"} class={"category-nav-btn active"} type={"button"} data-tooltip={"Standard Complex Functions"}>
                  <span>Complex Functions</span>
                </Ui>
                <Ui as="button" id={"select_custom_complex_btn"} class={"category-nav-btn"} type={"button"} data-tooltip={"Build a custom complex function via algebraic chaining"}>
                  <span>Custom Complex Function</span>
                </Ui>
                <Ui as="button" id={"toggle_fractals_btn"} class={"category-nav-btn"} type={"button"} data-tooltip={"Fractals"}>
                  <span>Fractals</span>
                </Ui>
                <Ui as="button" id={"select_real_plots_btn"} class={"category-nav-btn"} type={"button"} data-tooltip={"Render 3D real surface plots"}>
                  <span>Real Plots</span>
                </Ui>
                <Ui as="button" id={"select_laplace_btn"} class={"category-nav-btn"} type={"button"} data-tooltip={"Open the Laplace transform hub"}>
                  <span>Laplace</span>
                </Ui>
              </div>
            </div>
            <Ui as="div" id={"complex_functions_grid_container"} class={"function-subgrid-container"}>
              <div class={"function-button-grid"}>
                <Ui as="button" id={"select_cos_btn"} class={"active"} data-tooltip={"Select w = cos(z) function"}>
                  w = cos(z)
                </Ui>
                <Ui as="button" id={"select_sin_btn"} data-tooltip={"Select w = sin(z) function"}>
                  w = sin(z)
                </Ui>
                <Ui as="button" id={"select_tan_btn"} data-tooltip={"Select w = tan(z) function"}>
                  w = tan(z)
                </Ui>
                <Ui as="button" id={"select_sec_btn"} data-tooltip={"Select w = sec(z) function"}>
                  w = sec(z)
                </Ui>
                <Ui as="button" id={"select_exp_btn"} data-tooltip={"Select w = e^z function"}>
                  w = e
                  <sup>z</sup>
                </Ui>
                <Ui as="button" id={"select_ln_btn"} data-tooltip={"Select w = ln(z) function"}>
                  w = ln(z)
                </Ui>
                <Ui as="button" id={"select_sinh_btn"} data-tooltip={"Select w = sinh(z) function"}>
                  w = sinh(z)
                </Ui>
                <Ui as="button" id={"select_tanh_btn"} data-tooltip={"Select w = tanh(z) function"}>
                  w = tanh(z)
                </Ui>
                <Ui as="button" id={"select_asin_btn"} data-tooltip={"Select w = asin(z) function"}>
                  w = asin(z)
                </Ui>
                <Ui as="button" id={"select_atan_btn"} data-tooltip={"Select w = atan(z) function"}>
                  w = atan(z)
                </Ui>
                <Ui as="button" id={"select_power_btn"} data-tooltip={"Select fractional power w = z^n"}>
                  w = z
                  <sup>n</sup>
                </Ui>
                <Ui as="button" id={"select_mobius_btn"} data-tooltip={"Select w = (az+b)/(cz+d) Möbius transformation"}>
                  Möbius
                </Ui>
                <Ui as="button" id={"select_zeta_btn"} data-tooltip={"Select w = ζ(z) Riemann Zeta function"}>
                  w = ζ(z)
                </Ui>
                <Ui as="button" id={"select_gamma_btn"} data-tooltip={"Select the Gamma function"}>
                  w = Γ(z)
                </Ui>
                <Ui as="button" id={"select_loggamma_btn"} data-tooltip={"Select the log Gamma function"}>
                  w = log Γ(z)
                </Ui>
                <Ui as="button" id={"select_bessel_btn"} data-tooltip={"Select the generalized Bessel function"}>
                  w = J
                  <sub>ν</sub>
                  (z)
                </Ui>
                <Ui as="button" id={"select_polynomial_btn"} data-tooltip={"Select w = P(z) polynomial function"}>
                  Polynomial
                </Ui>
              </div>
            </Ui>
            <Ui as="div" id={"fractals_grid_container"} class={"function-subgrid-container hidden"}>
              <div class={"function-button-grid"}>
                <Ui as="button" id={"select_mandelbrot_btn"} data-tooltip={"Load Mandelbrot as zero-seed output chaining of f(w,c)=w²+c"}>
                  Mandelbrot
                </Ui>
                <Ui as="button" id={"select_newton_fractal_btn"} data-tooltip={"Load Newton fractals as recursive algebraic chaining"}>
                  Newton Fractals
                </Ui>
              </div>
            </Ui>
            <Ui as="div" id={"parameter-controls-panel"} class={"panel-content-details"}>
              <Ui as="div" id={"laplace_specific_controls"} class={"hidden transform-control-grid is-four-column"}>
                <div class={"control-section laplace-signal"}>
                  <div class={"section-header"}>
                    <div class={"section-header-icon"} />
                    <Ui as="span" id={"laplace_signal_section_title"}>
                      Signal Configuration
                    </Ui>
                  </div>
                  <div class={"control-group control-group-compact"}>
                    <Ui as="label" id={"laplace_function_label"} for={"laplace_function_selector"} class={"slider-label"}>
                      Waveform Type
                    </Ui>
                    <Ui as="select" id={"laplace_function_selector"} class={"control-select laplace-select"} data-tooltip={"Select the signal used by the unified Laplace transform"}>
                      <optgroup label={"Fourier-ready Waveforms"}>
                        <option value={"sine"}>Sine Wave</option>
                        <option value={"cosine"}>Cosine Wave</option>
                        <option value={"square"}>Square Wave</option>
                        <option value={"sawtooth"}>Sawtooth Wave</option>
                        <option value={"triangle"}>Triangle Wave</option>
                        <option value={"am"}>AM Signal</option>
                        <option value={"fm"}>FM Signal</option>
                        <option value={"chirp"}>Chirp</option>
                        <option value={"gaussian"}>Gaussian Pulse</option>
                        <option value={"pulse"}>Rectangular Pulse</option>
                        <option value={"harmonics"}>Harmonic Series</option>
                        <option value={"beat"}>Beat Frequency</option>
                        <option value={"noise"}>White Noise</option>
                      </optgroup>
                      <optgroup label={"Analytical Laplace Signals"}>
                        <option value={"step"}>Unit Step u(t)</option>
                        <option value={"exponential"} selected>Exponential e^(-at)</option>
                        <option value={"damped_sine"}>Damped Sine</option>
                        <option value={"ramp"}>Ramp t·u(t)</option>
                        <option value={"impulse"}>Impulse δ(t)</option>
                        <option value={"damped_cosine"}>Damped Cosine</option>
                        <option value={"exponential_sine"}>e^(at)·sin(ωt)</option>
                        <option value={"underdamped"}>Underdamped System</option>
                        <option value={"critically_damped"}>Critically Damped</option>
                        <option value={"overdamped"}>Overdamped System</option>
                      </optgroup>
                      <Ui as="option" id={"laplace_current_graph_option"} value={"current_graph"} hidden>
                        Current Graph (σ = 0 slice)
                      </Ui>
                    </Ui>
                  </div>
                  <Ui as="div" id={"laplace_frequency_control"} class={"control-group control-group-tight"}>
                    <label for={"laplace_frequency_slider"} class={"slider-label"}>
                      <Ui as="span" id={"laplace_frequency_label"}>
                        Frequency:
                      </Ui>
                      <Ui as="output" id={"laplace_frequency_value_display"} class={"slider-value"}>
                        2.0
                      </Ui>
                      Hz
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"laplace_frequency_slider"} min={"0.5"} max={"10"} step={"0.1"} value={"2.0"} data-tooltip={"Oscillation frequency"} class={"accent-pink"} />
                    </div>
                  </Ui>
                  <div class={"control-group control-group-flush"}>
                    <label for={"laplace_damping_slider"} class={"slider-label"}>
                      Signal Damping:
                      <Ui as="output" id={"laplace_damping_value_display"} class={"slider-value"}>
                        0.5
                      </Ui>
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"laplace_damping_slider"} min={"0.1"} max={"5"} step={"0.1"} value={"0.5"} data-tooltip={"Damping factor (decay rate)"} class={"accent-pink"} />
                    </div>
                  </div>
                  <div class={"control-group control-group-flush"}>
                    <label for={"laplace_amplitude_slider"} class={"slider-label"}>
                      Amplitude:
                      <Ui as="output" id={"laplace_amplitude_value_display"} class={"slider-value"}>
                        1.0
                      </Ui>
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"laplace_amplitude_slider"} min={"0.1"} max={"5"} step={"0.1"} value={"1.0"} data-tooltip={"Signal amplitude"} class={"accent-pink"} />
                    </div>
                  </div>
                </div>
                <div class={"control-section laplace-sampling"}>
                  <div class={"section-header"}>
                    <div class={"section-header-icon"} />Sampling Parameters</div>
                  <div class={"control-group control-group-tight"}>
                    <label for={"laplace_time_window_slider"} class={"slider-label"}>
                      Time Window:
                      <Ui as="output" id={"laplace_time_window_value_display"} class={"slider-value"}>
                        4.0
                      </Ui>
                      s
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"laplace_time_window_slider"} min={"1"} max={"10"} step={"0.5"} value={"4.0"} data-tooltip={"Duration of the signal to integrate"} class={"accent-teal"} />
                    </div>
                  </div>
                  <div class={"control-group control-group-flush"}>
                    <label for={"laplace_samples_slider"} class={"slider-label"}>
                      Samples:
                      <Ui as="output" id={"laplace_samples_value_display"} class={"slider-value"}>
                        1024
                      </Ui>
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"laplace_samples_slider"} min={"32"} max={"2048"} step={"32"} value={"1024"} data-tooltip={"Number of samples used by every transform view"} class={"accent-teal"} />
                    </div>
                  </div>
                  <div class={"section-divider"} />
                  <div class={"section-header section-header-winding"}>
                    <div class={"section-header-icon section-header-icon-winding"} />Winding Analysis</div>
                  <div class={"control-group control-group-compact"}>
                    <label for={"laplace_winding_frequency_slider"} class={"slider-label micro-text"}>
                      Winding Freq:
                      <Ui as="output" id={"laplace_winding_frequency_value_display"} class={"slider-value small-output"}>
                        1.0
                      </Ui>
                      rad/s
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"laplace_winding_frequency_slider"} min={"-10"} max={"10"} step={"0.1"} value={"1.0"} data-tooltip={"Angular frequency used by the winding"} class={"accent-orange"} />
                    </div>
                  </div>
                  <div class={"control-group control-group-tight"}>
                    <label for={"laplace_animation_time_slider"} class={"slider-label"}>
                      Progress:
                      <Ui as="output" id={"laplace_animation_time_value_display"} class={"slider-value"}>
                        100
                      </Ui>
                      %
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"laplace_animation_time_slider"} min={"0"} max={"1"} step={"0.01"} value={"1.0"} data-tooltip={"Control how much of the signal to show"} class={"accent-orange"} />
                    </div>
                  </div>
                  <div class={"control-group control-group-flush"}>
                    <label for={"laplace_sync_winding_vector_cb"} class={"slider-label"} data-tooltip={"Synchronize moving tracer arrow between the time-domain graph and winding spiral"}>
                      <Ui as="input" type={"checkbox"} id={"laplace_sync_winding_vector_cb"} checked />
                      <span class={"custom-checkbox-visual"} />
                      Sync Tracer Vector
                    </label>
                  </div>
                  <div class={"control-group control-group-flush"}>
                    <label for={"laplace_show_barriers_cb"} class={"slider-label"} data-tooltip={"Show winding period cycle boundaries (dotted lines)"}>
                      <Ui as="input" type={"checkbox"} id={"laplace_show_barriers_cb"} checked />
                      <span class={"custom-checkbox-visual"} />
                      Show Winding Barriers
                    </label>
                  </div>
                </div>
                <div class={"control-section laplace-splane"}>
                  <div class={"section-header"}>
                    <div class={"section-header-icon"} />S-Plane</div>
                  <div class={"control-group control-group-tight"}>
                    <label for={"laplace_sigma_slider"} class={"slider-label micro-text"}>
                      σ (Real):
                      <Ui as="output" id={"laplace_sigma_value_display"} class={"slider-value small-output"}>
                        0.0
                      </Ui>
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"laplace_sigma_slider"} min={"-5"} max={"5"} step={"0.1"} value={"0.0"} data-tooltip={"Real part of s = σ + jω"} class={"accent-green"} />
                    </div>
                  </div>
                  <div class={"control-group control-group-tight"}>
                    <label for={"laplace_omega_slider"} class={"slider-label"}>
                      ω (Imaginary):
                      <Ui as="output" id={"laplace_omega_value_display"} class={"slider-value"}>
                        1.0
                      </Ui>
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"laplace_omega_slider"} min={"-10"} max={"10"} step={"0.1"} value={"1.0"} data-tooltip={"Imaginary part of s = σ + jω"} class={"accent-green"} />
                    </div>
                  </div>
                  <div class={"control-group control-group-tight"}>
                    <Ui as="button" id={"laplace_fourier_slice_btn"} type={"button"} class={"laplace-full-spiral"} data-tooltip={"Set the Laplace damping coordinate to zero"}>
                      Fourier Slice (σ = 0)
                    </Ui>
                  </div>
                </div>
                <div class={"control-section laplace-toggles"}>
                  <div class={"section-header"}>
                    <div class={"section-header-icon"} />View Options</div>
                  <div class={"control-group control-group-flush"}>
                    <label for={"laplace_show_roc_cb"} class={"slider-label"} data-tooltip={"Show/hide Region of Convergence boundary and shading on the s-plane"}>
                      <Ui as="input" type={"checkbox"} id={"laplace_show_roc_cb"} />
                      <span class={"custom-checkbox-visual"} />
                      Show ROC (Region of Convergence)
                    </label>
                  </div>
                  <div class={"control-group control-group-flush"}>
                    <label for={"laplace_hide_integral_evaluation_cb"} class={"slider-label"} data-tooltip={"Hide the tip-to-tail integral evaluation from the winding canvas"}>
                      <Ui as="input" type={"checkbox"} id={"laplace_hide_integral_evaluation_cb"} checked />
                      <span class={"custom-checkbox-visual"} />
                      Hide the Integral Evaluation
                    </label>
                  </div>
                  <div class={"control-group control-group-flush"}>
                    <label for={"laplace_show_spectrum_cb"} class={"slider-label"} data-tooltip={"Show or hide the discrete spectrum canvas"}>
                      <Ui as="input" type={"checkbox"} id={"laplace_show_spectrum_cb"} checked />
                      <span class={"custom-checkbox-visual"} />
                      Show Discrete Spectrum
                    </label>
                  </div>
                  <div class={"control-group control-group-flush"}>
                    <label for={"laplace_show_com_cb"} class={"slider-label"} data-tooltip={"Show Center of Mass vs Frequency analysis graph"}>
                      <Ui as="input" type={"checkbox"} id={"laplace_show_com_cb"} checked />
                      <span class={"custom-checkbox-visual"} />
                      Show Center of Mass Graph
                    </label>
                  </div>
                  <div class={"control-group control-group-flush"}>
                    <label for={"laplace_show_fourier_3d_cb"} class={"slider-label"} data-tooltip={"Show 3D Fourier Decomposition and Linearity Sum pipeline"}>
                      <Ui as="input" type={"checkbox"} id={"laplace_show_fourier_3d_cb"} checked />
                      <span class={"custom-checkbox-visual"} />
                      Show 3D Fourier Decomposition
                    </label>
                  </div>
                  <div class={"control-group control-group-flush"}>
                    <label for={"laplace_hide_3d_surface_cb"} class={"slider-label"} data-tooltip={"Hide the Laplace 3D surface canvas"}>
                      <Ui as="input" type={"checkbox"} id={"laplace_hide_3d_surface_cb"} />
                      <span class={"custom-checkbox-visual"} />
                      Don't show 3D Surface
                    </label>
                  </div>
                </div>
                <Ui as="div" id={"laplace_3d_controls_section"} class={"control-section laplace-3d"}>
                  <div class={"section-header"}>
                    <div class={"section-header-icon"} />3D Visualization</div>
                  <div class={"control-group control-group-compact"}>
                    <label for={"laplace_viz_mode_selector"} class={"slider-label"}>Display Mode</label>
                    <Ui as="select" id={"laplace_viz_mode_selector"} class={"control-select laplace-3d-select"}>
                      <option value={"magnitude"} selected>Magnitude |F(s)|</option>
                      <option value={"phase"}>Phase ∠F(s)</option>
                      <option value={"combined"}>Combined (Mag+Phase)</option>
                    </Ui>
                  </div>
                  <div class={"control-stack"}>
                    <div class={"palette-controls-header"}>
                      <span class={"palette-label-row"}>
                        <span>Surface Palette:</span>
                        <Ui as="span" id={"active_laplace_surface_palette_name"} class={"active-palette-label"} />
                      </span>
                    </div>
                    <Ui as="div" class={"domain-palette-circles"} id={"laplace_surface_palette_circles"} />
                  </div>
                  <div class={"control-group control-group-tight"}>
                    <label for={"laplace_clip_height_slider"} class={"slider-label"}>
                      Clip Height:
                      <Ui as="output" id={"laplace_clip_height_value_display"} class={"slider-value"}>
                        10
                      </Ui>
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"laplace_clip_height_slider"} min={"1"} max={"50"} step={"1"} value={"10"} data-tooltip={"Maximum height for poles (prevents infinite spikes)"} class={"accent-purple"} />
                    </div>
                  </div>
                  <div class={"control-group control-group-flush"}>
                    <label for={"laplace_show_poles_zeros_cb"} class={"slider-label"} data-tooltip={"Show/hide poles (×) and zeros (○) on the 3D surface and winding visualization"}>
                      <Ui as="input" type={"checkbox"} id={"laplace_show_poles_zeros_cb"} checked />
                      <span class={"custom-checkbox-visual"} />
                      Show Poles & Zeros
                    </label>
                  </div>
                  <div class={"control-group control-group-flush"}>
                    <label for={"laplace_show_fourier_line_cb"} class={"slider-label"} data-tooltip={"Highlight the imaginary axis s = jω, where Fourier lives"}>
                      <Ui as="input" type={"checkbox"} id={"laplace_show_fourier_line_cb"} checked />
                      <span class={"custom-checkbox-visual"} />
                      Highlight Fourier Slice
                    </label>
                  </div>
                  <div class={"control-group spaced-control"}>
                    <label for={"laplace_contours_cb"} data-tooltip={"Overlay level contours on the shared 3D surface renderer"}>
                      <Ui as="input" type={"checkbox"} id={"laplace_contours_cb"} />
                      <span class={"custom-checkbox-visual"} />
                      Contour Lines
                    </label>
                  </div>
                  <Ui as="div" id={"laplace_contours_details"} class={"contour-controls-panel hidden"}>
                    <div class={"control-group contour-slider-field"}>
                      <div class={"contour-slider-label"}>
                        <label for={"laplace_contour_interval_slider"}>Contour Interval:</label>
                        <Ui as="output" id={"laplace_contour_interval_value_display"}>
                          0.50
                        </Ui>
                      </div>
                      <Ui as="input" type={"range"} id={"laplace_contour_interval_slider"} min={"0.05"} max={"3.00"} step={"0.05"} value={"0.50"} />
                    </div>
                    <div class={"control-group contour-slider-field"}>
                      <div class={"contour-slider-label"}>
                        <label for={"laplace_contour_thickness_slider"}>Contour Thickness:</label>
                        <Ui as="output" id={"laplace_contour_thickness_value_display"}>
                          1.5
                        </Ui>
                      </div>
                      <Ui as="input" type={"range"} id={"laplace_contour_thickness_slider"} min={"0.5"} max={"5.0"} step={"0.1"} value={"1.5"} />
                    </div>
                    <div class={"contour-action-row"}>
                      <Ui as="button" id={"laplace_show_2d_contour_btn"} class={"contour-2d-toggle-btn"} type={"button"}>
                        <Icon name="image" />
                        <span>Show 2D Contour Plot</span>
                      </Ui>
                    </div>
                  </Ui>
                </Ui>
                <Ui as="div" id={"laplace_animation_section"} class={"control-section laplace-animation"}>
                  <div class={"section-header"}>
                    <div class={"section-header-icon"} />Integral Animation</div>
                  <div class={"laplace-playback-actions"}>
                    <Ui as="button" id={"laplace_play_pause_btn"} data-tooltip={"Play/Pause animation"} class={"laplace-playback-button is-play"}>
                      Play
                    </Ui>
                    <Ui as="button" id={"laplace_reset_btn"} data-tooltip={"Reset to beginning"} class={"laplace-playback-button is-reset"}>
                      Reset
                    </Ui>
                  </div>
                  <div class={"control-group control-group-compact"}>
                    <label for={"laplace_animation_speed_slider"} class={"slider-label"}>
                      Speed:
                      <Ui as="output" id={"laplace_animation_speed_display"} class={"slider-value"}>
                        3.0
                      </Ui>
                      s
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"laplace_animation_speed_slider"} min={"0.5"} max={"10"} step={"0.5"} value={"3.0"} data-tooltip={"Animation duration in seconds"} class={"accent-salmon"} />
                    </div>
                  </div>
                  <div class={"control-group control-group-tight"}>
                    <label for={"laplace_animation_loop_cb"} class={"slider-label"} data-tooltip={"Automatically restart the animation when it completes"}>
                      <Ui as="input" type={"checkbox"} id={"laplace_animation_loop_cb"} checked />
                      <span class={"custom-checkbox-visual"} />
                      Loop Animation
                    </label>
                  </div>
                  <div class={"control-group-flush"}>
                    <Ui as="button" id={"laplace_show_full_btn"} data-tooltip={"Show complete spiral (no animation)"} class={"laplace-full-spiral"}>
                      Show Full Spiral
                    </Ui>
                  </div>
                </Ui>
              </Ui>
              <Ui as="div" id={"real_plots_controls_container"} class={"hidden nested-control-stack"}>
                <div class={"real-plots-uv-grid"}>
                  <div class={"real-plots-uv-col"}>
                    <div class={"control-row-between"}>
                      <label class={"compact-label"} for={"real_plots_input_preset"}>u(x,y):</label>
                      <Ui as="select" id={"real_plots_input_preset"} class={"control-select compact-control-select"}>
                        <option value={"x"} selected>x</option>
                        <option value={"y"}>y</option>
                        <option value={"x+y"}>x + y</option>
                        <option value={"x-y"}>x - y</option>
                        <option value={"x*y"}>x * y</option>
                        <option value={"2x+y"}>2x + y</option>
                        <option value={"custom"}>Custom...</option>
                      </Ui>
                    </div>
                    <Ui as="div" id={"real_plots_custom_input_container"} class={"hidden compact-formula-stack"}>
                      <Ui as="input" type={"text"} id={"real_plots_custom_input"} class={"dynamic-formula-input compact-formula-input"} placeholder={"e.g. sin(x)*cos(y)"} value={"x"} spellCheck={"false"} autoComplete={"off"} />
                      <Ui as="div" id={"real_plots_custom_input_math"} class={"dynamic-math-display compact-formula-preview"} />
                    </Ui>
                  </div>
                  <div class={"real-plots-uv-col"}>
                    <div class={"control-row-between"}>
                      <label class={"compact-label"} for={"real_plots_imag_preset"}>v(x,y):</label>
                      <Ui as="select" id={"real_plots_imag_preset"} class={"control-select compact-control-select"}>
                        <option value={"y"}>y</option>
                        <option value={"0"} selected>0</option>
                        <option value={"x"}>x</option>
                        <option value={"x+y"}>x + y</option>
                        <option value={"x-y"}>x - y</option>
                        <option value={"x*y"}>x * y</option>
                        <option value={"2x+y"}>2x + y</option>
                        <option value={"custom"}>Custom...</option>
                      </Ui>
                    </div>
                    <Ui as="div" id={"real_plots_custom_imag_container"} class={"hidden compact-formula-stack"}>
                      <Ui as="input" type={"text"} id={"real_plots_custom_imag"} class={"dynamic-formula-input compact-formula-input"} placeholder={"e.g. cos(x)*sin(y)"} value={"0"} spellCheck={"false"} autoComplete={"off"} />
                      <Ui as="div" id={"real_plots_custom_imag_math"} class={"dynamic-math-display compact-formula-preview"} />
                    </Ui>
                  </div>
                </div>
                <div class={"dependent-settings-block real-plots-palette-panel"}>
                  <div class={"viz-settings-grid"}>
                    <div class={"domain-palette-selector-container viz-control-span-2"}>
                      <div class={"domain-palette-header"}>
                        <span class={"domain-palette-selector-label domain-palette-label"}>
                          <span>Color Palette:</span>
                          <Ui as="span" id={"active_real_plots_palette_name"} class={"active-palette-label"} />
                        </span>
                        <div class={"palette-header-actions"}>
                          <Ui as="select" id={"real_plots_color_mode"} class={"control-select compact-control-select"} data-tooltip={"Color mapped to Height (Value) or Phase (Argument)"}>
                            <option value={"height"} selected>Height (Value)</option>
                            <option value={"phase"}>Phase (Argument)</option>
                          </Ui>
                          <Ui as="button" id={"view_real_plots_palette_circle_btn"} class={"view-palette-circle-btn"} type={"button"} data-tooltip={"View color guide circle for active palette"}>
                            View Color Circle
                          </Ui>
                        </div>
                      </div>
                      <Ui as="div" class={"domain-palette-circles"} id={"real_plots_palette_circles"} />
                    </div>
                    <div class={"control-group"}>
                      <label for={"real_plots_brightness_slider"} class={"compact-text"}>
                        Brightness:
                        <Ui as="output" id={"real_plots_brightness_value_display"}>
                          0.50
                        </Ui>
                      </label>
                      <div class={"slider-container"}>
                        <Ui as="input" type={"range"} id={"real_plots_brightness_slider"} name={"real_plots_brightness_slider"} min={"0.1"} max={"1.5"} step={"0.05"} value={"0.5"} data-tooltip={"Adjust overall brightness of the 3D real surface plot"} />
                      </div>
                    </div>
                    <div class={"control-group"}>
                      <label for={"real_plots_contrast_slider"} class={"compact-text"}>
                        Contrast:
                        <Ui as="output" id={"real_plots_contrast_value_display"}>
                          1.00
                        </Ui>
                      </label>
                      <div class={"slider-container"}>
                        <Ui as="input" type={"range"} id={"real_plots_contrast_slider"} name={"real_plots_contrast_slider"} min={"0.5"} max={"2.0"} step={"0.05"} value={"1.0"} data-tooltip={"Adjust color contrast of the 3D real surface plot"} />
                      </div>
                    </div>
                    <div class={"control-group"}>
                      <label for={"real_plots_saturation_slider"} class={"compact-text"}>
                        Saturation:
                        <Ui as="output" id={"real_plots_saturation_value_display"}>
                          1.00
                        </Ui>
                      </label>
                      <div class={"slider-container"}>
                        <Ui as="input" type={"range"} id={"real_plots_saturation_slider"} name={"real_plots_saturation_slider"} min={"0.0"} max={"2.0"} step={"0.05"} value={"1.0"} data-tooltip={"Adjust color saturation of the 3D real surface plot"} />
                      </div>
                    </div>
                    <div class={"control-group"}>
                      <label for={"real_plots_height_scale_slider"} class={"compact-text"}>
                        Height Scale:
                        <Ui as="output" id={"real_plots_height_scale_value_display"}>
                          1.00
                        </Ui>
                      </label>
                      <div class={"slider-container"}>
                        <Ui as="input" type={"range"} id={"real_plots_height_scale_slider"} name={"real_plots_height_scale_slider"} min={"0.15"} max={"10.0"} step={"0.05"} value={"1.0"} data-tooltip={"Scale the vertical height of the 3D surface plot"} />
                      </div>
                    </div>
                  </div>
                </div>
                <div class={"control-group spaced-control"}>
                  <label for={"real_plots_contours_cb"} data-tooltip={"Overlay level contours on the 3D real surface and its 2D contour plane"}>
                    <Ui as="input" type={"checkbox"} id={"real_plots_contours_cb"} />
                    <span class={"custom-checkbox-visual"} />
                    Contour Lines
                  </label>
                </div>
                <Ui as="div" id={"real_plots_contours_details"} class={"contour-controls-panel hidden"}>
                  <div class={"control-group contour-slider-field"}>
                    <div class={"contour-slider-label"}>
                      <label for={"real_plots_contour_interval_slider"}>Contour Interval:</label>
                      <Ui as="output" id={"real_plots_contour_interval_value_display"}>
                        0.50
                      </Ui>
                    </div>
                    <Ui as="input" type={"range"} id={"real_plots_contour_interval_slider"} min={"0.05"} max={"3.00"} step={"0.05"} value={"0.50"} />
                  </div>
                  <div class={"control-group contour-slider-field"}>
                    <div class={"contour-slider-label"}>
                      <label for={"real_plots_contour_thickness_slider"}>Contour Thickness:</label>
                      <Ui as="output" id={"real_plots_contour_thickness_value_display"}>
                        1.5
                      </Ui>
                    </div>
                    <Ui as="input" type={"range"} id={"real_plots_contour_thickness_slider"} min={"0.5"} max={"5.0"} step={"0.1"} value={"1.5"} />
                  </div>
                  <div class={"contour-action-row"}>
                    <Ui as="button" id={"real_plots_show_2d_contour_btn"} class={"contour-2d-toggle-btn"} type={"button"}>
                      <Icon name="image" />
                      <span>Show 2D Contour Plot</span>
                    </Ui>
                  </div>
                </Ui>
                <div class={"control-divider"} />
              </Ui>
              <Ui as="div" id={"algebraic_chaining_params"} class={"control-group hidden"}>
                <label for={"enable_algebraic_chaining_cb"} class={"slider-label"} data-tooltip={"Sum multiple complex functions together: a*f(z)*g(z) + b*h(z)..."}>
                  <Ui as="input" type={"checkbox"} id={"enable_algebraic_chaining_cb"} />
                  <span class={"custom-checkbox-visual"} />
                  <Ui as="span" id={"enable_algebraic_chaining_text"}>
                    Enable Algebraic Chaining
                  </Ui>
                </label>
                <Ui as="div" id={"algebraic_chaining_controls_container"} class={"hidden"}>
                  <div class={"formula-editor-stack"}>
                    <label class={"formula-editor-label"}>Custom z expression (optional):</label>
                    <Ui as="input" type={"text"} id={"algebraic_chaining_z_input"} class={"dynamic-formula-input compact-formula-input"} placeholder={"e.g. z^2 + 1"} value={"z"} spellCheck={"false"} autoComplete={"off"} />
                    <Ui as="div" id={"algebraic_chaining_z_math"} class={"dynamic-math-display compact-formula-preview"} />
                  </div>
                  <Ui as="div" id={"algebraic_terms_list"} />
                  <Ui as="button" id={"add_algebraic_term_btn"}>
                    <span>＋</span>
                    Add Summand Term
                  </Ui>
                  <Ui as="div" id={"chaining_params"} class={"control-group control-toggle-heading nested-chaining-panel"}>
                    <label for={"enable_chaining_cb"} class={"slider-label"} data-tooltip={"Enable chained sequence of output transformations across multiple panels"}>
                      <Ui as="input" type={"checkbox"} id={"enable_chaining_cb"} />
                      <span class={"custom-checkbox-visual"} />
                      <Ui as="span" id={"enable_chaining_text"}>
                        Enable Output Chaining
                      </Ui>
                    </label>
                    <Ui as="div" id={"chaining_controls_container"} class={"chaining-controls hidden"}>
                      <label for={"chain_mode_selector"}>Chain Mode:</label>
                      <Ui as="select" id={"chain_mode_selector"} class={"control-select chaining-mode-select"} data-tooltip={"Mathematical operation to chain across outputs"}>
                        <option value={"recursion"}>Recursion: f(w)</option>
                        <option value={"zero_seed"}>Seed: f(w), z₀ = s</option>
                      </Ui>
                      <Ui as="div" id={"chain_seed_control"} class={"control-group chaining-seed-control hidden"}>
                        <label class={"chaining-seed-label"}>Seed value z₀</label>
                        <Ui as="div" id={"chain_seed_ui_container"} />
                      </Ui>
                      <label for={"chain_count_slider"}>
                        Chain Depth:
                        <Ui as="output" id={"chain_count_value_display"}>
                          1
                        </Ui>
                      </label>
                      <div class={"slider-container"}>
                        <Ui as="input" type={"range"} id={"chain_count_slider"} name={"chain_count_slider"} min={"1"} max={"1024"} step={"1"} value={"1"} data-tooltip={"Number of repeated applications"} />
                      </div>
                    </Ui>
                  </Ui>
                </Ui>
              </Ui>
              <Ui as="div" id={"core_application_controls"}>
                <Ui as="div" id={"function_equation_container"} class={"control-group dependent-settings-block hidden"} />
                <Ui as="div" id={"exp_base_specific_controls"} class={"control-group dependent-settings-block hidden"}>
                  <div class={"section-header"}>
                    <span>Exponential Base</span>
                  </div>
                  <Ui as="div" id={"exp_base_ui_container"} />
                </Ui>
                <Ui as="div" id={"log_base_specific_controls"} class={"control-group dependent-settings-block hidden"}>
                  <div class={"section-header"}>
                    <span>Logarithm Base</span>
                  </div>
                  <Ui as="div" id={"log_base_ui_container"} />
                </Ui>
                <Ui as="div" id={"bessel_order_specific_controls"} class={"control-group dependent-settings-block hidden"}>
                  <div class={"section-header"}>
                    <span>Bessel Order ν</span>
                  </div>
                  <Ui as="div" id={"bessel_order_ui_container"} />
                </Ui>
                <Ui as="div" id={"branch_tools_controls"} class={"control-group dependent-settings-block hidden"}>
                  <div class={"section-header"}>
                    <span>Branch Cut & Continuation</span>
                  </div>
                  <div class={"branch-controls-line"}>
                    <Ui as="div" id={"branch_cut_angle_group"} class={"branch-cut-angle-group"}>
                      <Ui as="output" id={"branch_cut_angle_value_display"}>
                        π
                      </Ui>
                      <Ui as="input" id={"branch_cut_angle_slider"} type={"range"} min={"-3.141592653589793"} max={"3.141592653589793"} step={"0.017453292519943295"} value={"3.141592653589793"} />
                    </Ui>
                    <Ui as="button" id={"draw_continuation_path_btn"} type={"button"}>
                      Continue Along Path
                    </Ui>
                    <Ui as="button" id={"reset_continuation_btn"} type={"button"} class={"hidden"}>
                      Reset
                    </Ui>
                  </div>
                </Ui>
                <Ui as="div" id={"arbitrary_shape_controls"} class={"dependent-settings-block hidden"}>
                  <div class={"panel-inline-heading"}>
                    <span class={"panel-inline-title"}>Arbitrary Shape</span>
                  </div>
                  <div class={"arbitrary-shape-mode-row"} role={"group"} aria-label={"Arbitrary shape definition"}>
                    <Ui as="button" id={"arbitrary_shape_parametric_mode_btn"} type={"button"}>
                      Expression
                    </Ui>
                    <Ui as="button" id={"arbitrary_shape_draw_mode_btn"} type={"button"}>
                      Freehand
                    </Ui>
                  </div>
                  <Ui as="div" id={"parametric_arbitrary_shape_controls"} class={"formula-editor-stack"}>
                    <label for={"arbitrary_shape_expression_input"} class={"formula-editor-label"}>Custom z(t) expression</label>
                    <Ui as="input" id={"arbitrary_shape_expression_input"} type={"text"} class={"dynamic-formula-input compact-formula-input"} value={"cos(t) + i*sin(t)"} placeholder={"e.g. cos(t) + i*sin(t)"} spellCheck={"false"} autoComplete={"off"} />
                    <Ui as="div" id={"arbitrary_shape_expression_math"} class={"dynamic-math-display compact-formula-preview"} />
                    <div class={"taylor-series-input-row"}>
                      <label class={"taylor-series-input-field"}>
                        <span>t min</span>
                        <Ui as="input" id={"arbitrary_shape_t_min_input"} class={"small-number-input taylor-series-text-input"} type={"number"} step={"0.1"} value={"0"} />
                      </label>
                      <label class={"taylor-series-input-field"}>
                        <span>t max</span>
                        <Ui as="input" id={"arbitrary_shape_t_max_input"} class={"small-number-input taylor-series-text-input"} type={"number"} step={"0.1"} value={"6.283185307179586"} />
                      </label>
                    </div>
                  </Ui>
                  <Ui as="div" id={"drawn_arbitrary_shape_controls"} class={"hidden"}>
                    <div class={"arbitrary-shape-draw-row"}>
                      <Ui as="button" id={"clear_arbitrary_shape_btn"} type={"button"}>
                        Clear
                      </Ui>
                    </div>
                    <Ui as="div" id={"arbitrary_shape_draw_status"} class={"compact-status-text"}>
                      Drag anywhere on the z-plane. New strokes are appended.
                    </Ui>
                  </Ui>
                  <div class={"control-group arbitrary-shape-close-control"}>
                    <label for={"arbitrary_shape_closed_cb"} class={"slider-label arbitrary-shape-close-label"}>
                      <Ui as="input" id={"arbitrary_shape_closed_cb"} type={"checkbox"} checked />
                      <span class={"custom-checkbox-visual"} />
                      Close shape
                    </label>
                  </div>
                </Ui>
                <Ui as="div" id={"media_upload_controls"} class={"dependent-settings-block hidden image-upload-panel"}>
                  <div class={"panel-inline-heading"}>
                    <span class={"panel-inline-title"}>Media Upload</span>
                  </div>
                  <div class={"control-group image-upload-field"}>
                    <label for={"media_upload_input"} class={"upload-control-label"}>
                      <span class={"upload-control-title"}>Choose Source Image or Video</span>
                      <span class={"upload-control-copy"}>PNG, JPG, GIF, WEBP, MP4, WEBM, MOV, OGG</span>
                    </label>
                    <Ui as="input" type={"file"} id={"media_upload_input"} accept={"image/*,video/*"} class={"control-file-input"} />
                  </div>
                  <div class={"control-group"}>
                    <label for={"media_size_slider"}>
                      Media Base Size:
                      <Ui as="output" id={"media_size_value_display"}>
                        2.0
                      </Ui>
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"media_size_slider"} name={"media_size_slider"} min={"0.5"} max={"20"} step={"0.1"} value={"2.0"} data-tooltip={"Set logical size of the media in the complex plane."} />
                    </div>
                  </div>
                  <div class={"control-group"}>
                    <label for={"media_opacity_slider"}>
                      Opacity:
                      <Ui as="output" id={"media_opacity_value_display"}>
                        1.0
                      </Ui>
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"media_opacity_slider"} name={"media_opacity_slider"} min={"0.1"} max={"1.0"} step={"0.05"} value={"1.0"} data-tooltip={"Set transparency of the drawn media points."} />
                    </div>
                  </div>
                  <Ui as="div" id={"media_video_controls"} class={"control-group hidden"}>
                    <div class={"media-status-row"}>
                      <Ui as="button" id={"video_play_pause_btn"} type={"button"} disabled />
                      <Ui as="div" id={"video_status_display"} class={"media-status-text"} />
                    </div>
                    <div class={"control-group"}>
                      <label for={"video_fps_slider"}>
                        Processing FPS:
                        <Ui as="output" id={"video_fps_value_display"}>
                          60
                        </Ui>
                      </label>
                      <div class={"slider-container"}>
                        <Ui as="input" type={"range"} id={"video_fps_slider"} name={"video_fps_slider"} min={"1"} max={"60"} step={"1"} value={"60"} data-tooltip={"Set how often the uploaded video is sampled and redrawn."} />
                      </div>
                    </div>
                  </Ui>
                </Ui>
                <Ui as="div" id={"mobius_params_sliders"} class={"dependent-settings-block hidden"}>
                  <div class={"control-group"}>
                    <label class={"panel-formula-label"}>Möbius Parameters (w = (az+b)/(cz+d)):</label>
                  </div>
                  <MobiusCoefficientControls />
                </Ui>
                <Ui as="div" id={"polynomial_params_sliders"} class={"dependent-settings-block hidden"}>
                  <div class={"control-group"}>
                    <label class={"panel-formula-label"}>
                      Polynomial: w = a
                      <sub>0</sub>
                      z
                      <sup>n</sup>
                      + ... + a
                      <sub>n-1</sub>
                      z + a
                      <sub>n</sub>
                    </label>
                  </div>
                  <div class={"control-group full-width-control polynomial-degree-row"}>
                    <label for={"polynomialN_slider"}>
                      Degree (n):
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"polynomialN_slider"} name={"polynomialN_slider"} min={"0"} max={"10"} step={"1"} value={"2"} data-tooltip={"Degree (n) of the polynomial P(z)"} />
                    </div>
                    <Ui as="output" id={"polynomialN_value_display"} class={"slider-value-output"}>
                      2
                    </Ui>
                  </div>
                  <Ui as="div" id={"polynomial_coeffs_container"} />
                </Ui>
                <Ui as="div" id={"fractional_power_params_sliders"} class={"dependent-settings-block hidden"}>
                  <div class={"control-group"}>
                    <label class={"panel-formula-label"}>
                      Fractional Power: w = z
                      <sup>n</sup>
                    </label>
                  </div>
                  <div class={"control-group full-width-control fractional-power-row"}>
                    <label for={"fractionalPowerN_slider"}>
                      Power (n):
                    </label>
                    <div class={"slider-container"}>
                      <Ui as="input" type={"range"} id={"fractionalPowerN_slider"} name={"fractionalPowerN_slider"} min={"-5"} max={"5"} step={"0.05"} value={"0.5"} data-tooltip={"Fractional power (n)"} />
                    </div>
                    <Ui as="output" id={"fractionalPowerN_value_display"} class={"slider-value-output"}>
                      0.5
                    </Ui>
                    <Ui as="button" id={"play_fractionalPowerN_btn"} data-tooltip={"Animate n"}>
                      Play
                    </Ui>
                    <AnimationSpeedSelect id="speed_fractionalPowerN_selector" tooltip="Animation speed" />
                  </div>
                </Ui>
              </Ui>
            </Ui>
          </Ui>
          <Ui as="div" id={"controls_sidebar_footer"} class={"controls-panel-header-actions"}>
            <Ui as="button" id={"reset_workspace_layout_btn"} class={"icon-button top-controls-toggle-btn"} type={"button"} data-tooltip={"Reset workspace layout (Normal & Laplace)"} aria-label={"Reset workspace layout"}>
              <span aria-hidden={"true"} class={"centered-row"}>
                <Icon name="rotate-ccw" />
              </span>
              <span class={"hidden-visually"}>Reset layout</span>
            </Ui>
            <Ui as="button" id={"theme_selector_btn"} class={"icon-button top-controls-toggle-btn"} type={"button"} data-tooltip={"Select application theme"} aria-label={"Select application theme"}>
              <span aria-hidden={"true"} class={"centered-row"}>
                <Icon name="palette" />
              </span>
              <span class={"hidden-visually"}>Select theme</span>
            </Ui>
            <Ui as="button" id={"toggle_top_controls_btn"} class={"icon-button top-controls-toggle-btn"} type={"button"} data-tooltip={"Minimize top half panels"} aria-label={"Minimize top half panels"}>
              <span class={"top-controls-minimize-icon"} aria-hidden={"true"}>
                <Icon name="minimize-2" />
              </span>
              <span class={"top-controls-maximize-icon"} aria-hidden={"true"}>
                <Icon name="maximize-2" />
              </span>
              <span class={"hidden-visually"}>Toggle top controls</span>
            </Ui>
          </Ui>
        </Ui>
      </Ui>
    </>
  );
}
