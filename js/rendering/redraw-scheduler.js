import { state, context } from '../store/state.js';

let renderFrame = null;
let domainInvalidation = 0;

export function configureRedrawScheduler(callback) {
    if (typeof callback !== 'function') {
        throw new TypeError('Redraw scheduler requires a render callback');
    }
    renderFrame = callback;
}

export function requestRedrawAll() {
    if (context.redrawRequest) {
        context.redrawQueued = true;
        return;
    }

    context.redrawRequest = requestAnimationFrame(timestamp => {
        context.redrawQueued = false;
        context.redrawRequest = null;
        if (!renderFrame) throw new Error('Redraw scheduler has not been configured');
        const renderedDomainInvalidation = domainInvalidation;
        renderFrame(timestamp);

        if (domainInvalidation === renderedDomainInvalidation) {
            context.domainColoringDirty = false;
        }
        if (context.redrawQueued || context.domainColoringDirty || state.particleAnimationEnabled) {
            requestRedrawAll();
        }
    });
}

// State-changing callers use these two entry points so dirty-bit ownership stays
// in the scheduler instead of being repeated across UI event handlers.
export function requestUiRedraw() {
    requestRedrawAll();
}

export function requestDomainRedraw(markDomainDirty = true) {
    if (markDomainDirty) {
        domainInvalidation += 1;
        context.domainColoringDirty = true;
    }
    requestRedrawAll();
}
