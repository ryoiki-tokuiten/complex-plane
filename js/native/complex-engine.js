import { collectExpressionDependencies, parseExpression } from '../math/expression/parser.js';
import {
    requireFiniteComplex,
    requireFiniteNumber,
    requireInteger
} from '../utils/numeric-contracts.js';

const wasmUrl = new URL('../../native/build/complex_engine.wasm', import.meta.url);

async function loadBytes() {
    if (wasmUrl.protocol === 'file:') {
        const nodeFileSystemModule = 'node:fs/promises';
        const { readFile } = await import(/* @vite-ignore */ nodeFileSystemModule);
        return readFile(wasmUrl);
    }
    const response = await fetch(wasmUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Native complex engine failed to load: HTTP ${response.status}`);
    return response.arrayBuffer();
}

let wasmMemory = null;
const wasi = {
    fd_close() { return 0; },
    fd_seek(_fd, _offsetLow, _offsetHigh, _whence, newOffset) {
        if (wasmMemory && newOffset) new DataView(wasmMemory.buffer).setBigUint64(newOffset, 0n, true);
        return 0;
    },
    fd_write(_fd, iovecs, iovecCount, written) {
        if (!wasmMemory) return 8;
        const view = new DataView(wasmMemory.buffer);
        let byteCount = 0;
        for (let index = 0; index < iovecCount; index += 1) {
            byteCount += view.getUint32(iovecs + index * 8 + 4, true);
        }
        view.setUint32(written, byteCount, true);
        return 0;
    }
};
const { instance } = await WebAssembly.instantiate(await loadBytes(), {
    env: { emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: wasi
});
const wasm = instance.exports;
wasmMemory = wasm.memory;
wasm._initialize();

if (wasm.ce_abi_version() !== 3) {
    throw new Error(`Unsupported native complex engine ABI ${wasm.ce_abi_version()}.`);
}

export const NATIVE_FUNCTION_IDS = Object.freeze({
    c: 0,
    cos: 1,
    sin: 2,
    tan: 3,
    sec: 4,
    exp: 5,
    ln: 6,
    sinh: 7,
    tanh: 8,
    asin: 9,
    atan: 10,
    gamma: 11,
    loggamma: 12,
    bessel: 13,
    power: 14,
    mobius: 15,
    zeta: 16,
    polynomial: 17,
    algebraic_chaining: 18,
    identity: 19
});

const MAP_CONFIG_SIZE = 328;
const FUNCTION_CONFIG_OFFSET = 16;
const FUNCTION_POLYNOMIAL_PTR = FUNCTION_CONFIG_OFFSET + 112;
const FUNCTION_POLYNOMIAL_COUNT = FUNCTION_CONFIG_OFFSET + 116;
const FUNCTION_FRACTIONAL_POWER = FUNCTION_CONFIG_OFFSET + 120;
const FUNCTION_BRANCH_ANGLE = FUNCTION_CONFIG_OFFSET + 128;
const FUNCTION_BRANCH_RAY = FUNCTION_CONFIG_OFFSET + 136;
const FUNCTION_ZETA_CONTINUATION = FUNCTION_CONFIG_OFFSET + 140;
const FUNCTION_TERMS_PTR = FUNCTION_CONFIG_OFFSET + 144;
const FUNCTION_TERMS_COUNT = FUNCTION_CONFIG_OFFSET + 148;
const FUNCTION_FACTORS_PTR = FUNCTION_CONFIG_OFFSET + 152;
const FUNCTION_FACTORS_COUNT = FUNCTION_CONFIG_OFFSET + 156;
const FUNCTION_EXPRESSION_PTR = FUNCTION_CONFIG_OFFSET + 160;
const FUNCTION_EXPRESSION_COUNT = FUNCTION_CONFIG_OFFSET + 164;
const MAP_TAYLOR_PTR = 184;
const MAP_TAYLOR_COUNT = 188;
const MAP_TAYLOR_CENTER = 192;
const MAP_TAYLOR_RADIUS_SQ = 208;
const MAP_USE_TAYLOR = 216;
const MAP_DYNAMIC_POINT_PTR = 224;
const MAP_DYNAMIC_POINT_COUNT = 228;
const MAP_DYNAMIC_TERM_PTR = 232;
const MAP_DYNAMIC_TERM_COUNT = 236;
const MAP_DYNAMIC_VARIABLES_PTR = 240;
const MAP_DYNAMIC_FLAGS_PTR = 244;
const MAP_DYNAMIC_VARIABLE_COUNT = 248;
const MAP_DYNAMIC_SOURCE_COUNT = 252;
const MAP_DYNAMIC_REDUCTION = 256;
const MAP_DYNAMIC_INVALID_POLICY = 260;
const MAP_CHAIN_SEED = 312;

const EXPRESSION_OPS = Object.freeze({
    constant: 0, z: 1, c: 2, add: 3, subtract: 4, multiply: 5, divide: 6,
    power: 7, negate: 8, call: 9, conjugate: 10, absolute: 11, argument: 12,
    real: 13, imaginary: 14
});

const GENERIC_EXPRESSION_OPS = Object.freeze({
    ...EXPRESSION_OPS,
    variable: 15, not: 16, factorial: 17,
    equal: 18, notEqual: 19, less: 20, lessEqual: 21, greater: 22, greaterEqual: 23,
    truth: 24, jumpFalse: 25, jumpTrue: 26, jump: 27,
    floor: 28, ceil: 29, round: 30, trunc: 31, sign: 32,
    min: 33, max: 34, mod: 35, gcd: 36, isPrime: 37,
    complex: 38, bessel: 39, selected: 40, sqrt: 41
});

const NATIVE_EXPRESSION_CONSTANTS = new Set(['i', 'pi', 'e', 'true', 'false']);

export const EXPRESSION_ERROR_MESSAGES = Object.freeze({
    1: 'Invalid native expression program',
    2: 'Division by zero',
    3: 'value must be real',
    4: 'value must be an integer',
    5: 'value must be a safe integer',
    6: 'factorial argument must be non-negative',
    7: 'factorial argument must not exceed 170',
    8: 'mod divisor must not be zero',
    9: 'Expression result is undefined or outside the supported numeric range'
});

function normalizeExpressionNode(node) {
    if (typeof node === 'number') return { type: 'literal', value: { re: node, im: 0 } };
    if (typeof node === 'string') return { type: 'variable', name: node };
    if (!node || typeof node !== 'object') throw new Error('Invalid native expression node.');
    if (node.type === 'number') return { type: 'literal', value: { re: Number(node.value), im: 0 } };
    if (node.op && node.left !== undefined && node.right !== undefined && !node.type) {
        return {
            type: 'binary', op: node.op,
            left: normalizeExpressionNode(node.left),
            right: normalizeExpressionNode(node.right)
        };
    }
    return node;
}

function nativeLiteral(value, label) {
    if (typeof value === 'number') return { re: requireFiniteNumber(value, label), im: 0 };
    return requireFiniteComplex(value, label);
}

function parseNativeExpression(source) {
    if (source === 'z') return [];
    if (source === null || source === undefined || source === '') {
        throw new Error('Native algebraic evaluation requires an explicit z expression.');
    }
    if (typeof source !== 'string') return compileNativeExpression(normalizeExpressionNode(source));
    return compileNativeExpression(parseExpression(source));
}

function compileNativeExpression(root) {
    const instructions = [];
    const emit = (opcode, argument = 0, re = 0, im = 0) => instructions.push({ opcode, argument, re, im });
    const visit = rawNode => {
        const node = normalizeExpressionNode(rawNode);
        switch (node.type) {
            case 'literal':
                {
                    const value = nativeLiteral(node.value, 'Native expression literal');
                    emit(EXPRESSION_OPS.constant, 0, value.re, value.im);
                }
                return;
            case 'variable':
                if (node.name === 'z') emit(EXPRESSION_OPS.z);
                else if (node.name === 'c') emit(EXPRESSION_OPS.c);
                else if (node.name === 'i') emit(EXPRESSION_OPS.constant, 0, 0, 1);
                else if (node.name === 'pi') emit(EXPRESSION_OPS.constant, 0, Math.PI, 0);
                else if (node.name === 'e') emit(EXPRESSION_OPS.constant, 0, Math.E, 0);
                else throw new Error(`Unsupported native expression variable: ${node.name}`);
                return;
            case 'group':
                visit(node.expression);
                return;
            case 'unary':
                visit(node.argument);
                if (node.op === '-') emit(EXPRESSION_OPS.negate);
                else if (node.op !== '+') throw new Error(`Unsupported native unary operator: ${node.op}`);
                return;
            case 'binary': {
                visit(node.left); visit(node.right);
                const opcode = ({
                    '+': EXPRESSION_OPS.add, '-': EXPRESSION_OPS.subtract,
                    '*': EXPRESSION_OPS.multiply, '/': EXPRESSION_OPS.divide,
                    '^': EXPRESSION_OPS.power
                })[node.op];
                if (opcode === undefined) throw new Error(`Unsupported native binary operator: ${node.op}`);
                emit(opcode);
                return;
            }
            case 'call': {
                if (!Array.isArray(node.args) || node.args.length !== 1) {
                    throw new Error(`Native function ${node.name} requires one argument here.`);
                }
                visit(node.args[0]);
                const special = ({ conj: EXPRESSION_OPS.conjugate, abs: EXPRESSION_OPS.absolute,
                    arg: EXPRESSION_OPS.argument, re: EXPRESSION_OPS.real, im: EXPRESSION_OPS.imaginary,
                    sqrt: GENERIC_EXPRESSION_OPS.sqrt })[node.name];
                if (special !== undefined) emit(special);
                else {
                    const functionId = NATIVE_FUNCTION_IDS[node.name === 'log' ? 'ln' : node.name];
                    if (functionId === undefined || functionId === NATIVE_FUNCTION_IDS.algebraic_chaining) {
                        throw new Error(`Unsupported native expression function: ${node.name}`);
                    }
                    emit(EXPRESSION_OPS.call, functionId);
                }
                return;
            }
            default: throw new Error(`Unsupported native expression node: ${node.type}`);
        }
    };
    visit(root);
    return instructions;
}

function expressionReturnsBoolean(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.type === 'literal') return typeof node.value === 'boolean';
    if (node.type === 'group') return expressionReturnsBoolean(node.expression);
    if (node.type === 'unary') return node.op === '!';
    if (node.type === 'binary') return ['&&', '||', '==', '!=', '<', '<=', '>', '>='].includes(node.op);
    if (node.type === 'call') return node.name === 'isPrime';
    if (node.type === 'conditional') {
        return expressionReturnsBoolean(node.consequent) && expressionReturnsBoolean(node.alternate);
    }
    return false;
}

export function compileNativeExpressionProgram(root, variableNames) {
    if (!Array.isArray(variableNames)) throw new Error('Native expression variable names must be an array.');
    variableNames.forEach((name, index) => {
        if (typeof name !== 'string' || !name) throw new Error(`Native expression variable ${index} is invalid.`);
    });
    const variables = variableNames.filter(name => !NATIVE_EXPRESSION_CONSTANTS.has(name));
    if (new Set(variables).size !== variables.length) {
        throw new Error('Native expression variable names must be unique.');
    }
    const slots = new Map(variables.map((name, index) => [name, index]));
    const instructions = [];
    const emit = (opcode, argument = 0, re = 0, im = 0) => {
        instructions.push({ opcode, argument, re, im });
        return instructions.length - 1;
    };
    const patchJump = (index, target) => { instructions[index].argument = target; };
    const visit = rawNode => {
        const node = normalizeExpressionNode(rawNode);
        switch (node.type) {
            case 'literal': {
                if (typeof node.value === 'boolean') emit(GENERIC_EXPRESSION_OPS.constant, 0, node.value ? 1 : 0, 0);
                else {
                    const value = nativeLiteral(node.value, 'Native generic-expression literal');
                    emit(GENERIC_EXPRESSION_OPS.constant, 0, value.re, value.im);
                }
                return;
            }
            case 'variable': {
                if (node.name === 'i') emit(GENERIC_EXPRESSION_OPS.constant, 0, 0, 1);
                else if (node.name === 'pi') emit(GENERIC_EXPRESSION_OPS.constant, 0, Math.PI, 0);
                else if (node.name === 'e') emit(GENERIC_EXPRESSION_OPS.constant, 0, Math.E, 0);
                else if (node.name === 'true') emit(GENERIC_EXPRESSION_OPS.constant, 0, 1, 0);
                else if (node.name === 'false') emit(GENERIC_EXPRESSION_OPS.constant, 0, 0, 0);
                else {
                    const slot = slots.get(node.name);
                    if (slot === undefined) throw new Error(`Unknown native expression variable: ${node.name}`);
                    emit(GENERIC_EXPRESSION_OPS.variable, slot);
                }
                return;
            }
            case 'group': visit(node.expression); return;
            case 'unary':
                visit(node.argument);
                if (node.op === '-') emit(GENERIC_EXPRESSION_OPS.negate);
                else if (node.op === '!') emit(GENERIC_EXPRESSION_OPS.not);
                else if (node.op !== '+') throw new Error(`Unsupported native unary operator: ${node.op}`);
                return;
            case 'postfix':
                visit(node.argument);
                emit(GENERIC_EXPRESSION_OPS.factorial);
                return;
            case 'binary': {
                if (node.op === '&&' || node.op === '||') {
                    visit(node.left);
                    const branch = emit(node.op === '&&'
                        ? GENERIC_EXPRESSION_OPS.jumpFalse
                        : GENERIC_EXPRESSION_OPS.jumpTrue);
                    visit(node.right);
                    emit(GENERIC_EXPRESSION_OPS.truth);
                    const done = emit(GENERIC_EXPRESSION_OPS.jump);
                    patchJump(branch, instructions.length);
                    emit(GENERIC_EXPRESSION_OPS.constant, 0, node.op === '&&' ? 0 : 1, 0);
                    patchJump(done, instructions.length);
                    return;
                }
                visit(node.left); visit(node.right);
                const opcode = ({
                    '+': GENERIC_EXPRESSION_OPS.add, '-': GENERIC_EXPRESSION_OPS.subtract,
                    '*': GENERIC_EXPRESSION_OPS.multiply, '/': GENERIC_EXPRESSION_OPS.divide,
                    '^': GENERIC_EXPRESSION_OPS.power, '==': GENERIC_EXPRESSION_OPS.equal,
                    '!=': GENERIC_EXPRESSION_OPS.notEqual, '<': GENERIC_EXPRESSION_OPS.less,
                    '<=': GENERIC_EXPRESSION_OPS.lessEqual, '>': GENERIC_EXPRESSION_OPS.greater,
                    '>=': GENERIC_EXPRESSION_OPS.greaterEqual
                })[node.op];
                if (opcode === undefined) throw new Error(`Unsupported native binary operator: ${node.op}`);
                emit(opcode);
                return;
            }
            case 'conditional': {
                visit(node.test);
                const alternate = emit(GENERIC_EXPRESSION_OPS.jumpFalse);
                visit(node.consequent);
                const done = emit(GENERIC_EXPRESSION_OPS.jump);
                patchJump(alternate, instructions.length);
                visit(node.alternate);
                patchJump(done, instructions.length);
                return;
            }
            case 'call': {
                if (!Array.isArray(node.args)) throw new Error(`Native function ${node.name} requires an argument array.`);
                const name = node.name === 'log' ? 'ln' : node.name;
                if (['selected', 'selectedFunction', 'f'].includes(name)) {
                    if (node.args.length !== 1) throw new Error(`${node.name} requires one argument.`);
                    visit(node.args[0]); emit(GENERIC_EXPRESSION_OPS.selected); return;
                }
                if (name === 'pow') {
                    if (node.args.length !== 2) throw new Error('pow requires two arguments.');
                    visit(node.args[0]); visit(node.args[1]); emit(GENERIC_EXPRESSION_OPS.power); return;
                }
                if (name === 'sqrt') {
                    if (node.args.length !== 1) throw new Error('sqrt requires one argument.');
                    visit(node.args[0]); emit(GENERIC_EXPRESSION_OPS.sqrt); return;
                }
                if (name === 'bessel' && node.args.length === 2) {
                    visit(node.args[0]); visit(node.args[1]); emit(GENERIC_EXPRESSION_OPS.bessel); return;
                }
                const special = ({
                    conj: GENERIC_EXPRESSION_OPS.conjugate, abs: GENERIC_EXPRESSION_OPS.absolute,
                    arg: GENERIC_EXPRESSION_OPS.argument, re: GENERIC_EXPRESSION_OPS.real,
                    im: GENERIC_EXPRESSION_OPS.imaginary, floor: GENERIC_EXPRESSION_OPS.floor,
                    ceil: GENERIC_EXPRESSION_OPS.ceil, round: GENERIC_EXPRESSION_OPS.round,
                    trunc: GENERIC_EXPRESSION_OPS.trunc, sign: GENERIC_EXPRESSION_OPS.sign,
                    mod: GENERIC_EXPRESSION_OPS.mod, gcd: GENERIC_EXPRESSION_OPS.gcd,
                    factorial: GENERIC_EXPRESSION_OPS.factorial, isPrime: GENERIC_EXPRESSION_OPS.isPrime,
                    complex: GENERIC_EXPRESSION_OPS.complex, min: GENERIC_EXPRESSION_OPS.min,
                    max: GENERIC_EXPRESSION_OPS.max
                })[name];
                if (special !== undefined) {
                    for (const argument of node.args) visit(argument);
                    emit(special, ['complex', 'min', 'max'].includes(name) ? node.args.length : 0);
                    return;
                }
                if (node.args.length !== 1) throw new Error(`Native function ${node.name} requires one argument.`);
                visit(node.args[0]);
                const functionId = NATIVE_FUNCTION_IDS[name];
                if (functionId === undefined || functionId === NATIVE_FUNCTION_IDS.algebraic_chaining) {
                    throw new Error(`Unsupported native expression function: ${node.name}`);
                }
                emit(GENERIC_EXPRESSION_OPS.call, functionId);
                return;
            }
            default: throw new Error(`Unsupported native expression node: ${node.type}`);
        }
    };
    visit(root);
    return Object.freeze({ instructions, variableNames: variables, resultBoolean: expressionReturnsBoolean(root) });
}

export function compileNativeDynamicAggregate(aggregate) {
    if (!aggregate || !Array.isArray(aggregate.sourceRecords)) {
        throw new Error('Native dynamic aggregate requires source records.');
    }
    if (typeof aggregate.pointExpression !== 'string' || !aggregate.pointExpression.trim()) {
        throw new Error('Native dynamic aggregate requires a point expression.');
    }
    if (!aggregate.term || (aggregate.term.kind !== 'expression' && aggregate.term.kind !== 'selected-function')) {
        throw new Error('Native dynamic aggregate requires an explicit term kind.');
    }
    if (aggregate.term.kind === 'expression' &&
        (typeof aggregate.term.expression !== 'string' || !aggregate.term.expression.trim())) {
        throw new Error('Native dynamic aggregate requires a term expression.');
    }
    if (!Array.isArray(aggregate.bindings) || !aggregate.bindingSeries ||
        typeof aggregate.bindingSeries !== 'object') {
        throw new Error('Native dynamic aggregate requires explicit bindings and series.');
    }
    if (aggregate.reductionKind !== 'none' && aggregate.reductionKind !== 'sum' && aggregate.reductionKind !== 'product') {
        throw new Error(`Unsupported native aggregate reduction: ${aggregate.reductionKind}.`);
    }
    if (aggregate.invalidPolicy !== 'stop' && aggregate.invalidPolicy !== 'skip') {
        throw new Error(`Unsupported native aggregate invalid policy: ${aggregate.invalidPolicy}.`);
    }
    const pointSource = aggregate.pointExpression;
    const termSource = aggregate.term?.kind === 'selected-function'
        ? 'selected(z)'
        : aggregate.term.expression;
    const pointAst = parseExpression(pointSource);
    const termAst = parseExpression(termSource);
    const names = new Set([
        ...collectExpressionDependencies(pointAst).variables,
        ...collectExpressionDependencies(termAst).variables
    ]);
    const variableNames = Array.from(names)
        .filter(name => !NATIVE_EXPRESSION_CONSTANTS.has(name));
    const pointProgram = compileNativeExpressionProgram(pointAst, variableNames);
    const termProgram = compileNativeExpressionProgram(termAst, variableNames);
    const bindings = new Map(aggregate.bindings.map((binding, index) => {
        if (!binding || typeof binding.symbol !== 'string' || !binding.symbol) {
            throw new Error(`Native aggregate binding ${index} requires a symbol.`);
        }
        return [binding.symbol, binding];
    }));
    const bindingSeries = aggregate.bindingSeries;
    const variableFlags = variableNames.map(name => {
        if (name === 's' || name === 'c') return 1;
        if (name === 'z') return 3;
        const kind = bindings.get(name)?.kind;
        if (kind === 'parameter') return 1;
        if (kind === 'parameter_real') return 2;
        return 0;
    });
    const variables = aggregate.sourceRecords.map((record, index) => variableNames.map(name => {
        if (name === 'd') return record.domainValue;
        if (name === 'j') {
            if (!Number.isFinite(record.ordinal)) throw new Error(`Native aggregate record ${index} has invalid ordinal.`);
            return { re: Number(record.ordinal), im: 0 };
        }
        if (name === 's' || name === 'c' || name === 'z') return { re: 0, im: 0 };
        if (!Array.isArray(bindingSeries[name]) || bindingSeries[name][index] === undefined) {
            throw new Error(`Native aggregate is missing binding ${name} at source index ${index}.`);
        }
        return bindingSeries[name][index];
    }));
    return {
        pointProgram,
        termProgram,
        variableNames,
        variableFlags,
        variables,
        reduction: aggregate.reductionKind === 'none' ? 0 : aggregate.reductionKind === 'sum' ? 1 : 2,
        invalidPolicy: aggregate.invalidPolicy === 'skip' ? 1 : 0
    };
}

function functionIdFor(name) {
    const id = NATIVE_FUNCTION_IDS[name === 'log' ? 'ln' : name];
    if (id === undefined || id === NATIVE_FUNCTION_IDS.algebraic_chaining) {
        throw new Error(`Unsupported native algebraic function: ${name}`);
    }
    return id;
}

function writeAlgebraicConfig(view, pointer, options, allocations) {
    if (!Array.isArray(options.algebraicChainingTerms)) {
        throw new Error('Native algebraic evaluation requires an explicit terms array.');
    }
    const terms = options.algebraicChainingTerms;
    const packedTerms = [];
    const packedFactors = [];
    for (const [termIndex, term] of terms.entries()) {
        if (!Array.isArray(term?.factors)) throw new Error(`Native algebraic term ${termIndex} requires factors.`);
        const factorOffset = packedFactors.length;
        for (const [factorIndex, factor] of term.factors.entries()) {
            if (!factor) throw new Error(`Native algebraic factor ${termIndex}:${factorIndex} is missing.`);
            if (factor.func === 'none') break;
            const power = Number(factor.power);
            if (!Number.isFinite(power)) throw new Error(`Native algebraic factor ${termIndex}:${factorIndex} requires finite power.`);
            packedFactors.push({
                functionId: functionIdFor(factor.func),
                chainedId: factor.chainedFunc && factor.chainedFunc !== 'none' ? functionIdFor(factor.chainedFunc) : -1,
                flags: (factor.reciprocal ? 1 : 0) | (factor.log ? 2 : 0) | (factor.exp ? 4 : 0),
                power
            });
        }
        packedTerms.push({ coefficient: term.coeff, factorOffset,
            factorCount: packedFactors.length - factorOffset });
    }

    if (packedTerms.length) {
        const termsPointer = trackAlloc(allocations, packedTerms.length * 24);
        const termsView = memoryView();
        packedTerms.forEach((term, index) => {
            const at = termsPointer + index * 24;
            writeComplex(termsView, at, requireFiniteComplex(term.coefficient, `Native algebraic coefficient ${index}`));
            termsView.setUint32(at + 16, term.factorOffset, true);
            termsView.setUint32(at + 20, term.factorCount, true);
        });
        view.setUint32(pointer + FUNCTION_TERMS_PTR, termsPointer, true);
        view.setUint32(pointer + FUNCTION_TERMS_COUNT, packedTerms.length, true);
    }
    if (packedFactors.length) {
        const factorsPointer = trackAlloc(allocations, packedFactors.length * 24);
        const factorsView = memoryView();
        packedFactors.forEach((factor, index) => {
            const at = factorsPointer + index * 24;
            factorsView.setUint32(at, factor.functionId, true);
            factorsView.setInt32(at + 4, factor.chainedId, true);
            factorsView.setUint32(at + 8, factor.flags, true);
            factorsView.setUint32(at + 12, 0, true);
            factorsView.setFloat64(at + 16, factor.power, true);
        });
        view.setUint32(pointer + FUNCTION_FACTORS_PTR, factorsPointer, true);
        view.setUint32(pointer + FUNCTION_FACTORS_COUNT, packedFactors.length, true);
    }
    const instructions = options.algebraicExpressionAst
        ? compileNativeExpression(options.algebraicExpressionAst)
        : parseNativeExpression(options.algebraicChainingZExpr);
    if (instructions.length) {
        const expressionPointer = trackAlloc(allocations, instructions.length * 24);
        const expressionView = memoryView();
        instructions.forEach((instruction, index) => {
            const at = expressionPointer + index * 24;
            expressionView.setUint32(at, instruction.opcode, true);
            expressionView.setUint32(at + 4, instruction.argument, true);
            expressionView.setFloat64(at + 8, instruction.re, true);
            expressionView.setFloat64(at + 16, instruction.im, true);
        });
        view.setUint32(pointer + FUNCTION_EXPRESSION_PTR, expressionPointer, true);
        view.setUint32(pointer + FUNCTION_EXPRESSION_COUNT, instructions.length, true);
    }
}

function complexParts(value, defaultRe, defaultIm) {
    let re = value?.re;
    let im = value?.im;
    if (typeof re !== 'number') re = Number(re);
    if (typeof im !== 'number') im = Number(im);
    if (Number.isFinite(re) && Number.isFinite(im)) return [re, im];
    if (defaultRe !== undefined && defaultIm !== undefined) return [defaultRe, defaultIm];
    throw new Error('Native complex input requires finite real and imaginary components.');
}

function alloc(size) {
    const pointer = wasm.ce_alloc(size);
    if (!pointer) throw new Error(`Native complex engine could not allocate ${size} bytes.`);
    return pointer;
}

function trackAlloc(allocations, size) {
    const pointer = alloc(size);
    allocations.push(pointer);
    return pointer;
}

function withAllocations(work) {
    const allocations = [];
    const allocate = size => trackAlloc(allocations, size);
    try {
        return work(allocations, allocate);
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

let cachedMemoryBuffer = null;
let cachedMemoryView = null;

function memoryView() {
    const buffer = wasm.memory.buffer;
    if (buffer !== cachedMemoryBuffer) {
        cachedMemoryBuffer = buffer;
        cachedMemoryView = new DataView(buffer);
    }
    return cachedMemoryView;
}

function copyWasmArray(Type, pointer, length) {
    return new Type(wasm.memory.buffer, pointer, length).slice();
}

function requireBoolean(value, label) {
    if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
    return value;
}

function requireIncreasingRange(range, label) {
    if (!Array.isArray(range) || range.length !== 2) throw new Error(`${label} requires two endpoints.`);
    const minimum = requireFiniteNumber(range[0], `${label} minimum`);
    const maximum = requireFiniteNumber(range[1], `${label} maximum`);
    if (minimum >= maximum) throw new Error(`${label} must increase.`);
    return [minimum, maximum];
}

function requirePlanarRenderOptions(options) {
    const scaleX = requireFiniteNumber(options.scaleX, 'Native planar x scale');
    const scaleY = requireFiniteNumber(options.scaleY, 'Native planar y scale');
    const renderLimit = requireFiniteNumber(options.renderLimit, 'Native planar render limit');
    const jumpThresholdSq = requireFiniteNumber(options.jumpThresholdSq, 'Native planar jump threshold');
    const toleranceSq = requireFiniteNumber(options.toleranceSq, 'Native planar simplification tolerance');
    if (scaleX === 0 || scaleY === 0 || renderLimit <= 0 || jumpThresholdSq < 0 || toleranceSq < 0) {
        throw new Error('Native planar scale, render limit, and squared tolerances are invalid.');
    }
    requireBoolean(options.hasBranchCuts, 'Native planar hasBranchCuts');
    if (options.branchCutType !== 'ray' && options.branchCutType !== 'draw') {
        throw new Error(`Unsupported native planar branch-cut type: ${options.branchCutType}.`);
    }
    requireFiniteNumber(options.branchCutAngle, 'Native planar branch-cut angle');
}

const textEncoder = new TextEncoder();

function writeCString(value, allocations) {
    const bytes = textEncoder.encode(String(value));
    const pointer = alloc(bytes.length + 1);
    allocations.push(pointer);
    const target = new Uint8Array(wasm.memory.buffer, pointer, bytes.length + 1);
    target.set(bytes);
    target[bytes.length] = 0;
    return pointer;
}

function writeComplex(view, offset, value, defaultRe, defaultIm) {
    const [re, im] = complexParts(value, defaultRe, defaultIm);
    view.setFloat64(offset, re, true);
    view.setFloat64(offset + 8, im, true);
}

function writeInstructionBuffer(program, allocations) {
    if (program === null || program === undefined) return 0;
    if (!Array.isArray(program.instructions)) {
        throw new Error('Native expression programs require an instruction array.');
    }
    const instructions = program.instructions;
    if (!instructions.length) return 0;
    const pointer = alloc(instructions.length * 24);
    allocations.push(pointer);
    const view = memoryView();
    instructions.forEach((instruction, index) => {
        const offset = pointer + index * 24;
        view.setUint32(offset, requireInteger(instruction.opcode, `Native instruction ${index} opcode`), true);
        view.setUint32(offset + 4, requireInteger(instruction.argument, `Native instruction ${index} argument`), true);
        view.setFloat64(offset + 8, requireFiniteNumber(instruction.re, `Native instruction ${index} real operand`), true);
        view.setFloat64(offset + 16, requireFiniteNumber(instruction.im, `Native instruction ${index} imaginary operand`), true);
    });
    return pointer;
}

function writeDynamicConfig(view, pointer, dynamic, allocations) {
    if (!dynamic) return;
    if (!dynamic?.pointProgram?.instructions?.length || !dynamic?.termProgram?.instructions?.length ||
        !dynamic.variables?.length || !dynamic.variableNames?.length) {
        throw new Error('Native dynamic aggregate is incomplete.');
    }
    const pointPointer = writeInstructionBuffer(dynamic.pointProgram, allocations);
    const termPointer = writeInstructionBuffer(dynamic.termProgram, allocations);
    const variableCount = dynamic.variableNames.length;
    const sourceCount = dynamic.variables.length;
    const variablesPointer = trackAlloc(allocations, sourceCount * variableCount * 16);
    const variablesView = memoryView();
    dynamic.variables.forEach((row, source) => row.forEach((value, slot) => writeComplex(
        variablesView, variablesPointer + (source * variableCount + slot) * 16, value, NaN, NaN
    )));
    const flagsPointer = trackAlloc(allocations, variableCount);
    new Uint8Array(wasm.memory.buffer, flagsPointer, variableCount).set(dynamic.variableFlags);
    view.setUint32(pointer + MAP_DYNAMIC_POINT_PTR, pointPointer, true);
    view.setUint32(pointer + MAP_DYNAMIC_POINT_COUNT, dynamic.pointProgram.instructions.length, true);
    view.setUint32(pointer + MAP_DYNAMIC_TERM_PTR, termPointer, true);
    view.setUint32(pointer + MAP_DYNAMIC_TERM_COUNT, dynamic.termProgram.instructions.length, true);
    view.setUint32(pointer + MAP_DYNAMIC_VARIABLES_PTR, variablesPointer, true);
    view.setUint32(pointer + MAP_DYNAMIC_FLAGS_PTR, flagsPointer, true);
    view.setUint32(pointer + MAP_DYNAMIC_VARIABLE_COUNT, variableCount, true);
    view.setUint32(pointer + MAP_DYNAMIC_SOURCE_COUNT, sourceCount, true);
    view.setUint32(pointer + MAP_DYNAMIC_REDUCTION, dynamic.reduction, true);
    view.setUint32(pointer + MAP_DYNAMIC_INVALID_POLICY, dynamic.invalidPolicy, true);
}

function writeMapConfig(pointer, options, allocations) {
    if (!options || typeof options !== 'object') throw new Error('Native map options are required.');
    const view = memoryView();
    new Uint8Array(wasm.memory.buffer, pointer, MAP_CONFIG_SIZE).fill(0);
    const functionKey = options.functionKey;
    const functionId = NATIVE_FUNCTION_IDS[functionKey];
    if (functionId === undefined) throw new Error(`Unsupported native function: ${functionKey}`);
    if (typeof options.chainingEnabled !== 'boolean') {
        throw new Error('Native map options require an explicit chainingEnabled flag.');
    }
    view.setUint32(pointer, functionId, true);
    const requestedChainCount = Number(options.chainCount);
    if (options.chainingEnabled && (!Number.isInteger(requestedChainCount) || requestedChainCount < 1 || requestedChainCount > 1024)) {
        throw new Error('Native map options require a chain count from 1 through 1024.');
    }
    if (options.chainingEnabled && options.chainMode !== 'zero_seed' && options.chainMode !== 'recursion') {
        throw new Error(`Unsupported native chain mode: ${options.chainMode}`);
    }
    const chainCount = options.chainingEnabled ? requestedChainCount : 1;
    view.setUint32(pointer + 4, chainCount, true);
    view.setUint32(pointer + 8, options.chainMode === 'zero_seed' ? 1 : 0, true);
    writeComplex(
        view,
        pointer + MAP_CHAIN_SEED,
        requireFiniteComplex(options.chainSeed ?? { re: 0, im: 0 }, 'Native chain seed')
    );
    const derivativeOrder = Number(options.derivativeOrder);
    if (!Number.isInteger(derivativeOrder) || derivativeOrder < 0 || derivativeOrder > 2) {
        throw new Error('Native map derivative order must be 0, 1, or 2.');
    }
    view.setUint32(pointer + 12, derivativeOrder, true);

    let offset = FUNCTION_CONFIG_OFFSET;
    writeComplex(view, pointer + offset, requireFiniteComplex(options.expBase, 'Native exponential base')); offset += 16;
    writeComplex(view, pointer + offset, requireFiniteComplex(options.logBase, 'Native logarithm base')); offset += 16;
    writeComplex(view, pointer + offset, requireFiniteComplex(options.besselOrder, 'Native Bessel order')); offset += 16;
    writeComplex(view, pointer + offset, requireFiniteComplex(options.mobiusA, 'Native Möbius coefficient a')); offset += 16;
    writeComplex(view, pointer + offset, requireFiniteComplex(options.mobiusB, 'Native Möbius coefficient b')); offset += 16;
    writeComplex(view, pointer + offset, requireFiniteComplex(options.mobiusC, 'Native Möbius coefficient c')); offset += 16;
    writeComplex(view, pointer + offset, requireFiniteComplex(options.mobiusD, 'Native Möbius coefficient d'));

    const requestedDegree = Number(options.polynomialN);
    if (!Number.isInteger(requestedDegree) || requestedDegree < 0 || requestedDegree > 10 ||
        !Array.isArray(options.polynomialCoeffs) || options.polynomialCoeffs.length < requestedDegree + 1) {
        throw new Error('Native map configuration requires complete polynomial coefficients for degree 0 through 10.');
    }
    const coefficients = options.polynomialCoeffs.slice(0, requestedDegree + 1);
    coefficients.forEach((coefficient, index) => requireFiniteComplex(coefficient, `Native polynomial coefficient ${index}`));
    if (coefficients.length) {
        const coefficientPointer = alloc(coefficients.length * 16);
        allocations.push(coefficientPointer);
        const coefficientView = memoryView();
        coefficients.forEach((coefficient, index) => writeComplex(coefficientView, coefficientPointer + index * 16, coefficient));
        view.setUint32(pointer + FUNCTION_POLYNOMIAL_PTR, coefficientPointer, true);
        view.setUint32(pointer + FUNCTION_POLYNOMIAL_COUNT, coefficients.length, true);
    } else {
        view.setUint32(pointer + FUNCTION_POLYNOMIAL_PTR, 0, true);
        view.setUint32(pointer + FUNCTION_POLYNOMIAL_COUNT, 0, true);
    }
    const fractionalPower = Number(options.fractionalPowerN);
    const branchCutAngle = Number(options.branchCutAngle);
    if (!Number.isFinite(fractionalPower) || !Number.isFinite(branchCutAngle)) {
        throw new Error('Native map configuration requires finite power and branch-cut parameters.');
    }
    if (options.branchCutType !== 'ray' && options.branchCutType !== 'draw') {
        throw new Error(`Unsupported native branch-cut type: ${options.branchCutType}.`);
    }
    view.setFloat64(pointer + FUNCTION_FRACTIONAL_POWER, fractionalPower, true);
    view.setFloat64(pointer + FUNCTION_BRANCH_ANGLE, branchCutAngle, true);
    view.setUint32(pointer + FUNCTION_BRANCH_RAY, options.branchCutType === 'ray' ? 1 : 0, true);
    view.setUint32(pointer + FUNCTION_ZETA_CONTINUATION, options.zetaContinuationEnabled ? 1 : 0, true);
    if (functionKey === 'algebraic_chaining') writeAlgebraicConfig(view, pointer, options, allocations);
    const taylor = options.taylor;
    if (taylor) {
        const coefficients = Array.isArray(taylor.coefficients) ? taylor.coefficients : [];
        if (!coefficients.length) throw new Error('Native Taylor map requires coefficients.');
        const coefficientPointer = alloc(coefficients.length * 16);
        allocations.push(coefficientPointer);
        const coefficientView = memoryView();
        coefficients.forEach((coefficient, index) => writeComplex(
            coefficientView,
            coefficientPointer + index * 16,
            requireFiniteComplex(coefficient, `Native Taylor coefficient ${index}`)
        ));
        const configView = memoryView();
        configView.setUint32(pointer + MAP_TAYLOR_PTR, coefficientPointer, true);
        configView.setUint32(pointer + MAP_TAYLOR_COUNT, coefficients.length, true);
        writeComplex(configView, pointer + MAP_TAYLOR_CENTER, requireFiniteComplex(taylor.center, 'Native Taylor center'));
        const radius = Number(taylor.radius);
        if (!(radius >= 0) && radius !== Infinity) throw new Error('Native Taylor radius must be non-negative or infinite.');
        configView.setFloat64(pointer + MAP_TAYLOR_RADIUS_SQ, radius * radius, true);
        configView.setUint32(pointer + MAP_USE_TAYLOR, 1, true);
    }
    writeDynamicConfig(view, pointer, options.dynamicAggregate, allocations);
    wasm.ce_prepare_map_config(pointer);
}

function writePointBuffer(pointer, points) {
    const target = new Float64Array(wasm.memory.buffer, pointer, points.length * 2);
    for (let index = 0, at = 0; index < points.length; index += 1, at += 2) {
        const point = points[index];
        let re = point?.re;
        let im = point?.im;
        if (typeof re !== 'number') re = Number(re);
        if (typeof im !== 'number') im = Number(im);
        if (!Number.isFinite(re) || !Number.isFinite(im)) {
            throw new Error('Native complex input requires finite real and imaginary components.');
        }
        target[at] = re;
        target[at + 1] = im;
    }
}

function copyComplexBuffer(pointer, count) {
    if (!count) return new Float64Array();
    return copyWasmArray(Float64Array, pointer, count * 2);
}

function readComplexObjects(pointer, count) {
    const source = new Float64Array(wasm.memory.buffer, pointer, count * 2);
    const result = new Array(count);
    for (let index = 0, at = 0; index < count; index += 1, at += 2) {
        result[index] = { re: source[at], im: source[at + 1] };
    }
    return result;
}

export function evaluateNativeExpressionProgram(program, environments, mapOptions, settled = false) {
    if (!program || !Array.isArray(program.instructions) || !Array.isArray(program.variableNames)) {
        throw new Error('Native expression evaluation requires a compiled program.');
    }
    if (!Array.isArray(environments)) throw new Error('Native expression environments must be an array.');
    if (!environments.length) return [];
    if (!program.instructions.length) throw new Error('Native expression programs cannot be empty.');
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, mapOptions, allocations);
        const instructionPointer = writeInstructionBuffer(program, allocations);
        const variableCount = program.variableNames.length;
        const variablePointer = variableCount ? alloc(environments.length * variableCount * 16) : 0;
        if (variablePointer) allocations.push(variablePointer);
        if (variableCount) {
            const variableView = memoryView();
            environments.forEach((environment, job) => {
                program.variableNames.forEach((name, index) => {
                    if (!Object.prototype.hasOwnProperty.call(environment, name)) {
                        throw new Error(`Unknown variable "${name}"`);
                    }
                    const raw = environment[name];
                    const value = typeof raw === 'boolean' ? { re: raw ? 1 : 0, im: 0 }
                        : typeof raw === 'number' ? { re: raw, im: 0 }
                            : raw;
                    writeComplex(variableView, variablePointer + (job * variableCount + index) * 16,
                        value, NaN, NaN);
                });
            });
        }
        const outputPointer = trackAlloc(allocations, environments.length * 16);
        const errorPointer = trackAlloc(allocations, environments.length);
        const sheetsPointer = trackAlloc(allocations, environments.length * 4);
        const sheetsView = memoryView();
        environments.forEach((environment, index) => {
            const sheet = environment.__sheet === undefined
                ? 0
                : requireInteger(environment.__sheet, `Native expression sheet ${index}`);
            sheetsView.setInt32(sheetsPointer + index * 4, sheet, true);
        });
        const status = wasm.ce_evaluate_expression(
            configPointer, instructionPointer, program.instructions.length,
            variablePointer, variableCount, sheetsPointer, environments.length, outputPointer, errorPointer
        );
        if (status !== 0) throw new Error(`Native expression job failed with status ${status}.`);
        const resultView = memoryView();
        const errors = new Uint8Array(wasm.memory.buffer, errorPointer, environments.length);
        return environments.map((_environment, index) => {
            const error = errors[index];
            if (error) {
                const failure = new Error(EXPRESSION_ERROR_MESSAGES[error] || `Native expression error ${error}`);
                failure.nativeExpressionError = error;
                if (settled) return { ok: false, error: failure };
                throw failure;
            }
            const re = resultView.getFloat64(outputPointer + index * 16, true);
            const im = resultView.getFloat64(outputPointer + index * 16 + 8, true);
            const value = program.resultBoolean ? re !== 0 : { re, im };
            return settled ? { ok: true, value } : value;
        });
    });
}

const NATIVE_SOURCE_KINDS = Object.freeze({
    naturals: 0,
    integers: 0,
    arithmetic: 0,
    geometric: 2,
    harmonic: 3,
    primes: 4,
    gaussian_integers: 5,
    gaussian_primes: 6,
    expression: 7
});

export function generateNativeDiscreteValues(config, runtime = {}) {
    if (!config || typeof config !== 'object') throw new Error('Native discrete source requires configuration.');
    const requestedCount = requireInteger(config.count, 'Native discrete source count');
    if (requestedCount < 0) throw new Error('Native discrete source count must be non-negative.');
    if (!requestedCount) return { values: [], attempts: 0, invalidCount: 0, attemptErrors: [] };
    let kind = NATIVE_SOURCE_KINDS[config.kind];
    if (kind === undefined) throw new Error(`Unknown native discrete source kind "${config.kind}".`);
    if ((config.kind === 'integers' || config.kind === 'naturals') && config.ordering === 'symmetric') kind = 1;
    let flags = 0;
    if (config.includeZero) flags |= 1;
    if (config.includeNegative) flags |= 2;
    if ((config.kind === 'gaussian_integers' && config.boundType === 'norm') ||
        (config.kind === 'gaussian_primes' && config.boundType !== 'square')) flags |= 4;
    if (config.associatePolicy !== 'representatives') flags |= 8;
    if (config.includeConjugates !== false) flags |= 16;

    if (!runtime.parameters || typeof runtime.parameters !== 'object' || Array.isArray(runtime.parameters)) {
        throw new Error('Native discrete source requires an explicit parameter environment.');
    }
    const parameterEntries = Object.entries(runtime.parameters);
    let generatorProgram = null;
    let predicateProgram = null;
    if (config.kind === 'expression') {
        if (typeof config.generatorExpression !== 'string' || !config.generatorExpression.trim()) {
            throw new Error('Native expression sources require a generator expression.');
        }
        generatorProgram = compileNativeExpressionProgram(
            parseExpression(config.generatorExpression),
            ['j', ...parameterEntries.map(([name]) => name)]
        );
        if (typeof config.filterExpression !== 'string') {
            throw new Error('Native expression-source filters must be strings.');
        }
        const predicateSource = config.filterExpression.trim();
        if (predicateSource) {
            predicateProgram = compileNativeExpressionProgram(
                parseExpression(predicateSource),
                ['d', 'j', ...parameterEntries.map(([name]) => name)]
            );
        }
    }

    return withAllocations((allocations, allocate) => {
        const outputPointer = trackAlloc(allocations, requestedCount * 16);
        const statsPointer = trackAlloc(allocations, 12);
        const generatorPointer = writeInstructionBuffer(generatorProgram, allocations);
        const predicatePointer = writeInstructionBuffer(predicateProgram, allocations);
        let parametersPointer = 0;
        if (parameterEntries.length) {
            parametersPointer = trackAlloc(allocations, parameterEntries.length * 16);
            const parameterView = memoryView();
            parameterEntries.forEach(([, value], index) => writeComplex(
                parameterView, parametersPointer + index * 16, value, NaN, NaN
            ));
        }
        const maxAttempts = config.kind === 'expression'
            ? requireInteger(config.maxAttempts, 'Native discrete-source attempt limit')
            : requestedCount;
        if (maxAttempts < requestedCount) {
            throw new Error('Native discrete-source attempt limit cannot be smaller than its requested count.');
        }
        const start = requireFiniteNumber(config.start, 'Native discrete-source start');
        const step = requireFiniteNumber(config.step, 'Native discrete-source step');
        const ratio = requireFiniteNumber(config.ratio, 'Native discrete-source ratio');
        const minimum = requireFiniteNumber(config.min, 'Native discrete-source minimum');
        const maximum = requireFiniteNumber(config.max, 'Native discrete-source maximum');
        const bound = requireInteger(config.bound, 'Native discrete-source bound');
        if (bound < 1) throw new Error('Native discrete-source bound must be positive.');
        let errorsPointer = 0;
        if (config.kind === 'expression') {
            errorsPointer = trackAlloc(allocations, maxAttempts);
            new Uint8Array(wasm.memory.buffer, errorsPointer, maxAttempts).fill(0);
        }
        const status = wasm.ce_generate_discrete_values(
            kind, requestedCount,
            start, step, ratio, minimum, maximum, bound,
            flags, maxAttempts,
            generatorPointer, generatorProgram?.instructions.length || 0,
            predicatePointer, predicateProgram?.instructions.length || 0,
            parametersPointer, parameterEntries.length,
            outputPointer, requestedCount, errorsPointer, errorsPointer ? maxAttempts : 0, statsPointer
        );
        if (status !== 0) throw new Error(`Native discrete source job failed with status ${status}.`);
        const view = memoryView();
        const count = view.getUint32(statsPointer, true);
        const attempts = view.getUint32(statsPointer + 4, true);
        const invalidCount = view.getUint32(statsPointer + 8, true);
        const values = readComplexObjects(outputPointer, count);
        const attemptErrors = errorsPointer
            ? copyWasmArray(Uint8Array, errorsPointer, attempts)
            : new Uint8Array();
        return { values, attempts, invalidCount, attemptErrors };
    });
}

export function evaluateNativePoints(options, points) {
    if (!Array.isArray(points) || !points.length) return { values: [], valid: new Uint8Array() };
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, options, allocations);
        const inputPointer = trackAlloc(allocations, points.length * 16);
        const outputPointer = trackAlloc(allocations, points.length * 16);
        const validPointer = trackAlloc(allocations, points.length);
        writePointBuffer(inputPointer, points);
        const status = wasm.ce_evaluate_points(configPointer, inputPointer, points.length, outputPointer, validPointer);
        if (status !== 0) throw new Error(`Native point evaluation failed with status ${status}.`);
        const valid = new Uint8Array(points.length);
        valid.set(new Uint8Array(wasm.memory.buffer, validPointer, points.length));
        const values = readComplexObjects(outputPointer, points.length);
        return { values, valid };
    });
}

export function evaluateNativeAlgebraic(options, points, parameters = points) {
    if (!Array.isArray(points) || !Array.isArray(parameters) || parameters.length !== points.length) {
        throw new Error('Native algebraic evaluation requires equally sized point and parameter arrays.');
    }
    if (!points.length) return { values: [], valid: new Uint8Array() };
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, { ...options, functionKey: 'algebraic_chaining' }, allocations);
        const inputPointer = trackAlloc(allocations, points.length * 16);
        const parameterPointer = trackAlloc(allocations, points.length * 16);
        const outputPointer = trackAlloc(allocations, points.length * 16);
        const validPointer = trackAlloc(allocations, points.length);
        writePointBuffer(inputPointer, points);
        writePointBuffer(parameterPointer, parameters);
        const status = wasm.ce_evaluate_algebraic_points(
            configPointer, inputPointer, parameterPointer, points.length, outputPointer, validPointer
        );
        if (status !== 0) throw new Error(`Native algebraic evaluation failed with status ${status}.`);
        const valid = copyWasmArray(Uint8Array, validPointer, points.length);
        const values = readComplexObjects(outputPointer, points.length);
        return { values, valid };
    });
}

export function evaluateNativeSheets(options, points, sheets) {
    if (!Array.isArray(points) || !Array.isArray(sheets) || sheets.length !== points.length) {
        throw new Error('Native sheet evaluation requires equally sized point and sheet arrays.');
    }
    if (!points.length) {
        return { values: [], valid: new Uint8Array() };
    }
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, options, allocations);
        const inputPointer = trackAlloc(allocations, points.length * 16);
        const sheetsPointer = trackAlloc(allocations, points.length * 4);
        const outputPointer = trackAlloc(allocations, points.length * 16);
        const validPointer = trackAlloc(allocations, points.length);
        writePointBuffer(inputPointer, points);
        const sheetView = memoryView();
        sheets.forEach((sheet, index) => sheetView.setInt32(
            sheetsPointer + index * 4,
            requireInteger(sheet, `Native sheet ${index}`),
            true
        ));
        const status = wasm.ce_evaluate_sheets(
            configPointer, inputPointer, sheetsPointer, points.length, outputPointer, validPointer
        );
        if (status !== 0) throw new Error(`Native sheet evaluation failed with status ${status}.`);
        const valid = copyWasmArray(Uint8Array, validPointer, points.length);
        const values = readComplexObjects(outputPointer, points.length);
        return { values, valid };
    });
}

export function evaluateNativeDynamic(mapOptions, aggregate, parameter) {
    const dynamic = aggregate;
    if (!dynamic?.variables?.length) {
        return {
            pointValues: [], termValues: [], errors: new Uint8Array(),
            reductionStatus: new Uint8Array(), partialValues: [],
            finalValue: dynamic?.reduction === 2 ? { re: 1, im: 0 } : { re: 0, im: 0 },
            product: null, valid: true
        };
    }
    const count = dynamic.variables.length;
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, { ...mapOptions, dynamicAggregate: dynamic }, allocations);
        const pointPointer = trackAlloc(allocations, count * 16);
        const termPointer = trackAlloc(allocations, count * 16);
        const errorsPointer = trackAlloc(allocations, count);
        const statusPointer = trackAlloc(allocations, count);
        const partialPointer = trackAlloc(allocations, count * 16);
        const partialProductPointer = trackAlloc(allocations, count * 48);
        const finalPointer = trackAlloc(allocations, 16);
        const productPointer = trackAlloc(allocations, 48);
        const [parameterRe, parameterIm] = complexParts(parameter);
        const status = wasm.ce_evaluate_dynamic(
            configPointer, parameterRe, parameterIm,
            pointPointer, termPointer, errorsPointer, statusPointer,
            partialPointer, partialProductPointer, finalPointer, productPointer
        );
        if (status < 0) throw new Error(`Native dynamic aggregate failed with status ${status}.`);
        const view = memoryView();
        const readValues = pointer => Array.from({ length: count }, (_, index) => ({
            re: view.getFloat64(pointer + index * 16, true),
            im: view.getFloat64(pointer + index * 16 + 8, true)
        }));
        const finalValue = {
            re: view.getFloat64(finalPointer, true),
            im: view.getFloat64(finalPointer + 8, true)
        };
        return {
            pointValues: readValues(pointPointer),
            termValues: readValues(termPointer),
            errors: copyWasmArray(Uint8Array, errorsPointer, count),
            reductionStatus: copyWasmArray(Uint8Array, statusPointer, count),
            partialValues: readValues(partialPointer),
            partialProducts: Array.from({ length: count }, (_, index) => ({
                normalized: {
                    re: view.getFloat64(partialProductPointer + index * 48, true),
                    im: view.getFloat64(partialProductPointer + index * 48 + 8, true)
                },
                logAbs: view.getFloat64(partialProductPointer + index * 48 + 16, true),
                argument: view.getFloat64(partialProductPointer + index * 48 + 24, true),
                zero: view.getFloat64(partialProductPointer + index * 48 + 32, true) !== 0,
                finite: view.getFloat64(partialProductPointer + index * 48 + 40, true) !== 0
            })),
            finalValue,
            product: dynamic.reduction === 2 ? {
                value: finalValue,
                normalized: {
                    re: view.getFloat64(productPointer, true),
                    im: view.getFloat64(productPointer + 8, true)
                },
                logAbs: view.getFloat64(productPointer + 16, true),
                argument: view.getFloat64(productPointer + 24, true),
                zero: view.getFloat64(productPointer + 32, true) !== 0,
                finite: view.getFloat64(productPointer + 40, true) !== 0
            } : null,
            valid: status === 0
        };
    });
}

export function continuationNativeSheet(path, branchCutType, branchCutAngle, branchCutPoints = []) {
    if (!Array.isArray(path) || path.length < 2) return 0;
    if (branchCutType !== 'ray' && branchCutType !== 'draw') {
        throw new Error(`Unsupported native continuation cut: ${branchCutType}.`);
    }
    const angle = requireFiniteNumber(branchCutAngle, 'Native continuation branch angle');
    return withAllocations((allocations, allocate) => {
        const pathPointer = trackAlloc(allocations, path.length * 16);
        writePointBuffer(pathPointer, path);
        const drawn = branchCutType === 'draw';
        let cutPointer = 0;
        if (drawn) {
            if (!Array.isArray(branchCutPoints) || branchCutPoints.length < 2) {
                throw new Error('Drawn native branch cuts require at least two points.');
            }
            cutPointer = trackAlloc(allocations, branchCutPoints.length * 16);
            writePointBuffer(cutPointer, branchCutPoints);
        }
        return wasm.ce_continuation_sheets(
            pathPointer, path.length, drawn ? 1 : 0, angle,
            cutPointer, drawn ? branchCutPoints.length : 0
        );
    });
}

export function computeNativeTaylorCoefficients(map, center, radius, order) {
    requireFiniteComplex(center, 'Native Taylor center');
    const radiusValue = requireFiniteNumber(radius, 'Native Taylor sampling radius');
    const boundedOrder = requireInteger(order, 'Native Taylor order');
    if (radiusValue <= 0 || boundedOrder < 0 || boundedOrder > 128) {
        throw new Error('Native Taylor radius must be positive and order must be between zero and 128.');
    }
    const stepCount = Math.max(192, 48 * (boundedOrder + 1));
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, { ...map, taylor: null }, allocations);
        const outputPointer = trackAlloc(allocations, (boundedOrder + 1) * 16);
        const status = wasm.ce_compute_taylor_coefficients(
            configPointer, center.re, center.im, radiusValue, stepCount, boundedOrder, outputPointer
        );
        if (status !== 0) throw new Error(`Native Taylor coefficient job failed with status ${status}.`);
        return readComplexObjects(outputPointer, boundedOrder + 1);
    });
}

export function nativeMapOptions(runtimeState, overrides = {}) {
    if (!runtimeState || typeof runtimeState !== 'object') throw new Error('Native map runtime state is required.');
    if (!overrides || typeof overrides !== 'object') throw new Error('Native map overrides must be an object.');
    if (Object.prototype.hasOwnProperty.call(overrides, 'derivativeMode')) {
        throw new Error('Native map options require derivativeOrder; derivativeMode is not supported.');
    }
    let stage = null;
    if (overrides.stage !== undefined) {
        stage = requireInteger(overrides.stage, 'Native map stage');
        if (stage < 0) throw new Error('Native map stage must be non-negative.');
    }
    const derivativeOrder = overrides.derivativeOrder === undefined
        ? (runtimeState.mapPresentation === 'derivative' ? 1 : 0)
        : requireInteger(overrides.derivativeOrder, 'Native map derivative order');
    if (derivativeOrder < 0 || derivativeOrder > 2) {
        throw new Error('Native map derivative order must be 0, 1, or 2.');
    }
    const chainingEnabled = overrides.chainingEnabled === undefined
        ? runtimeState.chainingEnabled
        : overrides.chainingEnabled;
    if (typeof chainingEnabled !== 'boolean') {
        throw new Error('Native map chainingEnabled must be boolean.');
    }
    const chainMode = overrides.chainMode ?? runtimeState.chainingMode;
    const chainCount = overrides.chainCount === undefined
        ? (stage === null
            ? (chainingEnabled ? runtimeState.chainCount : 1)
            : (chainingEnabled ? stage + 1 : 1))
        : requireInteger(overrides.chainCount, 'Native map chain count');
    const functionKey = overrides.functionKey ?? runtimeState.currentFunction;
    return {
        expBase: runtimeState.expBase,
        logBase: runtimeState.logBase,
        besselOrder: runtimeState.besselOrder,
        mobiusA: runtimeState.mobiusA,
        mobiusB: runtimeState.mobiusB,
        mobiusC: runtimeState.mobiusC,
        mobiusD: runtimeState.mobiusD,
        polynomialN: runtimeState.polynomialN,
        polynomialCoeffs: runtimeState.polynomialCoeffs,
        fractionalPowerN: runtimeState.fractionalPowerN,
        branchCutType: runtimeState.branchCutType,
        branchCutAngle: runtimeState.branchCutAngle,
        zetaContinuationEnabled: runtimeState.zetaContinuationEnabled,
        algebraicChainingTerms: runtimeState.algebraicChainingTerms,
        algebraicChainingZExpr: runtimeState.algebraicChainingZExpr,
        dynamicAggregate: runtimeState.dynamicAggregate,
        chainSeed: runtimeState.chainSeed ?? { re: 0, im: 0 },
        ...overrides,
        functionKey,
        chainCount,
        chainingEnabled,
        chainMode,
        derivativeOrder
    };
}

function writeBranchCutPoints(points, allocations) {
    if (!Array.isArray(points)) throw new Error('Native branch-cut points must be an array.');
    if (!points.length) return { pointer: 0, count: 0 };
    if (points.length < 2) throw new Error('A drawn native branch cut requires at least two points.');
    points.forEach((point, index) => requireFiniteComplex(point, `Native branch-cut point ${index}`));
    const pointer = alloc(points.length * 16);
    allocations.push(pointer);
    writePointBuffer(pointer, points);
    return { pointer, count: points.length };
}

function readComplexBuffer(pointer, count) {
    return copyComplexBuffer(pointer, count);
}

const NATIVE_INPUT_SHAPES = Object.freeze({
    grid_cartesian: 0,
    grid_polar: 1,
    grid_logpolar: 2,
    grid_logcartesian: 3,
    grid_dots: 4,
    line: 7,
    circle: 8,
    ellipse: 9
});

export function generateNativeInputShape(config, mapOptions) {
    const density = requireInteger(config.gridDensity, 'Native input-shape density');
    const curvePoints = requireInteger(config.curvePoints, 'Native input-shape curve-point count');
    if (density < 1 || curvePoints < 2) {
        throw new Error('Native input-shape density must be positive and curve-point count must be at least two.');
    }
    let shape = NATIVE_INPUT_SHAPES[config.currentInputShape];
    let expressionProgram = null;
    const drawPoints = [];
    if (config.currentInputShape === 'arbitrary') {
        if (config.arbitraryShapeMode === 'draw') {
            shape = 6;
            if (!Array.isArray(config.arbitraryShapePoints)) {
                throw new Error('Drawn arbitrary shapes require a points array.');
            }
            for (const point of config.arbitraryShapePoints) {
                drawPoints.push(point && Number.isFinite(point.re) && Number.isFinite(point.im)
                    ? point : { re: NaN, im: NaN });
            }
        } else {
            shape = 5;
            const source = String(config.arbitraryShapeExpression ?? '').trim();
            if (!source) throw new Error('Parametric arbitrary shapes require an expression.');
            expressionProgram = compileNativeExpressionProgram(parseExpression(source), ['t']);
            const minimum = requireFiniteNumber(config.arbitraryShapeTMin, 'Arbitrary-shape parameter minimum');
            const maximum = requireFiniteNumber(config.arbitraryShapeTMax, 'Arbitrary-shape parameter maximum');
            if (minimum === maximum) throw new Error('Arbitrary-shape parameter range must be nonzero.');
        }
    }
    if (shape === undefined) throw new Error(`Unsupported native input shape: ${config.currentInputShape}.`);

    const linearSamples = Math.max(2, Math.floor(curvePoints / 2));
    const angularLines = Math.max(4, density);
    let lineCapacity = 1;
    let pointCapacity = curvePoints + 1;
    if (shape === 0) {
        lineCapacity = 2 * (density + 1); pointCapacity = lineCapacity * (linearSamples + 1);
    } else if (shape === 1) {
        lineCapacity = angularLines + density; pointCapacity = lineCapacity * (curvePoints + 1);
    } else if (shape === 2) {
        lineCapacity = angularLines + density + 1; pointCapacity = lineCapacity * (curvePoints + 1);
    } else if (shape === 3) {
        lineCapacity = 4 * (density + 1); pointCapacity = lineCapacity * (linearSamples + 1);
    } else if (shape === 4) {
        pointCapacity = (density + 1) * (density + 1);
    } else if (shape === 5) {
        const count = Math.max(32, curvePoints, density * 16) + 1;
        lineCapacity = count; pointCapacity = count * 2;
    } else if (shape === 6) {
        lineCapacity = Math.max(1, drawPoints.length); pointCapacity = Math.max(1, drawPoints.length * 2 + 2);
    } else if (shape === 7) {
        lineCapacity = 2; pointCapacity = 2 * (curvePoints + 1);
    }
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, mapOptions, allocations);
        const expressionPointer = writeInstructionBuffer(expressionProgram, allocations);
        let drawPointer = 0;
        if (drawPoints.length) {
            drawPointer = trackAlloc(allocations, drawPoints.length * 16);
            const drawView = memoryView();
            drawPoints.forEach((point, index) => writeComplex(
                drawView, drawPointer + index * 16, point, NaN, NaN
            ));
        }
        const outputPointer = trackAlloc(allocations, pointCapacity * 16);
        const offsetsPointer = trackAlloc(allocations, (lineCapacity + 1) * 4);
        const rolesPointer = trackAlloc(allocations, lineCapacity * 4);
        const statsPointer = trackAlloc(allocations, 8);
        const status = wasm.ce_generate_input_shape(
            configPointer, shape,
            Number(config.xRange?.[0]), Number(config.xRange?.[1]),
            Number(config.yRange?.[0]), Number(config.yRange?.[1]),
            density, curvePoints,
            Number(config.a0), Number(config.b0), Number(config.circleR),
            Number(config.ellipseA), Number(config.ellipseB),
            config.currentFunction === 'zeta' && !config.zetaContinuationEnabled ? 1 : 0,
            expressionPointer, expressionProgram?.instructions.length || 0,
            Number(config.arbitraryShapeTMin), Number(config.arbitraryShapeTMax),
            drawPointer, drawPoints.length, config.arbitraryShapeClosed ? 1 : 0,
            outputPointer, pointCapacity, offsetsPointer, rolesPointer, lineCapacity, statsPointer
        );
        if (status !== 0) throw new Error(`Native input-shape job failed with status ${status}.`);
        const view = memoryView();
        const pointCount = view.getUint32(statsPointer, true);
        const lineCount = view.getUint32(statsPointer + 4, true);
        const result = new Array(lineCount);
        for (let line = 0; line < lineCount; ++line) {
            const start = view.getUint32(offsetsPointer + line * 4, true);
            const end = view.getUint32(offsetsPointer + (line + 1) * 4, true);
            const points = new Array(end - start);
            for (let index = start; index < end; ++index) {
                points[index - start] = {
                    re: view.getFloat64(outputPointer + index * 16, true),
                    im: view.getFloat64(outputPointer + index * 16 + 8, true)
                };
            }
            result[line] = { role: view.getUint32(rolesPointer + line * 4, true), points };
        }
        if (pointCount > pointCapacity) throw new Error('Native input-shape job exceeded its output capacity.');
        return result;
    });
}

export function generateNativeViewportGridPixels(config) {
    const shape = config.currentInputShape === 'grid_cartesian' ? 0
        : config.currentInputShape === 'grid_dots' ? 4 : -1;
    if (shape < 0) throw new Error(`Unsupported native viewport-grid shape: ${config.currentInputShape}.`);
    const density = requireInteger(config.gridDensity, 'Native viewport-grid density');
    const curvePoints = requireInteger(config.curvePoints, 'Native viewport-grid curve points');
    const viewportWidth = requireInteger(config.preciseViewport?.width, 'Native viewport-grid width');
    const viewportHeight = requireInteger(config.preciseViewport?.height, 'Native viewport-grid height');
    if (density < 1 || curvePoints < 2 || viewportWidth < 1 || viewportHeight < 1) {
        throw new Error('Native viewport-grid dimensions and density must be positive.');
    }
    const samples = Math.max(2, Math.floor(curvePoints / 2));
    const lineCapacity = shape === 0 ? 2 * (density + 1) : 1;
    const pointCapacity = shape === 0
        ? lineCapacity * (samples + 1)
        : (density + 1) * (density + 1);
    return withAllocations((allocations, allocate) => {
        const outputPointer = trackAlloc(allocations, pointCapacity * 8);
        const offsetsPointer = trackAlloc(allocations, (lineCapacity + 1) * 4);
        const rolesPointer = trackAlloc(allocations, lineCapacity * 4);
        const statsPointer = trackAlloc(allocations, 8);
        const status = wasm.ce_generate_viewport_grid_pixels(
            shape, density, curvePoints,
            viewportWidth, viewportHeight,
            outputPointer, pointCapacity, offsetsPointer, rolesPointer, lineCapacity, statsPointer
        );
        if (status !== 0) throw new Error(`Native precise grid job failed with status ${status}.`);
        const view = memoryView();
        const lineCount = view.getUint32(statsPointer + 4, true);
        return Array.from({ length: lineCount }, (_, line) => {
            const start = view.getUint32(offsetsPointer + line * 4, true);
            const end = view.getUint32(offsetsPointer + (line + 1) * 4, true);
            return {
                role: view.getUint32(rolesPointer + line * 4, true),
                canvasPoints: new Float32Array(
                    new Float32Array(wasm.memory.buffer, outputPointer + start * 8, (end - start) * 2)
                )
            };
        });
    });
}

export function generateNativeRadialSteps(mapOptions, domain, stepCount, curvePoints) {
    const steps = requireInteger(stepCount, 'Native radial-step count');
    if (steps < 0) throw new Error('Native radial-step count must be non-negative.');
    if (steps < 2) return [];
    const curvePointCount = requireInteger(curvePoints, 'Native radial curve points');
    if (curvePointCount < 24) throw new Error('Native radial curves require at least 24 points.');
    const domainMin = requireFiniteNumber(domain?.min, 'Native radial domain minimum');
    const domainMax = requireFiniteNumber(domain?.max, 'Native radial domain maximum');
    if (domainMin >= domainMax) throw new Error('Native radial domain must increase.');
    const pointsPerCircle = curvePointCount + 1;
    const pointCapacity = steps * pointsPerCircle;
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, mapOptions, allocations);
        const outputPointer = trackAlloc(allocations, pointCapacity * 16);
        const offsetsPointer = trackAlloc(allocations, (steps + 1) * 4);
        const statsPointer = trackAlloc(allocations, 8);
        const status = wasm.ce_generate_radial_steps(
            configPointer, domainMin, domainMax, steps, pointsPerCircle - 1,
            outputPointer, pointCapacity, offsetsPointer, steps, statsPointer
        );
        if (status !== 0) throw new Error(`Native radial-step job failed with status ${status}.`);
        const view = memoryView();
        const lineCount = view.getUint32(statsPointer + 4, true);
        return Array.from({ length: lineCount }, (_, line) => {
            const start = view.getUint32(offsetsPointer + line * 4, true);
            const end = view.getUint32(offsetsPointer + (line + 1) * 4, true);
            return Array.from({ length: end - start }, (_unused, offset) => ({
                re: view.getFloat64(outputPointer + (start + offset) * 16, true),
                im: view.getFloat64(outputPointer + (start + offset) * 16 + 8, true)
            }));
        });
    });
}

export function buildNativePlanarLine(options) {
    const sampleCount = requireInteger(options.sampleCount, 'Native planar-line sample count');
    if (sampleCount < 1 || sampleCount > 1_000_000) {
        throw new Error('Native planar-line sample count must be from one through 1,000,000.');
    }
    requireFiniteComplex(options.start, 'Native planar-line start');
    requireFiniteComplex(options.end, 'Native planar-line end');
    requirePlanarRenderOptions(options);
    const outputCapacity = (sampleCount + 1) * 2 + 2;
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, options.map, allocations);
        const cut = writeBranchCutPoints(options.branchCutPoints, allocations);
        const outputPointer = trackAlloc(allocations, outputCapacity * 16);
        const count = wasm.ce_build_planar_line(
            configPointer,
            options.start.re, options.start.im, options.end.re, options.end.im, sampleCount,
            options.scaleX, options.scaleY, options.renderLimit,
            options.jumpThresholdSq, options.toleranceSq,
            options.hasBranchCuts ? 1 : 0, options.branchCutType === 'draw' ? 1 : 0,
            options.branchCutAngle, cut.pointer, cut.count, outputPointer, outputCapacity
        );
        if (count < 0) throw new Error(`Native planar line job failed with status ${count}.`);
        return readComplexBuffer(outputPointer, count);
    });
}

export function buildNativePlanarLines(options) {
    if (!Array.isArray(options.lines) || !options.lines.length) return [];
    requirePlanarRenderOptions(options);
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, options.map, allocations);
        const lineCount = options.lines.length;
        const startsPointer = trackAlloc(allocations, lineCount * 16);
        const endsPointer = trackAlloc(allocations, lineCount * 16);
        const countsPointer = trackAlloc(allocations, lineCount * 4);
        const offsetsPointer = trackAlloc(allocations, (lineCount + 1) * 4);
        const lineView = memoryView();
        let outputCapacity = 0;
        options.lines.forEach((line, index) => {
            const sampleCount = requireInteger(line.sampleCount, `Native planar line ${index} sample count`);
            if (sampleCount < 1 || sampleCount > 1_000_000) {
                throw new Error(`Native planar line ${index} sample count is outside one through 1,000,000.`);
            }
            requireFiniteComplex(line.start, `Native planar line ${index} start`);
            requireFiniteComplex(line.end, `Native planar line ${index} end`);
            writeComplex(lineView, startsPointer + index * 16, line.start);
            writeComplex(lineView, endsPointer + index * 16, line.end);
            lineView.setUint32(countsPointer + index * 4, sampleCount, true);
            outputCapacity += (sampleCount + 1) * 2 + 2;
        });
        const cut = writeBranchCutPoints(options.branchCutPoints, allocations);
        const outputPointer = trackAlloc(allocations, outputCapacity * 16);
        const total = wasm.ce_build_planar_lines(
            configPointer, startsPointer, endsPointer, countsPointer, lineCount,
            options.scaleX, options.scaleY, options.renderLimit,
            options.jumpThresholdSq, options.toleranceSq,
            options.hasBranchCuts ? 1 : 0, options.branchCutType === 'draw' ? 1 : 0,
            options.branchCutAngle, cut.pointer, cut.count,
            outputPointer, outputCapacity, offsetsPointer
        );
        if (total < 0) throw new Error(`Native planar lines job failed with status ${total}.`);
        const offsets = copyWasmArray(Uint32Array, offsetsPointer, lineCount + 1);
        const packed = readComplexBuffer(outputPointer, total);
        return options.lines.map((_line, index) => packed.slice(offsets[index] * 2, offsets[index + 1] * 2));
    });
}

export function buildNativePlanarPolyline(options) {
    if (!Array.isArray(options.points) || !options.points.length) return new Float64Array();
    const maxDepth = requireInteger(options.maxDepth, 'Native planar-polyline subdivision depth');
    if (maxDepth < 0 || maxDepth > 20) {
        throw new Error('Native planar-polyline subdivision depth must be from zero through 20.');
    }
    requirePlanarRenderOptions(options);
    requireFiniteNumber(options.originX, 'Native planar-polyline x origin');
    requireFiniteNumber(options.originY, 'Native planar-polyline y origin');
    const maxSegmentSq = requireFiniteNumber(options.maxSegmentSq, 'Native planar-polyline segment limit');
    if (maxSegmentSq <= 0) throw new Error('Native planar-polyline segment limit must be positive.');
    const theoretical = options.points.length * 2 ** Math.min(maxDepth, 12);
    const outputCapacity = Math.min(1_000_000, Math.max(4096, theoretical));
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, options.map, allocations);
        const inputPointer = trackAlloc(allocations, options.points.length * 16);
        const inputView = memoryView();
        options.points.forEach((point, index) => {
            const offset = inputPointer + index * 16;
            inputView.setFloat64(offset, Number.isFinite(point?.re) ? point.re : NaN, true);
            inputView.setFloat64(offset + 8, Number.isFinite(point?.im) ? point.im : NaN, true);
        });
        const cut = writeBranchCutPoints(options.branchCutPoints, allocations);
        const outputPointer = trackAlloc(allocations, outputCapacity * 16);
        const count = wasm.ce_build_planar_polyline(
            configPointer, inputPointer, options.points.length,
            options.originX, options.originY, options.scaleX, options.scaleY,
            options.renderLimit, options.jumpThresholdSq, options.toleranceSq,
            options.maxSegmentSq, maxDepth,
            options.hasBranchCuts ? 1 : 0, options.branchCutType === 'draw' ? 1 : 0,
            options.branchCutAngle, cut.pointer, cut.count,
            outputPointer, outputCapacity
        );
        if (count < 0) throw new Error(`Native planar polyline job failed with status ${count}.`);
        return readComplexBuffer(outputPointer, count);
    });
}

export function traceNativeStreamlines(options) {
    if (!Array.isArray(options.seeds)) throw new Error('Native streamline seeds must be an array.');
    const seeds = options.seeds;
    const maxSteps = requireInteger(options.maxSteps, 'Native streamline step limit');
    if (maxSteps < 1 || maxSteps > 10000) {
        throw new Error('Native streamline step limit must be from one through 10,000.');
    }
    if (!seeds.length) return [];
    seeds.forEach((seed, index) => requireFiniteComplex(
        { re: seed?.x ?? seed?.re, im: seed?.y ?? seed?.im },
        `Native streamline seed ${index}`
    ));
    const xRange = requireIncreasingRange(options.xRange, 'Native streamline x range');
    const yRange = requireIncreasingRange(options.yRange, 'Native streamline y range');
    const stepSize = requireFiniteNumber(options.stepSize, 'Native streamline step size');
    if (stepSize <= 0) throw new Error('Native streamline step size must be positive.');
    requireBoolean(options.inverse, 'Native streamline inverse');
    const capacity = seeds.length * maxSteps;
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, options.map, allocations);
        const seedsPointer = trackAlloc(allocations, seeds.length * 16);
        writePointBuffer(seedsPointer, seeds.map(seed => ({ re: seed.x ?? seed.re, im: seed.y ?? seed.im })));
        const positionsPointer = trackAlloc(allocations, capacity * 16);
        const magnitudesPointer = trackAlloc(allocations, capacity * 8);
        const offsetsPointer = trackAlloc(allocations, (seeds.length + 1) * 4);
        const count = wasm.ce_trace_streamlines(
            configPointer, seedsPointer, seeds.length,
            xRange[0], xRange[1], yRange[0], yRange[1], stepSize,
            maxSteps, options.inverse ? 1 : 0,
            positionsPointer, magnitudesPointer, capacity, offsetsPointer
        );
        if (count < 0) throw new Error(`Native streamline job failed with status ${count}.`);
        const view = memoryView();
        const offsets = new Uint32Array(wasm.memory.buffer, offsetsPointer, seeds.length + 1);
        return seeds.map((_seed, seedIndex) => Array.from(
            { length: offsets[seedIndex + 1] - offsets[seedIndex] },
            (_, localIndex) => {
                const index = offsets[seedIndex] + localIndex;
                return {
                    x: view.getFloat64(positionsPointer + index * 16, true),
                    y: view.getFloat64(positionsPointer + index * 16 + 8, true),
                    magnitude: view.getFloat64(magnitudesPointer + index * 8, true)
                };
            }
        ));
    });
}

export function buildNativeVectorField(options) {
    const density = requireInteger(options.density, 'Native vector-field density');
    if (density < 1 || density > 256) {
        throw new Error('Native vector-field density must be from one through 256.');
    }
    const xRange = requireIncreasingRange(options.xRange, 'Native vector-field x range');
    const yRange = requireIncreasingRange(options.yRange, 'Native vector-field y range');
    requireBoolean(options.inverse, 'Native vector-field inverse');
    const count = (density + 1) ** 2;
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, options.map, allocations);
        const positionsPointer = trackAlloc(allocations, count * 16);
        const vectorsPointer = trackAlloc(allocations, count * 16);
        const magnitudesPointer = trackAlloc(allocations, count * 8);
        const validPointer = trackAlloc(allocations, count);
        const status = wasm.ce_build_vector_field(
            configPointer, xRange[0], xRange[1], yRange[0], yRange[1],
            density, options.inverse ? 1 : 0,
            positionsPointer, vectorsPointer, magnitudesPointer, validPointer
        );
        if (status !== count) throw new Error(`Native vector-field job failed with status ${status}.`);
        const view = memoryView();
        const valid = new Uint8Array(wasm.memory.buffer, validPointer, count);
        const result = [];
        for (let index = 0; index < count; index += 1) {
            if (!valid[index]) continue;
            result.push({
                x: view.getFloat64(positionsPointer + index * 16, true),
                y: view.getFloat64(positionsPointer + index * 16 + 8, true),
                re: view.getFloat64(vectorsPointer + index * 16, true),
                im: view.getFloat64(vectorsPointer + index * 16 + 8, true),
                magnitude: view.getFloat64(magnitudesPointer + index * 8, true)
            });
        }
        return result;
    });
}

export function buildNativeTissot(options) {
    const density = requireInteger(options.density, 'Native Tissot density');
    const segments = requireInteger(options.segments, 'Native Tissot segment count');
    if (density < 1 || segments < 3) throw new Error('Native Tissot density and segment count are invalid.');
    const columns = Math.max(4, Math.min(10, Math.round(density * 0.48)));
    const capacity = (columns - 1) ** 2;
    const circlePoints = segments + 1;
    return withAllocations((allocations, allocate) => {
        const configPointer = allocate(MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, options.map, allocations);
        const sourceCenters = allocate(capacity * 16);
        const mappedCenters = allocate(capacity * 16);
        const inputRadii = allocate(capacity * 8);
        const outputRadii = allocate(capacity * 8);
        const critical = allocate(capacity);
        const sourceCircles = allocate(capacity * circlePoints * 16);
        const mappedCircles = allocate(capacity * circlePoints * 16);
        const sourceSpokes = allocate(capacity * 2 * 16);
        const mappedSpokes = allocate(capacity * 2 * 16);
        const sourceArrows = allocate(capacity * 3 * 16);
        const mappedArrows = allocate(capacity * 3 * 16);
        const count = wasm.ce_build_tissot(
            configPointer, options.xRange[0], options.xRange[1], options.yRange[0], options.yRange[1],
            density, segments, sourceCenters, mappedCenters, inputRadii, outputRadii, critical,
            sourceCircles, mappedCircles, sourceSpokes, mappedSpokes, sourceArrows, mappedArrows, capacity
        );
        if (count < 0) throw new Error(`Native Tissot job failed with status ${count}.`);
        const view = memoryView();
        const point = (pointer, index) => ({
            re: view.getFloat64(pointer + index * 16, true),
            im: view.getFloat64(pointer + index * 16 + 8, true)
        });
        const points = (pointer, offset, length) => Array.from({ length }, (_, index) => point(pointer, offset + index));
        const criticalValues = new Uint8Array(wasm.memory.buffer, critical, count);
        return Array.from({ length: count }, (_, index) => ({
            sourceCenter: point(sourceCenters, index),
            mappedCenter: point(mappedCenters, index),
            inputRadius: view.getFloat64(inputRadii + index * 8, true),
            outputRadius: view.getFloat64(outputRadii + index * 8, true),
            sourceCircle: points(sourceCircles, index * circlePoints, circlePoints),
            mappedCircle: points(mappedCircles, index * circlePoints, circlePoints),
            sourceSpoke: points(sourceSpokes, index * 2, 2),
            mappedSpoke: points(mappedSpokes, index * 2, 2),
            sourceArrowhead: points(sourceArrows, index * 3, 3).filter(value => Number.isFinite(value.re)),
            mappedArrowhead: points(mappedArrows, index * 3, 3).filter(value => Number.isFinite(value.re)),
            isCritical: criticalValues[index] !== 0
        }));
    });
}

export function findNativePreimages(options) {
    if (!options || !Array.isArray(options.xRange) || !Array.isArray(options.yRange) ||
        options.xRange.length !== 2 || options.yRange.length !== 2) {
        throw new Error('Native preimage search requires viewport ranges.');
    }
    requireFiniteComplex(options.target, 'Native preimage target');
    const xMin = requireFiniteNumber(options.xRange[0], 'Native preimage x minimum');
    const xMax = requireFiniteNumber(options.xRange[1], 'Native preimage x maximum');
    const yMin = requireFiniteNumber(options.yRange[0], 'Native preimage y minimum');
    const yMax = requireFiniteNumber(options.yRange[1], 'Native preimage y maximum');
    if (xMin >= xMax || yMin >= yMax) throw new Error('Native preimage ranges must increase.');
    const requestedDensity = requireInteger(options.density, 'Native preimage density');
    if (requestedDensity < 8 || requestedDensity > 64) {
        throw new Error('Native preimage density must be between eight and 64.');
    }
    const density = requestedDensity;
    const capacity = Math.max(16, (density + 1) ** 2);
    const span = Math.max(xMax - xMin, yMax - yMin);
    const tolerance = options.tolerance === undefined
        ? Math.max(1e-8, span * 2e-6)
        : requireFiniteNumber(options.tolerance, 'Native preimage tolerance');
    const derivativeStep = options.derivativeStep === undefined
        ? Math.max(1e-7, span * 2e-6)
        : requireFiniteNumber(options.derivativeStep, 'Native preimage derivative step');
    const mergeDistance = options.mergeDistance === undefined
        ? Math.max(tolerance * 12, span / (density * 120))
        : requireFiniteNumber(options.mergeDistance, 'Native preimage merge distance');
    const maxIterations = requireInteger(options.maxIterations, 'Native preimage iteration limit');
    if (tolerance <= 0 || derivativeStep <= 0 || mergeDistance <= 0 || maxIterations < 1) {
        throw new Error('Native preimage search tolerances and iteration limit must be positive.');
    }
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, options.map, allocations);
        const rootsPointer = trackAlloc(allocations, capacity * 16);
        const count = wasm.ce_find_preimages(
            configPointer, options.target.re, options.target.im,
            xMin, xMax, yMin, yMax,
            density, maxIterations,
            tolerance, derivativeStep, mergeDistance, options.inverseOutput ? 1 : 0,
            rootsPointer, capacity
        );
        if (count < 0) throw new Error(`Native preimage job failed with status ${count}.`);
        return readComplexObjects(rootsPointer, count);
    });
}

export function findNativePolynomialRoots(coefficients, options) {
    if (!Array.isArray(coefficients) || coefficients.length < 2) return [];
    const maxIterations = requireInteger(options?.maxIterations, 'Native polynomial-root iteration limit');
    const tolerance = requireFiniteNumber(options?.tolerance, 'Native polynomial-root tolerance');
    if (maxIterations < 1 || tolerance <= 0) {
        throw new Error('Native polynomial-root iterations and tolerance must be positive.');
    }
    return withAllocations((allocations, allocate) => {
        const coefficientsPointer = trackAlloc(allocations, coefficients.length * 16);
        writePointBuffer(coefficientsPointer, coefficients.map(value => typeof value === 'number' ? { re: value, im: 0 } : value));
        const rootsPointer = trackAlloc(allocations, (coefficients.length - 1) * 16);
        const count = wasm.ce_find_polynomial_roots(
            coefficientsPointer, coefficients.length,
            maxIterations, tolerance, rootsPointer
        );
        if (count < 0) throw new Error(`Native polynomial-root job failed with status ${count}.`);
        return readComplexObjects(rootsPointer, count);
    });
}

export function analyzeNativeContour(map, points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    points.forEach((point, index) => requireFiniteComplex(point, `Native contour point ${index}`));
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, map, allocations);
        const pointsPointer = trackAlloc(allocations, points.length * 16);
        const pointsView = memoryView();
        points.forEach((point, index) => writeComplex(pointsView, pointsPointer + index * 16, point));
        const integralPointer = trackAlloc(allocations, 16);
        const windingPointer = trackAlloc(allocations, 8);
        const statusPointer = trackAlloc(allocations, 4);
        const result = wasm.ce_analyze_contour(
            configPointer, pointsPointer, points.length, integralPointer, windingPointer, statusPointer
        );
        if (result !== 0) throw new Error(`Native contour job failed with status ${result}.`);
        const view = memoryView();
        return {
            integral: {
                re: view.getFloat64(integralPointer, true),
                im: view.getFloat64(integralPointer + 8, true)
            },
            winding: view.getFloat64(windingPointer, true),
            status: view.getUint32(statusPointer, true)
        };
    });
}

export function estimateNativeResidue(map, pole, radius, samples) {
    requireFiniteComplex(pole, 'Native residue pole');
    const radiusValue = requireFiniteNumber(radius, 'Native residue radius');
    const sampleCount = requireInteger(samples, 'Native residue sample count');
    if (radiusValue <= 0 || sampleCount < 8) {
        throw new Error('Native residue radius must be positive and sample count must be at least eight.');
    }
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, map, allocations);
        const outputPointer = trackAlloc(allocations, 16);
        const status = wasm.ce_estimate_residue(
            configPointer, pole.re, pole.im, radiusValue, sampleCount, outputPointer
        );
        if (status !== 0) throw new Error(`Native residue estimation failed with status ${status}.`);
        const view = memoryView();
        return { re: view.getFloat64(outputPointer, true), im: view.getFloat64(outputPointer + 8, true) };
    });
}

export function generateNativeContourPoints(type, params, stepCount) {
    const count = requireInteger(stepCount, 'Native contour step count');
    if (count < 1) throw new Error('Native contour step count must be positive.');
    const typeId = type === 'circle' ? 1 : (type === 'ellipse' ? 2 : 0);
    if (!typeId) throw new Error(`Unsupported native contour type: ${type}.`);
    const centerX = requireFiniteNumber(params?.cx, 'Native contour center x');
    const centerY = requireFiniteNumber(params?.cy, 'Native contour center y');
    const paramA = requireFiniteNumber(typeId === 1 ? params?.r : params?.a, 'Native contour first radius');
    const paramB = typeId === 1 ? 0 : requireFiniteNumber(params?.b, 'Native contour second radius');
    if (paramA <= 0 || (typeId === 2 && paramB <= 0)) throw new Error('Native contour radii must be positive.');
    return withAllocations((allocations, allocate) => {
        const outputPointer = trackAlloc(allocations, (count + 1) * 16);
        const total = wasm.ce_generate_contour_points(
            typeId, centerX, centerY, paramA, paramB, count, outputPointer
        );
        if (total < 0) throw new Error(`Native contour generation failed with status ${total}.`);
        return readComplexObjects(outputPointer, total);
    });
}

export function classifyNativeContourSingularities(contourType, params, polygonContours, epsilon, singularities) {
    if (!Array.isArray(singularities) || !singularities.length) return [];
    const typeId = contourType === 'circle' ? 1 : (contourType === 'ellipse' ? 2 : (contourType === 'contour' || contourType === 'contours' ? 3 : 0));
    if (!typeId) throw new Error(`Unsupported native contour type: ${contourType}.`);
    const cx = typeId === 3 ? 0 : requireFiniteNumber(params?.cx, 'Native contour center x');
    const cy = typeId === 3 ? 0 : requireFiniteNumber(params?.cy, 'Native contour center y');
    const paramA = typeId === 1 ? requireFiniteNumber(params?.r, 'Native contour radius')
        : typeId === 2 ? requireFiniteNumber(params?.a, 'Native contour first radius') : 0;
    const paramB = typeId === 2 ? requireFiniteNumber(params?.b, 'Native contour second radius') : 0;
    const epsilonValue = requireFiniteNumber(epsilon, 'Native contour epsilon');
    if (epsilonValue < 0) throw new Error('Native contour epsilon must be non-negative.');
    singularities.forEach((singularity, index) =>
        requireFiniteComplex(singularity, `Native contour singularity ${index}`));
    return withAllocations((allocations, allocate) => {
        let polygonPointsPointer = 0;
        let polygonOffsetsPointer = 0;
        let polygonCount = 0;
        if (typeId === 3) {
            if (!Array.isArray(polygonContours) || !polygonContours.length ||
                polygonContours.some(points => !Array.isArray(points) || !points.length)) {
                throw new Error('Native polygon contour classification requires non-empty contours.');
            }
            polygonCount = polygonContours.length;
            const totalPoints = polygonContours.reduce((sum, points) => sum + points.length, 0);
            polygonPointsPointer = trackAlloc(allocations, totalPoints * 16);
            polygonOffsetsPointer = trackAlloc(allocations, (polygonCount + 1) * 4);
            const view = memoryView();
            let currentOffset = 0;
            polygonContours.forEach((points, pIndex) => {
                view.setUint32(polygonOffsetsPointer + pIndex * 4, currentOffset, true);
                points.forEach((point, pointIndex) => {
                    requireFiniteComplex(point, `Native polygon ${pIndex} point ${pointIndex}`);
                    writeComplex(view, polygonPointsPointer + currentOffset * 16, point);
                    currentOffset += 1;
                });
            });
            view.setUint32(polygonOffsetsPointer + polygonCount * 4, currentOffset, true);
        }

        const singPointer = trackAlloc(allocations, singularities.length * 16);
        const insidePointer = trackAlloc(allocations, singularities.length);
        const safePointer = trackAlloc(allocations, singularities.length);
        const singView = memoryView();
        singularities.forEach((sing, index) => writeComplex(singView, singPointer + index * 16, sing));

        const status = wasm.ce_classify_contour_singularities(
            typeId, cx, cy, paramA, paramB,
            polygonPointsPointer, polygonOffsetsPointer, polygonCount,
            epsilonValue, singPointer, singularities.length,
            insidePointer, safePointer
        );
        if (status !== 0) throw new Error(`Native singularity classification failed with status ${status}.`);
        const insideBuf = new Uint8Array(wasm.memory.buffer, insidePointer, singularities.length);
        const safeBuf = new Uint8Array(wasm.memory.buffer, safePointer, singularities.length);
        return Array.from({ length: singularities.length }, (_, index) => ({
            inside: insideBuf[index] !== 0,
            safeForResidue: safeBuf[index] !== 0
        }));
    });
}

function writeDomainPalette(palette, allocations) {
    if (!Array.isArray(palette) || palette.length < 2) {
        throw new Error('Native domain rendering requires at least two palette stops.');
    }
    const paletteRgPointer = trackAlloc(allocations, palette.length * 16);
    const paletteBPointer = trackAlloc(allocations, palette.length * 8);
    const paletteView = memoryView();
    palette.forEach((stop, index) => {
        if (!Array.isArray(stop) || stop.length < 3 || !stop.slice(0, 3).every(Number.isFinite)) {
            throw new Error(`Invalid native domain palette stop at index ${index}.`);
        }
        paletteView.setFloat64(paletteRgPointer + index * 16, stop[0], true);
        paletteView.setFloat64(paletteRgPointer + index * 16 + 8, stop[1], true);
        paletteView.setFloat64(paletteBPointer + index * 8, stop[2], true);
    });
    return { paletteRgPointer, paletteBPointer, paletteCount: palette.length };
}

export function createCompiledDomainTileRenderer(snapshot) {
    const allocations = [];
    const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
    writeMapConfig(configPointer, snapshot, allocations);
    const palette = snapshot.paletteStops;
    const { paletteRgPointer, paletteBPointer, paletteCount } = writeDomainPalette(palette, allocations);

    const viewport = snapshot.viewport;
    const orbitMode = ({ value: 0, escape: 1, attractor: 2, hybrid: 3 })[snapshot.orbitColoringMode];
    if (orbitMode === undefined) throw new Error(`Unsupported native orbit-coloring mode: ${snapshot.orbitColoringMode}`);
    const style = snapshot.style;
    if (!style || ![style.brightness, style.contrast, style.saturation, style.lightnessCycles].every(Number.isFinite)) {
        throw new Error('Native domain rendering requires finite style parameters.');
    }
    if (typeof viewport.centerRe !== 'string' || typeof viewport.centerIm !== 'string' ||
        typeof viewport.xSpan !== 'string' || typeof viewport.ySpan !== 'string' ||
        !Number.isInteger(viewport.precisionBits)) {
        throw new Error('Native domain rendering requires one MPFR-centered viewport.');
    }
    const centerRePointer = writeCString(viewport.centerRe, allocations);
    const centerImPointer = writeCString(viewport.centerIm, allocations);
    const xSpanPointer = writeCString(viewport.xSpan, allocations);
    const ySpanPointer = writeCString(viewport.ySpan, allocations);
    let outputCapacity = 0;
    let outputPointer = 0;
    const renderContextPointer = wasm.ce_create_domain_render_context(
        configPointer, centerRePointer, centerImPointer, xSpanPointer, ySpanPointer,
        viewport.precisionBits,
        viewport.width, viewport.height,
        orbitMode, paletteRgPointer, paletteBPointer, paletteCount,
        style.brightness, style.contrast, style.saturation, style.lightnessCycles
    );
    if (!renderContextPointer) {
        throw new Error('Native domain render-context allocation failed.');
    }

    const render = tile => {
        const outputLength = tile.width * tile.height * 4;
        if (outputLength > outputCapacity) {
            if (outputPointer) wasm.ce_free(outputPointer);
            outputCapacity = outputLength;
            outputPointer = alloc(outputCapacity);
        }
        const status = wasm.ce_render_domain_tile(
            renderContextPointer,
            tile.x, tile.y, tile.width, tile.height, tile.scale,
            tile.adaptiveQuality ? 1 : 0, outputPointer
        );
        if (status !== 0) throw new Error(`Native domain tile failed with status ${status}.`);
        const result = new Uint8ClampedArray(outputLength);
        result.set(new Uint8Array(wasm.memory.buffer, outputPointer, outputLength));
        return result;
    };
    render.dispose = () => {
        if (outputPointer) wasm.ce_free(outputPointer);
        if (renderContextPointer) wasm.ce_destroy_domain_render_context(renderContextPointer);
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    };

    return render;
}

const CONTOUR_COMPONENT_IDS = Object.freeze({ real: 0, imaginary: 1, imag: 1, magnitude: 2, phase: 3 });

export function renderNativeMapContour(options) {
    const width = requireInteger(options.width, 'Native contour width');
    const height = requireInteger(options.height, 'Native contour height');
    const component = CONTOUR_COMPONENT_IDS[options.component];
    if (width < 1 || height < 1 || width * height > 0x3fffffff) {
        throw new Error('Native contour rendering requires positive integer dimensions.');
    }
    if (component === undefined) throw new Error(`Unsupported native contour component: ${options.component}`);
    if (typeof options.contoursEnabled !== 'boolean') {
        throw new Error('Native contour rendering requires an explicit contoursEnabled flag.');
    }
    if (!Array.isArray(options.xRange) || !Array.isArray(options.yRange) ||
        options.xRange.length !== 2 || options.yRange.length !== 2 ||
        ![...options.xRange, ...options.yRange].every(Number.isFinite) ||
        options.xRange[0] >= options.xRange[1] || options.yRange[0] >= options.yRange[1]) {
        throw new Error('Native contour rendering requires finite viewport ranges.');
    }
    const contourInterval = requireFiniteNumber(options.contourInterval, 'Native contour interval');
    const contourThickness = requireFiniteNumber(options.contourThickness, 'Native contour thickness');
    if (contourInterval <= 0 || contourThickness <= 0) {
        throw new Error('Native contour interval and thickness must be positive.');
    }
    const style = options.style;
    if (!style || ![style.brightness, style.contrast, style.saturation, style.lightnessCycles].every(Number.isFinite)) {
        throw new Error('Native contour rendering requires finite style parameters.');
    }
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, options.mapOptions, allocations);
        const { paletteRgPointer, paletteBPointer, paletteCount } = writeDomainPalette(options.paletteStops, allocations);
        const outputLength = width * height * 4;
        const outputPointer = trackAlloc(allocations, outputLength);
        const status = wasm.ce_render_map_contour(
            configPointer,
            options.xRange[0], options.xRange[1], options.yRange[0], options.yRange[1],
            width, height, component, options.contoursEnabled ? 1 : 0,
            contourInterval, contourThickness,
            paletteRgPointer, paletteBPointer, paletteCount,
            style.brightness, style.contrast, style.saturation, style.lightnessCycles,
            outputPointer
        );
        if (status !== 0) throw new Error(`Native contour rendering failed with status ${status}.`);
        return copyWasmArray(Uint8ClampedArray, outputPointer, outputLength);
    });
}

function preciseViewportArguments(viewport) {
    const width = requireInteger(viewport?.width, 'Precise viewport width');
    const height = requireInteger(viewport?.height, 'Precise viewport height');
    const zoomPower = Number(viewport?.zoomPower);
    const precisionBits = requireInteger(viewport?.precisionBits, 'Precise viewport precision');
    if (typeof viewport?.centerRe !== 'string' || typeof viewport?.centerIm !== 'string' ||
        width < 1 || height < 1 || precisionBits < 128 || precisionBits > 4096 ||
        !Number.isFinite(zoomPower)) throw new Error('Native precise geometry requires a precise viewport.');
    return { width, height, zoomPower, precisionBits };
}

function packPrecisePixelPairs(pixels, label) {
    if (pixels instanceof Float32Array) return pixels;
    if (!Array.isArray(pixels)) throw new Error(`${label} requires pixel pairs.`);
    const packed = new Float32Array(pixels.length * 2);
    pixels.forEach((point, index) => {
        packed[index * 2] = requireFiniteNumber(point?.x, `${label} point ${index} x`);
        packed[index * 2 + 1] = requireFiniteNumber(point?.y, `${label} point ${index} y`);
    });
    return packed;
}

function optionalMapPointer(options, allocations) {
    if (!options.mapPoints) return 0;
    const pointer = alloc(MAP_CONFIG_SIZE);
    allocations.push(pointer);
    writeMapConfig(pointer, options.mapOptions, allocations);
    return pointer;
}

export function projectNativePrecisePixels(options, pixels) {
    const input = preciseViewportArguments(options.inputViewport);
    const output = preciseViewportArguments(options.outputViewport);
    const packed = packPrecisePixelPairs(pixels, 'Native precise pixel geometry');
    if (packed.length % 2) throw new Error('Native precise pixel geometry requires x/y pairs.');
    const pointCount = packed.length / 2;
    if (!pointCount) return new Float32Array();
    return withAllocations((allocations, allocate) => {
        const mapPointer = optionalMapPointer(options, allocations);
        const inputRePointer = writeCString(options.inputViewport.centerRe, allocations);
        const inputImPointer = writeCString(options.inputViewport.centerIm, allocations);
        const outputRePointer = writeCString(options.outputViewport.centerRe, allocations);
        const outputImPointer = writeCString(options.outputViewport.centerIm, allocations);
        const pixelsPointer = trackAlloc(allocations, packed.byteLength);
        const resultPointer = trackAlloc(allocations, packed.byteLength);
        const validPointer = trackAlloc(allocations, pointCount);
        new Float32Array(wasm.memory.buffer, pixelsPointer, packed.length).set(packed);
        const status = wasm.ce_project_precise_pixels(
            mapPointer, inputRePointer, inputImPointer, input.zoomPower, input.precisionBits,
            input.width, input.height, pixelsPointer, pointCount, options.mapPoints ? 1 : 0,
            outputRePointer, outputImPointer, output.zoomPower, output.width, output.height,
            resultPointer, validPointer
        );
        if (status !== 0) throw new Error(`Native precise pixel geometry failed with status ${status}.`);
        return copyWasmArray(Float32Array, resultPointer, packed.length);
    });
}

export function projectNativePrecisePixelsToCanvas(options, pixels) {
    const input = preciseViewportArguments(options.inputViewport);
    const packed = packPrecisePixelPairs(pixels, 'Native precise canvas geometry');
    if (packed.length % 2) throw new Error('Native precise canvas geometry requires x/y pairs.');
    const pointCount = packed.length / 2;
    if (!pointCount) return new Float32Array();
    return withAllocations((allocations, allocate) => {
        const mapPointer = optionalMapPointer(options, allocations);
        const inputRePointer = writeCString(options.inputViewport.centerRe, allocations);
        const inputImPointer = writeCString(options.inputViewport.centerIm, allocations);
        const pixelsPointer = trackAlloc(allocations, packed.byteLength);
        const resultPointer = trackAlloc(allocations, packed.byteLength);
        const validPointer = trackAlloc(allocations, pointCount);
        new Float32Array(wasm.memory.buffer, pixelsPointer, packed.length).set(packed);
        const status = wasm.ce_project_precise_pixels_to_canvas(
            mapPointer, inputRePointer, inputImPointer, input.zoomPower, input.precisionBits,
            input.width, input.height, pixelsPointer, pointCount, options.mapPoints ? 1 : 0,
            requireFiniteNumber(options.outputOrigin?.x, 'Precise canvas origin x'),
            requireFiniteNumber(options.outputOrigin?.y, 'Precise canvas origin y'),
            requireFiniteNumber(options.outputScale?.x, 'Precise canvas scale x'),
            requireFiniteNumber(options.outputScale?.y, 'Precise canvas scale y'),
            resultPointer, validPointer
        );
        if (status !== 0) throw new Error(`Native precise-to-canvas geometry failed with status ${status}.`);
        return copyWasmArray(Float32Array, resultPointer, packed.length);
    });
}

export function projectNativeValuesToPrecise(options, points) {
    if (!Array.isArray(points) || !points.length) return new Float32Array();
    const output = preciseViewportArguments(options.outputViewport);
    return withAllocations((allocations, allocate) => {
        const mapPointer = optionalMapPointer(options, allocations);
        const outputRePointer = writeCString(options.outputViewport.centerRe, allocations);
        const outputImPointer = writeCString(options.outputViewport.centerIm, allocations);
        const pointsPointer = trackAlloc(allocations, points.length * 16);
        const resultPointer = trackAlloc(allocations, points.length * 8);
        const validPointer = trackAlloc(allocations, points.length);
        const view = memoryView();
        points.forEach((point, index) => writeComplex(view, pointsPointer + index * 16, point, NaN, NaN));
        const status = wasm.ce_project_values_to_precise(
            mapPointer, pointsPointer, points.length, options.mapPoints ? 1 : 0,
            outputRePointer, outputImPointer, output.zoomPower, output.precisionBits,
            output.width, output.height, resultPointer, validPointer
        );
        if (status !== 0) throw new Error(`Native precise value geometry failed with status ${status}.`);
        return copyWasmArray(Float32Array, resultPointer, points.length * 2);
    });
}

const TRANSFORM_SIGNAL_TYPES = Object.freeze({
    sine: 0,
    cosine: 1,
    square: 2,
    sawtooth: 3,
    triangle: 4,
    am: 5,
    fm: 6,
    chirp: 7,
    damped_sine: 8,
    exponential: 9,
    gaussian: 10,
    pulse: 11,
    harmonics: 12,
    beat: 13,
    noise: 14
});

export function generateNativeTransformSignal(funcType, frequency, amplitude, timeWindow, sampleCount, randomSeed) {
    const samples = requireInteger(sampleCount, 'Transform sample count');
    if (samples < 1) throw new Error('Transform sample count must be positive.');
    const signalType = TRANSFORM_SIGNAL_TYPES[funcType];
    if (signalType === undefined) throw new Error(`Unsupported transform signal type: ${funcType}.`);
    const frequencyValue = requireFiniteNumber(frequency, 'Transform frequency');
    const amplitudeValue = requireFiniteNumber(amplitude, 'Transform amplitude');
    const window = requireFiniteNumber(timeWindow, 'Transform time window');
    if (window <= 0) throw new Error('Transform time window must be positive.');
    const seed = requireInteger(randomSeed, 'Transform random seed');
    if (seed < 0 || seed > 0xffffffff) throw new Error('Transform random seed must be an unsigned 32-bit integer.');
    return withAllocations((allocations, allocate) => {
        const timesPointer = trackAlloc(allocations, samples * 8);
        const valuesPointer = trackAlloc(allocations, samples * 8);
        const status = wasm.ce_generate_transform_signal(
            signalType, frequencyValue, amplitudeValue, window, samples, seed,
            timesPointer, valuesPointer
        );
        if (status !== 0) throw new Error(`Native transform signal generation failed with status ${status}.`);
        const timesBuf = new Float64Array(wasm.memory.buffer, timesPointer, samples);
        const valuesBuf = new Float64Array(wasm.memory.buffer, valuesPointer, samples);
        return Array.from({ length: samples }, (_, index) => ({
            t: timesBuf[index],
            value: valuesBuf[index]
        }));
    });
}

export function computeNativeSpectrum(values) {
    if (!Array.isArray(values) || !values.length) return [];
    const count = values.length;
    return withAllocations((allocations, allocate) => {
        const valuesPointer = trackAlloc(allocations, count * 8);
        const freqPointer = trackAlloc(allocations, count * 8);
        const realPointer = trackAlloc(allocations, count * 8);
        const imagPointer = trackAlloc(allocations, count * 8);
        const magPointer = trackAlloc(allocations, count * 8);
        const phasePointer = trackAlloc(allocations, count * 8);

        const valBuf = new Float64Array(wasm.memory.buffer, valuesPointer, count);
        for (let i = 0; i < count; i++) {
            valBuf[i] = requireFiniteNumber(values[i], `Transform sample ${i}`);
        }

        const status = wasm.ce_compute_spectrum(
            valuesPointer, count, freqPointer, realPointer, imagPointer, magPointer, phasePointer
        );
        if (status !== 0) throw new Error(`Native spectrum computation failed with status ${status}.`);

        const freqBuf = new Float64Array(wasm.memory.buffer, freqPointer, count);
        const realBuf = new Float64Array(wasm.memory.buffer, realPointer, count);
        const imagBuf = new Float64Array(wasm.memory.buffer, imagPointer, count);
        const magBuf = new Float64Array(wasm.memory.buffer, magPointer, count);
        const phaseBuf = new Float64Array(wasm.memory.buffer, phasePointer, count);

        return Array.from({ length: count }, (_, index) => ({
            k: index,
            frequency: freqBuf[index],
            real: realBuf[index],
            imag: imagBuf[index],
            magnitude: magBuf[index],
            phase: phaseBuf[index]
        }));
    });
}

export function buildNativeLaplaceWinding(signal, sigma, omega, progress = 1) {
    if (!Array.isArray(signal) || signal.length < 2) {
        throw new Error('Native Laplace winding requires at least two signal samples.');
    }
    const count = signal.length;
    const sigmaValue = requireFiniteNumber(sigma, 'Laplace sigma');
    const omegaValue = requireFiniteNumber(omega, 'Laplace omega');
    const progressValue = requireFiniteNumber(progress, 'Laplace animation progress');
    if (progressValue < 0 || progressValue > 1) {
        throw new Error('Laplace animation progress must be between zero and one.');
    }

    return withAllocations((allocations, allocate) => {
        const timesPointer = trackAlloc(allocations, count * 8);
        const valuesPointer = trackAlloc(allocations, count * 8);
        const woundPointer = trackAlloc(allocations, count * 16);
        const weightedPointer = trackAlloc(allocations, count * 8);
        const envelopePointer = trackAlloc(allocations, count * 8);
        const integralPointer = trackAlloc(allocations, 16);
        const maxRadiusPointer = trackAlloc(allocations, 8);
        const maxAmplitudePointer = trackAlloc(allocations, 8);

        const times = new Float64Array(wasm.memory.buffer, timesPointer, count);
        const values = new Float64Array(wasm.memory.buffer, valuesPointer, count);
        signal.forEach((sample, index) => {
            times[index] = requireFiniteNumber(sample?.t, `Laplace sample ${index} time`);
            values[index] = requireFiniteNumber(sample?.value, `Laplace sample ${index} value`);
        });

        const visible = wasm.ce_build_laplace_winding(
            timesPointer, valuesPointer, count, sigmaValue, omegaValue, progressValue,
            woundPointer, weightedPointer, envelopePointer, integralPointer, maxRadiusPointer,
            maxAmplitudePointer
        );
        if (visible < 0) throw new Error(`Native Laplace winding failed with status ${visible}.`);

        const view = memoryView();
        const points = Array.from({ length: visible }, (_, index) => ({
            t: times[index],
            real: view.getFloat64(woundPointer + index * 16, true),
            imag: view.getFloat64(woundPointer + index * 16 + 8, true)
        }));
        return {
            points,
            weighted: new Float64Array(wasm.memory.buffer, weightedPointer, count).slice(),
            envelope: new Float64Array(wasm.memory.buffer, envelopePointer, count).slice(),
            integral: {
                real: view.getFloat64(integralPointer, true),
                imag: view.getFloat64(integralPointer + 8, true)
            },
            maxRadius: view.getFloat64(maxRadiusPointer, true),
            maxAmplitude: view.getFloat64(maxAmplitudePointer, true),
            sigma: sigmaValue,
            omega: omegaValue,
            animTime: progressValue
        };
    });
}

const NATIVE_LAPLACE_FUNCTION_IDS = Object.freeze({
    step: 0,
    exponential: 1,
    sine: 2,
    cosine: 3,
    damped_sine: 4,
    damped_cosine: 5,
    ramp: 6,
    impulse: 7,
    exponential_sine: 8,
    underdamped: 9,
    critically_damped: 10,
    overdamped: 11
});

function laplaceFunctionId(name) {
    const id = NATIVE_LAPLACE_FUNCTION_IDS[name];
    if (id === undefined) throw new Error(`Unsupported native Laplace function: ${name}`);
    return id;
}

export function buildNativeLaplaceAnalysis(options) {
    const sampleCount = requireInteger(options.sampleCount, 'Laplace sample count');
    if (sampleCount < 1) throw new Error('Laplace sample count must be positive.');
    const frequency = requireFiniteNumber(options.frequency, 'Laplace frequency');
    const damping = requireFiniteNumber(options.damping, 'Laplace damping');
    const amplitude = requireFiniteNumber(options.amplitude, 'Laplace amplitude');
    const timeWindow = requireFiniteNumber(options.timeWindow, 'Laplace time window');
    if (timeWindow <= 0) throw new Error('Laplace time window must be positive.');
    return withAllocations((allocations, allocate) => {
        const timesPointer = trackAlloc(allocations, sampleCount * 8);
        const signalPointer = trackAlloc(allocations, sampleCount * 8);
        const polesPointer = trackAlloc(allocations, 2 * 16);
        const poleOrdersPointer = trackAlloc(allocations, 2 * 4);
        const zerosPointer = trackAlloc(allocations, 2 * 16);
        const poleCountPointer = trackAlloc(allocations, 4);
        const zeroCountPointer = trackAlloc(allocations, 4);
        const rocPointer = trackAlloc(allocations, 8);
        const status = wasm.ce_generate_laplace_analysis(
            laplaceFunctionId(options.functionKey), frequency,
            damping, amplitude, timeWindow,
            sampleCount, timesPointer, signalPointer, polesPointer, poleOrdersPointer,
            zerosPointer, poleCountPointer, zeroCountPointer, rocPointer
        );
        if (status !== 0) throw new Error(`Native Laplace analysis failed with status ${status}.`);
        const view = memoryView();
        const poleCount = view.getUint32(poleCountPointer, true);
        const zeroCount = view.getUint32(zeroCountPointer, true);
        const samples = Array.from({ length: sampleCount }, (_, index) => ({
            t: view.getFloat64(timesPointer + index * 8, true),
            value: view.getFloat64(signalPointer + index * 8, true)
        }));
        const readFeature = (pointer, index) => ({
            sigma: view.getFloat64(pointer + index * 16, true),
            omega: view.getFloat64(pointer + index * 16 + 8, true)
        });
        return {
            samples,
            poles: Array.from({ length: poleCount }, (_, index) => ({
                ...readFeature(polesPointer, index),
                order: view.getUint32(poleOrdersPointer + index * 4, true)
            })),
            zeros: Array.from({ length: zeroCount }, (_, index) => readFeature(zerosPointer, index)),
            rocBoundary: view.getFloat64(rocPointer, true)
        };
    });
}

export function buildNativeLaplaceSurface(specification, options) {
    const sigmaSteps = requireInteger(specification.sigmaSteps, 'Laplace sigma steps');
    const omegaSteps = requireInteger(specification.omegaSteps, 'Laplace omega steps');
    if (sigmaSteps < 1 || omegaSteps < 1) throw new Error('Laplace surface steps must be positive.');
    if (!Array.isArray(specification.sigmaRange) || !Array.isArray(specification.omegaRange) ||
        specification.sigmaRange.length !== 2 || specification.omegaRange.length !== 2) {
        throw new Error('Laplace surface requires sigma and omega ranges.');
    }
    const sigmaMin = requireFiniteNumber(specification.sigmaRange[0], 'Laplace sigma minimum');
    const sigmaMax = requireFiniteNumber(specification.sigmaRange[1], 'Laplace sigma maximum');
    const omegaMin = requireFiniteNumber(specification.omegaRange[0], 'Laplace omega minimum');
    const omegaMax = requireFiniteNumber(specification.omegaRange[1], 'Laplace omega maximum');
    if (sigmaMin >= sigmaMax || omegaMin >= omegaMax) throw new Error('Laplace surface ranges must increase.');
    const frequency = requireFiniteNumber(specification.frequency, 'Laplace frequency');
    const damping = requireFiniteNumber(specification.damping, 'Laplace damping');
    const amplitude = requireFiniteNumber(specification.amplitude, 'Laplace amplitude');
    const clipHeight = requireFiniteNumber(options.clipHeight, 'Laplace clip height');
    if (clipHeight <= 0) throw new Error('Laplace clip height must be positive.');
    const vertexCount = (sigmaSteps + 1) * (omegaSteps + 1);
    const indexCapacity = sigmaSteps * omegaSteps * 6;
    const mode = options.mode === 'magnitude' ? 0 : options.mode === 'phase' ? 1
        : options.mode === 'combined' ? 2 : -1;
    if (mode < 0) throw new Error(`Unsupported Laplace surface mode: ${options.mode}.`);
    return withAllocations((allocations, allocate) => {
        const positionsPointer = trackAlloc(allocations, vertexCount * 12);
        const normalsPointer = trackAlloc(allocations, vertexCount * 12);
        const magnitudesPointer = trackAlloc(allocations, vertexCount * 4);
        const phasesPointer = trackAlloc(allocations, vertexCount * 4);
        const indicesPointer = trackAlloc(allocations, indexCapacity * 4);
        const indexCount = wasm.ce_build_laplace_surface(
            laplaceFunctionId(specification.functionKey), frequency,
            damping, amplitude,
            sigmaMin, sigmaMax, omegaMin, omegaMax,
            sigmaSteps, omegaSteps, mode, clipHeight,
            positionsPointer, normalsPointer, magnitudesPointer, phasesPointer, indicesPointer
        );
        if (indexCount < 0) throw new Error(`Native Laplace surface failed with status ${indexCount}.`);
        return {
            positions: copyWasmArray(Float32Array, positionsPointer, vertexCount * 3),
            normals: copyWasmArray(Float32Array, normalsPointer, vertexCount * 3),
            magnitudeValues: copyWasmArray(Float32Array, magnitudesPointer, vertexCount),
            phaseValues: copyWasmArray(Float32Array, phasesPointer, vertexCount),
            indices: copyWasmArray(Uint32Array, indicesPointer, indexCount),
            minSigma: sigmaMin,
            maxSigma: sigmaMax,
            minOmega: omegaMin,
            maxOmega: omegaMax
        };
    });
}

export function buildNativeImageMesh(options) {
    const baseResolution = requireInteger(options.baseResolution, 'Native image-mesh base resolution');
    const maxDepth = requireInteger(options.maxDepth, 'Native image-mesh depth');
    const maxCells = requireInteger(options.maxCells, 'Native image-mesh cell budget');
    const maxVertices = requireInteger(options.maxVertices, 'Native image-mesh vertex budget');
    const maxSamples = requireInteger(options.maxSamples, 'Native image-mesh sample budget');
    const pixelWidth = requireInteger(options.pixelWidth, 'Native image-mesh pixel width');
    const pixelHeight = requireInteger(options.pixelHeight, 'Native image-mesh pixel height');
    const sourceCenter = requireFiniteComplex(options.sourceCenter, 'Native image-mesh source center');
    const sourceWidth = requireFiniteNumber(options.sourceSize?.width, 'Native image-mesh source width');
    const sourceHeight = requireFiniteNumber(options.sourceSize?.height, 'Native image-mesh source height');
    if (baseResolution < 1 || baseResolution > 127 || maxDepth < 0 || maxDepth > 12 ||
        maxCells < baseResolution ** 2 || maxCells > 16383 ||
        maxVertices < 1 || maxVertices > 65535 || maxSamples < 1 ||
        pixelWidth < 1 || pixelHeight < 1 || sourceWidth <= 0 || sourceHeight <= 0) {
        throw new Error('Native image-mesh dimensions and work budgets are invalid.');
    }
    const buildFold = options.buildFold === true;
    const foldHeightScale = requireFiniteNumber(options.foldHeightScale, 'Native image-fold height scale');
    if (foldHeightScale <= 0) throw new Error('Native image-fold height scale must be positive.');
    let bounds = null;
    if (!options.preciseViewport) {
        bounds = {
            x0: requireFiniteNumber(options.bounds?.x0, 'Native image-mesh x minimum'),
            x1: requireFiniteNumber(options.bounds?.x1, 'Native image-mesh x maximum'),
            y0: requireFiniteNumber(options.bounds?.y0, 'Native image-mesh y minimum'),
            y1: requireFiniteNumber(options.bounds?.y1, 'Native image-mesh y maximum')
        };
        if (bounds.x0 >= bounds.x1 || bounds.y0 >= bounds.y1) {
            throw new Error('Native image-mesh bounds must increase.');
        }
    }
    const indexCapacity = maxCells * 24;
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, options.mapOptions, allocations);
        const texturePointer = trackAlloc(allocations, maxVertices * 8);
        const mappedPointer = trackAlloc(allocations, maxVertices * 8);
        const indicesPointer = trackAlloc(allocations, indexCapacity * 2);
        const statsPointer = trackAlloc(allocations, 16);
        const foldPositionsPointer = buildFold ? alloc(maxVertices * 12) : 0;
        const foldUvsPointer = buildFold ? alloc(maxVertices * 8) : 0;
        const foldMappingPointer = buildFold ? alloc(32) : 0;
        for (const pointer of [foldPositionsPointer, foldUvsPointer, foldMappingPointer]) {
            if (pointer) allocations.push(pointer);
        }
        let status;
        if (options.preciseViewport) {
            if (buildFold) throw new Error('Arbitrary-precision raster folds are not supported.');
            const viewport = preciseViewportArguments(options.preciseViewport);
            const centerRePointer = writeCString(options.preciseViewport.centerRe, allocations);
            const centerImPointer = writeCString(options.preciseViewport.centerIm, allocations);
            status = wasm.ce_build_image_mesh_precise(
                configPointer,
                sourceCenter.re, sourceCenter.im, sourceWidth, sourceHeight,
                centerRePointer, centerImPointer, viewport.zoomPower, viewport.precisionBits,
                pixelWidth, pixelHeight,
                baseResolution, maxDepth, maxCells, maxVertices, maxSamples,
                texturePointer, mappedPointer, indicesPointer, indexCapacity, statsPointer
            );
        } else {
            status = wasm.ce_build_image_mesh(
                configPointer,
                sourceCenter.re, sourceCenter.im, sourceWidth, sourceHeight,
                bounds.x0, bounds.x1, bounds.y0, bounds.y1,
                pixelWidth, pixelHeight,
                baseResolution, maxDepth, maxCells, maxVertices, maxSamples,
                texturePointer, mappedPointer, indicesPointer, indexCapacity, statsPointer,
                buildFold ? 1 : 0, foldHeightScale,
                foldPositionsPointer, foldUvsPointer, foldMappingPointer
            );
        }
        if (status !== 0) throw new Error(`Native image mesh failed with status ${status}.`);
        const view = memoryView();
        const vertexCount = view.getUint32(statsPointer, true);
        const indexCount = view.getUint32(statsPointer + 4, true);
        const result = {
            vertices: copyWasmArray(Float32Array, texturePointer, vertexCount * 2),
            mappedPositions: copyWasmArray(Float32Array, mappedPointer, vertexCount * 2),
            indices: copyWasmArray(Uint16Array, indicesPointer, indexCount),
            cellCount: view.getUint32(statsPointer + 8, true),
            sampleCount: view.getUint32(statsPointer + 12, true)
        };
        if (!buildFold) return result;
        return Object.assign(result, {
            foldPositions: copyWasmArray(Float32Array, foldPositionsPointer, vertexCount * 3),
            foldUvs: copyWasmArray(Float32Array, foldUvsPointer, vertexCount * 2),
            foldMapping: {
                mappedCenterX: view.getFloat64(foldMappingPointer, true),
                mappedCenterY: view.getFloat64(foldMappingPointer + 8, true),
                sourceCenter: view.getFloat64(foldMappingPointer + 16, true),
                scale: view.getFloat64(foldMappingPointer + 24, true)
            }
        });
    });
}

export function buildNativeGridFold(options, pointSets) {
    if (!Array.isArray(pointSets) || !pointSets.length) {
        throw new Error('Native grid-fold rendering requires at least one point set.');
    }
    const sourceXMin = requireFiniteNumber(options.sourceXRange?.[0], 'Native grid-fold source minimum');
    const sourceXMax = requireFiniteNumber(options.sourceXRange?.[1], 'Native grid-fold source maximum');
    const outputXMin = requireFiniteNumber(options.outputXRange?.[0], 'Native grid-fold output x minimum');
    const outputXMax = requireFiniteNumber(options.outputXRange?.[1], 'Native grid-fold output x maximum');
    const outputYMin = requireFiniteNumber(options.outputYRange?.[0], 'Native grid-fold output y minimum');
    const outputYMax = requireFiniteNumber(options.outputYRange?.[1], 'Native grid-fold output y maximum');
    const heightScale = requireFiniteNumber(options.heightScale, 'Native grid-fold height scale');
    if (sourceXMin >= sourceXMax || outputXMin >= outputXMax || outputYMin >= outputYMax || heightScale <= 0) {
        throw new Error('Native grid-fold ranges must increase and height scale must be positive.');
    }
    const offsets = new Uint32Array(pointSets.length + 1);
    let sourceCount = 0;
    pointSets.forEach((set, index) => {
        if (!Array.isArray(set?.points)) throw new Error(`Native grid-fold set ${index} requires points.`);
        if (set.color === undefined || set.color === null) {
            throw new Error(`Native grid-fold set ${index} requires a color.`);
        }
        offsets[index] = sourceCount;
        sourceCount += set.points.length;
    });
    offsets[pointSets.length] = sourceCount;
    if (!sourceCount) throw new Error('Native grid-fold rendering requires source points.');
    const lineCapacity = sourceCount + pointSets.length * 4096 + 8;
    const pointCapacity = sourceCount;
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, options.mapOptions, allocations);
        const sourcePointer = trackAlloc(allocations, sourceCount * 16);
        const offsetsPointer = trackAlloc(allocations, offsets.byteLength);
        const rolesPointer = trackAlloc(allocations, pointSets.length);
        const flattened = pointSets.flatMap(set => set.points);
        writePointBuffer(sourcePointer, flattened);
        new Uint32Array(wasm.memory.buffer, offsetsPointer, offsets.length).set(offsets);
        new Uint8Array(wasm.memory.buffer, rolesPointer, pointSets.length).set(
            pointSets.map(set => set?.role === 'grid-dots' ? 1 : 0)
        );
        const linePositionsPointer = trackAlloc(allocations, lineCapacity * 12);
        const lineOffsetsPointer = trackAlloc(allocations, (lineCapacity + 1) * 4);
        const lineSetsPointer = trackAlloc(allocations, (lineCapacity + 1) * 4);
        const pointPositionsPointer = trackAlloc(allocations, Math.max(1, pointCapacity) * 12);
        const pointOffsetsPointer = trackAlloc(allocations, (pointSets.length + 1) * 4);
        const pointSetsPointer = trackAlloc(allocations, (pointSets.length + 1) * 4);
        const statsPointer = trackAlloc(allocations, 16);
        const mappingPointer = trackAlloc(allocations, 32);
        const status = wasm.ce_build_grid_fold(
            configPointer, sourcePointer, offsetsPointer, rolesPointer, pointSets.length,
            sourceXMin, sourceXMax, outputXMin, outputXMax, outputYMin, outputYMax,
            heightScale,
            linePositionsPointer, lineCapacity, lineOffsetsPointer, lineSetsPointer,
            pointPositionsPointer, pointCapacity, pointOffsetsPointer, pointSetsPointer,
            statsPointer, mappingPointer
        );
        if (status !== 0) throw new Error(`Native grid fold failed with status ${status}.`);
        const view = memoryView();
        const lineCount = view.getUint32(statsPointer, true);
        const lineVertexCount = view.getUint32(statsPointer + 4, true);
        const pointGroupCount = view.getUint32(statsPointer + 8, true);
        const pointVertexCount = view.getUint32(statsPointer + 12, true);
        const linePositions = new Float32Array(wasm.memory.buffer, linePositionsPointer, lineVertexCount * 3);
        const pointPositions = new Float32Array(wasm.memory.buffer, pointPositionsPointer, pointVertexCount * 3);
        const readGroups = (count, offsetsAt, setsAt, positionsAt) => Array.from({ length: count }, (_, index) => {
            const start = view.getUint32(offsetsAt + index * 4, true);
            const end = view.getUint32(offsetsAt + (index + 1) * 4, true);
            const setIndex = view.getUint32(setsAt + index * 4, true);
            return {
                positions: new Float32Array(positionsAt.subarray(start * 3, end * 3)),
                color: pointSets[setIndex].color
            };
        });
        return {
            lines: readGroups(lineCount, lineOffsetsPointer, lineSetsPointer, linePositions),
            points: readGroups(pointGroupCount, pointOffsetsPointer, pointSetsPointer, pointPositions),
            mapping: {
                mappedCenterX: view.getFloat64(mappingPointer, true),
                mappedCenterY: view.getFloat64(mappingPointer + 8, true),
                sourceCenter: view.getFloat64(mappingPointer + 16, true),
                scale: view.getFloat64(mappingPointer + 24, true)
            }
        };
    });
}

export function buildNativeFoldPreimageMarkers(options, roots) {
    if (!Array.isArray(roots) || !roots.length) return new Float32Array();
    return withAllocations((allocations, allocate) => {
        const mapPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(mapPointer, options.mapOptions, allocations);
        const rootsPointer = trackAlloc(allocations, roots.length * 16);
        const positionsPointer = trackAlloc(allocations, roots.length * 12);
        writePointBuffer(rootsPointer, roots);
        const count = wasm.ce_build_fold_preimage_markers(
            mapPointer, rootsPointer, roots.length,
            Number(options.mapping.mappedCenterX), Number(options.mapping.mappedCenterY),
            Number(options.mapping.sourceCenter), Number(options.mapping.scale), Number(options.heightScale),
            positionsPointer
        );
        if (count < 0) throw new Error(`Native fold preimage geometry failed with status ${count}.`);
        return copyWasmArray(Float32Array, positionsPointer, count * 3);
    });
}

export function buildNativeRealSurface(options) {
    const segments = requireInteger(options.segments, 'Native real-surface segment count');
    if (segments < 1) throw new Error('Native real-surface segment count must be positive.');
    if (!Array.isArray(options.xRange) || !Array.isArray(options.yRange) ||
        options.xRange.length !== 2 || options.yRange.length !== 2) {
        throw new Error('Native real surface requires x and y ranges.');
    }
    const xMin = requireFiniteNumber(options.xRange[0], 'Native real-surface x minimum');
    const xMax = requireFiniteNumber(options.xRange[1], 'Native real-surface x maximum');
    const yMin = requireFiniteNumber(options.yRange[0], 'Native real-surface y minimum');
    const yMax = requireFiniteNumber(options.yRange[1], 'Native real-surface y maximum');
    if (xMin >= xMax || yMin >= yMax) throw new Error('Native real-surface ranges must increase.');
    const inputUPreset = requireInteger(options.inputUPreset, 'Native real-surface u input preset');
    const inputVPreset = requireInteger(options.inputVPreset, 'Native real-surface v input preset');
    const component = requireInteger(options.component, 'Native real-surface component');
    const heightScale = requireFiniteNumber(options.heightScale, 'Native real-surface height scale');
    if (inputUPreset < 0 || inputUPreset > 9 || inputVPreset < 0 || inputVPreset > 9 ||
        component < 0 || component > 2 || heightScale <= 0) {
        throw new Error('Native real-surface presets, component, or height scale are invalid.');
    }
    if ((inputUPreset === 0) !== Boolean(options.inputUProgram?.instructions?.length) ||
        (inputVPreset === 0) !== Boolean(options.inputVProgram?.instructions?.length)) {
        throw new Error('Generic native real-surface inputs require exactly one expression program.');
    }
    const stride = segments + 1;
    const vertexCount = stride * stride;
    const maxIndexCount = segments * segments * 6;
    const valuesOnly = options.valuesOnly === true;
    const palette = options.palette;
    if (!valuesOnly && (!(palette instanceof Float32Array) || palette.length < 6 || palette.length % 3 ||
        !palette.every(value => Number.isFinite(value) && value >= 0 && value <= 1))) {
        throw new Error('Native real surface requires a normalized RGB Float32 palette.');
    }
    return withAllocations((allocations, allocate) => {
        const configPointer = trackAlloc(allocations, MAP_CONFIG_SIZE);
        writeMapConfig(configPointer, options.mapOptions, allocations);
        const inputUPointer = writeInstructionBuffer(options.inputUProgram, allocations);
        const inputVPointer = writeInstructionBuffer(options.inputVProgram, allocations);
        const palettePointer = valuesOnly ? 0 : alloc(palette.byteLength);
        if (palettePointer) {
            allocations.push(palettePointer);
            new Float32Array(wasm.memory.buffer, palettePointer, palette.length).set(palette);
        }
        const positionsPointer = valuesOnly ? 0 : alloc(vertexCount * 12);
        const normalsPointer = valuesOnly ? 0 : alloc(vertexCount * 12);
        const colorsPointer = valuesOnly ? 0 : alloc(vertexCount * 12);
        const rawValuesPointer = valuesOnly ? 0 : alloc(vertexCount * 4);
        const phasesPointer = valuesOnly ? 0 : alloc(vertexCount * 4);
        const indicesPointer = valuesOnly ? 0 : alloc(maxIndexCount * 4);
        for (const pointer of [positionsPointer, normalsPointer, colorsPointer, rawValuesPointer,
            phasesPointer, indicesPointer]) if (pointer) allocations.push(pointer);
        const valuesPointer = trackAlloc(allocations, vertexCount * 8);
        const minimumPointer = trackAlloc(allocations, 8);
        const maximumPointer = trackAlloc(allocations, 8);
        const finitePointer = trackAlloc(allocations, 4);
        const indexCount = wasm.ce_build_real_surface(
            configPointer, xMin, xMax, yMin, yMax,
            segments,
            inputUPreset, inputUPointer, options.inputUProgram?.instructions?.length ?? 0,
            inputVPreset, inputVPointer, options.inputVProgram?.instructions?.length ?? 0,
            component, heightScale, options.phaseColor ? 1 : 0,
            palettePointer, valuesOnly ? 0 : palette.length / 3, valuesOnly ? 1 : 0,
            positionsPointer, normalsPointer, colorsPointer, rawValuesPointer,
            valuesPointer, phasesPointer, indicesPointer,
            minimumPointer, maximumPointer, finitePointer
        );
        if (indexCount < 0) throw new Error(`Native real surface failed with status ${indexCount}.`);
        const view = memoryView();
        const result = {
            segments, vertexCount,
            values: copyWasmArray(Float64Array, valuesPointer, vertexCount),
            minValue: view.getFloat64(minimumPointer, true),
            maxValue: view.getFloat64(maximumPointer, true),
            finiteResultCount: view.getUint32(finitePointer, true)
        };
        if (valuesOnly) return result;
        return Object.assign(result, {
            positions: copyWasmArray(Float32Array, positionsPointer, vertexCount * 3),
            normals: copyWasmArray(Float32Array, normalsPointer, vertexCount * 3),
            colors: copyWasmArray(Float32Array, colorsPointer, vertexCount * 3),
            rawValues: copyWasmArray(Float32Array, rawValuesPointer, vertexCount),
            phases: copyWasmArray(Float32Array, phasesPointer, vertexCount),
            indices: copyWasmArray(Uint32Array, indicesPointer, indexCount)
        });
    });
}

export function renderNativeRealContour(options) {
    const grid = options.scalarGrid;
    const gridEnabled = Boolean(grid);
    const width = requireInteger(options.width, 'Native real-contour width');
    const height = requireInteger(options.height, 'Native real-contour height');
    if (width < 1 || height < 1 || width * height > 0x3fffffff) {
        throw new Error('Native real-contour rendering requires positive integer dimensions.');
    }
    const values = grid?.values;
    const colors = grid?.colors;
    const sourceWidth = gridEnabled ? requireInteger(grid.sourceWidth, 'Native real-contour source width') : 0;
    const sourceHeight = gridEnabled ? requireInteger(grid.sourceHeight, 'Native real-contour source height') : 0;
    if (gridEnabled && (!(values instanceof Float32Array) || !(colors instanceof Float32Array) ||
        sourceWidth < 2 || sourceHeight < 2 || values.length !== sourceWidth * sourceHeight ||
        colors.length !== values.length * 3)) {
        throw new Error('Native real-contour scalar grid dimensions are inconsistent.');
    }
    let xMin = 0; let xMax = 1; let yMin = 0; let yMax = 1;
    let inputUPreset = 3; let inputVPreset = 3; let component = 0;
    if (!gridEnabled) {
        if (!Array.isArray(options.xRange) || !Array.isArray(options.yRange) ||
            options.xRange.length !== 2 || options.yRange.length !== 2) {
            throw new Error('Native real-contour rendering requires x and y ranges.');
        }
        xMin = requireFiniteNumber(options.xRange[0], 'Native real-contour x minimum');
        xMax = requireFiniteNumber(options.xRange[1], 'Native real-contour x maximum');
        yMin = requireFiniteNumber(options.yRange[0], 'Native real-contour y minimum');
        yMax = requireFiniteNumber(options.yRange[1], 'Native real-contour y maximum');
        inputUPreset = requireInteger(options.inputUPreset, 'Native real-contour u input preset');
        inputVPreset = requireInteger(options.inputVPreset, 'Native real-contour v input preset');
        component = requireInteger(options.component, 'Native real-contour component');
        if (xMin >= xMax || yMin >= yMax || inputUPreset < 0 || inputUPreset > 9 ||
            inputVPreset < 0 || inputVPreset > 9 || component < 0 || component > 2 ||
            (inputUPreset === 0) !== Boolean(options.inputUProgram?.instructions?.length) ||
            (inputVPreset === 0) !== Boolean(options.inputVProgram?.instructions?.length)) {
            throw new Error('Native real-contour inputs are invalid.');
        }
    }
    if (typeof options.contoursEnabled !== 'boolean') {
        throw new Error('Native real-contour rendering requires an explicit contoursEnabled flag.');
    }
    const contourInterval = requireFiniteNumber(options.contourInterval, 'Native real-contour interval');
    const contourThickness = requireFiniteNumber(options.contourThickness, 'Native real-contour thickness');
    if (contourInterval <= 0 || contourThickness <= 0) {
        throw new Error('Native real-contour interval and thickness must be positive.');
    }
    const palette = gridEnabled ? null : options.palette;
    if (!gridEnabled && (!(palette instanceof Float32Array) || palette.length < 6 || palette.length % 3 ||
        !palette.every(value => Number.isFinite(value) && value >= 0 && value <= 1))) {
        throw new Error('Native real-contour rendering requires a normalized RGB Float32 palette.');
    }

    return withAllocations((allocations, allocate) => {
        const configPointer = gridEnabled ? 0 : alloc(MAP_CONFIG_SIZE);
        if (configPointer) {
            allocations.push(configPointer);
            writeMapConfig(configPointer, options.mapOptions, allocations);
        }
        const inputUPointer = gridEnabled ? 0 : writeInstructionBuffer(options.inputUProgram, allocations);
        const inputVPointer = gridEnabled ? 0 : writeInstructionBuffer(options.inputVProgram, allocations);
        const palettePointer = gridEnabled ? 0 : alloc(palette.byteLength);
        if (palettePointer) {
            allocations.push(palettePointer);
            new Float32Array(wasm.memory.buffer, palettePointer, palette.length).set(palette);
        }
        const valuesPointer = gridEnabled ? alloc(values.byteLength) : 0;
        const colorsPointer = gridEnabled ? alloc(colors.byteLength) : 0;
        if (valuesPointer) allocations.push(valuesPointer);
        if (colorsPointer) allocations.push(colorsPointer);
        if (gridEnabled) {
            new Float32Array(wasm.memory.buffer, valuesPointer, values.length).set(values);
            new Float32Array(wasm.memory.buffer, colorsPointer, colors.length).set(colors);
        }
        const outputLength = width * height * 4;
        const outputPointer = trackAlloc(allocations, outputLength);
        const status = wasm.ce_render_real_contour(
            configPointer, xMin, xMax, yMin, yMax, width, height,
            inputUPreset, inputUPointer, options.inputUProgram?.instructions?.length ?? 0,
            inputVPreset, inputVPointer, options.inputVProgram?.instructions?.length ?? 0,
            component, options.contoursEnabled ? 1 : 0, contourInterval, contourThickness,
            palettePointer, gridEnabled ? 0 : palette.length / 3,
            valuesPointer, colorsPointer, sourceWidth, sourceHeight, outputPointer
        );
        if (status !== 0) throw new Error(`Native real-contour rendering failed with status ${status}.`);
        return copyWasmArray(Uint8ClampedArray, outputPointer, outputLength);
    });
}
