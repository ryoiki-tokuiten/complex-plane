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
    }, null, { timeout: 30000 });
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

    test('renders gamma, loggamma, bessel, zeta, fractals, and 1e-100 deep zoom with fractal probe parity and WebGL lifecycle recovery', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));

        await enableDomainColoring(page);
        await waitForDomainFrameSettled(page);

        const checkNonBlack = async selector => {
            await page.locator(selector).click();
            await waitForDomainFrameSettled(page);
            return page.evaluate(() => {
                const canvas = document.getElementById('z_plane_domain_canvas');
                const gl = canvas.getContext('webgl2');
                const w = canvas.width;
                const h = canvas.height;
                const px = new Uint8Array(w * h * 4);
                gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
                let nonBlack = 0;
                const total = Math.floor((w * h) / 16);
                for (let i = 0; i < px.length; i += 64) {
                    if (px[i] > 3 || px[i + 1] > 3 || px[i + 2] > 3) nonBlack++;
                }
                return nonBlack / Math.max(1, total);
            });
        };

        for (const btn of ['#select_gamma_btn', '#select_loggamma_btn', '#select_bessel_btn', '#select_zeta_btn']) {
            const ratio = await checkNonBlack(btn);
            expect(ratio, `non-black ratio for ${btn}`).toBeGreaterThan(0.8);
        }

        // Switch to Fractals tab and verify Mandelbrot & Newton fractal rendering + hover probe parity
        await page.locator('#toggle_fractals_btn').click();
        const mandelRatio = await checkNonBlack('#select_mandelbrot_btn');
        expect(mandelRatio).toBeGreaterThan(0.15);

        const zCanvas = page.locator('#z_plane_canvas');
        const box = await zCanvas.boundingBox();
        expect(box).not.toBeNull();
        await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.52);
        const probeState = await page.evaluate(() => ({
            chainingEnabled: window.__state.chainingEnabled,
            probeActive: window.__state.probeActive,
            probeZ: window.__state.probeZ
        }));
        expect(probeState.chainingEnabled).toBe(true);
        expect(probeState.probeActive).toBe(true);
        expect(Number.isFinite(probeState.probeZ?.re)).toBe(true);

        const newtonRatio = await checkNonBlack('#select_newton_fractal_btn');
        expect(newtonRatio).toBeGreaterThan(0.8);

        // Deep zoom to 1e-100 scale (zPlaneZoom = 1e100)
        await page.locator('#toggle_complex_functions_btn').click();
        await page.locator('#select_cos_btn').click();
        await setZZoomExponentBurst(page, [20, 50, 80, 100]);
        await waitForDomainFrameSettled(page);

        const deepZoomResult = await page.evaluate(async () => {
            const { zPlaneParams } = await import('./js/store/state.js');
            const canvas = document.getElementById('z_plane_domain_canvas');
            const gl = canvas.getContext('webgl2');
            const w = canvas.width;
            const h = canvas.height;
            const px = new Uint8Array(w * h * 4);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
            let nonBlack = 0;
            const total = Math.floor((w * h) / 16);
            for (let i = 0; i < px.length; i += 64) {
                if (px[i] > 3 || px[i + 1] > 3 || px[i + 2] > 3) nonBlack++;
            }
            return {
                scaleExp10: zPlaneParams.scaleExp10,
                nonBlackRatio: nonBlack / Math.max(1, total)
            };
        });
        expect(deepZoomResult.scaleExp10).toBe(-100);
        expect(deepZoomResult.nonBlackRatio).toBeGreaterThan(0.8);

        // WebGL lifecycle disposal and automatic re-initialization
        await page.evaluate(async () => {
            const { disposePlanarDomainColoring } = await import('./js/rendering/domain-coloring.js');
            const { requestDomainRedraw } = await import('./js/rendering/redraw-scheduler.js');
            disposePlanarDomainColoring();
            requestDomainRedraw(true);
        });
        await waitForDomainFrameSettled(page);
        expect(errors).toEqual([]);
    });
});
