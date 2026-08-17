import {
    evaluateNativeAlgebraic,
    evaluateNativePoints,
    renderNativeDomainTile
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

function pointResult(snapshot, re, im) {
    const point = { re, im };
    try {
        const result = snapshot.functionKey === 'algebraic_chaining'
            ? evaluateNativeAlgebraic(snapshot, [point], [point])
            : evaluateNativePoints(snapshot, [point]);
        return result.valid[0] ? result.values[0] : null;
    } catch {
        return null;
    }
}

export function evaluateDomainDynamicsValue(snapshot, re, im) {
    return pointResult(snapshot, re, im);
}

export function renderDomainDynamicsTile(snapshot, tile) {
    return renderNativeDomainTile(snapshot, tile);
}

export function createDomainDynamicsTileRenderer(snapshot) {
    return tile => renderDomainDynamicsTile(snapshot, tile);
}

export function colorDomainDynamicsPoint(snapshot, re, im) {
    const pointSnapshot = {
        ...snapshot,
        viewport: {
            width: 1,
            height: 1,
            xRange: [re - 0.5, re + 0.5],
            yRange: [im - 0.5, im + 0.5]
        }
    };
    const pixel = renderNativeDomainTile(pointSnapshot, {
        x: 0, y: 0, width: 1, height: 1, scale: 1
    });
    return [pixel[0], pixel[1], pixel[2]];
}

export function domainDynamicsSignature(snapshot) {
    return JSON.stringify({
        functionKey: snapshot.functionKey,
        derivativeMode: !!snapshot.derivativeMode,
        expBase: snapshot.expBase,
        logBase: snapshot.logBase,
        besselOrder: snapshot.besselOrder,
        chainingEnabled: snapshot.chainingEnabled,
        chainMode: snapshot.chainMode,
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

export function isDomainDynamicsSnapshot(snapshot) {
    return !!snapshot && !snapshot.isWPlaneColoring &&
        (snapshot.chainMode === 'recursion' || snapshot.chainMode === 'zero_seed');
}
