#ifndef COMPLEX_ENGINE_H
#define COMPLEX_ENGINE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    double re;
    double im;
} ce_complex;

typedef struct {
    uint32_t function_id;
    int32_t chained_function_id;
    uint32_t flags;
    uint32_t step_offset;
    double power;
    uint32_t step_count;
    uint32_t reserved;
} ce_algebraic_factor;

typedef struct {
    ce_complex coefficient;
    uint32_t factor_offset;
    uint32_t factor_count;
} ce_algebraic_term;

typedef struct {
    uint32_t opcode;
    uint32_t argument;
    ce_complex value;
} ce_expression_instruction;

enum ce_function_id {
    CE_FN_C = 0,
    CE_FN_COS,
    CE_FN_SIN,
    CE_FN_TAN,
    CE_FN_SEC,
    CE_FN_EXP,
    CE_FN_LN,
    CE_FN_RECIPROCAL,
    CE_FN_SINH,
    CE_FN_COSH,
    CE_FN_TANH,
    CE_FN_ASIN,
    CE_FN_ATAN,
    CE_FN_GAMMA,
    CE_FN_LOG_GAMMA,
    CE_FN_BESSEL,
    CE_FN_POWER,
    CE_FN_MOBIUS,
    CE_FN_ZETA,
    CE_FN_POLYNOMIAL,
    CE_FN_POINCARE,
    CE_FN_ALGEBRAIC,
    CE_FN_IDENTITY
};

typedef struct {
    ce_complex exp_base;
    ce_complex log_base;
    ce_complex bessel_order;
    ce_complex mobius_a;
    ce_complex mobius_b;
    ce_complex mobius_c;
    ce_complex mobius_d;
    const ce_complex *polynomial;
    uint32_t polynomial_count;
    double fractional_power;
    double branch_cut_angle;
    uint32_t branch_cut_is_ray;
    uint32_t zeta_continuation;
    const ce_algebraic_term *algebraic_terms;
    uint32_t algebraic_term_count;
    const ce_algebraic_factor *algebraic_factors;
    uint32_t algebraic_factor_count;
    const ce_expression_instruction *expression;
    uint32_t expression_count;
    const uint32_t *algebraic_steps;
    uint32_t algebraic_step_count;
} ce_function_config;

typedef struct {
    uint32_t function_id;
    uint32_t chain_count;
    uint32_t zero_seed;
    uint32_t derivative;
    ce_function_config function;
    const ce_complex *taylor_coefficients;
    uint32_t taylor_count;
    ce_complex taylor_center;
    double taylor_radius_sq;
    uint32_t use_taylor;
    uint32_t reserved;
    const ce_expression_instruction *dynamic_point_expression;
    uint32_t dynamic_point_count;
    const ce_expression_instruction *dynamic_term_expression;
    uint32_t dynamic_term_count;
    const ce_complex *dynamic_variables;
    const uint8_t *dynamic_variable_flags;
    uint32_t dynamic_variable_count;
    uint32_t dynamic_source_count;
    uint32_t dynamic_reduction;
    uint32_t dynamic_invalid_policy;
} ce_map_config;

void *ce_alloc(size_t size);
void ce_free(void *pointer);
uint32_t ce_abi_version(void);

ce_complex ce_add(ce_complex a, ce_complex b);
ce_complex ce_sub(ce_complex a, ce_complex b);
ce_complex ce_mul(ce_complex a, ce_complex b);
ce_complex ce_div(ce_complex numerator, ce_complex denominator);
ce_complex ce_pow(ce_complex base, ce_complex exponent);
ce_complex ce_eval_function(uint32_t function_id, ce_complex z, ce_complex c,
                            const ce_function_config *config);

int32_t ce_evaluate_points(const ce_map_config *config, const ce_complex *input,
                           uint32_t count, ce_complex *output, uint8_t *valid);
int32_t ce_evaluate_algebraic_points(const ce_map_config *config, const ce_complex *input,
                                     const ce_complex *parameters, uint32_t count,
                                     ce_complex *output, uint8_t *valid);
int32_t ce_evaluate_sheets(const ce_map_config *config, const ce_complex *input,
                           const int32_t *sheets, uint32_t count,
                           ce_complex *output, uint8_t *valid);
