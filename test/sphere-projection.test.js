import test from 'node:test';
import assert from 'node:assert/strict';

import {
    complexToSphere,
    rotate3D
} from '../js/utils/canvas-utils.js';

function approx(actual, expected, epsilon = 1e-12) {
    assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ~= ${expected}`);
}

test('Riemann sphere rotations preserve unit-sphere radius', () => {
    const sphere = complexToSphere(0.75, -1.25);
    const rotated = rotate3D(sphere, -0.8, 0.35);

    approx(Math.hypot(rotated.x, rotated.y, rotated.z), 1, 1e-12);
});
