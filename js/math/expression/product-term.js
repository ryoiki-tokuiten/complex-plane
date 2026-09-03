import { parseExpression } from './parser.js';

const WRAPPERS = new Set([
    'factorial', 'ln', 'log', 'exp', 'sqrt', 'sin', 'cos', 'tan',
    'sinh', 'tanh', 'abs', 'conj', 'selected'
]);

function sliceNode(source, node) {
    return String(source).slice(node.start, node.end).trim();
}

function unwrapGroup(node) {
    return node?.type === 'group' ? unwrapGroup(node.expression) : node;
}

function factorFromNode(source, rawNode, denominator) {
    let node = unwrapGroup(rawNode);
    let exponent = '';
    let wrapper = 'none';

    if (node?.type === 'binary' && node.op === '^') {
        exponent = sliceNode(source, node.right);
        node = unwrapGroup(node.left);
    }
    if (node?.type === 'postfix' && node.op === '!') {
        wrapper = 'factorial';
        node = unwrapGroup(node.argument);
    } else if (
        node?.type === 'call' &&
        node.args.length === 1 &&
        WRAPPERS.has(node.name)
    ) {
        wrapper = node.name;
        node = unwrapGroup(node.args[0]);
    }

    return {
        id: `factor-${rawNode.start}-${rawNode.end}-${denominator ? 'd' : 'n'}`,
        base: sliceNode(source, node),
        exponent,
        wrapper,
        denominator
    };
}

function flattenProduct(source, rawNode, denominator, factors) {
    const node = unwrapGroup(rawNode);
    if (node?.type === 'binary' && node.op === '*') {
        flattenProduct(source, node.left, denominator, factors);
        flattenProduct(source, node.right, denominator, factors);
        return;
    }
    if (node?.type === 'binary' && node.op === '/') {
        flattenProduct(source, node.left, denominator, factors);
        flattenProduct(source, node.right, !denominator, factors);
        return;
    }
    factors.push(factorFromNode(source, rawNode, denominator));
}

export function decomposeProductExpression(source) {
    if (typeof source !== 'string') throw new Error('Product decomposition requires expression text.');
    const expression = source.trim();
    if (!expression) return [];
    const factors = [];
    flattenProduct(expression, parseExpression(expression), false, factors);
    return factors;
}

function wrappedFactor(factor) {
    if (!factor || typeof factor.base !== 'string' || !factor.base.trim()) {
        throw new Error('Product factors require a non-empty base expression.');
    }
    const base = factor.base.trim();
    let expression;
    switch (factor.wrapper) {
        case 'factorial':
            expression = `factorial(${base})`;
            break;
        case 'selected':
            expression = `selected(${base})`;
            break;
        case 'none':
        case '':
            expression = base;
            break;
        default:
            expression = `${factor.wrapper}(${base})`;
            break;
    }
    const exponent = String(factor.exponent ?? '').trim();
    if (!exponent) return expression;
    const ast = unwrapGroup(parseExpression(expression));
    let poweredBase = expression;
    if (!['literal', 'variable', 'call', 'postfix'].includes(ast.type)) {
        poweredBase = `(${expression})`;
    }
    return `${poweredBase}^(${exponent})`;
}

function product(factors) {
    if (!factors.length) return '1';
    const expressions = factors.map(wrappedFactor);
    if (expressions.length === 1) return expressions[0];
    return expressions.map(expression => `(${expression})`).join(' * ');
}

export function composeProductExpression(factors) {
    if (!Array.isArray(factors)) throw new Error('Product composition requires a factor array.');
    const numerator = product(factors.filter(factor => !factor.denominator));
    const denominator = factors.filter(factor => factor.denominator);
    if (!denominator.length) return numerator;
    return `${numerator} / (${product(denominator)})`;
}

export function createProductFactor(denominator = false) {
    return {
        id: `factor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        base: '1',
        exponent: '',
        wrapper: 'none',
        denominator: Boolean(denominator)
    };
}
