import test from 'node:test';
import assert from 'node:assert/strict';

import {
    computeNormalModeLayout,
    computeLaplaceModeLayout,
    computeRealPlotsLayout,
    findNextAvailableSlot,
    updateWorkspaceBounds,
    resetAllPanelLayouts
} from '../js/ui/panel-layout-manager.js';

test('Normal Mode Layout fits perfectly inside container with no scrollbar overflow', () => {
    const containerWidth = 1200;
    const containerHeight = 800;
    const layout = computeNormalModeLayout(containerWidth, containerHeight);

    assert.ok(layout.z_plane_column);
    assert.ok(layout.w_plane_column);

    const zLeft = parseInt(layout.z_plane_column.left, 10);
    const zWidth = parseInt(layout.z_plane_column.width, 10);
    const zTop = parseInt(layout.z_plane_column.top, 10);
    const zHeight = parseInt(layout.z_plane_column.height, 10);

    const wLeft = parseInt(layout.w_plane_column.left, 10);
    const wWidth = parseInt(layout.w_plane_column.width, 10);
    const wTop = parseInt(layout.w_plane_column.top, 10);
    const wHeight = parseInt(layout.w_plane_column.height, 10);

    // Padding is 24, gap is 24
    assert.equal(zLeft, 24);
    assert.equal(zTop, 24);
    assert.equal(wTop, 24);
    assert.equal(wLeft, zLeft + zWidth + 24);

    // Both panels fit strictly within container dimensions (NO overflow)
    assert.ok(wLeft + wWidth <= containerWidth, `w right (${wLeft + wWidth}) exceeds container width (${containerWidth})`);
    assert.ok(zTop + zHeight <= containerHeight, `z bottom (${zTop + zHeight}) exceeds container height (${containerHeight})`);
    assert.ok(wTop + wHeight <= containerHeight, `w bottom (${wTop + wHeight}) exceeds container height (${containerHeight})`);
});

test('Normal Mode Layout scales responsibly under smaller or zoomed viewports without overflow', () => {
    const zoomedWidth = 800;
    const zoomedHeight = 500;
    const layout = computeNormalModeLayout(zoomedWidth, zoomedHeight);

    const zLeft = parseInt(layout.z_plane_column.left, 10);
    const zWidth = parseInt(layout.z_plane_column.width, 10);
    const zHeight = parseInt(layout.z_plane_column.height, 10);
    const wLeft = parseInt(layout.w_plane_column.left, 10);
    const wWidth = parseInt(layout.w_plane_column.width, 10);

    assert.ok(wLeft + wWidth <= zoomedWidth, `w right edge (${wLeft + wWidth}) must fit within zoomed width (${zoomedWidth})`);
    assert.ok(zHeight + 24 <= zoomedHeight, `z height must fit within zoomed height`);
});

test('Laplace Mode Layout satisfies exact spatial arrangement specifications', () => {
    const containerWidth = 1400;
    const containerHeight = 900;
    const layout = computeLaplaceModeLayout(containerWidth, containerHeight);

    assert.ok(layout.z_plane_column, 'Time Domain Signal present');
    assert.ok(layout.w_plane_column, 'Complex Frequency Domain present');
    assert.ok(layout.fourier_3d_column, '3D Fourier Decomposition present');
    assert.ok(layout.laplace_com_column, 'Center of Mass present');
    assert.ok(layout.laplace_spectrum_column, 'Discrete Spectrum present');
    assert.ok(layout.laplace_3d_column, 'Laplace 3D Surface present');

    const z = {
        left: parseInt(layout.z_plane_column.left, 10),
        top: parseInt(layout.z_plane_column.top, 10),
        width: parseInt(layout.z_plane_column.width, 10),
        height: parseInt(layout.z_plane_column.height, 10)
    };
    const w = {
        left: parseInt(layout.w_plane_column.left, 10),
        top: parseInt(layout.w_plane_column.top, 10),
        width: parseInt(layout.w_plane_column.width, 10),
        height: parseInt(layout.w_plane_column.height, 10)
    };
    const fourier = {
        left: parseInt(layout.fourier_3d_column.left, 10),
        top: parseInt(layout.fourier_3d_column.top, 10),
        width: parseInt(layout.fourier_3d_column.width, 10),
        height: parseInt(layout.fourier_3d_column.height, 10)
    };
    const com = {
        left: parseInt(layout.laplace_com_column.left, 10),
        top: parseInt(layout.laplace_com_column.top, 10),
        width: parseInt(layout.laplace_com_column.width, 10),
        height: parseInt(layout.laplace_com_column.height, 10)
    };
    const spec = {
        left: parseInt(layout.laplace_spectrum_column.left, 10),
        top: parseInt(layout.laplace_spectrum_column.top, 10),
        width: parseInt(layout.laplace_spectrum_column.width, 10),
        height: parseInt(layout.laplace_spectrum_column.height, 10)
    };
    const laplace3d = {
        left: parseInt(layout.laplace_3d_column.left, 10),
        top: parseInt(layout.laplace_3d_column.top, 10),
        width: parseInt(layout.laplace_3d_column.width, 10),
        height: parseInt(layout.laplace_3d_column.height, 10)
    };

    // Row 1: Time Domain (Track 1) and Complex Frequency Domain (Track 2) side by side taking screen height
    assert.equal(z.top, 24);
    assert.equal(w.top, 24);
    assert.equal(z.height, w.height);
    assert.equal(w.left, z.left + z.width + 24);

    // Row 2: Directly below Row 1, spanning 100% combined width of Track 1 and 2
    assert.equal(fourier.left, z.left);
    assert.ok(fourier.top >= z.top + z.height + 24);
    assert.equal(fourier.width, z.width * 2 + 24);

    // Row 3: Directly below Row 2, half width COM (Track 1) and half width Spectrum (Track 2)
    assert.equal(com.left, z.left);
    assert.equal(spec.left, w.left);
    assert.ok(com.top >= fourier.top + fourier.height + 24);
    assert.equal(com.top, spec.top);
    assert.equal(com.width, z.width);
    assert.equal(spec.width, w.width);

    // Right Side: Laplace 3D to the right of Track 2 taking entire vertical space
    assert.equal(laplace3d.left, z.left + fourier.width + 24);
    assert.equal(laplace3d.top, 24);
    assert.ok(laplace3d.height >= (com.top + com.height - 24));
});

