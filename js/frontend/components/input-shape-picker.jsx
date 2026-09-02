/** @jsxImportSource preact */
import { useState } from 'preact/hooks';
import { CUSTOM_GRID_INPUT_SHAPE_SET } from '../../constants/grid-shapes.js';
import { useAppState } from '../state-hooks.js';
import { selectInputShape } from '../actions.js';

const PRIMARY_SHAPES = [
    ['empty_grid', 'Empty'], ['grid_cartesian', 'Grid (Cartesian)'],
    ['grid_logcartesian', 'Cartesian-Log'], ['grid_polar', 'Polar'],
    ['grid_logpolar', 'Polar-Log'], ['grid_dots', 'Dots'],
    ['arbitrary', 'Arbitrary Shape'], ['line', 'Lines'], ['circle', 'Circle'],
    ['media', 'Media'], ['navigate', 'Navigate']
];
const MORE_SHAPES = [
    ['grid_rectilinear', 'Rectilinear Grid'], ['grid_nonorthogonal', 'Non-orthogonal Grid'],
    ['grid_triangular', 'Triangular Grid'], ['grid_curvilinear', 'Curvilinear Grid'],
    ['grid_spiral', 'Spiral Grid'], ['grid_irregular', 'Irregular-spaced Grid']
];
const ALL_SHAPES = [...PRIMARY_SHAPES, ...MORE_SHAPES];

function ShapeButton({ shape, label, active, choose }) {
    return <button type="button" data-input-shape={shape} class={active ? 'active' : ''}
        aria-current={active ? 'true' : undefined} onClick={() => choose(shape)}>{label}</button>;
}

export function InputShapePicker() {
    const shape = useAppState('currentInputShape');
    const hidden = useAppState('laplaceModeEnabled');
    const [open, setOpen] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const choose = nextShape => {
        selectInputShape(nextShape);
        setOpen(false);
        setMoreOpen(false);
    };
    const label = ALL_SHAPES.find(([key]) => key === shape)?.[1] || 'Input Shape';

    return <div id="input_shape_picker" class={`input-shape-picker${open ? ' is-open' : ''}${hidden ? ' hidden' : ''}`}>
        <select id="input_shape_selector" hidden aria-hidden="true" tabIndex="-1" value={shape}
            onChange={event => choose(event.currentTarget.value)}>
            {ALL_SHAPES.map(([value, text]) => <option value={value}>{text}</option>)}
        </select>
        <button id="input_shape_picker_toggle" type="button" class="canvas-shape-select input-shape-picker-toggle"
            aria-haspopup="menu" aria-expanded={String(open)} onClick={() => setOpen(value => !value)}>
            <span data-input-shape-label>{label}</span>
        </button>
        <div id="input_shape_menu" class="input-shape-menu" role="menu">
            {PRIMARY_SHAPES.map(([value, text]) => <ShapeButton shape={value} label={text} active={shape === value} choose={choose} />)}
            <div class={`input-shape-more-item${moreOpen ? ' is-open' : ''}`}
                onMouseEnter={() => setMoreOpen(true)} onMouseLeave={() => setMoreOpen(false)}>
                <button type="button" class={`input-shape-more-toggle${CUSTOM_GRID_INPUT_SHAPE_SET.has(shape) ? ' active' : ''}`}>More<span aria-hidden="true">‹</span></button>
                <div id="input_shape_more_menu" class="input-shape-more-menu" role="menu">
                    {MORE_SHAPES.map(([value, text]) => <ShapeButton shape={value} label={text} active={shape === value} choose={choose} />)}
                </div>
            </div>
        </div>
    </div>;
}
