#include "complex_engine.h"
#include "domain_internal.h"
#include "expression_internal.h"

#include <math.h>
#include <stddef.h>
#include <limits.h>
#include <stdlib.h>

#define CE_SURFACE_SIZE 6.0
#define CE_SURFACE_HALF 3.0
#define CE_SURFACE_HEIGHT_HALF 1.75
#define CE_SURFACE_CLAMP 8.0

enum ce_surface_input_preset {
    CE_SURFACE_INPUT_GENERIC = 0,
    CE_SURFACE_INPUT_X = 1,
    CE_SURFACE_INPUT_Y = 2,
    CE_SURFACE_INPUT_ZERO = 3,
    CE_SURFACE_INPUT_X_PLUS_Y = 4,
    CE_SURFACE_INPUT_X_MINUS_Y = 5,
    CE_SURFACE_INPUT_X_TIMES_Y = 6,
    CE_SURFACE_INPUT_TWO_X_PLUS_Y = 7,
    CE_SURFACE_INPUT_SIN_X_PLUS_COS_Y = 8,
    CE_SURFACE_INPUT_X2_MINUS_Y2 = 9
};

static ce_complex ce_surface_preset(uint32_t preset, double x, double y) {
    double value;
    switch (preset) {
        case CE_SURFACE_INPUT_X: value = x; break;
        case CE_SURFACE_INPUT_Y: value = y; break;
        case CE_SURFACE_INPUT_ZERO: value = 0.0; break;
        case CE_SURFACE_INPUT_X_PLUS_Y: value = x + y; break;
        case CE_SURFACE_INPUT_X_MINUS_Y: value = x - y; break;
        case CE_SURFACE_INPUT_X_TIMES_Y: value = x * y; break;
        case CE_SURFACE_INPUT_TWO_X_PLUS_Y: value = 2.0 * x + y; break;
        case CE_SURFACE_INPUT_SIN_X_PLUS_COS_Y: value = sin(x) + cos(y); break;
        case CE_SURFACE_INPUT_X2_MINUS_Y2: value = x * x - y * y; break;
        default: value = NAN; break;
    }
    const ce_complex result = {value, 0.0};
    return result;
}

static int ce_surface_input(const ce_map_config *config, uint32_t preset,
                            const ce_expression_instruction *program, uint32_t count,
                            const ce_complex variables[2], ce_complex *result) {
    if (preset != CE_SURFACE_INPUT_GENERIC) {
        *result = ce_surface_preset(preset, variables[0].re, variables[1].re);
        return isfinite(result->re);
    }
    uint8_t error = 0;
    return program && count && ce_evaluate_expression_one(
        config, program, count, variables, 2u, 0, result, &error
    );
}

static double ce_surface_value(ce_complex value, uint32_t component) {
    if (!isfinite(value.re) || !isfinite(value.im)) return NAN;
    if (component == 1u) return value.im;
    if (component == 2u) {
        const double magnitude = hypot(value.re, value.im);
        return isfinite(magnitude) ? magnitude : NAN;
    }
    return value.re;
}

static float ce_surface_height(double value, double height_scale) {
    double clipped = value;
    const double absolute = fabs(value);
    if (absolute > CE_SURFACE_CLAMP) {
        clipped = copysign(CE_SURFACE_CLAMP + tanh(absolute - CE_SURFACE_CLAMP), value);
    }
    return (float)(clipped * (CE_SURFACE_HEIGHT_HALF * height_scale / CE_SURFACE_CLAMP));
}

static void ce_surface_color(const float *palette, uint32_t palette_count,
                             double ratio, float *target) {
    if (ratio < 0.0) ratio = 0.0;
    else if (ratio > 1.0) ratio = 1.0;
    uint32_t index = (uint32_t)floor(ratio * (palette_count - 1u) + 0.5);
    target[0] = palette[index * 3u];
    target[1] = palette[index * 3u + 1u];
    target[2] = palette[index * 3u + 2u];
}

static int ce_surface_input_contract(uint32_t preset,
                                     const ce_expression_instruction *program,
                                     uint32_t count) {
    if (preset > CE_SURFACE_INPUT_X2_MINUS_Y2) return 0;
    return preset == CE_SURFACE_INPUT_GENERIC
        ? program != NULL && count != 0u
        : program == NULL && count == 0u;
}

