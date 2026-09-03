import { state } from '../store/state.js';
import { evaluateNativePoints } from '../native/complex-engine.js';
import {
    buildMappedTransformProfileKey,
    resolveNativeMapOptions
} from '../native/map-runtime.js';

const MAP_PRESENTATION = Object.freeze({
    function: 'function',
    derivative: 'derivative'
});

function normalizeStageIndex(stageIndex) {
    if (!Number.isInteger(stageIndex) || stageIndex < 0) {
        throw new Error('Native map stage must be a non-negative integer.');
    }
    return stageIndex;
}

function sourceSignature() {
    return JSON.stringify({
        mappedProfile: buildMappedTransformProfileKey(state.currentFunction),
        chaining: state.chainingEnabled,
        chainCount: state.chainCount,
        chainMode: state.chainingMode,
        chainSeed: state.chainSeed,
        taylor: [state.taylorSeriesEnabled, state.taylorSeriesCenter, state.taylorSeriesOrder,
            String(state.taylorSeriesConvergenceRadius)],
        dynamic: state.dynamicPlotting
    });
}

function getFinalMapStageIndex(runtimeState = state) {
    if (!runtimeState || typeof runtimeState.chainingEnabled !== 'boolean') {
        throw new Error('Native map state requires an explicit chainingEnabled flag.');
    }
    if (!runtimeState.chainingEnabled) return 0;
    return normalizeStageIndex(runtimeState.chainCount - 1);
}

function createNativeEvaluator(stage, derivativeOrder) {
    const options = resolveNativeMapOptions(state.currentFunction, stage, derivativeOrder);
    const evaluator = (re, im) => {
        if (!Number.isFinite(re) || !Number.isFinite(im)) {
            return { re: NaN, im: NaN };
        }
        const result = evaluateNativePoints(options, [{ re, im }]);
        return result.valid[0] ? result.values[0] : { re: NaN, im: NaN };
    };
    evaluator.evaluateBatch = points => {
        const result = evaluateNativePoints(options, points);
        return result.values.map((value, index) => result.valid[index] ? value : { re: NaN, im: NaN });
    };
    Object.defineProperty(evaluator, 'nativeMapOptions', { value: options });
    return evaluator;
}

export function resolveActiveMap(stageIndex = getFinalMapStageIndex()) {
    // This dispatcher serves ordinary mapped geometry and analysis queries. The
    // domain-coloring renderer has its own native tile pipeline.
    const stage = normalizeStageIndex(stageIndex);
    const presentation = state.mapPresentation;
    if (presentation !== MAP_PRESENTATION.function && presentation !== MAP_PRESENTATION.derivative) {
        throw new Error(`Unsupported native map presentation: ${presentation}.`);
    }

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
        evaluateBatch: evaluate.evaluateBatch,
        signature: `${presentation}:${stage}:${sourceSignature()}`
    });
}
