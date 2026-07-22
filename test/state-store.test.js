import test from 'node:test';
import assert from 'node:assert/strict';
import { effect } from '@preact/signals';

import { createObservableStore } from '../js/store/observable-store.js';

test('observable state preserves property reads and assignments without deep proxies', () => {
    const store = createObservableStore({ count: 1, nested: { value: 2 } });
    const changes = [];
    const unsubscribe = store.subscribe(change => changes.push(change));

    store.state.count = 3;
    assert.equal(store.state.count, 3);
    assert.deepEqual(changes[0], {
        key: 'count',
        path: 'count',
        value: 3,
        oldValue: 1
    });

    unsubscribe();
    store.state.count = 4;
    assert.equal(changes.length, 1);
    assert.throws(() => store.set('typo', true), /Unknown state key/);
});

test('state subscriptions are key-scoped and transactions coalesce repeated writes', () => {
    const store = createObservableStore({ count: 0, label: 'before' });
    const changes = [];
    store.subscribe(change => changes.push(change), 'count');

    store.transaction(state => {
        state.count = 1;
        state.label = 'after';
        state.count = 2;
    });

    assert.equal(changes.length, 1);
    assert.equal(changes[0].oldValue, 0);
    assert.equal(changes[0].value, 2);
});

test('nested state changes require an explicit mutation boundary', () => {
    const store = createObservableStore({ options: { enabled: false } });
    const changes = [];
    store.subscribe(change => changes.push(change));

    store.state.options.enabled = true;
    assert.equal(changes.length, 0);

    store.mutate('options', options => {
        options.enabled = false;
    }, 'options.enabled');
    assert.equal(changes.length, 1);
    assert.equal(changes[0].path, 'options.enabled');
    assert.equal(changes[0].mutation, true);
});

test('state signals batch component-facing updates across a transaction', () => {
    const store = createObservableStore({ count: 0 });
    const values = [];
    const dispose = effect(() => values.push(store.getSignal('count').value));

    store.transaction(state => {
        state.count = 1;
        state.count = 2;
    });

    assert.deepEqual(values, [0, 2]);
    dispose();
});

test('the application store enforces mutually exclusive probe and chaining modes', async () => {
    const { state } = await import('../js/store/state.js');
    state.chainingEnabled = false;
    state.probeActive = true;
    assert.equal(state.probeActive, true);

    state.chainingEnabled = true;
    assert.equal(state.probeActive, false);
    state.probeActive = true;
    assert.equal(state.probeActive, false);

    state.chainingEnabled = false;
});

test('reactive application state excludes DOM and frame-runtime handles', async () => {
    const { state } = await import('../js/store/state.js');
    for (const key of [
        'uploadedImage', 'uploadedVideo', 'videoProcessingLoopHandle',
        'panStateZ', 'panStateW', 'navigationKeys', 'navigationTrail', 'navigationPosition',
        'navigationHeading', 'particles', 'isProcessingZDomainDynamics',
        'isProcessingWDomainDynamics', 'wOriginGlowTime', 'previousWindingNumber'
    ]) {
        assert.equal(Object.hasOwn(state, key), false, key);
    }
});
