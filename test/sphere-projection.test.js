import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildNativeSphereLines,
    buildNativeSphereProbe,
    projectNativeSpherePoints
} from '../js/native/complex-engine.js';

const sphere = Object.freeze({ centerX: 320, centerY: 240, radius: 180, rotX: 0, rotY: 0 });

test('native Riemann projection preserves pole visibility and unit-disk placement', () => {
    const projected = projectNativeSpherePoints({ sphere, mapPoints: false }, [
        { re: 0, im: 0 },
        { re: 1, im: 0 },
        { re: 1e200, im: -1e200 }
    ]);
    assert.deepEqual(Array.from(projected.visible), [0, 1, 1]);
    assert.equal(projected.positions[0], 320);
    assert.equal(projected.positions[1], 240);
    assert.ok(Number.isFinite(projected.positions[4]));
    assert.ok(Number.isFinite(projected.positions[5]));
    assert.ok(Math.hypot(projected.positions[4] - 320, projected.positions[5] - 240) <= 180.001);
});

test('native sphere lines refine and clip at the visible limb', () => {
    const [tokens] = buildNativeSphereLines({ sphere, mapPoints: false }, [[
        { re: 0, im: 0 },
        { re: 0.5, im: 0 },
        { re: 2, im: 0 },
        { re: 10, im: 0 }
    ]]);
    assert.ok(tokens.length >= 6);
    assert.ok(Array.from(tokens).some(Number.isNaN));
    for (let offset = 0; offset < tokens.length; offset += 3) {
        if (Number.isNaN(tokens[offset])) continue;
        assert.ok(Number.isFinite(tokens[offset]));
        assert.ok(Number.isFinite(tokens[offset + 1]));
        assert.ok(tokens[offset + 2] >= 0);
    }
});

test('native probe job returns the marker, neighborhood, and both crosshairs', () => {
    const probe = buildNativeSphereProbe({
        sphere,
        source: { re: 2, im: 0.25 },
        neighborhoodSize: 0.2,
        crosshairFactor: 2.5,
        mapPoints: false
    });
    assert.equal(probe.center.visible, true);
    assert.equal(probe.lines.length, 3);
    assert.ok(probe.lines.every(line => line.length >= 6));
});
