import { state } from '../store/state.js';

// Curated & Locked UI Themes
export const themes = [
    { id: "terax", name: "Terax", desc: "The default Terax look — clean glass on pure dark.", colors: { bg: '#09090B', panel: '#0F0F13', border: '#27272A', text: '#FAFAFA', textMuted: '#A1A1AA', accent: '#FFFFFF', accentGlow: 'rgba(255,255,255,0.3)', gridPri: '#FB923C', gridSec: '#C084FC' } },
    { id: "tide", name: "Tide", desc: "Deep slate with muted teal.", colors: { bg: '#0B0F12', panel: '#10151A', border: '#1E2732', text: '#E6E6E6', textMuted: '#708291', accent: '#5E8B8B', accentGlow: 'rgba(94,139,139,0.3)', gridPri: '#5E8B8B', gridSec: '#826859' } },
    { id: "rose", name: "Rosé Pine", desc: "Deepened soho vibes, natural pine and rose.", colors: { bg: '#000000', panel: '#070707', border: '#1E1A2E', text: '#E0DEF4', textMuted: '#908CAA', accent: '#EBBCBA', accentGlow: 'rgba(235,188,186,0.3)', gridPri: '#FB923C', gridSec: '#C084FC' } },
    { id: "sage", name: "Sage", desc: "Muted forest green — calm and soft.", colors: { bg: '#0C120E', panel: '#111813', border: '#1E2922', text: '#E0E6E2', textMuted: '#89998F', accent: '#8B9E77', accentGlow: 'rgba(139,158,119,0.3)', gridPri: '#8B9E77', gridSec: '#6F8091' } },
    { id: "caffeine", name: "Caffeine", desc: "Warm coffee tones — cream and espresso.", colors: { bg: '#14100E', panel: '#1A1513', border: '#2B221E', text: '#E8DCD1', textMuted: '#A69285', accent: '#D4A373', accentGlow: 'rgba(212,163,115,0.3)', gridPri: '#D4A373', gridSec: '#8A6F62' } },
    { id: "gradient", name: "Gradient", desc: "Original app theme, deep obsidian and vivid accents.", colors: { bg: '#0d0f26', panel: 'rgba(40, 22, 66, 0.3)', border: 'rgba(128, 137, 255, 0.3)', text: '#e0e4ff', textMuted: '#a0a8d8', accent: '#a78bfa', accentGlow: 'rgba(160, 170, 255, 0.7)', gridPri: '#FB923C', gridSec: '#C084FC' } },
    {
        id: "snow_storm",
        name: "Snow Storm",
        desc: "Nord snow storm — frosty slate and cool whites.",
        isLight: true,
        colors: {
            bg: '#E5E9F0',
            panel: '#ECEFF4',
            border: '#D8DEE9',
            text: '#2E3440',
            textMuted: '#4C566A',
            accent: '#5E81AC',
            accentGlow: 'rgba(94, 129, 172, 0.28)',
            gridPri: '#5E81AC',
            gridSec: '#88C0D0',
            canvasBg: '#ECEFF4',
            canvasText: '#2E3440',
            canvasAxes: 'rgba(46, 52, 64, 0.55)',
            gridMinor: 'rgba(46, 52, 64, 0.05)',
            gridMajor: 'rgba(46, 52, 64, 0.13)'
        }
    },
    {
        id: "dollar",
        name: "Dollar",
        desc: "Cashmere & sage — calm olive tones on warm parchment.",
        isLight: true,
        colors: {
            bg: '#e4e4d4',
            panel: '#edf0e4',
            border: '#cbd0bf',
            text: '#555a56',
            textMuted: '#8a9b69',
            accent: '#6b886b',
            accentGlow: 'rgba(107, 136, 107, 0.3)',
            gridPri: '#6b886b',
            gridSec: '#424643',
            canvasBg: '#e4e4d4',
            canvasText: '#424643',
            canvasAxes: 'rgba(66, 70, 67, 0.55)',
            gridMinor: 'rgba(66, 70, 67, 0.06)',
            gridMajor: 'rgba(66, 70, 67, 0.15)'
        }
    }
];

