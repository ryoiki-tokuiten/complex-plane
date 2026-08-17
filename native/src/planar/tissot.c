#include "complex_engine.h"

#include <math.h>

static int ce_tissot_value(const ce_map_config *config, ce_complex point, ce_complex *value) {
    uint8_t valid = 0;
    return ce_evaluate_points(config, &point, 1u, value, &valid) == 0 && valid;
}

static int ce_tissot_derivative(const ce_map_config *config, ce_complex point, ce_complex *derivative) {
    const double h = 1e-6 * fmax(1.0, fmax(fabs(point.re), fabs(point.im)));
    ce_complex left, right;
    if (!ce_tissot_value(config, (ce_complex){point.re - h, point.im}, &left) ||
        !ce_tissot_value(config, (ce_complex){point.re + h, point.im}, &right)) return 0;
    derivative->re = (right.re - left.re) * 0.5 / h;
    derivative->im = (right.im - left.im) * 0.5 / h;
    return isfinite(derivative->re) && isfinite(derivative->im);
}

static void ce_tissot_arrow(ce_complex start, ce_complex end, double radius, ce_complex *output) {
    const double dx = end.re - start.re;
    const double dy = end.im - start.im;
    const double length = hypot(dx, dy);
    if (length <= 2.220446049250313e-16) {
        for (uint32_t index = 0; index < 3u; ++index) output[index] = (ce_complex){NAN, NAN};
        return;
    }
    const double head_length = fmin(length * 0.38, radius * 1.2);
    const double unit_re = dx / length;
    const double unit_im = dy / length;
    const double base_re = end.re - unit_re * head_length;
    const double base_im = end.im - unit_im * head_length;
    const double wing = head_length * 0.58;
    output[0] = (ce_complex){base_re - unit_im * wing, base_im + unit_re * wing};
    output[1] = end;
    output[2] = (ce_complex){base_re + unit_im * wing, base_im - unit_re * wing};
}

int32_t ce_build_tissot(const ce_map_config *config,
                        double x_min, double x_max, double y_min, double y_max,
                        uint32_t density, uint32_t segments,
                        ce_complex *source_centers, ce_complex *mapped_centers,
                        double *input_radii, double *output_radii, uint8_t *critical,
                        ce_complex *source_circles, ce_complex *mapped_circles,
                        ce_complex *source_spokes, ce_complex *mapped_spokes,
                        ce_complex *source_arrows, ce_complex *mapped_arrows,
                        uint32_t output_capacity) {
    if (!config || !source_centers || !mapped_centers || !input_radii || !output_radii ||
        !critical || !source_circles || !mapped_circles || !source_spokes || !mapped_spokes ||
        !source_arrows || !mapped_arrows || segments < 3u) return -1;
    uint32_t columns = (uint32_t)llround(density * 0.48);
    if (columns < 4u) columns = 4u;
    if (columns > 10u) columns = 10u;
    const double span_x = x_max - x_min;
    const double span_y = y_max - y_min;
    const double radius = fmin(fabs(span_x), fabs(span_y)) / (columns * 8.0);
    uint32_t count = 0;
    for (uint32_t row = 1; row < columns; ++row) {
        const double imaginary = y_min + (double)row / columns * span_y;
        for (uint32_t column = 1; column < columns; ++column) {
            if (count >= output_capacity) return -2;
            const double real = x_min + (double)column / columns * span_x;
            const ce_complex source = {real, imaginary};
            ce_complex mapped, derivative;
            if (!ce_tissot_value(config, source, &mapped) || !ce_tissot_derivative(config, source, &derivative)) continue;
            source_centers[count] = source;
            mapped_centers[count] = mapped;
            input_radii[count] = radius;
            output_radii[count] = hypot(derivative.re, derivative.im) * radius;
            critical[count] = output_radii[count] <= 1e-8;
            ce_complex *source_circle = source_circles + (size_t)count * (segments + 1u);
            ce_complex *mapped_circle = mapped_circles + (size_t)count * (segments + 1u);
            for (uint32_t index = 0; index <= segments; ++index) {
                const double angle = (double)index / segments * 6.28318530717958647693;
                const double offset_re = radius * cos(angle);
                const double offset_im = radius * sin(angle);
                source_circle[index] = (ce_complex){source.re + offset_re, source.im + offset_im};
                mapped_circle[index] = (ce_complex){
                    mapped.re + derivative.re * offset_re - derivative.im * offset_im,
                    mapped.im + derivative.re * offset_im + derivative.im * offset_re
                };
            }
            ce_complex *source_spoke = source_spokes + (size_t)count * 2u;
            ce_complex *mapped_spoke = mapped_spokes + (size_t)count * 2u;
            source_spoke[0] = source;
            source_spoke[1] = (ce_complex){source.re + radius, source.im};
            mapped_spoke[0] = mapped;
            mapped_spoke[1] = (ce_complex){mapped.re + derivative.re * radius,
                                           mapped.im + derivative.im * radius};
            ce_tissot_arrow(source_spoke[0], source_spoke[1], radius,
                            source_arrows + (size_t)count * 3u);
            ce_tissot_arrow(mapped_spoke[0], mapped_spoke[1], radius,
                            mapped_arrows + (size_t)count * 3u);
            count += 1u;
        }
    }
    return (int32_t)count;
}
