import { state } from '../../store/state.js';
import {
    compileNativeExpressionProgram,
    evaluateNativeExpressionProgram,
    nativeMapOptions
} from '../../native/complex-engine.js';
import { collectExpressionDependencies, parseExpression, FUNCTION_ARITY } from './parser.js';

const SOURCE_CACHE_LIMIT = 128;
const CONSTANTS = new Set(['i', 'pi', 'e', 'true', 'false']);
const SOURCE_CACHE = new Map();
const AST_CACHE = new WeakMap();

const ARITY = FUNCTION_ARITY;

export class ExpressionEvaluationError extends Error {
    constructor(message, node = null) {
        super(message);
        this.name = 'ExpressionEvaluationError';
        this.node = node;
    }
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
    const functionKey = metadata?.functionKey;
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

export function asComplex(value) {
    if (value && typeof value === 'object' && typeof value.re === 'number' && typeof value.im === 'number') return value;
    if (typeof value === 'number') return { re: value, im: 0 };
    if (typeof value === 'boolean') return { re: value ? 1 : 0, im: 0 };
    return { re: NaN, im: NaN };
}
