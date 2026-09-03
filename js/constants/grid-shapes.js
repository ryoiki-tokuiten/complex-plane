export const CUSTOM_GRID_INPUT_SHAPES = [
    'grid_rectilinear',
    'grid_nonorthogonal',
    'grid_triangular',
    'grid_curvilinear',
    'grid_spiral',
    'grid_irregular'
];

export const CUSTOM_GRID_INPUT_SHAPE_SET = new Set(CUSTOM_GRID_INPUT_SHAPES);

const control = (key, id, label, min, max, step, value, tooltip, suffix = '') => ({
    key,
    controlId: `${id}_slider`,
    valueId: `${id}_value_display`,
    label,
    min,
    max,
    step,
    value,
    tooltip,
    suffix
});

const grid = (label, stateKey, controls) => ({ label, stateKey, controls });

export const GRID_SHAPE_PARAMETERS = {
    grid_rectilinear: grid('Rectilinear Grid', 'rectilinear', [
        control('xSpacing', 'rectilinear_x_spacing', 'X spacing', 0.45, 2.5, 0.05, 1, 'Adjust the horizontal cell spacing'),
        control('ySpacing', 'rectilinear_y_spacing', 'Y spacing', 0.45, 2.5, 0.05, 1, 'Adjust the vertical cell spacing')
    ]),
    grid_nonorthogonal: grid('Non-orthogonal Grid', 'nonOrthogonal', [
        control('angle', 'nonorthogonal_angle', 'Skew angle', 8, 72, 1, 28, 'Adjust the angle between grid families', '°'),
        control('spacing', 'nonorthogonal_spacing', 'Cell spacing', 0.55, 2, 0.05, 1, 'Adjust the non-orthogonal cell size')
    ]),
    grid_triangular: grid('Triangular Grid', 'triangular', [
        control('size', 'triangular_size', 'Triangle size', 0.55, 2, 0.05, 1, 'Adjust the triangular cell size'),
        control('rotation', 'triangular_rotation', 'Rotation', -30, 30, 1, 0, 'Rotate the triangular lattice', '°')
    ]),
    grid_curvilinear: grid('Curvilinear Grid', 'curvilinear', [
        control('bend', 'curvilinear_bend', 'Arc bend', 0.15, 1, 0.05, 0.65, 'Adjust the curvature of the grid arcs'),
        control('focus', 'curvilinear_focus', 'Focus offset', -1, 1, 0.05, 0, 'Move the curvilinear focus left or right')
    ]),
    grid_spiral: grid('Spiral Grid', 'spiral', [
        control('turns', 'spiral_turns', 'Turns', 0.5, 5, 0.1, 2.5, 'Adjust the number of spiral turns'),
        control('tightness', 'spiral_tightness', 'Tightness', 0.2, 1.5, 0.05, 0.8, 'Adjust how tightly the spiral winds'),
        control('arms', 'spiral_arms', 'Arms', 1, 6, 1, 2, 'Adjust the number of interlaced spiral arms')
    ]),
    grid_irregular: grid('Irregular-spaced Grid', 'irregular', [
        control('variation', 'irregular_variation', 'Spacing variation', 0, 0.8, 0.05, 0.35, 'Adjust the amount of irregular spacing'),
        control('clustering', 'irregular_clustering', 'Clustering', -1, 1, 0.05, 0, 'Bias the spacing toward clustered bands')
    ])
};

export const GRID_SHAPE_DEFAULTS = Object.fromEntries(
    Object.values(GRID_SHAPE_PARAMETERS).map(({ stateKey, controls }) => [
        stateKey,
        Object.fromEntries(controls.map(({ key, value }) => [key, value]))
    ])
);

export function formatGridValue(value, { step, suffix }) {
    const decimals = String(step).split('.')[1]?.length || 0;
    return `${decimals ? Number(value).toFixed(decimals) : Math.round(value)}${suffix}`;
}
