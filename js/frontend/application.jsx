/** @jsxImportSource preact */
import { render } from 'preact';
import { ControlPanel } from './shell/control-panel.jsx';
import { Workspace } from './shell/workspace.jsx';
import { Overlays } from './shell/overlays.jsx';
import { PlaneContextMenu } from './components/plane-context-menu.jsx';
import { Tooltip } from './components/tooltip.jsx';
import { useAppState } from './state-hooks.js';
import { themeVariables, themes } from './theme.js';

const EMPTY_UI_MODEL = Object.freeze({ props: new Map(), actions: new Map() });
let root = null;
let currentModel = EMPTY_UI_MODEL;

function Application({ model }) {
    const vertical = useAppState('verticalLayoutEnabled');
    const zoomControls = useAppState('canvasZoomControlsEnabled');
    const themeId = useAppState('themeId');
    const theme = themeVariables(themeId);
    const activeTheme = themes.find(t => t.id === themeId);
    const mode = activeTheme?.isLight ? 'light' : 'dark';
    return (
        <div class={`application-root${vertical ? ' vertical-layout' : ''}${zoomControls ? ' canvas-zoom-controls-enabled' : ''}`}
            data-theme={themeId}
            data-theme-mode={mode}
            style={theme}>
            <div class="background-container"><div class="background-noise" /></div>
            <main>
                <ControlPanel model={model} />
                <Workspace model={model} />
            </main>
            <Tooltip />
            <Overlays model={model} />
            <PlaneContextMenu model={model} theme={theme} />
        </div>
    );
}

export function mountApplication(container, model = EMPTY_UI_MODEL) {
    root = container;
    currentModel = model;
    render(<Application model={currentModel} />, root);
}

export function refreshApplication(model = currentModel) {
    currentModel = model;
    if (root) render(<Application model={currentModel} />, root);
}
