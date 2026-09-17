import { parseExpression, FUNCTION_ARITY, normalizeExpressionNode } from '../math/expression/parser.js';
import { domainSpecial } from './domain-functions.js';

// Arithmetic/discrete opcodes 0..41 retain the native expression contract.
// The remaining instructions describe data movement and structured map loops.
export const DOMAIN_REGISTERS = 32;
export const DOMAIN_OP = Object.freeze({
    move: 0, integerPower: 42, divideSmall: 43, log: 44, exp: 45,
    cosh: 46, source: 49, loop: 50, next: 51,
    skipUndefined: 52, accepted: 53, requireValue: 54, result: 55, radius: 56,
    cos: 65, sin: 66, sinh: 71,
    predicate: 100, gammaShift: 101, zetaLength: 102, gammaError: 103,
    zetaError: 104, besselError: 105, fail: 106, seriesConstant: 107,
    zeroPower: 108, variableIntegerPower: 109, parity: 110, naturalLog: 111, scale: 112,
    rotate: 113, principalSqrt: 114, normSquared: 115, divideReal: 116,
    realExp: 117, realLog: 118, sincos: 119, sinhcosh: 120, branchArgument: 121,
    realSqrt: 122, checkRadial: 123, argumentCheck: 124, logScale: 125, oddSeries: 126,
    value: 127, derivative: 128, jet: 129, realAtan: 130,
    square: 131
});
export const DOMAIN_PRECISIONS = Object.freeze([3, 6, 12, 24, 48, 96, 192, 274]);
export function domainPrecision(required) {
    const words = DOMAIN_PRECISIONS.find(capacity => capacity >= required);
    if (!words) throw new Error('The requested calculation exceeds the supported 4096-bit precision.');
    return words;
}

const functionNames = ['c','cos','sin','tan','sec','exp','ln','sinh','tanh','asin','atan','gamma','loggamma','bessel','power','mobius','zeta','polynomial','algebraic_chaining','identity'];
const binaryOps = { '+':3, '-':4, '*':5, '/':6, '^':7, '==':18, '!=':19, '<':20, '<=':21, '>':22, '>=':23 };
const calls = { conj:10, abs:11, arg:12, re:13, im:14, factorial:17,
    floor:28, ceil:29, round:30, trunc:31, sign:32, min:33, max:34,
    mod:35, gcd:36, isPrime:37, complex:38, sqrt:41 };
const literal = value => ({ kind: 'literal', value });
const operation = (op, args, argument = 0) => ({ kind: 'op', op, args, argument });
const namedCall = (name, args) => ({ kind: 'call', name, args });
const choice = (test, yes, no) => ({ kind: 'choice', test, yes, no });

function expression(raw) {
    const node = normalizeExpressionNode(raw);
    if (node.type === 'literal') return literal(node.value);
    if (node.type === 'group') return expression(node.expression);
    if (node.type === 'variable') return { kind: 'variable', name: node.name };
    if (node.type === 'conditional') return choice(expression(node.test), expression(node.consequent), expression(node.alternate));
    if (node.type === 'binary') {
        const a = expression(node.left), b = expression(node.right);
        if (node.op === '&&') return choice(a, operation(24, [b]), literal(0));
        if (node.op === '||') return choice(a, literal(1), operation(24, [b]));
        const op = binaryOps[node.op];
        if (op === undefined) throw new Error('Unknown domain operator: ' + node.op);
        const syntax = (key, value) => key === 'start' || key === 'end' ? undefined : value;
        return operation(op, [a, b], op === 4 && JSON.stringify(node.left, syntax) === JSON.stringify(node.right, syntax) ? 1 : 0);
    }
    if (node.type === 'unary' || node.type === 'postfix') {
        const a = expression(node.argument);
        return node.type === 'postfix' ? operation(17, [a]) : node.op === '+' ? a : operation(node.op === '-' ? 8 : 16, [a]);
    }
    if (node.type === 'call') {
        const range = FUNCTION_ARITY[node.name];
        if (!range || node.args.length < range[0] || node.args.length > range[1]) throw new Error('Invalid domain call: ' + node.name);
        return namedCall(node.name, node.args.map(expression));
    }
    throw new Error('Invalid domain expression node: ' + node.type);
}

