import { state } from '../store/state.js';
import { setupVisualParameters } from '../utils/dom-utils.js';
import { requestDomainRedraw } from '../rendering/redraw-scheduler.js';

function triggerLayoutRedraw() {
    if (typeof window === 'undefined') return;
    setupVisualParameters(false, false);
    requestDomainRedraw(true);
}

let initialized = false;
let highestZIndex = 10;
let lastInitializedMode = null;

const MIN_WIDTH = 220;
const MAX_WIDTH = 2560;
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 2000;
const COLLISION_GAP = 24;
const LAYOUT_VERSION = 'v8';

export function updateWorkspaceBounds(container, isInteracting = false, activeDragBounds = null) {
    if (!container) {
        container = document.querySelector('.canvas-row.two-column-layout');
    }
    if (!container) return;

    const isLaplace = Boolean(state?.laplaceModeEnabled);
    const visiblePanels = [...container.children].filter(
        el => !el.classList?.contains('hidden') && !el.classList?.contains('workspace-bounds-extender') && Boolean(el.id)
    );

    let maxRight = 0;
    let maxBottom = 0;

    visiblePanels.forEach(panel => {
        const left = panel.offsetLeft || parseInt(panel.style.left, 10) || 0;
        const top = panel.offsetTop || parseInt(panel.style.top, 10) || 0;
        const width = panel.offsetWidth || parseInt(panel.style.width, 10) || 0;
        const height = panel.offsetHeight || parseInt(panel.style.height, 10) || 0;
        const right = left + width;
        const bottom = top + height;
        if (right > maxRight) maxRight = right;
        if (bottom > maxBottom) maxBottom = bottom;
    });

    if (activeDragBounds) {
        if (activeDragBounds.right > maxRight) maxRight = activeDragBounds.right;
        if (activeDragBounds.bottom > maxBottom) maxBottom = activeDragBounds.bottom;
    }

    let extender = container.querySelector('.workspace-bounds-extender');
    if (!extender) {
        extender = document.createElement('div');
        extender.className = 'workspace-bounds-extender';
        extender.style.position = 'absolute';
        extender.style.width = '1px';
        extender.style.height = '1px';
        extender.style.pointerEvents = 'none';
        container.appendChild(extender);
    }

    const clientW = container.clientWidth || window.innerWidth || 1200;
    const clientH = container.clientHeight || window.innerHeight || 700;

    // Normal mode with default 2 planes (or whenever all panels fit completely inside viewport without active drag):
    // If panels fit within client dimensions, keep extender at 0 to guarantee NO scrollbars!
    if (!isInteracting && maxRight <= clientW && maxBottom <= clientH) {
        extender.style.left = '0px';
        extender.style.top = '0px';
        return;
    }

    // Extend beyond container client dimensions when panels overflow or to provide generous scroll space during drag
    const extraSpace = isInteracting ? 2000 : 24;
    const neededLeft = (maxRight > clientW || isInteracting) ? (maxRight + extraSpace) : 0;
    const neededTop = (maxBottom > clientH || isInteracting) ? (maxBottom + extraSpace) : 0;

    extender.style.left = `${neededLeft}px`;
    extender.style.top = `${neededTop}px`;
}

export function resolveCollisions(activePanel, container) {
    if (!container || !activePanel) return;

    const allPanels = [...container.children].filter(
        child => !child.classList.contains('hidden') && !child.classList.contains('workspace-bounds-extender') && !child.classList.contains('panel-snap-indicator') && Boolean(child.id)
    );

    const GAP = COLLISION_GAP;

    const getRect = (el) => {
        const left = parseInt(el.style.left, 10) || el.offsetLeft || 0;
        const top = parseInt(el.style.top, 10) || el.offsetTop || 0;
        const width = parseInt(el.style.width, 10) || el.offsetWidth || 500;
        const height = parseInt(el.style.height, 10) || el.offsetHeight || 400;
        return { el, left, top, width, height, right: left + width, bottom: top + height };
    };

    const isVertical = typeof document !== 'undefined' && (
        document.body?.classList?.contains('vertical-layout') || Boolean(state?.verticalLayoutEnabled)
    );

    for (let pass = 0; pass < 4; pass++) {
        let anyMoved = false;
        const activeRect = getRect(activePanel);
        const others = allPanels.filter(p => p !== activePanel).map(getRect);

        others.forEach(p => {
            const overlapX = Math.min(activeRect.right, p.right) - Math.max(activeRect.left, p.left);
            const overlapY = Math.min(activeRect.bottom, p.bottom) - Math.max(activeRect.top, p.top);
            if (overlapX > 0 && overlapY > 0) {
                if (overlapX > overlapY || (overlapX === overlapY && isVertical)) {
                    p.el.style.top = `${activeRect.bottom + GAP}px`;
                } else {
                    p.el.style.left = `${activeRect.right + GAP}px`;
                }
                anyMoved = true;
            }
        });

        const updated = allPanels.map(getRect);
        for (let i = 0; i < updated.length; i++) {
            for (let j = i + 1; j < updated.length; j++) {
                const rA = updated[i];
                const rB = updated[j];
                if (rA.el === activePanel || rB.el === activePanel) continue;

                const overlapX = Math.min(rA.right, rB.right) - Math.max(rA.left, rB.left);
                const overlapY = Math.min(rA.bottom, rB.bottom) - Math.max(rA.top, rB.top);

                if (overlapX > 0 && overlapY > 0) {
                    if (overlapX > overlapY || (overlapX === overlapY && isVertical)) {
                        rB.el.style.top = `${rA.bottom + GAP}px`;
                    } else {
                        rB.el.style.left = `${rA.right + GAP}px`;
                    }
                    anyMoved = true;
                }
            }
        }

        if (!anyMoved) break;
    }

    savePanelLayout(container);
}

