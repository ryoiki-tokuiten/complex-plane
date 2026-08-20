// js/constants/rendering.js

export const DEFAULT_CANVAS_WIDTH = 600;
export const DEFAULT_CANVAS_HEIGHT = 450;
export const ORIGIN_GLOW_DURATION_MS = 500;

export const PLANAR_CANVAS_SUPERSAMPLE = 2;

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

export function normalizeOrbitColoringMode(mode) {
    if (!Object.prototype.hasOwnProperty.call(ORBIT_COLORING_MODES, mode)) {
        throw new Error(`Unsupported orbit-coloring mode: ${mode}`);
    }
    return mode;
}

export function orbitColoringModeId(mode) {
    return ORBIT_COLORING_MODE_IDS[normalizeOrbitColoringMode(mode)];
}

export const SPHERE_VIEW_RADIUS_FACTOR = 0.85;
export const SPHERE_INITIAL_ROT_X = 0.4;
export const SPHERE_INITIAL_ROT_Y = -0.6;
export const SPHERE_SENSITIVITY = 0.01;
export const SPHERE_GRID_LINE_MAX_WIDTH_W = 1.5;
export const SPHERE_GRID_LINE_MAX_WIDTH_Z = 1.0;
export const SPHERE_GRID_LINE_DEPTH_EFFECT = true;

export const PARTICLE_RADIUS = 1.5;

export const LINE_WIDTH_NORMAL = 1.5;
export const LINE_WIDTH_THIN = 1.0;
export const LINE_WIDTH_THICK = 2.5;
