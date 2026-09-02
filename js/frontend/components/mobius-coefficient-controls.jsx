/** @jsxImportSource preact */
import { Ui } from '../ui-element.jsx';
import { AnimationSpeedSelect } from './animation-speed-select.jsx';

const COEFFICIENTS = [
    ['A', 'a', 1, 0],
    ['B', 'b', 0, 0],
    ['C', 'c', 0, 0],
    ['D', 'd', 1, 0]
];

function CoefficientPart({ model, keyName, symbol, part, initial }) {
    const label = part === 're' ? 'Re' : 'Im';
    const id = `mobius${keyName}_${part}`;
    return <div class="control-group">
        <label for={`${id}_slider`}>
            {label}({symbol}): <Ui model={model} as="output" id={`${id}_value_display`}>{initial.toFixed(1)}</Ui>
        </label>
        <div class="slider-container">
            <Ui model={model} as="input" type="range" id={`${id}_slider`} min="-5" max="5" step="0.1"
                value={String(initial)} data-tooltip={`${part === 're' ? 'Real' : 'Imaginary'} part of coefficient '${symbol}' for Möbius transformation`} />
            <Ui model={model} as="button" id={`play_${id}_btn`} data-tooltip={`Animate ${label}(${symbol}) for Möbius`}>Play</Ui>
            <AnimationSpeedSelect model={model} id={`speed_${id}_selector`}
                tooltip={`Select animation speed for ${label}(${symbol}) of Möbius`} />
        </div>
    </div>;
}

export function MobiusCoefficientControls({ model }) {
    return COEFFICIENTS.map(([keyName, symbol, real, imaginary]) =>
        <div class="mobius-coeff-row" key={keyName}>
            <CoefficientPart model={model} keyName={keyName} symbol={symbol} part="re" initial={real} />
            <CoefficientPart model={model} keyName={keyName} symbol={symbol} part="im" initial={imaginary} />
        </div>
    );
}
