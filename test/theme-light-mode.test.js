import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyTheme,
    getCanvasAxesColor,
    getCanvasBackgroundColor,
    getCanvasGridColors,
    getCanvasTextColor,
    themes,
    themeVariables
} from '../js/frontend/theme.js';
import { state } from '../js/store/state.js';

const lightThemes = [
    ['snow_storm', '#E5E9F0', '#ECEFF4', '#2E3440', '#5E81AC', '#88C0D0',
        'rgba(46, 52, 64, 0.55)', 'rgba(46, 52, 64, 0.05)', 'rgba(46, 52, 64, 0.13)'],
    ['dollar', '#e4e4d4', '#edf0e4', '#555a56', '#6b886b', '#424643',
        'rgba(66, 70, 67, 0.55)', 'rgba(66, 70, 67, 0.06)', 'rgba(66, 70, 67, 0.15)']
];

test('light theme state, canvas colors, and CSS variables share one palette', () => {
    const previous = [state.themeId, state.gridColor1, state.gridColor2];
    try {
        for (const [id, bg, panel, text, primary, secondary, axes, minor, major] of lightThemes) {
            assert.equal(themes.find(theme => theme.id === id)?.isLight, true);
            applyTheme(id);
            assert.deepEqual([state.themeId, state.gridColor1, state.gridColor2], [id, primary, secondary]);
            assert.deepEqual(
                [getCanvasBackgroundColor(), getCanvasTextColor(), getCanvasAxesColor(), ...Object.values(getCanvasGridColors())],
                [id === 'snow_storm' ? panel : bg, id === 'snow_storm' ? text : secondary, axes, minor, major]
            );
            const variables = themeVariables(id);
            assert.deepEqual(
                [variables['--bg-color'], variables['--card-bg-color'], variables['--text-color']],
                [bg, panel, text]
            );
        }
    } finally {
        [state.themeId, state.gridColor1, state.gridColor2] = previous;
    }
});

test('dark themes use the shared canvas defaults', () => {
    applyTheme('terax');
    assert.deepEqual(
        [getCanvasBackgroundColor(), getCanvasTextColor(), getCanvasAxesColor(), ...Object.values(getCanvasGridColors())],
        ['#0a0c10', '#d0d7e2', 'rgba(130, 130, 180, 0.8)', 'rgba(128, 137, 255, 0.04)', 'rgba(128, 137, 255, 0.12)']
    );
});
