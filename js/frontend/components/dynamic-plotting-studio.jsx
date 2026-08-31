/** @jsxImportSource preact */
import { Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getStateSignal, state } from '../../store/state.js';
import {
    applyDynamicPlottingPresetFromUI,
    updateDynamicPlotting
} from '../../ui/dynamic-plotting-state.js';
import {
    getDynamicPlotResult,
    getDynamicPlottingPresets,
    getDynamicFreeParameterSymbols,
    getDynamicTermBindings
} from '../../analysis/dynamic-plotting.js';
import {
    formatComplex,
    generateDiscreteSource,
    MAX_DYNAMIC_SOURCE_COUNT
} from '../../analysis/discrete-sources.js';
import { SEQUENCE_BINDING_KINDS } from '../../analysis/sequence-bindings.js';
import {
    createAggregateMathML,
    createGeneralTermMathML,
    createProductFactor,
    composeProductExpression,
    createExpressionMathML,
    decomposeProductExpression
} from '../../math/expression/index.js';
import { requireFiniteNumber, requireInteger } from '../../utils/numeric-contracts.js';

const PLACEMENTS = [['numerator', 'Numerator'], ['denominator', 'Denominator']];
const WRAPPERS = [
    ['none', 'No wrapper'], ['factorial', 'Factorial u!'], ['ln', 'ln(u)'], ['exp', 'exp(u)'],
    ['sqrt', 'sqrt(u)'], ['sin', 'sin(u)'], ['cos', 'cos(u)'], ['abs', '|u|'],
    ['conj', 'conj(u)'], ['selected', 'selected f(u)']
];

const SOURCE_OPTIONS = [
    ['naturals', 'Natural numbers'], ['integers', 'Integers'],
    ['arithmetic', 'Arithmetic progression'], ['geometric', 'Geometric progression'],
    ['harmonic', 'Harmonic progression'], ['primes', 'Rational primes'],
    ['gaussian_integers', 'Gaussian integers'], ['gaussian_primes', 'Gaussian primes'],
    ['custom_points', 'Custom point list'], ['expression', 'A formula I write']
];
const SOURCE_LABELS = Object.freeze({
    integers: 'Integers', naturals: 'Natural numbers', arithmetic: 'Arithmetic sequence',
    geometric: 'Geometric sequence', harmonic: 'Harmonic sequence', primes: 'Primes',
    gaussian_integers: 'Gaussian integers', gaussian_primes: 'Gaussian primes',
    custom_points: 'Custom points', expression: 'Generated sequence'
});

const OPERATION_COPY = Object.freeze({
    none: ['Map', 'Keep every term as its own output point', 'Each source value produces one output term.'],
    sum: ['Sum', 'Add the terms in source order', 'Terms are added in sequence order.'],
    product: ['Product', 'Multiply the terms in source order', 'Terms are multiplied in sequence order.']
});

const FUNCTION_LABELS = Object.freeze({
    sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', exp: 'exp', ln: 'ln',
    mobius: 'Mobius', polynomial: 'P', zeta: 'zeta', sinh: 'sinh', tanh: 'tanh',
    power: 'power', algebraic_chaining: 'algebraic expression'
});

const EXPRESSION_STARTERS = [
    ['selected(z)', 'f(z)'], ['1 / d^2', '1 / d²'], ['d^(-s)', 'd^(−s)'],
    ['(-1)^j / d', '(−1)^j / d'], ['x^n / n!', 'xⁿ / n!'], ['exp(i*z)', 'exp(i z)']
];

function Select({ id, value, options, onChange }) {
    return (
        <select id={id} class="control-select" value={value} onChange={event => onChange(event.currentTarget.value)}>
            {options.map(option => {
                const [id, label] = Array.isArray(option) ? option : [option.id ?? option.value, option.label];
                return <option key={id} value={id}>{label}</option>;
            })}
        </select>
    );
}

function Field({ label, hint, children }) {
    return (
        <label class="dynamic-field">
            <span>{label}</span>
            {hint && <div class="dynamic-field-hint">{hint}</div>}
            {children}
        </label>
    );
}

function getDynamicBindingRuleLabel(binding) {
    switch (binding.kind) {
        case 'parameter': return 'free complex parameter, fixed while j advances';
        case 'parameter_real': return 'free real parameter, fixed while j advances';
        case 'constant': return `constant ${formatComplex(binding.value)}`;
        case 'naturals': return 'natural numbers 0, 1, 2, ...';
        case 'integers': return 'integers 0, 1, -1, 2, -2, ...';
        case 'primes': return `prime numbers from ${binding.min}`;
        case 'gaussian_integers': return 'Gaussian integers in increasing norm order';
        case 'gaussian_primes': return 'Gaussian primes in increasing norm order';
        case 'arithmetic': return `${binding.start} + j(${binding.step})`;
        case 'geometric': return `${binding.start}(${binding.ratio})^j`;
        case 'harmonic': return `1 / (${binding.start} + j(${binding.step}))`;
        case 'custom_points': return 'explicit value list';
        case 'expression':
            if (!String(binding.generatorExpression || '').trim()) {
                throw new Error(`Sequence binding ${binding.symbol} requires a generator expression.`);
            }
            return binding.generatorExpression;
        default: throw new Error(`Unsupported sequence-binding kind: ${binding.kind}`);
    }
}

function ExpressionPreview({ expression }) {
    return <MathNode class="dynamic-factor-math" fallback={expression}
        build={() => createExpressionMathML(expression)} />;
}

function DynamicExampleCount() {
    return `${getDynamicPlottingPresets().filter(item => item.id !== 'custom').length} ready-made constructions`;
}