const hexToRgbStr = hex => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r}, ${g}, ${b}`;
};

const THEME_PREFERENCES_KEY = 'complex-plane-theme-preferences';
const isHexColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

export function loadThemePreferences() {
    if (typeof localStorage === 'undefined') return;
    const serialized = localStorage.getItem(THEME_PREFERENCES_KEY);
    if (serialized === null) return;
    const saved = JSON.parse(serialized);
    if (!saved || typeof saved !== 'object') throw new Error('Theme preferences must be an object.');
    if (!themes.some(theme => theme.id === saved.themeId) ||
        !isHexColor(saved.gridColor1) || !isHexColor(saved.gridColor2)) {
        throw new Error('Theme preferences are malformed.');
    }
    state.themeId = saved.themeId;
    state.gridColor1 = saved.gridColor1;
    state.gridColor2 = saved.gridColor2;
}

export function persistThemePreferences() {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(THEME_PREFERENCES_KEY, JSON.stringify({
        themeId: state.themeId,
        gridColor1: state.gridColor1,
        gridColor2: state.gridColor2
    }));
}

export function applyTheme(themeId, { preserveGridColors = false } = {}) {
    const theme = themes.find(t => t.id === themeId);
    if (!theme) throw new Error(`Unknown theme: ${themeId}.`);
    state.themeId = themeId;
    if (!preserveGridColors) {
        state.gridColor1 = theme.colors.gridPri;
        state.gridColor2 = theme.colors.gridSec;
    }
    if (typeof document !== 'undefined') {
        const root = document.documentElement;
        root.setAttribute('data-theme', themeId);
        root.setAttribute('data-theme-mode', theme.isLight ? 'light' : 'dark');
        const vars = themeVariables(themeId);
        for (const [key, value] of Object.entries(vars)) {
            root.style.setProperty(key, value);
        }
    }
}

export function getActiveTheme() {
    return themes.find(t => t.id === state.themeId) || themes[0];
}

export function getCanvasBackgroundColor(themeId = state.themeId) {
    const theme = themes.find(t => t.id === themeId);
    return theme?.colors?.canvasBg || '#0a0c10';
}

export function getCanvasTextColor(themeId = state.themeId) {
    const theme = themes.find(t => t.id === themeId);
    return theme?.colors?.canvasText || '#d0d7e2';
}

export function getCanvasAxesColor(themeId = state.themeId) {
    const theme = themes.find(t => t.id === themeId);
    return theme?.colors?.canvasAxes || 'rgba(130, 130, 180, 0.8)';
}

export function getCanvasGridColors(themeId = state.themeId) {
    const theme = themes.find(t => t.id === themeId);
    return {
        minorColor: theme?.colors?.gridMinor || 'rgba(128, 137, 255, 0.04)',
        majorColor: theme?.colors?.gridMajor || 'rgba(128, 137, 255, 0.12)'
    };
}

export function themeVariables(themeId) {
    const theme = themes.find(candidate => candidate.id === themeId);
    if (!theme) throw new Error(`Unknown theme: ${themeId}.`);
    const isLight = !!theme.isLight;
    return {
        '--bg-color': theme.colors.bg,
        '--bg-color-rgb': hexToRgbStr(theme.colors.bg),
        '--card-bg-color': theme.colors.panel,
        '--border-color': theme.colors.border,
        '--text-color': theme.colors.text,
        '--text-secondary-color': theme.colors.textMuted,
        '--accent-purple': theme.colors.accent,
        '--accent-purple-dark': theme.colors.accent,
        '--glow-color': theme.colors.accentGlow,
        '--canvas-bg-color': theme?.colors?.canvasBg || '#0a0c10',
        '--canvas-text-color': theme?.colors?.canvasText || '#d0d7e2',
        '--panel-inset-bg': isLight
            ? `color-mix(in srgb, ${theme.colors.panel} 72%, ${theme.colors.bg})`
            : `color-mix(in srgb, ${theme.colors.panel} 85%, ${theme.colors.bg})`,
        '--overlay-glass-bg': isLight
            ? `color-mix(in srgb, ${theme.colors.panel} 88%, transparent)`
            : 'rgba(8, 10, 20, 0.65)',
        '--overlay-glass-border': theme.colors.border
    };
}
