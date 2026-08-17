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
            { coeff: { re: 0.25, im: 0.1 }, factors: [factor('sin', { power: 2 })] },
            { coeff: { re: 0.08, im: -0.04 }, factors: [factor('c')] },
            { coeff: { re: 0.05, im: 0 }, factors: [factor('cosh', { reciprocal: true })] }
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
}

if (process.argv[1]?.endsWith('domain-dynamics.bench.js')) {
    runDomainDynamicsBenchmarks().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
