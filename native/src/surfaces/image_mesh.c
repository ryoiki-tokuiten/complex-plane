#include "complex_engine.h"
#include "precision_internal.h"

#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define CE_IMAGE_FINITE_LIMIT 1e30
#define CE_IMAGE_DISCONTINUITY_RATIO 0.2
#define CE_IMAGE_MIN_MAPPED_SPAN 1e-12
#define CE_UINT16_VERTEX_LIMIT 65535u

typedef struct {
    uint32_t x0, y0, x1, y1, depth;
} ce_image_cell;

typedef struct {
    uint32_t x0, y0, x1, y1;
} ce_image_leaf;

typedef struct {
    uint64_t key;
    double x, y;
    uint8_t valid;
} ce_image_point_slot;

typedef struct {
    ce_image_cell cell;
    double relative_error;
    uint8_t outside;
} ce_image_candidate;

typedef struct {
    uint32_t start, end;
    int32_t next;
} ce_image_edge;

typedef struct {
    const ce_map_config *config;
    double center_re, center_im, source_width, source_height;
    double view_x_min, view_y_min, view_x_span, view_y_span;
    uint32_t grid_size, max_samples, sample_count;
    uint8_t sample_budget_exceeded;
    ce_image_point_slot *points;
    uint32_t point_mask;
    void *precision_context;
} ce_image_context;

static uint32_t ce_next_power_of_two(uint32_t value) {
    uint32_t result = 1u;
    while (result < value && result < 0x80000000u) result <<= 1u;
    return result;
}

static uint32_t ce_hash_u64(uint64_t key) {
    key ^= key >> 33u;
    key *= UINT64_C(0xff51afd7ed558ccd);
    key ^= key >> 33u;
    key *= UINT64_C(0xc4ceb9fe1a85ec53);
    key ^= key >> 33u;
    return (uint32_t)key;
}

static ce_image_point_slot *ce_image_point(ce_image_context *context, uint32_t gx, uint32_t gy) {
    const uint64_t key = (uint64_t)gx * (context->grid_size + 1u) + gy + 1u;
    uint32_t slot_index = ce_hash_u64(key) & context->point_mask;
    for (;;) {
        ce_image_point_slot *slot = &context->points[slot_index];
        if (slot->key == key) return slot;
        if (!slot->key) {
            slot->key = key;
            slot->valid = 0u;
            if (context->sample_count >= context->max_samples) {
                context->sample_budget_exceeded = 1u;
                return slot;
            }
            const double u = (double)gx / context->grid_size;
            const double v = (double)gy / context->grid_size;
            uint8_t valid = 0u;
            if (context->precision_context) {
                valid = (uint8_t)ce_precision_image_sample(
                    context->precision_context, u, v, &slot->x, &slot->y
                );
            } else {
                const ce_complex input = {
                    context->center_re + (u * 2.0 - 1.0) * context->source_width * 0.5,
                    context->center_im - (v * 2.0 - 1.0) * context->source_height * 0.5
                };
                ce_complex mapped;
                ce_evaluate_points(context->config, &input, 1u, &mapped, &valid);
                if (valid && isfinite(mapped.re) && isfinite(mapped.im) &&
                    fabs(mapped.re) < CE_IMAGE_FINITE_LIMIT && fabs(mapped.im) < CE_IMAGE_FINITE_LIMIT) {
                    slot->x = (mapped.re - context->view_x_min) * (2.0 / context->view_x_span) - 1.0;
                    slot->y = (mapped.im - context->view_y_min) * (2.0 / context->view_y_span) - 1.0;
                } else valid = 0u;
            }
            ++context->sample_count;
            if (!valid) return slot;
            slot->valid = isfinite(slot->x) && isfinite(slot->y);
            return slot;
        }
        slot_index = (slot_index + 1u) & context->point_mask;
    }
}

static double ce_image_error(const ce_image_point_slot *point, double expected_x, double expected_y) {
    return hypot(point->x - expected_x, point->y - expected_y);
}

static double ce_image_relative_error(const ce_image_point_slot *point,
                                      double expected_x, double expected_y,
                                      const ce_image_point_slot *first,
                                      const ce_image_point_slot *second) {
    const double span = fmax(hypot(first->x - second->x, first->y - second->y),
                             CE_IMAGE_MIN_MAPPED_SPAN);
    return ce_image_error(point, expected_x, expected_y) / span;
}

