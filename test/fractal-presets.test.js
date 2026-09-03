import test from 'node:test';
import assert from 'node:assert/strict';

import { applyFractalPreset } from '../js/analysis/fractal-presets.js';
import { state } from '../js/store/state.js';
import {
    getEffectiveBaseTransformFunction,
    getMappedTransformProfile
} from '../js/native/map-runtime.js';
import {
    evaluateAlgebraicChaining,
    evaluateDomainColoringMappedTransform
} from './helpers/native-map.js';
import {
    DOMAIN_PALETTE_IDS,
    createDomainPaletteGlslSource,
    domainPalettes
} from '../js/constants/domain-palettes.js';

function snapshotState(keys) {
    return Object.fromEntries(keys.map(key => [key, state[key]]));
}

function restoreState(snapshot) {
    Object.assign(state, snapshot);
}

test('Mandelbrot preset is zero-seed algebraic output chaining', () => {
    const runtime = {};
    const preset = applyFractalPreset(runtime, 'mandelbrot');

    assert.equal(preset.label, 'Mandelbrot');
    assert.equal(runtime.currentFunction, 'algebraic_chaining');
    assert.equal(runtime.chainingMode, 'zero_seed');
    assert.equal(runtime.orbitColoringMode, 'escape');
    assert.equal(runtime.currentInputShape, 'empty_grid');
    assert.equal(runtime.domainPalette, 'arctic-frost');
    assert.equal(runtime.polynomialN, 2);
    assert.deepEqual(runtime.polynomialCoeffs, [
        { re: 0, im: 0 },
        { re: 0, im: 0 },
        { re: 1, im: 0 }
    ]);
    assert.deepEqual(
        runtime.algebraicChainingTerms.map(term => term.factors.map(factor => factor.func)),
        [['polynomial'], ['c']]
    );
});

test('Newton preset represents Newton iteration for z^3 - 1 through algebraic chaining', () => {
    const keys = [
        'currentFunction',
        'currentFunctionPreset',
        'algebraicChainingEnabled',
        'algebraicChainingTerms',
        'polynomialN',
        'polynomialCoeffs',
        'chainingEnabled',
        'chainingMode',
        'chainCount',
        'orbitColoringMode',
        'domainColoringEnabled',
        'currentInputShape',
        'domainPalette'
    ];
    const before = snapshotState(keys);

    try {
        applyFractalPreset(state, 'newton_fractal');

        assert.equal(state.currentFunction, 'algebraic_chaining');
        assert.equal(state.chainingMode, 'recursion');
        assert.equal(state.orbitColoringMode, 'attractor');
        assert.equal(state.currentInputShape, 'empty_grid');
        assert.equal(state.domainPalette, 'three-b1b-newton-deep');
        assert.equal(DOMAIN_PALETTE_IDS[state.domainPalette], 21);
        assert.deepEqual(
            domainPalettes.filter(palette => palette.name.includes('Newton')).map(palette => palette.id),
            [state.domainPalette]
        );
        assert.match(createDomainPaletteGlslSource('surfacePaletteColor'), /paletteId == 21/);
        assert.equal(state.polynomialN, 1);
        assert.deepEqual(state.polynomialCoeffs, [
            { re: 0, im: 0 },
            { re: 1, im: 0 }
        ]);

        const once = evaluateAlgebraicChaining({ re: 2, im: 0 }, undefined, { c: { re: 2, im: 0 } });
        assert.ok(Math.abs(once.re - 17 / 12) < 1e-12);
        assert.equal(once.im, 0);

        const base = getEffectiveBaseTransformFunction('algebraic_chaining');
        const profile = getMappedTransformProfile('algebraic_chaining', base);
        const converged = evaluateDomainColoringMappedTransform(profile, 2, 0, 'algebraic_chaining');

        assert.ok(Math.abs(converged.re - 1) < 1e-9);
        assert.ok(Math.abs(converged.im) < 1e-9);
    } finally {
        restoreState(before);
    }
});
