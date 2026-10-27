#include "domain_delta_internal.h"

#include <math.h>
#include <stdint.h>

#define CE_DELTA_PI 3.141592653589793238462643383279502884
#define CE_DELTA_TWO_PI (2.0 * CE_DELTA_PI)
#define CE_DELTA_E 2.718281828459045235360287471352662498
#define CE_DELTA_STACK_LIMIT 128u

enum ce_delta_expression_opcode {
    CE_DELTA_EXPR_CONST = 0,
    CE_DELTA_EXPR_Z,
    CE_DELTA_EXPR_C,
    CE_DELTA_EXPR_ADD,
    CE_DELTA_EXPR_SUB,
    CE_DELTA_EXPR_MUL,
    CE_DELTA_EXPR_DIV,
    CE_DELTA_EXPR_POW,
    CE_DELTA_EXPR_NEGATE,
    CE_DELTA_EXPR_CALL,
    CE_DELTA_EXPR_CONJUGATE,
    CE_DELTA_EXPR_ABS,
    CE_DELTA_EXPR_ARG,
    CE_DELTA_EXPR_REAL,
    CE_DELTA_EXPR_IMAGINARY,
    CE_DELTA_EXPR_SQRT = 41
};

static ce_complex dx(double re, double im) {
    const ce_complex value = {re, im};
    return value;
}

static int dx_finite(ce_complex value) {
    return isfinite(value.re) && isfinite(value.im);
}

static int dx_zero(ce_complex value) {
    return value.re == 0.0 && value.im == 0.0;
}

static ce_complex dx_add(ce_complex a, ce_complex b) {
    return dx(a.re + b.re, a.im + b.im);
}

static ce_complex dx_sub(ce_complex a, ce_complex b) {
    return dx(a.re - b.re, a.im - b.im);
}

static ce_complex dx_neg(ce_complex value) {
    return dx(-value.re, -value.im);
}

static ce_complex dx_mul(ce_complex a, ce_complex b) {
    return dx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}

static ce_complex dx_div(ce_complex numerator, ce_complex denominator) {
    return ce_div(numerator, denominator);
}

static double dx_log_abs(ce_complex value) {
    const double scale = fmax(fabs(value.re), fabs(value.im));
    if (scale == 0.0) return -INFINITY;
    const double re = value.re / scale;
    const double im = value.im / scale;
    return log(scale) + 0.5 * log(re * re + im * im);
}

static ce_delta_pair dp_constant(ce_complex value) {
    const ce_delta_pair result = {value, {0.0, 0.0}};
    return result;
}

static ce_complex dp_actual(ce_delta_pair value) {
    return dx_add(value.anchor, value.offset);
}

static double dx_two_sum(double a, double b, double *error) {
    const double sum = a + b;
    const double recovered = sum - a;
    *error = (a - (sum - recovered)) + (b - recovered);
    return sum;
}

static ce_delta_pair dp_normalize(ce_delta_pair value) {
    ce_delta_pair result;
    result.anchor.re = dx_two_sum(value.anchor.re, value.offset.re, &result.offset.re);
    result.anchor.im = dx_two_sum(value.anchor.im, value.offset.im, &result.offset.im);
    return result;
}

static ce_delta_pair dp_add(ce_delta_pair a, ce_delta_pair b) {
    const ce_delta_pair result = {dx_add(a.anchor, b.anchor), dx_add(a.offset, b.offset)};
    return result;
}

static ce_delta_pair dp_neg(ce_delta_pair value) {
    const ce_delta_pair result = {dx_neg(value.anchor), dx_neg(value.offset)};
    return result;
}

static ce_delta_pair dp_mul(ce_delta_pair a, ce_delta_pair b) {
    const ce_delta_pair result = {
        dx_mul(a.anchor, b.anchor),
        dx_add(dx_add(dx_mul(a.anchor, b.offset), dx_mul(a.offset, b.anchor)),
               dx_mul(a.offset, b.offset))
    };
    return result;
}

static int dp_divide(ce_delta_pair numerator, ce_delta_pair denominator,
                     ce_delta_pair *result) {
    const ce_complex actual_denominator = dp_actual(denominator);
    if (dx_zero(denominator.anchor) || dx_zero(actual_denominator)) return 0;
    result->anchor = dx_div(numerator.anchor, denominator.anchor);
    const ce_complex correction = dx_sub(
        dx_mul(numerator.offset, denominator.anchor),
        dx_mul(numerator.anchor, denominator.offset)
    );
    result->offset = dx_div(
        correction,
        dx_mul(denominator.anchor, actual_denominator)
    );
    return dx_finite(result->anchor) && dx_finite(result->offset);
}

static ce_complex dx_exp(ce_complex value) {
    const double magnitude = exp(value.re);
    return dx(magnitude * cos(value.im), magnitude * sin(value.im));
}

static void dx_sincos(ce_complex value, ce_complex *sine, ce_complex *cosine) {
    const double sin_re = sin(value.re);
    const double cos_re = cos(value.re);
    const double exp_im = exp(value.im);
    const double inverse_exp_im = 1.0 / exp_im;
    const double sinh_im = 0.5 * (exp_im - inverse_exp_im);
    const double cosh_im = 0.5 * (exp_im + inverse_exp_im);
    *sine = dx(sin_re * cosh_im, cos_re * sinh_im);
    *cosine = dx(cos_re * cosh_im, -sin_re * sinh_im);
}

static void dx_sinhcosh(ce_complex value, ce_complex *sine, ce_complex *cosine) {
    const double exp_re = exp(value.re);
    const double inverse_exp_re = 1.0 / exp_re;
    const double sinh_re = 0.5 * (exp_re - inverse_exp_re);
    const double cosh_re = 0.5 * (exp_re + inverse_exp_re);
    const double sin_im = sin(value.im);
    const double cos_im = cos(value.im);
    *sine = dx(sinh_re * cos_im, cosh_re * sin_im);
    *cosine = dx(cosh_re * cos_im, sinh_re * sin_im);
}

static ce_complex dx_expm1(ce_complex value) {
    const double exp_re = exp(value.re);
    return dx(expm1(value.re) * cos(value.im) + cos(value.im) - 1.0,
              exp_re * sin(value.im));
}

static ce_delta_pair dp_exp(ce_delta_pair value) {
    const ce_complex anchor = dx_exp(value.anchor);
    const ce_delta_pair result = {anchor, dx_mul(anchor, dx_expm1(value.offset))};
    return result;
}

static void dp_sincos(ce_delta_pair value, ce_delta_pair *sine, ce_delta_pair *cosine) {
    ce_complex sin_anchor, cos_anchor, sin_delta, cos_delta;
    dx_sincos(value.anchor, &sin_anchor, &cos_anchor);
    dx_sincos(value.offset, &sin_delta, &cos_delta);
    const ce_complex cos_delta_minus_one = dx_sub(cos_delta, dx(1.0, 0.0));
    *sine = (ce_delta_pair){
        sin_anchor,
        dx_add(dx_mul(sin_anchor, cos_delta_minus_one), dx_mul(cos_anchor, sin_delta))
    };
    *cosine = (ce_delta_pair){
        cos_anchor,
        dx_sub(dx_mul(cos_anchor, cos_delta_minus_one), dx_mul(sin_anchor, sin_delta))
    };
}

