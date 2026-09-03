#include "complex_engine.h"

#include <math.h>

#define CE_PI 3.14159265358979323846
#define CE_LAPLACE_DENOMINATOR_EPSILON 0.001
#define CE_LAPLACE_WIDTH 6.8
#define CE_LAPLACE_DEPTH 6.2
#define CE_LAPLACE_HEIGHT 4.4

enum ce_laplace_function {
    CE_LAPLACE_STEP = 0,
    CE_LAPLACE_EXPONENTIAL = 1,
    CE_LAPLACE_SINE = 2,
    CE_LAPLACE_COSINE = 3,
    CE_LAPLACE_DAMPED_SINE = 4,
    CE_LAPLACE_DAMPED_COSINE = 5,
    CE_LAPLACE_RAMP = 6,
    CE_LAPLACE_IMPULSE = 7,
    CE_LAPLACE_EXPONENTIAL_SINE = 8,
    CE_LAPLACE_UNDERDAMPED = 9,
    CE_LAPLACE_CRITICALLY_DAMPED = 10,
    CE_LAPLACE_OVERDAMPED = 11
};

static ce_complex ce_laplace_reciprocal(double re, double im) {
    const double denominator = re * re + im * im;
    if (!(denominator > CE_LAPLACE_DENOMINATOR_EPSILON)) {
        const ce_complex zero = {0.0, 0.0};
        return zero;
    }
    const ce_complex result = {re / denominator, -im / denominator};
    return result;
}

static ce_complex ce_laplace_closed(uint32_t function_id, double sigma, double omega_s,
                                    double frequency, double damping, double amplitude) {
    const double omega = 2.0 * CE_PI * frequency;
    ce_complex result = {0.0, 0.0};
    if (function_id == CE_LAPLACE_STEP) {
        result = ce_laplace_reciprocal(sigma, omega_s);
    } else if (function_id == CE_LAPLACE_EXPONENTIAL) {
        result = ce_laplace_reciprocal(sigma + damping, omega_s);
    } else if (function_id == CE_LAPLACE_SINE || function_id == CE_LAPLACE_DAMPED_SINE ||
               function_id == CE_LAPLACE_EXPONENTIAL_SINE || function_id == CE_LAPLACE_UNDERDAMPED) {
        double shift = 0.0;
        double numerator = omega;
        if (function_id == CE_LAPLACE_DAMPED_SINE) shift = damping;
        else if (function_id == CE_LAPLACE_EXPONENTIAL_SINE) shift = -damping * 0.3;
        else if (function_id == CE_LAPLACE_UNDERDAMPED) {
            shift = 0.3 * omega;
            numerator = omega * sqrt(1.0 - 0.3 * 0.3);
        }
        const double shifted_re = sigma + shift;
        const double denominator_re = shifted_re * shifted_re - omega_s * omega_s + numerator * numerator;
        const double denominator_im = 2.0 * shifted_re * omega_s;
        const double denominator = denominator_re * denominator_re + denominator_im * denominator_im;
        if (denominator > CE_LAPLACE_DENOMINATOR_EPSILON) {
            result.re = numerator * denominator_re / denominator;
            result.im = -numerator * denominator_im / denominator;
        }
    } else if (function_id == CE_LAPLACE_COSINE || function_id == CE_LAPLACE_DAMPED_COSINE) {
        const double shifted_re = sigma + (function_id == CE_LAPLACE_DAMPED_COSINE ? damping : 0.0);
        const double denominator_re = shifted_re * shifted_re - omega_s * omega_s + omega * omega;
        const double denominator_im = 2.0 * shifted_re * omega_s;
        const double denominator = denominator_re * denominator_re + denominator_im * denominator_im;
        if (denominator > CE_LAPLACE_DENOMINATOR_EPSILON) {
            result.re = (shifted_re * denominator_re + omega_s * denominator_im) / denominator;
            result.im = (omega_s * denominator_re - shifted_re * denominator_im) / denominator;
        }
    } else if (function_id == CE_LAPLACE_RAMP) {
        const double square_re = sigma * sigma - omega_s * omega_s;
        const double square_im = 2.0 * sigma * omega_s;
        result = ce_laplace_reciprocal(square_re, square_im);
    } else if (function_id == CE_LAPLACE_IMPULSE) {
        result.re = 1.0;
    } else if (function_id == CE_LAPLACE_CRITICALLY_DAMPED) {
        const double shifted_re = sigma + omega;
        const double denominator_re = shifted_re * shifted_re - omega_s * omega_s;
        const double denominator_im = 2.0 * shifted_re * omega_s;
        const double denominator = denominator_re * denominator_re + denominator_im * denominator_im;
        if (denominator > CE_LAPLACE_DENOMINATOR_EPSILON) {
            const double numerator_re = sigma + 2.0 * omega;
            result.re = (numerator_re * denominator_re + omega_s * denominator_im) / denominator;
            result.im = (omega_s * denominator_re - numerator_re * denominator_im) / denominator;
        }
    } else if (function_id == CE_LAPLACE_OVERDAMPED) {
        const double root = sqrt(1.5 * 1.5 - 1.0);
        const double pole1 = (-1.5 + root) * omega;
        const double pole2 = (-1.5 - root) * omega;
        const ce_complex first = ce_laplace_reciprocal(sigma - pole1, omega_s);
        const ce_complex second = ce_laplace_reciprocal(sigma - pole2, omega_s);
        result.re = 0.5 * (first.re + second.re);
        result.im = 0.5 * (first.im + second.im);
    }
    result.re *= amplitude;
    result.im *= amplitude;
    return result;
}

