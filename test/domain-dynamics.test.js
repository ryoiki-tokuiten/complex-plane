import test from 'node:test';
import assert from 'node:assert/strict';

import { applyFractalPreset } from '../js/analysis/fractal-presets.js';
import { state } from '../js/store/state.js';
import {
    evaluateDomainColoringMappedTransform,
    getEffectiveBaseTransformFunction,
    getMappedTransformProfile
} from '../js/math-utils.js';
import {
    buildPlanarDomainDynamicsSnapshot,
    cancelPlanarDomainDynamics,
    renderPlanarDomainDynamics,
    selectDomainDynamicsBackend
} from '../js/rendering/domain-dynamics.js';
import {
    colorDomainDynamicsPoint,
    evaluateDomainDynamicsValue,
    renderDomainDynamicsTile
} from '../js/rendering/domain-dynamics-core.js';
import {
    DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH,
    domainDynamicsLogMagnitude,
    domainDynamicsSmoothIteration,
    isFiniteDomainDynamicsValue,
    normalizeDomainDynamicsChainCount
} from '../js/constants/domain-dynamics.js';

const STATE_KEYS = [
    'currentFunction',
    'currentFunctionPreset',
    'domainColoringEnabled',
    'domainBrightness',
    'domainContrast',
    'domainSaturation',
    'domainLightnessCycles',
    'domainPalette',
    'chainingEnabled',
    'chainingMode',
    'chainCount',
    'orbitColoringMode',
    'algebraicChainingEnabled',
    'algebraicChainingTerms',
    'algebraicChainingZExpr',
    'polynomialN',
    'polynomialCoeffs',
    'mobiusA',
    'mobiusB',
    'mobiusC',
    'mobiusD',
    'fractionalPowerN',
    'zetaContinuationEnabled',
    'taylorSeriesEnabled'
];

