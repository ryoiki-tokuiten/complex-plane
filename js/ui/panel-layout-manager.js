import { state, subscribeState } from '../store/state.js';
import { setupVisualParameters } from '../utils/dom-utils.js';
import { requestDomainRedraw } from '../rendering/redraw-scheduler.js';

function triggerLayoutRedraw() {
    if (typeof window === 'undefined') return;
    setupVisualParameters(false, false);
    requestDomainRedraw(true);
}

let initialized = false;
let highestZIndex = 10;
let lastModeKey = null;

const MIN_WIDTH = 220;
const MAX_WIDTH = 2560;
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 2000;
const COLLISION_GAP = 24;
const LAYOUT_PADDING = 0;
const LAYOUT_VERSION = 'v8';

const isVerticalLayout = () => {
    if (typeof document === 'undefined') return false;
    if (document.body?.classList?.contains('vertical-layout')) return true;
    if (Boolean(document.querySelector?.('.application-root')?.classList?.contains('vertical-layout'))) return true;
    if (state?.verticalLayoutEnabled === true) return true;
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('complex_verticalLayoutEnabled') === 'true') return true;
    } catch (e) {}
    const container = document.querySelector?.('.canvas-row.two-column-layout');
    if (container && typeof window !== 'undefined') {
        const dir = window.getComputedStyle?.(container)?.flexDirection;
        if (dir === 'column') return true;
    }
    return false;
};

