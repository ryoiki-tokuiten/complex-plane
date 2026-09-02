/** @jsxImportSource preact */
import { GRID_SHAPE_PARAMETERS, formatGridValue } from '../../constants/grid-shapes.js';
import { mutateState } from '../../store/state.js';
import { requestDomainRedraw } from '../../rendering/redraw-scheduler.js';
import { useAppState } from '../state-hooks.js';

export function GridShapeControls() {
    const activeShape = useAppState('currentInputShape');
    const parameters = useAppState('gridParameters');
    return Object.entries(GRID_SHAPE_PARAMETERS).map(([shape, { controls, stateKey }]) => (
        <div id={`${shape}_controls`} class={`canvas-grid-controls-group grid-tuning-group${activeShape === shape ? '' : ' hidden'}`}
            data-grid-shape-group={shape} key={shape}>
            {controls.map(definition => {
                const value = parameters[stateKey][definition.key];
                return (
                <div class="control-group" key={definition.key}>
                    <label for={definition.controlId}>{definition.label}:
                        <output id={definition.valueId}>{formatGridValue(value, definition)}</output>
                    </label>
                    <div class="slider-container">
                        <input type="range" id={definition.controlId} min={definition.min} max={definition.max}
                            step={definition.step} value={value} data-tooltip={definition.tooltip}
                            onInput={event => {
                                const next = Number(event.currentTarget.value);
                                mutateState('gridParameters', values => { values[stateKey][definition.key] = next; }, `gridParameters.${stateKey}.${definition.key}`);
                                requestDomainRedraw();
                            }} />
                    </div>
                </div>
                );
            })}
        </div>
    ));
}