export function calculateSnapTarget(panel, container, rawLeft, rawTop) {
    if (!container || !panel) return null;
    const siblings = [...container.children].filter(
        c => c !== panel && !c.classList.contains('hidden') && !c.classList.contains('workspace-bounds-extender') && !c.classList.contains('panel-snap-indicator') && Boolean(c.id)
    );
    const pW = parseInt(panel.style.width, 10) || panel.offsetWidth || 500;
    const pH = parseInt(panel.style.height, 10) || panel.offsetHeight || 400;
    const xCandidates = [24, ...siblings.flatMap(s => [s.offsetLeft, s.offsetLeft + s.offsetWidth + 24, s.offsetLeft + s.offsetWidth - pW])];
    const yCandidates = [24, ...siblings.flatMap(s => [s.offsetTop, s.offsetTop + s.offsetHeight + 24, s.offsetTop + s.offsetHeight - pH])];
    const snapX = xCandidates.find(x => Math.abs(rawLeft - x) <= 32) ?? rawLeft;
    const snapY = yCandidates.find(y => Math.abs(rawTop - y) <= 32) ?? rawTop;
    return (snapX !== rawLeft || snapY !== rawTop) ? { left: snapX, top: snapY, width: pW, height: pH } : null;
}

export function updateSnapIndicator(container, target) {
    let ind = container?.querySelector('#panel_snap_indicator');
    if (!ind && container) {
        ind = document.createElement('div');
        ind.id = 'panel_snap_indicator';
        ind.className = 'panel-snap-indicator';
        container.appendChild(ind);
    }
    if (!ind) return;
    if (target) {
        Object.assign(ind.style, { left: `${target.left}px`, top: `${target.top}px`, width: `${target.width}px`, height: `${target.height}px`, display: 'block', opacity: '1' });
    } else {
        Object.assign(ind.style, { display: 'none', opacity: '0' });
    }
}

export function hideSnapIndicator(container) {
    updateSnapIndicator(container, null);
}

export function savePanelLayout(container) {
    if (!container) return;
    const panels = [...container.children].filter(el => 
        el.classList.contains('plane-column') || 
        el.classList.contains('auxiliary-surface-column') || 
        el.id === 'graph_column' || 
        el.id === 'real_plots_column' || 
        el.id === 'contour_2d_column'
    );
    
    const layout = {};
    panels.forEach(panel => {
        if (panel.id && panel.style.left && panel.style.top) {
            layout[panel.id] = {
                left: panel.style.left,
                top: panel.style.top,
                width: panel.style.width,
                height: panel.style.height
            };
        }
    });
    
    try {
        localStorage.setItem(getLayoutStorageKey(), JSON.stringify(layout));
    } catch (e) {}
}

export function getCurrentLayoutMode() {
    if (state?.laplaceModeEnabled) return 'laplace';
    if (state?.realPlotsEnabled) return 'real_plots';
    return 'normal';
}

export function getLayoutStorageKey() {
    const isVertical = typeof document !== 'undefined' && (
        document.body?.classList?.contains('vertical-layout') || Boolean(state?.verticalLayoutEnabled)
    );
    const orientation = isVertical ? 'vert' : 'horiz';
    const mode = getCurrentLayoutMode();
    return `complex_panelLayout_${mode}_${orientation}_${LAYOUT_VERSION}`;
}

export function resetAllPanelLayouts() {
    try {
        if (typeof localStorage !== 'undefined') {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.startsWith('complex_panelLayout_') || key.includes('panelLayout'))) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));
        }
    } catch (e) {}

    const container = typeof document !== 'undefined' ? document.querySelector('.canvas-row.two-column-layout') : null;
    if (container) {
        lastInitializedMode = null;
        [...container.children].forEach(panel => {
            delete panel.dataset.layoutInitialized;
            panel.style.left = '';
            panel.style.top = '';
            panel.style.width = '';
            panel.style.height = '';
        });

        initializeDefaultPanelPositions(container);
        updateWorkspaceBounds(container, false);
        triggerLayoutRedraw();
        window.dispatchEvent(new Event('resize'));
    }
}

