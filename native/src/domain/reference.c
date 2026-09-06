#include "domain_reference.h"
#include "domain_reference_internal.h"
#include <mpfr.h>
#include <flint/acb.h>
#include <flint/acb_poly.h>
#include <flint/acb_hypgeom.h>
#include <flint/arb.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

/* Each GPU ball has two RGBA texels: high real/imaginary, exponent, radius;
   low real/imaginary, padding. The radius encloses the high+low sum. */
struct ce_domain_reference {
    const ce_domain_program *program;
    slong precision,range_exponent;
    uint32_t terms,stride,iteration,checkpoint_age,checkpoint_power;
    acb_ptr anchors,origin_anchors;
    acb_t parameter,current,checkpoint,origin;
    float *header,*data,*exp_coefficients;
    float *origin_data;
    uint8_t *varying;
    size_t capacity;
    arf_t exp_re,exp_im,exp_radius,exp_t,exp_rounded,exp_error;
    acb_t next_v,next_defect,next_box,next_bound,next_coef;
    arb_t next_radius,next_inverse;
    arf_t next_mag;
    acb_poly_t next_poly;
};
static uint32_t node_floats(ce_domain_node node,uint32_t terms) {
    if(node.op==DP_SELECT)return 32;
    if(node.op!=DP_ANALYTIC || node.aux==DA_EXP || node.aux==DA_INV)return 16;
    if(node.aux==DA_SIN || node.aux==DA_COS)return 24;
    return 36+terms*8;
}
static void exact_complex(acb_t z,ce_complex v){arb_set_d(acb_realref(z),v.re);arb_set_d(acb_imagref(z),v.im);}
static void export_ball(ce_domain_reference *r,float *out,const acb_t z) {
    if(!acb_is_finite(z)){out[0]=0;out[1]=0;out[2]=2000000;out[3]=0;out[4]=0;out[5]=0;out[6]=0;out[7]=0;return;}
    if(acb_is_zero(z)){out[0]=0;out[1]=0;out[2]=0;out[3]=0;out[4]=0;out[5]=0;out[6]=0;out[7]=0;return;}
    arf_ptr re=r->exp_re,im=r->exp_im,radius=r->exp_radius,t=r->exp_t;
    arf_set(re,arb_midref(acb_realref(z)));arf_set(im,arb_midref(acb_imagref(z)));
    const mag_struct *rad_re = arb_radref(acb_realref(z));
    const mag_struct *rad_im = arb_radref(acb_imagref(z));
    int has_rad = !mag_is_zero(rad_re) || !mag_is_zero(rad_im);
    if(has_rad) {
        arf_set_mag(radius,rad_re);arf_set_mag(t,rad_im);arf_add(radius,radius,t,64,ARF_RND_UP);
    } else {
        arf_zero(radius);
    }
    slong e=ARF_PREC_EXACT;
    if(!arf_is_zero(re))e=arf_abs_bound_lt_2exp_si(re);
    if(!arf_is_zero(im))e=e==ARF_PREC_EXACT?arf_abs_bound_lt_2exp_si(im):FLINT_MAX(e,arf_abs_bound_lt_2exp_si(im));
    if(has_rad && !arf_is_zero(radius))e=e==ARF_PREC_EXACT?arf_abs_bound_lt_2exp_si(radius):FLINT_MAX(e,arf_abs_bound_lt_2exp_si(radius));
    if(e < -1000000 || e > 1000000){out[0]=0;out[1]=0;out[2]=2000000;out[3]=0;out[4]=0;out[5]=0;out[6]=0;out[7]=0;return;}
    arf_mul_2exp_si(re,re,-e);arf_mul_2exp_si(im,im,-e);
    if(has_rad) arf_mul_2exp_si(radius,radius,-e);
    if(arf_is_zero(re) && arf_is_zero(im)) {
        out[0]=0;out[1]=0;out[4]=0;out[5]=0;out[6]=0;out[7]=0;out[2]=(float)e;
        out[3]=nextafterf(fmaxf(0x1p-120f,has_rad?(float)arf_get_d(radius,ARF_RND_UP):0.0f),INFINITY);
        return;
    }
    double total_err = has_rad ? arf_get_d(radius, ARF_RND_UP) : 0.0;
    for(int component=0;component<2;++component) {
        arf_srcptr value=component?im:re;
        if(arf_is_zero(value)) { out[component]=0; out[4+component]=0; continue; }
        double d=arf_get_d(value,ARF_RND_NEAR);
        float hi=fabs(d)<0x1p-120?0.0f:(float)d;
        float lo=fabs(d-(double)hi)<0x1p-120?0.0f:(float)(d-(double)hi);
        out[component]=hi; out[4+component]=lo;
        double res = (d - (double)hi) - (double)lo;
        total_err += fabs(res) + 0x1p-54 * fabs(d);
    }
    out[2]=(float)e;out[6]=0;out[7]=0;
    out[3]=nextafterf(fmaxf(0x1p-120f,(float)total_err),INFINITY);
}
static void export_defect(ce_domain_reference *r,float *out,const acb_t z) {
    (void)r;
    if(!acb_is_finite(z)){memset(out,0,8*sizeof(float));out[2]=2000000;return;}
    const mag_struct *rad_re = arb_radref(acb_realref(z));
    const mag_struct *rad_im = arb_radref(acb_imagref(z));
    if(mag_is_zero(rad_re) && mag_is_zero(rad_im)){memset(out,0,8*sizeof(float));return;}
    double d_re = mag_get_d(rad_re);
    double d_im = mag_get_d(rad_im);
    double rad = d_re + d_im;
    if(!isfinite(rad) || rad <= 0.0){memset(out,0,8*sizeof(float));if(!isfinite(rad))out[2]=2000000;return;}
    int exp;
    double m = frexp(rad, &exp);
    if(exp < -1000000 || exp > 1000000){memset(out,0,8*sizeof(float));out[2]=2000000;return;}
    memset(out,0,8*sizeof(float));
    out[2]=(float)exp;
    out[3]=nextafterf(fmaxf(0x1p-120f,(float)m),INFINITY);
}
static void analytic(acb_t out,uint32_t kind,const acb_t z,const acb_t order,slong p) {
    switch(kind) {
    case DA_EXP:acb_exp(out,z,p);break;
    case DA_LOG:acb_log(out,z,p);break;
    case DA_SQRT:acb_sqrt(out,z,p);break;
    case DA_GAMMA:acb_gamma(out,z,p);break;
    case DA_ZETA:acb_zeta(out,z,p);break;
    case DA_BESSEL:acb_hypgeom_bessel_j(out,order,z,p);break;
    case DA_INV:acb_inv(out,z,p);break;
    default:acb_indeterminate(out);
    }
}
static void bessel_series(acb_poly_t out,const acb_t z,const acb_t order,const arb_t scale,slong n,slong p) {
    /* Differential equation at a nonzero expansion center. */
    acb_t a,b,c,d,z2,nu2;acb_init(a);acb_init(b);acb_init(c);acb_init(d);acb_init(z2);acb_init(nu2);
    acb_poly_zero(out);acb_hypgeom_bessel_j(a,order,z,p);acb_poly_set_coeff_acb(out,0,a);
    acb_add_ui(b,order,1,p);acb_hypgeom_bessel_j(b,b,z,p);acb_mul(c,a,order,p);acb_div(c,c,z,p);acb_sub(b,c,b,p);acb_poly_set_coeff_acb(out,1,b);
    acb_mul(z2,z,z,p);acb_mul(nu2,order,order,p);
    for(slong k=0;k+2<n;++k) {
        acb_poly_get_coeff_acb(a,out,k+1);acb_mul(a,a,z,p);acb_mul_si(a,a,(k+1)*(2*k+1),p);
        acb_sub(b,z2,nu2,p);acb_add_si(b,b,k*k,p);acb_poly_get_coeff_acb(c,out,k);acb_mul(b,b,c,p);acb_add(a,a,b,p);
        if(k>=1){acb_poly_get_coeff_acb(b,out,k-1);acb_mul(b,b,z,p);acb_mul_2exp_si(b,b,1);acb_add(a,a,b,p);}
        if(k>=2){acb_poly_get_coeff_acb(b,out,k-2);acb_add(a,a,b,p);}
        acb_mul_si(b,z2,(k+2)*(k+1),p);acb_div(a,a,b,p);acb_neg(a,a);acb_poly_set_coeff_acb(out,k+2,a);
    }
    arb_t power;arb_init(power);arb_one(power);
    for(slong k=0;k<n;++k){acb_poly_get_coeff_acb(a,out,k);acb_mul_arb(a,a,power,p);acb_poly_set_coeff_acb(out,k,a);arb_mul(power,power,scale,p);}
    arb_clear(power);acb_clear(a);acb_clear(b);acb_clear(c);acb_clear(d);acb_clear(z2);acb_clear(nu2);
}
static void series(acb_poly_t out,uint32_t kind,const acb_t z,const acb_t order,const arb_t radius,slong n,slong p) {
    acb_poly_t input;acb_poly_init(input);acb_poly_set_coeff_acb(input,0,z);
    acb_t r,one;acb_init(r);acb_init(one);acb_set_arb(r,radius);acb_one(one);acb_poly_set_coeff_acb(input,1,r);
    switch(kind) {
    case DA_EXP:acb_poly_exp_series(out,input,n,p);break;
    case DA_LOG:acb_poly_log_series(out,input,n,p);break;
    case DA_SQRT:acb_poly_sqrt_series(out,input,n,p);break;
    case DA_GAMMA:acb_poly_gamma_series(out,input,n,p);break;
    case DA_ZETA:acb_poly_zeta_series(out,input,one,0,n,p);break;
    case DA_BESSEL:bessel_series(out,z,order,radius,n,p);break;
    }
    acb_clear(r);acb_clear(one);acb_poly_clear(input);
}
static int analytic_disk(uint32_t kind,const acb_t z,const acb_t order,const arb_t r,slong p) {
    if(kind!=DA_LOG && kind!=DA_SQRT && kind!=DA_BESSEL)return 1;
    if(kind==DA_BESSEL && acb_is_int(order))return 1;
    arb_t d;arb_init(d);
    if(arb_is_positive(acb_realref(z)))acb_abs(d,z,p);else arb_abs(d,acb_imagref(z));
    int ok=arb_lt(r,d);arb_clear(d);return ok;
}
static int truth(const acb_t z){return acb_is_finite(z) && !acb_contains_zero(z);}
static void integer_op(acb_t v,const acb_t a,const acb_t b,uint32_t kind,slong p) {
    acb_indeterminate(v);if(!acb_is_real(a))return;
    if(kind==28){arb_floor(acb_realref(v),acb_realref(a),p);arb_zero(acb_imagref(v));return;}
    if(kind==29){arb_ceil(acb_realref(v),acb_realref(a),p);arb_zero(acb_imagref(v));return;}
    arf_t x;arf_init(x);arf_set(x,arb_midref(acb_realref(a)));
    if(kind==30 || kind==31 || kind==32) {
        if(kind==32)acb_set_si(v,arf_sgn(x));
        else { fmpz_t z;fmpz_init(z);if(kind==30){arf_t half;arf_init(half);arf_set_d(half,arf_sgn(x)<0?-0.5:0.5);arf_add(x,x,half,p,ARF_RND_NEAR);arf_clear(half);}arf_get_fmpz(z,x,ARF_RND_DOWN);acb_set_fmpz(v,z);fmpz_clear(z); }
    } else if(kind==35 && acb_is_real(b) && !acb_contains_zero(b)) {
        acb_t q;acb_init(q);acb_div(q,a,b,p);fmpz_t k;fmpz_init(k);arf_get_fmpz(k,arb_midref(acb_realref(q)),ARF_RND_DOWN);acb_set_fmpz(q,k);acb_mul(q,q,b,p);acb_sub(v,a,q,p);fmpz_clear(k);acb_clear(q);
    } else if(acb_is_int(a)) {
        fmpz_t z,w;fmpz_init(z);fmpz_init(w);arf_get_fmpz(z,x,ARF_RND_DOWN);
        if(kind==17 && fmpz_sgn(z)>=0 && fmpz_cmp_ui(z,100000)<=0){arb_fac_ui(acb_realref(v),fmpz_get_ui(z),p);arb_zero(acb_imagref(v));}
        else if(kind==37)acb_set_si(v,fmpz_is_prime(z));
        else if(kind==36 && acb_is_int(b)){arf_get_fmpz(w,arb_midref(acb_realref(b)),ARF_RND_DOWN);fmpz_gcd(z,z,w);acb_set_fmpz(v,z);}
        fmpz_clear(z);fmpz_clear(w);
    }arf_clear(x);
}
static void evaluate(acb_t v,acb_t derivative,const ce_domain_reference *r,uint32_t j) {
    const ce_domain_program *p=r->program;ce_domain_node n=p->nodes[j];slong prec=r->precision;
    acb_srcptr a=r->anchors+n.a,b=r->anchors+n.b;
    switch(n.op) {
    case DP_Z:acb_set(v,r->current);break;
    case DP_C:acb_set(v,r->parameter);break;
    case DP_CONST:if(n.aux==2)acb_indeterminate(v);else if(n.aux==1)acb_const_pi(v,prec);else exact_complex(v,p->constants[j]);break;
    case DP_ADD:if(n.a==n.b)acb_mul_2exp_si(v,a,1);else acb_add(v,a,b,prec);break;
    case DP_SUB:if(n.a==n.b)acb_zero(v);else acb_sub(v,a,b,prec);break;
    case DP_MUL:if(n.a==n.b)acb_sqr(v,a,prec);else acb_mul(v,a,b,prec);break;
    case DP_DIV:acb_div(v,a,b,prec);break;
    case DP_NEG:acb_neg(v,a);break;
    case DP_CONJ:acb_conj(v,a);break;
    case DP_REAL:acb_set_arb(v,acb_realref(a));break;
    case DP_IMAG:acb_set_arb(v,acb_imagref(a));break;
    case DP_DYADIC:
        acb_mul_2exp_si(v,a,(slong)(n.aux>>2)-1074);
        if(n.aux&1)acb_mul_onei(v,v);
        if(n.aux&2)acb_neg(v,v);
        break;
    case DP_ANALYTIC:
        if(n.aux==DA_SIN)acb_sin_cos(v,derivative,a,prec);
        else if(n.aux==DA_COS){acb_sin_cos(derivative,v,a,prec);acb_neg(derivative,derivative);}
        else analytic(v,n.aux,a,b,prec);
        break;
    case DP_SELECT:acb_set(v,truth(a)?b:r->anchors+n.aux);break;
    case DP_TEST: {
        int t=0;
        if(n.aux==16)t=!truth(a);else if(n.aux==24)t=truth(a);else if(n.aux==42)t=acb_is_finite(a);
        else if(n.aux==18)t=acb_equal(a,b);else if(n.aux==19)t=!acb_equal(a,b);
        else if(acb_is_real(a)&&acb_is_real(b)) {
            if(n.aux==20)t=arb_lt(acb_realref(a),acb_realref(b));
            if(n.aux==21)t=arb_le(acb_realref(a),acb_realref(b));
            if(n.aux==22)t=arb_gt(acb_realref(a),acb_realref(b));
            if(n.aux==23)t=arb_ge(acb_realref(a),acb_realref(b));
        }acb_set_si(v,t);break;
    }
    case DP_INTEGER:integer_op(v,a,b,n.aux,prec);break;
    default:acb_indeterminate(v);
    }
}
uint32_t ce_domain_required_precision(const char *re,const char *im,const char *xs,const char *ys,uint32_t w,uint32_t h) {
    arb_t a,b,x,y;arb_init(a);arb_init(b);arb_init(x);arb_init(y);
    int bad=!w||!h||arb_set_str(a,re,64)||arb_set_str(b,im,64)||arb_set_str(x,xs,64)||arb_set_str(y,ys,64);
    slong bits=128;
    if(!bad&&arb_is_positive(x)&&arb_is_positive(y)) {
        arb_div_ui(x,x,w,64);arb_div_ui(y,y,h,64);
        slong spacing=FLINT_MIN(arf_abs_bound_lt_2exp_si(arb_midref(x)),arf_abs_bound_lt_2exp_si(arb_midref(y)));
        /* arf's zero exponent is a sentinel, not an integer to subtract from.
           A viewport centered at zero has no coordinate absorption to budget. */
        slong center=spacing;
        if(!arf_is_zero(arb_midref(a)))center=FLINT_MAX(center,arf_abs_bound_lt_2exp_si(arb_midref(a)));
        if(!arf_is_zero(arb_midref(b)))center=FLINT_MAX(center,arf_abs_bound_lt_2exp_si(arb_midref(b)));
        bits=FLINT_MAX(128,center-spacing+80);
    }else bits=0;
    arb_clear(a);arb_clear(b);arb_clear(x);arb_clear(y);return bits>16384?0:(uint32_t)bits;
}
ce_domain_reference *ce_domain_reference_create(const ce_domain_program *p,const char *re,const char *im,const char *xs,const char *ys,uint32_t w,uint32_t h,double px,double py,uint32_t precision,uint32_t terms) {
    if(!p || p->error[0] || !w || !h || precision<64 || precision>16384 || terms<4 || terms>64)return NULL;
    ce_domain_program *prog = (ce_domain_program *)p;
    ce_domain_reference *r=calloc(1,sizeof(*r));if(!r)return NULL;
    r->program=p;r->precision=precision;r->terms=terms;
    r->anchors=_acb_vec_init(p->count);r->origin_anchors=_acb_vec_init(p->count);acb_init(r->parameter);acb_init(r->current);acb_init(r->checkpoint);acb_init(r->origin);r->checkpoint_power=1;
    arf_init(r->exp_re);arf_init(r->exp_im);arf_init(r->exp_radius);arf_init(r->exp_t);arf_init(r->exp_rounded);arf_init(r->exp_error);
    acb_init(r->next_v);acb_init(r->next_defect);acb_init(r->next_box);acb_init(r->next_bound);acb_init(r->next_coef);
    arb_init(r->next_radius);arb_init(r->next_inverse);arf_init(r->next_mag);acb_poly_init(r->next_poly);
    uint32_t bs=8;r->header=calloc(bs*6,sizeof(float));r->exp_coefficients=calloc(bs*terms,sizeof(float));
    acb_t point,t;acb_init(point);acb_init(t);
    if(!r->header || !r->exp_coefficients)goto fail;

    if(!prog->vp_valid || prog->vp_prec != (slong)precision || prog->vp_w != w || prog->vp_h != h ||
       prog->vp_re != re || prog->vp_im != im || prog->vp_xs != xs || prog->vp_ys != ys) {
        if(prog->vp_valid) {
            acb_clear(prog->vp_center); acb_clear(prog->vp_stepx); acb_clear(prog->vp_stepy); acb_clear(prog->vp_inv_stepx);
            prog->vp_valid = 0;
        }
        acb_init(prog->vp_center); acb_init(prog->vp_stepx); acb_init(prog->vp_stepy); acb_init(prog->vp_inv_stepx);
        int bad = arb_set_str(acb_realref(prog->vp_center), re, precision) ||
                  arb_set_str(acb_imagref(prog->vp_center), im, precision) ||
                  arb_set_str(acb_realref(prog->vp_stepx), xs, precision) ||
                  arb_set_str(acb_imagref(prog->vp_stepy), ys, precision);
        if(bad || !arb_is_positive(acb_realref(prog->vp_stepx)) || !arb_is_positive(acb_imagref(prog->vp_stepy))) {
            acb_clear(prog->vp_center); acb_clear(prog->vp_stepx); acb_clear(prog->vp_stepy); acb_clear(prog->vp_inv_stepx);
            goto fail;
        }
        acb_div_ui(prog->vp_stepx, prog->vp_stepx, w, precision);
        acb_div_ui(prog->vp_stepy, prog->vp_stepy, h, precision);
        acb_neg(prog->vp_stepy, prog->vp_stepy);
        acb_inv(prog->vp_inv_stepx, prog->vp_stepx, precision);
        acb_mul_2exp_si(prog->vp_inv_stepx, prog->vp_inv_stepx, 1);
        export_ball(r, prog->vp_stepx_ball, prog->vp_stepx);
        export_ball(r, prog->vp_stepy_ball, prog->vp_stepy);
        export_ball(r, prog->vp_inv_stepx_ball, prog->vp_inv_stepx);
        prog->vp_re = re; prog->vp_im = im; prog->vp_xs = xs; prog->vp_ys = ys;
        prog->vp_w = w; prog->vp_h = h; prog->vp_prec = precision;
        prog->vp_valid = 1;
    }

    if(prog->exp_terms != terms || prog->exp_prec != precision || !prog->exp_coeffs) {
        free(prog->exp_coeffs);
        prog->exp_coeffs = calloc(bs * terms, sizeof(float));
        acb_poly_t exponential; acb_poly_init(exponential);
        acb_t zero; acb_init(zero); arb_t one; arb_init(one); arb_one(one);
        series(exponential, DA_EXP, zero, zero, one, terms + 1, precision);
        acb_t tmp; acb_init(tmp);
        for(uint32_t k = 1; k <= terms; ++k) {
            acb_poly_get_coeff_acb(tmp, exponential, k);
            export_ball(r, prog->exp_coeffs + (k - 1) * bs, tmp);
        }
        acb_clear(tmp); acb_poly_clear(exponential); acb_clear(zero); arb_clear(one);
        prog->exp_terms = terms; prog->exp_prec = precision;
    }
    memcpy(r->exp_coefficients, prog->exp_coeffs, bs * terms * sizeof(float));

    arb_set_d(acb_realref(t), px + 0.5 - (double)w / 2);
    acb_mul(point, t, prog->vp_stepx, precision);
    acb_add(point, point, prog->vp_center, precision);
    acb_set_d(t, py + 0.5 - (double)h / 2);
    acb_mul(t, t, prog->vp_stepy, precision);
    acb_add(point, point, t, precision);

    acb_get_mid(r->parameter, point);
    acb_sub(t, point, r->parameter, precision);
    if(p->config.zero_seed)exact_complex(r->current,p->config.chain_seed);else acb_set(r->current,r->parameter);
    acb_set(r->checkpoint,r->current);acb_set(r->origin,r->current);
    arf_t initial_size;arf_init(initial_size);acb_get_abs_ubound_arf(initial_size,r->origin,precision);
    r->range_exponent=2;
    if(!arf_is_zero(initial_size)&&arf_is_finite(initial_size))r->range_exponent=FLINT_MAX(2,arf_abs_bound_lt_2exp_si(initial_size)+1);
    arf_clear(initial_size);
    export_ball(r,r->header,r->parameter);export_ball(r,r->header+bs,t);
    memcpy(r->header+2*bs, prog->vp_stepx_ball, 8*sizeof(float));
    memcpy(r->header+3*bs, prog->vp_stepy_ball, 8*sizeof(float));
    export_ball(r,r->header+4*bs,r->current);
    memcpy(r->header+5*bs, prog->vp_inv_stepx_ball, 8*sizeof(float));

    for(uint32_t j=0;j<p->count;++j)r->stride+=node_floats(p->nodes[j],terms);
    r->stride+=16; // Anchor transition and difference to the shared Brent checkpoint.
    r->origin_data=calloc(r->stride,sizeof(float));
    r->varying=prog->varying;
    if(!r->origin_data||!r->varying)goto fail;

    acb_clear(point);acb_clear(t);return r;
 fail:acb_clear(point);acb_clear(t);ce_domain_reference_free(r);return NULL;
}
void ce_domain_reference_free(ce_domain_reference *r){
    if(r){
        _acb_vec_clear(r->anchors,r->program->count);_acb_vec_clear(r->origin_anchors,r->program->count);
        acb_clear(r->parameter);acb_clear(r->current);acb_clear(r->checkpoint);acb_clear(r->origin);
        arf_clear(r->exp_re);arf_clear(r->exp_im);arf_clear(r->exp_radius);arf_clear(r->exp_t);arf_clear(r->exp_rounded);arf_clear(r->exp_error);
        acb_clear(r->next_v);acb_clear(r->next_defect);acb_clear(r->next_box);acb_clear(r->next_bound);acb_clear(r->next_coef);
        arb_clear(r->next_radius);arb_clear(r->next_inverse);arf_clear(r->next_mag);acb_poly_clear(r->next_poly);
        free(r->header);free(r->data);free(r->exp_coefficients);free(r->origin_data);free(r);
    }
}
const float *ce_domain_reference_header(const ce_domain_reference *r){return r?r->header:NULL;}
const float *ce_domain_reference_coefficients(const ce_domain_reference *r){return r?r->exp_coefficients:NULL;}
uint32_t ce_domain_reference_stride(const ce_domain_reference *r){return r?r->stride:0;}
const float *ce_domain_reference_next(ce_domain_reference *r,uint32_t count) {
    if(!r || !count || count>64)return NULL;
    size_t needed=(size_t)r->stride*count;
    if(needed>64000000)return NULL;
    if(needed>r->capacity){float *d=realloc(r->data,needed*sizeof(float));if(!d)return NULL;r->data=d;r->capacity=needed;}
    memset(r->data,0,needed*sizeof(float));uint32_t bs=8;slong prec=r->precision;
    acb_ptr v=r->next_v,box=r->next_box,bound=r->next_bound,coef=r->next_coef;
    arb_ptr radius=r->next_radius,inverse=r->next_inverse;arf_ptr mag=r->next_mag;acb_poly_struct *poly=r->next_poly;
    for(uint32_t it=0;it<count;++it) {
        float *d=r->data+(size_t)it*r->stride;
        /* Recentering returns to the exact initial origin. Reuse only
           that identical reference evaluation, never a nearby sample orbit.
           Checkpoint updates below still run for every requested iteration. */
        if(r->iteration && acb_equal(r->current,r->origin)) {
            memcpy(d,r->origin_data,(r->stride-16)*sizeof(float));d+=r->stride-16;
            _acb_vec_set(r->anchors,r->origin_anchors,r->program->count);
        }else{
            for(uint32_t j=0;j<r->program->count;++j) {
                ce_domain_node node=r->program->nodes[j];
                uint32_t length=node_floats(node,r->terms);
                if(r->iteration&&!r->varying[j]) {
                    memcpy(d,r->origin_data+(d-(r->data+(size_t)it*r->stride)),length*sizeof(float));
                    d+=length;continue;
                }
                evaluate(v,coef,r,j);
                acb_get_mid(r->anchors+j,v);
                export_ball(r,d,r->anchors+j);
                export_defect(r,d+bs,v);
                d+=2*bs;
                if(node.op==DP_SELECT){
                    acb_sub(coef,r->anchors+node.b,r->anchors+j,prec);export_ball(r,d,coef);
                    acb_sub(coef,r->anchors+node.aux,r->anchors+j,prec);export_ball(r,d+8,coef);d+=16;
                }
                if(node.op!=DP_ANALYTIC)continue;
                if(node.aux==DA_EXP||node.aux==DA_INV)continue;
                acb_srcptr a=r->anchors+node.a,b=r->anchors+node.b;
                if(node.aux==DA_SIN||node.aux==DA_COS) {
                    export_ball(r,d,coef);d+=8;continue;
                }
                /* A local library series is usable only with an analytic disk and
                   a Cauchy remainder. The outer chain is never approximated. */
                acb_abs(radius,a,prec);arb_add_ui(radius,radius,1,prec);arb_mul_2exp_si(radius,radius,-1);slong rb=arf_abs_bound_lt_2exp_si(arb_midref(radius));arb_one(radius);arb_mul_2exp_si(radius,radius,rb-1);
                int usable=acb_is_finite(v);
                for(uint32_t attempt=0;usable && attempt<64;++attempt) {
                    acb_set(box,a);arb_add_error(acb_realref(box),radius);arb_add_error(acb_imagref(box),radius);
                    analytic(bound,node.aux,box,b,prec);
                    if(acb_is_finite(bound) && analytic_disk(node.aux,a,b,radius,prec))break;
                    arb_mul_2exp_si(radius,radius,-1);if(attempt==63)usable=0;
                }
                if(usable)series(poly,node.aux,a,b,radius,r->terms+1,prec);
                if(usable) {
                    for(uint32_t k=1;k<=r->terms;++k){acb_poly_get_coeff_acb(coef,poly,k);if(!acb_is_finite(coef))usable=0;export_ball(r,d+(k-1)*bs,coef);}
                    /* A common coefficient scale permits bounded Horner work on
                       GPU mantissas without renormalizing every intermediate. */
                    float coefficient_exponent=-1000000;
                    for(uint32_t k=0;k<r->terms;++k) {
                        float *c=d+k*bs;
                        if(c[0]!=0 || c[1]!=0 || c[3]!=0)coefficient_exponent=fmaxf(coefficient_exponent,c[2]);
                        c[6]=coefficient_exponent;
                    }
                    arb_inv(inverse,radius,prec);arb_get_abs_ubound_arf(mag,inverse,prec);arb_set_arf(acb_realref(coef),mag);arb_zero(acb_imagref(coef));export_ball(r,d+r->terms*bs,coef);
                    acb_get_abs_ubound_arf(mag,bound,prec);arb_set_arf(acb_realref(coef),mag);arb_zero(acb_imagref(coef));export_ball(r,d+r->terms*bs+8,coef);
                }
                d[r->terms*bs+16]=usable?1:0;
                d+=r->terms*bs+20;
            }
            if(!r->iteration) {
                memcpy(r->origin_data,r->data+(size_t)it*r->stride,(r->stride-16)*sizeof(float));
                _acb_vec_set(r->origin_anchors,r->anchors,r->program->count);
            }
        }
        acb_set(r->current,r->anchors+r->program->output);
        /* The reference is a numerical origin, not a sample classification.
           Recenter large origins before they diverge beyond the delta range.
           Export the exact shift so every sample retains its actual trajectory. */
        acb_get_abs_ubound_arf(mag,r->current,prec);
        if(arf_cmp_2exp_si(mag,r->range_exponent)>0) {
            acb_set(r->current,r->origin);
            acb_sub(coef,r->anchors+r->program->output,r->current,prec);
            export_ball(r,d,coef);
        } else {
            memset(d,0,8*sizeof(float));
        }
        if(acb_equal(r->current,r->checkpoint)) {
            memset(d+8,0,8*sizeof(float));
        } else {
            acb_sub(coef,r->current,r->checkpoint,prec);
            export_ball(r,d+8,coef);
        }
        if(++r->checkpoint_age==r->checkpoint_power){acb_set(r->checkpoint,r->current);r->checkpoint_age=0;r->checkpoint_power*=2;}
        r->iteration++;
    }
    return r->data;
}