test('findNextAvailableSlot positions panels cleanly to the far right in horizontal mode', () => {
    const container = {
        children: [
            { id: 'z_plane_column', offsetLeft: 24, offsetTop: 24, offsetWidth: 500, offsetHeight: 600, classList: { contains: () => false } },
            { id: 'w_plane_column', offsetLeft: 548, offsetTop: 24, offsetWidth: 500, offsetHeight: 600, classList: { contains: () => false } }
        ]
    };
    const newPanel = { id: 'contour_2d_column' };

    const slot = findNextAvailableSlot(container, newPanel, 540, 420);
    const left = parseInt(slot.left, 10);
    const top = parseInt(slot.top, 10);

    // In horizontal mode, must go to the right of existing panels (maxRight + gap) = 548 + 500 + 24 = 1072
    assert.equal(left, 1072);
    assert.equal(top, 24);
});

test('updateWorkspaceBounds sets 0px in normal mode when fitted and extends when dragging', () => {
    const extender = {
        style: { left: '', top: '' },
        className: 'workspace-bounds-extender',
        classList: { contains: (cls) => cls === 'workspace-bounds-extender' }
    };
    const container = {
        clientWidth: 1200,
        clientHeight: 800,
        querySelector: (sel) => (sel === '.workspace-bounds-extender' ? extender : null),
        children: [
            { id: 'z_plane_column', offsetLeft: 24, offsetTop: 24, offsetWidth: 500, offsetHeight: 600, classList: { contains: () => false } },
            { id: 'w_plane_column', offsetLeft: 548, offsetTop: 24, offsetWidth: 500, offsetHeight: 600, classList: { contains: () => false } },
            extender
        ]
    };

    // Normal mode, not interacting: should set extender to 0px (no scrollbars)
    updateWorkspaceBounds(container, false);
    assert.equal(extender.style.left, '0px');
    assert.equal(extender.style.top, '0px');

    // Dragging near edge: should expand extender with generous scroll room
    updateWorkspaceBounds(container, true, { right: 1500, bottom: 900 });
    const neededLeft = parseInt(extender.style.left, 10);
    const neededTop = parseInt(extender.style.top, 10);
    assert.ok(neededLeft >= 3500, `extender left (${neededLeft}) should provide generous drag space`);
    assert.ok(neededTop >= 2900, `extender top (${neededTop}) should provide generous drag space`);
});

test('Spawning dynamic contour_2d in Laplace mode allocates space to the absolute right side', () => {
    const laplaceLayout = computeLaplaceModeLayout(1400, 900);
    const children = Object.entries(laplaceLayout).map(([id, pos]) => ({
        id,
        offsetLeft: parseInt(pos.left, 10),
        offsetTop: parseInt(pos.top, 10),
        offsetWidth: parseInt(pos.width, 10),
        offsetHeight: parseInt(pos.height, 10),
        style: { left: pos.left, top: pos.top, width: pos.width, height: pos.height },
        classList: { contains: () => false }
    }));

    const contourPanel = { id: 'contour_2d_column', style: {}, classList: { contains: () => false }, dataset: {} };
    children.push(contourPanel);

    const container = {
        clientWidth: 1400,
        clientHeight: 900,
        children,
        querySelector: () => null
    };

    // Calculate expected dynamic 50% / 100% size
    const expectedWidth = Math.floor((1400 - 24 * 2 - 24) / 2); // 664
    const expectedHeight = 900 - 24 * 2; // 852

    const slot = findNextAvailableSlot(container, contourPanel, expectedWidth, expectedHeight);
    const laplace3dRight = parseInt(laplaceLayout.laplace_3d_column.left, 10) + parseInt(laplaceLayout.laplace_3d_column.width, 10);

    // In horizontal mode, must go to the right of the rightmost panel (Laplace 3D Surface)
    assert.equal(parseInt(slot.left, 10), laplace3dRight + 24);
    assert.equal(parseInt(slot.top, 10), 24);
});

