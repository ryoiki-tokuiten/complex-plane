#include "complex_engine.h"
#include <mpfr.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

/* GPU radix-2^15 numbers. The header is sign, radix exponent, log2 absolute
 * error (float bits), padding; the remaining words are most significant first.
 * Preparation is independent of viewport coverage and sample count. */
int32_t ce_encode_domain_number(uint32_t kind, uint32_t index, const char *text,
                                uint32_t words, uint32_t *output) {
    if (!output || words < 3 || words > 274 || kind > 10 ||
        ((kind == 0 || (kind >= 6 && kind <= 8)) && !text) || ((kind == 3 || kind == 4) && !index)) return -1;
    mpfr_t lo, hi, a, b, value, error;
    mpfr_inits2(15 * (words + 3), lo, hi, a, b, value, error, (mpfr_ptr)0);
    int status = 0;
    if (kind == 0) {
        if (mpfr_set_str(lo, text, 10, MPFR_RNDD) || mpfr_set_str(hi, text, 10, MPFR_RNDU)) { status = -2; goto done; }
    } else if (kind == 6) {
        char *end; double v = strtod(text, &end);
        if (*end || !isfinite(v)) { status = -2; goto done; }
        mpfr_set_d(lo, v, MPFR_RNDN); mpfr_set(hi, lo, MPFR_RNDN);
    } else if (kind == 7 || kind == 8) {
        char *end; double re = strtod(text, &end), im = strtod(end, &end);
        if (*end || !isfinite(re) || !isfinite(im) || (re == 0 && im == 0)) { status = -2; goto done; }
        mpfr_set_d(a, re, MPFR_RNDN); mpfr_set_d(b, im, MPFR_RNDN);
        if (kind == 7) {
            mpfr_hypot(lo, a, b, MPFR_RNDD); mpfr_hypot(hi, a, b, MPFR_RNDU);
            mpfr_log(lo, lo, MPFR_RNDD); mpfr_log(hi, hi, MPFR_RNDU);
        } else {
            mpfr_atan2(lo, b, a, MPFR_RNDD); mpfr_atan2(hi, b, a, MPFR_RNDU);
        }
    } else if (kind == 9 || kind == 10) {
        if (kind == 9) { mpfr_const_pi(a, MPFR_RNDD); mpfr_const_pi(b, MPFR_RNDU); }
        else { mpfr_const_log2(a, MPFR_RNDD); mpfr_const_log2(b, MPFR_RNDU); }
        mpfr_ui_div(lo, kind == 9 ? 2 : 1, b, MPFR_RNDD);
        mpfr_ui_div(hi, kind == 9 ? 2 : 1, a, MPFR_RNDU);
    } else if (kind == 1) {
        mpfr_const_pi(lo, MPFR_RNDD); mpfr_const_pi(hi, MPFR_RNDU);
    } else if (kind == 2) {
        mpfr_const_log2(lo, MPFR_RNDD); mpfr_const_log2(hi, MPFR_RNDU);
    } else if (kind == 5) {
        mpfr_const_pi(lo, MPFR_RNDD); mpfr_const_pi(hi, MPFR_RNDU);
        mpfr_mul_2ui(lo, lo, 1, MPFR_RNDD); mpfr_mul_2ui(hi, hi, 1, MPFR_RNDU);
        mpfr_log(lo, lo, MPFR_RNDD); mpfr_log(hi, hi, MPFR_RNDU);
        mpfr_div_2ui(lo, lo, 1, MPFR_RNDD); mpfr_div_2ui(hi, hi, 1, MPFR_RNDU);
    } else {
        /* B_2k/(2k)! from directed MPFR zeta and pi. */
        mpfr_const_pi(a, MPFR_RNDD); mpfr_const_pi(b, MPFR_RNDU);
        mpfr_mul_2ui(a, a, 1, MPFR_RNDD); mpfr_mul_2ui(b, b, 1, MPFR_RNDU);
        mpfr_pow_ui(a, a, 2 * index, MPFR_RNDD); mpfr_pow_ui(b, b, 2 * index, MPFR_RNDU);
        mpfr_zeta_ui(lo, 2 * index, MPFR_RNDD); mpfr_zeta_ui(hi, 2 * index, MPFR_RNDU);
        mpfr_mul_2ui(lo, lo, 1, MPFR_RNDD); mpfr_mul_2ui(hi, hi, 1, MPFR_RNDU);
        mpfr_div(lo, lo, b, MPFR_RNDD); mpfr_div(hi, hi, a, MPFR_RNDU);
        if (kind == 4) {
            mpfr_fac_ui(a, 2 * index - 2, MPFR_RNDD); mpfr_fac_ui(b, 2 * index - 2, MPFR_RNDU);
            mpfr_mul(lo, lo, a, MPFR_RNDD); mpfr_mul(hi, hi, b, MPFR_RNDU);
        }
        if (!(index & 1)) { mpfr_neg(a, hi, MPFR_RNDD); mpfr_neg(hi, lo, MPFR_RNDU); mpfr_set(lo, a, MPFR_RNDD); }
    }
    if (!mpfr_number_p(lo) || !mpfr_number_p(hi)) { status = -3; goto done; }
    memset(output, 0, (words + 4) * sizeof(uint32_t));
    mpfr_add(value, lo, hi, MPFR_RNDN); mpfr_div_2ui(value, value, 1, MPFR_RNDN);
    int sign = mpfr_sgn(value);
    long exponent = sign ? (long)floor((double)(mpfr_get_exp(value) - 1) / 15.0) : 0;
    if (labs(exponent) > 1000000) { status = -3; goto done; }
    output[0] = (uint32_t)sign; output[1] = (uint32_t)(int32_t)exponent;
    mpfr_abs(a, value, MPFR_RNDN); mpfr_div_2si(a, a, 15 * exponent, MPFR_RNDN);
    mpfr_set_zero(value, 0);
    for (uint32_t i = 0; i < words; ++i) {
        unsigned long digit = mpfr_get_ui(a, MPFR_RNDZ);
        output[i + 4] = (uint32_t)digit;
        mpfr_set_ui(b, digit, MPFR_RNDN); mpfr_mul_2si(b, b, 15 * (exponent - i), MPFR_RNDN);
        mpfr_add(value, value, b, MPFR_RNDN);
        mpfr_sub_ui(a, a, digit, MPFR_RNDN); mpfr_mul_2ui(a, a, 15, MPFR_RNDN);
    }
    if (sign < 0) mpfr_neg(value, value, MPFR_RNDN);
    mpfr_sub(a, value, lo, MPFR_RNDU); mpfr_sub(b, hi, value, MPFR_RNDU);
    mpfr_max(error, a, b, MPFR_RNDU);
    float log_error = -1e30f;
    if (mpfr_sgn(error) > 0) { mpfr_log2(error, error, MPFR_RNDU); log_error = mpfr_get_flt(error, MPFR_RNDU); }
    memcpy(output + 2, &log_error, sizeof(float));
done:
    mpfr_clears(lo, hi, a, b, value, error, (mpfr_ptr)0);
    return status;
}
