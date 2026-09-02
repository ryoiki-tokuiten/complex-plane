import test from 'node:test';
import assert from 'node:assert/strict';

import {
    computeNormalModeLayout,
    computeLaplaceModeLayout,
    computeRealPlotsLayout,
    findNextAvailableSlot,
    updateWorkspaceBounds,
    resetAllPanelLayouts,
    positionContour2DPanel,
    positionNewPanel,
    refreshPanelLayout
} from '../js/ui/panel-layout-manager.js';
import { state } from '../js/store/state.js';

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

    // Padding is 0, gap is 24
    assert.equal(zLeft, 0);
    assert.equal(zTop, 0);
    assert.equal(wTop, 0);
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
    assert.ok(zHeight <= zoomedHeight, `z height must fit within zoomed height`);
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
    assert.equal(z.top, 0);
    assert.equal(w.top, 0);
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
    assert.equal(laplace3d.top, 0);
    assert.ok(laplace3d.height >= (com.top + com.height));
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
    assert.equal(parseInt(slot.top, 10), 0);
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

    const zPanel = { id: 'z_plane_column', offsetLeft: 100, offsetTop: 100, offsetWidth: 300, offsetHeight: 300, style: { left: '100px', top: '100px', width: '300px', height: '300px' }, classList: { contains: () => false }, dataset: { layoutInitialized: 'custom' } };
    const wPanel = { id: 'w_plane_column', offsetLeft: 450, offsetTop: 100, offsetWidth: 300, offsetHeight: 300, style: { left: '450px', top: '100px', width: '300px', height: '300px' }, classList: { contains: () => false }, dataset: { layoutInitialized: 'custom' } };
    const extender = { style: {} };
    const container = {
        clientWidth: 1200,
        clientHeight: 700,
        children: [zPanel, wPanel],
        querySelector: sel => sel === '.workspace-bounds-extender' ? extender : null
    };
    globalThis.document = {
        querySelector: sel => sel === '.canvas-row.two-column-layout' ? container : null,
        body: { classList: { contains: () => false } }
    };

    resetAllPanelLayouts();
    delete globalThis.document;
    delete globalThis.localStorage;

    assert.equal(store.has('complex_panelLayout_normal_v8'), false);
    assert.equal(store.has('complex_panelLayout_laplace_v8'), false);
    assert.equal(store.has('complex_panelLayout_normal_v7'), false);
    assert.equal(store.get('unrelated_key'), 'keep_me');

    // Panels must be reset to default layout coordinates immediately (z at 0, w at width+gap)
    assert.equal(parseInt(zPanel.style.left, 10), 0);
    assert.equal(parseInt(zPanel.style.top, 10), 0);
    assert.ok(parseInt(wPanel.style.left, 10) > parseInt(zPanel.style.left, 10));
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

    // In vertical mode: width is 100% available width (containerWidth)
    assert.equal(zWidth, 800);
    assert.equal(wWidth, 800);

    // Stood vertically: z on top (top: 0), w below z (top: zHeight + 24)
    assert.equal(zLeft, 0);
    assert.equal(wLeft, 0);
    assert.equal(zTop, 0);
    assert.equal(wTop, zHeight + 24);

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
    assert.equal(parseInt(layout.real_plots_column.left, 10), 0);
    assert.equal(parseInt(layout.real_plots_column.top, 10), 0);
    assert.equal(parseInt(layout.real_plots_column.width, 10), 1400);
    assert.equal(parseInt(layout.real_plots_column.height, 10), 900);
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

    // Graph must remain in Column 1 (left: 0, top: 0)
    assert.equal(parseInt(graphPanel.style.left, 10), 0);
    assert.equal(parseInt(graphPanel.style.top, 10), 0);

    // Z plane must remain in Column 1 (left: 0, top: 374)
    assert.equal(parseInt(zPanel.style.left, 10), 0);
    assert.equal(parseInt(zPanel.style.top, 10), 374);

    // W plane is to the right of zPanel (zPanel right: 0+700 = 700 -> wPanel left: 724)
    assert.equal(parseInt(wPanel.style.left, 10), 724);
    assert.equal(parseInt(wPanel.style.top, 10), 0);
});

