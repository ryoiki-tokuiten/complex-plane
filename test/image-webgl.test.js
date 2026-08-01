import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildAdaptiveImageMesh,
    getImageRenderChainIndex,
    shouldUseInverseImagePath
} from '../js/rendering/draw-image-webgl.js';

function rasterSnapshot(overrides = {}) {
    return {
        currentFunction: 'sin',
        chainingMode: 'recursion',
        polynomialN: 2,
        navigationModeEnabled: false,
        ...overrides
    };
}

function assertConformingSourceEdges(mesh) {
    const points = [];
    for (let offset = 0; offset < mesh.vertices.length; offset += 2) {
        points.push([mesh.vertices[offset], mesh.vertices[offset + 1]]);
    }

    const onInteriorAxisEdge = (a, b, point) => {
        const epsilon = 1e-7;
        if (Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[0] - point[0]) <= epsilon) {
            return point[1] > Math.min(a[1], b[1]) + epsilon &&
                point[1] < Math.max(a[1], b[1]) - epsilon;
        }
        if (Math.abs(a[1] - b[1]) <= epsilon && Math.abs(a[1] - point[1]) <= epsilon) {
            return point[0] > Math.min(a[0], b[0]) + epsilon &&
                point[0] < Math.max(a[0], b[0]) - epsilon;
        }
        return false;
    };

    for (let offset = 0; offset < mesh.indices.length; offset += 3) {
        const triangle = [mesh.indices[offset], mesh.indices[offset + 1], mesh.indices[offset + 2]];
        for (let edge = 0; edge < 3; edge += 1) {
            const a = points[triangle[edge]];
            const b = points[triangle[(edge + 1) % 3]];
            if (Math.abs(a[0] - b[0]) > 1e-7 && Math.abs(a[1] - b[1]) > 1e-7) continue;
            assert.equal(
                points.some((point, index) => !triangle.includes(index) && onInteriorAxisEdge(a, b, point)),
                false,
                'adaptive mesh contains a hanging source-edge vertex'
            );
        }
    }
}

test('collapsed raster output uses the resolved map stage instead of display panel index', () => {
    assert.equal(getImageRenderChainIndex(0, { stage: 29 }), 29);
    assert.equal(getImageRenderChainIndex(4, { stage: 7 }), 7);
    assert.equal(getImageRenderChainIndex(4, null), 4);
});

test('non-injective raster maps stay on the forward mesh path', () => {
    const snapshot = rasterSnapshot();

    assert.equal(shouldUseInverseImagePath(true, snapshot, 0), false);
    assert.equal(shouldUseInverseImagePath(true, { ...snapshot, currentFunction: 'reciprocal' }, 0), true);
    assert.equal(shouldUseInverseImagePath(true, snapshot, 16), false);
    assert.equal(shouldUseInverseImagePath(false, snapshot, 100), true);
});

test('adaptive image meshes omit invalid discontinuity cells', () => {
    const mesh = buildAdaptiveImageMesh({
        bounds: { x0: -1, x1: 1, y0: -1, y1: 1, xSpan: 2, ySpan: 2 },
        baseResolution: 4,
        maxDepth: 4,
        sample(u, v) {
            if (Math.hypot(u - 0.5, v - 0.5) < 0.08) return { re: NaN, im: NaN };
            return { re: u * 2 - 1, im: v * 2 - 1 };
        }
    });

    assert.ok(mesh.indices.length > 0);
    assert.ok(mesh.cellCount < 4 * 4 * 4);
    assert.ok(mesh.indices.every(index => index < mesh.vertices.length / 2));
    assert.ok(mesh.mappedPositions.every(Number.isFinite));
});

test('adaptive image meshes keep deep-zoom linear patches within the work budget', () => {
    const mesh = buildAdaptiveImageMesh({
        bounds: { x0: -3e-11, x1: 3e-11, y0: -3e-11, y1: 3e-11, xSpan: 6e-11, ySpan: 6e-11 },
        baseResolution: 16,
        maxDepth: 5,
        maxCells: 1024,
        sample: (u, v) => ({ re: u * 6 - 3, im: v * 6 - 3 })
    });

    assert.ok(mesh.cellCount > 0);
    assert.ok(mesh.sampleCount <= 1024 * 9);
    assert.ok(mesh.vertices.length / 2 <= 1024 * 4);
});

test('adaptive image meshes retain smooth exponential coverage', () => {
    const sourceSize = 11.4;
    const mesh = buildAdaptiveImageMesh({
        bounds: { x0: -301, x1: 301, y0: -301, y1: 301, xSpan: 602, ySpan: 602 },
        baseResolution: 8,
        maxDepth: 5,
        maxCells: 8192,
        sample: (u, v) => {
            const x = (u * 2 - 1) * sourceSize * 0.5;
            const y = (v * 2 - 1) * sourceSize * 0.5;
            const magnitude = Math.exp(x);
            return { re: magnitude * Math.cos(y), im: magnitude * Math.sin(y) };
        }
    });

    let coveredSourceArea = 0;
    for (let offset = 0; offset < mesh.indices.length; offset += 3) {
        const a = mesh.indices[offset] * 2;
        const b = mesh.indices[offset + 1] * 2;
        const c = mesh.indices[offset + 2] * 2;
        coveredSourceArea += Math.abs(
            (mesh.vertices[b] - mesh.vertices[a]) * (mesh.vertices[c + 1] - mesh.vertices[a + 1]) -
            (mesh.vertices[b + 1] - mesh.vertices[a + 1]) * (mesh.vertices[c] - mesh.vertices[a])
        ) * 0.5;
    }

    assert.ok(coveredSourceArea > 0.99, `smooth exponential coverage was ${coveredSourceArea}`);
});

test('adaptive image meshes stitch smooth refinement boundaries', () => {
    const mesh = buildAdaptiveImageMesh({
        bounds: { x0: -6.5, x1: 6.5, y0: -6.5, y1: 6.5, xSpan: 13, ySpan: 13 },
        baseResolution: 8,
        maxDepth: 5,
        maxCells: 8192,
        sample: (u, v) => {
            const x = (u * 2 - 1) * 6.5;
            const y = (v * 2 - 1) * 6.5;
            const magnitude = Math.exp(x);
            return { re: magnitude * Math.cos(y), im: magnitude * Math.sin(y) };
        }
    });

    assertConformingSourceEdges(mesh);
});

test('adaptive image meshes do not bridge finite jump discontinuities', () => {
    const mesh = buildAdaptiveImageMesh({
        bounds: { x0: -2, x1: 2, y0: -2, y1: 2, xSpan: 4, ySpan: 4 },
        baseResolution: 4,
        maxDepth: 4,
        sample: (u, v) => ({ re: u < 0.53 ? -0.2 : 0.2, im: v * 2 - 1 })
    });

    assert.ok(mesh.indices.length > 0);
    for (let offset = 0; offset < mesh.indices.length; offset += 3) {
        const a = mesh.mappedPositions[mesh.indices[offset] * 2];
        const b = mesh.mappedPositions[mesh.indices[offset + 1] * 2];
        const c = mesh.mappedPositions[mesh.indices[offset + 2] * 2];
        assert.equal(Math.min(a, b, c) < 0 && Math.max(a, b, c) > 0, false);
    }
});
