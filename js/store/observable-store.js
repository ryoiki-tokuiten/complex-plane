import { batch, signal } from '@preact/signals';

function normalizeKeys(keys) {
    if (!keys) return null;
    return keys instanceof Set ? keys : new Set(Array.isArray(keys) ? keys : [keys]);
}

export function createObservableStore(initialState, options = {}) {
    const signals = new Map(
        Object.entries(initialState).map(([key, value]) => [key, signal(value)])
    );
    const state = {};
    const subscribers = new Set();
    let transactionDepth = 0;
    let pendingChanges = new Map();

    function notify(change) {
        if (transactionDepth > 0) {
            const pending = pendingChanges.get(change.key);
            pendingChanges.set(change.key, pending
                ? { ...change, oldValue: pending.oldValue }
                : change);
            return;
        }

        for (const subscription of [...subscribers]) {
            if (!subscription.keys || subscription.keys.has(change.key)) {
                subscription.listener(change, state);
            }
        }
    }

    function defineKey(key) {
        Object.defineProperty(state, key, {
            enumerable: true,
            configurable: false,
            get: () => signals.get(key).value,
            set: value => set(key, value)
        });
    }

    function set(key, value) {
        const stateSignal = signals.get(key);
        if (!stateSignal) {
            throw new Error(`Unknown state key "${key}"`);
        }

        const oldValue = stateSignal.peek();
        const normalized = options.normalize?.(key, value, state);
        const nextValue = normalized === undefined ? value : normalized;
        if (Object.is(oldValue, nextValue)) return false;

        stateSignal.value = nextValue;
        notify({ key, path: key, value: nextValue, oldValue });
        return true;
    }

    function touch(key, path = key) {
        const stateSignal = signals.get(key);
        if (!stateSignal) {
            throw new Error(`Cannot notify unknown state key "${key}"`);
        }
        const value = stateSignal.peek();
        const nextValue = Array.isArray(value)
            ? value.slice()
            : value instanceof Map
                ? new Map(value)
                : value instanceof Set
                    ? new Set(value)
                    : value && typeof value === 'object'
                        ? { ...value }
                        : value;
        stateSignal.value = nextValue;
        notify({
            key,
            path,
            value: nextValue,
            oldValue: value,
            mutation: true
        });
    }

    function transaction(callback) {
        transactionDepth += 1;
        try {
            return batch(() => callback(state));
        } finally {
            transactionDepth -= 1;
            if (transactionDepth === 0 && pendingChanges.size > 0) {
                const changes = pendingChanges;
                pendingChanges = new Map();
                for (const change of changes.values()) notify(change);
            }
        }
    }

    function mutate(key, mutator, path = key) {
        return transaction(() => {
            const value = signals.get(key)?.peek();
            if (value === undefined && !signals.has(key)) {
                throw new Error(`Cannot mutate unknown state key "${key}"`);
            }
            const result = mutator(value);
            touch(key, path);
            return result;
        });
    }

    function subscribe(listener, keys = null) {
        if (typeof listener !== 'function') {
            throw new TypeError('State subscriber must be a function');
        }
        const subscription = { listener, keys: normalizeKeys(keys) };
        subscribers.add(subscription);
        return () => subscribers.delete(subscription);
    }

    function getSignal(key) {
        const stateSignal = signals.get(key);
        if (!stateSignal) throw new Error(`Unknown state key "${key}"`);
        return stateSignal;
    }

    signals.forEach((_value, key) => defineKey(key));
    Object.preventExtensions(state);

    return Object.freeze({ state, set, touch, mutate, transaction, subscribe, getSignal });
}
