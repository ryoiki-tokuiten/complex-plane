/** @jsxImportSource preact */
import { getRiemannSurfaceHudSignal } from '../../rendering/riemann-surface-hud-state.js';

export function RiemannSurfaceHud({ planeIndex = 0 }) {
    const hud = getRiemannSurfaceHudSignal(planeIndex).value;
    return <div class={`riemann-surface-hud${hud.visible ? '' : ' hidden'}`}>{hud.text}</div>;
}
