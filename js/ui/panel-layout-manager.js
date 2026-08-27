import { setupVisualParameters } from '../utils/dom-utils.js';
import { requestDomainRedraw, requestUiRedraw } from '../rendering/redraw-scheduler.js';
import { state } from '../store/state.js';

let initialized = false;
let highestZIndex = 10;
let lastInitializedMode = null;

const MIN_WIDTH = 220;
const MAX_WIDTH = 2560;
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 2000;
const COLLISION_GAP = 24;

export function updateWorkspaceBounds(container, isInteracting = false) {
    if (!container) {
        container = document.querySelector('.canvas-row.two-column-layout');
    }
    if (!container) return;

    const visiblePanels = [...container.children].filter(
        el => !el.classList.contains('hidden') && !el.classList.contains('workspace-bounds-extender') && Boolean(el.id)
    );

    let maxRight = 0;
    let maxBottom = 0;

    visiblePanels.forEach(panel => {
        const right = (panel.offsetLeft || 0) + (panel.offsetWidth || 0) + 48;
        const bottom = (panel.offsetTop || 0) + (panel.offsetHeight || 0) + 48;
        if (right > maxRight) maxRight = right;
        if (bottom > maxBottom) maxBottom = bottom;
    });

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

    const clientW = container.clientWidth || 0;
    const clientH = container.clientHeight || 0;

    // Extend beyond container client dimensions when panels overflow or to provide generous scroll space during drag
    const extraSpace = isInteracting ? 800 : 0;
    const neededLeft = (maxRight > clientW || isInteracting) ? (maxRight + extraSpace) : 0;
    const neededTop = (maxBottom > clientH || isInteracting) ? (maxBottom + extraSpace) : 0;

    extender.style.left = `${neededLeft}px`;
    extender.style.top = `${neededTop}px`;
}