export function computeRealPlotsLayout(containerWidth, containerHeight) {
    const isVertical = typeof document !== 'undefined' && (
        document.body?.classList?.contains('vertical-layout') || Boolean(state?.verticalLayoutEnabled)
    );
    const hasContour2D = Boolean(state?.show2DContourPlot);
    const padding = 24;
    const gap = 24;

    if (!hasContour2D) {
        // Real plots is alone: take the entire available space
        const fullWidth = Math.max(300, containerWidth - padding * 2);
        const fullHeight = Math.max(300, containerHeight - padding * 2);
        return {
            real_plots_column: {
                left: `${padding}px`,
                top: `${padding}px`,
                width: `${fullWidth}px`,
                height: `${fullHeight}px`
            }
        };
    }

    if (isVertical) {
        const panelWidth = Math.max(220, containerWidth - padding * 2);
        const availHeight = Math.max(400, containerHeight - padding * 2);
        const panelHeight = Math.max(180, Math.floor((availHeight - gap) / 2));
        return {
            real_plots_column: {
                left: `${padding}px`,
                top: `${padding}px`,
                width: `${panelWidth}px`,
                height: `${panelHeight}px`
            },
            contour_2d_column: {
                left: `${padding}px`,
                top: `${padding + panelHeight + gap}px`,
                width: `${panelWidth}px`,
                height: `${panelHeight}px`
            }
        };
    } else {
        const availWidth = Math.max(480, containerWidth - padding * 2);
        const panelWidth = Math.max(220, Math.floor((availWidth - gap) / 2));
        const panelHeight = Math.max(200, containerHeight - padding * 2);
        return {
            real_plots_column: {
                left: `${padding}px`,
                top: `${padding}px`,
                width: `${panelWidth}px`,
                height: `${panelHeight}px`
            },
            contour_2d_column: {
                left: `${padding + panelWidth + gap}px`,
                top: `${padding}px`,
                width: `${panelWidth}px`,
                height: `${panelHeight}px`
            }
        };
    }
}

export function computeNormalModeLayout(containerWidth, containerHeight) {
    const isVertical = typeof document !== 'undefined' && (
        document.body?.classList?.contains('vertical-layout') || Boolean(state?.verticalLayoutEnabled)
    );
    const padding = 24;
    const gap = 24;
    const layout = {};

    if (isVertical) {
        // Vertical mode: panels are stacked vertically (Row 1 top, Row 2 bottom)
        // 100% horizontal view, 50% vertical height
        const panelWidth = Math.max(220, containerWidth - padding * 2);
        const availHeight = Math.max(400, containerHeight - padding * 2);
        const panelHeight = Math.max(180, Math.floor((availHeight - gap) / 2));

        layout.z_plane_column = {
            left: `${padding}px`,
            top: `${padding}px`,
            width: `${panelWidth}px`,
            height: `${panelHeight}px`
        };

        const wTop = padding + panelHeight + gap;
        layout.w_plane_column = {
            left: `${padding}px`,
            top: `${wTop}px`,
            width: `${panelWidth}px`,
            height: `${panelHeight}px`
        };

        const graphTop = wTop + panelHeight + gap;
        layout.graph_column = {
            left: `${padding}px`,
            top: `${graphTop}px`,
            width: `${panelWidth}px`,
            height: `${panelHeight}px`
        };

        // Chained w_plane columns (w_plane_column_1, w_plane_column_2, ...)
        for (let i = 1; i <= 32; i++) {
            layout[`w_plane_column_${i}`] = {
                left: `${padding}px`,
                top: `${wTop + i * (panelHeight + gap)}px`,
                width: `${panelWidth}px`,
                height: `${panelHeight}px`
            };
        }
    } else {
        // Horizontal mode: panels are side-by-side horizontally (Track 1 left, Track 2 right, Track 3 right)
        // 50% horizontal view, 100% vertical height
        const availWidth = Math.max(480, containerWidth - padding * 2);
        const panelWidth = Math.max(220, Math.floor((availWidth - gap) / 2));
        const panelHeight = Math.max(200, containerHeight - padding * 2);

        layout.z_plane_column = {
            left: `${padding}px`,
            top: `${padding}px`,
            width: `${panelWidth}px`,
            height: `${panelHeight}px`
        };

        const wLeft = padding + panelWidth + gap;
        layout.w_plane_column = {
            left: `${wLeft}px`,
            top: `${padding}px`,
            width: `${panelWidth}px`,
            height: `${panelHeight}px`
        };

        const graphLeft = wLeft + panelWidth + gap;
        layout.graph_column = {
            left: `${graphLeft}px`,
            top: `${padding}px`,
            width: `${panelWidth}px`,
            height: `${panelHeight}px`
        };

        // Chained w_plane columns (w_plane_column_1, w_plane_column_2, ...)
        for (let i = 1; i <= 32; i++) {
            layout[`w_plane_column_${i}`] = {
                left: `${wLeft + i * (panelWidth + gap)}px`,
                top: `${padding}px`,
                width: `${panelWidth}px`,
                height: `${panelHeight}px`
            };
        }
    }

    return layout;
}

