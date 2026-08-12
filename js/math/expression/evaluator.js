import {
    complexAbs,
    complexAdd,
    complexArg,
    complexAsin,
    complexAtan,
    complexBesselJ,
    complexCos,
    complexCosh,
    complexDivide,
    complexExp,
    complexExpWithBase,
    complexGamma,
    complexLn,
    complexLogGamma,
    complexLogWithBase,
    complexMul,
    complexPow,
    complexReciprocal,
    complexRiemannZeta,
    complexSec,
    complexSin,
    complexSinh,
    complexSub,
    complexTan,
    complexTanh,
    factorial,
    transformFunctions
} from '../../math-utils.js';
import { collectExpressionDependencies, parseExpression } from './parser.js';

const EPSILON = 1e-12;
const SOURCE_CACHE_LIMIT = 128;
const MAX_FACTORIAL_ARGUMENT = 170;
const HAS_OWN = Object.prototype.hasOwnProperty;
const CONSTANTS = Object.freeze({
    i: Object.freeze({ re: 0, im: 1 }),
    pi: Object.freeze({ re: Math.PI, im: 0 }),
    e: Object.freeze({ re: Math.E, im: 0 }),
    true: true,
    false: false
});

const POW_HALF = Object.freeze({ re: 0.5, im: 0 });
const ZERO_COMPLEX = Object.freeze({ re: 0, im: 0 });

function complex(re = 0, im = 0) {
    return { re, im };
}

function isComplex(value) {
    return value !== null && typeof value === 'object' &&
        typeof value.re === 'number' && typeof value.im === 'number';
}

function toComplex(value) {
    if (isComplex(value)) return value;
    if (typeof value === 'number') return complex(value, 0);
    if (typeof value === 'boolean') return complex(value ? 1 : 0, 0);
    return complex(NaN, NaN);
}

function realValue(value, name = 'value') {
    const z = toComplex(value);
    if (!Number.isFinite(z.re) || !Number.isFinite(z.im) || Math.abs(z.im) > EPSILON) {
        throw new ExpressionEvaluationError(`${name} must be real`);
    }
    return z.re;
}

function integerValue(value, name = 'value') {
    const result = realValue(value, name);
    if (!Number.isInteger(result)) {
        throw new ExpressionEvaluationError(`${name} must be an integer`);
    }
    if (!Number.isSafeInteger(result)) {
        throw new ExpressionEvaluationError(`${name} must be a safe integer`);
    }
    return result;
}

function isZero(value) {
    const z = toComplex(value);
    return Math.hypot(z.re, z.im) <= EPSILON;
}

function factorialValue(value) {
    const argument = integerValue(value, 'factorial argument');
    if (argument < 0) {
        throw new ExpressionEvaluationError('factorial argument must be non-negative');
    }
    if (argument > MAX_FACTORIAL_ARGUMENT) {
        throw new ExpressionEvaluationError(
            `factorial argument must not exceed ${MAX_FACTORIAL_ARGUMENT}`
        );
    }
    return complex(factorial(argument), 0);
}

function truthy(value) {
    if (typeof value === 'boolean') return value;
    const z = toComplex(value);
    return Number.isFinite(z.re) && Number.isFinite(z.im) &&
        (Math.abs(z.re) > EPSILON || Math.abs(z.im) > EPSILON);
}

function complexEquals(left, right) {
    const a = toComplex(left);
    const b = toComplex(right);
    return Math.abs(a.re - b.re) <= EPSILON && Math.abs(a.im - b.im) <= EPSILON;
}

export function isPrimeInteger(value) {
    if (!Number.isSafeInteger(value) || value < 2) return false;
    if (value === 2 || value === 3) return true;
    if ((value & 1) === 0 || value % 3 === 0) return false;

    for (let divisor = 5, step = 2; divisor * divisor <= value; divisor += step, step = 6 - step) {
        if (value % divisor === 0) return false;
    }
    return true;
}

function greatestCommonDivisor(a, b) {
    let left = Math.abs(integerValue(a, 'gcd argument'));
    let right = Math.abs(integerValue(b, 'gcd argument'));

    while (right !== 0) {
        const remainder = left % right;
        left = right;
        right = remainder;
    }
    return left;
}

function applyRealUnary(name, value, operation) {
    return complex(operation(realValue(value, `${name} argument`)), 0);
}

function callTransform(name, argument, environment) {
    if (name === 'selected' || name === 'selectedFunction' || name === 'f') {
        const selected = environment.selectedFunction;
        if (typeof selected !== 'function') {
            throw new ExpressionEvaluationError('No selected function is available');
        }
        const z = toComplex(argument);
        return selected(z.re, z.im);
    }

    const override = environment.functions?.[name];
    if (typeof override === 'function') {
        const z = toComplex(argument);
        return override(z, environment);
    }

    const transform = transformFunctions[name === 'log' ? 'ln' : name];
    if (typeof transform === 'function') {
        const z = toComplex(argument);
        return transform(z.re, z.im);
    }

    return null;
}

