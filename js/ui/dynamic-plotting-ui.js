import { state, mutateState } from '../store/state.js';
import {
    applyDynamicPlottingPreset,
    getDynamicPlotResult,
    getDynamicFreeParameterSymbols,
    getDynamicPlottingPresets,
    getDynamicTermBindings,
    invalidateDynamicPlotting
} from '../analysis/dynamic-plotting.js';
import {
    formatComplex,
    generateDiscreteSource,
    MAX_DYNAMIC_SOURCE_COUNT
} from '../analysis/discrete-sources.js';
import {
    SEQUENCE_BINDING_KINDS,
    synchronizeSequenceBindings
} from '../analysis/sequence-bindings.js';
import {
    composeProductExpression,
    createAggregateMathML,
    createExpressionMathML,
    createGeneralTermMathML,
    createProductFactor,
    decomposeProductExpression
} from '../math/expression/index.js';
import { createElement, createSelect } from './dom-components.js';

const SOURCE_GROUPS = Object.freeze({
    integers: [],
    naturals: [],
    arithmetic: ['dynamic_arithmetic_options'],
    geometric: ['dynamic_geometric_options'],
    harmonic: ['dynamic_harmonic_options'],
    primes: ['dynamic_prime_options'],
    gaussian_integers: ['dynamic_gaussian_options'],
    gaussian_primes: ['dynamic_gaussian_options'],
    custom_points: ['dynamic_custom_points_options'],
    expression: ['dynamic_expression_source_options']
});

let redraw = () => {};
let animationHandle = null;
let lastAnimationTime = 0;
let formulaTimer = null;
let initialized = false;
let studioMinimized = false;
let sourcePreviewCacheKey = null;
let sourcePreviewCache = null;
let termFactorSource = null;
let termFactors = [];

const OPERATION_COPY = Object.freeze({
    none: {
        badge: 'Map',
        subtitle: 'Keep every term as its own output point',
        explanation: 'Each source value produces one output term.'
    },
    sum: {
        badge: 'Sum',
        subtitle: 'Add the terms in source order',
        explanation: 'Terms are added in sequence order.'
    },
    product: {
        badge: 'Product',
        subtitle: 'Multiply the terms in source order',
        explanation: 'Terms are multiplied in sequence order.'
    }
});

const FUNCTION_LABELS = Object.freeze({
    cos: 'cos',
    sin: 'sin',
    tan: 'tan',
    sec: 'sec',
    exp: 'exp',
    ln: 'ln',
    reciprocal: 'reciprocal',
    mobius: 'Mobius',
    polynomial: 'P',
    poincare: 'Poincare',
    zeta: 'zeta',
    sinh: 'sinh',
    cosh: 'cosh',
    tanh: 'tanh',
    power: 'power',
    algebraic_chaining: 'algebraic expression'
});

function element(id) {
    return document.getElementById(id);
}

function config() {
    return state.dynamicPlotting;
}

function synchronizeTermBindingState() {
    const term = config().term;
    if (!term || term.kind !== 'expression') return;
    try {
        const next = synchronizeSequenceBindings(
            String(term.expression || ''),
            term.bindings || []
        );
        if (JSON.stringify(next) !== JSON.stringify(term.bindings || [])) {
            mutateState('dynamicPlotting', dynamic => {
                dynamic.term.bindings = next;
            }, 'dynamicPlotting.term.bindings');
        }
    } catch {
        // The formula error is presented by the main validation status.
    }
}

function setHidden(id, hidden) {
    element(id)?.classList.toggle('hidden', Boolean(hidden));
}

function setValue(id, value) {
    const control = element(id);
    if (control && value !== undefined && value !== null) control.value = String(value);
}

function setChecked(id, value) {
    const control = element(id);
    if (control) control.checked = Boolean(value);
}

function textNode(tag, className, text) {
    return createElement(tag, { className, text });
}

function finiteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback) {
    return Math.floor(finiteNumber(value, fallback));
}

function update(mutator, options = {}) {
    mutateState('dynamicPlotting', dynamic => {
        mutator(dynamic);
        if (!options.preservePreset) dynamic.preset = 'custom';
    });
    invalidateDynamicPlotting();
    syncDynamicPlottingUI();
    redraw(options.domainDirty !== false);
}

function bind(id, event, handler) {
    const control = element(id);
    if (!control) return;
    control.addEventListener(event, handler);
}

function bindCheckbox(id, setter, options) {
    bind(id, 'change', event => update(
        dynamic => setter(dynamic, event.target.checked),
        options
    ));
}

function bindNumber(id, setter, options = {}) {
    bind(id, options.event || 'change', event => update(
        dynamic => setter(dynamic, finiteNumber(event.target.value, options.fallback ?? 0)),
        options
    ));
}

function bindText(id, setter, options = {}) {
    bind(id, options.event || 'change', event => update(
        dynamic => setter(dynamic, event.target.value),
        options
    ));
}

function debounceFormulaUpdate(setter, value) {
    if (formulaTimer) clearTimeout(formulaTimer);
    formulaTimer = setTimeout(() => {
        update(dynamic => setter(dynamic, value));
        formulaTimer = null;
    }, 180);
}

function bindFormula(id, setter) {
    bind(id, 'input', event => debounceFormulaUpdate(setter, event.target.value));
    bind(id, 'change', event => {
        if (formulaTimer) {
            clearTimeout(formulaTimer);
            formulaTimer = null;
        }
        update(dynamic => setter(dynamic, event.target.value));
    });
}

function sourceCount() {
    return Math.max(0, integer(config().source?.count, 0));
}

function availableCount() {
    if (!config().enabled) return sourceCount();
    try {
        return getDynamicPlotResult()?.samples.length ?? sourceCount();
    } catch {
        return sourceCount();
    }
}

function syncSourceVisibility() {
    const sourceKind = config().source?.kind || 'integers';
    const visibleIds = new Set(SOURCE_GROUPS[sourceKind] || []);
    Object.values(SOURCE_GROUPS).flat().forEach(id => setHidden(id, !visibleIds.has(id)));
}

function pipelineFreeParameterSymbols() {
    const pointExpression = String(config().pointExpression || '');
    const symbols = getDynamicFreeParameterSymbols();
    if (
        /(^|[^A-Za-z0-9_])s([^A-Za-z0-9_]|$)/.test(pointExpression) &&
        !symbols.includes('s')
    ) {
        symbols.unshift('s');
    }
    return symbols;
}