test('positionContour2DPanel places contour_2d to absolute right in horizontal mode', () => {
    const zPanel = { id: 'z_plane_column', offsetLeft: 24, offsetTop: 24, offsetWidth: 500, offsetHeight: 700, style: { left: '24px', top: '24px', width: '500px', height: '700px' }, classList: { contains: () => false } };
    const wPanel = { id: 'w_plane_column', offsetLeft: 548, offsetTop: 24, offsetWidth: 500, offsetHeight: 700, style: { left: '548px', top: '24px', width: '500px', height: '700px' }, classList: { contains: () => false } };
    const contourPanel = { id: 'contour_2d_column', style: {}, classList: { contains: () => false } };
    const extender = { style: {} };

    const container = {
        clientWidth: 1400,
        clientHeight: 800,
        children: [zPanel, wPanel, contourPanel],
        querySelector: sel => sel === '#contour_2d_column' ? contourPanel : (sel === '.workspace-bounds-extender' ? extender : null)
    };

    positionContour2DPanel(container);

    // In horizontal mode, contour_2d must go to the absolute right of wPanel (524 + 500 + 24 = 1048)
    assert.equal(parseInt(contourPanel.style.left, 10), 1048);
    assert.equal(parseInt(contourPanel.style.top, 10), 0);
});

test('positionContour2DPanel places contour_2d to absolute bottom in vertical mode', () => {
    globalThis.document = {
        body: { classList: { contains: cls => cls === 'vertical-layout' } }
    };

    const zPanel = { id: 'z_plane_column', offsetLeft: 24, offsetTop: 24, offsetWidth: 800, offsetHeight: 350, style: { left: '24px', top: '24px', width: '800px', height: '350px' }, classList: { contains: () => false } };
    const wPanel = { id: 'w_plane_column', offsetLeft: 24, offsetTop: 398, offsetWidth: 800, offsetHeight: 350, style: { left: '24px', top: '398px', width: '800px', height: '350px' }, classList: { contains: () => false } };
    const contourPanel = { id: 'contour_2d_column', style: {}, classList: { contains: () => false } };
    const extender = { style: {} };

    const container = {
        clientWidth: 900,
        clientHeight: 1000,
        children: [zPanel, wPanel, contourPanel],
        querySelector: sel => sel === '#contour_2d_column' ? contourPanel : (sel === '.workspace-bounds-extender' ? extender : null)
    };

    positionContour2DPanel(container);
    delete globalThis.document;

    // In vertical mode, contour_2d must go to the absolute bottom of wPanel
    assert.equal(parseInt(contourPanel.style.left, 10), 0);
    assert.equal(parseInt(contourPanel.style.top, 10), 748);
});

test('positionNewPanel automatically positions any new panel to absolute right and resolves collisions', () => {
    const zPanel = { id: 'z_plane_column', offsetLeft: 24, offsetTop: 24, offsetWidth: 500, offsetHeight: 700, style: { left: '24px', top: '24px', width: '500px', height: '700px' }, classList: { contains: () => false } };
    const wPanel = { id: 'w_plane_column', offsetLeft: 548, offsetTop: 24, offsetWidth: 500, offsetHeight: 700, style: { left: '548px', top: '24px', width: '500px', height: '700px' }, classList: { contains: () => false } };
    const graphPanel = { id: 'graph_column', style: {}, classList: { contains: () => false } };
    const extender = { style: {} };

    const container = {
        clientWidth: 1800,
        clientHeight: 800,
        children: [zPanel, wPanel, graphPanel],
        querySelector: sel => sel === '.workspace-bounds-extender' ? extender : null
    };

    positionNewPanel(graphPanel, container);

    // graph_column must be placed to the right of wPanel (524 + 500 + 24 = 1048)
    assert.equal(parseInt(graphPanel.style.left, 10), 1048);
    assert.equal(parseInt(graphPanel.style.top, 10), 0);
});

