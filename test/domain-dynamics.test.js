import test from 'node:test';
import assert from 'node:assert/strict';

import { applyFractalPreset } from '../js/analysis/fractal-presets.js';
import { runtime } from '../js/store/runtime.js';
import { context, state } from '../js/store/state.js';
import {
    getEffectiveBaseTransformFunction,
    getMappedTransformProfile
} from '../js/native/map-runtime.js';
import { completeNativeMapOptions, evaluateDomainColoringMappedTransform } from './helpers/native-map.js';
import {
    buildPlanarDomainDynamicsSnapshot,
    cancelPlanarDomainDynamics,
    renderPlanarDomainDynamics,
    selectDomainDynamicsBackend
} from '../js/rendering/domain-dynamics.js';
import { renderPlanarDomainColoring } from '../js/rendering/domain-coloring.js';
import {
    createDomainDynamicsTileRenderer
} from '../js/native/domain-engine.js';
import {
    evaluateNativeAlgebraic,
    evaluateNativePoints,
    precisePixelCoordinate,
    projectNativePrecisePixels
} from '../js/native/complex-engine.js';
import { panPreciseViewport } from '../js/native/precise-viewport.js';
import {
    DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH,
    DOMAIN_COLOR_LOG_MAGNITUDE_MAX,
    DOMAIN_COLOR_LOG_MAGNITUDE_MIN,
    DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE,
    domainDynamicsLogMagnitude,
    domainDynamicsSmoothIteration,
    isFiniteDomainDynamicsValue,
    normalizeDomainColorLogMagnitude,
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
        currentFunction: 'cos',
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
        expBase: { re: Math.E, im: 0 },
        logBase: { re: Math.E, im: 0 },
        besselOrder: { re: 0, im: 0 },
        mobiusA: { re: 1, im: 0 },
        mobiusB: { re: 0, im: 0 },
        mobiusC: { re: 0, im: 0 },
        mobiusD: { re: 1, im: 0 },
        fractionalPowerN: 0.5,
        branchCutType: 'ray',
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

function evaluateDomainDynamicsValue(snapshot, re, im) {
    const point = { re, im };
    const result = snapshot.functionKey === 'algebraic_chaining'
        ? evaluateNativeAlgebraic(snapshot, [point], [point])
        : evaluateNativePoints(snapshot, [point]);
    return result.valid[0] ? result.values[0] : null;
}

function renderDomainDynamicsTile(snapshot, tile) {
    const renderer = createDomainDynamicsTileRenderer(snapshot);
    try {
        return renderer(tile);
    } finally {
        renderer.dispose();
    }
}

function colorDomainDynamicsPoint(snapshot, re, im) {
    const pointSnapshot = {
        ...snapshot,
        viewport: {
            width: 1,
            height: 1,
            xRange: [re - 0.5, re + 0.5],
            yRange: [im - 0.5, im + 0.5]
        }
    };
    const pixel = renderDomainDynamicsTile(pointSnapshot, {
        x: 0, y: 0, width: 1, height: 1, scale: 1
    });
    return [pixel[0], pixel[1], pixel[2]];
}

function makeFakeCanvasEnvironment(targetCtx) {
    const previousImageData = globalThis.ImageData;
    const previousWorker = globalThis.Worker;

    class FakeImageData {
        constructor(data, width, height) {
            this.data = data;
            this.width = width;
            this.height = height;
        }
    }

    class FakeWorker {
        constructor() {
            this.renderers = new Map();
            this._onmessage = null;
            this.onerror = null;
        }

        set onmessage(handler) {
            this._onmessage = handler;
            if (handler) {
                setTimeout(() => {
                    this._onmessage?.({ data: { type: 'ready' } });
                }, 0);
            }
        }

        get onmessage() {
            return this._onmessage;
        }

        postMessage(message) {
            if (message.type === 'start') {
                this.renderers.set(message.jobId, createDomainDynamicsTileRenderer(message.snapshot));
                return;
            }
            if (message.type === 'cancel') {
                this.renderers.delete(message.jobId);
                return;
            }
            if (message.type !== 'tile') return;
            setTimeout(() => {
                try {
                    const renderer = this.renderers.get(message.jobId);
                    if (!renderer) return;
                    const pixels = renderer(message.tile);
                    this.onmessage?.({ data: {
                        type: 'tile', jobId: message.jobId,
                        tile: message.tile, pixels, renderMilliseconds: 0
                    } });
                } catch (error) {
                    this.onmessage?.({ data: {
                        type: 'error', jobId: message.jobId,
                        tile: message.tile, message: error.message
                    } });
                }
            }, 0);
        }

        terminate() {
            this.renderers.clear();
        }
    }

    globalThis.ImageData = FakeImageData;
    globalThis.Worker = FakeWorker;

    return () => {
        globalThis.ImageData = previousImageData;
        globalThis.Worker = previousWorker;
    };
}

function makeTargetCtx() {
    const ownerDocument = {
        createElement(tagName) {
            assert.equal(tagName, 'canvas');
            const canvas = {
                width: 0,
                height: 0,
                getContext(type) {
                    assert.equal(type, '2d');
                    return {
                        puts: [],
                        putImageData(image, x, y) {
                            this.puts.push({ image, x, y });
                        }
                    };
                }
            };
            return canvas;
        }
    };
    const target = {
        draws: [],
        save() {},
        restore() {},
        setTransform() {},
        clearRect() {},
        drawImage(canvas, x, y) {
            this.draws.push({ canvas, x, y });
        }
    };
    target.canvas = { ownerDocument };
    return target;
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
        derivativeOrder: 0,
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
        expBase: { re: Math.E, im: 0 },
        logBase: { re: Math.E, im: 0 },
        besselOrder: { re: 0, im: 0 },
        mobiusA: { re: 1, im: 0 },
        mobiusB: { re: 0, im: 0 },
        mobiusC: { re: 0, im: 0 },
        mobiusD: { re: 1, im: 0 },
        fractionalPowerN: 0.5,
        branchCutType: 'ray',
        branchCutAngle: Math.PI,
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
        let snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE);
        assert.equal(snapshot.functionKey, 'algebraic_chaining');
        assert.equal(snapshot.chainMode, 'zero_seed');
        assert.equal(snapshot.chainCount, 256);
        assert.equal(snapshot.orbitColoringMode, 'escape');
        assert.equal(snapshot.paletteStops.length >= 2, true);

        applyFractalPreset(state, 'newton_fractal');
        snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE);
        assert.equal(snapshot.functionKey, 'algebraic_chaining');
        assert.equal(snapshot.chainMode, 'recursion');
        assert.equal(snapshot.orbitColoringMode, 'attractor');
        assert.equal(snapshot.algebraicChainingTerms.length, 2);

        configureDynamics({ currentFunction: 'exp', chainingMode: 'recursion', chainCount: 7 });
        snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE);
        assert.equal(snapshot.functionKey, 'exp');
        assert.equal(snapshot.chainMode, 'recursion');
        assert.equal(snapshot.chainCount, 7);
        assert.equal(snapshot.orbitColoringMode, 'value');
    } finally {
        restoreState(before);
    }
});