static int ce_image_outside(ce_image_point_slot *const points[9], double margin) {
    double min_x = INFINITY, max_x = -INFINITY, min_y = INFINITY, max_y = -INFINITY;
    for (uint32_t index = 0; index < 9u; ++index) {
        min_x = fmin(min_x, points[index]->x); max_x = fmax(max_x, points[index]->x);
        min_y = fmin(min_y, points[index]->y); max_y = fmax(max_y, points[index]->y);
    }
    return max_x + margin < -1.0 || min_x - margin > 1.0 ||
           max_y + margin < -1.0 || min_y - margin > 1.0;
}

static void ce_image_children(ce_image_cell *target, uint32_t *count, ce_image_cell cell) {
    const uint32_t center_x = (cell.x0 + cell.x1) / 2u;
    const uint32_t center_y = (cell.y0 + cell.y1) / 2u;
    const uint32_t depth = cell.depth + 1u;
    target[(*count)++] = (ce_image_cell){cell.x0, cell.y0, center_x, center_y, depth};
    target[(*count)++] = (ce_image_cell){center_x, cell.y0, cell.x1, center_y, depth};
    target[(*count)++] = (ce_image_cell){cell.x0, center_y, center_x, cell.y1, depth};
    target[(*count)++] = (ce_image_cell){center_x, center_y, cell.x1, cell.y1, depth};
}

static void ce_image_add_leaf(ce_image_leaf *leaves, uint32_t *count, uint32_t maximum,
                              ce_image_cell cell) {
    if (*count < maximum) leaves[(*count)++] = (ce_image_leaf){cell.x0, cell.y0, cell.x1, cell.y1};
}

static int ce_uint32_compare(const void *left, const void *right) {
    const uint32_t a = *(const uint32_t *)left;
    const uint32_t b = *(const uint32_t *)right;
    return a < b ? -1 : a > b ? 1 : 0;
}

static uint32_t ce_image_breaks(const int32_t *heads, const ce_image_edge *edges,
                                uint32_t boundary, uint32_t start, uint32_t end,
                                uint32_t *result) {
    uint32_t count = 0u;
    result[count++] = start; result[count++] = end;
    for (int32_t edge = heads[boundary]; edge >= 0; edge = edges[edge].next) {
        if (edges[edge].start >= end || edges[edge].end <= start) continue;
        result[count++] = edges[edge].start > start ? edges[edge].start : start;
        result[count++] = edges[edge].end < end ? edges[edge].end : end;
    }
    qsort(result, count, sizeof(uint32_t), ce_uint32_compare);
    uint32_t unique = 0u;
    for (uint32_t index = 0; index < count; ++index) {
        if (!unique || result[index] != result[unique - 1u]) result[unique++] = result[index];
    }
    return unique;
}

static void ce_image_append_boundary(uint32_t *x, uint32_t *y, uint32_t *count,
                                     uint32_t px, uint32_t py) {
    if (!*count || x[*count - 1u] != px || y[*count - 1u] != py) {
        x[*count] = px; y[*count] = py; ++*count;
    }
}

static int32_t ce_image_vertex(ce_image_context *context,
                               uint64_t *vertex_keys, uint32_t *vertex_values,
                               uint32_t vertex_mask, uint32_t gx, uint32_t gy,
                               uint32_t max_vertices, uint32_t *vertex_count,
                               float *texture_coordinates, float *mapped_positions) {
    const uint64_t key = (uint64_t)gx * (context->grid_size + 1u) + gy + 1u;
    uint32_t slot = ce_hash_u64(key) & vertex_mask;
    for (;;) {
        if (vertex_keys[slot] == key) return (int32_t)(vertex_values[slot] - 1u);
        if (!vertex_keys[slot]) break;
        slot = (slot + 1u) & vertex_mask;
    }
    ce_image_point_slot *point = ce_image_point(context, gx, gy);
    if (!point->valid || *vertex_count >= max_vertices) return -1;
    const uint32_t index = (*vertex_count)++;
    texture_coordinates[index * 2u] = (float)((double)gx / context->grid_size);
    texture_coordinates[index * 2u + 1u] = (float)((double)gy / context->grid_size);
    mapped_positions[index * 2u] = (float)point->x;
    mapped_positions[index * 2u + 1u] = (float)point->y;
    vertex_keys[slot] = key;
    vertex_values[slot] = index + 1u;
    return (int32_t)index;
}

