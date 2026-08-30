/** @jsxImportSource preact */
import { GRID_SHAPE_PARAMETERS, formatGridValue } from '../../constants/grid-shapes.js';

export function GridShapeControls() {
    return Object.entries(GRID_SHAPE_PARAMETERS).map(([shape, { controls }]) => (
        <div id={`${shape}_controls`} class="canvas-grid-controls-group grid-tuning-group hidden"
            data-grid-shape-group={shape} key={shape}>
            {controls.map(definition => (
                <div class="control-group" key={definition.key}>
                    <label for={definition.controlId}>{definition.label}:
                        <output id={definition.valueId}>{formatGridValue(definition.value, definition)}</output>
                    </label>
                    <div class="slider-container">
                        <input type="range" id={definition.controlId} min={definition.min} max={definition.max}
                            step={definition.step} value={definition.value} data-tooltip={definition.tooltip} />
                    </div>
                </div>
            ))}
        </div>
    ));
}
