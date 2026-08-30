/** @jsxImportSource preact */
import { getStateSignal, state } from '../../store/state.js';
import { domainPalettes } from '../../constants/domain-palettes.js';
import { SURFACE_PALETTES } from '../../constants/surface-palettes.js';
import { themes, applyTheme, persistThemePreferences } from '../../ui/theme-manager.js';
import { requestDomainRedraw } from '../../rendering/redraw-scheduler.js';

function redraw() {
    requestDomainRedraw();
}

export function ThemeOptions() {
    const activeTheme = getStateSignal('themeId').value;

    return themes.map(theme => (
        <button class={`theme-card${activeTheme === theme.id ? ' active' : ''}`}
            data-theme-id={theme.id} type="button" onClick={() => {
                applyTheme(theme.id);
                persistThemePreferences();
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

export const SurfacePaletteOptions = () => (
    <PaletteOptions palettes={SURFACE_PALETTES} stateKey="surfacePalette" gradient />
);

export function ActiveDomainPaletteName() {
    const id = getStateSignal('domainPalette').value;
    return domainPalettes.find(palette => palette.id === id)?.name || domainPalettes[0].name;
}

export function ActiveSurfacePaletteName() {
    const id = getStateSignal('surfacePalette').value;
    return SURFACE_PALETTES.find(palette => palette.id === id)?.name || SURFACE_PALETTES[0].name;
}