const CALLS = Object.freeze({
    sin: ([value]) => complexSin(toComplex(value)),
    cos: ([value]) => complexCos(toComplex(value)),
    tan: ([value]) => complexTan(toComplex(value)),
    sec: ([value]) => complexSec(toComplex(value)),
    exp: ([value]) => complexExpWithBase(toComplex(value)),
    ln: ([value]) => {
        if (isZero(value)) throw new ExpressionEvaluationError('ln(0) is undefined');
        return complexLogWithBase(toComplex(value));
    },
    log: ([value]) => {
        if (isZero(value)) throw new ExpressionEvaluationError('log(0) is undefined');
        return complexLogWithBase(toComplex(value));
    },
    asin: ([value]) => complexAsin(toComplex(value)),
    atan: ([value]) => complexAtan(toComplex(value)),
    gamma: ([value]) => complexGamma(toComplex(value)),
    loggamma: ([value]) => complexLogGamma(toComplex(value)),
    bessel: values => values.length === 1
        ? complexBesselJ(toComplex(values[0]))
        : complexBesselJ(toComplex(values[1]), undefined, toComplex(values[0])),
    sinh: ([value]) => complexSinh(toComplex(value)),
    cosh: ([value]) => complexCosh(toComplex(value)),
    tanh: ([value]) => complexTanh(toComplex(value)),
    sqrt: ([value]) => complexPow(toComplex(value), POW_HALF),
    reciprocal: ([value]) => {
        if (isZero(value)) throw new ExpressionEvaluationError('Division by zero');
        return complexReciprocal(toComplex(value));
    },
    zeta: ([value]) => complexRiemannZeta(toComplex(value)),
    abs: ([value]) => complex(complexAbs(toComplex(value)), 0),
    arg: ([value]) => complex(complexArg(toComplex(value)), 0),
    re: ([value]) => complex(toComplex(value).re, 0),
    im: ([value]) => complex(toComplex(value).im, 0),
    conj: ([value]) => {
        const z = toComplex(value);
        return complex(z.re, -z.im);
    },
    complex: ([re, im = ZERO_COMPLEX]) => complex(
        realValue(re, 'real component'),
        realValue(im, 'imaginary component')
    ),
    floor: ([value]) => applyRealUnary('floor', value, Math.floor),
    ceil: ([value]) => applyRealUnary('ceil', value, Math.ceil),
    round: ([value]) => applyRealUnary('round', value, Math.round),
    trunc: ([value]) => applyRealUnary('trunc', value, Math.trunc),
    sign: ([value]) => applyRealUnary('sign', value, Math.sign),
    min: values => {
        let result = Infinity;
        for (let index = 0; index < values.length; index++) {
            const candidate = realValue(values[index], 'min argument');
            if (candidate < result) result = candidate;
        }
        return complex(result, 0);
    },
    max: values => {
        let result = -Infinity;
        for (let index = 0; index < values.length; index++) {
            const candidate = realValue(values[index], 'max argument');
            if (candidate > result) result = candidate;
        }
        return complex(result, 0);
    },
    mod: ([left, right]) => {
        const divisor = realValue(right, 'mod second argument');
        if (Math.abs(divisor) <= EPSILON) {
            throw new ExpressionEvaluationError('mod divisor must not be zero');
        }
        return complex(realValue(left, 'mod first argument') % divisor, 0);
    },
    gcd: ([left, right]) => complex(greatestCommonDivisor(left, right), 0),
    factorial: ([value]) => factorialValue(value),
    isPrime: ([value]) => isPrimeInteger(integerValue(value, 'isPrime argument')),
    pow: ([base, exponent]) => complexPow(toComplex(base), toComplex(exponent))
});

const ARITY = Object.freeze({
    sin: [1, 1], cos: [1, 1], tan: [1, 1], sec: [1, 1], asin: [1, 1], atan: [1, 1],
    exp: [1, 1], ln: [1, 1], log: [1, 1],
    gamma: [1, 1], loggamma: [1, 1], bessel: [1, 2],
    sinh: [1, 1], cosh: [1, 1], tanh: [1, 1],
    sqrt: [1, 1], reciprocal: [1, 1], zeta: [1, 1],
    abs: [1, 1], arg: [1, 1], re: [1, 1], im: [1, 1], conj: [1, 1],
    complex: [1, 2], floor: [1, 1], ceil: [1, 1], round: [1, 1],
    trunc: [1, 1], sign: [1, 1], min: [1, Infinity], max: [1, Infinity],
    mod: [2, 2], gcd: [2, 2], factorial: [1, 1], isPrime: [1, 1],
    pow: [2, 2], selected: [1, 1], selectedFunction: [1, 1], f: [1, 1],
    mobius: [1, 1], polynomial: [1, 1], poincare: [1, 1], power: [1, 1]
});

export class ExpressionEvaluationError extends Error {
    constructor(message, node = null) {
        super(message);
        this.name = 'ExpressionEvaluationError';
        this.node = node;
    }
}

function assertArity(name, args, node) {
    const range = ARITY[name];
    if (!range) {
        throw new ExpressionEvaluationError(`Unknown function "${name}"`, node);
    }

    if (args.length < range[0] || args.length > range[1]) {
        const expected = range[0] === range[1]
            ? `${range[0]}`
            : `${range[0]} to ${range[1] === Infinity ? 'many' : range[1]}`;
        throw new ExpressionEvaluationError(
            `Function "${name}" expects ${expected} argument(s), received ${args.length}`,
            node
        );
    }
}

function evaluateBinary(node, environment) {
    if (node.op === '&&') {
        return truthy(evaluateNode(node.left, environment)) &&
            truthy(evaluateNode(node.right, environment));
    }
    if (node.op === '||') {
        return truthy(evaluateNode(node.left, environment)) ||
            truthy(evaluateNode(node.right, environment));
    }

    const left = evaluateNode(node.left, environment);
    const right = evaluateNode(node.right, environment);

    switch (node.op) {
        case '+': return complexAdd(toComplex(left), toComplex(right));
        case '-': return complexSub(toComplex(left), toComplex(right));
        case '*': return complexMul(toComplex(left), toComplex(right));
        case '/':
            if (isZero(right)) throw new ExpressionEvaluationError('Division by zero', node);
            return complexDivide(toComplex(left), toComplex(right));
        case '^': return complexPow(toComplex(left), toComplex(right));
        case '==': return complexEquals(left, right);
        case '!=': return !complexEquals(left, right);
        case '<': return realValue(left, 'left comparison operand') < realValue(right, 'right comparison operand');
        case '<=': return realValue(left, 'left comparison operand') <= realValue(right, 'right comparison operand');
        case '>': return realValue(left, 'left comparison operand') > realValue(right, 'right comparison operand');
        case '>=': return realValue(left, 'left comparison operand') >= realValue(right, 'right comparison operand');
        default:
            throw new ExpressionEvaluationError(`Unsupported operator "${node.op}"`, node);
    }
}

function evaluateCall(node, environment) {
    const args = new Array(node.args.length);
    for (let index = 0; index < node.args.length; index++) {
        args[index] = evaluateNode(node.args[index], environment);
    }
    assertArity(node.name, args, node);

    const override = environment.functions?.[node.name];
    if (typeof override === 'function') {
        return override(toComplex(args[args.length - 1]), environment, args);
    }

    const builtIn = CALLS[node.name];
    if (builtIn) return builtIn(args, environment);

    const transformed = callTransform(node.name, args[0], environment);
    if (transformed !== null) return transformed;

    throw new ExpressionEvaluationError(`Unknown function "${node.name}"`, node);
}

