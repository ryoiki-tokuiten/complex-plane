#include "complex_engine.h"
#include "ce_limits.h"
#include "domain_internal.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

#define CE_PI 3.141592653589793238462643383279502884
#define CE_TWO_PI (2.0 * CE_PI)
#define CE_INV_TWO_PI (1.0 / (2.0 * CE_PI))
#define CE_ATTRACTOR_EPSILON_SQ 1e-14
#define CE_HUE_LUT_SIZE 4096
#define CE_INV_HUE_LUT_SIZE (1.0 / (double)CE_HUE_LUT_SIZE)

typedef struct {
    uint32_t event;
    uint32_t iteration;
    double smooth_iteration;
    ce_complex value;
    uint32_t has_value;
} ce_orbit_trace;

typedef struct {
    uint32_t flat_lut[CE_HUE_LUT_SIZE + 1];
    float hue_lut[(CE_HUE_LUT_SIZE + 1) * 3];
    int is_flat;
    double brightness;
    double contrast;
    double saturation;
    double cycles;
    double average_red;
    double average_green;
    double average_blue;
} ce_color_lut;

// Fast Chebyshev minimax polynomial approximation for atan2(y, x).
// Max error < 2e-4 radians. Takes ~5 arithmetic operations.
static inline double ce_fast_atan2(double y, double x) {
    const double ax = fabs(x);
    const double ay = fabs(y);
    const double max_val = ax > ay ? ax : ay;
    if (max_val == 0.0) return 0.0;
    const double a = (ax < ay ? ax : ay) / max_val;
    const double z = a * a;
    double angle = (((-0.0464964749 * z + 0.15931422) * z - 0.327622764) * z * a) + a;
    if (ay > ax) angle = (CE_PI * 0.5) - angle;
    if (x < 0.0) angle = CE_PI - angle;
    return y < 0.0 ? -angle : angle;
}

static inline double ce_clamp(double value, double low, double high) {
    return value < low ? low : value > high ? high : value;
}

static inline double ce_log_magnitude(ce_complex value) {
    const double scale = fmax(fabs(value.re), fabs(value.im));
    if (scale == 0.0) return CE_DOMAIN_LOG_MAGNITUDE_MIN;
    const double scaled_re = value.re / scale;
    const double scaled_im = value.im / scale;
    return log(scale) + 0.5 * log(scaled_re * scaled_re + scaled_im * scaled_im);
}

static inline double ce_magnitude_tone(double log_magnitude, double cycles) {
    if (cycles <= 0.0001) return 0.5;
    const double normalized = ce_clamp(
        (log_magnitude - CE_DOMAIN_LOG_MAGNITUDE_MIN) * CE_DOMAIN_INV_LOG_MAGNITUDE_SPAN,
        0.0, 1.0
    );
    return ce_clamp(0.5 + (normalized - 0.5) * fmax(0.05, cycles), 0.0, 1.0);
}

uint8_t ce_domain_byte(double value) {
    value = ce_clamp(value, 0.0, 1.0);
    return (uint8_t)(value * 255.0 + 0.5);
}

int ce_domain_valid(ce_complex value) {
    return isfinite(value.re) && isfinite(value.im) &&
        fabs(value.re) < CE_DOMAIN_MAGNITUDE_MAX && fabs(value.im) < CE_DOMAIN_MAGNITUDE_MAX;
}

int ce_domain_bailout(ce_complex value) {
    return fabs(value.re) >= CE_CHAIN_BAILOUT || fabs(value.im) >= CE_CHAIN_BAILOUT ||
        value.re * value.re + value.im * value.im > CE_ESCAPE_RADIUS_SQ;
}

double ce_domain_smooth_iteration(uint32_t iteration, uint32_t count, ce_complex value) {
    if (!ce_domain_valid(value)) return iteration + 1.0;
    const double magnitude = fmax(hypot(value.re, value.im), CE_ESCAPE_RADIUS);
    if (!isfinite(magnitude) || magnitude <= 1.0001) return iteration + 1.0;
    const double adjustment = log(fmax(log(magnitude) / log(CE_ESCAPE_RADIUS), 1e-6)) / 0.693147180559945309417;
    return fmax(0.0, fmin(count, iteration + 1.0 - adjustment));
}

static void ce_init_color_lut(ce_color_lut *lut,
                              const ce_complex *palette_rg, const double *palette_b,
                              uint32_t palette_count, double brightness,
                              double contrast, double saturation, double cycles) {
    lut->brightness = brightness;
    lut->contrast = contrast;
    lut->saturation = ce_clamp(saturation, 0.0, 1.0);
    lut->cycles = cycles;
    lut->is_flat = (cycles <= 0.0001);

    const double inverse_sat = 1.0 - lut->saturation;
    const uint32_t palette_last = palette_count - 1;
    double average_red = 0.0, average_green = 0.0, average_blue = 0.0;

    for (uint32_t i = 0; i <= CE_HUE_LUT_SIZE; ++i) {
        const double hue = (i == CE_HUE_LUT_SIZE) ? 0.999999 : (double)i * CE_INV_HUE_LUT_SIZE;
        const double val = hue * (double)palette_last;
        uint32_t p = (uint32_t)floor(val);
        if (p >= palette_last) p = palette_last - 1;
        const double blend = val - (double)p;
        const double inv_blend = 1.0 - blend;

        const double r = palette_rg[p].re * inv_blend + palette_rg[p + 1].re * blend;
        const double g = palette_rg[p].im * inv_blend + palette_rg[p + 1].im * blend;
        const double b = palette_b[p] * inv_blend + palette_b[p + 1] * blend;

        const double gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const float out_r = (float)(gray * inverse_sat + r * lut->saturation);
        const float out_g = (float)(gray * inverse_sat + g * lut->saturation);
        const float out_b = (float)(gray * inverse_sat + b * lut->saturation);

        const uint32_t base = i * 3;
        lut->hue_lut[base] = out_r;
        lut->hue_lut[base + 1] = out_g;
        lut->hue_lut[base + 2] = out_b;
        if (i < CE_HUE_LUT_SIZE) {
            average_red += out_r;
            average_green += out_g;
            average_blue += out_b;
        }

        const double flat_lightness = ce_clamp((0.5) * brightness, 0.05, 0.95);
        double scale, bias;
        if (flat_lightness < 0.5) {
            scale = flat_lightness * 2.0;
            bias = 0.0;
        } else {
            bias = (flat_lightness - 0.5) * 2.0;
            scale = 1.0 - bias;
        }
        const uint8_t byte_r = ce_domain_byte(scale * out_r + bias);
        const uint8_t byte_g = ce_domain_byte(scale * out_g + bias);
        const uint8_t byte_b = ce_domain_byte(scale * out_b + bias);

        lut->flat_lut[i] = ((uint32_t)255 << 24) | ((uint32_t)byte_b << 16) | ((uint32_t)byte_g << 8) | (uint32_t)byte_r;
    }
    lut->average_red = average_red * CE_INV_HUE_LUT_SIZE;
    lut->average_green = average_green * CE_INV_HUE_LUT_SIZE;
    lut->average_blue = average_blue * CE_INV_HUE_LUT_SIZE;
}

