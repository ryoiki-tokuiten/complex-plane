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
    acb_ptr anchors;
    acb_t parameter,current,checkpoint,origin;
    float *header,*data,*exp_coefficients;
    size_t capacity;
};
static void exact_complex(acb_t z,ce_complex v){arb_set_d(acb_realref(z),v.re);arb_set_d(acb_imagref(z),v.im);}
static void export_ball(float *out,const acb_t z) {
    memset(out,0,8*sizeof(float));
    if(!acb_is_finite(z)){out[2]=2000000;return;}
    if(acb_is_zero(z))return;
    arf_t re,im,radius,t,rounded,error;arf_init(re);arf_init(im);arf_init(radius);arf_init(t);arf_init(rounded);arf_init(error);
    arf_set(re,arb_midref(acb_realref(z)));arf_set(im,arb_midref(acb_imagref(z)));
    arf_set_mag(radius,arb_radref(acb_realref(z)));arf_set_mag(t,arb_radref(acb_imagref(z)));arf_add(radius,radius,t,64,ARF_RND_UP);
    slong e=ARF_PREC_EXACT;
    if(!arf_is_zero(re))e=arf_abs_bound_lt_2exp_si(re);
    if(!arf_is_zero(im))e=e==ARF_PREC_EXACT?arf_abs_bound_lt_2exp_si(im):FLINT_MAX(e,arf_abs_bound_lt_2exp_si(im));
    if(!arf_is_zero(radius))e=e==ARF_PREC_EXACT?arf_abs_bound_lt_2exp_si(radius):FLINT_MAX(e,arf_abs_bound_lt_2exp_si(radius));
    if(e < -1000000 || e > 1000000){out[2]=2000000;goto done;}
    arf_mul_2exp_si(re,re,-e);arf_mul_2exp_si(im,im,-e);arf_mul_2exp_si(radius,radius,-e);
    for(int component=0;component<2;++component) {
        arf_srcptr value=component?im:re;
        double d=arf_get_d(value,ARF_RND_NEAR);
        out[component]=fabs(d)<0x1p-120?0:(float)d;
        arf_set_d(rounded,out[component]);
        /* An exact subtraction is required before taking the absolute error. */
        arf_sub(error,value,rounded,ARF_PREC_EXACT,ARF_RND_NEAR);
        double residual=arf_get_d(error,ARF_RND_NEAR);
        out[4+component]=fabs(residual)<0x1p-120?0:(float)residual;
        arf_set_d(rounded,out[4+component]);
        arf_sub(error,error,rounded,ARF_PREC_EXACT,ARF_RND_NEAR);arf_abs(error,error);
        arf_add(radius,radius,error,64,ARF_RND_UP);
    }
    out[2]=(float)e;
    if(!arf_is_zero(radius))out[3]=nextafterf(fmaxf(0x1p-120f,(float)arf_get_d(radius,ARF_RND_UP)),INFINITY);
 done:arf_clear(re);arf_clear(im);arf_clear(radius);arf_clear(t);arf_clear(rounded);arf_clear(error);
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
    case DA_INV:acb_poly_inv_series(out,input,n,p);break;
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
static void evaluate(acb_t v,const ce_domain_reference *r,uint32_t j) {
    const ce_domain_program *p=r->program;ce_domain_node n=p->nodes[j];slong prec=r->precision;
    acb_srcptr a=r->anchors+n.a,b=r->anchors+n.b;
    switch(n.op) {
    case DP_Z:acb_set(v,r->current);break;
    case DP_C:acb_set(v,r->parameter);break;
    case DP_CONST:if(n.aux==2)acb_indeterminate(v);else if(n.aux==1)acb_const_pi(v,prec);else exact_complex(v,p->constants[j]);break;
    case DP_ADD:acb_add(v,a,b,prec);break;
    case DP_SUB:acb_sub(v,a,b,prec);break;
    case DP_MUL:acb_mul(v,a,b,prec);break;
    case DP_NEG:acb_neg(v,a);break;
    case DP_CONJ:acb_conj(v,a);break;
    case DP_REAL:acb_set_arb(v,acb_realref(a));break;
    case DP_IMAG:acb_set_arb(v,acb_imagref(a));break;
    case DP_ANALYTIC:analytic(v,n.aux,a,b,prec);break;
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
        slong center=FLINT_MAX(arf_abs_bound_lt_2exp_si(arb_midref(a)),arf_abs_bound_lt_2exp_si(arb_midref(b)));
        arb_div_ui(x,x,w,64);arb_div_ui(y,y,h,64);
        slong spacing=FLINT_MIN(arf_abs_bound_lt_2exp_si(arb_midref(x)),arf_abs_bound_lt_2exp_si(arb_midref(y)));
        bits=FLINT_MAX(128,center-spacing+80);
    }else bits=0;
    arb_clear(a);arb_clear(b);arb_clear(x);arb_clear(y);return bits>16384?0:(uint32_t)bits;
}
ce_domain_reference *ce_domain_reference_create(const ce_domain_program *p,const char *re,const char *im,const char *xs,const char *ys,uint32_t w,uint32_t h,double px,double py,uint32_t precision,uint32_t terms) {
    if(!p || p->error[0] || !w || !h || precision<64 || precision>16384 || terms<4 || terms>64)return NULL;
    ce_domain_reference *r=calloc(1,sizeof(*r));if(!r)return NULL;
    r->program=p;r->precision=precision;r->terms=terms;
    r->anchors=_acb_vec_init(p->count);acb_init(r->parameter);acb_init(r->current);acb_init(r->checkpoint);acb_init(r->origin);r->checkpoint_power=1;
    uint32_t bs=8;r->header=calloc(bs*6,sizeof(float));r->exp_coefficients=calloc(bs*terms,sizeof(float));
    acb_t point,stepx,stepy,t;acb_init(point);acb_init(stepx);acb_init(stepy);acb_init(t);
    int bad=arb_set_str(acb_realref(point),re,precision)||arb_set_str(acb_imagref(point),im,precision)||arb_set_str(acb_realref(stepx),xs,precision)||arb_set_str(acb_imagref(stepy),ys,precision);
    if(bad || !arb_is_positive(acb_realref(stepx)) || !arb_is_positive(acb_imagref(stepy)) || !r->header || !r->exp_coefficients)goto fail;
    acb_div_ui(stepx,stepx,w,precision);acb_div_ui(stepy,stepy,h,precision);acb_neg(stepy,stepy);
    arb_set_d(acb_realref(t),px+0.5-(double)w/2);acb_mul(t,t,stepx,precision);acb_add(point,point,t,precision);
    acb_set_d(t,py+0.5-(double)h/2);acb_mul(t,t,stepy,precision);acb_add(point,point,t,precision);
    acb_get_mid(r->parameter,point);acb_sub(t,point,r->parameter,precision);
    if(p->config.zero_seed)exact_complex(r->current,p->config.chain_seed);else acb_set(r->current,r->parameter);
    acb_set(r->checkpoint,r->current);acb_set(r->origin,r->current);
    arf_t initial_size;arf_init(initial_size);acb_get_abs_ubound_arf(initial_size,r->origin,precision);
    r->range_exponent=2;
    if(!arf_is_zero(initial_size)&&arf_is_finite(initial_size))r->range_exponent=FLINT_MAX(2,arf_abs_bound_lt_2exp_si(initial_size)+1);
    arf_clear(initial_size);
    export_ball(r->header,r->parameter);export_ball(r->header+bs,t);
    export_ball(r->header+2*bs,stepx);export_ball(r->header+3*bs,stepy);export_ball(r->header+4*bs,r->current);
    acb_inv(t,stepx,precision);acb_mul_2exp_si(t,t,1);export_ball(r->header+5*bs,t);
    acb_poly_t exponential;acb_poly_init(exponential);acb_t zero;acb_init(zero);arb_t one;arb_init(one);arb_one(one);
    series(exponential,DA_EXP,zero,zero,one,terms+1,precision);
    for(uint32_t k=1;k<=terms;++k){acb_poly_get_coeff_acb(t,exponential,k);export_ball(r->exp_coefficients+(k-1)*bs,t);}
    acb_poly_clear(exponential);acb_clear(zero);arb_clear(one);
    for(uint32_t j=0;j<p->count;++j)r->stride+=2*bs+((p->nodes[j].op==DP_ANALYTIC&&p->nodes[j].aux!=DA_EXP&&p->nodes[j].aux!=DA_INV)?terms*bs+20:p->nodes[j].op==DP_SELECT?16:0);
    r->stride+=16; // Anchor transition and difference to the shared Brent checkpoint.
    acb_clear(point);acb_clear(stepx);acb_clear(stepy);acb_clear(t);return r;
 fail:acb_clear(point);acb_clear(stepx);acb_clear(stepy);acb_clear(t);ce_domain_reference_free(r);return NULL;
}
void ce_domain_reference_free(ce_domain_reference *r){if(r){_acb_vec_clear(r->anchors,r->program->count);acb_clear(r->parameter);acb_clear(r->current);acb_clear(r->checkpoint);acb_clear(r->origin);free(r->header);free(r->data);free(r->exp_coefficients);free(r);}}
const float *ce_domain_reference_header(const ce_domain_reference *r){return r?r->header:NULL;}
const float *ce_domain_reference_coefficients(const ce_domain_reference *r){return r?r->exp_coefficients:NULL;}
uint32_t ce_domain_reference_stride(const ce_domain_reference *r){return r?r->stride:0;}
const float *ce_domain_reference_next(ce_domain_reference *r,uint32_t count) {
    if(!r || !count || count>64)return NULL;
    size_t needed=(size_t)r->stride*count;
    if(needed>64000000)return NULL;
    if(needed>r->capacity){float *d=realloc(r->data,needed*sizeof(float));if(!d)return NULL;r->data=d;r->capacity=needed;}
    memset(r->data,0,needed*sizeof(float));uint32_t bs=8;slong prec=r->precision;
    acb_t v,defect,box,bound,coef;acb_init(v);acb_init(defect);acb_init(box);acb_init(bound);acb_init(coef);
    arb_t radius,inverse;arb_init(radius);arb_init(inverse);arf_t mag;arf_init(mag);acb_poly_t poly;acb_poly_init(poly);
    for(uint32_t it=0;it<count;++it) {
        float *d=r->data+(size_t)it*r->stride;
        for(uint32_t j=0;j<r->program->count;++j) {
            ce_domain_node node=r->program->nodes[j];evaluate(v,r,j);
            acb_get_mid(r->anchors+j,v);acb_sub(defect,v,r->anchors+j,prec);
            export_ball(d,r->anchors+j);export_ball(d+bs,defect);d+=2*bs;
            if(node.op==DP_SELECT){
                acb_sub(coef,r->anchors+node.b,r->anchors+j,prec);export_ball(d,coef);
                acb_sub(coef,r->anchors+node.aux,r->anchors+j,prec);export_ball(d+8,coef);d+=16;
            }
            if(node.op!=DP_ANALYTIC)continue;
            if(node.aux==DA_EXP||node.aux==DA_INV)continue;
            acb_srcptr a=r->anchors+node.a,b=r->anchors+node.b;
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
                for(uint32_t k=1;k<=r->terms;++k){acb_poly_get_coeff_acb(coef,poly,k);if(!acb_is_finite(coef))usable=0;export_ball(d+(k-1)*bs,coef);}
                arb_inv(inverse,radius,prec);arb_get_abs_ubound_arf(mag,inverse,prec);arb_set_arf(acb_realref(coef),mag);arb_zero(acb_imagref(coef));export_ball(d+r->terms*bs,coef);
                acb_get_abs_ubound_arf(mag,bound,prec);arb_set_arf(acb_realref(coef),mag);arb_zero(acb_imagref(coef));export_ball(d+r->terms*bs+8,coef);
            }
            d[r->terms*bs+16]=usable?1:0;
            d+=r->terms*bs+20;
        }
        acb_set(r->current,r->anchors+r->program->output);
        /* The reference is a numerical origin, not a sample classification.
           Recenter large origins before they diverge beyond the delta range.
           Export the exact shift so every sample retains its actual trajectory. */
        acb_get_abs_ubound_arf(mag,r->current,prec);
        if(arf_cmp_2exp_si(mag,r->range_exponent)>0)acb_set(r->current,r->origin);
        acb_sub(coef,r->anchors+r->program->output,r->current,prec);export_ball(d,coef);
        acb_sub(coef,r->current,r->checkpoint,prec);export_ball(d+8,coef);
        if(++r->checkpoint_age==r->checkpoint_power){acb_set(r->checkpoint,r->current);r->checkpoint_age=0;r->checkpoint_power*=2;}
        r->iteration++;
    }
    acb_clear(v);acb_clear(defect);acb_clear(box);acb_clear(bound);acb_clear(coef);arb_clear(radius);arb_clear(inverse);arf_clear(mag);acb_poly_clear(poly);return r->data;
}
