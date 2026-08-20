import assert from 'node:assert/strict';

import { runBenchmark } from './utils.js';
import { compileExpression } from '../../js/math/expression/index.js';
import { resolveActiveMap } from '../../js/math/active-map.js';
import { state } from '../../js/store/state.js';

const TILE_SIZES = Object.freeze({ smoke: 48, standard: 160, deep: 256 });
const CHAIN_TILE_SIZES = Object.freeze({ smoke: 32, standard: 96, deep: 160 });

function makePlanePoints(size, xRange, yRange) {
    return Array.from({ length: size * size }, (_, index) => {
        const x = index % size;
        const y = Math.floor(index / size);
        return {
            re: xRange[0] + ((x + 0.5) / size) * (xRange[1] - xRange[0]),
            im: yRange[1] - ((y + 0.5) / size) * (yRange[1] - yRange[0])
        };
    });
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

function setupAlgebraicChainBenchmark(profile) {
    Object.assign(state, {
        currentFunction: 'algebraic_chaining',
        algebraicChainingEnabled: true,
        algebraicChainingZExpr: 'z',
        polynomialN: 1,
        polynomialCoeffs: [{ re: 0, im: 0 }, { re: 1, im: 0 }],
        algebraicChainingTerms: [
            { coeff: { re: 2 / 3, im: 0 }, factors: [algebraicFactor('polynomial')] },
            { coeff: { re: 1 / 3, im: 0 }, factors: [algebraicFactor('polynomial', { power: 2, reciprocal: true })] }
        ],
        chainingEnabled: true,
        chainingMode: 'recursion',
        chainCount: 40
    });

    const size = CHAIN_TILE_SIZES[profile];
    return { evaluator: resolveActiveMap(), points: makePlanePoints(size, [-2, 2], [-2, 2]) };
}

function summarize(values) {
    let finiteCount = 0;
    let checksum = 0;
    for (const value of values) {
        if (!Number.isFinite(value?.re) || !Number.isFinite(value?.im)) continue;
        finiteCount += 1;
        checksum += value.re - value.im;
    }
    return { values, finiteCount, checksum };
}

export async function runAlgebraicCompilerBenchmarks() {
    console.log('\n[Benchmark] Batched native expression and transform hot paths\n');

    await runBenchmark(
        'native expression VM over a dense viewport grid in one batch',
        ({ profile }) => {
            const size = TILE_SIZES[profile];
            const points = makePlanePoints(size, [-3, 3], [-3, 3]);
            return {
                evaluator: compileExpression('(z^2 - 1) * (z - 2 - i)^2 / (z^2 + 2 + 2i)', {
                    allowedVariables: ['z']
                }),
                environments: points.map(z => ({ z }))
            };
        },
        ({ evaluator, environments }) => summarize(evaluator.evaluateBatch(environments)),
        {
            profiles: {
                smoke: { iterations: 2, warmup: 1 },
                standard: { iterations: 20, warmup: 5 },
                deep: { iterations: 80, warmup: 10 }
            },
            verify: ({ values, finiteCount, checksum }, { environments }) => {
                assert.equal(values.length, environments.length);
                assert.ok(finiteCount > environments.length * 0.95);
                assert.ok(Number.isFinite(checksum));
            }
        }
    );

    const nativeStats = await runBenchmark(
        'native algebraic z^3 Newton-style output chain in one batch',
        ({ profile }) => setupAlgebraicChainBenchmark(profile),
        ({ evaluator, points }) => summarize(evaluator.evaluateBatch(points)),
        {
            profiles: {
                smoke: { iterations: 2, warmup: 1 },
                standard: { iterations: 12, warmup: 3 },
                deep: { iterations: 40, warmup: 8 }
            },
            verify: ({ values, finiteCount, checksum }, { points }) => {
                assert.equal(values.length, points.length);
                assert.ok(finiteCount > points.length * 0.5);
                assert.ok(Number.isFinite(checksum));
            }
        }
    );

    assert.ok(
        Number.isFinite(nativeStats.median) && nativeStats.median > 0,
        `native batch median ${nativeStats.median.toFixed(3)}ms should be finite and measured`
    );
}

if (process.argv[1]?.endsWith('algebraic-compiler.bench.js')) {
    runAlgebraicCompilerBenchmarks().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
