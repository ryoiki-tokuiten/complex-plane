import { state } from '../../store/state.js';
import {
    compileNativeExpressionProgram,
    evaluateNativeExpressionProgram,
    nativeMapOptions
} from '../../native/complex-engine.js';
import { collectExpressionDependencies, parseExpression } from './parser.js';

const SOURCE_CACHE_LIMIT = 128;
const CONSTANTS = new Set(['i', 'pi', 'e', 'true', 'false']);
const SOURCE_CACHE = new Map();
const AST_CACHE = new WeakMap();

const ARITY = Object.freeze({
    cos: [1, 1], tan: [1, 1], sec: [1, 1], asin: [1, 1], atan: [1, 1],
    exp: [1, 1], ln: [1, 1], log: [1, 1], gamma: [1, 1], loggamma: [1, 1],
    bessel: [1, 2], sinh: [1, 1], tanh: [1, 1], sqrt: [1, 1],
    zeta: [1, 1], abs: [1, 1], arg: [1, 1], re: [1, 1],
    im: [1, 1], conj: [1, 1], complex: [1, 2], floor: [1, 1], ceil: [1, 1],
    round: [1, 1], trunc: [1, 1], sign: [1, 1], min: [1, Infinity], max: [1, Infinity],
    mod: [2, 2], gcd: [2, 2], factorial: [1, 1], isPrime: [1, 1], pow: [2, 2],
    selected: [1, 1], selectedFunction: [1, 1], f: [1, 1], mobius: [1, 1],
    polynomial: [1, 1], power: [1, 1]
});

export class ExpressionEvaluationError extends Error {
    constructor(message, node = null) {
        super(message);
        this.name = 'ExpressionEvaluationError';
        this.node = node;
    }
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

function optionKey(options) {
    const variables = options?.allowedVariables;
    return variables ? Array.from(variables).join('\u0000') : '';
}

function validate(ast, dependencies, allowedVariables) {
    if (allowedVariables) {
        for (const variable of dependencies.variables) {
            if (!allowedVariables.has(variable) && !CONSTANTS.has(variable)) {
                throw new ExpressionEvaluationError(`Variable "${variable}" is not allowed`, ast);
            }
        }
    }
    for (const name of dependencies.functions) {
        const range = ARITY[name];
        if (!range) throw new ExpressionEvaluationError(`Unknown function "${name}"`, ast);
    }
    const visit = node => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'call') {
            const range = ARITY[node.name];
            if (!range || node.args.length < range[0] || node.args.length > range[1]) {
                const expected = range && range[0] === range[1]
                    ? `${range[0]}`
                    : `${range?.[0] ?? 0} to ${range?.[1] === Infinity ? 'many' : range?.[1] ?? 0}`;
                throw new ExpressionEvaluationError(
                    `Function "${node.name}" expects ${expected} argument(s), received ${node.args.length}`,
                    node
                );
            }
            node.args.forEach(visit);
        } else if (node.type === 'binary') {
            visit(node.left); visit(node.right);
        } else if (node.type === 'unary' || node.type === 'postfix') visit(node.argument);
        else if (node.type === 'group') visit(node.expression);
        else if (node.type === 'conditional') {
            visit(node.test); visit(node.consequent); visit(node.alternate);
        }
    };
    visit(ast);
}

function selectedMapOptions(environment, ast) {
    const selected = environment.selectedFunction;
    if (selected === undefined) return nativeMapOptions(state, { chainingEnabled: false, chainCount: 1 });
    const metadata = selected?.nativeMapOptions;
    const functionKey = metadata?.functionKey || selected?.nativeFunctionKey;
    if (!functionKey) {
        throw new ExpressionEvaluationError('Selected function is not owned by the native engine', ast);
    }
    return nativeMapOptions(state, { ...metadata, functionKey });
}