static void dp_sinhcosh(ce_delta_pair value, ce_delta_pair *sine, ce_delta_pair *cosine) {
    ce_complex sinh_anchor, cosh_anchor, sinh_delta, cosh_delta;
    dx_sinhcosh(value.anchor, &sinh_anchor, &cosh_anchor);
    dx_sinhcosh(value.offset, &sinh_delta, &cosh_delta);
    const ce_complex cosh_delta_minus_one = dx_sub(cosh_delta, dx(1.0, 0.0));
    *sine = (ce_delta_pair){
        sinh_anchor,
        dx_add(dx_mul(sinh_anchor, cosh_delta_minus_one), dx_mul(cosh_anchor, sinh_delta))
    };
    *cosine = (ce_delta_pair){
        cosh_anchor,
        dx_add(dx_mul(cosh_anchor, cosh_delta_minus_one), dx_mul(sinh_anchor, sinh_delta))
    };
}

static ce_delta_pair dp_log(ce_delta_pair value) {
    ce_delta_pair result = {{NAN, NAN}, {NAN, NAN}};
    if (dx_zero(value.anchor)) return result;
    const ce_complex ratio = dx_div(value.offset, value.anchor);
    const double norm_change = 2.0 * ratio.re + ratio.re * ratio.re + ratio.im * ratio.im;
    const double local_phase = atan2(ratio.im, 1.0 + ratio.re);
    const double anchor_phase = atan2(value.anchor.im, value.anchor.re);
    double actual_phase = anchor_phase + local_phase;
    while (actual_phase > CE_DELTA_PI) actual_phase -= CE_DELTA_TWO_PI;
    while (actual_phase <= -CE_DELTA_PI) actual_phase += CE_DELTA_TWO_PI;
    result.anchor = dx(dx_log_abs(value.anchor), anchor_phase);
    result.offset = dx(0.5 * log1p(norm_change), actual_phase - anchor_phase);
    return result;
}

static ce_sphere_delta dv_invalid(void) {
    const ce_sphere_delta value = {{{NAN, NAN}, {NAN, NAN}}, {{NAN, NAN}, {NAN, NAN}}, 0};
    return value;
}

ce_sphere_delta ce_delta_affine(ce_complex anchor, ce_complex offset) {
    const ce_sphere_delta value = {
        dp_normalize((ce_delta_pair){anchor, offset}),
        {{1.0, 0.0}, {0.0, 0.0}},
        1
    };
    return value;
}

static ce_sphere_delta dv_constant(ce_complex value) {
    return ce_delta_affine(value, dx(0.0, 0.0));
}

static ce_sphere_delta dv_ratio(ce_delta_pair numerator, ce_delta_pair denominator) {
    ce_sphere_delta value = {numerator, denominator, 1};
    ce_delta_pair affine;
    if (dp_divide(numerator, denominator, &affine)) {
        value.numerator = affine;
        value.denominator = dp_constant(dx(1.0, 0.0));
    }
    return value;
}

static int dv_affine_value(ce_sphere_delta value) {
    return value.denominator.anchor.re == 1.0 && value.denominator.anchor.im == 0.0 &&
        value.denominator.offset.re == 0.0 && value.denominator.offset.im == 0.0;
}

static int dv_pair(ce_sphere_delta value, ce_delta_pair *pair) {
    if (!value.valid) return 0;
    if (dv_affine_value(value)) {
        *pair = value.numerator;
        return dx_finite(pair->anchor) && dx_finite(pair->offset);
    }
    return dp_divide(value.numerator, value.denominator, pair);
}

static ce_sphere_delta dv_from_pair(ce_delta_pair value);

static ce_sphere_delta dv_neg(ce_sphere_delta value) {
    if (!value.valid) return value;
    value.numerator = dp_neg(value.numerator);
    return value;
}

static ce_sphere_delta dv_add(ce_sphere_delta a, ce_sphere_delta b) {
    if (!a.valid || !b.valid) return dv_invalid();
    if (dv_affine_value(a) && dv_affine_value(b)) {
        return dv_from_pair(dp_add(a.numerator, b.numerator));
    }
    return dv_ratio(
        dp_add(dp_mul(a.numerator, b.denominator), dp_mul(b.numerator, a.denominator)),
        dp_mul(a.denominator, b.denominator)
    );
}

static ce_sphere_delta dv_sub(ce_sphere_delta a, ce_sphere_delta b) {
    return dv_add(a, dv_neg(b));
}

static ce_sphere_delta dv_mul(ce_sphere_delta a, ce_sphere_delta b) {
    if (!a.valid || !b.valid) return dv_invalid();
    if (dv_affine_value(a) && dv_affine_value(b)) {
        return dv_from_pair(dp_mul(a.numerator, b.numerator));
    }
    return dv_ratio(dp_mul(a.numerator, b.numerator), dp_mul(a.denominator, b.denominator));
}

static ce_sphere_delta dv_div(ce_sphere_delta numerator, ce_sphere_delta denominator) {
    if (!numerator.valid || !denominator.valid) return dv_invalid();
    return dv_ratio(dp_mul(numerator.numerator, denominator.denominator),
                    dp_mul(numerator.denominator, denominator.numerator));
}

static ce_sphere_delta dv_from_pair(ce_delta_pair value) {
    const ce_sphere_delta result = {value, {{1.0, 0.0}, {0.0, 0.0}},
                                    dx_finite(value.anchor) && dx_finite(value.offset)};
    return result;
}

static ce_sphere_delta dv_exp(ce_sphere_delta value) {
    ce_delta_pair affine;
    return dv_pair(value, &affine) ? dv_from_pair(dp_exp(affine)) : dv_invalid();
}

static ce_sphere_delta dv_log(ce_sphere_delta value) {
    ce_delta_pair affine;
    if (!dv_pair(value, &affine)) return dv_invalid();
    const ce_delta_pair result = dp_log(affine);
    return dx_finite(result.anchor) && dx_finite(result.offset) ? dv_from_pair(result) : dv_invalid();
}

