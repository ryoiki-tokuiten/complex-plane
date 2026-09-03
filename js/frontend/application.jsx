/** @jsxImportSource preact */
import { render } from 'preact';
import { ControlPanel } from './shell/control-panel.jsx';
import { Workspace } from './shell/workspace.jsx';
import { Overlays } from './shell/overlays.jsx';
import { PlaneContextMenu } from './components/plane-context-menu.jsx';
import { Tooltip } from './components/tooltip.jsx';
import { useAppState } from './state-hooks.js';
import { themeVariables, themes } from './theme.js';

function Application() {
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
                <ControlPanel />
                <Workspace />
            </main>
            <Tooltip />
            <Overlays />
            <PlaneContextMenu theme={theme} />
        </div>
    );
}

export function mountApplication(container) {
    render(<Application />, container);
}
