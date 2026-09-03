/** @jsxImportSource preact */
import { useAppState } from '../state-hooks.js';
import { Icon } from './icon.jsx';

const KEYS = [
    [null, null],
    ['ArrowUp', 'arrow-up'],
    [null, null],
    ['ArrowLeft', 'arrow-left'],
    ['ArrowDown', 'arrow-down'],
    ['ArrowRight', 'arrow-right']
];

export function NavigationKeyHints() {
    const enabled = useAppState('navigationModeEnabled') && !useAppState('laplaceModeEnabled');
    const pressed = new Set(useAppState('navigationPressedKeys'));
    return <div id="navigation_keyhint_overlay"
        class={`navigation-keyhint-overlay${enabled ? '' : ' hidden'}`}>
        <div class="navigation-keyhint-grid">
            {KEYS.map(([key, icon], index) => key
                ? <div key={key} class={`keyhint-key${pressed.has(key) ? ' active' : ''}`}
                    data-tooltip={`Move ${key.replace('Arrow', '').toLowerCase()}`}>
                    <Icon name={icon} />
                </div>
                : <div key={`spacer-${index}`} class="keyhint-spacer" />)}
        </div>
        <span class="navigation-keyhint-caption">Arrow keys to navigate</span>
    </div>;
}
