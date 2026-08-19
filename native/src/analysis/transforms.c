#include "complex_engine.h"

#include <math.h>
#include <stdlib.h>

#define CE_TWO_PI 6.283185307179586476925286766559

int32_t ce_generate_fourier_signal(uint32_t signal_type, double frequency, double amplitude,
                                  double time_window, uint32_t sample_count, uint32_t random_seed,
                                  double *times, double *values) {
    if (!times || !values || !sample_count || time_window <= 0.0) return -1;
    const double dt = time_window / (double)sample_count;
    const double omega = CE_TWO_PI * frequency;
    uint32_t lcg_state = random_seed ? random_seed : 123456789u;

    for (uint32_t i = 0; i < sample_count; ++i) {
        const double t = (double)i * dt;
        times[i] = t;
        double value = 0.0;

        switch (signal_type) {
            case 0: // sine
                value = amplitude * sin(omega * t);
                break;
            case 1: // cosine
                value = amplitude * cos(omega * t);
                break;
            case 2: { // square
                const double s = sin(omega * t);
                value = amplitude * (s > 0.0 ? 1.0 : (s < 0.0 ? -1.0 : 0.0));
                break;
            }
            case 3: { // sawtooth
                const double phase = fmod(omega * t / CE_TWO_PI, 1.0);
                const double normalized = phase < 0.0 ? phase + 1.0 : phase;
                value = amplitude * (2.0 * normalized - 1.0);
                break;
            }
            case 4: { // triangle
                const double phase = fmod(omega * t / CE_TWO_PI, 1.0);
                const double normalized = phase < 0.0 ? phase + 1.0 : phase;
                value = amplitude * (4.0 * fabs(normalized - 0.5) - 1.0);
                break;
            }
            case 5: { // am
                const double carrier = omega;
                const double modulation = omega / 4.0;
                value = amplitude * (1.0 + 0.5 * sin(modulation * t)) * sin(carrier * t);
                break;
            }
            case 6: { // fm
                const double modulation_index = 2.0;
                const double mod_freq = omega / 5.0;
                value = amplitude * sin(omega * t + modulation_index * sin(mod_freq * t));
                break;
            }
            case 7: { // chirp
                const double start_freq = omega;
                const double end_freq = omega * 3.0;
                const double instant_freq = start_freq + (end_freq - start_freq) * (t / time_window);
                value = amplitude * sin(instant_freq * t);
                break;
            }
            case 8: { // damped_sine
                const double damping_factor = 1.5 / time_window;
                value = amplitude * exp(-damping_factor * t) * sin(omega * t);
                break;
            }
            case 9: { // exponential
                const double decay_rate = 2.0 / time_window;
                value = amplitude * exp(-decay_rate * t);
                break;
            }
            case 10: { // gaussian
                const double sigma = time_window / 8.0;
                const double center = time_window / 2.0;
                const double delta = t - center;
                value = amplitude * exp(-(delta * delta) / (2.0 * sigma * sigma));
                break;
            }
            case 11: { // pulse
                const double pulse_start = time_window * 0.3;
                const double pulse_end = time_window * 0.7;
                value = (t >= pulse_start && t <= pulse_end) ? amplitude : 0.0;
                break;
            }
            case 12: { // harmonics
                value = 0.0;
                for (int h = 1; h <= 5; ++h) {
                    value += (amplitude / (double)h) * sin((double)h * omega * t);
                }
                break;
            }
            case 13: { // beat
                const double freq1 = omega;
                const double freq2 = omega * 1.1;
                value = amplitude * 0.5 * (sin(freq1 * t) + sin(freq2 * t));
                break;
            }
            case 14: { // noise
                lcg_state = lcg_state * 1664525u + 1013904223u;
                const double unit = (double)(lcg_state & 0x00ffffffu) / (double)0x00ffffffu;
                value = amplitude * (2.0 * unit - 1.0);
                break;
            }
            default:
                value = amplitude * sin(omega * t);
                break;
        }
        values[i] = value;
    }
    return 0;
}

int32_t ce_compute_fourier_spectrum(const double *values, uint32_t count,
                                   double *frequencies, double *reals, double *imags,
                                   double *magnitudes, double *phases) {
    if (!values || !count || !frequencies || !reals || !imags || !magnitudes || !phases) return -1;
    uint32_t padded = 1;
    while (padded < count) padded <<= 1u;
    ce_complex *data = calloc(padded, sizeof(ce_complex));
    if (!data) return -2;
    for (uint32_t i = 0; i < count; ++i) {
        data[i].re = values[i];
        data[i].im = 0.0;
    }
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
    const double inverse_count = 1.0 / (double)count;
    for (uint32_t i = 0; i < count; ++i) {
        const double real = data[i].re * inverse_count;
        const double imag = data[i].im * inverse_count;
        frequencies[i] = (double)i;
        reals[i] = real;
        imags[i] = imag;
        magnitudes[i] = hypot(real, imag);
        phases[i] = atan2(imag, real);
    }
    free(data);
    return 0;
}

int32_t ce_build_fourier_winding(const double *times, const double *values,
                                 uint32_t count, double frequency, double progress,
                                 double time_window, ce_complex *wound,
                                 ce_complex *center, double *max_amplitude) {
    if (!times || !values || !wound || !center || !max_amplitude || !count) return -1;
    const double safe_progress = progress < 0.0 ? 0.0 : (progress > 1.0 ? 1.0 : progress);
    const double safe_window = time_window > 0.0 ? time_window : 1.0;
    const double cutoff = safe_progress * safe_window;

    double max_amp = 0.0;
    uint32_t visible = 0;
    for (uint32_t i = 0; i < count; ++i) {
        const double t = times[i];
        const double val = values[i];
        if (!isfinite(t) || !isfinite(val)) continue;
        const double abs_val = fabs(val);
        if (abs_val > max_amp) max_amp = abs_val;
        if (t <= cutoff || visible == 0) {
            visible = i + 1u;
        }
    }
    if (visible == 0) visible = 1u;
    if (visible > count) visible = count;

    double sum_re = 0.0, sum_im = 0.0;
    for (uint32_t i = 0; i < visible; ++i) {
        const double t = times[i];
        const double val = values[i];
        const double angle = -CE_TWO_PI * frequency * t;
        const double cosine = cos(angle);
        const double sine = sin(angle);
        wound[i].re = val * cosine;
        wound[i].im = val * sine;
        sum_re += wound[i].re;
        sum_im += wound[i].im;
    }
    center->re = sum_re / (double)visible;
    center->im = sum_im / (double)visible;
    *max_amplitude = max_amp;
    return (int32_t)visible;
}
