import { context, state, mutateState } from '../store/state.js';
import {
    complexAbs,
    setActiveTransformProvider,
    transformFunctions
} from '../math-utils.js';
import {
    asComplex,
    compileExpression,
    finiteComplex
} from '../math/expression/index.js';
import { generateDiscreteSource } from './discrete-sources.js';
import { reduceComplexTerms } from './reducers.js';
import {
    freeParameterSymbols,
    generateSequenceBindingSeries,
    synchronizeSequenceBindings
} from './sequence-bindings.js';

const DEFAULT_POINT_EXPRESSION = 'd';
const DEFAULT_CUSTOM_TERM_EXPRESSION = 'z';
const SELECTED_TERM_EXPRESSION = 'selected(z)';
const RESULT_CACHE_LIMIT = 24;
const transformIds = new WeakMap();
let nextTransformId = 1;
let providerInstalled = false;

const PRESETS = Object.freeze({
    custom: Object.freeze({
        label: 'Custom',
        description: 'Continue from the current construction',
        category: 'Custom',
        config: {}
    }),
    integers_selected: Object.freeze({
        label: 'Integers through selected function',
        description: 'Map integer inputs through the selected function',
        category: 'Maps',
        config: {
            mode: 'map',
            source: { kind: 'integers', count: 50, start: 1, step: 1, ordering: 'ascending' },
            pointExpression: 'd',
            term: { kind: 'selected-function', expression: 'selected(z)', bindings: [] },
            reduction: { kind: 'none', invalidPolicy: 'stop' }
        }
    }),
    arithmetic_progression: Object.freeze({
        label: 'Arithmetic progression',
        description: 'Map d_j = 1 + 2j as a finite discrete sequence',
        category: 'Sequences',
        config: {
            mode: 'map',
            source: { kind: 'arithmetic', count: 50, start: 1, step: 2 },
            pointExpression: 'd',
            term: { kind: 'expression', expression: 'z', bindings: [] },
            reduction: { kind: 'none', invalidPolicy: 'stop' }
        }
    }),
    geometric_progression: Object.freeze({
        label: 'Geometric progression',
        description: 'Map d_j = 2(1.15)^j and watch its growth',
        category: 'Sequences',
        config: {
            mode: 'map',
            source: { kind: 'geometric', count: 40, start: 2, ratio: 1.15 },
            pointExpression: 'd',
            term: { kind: 'expression', expression: 'z', bindings: [] },
            reduction: { kind: 'none', invalidPolicy: 'stop' }
        }
    }),
    harmonic_progression: Object.freeze({
        label: 'Harmonic progression',
        description: 'Map d_j = 1/(1+j) as a reciprocal progression',
        category: 'Sequences',
        config: {
            mode: 'map',
            source: { kind: 'harmonic', count: 50, start: 1, step: 1 },
            pointExpression: 'd',
            term: { kind: 'expression', expression: 'z', bindings: [] },
            reduction: { kind: 'none', invalidPolicy: 'stop' }
        }
    }),
    primes_selected: Object.freeze({
        label: 'Primes through selected function',
        description: 'Map rational primes through the selected function',
        category: 'Maps',
        config: {
            mode: 'map',
            source: { kind: 'primes', count: 50, min: 2, includeNegative: false },
            pointExpression: 'd',
            term: { kind: 'selected-function', expression: 'selected(z)', bindings: [] },
            reduction: { kind: 'none', invalidPolicy: 'stop' }
        }
    }),
    gaussian_primes_square: Object.freeze({
        label: 'Gaussian primes under z^2',
        description: 'Square Gaussian primes and compare both planes',
        category: 'Maps',
        config: {
            mode: 'map',
            source: {
                kind: 'gaussian_primes',
                count: 120,
                bound: 20,
                associatePolicy: 'all',
                includeConjugates: true
            },
            pointExpression: 'd',
            term: { kind: 'expression', expression: 'z^2', bindings: [] },
            reduction: { kind: 'none', invalidPolicy: 'stop' }
        }
    }),
    basel: Object.freeze({
        label: 'Basel series',
        description: 'Approximate pi^2/6 with reciprocal squares',
        category: 'Sums',
        config: {
            mode: 'aggregate',
            source: { kind: 'integers', count: 200, start: 1, step: 1, ordering: 'ascending' },
            pointExpression: 'd',
            term: { kind: 'expression', expression: '1 / d^2', bindings: [] },
            reduction: { kind: 'sum', invalidPolicy: 'stop' },
            aggregateParameter: { re: 0, im: 0 }
        }
    }),
    geometric: Object.freeze({
        label: 'Geometric series',
        description: 'Explore a finite geometric sum as a function of s',
        category: 'Sums',
        config: {
            mode: 'aggregate',
            source: { kind: 'naturals', count: 80, start: 0, step: 1, ordering: 'ascending' },
            pointExpression: 'd',
            term: { kind: 'expression', expression: 's^d', bindings: [] },
            reduction: { kind: 'sum', invalidPolicy: 'stop' },
            aggregateParameter: { re: 0.5, im: 0.2 }
        }
    }),
    alternating_harmonic: Object.freeze({
        label: 'Alternating harmonic',
        description: 'Build 1 - 1/2 + 1/3 - 1/4 + ...',
        category: 'Sums',
        config: {
            mode: 'aggregate',
            source: { kind: 'integers', count: 200, start: 1, step: 1, ordering: 'ascending' },
            pointExpression: 'd',
            term: { kind: 'expression', expression: '(-1)^(d+1) / d', bindings: [] },
            reduction: { kind: 'sum', invalidPolicy: 'stop' }
        }
    }),
    zeta_sum: Object.freeze({
        label: 'Truncated zeta sum',
        description: 'Treat sum n^(-s) as a finite complex function',
        category: 'Sums',
        config: {
            mode: 'aggregate',
            source: { kind: 'integers', count: 100, start: 1, step: 1, ordering: 'ascending' },
            pointExpression: 'd',
            term: { kind: 'expression', expression: 'd^(-s)', bindings: [] },
            reduction: { kind: 'sum', invalidPolicy: 'stop' },
            aggregateParameter: { re: 2, im: 0 }
        }
    }),
    euler_product: Object.freeze({
        label: 'Euler product for zeta',
        description: 'Multiply prime factors (1 - p^(-s))^(-1)',
        category: 'Products',
        config: {
            mode: 'aggregate',
            source: { kind: 'primes', count: 80, min: 2, includeNegative: false },
            pointExpression: 'd',
            term: { kind: 'expression', expression: '1 / (1 - d^(-s))', bindings: [] },
            reduction: { kind: 'product', invalidPolicy: 'stop' },
            aggregateParameter: { re: 2, im: 0 }
        }
    }),
    wallis_product: Object.freeze({
        label: 'Wallis product',
        description: 'Approximate pi/2 with rational factors',
        category: 'Products',
        config: {
            mode: 'aggregate',
            source: { kind: 'integers', count: 150, start: 1, step: 1, ordering: 'ascending' },
            pointExpression: 'd',
            term: { kind: 'expression', expression: '(4d^2) / (4d^2 - 1)', bindings: [] },
            reduction: { kind: 'product', invalidPolicy: 'stop' }
        }
    }),
    exponential_series: Object.freeze({
        label: 'Exponential power series',
        description: 'Build sum x^n/n! with independent rules for x and n',
        category: 'Symbolic',
        config: {
            mode: 'aggregate',
            source: { kind: 'naturals', count: 24, start: 0, step: 1, ordering: 'ascending' },
            pointExpression: 'd',
            term: {
                kind: 'expression',
                expression: 'x^n / n!',
                bindings: [
                    { symbol: 'x', kind: 'parameter', value: { re: 1, im: 0 } },
                    { symbol: 'n', kind: 'naturals', start: 0, step: 1, ordering: 'ascending' }
                ]
            },
            reduction: { kind: 'sum', invalidPolicy: 'stop' },
            aggregateParameter: { re: 1, im: 0 }
        }
    }),
    dirichlet_eta: Object.freeze({
        label: 'Dirichlet eta',
        description: 'Build an alternating parameterized Dirichlet series',
        category: 'Sums',
        config: {
            mode: 'aggregate',
            source: { kind: 'integers', count: 120, start: 1, step: 1, ordering: 'ascending' },
            pointExpression: 'd',
            term: { kind: 'expression', expression: '(-1)^(d-1) * d^(-s)', bindings: [] },
            reduction: { kind: 'sum', invalidPolicy: 'stop' },
            aggregateParameter: { re: 1, im: 0 }
        }
    })
});