function syncTermVisibility() {
    const customExpression = config().term?.kind === 'expression';
    const reduction = config().reduction?.kind || 'none';
    const aggregate = reduction !== 'none';
    const parameterSymbols = pipelineFreeParameterSymbols();
    const parameterized = parameterSymbols.length > 0;
    const bindings = getDynamicTermBindings();

    setHidden('dynamic_term_expression_row', !customExpression);
    setHidden('dynamic_term_builder', !customExpression);
    setHidden('dynamic_expression_assistant', !customExpression);
    setHidden('dynamic_sequence_bindings_card', !customExpression || bindings.length === 0);
    setHidden('dynamic_parameters_card', true);
    setHidden('dynamic_reduction_options', !aggregate);
    setHidden('dynamic_aggregate_parameter_row', !parameterized);
    setHidden('dynamic_product_view_row', reduction !== 'product');

    const operation = OPERATION_COPY[reduction] || OPERATION_COPY.none;
    const subtitle = element('dynamic_operation_subtitle');
    if (subtitle) subtitle.textContent = operation.subtitle;
    const explanation = element('dynamic_operation_explanation');
    if (explanation) explanation.textContent = operation.explanation;
    const badge = element('dynamic_formula_mode_badge');
    if (badge) badge.textContent = operation.badge;
    const termLabel = element('dynamic_term_expression_label');
    if (termLabel) termLabel.textContent = 'Complete formula';
    const parameterTitle = element('dynamic_free_parameter_title');
    const parameterLabel = element('dynamic_free_parameter_label');
    const parameterCopy = element('dynamic_free_parameter_copy');
    const parameterList = parameterSymbols.join(', ');
    if (parameterTitle) {
        parameterTitle.textContent = parameterSymbols.length > 1
            ? `Free parameters ${parameterList}`
            : `Free parameter ${parameterList}`;
    }
    if (parameterLabel) parameterLabel.textContent = `${parameterList} =`;
    if (parameterCopy) {
        parameterCopy.textContent = parameterSymbols.length > 1
            ? 'These symbols share the plotted complex argument. Their value remains fixed while j advances.'
            : `${parameterList} remains fixed while j advances and becomes the complex variable plotted by the aggregate.`;
    }

    document.querySelectorAll('input[name="dynamic_reduction_kind_radio"]').forEach(radio => {
        radio.checked = radio.value === reduction;
    });
}

function sourceKindLabel() {
    return {
        integers: 'Integers',
        naturals: 'Natural numbers',
        arithmetic: 'Arithmetic sequence',
        geometric: 'Geometric sequence',
        harmonic: 'Harmonic sequence',
        primes: 'Primes',
        gaussian_integers: 'Gaussian integers',
        gaussian_primes: 'Gaussian primes',
        custom_points: 'Custom points',
        expression: 'Generated sequence'
    }[config().source?.kind] || 'Discrete source';
}

function syncStudioChrome() {
    const studio = element('dynamic_plotting_controls_container');
    const minimize = element('dynamic_minimize_studio_btn');
    const summary = element('dynamic_studio_summary');
    const reduction = config().reduction?.kind || 'none';
    const operation = reduction === 'none' ? 'Map' : reduction === 'sum' ? 'Sum' : 'Product';

    studio?.classList.toggle('is-minimized', studioMinimized);
    studio?.setAttribute('aria-hidden', String(!config().enabled));
    document.body.classList.toggle('dynamic-studio-open', Boolean(config().enabled));
    if (minimize) {
        minimize.textContent = studioMinimized ? 'Open studio' : 'Minimize';
        minimize.setAttribute('aria-expanded', String(!studioMinimized));
    }
    if (summary) summary.textContent = `${sourceKindLabel()} → ${termFormula()} → ${operation}`;
}

function sourceDescription() {
    const source = config().source || {};
    const count = Math.max(0, integer(source.count, 0));
    const start = finiteNumber(source.start, 1);
    const step = finiteNumber(source.step, 1);
    switch (source.kind) {
        case 'naturals':
            return `${count} natural numbers from ${start}`;
        case 'arithmetic':
            return `${count} terms with d_j = ${start} + j(${step})`;
        case 'geometric':
            return `${count} terms with d_j = ${start}(${finiteNumber(source.ratio, 2)})^j`;
        case 'harmonic':
            return `${count} terms with d_j = 1 / (${start} + j(${step}))`;
        case 'integers':
            if (source.ordering === 'symmetric') return `${count} symmetrically ordered integers`;
            if (start === 1 && step === 1) return `${count} integers: 1, 2, 3, ...`;
            return `${count} values starting at ${start}, stepping by ${step}`;
        case 'primes':
            return `${count} rational primes: 2, 3, 5, 7, ...`;
        case 'gaussian_integers':
            return `${count} Gaussian integers`;
        case 'gaussian_primes':
            return `${count} Gaussian primes`;
        case 'custom_points':
            return `${count} custom complex points`;
        case 'expression':
            return `${count} generated values d_j = ${source.generatorExpression || 'j'}`;
        default:
            return `${count} source values`;
    }
}

function sourceForPreview() {
    const source = config().source || {};
    const sourceConfig = {
        ...source,
        points: Array.isArray(source.points) ? [...source.points] : []
    };

    const parameters = Object.fromEntries((config().parameters || [])
        .filter(parameter => /^[A-Za-z_][A-Za-z0-9_]*$/.test(parameter?.name || ''))
        .map(parameter => [parameter.name, { re: Number(parameter.value) || 0, im: 0 }]));
    return generateDiscreteSource(sourceConfig, { parameters });
}

function sourceRule() {
    const source = config().source || {};
    const start = finiteNumber(source.start, source.kind === 'naturals' ? 0 : 1);
    const step = finiteNumber(source.step, 1);
    const ratio = finiteNumber(source.ratio, 2);

    switch (source.kind) {
        case 'naturals':
            return { expression: 'j', note: 'j = 0, 1, 2, ...' };
        case 'integers':
            return source.ordering === 'symmetric'
                ? { text: 'dⱼ = 0, 1, −1, 2, −2, ...' }
                : { expression: `${start} + j*(${step})` };
        case 'arithmetic':
            return { expression: `${start} + j*(${step})`, note: 'dⱼ = a + jΔ' };
        case 'geometric':
            return { expression: `(${start})*(${ratio})^j`, note: 'dⱼ = arʲ' };
        case 'harmonic':
            return { expression: `1/((${start}) + j*(${step}))`, note: 'dⱼ = 1/(a + jΔ)' };
        case 'primes':
            return { text: 'dⱼ = the j-th rational prime' };
        case 'gaussian_integers':
            return { text: 'dⱼ = the j-th Gaussian integer in norm order' };
        case 'gaussian_primes':
            return { text: 'dⱼ = the j-th Gaussian prime in norm order' };
        case 'custom_points':
            return { text: 'dⱼ = the j-th value in your point list' };
        case 'expression':
            return { expression: String(source.generatorExpression ?? '') };
        default:
            return { text: 'dⱼ is not defined yet' };
    }
}

