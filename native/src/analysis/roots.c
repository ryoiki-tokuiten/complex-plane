#include "complex_engine.h"

#include <math.h>
#include <stdlib.h>

static int ce_analysis_value(const ce_map_config *config, ce_complex point, ce_complex *value) {
    uint8_t valid = 0;
    return ce_evaluate_points(config, &point, 1u, value, &valid) == 0 && valid &&
        isfinite(value->re) && isfinite(value->im);
}

static int ce_analysis_target_value(const ce_map_config *config, ce_complex point,
                                    uint32_t inverse_output, ce_complex *value) {
    if (!ce_analysis_value(config, point, value)) return 0;
    if (inverse_output) {
        *value = ce_div((ce_complex){1.0, 0.0}, *value);
        return isfinite(value->re) && isfinite(value->im);
    }
    return 1;
}

int32_t ce_find_preimages(const ce_map_config *config, double target_re, double target_im,
                          double x_min, double x_max, double y_min, double y_max,
                          uint32_t density, uint32_t max_iterations,
                          double tolerance, double derivative_step, double merge_distance,
                          uint32_t inverse_output, ce_complex *roots, uint32_t root_capacity) {
    if (!config || !roots || !density || !root_capacity || !isfinite(target_re) || !isfinite(target_im)) return -1;
    const double span = fmax(fmax(x_max - x_min, y_max - y_min), 1e-6);
    uint32_t root_count = 0;
    for (uint32_t row = 0; row <= density; ++row) {
        for (uint32_t column = 0; column <= density; ++column) {
            double re = x_min + (x_max - x_min) * column / density;
            double im = y_min + (y_max - y_min) * row / density;
            for (uint32_t iteration = 0; iteration < max_iterations; ++iteration) {
                ce_complex value;
                if (!ce_analysis_target_value(config, (ce_complex){re, im}, inverse_output, &value)) break;
                const double error_re = value.re - target_re;
                const double error_im = value.im - target_im;
                if (hypot(error_re, error_im) <= tolerance) {
                    int duplicate = 0;
                    for (uint32_t index = 0; index < root_count; ++index) {
                        if (hypot(roots[index].re - re, roots[index].im - im) <= merge_distance) {
                            duplicate = 1;
                            break;
                        }
                    }
                    if (!duplicate && re >= x_min - tolerance && re <= x_max + tolerance &&
                        im >= y_min - tolerance && im <= y_max + tolerance) {
                        if (root_count >= root_capacity) return -2;
                        roots[root_count++] = (ce_complex){re, im};
                    }
                    break;
                }
                ce_complex x_value, y_value;
                if (!ce_analysis_target_value(config, (ce_complex){re + derivative_step, im}, inverse_output, &x_value) ||
                    !ce_analysis_target_value(config, (ce_complex){re, im + derivative_step}, inverse_output, &y_value)) break;
                const double j00 = (x_value.re - value.re) / derivative_step;
                const double j10 = (x_value.im - value.im) / derivative_step;
                const double j01 = (y_value.re - value.re) / derivative_step;
                const double j11 = (y_value.im - value.im) / derivative_step;
                const double determinant = j00 * j11 - j01 * j10;
                if (!isfinite(determinant) || fabs(determinant) < 1e-14) break;
                re -= (error_re * j11 - error_im * j01) / determinant;
                im -= (j00 * error_im - j10 * error_re) / determinant;
                if (!isfinite(re) || !isfinite(im) || fabs(re) > span * 100.0 || fabs(im) > span * 100.0) break;
            }
        }
    }
    for (uint32_t i = 1; i < root_count; ++i) {
        ce_complex value = roots[i];
        uint32_t j = i;
        while (j && (roots[j - 1u].re > value.re ||
            (roots[j - 1u].re == value.re && roots[j - 1u].im > value.im))) {
            roots[j] = roots[j - 1u];
            --j;
        }
        roots[j] = value;
    }
    return (int32_t)root_count;
}

static ce_complex ce_polynomial_high_first(const ce_complex *coefficients,
                                            uint32_t count, ce_complex z) {
    ce_complex value = coefficients[0];
    for (uint32_t index = 1; index < count; ++index) value = ce_add(ce_mul(value, z), coefficients[index]);
    return value;
}

