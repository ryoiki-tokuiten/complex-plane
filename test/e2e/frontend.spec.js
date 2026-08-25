import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('./');
    await page.waitForFunction(() => document.getElementById('preloader')?.style.display === 'none');
    await expect(page.locator('#image_resolution_slider')).toHaveCount(0);
    await expect(page.locator('#video_resolution_slider')).toHaveCount(0);
});

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

test('arbitrary shapes support freehand drawing without Cauchy mode', async ({ page }) => {
    await page.locator('#input_shape_selector').selectOption('arbitrary');
    await expect(page.locator('#arbitrary_shape_controls')).not.toHaveClass(/hidden/);
    await expect(page.locator('#enable_cauchy_integral_mode_cb')).not.toBeChecked();

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
    await expect(page.locator('#taylor_complex_points_ui_container button')).toHaveCount(20);
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

    await expect.poll(async () => {
        return page.locator('#collapse_z_btn svg').evaluate(element => window.getComputedStyle(element).transform);
    }).toContain('matrix');

    await page.locator('#enable_vertical_layout_cb').evaluate(element => {
        element.checked = false;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('body')).not.toHaveClass(/vertical-layout/);

    await expect.poll(async () => {
        return page.locator('#collapse_z_btn svg').evaluate(element => window.getComputedStyle(element).transform);
    }).not.toContain('matrix');

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

    await page.locator('#enable_real_plots_cb').evaluate(element => {
        element.checked = true;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    for (const part of ['input', 'imag']) {
        await page.locator(`#real_plots_${part}_preset`).selectOption('custom');
        await expect(page.locator(`#real_plots_custom_${part}_container`)).not.toHaveClass(/hidden/);
        await page.locator(`#real_plots_custom_${part}`).fill(part === 'input' ? 'x + y' : 'x - y');
    }
    expect(errors).toEqual([]);
});

test('controls visual contract remains stable', async ({ page }) => {
    await expect(page.locator('#controls_options_section')).toHaveScreenshot('controls-panel.png', {
        animations: 'disabled',
        maxDiffPixelRatio: 0.01
    });
});

test('full-grid and graph Fourier modes reuse the unified transform hub', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
    });

    const fullGridToggle = page.locator('label[for="view_full_grid_perspective_btn"]');
    await expect(fullGridToggle).toBeHidden();
    await expect(page.locator('#graph_focus_box_toggle')).toBeHidden();
    await page.locator('#enable_graph_view_cb').evaluate(element => element.click());
    await expect(fullGridToggle).toBeVisible();
    await fullGridToggle.click();
    await expect(page.locator('#enable_graph_view_cb')).toBeChecked();
    await expect(page.locator('#graph_focus_box_toggle')).toBeVisible();
    await expect(page.locator('#graph_layer_lock_toggle')).toBeVisible();
    await expect(page.locator('#enable_graph_layer_lock_cb')).not.toBeChecked();
    await expect(page.locator('#enable_graph_focus_box_cb')).toBeChecked();
    await page.locator('#enable_graph_focus_box_cb').evaluate(element => element.click());
    await expect(page.locator('#enable_graph_focus_box_cb')).not.toBeChecked();
    await page.locator('#enable_graph_focus_box_cb').evaluate(element => element.click());
    await expect(page.locator('#graph_column')).toBeVisible();
    await expect(page.locator('#graph_title_label')).toHaveText('Full Grid Perspective');
    await expect(page.locator('#graph_3d_container canvas')).toHaveCount(1);
    await expect(page.locator('#graph_grid_family_selector option').nth(0)).toHaveText('Horizontal');
    await expect(page.locator('#graph_fourier_toggle')).toBeVisible();
    await expect(page.locator('#graph_trace_toggle')).toBeVisible();

    await page.locator('#enable_graph_layer_lock_cb').evaluate(element => element.click());
    await expect(page.locator('#enable_graph_layer_lock_cb')).toBeChecked();
    await expect(page.locator('#graph_title_label')).toHaveText('Locked Layer Perspective');
    await expect(page.locator('#graph_fourier_toggle')).toBeHidden();
    await expect(page.locator('#graph_trace_toggle')).toBeHidden();
    const graphCanvas = page.locator('#graph_3d_container canvas');
    const lockedBaseline = await graphCanvas.screenshot();

    await page.locator('#enable_graph_layer_lock_cb').evaluate(element => element.click());
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

    await page.locator('#enable_graph_layer_lock_cb').evaluate(element => element.click());
    await expect(page.locator('#graph_title_label')).toHaveText('Locked Layer Perspective');
    expect((await graphCanvas.screenshot()).equals(lockedBaseline)).toBe(true);
    await page.locator('#enable_graph_layer_lock_cb').evaluate(element => element.click());
    await expect(page.locator('#graph_title_label')).toHaveText('Full Grid Perspective');

    await page.locator('#enable_graph_trace_cb').evaluate(element => element.click());
    await expect(page.locator('#enable_graph_trace_cb')).toBeChecked();
    await page.locator('#enable_graph_fourier_cb').evaluate(element => element.click());
    await expect(page.locator('#enable_graph_fourier_cb')).toBeChecked();
    await expect(page.locator('#laplace_specific_controls')).toBeVisible();
    await expect(page.locator('#laplace_function_selector')).toHaveValue('current_graph');
    await expect(page.locator('#laplace_function_selector')).toBeDisabled();
    await expect(page.locator('#laplace_frequency_label')).toHaveText('Frequency:');
    await expect(page.locator('#laplace_frequency_slider')).toBeVisible();
    await expect(page.locator('#visualization-options-panel')).toBeHidden();
    await expect(page.locator('#laplace_3d_controls_section')).toBeHidden();
    await expect(page.locator('#laplace_animation_section')).toBeHidden();

    await page.locator('#input_shape_selector').selectOption('grid_logpolar');
    await expect(page.locator('#graph_grid_family_selector option').nth(0)).toHaveText('Circles');
    await expect(page.locator('#graph_grid_family_selector option').nth(1)).toHaveText('Lines');
    await page.locator('#graph_grid_family_selector').selectOption('secondary');

    await fullGridToggle.click();
    await expect(page.locator('#graph_column')).toBeVisible();
    await expect(page.locator('#graph_title_label')).toHaveText('Graph + Fourier');
    await expect(page.locator('#laplace_specific_controls')).toBeVisible();
    await expect(page.locator('#graph_3d_container canvas')).toHaveCount(1);

    await page.locator('#select_laplace_btn').evaluate(element => element.click());
    await expect(page.locator('#graph_column')).toBeHidden();
    await expect(page.locator('#enable_graph_view_cb')).not.toBeChecked();
    await expect(page.locator('#core_application_controls')).toBeHidden();
    await expect(page.locator('#visualization-options-panel')).toBeHidden();
    await expect(page.locator('#laplace_specific_controls')).toBeVisible();
    await expect(page.locator('#core_application_controls')).toBeHidden();
    await expect(page.locator('#visualization-options-panel')).toBeHidden();
    await expect(page.locator('#laplace_function_selector')).toHaveValue('exponential');
    await expect(page.locator('#laplace_function_selector')).toBeEnabled();
    await expect(page.locator('#input_shape_selector')).toBeHidden();
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

    await page.locator('#input_shape_selector').selectOption('image');
    await page.locator('#image_upload_input').setInputFiles(resolve('Example1.png'));
    await page.waitForFunction(() => {
        return import('./js/store/state.js').then(({ state }) => state.imageContentVersion > 0);
    });

    await page.locator('label[for="grid_surface_3d_cb"]').click();
    await expect(page.locator('#grid_surface_3d_cb')).toBeChecked();
    await expect(page.locator('#w_plane_canvas')).toHaveClass(/hidden/);
    await expect(page.locator('#w_plane_three_container')).not.toHaveClass(/hidden/);

    await page.locator('#input_shape_selector').selectOption('grid_cartesian');
    await page.locator('label[for="enable_chaining_cb"]').click();

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
