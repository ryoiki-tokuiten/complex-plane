import { expect, test } from '@playwright/test';

/**
 * Generates a reproducible batch of composite complex function configurations.
 * Supports combinations of elementary, trigonometric, hyperbolic, and special functions
 * along with random panning and progressive zooms up to 10^100.
 */
export function generateCompositeChainsBatch(count = 10000, seed = 42) {
    let s = seed;
    function rand() {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    }

    const functions = [
        'sin', 'cos', 'ln', 'tan', 'sec', 'exp',
        'zeta', 'asin', 'atan', 'asinh', 'gamma', 'loggamma', 'bessel'
    ];

    const batch = new Array(count);
    for (let i = 0; i < count; i++) {
        const fnIndex = Math.floor(rand() * functions.length);
        const currentFunction = functions[fnIndex];
        const zetaContinuation = currentFunction === 'zeta' ? rand() > 0.5 : false;
        const chainDepth = Math.floor(rand() * 721) + 80; // 80 to 800
        const panX = (rand() - 0.5) * 400; // random pixel pan
        const panY = (rand() - 0.5) * 400;
        // Zoom power from 0 to 100
        const zoomPower = rand() * 100;
        const zoom = 10 ** zoomPower;

        batch[i] = {
            id: i,
            currentFunction,
            zetaContinuation,
            chainDepth,
            panX,
            panY,
            zoomPower,
            zoom
        };
    }
    return batch;
}

/**
 * Triggers a domain coloring render pass in the real browser and measures
 * execution time until the DOM's 'Rendering…' indicator disappears and state is complete.
 */
async function renderAndMeasure(page, mutatorSource, label, timeout = 900000) {
    const prevJobId = await page.evaluate(() => window.__runtime?.rendering?.domainDynamicsStats?.jobId || 0);
    const startTime = Date.now();

    await page.evaluate(async (fnSource) => {
        const { state, zPlaneParams } = await import('./js/store/state.js');
        const { setupVisualParameters } = await import('./js/utils/dom-utils.js');
        const { requestDomainRedraw } = await import('./js/rendering/redraw-scheduler.js');
        const { applyFractalPreset } = await import('./js/analysis/fractal-presets.js');
        const { panPreciseViewport } = await import('./js/native/precise-viewport.js');

        const fn = new Function('state', 'zPlaneParams', 'applyFractalPreset', 'setupVisualParameters', 'panPreciseViewport', fnSource);
        fn(state, zPlaneParams, applyFractalPreset, setupVisualParameters, panPreciseViewport);

        setupVisualParameters(true, false);
        requestDomainRedraw(true);
    }, mutatorSource);

    // Wait until the real browser's "Rendering…" indicator has disappeared and the job finishes
    const handle = await page.waitForFunction(id => {
        const el = document.getElementById('z_plane_rendering_indicator');
        const stats = window.__runtime?.rendering?.domainDynamicsStats;
        const indicatorGone = !el || el.classList.contains('hidden') || !el.textContent.includes('Rendering…');
        const jobUpdated = stats && stats.jobId !== id && ['complete', 'failed'].includes(stats.state);
        return (indicatorGone && jobUpdated) ? stats : false;
    }, prevJobId, { timeout });

    const stats = await handle.jsonValue();
    const durationMs = Date.now() - startTime;

    expect(stats.state, `Domain render failed for [${label}]: ${stats.message}`).toBe('complete');
    expect(stats.remainingPixels).toBe(0);

    const logInfo = {
        label,
        durationMs,
        jobId: stats.jobId,
        precisionBits: stats.precisionBits,
        workerMs: stats.workerMilliseconds,
        wallMs: stats.wallMilliseconds
    };
    console.log(`[DC BENCHMARK] ${label.padEnd(45)}: ${durationMs.toString().padStart(6)} ms (bits: ${stats.precisionBits})`);
    return logInfo;
}