static double ce_laplace_signal(uint32_t function_id, double t, double dt,
                                double omega, double damping, double amplitude) {
    switch (function_id) {
        case CE_LAPLACE_STEP: return amplitude;
        case CE_LAPLACE_EXPONENTIAL: return amplitude * exp(-damping * t);
        case CE_LAPLACE_SINE: return amplitude * sin(omega * t);
        case CE_LAPLACE_COSINE: return amplitude * cos(omega * t);
        case CE_LAPLACE_DAMPED_SINE: return amplitude * exp(-damping * t) * sin(omega * t);
        case CE_LAPLACE_DAMPED_COSINE: return amplitude * exp(-damping * t) * cos(omega * t);
        case CE_LAPLACE_RAMP: return amplitude * t;
        case CE_LAPLACE_IMPULSE: return t < dt * 2.0 ? amplitude / dt : 0.0;
        case CE_LAPLACE_EXPONENTIAL_SINE: return amplitude * exp(damping * 0.3 * t) * sin(omega * t);
        case CE_LAPLACE_UNDERDAMPED: {
            const double damped = omega * sqrt(1.0 - 0.3 * 0.3);
            return amplitude * exp(-0.3 * omega * t) * sin(damped * t);
        }
        case CE_LAPLACE_CRITICALLY_DAMPED:
            return amplitude * (1.0 + omega * t) * exp(-omega * t);
        case CE_LAPLACE_OVERDAMPED: {
            const double root = sqrt(1.5 * 1.5 - 1.0);
            return amplitude * 0.5 * (exp((-1.5 + root) * omega * t) +
                                      exp((-1.5 - root) * omega * t));
        }
        default: return NAN;
    }
}

