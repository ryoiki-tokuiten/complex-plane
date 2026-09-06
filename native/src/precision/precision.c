#include "complex_engine.h"
#include "precision_internal.h"

#include <math.h>
#include <mpfr.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define CE_MIN_PRECISION_BITS 128u
#define CE_MAX_PRECISION_BITS 4096u
#define CE_PRECISE_STACK_LIMIT 128u
#define CE_ESCAPE_RADIUS_SQ 1e8

typedef struct {
    mpfr_t re;
    mpfr_t im;
} ce_precise_complex;

static void pc_init(ce_precise_complex *value, mpfr_prec_t precision) {
    mpfr_init2(value->re, precision);
    mpfr_init2(value->im, precision);
}

static void pc_clear(ce_precise_complex *value) {
    mpfr_clear(value->re);
    mpfr_clear(value->im);
}

static void pc_set(ce_precise_complex *output, const ce_precise_complex *value) {
    mpfr_set(output->re, value->re, MPFR_RNDN);
    mpfr_set(output->im, value->im, MPFR_RNDN);
}

static void pc_set_d(ce_precise_complex *output, double re, double im) {
    mpfr_set_d(output->re, re, MPFR_RNDN);
    mpfr_set_d(output->im, im, MPFR_RNDN);
}

static void pc_set_complex(ce_precise_complex *output, ce_complex value) {
    pc_set_d(output, value.re, value.im);
}

static void pc_add(ce_precise_complex *output, const ce_precise_complex *a,
                   const ce_precise_complex *b) {
    mpfr_add(output->re, a->re, b->re, MPFR_RNDN);
    mpfr_add(output->im, a->im, b->im, MPFR_RNDN);
}

static void pc_sub(ce_precise_complex *output, const ce_precise_complex *a,
                   const ce_precise_complex *b) {
    mpfr_sub(output->re, a->re, b->re, MPFR_RNDN);
    mpfr_sub(output->im, a->im, b->im, MPFR_RNDN);
}

static void pc_neg(ce_precise_complex *output, const ce_precise_complex *value) {
    mpfr_neg(output->re, value->re, MPFR_RNDN);
    mpfr_neg(output->im, value->im, MPFR_RNDN);
}

static void pc_mul(ce_precise_complex *output, const ce_precise_complex *a,
                   const ce_precise_complex *b) {
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    mpfr_t real, imaginary, scratch;
    mpfr_inits2(precision, real, imaginary, scratch, (mpfr_ptr)0);
    mpfr_mul(real, a->re, b->re, MPFR_RNDN);
    mpfr_mul(scratch, a->im, b->im, MPFR_RNDN);
    mpfr_sub(real, real, scratch, MPFR_RNDN);
    mpfr_mul(imaginary, a->re, b->im, MPFR_RNDN);
    mpfr_mul(scratch, a->im, b->re, MPFR_RNDN);
    mpfr_add(imaginary, imaginary, scratch, MPFR_RNDN);
    mpfr_set(output->re, real, MPFR_RNDN);
    mpfr_set(output->im, imaginary, MPFR_RNDN);
    mpfr_clears(real, imaginary, scratch, (mpfr_ptr)0);
}

static int pc_div(ce_precise_complex *output, const ce_precise_complex *a,
                  const ce_precise_complex *b) {
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    mpfr_t denominator, real, imaginary, scratch;
    mpfr_inits2(precision, denominator, real, imaginary, scratch, (mpfr_ptr)0);
    mpfr_sqr(denominator, b->re, MPFR_RNDN);
    mpfr_sqr(scratch, b->im, MPFR_RNDN);
    mpfr_add(denominator, denominator, scratch, MPFR_RNDN);
    if (mpfr_zero_p(denominator)) {
        mpfr_set_nan(output->re);
        mpfr_set_nan(output->im);
        mpfr_clears(denominator, real, imaginary, scratch, (mpfr_ptr)0);
        return 0;
    }
    mpfr_mul(real, a->re, b->re, MPFR_RNDN);
    mpfr_mul(scratch, a->im, b->im, MPFR_RNDN);
    mpfr_add(real, real, scratch, MPFR_RNDN);
    mpfr_div(real, real, denominator, MPFR_RNDN);
    mpfr_mul(imaginary, a->im, b->re, MPFR_RNDN);
    mpfr_mul(scratch, a->re, b->im, MPFR_RNDN);
    mpfr_sub(imaginary, imaginary, scratch, MPFR_RNDN);
    mpfr_div(imaginary, imaginary, denominator, MPFR_RNDN);
    mpfr_set(output->re, real, MPFR_RNDN);
    mpfr_set(output->im, imaginary, MPFR_RNDN);
    mpfr_clears(denominator, real, imaginary, scratch, (mpfr_ptr)0);
    return 1;
}

static void pc_exp(ce_precise_complex *output, const ce_precise_complex *value) {
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    mpfr_t magnitude, cosine, sine;
    mpfr_inits2(precision, magnitude, cosine, sine, (mpfr_ptr)0);
    mpfr_exp(magnitude, value->re, MPFR_RNDN);
    mpfr_cos(cosine, value->im, MPFR_RNDN);
    mpfr_sin(sine, value->im, MPFR_RNDN);
    mpfr_mul(output->re, magnitude, cosine, MPFR_RNDN);
    mpfr_mul(output->im, magnitude, sine, MPFR_RNDN);
    mpfr_clears(magnitude, cosine, sine, (mpfr_ptr)0);
}

static void pc_log(ce_precise_complex *output, const ce_precise_complex *value,
                   const ce_function_config *config) {
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    mpfr_t magnitude, two_pi;
    mpfr_inits2(precision, magnitude, two_pi, (mpfr_ptr)0);
    mpfr_hypot(magnitude, value->re, value->im, MPFR_RNDN);
    mpfr_log(output->re, magnitude, MPFR_RNDN);
    mpfr_atan2(output->im, value->im, value->re, MPFR_RNDN);
    if (config && config->branch_cut_is_ray) {
        mpfr_const_pi(two_pi, MPFR_RNDN);
        mpfr_mul_ui(two_pi, two_pi, 2u, MPFR_RNDN);
        while (mpfr_cmp_d(output->im, config->branch_cut_angle) > 0) {
            mpfr_sub(output->im, output->im, two_pi, MPFR_RNDN);
        }
        while (mpfr_cmp_d(output->im, config->branch_cut_angle - 6.28318530717958647693) <= 0) {
            mpfr_add(output->im, output->im, two_pi, MPFR_RNDN);
        }
    }
    mpfr_clears(magnitude, two_pi, (mpfr_ptr)0);
}

static void pc_sin(ce_precise_complex *output, const ce_precise_complex *value) {
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    mpfr_t a, b;
    mpfr_inits2(precision, a, b, (mpfr_ptr)0);
    mpfr_sin(a, value->re, MPFR_RNDN);
    mpfr_cosh(b, value->im, MPFR_RNDN);
    mpfr_mul(output->re, a, b, MPFR_RNDN);
    mpfr_cos(a, value->re, MPFR_RNDN);
    mpfr_sinh(b, value->im, MPFR_RNDN);
    mpfr_mul(output->im, a, b, MPFR_RNDN);
    mpfr_clears(a, b, (mpfr_ptr)0);
}

static void pc_cos(ce_precise_complex *output, const ce_precise_complex *value) {
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    mpfr_t a, b;
    mpfr_inits2(precision, a, b, (mpfr_ptr)0);
    mpfr_cos(a, value->re, MPFR_RNDN);
    mpfr_cosh(b, value->im, MPFR_RNDN);
    mpfr_mul(output->re, a, b, MPFR_RNDN);
    mpfr_sin(a, value->re, MPFR_RNDN);
    mpfr_sinh(b, value->im, MPFR_RNDN);
    mpfr_mul(output->im, a, b, MPFR_RNDN);
    mpfr_neg(output->im, output->im, MPFR_RNDN);
    mpfr_clears(a, b, (mpfr_ptr)0);
}

static void pc_sinh(ce_precise_complex *output, const ce_precise_complex *value) {
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    mpfr_t a, b;
    mpfr_inits2(precision, a, b, (mpfr_ptr)0);
    mpfr_sinh(a, value->re, MPFR_RNDN);
    mpfr_cos(b, value->im, MPFR_RNDN);
    mpfr_mul(output->re, a, b, MPFR_RNDN);
    mpfr_cosh(a, value->re, MPFR_RNDN);
    mpfr_sin(b, value->im, MPFR_RNDN);
    mpfr_mul(output->im, a, b, MPFR_RNDN);
    mpfr_clears(a, b, (mpfr_ptr)0);
}

