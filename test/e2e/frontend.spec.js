import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('./');
    await page.waitForFunction(() => document.getElementById('preloader')?.style.display === 'none');
    await expect(page.locator('#image_resolution_slider')).toHaveCount(0);
    await expect(page.locator('#video_resolution_slider')).toHaveCount(0);
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

    await page.locator('label[for="image_surface_3d_cb"]').click();
    await expect(page.locator('#image_surface_3d_cb')).toBeChecked();
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

    expect(maxColumnsDuringDrag).toBe(1);
    await expect(chainSlider).toHaveValue('512');
    await expect(page.locator('[id^="w_plane_column"]')).toHaveCount(1);
    await page.waitForTimeout(400);
    await expect(page.locator('#w-plane-title')).toContainText('Chain 511');
    expect(errors).toEqual([]);
});