test('switching between horizontal and vertical layout properly resets panel geometry without leaking', () => {
    const zPanel = { id: 'z_plane_column', offsetLeft: 24, offsetTop: 24, offsetWidth: 500, offsetHeight: 700, style: { left: '24px', top: '24px', width: '500px', height: '700px' }, classList: { contains: () => false }, dataset: {} };
    const wPanel = { id: 'w_plane_column', offsetLeft: 548, offsetTop: 24, offsetWidth: 500, offsetHeight: 700, style: { left: '548px', top: '24px', width: '500px', height: '700px' }, classList: { contains: () => false }, dataset: {} };
    const extender = { style: {} };

    const container = {
        clientWidth: 1000,
        clientHeight: 1200,
        children: [zPanel, wPanel],
        querySelector: sel => sel === '.workspace-bounds-extender' ? extender : null
    };

    globalThis.document = {
        querySelector: sel => sel === '.canvas-row.two-column-layout' ? container : (sel === '.workspace-bounds-extender' ? extender : null),
        body: { classList: { contains: cls => cls === 'vertical-layout' } }
    };

    // Trigger layout refresh in vertical mode
    refreshPanelLayout();

    delete globalThis.document;

    // In vertical mode (width=1000, pad=0): panel width should be 1000 (not the old horizontal 500px)
    assert.equal(parseInt(zPanel.style.width, 10), 1000);
    assert.equal(parseInt(wPanel.style.width, 10), 1000);

    // Panels must stack vertically (left: 0, wPanel below zPanel)
    assert.equal(parseInt(zPanel.style.left, 10), 0);
    assert.equal(parseInt(wPanel.style.left, 10), 0);
    assert.ok(parseInt(wPanel.style.top, 10) > parseInt(zPanel.style.top, 10));
});

test('positionNewPanel automatically positions any new panel to absolute bottom in vertical mode', () => {
    globalThis.document = {
        body: { classList: { contains: cls => cls === 'vertical-layout' } }
    };

    const zPanel = { id: 'z_plane_column', offsetLeft: 24, offsetTop: 24, offsetWidth: 800, offsetHeight: 350, style: { left: '24px', top: '24px', width: '800px', height: '350px' }, classList: { contains: () => false } };
    const wPanel = { id: 'w_plane_column', offsetLeft: 24, offsetTop: 398, offsetWidth: 800, offsetHeight: 350, style: { left: '24px', top: '398px', width: '800px', height: '350px' }, classList: { contains: () => false } };
    const graphPanel = { id: 'graph_column', style: {}, classList: { contains: () => false } };
    const extender = { style: {} };

    const container = {
        clientWidth: 900,
        clientHeight: 1000,
        children: [zPanel, wPanel, graphPanel],
        querySelector: sel => sel === '.workspace-bounds-extender' ? extender : null
    };

    positionNewPanel(graphPanel, container);
    delete globalThis.document;

    // In vertical mode, graphPanel must go below wPanel
    assert.equal(parseInt(graphPanel.style.left, 10), 0);
    assert.equal(parseInt(graphPanel.style.top, 10), 748);
});

