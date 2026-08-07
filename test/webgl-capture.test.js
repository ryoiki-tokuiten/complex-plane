import test from 'node:test';
import assert from 'node:assert/strict';

import { drawComplexLineSetOnPlane } from '../js/rendering/draw-planar.js';
import { PolylineCaptureContext } from '../js/rendering/webgl-planar.js';
import {
    DOMAIN_PALETTE_IDS,
    createDomainPaletteGlslSource,
    domainPalettes
} from '../js/constants/domain-palettes.js';

test('Polyline capture stays active when Path2D is available', () => {
    const previousPath2D = globalThis.Path2D;

    globalThis.Path2D = class {
        moveTo() {}
        lineTo() {}
    };

    try {
        const ctx = new PolylineCaptureContext();
        const planeParams = {
            width: 320,
            height: 240,
            origin: { x: 160, y: 120 },
            scale: { x: 20, y: 20 }
        };
        const points = Array.from({ length: 72 }, (_, index) => ({
            re: index / 10,
            im: Math.sin(index / 10)
        }));

        drawComplexLineSetOnPlane(ctx, planeParams, points);

        assert.equal(ctx.isCaptureSupported(), true);
        assert.ok(ctx.getBatches().length > 0);
    } finally {
        if (previousPath2D === undefined) {
            delete globalThis.Path2D;
        } else {
            globalThis.Path2D = previousPath2D;
        }
    }
});

test('Polyline capture preserves stroke and strokeRect validation categories', () => {
    const cases = [
        ['setLineDash', ctx => ctx.setLineDash([2, 2])],
        ['globalCompositeOperation', ctx => { ctx.globalCompositeOperation = 'multiply'; }],
        ['strokeState', ctx => { ctx.lineWidth = 0; }],
        ['strokeStyle', ctx => { ctx.strokeStyle = {}; }],
        ['lineCap', ctx => { ctx.lineCap = 'invalid'; }],
        ['lineJoin', ctx => { ctx.lineJoin = 'invalid'; }],
        ['miterLimit', ctx => { ctx.miterLimit = 0; }]
    ];

    for (const [expected, configure] of cases) {
        const ctx = new PolylineCaptureContext();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(1, 1);
        configure(ctx);
        ctx.stroke();
        assert.deepEqual([...ctx._unsupportedOperations], [expected]);
    }

    const rect = new PolylineCaptureContext();
    rect.setLineDash([2, 2]);
    rect.lineCap = 'invalid';
    rect.strokeRect(0, 0, 10, 10);
    assert.deepEqual([...rect._unsupportedOperations], ['strokeRectStyle']);
});

test('Newton Deep palette is registered across UI and shader paths', () => {
    assert.ok(domainPalettes.some(palette => palette.id === 'three-b1b-newton-deep'));
    assert.deepEqual(
        domainPalettes.filter(palette => palette.name.includes('Newton')).map(palette => palette.id),
        ['three-b1b-newton-deep']
    );
    assert.equal(DOMAIN_PALETTE_IDS['three-b1b-newton-deep'], 21);

    const generatedPaletteSource = createDomainPaletteGlslSource('surfacePaletteColor');
    assert.match(generatedPaletteSource, /paletteId == 21/);
});
