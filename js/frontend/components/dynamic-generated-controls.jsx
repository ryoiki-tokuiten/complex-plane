/** @jsxImportSource preact */
import { useEffect, useRef } from 'preact/hooks';
import { getStateSignal } from '../../store/state.js';
import {
    applyDynamicPlottingPresetFromUI,
    getDynamicBindingRuleLabel,
    updateDynamicPlotting
} from '../../ui/dynamic-plotting-ui.js';
import {
    getDynamicPlotResult,
    getDynamicPlottingPresets,
    getDynamicTermBindings
} from '../../analysis/dynamic-plotting.js';
import { formatComplex } from '../../analysis/discrete-sources.js';
import { SEQUENCE_BINDING_KINDS } from '../../analysis/sequence-bindings.js';
import {
    composeProductExpression,
    createExpressionMathML,
    decomposeProductExpression
} from '../../math/expression/index.js';

const PLACEMENTS = [['numerator', 'Numerator'], ['denominator', 'Denominator']];
const WRAPPERS = [
    ['none', 'No wrapper'], ['factorial', 'Factorial u!'], ['ln', 'ln(u)'], ['exp', 'exp(u)'],
    ['sqrt', 'sqrt(u)'], ['sin', 'sin(u)'], ['cos', 'cos(u)'], ['abs', '|u|'],
    ['conj', 'conj(u)'], ['selected', 'selected f(u)']
];

function Select({ value, options, onChange }) {
    return (
        <select class="control-select" value={value} onChange={event => onChange(event.currentTarget.value)}>
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

function ExpressionPreview({ expression }) {
    const target = useRef(null);
    useEffect(() => {
        try {
            target.current.replaceChildren(createExpressionMathML(expression));
        } catch {
            target.current.textContent = expression;
        }
    }, [expression]);
    return <div ref={target} class="dynamic-factor-math" />;
}

export function DynamicExampleCount() {
    return `${getDynamicPlottingPresets().filter(item => item.id !== 'custom').length} ready-made constructions`;
}

export function DynamicExampleGallery() {
    const active = getStateSignal('dynamicPlotting').value.preset;
    return getDynamicPlottingPresets().filter(item => item.id !== 'custom').map(preset => (
        <button type="button" class={`dynamic-example-button${active === preset.id ? ' is-active' : ''}`}
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

export function DynamicTermFactors() {
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

export function DynamicSequenceBindings() {
    getStateSignal('dynamicPlotting').value;
    return getDynamicTermBindings().map((binding, index) => (
        <SequenceBinding key={binding.id} binding={binding} index={index} />
    ));
}

const parameterValue = value => Number.isFinite(Number(value)) ? String(Number(Number(value).toFixed(8))) : '0';

function updateParameter(index, key, value) {
    updateDynamicPlotting(dynamic => {
        const parameter = dynamic.parameters[index];
        if (!parameter) return;
        if (key === 'name') {
            const name = String(value).trim();
            if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) parameter.name = name;
            return;
        }
        parameter[key] = Number.isFinite(Number(value)) ? Number(value) : parameter[key];
        if (parameter.min > parameter.max) [parameter.min, parameter.max] = [parameter.max, parameter.min];
        parameter.step = Math.max(Number.EPSILON, Math.abs(parameter.step));
        parameter.value = Math.max(parameter.min, Math.min(parameter.max, parameter.value));
    });
}

function Parameter({ parameter, index, count }) {
    return (
        <div class="dynamic-parameter-card" data-parameter-index={index}>
            <div class="dynamic-parameter-header">
                <input type="text" class="dynamic-text-input dynamic-parameter-name"
                    value={parameter.name || `p${index + 1}`} aria-label={`Parameter ${index + 1} name`}
                    onChange={event => updateParameter(index, 'name', event.currentTarget.value)} />
                <button type="button" class="dynamic-small-button dynamic-remove-parameter" disabled={count <= 1}
                    onClick={() => updateDynamicPlotting(dynamic => {
                        if (dynamic.parameters.length > 1) dynamic.parameters.splice(index, 1);
                    })}>Remove</button>
            </div>
            <div class="dynamic-parameter-fields">
                {['value', 'min', 'max', 'step'].map(key => (
                    <label>{key[0].toUpperCase() + key.slice(1)}
                        <input type="number" class={`dynamic-number-input dynamic-parameter-${key}`}
                            value={parameterValue(parameter[key])} step="any"
                            onChange={event => updateParameter(index, key, event.currentTarget.value)} />
                    </label>
                ))}
            </div>
            <input type="range" class="dynamic-parameter-slider" min={parameter.min} max={parameter.max}
                step={parameter.step} value={parameter.value}
                onInput={event => updateParameter(index, 'value', event.currentTarget.value)} />
        </div>
    );
}

export function DynamicParameters() {
    const parameters = getStateSignal('dynamicPlotting').value.parameters;
    return parameters.map((parameter, index) => (
        <Parameter key={parameter.id} parameter={parameter} index={index} count={parameters.length} />
    ));
}