function renderSourceDefinition() {
    const target = element('dynamic_source_definition_math');
    if (!target) return;
    target.replaceChildren();
    const rule = sourceRule();

    if (rule.text) {
        target.appendChild(textNode('span', '', rule.text));
    } else {
        target.appendChild(textNode('span', 'dynamic-source-definition-prefix', 'dⱼ ='));
        try {
            target.appendChild(createExpressionMathML(rule.expression, {
                sequenceVariables: []
            }));
        } catch (error) {
            target.appendChild(textNode(
                'span',
                'dynamic-source-definition-error',
                error?.message || String(error)
            ));
        }
    }
    if (rule.note) target.appendChild(textNode('small', '', rule.note));
}

function renderSourcePreview() {
    const target = element('dynamic_source_preview_values');
    const feedback = element('dynamic_source_feedback');
    if (!target) return;

    try {
        const key = JSON.stringify({
            source: config().source,
            parameters: config().parameters
        });
        if (sourcePreviewCacheKey !== key || !sourcePreviewCache) {
            sourcePreviewCacheKey = key;
            sourcePreviewCache = sourceForPreview();
        }
        const source = sourcePreviewCache;
        const values = source.records.slice(0, 8).map(record => formatComplex(record.domainValue));
        const suffix = source.records.length > values.length ? ', ...' : '';
        target.textContent = values.length ? `${values.join(', ')}${suffix}` : 'no values';
        target.title = source.records.slice(0, 40).map(record => formatComplex(record.domainValue)).join(', ');
        if (feedback) {
            const message = source.diagnostics[0] || '';
            feedback.textContent = message;
            feedback.className = message
                ? 'dynamic-inline-feedback dynamic-inline-feedback-warning'
                : 'dynamic-inline-feedback hidden';
        }
    } catch (error) {
        target.textContent = error?.message || 'Unable to generate source';
        target.title = '';
        if (feedback) {
            feedback.textContent = error?.message || String(error);
            feedback.className = 'dynamic-inline-feedback dynamic-inline-feedback-error';
        }
    }
}

function termFormula() {
    if (config().term?.kind === 'selected-function') {
        const functionName = FUNCTION_LABELS[state.currentFunction] || state.currentFunction || 'selected';
        return `${functionName}(z_j)`;
    }
    return String(config().term?.expression || 'a_j');
}

function sequenceVariableNames() {
    return [
        'c',
        'd',
        'z',
        ...getDynamicTermBindings()
            .filter(binding => binding.kind !== 'parameter' && binding.kind !== 'parameter_real')
            .map(binding => binding.symbol)
    ];
}

function bindingRuleLabel(binding) {
    switch (binding.kind) {
        case 'parameter':
            return 'free complex parameter, fixed while j advances';
        case 'parameter_real':
            return 'free real parameter, fixed while j advances';
        case 'constant':
            return `constant ${formatComplex(binding.value)}`;
        case 'naturals':
            return 'natural numbers 0, 1, 2, ...';
        case 'integers':
            return 'integers 0, 1, -1, 2, -2, ...';
        case 'primes':
            return `prime numbers from ${binding.min}`;
        case 'gaussian_integers':
            return 'Gaussian integers in increasing norm order';
        case 'gaussian_primes':
            return 'Gaussian primes in increasing norm order';
        case 'arithmetic':
            return `${binding.start} + j(${binding.step})`;
        case 'geometric':
            return `${binding.start}(${binding.ratio})^j`;
        case 'harmonic':
            return `1 / (${binding.start} + j(${binding.step}))`;
        case 'expression':
            return String(binding.generatorExpression || 'j');
        case 'custom_points':
            return 'explicit value list';
        default:
            return binding.kind;
    }
}

function renderGeneralTermMath() {
    const target = element('dynamic_general_term_math');
    if (!target) return;
    target.replaceChildren();
    const source = config().term?.kind === 'selected-function'
        ? 'selected(z)'
        : String(config().term?.expression ?? '');
    try {
        target.appendChild(createGeneralTermMathML(source, {
            parameterSymbols: pipelineFreeParameterSymbols(),
            sequenceVariables: sequenceVariableNames()
        }));
        target.classList.remove('dynamic-math-error');
    } catch (error) {
        target.textContent = error?.message || String(error);
        target.classList.add('dynamic-math-error');
    }
}

function renderFormulaBanner(result = null, error = null) {
    const content = element('dynamic_formula_banner_content');
    const explanation = element('dynamic_formula_explanation');
    if (!content || !explanation) return;

    content.replaceChildren();
    const termSource = config().term?.kind === 'selected-function'
        ? 'selected(z)'
        : String(config().term?.expression ?? '');
    const reduction = config().reduction?.kind || 'none';
    const count = result?.visibleCount ?? Math.max(0, integer(config().playback?.visibleCount, 0));
    try {
        content.appendChild(createGeneralTermMathML(termSource, {
            parameterSymbols: pipelineFreeParameterSymbols(),
            sequenceVariables: sequenceVariableNames()
        }));
        content.appendChild(createAggregateMathML(termSource, {
            count,
            reduction,
            parameterSymbols: pipelineFreeParameterSymbols(),
            sequenceVariables: sequenceVariableNames()
        }));
        const definitions = document.createElement('div');
        definitions.className = 'dynamic-formula-definitions';
        definitions.appendChild(textNode(
            'div',
            'dynamic-formula-definition',
            `d_j: ${sourceDescription()}`
        ));
        for (const binding of getDynamicTermBindings()) {
            definitions.appendChild(textNode(
                'div',
                'dynamic-formula-definition',
                `${binding.symbol}_j: ${bindingRuleLabel(binding)}`
            ));
        }
        content.appendChild(definitions);
    } catch (formulaError) {
        content.textContent = formulaError?.message || String(formulaError);
    }

    if (error) {
        explanation.textContent = `The formula cannot be evaluated yet: ${error}`;
        explanation.classList.add('dynamic-formula-explanation-error');
        return;
    }

    explanation.classList.remove('dynamic-formula-explanation-error');
    const operation = OPERATION_COPY[reduction] || OPERATION_COPY.none;
    explanation.textContent = operation.explanation;
}

