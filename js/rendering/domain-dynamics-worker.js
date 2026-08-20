import { createDomainDynamicsTileRenderer } from '../native/domain-engine.js';

const renderers = new Map();

self.onmessage = event => {
    const message = event.data;
    if (!message || typeof message !== 'object') {
        throw new Error('Native domain worker received an invalid message.');
    }

    if (message.type === 'start') {
        for (const [id, r] of renderers) {
            if (r?.dispose) r.dispose();
        }
        renderers.clear();
        renderers.set(message.jobId, createDomainDynamicsTileRenderer(message.snapshot));
        return;
    }

    if (message.type === 'cancel') {
        const existing = renderers.get(message.jobId);
        if (existing?.dispose) existing.dispose();
        renderers.delete(message.jobId);
        return;
    }

    if (message.type !== 'tile') {
        throw new Error(`Unsupported native domain worker message: ${message.type}.`);
    }

    try {
        const startedAt = performance.now();
        const renderTile = renderers.get(message.jobId);
        if (!renderTile) {
            throw new Error(`Domain dynamics job ${message.jobId} is not initialized.`);
        }

        const pixels = renderTile(message.tile);
        const renderMilliseconds = performance.now() - startedAt;
        self.postMessage({
            type: 'tile',
            jobId: message.jobId,
            tile: message.tile,
            pixels,
            renderMilliseconds
        }, [pixels.buffer]);
    } catch (error) {
        self.postMessage({
            type: 'error',
            jobId: message.jobId,
            tile: message.tile,
            message: error?.message || String(error)
        });
    }
};

self.postMessage({ type: 'ready' });
