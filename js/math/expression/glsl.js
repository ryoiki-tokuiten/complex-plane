import { generateDiscreteSource } from '../../analysis/discrete-sources.js';
import {
    generateSequenceBindingSeries,
    synchronizeSequenceBindings
} from '../../analysis/sequence-bindings.js';
import { parseExpression } from './parser.js';
import { requireFiniteComplex, requireFiniteNumber, requireInteger } from '../../utils/numeric-contracts.js';

const MAX_SHADER_CACHE_ENTRIES = 12;
const MAX_EXPRESSION_CACHE_ENTRIES = 64;
const MAX_CSE_EXPRESSION_CACHE_ENTRIES = 128;
const CSE_MIN_COST = 20;
const aggregateShaderCache = new Map();
const expressionCache = new Map();
const cseExpressionCache = new Map();
const ZERO_VEC = 'vec2(0.0)';
const ONE_VEC = 'vec2(1.0, 0.0)';
const I_VEC = 'vec2(0.0, 1.0)';
const PI_VEC = 'vec2(PI, 0.0)';
const E_VEC = 'vec2(2.718281828459045, 0.0)';
const TRUE_VEC = 'vec2(1.0, 0.0)';
const FALSE_VEC = ZERO_VEC;
const TEXT_HASH_CACHE = new Map();

function isBooleanBinaryOperator(op) {
    return op === '&&' || op === '||' || op === '==' || op === '!=' ||
        op === '<' || op === '<=' || op === '>' || op === '>=';
}

function isSafeIdentifierName(name) {
    if (typeof name !== 'string' || name.length === 0) return false;
    let code = name.charCodeAt(0);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95)) return false;
    for (let index = 1; index < name.length; index++) {
        code = name.charCodeAt(index);
        if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || (code >= 48 && code <= 57))) return false;
    }
    return true;
}
const GPU_ARITY = Object.freeze({
    cos: [1, 1], tan: [1, 1], sec: [1, 1], asin: [1, 1], atan: [1, 1],
    exp: [1, 1], ln: [1, 1], log: [1, 1],
    gamma: [1, 1], loggamma: [1, 1], bessel: [1, 2],
    sinh: [1, 1], tanh: [1, 1],
    sqrt: [1, 1],
    abs: [1, 1], arg: [1, 1], re: [1, 1], im: [1, 1], conj: [1, 1],
    complex: [1, 2], floor: [1, 1], ceil: [1, 1], round: [1, 1],
    trunc: [1, 1], sign: [1, 1], min: [1, Infinity], max: [1, Infinity],
    mod: [2, 2], gcd: [2, 2], factorial: [1, 1], isPrime: [1, 1],
    pow: [2, 2], selected: [1, 1], selectedFunction: [1, 1], f: [1, 1]
});

function cacheMapResult(cache, limit, key, result) {
    cache.set(key, result);
    if (cache.size > limit) cache.delete(cache.keys().next().value);
    return result;
}

function cacheShaderResult(key, result) {
    return cacheMapResult(aggregateShaderCache, MAX_SHADER_CACHE_ENTRIES, key, result);
}

function glslFloat(value) {
    const numeric = requireFiniteNumber(value, 'GLSL numeric literal');
    if (Object.is(numeric, -0)) return '0.0';
    const rendered = Number(numeric.toPrecision(12)).toString();
    return rendered.includes('.') || /e/i.test(rendered) ? rendered : `${rendered}.0`;
}

function vec2(value) {
    const point = requireFiniteComplex(value, 'GLSL complex literal');
    return `vec2(${glslFloat(point.re)}, ${glslFloat(point.im)})`;
}

function assertExpressionNode(node) {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') {
        throw new Error('Invalid expression AST node received by the GPU expression compiler');
    }
}

function assertGPUArity(node) {
    const args = Array.isArray(node.args) ? node.args : [];
    const [minimum, maximum] = GPU_ARITY[node.name] || [1, 1];
    if (args.length < minimum || args.length > maximum) {
        const expected = minimum === maximum
            ? String(minimum)
            : `${minimum} to ${maximum === Infinity ? 'many' : maximum}`;
        throw new Error(
            `Function "${node.name}" expects ${expected} argument(s), received ${args.length}`
        );
    }
}

function dynamicEnabled(appState) {
    const config = appState?.dynamicPlotting;
    if (!config?.enabled) return false;
    if (config.mode === 'map') return false;
    if (config.mode !== 'aggregate' ||
        (config.reduction?.kind !== 'sum' && config.reduction?.kind !== 'product')) {
        throw new Error('GPU dynamic plotting requires a valid aggregate reduction.');
    }
    return true;
}