export function computeLaplaceModeLayout(containerWidth, containerHeight) {
    const isVertical = typeof document !== 'undefined' && (
        document.body?.classList?.contains('vertical-layout') || Boolean(state?.verticalLayoutEnabled)
    );
    const padding = 24;
    const gap = 24;

    if (isVertical) {
        // Vertical mode: rows are stacked downwards
        const panelWidth = Math.max(220, containerWidth - padding * 2);
        const availHeight = Math.max(400, containerHeight - padding * 2);
        const panelHeight = Math.max(180, Math.floor((availHeight - gap) / 2));
        const halfWidth = Math.max(180, Math.floor((panelWidth - gap) / 2));

        const topRow1 = padding;
        const topRow2 = topRow1 + panelHeight + gap;
        const row3Height = Math.max(340, Math.floor(panelHeight * 0.85));
        const topRow3 = topRow2 + panelHeight + gap;
        const row4Height = Math.max(280, Math.floor(panelHeight * 0.70));
        const topRow4 = topRow3 + row3Height + gap;
        const row5Height = Math.max(500, Math.floor(panelHeight * 1.4));
        const topRow5 = topRow4 + row4Height + gap;

        return {
            z_plane_column: {
                left: `${padding}px`,
                top: `${topRow1}px`,
                width: `${panelWidth}px`,
                height: `${panelHeight}px`
            },
            w_plane_column: {
                left: `${padding}px`,
                top: `${topRow2}px`,
                width: `${panelWidth}px`,
                height: `${panelHeight}px`
            },
            fourier_3d_column: {
                left: `${padding}px`,
                top: `${topRow3}px`,
                width: `${panelWidth}px`,
                height: `${row3Height}px`
            },
            laplace_com_column: {
                left: `${padding}px`,
                top: `${topRow4}px`,
                width: `${halfWidth}px`,
                height: `${row4Height}px`
            },
            laplace_spectrum_column: {
                left: `${padding + halfWidth + gap}px`,
                top: `${topRow4}px`,
                width: `${halfWidth}px`,
                height: `${row4Height}px`
            },
            laplace_3d_column: {
                left: `${padding}px`,
                top: `${topRow5}px`,
                width: `${panelWidth}px`,
                height: `${row5Height}px`
            }
        };
    }

    const availWidth = Math.max(800, containerWidth - padding * 2);
    const trackWidth = Math.max(460, Math.floor((availWidth - gap) / 2));
    const combinedWidth = trackWidth * 2 + gap;

    const screenHeight = Math.max(480, containerHeight - padding * 2);
    const row2Height = Math.max(380, Math.floor(screenHeight * 0.75));
    const row3Height = Math.max(340, Math.floor(screenHeight * 0.60));

    const track1Left = padding;                           // 24px (Track 1)
    const track2Left = padding + trackWidth + gap;        // Track 2 (Right side of initial screen)
    const track3Left = padding + combinedWidth + gap;     // Track 3 (To the right of Track 2)

    const topRow1 = padding;                              // 24px (Row 1: 100% Screen Height)
    const topRow2 = topRow1 + screenHeight + gap;         // Row 2 below Row 1
    const topRow3 = topRow2 + row2Height + gap;           // Row 3 below Row 2

    const totalLeftHeight = topRow3 + row3Height - padding;

    return {
        // Row 1: Time Domain Signal & Complex Frequency Domain - Both 100% Screen Height
        z_plane_column: {
            left: `${track1Left}px`,
            top: `${topRow1}px`,
            width: `${trackWidth}px`,
            height: `${screenHeight}px`
        },
        w_plane_column: {
            left: `${track2Left}px`,
            top: `${topRow1}px`,
            width: `${trackWidth}px`,
            height: `${screenHeight}px`
        },

        // Row 2: 3D Fourier Decomposition & Sum spanning 100% view width below both of them
        fourier_3d_column: {
            left: `${track1Left}px`,
            top: `${topRow2}px`,
            width: `${combinedWidth}px`,
            height: `${row2Height}px`
        },

        // Row 3: Half Center of Mass (Left) & Half Discrete Spectrum (Right)
        laplace_com_column: {
            left: `${track1Left}px`,
            top: `${topRow3}px`,
            width: `${trackWidth}px`,
            height: `${row3Height}px`
        },
        laplace_spectrum_column: {
            left: `${track2Left}px`,
            top: `${topRow3}px`,
            width: `${trackWidth}px`,
            height: `${row3Height}px`
        },

        // Right side of Track 2: Full complete sized Laplace 3D Surface
        laplace_3d_column: {
            left: `${track3Left}px`,
            top: `${topRow1}px`,
            width: `${Math.max(680, trackWidth)}px`,
            height: `${Math.max(700, totalLeftHeight)}px`
        }
    };
}

/**
 * Finds the next available non-overlapping free slot on the whiteboard
 * making space on the fly to ensure new panels NEVER stack on top of existing panels.
 * Horizontal mode: places to the absolute right side.
 * Vertical mode: places at the bottom.
 */