static int dv_sincos(ce_sphere_delta value,
                     ce_sphere_delta *sine, ce_sphere_delta *cosine) {
    ce_delta_pair affine;
    if (!dv_pair(value, &affine)) {
        *sine = *cosine = dv_invalid();
        return 0;
    }
    ce_delta_pair direct_sine, direct_cosine;
    dp_sincos(affine, &direct_sine, &direct_cosine);
    if (dx_finite(direct_sine.anchor) && dx_finite(direct_sine.offset) &&
        dx_finite(direct_cosine.anchor) && dx_finite(direct_cosine.offset)) {
        *sine = dv_from_pair(direct_sine);
        *cosine = dv_from_pair(direct_cosine);
        return 1;
    }
    const ce_complex actual = dp_actual(affine);
    const double anchor_q = exp(-2.0 * fabs(affine.anchor.im));
    const double actual_q = exp(-2.0 * fabs(actual.im));
    const double anchor_sin = sin(affine.anchor.re);
    const double anchor_cos = cos(affine.anchor.re);
    const double actual_sin = sin(actual.re);
    const double actual_cos = cos(actual.re);
    const ce_complex anchor_numerator = dx(
        0.5 * anchor_sin * (1.0 + anchor_q),
        0.5 * copysign(1.0, affine.anchor.im) * anchor_cos * (1.0 - anchor_q)
    );
    const ce_complex actual_numerator = dx(
        0.5 * actual_sin * (1.0 + actual_q),
        0.5 * copysign(1.0, actual.im) * actual_cos * (1.0 - actual_q)
    );
    const ce_complex anchor_cosine_numerator = dx(
        0.5 * anchor_cos * (1.0 + anchor_q),
        -0.5 * copysign(1.0, affine.anchor.im) * anchor_sin * (1.0 - anchor_q)
    );
    const ce_complex actual_cosine_numerator = dx(
        0.5 * actual_cos * (1.0 + actual_q),
        -0.5 * copysign(1.0, actual.im) * actual_sin * (1.0 - actual_q)
    );
    const ce_delta_pair denominator = {
        dx(exp(-fabs(affine.anchor.im)), 0.0),
        dx(exp(-fabs(actual.im)) - exp(-fabs(affine.anchor.im)), 0.0)
    };
    *sine = dv_ratio(
        (ce_delta_pair){anchor_numerator, dx_sub(actual_numerator, anchor_numerator)},
        denominator
    );
    *cosine = dv_ratio(
        (ce_delta_pair){anchor_cosine_numerator,
                        dx_sub(actual_cosine_numerator, anchor_cosine_numerator)},
        denominator
    );
    return 1;
}

static ce_sphere_delta dv_sin(ce_sphere_delta value) {
    ce_sphere_delta sine, cosine;
    return dv_sincos(value, &sine, &cosine) ? sine : dv_invalid();
}

static ce_sphere_delta dv_cos(ce_sphere_delta value) {
    ce_sphere_delta sine, cosine;
    return dv_sincos(value, &sine, &cosine) ? cosine : dv_invalid();
}

static int dv_sinhcosh(ce_sphere_delta value,
                       ce_sphere_delta *sine, ce_sphere_delta *cosine) {
    ce_delta_pair affine;
    if (!dv_pair(value, &affine)) {
        *sine = *cosine = dv_invalid();
        return 0;
    }
    ce_delta_pair direct_sine, direct_cosine;
    dp_sinhcosh(affine, &direct_sine, &direct_cosine);
    if (dx_finite(direct_sine.anchor) && dx_finite(direct_sine.offset) &&
        dx_finite(direct_cosine.anchor) && dx_finite(direct_cosine.offset)) {
        *sine = dv_from_pair(direct_sine);
        *cosine = dv_from_pair(direct_cosine);
        return 1;
    }
    const ce_complex actual = dp_actual(affine);
    const double anchor_q = exp(-2.0 * fabs(affine.anchor.re));
    const double actual_q = exp(-2.0 * fabs(actual.re));
    const double anchor_sin = sin(affine.anchor.im);
    const double anchor_cos = cos(affine.anchor.im);
    const double actual_sin = sin(actual.im);
    const double actual_cos = cos(actual.im);
    const ce_complex anchor_numerator = dx(
        0.5 * copysign(1.0, affine.anchor.re) * (1.0 - anchor_q) * anchor_cos,
        0.5 * (1.0 + anchor_q) * anchor_sin
    );
    const ce_complex actual_numerator = dx(
        0.5 * copysign(1.0, actual.re) * (1.0 - actual_q) * actual_cos,
        0.5 * (1.0 + actual_q) * actual_sin
    );
    const ce_complex anchor_cosine_numerator = dx(
        0.5 * (1.0 + anchor_q) * anchor_cos,
        0.5 * copysign(1.0, affine.anchor.re) * (1.0 - anchor_q) * anchor_sin
    );
    const ce_complex actual_cosine_numerator = dx(
        0.5 * (1.0 + actual_q) * actual_cos,
        0.5 * copysign(1.0, actual.re) * (1.0 - actual_q) * actual_sin
    );
    const ce_delta_pair denominator = {
        dx(exp(-fabs(affine.anchor.re)), 0.0),
        dx(exp(-fabs(actual.re)) - exp(-fabs(affine.anchor.re)), 0.0)
    };
    *sine = dv_ratio(
        (ce_delta_pair){anchor_numerator, dx_sub(actual_numerator, anchor_numerator)},
        denominator
    );
    *cosine = dv_ratio(
        (ce_delta_pair){anchor_cosine_numerator,
                        dx_sub(actual_cosine_numerator, anchor_cosine_numerator)},
        denominator
    );
    return 1;
}

static ce_sphere_delta dv_sinh(ce_sphere_delta value) {
    ce_sphere_delta sine, cosine;
    return dv_sinhcosh(value, &sine, &cosine) ? sine : dv_invalid();
}

static ce_sphere_delta dv_tan(ce_sphere_delta value) {
    ce_sphere_delta sine, cosine;
    return dv_sincos(value, &sine, &cosine) ? dv_div(sine, cosine) : dv_invalid();
}

static ce_sphere_delta dv_tanh(ce_sphere_delta value) {
    ce_sphere_delta sine, cosine;
    return dv_sinhcosh(value, &sine, &cosine) ? dv_div(sine, cosine) : dv_invalid();
}

static int dx_natural_base(ce_complex base) {
    return base.re == CE_DELTA_E && base.im == 0.0;
}

static ce_sphere_delta dv_constant_log(ce_complex value) {
    if (dx_zero(value)) return dv_invalid();
    return dv_constant(dx(dx_log_abs(value), atan2(value.im, value.re)));
}

static ce_sphere_delta dv_exp_at_base(ce_sphere_delta value, ce_complex base) {
    if (dx_natural_base(base)) return dv_exp(value);
    return dv_exp(dv_mul(value, dv_constant_log(base)));
}

static ce_sphere_delta dv_log_at_base(ce_sphere_delta value, ce_complex base) {
    if (dx_natural_base(base)) return dv_log(value);
    return dv_div(dv_log(value), dv_constant_log(base));
}

static ce_sphere_delta dv_pow(ce_sphere_delta base, ce_sphere_delta exponent) {
    ce_delta_pair exponent_pair;
    if (!dv_pair(exponent, &exponent_pair)) return dv_invalid();
    const ce_complex actual_exponent = dp_actual(exponent_pair);
    if (exponent_pair.anchor.im == 0.0 && exponent_pair.offset.re == 0.0 &&
        exponent_pair.offset.im == 0.0 && floor(exponent_pair.anchor.re) == exponent_pair.anchor.re &&
        fabs(exponent_pair.anchor.re) <= 2147483647.0) {
        int64_t power = (int64_t)exponent_pair.anchor.re;
        ce_sphere_delta result = dv_constant(dx(1.0, 0.0));
        ce_sphere_delta factor = base;
        uint64_t remaining = power < 0 ? (uint64_t)(-power) : (uint64_t)power;
        while (remaining) {
            if (remaining & 1u) result = dv_mul(result, factor);
            remaining >>= 1u;
            if (remaining) factor = dv_mul(factor, factor);
        }
        return power < 0 ? dv_div(dv_constant(dx(1.0, 0.0)), result) : result;
    }
    if (!dx_finite(actual_exponent)) return dv_invalid();
    if (dv_affine_value(base) && base.numerator.anchor.re > 0.0 &&
        base.numerator.anchor.im == 0.0 && dx_zero(base.numerator.offset)) {
        return dv_exp(dv_mul(
            exponent,
            dv_constant(dx(log(base.numerator.anchor.re), 0.0))
        ));
    }
    return dv_exp(dv_mul(exponent, dv_log(base)));
}

