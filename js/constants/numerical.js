// js/constants/numerical.js

export const TWO_PI = 2 * Math.PI;
export const PI = TWO_PI / 2;

export const NUM_POINTS_CURVE = 1600;
export const NUM_ZETA_TERMS_DIRECT_SUM = 100;   
export const NUM_ZETA_TERMS_ETA_SERIES = 500;
export const NUM_ZETA_HASSE_LEVELS = 32;
export const MAX_POLY_DEGREE = 10;
export const ZERO_POLE_EPSILON = 1e-4;
export const ZERO_POLE_GRID_SIZE = 100;
export const POLE_MAGNITUDE_THRESHOLD = 5e3;
export const CRITICAL_POINT_FIND_GRID_SIZE = 60;
export const CRITICAL_POINT_EPSILON = 1e-5;
export const ZP_CP_CHECK_DISTANCE_FACTOR = 1.5;

export const MIN_POINTS_ADAPTIVE = 2000;
export const MAX_POINTS_ADAPTIVE_DEFAULT = 10000;
export const DEFAULT_POINTS_PER_LINE = 2500;

export const ZETA_POLE = { re: 1, im: 0 };
export const ZETA_REFLECTION_POINT_RE = 1.0;
export const ZOOM_IN_FACTOR = 1.15;
export const ZOOM_OUT_FACTOR = 1 / ZOOM_IN_FACTOR;
export const MIN_STATE_ZOOM_LEVEL = 1e-15;
export const MAX_STATE_ZOOM_LEVEL = 1e24;
export const NUM_INTEGRAL_STEPS = 250;
export const RESIDUE_CALC_EPSILON_RADIUS = 0.02;
export const NUM_RESIDUE_INTEGRAL_STEPS = 100;
export const RESIDUE_BOUNDARY_CHECK_FACTOR = 1.5;
export const PROBE_CROSSHAIR_SIZE_FACTOR = 3.5;
export const DEFAULT_TAYLOR_SERIES_CENTER = Object.freeze({ re: 0, im: 0 });
export const TAYLOR_CENTER_PRESET_GROUPS = Object.freeze([
    Object.freeze({
        label: 'Real Axis',
        presets: Object.freeze([
            Object.freeze({ label: '0', re: 0, im: 0 }),
            Object.freeze({ label: '+1', re: 1, im: 0 }),
            Object.freeze({ label: '-1', re: -1, im: 0 }),
            Object.freeze({ label: 'pi/4', re: PI / 4, im: 0 }),
            Object.freeze({ label: '-pi/4', re: -PI / 4, im: 0 }),
            Object.freeze({ label: 'pi/2', re: PI / 2, im: 0 }),
            Object.freeze({ label: '-pi/2', re: -PI / 2, im: 0 }),
            Object.freeze({ label: '3pi/4', re: (3 * PI) / 4, im: 0 }),
            Object.freeze({ label: 'pi', re: PI, im: 0 }),
            Object.freeze({ label: '-pi', re: -PI, im: 0 }),
            Object.freeze({ label: '2pi', re: TWO_PI, im: 0 }),
            Object.freeze({ label: '-2pi', re: -TWO_PI, im: 0 }),
            Object.freeze({ label: '4pi', re: 2 * TWO_PI, im: 0 }),
            Object.freeze({ label: '-4pi', re: -2 * TWO_PI, im: 0 })
        ])
    }),
    Object.freeze({
        label: 'Imaginary Axis',
        presets: Object.freeze([
            Object.freeze({ label: 'i', re: 0, im: 1 }),
            Object.freeze({ label: '-i', re: 0, im: -1 }),
            Object.freeze({ label: 'pi*i', re: 0, im: PI }),
            Object.freeze({ label: '-pi*i', re: 0, im: -PI }),
            Object.freeze({ label: '2pi*i', re: 0, im: TWO_PI }),
            Object.freeze({ label: '-2pi*i', re: 0, im: -TWO_PI })
        ])
    })
]);
export const TAYLOR_CENTER_PRESETS = Object.freeze(TAYLOR_CENTER_PRESET_GROUPS.flatMap(group => group.presets));
