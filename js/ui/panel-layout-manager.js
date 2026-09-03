import { computed, signal } from '@preact/signals';
import { state, subscribeState } from '../store/state.js';
import { setupVisualParameters } from '../utils/dom-utils.js';
import { requestDomainRedraw } from '../rendering/redraw-scheduler.js';

const GAP = 24;
const MIN_WIDTH = 220;
const MIN_HEIGHT = 180;
const MAX_WIDTH = 2560;
const MAX_HEIGHT = 2000;
const SNAP_THRESHOLD = 28;
const STORAGE_PREFIX = 'complex_panelLayout_';
const LAYOUT_VERSION = 'v8';
const NORMAL_PANEL_IDS = ['z_plane_column', 'w_plane_column', 'graph_column'];

const layout = signal({});
const edgePanel = signal(null);
const workspaceSize = signal({ width: 0, height: 0 });
const activePanel = signal(null);
export const snapIndicator = signal(null);
let workspace = null;
let resizeObserver = null;
let stopLayoutEffect = null;
let layoutKey = '';
let zIndex = 10;
let redrawFrame = null;

const px = value => `${Math.round(value)}px`;
const number = value => Number.parseFloat(value) || 0;
const rect = (left, top, width, height) => ({
    left: px(left), top: px(top), width: px(width), height: px(height)
});
const vertical = () => Boolean(state.verticalLayoutEnabled);
const mode = () => state.laplaceModeEnabled ? 'laplace' : state.realPlotsEnabled ? 'real_plots' : 'normal';
const storageKey = () => `${STORAGE_PREFIX}${mode()}_${vertical() ? 'vert' : 'horiz'}_${LAYOUT_VERSION}`;

function panelSize(width, height) {
    return {
        width: Math.max(MIN_WIDTH, vertical() ? width : Math.floor((Math.max(480, width) - GAP) / 2)),
        height: Math.max(MIN_HEIGHT, vertical() ? Math.floor((Math.max(400, height) - GAP) / 2) : height)
    };
}

function visiblePanelIds() {
    if (state.realPlotsEnabled) {
        return ['real_plots_column', ...(state.show2DContourPlot ? ['contour_2d_column'] : [])];
    }
    if (state.laplaceModeEnabled) {
        return [
            'z_plane_column', 'w_plane_column', 'fourier_3d_column',
            'laplace_com_column', 'laplace_spectrum_column', 'laplace_3d_column',
            ...(state.show2DContourPlot ? ['contour_2d_column'] : [])
        ];
    }
    const ids = ['z_plane_column', 'w_plane_column'];
    if (state.graphViewEnabled) ids.push('graph_column');
    if (state.show2DContourPlot) ids.push('contour_2d_column');
    return ids;
}

export function computeNormalModeLayout(width, height) {
    const size = panelSize(width, height);
    const position = index => rect(
        vertical() ? 0 : index * (size.width + GAP),
        vertical() ? index * (size.height + GAP) : 0,
        size.width,
        size.height
    );
    return Object.fromEntries(NORMAL_PANEL_IDS.map((id, index) => [id, position(index)]));
}

export function computeRealPlotsLayout(width, height) {
    if (!state.show2DContourPlot) {
        return { real_plots_column: rect(0, 0, Math.max(300, width), Math.max(300, height)) };
    }
    const size = panelSize(width, height);
    return {
        real_plots_column: rect(0, 0, size.width, size.height),
        contour_2d_column: vertical()
            ? rect(0, size.height + GAP, size.width, size.height)
            : rect(size.width + GAP, 0, size.width, size.height)
    };
}

export function computeLaplaceModeLayout(width, height) {
    if (vertical()) {
        const panelWidth = Math.max(MIN_WIDTH, width);
        const panelHeight = Math.max(MIN_HEIGHT, Math.floor((Math.max(400, height) - GAP) / 2));
        const halfWidth = Math.max(MIN_WIDTH, Math.floor((panelWidth - GAP) / 2));
        const row3 = Math.max(340, Math.floor(panelHeight * .85));
        const row4 = Math.max(280, Math.floor(panelHeight * .7));
        const row5 = Math.max(500, Math.floor(panelHeight * 1.4));
        const top2 = panelHeight + GAP;
        const top3 = top2 + panelHeight + GAP;
        const top4 = top3 + row3 + GAP;
        const top5 = top4 + row4 + GAP;
        return {
            z_plane_column: rect(0, 0, panelWidth, panelHeight),
            w_plane_column: rect(0, top2, panelWidth, panelHeight),
            fourier_3d_column: rect(0, top3, panelWidth, row3),
            laplace_com_column: rect(0, top4, halfWidth, row4),
            laplace_spectrum_column: rect(halfWidth + GAP, top4, halfWidth, row4),
            laplace_3d_column: rect(0, top5, panelWidth, row5)
        };
    }

    const track = Math.max(460, Math.floor((Math.max(800, width) - GAP) / 2));
    const combined = track * 2 + GAP;
    const screenHeight = Math.max(480, height);
    const row2 = Math.max(380, Math.floor(screenHeight * .75));
    const row3 = Math.max(340, Math.floor(screenHeight * .6));
    const top2 = screenHeight + GAP;
    const top3 = top2 + row2 + GAP;
    return {
        z_plane_column: rect(0, 0, track, screenHeight),
        w_plane_column: rect(track + GAP, 0, track, screenHeight),
        fourier_3d_column: rect(0, top2, combined, row2),
        laplace_com_column: rect(0, top3, track, row3),
        laplace_spectrum_column: rect(track + GAP, top3, track, row3),
        laplace_3d_column: rect(combined + GAP, 0, Math.max(680, track), Math.max(700, top3 + row3))
    };
}