static ce_sphere_delta dv_gamma(ce_sphere_delta z) {
    static const double coefficients[] = {
        0.99999999999980993, 676.5203681218851, -1259.1392167224028,
        771.32342877765313, -176.61502916214059, 12.507343278686905,
        -0.13857109526572012, 0.0000099843695780195716, 0.00000015056327351493116
    };
    ce_complex actual;
    if (!ce_delta_actual(&z, &actual)) return dv_invalid();
    if (actual.re < 0.5) {
        const ce_sphere_delta one_minus_z = dv_sub(dv_constant(dx(1.0, 0.0)), z);
        const ce_sphere_delta sine = dv_sin(dv_mul(dv_constant(dx(CE_DELTA_PI, 0.0)), z));
        return dv_div(dv_constant(dx(CE_DELTA_PI, 0.0)), dv_mul(sine, dv_gamma(one_minus_z)));
    }
    const ce_sphere_delta zm = dv_sub(z, dv_constant(dx(1.0, 0.0)));
    ce_sphere_delta sum = dv_constant(dx(coefficients[0], 0.0));
    for (uint32_t index = 1; index < 9u; ++index) {
        sum = dv_add(sum, dv_div(
            dv_constant(dx(coefficients[index], 0.0)),
            dv_add(zm, dv_constant(dx((double)index, 0.0)))
        ));
    }
    const ce_sphere_delta t = dv_add(z, dv_constant(dx(6.5, 0.0)));
    const ce_sphere_delta powered = dv_pow(t, dv_sub(z, dv_constant(dx(0.5, 0.0))));
    return dv_mul(dv_constant(dx(2.5066282746310005024, 0.0)),
                  dv_mul(powered, dv_mul(dv_exp(dv_neg(t)), sum)));
}

static ce_sphere_delta dv_bessel(ce_sphere_delta z, ce_complex order) {
    if (order.im == 0.0 && floor(order.re) == order.re && order.re < 0.0) {
        const double sign = fmod(fabs(order.re), 2.0) ? -1.0 : 1.0;
        return dv_mul(dv_constant(dx(sign, 0.0)), dv_bessel(z, dx(-order.re, 0.0)));
    }
    const ce_sphere_delta half = dv_mul(z, dv_constant(dx(0.5, 0.0)));
    const ce_sphere_delta order_value = dv_constant(order);
    const ce_sphere_delta gamma = dv_gamma(dv_constant(dx(order.re + 1.0, order.im)));
    ce_sphere_delta term = dv_div(dv_exp(dv_mul(order_value, dv_log(half))), gamma);
    ce_sphere_delta sum = term;
    const ce_sphere_delta step = dv_mul(dv_mul(z, z), dv_constant(dx(-0.25, 0.0)));
    for (uint32_t k = 0; k < 160u; ++k) {
        const ce_complex denominator = dx((k + 1.0) * (k + 1.0 + order.re),
                                          (k + 1.0) * order.im);
        term = dv_div(dv_mul(term, step), dv_constant(denominator));
        sum = dv_add(sum, term);
        ce_complex actual_term, actual_sum;
        if (!ce_delta_actual(&term, &actual_term) || !ce_delta_actual(&sum, &actual_sum)) break;
        if (hypot(actual_term.re, actual_term.im) <=
            1e-14 * fmax(1.0, hypot(actual_sum.re, actual_sum.im))) break;
    }
    return sum;
}

static ce_sphere_delta dv_zeta(ce_sphere_delta z, const ce_function_config *config) {
    ce_complex actual;
    if (!ce_delta_actual(&z, &actual)) return dv_invalid();
    const ce_sphere_delta minus_z = dv_neg(z);
    ce_sphere_delta sum = dv_constant(dx(0.0, 0.0));
    if (!config->zeta_continuation) {
        if (actual.re <= 1.0) return dv_invalid();
        for (uint32_t n = 1; n <= 100u; ++n) {
            sum = dv_add(sum, dv_pow(dv_constant(dx((double)n, 0.0)), minus_z));
        }
        return sum;
    }
    const uint32_t levels = 32u;
    const double tail_scale = ldexp(1.0, -(int)levels);
    double binomial = 1.0;
    double cumulative = 0.0;
    for (uint32_t k = 0; k < levels; ++k) {
        if (k) binomial = binomial * (levels - k + 1.0) / k;
        cumulative += binomial;
        const double weight = (k & 1u ? -1.0 : 1.0) *
            (1.0 - tail_scale * cumulative);
        const ce_sphere_delta powered = dv_pow(
            dv_constant(dx((double)k + 1.0, 0.0)), minus_z
        );
        sum = dv_add(sum, dv_mul(powered, dv_constant(dx(weight, 0.0))));
    }
    const ce_sphere_delta denominator = dv_sub(
        dv_constant(dx(1.0, 0.0)),
        dv_pow(dv_constant(dx(2.0, 0.0)), dv_sub(dv_constant(dx(1.0, 0.0)), z))
    );
    return dv_div(sum, denominator);
}

static ce_sphere_delta dv_function(uint32_t function_id, ce_sphere_delta z,
                                   ce_sphere_delta c, const ce_function_config *config);

