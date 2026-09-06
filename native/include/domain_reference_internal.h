#ifndef CE_DOMAIN_REFERENCE_INTERNAL_H
#define CE_DOMAIN_REFERENCE_INTERNAL_H
#include "domain_program.h"
#include <flint/acb.h>
struct ce_domain_program {
    ce_map_config config;
    ce_domain_node *nodes;
    ce_complex *constants;
    uint32_t count, output;
    char error[160];
    uint8_t *varying;
    int vp_valid;
    slong vp_prec;
    const char *vp_re, *vp_im, *vp_xs, *vp_ys;
    uint32_t vp_w, vp_h;
    acb_t vp_center, vp_stepx, vp_stepy, vp_inv_stepx;
    float vp_stepx_ball[8], vp_stepy_ball[8], vp_inv_stepx_ball[8];
    uint32_t exp_terms, exp_prec;
    float *exp_coeffs;
};
#endif