export function findNextAvailableSlot(container, panel, targetWidth, targetHeight) {
    const isVertical = typeof document !== 'undefined' && (
        document.body?.classList?.contains('vertical-layout') || Boolean(state?.verticalLayoutEnabled)
    );

    const visibleSiblings = container?.children ? [...container.children].filter(
        child => child !== panel && !child.classList.contains('hidden') && !child.classList.contains('workspace-bounds-extender') && Boolean(child.id)
    ) : [];

    const padding = 24;
    const gap = 24;

    if (visibleSiblings.length === 0) {
        return { left: `${padding}px`, top: `${padding}px` };
    }

    let maxBottom = 0;
    let maxRight = 0;
    let minTop = Infinity;

    visibleSiblings.forEach(sib => {
        const left = sib.offsetLeft || parseInt(sib.style.left, 10) || 0;
        const top = sib.offsetTop || parseInt(sib.style.top, 10) || 0;
        const width = sib.offsetWidth || parseInt(sib.style.width, 10) || targetWidth || 540;
        const height = sib.offsetHeight || parseInt(sib.style.height, 10) || targetHeight || 420;
        if (top + height > maxBottom) maxBottom = top + height;
        if (left + width > maxRight) maxRight = left + width;
        if (top < minTop) minTop = top;
    });

    if (minTop === Infinity) minTop = padding;

    if (isVertical) {
        return { left: `${padding}px`, top: `${maxBottom + gap}px` };
    } else {
        return { left: `${maxRight + gap}px`, top: `${minTop}px` };
    }
}

export function initializeDefaultPanelPositions(container) {
    if (!container) {
        container = document.querySelector('.canvas-row.two-column-layout');
    }
    if (!container) return;

    const mode = getCurrentLayoutMode();
    const isVertical = typeof document !== 'undefined' && (
        document.body?.classList?.contains('vertical-layout') || Boolean(state?.verticalLayoutEnabled)
    );
    const hasContour = Boolean(state?.show2DContourPlot);
    const hasGraph = Boolean(state?.graphViewEnabled);
    const currentModeKey = `${mode}_${isVertical ? 'vert' : 'horiz'}_${hasContour}_${hasGraph}`;

    // When transform mode, orientation, or contour state changes, reset panel initialization marks to reposition correctly for the mode
    if (lastInitializedMode !== currentModeKey) {
        [...container.children].forEach(panel => {
            delete panel.dataset.layoutInitialized;
        });
        lastInitializedMode = currentModeKey;
    }

    const visiblePanels = [...container.children].filter(
        el => !el.classList.contains('hidden') && !el.classList.contains('workspace-bounds-extender') && Boolean(el.id)
    );

    const containerWidth = container.clientWidth || window.innerWidth || 1200;
    const containerHeight = container.clientHeight || window.innerHeight || 700;

    const defaultLayoutMap = mode === 'laplace' 
        ? computeLaplaceModeLayout(containerWidth, containerHeight)
        : (mode === 'real_plots'
            ? computeRealPlotsLayout(containerWidth, containerHeight)
            : computeNormalModeLayout(containerWidth, containerHeight));

    let savedLayout = null;
    try {
        const stored = localStorage.getItem(getLayoutStorageKey());
        if (stored) savedLayout = JSON.parse(stored);
    } catch (e) {}

    visiblePanels.forEach(panel => {
        if (panel.dataset.layoutInitialized === currentModeKey && panel.style.left && panel.style.top) return;
        panel.dataset.layoutInitialized = currentModeKey;

        // 1. User saved custom layout
        if (panel.id && savedLayout && savedLayout[panel.id]) {
            const saved = savedLayout[panel.id];
            panel.style.left = saved.left;
            panel.style.top = saved.top;
            if (saved.width) panel.style.width = saved.width;
            if (saved.height) panel.style.height = saved.height;
            return;
        }

        // 2. Mode specific preset default layout
        if (panel.id && defaultLayoutMap && defaultLayoutMap[panel.id]) {
            const preset = defaultLayoutMap[panel.id];
            panel.style.left = preset.left;
            panel.style.top = preset.top;
            panel.style.width = preset.width;
            panel.style.height = preset.height;
            return;
        }

        // 3. Fallback: Find next available non-overlapping free slot with 50%/100% sizing
        const padding = 24;
        const gap = 24;

        let dynamicWidth, dynamicHeight;
        if (isVertical) {
            // Vertical mode: 100% horizontal view, 50% vertical height
            dynamicWidth = Math.max(MIN_WIDTH, containerWidth - padding * 2);
            dynamicHeight = Math.max(MIN_HEIGHT, Math.floor((containerHeight - padding * 2 - gap) / 2));
        } else {
            // Horizontal mode: 50% horizontal view, 100% vertical height
            dynamicWidth = Math.max(MIN_WIDTH, Math.floor((containerWidth - padding * 2 - gap) / 2));
            dynamicHeight = Math.max(MIN_HEIGHT, containerHeight - padding * 2);
        }

        panel.style.width = `${dynamicWidth}px`;
        panel.style.height = `${dynamicHeight}px`;

        const slot = findNextAvailableSlot(container, panel, dynamicWidth, dynamicHeight);
        panel.style.left = slot.left;
        panel.style.top = slot.top;
    });

    updateWorkspaceBounds(container);
}

