import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getImageRenderChainIndex,
    shouldUseInverseImagePath
} from '../js/rendering/draw-image-webgl.js';
import { buildNativeImageMesh } from '../js/native/complex-engine.js';

function rasterSnapshot(overrides = {}) {
    return {
        currentFunction: 'cos',
        chainingMode: 'recursion',
        polynomialN: 2,
        navigationModeEnabled: false,
        ...overrides
    };
}

function nativeMesh({ mapOptions, bounds, sourceCenter, sourceSize, ...options } = {}) {
    const x0 = bounds?.x0 ?? -1;
    const x1 = bounds?.x1 ?? 1;
    const y0 = bounds?.y0 ?? -1;
    const y1 = bounds?.y1 ?? 1;
    return buildNativeImageMesh({
        mapOptions: { functionKey: 'identity', chainingEnabled: false, ...mapOptions },
        bounds: { x0, x1, y0, y1 },
        sourceCenter: sourceCenter || { re: 0, im: 0 },
        sourceSize: sourceSize || { width: 2, height: 2 },
        baseResolution: 4,
        maxDepth: 4,
        maxCells: 8192,
        maxVertices: 32768,
        maxSamples: 65536,
        pixelWidth: 1024,
        pixelHeight: 1024,
        ...options
    });
}

function assertConformingSourceEdges(mesh) {
    const points = [];
    for (let offset = 0; offset < mesh.vertices.length; offset += 2) {
        points.push([mesh.vertices[offset], mesh.vertices[offset + 1]]);
    }
    const onInteriorAxisEdge = (a, b, point) => {
        const epsilon = 1e-7;
        if (Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[0] - point[0]) <= epsilon) {
            return point[1] > Math.min(a[1], b[1]) + epsilon && point[1] < Math.max(a[1], b[1]) - epsilon;
        }
        if (Math.abs(a[1] - b[1]) <= epsilon && Math.abs(a[1] - point[1]) <= epsilon) {
            return point[0] > Math.min(a[0], b[0]) + epsilon && point[0] < Math.max(a[0], b[0]) - epsilon;
        }
        return false;
    };
    for (let offset = 0; offset < mesh.indices.length; offset += 3) {
        const triangle = [mesh.indices[offset], mesh.indices[offset + 1], mesh.indices[offset + 2]];
        for (let edge = 0; edge < 3; edge += 1) {
            const a = points[triangle[edge]];
            const b = points[triangle[(edge + 1) % 3]];
            if (Math.abs(a[0] - b[0]) > 1e-7 && Math.abs(a[1] - b[1]) > 1e-7) continue;
            assert.equal(points.some((point, index) => !triangle.includes(index) &&
                onInteriorAxisEdge(a, b, point)), false, 'native mesh contains a hanging source-edge vertex');
        }
    }
}

test('collapsed raster output uses the resolved map stage instead of display panel index', () => {
    assert.equal(getImageRenderChainIndex(0, { stage: 29 }), 29);
    assert.equal(getImageRenderChainIndex(4, { stage: 7 }), 7);
    assert.equal(getImageRenderChainIndex(4, null), 4);
});

test('only supported invertible ordinary maps use the inverse GPU path', () => {
    const snapshot = rasterSnapshot();
    assert.equal(shouldUseInverseImagePath(true, snapshot, 0), false);
    assert.equal(shouldUseInverseImagePath(true, { ...snapshot, currentFunction: 'exp' }, 0), true);
    assert.equal(shouldUseInverseImagePath(true, snapshot, 16), false);
    assert.equal(shouldUseInverseImagePath(false, snapshot, 100), true);
});

test('native adaptive image mesh omits cells surrounding invalid poles', () => {
    const mesh = nativeMesh({ mapOptions: { functionKey: 'power', fractionalPower: -1 } });
    assert.ok(mesh.indices.length > 0);
    assert.ok(mesh.indices.every(index => index < mesh.vertices.length / 2));
    assert.ok(mesh.mappedPositions.every(Number.isFinite));
    assert.ok(mesh.cellCount < 4 * 4 * 4 ** 4);
});

test('native adaptive image mesh keeps deep linear patches within work budgets', () => {
    const mesh = nativeMesh({
        bounds: { x0: -3e-11, x1: 3e-11, y0: -3e-11, y1: 3e-11 },
        sourceSize: { width: 6e-11, height: 6e-11 },
        baseResolution: 16,
        maxDepth: 5,
        maxCells: 1024
    });
    assert.ok(mesh.cellCount > 0);
    assert.ok(mesh.sampleCount <= 1024 * 9);
    assert.ok(mesh.vertices.length / 2 <= 1024 * 4);
});

test('native adaptive image mesh evaluates deep source coordinates with MPFR', () => {
    const span = 7e-125;
    const mesh = nativeMesh({
        sourceSize: { width: span, height: span },
        preciseViewport: {
            centerRe: '0',
            centerIm: '0',
            zoomPower: 125,
            precisionBits: 512,
            width: 1024,
            height: 1024
        }
    });
    assert.ok(mesh.indices.length > 0);
    assert.ok(mesh.mappedPositions.every(Number.isFinite));
    const mappedX = new Set();
    for (let offset = 0; offset < mesh.mappedPositions.length; offset += 2) {
        mappedX.add(mesh.mappedPositions[offset]);
    }
    assert.ok(mappedX.size > 4, 'deep mapped vertices collapsed onto the precise center');
    assert.ok(mesh.sampleCount <= 65536);
});

test('native adaptive image mesh retains smooth exponential coverage', () => {
    const mesh = nativeMesh({
        mapOptions: { functionKey: 'exp' },
        bounds: { x0: -301, x1: 301, y0: -301, y1: 301 },
        sourceSize: { width: 11.4, height: 11.4 },
        baseResolution: 8,
        maxDepth: 5
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

test('native adaptive image mesh stitches refinement boundaries', () => {
    const mesh = nativeMesh({
        mapOptions: { functionKey: 'exp' },
        bounds: { x0: -6.5, x1: 6.5, y0: -6.5, y1: 6.5 },
        sourceSize: { width: 13, height: 13 },
        baseResolution: 8,
        maxDepth: 5
    });
    assertConformingSourceEdges(mesh);
});

test('native adaptive image mesh honors explicit cell, sample, and vertex budgets', () => {
    const mesh = nativeMesh({ baseResolution: 8, maxCells: 4, maxSamples: 9, maxVertices: 4 });
    assert.ok(mesh.cellCount <= 4);
    assert.ok(mesh.sampleCount <= 9);
    assert.ok(mesh.vertices.length / 2 <= 4);
});

test('native adaptive image mesh scales deterministically with render resolution', () => {
    const common = {
        mapOptions: { functionKey: 'exp' },
        bounds: { x0: -4, x1: 4, y0: -4, y1: 4 },
        sourceSize: { width: 8, height: 8 },
        baseResolution: 16,
        maxDepth: 5
    };
    const small = nativeMesh({ ...common, pixelWidth: 320, pixelHeight: 320 });
    const large = nativeMesh({ ...common, pixelWidth: 1280, pixelHeight: 1280 });
    const repeat = nativeMesh({ ...common, pixelWidth: 1280, pixelHeight: 1280 });
    assert.ok(large.cellCount > small.cellCount);
    assert.deepEqual(Array.from(repeat.vertices), Array.from(large.vertices));
    assert.deepEqual(Array.from(repeat.indices), Array.from(large.indices));
});
