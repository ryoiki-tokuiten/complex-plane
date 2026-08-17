# Native C/WebAssembly Migration — Remaining Work

This is the handoff for completing the migration defined by `C_Native.md`. That document remains the authoritative architecture and completion contract. Do not weaken its ownership rules, and do not add JavaScript fallbacks, legacy engines, feature flags, compatibility wrappers, shadow paths, or retained dead code.

## Current status

The repository is intentionally a dirty worktree containing the in-progress migration. Preserve the user's pre-existing changes and the untracked/edited `C_Native.md`. Before continuing, inspect `git status --short` and do not reset or discard unrelated work.

The pinned automatic toolchain is working:

- Emscripten 4.0.12, GMP 6.3.0, and MPFR 4.2.1 are installed/built under the project cache automatically.
- `predev` and `prebuild` invoke `scripts/ensure-wasm.mjs`.
- Source hashing skips unchanged native builds.
- The current Wasm artifact builds successfully with `-O3 -flto -msimd128 -fno-fast-math`.

Latest successful focused verification:

```text
npm run build:wasm
node --test test/grid-anchoring.test.js test/draw-planar.test.js test/domain-dynamics.test.js
41 tests passed, 0 failed
```

Other focused suites passed during this migration:

```text
node --test test/discrete-sources.test.js test/sequence-bindings.test.js test/dynamic-plotting.test.js
27 tests passed, 0 failed

node --test test/active-map.test.js test/requested-analysis.test.js
13 tests passed, 0 failed
```

A production build had passed earlier in the migration, but it must be rerun after all current and remaining changes. The full suite has not been rerun after the latest source/shape work.

## Completed native ownership

The following work is implemented and focused-tested:

- Automatic pinned Wasm/GMP/MPFR build and runtime loading.
- Ordinary complex kernels and specialized Gamma, zeta, Bessel, polynomial, Möbius, power, Poincaré, and algebraic paths.
- Native expression VM, batching, chaining, Taylor coefficients/evaluation, derivatives, roots/preimages, and branch-sheet continuation.
- `js/math-utils.js` was deleted; production imports use the native map facade.
- Branch continuation is now three native jobs rather than JavaScript calculation loops.
- Dynamic aggregates run as a single native job with native point/term expression programs, variable bindings, sum/product reduction, invalid policies, partial results, and product metadata.
- Dynamic aggregates are integrated into ordinary domain rendering and MPFR precise/deep rendering.
- Discrete source generation is native: integer/natural/arithmetic/geometric/harmonic sequences, ordinary/Gaussian primes, Gaussian integers, and expression/filter generators. Old JavaScript generator exports were deleted.
- Sequence bindings use those packed native source jobs.
- Planar line mapping, line batches, adaptive polylines, vector fields, streamlines, Tissot data, contours, roots, and residues are native.
- Input-shape sampling is native: Cartesian, polar, log-polar, log-Cartesian, dots, line, circle, ellipse, drawn arbitrary strokes, and expression-parametric arbitrary shapes.
- Radial-step overlay generation and its scalar map evaluations are native.
- Exact viewport projection exists for ordinary values and precise source pixels. Cartesian/dot deep-zoom source grids now have native pixel geometry, and production planar drawing uses the exact projector when either the source or destination viewport is precise.
- Ordinary domain dynamics writes final RGBA in C; `domain-dynamics-core.js` was deleted.
- MPFR precise domain rendering includes reference/repair/direct paths and keeps neighboring pixels distinct at `10^125`.
- Forward/non-invertible image rendering uses the native adaptive mesh; deep image sampling uses MPFR. The inverse ordinary image path remains GPU-owned as required.
- Real surfaces, Laplace analysis/surfaces, grid folds, sphere lines/probes/targets, and image-fold geometry are native.
- The Riemann surface remains the required GPU-owned path and reports an explicit unsupported message at arbitrary precision.
- `js/analysis/reducers.js` and its obsolete test were deleted.

## Important current files

- `native/include/complex_engine.h` — packed public native jobs.
- `native/src/core/complex.c` — map evaluation, chaining, dynamic ordinary aggregate, sheet evaluation.
- `native/src/precision/precision.c` — MPFR map/expression/domain/image/projection logic.
- `native/src/planar/planar.c` — mapped planar line/adaptive geometry.
- `native/src/planar/shapes.c` — newly added packed source-shape and exact viewport-grid generation.
- `native/src/analysis/discrete.c` — newly added packed discrete/sequence sources.
- `js/native/complex-engine.js` — sole low-level Wasm bridge and packed buffer marshalling.
- `js/native/map-runtime.js` — small public native map facade replacing the old math utility engine.
- `js/rendering/shape-generators.js` — now a thin UI/style adapter over native shape jobs.
- `js/rendering/draw-planar.js` — uses native mapped geometry and precise projection, but still contains cleanup work listed below.

