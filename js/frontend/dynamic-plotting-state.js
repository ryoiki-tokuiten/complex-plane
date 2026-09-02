import { mutateState } from '../store/state.js';
import {
    applyDynamicPlottingPreset,
    invalidateDynamicPlotting
} from '../analysis/dynamic-plotting.js';
import { synchronizeSequenceBindings } from '../analysis/sequence-bindings.js';
import { requestDomainRedraw, requestUiRedraw } from '../rendering/redraw-scheduler.js';

function synchronizeBindings(dynamic) {
    if (dynamic.term?.kind === 'expression') {
        dynamic.term.bindings = synchronizeSequenceBindings(
            dynamic.term.expression,
            dynamic.term.bindings
        );
    }
}

export function updateDynamicPlotting(mutator, options = {}) {
    mutateState('dynamicPlotting', dynamic => {
        mutator(dynamic);
        synchronizeBindings(dynamic);
        if (!options.preservePreset) dynamic.preset = 'custom';
    });
    invalidateDynamicPlotting();
    if (options.domainDirty === false) requestUiRedraw();
    else requestDomainRedraw();
}

export function applyDynamicPlottingPresetFromUI(presetId) {
    if (!presetId) return;
    applyDynamicPlottingPreset(presetId);
    mutateState('dynamicPlotting', synchronizeBindings, 'dynamicPlotting.term.bindings');
    requestDomainRedraw();
}