function parameterMap(appState) {
    const parameters = appState?.dynamicPlotting?.parameters;
    if (!Array.isArray(parameters)) throw new Error('GPU dynamic plotting requires a parameter array.');
    const output = {};
    for (let index = 0; index < parameters.length; index++) {
        const parameter = parameters[index];
        const name = String(parameter?.name ?? '').trim();
        if (!isSafeIdentifierName(name)) throw new Error(`Invalid dynamic parameter name: ${name}.`);
        output[name] = {
            re: requireFiniteNumber(parameter.value, `Dynamic parameter ${name}`),
            im: 0
        };
    }
    return output;
}

function variableExpression(node, context) {
    const name = node.name;
    if (name === 'd' || name === 'z' || name === 's') return name;
    if (name === 'j') return 'vec2(float(idx), 0.0)';
    if (name === 'i') return I_VEC;
    if (name === 'pi') return PI_VEC;
    if (name === 'e') return E_VEC;
    if (name === 'true') return TRUE_VEC;
    if (name === 'false') return FALSE_VEC;
    if (context.variables?.[name]) return context.variables[name];
    if (context.parameters?.[name]) return vec2(context.parameters[name]);
    throw new Error(`Variable "${name}" is not supported by the GPU expression compiler`);
}

function literalSignature(value) {
    return `${glslFloat(value?.re)},${glslFloat(value?.im)}`;
}

function hashText(text) {
    const source = String(text);
    const cached = TEXT_HASH_CACHE.get(source);
    if (cached !== undefined) return cached;
    let hash = 2166136261;
    for (let index = 0; index < source.length; index++) {
        hash = Math.imul(hash ^ source.charCodeAt(index), 16777619) >>> 0;
    }
    if (TEXT_HASH_CACHE.size > 512) TEXT_HASH_CACHE.clear();
    TEXT_HASH_CACHE.set(source, hash);
    return hash;
}

function hashMix(hash, part) {
    return Math.imul(hash ^ (part >>> 0), 16777619) >>> 0;
}

function hashStart(tag) {
    return Math.imul(2166136261 ^ tag, 16777619) >>> 0;
}

function sheetSalt(context, enabled) {
    return enabled && context.sheet ? 0x9e3779b9 : 0;
}

function pushAnalysisChildren(stack, node) {
    switch (node.type) {
        case 'group':
            if (node.expression) stack.push([node.expression, 0]);
            break;
        case 'unary':
        case 'postfix':
            if (node.argument) stack.push([node.argument, 0]);
            break;
        case 'binary':
            if (node.right) stack.push([node.right, 0]);
            if (node.left) stack.push([node.left, 0]);
            break;
        case 'conditional':
            if (node.alternate) stack.push([node.alternate, 0]);
            if (node.consequent) stack.push([node.consequent, 0]);
            if (node.test) stack.push([node.test, 0]);
            break;
        case 'call': {
            const args = node.args || [];
            for (let index = args.length - 1; index >= 0; index--) stack.push([args[index], 0]);
            break;
        }
        default:
            break;
    }
}

function analyzeExpressionTree(root, context) {
    assertExpressionNode(root);
    const meta = new WeakMap();
    const counts = new Map();
    const representatives = new Map();
    const stack = [[root, 0]];

    while (stack.length) {
        const frame = stack.pop();
        const node = frame[0];
        assertExpressionNode(node);
        if (frame[1] === 0) {
            frame[1] = 1;
            stack.push(frame);
            pushAnalysisChildren(stack, node);
            continue;
        }

        let hash;
        let cost = 1;
        switch (node.type) {
            case 'literal':
                hash = hashMix(hashStart(1), hashText(literalSignature(node.value)));
                break;
            case 'variable': {
                hash = hashStart(2);
                hash = hashMix(hash, hashText(node.name));
                hash = hashMix(hash, hashText(variableExpression(node, context)));
                break;
            }
            case 'group': {
                const child = meta.get(node.expression);
                hash = hashMix(hashStart(3), child.hash);
                cost = child.cost + 1;
                break;
            }
            case 'unary': {
                const child = meta.get(node.argument);
                hash = hashStart(4);
                hash = hashMix(hash, hashText(node.op));
                hash = hashMix(hash, child.hash);
                cost = child.cost + 2;
                break;
            }
            case 'postfix': {
                const child = meta.get(node.argument);
                hash = hashStart(5);
                hash = hashMix(hash, hashText(node.op || '!'));
                hash = hashMix(hash, child.hash);
                cost = child.cost + 6;
                break;
            }
            case 'binary': {
                const left = meta.get(node.left);
                const right = meta.get(node.right);
                hash = hashStart(6);
                hash = hashMix(hash, hashText(node.op));
                hash = hashMix(hash, sheetSalt(context, node.op === '^'));
                hash = hashMix(hash, left.hash);
                hash = hashMix(hash, right.hash);
                cost = left.cost + right.cost + (node.op === '^' ? 14 : isBooleanBinaryOperator(node.op) ? 5 : 3);
                break;
            }
            case 'conditional': {
                const test = meta.get(node.test);
                const consequent = meta.get(node.consequent);
                const alternate = meta.get(node.alternate);
                hash = hashStart(7);
                hash = hashMix(hash, test.hash);
                hash = hashMix(hash, consequent.hash);
                hash = hashMix(hash, alternate.hash);
                cost = test.cost + consequent.cost + alternate.cost + 5;
                break;
            }
            case 'call': {
                const args = node.args || [];
                hash = hashStart(8);
                hash = hashMix(hash, hashText(node.name));
                hash = hashMix(hash, sheetSalt(context, node.name === 'ln' || node.name === 'log' || node.name === 'sqrt' || node.name === 'pow'));
                for (let index = 0; index < args.length; index++) {
                    const child = meta.get(args[index]);
                    cost += child.cost;
                    hash = hashMix(hash, child.hash);
                }
                cost += node.name === 'pow' ? 14 : 8;
                break;
            }
            default:
                throw new Error(`Expression node "${node.type}" is not supported by the GPU expression compiler`);
        }

        meta.set(node, { hash, cost });
        counts.set(hash, (counts.get(hash) || 0) + 1);
        if (!representatives.has(hash)) representatives.set(hash, node);
    }

    return { meta, counts, representatives };
}