static int32_t ce_evaluate_real_grid(const ce_map_config *config,
                                     double x_min, double x_max,
                                     double y_min, double y_max,
                                     uint32_t width, uint32_t height,
                                     uint32_t top_down,
                                     uint32_t input_u_preset,
                                     const ce_expression_instruction *input_u_program,
                                     uint32_t input_u_count,
                                     uint32_t input_v_preset,
                                     const ce_expression_instruction *input_v_program,
                                     uint32_t input_v_count,
                                     ce_complex *mapped, uint8_t *valid) {
    const double x_step = width > 1u ? (x_max - x_min) / (width - 1u) : 0.0;
    const double y_step = height > 1u ? (y_max - y_min) / (height - 1u) : 0.0;
    for (uint32_t row = 0; row < height; ++row) {
        const double y = top_down ? y_max - row * y_step : y_min + row * y_step;
        for (uint32_t column = 0; column < width; ++column) {
            const size_t index = (size_t)row * width + column;
            const ce_complex variables[2] = {{x_min + column * x_step, 0.0}, {y, 0.0}};
            ce_complex u, v;
            if (ce_surface_input(config, input_u_preset, input_u_program, input_u_count, variables, &u) &&
                ce_surface_input(config, input_v_preset, input_v_program, input_v_count, variables, &v)) {
                mapped[index] = (ce_complex){u.re - v.im, u.im + v.re};
            } else {
                mapped[index] = (ce_complex){NAN, NAN};
            }
        }
    }
    return ce_evaluate_points(config, mapped, width * height, mapped, valid);
}

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
                              uint32_t *finite_count) {
    if (!config || !segments || !isfinite(x_min) || !isfinite(x_max) ||
        !isfinite(y_min) || !isfinite(y_max) || !(x_max > x_min) || !(y_max > y_min) ||
        component > 2u || !isfinite(height_scale) || !(height_scale > 0.0) ||
        !ce_surface_input_contract(input_u_preset, input_u_program, input_u_count) ||
        !ce_surface_input_contract(input_v_preset, input_v_program, input_v_count) ||
        !values || !minimum || !maximum || !finite_count ||
        (!values_only && (!positions || !normals || !colors || !raw_values ||
                          !phases || !indices || !palette || !palette_count))) return -1;

    const size_t stride_size = (size_t)segments + 1u;
    if (stride_size == 0u || stride_size > SIZE_MAX / stride_size ||
        (size_t)segments > (size_t)INT32_MAX / 6u / segments) return -1;
    const size_t cell_count = (size_t)segments * segments;
    const size_t vertex_count_size = stride_size * stride_size;
    if (stride_size > UINT32_MAX || vertex_count_size > UINT32_MAX ||
        cell_count > (size_t)INT32_MAX / 6u) return -1;
    if (!values_only) {
        if (palette_count > UINT32_MAX / 3u) return -1;
        for (uint32_t index = 0; index < palette_count * 3u; ++index) {
            if (!isfinite(palette[index]) || palette[index] < 0.0f || palette[index] > 1.0f) return -1;
        }
    }

    const uint32_t stride = segments + 1u;
    const uint32_t vertex_count = (uint32_t)vertex_count_size;
    ce_complex *mapped = malloc(vertex_count_size * sizeof(ce_complex));
    uint8_t *valid = malloc(vertex_count_size);
    if (!mapped || !valid) {
        free(mapped); free(valid);
        return -2;
    }
    if (ce_evaluate_real_grid(config, x_min, x_max, y_min, y_max, stride, stride, 0u,
                              input_u_preset, input_u_program, input_u_count,
                              input_v_preset, input_v_program, input_v_count,
                              mapped, valid) != 0) {
        free(mapped); free(valid);
        return -3;
    }
    double low = INFINITY;
    double high = -INFINITY;
    uint32_t finite = 0;

    for (uint32_t row = 0; row < stride; ++row) {
        for (uint32_t column = 0; column < stride; ++column) {
            const uint32_t index = row * stride + column;
            double value = NAN;
            float phase = 0.5f;
            if (valid[index]) {
                value = ce_surface_value(mapped[index], component);
                if (isfinite(value)) {
                    phase = (float)((atan2(mapped[index].im, mapped[index].re) + 3.14159265358979323846) /
                                    6.28318530717958647693);
                    if (value < low) low = value;
                    if (value > high) high = value;
                    ++finite;
                }
            }
            values[index] = value;
            if (values_only) continue;
            const uint32_t offset = index * 3u;
            raw_values[index] = (float)value;
            phases[index] = phase;
            positions[offset] = (float)(column * (CE_SURFACE_SIZE / segments) - CE_SURFACE_HALF);
            positions[offset + 1u] = isfinite(value) ? ce_surface_height(value, height_scale) : 0.0f;
            positions[offset + 2u] = (float)(row * (CE_SURFACE_SIZE / segments) - CE_SURFACE_HALF);
        }
    }

    *finite_count = finite;
    *minimum = finite ? low : NAN;
    *maximum = finite ? high : NAN;
    free(mapped);
    free(valid);
    if (values_only) return 0;

    const double span = high - low;
    const double inverse_span = isfinite(span) && span != 0.0 ? 1.0 / span : 1.0;
    for (uint32_t index = 0; index < vertex_count; ++index) {
        const uint32_t offset = index * 3u;
        if (isfinite(values[index])) {
            const double ratio = phase_color ? phases[index] : (values[index] - low) * inverse_span;
            ce_surface_color(palette, palette_count, ratio, colors + offset);
        } else {
            colors[offset] = colors[offset + 1u] = colors[offset + 2u] = 0.0f;
        }
    }

    const float grid_step = (float)(CE_SURFACE_SIZE / segments);
    for (uint32_t row = 0; row < stride; ++row) {
        const uint32_t previous_row = (row ? row - 1u : 0u) * stride;
        const uint32_t next_row = (row < segments ? row + 1u : segments) * stride;
        for (uint32_t column = 0; column < stride; ++column) {
            const uint32_t current_row = row * stride;
            const uint32_t previous_column = column ? column - 1u : 0u;
            const uint32_t next_column = column < segments ? column + 1u : segments;
            const uint32_t index = current_row + column;
            const float x_divisor = (column == 0u || column == segments) ? grid_step : 2.0f * grid_step;
            const float z_divisor = (row == 0u || row == segments) ? grid_step : 2.0f * grid_step;
            const float nx = -(positions[(current_row + next_column) * 3u + 1u] -
                               positions[(current_row + previous_column) * 3u + 1u]) / x_divisor;
            const float nz = -(positions[(next_row + column) * 3u + 1u] -
                               positions[(previous_row + column) * 3u + 1u]) / z_divisor;
            const float inverse = 1.0f / sqrtf(nx * nx + nz * nz + 1.0f);
            normals[index * 3u] = nx * inverse;
            normals[index * 3u + 1u] = inverse;
            normals[index * 3u + 2u] = nz * inverse;
        }
    }

    uint32_t cursor = 0;
    for (uint32_t row = 0; row < segments; ++row) {
        for (uint32_t column = 0; column < segments; ++column) {
            const uint32_t a = row * stride + column;
            const uint32_t b = a + 1u;
            const uint32_t c = a + stride;
            const uint32_t d = c + 1u;
            if (!isfinite(values[a]) || !isfinite(values[b]) ||
                !isfinite(values[c]) || !isfinite(values[d])) continue;
            indices[cursor++] = a; indices[cursor++] = c; indices[cursor++] = b;
            indices[cursor++] = b; indices[cursor++] = c; indices[cursor++] = d;
        }
    }
    return (int32_t)cursor;
}

