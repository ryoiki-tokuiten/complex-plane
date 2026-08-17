#include "complex_engine.h"
#include "domain_internal.h"

#include <math.h>

#define CE_PI 3.141592653589793238462643383279502884
#define CE_TWO_PI (2.0 * CE_PI)
#define CE_ESCAPE_RADIUS 1e4
#define CE_ESCAPE_RADIUS_SQ 1e8
#define CE_CHAIN_BAILOUT 1e8
#define CE_MAX_FINITE 1e30
#define CE_ATTRACTOR_EPSILON_SQ 1e-14

typedef struct {
    uint32_t event;
    uint32_t iteration;
    double smooth_iteration;
    ce_complex value;
    uint32_t has_value;
} ce_orbit_trace;

int ce_domain_valid(ce_complex value) {
    return isfinite(value.re) && isfinite(value.im) &&
        fabs(value.re) < CE_MAX_FINITE && fabs(value.im) < CE_MAX_FINITE;
}

int ce_domain_bailout(ce_complex value) {
    return fabs(value.re) >= CE_CHAIN_BAILOUT || fabs(value.im) >= CE_CHAIN_BAILOUT ||
        value.re * value.re + value.im * value.im > CE_ESCAPE_RADIUS_SQ;
}

double ce_domain_smooth_iteration(uint32_t iteration, uint32_t count, ce_complex value) {
    if (!ce_domain_valid(value)) return iteration + 1.0;
    const double magnitude = fmax(hypot(value.re, value.im), CE_ESCAPE_RADIUS);
    if (!isfinite(magnitude) || magnitude <= 1.0001) return iteration + 1.0;
    const double adjustment = log(fmax(log(magnitude) / log(CE_ESCAPE_RADIUS), 1e-6)) / log(2.0);
    return fmax(0.0, fmin(count, iteration + 1.0 - adjustment));
}

static ce_complex ce_domain_step(const ce_map_config *config, ce_complex current, ce_complex c) {
    if (config->dynamic_source_count) {
        ce_map_config single = *config;
        single.chain_count = 1u;
        single.zero_seed = 0u;
        single.derivative = 0u;
        ce_complex output = {NAN, NAN};
        uint8_t valid = 0u;
        if (ce_evaluate_points(&single, &current, 1u, &output, &valid) != 0 || !valid) {
            return (ce_complex){NAN, NAN};
        }
        return output;
    }
    if (config->use_taylor) {
        const double delta_re = current.re - config->taylor_center.re;
        const double delta_im = current.im - config->taylor_center.im;
        if (!config->taylor_coefficients || !config->taylor_count ||
            (isfinite(config->taylor_radius_sq) &&
             delta_re * delta_re + delta_im * delta_im > config->taylor_radius_sq * 1.000001)) {
            return (ce_complex){NAN, NAN};
        }
        ce_complex value = {0.0, 0.0};
        const ce_complex delta = {delta_re, delta_im};
        for (uint32_t index = config->taylor_count; index-- > 0u;) {
            value = ce_add(ce_mul(value, delta), config->taylor_coefficients[index]);
        }
        return value;
    }
    return ce_eval_function(config->function_id, current, c, &config->function);
}

static ce_complex ce_domain_value(const ce_map_config *config, ce_complex point, int *valid) {
    const uint32_t count = config->chain_count ? config->chain_count : 1;
    if (config->derivative) {
        ce_map_config plain = *config;
        plain.derivative = 0;
        const double h = 1e-6 * fmax(1.0, fmax(fabs(point.re), fabs(point.im)));
        ce_complex left_point = { point.re - h, point.im };
        ce_complex right_point = { point.re + h, point.im };
        int left_valid = 0, right_valid = 0;
        ce_complex left = ce_domain_value(&plain, left_point, &left_valid);
        ce_complex right = ce_domain_value(&plain, right_point, &right_valid);
        ce_complex result = { (right.re - left.re) * 0.5 / h, (right.im - left.im) * 0.5 / h };
        *valid = left_valid && right_valid && ce_domain_valid(result);
        return result;
    }
    ce_complex current = config->zero_seed ? (ce_complex){0.0, 0.0} : point;
    ce_complex last = {NAN, NAN};
    int has_last = 0;
    for (uint32_t iteration = 0; iteration < count; ++iteration) {
        current = ce_domain_step(config, current, point);
        if (!ce_domain_valid(current)) break;
        last = current;
        has_last = 1;
        if (fabs(current.re) >= CE_CHAIN_BAILOUT || fabs(current.im) >= CE_CHAIN_BAILOUT) break;
    }
    *valid = has_last;
    return last;
}