static ce_sphere_delta dv_expression(ce_sphere_delta z, ce_sphere_delta c,
                                     const ce_function_config *config) {
    if (!config->expression || !config->expression_count) return z;
    if (config->expression_count > CE_DELTA_STACK_LIMIT) return dv_invalid();
    ce_sphere_delta stack[CE_DELTA_STACK_LIMIT];
    uint32_t size = 0;
    for (uint32_t index = 0; index < config->expression_count; ++index) {
        const ce_expression_instruction *instruction = &config->expression[index];
        ce_sphere_delta right;
        switch (instruction->opcode) {
            case CE_DELTA_EXPR_CONST: stack[size++] = dv_constant(instruction->value); break;
            case CE_DELTA_EXPR_Z: stack[size++] = z; break;
            case CE_DELTA_EXPR_C: stack[size++] = c; break;
            case CE_DELTA_EXPR_NEGATE:
                if (!size) return dv_invalid();
                stack[size - 1u] = dv_neg(stack[size - 1u]);
                break;
            case CE_DELTA_EXPR_CALL:
                if (!size || instruction->argument == CE_FN_ALGEBRAIC) return dv_invalid();
                stack[size - 1u] = dv_function(instruction->argument, stack[size - 1u], c, config);
                break;
            case CE_DELTA_EXPR_CONJUGATE: {
                if (!size) return dv_invalid();
                ce_delta_pair pair;
                if (!dv_pair(stack[size - 1u], &pair)) return dv_invalid();
                pair.anchor.im = -pair.anchor.im;
                pair.offset.im = -pair.offset.im;
                stack[size - 1u] = dv_from_pair(pair);
                break;
            }
            case CE_DELTA_EXPR_REAL:
            case CE_DELTA_EXPR_IMAGINARY:
            case CE_DELTA_EXPR_ABS:
            case CE_DELTA_EXPR_ARG: {
                if (!size) return dv_invalid();
                ce_delta_pair pair;
                if (!dv_pair(stack[size - 1u], &pair)) return dv_invalid();
                const ce_complex actual_value = dp_actual(pair);
                double anchor_value;
                double actual_result;
                if (instruction->opcode == CE_DELTA_EXPR_REAL) {
                    anchor_value = pair.anchor.re; actual_result = actual_value.re;
                } else if (instruction->opcode == CE_DELTA_EXPR_IMAGINARY) {
                    anchor_value = pair.anchor.im; actual_result = actual_value.im;
                } else if (instruction->opcode == CE_DELTA_EXPR_ABS) {
                    anchor_value = hypot(pair.anchor.re, pair.anchor.im);
                    actual_result = hypot(actual_value.re, actual_value.im);
                } else {
                    anchor_value = atan2(pair.anchor.im, pair.anchor.re);
                    actual_result = atan2(actual_value.im, actual_value.re);
                }
                stack[size - 1u] = ce_delta_affine(dx(anchor_value, 0.0),
                                                   dx(actual_result - anchor_value, 0.0));
                break;
            }
            case CE_DELTA_EXPR_SQRT:
                if (!size) return dv_invalid();
                stack[size - 1u] = dv_pow(stack[size - 1u], dv_constant(dx(0.5, 0.0)));
                break;
            default:
                if (size < 2u) return dv_invalid();
                right = stack[--size];
                if (instruction->opcode == CE_DELTA_EXPR_ADD) stack[size - 1u] = dv_add(stack[size - 1u], right);
                else if (instruction->opcode == CE_DELTA_EXPR_SUB) stack[size - 1u] = dv_sub(stack[size - 1u], right);
                else if (instruction->opcode == CE_DELTA_EXPR_MUL) stack[size - 1u] = dv_mul(stack[size - 1u], right);
                else if (instruction->opcode == CE_DELTA_EXPR_DIV) stack[size - 1u] = dv_div(stack[size - 1u], right);
                else if (instruction->opcode == CE_DELTA_EXPR_POW) stack[size - 1u] = dv_pow(stack[size - 1u], right);
                else return dv_invalid();
                break;
        }
        if (size > CE_DELTA_STACK_LIMIT || !stack[size - 1u].valid) return dv_invalid();
    }
    return size == 1u ? stack[0] : dv_invalid();
}

static ce_sphere_delta dv_algebraic(ce_sphere_delta input, ce_sphere_delta c,
                                    const ce_function_config *config) {
    if (!config->algebraic_terms || !config->algebraic_term_count ||
        (config->algebraic_factor_count && !config->algebraic_factors)) return dv_invalid();
    const ce_sphere_delta z = dv_expression(input, c, config);
    ce_sphere_delta sum = dv_constant(dx(0.0, 0.0));
    for (uint32_t term_index = 0; term_index < config->algebraic_term_count; ++term_index) {
        const ce_algebraic_term *term = &config->algebraic_terms[term_index];
        if (term->factor_offset > config->algebraic_factor_count ||
            term->factor_count > config->algebraic_factor_count - term->factor_offset) return dv_invalid();
        ce_sphere_delta value = dv_constant(term->coefficient);
        for (uint32_t factor_index = 0; factor_index < term->factor_count; ++factor_index) {
            const ce_algebraic_factor *factor = &config->algebraic_factors[term->factor_offset + factor_index];
            ce_sphere_delta argument = z;
            if (factor->chained_function_id >= 0) {
                argument = dv_function((uint32_t)factor->chained_function_id, argument, c, config);
            }
            ce_sphere_delta factor_value = dv_function(factor->function_id, argument, c, config);
            if (factor->power != 1.0) {
                factor_value = dv_pow(factor_value, dv_constant(dx(factor->power, 0.0)));
            }
            if (factor->flags & 1u) factor_value = dv_div(dv_constant(dx(1.0, 0.0)), factor_value);
            if (factor->flags & 2u) {
                factor_value = dv_log_at_base(factor_value, config->log_base);
            }
            if (factor->flags & 4u) {
                factor_value = dv_exp_at_base(factor_value, config->exp_base);
            }
            value = dv_mul(value, factor_value);
        }
        sum = dv_add(sum, value);
    }
    return sum;
}

static ce_sphere_delta dv_function(uint32_t function_id, ce_sphere_delta z,
                                   ce_sphere_delta c, const ce_function_config *config) {
    switch (function_id) {
        case CE_FN_C: return c;
        case CE_FN_COS: return dv_cos(z);
        case CE_FN_SIN: return dv_sin(z);
        case CE_FN_TAN: return dv_tan(z);
        case CE_FN_SEC: return dv_div(dv_constant(dx(1.0, 0.0)), dv_cos(z));
        case CE_FN_EXP: return dv_exp_at_base(z, config->exp_base);
        case CE_FN_LN: return dv_log_at_base(z, config->log_base);
        case CE_FN_SINH: return dv_sinh(z);
        case CE_FN_TANH: return dv_tanh(z);
        case CE_FN_ASIN: {
            const ce_sphere_delta one = dv_constant(dx(1.0, 0.0));
            const ce_sphere_delta root = dv_pow(dv_sub(one, dv_mul(z, z)), dv_constant(dx(0.5, 0.0)));
            return dv_mul(dv_constant(dx(0.0, -1.0)),
                          dv_log(dv_add(dv_mul(dv_constant(dx(0.0, 1.0)), z), root)));
        }
        case CE_FN_ATAN: {
            const ce_sphere_delta iz = dv_mul(dv_constant(dx(0.0, 1.0)), z);
            return dv_mul(dv_constant(dx(0.0, 0.5)),
                          dv_sub(dv_log(dv_sub(dv_constant(dx(1.0, 0.0)), iz)),
                                 dv_log(dv_add(dv_constant(dx(1.0, 0.0)), iz))));
        }
        case CE_FN_GAMMA: return dv_gamma(z);
        case CE_FN_LOG_GAMMA: return dv_log(dv_gamma(z));
        case CE_FN_BESSEL: return dv_bessel(z, config->bessel_order);
        case CE_FN_POWER: return dv_pow(z, dv_constant(dx(config->fractional_power, 0.0)));
        case CE_FN_MOBIUS:
            return dv_div(
                dv_add(dv_mul(dv_constant(config->mobius_a), z), dv_constant(config->mobius_b)),
                dv_add(dv_mul(dv_constant(config->mobius_c), z), dv_constant(config->mobius_d))
            );
        case CE_FN_ZETA: return dv_zeta(z, config);
        case CE_FN_POLYNOMIAL: {
            ce_sphere_delta result = dv_constant(dx(0.0, 0.0));
            for (uint32_t index = config->polynomial_count; index-- > 0u;) {
                result = dv_add(dv_mul(result, z), dv_constant(config->polynomial[index]));
            }
            return result;
        }
        case CE_FN_ALGEBRAIC: return dv_algebraic(z, c, config);
        case CE_FN_IDENTITY: return z;
        default: return dv_invalid();
    }
}

