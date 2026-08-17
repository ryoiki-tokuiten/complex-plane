#include "complex_engine.h"

#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#define CE_SPHERE_MAX_CHORD_SQ (0.75 * 0.75)
#define CE_SPHERE_CURVE_TOLERANCE_SQ (1.5 * 1.5)
#define CE_SPHERE_MAX_DEPTH 8u
#define CE_PI 3.14159265358979323846264338327950288

typedef struct {
    ce_complex source;
    double x;
    double y;
    double z;
    double canvas_x;
    double canvas_y;
    uint8_t valid;
    uint8_t visible;
} ce_sphere_sample;

typedef struct {
    const ce_map_config *config;
    uint32_t map_points;
    double center_x;
    double center_y;
    double radius;
    double cos_x;
    double sin_x;
    double cos_y;
    double sin_y;
    float *output;
    uint32_t capacity;
    uint32_t count;
    uint32_t path_open;
    uint32_t failed;
    ce_sphere_sample previous;
    uint32_t has_previous;
} ce_sphere_job;

static int finite_complex(ce_complex value) {
    return isfinite(value.re) && isfinite(value.im);
}

static void stereographic(ce_complex value, double *x, double *y, double *z) {
    const double scale = fmax(fabs(value.re), fabs(value.im));
    if (scale == 0.0) {
        *x = 0.0;
        *y = 0.0;
        *z = -1.0;
        return;
    }
    if (scale <= 1.0) {
        const double radius_sq = value.re * value.re + value.im * value.im;
        const double denominator = radius_sq + 1.0;
        *x = 2.0 * value.re / denominator;
        *y = 2.0 * value.im / denominator;
        *z = (radius_sq - 1.0) / denominator;
        return;
    }
    const double inverse_scale = 1.0 / scale;
    const double normalized_re = value.re * inverse_scale;
    const double normalized_im = value.im * inverse_scale;
    const double inverse_scale_sq = inverse_scale * inverse_scale;
    const double normalized_radius_sq = normalized_re * normalized_re + normalized_im * normalized_im;
    const double denominator = normalized_radius_sq + inverse_scale_sq;
    *x = 2.0 * normalized_re * inverse_scale / denominator;
    *y = 2.0 * normalized_im * inverse_scale / denominator;
    *z = (normalized_radius_sq - inverse_scale_sq) / denominator;
}

static ce_sphere_sample sample_at(const ce_sphere_job *job, ce_complex source) {
    ce_sphere_sample sample = {0};
    sample.source = source;
    if (!finite_complex(source)) return sample;
    ce_complex value = source;
    if (job->map_points) {
        uint8_t valid = 0;
        if (!job->config || ce_evaluate_points(job->config, &source, 1u, &value, &valid) != 0 || !valid) {
            return sample;
        }
    }
    if (!finite_complex(value)) return sample;

    double x, y, z;
    stereographic(value, &x, &y, &z);
    const double rotated_x = x * job->cos_y + z * job->sin_y;
    const double first_z = -x * job->sin_y + z * job->cos_y;
    const double rotated_y = y * job->cos_x - first_z * job->sin_x;
    const double rotated_z = y * job->sin_x + first_z * job->cos_x;
    sample.x = rotated_x;
    sample.y = rotated_y;
    sample.z = rotated_z;
    sample.canvas_x = job->center_x + rotated_x * job->radius;
    sample.canvas_y = job->center_y - rotated_y * job->radius;
    sample.valid = isfinite(sample.x) && isfinite(sample.y) && isfinite(sample.z) &&
        isfinite(sample.canvas_x) && isfinite(sample.canvas_y);
    sample.visible = sample.valid && sample.z >= 0.0;
    return sample;
}

static double chord_squared(const ce_sphere_sample *a, const ce_sphere_sample *b) {
    const double dx = b->x - a->x;
    const double dy = b->y - a->y;
    const double dz = b->z - a->z;
    return dx * dx + dy * dy + dz * dz;
}

static ce_sphere_sample midpoint(const ce_sphere_job *job,
                                 const ce_sphere_sample *a, const ce_sphere_sample *b) {
    const ce_complex source = {
        a->source.re * 0.5 + b->source.re * 0.5,
        a->source.im * 0.5 + b->source.im * 0.5
    };
    return sample_at(job, source);
}

