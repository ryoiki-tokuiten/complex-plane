/** @jsxImportSource preact */
import { useRef } from 'preact/hooks';
import { Icon } from './icon.jsx';
import {
    beginPanelInteraction,
    endPanelInteraction,
    movePanelInteraction
} from '../../ui/panel-layout-manager.js';

export function PanelEdgeControls({ panelId }) {
    const session = useRef(null);
    const start = kind => event => { session.current = beginPanelInteraction(panelId, kind, event); };
    const move = event => movePanelInteraction(session.current, event);
    const end = () => {
        endPanelInteraction(session.current);
        session.current = null;
    };
    return <div class="panel-edge-handle-bar">
        <div class="panel-edge-btn-group">
            <button type="button" class="panel-edge-action-btn panel-resize-btn"
                title="Resize panel (drag)" aria-label="Resize panel"
                onPointerDown={start('resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
                <Icon name="maximize-2" class="icon-whiteboard" />
            </button>
            <button type="button" class="panel-edge-action-btn panel-grip-btn"
                title="Move panel (drag)" aria-label="Move panel"
                onPointerDown={start('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
                <Icon name="grip" class="icon-whiteboard" />
            </button>
        </div>
    </div>;
}
