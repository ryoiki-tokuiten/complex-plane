import { state, context } from '../store/state.js';
import { isFoldableInputShape } from '../rendering/shape-generators.js';

const { controls } = context;

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
        source = state,
        slider = controls.gridDensitySlider,
        valueDisplay = controls.gridDensityValueDisplay
    } = options;

    if (!slider) return;

    const extended = isExtendedGridDensityNeeded(source);
    slider.max = extended
        ? String(GRID_DENSITY_LIMITS.extended)
        : String(GRID_DENSITY_LIMITS.standard);

    if (source.graphLayerLockEnabled) {
        source.gridDensity = GRID_DENSITY_LIMITS.layerLock;
    } else if (source.currentInputShape === 'grid_dots') {
        source.gridDensity = GRID_DENSITY_LIMITS.dotsDefault;
    } else if (applyFoldDefault && source.foldSurface3dEnabled && isFoldableInputShape(source.currentInputShape)) {
        source.gridDensity = GRID_DENSITY_LIMITS.foldDefault;
    } else if (!extended && source.gridDensity > GRID_DENSITY_LIMITS.standard) {
        source.gridDensity = GRID_DENSITY_LIMITS.standard;
    }

    slider.value = String(source.gridDensity);
    if (valueDisplay) {
        valueDisplay.textContent = String(source.gridDensity);
    }
}
