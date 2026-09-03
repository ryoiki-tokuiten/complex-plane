/** @jsxImportSource preact */
import { useEffect, useRef, useState } from 'preact/hooks';
import { state, mutateState } from '../../store/state.js';
import { useAppState } from '../state-hooks.js';
import { TAYLOR_CENTER_PRESETS } from '../../constants/numerical.js';
import { requestDomainRedraw, requestUiRedraw } from '../../rendering/redraw-scheduler.js';
import { formatTaylorNumericValue } from '../../utils/dom-utils.js';

const samePoint = (a, b) => Math.abs(a.re - b.re) < 1e-9 && Math.abs(a.im - b.im) < 1e-9;

export function ComplexParameterEditor({ stateKey, label, pickLabel }) {
    const point = useAppState(stateKey);
    const isPicking = useAppState('canvasClickPickerTarget') === stateKey;
    const reInput = useRef(null);
    const imInput = useRef(null);
    const [reText, setReText] = useState(formatTaylorNumericValue(point.re));
    const [imText, setImText] = useState(formatTaylorNumericValue(point.im));

    useEffect(() => {
        if (document.activeElement !== reInput.current) setReText(formatTaylorNumericValue(point.re));
        if (document.activeElement !== imInput.current) setImText(formatTaylorNumericValue(point.im));
    }, [point.re, point.im]);

    const setPoint = (re, im) => {
        mutateState(stateKey, value => Object.assign(value, { re, im }));
        requestDomainRedraw();
    };
    const update = (part, text) => {
        part === 're' ? setReText(text) : setImText(text);
        const parsed = Number.parseFloat(text);
        setPoint(part === 're' ? (Number.isNaN(parsed) ? 0 : parsed) : point.re,
            part === 'im' ? (Number.isNaN(parsed) ? 0 : parsed) : point.im);
    };

    return <>
        <div class="taylor-series-preset-groups">
            <div class="taylor-series-preset-buttons">
                {TAYLOR_CENTER_PRESETS.map(preset =>
                    <button type="button" key={preset.label} class={`taylor-series-preset-btn${samePoint(point, preset) ? ' toggle-active' : ''}`}
                        onClick={() => setPoint(preset.re, preset.im)}>{preset.label}</button>)}
            </div>
        </div>
        <div class="taylor-series-input-row">
            <label class="taylor-series-input-field"><span class="taylor-series-input-caption">Re({label})</span>
                <input ref={reInput} type="text" class="small-number-input taylor-series-text-input" value={reText}
                    onInput={event => update('re', event.currentTarget.value)} /></label>
            <label class="taylor-series-input-field"><span class="taylor-series-input-caption">Im({label})</span>
                <input ref={imInput} type="text" class="small-number-input taylor-series-text-input" value={imText}
                    onInput={event => update('im', event.currentTarget.value)} /></label>
        </div>
        {pickLabel && <button type="button" class={`taylor-pick-center-btn${isPicking ? ' is-picking' : ''}`} style={{ marginTop: '0.45rem' }}
            onClick={() => { state.canvasClickPickerTarget = isPicking ? null : stateKey; requestUiRedraw(); }}>
            {isPicking ? 'Click Canvas to Pin…' : pickLabel}
        </button>}
    </>;
}