static ce_orbit_trace ce_trace_orbit(const ce_map_config *config, ce_complex point, int detect_convergence) {
    const uint32_t count = config->chain_count ? config->chain_count : 1;
    ce_complex current = config->zero_seed ? (ce_complex){0.0, 0.0} : point;
    ce_orbit_trace trace = {0, count, count, current, ce_domain_valid(current)};
    for (uint32_t iteration = 0; iteration < count; ++iteration) {
        ce_complex next = ce_domain_step(config, current, point);
        if (!ce_domain_valid(next) || ce_domain_bailout(next)) {
            trace.event = 1;
            trace.iteration = iteration + 1;
            trace.smooth_iteration = ce_domain_smooth_iteration(iteration, count, next);
            if (ce_domain_valid(next)) {
                trace.value = next;
                trace.has_value = 1;
            }
            return trace;
        }
        if (detect_convergence) {
            const double delta_re = next.re - current.re;
            const double delta_im = next.im - current.im;
            const double magnitude_sq = next.re * next.re + next.im * next.im;
            if (delta_re * delta_re + delta_im * delta_im <= CE_ATTRACTOR_EPSILON_SQ * fmax(1.0, magnitude_sq)) {
                trace.event = 2;
                trace.iteration = iteration + 1;
                trace.smooth_iteration = iteration + 1;
                trace.value = next;
                trace.has_value = 1;
                return trace;
            }
        }
        current = next;
        trace.value = next;
        trace.has_value = 1;
    }
    return trace;
}

static double ce_clamp(double value, double low, double high) {
    return value < low ? low : value > high ? high : value;
}

static void ce_palette_color(const ce_complex *palette_rg, const double *palette_b,
                             uint32_t count, double hue, double *red, double *green, double *blue) {
    hue = ce_clamp(hue, 0.0, 0.999999);
    const double value = hue * (count - 1);
    uint32_t index = (uint32_t)floor(value);
    if (index >= count - 1) index = count - 2;
    const double blend = value - index;
    *red = palette_rg[index].re * (1.0 - blend) + palette_rg[index + 1].re * blend;
    *green = palette_rg[index].im * (1.0 - blend) + palette_rg[index + 1].im * blend;
    *blue = palette_b[index] * (1.0 - blend) + palette_b[index + 1] * blend;
}

uint8_t ce_domain_byte(double value) {
    value = ce_clamp(value, 0.0, 1.0);
    return (uint8_t)(value * 255.0 + 0.5);
}

static void ce_styled_color(double red, double green, double blue, double lightness,
                            double saturation, double *out_red, double *out_green, double *out_blue) {
    if (lightness < 0.5) {
        const double scale = lightness * 2.0;
        red *= scale; green *= scale; blue *= scale;
    } else {
        const double blend = (lightness - 0.5) * 2.0;
        red = red * (1.0 - blend) + blend;
        green = green * (1.0 - blend) + blend;
        blue = blue * (1.0 - blend) + blend;
    }
    const double gray = 0.299 * red + 0.587 * green + 0.114 * blue;
    *out_red = gray * (1.0 - saturation) + red * saturation;
    *out_green = gray * (1.0 - saturation) + green * saturation;
    *out_blue = gray * (1.0 - saturation) + blue * saturation;
}