function renderExampleGallery() {
    const gallery = element('dynamic_example_gallery');
    if (!gallery || gallery.childElementCount > 0) return;

    const presets = getDynamicPlottingPresets().filter(item => item.id !== 'custom');
    const count = element('dynamic_example_count');
    if (count) count.textContent = `${presets.length} ready-made constructions`;

    for (const preset of presets) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dynamic-example-button';
        button.dataset.dynamicPreset = preset.id;
        button.append(
            textNode('span', 'dynamic-example-category', preset.category || 'Example'),
            textNode('strong', '', preset.label),
            textNode('span', 'dynamic-example-description', preset.description || '')
        );
        button.addEventListener('click', () => {
            applyPresetFromUI(preset.id);
            button.closest('details')?.removeAttribute('open');
        });
        gallery.appendChild(button);
    }
}

function syncExampleButtons() {
    document.querySelectorAll('[data-dynamic-preset]').forEach(button => {
        button.classList.toggle('is-active', button.dataset.dynamicPreset === config().preset);
    });
}

function formatParameterValue(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(Number(numeric.toFixed(8))) : '0';
}

function optionSelect(options, value, onChange, className = 'control-select') {
    return createSelect(options, value, onChange, className);
}

function labeledControl(label, control, hint = '') {
    const wrapper = document.createElement('label');
    wrapper.className = 'dynamic-field';
    wrapper.appendChild(textNode('span', '', label));
    if (hint) wrapper.appendChild(textNode('div', 'dynamic-field-hint', hint));
    wrapper.appendChild(control);
    return wrapper;
}

function numberControl(value, onChange, options = {}) {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'dynamic-number-input';
    input.value = String(value ?? '');
    input.step = options.step || 'any';
    if (options.min !== undefined) input.min = String(options.min);
    input.addEventListener('change', event => onChange(finiteNumber(event.target.value, options.fallback ?? 0)));
    return input;
}

function textControl(value, onChange) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dynamic-formula-input';
    input.value = String(value ?? '');
    input.spellcheck = false;
    input.addEventListener('change', event => onChange(event.target.value));
    return input;
}

function updateBinding(index, mutator) {
    update(dynamic => {
        const binding = dynamic.term?.bindings?.[index];
        if (binding) mutator(binding, dynamic.term.bindings);
    });
}

function commitTermFactors(nextFactors) {
    termFactors = nextFactors;
    const expression = composeProductExpression(termFactors);
    termFactorSource = expression;
    const input = element('dynamic_term_expression');
    if (input) input.value = expression;
    update(dynamic => {
        dynamic.term.kind = 'expression';
        dynamic.term.expression = expression;
    });
}

function factorExpression(factor) {
    return composeProductExpression([{ ...factor, denominator: false }]);
}

function renderTermFactor(factor, index) {
    const card = document.createElement('div');
    card.className = 'dynamic-term-factor-card';

    const heading = document.createElement('div');
    heading.className = 'dynamic-term-factor-heading';
    heading.append(
        textNode('strong', '', `Factor ${index + 1}`),
        textNode('span', 'dynamic-factor-position', factor.denominator ? 'Denominator' : 'Numerator')
    );
    if (termFactors.length > 1) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'dynamic-factor-remove';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
            commitTermFactors(termFactors.filter((_, factorIndex) => factorIndex !== index));
        });
        heading.appendChild(remove);
    }

    const preview = document.createElement('div');
    preview.className = 'dynamic-factor-math';
    try {
        preview.appendChild(createExpressionMathML(factorExpression(factor), {
            sequenceVariables: sequenceVariableNames()
        }));
    } catch {
        preview.textContent = factorExpression(factor);
    }

    const placement = optionSelect([
        { id: 'numerator', label: 'Numerator' },
        { id: 'denominator', label: 'Denominator' }
    ], factor.denominator ? 'denominator' : 'numerator', event => {
        const next = termFactors.map((item, factorIndex) => factorIndex === index
            ? { ...item, denominator: event.target.value === 'denominator' }
            : item);
        commitTermFactors(next);
    });
    const wrapper = optionSelect([
        { id: 'none', label: 'No wrapper' },
        { id: 'factorial', label: 'Factorial u!' },
        { id: 'ln', label: 'ln(u)' },
        { id: 'exp', label: 'exp(u)' },
        { id: 'sqrt', label: 'sqrt(u)' },
        { id: 'sin', label: 'sin(u)' },
        { id: 'cos', label: 'cos(u)' },
        { id: 'abs', label: '|u|' },
        { id: 'conj', label: 'conj(u)' },
        { id: 'selected', label: 'selected f(u)' }
    ], factor.wrapper || 'none', event => {
        const next = termFactors.map((item, factorIndex) => factorIndex === index
            ? { ...item, wrapper: event.target.value }
            : item);
        commitTermFactors(next);
    });
    const base = textControl(factor.base, value => {
        const next = termFactors.map((item, factorIndex) => factorIndex === index
            ? { ...item, base: value || '1' }
            : item);
        commitTermFactors(next);
    });
    const exponent = textControl(factor.exponent, value => {
        const next = termFactors.map((item, factorIndex) => factorIndex === index
            ? { ...item, exponent: value }
            : item);
        commitTermFactors(next);
    });

    const controls = document.createElement('div');
    controls.className = 'dynamic-factor-controls';
    controls.append(
        labeledControl('Position', placement),
        labeledControl('Base expression u', base),
        labeledControl('Power (optional)', exponent, 'Examples: n, 2j+1, -s'),
        labeledControl('Wrapper', wrapper)
    );
    card.append(heading, preview, controls);
    return card;
}

function renderTermFactors() {
    const container = element('dynamic_term_factors');
    if (!container || config().term?.kind !== 'expression') return;
    const source = String(config().term?.expression || '1');
    if (source !== termFactorSource) {
        try {
            termFactors = decomposeProductExpression(source);
            termFactorSource = source;
        } catch {
            return;
        }
    }
    if (document.activeElement && container.contains(document.activeElement)) return;
    container.replaceChildren(...termFactors.map(renderTermFactor));
}