// Decode the existing aggregate bytecode to expression trees. Branches stay
// lazy; no unused arm is evaluated or submitted as a mathematical operation.
function nativeExpression(instructions, begin = 0, end = instructions.length, stack = []) {
    for (let pc = begin; pc < end; pc++) {
        const { opcode: op, argument: arg, re, im } = instructions[pc];
        if (op === 0) { stack.push(literal({ re, im })); continue; }
        if ([1, 2, 15].includes(op)) { stack.push({ kind: 'binding', slot: op === 15 ? arg : op === 1 ? 'z' : 'c' }); continue; }
        if (op === 25 || op === 26) {
            const test = stack.pop(), done = instructions[arg - 1];
            if (done?.opcode !== 27) throw new Error('Invalid domain expression branch.');
            const left = nativeExpression(instructions, pc + 1, arg - 1, [...stack]).at(-1);
            const right = nativeExpression(instructions, arg, done.argument, [...stack]).at(-1);
            stack.push(op === 25 ? choice(test, left, right) : choice(test, right, left));
            pc = done.argument - 1; continue;
        }
        const arity = [33, 34, 38].includes(op) ? arg : [3,4,5,6,7,18,19,20,21,22,23,35,36,39].includes(op) ? 2 : 1;
        if (stack.length < arity) throw new Error('Invalid domain expression stack.');
        const args = stack.splice(-arity);
        stack.push(op === 9 ? namedCall(functionNames[arg], args) : op === 40 ? namedCall('selected', args) : operation(op, args, arg));
    }
    return stack;
}

function integer(node) {
    if (node.kind === 'op' && node.op === 8) { const n = integer(node.args[0]); return n === null ? null : -n; }
    if (node.kind !== 'literal') return null;
    const value = typeof node.value === 'number' ? { re: node.value, im: 0 } : node.value;
    return value?.im === 0 && Number.isInteger(value.re) && Math.abs(value.re) < 1073741824 ? value.re : null;
}

