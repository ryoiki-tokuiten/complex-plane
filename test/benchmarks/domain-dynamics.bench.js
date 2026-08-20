import assert from 'node:assert/strict';

import { runBenchmark } from './utils.js';
import { state } from '../../js/store/state.js';
import { buildPlanarDomainDynamicsSnapshot } from '../../js/rendering/domain-dynamics.js';
import { renderDomainDynamicsTile } from '../../js/native/domain-engine.js';

const TILE_SIZES = Object.freeze({
    smoke: 32,
    standard: 96,
    deep: 160
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

function configureAlgebraicDynamics() {
    Object.assign(state, {
        currentFunction: 'algebraic_chaining',
        domainColoringEnabled: true,
        domainPalette: 'arctic-frost',
        domainBrightness: 1,
        domainContrast: 1,
        domainSaturation: 1,
        domainLightnessCycles: 0,
        algebraicChainingEnabled: true,
        algebraicChainingZExpr: 'z',
        polynomialN: 2,
        polynomialCoeffs: [
            { re: 0.1, im: -0.05 },
            { re: 0.4, im: 0.15 },
            { re: -0.2, im: 0.05 }
        ],
        algebraicChainingTerms: [
            { coeff: { re: 0.7, im: -0.2 }, factors: [factor('polynomial')] },
            { coeff: { re: 0.25, im: 0.1 }, factors: [factor('cos', { power: 2 })] },
            { coeff: { re: 0.08, im: -0.04 }, factors: [factor('c')] },
            { coeff: { re: 0.05, im: 0 }, factors: [factor('sinh', { reciprocal: true })] }
        ],
        chainingEnabled: true,
        chainingMode: 'recursion',
        chainCount: 24,
        orbitColoringMode: 'value',
        taylorSeriesEnabled: false,
        zetaContinuationEnabled: false
    });
    if (state.dynamicPlotting) state.dynamicPlotting.enabled = false;
}

function makePlane(size, centerRe = 0, centerIm = 0, span = 3) {
    return {
        width: size,
        height: size,
        currentVisXRange: [centerRe - span * 0.5, centerRe + span * 0.5],
        currentVisYRange: [centerIm - span * 0.5, centerIm + span * 0.5]
    };
}

function assertOpaqueTile(pixels, expectedLength) {
    assert.equal(pixels.length, expectedLength);
    for (let index = 3; index < pixels.length; index += 4) {
        assert.equal(pixels[index], 255);
    }
}

function configureDeepTrigChain(depth = 140, power = 1.0) {
    Object.assign(state, {
        currentFunction: 'algebraic_chaining',
        domainColoringEnabled: true,
        domainPalette: 'arctic-frost',
        domainBrightness: 1,
        domainContrast: 1,
        domainSaturation: 1,
        domainLightnessCycles: 0,
        algebraicChainingEnabled: true,
        algebraicChainingZExpr: 'z',
        polynomialN: 1,
        polynomialCoeffs: [{ re: 0, im: 0 }, { re: 1, im: 0 }],
        algebraicChainingTerms: [
            {
                coeff: { re: 1, im: 0 },
                factors: [
                    factor('tan', {
                        power: 1,
                        steps: ['sec', 'tan', 'tan', 'tan', 'tan'],
                        innerPower: power
                    })
                ]
            }
        ],
        chainingEnabled: true,
        chainingMode: 'recursion',
        chainCount: depth,
        orbitColoringMode: 'value',
        taylorSeriesEnabled: false,
        zetaContinuationEnabled: false
    });
    if (state.dynamicPlotting) state.dynamicPlotting.enabled = false;
}

function configureSecExpChain(depth = 140) {
    Object.assign(state, {
        currentFunction: 'algebraic_chaining',
        domainColoringEnabled: true,
        domainPalette: 'arctic-frost',
        domainBrightness: 1,
        domainContrast: 1,
        domainSaturation: 1,
        domainLightnessCycles: 0,
        algebraicChainingEnabled: true,
        algebraicChainingZExpr: 'z',
        polynomialN: 1,
        polynomialCoeffs: [{ re: 0, im: 0 }, { re: 1, im: 0 }],
        algebraicChainingTerms: [
            {
                coeff: { re: 1, im: 0 },
                factors: [factor('sec', { power: Math.E })]
            }
        ],
        chainingEnabled: true,
        chainingMode: 'recursion',
        chainCount: depth,
        orbitColoringMode: 'value',
        taylorSeriesEnabled: false,
        zetaContinuationEnabled: false
    });
    if (state.dynamicPlotting) state.dynamicPlotting.enabled = false;
}

export async function runDomainDynamicsBenchmarks() {
    console.log('\n[Benchmark] Domain-dynamics tile rendering workflows\n');

    await runBenchmark(
        'algebraic output-chain domain-coloring tile',
        ({ profile }) => {
            configureAlgebraicDynamics();
            const size = TILE_SIZES[profile];
            const snapshot = buildPlanarDomainDynamicsSnapshot(state, makePlane(size), { isWPlaneColoring: false });
            return { snapshot, tile: { x: 0, y: 0, width: size, height: size, scale: 1 } };
        },
        ({ snapshot, tile }) => renderDomainDynamicsTile(snapshot, tile),
        {
            profiles: {
                smoke: { iterations: 2, warmup: 1 },
                standard: { iterations: 20, warmup: 4 },
                deep: { iterations: 80, warmup: 8 }
            },
            verify: (pixels, { tile }) => assertOpaqueTile(pixels, tile.width * tile.height * 4)
        }
    );

    await runBenchmark(
        'viewport-churn progressive tile passes',
        ({ profile }) => {
            configureAlgebraicDynamics();
            const size = Math.max(16, TILE_SIZES[profile] >> 1);
            const planes = [
                makePlane(size, 0, 0, 3),
                makePlane(size, -0.35, 0.25, 1.2),
                makePlane(size, 0.15, -0.1, 0.25)
            ];
            const snapshots = planes.map(plane =>
                buildPlanarDomainDynamicsSnapshot(state, plane, { isWPlaneColoring: false })
            );
            const tiles = [
                { x: 0, y: 0, width: size, height: size, scale: 4 },
                { x: 0, y: 0, width: size, height: size, scale: 1 }
            ];
            return { snapshots, tiles, size };
        },
        ({ snapshots, tiles }) => {
            let checksum = 0;
            let pixelCount = 0;
            for (const snapshot of snapshots) {
                for (const tile of tiles) {
                    const pixels = renderDomainDynamicsTile(snapshot, tile);
                    pixelCount += pixels.length;
                    checksum += pixels[0] + pixels[1] + pixels[2];
                }
            }
            return { pixelCount, checksum };
        },
        {
            profiles: {
                smoke: { iterations: 2, warmup: 1 },
                standard: { iterations: 15, warmup: 3 },
                deep: { iterations: 60, warmup: 6 }
            },
            verify: ({ pixelCount, checksum }, { snapshots, tiles, size }) => {
                assert.equal(pixelCount, snapshots.length * tiles.length * size * size * 4);
                assert.ok(Number.isFinite(checksum));
            }
        }
    );

    await runBenchmark(
        'deep composition tan(tan(tan(tan(sec(z))))) tile across depths and zooms',
        ({ profile }) => {
            const depths = [24, 40, 140, 201, 250, 300, 315, 500];
            const depth = depths[profile === 'deep' ? 7 : profile === 'standard' ? 2 : 0];
            configureDeepTrigChain(depth);
            const size = Math.max(16, TILE_SIZES[profile] >> 1);
            const zoomSpans = [3.0, 3e-6, 3e-12, 3e-14, 3e-17];
            const span = zoomSpans[profile === 'deep' ? 4 : profile === 'standard' ? 2 : 0];
            const snapshot = buildPlanarDomainDynamicsSnapshot(state, makePlane(size, 0.2, 0.1, span), { isWPlaneColoring: false });
            return { snapshot, tile: { x: 0, y: 0, width: size, height: size, scale: 1 } };
        },
        ({ snapshot, tile }) => renderDomainDynamicsTile(snapshot, tile),
        {
            profiles: {
                smoke: { iterations: 2, warmup: 1 },
                standard: { iterations: 12, warmup: 3 },
                deep: { iterations: 40, warmup: 6 }
            },
            verify: (pixels, { tile }) => assertOpaqueTile(pixels, tile.width * tile.height * 4)
        }
    );

    await runBenchmark(
        'deep non-integer power chain tan(tan(tan(tan(sec(z)^1.4)))) and sec(z)^e',
        ({ profile }) => {
            const depths = [24, 40, 140, 201, 250, 300, 500];
            const depth = depths[profile === 'deep' ? 6 : profile === 'standard' ? 2 : 0];
            configureDeepTrigChain(depth, 1.4);
            const size = Math.max(16, TILE_SIZES[profile] >> 1);
            const snapshot1 = buildPlanarDomainDynamicsSnapshot(state, makePlane(size, 0, 0, 2.5), { isWPlaneColoring: false });
            configureSecExpChain(depth);
            const snapshot2 = buildPlanarDomainDynamicsSnapshot(state, makePlane(size, 0.1, -0.1, 1e-14), { isWPlaneColoring: false });
            return { snapshots: [snapshot1, snapshot2], tile: { x: 0, y: 0, width: size, height: size, scale: 1 } };
        },
        ({ snapshots, tile }) => {
            const p1 = renderDomainDynamicsTile(snapshots[0], tile);
            const p2 = renderDomainDynamicsTile(snapshots[1], tile);
            return p1[0] + p2[0];
        },
        {
            profiles: {
                smoke: { iterations: 2, warmup: 1 },
                standard: { iterations: 10, warmup: 2 },
                deep: { iterations: 30, warmup: 5 }
            },
            verify: (checksum) => assert.ok(Number.isFinite(checksum))
        }
    );

    await runBenchmark(
        'rapid convergence sec(z)^15 vs transcendental recursion across extreme zooms',
        ({ profile }) => {
            const depths = [24, 140, 500];
            const depth = depths[profile === 'deep' ? 2 : profile === 'standard' ? 1 : 0];
            configureDeepTrigChain(depth, 15);
            const size = Math.max(16, TILE_SIZES[profile] >> 1);
            const snapshot = buildPlanarDomainDynamicsSnapshot(state, makePlane(size, 0.3, 0.2, 1e-17), { isWPlaneColoring: false });
            return { snapshot, tile: { x: 0, y: 0, width: size, height: size, scale: 1 } };
        },
        ({ snapshot, tile }) => renderDomainDynamicsTile(snapshot, tile),
        {
            profiles: {
                smoke: { iterations: 2, warmup: 1 },
                standard: { iterations: 12, warmup: 3 },
                deep: { iterations: 40, warmup: 6 }
            },
            verify: (pixels, { tile }) => assertOpaqueTile(pixels, tile.width * tile.height * 4)
        }
    );

    await runBenchmark(
        'randomized multi-path deep-zoom coordinate trajectory walks (100-200 samples)',
        ({ profile }) => {
            const pathCounts = { smoke: 5, standard: 50, deep: 150 };
            const pathCount = pathCounts[profile] || 50;
            const depths = [24, 72, 140, 201, 300, 500];
            const zoomSteps = [1.0, 1e-3, 1e-6, 1e-9, 1e-12, 1e-15, 1e-17];
            const size = Math.max(16, TILE_SIZES[profile] >> 2);

            // Deterministic pseudo-random seed generator (LCG)
            let seed = 123456789;
            const rand = () => {
                seed = (seed * 1664525 + 1013904223) >>> 0;
                return (seed & 0xFFFFFF) / 0x1000000;
            };

            const jobs = [];
            for (let p = 0; p < pathCount; p++) {
                let centerRe = (rand() - 0.5) * 3.0;
                let centerIm = (rand() - 0.5) * 3.0;
                const depth = depths[p % depths.length];
                configureDeepTrigChain(depth);

                const span = zoomSteps[p % zoomSteps.length];
                centerRe += (rand() - 0.5) * span * 0.5;
                centerIm += (rand() - 0.5) * span * 0.5;

                const snapshot = buildPlanarDomainDynamicsSnapshot(
                    state,
                    makePlane(size, centerRe, centerIm, span),
                    { isWPlaneColoring: false }
                );
                jobs.push({ snapshot, tile: { x: 0, y: 0, width: size, height: size, scale: 1 } });
            }
            return { jobs };
        },
        ({ jobs }) => {
            let checksum = 0;
            for (const { snapshot, tile } of jobs) {
                const pixels = renderDomainDynamicsTile(snapshot, tile);
                checksum += pixels[0] + pixels[1] + pixels[2] + pixels[3];
            }
            return checksum;
        },
        {
            profiles: {
                smoke: { iterations: 2, warmup: 1 },
                standard: { iterations: 8, warmup: 2 },
                deep: { iterations: 20, warmup: 3 }
            },
            verify: (checksum) => assert.ok(Number.isFinite(checksum) && checksum > 0)
        }
    );
}

if (process.argv[1]?.endsWith('domain-dynamics.bench.js')) {
    runDomainDynamicsBenchmarks().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
