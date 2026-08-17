#include "complex_engine.h"
#include "expression_internal.h"

#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#define CE_EXPR_EPSILON 1e-12
#define CE_EXPR_STACK_LIMIT 256

enum expression_opcode {
    EXPR_CONST = 0,
    EXPR_Z = 1,
    EXPR_C = 2,
    EXPR_ADD = 3,
    EXPR_SUB = 4,
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

static ce_complex make_complex(double re, double im) {
    const ce_complex result = {re, im};
    return result;
}

static int truthy(ce_complex value) {
    return isfinite(value.re) && isfinite(value.im) &&
        (fabs(value.re) > CE_EXPR_EPSILON || fabs(value.im) > CE_EXPR_EPSILON);
}

static int real_value(ce_complex value, double *result, uint8_t *error) {
    if (!isfinite(value.re) || !isfinite(value.im) || fabs(value.im) > CE_EXPR_EPSILON) {
        *error = EXPR_ERROR_REAL;
        return 0;
    }
    *result = value.re;
    return 1;
}

static int integer_value(ce_complex value, int64_t *result, uint8_t *error) {
    double real;
    if (!real_value(value, &real, error)) return 0;
    if (floor(real) != real) {
        *error = EXPR_ERROR_INTEGER;
        return 0;
    }
    if (fabs(real) > 9007199254740991.0) {
        *error = EXPR_ERROR_SAFE_INTEGER;
        return 0;
    }
    *result = (int64_t)real;
    return 1;
}

static int prime_integer(int64_t value) {
    if (value < 2) return 0;
    if (value == 2 || value == 3) return 1;
    if (!(value & 1) || value % 3 == 0) return 0;
    for (int64_t divisor = 5, step = 2; divisor <= value / divisor; divisor += step, step = 6 - step) {
        if (value % divisor == 0) return 0;
    }
    return 1;
}

static ce_complex exponential(ce_complex value) {
    return ce_pow(make_complex(2.71828182845904523536, 0.0), value);
}

static ce_complex evaluate_on_sheet(uint32_t function_id, ce_complex value, int32_t sheet,
                                    const ce_function_config *config) {
    ce_complex principal = ce_eval_function(function_id, value, value, config);
    if (!sheet) return principal;
    const double two_pi_sheet = 6.28318530717958647693 * sheet;
    if (function_id == CE_FN_LN) {
        const ce_complex denominator = make_complex(
            log(hypot(config->log_base.re, config->log_base.im)),
            atan2(config->log_base.im, config->log_base.re)
        );
        return ce_add(principal, ce_div(make_complex(0.0, two_pi_sheet), denominator));
    }
    if (function_id == CE_FN_POWER) {
        const ce_complex multiplier = exponential(make_complex(0.0, two_pi_sheet * config->fractional_power));
        return ce_mul(principal, multiplier);
    }
    if (function_id == CE_FN_ASIN) {
        const double sign = llabs((long long)sheet) & 1ll ? -1.0 : 1.0;
        return make_complex(sheet * 3.14159265358979323846 + sign * principal.re, sign * principal.im);
    }
    if (function_id == CE_FN_ATAN) {
        principal.re += sheet * 3.14159265358979323846;
        return principal;
    }
    if (function_id == CE_FN_LOG_GAMMA) {
        principal.im += two_pi_sheet;
        return principal;
    }
    if (function_id == CE_FN_BESSEL) {
        const ce_complex multiplier = exponential(make_complex(
            -two_pi_sheet * config->bessel_order.im,
            two_pi_sheet * config->bessel_order.re
        ));
        return ce_mul(principal, multiplier);
    }
    return principal;
}

int ce_evaluate_expression_one(const ce_map_config *map_config,
                               const ce_expression_instruction *program,
                               uint32_t instruction_count,
                               const ce_complex *variables, uint32_t variable_count,
                               int32_t sheet, ce_complex *result, uint8_t *error) {
    ce_complex stack[CE_EXPR_STACK_LIMIT];
    uint32_t size = 0;
    uint32_t pc = 0;
    *error = EXPR_ERROR_NONE;
    while (pc < instruction_count) {
        const ce_expression_instruction instruction = program[pc++];
        ce_complex left, right;
        double real;
        int64_t integer;
        switch (instruction.opcode) {
            case EXPR_CONST:
                if (size == CE_EXPR_STACK_LIMIT) goto program_error;
                stack[size++] = instruction.value;
                break;
            case EXPR_Z:
            case EXPR_C:
            case EXPR_VARIABLE:
                if (size == CE_EXPR_STACK_LIMIT || instruction.argument >= variable_count) goto program_error;
                stack[size++] = variables[instruction.argument];
                break;
            case EXPR_NEGATE:
                if (!size) goto program_error;
                stack[size - 1].re = -stack[size - 1].re;
                stack[size - 1].im = -stack[size - 1].im;
                break;
            case EXPR_NOT:
                if (!size) goto program_error;
                stack[size - 1] = make_complex(truthy(stack[size - 1]) ? 0.0 : 1.0, 0.0);
                break;
            case EXPR_TRUTH:
                if (!size) goto program_error;
                stack[size - 1] = make_complex(truthy(stack[size - 1]) ? 1.0 : 0.0, 0.0);
                break;
            case EXPR_CONJUGATE:
                if (!size) goto program_error;
                stack[size - 1].im = -stack[size - 1].im;
                break;
            case EXPR_ABS:
                if (!size) goto program_error;
                stack[size - 1] = make_complex(hypot(stack[size - 1].re, stack[size - 1].im), 0.0);
                break;
            case EXPR_ARG:
                if (!size) goto program_error;
                stack[size - 1] = make_complex(atan2(stack[size - 1].im, stack[size - 1].re), 0.0);
                break;
            case EXPR_REAL:
                if (!size) goto program_error;
                stack[size - 1].im = 0.0;
                break;
            case EXPR_IMAGINARY:
                if (!size) goto program_error;
                stack[size - 1] = make_complex(stack[size - 1].im, 0.0);
                break;
            case EXPR_FACTORIAL: {
                if (!size || !integer_value(stack[size - 1], &integer, error)) return 0;
                if (integer < 0) { *error = EXPR_ERROR_FACTORIAL_NEGATIVE; return 0; }
                if (integer > 170) { *error = EXPR_ERROR_FACTORIAL_LARGE; return 0; }
                double value = 1.0;
                for (int64_t n = 2; n <= integer; ++n) value *= (double)n;
                stack[size - 1] = make_complex(value, 0.0);
                break;
            }
            case EXPR_FLOOR:
            case EXPR_CEIL:
            case EXPR_ROUND:
            case EXPR_TRUNC:
            case EXPR_SIGN:
                if (!size || !real_value(stack[size - 1], &real, error)) return 0;
                if (instruction.opcode == EXPR_FLOOR) real = floor(real);
                else if (instruction.opcode == EXPR_CEIL) real = ceil(real);
                else if (instruction.opcode == EXPR_ROUND) real = floor(real + 0.5);
                else if (instruction.opcode == EXPR_TRUNC) real = trunc(real);
                else real = real > 0.0 ? 1.0 : real < 0.0 ? -1.0 : real;
                stack[size - 1] = make_complex(real, 0.0);
                break;
            case EXPR_CALL:
                if (!size || instruction.argument == CE_FN_ALGEBRAIC) goto program_error;
                stack[size - 1] = evaluate_on_sheet(
                    instruction.argument, stack[size - 1], sheet, &map_config->function
                );
                break;
            case EXPR_SQRT:
                if (!size) goto program_error;
                stack[size - 1] = ce_mul(
                    ce_pow(stack[size - 1], make_complex(0.5, 0.0)),
                    exponential(make_complex(0.0, 3.14159265358979323846 * sheet))
                );
                break;
            case EXPR_SELECTED: {
                if (!size) goto program_error;
                ce_complex selected;
                uint8_t valid = 0;
                if (ce_evaluate_points(map_config, &stack[size - 1], 1, &selected, &valid) != 0 || !valid) {
                    *error = EXPR_ERROR_RESULT;
                    return 0;
                }
                stack[size - 1] = selected;
                break;
            }
            case EXPR_BESSEL: {
                if (size < 2) goto program_error;
                right = stack[--size];
                ce_function_config local = map_config->function;
                local.bessel_order = stack[size - 1];
                stack[size - 1] = ce_eval_function(CE_FN_BESSEL, right, right, &local);
                break;
            }
            case EXPR_COMPLEX:
                if (!instruction.argument || instruction.argument > 2 || size < instruction.argument) goto program_error;
                if (instruction.argument == 1) {
                    if (!real_value(stack[size - 1], &real, error)) return 0;
                    stack[size - 1] = make_complex(real, 0.0);
                } else {
                    right = stack[--size];
                    left = stack[size - 1];
                    double imaginary;
                    if (!real_value(left, &real, error) || !real_value(right, &imaginary, error)) return 0;
                    stack[size - 1] = make_complex(real, imaginary);
                }
                break;
            case EXPR_MIN:
            case EXPR_MAX: {
                const uint32_t count = instruction.argument;
                if (!count || size < count) goto program_error;
                double chosen = instruction.opcode == EXPR_MIN ? INFINITY : -INFINITY;
                for (uint32_t index = size - count; index < size; ++index) {
                    if (!real_value(stack[index], &real, error)) return 0;
                    if ((instruction.opcode == EXPR_MIN && real < chosen) ||
                        (instruction.opcode == EXPR_MAX && real > chosen)) chosen = real;
                }
                size -= count - 1u;
                stack[size - 1] = make_complex(chosen, 0.0);
                break;
            }
            case EXPR_MOD:
                if (size < 2) goto program_error;
                right = stack[--size]; left = stack[size - 1];
                double divisor;
                if (!real_value(left, &real, error) || !real_value(right, &divisor, error)) return 0;
                if (fabs(divisor) <= CE_EXPR_EPSILON) { *error = EXPR_ERROR_MOD_ZERO; return 0; }
                stack[size - 1] = make_complex(fmod(real, divisor), 0.0);
                break;
            case EXPR_GCD: {
                if (size < 2) goto program_error;
                right = stack[--size]; left = stack[size - 1];
                int64_t a, b;
                if (!integer_value(left, &a, error) || !integer_value(right, &b, error)) return 0;
                if (a < 0) a = -a; if (b < 0) b = -b;
                while (b) { const int64_t next = a % b; a = b; b = next; }
                stack[size - 1] = make_complex((double)a, 0.0);
                break;
            }
            case EXPR_IS_PRIME:
                if (!size || !integer_value(stack[size - 1], &integer, error)) return 0;
                stack[size - 1] = make_complex(prime_integer(integer) ? 1.0 : 0.0, 0.0);
                break;
            case EXPR_JUMP_FALSE:
            case EXPR_JUMP_TRUE:
                if (!size || instruction.argument > instruction_count) goto program_error;
                left = stack[--size];
                if ((instruction.opcode == EXPR_JUMP_FALSE && !truthy(left)) ||
                    (instruction.opcode == EXPR_JUMP_TRUE && truthy(left))) pc = instruction.argument;
                break;
            case EXPR_JUMP:
                if (instruction.argument > instruction_count) goto program_error;
                pc = instruction.argument;
                break;
            default:
                if (size < 2) goto program_error;
                right = stack[--size];
                left = stack[size - 1];
                if (instruction.opcode == EXPR_ADD) stack[size - 1] = ce_add(left, right);
                else if (instruction.opcode == EXPR_SUB) stack[size - 1] = ce_sub(left, right);
                else if (instruction.opcode == EXPR_MUL) stack[size - 1] = ce_mul(left, right);
                else if (instruction.opcode == EXPR_DIV) {
                    if (hypot(right.re, right.im) <= CE_EXPR_EPSILON) {
                        *error = EXPR_ERROR_DIVISION_ZERO;
                        return 0;
                    }
                    stack[size - 1] = ce_div(left, right);
                } else if (instruction.opcode == EXPR_POW) stack[size - 1] = ce_pow(left, right);
                else if (instruction.opcode >= EXPR_EQUAL && instruction.opcode <= EXPR_GREATER_EQUAL) {
                    int comparison = 0;
                    if (instruction.opcode == EXPR_EQUAL || instruction.opcode == EXPR_NOT_EQUAL) {
                        comparison = fabs(left.re - right.re) <= CE_EXPR_EPSILON &&
                            fabs(left.im - right.im) <= CE_EXPR_EPSILON;
                        if (instruction.opcode == EXPR_NOT_EQUAL) comparison = !comparison;
                    } else {
                        double left_real, right_real;
                        if (!real_value(left, &left_real, error) || !real_value(right, &right_real, error)) return 0;
                        if (instruction.opcode == EXPR_LESS) comparison = left_real < right_real;
                        else if (instruction.opcode == EXPR_LESS_EQUAL) comparison = left_real <= right_real;
                        else if (instruction.opcode == EXPR_GREATER) comparison = left_real > right_real;
                        else comparison = left_real >= right_real;
                    }
                    stack[size - 1] = make_complex(comparison ? 1.0 : 0.0, 0.0);
                } else goto program_error;
                break;
        }
    }
    if (size != 1 || !isfinite(stack[0].re) || !isfinite(stack[0].im)) {
        *error = EXPR_ERROR_RESULT;
        return 0;
    }
    *result = stack[0];
    return 1;

program_error:
    *error = EXPR_ERROR_PROGRAM;
    return 0;
}

int32_t ce_evaluate_expression(const ce_map_config *map_config,
                               const ce_expression_instruction *program,
                               uint32_t instruction_count, const ce_complex *variables,
                               uint32_t variable_count, const int32_t *sheets,
                               uint32_t job_count,
                               ce_complex *output, uint8_t *errors) {
    if (!map_config || !program || !instruction_count || !output || !errors ||
        (variable_count && !variables)) return -1;
    for (uint32_t job = 0; job < job_count; ++job) {
        const ce_complex *row = variables + (size_t)job * variable_count;
        if (!ce_evaluate_expression_one(map_config, program, instruction_count, row, variable_count,
                                        sheets ? sheets[job] : 0, &output[job], &errors[job])) {
            output[job] = make_complex(NAN, NAN);
        }
    }
    return 0;
}