export function compileDomainProgram(snapshot, words) {
    const numbers = [], code = [], metadata = [], constants = new Map(), loops = [];
    let nextRegister = 2, special = false;
    const number = (value, kind = 6, index = 0) => {
        const row = numbers.length; numbers.push({ kind, index, text: String(value) }); return row;
    };
    number('', 1); number('', 2); number('', 9); number('', 10);
    for (const key of ['centerRe','centerIm','xSpan','ySpan']) number(snapshot.viewport[key], 0);
    const constantMap = new Map();
    const constant = value => {
        if (typeof value === 'boolean') value = Number(value);
        if (typeof value === 'number') value = { re: value, im: 0 };
        if (!value || !Number.isFinite(value.re) || !Number.isFinite(value.im)) throw new Error('Domain program requires finite complex constants.');
        const key = `${value.re},${value.im}`;
        if (!constantMap.has(key)) {
            const row = number(value.re); number(value.im);
            constantMap.set(key, { row });
        }
        return constantMap.get(key);
    };
    const zero = constant(0), one = constant(1);
    const isZero = x => typeof x === 'object' && x !== null && x.row === zero.row;
    const isOne = x => typeof x === 'object' && x !== null && x.row === one.row;
    const parameterConstant = (name, logarithm = false) => {
        if (!constants.has(name)) {
            const value = snapshot[name];
            if (logarithm) { const row = number(value.re + ' ' + value.im, 7); number(value.re + ' ' + value.im, 8); constants.set(name, { row }); }
            else constants.set(name, constant(value));
        }
        return constants.get(name);
    };
    const mathematicalConstant = kind => {
        const key = 'constant:' + kind;
        if(!constants.has(key)) { const row = number('', kind); number(0); constants.set(key, { row }); }
        return constants.get(key);
    };
    const valueOf = a => snapshot.derivativeOrder ? emit(DOMAIN_OP.value, a) : a;
    const withDerivative = (value, input, slope) => snapshot.derivativeOrder
        ? emit(DOMAIN_OP.jet, emit(38, value, slope()), input) : value;
    const emit = (op, a = zero, b = zero, immediate = 0, dest = undefined) => {
        if (dest === undefined) {
            if (op === 3) {
                if (isZero(a)) return b;
                if (isZero(b)) return a;
            }
            if (op === 4) {
                if (isZero(b)) return a;
                if (a === b) return zero;
            }
            if (op === 5) {
                if (isOne(a)) return b;
                if (isOne(b)) return a;
                if (isZero(a) || isZero(b)) return zero;
                if (a === b) return emit(DOMAIN_OP.square, a);
            }
            if (op === DOMAIN_OP.integerPower) {
                if (immediate === 0) return one;
                if (immediate === 1) return a;
                if (immediate === 2) return emit(DOMAIN_OP.square, a);
            }
            dest = nextRegister++;
        }
        // Complex primitives are compositions of the same tape operations as
        // user expressions. The shader contains each scalar kernel only once.
        if(op === DOMAIN_OP.realLog) {
            const x = valueOf(a), reduced = emit(DOMAIN_OP.logScale, x);
            const m = emit(13, reduced), k = emit(14, reduced);
            const t = emit(DOMAIN_OP.divideReal, emit(4, m, one), emit(3, m, one));
            const series = emit(DOMAIN_OP.scale, emit(DOMAIN_OP.oddSeries, t, zero, 1), zero, 1);
            const value = emit(3, series, emit(5, k, mathematicalConstant(2)));
            return emit(0, withDerivative(value, a, () => emit(DOMAIN_OP.divideReal, emit(DOMAIN_OP.derivative, a), x)), zero, 0, dest);
        }
        if(op === DOMAIN_OP.realAtan) {
            const x = valueOf(a), negative = predicate(x, 2);
            let t = branch(negative, () => emit(8, x), () => x);
            const inverse = emit(22, t, one);
            t = branch(inverse, () => emit(DOMAIN_OP.divideReal, one, t), () => t);
            const shifted = emit(22, t, constant(0.5));
            t = branch(shifted, () => emit(DOMAIN_OP.divideReal, emit(4, t, one), emit(3, t, one)), () => t);
            let value = emit(DOMAIN_OP.oddSeries, t, zero, -1);
            const pi = mathematicalConstant(1);
            value = branch(shifted, () => emit(3, emit(DOMAIN_OP.scale, pi, zero, -2), value), () => value);
            value = branch(inverse, () => emit(4, emit(DOMAIN_OP.scale, pi, zero, -1), value), () => value);
            value = branch(negative, () => emit(8, value), () => value);
            return emit(0, withDerivative(value, a, () =>
                emit(DOMAIN_OP.divideReal, emit(DOMAIN_OP.derivative, a), emit(3, one, emit(5, x, x)))), zero, 0, dest);
        }
        if(op === 12) {
            const checked = emit(DOMAIN_OP.argumentCheck, a), horizontal = predicate(checked, 6);
            const x = emit(13, checked), y = emit(14, checked), pi = mathematicalConstant(1);
            const numerator = branch(horizontal, () => y, () => x);
            const denominator = branch(horizontal, () => x, () => y);
            const angle = emit(DOMAIN_OP.realAtan, emit(DOMAIN_OP.divideReal, numerator, denominator));
            const value = branch(horizontal, () => branch(predicate(x, 2),
                () => branch(predicate(y, 2), () => emit(4, angle, pi), () => emit(3, angle, pi)), () => angle), () => {
                const value = emit(4, emit(DOMAIN_OP.scale, pi, zero, -1), angle);
                return branch(predicate(y, 2), () => emit(4, value, pi), () => value);
            });
            return emit(0, value, zero, 0, dest);
        }
        if(op === DOMAIN_OP.log || op === DOMAIN_OP.naturalLog) {
            const magnitude = emit(DOMAIN_OP.scale, emit(DOMAIN_OP.realLog, emit(DOMAIN_OP.normSquared, a)), zero, -1);
            let angle = emit(12, a);
            if(op === DOMAIN_OP.log) angle = emit(DOMAIN_OP.branchArgument, angle);
            return emit(38, magnitude, angle, 0, dest);
        }
        if(op === DOMAIN_OP.exp) {
            const magnitude = emit(DOMAIN_OP.realExp, emit(13, a));
            const direction = emit(DOMAIN_OP.sincos, emit(14, a));
            return emit(5, magnitude, emit(38, emit(14, direction), emit(13, direction)), 0, dest);
        }
        if([DOMAIN_OP.cos, DOMAIN_OP.sin, DOMAIN_OP.sinh, DOMAIN_OP.cosh].includes(op)) {
            const hyperbolic = op === DOMAIN_OP.sinh || op === DOMAIN_OP.cosh;
            const cosine = op === DOMAIN_OP.cos || op === DOMAIN_OP.cosh;
            const circular = emit(DOMAIN_OP.sincos, emit(hyperbolic ? 14 : 13, a));
            const hyper = emit(DOMAIN_OP.sinhcosh, emit(hyperbolic ? 13 : 14, a));
            const s = emit(13, circular), c = emit(14, circular), sh = emit(13, hyper), ch = emit(14, hyper);
            const real = hyperbolic ? emit(5, cosine ? ch : sh, c) : emit(5, cosine ? c : s, ch);
            let imaginary = hyperbolic ? emit(5, cosine ? sh : ch, s) : emit(5, cosine ? s : c, sh);
            if(cosine && !hyperbolic) imaginary = emit(8, imaginary);
            return emit(38, real, imaginary, 0, dest);
        }
        if(op === 11) {
            const checked = emit(DOMAIN_OP.checkRadial, a);
            return emit(DOMAIN_OP.realSqrt, emit(DOMAIN_OP.normSquared, checked), zero, 0, dest);
        }
        if(op === DOMAIN_OP.principalSqrt) {
            const checked = emit(DOMAIN_OP.checkRadial, a, zero, 1);
            const value = branch(predicate(checked, 0), () => zero, () => {
                const real = emit(13, checked), imaginary = emit(14, checked), negative = predicate(real, 2);
                const magnitude = emit(DOMAIN_OP.realSqrt, emit(DOMAIN_OP.normSquared, checked));
                const absolute = branch(negative, () => emit(8, real), () => real);
                const root = emit(DOMAIN_OP.realSqrt, emit(DOMAIN_OP.scale, emit(3, magnitude, absolute), zero, -1));
                const other = emit(DOMAIN_OP.divideReal, imaginary, emit(DOMAIN_OP.scale, root, zero, 1));
                return branch(negative, () => branch(predicate(imaginary, 2),
                    () => emit(38, emit(8, other), emit(8, root)), () => emit(38, other, root)),
                    () => emit(38, root, other));
            });
            return emit(0, value, zero, 0, dest);
        }
        if(op === DOMAIN_OP.integerPower) {
            let result = one, factor = a, count = immediate;
            while(count > 0) {
                if(count & 1) result = emit(5, result, factor);
                count >>>= 1;
                if(count > 0) factor = emit(DOMAIN_OP.square, factor);
            }
            return emit(0, result, zero, 0, dest);
        }
        if(op === DOMAIN_OP.variableIntegerPower) {
            const count = emit(0, branch(predicate(b, 2), () => emit(8, b), () => b));
            const result = emit(0, one), factor = emit(0, a);
            const start = code.length, done = control(25, count);
            const even = control(25, emit(DOMAIN_OP.parity, count));
            emit(5, result, factor, 0, result); code[even].immediate = code.length;
            emit(31, emit(DOMAIN_OP.divideSmall, count, zero, 2), zero, 0, count);
            const finished = control(25, count);
            emit(5, factor, factor, 0, factor); control(27, zero, start);
            code[done].immediate = code[finished].immediate = code.length;
            loops.push({ start, end: code.length - 1 });
            return emit(0, result, zero, 0, dest);
        }
        if(op === 6) {
            const denominator = emit(DOMAIN_OP.normSquared, b);
            const numerator = emit(5, a, emit(10, b));
            return emit(DOMAIN_OP.divideReal, numerator, denominator, 0, dest);
        }
        code.push({ op, dest, a, b, immediate }); return dest;
    };
    const control = (op, a = zero, target = 0) => {
        code.push({ op, dest: -1, a, b: zero, immediate: target }); return code.length - 1;
    };
    const polynomial = (z, coefficients) => {
        if(!coefficients.length) return zero;
        let value = constant(coefficients.at(-1));
        for(let i = coefficients.length - 2; i >= 0; i--) value = emit(3, emit(5, value, z), constant(coefficients[i]));
        return value;
    };
    const branch = (test, yes, no) => {
        const condition = control(25, test), result = nextRegister++;
        emit(0, yes(), zero, 0, result);
        const done = control(27); code[condition].immediate = code.length;
        emit(0, no(), zero, 0, result);
        code[done].immediate = code.length; return result;
    };
    const repeat = (initial, condition, body) => {
        const counter = emit(0, constant(initial)), start = code.length;
        const done = control(25, condition(counter));
        body(counter); emit(3, counter, one, 0, counter); control(27, zero, start);
        code[done].immediate = code.length; loops.push({ start, end: code.length - 1 });
    };
    const predicate = (a, kind) => emit(DOMAIN_OP.predicate, a, zero, kind);
    const power = (a, b, n) => {
        if(n !== null) {
            if(n === 2) return emit(DOMAIN_OP.square, a);
            const value = emit(DOMAIN_OP.integerPower, a, zero, Math.abs(n));
            return n < 0 ? emit(6, one, value) : value;
        }
        return branch(predicate(b, 5), () => {
            const value = emit(DOMAIN_OP.variableIntegerPower, a, b);
            return branch(predicate(b, 2), () => emit(6, one, value), () => value);
        }, () =>
            branch(predicate(a, 0), () => emit(DOMAIN_OP.zeroPower, a, b), () =>
                emit(DOMAIN_OP.exp, emit(5, b, emit(DOMAIN_OP.log, a)))));
    };
    const specialMap = domainSpecial({ emit, branch, repeat, predicate, constant, zero, one, words, op: DOMAIN_OP,
        descriptor(value, kind) { const row = number(value, kind); number(0); return { row }; },
        operands(values) { const index = metadata.length; metadata.push({ operands: values }); return index; }
    });
    let compilingBase = false;
    const call = (name, args, parameter) => {
        name = name === 'log' ? 'ln' : name;
        const a = args[0];
        if (['selected','selectedFunction','f'].includes(name)) {
            if (compilingBase && snapshot.functionKey === 'algebraic_chaining') throw new Error('An algebraic map cannot recursively select itself.');
            return base(a, parameter);
        }
        if (name === 'identity') return a;
        if (name === 'c') return parameter;
        if (name === 'algebraic_chaining') throw new Error('Recursive selected-function expressions are not valid.');
        if (name === 'pow') return power(a, args[1], null);
        if (name === 'sqrt') return power(a, constant(0.5), null);
        if (name === 'asin') {
            const iz = emit(DOMAIN_OP.rotate, a);
            const root = emit(DOMAIN_OP.principalSqrt, emit(4, one, emit(5, a, a)));
            return emit(8, emit(DOMAIN_OP.rotate, emit(DOMAIN_OP.naturalLog, emit(3, iz, root))));
        }
        if (name === 'atan') {
            const iz = emit(DOMAIN_OP.rotate, a);
            const difference = emit(4, emit(DOMAIN_OP.naturalLog, emit(3, one, iz)), emit(DOMAIN_OP.naturalLog, emit(4, one, iz)));
            return emit(8, emit(DOMAIN_OP.scale, emit(DOMAIN_OP.rotate, difference), zero, -1));
        }
        if (['gamma','loggamma','zeta'].includes(name)) { special = true; return specialMap(name, a); }
        if (name in calls) return simple(calls[name], args);
        if (['cos','sin','sinh'].includes(name)) return emit(DOMAIN_OP[name], a);
        if (name === 'tan') {
            const twoRe = emit(DOMAIN_OP.scale, emit(13, a), zero, 1);
            const twoIm = emit(DOMAIN_OP.scale, emit(14, a), zero, 1);
            const sc = emit(DOMAIN_OP.sincos, twoRe);
            const shch = emit(DOMAIN_OP.sinhcosh, twoIm);
            const num = emit(38, emit(13, sc), emit(13, shch));
            const denom = emit(3, emit(14, sc), emit(14, shch));
            return emit(DOMAIN_OP.divideReal, num, denom);
        }
        if (name === 'sec') {
            const circular = emit(DOMAIN_OP.sincos, emit(13, a));
            const hyper = emit(DOMAIN_OP.sinhcosh, emit(14, a));
            const s = emit(13, circular), c = emit(14, circular), sh = emit(13, hyper), ch = emit(14, hyper);
            const u = emit(5, c, ch), v = emit(5, s, sh);
            const denom = emit(3, emit(DOMAIN_OP.square, u), emit(DOMAIN_OP.square, v));
            const num = emit(38, u, v);
            return emit(DOMAIN_OP.divideReal, num, denom);
        }
        if (name === 'tanh') {
            const twoRe = emit(DOMAIN_OP.scale, emit(13, a), zero, 1);
            const twoIm = emit(DOMAIN_OP.scale, emit(14, a), zero, 1);
            const shch = emit(DOMAIN_OP.sinhcosh, twoRe);
            const sc = emit(DOMAIN_OP.sincos, twoIm);
            const num = emit(38, emit(13, shch), emit(13, sc));
            const denom = emit(3, emit(14, shch), emit(14, sc));
            return emit(DOMAIN_OP.divideReal, num, denom);
        }
        if (name === 'exp') return emit(DOMAIN_OP.exp, emit(5, a, parameterConstant('expBase', true)));
        if (name === 'ln') return emit(6, emit(DOMAIN_OP.log, a), parameterConstant('logBase', true));
        if (name === 'power') return power(a, parameterConstant('fractionalPowerN'), integer(literal(snapshot.fractionalPowerN)));
        if (name === 'bessel') {
            special = true;
            return specialMap(name, args.length === 2 ? args[1] : a, args.length === 2 ? a : parameterConstant('besselOrder'));
        }
        if (name === 'mobius') return emit(6,
            emit(3, emit(5, parameterConstant('mobiusA'), a), parameterConstant('mobiusB')),
            emit(3, emit(5, parameterConstant('mobiusC'), a), parameterConstant('mobiusD')));
        if (name === 'polynomial') return polynomial(a, snapshot.polynomialCoeffs);
        throw new Error('Unknown domain primitive: ' + name);
    };
    const simple = (op, args, arg = 0) => {
        if (op === 39) { special = true; return specialMap('bessel', args[1], args[0]); }
        if (op === 41) return power(args[0], constant(0.5), null);
        if (op === 33 || op === 34) return args.slice(1).reduce((a, b) => emit(op, a, b), args[0]);
        // Evaluate both operands before applying the exact syntactic identity.
        if (op === 4 && arg === 1) return zero;
        return emit(op, args[0], args[1] ?? zero);
    };
    const weights = new WeakMap();
    const weight = node => {
        if (!weights.has(node)) {
            const children = node.args ?? (node.kind === 'choice' ? [node.test, node.yes, node.no] : []);
            const sizes = children.map(weight).sort((a, b) => b - a);
            weights.set(node, Math.max(1, ...sizes.map((size, i) => size + i)));
        }
        return weights.get(node);
    };
    const evaluate = (node, variables, bindings = null) => {
        if (node.kind === 'literal') return constant(node.value);
        if (node.kind === 'binding') {
            if (typeof node.slot === 'string') return variables[node.slot];
            return bindings(node.slot);
        }
        if (node.kind === 'variable') {
            if (node.name in variables) return variables[node.name];
            if (node.name === 'pi') { const row = number('', 1); number(0); return { row }; }
            if (node.name === 'e') return emit(DOMAIN_OP.exp, one);
            if (node.name === 'i') return constant({ re: 0, im: 1 });
            if (node.name === 'true') return one;
            if (node.name === 'false') return zero;
            throw new Error('Unbound domain variable: ' + node.name);
        }
        if (node.kind === 'choice') {
            return branch(evaluate(node.test, variables, bindings),
                () => evaluate(node.yes, variables, bindings), () => evaluate(node.no, variables, bindings));
        }
        // Pure operands may be scheduled in descending storage demand. Their
        // argument positions remain unchanged. Branch arms are never moved out
        // of their branch, and n-ary reductions retain their arithmetic order.
        const args = new Array(node.args.length);
        if ((node.kind === 'op' && [33,34].includes(node.op)) || (node.kind === 'call' && ['min','max'].includes(node.name))) {
            const op = node.op ?? calls[node.name];
            return node.args.slice(1).reduce((a, b) => emit(op, a, evaluate(b, variables, bindings)), evaluate(node.args[0], variables, bindings));
        }
        node.args.map((child, index) => ({ child, index })).sort((a, b) => weight(b.child) - weight(a.child))
            .forEach(({ child, index }) => { args[index] = evaluate(child, variables, bindings); });
        if ((node.kind === 'op' && node.op === 7) || (node.kind === 'call' && node.name === 'pow')) return power(args[0], args[1], integer(node.args[1]));
        if (node.kind === 'op' && node.op === 5 && args.length === 2 && args[0] === args[1]) return emit(DOMAIN_OP.square, args[0]);
        if (node.kind === 'op' && node.op === 6) {
            const n = integer(node.args[1]);
            if (n !== null && n !== 0 && Math.abs(n) < 65536) return emit(DOMAIN_OP.divideSmall, args[0], zero, n);
        }
        return node.kind === 'call' ? call(node.name, args, variables.c) : simple(node.op, args, node.argument);
    };
    const base = (input, parameter) => {
        if (snapshot.functionKey !== 'algebraic_chaining') return call(snapshot.functionKey, [input], parameter);
        compilingBase = true;
        const raw = snapshot.algebraicChainingZExpr;
        if (raw == null || raw === '') throw new Error('An algebraic input expression is required.');
        const z = evaluate(expression(typeof raw === 'string' ? parseExpression(raw) : raw), { z: input, c: parameter });
        let sum = zero;
        for (const term of snapshot.algebraicChainingTerms) {
            let product = constant(term.coeff);
            for (const factor of term.factors) {
                if (factor.func === 'none') break;
                let value = z;
                if (factor.chainedFunc && factor.chainedFunc !== 'none') value = call(factor.chainedFunc, [value], parameter);
                value = call(factor.func, [value], parameter);
                if (factor.power !== 1) value = power(value, constant(factor.power), integer(literal(factor.power)));
                if (factor.reciprocal) value = emit(6, one, value);
                if (factor.log) value = call('ln', [value], parameter);
                if (factor.exp) value = call('exp', [value], parameter);
                product = emit(5, product, value);
            }
            sum = emit(3, sum, product);
        }
        compilingBase = false; return sum;
    };

    let output;
    const aggregate = snapshot.dynamicAggregate;
    if (aggregate) {
        const offset = numbers.length, stride = aggregate.variableNames.length * 2;
        for (const row of aggregate.variables) for (const value of row) constant(value);
        // An aggregate's parameter is the current map input, as in the native
        // aggregate contract. Ordinary OC retains the original pixel parameter.
        const variables = { z: 0, c: 0 };
        output = emit(0, aggregate.reduction === 2 ? one : zero);
        const loop = control(DOMAIN_OP.loop), skip = aggregate.invalidPolicy ? control(DOMAIN_OP.skipUndefined) : null;
        let point = null;
        const binding = slot => {
            const flag = aggregate.variableFlags[slot];
            if (flag === 1) return 0;
            if (flag === 2) return emit(13, 0);
            if (flag === 3 && point !== null) return point;
            return emit(DOMAIN_OP.source, zero, zero, { offset: offset + 2 * slot, stride });
        };
        point = evaluate(nativeExpression(aggregate.pointProgram.instructions).at(-1), variables, binding);
        const term = evaluate(nativeExpression(aggregate.termProgram.instructions).at(-1), variables, binding);
        emit(aggregate.reduction === 1 ? 3 : aggregate.reduction === 2 ? 5 : 0,
            aggregate.reduction ? output : term, term, 0, output);
        control(DOMAIN_OP.accepted);
        if (skip !== null) code[skip].immediate = code.length;
        control(DOMAIN_OP.next, zero, loop);
        loops.push({ start: loop, end: code.length - 1 });
        code[loop].immediate = code.length;
        if (aggregate.reduction === 0) control(DOMAIN_OP.requireValue);
    } else if (snapshot.taylor) {
        const t = snapshot.taylor, delta = emit(4, 0, constant(t.center));
        if (Number.isFinite(t.radius)) emit(DOMAIN_OP.radius, delta, constant(t.radius));
        output = polynomial(delta, t.coefficients);
    } else output = base(0, 1);
    control(DOMAIN_OP.result, output);

    // Linear live intervals include both branch assignments and loop-carried
    // values. Inputs occupy registers 0 and 1; temporaries share the remainder.
    const intervals = new Map();
    const touch = (value, pc) => {
        if (typeof value !== 'number' || value < 2) return;
        const interval = intervals.get(value);
        if (interval) interval.end = pc;
        else intervals.set(value, { id: value, start: pc, end: pc });
    };
    code.forEach((instruction, pc) => {
        touch(instruction.a, pc); touch(instruction.b, pc); touch(instruction.dest, pc);
        if(instruction.op === DOMAIN_OP.besselError) metadata[instruction.immediate].operands.forEach(value => touch(value, pc));
    });
    // Values defined outside a loop must survive the entire back edge, even
    // when their last textual use precedes another temporary inside its body.
    for(const loop of loops) for(const interval of intervals.values()) {
        if(interval.start < loop.start && interval.end >= loop.start && interval.end < loop.end) interval.end = loop.end;
    }
    const locations = new Map([[0, 0], [1, 1]]), active = [], free = Array.from({ length: DOMAIN_REGISTERS - 2 }, (_, i) => i + 2);
    for (const interval of [...intervals.values()].sort((a, b) => a.start - b.start)) {
        for (let i = active.length - 1; i >= 0; i--) if (active[i].end < interval.start) free.push(locations.get(active.splice(i, 1)[0].id));
        if (!free.length) throw new Error('The expression exceeds ' + (DOMAIN_REGISTERS - 2) + ' simultaneously live GPU temporaries.');
        locations.set(interval.id, free.pop()); active.push(interval);
    }
    const address = value => typeof value === 'number' ? locations.get(value) : -value.row - 1;
    const instructions = [];
    for (const instruction of code) {
        const { op, dest, a, b, immediate } = instruction;
        let left = address(a), right = address(b);
        if ([25,26,27,DOMAIN_OP.divideSmall,DOMAIN_OP.loop,DOMAIN_OP.next,DOMAIN_OP.skipUndefined,
            DOMAIN_OP.predicate,DOMAIN_OP.fail,DOMAIN_OP.seriesConstant,DOMAIN_OP.scale,DOMAIN_OP.checkRadial,DOMAIN_OP.oddSeries].includes(op)) right = immediate;
        if (op === DOMAIN_OP.besselError) right = code.length + immediate;
        if (op === DOMAIN_OP.source) { left = immediate.offset; right = immediate.stride; }
        instructions.push(op, dest < 0 ? 0 : locations.get(dest), left, right);
    }
    for (const row of metadata) instructions.push(...(row.operands ? row.operands.map(address) : row));
    const count = Math.ceil(15 * (words - 1) / 4) + 8;
    const bernoulli = numbers.length; if (special) for (let k = 1; k <= count; k++) number('', 3, k);
    const stirling = numbers.length; if (special) for (let k = 1; k <= count; k++) number('', 4, k);
    const seed = constant(snapshot.chainSeed).row, attractorTolerance = number('1e-14', 0), angle = number(snapshot.branchCutAngle);
    return { numbers, words, instructions: Int32Array.from(instructions), instructionCount: code.length,
        uniforms: { uSeed: seed, uAttractorTolerance: attractorTolerance, uBranchAngle: angle,
            uBernoulli: bernoulli, uStirling: stirling,
            uContinuation: snapshot.zetaContinuationEnabled ? 1 : 0,
            uSourceCount: aggregate?.variables.length ?? 0 } };
}