function shouldMaterialize(node, hash, analysis) {
    if (node.type === 'literal' || node.type === 'variable' || node.type === 'group') return false;
    const item = analysis.meta.get(node);
    return item.cost >= CSE_MIN_COST && (analysis.counts.get(hash) || 0) > 1;
}


function realIntegerLiteral(node) {
    if (node?.type !== 'literal') return null;
    const re = Number(node.value?.re);
    const im = Number(node.value?.im);
    if (!Number.isFinite(re) || !Number.isFinite(im) || Math.abs(im) > 1.0e-12) return null;
    const rounded = Math.round(re);
    return Math.abs(re - rounded) < 1.0e-12 ? rounded : null;
}

function compilePowExpression(left, right, rightNode, context) {
    const integerExponent = realIntegerLiteral(rightNode);
    if (integerExponent === 1) return left;
    if (integerExponent === 2 && left.length <= 48) return `complexMul(${left}, ${left})`;
    if (integerExponent === 3 && left.length <= 36) return `complexMul(complexMul(${left}, ${left}), ${left})`;
    return context.sheet
        ? `dynamicComplexPowOnSheet(${left}, ${right}, branchIndex, branchCutWidth)`
        : `dynamicComplexPow(${left}, ${right})`;
}

function foldReal(args, operation) {
    if (!args.length) return '0.0';
    let result = `dynamicReal(${args[0]})`;
    for (let index = 1; index < args.length; index++) {
        result = `${operation}(${result}, dynamicReal(${args[index]}))`;
    }
    return result;
}

