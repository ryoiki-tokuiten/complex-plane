#include "complex_engine.h"
#include "expression_internal.h"

#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#define SHAPE_CARTESIAN 0u
#define SHAPE_POLAR 1u
#define SHAPE_LOG_POLAR 2u
#define SHAPE_LOG_CARTESIAN 3u
#define SHAPE_DOTS 4u
#define SHAPE_ARBITRARY_EXPRESSION 5u
#define SHAPE_ARBITRARY_DRAW 6u
#define SHAPE_LINE 7u
#define SHAPE_CIRCLE 8u
#define SHAPE_ELLIPSE 9u

#define ROLE_GRID_HORIZONTAL 1u
#define ROLE_GRID_VERTICAL 2u
#define ROLE_GRID_VERTICAL_ZETA 3u
#define ROLE_POLAR_ANGULAR 4u
#define ROLE_POLAR_RADIAL 5u
#define ROLE_LOG_POLAR_ANGULAR 6u
#define ROLE_LOG_POLAR_RADIAL 7u
#define ROLE_GRID_DOTS 8u
#define ROLE_ARBITRARY 9u
#define ROLE_LINE_HORIZONTAL 10u
#define ROLE_LINE_VERTICAL 11u
#define ROLE_SHAPE_CURVE 12u

#define SHAPE_TWO_PI 6.28318530717958647693
#define SHAPE_EPSILON 1e-9
#define SHAPE_MIN_RADIUS 0.1
#define SHAPE_LOG_MIN_RADIUS 0.05

typedef struct {
    ce_complex *points;
    uint32_t point_capacity;
    uint32_t point_count;
    uint32_t *offsets;
    uint32_t *roles;
    uint32_t line_capacity;
    uint32_t line_count;
} shape_output;

static ce_complex shape_point(double re, double im) {
    const ce_complex point = {re, im};
    return point;
}

static int finite_shape_point(ce_complex point) {
    return isfinite(point.re) && isfinite(point.im);
}

static int begin_line(shape_output *output, uint32_t role) {
    if (output->line_count >= output->line_capacity) return 0;
    output->offsets[output->line_count] = output->point_count;
    output->roles[output->line_count++] = role;
    return 1;
}

static int add_point(shape_output *output, ce_complex point) {
    if (output->point_count >= output->point_capacity) return 0;
    output->points[output->point_count++] = point;
    return 1;
}

static int add_segment(shape_output *output, uint32_t role,
                       double start_re, double start_im, double end_re, double end_im,
                       uint32_t segments) {
    if (!begin_line(output, role)) return 0;
    if (!segments) segments = 1u;
    const double step_re = (end_re - start_re) / segments;
    const double step_im = (end_im - start_im) / segments;
    for (uint32_t index = 0; index < segments; ++index) {
        if (!add_point(output, shape_point(start_re + step_re * index, start_im + step_im * index))) return 0;
    }
    return add_point(output, shape_point(end_re, end_im));
}

static int add_circle(shape_output *output, uint32_t role,
                      double center_re, double center_im, double radius_re, double radius_im,
                      uint32_t segments) {
    if (!begin_line(output, role)) return 0;
    if (!segments) segments = 1u;
    for (uint32_t index = 0; index <= segments; ++index) {
        const double angle = SHAPE_TWO_PI * index / segments;
        if (!add_point(output, shape_point(
            center_re + radius_re * cos(angle), center_im + radius_im * sin(angle)
        ))) return 0;
    }
    return 1;
}

static double maximum_visible_radius(double x_min, double x_max, double y_min, double y_max) {
    return fmax(SHAPE_MIN_RADIUS, fmax(fmax(fabs(x_min), fabs(x_max)), fmax(fabs(y_min), fabs(y_max))));
}