function defaultLayout(width, height) {
    if (state.realPlotsEnabled) return computeRealPlotsLayout(width, height);
    if (state.laplaceModeEnabled) return computeLaplaceModeLayout(width, height);
    return computeNormalModeLayout(width, height);
}

function nextAvailableSlot(panels, width, height) {
    const values = Object.values(panels);
    if (!values.length) return rect(0, 0, width, height);
    let right = 0;
    let bottom = 0;
    let top = Infinity;
    for (const panel of values) {
        right = Math.max(right, number(panel.left) + (number(panel.width) || width));
        bottom = Math.max(bottom, number(panel.top) + (number(panel.height) || height));
        top = Math.min(top, number(panel.top));
    }
    return vertical() ? rect(0, bottom + GAP, width, height) : rect(right + GAP, top, width, height);
}

function box(id, panel) {
    const left = number(panel.left);
    const top = number(panel.top);
    const width = number(panel.width) || 500;
    const height = number(panel.height) || 400;
    return { id, left, top, width, height, right: left + width, bottom: top + height };
}

export function resolvePanelCollisions(panels, activeId = null) {
    const result = Object.fromEntries(Object.entries(panels).map(([id, panel]) => [id, { ...panel }]));
    const boxes = Object.entries(result).map(([id, panel]) => box(id, panel));
    for (let pass = 0; pass < 8; pass++) {
        let moved = false;
        const active = activeId ? boxes.find(item => item.id === activeId) : null;
        if (active) {
            for (const other of boxes) {
                if (other === active) continue;
                const overlapX = Math.min(active.right, other.right) - Math.max(active.left, other.left);
                const overlapY = Math.min(active.bottom, other.bottom) - Math.max(active.top, other.top);
                if (overlapX <= 0 || overlapY <= 0) continue;
                if (overlapX > overlapY && (vertical() || other.top >= active.top + Math.floor(active.height * .4))) {
                    other.top = active.bottom + GAP;
                    other.bottom = other.top + other.height;
                } else {
                    other.left = active.right + GAP;
                    other.right = other.left + other.width;
                }
                moved = true;
            }
        }
        for (let first = 0; first < boxes.length; first++) {
            for (let second = first + 1; second < boxes.length; second++) {
                const a = boxes[first];
                const b = boxes[second];
                if (active && (a === active || b === active)) continue;
                const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (overlapX <= 0 || overlapY <= 0) continue;
                let pusher = a;
                let target = b;
                if (vertical()) {
                    if (a.top > b.top) [pusher, target] = [b, a];
                    target.top = pusher.bottom + GAP;
                    target.bottom = target.top + target.height;
                } else {
                    if (a.left > b.left || (a.left === b.left && a.top > b.top)) [pusher, target] = [b, a];
                    if (overlapX > overlapY && target.top >= pusher.top + Math.floor(pusher.height * .4)) {
                        target.top = pusher.bottom + GAP;
                        target.bottom = target.top + target.height;
                    } else {
                        target.left = pusher.right + GAP;
                        target.right = target.left + target.width;
                    }
                }
                moved = true;
            }
        }
        if (!moved) break;
    }

    if (vertical()) {
        boxes.sort((a, b) => a.top - b.top);
        for (const item of boxes) {
            let barrier = 0;
            for (const other of boxes) {
                if (other === item) continue;
                const overlap = Math.min(item.right, other.right) - Math.max(item.left, other.left);
                if (overlap > 0 && other.bottom <= item.top + GAP) barrier = Math.max(barrier, other.bottom + GAP);
            }
            if (barrier < item.top) {
                item.top = barrier;
                item.bottom = item.top + item.height;
            }
        }
    } else {
        boxes.sort((a, b) => a.left - b.left || a.top - b.top);
        for (const item of boxes) {
            let barrier = 0;
            for (const other of boxes) {
                if (other === item) continue;
                const overlap = Math.min(item.bottom, other.bottom) - Math.max(item.top, other.top);
                if (overlap > 0 && other.right <= item.left + GAP) barrier = Math.max(barrier, other.right + GAP);
            }
            if (barrier < item.left) {
                item.left = barrier;
                item.right = item.left + item.width;
            }
        }
        boxes.sort((a, b) => a.top - b.top || a.left - b.left);
        for (const item of boxes) {
            let barrier = 0;
            for (const other of boxes) {
                if (other === item) continue;
                const overlap = Math.min(item.right, other.right) - Math.max(item.left, other.left);
                if (overlap > 0 && other.bottom <= item.top + GAP) barrier = Math.max(barrier, other.bottom + GAP);
            }
            if (barrier < item.top) item.top = barrier;
        }
    }
    for (const item of boxes) {
        result[item.id].left = px(item.left);
        result[item.id].top = px(item.top);
    }
    return result;
}