function compileCallExpression(node, args, context) {
    assertGPUArity(node);
    const first = args[0] || ZERO_VEC;

    switch (node.name) {
        case 'sin': return `complexSin(${first})`;
        case 'cos': return `complexCos(${first})`;
        case 'tan': return `complexDiv(complexSin(${first}), complexCos(${first}))`;
        case 'sec': return `complexDiv(${ONE_VEC}, complexCos(${first}))`;
        case 'exp': return `complexExpWithBase(${first})`;
        case 'asin': return `complexArcsin(${first})`;
        case 'atan': return `complexArctan(${first})`;
        case 'gamma': return `complexGamma(${first})`;
        case 'loggamma': return `complexLogGamma(${first})`;
        case 'bessel': return args.length === 1
            ? `complexBesselJ(${first}, u_besselOrder)`
            : `complexBesselJ(${args[1]}, ${first})`;
        case 'ln':
        case 'log':
            return context.sheet
                ? `dynamicLnOnSheet(${first}, branchIndex, branchCutWidth)`
                : `complexLogWithBase(${first})`;
        case 'sinh': return `complexSinh(${first})`;
        case 'tanh': return `complexTanh(${first})`;
        case 'sqrt':
            return context.sheet
                ? `dynamicComplexPowOnSheet(${first}, vec2(0.5, 0.0), branchIndex, branchCutWidth)`
                : `dynamicComplexPow(${first}, vec2(0.5, 0.0))`;
        case 'abs': return `vec2(length(${first}), 0.0)`;
        case 'arg': return `vec2(atan((${first}).y, (${first}).x), 0.0)`;
        case 're': return `vec2((${first}).x, 0.0)`;
        case 'im': return `vec2((${first}).y, 0.0)`;
        case 'conj': return `vec2((${first}).x, -(${first}).y)`;
        case 'complex': return `vec2(dynamicReal(${args[0]}), dynamicReal(${args[1] || ZERO_VEC}))`;
        case 'floor': return `vec2(floor(dynamicReal(${first})), 0.0)`;
        case 'ceil': return `vec2(ceil(dynamicReal(${first})), 0.0)`;
        case 'round': return `vec2(floor(dynamicReal(${first}) + 0.5), 0.0)`;
        case 'trunc': return `vec2(dynamicTrunc(dynamicReal(${first})), 0.0)`;
        case 'sign': return `vec2(sign(dynamicReal(${first})), 0.0)`;
        case 'min': return `vec2(${foldReal(args, 'min')}, 0.0)`;
        case 'max': return `vec2(${foldReal(args, 'max')}, 0.0)`;
        case 'mod': {
            const left = `dynamicReal(${args[0]})`;
            const right = `dynamicReal(${args[1]})`;
            return `vec2(${left} - ${right} * dynamicTrunc(${left} / ${right}), 0.0)`;
        }
        case 'gcd': return `vec2(dynamicGcd(dynamicReal(${args[0]}), dynamicReal(${args[1]})), 0.0)`;
        case 'factorial': return `vec2(dynamicFactorial(dynamicReal(${first})), 0.0)`;
        case 'isPrime':
            throw new Error('isPrime() is evaluated by the exact CPU backend');
        case 'pow':
            return compilePowExpression(args[0], args[1], node.args?.[1], context);
        case 'selected':
        case 'selectedFunction':
        case 'f':
            return context.sheet
                ? `dynamicEvaluateBasicOnSheet(${glslFloat(context.selectedFunctionId)}, ${first}, branchIndex, branchCutWidth, mA, mB, mC, mD, polyDeg, polyCoeffs, zetaCont, zetaRefl, fracPower)`
                : `dynamicEvaluateBasic(${glslFloat(context.selectedFunctionId)}, ${first}, mA, mB, mC, mD, polyDeg, polyCoeffs, zetaCont, zetaRefl, fracPower)`;
        default: {
            const functionId = context.getFunctionId(node.name);
            if (!functionId || functionId === 16 || functionId === 17) {
                throw new Error(`Function "${node.name}" is not supported by the GPU expression compiler`);
            }
            return context.sheet
                ? `dynamicEvaluateBasicOnSheet(${glslFloat(functionId)}, ${first}, branchIndex, branchCutWidth, mA, mB, mC, mD, polyDeg, polyCoeffs, zetaCont, zetaRefl, fracPower)`
                : `dynamicEvaluateBasic(${glslFloat(functionId)}, ${first}, mA, mB, mC, mD, polyDeg, polyCoeffs, zetaCont, zetaRefl, fracPower)`;
        }
    }
}


function compileBooleanDirect(node, context) {
    if (node.type === 'unary' && node.op === '!') return `(!${compileBooleanDirect(node.argument, context)})`;
    if (node.type === 'binary') {
        if (node.op === '&&' || node.op === '||') return `(${compileBooleanDirect(node.left, context)} ${node.op} ${compileBooleanDirect(node.right, context)})`;
        const left = compileNodeDirect(node.left, context);
        const right = compileNodeDirect(node.right, context);
        if (node.op === '==') return `(distance(${left}, ${right}) < 1.0e-6)`;
        if (node.op === '!=') return `(distance(${left}, ${right}) >= 1.0e-6)`;
        if (node.op === '<' || node.op === '<=' || node.op === '>' || node.op === '>=') return `(dynamicReal(${left}) ${node.op} dynamicReal(${right}))`;
    }
    if (node.type === 'call' && node.name === 'isPrime') throw new Error('isPrime() is evaluated by the exact CPU backend');
    return `dynamicTruthy(${compileNodeDirect(node, context)})`;
}

function compileNodeDirect(node, context) {
    assertExpressionNode(node);
    switch (node.type) {
        case 'literal': return vec2(node.value);
        case 'variable': return variableExpression(node, context);
        case 'group': return `(${compileNodeDirect(node.expression, context)})`;
        case 'unary':
            if (node.op === '+') return compileNodeDirect(node.argument, context);
            if (node.op === '-') return `(-${compileNodeDirect(node.argument, context)})`;
            if (node.op === '!') return `dynamicBool(${compileBooleanDirect(node, context)})`;
            throw new Error(`Unary operator "${node.op}" is not supported by the GPU expression compiler`);
        case 'postfix': return `vec2(dynamicFactorial(dynamicReal(${compileNodeDirect(node.argument, context)})), 0.0)`;
        case 'binary': {
            if (isBooleanBinaryOperator(node.op)) return `dynamicBool(${compileBooleanDirect(node, context)})`;
            const left = compileNodeDirect(node.left, context);
            const right = compileNodeDirect(node.right, context);
            if (node.op === '+') return `(${left} + ${right})`;
            if (node.op === '-') return `(${left} - ${right})`;
            if (node.op === '*') return `complexMul(${left}, ${right})`;
            if (node.op === '/') return `complexDiv(${left}, ${right})`;
            if (node.op === '^') return compilePowExpression(left, right, node.right, context);
            throw new Error(`Operator "${node.op}" is not supported by the GPU expression compiler`);
        }
        case 'conditional': return `(${compileBooleanDirect(node.test, context)} ? ${compileNodeDirect(node.consequent, context)} : ${compileNodeDirect(node.alternate, context)})`;
        case 'call': return compileCallExpression(node, (node.args || []).map(argument => compileNodeDirect(argument, context)), context);
        default: throw new Error(`Expression node "${node.type}" is not supported by the GPU expression compiler`);
    }
}