export function resolveCollisions(activePanel, container) {
    if (!activePanel || !container) return;

    const siblings = [...container.children].filter(
        child => child !== activePanel && !child.classList.contains('hidden') && !child.classList.contains('workspace-bounds-extender') && Boolean(child.id)
    );

    for (let pass = 0; pass < 3; pass++) {
        let changed = false;

        const activeRect = {
            left: activePanel.offsetLeft,
            top: activePanel.offsetTop,
            width: activePanel.offsetWidth,
            height: activePanel.offsetHeight,
            right: activePanel.offsetLeft + activePanel.offsetWidth,
            bottom: activePanel.offsetTop + activePanel.offsetHeight
        };

        siblings.forEach(sibling => {
            const sibRect = {
                left: sibling.offsetLeft,
                top: sibling.offsetTop,
                width: sibling.offsetWidth,
                height: sibling.offsetHeight,
                right: sibling.offsetLeft + sibling.offsetWidth,
                bottom: sibling.offsetTop + sibling.offsetHeight
            };

            const overlapX = Math.min(activeRect.right, sibRect.right) - Math.max(activeRect.left, sibRect.left);
            const overlapY = Math.min(activeRect.bottom, sibRect.bottom) - Math.max(activeRect.top, sibRect.top);

            if (overlapX > 0 && overlapY > 0) {
                changed = true;
                // Axis with least overlap determines push direction
                if (overlapX < overlapY) {
                    if (sibRect.left + sibRect.width / 2 >= activeRect.left + activeRect.width / 2) {
                        sibling.style.left = `${activeRect.right + COLLISION_GAP}px`;
                    } else {
                        sibling.style.left = `${Math.max(16, activeRect.left - sibRect.width - COLLISION_GAP)}px`;
                    }
                } else {
                    if (sibRect.top + sibRect.height / 2 >= activeRect.top + activeRect.height / 2) {
                        sibling.style.top = `${activeRect.bottom + COLLISION_GAP}px`;
                    } else {
                        sibling.style.top = `${Math.max(16, activeRect.top - sibRect.height - COLLISION_GAP)}px`;
                    }
                }
            }
        });

        if (!changed) break;
    }

    // Final safety check to ensure panels are within boundaries
    siblings.forEach(sibling => {
        if (sibling.offsetLeft < 24) sibling.style.left = '24px';
        if (sibling.offsetTop < 24) sibling.style.top = '24px';
    });

    savePanelLayout(container);
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

const LAYOUT_VERSION = 'v6';

export function getLayoutStorageKey() {
    return state?.laplaceModeEnabled 
        ? `complex_panelLayout_laplace_${LAYOUT_VERSION}` 
        : `complex_panelLayout_normal_${LAYOUT_VERSION}`;
}

export function computeNormalModeLayout(containerWidth, containerHeight) {
    const padding = 24;
    const gap = 24;
    const availWidth = Math.max(760, containerWidth - padding * 2);
    const panelWidth = Math.max(480, Math.floor((availWidth - gap) / 2));
    const panelHeight = Math.max(440, containerHeight - padding * 2);

    return {
        z_plane_column: {
            left: `${padding}px`,
            top: `${padding}px`,
            width: `${panelWidth}px`,
            height: `${panelHeight}px`
        },
        w_plane_column: {
            left: `${padding + panelWidth + gap}px`,
            top: `${padding}px`,
            width: `${panelWidth}px`,
            height: `${panelHeight}px`
        }
    };
}

export function computeLaplaceModeLayout(containerWidth, containerHeight) {
    const padding = 24;
    const gap = 24;

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
 */
export function findNextAvailableSlot(container, panel, targetWidth, targetHeight) {
    const visibleSiblings = [...container.children].filter(
        child => child !== panel && !child.classList.contains('hidden') && !child.classList.contains('workspace-bounds-extender') && Boolean(child.id)
    );

    const padding = 24;
    const gap = 24;

    if (visibleSiblings.length === 0) {
        return { left: `${padding}px`, top: `${padding}px` };
    }

    let maxBottom = 0;
    let maxRight = 0;

    visibleSiblings.forEach(sib => {
        const left = sib.offsetLeft || parseInt(sib.style.left, 10) || 0;
        const top = sib.offsetTop || parseInt(sib.style.top, 10) || 0;
        const width = sib.offsetWidth || parseInt(sib.style.width, 10) || targetWidth;
        const height = sib.offsetHeight || parseInt(sib.style.height, 10) || targetHeight;
        if (top + height > maxBottom) maxBottom = top + height;
        if (left + width > maxRight) maxRight = left + width;
    });

    // Make space on the fly: place below all existing panels, or to the right if height is excessive
    if (maxBottom < 1800) {
        return { left: `${padding}px`, top: `${maxBottom + gap}px` };
    } else {
        return { left: `${maxRight + gap}px`, top: `${padding}px` };
    }
}

export function initializeDefaultPanelPositions(container) {
    if (!container) {
        container = document.querySelector('.canvas-row.two-column-layout');
    }
    if (!container) return;

    const isLaplace = Boolean(state?.laplaceModeEnabled);
    const currentMode = isLaplace ? 'laplace' : 'normal';

    // When transform mode changes, reset panel initialization marks to reposition correctly for the mode
    if (lastInitializedMode !== currentMode) {
        [...container.children].forEach(panel => {
            delete panel.dataset.layoutInitialized;
        });
        lastInitializedMode = currentMode;
    }

    const visiblePanels = [...container.children].filter(
        el => !el.classList.contains('hidden') && !el.classList.contains('workspace-bounds-extender') && Boolean(el.id)
    );

    const containerWidth = container.clientWidth || window.innerWidth || 1200;
    const containerHeight = container.clientHeight || window.innerHeight || 700;

    const defaultLayoutMap = isLaplace 
        ? computeLaplaceModeLayout(containerWidth, containerHeight)
        : computeNormalModeLayout(containerWidth, containerHeight);

    let savedLayout = null;
    try {
        const stored = localStorage.getItem(getLayoutStorageKey());
        if (stored) savedLayout = JSON.parse(stored);
    } catch (e) {}

    visiblePanels.forEach(panel => {
        if (panel.dataset.layoutInitialized === currentMode) return;
        panel.dataset.layoutInitialized = currentMode;

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

        // 3. Fallback: Find next available non-overlapping free slot
        const defW = 540;
        const defH = 420;
        if (!panel.style.width) panel.style.width = `${defW}px`;
        if (!panel.style.height) panel.style.height = `${defH}px`;

        const curW = parseInt(panel.style.width, 10) || defW;
        const curH = parseInt(panel.style.height, 10) || defH;
        const slot = findNextAvailableSlot(container, panel, curW, curH);
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

        if (container) updateWorkspaceBounds(container, true);

        setupVisualParameters(false, false);
        requestDomainRedraw(true);
        requestUiRedraw();
    };

    const onPointerUp = (event) => {
        if (!isResizing) return;
        isResizing = false;
        panel.classList.remove('is-resizing');

        try {
            resizeBtn.releasePointerCapture(event.pointerId);
        } catch (_) {}

        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);

        const container = panel.closest('.two-column-layout');
        if (container) {
            resolveCollisions(panel, container);
            updateWorkspaceBounds(container, false);
        }

        setupVisualParameters(false, false);
        requestDomainRedraw(true);
        requestUiRedraw();
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

        try {
            resizeBtn.setPointerCapture(event.pointerId);
        } catch (_) {}

        window.addEventListener('pointermove', onPointerMove, { passive: false });
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
    });
}

function bindGripEvents(gripBtn, panel) {
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;
    let origScrollLeft = 0;
    let origScrollTop = 0;
    let isDragging = false;

    const onPointerMove = (event) => {
        if (!isDragging) return;
        event.preventDefault();

        const container = panel.closest('.two-column-layout');
        if (container) {
            // 4-Way Auto-scrolling when dragging near boundary
            const SCROLL_THRESHOLD = 80;
            const SCROLL_SPEED = 20;
            const containerRect = container.getBoundingClientRect();

            if (event.clientX < containerRect.left + SCROLL_THRESHOLD) {
                container.scrollLeft -= SCROLL_SPEED;
            } else if (event.clientX > containerRect.right - SCROLL_THRESHOLD) {
                container.scrollLeft += SCROLL_SPEED;
            }

            if (event.clientY < containerRect.top + SCROLL_THRESHOLD) {
                container.scrollTop -= SCROLL_SPEED;
            } else if (event.clientY > containerRect.bottom - SCROLL_THRESHOLD) {
                container.scrollTop += SCROLL_SPEED;
            }

            updateWorkspaceBounds(container, true);
        }

        const currentScrollLeft = container ? container.scrollLeft : 0;
        const currentScrollTop = container ? container.scrollTop : 0;

        const deltaX = (event.clientX - startX) + (currentScrollLeft - origScrollLeft);
        const deltaY = (event.clientY - startY) + (currentScrollTop - origScrollTop);

        const newLeft = Math.max(0, Math.round(origLeft + deltaX));
        const newTop = Math.max(0, Math.round(origTop + deltaY));

        panel.style.left = `${newLeft}px`;
        panel.style.top = `${newTop}px`;
    };

    const onPointerUp = (event) => {
        if (!isDragging) return;
        isDragging = false;
        panel.classList.remove('is-dragging');

        try {
            gripBtn.releasePointerCapture(event.pointerId);
        } catch (_) {}

        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);

        const container = panel.closest('.two-column-layout');
        if (container) {
            resolveCollisions(panel, container);
            updateWorkspaceBounds(container, false);
        }

        setupVisualParameters(false, false);
        requestDomainRedraw(true);
        requestUiRedraw();
        window.dispatchEvent(new Event('resize'));
    };

    gripBtn.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        panel.style.zIndex = `${++highestZIndex}`;
        isDragging = true;
        panel.classList.add('is-dragging');

        const container = panel.closest('.two-column-layout');
        startX = event.clientX;
        startY = event.clientY;
        origLeft = panel.offsetLeft || 0;
        origTop = panel.offsetTop || 0;
        origScrollLeft = container ? container.scrollLeft : 0;
        origScrollTop = container ? container.scrollTop : 0;

        try {
            gripBtn.setPointerCapture(event.pointerId);
        } catch (_) {}

        window.addEventListener('pointermove', onPointerMove, { passive: false });
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
    });
}

