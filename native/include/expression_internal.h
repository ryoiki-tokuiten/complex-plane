#ifndef CE_EXPRESSION_INTERNAL_H
#define CE_EXPRESSION_INTERNAL_H

#include "complex_engine.h"

#define CE_EXPR_EPSILON 1e-12
#define CE_EXPR_STACK_LIMIT 256

enum expression_opcode {
    EXPR_CONST = 0,
    EXPR_Z = 1,
    EXPR_C = 2,
    EXPR_ADD = 3,
    EXPR_SUB = 4, /* argument=1 proves identical operand syntax; both still execute. */
    EXPR_MUL = 5,
    EXPR_DIV = 6,
    EXPR_POW = 7,
    EXPR_NEGATE = 8,
    EXPR_CALL = 9,
    EXPR_CONJUGATE = 10,
    EXPR_ABS = 11,
    EXPR_ARG = 12,
    EXPR_REAL = 13,
    EXPR_IMAGINARY = 14,
    EXPR_VARIABLE = 15,
    EXPR_NOT = 16,
    EXPR_FACTORIAL = 17,
    EXPR_EQUAL = 18,
    EXPR_NOT_EQUAL = 19,
    EXPR_LESS = 20,
    EXPR_LESS_EQUAL = 21,
    EXPR_GREATER = 22,
    EXPR_GREATER_EQUAL = 23,
    EXPR_TRUTH = 24,
    EXPR_JUMP_FALSE = 25,
    EXPR_JUMP_TRUE = 26,
    EXPR_JUMP = 27,
    EXPR_FLOOR = 28,
    EXPR_CEIL = 29,
    EXPR_ROUND = 30,
    EXPR_TRUNC = 31,
    EXPR_SIGN = 32,
    EXPR_MIN = 33,
    EXPR_MAX = 34,
    EXPR_MOD = 35,
    EXPR_GCD = 36,
    EXPR_IS_PRIME = 37,
    EXPR_COMPLEX = 38,
    EXPR_BESSEL = 39,
    EXPR_SELECTED = 40,
    EXPR_SQRT = 41
};

enum expression_error {
    EXPR_ERROR_NONE = 0,
    EXPR_ERROR_PROGRAM = 1,
    EXPR_ERROR_DIVISION_ZERO = 2,
    EXPR_ERROR_REAL = 3,
    EXPR_ERROR_INTEGER = 4,
    EXPR_ERROR_SAFE_INTEGER = 5,
    EXPR_ERROR_FACTORIAL_NEGATIVE = 6,
    EXPR_ERROR_FACTORIAL_LARGE = 7,
    EXPR_ERROR_MOD_ZERO = 8,
    EXPR_ERROR_RESULT = 9
};

int ce_evaluate_expression_one(const ce_map_config *map_config,
                               const ce_expression_instruction *program,
                               uint32_t instruction_count,
                               const ce_complex *variables,
                               uint32_t variable_count, int32_t sheet,
                               ce_complex *result, uint8_t *error);

#endif
