import { signal } from '@preact/signals';
import { requestDomainRedraw } from '../rendering/redraw-scheduler.js';

export const animations = signal({});
const speeds = signal({});

export const animationSpeed = id => speeds.value[id] ?? 1;

export function setAnimationSpeed(id, value) {
    speeds.value = { ...speeds.peek(), [id]: Number(value) };
}

export function stopAnimations(prefix = '') {
    const next = { ...animations.peek() };
    for (const [id, animation] of Object.entries(next)) {
        if (!id.startsWith(prefix)) continue;
        animation.animating = false;
        cancelAnimationFrame(animation.frameId);
        delete next[id];
    }
    animations.value = next;
}

export function toggleAnimation({ id, value, min, max, step, speedId, update }) {
    const current = animations.peek()[id];
    if (current?.animating) {
        current.animating = false;
        cancelAnimationFrame(current.frameId);
        animations.value = { ...animations.peek() };
        return;
    }

    const animation = {
        animating: true,
        direction: value >= max ? -1 : value <= min ? 1 : current?.direction || 1,
        value: Number(value),
        frameId: null
    };
    animations.value = { ...animations.peek(), [id]: animation };
    const precision = String(step).split('.')[1]?.length || 0;

    const frame = () => {
        if (!animation.animating) return;
        animation.value += step * animation.direction * (speeds.peek()[speedId] ?? 1);
        if (animation.value >= max) {
            animation.value = max;
            animation.direction = -1;
        } else if (animation.value <= min) {
            animation.value = min;
            animation.direction = 1;
        }
        update(Number(animation.value.toFixed(precision)));
        requestDomainRedraw();
        animation.frameId = requestAnimationFrame(frame);
    };
    frame();
}
