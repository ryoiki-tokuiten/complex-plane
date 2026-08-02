import assert from 'node:assert/strict';

import { runBenchmark } from './utils.js';
import { state } from '../../js/store/state.js';
import {
    evaluateMappedTransform,
    getChainedTransformFunction,
    getMappedTransformProfile
} from '../../js/math-utils.js';
import { generateCurrentInputShapePointSets } from '../../js/rendering/shape-generators.js';
import {
    calculateDynamicPointsForSegment,
    preparePointSetForMappedPlane
} from '../../js/rendering/draw-planar.js';

const GRID_DENSITIES = Object.freeze({
    smoke: 12,
    standard: 48,
    deep: 96
});

export async function runPlanarRenderingBenchmarks() {
    console.log('\n[Benchmark] Planar transformed-grid preparation and mapping\n');

    await runBenchmark(
        'prepare and map Cartesian grid through w = exp(z)',
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
            const transform = getChainedTransformFunction('exp');
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

            return {
                pointSets,
                transform,
                profile: getMappedTransformProfile('exp', transform)
            };
        },
        ({ pointSets, transform, profile }) => {
            let pointCount = 0;
            let checksum = 0;

            for (const pointSet of pointSets) {
                const prepared = preparePointSetForMappedPlane(pointSet, transform, {
                    sampleCountResolver: calculateDynamicPointsForSegment
                });

                for (const point of prepared.points) {
                    if (!point || !Number.isFinite(point.re) || !Number.isFinite(point.im)) continue;
                    const mapped = evaluateMappedTransform(profile, point.re, point.im, 'exp');
                    if (!mapped) continue;
                    pointCount += 1;
                    checksum += mapped.re * 0.125 + mapped.im * 0.25;
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
                assert.ok(pointCount >= pointSets.length * 64);
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
