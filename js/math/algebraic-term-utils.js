import { getStateSignal, mutateState } from '../store/state.js';
import { requestDomainRedraw } from '../rendering/redraw-scheduler.js';
import { syncParameterControlsPanelVisibility, updateTitlesAndGlobalUI } from '../ui/ui-updates.js';

export const createAlgebraicFactor = (func = 'cos') => ({
    func,
    chainedFunc: 'none',
    power: 1,
    reciprocal: false,
    log: false,
    exp: false
});

export const createAlgebraicTerm = () => ({
    coeff: { re: 1, im: 0 },
    factors: [createAlgebraicFactor()]
});

function redraw(commit = false) {
    if (commit) {
        updateTitlesAndGlobalUI();
        syncParameterControlsPanelVisibility();
    }
    requestDomainRedraw();
}

function mutate(mutator, path, commit = false) {
    mutateState('algebraicChainingTerms', mutator, path);
    redraw(commit);
}

export function appendAlgebraicTerm() {
    mutate(terms => terms.push(createAlgebraicTerm()), 'algebraicChainingTerms', true);
}