void ce_domain_color(ce_complex value, const ce_complex *palette_rg, const double *palette_b,
                            uint32_t palette_count, double brightness, double contrast,
                            double saturation, double cycles, double *red, double *green, double *blue) {
    if (!ce_domain_valid(value)) { *red = *green = *blue = 0.0; return; }
    double hue = atan2(value.im, value.re) / CE_TWO_PI;
    if (hue < 0.0) hue += 1.0;
    double base_lightness = 0.5;
    if (cycles > 0.0001) {
        const double detail = fmax(0.05, cycles);
        const double tone = (2.0 / CE_PI) * atan(log1p(hypot(value.re, value.im)) * (0.72 + detail * 0.28));
        base_lightness = 0.34 + (0.72 - 0.34) * tone;
    }
    const double lightness = ce_clamp((0.5 + (base_lightness - 0.5) * contrast) * brightness, 0.05, 0.95);
    double base_red, base_green, base_blue;
    ce_palette_color(palette_rg, palette_b, palette_count, hue, &base_red, &base_green, &base_blue);
    ce_styled_color(base_red, base_green, base_blue, lightness, ce_clamp(saturation, 0.0, 1.0), red, green, blue);
}

void ce_domain_event_color(ce_complex value, double intensity, int use_phase,
                           const ce_complex *palette_rg, const double *palette_b, uint32_t palette_count,
                           double brightness, double contrast, double saturation,
                           double *red, double *green, double *blue) {
    double hue = use_phase ? atan2(value.im, value.re) / CE_TWO_PI : ce_clamp(intensity, 0.0, 0.9999);
    if (hue < 0.0) hue += 1.0;
    intensity = ce_clamp(intensity, 0.0, 1.0);
    const double base_lightness = use_phase
        ? 0.24 + 0.58 * pow(intensity, 0.55)
        : 0.22 + 0.58 * pow(intensity, 0.65);
    const double lightness = ce_clamp((0.5 + (base_lightness - 0.5) * contrast) * brightness, 0.05, 0.95);
    double base_red, base_green, base_blue;
    ce_palette_color(palette_rg, palette_b, palette_count, hue, &base_red, &base_green, &base_blue);
    ce_styled_color(base_red, base_green, base_blue, lightness, ce_clamp(saturation, 0.0, 1.0), red, green, blue);
}

static void ce_sample_domain(const ce_map_config *config, ce_complex point, uint32_t orbit_mode,
                             const ce_complex *palette_rg, const double *palette_b, uint32_t palette_count,
                             double brightness, double contrast, double saturation, double cycles,
                             double *red, double *green, double *blue) {
    const uint32_t count = config->chain_count ? config->chain_count : 1;
    if (orbit_mode == 0 || config->derivative) {
        int valid = 0;
        ce_complex value = ce_domain_value(config, point, &valid);
        if (!valid) { *red = *green = *blue = 0.0; return; }
        ce_domain_color(value, palette_rg, palette_b, palette_count, brightness, contrast, saturation, cycles,
                        red, green, blue);
        return;
    }
    ce_orbit_trace trace = ce_trace_orbit(config, point, orbit_mode != 1);
    if (orbit_mode == 1) {
        if (trace.event != 1) { *red = *green = *blue = 0.0; return; }
        ce_domain_event_color(trace.value, trace.smooth_iteration / count, 0, palette_rg, palette_b,
                       palette_count, brightness, contrast, saturation, red, green, blue);
        return;
    }
    if (orbit_mode == 2) {
        if (trace.event != 2) { *red = *green = *blue = 0.0; return; }
        ce_domain_event_color(trace.value, 1.0 - (trace.iteration - 1.0) / count, 1, palette_rg, palette_b,
                       palette_count, brightness, contrast, saturation, red, green, blue);
        return;
    }
    if (trace.event == 1) {
        ce_domain_event_color(trace.value, 1.0 - trace.smooth_iteration / count, 1, palette_rg, palette_b,
                       palette_count, brightness, contrast, saturation, red, green, blue);
    } else if (trace.event == 2) {
        ce_domain_event_color(trace.value, 1.0 - (trace.iteration - 1.0) / count, 1, palette_rg, palette_b,
                       palette_count, brightness, contrast, saturation, red, green, blue);
    } else if (trace.has_value) {
        ce_domain_color(trace.value, palette_rg, palette_b, palette_count, brightness, contrast, saturation,
                        cycles, red, green, blue);
    } else {
        *red = *green = *blue = 0.0;
    }
}

