import { state } from '../store/state.js';
import { getChainedStageTransformFunction } from '../math-utils.js';

export const MAP_PRESENTATION = Object.freeze({
    function: 'function',
    derivative: 'derivative'
});

const DERIVATIVE_STEP = 1e-6;
const NESTED_DERIVATIVE_STEP_MULTIPLIER = 100;
const INVALID = Object.freeze({ re: NaN, im: NaN });

function finiteComplex(value) {
    return !!value && Number.isFinite(value.re) && Number.isFinite(value.im);
}

function normalizeStageIndex(stageIndex) {
    return Math.max(0, Math.floor(Number.isFinite(stageIndex) ? stageIndex : 0));
}

function derivativeStep(re, im, multiplier = 1) {
    return DERIVATIVE_STEP * multiplier * Math.max(1, Math.abs(re), Math.abs(im));
}

function sourceSignature() {
    return JSON.stringify({
        function: state.currentFunction,
        chaining: state.chainingEnabled,
        chainCount: state.chainCount,
        chainMode: state.chainingMode,
        algebraic: state.algebraicChainingTerms,
        algebraicZExpr: state.algebraicChainingZExpr,
        mobius: [state.mobiusA, state.mobiusB, state.mobiusC, state.mobiusD],
        polynomial: [state.polynomialN, state.polynomialCoeffs],
        fractionalPower: state.fractionalPowerN,
        zetaContinuationEnabled: state.zetaContinuationEnabled,
        taylor: [state.taylorSeriesEnabled, state.taylorSeriesCenter, state.taylorSeriesOrder],
        dynamic: state.dynamicPlotting
    });
}

export function getFinalMapStageIndex(runtimeState = state) {
    if (!runtimeState?.chainingEnabled) return 0;
    return normalizeStageIndex((runtimeState.chainCount || 1) - 1);
}

export function createDerivativeTransform(transform, stepMultiplier = 1) {
    return (re, im) => {
        if (typeof transform !== 'function' || !Number.isFinite(re) || !Number.isFinite(im)) {
            return INVALID;
        }

        const h = derivativeStep(re, im, stepMultiplier);
        const right = transform(re + h, im);
        const left = transform(re - h, im);

        if (!finiteComplex(right) || !finiteComplex(left)) return INVALID;

        return {
            re: (right.re - left.re) / (2 * h),
            im: (right.im - left.im) / (2 * h)
        };
    };
}

export function resolveActiveMap(stageIndex = getFinalMapStageIndex()) {
    const stage = normalizeStageIndex(stageIndex);
    const baseMap = getChainedStageTransformFunction(state.currentFunction, stage);
    const baseDerivative = createDerivativeTransform(baseMap);
    const presentation = state.mapPresentation === MAP_PRESENTATION.derivative
        ? MAP_PRESENTATION.derivative
        : MAP_PRESENTATION.function;
    const evaluate = presentation === MAP_PRESENTATION.derivative ? baseDerivative : baseMap;
    const derivative = presentation === MAP_PRESENTATION.derivative
        ? createDerivativeTransform(baseDerivative, NESTED_DERIVATIVE_STEP_MULTIPLIER)
        : baseDerivative;

    return Object.freeze({
        stage,
        presentation,
        derivative,
        evaluate,
        signature: `${presentation}:${stage}:${sourceSignature()}`
    });
}

export function isDerivativePresentation(runtimeState = state) {
    return runtimeState?.mapPresentation === MAP_PRESENTATION.derivative;
}

export function getDerivativeStepForPoint(re, im) {
    return derivativeStep(re, im);
}