static ce_sphere_delta dv_taylor(const ce_map_config *config, ce_sphere_delta point) {
    if (!config->taylor_coefficients || !config->taylor_count) return dv_invalid();
    ce_sphere_delta delta = dv_sub(point, dv_constant(config->taylor_center));
    ce_sphere_delta result = dv_constant(dx(0.0, 0.0));
    for (uint32_t index = config->taylor_count; index-- > 0u;) {
        result = dv_add(dv_mul(result, delta), dv_constant(config->taylor_coefficients[index]));
    }
    return result;
}

static int dv_components(ce_sphere_delta value, ce_complex *anchor, ce_complex *actual) {
    ce_delta_pair pair;
    if (!dv_pair(value, &pair)) return 0;
    *anchor = pair.anchor;
    *actual = dp_actual(pair);
    return dx_finite(*anchor) && dx_finite(*actual);
}

static int dv_real_components(ce_sphere_delta value, double *anchor, double *actual) {
    ce_complex anchor_value, actual_value;
    if (!dv_components(value, &anchor_value, &actual_value) ||
        anchor_value.im != 0.0 || actual_value.im != 0.0) return 0;
    *anchor = anchor_value.re;
    *actual = actual_value.re;
    return 1;
}

static ce_sphere_delta dv_piecewise_real(double anchor, double actual) {
    return ce_delta_affine(dx(anchor, 0.0), dx(actual - anchor, 0.0));
}

static int dv_truth(ce_sphere_delta value) {
    ce_complex anchor, actual;
    return dv_components(value, &anchor, &actual) && (actual.re != 0.0 || actual.im != 0.0);
}

static int64_t dv_integer(double value, int *valid) {
    if (!isfinite(value) || floor(value) != value || fabs(value) > 9007199254740991.0) {
        *valid = 0;
        return 0;
    }
    return (int64_t)value;
}

static int dv_prime(int64_t value) {
    if (value < 2) return 0;
    if (value == 2 || value == 3) return 1;
    if (!(value & 1) || value % 3 == 0) return 0;
    for (int64_t divisor = 5, step = 2; divisor <= value / divisor;
         divisor += step, step = 6 - step) {
        if (value % divisor == 0) return 0;
    }
    return 1;
}

static ce_sphere_delta dv_map_point(const ce_map_config *config, ce_sphere_delta point) {
    ce_sphere_delta current = config->zero_seed
        ? dv_constant(config->chain_seed) : point;
    for (uint32_t index = 0; index < config->chain_count; ++index) {
        current = ce_delta_map_step(config, current, point);
        if (!current.valid) return current;
    }
    return current;
}

