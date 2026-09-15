import test from 'node:test';
import assert from 'node:assert/strict';
import { synchronizePreciseViewport, panPreciseViewport, zoomPreciseViewport, preciseViewportSnapshot } from '../js/native/precise-viewport.js';
import { projectNativePrecisePixels } from '../js/native/complex-engine.js';
import { setPlaneViewport } from '../js/utils/canvas-utils.js';

function plane() {
    return { width: 20, height: 10, currentVisXRange: [-2, 2], currentVisYRange: [-1, 1],
        origin: { x: 10, y: 5 }, scale: { x: 5, y: 5 }, preciseViewport: null };
}
function project(inputViewport, outputViewport, x, y) {
    return projectNativePrecisePixels({ inputViewport, outputViewport, mapPoints: false }, [{ x: x - 0.5, y: y - 0.5 }]);
}

test('canonical viewport pans preserve one-pixel shifts after absolute doubles collapse', () => {
    const p = plane(); synchronizePreciseViewport(p, 1, 5);
    p.preciseViewport.centerRe = '0.12345'; p.preciseViewport.centerIm = '-0.6789';
    synchronizePreciseViewport(p, 1e100, 5);
    const before = preciseViewportSnapshot(p);
    panPreciseViewport(p, { ...p.preciseViewport }, 1, 0);
    const after = preciseViewportSnapshot(p);
    assert.equal(Number(before.centerRe), Number(after.centerRe));
    assert.notEqual(before.centerRe, after.centerRe);
    assert.deepEqual([...project(before, after, 10, 5)], [11, 5]);
});

test('zoom keeps a fractional screen anchor fixed in MPFR coordinates', () => {
    const p = plane(); synchronizePreciseViewport(p, 1e100, 5);
    p.preciseViewport.centerRe = '0.12345';
    const before = preciseViewportSnapshot(p);
    zoomPreciseViewport(p, 3.25, 6.75, 1e100, 2e100);
    assert.deepEqual([...project(before, preciseViewportSnapshot(p), 3.25, 6.75)], [3.25, 6.75]);
});

test('resize and explicit range changes preserve fitted aspect and canonical spans', () => {
    const p = plane(); synchronizePreciseViewport(p, 1, 5);
    p.width = 40; synchronizePreciseViewport(p, 1, 5);
    assert.equal(Number(p.preciseViewport.xSpan), 8);
    assert.equal(Number(p.preciseViewport.ySpan), 2);
    setPlaneViewport(p, [-2, 2], [-2, 2]);
    assert.equal(Number(p.preciseViewport.xSpan), p.width / p.scale.x);
    assert.equal(Number(p.preciseViewport.ySpan), p.height / p.scale.y);
});
