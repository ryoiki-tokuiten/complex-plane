import { state } from '../store/state.js';
import { evaluateNativePoints, nativeMapOptions } from '../native/complex-engine.js';

export const MAP_PRESENTATION = Object.freeze({
    function: 'function',
    derivative: 'derivative'
});

function normalizeStageIndex(stageIndex) {
    return Math.max(0, Math.floor(Number.isFinite(stageIndex) ? stageIndex : 0));
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
        branchCut: [state.branchCutType, state.branchCutAngle],
        zetaContinuationEnabled: state.zetaContinuationEnabled,
        taylor: [state.taylorSeriesEnabled, state.taylorSeriesCenter, state.taylorSeriesOrder],
        dynamic: state.dynamicPlotting
    });
}

export function getFinalMapStageIndex(runtimeState = state) {
    if (!runtimeState?.chainingEnabled) return 0;
    return normalizeStageIndex((runtimeState.chainCount || 1) - 1);
}

function createNativeEvaluator(stage, derivativeOrder) {
    const options = nativeMapOptions(state, {
        stage,
        derivativeOrder,
        derivativeMode: derivativeOrder > 0
    });
    const evaluator = (re, im) => {
        if (!Number.isFinite(re) || !Number.isFinite(im)) {
            return { re: NaN, im: NaN };
        }
        try {
            const result = evaluateNativePoints(options, [{ re, im }]);
            return result.valid[0] ? result.values[0] : { re: NaN, im: NaN };
        } catch {
            return { re: NaN, im: NaN };
        }
    };
    Object.defineProperty(evaluator, 'nativeMapOptions', { value: options });
    return evaluator;
}

export function resolveActiveMap(stageIndex = getFinalMapStageIndex()) {
    const stage = normalizeStageIndex(stageIndex);
    const presentation = state.mapPresentation === MAP_PRESENTATION.derivative
        ? MAP_PRESENTATION.derivative
        : MAP_PRESENTATION.function;

    const baseMap = createNativeEvaluator(stage, 0);
    const baseDerivative = createNativeEvaluator(stage, 1);
    const secondDerivative = createNativeEvaluator(stage, 2);

    const evaluate = presentation === MAP_PRESENTATION.derivative ? baseDerivative : baseMap;
    const derivative = presentation === MAP_PRESENTATION.derivative ? secondDerivative : baseDerivative;

    return Object.freeze({
        stage,
        presentation,
        derivative,
        evaluate,
        signature: `${presentation}:${stage}:${sourceSignature()}`
    });
}

