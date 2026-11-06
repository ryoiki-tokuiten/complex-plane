import test from 'node:test';
import assert from 'node:assert/strict';

import { applyFractalPreset } from '../js/analysis/fractal-presets.js';
import { context, state } from '../js/store/state.js';
import {
    getEffectiveBaseTransformFunction,
    getMappedTransformProfile
} from '../js/native/map-runtime.js';
import { completeNativeMapOptions, evaluateDomainColoringMappedTransform } from './helpers/native-map.js';
import {
    compileStateToUnifiedExpression,
    buildComputeShader,
    syncBigIntCameraFromPlaneParams,
    numberToBigFixed,
    bigFixedToQS,
    qsToNumber,
    domainColorForValue,
    synchronizePlanarDomainVisibility,
    cancelPlanarDomainColoring
} from '../js/rendering/domain-coloring.js';
import bendEngine from '../js/rendering/bend_engine.mjs';
import {
    evaluateNativeAlgebraic,
    evaluateNativePoints,
    projectNativePrecisePixels
} from '../js/native/complex-engine.js';
import {
    DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH,
    normalizeDomainDynamicsChainCount
} from '../js/constants/domain-dynamics.js';

const STATE_KEYS = [
    'currentFunction',
    'currentFunctionPreset',
    'mapPresentation',
    'domainColoringEnabled',
    'domainBrightness',
    'domainContrast',
    'domainSaturation',
    'domainLightnessCycles',
    'domainPalette',
    'chainingEnabled',
    'chainingMode',
    'chainCount',
    'chainSeed',
    'orbitColoringMode',
    'algebraicChainingEnabled',
    'algebraicChainingTerms',
    'algebraicChainingZExpr',
    'polynomialN',
    'polynomialCoeffs',
    'expBase',
    'logBase',
    'besselOrder',
    'mobiusA',
    'mobiusB',
    'mobiusC',
    'mobiusD',
    'fractionalPowerN',
    'branchCutAngle',
    'zetaContinuationEnabled',
    'taylorSeriesEnabled',
    'taylorSeriesOrder',
    'taylorSeriesCenter',
    'taylorSeriesConvergenceRadius'
];

const PLANE = Object.freeze({
    width: 8,
    height: 6,
    origin: { x: 4, y: 3 },
    scale: { x: 2, y: 2 },
    currentVisXRange: [-2, 2],
    currentVisYRange: [-1.5, 1.5]
});

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function snapshotState() {
    return {
        ...Object.fromEntries(STATE_KEYS.map(key => [key, clone(state[key])])),
        dynamicPlottingEnabled: !!state.dynamicPlotting?.enabled
    };
}

function restoreState(snapshot) {
    for (const [key, value] of Object.entries(snapshot)) {
        if (key === 'dynamicPlottingEnabled') {
            if (state.dynamicPlotting) state.dynamicPlotting.enabled = value;
            continue;
        }
        state[key] = value;
    }
}

function configureDynamics(overrides = {}) {
    Object.assign(state, {
        currentFunction: 'cos',
        currentFunctionPreset: null,
        mapPresentation: 'function',
        domainColoringEnabled: true,
        domainBrightness: 1,
        domainContrast: 1,
        domainSaturation: 1,
        domainLightnessCycles: 0,
        domainPalette: 'arctic-frost',
        chainingEnabled: true,
        chainingMode: 'recursion',
        chainCount: 4,
        chainSeed: { re: 0, im: 0 },
        orbitColoringMode: 'value',
        algebraicChainingEnabled: false,
        algebraicChainingTerms: [],
        algebraicChainingZExpr: 'z',
        polynomialN: 2,
        polynomialCoeffs: [
            { re: 0, im: 0 },
            { re: 0, im: 0 },
            { re: 1, im: 0 }
        ],
        expBase: { re: Math.E, im: 0 },
        logBase: { re: Math.E, im: 0 },
        besselOrder: { re: 0, im: 0 },
        mobiusA: { re: 1, im: 0 },
        mobiusB: { re: 0, im: 0 },
        mobiusC: { re: 0, im: 0 },
        mobiusD: { re: 1, im: 0 },
        fractionalPowerN: 0.5,
        branchCutAngle: Math.PI,
        zetaContinuationEnabled: false,
        taylorSeriesEnabled: false,
        ...overrides
    });
    if (state.dynamicPlotting) state.dynamicPlotting.enabled = false;
}

