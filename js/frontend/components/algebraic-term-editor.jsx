/** @jsxImportSource preact */
import { getStateSignal, mutateState } from '../../store/state.js';
import { requestRedrawAll } from '../../rendering/redraw-scheduler.js';
import { syncParameterControlsPanelVisibility, updateTitlesAndGlobalUI } from '../../ui/ui-updates.js';

const FUNCTION_OPTIONS = [
    ['none', 'None'], ['c', 'c'], ['cos', 'cos(z)'], ['sin', 'sin(z)'], ['tan', 'tan(z)'],
    ['sec', 'sec(z)'], ['exp', 'e^z'], ['ln', 'ln(z)'], ['sinh', 'sinh(z)'],
    ['cosh', 'cosh(z)'], ['tanh', 'tanh(z)'], ['power', 'z^n'], ['reciprocal', '1/z'],
    ['mobius', 'Möbius'], ['zeta', 'ζ(z)'], ['polynomial', 'Polynomial'], ['poincare', 'Poincare Disk']
];

const SYMBOLS = new Map([
    ['c', 'c'], ['power', 'z^n'], ['zeta', 'ζ'], ['polynomial', 'P'],
    ['mobius', 'Möbius'], ['poincare', 'Poincare']
]);

export const createAlgebraicFactor = (func = 'cos') => ({
    func, chainedFunc: 'none', power: 1, reciprocal: false, log: false, exp: false
});

export const createAlgebraicTerm = () => ({
    coeff: { re: 1, im: 0 }, factors: [createAlgebraicFactor()]
});

function redraw(commit = false) {
    if (commit) {
        updateTitlesAndGlobalUI();
        syncParameterControlsPanelVisibility();
    }
    requestRedrawAll();
}

function mutate(mutator, path, commit = false) {
    mutateState('algebraicChainingTerms', mutator, path);
    redraw(commit);
}

export function appendAlgebraicTerm() {
    mutate(terms => terms.push(createAlgebraicTerm()), 'algebraicChainingTerms', true);
}

const nearZero = value => Math.abs(value) < 1e-9;

function coefficientText(term) {
    const re = Number(term.coeff?.re) || 0;
    const im = Number(term.coeff?.im) || 0;
    const hasFactors = (term.factors || []).some(factor => factor.func && factor.func !== 'none');
    if (nearZero(re) && nearZero(im)) return '0';
    if (nearZero(im)) {
        if (hasFactors && nearZero(re - 1)) return '';
        if (hasFactors && nearZero(re + 1)) return '-';
        return re.toFixed(1);
    }
    const real = nearZero(re) ? '' : re.toFixed(1);
    const magnitude = Math.abs(im);
    const imaginary = nearZero(magnitude - 1) ? 'i' : `${magnitude.toFixed(1)}i`;
    return real ? `(${real}${im >= 0 ? '+' : '-'}${imaginary})` : `${im < 0 ? '-' : ''}${imaginary}`;
}

function factorText(factor) {
    const symbol = value => SYMBOLS.get(value) || value;
    let text = factor.func === 'c' ? 'c' : factor.chainedFunc && factor.chainedFunc !== 'none'
        ? `${symbol(factor.func)}(${symbol(factor.chainedFunc)}(z))`
        : `${symbol(factor.func)}(z)`;
    if (factor.power !== undefined && factor.power !== 1) text = `(${text})^${Number(factor.power).toFixed(1)}`;
    if (factor.reciprocal) text = `1/(${text})`;
    if (factor.log) text = `ln(${text})`;
    if (factor.exp) text = `e^(${text})`;
    return text;
}

function termPreview(term) {
    const coefficient = coefficientText(term);
    if (coefficient === '0') return '0';
    const factors = (term.factors || []).filter(factor => factor.func && factor.func !== 'none').map(factorText);
    if (!factors.length) return coefficient || '1';
    const product = factors.join('·');
    return coefficient === '' ? product : coefficient === '-' ? `-${product}` : `${coefficient}·${product}`;
}

function AlgebraicRange({ label, value, onValue }) {
    return (
        <div class="algebraic-slider-row">
            <label class="algebraic-slider-label">{label}<span class="algebraic-slider-value">{Number(value).toFixed(1)}</span></label>
            <div class="algebraic-slider-container">
                <input type="range" min="-5" max="5" step="0.1" value={value}
                    onInput={event => onValue(Number.parseFloat(event.currentTarget.value), false)}
                    onChange={event => onValue(Number.parseFloat(event.currentTarget.value), true)} />
            </div>
        </div>
    );
}