const PLANE = Object.freeze({
    width: 8,
    height: 6,
    currentVisXRange: [-2, 1],
    currentVisYRange: [-1, 1]
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
        currentFunction: 'sin',
        currentFunctionPreset: null,
        domainColoringEnabled: true,
        domainBrightness: 1,
        domainContrast: 1,
        domainSaturation: 1,
        domainLightnessCycles: 0,
        domainPalette: 'arctic-frost',
        chainingEnabled: true,
        chainingMode: 'recursion',
        chainCount: 4,
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
        mobiusA: { re: 1, im: 0 },
        mobiusB: { re: 0, im: 0 },
        mobiusC: { re: 0, im: 0 },
        mobiusD: { re: 1, im: 0 },
        fractionalPowerN: 0.5,
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

function makeFakeCanvasEnvironment(targetCtx) {
    const previousDocument = globalThis.document;
    const previousImageData = globalThis.ImageData;
    const previousWorker = globalThis.Worker;

    class FakeImageData {
        constructor(data, width, height) {
            this.data = data;
            this.width = width;
            this.height = height;
        }
    }

    function makeContext(canvas) {
        return {
            canvas,
            puts: [],
            imageSmoothingEnabled: false,
            imageSmoothingQuality: 'low',
            save() {},
            restore() {},
            setTransform() {},
            clearRect() {},
            putImageData(image, x, y) {
                this.puts.push({ image, x, y });
            },
            drawImage(source) {
                targetCtx.draws.push({ width: source.width, height: source.height });
            }
        };
    }

    globalThis.ImageData = FakeImageData;
    globalThis.Worker = undefined;
    globalThis.document = {
        createElement(type) {
            assert.equal(type, 'canvas');
            const canvas = {
                width: 0,
                height: 0,
                getContext(kind) {
                    assert.equal(kind, '2d');
                    if (!this.ctx) this.ctx = makeContext(this);
                    return this.ctx;
                }
            };
            return canvas;
        }
    };

    return () => {
        globalThis.document = previousDocument;
        globalThis.ImageData = previousImageData;
        globalThis.Worker = previousWorker;
    };
}

function makeTargetCtx() {
    return {
        draws: [],
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        save() {},
        restore() {},
        setTransform() {},
        clearRect() {},
        drawImage(source) {
            this.draws.push({ width: source.width, height: source.height });
        }
    };
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

function iterateQuadraticZeroSeed(c, count, bailout = 1e8) {
    let z = { re: 0, im: 0 };

    for (let index = 0; index < count; index += 1) {
        z = {
            re: z.re * z.re - z.im * z.im + c.re,
            im: 2 * z.re * z.im + c.im
        };

        if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) break;
        if (Math.max(Math.abs(z.re), Math.abs(z.im)) >= bailout) break;
    }

    return z;
}

function makeAlgebraicDynamicsSnapshot(overrides = {}) {
    return {
        functionKey: 'algebraic_chaining',
        chainingEnabled: false,
        chainMode: 'recursion',
        chainCount: 1,
        orbitColoringMode: 'value',
        algebraicChainingEnabled: true,
        algebraicChainingZExpr: 'z',
        algebraicChainingTerms: [],
        polynomialN: 1,
        polynomialCoeffs: [
            { re: 0, im: 0 },
            { re: 1, im: 0 }
        ],
        mobiusA: { re: 1, im: 0 },
        mobiusB: { re: 0, im: 0 },
        mobiusC: { re: 0, im: 0 },
        mobiusD: { re: 1, im: 0 },
        fractionalPowerN: 0.5,
        zetaContinuationEnabled: false,
        style: {
            brightness: 1,
            contrast: 1,
            saturation: 1,
            lightnessCycles: 0
        },
        paletteStops: [[0, 0, 0], [1, 1, 1]],
        viewport: {
            width: 4,
            height: 4,
            xRange: [-2, 2],
            yRange: [-2, 2]
        },
        ...overrides
    };
}

async function waitFor(predicate, timeoutMs = 1000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('timed out waiting for async domain dynamics render');
}

test('dynamics snapshots represent Mandelbrot, Newton, and generic output chains', () => {
    const before = snapshotState();

    try {
        applyFractalPreset(state, 'mandelbrot');
        let snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE, { isWPlaneColoring: false });
        assert.equal(snapshot.functionKey, 'algebraic_chaining');
        assert.equal(snapshot.chainMode, 'zero_seed');
        assert.equal(snapshot.chainCount, 256);
        assert.equal(snapshot.orbitColoringMode, 'escape');
        assert.equal(snapshot.paletteStops.length >= 2, true);

        applyFractalPreset(state, 'newton_fractal');
        snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE, { isWPlaneColoring: false });
        assert.equal(snapshot.functionKey, 'algebraic_chaining');
        assert.equal(snapshot.chainMode, 'recursion');
        assert.equal(snapshot.orbitColoringMode, 'attractor');
        assert.equal(snapshot.algebraicChainingTerms.length, 2);

        configureDynamics({ currentFunction: 'exp', chainingMode: 'recursion', chainCount: 7 });
        snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE, { isWPlaneColoring: false });
        assert.equal(snapshot.functionKey, 'exp');
        assert.equal(snapshot.chainMode, 'recursion');
        assert.equal(snapshot.chainCount, 7);
        assert.equal(snapshot.orbitColoringMode, 'value');
    } finally {
        restoreState(before);
    }
});

test('built dynamics snapshots isolate and freeze nested algebraic data', () => {
    const before = snapshotState();
    const zExpr = {
        op: '+',
        left: 'z',
        right: { type: 'number', value: 1 }
    };
    const terms = [{
        coeff: { re: 1, im: 0 },
        factors: [algebraicFactor('sin', { pipeline: [{ func: 'cos' }] })]
    }];

    try {
        configureDynamics({
            currentFunction: 'algebraic_chaining',
            algebraicChainingEnabled: true,
            algebraicChainingZExpr: zExpr,
            algebraicChainingTerms: terms
        });

        const snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE, { isWPlaneColoring: false });
        assert.ok(Object.isFrozen(snapshot));
        assert.ok(Object.isFrozen(snapshot.algebraicChainingZExpr.right));
        assert.ok(Object.isFrozen(snapshot.algebraicChainingTerms[0].factors[0].pipeline[0]));
        assert.notEqual(snapshot.algebraicChainingZExpr, zExpr);
        assert.notEqual(snapshot.algebraicChainingTerms[0].factors[0], terms[0].factors[0]);

        zExpr.right.value = 2;
        terms[0].factors[0].pipeline[0].func = 'sin';
        assert.equal(snapshot.algebraicChainingZExpr.right.value, 1);
        assert.equal(snapshot.algebraicChainingTerms[0].factors[0].pipeline[0].func, 'cos');
    } finally {
        restoreState(before);
    }
});

