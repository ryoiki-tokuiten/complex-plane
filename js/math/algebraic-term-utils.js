import { mutateState } from '../store/state.js';
import { requestDomainRedraw } from '../rendering/redraw-scheduler.js';

export const createAlgebraicFactor = (func = 'cos') => ({
    func,
    chainedFunc: 'none',
    power: 1,
    reciprocal: false,
    log: false,
    exp: false
});

const createAlgebraicTerm = () => ({
    coeff: { re: 1, im: 0 },
    factors: [createAlgebraicFactor()]
});

function mutate(mutator, path) {
    mutateState('algebraicChainingTerms', mutator, path);
    requestDomainRedraw();
}

export function appendAlgebraicTerm() {
    mutate(terms => terms.push(createAlgebraicTerm()), 'algebraicChainingTerms');
}
