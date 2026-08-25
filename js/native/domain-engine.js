import {
    createCompiledDomainTileRenderer
} from './complex-engine.js';

function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    return Object.freeze(value);
}

export function freezeDomainDynamicsSnapshot(snapshot) {
    return deepFreeze(snapshot);
}

export function createDomainDynamicsTileRenderer(snapshot) {
    return createCompiledDomainTileRenderer(snapshot);
}

export function domainDynamicsSignature(snapshot) {
    return JSON.stringify({
        functionKey: snapshot.functionKey,
        derivativeOrder: snapshot.derivativeOrder,
        expBase: snapshot.expBase,
        logBase: snapshot.logBase,
        besselOrder: snapshot.besselOrder,
        chainingEnabled: snapshot.chainingEnabled,
        chainMode: snapshot.chainMode,
        chainSeed: snapshot.chainSeed,
        chainCount: snapshot.chainCount,
        orbitColoringMode: snapshot.orbitColoringMode,
        algebraicChainingEnabled: snapshot.algebraicChainingEnabled,
        algebraicChainingTerms: snapshot.algebraicChainingTerms,
        algebraicChainingZExpr: snapshot.algebraicChainingZExpr,
        polynomialN: snapshot.polynomialN,
        polynomialCoeffs: snapshot.polynomialCoeffs,
        mobiusA: snapshot.mobiusA,
        mobiusB: snapshot.mobiusB,
        mobiusC: snapshot.mobiusC,
        mobiusD: snapshot.mobiusD,
        fractionalPowerN: snapshot.fractionalPowerN,
        branchCutType: snapshot.branchCutType,
        branchCutAngle: snapshot.branchCutAngle,
        zetaContinuationEnabled: snapshot.zetaContinuationEnabled,
        taylor: snapshot.taylor,
        dynamicAggregate: snapshot.dynamicAggregate,
        style: snapshot.style,
        paletteStops: snapshot.paletteStops,
        viewport: snapshot.viewport
    });
}