test('domain dynamics accepts single functions and derivative presentation without a GPU branch', () => {
    const before = snapshotState();

    try {
        configureDynamics({
            currentFunction: 'cos',
            chainingEnabled: false,
            chainCount: 1
        });

        const snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE, {
            mapPresentation: 'function'
        });
        assert.ok(snapshot);
        approxComplex(evaluateDomainDynamicsValue(snapshot, 0.5, 0.2), {
            re: Math.cos(0.5) * Math.cosh(0.2),
            im: -Math.sin(0.5) * Math.sinh(0.2)
        }, 1e-8);

        const derivativeSnapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE, {
            mapPresentation: 'derivative'
        });
        assert.ok(derivativeSnapshot);
        approxComplex(evaluateDomainDynamicsValue(derivativeSnapshot, 0.5, 0.2), {
            re: -Math.sin(0.5) * Math.cosh(0.2),
            im: -Math.cos(0.5) * Math.sinh(0.2)
        }, 1e-6);
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
        factors: [algebraicFactor('exp')]
    }];

    try {
        configureDynamics({
            currentFunction: 'algebraic_chaining',
            algebraicChainingEnabled: true,
            algebraicChainingZExpr: zExpr,
            algebraicChainingTerms: terms
        });

        const snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE);
        assert.ok(Object.isFrozen(snapshot));
        assert.ok(Object.isFrozen(snapshot.algebraicChainingZExpr.right));
        assert.ok(Object.isFrozen(snapshot.algebraicChainingTerms[0].coeff));
        assert.ok(Object.isFrozen(snapshot.algebraicChainingTerms[0].factors[0]));
        assert.notEqual(snapshot.algebraicChainingZExpr, zExpr);
        assert.notEqual(snapshot.algebraicChainingTerms[0].factors[0], terms[0].factors[0]);

        zExpr.right.value = 2;
        terms[0].coeff.re = 3;
        terms[0].factors[0].func = 'tan';
        assert.equal(snapshot.algebraicChainingZExpr.right.value, 1);
        assert.equal(snapshot.algebraicChainingTerms[0].coeff.re, 1);
        assert.equal(snapshot.algebraicChainingTerms[0].factors[0].func, 'exp');
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
    assert.throws(
        () => normalizeDomainDynamicsChainCount(DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH + 100),
        /chain count/i
    );

    const snapshot = makeAlgebraicDynamicsSnapshot({
        chainingEnabled: true,
        chainCount: DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH,
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

    assert.equal(isFiniteDomainDynamicsValue(DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE * 0.999, 0), true);
    assert.equal(isFiniteDomainDynamicsValue(DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE, 0), false);
    assert.equal(isFiniteDomainDynamicsValue(NaN, 0), false);

    const smooth = domainDynamicsSmoothIteration(3, 17, 20000, 0);
    assert.ok(smooth >= 0 && smooth <= 17);
    assert.equal(domainDynamicsSmoothIteration(3, 17, NaN, 0), 4);
    assert.equal(domainDynamicsSmoothIteration(3, 17, DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE, 0), 4);
});