static int append_token(ce_sphere_job *job, const ce_sphere_sample *sample) {
    if (job->count >= job->capacity) {
        job->failed = 1u;
        return 0;
    }
    const uint32_t offset = job->count++ * 3u;
    job->output[offset] = (float)sample->canvas_x;
    job->output[offset + 1u] = (float)sample->canvas_y;
    job->output[offset + 2u] = (float)fmax(0.0, sample->z);
    return 1;
}

static void finish_path(ce_sphere_job *job) {
    if (!job->path_open || job->failed) return;
    if (job->count >= job->capacity) {
        job->failed = 1u;
        return;
    }
    const uint32_t offset = job->count++ * 3u;
    job->output[offset] = NAN;
    job->output[offset + 1u] = NAN;
    job->output[offset + 2u] = 0.0f;
    job->path_open = 0u;
}

static void begin_path(ce_sphere_job *job, const ce_sphere_sample *sample) {
    if (append_token(job, sample)) job->path_open = 1u;
}

static ce_sphere_sample limb_intersection(const ce_sphere_job *job,
                                          ce_sphere_sample low, ce_sphere_sample high) {
    const uint8_t low_visible = low.visible;
    for (uint32_t iteration = 0; iteration < 32u; ++iteration) {
        ce_sphere_sample middle = midpoint(job, &low, &high);
        if (!middle.valid) {
            middle.valid = 0u;
            return middle;
        }
        if (middle.visible == low_visible) low = middle;
        else high = middle;
    }
    ce_sphere_sample middle = midpoint(job, &low, &high);
    return middle.valid ? middle : high;
}

static void consume(ce_sphere_job *job, const ce_sphere_sample *current) {
    if (job->failed) return;
    if (!current || !current->valid) {
        finish_path(job);
        job->has_previous = 0u;
        return;
    }
    if (!job->has_previous) {
        if (current->visible) begin_path(job, current);
        job->previous = *current;
        job->has_previous = 1u;
        return;
    }
    const ce_sphere_sample previous = job->previous;
    const int continuous = chord_squared(&previous, current) <= CE_SPHERE_MAX_CHORD_SQ;
    if (!continuous) {
        finish_path(job);
        if (current->visible) begin_path(job, current);
    } else if (previous.visible && current->visible) {
        if (!job->path_open) begin_path(job, &previous);
        append_token(job, current);
    } else if (previous.visible && !current->visible) {
        const ce_sphere_sample limb = limb_intersection(job, previous, *current);
        if (limb.valid && job->path_open) append_token(job, &limb);
        finish_path(job);
    } else if (!previous.visible && current->visible) {
        const ce_sphere_sample limb = limb_intersection(job, previous, *current);
        finish_path(job);
        if (limb.valid) {
            begin_path(job, &limb);
            append_token(job, current);
        } else begin_path(job, current);
    } else finish_path(job);
    job->previous = *current;
    job->has_previous = 1u;
}

static int should_subdivide(const ce_sphere_sample *a, const ce_sphere_sample *b,
                            const ce_sphere_sample *middle) {
    if (a->visible == b->visible && a->visible != middle->visible) return 1;
    if (chord_squared(a, b) > CE_SPHERE_MAX_CHORD_SQ) return 1;
    const double error_x = middle->canvas_x - (a->canvas_x + b->canvas_x) * 0.5;
    const double error_y = middle->canvas_y - (a->canvas_y + b->canvas_y) * 0.5;
    return error_x * error_x + error_y * error_y > CE_SPHERE_CURVE_TOLERANCE_SQ;
}

static void collect_segment(ce_sphere_job *job, const ce_sphere_sample *a,
                            const ce_sphere_sample *b, uint32_t depth) {
    if (job->failed) return;
    if (depth >= CE_SPHERE_MAX_DEPTH) {
        if (chord_squared(a, b) > CE_SPHERE_MAX_CHORD_SQ) consume(job, NULL);
        consume(job, b);
        return;
    }
    const ce_sphere_sample middle = midpoint(job, a, b);
    if (!middle.valid) {
        consume(job, NULL);
        consume(job, b);
        return;
    }
    if (should_subdivide(a, b, &middle)) {
        collect_segment(job, a, &middle, depth + 1u);
        collect_segment(job, &middle, b, depth + 1u);
    } else consume(job, b);
}

