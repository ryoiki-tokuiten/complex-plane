#include "complex_engine.h"
#include "expression_internal.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

#define CE_ZERO_EPSILON 1e-15
#define CE_ZERO_MAG_SQ 1e-30
#define CE_POLE_MAGNITUDE 5000.0
#define CE_MAX_FINITE 1e30
#define CE_CHAIN_BAILOUT 1e8
#define CE_EXPONENT_MAX 69.07755278982137
#define CE_EXPONENT_MIN -745.0
#define CE_PI 3.141592653589793238462643383279502884
#define CE_TWO_PI (2.0 * CE_PI)

static ce_complex ce_make(double re, double im) {
    ce_complex value = { re, im };
    return value;
}

void *ce_alloc(size_t size) { return malloc(size); }
void ce_free(void *pointer) { free(pointer); }
uint32_t ce_abi_version(void) { return 1; }

ce_complex ce_add(ce_complex a, ce_complex b) {
    return ce_make(a.re + b.re, a.im + b.im);
}

ce_complex ce_sub(ce_complex a, ce_complex b) {
    return ce_make(a.re - b.re, a.im - b.im);
}

ce_complex ce_mul(ce_complex a, ce_complex b) {
    return ce_make(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}

ce_complex ce_div(ce_complex numerator, ce_complex denominator) {
    const double abs_re = fabs(denominator.re);
    const double abs_im = fabs(denominator.im);
    const double scale = fmax(abs_re, abs_im);

    if (scale < CE_ZERO_EPSILON) {
        const double mag_sq = numerator.re * numerator.re + numerator.im * numerator.im;
        if (mag_sq < CE_ZERO_MAG_SQ) return ce_make(NAN, NAN);
        if (fabs(numerator.re) < CE_ZERO_EPSILON && fabs(numerator.im) < CE_ZERO_EPSILON) {
            return ce_make(0.0, 0.0);
        }
        const double safe_scale = (CE_POLE_MAGNITUDE * 2.0) / sqrt(mag_sq);
        return ce_make(numerator.re * safe_scale, numerator.im * safe_scale);
    }

    if (abs_re >= abs_im) {
        const double ratio = denominator.im / denominator.re;
        const double divisor = denominator.re + denominator.im * ratio;
        return ce_make(
            (numerator.re + numerator.im * ratio) / divisor,
            (numerator.im - numerator.re * ratio) / divisor
        );
    }

    const double ratio = denominator.re / denominator.im;
    const double divisor = denominator.im + denominator.re * ratio;
    return ce_make(
        (numerator.re * ratio + numerator.im) / divisor,
        (numerator.im * ratio - numerator.re) / divisor
    );
}

static double ce_exp_safe(double value) {
    if (value > CE_EXPONENT_MAX) return exp(CE_EXPONENT_MAX);
    if (value < CE_EXPONENT_MIN) return 0.0;
    return exp(value);
}

static double ce_log_hypot(double re, double im) {
    const double abs_re = fabs(re);
    const double abs_im = fabs(im);
    const double scale = fmax(abs_re, abs_im);
    if (scale == 0.0) return -INFINITY;
    if (scale < 1e154 && scale > 1e-154) return 0.5 * log(re * re + im * im);
    return log(hypot(re, im));
}

static ce_complex ce_exp(ce_complex z) {
    const double magnitude = ce_exp_safe(z.re);
    return ce_make(magnitude * cos(z.im), magnitude * sin(z.im));
}

static ce_complex ce_log(ce_complex z, const ce_function_config *config) {
    double argument = atan2(z.im, z.re);
    if (config && config->branch_cut_is_ray) {
        const double angle = config->branch_cut_angle;
        while (argument > angle) argument -= CE_TWO_PI;
        while (argument <= angle - CE_TWO_PI) argument += CE_TWO_PI;
    }
    if (z.re == 0.0 && z.im == 0.0) return ce_make(-INFINITY, 0.0);
    return ce_make(ce_log_hypot(z.re, z.im), argument);
}

static inline ce_complex ce_pow_integer(ce_complex base, int64_t exponent) {
    if (exponent == 0) return ce_make(1.0, 0.0);
    if (exponent == 1) return base;
    if (exponent == 2) {
        return ce_make(base.re * base.re - base.im * base.im, 2.0 * base.re * base.im);
    }
    if (exponent == 3) {
        const double r2 = base.re * base.re;
        const double i2 = base.im * base.im;
        return ce_make(base.re * (r2 - 3.0 * i2), base.im * (3.0 * r2 - i2));
    }
    if (exponent == 4) {
        const double r2 = base.re * base.re;
        const double i2 = base.im * base.im;
        return ce_make(r2 * r2 - 6.0 * r2 * i2 + i2 * i2, 4.0 * base.re * base.im * (r2 - i2));
    }
    if (exponent == -1) {
        const double d = base.re * base.re + base.im * base.im;
        return ce_make(base.re / d, -base.im / d);
    }
    if (exponent == -2) {
        const double z2r = base.re * base.re - base.im * base.im;
        const double z2i = 2.0 * base.re * base.im;
        const double d = z2r * z2r + z2i * z2i;
        return ce_make(z2r / d, -z2i / d);
    }
    const int negative = exponent < 0;
    uint64_t n = negative ? (uint64_t)(-exponent) : (uint64_t)exponent;
    ce_complex result = ce_make(1.0, 0.0);
    while (n) {
        if (n & 1u) result = ce_mul(result, base);
        n >>= 1u;
        if (n) base = ce_mul(base, base);
    }
    return negative ? ce_div(ce_make(1.0, 0.0), result) : result;
}

ce_complex ce_pow(ce_complex base, ce_complex exponent) {
    if (base.re == 0.0 && base.im == 0.0) {
        if (exponent.re > 0.0 || (exponent.re == 0.0 && exponent.im != 0.0)) return ce_make(0.0, 0.0);
        if (exponent.re == 0.0 && exponent.im == 0.0) return ce_make(1.0, 0.0);
    }
    if (exponent.im == 0.0) {
        if (isfinite(exponent.re) && floor(exponent.re) == exponent.re &&
            fabs(exponent.re) <= 9007199254740991.0) {
            return ce_pow_integer(base, (int64_t)exponent.re);
        }
        if (base.im == 0.0) {
            if (base.re >= 0.0) return ce_make(ce_exp_safe(exponent.re * log(base.re)), 0.0);
            const double magnitude = ce_exp_safe(exponent.re * log(-base.re));
            const double doubled = exponent.re * 2.0;
            if (floor(doubled) == doubled && fabs(doubled) <= 9007199254740991.0) {
                int quadrant = (int)fmod(fmod(doubled, 4.0) + 4.0, 4.0);
                if (quadrant == 0) return ce_make(magnitude, 0.0);
                if (quadrant == 1) return ce_make(0.0, magnitude);
                if (quadrant == 2) return ce_make(-magnitude, 0.0);
                return ce_make(0.0, -magnitude);
            }
            const double angle = exponent.re * CE_PI;
            return ce_make(magnitude * cos(angle), magnitude * sin(angle));
        }
        const double r_sq = base.re * base.re + base.im * base.im;
        const double p_re = exponent.re * 0.5 * log(r_sq);
        const double p_im = exponent.re * atan2(base.im, base.re);
        const double mag = ce_exp_safe(p_re);
        return ce_make(mag * cos(p_im), mag * sin(p_im));
    }
    const double log_re = ce_log_hypot(base.re, base.im);
    const double log_im = atan2(base.im, base.re);
    return ce_exp(ce_make(
        exponent.re * log_re - exponent.im * log_im,
        exponent.re * log_im + exponent.im * log_re
    ));
}

static ce_complex ce_sqrt(ce_complex z) {
    const double magnitude = hypot(z.re, z.im);
    const double re = sqrt(fmax(0.0, (magnitude + z.re) * 0.5));
    return ce_make(re, copysign(sqrt(fmax(0.0, (magnitude - z.re) * 0.5)), z.im));
}

static inline ce_complex ce_sin(ce_complex z) {
    if (fabs(z.im) > 700.0) {
        const double ey = ce_exp_safe(fabs(z.im));
        const double s = 0.5 * ey * copysign(1.0, z.im);
        return ce_make(sin(z.re) * 0.5 * ey, cos(z.re) * s);
    }
    const double ey = ce_exp_safe(z.im);
    const double ey_inv = 1.0 / ey;
    const double sinh_y = 0.5 * (ey - ey_inv);
    const double cosh_y = 0.5 * (ey + ey_inv);
    return ce_make(sin(z.re) * cosh_y, cos(z.re) * sinh_y);
}

static inline ce_complex ce_cos(ce_complex z) {
    if (fabs(z.im) > 700.0) {
        const double ey = ce_exp_safe(fabs(z.im));
        const double s = 0.5 * ey * copysign(1.0, z.im);
        return ce_make(cos(z.re) * 0.5 * ey, -sin(z.re) * s);
    }
    const double ey = ce_exp_safe(z.im);
    const double ey_inv = 1.0 / ey;
    const double sinh_y = 0.5 * (ey - ey_inv);
    const double cosh_y = 0.5 * (ey + ey_inv);
    return ce_make(cos(z.re) * cosh_y, -sin(z.re) * sinh_y);
}

static inline ce_complex ce_tan(ce_complex z) {
    if (fabs(z.im) > 25.0) {
        return ce_make(0.0, copysign(1.0, z.im));
    }
    const double r2 = 2.0 * z.re;
    const double i2 = 2.0 * z.im;
    const double ey = ce_exp_safe(i2);
    const double ey_inv = 1.0 / ey;
    const double sinh_2y = 0.5 * (ey - ey_inv);
    const double cosh_2y = 0.5 * (ey + ey_inv);
    const double denom = cos(r2) + cosh_2y;
    if (denom == 0.0) return ce_make(NAN, NAN);
    return ce_make(sin(r2) / denom, sinh_2y / denom);
}

static inline ce_complex ce_sec(ce_complex z) {
    if (fabs(z.im) > 30.0) return ce_make(0.0, 0.0);
    const double ey = ce_exp_safe(z.im);
    const double ey_inv = 1.0 / ey;
    const double sinh_y = 0.5 * (ey - ey_inv);
    const double cosh_y = 0.5 * (ey + ey_inv);
    const double cr = cos(z.re) * cosh_y;
    const double ci = -sin(z.re) * sinh_y;
    const double denom = cr * cr + ci * ci;
    if (denom == 0.0) return ce_make(NAN, NAN);
    return ce_make(cr / denom, -ci / denom);
}

static inline ce_complex ce_sinh(ce_complex z) {
    if (fabs(z.re) > 700.0) {
        const double ex = ce_exp_safe(fabs(z.re));
        const double s = 0.5 * ex * copysign(1.0, z.re);
        return ce_make(s * cos(z.im), 0.5 * ex * sin(z.im));
    }
    const double ex = ce_exp_safe(z.re);
    const double ex_inv = 1.0 / ex;
    const double sinh_x = 0.5 * (ex - ex_inv);
    const double cosh_x = 0.5 * (ex + ex_inv);
    return ce_make(sinh_x * cos(z.im), cosh_x * sin(z.im));
}

static inline ce_complex ce_cosh(ce_complex z) {
    if (fabs(z.re) > 700.0) {
        const double ex = ce_exp_safe(fabs(z.re));
        const double s = 0.5 * ex * copysign(1.0, z.re);
        return ce_make(0.5 * ex * cos(z.im), s * sin(z.im));
    }
    const double ex = ce_exp_safe(z.re);
    const double ex_inv = 1.0 / ex;
    const double sinh_x = 0.5 * (ex - ex_inv);
    const double cosh_x = 0.5 * (ex + ex_inv);
    return ce_make(cosh_x * cos(z.im), sinh_x * sin(z.im));
}

static inline ce_complex ce_tanh(ce_complex z) {
    if (fabs(z.re) > 30.0) {
        return ce_make(copysign(1.0, z.re), 0.0);
    }
    const double r2 = 2.0 * z.re;
    const double i2 = 2.0 * z.im;
    const double ex = ce_exp_safe(r2);
    const double ex_inv = 1.0 / ex;
    const double sinh_2x = 0.5 * (ex - ex_inv);
    const double cosh_2x = 0.5 * (ex + ex_inv);
    const double denom = cosh_2x + cos(i2);
    if (denom == 0.0) return ce_make(NAN, NAN);
    return ce_make(sinh_2x / denom, sin(i2) / denom);
}

static ce_complex ce_asin(ce_complex z) {
    ce_complex root = ce_sqrt(ce_make(1.0 - (z.re * z.re - z.im * z.im), -2.0 * z.re * z.im));
    ce_complex logarithm = ce_log(ce_make(-z.im + root.re, z.re + root.im), NULL);
    return ce_make(logarithm.im, -logarithm.re);
}

static ce_complex ce_atan(ce_complex z) {
    ce_complex upper = ce_log(ce_make(1.0 - z.im, z.re), NULL);
    ce_complex lower = ce_log(ce_make(1.0 + z.im, -z.re), NULL);
    return ce_make((upper.im - lower.im) * 0.5, -(upper.re - lower.re) * 0.5);
}

static const double ce_lanczos[] = {
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
};

static ce_complex ce_gamma(ce_complex z) {
    if (z.re < 0.5) {
        ce_complex reflected = ce_gamma(ce_make(1.0 - z.re, -z.im));
        ce_complex sine = ce_make(sin(CE_PI * z.re) * cosh(CE_PI * z.im),
                                  cos(CE_PI * z.re) * sinh(CE_PI * z.im));
        return ce_div(ce_make(CE_PI, 0.0), ce_mul(sine, reflected));
    }
    ce_complex zm = ce_make(z.re - 1.0, z.im);
    ce_complex sum = ce_make(ce_lanczos[0], 0.0);
    for (uint32_t k = 1; k < sizeof(ce_lanczos) / sizeof(ce_lanczos[0]); ++k) {
        sum = ce_add(sum, ce_div(ce_make(ce_lanczos[k], 0.0), ce_make(zm.re + k, zm.im)));
    }
    ce_complex t = ce_make(z.re + 6.5, z.im);
    ce_complex powered = ce_pow(t, ce_make(z.re - 0.5, z.im));
    ce_complex decayed = ce_exp(ce_make(-t.re, -t.im));
    ce_complex value = ce_mul(ce_mul(powered, decayed), sum);
    return ce_make(2.5066282746310005024 * value.re, 2.5066282746310005024 * value.im);
}

static ce_complex ce_log_gamma(ce_complex z) {
    if (z.re < 0.5) {
        ce_complex reflected = ce_log_gamma(ce_make(1.0 - z.re, -z.im));
        ce_complex sine = ce_make(sin(CE_PI * z.re) * cosh(CE_PI * z.im),
                                  cos(CE_PI * z.re) * sinh(CE_PI * z.im));
        ce_complex sine_log = ce_log(sine, NULL);
        return ce_make(log(CE_PI) - sine_log.re - reflected.re, -sine_log.im - reflected.im);
    }
    ce_complex zm = ce_make(z.re - 1.0, z.im);
    ce_complex sum = ce_make(ce_lanczos[0], 0.0);
    for (uint32_t k = 1; k < sizeof(ce_lanczos) / sizeof(ce_lanczos[0]); ++k) {
        sum = ce_add(sum, ce_div(ce_make(ce_lanczos[k], 0.0), ce_make(zm.re + k, zm.im)));
    }
    ce_complex t = ce_make(z.re + 6.5, z.im);
    ce_complex log_t = ce_log(t, NULL);
    ce_complex log_sum = ce_log(sum, NULL);
    ce_complex product = ce_mul(ce_make(z.re - 0.5, z.im), log_t);
    return ce_make(log(2.5066282746310005024) + product.re - t.re + log_sum.re,
                   product.im - t.im + log_sum.im);
}

static ce_complex ce_bessel(ce_complex z, ce_complex order) {
    if (fabs(order.im) < 1e-14 && floor(order.re) == order.re && order.re < 0.0) {
        const double sign = fmod(fabs(order.re), 2.0) ? -1.0 : 1.0;
        ce_complex value = ce_bessel(z, ce_make(-order.re, 0.0));
        return ce_make(sign * value.re, sign * value.im);
    }
    if (z.re == 0.0 && z.im == 0.0) {
        if (order.re == 0.0 && order.im == 0.0) return ce_make(1.0, 0.0);
        return order.re > 0.0 ? ce_make(0.0, 0.0) : ce_make(NAN, NAN);
    }
    ce_complex half_log = ce_log(ce_make(z.re * 0.5, z.im * 0.5), NULL);
    ce_complex log_gamma = ce_log_gamma(ce_make(order.re + 1.0, order.im));
    ce_complex term = ce_exp(ce_sub(ce_mul(order, half_log), log_gamma));
    ce_complex sum = term;
    ce_complex step = ce_make(-(z.re * z.re - z.im * z.im) * 0.25, -z.re * z.im * 0.5);
    for (uint32_t k = 0; k < 160; ++k) {
        ce_complex denominator = ce_make((k + 1.0) * (k + 1.0 + order.re), (k + 1.0) * order.im);
        term = ce_div(ce_mul(term, step), denominator);
        sum = ce_add(sum, term);
        if (!isfinite(sum.re) || !isfinite(sum.im)) return ce_make(NAN, NAN);
        if (hypot(term.re, term.im) <= 1e-14 * fmax(1.0, hypot(sum.re, sum.im))) break;
    }
    return sum;
}

static double ce_zeta_log_table[513] = {0};
static int ce_zeta_log_table_initialized = 0;

static void ce_ensure_zeta_log_table(void) {
    if (ce_zeta_log_table_initialized) return;
    for (uint32_t i = 1; i <= 512; ++i) {
        ce_zeta_log_table[i] = log((double)i);
    }
    ce_zeta_log_table_initialized = 1;
}

static ce_complex ce_zeta_eta(double re, double im, uint32_t levels) {
    if (re == 1.0 && im == 0.0) return ce_make(INFINITY, NAN);
    ce_ensure_zeta_log_table();
    ce_complex denominator = ce_make(1.0 - ce_exp_safe((1.0 - re) * 0.693147180559945309417) * cos(-im * 0.693147180559945309417),
                                     -ce_exp_safe((1.0 - re) * 0.693147180559945309417) * sin(-im * 0.693147180559945309417));
    ce_complex sum = ce_make(0.0, 0.0);
    double weights[128] = {0};
    levels = levels > 128u ? 128u : levels;
    for (uint32_t n = 0; n < levels; ++n) {
        double binomial = 1.0;
        const double row_scale = ldexp(1.0, -(int)n - 1);
        for (uint32_t k = 0; k <= n; ++k) {
            weights[k] += row_scale * (k & 1u ? -binomial : binomial);
            binomial = binomial * (n - k) / (k + 1.0);
        }
    }
    for (uint32_t k = 0; k < levels; ++k) {
        const double ln = (k + 1 <= 512) ? ce_zeta_log_table[k + 1] : log((double)k + 1.0);
        const double magnitude = ce_exp_safe(-re * ln);
        const double angle = -im * ln;
        sum.re += weights[k] * magnitude * cos(angle);
        sum.im += weights[k] * magnitude * sin(angle);
    }
    return ce_div(sum, denominator);
}

static ce_complex ce_zeta_direct(double re, double im, uint32_t terms) {
    if (re <= 1.0) return ce_make(NAN, NAN);
    ce_ensure_zeta_log_table();
    ce_complex sum = ce_make(0.0, 0.0);
    for (uint32_t n = 1; n <= terms; ++n) {
        const double ln = (n <= 512) ? ce_zeta_log_table[n] : log((double)n);
        const double magnitude = ce_exp_safe(-re * ln);
        const double angle = -im * ln;
        sum.re += magnitude * cos(angle);
        sum.im += magnitude * sin(angle);
    }
    return sum;
}

static ce_complex ce_polynomial(ce_complex z, const ce_function_config *config) {
    ce_complex value = ce_make(0.0, 0.0);
    if (!config || !config->polynomial || !config->polynomial_count) return value;
    for (uint32_t k = config->polynomial_count; k-- > 0;) {
        value = ce_add(ce_mul(value, z), config->polynomial[k]);
    }
    return value;
}

static ce_complex ce_exp_at_base(ce_complex z, ce_complex base) {
    if (base.re == 0.0 && base.im == 0.0) return ce_make(NAN, NAN);
    return ce_exp(ce_mul(z, ce_make(ce_log_hypot(base.re, base.im), atan2(base.im, base.re))));
}

enum ce_expression_opcode {
    CE_EXPR_CONST = 0,
    CE_EXPR_Z,
    CE_EXPR_C,
    CE_EXPR_ADD,
    CE_EXPR_SUB,
    CE_EXPR_MUL,
    CE_EXPR_DIV,
    CE_EXPR_POW,
    CE_EXPR_NEGATE,
    CE_EXPR_CALL,
    CE_EXPR_CONJUGATE,
    CE_EXPR_ABS,
    CE_EXPR_ARG,
    CE_EXPR_REAL,
    CE_EXPR_IMAGINARY,
    CE_EXPR_SQRT = 41
};

static int ce_eval_expression(const ce_function_config *config, ce_complex z, ce_complex c,
                              ce_complex *result) {
    if (!config->expression || !config->expression_count) {
        *result = z;
        return 1;
    }
    ce_complex stack[128];
    uint32_t size = 0;
    for (uint32_t i = 0; i < config->expression_count; ++i) {
        const ce_expression_instruction *instruction = &config->expression[i];
        ce_complex left, right;
        switch (instruction->opcode) {
            case CE_EXPR_CONST:
                if (size == 128) return 0;
                stack[size++] = instruction->value;
                break;
            case CE_EXPR_Z:
                if (size == 128) return 0;
                stack[size++] = z;
                break;
            case CE_EXPR_C:
                if (size == 128) return 0;
                stack[size++] = c;
                break;
            case CE_EXPR_NEGATE:
                if (!size) return 0;
                stack[size - 1].re = -stack[size - 1].re;
                stack[size - 1].im = -stack[size - 1].im;
                break;
            case CE_EXPR_CONJUGATE:
                if (!size) return 0;
                stack[size - 1].im = -stack[size - 1].im;
                break;
            case CE_EXPR_ABS:
                if (!size) return 0;
                stack[size - 1] = ce_make(hypot(stack[size - 1].re, stack[size - 1].im), 0.0);
                break;
            case CE_EXPR_ARG:
                if (!size) return 0;
                stack[size - 1] = ce_make(atan2(stack[size - 1].im, stack[size - 1].re), 0.0);
                break;
            case CE_EXPR_REAL:
                if (!size) return 0;
                stack[size - 1].im = 0.0;
                break;
            case CE_EXPR_IMAGINARY:
                if (!size) return 0;
                stack[size - 1].re = stack[size - 1].im;
                stack[size - 1].im = 0.0;
                break;
            case CE_EXPR_SQRT:
                if (!size) return 0;
                stack[size - 1] = ce_pow(stack[size - 1], ce_make(0.5, 0.0));
                break;
            case CE_EXPR_CALL:
                if (!size || instruction->argument == CE_FN_ALGEBRAIC) return 0;
                stack[size - 1] = ce_eval_function(instruction->argument, stack[size - 1], c, config);
                break;
            default:
                if (size < 2) return 0;
                right = stack[--size];
                left = stack[size - 1];
                if (instruction->opcode == CE_EXPR_ADD) stack[size - 1] = ce_add(left, right);
                else if (instruction->opcode == CE_EXPR_SUB) stack[size - 1] = ce_sub(left, right);
                else if (instruction->opcode == CE_EXPR_MUL) stack[size - 1] = ce_mul(left, right);
                else if (instruction->opcode == CE_EXPR_DIV) stack[size - 1] = ce_div(left, right);
                else if (instruction->opcode == CE_EXPR_POW) stack[size - 1] = ce_pow(left, right);
                else return 0;
                break;
        }
    }
    if (size != 1) return 0;
    *result = stack[0];
    return isfinite(result->re) && isfinite(result->im);
}

static ce_complex ce_eval_algebraic(ce_complex input, ce_complex c, const ce_function_config *config) {
    if (!config->algebraic_terms || !config->algebraic_term_count ||
        (config->algebraic_factor_count && !config->algebraic_factors)) return ce_make(NAN, NAN);
    if (!config->expression_count && config->algebraic_term_count == 2u &&
        config->polynomial && config->algebraic_factor_count >= 2u) {
        const ce_algebraic_term *first_term = &config->algebraic_terms[0];
        const ce_algebraic_term *second_term = &config->algebraic_terms[1];
        if (first_term->factor_count == 1u && second_term->factor_count == 1u &&
            first_term->factor_offset < config->algebraic_factor_count &&
            second_term->factor_offset < config->algebraic_factor_count) {
            const ce_algebraic_factor *first = &config->algebraic_factors[first_term->factor_offset];
            const ce_algebraic_factor *second = &config->algebraic_factors[second_term->factor_offset];
            const int plain_first = first->chained_function_id < 0 && !first->flags && !first->step_count;
            const int plain_second = second->chained_function_id < 0 && !second->step_count;
            if (plain_first && plain_second && first_term->coefficient.re == 1.0 &&
                first_term->coefficient.im == 0.0 && second_term->coefficient.re == 1.0 &&
                second_term->coefficient.im == 0.0 && config->polynomial_count == 3u &&
                config->polynomial[0].re == 0.0 && config->polynomial[0].im == 0.0 &&
                config->polynomial[1].re == 0.0 && config->polynomial[1].im == 0.0 &&
                config->polynomial[2].re == 1.0 && config->polynomial[2].im == 0.0) {
                if (first->function_id == CE_FN_POLYNOMIAL && first->power == 1.0 &&
                    second->function_id == CE_FN_C && second->power == 1.0 && !second->flags) {
                    return ce_add(ce_mul(input, input), c);
                }
                if (second->function_id == CE_FN_POLYNOMIAL && second->power == 1.0 &&
                    first->function_id == CE_FN_C && first->power == 1.0 && !first->flags) {
                    return ce_add(ce_mul(input, input), c);
                }
            }
            if (plain_first && plain_second && config->polynomial_count == 2u &&
                config->polynomial[0].re == 0.0 && config->polynomial[0].im == 0.0 &&
                config->polynomial[1].re == 1.0 && config->polynomial[1].im == 0.0 &&
                first->function_id == CE_FN_POLYNOMIAL && first->power == 1.0 &&
                second->function_id == CE_FN_POLYNOMIAL && second->power == 2.0 &&
                !(first->flags) && second->flags == 1u &&
                first_term->coefficient.re == 2.0 / 3.0 && first_term->coefficient.im == 0.0 &&
                second_term->coefficient.re == 1.0 / 3.0 && second_term->coefficient.im == 0.0) {
                ce_complex square = ce_mul(input, input);
                ce_complex inverse = ce_div(ce_make(1.0 / 3.0, 0.0), square);
                return ce_add(ce_make((2.0 / 3.0) * input.re, (2.0 / 3.0) * input.im), inverse);
            }
        }
    }
    ce_complex z;
    if (!ce_eval_expression(config, input, c, &z)) return ce_make(NAN, NAN);
    ce_complex sum = ce_make(0.0, 0.0);
    for (uint32_t term_index = 0; term_index < config->algebraic_term_count; ++term_index) {
        const ce_algebraic_term *term = &config->algebraic_terms[term_index];
        if (term->factor_offset > config->algebraic_factor_count ||
            term->factor_count > config->algebraic_factor_count - term->factor_offset) return ce_make(NAN, NAN);
        ce_complex value = term->coefficient;
        for (uint32_t factor_index = 0; factor_index < term->factor_count; ++factor_index) {
            const ce_algebraic_factor *factor = &config->algebraic_factors[term->factor_offset + factor_index];
            ce_complex argument = z;
            ce_complex factor_value;
            if (factor->step_count) {
                if (!config->algebraic_steps || factor->step_offset > config->algebraic_step_count ||
                    factor->step_count > config->algebraic_step_count - factor->step_offset) return ce_make(NAN, NAN);
                const uint32_t *steps = &config->algebraic_steps[factor->step_offset];
                const uint32_t step_count = factor->step_count;
                for (uint32_t step = 0; step < step_count; ++step) {
                    switch (steps[step]) {
                        case CE_FN_SIN: argument = ce_sin(argument); break;
                        case CE_FN_COS: argument = ce_cos(argument); break;
                        case CE_FN_TAN: argument = ce_tan(argument); break;
                        case CE_FN_SEC: argument = ce_sec(argument); break;
                        case CE_FN_EXP: argument = ce_exp(argument); break;
                        case CE_FN_LN: argument = ce_log(argument, config); break;
                        case CE_FN_RECIPROCAL: argument = ce_div(ce_make(1.0, 0.0), argument); break;
                        case CE_FN_SINH: argument = ce_sinh(argument); break;
                        case CE_FN_COSH: argument = ce_cosh(argument); break;
                        case CE_FN_TANH: argument = ce_tanh(argument); break;
                        default: argument = ce_eval_function(steps[step], argument, c, config); break;
                    }
                    if (!isfinite(argument.re) || !isfinite(argument.im)) break;
                }
                factor_value = argument;
            } else {
                if (factor->chained_function_id >= 0) {
                    argument = ce_eval_function((uint32_t)factor->chained_function_id, argument, c, config);
                }
                factor_value = ce_eval_function(factor->function_id, argument, c, config);
            }
            if (factor->power != 1.0) factor_value = ce_pow(factor_value, ce_make(factor->power, 0.0));
            if (factor->flags & 1u) factor_value = ce_div(ce_make(1.0, 0.0), factor_value);
            if (factor->flags & 2u) {
                factor_value = ce_div(ce_log(factor_value, config), ce_log(config->log_base, NULL));
            }
            if (factor->flags & 4u) factor_value = ce_exp_at_base(factor_value, config->exp_base);
            value = ce_mul(value, factor_value);
        }
        if (!isfinite(value.re) || !isfinite(value.im)) return ce_make(NAN, NAN);
        sum = ce_add(sum, value);
    }
    return sum;
}

ce_complex ce_eval_function(uint32_t function_id, ce_complex z, ce_complex c,
                            const ce_function_config *config) {
    const ce_function_config defaults = {
        {2.718281828459045, 0.0}, {2.718281828459045, 0.0}, {0.0, 0.0},
        {1.0, 0.0}, {0.0, 0.0}, {0.0, 0.0}, {1.0, 0.0},
        NULL, 0, 0.5, CE_PI, 0, 0,
        NULL, 0, NULL, 0, NULL, 0, NULL, 0
    };
    if (!config) config = &defaults;
    switch (function_id) {
        case CE_FN_C: return c;
        case CE_FN_COS: return ce_cos(z);
        case CE_FN_SIN: return ce_sin(z);
        case CE_FN_TAN: return ce_tan(z);
        case CE_FN_SEC: return ce_sec(z);
        case CE_FN_EXP: return ce_exp_at_base(z, config->exp_base);
        case CE_FN_LN: {
            ce_complex numerator = ce_log(z, config);
            ce_complex denominator = ce_log(config->log_base, NULL);
            if (denominator.re == 0.0 && denominator.im == 0.0) return ce_make(NAN, NAN);
            return ce_div(numerator, denominator);
        }
        case CE_FN_RECIPROCAL: {
            const double d = z.re * z.re + z.im * z.im;
            return ce_make(z.re / d, -z.im / d);
        }
        case CE_FN_SINH: return ce_sinh(z);
        case CE_FN_COSH: return ce_cosh(z);
        case CE_FN_TANH: return ce_tanh(z);
        case CE_FN_ASIN: return ce_asin(z);
        case CE_FN_ATAN: return ce_atan(z);
        case CE_FN_GAMMA: return ce_gamma(z);
        case CE_FN_LOG_GAMMA: return ce_log_gamma(z);
        case CE_FN_BESSEL: return ce_bessel(z, config->bessel_order);
        case CE_FN_POWER: return ce_pow(z, ce_make(config->fractional_power, 0.0));
        case CE_FN_MOBIUS: return ce_div(ce_add(ce_mul(config->mobius_a, z), config->mobius_b),
                                        ce_add(ce_mul(config->mobius_c, z), config->mobius_d));
        case CE_FN_ZETA:
            if (!config->zeta_continuation) return ce_zeta_direct(z.re, z.im, 100);
            if (z.re == 0.0 && z.im == 0.0) return ce_make(-0.5, 0.0);
            if (z.im == 0.0 && z.re < 0.0 && fmod(z.re, 2.0) == 0.0) return ce_make(0.0, 0.0);
            return ce_zeta_eta(z.re, z.im, 32);
        case CE_FN_POLYNOMIAL: return ce_polynomial(z, config);
        case CE_FN_POINCARE:
            if (z.im <= 1e-9) return ce_make(NAN, NAN);
            return ce_make(z.re / sqrt(z.im), sqrt(z.im));
        case CE_FN_ALGEBRAIC: return ce_eval_algebraic(z, c, config);
        case CE_FN_IDENTITY: return z;
        default: return ce_make(NAN, NAN);
    }
}

static int ce_valid(ce_complex value) {
    return isfinite(value.re) && isfinite(value.im) && fabs(value.re) < CE_MAX_FINITE && fabs(value.im) < CE_MAX_FINITE;
}

static ce_complex ce_eval_taylor(const ce_map_config *config, ce_complex point) {
    if (!config->taylor_coefficients || !config->taylor_count) return ce_make(NAN, NAN);
    ce_complex delta = ce_sub(point, config->taylor_center);
    ce_complex value = ce_make(0.0, 0.0);
    for (uint32_t index = config->taylor_count; index-- > 0;) {
        value = ce_add(ce_mul(value, delta), config->taylor_coefficients[index]);
    }
    return value;
}

static ce_complex ce_eval_dynamic(const ce_map_config *config, ce_complex parameter,
                                  int32_t sheet,
                                  int *valid, ce_complex *point_values,
                                  ce_complex *term_values, uint8_t *errors,
                                  uint8_t *reduction_status, ce_complex *partial_values,
                                  double *partial_product_metadata, double product_metadata[6]) {
    *valid = 0;
    if (!config->dynamic_point_expression || !config->dynamic_point_count ||
        !config->dynamic_term_expression || !config->dynamic_term_count ||
        !config->dynamic_variables || !config->dynamic_source_count ||
        config->dynamic_variable_count > 256u || config->dynamic_reduction > 2u) {
        return ce_make(NAN, NAN);
    }
    ce_complex *variables = malloc(config->dynamic_variable_count * sizeof(ce_complex));
    if (!variables) return ce_make(NAN, NAN);
    ce_map_config base = *config;
    base.chain_count = 1u;
    base.zero_seed = 0u;
    base.derivative = 0u;
    base.dynamic_point_expression = NULL;
    base.dynamic_point_count = 0u;
    base.dynamic_term_expression = NULL;
    base.dynamic_term_count = 0u;
    base.dynamic_source_count = 0u;

    ce_complex final = config->dynamic_reduction == 2u
        ? ce_make(1.0, 0.0) : ce_make(0.0, 0.0);
    double compensation_re = 0.0, compensation_im = 0.0;
    double log_abs = 0.0, argument = 0.0;
    int product_zero = 0, product_finite = 1, stopped = 0, has_value = 0;

    for (uint32_t source = 0; source < config->dynamic_source_count; ++source) {
        memcpy(variables,
               config->dynamic_variables + (size_t)source * config->dynamic_variable_count,
               config->dynamic_variable_count * sizeof(ce_complex));
        for (uint32_t slot = 0; slot < config->dynamic_variable_count; ++slot) {
            const uint8_t flag = config->dynamic_variable_flags
                ? config->dynamic_variable_flags[slot] : 0u;
            if (flag == 1u) variables[slot] = parameter;
            else if (flag == 2u) variables[slot] = ce_make(parameter.re, 0.0);
        }
        ce_complex point = ce_make(NAN, NAN), term = ce_make(NAN, NAN);
        uint8_t point_error = 0u, term_error = 0u;
        int point_ok = ce_evaluate_expression_one(
            &base, config->dynamic_point_expression, config->dynamic_point_count,
            variables, config->dynamic_variable_count, sheet, &point, &point_error
        );
        if (point_ok) {
            for (uint32_t slot = 0; slot < config->dynamic_variable_count; ++slot) {
                if (config->dynamic_variable_flags && config->dynamic_variable_flags[slot] == 3u) {
                    variables[slot] = point;
                }
            }
            point_ok = ce_valid(point);
        }
        const int term_ok = point_ok && ce_evaluate_expression_one(
            &base, config->dynamic_term_expression, config->dynamic_term_count,
            variables, config->dynamic_variable_count, sheet, &term, &term_error
        ) && ce_valid(term);
        if (point_values) point_values[source] = point;
        if (term_values) term_values[source] = term;
        if (errors) errors[source] = point_ok ? term_error : (point_error ? point_error : 9u);

        if (stopped) {
            if (reduction_status) reduction_status[source] = 3u;
            if (partial_values) partial_values[source] = ce_make(NAN, NAN);
            if (partial_product_metadata) {
                for (uint32_t field = 0; field < 6u; ++field) partial_product_metadata[source * 6u + field] = NAN;
            }
            continue;
        }
        if (!term_ok) {
            if (config->dynamic_invalid_policy) {
                if (reduction_status) reduction_status[source] = 1u;
            } else {
                stopped = 1;
                if (reduction_status) reduction_status[source] = 2u;
            }
            if (partial_values) partial_values[source] = ce_make(NAN, NAN);
            if (partial_product_metadata) {
                for (uint32_t field = 0; field < 6u; ++field) partial_product_metadata[source * 6u + field] = NAN;
            }
            continue;
        }
        has_value = 1;
        if (reduction_status) reduction_status[source] = 0u;
        if (config->dynamic_reduction == 1u) {
            const double next_re = final.re + term.re;
            compensation_re += fabs(final.re) >= fabs(term.re)
                ? final.re - next_re + term.re : term.re - next_re + final.re;
            final.re = next_re;
            const double next_im = final.im + term.im;
            compensation_im += fabs(final.im) >= fabs(term.im)
                ? final.im - next_im + term.im : term.im - next_im + final.im;
            final.im = next_im;
            if (partial_values) partial_values[source] = ce_make(
                final.re + compensation_re, final.im + compensation_im
            );
        } else if (config->dynamic_reduction == 2u) {
            const double magnitude = hypot(term.re, term.im);
            if (magnitude == 0.0) {
                product_zero = 1;
                log_abs = -INFINITY;
                final = ce_make(0.0, 0.0);
            } else if (!isfinite(magnitude)) {
                product_finite = 0;
                final = ce_make(NAN, NAN);
            } else {
                log_abs += log(magnitude);
                argument += atan2(term.im, term.re);
                final = ce_mul(final, term);
            }
            if (partial_values) partial_values[source] = final;
            if (partial_product_metadata) {
                partial_product_metadata[source * 6u] = product_zero || !product_finite ? final.re : cos(argument);
                partial_product_metadata[source * 6u + 1u] = product_zero || !product_finite ? final.im : sin(argument);
                partial_product_metadata[source * 6u + 2u] = log_abs;
                partial_product_metadata[source * 6u + 3u] = argument;
                partial_product_metadata[source * 6u + 4u] = product_zero ? 1.0 : 0.0;
                partial_product_metadata[source * 6u + 5u] = product_finite ? 1.0 : 0.0;
            }
        } else {
            final = term;
            if (partial_values) partial_values[source] = term;
        }
    }
    if (config->dynamic_reduction == 1u) {
        final.re += compensation_re;
        final.im += compensation_im;
    }
    if (product_metadata) {
        product_metadata[0] = product_zero || !product_finite ? final.re : cos(argument);
        product_metadata[1] = product_zero || !product_finite ? final.im : sin(argument);
        product_metadata[2] = log_abs;
        product_metadata[3] = argument;
        product_metadata[4] = product_zero ? 1.0 : 0.0;
        product_metadata[5] = product_finite ? 1.0 : 0.0;
    }
    free(variables);
    *valid = (has_value || config->dynamic_reduction != 0u) && ce_valid(final);
    return final;
}

static ce_complex ce_eval_map_point(const ce_map_config *config, ce_complex point, int *valid) {
    if (config->dynamic_source_count) {
        const uint32_t count = config->chain_count ? config->chain_count : 1u;
        ce_complex current = config->zero_seed ? ce_make(0.0, 0.0) : point;
        ce_complex last = ce_make(NAN, NAN);
        int has_last = 0;
        for (uint32_t iteration = 0; iteration < count; ++iteration) {
            current = ce_eval_dynamic(config, current, 0, &has_last, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
            if (!has_last) break;
            last = current;
            if (fabs(current.re) >= CE_CHAIN_BAILOUT || fabs(current.im) >= CE_CHAIN_BAILOUT) break;
        }
        *valid = has_last;
        return last;
    }
    if (config->use_taylor) {
        const double delta_re = point.re - config->taylor_center.re;
        const double delta_im = point.im - config->taylor_center.im;
        if (isfinite(config->taylor_radius_sq) &&
            delta_re * delta_re + delta_im * delta_im > config->taylor_radius_sq * 1.000001) {
            *valid = 0;
            return ce_make(NAN, NAN);
        }
        ce_complex value = ce_eval_taylor(config, point);
        *valid = ce_valid(value);
        return value;
    }
    const uint32_t count = config->chain_count ? config->chain_count : 1;
    ce_complex current = config->zero_seed ? ce_make(0.0, 0.0) : point;
    ce_complex last = ce_make(NAN, NAN);
    int has_last = 0;
    for (uint32_t i = 0; i < count; ++i) {
        current = ce_eval_function(config->function_id, current, point, &config->function);
        if (!ce_valid(current)) break;
        last = current;
        has_last = 1;
        if (fabs(current.re) >= CE_CHAIN_BAILOUT || fabs(current.im) >= CE_CHAIN_BAILOUT) break;
        if (!config->zero_seed && count == 1) break;
    }
    *valid = has_last;
    return last;
}

int32_t ce_evaluate_dynamic(const ce_map_config *config, double parameter_re, double parameter_im,
                            ce_complex *point_values, ce_complex *term_values,
                            uint8_t *errors, uint8_t *reduction_status,
                            ce_complex *partial_values, double *partial_product_metadata,
                            ce_complex *final_value,
                            double product_metadata[6]) {
    if (!config || !point_values || !term_values || !errors || !reduction_status ||
        !partial_values || !final_value || !product_metadata) return -1;
    int valid = 0;
    *final_value = ce_eval_dynamic(
        config, ce_make(parameter_re, parameter_im), 0, &valid, point_values, term_values, errors,
        reduction_status, partial_values, partial_product_metadata, product_metadata
    );
    return valid ? 0 : 1;
}

static ce_complex ce_eval_map_derivative(const ce_map_config *config, ce_complex point,
                                         uint32_t order, int *valid) {
    if (!order) return ce_eval_map_point(config, point, valid);
    const double multiplier = order > 1u ? 100.0 : 1.0;
    const double h = 1e-6 * multiplier * fmax(1.0, fmax(fabs(point.re), fabs(point.im)));
    int left_valid = 0, right_valid = 0;
    const ce_complex left = ce_eval_map_derivative(
        config, ce_make(point.re - h, point.im), order - 1u, &left_valid
    );
    const ce_complex right = ce_eval_map_derivative(
        config, ce_make(point.re + h, point.im), order - 1u, &right_valid
    );
    const ce_complex result = ce_make((right.re - left.re) * 0.5 / h,
                                      (right.im - left.im) * 0.5 / h);
    *valid = left_valid && right_valid && ce_valid(result);
    return result;
}

int32_t ce_evaluate_points(const ce_map_config *config, const ce_complex *input,
                           uint32_t count, ce_complex *output, uint8_t *valid) {
    if (!config || !input || !output || config->derivative > 2u) return -1;
    for (uint32_t i = 0; i < count; ++i) {
        int ok = 0;
        output[i] = ce_eval_map_derivative(config, input[i], config->derivative, &ok);
        if (valid) valid[i] = (uint8_t)ok;
    }
    return 0;
}

int32_t ce_evaluate_algebraic_points(const ce_map_config *config, const ce_complex *input,
                                     const ce_complex *parameters, uint32_t count,
                                     ce_complex *output, uint8_t *valid) {
    if (!config || !input || !parameters || !output || config->function_id != CE_FN_ALGEBRAIC) return -1;
    const uint32_t chain_count = config->chain_count ? config->chain_count : 1;
    for (uint32_t point = 0; point < count; ++point) {
        ce_complex current = config->zero_seed ? ce_make(0.0, 0.0) : input[point];
        ce_complex last = ce_make(NAN, NAN);
        int has_last = 0;
        for (uint32_t iteration = 0; iteration < chain_count; ++iteration) {
            current = ce_eval_function(CE_FN_ALGEBRAIC, current, parameters[point], &config->function);
            if (!ce_valid(current)) break;
            last = current;
            has_last = 1;
            if (fabs(current.re) >= CE_CHAIN_BAILOUT || fabs(current.im) >= CE_CHAIN_BAILOUT) break;
        }
        output[point] = last;
        if (valid) valid[point] = (uint8_t)has_last;
    }
    return 0;
}

static ce_complex ce_sheet_log(ce_complex z, int32_t sheet,
                               const ce_function_config *config) {
    ce_complex value = ce_log(z, config);
    value.im += CE_TWO_PI * sheet;
    return value;
}

static ce_complex ce_eval_function_sheet(uint32_t function_id, ce_complex z, ce_complex c,
                                         const ce_function_config *config, int32_t sheet);

static int ce_eval_expression_sheet(const ce_function_config *config, ce_complex z,
                                    ce_complex c, int32_t sheet, ce_complex *result) {
    if (!config->expression || !config->expression_count) {
        *result = z;
        return 1;
    }
    ce_complex stack[128];
    uint32_t size = 0;
    for (uint32_t index = 0; index < config->expression_count; ++index) {
        const ce_expression_instruction *instruction = &config->expression[index];
        ce_complex left, right;
        switch (instruction->opcode) {
            case CE_EXPR_CONST: if (size == 128u) return 0; stack[size++] = instruction->value; break;
            case CE_EXPR_Z: if (size == 128u) return 0; stack[size++] = z; break;
            case CE_EXPR_C: if (size == 128u) return 0; stack[size++] = c; break;
            case CE_EXPR_NEGATE:
                if (!size) return 0;
                stack[size - 1u].re = -stack[size - 1u].re;
                stack[size - 1u].im = -stack[size - 1u].im;
                break;
            case CE_EXPR_CONJUGATE: if (!size) return 0; stack[size - 1u].im = -stack[size - 1u].im; break;
            case CE_EXPR_ABS:
                if (!size) return 0;
                stack[size - 1u] = ce_make(hypot(stack[size - 1u].re, stack[size - 1u].im), 0.0);
                break;
            case CE_EXPR_ARG:
                if (!size) return 0;
                stack[size - 1u] = ce_make(ce_sheet_log(stack[size - 1u], sheet, config).im, 0.0);
                break;
            case CE_EXPR_REAL: if (!size) return 0; stack[size - 1u].im = 0.0; break;
            case CE_EXPR_IMAGINARY:
                if (!size) return 0;
                stack[size - 1u] = ce_make(stack[size - 1u].im, 0.0);
                break;
            case CE_EXPR_SQRT:
                if (!size) return 0;
                stack[size - 1u] = ce_exp(ce_mul(
                    ce_make(0.5, 0.0), ce_sheet_log(stack[size - 1u], sheet, config)
                ));
                break;
            case CE_EXPR_CALL:
                if (!size || instruction->argument == CE_FN_ALGEBRAIC) return 0;
                stack[size - 1u] = ce_eval_function_sheet(
                    instruction->argument, stack[size - 1u], c, config, sheet
                );
                break;
            default:
                if (size < 2u) return 0;
                right = stack[--size]; left = stack[size - 1u];
                if (instruction->opcode == CE_EXPR_ADD) stack[size - 1u] = ce_add(left, right);
                else if (instruction->opcode == CE_EXPR_SUB) stack[size - 1u] = ce_sub(left, right);
                else if (instruction->opcode == CE_EXPR_MUL) stack[size - 1u] = ce_mul(left, right);
                else if (instruction->opcode == CE_EXPR_DIV) stack[size - 1u] = ce_div(left, right);
                else if (instruction->opcode == CE_EXPR_POW) {
                    ce_complex logarithm = ce_sheet_log(left, sheet, config);
                    stack[size - 1u] = ce_exp(ce_mul(right, logarithm));
                } else return 0;
                break;
        }
    }
    if (size != 1u || !isfinite(stack[0].re) || !isfinite(stack[0].im)) return 0;
    *result = stack[0];
    return 1;
}

static ce_complex ce_eval_algebraic_sheet(ce_complex input, ce_complex c,
                                          const ce_function_config *config, int32_t sheet) {
    if (!config->algebraic_terms || !config->algebraic_term_count ||
        (config->algebraic_factor_count && !config->algebraic_factors)) return ce_make(NAN, NAN);
    ce_complex z;
    if (!ce_eval_expression_sheet(config, input, c, sheet, &z)) return ce_make(NAN, NAN);
    ce_complex sum = ce_make(0.0, 0.0);
    for (uint32_t term_index = 0; term_index < config->algebraic_term_count; ++term_index) {
        const ce_algebraic_term *term = &config->algebraic_terms[term_index];
        if (term->factor_offset > config->algebraic_factor_count ||
            term->factor_count > config->algebraic_factor_count - term->factor_offset) return ce_make(NAN, NAN);
        ce_complex value = term->coefficient;
        for (uint32_t factor_index = 0; factor_index < term->factor_count; ++factor_index) {
            const ce_algebraic_factor *factor = &config->algebraic_factors[term->factor_offset + factor_index];
            ce_complex argument = z;
            if (factor->step_count) {
                if (!config->algebraic_steps || factor->step_offset > config->algebraic_step_count ||
                    factor->step_count > config->algebraic_step_count - factor->step_offset) return ce_make(NAN, NAN);
                for (uint32_t step = 0; step < factor->step_count; ++step) {
                    argument = ce_eval_function_sheet(
                        config->algebraic_steps[factor->step_offset + step], argument, c, config, sheet
                    );
                }
            } else if (factor->chained_function_id >= 0) {
                argument = ce_eval_function_sheet(
                    (uint32_t)factor->chained_function_id, argument, c, config, sheet
                );
            }
            ce_complex factor_value = ce_eval_function_sheet(factor->function_id, argument, c, config, sheet);
            if (factor->power != 1.0) {
                if (floor(factor->power) == factor->power) {
                    factor_value = ce_pow(factor_value, ce_make(factor->power, 0.0));
                } else {
                    factor_value = ce_exp(ce_mul(
                        ce_make(factor->power, 0.0), ce_sheet_log(factor_value, sheet, config)
                    ));
                }
            }
            if (factor->flags & 1u) factor_value = ce_div(ce_make(1.0, 0.0), factor_value);
            if (factor->flags & 2u) {
                factor_value = ce_div(
                    ce_sheet_log(factor_value, sheet, config), ce_log(config->log_base, NULL)
                );
            }
            if (factor->flags & 4u) factor_value = ce_exp_at_base(factor_value, config->exp_base);
            value = ce_mul(value, factor_value);
        }
        if (!isfinite(value.re) || !isfinite(value.im)) return ce_make(NAN, NAN);
        sum = ce_add(sum, value);
    }
    return sum;
}

static ce_complex ce_eval_function_sheet(uint32_t function_id, ce_complex z, ce_complex c,
                                         const ce_function_config *config, int32_t sheet) {
    if (!sheet) return ce_eval_function(function_id, z, c, config);
    ce_complex principal = ce_eval_function(function_id, z, c, config);
    if (function_id == CE_FN_LN) {
        return ce_div(ce_sheet_log(z, sheet, config), ce_log(config->log_base, NULL));
    }
    if (function_id == CE_FN_POWER) {
        return ce_exp(ce_mul(
            ce_make(config->fractional_power, 0.0), ce_sheet_log(z, sheet, config)
        ));
    }
    if (function_id == CE_FN_ASIN) {
        const double sign = (llabs((long long)sheet) & 1ll) ? -1.0 : 1.0;
        return ce_make(sheet * CE_PI + sign * principal.re, sign * principal.im);
    }
    if (function_id == CE_FN_ATAN) return ce_make(principal.re + sheet * CE_PI, principal.im);
    if (function_id == CE_FN_LOG_GAMMA) return ce_make(principal.re, principal.im + sheet * CE_TWO_PI);
    if (function_id == CE_FN_BESSEL) {
        const ce_complex multiplier = ce_exp(ce_make(
            -sheet * CE_TWO_PI * config->bessel_order.im,
            sheet * CE_TWO_PI * config->bessel_order.re
        ));
        return ce_mul(principal, multiplier);
    }
    if (function_id == CE_FN_ALGEBRAIC) return ce_eval_algebraic_sheet(z, c, config, sheet);
    return principal;
}

int32_t ce_evaluate_sheets(const ce_map_config *config, const ce_complex *input,
                           const int32_t *sheets, uint32_t count,
                           ce_complex *output, uint8_t *valid) {
    if (!config || !input || !sheets || !output || !valid) return -1;
    const uint32_t chain_count = config->chain_count ? config->chain_count : 1u;
    if (config->dynamic_source_count) {
        for (uint32_t point = 0; point < count; ++point) {
            ce_complex current = config->zero_seed ? ce_make(0.0, 0.0) : input[point];
            ce_complex last = ce_make(NAN, NAN);
            int ok = 0;
            for (uint32_t iteration = 0; iteration < chain_count; ++iteration) {
                current = ce_eval_dynamic(config, current, sheets[point], &ok, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
                if (!ok) break;
                last = current;
                if (fabs(current.re) >= CE_CHAIN_BAILOUT || fabs(current.im) >= CE_CHAIN_BAILOUT) break;
            }
            output[point] = ok ? last : ce_make(NAN, NAN);
            valid[point] = (uint8_t)ok;
        }
        return 0;
    }
    for (uint32_t point = 0; point < count; ++point) {
        ce_complex current = config->zero_seed ? ce_make(0.0, 0.0) : input[point];
        int ok = 0;
        for (uint32_t iteration = 0; iteration < chain_count; ++iteration) {
            current = ce_eval_function_sheet(
                config->function_id, current, input[point], &config->function, sheets[point]
            );
            ok = ce_valid(current);
            if (!ok || fabs(current.re) >= CE_CHAIN_BAILOUT || fabs(current.im) >= CE_CHAIN_BAILOUT) break;
        }
        output[point] = ok ? current : ce_make(NAN, NAN);
        valid[point] = (uint8_t)ok;
    }
    return 0;
}

static int ce_segment_crossing(ce_complex a, ce_complex b, ce_complex c, ce_complex d,
                               double *path_t) {
    const double path_re = b.re - a.re, path_im = b.im - a.im;
    const double cut_re = d.re - c.re, cut_im = d.im - c.im;
    const double denominator = path_re * cut_im - path_im * cut_re;
    if (fabs(denominator) <= 1e-9) return 0;
    const double offset_re = c.re - a.re, offset_im = c.im - a.im;
    const double t = (offset_re * cut_im - offset_im * cut_re) / denominator;
    const double cut_t = (offset_re * path_im - offset_im * path_re) / denominator;
    if (t <= 1e-9 || t > 1.0 + 1e-9 || cut_t < -1e-9 || cut_t > 1.0 + 1e-9) return 0;
    *path_t = t;
    return (cut_re * path_im - cut_im * path_re) >= 0.0 ? 1 : -1;
}

static int ce_ray_crossing(ce_complex a, ce_complex b, double angle) {
    const double cosine = cos(angle), sine = sin(angle);
    const double ar = a.re * cosine + a.im * sine;
    const double ai = -a.re * sine + a.im * cosine;
    const double br = b.re * cosine + b.im * sine;
    const double bi = -b.re * sine + b.im * cosine;
    const double delta = bi - ai;
    if (fabs(delta) <= 1e-9) return 0;
    const double t = -ai / delta;
    if (t <= 1e-9 || t > 1.0 + 1e-9 || ar + (br - ar) * t <= 1e-9) return 0;
    return delta > 0.0 ? 1 : -1;
}

int32_t ce_continuation_sheets(const ce_complex *path, uint32_t point_count,
                               uint32_t drawn_cut, double cut_angle,
                               const ce_complex *cut_points, uint32_t cut_point_count) {
    if (!path || point_count < 2u || (drawn_cut && (!cut_points || cut_point_count < 2u))) return 0;
    int32_t sheet = 0;
    for (uint32_t segment = 1; segment < point_count; ++segment) {
        if (!drawn_cut) {
            sheet += ce_ray_crossing(path[segment - 1u], path[segment], cut_angle);
            continue;
        }
        double previous_t = -1.0;
        for (uint32_t cut = 1; cut < cut_point_count; ++cut) {
            double t = 0.0;
            const int crossing = ce_segment_crossing(
                path[segment - 1u], path[segment], cut_points[cut - 1u], cut_points[cut], &t
            );
            if (crossing && fabs(t - previous_t) > 1e-8) {
                sheet += crossing;
                previous_t = t;
            }
        }
    }
    return sheet;
}

int32_t ce_pow_points(const ce_complex *bases, const ce_complex *exponents,
                      uint32_t count, ce_complex *output) {
    if (!bases || !exponents || !output) return -1;
    for (uint32_t index = 0; index < count; ++index) output[index] = ce_pow(bases[index], exponents[index]);
    return 0;
}

int32_t ce_zeta_points(const ce_complex *input, uint32_t count, uint32_t algorithm,
                       uint32_t work_count, ce_complex *output) {
    if (!input || !output || !work_count) return -1;
    for (uint32_t index = 0; index < count; ++index) {
        const ce_complex z = input[index];
        if (algorithm == 0) {
            output[index] = ce_zeta_direct(z.re, z.im, work_count);
        } else if (algorithm == 1) {
            if (z.re == 1.0 && z.im == 0.0) output[index] = ce_make(INFINITY, NAN);
            else {
                ce_complex sum = ce_make(0.0, 0.0);
                for (uint32_t n = 1; n <= work_count; ++n) {
                    const double logarithm = log((double)n);
                    const double magnitude = ce_exp_safe(-z.re * logarithm);
                    const double angle = -z.im * logarithm;
                    const double sign = n & 1u ? 1.0 : -1.0;
                    sum.re += sign * magnitude * cos(angle);
                    sum.im += sign * magnitude * sin(angle);
                }
                ce_complex denominator = ce_make(
                    1.0 - ce_exp_safe((1.0 - z.re) * log(2.0)) * cos(-z.im * log(2.0)),
                    -ce_exp_safe((1.0 - z.re) * log(2.0)) * sin(-z.im * log(2.0))
                );
                output[index] = ce_div(sum, denominator);
            }
        } else if (algorithm == 2) {
            output[index] = ce_zeta_eta(z.re, z.im, work_count);
        } else return -2;
    }
    return 0;
}

int32_t ce_map_planar_geometry(const ce_map_config *config, const ce_complex *input,
                              uint32_t count, ce_complex *output, uint8_t *valid) {
    return ce_evaluate_points(config, input, count, output, valid);
}