function bindResizeEvents(resizeBtn, panel) {
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startHeight = 0;
    let origScrollLeft = 0;
    let origScrollTop = 0;
    let isResizing = false;

    const onPointerMove = (event) => {
        if (!isResizing) return;
        event.preventDefault();

        const container = panel.closest('.two-column-layout');
        const currentScrollLeft = container ? container.scrollLeft : 0;
        const currentScrollTop = container ? container.scrollTop : 0;

        const deltaX = (event.clientX - startX) + (currentScrollLeft - origScrollLeft);
        const deltaY = (event.clientY - startY) + (currentScrollTop - origScrollTop);

        const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(startWidth + deltaX)));
        const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(startHeight + deltaY)));

        panel.style.width = `${newWidth}px`;
        panel.style.height = `${newHeight}px`;

        if (container) {
            const pLeft = panel.offsetLeft || parseInt(panel.style.left, 10) || 0;
            const pTop = panel.offsetTop || parseInt(panel.style.top, 10) || 0;
            updateWorkspaceBounds(container, true, {
                right: pLeft + newWidth + 2000,
                bottom: pTop + newHeight + 2000
            });
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

    resizeBtn.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        panel.style.zIndex = `${++highestZIndex}`;
        isResizing = true;
        panel.classList.add('is-resizing');

        const container = panel.closest('.two-column-layout');
        startX = event.clientX;
        startY = event.clientY;
        startWidth = panel.offsetWidth;
        startHeight = panel.offsetHeight;
        origScrollLeft = container ? container.scrollLeft : 0;
        origScrollTop = container ? container.scrollTop : 0;

        window.addEventListener('pointermove', onPointerMove, { passive: false, capture: true });
        window.addEventListener('pointerup', onPointerUp, { capture: true });
        window.addEventListener('pointercancel', onPointerUp, { capture: true });
    });
}

function bindGripEvents(triggerEl, panel) {
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;
    let origScrollLeft = 0;
    let origScrollTop = 0;
    let isDragging = false;
    let currentClientX = 0;
    let currentClientY = 0;
    let autoScrollRaf = null;

    const autoScrollLoop = () => {
        if (!isDragging) return;
        const container = panel.closest('.two-column-layout');
        if (container) {
            const SCROLL_THRESHOLD = 45;
            const MAX_SCROLL_SPEED = 14;
            const containerRect = container.getBoundingClientRect();
            let scrollX = 0;
            let scrollY = 0;

            if (currentClientX < containerRect.left + SCROLL_THRESHOLD && container.scrollLeft > 0) {
                const depth = (containerRect.left + SCROLL_THRESHOLD) - currentClientX;
                const factor = Math.min(1, Math.max(0.1, depth / SCROLL_THRESHOLD));
                scrollX = -Math.round(factor * MAX_SCROLL_SPEED);
            } else if (currentClientX > containerRect.right - SCROLL_THRESHOLD) {
                const depth = currentClientX - (containerRect.right - SCROLL_THRESHOLD);
                const factor = Math.min(1, Math.max(0.1, depth / SCROLL_THRESHOLD));
                scrollX = Math.round(factor * MAX_SCROLL_SPEED);
            }

            if (currentClientY < containerRect.top + SCROLL_THRESHOLD && container.scrollTop > 0) {
                const depth = (containerRect.top + SCROLL_THRESHOLD) - currentClientY;
                const factor = Math.min(1, Math.max(0.1, depth / SCROLL_THRESHOLD));
                scrollY = -Math.round(factor * MAX_SCROLL_SPEED);
            } else if (currentClientY > containerRect.bottom - SCROLL_THRESHOLD) {
                const depth = currentClientY - (containerRect.bottom - SCROLL_THRESHOLD);
                const factor = Math.min(1, Math.max(0.1, depth / SCROLL_THRESHOLD));
                scrollY = Math.round(factor * MAX_SCROLL_SPEED);
            }

            if (scrollX !== 0 || scrollY !== 0) {
                container.scrollLeft += scrollX;
                container.scrollTop += scrollY;

                const currentScrollLeft = container.scrollLeft;
                const currentScrollTop = container.scrollTop;
                const deltaX = (currentClientX - startX) + (currentScrollLeft - origScrollLeft);
                const deltaY = (currentClientY - startY) + (currentScrollTop - origScrollTop);
                const newLeft = Math.max(0, Math.round(origLeft + deltaX));
                const newTop = Math.max(0, Math.round(origTop + deltaY));
                panel.style.left = `${newLeft}px`;
                panel.style.top = `${newTop}px`;

                const pW = panel.offsetWidth || 500;
                const pH = panel.offsetHeight || 400;
                updateWorkspaceBounds(container, true, {
                    right: newLeft + pW + 2000,
                    bottom: newTop + pH + 2000
                });
            }
        }
        autoScrollRaf = requestAnimationFrame(autoScrollLoop);
    };

    const onPointerMove = (event) => {
        if (!isDragging) return;
        event.preventDefault();
        currentClientX = event.clientX;
        currentClientY = event.clientY;

        const container = panel.closest('.two-column-layout');
        const currentScrollLeft = container ? container.scrollLeft : 0;
        const currentScrollTop = container ? container.scrollTop : 0;

        const deltaX = (event.clientX - startX) + (currentScrollLeft - origScrollLeft);
        const deltaY = (event.clientY - startY) + (currentScrollTop - origScrollTop);

        const newLeft = Math.max(0, Math.round(origLeft + deltaX));
        const newTop = Math.max(0, Math.round(origTop + deltaY));

        panel.style.left = `${newLeft}px`;
        panel.style.top = `${newTop}px`;

        if (container) {
            const pW = panel.offsetWidth || 500;
            const pH = panel.offsetHeight || 400;
            const snapTarget = calculateSnapTarget(panel, container, newLeft, newTop);
            if (snapTarget) {
                updateSnapIndicator(container, snapTarget);
            } else {
                hideSnapIndicator(container);
            }

            updateWorkspaceBounds(container, true, {
                right: newLeft + pW + 2000,
                bottom: newTop + pH + 2000
            });
        }
    };

    const onPointerUp = () => {
        if (!isDragging) return;
        isDragging = false;
        if (autoScrollRaf) {
            cancelAnimationFrame(autoScrollRaf);
            autoScrollRaf = null;
        }
        panel.classList.remove('is-dragging');

        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', onPointerUp, true);
        window.removeEventListener('pointercancel', onPointerUp, true);

        const container = panel.closest('.two-column-layout');
        if (container) {
            const curL = parseInt(panel.style.left, 10) || panel.offsetLeft || 0;
            const curT = parseInt(panel.style.top, 10) || panel.offsetTop || 0;
            const snapTarget = calculateSnapTarget(panel, container, curL, curT);
            if (snapTarget) {
                panel.style.left = `${snapTarget.left}px`;
                panel.style.top = `${snapTarget.top}px`;
            }
            hideSnapIndicator(container);

            resolveCollisions(panel, container);
            updateWorkspaceBounds(container, false);
            savePanelLayout(container);
        }

        triggerLayoutRedraw();
        window.dispatchEvent(new Event('resize'));
    };

    triggerEl.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        panel.style.zIndex = `${++highestZIndex}`;
        isDragging = true;
        panel.classList.add('is-dragging');

        const container = panel.closest('.two-column-layout');
        startX = event.clientX;
        startY = event.clientY;
        currentClientX = event.clientX;
        currentClientY = event.clientY;
        origLeft = panel.offsetLeft || parseInt(panel.style.left, 10) || 0;
        origTop = panel.offsetTop || parseInt(panel.style.top, 10) || 0;
        origScrollLeft = container ? container.scrollLeft : 0;
        origScrollTop = container ? container.scrollTop : 0;

        window.addEventListener('pointermove', onPointerMove, { passive: false, capture: true });
        window.addEventListener('pointerup', onPointerUp, { capture: true });
        window.addEventListener('pointercancel', onPointerUp, { capture: true });

        if (autoScrollRaf) cancelAnimationFrame(autoScrollRaf);
        autoScrollRaf = requestAnimationFrame(autoScrollLoop);
    });
}

