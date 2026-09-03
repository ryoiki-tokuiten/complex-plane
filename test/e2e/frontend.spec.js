import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('./', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__state && document.getElementById('z_plane_canvas')?.width > 0);
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

test('Riemann surfaces support the full Taylor control range', async ({ page }) => {
    await page.click('#select_cos_btn');
    await page.locator('#w_plane_canvas_wrapper').click({ button: 'right' });
    await page.locator('#plane_context_menu .plane-context-menu-item:has-text("Taylor Series")').hover();
    await expect(page.locator('#taylor_series_order_slider')).toBeVisible();
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
});


test('signals keep the Preact shell and primary mode controls synchronized', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('#app > .application-root')).toHaveCount(1);
    await expect(page.locator('#theme_selector_btn svg')).toBeVisible();
    expect(await page.locator('.canvas-row.two-column-layout').evaluate(workspace =>
        [workspace.scrollWidth <= workspace.clientWidth, workspace.scrollHeight <= workspace.clientHeight]
    )).toEqual([true, true]);
    expect(await page.locator('[id]').evaluateAll(elements => {
        const ids = elements.map(element => element.id);
        return ids.filter((id, index) => ids.indexOf(id) !== index);
    })).toEqual([]);

    await page.click('#theme_selector_btn');
    await page.locator('label[for="enable_vertical_layout_cb"]').click();
    await expect(page.locator('.application-root')).toHaveClass(/vertical-layout/);
    await page.locator('label[for="enable_vertical_layout_cb"]').click();
    await page.click('#close_theme_modal_btn');

    await page.locator('#toggle_fullscreen_z_btn').click();
    await expect(page.locator('#z_plane_column')).toHaveClass(/workspace-panel-fullscreen/);
    await page.locator('#toggle_fullscreen_z_btn').click();

    await page.locator('#polynomialN_slider').evaluate(element => {
        element.value = '4';
        element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#polynomial_coeffs_container .polynomial-coeff-row')).toHaveCount(5);

    await page.locator('#select_real_plots_btn').click();
    await expect(page.locator('#real_plots_controls_container')).toBeVisible();
    await page.locator('label[for="real_plots_contours_cb"]').click();
    await page.locator('#real_plots_show_2d_contour_btn').click();
    await expect(page.locator('#contour_2d_column')).toBeVisible();

    await page.locator('#select_laplace_btn').click();
    await expect(page.locator('#real_plots_controls_container')).toBeHidden();
    await expect(page.locator('#laplace_specific_controls')).toBeVisible();
    expect(errors).toEqual([]);
});

