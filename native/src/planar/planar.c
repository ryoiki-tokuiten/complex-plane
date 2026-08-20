#include "complex_engine.h"

#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#define CE_CROSSING_EPSILON 1e-9
#define CE_DEGENERATE_SEGMENT_EPSILON 1e-12

static ce_complex *ce_planar_scratch = NULL;
static uint32_t ce_planar_scratch_capacity = 0;

static int ensure_scratch(uint32_t count) {
    if (count <= ce_planar_scratch_capacity) return 1;
    uint32_t capacity = ce_planar_scratch_capacity ? ce_planar_scratch_capacity : 2048;
    while (capacity < count) {
        if (capacity > UINT32_MAX / 2u) return 0;
        capacity *= 2u;
    }
    ce_complex *next = (ce_complex *)realloc(ce_planar_scratch, (size_t)capacity * sizeof(ce_complex));
    if (!next) return 0;
    ce_planar_scratch = next;
    ce_planar_scratch_capacity = capacity;
    return 1;
}

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

static int segment_crossing(ce_complex a, ce_complex b, ce_complex c, ce_complex d) {
    if (!finite_point(a) || !finite_point(b) || !finite_point(c) || !finite_point(d)) return 0;
    const double path_re = b.re - a.re;
    const double path_im = b.im - a.im;
    const double cut_re = d.re - c.re;
    const double cut_im = d.im - c.im;
    const double denominator = path_re * cut_im - path_im * cut_re;
    if (fabs(denominator) <= CE_CROSSING_EPSILON) return 0;
    const double offset_re = c.re - a.re;
    const double offset_im = c.im - a.im;
    const double path_t = (offset_re * cut_im - offset_im * cut_re) / denominator;
    const double cut_t = (offset_re * path_im - offset_im * path_re) / denominator;
    return path_t > CE_CROSSING_EPSILON && path_t <= 1.0 + CE_CROSSING_EPSILON &&
        cut_t >= -CE_CROSSING_EPSILON && cut_t <= 1.0 + CE_CROSSING_EPSILON;
}

static int crosses_cut(ce_complex a, ce_complex b, uint32_t is_drawn, double angle,
                       const ce_complex *points, uint32_t point_count) {
    if (!is_drawn || !points || point_count < 2) return ray_crossing(a, b, angle);
    for (uint32_t index = 1; index < point_count; ++index) {
        if (segment_crossing(a, b, points[index - 1], points[index])) return 1;
    }
    return 0;
}