static void pc_cosh(ce_precise_complex *output, const ce_precise_complex *value) {
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    mpfr_t a, b;
    mpfr_inits2(precision, a, b, (mpfr_ptr)0);
    mpfr_cosh(a, value->re, MPFR_RNDN);
    mpfr_cos(b, value->im, MPFR_RNDN);
    mpfr_mul(output->re, a, b, MPFR_RNDN);
    mpfr_sinh(a, value->re, MPFR_RNDN);
    mpfr_sin(b, value->im, MPFR_RNDN);
    mpfr_mul(output->im, a, b, MPFR_RNDN);
    mpfr_clears(a, b, (mpfr_ptr)0);
}

static void pc_sqrt(ce_precise_complex *output, const ce_precise_complex *value) {
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    mpfr_t magnitude, real, imaginary;
    mpfr_inits2(precision, magnitude, real, imaginary, (mpfr_ptr)0);
    mpfr_hypot(magnitude, value->re, value->im, MPFR_RNDN);
    mpfr_add(real, magnitude, value->re, MPFR_RNDN);
    mpfr_div_ui(real, real, 2u, MPFR_RNDN);
    mpfr_sqrt(real, real, MPFR_RNDN);
    mpfr_sub(imaginary, magnitude, value->re, MPFR_RNDN);
    mpfr_div_ui(imaginary, imaginary, 2u, MPFR_RNDN);
    mpfr_sqrt(imaginary, imaginary, MPFR_RNDN);
    if (mpfr_signbit(value->im)) mpfr_neg(imaginary, imaginary, MPFR_RNDN);
    mpfr_set(output->re, real, MPFR_RNDN);
    mpfr_set(output->im, imaginary, MPFR_RNDN);
    mpfr_clears(magnitude, real, imaginary, (mpfr_ptr)0);
}

static int pc_finite(const ce_precise_complex *value);

static int pc_pow_integer(ce_precise_complex *output, const ce_precise_complex *base, long power) {
    ce_precise_complex factor, result;
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    pc_init(&factor, precision); pc_init(&result, precision);
    pc_set(&factor, base); pc_set_d(&result, 1.0, 0.0);
    unsigned long remaining = power < 0 ? (unsigned long)(-power) : (unsigned long)power;
    while (remaining) {
        if (remaining & 1u) pc_mul(&result, &result, &factor);
        remaining >>= 1u;
        if (remaining) pc_mul(&factor, &factor, &factor);
    }
    int valid = 1;
    if (power < 0) {
        pc_set_d(&factor, 1.0, 0.0);
        valid = pc_div(&result, &factor, &result);
    }
    pc_set(output, &result);
    pc_clear(&factor); pc_clear(&result);
    return valid && pc_finite(output);
}

static void pc_pow(ce_precise_complex *output, const ce_precise_complex *base,
                   const ce_precise_complex *exponent, const ce_function_config *config) {
    if (mpfr_zero_p(exponent->im) && mpfr_integer_p(exponent->re) && mpfr_fits_slong_p(exponent->re, MPFR_RNDN)) {
        pc_pow_integer(output, base, mpfr_get_si(exponent->re, MPFR_RNDN));
        return;
    }
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    ce_precise_complex logarithm, product;
    pc_init(&logarithm, precision); pc_init(&product, precision);
    pc_log(&logarithm, base, config);
    pc_mul(&product, exponent, &logarithm);
    pc_exp(output, &product);
    pc_clear(&logarithm); pc_clear(&product);
}

static int pc_finite(const ce_precise_complex *value) {
    return mpfr_number_p(value->re) && mpfr_number_p(value->im);
}

static int pc_bailout(const ce_precise_complex *value) {
    if (mpfr_cmp_d(value->re, 1e8) >= 0 || mpfr_cmp_d(value->re, -1e8) <= 0 ||
        mpfr_cmp_d(value->im, 1e8) >= 0 || mpfr_cmp_d(value->im, -1e8) <= 0) return 1;
    const mpfr_prec_t precision = mpfr_get_prec(value->re);
    mpfr_t magnitude, scratch;
    mpfr_inits2(precision, magnitude, scratch, (mpfr_ptr)0);
    mpfr_sqr(magnitude, value->re, MPFR_RNDN);
    mpfr_sqr(scratch, value->im, MPFR_RNDN);
    mpfr_add(magnitude, magnitude, scratch, MPFR_RNDN);
    const int escaped = mpfr_cmp_d(magnitude, CE_ESCAPE_RADIUS_SQ) > 0;
    mpfr_clears(magnitude, scratch, (mpfr_ptr)0);
    return escaped;
}



static void pc_gamma(ce_precise_complex *output, const ce_precise_complex *z);

static void pc_gamma(ce_precise_complex *output, const ce_precise_complex *z) {
    static const char *coefficients[] = {
        "0.99999999999980993", "676.5203681218851", "-1259.1392167224028",
        "771.32342877765313", "-176.61502916214059", "12.507343278686905",
        "-0.13857109526572012", "0.0000099843695780195716", "0.00000015056327351493116"
    };
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    ce_precise_complex a, b, c, sum, term;
    pc_init(&a, precision); pc_init(&b, precision); pc_init(&c, precision);
    pc_init(&sum, precision); pc_init(&term, precision);
    if (mpfr_cmp_d(z->re, 0.5) < 0) {
        pc_set_d(&a, 1.0, 0.0);
        pc_sub(&a, &a, z);
        pc_gamma(&b, &a);
        mpfr_const_pi(a.re, MPFR_RNDN);
        mpfr_set_zero(a.im, 0);
        pc_mul(&c, &a, z);
        pc_sin(&c, &c);
        pc_mul(&b, &c, &b);
        pc_div(output, &a, &b);
        goto done;
    }

    pc_set(&a, z);
    mpfr_sub_ui(a.re, a.re, 1u, MPFR_RNDN);
    mpfr_set_str(sum.re, coefficients[0], 10, MPFR_RNDN);
    mpfr_set_zero(sum.im, 0);
    for (uint32_t index = 1; index < 9u; ++index) {
        pc_set(&b, &a);
        mpfr_add_ui(b.re, b.re, index, MPFR_RNDN);
        mpfr_set_str(c.re, coefficients[index], 10, MPFR_RNDN);
        mpfr_set_zero(c.im, 0);
        pc_div(&term, &c, &b);
        pc_add(&sum, &sum, &term);
    }
    pc_set(&b, z);
    mpfr_add_d(b.re, b.re, 6.5, MPFR_RNDN);
    pc_set(&c, z);
    mpfr_sub_d(c.re, c.re, 0.5, MPFR_RNDN);
    pc_pow(&term, &b, &c, NULL);
    pc_neg(&c, &b);
    pc_exp(&c, &c);
    pc_mul(&term, &term, &c);
    pc_mul(&term, &term, &sum);
    mpfr_const_pi(c.re, MPFR_RNDN);
    mpfr_mul_ui(c.re, c.re, 2u, MPFR_RNDN);
    mpfr_sqrt(c.re, c.re, MPFR_RNDN);
    mpfr_set_zero(c.im, 0);
    pc_mul(output, &term, &c);

done:
    pc_clear(&a); pc_clear(&b); pc_clear(&c); pc_clear(&sum); pc_clear(&term);
}