function evaluateNode(node, environment) {
    try {
        switch (node.type) {
            case 'literal':
                return node.value;
            case 'variable': {
                if (HAS_OWN.call(environment, node.name)) {
                    return environment[node.name];
                }
                if (HAS_OWN.call(CONSTANTS, node.name)) {
                    return CONSTANTS[node.name];
                }
                throw new ExpressionEvaluationError(`Unknown variable "${node.name}"`, node);
            }
            case 'group':
                return evaluateNode(node.expression, environment);
            case 'unary': {
                const value = evaluateNode(node.argument, environment);
                if (node.op === '+') return toComplex(value);
                if (node.op === '-') {
                    const z = toComplex(value);
                    return complex(-z.re, -z.im);
                }
                if (node.op === '!') return !truthy(value);
                throw new ExpressionEvaluationError(`Unsupported unary operator "${node.op}"`, node);
            }
            case 'postfix':
                return factorialValue(evaluateNode(node.argument, environment));
            case 'binary':
                return evaluateBinary(node, environment);
            case 'conditional':
                return truthy(evaluateNode(node.test, environment))
                    ? evaluateNode(node.consequent, environment)
                    : evaluateNode(node.alternate, environment);
            case 'call':
                return evaluateCall(node, environment);
            default:
                throw new ExpressionEvaluationError(`Unknown expression node "${node.type}"`, node);
        }
    } catch (error) {
        if (error instanceof ExpressionEvaluationError) {
            if (!error.node) error.node = node;
            throw error;
        }
        throw new ExpressionEvaluationError(error?.message || String(error), node);
    }
}

function evaluateExpressionInterpreted(ast, environment = {}) {
    const result = evaluateNode(ast, environment);
    if (isComplex(result) && (!Number.isFinite(result.re) || !Number.isFinite(result.im))) {
        throw new ExpressionEvaluationError(
            'Expression result is undefined or outside the supported numeric range',
            ast
        );
    }
    return result;
}

const EVALUATION_CACHE = new WeakMap();
const COMPILED_AST_CACHE = new WeakMap();
const COMPILED_SOURCE_CACHE = new Map();

function optionsCacheKey(options) {
    const variables = options?.allowedVariables;
    if (!variables) return '';
    return Array.isArray(variables) ? variables.join('\u0000') : Array.from(variables).join('\u0000');
}

function rememberSourceEvaluator(key, evaluator) {
    if (COMPILED_SOURCE_CACHE.size >= SOURCE_CACHE_LIMIT) {
        COMPILED_SOURCE_CACHE.delete(COMPILED_SOURCE_CACHE.keys().next().value);
    }
    COMPILED_SOURCE_CACHE.set(key, evaluator);
    return evaluator;
}

function getCachedFastEvaluator(ast) {
    if (!ast || typeof ast !== 'object' || ast.type === 'literal') return compileFastEvaluator(ast);
    let evaluator = EVALUATION_CACHE.get(ast);
    if (evaluator === undefined) {
        evaluator = compileFastEvaluator(ast) || null;
        EVALUATION_CACHE.set(ast, evaluator);
    }
    return evaluator;
}

let generatedHelpersCache = null;

function getGeneratedHelpers() {
    if (generatedHelpersCache) return generatedHelpersCache;
    generatedHelpersCache = Object.freeze({
        ExpressionEvaluationError,
        EPSILON,
        constants: CONSTANTS,
        hasOwn: HAS_OWN,
        transformFunctions,
        complexSin,
        complexCos,
        complexTan,
        complexSec,
        complexExp,
        complexExpWithBase,
        complexLn,
        complexLogWithBase,
        complexAsin,
        complexAtan,
        complexGamma,
        complexLogGamma,
        complexBesselJ,
        complexSinh,
        complexCosh,
        complexTanh,
        complexRiemannZeta,
        complexPow,
        factorial,
        isPrimeInteger,
        fail(message, node) {
            throw new ExpressionEvaluationError(message, node);
        },
        real(re, im, name, node) {
            if (!Number.isFinite(re) || !Number.isFinite(im) || Math.abs(im) > EPSILON) {
                throw new ExpressionEvaluationError(`${name} must be real`, node);
            }
            return re;
        },
        integer(re, im, name, node) {
            if (!Number.isFinite(re) || !Number.isFinite(im) || Math.abs(im) > EPSILON) {
                throw new ExpressionEvaluationError(`${name} must be real`, node);
            }
            if (!Number.isInteger(re)) {
                throw new ExpressionEvaluationError(`${name} must be an integer`, node);
            }
            if (!Number.isSafeInteger(re)) {
                throw new ExpressionEvaluationError(`${name} must be a safe integer`, node);
            }
            return re;
        },
        factorialRe(re, im, node) {
            const argument = this.integer(re, im, 'factorial argument', node);
            if (argument < 0) {
                throw new ExpressionEvaluationError('factorial argument must be non-negative', node);
            }
            if (argument > MAX_FACTORIAL_ARGUMENT) {
                throw new ExpressionEvaluationError(
                    `factorial argument must not exceed ${MAX_FACTORIAL_ARGUMENT}`,
                    node
                );
            }
            return factorial(argument);
        },
        gcdRe(ar, ai, br, bi, node) {
            let left = Math.abs(this.integer(ar, ai, 'gcd argument', node));
            let right = Math.abs(this.integer(br, bi, 'gcd argument', node));
            while (right !== 0) {
                const remainder = left % right;
                left = right;
                right = remainder;
            }
            return left;
        },
        transform(name, re, im, environment, node) {
            if (name === 'selected' || name === 'selectedFunction' || name === 'f') {
                const selected = environment.selectedFunction;
                if (typeof selected !== 'function') {
                    throw new ExpressionEvaluationError('No selected function is available', node);
                }
                return selected(re, im);
            }
            const override = environment.functions?.[name];
            if (typeof override === 'function') return override({ re, im }, environment);
            const transform = transformFunctions[name === 'log' ? 'ln' : name];
            if (typeof transform === 'function') return transform(re, im);
            throw new ExpressionEvaluationError(`Unknown function "${name}"`, node);
        },
        finishComplex(re, im, ast) {
            if (!Number.isFinite(re) || !Number.isFinite(im)) {
                throw new ExpressionEvaluationError(
                    'Expression result is undefined or outside the supported numeric range',
                    ast
                );
            }
            return { re, im };
        },
        assertFiniteObject(value, ast) {
            if (isComplex(value) && (!Number.isFinite(value.re) || !Number.isFinite(value.im))) {
                throw new ExpressionEvaluationError(
                    'Expression result is undefined or outside the supported numeric range',
                    ast
                );
            }
            return value;
        }
    });
    return generatedHelpersCache;
}

class GeneratedEvaluatorBuilder {
    constructor(ast) {
        this.ast = ast;
        this.nodes = [ast];
        this.lines = [];
        this.index = 0;
        this.variableCache = new Map();
    }

    addNode(node) {
        const index = this.nodes.length;
        this.nodes.push(node);
        return `N[${index}]`;
    }

    temp(prefix) {
        return `_${prefix}${this.index++}`;
    }

    emit(line) {
        this.lines.push(line);
    }

    pair(re, im) {
        return { kind: 'complex', re, im };
    }

    bool(value) {
        return { kind: 'boolean', value };
    }