static ce_sphere_delta dv_dynamic_expression(const ce_map_config *base_config,
                                             const ce_expression_instruction *program,
                                             uint32_t instruction_count,
                                             const ce_sphere_delta *variables,
                                             uint32_t variable_count) {
    if (!program || !instruction_count || !variables || !variable_count) return dv_invalid();
    ce_sphere_delta stack[256];
    uint32_t size = 0u;
    uint32_t pc = 0u;
    while (pc < instruction_count) {
        const ce_expression_instruction instruction = program[pc++];
        ce_sphere_delta left, right;
        double anchor_real, actual_real;
        int valid = 1;
        switch (instruction.opcode) {
            case 0:
                if (size == 256u) return dv_invalid();
                stack[size++] = dv_constant(instruction.value);
                break;
            case 1: case 2: case 15:
                if (size == 256u || instruction.argument >= variable_count) return dv_invalid();
                stack[size++] = variables[instruction.argument];
                break;
            case 8:
                if (!size) return dv_invalid();
                stack[size - 1u] = dv_neg(stack[size - 1u]);
                break;
            case 9:
                if (!size || instruction.argument == CE_FN_ALGEBRAIC) return dv_invalid();
                stack[size - 1u] = dv_function(instruction.argument, stack[size - 1u],
                                                stack[size - 1u], &base_config->function);
                break;
            case 10: {
                if (!size) return dv_invalid();
                ce_delta_pair pair;
                if (!dv_pair(stack[size - 1u], &pair)) return dv_invalid();
                pair.anchor.im = -pair.anchor.im;
                pair.offset.im = -pair.offset.im;
                stack[size - 1u] = dv_from_pair(pair);
                break;
            }
            case 11: case 12: case 13: case 14: {
                if (!size) return dv_invalid();
                ce_complex anchor, actual;
                if (!dv_components(stack[size - 1u], &anchor, &actual)) return dv_invalid();
                if (instruction.opcode == 11u) {
                    stack[size - 1u] = dv_piecewise_real(hypot(anchor.re, anchor.im),
                                                        hypot(actual.re, actual.im));
                } else if (instruction.opcode == 12u) {
                    stack[size - 1u] = dv_piecewise_real(atan2(anchor.im, anchor.re),
                                                        atan2(actual.im, actual.re));
                } else if (instruction.opcode == 13u) {
                    stack[size - 1u] = ce_delta_affine(dx(anchor.re, 0.0), dx(actual.re - anchor.re, 0.0));
                } else {
                    stack[size - 1u] = ce_delta_affine(dx(anchor.im, 0.0), dx(actual.im - anchor.im, 0.0));
                }
                break;
            }
            case 16: case 24:
                if (!size) return dv_invalid();
                actual_real = dv_truth(stack[size - 1u]) ? 1.0 : 0.0;
                if (instruction.opcode == 16u) actual_real = 1.0 - actual_real;
                stack[size - 1u] = dv_constant(dx(actual_real, 0.0));
                break;
            case 17: {
                if (!size || !dv_real_components(stack[size - 1u], &anchor_real, &actual_real)) return dv_invalid();
                int anchor_ok = 1, actual_ok = 1;
                const int64_t anchor_integer = dv_integer(anchor_real, &anchor_ok);
                const int64_t actual_integer = dv_integer(actual_real, &actual_ok);
                if (!anchor_ok || !actual_ok || anchor_integer < 0 || actual_integer < 0 ||
                    anchor_integer > 170 || actual_integer > 170) return dv_invalid();
                double anchor_factorial = 1.0, actual_factorial = 1.0;
                for (int64_t n = 2; n <= anchor_integer; ++n) anchor_factorial *= (double)n;
                for (int64_t n = 2; n <= actual_integer; ++n) actual_factorial *= (double)n;
                stack[size - 1u] = dv_piecewise_real(anchor_factorial, actual_factorial);
                break;
            }
            case 28: case 29: case 30: case 31: case 32:
                if (!size || !dv_real_components(stack[size - 1u], &anchor_real, &actual_real)) return dv_invalid();
                if (instruction.opcode == 28u) { anchor_real = floor(anchor_real); actual_real = floor(actual_real); }
                else if (instruction.opcode == 29u) { anchor_real = ceil(anchor_real); actual_real = ceil(actual_real); }
                else if (instruction.opcode == 30u) { anchor_real = round(anchor_real); actual_real = round(actual_real); }
                else if (instruction.opcode == 31u) { anchor_real = trunc(anchor_real); actual_real = trunc(actual_real); }
                else {
                    anchor_real = anchor_real > 0.0 ? 1.0 : anchor_real < 0.0 ? -1.0 : 0.0;
                    actual_real = actual_real > 0.0 ? 1.0 : actual_real < 0.0 ? -1.0 : 0.0;
                }
                stack[size - 1u] = dv_piecewise_real(anchor_real, actual_real);
                break;
            case 25: case 26:
                if (!size || instruction.argument > instruction_count) return dv_invalid();
                left = stack[--size];
                if ((instruction.opcode == 25u && !dv_truth(left)) ||
                    (instruction.opcode == 26u && dv_truth(left))) pc = instruction.argument;
                break;
            case 27:
                if (instruction.argument > instruction_count) return dv_invalid();
                pc = instruction.argument;
                break;
            case 33: case 34: {
                const uint32_t count = instruction.argument;
                if (!count || size < count) return dv_invalid();
                uint32_t chosen = size - count;
                double chosen_value;
                if (!dv_real_components(stack[chosen], &anchor_real, &chosen_value)) return dv_invalid();
                for (uint32_t index = chosen + 1u; index < size; ++index) {
                    if (!dv_real_components(stack[index], &anchor_real, &actual_real)) return dv_invalid();
                    if ((instruction.opcode == 33u && actual_real < chosen_value) ||
                        (instruction.opcode == 34u && actual_real > chosen_value)) {
                        chosen = index; chosen_value = actual_real;
                    }
                }
                stack[size - count] = stack[chosen];
                size -= count - 1u;
                break;
            }
            case 35:
                if (size < 2u) return dv_invalid();
                right = stack[--size]; left = stack[size - 1u];
                double anchor_divisor, actual_divisor;
                if (!dv_real_components(left, &anchor_real, &actual_real) ||
                    !dv_real_components(right, &anchor_divisor, &actual_divisor) ||
                    anchor_divisor == 0.0 || actual_divisor == 0.0) return dv_invalid();
                stack[size - 1u] = dv_piecewise_real(fmod(anchor_real, anchor_divisor),
                                                    fmod(actual_real, actual_divisor));
                break;
            case 36: {
                if (size < 2u) return dv_invalid();
                right = stack[--size]; left = stack[size - 1u];
                double anchor_right, actual_right;
                if (!dv_real_components(left, &anchor_real, &actual_real) ||
                    !dv_real_components(right, &anchor_right, &actual_right)) return dv_invalid();
                int anchor_ok = 1, actual_ok = 1;
                int64_t a = dv_integer(anchor_real, &anchor_ok), b = dv_integer(anchor_right, &anchor_ok);
                int64_t c = dv_integer(actual_real, &actual_ok), d = dv_integer(actual_right, &actual_ok);
                if (!anchor_ok || !actual_ok) return dv_invalid();
                if (a < 0) a = -a; if (b < 0) b = -b;
                if (c < 0) c = -c; if (d < 0) d = -d;
                while (b) { const int64_t next = a % b; a = b; b = next; }
                while (d) { const int64_t next = c % d; c = d; d = next; }
                stack[size - 1u] = dv_piecewise_real((double)a, (double)c);
                break;
            }
            case 37: {
                if (!size || !dv_real_components(stack[size - 1u], &anchor_real, &actual_real)) return dv_invalid();
                int anchor_ok = 1, actual_ok = 1;
                const int64_t anchor_integer = dv_integer(anchor_real, &anchor_ok);
                const int64_t actual_integer = dv_integer(actual_real, &actual_ok);
                if (!anchor_ok || !actual_ok) return dv_invalid();
                stack[size - 1u] = dv_piecewise_real((double)dv_prime(anchor_integer),
                                                    (double)dv_prime(actual_integer));
                break;
            }
            case 38:
                if (!instruction.argument || instruction.argument > 2u || size < instruction.argument) return dv_invalid();
                if (instruction.argument == 1u) {
                    if (!dv_real_components(stack[size - 1u], &anchor_real, &actual_real)) return dv_invalid();
                    stack[size - 1u] = dv_piecewise_real(anchor_real, actual_real);
                } else {
                    right = stack[--size]; left = stack[size - 1u];
                    double anchor_imaginary, actual_imaginary;
                    if (!dv_real_components(left, &anchor_real, &actual_real) ||
                        !dv_real_components(right, &anchor_imaginary, &actual_imaginary)) return dv_invalid();
                    stack[size - 1u] = ce_delta_affine(dx(anchor_real, anchor_imaginary),
                        dx(actual_real - anchor_real, actual_imaginary - anchor_imaginary));
                }
                break;
            case 39:
                if (size < 2u) return dv_invalid();
                right = stack[--size]; left = stack[size - 1u];
                ce_complex anchor_order, actual_order;
                if (!dv_components(left, &anchor_order, &actual_order) ||
                    anchor_order.re != actual_order.re || anchor_order.im != actual_order.im) return dv_invalid();
                stack[size - 1u] = dv_bessel(right, anchor_order);
                break;
            case 40:
                if (!size) return dv_invalid();
                stack[size - 1u] = dv_map_point(base_config, stack[size - 1u]);
                break;
            case 41:
                if (!size) return dv_invalid();
                stack[size - 1u] = dv_pow(stack[size - 1u], dv_constant(dx(0.5, 0.0)));
                break;
            default:
                if (size < 2u) return dv_invalid();
                right = stack[--size]; left = stack[size - 1u];
                if (instruction.opcode == 3u) stack[size - 1u] = dv_add(left, right);
                else if (instruction.opcode == 4u) stack[size - 1u] = dv_sub(left, right);
                else if (instruction.opcode == 5u) stack[size - 1u] = dv_mul(left, right);
                else if (instruction.opcode == 6u) stack[size - 1u] = dv_div(left, right);
                else if (instruction.opcode == 7u) stack[size - 1u] = dv_pow(left, right);
                else if (instruction.opcode >= 18u && instruction.opcode <= 23u) {
                    ce_complex anchor_left, actual_left, anchor_right, actual_right;
                    if (!dv_components(left, &anchor_left, &actual_left) ||
                        !dv_components(right, &anchor_right, &actual_right)) return dv_invalid();
                    int anchor_comparison = 0, actual_comparison = 0;
                    if (instruction.opcode <= 19u) {
                        anchor_comparison = anchor_left.re == anchor_right.re && anchor_left.im == anchor_right.im;
                        actual_comparison = actual_left.re == actual_right.re && actual_left.im == actual_right.im;
                        if (instruction.opcode == 19u) {
                            anchor_comparison = !anchor_comparison; actual_comparison = !actual_comparison;
                        }
                    } else {
                        if (anchor_left.im != 0.0 || actual_left.im != 0.0 ||
                            anchor_right.im != 0.0 || actual_right.im != 0.0) return dv_invalid();
                        if (instruction.opcode == 20u) { anchor_comparison = anchor_left.re < anchor_right.re; actual_comparison = actual_left.re < actual_right.re; }
                        else if (instruction.opcode == 21u) { anchor_comparison = anchor_left.re <= anchor_right.re; actual_comparison = actual_left.re <= actual_right.re; }
                        else if (instruction.opcode == 22u) { anchor_comparison = anchor_left.re > anchor_right.re; actual_comparison = actual_left.re > actual_right.re; }
                        else { anchor_comparison = anchor_left.re >= anchor_right.re; actual_comparison = actual_left.re >= actual_right.re; }
                    }
                    stack[size - 1u] = dv_piecewise_real((double)anchor_comparison, (double)actual_comparison);
                } else valid = 0;
                if (!valid) return dv_invalid();
                break;
        }
        if (size && !stack[size - 1u].valid) return dv_invalid();
    }
    return size == 1u ? stack[0] : dv_invalid();
}