static inline uint32_t ce_color_log_polar_fast(double phase, double log_magnitude,
                                               int average_phase, const ce_color_lut *lut) {
    if (!isfinite(phase) || isnan(log_magnitude)) return 0xFF000000;
    double hue = phase * CE_INV_TWO_PI;
    hue -= floor(hue);
    uint32_t idx = (uint32_t)(hue * (double)CE_HUE_LUT_SIZE);
    if (idx >= CE_HUE_LUT_SIZE) idx = CE_HUE_LUT_SIZE - 1u;

    if (lut->is_flat && !average_phase) {
        return lut->flat_lut[idx];
    }

    const double tone = ce_magnitude_tone(log_magnitude, lut->cycles);
    const double base_lightness = lut->is_flat ? 0.5 : 0.34 + (0.72 - 0.34) * tone;
    const double lightness = ce_clamp((0.5 + (base_lightness - 0.5) * lut->contrast) * lut->brightness, 0.05, 0.95);

    double scale, bias;
    if (lightness < 0.5) {
        scale = lightness * 2.0;
        bias = 0.0;
    } else {
        bias = (lightness - 0.5) * 2.0;
        scale = 1.0 - bias;
    }
    const uint32_t base = idx * 3u;
    const double base_red = average_phase ? lut->average_red : lut->hue_lut[base];
    const double base_green = average_phase ? lut->average_green : lut->hue_lut[base + 1u];
    const double base_blue = average_phase ? lut->average_blue : lut->hue_lut[base + 2u];
    const uint8_t r = ce_domain_byte(scale * base_red + bias);
    const uint8_t g = ce_domain_byte(scale * base_green + bias);
    const uint8_t b = ce_domain_byte(scale * base_blue + bias);
    return ((uint32_t)255 << 24) | ((uint32_t)b << 16) | ((uint32_t)g << 8) | (uint32_t)r;
}

static inline uint32_t ce_color_point_fast(ce_complex value, const ce_color_lut *lut) {
    if (!ce_domain_valid(value)) return 0xFF000000;
    return ce_color_log_polar_fast(
        ce_fast_atan2(value.im, value.re), ce_log_magnitude(value), 0, lut
    );
}

int32_t ce_domain_color_points(const ce_complex *values, const uint8_t *valid, uint32_t count,
                               const ce_complex *palette_rg, const double *palette_b,
                               uint32_t palette_count, double brightness, double contrast,
                               double saturation, double cycles, uint8_t *rgba) {
    if (!values || !palette_rg || !palette_b || palette_count < 2u || !rgba) return -1;
    ce_color_lut *lut = (ce_color_lut *)malloc(sizeof(ce_color_lut));
    if (!lut) return -2;
    ce_init_color_lut(lut, palette_rg, palette_b, palette_count,
                      brightness, contrast, saturation, cycles);
    uint32_t *pixels = (uint32_t *)rgba;
    for (uint32_t index = 0; index < count; ++index) {
        pixels[index] = (!valid || valid[index])
            ? ce_color_point_fast(values[index], lut)
            : 0xFF0F0806u;
    }
    free(lut);
    return 0;
}

ce_complex ce_domain_step(const ce_map_config *config, ce_complex current, ce_complex c) {
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
    return ce_eval_map_step(config, current, c);
}

typedef struct {
    uint32_t count;
    ce_complex center;
    ce_complex z[1025];
    ce_complex A[1025];
    ce_complex B[1025];
    ce_complex C[1025];
    uint8_t valid[1025];
    uint32_t bailout_step;
} ce_reference_orbit_context;

struct ce_domain_render_context {
    const ce_complex *palette_rg;
    const double *palette_b;
    uint32_t palette_count;
    ce_color_lut lut;
    ce_reference_orbit_context *reference;
};