test('manifold transformation controls are signal-driven and renderer-independent', async ({ page }) => {
    await page.evaluate(async () => {
        const { state } = await import('./js/store/state.js');
        state.manifold3dViewEnabled = true;
        state.selectedManifold = 'torus';
        state.manifoldTransformationEnabled = true;
        state.manifoldTransformationProgressZ = 0;
        state.manifoldTransformationProgressW = 0;
        state.manifoldTransformationPlayingZ = true;
        state.manifoldTransformationPlayingW = true;
    });

    await expect(page.locator('#z_plane_transformation_overlay')).toBeVisible();
    await expect(page.locator('#w_plane_transformation_overlay')).toBeVisible();
    await expect(page.locator('#z_transformation_title')).toContainText('Torus');
    await expect(page.locator('#z_transformation_play_pause_btn')).toHaveClass(/playing/);
    await expect(page.locator('#z_plane_threejs_container canvas')).toHaveCount(1);
    await expect(page.locator('#w_plane_threejs_container canvas')).toHaveCount(1);

    await page.locator('#z_transformation_progress_slider').evaluate(element => {
        element.value = '0.42';
        element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#z_transformation_play_pause_btn')).not.toHaveClass(/playing/);
    await page.locator('#z_transformation_speed_group [data-speed="0.5"]').click();
    await expect(page.locator('#z_transformation_speed_group [data-speed="0.5"]')).toHaveClass(/active/);

    const stateSnapshot = await page.evaluate(async () => {
        const { state } = await import('./js/store/state.js');
        return {
            progress: state.manifoldTransformationProgressZ,
            playing: state.manifoldTransformationPlayingZ,
            speed: state.manifoldTransformationSpeedZ
        };
    });
    expect(stateSnapshot).toEqual({ progress: 0.42, playing: false, speed: 0.5 });
});


test('extended input shapes and both plane context menus remain functional', async ({ page }) => {
    await selectInputShape(page, 'grid_triangular');
    await expect(page.locator('#grid_triangular_controls')).toBeVisible();
    await expect(page.locator('[data-input-shape-label]')).toHaveText('Triangular Grid');

    const menu = page.locator('#plane_context_menu');
    await page.locator('#z_plane_canvas_wrapper').click({ button: 'right' });
    await menu.locator('.plane-context-menu-item:has-text("Domain Coloring")').hover();
    await expect(page.locator('#plane_context_submenu #domain_palette_circles button')).toHaveCount(8);
    await page.locator('#domain_brightness_slider').evaluate(slider => {
        slider.value = '1.25';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#domain_brightness_value_display')).toHaveText('1.25');

    await menu.locator('.plane-context-menu-item:has-text("Analysis")').hover();
    await page.locator('#plane_context_submenu .plane-context-menu-item:has-text("Show zeroes & poles")').click();
    expect(await page.evaluate(async () => (await import('./js/store/state.js')).state.showZerosPoles)).toBe(true);

    await page.locator('#w_plane_canvas_wrapper').click({ button: 'right' });
    await menu.locator('.plane-context-menu-item:has-text("Taylor Series")').hover();
    await expect(page.locator('#plane_context_submenu #taylor_context_panel')).toBeVisible();
    await expect(page.locator('#taylor_complex_points_ui_container button')).toHaveCount(16);

    await page.keyboard.press('Escape');
    await page.locator('#w_plane_canvas_wrapper').click({ button: 'right' });
    await menu.locator('.plane-context-menu-item:has-text("Riemann Surface")').click();
    const surface = page.locator('#w_plane_canvas_wrapper > .riemann-surface-canvas');
    await expect(surface).toBeVisible({ timeout: 15000 });
    await surface.click({ button: 'right' });
    await expect(menu.locator('.plane-context-menu-item:has-text("Riemann Surface")')).toBeVisible();
});

test('full-grid and graph Fourier modes reuse the unified transform hub', async ({ page }) => {
    const openGraphMenu = async () => {
        await page.locator('#w_plane_canvas_wrapper').click({ button: 'right' });
        await page.locator('#plane_context_menu .plane-context-menu-item:has-text("View Graph")').hover();
    };
    await openGraphMenu();
    await page.locator('#plane_context_submenu #lock_layer_sub').click();
    await expect(page.locator('#graph_column')).toBeVisible();
    await expect(page.locator('#graph_title_label')).toHaveText('Locked Layer Perspective');
    expect(await page.evaluate(async () => {
        const { state } = await import('./js/store/state.js');
        return [state.graphViewEnabled, state.graphFullGridEnabled, state.graphLayerLockEnabled];
    })).toEqual([true, true, true]);

    await openGraphMenu();
    await page.locator('#plane_context_submenu .plane-context-menu-item:has-text("Lock Layer")').click();
    await expect(page.locator('#graph_title_label')).toHaveText('Full Grid Perspective');
    await expect(page.locator('#graph_3d_container canvas')).toHaveCount(1);

    await page.locator('#enable_graph_fourier_cb').evaluate(element => {
        element.checked = true;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#laplace_specific_controls')).toBeVisible();
    await expect(page.locator('#laplace_function_selector')).toHaveValue('current_graph');
    await expect(page.locator('#laplace_function_selector')).toBeDisabled();

    await selectInputShape(page, 'grid_logpolar');
    await expect(page.locator('#graph_grid_family_selector option').nth(0)).toHaveText('Circles');
    await page.locator('#graph_grid_family_selector').selectOption('secondary');

    await openGraphMenu();
    await page.locator('#plane_context_submenu .plane-context-menu-item:has-text("Full Grid Perspective")').click();
    await expect(page.locator('#graph_title_label')).toHaveText('Graph + Fourier');

    await page.locator('#select_laplace_btn').evaluate(element => element.click());
    await expect(page.locator('#graph_column')).toBeHidden();
    await expect(page.locator('#laplace_specific_controls')).toBeVisible();
    await expect(page.locator('#laplace_function_selector')).toHaveValue('exponential');
    await expect(page.locator('#laplace_function_selector')).toBeEnabled();
    await page.locator('#z_plane_canvas_wrapper').click({ button: 'right' });
    await expect(page.locator('#plane_context_menu')).toBeHidden();

    await expect(page.locator('#laplace_spectrum_column')).toBeVisible();
    await expect(page.locator('#laplace_3d_controls_section')).toBeVisible();
});

test('raster fold view stays connected and chain depth settles safely', async ({ page }) => {
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
    });
    await selectInputShape(page, 'grid_cartesian');
    await page.locator('#enable_chaining_cb').evaluate(element => element.click());

    const chainSlider = page.locator('#chain_count_slider');
    await chainSlider.evaluate(element => {
        element.value = '512';
        element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await chainSlider.dispatchEvent('change');

    await expect(chainSlider).toHaveValue('512');
    await expect(page.locator('[id^="w_plane_column"]')).toHaveCount(1);
    expect(await page.locator('.canvas-row.two-column-layout').evaluate(workspace =>
        workspace.scrollWidth <= workspace.clientWidth
    )).toBe(true);
    await page.waitForTimeout(400);
    await expect(page.locator('#w-plane-title')).toContainText('Iteration 512');
});
