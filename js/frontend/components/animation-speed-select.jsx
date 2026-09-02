/** @jsxImportSource preact */
import { Ui } from '../ui-element.jsx';

const SPEEDS = ['0.01', '0.1', '0.5', '1', '2'];

export function AnimationSpeedSelect({ model, id, tooltip }) {
    return <Ui model={model} as="select" id={id} class="animation-speed-selector" data-tooltip={tooltip}>
        {SPEEDS.map(speed => <option value={speed} selected={speed === '1'}>{speed}x</option>)}
    </Ui>;
}
