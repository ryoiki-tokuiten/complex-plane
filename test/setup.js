// The application is browser-only. Unit tests replace the browser frame queue
// with an inert handle unless a test installs its own deterministic scheduler.
globalThis.requestAnimationFrame ??= () => 1;
globalThis.cancelAnimationFrame ??= () => {};
