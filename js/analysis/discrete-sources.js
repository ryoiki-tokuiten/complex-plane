import { MAX_POINTS_ADAPTIVE_DEFAULT } from '../constants/numerical.js';
import { generateNativeDiscreteValues, EXPRESSION_ERROR_MESSAGES } from '../native/complex-engine.js';
import {
    requireFiniteComplex,
    requireFiniteNumber,
    requireInteger
} from '../utils/numeric-contracts.js';

export const MAX_DYNAMIC_SOURCE_COUNT = MAX_POINTS_ADAPTIVE_DEFAULT;
const MAX_GENERATOR_ATTEMPTS = MAX_DYNAMIC_SOURCE_COUNT * 100;

function normalizeCount(value) {
    const count = requireInteger(value, 'Discrete-source count');
    if (count < 0 || count > MAX_DYNAMIC_SOURCE_COUNT) {
        throw new Error(`Discrete-source count must be between 0 and ${MAX_DYNAMIC_SOURCE_COUNT}.`);
    }
    return count;
}

function asComplex(value) {
    if (typeof value === 'number') {
        return { re: requireFiniteNumber(value, 'Discrete-source value'), im: 0 };
    }
    const point = requireFiniteComplex(value, 'Discrete-source value');
    return { re: point.re, im: point.im };
}

function record(ordinal, domainValue, kind) {
    return {
        ordinal,
        domainValue,
        label: formatComplex(domainValue),
        metadata: { sourceKind: kind }
    };
}

export function formatComplex(value, digits = 6) {
    const z = asComplex(value);
    const clean = number => {
        const normalized = Math.abs(number) < 1e-12 ? 0 : number;
        return Number(normalized.toFixed(digits)).toString();
    };
    if (z.im === 0) return clean(z.re);
    if (z.re === 0) {
        if (z.im === 1) return 'i';
        if (z.im === -1) return '-i';
        return `${clean(z.im)}i`;
    }
    const sign = z.im >= 0 ? '+' : '-';
    const magnitude = Math.abs(z.im);
    return `${clean(z.re)}${sign}${magnitude === 1 ? 'i' : `${clean(magnitude)}i`}`;
}

function parseCustomPoint(value) {
    if (Array.isArray(value) && value.length >= 2) {
        return {
            re: requireFiniteNumber(value[0], 'Custom-point real component'),
            im: requireFiniteNumber(value[1], 'Custom-point imaginary component')
        };
    }
    return asComplex(value);
}

export function parseCustomPointText(text) {
    const source = String(text ?? '').trim();
    if (!source) return [];
    return source.split(/[\n;]+/).map(entry => entry.trim()).filter(Boolean).map(entry => {
        const imaginaryCoefficient = value => value === '' || value === '+' ? 1 : value === '-' ? -1 : Number(value);
        const commaParts = entry.split(',').map(part => Number(part.trim()));
        if (commaParts.length === 2 && commaParts.every(Number.isFinite)) {
            return { re: commaParts[0], im: commaParts[1] };
        }
        const normalized = entry.replace(/\s+/g, '');
        const cartesian = normalized.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))?([+-](?:\d+(?:\.\d*)?|\.\d+)?)i$/i);
        if (cartesian) {
            return { re: cartesian[1] ? Number(cartesian[1]) : 0, im: imaginaryCoefficient(cartesian[2]) };
        }
        const imaginary = normalized.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)?)i$/i);
        if (imaginary) return { re: 0, im: imaginaryCoefficient(imaginary[1]) };
        const real = Number(normalized);
        if (!Number.isFinite(real)) throw new Error(`Invalid custom complex point: ${entry}.`);
        return { re: real, im: 0 };
    });
}

