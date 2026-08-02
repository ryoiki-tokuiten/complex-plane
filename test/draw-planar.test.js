import test from 'node:test';
import assert from 'node:assert/strict';

import {
    calculateDynamicPointsForSegment,
    generateLinearSegmentPoints,
    getPointSetEndpoints
} from '../js/rendering/draw-planar.js';
import { state } from '../js/store/state.js';

test('linear segment generation returns fresh mutable point arrays', () => {
    const start = { re: 0, im: 0 };
    const end = { re: 1, im: 1 };

    const first = generateLinearSegmentPoints(start, end, 4);
    first[1].re = 999;

    const second = generateLinearSegmentPoints(start, end, 4);

    assert.notEqual(second, first);
    assert.notEqual(second[1], first[1]);
    assert.equal(second[1].re, 0.25);
    assert.equal(second[1].im, 0.25);
});

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

test('linear segment generation uses affine samples and exact endpoints', () => {
    const start = { re: 10, im: -5 };
    const end = { re: -10, im: 15 };
    const steps = 8;
    const points = generateLinearSegmentPoints(start, end, steps + 0.9);

    assert.equal(points.length, steps + 1);
    assert.deepEqual(points[0], start);
    assert.deepEqual(points[steps], end);

    for (let i = 0; i < steps; i++) {
        const t = i / steps;
        assert.ok(Math.abs(points[i].re - (start.re + (end.re - start.re) * t)) < 1e-12);
        assert.ok(Math.abs(points[i].im - (start.im + (end.im - start.im) * t)) < 1e-12);
    }
});

test('zeta segment refinement does not follow poles outside the segment', () => {
    const previousFunction = state.currentFunction;
    const previousContinuation = state.zetaContinuationEnabled;
    state.currentFunction = 'zeta';
    state.zetaContinuationEnabled = true;

    try {
        const planeParams = {
            width: 100,
            height: 100,
            origin: { x: 50, y: 50 },
            scale: { x: 10, y: 10 }
        };
        const transform = (re, im) => ({ re, im });
        const offSegment = calculateDynamicPointsForSegment(
            { re: 2, im: 0 },
            { re: 3, im: 0 },
            transform,
            planeParams
        );
        const comparableSegment = calculateDynamicPointsForSegment(
            { re: 3, im: 0 },
            { re: 4, im: 0 },
            transform,
            planeParams
        );

        assert.equal(offSegment, comparableSegment);
        assert.ok(offSegment < 768);

        state.zetaContinuationEnabled = false;
        const reflectedSegment = calculateDynamicPointsForSegment(
            { re: -1, im: 0 },
            { re: 0, im: 0 },
            transform,
            planeParams
        );
        assert.ok(Number.isFinite(reflectedSegment));
    } finally {
        state.currentFunction = previousFunction;
        state.zetaContinuationEnabled = previousContinuation;
    }
});
