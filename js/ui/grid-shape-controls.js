import { state } from '../store/state.js';
import {
    CUSTOM_GRID_INPUT_SHAPE_SET,
    GRID_SHAPE_DEFAULTS,
    GRID_SHAPE_PARAMETERS,
    formatGridValue
} from '../constants/grid-shapes.js';

const CORNER_OCCUPYING_PANEL_IDS = Object.freeze([
    'z_plane_shape_controls_overlay',
    'radial_discrete_steps_options_div',
    'vector_flow_canvas_overlay',
    'z_plane_transformation_overlay',
    'domain_coloring_key'
]);

function element(id) {
    return typeof document === 'undefined' ? null : document.getElementById(id);
}

function getGridParameters(shape) {
    const definition = GRID_SHAPE_PARAMETERS[shape];
    return state.gridParameters[definition.stateKey];
}

function rectanglesOverlap(first, second) {
    return first.left < second.right && first.right > second.left &&
        first.top < second.bottom && first.bottom > second.top;
}

export function positionGridShapeControls() {
    const panel = element('grid_shape_controls_overlay');
    const wrapper = element('z_plane_canvas_wrapper');
    if (!panel || !wrapper || panel.classList.contains('hidden')) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const inset = 8;
    const occupied = CORNER_OCCUPYING_PANEL_IDS
        .map(element)
        .filter(node => node && wrapper.contains(node) && !node.classList.contains('hidden'))
        .map(node => node.getBoundingClientRect())
        .filter(rect => rect.width > 0 && rect.height > 0);
    const candidates = [
        ['bottom-right', wrapperRect.right - panelRect.width - inset, wrapperRect.bottom - panelRect.height - inset],
        ['bottom-left', wrapperRect.left + inset, wrapperRect.bottom - panelRect.height - inset],
        ['top-left', wrapperRect.left + inset, wrapperRect.top + inset]
    ].map(([name, left, top]) => ({
        name,
        left,
        top,
        right: left + panelRect.width,
        bottom: top + panelRect.height
    }));
    panel.dataset.position = candidates.find(candidate =>
        occupied.every(other => !rectanglesOverlap(candidate, other))
    )?.name || 'bottom-right';
}

export function bindGridShapePicker() {
    const picker = element('input_shape_picker');
    const toggle = element('input_shape_picker_toggle');
    const menu = element('input_shape_menu');
    const moreItem = menu?.querySelector('.input-shape-more-item');
    const moreMenu = element('input_shape_more_menu');
    if (!picker || !toggle || !menu) return;

    let moreCloseTimer = null;
    const openMore = () => {
        if (moreCloseTimer) clearTimeout(moreCloseTimer);
        moreCloseTimer = null;
        moreItem?.classList.add('is-open');
    };
    const closeMore = () => {
        if (moreCloseTimer) clearTimeout(moreCloseTimer);
        moreCloseTimer = null;
        moreItem?.classList.remove('is-open');
    };
    const scheduleMoreClose = () => {
        if (moreCloseTimer) clearTimeout(moreCloseTimer);
        moreCloseTimer = setTimeout(closeMore, 350);
    };
    const close = () => {
        closeMore();
        picker.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
    };
    toggle.addEventListener('click', () => {
        const open = picker.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', String(open));
    });
    menu.querySelectorAll('[data-input-shape]').forEach(button => {
        button.addEventListener('click', () => {
            const selector = element('input_shape_selector');
            if (!selector) return;
            selector.value = button.dataset.inputShape;
            selector.dispatchEvent(new Event('change', { bubbles: true }));
            close();
            button.blur();
        });
    });
    moreItem?.addEventListener('mouseenter', openMore);
    moreItem?.addEventListener('mouseleave', scheduleMoreClose);
    moreMenu?.addEventListener('mouseenter', openMore);
    moreMenu?.addEventListener('mouseleave', scheduleMoreClose);
    document.addEventListener('pointerdown', event => {
        if (!picker.contains(event.target)) close();
    }, { passive: true });
}

function syncGridShapePicker() {
    const picker = element('input_shape_picker');
    const toggle = element('input_shape_picker_toggle');
    const menu = element('input_shape_menu');
    const selector = element('input_shape_selector');
    if (!picker || !toggle || !menu || !selector) return;
    picker.classList.toggle('hidden', state.laplaceModeEnabled);
    if (state.laplaceModeEnabled) picker.classList.remove('is-open');

    const selectedOption = [...selector.options].find(option => option.value === state.currentInputShape);
    const label = toggle.querySelector('[data-input-shape-label]');
    if (label && selectedOption) label.textContent = selectedOption.textContent;
    menu.querySelectorAll('[data-input-shape]').forEach(button => {
        const active = button.dataset.inputShape === state.currentInputShape;
        button.classList.toggle('active', active);
        if (active) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
    });
    menu.querySelector('.input-shape-more-toggle')?.classList.toggle(
        'active', CUSTOM_GRID_INPUT_SHAPE_SET.has(state.currentInputShape)
    );
}

export function initializeGridShapeControlsFromDOM() {
    if (typeof document === 'undefined') return;
    const nextParameters = Object.fromEntries(
        Object.entries(GRID_SHAPE_DEFAULTS).map(([shape, parameters]) => [shape, { ...parameters }])
    );

    Object.values(GRID_SHAPE_PARAMETERS).forEach(gridDefinition => {
        const parameters = nextParameters[gridDefinition.stateKey];
        gridDefinition.controls.forEach(controlDefinition => {
            const slider = element(controlDefinition.controlId);
            const value = Number(slider?.value);
            if (Number.isFinite(value)) parameters[controlDefinition.key] = value;
        });
    });
    state.gridParameters = nextParameters;
}

export function setGridShapeParameter(shape, key, value) {
    const definition = GRID_SHAPE_PARAMETERS[shape];
    if (!definition || !Number.isFinite(value)) throw new Error(`Invalid ${shape}.${key} grid parameter.`);
    state.gridParameters = {
        ...state.gridParameters,
        [definition.stateKey]: {
            ...state.gridParameters[definition.stateKey],
            [key]: value
        }
    };
}

export function syncGridShapeControls() {
    const panel = element('grid_shape_controls_overlay');
    if (!panel) return;

    syncGridShapePicker();
    const shape = state.currentInputShape;
    const active = !state.laplaceModeEnabled && CUSTOM_GRID_INPUT_SHAPE_SET.has(shape);
    const activeDefinition = GRID_SHAPE_PARAMETERS[shape];
    panel.classList.toggle('hidden', !active);
    panel.setAttribute('aria-hidden', String(!active));
    if (!activeDefinition) return;

    panel.querySelectorAll('[data-grid-shape-group]').forEach(group => {
        group.classList.toggle('hidden', group.dataset.gridShapeGroup !== shape);
    });
    const parameters = getGridParameters(shape);
    panel.querySelector('[data-grid-shape-title]')?.replaceChildren(
        document.createTextNode(activeDefinition.label)
    );
    activeDefinition.controls.forEach(controlDefinition => {
        const slider = element(controlDefinition.controlId);
        const display = element(controlDefinition.valueId);
        const value = Number(parameters[controlDefinition.key]);
        if (!slider || !Number.isFinite(value)) return;
        slider.value = String(value);
        slider.setAttribute('aria-valuetext', formatGridValue(value, controlDefinition));
        if (display) display.textContent = formatGridValue(value, controlDefinition);
    });

    positionGridShapeControls();
}
