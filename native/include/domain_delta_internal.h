#ifndef CE_DOMAIN_DELTA_INTERNAL_H
#define CE_DOMAIN_DELTA_INTERNAL_H

#include "complex_engine.h"

typedef struct {
    ce_complex anchor;
    ce_complex offset;
} ce_delta_pair;

typedef struct {
    ce_delta_pair numerator;
    ce_delta_pair denominator;
    int valid;
} ce_sphere_delta;

ce_sphere_delta ce_delta_affine(ce_complex anchor, ce_complex offset);
ce_sphere_delta ce_delta_map_step(const ce_map_config *config,
                                  ce_sphere_delta current,
                                  ce_sphere_delta parameter);
int ce_delta_normalize(ce_sphere_delta *value);
int ce_delta_actual(const ce_sphere_delta *value, ce_complex *actual);
int ce_delta_log_polar(const ce_sphere_delta *value, double *phase, double *log_magnitude);

#endif
