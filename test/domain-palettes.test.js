import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DOMAIN_PALETTE_IDS,
    createDomainPaletteGlslSource,
    domainPalettes
} from '../js/constants/domain-palettes.js';

test('Newton Deep palette is registered across UI and shader paths', () => {
    assert.ok(domainPalettes.some(palette => palette.id === 'three-b1b-newton-deep'));
    assert.deepEqual(
        domainPalettes.filter(palette => palette.name.includes('Newton')).map(palette => palette.id),
        ['three-b1b-newton-deep']
    );
    assert.equal(DOMAIN_PALETTE_IDS['three-b1b-newton-deep'], 21);
    assert.match(createDomainPaletteGlslSource('surfacePaletteColor'), /paletteId == 21/);
});
