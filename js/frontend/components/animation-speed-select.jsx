/** @jsxImportSource preact */
import { Ui } from '../ui-element.jsx';
import { animationSpeed, setAnimationSpeed } from '../animation-controller.js';

const SPEEDS = ['0.01', '0.1', '0.5', '1', '2'];

export function AnimationSpeedSelect({ id, tooltip }) {
    return <Ui as="select" id={id} class="animation-speed-selector" data-tooltip={tooltip}
        value={String(animationSpeed(id))} onChange={event => setAnimationSpeed(id, event.currentTarget.value)}>
        {SPEEDS.map(speed => <option value={speed}>{speed}x</option>)}
    </Ui>;
}