function bindingPreviewValues(symbol) {
    try {
        const result = getDynamicPlotResult();
        const values = result?.samples
            ?.slice(0, 7)
            .map(sample => sample.symbolValues?.[symbol])
            .filter(Boolean)
            .map(value => formatComplex(value)) || [];
        return values.length ? values.join(', ') : 'no generated values';
    } catch {
        return 'preview unavailable';
    }
}

function renderBindingControls(binding, index) {
    const controls = document.createElement('div');
    controls.className = 'dynamic-binding-controls';
    const change = (key, value) => updateBinding(index, target => { target[key] = value; });

    if (binding.kind === 'parameter' || binding.kind === 'parameter_real') {
        controls.appendChild(textNode(
            'div',
            'dynamic-binding-parameter-note',
            binding.kind === 'parameter_real'
                ? 'This symbol uses the real part of the plotted argument and stays fixed while j advances.'
                : 'This symbol is the free complex argument plotted across the output plane. It stays fixed while j advances.'
        ));
        return controls;
    }

    if (binding.kind === 'constant') {
        controls.append(
            labeledControl('Real part', numberControl(binding.value.re, value =>
                updateBinding(index, target => { target.value.re = value; }))),
            labeledControl('Imaginary part', numberControl(binding.value.im, value =>
                updateBinding(index, target => { target.value.im = value; })))
        );
        return controls;
    }

    if (binding.kind === 'naturals' || binding.kind === 'integers') {
        controls.appendChild(textNode(
            'div',
            'dynamic-binding-parameter-note',
            binding.kind === 'naturals'
                ? 'Uses 0, 1, 2, 3, ... in order. Choose Arithmetic progression or Custom rule for a different pattern.'
                : 'Uses 0, 1, -1, 2, -2, ... in symmetric order.'
        ));
        return controls;
    }

    if (binding.kind === 'arithmetic') {
        controls.append(
            labeledControl('First value', numberControl(binding.start, value => change('start', value))),
            labeledControl('Common difference', numberControl(binding.step, value => change('step', value)))
        );
        return controls;
    }

    if (binding.kind === 'geometric') {
        controls.append(
            labeledControl('First value', numberControl(binding.start, value => change('start', value))),
            labeledControl('Common ratio', numberControl(binding.ratio, value => change('ratio', value)))
        );
        return controls;
    }

    if (binding.kind === 'harmonic') {
        controls.append(
            labeledControl('First denominator', numberControl(binding.start, value => change('start', value))),
            labeledControl('Denominator difference', numberControl(binding.step, value => change('step', value)))
        );
        return controls;
    }

    if (binding.kind === 'primes') {
        const maximum = document.createElement('input');
        maximum.type = 'number';
        maximum.className = 'dynamic-number-input';
        maximum.min = '2';
        maximum.value = binding.max ?? '';
        maximum.addEventListener('change', event => {
            change('max', event.target.value === '' ? '' : Number(event.target.value));
        });
        controls.append(
            labeledControl('Minimum prime', numberControl(binding.min, value => change('min', Math.max(2, Math.floor(value))), { min: 2 })),
            labeledControl('Optional maximum', maximum)
        );
        const negative = document.createElement('input');
        negative.type = 'checkbox';
        negative.checked = Boolean(binding.includeNegative);
        negative.addEventListener('change', event => change('includeNegative', event.target.checked));
        const label = document.createElement('label');
        label.className = 'dynamic-check';
        label.append(negative, textNode('span', 'custom-checkbox-visual', ''), document.createTextNode('Include negative associates'));
        controls.appendChild(label);
        return controls;
    }

    if (binding.kind === 'gaussian_integers' || binding.kind === 'gaussian_primes') {
        controls.append(
            labeledControl(
                'Starting search radius',
                numberControl(binding.bound, value =>
                    change('bound', Math.max(1, Math.floor(value))), { min: 1 }),
                'The search expands automatically until every requested term is found.'
            ),
            labeledControl('Bound shape', optionSelect([
                { id: 'norm', label: 'Norm radius' },
                { id: 'square', label: 'Square' }
            ], binding.boundType, event => change('boundType', event.target.value))),
            labeledControl('Associates', optionSelect([
                { id: 'all', label: 'All associates' },
                { id: 'representatives', label: 'One representative' }
            ], binding.associatePolicy, event => change('associatePolicy', event.target.value)))
        );
        return controls;
    }

    if (binding.kind === 'expression') {
        controls.appendChild(labeledControl(
            `${binding.symbol}_j =`,
            textControl(binding.generatorExpression, value => change('generatorExpression', value)),
            'Use j as the zero-based term index, for example 2j+1.'
        ));
        return controls;
    }

    if (binding.kind === 'custom_points') {
        const textarea = document.createElement('textarea');
        textarea.className = 'dynamic-formula-input';
        textarea.rows = 3;
        textarea.value = binding.pointsText || '';
        textarea.addEventListener('change', event => change('pointsText', event.target.value));
        controls.appendChild(labeledControl('Values', textarea, 'One value per line, or use semicolons.'));
    }
    return controls;
}

function renderSequenceBinding(binding, index) {
    const card = document.createElement('div');
    card.className = 'dynamic-sequence-binding-card';
    const heading = document.createElement('div');
    heading.className = 'dynamic-binding-heading';
    const identity = document.createElement('div');
    identity.className = 'dynamic-binding-identity';
    identity.append(
        textNode('strong', '', `${binding.symbol}_j`),
        textNode('span', '', bindingRuleLabel(binding))
    );
    const kind = optionSelect(SEQUENCE_BINDING_KINDS, binding.kind, event => {
        updateBinding(index, (target, bindings) => {
            if (event.target.value === 'parameter' || event.target.value === 'parameter_real') {
                bindings.forEach(other => {
                    if (
                        other !== target &&
                        (other.kind === 'parameter' || other.kind === 'parameter_real')
                    ) {
                        other.kind = 'constant';
                        other.value = { ...config().aggregateParameter };
                    }
                });
            }
            target.kind = event.target.value;
            if (target.kind === 'naturals') {
                target.start = 0;
                target.step = 1;
                target.ordering = 'ascending';
            } else if (target.kind === 'integers') {
                target.start = 1;
                target.step = 1;
                target.ordering = 'symmetric';
                target.includeZero = true;
            } else if (target.kind === 'geometric') {
                target.start = 1;
                target.ratio = 2;
            } else if (target.kind === 'harmonic') {
                target.start = 1;
                target.step = 1;
            }
        });
    });
    heading.append(identity, kind);
    const preview = textNode(
        'div',
        'dynamic-binding-preview',
        `${binding.symbol}_j = ${bindingPreviewValues(binding.symbol)}`
    );
    card.append(heading, renderBindingControls(binding, index), preview);
    return card;
}

