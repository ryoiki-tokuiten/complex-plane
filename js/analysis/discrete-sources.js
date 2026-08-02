import {
    asBoolean,
    asComplex,
    compileExpression,
    finiteComplex,
    isPrimeInteger
} from '../math/expression/index.js';
import { MAX_POINTS_ADAPTIVE_DEFAULT } from '../constants/numerical.js';

const DEFAULT_COUNT = 50;
const ZERO_TOLERANCE = 1e-12;
export const MAX_DYNAMIC_SOURCE_COUNT = MAX_POINTS_ADAPTIVE_DEFAULT;
const MAX_GENERATOR_ATTEMPTS = MAX_DYNAMIC_SOURCE_COUNT * 100;

function clampInteger(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function normalizeCount(value) {
    return clampInteger(value, 0, MAX_DYNAMIC_SOURCE_COUNT, DEFAULT_COUNT);
}

function record(ordinal, domainValue, label, metadata = {}) {
    return {
        ordinal,
        domainValue: asComplex(domainValue),
        label: label ?? formatComplex(domainValue),
        metadata
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
    const imaginary = magnitude === 1 ? 'i' : `${clean(magnitude)}i`;
    return `${clean(z.re)}${sign}${imaginary}`;
}

export function generateIntegerValues(config = {}) {
    const count = normalizeCount(config.count);
    const start = Number.isFinite(Number(config.start)) ? Number(config.start) : 1;
    const numericStep = Number(config.step);
    const step = Number.isFinite(numericStep) && (numericStep !== 0 || config.allowZeroStep)
        ? numericStep
        : 1;
    const ordering = config.ordering || 'ascending';
    const values = [];

    if (ordering === 'symmetric') {
        const includeZero = Boolean(config.includeZero);
        let radius = Math.max(1, Math.abs(start));
        if (includeZero && values.length < count) values.push(0);

        while (values.length < count) {
            values.push(radius);
            if (values.length < count) values.push(-radius);
            radius += Math.abs(step);
        }
        return values;
    }

    for (let index = 0; index < count; index += 1) {
        values.push(start + index * step);
    }

    return values;
}

export function generateGeometricValues(config = {}) {
    const count = normalizeCount(config.count);
    const first = Number.isFinite(Number(config.start)) ? Number(config.start) : 1;
    const ratio = Number.isFinite(Number(config.ratio)) ? Number(config.ratio) : 2;
    const values = [];
    let current = first;

    for (let index = 0; index < count; index += 1) {
        values.push(current);
        current *= ratio;
    }

    return values;
}

export function generateHarmonicValues(config = {}) {
    const count = normalizeCount(config.count);
    const firstDenominator = Number.isFinite(Number(config.start)) ? Number(config.start) : 1;
    const difference = Number.isFinite(Number(config.step)) ? Number(config.step) : 1;
    const values = [];

    for (let index = 0; index < count; index += 1) {
        const denominator = firstDenominator + index * difference;
        values.push(Math.abs(denominator) <= ZERO_TOLERANCE
            ? { re: NaN, im: NaN }
            : 1 / denominator);
    }

    return values;
}

export function generatePrimeValues(config = {}) {
    const count = normalizeCount(config.count);
    if (count === 0) return [];
    const min = Math.max(2, Math.floor(Number(config.min) || 2));
    const hasMaximum = config.max !== '' && config.max !== null &&
        config.max !== undefined && Number.isFinite(Number(config.max));
    const maxValue = hasMaximum ? Math.floor(Number(config.max)) : Number.MAX_SAFE_INTEGER;
    const primeTarget = config.includeNegative ? Math.ceil(count / 2) : count;
    const primes = [];
    let candidate = min <= 2 ? 2 : min % 2 === 0 ? min + 1 : min;

    while (primes.length < primeTarget && candidate <= maxValue) {
        if (isPrimeInteger(candidate)) primes.push(candidate);
        candidate = candidate === 2 ? 3 : candidate + 2;
    }

    if (!config.includeNegative) return primes;

    const signed = [];
    for (const prime of primes) {
        signed.push(prime);
        if (signed.length < count) signed.push(-prime);
        if (signed.length >= count) break;
    }
    return signed;
}

export function isGaussianPrime(a, b) {
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || (a === 0 && b === 0)) {
        return false;
    }

    if (a !== 0 && b !== 0) {
        return isPrimeInteger(a * a + b * b);
    }

    const axisValue = Math.abs(a || b);
    return isPrimeInteger(axisValue) && axisValue % 4 === 3;
}

function gaussianSort(left, right) {
    const leftNorm = left.re * left.re + left.im * left.im;
    const rightNorm = right.re * right.re + right.im * right.im;
    if (leftNorm !== rightNorm) return leftNorm - rightNorm;

    const leftAngle = Math.atan2(left.im, left.re);
    const rightAngle = Math.atan2(right.im, right.re);
    if (leftAngle !== rightAngle) return leftAngle - rightAngle;
    if (left.re !== right.re) return left.re - right.re;
    return left.im - right.im;
}

function isCanonicalAssociate(a, b, includeConjugates) {
    if (includeConjugates) {
        return a > 0 || (a === 0 && b > 0);
    }
    return a > 0 && b >= 0;
}

export function generateGaussianIntegerValues(config = {}) {
    const initialBound = Math.max(1, Math.floor(Number(config.bound) || 8));
    const count = normalizeCount(config.count);
    if (count === 0) return [];
    const normBound = config.boundType === 'norm';
    let searchBound = Math.max(initialBound, Math.ceil(Math.sqrt(count)));

    while (true) {
        const values = [];
        for (let a = -searchBound; a <= searchBound; a += 1) {
            for (let b = -searchBound; b <= searchBound; b += 1) {
                if (!config.includeZero && a === 0 && b === 0) continue;
                if (normBound && a * a + b * b > searchBound * searchBound) continue;
                values.push({ re: a, im: b });
            }
        }

        values.sort(gaussianSort);
        if (values.length >= count) return values.slice(0, count);
        searchBound *= 2;
    }
}

export function generateGaussianPrimeValues(config = {}) {
    const count = normalizeCount(config.count);
    if (count === 0) return [];
    const initialBound = Math.max(1, Math.floor(Number(config.bound) || 12));
    const allAssociates = config.associatePolicy !== 'representatives';
    const includeConjugates = config.includeConjugates !== false;
    const normBound = config.boundType !== 'square';
    let searchBound = Math.max(initialBound, Math.ceil(Math.sqrt(count)));

    while (true) {
        const values = [];
        for (let a = -searchBound; a <= searchBound; a += 1) {
            for (let b = -searchBound; b <= searchBound; b += 1) {
                if (normBound && a * a + b * b > searchBound * searchBound) continue;
                if (!isGaussianPrime(a, b)) continue;
                if (!allAssociates && !isCanonicalAssociate(a, b, includeConjugates)) continue;
                if (!includeConjugates && b < 0) continue;
                values.push({ re: a, im: b });
            }
        }

        values.sort(gaussianSort);
        if (values.length >= count) return values.slice(0, count);
        searchBound *= 2;
    }
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

    return source
        .split(/[\n;]+/)
        .map(entry => entry.trim())
        .filter(Boolean)
        .map(entry => {
            const imaginaryCoefficient = value => {
                if (value === '' || value === '+') return 1;
                if (value === '-') return -1;
                return Number(value);
            };
            const commaParts = entry.split(',').map(part => Number(part.trim()));
            if (commaParts.length === 2 && commaParts.every(Number.isFinite)) {
                return { re: commaParts[0], im: commaParts[1] };
            }

            const normalized = entry.replace(/\s+/g, '');
            const match = normalized.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))?([+-](?:\d+(?:\.\d*)?|\.\d+)?)i$/i);
            if (match) {
                return {
                    re: match[1] ? Number(match[1]) : 0,
                    im: imaginaryCoefficient(match[2])
                };
            }

            const imaginaryOnly = normalized.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)?)i$/i);
            if (imaginaryOnly) {
                return { re: 0, im: imaginaryCoefficient(imaginaryOnly[1]) };
            }

            const real = Number(normalized);
            return Number.isFinite(real) ? { re: real, im: 0 } : null;
        })
        .filter(Boolean);
}