static int add_arbitrary_strokes(shape_output *output, const ce_complex *points,
                                 uint32_t count, uint32_t close_arbitrary) {
    uint32_t start = 0;
    while (start < count) {
        while (start < count && !finite_shape_point(points[start])) ++start;
        uint32_t end = start;
        while (end < count && finite_shape_point(points[end])) ++end;
        if (end - start >= 2u) {
            if (!begin_line(output, ROLE_ARBITRARY)) return 0;
            for (uint32_t index = start; index < end; ++index) {
                if (!add_point(output, points[index])) return 0;
            }
            if (close_arbitrary && end - start > 2u) {
                const ce_complex first = points[start];
                const ce_complex last = points[end - 1u];
                if (hypot(last.re - first.re, last.im - first.im) > SHAPE_EPSILON &&
                    !add_point(output, first)) return 0;
            }
        }
        start = end + 1u;
    }
    return 1;
}

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
                                ce_complex *points, uint32_t point_capacity,
                                uint32_t *line_offsets, uint32_t *line_roles,
                                uint32_t line_capacity, uint32_t stats[2]) {
    if (!config || !points || !line_offsets || !line_roles || !stats) return -1;
    if (!density) density = 1u;
    if (curve_points < 2u) curve_points = 2u;
    shape_output output = {points, point_capacity, 0u, line_offsets, line_roles, line_capacity, 0u};
    int ok = 1;
    if (shape == SHAPE_CARTESIAN) {
        const uint32_t samples = curve_points / 2u > 2u ? curve_points / 2u : 2u;
        for (uint32_t index = 0; ok && index <= density; ++index) {
            const double y = y_min + (y_max - y_min) * index / density;
            ok = add_segment(&output, ROLE_GRID_HORIZONTAL, x_min, y, x_max, y, samples);
        }
        for (uint32_t index = 0; ok && index <= density; ++index) {
            const double x = x_min + (x_max - x_min) * index / density;
            const uint32_t role = zeta_blocked && x <= 1.0 ? ROLE_GRID_VERTICAL_ZETA : ROLE_GRID_VERTICAL;
            ok = add_segment(&output, role, x, y_min, x, y_max, samples);
        }
    } else if (shape == SHAPE_POLAR || shape == SHAPE_LOG_POLAR) {
        const double max_radius = maximum_visible_radius(x_min, x_max, y_min, y_max);
        const uint32_t angular_count = density > 4u ? density : 4u;
        const double minimum_log = log(SHAPE_LOG_MIN_RADIUS);
        const double maximum_log = log(max_radius);
        for (uint32_t line = 0; ok && line < angular_count; ++line) {
            const double angle = SHAPE_TWO_PI * line / angular_count;
            if (shape == SHAPE_POLAR) {
                ok = add_segment(&output, ROLE_POLAR_ANGULAR, 0.0, 0.0,
                                 max_radius * cos(angle), max_radius * sin(angle), curve_points);
            } else {
                ok = begin_line(&output, ROLE_LOG_POLAR_ANGULAR);
                const double ratio = exp((maximum_log - minimum_log) / curve_points);
                double radius = exp(minimum_log);
                for (uint32_t point = 0; ok && point <= curve_points; ++point) {
                    ok = add_point(&output, shape_point(radius * cos(angle), radius * sin(angle)));
                    radius *= ratio;
                }
            }
        }
        const uint32_t circle_count = shape == SHAPE_POLAR ? density : density + 1u;
        const double ratio = exp((maximum_log - minimum_log) / density);
        double log_radius = exp(minimum_log);
        for (uint32_t index = 0; ok && index < circle_count; ++index) {
            const double radius = shape == SHAPE_POLAR
                ? max_radius * (index + 1u) / density : log_radius;
            ok = add_circle(&output, shape == SHAPE_POLAR ? ROLE_POLAR_RADIAL : ROLE_LOG_POLAR_RADIAL,
                            0.0, 0.0, radius, radius, curve_points);
            log_radius *= ratio;
        }
    } else if (shape == SHAPE_LOG_CARTESIAN) {
        const uint32_t samples = curve_points / 2u > 2u ? curve_points / 2u : 2u;
        const double x_limit = fmax(fmax(fabs(x_min), fabs(x_max)), SHAPE_LOG_MIN_RADIUS * 2.0);
        const double y_limit = fmax(fmax(fabs(y_min), fabs(y_max)), SHAPE_LOG_MIN_RADIUS * 2.0);
        for (uint32_t index = 0; ok && index <= density; ++index) {
            const double phase = (double)index / density;
            const double y = exp(log(SHAPE_LOG_MIN_RADIUS) + (log(y_limit) - log(SHAPE_LOG_MIN_RADIUS)) * phase);
            ok = add_segment(&output, ROLE_GRID_HORIZONTAL, x_min, y, x_max, y, samples) &&
                add_segment(&output, ROLE_GRID_HORIZONTAL, x_min, -y, x_max, -y, samples);
        }
        for (uint32_t index = 0; ok && index <= density; ++index) {
            const double phase = (double)index / density;
            const double x = exp(log(SHAPE_LOG_MIN_RADIUS) + (log(x_limit) - log(SHAPE_LOG_MIN_RADIUS)) * phase);
            ok =
                add_segment(&output, zeta_blocked && x <= 1.0 ? ROLE_GRID_VERTICAL_ZETA : ROLE_GRID_VERTICAL,
                            x, y_min, x, y_max, samples) &&
                add_segment(&output, zeta_blocked && -x <= 1.0 ? ROLE_GRID_VERTICAL_ZETA : ROLE_GRID_VERTICAL,
                            -x, y_min, -x, y_max, samples);
        }
    } else if (shape == SHAPE_DOTS) {
        ok = begin_line(&output, ROLE_GRID_DOTS);
        for (uint32_t row = 0; ok && row <= density; ++row) {
            const double im = y_min + (y_max - y_min) * row / density;
            for (uint32_t column = 0; ok && column <= density; ++column) {
                ok = add_point(&output, shape_point(x_min + (x_max - x_min) * column / density, im));
            }
        }
    } else if (shape == SHAPE_LINE) {
        ok = add_segment(&output, ROLE_LINE_HORIZONTAL, x_min, center_im, x_max, center_im, curve_points) &&
            add_segment(&output, ROLE_LINE_VERTICAL, center_re, y_min, center_re, y_max, curve_points);
    } else if (shape == SHAPE_CIRCLE || shape == SHAPE_ELLIPSE) {
        ok = add_circle(&output, ROLE_SHAPE_CURVE, center_re, center_im,
                        shape == SHAPE_CIRCLE ? circle_radius : ellipse_a,
                        shape == SHAPE_CIRCLE ? circle_radius : ellipse_b, curve_points);
    } else if (shape == SHAPE_ARBITRARY_DRAW) {
        if (draw_point_count && !draw_points) return -1;
        ok = add_arbitrary_strokes(&output, draw_points, draw_point_count, close_arbitrary);
    } else if (shape == SHAPE_ARBITRARY_EXPRESSION) {
        if (!expression || !expression_count || !isfinite(parameter_min) || !isfinite(parameter_max) ||
            parameter_min == parameter_max) {
            stats[0] = stats[1] = 0u;
            return 0;
        }
        uint32_t count = curve_points > density * 16u ? curve_points : density * 16u;
        if (count < 32u) count = 32u;
        ce_complex *evaluated = (ce_complex *)malloc((size_t)(count + 1u) * sizeof(ce_complex));
        if (!evaluated) return -2;
        for (uint32_t index = 0; index <= count; ++index) {
            const ce_complex variable = shape_point(parameter_min + (parameter_max - parameter_min) * index / count, 0.0);
            uint8_t error = 0;
            if (!ce_evaluate_expression_one(config, expression, expression_count, &variable, 1u, 0,
                                            &evaluated[index], &error)) {
                evaluated[index] = shape_point(NAN, NAN);
            }
        }
        ok = add_arbitrary_strokes(&output, evaluated, count + 1u, close_arbitrary);
        free(evaluated);
    } else {
        stats[0] = stats[1] = 0u;
        return 0;
    }
    if (!ok) return -3;
    output.offsets[output.line_count] = output.point_count;
    stats[0] = output.point_count;
    stats[1] = output.line_count;
    return 0;
}

