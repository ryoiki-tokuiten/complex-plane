import { expect, test } from '@playwright/test';

test.describe('Domain Coloring Rendering', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('./');
        await page.waitForFunction(() => document.getElementById('preloader')?.style.display === 'none');
    });

    test('renders domain coloring for polynomial function', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));

        await page.locator('#select_polynomial_btn').click();
        await page.locator('#enable_domain_coloring_cb').evaluate(el => {
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // Wait for z-plane canvas to render colored domain pixels (colored background instead of dark background)
        await page.waitForFunction(() => {
            const canvas = document.getElementById('z_plane_canvas');
            if (!canvas) return false;
            const ctx = canvas.getContext('2d');
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            // Check if there are non-black, colored pixels across the plane
            let colored = 0;
            for (let i = 0; i < data.length; i += 16) {
                if (data[i] > 30 || data[i + 1] > 30 || data[i + 2] > 30) colored++;
            }
            return colored > 500;
        }, { timeout: 10000 });

        expect(errors).toEqual([]);
    });

    test('renders domain coloring for elementary functions and palettes', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));

        await page.locator('#select_sin_btn').click();
        await page.locator('#enable_domain_coloring_cb').evaluate(el => {
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });

        await page.waitForFunction(() => {
            const canvas = document.getElementById('z_plane_canvas');
            if (!canvas) return false;
            const ctx = canvas.getContext('2d');
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let colored = 0;
            for (let i = 0; i < data.length; i += 16) {
                if (data[i] > 30 || data[i + 1] > 30 || data[i + 2] > 30) colored++;
            }
            return colored > 500;
        }, { timeout: 10000 });

        expect(errors).toEqual([]);
    });
});
