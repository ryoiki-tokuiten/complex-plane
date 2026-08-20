import { expect, test } from '@playwright/test';

async function enableDomainColoring(page) {
    await page.locator('#enable_domain_coloring_cb').evaluate(el => {
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

async function domainStats(page) {
    return page.evaluate(() => {
        return window.__runtime?.rendering?.domainDynamicsStats || { state: 'idle', jobId: 0, completedJobs: 0, cancelledJobs: 0 };
    });
}

async function waitForCompletedDomainFrame(page, completedJobs) {
    await page.waitForFunction(minimumCompletedJobs => {
        const stats = window.__runtime?.rendering?.domainDynamicsStats;
        return Boolean(stats && stats.state === 'complete' && stats.completedJobs >= minimumCompletedJobs);
    }, completedJobs, { timeout: 15000 });
    return domainStats(page);
}

async function setZZoomExponentBurst(page, exponents) {
    await page.locator('#z_plane_zoom_slider').evaluate((slider, values) => {
        for (const value of values) {
            slider.value = String(value);
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, exponents);
}

test.describe('Domain Coloring Rendering', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('./');
        await page.waitForFunction(() => document.getElementById('preloader')?.style.display === 'none');
    });

    test('renders domain coloring for polynomial function', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));

        await page.locator('#select_polynomial_btn').click();
        await enableDomainColoring(page);

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

        await page.locator('#select_cos_btn').click();
        await enableDomainColoring(page);

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

    test('coalesces extreme zoom input into one native final frame without overflow bands', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));
        page.on('console', msg => console.log(msg.text()));

        await page.locator('#select_cos_btn').click();
        await enableDomainColoring(page);
        const initial = await waitForCompletedDomainFrame(page, 1);

        await page.evaluate(() => {
            const target = window.__context.zDomainColorCtx;
            const originalDrawImage = target.drawImage.bind(target);
            window.__domainFinalCommits = 0;
            target.drawImage = (...args) => {
                window.__domainFinalCommits += 1;
                return originalDrawImage(...args);
            };
        });

        await setZZoomExponentBurst(page, [-1.5, -2, -2.5, -3]);
        await page.waitForFunction(previousJobId => {
            const stats = window.__runtime?.rendering?.domainDynamicsStats;
            const state = window.__state;
            return Boolean(state && stats && state.zPlaneZoom === 1e-3 && stats.jobId !== previousJobId &&
                (stats.state === 'scheduled' || stats.state === 'rendering'));
        }, initial.jobId);
        const completed = await page.waitForFunction(previousJobId => {
            const stats = window.__runtime?.rendering?.domainDynamicsStats;
            const state = window.__state;
            return Boolean(state && stats && state.zPlaneZoom === 1e-3 && stats.jobId !== previousJobId && stats.state === 'complete')
                ? stats
                : false;
        }, initial.jobId, { timeout: 15000 }).then(handle => handle.jsonValue());

        const result = await page.evaluate(() => {
            const state = window.__state;
            const context = window.__context;
            const runtime = window.__runtime;
            const canvas = context.zDomainColorCanvas;
            const pixels = context.zDomainColorCtx.getImageData(0, 0, canvas.width, canvas.height).data;
            let blackPixels = 0;
            for (let offset = 0; offset < pixels.length; offset += 4) {
                if (pixels[offset] <= 2 && pixels[offset + 1] <= 2 && pixels[offset + 2] <= 2) {
                    blackPixels += 1;
                }
            }

            const centerY = Math.floor(canvas.height / 2);
            const reds = [];
            const greens = [];
            const blues = [];
            for (let x = 0; x < canvas.width; x += 1) {
                const offset = (centerY * canvas.width + x) * 4;
                reds.push(pixels[offset]);
                greens.push(pixels[offset + 1]);
                blues.push(pixels[offset + 2]);
            }
            const redRange = Math.max(...reds) - Math.min(...reds);
            const greenRange = Math.max(...greens) - Math.min(...greens);
            const blueRange = Math.max(...blues) - Math.min(...blues);
            const maximumChannelRange = Math.max(redRange, greenRange, blueRange);

            return {
                blackRatio: blackPixels / (canvas.width * canvas.height),
                centerRowRange: maximumChannelRange,
                commits: window.__domainFinalCommits,
                zoom: state.zPlaneZoom,
                stats: runtime.rendering.domainDynamicsStats
            };
        });

        expect(result.zoom).toBe(1e-3);
        expect(result.blackRatio, JSON.stringify(result)).toBeLessThan(0.001);
        expect(result.centerRowRange).toBeLessThan(24);
        expect(result.commits).toBe(1);
        expect(completed.completedJobs).toBe(initial.completedJobs + 1);
        expect(completed.totalTiles).toBe(completed.completedTiles);
        expect(completed.wallMilliseconds).toBeGreaterThan(0);
        expect(completed.workerMilliseconds).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    });
});