function DynamicExampleGallery() {
    const active = getStateSignal('dynamicPlotting').value.preset;
    return getDynamicPlottingPresets().filter(item => item.id !== 'custom').map(preset => (
        <button key={preset.id} type="button" class={`dynamic-example-button${active === preset.id ? ' is-active' : ''}`}
            data-dynamic-preset={preset.id} onClick={event => {
                applyDynamicPlottingPresetFromUI(preset.id);
                event.currentTarget.closest('details')?.removeAttribute('open');
            }}>
            <span class="dynamic-example-category">{preset.category || 'Example'}</span>
            <strong>{preset.label}</strong>
            <span class="dynamic-example-description">{preset.description || ''}</span>
        </button>
    ));
}

function commitFactors(factors) {
    updateDynamicPlotting(dynamic => {
        dynamic.term.kind = 'expression';
        dynamic.term.expression = composeProductExpression(factors);
    });
}

function ProductFactor({ factor, index, factors }) {
    const update = values => commitFactors(factors.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...values } : item
    ));
    return (
        <div class="dynamic-term-factor-card">
            <div class="dynamic-term-factor-heading">
                <strong>Factor {index + 1}</strong>
                <span class="dynamic-factor-position">{factor.denominator ? 'Denominator' : 'Numerator'}</span>
                {factors.length > 1 && <button type="button" class="dynamic-factor-remove"
                    onClick={() => commitFactors(factors.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}
            </div>
            <ExpressionPreview expression={composeProductExpression([{ ...factor, denominator: false }])} />
            <div class="dynamic-factor-controls">
                <Field label="Position">
                    <Select value={factor.denominator ? 'denominator' : 'numerator'} options={PLACEMENTS}
                        onChange={value => update({ denominator: value === 'denominator' })} />
                </Field>
                <Field label="Base expression u">
                    <input type="text" class="dynamic-formula-input" value={factor.base}
                        onChange={event => update({ base: event.currentTarget.value || '1' })} />
                </Field>
                <Field label="Power (optional)" hint="Examples: n, 2j+1, -s">
                    <input type="text" class="dynamic-formula-input" value={factor.exponent}
                        onChange={event => update({ exponent: event.currentTarget.value })} />
                </Field>
                <Field label="Wrapper">
                    <Select value={factor.wrapper || 'none'} options={WRAPPERS}
                        onChange={value => update({ wrapper: value })} />
                </Field>
            </div>
        </div>
    );
}

function DynamicTermFactors() {
    const dynamic = getStateSignal('dynamicPlotting').value;
    if (dynamic.term?.kind !== 'expression') return null;
    let factors;
    try {
        factors = decomposeProductExpression(String(dynamic.term.expression || '1'));
    } catch {
        return null;
    }
    return factors.map((factor, index) => (
        <ProductFactor key={index} factor={factor} index={index} factors={factors} />
    ));
}

function updateBinding(index, mutator) {
    updateDynamicPlotting(dynamic => {
        const binding = dynamic.term?.bindings?.[index];
        if (binding) mutator(binding, dynamic.term.bindings);
    });
}

function NumberField({ label, value, onChange, min, hint }) {
    return <Field label={label} hint={hint}><input type="number" class="dynamic-number-input" value={value ?? ''}
        min={min} step="any" onChange={event => onChange(Number(event.currentTarget.value) || 0)} /></Field>;
}

function BindingControls({ binding, index }) {
    const change = (key, value) => updateBinding(index, target => { target[key] = value; });
    if (binding.kind === 'parameter' || binding.kind === 'parameter_real') {
        return <div class="dynamic-binding-controls"><div class="dynamic-binding-parameter-note">
            {binding.kind === 'parameter_real'
                ? 'This symbol uses the real part of the plotted argument and stays fixed while j advances.'
                : 'This symbol is the free complex argument plotted across the output plane. It stays fixed while j advances.'}
        </div></div>;
    }
    if (binding.kind === 'naturals' || binding.kind === 'integers') {
        return <div class="dynamic-binding-controls"><div class="dynamic-binding-parameter-note">
            {binding.kind === 'naturals'
                ? 'Uses 0, 1, 2, 3, ... in order. Choose Arithmetic progression or Custom rule for a different pattern.'
                : 'Uses 0, 1, -1, 2, -2, ... in symmetric order.'}
        </div></div>;
    }

    const controls = [];
    if (binding.kind === 'constant') controls.push(
        <NumberField label="Real part" value={binding.value.re} onChange={value => updateBinding(index, target => { target.value.re = value; })} />,
        <NumberField label="Imaginary part" value={binding.value.im} onChange={value => updateBinding(index, target => { target.value.im = value; })} />
    );
    if (binding.kind === 'arithmetic') controls.push(
        <NumberField label="First value" value={binding.start} onChange={value => change('start', value)} />,
        <NumberField label="Common difference" value={binding.step} onChange={value => change('step', value)} />
    );
    if (binding.kind === 'geometric') controls.push(
        <NumberField label="First value" value={binding.start} onChange={value => change('start', value)} />,
        <NumberField label="Common ratio" value={binding.ratio} onChange={value => change('ratio', value)} />
    );
    if (binding.kind === 'harmonic') controls.push(
        <NumberField label="First denominator" value={binding.start} onChange={value => change('start', value)} />,
        <NumberField label="Denominator difference" value={binding.step} onChange={value => change('step', value)} />
    );
    if (binding.kind === 'primes') controls.push(
        <NumberField label="Minimum prime" value={binding.min} min="2" onChange={value => change('min', Math.max(2, Math.floor(value)))} />,
        <Field label="Optional maximum"><input type="number" class="dynamic-number-input" min="2" value={binding.max ?? ''}
            onChange={event => change('max', event.currentTarget.value === '' ? '' : Number(event.currentTarget.value))} /></Field>,
        <label class="dynamic-check"><input type="checkbox" checked={Boolean(binding.includeNegative)}
            onChange={event => change('includeNegative', event.currentTarget.checked)} />
            <span class="custom-checkbox-visual" />Include negative associates</label>
    );
    if (binding.kind === 'gaussian_integers' || binding.kind === 'gaussian_primes') controls.push(
        <NumberField label="Starting search radius" value={binding.bound} min="1"
            hint="The search expands automatically until every requested term is found."
            onChange={value => change('bound', Math.max(1, Math.floor(value)))} />,
        <Field label="Bound shape"><Select value={binding.boundType} options={[['norm', 'Norm radius'], ['square', 'Square']]}
            onChange={value => change('boundType', value)} /></Field>,
        <Field label="Associates"><Select value={binding.associatePolicy}
            options={[['all', 'All associates'], ['representatives', 'One representative']]}
            onChange={value => change('associatePolicy', value)} /></Field>
    );
    if (binding.kind === 'expression') controls.push(
        <Field label={`${binding.symbol}_j =`} hint="Use j as the zero-based term index, for example 2j+1.">
            <input type="text" class="dynamic-formula-input" value={binding.generatorExpression}
                onChange={event => change('generatorExpression', event.currentTarget.value)} />
        </Field>
    );
    if (binding.kind === 'custom_points') controls.push(
        <Field label="Values" hint="One value per line, or use semicolons.">
            <textarea class="dynamic-formula-input" rows="3" value={binding.pointsText || ''}
                onChange={event => change('pointsText', event.currentTarget.value)} />
        </Field>
    );
    return <div class="dynamic-binding-controls">{controls}</div>;
}

function bindingPreview(symbol) {
    try {
        const values = getDynamicPlotResult()?.samples?.slice(0, 7).map(sample => sample.symbolValues?.[symbol])
            .filter(Boolean).map(formatComplex) || [];
        return values.length ? values.join(', ') : 'no generated values';
    } catch {
        return 'preview unavailable';
    }
}

function SequenceBinding({ binding, index }) {
    const dynamic = getStateSignal('dynamicPlotting').value;
    const setKind = kind => updateBinding(index, (target, bindings) => {
        if (kind === 'parameter' || kind === 'parameter_real') {
            bindings.forEach(other => {
                if (other !== target && ['parameter', 'parameter_real'].includes(other.kind)) {
                    other.kind = 'constant';
                    other.value = { ...dynamic.aggregateParameter };
                }
            });
        }
        target.kind = kind;
        if (kind === 'naturals') Object.assign(target, { start: 0, step: 1, ordering: 'ascending' });
        if (kind === 'integers') Object.assign(target, { start: 1, step: 1, ordering: 'symmetric', includeZero: true });
        if (kind === 'geometric') Object.assign(target, { start: 1, ratio: 2 });
        if (kind === 'harmonic') Object.assign(target, { start: 1, step: 1 });
    });
    return (
        <div class="dynamic-sequence-binding-card">
            <div class="dynamic-binding-heading">
                <div class="dynamic-binding-identity"><strong>{binding.symbol}_j</strong><span>{getDynamicBindingRuleLabel(binding)}</span></div>
                <Select value={binding.kind} options={SEQUENCE_BINDING_KINDS} onChange={setKind} />
            </div>
            <BindingControls binding={binding} index={index} />
            <div class="dynamic-binding-preview">{binding.symbol}_j = {bindingPreview(binding.symbol)}</div>
        </div>
    );
}

function DynamicSequenceBindings() {
    getStateSignal('dynamicPlotting').value;
    return getDynamicTermBindings().map((binding, index) => (
        <SequenceBinding key={binding.id} binding={binding} index={index} />
    ));
}

function MathNode({ class: className = '', errorClass = 'dynamic-math-error', build, fallback = '' }) {
    const target = useRef(null);
    useEffect(() => {
        const element = target.current;
        if (!element) return;
        element.replaceChildren();
        try {
            const nodes = build();
            element.append(...(Array.isArray(nodes) ? nodes : [nodes]));
            element.classList.remove(errorClass);
        } catch (error) {
            element.textContent = fallback || error?.message || '';
            element.classList.add(errorClass);
        }
    }, [build, errorClass, fallback]);
    return <div ref={target} class={className} />;
}

function FormulaInput({ id, value, update, ...props }) {
    const [draft, setDraft] = useState(value);
    const timer = useRef(null);
    useEffect(() => {
        setDraft(value);
        return () => clearTimeout(timer.current);
    }, [value]);
    const commit = next => {
        clearTimeout(timer.current);
        update(next);
    };
    return <input {...props} id={id} value={draft}
        onInput={event => {
            const next = event.currentTarget.value;
            setDraft(next);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => commit(next), 180);
        }}
        onChange={event => commit(event.currentTarget.value)} />;
}