    emitLiteral(node) {
        const value = node.value;
        if (typeof value === 'boolean') return this.bool(value ? 'true' : 'false');
        if (typeof value === 'number') return this.pair(String(value), '0');
        if (isComplex(value)) return this.pair(String(value.re), String(value.im));
        throw new Error('unsupported literal');
    }

    emitVariable(node) {
        const name = node.name;
        if (HAS_OWN.call(CONSTANTS, name)) {
            const value = CONSTANTS[name];
            if (typeof value === 'boolean') return this.bool(value ? 'true' : 'false');
            return this.pair(String(value.re), String(value.im));
        }
        const cached = this.variableCache.get(name);
        if (cached) return cached;

        const raw = this.temp('v');
        const re = this.temp('r');
        const im = this.temp('i');
        const key = JSON.stringify(name);
        const nodeRef = this.addNode(node);
        this.emit(`const ${raw}=H.hasOwn.call(environment,${key})?environment[${key}]:H.fail('Unknown variable ${escapeForMessage(name)}',${nodeRef});`);
        this.emit(`let ${re},${im};`);
        this.emit(`if(${raw}!==null&&typeof ${raw}==='object'&&typeof ${raw}.re==='number'&&typeof ${raw}.im==='number'){${re}=${raw}.re;${im}=${raw}.im;}else if(typeof ${raw}==='number'){${re}=${raw};${im}=0;}else if(typeof ${raw}==='boolean'){${re}=${raw}?1:0;${im}=0;}else{${re}=NaN;${im}=NaN;}`);
        const pair = this.pair(re, im);
        this.variableCache.set(name, pair);
        return pair;
    }

    emitAsPair(node) {
        const result = this.emitNode(node);
        if (result.kind === 'complex') return result;
        return this.pair(`(${result.value}?1:0)`, '0');
    }

    emitAsBool(node) {
        const result = this.emitNode(node);
        if (result.kind === 'boolean') return result;
        const value = this.temp('b');
        this.emit(`const ${value}=Number.isFinite(${result.re})&&Number.isFinite(${result.im})&&(Math.abs(${result.re})>1e-12||Math.abs(${result.im})>1e-12);`);
        return this.bool(value);
    }

    emitReal(node, name, nodeRef = this.addNode(node)) {
        const value = this.emitAsPair(node);
        return `H.real(${value.re},${value.im},${JSON.stringify(name)},${nodeRef})`;
    }

    emitUnary(node) {
        if (node.op === '!') {
            const value = this.emitAsBool(node.argument);
            return this.bool(`(!${value.value})`);
        }
        const value = this.emitAsPair(node.argument);
        if (node.op === '+') return value;
        if (node.op === '-') return this.pair(`(-${value.re})`, `(-${value.im})`);
        throw new Error('unsupported unary');
    }

    emitBinary(node) {
        if (node.op === '&&') {
            const left = this.emitAsBool(node.left);
            const out = this.temp('b');
            const outerCache = new Map(this.variableCache);
            this.emit(`let ${out}=false;`);
            this.emit(`if(${left.value}){`);
            this.variableCache = new Map(outerCache);
            const right = this.emitAsBool(node.right);
            this.emit(`${out}=${right.value};`);
            this.emit('}');
            this.variableCache = outerCache;
            return this.bool(out);
        }
        if (node.op === '||') {
            const left = this.emitAsBool(node.left);
            const out = this.temp('b');
            const outerCache = new Map(this.variableCache);
            this.emit(`let ${out}=true;`);
            this.emit(`if(!${left.value}){`);
            this.variableCache = new Map(outerCache);
            const right = this.emitAsBool(node.right);
            this.emit(`${out}=${right.value};`);
            this.emit('}');
            this.variableCache = outerCache;
            return this.bool(out);
        }

        const left = this.emitAsPair(node.left);
        const right = this.emitAsPair(node.right);
        switch (node.op) {
            case '+': return this.pair(`(${left.re}+${right.re})`, `(${left.im}+${right.im})`);
            case '-': return this.pair(`(${left.re}-${right.re})`, `(${left.im}-${right.im})`);
            case '*': return this.pair(`(${left.re}*${right.re}-${left.im}*${right.im})`, `(${left.re}*${right.im}+${left.im}*${right.re})`);
            case '/': {
                const denominator = this.temp('d');
                const re = this.temp('r');
                const im = this.temp('i');
                const nodeRef = this.addNode(node);
                this.emit(`const ${denominator}=${right.re}*${right.re}+${right.im}*${right.im};`);
                this.emit(`if(${denominator}<=1e-24)H.fail('Division by zero',${nodeRef});`);
                this.emit(`const ${re}=(${left.re}*${right.re}+${left.im}*${right.im})/${denominator};`);
                this.emit(`const ${im}=(${left.im}*${right.re}-${left.re}*${right.im})/${denominator};`);
                return this.pair(re, im);
            }
            case '^': return this.emitPow(left, right);
            case '==': return this.bool(`(Math.abs(${left.re}-${right.re})<=1e-12&&Math.abs(${left.im}-${right.im})<=1e-12)`);
            case '!=': return this.bool(`!(Math.abs(${left.re}-${right.re})<=1e-12&&Math.abs(${left.im}-${right.im})<=1e-12)`);
            case '<': return this.bool(`(${this.realFromPair(left, 'left comparison operand', node)}<${this.realFromPair(right, 'right comparison operand', node)})`);
            case '<=': return this.bool(`(${this.realFromPair(left, 'left comparison operand', node)}<=${this.realFromPair(right, 'right comparison operand', node)})`);
            case '>': return this.bool(`(${this.realFromPair(left, 'left comparison operand', node)}>${this.realFromPair(right, 'right comparison operand', node)})`);
            case '>=': return this.bool(`(${this.realFromPair(left, 'left comparison operand', node)}>=${this.realFromPair(right, 'right comparison operand', node)})`);
            default: throw new Error('unsupported binary');
        }
    }

    realFromPair(pair, name, node) {
        return `H.real(${pair.re},${pair.im},${JSON.stringify(name)},${this.addNode(node)})`;
    }

    emitPow(left, right) {
        if (right.im === '0') {
            if (right.re === '2') return this.pair(`(${left.re}*${left.re}-${left.im}*${left.im})`, `(2*${left.re}*${left.im})`);
            if (right.re === '3') {
                const r2 = `(${left.re}*${left.re}-${left.im}*${left.im})`;
                const i2 = `(2*${left.re}*${left.im})`;
                return this.pair(`(${r2}*${left.re}-${i2}*${left.im})`, `(${r2}*${left.im}+${i2}*${left.re})`);
            }
        }
        const out = this.temp('z');
        this.emit(`const ${out}=H.complexPow({re:${left.re},im:${left.im}},{re:${right.re},im:${right.im}});`);
        return this.pair(`${out}.re`, `${out}.im`);
    }