static void pc_bessel(ce_precise_complex *output, const ce_precise_complex *z,
                      const ce_precise_complex *order) {
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    ce_precise_complex half, logarithm, gamma_arg, gamma_value, exponent, term, sum, step, denominator;
    pc_init(&half, precision); pc_init(&logarithm, precision); pc_init(&gamma_arg, precision);
    pc_init(&gamma_value, precision); pc_init(&exponent, precision); pc_init(&term, precision);
    pc_init(&sum, precision); pc_init(&step, precision); pc_init(&denominator, precision);
    if (mpfr_zero_p(z->re) && mpfr_zero_p(z->im)) {
        if (mpfr_zero_p(order->re) && mpfr_zero_p(order->im)) pc_set_d(output, 1.0, 0.0);
        else if (mpfr_sgn(order->re) > 0) pc_set_d(output, 0.0, 0.0);
        else { mpfr_set_nan(output->re); mpfr_set_nan(output->im); }
        goto done;
    }
    pc_set(&half, z);
    mpfr_div_ui(half.re, half.re, 2u, MPFR_RNDN);
    mpfr_div_ui(half.im, half.im, 2u, MPFR_RNDN);
    pc_log(&logarithm, &half, NULL);
    pc_mul(&exponent, order, &logarithm);
    pc_set(&gamma_arg, order);
    mpfr_add_ui(gamma_arg.re, gamma_arg.re, 1u, MPFR_RNDN);
    pc_gamma(&gamma_value, &gamma_arg);
    pc_log(&gamma_value, &gamma_value, NULL);
    pc_sub(&exponent, &exponent, &gamma_value);
    pc_exp(&term, &exponent);
    pc_set(&sum, &term);
    pc_mul(&step, z, z);
    mpfr_div_si(step.re, step.re, -4l, MPFR_RNDN);
    mpfr_div_si(step.im, step.im, -4l, MPFR_RNDN);
    mpfr_t term_magnitude, sum_magnitude;
    mpfr_inits2(precision, term_magnitude, sum_magnitude, (mpfr_ptr)0);
    for (uint32_t k = 0; k < 160u; ++k) {
        pc_set(&denominator, order);
        mpfr_add_ui(denominator.re, denominator.re, k + 1u, MPFR_RNDN);
        mpfr_mul_ui(denominator.re, denominator.re, k + 1u, MPFR_RNDN);
        mpfr_mul_ui(denominator.im, denominator.im, k + 1u, MPFR_RNDN);
        pc_mul(&term, &term, &step);
        pc_div(&term, &term, &denominator);
        pc_add(&sum, &sum, &term);
        mpfr_hypot(term_magnitude, term.re, term.im, MPFR_RNDN);
        mpfr_hypot(sum_magnitude, sum.re, sum.im, MPFR_RNDN);
        if (mpfr_cmp_ui(sum_magnitude, 1u) < 0) mpfr_set_ui(sum_magnitude, 1u, MPFR_RNDN);
        mpfr_mul_d(sum_magnitude, sum_magnitude, 1e-30, MPFR_RNDN);
        if (mpfr_cmp(term_magnitude, sum_magnitude) <= 0) break;
    }
    pc_set(output, &sum);
    mpfr_clears(term_magnitude, sum_magnitude, (mpfr_ptr)0);

done:
    pc_clear(&half); pc_clear(&logarithm); pc_clear(&gamma_arg); pc_clear(&gamma_value);
    pc_clear(&exponent); pc_clear(&term); pc_clear(&sum); pc_clear(&step); pc_clear(&denominator);
}

static void pc_zeta(ce_precise_complex *output, const ce_precise_complex *z,
                    const ce_function_config *config) {
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    ce_precise_complex sum, base, exponent, powered, denominator, two;
    pc_init(&sum, precision); pc_init(&base, precision);
    pc_init(&exponent, precision); pc_init(&powered, precision); pc_init(&denominator, precision);
    pc_init(&two, precision);
    pc_set_d(&sum, 0.0, 0.0);
    pc_set_d(&two, 2.0, 0.0);
    if (!config->zeta_continuation) {
        if (mpfr_cmp_ui(z->re, 1u) <= 0) {
            mpfr_set_nan(output->re);
            mpfr_set_nan(output->im);
            goto done;
        }
        pc_neg(&exponent, z);
        for (uint32_t n = 1; n <= 100u; ++n) {
            pc_set_d(&base, (double)n, 0.0);
            pc_pow(&powered, &base, &exponent, NULL);
            pc_add(&sum, &sum, &powered);
        }
        pc_set(output, &sum);
        goto done;
    }
    pc_neg(&exponent, z);
    const uint32_t levels = 32u;
    mpfr_t binomial, cumulative, weight;
    mpfr_inits2(precision, binomial, cumulative, weight, (mpfr_ptr)0);
    mpfr_set_ui(binomial, 1u, MPFR_RNDN);
    mpfr_set_ui(cumulative, 0u, MPFR_RNDN);
    for (uint32_t k = 0; k < levels; ++k) {
        if (k) {
            mpfr_mul_ui(binomial, binomial, levels - k + 1u, MPFR_RNDN);
            mpfr_div_ui(binomial, binomial, k, MPFR_RNDN);
        }
        mpfr_add(cumulative, cumulative, binomial, MPFR_RNDN);
        mpfr_div_2ui(weight, cumulative, levels, MPFR_RNDN);
        mpfr_ui_sub(weight, 1u, weight, MPFR_RNDN);
        if (k & 1u) mpfr_neg(weight, weight, MPFR_RNDN);
        pc_set_d(&base, (double)k + 1.0, 0.0);
        pc_pow(&powered, &base, &exponent, NULL);
        mpfr_mul(powered.re, powered.re, weight, MPFR_RNDN);
        mpfr_mul(powered.im, powered.im, weight, MPFR_RNDN);
        pc_add(&sum, &sum, &powered);
    }
    pc_set_d(&base, 1.0, 0.0);
    pc_sub(&exponent, &base, z);
    pc_pow(&powered, &two, &exponent, NULL);
    pc_sub(&denominator, &base, &powered);
    pc_div(output, &sum, &denominator);
    mpfr_clears(binomial, cumulative, weight, (mpfr_ptr)0);

done:
    pc_clear(&sum); pc_clear(&base); pc_clear(&exponent);
    pc_clear(&powered); pc_clear(&denominator); pc_clear(&two);
}

static int pc_eval_function(ce_precise_complex *output, uint32_t function_id,
                            const ce_precise_complex *z, const ce_precise_complex *c,
                            const ce_function_config *config);

static int pc_eval_expression(ce_precise_complex *output, const ce_precise_complex *z,
                              const ce_precise_complex *c, const ce_function_config *config) {
    if (!config->expression || !config->expression_count) {
        pc_set(output, z);
        return 1;
    }
    if (config->expression_count > CE_PRECISE_STACK_LIMIT) return 0;
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    ce_precise_complex stack[CE_PRECISE_STACK_LIMIT];
    for (uint32_t index = 0; index < CE_PRECISE_STACK_LIMIT; ++index) pc_init(&stack[index], precision);
    uint32_t size = 0;
    int valid = 1;
    for (uint32_t index = 0; index < config->expression_count && valid; ++index) {
        const ce_expression_instruction *instruction = &config->expression[index];
        switch (instruction->opcode) {
            case 0: pc_set_complex(&stack[size++], instruction->value); break;
            case 1: pc_set(&stack[size++], z); break;
            case 2: pc_set(&stack[size++], c); break;
            case 8:
                if (!size) { valid = 0; break; }
                pc_neg(&stack[size - 1u], &stack[size - 1u]);
                break;
            case 9:
                if (!size || instruction->argument == CE_FN_ALGEBRAIC) { valid = 0; break; }
                valid = pc_eval_function(&stack[size - 1u], instruction->argument,
                                         &stack[size - 1u], c, config);
                break;
            case 10:
                if (!size) { valid = 0; break; }
                mpfr_neg(stack[size - 1u].im, stack[size - 1u].im, MPFR_RNDN);
                break;
            case 11:
                if (!size) { valid = 0; break; }
                mpfr_hypot(stack[size - 1u].re, stack[size - 1u].re, stack[size - 1u].im, MPFR_RNDN);
                mpfr_set_zero(stack[size - 1u].im, 0);
                break;
            case 12:
                if (!size) { valid = 0; break; }
                mpfr_atan2(stack[size - 1u].re, stack[size - 1u].im, stack[size - 1u].re, MPFR_RNDN);
                mpfr_set_zero(stack[size - 1u].im, 0);
                break;
            case 13:
                if (!size) { valid = 0; break; }
                mpfr_set_zero(stack[size - 1u].im, 0);
                break;
            case 14:
                if (!size) { valid = 0; break; }
                mpfr_set(stack[size - 1u].re, stack[size - 1u].im, MPFR_RNDN);
                mpfr_set_zero(stack[size - 1u].im, 0);
                break;
            case 41:
                if (!size) { valid = 0; break; }
                pc_sqrt(&stack[size - 1u], &stack[size - 1u]);
                break;
            default: {
                if (size < 2u) { valid = 0; break; }
                ce_precise_complex *right = &stack[--size];
                ce_precise_complex *left = &stack[size - 1u];
                if (instruction->opcode == 3u) pc_add(left, left, right);
                else if (instruction->opcode == 4u) pc_sub(left, left, right);
                else if (instruction->opcode == 5u) pc_mul(left, left, right);
                else if (instruction->opcode == 6u) valid = pc_div(left, left, right);
                else if (instruction->opcode == 7u) pc_pow(left, left, right, config);
                else valid = 0;
                break;
            }
        }
        if (size > CE_PRECISE_STACK_LIMIT) valid = 0;
    }
    if (valid && size == 1u) pc_set(output, &stack[0]);
    else valid = 0;
    for (uint32_t index = 0; index < CE_PRECISE_STACK_LIMIT; ++index) pc_clear(&stack[index]);
    return valid && pc_finite(output);
}

