/** @jsxImportSource preact */
import { Ui } from '../ui-element.jsx';

export function RangeControl({
    model,
    id,
    label,
    outputId,
    outputValue,
    groupClass = '',
    labelClass = '',
    ...inputProps
}) {
    return <div class={`control-group range-control${groupClass ? ` ${groupClass}` : ''}`}>
        <label for={id} class={labelClass || undefined}>
            {label}
            {outputId && <Ui model={model} as="output" id={outputId}>{outputValue}</Ui>}
        </label>
        <div class="slider-container">
            <Ui model={model} as="input" type="range" id={id} {...inputProps} />
        </div>
    </div>;
}