int32_t ce_continuation_sheets(const ce_complex *path, uint32_t point_count,
                               uint32_t drawn_cut, double cut_angle,
                               const ce_complex *cut_points, uint32_t cut_point_count);
int32_t ce_evaluate_dynamic(const ce_map_config *config, double parameter_re, double parameter_im,
                            ce_complex *point_values, ce_complex *term_values,
                            uint8_t *errors, uint8_t *reduction_status,
                            ce_complex *partial_values, double *partial_product_metadata,
                            ce_complex *final_value,
                            double product_metadata[6]);
int32_t ce_pow_points(const ce_complex *bases, const ce_complex *exponents,
                      uint32_t count, ce_complex *output);
int32_t ce_zeta_points(const ce_complex *input, uint32_t count, uint32_t algorithm,
                       uint32_t work_count, ce_complex *output);
int32_t ce_evaluate_expression(const ce_map_config *map_config,
                               const ce_expression_instruction *program,
                               uint32_t instruction_count, const ce_complex *variables,
                               uint32_t variable_count, const int32_t *sheets,
                               uint32_t job_count,
                               ce_complex *output, uint8_t *errors);
int32_t ce_generate_discrete_values(uint32_t kind, uint32_t requested_count,
                                    double start, double step, double ratio,
                                    double minimum, double maximum, uint32_t bound,
                                    uint32_t flags, uint32_t max_attempts,
                                    const ce_expression_instruction *generator,
                                    uint32_t generator_count,
                                    const ce_expression_instruction *predicate,
                                    uint32_t predicate_count,
                                    const ce_complex *parameters, uint32_t parameter_count,
                                    ce_complex *output, uint32_t output_capacity,
                                    uint8_t *attempt_errors, uint32_t error_capacity,
                                    uint32_t stats[3]);
int32_t ce_compute_taylor_coefficients(const ce_map_config *map_config,
                                       double center_re, double center_im, double radius,
                                       uint32_t step_count, uint32_t order,
                                       ce_complex *coefficients);
int32_t ce_map_planar_geometry(const ce_map_config *config, const ce_complex *input,
                              uint32_t count, ce_complex *output, uint8_t *valid);
int32_t ce_generate_input_shape(const ce_map_config *config, uint32_t shape,
                                double x_min, double x_max, double y_min, double y_max,
                                uint32_t density, uint32_t curve_points,
                                double center_re, double center_im,
                                double circle_radius, double ellipse_a, double ellipse_b,
                                uint32_t zeta_blocked,
                                const ce_expression_instruction *expression,
                                uint32_t expression_count, double parameter_min, double parameter_max,
                                const ce_complex *draw_points, uint32_t draw_point_count,
                                uint32_t close_arbitrary,
                                ce_complex *output, uint32_t output_capacity,
                                uint32_t *line_offsets, uint32_t *line_roles,
                                uint32_t line_capacity, uint32_t stats[2]);
int32_t ce_generate_radial_steps(const ce_map_config *config,
                                 double domain_min, double domain_max,
                                 uint32_t step_count, uint32_t curve_points,
                                 ce_complex *output, uint32_t output_capacity,
                                 uint32_t *line_offsets, uint32_t line_capacity,
                                 uint32_t stats[2]);
int32_t ce_generate_viewport_grid_pixels(uint32_t shape, uint32_t density,
                                         uint32_t curve_points,
                                         uint32_t width, uint32_t height,
                                         float *output, uint32_t output_capacity,
                                         uint32_t *line_offsets, uint32_t *line_roles,
                                         uint32_t line_capacity, uint32_t stats[2]);
int32_t ce_build_planar_line(const ce_map_config *config,
                             double start_re, double start_im, double end_re, double end_im,
                             uint32_t sample_count,
                             double scale_x, double scale_y, double render_limit,
                             double jump_threshold_sq, double tolerance_sq,
                             uint32_t has_branch_cuts, uint32_t branch_cut_is_drawn,
                             double branch_cut_angle, const ce_complex *branch_cut_points,
                             uint32_t branch_cut_point_count, ce_complex *output,
                             uint32_t output_capacity);
