function normalizeKeys(keys) {
    if (!keys) return null;
    return keys instanceof Set ? keys : new Set(Array.isArray(keys) ? keys : [keys]);
}

export function createObservableStore(initialState, options = {}) {
    const values = { ...initialState };
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
            get: () => values[key],
            set: value => set(key, value)
        });
    }

    function set(key, value) {
        if (!Object.hasOwn(values, key)) {
            throw new Error(`Unknown state key "${key}"`);
        }

        const oldValue = values[key];
        const normalized = options.normalize?.(key, value, values);
        const nextValue = normalized === undefined ? value : normalized;
        if (Object.is(oldValue, nextValue)) return false;

        values[key] = nextValue;
        notify({ key, path: key, value: nextValue, oldValue });
        return true;
    }

    function touch(key, path = key) {
        if (!Object.hasOwn(values, key)) {
            throw new Error(`Cannot notify unknown state key "${key}"`);
        }
        notify({
            key,
            path,
            value: values[key],
            oldValue: values[key],
            mutation: true
        });
    }

    function transaction(callback) {
        transactionDepth += 1;
        try {
            return callback(state);
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
            const result = mutator(values[key]);
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

    Object.keys(values).forEach(defineKey);
    Object.preventExtensions(state);

    return Object.freeze({ state, set, touch, mutate, transaction, subscribe });
}