int32_t ce_find_polynomial_roots(const ce_complex *coefficients, uint32_t coefficient_count,
                                 uint32_t max_iterations, double tolerance,
                                 ce_complex *roots) {
    if (!coefficients || !roots || coefficient_count < 2u) return -1;
    uint32_t first = 0;
    while (first < coefficient_count && coefficients[first].re == 0.0 && coefficients[first].im == 0.0) ++first;
    if (first >= coefficient_count - 1u) return 0;
    const uint32_t normalized_count = coefficient_count - first;
    const uint32_t degree = normalized_count - 1u;
    ce_complex *normalized = malloc((size_t)normalized_count * sizeof(*normalized));
    ce_complex *next = malloc((size_t)degree * sizeof(*next));
    if (!normalized || !next) { free(normalized); free(next); return -2; }
    for (uint32_t index = 0; index < normalized_count; ++index) {
        normalized[index] = ce_div(coefficients[first + index], coefficients[first]);
    }
    const ce_complex seed = {0.4, 0.9};
    roots[0] = (ce_complex){1.0, 0.0};
    for (uint32_t index = 1; index < degree; ++index) roots[index] = ce_mul(roots[index - 1u], seed);
    for (uint32_t iteration = 0; iteration < max_iterations; ++iteration) {
        int converged = 1;
        for (uint32_t i = 0; i < degree; ++i) {
            ce_complex denominator = {1.0, 0.0};
            for (uint32_t j = 0; j < degree; ++j) {
                if (i != j) denominator = ce_mul(denominator, ce_sub(roots[i], roots[j]));
            }
            if (hypot(denominator.re, denominator.im) < 1e-20) {
                next[i] = roots[i];
                continue;
            }
            const ce_complex correction = ce_div(
                ce_polynomial_high_first(normalized, normalized_count, roots[i]), denominator
            );
            next[i] = ce_sub(roots[i], correction);
            if (hypot(correction.re, correction.im) > tolerance) converged = 0;
        }
        for (uint32_t index = 0; index < degree; ++index) roots[index] = next[index];
        if (converged) break;
    }
    free(normalized); free(next);
    return (int32_t)degree;
}

int32_t ce_analyze_contour(const ce_map_config *config, const ce_complex *points,
                           uint32_t point_count, ce_complex *integral,
                           double *winding, uint32_t *status) {
    if (!config || !points || point_count < 2u || !integral || !winding || !status) return -1;
    *integral = (ce_complex){0.0, 0.0};
    *winding = 0.0;
    *status = 0u;
    ce_complex previous_point = {NAN, NAN}, previous_value = {NAN, NAN};
    int has_previous = 0;
    for (uint32_t index = 0; index < point_count; ++index) {
        const ce_complex point = points[index];
        if (!isfinite(point.re) || !isfinite(point.im)) { has_previous = 0; continue; }
        ce_complex value;
        if (!ce_analysis_value(config, point, &value)) { *status |= 1u; return 0; }
        if (hypot(value.re, value.im) < 1e-9) { *status |= 2u; return 0; }
        if (has_previous) {
            const ce_complex average = {(previous_value.re + value.re) * 0.5,
                                        (previous_value.im + value.im) * 0.5};
            const ce_complex delta = ce_sub(point, previous_point);
            *integral = ce_add(*integral, ce_mul(average, delta));
            double angle_change = atan2(value.im, value.re) - atan2(previous_value.im, previous_value.re);
            if (angle_change > 3.14159265358979323846) angle_change -= 6.28318530717958647693;
            if (angle_change < -3.14159265358979323846) angle_change += 6.28318530717958647693;
            *winding += angle_change;
        }
        previous_point = point;
        previous_value = value;
        has_previous = 1;
    }
    *winding /= 6.28318530717958647693;
    return 0;
}

int32_t ce_estimate_residue(const ce_map_config *config, double pole_re, double pole_im,
                            double radius, uint32_t samples, ce_complex *residue) {
    if (!config || !residue || !isfinite(pole_re) || !isfinite(pole_im) ||
        !isfinite(radius) || radius <= 0.0 || samples < 8u) return -1;
    ce_complex integral = {0.0, 0.0};
    ce_complex previous_point, previous_value;
    for (uint32_t index = 0; index <= samples; ++index) {
        const double angle = (double)index / samples * 6.28318530717958647693;
        const ce_complex point = {pole_re + radius * cos(angle), pole_im + radius * sin(angle)};
        ce_complex value;
        if (!ce_analysis_value(config, point, &value)) return -2;
        if (index) {
            const ce_complex average = {(previous_value.re + value.re) * 0.5,
                                        (previous_value.im + value.im) * 0.5};
            integral = ce_add(integral, ce_mul(average, ce_sub(point, previous_point)));
        }
        previous_point = point;
        previous_value = value;
    }
    residue->re = integral.im / 6.28318530717958647693;
    residue->im = -integral.re / 6.28318530717958647693;
    return 0;
}

int32_t ce_generate_contour_points(uint32_t type, double cx, double cy,
                                   double param_a, double param_b,
                                   uint32_t step_count, ce_complex *output) {
    if (!output || step_count < 1u) return -1;
    const double step_angle = 6.28318530717958647693 / (double)step_count;
    if (type == 1u) { // circle
        if (param_a <= 0.0) return -2;
        for (uint32_t i = 0; i <= step_count; ++i) {
            const double angle = (double)i * step_angle;
            output[i] = (ce_complex){cx + param_a * cos(angle), cy + param_a * sin(angle)};
        }
        return (int32_t)(step_count + 1u);
    }
    if (type == 2u) { // ellipse
        if (param_a <= 0.0 || param_b <= 0.0) return -2;
        for (uint32_t i = 0; i <= step_count; ++i) {
            const double angle = (double)i * step_angle;
            output[i] = (ce_complex){cx + param_a * cos(angle), cy + param_b * sin(angle)};
        }
        return (int32_t)(step_count + 1u);
    }
    return -3;
}

