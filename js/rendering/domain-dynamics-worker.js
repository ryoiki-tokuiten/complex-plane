import { createDomainDynamicsTileRenderer } from './domain-dynamics-core.js';

const renderers = new Map();

self.onmessage = event => {
    const message = event.data || {};

    if (message.type === 'start') {
        renderers.set(message.jobId, createDomainDynamicsTileRenderer(message.snapshot));
        return;
    }

    if (message.type === 'cancel') {
        renderers.delete(message.jobId);
        return;
    }

    if (message.type !== 'tile') return;

    try {
        const renderTile = renderers.get(message.jobId);
        if (!renderTile) {
            throw new Error('Domain dynamics job is not initialized.');
        }

        const pixels = renderTile(message.tile);
        const { basePixels: _basePixels, ...replyTile } = message.tile;
        self.postMessage({
            type: 'tile',
            jobId: message.jobId,
            passId: message.passId,
            tile: replyTile,
            pixels
        }, [pixels.buffer]);
    } catch (error) {
        self.postMessage({
            type: 'error',
            jobId: message.jobId,
            passId: message.passId,
            tile: message.tile,
            message: error?.message || String(error)
        });
    }
};