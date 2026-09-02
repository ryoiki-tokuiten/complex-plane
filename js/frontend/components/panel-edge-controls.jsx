/** @jsxImportSource preact */

export function PanelEdgeControls() {
    return <div class="panel-edge-handle-bar">
        <div class="panel-edge-btn-group">
            <button type="button" class="panel-edge-action-btn panel-resize-btn"
                title="Resize panel (drag)" aria-label="Resize panel">
                <i data-lucide="maximize-2" class="icon-whiteboard" aria-hidden="true" />
            </button>
            <button type="button" class="panel-edge-action-btn panel-grip-btn"
                title="Move panel (drag)" aria-label="Move panel">
                <i data-lucide="grip" class="icon-whiteboard" aria-hidden="true" />
            </button>
        </div>
    </div>;
}