static int pc_eval_taylor(ce_precise_complex *output, const ce_map_config *config,
                          const ce_precise_complex *point) {
    if (!config->taylor_coefficients || !config->taylor_count) return 0;
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    ce_precise_complex delta, coefficient;
    pc_init(&delta, precision); pc_init(&coefficient, precision);
    mpfr_sub_d(delta.re, point->re, config->taylor_center.re, MPFR_RNDN);
    mpfr_sub_d(delta.im, point->im, config->taylor_center.im, MPFR_RNDN);
    if (isfinite(config->taylor_radius_sq)) {
        mpfr_t distance_sq, scratch;
        mpfr_inits2(precision, distance_sq, scratch, (mpfr_ptr)0);
        mpfr_sqr(distance_sq, delta.re, MPFR_RNDN);
        mpfr_sqr(scratch, delta.im, MPFR_RNDN);
        mpfr_add(distance_sq, distance_sq, scratch, MPFR_RNDN);
        const int outside = mpfr_cmp_d(distance_sq, config->taylor_radius_sq * 1.000001) > 0;
        mpfr_clears(distance_sq, scratch, (mpfr_ptr)0);
        if (outside) { pc_clear(&delta); pc_clear(&coefficient); return 0; }
    }
    pc_set_d(output, 0.0, 0.0);
    for (uint32_t index = config->taylor_count; index-- > 0u;) {
        pc_mul(output, output, &delta);
        pc_set_complex(&coefficient, config->taylor_coefficients[index]);
        pc_add(output, output, &coefficient);
    }
    pc_clear(&delta); pc_clear(&coefficient);
    return pc_finite(output);
}

static int pc_eval_dynamic(ce_precise_complex *output, const ce_map_config *config,
                           const ce_precise_complex *parameter);

static int pc_eval_step(ce_precise_complex *output, const ce_map_config *config,
                        const ce_precise_complex *current, const ce_precise_complex *parameter) {
    if (config->dynamic_source_count) return pc_eval_dynamic(output, config, current);
    if (config->use_taylor) return pc_eval_taylor(output, config, current);
    if (config->kernel_kind == CE_MAP_KERNEL_QUADRATIC_PARAMETER) {
        pc_mul(output, current, current);
        pc_add(output, output, parameter);
        return pc_finite(output);
    }
    if (config->kernel_kind == CE_MAP_KERNEL_NEWTON_CUBIC) {
        const mpfr_prec_t precision = mpfr_get_prec(output->re);
        ce_precise_complex inverse;
        pc_init(&inverse, precision);
        pc_mul(output, current, current);
        pc_set_d(&inverse, 1.0 / 3.0, 0.0);
        const int valid = pc_div(&inverse, &inverse, output);
        mpfr_mul_d(output->re, current->re, 2.0 / 3.0, MPFR_RNDN);
        mpfr_mul_d(output->im, current->im, 2.0 / 3.0, MPFR_RNDN);
        pc_add(output, output, &inverse);
        pc_clear(&inverse);
        return valid && pc_finite(output);
    }
    if (config->kernel_kind == CE_MAP_KERNEL_POLYNOMIAL_PARAMETER) {
        const mpfr_prec_t precision = mpfr_get_prec(output->re);
        ce_precise_complex polynomial, coefficient, parameter_term, constant;
        pc_init(&polynomial, precision);
        pc_init(&coefficient, precision);
        pc_init(&parameter_term, precision);
        pc_init(&constant, precision);
        int valid = pc_eval_function(
            &polynomial, CE_FN_POLYNOMIAL, current, parameter, &config->function
        );
        if (valid) {
            pc_set_complex(&coefficient, config->kernel_polynomial_scale);
            pc_mul(&polynomial, &polynomial, &coefficient);
            pc_set_complex(&coefficient, config->kernel_parameter_scale);
            pc_mul(&parameter_term, parameter, &coefficient);
            pc_add(output, &polynomial, &parameter_term);
            pc_set_complex(&constant, config->kernel_constant);
            pc_add(output, output, &constant);
            valid = pc_finite(output);
        }
        pc_clear(&polynomial);
        pc_clear(&coefficient);
        pc_clear(&parameter_term);
        pc_clear(&constant);
        return valid;
    }
    if (config->kernel_kind == CE_MAP_KERNEL_LAURENT_PARAMETER) {
        const mpfr_prec_t precision = mpfr_get_prec(output->re);
        ce_precise_complex coefficient, term_value, parameter_term;
        pc_init(&coefficient, precision); pc_init(&term_value, precision); pc_init(&parameter_term, precision);
        pc_set_complex(output, config->kernel_constant);
        pc_set_complex(&coefficient, config->kernel_parameter_scale);
        pc_mul(&parameter_term, parameter, &coefficient);
        pc_add(output, output, &parameter_term);
        int valid = 1;
        const ce_function_config *function = &config->function;
        for (uint32_t index = 0; valid && index < function->algebraic_term_count; ++index) {
            const ce_algebraic_term *term = &function->algebraic_terms[index];
            if (!term->factor_count) continue;
            const ce_algebraic_factor *factor = &function->algebraic_factors[term->factor_offset];
            if (factor->function_id == CE_FN_C) continue;
            long exponent = (long)factor->power;
            if (factor->flags & 1u) exponent = -exponent;
            valid = pc_pow_integer(&term_value, current, exponent);
            pc_set_complex(&coefficient, term->coefficient);
            pc_mul(&term_value, &term_value, &coefficient);
            pc_add(output, output, &term_value);
        }
        pc_clear(&coefficient); pc_clear(&term_value); pc_clear(&parameter_term);
        return valid && pc_finite(output);
    }
    return pc_eval_function(output, config->function_id, current, parameter, &config->function);
}

static int pc_eval_map_point(ce_precise_complex *output, const ce_map_config *config,
                             const ce_precise_complex *point) {
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    ce_precise_complex current, next;
    pc_init(&current, precision); pc_init(&next, precision);
    if (config->zero_seed) pc_set_complex(&current, config->chain_seed);
    else pc_set(&current, point);
    int valid = 0;
    const uint32_t count = config->chain_count;
    for (uint32_t iteration = 0; iteration < count; ++iteration) {
        valid = pc_eval_step(&next, config, &current, point);
        if (!valid) break;
        pc_set(&current, &next);
        if (pc_bailout(&current)) break;
    }
    if (valid) pc_set(output, &current);
    pc_clear(&current); pc_clear(&next);
    return valid;
}

static int pc_eval_map_derivative(ce_precise_complex *output, const ce_map_config *config,
                                  const ce_precise_complex *point, uint32_t order) {
    if (!order) return pc_eval_map_point(output, config, point);
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    ce_precise_complex left_point, right_point, left, right;
    pc_init(&left_point, precision); pc_init(&right_point, precision);
    pc_init(&left, precision); pc_init(&right, precision);
    pc_set(&left_point, point); pc_set(&right_point, point);
    mpfr_t h, magnitude;
    mpfr_inits2(precision, h, magnitude, (mpfr_ptr)0);
    mpfr_abs(magnitude, point->re, MPFR_RNDN);
    mpfr_abs(h, point->im, MPFR_RNDN);
    if (mpfr_cmp(h, magnitude) > 0) mpfr_set(magnitude, h, MPFR_RNDN);
    if (mpfr_cmp_ui(magnitude, 1u) < 0) mpfr_set_ui(magnitude, 1u, MPFR_RNDN);
    mpfr_set_ui(h, 1u, MPFR_RNDN);
    mpfr_div_2ui(h, h, (unsigned long)(precision / 3), MPFR_RNDN);
    mpfr_mul(h, h, magnitude, MPFR_RNDN);
    mpfr_sub(left_point.re, left_point.re, h, MPFR_RNDN);
    mpfr_add(right_point.re, right_point.re, h, MPFR_RNDN);
    const int left_valid = pc_eval_map_derivative(&left, config, &left_point, order - 1u);
    const int right_valid = pc_eval_map_derivative(&right, config, &right_point, order - 1u);
    int valid = left_valid && right_valid;
    if (valid) {
        mpfr_sub(output->re, right.re, left.re, MPFR_RNDN);
        mpfr_sub(output->im, right.im, left.im, MPFR_RNDN);
        mpfr_mul_ui(h, h, 2u, MPFR_RNDN);
        mpfr_div(output->re, output->re, h, MPFR_RNDN);
        mpfr_div(output->im, output->im, h, MPFR_RNDN);
        valid = pc_finite(output);
    }
    mpfr_clears(h, magnitude, (mpfr_ptr)0);
    pc_clear(&left_point); pc_clear(&right_point); pc_clear(&left); pc_clear(&right);
    return valid;
}