    emitPostfix(node) {
        const value = this.emitAsPair(node.argument);
        return this.pair(`H.factorialRe(${value.re},${value.im},${this.addNode(node)})`, '0');
    }

    emitConditional(node) {
        const test = this.emitAsBool(node.test);
        const re = this.temp('r');
        const im = this.temp('i');
        const outerCache = new Map(this.variableCache);
        this.emit(`let ${re},${im};`);
        this.emit(`if(${test.value}){`);
        this.variableCache = new Map(outerCache);
        const consequent = this.emitAsPair(node.consequent);
        this.emit(`${re}=${consequent.re};${im}=${consequent.im};`);
        this.emit('}else{');
        this.variableCache = new Map(outerCache);
        const alternate = this.emitAsPair(node.alternate);
        this.emit(`${re}=${alternate.re};${im}=${alternate.im};`);
        this.emit('}');
        this.variableCache = outerCache;
        return this.pair(re, im);
    }

    emitCall(node) {
        const range = ARITY[node.name];
        if (!range || node.args.length < range[0] || node.args.length > range[1]) throw new Error('arity');

        const name = node.name;
        switch (name) {
            case 'abs': {
                const value = this.emitAsPair(node.args[0]);
                return this.pair(`Math.hypot(${value.re},${value.im})`, '0');
            }
            case 'arg': {
                const value = this.emitAsPair(node.args[0]);
                return this.pair(`Math.atan2(${value.im},${value.re})`, '0');
            }
            case 're': {
                const value = this.emitAsPair(node.args[0]);
                return this.pair(value.re, '0');
            }
            case 'im': {
                const value = this.emitAsPair(node.args[0]);
                return this.pair(value.im, '0');
            }
            case 'conj': {
                const value = this.emitAsPair(node.args[0]);
                return this.pair(value.re, `(-${value.im})`);
            }
            case 'complex': {
                const re = this.emitReal(node.args[0], 'real component');
                const im = node.args.length === 2 ? this.emitReal(node.args[1], 'imaginary component') : '0';
                return this.pair(re, im);
            }
            case 'floor': case 'ceil': case 'round': case 'trunc': case 'sign': {
                const re = this.emitReal(node.args[0], `${name} argument`);
                return this.pair(`Math.${name}(${re})`, '0');
            }
            case 'min': case 'max': return this.emitMinMax(node);
            case 'mod': {
                const left = this.emitReal(node.args[0], 'mod first argument');
                const right = this.emitReal(node.args[1], 'mod second argument');
                const nodeRef = this.addNode(node);
                this.emit(`if(Math.abs(${right})<=1e-12)H.fail('mod divisor must not be zero',${nodeRef});`);
                return this.pair(`(${left}%${right})`, '0');
            }
            case 'gcd': {
                const left = this.emitAsPair(node.args[0]);
                const right = this.emitAsPair(node.args[1]);
                return this.pair(`H.gcdRe(${left.re},${left.im},${right.re},${right.im},${this.addNode(node)})`, '0');
            }
            case 'factorial': {
                const value = this.emitAsPair(node.args[0]);
                return this.pair(`H.factorialRe(${value.re},${value.im},${this.addNode(node)})`, '0');
            }
            case 'isPrime': {
                const value = this.emitAsPair(node.args[0]);
                return this.bool(`H.isPrimeInteger(H.integer(${value.re},${value.im},'isPrime argument',${this.addNode(node)}))`);
            }
            case 'pow': {
                const left = this.emitAsPair(node.args[0]);
                const right = this.emitAsPair(node.args[1]);
                return this.emitPow(left, right);
            }
            case 'reciprocal': {
                const value = this.emitAsPair(node.args[0]);
                const denominator = this.temp('d');
                const nodeRef = this.addNode(node);
                this.emit(`const ${denominator}=${value.re}*${value.re}+${value.im}*${value.im};`);
                this.emit(`if(${denominator}<=1e-24)H.fail('Division by zero',${nodeRef});`);
                return this.pair(`(${value.re}/${denominator})`, `(-${value.im}/${denominator})`);
            }
            case 'sqrt': {
                const value = this.emitAsPair(node.args[0]);
                const nodeRef = this.addNode(node);
                const override = this.temp('z');
                this.emit(`const ${override}=environment.functions&&typeof environment.functions.sqrt==='function'?H.transform('sqrt',${value.re},${value.im},environment,${nodeRef}):null;`);
                const magnitude = this.temp('m');
                const re = this.temp('r');
                const im = this.temp('i');
                this.emit(`const ${magnitude}=Math.hypot(${value.re},${value.im});`);
                this.emit(`const ${re}=Math.sqrt(Math.max(0,(${magnitude}+${value.re})*0.5));`);
                this.emit(`const ${im}=(${value.im}<0?-1:1)*Math.sqrt(Math.max(0,(${magnitude}-${value.re})*0.5));`);
                return this.pair(`(${override}?${override}.re:${re})`, `(${override}?${override}.im:${im})`);
            }
            case 'ln': case 'log': {
                const value = this.emitAsPair(node.args[0]);
                const nodeRef = this.addNode(node);
                this.emit(`if(Math.hypot(${value.re},${value.im})<=1e-12)H.fail('${name}(0) is undefined',${nodeRef});`);
                const out = this.temp('z');
                this.emit(`const ${out}=H.transform(${JSON.stringify(name)},${value.re},${value.im},environment,${nodeRef});`);
                return this.pair(`${out}.re`, `${out}.im`);
            }
            case 'sin': case 'cos': case 'tan': case 'sec': case 'exp':
            case 'asin': case 'atan': case 'gamma': case 'loggamma': {
                const value = this.emitAsPair(node.args[0]);
                const out = this.temp('z');
                this.emit(`const ${out}=H.transform(${JSON.stringify(name)},${value.re},${value.im},environment,${this.addNode(node)});`);
                return this.pair(`${out}.re`, `${out}.im`);
            }
            case 'bessel': {
                const value = this.emitAsPair(node.args[node.args.length - 1]);
                const out = this.temp('z');
                if (node.args.length === 1) {
                    this.emit(`const ${out}=H.complexBesselJ({re:${value.re},im:${value.im}});`);
                } else {
                    const order = this.emitAsPair(node.args[0]);
                    this.emit(`const ${out}=H.complexBesselJ({re:${value.re},im:${value.im}},undefined,{re:${order.re},im:${order.im}});`);
                }
                return this.pair(`${out}.re`, `${out}.im`);
            }
            case 'sinh': return this.emitUnaryComplexCall(node, 'complexSinh');
            case 'cosh': return this.emitUnaryComplexCall(node, 'complexCosh');
            case 'tanh': return this.emitUnaryComplexCall(node, 'complexTanh');
            case 'zeta': return this.emitUnaryComplexCall(node, 'complexRiemannZeta');
            case 'selected': case 'selectedFunction': case 'f': {
                const value = this.emitAsPair(node.args[0]);
                const out = this.temp('z');
                this.emit(`const ${out}=H.transform(${JSON.stringify(name)},${value.re},${value.im},environment,${this.addNode(node)});`);
                this.variableCache.clear();
                return this.pair(`${out}.re`, `${out}.im`);
            }
            case 'mobius': case 'polynomial': case 'poincare': case 'power': {
                const value = this.emitAsPair(node.args[0]);
                const out = this.temp('z');
                this.emit(`const ${out}=H.transformFunctions[${JSON.stringify(name)}](${value.re},${value.im});`);
                return this.pair(`${out}.re`, `${out}.im`);
            }
            default: throw new Error('unsupported call');
        }
    }

