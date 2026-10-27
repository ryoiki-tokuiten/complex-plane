import { expect, test } from '@playwright/test';

async function completed(page, previousJobId = 0) {
    const handle = await page.waitForFunction(id => {
        const stats = window.__runtime?.rendering?.domainDynamicsStats;
        return stats?.jobId !== id && ['complete', 'failed'].includes(stats?.state) ? stats : false;
    }, previousJobId, { timeout: 180000 }).catch(async error => {
        console.log('Unfinished live frame', await page.evaluate(() => {
            const c = window.__testDomainCoordinator;
            return { stats: window.__runtime?.rendering?.domainDynamicsStats,
                precisionWords: c?.job?.words, pending: c?.job?.pending,
                workerCount: c?.workers.length, errors: window.__testDomainErrors };
        }));
        throw error;
    });
    const status = await handle.jsonValue();
    expect(status.state, JSON.stringify(status)).toBe('complete');
    expect(status.remainingPixels).toBe(0);
    return status;
}

test('live domain canvas, overlays, export, function changes and precise viewport churn', async ({ page }) => {
    test.setTimeout(300000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('./');
    await page.waitForFunction(() => window.__state && window.__context?.zCanvas?.width > 0);
    await page.evaluate(async () => {
        const { DomainCoordinator } = await import('./js/rendering/domain-coordinator.js');
        const originalRender = DomainCoordinator.prototype.render;
        DomainCoordinator.prototype.render = function(snapshot) {
            window.__testDomainCoordinator = this;
            return originalRender.call(this, snapshot);
        };
        const { state } = await import('./js/store/state.js');
        const { requestDomainRedraw } = await import('./js/rendering/redraw-scheduler.js');
        Object.assign(state, { currentFunction: 'mobius', domainColoringEnabled: true,
            chainingEnabled: false, algebraicChainingEnabled: false, taylorSeriesEnabled: false,
            mobiusA: { re: 1, im: 0 }, mobiusB: { re: 0, im: 0 },
            mobiusC: { re: 0, im: 0 }, mobiusD: { re: 1, im: 0 } });
        requestDomainRedraw(true);
    });
    const initial = await completed(page);
    console.log('Live identity frame', initial);
    const layers = await page.evaluate(async () => {
        const { composeZPlaneImage } = await import('./js/frontend/context-menu-model.js');
        const { zCanvas, zDomainColorCanvas: domain } = window.__context;
        const image = await composeZPlaneImage();
        const data = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
        let transparent = 0, colored = 0;
        for (let i=0;i<data.length;i+=4) {
            if (data[i+3] !== 255) ++transparent;
            if (Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2]) > 20) ++colored;
        }
        return { domain: [domain.width,domain.height], overlay: [zCanvas.width,zCanvas.height],
            image: [image.width,image.height], hidden: domain.hidden, transparent, colored };
    });
    expect(layers.domain).toEqual(layers.overlay);
    expect(layers.image).toEqual(layers.overlay);
    expect(layers.hidden).toBe(false);
    expect(layers.transparent).toBe(0);
    expect(layers.colored).toBeGreaterThan(100);

    await page.evaluate(async () => {
        const { state } = await import('./js/store/state.js');
        const { requestDomainRedraw } = await import('./js/rendering/redraw-scheduler.js');
        state.currentFunction = 'sin'; requestDomainRedraw(true);
    });
    const sine = await completed(page, initial.jobId);
    console.log('Live sin frame', sine);

    await page.evaluate(async () => {
        const { setupVisualParameters } = await import('./js/utils/dom-utils.js');
        const { requestDomainRedraw } = await import('./js/rendering/redraw-scheduler.js');
        for (const power of [10, 30, 60, 100]) {
            window.__state.zPlaneZoom = 10 ** power;
            setupVisualParameters(true, false); requestDomainRedraw(true);
        }
    });
    const deep = await completed(page, sine.jobId);
    expect(deep.width).toBe(initial.width); expect(deep.height).toBe(initial.height);
    await page.evaluate(async () => {
        const { state } = await import('./js/store/state.js');
        const { requestUiRedraw } = await import('./js/rendering/redraw-scheduler.js');
        state.domainColoringEnabled = false; requestUiRedraw();
    });
    await expect(page.locator('#z_plane_domain_canvas')).toBeHidden();
    expect(errors).toEqual([]);
});
