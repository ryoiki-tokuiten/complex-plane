/** @jsxImportSource preact */
import { useEffect, useRef, useState } from 'preact/hooks';
import { getStateSignal, mutateState } from '../../store/state.js';
import { TAYLOR_CENTER_PRESET_GROUPS } from '../../constants/numerical.js';
import { requestRedrawAll } from '../../rendering/redraw-scheduler.js';
import { formatTaylorNumericValue } from '../../utils/dom-utils.js';

const samePoint = (a, b) => Math.abs(a.re - b.re) < 1e-9 && Math.abs(a.im - b.im) < 1e-9;

function setCenter(re, im) {
    mutateState('taylorSeriesCustomCenter', center => Object.assign(center, { re, im }));
    requestRedrawAll();
}

export function ComplexPointEditor() {
    const center = getStateSignal('taylorSeriesCustomCenter').value;
    const reInput = useRef(null);
    const imInput = useRef(null);
    const [reText, setReText] = useState(formatTaylorNumericValue(center.re));
    const [imText, setImText] = useState(formatTaylorNumericValue(center.im));

    useEffect(() => {
        if (document.activeElement !== reInput.current) setReText(formatTaylorNumericValue(center.re));
        if (document.activeElement !== imInput.current) setImText(formatTaylorNumericValue(center.im));
    }, [center.re, center.im]);

    const updatePart = (part, text) => {
        if (part === 're') setReText(text);
        else setImText(text);
        const value = Number.parseFloat(text);
        setCenter(
            part === 're' ? (Number.isNaN(value) ? 0 : value) : center.re,
            part === 'im' ? (Number.isNaN(value) ? 0 : value) : center.im
        );
    };

    return (
        <>
            <div class="taylor-series-preset-groups complex-point-presets">
                {TAYLOR_CENTER_PRESET_GROUPS.map(group => (
                    <div class="taylor-series-preset-group" key={group.label}>
                        <div class="taylor-series-preset-group-title">{group.label}</div>
                        <div class="taylor-series-preset-buttons">
                            {group.presets.map(preset => (
                                <button type="button"
                                    class={`taylor-series-preset-btn${samePoint(center, preset) ? ' toggle-active' : ''}`}
                                    data-re={preset.re} data-im={preset.im}
                                    onClick={() => setCenter(preset.re, preset.im)}>
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            <div class="taylor-series-input-row complex-point-inputs">
                <label class="taylor-series-input-field">
                    <span class="taylor-series-input-caption">Center Re(z0)</span>
                    <input ref={reInput} type="text" class="small-number-input taylor-series-text-input"
                        value={reText} onInput={event => updatePart('re', event.currentTarget.value)} />
                </label>
                <label class="taylor-series-input-field">
                    <span class="taylor-series-input-caption">Center Im(z0)</span>
                    <input ref={imInput} type="text" class="small-number-input taylor-series-text-input"
                        value={imText} onInput={event => updatePart('im', event.currentTarget.value)} />
                </label>
            </div>
        </>
    );
}
