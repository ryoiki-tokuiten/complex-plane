import assert from 'node:assert/strict';

import { BENCH_PROFILE, runBenchmark } from './utils.js';
import { compileExpression } from '../../js/math/expression/index.js';
import { state } from '../../js/store/state.js';
import { getChainedTransformFunction } from '../../js/native/map-runtime.js';

const TILE_SIZES = Object.freeze({
    smoke: 48,
    standard: 160,
    deep: 256
});

const CHAIN_TILE_SIZES = Object.freeze({
    smoke: 32,
    standard: 96,
    deep: 160
});

function makePlaneGrid(size, xRange, yRange) {
    const planeZ = new Float64Array(size * size * 2);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const idx = (y * size + x) * 2;
            planeZ[idx] = xRange[0] + ((x + 0.5) / size) * (xRange[1] - xRange[0]);
            planeZ[idx + 1] = yRange[1] - ((y + 0.5) / size) * (yRange[1] - yRange[0]);
        }
    }
    return planeZ;
}

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

function setupAlgebraicChainBenchmark(profile, forceFallback = false) {
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
        chainCount: 40
    });

    const originalFunction = globalThis.Function;
    if (forceFallback) {
        globalThis.Function = function blockedDynamicFunction() {
            throw new Error('Dynamic function construction blocked by benchmark');
        };
    }

    try {
        const size = CHAIN_TILE_SIZES[profile];
        const evaluator = getChainedTransformFunction('algebraic_chaining');
        if (forceFallback) evaluator(1, 0);
        return {
            evaluator,
            planeZ: makePlaneGrid(size, [-2, 2], [-2, 2]),
            length: size * size
        };
    } finally {
        globalThis.Function = originalFunction;
    }
}

function evaluateAlgebraicChainTile({ evaluator, planeZ, length }) {
    const result = new Float64Array(length * 2);
    let finiteCount = 0;
    let checksum = 0;

    for (let index = 0; index < length; index += 1) {
        const offset = index * 2;
        const w = evaluator(planeZ[offset], planeZ[offset + 1]);
        if (w && Number.isFinite(w.re) && Number.isFinite(w.im)) {
            result[offset] = w.re;
            result[offset + 1] = w.im;
            finiteCount += 1;
            checksum += w.re - w.im;
        } else {
            result[offset] = NaN;
            result[offset + 1] = NaN;
        }
    }

    return { result, finiteCount, checksum };
}

export async function runAlgebraicCompilerBenchmarks() {
    console.log('\n[Benchmark] Algebraic compiler and transform hot paths\n');

    await runBenchmark(
        'compiled rational expression over a dense viewport grid',
        ({ profile }) => {
            const size = TILE_SIZES[profile];
            return {
                evaluator: compileExpression('(z^2 - 1) * (z - 2 - i)^2 / (z^2 + 2 + 2i)', {
                    allowedVariables: ['z']
                }),
                planeZ: makePlaneGrid(size, [-3, 3], [-3, 3]),
                length: size * size
            };
        },
        ({ evaluator, planeZ, length }) => {
            const result = new Float64Array(length * 2);
            const env = { z: { re: 0, im: 0 } };
            let finiteCount = 0;
            let checksum = 0;

            for (let index = 0; index < length; index += 1) {
                const offset = index * 2;
                env.z.re = planeZ[offset];
                env.z.im = planeZ[offset + 1];
                const w = evaluator(env);

                if (w && Number.isFinite(w.re) && Number.isFinite(w.im)) {
                    result[offset] = w.re;
                    result[offset + 1] = w.im;
                    finiteCount += 1;
                    checksum += w.re * 0.5 + w.im * 0.25;
                } else {
                    result[offset] = NaN;
                    result[offset + 1] = NaN;
                }
            }

            return { result, finiteCount, checksum };
        },
        {
            profiles: {
                smoke: { iterations: 2, warmup: 1 },
                standard: { iterations: 20, warmup: 5 },
                deep: { iterations: 80, warmup: 10 }
            },
            verify: ({ result, finiteCount, checksum }, { length }) => {
                assert.equal(result.length, length * 2);
                assert.ok(finiteCount > length * 0.95);
                assert.ok(Number.isFinite(checksum));
            }
        }
    );

    const chainOptions = {
        profiles: {
            smoke: { iterations: 2, warmup: 1 },
            standard: { iterations: 12, warmup: 3 },
            deep: { iterations: 40, warmup: 8 }
        },
        verify: ({ result, finiteCount, checksum }, { length }) => {
            assert.equal(result.length, length * 2);
            assert.ok(finiteCount > length * 0.5);
            assert.ok(Number.isFinite(checksum));
        }
    };
    const generatedStats = await runBenchmark(
        'generated algebraic z^3 Newton-style output chain over a tile',
        ({ profile }) => setupAlgebraicChainBenchmark(profile),
        evaluateAlgebraicChainTile,
        chainOptions
    );
    const fallbackStats = await runBenchmark(
        'CSP fallback algebraic z^3 Newton-style output chain over a tile',
        ({ profile }) => setupAlgebraicChainBenchmark(profile, true),
        evaluateAlgebraicChainTile,
        chainOptions
    );

    const generatedReference = evaluateAlgebraicChainTile(setupAlgebraicChainBenchmark(BENCH_PROFILE));
    const fallbackReference = evaluateAlgebraicChainTile(setupAlgebraicChainBenchmark(BENCH_PROFILE, true));
    assert.equal(fallbackReference.finiteCount, generatedReference.finiteCount);
    assert.equal(fallbackReference.checksum, generatedReference.checksum);
    assert.deepEqual(fallbackReference.result, generatedReference.result);

    assert.ok(
        generatedStats.median < fallbackStats.median * 0.8,
        `generated kernel median ${generatedStats.median.toFixed(3)}ms should remain materially faster than fallback ${fallbackStats.median.toFixed(3)}ms`
    );
}

if (process.argv[1]?.endsWith('algebraic-compiler.bench.js')) {
    runAlgebraicCompilerBenchmarks().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
