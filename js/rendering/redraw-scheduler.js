import { state, context } from '../store/state.js';

let renderFrame = null;

export function configureRedrawScheduler(callback) {
    if (typeof callback !== 'function') {
        throw new TypeError('Redraw scheduler requires a render callback');
    }
    renderFrame = callback;
}

export function requestRedrawAll() {
    if (context.redrawRequest) {
        context.redrawQueued = true;
        if (context.domainColoringDirty) context.domainColoringDirtyQueued = true;
        return;
    }

    context.redrawRequest = requestAnimationFrame(timestamp => {
        context.redrawQueued = false;
        context.domainColoringDirtyQueued = false;
        context.redrawRequest = null;
        if (!renderFrame) throw new Error('Redraw scheduler has not been configured');
        renderFrame(timestamp);

        context.domainColoringDirty = context.domainColoringDirtyQueued;
        if (context.redrawQueued || context.domainColoringDirty || state.particleAnimationEnabled) {
            requestRedrawAll();
        }
    });
}
