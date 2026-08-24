#include "complex_engine.h"
#include "ce_limits.h"
#include "domain_internal.h"

#include <math.h>
#include <stdlib.h>

#define CE_PI 3.141592653589793238462643383279502884
#define CE_TWO_PI (2.0 * CE_PI)
#define CE_INV_TWO_PI (1.0 / (2.0 * CE_PI))
#define CE_HUE_LUT_SIZE 4096
#define CE_INV_HUE_LUT_SIZE (1.0 / (double)CE_HUE_LUT_SIZE)

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

void ce_domain_color_log_polar(double phase, double log_magnitude,
                               const ce_complex *palette_rg, const double *palette_b,
                               uint32_t palette_count, double brightness, double contrast,
                               double saturation, double cycles,
                               double *red, double *green, double *blue) {
    if (!isfinite(phase) || isnan(log_magnitude)) { *red = *green = *blue = 0.0; return; }
    double hue = phase * CE_INV_TWO_PI;
    if (hue < 0.0) hue += 1.0;
    double base_lightness = 0.5;
    if (cycles > 0.0001) {
        const double tone = ce_magnitude_tone(log_magnitude, cycles);
        base_lightness = 0.34 + (0.72 - 0.34) * tone;
    }
    const double lightness = ce_clamp((0.5 + (base_lightness - 0.5) * contrast) * brightness, 0.05, 0.95);
    double base_red, base_green, base_blue;
    ce_palette_color(palette_rg, palette_b, palette_count, hue, &base_red, &base_green, &base_blue);
    ce_styled_color(base_red, base_green, base_blue, lightness, ce_clamp(saturation, 0.0, 1.0), red, green, blue);
}

void ce_domain_color(ce_complex value, const ce_complex *palette_rg, const double *palette_b,
                     uint32_t palette_count, double brightness, double contrast,
                     double saturation, double cycles, double *red, double *green, double *blue) {
    if (!ce_domain_valid(value)) { *red = *green = *blue = 0.0; return; }
    ce_domain_color_log_polar(
        ce_fast_atan2(value.im, value.re), ce_log_magnitude(value),
        palette_rg, palette_b, palette_count, brightness, contrast,
        saturation, cycles, red, green, blue
    );
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
