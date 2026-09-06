# Repository Architecture & Performance Decisions

## Unified planar domain rendering

All planar domain coloring uses the C-compiled expression program, arbitrary-precision
FLINT/Arb references, and WebGL2 delta evaluation. There is one decimal viewport at
all zoom levels. Do not introduce zoom thresholds, named fractal render kernels,
CPU pixel renderers, or compatibility/fallback render paths.

## Numerical accuracy

Propagate algebraic differences through every composition and output iteration.
Do not approximate an entire orbit with a truncated Taylor polynomial. Primitive
library series require an analytic domain and an explicit remainder bound;
convergence is determined by that domain, not by a universal unit disk rule.

Coordinates must meet a 1/64 sample-spacing error budget. GPU complex balls use
compensated high/low native FP32 mantissas, a separate binary exponent, and an
outward L1 error radius. Preserve explicit rounding barriers: WebGL shader
optimization must not erase the residual that carries the low component.
Do not emulate arbitrary-precision integer arithmetic in the sample shader.
The final relative value-error limit is min(2^-16, 1/(64*max(width,height)));
series truncation is included in that bound and budgeted across graph nodes,
iterations, and analytic range reduction. Increasing a term cap without changing
an inadequate stopping budget cannot resolve a rejected sample. Reference precision, local series
effort, and collective reference assignment may increase when bounds require it.
These changes never reduce image resolution. Refinement is coverage-driven, not
limited to a fixed number of rounds: try each unresolved sample center once per
numerical effort level in collective batches, then increase reference precision
and series effort. Stop on completion, viewport cancellation, actual resource
failure, or exhausted coverage at the supported numerical limits. Do not cycle
through the same centers indefinitely or treat elapsed time as numerical failure.
A new viewport job owns fresh coverage state. This does not guarantee that every
arbitrary expression or singular sample can be certified.
Never classify insufficient precision, range exhaustion, or overflow as escape.
Report a failed render if available numerical or GPU resources cannot resolve it.

## Coloring modes

Final Value evaluates the entire requested chain. Escape observes the configured
radius crossing at every iteration (radius 10,000). Attractor observes the finite-iteration convergence criterion using Brent
checkpoints and C-computed reference differences; it never subtracts rounded
absolute checkpoint coordinates. Period and detection iteration remain distinct.
Hybrid observes both events and otherwise colors the final value. These are
numerical rendering criteria, not proofs of asymptotic divergence or attraction.
A growing reference origin is recentered to its initial origin between iterations,
using a range bound scaled to that initial magnitude (and at least four). Do not
recenter arbitrary maps to zero: zero can be a pole or branch point. C exports the exact origin shift and the GPU adds it to every delta;
this never changes a sample's trajectory or supplies an escape/attractor event.
Reference growth must not make nearby finite sample orbits unevaluable.
Derivative presentation retains its finite-difference definition, evaluates both
full chains against the same reference, and subtracts their deltas before scaling.

## Samples and presentation

Every backing pixel retains four antialiasing samples. Evaluate samples in parallel
on WebGL2; batch iterations to bound submissions and reference memory. Assign a collective
batch of reference orbits to unresolved samples in each pass. Never schedule
one full-frame reference pass per pending pixel. Synchronize/read completion
only at publication boundaries; Final Value publishes at the requested depth.
Compact unresolved sample IDs before another reference pass; preserve global
pixel IDs and derivative pairing. Never dispatch the full viewport for a sparse
retry. A change in series effort updates reference data and uniforms, not shader
compilation. Estimate the degree once, evaluate Horner once, and include the
Cauchy tail M*q^(n+1)/(1-q) over the supplied analytic disk. Upload invariant
primitive coefficients once per reference batch; stream only changing anchors,
defects, and local series. Reciprocal nodes carry no unused series payload.
Bound iteration batches by graph work and reference memory, not only iteration
count. Copy C reference output directly into the aggregate upload buffer. Do not use
spatial tiles, perimeter matching, constant block fills, or color interpolation to
substitute for sample evaluation. Matching phase colors do not establish matching
complex values.

Clear immediately when a new job is dispatched. Commit completed pixels from the
current job at their actual dimensions, and leave unfinished pixels transparent.
Never stretch an old/coarse frame, debounce input, or silently reduce resolution.
Cancel superseded jobs between bounded submissions, retain the GPU context across
viewport changes, and discard stale bitmaps. Disabling domain rendering or a
worker failure terminates the worker and releases its resources.

## Memory ownership

Mutable numerical memory belongs to a WASM instance or a render/reference object.
Free C references/programs and transferred images per job. The worker owns reusable
GPU buffers and compiled shaders for the active expression until rendering is
disabled or the worker fails. No shared mutable C scratch buffers.

## Viewport and UI precision

Deep viewport coordinates remain decimal strings. Mouse deltas must update the
precise viewport rather than being absorbed into a JS Number origin. Canvas grid
loops must retain `if (val + step === val) break` safeguards.