function generateExpressionValues(config, runtime = {}) {
    const count = normalizeCount(config.count);
    const expression = compileExpression(String(config.generatorExpression ?? 'j'), {
        allowedVariables: ['j', ...Object.keys(runtime.parameters || {})]
    });
    const predicateSource = String(config.filterExpression || '').trim();
    const predicate = predicateSource
        ? compileExpression(predicateSource, {
            allowedVariables: ['d', 'j', ...Object.keys(runtime.parameters || {})]
        })
        : null;
    const attemptLimit = clampInteger(
        config.maxAttempts,
        count,
        MAX_GENERATOR_ATTEMPTS,
        Math.max(count * 100, MAX_DYNAMIC_SOURCE_COUNT)
    );
    const values = [];
    const evaluationDiagnostics = [];
    let attempts = 0;

    while (values.length < count && attempts < attemptLimit) {
        const environment = {
            ...runtime.parameters,
            j: { re: attempts, im: 0 }
        };
        try {
            const value = asComplex(expression(environment));

            if (finiteComplex(value)) {
                const keep = !predicate || asBoolean(predicate({
                    ...environment,
                    d: value
                }));
                if (keep) values.push(value);
            }
        } catch (error) {
            const message = `j=${attempts}: ${error?.message || String(error)}`;
            if (!evaluationDiagnostics.includes(message) && evaluationDiagnostics.length < 3) {
                evaluationDiagnostics.push(message);
            }
        }

        attempts += 1;
    }

    return {
        values,
        diagnostics: [
            ...evaluationDiagnostics,
            ...(values.length < count
                ? [`Generated ${values.length} of ${count} requested values after ${attempts} attempts.`]
                : [])
        ]
    };
}

