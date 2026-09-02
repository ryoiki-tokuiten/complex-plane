import { state } from '../store/state.js';
import { isFoldableInputShape } from '../rendering/shape-generators.js';

const GRID_DENSITY_LIMITS = Object.freeze({
    standard: 50,
    extended: 250,
    foldDefault: 100,
    layerLock: 150,
    dotsDefault: 250
});

function isExtendedGridDensityNeeded(source = state) {
    return Boolean(
        (source.foldSurface3dEnabled && isFoldableInputShape(source.currentInputShape)) ||
        source.currentInputShape === 'grid_dots' ||
        source.graphViewEnabled ||
        source.manifold3dViewEnabled ||
        source.manifoldTransformationEnabled
    );
}

export function syncGridDensityControls(options = {}) {
    const {
        applyFoldDefault = false,
        source = state
    } = options;

    const extended = isExtendedGridDensityNeeded(source);

    if (source.graphLayerLockEnabled) {
        source.gridDensity = GRID_DENSITY_LIMITS.layerLock;
    } else if (source.currentInputShape === 'grid_dots') {
        source.gridDensity = GRID_DENSITY_LIMITS.dotsDefault;
    } else if (applyFoldDefault && source.foldSurface3dEnabled && isFoldableInputShape(source.currentInputShape)) {
        source.gridDensity = GRID_DENSITY_LIMITS.foldDefault;
    } else if (!extended && source.gridDensity > GRID_DENSITY_LIMITS.standard) {
        source.gridDensity = GRID_DENSITY_LIMITS.standard;
    }

    return extended ? GRID_DENSITY_LIMITS.extended : GRID_DENSITY_LIMITS.standard;
}

export const gridDensityMax = source => isExtendedGridDensityNeeded(source)
    ? GRID_DENSITY_LIMITS.extended
    : GRID_DENSITY_LIMITS.standard;