test('mutable algebraic AST edits never reuse a stale accelerator', () => {
    const makeSnapshot = offset => makeAlgebraicDynamicsSnapshot({
        algebraicChainingZExpr: {
            op: '+',
            left: 'z',
            right: { type: 'number', value: offset }
        },
        algebraicChainingTerms: [{
            coeff: { re: 1, im: 0 },
            factors: [algebraicFactor('polynomial')]
        }]
    });
    const snapshot = makeSnapshot(1);
    const otherSnapshot = makeSnapshot(10);
    Object.freeze(snapshot);

    approxComplex(evaluateDomainDynamicsValue(snapshot, 2, 0), { re: 3, im: 0 });
    evaluateDomainDynamicsValue(otherSnapshot, 2, 0);
    snapshot.algebraicChainingZExpr.right.value = 2;
    approxComplex(evaluateDomainDynamicsValue(snapshot, 2, 0), { re: 4, im: 0 });
});

test('accelerated algebraic z expressions preserve parser unary-power precedence', () => {
    const base = {
        algebraicChainingTerms: [{
            coeff: { re: 1, im: 0 },
            factors: [algebraicFactor('polynomial')]
        }]
    };
    const negatedPower = makeAlgebraicDynamicsSnapshot({ ...base, algebraicChainingZExpr: '-z^2' });
    const parenthesizedNegation = makeAlgebraicDynamicsSnapshot({ ...base, algebraicChainingZExpr: '(-z)^2' });

    approxComplex(evaluateDomainDynamicsValue(negatedPower, 2, 0), { re: -4, im: 0 });
    approxComplex(evaluateDomainDynamicsValue(parenthesizedNegation, 2, 0), { re: 4, im: 0 });

    const nestedPower = makeAlgebraicDynamicsSnapshot({ ...base, algebraicChainingZExpr: 'z^2^3' });
    const groupedPower = makeAlgebraicDynamicsSnapshot({ ...base, algebraicChainingZExpr: '(z^2)^3' });
    approxComplex(evaluateDomainDynamicsValue(nestedPower, 2, 0), { re: 256, im: 0 });
    approxComplex(evaluateDomainDynamicsValue(groupedPower, 2, 0), { re: 64, im: 0 });
});

test('domain dynamics enforce the explicit chain limit', () => {
    assert.equal(normalizeDomainDynamicsChainCount(DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH + 100), DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH);

    const snapshot = makeAlgebraicDynamicsSnapshot({
        chainingEnabled: true,
        chainCount: DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH + 100,
        algebraicChainingTerms: [
            { coeff: { re: 1, im: 0 }, factors: [algebraicFactor('polynomial')] },
            { coeff: { re: 1, im: 0 }, factors: [] }
        ]
    });
    approxComplex(evaluateDomainDynamicsValue(snapshot, 0, 0), { re: DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH, im: 0 });
});

test('domain dynamics shared helpers cover boundary, overflow, and smoothing fixtures', () => {
    const fixtures = [
        { re: 1e4, im: 0 },
        { re: 10001, im: 0 },
        { re: 1e8, im: 0 },
        { re: 1e30, im: 0 },
        { re: 3, im: 4 }
    ];

    for (const fixture of fixtures) {
        assert.equal(
            domainDynamicsLogMagnitude(fixture.re, fixture.im),
            Math.log1p(Math.hypot(fixture.re, fixture.im))
        );
    }

    assert.equal(isFiniteDomainDynamicsValue(1e30 * 0.999, 0), true);
    assert.equal(isFiniteDomainDynamicsValue(1e30, 0), false);
    assert.equal(isFiniteDomainDynamicsValue(NaN, 0), false);

    const smooth = domainDynamicsSmoothIteration(3, 17, 20000, 0);
    assert.ok(smooth >= 0 && smooth <= 17);
    assert.equal(domainDynamicsSmoothIteration(3, 17, NaN, 0), 4);
    assert.equal(domainDynamicsSmoothIteration(3, 17, 1e30, 0), 4);
});