function cache() {
    if (!context.dynamicPlotting) {
        context.dynamicPlotting = {
            compilationSignature: null,
            compiled: null,
            sourceSignature: null,
            source: null,
            results: new Map(),
            diagnostics: [],
            hover: { z: null, w: null }
        };
    }
    return context.dynamicPlotting;
}

function clonePlain(value) {
    if (Array.isArray(value)) return value.map(clonePlain);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clonePlain(item)]));
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (!value || typeof value !== 'object') return JSON.stringify(value);

    return `{${Object.keys(value).sort().map(key =>
        `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(',')}}`;
}

function getTransformId(transform) {
    if (typeof transform !== 'function') return 'none';
    if (!transformIds.has(transform)) {
        transformIds.set(transform, nextTransformId);
        nextTransformId += 1;
    }
    return transformIds.get(transform);
}

function dynamicConfig() {
    return state.dynamicPlotting || {};
}

function parameterEnvironment() {
    const environment = {};
    for (const parameter of dynamicConfig().parameters || []) {
        const name = String(parameter?.name || '').trim();
        if (!name) continue;
        environment[name] = { re: Number(parameter.value) || 0, im: 0 };
    }
    return environment;
}

function parameterNames() {
    return Object.keys(parameterEnvironment());
}

function termBindings() {
    const term = dynamicConfig().term || {};
    if (term.kind !== 'expression') return [];
    return synchronizeSequenceBindings(
        String(term.expression ?? DEFAULT_CUSTOM_TERM_EXPRESSION),
        term.bindings || []
    );
}

function allowedVariables(baseVariables) {
    return [
        ...baseVariables,
        ...parameterNames(),
        ...termBindings().map(binding => binding.symbol)
    ];
}

function compilationSignature() {
    const config = dynamicConfig();
    return stableStringify({
        pointExpression: config.pointExpression,
        term: config.term,
        parameterNames: (config.parameters || []).map(parameter => parameter?.name),
        bindingSymbols: termBindings().map(binding => binding.symbol)
    });
}

function compilePipelineExpressions() {
    const runtime = cache();
    const signature = compilationSignature();
    if (runtime.compilationSignature === signature && runtime.compiled) {
        return runtime.compiled;
    }

    const pointSource = String(dynamicConfig().pointExpression ?? DEFAULT_POINT_EXPRESSION);
    const termSource = dynamicConfig().term?.kind === 'selected-function'
        ? SELECTED_TERM_EXPRESSION
        : String(dynamicConfig().term?.expression ?? DEFAULT_CUSTOM_TERM_EXPRESSION);
    const point = compileExpression(pointSource, {
        allowedVariables: allowedVariables(['c', 'd', 'j', 's'])
    });
    const term = compileExpression(termSource, {
        allowedVariables: allowedVariables(['c', 'd', 'j', 'z', 's'])
    });

    runtime.compilationSignature = signature;
    runtime.compiled = { point, term };
    runtime.results.clear();
    return runtime.compiled;
}

function sourceSignature() {
    const source = dynamicConfig().source || {};
    return stableStringify({
        source,
        parameters: parameterEnvironment()
    });
}

function getSource() {
    const runtime = cache();
    const signature = sourceSignature();
    if (runtime.sourceSignature === signature && runtime.source) return runtime.source;

    const sourceConfig = clonePlain(dynamicConfig().source || {});
    if (sourceConfig.kind === 'custom_points') {
        sourceConfig.points = Array.isArray(sourceConfig.points) ? sourceConfig.points : [];
    }

    const source = generateDiscreteSource(sourceConfig, {
        parameters: parameterEnvironment()
    });
    runtime.sourceSignature = signature;
    runtime.source = source;
    runtime.diagnostics = [...source.diagnostics];
    runtime.results.clear();
    return source;
}

function visibleCount(recordCount) {
    const requested = Number(dynamicConfig().playback?.visibleCount);
    if (!Number.isFinite(requested)) return recordCount;
    return Math.max(0, Math.min(recordCount, Math.floor(requested)));
}

function classifyInvalid(value, error) {
    if (error) return 'evaluation-error';
    if (!value || Number.isNaN(value.re) || Number.isNaN(value.im)) return 'not-finite';
    if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) return 'overflow';
    return 'not-finite';
}

function evaluatePoint(
    record,
    compiled,
    environment,
    symbolEnvironment,
    selectedFunction,
    aggregateParameter
) {
    return asComplex(compiled.point({
        ...environment,
        ...symbolEnvironment,
        d: record.domainValue,
        j: { re: record.ordinal, im: 0 },
        s: aggregateParameter,
        c: aggregateParameter,
        selectedFunction
    }));
}

function evaluateTerm(
    record,
    inputPoint,
    compiled,
    environment,
    symbolEnvironment,
    selectedFunction,
    aggregateParameter
) {
    const termConfig = dynamicConfig().term || {};
    if (termConfig.kind === 'selected-function') {
        return asComplex(selectedFunction(inputPoint.re, inputPoint.im));
    }

    return asComplex(compiled.term({
        ...environment,
        ...symbolEnvironment,
        d: record.domainValue,
        j: { re: record.ordinal, im: 0 },
        z: inputPoint,
        s: aggregateParameter,
        c: aggregateParameter,
        selectedFunction
    }));
}

function evaluateSamples(selectedFunction, aggregateParameter, limit = null) {
    const source = getSource();
    const compiled = compilePipelineExpressions();
    const environment = parameterEnvironment();
    const count = limit === null
        ? source.records.length
        : Math.max(0, Math.min(source.records.length, limit));
    const samples = [];
    const bindingResult = generateSequenceBindingSeries(termBindings(), count, {
        aggregateParameter,
        parameters: environment
    });

    for (let index = 0; index < count; index += 1) {
        const sourceRecord = source.records[index];
        const symbolEnvironment = bindingResult.environments[index] || {};
        const sample = {
            id: `${source.kind}:${sourceRecord.ordinal}:${sourceRecord.label}`,
            ordinal: sourceRecord.ordinal,
            domainValue: sourceRecord.domainValue,
            label: sourceRecord.label,
            metadata: sourceRecord.metadata,
            symbolValues: symbolEnvironment,
            inputPoint: null,
            termValue: null,
            status: 'valid',
            error: null,
            partial: null
        };

        try {
            sample.inputPoint = evaluatePoint(
                sourceRecord,
                compiled,
                environment,
                symbolEnvironment,
                selectedFunction,
                aggregateParameter
            );
            if (!finiteComplex(sample.inputPoint)) {
                sample.status = classifyInvalid(sample.inputPoint);
                samples.push(sample);
                continue;
            }

            sample.termValue = evaluateTerm(
                sourceRecord,
                sample.inputPoint,
                compiled,
                environment,
                symbolEnvironment,
                selectedFunction,
                aggregateParameter
            );
            if (!finiteComplex(sample.termValue)) {
                sample.status = classifyInvalid(sample.termValue);
            }
        } catch (error) {
            sample.status = classifyInvalid(null, error);
            sample.error = error?.message || String(error);
        }

        samples.push(sample);
    }

    const reduction = reduceComplexTerms(samples, {
        kind: dynamicConfig().reduction?.kind || 'none',
        invalidPolicy: dynamicConfig().reduction?.invalidPolicy || 'stop'
    });

    return {
        source,
        samples,
        reduction,
        bindingDiagnostics: bindingResult.diagnostics
    };
}

function transformEnvironmentSignature() {
    return {
        currentFunction: state.currentFunction,
        mobius: [state.mobiusA, state.mobiusB, state.mobiusC, state.mobiusD],
        polynomialN: state.polynomialN,
        polynomialCoefficients: state.polynomialCoeffs,
        fractionalPower: state.fractionalPowerN,
        zetaContinuation: state.zetaContinuationEnabled,
        taylor: {
            enabled: state.taylorSeriesEnabled,
            order: state.taylorSeriesOrder,
            center: state.taylorSeriesCenter,
            radius: state.taylorSeriesRadius
        },
        chaining: {
            enabled: state.chainingEnabled,
            mode: state.chainingMode,
            count: state.chainCount
        },
        algebraicTerms: state.algebraicChainingTerms
    };
}

function resultSignature(selectedFunction, aggregateParameter, stageIndex) {
    const config = dynamicConfig();
    return stableStringify({
        source: config.source,
        pointExpression: config.pointExpression,
        term: config.term,
        reduction: config.reduction,
        parameters: parameterEnvironment(),
        aggregateParameter,
        stageIndex,
        transformId: getTransformId(selectedFunction),
        transformEnvironment: transformEnvironmentSignature()
    });
}

function enforceCacheLimit(results) {
    while (results.size > RESULT_CACHE_LIMIT) {
        results.delete(results.keys().next().value);
    }
}

function reductionForVisibleSamples(samples, kind) {
    const included = [...samples].reverse().find(sample => sample.reductionStatus === 'included');
    const stopped = samples.some(sample => sample.reductionStatus === 'stopped');

    if (kind === 'sum') {
        return {
            kind,
            stopped,
            finalValue: included?.partial?.value || { re: 0, im: 0 },
            product: null
        };
    }

    if (kind === 'product') {
        const partial = included?.partial || {
            value: { re: 1, im: 0 },
            normalized: { re: 1, im: 0 },
            logAbs: 0,
            argument: 0,
            zero: false,
            finite: true
        };
        return {
            kind,
            stopped,
            finalValue: partial.value,
            product: {
                value: partial.value,
                normalized: partial.normalized,
                logAbs: partial.logAbs,
                argument: partial.argument,
                zero: partial.zero,
                finite: partial.finite
            }
        };
    }

    return {
        kind,
        stopped,
        finalValue: included?.termValue || null,
        product: null
    };
}

export function getDynamicPlotResult(options = {}) {
    if (!dynamicConfig().enabled) return null;

    const selectedFunction = typeof options.transform === 'function'
        ? options.transform
        : transformFunctions[state.currentFunction] || ((re, im) => ({ re, im }));
    const aggregateParameter = asComplex(
        options.aggregateParameter || dynamicConfig().aggregateParameter || { re: 0, im: 0 }
    );
    const stageIndex = Number(options.stageIndex) || 0;
    const signature = resultSignature(selectedFunction, aggregateParameter, stageIndex);
    const runtime = cache();

    let result = runtime.results.get(signature);
    if (!result) {
        const evaluated = evaluateSamples(selectedFunction, aggregateParameter);
        result = {
            ...evaluated,
            aggregateParameter,
            sourceDiagnostics: evaluated.source.diagnostics,
            bindingDiagnostics: evaluated.bindingDiagnostics
        };
        runtime.results.set(signature, result);
        enforceCacheLimit(runtime.results);
    }

    const count = visibleCount(result.samples.length);
    const visibleSamples = result.samples.slice(0, count);
    return {
        ...result,
        visibleCount: count,
        visibleSamples,
        reduction: reductionForVisibleSamples(
            visibleSamples,
            dynamicConfig().reduction?.kind || 'none'
        ),
        validCount: visibleSamples.filter(sample => sample.status === 'valid').length,
        invalidCount: visibleSamples.filter(sample => sample.status !== 'valid').length,
        diagnostics: [
            ...result.sourceDiagnostics,
            ...(result.bindingDiagnostics || []),
            ...visibleSamples
                .filter(sample => sample.error)
                .slice(0, 5)
                .map(sample => `Term ${sample.ordinal}: ${sample.error}`)
        ]
    };
}

export function evaluateDynamicAggregateAt(value, selectedFunction) {
    const s = asComplex(value);
    const count = visibleCount(getSource().records.length);
    const evaluated = evaluateSamples(selectedFunction, s, count);
    return evaluated.reduction.finalValue || { re: NaN, im: NaN };
}

export function createDynamicAggregateTransform(selectedFunction) {
    const transform = (re, im) => evaluateDynamicAggregateAt({ re, im }, selectedFunction);
    transform.dynamicPlottingTransform = true;
    transform.dynamicPlottingBaseTransform = selectedFunction;
    return transform;
}

export function isDynamicAggregateActive() {
    const config = dynamicConfig();
    return Boolean(
        config.enabled &&
        config.mode === 'aggregate' &&
        (config.reduction?.kind === 'sum' || config.reduction?.kind === 'product')
    );
}

export function initializeDynamicPlottingEngine() {
    if (providerInstalled) return;

    setActiveTransformProvider(({ baseFunc }) => {
        if (!isDynamicAggregateActive()) return baseFunc;

        const runtime = cache();
        const signature = stableStringify({
            baseTransform: getTransformId(baseFunc),
            config: {
                source: dynamicConfig().source,
                pointExpression: dynamicConfig().pointExpression,
                term: dynamicConfig().term,
                reduction: dynamicConfig().reduction,
                parameters: dynamicConfig().parameters,
                visibleCount: dynamicConfig().playback?.visibleCount
            }
        });

        if (runtime.activeTransformSignature !== signature) {
            runtime.activeTransformSignature = signature;
            runtime.activeTransform = createDynamicAggregateTransform(baseFunc);
        }
        return runtime.activeTransform;
    });

    providerInstalled = true;
}

export function invalidateDynamicPlotting() {
    const runtime = cache();
    runtime.compilationSignature = null;
    runtime.compiled = null;
    runtime.sourceSignature = null;
    runtime.source = null;
    runtime.activeTransformSignature = null;
    runtime.activeTransform = null;
    runtime.results.clear();
    runtime.diagnostics = [];
}

export function getDynamicPlottingDiagnostics() {
    try {
        const result = getDynamicPlotResult();
        return result?.diagnostics || [];
    } catch (error) {
        return [error?.message || String(error)];
    }
}

export function getDynamicPlottingPresets() {
    return Object.entries(PRESETS).map(([id, preset]) => ({
        id,
        label: preset.label,
        description: preset.description,
        category: preset.category
    }));
}

export function getDynamicTermBindings() {
    return termBindings();
}

export function getDynamicFreeParameterSymbols() {
    const term = dynamicConfig().term || {};
    if (term.kind !== 'expression') return [];
    return freeParameterSymbols(String(term.expression || ''), termBindings());
}

function mergeConfig(target, source) {
    for (const [key, value] of Object.entries(source || {})) {
        if (Array.isArray(value)) {
            target[key] = clonePlain(value);
        } else if (value && typeof value === 'object') {
            if (!target[key] || typeof target[key] !== 'object') target[key] = {};
            mergeConfig(target[key], value);
        } else {
            target[key] = value;
        }
    }
}

export function applyDynamicPlottingPreset(presetId) {
    const preset = PRESETS[presetId];
    if (!preset) throw new Error(`Unknown Dynamic Plotting preset "${presetId}"`);

    mutateState('dynamicPlotting', dynamic => {
        mergeConfig(dynamic, clonePlain(preset.config));
        dynamic.preset = presetId;
        dynamic.playback.visibleCount = Math.min(
            Number(dynamic.source.count) || 0,
            Number(dynamic.playback.visibleCount) || Number(dynamic.source.count) || 0
        );
        if (presetId !== 'custom') {
            dynamic.playback.visibleCount = Number(dynamic.source.count) || 0;
        }
    });
    invalidateDynamicPlotting();
}

export function formatDynamicValue(value, digits = 6) {
    if (!finiteComplex(value)) return 'undefined';
    const normalize = number => Number((Math.abs(number) < 1e-12 ? 0 : number).toFixed(digits));
    const re = normalize(value.re);
    const im = normalize(value.im);
    if (im === 0) return `${re}`;
    if (re === 0) return `${im}i`;
    return `${re}${im >= 0 ? '+' : ''}${im}i`;
}

export function dynamicResultMagnitude(result) {
    return result?.reduction?.finalValue ? complexAbs(result.reduction.finalValue) : NaN;
}

export function getDynamicPlottingCacheKey() {
    const config = dynamicConfig();
    if (!config.enabled) return 'off';
    return stableStringify({
        mode: config.mode,
        source: config.source,
        pointExpression: config.pointExpression,
        term: config.term,
        reduction: config.reduction,
        parameters: config.parameters,
        aggregateParameter: config.aggregateParameter,
        visibleCount: config.playback?.visibleCount,
        display: config.display,
        transformEnvironment: transformEnvironmentSignature()
    });
}

export function getDynamicFunctionFormulaHtml() {
    const config = dynamicConfig();
    const reduction = config.reduction?.kind;
    if (!config.enabled || config.mode !== 'aggregate' || (reduction !== 'sum' && reduction !== 'product')) {
        return null;
    }

    const aggregate = reduction === 'sum' ? 'S' : 'P';
    const parameterSymbols = getDynamicFreeParameterSymbols();
    const count = Math.max(0, Number(config.playback?.visibleCount) || 0);
    const parameter = parameterSymbols.length ? `(${parameterSymbols.join(',')})` : '';
    return `${aggregate}<sub>${count}</sub>${parameter}`;
}