test('precise viewport keeps neighboring pixels and center digits distinct at 10^125', () => {
    const viewport = {
        centerRe: '-0.743643887037151000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
        centerIm: '0.131825904205330000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
        zoomPower: 125,
        precisionBits: 512,
        width: 800,
        height: 600
    };
    const upperLeft = precisePixelCoordinate(viewport, 399, 299);
    const upperRight = precisePixelCoordinate(viewport, 400, 299);
    const lowerLeft = precisePixelCoordinate(viewport, 399, 300);

    assert.notEqual(upperLeft.re, upperRight.re);
    assert.notEqual(upperLeft.im, lowerLeft.im);
    assert.match(upperLeft.re, /7\.43643887037151/);
    assert.match(upperLeft.im, /1\.31825904205330/);
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

test('orbit coloring modes distinguish escape and attractor observables', () => {
    const before = snapshotState();

    try {
        applyFractalPreset(state, 'mandelbrot');
        let snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE);
        const interior = colorDomainDynamicsPoint(snapshot, 0, 0);
        const exterior = colorDomainDynamicsPoint(snapshot, 2, 2);
        assert.deepEqual(interior, [0, 0, 0]);
        assert.ok(exterior[0] + exterior[1] + exterior[2] > 0);

        applyFractalPreset(state, 'newton_fractal');
        snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE);
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
        configureDynamics({ currentFunction: 'cos', chainingMode: 'recursion', chainCount: 5 });
        const snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE);
        const base = getEffectiveBaseTransformFunction('cos');
        const profile = getMappedTransformProfile('cos', base);
        const expected = evaluateDomainColoringMappedTransform(profile, 0.2, -0.3, 'cos');
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
        const snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE);
        const pixels = renderDomainDynamicsTile(snapshot, { x: 0, y: 0, width: 2, height: 2, scale: 1 });

        assert.equal(pixels.length, 16);
        assert.deepEqual([pixels[3], pixels[7], pixels[11], pixels[15]], [255, 255, 255, 255]);
    } finally {
        restoreState(before);
    }
});