static int32_t ce_build_image_mesh_internal(const ce_map_config *config,
                            double source_center_re, double source_center_im,
                            double source_width, double source_height,
                            double view_x_min, double view_x_max,
                            double view_y_min, double view_y_max,
                            uint32_t pixel_width, uint32_t pixel_height,
                            uint32_t base_resolution, uint32_t max_depth,
                            uint32_t max_cells, uint32_t max_vertices,
                            uint32_t max_samples,
                            float *texture_coordinates, float *mapped_positions,
                            uint16_t *indices, uint32_t index_capacity,
                            uint32_t stats[4], uint32_t build_fold,
                            double fold_height_scale, float *fold_positions,
                            float *fold_uvs, double fold_mapping[4],
                            void *precision_context) {
    if (!config || !texture_coordinates || !mapped_positions || !indices || !stats ||
        !(source_width > 0.0) || !(source_height > 0.0) ||
        !(view_x_max > view_x_min) || !(view_y_max > view_y_min) ||
        (build_fold && (!fold_positions || !fold_uvs || !fold_mapping))) return -1;
    if (max_depth > 12u) max_depth = 12u;
    if (!max_cells) max_cells = 1u;
    if (max_cells > CE_UINT16_VERTEX_LIMIT / 4u) max_cells = CE_UINT16_VERTEX_LIMIT / 4u;
    uint32_t base_limit = (uint32_t)floor(sqrt((double)(CE_UINT16_VERTEX_LIMIT / 4u)));
    uint32_t cell_base_limit = (uint32_t)floor(sqrt((double)max_cells));
    if (!base_resolution) base_resolution = 1u;
    if (base_resolution > base_limit) base_resolution = base_limit;
    if (base_resolution > cell_base_limit) base_resolution = cell_base_limit;
    if (!base_resolution) base_resolution = 1u;
    if (!max_vertices) max_vertices = 1u;
    if (max_vertices > CE_UINT16_VERTEX_LIMIT) max_vertices = CE_UINT16_VERTEX_LIMIT;
    if (!max_samples) max_samples = 1u;
    const uint32_t grid_size = base_resolution << max_depth;
    const uint32_t point_capacity = ce_next_power_of_two(max_samples * 2u + 1u);
    const uint32_t vertex_capacity = ce_next_power_of_two(max_vertices * 2u + 1u);
    const double edge_error = 0.5 * fmin(2.0 / fmax(1.0, pixel_width),
                                        2.0 / fmax(1.0, pixel_height));

    ce_image_context context = {
        config, source_center_re, source_center_im, source_width, source_height,
        view_x_min, view_y_min, view_x_max - view_x_min, view_y_max - view_y_min,
        grid_size, max_samples, 0u, 0u,
        calloc(point_capacity, sizeof(ce_image_point_slot)), point_capacity - 1u,
        precision_context
    };
    ce_image_cell *frontier = malloc(max_cells * sizeof(ce_image_cell));
    ce_image_cell *next = malloc(max_cells * sizeof(ce_image_cell));
    ce_image_candidate *priority = malloc(max_cells * sizeof(ce_image_candidate));
    ce_image_candidate *deferred = malloc(max_cells * sizeof(ce_image_candidate));
    ce_image_leaf *leaves = malloc(max_cells * sizeof(ce_image_leaf));
    if (!context.points || !frontier || !next || !priority || !deferred || !leaves) goto allocation_error;

    uint32_t frontier_count = 0u, leaf_count = 0u, processed = 0u;
    const uint32_t initial_step = grid_size / base_resolution;
    for (uint32_t y = 0; y < base_resolution; ++y) {
        for (uint32_t x = 0; x < base_resolution; ++x) {
            frontier[frontier_count++] = (ce_image_cell){
                x * initial_step, y * initial_step, (x + 1u) * initial_step,
                (y + 1u) * initial_step, 0u
            };
        }
    }

    while (frontier_count) {
        uint32_t priority_count = 0u, deferred_count = 0u;
        processed += frontier_count;
        for (uint32_t cell_index = 0; cell_index < frontier_count; ++cell_index) {
            const ce_image_cell cell = frontier[cell_index];
            const uint32_t center_x = (cell.x0 + cell.x1) / 2u;
            const uint32_t center_y = (cell.y0 + cell.y1) / 2u;
            ce_image_point_slot *samples[9] = {
                ce_image_point(&context, cell.x0, cell.y0),
                ce_image_point(&context, cell.x1, cell.y0),
                ce_image_point(&context, cell.x0, cell.y1),
                ce_image_point(&context, cell.x1, cell.y1),
                ce_image_point(&context, center_x, cell.y0),
                ce_image_point(&context, cell.x1, center_y),
                ce_image_point(&context, center_x, cell.y1),
                ce_image_point(&context, cell.x0, center_y),
                ce_image_point(&context, center_x, center_y)
            };
            uint32_t valid_count = 0u;
            for (uint32_t index = 0; index < 9u; ++index) valid_count += samples[index]->valid;
            if (valid_count != 9u) {
                ce_image_candidate candidate = {cell, INFINITY, 0u};
                if (valid_count) priority[priority_count++] = candidate;
                else deferred[deferred_count++] = candidate;
                continue;
            }
            double max_error = 0.0, max_relative = 0.0;
            const uint32_t checks[4][3] = {{4,0,1},{5,1,3},{6,2,3},{7,0,2}};
            for (uint32_t check = 0; check < 4u; ++check) {
                ce_image_point_slot *mid = samples[checks[check][0]];
                ce_image_point_slot *first = samples[checks[check][1]];
                ce_image_point_slot *second = samples[checks[check][2]];
                const double expected_x = (first->x + second->x) * 0.5;
                const double expected_y = (first->y + second->y) * 0.5;
                max_error = fmax(max_error, ce_image_error(mid, expected_x, expected_y));
                max_relative = fmax(max_relative,
                    ce_image_relative_error(mid, expected_x, expected_y, first, second));
            }
            const double expected_x = (samples[0]->x + samples[1]->x + samples[2]->x + samples[3]->x) * 0.25;
            const double expected_y = (samples[0]->y + samples[1]->y + samples[2]->y + samples[3]->y) * 0.25;
            const double center_error = ce_image_error(samples[8], expected_x, expected_y);
            double corner_span = CE_IMAGE_MIN_MAPPED_SPAN;
            const uint32_t spans[6][2] = {{0,1},{0,2},{1,3},{2,3},{0,3},{1,2}};
            for (uint32_t span = 0; span < 6u; ++span) {
                corner_span = fmax(corner_span, hypot(
                    samples[spans[span][0]]->x - samples[spans[span][1]]->x,
                    samples[spans[span][0]]->y - samples[spans[span][1]]->y));
            }
            max_error = fmax(max_error, center_error);
            max_relative = fmax(max_relative, center_error / corner_span);
            const uint8_t outside = ce_image_outside(samples, max_error);
            if (max_error > edge_error || max_relative > CE_IMAGE_DISCONTINUITY_RATIO) {
                priority[priority_count++] = (ce_image_candidate){cell, max_relative, outside};
            } else if (!outside) ce_image_add_leaf(leaves, &leaf_count, max_cells, cell);
        }

        const uint32_t candidate_count = priority_count + deferred_count;
        const uint32_t remaining = processed < max_cells ? max_cells - processed : 0u;
        uint32_t expansion_count = 0u;
        if (!context.sample_budget_exceeded && frontier[0].depth < max_depth) {
            expansion_count = candidate_count < remaining / 4u ? candidate_count : remaining / 4u;
        }
        uint32_t next_count = 0u;
        for (uint32_t index = 0; index < expansion_count; ++index) {
            const ce_image_candidate candidate = index < priority_count
                ? priority[index] : deferred[index - priority_count];
            ce_image_children(next, &next_count, candidate.cell);
        }
        for (uint32_t index = expansion_count; index < priority_count; ++index) {
            if (!priority[index].outside && priority[index].relative_error <= CE_IMAGE_DISCONTINUITY_RATIO) {
                ce_image_add_leaf(leaves, &leaf_count, max_cells, priority[index].cell);
            }
        }
        ce_image_cell *swap = frontier; frontier = next; next = swap; frontier_count = next_count;
    }

    int32_t *heads_top = malloc((grid_size + 1u) * sizeof(int32_t));
    int32_t *heads_right = malloc((grid_size + 1u) * sizeof(int32_t));
    int32_t *heads_bottom = malloc((grid_size + 1u) * sizeof(int32_t));
    int32_t *heads_left = malloc((grid_size + 1u) * sizeof(int32_t));
    ce_image_edge *edges = malloc(leaf_count * 4u * sizeof(ce_image_edge));
    uint32_t *breaks = malloc((leaf_count * 2u + 2u) * sizeof(uint32_t));
    uint32_t *boundary_x = malloc((leaf_count * 8u + 8u) * sizeof(uint32_t));
    uint32_t *boundary_y = malloc((leaf_count * 8u + 8u) * sizeof(uint32_t));
    int32_t *boundary_vertices = malloc((leaf_count * 8u + 8u) * sizeof(int32_t));
    uint64_t *vertex_keys = calloc(vertex_capacity, sizeof(uint64_t));
    uint32_t *vertex_values = calloc(vertex_capacity, sizeof(uint32_t));
    if (!heads_top || !heads_right || !heads_bottom || !heads_left || !edges || !breaks ||
        !boundary_x || !boundary_y || !boundary_vertices || !vertex_keys || !vertex_values) goto topology_allocation_error;
    memset(heads_top, 0xff, (grid_size + 1u) * sizeof(int32_t));
    memset(heads_right, 0xff, (grid_size + 1u) * sizeof(int32_t));
    memset(heads_bottom, 0xff, (grid_size + 1u) * sizeof(int32_t));
    memset(heads_left, 0xff, (grid_size + 1u) * sizeof(int32_t));
    uint32_t edge_count = 0u;
    for (uint32_t index = 0; index < leaf_count; ++index) {
        ce_image_leaf leaf = leaves[index];
        edges[edge_count] = (ce_image_edge){leaf.x0, leaf.x1, heads_top[leaf.y0]}; heads_top[leaf.y0] = (int32_t)edge_count++;
        edges[edge_count] = (ce_image_edge){leaf.y0, leaf.y1, heads_right[leaf.x1]}; heads_right[leaf.x1] = (int32_t)edge_count++;
        edges[edge_count] = (ce_image_edge){leaf.x0, leaf.x1, heads_bottom[leaf.y1]}; heads_bottom[leaf.y1] = (int32_t)edge_count++;
        edges[edge_count] = (ce_image_edge){leaf.y0, leaf.y1, heads_left[leaf.x0]}; heads_left[leaf.x0] = (int32_t)edge_count++;
    }

    uint32_t vertex_count = 0u, index_count = 0u;
    for (uint32_t leaf_index = 0; leaf_index < leaf_count; ++leaf_index) {
        const ce_image_leaf leaf = leaves[leaf_index];
        uint32_t boundary_count = 0u;
        uint32_t count = ce_image_breaks(heads_bottom, edges, leaf.y0, leaf.x0, leaf.x1, breaks);
        for (uint32_t i = 0; i < count; ++i) ce_image_append_boundary(boundary_x, boundary_y, &boundary_count, breaks[i], leaf.y0);
        count = ce_image_breaks(heads_left, edges, leaf.x1, leaf.y0, leaf.y1, breaks);
        for (uint32_t i = 0; i < count; ++i) ce_image_append_boundary(boundary_x, boundary_y, &boundary_count, leaf.x1, breaks[i]);
        count = ce_image_breaks(heads_top, edges, leaf.y1, leaf.x0, leaf.x1, breaks);
        for (uint32_t i = count; i-- > 0u;) ce_image_append_boundary(boundary_x, boundary_y, &boundary_count, breaks[i], leaf.y1);
        count = ce_image_breaks(heads_right, edges, leaf.x0, leaf.y0, leaf.y1, breaks);
        for (uint32_t i = count; i-- > 0u;) ce_image_append_boundary(boundary_x, boundary_y, &boundary_count, leaf.x0, breaks[i]);
        if (boundary_count > 1u && boundary_x[0] == boundary_x[boundary_count - 1u] &&
            boundary_y[0] == boundary_y[boundary_count - 1u]) --boundary_count;

        if (boundary_count == 4u) {
            const int32_t top_left = ce_image_vertex(&context, vertex_keys, vertex_values, vertex_capacity - 1u,
                leaf.x0, leaf.y0, max_vertices, &vertex_count, texture_coordinates, mapped_positions);
            const int32_t bottom_left = ce_image_vertex(&context, vertex_keys, vertex_values, vertex_capacity - 1u,
                leaf.x0, leaf.y1, max_vertices, &vertex_count, texture_coordinates, mapped_positions);
            const int32_t top_right = ce_image_vertex(&context, vertex_keys, vertex_values, vertex_capacity - 1u,
                leaf.x1, leaf.y0, max_vertices, &vertex_count, texture_coordinates, mapped_positions);
            const int32_t bottom_right = ce_image_vertex(&context, vertex_keys, vertex_values, vertex_capacity - 1u,
                leaf.x1, leaf.y1, max_vertices, &vertex_count, texture_coordinates, mapped_positions);
            if (top_left < 0 || bottom_left < 0 || top_right < 0 || bottom_right < 0) continue;
            if (index_count + 6u > index_capacity) goto capacity_error;
            indices[index_count++] = (uint16_t)top_left; indices[index_count++] = (uint16_t)bottom_left;
            indices[index_count++] = (uint16_t)top_right; indices[index_count++] = (uint16_t)top_right;
            indices[index_count++] = (uint16_t)bottom_left; indices[index_count++] = (uint16_t)bottom_right;
        } else {
            const int32_t center = ce_image_vertex(&context, vertex_keys, vertex_values, vertex_capacity - 1u,
                (leaf.x0 + leaf.x1) / 2u, (leaf.y0 + leaf.y1) / 2u,
                max_vertices, &vertex_count, texture_coordinates, mapped_positions);
            if (center < 0) continue;
            uint8_t valid_boundary = 1u;
            for (uint32_t i = 0; i < boundary_count; ++i) {
                boundary_vertices[i] = ce_image_vertex(&context, vertex_keys, vertex_values, vertex_capacity - 1u,
                    boundary_x[i], boundary_y[i], max_vertices, &vertex_count, texture_coordinates, mapped_positions);
                if (boundary_vertices[i] < 0) { valid_boundary = 0u; break; }
            }
            if (!valid_boundary) continue;
            if (index_count + boundary_count * 3u > index_capacity) goto capacity_error;
            for (uint32_t i = 0; i < boundary_count; ++i) {
                indices[index_count++] = (uint16_t)center;
                indices[index_count++] = (uint16_t)boundary_vertices[(i + 1u) % boundary_count];
                indices[index_count++] = (uint16_t)boundary_vertices[i];
            }
        }
    }
    stats[0] = vertex_count; stats[1] = index_count; stats[2] = leaf_count; stats[3] = context.sample_count;
    if (build_fold && vertex_count) {
        double min_x = INFINITY, max_x = -INFINITY, min_y = INFINITY, max_y = -INFINITY;
        for (uint32_t index = 0; index < vertex_count; ++index) {
            const double x = view_x_min + (mapped_positions[index * 2u] + 1.0) *
                                           (view_x_max - view_x_min) * 0.5;
            const double y = view_y_min + (mapped_positions[index * 2u + 1u] + 1.0) *
                                           (view_y_max - view_y_min) * 0.5;
            min_x = fmin(min_x, x); max_x = fmax(max_x, x);
            min_y = fmin(min_y, y); max_y = fmax(max_y, y);
        }
        const double center_x = (min_x + max_x) * 0.5;
        const double center_y = (min_y + max_y) * 0.5;
        const double span = fmax(fmax(max_x - min_x, max_y - min_y), fmax(source_width, 1e-6));
        const double scale = 10.0 / span;
        for (uint32_t index = 0; index < vertex_count; ++index) {
            const double u = texture_coordinates[index * 2u];
            const double x = view_x_min + (mapped_positions[index * 2u] + 1.0) *
                                           (view_x_max - view_x_min) * 0.5;
            const double y = view_y_min + (mapped_positions[index * 2u + 1u] + 1.0) *
                                           (view_y_max - view_y_min) * 0.5;
            fold_positions[index * 3u] = (float)((x - center_x) * scale);
            fold_positions[index * 3u + 1u] = (float)((u * 2.0 - 1.0) * source_width * 0.5 *
                                                       scale * fold_height_scale);
            fold_positions[index * 3u + 2u] = (float)((y - center_y) * scale);
            fold_uvs[index * 2u] = (float)u;
            fold_uvs[index * 2u + 1u] = 1.0f - texture_coordinates[index * 2u + 1u];
        }
        fold_mapping[0] = center_x; fold_mapping[1] = center_y;
        fold_mapping[2] = source_center_re; fold_mapping[3] = scale;
    }
    free(heads_top); free(heads_right); free(heads_bottom); free(heads_left); free(edges); free(breaks);
    free(boundary_x); free(boundary_y); free(boundary_vertices); free(vertex_keys); free(vertex_values);
    free(context.points); free(frontier); free(next); free(priority); free(deferred); free(leaves);
    return 0;

capacity_error:
    free(heads_top); free(heads_right); free(heads_bottom); free(heads_left); free(edges); free(breaks);
    free(boundary_x); free(boundary_y); free(boundary_vertices); free(vertex_keys); free(vertex_values);
    free(context.points); free(frontier); free(next); free(priority); free(deferred); free(leaves);
    return -3;
topology_allocation_error:
    free(heads_top); free(heads_right); free(heads_bottom); free(heads_left); free(edges); free(breaks);
    free(boundary_x); free(boundary_y); free(boundary_vertices); free(vertex_keys); free(vertex_values);
allocation_error:
    free(context.points); free(frontier); free(next); free(priority); free(deferred); free(leaves);
    return -2;
}