function compileNode(node, context) {
    return compileNodeDirect(node, context);
}

function shouldMaterializeInState(node, state, allowMaterialize) {
    if (!allowMaterialize) return false;
    const hash = state.analysis.meta.get(node).hash;
    return shouldMaterialize(node, hash, state.analysis);
}

function compileBooleanCSE(node, state) {
    if (node.type === 'unary' && node.op === '!') {
        return `(!${compileBooleanCSE(node.argument, state)})`;
    }
    if (node.type === 'binary') {
        if (node.op === '&&' || node.op === '||') {
            return `(${compileBooleanCSE(node.left, state)} ${node.op} ${compileBooleanCSE(node.right, state)})`;
        }
        const left = compileCSEExpressionNode(node.left, state, true);
        const right = compileCSEExpressionNode(node.right, state, true);
        if (node.op === '==') return `(distance(${left}, ${right}) < 1.0e-6)`;
        if (node.op === '!=') return `(distance(${left}, ${right}) >= 1.0e-6)`;
        if (node.op === '<' || node.op === '<=' || node.op === '>' || node.op === '>=') {
            return `(dynamicReal(${left}) ${node.op} dynamicReal(${right}))`;
        }
    }
    if (node.type === 'call' && node.name === 'isPrime') {
        throw new Error('isPrime() is evaluated by the exact CPU backend');
    }
    return `dynamicTruthy(${compileCSEExpressionNode(node, state, true)})`;
}

function compileCSEExpressionNode(node, state, allowMaterialize) {
    assertExpressionNode(node);
    const hash = state.analysis.meta.get(node).hash;
    if (shouldMaterializeInState(node, state, allowMaterialize)) {
        const existing = state.names.get(hash);
        if (existing) return existing;
        const expression = compileCSEExpressionNode(node, state, false);
        const name = `${state.prefix}Tmp_${state.index++}`;
        state.names.set(hash, name);
        state.statements.push('    vec2 ', name, ' = ', expression, ';\n');
        return name;
    }

    switch (node.type) {
        case 'literal': return vec2(node.value);
        case 'variable': return variableExpression(node, state.context);
        case 'group': return `(${compileCSEExpressionNode(node.expression, state, true)})`;
        case 'unary':
            if (node.op === '+') return compileCSEExpressionNode(node.argument, state, true);
            if (node.op === '-') return `(-${compileCSEExpressionNode(node.argument, state, true)})`;
            if (node.op === '!') return `dynamicBool(${compileBooleanCSE(node, state)})`;
            throw new Error(`Unary operator "${node.op}" is not supported by the GPU expression compiler`);
        case 'postfix': return `vec2(dynamicFactorial(dynamicReal(${compileCSEExpressionNode(node.argument, state, true)})), 0.0)`;
        case 'binary': {
            if (isBooleanBinaryOperator(node.op)) return `dynamicBool(${compileBooleanCSE(node, state)})`;
            const left = compileCSEExpressionNode(node.left, state, true);
            const right = compileCSEExpressionNode(node.right, state, true);
            if (node.op === '+') return `(${left} + ${right})`;
            if (node.op === '-') return `(${left} - ${right})`;
            if (node.op === '*') return `complexMul(${left}, ${right})`;
            if (node.op === '/') return `complexDiv(${left}, ${right})`;
            if (node.op === '^') return compilePowExpression(left, right, node.right, state.context);
            throw new Error(`Operator "${node.op}" is not supported by the GPU expression compiler`);
        }
        case 'conditional':
            return `(${compileBooleanCSE(node.test, state)} ? ${compileCSEExpressionNode(node.consequent, state, true)} : ${compileCSEExpressionNode(node.alternate, state, true)})`;
        case 'call':
            return compileCallExpression(
                node,
                (node.args || []).map(argument => compileCSEExpressionNode(argument, state, true)),
                state.context
            );
        default:
            throw new Error(`Expression node "${node.type}" is not supported by the GPU expression compiler`);
    }
}

function compileExpressionWithCSE(ast, context, prefix) {
    const analysis = analyzeExpressionTree(ast, context);
    const state = {
        context,
        analysis,
        names: new Map(),
        statements: [],
        index: 0,
        prefix
    };
    const expression = compileCSEExpressionNode(ast, state, true);
    return {
        statements: state.statements.join(''),
        expression,
        tempCount: state.index
    };
}


