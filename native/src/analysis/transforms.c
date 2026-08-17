#include "complex_engine.h"

#include <math.h>
#include <stdlib.h>

#define CE_TWO_PI 6.283185307179586476925286766559

int32_t ce_compute_dft(const ce_complex *input, uint32_t count, ce_complex *output) {
    if (!input || !output || !count) return -1;
    uint32_t padded = 1;
    while (padded < count) padded <<= 1u;
    ce_complex *data = calloc(padded, sizeof(ce_complex));
    if (!data) return -2;
    for (uint32_t i = 0; i < count; ++i) data[i] = input[i];
    uint32_t reversed = 0;
    for (uint32_t i = 0; i + 1 < padded; ++i) {
        if (i < reversed) {
            ce_complex temporary = data[i]; data[i] = data[reversed]; data[reversed] = temporary;
        }
        uint32_t bit = padded >> 1u;
        while (bit <= reversed) { reversed -= bit; bit >>= 1u; }
        reversed += bit;
    }
    for (uint32_t size = 2; size <= padded; size <<= 1u) {
        const uint32_t half = size >> 1u;
        const double angle = -CE_TWO_PI / size;
        const double step_re = cos(angle), step_im = sin(angle);
        for (uint32_t offset = 0; offset < padded; offset += size) {
            double unit_re = 1.0, unit_im = 0.0;
            for (uint32_t k = 0; k < half; ++k) {
                const ce_complex even = data[offset + k];
                const ce_complex odd = data[offset + k + half];
                const double product_re = unit_re * odd.re - unit_im * odd.im;
                const double product_im = unit_re * odd.im + unit_im * odd.re;
                data[offset + k].re = even.re + product_re;
                data[offset + k].im = even.im + product_im;
                data[offset + k + half].re = even.re - product_re;
                data[offset + k + half].im = even.im - product_im;
                const double next_re = unit_re * step_re - unit_im * step_im;
                unit_im = unit_re * step_im + unit_im * step_re;
                unit_re = next_re;
            }
        }
    }
    const double inverse_count = 1.0 / count;
    for (uint32_t i = 0; i < count; ++i) {
        output[i].re = data[i].re * inverse_count;
        output[i].im = data[i].im * inverse_count;
    }
    free(data);
    return 0;
}

int32_t ce_build_fourier_winding(const ce_complex *signal, const double *times,
                                 uint32_t count, double frequency, double progress,
                                 ce_complex *wound, ce_complex *center) {
    if (!signal || !times || !wound || !center || !count) return -1;
    uint32_t visible = progress <= 0.0 ? 1 : (uint32_t)floor(progress * (count - 1)) + 1;
    if (visible > count) visible = count;
    double sum_re = 0.0, sum_im = 0.0;
    for (uint32_t i = 0; i < visible; ++i) {
        const double angle = -CE_TWO_PI * frequency * times[i];
        const double cosine = cos(angle), sine = sin(angle);
        wound[i].re = signal[i].re * cosine - signal[i].im * sine;
        wound[i].im = signal[i].re * sine + signal[i].im * cosine;
        sum_re += wound[i].re;
        sum_im += wound[i].im;
    }
    center->re = sum_re / visible;
    center->im = sum_im / visible;
    return (int32_t)visible;
}

int32_t ce_compute_laplace_samples(const ce_complex *signal, const double *times,
                                   uint32_t count, const ce_complex *s_values,
                                   uint32_t s_count, ce_complex *output) {
    if (!signal || !times || !s_values || !output || count < 2) return -1;
    for (uint32_t j = 0; j < s_count; ++j) {
        double sum_re = 0.0, sum_im = 0.0;
        for (uint32_t i = 0; i + 1 < count; ++i) {
            const double dt = times[i + 1] - times[i];
            const double angle = -s_values[j].im * times[i];
            const double magnitude = exp(-s_values[j].re * times[i]);
            const double weight_re = magnitude * cos(angle);
            const double weight_im = magnitude * sin(angle);
            sum_re += (signal[i].re * weight_re - signal[i].im * weight_im) * dt;
            sum_im += (signal[i].re * weight_im + signal[i].im * weight_re) * dt;
        }
        output[j].re = sum_re;
        output[j].im = sum_im;
    }
    return 0;
}