int32_t ce_generate_radial_steps(const ce_map_config *config,
                                 double domain_min, double domain_max,
                                 uint32_t step_count, uint32_t curve_points,
                                 ce_complex *points, uint32_t point_capacity,
                                 uint32_t *line_offsets, uint32_t line_capacity,
                                 uint32_t stats[2]) {
    if (!config || !points || !line_offsets || !stats || step_count < 2u) return -1;
    if (curve_points < 24u) curve_points = 24u;
    shape_output output = {points, point_capacity, 0u, line_offsets, NULL, line_capacity, 0u};
    const double delta = domain_max - domain_min;
    for (uint32_t index = 0; index < step_count; ++index) {
        const double x = domain_min + delta * index / (step_count - 1u);
        if ((config->function_id == CE_FN_ZETA && fabs(x - 1.0) < SHAPE_EPSILON) ||
            (config->function_id == CE_FN_LN && x <= SHAPE_EPSILON)) continue;
        ce_complex mapped;
        uint8_t valid = 0;
        const ce_complex source = {x, 0.0};
        if (ce_evaluate_points(config, &source, 1u, &mapped, &valid) != 0 || !valid ||
            !finite_shape_point(mapped)) continue;
        const double radius = hypot(mapped.re, mapped.im);
        if (!(radius > 0.0)) continue;
        if (output.line_count >= output.line_capacity) return -3;
        output.offsets[output.line_count++] = output.point_count;
        for (uint32_t point = 0; point <= curve_points; ++point) {
            const double angle = SHAPE_TWO_PI * point / curve_points;
            if (!add_point(&output, shape_point(radius * cos(angle), radius * sin(angle)))) return -3;
        }
    }
    output.offsets[output.line_count] = output.point_count;
    stats[0] = output.point_count;
    stats[1] = output.line_count;
    return 0;
}

