/** @jsxImportSource preact */
import { useEffect, useRef, useState } from 'preact/hooks';
import { getStateSignal, mutateState } from '../../store/state.js';
import { TAYLOR_CENTER_PRESET_GROUPS } from '../../constants/numerical.js';
import { requestDomainRedraw } from '../../rendering/redraw-scheduler.js';
import { formatTaylorNumericValue } from '../../utils/dom-utils.js';

const samePoint = (a, b) => Math.abs(a.re - b.re) < 1e-9 && Math.abs(a.im - b.im) < 1e-9;

export function ComplexParameterEditor({ stateKey, label }) {
    const point = getStateSignal(stateKey).value;
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
            {TAYLOR_CENTER_PRESET_GROUPS.map(group => <div class="taylor-series-preset-group" key={group.label}>
                <div class="taylor-series-preset-group-title">{group.label}</div>
                <div class="taylor-series-preset-buttons">{group.presets.map(preset =>
                    <button type="button" class={`taylor-series-preset-btn${samePoint(point, preset) ? ' toggle-active' : ''}`}
                        onClick={() => setPoint(preset.re, preset.im)}>{preset.label}</button>)}</div>
            </div>)}
        </div>
        <div class="taylor-series-input-row">
            <label class="taylor-series-input-field"><span class="taylor-series-input-caption">Re({label})</span>
                <input ref={reInput} type="text" class="small-number-input taylor-series-text-input" value={reText}
                    onInput={event => update('re', event.currentTarget.value)} /></label>
            <label class="taylor-series-input-field"><span class="taylor-series-input-caption">Im({label})</span>
                <input ref={imInput} type="text" class="small-number-input taylor-series-text-input" value={imText}
                    onInput={event => update('im', event.currentTarget.value)} /></label>
        </div>
    </>;
}
