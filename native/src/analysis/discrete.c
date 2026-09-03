#include "complex_engine.h"
#include "expression_internal.h"

#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#define SOURCE_INCLUDE_ZERO 1u
#define SOURCE_INCLUDE_NEGATIVE 2u
#define SOURCE_NORM_BOUND 4u
#define SOURCE_ALL_ASSOCIATES 8u
#define SOURCE_INCLUDE_CONJUGATES 16u

static ce_complex source_complex(double re, double im) {
    const ce_complex value = {re, im};
    return value;
}

static int source_prime(int64_t value) {
    if (value < 2) return 0;
    if (value == 2 || value == 3) return 1;
    if (!(value & 1) || value % 3 == 0) return 0;
    for (int64_t divisor = 5, stride = 2; divisor <= value / divisor;
         divisor += stride, stride = 6 - stride) {
        if (value % divisor == 0) return 0;
    }
    return 1;
}

static int source_gaussian_prime(int64_t a, int64_t b) {
    if ((!a && !b) || llabs(a) > 94906265 || llabs(b) > 94906265) return 0;
    if (a && b) return source_prime(a * a + b * b);
    const int64_t axis = llabs(a ? a : b);
    return source_prime(axis) && axis % 4 == 3;
}

static int gaussian_compare(const void *left_pointer, const void *right_pointer) {
    const ce_complex *left = (const ce_complex *)left_pointer;
    const ce_complex *right = (const ce_complex *)right_pointer;
    const double left_norm = left->re * left->re + left->im * left->im;
    const double right_norm = right->re * right->re + right->im * right->im;
    if (left_norm < right_norm) return -1;
    if (left_norm > right_norm) return 1;
    const double left_angle = atan2(left->im, left->re);
    const double right_angle = atan2(right->im, right->re);
    if (left_angle < right_angle) return -1;
    if (left_angle > right_angle) return 1;
    if (left->re < right->re) return -1;
    if (left->re > right->re) return 1;
    if (left->im < right->im) return -1;
    if (left->im > right->im) return 1;
    return 0;
}

static int append_finite(ce_complex value, ce_complex *output, uint32_t capacity,
                         uint32_t *count, uint32_t *invalid) {
    if (!isfinite(value.re) || !isfinite(value.im)) {
        ++*invalid;
        return 0;
    }
    if (*count < capacity) output[(*count)++] = value;
    return 1;
}

static int32_t generate_gaussian(uint32_t kind, uint32_t requested_count, uint32_t initial_bound,
                                 uint32_t flags, ce_complex *output, uint32_t output_capacity,
                                 uint32_t *generated) {
    uint32_t search_bound = initial_bound;
    const uint32_t root = (uint32_t)ceil(sqrt((double)requested_count));
    if (search_bound < root) search_bound = root;
    if (search_bound < 1u) search_bound = 1u;
    for (;;) {
        const uint64_t side = (uint64_t)search_bound * 2u + 1u;
        if (side > 100000u || side * side > SIZE_MAX / sizeof(ce_complex)) return -3;
        const size_t capacity = (size_t)(side * side);
        ce_complex *values = (ce_complex *)malloc(capacity * sizeof(ce_complex));
        if (!values) return -2;
        size_t count = 0;
        const int64_t radius_sq = (int64_t)search_bound * search_bound;
        for (int64_t a = -(int64_t)search_bound; a <= (int64_t)search_bound; ++a) {
            for (int64_t b = -(int64_t)search_bound; b <= (int64_t)search_bound; ++b) {
                const int64_t norm = a * a + b * b;
                if ((flags & SOURCE_NORM_BOUND) && norm > radius_sq) continue;
                if (kind == 5u) {
                    if (!(flags & SOURCE_INCLUDE_ZERO) && !a && !b) continue;
                } else {
                    if (!source_gaussian_prime(a, b)) continue;
                    if (!(flags & SOURCE_INCLUDE_CONJUGATES) && b < 0) continue;
                    if (!(flags & SOURCE_ALL_ASSOCIATES)) {
                        const int canonical = (flags & SOURCE_INCLUDE_CONJUGATES)
                            ? (a > 0 || (!a && b > 0))
                            : (a > 0 && b >= 0);
                        if (!canonical) continue;
                    }
                }
                values[count++] = source_complex((double)a, (double)b);
            }
        }
        qsort(values, count, sizeof(ce_complex), gaussian_compare);
        if (count >= requested_count) {
            const uint32_t copied = requested_count < output_capacity ? requested_count : output_capacity;
            for (uint32_t index = 0; index < copied; ++index) output[index] = values[index];
            *generated = copied;
            free(values);
            return 0;
        }
        free(values);
        if (search_bound > UINT32_MAX / 2u) return -3;
        search_bound *= 2u;
    }
}

