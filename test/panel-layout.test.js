import test from 'node:test';
import assert from 'node:assert/strict';
import {
    computeLaplaceModeLayout,
    computeNormalModeLayout,
    computeRealPlotsLayout
} from '../js/ui/panel-layout-manager.js';
import { state } from '../js/store/state.js';

const value = (panel, key) => Number.parseInt(panel[key], 10);

test('normal layout uses two equal tracks and switches to vertical stacking', () => {
    state.verticalLayoutEnabled = false;
    const horizontal = computeNormalModeLayout(1200, 800);
    assert.equal(value(horizontal.z_plane_column, 'left'), 0);
    assert.equal(value(horizontal.w_plane_column, 'left'), value(horizontal.z_plane_column, 'width') + 24);
    assert.ok(value(horizontal.w_plane_column, 'left') + value(horizontal.w_plane_column, 'width') <= 1200);

    state.verticalLayoutEnabled = true;
    const vertical = computeNormalModeLayout(900, 1000);
    assert.equal(value(vertical.w_plane_column, 'left'), 0);
    assert.equal(value(vertical.w_plane_column, 'top'), value(vertical.z_plane_column, 'height') + 24);
    assert.equal(value(vertical.z_plane_column, 'width'), 900);
    state.verticalLayoutEnabled = false;
});

test('laplace layout keeps every transform surface in a distinct region', () => {
    const panels = Object.values(computeLaplaceModeLayout(1400, 900));
    assert.equal(panels.length, 6);
    for (let index = 0; index < panels.length; index++) {
        const a = panels[index];
        for (let other = index + 1; other < panels.length; other++) {
            const b = panels[other];
            const separated = value(a, 'left') + value(a, 'width') <= value(b, 'left') ||
                value(b, 'left') + value(b, 'width') <= value(a, 'left') ||
                value(a, 'top') + value(a, 'height') <= value(b, 'top') ||
                value(b, 'top') + value(b, 'height') <= value(a, 'top');
            assert.equal(separated, true);
        }
    }
});

test('real plot fills the workspace alone and splits evenly with a contour', () => {
    state.show2DContourPlot = false;
    assert.deepEqual(computeRealPlotsLayout(1400, 900).real_plots_column, {
        left: '0px', top: '0px', width: '1400px', height: '900px'
    });

    state.realPlotsEnabled = true;
    state.show2DContourPlot = true;
    const split = computeRealPlotsLayout(1400, 900);
    assert.equal(value(split.contour_2d_column, 'left'), value(split.real_plots_column, 'width') + 24);
    state.show2DContourPlot = false;
    state.realPlotsEnabled = false;
});
