import { parseExpression, walkExpression } from '../math/expression/parser.js';

const MULTIVALUED_FUNCTIONS = new Set(['ln', 'power']);

function isIntegerLike(value) {
    return Number.isFinite(value) && Math.abs(value - Math.round(value)) < 1e-9;
}

export function isMultivaluedFunction(functionKey, runtimeState) {
    if (!MULTIVALUED_FUNCTIONS.has(functionKey)) return false;
    if (functionKey === 'power') {
        const exponent = runtimeState && Number.isFinite(runtimeState.fractionalPowerN)
            ? runtimeState.fractionalPowerN
            : 0.5;
        return !isIntegerLike(exponent);
    }
    return true;
}

export function algebraicExpressionHasBranches(terms, runtimeState) {
    return (terms || []).some(term =>
        (term.factors || []).some(factor => {
            if (!factor || factor.func === 'none') return false;
            if (isMultivaluedFunction(factor.func, runtimeState)) return true;
            if (isMultivaluedFunction(factor.chainedFunc, runtimeState)) return true;
            if (factor.log) return true;
            return Number.isFinite(factor.power) && !isIntegerLike(factor.power);
        })
    );
}

function expressionHasBranches(source, runtimeState) {
    try {
        const ast = parseExpression(source);
        let hasBranches = false;

        walkExpression(ast, node => {
            if (hasBranches) return;
            if (node.type === 'call') {
                if (node.name === 'ln' || node.name === 'log' || node.name === 'sqrt') {
                    hasBranches = true;
                } else if (
                    (node.name === 'selected' || node.name === 'selectedFunction' || node.name === 'f') &&
                    isMultivaluedFunction(runtimeState.currentFunction, runtimeState)
                ) {
                    hasBranches = true;
                } else if (isMultivaluedFunction(node.name, runtimeState)) {
                    hasBranches = true;
                }
            }

            if (node.type === 'binary' && node.op === '^') {
                const exponent = node.right?.type === 'literal' && Math.abs(node.right.value?.im || 0) < 1e-12
                    ? node.right.value.re
                    : NaN;
                if (!isIntegerLike(exponent)) hasBranches = true;
            }
        });

        return hasBranches;
    } catch {
        return false;
    }
}

export function dynamicExpressionHasBranches(runtimeState) {
    const config = runtimeState?.dynamicPlotting;
    if (!config?.enabled || config.mode !== 'aggregate') return false;
    if (expressionHasBranches(config.pointExpression || 'd', runtimeState)) return true;
    if (config.term?.kind === 'selected-function') {
        return isMultivaluedFunction(runtimeState.currentFunction, runtimeState);
    }
    return expressionHasBranches(config.term?.expression || 'selected(z)', runtimeState);
}

export function baseExpressionHasBranches(runtimeState) {
    if (!runtimeState) return false;
    if (
        runtimeState.dynamicPlotting?.enabled &&
        runtimeState.dynamicPlotting.mode === 'aggregate' &&
        runtimeState.dynamicPlotting.reduction?.kind !== 'none'
    ) {
        return dynamicExpressionHasBranches(runtimeState);
    }
    if (runtimeState.taylorSeriesEnabled) return false;
    if (runtimeState.currentFunction === 'algebraic_chaining') {
        return algebraicExpressionHasBranches(runtimeState.algebraicChainingTerms, runtimeState);
    }
    return isMultivaluedFunction(runtimeState.currentFunction, runtimeState);
}

export function surfaceStageHasBranches(runtimeState) {
    const baseHasBranches = baseExpressionHasBranches(runtimeState);
    return baseHasBranches;
}

export function getVisibleBranchIndices(sheetCount, branchCenter = 0, hasBranches = true) {
    if (!hasBranches) return [0];
    const normalizedCount = Math.max(1, Math.min(9, Math.floor(sheetCount || 1)));
    const oddCount = normalizedCount % 2 === 0 ? normalizedCount - 1 : normalizedCount;
    const center = Math.round(Number.isFinite(branchCenter) ? branchCenter : 0);
    const radius = Math.floor(oddCount / 2);
    const indices = [];
    for (let k = center - radius; k <= center + radius; k++) {
        indices.push(k);
    }
    return indices;
}

export function getBranchWindowLabel(indices) {
    if (!Array.isArray(indices) || indices.length === 0) return 'principal sheet';
    if (indices.length === 1) {
        return indices[0] === 0 ? 'principal sheet (k = 0)' : `sheet k = ${indices[0]}`;
    }
    return `sheets k = ${indices[0]}...${indices[indices.length - 1]}`;
}

export function getSurfaceComponentLabel(component) {
    switch (component) {
        case 'real': return 'Re(w)';
        case 'magnitude': return '|w|';
        case 'phase': return 'arg(w)';
        case 'imaginary':
        default:
            return 'Im(w)';
    }
}