function buildEvaluator(ast, source, allowedVariables) {
    const dependencies = collectExpressionDependencies(ast);
    validate(ast, dependencies, allowedVariables);
    const variableNames = Array.from(dependencies.variables).filter(name => !CONSTANTS.has(name));
    let program;
    try {
        program = compileNativeExpressionProgram(ast, variableNames);
    } catch (error) {
        throw new ExpressionEvaluationError(error?.message || String(error), ast);
    }
    const usesSelected = ['selected', 'selectedFunction', 'f'].some(name => dependencies.functions.has(name));
    const evaluator = (environment = {}) => {
        if (environment.functions && Object.keys(environment.functions).length) {
            throw new ExpressionEvaluationError('JavaScript expression function overrides are not supported', ast);
        }
        try {
            const map = usesSelected ? selectedMapOptions(environment, ast)
                : nativeMapOptions(state, { chainingEnabled: false, chainCount: 1 });
            return evaluateNativeExpressionProgram(program, [environment], map)[0];
        } catch (error) {
            if (error instanceof ExpressionEvaluationError) throw error;
            const message = error?.message || String(error);
            const normalized = message === 'value must be real' ? 'value must be real'
                : message === 'value must be an integer' ? 'factorial argument must be an integer'
                    : message;
            throw new ExpressionEvaluationError(normalized, ast);
        }
    };
    evaluator.evaluateBatch = environments => {
        if (!Array.isArray(environments) || !environments.length) return [];
        const firstMap = usesSelected ? selectedMapOptions(environments[0], ast)
            : nativeMapOptions(state, { chainingEnabled: false, chainCount: 1 });
        return evaluateNativeExpressionProgram(program, environments, firstMap);
    };
    evaluator.evaluateBatchSettled = environments => {
        if (!Array.isArray(environments) || !environments.length) return [];
        const firstMap = usesSelected ? selectedMapOptions(environments[0], ast)
            : nativeMapOptions(state, { chainingEnabled: false, chainCount: 1 });
        return evaluateNativeExpressionProgram(program, environments, firstMap, true);
    };
    evaluator.ast = ast;
    evaluator.source = source;
    evaluator.dependencies = dependencies;
    evaluator.nativeProgram = program;
    return evaluator;
}

function compileAst(ast, source, options) {
    const key = optionKey(options);
    let variants = AST_CACHE.get(ast);
    if (!variants) {
        variants = new Map();
        AST_CACHE.set(ast, variants);
    }
    if (variants.has(key)) return variants.get(key);
    const allowedVariables = options?.allowedVariables ? new Set(options.allowedVariables) : null;
    const evaluator = buildEvaluator(ast, source, allowedVariables);
    variants.set(key, evaluator);
    return evaluator;
}

export function compileExpression(source, options = {}) {
    if (typeof source !== 'string') return compileAst(source, null, options);
    const key = `${optionKey(options)}\u0001${source}`;
    if (SOURCE_CACHE.has(key)) return SOURCE_CACHE.get(key);
    const evaluator = compileAst(parseExpression(source), source, options);
    if (SOURCE_CACHE.size >= SOURCE_CACHE_LIMIT) SOURCE_CACHE.delete(SOURCE_CACHE.keys().next().value);
    SOURCE_CACHE.set(key, evaluator);
    return evaluator;
}

export function finiteComplex(value) {
    const complex = asComplex(value);
    return Number.isFinite(complex.re) && Number.isFinite(complex.im);
}

export function asComplex(value) {
    if (value && typeof value === 'object' && typeof value.re === 'number' && typeof value.im === 'number') return value;
    if (typeof value === 'number') return { re: value, im: 0 };
    if (typeof value === 'boolean') return { re: value ? 1 : 0, im: 0 };
    return { re: NaN, im: NaN };
}

export function asBoolean(value) {
    if (typeof value === 'boolean') return value;
    const complex = asComplex(value);
    return Number.isFinite(complex.re) && Number.isFinite(complex.im) &&
        (Math.abs(complex.re) > 1e-12 || Math.abs(complex.im) > 1e-12);
}