static double ce_contour_component(ce_complex value, uint32_t component) {
    if (component == 1u) return value.im;
    if (component == 2u) return hypot(value.re, value.im);
    if (component == 3u) return atan2(value.im, value.re);
    return value.re;
}

static double ce_contour_smoothstep(double edge0, double edge1, double value) {
    if (edge0 == edge1) return value < edge0 ? 0.0 : 1.0;
    double t = (value - edge0) / (edge1 - edge0);
    if (t < 0.0) t = 0.0;
    else if (t > 1.0) t = 1.0;
    return t * t * (3.0 - 2.0 * t);
}

static void ce_apply_contours(const double *values, uint32_t width, uint32_t height,
                              double contour_interval, double contour_thickness,
                              const uint8_t light_ink[3], const uint8_t dark_ink[3],
                              uint8_t *rgba) {
    const double lower = fmax(0.0, contour_thickness - 0.75);
    const double upper = contour_thickness + 0.75;
    double line_mix_scale = 0.62 + contour_thickness * 0.08;
    if (line_mix_scale < 0.66) line_mix_scale = 0.66;
    else if (line_mix_scale > 1.0) line_mix_scale = 1.0;
    for (uint32_t row = 0; row < height; ++row) {
        for (uint32_t column = 0; column < width; ++column) {
            const size_t index = (size_t)row * width + column;
            const double value = values[index];
            if (!isfinite(value)) continue;
            const double left = column ? values[index - 1u] : value;
            const double right = column + 1u < width ? values[index + 1u] : value;
            const double top = row ? values[index - width] : value;
            const double bottom = row + 1u < height ? values[index + width] : value;
            if (!isfinite(left) || !isfinite(right) || !isfinite(top) || !isfinite(bottom)) continue;
            const double dx = (right - left) * (column && column + 1u < width ? 0.5 : 1.0);
            const double dy = (bottom - top) * (row && row + 1u < height ? 0.5 : 1.0);
            const double gradient = hypot(dx, dy);
            if (!(gradient > 1e-12)) continue;
            const double distance = fabs(value - round(value / contour_interval) * contour_interval);
            const double intensity = 1.0 - ce_contour_smoothstep(lower, upper, distance / gradient);
            const double mix = intensity * line_mix_scale;
            const size_t offset = index * 4u;
            const double luminance = 0.2126 * rgba[offset] + 0.7152 * rgba[offset + 1u] +
                                     0.0722 * rgba[offset + 2u];
            const uint8_t *ink = luminance < 145.0 ? light_ink : dark_ink;
            rgba[offset] = (uint8_t)lrint(rgba[offset] * (1.0 - mix) + ink[0] * mix);
            rgba[offset + 1u] = (uint8_t)lrint(rgba[offset + 1u] * (1.0 - mix) + ink[1] * mix);
            rgba[offset + 2u] = (uint8_t)lrint(rgba[offset + 2u] * (1.0 - mix) + ink[2] * mix);
        }
    }
}

