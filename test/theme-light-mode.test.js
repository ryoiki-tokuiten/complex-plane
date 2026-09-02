import test from 'node:test';
import assert from 'node:assert/strict';
import {
    themes,
    applyTheme,
    getActiveTheme,
    getCanvasBackgroundColor,
    getCanvasTextColor,
    getCanvasAxesColor,
    getCanvasGridColors,
    themeVariables,
    loadThemePreferences,
    persistThemePreferences
} from '../js/frontend/theme.js';
import { state } from '../js/store/state.js';

test('themes registry contains snow_storm and dollar light themes with required properties', () => {
    const snow = themes.find(t => t.id === 'snow_storm');
    assert.ok(snow, 'Snow Storm theme must be present in themes');
    assert.equal(snow.name, 'Snow Storm');
    assert.equal(snow.isLight, true);
    assert.equal(snow.colors.bg, '#E5E9F0');
    assert.equal(snow.colors.panel, '#ECEFF4');
    assert.equal(snow.colors.border, '#D8DEE9');
    assert.equal(snow.colors.text, '#2E3440');
    assert.equal(snow.colors.gridPri, '#5E81AC');
    assert.equal(snow.colors.gridSec, '#88C0D0');
    assert.equal(snow.colors.canvasBg, '#ECEFF4');
    assert.equal(snow.colors.canvasText, '#2E3440');

    const dollar = themes.find(t => t.id === 'dollar');
    assert.ok(dollar, 'Dollar theme must be present in themes');
    assert.equal(dollar.name, 'Dollar');
    assert.equal(dollar.isLight, true);
    assert.equal(dollar.colors.bg, '#e4e4d4');
    assert.equal(dollar.colors.border, '#cbd0bf');
    assert.equal(dollar.colors.text, '#555a56');
    assert.equal(dollar.colors.gridPri, '#6b886b');
    assert.equal(dollar.colors.gridSec, '#424643');
    assert.equal(dollar.colors.canvasBg, '#e4e4d4');
    assert.equal(dollar.colors.canvasText, '#424643');
});

test('applyTheme switches to light themes and updates state grid colors automatically', () => {
    const originalThemeId = state.themeId;
    const originalGridColor1 = state.gridColor1;
    const originalGridColor2 = state.gridColor2;

    try {
        // Switch to Snow Storm
        applyTheme('snow_storm');
        assert.equal(state.themeId, 'snow_storm');
        assert.equal(state.gridColor1, '#5E81AC');
        assert.equal(state.gridColor2, '#88C0D0');
        assert.equal(getCanvasBackgroundColor(), '#ECEFF4');
        assert.equal(getCanvasTextColor(), '#2E3440');
        assert.equal(getCanvasAxesColor(), 'rgba(46, 52, 64, 0.55)');
        const snowGrid = getCanvasGridColors();
        assert.equal(snowGrid.minorColor, 'rgba(46, 52, 64, 0.05)');
        assert.equal(snowGrid.majorColor, 'rgba(46, 52, 64, 0.13)');

        // Switch to Dollar
        applyTheme('dollar');
        assert.equal(state.themeId, 'dollar');
        assert.equal(state.gridColor1, '#6b886b');
        assert.equal(state.gridColor2, '#424643');
        assert.equal(getCanvasBackgroundColor(), '#e4e4d4');
        assert.equal(getCanvasTextColor(), '#424643');
        assert.equal(getCanvasAxesColor(), 'rgba(66, 70, 67, 0.55)');
        const dollarGrid = getCanvasGridColors();
        assert.equal(dollarGrid.minorColor, 'rgba(66, 70, 67, 0.06)');
        assert.equal(dollarGrid.majorColor, 'rgba(66, 70, 67, 0.15)');

        // Switch back to Terax (dark)
        applyTheme('terax');
        assert.equal(state.themeId, 'terax');
        assert.equal(state.gridColor1, '#FB923C');
        assert.equal(state.gridColor2, '#C084FC');
        assert.equal(getCanvasBackgroundColor(), '#0a0c10');
        assert.equal(getCanvasTextColor(), '#d0d7e2');
        assert.equal(getCanvasAxesColor(), 'rgba(130, 130, 180, 0.8)');
        const teraxGrid = getCanvasGridColors();
        assert.equal(teraxGrid.minorColor, 'rgba(128, 137, 255, 0.04)');
        assert.equal(teraxGrid.majorColor, 'rgba(128, 137, 255, 0.12)');
    } finally {
        state.themeId = originalThemeId;
        state.gridColor1 = originalGridColor1;
        state.gridColor2 = originalGridColor2;
    }
});

test('themeVariables generates complete CSS variable mappings for light themes', () => {
    const snowVars = themeVariables('snow_storm');
    assert.equal(snowVars['--bg-color'], '#E5E9F0');
    assert.equal(snowVars['--card-bg-color'], '#ECEFF4');
    assert.equal(snowVars['--text-color'], '#2E3440');
    assert.equal(snowVars['--canvas-bg-color'], '#ECEFF4');
    assert.equal(snowVars['--canvas-text-color'], '#2E3440');

    const dollarVars = themeVariables('dollar');
    assert.equal(dollarVars['--bg-color'], '#e4e4d4');
    assert.equal(dollarVars['--card-bg-color'], '#edf0e4');
    assert.equal(dollarVars['--text-color'], '#555a56');
    assert.equal(dollarVars['--canvas-bg-color'], '#e4e4d4');
    assert.equal(dollarVars['--canvas-text-color'], '#424643');
});
