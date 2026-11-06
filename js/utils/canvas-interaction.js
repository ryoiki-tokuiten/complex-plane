export const canvasInteractionContexts = { z: null, w: null };

export function invalidateAllCanvasRects() {
    Object.values(canvasInteractionContexts).forEach(context => {
        if (context) context.hasFreshRect = false;
    });
}