int32_t ce_build_planar_lines(const ce_map_config *config,
                              const ce_complex *starts, const ce_complex *ends,
                              const uint32_t *sample_counts, uint32_t line_count,
                              double scale_x, double scale_y, double render_limit,
                              double jump_threshold_sq, double tolerance_sq,
                              uint32_t has_branch_cuts, uint32_t branch_cut_is_drawn,
                              double branch_cut_angle, const ce_complex *branch_cut_points,
                              uint32_t branch_cut_point_count, ce_complex *output,
                              uint32_t output_capacity, uint32_t *line_offsets);
int32_t ce_build_planar_polyline(const ce_map_config *config,
                                 const ce_complex *input, uint32_t input_count,
                                 double origin_x, double origin_y,
                                 double scale_x, double scale_y, double render_limit,
                                 double jump_threshold_sq, double tolerance_sq,
                                 double max_segment_sq, uint32_t max_depth,
                                 uint32_t has_branch_cuts, uint32_t branch_cut_is_drawn,
                                 double branch_cut_angle, const ce_complex *branch_cut_points,
                                 uint32_t branch_cut_point_count, ce_complex *output,
                                 uint32_t output_capacity);
int32_t ce_render_domain_tile(const ce_map_config *config,
                              double x_min, double x_max, double y_min, double y_max,
                              uint32_t frame_width, uint32_t frame_height,
                              uint32_t tile_x, uint32_t tile_y,
                              uint32_t tile_width, uint32_t tile_height, uint32_t scale,
                              uint32_t orbit_mode, const ce_complex *palette_rg,
                              const double *palette_b, uint32_t palette_count,
                              double brightness, double contrast, double saturation,
                              double lightness_cycles, uint32_t quality_only,
                              uint8_t *rgba);

int32_t ce_precise_pixel_coordinate(const char *center_re, const char *center_im,
                                    int32_t zoom_power, uint32_t precision_bits,
                                    uint32_t frame_width, uint32_t frame_height,
                                    double pixel_x, double pixel_y,
                                    char *output_re, uint32_t output_re_capacity,
                                    char *output_im, uint32_t output_im_capacity);
int32_t ce_project_precise_pixels(const ce_map_config *config,
                                  const char *input_center_re, const char *input_center_im,
                                  int32_t input_zoom_power, uint32_t precision_bits,
                                  uint32_t input_width, uint32_t input_height,
                                  const float *input_pixels, uint32_t point_count,
                                  uint32_t map_points,
                                  const char *output_center_re, const char *output_center_im,
                                  int32_t output_zoom_power,
                                  uint32_t output_width, uint32_t output_height,
                                  float *output_pixels, uint8_t *valid);
int32_t ce_project_precise_pixels_to_canvas(const ce_map_config *config,
                                            const char *input_center_re,
                                            const char *input_center_im,
                                            int32_t input_zoom_power,
                                            uint32_t precision_bits,
                                            uint32_t input_width, uint32_t input_height,
                                            const float *input_pixels, uint32_t point_count,
                                            uint32_t map_points,
                                            double output_origin_x, double output_origin_y,
                                            double output_scale_x, double output_scale_y,
                                            float *output_pixels, uint8_t *valid);
int32_t ce_project_values_to_precise(const ce_map_config *config,
                                     const ce_complex *source_points, uint32_t point_count,
                                     uint32_t map_points,
                                     const char *output_center_re, const char *output_center_im,
                                     int32_t output_zoom_power, uint32_t precision_bits,
                                     uint32_t output_width, uint32_t output_height,
                                     float *output_pixels, uint8_t *valid);
int32_t ce_render_domain_tile_precise(const ce_map_config *config,
                                      const char *center_re, const char *center_im,
                                      int32_t zoom_power, uint32_t precision_bits,
                                      uint32_t frame_width, uint32_t frame_height,
                                      uint32_t tile_x, uint32_t tile_y,
                                      uint32_t tile_width, uint32_t tile_height, uint32_t scale,
                                      uint32_t orbit_mode, const ce_complex *palette_rg,
                                      const double *palette_b, uint32_t palette_count,
                                      double brightness, double contrast, double saturation,
                                      double lightness_cycles, uint32_t quality_only,
                                      uint32_t max_repair_passes,
                                      uint32_t *repair_count, uint32_t *direct_count,
                                      uint8_t *rgba);