static int pc_eval_algebraic(ce_precise_complex *output, const ce_precise_complex *input,
                             const ce_precise_complex *c, const ce_function_config *config) {
    if (!config->algebraic_terms || !config->algebraic_term_count ||
        (config->algebraic_factor_count && !config->algebraic_factors)) return 0;
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    ce_precise_complex z, sum, value, argument, factor_value, exponent, one;
    pc_init(&z, precision); pc_init(&sum, precision); pc_init(&value, precision);
    pc_init(&argument, precision); pc_init(&factor_value, precision); pc_init(&exponent, precision);
    pc_init(&one, precision);
    pc_set_d(&sum, 0.0, 0.0); pc_set_d(&one, 1.0, 0.0);
    int valid = pc_eval_expression(&z, input, c, config);
    for (uint32_t term_index = 0; term_index < config->algebraic_term_count && valid; ++term_index) {
        const ce_algebraic_term *term = &config->algebraic_terms[term_index];
        if (term->factor_offset > config->algebraic_factor_count ||
            term->factor_count > config->algebraic_factor_count - term->factor_offset) {
            valid = 0;
            break;
        }
        pc_set_complex(&value, term->coefficient);
        for (uint32_t factor_index = 0; factor_index < term->factor_count && valid; ++factor_index) {
            const ce_algebraic_factor *factor = &config->algebraic_factors[term->factor_offset + factor_index];
            pc_set(&argument, &z);
            if (factor->chained_function_id >= 0) {
                valid = pc_eval_function(&argument, (uint32_t)factor->chained_function_id,
                                         &argument, c, config);
            }
            if (valid) valid = pc_eval_function(&factor_value, factor->function_id,
                                                &argument, c, config);
            if (!valid) break;
            if (factor->power != 1.0) {
                pc_set_d(&exponent, factor->power, 0.0);
                pc_pow(&factor_value, &factor_value, &exponent, config);
            }
            if (factor->flags & 1u) valid = pc_div(&factor_value, &one, &factor_value);
            if (valid && (factor->flags & 2u)) {
                ce_precise_complex base_log;
                pc_init(&base_log, precision);
                pc_log(&factor_value, &factor_value, config);
                pc_set_complex(&argument, config->log_base);
                pc_log(&base_log, &argument, NULL);
                valid = pc_div(&factor_value, &factor_value, &base_log);
                pc_clear(&base_log);
            }
            if (valid && (factor->flags & 4u)) {
                ce_precise_complex base_log;
                pc_init(&base_log, precision);
                pc_set_complex(&argument, config->exp_base);
                pc_log(&base_log, &argument, NULL);
                pc_mul(&factor_value, &factor_value, &base_log);
                pc_exp(&factor_value, &factor_value);
                pc_clear(&base_log);
            }
            if (valid) pc_mul(&value, &value, &factor_value);
        }
        if (valid) pc_add(&sum, &sum, &value);
    }
    if (valid) pc_set(output, &sum);
    pc_clear(&z); pc_clear(&sum); pc_clear(&value); pc_clear(&argument);
    pc_clear(&factor_value); pc_clear(&exponent); pc_clear(&one);
    return valid && pc_finite(output);
}

static int pc_eval_function(ce_precise_complex *output, uint32_t function_id,
                            const ce_precise_complex *z, const ce_precise_complex *c,
                            const ce_function_config *config) {
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    ce_precise_complex a, b, one;
    pc_init(&a, precision); pc_init(&b, precision); pc_init(&one, precision);
    pc_set_d(&one, 1.0, 0.0);
    int valid = 1;
    switch (function_id) {
        case CE_FN_C:
            pc_set(output, c);
            break;
        case CE_FN_COS:
            pc_cos(output, z);
            break;
        case CE_FN_SIN:
            pc_sin(output, z);
            break;
        case CE_FN_TAN:
            pc_sin(&a, z); pc_cos(&b, z); valid = pc_div(output, &a, &b);
            break;
        case CE_FN_SEC:
            pc_cos(&a, z); valid = pc_div(output, &one, &a);
            break;
        case CE_FN_EXP:
            pc_set_complex(&a, config->exp_base);
            pc_log(&a, &a, NULL);
            pc_mul(&a, z, &a);
            pc_exp(output, &a);
            break;
        case CE_FN_LN:
            pc_log(&a, z, config);
            pc_set_complex(&b, config->log_base);
            pc_log(&b, &b, NULL);
            valid = pc_div(output, &a, &b);
            break;
        case CE_FN_SINH:
            pc_sinh(output, z);
            break;
        case CE_FN_TANH:
            pc_sinh(&a, z); pc_cosh(&b, z); valid = pc_div(output, &a, &b);
            break;
        case CE_FN_ASIN:
            pc_mul(&a, z, z);
            pc_sub(&a, &one, &a);
            pc_sqrt(&a, &a);
            mpfr_neg(b.re, z->im, MPFR_RNDN);
            mpfr_set(b.im, z->re, MPFR_RNDN);
            pc_add(&a, &a, &b);
            pc_log(&a, &a, NULL);
            mpfr_set(output->re, a.im, MPFR_RNDN);
            mpfr_neg(output->im, a.re, MPFR_RNDN);
            break;
        case CE_FN_ATAN:
            mpfr_sub(a.re, one.re, z->im, MPFR_RNDN);
            mpfr_set(a.im, z->re, MPFR_RNDN);
            mpfr_add(b.re, one.re, z->im, MPFR_RNDN);
            mpfr_neg(b.im, z->re, MPFR_RNDN);
            pc_log(&a, &a, NULL); pc_log(&b, &b, NULL); pc_sub(&a, &a, &b);
            mpfr_div_ui(output->re, a.im, 2u, MPFR_RNDN);
            mpfr_div_si(output->im, a.re, -2l, MPFR_RNDN);
            break;
        case CE_FN_GAMMA:
            pc_gamma(output, z);
            break;
        case CE_FN_LOG_GAMMA:
            pc_gamma(&a, z); pc_log(output, &a, NULL);
            break;
        case CE_FN_BESSEL:
            pc_set_complex(&a, config->bessel_order); pc_bessel(output, z, &a);
            break;
        case CE_FN_POWER:
            pc_set_d(&a, config->fractional_power, 0.0); pc_pow(output, z, &a, config);
            break;
        case CE_FN_MOBIUS:
            pc_set_complex(&a, config->mobius_a); pc_mul(&a, &a, z);
            pc_set_complex(&b, config->mobius_b); pc_add(&a, &a, &b);
            pc_set_complex(&b, config->mobius_c); pc_mul(&b, &b, z);
            pc_set_complex(output, config->mobius_d); pc_add(&b, &b, output);
            valid = pc_div(output, &a, &b);
            break;
        case CE_FN_ZETA:
            pc_zeta(output, z, config);
            break;
        case CE_FN_POLYNOMIAL:
            pc_set_d(output, 0.0, 0.0);
            for (uint32_t index = config->polynomial_count; index-- > 0;) {
                pc_mul(output, output, z);
                pc_set_complex(&a, config->polynomial[index]);
                pc_add(output, output, &a);
            }
            break;
        case CE_FN_ALGEBRAIC:
            valid = pc_eval_algebraic(output, z, c, config);
            break;
        case CE_FN_IDENTITY:
            pc_set(output, z);
            break;
        default:
            valid = 0;
            break;
    }
    pc_clear(&a); pc_clear(&b); pc_clear(&one);
    return valid && pc_finite(output);
}

static int pc_dynamic_truth(const ce_precise_complex *value) {
    return pc_finite(value) && (!mpfr_zero_p(value->re) || !mpfr_zero_p(value->im));
}

static int pc_dynamic_real(const ce_precise_complex *value) {
    return pc_finite(value) && mpfr_zero_p(value->im);
}

static int pc_dynamic_integer(const ce_precise_complex *value, long *output) {
    if (!pc_dynamic_real(value) || !mpfr_integer_p(value->re) ||
        !mpfr_fits_slong_p(value->re, MPFR_RNDN)) return 0;
    *output = mpfr_get_si(value->re, MPFR_RNDN);
    return 1;
}

static int pc_dynamic_prime(long value) {
    if (value < 2) return 0;
    if (value == 2 || value == 3) return 1;
    if (!(value & 1l) || value % 3l == 0l) return 0;
    for (long divisor = 5l, step = 2l; divisor <= value / divisor;
         divisor += step, step = 6l - step) {
        if (value % divisor == 0l) return 0;
    }
    return 1;
}

