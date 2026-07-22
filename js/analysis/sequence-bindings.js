import {
    collectExpressionDependencies,
    parseExpression
} from '../math/expression/index.js';
import { generateDiscreteSource } from './discrete-sources.js';

const BUILT_IN_VARIABLES = new Set([
    'c', 'd', 'j', 'z', 's', 'i', 'pi', 'e', 'true', 'false'
]);

export const SEQUENCE_BINDING_KINDS = Object.freeze([
    Object.freeze({ id: 'parameter', label: 'Free complex parameter' }),
    Object.freeze({ id: 'parameter_real', label: 'Free real parameter' }),
    Object.freeze({ id: 'constant', label: 'Fixed complex value' }),
    Object.freeze({ id: 'naturals', label: 'Natural numbers' }),
    Object.freeze({ id: 'integers', label: 'Integers' }),
    Object.freeze({ id: 'primes', label: 'Prime numbers' }),
    Object.freeze({ id: 'gaussian_integers', label: 'Gaussian integers' }),
    Object.freeze({ id: 'gaussian_primes', label: 'Gaussian primes' }),
    Object.freeze({ id: 'arithmetic', label: 'Arithmetic progression' }),
    Object.freeze({ id: 'geometric', label: 'Geometric progression' }),
    Object.freeze({ id: 'harmonic', label: 'Harmonic progression' }),
    Object.freeze({ id: 'expression', label: 'Custom rule in j' }),
    Object.freeze({ id: 'custom_points', label: 'Explicit value list' })
]);

const DEFAULT_VALUE = Object.freeze({ re: 1, im: 0 });
const BINDABLE_SYMBOL_CACHE = new Map();

const DEFAULT_BINDING = Object.freeze({
    id: 'binding-value',
    symbol: '',
    kind: 'constant',
    value: DEFAULT_VALUE,
    start: 1,
    step: 1,
    ratio: 2,
    ordering: 'ascending',
    includeZero: false,
    includeNegative: false,
    min: 2,
    max: '',
    bound: 12,
    boundType: 'norm',
    associatePolicy: 'all',
    includeConjugates: true,
    generatorExpression: 'j + 1',
    pointsText: '1; 2; 3'
});

function finiteNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function complexValue(value, fallback = DEFAULT_VALUE) {
    return {
        re: finiteNumber(value?.re, fallback.re),
        im: finiteNumber(value?.im, fallback.im)
    };
}

function normalizedSymbol(symbol) {
    return String(symbol || '').trim();
}

function isIndexLike(symbol) {
    if (symbol.length !== 1) return false;
    const code = symbol.charCodeAt(0) | 32;
    return code === 110 || code === 107 || code === 109 || code === 114;
}

export function createDefaultSequenceBinding(symbol) {
    const normalized = normalizedSymbol(symbol);
    const indexLike = isIndexLike(normalized);
    return {
        id: `binding-${normalized || 'value'}`,
        symbol: normalized,
        kind: normalized.toLowerCase() === 'x' ? 'parameter' : indexLike ? 'naturals' : 'constant',
        value: { re: 1, im: 0 },
        start: indexLike ? 0 : 1,
        step: 1,
        ratio: 2,
        ordering: 'ascending',
        includeZero: false,
        includeNegative: false,
        min: 2,
        max: '',
        bound: 12,
        boundType: 'norm',
        associatePolicy: 'all',
        includeConjugates: true,
        generatorExpression: 'j + 1',
        pointsText: '1; 2; 3'
    };
}

export function normalizeSequenceBinding(binding, symbol = binding?.symbol) {
    const normalized = normalizedSymbol(symbol || binding?.symbol);
    const indexLike = isIndexLike(normalized);
    const source = binding && typeof binding === 'object' ? binding : DEFAULT_BINDING;
    return {
        id: String(source.id || `binding-${normalized}`),
        symbol: normalized,
        kind: source.kind || (normalized.toLowerCase() === 'x' ? 'parameter' : indexLike ? 'naturals' : 'constant'),
        value: complexValue(source.value),
        start: finiteNumber(source.start, indexLike ? 0 : 1),
        step: finiteNumber(source.step, 1),
        ratio: finiteNumber(source.ratio, 2),
        ordering: source.ordering || 'ascending',
        includeZero: Boolean(source.includeZero),
        includeNegative: Boolean(source.includeNegative),
        min: Math.max(2, Math.floor(finiteNumber(source.min, 2))),
        max: source.max ?? '',
        bound: Math.max(1, Math.floor(finiteNumber(source.bound, 12))),
        boundType: source.boundType || 'norm',
        associatePolicy: source.associatePolicy || 'all',
        includeConjugates: source.includeConjugates !== undefined ? Boolean(source.includeConjugates) : true,
        generatorExpression: source.generatorExpression || 'j + 1',
        pointsText: source.pointsText || '1; 2; 3'
    };
}