test('native domain coloring normalizes fixed magnitude bounds', () => {
    assert.equal(normalizeDomainColorLogMagnitude(DOMAIN_COLOR_LOG_MAGNITUDE_MIN), 0);
    assert.equal(normalizeDomainColorLogMagnitude(0), 0.5);
    assert.equal(normalizeDomainColorLogMagnitude(DOMAIN_COLOR_LOG_MAGNITUDE_MAX), 1);
    assert.equal(normalizeDomainColorLogMagnitude(-Infinity), 0);
    assert.equal(normalizeDomainColorLogMagnitude(Infinity), 1);
    assert.throws(() => normalizeDomainColorLogMagnitude(NaN), /log magnitude/i);
});

test('large cos viewports stay colored and algebraic identity wrappers keep the direct kernel', () => {
    const before = snapshotState();
    const plane = {
        width: 32,
        height: 24,
        currentVisXRange: [-500000, 500000],
        currentVisYRange: [-350000, 350000]
    };
    const tile = { x: 0, y: 0, width: plane.width, height: plane.height, scale: 1 };

    try {
        configureDynamics({
            currentFunction: 'cos',
            chainingEnabled: false,
            domainLightnessCycles: 1
        });
        const direct = renderDomainDynamicsTile(
            buildPlanarDomainDynamicsSnapshot(state, plane), tile
        );
        let blackPixels = 0;
        for (let index = 0; index < direct.length; index += 4) {
            if (direct[index] === 0 && direct[index + 1] === 0 && direct[index + 2] === 0) blackPixels += 1;
        }
        assert.equal(blackPixels, 0);

        Object.assign(state, {
            currentFunction: 'algebraic_chaining',
            algebraicChainingEnabled: true,
            algebraicChainingZExpr: 'z',
            algebraicChainingTerms: [
                { coeff: { re: 1, im: 0 }, factors: [algebraicFactor('cos')] }
            ]
        });
        const wrapped = renderDomainDynamicsTile(
            buildPlanarDomainDynamicsSnapshot(state, plane), tile
        );
        assert.deepEqual(wrapped, direct);
    } finally {
        restoreState(before);
    }
});

test('adaptive-quality rendering preserves the tile contract for sparse edges', () => {
    const snapshot = makeAlgebraicDynamicsSnapshot({
        viewport: {
            width: 64,
            height: 64,
            xRange: [-2, 2],
            yRange: [-2, 2]
        }
    });
    const renderTile = createDomainDynamicsTileRenderer(snapshot);
    const tile = { x: 0, y: 0, width: 64, height: 64, scale: 1 };
    const basePixels = renderTile(tile);
    const originalPixels = new Uint8ClampedArray(basePixels);
    const refined = renderTile({ ...tile, adaptiveQuality: true });

    assert.equal(refined.length, basePixels.length);
    for (let index = 3; index < refined.length; index += 4) {
        assert.equal(refined[index], 255);
    }
    assert.deepEqual(Array.from(basePixels), Array.from(originalPixels));
});

