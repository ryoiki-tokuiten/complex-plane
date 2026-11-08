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
    assert.equal(runtime.domainPalette, 'arctic-fox');
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

test('Arctic Fox is the default domain palette and Jewellery/Lava are replaced by Arctic Fox and Silent Colors', () => {
    assert.equal(state.domainPalette, 'arctic-fox');
    assert.equal(domainPalettes[0].id, 'arctic-fox');
    assert.equal(domainPalettes[0].name, 'Arctic Fox');
    assert.equal(domainPalettes[0].desc, 'Glacial cyan, polar slate, frost ivory, twilight amber');
    assert.deepEqual(domainPalettes[0].hexStops, [
        '#0D2430',
        '#1E6078',
        '#7AD1E6',
        '#F4F9FC',
        '#E66C4C',
        '#243E52'
    ]);
    assert.equal(domainPalettes[0].key.length, 6);

    const silent = domainPalettes.find(p => p.id === 'silent-colors');
    assert.ok(silent);
    assert.equal(silent.name, 'Silent Colors');
    assert.equal(silent.desc, 'Muted sage, warm stone, dusty clay, mist charcoal');
    assert.deepEqual(silent.hexStops, [
        '#26302B',
        '#5E7268',
        '#C6CEBE',
        '#F0ECE1',
        '#C87D65',
        '#3D4641'
    ]);
    assert.equal(silent.key.length, 6);

    assert.equal(domainPalettes.some(p => p.id === 'lava' || p.name === 'Lava'), false);
    assert.equal(domainPalettes.some(p => p.id === 'jewellery' || p.name === 'Jewellery' || p.name === 'Jwellery'), false);
    assert.equal(DOMAIN_PALETTE_IDS.lava, undefined);
    assert.equal(DOMAIN_PALETTE_IDS.jewellery, undefined);
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
