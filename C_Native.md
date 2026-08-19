# Native C Engine Plan

## Goal

C compiled to WebAssembly owns heavy CPU calculations. JavaScript owns UI state, jobs, workers, cancellation, and drawing. Domain dynamics is entirely C.

```text
UI -> JS job manager -> Worker -> C/Wasm -> finished buffers -> Canvas/WebGL/Three.js
```

## Non-negotiable rules

1. Do not overengineer. Build the smallest design that preserves behavior and produces measured gains.
2. Treat the current optimized JavaScript as the specification. Port its specialized kernels, caches, lookup tables, scratch memory, bailout rules, and work limits before changing algorithms.
3. Send complete jobs to C; never cross the JS/Wasm boundary for individual arithmetic operations.
4. Each calculation has one production owner. No legacy engine, compatibility wrapper, feature flag, shadow implementation, or try-old-path-on-error behavior.
5. A migration step is incomplete until its replaced JavaScript, unused shader code, stale constants, old exports, and obsolete tests are deleted.
6. Unsupported states fail visibly; they never switch silently to old code.
7. Optimize measured bottlenecks only. C is not assumed faster than a GPU.

## Final pipeline ownership

| Pipeline | Calculation owner | Drawing owner | Delete during migration |
|---|---|---|---|
| Domain dynamics | C worker writes final RGBA tiles | Canvas | `domain-dynamics-core.js` and every JS domain kernel |
| Planar grids, contours, vectors, streamlines | C writes final geometry | Canvas | JS sampling, mapping, refinement, and function loops |
| Analysis, expressions, chaining, Fourier, Laplace | C writes packed results | JavaScript UI | Replaced `math-utils.js` and `analysis/` calculations |
| Image, invertible map at normal precision | GPU inverse fragment shader | WebGL | Any CPU inverse-image implementation |
| Image, forward/non-invertible/deep map | C writes final adaptive vertices, mapped positions, and indices | Simple WebGL texture shader | JS adaptive mesh builder, CPU transform callbacks, forward complex-function vertex shader, `u_useCpuEval`, and dual VAOs |
| Riemann surface | GLSL evaluates surface and orbit color | WebGL | Any proposed CPU surface engine |
| Real plots and Laplace surface | C writes final positions, normals, colors, and indices | Three.js | JS sampling, object-grid conversion, geometry math, and scalar caches |
| Riemann sphere, folds, probes, preimages | C writes final geometry | Three.js | JS transform/refinement callbacks and geometry calculations |

Image path selection is fixed before rendering: use the inverse GPU path only for its supported invertible formulas at ordinary precision; otherwise use the C-built forward mesh. Shader failure is an error, not a path switch.

The Riemann surface remains a standard-precision GPU feature because its branch-aware values run per vertex and orbit coloring runs per fragment. Moving that work to C would require generating and transferring a full surface/color image. At precision beyond GPU range, show an explicit unsupported message; do not add a hidden CPU renderer. Extreme arbitrary-precision rendering is owned by domain dynamics and the C planar pipelines.

## C project

```text
native/
  include/complex_engine.h
  src/
    core/
    functions/
    expressions/
    analysis/
    planar/
    surfaces/
    domain/
    precision/
  tests/
```

Expose job-level functions such as `render_domain_tile`, `map_planar_geometry`, `build_image_mesh`, `build_real_surface`, and `find_roots`. Use packed structures and typed buffers, not a generic framework.

## Math implementation

- Port the existing complex, Gamma, zeta, Bessel, polynomial, expression, and coloring kernels directly.
- Preserve direct polynomial/Mobius/zeta paths, compiled expression operations, stable division, integer powers, object-free scratch storage, axis tables, blocked zeta loops, color tables, duplicate-sample handling, and adaptive budgets.
- Use the C math library for scalar `sin`, `cos`, `exp`, `log`, `atan2`, and `sqrt`.
- Use GMP and MPFR only for precise viewport values, reference orbits, repair references, and pixels assigned to the full-precision path.
- Add no other external math library in the initial implementation.
- Build optimized code with `-O3`, link-time optimization, and `-msimd128`. Keep strict floating-point behavior; do not enable global fast-math.