static int pc_eval_dynamic_expression(ce_precise_complex *output,
                                      const ce_map_config *base_config,
                                      const ce_expression_instruction *program,
                                      uint32_t instruction_count,
                                      ce_precise_complex *variables,
                                      uint32_t variable_count) {
    if (!program || !instruction_count || instruction_count > CE_PRECISE_STACK_LIMIT) return 0;
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    ce_precise_complex stack[CE_PRECISE_STACK_LIMIT];
    for (uint32_t index = 0; index < CE_PRECISE_STACK_LIMIT; ++index) pc_init(&stack[index], precision);
    uint32_t size = 0u, pc = 0u;
    int valid = 1;
    while (pc < instruction_count && valid) {
        const ce_expression_instruction *instruction = &program[pc++];
        ce_precise_complex *left, *right;
        long integer = 0l;
        switch (instruction->opcode) {
            case 0:
                if (size == CE_PRECISE_STACK_LIMIT) { valid = 0; break; }
                pc_set_complex(&stack[size++], instruction->value);
                break;
            case 15:
                if (size == CE_PRECISE_STACK_LIMIT || instruction->argument >= variable_count) {
                    valid = 0; break;
                }
                pc_set(&stack[size++], &variables[instruction->argument]);
                break;
            case 8:
                if (!size) { valid = 0; break; }
                pc_neg(&stack[size - 1u], &stack[size - 1u]);
                break;
            case 16:
            case 24:
                if (!size) { valid = 0; break; }
                pc_set_d(&stack[size - 1u],
                         instruction->opcode == 16u ? !pc_dynamic_truth(&stack[size - 1u])
                                                   : pc_dynamic_truth(&stack[size - 1u]), 0.0);
                break;
            case 10:
                if (!size) { valid = 0; break; }
                mpfr_neg(stack[size - 1u].im, stack[size - 1u].im, MPFR_RNDN);
                break;
            case 11:
                if (!size) { valid = 0; break; }
                mpfr_hypot(stack[size - 1u].re, stack[size - 1u].re,
                           stack[size - 1u].im, MPFR_RNDN);
                mpfr_set_zero(stack[size - 1u].im, 0);
                break;
            case 12:
                if (!size) { valid = 0; break; }
                mpfr_atan2(stack[size - 1u].re, stack[size - 1u].im,
                           stack[size - 1u].re, MPFR_RNDN);
                mpfr_set_zero(stack[size - 1u].im, 0);
                break;
            case 13:
                if (!size) { valid = 0; break; }
                mpfr_set_zero(stack[size - 1u].im, 0);
                break;
            case 14:
                if (!size) { valid = 0; break; }
                mpfr_set(stack[size - 1u].re, stack[size - 1u].im, MPFR_RNDN);
                mpfr_set_zero(stack[size - 1u].im, 0);
                break;
            case 17: {
                if (!size || !pc_dynamic_integer(&stack[size - 1u], &integer) || integer < 0l || integer > 170l) {
                    valid = 0; break;
                }
                mpfr_fac_ui(stack[size - 1u].re, (unsigned long)integer, MPFR_RNDN);
                mpfr_set_zero(stack[size - 1u].im, 0);
                break;
            }
            case 28: case 29: case 30: case 31: case 32:
                if (!size || !pc_dynamic_real(&stack[size - 1u])) { valid = 0; break; }
                if (instruction->opcode == 28u) mpfr_floor(stack[size - 1u].re, stack[size - 1u].re);
                else if (instruction->opcode == 29u) mpfr_ceil(stack[size - 1u].re, stack[size - 1u].re);
                else if (instruction->opcode == 30u) mpfr_round(stack[size - 1u].re, stack[size - 1u].re);
                else if (instruction->opcode == 31u) mpfr_trunc(stack[size - 1u].re, stack[size - 1u].re);
                else mpfr_set_si(stack[size - 1u].re, mpfr_sgn(stack[size - 1u].re), MPFR_RNDN);
                break;
            case 9:
                if (!size || instruction->argument == CE_FN_ALGEBRAIC) { valid = 0; break; }
                valid = pc_eval_function(&stack[size - 1u], instruction->argument,
                                         &stack[size - 1u], &stack[size - 1u],
                                         &base_config->function);
                break;
            case 41:
                if (!size) { valid = 0; break; }
                pc_sqrt(&stack[size - 1u], &stack[size - 1u]);
                break;
            case 40:
                if (!size) { valid = 0; break; }
                valid = pc_eval_map_point(&stack[size - 1u], base_config, &stack[size - 1u]);
                break;
            case 39:
                if (size < 2u) { valid = 0; break; }
                right = &stack[--size]; left = &stack[size - 1u];
                pc_bessel(left, right, left);
                break;
            case 38:
                if (!instruction->argument || instruction->argument > 2u || size < instruction->argument) {
                    valid = 0; break;
                }
                if (instruction->argument == 1u) {
                    if (!pc_dynamic_real(&stack[size - 1u])) valid = 0;
                } else {
                    right = &stack[--size]; left = &stack[size - 1u];
                    if (!pc_dynamic_real(left) || !pc_dynamic_real(right)) { valid = 0; break; }
                    mpfr_set(left->im, right->re, MPFR_RNDN);
                }
                break;
            case 33: case 34: {
                const uint32_t count = instruction->argument;
                if (!count || size < count) { valid = 0; break; }
                uint32_t chosen = size - count;
                for (uint32_t index = chosen; index < size; ++index) {
                    if (!pc_dynamic_real(&stack[index])) { valid = 0; break; }
                    const int comparison = mpfr_cmp(stack[index].re, stack[chosen].re);
                    if ((instruction->opcode == 33u && comparison < 0) ||
                        (instruction->opcode == 34u && comparison > 0)) chosen = index;
                }
                if (valid) {
                    pc_set(&stack[size - count], &stack[chosen]);
                    size -= count - 1u;
                }
                break;
            }
            case 35:
                if (size < 2u) { valid = 0; break; }
                right = &stack[--size]; left = &stack[size - 1u];
                if (!pc_dynamic_real(left) || !pc_dynamic_real(right) || mpfr_zero_p(right->re)) {
                    valid = 0; break;
                }
                mpfr_fmod(left->re, left->re, right->re, MPFR_RNDN);
                break;
            case 36:
                if (size < 2u) { valid = 0; break; }
                right = &stack[--size]; left = &stack[size - 1u];
                long a, b;
                if (!pc_dynamic_integer(left, &a) || !pc_dynamic_integer(right, &b)) { valid = 0; break; }
                if (a < 0l) a = -a; if (b < 0l) b = -b;
                while (b) { const long next = a % b; a = b; b = next; }
                pc_set_d(left, (double)a, 0.0);
                break;
            case 37:
                if (!size || !pc_dynamic_integer(&stack[size - 1u], &integer)) { valid = 0; break; }
                pc_set_d(&stack[size - 1u], pc_dynamic_prime(integer), 0.0);
                break;
            case 25: case 26:
                if (!size || instruction->argument > instruction_count) { valid = 0; break; }
                left = &stack[--size];
                if ((instruction->opcode == 25u && !pc_dynamic_truth(left)) ||
                    (instruction->opcode == 26u && pc_dynamic_truth(left))) pc = instruction->argument;
                break;
            case 27:
                if (instruction->argument > instruction_count) { valid = 0; break; }
                pc = instruction->argument;
                break;
            default:
                if (size < 2u) { valid = 0; break; }
                right = &stack[--size]; left = &stack[size - 1u];
                if (instruction->opcode == 3u) pc_add(left, left, right);
                else if (instruction->opcode == 4u) pc_sub(left, left, right);
                else if (instruction->opcode == 5u) pc_mul(left, left, right);
                else if (instruction->opcode == 6u) valid = pc_div(left, left, right);
                else if (instruction->opcode == 7u) pc_pow(left, left, right, &base_config->function);
                else if (instruction->opcode >= 18u && instruction->opcode <= 23u) {
                    int comparison = 0;
                    if (instruction->opcode == 18u || instruction->opcode == 19u) {
                        comparison = mpfr_equal_p(left->re, right->re) && mpfr_equal_p(left->im, right->im);
                        if (instruction->opcode == 19u) comparison = !comparison;
                    } else if (!pc_dynamic_real(left) || !pc_dynamic_real(right)) valid = 0;
                    else {
                        const int order = mpfr_cmp(left->re, right->re);
                        comparison = instruction->opcode == 20u ? order < 0
                            : instruction->opcode == 21u ? order <= 0
                            : instruction->opcode == 22u ? order > 0 : order >= 0;
                    }
                    if (valid) pc_set_d(left, comparison, 0.0);
                } else valid = 0;
                break;
        }
    }
    if (valid && size == 1u && pc_finite(&stack[0])) pc_set(output, &stack[0]);
    else valid = 0;
    for (uint32_t index = 0; index < CE_PRECISE_STACK_LIMIT; ++index) pc_clear(&stack[index]);
    return valid;
}

