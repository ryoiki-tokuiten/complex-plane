## Priority 0 — Wrong numerical or geometric output

### 1. Unify CPU and GPU domain-dynamics semantics

`js/domain-dynamics-core.js` and `js/webgl-domain-coloring.js` currently use different numerical contracts:

- CPU escape radius: `1e4`; GPU escape radius: `64`.
- CPU bailout: `1e8`; GPU stop threshold: `1e18`.
- CPU logarithmic magnitude: `log1p(|z|)`; GPU logarithmic magnitude: `log(|z|)`.
- GPU algebraic chains are truncated to 512 operations; CPU chains are not.

Ordinary supported Z dynamics normally use the CPU worker path, but GPU evaluation remains reachable in derivative, Taylor, dynamic-aggregate, and fallback modes. Switching mode or backend can therefore change the rendered mathematics.

Required change:

- Define one shared dynamics contract for escape, bailout, smoothing, invalid values, and maximum chain length.
- Apply it to both CPU and GPU implementations.
- If a limit is backend-specific, surface it explicitly and prevent silent truncation.

Complete when identical fixtures produce equivalent classifications and closely matching normalized values on CPU and GPU, including boundary, overflow, and long-chain cases.

### 2. Stop using a single inverse branch for non-injective image maps

The inverse-image shader in `js/draw-image-webgl.js` calls `evaluateInverseFunction` from `js/webgl-shared.js`, which returns one principal inverse. `isInverseImageRenderSupportedForSnapshot` enables that path for several non-injective maps, including periodic and multi-valued transformations. The result omits valid preimage sheets and repeated copies.

Required change:

- Add explicit injectivity/inverse-topology metadata for every image transformation.
- Use inverse rendering only where one inverse branch represents the requested domain.
- Route non-injective maps through forward rendering until all required inverse branches and their valid regions are implemented.

Complete when inverse rendering cannot be selected for a map whose visible preimage requires branches the renderer does not generate.

### 3. Build image meshes without invalid or discontinuity-crossing triangles

The CPU image path substitutes invalid mapped points with `(10, 10)` while still emitting valid vertices. Both image paths use fixed grid indices that connect every neighboring cell. GPU fragment validity can discard fragments, but it cannot remove triangles that were already created across poles, branch cuts, or invalid vertices. Finite samples on opposite sides of a discontinuity can also be joined into a large false triangle.

Required change:

- Preserve validity per sampled vertex instead of replacing invalid results with ordinary coordinates.
- Generate indices only for cells whose vertices form a continuous mapped patch.
- Subdivide cells adaptively when mapped edge or midpoint error is too large.
- Apply the same topology rules to CPU and GPU image rendering.

Complete when meshes around poles, branch cuts, and invalid regions contain holes or split patches rather than stretched triangles.

### 4. Use the shared expression parser in the CPU dynamics accelerator

`compilePrimitiveExpression` in `js/domain-dynamics-core.js` gives unary negation higher precedence than exponentiation. It therefore evaluates `-z^2` as `(-z)^2`. The main parser in `js/math/expression/parser.js` correctly evaluates it as `-(z^2)`.

Required change:

- Compile accelerated algebraic chains from the shared parser/AST semantics.
- Remove or constrain the duplicate primitive parser so it cannot reinterpret accepted expressions.

Complete when accelerated and ordinary evaluation agree for unary signs, powers, nested powers, parentheses, and representative chained expressions.

### 5. Do not render invalid real-plot expressions as plausible surfaces

Real-plot controls write raw input into state before validation. Compilation failures are cached as `null`; missing compiled expressions fall back to `(x, 0)`; runtime failures become zero-valued samples; and `result.im || 0` converts `NaN` to zero. Invalid input can therefore display a believable but unrelated surface.

Required change:

- Validate before committing an expression as renderable state, or retain the last valid compiled expression.
- Represent failed and non-finite samples as invalid data, not zero.
- Prevent surface and contour geometry from crossing invalid sample regions.
- Expose the validation failure in the existing UI error state.

Complete when malformed or non-finite expressions cannot produce a fallback identity or zero surface.

### 6. Preserve reciprocal direction when capping tiny values

`writeReciprocalKernel` returns the same positive real cap for every nonzero input whose squared magnitude is below `1e-30`. Tiny negative, imaginary, and complex inputs therefore lose the sign and phase of their reciprocal.

Required change:

- Compute reciprocal direction from the input and cap only its magnitude.
- Keep exact zero as an invalid/pole case.

Complete when tiny positive, negative, imaginary, and complex inputs approach the cap in the correct direction.

## Priority 1 — Rendering and temporal correctness

### 7. Correct heightfield normals at grid boundaries

`writeHeightfieldNormals` uses the centered-difference divisor `2h` at every vertex. Boundary samples only span `h`, so boundary slopes are halved and lighting is visibly wrong along the edges.

Required change:

- Use centered differences in the interior and one-sided differences with divisor `h` at boundaries.
- Use stable magnitude calculation for complex-valued height modes.