export function getBindableExpressionSymbols(source, parameterNames = []) {
    const input = String(source ?? '');
    const params = parameterNames || [];
    let key = input;
    for (let index = 0; index < params.length; index++) key += `\u0000${String(params[index] || '').trim()}`;
    const cached = BINDABLE_SYMBOL_CACHE.get(key);
    if (cached) return cached.slice();

    const dependencies = collectExpressionDependencies(parseExpression(input));
    const excluded = new Set(BUILT_IN_VARIABLES);
    for (let index = 0; index < params.length; index++) {
        const name = String(params[index] || '').trim();
        if (name) excluded.add(name);
    }
    const output = [];
    for (const name of dependencies.variables) {
        if (!excluded.has(name)) output.push(name);
    }
    output.sort((left, right) => left.localeCompare(right));
    if (BINDABLE_SYMBOL_CACHE.size > 256) BINDABLE_SYMBOL_CACHE.delete(BINDABLE_SYMBOL_CACHE.keys().next().value);
    BINDABLE_SYMBOL_CACHE.set(key, output);
    return output.slice();
}

export function synchronizeSequenceBindings(source, bindings = [], parameterNames = []) {
    const symbols = getBindableExpressionSymbols(source, parameterNames);
    const existing = new Map();
    const list = bindings || [];
    for (let index = 0; index < list.length; index++) {
        const binding = list[index];
        existing.set(binding?.symbol, binding);
    }
    const output = new Array(symbols.length);
    for (let index = 0; index < symbols.length; index++) {
        const symbol = symbols[index];
        output[index] = normalizeSequenceBinding(existing.get(symbol), symbol);
    }
    return output;
}


const ENVIRONMENT_FACTORY_CACHE = new Map();
const NORMALIZED_BINDING_CACHE = new WeakMap();

function sameCachedBinding(cache, binding) {
    return cache.kind === binding.kind && cache.id === binding.id && cache.symbol === binding.symbol &&
        cache.start === binding.start && cache.step === binding.step && cache.ratio === binding.ratio &&
        cache.ordering === binding.ordering && cache.includeZero === binding.includeZero &&
        cache.includeNegative === binding.includeNegative && cache.min === binding.min && cache.max === binding.max &&
        cache.bound === binding.bound && cache.boundType === binding.boundType &&
        cache.associatePolicy === binding.associatePolicy && cache.includeConjugates === binding.includeConjugates &&
        cache.generatorExpression === binding.generatorExpression && cache.pointsText === binding.pointsText &&
        cache.valueRe === binding.value?.re && cache.valueIm === binding.value?.im;
}

function normalizeSequenceBindingCached(binding) {
    if (!binding || typeof binding !== 'object') return normalizeSequenceBinding(binding);
    const cached = NORMALIZED_BINDING_CACHE.get(binding);
    if (cached && sameCachedBinding(cached, binding)) return cached.normalized;
    const normalized = normalizeSequenceBinding(binding);
    NORMALIZED_BINDING_CACHE.set(binding, {
        kind: binding.kind, id: binding.id, symbol: binding.symbol,
        valueRe: binding.value?.re, valueIm: binding.value?.im,
        start: binding.start, step: binding.step, ratio: binding.ratio,
        ordering: binding.ordering, includeZero: binding.includeZero,
        includeNegative: binding.includeNegative, min: binding.min, max: binding.max,
        bound: binding.bound, boundType: binding.boundType,
        associatePolicy: binding.associatePolicy, includeConjugates: binding.includeConjugates,
        generatorExpression: binding.generatorExpression, pointsText: binding.pointsText,
        normalized
    });
    return normalized;
}


function isArrayIndex(property, length) {
    if (typeof property !== 'string' || property.length === 0) return -1;
    const index = property >>> 0;
    return String(index) === property && index < length ? index : -1;
}

