import test from 'node:test';
import assert from 'node:assert/strict';

import {
    AbstractManifold,
    getManifold,
    getAllManifolds,
    DEFAULT_MANIFOLD_ID
} from '../js/rendering/manifold-registry.js';

test('all 10 mathematical manifolds are registered and available in the registry', () => {
    const manifolds = getAllManifolds();
    assert.equal(manifolds.length, 10);

    const expectedIds = [
        'sphere',
        'cylinder',
        'torus',
        'helicoid',
        'catenoid',
        'enneper',
        'bonnet',
        'klein_bottle',
        'pseudosphere',
        'scherk'
    ];

    expectedIds.forEach(id => {
        const manifold = getManifold(id);
        assert.ok(manifold instanceof AbstractManifold, `Manifold '${id}' should extend AbstractManifold`);
        assert.equal(manifold.id, id);
        assert.ok(manifold.name && manifold.name.length > 0);
        assert.ok(manifold.title && manifold.title.length > 0);
        assert.ok(manifold.formula && manifold.formula.length > 0);
        assert.ok(manifold.concept && manifold.concept.length > 0);
    });

    assert.equal(DEFAULT_MANIFOLD_ID, 'sphere');
    assert.equal(getManifold('non_existent_manifold').id, 'sphere');
});

test('manifold projection produces finite 3D coordinates across test points', () => {
    const manifolds = getAllManifolds();
    const testPoints = [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 0, v: 1 },
        { u: -2.5, v: 3.2 },
        { u: 10, v: -10 },
        { u: 0.001, v: -0.001 }
    ];

    manifolds.forEach(manifold => {
        testPoints.forEach(({ u, v }) => {
            const p3d = manifold.project(u, v);
            assert.ok(Number.isFinite(p3d.X), `${manifold.id}.project(${u}, ${v}).X must be finite, got ${p3d.X}`);
            assert.ok(Number.isFinite(p3d.Y), `${manifold.id}.project(${u}, ${v}).Y must be finite, got ${p3d.Y}`);
            assert.ok(Number.isFinite(p3d.Z), `${manifold.id}.project(${u}, ${v}).Z must be finite, got ${p3d.Z}`);
        });
    });
});

test('manifold morphing satisfies boundary conditions (t=0 flat plane and t=1 manifold embedding)', () => {
    const manifolds = getAllManifolds();
    const u = 3.0;
    const v = 4.0;

    manifolds.forEach(manifold => {
        // At t = 0: flat plane (u, 0, v)
        const p0 = manifold.morph(u, v, 0.0);
        assert.ok(Math.abs(p0.X - u) < 1e-4, `${manifold.id} at t=0 X should be ${u}, got ${p0.X}`);
        assert.ok(Math.abs(p0.Y - 0) < 1e-4, `${manifold.id} at t=0 Y should be 0, got ${p0.Y}`);
        assert.ok(Math.abs(p0.Z - v) < 1e-4, `${manifold.id} at t=0 Z should be ${v}, got ${p0.Z}`);

        // At t = 1: target manifold projection
        const p1 = manifold.morph(u, v, 1.0);
        const pTarget = manifold.project(u, v);
        assert.ok(Math.abs(p1.X - pTarget.X) < 1e-4, `${manifold.id} at t=1 X mismatch`);
        assert.ok(Math.abs(p1.Y - pTarget.Y) < 1e-4, `${manifold.id} at t=1 Y mismatch`);
        assert.ok(Math.abs(p1.Z - pTarget.Z) < 1e-4, `${manifold.id} at t=1 Z mismatch`);

        // Intermediate values t in (0, 1) are smooth and finite
        [0.25, 0.5, 0.75].forEach(t => {
            const pt = manifold.morph(u, v, t);
            assert.ok(Number.isFinite(pt.X), `${manifold.id} at t=${t} X must be finite`);
            assert.ok(Number.isFinite(pt.Y), `${manifold.id} at t=${t} Y must be finite`);
            assert.ok(Number.isFinite(pt.Z), `${manifold.id} at t=${t} Z must be finite`);
        });
    });
});