static void source_default_map(ce_map_config *map) {
    *map = (ce_map_config){0};
    map->function_id = CE_FN_IDENTITY;
    map->chain_count = 1u;
    map->function.exp_base = source_complex(2.71828182845904523536, 0.0);
    map->function.log_base = source_complex(2.71828182845904523536, 0.0);
    map->function.mobius_a = source_complex(1.0, 0.0);
    map->function.mobius_d = source_complex(1.0, 0.0);
    map->function.fractional_power = 0.5;
}

static int32_t generate_expression(uint32_t requested_count, uint32_t max_attempts,
                                   const ce_expression_instruction *generator,
                                   uint32_t generator_count,
                                   const ce_expression_instruction *predicate,
                                   uint32_t predicate_count,
                                   const ce_complex *parameters, uint32_t parameter_count,
                                   ce_complex *output, uint32_t output_capacity,
                                   uint8_t *attempt_errors, uint32_t error_capacity,
                                   uint32_t stats[3]) {
    if (!generator || !generator_count) return -1;
    ce_complex *generator_variables = (ce_complex *)malloc((parameter_count + 1u) * sizeof(ce_complex));
    ce_complex *predicate_variables = predicate_count
        ? (ce_complex *)malloc((parameter_count + 2u) * sizeof(ce_complex)) : NULL;
    if (!generator_variables || (predicate_count && !predicate_variables)) {
        free(generator_variables); free(predicate_variables); return -2;
    }
    for (uint32_t index = 0; index < parameter_count; ++index) {
        generator_variables[index + 1u] = parameters[index];
        if (predicate_variables) predicate_variables[index + 2u] = parameters[index];
    }
    ce_map_config map;
    source_default_map(&map);
    uint32_t accepted = 0, attempts = 0;
    while (accepted < requested_count && attempts < max_attempts) {
        const ce_complex ordinal = source_complex((double)attempts, 0.0);
        generator_variables[0] = ordinal;
        ce_complex value = source_complex(NAN, NAN);
        uint8_t error = 0;
        int ok = ce_evaluate_expression_one(&map, generator, generator_count,
                                            generator_variables, parameter_count + 1u,
                                            0, &value, &error);
        if (ok && predicate_count) {
            predicate_variables[0] = value;
            predicate_variables[1] = ordinal;
            ce_complex keep = source_complex(0.0, 0.0);
            ok = ce_evaluate_expression_one(&map, predicate, predicate_count,
                                            predicate_variables, parameter_count + 2u,
                                            0, &keep, &error);
            ok = ok && isfinite(keep.re) && isfinite(keep.im) &&
                (fabs(keep.re) > 1e-12 || fabs(keep.im) > 1e-12);
        }
        if (ok && accepted < output_capacity) output[accepted++] = value;
        if (attempt_errors && attempts < error_capacity) attempt_errors[attempts] = error;
        ++attempts;
    }
    stats[0] = accepted;
    stats[1] = attempts;
    stats[2] = 0u;
    free(generator_variables);
    free(predicate_variables);
    return 0;
}

