import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGridFoldLineData } from '../js/rendering/three-riemann-renderer.js';
import { isGridInputShape } from '../js/rendering/shape-generators.js';

test('grid fold view is limited to the four grid input shapes', () => {
    for (const shape of ['grid_cartesian', 'grid_logcartesian', 'grid_polar', 'grid_logpolar']) {
        assert.equal(isGridInputShape(shape), true);
    }
    for (const shape of ['line', 'circle', 'image', 'video', 'empty_grid']) {
        assert.equal(isGridInputShape(shape), false);
    }
});

test('grid folds separate equal mapped points by source real coordinate', () => {
    const data = buildGridFoldLineData([
        {
            color: '#123456',
            points: [{ re: -1, im: 0 }, { re: 1, im: 0 }]
        }
    ], (re, im) => ({ re: re * re - im * im, im: 2 * re * im }), {
        sourceXRange: [-1, 1],
        outputXRange: [-2, 2],
        outputYRange: [-2, 2]
    });

    assert.equal(data.lines.length, 1);
    assert.equal(data.lines[0].color, '#123456');
    const positions = data.lines[0].positions;
    assert.deepEqual([positions[0], positions[1], positions[3], positions[4]], [0, -5, 0, 5]);
    assert.equal(Math.abs(positions[2]) + Math.abs(positions[5]), 0);
});

test('grid folds split invalid mapped regions without emitting non-finite geometry', () => {
    const data = buildGridFoldLineData([
        {
            points: [-2, -1, 0, 1, 2].map(re => ({ re, im: 0 }))
        }
    ], re => re === 0 ? { re: NaN, im: NaN } : { re, im: 0 }, {
        sourceXRange: [-2, 2],
        outputXRange: [-2, 2],
        outputYRange: [-1, 1]
    });

    assert.equal(data.lines.length, 2);
    assert.ok(data.lines.every(line => line.positions.every(Number.isFinite)));
});
