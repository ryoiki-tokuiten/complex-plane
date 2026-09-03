#ifndef CE_EXPRESSION_INTERNAL_H
#define CE_EXPRESSION_INTERNAL_H

#include "complex_engine.h"

int ce_evaluate_expression_one(const ce_map_config *map_config,
                               const ce_expression_instruction *program,
                               uint32_t instruction_count,
                               const ce_complex *variables,
                               uint32_t variable_count, int32_t sheet,
                               ce_complex *result, uint8_t *error);

#endif