function createEdgeHandle(panel) {
    if (!panel || !panel.id || panel.classList.contains('workspace-bounds-extender')) return;
    if (panel.querySelector('.panel-edge-handle-bar')) return;

    const bar = document.createElement('div');
    bar.className = 'panel-edge-handle-bar';

    const group = document.createElement('div');
    group.className = 'panel-edge-btn-group';

    // 1. Move / Resize button (Scaling-like icon)
    const resizeBtn = document.createElement('button');
    resizeBtn.type = 'button';
    resizeBtn.className = 'panel-edge-action-btn panel-resize-btn';
    resizeBtn.title = 'Resize panel (drag)';
    resizeBtn.setAttribute('aria-label', 'Resize panel');
    resizeBtn.innerHTML = `<i data-lucide="maximize-2" class="icon-whiteboard" aria-hidden="true"></i>`;

    // 2. Grip / Move button
    const gripBtn = document.createElement('button');
    gripBtn.type = 'button';
    gripBtn.className = 'panel-edge-action-btn panel-grip-btn';
    gripBtn.title = 'Move panel (drag)';
    gripBtn.setAttribute('aria-label', 'Move panel');
    gripBtn.innerHTML = `<i data-lucide="grip" class="icon-whiteboard" aria-hidden="true"></i>`;

    // 3. Reset Size button
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'panel-edge-action-btn panel-reset-btn';
    resetBtn.title = 'Reset panel size';
    resetBtn.setAttribute('aria-label', 'Reset panel size');
    resetBtn.innerHTML = `<i data-lucide="rotate-ccw" class="icon-whiteboard" aria-hidden="true"></i>`;

    group.appendChild(resetBtn);
    group.appendChild(resizeBtn);
    group.appendChild(gripBtn);
    bar.appendChild(group);
    panel.appendChild(bar);

    bindResizeEvents(resizeBtn, panel);
    bindGripEvents(gripBtn, panel);
    
    // Bind reset event
    resetBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const container = panel.closest('.two-column-layout');
        if (container) {
            const containerWidth = container.clientWidth || window.innerWidth || 1200;
            const containerHeight = container.clientHeight || window.innerHeight || 700;
            const mode = getCurrentLayoutMode();
            const defaultLayoutMap = mode === 'laplace' 
                ? computeLaplaceModeLayout(containerWidth, containerHeight)
                : (mode === 'real_plots'
                    ? computeRealPlotsLayout(containerWidth, containerHeight)
                    : computeNormalModeLayout(containerWidth, containerHeight));

            if (panel.id && defaultLayoutMap && defaultLayoutMap[panel.id]) {
                const preset = defaultLayoutMap[panel.id];
                panel.style.left = preset.left;
                panel.style.top = preset.top;
                panel.style.width = preset.width;
                panel.style.height = preset.height;
            } else {
                const isVertical = typeof document !== 'undefined' && (
                    document.body?.classList?.contains('vertical-layout') || Boolean(state?.verticalLayoutEnabled)
                );
                const padding = 24;
                const gap = 24;
                let defaultWidth, defaultHeight;
                if (isVertical) {
                    defaultWidth = Math.max(MIN_WIDTH, containerWidth - padding * 2);
                    defaultHeight = Math.max(MIN_HEIGHT, Math.floor((containerHeight - padding * 2 - gap) / 2));
                } else {
                    defaultWidth = Math.max(MIN_WIDTH, Math.floor((containerWidth - padding * 2 - gap) / 2));
                    defaultHeight = Math.max(MIN_HEIGHT, containerHeight - padding * 2);
                }
                panel.style.width = `${defaultWidth}px`;
                panel.style.height = `${defaultHeight}px`;
            }

            resolveCollisions(panel, container);
            updateWorkspaceBounds(container);
            savePanelLayout(container);

            triggerLayoutRedraw();
            window.dispatchEvent(new Event('resize'));
        }
    });

    // Bring to front when clicked
    panel.addEventListener('pointerdown', () => {
        panel.style.zIndex = `${++highestZIndex}`;
    });

    // Detect when cursor is near the side or bottom edges to show the handle
    panel.addEventListener('pointermove', (e) => {
        const rect = panel.getBoundingClientRect();
        const nearRightEdge = (rect.right - e.clientX) < 60;
        const nearBottomEdge = (rect.bottom - e.clientY) < 60;
        
        if (nearRightEdge || nearBottomEdge) {
            panel.classList.add('show-edge-handle');
        } else {
            panel.classList.remove('show-edge-handle');
        }
    });
    
    panel.addEventListener('pointerleave', () => {
        panel.classList.remove('show-edge-handle');
    });

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