## Remaining work, in order

### 1. Finish precise planar integration

The low-level exact projection and production Cartesian/dot grid path are wired. Finish the rest of the precise planar contract:

- Verify all four viewport combinations in production rendering:
  - ordinary source -> ordinary destination;
  - precise source -> ordinary destination;
  - ordinary source -> precise destination;
  - precise source -> precise destination.
- Add focused production-level tests around `drawPointSetCollectionOnPlane`/`drawPlanarTransformedShape`, not only low-level projector tests.
- Extend exact MPFR source construction for viewport-dependent polar/log-polar/log-Cartesian shapes if visual testing shows double-generated source geometry collapses around a nonzero deep center. Cartesian and dots already use exact pixel geometry.
- Make axes, ticks, base canvas grids, branch-cut overlays, probes, zero/pole markers, and other planar overlays precise-aware. They currently still rely in places on stale `origin`, `scale`, or ordinary ranges when `preciseViewport` is active.
- Disable or explicitly report unsupported non-planar modes at arbitrary precision where appropriate; do not silently render with stale ordinary ranges.
- Preserve the explicit Riemann-surface unsupported behavior; do not add a CPU surface renderer.

Potential issue to inspect: `preciseMappedGeometry()` in `js/rendering/draw-planar.js` is newly integrated and focused low-level tests pass, but it needs browser visual coverage and cache/performance validation.

### 2. Remove remaining JavaScript planar calculation remnants

Audit `js/rendering/draw-planar.js` and delete replaced helpers/exports rather than retaining them for tests:

- `generateLinearSegmentPoints` remains only for old tests and `preparePointSetForMappedPlane`.
- `preparePointSetForMappedPlane` is still imported by `js/rendering/taylor-series.js`; Taylor maps already carry native metadata, so route this entirely through the native line job and delete the JavaScript resampling helper.
- Update/delete the obsolete helper tests in `test/draw-planar.test.js`.
- The grid-dot draw loop is drawing-only now, but ensure every mapped dot batch is evaluated/projected as one native job in all viewport modes.
- Review probe/particle/overlay scalar calls. Drawing loops are allowed; mathematical sampling, mapping, refinement, and coordinate derivation must be native jobs.
- Review `createGridSeeds` in `draw-planar.js`. Seed construction is still JavaScript even though tracing is native; move it into the streamline job if it is part of the heavy calculation contract.

### 3. Finish analysis ownership

`js/analysis/fourier-transform.js` still contains calculation loops and was the next planned port:

- Add a packed C signal-generation job preserving sine, cosine, square, sawtooth, triangle, AM, FM, chirp, damped sine, exponential, Gaussian, pulse, harmonics, beat, and noise behavior.
- For noise, pass one random seed into C and generate the samples natively; do not retain a JavaScript per-sample fallback.
- Extend the native FFT job to write final packed spectrum fields (`k`, frequency, real, imaginary, magnitude, phase), then delete the JavaScript magnitude/phase loop.
- Extend the Fourier winding job to perform finite filtering, cutoff selection, max-amplitude calculation, winding, and center-of-mass in C. JavaScript should only form UI records from packed output.
- Remove `computeNativeDft` once the final spectrum job owns the result.

Delete the stale unused Laplace sample path:

- `ce_compute_laplace_samples` in `native/src/analysis/transforms.c`;
- its declaration in `native/include/complex_engine.h`;
- its export in `scripts/ensure-wasm.mjs`;
- `computeNativeLaplaceSamples` in `js/native/complex-engine.js`.

The active Laplace analysis/evaluation/surface path already uses the newer native jobs.

Review the remaining `js/analysis/` files for calculation loops:

- `cauchy.js` still classifies poles against contours and checks boundary distance in JavaScript. Move the packed contour/pole classification into C; keep only UI string construction in JavaScript.
- `contours.js` is a small predicate/point adapter, but its circle/ellipse point generation and polygon containment are still mathematical work used by Cauchy analysis. Consolidate these into the native contour job, then delete stale exports.
- `tissot.js` does UI-side quantile/outlier selection. Decide from the contract whether this selection belongs in the packed native job; do not leave heavy geometry calculations in JS.
- `feature-detection.js`, `preimage.js`, `root-finding.js`, and `streamline.js` are mostly native adapters; audit for stale scalar/shadow paths.

### 4. Fix dynamic sheet evaluation

Ordinary/deep aggregate evaluation is native, but `ce_evaluate_sheets` currently evaluates the selected base function directly and may ignore `ce_map_config.dynamic_*` aggregate fields. Add native sheet-aware dynamic aggregate evaluation so branch continuation of an active dynamic aggregate is correct. It must use the sheet for branch-sensitive expression operations and selected-function calls.

