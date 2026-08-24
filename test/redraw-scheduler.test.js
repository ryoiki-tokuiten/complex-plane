import test from 'node:test';
import assert from 'node:assert/strict';

import { context } from '../js/store/state.js';
import {
    configureRedrawScheduler,
    requestDomainRedraw
} from '../js/rendering/redraw-scheduler.js';

test('domain invalidation requested during a frame survives into the next frame', () => {
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
    const previous = {
        redrawRequest: context.redrawRequest,
        redrawQueued: context.redrawQueued,
        domainColoringDirty: context.domainColoringDirty
    };
    const frames = [];
    let renders = 0;

    try {
        globalThis.requestAnimationFrame = callback => {
            frames.push(callback);
            return frames.length;
        };
        context.redrawRequest = null;
        context.redrawQueued = false;
        context.domainColoringDirty = false;
        configureRedrawScheduler(() => {
            renders += 1;
            if (renders === 1) requestDomainRedraw();
        });

        requestDomainRedraw();
        assert.equal(frames.length, 1);
        frames.shift()(0);
        assert.equal(renders, 1);
        assert.equal(context.domainColoringDirty, true);
        assert.equal(frames.length, 1);

        frames.shift()(1);
        assert.equal(renders, 2);
        assert.equal(context.domainColoringDirty, false);
    } finally {
        globalThis.requestAnimationFrame = previousRequestAnimationFrame;
        context.redrawRequest = previous.redrawRequest;
        context.redrawQueued = previous.redrawQueued;
        context.domainColoringDirty = previous.domainColoringDirty;
    }
});
