import { signal } from '@preact/signals';

const hudByPlane = new Map();

export function getRiemannSurfaceHudSignal(planeIndex) {
    if (!hudByPlane.has(planeIndex)) hudByPlane.set(planeIndex, signal({ visible: false, text: '' }));
    return hudByPlane.get(planeIndex);
}

export function publishRiemannSurfaceHud(planeIndex, patch) {
    const hud = getRiemannSurfaceHudSignal(planeIndex);
    hud.value = { ...hud.peek(), ...patch };
}