function FunctionSelect({ value, onChange }) {
    return (
        <select value={value} onChange={event => onChange(event.currentTarget.value)}>
            {FUNCTION_OPTIONS.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
        </select>
    );
}

function Modifier({ factor, name, children }) {
    return (
        <label class="algebraic-checkbox-label">
            <input type="checkbox" checked={Boolean(factor[name])} onChange={event => {
                mutate(() => { factor[name] = event.currentTarget.checked; }, `algebraicChainingTerms.factor.${name}`, true);
            }} />
            <span class="custom-checkbox-visual" />{children}
        </label>
    );
}

function Factor({ term, factor, index }) {
    const setFunction = func => mutate(() => {
        if (index < term.factors.length) term.factors[index].func = func;
        else term.factors.push(createAlgebraicFactor(func));
        if (func === 'c') term.factors[index].chainedFunc = 'none';
        const stop = term.factors.findIndex(item => item.func === 'none');
        if (stop >= 0) term.factors = term.factors.slice(0, stop + 1);
    }, 'algebraicChainingTerms.factor.func', true);

    return (
        <div class="algebraic-factor-card">
            <div class="algebraic-factor-main-row">
                <span class="algebraic-factor-label">Factor {index + 1}</span>
                <FunctionSelect value={factor.func} onChange={setFunction} />
            </div>
            {factor.func !== 'none' && (
                <div class="algebraic-factor-details">
                    {factor.func !== 'c' && (
                        <div class="algebraic-factor-detail-row">
                            <span class="algebraic-factor-label">Chain f(g(z))</span>
                            <FunctionSelect value={factor.chainedFunc || 'none'} onChange={value => {
                                mutate(() => { factor.chainedFunc = value; }, 'algebraicChainingTerms.factor.chainedFunc', true);
                            }} />
                        </div>
                    )}
                    <AlgebraicRange label="Power " value={factor.power ?? 1} onValue={(value, commit) => {
                        mutate(() => { factor.power = value; }, 'algebraicChainingTerms.factor.power', commit);
                    }} />
                    <div class="algebraic-checkbox-row">
                        <Modifier factor={factor} name="reciprocal">1/f</Modifier>
                        <Modifier factor={factor} name="log">ln(f)</Modifier>
                        <Modifier factor={factor} name="exp">e^f</Modifier>
                    </div>
                </div>
            )}
        </div>
    );
}

function Term({ term, index, termCount }) {
    const factors = [...(term.factors || [])];
    if (factors.length < 5 && (!factors.length || factors.at(-1).func !== 'none')) {
        factors.push(createAlgebraicFactor('none'));
    }
    const coefficient = term.coeff || { re: 0, im: 0 };

    return (
        <div class="algebraic-term-card">
            <div class="algebraic-term-header">
                <div class="algebraic-term-title-wrapper">
                    <span class="algebraic-term-title">Term {index + 1}</span>
                    <div class="algebraic-term-formula">{termPreview(term)}</div>
                </div>
                {termCount > 1 && <button type="button" class="algebraic-term-remove-btn" onClick={() => {
                    mutate(terms => terms.splice(index, 1), 'algebraicChainingTerms', true);
                }}>✕ Remove</button>}
            </div>
            <div class="algebraic-coeff-grid">
                <AlgebraicRange label="Re coeff " value={coefficient.re} onValue={(value, commit) => {
                    mutate(() => {
                        term.coeff ||= { re: 0, im: 0 };
                        term.coeff.re = value;
                    }, 'algebraicChainingTerms.coeff.re', commit);
                }} />
                <AlgebraicRange label="Im coeff " value={coefficient.im} onValue={(value, commit) => {
                    mutate(() => {
                        term.coeff ||= { re: 0, im: 0 };
                        term.coeff.im = value;
                    }, 'algebraicChainingTerms.coeff.im', commit);
                }} />
            </div>
            <div class="algebraic-factors-container">
                <div class="algebraic-factors-title">Factors</div>
                {factors.map((factor, factorIndex) => (
                    <Factor key={factorIndex} term={term} factor={factor} index={factorIndex} />
                ))}
            </div>
        </div>
    );
}

export function AlgebraicTermEditor() {
    const terms = getStateSignal('algebraicChainingTerms').value;
    return terms.map((term, index) => <Term key={index} term={term} index={index} termCount={terms.length} />);
}
