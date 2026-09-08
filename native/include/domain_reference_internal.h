#ifndef CE_DOMAIN_REFERENCE_INTERNAL_H
#define CE_DOMAIN_REFERENCE_INTERNAL_H
#include "domain_program.h"
struct ce_domain_program {
    ce_map_config config;
    ce_domain_node *nodes;
    ce_complex *constants;
    uint32_t count, output;
    char error[160];
};
#endif