static ce_sphere_delta dv_dynamic(const ce_map_config *config, ce_sphere_delta parameter) {
    if (!config->dynamic_point_expression || !config->dynamic_point_count ||
        !config->dynamic_term_expression || !config->dynamic_term_count ||
        !config->dynamic_variables || !config->dynamic_variable_flags ||
        !config->dynamic_variable_count || !config->dynamic_source_count ||
        config->dynamic_variable_count > 256u || config->dynamic_reduction > 2u) return dv_invalid();

    ce_map_config base = *config;
    base.chain_count = 1u;
    base.zero_seed = 0u;
    base.chain_seed = dx(0.0, 0.0);
    base.derivative = 0u;
    base.dynamic_source_count = 0u;
    ce_sphere_delta variables[256];
    ce_sphere_delta result = config->dynamic_reduction == 2u
        ? dv_constant(dx(1.0, 0.0)) : dv_constant(dx(0.0, 0.0));
    int has_value = 0;
    for (uint32_t source = 0; source < config->dynamic_source_count; ++source) {
        for (uint32_t slot = 0; slot < config->dynamic_variable_count; ++slot) {
            variables[slot] = dv_constant(
                config->dynamic_variables[(size_t)source * config->dynamic_variable_count + slot]
            );
            const uint8_t flag = config->dynamic_variable_flags[slot];
            if (flag == 1u) variables[slot] = parameter;
            else if (flag == 2u) {
                ce_complex anchor, actual;
                if (!dv_components(parameter, &anchor, &actual)) return dv_invalid();
                variables[slot] = ce_delta_affine(dx(anchor.re, 0.0), dx(actual.re - anchor.re, 0.0));
            }
        }
        const ce_sphere_delta point = dv_dynamic_expression(
            &base, config->dynamic_point_expression, config->dynamic_point_count,
            variables, config->dynamic_variable_count
        );
        if (!point.valid) {
            if (config->dynamic_invalid_policy) continue;
            return dv_invalid();
        }
        for (uint32_t slot = 0; slot < config->dynamic_variable_count; ++slot) {
            if (config->dynamic_variable_flags[slot] == 3u) variables[slot] = point;
        }
        const ce_sphere_delta term = dv_dynamic_expression(
            &base, config->dynamic_term_expression, config->dynamic_term_count,
            variables, config->dynamic_variable_count
        );
        if (!term.valid) {
            if (config->dynamic_invalid_policy) continue;
            return dv_invalid();
        }
        has_value = 1;
        if (config->dynamic_reduction == 1u) result = dv_add(result, term);
        else if (config->dynamic_reduction == 2u) result = dv_mul(result, term);
        else result = term;
    }
    return (has_value || config->dynamic_reduction != 0u) ? result : dv_invalid();
}

ce_sphere_delta ce_delta_map_step(const ce_map_config *config,
                                  ce_sphere_delta current,
                                  ce_sphere_delta parameter) {
    if (!config || !current.valid || !parameter.valid) return dv_invalid();
    if (config->dynamic_source_count) return dv_dynamic(config, current);
    if (config->use_taylor) return dv_taylor(config, current);
    if (config->kernel_kind == CE_MAP_KERNEL_DIRECT_FUNCTION) {
        const ce_algebraic_term *term = &config->function.algebraic_terms[0];
        const ce_algebraic_factor *factor = &config->function.algebraic_factors[term->factor_offset];
        return dv_mul(dv_constant(term->coefficient),
                      dv_function(factor->function_id, current, parameter, &config->function));
    }
    if (config->kernel_kind == CE_MAP_KERNEL_QUADRATIC_PARAMETER) {
        return dv_add(dv_mul(current, current), parameter);
    }
    if (config->kernel_kind == CE_MAP_KERNEL_NEWTON_CUBIC) {
        return dv_add(
            dv_mul(dv_constant(dx(2.0 / 3.0, 0.0)), current),
            dv_div(dv_constant(dx(1.0 / 3.0, 0.0)), dv_mul(current, current))
        );
    }
    if (config->kernel_kind == CE_MAP_KERNEL_POLYNOMIAL_PARAMETER) {
        return dv_add(
            dv_constant(config->kernel_constant),
            dv_add(
                dv_mul(dv_constant(config->kernel_polynomial_scale),
                       dv_function(CE_FN_POLYNOMIAL, current, parameter, &config->function)),
                dv_mul(dv_constant(config->kernel_parameter_scale), parameter)
            )
        );
    }
    if (config->kernel_kind == CE_MAP_KERNEL_LAURENT_PARAMETER) {
        ce_sphere_delta sum = dv_add(
            dv_constant(config->kernel_constant),
            dv_mul(dv_constant(config->kernel_parameter_scale), parameter)
        );
        for (uint32_t index = 0; index < config->function.algebraic_term_count; ++index) {
            const ce_algebraic_term *term = &config->function.algebraic_terms[index];
            if (!term->factor_count) continue;
            const ce_algebraic_factor *factor = &config->function.algebraic_factors[term->factor_offset];
            if (factor->function_id == CE_FN_C) continue;
            double power = factor->power;
            if (factor->flags & 1u) power = -power;
            sum = dv_add(sum, dv_mul(
                dv_constant(term->coefficient),
                dv_pow(current, dv_constant(dx(power, 0.0)))
            ));
        }
        return sum;
    }
    return dv_function(config->function_id, current, parameter, &config->function);
}

int ce_delta_actual(const ce_sphere_delta *value, ce_complex *actual) {
    if (!value || !value->valid || !actual) return 0;
    if (dv_affine_value(*value)) {
        *actual = dp_actual(value->numerator);
        return dx_finite(*actual);
    }
    const ce_complex numerator = dp_actual(value->numerator);
    const ce_complex denominator = dp_actual(value->denominator);
    if (dx_zero(denominator)) return 0;
    *actual = dx_div(numerator, denominator);
    return dx_finite(*actual);
}

int ce_delta_normalize(ce_sphere_delta *value) {
    if (!value || !value->valid) return 0;
    value->numerator = dp_normalize(value->numerator);
    value->denominator = dp_normalize(value->denominator);
    return dx_finite(value->numerator.anchor) && dx_finite(value->numerator.offset) &&
        dx_finite(value->denominator.anchor) && dx_finite(value->denominator.offset);
}

int ce_delta_log_polar(const ce_sphere_delta *value, double *phase, double *log_magnitude) {
    if (!value || !value->valid || !phase || !log_magnitude) return 0;
    if (dv_affine_value(*value)) {
        const ce_complex actual = dp_actual(value->numerator);
        *phase = atan2(actual.im, actual.re);
        *log_magnitude = dx_log_abs(actual);
        return isfinite(*phase) && !isnan(*log_magnitude);
    }
    const ce_complex numerator = dp_actual(value->numerator);
    const ce_complex denominator = dp_actual(value->denominator);
    if (dx_zero(numerator) && dx_zero(denominator)) return 0;
    *phase = atan2(numerator.im, numerator.re) - atan2(denominator.im, denominator.re);
    *log_magnitude = dx_log_abs(numerator) - dx_log_abs(denominator);
    return isfinite(*phase) && !isnan(*log_magnitude);
}
