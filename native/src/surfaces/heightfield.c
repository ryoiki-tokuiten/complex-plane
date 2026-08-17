#include "complex_engine.h"
#include "expression_internal.h"

#include <math.h>
#include <stddef.h>

#define CE_SURFACE_SIZE 6.0
#define CE_SURFACE_HALF 3.0
#define CE_SURFACE_HEIGHT_HALF 1.75
#define CE_SURFACE_CLAMP 8.0
#define CE_RECIPROCAL_EPSILON 1e-15
#define CE_RECIPROCAL_CAP 10000.0

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

static int ce_surface_map(const ce_map_config *config, ce_complex input, ce_complex *output) {
    if (config->function_id == CE_FN_RECIPROCAL && config->chain_count == 1u &&
        !config->derivative && !config->use_taylor) {
        const double scale = fmax(fabs(input.re), fabs(input.im));
        if (scale == 0.0) return 0;
        if (scale < CE_RECIPROCAL_EPSILON) {
            const double normalized = hypot(input.re / scale, input.im / scale);
            if (!(normalized > 0.0)) return 0;
            output->re = input.re / scale / normalized * CE_RECIPROCAL_CAP;
            output->im = -input.im / scale / normalized * CE_RECIPROCAL_CAP;
            return 1;
        }
    }
    uint8_t valid = 0;
    return ce_evaluate_points(config, &input, 1u, output, &valid) == 0 && valid;
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
    if (!config || !segments || !values || !minimum || !maximum || !finite_count ||
        (!input_u_preset && (!input_u_program || !input_u_count)) ||
        (!input_v_preset && (!input_v_program || !input_v_count)) ||
        (!values_only && (!positions || !normals || !colors || !raw_values ||
                          !phases || !indices || !palette || !palette_count))) return -1;

    const uint32_t stride = segments + 1u;
    const uint32_t vertex_count = stride * stride;
    const double x_step = (x_max - x_min) / segments;
    const double y_step = (y_max - y_min) / segments;
    double low = INFINITY;
    double high = -INFINITY;
    uint32_t finite = 0;

    for (uint32_t row = 0; row < stride; ++row) {
        const double y = y_min + row * y_step;
        for (uint32_t column = 0; column < stride; ++column) {
            const double x = x_min + column * x_step;
            const uint32_t index = row * stride + column;
            const ce_complex variables[2] = {{x, 0.0}, {y, 0.0}};
            ce_complex u, v, mapped;
            double value = NAN;
            float phase = 0.5f;
            if (ce_surface_input(config, input_u_preset, input_u_program, input_u_count, variables, &u) &&
                ce_surface_input(config, input_v_preset, input_v_program, input_v_count, variables, &v)) {
                const ce_complex input = {u.re - v.im, u.im + v.re};
                if (isfinite(input.re) && isfinite(input.im) && ce_surface_map(config, input, &mapped)) {
                    value = ce_surface_value(mapped, component);
                    if (isfinite(value)) {
                        phase = (float)((atan2(mapped.im, mapped.re) + 3.14159265358979323846) /
                                        6.28318530717958647693);
                        if (value < low) low = value;
                        if (value > high) high = value;
                        ++finite;
                    }
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