test('composite complex functions map smoothly into arbitrary 3D manifolds', () => {
    // Arbitrary composite function: w = sin(e^z + z^2)
    function evaluateComposite(x, y) {
        const expX = Math.exp(Math.max(-10, Math.min(10, x)));
        const ez_re = expX * Math.cos(y);
        const ez_im = expX * Math.sin(y);

        const z2_re = x * x - y * y;
        const z2_im = 2 * x * y;

        const a_re = ez_re + z2_re;
        const a_im = ez_im + z2_im;

        const clamped_im = Math.max(-5, Math.min(5, a_im));
        const u = Math.sin(a_re) * Math.cosh(clamped_im);
        const v = Math.cos(a_re) * Math.sinh(clamped_im);

        return { u, v };
    }

    const manifolds = getAllManifolds();
    const gridSamples = [
        { x: -1.0, y: -1.0 },
        { x: 0.0, y: 0.5 },
        { x: 1.2, y: -0.8 },
        { x: 2.0, y: 2.0 }
    ];

    manifolds.forEach(manifold => {
        gridSamples.forEach(({ x, y }) => {
            const { u, v } = evaluateComposite(x, y);
            const morphed = manifold.morph(u, v, 0.5);
            assert.ok(Number.isFinite(morphed.X));
            assert.ok(Number.isFinite(morphed.Y));
            assert.ok(Number.isFinite(morphed.Z));
        });
    });
});

test('domain sampling produces valid representative UV coordinates for mesh generation', () => {
    const manifolds = getAllManifolds();
    manifolds.forEach(manifold => {
        const p00 = manifold.getDomainPoint(0, 0);
        const p11 = manifold.getDomainPoint(1, 1);
        const pMid = manifold.getDomainPoint(0.5, 0.5);

        [p00, p11, pMid].forEach(p => {
            assert.ok(Number.isFinite(p.re), `${manifold.id} domain sample re must be finite`);
            assert.ok(Number.isFinite(p.im), `${manifold.id} domain sample im must be finite`);
        });
    });
});

test('raster media image/video grids morph smoothly into all 10 manifolds under complex maps', () => {
    const manifolds = getAllManifolds();
    const sourceWidth = 4.0;
    const sourceHeight = 3.0;
    const center = { re: 1.0, im: -0.5 };
    const resX = 16;
    const resY = 16;

    // Complex transform: f(z) = z^2 + 1
    const map = (x, y) => ({ u: x * x - y * y + 1, v: 2 * x * y });

    manifolds.forEach(manifold => {
        for (let j = 0; j <= resY; j++) {
            const vTex = j / resY;
            const y = center.im - sourceHeight / 2 + vTex * sourceHeight;
            for (let i = 0; i <= resX; i++) {
                const uTex = i / resX;
                const x = center.re - sourceWidth / 2 + uTex * sourceWidth;

                // Z plane source point
                const pZ0 = manifold.morph(x, y, 0.0);
                assert.ok(Math.abs(pZ0.X - x) < 1e-4);
                assert.ok(Math.abs(pZ0.Y - 0) < 1e-4);
                assert.ok(Math.abs(pZ0.Z - y) < 1e-4);

                const pZ1 = manifold.morph(x, y, 1.0);
                assert.ok(Number.isFinite(pZ1.X));
                assert.ok(Number.isFinite(pZ1.Y));
                assert.ok(Number.isFinite(pZ1.Z));

                // W plane transformed point
                const mapped = map(x, y);
                const pW0 = manifold.morph(mapped.u, mapped.v, 0.0);
                assert.ok(Math.abs(pW0.X - mapped.u) < 1e-4);
                assert.ok(Math.abs(pW0.Y - 0) < 1e-4);
                assert.ok(Math.abs(pW0.Z - mapped.v) < 1e-4);

                const pW1 = manifold.morph(mapped.u, mapped.v, 1.0);
                assert.ok(Number.isFinite(pW1.X));
                assert.ok(Number.isFinite(pW1.Y));
                assert.ok(Number.isFinite(pW1.Z));
            }
        }
    });
});