typedef struct {
    float *points;
    uint32_t point_capacity;
    uint32_t point_count;
    uint32_t *offsets;
    uint32_t *roles;
    uint32_t line_capacity;
    uint32_t line_count;
} pixel_shape_output;

static int pixel_line(pixel_shape_output *output, uint32_t role,
                      float start_x, float start_y, float end_x, float end_y,
                      uint32_t segments) {
    if (output->line_count >= output->line_capacity ||
        output->point_count + segments + 1u > output->point_capacity) return 0;
    output->offsets[output->line_count] = output->point_count;
    output->roles[output->line_count++] = role;
    for (uint32_t index = 0; index <= segments; ++index) {
        const float phase = (float)index / segments;
        output->points[output->point_count * 2u] = start_x + (end_x - start_x) * phase;
        output->points[output->point_count * 2u + 1u] = start_y + (end_y - start_y) * phase;
        ++output->point_count;
    }
    return 1;
}

int32_t ce_generate_viewport_grid_pixels(uint32_t shape, uint32_t density,
                                         uint32_t curve_points,
                                         uint32_t width, uint32_t height,
                                         float *points, uint32_t point_capacity,
                                         uint32_t *line_offsets, uint32_t *line_roles,
                                         uint32_t line_capacity, uint32_t stats[2]) {
    if (!points || !line_offsets || !line_roles || !stats || !width || !height) return -1;
    if (!density) density = 1u;
    pixel_shape_output output = {
        points, point_capacity, 0u, line_offsets, line_roles, line_capacity, 0u
    };
    if (shape == SHAPE_CARTESIAN) {
        const uint32_t samples = curve_points / 2u > 2u ? curve_points / 2u : 2u;
        for (uint32_t index = 0; index <= density; ++index) {
            const float y = (float)height * index / density;
            if (!pixel_line(&output, ROLE_GRID_HORIZONTAL, 0.0f, y, (float)width, y, samples)) return -3;
        }
        for (uint32_t index = 0; index <= density; ++index) {
            const float x = (float)width * index / density;
            if (!pixel_line(&output, ROLE_GRID_VERTICAL, x, 0.0f, x, (float)height, samples)) return -3;
        }
    } else if (shape == SHAPE_DOTS) {
        if (line_capacity < 1u || point_capacity < (density + 1u) * (density + 1u)) return -3;
        output.offsets[0] = 0u;
        output.roles[0] = ROLE_GRID_DOTS;
        output.line_count = 1u;
        for (uint32_t row = 0; row <= density; ++row) {
            for (uint32_t column = 0; column <= density; ++column) {
                output.points[output.point_count * 2u] = (float)width * column / density;
                output.points[output.point_count * 2u + 1u] = (float)height * row / density;
                ++output.point_count;
            }
        }
    } else return -1;
    output.offsets[output.line_count] = output.point_count;
    stats[0] = output.point_count;
    stats[1] = output.line_count;
    return 0;
}
