export const CUSTOM_GRID_INPUT_SHAPES = Object.freeze([
    'grid_rectilinear',
    'grid_nonorthogonal',
    'grid_triangular',
    'grid_curvilinear',
    'grid_spiral',
    'grid_irregular'
]);

export const CUSTOM_GRID_INPUT_SHAPE_SET = new Set(CUSTOM_GRID_INPUT_SHAPES);

export const GRID_SHAPE_PARAMETERS = Object.freeze({
    grid_rectilinear: Object.freeze({
        label: 'Rectilinear Grid',
        stateKey: 'rectilinear',
        groupId: 'grid_rectilinear_controls',
        controls: Object.freeze([
            Object.freeze({
                key: 'xSpacing',
                controlId: 'rectilinear_x_spacing_slider',
                valueId: 'rectilinear_x_spacing_value_display',
                label: 'X spacing',
                min: 0.45,
                max: 2.5,
                step: 0.05,
                value: 1
            }),
            Object.freeze({
                key: 'ySpacing',
                controlId: 'rectilinear_y_spacing_slider',
                valueId: 'rectilinear_y_spacing_value_display',
                label: 'Y spacing',
                min: 0.45,
                max: 2.5,
                step: 0.05,
                value: 1
            })
        ])
    }),
    grid_nonorthogonal: Object.freeze({
        label: 'Non-orthogonal Grid',
        stateKey: 'nonOrthogonal',
        groupId: 'grid_nonorthogonal_controls',
        controls: Object.freeze([
            Object.freeze({
                key: 'angle',
                controlId: 'nonorthogonal_angle_slider',
                valueId: 'nonorthogonal_angle_value_display',
                label: 'Skew angle',
                min: 8,
                max: 72,
                step: 1,
                value: 28,
                suffix: '°'
            }),
            Object.freeze({
                key: 'spacing',
                controlId: 'nonorthogonal_spacing_slider',
                valueId: 'nonorthogonal_spacing_value_display',
                label: 'Cell spacing',
                min: 0.55,
                max: 2,
                step: 0.05,
                value: 1
            })
        ])
    }),
    grid_triangular: Object.freeze({
        label: 'Triangular Grid',
        stateKey: 'triangular',
        groupId: 'grid_triangular_controls',
        controls: Object.freeze([
            Object.freeze({
                key: 'size',
                controlId: 'triangular_size_slider',
                valueId: 'triangular_size_value_display',
                label: 'Triangle size',
                min: 0.55,
                max: 2,
                step: 0.05,
                value: 1
            }),
            Object.freeze({
                key: 'rotation',
                controlId: 'triangular_rotation_slider',
                valueId: 'triangular_rotation_value_display',
                label: 'Rotation',
                min: -30,
                max: 30,
                step: 1,
                value: 0,
                suffix: '°'
            })
        ])
    }),
    grid_curvilinear: Object.freeze({
        label: 'Curvilinear Grid',
        stateKey: 'curvilinear',
        groupId: 'grid_curvilinear_controls',
        controls: Object.freeze([
            Object.freeze({
                key: 'bend',
                controlId: 'curvilinear_bend_slider',
                valueId: 'curvilinear_bend_value_display',
                label: 'Arc bend',
                min: 0.15,
                max: 1,
                step: 0.05,
                value: 0.65
            }),
            Object.freeze({
                key: 'focus',
                controlId: 'curvilinear_focus_slider',
                valueId: 'curvilinear_focus_value_display',
                label: 'Focus offset',
                min: -1,
                max: 1,
                step: 0.05,
                value: 0
            })
        ])
    }),
    grid_spiral: Object.freeze({
        label: 'Spiral Grid',
        stateKey: 'spiral',
        groupId: 'grid_spiral_controls',
        controls: Object.freeze([
            Object.freeze({
                key: 'turns',
                controlId: 'spiral_turns_slider',
                valueId: 'spiral_turns_value_display',
                label: 'Turns',
                min: 0.5,
                max: 5,
                step: 0.1,
                value: 2.5
            }),
            Object.freeze({
                key: 'tightness',
                controlId: 'spiral_tightness_slider',
                valueId: 'spiral_tightness_value_display',
                label: 'Tightness',
                min: 0.2,
                max: 1.5,
                step: 0.05,
                value: 0.8
            }),
            Object.freeze({
                key: 'arms',
                controlId: 'spiral_arms_slider',
                valueId: 'spiral_arms_value_display',
                label: 'Arms',
                min: 1,
                max: 6,
                step: 1,
                value: 2
            })
        ])
    }),
    grid_irregular: Object.freeze({
        label: 'Irregular-spaced Grid',
        stateKey: 'irregular',
        groupId: 'grid_irregular_controls',
        controls: Object.freeze([
            Object.freeze({
                key: 'variation',
                controlId: 'irregular_variation_slider',
                valueId: 'irregular_variation_value_display',
                label: 'Spacing variation',
                min: 0,
                max: 0.8,
                step: 0.05,
                value: 0.35
            }),
            Object.freeze({
                key: 'clustering',
                controlId: 'irregular_clustering_slider',
                valueId: 'irregular_clustering_value_display',
                label: 'Clustering',
                min: -1,
                max: 1,
                step: 0.05,
                value: 0
            })
        ])
    })
});

export const GRID_SHAPE_DEFAULTS = Object.freeze(
    Object.fromEntries(
        Object.values(GRID_SHAPE_PARAMETERS).map(definition => [
            definition.stateKey,
            Object.freeze(Object.fromEntries(
                definition.controls.map(control => [control.key, control.value])
            ))
        ])
    )
);

export function isCustomGridInputShape(shape) {
    return CUSTOM_GRID_INPUT_SHAPE_SET.has(shape);
}