int32_t ce_compute_dft(const ce_complex *input, uint32_t count, ce_complex *output);
int32_t ce_build_fourier_winding(const ce_complex *signal, const double *times,
                                 uint32_t count, double frequency, double progress,
                                 ce_complex *wound, ce_complex *center);
int32_t ce_compute_laplace_samples(const ce_complex *signal, const double *times,
                                   uint32_t count, const ce_complex *s_values,
                                   uint32_t s_count, ce_complex *output);
int32_t ce_generate_laplace_analysis(uint32_t function_id, double frequency,
                                     double damping, double amplitude,
                                     double time_window, uint32_t sample_count,
                                     double *times, double *signal,
                                     ce_complex *poles, uint32_t *pole_orders,
                                     ce_complex *zeros, uint32_t *pole_count,
                                     uint32_t *zero_count, double *roc_boundary);
int32_t ce_evaluate_laplace(uint32_t function_id, double sigma, double omega,
                            double frequency, double damping, double amplitude,
                            ce_complex *output);
int32_t ce_build_laplace_surface(uint32_t function_id, double frequency,
                                 double damping, double amplitude,
                                 double sigma_min, double sigma_max,
                                 double omega_min, double omega_max,
                                 uint32_t sigma_steps, uint32_t omega_steps,
                                 uint32_t mode, double clip_height,
                                 float *positions, float *normals, float *colors,
                                 uint32_t *indices);

int32_t ce_build_real_surface(const ce_map_config *config,
                              double x_min, double x_max, double y_min, double y_max,
                              uint32_t segments,
                              uint32_t input_u_preset,
                              const ce_expression_instruction *input_u_program,
                              uint32_t input_u_count,
                              uint32_t input_v_preset,
                              const ce_expression_instruction *input_v_program,
                              uint32_t input_v_count,
                              uint32_t component, double height_scale,
                              uint32_t phase_color, const float *palette,
                              uint32_t palette_count, uint32_t values_only,
                              float *positions, float *normals, float *colors,
                              float *raw_values, double *values, float *phases,
                              uint32_t *indices, double *minimum, double *maximum,
                              uint32_t *finite_count);
int32_t ce_build_image_mesh(const ce_map_config *config,
                            double source_center_re, double source_center_im,
                            double source_width, double source_height,
                            double view_x_min, double view_x_max,
                            double view_y_min, double view_y_max,
                            uint32_t pixel_width, uint32_t pixel_height,
                            uint32_t base_resolution, uint32_t max_depth,
                            uint32_t max_cells, uint32_t max_vertices,
                            uint32_t max_samples,
                            float *texture_coordinates, float *mapped_positions,
                            uint16_t *indices, uint32_t index_capacity,
                            uint32_t stats[4], uint32_t build_fold,
                            double fold_height_scale, float *fold_positions,
                            float *fold_uvs, double fold_mapping[4]);
int32_t ce_build_image_mesh_precise(const ce_map_config *config,
                                    double source_center_re, double source_center_im,
                                    double source_width, double source_height,
                                    const char *view_center_re, const char *view_center_im,
                                    int32_t zoom_power, uint32_t precision_bits,
                                    uint32_t pixel_width, uint32_t pixel_height,
                                    uint32_t base_resolution, uint32_t max_depth,
                                    uint32_t max_cells, uint32_t max_vertices,
                                    uint32_t max_samples,
                                    float *texture_coordinates, float *mapped_positions,
                                    uint16_t *indices, uint32_t index_capacity,
                                    uint32_t stats[4]);
int32_t ce_build_grid_fold(const ce_map_config *config,
                           const ce_complex *source_points,
                           const uint32_t *source_offsets,
                           const uint8_t *point_roles, uint32_t point_set_count,
                           double source_x_min, double source_x_max,
                           double output_x_min, double output_x_max,
                           double output_y_min, double output_y_max,
                           double height_scale,
                           float *line_positions, uint32_t line_position_capacity,
                           uint32_t *line_offsets, uint32_t *line_point_sets,
                           float *point_positions, uint32_t point_position_capacity,
                           uint32_t *point_offsets, uint32_t *point_point_sets,
                           uint32_t stats[4], double mapping[4]);