static int pc_eval_dynamic(ce_precise_complex *output, const ce_map_config *config,
                           const ce_precise_complex *parameter) {
    if (!config->dynamic_point_expression || !config->dynamic_point_count ||
        !config->dynamic_term_expression || !config->dynamic_term_count ||
        !config->dynamic_variables || !config->dynamic_variable_flags ||
        !config->dynamic_variable_count || !config->dynamic_source_count ||
        config->dynamic_variable_count > CE_PRECISE_STACK_LIMIT ||
        config->dynamic_reduction > 2u) return 0;
    const mpfr_prec_t precision = mpfr_get_prec(output->re);
    ce_precise_complex variables[CE_PRECISE_STACK_LIMIT], point, term, accumulator;
    for (uint32_t index = 0; index < CE_PRECISE_STACK_LIMIT; ++index) pc_init(&variables[index], precision);
    pc_init(&point, precision); pc_init(&term, precision); pc_init(&accumulator, precision);
    pc_set_d(&accumulator, config->dynamic_reduction == 2u ? 1.0 : 0.0, 0.0);
    ce_map_config base = *config;
    base.chain_count = 1u; base.zero_seed = 0u; base.chain_seed = (ce_complex){0.0, 0.0}; base.derivative = 0u;
    base.dynamic_point_expression = NULL; base.dynamic_point_count = 0u;
    base.dynamic_term_expression = NULL; base.dynamic_term_count = 0u;
    base.dynamic_source_count = 0u;
    int valid = 1, has_value = 0;
    for (uint32_t source = 0; source < config->dynamic_source_count && valid; ++source) {
        for (uint32_t slot = 0; slot < config->dynamic_variable_count; ++slot) {
            const uint8_t flag = config->dynamic_variable_flags[slot];
            if (flag == 1u) pc_set(&variables[slot], parameter);
            else if (flag == 2u) {
                mpfr_set(variables[slot].re, parameter->re, MPFR_RNDN);
                mpfr_set_zero(variables[slot].im, 0);
            } else pc_set_complex(&variables[slot],
                config->dynamic_variables[(size_t)source * config->dynamic_variable_count + slot]);
        }
        int term_valid = pc_eval_dynamic_expression(
            &point, &base, config->dynamic_point_expression, config->dynamic_point_count,
            variables, config->dynamic_variable_count
        );
        if (term_valid) {
            for (uint32_t slot = 0; slot < config->dynamic_variable_count; ++slot) {
                if (config->dynamic_variable_flags && config->dynamic_variable_flags[slot] == 3u) {
                    pc_set(&variables[slot], &point);
                }
            }
            term_valid = pc_eval_dynamic_expression(
                &term, &base, config->dynamic_term_expression, config->dynamic_term_count,
                variables, config->dynamic_variable_count
            );
        }
        if (!term_valid) {
            if (!config->dynamic_invalid_policy) valid = 0;
            continue;
        }
        has_value = 1;
        if (config->dynamic_reduction == 1u) pc_add(&accumulator, &accumulator, &term);
        else if (config->dynamic_reduction == 2u) pc_mul(&accumulator, &accumulator, &term);
        else pc_set(&accumulator, &term);
    }
    if ((has_value || config->dynamic_reduction != 0u) && pc_finite(&accumulator)) {
        pc_set(output, &accumulator);
        valid = 1;
    } else valid = 0;
    for (uint32_t index = 0; index < CE_PRECISE_STACK_LIMIT; ++index) pc_clear(&variables[index]);
    pc_clear(&point); pc_clear(&term); pc_clear(&accumulator);
    return valid;
}

static mpfr_prec_t ce_precision(uint32_t requested) {
    return (mpfr_prec_t)requested;
}

static int ce_precision_valid(uint32_t requested) {
    return requested >= CE_MIN_PRECISION_BITS && requested <= CE_MAX_PRECISION_BITS;
}

static int ce_set_decimal(mpfr_t value, const char *text) {
    return text && *text && mpfr_set_str(value, text, 10, MPFR_RNDN) == 0;
}

static void ce_pixel_coordinate(mpfr_t output, const mpfr_t center, const mpfr_t span,
                                uint32_t size, double pixel, int inverted,
                                mpfr_t scratch) {
    mpfr_set_d(scratch, pixel + 0.5, MPFR_RNDN);
    mpfr_sub_ui(scratch, scratch, size / 2u, MPFR_RNDN);
    if (size & 1u) mpfr_sub_d(scratch, scratch, 0.5, MPFR_RNDN);
    if (inverted) mpfr_neg(scratch, scratch, MPFR_RNDN);
    mpfr_mul(scratch, scratch, span, MPFR_RNDN);
    mpfr_div_ui(scratch, scratch, size, MPFR_RNDN);
    mpfr_add(output, center, scratch, MPFR_RNDN);
}

typedef struct {
    mpfr_t center_re;
    mpfr_t center_im;
    mpfr_t x_span;
    mpfr_t y_span;
    uint32_t width;
    uint32_t height;
} ce_precise_viewport;

static void pc_viewport_init(ce_precise_viewport *viewport, mpfr_prec_t precision) {
    mpfr_inits2(precision, viewport->center_re, viewport->center_im,
                viewport->x_span, viewport->y_span, (mpfr_ptr)0);
}

static void pc_viewport_clear(ce_precise_viewport *viewport) {
    mpfr_clears(viewport->center_re, viewport->center_im,
                viewport->x_span, viewport->y_span, (mpfr_ptr)0);
}

static int pc_viewport_set(ce_precise_viewport *viewport,
                           const char *center_re, const char *center_im,
                           double zoom_power, uint32_t width, uint32_t height) {
    if (!width || !height || !isfinite(zoom_power) || !ce_set_decimal(viewport->center_re, center_re) ||
        !ce_set_decimal(viewport->center_im, center_im)) return 0;
    viewport->width = width;
    viewport->height = height;
    mpfr_set_d(viewport->x_span, -zoom_power, MPFR_RNDN);
    mpfr_set_ui(viewport->y_span, 10u, MPFR_RNDN);
    mpfr_pow(viewport->x_span, viewport->y_span, viewport->x_span, MPFR_RNDN);
    mpfr_mul_d(viewport->x_span, viewport->x_span, 7.0, MPFR_RNDN);
    mpfr_mul_ui(viewport->y_span, viewport->x_span, height, MPFR_RNDN);
    mpfr_div_ui(viewport->y_span, viewport->y_span, width, MPFR_RNDN);
    return 1;
}

static void pc_project_value(const ce_precise_viewport *viewport,
                             const ce_precise_complex *value,
                             mpfr_t scratch, float output[2]) {
    mpfr_sub(scratch, value->re, viewport->center_re, MPFR_RNDN);
    mpfr_mul_ui(scratch, scratch, viewport->width, MPFR_RNDN);
    mpfr_div(scratch, scratch, viewport->x_span, MPFR_RNDN);
    mpfr_add_d(scratch, scratch, viewport->width * 0.5, MPFR_RNDN);
    output[0] = (float)mpfr_get_d(scratch, MPFR_RNDN);
    mpfr_sub(scratch, viewport->center_im, value->im, MPFR_RNDN);
    mpfr_mul_ui(scratch, scratch, viewport->height, MPFR_RNDN);
    mpfr_div(scratch, scratch, viewport->y_span, MPFR_RNDN);
    mpfr_add_d(scratch, scratch, viewport->height * 0.5, MPFR_RNDN);
    output[1] = (float)mpfr_get_d(scratch, MPFR_RNDN);
}

typedef struct {
    const ce_map_config *config;
    mpfr_prec_t precision;
    ce_precise_viewport viewport;
    ce_precise_complex point;
    ce_precise_complex mapped;
    mpfr_t center_re;
    mpfr_t center_im;
    mpfr_t source_width;
    mpfr_t source_height;
    mpfr_t scratch;
} ce_precision_image_context;

void *ce_precision_image_context_create(const ce_map_config *config,
                                        double source_center_re, double source_center_im,
                                        double source_width, double source_height,
                                        const char *view_center_re, const char *view_center_im,
                                        double zoom_power, uint32_t precision_bits,
                                        uint32_t view_width, uint32_t view_height) {
    if (!config || !ce_precision_valid(precision_bits) || !isfinite(zoom_power) ||
        !(source_width > 0.0) || !(source_height > 0.0)) return NULL;
    ce_precision_image_context *context = malloc(sizeof(*context));
    if (!context) return NULL;
    context->config = config;
    context->precision = ce_precision(precision_bits);
    pc_viewport_init(&context->viewport, context->precision);
    pc_init(&context->point, context->precision); pc_init(&context->mapped, context->precision);
    mpfr_inits2(context->precision, context->center_re, context->center_im,
                context->source_width, context->source_height, context->scratch, (mpfr_ptr)0);
    if (!pc_viewport_set(&context->viewport, view_center_re, view_center_im,
                         zoom_power, view_width, view_height)) {
        ce_precision_image_context_destroy(context);
        return NULL;
    }
    mpfr_set_d(context->center_re, source_center_re, MPFR_RNDN);
    mpfr_set_d(context->center_im, source_center_im, MPFR_RNDN);
    mpfr_set_d(context->source_width, source_width, MPFR_RNDN);
    mpfr_set_d(context->source_height, source_height, MPFR_RNDN);
    return context;
}

