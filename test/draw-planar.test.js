import test from 'node:test';
import assert from 'node:assert/strict';

import {
    drawPointSetCollectionOnPlane,
    drawPlanarTransformedLine,
    getPointSetEndpoints
} from '../js/rendering/draw-planar.js';
import { getMappedTransformProfile, transformFunctions } from '../js/native/map-runtime.js';
import { buildNativePlanarPolyline, nativeMapOptions } from '../js/native/complex-engine.js';
import { state, zPlaneParams } from '../js/store/state.js';

const IDENTITY_MAP = Object.freeze({
    stage: 0,
    presentation: 'function',
    evaluate: transformFunctions.identity
});

class TestPath2D {
    constructor() { this.commands = []; }
    moveTo(x, y) { this.commands.push(['M', x, y]); }
    lineTo(x, y) { this.commands.push(['L', x, y]); }
}

if (typeof globalThis.Path2D !== 'function') globalThis.Path2D = TestPath2D;

class LineCaptureContext {
    constructor() {
        this.paths = [];
        this.currentPath = [];
    }
    save() {}
    restore() {}
    beginPath() { this.currentPath = []; }
    moveTo(x, y) { this.currentPath.push(x, y); }
    lineTo(x, y) { this.currentPath.push(x, y); }
    stroke(path) {
        this.paths.push(path
            ? path.commands.flatMap(([_operation, x, y]) => [x, y])
            : this.currentPath.slice());
    }
    translate() {}
    setLineDash() {}
}

test('point-set endpoints reflect interior point mutations', () => {
    const replacementStart = { re: 3, im: 4 };
    const replacementEnd = { re: 5, im: 6 };
    const pointSet = {
        points: [
            null,
            { re: 1, im: 0 },
            { re: 2, im: 0 },
            null
        ]
    };

    const initial = getPointSetEndpoints(pointSet);
    assert.equal(initial.start.re, 1);
    assert.equal(initial.end.re, 2);

    pointSet.points[1] = replacementStart;
    pointSet.points[2] = replacementEnd;

    const updated = getPointSetEndpoints(pointSet);
    assert.equal(updated.start, replacementStart);
    assert.equal(updated.end, replacementEnd);
});

const PRECISE_VIEWPORT = Object.freeze({
    centerRe: '0', centerIm: '0', zoomPower: 0, precisionBits: 128
});

for (const source of ['ordinary', 'precise']) {
    for (const destination of ['ordinary', 'precise']) {
        test(`drawPointSetCollectionOnPlane supports ${source} source x ${destination} destination`, () => {
            const previousPrecise = zPlaneParams.preciseViewport;
            zPlaneParams.preciseViewport = source === 'precise' ? PRECISE_VIEWPORT : null;
            const planeParams = {
                width: 200,
                height: 160,
                origin: { x: 100, y: 80 },
                scale: { x: 20, y: 20 },
                currentVisXRange: [-5, 5],
                currentVisYRange: [-4, 4],
                ...(destination === 'precise' && { preciseViewport: PRECISE_VIEWPORT })
            };
            const pointSet = {
                role: 'grid-horizontal',
                color: '#fff',
                lineWidth: 1,
                points: [{ re: -1, im: 0 }, { re: 1, im: 0 }],
                ...(source === 'precise' && { canvasPoints: new Float32Array([80, 80, 120, 80]) })
            };

            try {
                const capture = new LineCaptureContext();
                drawPointSetCollectionOnPlane(capture, planeParams, [pointSet], {
                    transformFunc: transformFunctions.identity,
                    transformProfile: getMappedTransformProfile('identity', transformFunctions.identity),
                    map: IDENTITY_MAP
                });
                assert.ok(capture.paths.length > 0);
            } finally {
                zPlaneParams.preciseViewport = previousPrecise;
            }
        });
    }
}


test('transformed polylines require Path2D and preserve disconnected subpaths', () => {
    const previousPath2D = globalThis.Path2D;

    class NativeContext {
        constructor() { this.commands = []; }
        beginPath() { this.commands = []; }
        moveTo(x, y) { this.commands.push(['M', x, y]); }
        lineTo(x, y) { this.commands.push(['L', x, y]); }
        stroke(path) { if (path) this.commands = path.commands.slice(); }
    }

    const planeParams = {
        width: 200,
        height: 160,
        origin: { x: 100, y: 80 },
        scale: { x: 20, y: 20 },
        currentVisXRange: [-5, 5],
        currentVisYRange: [-4, 4]
    };
    const profile = {
        functionKey: 'identity',
        transformFunc: (re, im) => ({ re, im }),
        isConstant: false,
        constantValue: null
    };
    const points = [
        { re: -0.5, im: 0 }, { re: 0, im: 0 }, null,
        { re: 0.25, im: 0.25 }, { re: 0.5, im: 0.25 }
    ];

    try {
        globalThis.Path2D = TestPath2D;

        const native = new NativeContext();
        drawPlanarTransformedLine(native, planeParams, profile, points, '#fff');

        assert.equal(native.commands.filter(command => command[0] === 'M').length, 2);
        delete globalThis.Path2D;
        assert.throws(
            () => drawPlanarTransformedLine(new NativeContext(), planeParams, profile, points, '#fff'),
            /requires Path2D/
        );
    } finally {
        if (previousPath2D === undefined) delete globalThis.Path2D;
        else globalThis.Path2D = previousPath2D;
    }
});

test('transformed grid sampling cannot certify oscillatory cos lines as flat', () => {
    const previousFunction = state.currentFunction;
    state.currentFunction = 'cos';

    try {
        const planeParams = {
            width: 200,
            height: 160,
            origin: { x: 100, y: 80 },
            scale: { x: 50, y: 50 },
            currentVisXRange: [-2, 2],
            currentVisYRange: [-2, 2]
        };
        const capture = new LineCaptureContext();
        const pointSet = {
            role: 'grid-horizontal',
            color: '#fff',
            lineWidth: 1,
            points: [{ re: 0, im: 0 }, { re: 32 * Math.PI, im: 0 }]
        };

        drawPointSetCollectionOnPlane(capture, planeParams, [pointSet], {
            transformFunc: transformFunctions.cos,
            transformProfile: getMappedTransformProfile('cos', transformFunctions.cos)
        });

        const points = capture.paths.flat();
        const xValues = points.filter((_value, index) => index % 2 === 0);
        assert.ok(xValues.length > 64);
        assert.ok(Math.max(...xValues) - Math.min(...xValues) > 90);
    } finally {
        state.currentFunction = previousFunction;
    }
});

test('native adaptive polylines keep subdivision within their output budget', () => {
    const points = buildNativePlanarPolyline({
        map: nativeMapOptions(state, { functionKey: 'identity', chainingEnabled: false }),
        points: [{ re: 0, im: 0 }, { re: 1, im: 0 }],
        originX: 0,
        originY: 0,
        scaleX: 1,
        scaleY: 1,
        renderLimit: 10,
        jumpThresholdSq: 100,
        toleranceSq: 0,
        maxSegmentSq: 1e-20,
        maxDepth: 16,
        hasBranchCuts: false,
        branchCutAngle: 0
    });

    assert.equal(points.length, (2 ** 16 + 1) * 2);
    assert.ok(points.every(Number.isFinite));
});
