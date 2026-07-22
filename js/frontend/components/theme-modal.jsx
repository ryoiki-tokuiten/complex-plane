/** @jsxImportSource preact */
import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { context, getStateSignal, state } from '../../store/state.js';
import { requestRedrawAll } from '../../rendering/redraw-scheduler.js';
import { ThemeOptions } from './theme-and-palette-options.jsx';

const isOpen = signal(false);

export const openThemeModal = () => { isOpen.value = true; };

function refreshLayout() {
    window.dispatchEvent(new Event('resize'));
    const timers = [50, 150, 350].map(delay =>
        setTimeout(() => window.dispatchEvent(new Event('resize')), delay)
    );
    return () => timers.forEach(clearTimeout);
}

function GridColor({ index, stateKey }) {
    const color = getStateSignal(stateKey).value;
    return (
        <div class="circle-color-picker-wrapper">
            <div class="circle-color-picker" id={`grid_color_${index}_picker_wrapper`} style={{ backgroundColor: color }}>
                <input type="color" id={`grid_color_${index}_input`} value={color} onInput={event => {
                    state[stateKey] = event.currentTarget.value;
                    context.domainColoringDirty = true;
                    requestRedrawAll();
                }} />
            </div>
            <span class="circle-color-picker-label">Grid Line {index}</span>
        </div>
    );
}

export function ThemeModal() {
    const vertical = getStateSignal('verticalLayoutEnabled').value;
    const layoutApplied = useRef(false);

    useEffect(() => {
        if (vertical === undefined) {
            state.verticalLayoutEnabled = localStorage.getItem('complex_verticalLayoutEnabled') === 'true';
            return;
        }
        document.body.classList.toggle('vertical-layout', vertical);
        localStorage.setItem('complex_verticalLayoutEnabled', String(vertical));
        const needsRefresh = vertical || layoutApplied.current;
        layoutApplied.current = true;
        return needsRefresh ? refreshLayout() : undefined;
    }, [vertical]);

    const close = () => { isOpen.value = false; };
    return (
        <div id="theme_modal" class={isOpen.value ? '' : 'hidden'}>
            <div class="theme-modal-backdrop" id="theme_modal_backdrop" onClick={close} />
            <div class="theme-modal-content">
                <button id="close_theme_modal_btn" class="theme-modal-close-btn" aria-label="Close theme modal"
                    onClick={close}><i data-lucide="x" /></button>
                <div class="theme-modal-header">
                    <h2>Themes</h2>
                    <p>Select application theme, accent colors, and styling.</p>
                </div>
                <div class="theme-list-container custom-scroll" id="theme_list_container"><ThemeOptions /></div>
                <div class="theme-modal-section">
                    <h3>Layout Settings</h3>
                    <div class="control-group theme-modal-control-group">
                        <label for="enable_vertical_layout_cb" class="control-label tooltip-label slider-label"
                            data-tooltip="Switch to vertical layout: panels on left, planes on right">
                            <input type="checkbox" id="enable_vertical_layout_cb" class="control-checkbox"
                                checked={Boolean(vertical)} onChange={event => {
                                    state.verticalLayoutEnabled = event.currentTarget.checked;
                                }} />
                            <span class="custom-checkbox-visual" />
                            Enable Vertical Layout
                        </label>
                    </div>
                </div>
                <div class="theme-modal-section">
                    <h3>Custom Grid Colors</h3>
                    <div class="grid-color-pickers-container">
                        <GridColor index="1" stateKey="gridColor1" />
                        <GridColor index="2" stateKey="gridColor2" />
                    </div>
                </div>
            </div>
        </div>
    );
}
