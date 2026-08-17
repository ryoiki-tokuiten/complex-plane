#include "complex_engine.h"

#include <math.h>
#include <stdlib.h>

#define CE_TWO_PI 6.283185307179586476925286766559

int32_t ce_compute_taylor_coefficients(const ce_map_config *map_config,
                                       double center_re, double center_im, double radius,
                                       uint32_t step_count, uint32_t order,
                                       ce_complex *coefficients) {
    if (!map_config || !coefficients || !(radius > 0.0) || !step_count || order > 128) return -1;
    const ce_complex center = {center_re, center_im};
    double *acc_re = (double *)calloc((size_t)order + 1u, sizeof(double));
    double *acc_im = (double *)calloc((size_t)order + 1u, sizeof(double));
    if (!acc_re || !acc_im) { free(acc_re); free(acc_im); return -2; }
    double previous_re = center.re + radius;
    double previous_im = center.im;
    for (uint32_t step = 1; step <= step_count; ++step) {
        const double t = ((double)step / step_count) * CE_TWO_PI;
        const double current_re = center.re + radius * cos(t);
        const double current_im = center.im + radius * sin(t);
        const double dz_re = current_re - previous_re;
        const double dz_im = current_im - previous_im;
        const ce_complex midpoint = {(previous_re + current_re) * 0.5,
                                     (previous_im + current_im) * 0.5};
        const ce_complex function_value = ce_eval_function(
            map_config->function_id, midpoint, midpoint, &map_config->function
        );
        if (!isfinite(function_value.re) || !isfinite(function_value.im)) {
            free(acc_re); free(acc_im); return -3;
        }
        const double delta_re = midpoint.re - center.re;
        const double delta_im = midpoint.im - center.im;
        const double denominator = delta_re * delta_re + delta_im * delta_im;
        if (!(denominator > 0.0) || !isfinite(denominator)) {
            free(acc_re); free(acc_im); return -3;
        }
        const double inverse_re = delta_re / denominator;
        const double inverse_im = -delta_im / denominator;
        double power_re = inverse_re;
        double power_im = inverse_im;
        for (uint32_t n = 0; n <= order; ++n) {
            const double fp_re = function_value.re * power_re - function_value.im * power_im;
            const double fp_im = function_value.re * power_im + function_value.im * power_re;
            acc_re[n] += fp_re * dz_re - fp_im * dz_im;
            acc_im[n] += fp_re * dz_im + fp_im * dz_re;
            const double next_re = power_re * inverse_re - power_im * inverse_im;
            power_im = power_re * inverse_im + power_im * inverse_re;
            power_re = next_re;
        }
        previous_re = current_re;
        previous_im = current_im;
    }
    for (uint32_t n = 0; n <= order; ++n) {
        coefficients[n].re = acc_im[n] / CE_TWO_PI;
        coefficients[n].im = -acc_re[n] / CE_TWO_PI;
    }
    free(acc_re);
    free(acc_im);
    return 0;
}
