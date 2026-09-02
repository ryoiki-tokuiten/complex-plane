import assert from 'node:assert/strict';

import { runBenchmark } from './utils.js';
import { state } from '../../js/store/state.js';
import { generateCurrentInputShapePointSets } from '../../js/rendering/shape-generators.js';
import { getPointSetEndpoints } from '../../js/rendering/draw-planar.js';
import { buildNativePlanarLines, nativeMapOptions } from '../../js/native/complex-engine.js';

const GRID_DENSITIES = Object.freeze({
    smoke: 12,
    standard: 48,
    deep: 96
});

export async function runPlanarRenderingBenchmarks() {
    console.log('\n[Benchmark] Planar transformed-grid preparation and mapping\n');

    await runBenchmark(
        'build final Cartesian grid geometry through w = exp(z)',
        ({ profile }) => {
            Object.assign(state, {
                currentFunction: 'exp',
                chainingEnabled: false,
                chainCount: 1,
                zetaContinuationEnabled: false,
                taylorSeriesEnabled: false
            });
            if (state.dynamicPlotting) state.dynamicPlotting.enabled = false;

            const gridDensity = GRID_DENSITIES[profile];
            const planeParams = {
                currentVisXRange: [-Math.PI, Math.PI],
                currentVisYRange: [-Math.PI, Math.PI]
            };
            const pointSets = generateCurrentInputShapePointSets(planeParams, {
                currentInputShape: 'grid_cartesian',
                currentFunction: 'exp',
                zetaContinuationEnabled: false,
                gridDensity,
                    curvePoints: 96
                });

            const lines = pointSets.map(pointSet => {
                const endpoints = getPointSetEndpoints(pointSet);
                return { ...endpoints, sampleCount: 512 };
            });
            return { pointSets, lines, map: nativeMapOptions(state, { functionKey: 'exp' }) };
        },
        ({ lines, map }) => {
            let pointCount = 0;
            let checksum = 0;
            const geometries = buildNativePlanarLines({
                map,
                lines,
                scaleX: 80,
                scaleY: 80,
                renderLimit: 128,
                jumpThresholdSq: 65536,
                toleranceSq: 0.01,
                hasBranchCuts: false,
                branchCutAngle: Math.PI
            });
            for (const geometry of geometries) {
                for (let index = 0; index < geometry.length; index += 2) {
                    const re = geometry[index];
                    const im = geometry[index + 1];
                    if (!Number.isFinite(re) || !Number.isFinite(im)) continue;
                    pointCount += 1;
                    checksum += re * 0.125 + im * 0.25;
                }
            }
            return { pointCount, checksum };
        },
        {
            profiles: {
                smoke: { iterations: 3, warmup: 1 },
                standard: { iterations: 80, warmup: 10 },
                deep: { iterations: 240, warmup: 30 }
            },
            verify: ({ pointCount, checksum }, { pointSets }) => {
                assert.ok(pointSets.length > 0);
                assert.ok(pointCount >= pointSets.length * 2);
                assert.ok(Number.isFinite(checksum));
            }
        }
    );
}

if (process.argv[1]?.endsWith('planar-rendering.bench.js')) {
    runPlanarRenderingBenchmarks().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