    emitMinMax(node) {
        const isMin = node.name === 'min';
        const result = this.temp('r');
        this.emit(`let ${result}=${isMin ? 'Infinity' : '-Infinity'};`);
        for (const argument of node.args) {
            const value = this.emitReal(argument, `${node.name} argument`);
            this.emit(`if(${value}${isMin ? '<' : '>'}${result})${result}=${value};`);
        }
        return this.pair(result, '0');
    }

    emitUnaryComplexCall(node, helperName) {
        const value = this.emitAsPair(node.args[0]);
        switch (helperName) {
            case 'complexSin':
                return this.pair(`(Math.sin(${value.re})*Math.cosh(${value.im}))`, `(Math.cos(${value.re})*Math.sinh(${value.im}))`);
            case 'complexCos':
                return this.pair(`(Math.cos(${value.re})*Math.cosh(${value.im}))`, `(-Math.sin(${value.re})*Math.sinh(${value.im}))`);
            case 'complexExp': {
                const er = this.temp('e');
                this.emit(`const ${er}=Math.exp(${value.re});`);
                return this.pair(`(${er}*Math.cos(${value.im}))`, `(${er}*Math.sin(${value.im}))`);
            }
            case 'complexSinh':
                return this.pair(`(Math.sinh(${value.re})*Math.cos(${value.im}))`, `(Math.cosh(${value.re})*Math.sin(${value.im}))`);
            case 'complexCosh':
                return this.pair(`(Math.cosh(${value.re})*Math.cos(${value.im}))`, `(Math.sinh(${value.re})*Math.sin(${value.im}))`);
            case 'complexTan':
                return this.emitComplexTangent(value, false);
            case 'complexTanh':
                return this.emitComplexTangent(value, true);
            case 'complexSec': {
                const cr = this.temp('r');
                const ci = this.temp('i');
                const d = this.temp('d');
                this.emit(`const ${cr}=Math.cos(${value.re})*Math.cosh(${value.im});`);
                this.emit(`const ${ci}=-Math.sin(${value.re})*Math.sinh(${value.im});`);
                this.emit(`const ${d}=${cr}*${cr}+${ci}*${ci};`);
                return this.pair(`(${cr}/${d})`, `(-${ci}/${d})`);
            }
            default: {
                const out = this.temp('z');
                this.emit(`const ${out}=H.${helperName}({re:${value.re},im:${value.im}});`);
                return this.pair(`${out}.re`, `${out}.im`);
            }
        }
    }

    emitComplexTangent(value, hyperbolic) {
        const sr = this.temp('r');
        const si = this.temp('i');
        const cr = this.temp('r');
        const ci = this.temp('i');
        const d = this.temp('d');
        if (hyperbolic) {
            this.emit(`const ${sr}=Math.sinh(${value.re})*Math.cos(${value.im});`);
            this.emit(`const ${si}=Math.cosh(${value.re})*Math.sin(${value.im});`);
            this.emit(`const ${cr}=Math.cosh(${value.re})*Math.cos(${value.im});`);
            this.emit(`const ${ci}=Math.sinh(${value.re})*Math.sin(${value.im});`);
        } else {
            this.emit(`const ${sr}=Math.sin(${value.re})*Math.cosh(${value.im});`);
            this.emit(`const ${si}=Math.cos(${value.re})*Math.sinh(${value.im});`);
            this.emit(`const ${cr}=Math.cos(${value.re})*Math.cosh(${value.im});`);
            this.emit(`const ${ci}=-Math.sin(${value.re})*Math.sinh(${value.im});`);
        }
        this.emit(`const ${d}=${cr}*${cr}+${ci}*${ci};`);
        return this.pair(`((${sr}*${cr}+${si}*${ci})/${d})`, `((${si}*${cr}-${sr}*${ci})/${d})`);
    }

    emitNode(node) {
        switch (node.type) {
            case 'literal': return this.emitLiteral(node);
            case 'variable': return this.emitVariable(node);
            case 'group': return this.emitNode(node.expression);
            case 'unary': return this.emitUnary(node);
            case 'postfix': return this.emitPostfix(node);
            case 'binary': return this.emitBinary(node);
            case 'conditional': return this.emitConditional(node);
            case 'call': return this.emitCall(node);
            default: throw new Error('unsupported node');
        }
    }

    build() {
        const result = this.emitNode(this.ast);
        if (result.kind === 'boolean') {
            this.emit(`return ${result.value};`);
        } else {
            this.emit(`if(!Number.isFinite(${result.re})||!Number.isFinite(${result.im}))H.fail('Expression result is undefined or outside the supported numeric range',N[0]);return {re:${result.re},im:${result.im}};`);
        }
        const source = `return function generatedExpression(environment={}){${this.lines.join('')}}`;
        return Function('H', 'N', source)(getGeneratedHelpers(), this.nodes);
    }
}

class RealEvaluatorBuilder {
    constructor(ast, genericEvaluator) {
        this.ast = ast;
        this.genericEvaluator = genericEvaluator;
        this.nodes = [ast];
        this.lines = [];
        this.index = 0;
        this.variableCache = new Map();
    }

    addNode(node) {
        const index = this.nodes.length;
        this.nodes.push(node);
        return `N[${index}]`;
    }

    temp(prefix) {
        return `_q${prefix}${this.index++}`;
    }

    emit(line) {
        this.lines.push(line);
    }

    real(value) { return { kind: 'real', value }; }
    bool(value) { return { kind: 'boolean', value }; }

    emitRealTemp(expression) {
        const out = this.temp('r');
        this.emit(`const ${out}=${expression};`);
        return this.real(out);
    }