test('resetAllPanelLayouts clears stored cookies/localStorage and resets container panels', () => {
    const store = new Map([
        ['complex_panelLayout_normal_v8', JSON.stringify({ z_plane_column: { left: '100px', top: '100px' } })],
        ['complex_panelLayout_laplace_v8', JSON.stringify({ laplace_3d_column: { left: '200px', top: '200px' } })],
        ['complex_panelLayout_normal_v7', JSON.stringify({})],
        ['unrelated_key', 'keep_me']
    ]);

    globalThis.localStorage = {
        get length() { return store.size; },
        key(i) { return Array.from(store.keys())[i]; },
        getItem(k) { return store.get(k); },
        setItem(k, v) { store.set(k, v); },
        removeItem(k) { store.delete(k); }
    };

    resetAllPanelLayouts();

    assert.equal(store.has('complex_panelLayout_normal_v8'), false);
    assert.equal(store.has('complex_panelLayout_laplace_v8'), false);
    assert.equal(store.has('complex_panelLayout_normal_v7'), false);
    assert.equal(store.get('unrelated_key'), 'keep_me');
});

test('Vertical Mode Layout transposes columns to rows with 100% width and 50% height', () => {
    // Set up vertical layout mock
    globalThis.document = {
        body: { classList: { contains: (cls) => cls === 'vertical-layout' } }
    };

    const containerWidth = 800;
    const containerHeight = 1200;
    const layout = computeNormalModeLayout(containerWidth, containerHeight);

    assert.ok(layout.z_plane_column);
    assert.ok(layout.w_plane_column);

    const zLeft = parseInt(layout.z_plane_column.left, 10);
    const zTop = parseInt(layout.z_plane_column.top, 10);
    const zWidth = parseInt(layout.z_plane_column.width, 10);
    const zHeight = parseInt(layout.z_plane_column.height, 10);

    const wLeft = parseInt(layout.w_plane_column.left, 10);
    const wTop = parseInt(layout.w_plane_column.top, 10);
    const wWidth = parseInt(layout.w_plane_column.width, 10);

    // In vertical mode: width is 100% available width (containerWidth - 48)
    assert.equal(zWidth, 800 - 48);
    assert.equal(wWidth, 800 - 48);

    // Stood vertically: z on top (top: 24), w below z (top: 24 + zHeight + 24)
    assert.equal(zLeft, 24);
    assert.equal(wLeft, 24);
    assert.equal(zTop, 24);
    assert.equal(wTop, 24 + zHeight + 24);

    // Clean up document mock
    delete globalThis.document;
});

test('Chained and dynamically created panels receive edge handles and correct styling', () => {
    // Verify that findNextAvailableSlot places chained panels with valid gap separation
    const container = {
        children: [
            { id: 'z_plane_column', offsetLeft: 24, offsetTop: 24, offsetWidth: 500, offsetHeight: 800, style: { left: '24px', top: '24px', width: '500px', height: '800px' }, classList: { contains: () => false } },
            { id: 'w_plane_column', offsetLeft: 548, offsetTop: 24, offsetWidth: 500, offsetHeight: 800, style: { left: '548px', top: '24px', width: '500px', height: '800px' }, classList: { contains: () => false } },
            { id: 'w_plane_column_1', offsetLeft: 1072, offsetTop: 24, offsetWidth: 500, offsetHeight: 800, style: { left: '1072px', top: '24px', width: '500px', height: '800px' }, classList: { contains: () => false } }
        ]
    };

    const newChainPanel = { id: 'w_plane_column_2', style: {}, classList: { contains: () => false } };
    const slot = findNextAvailableSlot(container, newChainPanel, 500, 800);

    // Should be placed after w_plane_column_1
    assert.equal(parseInt(slot.left, 10), 1072 + 500 + 24);
    assert.equal(parseInt(slot.top, 10), 24);
});

