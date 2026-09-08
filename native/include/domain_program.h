#ifndef CE_DOMAIN_PROGRAM_H
#define CE_DOMAIN_PROGRAM_H
#include "complex_engine.h"
/* One SSA program for all planar domain maps. No named orbit kernels. */
enum { DP_Z, DP_C, DP_CONST, DP_ADD, DP_SUB, DP_MUL, DP_NEG, DP_CONJ,
       DP_REAL, DP_IMAG, DP_ANALYTIC, DP_SELECT, DP_TEST, DP_INTEGER };
enum { DA_EXP = 2, DA_LOG, DA_SQRT, DA_GAMMA, DA_ZETA, DA_BESSEL, DA_INV };
typedef struct { uint32_t op, a, b, aux; } ce_domain_node;
typedef struct ce_domain_program ce_domain_program;
ce_domain_program *ce_domain_compile(const ce_map_config *config);
void ce_domain_program_free(ce_domain_program *program);
const ce_domain_node *ce_domain_nodes(const ce_domain_program *program);
uint32_t ce_domain_node_count(const ce_domain_program *program);
uint32_t ce_domain_output(const ce_domain_program *program);
const char *ce_domain_error(const ce_domain_program *program);
#endif
