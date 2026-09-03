/** @jsxImportSource preact */
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
    hideDynamicTooltip,
    moveStaticTooltip,
    showDynamicTooltip,
    subscribeTooltip
} from '../tooltip-state.js';

function toPlainText(markup) {
    const parsed = new DOMParser().parseFromString(String(markup).replace(/<br\s*\/?>/gi, '\n'), 'text/html');
    return parsed.body.textContent || '';
}

export function Tooltip() {
    const [tooltip, setTooltip] = useState({ visible: false, content: '', x: 0, y: 0 });
    useEffect(() => subscribeTooltip(setTooltip), []);
    useEffect(() => {
        const over = event => {
            const target = event.target.closest?.('[data-tooltip]');
            const content = target?.getAttribute('data-tooltip');
            if (content) showDynamicTooltip(content, event.clientX, event.clientY, true, target);
        };
        const move = event => {
            const target = event.target.closest?.('[data-tooltip]');
            if (target) moveStaticTooltip(event.clientX, event.clientY, target);
        };
        const out = event => {
            const target = event.target.closest?.('[data-tooltip]');
            if (target && !target.contains(event.relatedTarget)) hideDynamicTooltip(target);
        };
        document.addEventListener('pointerover', over);
        document.addEventListener('pointermove', move, { passive: true });
        document.addEventListener('pointerout', out);
        return () => {
            document.removeEventListener('pointerover', over);
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerout', out);
        };
    }, []);

    const content = useMemo(() => toPlainText(tooltip.content), [tooltip.content]);
    const width = 260;
    const height = 120;
    const left = Math.max(0, Math.min(tooltip.x + 15, window.innerWidth - width));
    const top = Math.max(0, Math.min(tooltip.y + 15, window.innerHeight - height));
    return <div id="tooltip" style={{ display: tooltip.visible ? 'block' : 'none', left, top }}>{content}</div>;
}