int32_t ce_generate_laplace_analysis(uint32_t function_id, double frequency,
                                     double damping, double amplitude,
                                     double time_window, uint32_t sample_count,
                                     double *times, double *signal,
                                     ce_complex *poles, uint32_t *pole_orders,
                                     ce_complex *zeros, uint32_t *pole_count,
                                     uint32_t *zero_count, double *roc_boundary) {
    if (function_id > CE_LAPLACE_OVERDAMPED || !sample_count || !times || !signal ||
        !poles || !pole_orders || !zeros || !pole_count || !zero_count || !roc_boundary) return -1;
    const double dt = time_window / sample_count;
    const double omega = 2.0 * CE_PI * frequency;
    for (uint32_t index = 0; index < sample_count; ++index) {
        times[index] = index * dt;
        signal[index] = ce_laplace_signal(function_id, times[index], dt, omega, damping, amplitude);
    }
    *pole_count = 0;
    *zero_count = 0;
    if (function_id == CE_LAPLACE_STEP) {
        poles[0] = (ce_complex){0.0, 0.0}; pole_orders[0] = 1u; *pole_count = 1u;
    } else if (function_id == CE_LAPLACE_EXPONENTIAL) {
        poles[0] = (ce_complex){-damping, 0.0}; pole_orders[0] = 1u; *pole_count = 1u;
    } else if (function_id == CE_LAPLACE_SINE || function_id == CE_LAPLACE_COSINE) {
        poles[0] = (ce_complex){0.0, omega}; poles[1] = (ce_complex){0.0, -omega};
        pole_orders[0] = pole_orders[1] = 1u; *pole_count = 2u;
        if (function_id == CE_LAPLACE_SINE) { zeros[0] = (ce_complex){0.0, 0.0}; *zero_count = 1u; }
    } else if (function_id == CE_LAPLACE_DAMPED_SINE || function_id == CE_LAPLACE_DAMPED_COSINE) {
        poles[0] = (ce_complex){-damping, omega}; poles[1] = (ce_complex){-damping, -omega};
        pole_orders[0] = pole_orders[1] = 1u; *pole_count = 2u;
        if (function_id == CE_LAPLACE_DAMPED_COSINE) {
            zeros[0] = (ce_complex){-damping, 0.0}; *zero_count = 1u;
        }
    } else if (function_id == CE_LAPLACE_RAMP) {
        poles[0] = (ce_complex){0.0, 0.0}; pole_orders[0] = 2u; *pole_count = 1u;
    } else if (function_id == CE_LAPLACE_EXPONENTIAL_SINE) {
        poles[0] = (ce_complex){damping * 0.3, omega};
        poles[1] = (ce_complex){damping * 0.3, -omega};
        pole_orders[0] = pole_orders[1] = 1u; *pole_count = 2u;
    } else if (function_id == CE_LAPLACE_UNDERDAMPED) {
        const double damped = omega * sqrt(1.0 - 0.3 * 0.3);
        poles[0] = (ce_complex){-0.3 * omega, damped};
        poles[1] = (ce_complex){-0.3 * omega, -damped};
        pole_orders[0] = pole_orders[1] = 1u; *pole_count = 2u;
    } else if (function_id == CE_LAPLACE_CRITICALLY_DAMPED) {
        poles[0] = (ce_complex){-omega, 0.0}; pole_orders[0] = 2u; *pole_count = 1u;
    } else if (function_id == CE_LAPLACE_OVERDAMPED) {
        const double root = sqrt(1.5 * 1.5 - 1.0);
        poles[0] = (ce_complex){(-1.5 + root) * omega, 0.0};
        poles[1] = (ce_complex){(-1.5 - root) * omega, 0.0};
        pole_orders[0] = pole_orders[1] = 1u; *pole_count = 2u;
    }
    if (!*pole_count) *roc_boundary = NAN;
    else {
        *roc_boundary = poles[0].re;
        for (uint32_t index = 1; index < *pole_count; ++index) {
            if (poles[index].re > *roc_boundary) *roc_boundary = poles[index].re;
        }
    }
    return 0;
}