static void ce_compute_reference_orbit(const ce_map_config *config, ce_complex center,
                                      uint32_t count, ce_reference_orbit_context *ctx) {
    ctx->count = count;
    ctx->center = center;
    ctx->bailout_step = ctx->count;
    ce_complex z = config->zero_seed ? (ce_complex){0.0, 0.0} : center;
    ctx->z[0] = z;
    ctx->valid[0] = ce_domain_valid(z);

    for (uint32_t n = 0; n < ctx->count; ++n) {
        if (!ctx->valid[n] || ce_domain_bailout(ctx->z[n])) {
            ctx->bailout_step = n;
            for (uint32_t j = n + 1; j <= ctx->count; ++j) {
                ctx->valid[j] = 0;
            }
            break;
        }

        ce_complex zn = ctx->z[n];
        const double h = 1e-7 * fmax(1.0, hypot(zn.re, zn.im));
        const double hc = 1e-7 * fmax(1.0, hypot(center.re, center.im));

        ce_complex f_0 = ce_domain_step(config, zn, center);
        ce_complex f_zp = ce_domain_step(config, (ce_complex){zn.re + h, zn.im}, center);
        ce_complex f_zm = ce_domain_step(config, (ce_complex){zn.re - h, zn.im}, center);
        ce_complex f_cp = ce_domain_step(config, zn, (ce_complex){center.re + hc, center.im});

        if (!ce_domain_valid(f_0) || !ce_domain_valid(f_zp) || !ce_domain_valid(f_zm) || !ce_domain_valid(f_cp) ||
            fabs(f_0.re) >= CE_CHAIN_BAILOUT || fabs(f_0.im) >= CE_CHAIN_BAILOUT) {
            ctx->bailout_step = n;
            for (uint32_t j = n + 1; j <= ctx->count; ++j) ctx->valid[j] = 0;
            break;
        }

        ce_complex A = (ce_complex){ (f_zp.re - f_zm.re) * 0.5 / h, (f_zp.im - f_zm.im) * 0.5 / h };
        ce_complex B = (ce_complex){ (f_cp.re - f_0.re) / hc, (f_cp.im - f_0.im) / hc };
        ce_complex C = (ce_complex){ (f_zp.re - 2.0 * f_0.re + f_zm.re) * 0.5 / (h * h),
                                  (f_zp.im - 2.0 * f_0.im + f_zm.im) * 0.5 / (h * h) };

        if (!isfinite(A.re) || !isfinite(A.im) || !isfinite(B.re) || !isfinite(B.im) ||
            !isfinite(C.re) || !isfinite(C.im) || (A.re * A.re + A.im * A.im) > 1e20) {
            ctx->bailout_step = n;
            for (uint32_t j = n + 1; j <= ctx->count; ++j) ctx->valid[j] = 0;
            break;
        }

        ctx->A[n] = A;
        ctx->B[n] = B;
        ctx->C[n] = C;
        ctx->z[n + 1] = f_0;
        ctx->valid[n + 1] = ce_domain_valid(f_0);
    }
}

ce_domain_render_context *ce_create_domain_render_context(
        const ce_map_config *config,
        double x_min, double x_max, double y_min, double y_max,
        const ce_complex *palette_rg, const double *palette_b,
        uint32_t palette_count, double brightness, double contrast,
        double saturation, double lightness_cycles) {
    if (!config || !config->chain_count || config->chain_count > 1024u ||
        !palette_rg || !palette_b || palette_count < 2u ||
        !isfinite(x_min) || !isfinite(x_max) || !isfinite(y_min) || !isfinite(y_max) ||
        !(x_max > x_min) || !(y_max > y_min) ||
        !isfinite(brightness) || !isfinite(contrast) || !isfinite(saturation) ||
        !isfinite(lightness_cycles)) return NULL;
    ce_domain_render_context *context = (ce_domain_render_context *)calloc(1, sizeof(ce_domain_render_context));
    if (!context) return NULL;
    context->palette_rg = palette_rg;
    context->palette_b = palette_b;
    context->palette_count = palette_count;
    ce_init_color_lut(&context->lut, palette_rg, palette_b, palette_count,
                      brightness, contrast, saturation, lightness_cycles);
    if (x_max - x_min < 1e-4) {
        context->reference = (ce_reference_orbit_context *)calloc(1, sizeof(ce_reference_orbit_context));
        if (!context->reference) {
            free(context);
            return NULL;
        }
        const ce_complex center = { (x_min + x_max) * 0.5, (y_min + y_max) * 0.5 };
        ce_compute_reference_orbit(config, center, config->chain_count, context->reference);
    }
    return context;
}

void ce_destroy_domain_render_context(ce_domain_render_context *context) {
    if (!context) return;
    free(context->reference);
    free(context);
}

static ce_complex ce_domain_value_offset(const ce_map_config *config, ce_complex center, ce_complex delta,
                                         const ce_reference_orbit_context *ref, int *valid) {
    const uint32_t count = config->chain_count;
    const ce_complex point = { center.re + delta.re, center.im + delta.im };
    if (config->derivative) {
        ce_map_config plain = *config;
        plain.derivative = 0;
        const double h = 1e-6 * fmax(1.0, fmax(fabs(point.re), fabs(point.im)));
        ce_complex left_delta = { delta.re - h, delta.im };
        ce_complex right_delta = { delta.re + h, delta.im };
        int left_valid = 0, right_valid = 0;
        ce_complex left = ce_domain_value_offset(&plain, center, left_delta, NULL, &left_valid);
        ce_complex right = ce_domain_value_offset(&plain, center, right_delta, NULL, &right_valid);
        ce_complex result = { (right.re - left.re) * 0.5 / h, (right.im - left.im) * 0.5 / h };
        *valid = left_valid && right_valid && ce_domain_valid(result);
        return result;
    }

    if (count == 1u && !ref) {
        const ce_complex current = config->zero_seed ? (ce_complex){0.0, 0.0} : point;
        const ce_complex output = ce_domain_step(config, current, point);
        *valid = ce_domain_valid(output);
        return output;
    }

    ce_complex ez = config->zero_seed ? (ce_complex){0.0, 0.0} : delta;
    ce_complex current = (ref && ref->valid[0]) ? ref->z[0] : (config->zero_seed ? (ce_complex){0.0, 0.0} : point);
    int direct_mode = (ref == NULL);
    const int detect_fixed_point = count >= 64u;

    for (uint32_t iteration = 0; iteration < count; ++iteration) {
        const ce_complex previous = current;
        ce_complex next;
        if (!direct_mode && iteration < ref->bailout_step && ref->valid[iteration] && ref->valid[iteration + 1]) {
            const ce_complex A = ref->A[iteration];
            const ce_complex B = ref->B[iteration];
            const ce_complex C = ref->C[iteration];

            const double ez2_re = ez.re * ez.re - ez.im * ez.im;
            const double ez2_im = 2.0 * ez.re * ez.im;

            const double next_ez_re = A.re * ez.re - A.im * ez.im +
                                      B.re * delta.re - B.im * delta.im +
                                      C.re * ez2_re - C.im * ez2_im;
            const double next_ez_im = A.re * ez.im + A.im * ez.re +
                                      B.re * delta.im + B.im * delta.re +
                                      C.re * ez2_im + C.im * ez2_re;

            ez = (ce_complex){ next_ez_re, next_ez_im };
            const ce_complex ref_next = ref->z[iteration + 1];
            next = (ce_complex){ ref_next.re + ez.re, ref_next.im + ez.im };

            if (ez.re * ez.re + ez.im * ez.im > 0.0025) {
                direct_mode = 1;
                current = next;
            }
        } else {
            next = ce_domain_step(config, current, point);
            current = next;
        }

        if (!ce_domain_valid(next)) {
            *valid = 0;
            return (ce_complex){NAN, NAN};
        }

        if (fabs(next.re) >= CE_CHAIN_BAILOUT || fabs(next.im) >= CE_CHAIN_BAILOUT) {
            current = next;
            break;
        }

        current = next;
        if (detect_fixed_point && next.re == previous.re && next.im == previous.im) break;
    }

    *valid = ce_domain_valid(current);
    return current;
}

