// js/constants/rendering.js

export const DEFAULT_CANVAS_WIDTH = 600;
export const DEFAULT_CANVAS_HEIGHT = 450;
export const ORIGIN_GLOW_DURATION_MS = 500;

export const WEBGL_LINE_BATCH_LIMIT = 3500000;
export const WEBGL_SUPERSAMPLE_FACTOR = 2.25;
export const WEBGL_DOMAIN_COLOR_SUPERSAMPLE = 2.0;

export const ORBIT_COLORING_MODES = Object.freeze({
    value: 'value',
    escape: 'escape',
    attractor: 'attractor',
    hybrid: 'hybrid'
});

export const ORBIT_COLORING_MODE_LABELS = Object.freeze({
    value: 'Final Value',
    escape: 'Escape',
    attractor: 'Attractor',
    hybrid: 'Hybrid'
});

export const ORBIT_COLORING_MODE_IDS = Object.freeze({
    value: 0,
    escape: 1,
    attractor: 2,
    hybrid: 3
});

export const DEFAULT_ORBIT_COLORING_MODE = ORBIT_COLORING_MODES.value;

export function normalizeOrbitColoringMode(mode) {
    if (Object.prototype.hasOwnProperty.call(ORBIT_COLORING_MODES, mode)) {
        return mode;
    }
    return DEFAULT_ORBIT_COLORING_MODE;
}

export function orbitColoringModeId(mode) {
    const normalized = normalizeOrbitColoringMode(mode);
    return ORBIT_COLORING_MODE_IDS[normalized] ?? ORBIT_COLORING_MODE_IDS.value;
}

export const SPHERE_VIEW_RADIUS_FACTOR = 0.85;
export const SPHERE_INITIAL_ROT_X = 0.4;
export const SPHERE_INITIAL_ROT_Y = -0.6;
export const SPHERE_SENSITIVITY = 0.01;
export const SPHERE_TEXTURE_AMBIENT_INTENSITY = 0.3;
export const SPHERE_TEXTURE_DIFFUSE_INTENSITY = 0.7;
export const SPHERE_TEXTURE_SPECULAR_INTENSITY = 0.6;
export const SPHERE_TEXTURE_SHININESS_FACTOR = 32;
export const SPHERE_LIGHT_DIRECTION_CAMERA = { x: 0.5, y: 0.5, z: 0.707 };
export const SPHERE_GRID_LINE_MAX_WIDTH_W = 1.5;
export const SPHERE_GRID_LINE_MAX_WIDTH_Z = 1.0;
export const SPHERE_GRID_LINE_DEPTH_EFFECT = true;

export const PARTICLE_RADIUS = 1.5;

export const LINE_WIDTH_NORMAL = 1.5;
export const LINE_WIDTH_THIN = 1.0;
export const LINE_WIDTH_THICK = 2.5;
