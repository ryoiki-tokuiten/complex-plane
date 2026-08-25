#include "complex_engine.h"

#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#define CE_FOLD_RADIUS 5.0
#define CE_FOLD_MAX_DEPTH 12u
#define CE_FOLD_TOLERANCE_RATIO 0.00005
#define CE_FOLD_EXTRA_POINTS 2048u

typedef struct {
    double source_re;
    double mapped_re;
    double mapped_im;
} ce_fold_point;

typedef struct {
    ce_complex *values;
    uint8_t *valid;
    uint32_t count;
    uint32_t capacity;
} ce_fold_refined;

typedef struct {
    ce_fold_point *values;
    uint32_t count;
    uint32_t capacity;
    uint32_t *offsets;
    uint32_t *sets;
    uint32_t group_count;
    uint32_t group_capacity;
} ce_fold_groups;

static int ce_fold_map(const ce_map_config *config, ce_complex source, ce_complex *mapped) {
    uint8_t valid = 0u;
    return isfinite(source.re) && isfinite(source.im) &&
        ce_evaluate_points(config, &source, 1u, mapped, &valid) == 0 && valid &&
        isfinite(mapped->re) && isfinite(mapped->im);
}

static int ce_fold_visible(ce_complex point, double x_min, double x_max,
                           double y_min, double y_max) {
    return point.re >= x_min && point.re <= x_max && point.im >= y_min && point.im <= y_max;
}

static int ce_fold_refined_push(ce_fold_refined *refined, ce_complex value, uint8_t valid) {
    if (refined->count >= refined->capacity) return 0;
    refined->values[refined->count] = value;
    refined->valid[refined->count++] = valid;
    return 1;
}

static void ce_fold_refine(const ce_map_config *config, ce_fold_refined *refined,
                           ce_complex p0, ce_complex p1, ce_complex a, ce_complex b,
                           uint8_t a_valid, uint8_t b_valid,
                           double x_min, double x_max, double y_min, double y_max,
                           double jump_threshold_sq, double tolerance_sq,
                           uint32_t *budget, uint32_t depth) {
    if (!isfinite(p0.re) || !isfinite(p0.im) || !isfinite(p1.re) || !isfinite(p1.im)) {
        ce_fold_refined_push(refined, p1, 1u); return;
    }
    const ce_complex midpoint_source = {(p0.re + p1.re) * 0.5, (p0.im + p1.im) * 0.5};
    ce_complex midpoint;
    const uint8_t midpoint_valid = ce_fold_map(config, midpoint_source, &midpoint);
    const uint8_t visible_a = a_valid && ce_fold_visible(a, x_min, x_max, y_min, y_max);
    const uint8_t visible_b = b_valid && ce_fold_visible(b, x_min, x_max, y_min, y_max);
    const uint8_t visible_mid = midpoint_valid && ce_fold_visible(midpoint, x_min, x_max, y_min, y_max);
    const double dx = a.re - b.re, dy = a.im - b.im;
    const uint8_t jump = a_valid && b_valid && dx * dx + dy * dy > jump_threshold_sq;
    if (!midpoint_valid || visible_mid != visible_a || visible_mid != visible_b || jump ||
        (!visible_a && !visible_b && !visible_mid)) {
        ce_fold_refined_push(refined, (ce_complex){NAN, NAN}, 0u);
        ce_fold_refined_push(refined, p1, 1u);
        return;
    }
    const double error_re = midpoint.re - (a.re + b.re) * 0.5;
    const double error_im = midpoint.im - (a.im + b.im) * 0.5;
    if (error_re * error_re + error_im * error_im <= tolerance_sq || !*budget || depth >= CE_FOLD_MAX_DEPTH) {
        ce_fold_refined_push(refined, p1, 1u); return;
    }
    --*budget;
    ce_fold_refine(config, refined, p0, midpoint_source, a, midpoint, a_valid, 1u,
                   x_min, x_max, y_min, y_max, jump_threshold_sq, tolerance_sq, budget, depth + 1u);
    ce_fold_refine(config, refined, midpoint_source, p1, midpoint, b, 1u, b_valid,
                   x_min, x_max, y_min, y_max, jump_threshold_sq, tolerance_sq, budget, depth + 1u);
}

static int ce_fold_group_start(ce_fold_groups *groups, uint32_t point_set) {
    if (groups->group_count >= groups->group_capacity) return 0;
    groups->offsets[groups->group_count] = groups->count;
    groups->sets[groups->group_count++] = point_set;
    return 1;
}

