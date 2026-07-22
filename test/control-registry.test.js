import test from 'node:test';
import assert from 'node:assert/strict';

import { controlKeyFromId, registerControls } from '../js/ui/control-registry.js';

test('control ids map consistently across underscore and kebab naming', () => {
    assert.equal(controlKeyFromId('grid_density_slider'), 'gridDensitySlider');
    assert.equal(controlKeyFromId('function-controls-panel'), 'functionControlsPanel');
    assert.equal(controlKeyFromId('mobiusA_re_slider'), 'mobiusAReSlider');
});

test('control registration indexes the document and preserves compatibility aliases', () => {
    const elements = [
        { id: 'grid_density_slider' },
        { id: 'z_plane_column' },
        { id: 'graph_3d_container' }
    ];
    const byId = new Map(elements.map(element => [element.id, element]));
    const root = {
        querySelectorAll: selector => selector === '[id]' ? elements : [],
        getElementById: id => byId.get(id) || null
    };

    const controls = registerControls(root, {});
    assert.equal(controls.gridDensitySlider, elements[0]);
    assert.equal(controls.zCanvasCard, elements[1]);
    assert.equal(controls.graph3DContainer, elements[2]);
});
