let openHandler = null;
let closeHandler = null;

export function setPlaneContextMenuHandlers(open, close) {
    openHandler = open;
    closeHandler = close;
    return () => {
        if (openHandler === open) openHandler = null;
        if (closeHandler === close) closeHandler = null;
    };
}

export function openPlaneContextMenu(event, planeType) {
    openHandler?.(event, planeType);
}

export function hidePlaneContextMenu() {
    closeHandler?.();
}