    emitNode(node) {
        switch (node.type) {
            case 'literal': return this.emitLiteral(node);
            case 'variable': return this.emitVariable(node);
            case 'group': return this.emitNode(node.expression);
            case 'unary': return this.emitUnary(node);
            case 'postfix': return this.emitPostfix(node);
            case 'binary': return this.emitBinary(node);
            case 'conditional': return this.emitConditional(node);
            case 'call': return this.emitCall(node);
            default: throw new Error('real unsupported node');
        }
    }

    emitLiteral(node) {
        const value = node.value;
        if (typeof value === 'boolean') return this.bool(value ? 'true' : 'false');
        if (typeof value === 'number') return this.real(String(value));
        if (isComplex(value) && Math.abs(value.im) <= EPSILON) return this.real(String(value.re));
        throw new Error('non-real literal');
    }

    emitVariable(node) {
        const name = node.name;
        if (HAS_OWN.call(CONSTANTS, name)) {
            const value = CONSTANTS[name];
            if (typeof value === 'boolean') return this.bool(value ? 'true' : 'false');
            if (Math.abs(value.im) <= EPSILON) return this.real(String(value.re));
            throw new Error('non-real constant');
        }
        const cached = this.variableCache.get(name);
        if (cached) return cached;
        const key = JSON.stringify(name);
        const raw = this.temp('v');
        const out = this.temp('r');
        this.emit(`if(!H.hasOwn.call(environment,${key}))return G(environment);`);
        this.emit(`const ${raw}=environment[${key}];`);
        this.emit(`let ${out};`);
        this.emit(`if(typeof ${raw}==='number'){${out}=${raw};}else if(typeof ${raw}==='boolean'){${out}=${raw}?1:0;}else if(${raw}!==null&&typeof ${raw}==='object'&&typeof ${raw}.re==='number'&&typeof ${raw}.im==='number'&&Math.abs(${raw}.im)<=1e-12){${out}=${raw}.re;}else{return G(environment);}`);
        const result = this.real(out);
        this.variableCache.set(name, result);
        return result;
    }

    asReal(node) {
        const value = this.emitNode(node);
        return value.kind === 'real' ? value : this.real(`(${value.value}?1:0)`);
    }

    asBool(node) {
        const value = this.emitNode(node);
        if (value.kind === 'boolean') return value;
        return this.bool(`(Number.isFinite(${value.value})&&Math.abs(${value.value})>1e-12)`);
    }

    emitUnary(node) {
        if (node.op === '!') return this.bool(`(!${this.asBool(node.argument).value})`);
        const value = this.asReal(node.argument).value;
        if (node.op === '+') return this.real(value);
        if (node.op === '-') return this.real(`(-${value})`);
        throw new Error('real unsupported unary');
    }

    emitPostfix(node) {
        const value = this.asReal(node.argument).value;
        return this.real(`H.factorialRe(${value},0,${this.addNode(node)})`);
    }

    emitBinary(node) {
        if (node.op === '&&') {
            const left = this.asBool(node.left).value;
            const out = this.temp('b');
            const outerCache = new Map(this.variableCache);
            this.emit(`let ${out}=false;`);
            this.emit(`if(${left}){`);
            this.variableCache = new Map(outerCache);
            const right = this.asBool(node.right).value;
            this.emit(`${out}=${right};`);
            this.emit('}');
            this.variableCache = outerCache;
            return this.bool(out);
        }
        if (node.op === '||') {
            const left = this.asBool(node.left).value;
            const out = this.temp('b');
            const outerCache = new Map(this.variableCache);
            this.emit(`let ${out}=true;`);
            this.emit(`if(!${left}){`);
            this.variableCache = new Map(outerCache);
            const right = this.asBool(node.right).value;
            this.emit(`${out}=${right};`);
            this.emit('}');
            this.variableCache = outerCache;
            return this.bool(out);
        }
        const left = this.asReal(node.left).value;
        const right = this.asReal(node.right).value;
        switch (node.op) {
            case '+': return this.emitRealTemp(`(${left}+${right})`);
            case '-': return this.emitRealTemp(`(${left}-${right})`);
            case '*': return this.emitRealTemp(`(${left}*${right})`);
            case '/': {
                const nodeRef = this.addNode(node);
                this.emit(`if(Math.abs(${right})<=1e-12)H.fail('Division by zero',${nodeRef});`);
                return this.emitRealTemp(`(${left}/${right})`);
            }
            case '^': {
                const base = this.temp('r');
                const exponent = this.temp('r');
                this.emit(`const ${base}=${left};`);
                this.emit(`const ${exponent}=${right};`);
                this.emit(`if(${base}<0&&Math.abs(${exponent}-Math.round(${exponent}))>1e-12)return G(environment);`);
                return this.emitRealTemp(`Math.pow(${base},${exponent})`);
            }
            case '==': return this.bool(`(Math.abs(${left}-${right})<=1e-12)`);
            case '!=': return this.bool(`(Math.abs(${left}-${right})>1e-12)`);
            case '<': return this.bool(`(${left}<${right})`);
            case '<=': return this.bool(`(${left}<=${right})`);
            case '>': return this.bool(`(${left}>${right})`);
            case '>=': return this.bool(`(${left}>=${right})`);
            default: throw new Error('real unsupported binary');
        }
    }

    emitConditional(node) {
        const test = this.asBool(node.test).value;
        const out = this.temp('r');
        const outerCache = new Map(this.variableCache);
        this.emit(`let ${out};`);
        this.emit(`if(${test}){`);
        this.variableCache = new Map(outerCache);
        const consequent = this.asReal(node.consequent).value;
        this.emit(`${out}=${consequent};`);
        this.emit('}else{');
        this.variableCache = new Map(outerCache);
        const alternate = this.asReal(node.alternate).value;
        this.emit(`${out}=${alternate};`);
        this.emit('}');
        this.variableCache = outerCache;
        return this.real(out);
    }