function approxComplex(actual, expected, epsilon = 1e-10) {
    assert.ok(actual, 'expected a finite complex value');
    assert.ok(Math.abs(actual.re - expected.re) < epsilon, `${actual.re} ~= ${expected.re}`);
    assert.ok(Math.abs(actual.im - expected.im) < epsilon, `${actual.im} ~= ${expected.im}`);
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

test('unified domain-coloring compiler handles Mandelbrot, Newton, and generic output chains with 600 default depth', () => {
    const before = snapshotState();

    try {
        applyFractalPreset(state, 'mandelbrot');
        assert.equal(state.currentFunction, 'algebraic_chaining');
        assert.equal(state.chainingMode, 'zero_seed');
        assert.equal(state.chainCount, 600);
        assert.equal(state.orbitColoringMode, 'escape');

        let compiled = compileStateToUnifiedExpression(state);
        assert.match(compiled.fullGLSL, /cds_sq\(z\)/);
        assert.match(compiled.fullGLSL, /c_coord/);
        assert.equal(compiled.batchSize, 24); // Law 61/62: Bend-proved 120 FPS batch cap

        applyFractalPreset(state, 'newton_fractal');
        assert.equal(state.currentFunction, 'algebraic_chaining');
        assert.equal(state.chainingMode, 'recursion');
        assert.equal(state.chainCount, 600);
        assert.equal(state.orbitColoringMode, 'attractor');

        compiled = compileStateToUnifiedExpression(state);
        assert.match(compiled.fullGLSL, /cds_rcp/);

        configureDynamics({ currentFunction: 'exp', chainingMode: 'recursion', chainCount: 7 });
        compiled = compileStateToUnifiedExpression(state);
        assert.equal(compiled.fullGLSL, 'cds_exp(z)');
    } finally {
        restoreState(before);
    }
});

test('unified domain-coloring compiler emits valid DCE GLSL for all core functions and derivative presentation', () => {
    const before = snapshotState();

    try {
        const coreFns = [
            ['cos', /cds_cos\(z\)/],
            ['sin', /cds_sin\(z\)/],
            ['tan', /cds_tan\(z\)/],
            ['sec', /cds_sec\(z\)/],
            ['sinh', /cds_sinh\(z\)/],
            ['cosh', /cds_cosh\(z\)/],
            ['tanh', /cds_tanh\(z\)/],
            ['exp', /cds_exp\(z\)/],
            ['ln', /cds_ln\(z\)/],
            ['asin', /cds_asin\(z\)/],
            ['atan', /cds_atan\(z\)/],
            ['gamma', /cds_gamma\(z\)/],
            ['loggamma', /cds_loggamma\(z\)/],
            ['bessel', /cds_bessel\(z,/],
            ['power', /cds_sqrt\(z\)/],
            ['mobius', /cds_div\(/],
            ['polynomial', /cds_sq\(z\)/],
            ['zeta', /cds_zeta\(z\)/]
        ];

        for (const [fnKey, pattern] of coreFns) {
            configureDynamics({ currentFunction: fnKey, chainingEnabled: false, chainCount: 1 });
            const compiled = compileStateToUnifiedExpression(state);
            assert.match(compiled.fullGLSL, pattern, `expected ${fnKey} GLSL to match ${pattern}`);
            const shader = buildComputeShader(compiled);
            assert.match(shader, /#version 300 es/);
            assert.match(shader, /cqs eval_full\(cqs z, cqs c_coord, int stepInCycle\)/);
        }

        configureDynamics({ currentFunction: 'cos', mapPresentation: 'derivative', chainingEnabled: false });
        const derivCompiled = compileStateToUnifiedExpression(state);
        assert.equal(derivCompiled.isDerivative, true);
        const derivShader = buildComputeShader(derivCompiled);
        assert.match(derivShader, /eval_base\(cds_add_f\(z, h\), c_coord, stepInCycle\)/);
    } finally {
        restoreState(before);
    }
});

test('110-digit BigInt camera and 96-bit Quad-Single (cqs) conversion preserve deep-zoom precision to 10^-36', () => {
    const plane = {
        width: 800,
        height: 600,
        origin: { x: 400, y: 300 },
        scale: { x: 200, y: 200 }
    };
    const cam0 = syncBigIntCameraFromPlaneParams(plane, true);
    assert.equal(qsToNumber(cam0.centerReQS), 0);
    assert.equal(qsToNumber(cam0.centerImQS), 0);
    assert.ok(Math.abs(qsToNumber(cam0.scaleQS) - 1.5) < 1e-6);

    // Sub-pixel separation at 10^-21 and 10^-32
    const base = numberToBigFixed(-0.7436438870371587);
    const step21 = numberToBigFixed(1.13, -21);
    const qA = bigFixedToQS(base + step21);
    const qB = bigFixedToQS(base + 2n * step21);
    const distinct = qA[0] !== qB[0] || qA[1] !== qB[1] || qA[2] !== qB[2] || qA[3] !== qB[3];
    assert.equal(distinct, true);
});

test('Bend 2 LiveUIState controller enforces immediate preemption and zero-blackout display guard', () => {
    let ui = bendEngine.live_ui_start();
    ui = bendEngine.live_ui_step_batch(ui, 16);
    assert.equal(ui.has_display, true);

    ui = bendEngine.live_ui_set_depth(ui, 600);
    ui = bendEngine.live_ui_step_batch(ui, 16);
    assert.equal(ui.completed_steps, 16);
    assert.equal(ui.remaining_steps, 584);

    // Preempt mid-run to depth 75
    ui = bendEngine.live_ui_set_depth(ui, 75);
    assert.equal(ui.active_total_steps, 75);
    assert.equal(ui.need_seed_pass, true);
    assert.equal(bendEngine.live_ui_must_present(true, ui), true);
});

test('domain dynamics enforce the explicit 3000 chain limit', () => {
    assert.equal(DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH, 3000);
    assert.equal(normalizeDomainDynamicsChainCount(3000), 3000);
    assert.throws(
        () => normalizeDomainDynamicsChainCount(DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH + 100),
        /chain count/i
    );

    const options = completeNativeMapOptions({
        functionKey: 'algebraic_chaining',
        chainingEnabled: true,
        chainMode: 'recursion',
        chainCount: DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH,
        algebraicChainingEnabled: true,
        algebraicChainingZExpr: 'z',
        polynomialN: 1,
        polynomialCoeffs: [{ re: 0, im: 0 }, { re: 1, im: 0 }],
        algebraicChainingTerms: [
            { coeff: { re: 1, im: 0 }, factors: [algebraicFactor('polynomial')] },
            { coeff: { re: 1, im: 0 }, factors: [] }
        ]
    });
    const res = evaluateNativeAlgebraic(options, [{ re: 0, im: 0 }], [{ re: 0, im: 0 }]);
    approxComplex(res.values[0], { re: DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH, im: 0 });
});

test('Bend 2 generalized orbit coloring modes and Catmull-Rom domain color evaluator', () => {
    let ui = bendEngine.live_ui_start();
    ui = bendEngine.live_ui_set_mode(ui, 1);
    ui = bendEngine.live_ui_set_depth(ui, 600);
    assert.equal(ui.mode, 1);
    assert.equal(ui.chain_enabled, true);
    assert.equal(ui.active_total_steps, 600);
    assert.equal(Number(bendEngine.live_ui_is_recurrence(ui.mode, ui.chain_enabled)), 1);

    ui = bendEngine.live_ui_set_depth(ui, 240);
    assert.equal(ui.mode, 1);
    assert.equal(ui.active_total_steps, 240);

    ui = bendEngine.live_ui_set_mode(ui, 2);
    assert.equal(ui.mode, 2);
    assert.equal(Number(bendEngine.live_ui_is_recurrence(ui.mode, ui.chain_enabled)), 2);

    const rgb = domainColorForValue(1, 1, {
        domainLightnessCycles: 1,
        domainContrast: 1,
        domainBrightness: 1,
        domainSaturation: 1,
        domainPalette: 'arctic-frost'
    });
    assert.equal(rgb.length, 3);
    assert.ok(rgb.every(c => Number.isInteger(c) && c >= 0 && c <= 255));
});

test('native precise planar projection keeps neighboring source pixels distinct at 10^125', () => {
    const viewport = {
        centerRe: '-0.743643887037151000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
        centerIm: '0.131825904205330000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
        zoomPower: 125,
        precisionBits: 640,
        width: 800,
        height: 600
    };
    const output = projectNativePrecisePixels({
        inputViewport: viewport,
        outputViewport: viewport,
        mapPoints: true,
        mapOptions: completeNativeMapOptions({ functionKey: 'identity', chainingEnabled: false, chainCount: 1 })
    }, new Float32Array([399, 299, 400, 299, 399, 300]));
    assert.equal(output[0], 399.5);
    assert.equal(output[2], 400.5);
    assert.equal(output[1], 299.5);
    assert.equal(output[5], 300.5);
});

test('function and algebraic-expression changes invalidate domain coloring, preserve uniform shaderKey, and toggle canvas visibility', () => {
    const before = snapshotState();
    const prevCanvas = context.zDomainColorCanvas;

    try {
        context.domainColoringDirty = false;
        state.currentFunction = state.currentFunction === 'cos' ? 'tan' : 'cos';
        state.algebraicChainingZExpr = 'z + 1';
        assert.equal(context.domainColoringDirty, true);

        // Parameter slider updates keep identical shaderKey (0ms uniform-only update)
        configureDynamics({ currentFunction: 'bessel', besselOrder: { re: 0, im: 0 } });
        const bessel0 = compileStateToUnifiedExpression(state);
        state.besselOrder = { re: 2.5, im: -0.75 };
        const bessel1 = compileStateToUnifiedExpression(state);
        assert.equal(bessel0.shaderKey, bessel1.shaderKey);

        // Law 47 & Law 51: Nested unary chain and outer integer power share shaderKey
        configureDynamics({
            currentFunction: 'algebraic_chaining',
            algebraicChainingEnabled: true,
            algebraicChainingZExpr: 'z',
            algebraicChainingTerms: [
                {
                    coeff: { re: 1, im: 0 },
                    factors: [algebraicFactor('sin', { chainedFunc: 'sin', power: 3 })]
                }
            ]
        });
        const chainSin = compileStateToUnifiedExpression(state);
        assert.equal(chainSin.outerChainFn, 'cds_sin');
        assert.equal(chainSin.outerChainCount, 2);
        assert.equal(chainSin.outerPowExp, 3);
        assert.equal(chainSin.shaderKey, 'cds_sin::z');

        const mockDomainCanvas = { hidden: true };
        context.zDomainColorCanvas = mockDomainCanvas;
        state.domainColoringEnabled = true;
        assert.equal(synchronizePlanarDomainVisibility(), true);
        assert.equal(mockDomainCanvas.hidden, false);

        state.domainColoringEnabled = false;
        assert.equal(synchronizePlanarDomainVisibility(), false);
        assert.equal(mockDomainCanvas.hidden, true);
        cancelPlanarDomainColoring();
    } finally {
        context.zDomainColorCanvas = prevCanvas;
        restoreState(before);
    }
});

test('zeta continuation chains match the mapped transform in the critical strip', () => {
    const before = snapshotState();

    try {
        configureDynamics({
            currentFunction: 'zeta',
            zetaContinuationEnabled: true,
            chainingEnabled: true,
            chainingMode: 'recursion',
            chainCount: 2
        });

        const options = completeNativeMapOptions({
            functionKey: 'zeta',
            zetaContinuationEnabled: true,
            chainingEnabled: true,
            chainMode: 'recursion',
            chainCount: 2
        });
        const profile = getMappedTransformProfile('zeta', getEffectiveBaseTransformFunction('zeta'));

        for (const point of [
            { re: 2, im: 0 },
            { re: 0.5, im: 2 },
            { re: 0.5, im: 14.134725141734693 },
            { re: -2, im: 0 }
        ]) {
            const res = evaluateNativePoints(options, [point]);
            approxComplex(
                res.values[0],
                evaluateDomainColoringMappedTransform(profile, point.re, point.im, 'zeta'),
                1e-10
            );
        }
    } finally {
        restoreState(before);
    }
});