function readSavedLayout() {
    const source = localStorage.getItem(storageKey());
    return source ? JSON.parse(source) : {};
}

function writeLayout() {
    const saved = Object.fromEntries(Object.entries(layout.peek()).map(([id, panel]) => [id, {
        left: panel.left, top: panel.top, width: panel.width, height: panel.height
    }]));
    localStorage.setItem(storageKey(), JSON.stringify(saved));
}

function triggerRedraw() {
    if (redrawFrame !== null) return;
    redrawFrame = requestAnimationFrame(() => {
        redrawFrame = null;
        setupVisualParameters(false, false);
        requestDomainRedraw(true);
    });
}

export function refreshPanelLayout(force = false) {
    if (!workspace || activePanel.peek()) return;
    const ids = visiblePanelIds();
    const nextKey = `${storageKey()}:${[...ids].sort().join(',')}`;
    if (!force && nextKey === layoutKey) return;
    layoutKey = nextKey;
    const width = workspace.clientWidth || window.innerWidth;
    const height = workspace.clientHeight || window.innerHeight;
    const defaults = defaultLayout(width, height);
    const saved = readSavedLayout();
    const size = panelSize(width, height);
    const next = {};
    for (const id of ids) next[id] = saved[id] || defaults[id] || nextAvailableSlot(next, size.width, size.height);
    layout.value = resolvePanelCollisions(next);
    triggerRedraw();
}

export function attachWorkspace(element) {
    if (workspace === element) return;
    resizeObserver?.disconnect();
    workspace = element;
    if (!workspace) return;
    workspaceSize.value = { width: workspace.clientWidth, height: workspace.clientHeight };
    resizeObserver = new ResizeObserver(() => {
        workspaceSize.value = { width: workspace.clientWidth, height: workspace.clientHeight };
        refreshPanelLayout(true);
    });
    resizeObserver.observe(workspace);
    refreshPanelLayout(true);
}

function revealEdge(id, event) {
    if (activePanel.peek()) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    edgePanel.value = bounds.right - event.clientX < 60 || bounds.bottom - event.clientY < 60 ? id : null;
}

function raisePanel(id, event) {
    if (event.button !== 0 || !layout.peek()[id]) return;
    const panel = layout.peek()[id];
    layout.value = { ...layout.peek(), [id]: { ...panel, zIndex: ++zIndex } };
}

export function getPanelProps(id) {
    const active = activePanel.value;
    return {
        style: layout.value[id],
        dragging: active?.id === id && active.kind === 'move',
        resizing: active?.id === id && active.kind === 'resize',
        edgeVisible: edgePanel.value === id,
        onPointerDown: event => raisePanel(id, event),
        onPointerMove: event => revealEdge(id, event),
        onPointerLeave: () => { if (edgePanel.peek() === id) edgePanel.value = null; }
    };
}

export const workspaceExtent = computed(() => {
    let width = 0;
    let height = 0;
    for (const panel of Object.values(layout.value)) {
        width = Math.max(width, number(panel.left) + number(panel.width));
        height = Math.max(height, number(panel.top) + number(panel.height));
    }
    const bounds = workspaceSize.value;
    if (activePanel.value) return { width: px(width + 4000), height: px(height + 4000) };
    return {
        width: width > bounds.width ? px(width + GAP) : '0px',
        height: height > bounds.height ? px(height + GAP) : '0px'
    };
});