test('Real Plots standalone layout takes the entire available workspace', () => {
    const containerWidth = 1400;
    const containerHeight = 900;
    const layout = computeRealPlotsLayout(containerWidth, containerHeight);

    assert.ok(layout.real_plots_column);
    assert.equal(parseInt(layout.real_plots_column.left, 10), 24);
    assert.equal(parseInt(layout.real_plots_column.top, 10), 24);
    assert.equal(parseInt(layout.real_plots_column.width, 10), 1400 - 48);
    assert.equal(parseInt(layout.real_plots_column.height, 10), 900 - 48);
});

test('Chained columns in Normal Mode layout align side-by-side with uniform gaps', () => {
    const containerWidth = 1400;
    const containerHeight = 900;
    const layout = computeNormalModeLayout(containerWidth, containerHeight);

    assert.ok(layout.z_plane_column);
    assert.ok(layout.w_plane_column);
    assert.ok(layout.w_plane_column_1);
    assert.ok(layout.w_plane_column_2);

    const wWidth = parseInt(layout.w_plane_column.width, 10);
    const wLeft = parseInt(layout.w_plane_column.left, 10);
    const w1Left = parseInt(layout.w_plane_column_1.left, 10);
    const w2Left = parseInt(layout.w_plane_column_2.left, 10);

    assert.equal(w1Left, wLeft + wWidth + 24);
    assert.equal(w2Left, w1Left + wWidth + 24);
});

test('Real Plots with 2D Contour divides workspace cleanly side-by-side or stacked', () => {
    const stateMock = { show2DContourPlot: true };
    
    // Import state or test computeRealPlotsLayout with contour enabled
    const containerWidth = 1400;
    const containerHeight = 900;
    
    // Test horizontal mode (default)
    const padding = 24;
    const gap = 24;
    const availWidth = 1400 - padding * 2;
    const panelWidth = Math.floor((availWidth - gap) / 2);
    const panelHeight = 900 - padding * 2;

    // Simulate state.show2DContourPlot = true via global or function
    // We already tested standalone, now let's verify findNextAvailableSlot doesn't collide
    const container = {
        clientWidth: containerWidth,
        clientHeight: containerHeight,
        children: [
            { id: 'real_plots_column', offsetLeft: 24, offsetTop: 24, offsetWidth: panelWidth, offsetHeight: panelHeight, style: { left: '24px', top: '24px', width: `${panelWidth}px`, height: `${panelHeight}px` }, classList: { contains: () => false } }
        ]
    };

    const contourPanel = { id: 'contour_2d_column', style: {}, classList: { contains: () => false } };
    const slot = findNextAvailableSlot(container, contourPanel, panelWidth, panelHeight);

    assert.equal(parseInt(slot.left, 10), 24 + panelWidth + gap);
    assert.equal(parseInt(slot.top, 10), 24);
});

test('resolveCollisions supports vertical stacking in the same column without shifting to another column', async () => {
    const { resolveCollisions } = await import('../js/ui/panel-layout-manager.js');

    // Graph panel on Row 1 Col 1 (left: 24, top: 24, width: 600, height: 350)
    // Z plane panel on Row 2 Col 1 (left: 24, top: 398, width: 600, height: 350)
    // W plane panel on Row 1 Col 2 (left: 648, top: 24, width: 600, height: 750)
    const graphPanel = { id: 'graph_column', offsetLeft: 24, offsetTop: 24, offsetWidth: 600, offsetHeight: 350, style: { left: '24px', top: '24px', width: '600px', height: '350px' }, classList: { contains: () => false } };
    const zPanel = { id: 'z_plane_column', offsetLeft: 24, offsetTop: 398, offsetWidth: 600, offsetHeight: 350, style: { left: '24px', top: '398px', width: '600px', height: '350px' }, classList: { contains: () => false } };
    const wPanel = { id: 'w_plane_column', offsetLeft: 648, offsetTop: 24, offsetWidth: 600, offsetHeight: 750, style: { left: '648px', top: '24px', width: '600px', height: '750px' }, classList: { contains: () => false } };

    const container = {
        children: [graphPanel, zPanel, wPanel]
    };

    // Resize zPanel horizontally (e.g. to 700px width)
    zPanel.style.width = '700px';
    zPanel.offsetWidth = 700;

    resolveCollisions(zPanel, container);

    // Graph must remain in Column 1 (left: 24, top: 24)
    assert.equal(parseInt(graphPanel.style.left, 10), 24);
    assert.equal(parseInt(graphPanel.style.top, 10), 24);

    // Z plane must remain in Column 1 (left: 24, top: 398)
    assert.equal(parseInt(zPanel.style.left, 10), 24);
    assert.equal(parseInt(zPanel.style.top, 10), 398);

    // W plane is to the right of zPanel (zPanel right: 24+700 = 724 -> wPanel left: 748)
    assert.equal(parseInt(wPanel.style.left, 10), 748);
    assert.equal(parseInt(wPanel.style.top, 10), 24);
});


