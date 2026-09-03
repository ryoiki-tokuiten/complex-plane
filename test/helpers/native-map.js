import { state } from '../../js/store/state.js';
import {
    evaluateNativeAlgebraic,
    evaluateNativePoints,
    nativeMapOptions
} from '../../js/native/complex-engine.js';

const invalid = () => ({ re: NaN, im: NaN });

function point(re, im) {
    return re && typeof re === 'object'
        ? { re: Number(re.re), im: Number(re.im) }
        : { re: Number(re), im: Number(im) };
}

export function completeNativeMapOptions(overrides = {}) {
    return nativeMapOptions(state, overrides);
}

export function completeRuntimeState(overrides = {}) {
    return { ...state, ...overrides };
}

export function evaluateAlgebraicTerm(term, re, im, context = null) {
    const input = point(re, im);
    const parameter = point(context?.c ?? input);
    const result = evaluateNativeAlgebraic(nativeMapOptions(state, {
        functionKey: 'algebraic_chaining',
        algebraicChainingEnabled: true,
        algebraicChainingTerms: [term],
        chainingEnabled: false,
        chainCount: 1,
        derivativeOrder: 0
    }), [input], [parameter]);
    return result.valid[0] ? result.values[0] : invalid();
}

export function evaluateAlgebraicChaining(re, im, context = null) {
    const input = point(re, im);
    const parameter = point(context?.c ?? input);
    const result = evaluateNativeAlgebraic(nativeMapOptions(state, {
        functionKey: 'algebraic_chaining',
        chainingEnabled: false,
        chainCount: 1,
        derivativeOrder: 0
    }), [input], [parameter]);
    return result.valid[0] ? result.values[0] : invalid();
}

export function evaluateDomainColoringMappedTransform(_profile, re, im, functionKey = state.currentFunction) {
    const result = evaluateNativePoints(nativeMapOptions(state, {
        functionKey,
        chainingEnabled: state.chainingEnabled,
        chainCount: state.chainingEnabled ? state.chainCount : 1
    }), [point(re, im)]);
    return result.valid[0] ? result.values[0] : invalid();
}