function contextSignature(context) {
    const variables = context.variables || {};
    const parameters = context.parameters || {};
    const variableKeys = Object.keys(variables).sort();
    const parameterKeys = Object.keys(parameters).sort();
    const parts = [context.sheet ? '1' : '0', '|', glslFloat(context.selectedFunctionId || 0), '|v'];
    for (let index = 0; index < variableKeys.length; index++) {
        const key = variableKeys[index];
        parts.push('|', key, '=', variables[key]);
    }
    parts.push('|p');
    for (let index = 0; index < parameterKeys.length; index++) {
        const key = parameterKeys[index];
        parts.push('|', key, '=', literalSignature(parameters[key]));
    }
    return parts.join('');
}

function compileSourceExpressionWithCSE(source, context) {
    const key = `${contextSignature(context)}\n${source}`;
    const cached = cseExpressionCache.get(key);
    if (cached) return cached;
    const compiled = compileExpressionWithCSE(parseExpression(source), context, 'dyn');
    return cacheMapResult(cseExpressionCache, MAX_CSE_EXPRESSION_CACHE_ENTRIES, key, compiled);
}

export function createGlslExpressionHelpers({ drawnBranchCuts = false } = {}) {
    const branchCutGuard = drawnBranchCuts
        ? `if (pointTouchesActiveBranchCut(value, branchCutWidth)) return vec2(1.0e20);`
        : `vec2 ray = vec2(cos(u_branchCutAngle), sin(u_branchCutAngle));
  vec2 rotated = vec2(dot(value, ray), -value.x * ray.y + value.y * ray.x);
  if (branchCutWidth > 0.0 && rotated.x > 0.0 && abs(rotated.y) < branchCutWidth) return vec2(1.0e20);`;
    return `
float dynamicReal(vec2 value) { return value.x; }
bool dynamicTruthy(vec2 value) { return dot(value, value) > 1.0e-20; }
vec2 dynamicBool(bool value) { return value ? vec2(1.0, 0.0) : vec2(0.0); }
float dynamicTrunc(float value) { return value < 0.0 ? ceil(value) : floor(value); }
vec2 dynamicComplexPow(vec2 base, vec2 exponent) {
  if (dot(base, base) < 1.0e-20) {
    return exponent.x > 0.0 ? vec2(0.0) : vec2(1.0e20);
  }
  return complexExp(complexMul(exponent, complexLnActive(base)));
}
vec2 dynamicNaturalLnOnSheet(vec2 value, float branchIndex, float branchCutWidth) {
  if (dot(value, value) < 1.0e-20) return vec2(1.0e20);
  ${branchCutGuard}
  float argument = atan(value.y, value.x);
  if (argument > u_branchCutAngle) argument -= TWO_PI;
  if (argument <= u_branchCutAngle - TWO_PI) argument += TWO_PI;
  vec2 logarithm = vec2(log(length(value)), argument + branchIndex * TWO_PI);
  return logarithm;
}
vec2 dynamicLnOnSheet(vec2 value, float branchIndex, float branchCutWidth) {
  return complexDiv(dynamicNaturalLnOnSheet(value, branchIndex, branchCutWidth), complexLn(u_logBase));
}
vec2 dynamicComplexPowOnSheet(
  vec2 base,
  vec2 exponent,
  float branchIndex,
  float branchCutWidth
) {
  if (dot(base, base) < 1.0e-20) {
    return exponent.x > 0.0 ? vec2(0.0) : vec2(1.0e20);
  }
  return complexExp(complexMul(
    exponent,
    dynamicNaturalLnOnSheet(base, branchIndex, branchCutWidth)
  ));
}
float dynamicFactorial(float value) {
  float rounded = floor(value + 0.5);
  if (value < 0.0 || abs(value - rounded) > 1.0e-5 || rounded > 170.0) return 1.0e20;
  float result = 1.0;
  for (int i = 2; i <= 170; i++) {
    if (float(i) > rounded) break;
    result *= float(i);
  }
  return result;
}
float dynamicGcd(float leftValue, float rightValue) {
  float left = abs(floor(leftValue + 0.5));
  float right = abs(floor(rightValue + 0.5));
  for (int i = 0; i < 64; i++) {
    if (right < 0.5) break;
    float remainder = mod(left, right);
    left = right;
    right = remainder;
  }
  return left;
}
vec2 dynamicEvaluateBasic(
  float functionId,
  vec2 value,
  vec2 mA,
  vec2 mB,
  vec2 mC,
  vec2 mD,
  int polyDeg,
  vec2 polyCoeffs[11],
  float zetaCont,
  float zetaRefl,
  float fracPower
) {
  vec2 mapped = vec2(0.0);
  bool ok = evaluateBasicFuncShared(
    functionId, value, mA, mB, mC, mD, polyDeg, polyCoeffs,
    zetaCont, zetaRefl, fracPower, mapped
  );
  return ok ? mapped : vec2(1.0e20);
}
vec2 dynamicEvaluateBasicOnSheet(
  float functionId,
  vec2 value,
  float branchIndex,
  float branchCutWidth,
  vec2 mA,
  vec2 mB,
  vec2 mC,
  vec2 mD,
  int polyDeg,
  vec2 polyCoeffs[11],
  float zetaCont,
  float zetaRefl,
  float fracPower
) {
  float fId = floor(functionId + 0.5);
  if (abs(fId - 6.0) < 0.5) {
    return dynamicLnOnSheet(value, branchIndex, branchCutWidth);
  }
  if (abs(fId - 15.0) < 0.5) {
    float nearestInteger = floor(fracPower + 0.5);
    float sheet = abs(fracPower - nearestInteger) < 1.0e-5 ? 0.0 : branchIndex;
    float cut = abs(fracPower - nearestInteger) < 1.0e-5 ? 0.0 : branchCutWidth;
    return dynamicComplexPowOnSheet(value, vec2(fracPower, 0.0), sheet, cut);
  }
  return dynamicEvaluateBasic(
    fId, value, mA, mB, mC, mD, polyDeg, polyCoeffs,
    zetaCont, zetaRefl, fracPower
  );
}
`;
}

