import assert from 'node:assert/strict';

import { runBenchmark } from './utils.js';
import { traceStreamlines } from '../../js/analysis/streamline.js';
import { state } from '../../js/store/state.js';
import { nativeMapOptions } from '../../js/native/complex-engine.js';

const BATCH_SEED_COUNTS = Object.freeze({
    smoke: 4,
    standard: 18,
    deep: 40
});

function algebraicFactor(func, overrides = {}) {
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

function makeCircularSeeds(count, radius = 1.25) {
    return Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2;
        return {
            x: radius * Math.cos(angle),
            y: radius * Math.sin(angle)
        };
    });
}

export async function runStreamlineTracingBenchmarks() {
    console.log('\n[Benchmark] Streamline tracing\n');

    await runBenchmark(
        'zeta-continuation inverse vector streamline',
        () => {
            Object.assign(state, {
                currentFunction: 'zeta',
                chainingEnabled: false,
                chainCount: 1,
                zetaContinuationEnabled: true,
                taylorSeriesEnabled: false
            });
            if (state.dynamicPlotting) state.dynamicPlotting.enabled = false;

            const planeParams = {
                currentVisXRange: [-2, 3],
                currentVisYRange: [10, 18]
            };
            const streamlineState = {
                streamlineStepSize: 0.006,
                streamlineMaxLength: 400
            };
            return { planeParams, streamlineState, map: nativeMapOptions(state) };
        },
        ({ planeParams, streamlineState, map }) =>
            traceStreamlines([{ x: 0.5, y: 14.1 }], map, planeParams,
                { ...streamlineState, vectorFieldFunction: '1/f(z)' })[0],
        {
            profiles: {
                smoke: { iterations: 2, warmup: 1 },
                standard: { iterations: 80, warmup: 8 },
                deep: { iterations: 240, warmup: 24 }
            },
            verify: path => {
                assert.ok(path.length > 100);
                assert.ok(path.every(point =>
                    Number.isFinite(point.x) &&
                    Number.isFinite(point.y) &&
                    Number.isFinite(point.magnitude)
                ));
            }
        }
    );

    await runBenchmark(
        'batched algebraic output-chain vector streamlines',
        ({ profile }) => {
            Object.assign(state, {
                currentFunction: 'algebraic_chaining',
                algebraicChainingEnabled: true,
                algebraicChainingZExpr: 'z',
                polynomialN: 1,
                polynomialCoeffs: [
                    { re: 0, im: 0 },
                    { re: 1, im: 0 }
                ],
                algebraicChainingTerms: [
                    { coeff: { re: 2 / 3, im: 0 }, factors: [algebraicFactor('polynomial')] },
                    { coeff: { re: 1 / 3, im: 0 }, factors: [algebraicFactor('polynomial', { power: 2, reciprocal: true })] }
                ],
                chainingEnabled: true,
                chainingMode: 'recursion',
                chainCount: 8
            });

            return {
                seeds: makeCircularSeeds(BATCH_SEED_COUNTS[profile]),
                planeParams: {
                    currentVisXRange: [-2, 2],
                    currentVisYRange: [-2, 2]
                },
                streamlineState: {
                    streamlineStepSize: 0.006,
                    streamlineMaxLength: 240
                },
                map: nativeMapOptions(state)
            };
        },
        ({ seeds, planeParams, streamlineState, map }) => {
            let totalPoints = 0;
            let checksum = 0;
            const paths = traceStreamlines(seeds, map, planeParams,
                { ...streamlineState, vectorFieldFunction: 'f(z)' });
            for (const path of paths) {
                totalPoints += path.length;
                for (const point of path) checksum += point.x * 0.5 + point.y * 0.25;
            }

            return { totalPoints, checksum };
        },
        {
            profiles: {
                smoke: { iterations: 2, warmup: 1 },
                standard: { iterations: 120, warmup: 12 },
                deep: { iterations: 400, warmup: 40 }
            },
            verify: ({ totalPoints, checksum }, { seeds }) => {
                assert.ok(totalPoints > seeds.length * 20);
                assert.ok(Number.isFinite(checksum));
            }
        }
    );
}

if (process.argv[1]?.endsWith('streamline-tracing.bench.js')) {
    runStreamlineTracingBenchmarks().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