Add a focused dynamic aggregate continuation test before deleting any related old expectations.

### 5. Simplify the active-map/derivative facade

Audit `js/native/map-runtime.js`, `js/active-map.js`, and their callers:

- Production active maps should carry `derivativeOrder` directly into native jobs.
- Delete any remaining JavaScript finite-difference transform factory used by production.
- Test-only helpers may be rewritten against batch native evaluation; do not preserve old calculation exports merely to keep obsolete tests unchanged.

### 6. Aggressive dead-code and shader cleanup

After each remaining port, search and delete the replaced code immediately. At minimum audit:

```bash
rg -n "fallback|legacy|compat|shadow|cpuEval|u_useCpuEval|math-utils|compilePipeline" js native test
rg -n "computeNativeDft|computeNativeLaplaceSamples|generateLinearSegmentPoints|preparePointSetForMappedPlane" js test native
rg -n "evaluateMappedTransform|transformFunctions" js/rendering js/analysis
rg -n "currentVisXRange|origin|scale" js/rendering | rg "precise|planar|overlay|probe|axis|grid"
```

Interpret matches carefully: a user-visible error message explaining that no fallback exists is fine; a runtime alternate engine is not.

For the image renderer, verify the removed architecture is completely gone:

- no CPU inverse-image implementation;
- no old JavaScript adaptive mesh builder;
- no forward complex-function vertex shader;
- no `u_useCpuEval`;
- no dual forward VAOs.

Keep exactly the two GPU-owned paths from `C_Native.md`: ordinary supported inverse-image rendering and the ordinary-precision Riemann surface.

### 7. Full verification

Run in this order and fix every failure without adding fallbacks:

```bash
npm run build:wasm
npm test
npm run build
```

Then verify clean automatic setup. Use a recoverable cache move rather than destructive deletion if practical:

```bash
npm install
npm run dev
```

Confirm that no manual compiler configuration is needed, the native source watcher rebuilds successfully, and a clean browser load has no hidden Wasm startup errors.

Browser/visual checks must cover at least:

- ordinary Cartesian, polar, log-polar, log-Cartesian, dots, circle, ellipse, line, and arbitrary shapes;
- branch cuts and invalid discontinuities;
- dynamic aggregates and sequence presets;
- image inverse GPU path and forward native mesh path;
- real plot, Laplace surface, folds, sphere, probes, roots/preimages;
- repeated pan/zoom and worker cancellation;
- precise centers at `10^125`, neighboring-pixel distinction, panning digit preservation, transformed source/destination combinations, and tile seams;
- explicit Riemann-surface unsupported state at arbitrary precision.

Use the in-app browser/Playwright setup already present in the project if available. Capture screenshots for comparison and inspect them, rather than relying only on DOM assertions.

### 8. Benchmarks

Run all benchmark scripts and compare against the recorded baseline in `C_Native.md`:

- planar baseline: about 20 ms;
- algebraic domain tile baseline: about 44 ms.

Earlier measurements during this migration were approximately:

- native planar lines: about 3.9 ms versus roughly 19–20 ms baseline;
- native ordinary domain tile: about 38.7 ms versus roughly 41–44 ms baseline.

These were intermediate measurements and must be rerun from the final tree. Also benchmark source/sequence generation, dynamic aggregates, image mesh, precise planar projection, and repeated rendering memory behavior. Any ownership deviation must have concrete benchmark evidence; none is currently justified or intended.

### 9. Update `C_Native.md`

Only after all checks pass, add brief phase-completion notes and final measured results to `C_Native.md`. Record deviations only when supported by benchmark evidence. Do not rewrite the architecture or weaken its completion checks.

## Required final completion criteria

Do not call the migration complete until all of these are true:

- Every CPU mathematical hot path has one C/Wasm owner.
- The two specified GPU paths are preserved and no additional GPU/CPU shadow path exists.
- Ordinary zoom behavior and specialized edge cases match the existing fixtures.
- Exact centers, neighboring pixels, panning digits, and deep rendering remain correct at `10^125`.
- Worker cancellation, repeated zooming, memory use, clean startup, production build, correctness tests, visual checks, and benchmarks pass.
- Every migrated hot path materially improves or beats the recorded baseline.
- Production searches find no old calculation exports, fallback branches, compatibility aliases, obsolete kernels, unused shaders/constants, or unreachable code.
- Replaced tests are deleted or rewritten against the single native owner; no obsolete test is kept alive by a compatibility export.

The final implementation should stay surgical: packed job functions, typed buffers, thin JavaScript UI/drawing adapters, and no generalized framework.