static void initialize_job(ce_sphere_job *job, const ce_map_config *config, uint32_t map_points,
                           double center_x, double center_y, double radius,
                           double rotation_x, double rotation_y,
                           float *output, uint32_t capacity) {
    *job = (ce_sphere_job){0};
    job->config = config;
    job->map_points = map_points;
    job->center_x = center_x;
    job->center_y = center_y;
    job->radius = radius;
    job->cos_x = cos(rotation_x);
    job->sin_x = sin(rotation_x);
    job->cos_y = cos(rotation_y);
    job->sin_y = sin(rotation_y);
    job->output = output;
    job->capacity = capacity;
}

int32_t ce_build_sphere_lines(const ce_map_config *config,
                              const ce_complex *source_points, const uint32_t *source_offsets,
                              uint32_t line_count, uint32_t map_points,
                              double center_x, double center_y, double radius,
                              double rotation_x, double rotation_y,
                              float *output, uint32_t output_capacity,
                              uint32_t *line_offsets) {
    if (!source_points || !source_offsets || !output || !line_offsets || !output_capacity ||
        (map_points && !config) || !isfinite(radius) || radius <= 0.0) return -1;
    ce_sphere_job job;
    initialize_job(&job, config, map_points, center_x, center_y, radius,
                   rotation_x, rotation_y, output, output_capacity);
    line_offsets[0] = 0u;
    for (uint32_t line = 0; line < line_count; ++line) {
        job.path_open = 0u;
        job.has_previous = 0u;
        for (uint32_t index = source_offsets[line]; index < source_offsets[line + 1u]; ++index) {
            const ce_sphere_sample current = sample_at(&job, source_points[index]);
            if (!current.valid) {
                consume(&job, NULL);
                continue;
            }
            if (job.has_previous) collect_segment(&job, &job.previous, &current, 0u);
            else consume(&job, &current);
        }
        finish_path(&job);
        if (job.failed) return -2;
        line_offsets[line + 1u] = job.count;
    }
    return (int32_t)job.count;
}

int32_t ce_project_sphere_points(const ce_map_config *config,
                                 const ce_complex *source_points, uint32_t point_count,
                                 uint32_t map_points,
                                 double center_x, double center_y, double radius,
                                 double rotation_x, double rotation_y,
                                 float *positions, uint8_t *visible) {
    if (!source_points || !positions || !visible || (map_points && !config) || radius <= 0.0) return -1;
    ce_sphere_job job;
    initialize_job(&job, config, map_points, center_x, center_y, radius,
                   rotation_x, rotation_y, NULL, 0u);
    for (uint32_t index = 0; index < point_count; ++index) {
        const ce_sphere_sample sample = sample_at(&job, source_points[index]);
        positions[index * 2u] = sample.valid ? (float)sample.canvas_x : NAN;
        positions[index * 2u + 1u] = sample.valid ? (float)sample.canvas_y : NAN;
        visible[index] = sample.visible;
    }
    return 0;
}

int32_t ce_build_sphere_probe(const ce_map_config *config,
                              double source_re, double source_im, double neighborhood_size,
                              double crosshair_factor, uint32_t map_points,
                              double center_x, double center_y, double radius,
                              double rotation_x, double rotation_y,
                              float center_position[2], uint8_t *center_visible,
                              float *output, uint32_t output_capacity,
                              uint32_t line_offsets[4]) {
    if (!center_position || !center_visible || !output || !line_offsets ||
        !isfinite(neighborhood_size) || neighborhood_size < 0.0 || crosshair_factor <= 0.0) return -1;
    ce_complex points[35];
    for (uint32_t index = 0; index <= 30u; ++index) {
        const double angle = (double)index / 30.0 * 2.0 * CE_PI;
        points[index] = (ce_complex){source_re + neighborhood_size * cos(angle),
                                     source_im + neighborhood_size * sin(angle)};
    }
    const double segment = neighborhood_size / crosshair_factor;
    points[31] = (ce_complex){source_re - segment, source_im};
    points[32] = (ce_complex){source_re + segment, source_im};
    points[33] = (ce_complex){source_re, source_im - segment};
    points[34] = (ce_complex){source_re, source_im + segment};
    const uint32_t offsets[4] = {0u, 31u, 33u, 35u};
    const ce_complex center = {source_re, source_im};
    int32_t status = ce_project_sphere_points(config, &center, 1u, map_points,
        center_x, center_y, radius, rotation_x, rotation_y, center_position, center_visible);
    if (status != 0) return status;
    return ce_build_sphere_lines(config, points, offsets, 3u, map_points,
        center_x, center_y, radius, rotation_x, rotation_y,
        output, output_capacity, line_offsets);
}

