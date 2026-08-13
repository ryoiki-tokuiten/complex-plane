import test from 'node:test';
import assert from 'node:assert/strict';

import {
    generateTissotIndicatrices,
    selectStableTissotIndicatrices,
    getTissotViewportBounds
} from '../js/analysis/tissot.js';
import { drawConformalIndicatrices } from '../js/rendering/draw-planar.js';

class CanvasStrokeCounter {
    constructor() { this.strokeCount = 0; }
    save() {}
    restore() {}
    beginPath() {}
    moveTo() {}
    lineTo() {}
    stroke() { this.strokeCount += 1; }
    setLineDash() {}
}

test('Tissot indicatrices use the active map and its derivative once', () => {
    const map = {
        evaluate: (re, im) => ({ re, im }),
        derivative: () => ({ re: 2, im: 0 })
    };
    const indicatrices = generateTissotIndicatrices(map, [-1, 1], [-1, 1], 8, 8);

    assert.ok(indicatrices.length > 0);
    const indicatrix = indicatrices[0];
    const radius = Math.hypot(
        indicatrix.mappedCircle[0].re - indicatrix.mappedCircle[4].re,
        indicatrix.mappedCircle[0].im - indicatrix.mappedCircle[4].im
    ) / 2;
    assert.ok(radius > 0);
    assert.equal(indicatrix.sourceSpoke[1].im, indicatrix.sourceSpoke[0].im);
    assert.equal(indicatrix.mappedSpoke[1].im, indicatrix.mappedSpoke[0].im);
    assert.equal(indicatrix.sourceArrowhead.length, 3);
    assert.equal(indicatrix.mappedArrowhead.length, 3);
    assert.match(indicatrix.color, /^rgba\(/);
});

test('Tissot indicatrices preserve the source direction and flag critical collapse', () => {
    const map = {
        evaluate: (re, im) => ({ re: re + 2, im: im - 1 }),
        derivative: () => ({ re: 0, im: 0 })
    };
    const [indicatrix] = generateTissotIndicatrices(map, [-1, 1], [-1, 1], 8, 8);

    assert.ok(indicatrix);
    assert.equal(indicatrix.isCritical, true);
    assert.deepEqual(indicatrix.mappedSpoke[0], indicatrix.mappedSpoke[1]);
    assert.deepEqual(indicatrix.mappedArrowhead, []);
});

test('conformal indicatrix uses the unified Canvas stroke path', () => {
    const [indicatrix] = generateTissotIndicatrices({
        evaluate: (re, im) => ({ re, im }),
        derivative: () => ({ re: 1, im: 0 })
    }, [-1, 1], [-1, 1], 8, 8);
    const ctx = new CanvasStrokeCounter();

    drawConformalIndicatrices(ctx, {
        width: 100,
        height: 100,
        origin: { x: 50, y: 50 },
        scale: { x: 10, y: 10 }
    }, [indicatrix], 'mapped');

    assert.equal(ctx.strokeCount, 3);
});

test('Tissot rendering excludes derivative-scale outliers and fits retained circles', () => {
    const circle = (center, radius) => [
        { re: center.re - radius, im: center.im },
        { re: center.re, im: center.im + radius },
        { re: center.re + radius, im: center.im },
        { re: center.re, im: center.im - radius },
        { re: center.re - radius, im: center.im }
    ];
    const stable = Array.from({ length: 4 }, (_, index) => ({
        outputRadius: 1,
        mappedCircle: circle({ re: index, im: 0 }, 1)
    }));
    const outlier = {
        outputRadius: 100,
        mappedCircle: circle({ re: 100, im: 0 }, 100)
    };
    const selected = selectStableTissotIndicatrices([...stable, outlier]);
    const bounds = getTissotViewportBounds(selected);

    assert.equal(selected.length, 4);
    assert.ok(bounds.xRange[0] < -1);
    assert.ok(bounds.xRange[1] > 4);
    assert.ok(bounds.yRange[0] < -1);
    assert.ok(bounds.yRange[1] > 1);
});