int32_t ce_generate_discrete_values(uint32_t kind, uint32_t requested_count,
                                    double start, double step, double ratio,
                                    double minimum, double maximum, uint32_t bound,
                                    uint32_t flags, uint32_t max_attempts,
                                    const ce_expression_instruction *generator,
                                    uint32_t generator_count,
                                    const ce_expression_instruction *predicate,
                                    uint32_t predicate_count,
                                    const ce_complex *parameters, uint32_t parameter_count,
                                    ce_complex *output, uint32_t output_capacity,
                                    uint8_t *attempt_errors, uint32_t error_capacity,
                                    uint32_t stats[3]) {
    if (!output || !stats || output_capacity < requested_count || (parameter_count && !parameters)) return -1;
    stats[0] = stats[1] = stats[2] = 0u;
    if (!requested_count) return 0;
    if (kind == 7u) return generate_expression(
        requested_count, max_attempts, generator, generator_count, predicate, predicate_count,
        parameters, parameter_count, output, output_capacity, attempt_errors, error_capacity, stats
    );
    if (kind == 5u || kind == 6u) {
        const int32_t status = generate_gaussian(
            kind, requested_count, bound, flags, output, output_capacity, &stats[0]
        );
        stats[1] = stats[0];
        return status;
    }

    uint32_t generated = 0, invalid = 0;
    if (kind == 0u || kind == 1u) {
        if (kind == 1u) {
            double radius = fmax(1.0, fabs(start));
            if ((flags & SOURCE_INCLUDE_ZERO) && generated < requested_count) {
                append_finite(source_complex(0.0, 0.0), output, output_capacity, &generated, &invalid);
            }
            while (generated + invalid < requested_count) {
                append_finite(source_complex(radius, 0.0), output, output_capacity, &generated, &invalid);
                if (generated + invalid < requested_count) {
                    append_finite(source_complex(-radius, 0.0), output, output_capacity, &generated, &invalid);
                }
                radius += fabs(step);
            }
        } else {
            for (uint32_t index = 0; index < requested_count; ++index) {
                append_finite(source_complex(start + (double)index * step, 0.0),
                              output, output_capacity, &generated, &invalid);
            }
        }
    } else if (kind == 2u) {
        double current = start;
        for (uint32_t index = 0; index < requested_count; ++index) {
            append_finite(source_complex(current, 0.0), output, output_capacity, &generated, &invalid);
            current *= ratio;
        }
    } else if (kind == 3u) {
        for (uint32_t index = 0; index < requested_count; ++index) {
            const double denominator = start + (double)index * step;
            append_finite(source_complex(fabs(denominator) <= 1e-12 ? NAN : 1.0 / denominator, 0.0),
                          output, output_capacity, &generated, &invalid);
        }
    } else if (kind == 4u) {
        int64_t candidate = minimum <= 2.0 ? 2 : (int64_t)floor(minimum);
        if (candidate > 2 && !(candidate & 1)) ++candidate;
        const uint32_t target = (flags & SOURCE_INCLUDE_NEGATIVE)
            ? (requested_count + 1u) / 2u : requested_count;
        while (generated < target && (double)candidate <= maximum) {
            if (source_prime(candidate)) {
                output[generated++] = source_complex((double)candidate, 0.0);
            }
            candidate = candidate == 2 ? 3 : candidate + 2;
        }
        if (flags & SOURCE_INCLUDE_NEGATIVE) {
            const uint32_t positive_count = generated;
            for (uint32_t index = positive_count; index-- > 0;) {
                output[index * 2u] = output[index];
                if (index * 2u + 1u < requested_count) {
                    output[index * 2u + 1u] = source_complex(-output[index].re, 0.0);
                }
            }
            generated = positive_count * 2u < requested_count ? positive_count * 2u : requested_count;
        }
    } else return -1;
    stats[0] = generated;
    stats[1] = generated + invalid;
    stats[2] = invalid;
    return 0;
}