int32_t ce_render_domain_tile(const ce_map_config *config,
                              double x_min, double x_max, double y_min, double y_max,
                              uint32_t frame_width, uint32_t frame_height,
                              uint32_t tile_x, uint32_t tile_y,
                              uint32_t tile_width, uint32_t tile_height, uint32_t scale,
                              uint32_t orbit_mode, const ce_complex *palette_rg,
                              const double *palette_b, uint32_t palette_count,
                              double brightness, double contrast, double saturation,
                              double lightness_cycles, uint32_t quality_only,
                              uint8_t *rgba) {
    if (!config || !palette_rg || !palette_b || palette_count < 2 || !rgba || !frame_width || !frame_height) return -1;
    const double x_span = x_max - x_min;
    const double y_span = y_max - y_min;
    for (uint32_t y = 0; y < tile_height; ++y) {
        for (uint32_t x = 0; x < tile_width; ++x) {
            double red = 0.0, green = 0.0, blue = 0.0;
            uint32_t samples = 1;
            if (quality_only) {
                ce_complex center = {
                    x_min + (tile_x + x + 0.5) * scale * x_span / frame_width,
                    y_max - (tile_y + y + 0.5) * scale * y_span / frame_height
                };
                ce_complex diagonal = {
                    x_min + (tile_x + x + 0.875) * scale * x_span / frame_width,
                    y_max - (tile_y + y + 0.875) * scale * y_span / frame_height
                };
                double center_red, center_green, center_blue;
                double diagonal_red, diagonal_green, diagonal_blue;
                ce_sample_domain(config, center, orbit_mode, palette_rg, palette_b, palette_count,
                                 brightness, contrast, saturation, lightness_cycles,
                                 &center_red, &center_green, &center_blue);
                ce_sample_domain(config, diagonal, orbit_mode, palette_rg, palette_b, palette_count,
                                 brightness, contrast, saturation, lightness_cycles,
                                 &diagonal_red, &diagonal_green, &diagonal_blue);
                const double difference = fabs(center_red - diagonal_red) +
                    fabs(center_green - diagonal_green) + fabs(center_blue - diagonal_blue);
                if (difference <= 0.06) {
                    red = center_red; green = center_green; blue = center_blue;
                    samples = 0;
                } else {
                    samples = 2;
                }
            }
            for (uint32_t sy = 0; sy < samples; ++sy) {
                for (uint32_t sx = 0; sx < samples; ++sx) {
                    const double sub_x = (sx + 0.5) / samples;
                    const double sub_y = (sy + 0.5) / samples;
                    ce_complex point = {
                        x_min + (tile_x + x + sub_x) * scale * x_span / frame_width,
                        y_max - (tile_y + y + sub_y) * scale * y_span / frame_height
                    };
                    double sample_red, sample_green, sample_blue;
                    ce_sample_domain(config, point, orbit_mode, palette_rg, palette_b, palette_count,
                                     brightness, contrast, saturation, lightness_cycles,
                                     &sample_red, &sample_green, &sample_blue);
                    red += sample_red; green += sample_green; blue += sample_blue;
                }
            }
            const uint32_t index = (y * tile_width + x) * 4;
            const double inverse_samples = samples ? 1.0 / (samples * samples) : 1.0;
            rgba[index] = ce_domain_byte(red * inverse_samples);
            rgba[index + 1] = ce_domain_byte(green * inverse_samples);
            rgba[index + 2] = ce_domain_byte(blue * inverse_samples);
            rgba[index + 3] = 255;
        }
    }
    return 0;
}