test('Mandelbrot refinement is identical across worker tile boundaries', () => {
    const before = snapshotState();

    try {
        applyFractalPreset(state, 'mandelbrot');
        const plane = {
            width: 128,
            height: 32,
            currentVisXRange: [-0.45, -0.25],
            currentVisYRange: [0.63, 0.655]
        };
        const snapshot = buildPlanarDomainDynamicsSnapshot(state, plane);
        const renderTile = createDomainDynamicsTileRenderer(snapshot);
        const refine = tile => {
            const basePixels = renderTile(tile);
            const originalPixels = new Uint8ClampedArray(basePixels);
            return {
                originalPixels,
                pixels: renderTile({ ...tile, adaptiveQuality: true })
            };
        };

        const whole = refine({ x: 0, y: 0, width: 128, height: 32, scale: 1 });
        const left = refine({ x: 0, y: 0, width: 64, height: 32, scale: 1 });
        const right = refine({ x: 64, y: 0, width: 64, height: 32, scale: 1 });
        assert.equal(whole.pixels.some((value, index) => value !== whole.originalPixels[index]), true);

        for (let y = 0; y < plane.height; y += 1) {
            for (let x = 62; x <= 65; x += 1) {
                const tiled = x < 64 ? left.pixels : right.pixels;
                const tiledX = x < 64 ? x : x - 64;
                const tiledIndex = (y * 64 + tiledX) * 4;
                const wholeIndex = (y * plane.width + x) * 4;
                assert.deepEqual(
                    Array.from(tiled.subarray(tiledIndex, tiledIndex + 4)),
                    Array.from(whole.pixels.subarray(wholeIndex, wholeIndex + 4))
                );
            }
        }
    } finally {
        restoreState(before);
    }
});

test('unknown algebraic functions fail instead of using an implicit identity', () => {
    const snapshot = makeAlgebraicDynamicsSnapshot({
        algebraicChainingTerms: [{
            coeff: { re: 1, im: 0 },
            factors: [algebraicFactor('not_registered')]
        }]
    });

    assert.throws(
        () => evaluateDomainDynamicsValue(snapshot, 0.25, -0.5),
        /Unsupported native algebraic function/
    );
});

test('invalid algebraic z expressions fail in domain dynamics', () => {
    const snapshot = makeAlgebraicDynamicsSnapshot({
        algebraicChainingZExpr: 'bad +',
        algebraicChainingTerms: [{ coeff: { re: 1, im: 0 }, factors: [algebraicFactor('c')] }]
    });

    assert.throws(() => evaluateDomainDynamicsValue(snapshot, 0.25, -0.5), /Expected a value/);
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
        const snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE);

        assert.equal(selectDomainDynamicsBackend(snapshot).id, 'worker-native');
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
        configureDynamics({ currentFunction: 'cos', chainCount: 2 });
        const snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE);

        assert.equal(renderPlanarDomainDynamics(targetCtx, PLANE, snapshot), true);
        await waitFor(() => targetCtx.draws.some(draw => draw.canvas.width === PLANE.width && draw.canvas.height === PLANE.height) &&
            selectDomainDynamicsBackend().queue.length === 0);
        assert.equal(targetCtx.draws.length, 1);
        assert.equal(selectDomainDynamicsBackend().queue.length, 0);
        assert.equal(selectDomainDynamicsBackend().queueIndex, 0);
        assert.equal(runtime.rendering.processingDomainDynamics, false);
    } finally {
        cancelPlanarDomainDynamics();
        restoreGlobals();
        restoreState(before);
    }
});