test('Laplace and Real Plots modes maintain pristine layouts independently from custom Normal mode panels', () => {
    const store = new Map();
    // Simulate user messing up Normal mode panels and saving to localStorage
    store.set('complex_panelLayout_normal_horiz_v8', JSON.stringify({
        z_plane_column: { left: '333px', top: '222px', width: '250px', height: '250px' },
        w_plane_column: { left: '666px', top: '222px', width: '250px', height: '250px' }
    }));

    globalThis.localStorage = {
        get length() { return store.size; },
        key(i) { return Array.from(store.keys())[i]; },
        getItem(k) { return store.get(k); },
        setItem(k, v) { store.set(k, v); },
        removeItem(k) { store.delete(k); }
    };

    const zPanel = { id: 'z_plane_column', offsetLeft: 333, offsetTop: 222, offsetWidth: 250, offsetHeight: 250, style: { left: '333px', top: '222px', width: '250px', height: '250px' }, classList: { contains: () => false }, dataset: {} };
    const wPanel = { id: 'w_plane_column', offsetLeft: 666, offsetTop: 222, offsetWidth: 250, offsetHeight: 250, style: { left: '666px', top: '222px', width: '250px', height: '250px' }, classList: { contains: () => false }, dataset: {} };
    const fourierPanel = { id: 'fourier_3d_column', style: {}, classList: { contains: cls => cls === 'hidden' }, dataset: {} };
    const comPanel = { id: 'laplace_com_column', style: {}, classList: { contains: cls => cls === 'hidden' }, dataset: {} };
    const specPanel = { id: 'laplace_spectrum_column', style: {}, classList: { contains: cls => cls === 'hidden' }, dataset: {} };
    const l3dPanel = { id: 'laplace_3d_column', style: {}, classList: { contains: cls => cls === 'hidden' }, dataset: {} };
    const realPlotsPanel = { id: 'real_plots_column', style: {}, classList: { contains: cls => cls === 'hidden' }, dataset: {} };
    const extender = { style: {} };

    const container = {
        clientWidth: 1400,
        clientHeight: 900,
        children: [zPanel, wPanel, fourierPanel, comPanel, specPanel, l3dPanel, realPlotsPanel],
        querySelector: sel => sel === '.workspace-bounds-extender' ? extender : null
    };

    globalThis.document = {
        querySelector: sel => sel === '.canvas-row.two-column-layout' ? container : (sel === '.workspace-bounds-extender' ? extender : null),
        body: { classList: { contains: () => false } }
    };

    // 1. Switch to Laplace mode: unhide Laplace panels
    state.laplaceModeEnabled = true;
    fourierPanel.classList.contains = () => false;
    comPanel.classList.contains = () => false;
    specPanel.classList.contains = () => false;
    l3dPanel.classList.contains = () => false;

    refreshPanelLayout();

    // In Laplace mode: zPanel and wPanel must NOT have the old 333px/666px custom Normal positions
    const laplaceDefault = computeLaplaceModeLayout(1400, 900);
    assert.equal(zPanel.style.left, laplaceDefault.z_plane_column.left);
    assert.equal(zPanel.style.top, laplaceDefault.z_plane_column.top);
    assert.equal(wPanel.style.left, laplaceDefault.w_plane_column.left);
    assert.equal(fourierPanel.style.left, laplaceDefault.fourier_3d_column.left);
    assert.equal(fourierPanel.style.top, laplaceDefault.fourier_3d_column.top);
    assert.equal(l3dPanel.style.left, laplaceDefault.laplace_3d_column.left);

    // 2. Switch to Real Plots mode: hide Laplace and Normal, unhide Real Plots
    state.laplaceModeEnabled = false;
    state.realPlotsEnabled = true;
    zPanel.classList.contains = cls => cls === 'hidden';
    wPanel.classList.contains = cls => cls === 'hidden';
    fourierPanel.classList.contains = cls => cls === 'hidden';
    comPanel.classList.contains = cls => cls === 'hidden';
    specPanel.classList.contains = cls => cls === 'hidden';
    l3dPanel.classList.contains = cls => cls === 'hidden';
    realPlotsPanel.classList.contains = () => false;

    refreshPanelLayout();

    // Real Plots must fill the workspace completely (width = 1400, height = 900)
    assert.equal(parseInt(realPlotsPanel.style.left, 10), 0);
    assert.equal(parseInt(realPlotsPanel.style.top, 10), 0);
    assert.equal(parseInt(realPlotsPanel.style.width, 10), 1400);
    assert.equal(parseInt(realPlotsPanel.style.height, 10), 900);

    // 3. Switch back to Normal mode: custom 250px width/height layout must be cleanly restored
    state.laplaceModeEnabled = false;
    state.realPlotsEnabled = false;
    zPanel.classList.contains = () => false;
    wPanel.classList.contains = () => false;
    realPlotsPanel.classList.contains = cls => cls === 'hidden';

    refreshPanelLayout();

    assert.equal(zPanel.style.width, '250px');
    assert.equal(zPanel.style.height, '250px');
    assert.equal(wPanel.style.width, '250px');
    assert.equal(wPanel.style.height, '250px');

    delete globalThis.document;
    delete globalThis.localStorage;
});