function createLazyEnvironments(valueSets, symbols, count) {
    const makeEnvironment = environmentFactory(symbols);
    const target = new Array(count);
    if (!makeEnvironment) {
        for (let row = 0; row < count; row++) target[row] = {};
        return target;
    }
    const materialize = row => target[row] || (target[row] = makeEnvironment(valueSets, row));
    return new Proxy(target, {
        get(array, property, receiver) {
            const row = isArrayIndex(property, count);
            return row >= 0 ? materialize(row) : Reflect.get(array, property, receiver);
        },
        has(array, property) {
            return isArrayIndex(property, count) >= 0 || Reflect.has(array, property);
        },
        getOwnPropertyDescriptor(array, property) {
            const row = isArrayIndex(property, count);
            if (row < 0) return Reflect.getOwnPropertyDescriptor(array, property);
            return { value: materialize(row), writable: true, enumerable: true, configurable: true };
        },
        ownKeys() {
            const keys = new Array(count + 1);
            for (let index = 0; index < count; index++) keys[index] = String(index);
            keys[count] = 'length';
            return keys;
        }
    });
}

function environmentFactory(symbols) {
    if (!symbols.length) return null;
    const key = symbols.join('\u0001');
    const cached = ENVIRONMENT_FACTORY_CACHE.get(key);
    if (cached) return cached;
    const fields = symbols.map((symbol, index) => `${JSON.stringify(symbol)}: sets[${index}][row] || { re: NaN, im: NaN }`).join(',');
    const factory = new Function('sets', 'row', `return ({${fields}});`);
    ENVIRONMENT_FACTORY_CACHE.set(key, factory);
    if (ENVIRONMENT_FACTORY_CACHE.size > 64) ENVIRONMENT_FACTORY_CACHE.delete(ENVIRONMENT_FACTORY_CACHE.keys().next().value);
    return factory;
}

function repeatedComplex(re, im, count) {
    // Repeated parameter/constant bindings are semantically immutable samples; canonicalizing
    // the complex value removes millions of identical object allocations on aggregate redraws.
    return new Array(count).fill({ re, im });
}

function sourceConfig(binding, count) {
    return {
        kind: binding.kind,
        count,
        start: binding.start,
        step: binding.step,
        ratio: binding.ratio,
        ordering: binding.ordering,
        includeZero: binding.includeZero,
        includeNegative: binding.includeNegative,
        min: binding.min,
        max: binding.max,
        bound: binding.bound,
        boundType: binding.boundType,
        associatePolicy: binding.associatePolicy,
        includeConjugates: binding.includeConjugates,
        generatorExpression: binding.generatorExpression,
        pointsText: binding.pointsText,
        points: []
    };
}

export function generateSequenceBindingSeries(bindings, count, runtime = {}) {
    const normalizedCount = Math.max(0, Math.floor(finiteNumber(count, 0)));
    const aggregateParameter = complexValue(runtime.aggregateParameter, { re: 0, im: 0 });
    const series = {};
    const diagnostics = [];
    const symbols = [];
    const valueSets = [];
    const list = bindings || [];

    for (let index = 0; index < list.length; index++) {
        const binding = normalizeSequenceBindingCached(list[index]);
        const symbol = binding.symbol;
        if (!symbol) continue;

        let values;
        if (binding.kind === 'parameter') {
            values = repeatedComplex(aggregateParameter.re, aggregateParameter.im, normalizedCount);
        } else if (binding.kind === 'parameter_real') {
            values = repeatedComplex(aggregateParameter.re, 0, normalizedCount);
        } else if (binding.kind === 'constant') {
            values = repeatedComplex(binding.value.re, binding.value.im, normalizedCount);
        } else {
            const generated = generateDiscreteSource(sourceConfig(binding, normalizedCount), {
                parameters: runtime.parameters || {}
            });
            const records = generated.records || [];
            values = new Array(records.length);
            for (let valueIndex = 0; valueIndex < records.length; valueIndex++) {
                values[valueIndex] = records[valueIndex].domainValue;
            }
            const messages = generated.diagnostics || [];
            for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
                diagnostics.push(`${symbol}: ${messages[messageIndex]}`);
            }
        }
        series[symbol] = values;
        symbols.push(symbol);
        valueSets.push(values);
    }

    const environments = createLazyEnvironments(valueSets, symbols, normalizedCount);

    return { series, environments, diagnostics };
}

export function freeParameterSymbols(source, bindings = []) {
    const symbols = [];
    try {
        const dependencies = collectExpressionDependencies(parseExpression(source));
        if (dependencies.variables.has('s')) symbols.push('s');
    } catch {
        // Formula diagnostics are handled by the expression compiler.
    }
    const list = bindings || [];
    for (let index = 0; index < list.length; index++) {
        const binding = list[index];
        const symbol = binding?.symbol;
        if ((binding?.kind === 'parameter' || binding?.kind === 'parameter_real') && symbol && !symbols.includes(symbol)) {
            symbols.push(symbol);
        }
    }
    return symbols;
}