function calculateSnap(id, panels, left, top) {
    const panel = panels[id];
    const width = number(panel.width) || 500;
    const height = number(panel.height) || 400;
    const x = [0];
    const y = [0];
    for (const [otherId, other] of Object.entries(panels)) {
        if (otherId === id) continue;
        const otherLeft = number(other.left);
        const otherTop = number(other.top);
        x.push(otherLeft + number(other.width) + GAP, otherLeft - width - GAP, otherLeft);
        y.push(otherTop + number(other.height) + GAP, otherTop - height - GAP, otherTop);
    }
    const nearest = (value, candidates) => {
        let best = value;
        let distance = SNAP_THRESHOLD + 1;
        for (const candidate of candidates) {
            const candidateDistance = Math.abs(candidate - value);
            if (candidate >= 0 && candidateDistance <= SNAP_THRESHOLD && candidateDistance < distance) {
                best = candidate;
                distance = candidateDistance;
            }
        }
        return best;
    };
    const snapLeft = nearest(left, x);
    const snapTop = nearest(top, y);
    return snapLeft !== left || snapTop !== top
        ? { left: px(snapLeft), top: px(snapTop), width: px(width), height: px(height) }
        : null;
}

function applyInteraction(session) {
    const scrollX = (workspace?.scrollLeft || 0) - session.scrollLeft;
    const scrollY = (workspace?.scrollTop || 0) - session.scrollTop;
    const dx = session.clientX - session.x + scrollX;
    const dy = session.clientY - session.y + scrollY;
    const panel = layout.peek()[session.id];
    const geometry = session.kind === 'resize'
        ? {
            width: px(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, session.width + dx))),
            height: px(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, session.height + dy)))
        }
        : { left: px(Math.max(0, session.left + dx)), top: px(Math.max(0, session.top + dy)) };
    const next = { ...layout.peek(), [session.id]: { ...panel, ...geometry } };
    layout.value = next;
    snapIndicator.value = session.kind === 'move'
        ? calculateSnap(session.id, next, number(geometry.left), number(geometry.top))
        : null;
    triggerRedraw();
}

function autoScroll(session) {
    if (activePanel.peek()?.id !== session.id || session.kind !== 'move') return;
    const bounds = workspace.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (session.clientX < bounds.left + 45 && workspace.scrollLeft > 0) dx = -12;
    else if (session.clientX > bounds.right - 45) dx = 12;
    if (session.clientY < bounds.top + 45 && workspace.scrollTop > 0) dy = -12;
    else if (session.clientY > bounds.bottom - 45) dy = 12;
    if (dx || dy) {
        workspace.scrollLeft += dx;
        workspace.scrollTop += dy;
        applyInteraction(session);
    }
    session.frame = requestAnimationFrame(() => autoScroll(session));
}

export function beginPanelInteraction(id, kind, event) {
    if (event.button !== 0) return null;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const panel = layout.peek()[id];
    if (!panel) return null;
    activePanel.value = { id, kind };
    edgePanel.value = id;
    layout.value = { ...layout.peek(), [id]: { ...panel, zIndex: ++zIndex } };
    const session = {
        id, kind, x: event.clientX, y: event.clientY,
        clientX: event.clientX, clientY: event.clientY,
        left: number(panel.left), top: number(panel.top),
        width: number(panel.width), height: number(panel.height),
        scrollLeft: workspace?.scrollLeft || 0,
        scrollTop: workspace?.scrollTop || 0,
        frame: null
    };
    if (kind === 'move') session.frame = requestAnimationFrame(() => autoScroll(session));
    return session;
}

export function movePanelInteraction(session, event) {
    if (!session || activePanel.peek()?.id !== session.id) return;
    event.preventDefault();
    session.clientX = event.clientX;
    session.clientY = event.clientY;
    applyInteraction(session);
}

export function endPanelInteraction(session) {
    if (!session) return;
    if (session.frame !== null) cancelAnimationFrame(session.frame);
    let next = layout.peek();
    const snap = snapIndicator.peek();
    if (session.kind === 'move' && snap) {
        next = { ...next, [session.id]: { ...next[session.id], left: snap.left, top: snap.top } };
    }
    layout.value = resolvePanelCollisions(next, session.id);
    activePanel.value = null;
    edgePanel.value = null;
    snapIndicator.value = null;
    writeLayout();
    triggerRedraw();
    window.dispatchEvent(new Event('resize'));
}

export function resetAllPanelLayouts() {
    for (let index = localStorage.length - 1; index >= 0; index--) {
        const key = localStorage.key(index);
        if (key?.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
    }
    layoutKey = '';
    refreshPanelLayout(true);
    window.dispatchEvent(new Event('resize'));
}

export function initPanelLayoutManager() {
    if (!stopLayoutEffect) stopLayoutEffect = subscribeState(() => refreshPanelLayout(true));
}