test('orbit coloring modes distinguish escape and attractor observables', () => {
    const before = snapshotState();

    try {
        applyFractalPreset(state, 'mandelbrot');
        let snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE, { isWPlaneColoring: false });
        const interior = colorDomainDynamicsPoint(snapshot, 0, 0);
        const exterior = colorDomainDynamicsPoint(snapshot, 2, 2);
        assert.deepEqual(interior, [0, 0, 0]);
        assert.ok(exterior[0] + exterior[1] + exterior[2] > 0);

        applyFractalPreset(state, 'newton_fractal');
        snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE, { isWPlaneColoring: false });
        const convergedValue = evaluateDomainDynamicsValue(snapshot, 2, 0);
        const basinColor = colorDomainDynamicsPoint(snapshot, 2, 0);
        approxComplex(convergedValue, { re: 1, im: 0 }, 1e-9);
        assert.ok(basinColor[0] + basinColor[1] + basinColor[2] > 0);
    } finally {
        restoreState(before);
    }
});

test('worker dynamics evaluator matches current mapped output-chain semantics', () => {
    const before = snapshotState();

    try {
        configureDynamics({ currentFunction: 'sin', chainingMode: 'recursion', chainCount: 5 });
        const snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE, { isWPlaneColoring: false });
        const base = getEffectiveBaseTransformFunction('sin');
        const profile = getMappedTransformProfile('sin', base);
        const expected = evaluateDomainColoringMappedTransform(profile, 0.2, -0.3, 'sin');
        const actual = evaluateDomainDynamicsValue(snapshot, 0.2, -0.3);

        approxComplex(actual, expected);
    } finally {
        restoreState(before);
    }
});

test('domain dynamics tile rendering produces opaque full tile data', () => {
    const before = snapshotState();

    try {
        configureDynamics({ currentFunction: 'cos', chainCount: 3 });
        const snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE, { isWPlaneColoring: false });
        const pixels = renderDomainDynamicsTile(snapshot, { x: 0, y: 0, width: 2, height: 2, scale: 1 });

        assert.equal(pixels.length, 16);
        assert.deepEqual([pixels[3], pixels[7], pixels[11], pixels[15]], [255, 255, 255, 255]);
    } finally {
        restoreState(before);
    }
});

test('unknown algebraic functions are invalid instead of implicit identity', () => {
    const snapshot = makeAlgebraicDynamicsSnapshot({
        algebraicChainingTerms: [{
            coeff: { re: 1, im: 0 },
            factors: [algebraicFactor('not_registered')]
        }]
    });

    assert.equal(evaluateDomainDynamicsValue(snapshot, 0.25, -0.5), null);
});

test('invalid algebraic z expressions are invalid in domain dynamics', () => {
    const snapshot = makeAlgebraicDynamicsSnapshot({
        algebraicChainingZExpr: 'bad +',
        algebraicChainingTerms: [{ coeff: { re: 1, im: 0 }, factors: [algebraicFactor('c')] }]
    });

    assert.equal(evaluateDomainDynamicsValue(snapshot, 0.25, -0.5), null);
});

test('generic polynomial-parameter orbit rendering defines pixel indices', () => {
    const snapshot = makeAlgebraicDynamicsSnapshot({
        chainingEnabled: true,
        chainMode: 'zero_seed',
        chainCount: 2,
        orbitColoringMode: 'escape',
        polynomialN: 3,
        polynomialCoeffs: [
            { re: 0, im: 0 },
            { re: 0, im: 0 },
            { re: 0, im: 0 },
            { re: 1, im: 0 }
        ],
        algebraicChainingTerms: [
            { coeff: { re: 1, im: 0 }, factors: [algebraicFactor('polynomial')] },
            { coeff: { re: 1, im: 0 }, factors: [algebraicFactor('c')] }
        ]
    });

    const pixels = renderDomainDynamicsTile(snapshot, { x: 0, y: 0, width: 1, height: 1, scale: 1 });
    assert.equal(pixels.length, 4);
});

