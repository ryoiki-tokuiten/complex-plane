import { MAX_POINTS_ADAPTIVE_DEFAULT } from '../constants/numerical.js';
import { generateNativeDiscreteValues } from '../native/complex-engine.js';

const DEFAULT_COUNT = 50;
export const MAX_DYNAMIC_SOURCE_COUNT = MAX_POINTS_ADAPTIVE_DEFAULT;
const MAX_GENERATOR_ATTEMPTS = MAX_DYNAMIC_SOURCE_COUNT * 100;

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

function finiteNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function clampInteger(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function normalizeCount(value) {
    return clampInteger(value, 0, MAX_DYNAMIC_SOURCE_COUNT, DEFAULT_COUNT);
}

function finiteComplex(value) {
    return Number.isFinite(Number(value?.re)) && Number.isFinite(Number(value?.im));
}

function asComplex(value) {
    if (typeof value === 'number') return { re: value, im: 0 };
    return { re: Number(value?.re), im: Number(value?.im) };
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
    if (finiteComplex(value)) return asComplex(value);
    if (Array.isArray(value) && value.length >= 2) {
        const point = { re: Number(value[0]), im: Number(value[1]) };
        return finiteComplex(point) ? point : null;
    }
    return null;
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
        return Number.isFinite(real) ? { re: real, im: 0 } : null;
    }).filter(Boolean);
}

function nativeConfig(config, kind, count) {
    const normalized = { ...config, kind, count };
    if (kind === 'naturals') {
        normalized.start = Math.max(0, Number(config.start) || 0);
        normalized.step = finiteNumber(config.step, 1);
        if (!normalized.step) normalized.step = 1;
    } else if (kind === 'integers') {
        normalized.start = finiteNumber(config.start, 1);
        normalized.step = finiteNumber(config.step, 1);
        if (!normalized.step) normalized.step = 1;
    } else if (kind === 'arithmetic') {
        normalized.start = finiteNumber(config.start, 1);
        normalized.step = finiteNumber(config.step, 1);
    } else if (kind === 'geometric') {
        normalized.start = finiteNumber(config.start, 1);
        normalized.ratio = finiteNumber(config.ratio, 2);
    } else if (kind === 'harmonic') {
        normalized.start = finiteNumber(config.start, 1);
        normalized.step = finiteNumber(config.step, 1);
    } else if (kind === 'primes') {
        normalized.min = Math.max(2, Math.floor(Number(config.min) || 2));
        normalized.max = config.max !== '' && config.max !== null && config.max !== undefined &&
            Number.isFinite(Number(config.max)) ? Math.floor(Number(config.max)) : Number.MAX_SAFE_INTEGER;
    } else if (kind === 'gaussian_integers') {
        normalized.bound = Math.max(1, Math.floor(Number(config.bound) || 8));
    } else if (kind === 'gaussian_primes') {
        normalized.bound = Math.max(1, Math.floor(Number(config.bound) || 12));
    } else if (kind === 'expression') {
        normalized.generatorExpression = String(config.generatorExpression ?? 'j');
        normalized.filterExpression = String(config.filterExpression || '').trim();
        normalized.maxAttempts = clampInteger(
            config.maxAttempts, count, MAX_GENERATOR_ATTEMPTS,
            Math.max(count * 100, MAX_DYNAMIC_SOURCE_COUNT)
        );
    }
    return normalized;
}

export function generateDiscreteSource(config = {}, runtime = {}) {
    const kind = config.kind || 'integers';
    const count = normalizeCount(config.count);
    if (kind === 'custom_points') {
        const values = [
            ...(Array.isArray(config.points) ? config.points.map(parseCustomPoint).filter(Boolean) : []),
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
