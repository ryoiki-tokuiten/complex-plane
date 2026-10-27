#ifndef PRECISION_INTERNAL_H
#define PRECISION_INTERNAL_H

#include "complex_engine.h"

void *ce_precision_image_context_create(const ce_map_config *config,
                                        double source_center_re, double source_center_im,
                                        double source_width, double source_height,
                                        const char *view_center_re, const char *view_center_im,
                                        double zoom_power, uint32_t precision_bits,
                                        uint32_t view_width, uint32_t view_height);
int ce_precision_image_sample(void *opaque, double u, double v, double *x, double *y);
void ce_precision_image_context_destroy(void *opaque);

#endif
