#ifndef DOMAIN_INTERNAL_H
#define DOMAIN_INTERNAL_H

#include "complex_engine.h"

int ce_domain_valid(ce_complex value);
int ce_domain_bailout(ce_complex value);
double ce_domain_smooth_iteration(uint32_t iteration, uint32_t count, ce_complex value);
uint8_t ce_domain_byte(double value);
int32_t ce_domain_color_points(const ce_complex *values, const uint8_t *valid, uint32_t count,
                               const ce_complex *palette_rg, const double *palette_b,
                               uint32_t palette_count, double brightness, double contrast,
                               double saturation, double cycles, uint8_t *rgba);
void ce_domain_color(ce_complex value, const ce_complex *palette_rg, const double *palette_b,
                     uint32_t palette_count, double brightness, double contrast,
                     double saturation, double cycles,
                     double *red, double *green, double *blue);
void ce_domain_color_log_polar(double phase, double log_magnitude,
                               const ce_complex *palette_rg, const double *palette_b,
                               uint32_t palette_count, double brightness, double contrast,
                               double saturation, double cycles,
                               double *red, double *green, double *blue);
void ce_domain_event_color(ce_complex value, double intensity, int use_phase,
                           const ce_complex *palette_rg, const double *palette_b,
                           uint32_t palette_count, double brightness, double contrast,
                           double saturation, double *red, double *green, double *blue);

#endif