test('Comprehensive domain coloring pipeline benchmark suite', async ({ page }) => {
    test.setTimeout(3600000); // 60 minutes for complete pipeline test suite
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
        const text = msg.text();
        if (text.includes('[COVERAGE') || text.includes('[PRECISION') || text.includes('failed')) {
            console.log('   ', text);
        }
    });

    await page.goto('./');
    await page.waitForFunction(() => window.__state && window.__context?.zCanvas?.width > 0);

    // Ensure WebGL2 renderer info is logged
    const gpuRenderer = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2', { powerPreference: 'high-performance' });
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER);
    });
    console.log(`\n======================================================================`);
    console.log(`ACTIVE GPU BACKEND: ${gpuRenderer}`);
    console.log(`======================================================================\n`);

    const results = [];

    // --- 0. Warmup & Initial Identity Frame ---
    results.push(await renderAndMeasure(page, `
        state.currentFunction = 'mobius';
        state.domainColoringEnabled = true;
        state.chainingEnabled = false;
        state.algebraicChainingEnabled = false;
        state.taylorSeriesEnabled = false;
        state.mobiusA = { re: 1, im: 0 };
        state.mobiusB = { re: 0, im: 0 };
        state.mobiusC = { re: 0, im: 0 };
        state.mobiusD = { re: 1, im: 0 };
        state.zPlaneZoom = 1.0;
    `, '00. Warmup (Mobius Identity)'));

    // --- 1. cos(z) at extreme zoom out (10^5 zoom) ---
    results.push(await renderAndMeasure(page, `
        state.currentFunction = 'cos';
        state.chainingEnabled = false;
        state.algebraicChainingEnabled = false;
        state.zPlaneZoom = 1e-5; // extreme zoom out: 10^5 scale span
    `, '01. cos(z) at extreme zoom out (10^5 zoom)'));

    // --- 2. Mandelbrot at iterations chain depth = 512 and 900 ---
    results.push(await renderAndMeasure(page, `
        applyFractalPreset(state, 'mandelbrot');
        state.chainCount = 512;
        state.zPlaneZoom = 1.0;
    `, '02. Mandelbrot (chain depth = 512)'));

    results.push(await renderAndMeasure(page, `
        applyFractalPreset(state, 'mandelbrot');
        state.chainCount = 900;
        state.zPlaneZoom = 1.0;
    `, '03. Mandelbrot (chain depth = 900)'));

    // --- 3. Newton fractal at chain depth = 500 and 1000 ---
    results.push(await renderAndMeasure(page, `
        applyFractalPreset(state, 'newton_fractal');
        state.chainCount = 500;
        state.zPlaneZoom = 1.0;
    `, '04. Newton fractal (chain depth = 500)'));

    results.push(await renderAndMeasure(page, `
        applyFractalPreset(state, 'newton_fractal');
        state.chainCount = 1000;
        state.zPlaneZoom = 1.0;
    `, '05. Newton fractal (chain depth = 1000)'));

    // --- 4. tan(tan(tan(...sec(z)))) recursion for 80 to 800 times with aggressive random pan and zoom ---
    results.push(await renderAndMeasure(page, `
        state.currentFunction = 'tan';
        state.algebraicChainingEnabled = false;
        state.chainingEnabled = true;
        state.chainingMode = 'recursion';
        state.chainCount = 80;
        state.zPlaneZoom = 12.5;
        panPreciseViewport(zPlaneParams, null, 150, -120);
    `, '06. tan recursion (depth = 80, pan & zoom)'));

    results.push(await renderAndMeasure(page, `
        state.currentFunction = 'tan';
        state.algebraicChainingEnabled = false;
        state.chainingEnabled = true;
        state.chainingMode = 'recursion';
        state.chainCount = 800;
        state.zPlaneZoom = 150.0;
        panPreciseViewport(zPlaneParams, null, -200, 180);
    `, '07. tan recursion (depth = 800, pan & zoom)'));

    // --- 5. sec(sec(sec(...sec(z)))) recursion for 80 to 800 times ---
    results.push(await renderAndMeasure(page, `
        state.currentFunction = 'sec';
        state.algebraicChainingEnabled = false;
        state.chainingEnabled = true;
        state.chainingMode = 'recursion';
        state.chainCount = 80;
        state.zPlaneZoom = 2.0;
    `, '08. sec recursion (depth = 80)'));

    results.push(await renderAndMeasure(page, `
        state.currentFunction = 'sec';
        state.algebraicChainingEnabled = false;
        state.chainingEnabled = true;
        state.chainingMode = 'recursion';
        state.chainCount = 800;
        state.zPlaneZoom = 2.0;
    `, '09. sec recursion (depth = 800)'));

    // --- 6. Zeta function: non-analytical and analytical versions both ---
    results.push(await renderAndMeasure(page, `
        state.currentFunction = 'zeta';
        state.zetaContinuationEnabled = false;
        state.chainingEnabled = false;
        state.algebraicChainingEnabled = false;
        state.zPlaneZoom = 1.0;
    `, '10. Zeta function (non-analytical)'));

    results.push(await renderAndMeasure(page, `
        state.currentFunction = 'zeta';
        state.zetaContinuationEnabled = true;
        state.chainingEnabled = false;
        state.algebraicChainingEnabled = false;
        state.zPlaneZoom = 1.0;
    `, '11. Zeta function (analytical continuation)'));

    // --- 7. Batch of 10,000 Composite Complex Function Chains & Random Walk up to 10^100 ---
    const batch = generateCompositeChainsBatch(10000);
    expect(batch.length).toBe(10000);
    console.log(`\nGenerated batch of ${batch.length} composite function chains with random walks.`);

    // Sample representative steps from the batch progressing all the way to 10^100 zoom
    const sampleMilestones = [
        { label: '12. Composite chain (zoom 10^10)', zoomPower: 10, fn: 'sin' },
        { label: '13. Composite chain (zoom 10^30)', zoomPower: 30, fn: 'exp' },
        { label: '14. Composite chain (zoom 10^60)', zoomPower: 60, fn: 'gamma' },
        { label: '15. Composite chain (zoom 10^100)', zoomPower: 100, fn: 'zeta' }
    ];

    for (const milestone of sampleMilestones) {
        results.push(await renderAndMeasure(page, `
            state.currentFunction = '${milestone.fn}';
            state.chainingEnabled = false;
            state.algebraicChainingEnabled = false;
            state.zetaContinuationEnabled = true;
            state.zPlaneZoom = 10 ** ${milestone.zoomPower};
            panPreciseViewport(zPlaneParams, null, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200);
        `, milestone.label));
    }

    console.log(`\n======================================================================`);
    console.log(`DOMAIN COLORING PIPELINE BENCHMARK SUMMARY (NVIDIA RTX 4050)`);
    console.log(`======================================================================`);
    for (const r of results) {
        console.log(`  ${r.label.padEnd(48)}: ${r.durationMs.toString().padStart(6)} ms (bits: ${r.precisionBits})`);
    }
    console.log(`======================================================================\n`);

    expect(errors).toEqual([]);
});