export function generateDiscreteSource(config = {}, runtime = {}) {
    const kind = config.kind || 'integers';
    let values;
    let diagnostics = [];

    switch (kind) {
        case 'naturals':
            values = generateIntegerValues({ ...config, start: Math.max(0, Number(config.start) || 0) });
            break;
        case 'integers':
            values = generateIntegerValues(config);
            break;
        case 'arithmetic':
            values = generateIntegerValues({ ...config, allowZeroStep: true });
            break;
        case 'geometric':
            values = generateGeometricValues(config);
            break;
        case 'harmonic':
            values = generateHarmonicValues(config);
            break;
        case 'primes':
            values = generatePrimeValues(config);
            break;
        case 'gaussian_integers':
            values = generateGaussianIntegerValues(config);
            break;
        case 'gaussian_primes':
            values = generateGaussianPrimeValues(config);
            break;
        case 'custom_points':
            values = [
                ...(Array.isArray(config.points) ? config.points.map(parseCustomPoint).filter(Boolean) : []),
                ...parseCustomPointText(config.pointsText)
            ];
            values = values.slice(0, normalizeCount(config.count));
            break;
        case 'expression': {
            const generated = generateExpressionValues(config, runtime);
            values = generated.values;
            diagnostics = generated.diagnostics;
            break;
        }
        default:
            throw new Error(`Unknown discrete source kind "${kind}"`);
    }

    const generatedCount = values.length;
    values = values.filter(finiteComplex);
    const invalidCount = generatedCount - values.length;
    if (invalidCount > 0) {
        diagnostics.push(
            `${invalidCount} source value${invalidCount === 1 ? ' was' : 's were'} undefined or outside the numeric range and ${invalidCount === 1 ? 'was' : 'were'} omitted.`
        );
    }

    const requestedCount = normalizeCount(config.count);
    if (
        kind === 'primes' &&
        config.max !== '' &&
        config.max !== null &&
        config.max !== undefined &&
        values.length < requestedCount
    ) {
        diagnostics.push(`The selected prime interval contains ${values.length} values.`);
    }

    return {
        kind,
        records: values.map((value, ordinal) => record(
            ordinal,
            value,
            formatComplex(value),
            { sourceKind: kind }
        )),
        diagnostics
    };
}