int32_t ce_render_map_contour(const ce_map_config *config,
                              double x_min, double x_max, double y_min, double y_max,
                              uint32_t width, uint32_t height, uint32_t component,
                              uint32_t contours_enabled, double contour_interval,
                              double contour_thickness,
                              const ce_complex *palette_rg, const double *palette_b,
                              uint32_t palette_count, double brightness,
                              double contrast, double saturation, double lightness_cycles,
                              uint8_t *rgba) {
    if (!config || !width || !height || !isfinite(x_min) || !isfinite(x_max) ||
        !isfinite(y_min) || !isfinite(y_max) || !(x_max > x_min) || !(y_max > y_min) ||
        component > 3u || contours_enabled > 1u || !palette_rg || !palette_b ||
        palette_count < 2u || !isfinite(brightness) || !isfinite(contrast) ||
        !isfinite(saturation) || !isfinite(lightness_cycles) || !rgba ||
        (contours_enabled && (!(contour_interval > 0.0) || !(contour_thickness > 0.0)))) return -1;
    if ((size_t)width > SIZE_MAX / height) return -1;
    const size_t pixel_count = (size_t)width * height;
    if (pixel_count > UINT32_MAX || pixel_count > SIZE_MAX / sizeof(ce_complex) ||
        pixel_count > SIZE_MAX / sizeof(double) || pixel_count > SIZE_MAX / 4u) return -1;
    ce_complex *mapped = malloc(pixel_count * sizeof(ce_complex));
    uint8_t *valid = malloc(pixel_count);
    double *values = malloc(pixel_count * sizeof(double));
    if (!mapped || !valid || !values) {
        free(mapped); free(valid); free(values);
        return -2;
    }

    const double x_step = width > 1u ? (x_max - x_min) / (width - 1u) : 0.0;
    const double y_step = height > 1u ? (y_max - y_min) / (height - 1u) : 0.0;
    for (uint32_t row = 0; row < height; ++row) {
        const double y = y_max - row * y_step;
        for (uint32_t column = 0; column < width; ++column) {
            const size_t index = (size_t)row * width + column;
            mapped[index] = (ce_complex){x_min + column * x_step, y};
        }
    }
    if (ce_evaluate_points(config, mapped, (uint32_t)pixel_count, mapped, valid) != 0 ||
        ce_domain_color_points(mapped, valid, (uint32_t)pixel_count,
                               palette_rg, palette_b, palette_count,
                               brightness, contrast, saturation, lightness_cycles, rgba) != 0) {
        free(mapped); free(valid); free(values);
        return -3;
    }
    for (size_t index = 0; index < pixel_count; ++index) {
        values[index] = valid[index] ? ce_contour_component(mapped[index], component) : NAN;
    }
    free(mapped);
    free(valid);

    if (contours_enabled) {
        static const uint8_t light_ink[3] = {247u, 247u, 247u};
        static const uint8_t dark_ink[3] = {9u, 9u, 9u};
        ce_apply_contours(values, width, height, contour_interval, contour_thickness,
                          light_ink, dark_ink, rgba);
    }
    free(values);
    return 0;
}