function renderSequenceBindings() {
    const container = element('dynamic_sequence_bindings_list');
    if (!container) return;
    const bindings = getDynamicTermBindings();
    container.replaceChildren(...bindings.map(renderSequenceBinding));
}

function parameterCard(parameter, index) {
    const card = document.createElement('div');
    card.className = 'dynamic-parameter-card';
    card.dataset.parameterIndex = String(index);

    const header = document.createElement('div');
    header.className = 'dynamic-parameter-header';

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'dynamic-text-input dynamic-parameter-name';
    name.value = parameter.name || `p${index + 1}`;
    name.setAttribute('aria-label', `Parameter ${index + 1} name`);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'dynamic-small-button dynamic-remove-parameter';
    remove.textContent = 'Remove';
    remove.disabled = config().parameters.length <= 1;

    header.append(name, remove);

    const fields = document.createElement('div');
    fields.className = 'dynamic-parameter-fields';
    for (const [key, label] of [
        ['value', 'Value'],
        ['min', 'Min'],
        ['max', 'Max'],
        ['step', 'Step']
    ]) {
        const wrapper = document.createElement('label');
        wrapper.textContent = label;
        const input = document.createElement('input');
        input.type = 'number';
        input.className = `dynamic-number-input dynamic-parameter-${key}`;
        input.value = formatParameterValue(parameter[key]);
        input.step = key === 'step' ? 'any' : 'any';
        wrapper.appendChild(input);
        fields.appendChild(wrapper);
    }

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'dynamic-parameter-slider';
    slider.min = String(parameter.min);
    slider.max = String(parameter.max);
    slider.step = String(parameter.step);
    slider.value = String(parameter.value);

    card.append(header, fields, slider);
    return card;
}

function renderParameters() {
    const container = element('dynamic_parameters_list');
    if (!container) return;
    const active = document.activeElement;
    if (active && container.contains(active)) return;

    container.replaceChildren(...config().parameters.map(parameterCard));
}

function renderStatus() {
    const feedback = element('dynamic_formula_feedback');

    if (!config().enabled) {
        if (feedback) feedback.className = 'dynamic-inline-feedback hidden';
        renderFormulaBanner();
        return;
    }

    try {
        const result = getDynamicPlotResult();
        renderFormulaBanner(result);
        if (feedback) {
            const evaluationMessage = result.visibleSamples.find(sample => sample.error)?.error;
            const bindingMessage = result.bindingDiagnostics?.[0];
            const undefinedMessage = !evaluationMessage && result.invalidCount > 0
                ? `${result.invalidCount} visible term${result.invalidCount === 1 ? ' is' : 's are'} undefined for the current values.`
                : '';
            const message = evaluationMessage || bindingMessage || undefinedMessage;
            feedback.textContent = message || '';
            feedback.className = message
                ? 'dynamic-inline-feedback dynamic-inline-feedback-warning'
                : 'dynamic-inline-feedback hidden';
        }
    } catch (error) {
        const message = error?.message || String(error);
        renderFormulaBanner(null, message);
        if (feedback) {
            feedback.textContent = message;
            feedback.className = 'dynamic-inline-feedback dynamic-inline-feedback-error';
        }
    }
}

function syncPlayback() {
    const count = availableCount();
    const slider = element('dynamic_visible_count_slider');
    const number = element('dynamic_visible_count_number');
    const visible = Math.max(0, Math.min(count, integer(config().playback.visibleCount, count)));
    if (config().playback.visibleCount !== visible) {
        mutateState('dynamicPlotting', dynamic => {
            dynamic.playback.visibleCount = visible;
        }, 'dynamicPlotting.playback.visibleCount');
    }

    if (slider) {
        slider.max = String(Math.max(1, count));
        slider.value = String(visible);
    }
    if (number) {
        number.max = String(count);
        number.value = String(visible);
    }

    const display = element('dynamic_visible_count_display');
    if (display) display.textContent = `${visible} / ${count}`;

    const play = element('dynamic_play_pause_btn');
    if (play) play.textContent = config().playback.playing ? 'Pause' : 'Play terms';
}

export function syncDynamicPlottingUI() {
    if (!initialized) return;
    const dynamic = config();

    synchronizeTermBindingState();
    renderExampleGallery();
    setChecked('enable_dynamic_plotting_cb', dynamic.enabled);
    setHidden('dynamic_plotting_controls_container', !dynamic.enabled);
    setValue('dynamic_source_kind', dynamic.source.kind);
    setValue('dynamic_source_count', dynamic.source.count);
    setValue('dynamic_arithmetic_first', dynamic.source.start);
    setValue('dynamic_arithmetic_difference', dynamic.source.step);
    setValue('dynamic_geometric_first', dynamic.source.start);
    setValue('dynamic_geometric_ratio', dynamic.source.ratio);
    setValue('dynamic_harmonic_first', dynamic.source.start);
    setValue('dynamic_harmonic_difference', dynamic.source.step);
    setValue('dynamic_prime_min', dynamic.source.min);
    setValue('dynamic_prime_max', dynamic.source.max);
    setChecked('dynamic_prime_include_negative', dynamic.source.includeNegative);
    setValue('dynamic_gaussian_bound', dynamic.source.bound);
    setValue('dynamic_gaussian_bound_type', dynamic.source.boundType);
    setValue('dynamic_gaussian_associate_policy', dynamic.source.associatePolicy);
    setChecked('dynamic_gaussian_include_conjugates', dynamic.source.includeConjugates);
    setValue('dynamic_custom_points_text', dynamic.source.pointsText);
    setValue('dynamic_generator_expression', dynamic.source.generatorExpression);
    setValue('dynamic_filter_expression', dynamic.source.filterExpression);
    setValue('dynamic_point_expression', dynamic.pointExpression);
    setValue('dynamic_term_kind', dynamic.term.kind);
    setValue('dynamic_term_expression', dynamic.term.expression);
    setValue('dynamic_reduction_kind', dynamic.reduction.kind);
    setValue('dynamic_invalid_policy', dynamic.reduction.invalidPolicy);
    setValue('dynamic_s_re', dynamic.aggregateParameter.re);
    setValue('dynamic_s_im', dynamic.aggregateParameter.im);
    setValue('dynamic_playback_speed', dynamic.playback.speed);
    setChecked('dynamic_playback_loop', dynamic.playback.loop);
    setValue('dynamic_product_view', dynamic.display.productView);

    syncStudioChrome();
    syncSourceVisibility();
    syncTermVisibility();
    syncPlayback();
    syncExampleButtons();
    renderSourceDefinition();
    renderSourcePreview();
    renderGeneralTermMath();
    renderTermFactors();
    renderSequenceBindings();
    renderParameters();
    renderStatus();
}

