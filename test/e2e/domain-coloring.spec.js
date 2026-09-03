import { expect, test } from '@playwright/test';

async function enableDomainColoring(page) {
    await page.evaluate(async () => {
        const { state } = await import('./js/store/state.js');
        state.domainColoringEnabled = true;
        const { requestDomainRedraw } = await import('./js/rendering/redraw-scheduler.js');
        requestDomainRedraw(true);
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

async function waitForNextCompletedDomainFrame(page, previousJobId) {
    return page.waitForFunction(jobId => {
        const stats = window.__runtime?.rendering?.domainDynamicsStats;
        return stats?.state === 'complete' && stats.jobId !== jobId ? stats : false;
    }, previousJobId, { timeout: 15000 }).then(handle => handle.jsonValue());
}

async function setZZoomExponentBurst(page, exponents) {
    await page.evaluate(async (values) => {
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

    test('function and algebraic expression changes finish a fresh domain frame', async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        await enableDomainColoring(page);
        const initial = await waitForCompletedDomainFrame(page, 1);

        await page.locator('#select_polynomial_btn').click();
        const polynomial = await waitForNextCompletedDomainFrame(page, initial.jobId);

        await page.locator('#enable_algebraic_chaining_cb').evaluate(checkbox => {
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        });
        const algebraic = await waitForNextCompletedDomainFrame(page, polynomial.jobId);

        await page.locator('#algebraic_chaining_z_input').evaluate(input => {
            input.value = 'z + 1';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const expression = await waitForNextCompletedDomainFrame(page, algebraic.jobId);

        const finalState = await page.evaluate(() => ({
            expression: window.__state?.algebraicChainingZExpr,
            processing: window.__runtime?.rendering?.processingDomainDynamics,
            indicatorHidden: document.getElementById('z_plane_rendering_indicator')?.classList.contains('hidden')
        }));
        expect(finalState).toEqual({ expression: 'z + 1', processing: false, indicatorHidden: true });
        expect(expression.completedJobs).toBe(polynomial.completedJobs + 2);
        expect(errors).toEqual([]);
    });

    test('coalesces extreme zoom input into one native frame without overflow bands', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));
        await page.locator('#select_cos_btn').click();
        await enableDomainColoring(page);
        const initial = await waitForCompletedDomainFrame(page, 1);

        await page.evaluate(() => {
            const target = window.__context.zDomainColorCtx;
            const originalPutImageData = target.putImageData.bind(target);
            window.__domainTileCommits = 0;
            target.putImageData = (...args) => {
                window.__domainTileCommits += 1;
                return originalPutImageData(...args);
            };
        });

        await setZZoomExponentBurst(page, [-1.5, -2, -2.5, -3]);
        await page.waitForFunction(previousJobId => {
            const stats = window.__runtime?.rendering?.domainDynamicsStats;
            const state = window.__state;
            return Boolean(state && stats && state.zPlaneZoom === 1e-3 && stats.jobId !== previousJobId &&
                (stats.state === 'rendering' || stats.state === 'complete'));
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

            return {
                blackRatio: blackPixels / (canvas.width * canvas.height),
                commits: window.__domainTileCommits,
                zoom: state.zPlaneZoom,
                stats: runtime.rendering.domainDynamicsStats
            };
        });

        expect(result.zoom).toBe(1e-3);
        expect(result.blackRatio, JSON.stringify(result)).toBeLessThan(0.001);
        expect(result.commits).toBe(completed.totalTiles);
        expect(completed.completedJobs).toBe(initial.completedJobs + 1);
        expect(completed.totalTiles).toBe(completed.completedTiles);
        expect(completed.wallMilliseconds).toBeGreaterThan(0);
        expect(completed.workerMilliseconds).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    });
});
