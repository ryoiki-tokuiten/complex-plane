#ifndef CE_DOMAIN_REFERENCE_H
#define CE_DOMAIN_REFERENCE_H
#include "domain_program.h"
uint32_t ce_domain_required_precision(const char *,const char *,const char *,const char *,uint32_t,uint32_t);
typedef struct ce_domain_reference ce_domain_reference;
ce_domain_reference *ce_domain_reference_create(const ce_domain_program *,const char *,const char *,const char *,const char *,uint32_t,uint32_t,double,double,uint32_t,uint32_t);
void ce_domain_reference_free(ce_domain_reference *);
const float *ce_domain_reference_header(const ce_domain_reference *);
const float *ce_domain_reference_coefficients(const ce_domain_reference *);
uint32_t ce_domain_reference_stride(const ce_domain_reference *);
const float *ce_domain_reference_next(ce_domain_reference *,uint32_t);
#endif
