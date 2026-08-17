import { state } from '../store/state.js';
import { findNativePreimages, nativeMapOptions } from '../native/complex-engine.js';

export function findPreimages(target, map, bounds, options = {}) {
    if (!Number.isFinite(target?.re) || !Number.isFinite(target?.im)) return [];
    const xRange = bounds?.xRange;
    const yRange = bounds?.yRange;
    if (!Array.isArray(xRange) || !Array.isArray(yRange)) return [];
    const mapConfig = map?.functionKey ? map : nativeMapOptions(state, {
        stage: map?.stage,
        derivativeMode: map?.presentation === 'derivative',
        ...(map?.evaluate?.nativeMapOptions || {})
    });
    return findNativePreimages({ map: mapConfig, target, xRange, yRange, ...options });
}
