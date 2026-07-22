/** @jsxImportSource preact */
import { context, getStateSignal, state } from '../../store/state.js';
import { domainPalettes, realPlotsPalettes, themes, applyTheme } from '../../ui/theme-manager.js';
import { requestRedrawAll } from '../../rendering/redraw-scheduler.js';

function redraw() {
    context.domainColoringDirty = true;
    requestRedrawAll();
}

export function ThemeOptions() {
    const activeTheme = getStateSignal('themeId').value;

    return themes.map(theme => (
        <button class={`theme-card${activeTheme === theme.id ? ' active' : ''}`}
            data-theme-id={theme.id} type="button" onClick={() => {
                state.themeId = theme.id;
                applyTheme(theme.id);
                redraw();
            }}>
            <div class="theme-preview-pill">
                {[theme.colors.accent, theme.colors.gridPri, theme.colors.gridSec].map(color => (
                    <div key={color} class="theme-preview-dot" style={{ backgroundColor: color }} />
                ))}
            </div>
            <div class="theme-info">
                <h3>{theme.name}</h3>
                <p>{theme.desc}</p>
            </div>
        </button>
    ));
}

function PaletteOptions({ palettes, stateKey, gradient }) {
    const activeId = getStateSignal(stateKey).value;

    return palettes.map(palette => (
        <button key={palette.id} class={`domain-palette-circle-btn${activeId === palette.id ? ' active' : ''}`}
            data-palette-id={palette.id} type="button" title={palette.name}
            style={{ background: `conic-gradient(${gradient ? 'from 270deg, ' : ''}${palette.colors})` }}
            onClick={() => {
                state[stateKey] = palette.id;
                redraw();
            }} />
    ));
}

export const DomainPaletteOptions = () => (
    <PaletteOptions palettes={domainPalettes} stateKey="domainPalette" />
);

export const RealPlotsPaletteOptions = () => (
    <PaletteOptions palettes={realPlotsPalettes} stateKey="realPlotsPalette" gradient />
);

export function ActiveDomainPaletteName() {
    const id = getStateSignal('domainPalette').value;
    return domainPalettes.find(palette => palette.id === id)?.name || domainPalettes[0].name;
}

export function ActiveRealPlotsPaletteName() {
    const id = getStateSignal('realPlotsPalette').value;
    return realPlotsPalettes.find(palette => palette.id === id)?.name || realPlotsPalettes[0].name;
}