int32_t ce_build_sphere_lines(const ce_map_config *config,
                              const ce_complex *source_points, const uint32_t *source_offsets,
                              uint32_t line_count, uint32_t map_points,
                              double center_x, double center_y, double radius,
                              double rotation_x, double rotation_y,
                              float *output, uint32_t output_capacity,
                              uint32_t *line_offsets);
int32_t ce_project_sphere_points(const ce_map_config *config,
                                 const ce_complex *source_points, uint32_t point_count,
                                 uint32_t map_points,
                                 double center_x, double center_y, double radius,
                                 double rotation_x, double rotation_y,
                                 float *positions, uint8_t *visible);
int32_t ce_build_sphere_probe(const ce_map_config *config,
                              double source_re, double source_im, double neighborhood_size,
                              double crosshair_factor, uint32_t map_points,
                              double center_x, double center_y, double radius,
                              double rotation_x, double rotation_y,
                              float center_position[2], uint8_t *center_visible,
                              float *output, uint32_t output_capacity,
                              uint32_t line_offsets[4]);
int32_t ce_build_riemann_sphere_targets(const ce_map_config *config,
                                        const ce_complex *source_points, uint32_t point_count,
                                        uint32_t map_points, double scale, double radius,
                                        float *start_positions, float *target_positions);
int32_t ce_interpolate_geometry(const float *start_positions, const float *target_positions,
                                uint32_t float_count, double progress, float *output);
int32_t ce_build_riemann_sphere_positions(const ce_complex *points, uint32_t point_count,
                                          double scale, double radius, float *positions);
int32_t ce_build_riemann_probe(const ce_map_config *config, double re, double im,
                               uint32_t map_point, double scale, double radius,
                               double progress, float active[3], float sphere[3], float ray[6]);
int32_t ce_build_fold_preimage_markers(const ce_map_config *config,
                                       const ce_complex *roots, uint32_t root_count,
                                       double mapped_center_x, double mapped_center_y,
                                       double source_center, double scale, double height_scale,
                                       float *positions);
int32_t ce_trace_streamlines(const ce_map_config *config, const ce_complex *seeds,
                             uint32_t seed_count, double x_min, double x_max,
                             double y_min, double y_max, double step_size,
                             uint32_t max_steps, uint32_t inverse_field,
                             ce_complex *positions, double *magnitudes,
                             uint32_t output_capacity, uint32_t *offsets);
int32_t ce_build_vector_field(const ce_map_config *config,
                              double x_min, double x_max, double y_min, double y_max,
                              uint32_t density, uint32_t inverse_field,
                              ce_complex *positions, ce_complex *vectors,
                              double *magnitudes, uint8_t *valid);
int32_t ce_build_tissot(const ce_map_config *config,
                        double x_min, double x_max, double y_min, double y_max,
                        uint32_t density, uint32_t segments,
                        ce_complex *source_centers, ce_complex *mapped_centers,
                        double *input_radii, double *output_radii, uint8_t *critical,
                        ce_complex *source_circles, ce_complex *mapped_circles,
                        ce_complex *source_spokes, ce_complex *mapped_spokes,
                        ce_complex *source_arrows, ce_complex *mapped_arrows,
                        uint32_t output_capacity);
int32_t ce_find_preimages(const ce_map_config *config, double target_re, double target_im,
                          double x_min, double x_max, double y_min, double y_max,
                          uint32_t density, uint32_t max_iterations,
                          double tolerance, double derivative_step, double merge_distance,
                          uint32_t inverse_output, ce_complex *roots, uint32_t root_capacity);
int32_t ce_find_polynomial_roots(const ce_complex *coefficients, uint32_t coefficient_count,
                                 uint32_t max_iterations, double tolerance,
                                 ce_complex *roots);
int32_t ce_analyze_contour(const ce_map_config *config, const ce_complex *points,
                           uint32_t point_count, ce_complex *integral,
                           double *winding, uint32_t *status);
int32_t ce_estimate_residue(const ce_map_config *config, double pole_re, double pole_im,
                            double radius, uint32_t samples, ce_complex *residue);

#ifdef __cplusplus
}
#endif

#endif