static int ce_fold_group_point(ce_fold_groups *groups, ce_complex source, ce_complex mapped) {
    if (groups->count >= groups->capacity) return 0;
    groups->values[groups->count++] = (ce_fold_point){source.re, mapped.re, mapped.im};
    return 1;
}

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
                           uint32_t stats[4], double mapping[4]) {
    if (!config || !source_points || !source_offsets || !point_roles || !point_set_count ||
        !line_positions || !line_offsets || !line_point_sets || !point_positions ||
        !point_offsets || !point_point_sets || !stats || !mapping) return -1;
    const uint32_t source_count = source_offsets[point_set_count];
    const uint32_t refined_capacity = source_count + point_set_count * CE_FOLD_EXTRA_POINTS * 2u + 8u;
    ce_fold_refined refined = {
        malloc(refined_capacity * sizeof(ce_complex)), malloc(refined_capacity), 0u, refined_capacity
    };
    ce_fold_groups lines = {
        malloc(line_position_capacity * sizeof(ce_fold_point)), 0u, line_position_capacity,
        malloc((line_position_capacity + 1u) * sizeof(uint32_t)),
        malloc((line_position_capacity + 1u) * sizeof(uint32_t)), 0u, line_position_capacity
    };
    ce_fold_groups points = {
        malloc(point_position_capacity * sizeof(ce_fold_point)), 0u, point_position_capacity,
        malloc((point_set_count + 1u) * sizeof(uint32_t)),
        malloc((point_set_count + 1u) * sizeof(uint32_t)), 0u, point_set_count
    };
    if (!refined.values || !refined.valid || !lines.values || !lines.offsets || !lines.sets ||
        !points.values || !points.offsets || !points.sets) goto allocation_error;
    double min_mapped_x = INFINITY, max_mapped_x = -INFINITY;
    double min_mapped_y = INFINITY, max_mapped_y = -INFINITY;
    double min_source_x = INFINITY, max_source_x = -INFINITY;
    const double span_x = output_x_max - output_x_min;
    const double span_y = output_y_max - output_y_min;
    const double jump_threshold_sq = 4.0 * (span_x * span_x + span_y * span_y);
    const double tolerance_sq = pow(fmax(span_x, span_y) * CE_FOLD_TOLERANCE_RATIO, 2.0);

    for (uint32_t set = 0; set < point_set_count; ++set) {
        const uint32_t start = source_offsets[set], end = source_offsets[set + 1u];
        if (point_roles[set]) {
            const uint32_t group_start = points.count;
            if (!ce_fold_group_start(&points, set)) goto capacity_error;
            for (uint32_t index = start; index < end; ++index) {
                ce_complex mapped;
                if (!ce_fold_map(config, source_points[index], &mapped) ||
                    !ce_fold_visible(mapped, output_x_min, output_x_max, output_y_min, output_y_max)) continue;
                if (!ce_fold_group_point(&points, source_points[index], mapped)) goto capacity_error;
                min_mapped_x = fmin(min_mapped_x, mapped.re); max_mapped_x = fmax(max_mapped_x, mapped.re);
                min_mapped_y = fmin(min_mapped_y, mapped.im); max_mapped_y = fmax(max_mapped_y, mapped.im);
                min_source_x = fmin(min_source_x, source_points[index].re); max_source_x = fmax(max_source_x, source_points[index].re);
            }
            if (points.count == group_start) --points.group_count;
            continue;
        }
        if (end - start < 2u) continue;
        refined.count = 0u;
        ce_fold_refined_push(&refined, source_points[start], 1u);
        ce_complex previous_mapped = {NAN, NAN};
        uint8_t previous_valid = ce_fold_map(config, source_points[start], &previous_mapped);
        uint32_t budget = end - start < CE_FOLD_EXTRA_POINTS / 3u
            ? (end - start) * 3u : CE_FOLD_EXTRA_POINTS;
        for (uint32_t index = start + 1u; index < end; ++index) {
            ce_complex mapped = {NAN, NAN};
            const uint8_t valid = ce_fold_map(config, source_points[index], &mapped);
            ce_fold_refine(config, &refined, source_points[index - 1u], source_points[index],
                           previous_mapped, mapped, previous_valid, valid,
                           output_x_min, output_x_max, output_y_min, output_y_max,
                           jump_threshold_sq, tolerance_sq, &budget, 0u);
            previous_mapped = mapped; previous_valid = valid;
        }
        uint32_t current_start = lines.count;
        uint8_t group_open = 0u;
        for (uint32_t index = 0; index < refined.count; ++index) {
            ce_complex mapped;
            if (!refined.valid[index] || !ce_fold_map(config, refined.values[index], &mapped) ||
                !ce_fold_visible(mapped, output_x_min, output_x_max, output_y_min, output_y_max)) {
                if (group_open && lines.count - current_start < 2u) { lines.count = current_start; --lines.group_count; }
                group_open = 0u;
                continue;
            }
            if (!group_open) {
                if (!ce_fold_group_start(&lines, set)) goto capacity_error;
                current_start = lines.count; group_open = 1u;
            }
            if (!ce_fold_group_point(&lines, refined.values[index], mapped)) goto capacity_error;
            min_mapped_x = fmin(min_mapped_x, mapped.re); max_mapped_x = fmax(max_mapped_x, mapped.re);
            min_mapped_y = fmin(min_mapped_y, mapped.im); max_mapped_y = fmax(max_mapped_y, mapped.im);
            min_source_x = fmin(min_source_x, refined.values[index].re); max_source_x = fmax(max_source_x, refined.values[index].re);
        }
        if (group_open && lines.count - current_start < 2u) { lines.count = current_start; --lines.group_count; }
    }

    if (!lines.group_count && !points.group_count) {
        stats[0] = stats[1] = stats[2] = stats[3] = 0u;
        free(refined.values); free(refined.valid); free(lines.values); free(lines.offsets); free(lines.sets);
        free(points.values); free(points.offsets); free(points.sets); return 0;
    }
    const double source_center = (source_x_min + source_x_max) * 0.5;
    const double mapped_center_x = (min_mapped_x + max_mapped_x) * 0.5;
    const double mapped_center_y = (min_mapped_y + max_mapped_y) * 0.5;
    const double span = fmax(fmax(max_mapped_x - min_mapped_x, max_mapped_y - min_mapped_y),
                             fmax(source_x_max - source_x_min, 1e-6));
    const double scale = 2.0 * CE_FOLD_RADIUS / span;
    for (uint32_t index = 0; index < lines.count; ++index) {
        line_positions[index * 3u] = (float)((lines.values[index].mapped_re - mapped_center_x) * scale);
        line_positions[index * 3u + 1u] = (float)((lines.values[index].source_re - source_center) * scale * height_scale);
        line_positions[index * 3u + 2u] = (float)((lines.values[index].mapped_im - mapped_center_y) * scale);
    }
    for (uint32_t index = 0; index < points.count; ++index) {
        point_positions[index * 3u] = (float)((points.values[index].mapped_re - mapped_center_x) * scale);
        point_positions[index * 3u + 1u] = (float)((points.values[index].source_re - source_center) * scale * height_scale);
        point_positions[index * 3u + 2u] = (float)((points.values[index].mapped_im - mapped_center_y) * scale);
    }
    for (uint32_t group = 0; group < lines.group_count; ++group) {
        line_offsets[group] = lines.offsets[group]; line_point_sets[group] = lines.sets[group];
    }
    line_offsets[lines.group_count] = lines.count;
    for (uint32_t group = 0; group < points.group_count; ++group) {
        point_offsets[group] = points.offsets[group]; point_point_sets[group] = points.sets[group];
    }
    point_offsets[points.group_count] = points.count;
    stats[0] = lines.group_count; stats[1] = lines.count;
    stats[2] = points.group_count; stats[3] = points.count;
    mapping[0] = mapped_center_x; mapping[1] = mapped_center_y;
    mapping[2] = source_center; mapping[3] = scale;
    free(refined.values); free(refined.valid); free(lines.values); free(lines.offsets); free(lines.sets);
    free(points.values); free(points.offsets); free(points.sets); return 0;

capacity_error:
    free(refined.values); free(refined.valid); free(lines.values); free(lines.offsets); free(lines.sets);
    free(points.values); free(points.offsets); free(points.sets); return -3;
allocation_error:
    free(refined.values); free(refined.valid); free(lines.values); free(lines.offsets); free(lines.sets);
    free(points.values); free(points.offsets); free(points.sets); return -2;
}

int32_t ce_build_fold_preimage_markers(const ce_map_config *config,
                                       const ce_complex *roots, uint32_t root_count,
                                       double mapped_center_x, double mapped_center_y,
                                       double source_center, double scale, double height_scale,
                                       float *positions) {
    if (!config || !roots || !positions || !isfinite(scale) || scale == 0.0) return -1;
    uint32_t count = 0u;
    for (uint32_t index = 0; index < root_count; ++index) {
        ce_complex mapped;
        uint8_t valid = 0u;
        if (!isfinite(roots[index].re) || !isfinite(roots[index].im) ||
            ce_evaluate_points(config, &roots[index], 1u, &mapped, &valid) != 0 ||
            !valid || !isfinite(mapped.re) || !isfinite(mapped.im)) continue;
        positions[count * 3u] = (float)((mapped.re - mapped_center_x) * scale);
        positions[count * 3u + 1u] = (float)((roots[index].re - source_center) * scale * height_scale);
        positions[count * 3u + 2u] = (float)((mapped.im - mapped_center_y) * scale);
        ++count;
    }
    return (int32_t)count;
}