function stopAnimation() {
    if (animationHandle !== null) cancelAnimationFrame(animationHandle);
    animationHandle = null;
    lastAnimationTime = 0;
}

function animationFrame(timestamp) {
    if (!config().playback.playing || !config().enabled) {
        stopAnimation();
        return;
    }

    if (!lastAnimationTime) lastAnimationTime = timestamp;
    const elapsed = Math.max(0, (timestamp - lastAnimationTime) / 1000);
    const increment = elapsed * Math.max(0.1, Number(config().playback.speed) || 1);

    if (increment >= 1) {
        const count = availableCount();
        let next = config().playback.visibleCount + Math.floor(increment);
        lastAnimationTime = timestamp;
        mutateState('dynamicPlotting', dynamic => {
            if (next > count) {
                if (dynamic.playback.loop) next = count > 0 ? 1 : 0;
                else {
                    next = count;
                    dynamic.playback.playing = false;
                }
            }
            dynamic.playback.visibleCount = next;
        }, 'dynamicPlotting.playback');
        invalidateDynamicPlotting();
        syncPlayback();
        renderStatus();
        redraw(true);
    }

    if (config().playback.playing) animationHandle = requestAnimationFrame(animationFrame);
    else stopAnimation();
}

function startAnimation() {
    stopAnimation();
    if (!config().playback.playing) return;
    animationHandle = requestAnimationFrame(animationFrame);
}

function setVisibleCount(value) {
    update(dynamic => {
        dynamic.playback.visibleCount = Math.max(0, Math.min(availableCount(), integer(value, 0)));
    });
}

function bindParameterEvents() {
    const container = element('dynamic_parameters_list');
    if (!container) return;

    container.addEventListener('change', event => {
        const card = event.target.closest('.dynamic-parameter-card');
        if (!card) return;
        const index = integer(card.dataset.parameterIndex, -1);
        const parameter = config().parameters[index];
        if (!parameter) return;

        update(dynamic => {
            const target = dynamic.parameters[index];
            if (event.target.classList.contains('dynamic-parameter-name')) {
                const name = event.target.value.trim();
                if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) target.name = name;
            }
            for (const key of ['value', 'min', 'max', 'step']) {
                if (event.target.classList.contains(`dynamic-parameter-${key}`)) {
                    target[key] = finiteNumber(event.target.value, target[key]);
                }
            }
            if (target.min > target.max) [target.min, target.max] = [target.max, target.min];
            target.step = Math.max(Number.EPSILON, Math.abs(target.step));
            target.value = Math.max(target.min, Math.min(target.max, target.value));
        });
    });

    container.addEventListener('input', event => {
        if (!event.target.classList.contains('dynamic-parameter-slider')) return;
        const card = event.target.closest('.dynamic-parameter-card');
        const index = integer(card?.dataset.parameterIndex, -1);
        if (!config().parameters[index]) return;
        mutateState('dynamicPlotting', dynamic => {
            dynamic.parameters[index].value = finiteNumber(event.target.value, 0);
        }, `dynamicPlotting.parameters.${index}.value`);
        invalidateDynamicPlotting();
        const valueInput = card.querySelector('.dynamic-parameter-value');
        if (valueInput) valueInput.value = event.target.value;
        renderStatus();
        redraw(true);
    });

    container.addEventListener('click', event => {
        const remove = event.target.closest('.dynamic-remove-parameter');
        if (!remove) return;
        const card = remove.closest('.dynamic-parameter-card');
        const index = integer(card?.dataset.parameterIndex, -1);
        if (index < 0) return;
        update(dynamic => {
            if (dynamic.parameters.length > 1) dynamic.parameters.splice(index, 1);
        });
    });
}

function applyPresetFromUI(presetId) {
    if (!presetId) return;
    applyDynamicPlottingPreset(presetId);
    syncDynamicPlottingUI();
    redraw(true);
}

