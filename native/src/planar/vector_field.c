#include "complex_engine.h"

#include <math.h>
#include <stddef.h>

#define CE_MIN_VECTOR_MAG_SQ 1e-18

static int ce_normalize_vector(ce_complex *vector, uint32_t inverse_field, double *magnitude) {
    if (!isfinite(vector->re) || !isfinite(vector->im)) return 0;
    double magnitude_sq = vector->re * vector->re + vector->im * vector->im;
    if (!isfinite(magnitude_sq) || magnitude_sq < CE_MIN_VECTOR_MAG_SQ) return 0;
    if (inverse_field) {
        vector->re /= magnitude_sq;
        vector->im /= -magnitude_sq;
        magnitude_sq = vector->re * vector->re + vector->im * vector->im;
    }
    *magnitude = sqrt(magnitude_sq);
    return isfinite(*magnitude) && *magnitude >= 1e-9;
}

static int ce_vector_at(const ce_map_config *config, double x, double y,
                        uint32_t inverse_field, ce_complex *vector, double *magnitude) {
    const ce_complex point = {x, y};
    uint8_t valid = 0;
    if (ce_evaluate_points(config, &point, 1u, vector, &valid) != 0 || !valid ||
        !isfinite(vector->re) || !isfinite(vector->im)) return 0;
    return ce_normalize_vector(vector, inverse_field, magnitude);
}

int32_t ce_trace_streamlines(const ce_map_config *config, const ce_complex *seeds,
                             uint32_t seed_count, double x_min, double x_max,
                             double y_min, double y_max, double step_size,
                             uint32_t max_steps, uint32_t inverse_field,
                             ce_complex *positions, double *magnitudes,
                             uint32_t output_capacity, uint32_t *offsets) {
    if (!config || !seeds || !seed_count || !positions || !magnitudes || !offsets ||
        !isfinite(x_min) || !isfinite(x_max) || !isfinite(y_min) || !isfinite(y_max) ||
        !(x_max > x_min) || !(y_max > y_min) ||
        !isfinite(step_size) || step_size <= 0.0 || !max_steps || max_steps > 10000u ||
        inverse_field > 1u || seed_count > UINT32_MAX / max_steps ||
        output_capacity < seed_count * max_steps) return -1;
    uint32_t cursor = 0;
    offsets[0] = 0;
    for (uint32_t seed = 0; seed < seed_count; ++seed) {
        double x = seeds[seed].re;
        double y = seeds[seed].im;
        for (uint32_t step = 0; step < max_steps; ++step) {
            if (!isfinite(x) || !isfinite(y) || x < x_min || x > x_max || y < y_min || y > y_max) break;
            ce_complex k1;
            double k1_magnitude;
            if (!ce_vector_at(config, x, y, inverse_field, &k1, &k1_magnitude)) break;
            if (cursor >= output_capacity) return -2;
            positions[cursor] = (ce_complex){x, y};
            magnitudes[cursor++] = k1_magnitude;
            const double k1x = k1.re / k1_magnitude;
            const double k1y = k1.im / k1_magnitude;
            const double middle_x = x + k1x * step_size * 0.5;
            const double middle_y = y + k1y * step_size * 0.5;
            ce_complex k2;
            double k2_magnitude;
            if (ce_vector_at(config, middle_x, middle_y, inverse_field, &k2, &k2_magnitude)) {
                x += k2.re / k2_magnitude * step_size;
                y += k2.im / k2_magnitude * step_size;
            } else {
                x += k1x * step_size;
                y += k1y * step_size;
            }
        }
        offsets[seed + 1u] = cursor;
    }
    return (int32_t)cursor;
}

int32_t ce_build_vector_field(const ce_map_config *config,
                              double x_min, double x_max, double y_min, double y_max,
                              uint32_t density, uint32_t inverse_field,
                              ce_complex *positions, ce_complex *vectors,
                              double *magnitudes, uint8_t *valid) {
    if (!config || !density || density > 256u || !positions || !vectors || !magnitudes || !valid ||
        !isfinite(x_min) || !isfinite(x_max) || !isfinite(y_min) || !isfinite(y_max) ||
        !(x_max > x_min) || !(y_max > y_min) || inverse_field > 1u) return -1;
    const double dx = (x_max - x_min) / density;
    const double dy = (y_max - y_min) / density;
    uint32_t cursor = 0;
    for (uint32_t column = 0; column <= density; ++column) {
        const double x = x_min + column * dx;
        for (uint32_t row = 0; row <= density; ++row) {
            const double y = y_min + row * dy;
            positions[cursor] = (ce_complex){x, y};
            cursor += 1u;
        }
    }
    if (ce_evaluate_points(config, positions, cursor, vectors, valid) != 0) return -2;
    for (uint32_t index = 0; index < cursor; ++index) {
        valid[index] = (uint8_t)(valid[index] &&
            ce_normalize_vector(&vectors[index], inverse_field, &magnitudes[index]));
        if (!valid[index]) {
            vectors[index] = (ce_complex){0.0, 0.0};
            magnitudes[index] = 0.0;
        }
    }
    return (int32_t)cursor;
}
