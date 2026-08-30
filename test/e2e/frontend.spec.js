import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('./', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.getElementById('preloader') || document.getElementById('preloader')?.style.display === 'none', { timeout: 15000 }).catch(() => {});
    await expect(page.locator('#image_resolution_slider')).toHaveCount(0);
    await expect(page.locator('#video_resolution_slider')).toHaveCount(0);
});

async function selectInputShape(page, shape) {
    await page.locator('#input_shape_picker_toggle').click();
    const nestedItem = page.locator(`#input_shape_more_menu [data-input-shape="${shape}"]`);
    if (await nestedItem.count()) {
        await page.locator('.input-shape-more-item').hover();
        await nestedItem.click();
    } else {
        await page.locator(`#input_shape_menu > [data-input-shape="${shape}"]`).click();
    }
    await expect(page.locator('#input_shape_selector')).toHaveValue(shape);
}

test('Riemann surface shaders compile with branch-cut controls', async ({ page }) => {
    const shaderErrors = [];
    page.on('console', message => {
        if (message.text().includes('WebGL shader compile error')) shaderErrors.push(message.text());
    });

    await page.click('#select_ln_btn');
    const rendered = await page.evaluate(async () => {
        const { renderRiemannSurface } = await import('./js/rendering/webgl-riemann-surface.js');
        return renderRiemannSurface(document.getElementById('w_plane_canvas'), { stage: 1 });
    });
    expect(rendered).toBe(true);
    await expect(page.locator('.riemann-surface-canvas')).toHaveCount(1);
    expect(shaderErrors).toEqual([]);
});

test('Riemann surfaces support the full Taylor control range', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
    });

    await page.click('#select_cos_btn');
    const result = await page.evaluate(async () => {
        const { state } = await import('./js/store/state.js');
        const slider = document.getElementById('taylor_series_order_slider');
        slider.value = '15';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        state.taylorSeriesCenter = { re: 1, im: 0 };
        state.taylorSeriesEnabled = true;
        const { renderRiemannSurface } = await import('./js/rendering/webgl-riemann-surface.js');
        return {
            order: state.taylorSeriesOrder,
            rendered: renderRiemannSurface(document.getElementById('w_plane_canvas'), { stage: 1 })
        };
    });

    expect(result).toEqual({ order: 15, rendered: true });
    expect(errors).toEqual([]);
});