int32_t ce_build_image_mesh(const ce_map_config *config,
                            double source_center_re, double source_center_im,
                            double source_width, double source_height,
                            double view_x_min, double view_x_max,
                            double view_y_min, double view_y_max,
                            uint32_t pixel_width, uint32_t pixel_height,
                            uint32_t base_resolution, uint32_t max_depth,
                            uint32_t max_cells, uint32_t max_vertices,
                            uint32_t max_samples,
                            float *texture_coordinates, float *mapped_positions,
                            uint16_t *indices, uint32_t index_capacity,
                            uint32_t stats[4], uint32_t build_fold,
                            double fold_height_scale, float *fold_positions,
                            float *fold_uvs, double fold_mapping[4]) {
    return ce_build_image_mesh_internal(
        config, source_center_re, source_center_im, source_width, source_height,
        view_x_min, view_x_max, view_y_min, view_y_max,
        pixel_width, pixel_height, base_resolution, max_depth, max_cells,
        max_vertices, max_samples, texture_coordinates, mapped_positions,
        indices, index_capacity, stats, build_fold, fold_height_scale,
        fold_positions, fold_uvs, fold_mapping, NULL
    );
}

int32_t ce_build_image_mesh_precise(const ce_map_config *config,
                                    double source_center_re, double source_center_im,
                                    double source_width, double source_height,
                                    const char *view_center_re, const char *view_center_im,
                                    int32_t zoom_power, uint32_t precision_bits,
                                    uint32_t pixel_width, uint32_t pixel_height,
                                    uint32_t base_resolution, uint32_t max_depth,
                                    uint32_t max_cells, uint32_t max_vertices,
                                    uint32_t max_samples,
                                    float *texture_coordinates, float *mapped_positions,
                                    uint16_t *indices, uint32_t index_capacity,
                                    uint32_t stats[4]) {
    void *precision_context = ce_precision_image_context_create(
        config, source_center_re, source_center_im, source_width, source_height,
        view_center_re, view_center_im, zoom_power, precision_bits, pixel_width, pixel_height
    );
    if (!precision_context) return -4;
    const int32_t status = ce_build_image_mesh_internal(
        config, source_center_re, source_center_im, source_width, source_height,
        -1.0, 1.0, -1.0, 1.0,
        pixel_width, pixel_height, base_resolution, max_depth, max_cells,
        max_vertices, max_samples, texture_coordinates, mapped_positions,
        indices, index_capacity, stats, 0u, 1.0, NULL, NULL, NULL,
        precision_context
    );
    ce_precision_image_context_destroy(precision_context);
    return status;
}