function nativeConfig(config, kind, count) {
    const normalized = {
        start: 0,
        step: 1,
        ratio: 1,
        min: 2,
        max: Number.MAX_SAFE_INTEGER,
        bound: 1,
        maxAttempts: count,
        kind,
        count
    };
    if (kind === 'naturals') {
        normalized.start = requireFiniteNumber(config.start, 'Natural-source start');
        normalized.step = requireFiniteNumber(config.step, 'Natural-source step');
        if (normalized.start < 0 || normalized.step === 0) {
            throw new Error('Natural sources require a non-negative start and non-zero step.');
        }
    } else if (kind === 'integers') {
        normalized.start = requireFiniteNumber(config.start, 'Integer-source start');
        normalized.step = requireFiniteNumber(config.step, 'Integer-source step');
        if (normalized.step === 0) throw new Error('Integer-source step must be non-zero.');
        normalized.ordering = config.ordering;
        normalized.includeZero = Boolean(config.includeZero);
        normalized.includeNegative = Boolean(config.includeNegative);
    } else if (kind === 'arithmetic') {
        normalized.start = requireFiniteNumber(config.start, 'Arithmetic-source start');
        normalized.step = requireFiniteNumber(config.step, 'Arithmetic-source step');
    } else if (kind === 'geometric') {
        normalized.start = requireFiniteNumber(config.start, 'Geometric-source start');
        normalized.ratio = requireFiniteNumber(config.ratio, 'Geometric-source ratio');
    } else if (kind === 'harmonic') {
        normalized.start = requireFiniteNumber(config.start, 'Harmonic-source start');
        normalized.step = requireFiniteNumber(config.step, 'Harmonic-source step');
    } else if (kind === 'primes') {
        normalized.min = requireInteger(config.min, 'Prime-source minimum');
        if (normalized.min < 2) throw new Error('Prime-source minimum must be at least 2.');
        normalized.max = config.max === '' || config.max === null || config.max === undefined
            ? Number.MAX_SAFE_INTEGER
            : requireInteger(config.max, 'Prime-source maximum');
        normalized.includeNegative = Boolean(config.includeNegative);
    } else if (kind === 'gaussian_integers') {
        normalized.bound = requireInteger(config.bound, 'Gaussian-integer bound');
        if (normalized.bound < 1) throw new Error('Gaussian-integer bound must be positive.');
        normalized.boundType = config.boundType;
        normalized.associatePolicy = config.associatePolicy;
        normalized.includeConjugates = Boolean(config.includeConjugates);
    } else if (kind === 'gaussian_primes') {
        normalized.bound = requireInteger(config.bound, 'Gaussian-prime bound');
        if (normalized.bound < 1) throw new Error('Gaussian-prime bound must be positive.');
        normalized.boundType = config.boundType;
        normalized.associatePolicy = config.associatePolicy;
        normalized.includeConjugates = Boolean(config.includeConjugates);
    } else if (kind === 'expression') {
        if (typeof config.generatorExpression !== 'string' || !config.generatorExpression.trim()) {
            throw new Error('Expression sources require a generator expression.');
        }
        if (config.filterExpression !== undefined && typeof config.filterExpression !== 'string') {
            throw new Error('Expression-source filters must be strings.');
        }
        normalized.generatorExpression = config.generatorExpression;
        normalized.filterExpression = config.filterExpression?.trim() ?? '';
        normalized.maxAttempts = config.maxAttempts === undefined
            ? Math.min(MAX_GENERATOR_ATTEMPTS, Math.max(count * 100, MAX_DYNAMIC_SOURCE_COUNT))
            : requireInteger(config.maxAttempts, 'Expression-source attempt limit');
        if (normalized.maxAttempts < count || normalized.maxAttempts > MAX_GENERATOR_ATTEMPTS) {
            throw new Error(`Expression-source attempt limit must be between ${count} and ${MAX_GENERATOR_ATTEMPTS}.`);
        }
    } else {
        throw new Error(`Unsupported discrete-source kind: ${kind}.`);
    }
    return normalized;
}

export function generateDiscreteSource(config, runtime = { parameters: {} }) {
    if (!config || typeof config !== 'object') throw new Error('Discrete-source configuration is required.');
    const kind = config.kind;
    if (typeof kind !== 'string' || !kind) throw new Error('Discrete-source kind is required.');
    const count = normalizeCount(config.count);
    if (kind === 'custom_points') {
        if (!Array.isArray(config.points)) throw new Error('Custom-point sources require a points array.');
        const values = [
            ...config.points.map(parseCustomPoint),
            ...parseCustomPointText(config.pointsText)
        ].slice(0, count);
        return { kind, records: values.map((value, ordinal) => record(ordinal, value, kind)), diagnostics: [] };
    }

    const native = generateNativeDiscreteValues(nativeConfig(config, kind, count), runtime);
    const diagnostics = [];
    let reported = 0;
    for (let attempt = 0; attempt < native.attemptErrors.length && reported < 3; ++attempt) {
        const error = native.attemptErrors[attempt];
        if (!error) continue;
        diagnostics.push(`j=${attempt}: ${EXPRESSION_ERROR_MESSAGES[error] || `Native expression error ${error}`}`);
        ++reported;
    }
    if (kind === 'expression' && native.values.length < count) {
        diagnostics.push(`Generated ${native.values.length} of ${count} requested values after ${native.attempts} attempts.`);
    }
    if (native.invalidCount) {
        diagnostics.push(
            `${native.invalidCount} source value${native.invalidCount === 1 ? ' was' : 's were'} undefined or outside the numeric range and ${native.invalidCount === 1 ? 'was' : 'were'} omitted.`
        );
    }
    if (kind === 'primes' && config.max !== '' && config.max !== null &&
        config.max !== undefined && native.values.length < count) {
        diagnostics.push(`The selected prime interval contains ${native.values.length} values.`);
    }
    return {
        kind,
        records: native.values.map((value, ordinal) => record(ordinal, value, kind)),
        diagnostics
    };
}
