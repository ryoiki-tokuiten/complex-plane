import { expect, test } from '@playwright/test';

async function enableDomainColoring(page) {
    await page.evaluate(async () => {
        const { state } = await import('./js/store/state.js');
        state.domainColoringEnabled = true;
        const { requestDomainRedraw } = await import('./js/rendering/redraw-scheduler.js');
        requestDomainRedraw(true);
    });
}

async function waitForDomainFrameSettled(page) {
    await page.waitForFunction(async () => {
        const { hasPlanarDomainDisplay } = await import('./js/rendering/domain-coloring.js');
        const domainCanvas = document.getElementById('z_plane_domain_canvas');
        return Boolean(
            domainCanvas &&
            !domainCanvas.hidden &&
            hasPlanarDomainDisplay() &&
            !window.__context?.domainColoringDirty
        );
    }, null, { timeout: 15000 });
}

async function setZZoomExponentBurst(page, exponents) {
    await page.evaluate(async values => {
        const { setupVisualParameters } = await import('./js/utils/dom-utils.js');
        const { requestDomainRedraw } = await import('./js/rendering/redraw-scheduler.js');
        for (const value of values) {
            window.__state.zPlaneZoom = Math.pow(10, value);
            setupVisualParameters(true, false);
            requestDomainRedraw(true);
        }
    }, exponents);
}

test.describe('Domain Coloring Rendering', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('./');
        await page.waitForFunction(() => window.__state && document.getElementById('z_plane_canvas')?.width > 0);
    });

    test('function and algebraic expression changes finish a fresh WebGL2 domain frame on #z_plane_domain_canvas', async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        await enableDomainColoring(page);
        await waitForDomainFrameSettled(page);

        await page.locator('#select_polynomial_btn').click();
        await waitForDomainFrameSettled(page);

        await page.locator('#enable_algebraic_chaining_cb').evaluate(checkbox => {
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await waitForDomainFrameSettled(page);

        await page.locator('#algebraic_chaining_z_input').evaluate(input => {
            input.value = 'z + 1';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await waitForDomainFrameSettled(page);

        const finalState = await page.evaluate(async () => {
            const { hasPlanarDomainDisplay } = await import('./js/rendering/domain-coloring.js');
            const domainCanvas = document.getElementById('z_plane_domain_canvas');
            return {
                expression: window.__state?.algebraicChainingZExpr,
                hasDisplay: hasPlanarDomainDisplay(),
                domainCanvasHidden: Boolean(domainCanvas?.hidden)
            };
        });
        expect(finalState).toEqual({
            expression: 'z + 1',
            hasDisplay: true,
            domainCanvasHidden: false
        });
        expect(errors).toEqual([]);
    });

    test('renders extreme zoom input on the unified 96-bit WebGL2 pipeline without overflow bands or blackout', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));
        await page.locator('#select_cos_btn').click();
        await enableDomainColoring(page);
        await waitForDomainFrameSettled(page);

        await setZZoomExponentBurst(page, [-1.5, -2, -2.5, -3]);
        await waitForDomainFrameSettled(page);

        const result = await page.evaluate(() => {
            const state = window.__state;
            const canvas = document.getElementById('z_plane_domain_canvas');
            const gl = canvas.getContext('webgl2');
            const w = canvas.width;
            const h = canvas.height;
            const pixels = new Uint8Array(w * h * 4);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            let blackPixels = 0;
            for (let offset = 0; offset < pixels.length; offset += 4) {
                if (pixels[offset] <= 2 && pixels[offset + 1] <= 2 && pixels[offset + 2] <= 2) {
                    blackPixels += 1;
                }
            }

            return {
                blackRatio: blackPixels / (w * h),
                zoom: state.zPlaneZoom
            };
        });

        expect(result.zoom).toBe(1e-3);
        expect(result.blackRatio, JSON.stringify(result)).toBeLessThan(0.001);
        expect(errors).toEqual([]);
    });
});