test('backend selection uses the worker dynamics backend', () => {
    const before = snapshotState();

    try {
        configureDynamics();
        const snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE, { isWPlaneColoring: false });

        assert.equal(selectDomainDynamicsBackend(snapshot).id, 'worker-cpu');
    } finally {
        restoreState(before);
    }
});

test('async renderer reaches final scale one without another redraw trigger', async () => {
    const before = snapshotState();
    const targetCtx = makeTargetCtx();
    const restoreGlobals = makeFakeCanvasEnvironment(targetCtx);

    try {
        cancelPlanarDomainDynamics();
        configureDynamics({ currentFunction: 'sin', chainCount: 2 });
        const snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE, { isWPlaneColoring: false });

        assert.equal(renderPlanarDomainDynamics(targetCtx, PLANE, snapshot), true);
        await waitFor(() => targetCtx.draws.some(draw => draw.width === PLANE.width && draw.height === PLANE.height));
        assert.ok(targetCtx.draws.length <= 3);
        assert.equal(selectDomainDynamicsBackend().queue.length, 0);
        assert.equal(selectDomainDynamicsBackend().queueIndex, 0);
    } finally {
        cancelPlanarDomainDynamics();
        restoreGlobals();
        restoreState(before);
    }
});

test('async renderer ignores canceled old final tiles after viewport changes', async () => {
    const before = snapshotState();
    const targetCtx = makeTargetCtx();
    const restoreGlobals = makeFakeCanvasEnvironment(targetCtx);
    const oldPlane = { ...PLANE, width: 7 };
    const nextPlane = { ...PLANE, width: 11 };

    try {
        cancelPlanarDomainDynamics();
        configureDynamics({ currentFunction: 'sin', chainCount: 2 });
        const oldSnapshot = buildPlanarDomainDynamicsSnapshot(state, oldPlane, { isWPlaneColoring: false });
        const nextSnapshot = buildPlanarDomainDynamicsSnapshot(state, nextPlane, { isWPlaneColoring: false });

        assert.equal(renderPlanarDomainDynamics(targetCtx, oldPlane, oldSnapshot), true);
        assert.equal(renderPlanarDomainDynamics(targetCtx, nextPlane, nextSnapshot), true);

        await waitFor(() => targetCtx.draws.some(draw => draw.width === nextPlane.width && draw.height === nextPlane.height));
        assert.equal(targetCtx.draws.some(draw => draw.width === oldPlane.width), false);
    } finally {
        cancelPlanarDomainDynamics();
        restoreGlobals();
        restoreState(before);
    }
});

test('deep Mandelbrot zero-seed dynamics match an independent orbit recurrence', () => {
    const deepPlane = {
        width: 64,
        height: 64,
        currentVisXRange: [-0.745, -0.742],
        currentVisYRange: [0.130, 0.133]
    };
    const before = snapshotState();

    try {
        applyFractalPreset(state, 'mandelbrot');
        state.chainCount = 1000;

        const snapshot = buildPlanarDomainDynamicsSnapshot(state, deepPlane, { isWPlaneColoring: false });

        for (const c of [
            { re: 0, im: 0 },
            { re: 2, im: 2 },
            { re: -0.743643887037151, im: 0.13182590420533 },
            { re: -0.75, im: 0.1 }
        ]) {
            approxComplex(
                evaluateDomainDynamicsValue(snapshot, c.re, c.im),
                iterateQuadraticZeroSeed(c, snapshot.chainCount)
            );
        }
    } finally {
        restoreState(before);
    }
});

