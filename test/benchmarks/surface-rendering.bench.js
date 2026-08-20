import assert from 'node:assert/strict';

import { runBenchmark } from './utils.js';
import { state } from '../../js/store/state.js';
import { buildRealPlotSurface, renderRealPlotContour } from '../../js/rendering/real-plots-renderer.js';
import { buildNativeLaplaceWinding } from '../../js/native/complex-engine.js';
import {
    buildRiemannSurfaceMathLibrary,
    getRiemannSurfaceGridData
} from '../../js/rendering/webgl-riemann-surface.js';

const REAL_PLOT_SEGMENTS = Object.freeze({
    smoke: 16,
    standard: 40,
    deep: 80
});

const REAL_CONTOUR_SIZES = Object.freeze({
    smoke: 64,
    standard: 256,
    deep: 512
});

const RIEMANN_RESOLUTIONS = Object.freeze({
    smoke: [42],
    standard: [64, 128],
    deep: [96, 160, 224]
});

const LAPLACE_SAMPLE_COUNTS = Object.freeze({
    smoke: 256,
    standard: 1024,
    deep: 4096
});

function factor(func, overrides = {}) {
    return {
        func,
        chainedFunc: 'none',
        power: 1,
        reciprocal: false,
        log: false,
        exp: false,
        ...overrides
    };
}

function configureSurfaceState() {
    Object.assign(state, {
        currentFunction: 'algebraic_chaining',
        algebraicChainingEnabled: true,
        algebraicChainingZExpr: 'z',
        polynomialN: 2,
        polynomialCoeffs: [
            { re: 0.2, im: 0.1 },
            { re: -0.3, im: 0.05 },
            { re: 0.08, im: -0.02 }
        ],
        algebraicChainingTerms: [
            { coeff: { re: 0.24, im: -0.08 }, factors: [factor('cos', { chainedFunc: 'polynomial', power: 2 })] },
            { coeff: { re: -0.12, im: 0.05 }, factors: [factor('sinh', { reciprocal: true })] },
            { coeff: { re: 0.06, im: 0.02 }, factors: [factor('ln', { chainedFunc: 'exp' })] },
            { coeff: { re: 0.1, im: -0.03 }, factors: [factor('c')] }
        ],
        chainingEnabled: true,
        chainingMode: 'recursion',
        chainCount: 4,
        fractionalPowerN: 0.5,
        zetaContinuationEnabled: false,
        taylorSeriesEnabled: false
    });
    if (state.dynamicPlotting) state.dynamicPlotting.enabled = false;
}

export async function runSurfaceRenderingBenchmarks() {
    console.log('\n[Benchmark] 3D real-plot and Riemann-surface CPU preparation\n');

    await runBenchmark(
        'native per-frame Laplace damping and winding geometry',
        ({ profile }) => {
            const count = LAPLACE_SAMPLE_COUNTS[profile];
            const signal = Array.from({ length: count }, (_, index) => {
                const t = index * 6 / (count - 1);
                return { t, value: Math.sin(3 * t) * Math.exp(-0.15 * t) };
            });
            return { signal };
        },
        ({ signal }) => buildNativeLaplaceWinding(signal, 0.35, 4.2, 0.73),
        {
            profiles: {
                smoke: { iterations: 3, warmup: 1 },
                standard: { iterations: 80, warmup: 10 },
                deep: { iterations: 180, warmup: 18 }
            },
            verify: frame => {
                assert.ok(frame.points.length > 0);
                assert.ok(frame.weighted.length >= frame.points.length);
                assert.ok(Number.isFinite(frame.integral.real));
                assert.ok(Number.isFinite(frame.integral.imag));
            }
        }
    );

    await runBenchmark(
        'real 3D plot heightfield sampling from algebraic output chain',
        ({ profile }) => {
            configureSurfaceState();
            return { segments: REAL_PLOT_SEGMENTS[profile] };
        },
        ({ segments }) => buildRealPlotSurface({
            segments,
            xRange: [-1.25, 1.25],
            yRange: [-1.25, 1.25],
            inputExpr: 'x',
            imagExpr: 'y',
            outputComponent: 'magnitude',
            colorMode: 'phase',
            heightScale: 1
        }),
        {
            profiles: {
                smoke: { iterations: 2, warmup: 1 },
                standard: { iterations: 40, warmup: 6 },
                deep: { iterations: 120, warmup: 12 }
            },
            verify: sampled => {
                assert.ok(sampled.vertexCount > 0);
                assert.ok(sampled.finiteResultCount > sampled.vertexCount * 0.9);
                assert.ok(sampled.positions.every(Number.isFinite));
                assert.ok(sampled.normals.every(Number.isFinite));
            }
        }
    );

    await runBenchmark(
        'full-resolution real contour evaluation, shading, and RGBA packing in native C',
        ({ profile }) => {
            configureSurfaceState();
            return { size: REAL_CONTOUR_SIZES[profile] };
        },
        ({ size }) => renderRealPlotContour({
            width: size,
            height: size,
            xRange: [-1.25, 1.25],
            yRange: [-1.25, 1.25],
            inputExpr: 'x',
            imagExpr: 'y',
            outputComponent: 'magnitude',
            palette: 'viridis',
            contoursEnabled: true,
            contourInterval: 0.25,
            contourThickness: 1.5
        }),
        {
            profiles: {
                smoke: { iterations: 2, warmup: 1 },
                standard: { iterations: 20, warmup: 4 },
                deep: { iterations: 60, warmup: 8 }
            },
            verify: (pixels, { size }) => {
                assert.equal(pixels.length, size * size * 4);
                assert.equal(pixels[3], 255);
            }
        }
    );

    await runBenchmark(
        'Riemann surface grid and shader-library preparation',
        ({ profile }) => {
            configureSurfaceState();
            return { appState: state, resolutions: RIEMANN_RESOLUTIONS[profile] };
        },
        ({ appState, resolutions }) => {
            const library = buildRiemannSurfaceMathLibrary(appState);
            let gridBytes = 0;
            for (const resolution of resolutions) {
                const grid = getRiemannSurfaceGridData(resolution);
                gridBytes += grid.vertices.byteLength + grid.triangles.byteLength + grid.lines.byteLength;
            }
            return { libraryLength: library.length, gridBytes };
        },
        {
            profiles: {
                smoke: { iterations: 2, warmup: 1 },
                standard: { iterations: 60, warmup: 8 },
                deep: { iterations: 180, warmup: 18 }
            },
            verify: ({ libraryLength, gridBytes }) => {
                assert.ok(libraryLength > 1000);
                assert.ok(gridBytes > 0);
            }
        }
    );
}

if (process.argv[1]?.endsWith('surface-rendering.bench.js')) {
    runSurfaceRenderingBenchmarks().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