int ce_precision_image_sample(void *opaque, double u, double v, double *x, double *y) {
    ce_precision_image_context *context = (ce_precision_image_context *)opaque;
    if (!context || !x || !y || !isfinite(u) || !isfinite(v)) return 0;
    mpfr_set_d(context->scratch, u * 2.0 - 1.0, MPFR_RNDN);
    mpfr_mul(context->point.re, context->scratch, context->source_width, MPFR_RNDN);
    mpfr_div_ui(context->point.re, context->point.re, 2u, MPFR_RNDN);
    mpfr_add(context->point.re, context->point.re, context->center_re, MPFR_RNDN);
    mpfr_set_d(context->scratch, v * 2.0 - 1.0, MPFR_RNDN);
    mpfr_mul(context->point.im, context->scratch, context->source_height, MPFR_RNDN);
    mpfr_div_ui(context->point.im, context->point.im, 2u, MPFR_RNDN);
    mpfr_sub(context->point.im, context->center_im, context->point.im, MPFR_RNDN);
    if (!pc_eval_map_derivative(&context->mapped, context->config, &context->point,
                                context->config->derivative)) return 0;
    mpfr_sub(context->scratch, context->mapped.re, context->viewport.center_re, MPFR_RNDN);
    mpfr_mul_ui(context->scratch, context->scratch, 2u, MPFR_RNDN);
    mpfr_div(context->scratch, context->scratch, context->viewport.x_span, MPFR_RNDN);
    *x = mpfr_get_d(context->scratch, MPFR_RNDN);
    mpfr_sub(context->scratch, context->mapped.im, context->viewport.center_im, MPFR_RNDN);
    mpfr_mul_ui(context->scratch, context->scratch, 2u, MPFR_RNDN);
    mpfr_div(context->scratch, context->scratch, context->viewport.y_span, MPFR_RNDN);
    *y = mpfr_get_d(context->scratch, MPFR_RNDN);
    return isfinite(*x) && isfinite(*y);
}

void ce_precision_image_context_destroy(void *opaque) {
    ce_precision_image_context *context = (ce_precision_image_context *)opaque;
    if (!context) return;
    pc_viewport_clear(&context->viewport);
    pc_clear(&context->point); pc_clear(&context->mapped);
    mpfr_clears(context->center_re, context->center_im,
                context->source_width, context->source_height, context->scratch, (mpfr_ptr)0);
    free(context);
}

int32_t ce_project_precise_pixels(const ce_map_config *config,
                                  const char *input_center_re, const char *input_center_im,
                                  double input_zoom_power, uint32_t precision_bits,
                                  uint32_t input_width, uint32_t input_height,
                                  const float *input_pixels, uint32_t point_count,
                                  uint32_t map_points,
                                  const char *output_center_re, const char *output_center_im,
                                  double output_zoom_power,
                                  uint32_t output_width, uint32_t output_height,
                                  float *output_pixels, uint8_t *valid) {
    if (!input_pixels || !output_pixels || !valid || !ce_precision_valid(precision_bits) ||
        (map_points && !config)) return -1;
    const mpfr_prec_t precision = ce_precision(precision_bits);
    ce_precise_viewport input_viewport, output_viewport;
    pc_viewport_init(&input_viewport, precision); pc_viewport_init(&output_viewport, precision);
    if (!pc_viewport_set(&input_viewport, input_center_re, input_center_im,
                         input_zoom_power, input_width, input_height) ||
        !pc_viewport_set(&output_viewport, output_center_re, output_center_im,
                         output_zoom_power, output_width, output_height)) {
        pc_viewport_clear(&input_viewport); pc_viewport_clear(&output_viewport);
        return -2;
    }
    ce_precise_complex point, mapped;
    pc_init(&point, precision); pc_init(&mapped, precision);
    mpfr_t scratch;
    mpfr_init2(scratch, precision);
    for (uint32_t index = 0; index < point_count; ++index) {
        ce_pixel_coordinate(point.re, input_viewport.center_re, input_viewport.x_span,
                            input_width, input_pixels[index * 2u], 0, scratch);
        ce_pixel_coordinate(point.im, input_viewport.center_im, input_viewport.y_span,
                            input_height, input_pixels[index * 2u + 1u], 1, scratch);
        const int ok = map_points
            ? pc_eval_map_derivative(&mapped, config, &point, config->derivative)
            : (pc_set(&mapped, &point), 1);
        valid[index] = (uint8_t)ok;
        if (ok) pc_project_value(&output_viewport, &mapped, scratch, output_pixels + index * 2u);
        else output_pixels[index * 2u] = output_pixels[index * 2u + 1u] = NAN;
    }
    mpfr_clear(scratch);
    pc_clear(&point); pc_clear(&mapped);
    pc_viewport_clear(&input_viewport); pc_viewport_clear(&output_viewport);
    return 0;
}

int32_t ce_project_precise_pixels_to_canvas(const ce_map_config *config,
                                            const char *input_center_re,
                                            const char *input_center_im,
                                            double input_zoom_power,
                                            uint32_t precision_bits,
                                            uint32_t input_width, uint32_t input_height,
                                            const float *input_pixels, uint32_t point_count,
                                            uint32_t map_points,
                                            double output_origin_x, double output_origin_y,
                                            double output_scale_x, double output_scale_y,
                                            float *output_pixels, uint8_t *valid) {
    if (!input_pixels || !output_pixels || !valid || !ce_precision_valid(precision_bits) ||
        (map_points && !config) ||
        !isfinite(output_origin_x) || !isfinite(output_origin_y) ||
        !isfinite(output_scale_x) || !isfinite(output_scale_y)) return -1;
    const mpfr_prec_t precision = ce_precision(precision_bits);
    ce_precise_viewport input_viewport;
    pc_viewport_init(&input_viewport, precision);
    if (!pc_viewport_set(&input_viewport, input_center_re, input_center_im,
                         input_zoom_power, input_width, input_height)) {
        pc_viewport_clear(&input_viewport);
        return -2;
    }
    ce_precise_complex point, mapped;
    pc_init(&point, precision); pc_init(&mapped, precision);
    mpfr_t scratch;
    mpfr_init2(scratch, precision);
    for (uint32_t index = 0; index < point_count; ++index) {
        ce_pixel_coordinate(point.re, input_viewport.center_re, input_viewport.x_span,
                            input_width, input_pixels[index * 2u], 0, scratch);
        ce_pixel_coordinate(point.im, input_viewport.center_im, input_viewport.y_span,
                            input_height, input_pixels[index * 2u + 1u], 1, scratch);
        const int ok = map_points
            ? pc_eval_map_derivative(&mapped, config, &point, config->derivative)
            : (pc_set(&mapped, &point), 1);
        valid[index] = (uint8_t)ok;
        if (ok) {
            output_pixels[index * 2u] = (float)(output_origin_x +
                mpfr_get_d(mapped.re, MPFR_RNDN) * output_scale_x);
            output_pixels[index * 2u + 1u] = (float)(output_origin_y -
                mpfr_get_d(mapped.im, MPFR_RNDN) * output_scale_y);
        } else output_pixels[index * 2u] = output_pixels[index * 2u + 1u] = NAN;
    }
    mpfr_clear(scratch);
    pc_clear(&point); pc_clear(&mapped);
    pc_viewport_clear(&input_viewport);
    return 0;
}

int32_t ce_project_values_to_precise(const ce_map_config *config,
                                     const ce_complex *source_points, uint32_t point_count,
                                     uint32_t map_points,
                                     const char *output_center_re, const char *output_center_im,
                                     double output_zoom_power, uint32_t precision_bits,
                                     uint32_t output_width, uint32_t output_height,
                                     float *output_pixels, uint8_t *valid) {
    if (!source_points || !output_pixels || !valid || !ce_precision_valid(precision_bits) ||
        (map_points && !config)) return -1;
    const mpfr_prec_t precision = ce_precision(precision_bits);
    ce_precise_viewport output_viewport;
    pc_viewport_init(&output_viewport, precision);
    if (!pc_viewport_set(&output_viewport, output_center_re, output_center_im,
                         output_zoom_power, output_width, output_height)) {
        pc_viewport_clear(&output_viewport);
        return -2;
    }
    ce_precise_complex point, mapped;
    pc_init(&point, precision); pc_init(&mapped, precision);
    mpfr_t scratch;
    mpfr_init2(scratch, precision);
    for (uint32_t index = 0; index < point_count; ++index) {
        pc_set_complex(&point, source_points[index]);
        const int finite_source = isfinite(source_points[index].re) && isfinite(source_points[index].im);
        const int ok = finite_source && (map_points
            ? pc_eval_map_derivative(&mapped, config, &point, config->derivative)
            : (pc_set(&mapped, &point), 1));
        valid[index] = (uint8_t)ok;
        if (ok) pc_project_value(&output_viewport, &mapped, scratch, output_pixels + index * 2u);
        else output_pixels[index * 2u] = output_pixels[index * 2u + 1u] = NAN;
    }
    mpfr_clear(scratch);
    pc_clear(&point); pc_clear(&mapped);
    pc_viewport_clear(&output_viewport);
    return 0;
}