test('worker algebraic output chains match the main domain-coloring pipeline across modes', () => {
    const before = snapshotState();
    const plane = {
        width: 9,
        height: 7,
        currentVisXRange: [-1, 1],
        currentVisYRange: [-1, 1]
    };
    const algebraicTerms = [
        { coeff: { re: 0.7, im: -0.2 }, factors: [algebraicFactor('polynomial')] },
        { coeff: { re: 0.25, im: 0.1 }, factors: [algebraicFactor('sin')] },
        { coeff: { re: 0.08, im: -0.04 }, factors: [algebraicFactor('c')] },
        { coeff: { re: 0.05, im: 0 }, factors: [algebraicFactor('cosh', { reciprocal: true })] }
    ];
    const points = [
        { re: -0.4, im: 0.2 },
        { re: 0.35, im: -0.45 },
        { re: 0.05, im: 0.6 }
    ];

    try {
        for (const mode of ['recursion', 'zero_seed']) {
            configureDynamics({
                currentFunction: 'algebraic_chaining',
                algebraicChainingEnabled: true,
                algebraicChainingZExpr: 'z',
                algebraicChainingTerms: algebraicTerms,
                polynomialN: 2,
                polynomialCoeffs: [
                    { re: 0.1, im: -0.05 },
                    { re: 0.4, im: 0.15 },
                    { re: -0.2, im: 0.05 }
                ],
                chainingEnabled: true,
                chainingMode: mode,
                chainCount: 4
            });

            const snapshot = buildPlanarDomainDynamicsSnapshot(state, plane, { isWPlaneColoring: false });
            const profile = getMappedTransformProfile(
                'algebraic_chaining',
                getEffectiveBaseTransformFunction('algebraic_chaining')
            );

            for (const point of points) {
                approxComplex(
                    evaluateDomainDynamicsValue(snapshot, point.re, point.im),
                    evaluateDomainColoringMappedTransform(profile, point.re, point.im, 'algebraic_chaining'),
                    1e-10
                );
            }
        }
    } finally {
        restoreState(before);
    }
});

test('worker zeta continuation chains match the main mapped transform in the critical strip', () => {
    const before = snapshotState();
    const plane = {
        width: 8,
        height: 8,
        currentVisXRange: [-3, 3],
        currentVisYRange: [-15, 15]
    };

    try {
        configureDynamics({
            currentFunction: 'zeta',
            zetaContinuationEnabled: true,
            chainingEnabled: true,
            chainingMode: 'recursion',
            chainCount: 2
        });

        const snapshot = buildPlanarDomainDynamicsSnapshot(state, plane, { isWPlaneColoring: false });
        const profile = getMappedTransformProfile('zeta', getEffectiveBaseTransformFunction('zeta'));

        for (const point of [
            { re: 2, im: 0 },
            { re: 0.5, im: 2 },
            { re: 0.5, im: 14.134725141734693 },
            { re: -2, im: 0 }
        ]) {
            approxComplex(
                evaluateDomainDynamicsValue(snapshot, point.re, point.im),
                evaluateDomainColoringMappedTransform(profile, point.re, point.im, 'zeta'),
                1e-10
            );
        }
    } finally {
        restoreState(before);
    }
});

test('collapsed sub-ulp viewport ranges render deterministically uniform tiles', () => {
    const before = snapshotState();
    const center = { re: 0.3, im: -0.2 };
    const delta = 1e-50;
    const plane = {
        width: 8,
        height: 8,
        currentVisXRange: [center.re, center.re + delta],
        currentVisYRange: [center.im, center.im + delta]
    };

    try {
        configureDynamics({
            currentFunction: 'exp',
            chainingEnabled: true,
            chainingMode: 'recursion',
            chainCount: 2
        });

        assert.equal(plane.currentVisXRange[0], plane.currentVisXRange[1]);
        assert.equal(plane.currentVisYRange[0], plane.currentVisYRange[1]);

        const snapshot = buildPlanarDomainDynamicsSnapshot(state, plane, { isWPlaneColoring: false });
        const pixels = renderDomainDynamicsTile(snapshot, { x: 0, y: 0, width: plane.width, height: plane.height, scale: 1 });
        const firstPixel = Array.from(pixels.slice(0, 4));

        for (let offset = 0; offset < pixels.length; offset += 4) {
            assert.deepEqual(Array.from(pixels.slice(offset, offset + 4)), firstPixel);
        }
    } finally {
        restoreState(before);
    }
});
