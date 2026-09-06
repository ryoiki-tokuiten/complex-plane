#include "complex_engine.h"

#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#define CE_CROSSING_EPSILON 1e-9

static int finite_point(ce_complex value) {
    return isfinite(value.re) && isfinite(value.im);
}

static int usable_point(ce_complex value, double render_limit) {
    return finite_point(value) && fabs(value.re) <= render_limit && fabs(value.im) <= render_limit;
}

static int ray_crossing(ce_complex a, ce_complex b, double angle) {
    const double cosine = cos(angle);
    const double sine = sin(angle);
    const double ar = a.re * cosine + a.im * sine;
    const double ai = -a.re * sine + a.im * cosine;
    const double br = b.re * cosine + b.im * sine;
    const double bi = -b.re * sine + b.im * cosine;
    const double delta = bi - ai;
    if (fabs(delta) <= CE_CROSSING_EPSILON) return 0;
    const double t = -ai / delta;
    if (t <= CE_CROSSING_EPSILON || t > 1.0 + CE_CROSSING_EPSILON) return 0;
    return ar + (br - ar) * t > CE_CROSSING_EPSILON;
}

static int crosses_cut(ce_complex a, ce_complex b, double angle) {
    return ray_crossing(a, b, angle);
}



static int append_point(ce_complex *output, uint32_t capacity, uint32_t *count, ce_complex value) {
    if (*count >= capacity) return 0;
    output[(*count)++] = value;
    return 1;
}

static int append_separator(ce_complex *output, uint32_t capacity, uint32_t *count) {
    if (!*count) return 1;
    return append_point(output, capacity, count, (ce_complex){NAN, NAN});
}





typedef struct {
    const ce_map_config *config;
    double origin_x;
    double origin_y;
    double scale_x;
    double scale_y;
    double render_limit;
    double jump_threshold_sq;
    double tolerance_sq;
    double max_segment_sq;
    uint32_t max_depth;
    uint32_t has_branch_cuts;
    double branch_cut_angle;
    ce_complex *output;
    uint32_t capacity;
    uint32_t count;
    int open;
} adaptive_job;

static int map_one(const ce_map_config *config, ce_complex source, ce_complex *mapped) {
    uint8_t valid = 0;
    if (ce_evaluate_points(config, &source, 1, mapped, &valid) != 0) return 0;
    return valid && finite_point(*mapped);
}

static ce_complex canvas_point(const adaptive_job *job, ce_complex mapped) {
    return (ce_complex){job->origin_x + mapped.re * job->scale_x,
                        job->origin_y - mapped.im * job->scale_y};
}

static int adaptive_append(adaptive_job *job, ce_complex point) {
    if (!job->open && job->count && !append_separator(job->output, job->capacity, &job->count)) return 0;
    if (!append_point(job->output, job->capacity, &job->count, point)) return 0;
    job->open = 1;
    return 1;
}

static int adaptive_segment(adaptive_job *job,
                            ce_complex z0, ce_complex m0, ce_complex p0,
                            ce_complex z1, ce_complex m1, ce_complex p1,
                            uint32_t depth) {
    if (depth < job->max_depth) {
        const ce_complex mid_z = {(z0.re + z1.re) * 0.5, (z0.im + z1.im) * 0.5};
        if (job->has_branch_cuts && crosses_cut(z0, z1, job->branch_cut_angle)) {
            job->open = 0;
            return adaptive_append(job, p1);
        }
        ce_complex mid_mapped;
        if (!map_one(job->config, mid_z, &mid_mapped) || !usable_point(mid_mapped, job->render_limit)) {
            job->open = 0;
            return adaptive_append(job, p1);
        }
        const double d0_re = mid_mapped.re - m0.re, d0_im = mid_mapped.im - m0.im;
        const double d1_re = m1.re - mid_mapped.re, d1_im = m1.im - mid_mapped.im;
        if (d0_re * d0_re + d0_im * d0_im > job->jump_threshold_sq ||
            d1_re * d1_re + d1_im * d1_im > job->jump_threshold_sq) {
            job->open = 0;
            return adaptive_append(job, p1);
        }
        const ce_complex mid = canvas_point(job, mid_mapped);
        const double error_x = mid.re - (p0.re + p1.re) * 0.5;
        const double error_y = mid.im - (p0.im + p1.im) * 0.5;
        const double segment_x = p1.re - p0.re;
        const double segment_y = p1.im - p0.im;
        if (error_x * error_x + error_y * error_y > job->tolerance_sq ||
            segment_x * segment_x + segment_y * segment_y > job->max_segment_sq) {
            if (job->count + 4u >= job->capacity) return adaptive_append(job, p1);
            if (!adaptive_segment(job, z0, m0, p0, mid_z, mid_mapped, mid, depth + 1u)) return 0;
            return adaptive_segment(job, mid_z, mid_mapped, mid, z1, m1, p1, depth + 1u);
        }
    }
    return adaptive_append(job, p1);
}

int32_t ce_build_planar_polyline(const ce_map_config *config,
                                 const ce_complex *input, uint32_t input_count,
                                 double origin_x, double origin_y,
                                 double scale_x, double scale_y, double render_limit,
                                 double jump_threshold_sq, double tolerance_sq,
                                 double max_segment_sq, uint32_t max_depth,
                                 uint32_t has_branch_cuts, double branch_cut_angle,
                                 ce_complex *output, uint32_t output_capacity) {
    if (!config || !input || !input_count || !output || !output_capacity ||
        !isfinite(origin_x) || !isfinite(origin_y) ||
        !isfinite(scale_x) || scale_x == 0.0 || !isfinite(scale_y) || scale_y == 0.0 ||
        !isfinite(render_limit) || !(render_limit > 0.0) ||
        !isfinite(jump_threshold_sq) || jump_threshold_sq < 0.0 ||
        !isfinite(tolerance_sq) || tolerance_sq < 0.0 ||
        !isfinite(max_segment_sq) || !(max_segment_sq > 0.0) || max_depth > 20u ||
        has_branch_cuts > 1u || !isfinite(branch_cut_angle)) return -1;
    adaptive_job job = {config, origin_x, origin_y, scale_x, scale_y, render_limit,
                        jump_threshold_sq, tolerance_sq, max_segment_sq, max_depth,
                        has_branch_cuts, branch_cut_angle, output, output_capacity, 0, 0};
    int has_previous = 0;
    ce_complex previous_source = {0.0, 0.0};
    ce_complex previous_mapped = {0.0, 0.0};
    ce_complex previous_canvas = {0.0, 0.0};
    for (uint32_t index = 0; index < input_count; ++index) {
        const ce_complex source = input[index];
        ce_complex mapped;
        if (!finite_point(source) || !map_one(config, source, &mapped)) {
            has_previous = 0;
            job.open = 0;
            continue;
        }
        if (has_previous && has_branch_cuts && crosses_cut(previous_source, source, branch_cut_angle)) {
            has_previous = 0;
            job.open = 0;
        }
        if (!usable_point(mapped, render_limit)) {
            has_previous = 0;
            job.open = 0;
            continue;
        }
        const ce_complex point = canvas_point(&job, mapped);
        if (!has_previous) {
            if (!adaptive_append(&job, point)) return -3;
        } else if (!adaptive_segment(&job, previous_source, previous_mapped, previous_canvas, source, mapped, point, 0)) {
            return -3;
        }
        has_previous = 1;
        previous_source = source;
        previous_mapped = mapped;
        previous_canvas = point;
    }
    return (int32_t)job.count;
}