function createEdgeHandle(panel) {
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
            const isLaplace = Boolean(state?.laplaceModeEnabled);
            const defaultLayoutMap = isLaplace 
                ? computeLaplaceModeLayout(containerWidth, containerHeight)
                : computeNormalModeLayout(containerWidth, containerHeight);

            if (panel.id && defaultLayoutMap && defaultLayoutMap[panel.id]) {
                const preset = defaultLayoutMap[panel.id];
                panel.style.left = preset.left;
                panel.style.top = preset.top;
                panel.style.width = preset.width;
                panel.style.height = preset.height;
            } else {
                const defaultWidth = Math.max(380, Math.min(620, Math.floor((containerWidth - 72) / 2)));
                const defaultHeight = Math.max(340, Math.min(540, containerHeight - 64));
                panel.style.width = `${defaultWidth}px`;
                panel.style.height = `${defaultHeight}px`;
            }

            resolveCollisions(panel, container);
            updateWorkspaceBounds(container);
            savePanelLayout(container);

            setupVisualParameters(false, false);
            requestDomainRedraw(true);
            requestUiRedraw();
            window.dispatchEvent(new Event('resize'));
        }
    });

    // Bring to front when clicked
    panel.addEventListener('pointerdown', () => {
        panel.style.zIndex = `${++highestZIndex}`;
    });

    // Detect when cursor is near the edges to show the handle (bottom 80px or right 80px)
    panel.addEventListener('pointermove', (e) => {
        const rect = panel.getBoundingClientRect();
        const nearRightEdge = rect.right - e.clientX < 100;
        const nearBottomEdge = rect.bottom - e.clientY < 100;
        
        if (nearRightEdge || nearBottomEdge) {
            panel.classList.add('show-edge-handle');
        } else {
            panel.classList.remove('show-edge-handle');
        }
    });
    
    panel.addEventListener('pointerleave', () => {
        panel.classList.remove('show-edge-handle');
    });
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

        const panels = container.querySelectorAll(
            '.plane-column, .auxiliary-surface-column, #graph_column, #real_plots_column, #contour_2d_column'
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
        const observer = new MutationObserver(() => {
            refreshPanelEdgeHandles();
        });
        observer.observe(container, { childList: true });
    }

    window.addEventListener('resize', () => {
        if (container) updateWorkspaceBounds(container);
    });
}