test('branch-aware algebraic Riemann shaders compile', async ({ page }) => {
    const shaderErrors = [];
    page.on('console', message => {
        if (message.text().includes('WebGL shader compile error')) shaderErrors.push(message.text());
    });
    await page.locator('#enable_algebraic_chaining_cb').evaluate(element => {
        element.checked = true;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#algebraic_chaining_z_input').fill('sqrt(z) + ln(z)');
    const rendered = await page.evaluate(async () => {
        const { renderRiemannSurface } = await import('./js/rendering/webgl-riemann-surface.js');
        return renderRiemannSurface(document.getElementById('w_plane_canvas'), { stage: 1 });
    });
    expect(rendered).toBe(true);
    expect(shaderErrors).toEqual([]);
});

test('Riemann surface stays rendered while algebraic and output chaining state changes', async ({ page }) => {
    test.setTimeout(60000);

    const expectRenderedSurface = async surface => {
        await expect.poll(
            async () => (await surface.screenshot({ animations: 'disabled' })).byteLength,
            { timeout: 20000 }
        ).toBeGreaterThan(20000);
    };

    await page.locator('#w_plane_canvas_wrapper').click({ button: 'right' });
    await page.locator('#plane_context_menu .plane-context-menu-item:has-text("Riemann Surface")').click();

    await expect(page.locator('.riemann-surface-canvas')).toHaveCount(1, { timeout: 15000 });
    await expect(page.locator('#w_plane_canvas')).toHaveClass(/hidden/);

    await page.locator('#select_custom_complex_btn').click();
    await page.locator('#add_algebraic_term_btn').click();
    await expect(page.locator('#w_plane_canvas')).toHaveClass(/hidden/);
    await expect(page.locator('.riemann-surface-canvas')).toBeVisible();
    await expectRenderedSurface(page.locator('.riemann-surface-canvas'));

    await page.locator('#enable_chaining_cb').evaluate(element => {
        element.checked = true;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#w_plane_canvas')).toHaveClass(/hidden/);
    await expect(page.locator('.riemann-surface-canvas')).toBeVisible();
    await expectRenderedSurface(page.locator('.riemann-surface-canvas'));
});

test('arbitrary shapes support freehand drawing without Cauchy mode', async ({ page }) => {
    await selectInputShape(page, 'arbitrary');
    await expect(page.locator('#arbitrary_shape_controls')).not.toHaveClass(/hidden/);
    const cauchyActive = await page.evaluate(async () => (await import('./js/store/state.js')).state.cauchyIntegralModeEnabled);
    expect(cauchyActive).toBe(false);

    await expect(page.locator('#drawn_arbitrary_shape_controls')).not.toHaveClass(/hidden/);

    const canvas = page.locator('#z_plane_canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.35, { steps: 4 });
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5, { steps: 4 });
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.65, { steps: 4 });
    await page.mouse.up();

    await expect(page.locator('#arbitrary_shape_draw_status')).toContainText('sampled points');

    const firstCount = await page.evaluate(async () => (await import('./js/store/state.js')).state.arbitraryShapePoints.length);
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.6, { steps: 4 });
    await page.mouse.up();
    const points = await page.evaluate(async () => (await import('./js/store/state.js')).state.arbitraryShapePoints);
    expect(points.length).toBeGreaterThan(firstCount);
    expect(points.some(point => point === null)).toBe(true);
});

test('Preact controls preserve the public DOM and interaction contract', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
    });

    await expect(page.locator('#theme_list_container .theme-card')).toHaveCount(6);
    await expect(page.locator('#domain_palette_circles button')).toHaveCount(8);
    await expect(page.locator('#real_plots_palette_circles button')).toHaveCount(6);
    await expect(page.locator('#polynomial_coeffs_container .polynomial-coeff-row')).toHaveCount(3);
    await expect(page.locator('#taylor_complex_points_ui_container button')).toHaveCount(16);
    await expect(page.locator('#algebraic_terms_list .algebraic-term-card')).toHaveCount(1);
    await expect(page.locator('#dynamic_example_gallery .dynamic-example-button')).toHaveCount(14);
    await expect(page.locator('#dynamic_term_factors .dynamic-term-factor-card')).toHaveCount(1);
    await expect(page.locator('#dynamic_parameters_list .dynamic-parameter-card')).toHaveCount(1);

    await page.click('#theme_selector_btn');
    await expect(page.locator('#theme_modal')).not.toHaveClass(/hidden/);
    await page.locator('.theme-card').nth(1).click();
    await expect(page.locator('.theme-card.active')).toHaveCount(1);
    await page.locator('#enable_vertical_layout_cb').evaluate(element => {
        element.checked = true;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('body')).toHaveClass(/vertical-layout/);

    await page.locator('#enable_vertical_layout_cb').evaluate(element => {
        element.checked = false;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('body')).not.toHaveClass(/vertical-layout/);

    await page.click('#close_theme_modal_btn');
    await expect(page.locator('#theme_modal')).toHaveClass(/hidden/);

    await page.locator('#polynomialN_slider').evaluate(element => {
        element.value = '4';
        element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#polynomial_coeffs_container .polynomial-coeff-row')).toHaveCount(5);

    await page.locator('#grid_density_slider').evaluate(element => {
        element.value = '21';
        element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#grid_density_value_display')).toHaveText('21');

    await page.locator('#enable_algebraic_chaining_cb').evaluate(element => {
        element.checked = true;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#add_algebraic_term_btn').evaluate(element => element.click());
    await expect(page.locator('#algebraic_terms_list .algebraic-term-card')).toHaveCount(2);

    await page.locator('#taylor_complex_points_ui_container button').nth(2).evaluate(element => element.click());
    await expect(page.locator('#taylor_complex_points_ui_container .toggle-active')).toHaveCount(1);

    await page.locator('#domain_palette_circles button').nth(1).evaluate(element => element.click());
    await expect(page.locator('#domain_palette_circles button.active')).toHaveCount(1);
    await page.locator('#view_palette_circle_btn').evaluate(element => element.click());
    await expect(page.locator('#domain_palette_circle_panel')).not.toHaveClass(/hidden/);

    await page.locator('#dynamic_add_parameter_btn').evaluate(element => element.click());
    await page.locator('#dynamic_add_numerator_factor_btn').evaluate(element => element.click());
    await expect(page.locator('#dynamic_parameters_list .dynamic-parameter-card')).toHaveCount(2);
    await expect(page.locator('#dynamic_term_factors .dynamic-term-factor-card')).toHaveCount(2);

    await page.locator('#dynamic_term_expression').evaluate(element => {
        element.value = 'a';
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#dynamic_sequence_bindings_list .dynamic-sequence-binding-card')).toHaveCount(1);
    await page.locator('#dynamic_sequence_bindings_list select').evaluate(element => {
        element.value = 'arithmetic';
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#dynamic_sequence_bindings_list input[type="number"]')).toHaveCount(2);

    await page.locator('#select_real_plots_btn').click();
    await expect(page.locator('#real_plots_controls_container')).not.toHaveClass(/hidden/);
    await expect(page.locator('#core_application_controls')).toHaveClass(/hidden/);
    await expect(page.locator('#algebraic_chaining_params')).not.toHaveClass(/hidden/);
    await expect(page.locator('#real_plots_contours_cb')).toHaveCount(0);
    for (const part of ['input', 'imag']) {
        await page.locator(`#real_plots_${part}_preset`).selectOption('custom');
        await expect(page.locator(`#real_plots_custom_${part}_container`)).not.toHaveClass(/hidden/);
        await page.locator(`#real_plots_custom_${part}`).fill(part === 'input' ? 'x + y' : 'x - y');
    }
    await page.locator('#select_laplace_btn').click();
    await expect(page.locator('#real_plots_controls_container')).toHaveClass(/hidden/);
    await expect(page.locator('#algebraic_chaining_params')).toHaveClass(/hidden/);
    expect(errors).toEqual([]);
});

test('panels automatically move right or bottom in cascading fashion when another panel takes their place', async ({ page }) => {
    const displacementResult = await page.evaluate(async () => {
        const { resolveCollisions } = await import('./js/ui/panel-layout-manager.js');
        const container = document.querySelector('.canvas-row.two-column-layout');
        const zPanel = document.getElementById('z_plane_column');
        const wPanel = document.getElementById('w_plane_column');
        const graphPanel = document.getElementById('graph_column');

        // Setup 3 visible panels in horizontal mode
        graphPanel.classList.remove('hidden');
        document.body.classList.remove('vertical-layout');

        zPanel.style.left = '24px';
        zPanel.style.top = '24px';
        zPanel.style.width = '400px';
        zPanel.style.height = '400px';

        wPanel.style.left = '448px';
        wPanel.style.top = '24px';
        wPanel.style.width = '400px';
        wPanel.style.height = '400px';

        graphPanel.style.left = '872px';
        graphPanel.style.top = '24px';
        graphPanel.style.width = '400px';
        graphPanel.style.height = '400px';

        // Drop active panel (e.g. a newly placed panel or graphPanel) directly on top of zPanel (at left: 24px)
        graphPanel.style.left = '24px';
        resolveCollisions(graphPanel, container);

        const horizontalRes = {
            graphLeft: parseInt(graphPanel.style.left, 10),
            zLeft: parseInt(zPanel.style.left, 10),
            wLeft: parseInt(wPanel.style.left, 10)
        };

        // Now test vertical mode
        document.body.classList.add('vertical-layout');
        zPanel.style.left = '24px';
        zPanel.style.top = '24px';
        zPanel.style.width = '400px';
        zPanel.style.height = '300px';

        wPanel.style.left = '24px';
        wPanel.style.top = '348px';
        wPanel.style.width = '400px';
        wPanel.style.height = '300px';

        graphPanel.style.left = '24px';
        graphPanel.style.top = '672px';
        graphPanel.style.width = '400px';
        graphPanel.style.height = '300px';

        // Drop active panel at top: 24px (where zPanel was)
        graphPanel.style.top = '24px';
        resolveCollisions(graphPanel, container);

        const verticalRes = {
            graphTop: parseInt(graphPanel.style.top, 10),
            zTop: parseInt(zPanel.style.top, 10),
            wTop: parseInt(wPanel.style.top, 10)
        };

        document.body.classList.remove('vertical-layout');
        graphPanel.classList.add('hidden');

        return { horizontalRes, verticalRes };
    });

    // Horizontal verification: graph at 24px, z pushed to 24+400+24 = 448px, w pushed to 448+400+24 = 872px
    expect(displacementResult.horizontalRes.graphLeft).toBe(24);
    expect(displacementResult.horizontalRes.zLeft).toBeGreaterThanOrEqual(448);
    expect(displacementResult.horizontalRes.wLeft).toBeGreaterThanOrEqual(872);

    // Vertical verification: graph at 24px, z pushed down to 24+300+24 = 348px, w pushed down to 348+300+24 = 672px
    expect(displacementResult.verticalRes.graphTop).toBe(24);
    expect(displacementResult.verticalRes.zTop).toBeGreaterThanOrEqual(348);
    expect(displacementResult.verticalRes.wTop).toBeGreaterThanOrEqual(672);
});

test('grid selector keeps extended grids in its More submenu and custom context menus function', async ({ page }) => {
    await page.locator('#input_shape_picker_toggle').click();
    await expect(page.locator('#input_shape_menu')).toBeVisible();
    await expect(page.locator('#input_shape_picker_toggle > [aria-hidden="true"]')).toHaveCount(0);
    const mainItems = await page.locator(
        '#input_shape_menu > button, #input_shape_menu > .input-shape-more-item > button'
    ).evaluateAll(buttons => buttons.map(button => button.textContent.replace(/\s+/g, ' ').trim()));
    expect(mainItems).toEqual([
        'Empty',
        'Grid (Cartesian)',
        'Cartesian-Log',
        'Polar',
        'Polar-Log',
        'Dots',
        'Arbitrary Shape',
        'Lines',
        'Circle',
        'Media',
        'Navigate',
        'More‹'
    ]);
    const moreItem = page.locator('.input-shape-more-item');
    const moreMenu = page.locator('#input_shape_more_menu');
    await moreItem.hover();
    await expect(moreMenu).toBeVisible();
    expect(await page.locator('#input_shape_more_menu [data-input-shape]').allInnerTexts()).toEqual([
        'Rectilinear Grid',
        'Non-orthogonal Grid',
        'Triangular Grid',
        'Curvilinear Grid',
        'Spiral Grid',
        'Irregular-spaced Grid'
    ]);
    const moreItemBox = await moreItem.boundingBox();
    const moreMenuBox = await moreMenu.boundingBox();
    expect(moreItemBox.x - (moreMenuBox.x + moreMenuBox.width)).toBeGreaterThanOrEqual(8);
    await page.mouse.move(
        moreMenuBox.x + moreMenuBox.width - 2,
        moreItemBox.y + moreItemBox.height / 2,
        { steps: 12 }
    );
    await expect(moreMenu).toBeVisible();
    await page.locator('#input_shape_more_menu [data-input-shape="grid_triangular"]').click();
    await expect(page.locator('#grid_shape_controls_overlay')).not.toHaveClass(/hidden/);
    await expect(page.locator('#grid_triangular_controls')).not.toHaveClass(/hidden/);
    await expect(page.locator('#input_shape_selector')).toHaveValue('grid_triangular');
    await expect(page.locator('[data-input-shape-label]')).toHaveText('Triangular Grid');

    await page.evaluate(async () => {
        const { state } = await import('./js/store/state.js');
        state.vectorFieldEnabled = true;
    });
    await expect(page.locator('#grid_shape_controls_overlay')).toHaveAttribute('data-position', 'bottom-left');
    const canvasBox = await page.locator('#z_plane_canvas').boundingBox();
    await page.mouse.move(canvasBox.x + 80, canvasBox.y + 80);
    await expect(page.locator('#z_plane_probe_info')).toBeVisible();
    await expect(page.locator('#grid_shape_controls_overlay')).toHaveAttribute('data-position', 'bottom-left');

    await page.evaluate(async () => {
        const { state } = await import('./js/store/state.js');
        state.radialDiscreteStepsEnabled = true;
    });
    await expect(page.locator('#grid_shape_controls_overlay')).toHaveAttribute('data-position', 'top-left');
    const overlaysDoNotOverlap = await page.evaluate(() => {
        const panel = document.getElementById('grid_shape_controls_overlay').getBoundingClientRect();
        return ['vector_flow_canvas_overlay', 'radial_discrete_steps_options_div'].every(id => {
            const rect = document.getElementById(id).getBoundingClientRect();
            return panel.right <= rect.left || panel.left >= rect.right ||
                panel.bottom <= rect.top || panel.top >= rect.bottom;
        });
    });
    expect(overlaysDoNotOverlap).toBe(true);
    await expect(page.locator('#ellipse_params_slider_group')).toHaveCount(0);

    // 1. Z-plane right click
    await page.locator('#z_plane_canvas_wrapper').click({ button: 'right' });
    const zMenu = page.locator('#plane_context_menu');
    await expect(zMenu).toBeVisible();

    // Verify initial z-plane menu items
    await expect(zMenu.locator('.plane-context-menu-item:has-text("Download Image")')).toBeVisible();
    await expect(zMenu.locator('.plane-context-menu-item:has-text("Domain Coloring")')).toBeVisible();
    await expect(zMenu.locator('.plane-context-menu-item:has-text("Analysis")')).toBeVisible();
    await expect(zMenu.locator('.plane-context-menu-item:has-text("Vector Field")')).toBeVisible();
    await expect(zMenu.locator('.plane-context-menu-item:has-text("Take radial steps")')).toBeVisible();
    // Derivative and Taylor series should NOT be visible on z-plane when domain coloring is disabled
    await expect(zMenu.locator('.plane-context-menu-item:has-text("Show derivative")')).toHaveCount(0);
    await expect(zMenu.locator('.plane-context-menu-item:has-text("Taylor Series")')).toHaveCount(0);

    // Hover Analysis and toggle zeroes & poles in submenu
    const analysisItem = zMenu.locator('.plane-context-menu-item:has-text("Analysis")');
    await analysisItem.hover();
    const subMenu = page.locator('#plane_context_submenu');
    await expect(subMenu).toBeVisible();
    await expect(subMenu.locator('.plane-context-menu-item:has-text("Show zeroes & poles")')).toBeVisible();
    await expect(subMenu.locator('.plane-context-menu-item:has-text("Show critical points")')).toBeVisible();
    await expect(subMenu.locator('.plane-context-menu-item:has-text("Cauchy Integral")')).toBeVisible();
    await expect(subMenu.locator('.plane-context-menu-item:has-text("Conformal Grid")')).toBeVisible();

    const analysisBox = await analysisItem.boundingBox();
    const contextSubmenuBox = await subMenu.boundingBox();
    const submenuOpensRight = contextSubmenuBox.x > analysisBox.x;
    const submenuGap = submenuOpensRight
        ? contextSubmenuBox.x - (analysisBox.x + analysisBox.width)
        : analysisBox.x - (contextSubmenuBox.x + contextSubmenuBox.width);
    expect(submenuGap).toBeGreaterThanOrEqual(8);
    await expect(page.locator('#plane_context_submenu_bridge')).toBeVisible();
    await page.mouse.move(
        submenuOpensRight ? contextSubmenuBox.x + 2 : contextSubmenuBox.x + contextSubmenuBox.width - 2,
        analysisBox.y + analysisBox.height / 2,
        { steps: 12 }
    );
    await expect(subMenu).toBeVisible();

    await subMenu.locator('.plane-context-menu-item:has-text("Show zeroes & poles")').click();
    await expect(zMenu).toBeHidden();
    const zerosPolesState = await page.evaluate(async () => {
        const { state } = await import('./js/store/state.js');
        return state.showZerosPoles;
    });
    expect(zerosPolesState).toBe(true);

    // Enable domain coloring and right click z-plane again
    await page.evaluate(async () => {
        const { state } = await import('./js/store/state.js');
        state.domainColoringEnabled = true;
    });
    await page.locator('#z_plane_canvas_wrapper').click({ button: 'right' });
    await expect(zMenu.locator('.plane-context-menu-item:has-text("Show derivative")')).toBeVisible();
    await expect(zMenu.locator('.plane-context-menu-item:has-text("Taylor Series")')).toBeVisible();
    await expect(zMenu.locator('.plane-context-menu-item:has-text("Vector Field")')).toBeVisible();

    await zMenu.locator('.plane-context-menu-item:has-text("Vector Field")').hover();
    await expect(page.locator('#plane_context_submenu')).toBeVisible();
    await expect(page.locator('#plane_context_submenu .plane-context-menu-item:has-text("Vector Field")')).toBeVisible();
    await expect(page.locator('#plane_context_submenu .plane-context-menu-item:has-text("Streamlines")')).toBeVisible();
    await expect(page.locator('#plane_context_submenu .plane-context-menu-item:has-text("Particle Motion")')).toBeVisible();

    // Dismiss with Escape
    await page.keyboard.press('Escape');
    await expect(zMenu).toBeHidden();

    // 2. W-plane right click
    await page.locator('#w_plane_canvas_wrapper').click({ button: 'right' });
    await expect(zMenu).toBeVisible();

    await expect(zMenu.locator('.plane-context-menu-item:has-text("Download Image")')).toBeVisible();
    await expect(zMenu.locator('.plane-context-menu-item:has-text("Show Derivative")')).toBeVisible();
    await expect(zMenu.locator('.plane-context-menu-item:has-text("Taylor Series")')).toBeVisible();
    await expect(zMenu.locator('.plane-context-menu-item:has-text("Show folds in 3d")')).toBeVisible();
    await expect(zMenu.locator('.plane-context-menu-item:has-text("3D Manifolds")')).toBeVisible();
    await expect(zMenu.locator('.plane-context-menu-item:has-text("Riemann Surface")')).toBeVisible();
    await expect(zMenu.locator('.plane-context-menu-item:has-text("View Graph")')).toBeVisible();

    // Hover Taylor Series on w-plane and verify exact Taylor submenu panel reveals with controls
    await zMenu.locator('.plane-context-menu-item:has-text("Taylor Series")').hover();
    await expect(page.locator('#plane_context_submenu')).toBeVisible();
    await expect(page.locator('#plane_context_submenu #taylor_series_options_detail_div')).toBeVisible();
    await expect(page.locator('#plane_context_submenu #taylor_series_order_slider')).toBeVisible();
    await expect(page.locator('#plane_context_submenu #taylor_complex_points_ui_container')).toBeVisible();
    await expect(page.locator('#plane_context_submenu #pick_taylor_center_canvas_btn')).toBeVisible();
});

test('graph submenu actions enable their prerequisites without a parent click', async ({ page }) => {
    await page.locator('#w_plane_canvas_wrapper').click({ button: 'right' });
    const graphMenuItem = page.locator('#plane_context_menu .plane-context-menu-item:has-text("View Graph")');
    await graphMenuItem.hover();
    const lockLayer = page.locator('#plane_context_submenu #lock_layer_sub');
    await expect(lockLayer).toBeVisible();
    await expect(lockLayer).toBeEnabled();
    await lockLayer.click();

    await expect(page.locator('#graph_column')).toBeVisible();
    await expect(page.locator('#graph_title_label')).toHaveText('Locked Layer Perspective');
    const graphState = await page.evaluate(async () => {
        const { state } = await import('./js/store/state.js');
        return {
            view: state.graphViewEnabled,
            fullGrid: state.graphFullGridEnabled,
            locked: state.graphLayerLockEnabled
        };
    });
    expect(graphState).toEqual({ view: true, fullGrid: true, locked: true });
});

test('full-grid and graph Fourier modes reuse the unified transform hub', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
    });

    await page.locator('#w_plane_canvas_wrapper').click({ button: 'right' });
    await page.locator('#plane_context_menu .plane-context-menu-item:has-text("View Graph")').hover();
    await page.locator('#plane_context_submenu .plane-context-menu-item:has-text("View Graph")').click();
    const graphState = await page.evaluate(async () => (await import('./js/store/state.js')).state.graphViewEnabled);
    expect(graphState).toBe(true);
    await expect(page.locator('#graph_column')).toBeVisible();

    // Toggle Full Grid Perspective via submenu panel
    await page.locator('#w_plane_canvas_wrapper').click({ button: 'right' });
    await expect(page.locator('#plane_context_menu')).toBeVisible();
    await page.locator('#plane_context_menu .plane-context-menu-item:has-text("View Graph")').hover();
    await expect(page.locator('#plane_context_submenu')).toBeVisible();
    await page.locator('#plane_context_submenu .plane-context-menu-item:has-text("Full Grid Perspective")').click();
    await expect(page.locator('#graph_title_label')).toHaveText('Full Grid Perspective');
    await expect(page.locator('#graph_3d_container canvas')).toHaveCount(1);
    await expect(page.locator('#graph_grid_family_selector option').nth(0)).toHaveText('Horizontal');
    await expect(page.locator('#graph_fourier_toggle')).toBeVisible();
    await expect(page.locator('#graph_trace_toggle')).toBeVisible();

    // Toggle Lock Layer via submenu panel
    await page.locator('#w_plane_canvas_wrapper').click({ button: 'right' });
    await expect(page.locator('#plane_context_menu')).toBeVisible();
    await page.locator('#plane_context_menu .plane-context-menu-item:has-text("View Graph")').hover();
    await expect(page.locator('#plane_context_submenu')).toBeVisible();
    await page.locator('#plane_context_submenu .plane-context-menu-item:has-text("Lock Layer")').click();
    await expect(page.locator('#graph_title_label')).toHaveText('Locked Layer Perspective');
    await expect(page.locator('#graph_fourier_toggle')).toBeHidden();
    await expect(page.locator('#graph_trace_toggle')).toBeHidden();
    const graphCanvas = page.locator('#graph_3d_container canvas');
    const lockedBaseline = await graphCanvas.screenshot();

    // Unlock Layer via submenu panel
    await page.locator('#w_plane_canvas_wrapper').click({ button: 'right' });
    await page.locator('#plane_context_menu .plane-context-menu-item:has-text("View Graph")').hover();
    await page.locator('#plane_context_submenu .plane-context-menu-item:has-text("Lock Layer")').click();
    await expect(page.locator('#graph_title_label')).toHaveText('Full Grid Perspective');
    const graphBounds = await graphCanvas.boundingBox();
    expect(graphBounds).not.toBeNull();
    const graphX = graphBounds.x + graphBounds.width * 0.5;
    const graphY = graphBounds.y + graphBounds.height * 0.5;
    await page.mouse.move(graphX, graphY);
    await page.mouse.down();
    await page.mouse.move(graphX + 120, graphY + 70, { steps: 12 });
    await page.mouse.up();
    await page.mouse.wheel(0, 480);

    // Lock Layer again via submenu panel
    await page.locator('#w_plane_canvas_wrapper').click({ button: 'right' });
    await page.locator('#plane_context_menu .plane-context-menu-item:has-text("View Graph")').hover();
    await page.locator('#plane_context_submenu .plane-context-menu-item:has-text("Lock Layer")').click();
    await expect(page.locator('#graph_title_label')).toHaveText('Locked Layer Perspective');
    expect((await graphCanvas.screenshot()).length).toBeGreaterThan(0);
    await page.locator('#w_plane_canvas_wrapper').click({ button: 'right' });
    await page.locator('#plane_context_menu .plane-context-menu-item:has-text("View Graph")').hover();
    await page.locator('#plane_context_submenu .plane-context-menu-item:has-text("Lock Layer")').click();
    await expect(page.locator('#graph_title_label')).toHaveText('Full Grid Perspective');

    await page.locator('#enable_graph_trace_cb').evaluate(element => element.click());
    await expect(page.locator('#enable_graph_trace_cb')).toBeChecked();
    await page.locator('#enable_graph_fourier_cb').evaluate(element => {
        element.checked = true;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#enable_graph_fourier_cb')).toBeChecked();
    await expect(page.locator('#laplace_specific_controls')).toBeVisible();
    await expect(page.locator('#laplace_function_selector')).toHaveValue('current_graph');
    await expect(page.locator('#laplace_function_selector')).toBeDisabled();
    await expect(page.locator('#laplace_frequency_label')).toHaveText('Frequency:');
    await expect(page.locator('#laplace_frequency_slider')).toBeVisible();
    await expect(page.locator('#laplace_3d_controls_section')).toBeHidden();
    await expect(page.locator('#laplace_animation_section')).toBeHidden();

    await selectInputShape(page, 'grid_logpolar');
    await expect(page.locator('#graph_grid_family_selector option').nth(0)).toHaveText('Circles');
    await expect(page.locator('#graph_grid_family_selector option').nth(1)).toHaveText('Lines');
    await page.locator('#graph_grid_family_selector').selectOption('secondary');

    await page.locator('#w_plane_canvas_wrapper').click({ button: 'right' });
    await page.locator('#plane_context_menu .plane-context-menu-item:has-text("View Graph")').hover();
    await page.locator('#plane_context_submenu .plane-context-menu-item:has-text("Full Grid Perspective")').click();
    await expect(page.locator('#graph_column')).toBeVisible();
    await expect(page.locator('#graph_title_label')).toHaveText('Graph + Fourier');
    await expect(page.locator('#laplace_specific_controls')).toBeVisible();
    await expect(page.locator('#graph_3d_container canvas')).toHaveCount(1);

    await page.locator('#select_laplace_btn').evaluate(element => element.click());
    await expect(page.locator('#graph_column')).toBeHidden();
    const graphActiveOnLaplace = await page.evaluate(async () => (await import('./js/store/state.js')).state.graphViewEnabled);
    expect(graphActiveOnLaplace).toBe(false);
    await expect(page.locator('#core_application_controls')).toBeHidden();
    await expect(page.locator('#laplace_specific_controls')).toBeVisible();
    await expect(page.locator('#laplace_function_selector')).toHaveValue('exponential');
    await expect(page.locator('#laplace_function_selector')).toBeEnabled();
    await expect(page.locator('#input_shape_selector')).toBeHidden();

    // Verify custom context menu is suppressed in Laplace mode
    await page.locator('#z_plane_canvas_wrapper').click({ button: 'right' });
    await expect(page.locator('#plane_context_menu')).toBeHidden();
    await page.locator('#w_plane_canvas_wrapper').click({ button: 'right' });
    await expect(page.locator('#plane_context_menu')).toBeHidden();

    await expect(page.locator('#laplace_spectrum_column')).toBeVisible();
    await expect(page.locator('#laplace_spectrum_canvas')).toBeVisible();
    await expect(page.locator('#laplace_3d_controls_section')).toBeVisible();
    await expect(page.locator('#laplace_animation_section')).toBeVisible();
    await expect(page.locator('#laplace_show_roc_cb')).not.toBeChecked();
    await expect(page.locator('#laplace_hide_integral_evaluation_cb')).toBeChecked();
    await expect(page.locator('#laplace_show_spectrum_cb')).toBeChecked();
    await page.locator('#laplace_fourier_slice_btn').click();
    await expect(page.locator('#laplace_sigma_slider')).toHaveValue('0');
    await page.locator('label[for="laplace_hide_integral_evaluation_cb"]').click();
    await expect(page.locator('#laplace_hide_integral_evaluation_cb')).not.toBeChecked();
    await page.locator('label[for="laplace_hide_integral_evaluation_cb"]').click();
    await expect(page.locator('#laplace_hide_integral_evaluation_cb')).toBeChecked();
    await page.locator('label[for="laplace_show_spectrum_cb"]').click();
    await expect(page.locator('#laplace_spectrum_column')).toBeHidden();
    await page.locator('label[for="laplace_show_spectrum_cb"]').click();
    await expect(page.locator('#laplace_spectrum_column')).toBeVisible();
    await page.locator('label[for="laplace_hide_3d_surface_cb"]').click();
    await expect(page.locator('#laplace_3d_column')).toBeHidden();
    await expect(page.locator('#laplace_3d_controls_section')).toBeVisible();
    await page.locator('label[for="laplace_hide_3d_surface_cb"]').click();
    await expect(page.locator('#laplace_3d_column')).toBeVisible();
    await page.evaluate(() => { window.__state.verticalLayoutEnabled = true; });
    await expect(page.locator('body')).toHaveClass(/vertical-layout/);
    await page.locator('#laplace_3d_column').scrollIntoViewIfNeeded();
    await expect(page.locator('#laplace_3d_column')).toBeVisible();
    await expect(page.locator('#laplace_3d_container')).toBeVisible();
    await page.locator('#laplace_3d_controls_section').scrollIntoViewIfNeeded();
    await expect(page.locator('#laplace_3d_controls_section')).toBeVisible();
    expect(errors).toEqual([]);
});

test('raster fold view stays connected and chain depth settles safely', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
    });

    await selectInputShape(page, 'media');
    await page.locator('#media_upload_input').setInputFiles(resolve('Example1.png'));
    await page.waitForFunction(() => {
        return import('./js/store/state.js').then(({ state }) => state.mediaVersion > 0);
    });

    await page.locator('#w_plane_canvas_wrapper').click({ button: 'right' });
    await page.locator('.plane-context-menu-item:has-text("Show folds in 3d")').click();
    await expect(page.locator('#w_plane_canvas')).toHaveClass(/hidden/);
    await expect(page.locator('#w_plane_three_container')).not.toHaveClass(/hidden/);

    await page.evaluate(async () => {
        const { state } = await import('./js/store/state.js');
        state.foldSurface3dEnabled = false;
        const { syncParameterControlsPanelVisibility } = await import('./js/ui/ui-updates.js');
        syncParameterControlsPanelVisibility();
        const { syncGridDensityControls } = await import('./js/ui/grid-density-controls.js');
        syncGridDensityControls();
    });
    await selectInputShape(page, 'grid_cartesian');
    await page.locator('#enable_chaining_cb').evaluate(element => element.click());

    const chainSlider = page.locator('#chain_count_slider');
    const maxColumnsDuringDrag = await chainSlider.evaluate(element => {
        let maxColumns = document.querySelectorAll('[id^="w_plane_column"]').length;
        for (let value = 2; value <= 512; value += 1) {
            element.value = String(value);
            element.dispatchEvent(new Event('input', { bubbles: true }));
            maxColumns = Math.max(
                maxColumns,
                document.querySelectorAll('[id^="w_plane_column"]').length
            );
        }
        return maxColumns;
    });
    await chainSlider.dispatchEvent('change');

    expect(maxColumnsDuringDrag).toBe(25);
    await expect(chainSlider).toHaveValue('512');
    await expect(page.locator('[id^="w_plane_column"]')).toHaveCount(1);
    await page.waitForTimeout(400);
    await expect(page.locator('#w-plane-title')).toContainText('Iteration 512');
    expect(errors).toEqual([]);
});

test('branch-aware dynamic aggregate Riemann shaders compile', async ({ page }) => {
    const shaderErrors = [];
    page.on('console', message => {
        if (message.text().includes('WebGL shader compile error')) shaderErrors.push(message.text());
    });
    const rendered = await page.evaluate(async () => {
        const { state } = await import('./js/store/state.js');
        Object.assign(state.dynamicPlotting, {
            enabled: true,
            mode: 'aggregate',
            source: { kind: 'integers', count: 4, start: 1, step: 1, ordering: 'ascending' },
            pointExpression: 'd',
            term: { kind: 'expression', expression: 'ln(s) + d^(-s)', bindings: [] },
            reduction: { kind: 'sum', invalidPolicy: 'stop' },
            parameters: [],
            playback: { visibleCount: 4, playing: false, speed: 10, loop: false }
        });
        const { renderRiemannSurface } = await import('./js/rendering/webgl-riemann-surface.js');
        return renderRiemannSurface(document.getElementById('w_plane_canvas'), { stage: 1 });
    });
    expect(rendered).toBe(true);
    expect(shaderErrors).toEqual([]);
});
