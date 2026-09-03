let tooltip = { visible: false, content: '', x: 0, y: 0, isStatic: false, target: null };
const subscribers = new Set();

function publish(patch) {
    tooltip = { ...tooltip, ...patch };
    subscribers.forEach(subscriber => subscriber(tooltip));
}

export function subscribeTooltip(subscriber) {
    subscribers.add(subscriber);
    subscriber(tooltip);
    return () => subscribers.delete(subscriber);
}

export function showDynamicTooltip(content, x, y, isStatic = false, target = null) {
    publish({ visible: true, content: String(content), x, y, isStatic, target });
}

export function moveStaticTooltip(x, y, target) {
    if (tooltip.visible && tooltip.isStatic && tooltip.target === target) publish({ x, y });
}

export function hideDynamicTooltip(target = null) {
    if (target && tooltip.target !== target) return;
    publish({ visible: false, isStatic: false, target: null });
}
