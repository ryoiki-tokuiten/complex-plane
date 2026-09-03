import assert from 'node:assert/strict';

import { runBenchmark, assertFiniteComplex } from './utils.js';
import { state } from '../../js/store/state.js';
import { evaluateNativePoints, nativeMapOptions } from '../../js/native/complex-engine.js';

const POINT_COUNTS = Object.freeze({
    smoke: 512,
    standard: 8192,
    deep: 32768
});

function makePoints(count) {
    const side = Math.ceil(Math.sqrt(count));
    return Array.from({ length: count }, (_, index) => {
        const column = index % side;
        const row = Math.floor(index / side);
        return {
            re: -2 + ((column + 0.5) / side) * 4,
            im: 2 - ((row + 0.5) / side) * 4
        };
    });
}

function summarize(result) {
    const sampleIndex = Math.floor(result.values.length / 2);
    return {
        pointCount: result.values.length,
        validSample: result.valid[sampleIndex],
        value: result.values[sampleIndex]
    };
}

export async function runNativePointBridgeBenchmarks() {
    console.log('\n[Benchmark] Current JS object-to-WASM point bridge\n');

    await runBenchmark(
        'evaluateNativePoints object bridge',
        ({ profile }) => {
            Object.assign(state, {
                currentFunction: 'exp',
                mapPresentation: 'function',
                chainingEnabled: false,
                algebraicChainingEnabled: false,
                chainCount: 1,
                zetaContinuationEnabled: false,
                taylorSeriesEnabled: false
            });
            if (state.dynamicPlotting) state.dynamicPlotting.enabled = false;

            const points = makePoints(POINT_COUNTS[profile]);
            return {
                options: nativeMapOptions(state, {
                    functionKey: 'exp',
                    chainingEnabled: false,
                    chainCount: 1
                }),
                points
            };
        },
        ({ options, points }) => summarize(evaluateNativePoints(options, points)),
        {
            profiles: {
                smoke: { iterations: 2, warmup: 1 },
                standard: { iterations: 12, warmup: 3 },
                deep: { iterations: 24, warmup: 5 }
            },
            verify: ({ pointCount, validSample, value }, { points }) => {
                assert.equal(pointCount, points.length);
                assert.equal(validSample, 1);
                assertFiniteComplex(value, 'native bridge sample');
            }
        }
    );
}

if (process.argv[1]?.endsWith('native-point-bridge.bench.js')) {
    runNativePointBridgeBenchmarks().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
