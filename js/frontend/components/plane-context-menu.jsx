/** @jsxImportSource preact */
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { state } from '../../store/state.js';
import { requestUiRedraw } from '../../rendering/redraw-scheduler.js';
import { getWPlaneMenuItems, getZPlaneMenuItems } from '../context-menu-model.js';
import { setPlaneContextMenuHandlers } from '../plane-context-menu-state.js';
import { Overlays } from '../shell/overlays.jsx';

const VIEWPORT_MARGIN = 8;
const SUBMENU_OFFSET = 10;
const SUBMENU_CLOSE_DELAY_MS = 350;

function CheckIcon() {
    return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
    </svg>;
}

function DownloadIcon() {
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
    </svg>;
}

function SubmenuArrow() {
    return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
    </svg>;
}

function childrenFor(item) {
    return typeof item.getSubmenu === 'function' ? item.getSubmenu() : item.children;
}

function MenuButton({ item, topLevel = false, openSubmenu, hideSubmenu, close, cancelClose, scheduleClose }) {
    const children = childrenFor(item);
    const run = event => {
        event.stopPropagation();
        if (item.disabled) return;
        if (children?.length && !item.onClick) {
            openSubmenu(item, event.currentTarget);
            return;
        }
        if (item.keepOpenOnClick) {
            item.onClick?.();
            if (children?.length) openSubmenu(item, event.currentTarget);
            return;
        }
        close();
        item.onClick?.();
    };
    const enter = event => {
        cancelClose();
        if (children?.length) openSubmenu(item, event.currentTarget);
        else if (topLevel) hideSubmenu();
    };
    return <button id={!topLevel ? item.id : undefined} type="button"
        role={item.type === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'}
        aria-checked={item.type === 'checkbox' ? String(Boolean(item.checked)) : undefined}
        class={`plane-context-menu-item${item.checked ? ' checked' : ''}${item.disabled ? ' disabled' : ''}${children?.length ? ' has-submenu' : ''}`}
        disabled={item.disabled} onClick={run} onMouseEnter={enter}
        onMouseLeave={children?.length ? scheduleClose : undefined}>
        {item.type === 'checkbox'
            ? <span class="plane-context-menu-check">{item.checked && <CheckIcon />}</span>
            : topLevel && <span class="plane-context-menu-icon">{item.icon === 'download' && <DownloadIcon />}</span>}
        <span class="plane-context-menu-label">{item.label}</span>
        {children?.length ? <span class="plane-context-menu-arrow"><SubmenuArrow /></span> : null}
    </button>;
}

function MenuItems(props) {
    return props.items.map((item, index) => item.type === 'divider'
        ? <div key={`divider-${index}`} class="plane-context-menu-divider" />
        : item.type === 'custom'
            ? null
            : <MenuButton key={item.id || index} item={item} {...props} />);
}

export function PlaneContextMenu({ theme }) {
    const menuRef = useRef(null);
    const submenuRef = useRef(null);
    const closeTimer = useRef(null);
    const [menu, setMenu] = useState(null);
    const [submenu, setSubmenu] = useState(null);

    const cancelClose = () => {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
    };
    const hideSubmenu = () => {
        cancelClose();
        state.contextMenuPanel = '';
        setSubmenu(null);
    };
    const close = () => {
        hideSubmenu();
        setMenu(null);
    };
    const scheduleClose = () => {
        cancelClose();
        closeTimer.current = setTimeout(hideSubmenu, SUBMENU_CLOSE_DELAY_MS);
    };
    const openSubmenu = (item, parent) => {
        const children = childrenFor(item) || [];
        if (!parent || !children.length) return hideSubmenu();
        const custom = children.find(child => child.type === 'custom')?.panel || '';
        state.contextMenuPanel = custom;
        const rect = parent.getBoundingClientRect();
        const anchor = {
            left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
            width: rect.width, height: rect.height
        };
        setSubmenu({
            items: children,
            custom,
            anchor,
            left: rect.right + SUBMENU_OFFSET,
            top: Math.max(VIEWPORT_MARGIN, rect.top - 4),
            bridge: null
        });
    };

    useLayoutEffect(() => {
        if (!menuRef.current || !menu) return;
        const rect = menuRef.current.getBoundingClientRect();
        const left = Math.max(VIEWPORT_MARGIN,
            Math.min(menu.requestedLeft, window.innerWidth - rect.width - VIEWPORT_MARGIN));
        const top = Math.max(VIEWPORT_MARGIN,
            Math.min(menu.requestedTop, window.innerHeight - rect.height - VIEWPORT_MARGIN));
        if (left !== menu.left || top !== menu.top) setMenu({ ...menu, left, top });
    }, [menu?.requestedLeft, menu?.requestedTop, menu?.items]);

    useLayoutEffect(() => {
        if (!submenuRef.current || !submenu) return;
        const rect = submenuRef.current.getBoundingClientRect();
        const parent = submenu.anchor;
        let left = parent.right + SUBMENU_OFFSET;
        if (left + rect.width > window.innerWidth - VIEWPORT_MARGIN) {
            left = parent.left - rect.width - SUBMENU_OFFSET;
        }
        left = Math.max(VIEWPORT_MARGIN, left);
        let top = parent.top - 4;
        if (top + rect.height > window.innerHeight - VIEWPORT_MARGIN) {
            top = window.innerHeight - rect.height - VIEWPORT_MARGIN;
        }
        top = Math.max(VIEWPORT_MARGIN, top);
        const opensRight = left >= parent.right;
        const gapLeft = opensRight ? parent.right : left + rect.width;
        const gapRight = opensRight ? left : parent.left;
        const gapTop = Math.min(parent.top, top);
        const gapBottom = Math.max(parent.bottom, top + rect.height);
        const bridge = gapRight > gapLeft ? {
            left: gapLeft,
            top: gapTop,
            width: gapRight - gapLeft,
            height: gapBottom - gapTop
        } : null;
        if (left !== submenu.left || top !== submenu.top || JSON.stringify(bridge) !== JSON.stringify(submenu.bridge)) {
            setSubmenu({ ...submenu, left, top, bridge });
        }
    }, [submenu?.anchor, submenu?.items, submenu?.custom]);

    useEffect(() => {
        const cancelPicking = () => {
            if (state.canvasClickPickerTarget || state.taylorSeriesCanvasClickCenterEnabled) {
                state.canvasClickPickerTarget = null;
                state.taylorSeriesCanvasClickCenterEnabled = false;
                state.taylorSeriesHoverPoint = null;
                requestUiRedraw();
                return true;
            }
            return false;
        };
        const open = (event, planeType) => {
            event.preventDefault();
            event.stopPropagation();
            if (cancelPicking()) return;
            const items = planeType === 'z' ? getZPlaneMenuItems() : getWPlaneMenuItems();
            if (!items?.length) return close();
            hideSubmenu();
            setMenu({
                items,
                requestedLeft: event.clientX,
                requestedTop: event.clientY,
                left: event.clientX,
                top: event.clientY
            });
        };
        const unregister = setPlaneContextMenuHandlers(open, close);
        const dismiss = event => {
            if (event.key === 'Escape') {
                cancelPicking();
                close();
                return;
            }
            if (event.type === 'pointerdown' && !event.target.closest?.('.plane-context-menu, .plane-context-submenu-bridge')) {
                close();
            }
        };
        const handleContextMenu = event => {
            if (cancelPicking()) {
                event.preventDefault();
                event.stopPropagation();
            }
        };
        window.addEventListener('keydown', dismiss);
        window.addEventListener('pointerdown', dismiss, true);
        window.addEventListener('contextmenu', handleContextMenu, true);
        return () => {
            cancelClose();
            unregister();
            window.removeEventListener('keydown', dismiss);
            window.removeEventListener('pointerdown', dismiss, true);
            window.removeEventListener('contextmenu', handleContextMenu, true);
        };
    }, []);

    if (!menu || typeof document === 'undefined') return null;
    const shared = { openSubmenu, hideSubmenu, close, cancelClose, scheduleClose };
    return createPortal(<>
        <div ref={menuRef} id="plane_context_menu" class="plane-context-menu" role="menu"
            style={{ ...theme, left: menu.left, top: menu.top }}>
            <MenuItems items={menu.items} topLevel {...shared} />
        </div>
        {submenu && <>
            {submenu.bridge && <div id="plane_context_submenu_bridge" class="plane-context-submenu-bridge"
                style={submenu.bridge} onMouseEnter={cancelClose} onMouseLeave={scheduleClose} />}
            <div ref={submenuRef} id="plane_context_submenu" class="plane-context-menu plane-context-submenu"
                role="menu" style={{ ...theme, left: submenu.left, top: submenu.top }}
                onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
                {submenu.custom
                    ? <Overlays contextPanel={submenu.custom} />
                    : <MenuItems items={submenu.items} {...shared} />}
            </div>
        </>}
    </>, document.body);
}