Complete when planar test surfaces produce the same expected normal at interior and boundary vertices.

### 8. Construct vector arrowheads in canvas coordinates

Vector shafts convert mathematical direction `(dx, dy)` to canvas direction `(dx, -dy)`, but arrowhead offsets use inconsistent signs and are not perpendicular for diagonal vectors.

Required change:

- Derive the arrowhead backward vector and perpendicular from the final normalized canvas-space direction.
- Reuse that construction for all vector-field rendering paths.

Complete when horizontal, vertical, and diagonal vectors have symmetric arrowheads aligned with their shafts.

### 9. Clip Canvas Riemann-sphere curves at the visible limb

The Canvas sphere renderer connects a visible sample directly to the first hidden sample and begins hidden-to-visible segments at the first visible sample. It does not calculate the sphere-limb intersection. A fixed complex-plane jump threshold can also split curves that are continuous on the compact sphere near infinity.

Required change:

- Intersect visibility-changing segments with the hemisphere boundary before projection.
- Decide continuity in sphere/projected space rather than with a fixed pre-projection complex-distance cutoff.

Complete when curves enter and leave the visible hemisphere exactly at the limb and remain continuous through valid neighborhoods of infinity.

### 10. Make adaptive transformed paths independent of the line backend

Adaptive subdivision is performed inside `getCachedTransformedPath2D`, which only runs for real Canvas contexts with `Path2D`. With WebGL line rendering enabled by default, `PolylineCaptureContext` receives the immediate non-adaptive samples instead.

Required change:

- Generate adaptive transformed polylines before dispatching to Canvas or WebGL.
- Cache the backend-neutral geometry using transformation, viewport, and tolerance inputs.

Complete when the same curve receives the same adaptive sample points in Canvas and WebGL line modes.

### 11. Preserve or explicitly reject Canvas line semantics in WebGL batching

The capture context records joins, caps, alpha, and compositing state, but WebGL batches retain only points, color, width, and alpha. Each segment is tessellated as an independent rectangle, and blending is fixed. Curves can therefore have gaps or spikes at joins, incorrect endpoints, and different compositing.

Required change:

- Implement the required join, cap, and compositing semantics in WebGL tessellation, or
- Mark unsupported state combinations and draw those batches directly with Canvas.

Complete when supported WebGL lines visually match the Canvas reference and unsupported styles never enter the WebGL batcher.

### 12. Keep Three.js Riemann-sphere opacity under animation control

`updateGeometry(progress)` computes eased ghost-sphere opacity, then `render()` resets it to full configured opacity. The transformation controller calls these in that order, so the intended fade is lost.

Required change:

- Make `render()` side-effect-free with respect to animation state.
- Apply configured maximum opacity inside the animation calculation rather than overwriting the result during drawing.

Complete when opacity follows the requested progress for the entire transition.

### 13. Fade rectangular grid axes independently

The renderer can choose different `stepX` and `stepY` values for unequal axis spans, but both line groups use opacity derived from `stepX * scaleX`. Horizontal-grid fading can therefore be driven by vertical-grid spacing.

Required change:

- Calculate vertical-line opacity from X spacing and horizontal-line opacity from Y spacing.
- Draw the two groups with their own fade values.

Complete when changing only one axis span affects only the corresponding grid-line density and fade.

### 14. Recover from failed final domain-worker tiles

When a domain-coloring worker tile fails, the pass counter is decremented without retrying the tile. If the failure occurs in the final progressive pass, the completed signature can remain active while the published image contains a permanent hole.

Required change:

- Retry failed tiles with a bounded policy, or invalidate and restart the affected pass.
- Publish a pass as complete only after every tile has succeeded or an explicit whole-pass fallback has replaced it.

Complete when an injected final-pass tile failure either recovers or invalidates the render; it must not leave a completed image with missing pixels.

### 15. Advance particles by elapsed time

Particle lifetime and travel distance advance by fixed amounts per animation frame. Motion speed and lifetime therefore change with refresh rate and frame drops.

Required change:

- Use bounded elapsed time for integration and lifetime.
- Keep simulation units independent of display refresh rate.

Complete when equal simulated time produces equivalent particle positions and expiration at 30, 60, and 120 Hz.

## Priority 2 — Repeated work and resource growth

### 16. Cache Cauchy analysis and DOM output

Every application redraw calls `performCauchyAnalysis`. While the feature is active, this regenerates the contour, performs the numerical integral, may estimate residues, and replaces result DOM even when its inputs have not changed. Animation and asynchronous redraws repeat the same analysis.

Required change:

- Cache numerical results by expression, contour, analysis settings, and required view-dependent inputs.
- Recompute and update the DOM only when that key or the displayed result changes.

Complete when unrelated redraws perform no Cauchy sampling and no result-DOM replacement.

### 17. Share real-plot scalar samples between 3D and contour rendering

A deferred redraw samples the real plot once for the 3D surface and independently again for the 2D contour plot. The contour path can sample up to `768 × 768`, while the surface separately samples its own grid.