static int ce_inside_polygon(ce_complex point, const ce_complex *points, uint32_t count) {
    int inside = 0;
    for (uint32_t index = 0, previous = count - 1u; index < count; previous = index, ++index) {
        const ce_complex a = points[index];
        const ce_complex b = points[previous];
        if ((a.im > point.im) != (b.im > point.im)) {
            const double denominator = (b.im - a.im) != 0.0 ? (b.im - a.im) : 1e-30;
            if (point.re < (b.re - a.re) * (point.im - a.im) / denominator + a.re) {
                inside = !inside;
            }
        }
    }
    return inside;
}

int32_t ce_classify_contour_singularities(uint32_t contour_type, double cx, double cy,
                                          double param_a, double param_b,
                                          const ce_complex *polygon_points,
                                          const uint32_t *polygon_offsets,
                                          uint32_t polygon_count,
                                          double epsilon,
                                          const ce_complex *singularities,
                                          uint32_t singularity_count,
                                          uint8_t *inside_results,
                                          uint8_t *safe_results) {
    if (!singularities || !inside_results || !safe_results) return -1;

    for (uint32_t s = 0; s < singularity_count; ++s) {
        const ce_complex pole = singularities[s];
        if (!isfinite(pole.re) || !isfinite(pole.im)) {
            inside_results[s] = 0u;
            safe_results[s] = 0u;
            continue;
        }

        if (contour_type == 1u) { // circle
            if (param_a <= 0.0) { inside_results[s] = 0u; safe_results[s] = 0u; continue; }
            const double dist_sq = (pole.re - cx) * (pole.re - cx) + (pole.im - cy) * (pole.im - cy);
            const double dist = sqrt(dist_sq);
            const int inside = dist < param_a * (1.0 - 1e-9);
            const int safe = dist < (param_a - epsilon);
            inside_results[s] = (uint8_t)inside;
            safe_results[s] = (uint8_t)(inside && safe);
        } else if (contour_type == 2u) { // ellipse
            if (param_a <= 0.0 || param_b <= 0.0) { inside_results[s] = 0u; safe_results[s] = 0u; continue; }
            const double dx = (pole.re - cx) / param_a;
            const double dy = (pole.im - cy) / param_b;
            const double dist_norm_sq = dx * dx + dy * dy;
            const int inside = dist_norm_sq < (1.0 - 1e-9);
            const double min_axis = param_a < param_b ? param_a : param_b;
            const double effective_eps = epsilon / min_axis;
            const double safe_threshold = (1.0 - effective_eps);
            const int safe = dist_norm_sq < (safe_threshold > 0.0 ? safe_threshold * safe_threshold : 0.0);
            inside_results[s] = (uint8_t)inside;
            safe_results[s] = (uint8_t)(inside && safe);
        } else if (contour_type == 3u) { // polygon contours
            if (!polygon_points || !polygon_offsets || !polygon_count) {
                inside_results[s] = 0u; safe_results[s] = 0u; continue;
            }
            int inside = 0;
            int safe = 1;
            for (uint32_t p = 0; p < polygon_count; ++p) {
                const uint32_t start = polygon_offsets[p];
                const uint32_t end = polygon_offsets[p + 1u];
                if (end <= start + 2u) continue;
                const uint32_t count = end - start;
                if (ce_inside_polygon(pole, polygon_points + start, count)) {
                    inside = !inside;
                }
                for (uint32_t i = 1; i < count; ++i) {
                    const ce_complex a = polygon_points[start + i - 1u];
                    const ce_complex b = polygon_points[start + i];
                    const double seg_dx = b.re - a.re;
                    const double seg_dy = b.im - a.im;
                    const double len_sq = seg_dx * seg_dx + seg_dy * seg_dy;
                    double t = 0.0;
                    if (len_sq > 1e-15) {
                        t = ((pole.re - a.re) * seg_dx + (pole.im - a.im) * seg_dy) / len_sq;
                        if (t < 0.0) t = 0.0;
                        else if (t > 1.0) t = 1.0;
                    }
                    const double proj_x = a.re + t * seg_dx;
                    const double proj_y = a.im + t * seg_dy;
                    const double d = hypot(pole.re - proj_x, pole.im - proj_y);
                    if (d <= epsilon) {
                        safe = 0;
                    }
                }
            }
            inside_results[s] = (uint8_t)inside;
            safe_results[s] = (uint8_t)(inside && safe);
        } else {
            inside_results[s] = 0u;
            safe_results[s] = 0u;
        }
    }
    return 0;
}

