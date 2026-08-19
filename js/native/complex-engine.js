import { collectExpressionDependencies, parseExpression } from '../math/expression/parser.js';

const wasmUrl = new URL('../../native/build/complex_engine.wasm', import.meta.url);

async function loadBytes() {
    if (wasmUrl.protocol === 'file:') {
        const { readFile } = await import('node:fs/promises');
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

if (wasm.ce_abi_version() !== 1) {
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
    reciprocal: 7,
    sinh: 8,
    cosh: 9,
    tanh: 10,
    asin: 11,
    atan: 12,
    gamma: 13,
    loggamma: 14,
    bessel: 15,
    power: 16,
    mobius: 17,
    zeta: 18,
    polynomial: 19,
    poincare: 20,
    algebraic_chaining: 21,
    identity: 22
});

const MAP_CONFIG_SIZE = 272;
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
const FUNCTION_STEPS_PTR = FUNCTION_CONFIG_OFFSET + 168;
const FUNCTION_STEPS_COUNT = FUNCTION_CONFIG_OFFSET + 172;
const MAP_TAYLOR_PTR = 192;
const MAP_TAYLOR_COUNT = 196;
const MAP_TAYLOR_CENTER = 200;
const MAP_TAYLOR_RADIUS_SQ = 216;
const MAP_USE_TAYLOR = 224;
const MAP_DYNAMIC_POINT_PTR = 232;
const MAP_DYNAMIC_POINT_COUNT = 236;
const MAP_DYNAMIC_TERM_PTR = 240;
const MAP_DYNAMIC_TERM_COUNT = 244;
const MAP_DYNAMIC_VARIABLES_PTR = 248;
const MAP_DYNAMIC_FLAGS_PTR = 252;
const MAP_DYNAMIC_VARIABLE_COUNT = 256;
const MAP_DYNAMIC_SOURCE_COUNT = 260;
const MAP_DYNAMIC_REDUCTION = 264;
const MAP_DYNAMIC_INVALID_POLICY = 268;

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

const EXPRESSION_ERROR_MESSAGES = Object.freeze({
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

function parseNativeExpression(source) {
    if (!source || source === 'z') return [];
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
                emit(EXPRESSION_OPS.constant, 0, Number(node.value?.re ?? node.value ?? 0), Number(node.value?.im ?? 0));
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
                if (node.args?.length !== 1) throw new Error(`Native function ${node.name} requires one argument here.`);
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
    const variables = Array.from(variableNames || []);
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
                else emit(GENERIC_EXPRESSION_OPS.constant, 0,
                    Number(node.value?.re ?? node.value ?? 0), Number(node.value?.im ?? 0));
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
    if (!aggregate || !Array.isArray(aggregate.sourceRecords)) return null;
    const pointSource = String(aggregate.pointExpression ?? 'd');
    const termSource = aggregate.term?.kind === 'selected-function'
        ? 'selected(z)'
        : String(aggregate.term?.expression ?? 'z');
    const pointAst = parseExpression(pointSource);
    const termAst = parseExpression(termSource);
    const names = new Set([
        ...collectExpressionDependencies(pointAst).variables,
        ...collectExpressionDependencies(termAst).variables
    ]);
    const variableNames = Array.from(names);
    const pointProgram = compileNativeExpressionProgram(pointAst, variableNames);
    const termProgram = compileNativeExpressionProgram(termAst, variableNames);
    const bindings = new Map((aggregate.bindings || []).map(binding => [binding?.symbol, binding]));
    const bindingSeries = aggregate.bindingSeries || {};
    const parameters = aggregate.parameters || {};
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
        if (name === 'j') return { re: Number(record.ordinal) || 0, im: 0 };
        if (name === 's' || name === 'c' || name === 'z') return { re: 0, im: 0 };
        if (Object.prototype.hasOwnProperty.call(parameters, name)) return parameters[name];
        return bindingSeries[name]?.[index] || { re: NaN, im: NaN };
    }));
    return {
        pointProgram,
        termProgram,
        variableNames,
        variableFlags,
        variables,
        reduction: aggregate.reductionKind === 'sum' ? 1 : aggregate.reductionKind === 'product' ? 2 : 0,
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
    const terms = Array.isArray(options.algebraicChainingTerms) ? options.algebraicChainingTerms : [];
    const packedTerms = [];
    const packedFactors = [];
    const packedSteps = [];
    for (const term of terms) {
        const factorOffset = packedFactors.length;
        for (const factor of term?.factors || []) {
            if (!factor || factor.func === 'none') break;
            const pipeline = Array.isArray(factor.chain) ? factor.chain :
                Array.isArray(factor.pipeline) ? factor.pipeline : null;
            const stepOffset = packedSteps.length;
            if (pipeline) {
                for (const step of pipeline) packedSteps.push(functionIdFor(typeof step === 'string' ? step : step?.func));
            }
            packedFactors.push({
                functionId: functionIdFor(factor.func),
                chainedId: factor.chainedFunc && factor.chainedFunc !== 'none' ? functionIdFor(factor.chainedFunc) : -1,
                flags: (factor.reciprocal ? 1 : 0) | (factor.log ? 2 : 0) | (factor.exp ? 4 : 0),
                power: Number(factor.power ?? 1), stepOffset, stepCount: pipeline?.length || 0
            });
        }
        packedTerms.push({ coefficient: term?.coeff || { re: 1, im: 0 }, factorOffset,
            factorCount: packedFactors.length - factorOffset });
    }

    if (packedTerms.length) {
        const termsPointer = alloc(packedTerms.length * 24); allocations.push(termsPointer);
        const termsView = memoryView();
        packedTerms.forEach((term, index) => {
            const at = termsPointer + index * 24;
            writeComplex(termsView, at, term.coefficient, 1, 0);
            termsView.setUint32(at + 16, term.factorOffset, true);
            termsView.setUint32(at + 20, term.factorCount, true);
        });
        view.setUint32(pointer + FUNCTION_TERMS_PTR, termsPointer, true);
        view.setUint32(pointer + FUNCTION_TERMS_COUNT, packedTerms.length, true);
    }
    if (packedFactors.length) {
        const factorsPointer = alloc(packedFactors.length * 32); allocations.push(factorsPointer);
        const factorsView = memoryView();
        packedFactors.forEach((factor, index) => {
            const at = factorsPointer + index * 32;
            factorsView.setUint32(at, factor.functionId, true);
            factorsView.setInt32(at + 4, factor.chainedId, true);
            factorsView.setUint32(at + 8, factor.flags, true);
            factorsView.setUint32(at + 12, factor.stepOffset, true);
            factorsView.setFloat64(at + 16, factor.power, true);
            factorsView.setUint32(at + 24, factor.stepCount, true);
            factorsView.setUint32(at + 28, 0, true);
        });
        view.setUint32(pointer + FUNCTION_FACTORS_PTR, factorsPointer, true);
        view.setUint32(pointer + FUNCTION_FACTORS_COUNT, packedFactors.length, true);
    }
    if (packedSteps.length) {
        const stepsPointer = alloc(packedSteps.length * 4); allocations.push(stepsPointer);
        const stepsView = memoryView();
        packedSteps.forEach((step, index) => stepsView.setUint32(stepsPointer + index * 4, step, true));
        view.setUint32(pointer + FUNCTION_STEPS_PTR, stepsPointer, true);
        view.setUint32(pointer + FUNCTION_STEPS_COUNT, packedSteps.length, true);
    }
    const instructions = options.algebraicExpressionAst
        ? compileNativeExpression(options.algebraicExpressionAst)
        : parseNativeExpression(options.algebraicChainingZExpr);
    if (instructions.length) {
        const expressionPointer = alloc(instructions.length * 24); allocations.push(expressionPointer);
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

function complexParts(value, fallbackRe = 0, fallbackIm = 0) {
    const re = Number(value?.re ?? value?.real ?? fallbackRe);
    const im = Number(value?.im ?? value?.imag ?? fallbackIm);
    return [Number.isFinite(re) ? re : fallbackRe, Number.isFinite(im) ? im : fallbackIm];
}

function alloc(size) {
    const pointer = wasm.ce_alloc(size);
    if (!pointer) throw new Error(`Native complex engine could not allocate ${size} bytes.`);
    return pointer;
}

function memoryView() {
    return new DataView(wasm.memory.buffer);
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function writeCString(value, allocations) {
    const bytes = textEncoder.encode(String(value));
    const pointer = alloc(bytes.length + 1);
    allocations.push(pointer);
    const target = new Uint8Array(wasm.memory.buffer, pointer, bytes.length + 1);
    target.set(bytes);
    target[bytes.length] = 0;
    return pointer;
}

function readCString(pointer, capacity) {
    const bytes = new Uint8Array(wasm.memory.buffer, pointer, capacity);
    const end = bytes.indexOf(0);
    if (end < 0) throw new Error('Native precision result was not terminated.');
    return textDecoder.decode(bytes.subarray(0, end));
}

function writeComplex(view, offset, value, fallbackRe = 0, fallbackIm = 0) {
    const [re, im] = complexParts(value, fallbackRe, fallbackIm);
    view.setFloat64(offset, re, true);
    view.setFloat64(offset + 8, im, true);
}

function writeInstructionBuffer(program, allocations) {
    const instructions = program?.instructions || [];
    if (!instructions.length) return 0;
    const pointer = alloc(instructions.length * 24);
    allocations.push(pointer);
    const view = memoryView();
    instructions.forEach((instruction, index) => {
        const offset = pointer + index * 24;
        view.setUint32(offset, instruction.opcode, true);
        view.setUint32(offset + 4, instruction.argument || 0, true);
        view.setFloat64(offset + 8, instruction.re || 0, true);
        view.setFloat64(offset + 16, instruction.im || 0, true);
    });
    return pointer;
}

function writeDynamicConfig(view, pointer, rawAggregate, allocations) {
    if (!rawAggregate) return;
    const dynamic = rawAggregate.native || rawAggregate.pointProgram
        ? (rawAggregate.native || rawAggregate)
        : compileNativeDynamicAggregate(rawAggregate);
    if (!dynamic?.pointProgram?.instructions?.length || !dynamic?.termProgram?.instructions?.length ||
        !dynamic.variables?.length || !dynamic.variableNames?.length) {
        throw new Error('Native dynamic aggregate is incomplete.');
    }
    const pointPointer = writeInstructionBuffer(dynamic.pointProgram, allocations);
    const termPointer = writeInstructionBuffer(dynamic.termProgram, allocations);
    const variableCount = dynamic.variableNames.length;
    const sourceCount = dynamic.variables.length;
    const variablesPointer = alloc(sourceCount * variableCount * 16); allocations.push(variablesPointer);
    const variablesView = memoryView();
    dynamic.variables.forEach((row, source) => row.forEach((value, slot) => writeComplex(
        variablesView, variablesPointer + (source * variableCount + slot) * 16, value, NaN, NaN
    )));
    const flagsPointer = alloc(variableCount); allocations.push(flagsPointer);
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
    const view = memoryView();
    new Uint8Array(wasm.memory.buffer, pointer, MAP_CONFIG_SIZE).fill(0);
    const functionKey = options.functionKey || 'sin';
    const functionId = NATIVE_FUNCTION_IDS[functionKey];
    if (functionId === undefined) throw new Error(`Unsupported native function: ${functionKey}`);
    view.setUint32(pointer, functionId, true);
    const chainCount = options.chainingEnabled === false
        ? 1
        : Math.max(1, Math.min(512, Math.floor(Number(options.chainCount) || 1)));
    view.setUint32(pointer + 4, chainCount, true);
    view.setUint32(pointer + 8, options.chainMode === 'zero_seed' ? 1 : 0, true);
    view.setUint32(pointer + 12, Math.max(0, Math.min(2, Math.floor(
        Number(options.derivativeOrder ?? (options.derivativeMode ? 1 : 0))
    ))), true);

    let offset = FUNCTION_CONFIG_OFFSET;
    writeComplex(view, pointer + offset, options.expBase, Math.E, 0); offset += 16;
    writeComplex(view, pointer + offset, options.logBase, Math.E, 0); offset += 16;
    writeComplex(view, pointer + offset, options.besselOrder, 0, 0); offset += 16;
    writeComplex(view, pointer + offset, options.mobiusA, 1, 0); offset += 16;
    writeComplex(view, pointer + offset, options.mobiusB); offset += 16;
    writeComplex(view, pointer + offset, options.mobiusC); offset += 16;
    writeComplex(view, pointer + offset, options.mobiusD, 1, 0);

    const requestedDegree = Math.max(0, Math.min(10, Math.floor(Number(options.polynomialN) || 0)));
    const coefficients = Array.isArray(options.polynomialCoeffs)
        ? options.polynomialCoeffs.slice(0, requestedDegree + 1)
        : [];
    while (coefficients.length < requestedDegree + 1) coefficients.push({ re: 0, im: 0 });
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
    view.setFloat64(pointer + FUNCTION_FRACTIONAL_POWER, Number(options.fractionalPowerN ?? 0.5), true);
    view.setFloat64(pointer + FUNCTION_BRANCH_ANGLE, Number(options.branchCutAngle ?? Math.PI), true);
    view.setUint32(pointer + FUNCTION_BRANCH_RAY, options.branchCutType === 'ray' ? 1 : 0, true);
    view.setUint32(pointer + FUNCTION_ZETA_CONTINUATION, options.zetaContinuationEnabled ? 1 : 0, true);
    if (functionKey === 'algebraic_chaining') writeAlgebraicConfig(view, pointer, options, allocations);
    const taylor = options.taylor || (options.taylorEnabled ? {
        coefficients: options.taylorCoefficients,
        center: options.taylorCenter,
        radius: options.taylorRadius
    } : null);
    if (taylor) {
        const coefficients = Array.isArray(taylor.coefficients) ? taylor.coefficients : [];
        if (!coefficients.length) throw new Error('Native Taylor map requires coefficients.');
        const coefficientPointer = alloc(coefficients.length * 16);
        allocations.push(coefficientPointer);
        const coefficientView = memoryView();
        coefficients.forEach((coefficient, index) => writeComplex(
            coefficientView, coefficientPointer + index * 16, coefficient, NaN, NaN
        ));
        const configView = memoryView();
        configView.setUint32(pointer + MAP_TAYLOR_PTR, coefficientPointer, true);
        configView.setUint32(pointer + MAP_TAYLOR_COUNT, coefficients.length, true);
        writeComplex(configView, pointer + MAP_TAYLOR_CENTER, taylor.center);
        const radius = Number(taylor.radius);
        configView.setFloat64(pointer + MAP_TAYLOR_RADIUS_SQ,
            Number.isFinite(radius) ? radius * radius : Infinity, true);
        configView.setUint32(pointer + MAP_USE_TAYLOR, 1, true);
    }
    writeDynamicConfig(view, pointer, options.dynamicAggregate || options.dynamic, allocations);
}

function writePointBuffer(pointer, points) {
    const view = memoryView();
    points.forEach((point, index) => writeComplex(view, pointer + index * 16, point));
}

export function evaluateNativeExpressionProgram(program, environments, mapOptions, settled = false) {
    if (!program?.instructions?.length || !Array.isArray(environments) || !environments.length) return [];
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, mapOptions, allocations);
        const instructionPointer = alloc(program.instructions.length * 24); allocations.push(instructionPointer);
        const instructionView = memoryView();
        program.instructions.forEach((instruction, index) => {
            const offset = instructionPointer + index * 24;
            instructionView.setUint32(offset, instruction.opcode, true);
            instructionView.setUint32(offset + 4, instruction.argument || 0, true);
            instructionView.setFloat64(offset + 8, instruction.re || 0, true);
            instructionView.setFloat64(offset + 16, instruction.im || 0, true);
        });
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
        const outputPointer = alloc(environments.length * 16); allocations.push(outputPointer);
        const errorPointer = alloc(environments.length); allocations.push(errorPointer);
        const sheetsPointer = alloc(environments.length * 4); allocations.push(sheetsPointer);
        const sheetsView = memoryView();
        environments.forEach((environment, index) => {
            sheetsView.setInt32(sheetsPointer + index * 4, Math.trunc(Number(environment.__sheet) || 0), true);
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
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
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
    const requestedCount = Math.max(0, Math.floor(Number(config.count) || 0));
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

    const parameterEntries = Object.entries(runtime.parameters || {});
    let generatorProgram = null;
    let predicateProgram = null;
    if (config.kind === 'expression') {
        generatorProgram = compileNativeExpressionProgram(
            parseExpression(String(config.generatorExpression ?? 'j')),
            ['j', ...parameterEntries.map(([name]) => name)]
        );
        const predicateSource = String(config.filterExpression || '').trim();
        if (predicateSource) {
            predicateProgram = compileNativeExpressionProgram(
                parseExpression(predicateSource),
                ['d', 'j', ...parameterEntries.map(([name]) => name)]
            );
        }
    }

    const allocations = [];
    try {
        const outputPointer = alloc(requestedCount * 16); allocations.push(outputPointer);
        const statsPointer = alloc(12); allocations.push(statsPointer);
        const generatorPointer = writeInstructionBuffer(generatorProgram, allocations);
        const predicatePointer = writeInstructionBuffer(predicateProgram, allocations);
        let parametersPointer = 0;
        if (parameterEntries.length) {
            parametersPointer = alloc(parameterEntries.length * 16); allocations.push(parametersPointer);
            const parameterView = memoryView();
            parameterEntries.forEach(([, value], index) => writeComplex(
                parameterView, parametersPointer + index * 16, value, NaN, NaN
            ));
        }
        const maxAttempts = Math.max(requestedCount, Math.floor(Number(config.maxAttempts) || requestedCount));
        let errorsPointer = 0;
        if (config.kind === 'expression') {
            errorsPointer = alloc(maxAttempts); allocations.push(errorsPointer);
            new Uint8Array(wasm.memory.buffer, errorsPointer, maxAttempts).fill(0);
        }
        const status = wasm.ce_generate_discrete_values(
            kind, requestedCount,
            Number(config.start), Number(config.step), Number(config.ratio),
            Number(config.min), Number(config.max), Math.max(1, Math.floor(Number(config.bound) || 1)),
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
        const values = Array.from({ length: count }, (_, index) => ({
            re: view.getFloat64(outputPointer + index * 16, true),
            im: view.getFloat64(outputPointer + index * 16 + 8, true)
        }));
        const attemptErrors = errorsPointer
            ? new Uint8Array(new Uint8Array(wasm.memory.buffer, errorsPointer, attempts))
            : new Uint8Array();
        return { values, attempts, invalidCount, attemptErrors };
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function evaluateNativePoints(options, points) {
    if (!Array.isArray(points) || !points.length) return { values: [], valid: new Uint8Array() };
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, options, allocations);
        const inputPointer = alloc(points.length * 16); allocations.push(inputPointer);
        const outputPointer = alloc(points.length * 16); allocations.push(outputPointer);
        const validPointer = alloc(points.length); allocations.push(validPointer);
        writePointBuffer(inputPointer, points);
        const status = wasm.ce_evaluate_points(configPointer, inputPointer, points.length, outputPointer, validPointer);
        if (status !== 0) throw new Error(`Native point evaluation failed with status ${status}.`);
        const view = memoryView();
        const valid = new Uint8Array(points.length);
        valid.set(new Uint8Array(wasm.memory.buffer, validPointer, points.length));
        const values = new Array(points.length);
        for (let index = 0; index < points.length; index += 1) {
            values[index] = {
                re: view.getFloat64(outputPointer + index * 16, true),
                im: view.getFloat64(outputPointer + index * 16 + 8, true)
            };
        }
        return { values, valid };
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function evaluateNativeAlgebraic(options, points, parameters = points) {
    if (!Array.isArray(points) || !points.length || parameters.length !== points.length) {
        return { values: [], valid: new Uint8Array() };
    }
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, { ...options, functionKey: 'algebraic_chaining' }, allocations);
        const inputPointer = alloc(points.length * 16); allocations.push(inputPointer);
        const parameterPointer = alloc(points.length * 16); allocations.push(parameterPointer);
        const outputPointer = alloc(points.length * 16); allocations.push(outputPointer);
        const validPointer = alloc(points.length); allocations.push(validPointer);
        writePointBuffer(inputPointer, points);
        writePointBuffer(parameterPointer, parameters);
        const status = wasm.ce_evaluate_algebraic_points(
            configPointer, inputPointer, parameterPointer, points.length, outputPointer, validPointer
        );
        if (status !== 0) throw new Error(`Native algebraic evaluation failed with status ${status}.`);
        const view = memoryView();
        const valid = new Uint8Array(new Uint8Array(wasm.memory.buffer, validPointer, points.length));
        const values = new Array(points.length);
        for (let index = 0; index < points.length; index += 1) {
            values[index] = {
                re: view.getFloat64(outputPointer + index * 16, true),
                im: view.getFloat64(outputPointer + index * 16 + 8, true)
            };
        }
        return { values, valid };
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function evaluateNativeSheets(options, points, sheets) {
    if (!Array.isArray(points) || !points.length || !Array.isArray(sheets) || sheets.length !== points.length) {
        return { values: [], valid: new Uint8Array() };
    }
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, options, allocations);
        const inputPointer = alloc(points.length * 16); allocations.push(inputPointer);
        const sheetsPointer = alloc(points.length * 4); allocations.push(sheetsPointer);
        const outputPointer = alloc(points.length * 16); allocations.push(outputPointer);
        const validPointer = alloc(points.length); allocations.push(validPointer);
        writePointBuffer(inputPointer, points);
        const sheetView = memoryView();
        sheets.forEach((sheet, index) => sheetView.setInt32(
            sheetsPointer + index * 4, Math.round(Number(sheet) || 0), true
        ));
        const status = wasm.ce_evaluate_sheets(
            configPointer, inputPointer, sheetsPointer, points.length, outputPointer, validPointer
        );
        if (status !== 0) throw new Error(`Native sheet evaluation failed with status ${status}.`);
        const view = memoryView();
        const valid = new Uint8Array(new Uint8Array(wasm.memory.buffer, validPointer, points.length));
        const values = Array.from({ length: points.length }, (_, index) => ({
            re: view.getFloat64(outputPointer + index * 16, true),
            im: view.getFloat64(outputPointer + index * 16 + 8, true)
        }));
        return { values, valid };
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function evaluateNativeDynamic(mapOptions, aggregate, parameter) {
    const dynamic = aggregate?.native || aggregate?.pointProgram
        ? (aggregate.native || aggregate)
        : compileNativeDynamicAggregate(aggregate);
    if (!dynamic?.variables?.length) {
        return {
            pointValues: [], termValues: [], errors: new Uint8Array(),
            reductionStatus: new Uint8Array(), partialValues: [],
            finalValue: dynamic?.reduction === 2 ? { re: 1, im: 0 } : { re: 0, im: 0 },
            product: null, valid: true
        };
    }
    const count = dynamic.variables.length;
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, { ...mapOptions, dynamic }, allocations);
        const pointPointer = alloc(count * 16); allocations.push(pointPointer);
        const termPointer = alloc(count * 16); allocations.push(termPointer);
        const errorsPointer = alloc(count); allocations.push(errorsPointer);
        const statusPointer = alloc(count); allocations.push(statusPointer);
        const partialPointer = alloc(count * 16); allocations.push(partialPointer);
        const partialProductPointer = alloc(count * 48); allocations.push(partialProductPointer);
        const finalPointer = alloc(16); allocations.push(finalPointer);
        const productPointer = alloc(48); allocations.push(productPointer);
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
            errors: new Uint8Array(new Uint8Array(wasm.memory.buffer, errorsPointer, count)),
            reductionStatus: new Uint8Array(new Uint8Array(wasm.memory.buffer, statusPointer, count)),
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
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function continuationNativeSheet(path, branchCutType, branchCutAngle, branchCutPoints = []) {
    if (!Array.isArray(path) || path.length < 2) return 0;
    const allocations = [];
    try {
        const pathPointer = alloc(path.length * 16); allocations.push(pathPointer);
        writePointBuffer(pathPointer, path);
        const drawn = branchCutType === 'draw';
        let cutPointer = 0;
        if (drawn) {
            if (!Array.isArray(branchCutPoints) || branchCutPoints.length < 2) return 0;
            cutPointer = alloc(branchCutPoints.length * 16); allocations.push(cutPointer);
            writePointBuffer(cutPointer, branchCutPoints);
        }
        return wasm.ce_continuation_sheets(
            pathPointer, path.length, drawn ? 1 : 0, Number(branchCutAngle ?? Math.PI),
            cutPointer, drawn ? branchCutPoints.length : 0
        );
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function evaluateNativeFunction(functionKey, re, im, options = {}) {
    const result = evaluateNativePoints({ ...options, functionKey, chainCount: 1 }, [{ re, im }]);
    return result.valid[0] ? result.values[0] : result.values[0];
}

export function evaluateNativePower(base, exponent) {
    const allocations = [];
    try {
        const basePointer = alloc(16); allocations.push(basePointer);
        const exponentPointer = alloc(16); allocations.push(exponentPointer);
        const outputPointer = alloc(16); allocations.push(outputPointer);
        const view = memoryView();
        writeComplex(view, basePointer, base);
        writeComplex(view, exponentPointer, exponent);
        const status = wasm.ce_pow_points(basePointer, exponentPointer, 1, outputPointer);
        if (status !== 0) throw new Error(`Native complex power failed with status ${status}.`);
        const resultView = memoryView();
        return {
            re: resultView.getFloat64(outputPointer, true),
            im: resultView.getFloat64(outputPointer + 8, true)
        };
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function evaluateNativeZetaSeries(value, algorithm, workCount) {
    const allocations = [];
    try {
        const inputPointer = alloc(16); allocations.push(inputPointer);
        const outputPointer = alloc(16); allocations.push(outputPointer);
        writeComplex(memoryView(), inputPointer, value);
        const algorithmId = ({ direct: 0, eta: 1, hasse: 2 })[algorithm];
        if (algorithmId === undefined) throw new Error(`Unsupported native zeta algorithm: ${algorithm}`);
        const status = wasm.ce_zeta_points(inputPointer, 1, algorithmId, Math.max(1, Math.floor(workCount)), outputPointer);
        if (status !== 0) throw new Error(`Native zeta series failed with status ${status}.`);
        const view = memoryView();
        return { re: view.getFloat64(outputPointer, true), im: view.getFloat64(outputPointer + 8, true) };
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function computeNativeTaylorCoefficients(map, center, radius, order) {
    const boundedOrder = Math.max(0, Math.min(128, Math.floor(order)));
    const stepCount = Math.max(192, 48 * (boundedOrder + 1));
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, { ...map, taylorEnabled: false }, allocations);
        const outputPointer = alloc((boundedOrder + 1) * 16); allocations.push(outputPointer);
        const status = wasm.ce_compute_taylor_coefficients(
            configPointer, center.re, center.im, radius, stepCount, boundedOrder, outputPointer
        );
        if (status !== 0) return null;
        const view = memoryView();
        return Array.from({ length: boundedOrder + 1 }, (_, index) => ({
            re: view.getFloat64(outputPointer + index * 16, true),
            im: view.getFloat64(outputPointer + index * 16 + 8, true)
        }));
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function mapNativePlanarGeometry(options, points) {
    return evaluateNativePoints(options, points);
}

export function nativeMapOptions(runtimeState, overrides = {}) {
    const stage = Number.isFinite(overrides.stage) ? Math.max(0, Math.floor(overrides.stage)) : null;
    return {
        functionKey: overrides.functionKey || runtimeState.currentFunction,
        chainCount: stage === null
            ? (runtimeState.chainingEnabled ? runtimeState.chainCount : 1)
            : (runtimeState.chainingEnabled ? stage + 1 : 1),
        chainingEnabled: runtimeState.chainingEnabled,
        chainMode: runtimeState.chainingMode,
        derivativeMode: overrides.derivativeMode ?? runtimeState.mapPresentation === 'derivative',
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
        ...overrides
    };
}

function writeBranchCutPoints(points, allocations) {
    if (!Array.isArray(points) || points.length < 2) return { pointer: 0, count: 0 };
    const pointer = alloc(points.length * 16);
    allocations.push(pointer);
    writePointBuffer(pointer, points);
    return { pointer, count: points.length };
}

function readComplexBuffer(pointer, count) {
    const view = memoryView();
    const result = new Float64Array(count * 2);
    for (let index = 0; index < count; index += 1) {
        result[index * 2] = view.getFloat64(pointer + index * 16, true);
        result[index * 2 + 1] = view.getFloat64(pointer + index * 16 + 8, true);
    }
    return result;
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
    const density = Math.max(1, Math.floor(Number(config.gridDensity) || 1));
    const curvePoints = Math.max(2, Math.floor(Number(config.curvePoints) || 2));
    let shape = NATIVE_INPUT_SHAPES[config.currentInputShape];
    let expressionProgram = null;
    const drawPoints = [];
    if (config.currentInputShape === 'arbitrary') {
        if (config.arbitraryShapeMode === 'draw') {
            shape = 6;
            for (const point of config.arbitraryShapePoints || []) {
                drawPoints.push(point && Number.isFinite(point.re) && Number.isFinite(point.im)
                    ? point : { re: NaN, im: NaN });
            }
        } else {
            shape = 5;
            const source = String(config.arbitraryShapeExpression || '').trim();
            if (!source) return [];
            expressionProgram = compileNativeExpressionProgram(parseExpression(source), ['t']);
        }
    }
    if (shape === undefined) return [];

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
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, mapOptions, allocations);
        const expressionPointer = writeInstructionBuffer(expressionProgram, allocations);
        let drawPointer = 0;
        if (drawPoints.length) {
            drawPointer = alloc(drawPoints.length * 16); allocations.push(drawPointer);
            const drawView = memoryView();
            drawPoints.forEach((point, index) => writeComplex(
                drawView, drawPointer + index * 16, point, NaN, NaN
            ));
        }
        const outputPointer = alloc(pointCapacity * 16); allocations.push(outputPointer);
        const offsetsPointer = alloc((lineCapacity + 1) * 4); allocations.push(offsetsPointer);
        const rolesPointer = alloc(lineCapacity * 4); allocations.push(rolesPointer);
        const statsPointer = alloc(8); allocations.push(statsPointer);
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
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function generateNativeViewportGridPixels(config) {
    const shape = config.currentInputShape === 'grid_cartesian' ? 0
        : config.currentInputShape === 'grid_dots' ? 4 : -1;
    if (shape < 0) return [];
    const density = Math.max(1, Math.floor(Number(config.gridDensity) || 1));
    const curvePoints = Math.max(2, Math.floor(Number(config.curvePoints) || 2));
    const samples = Math.max(2, Math.floor(curvePoints / 2));
    const lineCapacity = shape === 0 ? 2 * (density + 1) : 1;
    const pointCapacity = shape === 0
        ? lineCapacity * (samples + 1)
        : (density + 1) * (density + 1);
    const allocations = [];
    try {
        const outputPointer = alloc(pointCapacity * 8); allocations.push(outputPointer);
        const offsetsPointer = alloc((lineCapacity + 1) * 4); allocations.push(offsetsPointer);
        const rolesPointer = alloc(lineCapacity * 4); allocations.push(rolesPointer);
        const statsPointer = alloc(8); allocations.push(statsPointer);
        const status = wasm.ce_generate_viewport_grid_pixels(
            shape, density, curvePoints,
            Math.max(1, Math.floor(Number(config.preciseViewport?.width))),
            Math.max(1, Math.floor(Number(config.preciseViewport?.height))),
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
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function generateNativeRadialSteps(mapOptions, domain, stepCount, curvePoints) {
    const steps = Math.max(0, Math.floor(Number(stepCount) || 0));
    if (steps < 2) return [];
    const pointsPerCircle = Math.max(24, Math.floor(Number(curvePoints) || 24)) + 1;
    const pointCapacity = steps * pointsPerCircle;
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, mapOptions, allocations);
        const outputPointer = alloc(pointCapacity * 16); allocations.push(outputPointer);
        const offsetsPointer = alloc((steps + 1) * 4); allocations.push(offsetsPointer);
        const statsPointer = alloc(8); allocations.push(statsPointer);
        const status = wasm.ce_generate_radial_steps(
            configPointer, Number(domain.min), Number(domain.max), steps, pointsPerCircle - 1,
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
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function buildNativePlanarLine(options) {
    const sampleCount = Math.max(1, Math.floor(options.sampleCount));
    const outputCapacity = (sampleCount + 1) * 2 + 2;
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, options.map, allocations);
        const cut = writeBranchCutPoints(options.branchCutPoints, allocations);
        const outputPointer = alloc(outputCapacity * 16); allocations.push(outputPointer);
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
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function buildNativePlanarLines(options) {
    if (!Array.isArray(options.lines) || !options.lines.length) return [];
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, options.map, allocations);
        const lineCount = options.lines.length;
        const startsPointer = alloc(lineCount * 16); allocations.push(startsPointer);
        const endsPointer = alloc(lineCount * 16); allocations.push(endsPointer);
        const countsPointer = alloc(lineCount * 4); allocations.push(countsPointer);
        const offsetsPointer = alloc((lineCount + 1) * 4); allocations.push(offsetsPointer);
        const lineView = memoryView();
        let outputCapacity = 0;
        options.lines.forEach((line, index) => {
            const sampleCount = Math.max(1, Math.floor(line.sampleCount));
            writeComplex(lineView, startsPointer + index * 16, line.start);
            writeComplex(lineView, endsPointer + index * 16, line.end);
            lineView.setUint32(countsPointer + index * 4, sampleCount, true);
            outputCapacity += (sampleCount + 1) * 2 + 2;
        });
        const cut = writeBranchCutPoints(options.branchCutPoints, allocations);
        const outputPointer = alloc(outputCapacity * 16); allocations.push(outputPointer);
        const total = wasm.ce_build_planar_lines(
            configPointer, startsPointer, endsPointer, countsPointer, lineCount,
            options.scaleX, options.scaleY, options.renderLimit,
            options.jumpThresholdSq, options.toleranceSq,
            options.hasBranchCuts ? 1 : 0, options.branchCutType === 'draw' ? 1 : 0,
            options.branchCutAngle, cut.pointer, cut.count,
            outputPointer, outputCapacity, offsetsPointer
        );
        if (total < 0) throw new Error(`Native planar lines job failed with status ${total}.`);
        const offsets = new Uint32Array(new Uint32Array(wasm.memory.buffer, offsetsPointer, lineCount + 1));
        const packed = readComplexBuffer(outputPointer, total);
        return options.lines.map((_line, index) => packed.slice(offsets[index] * 2, offsets[index + 1] * 2));
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function buildNativePlanarPolyline(options) {
    if (!Array.isArray(options.points) || !options.points.length) return new Float64Array();
    const maxDepth = Math.max(0, Math.min(20, Math.floor(options.maxDepth)));
    const theoretical = options.points.length * 2 ** Math.min(maxDepth, 12);
    const outputCapacity = Math.min(1_000_000, Math.max(4096, theoretical));
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, options.map, allocations);
        const inputPointer = alloc(options.points.length * 16); allocations.push(inputPointer);
        const inputView = memoryView();
        options.points.forEach((point, index) => {
            const offset = inputPointer + index * 16;
            inputView.setFloat64(offset, Number.isFinite(point?.re) ? point.re : NaN, true);
            inputView.setFloat64(offset + 8, Number.isFinite(point?.im) ? point.im : NaN, true);
        });
        const cut = writeBranchCutPoints(options.branchCutPoints, allocations);
        const outputPointer = alloc(outputCapacity * 16); allocations.push(outputPointer);
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
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function traceNativeStreamlines(options) {
    const seeds = Array.isArray(options.seeds) ? options.seeds : [];
    const maxSteps = Math.max(0, Math.min(10000, Math.floor(options.maxSteps)));
    if (!seeds.length || !maxSteps) return seeds.map(() => []);
    const capacity = seeds.length * maxSteps;
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, options.map, allocations);
        const seedsPointer = alloc(seeds.length * 16); allocations.push(seedsPointer);
        writePointBuffer(seedsPointer, seeds.map(seed => ({ re: seed.x ?? seed.re, im: seed.y ?? seed.im })));
        const positionsPointer = alloc(capacity * 16); allocations.push(positionsPointer);
        const magnitudesPointer = alloc(capacity * 8); allocations.push(magnitudesPointer);
        const offsetsPointer = alloc((seeds.length + 1) * 4); allocations.push(offsetsPointer);
        const xRange = options.xRange;
        const yRange = options.yRange;
        const count = wasm.ce_trace_streamlines(
            configPointer, seedsPointer, seeds.length,
            xRange[0], xRange[1], yRange[0], yRange[1], options.stepSize,
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
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function buildNativeVectorField(options) {
    const density = Math.max(1, Math.min(256, Math.floor(options.density)));
    const count = (density + 1) ** 2;
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, options.map, allocations);
        const positionsPointer = alloc(count * 16); allocations.push(positionsPointer);
        const vectorsPointer = alloc(count * 16); allocations.push(vectorsPointer);
        const magnitudesPointer = alloc(count * 8); allocations.push(magnitudesPointer);
        const validPointer = alloc(count); allocations.push(validPointer);
        const status = wasm.ce_build_vector_field(
            configPointer, options.xRange[0], options.xRange[1], options.yRange[0], options.yRange[1],
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
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function buildNativeTissot(options) {
    const density = Math.max(1, Math.floor(options.density));
    const segments = Math.max(3, Math.floor(options.segments));
    const columns = Math.max(4, Math.min(10, Math.round(density * 0.48)));
    const capacity = (columns - 1) ** 2;
    const circlePoints = segments + 1;
    const allocations = [];
    const allocate = size => { const pointer = alloc(size); allocations.push(pointer); return pointer; };
    try {
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
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function findNativePreimages(options) {
    const density = Math.max(8, Math.min(64, Math.floor(options.density || 18)));
    const capacity = Math.max(16, (density + 1) ** 2);
    const span = Math.max(options.xRange[1] - options.xRange[0], options.yRange[1] - options.yRange[0], 1e-6);
    const tolerance = options.tolerance ?? Math.max(1e-8, span * 2e-6);
    const derivativeStep = options.derivativeStep ?? Math.max(1e-7, span * 2e-6);
    const mergeDistance = options.mergeDistance ?? Math.max(tolerance * 12, span / (density * 120));
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, options.map, allocations);
        const rootsPointer = alloc(capacity * 16); allocations.push(rootsPointer);
        const count = wasm.ce_find_preimages(
            configPointer, options.target.re, options.target.im,
            options.xRange[0], options.xRange[1], options.yRange[0], options.yRange[1],
            density, Math.max(1, Math.floor(options.maxIterations || 28)),
            tolerance, derivativeStep, mergeDistance, options.inverseOutput ? 1 : 0,
            rootsPointer, capacity
        );
        if (count < 0) throw new Error(`Native preimage job failed with status ${count}.`);
        const view = memoryView();
        return Array.from({ length: count }, (_, index) => ({
            re: view.getFloat64(rootsPointer + index * 16, true),
            im: view.getFloat64(rootsPointer + index * 16 + 8, true)
        }));
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function findNativePolynomialRoots(coefficients, options = {}) {
    if (!Array.isArray(coefficients) || coefficients.length < 2) return [];
    const allocations = [];
    try {
        const coefficientsPointer = alloc(coefficients.length * 16); allocations.push(coefficientsPointer);
        writePointBuffer(coefficientsPointer, coefficients.map(value => typeof value === 'number' ? { re: value, im: 0 } : value));
        const rootsPointer = alloc((coefficients.length - 1) * 16); allocations.push(rootsPointer);
        const count = wasm.ce_find_polynomial_roots(
            coefficientsPointer, coefficients.length,
            Math.max(1, Math.floor(options.maxIterations || 1000)),
            Number(options.tolerance) || 1e-7, rootsPointer
        );
        if (count < 0) throw new Error(`Native polynomial-root job failed with status ${count}.`);
        const view = memoryView();
        return Array.from({ length: count }, (_, index) => ({
            re: view.getFloat64(rootsPointer + index * 16, true),
            im: view.getFloat64(rootsPointer + index * 16 + 8, true)
        }));
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function analyzeNativeContour(map, points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, map, allocations);
        const pointsPointer = alloc(points.length * 16); allocations.push(pointsPointer);
        const pointsView = memoryView();
        points.forEach((point, index) => {
            pointsView.setFloat64(pointsPointer + index * 16, Number.isFinite(point?.re) ? point.re : NaN, true);
            pointsView.setFloat64(pointsPointer + index * 16 + 8, Number.isFinite(point?.im) ? point.im : NaN, true);
        });
        const integralPointer = alloc(16); allocations.push(integralPointer);
        const windingPointer = alloc(8); allocations.push(windingPointer);
        const statusPointer = alloc(4); allocations.push(statusPointer);
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
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function estimateNativeResidue(map, pole, radius, samples) {
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, map, allocations);
        const outputPointer = alloc(16); allocations.push(outputPointer);
        const status = wasm.ce_estimate_residue(
            configPointer, pole.re, pole.im, radius, Math.max(8, Math.floor(samples)), outputPointer
        );
        if (status !== 0) return { re: NaN, im: NaN };
        const view = memoryView();
        return { re: view.getFloat64(outputPointer, true), im: view.getFloat64(outputPointer + 8, true) };
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function generateNativeContourPoints(type, params, stepCount) {
    const count = Math.max(1, Math.floor(stepCount));
    const typeId = type === 'circle' ? 1 : (type === 'ellipse' ? 2 : 0);
    if (!typeId) return [];
    const paramA = typeId === 1 ? Number(params.r) : Number(params.a);
    const paramB = typeId === 1 ? 0 : Number(params.b);
    const allocations = [];
    try {
        const outputPointer = alloc((count + 1) * 16); allocations.push(outputPointer);
        const total = wasm.ce_generate_contour_points(
            typeId, Number(params.cx) || 0, Number(params.cy) || 0, paramA, paramB, count, outputPointer
        );
        if (total < 0) return [];
        const view = memoryView();
        return Array.from({ length: total }, (_, index) => ({
            re: view.getFloat64(outputPointer + index * 16, true),
            im: view.getFloat64(outputPointer + index * 16 + 8, true)
        }));
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function classifyNativeContourSingularities(contourType, params, polygonContours, epsilon, singularities) {
    if (!Array.isArray(singularities) || !singularities.length) return [];
    const typeId = contourType === 'circle' ? 1 : (contourType === 'ellipse' ? 2 : (contourType === 'contour' || contourType === 'contours' ? 3 : 0));
    const cx = Number(params?.cx) || 0;
    const cy = Number(params?.cy) || 0;
    const paramA = typeId === 1 ? Number(params?.r) || 0 : Number(params?.a) || 0;
    const paramB = typeId === 2 ? Number(params?.b) || 0 : 0;
    const allocations = [];
    try {
        let polygonPointsPointer = 0;
        let polygonOffsetsPointer = 0;
        let polygonCount = 0;
        if (typeId === 3 && Array.isArray(polygonContours) && polygonContours.length) {
            polygonCount = polygonContours.length;
            const totalPoints = polygonContours.reduce((sum, points) => sum + (Array.isArray(points) ? points.length : 0), 0);
            polygonPointsPointer = alloc(totalPoints * 16); allocations.push(polygonPointsPointer);
            polygonOffsetsPointer = alloc((polygonCount + 1) * 4); allocations.push(polygonOffsetsPointer);
            const view = memoryView();
            let currentOffset = 0;
            polygonContours.forEach((points, pIndex) => {
                view.setUint32(polygonOffsetsPointer + pIndex * 4, currentOffset, true);
                if (Array.isArray(points)) {
                    points.forEach(point => {
                        view.setFloat64(polygonPointsPointer + currentOffset * 16, Number(point?.re) || 0, true);
                        view.setFloat64(polygonPointsPointer + currentOffset * 16 + 8, Number(point?.im) || 0, true);
                        currentOffset += 1;
                    });
                }
            });
            view.setUint32(polygonOffsetsPointer + polygonCount * 4, currentOffset, true);
        }

        const singPointer = alloc(singularities.length * 16); allocations.push(singPointer);
        const insidePointer = alloc(singularities.length); allocations.push(insidePointer);
        const safePointer = alloc(singularities.length); allocations.push(safePointer);
        const singView = memoryView();
        singularities.forEach((sing, index) => {
            singView.setFloat64(singPointer + index * 16, Number.isFinite(sing?.re) ? sing.re : NaN, true);
            singView.setFloat64(singPointer + index * 16 + 8, Number.isFinite(sing?.im) ? sing.im : NaN, true);
        });

        const status = wasm.ce_classify_contour_singularities(
            typeId, cx, cy, paramA, paramB,
            polygonPointsPointer, polygonOffsetsPointer, polygonCount,
            Number(epsilon) || 0, singPointer, singularities.length,
            insidePointer, safePointer
        );
        if (status !== 0) throw new Error(`Native singularity classification failed with status ${status}.`);
        const insideBuf = new Uint8Array(wasm.memory.buffer, insidePointer, singularities.length);
        const safeBuf = new Uint8Array(wasm.memory.buffer, safePointer, singularities.length);
        return Array.from({ length: singularities.length }, (_, index) => ({
            inside: insideBuf[index] !== 0,
            safeForResidue: safeBuf[index] !== 0
        }));
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function createCompiledDomainTileRenderer(snapshot) {
    const allocations = [];
    const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
    writeMapConfig(configPointer, snapshot, allocations);
    const palette = Array.isArray(snapshot.paletteStops) && snapshot.paletteStops.length >= 2
        ? snapshot.paletteStops
        : [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0]];
    const paletteRgPointer = alloc(palette.length * 16); allocations.push(paletteRgPointer);
    const paletteBPointer = alloc(palette.length * 8); allocations.push(paletteBPointer);
    const paletteView = memoryView();
    palette.forEach((stop, index) => {
        paletteView.setFloat64(paletteRgPointer + index * 16, Number(stop?.[0]) || 0, true);
        paletteView.setFloat64(paletteRgPointer + index * 16 + 8, Number(stop?.[1]) || 0, true);
        paletteView.setFloat64(paletteBPointer + index * 8, Number(stop?.[2]) || 0, true);
    });

    const viewport = snapshot.viewport;
    const orbitMode = ({ value: 0, escape: 1, attractor: 2, hybrid: 3 })[snapshot.orbitColoringMode] ?? 0;
    const style = snapshot.style || {};
    const precise = typeof viewport.centerRe === 'string' && typeof viewport.centerIm === 'string' &&
        Number.isFinite(viewport.zoomPower) && Number.isInteger(viewport.precisionBits);

    let xMin, xMax, yMin, yMax;
    if (precise) {
        const span = 7.0 * (10 ** -Number(viewport.zoomPower));
        const aspect = (Number(viewport.width) || 1) / (Number(viewport.height) || 1);
        const xSpan = aspect >= 1 ? span * aspect : span;
        const ySpan = aspect >= 1 ? span : span / aspect;
        const cRe = Number(viewport.centerRe) || 0;
        const cIm = Number(viewport.centerIm) || 0;
        xMin = cRe - xSpan * 0.5;
        xMax = cRe + xSpan * 0.5;
        yMin = cIm - ySpan * 0.5;
        yMax = cIm + ySpan * 0.5;
    } else {
        xMin = viewport.xRange[0];
        xMax = viewport.xRange[1];
        yMin = viewport.yRange[0];
        yMax = viewport.yRange[1];
    }
    let outputCapacity = 0;
    let outputPointer = 0;

    const render = tile => {
        const outputLength = tile.width * tile.height * 4;
        if (outputLength > outputCapacity) {
            if (outputPointer) wasm.ce_free(outputPointer);
            outputCapacity = Math.max(outputLength, 256 * 256 * 4);
            outputPointer = alloc(outputCapacity);
        }
        const status = wasm.ce_render_domain_tile(
            configPointer,
            xMin, xMax, yMin, yMax,
            viewport.width, viewport.height,
            tile.x, tile.y, tile.width, tile.height, tile.scale,
            orbitMode, paletteRgPointer, paletteBPointer, palette.length,
            Number(style.brightness) || 1, Number(style.contrast) || 1,
            Number(style.saturation) || 1, Number(style.lightnessCycles) || 0,
            tile.qualityOnly ? 1 : 0, outputPointer
        );
        if (status !== 0) throw new Error(`Native domain tile failed with status ${status}.`);
        const result = new Uint8ClampedArray(outputLength);
        result.set(new Uint8Array(wasm.memory.buffer, outputPointer, outputLength));
        return result;
    };

    render.dispose = () => {
        if (outputPointer) wasm.ce_free(outputPointer);
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    };

    return render;
}

export function renderNativeDomainTile(snapshot, tile) {
    const renderer = createCompiledDomainTileRenderer(snapshot);
    try {
        return renderer(tile);
    } finally {
        renderer.dispose();
    }
}

export function precisePixelCoordinate(viewport, pixelX, pixelY) {
    const width = Math.max(1, Math.floor(Number(viewport?.width)));
    const height = Math.max(1, Math.floor(Number(viewport?.height)));
    const precisionBits = Math.max(128, Math.min(4096, Math.floor(Number(viewport?.precisionBits) || 512)));
    const zoomPower = Number(viewport?.zoomPower);
    if (!Number.isFinite(zoomPower) || !Number.isFinite(pixelX) || !Number.isFinite(pixelY)) {
        throw new Error('Precise pixel coordinates require finite pixel and zoom values.');
    }
    const allocations = [];
    try {
        const centerRePointer = writeCString(viewport.centerRe, allocations);
        const centerImPointer = writeCString(viewport.centerIm, allocations);
        const capacity = Math.ceil(precisionBits * Math.LOG10E * Math.LN2) + 64;
        const realPointer = alloc(capacity); allocations.push(realPointer);
        const imaginaryPointer = alloc(capacity); allocations.push(imaginaryPointer);
        const status = wasm.ce_precise_pixel_coordinate(
            centerRePointer, centerImPointer, zoomPower, precisionBits,
            width, height, Number(pixelX), Number(pixelY),
            realPointer, capacity, imaginaryPointer, capacity
        );
        if (status !== 0) throw new Error(`Native precise coordinate job failed with status ${status}.`);
        return {
            re: readCString(realPointer, capacity),
            im: readCString(imaginaryPointer, capacity)
        };
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

function preciseViewportArguments(viewport) {
    const width = Math.max(1, Math.floor(Number(viewport?.width)));
    const height = Math.max(1, Math.floor(Number(viewport?.height)));
    const zoomPower = Number(viewport?.zoomPower);
    const precisionBits = Math.max(128, Math.min(4096, Math.floor(Number(viewport?.precisionBits) || 512)));
    if (typeof viewport?.centerRe !== 'string' || typeof viewport?.centerIm !== 'string' ||
        !Number.isFinite(zoomPower)) throw new Error('Native precise geometry requires a precise viewport.');
    return { width, height, zoomPower, precisionBits };
}

export function projectNativePrecisePixels(options, pixels) {
    const input = preciseViewportArguments(options.inputViewport);
    const output = preciseViewportArguments(options.outputViewport);
    const packed = pixels instanceof Float32Array
        ? pixels
        : new Float32Array((pixels || []).flatMap(point => [Number(point?.x), Number(point?.y)]));
    if (packed.length % 2) throw new Error('Native precise pixel geometry requires x/y pairs.');
    const pointCount = packed.length / 2;
    if (!pointCount) return new Float32Array();
    const allocations = [];
    try {
        const mapPointer = sphereMapPointer(options, allocations);
        const inputRePointer = writeCString(options.inputViewport.centerRe, allocations);
        const inputImPointer = writeCString(options.inputViewport.centerIm, allocations);
        const outputRePointer = writeCString(options.outputViewport.centerRe, allocations);
        const outputImPointer = writeCString(options.outputViewport.centerIm, allocations);
        const pixelsPointer = alloc(packed.byteLength); allocations.push(pixelsPointer);
        const resultPointer = alloc(packed.byteLength); allocations.push(resultPointer);
        const validPointer = alloc(pointCount); allocations.push(validPointer);
        new Float32Array(wasm.memory.buffer, pixelsPointer, packed.length).set(packed);
        const status = wasm.ce_project_precise_pixels(
            mapPointer, inputRePointer, inputImPointer, input.zoomPower, input.precisionBits,
            input.width, input.height, pixelsPointer, pointCount, options.mapPoints ? 1 : 0,
            outputRePointer, outputImPointer, output.zoomPower, output.width, output.height,
            resultPointer, validPointer
        );
        if (status !== 0) throw new Error(`Native precise pixel geometry failed with status ${status}.`);
        return new Float32Array(new Float32Array(wasm.memory.buffer, resultPointer, packed.length));
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function projectNativePrecisePixelsToCanvas(options, pixels) {
    const input = preciseViewportArguments(options.inputViewport);
    const packed = pixels instanceof Float32Array
        ? pixels
        : new Float32Array((pixels || []).flatMap(point => [Number(point?.x), Number(point?.y)]));
    if (packed.length % 2) throw new Error('Native precise canvas geometry requires x/y pairs.');
    const pointCount = packed.length / 2;
    if (!pointCount) return new Float32Array();
    const allocations = [];
    try {
        const mapPointer = sphereMapPointer(options, allocations);
        const inputRePointer = writeCString(options.inputViewport.centerRe, allocations);
        const inputImPointer = writeCString(options.inputViewport.centerIm, allocations);
        const pixelsPointer = alloc(packed.byteLength); allocations.push(pixelsPointer);
        const resultPointer = alloc(packed.byteLength); allocations.push(resultPointer);
        const validPointer = alloc(pointCount); allocations.push(validPointer);
        new Float32Array(wasm.memory.buffer, pixelsPointer, packed.length).set(packed);
        const status = wasm.ce_project_precise_pixels_to_canvas(
            mapPointer, inputRePointer, inputImPointer, input.zoomPower, input.precisionBits,
            input.width, input.height, pixelsPointer, pointCount, options.mapPoints ? 1 : 0,
            Number(options.outputOrigin?.x), Number(options.outputOrigin?.y),
            Number(options.outputScale?.x), Number(options.outputScale?.y),
            resultPointer, validPointer
        );
        if (status !== 0) throw new Error(`Native precise-to-canvas geometry failed with status ${status}.`);
        return new Float32Array(new Float32Array(wasm.memory.buffer, resultPointer, packed.length));
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function projectNativeValuesToPrecise(options, points) {
    if (!Array.isArray(points) || !points.length) return new Float32Array();
    const output = preciseViewportArguments(options.outputViewport);
    const allocations = [];
    try {
        const mapPointer = sphereMapPointer(options, allocations);
        const outputRePointer = writeCString(options.outputViewport.centerRe, allocations);
        const outputImPointer = writeCString(options.outputViewport.centerIm, allocations);
        const pointsPointer = alloc(points.length * 16); allocations.push(pointsPointer);
        const resultPointer = alloc(points.length * 8); allocations.push(resultPointer);
        const validPointer = alloc(points.length); allocations.push(validPointer);
        const view = memoryView();
        points.forEach((point, index) => writeComplex(view, pointsPointer + index * 16, point, NaN, NaN));
        const status = wasm.ce_project_values_to_precise(
            mapPointer, pointsPointer, points.length, options.mapPoints ? 1 : 0,
            outputRePointer, outputImPointer, output.zoomPower, output.precisionBits,
            output.width, output.height, resultPointer, validPointer
        );
        if (status !== 0) throw new Error(`Native precise value geometry failed with status ${status}.`);
        return new Float32Array(new Float32Array(wasm.memory.buffer, resultPointer, points.length * 2));
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

const FOURIER_SIGNAL_TYPES = Object.freeze({
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

export function generateNativeFourierSignal(funcType, frequency, amplitude, timeWindow, sampleCount, randomSeed = 0) {
    const samples = Math.max(1, Math.floor(sampleCount));
    const signalType = FOURIER_SIGNAL_TYPES[funcType] ?? 0;
    const window = Number(timeWindow) > 0 ? Number(timeWindow) : 1;
    const allocations = [];
    try {
        const timesPointer = alloc(samples * 8); allocations.push(timesPointer);
        const valuesPointer = alloc(samples * 8); allocations.push(valuesPointer);
        const status = wasm.ce_generate_fourier_signal(
            signalType, Number(frequency) || 0, Number(amplitude) || 0,
            window, samples, randomSeed || 0,
            timesPointer, valuesPointer
        );
        if (status !== 0) throw new Error(`Native Fourier signal generation failed with status ${status}.`);
        const timesBuf = new Float64Array(wasm.memory.buffer, timesPointer, samples);
        const valuesBuf = new Float64Array(wasm.memory.buffer, valuesPointer, samples);
        return Array.from({ length: samples }, (_, index) => ({
            t: timesBuf[index],
            value: valuesBuf[index]
        }));
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function computeNativeFourierSpectrum(values) {
    if (!Array.isArray(values) || !values.length) return [];
    const count = values.length;
    const allocations = [];
    try {
        const valuesPointer = alloc(count * 8); allocations.push(valuesPointer);
        const freqPointer = alloc(count * 8); allocations.push(freqPointer);
        const realPointer = alloc(count * 8); allocations.push(realPointer);
        const imagPointer = alloc(count * 8); allocations.push(imagPointer);
        const magPointer = alloc(count * 8); allocations.push(magPointer);
        const phasePointer = alloc(count * 8); allocations.push(phasePointer);

        const valBuf = new Float64Array(wasm.memory.buffer, valuesPointer, count);
        for (let i = 0; i < count; i++) {
            valBuf[i] = Number(values[i]) || 0;
        }

        const status = wasm.ce_compute_fourier_spectrum(
            valuesPointer, count, freqPointer, realPointer, imagPointer, magPointer, phasePointer
        );
        if (status !== 0) throw new Error(`Native Fourier spectrum failed with status ${status}.`);

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
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function buildNativeFourierWinding(signal, frequency, progress = 1, timeWindow = 1) {
    if (!Array.isArray(signal) || !signal.length) {
        return {
            points: [],
            centerOfMass: { re: 0, im: 0 },
            referenceRadius: 1,
            vectorStep: 1
        };
    }
    const count = signal.length;
    const allocations = [];
    try {
        const timesPointer = alloc(count * 8); allocations.push(timesPointer);
        const valuesPointer = alloc(count * 8); allocations.push(valuesPointer);
        const woundPointer = alloc(count * 16); allocations.push(woundPointer);
        const centerPointer = alloc(16); allocations.push(centerPointer);
        const maxAmpPointer = alloc(8); allocations.push(maxAmpPointer);

        const timeBuf = new Float64Array(wasm.memory.buffer, timesPointer, count);
        const valBuf = new Float64Array(wasm.memory.buffer, valuesPointer, count);
        signal.forEach((sample, index) => {
            timeBuf[index] = Number(sample?.t) || 0;
            valBuf[index] = Number(sample?.value) || 0;
        });

        const visible = wasm.ce_build_fourier_winding(
            timesPointer, valuesPointer, count, Number(frequency) || 0,
            Number(progress) ?? 1, Number(timeWindow) || 1,
            woundPointer, centerPointer, maxAmpPointer
        );
        if (visible < 0) throw new Error(`Native Fourier winding failed with status ${visible}.`);

        const view = memoryView();
        const maxAmplitude = view.getFloat64(maxAmpPointer, true);
        const centerOfMass = {
            re: view.getFloat64(centerPointer, true),
            im: view.getFloat64(centerPointer + 8, true)
        };

        const points = Array.from({ length: visible }, (_, index) => ({
            t: timeBuf[index],
            value: valBuf[index],
            re: view.getFloat64(woundPointer + index * 16, true),
            im: view.getFloat64(woundPointer + index * 16 + 8, true)
        }));

        return {
            points,
            centerOfMass,
            referenceRadius: Math.max(Number.EPSILON, maxAmplitude * 1.1),
            vectorStep: Math.max(1, Math.floor(points.length / 50))
        };
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export const NATIVE_LAPLACE_FUNCTION_IDS = Object.freeze({
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
    const sampleCount = Math.max(1, Math.floor(options.sampleCount));
    const allocations = [];
    try {
        const timesPointer = alloc(sampleCount * 8); allocations.push(timesPointer);
        const signalPointer = alloc(sampleCount * 8); allocations.push(signalPointer);
        const polesPointer = alloc(2 * 16); allocations.push(polesPointer);
        const poleOrdersPointer = alloc(2 * 4); allocations.push(poleOrdersPointer);
        const zerosPointer = alloc(2 * 16); allocations.push(zerosPointer);
        const poleCountPointer = alloc(4); allocations.push(poleCountPointer);
        const zeroCountPointer = alloc(4); allocations.push(zeroCountPointer);
        const rocPointer = alloc(8); allocations.push(rocPointer);
        const status = wasm.ce_generate_laplace_analysis(
            laplaceFunctionId(options.functionKey), Number(options.frequency),
            Number(options.damping), Number(options.amplitude), Number(options.timeWindow),
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
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function evaluateNativeLaplace(options, sigma, omega) {
    const allocations = [];
    try {
        const outputPointer = alloc(16); allocations.push(outputPointer);
        const status = wasm.ce_evaluate_laplace(
            laplaceFunctionId(options.functionKey), Number(sigma), Number(omega),
            Number(options.frequency), Number(options.damping), Number(options.amplitude), outputPointer
        );
        if (status !== 0) throw new Error(`Native Laplace evaluation failed with status ${status}.`);
        const view = memoryView();
        const real = view.getFloat64(outputPointer, true);
        const imag = view.getFloat64(outputPointer + 8, true);
        return { real, imag, magnitude: Math.hypot(real, imag), phase: Math.atan2(imag, real) };
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function buildNativeLaplaceSurface(specification, options) {
    const sigmaSteps = Math.max(1, Math.floor(specification.sigmaSteps));
    const omegaSteps = Math.max(1, Math.floor(specification.omegaSteps));
    const vertexCount = (sigmaSteps + 1) * (omegaSteps + 1);
    const indexCapacity = sigmaSteps * omegaSteps * 6;
    const mode = options.mode === 'phase' ? 1 : options.mode === 'combined' ? 2 : 0;
    const allocations = [];
    try {
        const positionsPointer = alloc(vertexCount * 12); allocations.push(positionsPointer);
        const normalsPointer = alloc(vertexCount * 12); allocations.push(normalsPointer);
        const colorsPointer = alloc(vertexCount * 12); allocations.push(colorsPointer);
        const indicesPointer = alloc(indexCapacity * 4); allocations.push(indicesPointer);
        const indexCount = wasm.ce_build_laplace_surface(
            laplaceFunctionId(specification.functionKey), Number(specification.frequency),
            Number(specification.damping), Number(specification.amplitude),
            specification.sigmaRange[0], specification.sigmaRange[1],
            specification.omegaRange[0], specification.omegaRange[1],
            sigmaSteps, omegaSteps, mode, Math.max(0.001, Number(options.clipHeight)),
            positionsPointer, normalsPointer, colorsPointer, indicesPointer
        );
        if (indexCount < 0) throw new Error(`Native Laplace surface failed with status ${indexCount}.`);
        return {
            positions: new Float32Array(new Float32Array(wasm.memory.buffer, positionsPointer, vertexCount * 3)),
            normals: new Float32Array(new Float32Array(wasm.memory.buffer, normalsPointer, vertexCount * 3)),
            colors: new Float32Array(new Float32Array(wasm.memory.buffer, colorsPointer, vertexCount * 3)),
            indices: new Uint32Array(new Uint32Array(wasm.memory.buffer, indicesPointer, indexCount)),
            minSigma: specification.sigmaRange[0],
            maxSigma: specification.sigmaRange[1],
            minOmega: specification.omegaRange[0],
            maxOmega: specification.omegaRange[1]
        };
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function buildNativeImageMesh(options) {
    const baseResolution = Math.max(1, Math.floor(options.baseResolution ?? 16));
    const maxDepth = Math.max(0, Math.floor(options.maxDepth ?? 5));
    const maxCells = Math.max(1, Math.min(16383, Math.floor(options.maxCells ?? 8192)));
    const maxVertices = Math.max(1, Math.min(65535, Math.floor(options.maxVertices ?? 32768)));
    const maxSamples = Math.max(1, Math.floor(options.maxSamples ?? 65536));
    const indexCapacity = maxCells * 24;
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, options.mapOptions || options, allocations);
        const texturePointer = alloc(maxVertices * 8); allocations.push(texturePointer);
        const mappedPointer = alloc(maxVertices * 8); allocations.push(mappedPointer);
        const indicesPointer = alloc(indexCapacity * 2); allocations.push(indicesPointer);
        const statsPointer = alloc(16); allocations.push(statsPointer);
        const buildFold = options.buildFold === true;
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
                Number(options.sourceCenter?.re), Number(options.sourceCenter?.im),
                Number(options.sourceSize?.width), Number(options.sourceSize?.height),
                centerRePointer, centerImPointer, viewport.zoomPower, viewport.precisionBits,
                Math.max(1, Math.floor(options.pixelWidth || viewport.width)),
                Math.max(1, Math.floor(options.pixelHeight || viewport.height)),
                baseResolution, maxDepth, maxCells, maxVertices, maxSamples,
                texturePointer, mappedPointer, indicesPointer, indexCapacity, statsPointer
            );
        } else {
            status = wasm.ce_build_image_mesh(
                configPointer,
                Number(options.sourceCenter?.re), Number(options.sourceCenter?.im),
                Number(options.sourceSize?.width), Number(options.sourceSize?.height),
                options.bounds.x0, options.bounds.x1, options.bounds.y0, options.bounds.y1,
                Math.max(1, Math.floor(options.pixelWidth || 1024)),
                Math.max(1, Math.floor(options.pixelHeight || 1024)),
                baseResolution, maxDepth, maxCells, maxVertices, maxSamples,
                texturePointer, mappedPointer, indicesPointer, indexCapacity, statsPointer,
                buildFold ? 1 : 0, Number(options.foldHeightScale ?? 1),
                foldPositionsPointer, foldUvsPointer, foldMappingPointer
            );
        }
        if (status !== 0) throw new Error(`Native image mesh failed with status ${status}.`);
        const view = memoryView();
        const vertexCount = view.getUint32(statsPointer, true);
        const indexCount = view.getUint32(statsPointer + 4, true);
        const result = {
            vertices: new Float32Array(new Float32Array(wasm.memory.buffer, texturePointer, vertexCount * 2)),
            mappedPositions: new Float32Array(new Float32Array(wasm.memory.buffer, mappedPointer, vertexCount * 2)),
            indices: new Uint16Array(new Uint16Array(wasm.memory.buffer, indicesPointer, indexCount)),
            cellCount: view.getUint32(statsPointer + 8, true),
            sampleCount: view.getUint32(statsPointer + 12, true)
        };
        if (!buildFold) return result;
        return Object.assign(result, {
            foldPositions: new Float32Array(new Float32Array(
                wasm.memory.buffer, foldPositionsPointer, vertexCount * 3
            )),
            foldUvs: new Float32Array(new Float32Array(wasm.memory.buffer, foldUvsPointer, vertexCount * 2)),
            foldMapping: {
                mappedCenterX: view.getFloat64(foldMappingPointer, true),
                mappedCenterY: view.getFloat64(foldMappingPointer + 8, true),
                sourceCenter: view.getFloat64(foldMappingPointer + 16, true),
                scale: view.getFloat64(foldMappingPointer + 24, true)
            }
        });
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function buildNativeGridFold(options, pointSets) {
    if (!Array.isArray(pointSets) || !pointSets.length) return { lines: [], points: [] };
    const offsets = new Uint32Array(pointSets.length + 1);
    let sourceCount = 0;
    pointSets.forEach((set, index) => {
        offsets[index] = sourceCount;
        sourceCount += Array.isArray(set?.points) ? set.points.length : 0;
    });
    offsets[pointSets.length] = sourceCount;
    if (!sourceCount) return { lines: [], points: [] };
    const lineCapacity = sourceCount + pointSets.length * 4096 + 8;
    const pointCapacity = sourceCount;
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, options.mapOptions || options, allocations);
        const sourcePointer = alloc(sourceCount * 16); allocations.push(sourcePointer);
        const offsetsPointer = alloc(offsets.byteLength); allocations.push(offsetsPointer);
        const rolesPointer = alloc(pointSets.length); allocations.push(rolesPointer);
        const flattened = pointSets.flatMap(set => Array.isArray(set?.points) ? set.points : []);
        writePointBuffer(sourcePointer, flattened);
        new Uint32Array(wasm.memory.buffer, offsetsPointer, offsets.length).set(offsets);
        new Uint8Array(wasm.memory.buffer, rolesPointer, pointSets.length).set(
            pointSets.map(set => set?.role === 'grid-dots' ? 1 : 0)
        );
        const linePositionsPointer = alloc(lineCapacity * 12); allocations.push(linePositionsPointer);
        const lineOffsetsPointer = alloc((lineCapacity + 1) * 4); allocations.push(lineOffsetsPointer);
        const lineSetsPointer = alloc((lineCapacity + 1) * 4); allocations.push(lineSetsPointer);
        const pointPositionsPointer = alloc(Math.max(1, pointCapacity) * 12); allocations.push(pointPositionsPointer);
        const pointOffsetsPointer = alloc((pointSets.length + 1) * 4); allocations.push(pointOffsetsPointer);
        const pointSetsPointer = alloc((pointSets.length + 1) * 4); allocations.push(pointSetsPointer);
        const statsPointer = alloc(16); allocations.push(statsPointer);
        const mappingPointer = alloc(32); allocations.push(mappingPointer);
        const status = wasm.ce_build_grid_fold(
            configPointer, sourcePointer, offsetsPointer, rolesPointer, pointSets.length,
            options.sourceXRange[0], options.sourceXRange[1],
            options.outputXRange[0], options.outputXRange[1],
            options.outputYRange[0], options.outputYRange[1],
            Number(options.heightScale ?? 1),
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
                color: pointSets[setIndex]?.color
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
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

function sphereParameters(options) {
    const sphere = options.sphere || options;
    const centerX = Number(sphere.centerX);
    const centerY = Number(sphere.centerY);
    const radius = Number(sphere.radius);
    const rotX = Number(sphere.rotX);
    const rotY = Number(sphere.rotY);
    if (![centerX, centerY, radius, rotX, rotY].every(Number.isFinite) || radius <= 0) {
        throw new Error('Native sphere geometry requires finite projection parameters.');
    }
    return { centerX, centerY, radius, rotX, rotY };
}

function sphereMapPointer(options, allocations) {
    if (!options.mapPoints) return 0;
    const pointer = alloc(MAP_CONFIG_SIZE);
    allocations.push(pointer);
    writeMapConfig(pointer, options.mapOptions || options.map, allocations);
    return pointer;
}

export function buildNativeSphereLines(options, lines) {
    if (!Array.isArray(lines) || !lines.length) return [];
    const offsets = new Uint32Array(lines.length + 1);
    let pointCount = 0;
    lines.forEach((line, index) => {
        offsets[index] = pointCount;
        pointCount += Array.isArray(line) ? line.length : 0;
    });
    offsets[lines.length] = pointCount;
    if (!pointCount) return lines.map(() => new Float32Array());
    const segmentCount = Math.max(0, pointCount - lines.length);
    const outputCapacity = Math.max(8, pointCount * 3 + segmentCount * 768 + lines.length * 2);
    const projection = sphereParameters(options);
    const allocations = [];
    try {
        const mapPointer = sphereMapPointer(options, allocations);
        const pointsPointer = alloc(pointCount * 16); allocations.push(pointsPointer);
        const offsetsPointer = alloc(offsets.byteLength); allocations.push(offsetsPointer);
        const outputPointer = alloc(outputCapacity * 12); allocations.push(outputPointer);
        const outputOffsetsPointer = alloc(offsets.byteLength); allocations.push(outputOffsetsPointer);
        writePointBuffer(pointsPointer, lines.flat());
        new Uint32Array(wasm.memory.buffer, offsetsPointer, offsets.length).set(offsets);
        const outputCount = wasm.ce_build_sphere_lines(
            mapPointer, pointsPointer, offsetsPointer, lines.length, options.mapPoints ? 1 : 0,
            projection.centerX, projection.centerY, projection.radius, projection.rotX, projection.rotY,
            outputPointer, outputCapacity, outputOffsetsPointer
        );
        if (outputCount < 0) throw new Error(`Native sphere geometry failed with status ${outputCount}.`);
        const output = new Float32Array(wasm.memory.buffer, outputPointer, outputCount * 3);
        const view = memoryView();
        return lines.map((_, index) => {
            const start = view.getUint32(outputOffsetsPointer + index * 4, true);
            const end = view.getUint32(outputOffsetsPointer + (index + 1) * 4, true);
            return new Float32Array(output.subarray(start * 3, end * 3));
        });
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function projectNativeSpherePoints(options, points) {
    if (!Array.isArray(points) || !points.length) return { positions: new Float32Array(), visible: new Uint8Array() };
    const projection = sphereParameters(options);
    const allocations = [];
    try {
        const mapPointer = sphereMapPointer(options, allocations);
        const pointsPointer = alloc(points.length * 16); allocations.push(pointsPointer);
        const positionsPointer = alloc(points.length * 8); allocations.push(positionsPointer);
        const visiblePointer = alloc(points.length); allocations.push(visiblePointer);
        writePointBuffer(pointsPointer, points);
        const status = wasm.ce_project_sphere_points(
            mapPointer, pointsPointer, points.length, options.mapPoints ? 1 : 0,
            projection.centerX, projection.centerY, projection.radius, projection.rotX, projection.rotY,
            positionsPointer, visiblePointer
        );
        if (status !== 0) throw new Error(`Native sphere projection failed with status ${status}.`);
        return {
            positions: new Float32Array(new Float32Array(wasm.memory.buffer, positionsPointer, points.length * 2)),
            visible: new Uint8Array(new Uint8Array(wasm.memory.buffer, visiblePointer, points.length))
        };
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function buildNativeSphereProbe(options) {
    const projection = sphereParameters(options);
    const outputCapacity = 35 * 768 + 128;
    const allocations = [];
    try {
        const mapPointer = sphereMapPointer(options, allocations);
        const centerPointer = alloc(8); allocations.push(centerPointer);
        const visiblePointer = alloc(1); allocations.push(visiblePointer);
        const outputPointer = alloc(outputCapacity * 12); allocations.push(outputPointer);
        const offsetsPointer = alloc(16); allocations.push(offsetsPointer);
        const outputCount = wasm.ce_build_sphere_probe(
            mapPointer, Number(options.source?.re), Number(options.source?.im),
            Number(options.neighborhoodSize), Number(options.crosshairFactor), options.mapPoints ? 1 : 0,
            projection.centerX, projection.centerY, projection.radius, projection.rotX, projection.rotY,
            centerPointer, visiblePointer, outputPointer, outputCapacity, offsetsPointer
        );
        if (outputCount < 0) throw new Error(`Native sphere probe failed with status ${outputCount}.`);
        const view = memoryView();
        const output = new Float32Array(wasm.memory.buffer, outputPointer, outputCount * 3);
        return {
            center: {
                x: view.getFloat32(centerPointer, true),
                y: view.getFloat32(centerPointer + 4, true),
                visible: new Uint8Array(wasm.memory.buffer, visiblePointer, 1)[0] === 1
            },
            lines: Array.from({ length: 3 }, (_, index) => {
                const start = view.getUint32(offsetsPointer + index * 4, true);
                const end = view.getUint32(offsetsPointer + (index + 1) * 4, true);
                return new Float32Array(output.subarray(start * 3, end * 3));
            })
        };
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function buildNativeRiemannSphereGeometry(options, pointSets) {
    if (!Array.isArray(pointSets) || !pointSets.length) {
        return { start: new Float32Array(), target: new Float32Array(), positions: new Float32Array(), offsets: new Uint32Array(1) };
    }
    const offsets = new Uint32Array(pointSets.length + 1);
    let pointCount = 0;
    pointSets.forEach((set, index) => {
        offsets[index] = pointCount;
        pointCount += Array.isArray(set?.points) ? set.points.length : 0;
    });
    offsets[pointSets.length] = pointCount;
    const allocations = [];
    try {
        const mapPointer = sphereMapPointer(options, allocations);
        const pointsPointer = alloc(Math.max(1, pointCount) * 16); allocations.push(pointsPointer);
        const startPointer = alloc(Math.max(1, pointCount) * 12); allocations.push(startPointer);
        const targetPointer = alloc(Math.max(1, pointCount) * 12); allocations.push(targetPointer);
        const positionsPointer = alloc(Math.max(1, pointCount) * 12); allocations.push(positionsPointer);
        const points = pointSets.flatMap(set => Array.isArray(set?.points) ? set.points : []);
        const pointView = memoryView();
        points.forEach((point, index) => writeComplex(pointView, pointsPointer + index * 16, point, NaN, NaN));
        let status = wasm.ce_build_riemann_sphere_targets(
            mapPointer, pointsPointer, pointCount, options.mapPoints ? 1 : 0,
            Number(options.scale), Number(options.radius), startPointer, targetPointer
        );
        if (status !== 0) throw new Error(`Native Riemann sphere geometry failed with status ${status}.`);
        status = wasm.ce_interpolate_geometry(
            startPointer, targetPointer, pointCount * 3, Number(options.progress), positionsPointer
        );
        if (status !== 0) throw new Error(`Native Riemann interpolation failed with status ${status}.`);
        return {
            start: new Float32Array(new Float32Array(wasm.memory.buffer, startPointer, pointCount * 3)),
            target: new Float32Array(new Float32Array(wasm.memory.buffer, targetPointer, pointCount * 3)),
            positions: new Float32Array(new Float32Array(wasm.memory.buffer, positionsPointer, pointCount * 3)),
            offsets
        };
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function interpolateNativeGeometry(start, target, progress) {
    if (!(start instanceof Float32Array) || !(target instanceof Float32Array) || start.length !== target.length) {
        throw new Error('Native geometry interpolation requires matching Float32Array inputs.');
    }
    if (!start.length) return new Float32Array();
    const allocations = [];
    try {
        const startPointer = alloc(start.byteLength); allocations.push(startPointer);
        const targetPointer = alloc(target.byteLength); allocations.push(targetPointer);
        const outputPointer = alloc(start.byteLength); allocations.push(outputPointer);
        new Float32Array(wasm.memory.buffer, startPointer, start.length).set(start);
        new Float32Array(wasm.memory.buffer, targetPointer, target.length).set(target);
        const status = wasm.ce_interpolate_geometry(startPointer, targetPointer, start.length, Number(progress), outputPointer);
        if (status !== 0) throw new Error(`Native geometry interpolation failed with status ${status}.`);
        return new Float32Array(new Float32Array(wasm.memory.buffer, outputPointer, start.length));
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function buildNativeRiemannSpherePositions(points, scale, radius) {
    if (!Array.isArray(points) || !points.length) return new Float32Array();
    const allocations = [];
    try {
        const pointsPointer = alloc(points.length * 16); allocations.push(pointsPointer);
        const positionsPointer = alloc(points.length * 12); allocations.push(positionsPointer);
        writePointBuffer(pointsPointer, points);
        const status = wasm.ce_build_riemann_sphere_positions(
            pointsPointer, points.length, Number(scale), Number(radius), positionsPointer
        );
        if (status !== 0) throw new Error(`Native Riemann point geometry failed with status ${status}.`);
        return new Float32Array(new Float32Array(wasm.memory.buffer, positionsPointer, points.length * 3));
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function buildNativeRiemannProbe(options, point) {
    const allocations = [];
    try {
        const mapPointer = sphereMapPointer(options, allocations);
        const activePointer = alloc(12); allocations.push(activePointer);
        const spherePointer = alloc(12); allocations.push(spherePointer);
        const rayPointer = alloc(24); allocations.push(rayPointer);
        const status = wasm.ce_build_riemann_probe(
            mapPointer, Number(point?.re), Number(point?.im), options.mapPoints ? 1 : 0,
            Number(options.scale), Number(options.radius), Number(options.progress),
            activePointer, spherePointer, rayPointer
        );
        if (status !== 0) throw new Error(`Native Riemann probe failed with status ${status}.`);
        return {
            active: new Float32Array(new Float32Array(wasm.memory.buffer, activePointer, 3)),
            sphere: new Float32Array(new Float32Array(wasm.memory.buffer, spherePointer, 3)),
            ray: new Float32Array(new Float32Array(wasm.memory.buffer, rayPointer, 6))
        };
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function buildNativeFoldPreimageMarkers(options, roots) {
    if (!Array.isArray(roots) || !roots.length) return new Float32Array();
    const allocations = [];
    try {
        const mapPointer = alloc(MAP_CONFIG_SIZE); allocations.push(mapPointer);
        writeMapConfig(mapPointer, options.mapOptions, allocations);
        const rootsPointer = alloc(roots.length * 16); allocations.push(rootsPointer);
        const positionsPointer = alloc(roots.length * 12); allocations.push(positionsPointer);
        writePointBuffer(rootsPointer, roots);
        const count = wasm.ce_build_fold_preimage_markers(
            mapPointer, rootsPointer, roots.length,
            Number(options.mapping.mappedCenterX), Number(options.mapping.mappedCenterY),
            Number(options.mapping.sourceCenter), Number(options.mapping.scale), Number(options.heightScale),
            positionsPointer
        );
        if (count < 0) throw new Error(`Native fold preimage geometry failed with status ${count}.`);
        return new Float32Array(new Float32Array(wasm.memory.buffer, positionsPointer, count * 3));
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

function writeExpressionProgram(program, allocations) {
    if (!program?.instructions?.length) return 0;
    const pointer = alloc(program.instructions.length * 24);
    allocations.push(pointer);
    const view = memoryView();
    program.instructions.forEach((instruction, index) => {
        const offset = pointer + index * 24;
        view.setUint32(offset, instruction.opcode, true);
        view.setUint32(offset + 4, instruction.argument || 0, true);
        view.setFloat64(offset + 8, instruction.re || 0, true);
        view.setFloat64(offset + 16, instruction.im || 0, true);
    });
    return pointer;
}

export function buildNativeRealSurface(options) {
    const segments = Math.max(1, Math.floor(options.segments));
    const stride = segments + 1;
    const vertexCount = stride * stride;
    const maxIndexCount = segments * segments * 6;
    const valuesOnly = options.valuesOnly === true;
    const palette = options.palette;
    if (!valuesOnly && (!(palette instanceof Float32Array) || palette.length < 3 || palette.length % 3)) {
        throw new Error('Native real surface requires an RGB Float32 palette.');
    }
    const allocations = [];
    try {
        const configPointer = alloc(MAP_CONFIG_SIZE); allocations.push(configPointer);
        writeMapConfig(configPointer, options.mapOptions || options, allocations);
        const inputUPointer = writeExpressionProgram(options.inputUProgram, allocations);
        const inputVPointer = writeExpressionProgram(options.inputVProgram, allocations);
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
        const valuesPointer = alloc(vertexCount * 8); allocations.push(valuesPointer);
        const minimumPointer = alloc(8); allocations.push(minimumPointer);
        const maximumPointer = alloc(8); allocations.push(maximumPointer);
        const finitePointer = alloc(4); allocations.push(finitePointer);
        const indexCount = wasm.ce_build_real_surface(
            configPointer, options.xRange[0], options.xRange[1], options.yRange[0], options.yRange[1],
            segments,
            options.inputUPreset || 0, inputUPointer, options.inputUProgram?.instructions?.length || 0,
            options.inputVPreset || 0, inputVPointer, options.inputVProgram?.instructions?.length || 0,
            options.component || 0, Number(options.heightScale ?? 1), options.phaseColor ? 1 : 0,
            palettePointer, valuesOnly ? 0 : palette.length / 3, valuesOnly ? 1 : 0,
            positionsPointer, normalsPointer, colorsPointer, rawValuesPointer,
            valuesPointer, phasesPointer, indicesPointer,
            minimumPointer, maximumPointer, finitePointer
        );
        if (indexCount < 0) throw new Error(`Native real surface failed with status ${indexCount}.`);
        const view = memoryView();
        const result = {
            segments, vertexCount,
            values: new Float64Array(new Float64Array(wasm.memory.buffer, valuesPointer, vertexCount)),
            minValue: view.getFloat64(minimumPointer, true),
            maxValue: view.getFloat64(maximumPointer, true),
            finiteResultCount: view.getUint32(finitePointer, true)
        };
        if (valuesOnly) return result;
        return Object.assign(result, {
            positions: new Float32Array(new Float32Array(wasm.memory.buffer, positionsPointer, vertexCount * 3)),
            normals: new Float32Array(new Float32Array(wasm.memory.buffer, normalsPointer, vertexCount * 3)),
            colors: new Float32Array(new Float32Array(wasm.memory.buffer, colorsPointer, vertexCount * 3)),
            rawValues: new Float32Array(new Float32Array(wasm.memory.buffer, rawValuesPointer, vertexCount)),
            phases: new Float32Array(new Float32Array(wasm.memory.buffer, phasesPointer, vertexCount)),
            indices: new Uint32Array(new Uint32Array(wasm.memory.buffer, indicesPointer, indexCount))
        });
    } finally {
        for (let index = allocations.length - 1; index >= 0; index -= 1) wasm.ce_free(allocations[index]);
    }
}

export function nativeEngineInfo() {
    return Object.freeze({ abiVersion: wasm.ce_abi_version(), simd: true, strictFloat: true });
}

export { wasm as nativeWasmExports };
