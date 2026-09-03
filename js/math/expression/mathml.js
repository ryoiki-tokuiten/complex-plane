import { parseExpression } from './parser.js';
import { requireFiniteComplex, requireInteger } from '../../utils/numeric-contracts.js';

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
const FUNCTION_NAMES = new Set([
    'sin', 'cos', 'tan', 'sec', 'asin', 'atan', 'sinh', 'tanh',
    'ln', 'log', 'exp', 'abs', 'arg', 're', 'im', 'conj',
    'floor', 'ceil', 'round', 'trunc', 'sign', 'min', 'max',
    'mod', 'gcd', 'zeta', 'gamma', 'loggamma', 'bessel'
]);

function mathNode(tag, text = null, children = []) {
    const node = document.createElementNS(MATHML_NS, tag);
    if (text !== null) node.textContent = text;
    children.filter(Boolean).forEach(child => node.appendChild(child));
    return node;
}

function row(...children) {
    return mathNode('mrow', null, children);
}

function operator(value) {
    return mathNode('mo', value);
}

function fenced(content, left = '(', right = ')') {
    return row(operator(left), content, operator(right));
}

function commaSeparated(nodes) {
    const children = [];
    nodes.forEach((node, index) => {
        if (index > 0) children.push(operator(','));
        children.push(node);
    });
    return row(...children);
}

function variableNode(name, sequenceVariables) {
    const base = mathNode('mi', name);
    if (!sequenceVariables.has(name)) return base;
    return mathNode('msub', null, [base, mathNode('mi', 'j')]);
}

function renderCall(node, options) {
    const args = node.args.map(argument => renderNode(argument, options));
    if (!args.length) throw new Error(`Function "${node.name}" requires an argument.`);
    const argument = args[0];

    if (node.name === 'sqrt') return mathNode('msqrt', null, [argument]);
    if (node.name === 'factorial') {
        const atomic = ['literal', 'variable', 'call', 'postfix'].includes(node.args[0]?.type);
        return row(atomic ? argument : fenced(argument), operator('!'));
    }
    if (node.name === 'reciprocal') {
        return mathNode('mfrac', null, [mathNode('mn', '1'), argument]);
    }
    if (node.name === 'pow' && args.length >= 2) {
        return mathNode('msup', null, [fenced(args[0]), args[1]]);
    }
    if (node.name === 'exp') {
        return mathNode('msup', null, [mathNode('mi', 'e'), fenced(argument)]);
    }
    if (node.name === 'abs') return fenced(argument, '|', '|');

    const displayName = node.name === 'selected' || node.name === 'selectedFunction'
        ? 'f'
        : node.name;
    const functionNode = FUNCTION_NAMES.has(node.name) || displayName === 'f'
        ? mathNode('mi', displayName)
        : mathNode('mi', displayName);
    return row(functionNode, fenced(commaSeparated(args)));
}

function renderNode(node, options) {
    switch (node.type) {
        case 'literal':
            {
                const value = requireFiniteComplex(node.value, 'MathML literal');
                if (Math.abs(value.im) > 1e-12) {
                return row(
                    mathNode('mn', String(value.re)),
                    operator(value.im >= 0 ? '+' : '-'),
                    mathNode('mn', String(Math.abs(value.im))),
                    mathNode('mi', 'i')
                );
                }
                return mathNode('mn', String(value.re));
            }
        case 'variable':
            return variableNode(node.name, options.sequenceVariables);
        case 'group':
            return fenced(renderNode(node.expression, options));
        case 'unary':
            return row(operator(node.op), renderNode(node.argument, options));
        case 'postfix':
            return row(renderNode(node.argument, options), operator(node.op));
        case 'binary': {
            const left = renderNode(node.left, options);
            const right = renderNode(node.right, options);
            if (node.op === '/') return mathNode('mfrac', null, [left, right]);
            if (node.op === '^') return mathNode('msup', null, [left, right]);
            if (node.op === '*') return row(left, operator(node.implicit ? '\u2062' : '·'), right);
            return row(left, operator(node.op), right);
        }
        case 'conditional':
            return row(
                renderNode(node.test, options),
                operator('?'),
                renderNode(node.consequent, options),
                operator(':'),
                renderNode(node.alternate, options)
            );
        case 'call':
            return renderCall(node, options);
        default:
            return mathNode('mtext', '?');
    }
}

export function createExpressionMathML(source, options = {}) {
    const math = mathNode('math');
    math.setAttribute('display', options.display || 'inline');
    math.setAttribute('aria-label', String(source || ''));
    const sequenceVariables = new Set(options.sequenceVariables || []);
    math.appendChild(renderNode(parseExpression(source), { sequenceVariables }));
    return math;
}

function subscripted(name, subscript) {
    return mathNode('msub', null, [mathNode('mi', name), mathNode('mn', String(subscript))]);
}

function functionArguments(symbols) {
    if (!symbols.length) return null;
    return fenced(commaSeparated(symbols.map(symbol => mathNode('mi', symbol))));
}

function termSymbol(parameterSymbols) {
    return row(
        mathNode('msub', null, [mathNode('mi', 'a'), mathNode('mi', 'j')]),
        functionArguments(parameterSymbols)
    );
}

export function createGeneralTermMathML(source, options = {}) {
    const math = mathNode('math');
    math.setAttribute('display', 'block');
    math.setAttribute('aria-label', `a_j = ${source}`);
    const parameterSymbols = options.parameterSymbols || [];
    math.appendChild(row(
        termSymbol(parameterSymbols),
        operator('='),
        renderNode(parseExpression(source), {
            sequenceVariables: new Set(options.sequenceVariables || [])
        })
    ));
    return math;
}

export function createAggregateMathML(source, options = {}) {
    const math = mathNode('math');
    math.setAttribute('display', 'block');
    const count = Math.max(0, requireInteger(options.count, 'Aggregate MathML count'));
    const parameterSymbols = options.parameterSymbols || [];
    const reduction = options.reduction || 'none';
    const sequenceVariables = new Set(options.sequenceVariables || []);
    const expression = renderNode(parseExpression(source), { sequenceVariables });

    if (reduction === 'none') {
        math.appendChild(row(
            mathNode('msub', null, [mathNode('mi', 'w'), mathNode('mi', 'j')]),
            operator('='),
            expression
        ));
        return math;
    }

    const aggregateName = reduction === 'product' ? 'P' : 'S';
    const aggregate = row(
        subscripted(aggregateName, count),
        functionArguments(parameterSymbols)
    );
    const symbol = reduction === 'product' ? '∏' : '∑';
    const iterator = mathNode('munderover', null, [
        operator(symbol),
        row(mathNode('mi', 'j'), operator('='), mathNode('mn', '0')),
        mathNode('mn', String(Math.max(0, count - 1)))
    ]);
    math.appendChild(row(
        aggregate,
        operator('='),
        iterator,
        termSymbol(parameterSymbols)
    ));
    return math;
}
