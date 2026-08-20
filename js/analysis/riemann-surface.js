import { parseExpression, walkExpression } from '../math/expression/parser.js';
import { requireFiniteComplex, requireFiniteNumber, requireInteger } from '../utils/numeric-contracts.js';

const MULTIVALUED_FUNCTIONS = new Set(['ln', 'power', 'asin', 'atan', 'loggamma', 'bessel']);

function isIntegerLike(value) {
    return Number.isFinite(value) && Math.abs(value - Math.round(value)) < 1e-9;
}

export function isMultivaluedFunction(functionKey, runtimeState) {
    if (!MULTIVALUED_FUNCTIONS.has(functionKey)) return false;
    if (functionKey === 'power') {
        const exponent = requireFiniteNumber(runtimeState?.fractionalPowerN, 'Fractional-power exponent');
        return !isIntegerLike(exponent);
    }
    if (functionKey === 'bessel') {
        const order = requireFiniteComplex(runtimeState?.besselOrder, 'Bessel order');
        return Math.abs(order.im) > 1e-9 || !isIntegerLike(order.re);
    }
    return true;
}

export function algebraicExpressionHasBranches(terms, runtimeState) {
    if (!Array.isArray(terms)) throw new Error('Branch analysis requires algebraic terms.');
    return terms.some(term => {
        if (!Array.isArray(term?.factors)) throw new Error('Branch analysis requires algebraic factors.');
        return term.factors.some(factor => {
            if (!factor || factor.func === 'none') return false;
            if (isMultivaluedFunction(factor.func, runtimeState)) return true;
            if (isMultivaluedFunction(factor.chainedFunc, runtimeState)) return true;
            if (factor.log) return true;
            return Number.isFinite(factor.power) && !isIntegerLike(factor.power);
        });
    });
}

function expressionHasBranches(source, runtimeState) {
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
            let exponent = NaN;
            if (node.right?.type === 'literal') {
                const literal = requireFiniteComplex(node.right.value, 'Branch-analysis exponent');
                if (Math.abs(literal.im) < 1e-12) exponent = literal.re;
            }
            if (!isIntegerLike(exponent)) hasBranches = true;
        }
    });

    return hasBranches;
}

export function dynamicExpressionHasBranches(runtimeState) {
    const config = runtimeState?.dynamicPlotting;
    if (!config?.enabled) return false;
    if (config.mode === 'map') return false;
    if (config.mode !== 'aggregate' || typeof config.pointExpression !== 'string') {
        throw new Error('Dynamic branch analysis requires aggregate expression configuration.');
    }
    if (expressionHasBranches(config.pointExpression, runtimeState)) return true;
    if (config.term?.kind === 'selected-function') {
        return isMultivaluedFunction(runtimeState.currentFunction, runtimeState);
    }
    if (config.term?.kind !== 'expression' || typeof config.term.expression !== 'string') {
        throw new Error('Dynamic branch analysis requires a valid term.');
    }
    return expressionHasBranches(config.term.expression, runtimeState);
}

export function baseExpressionHasBranches(runtimeState) {
    if (!runtimeState) throw new Error('Surface branch analysis requires application state.');
    if (runtimeState.mapPresentation === 'derivative') return false;
    if (
        runtimeState.dynamicPlotting?.enabled &&
        runtimeState.dynamicPlotting.mode === 'aggregate' &&
        runtimeState.dynamicPlotting.reduction?.kind !== 'none'
    ) {
        return dynamicExpressionHasBranches(runtimeState);
    }
    if (runtimeState.taylorSeriesEnabled) return false;
    if (runtimeState.currentFunction === 'algebraic_chaining') {
        return algebraicExpressionHasBranches(runtimeState.algebraicChainingTerms, runtimeState) ||
            expressionHasBranches(runtimeState.algebraicChainingZExpr, runtimeState);
    }
    return isMultivaluedFunction(runtimeState.currentFunction, runtimeState);
}

export function surfaceStageHasBranches(runtimeState) {
    const baseHasBranches = baseExpressionHasBranches(runtimeState);
    return baseHasBranches;
}

export function getVisibleBranchIndices(sheetCount, branchCenter = 0, hasBranches = true) {
    if (!hasBranches) return [0];
    const normalizedCount = requireInteger(sheetCount, 'Riemann sheet count');
    if (normalizedCount < 1 || normalizedCount > 9) {
        throw new Error('Riemann sheet count must be between 1 and 9.');
    }
    const oddCount = normalizedCount % 2 === 0 ? normalizedCount - 1 : normalizedCount;
    const center = requireInteger(branchCenter, 'Riemann branch center');
    const radius = Math.floor(oddCount / 2);
    const indices = [];
    for (let k = center - radius; k <= center + radius; k++) {
        indices.push(k);
    }
    return indices;
}

export function getBranchWindowLabel(indices) {
    if (!Array.isArray(indices) || indices.length === 0) {
        throw new Error('Riemann branch labels require sheet indices.');
    }
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
        case 'imaginary': return 'Im(w)';
        default: throw new Error(`Unknown Riemann surface component: ${component}.`);
    }
}