function sourceRecords(appState) {
    const raw = appState?.dynamicPlotting?.source;
    if (!raw || typeof raw !== 'object') throw new Error('GPU dynamic plotting requires a source.');
    const sourceConfig = { ...raw };
    if (Array.isArray(raw.points)) sourceConfig.points = raw.points.slice();
    if (sourceConfig.kind === 'custom_points' && !Array.isArray(sourceConfig.points)) {
        throw new Error('GPU custom-point sources require a points array.');
    }
    const parameters = parameterMap(appState);
    const source = generateDiscreteSource(sourceConfig, { parameters });
    const limit = requireInteger(
        appState.dynamicPlotting.playback?.visibleCount,
        'GPU dynamic visible count'
    );
    const visibleCount = Math.max(0, Math.min(source.records.length, limit));
    return visibleCount === source.records.length ? source.records : source.records.slice(0, visibleCount);
}

function domainValueFunction(records) {
    const out = ['vec2 dynamicDomainValue(int idx) {\n'];
    for (let index = 0; index < records.length; index++) {
        out.push('  if (idx == ', String(index), ') return ', vec2(records[index].domainValue), ';\n');
    }
    out.push('  return vec2(0.0);\n}');
    return out.join('');
}

function bindingValueFunctions(bindingResult, bindings) {
    const out = [];
    for (const binding of bindings) {
        if (binding.kind === 'parameter' || binding.kind === 'parameter_real') continue;
        const values = bindingResult.series[binding.symbol] || [];
        out.push('vec2 dynamicBinding_', binding.symbol, '(int idx) {\n');
        for (let index = 0; index < values.length; index++) {
            out.push('  if (idx == ', String(index), ') return ', vec2(values[index]), ';\n');
        }
        out.push('  return vec2(0.0);\n}\n');
    }
    return out.join('');
}

function emitScopedEvaluation(out, targetType, targetName, compiled) {
    out.push('    ', targetType, ' ', targetName, ';\n');
    if (compiled.statements) {
        out.push('    {\n');
        out.push(compiled.statements.replace(/^    /gm, '      '));
        out.push('      ', targetName, ' = ', compiled.expression, ';\n');
        out.push('    }\n');
    } else {
        out.push('    ', targetName, ' = ', compiled.expression, ';\n');
    }
}

function compileAggregateLoop(point, term, reduction, invalid) {
    const out = [];
    out.push('  vec2 accumulator = ', reduction.initial, ';\n');
    out.push('  for (int idx = 0; idx < ', String(reduction.count), '; idx++) {\n');
    out.push('    vec2 d = dynamicDomainValue(idx);\n');
    emitScopedEvaluation(out, 'vec2', 'z', point);
    emitScopedEvaluation(out, 'vec2', 'termValue', term);
    out.push('    ', invalid, '\n');
    out.push('    ', reduction.combine, '\n');
    out.push('  }\n');
    out.push('  mapped = accumulator;\n');
    out.push('  return isFiniteVec2Compat(mapped);\n');
    return out.join('');
}