int32_t ce_build_laplace_surface(uint32_t function_id, double frequency,
                                 double damping, double amplitude,
                                 double sigma_min, double sigma_max,
                                 double omega_min, double omega_max,
                                 uint32_t sigma_steps, uint32_t omega_steps,
                                 uint32_t mode, double clip_height,
                                 float *positions, float *normals,
                                 float *magnitudes, float *phases,
                                 uint32_t *indices) {
    if (function_id > CE_LAPLACE_OVERDAMPED || !sigma_steps || !omega_steps ||
        !(clip_height > 0.0) || mode > 2u || !positions || !normals ||
        !magnitudes || !phases || !indices) return -1;
    const uint32_t columns = sigma_steps + 1u;
    const uint32_t rows = omega_steps + 1u;
    const double sigma_step = (sigma_max - sigma_min) / sigma_steps;
    const double omega_step = (omega_max - omega_min) / omega_steps;
    const double log_clip = log1p(clip_height);
    for (uint32_t row = 0; row < rows; ++row) {
        const double omega_s = omega_min + row * omega_step;
        for (uint32_t column = 0; column < columns; ++column) {
            const double sigma = sigma_min + column * sigma_step;
            const uint32_t index = row * columns + column;
            const uint32_t offset = index * 3u;
            const ce_complex value = ce_laplace_closed(
                function_id, sigma, omega_s, frequency, damping, amplitude
            );
            const double magnitude = fmin(fmax(0.0, hypot(value.re, value.im)), clip_height);
            const double magnitude_ratio = log1p(magnitude) / log_clip;
            const double phase = atan2(value.im, value.re);
            magnitudes[index] = (float)magnitude;
            phases[index] = (float)phase;
            positions[offset] = (float)(((sigma - (sigma_min + sigma_max) * 0.5) /
                                         (sigma_max - sigma_min)) * CE_LAPLACE_WIDTH);
            positions[offset + 1u] = (float)(mode == 1u
                ? fmax(-1.0, fmin(1.0, phase / CE_PI)) * (CE_LAPLACE_HEIGHT * 0.5)
                : magnitude_ratio * CE_LAPLACE_HEIGHT);
            positions[offset + 2u] = (float)(((omega_s - (omega_min + omega_max) * 0.5) /
                                              (omega_max - omega_min)) * CE_LAPLACE_DEPTH);
        }
    }

    for (uint32_t row = 0; row < rows; ++row) {
        const uint32_t down = row ? row - 1u : row;
        const uint32_t up = row < omega_steps ? row + 1u : row;
        for (uint32_t column = 0; column < columns; ++column) {
            const uint32_t left = column ? column - 1u : column;
            const uint32_t right = column < sigma_steps ? column + 1u : column;
            const uint32_t index = row * columns + column;
            const float dx = positions[(row * columns + right) * 3u + 1u] -
                             positions[(row * columns + left) * 3u + 1u];
            const float dz = positions[(up * columns + column) * 3u + 1u] -
                             positions[(down * columns + column) * 3u + 1u];
            const float sx = positions[(row * columns + right) * 3u] -
                             positions[(row * columns + left) * 3u];
            const float sz = positions[(up * columns + column) * 3u + 2u] -
                             positions[(down * columns + column) * 3u + 2u];
            const float nx = sx != 0.0f ? -dx / sx : 0.0f;
            const float nz = sz != 0.0f ? -dz / sz : 0.0f;
            const float inverse = 1.0f / sqrtf(nx * nx + nz * nz + 1.0f);
            normals[index * 3u] = nx * inverse;
            normals[index * 3u + 1u] = inverse;
            normals[index * 3u + 2u] = nz * inverse;
        }
    }

    uint32_t cursor = 0;
    for (uint32_t row = 0; row < omega_steps; ++row) {
        for (uint32_t column = 0; column < sigma_steps; ++column) {
            const uint32_t a = row * columns + column;
            const uint32_t b = a + 1u;
            const uint32_t c = a + columns;
            const uint32_t d = c + 1u;
            indices[cursor++] = a; indices[cursor++] = c; indices[cursor++] = b;
            indices[cursor++] = b; indices[cursor++] = c; indices[cursor++] = d;
        }
    }
    return (int32_t)cursor;
}