function setEquationHelpExpanded(expanded) {
    const guide = element('dynamic_equation_help');
    guide?.classList.toggle('hidden', !expanded);
    element('dynamic_formula_help_btn')?.setAttribute('aria-expanded', String(expanded));
    if (expanded) guide?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function bindControls() {
    bindCheckbox('enable_dynamic_plotting_cb', (dynamic, checked) => {
        dynamic.enabled = checked;
        if (!checked) dynamic.playback.playing = false;
    }, { preservePreset: true });

    bind('dynamic_minimize_studio_btn', 'click', () => {
        studioMinimized = !studioMinimized;
        syncStudioChrome();
    });
    bind('dynamic_close_studio_btn', 'click', () => {
        const checkbox = element('enable_dynamic_plotting_cb');
        if (checkbox?.checked) checkbox.click();
    });

    bind('dynamic_formula_help_btn', 'click', () => {
        setEquationHelpExpanded(element('dynamic_equation_help')?.classList.contains('hidden'));
    });
    bind('dynamic_formula_help_close_btn', 'click', () => setEquationHelpExpanded(false));
    bind('dynamic_open_reference_btn', 'click', () => {
        setEquationHelpExpanded(true);
    });

    document.querySelectorAll('[data-dynamic-expression]').forEach(button => {
        button.addEventListener('click', () => {
            const expression = button.dataset.dynamicExpression || '';
            const input = element('dynamic_term_expression');
            if (input) input.value = expression;
            update(dynamic => {
                dynamic.term.kind = 'expression';
                dynamic.term.expression = expression;
            });
        });
    });

    bind('dynamic_add_numerator_factor_btn', 'click', () => {
        commitTermFactors([...termFactors, createProductFactor(false)]);
    });
    bind('dynamic_add_denominator_factor_btn', 'click', () => {
        commitTermFactors([...termFactors, createProductFactor(true)]);
    });

    document.querySelectorAll('input[name="dynamic_reduction_kind_radio"]').forEach(radio => {
        radio.addEventListener('change', event => {
            if (!event.target.checked) return;
            update(dynamic => {
                dynamic.reduction.kind = event.target.value;
                dynamic.mode = event.target.value === 'none' ? 'map' : 'aggregate';
            });
        });
    });

    bindText('dynamic_source_kind', (dynamic, value) => {
        dynamic.source.kind = value;
        if (value === 'naturals') {
            dynamic.source.start = 0;
            dynamic.source.step = 1;
            dynamic.source.ordering = 'ascending';
        } else if (value === 'integers') {
            dynamic.source.start = 1;
            dynamic.source.step = 1;
            dynamic.source.ordering = 'symmetric';
            dynamic.source.includeZero = true;
        } else if (value === 'arithmetic') {
            dynamic.source.start = 1;
            dynamic.source.step = 1;
        } else if (value === 'geometric') {
            dynamic.source.start = 1;
            dynamic.source.ratio = 2;
        } else if (value === 'harmonic') {
            dynamic.source.start = 1;
            dynamic.source.step = 1;
        } else if (value === 'expression' && !String(dynamic.source.generatorExpression ?? '').trim()) {
            dynamic.source.generatorExpression = 'j';
        }
        dynamic.playback.visibleCount = Math.min(dynamic.playback.visibleCount, dynamic.source.count);
    });
    bindNumber('dynamic_source_count', (dynamic, value) => {
        dynamic.source.count = Math.max(
            0,
            Math.min(MAX_DYNAMIC_SOURCE_COUNT, Math.floor(value))
        );
        dynamic.playback.visibleCount = dynamic.source.count;
    }, { fallback: 50 });
    bindNumber('dynamic_arithmetic_first', (dynamic, value) => { dynamic.source.start = value; });
    bindNumber('dynamic_arithmetic_difference', (dynamic, value) => { dynamic.source.step = value; });
    bindNumber('dynamic_geometric_first', (dynamic, value) => { dynamic.source.start = value; });
    bindNumber('dynamic_geometric_ratio', (dynamic, value) => { dynamic.source.ratio = value; });
    bindNumber('dynamic_harmonic_first', (dynamic, value) => { dynamic.source.start = value; });
    bindNumber('dynamic_harmonic_difference', (dynamic, value) => { dynamic.source.step = value; });
    bindNumber('dynamic_prime_min', (dynamic, value) => { dynamic.source.min = Math.max(2, Math.floor(value)); });
    bindText('dynamic_prime_max', (dynamic, value) => { dynamic.source.max = value === '' ? '' : Number(value); });
    bindCheckbox('dynamic_prime_include_negative', (dynamic, value) => { dynamic.source.includeNegative = value; });
    bindNumber('dynamic_gaussian_bound', (dynamic, value) => { dynamic.source.bound = Math.max(1, Math.floor(value)); });
    bindText('dynamic_gaussian_bound_type', (dynamic, value) => { dynamic.source.boundType = value; });
    bindText('dynamic_gaussian_associate_policy', (dynamic, value) => { dynamic.source.associatePolicy = value; });
    bindCheckbox('dynamic_gaussian_include_conjugates', (dynamic, value) => { dynamic.source.includeConjugates = value; });
    bindText('dynamic_custom_points_text', (dynamic, value) => { dynamic.source.pointsText = value; });
    bindFormula('dynamic_generator_expression', (dynamic, value) => { dynamic.source.generatorExpression = value; });
    bindFormula('dynamic_filter_expression', (dynamic, value) => { dynamic.source.filterExpression = value; });
    bindFormula('dynamic_point_expression', (dynamic, value) => { dynamic.pointExpression = value; });
    bindText('dynamic_term_kind', (dynamic, value) => { dynamic.term.kind = value; });
    bindFormula('dynamic_term_expression', (dynamic, value) => { dynamic.term.expression = value; });
    bindText('dynamic_reduction_kind', (dynamic, value) => {
        dynamic.reduction.kind = value;
        dynamic.mode = value === 'none' ? 'map' : 'aggregate';
    });
    bindText('dynamic_invalid_policy', (dynamic, value) => { dynamic.reduction.invalidPolicy = value; });
    bindNumber('dynamic_s_re', (dynamic, value) => { dynamic.aggregateParameter.re = value; });
    bindNumber('dynamic_s_im', (dynamic, value) => { dynamic.aggregateParameter.im = value; });
    bindNumber('dynamic_playback_speed', (dynamic, value) => { dynamic.playback.speed = Math.max(0.1, value); });
    bindCheckbox('dynamic_playback_loop', (dynamic, value) => { dynamic.playback.loop = value; }, { domainDirty: false });
    bindText('dynamic_product_view', (dynamic, value) => { dynamic.display.productView = value; }, { domainDirty: false });

    bind('dynamic_visible_count_slider', 'input', event => setVisibleCount(event.target.value));
    bind('dynamic_visible_count_number', 'change', event => setVisibleCount(event.target.value));
    bind('dynamic_step_back_btn', 'click', () => setVisibleCount(config().playback.visibleCount - 1));
    bind('dynamic_step_forward_btn', 'click', () => setVisibleCount(config().playback.visibleCount + 1));
    bind('dynamic_reset_playback_btn', 'click', () => setVisibleCount(0));
    bind('dynamic_play_pause_btn', 'click', () => {
        mutateState('dynamicPlotting', dynamic => {
            dynamic.playback.playing = !dynamic.playback.playing;
        }, 'dynamicPlotting.playback.playing');
        syncPlayback();
        startAnimation();
    });

    bind('dynamic_add_parameter_btn', 'click', () => update(dynamic => {
        const index = dynamic.parameters.length + 1;
        dynamic.parameters.push({
            id: `p${Date.now()}`,
            name: `p${index}`,
            value: 1,
            min: -5,
            max: 5,
            step: 0.05
        });
    }));

    bindParameterEvents();
}

export function initializeDynamicPlottingUI(options = {}) {
    if (initialized) return;
    redraw = typeof options.requestRedraw === 'function' ? options.requestRedraw : redraw;
    const studio = element('dynamic_plotting_controls_container');
    if (studio && studio.parentElement !== document.body) document.body.appendChild(studio);
    initialized = true;
    bindControls();
    syncDynamicPlottingUI();
}

export function disposeDynamicPlottingUI() {
    stopAnimation();
    if (formulaTimer) clearTimeout(formulaTimer);
    formulaTimer = null;
}