const panelRect = (left, top, width, height) => ({
    left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`
});

function normalPanelSize(containerWidth, containerHeight) {
    const isVert = isVerticalLayout();
    return {
        width: Math.max(MIN_WIDTH, isVert ? containerWidth - LAYOUT_PADDING * 2 : Math.floor((Math.max(480, containerWidth - LAYOUT_PADDING * 2) - COLLISION_GAP) / 2)),
        height: Math.max(MIN_HEIGHT, isVert ? Math.floor((Math.max(400, containerHeight - LAYOUT_PADDING * 2) - COLLISION_GAP) / 2) : containerHeight - LAYOUT_PADDING * 2)
    };
}

export function updateWorkspaceBounds(container, isInteracting = false, activeDragBounds = null) {
    if (!container) container = document.querySelector('.canvas-row.two-column-layout');
    if (!container) return;

    const visiblePanels = [...container.children].filter(
        el => !el.classList?.contains('hidden') && !el.classList?.contains('workspace-bounds-extender') && !el.classList?.contains('panel-snap-indicator') && Boolean(el.id)
    );

    let maxRight = 0;
    let maxBottom = 0;

    for (const panel of visiblePanels) {
        const styleLeft = panel.style?.left !== undefined && panel.style?.left !== '' ? parseInt(panel.style.left, 10) : NaN;
        const styleTop = panel.style?.top !== undefined && panel.style?.top !== '' ? parseInt(panel.style.top, 10) : NaN;
        const left = Number.isFinite(styleLeft) ? styleLeft : (panel.offsetLeft || 0);
        const top = Number.isFinite(styleTop) ? styleTop : (panel.offsetTop || 0);
        const right = left + (parseInt(panel.style?.width, 10) || panel.offsetWidth || 0);
        const bottom = top + (parseInt(panel.style?.height, 10) || panel.offsetHeight || 0);
        if (right > maxRight) maxRight = right;
        if (bottom > maxBottom) maxBottom = bottom;
    }

    if (activeDragBounds) {
        if (activeDragBounds.right > maxRight) maxRight = activeDragBounds.right;
        if (activeDragBounds.bottom > maxBottom) maxBottom = activeDragBounds.bottom;
    }

    const extender = container.querySelector('.workspace-bounds-extender');
    if (!extender) throw new Error('Workspace bounds extender is missing.');

    const clientW = container.clientWidth || window.innerWidth || 1200;
    const clientH = container.clientHeight || window.innerHeight || 700;

    if (!isInteracting && maxRight <= clientW && maxBottom <= clientH) {
        extender.style.left = '0px';
        extender.style.top = '0px';
        return;
    }

    const extra = isInteracting ? 2000 : 24;
    extender.style.left = `${(maxRight > clientW || isInteracting) ? (maxRight + extra) : 0}px`;
    extender.style.top = `${(maxBottom > clientH || isInteracting) ? (maxBottom + extra) : 0}px`;
}

export function resolveCollisions(activePanel = null, container = null, save = false) {
    if (!container && typeof document !== 'undefined') {
        container = document.querySelector('.canvas-row.two-column-layout');
    }
    if (!container) return;

    const allPanels = [...container.children].filter(
        child => child && !child.classList.contains('hidden') &&
                 !child.classList.contains('workspace-bounds-extender') &&
                 !child.classList.contains('panel-snap-indicator') &&
                 Boolean(child.id)
    );
    if (allPanels.length <= 1) {
        if (save) savePanelLayout(container);
        return;
    }

    const GAP = COLLISION_GAP;
    const PADDING = LAYOUT_PADDING;
    const isVertical = isVerticalLayout();

    const getRect = el => {
        const styleLeft = el.style?.left !== undefined && el.style?.left !== '' ? parseInt(el.style.left, 10) : NaN;
        const styleTop = el.style?.top !== undefined && el.style?.top !== '' ? parseInt(el.style.top, 10) : NaN;
        const left = Number.isFinite(styleLeft) ? styleLeft : (el.offsetLeft || 0);
        const top = Number.isFinite(styleTop) ? styleTop : (el.offsetTop || 0);
        const width = parseInt(el.style?.width, 10) || el.offsetWidth || 500;
        const height = parseInt(el.style?.height, 10) || el.offsetHeight || 400;
        return { el, id: el.id, left, top, width, height, right: left + width, bottom: top + height };
    };

    let boxes = allPanels.map(getRect);

    // Phase 1: Directional Push Phase (Strict non-overlap enforcement)
    for (let pass = 0; pass < 8; pass++) {
        let anyMoved = false;
        const activeRect = activePanel ? (boxes.find(b => b.el === activePanel) || null) : null;

        if (activeRect) {
            for (const other of boxes) {
                if (other.el === activeRect.el) continue;
                const overlapX = Math.min(activeRect.right, other.right) - Math.max(activeRect.left, other.left);
                const overlapY = Math.min(activeRect.bottom, other.bottom) - Math.max(activeRect.top, other.top);
                if (overlapX > 0 && overlapY > 0) {
                    if (overlapX > overlapY && (isVertical || other.top >= activeRect.top + Math.floor(activeRect.height * 0.4))) {
                        other.top = activeRect.bottom + GAP;
                        other.bottom = other.top + other.height;
                    } else {
                        other.left = activeRect.right + GAP;
                        other.right = other.left + other.width;
                    }
                    anyMoved = true;
                }
            }
        }

        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                const bA = boxes[i];
                const bB = boxes[j];
                if (activeRect && (bA.el === activePanel || bB.el === activePanel)) continue;
                const overlapX = Math.min(bA.right, bB.right) - Math.max(bA.left, bB.left);
                const overlapY = Math.min(bA.bottom, bB.bottom) - Math.max(bA.top, bB.top);
                if (overlapX > 0 && overlapY > 0) {
                    let pusher = bA;
                    let target = bB;
                    if (isVertical) {
                        if (bA.top > bB.top) { pusher = bB; target = bA; }
                        target.top = pusher.bottom + GAP;
                        target.bottom = target.top + target.height;
                    } else {
                        if (bA.left > bB.left || (bA.left === bB.left && bA.top > bB.top)) { pusher = bB; target = bA; }
                        if (overlapX > overlapY && target.top >= pusher.top + Math.floor(pusher.height * 0.4)) {
                            target.top = pusher.bottom + GAP;
                            target.bottom = target.top + target.height;
                        } else {
                            target.left = pusher.right + GAP;
                            target.right = target.left + target.width;
                        }
                    }
                    anyMoved = true;
                }
            }
        }
        if (!anyMoved) break;
    }

    // Phase 2: Gravity Pull towards Top-Left (Compacting blocks to touch borders)
    if (isVertical) {
        boxes.sort((a, b) => a.top - b.top);
        for (const b of boxes) {
            let barrierY = PADDING;
            for (const other of boxes) {
                if (other === b) continue;
                const hOverlap = Math.min(b.right, other.right) - Math.max(b.left, other.left);
                if (hOverlap > 0 && other.bottom <= b.top + GAP) barrierY = Math.max(barrierY, other.bottom + GAP);
            }
            if (barrierY < b.top) {
                b.top = barrierY;
                b.bottom = b.top + b.height;
            }
        }
    } else {
        // Pass 2A: Pull Left
        boxes.sort((a, b) => a.left - b.left || a.top - b.top);
        for (const b of boxes) {
            let barrierX = PADDING;
            for (const other of boxes) {
                if (other === b) continue;
                const vOverlap = Math.min(b.bottom, other.bottom) - Math.max(b.top, other.top);
                if (vOverlap > 0 && other.right <= b.left + GAP) barrierX = Math.max(barrierX, other.right + GAP);
            }
            if (barrierX < b.left) {
                b.left = barrierX;
                b.right = b.left + b.width;
            }
        }
        // Pass 2B: Pull Up
        boxes.sort((a, b) => a.top - b.top || a.left - b.left);
        for (const b of boxes) {
            let barrierY = PADDING;
            for (const other of boxes) {
                if (other === b) continue;
                const hOverlap = Math.min(b.right, other.right) - Math.max(b.left, other.left);
                if (hOverlap > 0 && other.bottom <= b.top + GAP) barrierY = Math.max(barrierY, other.bottom + GAP);
            }
            if (barrierY < b.top) {
                b.top = barrierY;
                b.bottom = b.top + b.height;
            }
        }
    }

    for (const b of boxes) {
        b.el.style.left = `${b.left}px`;
        b.el.style.top = `${b.top}px`;
    }
    if (save) {
        savePanelLayout(container);
    }
}

function calculateSnapTarget(panel, container, rawLeft, rawTop) {
    if (!container || !panel) return null;
    const siblings = [...container.children].filter(
        c => c !== panel && !c.classList.contains('hidden') && !c.classList.contains('workspace-bounds-extender') && !c.classList.contains('panel-snap-indicator') && Boolean(c.id)
    );
    const pW = parseInt(panel.style.width, 10) || panel.offsetWidth || 500;
    const pH = parseInt(panel.style.height, 10) || panel.offsetHeight || 400;
    const GAP = COLLISION_GAP;
    const PADDING = LAYOUT_PADDING;
    const THRESHOLD = 28;

    const xCandidates = [PADDING];
    const yCandidates = [PADDING];

    for (const s of siblings) {
        const sL = s.offsetLeft || parseInt(s.style.left, 10) || 0;
        const sT = s.offsetTop || parseInt(s.style.top, 10) || 0;
        const sW = s.offsetWidth || parseInt(s.style.width, 10) || 500;
        const sH = s.offsetHeight || parseInt(s.style.height, 10) || 400;
        xCandidates.push(sL + sW + GAP, sL - pW - GAP, sL);
        yCandidates.push(sT + sH + GAP, sT - pH - GAP, sT);
    }

    let snapX = rawLeft;
    let minDiffX = THRESHOLD + 1;
    for (const cand of xCandidates) {
        if (cand < PADDING) continue;
        const diff = Math.abs(rawLeft - cand);
        if (diff <= THRESHOLD && diff < minDiffX) { minDiffX = diff; snapX = cand; }
    }

    let snapY = rawTop;
    let minDiffY = THRESHOLD + 1;
    for (const cand of yCandidates) {
        if (cand < PADDING) continue;
        const diff = Math.abs(rawTop - cand);
        if (diff <= THRESHOLD && diff < minDiffY) { minDiffY = diff; snapY = cand; }
    }

    return (snapX !== rawLeft || snapY !== rawTop) ? { left: snapX, top: snapY, width: pW, height: pH } : null;
}

function updateSnapIndicator(container, target) {
    const ind = container?.querySelector('#panel_snap_indicator');
    if (!ind) return;
    if (target) {
        Object.assign(ind.style, {
            left: `${target.left}px`,
            top: `${target.top}px`,
            width: `${target.width}px`,
            height: `${target.height}px`,
            display: 'block'
        });
        ind.classList.add('is-active');
    } else {
        ind.classList.remove('is-active');
        ind.style.display = 'none';
    }
}

const hideSnapIndicator = container => updateSnapIndicator(container, null);

const getCurrentLayoutMode = () => state?.laplaceModeEnabled ? 'laplace' : (state?.realPlotsEnabled ? 'real_plots' : 'normal');

const getLayoutStorageKey = () => `complex_panelLayout_${getCurrentLayoutMode()}_${isVerticalLayout() ? 'vert' : 'horiz'}_${LAYOUT_VERSION}`;

function savePanelLayout(container) {
    if (!container) return;
    const panels = [...container.children].filter(el =>
        !el.classList.contains('hidden') && (
            el.classList.contains('plane-column') || el.classList.contains('auxiliary-surface-column') ||
            el.id === 'graph_column' || el.id === 'real_plots_column' || el.id === 'contour_2d_column'
        )
    );
    const layout = {};
    for (const panel of panels) {
        if (panel.id && panel.style.left && panel.style.top) {
            layout[panel.id] = { left: panel.style.left, top: panel.style.top, width: panel.style.width, height: panel.style.height };
        }
    }
    try { localStorage.setItem(getLayoutStorageKey(), JSON.stringify(layout)); } catch (e) {}
}

export function positionContour2DPanel(container) {
    if (!container && typeof document !== 'undefined') {
        container = document.querySelector('.canvas-row.two-column-layout');
    }
    if (!container) return;

    const contourPanel = container.querySelector('#contour_2d_column');
    if (!contourPanel) return;

    const isVert = isVerticalLayout();
    const clientW = container.clientWidth || window.innerWidth || 1200;
    const clientH = container.clientHeight || window.innerHeight || 700;
    const { width, height } = normalPanelSize(clientW, clientH);

    contourPanel.style.width = `${width}px`;
    contourPanel.style.height = `${height}px`;

    const mode = getCurrentLayoutMode();
    if (mode === 'real_plots') {
        const realPlot = container.querySelector('#real_plots_column');
        if (realPlot) {
            realPlot.style.left = `${LAYOUT_PADDING}px`;
            realPlot.style.top = `${LAYOUT_PADDING}px`;
            realPlot.style.width = `${width}px`;
            realPlot.style.height = `${height}px`;
        }
        if (isVert) {
            contourPanel.style.left = `${LAYOUT_PADDING}px`;
            contourPanel.style.top = `${LAYOUT_PADDING + height + COLLISION_GAP}px`;
        } else {
            contourPanel.style.left = `${LAYOUT_PADDING + width + COLLISION_GAP}px`;
            contourPanel.style.top = `${LAYOUT_PADDING}px`;
        }
    } else {
        const slot = findNextAvailableSlot(container, contourPanel, width, height);
        contourPanel.style.left = slot.left;
        contourPanel.style.top = slot.top;
    }

    if (contourPanel.dataset) {
        contourPanel.dataset.layoutInitialized = `${mode}_${isVert ? 'vert' : 'horiz'}_${Boolean(state?.show2DContourPlot)}_${Boolean(state?.graphViewEnabled)}`;
    }
    resolveCollisions(contourPanel, container);
    updateWorkspaceBounds(container, false);
    triggerLayoutRedraw();
}

export function positionNewPanel(panel, container) {
    if (!container && typeof document !== 'undefined') {
        container = document.querySelector('.canvas-row.two-column-layout');
    }
    if (!container || !panel) return;

    if (panel.id === 'contour_2d_column') {
        positionContour2DPanel(container);
        return;
    }

    const isVert = isVerticalLayout();
    const clientW = container.clientWidth || window.innerWidth || 1200;
    const clientH = container.clientHeight || window.innerHeight || 700;
    const { width, height } = normalPanelSize(clientW, clientH);

    if (!panel.style.width) panel.style.width = `${width}px`;
    if (!panel.style.height) panel.style.height = `${height}px`;

    const pW = parseInt(panel.style.width, 10) || width;
    const pH = parseInt(panel.style.height, 10) || height;

    const slot = findNextAvailableSlot(container, panel, pW, pH);
    panel.style.left = slot.left;
    panel.style.top = slot.top;
    if (panel.dataset) {
        panel.dataset.layoutInitialized = `${getCurrentLayoutMode()}_${isVert ? 'vert' : 'horiz'}_${Boolean(state?.show2DContourPlot)}_${Boolean(state?.graphViewEnabled)}`;
    }

    resolveCollisions(panel, container);
    updateWorkspaceBounds(container, false);
    triggerLayoutRedraw();
}

export function resetAllPanelLayouts() {
    try {
        if (typeof localStorage !== 'undefined') {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && (k.startsWith('complex_panelLayout_') || k.includes('panelLayout'))) keys.push(k);
            }
            keys.forEach(k => localStorage.removeItem(k));
        }
    } catch (e) {}

    const container = typeof document !== 'undefined' ? document.querySelector('.canvas-row.two-column-layout') : null;
    if (container) {
        lastModeKey = null;
        [...container.children].forEach(p => {
            delete p.dataset.layoutInitialized;
            p.style.left = ''; p.style.top = ''; p.style.width = ''; p.style.height = '';
        });
        initializeDefaultPanelPositions(container);
        updateWorkspaceBounds(container, false);
        triggerLayoutRedraw();
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('resize'));
        }
    }
}

export function computeRealPlotsLayout(containerWidth, containerHeight) {
    if (!state?.show2DContourPlot) {
        return {
            real_plots_column: panelRect(
                LAYOUT_PADDING, LAYOUT_PADDING,
                Math.max(300, containerWidth - LAYOUT_PADDING * 2),
                Math.max(300, containerHeight - LAYOUT_PADDING * 2)
            )
        };
    }
    const { width, height } = normalPanelSize(containerWidth, containerHeight);
    return {
        real_plots_column: panelRect(LAYOUT_PADDING, LAYOUT_PADDING, width, height),
        contour_2d_column: isVerticalLayout()
            ? panelRect(LAYOUT_PADDING, LAYOUT_PADDING + height + COLLISION_GAP, width, height)
            : panelRect(LAYOUT_PADDING + width + COLLISION_GAP, LAYOUT_PADDING, width, height)
    };
}

export function computeNormalModeLayout(containerWidth, containerHeight) {
    const isVert = isVerticalLayout();
    const { width, height } = normalPanelSize(containerWidth, containerHeight);
    const layout = {};
    const pos = i => panelRect(
        isVert ? LAYOUT_PADDING : LAYOUT_PADDING + i * (width + COLLISION_GAP),
        isVert ? LAYOUT_PADDING + i * (height + COLLISION_GAP) : LAYOUT_PADDING,
        width, height
    );
    layout.z_plane_column = pos(0);
    layout.w_plane_column = pos(1);
    layout.graph_column = pos(2);
    for (let i = 1; i <= 32; i++) layout[`w_plane_column_${i}`] = pos(i + 1);
    return layout;
}

export function computeLaplaceModeLayout(containerWidth, containerHeight) {
    const isVert = isVerticalLayout();
    const pad = LAYOUT_PADDING;
    const gap = COLLISION_GAP;

    if (isVert) {
        const panelWidth = Math.max(220, containerWidth - pad * 2);
        const availHeight = Math.max(400, containerHeight - pad * 2);
        const panelHeight = Math.max(180, Math.floor((availHeight - gap) / 2));
        const halfWidth = Math.max(180, Math.floor((panelWidth - gap) / 2));
        const topRow1 = pad;
        const topRow2 = topRow1 + panelHeight + gap;
        const row3Height = Math.max(340, Math.floor(panelHeight * 0.85));
        const topRow3 = topRow2 + panelHeight + gap;
        const row4Height = Math.max(280, Math.floor(panelHeight * 0.70));
        const topRow4 = topRow3 + row3Height + gap;
        const row5Height = Math.max(500, Math.floor(panelHeight * 1.4));
        const topRow5 = topRow4 + row4Height + gap;

        return {
            z_plane_column: panelRect(pad, topRow1, panelWidth, panelHeight),
            w_plane_column: panelRect(pad, topRow2, panelWidth, panelHeight),
            fourier_3d_column: panelRect(pad, topRow3, panelWidth, row3Height),
            laplace_com_column: panelRect(pad, topRow4, halfWidth, row4Height),
            laplace_spectrum_column: panelRect(pad + halfWidth + gap, topRow4, halfWidth, row4Height),
            laplace_3d_column: panelRect(pad, topRow5, panelWidth, row5Height)
        };
    }

    const availWidth = Math.max(800, containerWidth - pad * 2);
    const trackWidth = Math.max(460, Math.floor((availWidth - gap) / 2));
    const combinedWidth = trackWidth * 2 + gap;
    const screenHeight = Math.max(480, containerHeight - pad * 2);
    const row2Height = Math.max(380, Math.floor(screenHeight * 0.75));
    const row3Height = Math.max(340, Math.floor(screenHeight * 0.60));
    const track1Left = pad;
    const track2Left = pad + trackWidth + gap;
    const track3Left = pad + combinedWidth + gap;
    const topRow1 = pad;
    const topRow2 = topRow1 + screenHeight + gap;
    const topRow3 = topRow2 + row2Height + gap;

    return {
        z_plane_column: panelRect(track1Left, topRow1, trackWidth, screenHeight),
        w_plane_column: panelRect(track2Left, topRow1, trackWidth, screenHeight),
        fourier_3d_column: panelRect(track1Left, topRow2, combinedWidth, row2Height),
        laplace_com_column: panelRect(track1Left, topRow3, trackWidth, row3Height),
        laplace_spectrum_column: panelRect(track2Left, topRow3, trackWidth, row3Height),
        laplace_3d_column: panelRect(track3Left, topRow1, Math.max(680, trackWidth), Math.max(700, topRow3 + row3Height - pad))
    };
}

function layoutForMode(containerWidth, containerHeight, mode = getCurrentLayoutMode()) {
    if (mode === 'laplace') return computeLaplaceModeLayout(containerWidth, containerHeight);
    if (mode === 'real_plots') return computeRealPlotsLayout(containerWidth, containerHeight);
    return computeNormalModeLayout(containerWidth, containerHeight);
}

export function findNextAvailableSlot(container, panel, targetWidth, targetHeight) {
    const isVert = isVerticalLayout();
    const visible = container?.children ? [...container.children].filter(
        c => c !== panel && !c.classList.contains('hidden') && !c.classList.contains('workspace-bounds-extender') && !c.classList.contains('panel-snap-indicator') && Boolean(c.id)
    ) : [];

    if (visible.length === 0) return { left: `${LAYOUT_PADDING}px`, top: `${LAYOUT_PADDING}px` };

    let maxBottom = 0, maxRight = 0, minTop = Infinity;
    for (const sib of visible) {
        const styleL = sib.style?.left !== undefined && sib.style?.left !== '' ? parseInt(sib.style.left, 10) : NaN;
        const styleT = sib.style?.top !== undefined && sib.style?.top !== '' ? parseInt(sib.style.top, 10) : NaN;
        const l = Number.isFinite(styleL) ? styleL : (sib.offsetLeft || 0);
        const t = Number.isFinite(styleT) ? styleT : (sib.offsetTop || 0);
        const w = parseInt(sib.style?.width, 10) || sib.offsetWidth || targetWidth || 540;
        const h = parseInt(sib.style?.height, 10) || sib.offsetHeight || targetHeight || 420;
        if (t + h > maxBottom) maxBottom = t + h;
        if (l + w > maxRight) maxRight = l + w;
        if (t < minTop) minTop = t;
    }
    if (minTop === Infinity) minTop = LAYOUT_PADDING;
    return isVert
        ? { left: `${LAYOUT_PADDING}px`, top: `${maxBottom + COLLISION_GAP}px` }
        : { left: `${maxRight + COLLISION_GAP}px`, top: `${minTop}px` };
}

function initializeDefaultPanelPositions(container) {
    if (!container) container = document.querySelector('.canvas-row.two-column-layout');
    if (!container) return;

    const visiblePanels = [...container.children].filter(
        el => !el.classList.contains('hidden') && !el.classList.contains('workspace-bounds-extender') && !el.classList.contains('panel-snap-indicator') && Boolean(el.id)
    );
    const visibleIds = visiblePanels.map(p => p.id).sort().join(',');

    const mode = getCurrentLayoutMode();
    const isVert = isVerticalLayout();
    const currentModeKey = `${mode}_${isVert ? 'vert' : 'horiz'}_${visibleIds}`;

    if (lastModeKey !== currentModeKey) {
        [...container.children].forEach(p => {
            if (p.dataset) delete p.dataset.layoutInitialized;
            p.style.left = '';
            p.style.top = '';
            p.style.width = '';
            p.style.height = '';
        });
        lastModeKey = currentModeKey;
    }

    const clientW = container.clientWidth || window.innerWidth || 1200;
    const clientH = container.clientHeight || window.innerHeight || 700;
    const defaultLayoutMap = layoutForMode(clientW, clientH, mode);

    let savedLayout = null;
    try {
        const stored = localStorage.getItem(getLayoutStorageKey());
        if (stored) savedLayout = JSON.parse(stored);
    } catch (e) {}

    for (const panel of visiblePanels) {
        if (panel.dataset?.layoutInitialized === currentModeKey && panel.style.left && panel.style.top) continue;
        if (panel.dataset) panel.dataset.layoutInitialized = currentModeKey;

        if (panel.id === 'contour_2d_column' && mode !== 'real_plots') {
            positionContour2DPanel(container);
            continue;
        }

        if (panel.id && savedLayout?.[panel.id]) {
            Object.assign(panel.style, savedLayout[panel.id]);
            continue;
        }

        if (panel.id && defaultLayoutMap?.[panel.id]) {
            Object.assign(panel.style, defaultLayoutMap[panel.id]);
            continue;
        }

        const size = normalPanelSize(clientW, clientH);
        panel.style.width = `${size.width}px`;
        panel.style.height = `${size.height}px`;
        const slot = findNextAvailableSlot(container, panel, size.width, size.height);
        panel.style.left = slot.left;
        panel.style.top = slot.top;
    }

    resolveCollisions(null, container);
    updateWorkspaceBounds(container);
}

function bindResizeEvents(resizeBtn, panel) {
    let startX = 0, startY = 0, startW = 0, startH = 0;
    let origScrollL = 0, origScrollT = 0, isResizing = false;

    const onPointerMove = e => {
        if (!isResizing) return;
        e.preventDefault();
        const container = panel.closest('.two-column-layout');
        const dX = (e.clientX - startX) + ((container?.scrollLeft || 0) - origScrollL);
        const dY = (e.clientY - startY) + ((container?.scrollTop || 0) - origScrollT);
        const newW = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(startW + dX)));
        const newH = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(startH + dY)));
        panel.style.width = `${newW}px`;
        panel.style.height = `${newH}px`;
        if (container) {
            const pL = panel.offsetLeft || parseInt(panel.style.left, 10) || 0;
            const pT = panel.offsetTop || parseInt(panel.style.top, 10) || 0;
            updateWorkspaceBounds(container, true, { right: pL + newW + 2000, bottom: pT + newH + 2000 });
        }
        triggerLayoutRedraw();
    };

    const onPointerUp = () => {
        if (!isResizing) return;
        isResizing = false;
        panel.classList.remove('is-resizing');
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', onPointerUp, true);
        window.removeEventListener('pointercancel', onPointerUp, true);

        const container = panel.closest('.two-column-layout');
        if (container) {
            resolveCollisions(panel, container);
            updateWorkspaceBounds(container, false);
            savePanelLayout(container);
        }
        triggerLayoutRedraw();
        window.dispatchEvent(new Event('resize'));
    };

    resizeBtn.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        panel.style.zIndex = `${++highestZIndex}`;
        isResizing = true;
        panel.classList.add('is-resizing');
        const container = panel.closest('.two-column-layout');
        startX = e.clientX; startY = e.clientY;
        startW = panel.offsetWidth; startH = panel.offsetHeight;
        origScrollL = container?.scrollLeft || 0;
        origScrollT = container?.scrollTop || 0;
        window.addEventListener('pointermove', onPointerMove, { passive: false, capture: true });
        window.addEventListener('pointerup', onPointerUp, { capture: true });
        window.addEventListener('pointercancel', onPointerUp, { capture: true });
    });
}

function bindGripEvents(triggerEl, panel) {
    let startX = 0, startY = 0, origL = 0, origT = 0;
    let origScrollL = 0, origScrollT = 0, isDragging = false;
    let clientX = 0, clientY = 0, autoScrollRaf = null;

    const autoScrollLoop = () => {
        if (!isDragging) return;
        const container = panel.closest('.two-column-layout');
        if (container) {
            const rect = container.getBoundingClientRect();
            let dx = 0, dy = 0;
            if (clientX < rect.left + 45 && container.scrollLeft > 0) dx = -12;
            else if (clientX > rect.right - 45) dx = 12;
            if (clientY < rect.top + 45 && container.scrollTop > 0) dy = -12;
            else if (clientY > rect.bottom - 45) dy = 12;

            if (dx !== 0 || dy !== 0) {
                container.scrollLeft += dx;
                container.scrollTop += dy;
                const newL = Math.max(0, Math.round(origL + (clientX - startX) + (container.scrollLeft - origScrollL)));
                const newT = Math.max(0, Math.round(origT + (clientY - startY) + (container.scrollTop - origScrollT)));
                panel.style.left = `${newL}px`;
                panel.style.top = `${newT}px`;
                updateWorkspaceBounds(container, true, {
                    right: newL + (panel.offsetWidth || 500) + 2000,
                    bottom: newT + (panel.offsetHeight || 400) + 2000
                });
            }
        }
        autoScrollRaf = requestAnimationFrame(autoScrollLoop);
    };

    const onPointerMove = e => {
        if (!isDragging) return;
        e.preventDefault();
        clientX = e.clientX; clientY = e.clientY;
        const container = panel.closest('.two-column-layout');
        const newL = Math.max(0, Math.round(origL + (e.clientX - startX) + ((container?.scrollLeft || 0) - origScrollL)));
        const newT = Math.max(0, Math.round(origT + (e.clientY - startY) + ((container?.scrollTop || 0) - origScrollT)));
        panel.style.left = `${newL}px`;
        panel.style.top = `${newT}px`;

        if (container) {
            const snap = calculateSnapTarget(panel, container, newL, newT);
            if (snap) updateSnapIndicator(container, snap);
            else hideSnapIndicator(container);
            updateWorkspaceBounds(container, true, {
                right: newL + (panel.offsetWidth || 500) + 2000,
                bottom: newT + (panel.offsetHeight || 400) + 2000
            });
        }
    };

    const onPointerUp = () => {
        if (!isDragging) return;
        isDragging = false;
        if (autoScrollRaf) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = null; }
        panel.classList.remove('is-dragging');
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', onPointerUp, true);
        window.removeEventListener('pointercancel', onPointerUp, true);

        const container = panel.closest('.two-column-layout');
        if (container) {
            const curL = parseInt(panel.style.left, 10) || panel.offsetLeft || 0;
            const curT = parseInt(panel.style.top, 10) || panel.offsetTop || 0;
            const snap = calculateSnapTarget(panel, container, curL, curT);
            if (snap) {
                panel.style.left = `${snap.left}px`;
                panel.style.top = `${snap.top}px`;
            }
            hideSnapIndicator(container);
            resolveCollisions(panel, container);
            updateWorkspaceBounds(container, false);
            savePanelLayout(container);
        }
        triggerLayoutRedraw();
        window.dispatchEvent(new Event('resize'));
    };

    triggerEl.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        panel.style.zIndex = `${++highestZIndex}`;
        isDragging = true;
        panel.classList.add('is-dragging');
        const container = panel.closest('.two-column-layout');
        startX = e.clientX; startY = e.clientY;
        clientX = e.clientX; clientY = e.clientY;
        origL = panel.offsetLeft || parseInt(panel.style.left, 10) || 0;
        origT = panel.offsetTop || parseInt(panel.style.top, 10) || 0;
        origScrollL = container?.scrollLeft || 0;
        origScrollT = container?.scrollTop || 0;
        window.addEventListener('pointermove', onPointerMove, { passive: false, capture: true });
        window.addEventListener('pointerup', onPointerUp, { capture: true });
        window.addEventListener('pointercancel', onPointerUp, { capture: true });
        if (autoScrollRaf) cancelAnimationFrame(autoScrollRaf);
        autoScrollRaf = requestAnimationFrame(autoScrollLoop);
    });
}

function createEdgeHandle(panel) {
    if (!panel || !panel.id || panel.classList.contains('workspace-bounds-extender') ||
        panel.classList.contains('panel-snap-indicator') || panel.dataset.handlesBound === 'true') return;
    const bar = panel.querySelector('.panel-edge-handle-bar');
    const resizeBtn = bar?.querySelector('.panel-resize-btn');
    const gripBtn = bar?.querySelector('.panel-grip-btn');
    if (!bar || !resizeBtn || !gripBtn) throw new Error(`Panel controls are missing for ${panel.id}.`);
    panel.dataset.handlesBound = 'true';

    bindResizeEvents(resizeBtn, panel);
    bindGripEvents(gripBtn, panel);

    panel.addEventListener('pointerdown', () => { panel.style.zIndex = `${++highestZIndex}`; });
    panel.addEventListener('pointermove', e => {
        const rect = panel.getBoundingClientRect();
        if ((rect.right - e.clientX < 60) || (rect.bottom - e.clientY < 60)) {
            panel.classList.add('show-edge-handle');
        } else {
            panel.classList.remove('show-edge-handle');
        }
    });
    panel.addEventListener('pointerleave', () => { panel.classList.remove('show-edge-handle'); });

    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
}

let isRefreshing = false;
let refreshScheduled = false;

export function refreshPanelEdgeHandles(sync = false) {
    if (sync) { executeRefresh(); return; }
    if (isRefreshing || refreshScheduled) return;
    refreshScheduled = true;
    requestAnimationFrame(() => {
        refreshScheduled = false;
        executeRefresh();
    });
}

function executeRefresh() {
    isRefreshing = true;
    try {
        const container = document.querySelector('.canvas-row.two-column-layout');
        if (!container) return;
        initializeDefaultPanelPositions(container);
        const panels = [...container.children].filter(
            el => !el.classList.contains('workspace-bounds-extender') && !el.classList.contains('panel-snap-indicator') && Boolean(el.id)
        );
        panels.forEach(createEdgeHandle);
        resolveCollisions(null, container);
        updateWorkspaceBounds(container, false);
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    } finally {
        isRefreshing = false;
    }
}

export function refreshPanelLayout() {
    const row = document.querySelector('.canvas-row.two-column-layout');
    if (!row) return;
    initializeDefaultPanelPositions(row);
    resolveCollisions(null, row);
    updateWorkspaceBounds(row, false);
}

export function initPanelLayoutManager() {
    if (initialized) return;
    initialized = true;
    refreshPanelEdgeHandles();
    const container = document.querySelector('.canvas-row.two-column-layout');
    if (container && typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(mutations => {
            const newlyAppearedPanels = [];
            let hasChange = false;
            for (const m of mutations) {
                if (m.type === 'childList') {
                    m.addedNodes.forEach(node => {
                        if (node?.id && (node.classList?.contains('plane-column') || node.classList?.contains('auxiliary-surface-column') || node.id.includes('column')) && !node.classList?.contains('hidden')) {
                            newlyAppearedPanels.push(node);
                        }
                    });
                    hasChange = true;
                } else if (m.type === 'attributes' && m.attributeName === 'class') {
                    const target = m.target;
                    if (target?.id && (target.classList?.contains('plane-column') || target.classList?.contains('auxiliary-surface-column') || target.id.includes('column'))) {
                        const wasHidden = (m.oldValue || '').includes('hidden');
                        const isHidden = (target.className || '').includes('hidden');
                        if (wasHidden && !isHidden) {
                            newlyAppearedPanels.push(target);
                        }
                        if (wasHidden !== isHidden) hasChange = true;
                    }
                }
            }
            if (newlyAppearedPanels.length > 0) {
                const mode = getCurrentLayoutMode();
                const clientW = container.clientWidth || window.innerWidth || 1200;
                const clientH = container.clientHeight || window.innerHeight || 700;
                const defaultMap = layoutForMode(clientW, clientH, mode);

                let needsModeInit = false;
                for (const panel of newlyAppearedPanels) {
                    if (panel.id && defaultMap[panel.id]) {
                        needsModeInit = true;
                    } else {
                        positionNewPanel(panel, container);
                    }
                }
                if (needsModeInit) {
                    initializeDefaultPanelPositions(container);
                    resolveCollisions(null, container);
                    updateWorkspaceBounds(container, false);
                    triggerLayoutRedraw();
                }
                refreshPanelEdgeHandles();
            } else if (hasChange) {
                initializeDefaultPanelPositions(container);
                resolveCollisions(null, container);
                updateWorkspaceBounds(container, false);
                triggerLayoutRedraw();
                refreshPanelEdgeHandles();
            }
        });
        observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    }

    subscribeState(() => {
        const row = document.querySelector('.canvas-row.two-column-layout');
        if (!row) return;
        const isVert = Boolean(state.verticalLayoutEnabled);
        if (typeof document !== 'undefined') {
            document.body?.classList?.toggle('vertical-layout', isVert);
            document.querySelector?.('.application-root')?.classList?.toggle('vertical-layout', isVert);
        }
        lastModeKey = null;
        initializeDefaultPanelPositions(row);
        if (state.show2DContourPlot) {
            positionContour2DPanel(row);
        }
        if (state.graphViewEnabled) {
            const graph = row.querySelector('#graph_column');
            if (graph && (!graph.style.left || !graph.style.top)) {
                positionNewPanel(graph, row);
            }
        }
        resolveCollisions(null, row);
        updateWorkspaceBounds(row, false);
        triggerLayoutRedraw();
    }, ['show2DContourPlot', 'graphViewEnabled', 'realPlotsEnabled', 'riemannSurfaceEnabled', 'laplaceModeEnabled', 'verticalLayoutEnabled', 'chainingEnabled', 'chainCount']);
}