static void riemann_coordinate(ce_complex value, double scale, double radius, float output[3]) {
    if (!finite_complex(value)) {
        output[0] = NAN;
        output[1] = NAN;
        output[2] = NAN;
        return;
    }
    const double u = value.re * scale;
    const double v = value.im * scale;
    const double radius_sq = radius * radius;
    const double value_sq = u * u + v * v;
    const double denominator = value_sq + 4.0 * radius_sq + 1e-10;
    output[0] = (float)(4.0 * radius_sq * u / denominator);
    output[1] = (float)(2.0 * radius * value_sq / denominator);
    output[2] = (float)(4.0 * radius_sq * v / denominator);
}

int32_t ce_build_riemann_sphere_targets(const ce_map_config *config,
                                        const ce_complex *source_points, uint32_t point_count,
                                        uint32_t map_points, double scale, double radius,
                                        float *start_positions, float *target_positions) {
    if (!source_points || !start_positions || !target_positions ||
        (map_points && !config) || scale <= 0.0 || radius <= 0.0) return -1;
    for (uint32_t index = 0; index < point_count; ++index) {
        ce_complex value = source_points[index];
        uint8_t valid = finite_complex(value);
        if (valid && map_points) {
            valid = 0u;
            if (ce_evaluate_points(config, &source_points[index], 1u, &value, &valid) != 0) return -2;
        }
        float *start = start_positions + index * 3u;
        float *target = target_positions + index * 3u;
        if (!valid || !finite_complex(value)) {
            start[0] = start[1] = start[2] = NAN;
            target[0] = target[1] = target[2] = NAN;
            continue;
        }
        start[0] = (float)(value.re * scale);
        start[1] = 0.0f;
        start[2] = (float)(value.im * scale);
        riemann_coordinate(value, scale, radius, target);
    }
    return 0;
}

int32_t ce_interpolate_geometry(const float *start_positions, const float *target_positions,
                                uint32_t float_count, double progress, float *output) {
    if (!start_positions || !target_positions || !output || !isfinite(progress)) return -1;
    const double eased = -(cos(CE_PI * progress) - 1.0) * 0.5;
    for (uint32_t index = 0; index < float_count; ++index) {
        output[index] = (float)(start_positions[index] +
            (target_positions[index] - start_positions[index]) * eased);
    }
    return 0;
}

int32_t ce_build_riemann_sphere_positions(const ce_complex *points, uint32_t point_count,
                                          double scale, double radius, float *positions) {
    if (!points || !positions || scale <= 0.0 || radius <= 0.0) return -1;
    for (uint32_t index = 0; index < point_count; ++index) {
        riemann_coordinate(points[index], scale, radius, positions + index * 3u);
    }
    return 0;
}

int32_t ce_build_riemann_probe(const ce_map_config *config, double re, double im,
                               uint32_t map_point, double scale, double radius,
                               double progress, float active[3], float sphere[3], float ray[6]) {
    if (!active || !sphere || !ray || !isfinite(re) || !isfinite(im) || (map_point && !config) ||
        scale <= 0.0 || radius <= 0.0 || !isfinite(progress)) return -1;
    ce_complex value = {re, im};
    if (map_point) {
        uint8_t valid = 0u;
        if (ce_evaluate_points(config, &value, 1u, &value, &valid) != 0 ||
            !valid || !finite_complex(value)) return -2;
    }
    const float flat[3] = {(float)(value.re * scale), 0.0f, (float)(value.im * scale)};
    riemann_coordinate(value, scale, radius, sphere);
    const double eased = -(cos(CE_PI * progress) - 1.0) * 0.5;
    for (uint32_t axis = 0; axis < 3u; ++axis) {
        active[axis] = (float)(flat[axis] + (sphere[axis] - flat[axis]) * eased);
    }
    ray[0] = 0.0f;
    ray[1] = (float)(radius * 2.0);
    ray[2] = 0.0f;
    ray[3] = flat[0];
    ray[4] = 0.0f;
    ray[5] = flat[2];
    return 0;
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
        if (!finite_complex(roots[index]) ||
            ce_evaluate_points(config, &roots[index], 1u, &mapped, &valid) != 0 ||
            !valid || !finite_complex(mapped)) continue;
        positions[count * 3u] = (float)((mapped.re - mapped_center_x) * scale);
        positions[count * 3u + 1u] = (float)((roots[index].re - source_center) * scale * height_scale);
        positions[count * 3u + 2u] = (float)((mapped.im - mapped_center_y) * scale);
        ++count;
    }
    return (int32_t)count;
}