Required change:

- Introduce a scalar-field cache keyed by expression/map, viewport, output mode, and resolution.
- Reuse compatible samples or derive lower-resolution consumers from a shared higher-resolution field.
- Invalidate the cache only when one of those inputs changes.

Complete when a redraw that needs both views evaluates each required scalar sample at most once.

### 18. Replace the fixed image mesh with error-driven geometry

Image rendering rounds the requested resolution to fixed mesh sizes. Common tiers create roughly 102,400 to 589,824 vertices and up to 3,529,734 indices; the CPU fallback can still transform 147,456 vertices in JavaScript and upload the full mesh. Most of this work is unnecessary in smooth regions and insufficient near singularities.

Required change:

- Use the discontinuity-aware adaptive mesh from Priority 0 for both correctness and workload control.
- Set explicit vertex, subdivision, and frame-time budgets.
- Reuse topology while only coefficient uniforms change and the topology remains valid.

Complete when smooth maps use substantially fewer vertices while singular regions receive additional local subdivision without exceeding the work budget.

### 19. Preserve image renderer resources across structural updates where possible

`invalidateImageRendererForDynamicAlgebra` disposes the complete renderer on structural hash changes. That recreates programs, buffers, texture state, and context-owned resources and reuploads the source image even when only the mapping program must change.

Required change:

- Separate program invalidation from texture, buffer, and renderer lifetime.
- Recompile only the affected mapping program and retain reusable source-image and mesh resources.

Complete when an expression-structure change does not recreate unrelated GPU resources or reupload an unchanged source texture.

### 20. Remove the Canvas-to-WebGL-to-Canvas raster fallback

`drawWithWebGLRaster` renders into an offscreen 2D canvas, uploads that raster to WebGL, draws a textured quad, and composites the result back into Canvas. Several hybrid shape and overlay paths still use this sequence even though it adds copies without changing the geometry.

Required change:

- Draw captured/fallback content directly with Canvas when vector WebGL capture is unavailable.
- Retain an offscreen raster path only for a measured feature such as intentional supersampling, without an unnecessary WebGL round trip.

Complete when fallback rendering performs no raster upload unless a documented visual feature requires it.

### 21. Stop continuous Three.js work for static scenes

`renderThreeWPlane` calls `updateGeometry(1)` on application redraws and starts an indefinite animation loop. Orbit controls use damping, while a separate Riemann-transformation loop can also continue updating and rendering both spheres while the feature is enabled even when neither animation is playing.

Required change:

- Track dirty geometry and update it only when transformation inputs change.
- Render on input, resize, active animation, and the short damping tail after interaction.
- Stop every request-animation-frame loop when no animation, interaction, or dirty state remains.

Complete when an idle static scene produces no continuing geometry uploads or animation frames.

### 22. Emit one redraw per completed domain tile/pass update

The domain worker path requests a redraw inside `drawPassToTarget` and immediately requests another from `handleTileMessage`. The scheduler can convert the second request into an extra full application frame.

Required change:

- Assign redraw ownership to one layer of the worker pipeline.
- Coalesce multiple tile completions that arrive before the next frame.

Complete when one publication event schedules at most one application redraw.

### 23. Check the transformation-graph cache before generating graph data

Transformation graph data is regenerated before the renderer compares its cache key. Candidate point sets are rebuilt, functions are evaluated across the sampling grid, and output points are sorted even when the graph inputs are unchanged.

Required change:

- Build a cheap input key before sampling.
- Cache the generated graph data outside the renderer update and skip generation when the key matches.

Complete when unrelated redraws do not evaluate or sort transformation-graph samples.

### 24. Bound compiled-expression and WebGL program caches

Domain-coloring program caches grow for every structural expression and are never evicted or deleted. Z and W renderers are created eagerly even though the active planar domain-coloring call path uses Z. Real-plot expressions are also stored in two unbounded caches, including failed compilations.

Required change:

- Use bounded per-context LRU caches and call `deleteProgram` on WebGL eviction.
- Create the W domain-coloring renderer only when a W caller requires it.
- Consolidate real-plot compilation caching into one bounded cache with a defined policy for failures.

Complete when repeated editing has a stable upper bound on retained programs and compiled expressions.

### 25. Make zeta curve subdivision segment-local and screen-error driven

`calculateDynamicPointsForSegment` projects the zeta pole onto the infinite supporting line without clamping the projection parameter to the segment. It can therefore evaluate refinement points outside the requested segment. Its sample count is then driven mainly by mapped magnitude rather than projected curve error, producing unstable and sometimes excessive work.

Required change:

- Clamp all refinement parameters to the source segment.
- Subdivide using projected midpoint/curvature error shared by Canvas and WebGL paths.
- Apply explicit per-curve and per-frame work limits while preserving segment endpoints.

Complete when off-segment poles do not increase sampling and zoom-equivalent curves receive comparable screen-space accuracy within the configured budget.