test('domain-coloring redraws reuse an active CPU job while dirty state is being drained', () => {
    const before = snapshotState();
    const previousDirty = context.domainColoringDirty;
    const targetCtx = makeTargetCtx();
    const restoreGlobals = makeFakeCanvasEnvironment(targetCtx);

    try {
        cancelPlanarDomainDynamics();
        configureDynamics({ currentFunction: 'cos', chainCount: 2 });
        const snapshot = buildPlanarDomainDynamicsSnapshot(state, PLANE);
        assert.ok(snapshot);

        context.domainColoringDirty = true;
        renderPlanarDomainColoring(targetCtx, PLANE);
        const firstJobId = selectDomainDynamicsBackend().activeJob?.id;

        renderPlanarDomainColoring(targetCtx, PLANE);
        assert.equal(selectDomainDynamicsBackend().activeJob?.id, firstJobId);
    } finally {
        cancelPlanarDomainDynamics();
        restoreGlobals();
        context.domainColoringDirty = previousDirty;
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
        configureDynamics({ currentFunction: 'cos', chainCount: 2 });
        const oldSnapshot = buildPlanarDomainDynamicsSnapshot(state, oldPlane);
        const nextSnapshot = buildPlanarDomainDynamicsSnapshot(state, nextPlane);

        assert.equal(renderPlanarDomainDynamics(targetCtx, oldPlane, oldSnapshot), true);
        assert.equal(renderPlanarDomainDynamics(targetCtx, nextPlane, nextSnapshot), true);

        await waitFor(() => targetCtx.draws.some(draw => draw.canvas.width === nextPlane.width && draw.canvas.height === nextPlane.height));
        assert.equal(targetCtx.draws.some(draw => draw.canvas.width === oldPlane.width), false);
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

        const snapshot = buildPlanarDomainDynamicsSnapshot(state, deepPlane);

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
        { coeff: { re: 0.25, im: 0.1 }, factors: [algebraicFactor('cos')] },
        { coeff: { re: 0.08, im: -0.04 }, factors: [algebraicFactor('c')] },
        { coeff: { re: 0.05, im: 0 }, factors: [algebraicFactor('sinh', { reciprocal: true })] }
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

            const snapshot = buildPlanarDomainDynamicsSnapshot(state, plane);
            const profile = getMappedTransformProfile(
                'algebraic_chaining',
                getEffectiveBaseTransformFunction('algebraic_chaining')
            );

            for (const point of points) {
                const nativeValue = evaluateDomainDynamicsValue(snapshot, point.re, point.im);
                const mappedValue = evaluateDomainColoringMappedTransform(
                    profile, point.re, point.im, 'algebraic_chaining'
                );
                if (mode === 'zero_seed') {
                    assert.equal(nativeValue, null);
                    assert.equal(Number.isFinite(mappedValue.re) || Number.isFinite(mappedValue.im), false);
                } else {
                    approxComplex(nativeValue, mappedValue, 1e-10);
                }
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

        const snapshot = buildPlanarDomainDynamicsSnapshot(state, plane);
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

test('deep domain snapshots render from exact centers and preserve digits while panning', () => {
    const before = snapshotState();
    const plane = {
        width: 4,
        height: 4,
        currentVisXRange: [-1, 1],
        currentVisYRange: [-1, 1],
        preciseViewport: {
            centerRe: '-0.7436438870371510000000000000000000000001',
            centerIm: '0.1318259042053300000000000000000000000001',
            zoomPower: 125,
            precisionBits: 512,
            width: 4,
            height: 4
        }
    };

    try {
        applyFractalPreset(state, 'mandelbrot');
        state.chainCount = 64;
        const snapshot = buildPlanarDomainDynamicsSnapshot(state, plane);
        assert.equal(snapshot.viewport.centerRe, plane.preciseViewport.centerRe);
        assert.equal(Object.hasOwn(snapshot.viewport, 'xRange'), false);
        const renderTile = createDomainDynamicsTileRenderer(snapshot);
        try {
            const pixels = renderTile({ x: 0, y: 0, width: plane.width, height: plane.height, scale: 1 });
            assert.equal(pixels.length, 64);
            assert.equal(pixels.every((value, index) => index % 4 !== 3 || value === 255), true);
            assert.equal(renderTile.lastStats.precise, true);
            assert.ok(Number.isInteger(renderTile.lastStats.perturbationRepairs));
        } finally {
            renderTile.dispose();
        }

        const oldCenter = plane.preciseViewport.centerRe;
        panPreciseViewport(plane, 1, 0);
        assert.notEqual(plane.preciseViewport.centerRe, oldCenter);
        assert.match(plane.preciseViewport.centerRe, /7\.43643887037151/);
    } finally {
        restoreState(before);
    }
});
