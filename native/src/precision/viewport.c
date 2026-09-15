#include "complex_engine.h"
#include <math.h>
#include <mpfr.h>

/* Canonical viewport edits remain in MPFR. JavaScript supplies only the
 * dimensionless gesture/resize factors, never an absolute double center. */
int32_t ce_transform_viewport(const char *const input[4], uint32_t precision,
                              double scale_x, double scale_y, double shift_x, double shift_y,
                              char *output, uint32_t row_bytes) {
    if (!input || !output || row_bytes < 32u || precision < 128u || precision > 4096u ||
        !(scale_x > 0.0) || !(scale_y > 0.0) || !isfinite(scale_x) || !isfinite(scale_y) ||
        !isfinite(shift_x) || !isfinite(shift_y)) return -1;
    mpfr_t value[4], work;
    for (unsigned i = 0; i < 4u; ++i) mpfr_init2(value[i], precision);
    mpfr_init2(work, precision);
    int32_t status = -1;
    for (unsigned i = 0; i < 4u; ++i) {
        if (!input[i] || mpfr_set_str(value[i], input[i], 10, MPFR_RNDN) || !mpfr_number_p(value[i])) goto done;
    }
    if (mpfr_sgn(value[2]) <= 0 || mpfr_sgn(value[3]) <= 0) goto done;
    mpfr_mul_d(work, value[2], shift_x, MPFR_RNDN); mpfr_add(value[0], value[0], work, MPFR_RNDN);
    mpfr_mul_d(work, value[3], shift_y, MPFR_RNDN); mpfr_add(value[1], value[1], work, MPFR_RNDN);
    mpfr_mul_d(value[2], value[2], scale_x, MPFR_RNDN); mpfr_mul_d(value[3], value[3], scale_y, MPFR_RNDN);
    const int digits = (int)ceil(precision * 0.3010299956639812) + 2;
    for (unsigned i = 0; i < 4u; ++i) {
        if (!mpfr_number_p(value[i])) goto done;
        int length = mpfr_snprintf(output + i * row_bytes, row_bytes, "%.*Rg", digits, value[i]);
        if (length < 0 || (unsigned)length >= row_bytes) goto done;
    }
    status = 0;
done:
    for (unsigned i = 0; i < 4u; ++i) mpfr_clear(value[i]);
    mpfr_clear(work);
    return status;
}