static int chord_fits(const ce_complex *source, uint32_t start, uint32_t end,
                      double scale_x, double scale_y, double tolerance_sq) {
    if (end <= start + 1u) return 1;
    const double ax = source[start].re * scale_x;
    const double ay = -source[start].im * scale_y;
    const double bx = source[end].re * scale_x;
    const double by = -source[end].im * scale_y;
    const double dx = bx - ax;
    const double dy = by - ay;
    const double length_sq = dx * dx + dy * dy;
    for (uint32_t index = start + 1u; index < end; ++index) {
        const double px = source[index].re * scale_x;
        const double py = -source[index].im * scale_y;
        double distance_sq;
        if (length_sq <= CE_DEGENERATE_SEGMENT_EPSILON) {
            const double ex = px - ax;
            const double ey = py - ay;
            distance_sq = ex * ex + ey * ey;
        } else {
            double t = ((px - ax) * dx + (py - ay) * dy) / length_sq;
            if (t < 0.0) t = 0.0;
            else if (t > 1.0) t = 1.0;
            const double ex = px - (ax + t * dx);
            const double ey = py - (ay + t * dy);
            distance_sq = ex * ex + ey * ey;
        }
        if (distance_sq > tolerance_sq) return 0;
    }
    return 1;
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

static int append_simplified_range(const ce_complex *source, uint32_t start, uint32_t end,
                                   double scale_x, double scale_y, double tolerance_sq,
                                   ce_complex *output, uint32_t capacity, uint32_t *count) {
    if (end < start) return 1;
    if (!append_point(output, capacity, count, source[start])) return 0;
    if (end == start) return 1;
    uint32_t block_start = start;
    while (block_start < end) {
        const uint32_t block_end = block_start + 32u < end ? block_start + 32u : end;
        if (chord_fits(source, block_start, block_end, scale_x, scale_y, tolerance_sq)) {
            if (!append_point(output, capacity, count, source[block_end])) return 0;
            block_start = block_end;
            continue;
        }
        uint32_t fine_start = block_start;
        while (fine_start < block_end) {
            const uint32_t fine_end = fine_start + 8u < block_end ? fine_start + 8u : block_end;
            if (chord_fits(source, fine_start, fine_end, scale_x, scale_y, tolerance_sq)) {
                if (!append_point(output, capacity, count, source[fine_end])) return 0;
            } else {
                for (uint32_t index = fine_start + 1u; index <= fine_end; ++index) {
                    if (!append_point(output, capacity, count, source[index])) return 0;
                }
            }
            fine_start = fine_end;
        }
        block_start = block_end;
    }
    return 1;
}

int32_t ce_build_planar_line(const ce_map_config *config,
                             double start_re, double start_im, double end_re, double end_im,
                             uint32_t sample_count,
                             double scale_x, double scale_y, double render_limit,
                             double jump_threshold_sq, double tolerance_sq,
                             uint32_t has_branch_cuts, uint32_t branch_cut_is_drawn,
                             double branch_cut_angle, const ce_complex *branch_cut_points,
                             uint32_t branch_cut_point_count, ce_complex *output,
                             uint32_t output_capacity) {
    if (!config || !output || !sample_count || sample_count > 1000000u ||
        !isfinite(start_re) || !isfinite(start_im) || !isfinite(end_re) || !isfinite(end_im) ||
        !isfinite(scale_x) || scale_x == 0.0 || !isfinite(scale_y) || scale_y == 0.0 ||
        !isfinite(render_limit) || !(render_limit > 0.0) ||
        !isfinite(jump_threshold_sq) || jump_threshold_sq < 0.0 ||
        !isfinite(tolerance_sq) || tolerance_sq < 0.0 ||
        has_branch_cuts > 1u || branch_cut_is_drawn > 1u || !isfinite(branch_cut_angle) ||
        (has_branch_cuts && branch_cut_is_drawn &&
         (!branch_cut_points || branch_cut_point_count < 2u)) ||
        !ensure_scratch(sample_count + 1u)) return -1;
    const ce_complex start = {start_re, start_im};
    const ce_complex end = {end_re, end_im};
    const uint32_t point_count = sample_count + 1u;
    const double step_re = (end.re - start.re) / sample_count;
    const double step_im = (end.im - start.im) / sample_count;
    for (uint32_t index = 0; index < point_count; ++index) {
        ce_planar_scratch[index] = index == sample_count
            ? end
            : (ce_complex){start.re + step_re * index, start.im + step_im * index};
    }
    if (ce_evaluate_points(config, ce_planar_scratch, point_count, ce_planar_scratch, NULL) != 0) return -2;

    uint32_t output_count = 0;
    int64_t run_start = -1;
    ce_complex previous = {0.0, 0.0};
    ce_complex previous_source = {0.0, 0.0};
    for (uint32_t index = 0; index <= point_count; ++index) {
        int usable = index < point_count;
        ce_complex mapped = {0.0, 0.0};
        ce_complex source = {0.0, 0.0};
        if (usable) {
            mapped = ce_planar_scratch[index];
            source = index == sample_count
                ? end
                : (ce_complex){start.re + step_re * index, start.im + step_im * index};
            usable = usable_point(mapped, render_limit);
            if (usable && run_start >= 0) {
                const double dre = mapped.re - previous.re;
                const double dim = mapped.im - previous.im;
                usable = dre * dre + dim * dim <= jump_threshold_sq &&
                    (!has_branch_cuts || !crosses_cut(previous_source, source, branch_cut_is_drawn,
                        branch_cut_angle, branch_cut_points, branch_cut_point_count));
            }
        }
        if (!usable) {
            if (run_start >= 0) {
                if (!append_separator(output, output_capacity, &output_count) ||
                    !append_simplified_range(ce_planar_scratch, (uint32_t)run_start, index - 1u,
                        scale_x, scale_y, tolerance_sq, output, output_capacity, &output_count)) return -3;
                run_start = -1;
            }
            if (index < point_count && usable_point(mapped, render_limit)) {
                run_start = index;
                previous = mapped;
                previous_source = source;
            }
            continue;
        }
        if (run_start < 0) run_start = index;
        previous = mapped;
        previous_source = source;
    }
    return (int32_t)output_count;
}

int32_t ce_build_planar_lines(const ce_map_config *config,
                              const ce_complex *starts, const ce_complex *ends,
                              const uint32_t *sample_counts, uint32_t line_count,
                              double scale_x, double scale_y, double render_limit,
                              double jump_threshold_sq, double tolerance_sq,
                              uint32_t has_branch_cuts, uint32_t branch_cut_is_drawn,
                              double branch_cut_angle, const ce_complex *branch_cut_points,
                              uint32_t branch_cut_point_count, ce_complex *output,
                              uint32_t output_capacity, uint32_t *line_offsets) {
    if (!config || !starts || !ends || !sample_counts || !line_count || !output || !line_offsets ||
        !isfinite(scale_x) || scale_x == 0.0 || !isfinite(scale_y) || scale_y == 0.0 ||
        !isfinite(render_limit) || !(render_limit > 0.0) ||
        !isfinite(jump_threshold_sq) || jump_threshold_sq < 0.0 ||
        !isfinite(tolerance_sq) || tolerance_sq < 0.0 || has_branch_cuts > 1u ||
        branch_cut_is_drawn > 1u || !isfinite(branch_cut_angle) ||
        (has_branch_cuts && branch_cut_is_drawn &&
         (!branch_cut_points || branch_cut_point_count < 2u))) return -1;
    uint32_t output_count = 0;
    line_offsets[0] = 0;
    for (uint32_t line = 0; line < line_count; ++line) {
        const int32_t count = ce_build_planar_line(
            config, starts[line].re, starts[line].im, ends[line].re, ends[line].im,
            sample_counts[line], scale_x, scale_y, render_limit, jump_threshold_sq,
            tolerance_sq, has_branch_cuts, branch_cut_is_drawn, branch_cut_angle,
            branch_cut_points, branch_cut_point_count, output + output_count,
            output_capacity - output_count
        );
        if (count < 0) return count;
        output_count += (uint32_t)count;
        line_offsets[line + 1u] = output_count;
    }
    return (int32_t)output_count;
}

typedef struct {
    const ce_map_config *config;
    double origin_x;
    double origin_y;
    double scale_x;
    double scale_y;
    double render_limit;
    double tolerance_sq;
    double max_segment_sq;
    uint32_t max_depth;
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
                            ce_complex z0, ce_complex p0, ce_complex z1, ce_complex p1,
                            uint32_t depth) {
    if (depth < job->max_depth) {
        const ce_complex mid_z = {(z0.re + z1.re) * 0.5, (z0.im + z1.im) * 0.5};
        ce_complex mid_mapped;
        if (!map_one(job->config, mid_z, &mid_mapped) || !usable_point(mid_mapped, job->render_limit)) {
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
            if (!adaptive_segment(job, z0, p0, mid_z, mid, depth + 1u)) return 0;
            return adaptive_segment(job, mid_z, mid, z1, p1, depth + 1u);
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
                                 uint32_t has_branch_cuts, uint32_t branch_cut_is_drawn,
                                 double branch_cut_angle, const ce_complex *branch_cut_points,
                                 uint32_t branch_cut_point_count, ce_complex *output,
                                 uint32_t output_capacity) {
    if (!config || !input || !input_count || !output || !output_capacity ||
        !isfinite(origin_x) || !isfinite(origin_y) ||
        !isfinite(scale_x) || scale_x == 0.0 || !isfinite(scale_y) || scale_y == 0.0 ||
        !isfinite(render_limit) || !(render_limit > 0.0) ||
        !isfinite(jump_threshold_sq) || jump_threshold_sq < 0.0 ||
        !isfinite(tolerance_sq) || tolerance_sq < 0.0 ||
        !isfinite(max_segment_sq) || !(max_segment_sq > 0.0) || max_depth > 20u ||
        has_branch_cuts > 1u || branch_cut_is_drawn > 1u || !isfinite(branch_cut_angle) ||
        (has_branch_cuts && branch_cut_is_drawn &&
         (!branch_cut_points || branch_cut_point_count < 2u))) return -1;
    adaptive_job job = {config, origin_x, origin_y, scale_x, scale_y, render_limit,
                        tolerance_sq, max_segment_sq, max_depth, output, output_capacity, 0, 0};
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
        if (has_previous && has_branch_cuts && crosses_cut(previous_source, source, branch_cut_is_drawn,
                branch_cut_angle, branch_cut_points, branch_cut_point_count)) {
            has_previous = 0;
            job.open = 0;
        }
        if (has_previous) {
            const double dre = mapped.re - previous_mapped.re;
            const double dim = mapped.im - previous_mapped.im;
            if (dre * dre + dim * dim > jump_threshold_sq) {
                has_previous = 0;
                job.open = 0;
            }
        }
        if (!usable_point(mapped, render_limit)) {
            has_previous = 0;
            job.open = 0;
            continue;
        }
        const ce_complex point = canvas_point(&job, mapped);
        if (!has_previous) {
            if (!adaptive_append(&job, point)) return -3;
        } else if (!adaptive_segment(&job, previous_source, previous_canvas, source, point, 0)) {
            return -3;
        }
        has_previous = 1;
        previous_source = source;
        previous_mapped = mapped;
        previous_canvas = point;
    }
    return (int32_t)job.count;
}