function updateSourceKind(dynamic, kind) {
    dynamic.source.kind = kind;
    if (kind === 'naturals') Object.assign(dynamic.source, { start: 0, step: 1, ordering: 'ascending' });
    if (kind === 'integers') Object.assign(dynamic.source, { start: 1, step: 1, ordering: 'symmetric', includeZero: true });
    if (kind === 'arithmetic' || kind === 'harmonic') Object.assign(dynamic.source, { start: 1, step: 1 });
    if (kind === 'geometric') Object.assign(dynamic.source, { start: 1, ratio: 2 });
    if (kind === 'expression' && !String(dynamic.source.generatorExpression ?? '').trim()) {
        dynamic.source.generatorExpression = 'j';
    }
    dynamic.playback.visibleCount = Math.min(dynamic.playback.visibleCount, dynamic.source.count);
}

function sourceKindLabel(kind) {
    const label = SOURCE_LABELS[kind];
    if (!label) throw new Error(`Unsupported dynamic source kind: ${kind}`);
    return label;
}

function selectedFunctionLabel(functionId) {
    const label = FUNCTION_LABELS[functionId];
    if (!label) throw new Error(`Unsupported selected function: ${functionId}`);
    return label;
}

function sourceDescription(dynamic) {
    const { source } = dynamic;
    const count = Math.max(0, requireInteger(source.count, 'Dynamic source count'));
    const start = requireFiniteNumber(source.start, 'Dynamic source start');
    const step = requireFiniteNumber(source.step, 'Dynamic source step');
    switch (source.kind) {
        case 'naturals': return `${count} natural numbers from ${start}`;
        case 'arithmetic': return `${count} terms with d_j = ${start} + j(${step})`;
        case 'geometric': return `${count} terms with d_j = ${start}(${requireFiniteNumber(source.ratio, 'Dynamic source ratio')})^j`;
        case 'harmonic': return `${count} terms with d_j = 1 / (${start} + j(${step}))`;
        case 'integers': return source.ordering === 'symmetric'
            ? `${count} symmetrically ordered integers`
            : start === 1 && step === 1
                ? `${count} integers: 1, 2, 3, ...`
                : `${count} values starting at ${start}, stepping by ${step}`;
        case 'primes': return `${count} rational primes: 2, 3, 5, 7, ...`;
        case 'gaussian_integers': return `${count} Gaussian integers`;
        case 'gaussian_primes': return `${count} Gaussian primes`;
        case 'custom_points': return `${count} custom complex points`;
        case 'expression': return `${count} generated values d_j = ${source.generatorExpression}`;
        default: throw new Error(`Unsupported dynamic source kind: ${source.kind}`);
    }
}