let isRefreshing = false;
let refreshScheduled = false;

export function refreshPanelEdgeHandles(sync = false) {
    if (sync) {
        executeRefresh();
        return;
    }
    
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
            el => !el.classList.contains('workspace-bounds-extender') && Boolean(el.id)
        );

        panels.forEach(createEdgeHandle);

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    } finally {
        isRefreshing = false;
    }
}

export function initPanelLayoutManager() {
    if (initialized) return;
    initialized = true;

    refreshPanelEdgeHandles();

    const container = document.querySelector('.canvas-row.two-column-layout');
    if (container && typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver((mutations) => {
            const hasChange = mutations.some(m => {
                if (m.type === 'childList') return true;
                if (m.type === 'attributes' && m.attributeName === 'class') {
                    const oldClass = m.oldValue || '';
                    const newClass = m.target.className || '';
                    return oldClass.includes('hidden') !== newClass.includes('hidden');
                }
                return false;
            });
            if (hasChange) {
                refreshPanelEdgeHandles();
            }
        });
        observer.observe(container, { childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    }

    window.addEventListener('resize', () => {
        const row = document.querySelector('.canvas-row.two-column-layout');
        if (!row) return;

        const isLaplace = Boolean(state?.laplaceModeEnabled);
        const containerWidth = row.clientWidth || window.innerWidth || 1200;
        const containerHeight = row.clientHeight || window.innerHeight || 700;

        let savedLayout = null;
        try {
            const stored = localStorage.getItem(getLayoutStorageKey());
            if (stored) savedLayout = JSON.parse(stored);
        } catch (e) {}

        const defaultLayoutMap = isLaplace
            ? computeLaplaceModeLayout(containerWidth, containerHeight)
            : computeNormalModeLayout(containerWidth, containerHeight);

        const visiblePanels = [...row.children].filter(
            el => !el.classList.contains('hidden') && !el.classList.contains('workspace-bounds-extender') && Boolean(el.id)
        );

        visiblePanels.forEach(panel => {
            if (!savedLayout || !savedLayout[panel.id]) {
                if (defaultLayoutMap && defaultLayoutMap[panel.id]) {
                    const preset = defaultLayoutMap[panel.id];
                    panel.style.left = preset.left;
                    panel.style.top = preset.top;
                    panel.style.width = preset.width;
                    panel.style.height = preset.height;
                }
            }
        });

        updateWorkspaceBounds(row);
    });
}