export function buildDynamicAggregateGLSL(appState, getFunctionId) {
    if (!dynamicEnabled(appState)) return { enabled: false, source: '', termCount: 0 };

    const cacheKey = dynamicAggregateGLSLSignature(appState);
    const cached = aggregateShaderCache.get(cacheKey);
    if (cached) return cached;

    try {
        const config = appState.dynamicPlotting;
        if (!config.term || typeof config.term !== 'object') {
            throw new Error('GPU dynamic plotting requires a term.');
        }
        const records = sourceRecords(appState);
        const parameters = parameterMap(appState);
        const bindings = config.term?.kind === 'expression'
            ? synchronizeSequenceBindings(
                config.term.expression,
                config.term.bindings
            )
            : [];
        const bindingResult = generateSequenceBindingSeries(bindings, records.length, {
            aggregateParameter: config.aggregateParameter,
            parameters
        });
        const variables = {};
        for (let index = 0; index < bindings.length; index++) {
            const binding = bindings[index];
            variables[binding.symbol] = binding.kind === 'parameter'
                ? 's'
                : binding.kind === 'parameter_real'
                    ? 'vec2(s.x, 0.0)'
                    : `dynamicBinding_${binding.symbol}(idx)`;
        }
        variables.c = 'c';
        const selectedFunctionId = getFunctionId(config.selectedFunction || appState.currentFunction, true);
        if (!selectedFunctionId || selectedFunctionId === 16 || selectedFunctionId === 17) {
            throw new Error('The selected function is not available in the GPU expression backend');
        }

        const context = {
            parameters,
            variables,
            selectedFunctionId,
            sheet: false,
            getFunctionId: name => getFunctionId(name, true)
        };
        const sheetContext = { ...context, sheet: true };
        const pointExpression = String(config.pointExpression ?? 'd');
        const termExpression = config.term?.kind === 'selected-function'
            ? 'selected(z)'
            : String(config.term?.expression ?? '');
        const pointCode = compileSourceExpressionWithCSE(pointExpression, context);
        const termCode = compileSourceExpressionWithCSE(termExpression, context);
        const pointCodeOnSheet = compileSourceExpressionWithCSE(pointExpression, sheetContext);
        const termCodeOnSheet = compileSourceExpressionWithCSE(termExpression, sheetContext);
        const reductionKind = config.reduction?.kind;
        const reduction = {
            count: records.length,
            initial: reductionKind === 'product' ? ONE_VEC : ZERO_VEC,
            combine: reductionKind === 'product'
                ? 'accumulator = complexMul(accumulator, termValue);'
                : 'accumulator = accumulator + termValue;'
        };
        const invalid = config.reduction?.invalidPolicy === 'skip'
            ? 'if (!isFiniteVec2Compat(z) || !isFiniteVec2Compat(termValue)) continue;'
            : 'if (!isFiniteVec2Compat(z) || !isFiniteVec2Compat(termValue)) return false;';

        const source = [
            domainValueFunction(records), '\n',
            bindingValueFunctions(bindingResult, bindings),
            'bool evaluateDynamicAggregate(\n',
            '  vec2 s,\n',
            '  vec2 c,\n',
            '  vec2 mA,\n',
            '  vec2 mB,\n',
            '  vec2 mC,\n',
            '  vec2 mD,\n',
            '  int polyDeg,\n',
            '  vec2 polyCoeffs[11],\n',
            '  float zetaCont,\n',
            '  float zetaRefl,\n',
            '  float fracPower,\n',
            '  out vec2 mapped\n',
            ') {\n',
            compileAggregateLoop(pointCode, termCode, reduction, invalid),
            '}\n',
            'bool evaluateDynamicAggregateOnSheet(\n',
            '  vec2 s,\n',
            '  vec2 c,\n',
            '  float branchIndex,\n',
            '  float branchCutWidth,\n',
            '  vec2 mA,\n',
            '  vec2 mB,\n',
            '  vec2 mC,\n',
            '  vec2 mD,\n',
            '  int polyDeg,\n',
            '  vec2 polyCoeffs[11],\n',
            '  float zetaCont,\n',
            '  float zetaRefl,\n',
            '  float fracPower,\n',
            '  out vec2 mapped\n',
            ') {\n',
            compileAggregateLoop(pointCodeOnSheet, termCodeOnSheet, reduction, invalid),
            '}\n'
        ].join('');

        return cacheShaderResult(cacheKey, {
            enabled: true,
            source,
            termCount: records.length,
            truncated: false,
            error: null
        });
    } catch (error) {
        throw new Error(`Dynamic aggregate shader compilation failed: ${error?.message || String(error)}`);
    }
}

export function dynamicAggregateGLSLSignature(appState) {
    if (!dynamicEnabled(appState)) return 'off';
    return JSON.stringify({
        currentFunction: appState.currentFunction,
        source: appState.dynamicPlotting.source,
        pointExpression: appState.dynamicPlotting.pointExpression,
        term: appState.dynamicPlotting.term,
        reduction: appState.dynamicPlotting.reduction,
        parameters: appState.dynamicPlotting.parameters,
        visibleCount: appState.dynamicPlotting.playback?.visibleCount
    });
}

export function isDynamicAggregateGLSLActive(appState) {
    return dynamicEnabled(appState);
}

export function compileCustomExpressionToGLSL(source, getFunctionId, options = null) {
    if (!source || source === 'z') {
        return 'z';
    }
    const cached = expressionCache.get(source);
    if (cached) return cached;
    const ast = parseExpression(source);
    const context = {
        parameters: {},
        variables: { z: 'z', i: I_VEC },
        sheet: Boolean(options?.sheet),
        getFunctionId: name => getFunctionId(name, true)
    };
    return cacheMapResult(
        expressionCache,
        MAX_EXPRESSION_CACHE_ENTRIES,
        source,
        compileNode(ast, context)
    );
}