    emitCall(node) {
        const range = ARITY[node.name];
        if (!range || node.args.length < range[0] || node.args.length > range[1]) throw new Error('real arity');
        const name = node.name;
        switch (name) {
            case 'abs': return this.emitRealTemp(`Math.abs(${this.asReal(node.args[0]).value})`);
            case 'arg': {
                const value = this.asReal(node.args[0]).value;
                return this.emitRealTemp(`Math.atan2(0,${value})`);
            }
            case 're': return this.real(this.asReal(node.args[0]).value);
            case 'im': return this.real('0');
            case 'conj': return this.real(this.asReal(node.args[0]).value);
            case 'floor': case 'ceil': case 'round': case 'trunc': case 'sign':
                return this.emitRealTemp(`Math.${name}(${this.asReal(node.args[0]).value})`);
            case 'sin': return this.emitRealTemp(`Math.sin(${this.asReal(node.args[0]).value})`);
            case 'cos': return this.emitRealTemp(`Math.cos(${this.asReal(node.args[0]).value})`);
            case 'tan': return this.emitRealTemp(`Math.tan(${this.asReal(node.args[0]).value})`);
            case 'exp': throw new Error('configured complex base');
            case 'sinh': return this.emitRealTemp(`Math.sinh(${this.asReal(node.args[0]).value})`);
            case 'cosh': return this.emitRealTemp(`Math.cosh(${this.asReal(node.args[0]).value})`);
            case 'tanh': return this.emitRealTemp(`Math.tanh(${this.asReal(node.args[0]).value})`);
            case 'sec': return this.emitRealTemp(`(1/Math.cos(${this.asReal(node.args[0]).value}))`);
            case 'sqrt': {
                const value = this.asReal(node.args[0]).value;
                this.emit(`if(${value}<0)return G(environment);`);
                return this.emitRealTemp(`Math.sqrt(${value})`);
            }
            case 'ln': case 'log': throw new Error('configured complex base');
            case 'reciprocal': {
                const value = this.asReal(node.args[0]).value;
                const nodeRef = this.addNode(node);
                this.emit(`if(Math.abs(${value})<=1e-12)H.fail('Division by zero',${nodeRef});`);
                return this.emitRealTemp(`(1/${value})`);
            }
            case 'min': case 'max': return this.emitMinMax(node);
            case 'mod': {
                const left = this.asReal(node.args[0]).value;
                const right = this.asReal(node.args[1]).value;
                const nodeRef = this.addNode(node);
                this.emit(`if(Math.abs(${right})<=1e-12)H.fail('mod divisor must not be zero',${nodeRef});`);
                return this.emitRealTemp(`(${left}%${right})`);
            }
            case 'gcd': return this.real(`H.gcdRe(${this.asReal(node.args[0]).value},0,${this.asReal(node.args[1]).value},0,${this.addNode(node)})`);
            case 'factorial': return this.real(`H.factorialRe(${this.asReal(node.args[0]).value},0,${this.addNode(node)})`);
            case 'isPrime': return this.bool(`H.isPrimeInteger(H.integer(${this.asReal(node.args[0]).value},0,'isPrime argument',${this.addNode(node)}))`);
            case 'pow': return this.emitBinary({ ...node, type: 'binary', op: '^', left: node.args[0], right: node.args[1] });
            case 'complex': {
                const im = node.args.length === 2 ? this.asReal(node.args[1]).value : '0';
                this.emit(`if(Math.abs(${im})>1e-12)return G(environment);`);
                return this.real(this.asReal(node.args[0]).value);
            }
            default: throw new Error('real unsupported call');
        }
    }

    emitMinMax(node) {
        const result = this.temp('r');
        const isMin = node.name === 'min';
        this.emit(`let ${result}=${isMin ? 'Infinity' : '-Infinity'};`);
        for (const argument of node.args) {
            const value = this.asReal(argument).value;
            this.emit(`if(${value}${isMin ? '<' : '>'}${result})${result}=${value};`);
        }
        return this.real(result);
    }

    build() {
        const result = this.emitNode(this.ast);
        if (result.kind === 'boolean') this.emit(`return ${result.value};`);
        else this.emit(`if(!Number.isFinite(${result.value}))H.fail('Expression result is undefined or outside the supported numeric range',N[0]);return {re:${result.value},im:0};`);
        const source = `return function realExpression(environment={}){${this.lines.join('')}}`;
        return Function('H', 'N', 'G', source)(getGeneratedHelpers(), this.nodes, this.genericEvaluator);
    }
}

function compileRealEvaluator(ast, genericEvaluator) {
    try {
        return new RealEvaluatorBuilder(ast, genericEvaluator).build();
    } catch {
        return null;
    }
}

function escapeForMessage(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function compileFastEvaluator(ast) {
    if (!ast || typeof ast !== 'object') return null;
    if (ast.type === 'literal') return environment => evaluateExpressionInterpreted(ast, environment);
    try {
        const generic = new GeneratedEvaluatorBuilder(ast).build();
        return compileRealEvaluator(ast, generic) || generic;
    } catch {
        return null;
    }
}

function validateDependencies(ast, dependencies, allowedVariables) {
    if (allowedVariables) {
        for (const variable of dependencies.variables) {
            if (!allowedVariables.has(variable) && !HAS_OWN.call(CONSTANTS, variable)) {
                throw new ExpressionEvaluationError(`Variable "${variable}" is not allowed`, ast);
            }
        }
    }

    for (const functionName of dependencies.functions) {
        if (!ARITY[functionName] && typeof transformFunctions[functionName] !== 'function') {
            throw new ExpressionEvaluationError(`Unknown function "${functionName}"`, ast);
        }
    }
}

function compileAstExpression(ast, sourceText, optionKey, allowedVariables) {
    const cacheable = ast !== null && typeof ast === 'object';
    let byOption = null;

    if (cacheable) {
        byOption = COMPILED_AST_CACHE.get(ast);
        if (!byOption) {
            byOption = new Map();
            COMPILED_AST_CACHE.set(ast, byOption);
        }
        const cached = byOption.get(optionKey);
        if (cached) return cached;
    }

    const dependencies = collectExpressionDependencies(ast);
    validateDependencies(ast, dependencies, allowedVariables);
    const fastEvaluator = getCachedFastEvaluator(ast);
    const evaluator = fastEvaluator || (environment => evaluateExpressionInterpreted(ast, environment));
    evaluator.ast = ast;
    evaluator.source = sourceText;
    evaluator.dependencies = dependencies;
    if (byOption) byOption.set(optionKey, evaluator);
    return evaluator;
}

export function compileExpression(source, options = {}) {
    const sourceText = typeof source === 'string' ? source : null;
    const optionKey = optionsCacheKey(options);
    const allowedVariables = options.allowedVariables ? new Set(options.allowedVariables) : null;

    if (sourceText !== null) {
        const sourceKey = optionKey === '' ? sourceText : `${optionKey}\u0001${sourceText}`;
        const cached = COMPILED_SOURCE_CACHE.get(sourceKey);
        if (cached) return cached;
        const ast = parseExpression(sourceText);
        return rememberSourceEvaluator(sourceKey, compileAstExpression(ast, sourceText, optionKey, allowedVariables));
    }

    return compileAstExpression(source, null, optionKey, allowedVariables);
}

export function finiteComplex(value) {
    const z = toComplex(value);
    return Number.isFinite(z.re) && Number.isFinite(z.im);
}

export function asComplex(value) {
    return toComplex(value);
}

export function asBoolean(value) {
    return truthy(value);
}
