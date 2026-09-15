import { encodeDomainNumbers } from '../native/complex-engine.js';

self.onmessage = ({ data: { generation, words, start, numbers } }) => {
    try {
        const began = performance.now();
        const values = encodeDomainNumbers(numbers, words);
        self.postMessage({ generation, start, values, milliseconds: performance.now() - began }, [values.buffer]);
    } catch (error) {
        self.postMessage({ generation, error: error?.message || String(error) });
    }
};
self.postMessage({ type: 'ready' });
