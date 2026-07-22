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

    context.redrawRequest = requestAnimationFrame(() => {
        context.redrawQueued = false;
        context.domainColoringDirtyQueued = false;

        try {
            if (!renderFrame) throw new Error('Redraw scheduler has not been configured');
            renderFrame();

            context.domainColoringDirty = context.domainColoringDirtyQueued;
            context.redrawRequest = null;

            if (state.webglGpuStressMode && state.domainColoringEnabled) {
                context.domainColoringDirty = true;
            }

            if (context.redrawQueued || context.domainColoringDirty || state.particleAnimationEnabled) {
                requestRedrawAll();
            }
        } catch (error) {
            console.error('Error during redraw (requestAnimationFrame):', error);
            context.redrawRequest = null;
        }
    });
}