int32_t ce_render_real_contour(const ce_map_config *config,
                               double x_min, double x_max, double y_min, double y_max,
                               uint32_t width, uint32_t height,
                               uint32_t input_u_preset,
                               const ce_expression_instruction *input_u_program,
                               uint32_t input_u_count,
                               uint32_t input_v_preset,
                               const ce_expression_instruction *input_v_program,
                               uint32_t input_v_count,
                               uint32_t component, uint32_t contours_enabled,
                               double contour_interval, double contour_thickness,
                               const float *palette, uint32_t palette_count,
                               uint8_t *rgba) {
    if (!config || !width || !height || !isfinite(x_min) || !isfinite(x_max) ||
        !isfinite(y_min) || !isfinite(y_max) || !(x_max > x_min) || !(y_max > y_min) ||
        !ce_surface_input_contract(input_u_preset, input_u_program, input_u_count) ||
        !ce_surface_input_contract(input_v_preset, input_v_program, input_v_count) ||
        component > 2u || contours_enabled > 1u || !palette || palette_count < 2u || !rgba ||
        (contours_enabled && (!isfinite(contour_interval) || !(contour_interval > 0.0) ||
                              !isfinite(contour_thickness) || !(contour_thickness > 0.0)))) return -1;
    if (palette_count > UINT32_MAX / 3u) return -1;
    for (uint32_t index = 0; index < palette_count * 3u; ++index) {
        if (!isfinite(palette[index]) || palette[index] < 0.0f || palette[index] > 1.0f) return -1;
    }

    if ((size_t)width > SIZE_MAX / height) return -1;
    const size_t pixel_count = (size_t)width * height;
    if (pixel_count > UINT32_MAX || pixel_count > SIZE_MAX / sizeof(ce_complex) ||
        pixel_count > SIZE_MAX / sizeof(double) || pixel_count > SIZE_MAX / 4u) return -1;
    ce_complex *mapped = malloc(pixel_count * sizeof(ce_complex));
    uint8_t *valid = malloc(pixel_count);
    double *values = malloc(pixel_count * sizeof(double));
    if (!mapped || !valid || !values) {
        free(mapped); free(valid); free(values);
        return -2;
    }
    if (ce_evaluate_real_grid(config, x_min, x_max, y_min, y_max, width, height, 1u,
                              input_u_preset, input_u_program, input_u_count,
                              input_v_preset, input_v_program, input_v_count,
                              mapped, valid) != 0) {
        free(mapped); free(valid); free(values);
        return -3;
    }

    double low = INFINITY;
    double high = -INFINITY;
    for (size_t index = 0; index < pixel_count; ++index) {
        const double value = valid[index] ? ce_surface_value(mapped[index], component) : NAN;
        values[index] = value;
        if (!isfinite(value)) continue;
        if (value < low) low = value;
        if (value > high) high = value;
    }
    free(mapped);
    free(valid);

    const double span = high - low;
    const double inverse_span = isfinite(span) && fabs(span) > 1e-9 ? 1.0 / span : 1.0;
    for (size_t index = 0; index < pixel_count; ++index) {
        const size_t offset = index * 4u;
        if (!isfinite(values[index])) {
            rgba[offset] = 6u;
            rgba[offset + 1u] = 8u;
            rgba[offset + 2u] = 15u;
            rgba[offset + 3u] = 255u;
            continue;
        }
        float color[3];
        ce_surface_color(palette, palette_count, (values[index] - low) * inverse_span, color);
        rgba[offset] = (uint8_t)lrint(color[0] * 255.0f);
        rgba[offset + 1u] = (uint8_t)lrint(color[1] * 255.0f);
        rgba[offset + 2u] = (uint8_t)lrint(color[2] * 255.0f);
        rgba[offset + 3u] = 255u;
    }
    if (contours_enabled) {
        static const uint8_t light_ink[3] = {246u, 249u, 255u};
        static const uint8_t dark_ink[3] = {8u, 10u, 18u};
        ce_apply_contours(values, width, height, contour_interval, contour_thickness,
                          light_ink, dark_ink, rgba);
    }
    free(values);
    return 0;
}