function sourceRule(source) {
    switch (source.kind) {
        case 'naturals': return { expression: 'j', note: 'j = 0, 1, 2, ...' };
        case 'integers': return source.ordering === 'symmetric'
            ? { text: 'dⱼ = 0, 1, −1, 2, −2, ...' }
            : { expression: `${source.start} + j*(${source.step})` };
        case 'arithmetic': return { expression: `${source.start} + j*(${source.step})`, note: 'dⱼ = a + jΔ' };
        case 'geometric': return { expression: `(${source.start})*(${source.ratio})^j`, note: 'dⱼ = arʲ' };
        case 'harmonic': return { expression: `1/((${source.start}) + j*(${source.step}))`, note: 'dⱼ = 1/(a + jΔ)' };
        case 'primes': return { text: 'dⱼ = the j-th rational prime' };
        case 'gaussian_integers': return { text: 'dⱼ = the j-th Gaussian integer in norm order' };
        case 'gaussian_primes': return { text: 'dⱼ = the j-th Gaussian prime in norm order' };
        case 'custom_points': return { text: 'dⱼ = the j-th value in your point list' };
        case 'expression': return { expression: source.generatorExpression };
        default: throw new Error(`Unsupported dynamic source kind: ${source.kind}`);
    }
}

function sourcePreview(dynamic) {
    return generateDiscreteSource({ ...dynamic.source, points: [...dynamic.source.points] });
}

function SourceDefinition({ source }) {
    const rule = sourceRule(source);
    if (rule.text) return <div id="dynamic_source_definition_math" class="dynamic-source-definition-math">{rule.text}</div>;
    return <div id="dynamic_source_definition_math" class="dynamic-source-definition-math">
        <span class="dynamic-source-definition-prefix">dⱼ =</span>
        <MathNode class="dynamic-math-contents" errorClass="dynamic-source-definition-error"
            build={() => createExpressionMathML(rule.expression, { sequenceVariables: [] })} />
        {rule.note && <small>{rule.note}</small>}
    </div>;
}

function SourceOptions({ dynamic, update }) {
    const source = dynamic.source;
    const number = (id, key, label) => <Field label={label}><input id={id} class="dynamic-number-input"
        type="number" step="any" value={source[key]}
        onChange={event => update(config => { config.source[key] = Number(event.currentTarget.value); })} /></Field>;
    switch (source.kind) {
        case 'arithmetic': return <div id="dynamic_arithmetic_options" class="dynamic-options-card"><div class="dynamic-grid dynamic-grid-two">
            {number('dynamic_arithmetic_first', 'start', 'First term (a)')}
            {number('dynamic_arithmetic_difference', 'step', 'Common difference (Δ)')}
        </div></div>;
        case 'geometric': return <div id="dynamic_geometric_options" class="dynamic-options-card"><div class="dynamic-grid dynamic-grid-two">
            {number('dynamic_geometric_first', 'start', 'First term (a)')}
            {number('dynamic_geometric_ratio', 'ratio', 'Common ratio (r)')}
        </div></div>;
        case 'harmonic': return <div id="dynamic_harmonic_options" class="dynamic-options-card"><div class="dynamic-grid dynamic-grid-two">
            {number('dynamic_harmonic_first', 'start', 'First denominator (a)')}
            {number('dynamic_harmonic_difference', 'step', 'Denominator difference (Δ)')}
        </div></div>;
        case 'primes': return <div id="dynamic_prime_options" class="dynamic-options-card">
            <div class="dynamic-grid dynamic-grid-two">
                {number('dynamic_prime_min', 'min', 'Minimum')}
                <Field label="Maximum (optional)"><input id="dynamic_prime_max" class="dynamic-number-input" type="number" min="2" step="1"
                    value={source.max} onChange={event => update(config => { config.source.max = event.currentTarget.value === '' ? '' : Number(event.currentTarget.value); })} /></Field>
            </div>
            <label class="dynamic-check"><input id="dynamic_prime_include_negative" type="checkbox" checked={source.includeNegative}
                onChange={event => update(config => { config.source.includeNegative = event.currentTarget.checked; })} />
                <span class="custom-checkbox-visual" />Include signed associates (±p)</label>
        </div>;
        case 'gaussian_integers':
        case 'gaussian_primes': return <div id="dynamic_gaussian_options" class="dynamic-options-card">
            <div class="dynamic-grid dynamic-grid-three">
                <Field label="Starting search radius" hint="Expands automatically until all N values are found."><input id="dynamic_gaussian_bound"
                    class="dynamic-number-input" type="number" min="1" step="1" value={source.bound}
                    onChange={event => update(config => { config.source.bound = Math.max(1, Math.floor(Number(event.currentTarget.value))); })} /></Field>
                <Field label="Bound type"><Select id="dynamic_gaussian_bound_type" value={source.boundType}
                    options={[['norm', 'Norm radius'], ['square', 'Square']]}
                    onChange={value => update(config => { config.source.boundType = value; })} /></Field>
                <Field label="Associates"><Select id="dynamic_gaussian_associate_policy" value={source.associatePolicy}
                    options={[['all', 'All associates'], ['representatives', 'Representatives']]}
                    onChange={value => update(config => { config.source.associatePolicy = value; })} /></Field>
            </div>
            <label class="dynamic-check"><input id="dynamic_gaussian_include_conjugates" type="checkbox" checked={source.includeConjugates}
                onChange={event => update(config => { config.source.includeConjugates = event.currentTarget.checked; })} />
                <span class="custom-checkbox-visual" />Include conjugates</label>
        </div>;
        case 'custom_points': return <div id="dynamic_custom_points_options" class="dynamic-options-card">
            <Field label="Points — one per line or semicolon-separated (re,im or a+bi)"><textarea id="dynamic_custom_points_text"
                class="dynamic-formula-input" rows="3" value={source.pointsText}
                onChange={event => update(config => { config.source.pointsText = event.currentTarget.value; })} /></Field>
        </div>;
        case 'expression': return <div id="dynamic_expression_source_options" class="dynamic-options-card">
            <Field label={<span>Source formula d<sub>j</sub> =</span>} hint="Use j = 0, 1, 2, ...">
                <FormulaInput id="dynamic_generator_expression" class="dynamic-formula-input" type="text" spellcheck="false"
                    value={source.generatorExpression} update={value => update(config => { config.source.generatorExpression = value; })} />
            </Field>
            <Field label="Filter — keep when (optional)"><FormulaInput id="dynamic_filter_expression" class="dynamic-formula-input"
                type="text" spellcheck="false" placeholder="e.g. gcd(j, 6) == 1" value={source.filterExpression}
                update={value => update(config => { config.source.filterExpression = value; })} /></Field>
        </div>;
        default: return null;
    }
}

