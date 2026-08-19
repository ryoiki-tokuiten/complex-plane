#ifndef DOMAIN_INTERNAL_H
#define DOMAIN_INTERNAL_H

#include "complex_engine.h"

ce_complex ce_domain_step(const ce_map_config *config, ce_complex current, ce_complex c);
int ce_domain_valid(ce_complex value);
int ce_domain_bailout(ce_complex value);
double ce_domain_smooth_iteration(uint32_t iteration, uint32_t count, ce_complex value);
uint8_t ce_domain_byte(double value);
void ce_domain_color(ce_complex value, const ce_complex *palette_rg, const double *palette_b,
                     uint32_t palette_count, double brightness, double contrast,
                     double saturation, double cycles,
                     double *red, double *green, double *blue);
void ce_domain_event_color(ce_complex value, double intensity, int use_phase,
                           const ce_complex *palette_rg, const double *palette_b,
                           uint32_t palette_count, double brightness, double contrast,
                           double saturation, double *red, double *green, double *blue);

#endif