static ce_orbit_trace ce_trace_orbit_offset(const ce_map_config *config, ce_complex center, ce_complex delta,
                                           const ce_reference_orbit_context *ref, int detect_convergence) {
    const uint32_t count = config->chain_count;
    const ce_complex point = { center.re + delta.re, center.im + delta.im };

    ce_complex ez = config->zero_seed ? (ce_complex){0.0, 0.0} : delta;
    ce_complex current = (ref && ref->valid[0]) ? ref->z[0] : (config->zero_seed ? (ce_complex){0.0, 0.0} : point);
    ce_orbit_trace trace = {0, count, (double)count, current, ce_domain_valid(current)};
    ce_complex checkpoint = current;
    uint32_t power = 1;
    int direct_mode = (ref == NULL);

    for (uint32_t iteration = 0; iteration < count; ++iteration) {
        ce_complex next;
        if (!direct_mode && iteration < ref->bailout_step && ref->valid[iteration] && ref->valid[iteration + 1]) {
            const ce_complex A = ref->A[iteration];
            const ce_complex B = ref->B[iteration];
            const ce_complex C = ref->C[iteration];

            const double ez2_re = ez.re * ez.re - ez.im * ez.im;
            const double ez2_im = 2.0 * ez.re * ez.im;

            const double next_ez_re = A.re * ez.re - A.im * ez.im +
                                      B.re * delta.re - B.im * delta.im +
                                      C.re * ez2_re - C.im * ez2_im;
            const double next_ez_im = A.re * ez.im + A.im * ez.re +
                                      B.re * delta.im + B.im * delta.re +
                                      C.re * ez2_im + C.im * ez2_re;

            ez = (ce_complex){ next_ez_re, next_ez_im };
            const ce_complex ref_next = ref->z[iteration + 1];
            next = (ce_complex){ ref_next.re + ez.re, ref_next.im + ez.im };

            if (ez.re * ez.re + ez.im * ez.im > 0.0025) {
                direct_mode = 1;
                current = next;
            }
        } else {
            next = ce_domain_step(config, current, point);
            current = next;
        }

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
            if (iteration >= 1) {
                const double delta_re = next.re - checkpoint.re;
                const double delta_im = next.im - checkpoint.im;
                const double magnitude_sq = next.re * next.re + next.im * next.im;
                if (delta_re * delta_re + delta_im * delta_im <= CE_ATTRACTOR_EPSILON_SQ * fmax(1.0, magnitude_sq)) {
                    trace.event = 2;
                    trace.iteration = iteration + 1;
                    trace.smooth_iteration = (double)(iteration + 1);
                    trace.value = next;
                    trace.has_value = 1;
                    return trace;
                }
            }
            if (iteration == power) {
                checkpoint = next;
                power = power << 1;
            }
        }

        current = next;
        trace.value = next;
        trace.has_value = 1;
    }
    return trace;
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
    double hue = ce_fast_atan2(value.im, value.re) * CE_INV_TWO_PI;
    if (hue < 0.0) hue += 1.0;
    double base_lightness = 0.5;
    if (cycles > 0.0001) {
        const double tone = ce_magnitude_tone(ce_log_magnitude(value), cycles);
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
    double hue = use_phase ? ce_fast_atan2(value.im, value.re) * CE_INV_TWO_PI : ce_clamp(intensity, 0.0, 0.9999);
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

static void ce_sample_domain_offset(const ce_map_config *config, ce_complex center, ce_complex delta,
                                   const ce_reference_orbit_context *ref, uint32_t orbit_mode,
                                   const ce_color_lut *lut, const ce_complex *palette_rg,
                                   const double *palette_b, uint32_t palette_count,
                                   double *red, double *green, double *blue) {
    const uint32_t count = config->chain_count;
    if (orbit_mode == 0 || config->derivative) {
        int valid = 0;
        ce_complex value = ce_domain_value_offset(config, center, delta, ref, &valid);
        if (!valid) { *red = *green = *blue = 0.0; return; }
        ce_domain_color(value, palette_rg, palette_b, palette_count, lut->brightness, lut->contrast,
                        lut->saturation, lut->cycles, red, green, blue);
        return;
    }
    ce_orbit_trace trace = ce_trace_orbit_offset(config, center, delta, ref, orbit_mode != 1);
    if (orbit_mode == 1) {
        if (trace.event != 1) { *red = *green = *blue = 0.0; return; }
        ce_domain_event_color(trace.value, trace.smooth_iteration / count, 0, palette_rg, palette_b,
                       palette_count, lut->brightness, lut->contrast, lut->saturation, red, green, blue);
        return;
    }
    if (orbit_mode == 2) {
        if (trace.event != 2) { *red = *green = *blue = 0.0; return; }
        ce_domain_event_color(trace.value, 1.0 - (trace.iteration - 1.0) / count, 1, palette_rg, palette_b,
                       palette_count, lut->brightness, lut->contrast, lut->saturation, red, green, blue);
        return;
    }
    if (trace.event == 1) {
        ce_domain_event_color(trace.value, 1.0 - trace.smooth_iteration / count, 1, palette_rg, palette_b,
                       palette_count, lut->brightness, lut->contrast, lut->saturation, red, green, blue);
    } else if (trace.event == 2) {
        ce_domain_event_color(trace.value, 1.0 - (trace.iteration - 1.0) / count, 1, palette_rg, palette_b,
                       palette_count, lut->brightness, lut->contrast, lut->saturation, red, green, blue);
    } else if (trace.has_value) {
        ce_domain_color(trace.value, palette_rg, palette_b, palette_count, lut->brightness, lut->contrast,
                        lut->saturation, lut->cycles, red, green, blue);
    } else {
        *red = *green = *blue = 0.0;
    }
}

static int ce_separable_function(const ce_map_config *config, uint32_t *function_id,
                                 ce_complex *coefficient) {
    if (config->derivative || config->dynamic_source_count || config->use_taylor ||
        config->chain_count > 1 || config->zero_seed) return 0;
    *function_id = config->function_id;
    *coefficient = (ce_complex){1.0, 0.0};
    if (config->kernel_kind == CE_MAP_KERNEL_DIRECT_FUNCTION) {
        const ce_algebraic_term *term = &config->function.algebraic_terms[0];
        const ce_algebraic_factor *factor = &config->function.algebraic_factors[term->factor_offset];
        *function_id = factor->function_id;
        *coefficient = term->coefficient;
    }
    switch (*function_id) {
        case CE_FN_COS:
        case CE_FN_TAN:
        case CE_FN_SEC:
        case CE_FN_SINH:
        case CE_FN_TANH:
            return 1;
        case CE_FN_EXP:
            return fabs(config->function.exp_base.re - 2.718281828459045) < 1e-12 &&
                   fabs(config->function.exp_base.im) < 1e-12;
        default:
            return 0;
    }
}

static inline uint32_t ce_color_scaled_log_polar(double phase, double log_magnitude,
                                                  ce_complex coefficient, int average_phase,
                                                  const ce_color_lut *lut) {
    const double coefficient_magnitude = hypot(coefficient.re, coefficient.im);
    if (coefficient_magnitude == 0.0) {
        return ce_color_log_polar_fast(0.0, CE_DOMAIN_LOG_MAGNITUDE_MIN, 0, lut);
    }
    return ce_color_log_polar_fast(
        phase + ce_fast_atan2(coefficient.im, coefficient.re),
        log_magnitude + log(coefficient_magnitude), average_phase, lut
    );
}

static inline double ce_log_norm(double re, double im) {
    const double norm_sq = re * re + im * im;
    return norm_sq > 0.0 ? 0.5 * log(norm_sq) : CE_DOMAIN_LOG_MAGNITUDE_MIN;
}

static uint32_t ce_separable_point_color(const ce_map_config *config, double u, double v,
                                         int average_phase, const ce_color_lut *lut) {
    uint32_t function_id;
    ce_complex coefficient;
    if (!ce_separable_function(config, &function_id, &coefficient)) return 0xFF000000;

    const double cos_u = cos(u), sin_u = sin(u);
    const double cos_v = cos(v), sin_v = sin(v);
    if (function_id == CE_FN_COS || function_id == CE_FN_SEC) {
        const double magnitude_scale = fabs(v);
        const double q = exp(-2.0 * magnitude_scale);
        const double re = cos_u * (1.0 + q);
        const double im = -sin_u * copysign(1.0 - q, v);
        const double phase = ce_fast_atan2(im, re);
        const double log_magnitude = magnitude_scale - 0.693147180559945309417 + ce_log_norm(re, im);
        return ce_color_scaled_log_polar(
            function_id == CE_FN_SEC ? -phase : phase,
            function_id == CE_FN_SEC ? -log_magnitude : log_magnitude,
            coefficient, average_phase, lut
        );
    }
    if (function_id == CE_FN_EXP) {
        return ce_color_scaled_log_polar(v, u, coefficient, average_phase, lut);
    }
    if (function_id == CE_FN_SINH) {
        const double magnitude_scale = fabs(u);
        const double q = exp(-2.0 * magnitude_scale);
        const double re = copysign(1.0 - q, u) * cos_v;
        const double im = (1.0 + q) * sin_v;
        return ce_color_scaled_log_polar(
            ce_fast_atan2(im, re), magnitude_scale - 0.693147180559945309417 + ce_log_norm(re, im),
            coefficient, average_phase, lut
        );
    }
    if (function_id == CE_FN_TAN) {
        const double magnitude_scale = fabs(v);
        const double q = exp(-2.0 * magnitude_scale);
        const double q_sq = q * q;
        const double sin_2u = 2.0 * sin_u * cos_u;
        const double cos_2u = cos_u * cos_u - sin_u * sin_u;
        const double denominator = 1.0 + q_sq + 2.0 * q * cos_2u;
        const double re = 2.0 * q * sin_2u / denominator;
        const double im = copysign((1.0 - q_sq) / denominator, v);
        return ce_color_scaled_log_polar(
            ce_fast_atan2(im, re), ce_log_norm(re, im), coefficient, average_phase, lut
        );
    }
    if (function_id == CE_FN_TANH) {
        const double magnitude_scale = fabs(u);
        const double q = exp(-2.0 * magnitude_scale);
        const double q_sq = q * q;
        const double sin_2v = 2.0 * sin_v * cos_v;
        const double cos_2v = cos_v * cos_v - sin_v * sin_v;
        const double denominator = 1.0 + q_sq + 2.0 * q * cos_2v;
        const double re = copysign((1.0 - q_sq) / denominator, u);
        const double im = 2.0 * q * sin_2v / denominator;
        return ce_color_scaled_log_polar(
            ce_fast_atan2(im, re), ce_log_norm(re, im), coefficient, average_phase, lut
        );
    }
    return 0xFF000000;
}

static int ce_render_separable_tile(const ce_map_config *config,
                                    double x_min, double x_max, double y_min, double y_max,
                                    uint32_t frame_width, uint32_t frame_height,
                                    uint32_t tile_x, uint32_t tile_y,
                                    uint32_t tile_width, uint32_t tile_height, uint32_t scale,
                                    const ce_color_lut *lut, uint8_t *rgba) {
    if (tile_width > 512 || tile_height > 512) return 0;
    const double x_span = x_max - x_min;
    const double y_span = y_max - y_min;
    const double inv_w = 1.0 / (double)frame_width;
    const double inv_h = 1.0 / (double)frame_height;
    const double pixel_span_x = fabs(x_span * (double)scale * inv_w);
    const double pixel_span_y = fabs(y_span * (double)scale * inv_h);

    uint32_t function_id;
    ce_complex coefficient;
    if (!ce_separable_function(config, &function_id, &coefficient)) return 0;

    double u_values[512], v_values[512];
    double cos_u[512], sin_u[512], cos_v[512], sin_v[512];

    for (uint32_t x = 0; x < tile_width; ++x) {
        const double u = ((tile_x + x + 0.5) * scale * inv_w - 0.5) * x_span + (x_min + x_max) * 0.5;
        u_values[x] = u;
        cos_u[x] = cos(u);
        sin_u[x] = sin(u);
    }
    for (uint32_t y = 0; y < tile_height; ++y) {
        const double v = (0.5 - (tile_y + y + 0.5) * scale * inv_h) * y_span + (y_min + y_max) * 0.5;
        v_values[y] = v;
        cos_v[y] = cos(v);
        sin_v[y] = sin(v);
    }

    uint32_t *pixels = (uint32_t *)rgba;

    switch (function_id) {
        case CE_FN_COS: {
            const int average_phase = pixel_span_x >= CE_TWO_PI;
            for (uint32_t y = 0; y < tile_height; ++y) {
                const uint32_t row = y * tile_width;
                const double magnitude_scale = fabs(v_values[y]);
                const double q = exp(-2.0 * magnitude_scale);
                const double positive = 1.0 + q;
                const double negative = copysign(1.0 - q, v_values[y]);
                for (uint32_t x = 0; x < tile_width; ++x) {
                    const double re = cos_u[x] * positive;
                    const double im = -sin_u[x] * negative;
                    pixels[row + x] = ce_color_scaled_log_polar(
                        ce_fast_atan2(im, re), magnitude_scale - 0.693147180559945309417 + ce_log_norm(re, im),
                        coefficient, average_phase, lut
                    );
                }
            }
            return 1;
        }
        case CE_FN_EXP: {
            const int average_phase = pixel_span_y >= CE_TWO_PI;
            for (uint32_t y = 0; y < tile_height; ++y) {
                const uint32_t row = y * tile_width;
                for (uint32_t x = 0; x < tile_width; ++x) {
                    pixels[row + x] = ce_color_scaled_log_polar(
                        v_values[y], u_values[x], coefficient, average_phase, lut
                    );
                }
            }
            return 1;
        }
        case CE_FN_TAN: {
            for (uint32_t y = 0; y < tile_height; ++y) {
                const uint32_t row = y * tile_width;
                const double magnitude_scale = fabs(v_values[y]);
                const double q = exp(-2.0 * magnitude_scale);
                const double q_sq = q * q;
                const int average_phase = magnitude_scale < 8.0 && pixel_span_x >= CE_PI;
                for (uint32_t x = 0; x < tile_width; ++x) {
                    const double sin_2u = 2.0 * sin_u[x] * cos_u[x];
                    const double cos_2u = cos_u[x] * cos_u[x] - sin_u[x] * sin_u[x];
                    const double denominator = 1.0 + q_sq + 2.0 * q * cos_2u;
                    const double re = 2.0 * q * sin_2u / denominator;
                    const double im = copysign((1.0 - q_sq) / denominator, v_values[y]);
                    pixels[row + x] = ce_color_scaled_log_polar(
                        ce_fast_atan2(im, re), ce_log_norm(re, im), coefficient, average_phase, lut
                    );
                }
            }
            return 1;
        }
        case CE_FN_SEC: {
            const int average_phase = pixel_span_x >= CE_TWO_PI;
            for (uint32_t y = 0; y < tile_height; ++y) {
                const uint32_t row = y * tile_width;
                const double magnitude_scale = fabs(v_values[y]);
                const double q = exp(-2.0 * magnitude_scale);
                const double positive = 1.0 + q;
                const double negative = copysign(1.0 - q, v_values[y]);
                for (uint32_t x = 0; x < tile_width; ++x) {
                    const double re = cos_u[x] * positive;
                    const double im = -sin_u[x] * negative;
                    const double cosine_log_magnitude = magnitude_scale - 0.693147180559945309417 + ce_log_norm(re, im);
                    pixels[row + x] = ce_color_scaled_log_polar(
                        -ce_fast_atan2(im, re), -cosine_log_magnitude,
                        coefficient, average_phase, lut
                    );
                }
            }
            return 1;
        }
        case CE_FN_SINH: {
            const int average_phase = pixel_span_y >= CE_TWO_PI;
            for (uint32_t y = 0; y < tile_height; ++y) {
                const uint32_t row = y * tile_width;
                for (uint32_t x = 0; x < tile_width; ++x) {
                    const double magnitude_scale = fabs(u_values[x]);
                    const double q = exp(-2.0 * magnitude_scale);
                    const double re = copysign(1.0 - q, u_values[x]) * cos_v[y];
                    const double im = (1.0 + q) * sin_v[y];
                    pixels[row + x] = ce_color_scaled_log_polar(
                        ce_fast_atan2(im, re), magnitude_scale - 0.693147180559945309417 + ce_log_norm(re, im),
                        coefficient, average_phase, lut
                    );
                }
            }
            return 1;
        }
        case CE_FN_TANH: {
            for (uint32_t y = 0; y < tile_height; ++y) {
                const uint32_t row = y * tile_width;
                const double sin_2v = 2.0 * sin_v[y] * cos_v[y];
                const double cos_2v = cos_v[y] * cos_v[y] - sin_v[y] * sin_v[y];
                for (uint32_t x = 0; x < tile_width; ++x) {
                    const double magnitude_scale = fabs(u_values[x]);
                    const double q = exp(-2.0 * magnitude_scale);
                    const double q_sq = q * q;
                    const double denominator = 1.0 + q_sq + 2.0 * q * cos_2v;
                    const double re = copysign((1.0 - q_sq) / denominator, u_values[x]);
                    const double im = 2.0 * q * sin_2v / denominator;
                    const int average_phase = magnitude_scale < 8.0 && pixel_span_y >= CE_PI;
                    pixels[row + x] = ce_color_scaled_log_polar(
                        ce_fast_atan2(im, re), ce_log_norm(re, im), coefficient, average_phase, lut
                    );
                }
            }
            return 1;
        }
        default:
            return 0;
    }
}

static inline uint32_t ce_eval_sample_point_color_offset(const ce_map_config *config, ce_complex center, ce_complex delta,
                                                         const ce_reference_orbit_context *ref,
                                                         uint32_t orbit_mode, const ce_color_lut *lut,
                                                         const ce_complex *palette_rg, const double *palette_b,
                                                         uint32_t palette_count) {
    if (orbit_mode == 0 && !config->derivative) {
        uint32_t function_id;
        ce_complex coefficient;
        if (ce_separable_function(config, &function_id, &coefficient)) {
            return ce_separable_point_color(
                config, center.re + delta.re, center.im + delta.im, 0, lut
            );
        }
        int valid = 0;
        ce_complex val = ce_domain_value_offset(config, center, delta, ref, &valid);
        return valid ? ce_color_point_fast(val, lut) : 0xFF000000;
    }
    double r, g, b;
    ce_sample_domain_offset(config, center, delta, ref, orbit_mode, lut, palette_rg, palette_b, palette_count, &r, &g, &b);
    return ((uint32_t)255 << 24) |
        ((uint32_t)ce_domain_byte(b) << 16) |
        ((uint32_t)ce_domain_byte(g) << 8) |
        (uint32_t)ce_domain_byte(r);
}

int32_t ce_render_domain_tile(const ce_map_config *config,
                              double x_min, double x_max, double y_min, double y_max,
                              uint32_t frame_width, uint32_t frame_height,
                              uint32_t tile_x, uint32_t tile_y,
                              uint32_t tile_width, uint32_t tile_height, uint32_t scale,
                              uint32_t orbit_mode, const ce_domain_render_context *render_context,
                              uint32_t adaptive_quality,
                              uint8_t *rgba) {
    if (!config || !render_context || !rgba || !frame_width || !frame_height ||
        !tile_width || !tile_height || !scale || !config->chain_count || config->chain_count > 1024u ||
        orbit_mode > 3u || !isfinite(x_min) || !isfinite(x_max) || !isfinite(y_min) || !isfinite(y_max) ||
        !(x_max > x_min) || !(y_max > y_min)) return -1;
    if (adaptive_quality && (scale != 1u || tile_width > 512u || tile_height > 512u)) return -2;
    const ce_color_lut *lut = &render_context->lut;
    const ce_complex *palette_rg = render_context->palette_rg;
    const double *palette_b = render_context->palette_b;
    const uint32_t palette_count = render_context->palette_count;

    int base_rendered = 0;
    if (orbit_mode == 0) {
        base_rendered = ce_render_separable_tile(config, x_min, x_max, y_min, y_max, frame_width, frame_height,
                                                 tile_x, tile_y, tile_width, tile_height, scale, lut, rgba);
        if (base_rendered && !adaptive_quality) {
            return 0;
        }
    }

    const double x_span = x_max - x_min;
    const double y_span = y_max - y_min;
    const double c_re = (x_min + x_max) * 0.5;
    const double c_im = (y_min + y_max) * 0.5;
    const ce_complex center = { c_re, c_im };
    const double inv_w = 1.0 / (double)frame_width;
    const double inv_h = 1.0 / (double)frame_height;
    uint32_t *pixels = (uint32_t *)rgba;

    const ce_reference_orbit_context *ref_ptr = render_context->reference;

    if (!base_rendered) {
        for (uint32_t y = 0; y < tile_height; ++y) {
            const double norm_y = 0.5 - (tile_y + y + 0.5) * scale * inv_h;
            const double dy = norm_y * y_span;
            for (uint32_t x = 0; x < tile_width; ++x) {
                const double norm_x = (tile_x + x + 0.5) * scale * inv_w - 0.5;
                const double dx = norm_x * x_span;
                const ce_complex delta = { dx, dy };
                pixels[y * tile_width + x] = ce_eval_sample_point_color_offset(config, center, delta, ref_ptr, orbit_mode, lut, palette_rg, palette_b, palette_count);
            }
        }
    }

    // Quality refinement: adaptive 4-neighbor edge detection and 4x4 (16-sample) subpixel anti-aliasing
    if (adaptive_quality && scale == 1 && tile_width <= 512 && tile_height <= 512) {
        static uint8_t edge_mask[512 * 512];
        const uint32_t total_tile_pixels = tile_width * tile_height;
        memset(edge_mask, 0, total_tile_pixels);
        {
            const int threshold = 80;
            int edge_count = 0;

            // Horizontal neighbor edge detection
            for (uint32_t y = 0; y < tile_height; ++y) {
                const uint32_t row = y * tile_width;
                for (uint32_t x = 0; x < tile_width - 1; ++x) {
                    const uint32_t c1 = pixels[row + x];
                    const uint32_t c2 = pixels[row + x + 1];
                    const int dr = abs((int)(c1 & 0xFF) - (int)(c2 & 0xFF));
                    const int dg = abs((int)((c1 >> 8) & 0xFF) - (int)((c2 >> 8) & 0xFF));
                    const int db = abs((int)((c1 >> 16) & 0xFF) - (int)((c2 >> 16) & 0xFF));
                    if (dr >= threshold || dg >= threshold || db >= threshold) {
                        if (!edge_mask[row + x]) { edge_mask[row + x] = 1; edge_count++; }
                        if (!edge_mask[row + x + 1]) { edge_mask[row + x + 1] = 1; edge_count++; }
                    }
                }
                if (tile_x + tile_width < frame_width) {
                    const double dx = ((tile_x + tile_width + 0.5) * scale * inv_w - 0.5) * x_span;
                    const double dy = (0.5 - (tile_y + y + 0.5) * scale * inv_h) * y_span;
                    const uint32_t c1 = pixels[row + tile_width - 1];
                    const uint32_t c2 = ce_eval_sample_point_color_offset(config, center, (ce_complex){dx, dy}, ref_ptr, orbit_mode, lut, palette_rg, palette_b, palette_count);
                    const int dr = abs((int)(c1 & 0xFF) - (int)(c2 & 0xFF));
                    const int dg = abs((int)((c1 >> 8) & 0xFF) - (int)((c2 >> 8) & 0xFF));
                    const int db = abs((int)((c1 >> 16) & 0xFF) - (int)((c2 >> 16) & 0xFF));
                    if (dr >= threshold || dg >= threshold || db >= threshold) {
                        if (!edge_mask[row + tile_width - 1]) { edge_mask[row + tile_width - 1] = 1; edge_count++; }
                    }
                }
                if (tile_x > 0) {
                    const double dx = ((tile_x - 0.5) * scale * inv_w - 0.5) * x_span;
                    const double dy = (0.5 - (tile_y + y + 0.5) * scale * inv_h) * y_span;
                    const uint32_t c1 = pixels[row];
                    const uint32_t c2 = ce_eval_sample_point_color_offset(config, center, (ce_complex){dx, dy}, ref_ptr, orbit_mode, lut, palette_rg, palette_b, palette_count);
                    const int dr = abs((int)(c1 & 0xFF) - (int)(c2 & 0xFF));
                    const int dg = abs((int)((c1 >> 8) & 0xFF) - (int)((c2 >> 8) & 0xFF));
                    const int db = abs((int)((c1 >> 16) & 0xFF) - (int)((c2 >> 16) & 0xFF));
                    if (dr >= threshold || dg >= threshold || db >= threshold) {
                        if (!edge_mask[row]) { edge_mask[row] = 1; edge_count++; }
                    }
                }
            }

            // Vertical neighbor edge detection
            for (uint32_t y = 0; y < tile_height - 1; ++y) {
                const uint32_t row1 = y * tile_width;
                const uint32_t row2 = (y + 1) * tile_width;
                for (uint32_t x = 0; x < tile_width; ++x) {
                    const uint32_t c1 = pixels[row1 + x];
                    const uint32_t c2 = pixels[row2 + x];
                    const int dr = abs((int)(c1 & 0xFF) - (int)(c2 & 0xFF));
                    const int dg = abs((int)((c1 >> 8) & 0xFF) - (int)((c2 >> 8) & 0xFF));
                    const int db = abs((int)((c1 >> 16) & 0xFF) - (int)((c2 >> 16) & 0xFF));
                    if (dr >= threshold || dg >= threshold || db >= threshold) {
                        if (!edge_mask[row1 + x]) { edge_mask[row1 + x] = 1; edge_count++; }
                        if (!edge_mask[row2 + x]) { edge_mask[row2 + x] = 1; edge_count++; }
                    }
                }
            }

            // Bottom halo
            if (tile_y + tile_height < frame_height) {
                const uint32_t row = (tile_height - 1) * tile_width;
                const double dy = (0.5 - (tile_y + tile_height + 0.5) * scale * inv_h) * y_span;
                for (uint32_t x = 0; x < tile_width; ++x) {
                    const double dx = ((tile_x + x + 0.5) * scale * inv_w - 0.5) * x_span;
                    const uint32_t c1 = pixels[row + x];
                    const uint32_t c2 = ce_eval_sample_point_color_offset(config, center, (ce_complex){dx, dy}, ref_ptr, orbit_mode, lut, palette_rg, palette_b, palette_count);
                    const int dr = abs((int)(c1 & 0xFF) - (int)(c2 & 0xFF));
                    const int dg = abs((int)((c1 >> 8) & 0xFF) - (int)((c2 >> 8) & 0xFF));
                    const int db = abs((int)((c1 >> 16) & 0xFF) - (int)((c2 >> 16) & 0xFF));
                    if (dr >= threshold || dg >= threshold || db >= threshold) {
                        if (!edge_mask[row + x]) { edge_mask[row + x] = 1; edge_count++; }
                    }
                }
            }

            // Top halo
            if (tile_y > 0) {
                const double dy = (0.5 - (tile_y - 0.5) * scale * inv_h) * y_span;
                for (uint32_t x = 0; x < tile_width; ++x) {
                    const double dx = ((tile_x + x + 0.5) * scale * inv_w - 0.5) * x_span;
                    const uint32_t c1 = pixels[x];
                    const uint32_t c2 = ce_eval_sample_point_color_offset(config, center, (ce_complex){dx, dy}, ref_ptr, orbit_mode, lut, palette_rg, palette_b, palette_count);
                    const int dr = abs((int)(c1 & 0xFF) - (int)(c2 & 0xFF));
                    const int dg = abs((int)((c1 >> 8) & 0xFF) - (int)((c2 >> 8) & 0xFF));
                    const int db = abs((int)((c1 >> 16) & 0xFF) - (int)((c2 >> 16) & 0xFF));
                    if (dr >= threshold || dg >= threshold || db >= threshold) {
                        if (!edge_mask[x]) { edge_mask[x] = 1; edge_count++; }
                    }
                }
            }

            if (edge_count > 0) {
                static const double sub_dx[4] = { -0.375, 0.125, 0.375, -0.125 };
                static const double sub_dy[4] = { -0.125, -0.375, 0.125, 0.375 };
                for (uint32_t y = 0; y < tile_height; ++y) {
                    const uint32_t row = y * tile_width;
                    for (uint32_t x = 0; x < tile_width; ++x) {
                        if (!edge_mask[row + x]) continue;
                        double sum_r = 0.0, sum_g = 0.0, sum_b = 0.0;
                        for (int s = 0; s < 4; ++s) {
                            const double sub_y = y + 0.5 + sub_dy[s];
                            const double dy = (0.5 - (tile_y + sub_y) * scale * inv_h) * y_span;
                            const double sub_x = x + 0.5 + sub_dx[s];
                            const double dx = ((tile_x + sub_x) * scale * inv_w - 0.5) * x_span;
                            const uint32_t packed = ce_eval_sample_point_color_offset(config, center, (ce_complex){dx, dy}, ref_ptr, orbit_mode, lut, palette_rg, palette_b, palette_count);
                            sum_r += (packed & 0xFF);
                            sum_g += ((packed >> 8) & 0xFF);
                            sum_b += ((packed >> 16) & 0xFF);
                        }
                        const uint8_t avg_r = (uint8_t)(sum_r * 0.25 + 0.5);
                        const uint8_t avg_g = (uint8_t)(sum_g * 0.25 + 0.5);
                        const uint8_t avg_b = (uint8_t)(sum_b * 0.25 + 0.5);
                        pixels[row + x] = ((uint32_t)255 << 24) | ((uint32_t)avg_b << 16) | ((uint32_t)avg_g << 8) | (uint32_t)avg_r;
                    }
                }
            }
        }
    }

    return 0;
}