function Step({ number, title, subtitle, action, children }) {
    return <div class="dynamic-step">
        <div class="dynamic-step-badge">{number}</div>
        <div class={`dynamic-step-header${action ? ' dynamic-step-header-with-action' : ''}`}>
            <div><div class="dynamic-step-title">{title}</div><div class="dynamic-step-subtitle">{subtitle}</div></div>
            {action}
        </div>
        <div class="dynamic-step-body">{children}</div>
    </div>;
}

function EquationHelp({ open, setOpen }) {
    const target = useRef(null);
    useEffect(() => {
        if (open) target.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [open]);
    return <section ref={target} id="dynamic_equation_help" class={`dynamic-equation-help${open ? '' : ' hidden'}`} aria-label="Equation writing guide">
        <div class="dynamic-equation-help-heading"><div><div class="dynamic-card-title">Equation guide</div>
            <p>Write ordinary mathematical expressions. New symbols automatically get their own sequence rule.</p></div>
            <button id="dynamic_formula_help_close_btn" type="button" class="dynamic-help-close" aria-label="Close equation guide" onClick={() => setOpen(false)}>Close</button>
        </div>
        <div class="dynamic-equation-help-grid">
            <div class="dynamic-help-section"><strong>Values you already have</strong><dl>
                <dt><code>j</code></dt><dd>term index: 0, 1, 2, ...</dd>
                <dt><code>c</code></dt><dd>current input-plane parameter</dd>
                <dt><code>d</code></dt><dd>current source value d<sub>j</sub></dd>
                <dt><code>z</code></dt><dd>current input-plane point z<sub>j</sub></dd>
                <dt><code>i, pi, e</code></dt><dd>mathematical constants</dd>
            </dl></div>
            <div class="dynamic-help-section"><strong>Writing expressions</strong>
                <p><code>+ - * / ^ !</code> are supported. Multiplication may be implicit: <code>2j</code>, <code>3i</code>, <code>2(n+1)</code>.</p>
                <p>Use conditions as <code>isPrime(j) ? 1/j : 0</code>.</p></div>
            <div class="dynamic-help-section"><strong>Complex functions</strong>
                <p><code>sin cos tan exp ln sqrt abs arg conj re im zeta selected</code></p>
                <p>Also: <code>floor ceil round mod gcd factorial isPrime min max complex</code>.</p></div>
            <div class="dynamic-help-section"><strong>Defined behavior</strong>
                <p>Division by zero, invalid factorials, overflow, and undefined function values are marked undefined instead of breaking the plot.</p>
                <p>Equations are bounded in size and complexity so live editing remains responsive.</p></div>
        </div>
    </section>;
}

function sourceSequenceVariables(bindings) {
    return ['c', 'd', 'z', ...bindings
        .filter(binding => binding.kind !== 'parameter' && binding.kind !== 'parameter_real')
        .map(binding => binding.symbol)];
}

function freeParameterSymbols(dynamic) {
    if (typeof dynamic.pointExpression !== 'string') {
        throw new Error('Dynamic plotting requires a point expression.');
    }
    const symbols = getDynamicFreeParameterSymbols();
    return /(^|[^A-Za-z0-9_])s([^A-Za-z0-9_]|$)/.test(dynamic.pointExpression) && !symbols.includes('s')
        ? ['s', ...symbols]
        : symbols;
}

function playbackCount(dynamic, result) {
    return dynamic.enabled && result ? result.samples.length : Math.max(0, requireInteger(dynamic.source.count, 'Dynamic source count'));
}

export function DynamicPlottingStudio() {
    const dynamic = getStateSignal('dynamicPlotting').value;
    const currentFunction = getStateSignal('currentFunction').value;
    const [minimized, setMinimized] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const bindings = getDynamicTermBindings();
    const parameterSymbols = freeParameterSymbols(dynamic);
    const reduction = dynamic.reduction.kind;
    const operation = OPERATION_COPY[reduction];
    const customExpression = dynamic.term.kind === 'expression';
    const termSource = customExpression ? dynamic.term.expression : 'selected(z)';
    const termLabel = customExpression
        ? dynamic.term.expression
        : `${selectedFunctionLabel(currentFunction)}(z_j)`;
    const sequenceVariables = sourceSequenceVariables(bindings);
    const resultState = useMemo(() => {
        if (!dynamic.enabled) return { result: null, error: null };
        try { return { result: getDynamicPlotResult(), error: null }; }
        catch (error) { return { result: null, error: error?.message || String(error) }; }
    }, [dynamic, currentFunction]);
    const count = playbackCount(dynamic, resultState.result);
    const visible = Math.max(0, Math.min(count, requireInteger(dynamic.playback.visibleCount, 'Dynamic visible count')));
    const preview = useMemo(() => {
        try { return { source: sourcePreview(dynamic), error: null }; }
        catch (error) { return { source: null, error: error?.message || String(error) }; }
    }, [dynamic.source]);
    const feedback = resultState.error || resultState.result?.visibleSamples.find(sample => sample.error)?.error ||
        resultState.result?.bindingDiagnostics?.[0] || (resultState.result?.invalidCount
            ? `${resultState.result.invalidCount} visible term${resultState.result.invalidCount === 1 ? ' is' : 's are'} undefined for the current values.`
            : '');
    const update = (mutator, options) => updateDynamicPlotting(mutator, options);
    const setVisible = value => update(config => {
        config.playback.visibleCount = Math.max(0, Math.min(count, requireInteger(value, 'Dynamic visible count')));
    });

    useEffect(() => {
        document.body.classList.toggle('dynamic-studio-open', Boolean(dynamic.enabled));
        return () => document.body.classList.remove('dynamic-studio-open');
    }, [dynamic.enabled]);

    useEffect(() => {
        if (!dynamic.enabled || !dynamic.playback.playing) return undefined;
        let handle;
        let previous = 0;
        const tick = now => {
            if (!previous) previous = now;
            const increment = Math.max(0, now - previous) / 1000 * Math.max(0.1, dynamic.playback.speed);
            if (increment >= 1) {
                const step = Math.floor(increment);
                previous = now;
                update(config => {
                    let next = config.playback.visibleCount + step;
                    if (next > count) {
                        if (config.playback.loop) next = count > 0 ? 1 : 0;
                        else {
                            next = count;
                            config.playback.playing = false;
                        }
                    }
                    config.playback.visibleCount = next;
                });
            }
            if (state.dynamicPlotting.playback.playing) handle = requestAnimationFrame(tick);
        };
        handle = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(handle);
    }, [dynamic.enabled, dynamic.playback.playing, dynamic.playback.speed, dynamic.playback.loop, count]);

    const formulaBuild = () => [
        createGeneralTermMathML(termSource, { parameterSymbols, sequenceVariables }),
        createAggregateMathML(termSource, { count: visible, reduction, parameterSymbols, sequenceVariables })
    ];
    const sourceValues = preview.source?.records.slice(0, 8).map(record => formatComplex(record.domainValue)) || [];
    const sourceSuffix = preview.source?.records.length > sourceValues.length ? ', ...' : '';
    const parameterList = parameterSymbols.join(', ');

    return <div id="dynamic_plotting_controls_container"
        class={`dynamic-plotting-controls${dynamic.enabled ? '' : ' hidden'}${minimized ? ' is-minimized' : ''}`}
        role="dialog" aria-modal="false" aria-label="Dynamic Plotting Studio" aria-hidden={String(!dynamic.enabled)}>
        <div class="dynamic-studio-header">
            <div class="dynamic-studio-identity"><span class="dynamic-section-eyebrow">Dynamic Plotting Studio</span>
                <strong id="dynamic_studio_summary">{sourceKindLabel(dynamic.source.kind)} → {termLabel} → {operation[0]}</strong></div>
            <div class="dynamic-studio-actions">
                <button id="dynamic_minimize_studio_btn" type="button" class="dynamic-studio-action"
                    aria-expanded={String(!minimized)} onClick={() => setMinimized(!minimized)}>{minimized ? 'Open studio' : 'Minimize'}</button>
                <button id="dynamic_close_studio_btn" type="button" class="dynamic-studio-action dynamic-studio-close"
                    aria-label="Close Dynamic Plotting Studio" onClick={() => update(config => {
                        config.enabled = false;
                        config.playback.playing = false;
                    }, { preservePreset: true })}>Close</button>
            </div>
        </div>
        <div class="dynamic-intro"><div><div class="dynamic-intro-title">Build a discrete complex plot</div>
            <div class="dynamic-intro-copy">Choose a sequence, write its general term, then map, add, or multiply.</div></div></div>
        <div class="dynamic-formula-banner">
            <div class="dynamic-formula-banner-heading"><span class="dynamic-formula-banner-label">What you are building</span>
                <span id="dynamic_formula_mode_badge" class="dynamic-formula-mode-badge">{operation[0]}</span></div>
            <div id="dynamic_formula_banner_content" class="dynamic-formula-banner-content">
                <MathNode class="dynamic-math-contents" build={formulaBuild} />
                <div class="dynamic-formula-definitions">
                    <div class="dynamic-formula-definition">d_j: {sourceDescription(dynamic)}</div>
                    {bindings.map(binding => <div key={binding.symbol} class="dynamic-formula-definition">{binding.symbol}_j: {getDynamicBindingRuleLabel(binding)}</div>)}
                </div>
            </div>
            <div id="dynamic_formula_explanation" class={`dynamic-formula-explanation${resultState.error ? ' dynamic-formula-explanation-error' : ''}`}>
                {resultState.error ? `The formula cannot be evaluated yet: ${resultState.error}` : operation[2]}
            </div>
        </div>
        <div class="dynamic-pipeline">
            <Step number="1" title="Choose the sequence" subtitle={<span>Define d<sub>j</sub> and how many terms to generate</span>}>
                <div class="dynamic-grid dynamic-grid-two">
                    <Field label="Sequence"><Select id="dynamic_source_kind" value={dynamic.source.kind} options={SOURCE_OPTIONS}
                        onChange={value => update(config => updateSourceKind(config, value))} /></Field>
                    <Field label="Terms (N)"><input id="dynamic_source_count" class="dynamic-number-input" type="number"
                        min="0" max={MAX_DYNAMIC_SOURCE_COUNT} step="1" value={dynamic.source.count}
                        onChange={event => update(config => {
                            config.source.count = Math.max(0, Math.min(MAX_DYNAMIC_SOURCE_COUNT, Math.floor(Number(event.currentTarget.value))));
                            config.playback.visibleCount = config.source.count;
                        })} /></Field>
                </div>
                <SourceOptions dynamic={dynamic} update={update} />
                <div class="dynamic-source-definition"><span class="dynamic-source-definition-label">Source rule</span>
                    <SourceDefinition source={dynamic.source} /></div>
                <div class="dynamic-source-preview"><span class="dynamic-source-preview-label">First terms</span>
                    <span id="dynamic_source_preview_values" title={preview.source?.records.slice(0, 40).map(record => formatComplex(record.domainValue)).join(', ') || ''}>
                        {preview.error || (sourceValues.length ? `${sourceValues.join(', ')}${sourceSuffix}` : 'no values')}
                    </span></div>
                <div id="dynamic_source_feedback" class={`dynamic-inline-feedback${preview.error ? ' dynamic-inline-feedback-error' : preview.source?.diagnostics[0] ? ' dynamic-inline-feedback-warning' : ' hidden'}`}>
                    {preview.error || preview.source?.diagnostics[0] || ''}
                </div>
            </Step>
            <Step number="2" title="Place it on the input plane" subtitle={<span>Usually z<sub>j</sub> = d<sub>j</sub>; change it only for a transformed input path</span>}>
                <Field label={<span>Input point z<sub>j</sub> =</span>} hint={<span>Usually leave this as <code>d</code>. Example: <code>d * exp(i*k*j)</code> creates a spiral.</span>}>
                    <FormulaInput id="dynamic_point_expression" class="dynamic-formula-input" type="text" spellcheck="false"
                        value={dynamic.pointExpression} update={value => update(config => { config.pointExpression = value; })} />
                </Field>
            </Step>
            <Step number="3" title="Write the general term" subtitle={<span>Build a<sub>j</sub>, then define how each symbol changes with j</span>}
                action={<button id="dynamic_formula_help_btn" type="button" class="dynamic-help-button" aria-expanded={String(helpOpen)}
                    aria-controls="dynamic_equation_help" onClick={() => setHelpOpen(!helpOpen)}><span aria-hidden="true">?</span> Equation guide</button>}>
                <Field label="For each input point, compute"><Select id="dynamic_term_kind" value={dynamic.term.kind}
                    options={[['expression', 'A formula I write'], ['selected-function', 'The selected function f(z_j)']]}
                    onChange={value => update(config => { config.term.kind = value; })} /></Field>
                <div class="dynamic-general-term-display"><div class="dynamic-general-term-label">Current general term</div>
                    <MathNode class="dynamic-math-display" build={() => createGeneralTermMathML(termSource, { parameterSymbols, sequenceVariables })} /></div>
                {customExpression && <div id="dynamic_term_builder" class="dynamic-term-builder">
                    <div class="dynamic-card-heading-row"><div><div class="dynamic-card-title">Product-term composer</div>
                        <div class="dynamic-step-subtitle">Each factor can sit in the numerator or denominator, carry a power, or be wrapped in a function.</div></div></div>
                    <div id="dynamic_term_factors" class="dynamic-term-factors"><DynamicTermFactors /></div>
                    <div class="dynamic-factor-add-row">
                        <button id="dynamic_add_numerator_factor_btn" type="button" class="dynamic-small-button"
                            onClick={() => commitFactors([...decomposeProductExpression(dynamic.term.expression), createProductFactor(false)])}>+ Numerator factor</button>
                        <button id="dynamic_add_denominator_factor_btn" type="button" class="dynamic-small-button"
                            onClick={() => commitFactors([...decomposeProductExpression(dynamic.term.expression), createProductFactor(true)])}>+ Denominator factor</button>
                    </div>
                    <Field label="Complete formula" hint="Edit the equation directly, or use the factor composer above.">
                        <FormulaInput id="dynamic_term_expression" class="dynamic-formula-input" type="text" spellcheck="false" autocomplete="off"
                            value={dynamic.term.expression} update={value => update(config => { config.term.expression = value; })} />
                    </Field>
                    <div id="dynamic_formula_feedback" class={`dynamic-inline-feedback${resultState.error
                        ? ' dynamic-inline-feedback-error'
                        : feedback ? ' dynamic-inline-feedback-warning' : ' hidden'}`}>{feedback}</div>
                </div>}
                {customExpression && <div id="dynamic_expression_assistant" class="dynamic-expression-assistant">
                    <div class="dynamic-expression-assistant-title">Start from an expression</div>
                    <div class="dynamic-expression-chip-row">{EXPRESSION_STARTERS.map(([expression, label]) => <button key={expression} type="button"
                        data-dynamic-expression={expression} onClick={() => update(config => { config.term.expression = expression; })}>{label}</button>)}</div>
                    <div class="dynamic-expression-language"><code>d</code> source value <code>j</code> index <code>z</code> input point <code>s</code> free parameter <code>i</code> imaginary unit</div>
                    <button type="button" id="dynamic_open_reference_btn" class="dynamic-reference-link" onClick={() => setHelpOpen(true)}>Open the equation guide</button>
                </div>}
                <EquationHelp open={helpOpen} setOpen={setHelpOpen} />
                {customExpression && bindings.length > 0 && <div id="dynamic_sequence_bindings_card" class="dynamic-sequence-bindings">
                    <div class="dynamic-card-title">How each symbol changes</div>
                    <div class="dynamic-step-subtitle">At term j, every symbol below supplies its j-th value. Change each sequence independently.</div>
                    <div id="dynamic_sequence_bindings_list" class="dynamic-sequence-bindings-list"><DynamicSequenceBindings /></div>
                </div>}
            </Step>
            <Step number="4" title="Combine the terms" subtitle={operation[1]}>
                <div class="dynamic-operation-segmented">{['none', 'sum', 'product'].map(kind => <Fragment key={kind}>
                    <input type="radio" name="dynamic_reduction_kind_radio" id={`dynamic_reduction_${kind}`} value={kind}
                        checked={reduction === kind} onChange={() => update(config => {
                            config.reduction.kind = kind;
                            config.mode = kind === 'none' ? 'map' : 'aggregate';
                        })} />
                    <label for={`dynamic_reduction_${kind}`}><span class="dynamic-operation-symbol">{{ none: '⊙', sum: 'Σ', product: 'Π' }[kind]}</span> {OPERATION_COPY[kind][0]}</label>
                </Fragment>)}</div>
                <div id="dynamic_operation_explanation" class="dynamic-operation-explanation">{operation[2]}</div>
                {reduction !== 'none' && <div id="dynamic_reduction_options" class="dynamic-options-card"><div class="dynamic-grid dynamic-grid-two">
                    <Field label="When a term is undefined"><Select id="dynamic_invalid_policy" value={dynamic.reduction.invalidPolicy}
                        options={[['stop', 'Stop the series'], ['skip', 'Skip and continue']]}
                        onChange={value => update(config => { config.reduction.invalidPolicy = value; })} /></Field>
                    {reduction === 'product' && <Field label="Product visualization"><Select id="dynamic_product_view" value={dynamic.productView}
                        options={[['orbit', 'Ordinary orbit'], ['normalized', 'Normalized orbit']]}
                        onChange={value => update(config => { config.productView = value; }, { domainDirty: false })} /></Field>}
                </div></div>}
                {parameterSymbols.length > 0 && <div id="dynamic_aggregate_parameter_row" class="dynamic-options-card">
                    <div id="dynamic_free_parameter_title" class="dynamic-card-title">Free parameter{parameterSymbols.length > 1 ? `s ${parameterList}` : ` ${parameterList}`}</div>
                    <div id="dynamic_free_parameter_copy" class="dynamic-step-subtitle compact-step-copy">{parameterSymbols.length > 1
                        ? 'These symbols share the plotted complex argument. Their value remains fixed while j advances.'
                        : `${parameterList} remains fixed while j advances and becomes the complex variable plotted by the aggregate.`}</div>
                    <div class="dynamic-s-param-group"><span id="dynamic_free_parameter_label" class="dynamic-s-label">{parameterList} =</span>
                        <input id="dynamic_s_re" class="dynamic-number-input" type="number" step="any" value={dynamic.aggregateParameter.re}
                            onChange={event => update(config => { config.aggregateParameter.re = Number(event.currentTarget.value); })} />
                        <span class="dynamic-s-sep">+</span>
                        <input id="dynamic_s_im" class="dynamic-number-input" type="number" step="any" value={dynamic.aggregateParameter.im}
                            onChange={event => update(config => { config.aggregateParameter.im = Number(event.currentTarget.value); })} />
                        <span class="dynamic-s-sep">i</span></div>
                </div>}
            </Step>
        </div>
        <details class="dynamic-quick-start"><summary class="dynamic-example-summary"><span><strong>Examples</strong>
            <small id="dynamic_example_count"><DynamicExampleCount /></small></span><span class="dynamic-example-summary-action">Browse</span></summary>
            <div class="dynamic-example-body"><div class="dynamic-step-subtitle">Choose an example, then change any part of it.</div>
                <div id="dynamic_example_gallery" class="dynamic-example-grid"><DynamicExampleGallery /></div></div></details>
        <div class="dynamic-options-card"><div class="dynamic-card-title">Accumulation Playback</div>
            <div class="dynamic-step-subtitle compact-step-copy">Watch terms accumulate one by one. The slider controls how many terms are visible.</div>
            <div class="dynamic-playback-row">
                <button id="dynamic_reset_playback_btn" type="button" class="dynamic-small-button" onClick={() => setVisible(0)}>⟲</button>
                <button id="dynamic_step_back_btn" type="button" class="dynamic-small-button" onClick={() => setVisible(visible - 1)}>◂</button>
                <button id="dynamic_play_pause_btn" type="button" class="dynamic-play-button" onClick={() => update(config => {
                    config.playback.playing = !config.playback.playing;
                }, { domainDirty: false })}>{dynamic.playback.playing ? 'Pause' : 'Play terms'}</button>
                <button id="dynamic_step_forward_btn" type="button" class="dynamic-small-button" onClick={() => setVisible(visible + 1)}>▸</button>
            </div>
            <Field label={<span>Showing <output id="dynamic_visible_count_display">{visible} / {count}</output> terms</span>}>
                <input id="dynamic_visible_count_slider" type="range" min="0" max={Math.max(1, count)} step="1" value={visible}
                    onInput={event => setVisible(event.currentTarget.value)} /></Field>
            <div class="dynamic-grid dynamic-grid-two">
                <Field label="Visible count"><input id="dynamic_visible_count_number" class="dynamic-number-input" type="number" min="0" max={count}
                    step="1" value={visible} onChange={event => setVisible(event.currentTarget.value)} /></Field>
                <Field label="Terms / second"><input id="dynamic_playback_speed" class="dynamic-number-input" type="number" min="0.1" max="1000"
                    step="0.1" value={dynamic.playback.speed}
                    onChange={event => update(config => { config.playback.speed = Math.max(0.1, Number(event.currentTarget.value)); })} /></Field>
            </div>
            <label class="dynamic-check"><input id="dynamic_playback_loop" type="checkbox" checked={dynamic.playback.loop}
                onChange={event => update(config => { config.playback.loop = event.currentTarget.checked; }, { domainDirty: false })} />
                <span class="custom-checkbox-visual" />Loop playback</label>
        </div>
    </div>;
}