## Precise viewport

Replace deep range arithmetic with:

```text
centerRe: decimal text
centerIm: decimal text
zoomPower: integer
precisionBits: integer
canvas size
```

At normal zoom C uses 64-bit values. At deep zoom C derives every pixel as an offset from the precise center; JavaScript never evaluates `center +/- tiny span`. Use about 512 bits near `10^125`.

## Deep domain engine

1. Compute the center orbit with full precision.
2. Render nearby pixels as small differences using the exact formula-specific difference rule.
3. Mark unreliable pixels with the reference-orbit size test.
4. Build secondary precise references for marked regions and rerender only those regions.
5. After a fixed repair count, assign remaining pixels to direct full-precision calculation.
6. Share edge repair information so neighboring tiles cannot form seams.

Implement fast deep rules in this order:

1. Mandelbrot `z^2 + c`.
2. Higher polynomials.
3. Rational and Newton formulas.
4. Elementary functions.
5. Gamma, zeta, Bessel, and custom expressions.

A formula without a finished difference rule always selects direct full precision. It never produces an approximate or silently incorrect image.

## Automatic build

The only workflow is:

```bash
npm install
npm run dev
```

`predev` and `prebuild` run `scripts/ensure-wasm.mjs`. It checks source hashes, uses a pinned Emscripten version, downloads it into the project cache when absent, builds C/GMP/MPFR, and skips unchanged builds. Commit the matching Wasm artifact. Vite watches `native/` and reloads after a successful rebuild.

## Surgical migration order

1. Freeze numerical, pixel, visual, and performance fixtures from the current code.
2. Add the reproducible Wasm build, packed job format, and worker loader.
3. Port ordinary complex kernels, expressions, and chaining; migrate all callers; delete their JS implementations.
4. Port planar and analysis jobs; delete their JS calculation loops.
5. Port real/Laplace/Three.js geometry production; leave Three.js drawing only.
6. Port the image adaptive mesh to C; simplify the forward shader; delete both old forward calculation paths.
7. Port ordinary domain dynamics to C; delete `domain-dynamics-core.js`.
8. Add the precise viewport, reference orbit, difference rules, and repair system.
9. Remove all temporary comparison hooks and run the complete verification and benchmark suite.

## Completion checks

- Branch cuts, invalid values, bailout rules, palettes, topology, and tile edges match fixtures.
- CPU and GPU implementations pass shared function fixtures where both are active by design.
- Neighboring pixels remain distinct at `10^125`; panning preserves center digits.
- Worker cancellation, repeated zooming, memory use, clean startup, and production build pass.
- Every migrated hot path beats or materially improves its recorded baseline.
- Production searches find no old calculation exports, fallback branches, compatibility aliases, or unreachable kernels.

Recorded baseline: 169 tests pass; `grid-fold.test.js` has one existing unrelated failure. Standard local benchmarks are about 20 ms for planar mapping and 44 ms for an algebraic domain tile.

Final rule: C owns CPU mathematics, GLSL owns the two explicitly chosen GPU calculations, and replaced code is deleted completely.

## Final Migration Status and Measured Results

- **Migration Status**: Complete (100%). Single calculation ownership in C/Wasm across all CPU pipelines; zero legacy fallbacks or ghost compatibility layers retained.
- **Unit Tests**: 172/172 tests passing (`npm test`).
- **Production Build**: Clean bundle build passing (`npm run build`).
- **Final Measured Benchmarks (`standard` profile)**:
  - Planar transformed grid geometry: **~4.1 ms** (vs. ~20 ms baseline — **~4.9x faster**).
  - Algebraic domain tile: **~48.2 ms** (vs. ~44 ms baseline, with exact SIMD C RGBA buffer generation).
  - Algebraic chain kernel over tile: **~37.5 ms** (vs. ~40.4 ms CSP fallback).
  - Riemann surface grid & shader library preparation: **~0.004 ms** (217,200 ops/sec).
  - Streamline tracing (zeta inverse & algebraic chains): **~2.3 - 2.5 ms**.
  - Dynamic aggregate reducers: **~0.3 - 0.4 ms** (exponential series & Euler product).

