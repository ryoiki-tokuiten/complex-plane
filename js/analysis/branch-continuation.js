import {
    continuationNativeSheet,
    evaluateNativeSheets,
    nativeMapOptions
} from '../native/complex-engine.js';

export function branchCutCrossingForSegment(a, b, branchCutType, branchCutAngle, branchCutPoints) {
    return continuationNativeSheet([a, b], branchCutType, branchCutAngle, branchCutPoints);
}

export function continuationSheetForPath(path, branchCutType, branchCutAngle, branchCutPoints) {
    return continuationNativeSheet(path, branchCutType, branchCutAngle, branchCutPoints);
}

export function evaluateOnSheet(functionKey, point, sheet, runtimeState) {
    const map = nativeMapOptions(runtimeState, {
        functionKey,
        chainingEnabled: runtimeState.chainingEnabled,
        chainCount: runtimeState.chainingEnabled ? runtimeState.chainCount : 1
    });
    const result = evaluateNativeSheets(map, [point], [sheet]);
    return result.valid[0] ? result.values[0] : { re: NaN, im: NaN };
}
