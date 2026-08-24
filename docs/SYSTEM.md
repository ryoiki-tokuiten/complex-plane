# Complex Function Analysis — System Definition

_**This file is the living source of truth for the complex-plane architecture.** The interactive isometric atlas and SYSTEM.md are generated synchronously from this single dataset._

_Question status: **2 open · 1 routed · 12 resolved**._

## One paragraph

The Complex Function Analysis platform is a zero-backend, client-side web application for interactive exploration, mapping, and calculus of complex-valued functions $w = f(z)$. The system couples an AST expression compiler and WebAssembly C arithmetic core (ABI v2) to a hybrid multi-canvas renderer (Canvas 2D, WebGL shader warpers, and Three.js 3D scenes). It supports domain coloring, Cauchy contour integrals, Riemann sphere stereographic projections, vector streamline advection, Laplace s-plane surfaces, and 3Blue1Brown-style spectral winding visualizers.

## Decisions locked

| Axis | Decision | ADR |
|---|---|---|
| Compute Architecture | Compile performance-critical math to **WebAssembly C core (ABI v2)** with linear memory buffers, falling back to JS AST compilation for dynamic user expressions. | [ADR-001] Native WASM Execution Bridge |
| Rendering Strategy | Adopt a **hybrid multi-tier canvas pipeline**: Canvas 2D for lightweight responsive grids/overlays, WebGL texture meshes for image warping, and Three.js for 3D Riemann spheres and Laplace surfaces. | [ADR-002] Multi-Context Hybrid Rendering |
| State Reactivity | Manage application parameters through **Preact Signals (`@preact/signals`)** and a centralized event bus, decoupled from DOM elements via a bidirectional sync controller. | [ADR-003] Preact Signal Observable Store |
| Frame Scheduling | Implement a **coalescing RAF redraw scheduler** (`redraw-scheduler.js`) with dirty-flag caching to batch rapid updates. | [ADR-004] RequestAnimationFrame Redraw Scheduler |
| Domain Coloring Offloading | Offload heavy pixel-by-pixel complex argument/magnitude computations to **dedicated Web Worker threads** (`domain-dynamics-worker.js`) so pixel work runs outside the main UI thread. | [ADR-005] Dedicated Web Worker Domain Coloring |
| Analytic Continuation | Resolve multi-valued functions ($log z, z^{1/n}$) using **sheet-indexed Riemann surfaces** and branch ray tracking rather than arbitrary branch cuts. | [ADR-006] Riemann Sheet Branch Tracking |

## Performance and Resource Model

### Runtime Performance Model
- **Planar Evaluation:** Ordinary planar geometry can use native point and line evaluators; timing is not recorded here.
- **Domain Coloring:** `domain-dynamics-worker.js` renders viewport tiles and transfers RGBA pixel buffers; timing is not recorded here.
- **WebGL Image Mesh Warper:** Image and video warping use WebGL mesh rendering; timing is not recorded here.
- **Cauchy Contour Integration:** Contour analysis uses native contour and integration routines; timing is not recorded here.
- **Memory Footprint:** Native bridge calls allocate temporary WASM buffers and free them after each call; no fixed runtime cap is stated here.

## Deep dives

### Core Architecture Modules
- [js/native/complex-engine.js](file:///home/roshan/Documents/Projects/complex-plane/js/native/complex-engine.js) — WASM loader and memory-mapped C ABI bridge.
- [js/math/active-map.js](file:///home/roshan/Documents/Projects/complex-plane/js/math/active-map.js) — Mapping stage pipeline & derivative order dispatcher.
- [js/rendering/application-renderer.js](file:///home/roshan/Documents/Projects/complex-plane/js/rendering/application-renderer.js) — Multi-canvas lifecycle orchestrator.
- [js/analysis/cauchy.js](file:///home/roshan/Documents/Projects/complex-plane/js/analysis/cauchy.js) — Contour integration & winding number classification.
- [js/rendering/domain-dynamics-worker.js](file:///home/roshan/Documents/Projects/complex-plane/js/rendering/domain-dynamics-worker.js) — Offscreen worker domain coloring engine.

## Reading order (the atlas chapters)

1. **1. The Core Mapping (z to w)** — Input complex numbers on the z-plane, evaluate $w = f(z)$, and render transformed grids on the w-plane. _(adds U, VP, AM, P2)_
2. **2. Reactive State & Frame Cycle** — Preact signals and a central event bus synchronize parameter mutations into batched RAF frame updates. _(adds ST, EV, RS, AR)_
3. **3. The Native WASM Core** — Custom expressions parse to ASTs and evaluate through the WebAssembly C core. _(adds EX, CE)_
4. **4. Roots, Poles & Cauchy Residues** — Automated root-finding and contour integration reveal poles, critical points, residues, and winding numbers. _(adds FD, CA, PR)_
5. **5. Continuous Flows & Dynamics** — Complex derivatives model fluid velocity fields, particle trajectories, and conformal distortions. _(adds DY, VF, TS)_
6. **6. Domain Coloring & Texture Warping** — Native worker tiles and GPU texture meshes provide two separate dense-visualization paths. _(adds DC, WG)_
7. **7. 3D Geometry & Riemann Sheets** — Multi-valued functions and stereographic projections expand into 3D Riemann spheres and multi-sheet surfaces. _(adds T3, BC)_
8. **8. Spectral Transforms & 3b1b Winders** — Fourier and Laplace transforms unroll into winding frequency animations and 3D s-plane convergence surfaces. _(adds TF, 3B)_
9. **9. Deep Fractals & Perturbation** — Dedicated deep-zoom perturbation algorithms and WebGPU compute explore infinite fractal boundaries. _(adds MB)_
10. **10. The Whole System** — All 18 structures unified in one explorable interactive architecture diagram.

## Structures

### 1. UI & Interaction Surface

#### U · UI & Controls

**In one line.** Hybrid Preact and legacy-DOM control surface for function selection, parameters, and display modes.

**What it does.** The main user interface sidebar and top bar where you select mathematical functions ($w = \cos(z)$, polynomials, Möbius transforms), drag parameter sliders ($a_0, b_0, r$), customize polynomial coefficients, and toggle visualization overlays.

**How it's built.** Built from Preact islands in `js/frontend/` plus legacy DOM handlers in `js/ui/event-listeners.js`. Both write the signal-backed store; `ui-sync-controller.js` synchronizes selected state back to DOM controls.

**Steps in execution.**

1. **Input Event** — User interacts with a Preact control or a legacy DOM control.
2. **State Mutation** — Updates a top-level signal-backed value or uses `mutateState` for nested data.
3. **UI Sync** — State subscriptions update the relevant DOM controls and titles.
4. **Redraw Request** — Routes a UI or domain invalidation through the redraw scheduler.
5. **UI Reflect** — Reflects current mathematical expression in MathML / LaTeX display.

**Questions.**

- ~~**Q-U1** How are polynomial coefficient inputs validated?~~ ✓ Parsed to numeric floats with fallback to 0.0 + 0.0i on invalid input (2026-02-10).
- **Q-U2** Should we add a visual expression graph builder for chained transformations?

#### VP · Viewport & Nav

**In one line.** Bidirectional coordinate transformation engine bridging screen pixels and complex plane coordinates.

**What it does.** Translates mouse/touch gestures (panning, scrolling, pinch-to-zoom) on the canvas into complex plane windows $[x_{min}, x_{max}] \times [y_{min}, y_{max}]$, maintaining strict aspect ratios and precision.

**How it's built.** Implemented in `js/navigation-plane.js` and `js/utils/canvas-utils.js`. Provides `mapCanvasToWorldCoords()` and `mapToCanvasCoords()` with high-precision sub-pixel scaling for both z-plane and w-plane.

**Steps in execution.**

1. **Pointer Event** — Captures wheel or drag delta on Canvas context.
2. **Transform Calc** — Recomputes `currentVisXRange` and `currentVisYRange`.
3. **Grid Refit** — Calculates optimal tick spacing and axis offsets.
4. **Notify Scheduler** — Routes a UI or domain redraw request through the centralized scheduler.

**Questions.**

- ~~**Q-VP1** How is aspect ratio preserved during canvas resize?~~ ✓ Locks viewport height to width ratio based on canvas aspect ratio bounds (2026-01-18).

#### PR · Hover Probe & Tooltip

**In one line.** Interactive cursor probe sampling local neighborhood, derivative $f'(z)$, and singularity proximity.

**What it does.** A magnifying probe that tracks your cursor over the complex plane, displaying the exact input $z = x+iy$, mapped output $w = f(z)$, local derivative $f'(z)$, conformal magnification $|f'(z)|$, rotation angle $\arg(f'(z))$, and nearby singularities.

**How it's built.** Managed in `js/ui/tooltip.js` and `js/main.js` (`setupCanvasTooltipEvents`). Queries `resolveActiveMap()` and `findNearestDynamicSample()` to format live mathematical tooltips.

**Steps in execution.**

1. **Cursor Move** — Receives cursor position on z-plane or w-plane.
2. **World Map** — Converts pixel coordinate to complex number $z = x+iy$.
3. **Neighborhood Eval** — Evaluates $f(z)$, $f'(z)$, and checks proximity to poles/zeros.
4. **Render Overlay** — Draws circular probe ring and formatted tooltip balloon.

**Questions.**

- ~~**Q-PR1** Is probe active during 3D Riemann sphere viewing?~~ ✓ Yes, uses raycasting to project cursor onto sphere surface coordinates (2026-02-04).

### 2. Reactive State & Runtime

#### ST · Observable Store

**In one line.** Central reactive state tree containing mathematical parameters, active modes, and cache keys.

**What it does.** The single source of runtime truth holding parameters ($a_0, b_0, circleR, mobiusA\dots D$), selected function name, chaining mode, active display views (Fourier, Laplace, Split, Sphere), and analytical caches.

**How it's built.** Defined in `js/store/state.js` and wrapped by `createObservableStore()` using `@preact/signals`. Top-level keys are signal-backed; nested changes use explicit `mutateState`/`touch` notifications.

**Steps in execution.**

1. **State Read** — Components read reactive signals directly.
2. **State Write** — Top-level writes update signals; nested writes use `mutateState`.
3. **Redraw Invalidation** — Rendering callers explicitly request UI or domain invalidation.
4. **Cache Invalidation** — Rebuilds parameter signature keys.

**Questions.**

- **Q-ST1** How are undo/redo states recorded? → _State history deep dive_

#### EV · Event Bus & Sync

**In one line.** Decoupled pub/sub event router coordinating UI components and rendering controllers.

**What it does.** Bridges legacy DOM event listeners, Preact signals, and animation loops without tight coupling, dispatching events when functions change, parameters shift, or viewports resize.

**How it's built.** Implemented in `js/store/events.js` (`eventBus`) and `js/frontend/controllers/ui-sync-controller.js`. The bus carries redraw signals such as `redraw:all` and `redraw:domain`; state subscriptions handle UI and cache synchronization.

**Steps in execution.**

1. **Event Emit** — Controller emits typed event payload.
2. **Listener Dispatch** — Invokes registered listener callbacks synchronously.
3. **State Reconciliation** — Synchronizes DOM input elements with reactive state.
4. **Trigger Redraw** — Notifies redraw scheduler of visual changes.

#### RS · Redraw Scheduler

**In one line.** RAF-based coalescing render scheduler that prevents duplicate frame requests.

**What it does.** Batches multiple incoming UI or domain invalidations into a single `requestAnimationFrame` render pass and carries a domain-color dirty bit across queued frames.

**How it's built.** Implemented in `js/rendering/redraw-scheduler.js`. Configured with `renderApplicationFrame` and exposes `requestUiRedraw()`, `requestDomainRedraw()`, and the lower-level `requestRedrawAll()`.

**Steps in execution.**

1. **Redraw Request** — State-changing modules call the centralized UI or domain request entry point.
2. **RAF Batching** — Schedules single `requestAnimationFrame` callback if idle.
3. **Frame Exec** — Executes `renderApplicationFrame(timestamp)`.
4. **Surface Delay** — Schedules debounced 90ms deferred redraw for heavy 3D surfaces.

**Questions.**

- ~~**Q-RS1** What is the surface redraw debounce threshold?~~ ✓ The application renderer configures a 90ms delay and a 240ms max-wait ceiling.

### 3. Math Engine & Compilation

#### EX · Expression Compiler

**In one line.** Custom AST tokenizer and compiler generating JIT JavaScript, GLSL shader code, and native expression programs.

**What it does.** Parses mathematical formula strings (e.g. `sin(z) + z^2 - 1/z`), tokenizing expressions into an Abstract Syntax Tree (AST) that compiles into JavaScript functions, WebGL GLSL shaders, MathML markup, or native expression programs.

**How it's built.** Located in `js/math/expression/` (`parser.js`, `evaluator.js`, `glsl.js`, `mathml.js`, `product-term.js`). Supports complex arithmetic operator precedence, transcendental functions, and product series.

**Steps in execution.**

1. **Tokenize** — Lexes expression string into numeric, variable, and operator tokens.
2. **Parse AST** — Constructs recursive AST node hierarchy.
3. **Type Check** — Validates complex operations and branch constraints.
4. **Codegen** — Emits optimized JavaScript evaluator or GLSL shader code string.

**Questions.**

- ~~**Q-EX1** Does the parser support arbitrary user variables?~~ ✓ Supports z, c, time t, and indexed constants a0..an (2026-01-29).

#### CE · Native WASM Engine

**In one line.** WebAssembly C core (ABI v2) computing complex arithmetic, transcendental functions, and series.

**What it does.** The compiled C calculation engine for point evaluations, complex polynomials, Riemann Zeta analytic continuation, Bessel functions, gamma functions, and Durand-Kerner polynomial root-finding.

**How it's built.** Built from `native/src/` into `native/build/complex_engine.wasm` (ABI v2). Loaded via `js/native/complex-engine.js` with direct linear memory buffer access.

**Steps in execution.**

1. **Memory Alloc** — Allocates input, output, and validity buffers in WASM linear memory.
2. **Configure Map** — Populates C `MapConfig` struct with active function parameters.
3. **Native Exec** — Calls the point-evaluation export (`ce_evaluate_points`).
4. **Read Results** — Copies output complex values and validity flags into JavaScript values.

**Questions.**

- ~~**Q-CE1** What happens when ABI version mismatches?~~ ✓ Throws explicit fatal error if wasm.ce_abi_version() !== 2 (2026-01-15).
- **Q-CE2** Can we enable WebAssembly SIMD-128 instructions in production builds?

#### AM · Active Map Engine

**In one line.** Active mapping dispatcher resolving transformation pipelines, derivative orders, and algebraic chaining.

**What it does.** The mathematical traffic controller. It takes the current function setting (single function, algebraic sum, chained composition $f(g(z))$, or derivative presentation $f'(z)$) and constructs the active evaluator pipeline.

**How it's built.** Implemented in `js/math/active-map.js` and `js/native/map-runtime.js`. Exposes `resolveActiveMap()`, returning cached evaluators for $f(z)$, first derivative $f'(z)$, and second derivative $f''(z)$.

**Steps in execution.**

1. **Resolve Stage** — Identifies active function type, parameters, and derivative order.
2. **Signature Check** — Compares source signature with cached evaluator.
3. **Instantiate** — Constructs native or JIT evaluator wrapper.
4. **Return Dispatcher** — Returns `{ evaluate, evaluateBatch, derivative, signature }`.

**Questions.**

- ~~**Q-AM1** How are chained stages composed?~~ ✓ Evaluates sequentially: stage 0 output becomes stage 1 input up to chainCount - 1 (2026-02-01).

### 4. Analysis & Calculus Pipeline

#### FD · Feature Detection

**In one line.** Grid sampling algorithms locating zeros (roots), poles (singularities), and critical points ($f'(z)=0$).

**What it does.** Scans the visible complex plane grid to locate mathematical features: roots where $f(z) = 0$, poles where $|f(z)| \to \infty$, branch cuts, and critical points where derivative $f'(z) = 0$, clustering duplicate detections into discrete points.

**How it's built.** Implemented in `js/analysis/feature-detection.js`. Uses native root-finding algorithms from `complex-engine.js` with adaptive grid search and viewport-based distance threshold clustering.

**Steps in execution.**

1. **Grid Sampling** — Generates 2D sampling grid across visible viewport ranges.
2. **Gradient Check** — Identifies local minima of $|f(z)|$ and $|f'(z)|$, and maxima of $|f(z)|$.
3. **Newton Refine** — Applies Newton-Raphson iterations to converge on precise root coordinates.
4. **Cluster & Classify** — Merges nearby points within tolerance and assigns multiplicity/order.

**Questions.**

- ~~**Q-FD1** How are duplicate poles merged across grid boundaries?~~ ✓ Distance-factor clustering merges candidates within viewport-scaled epsilon (2026-01-30).

#### CA · Cauchy & Contours

**In one line.** Contour integration $\oint_C f(z)dz$, Cauchy residue calculation, and winding number classification.

**What it does.** Calculates path integrals $\oint_C f(z) dz$ along user-drawn contours or standard geometric shapes (circles, ellipses), evaluating Cauchy's Integral Formula, computing residues at enclosed poles, and displaying the topological winding number.

**How it's built.** Built in `js/analysis/cauchy.js` and `js/analysis/contours.js`. Uses `analyzeNativeContour()` and `classifyNativeContourSingularities()` in WASM with `NUM_INTEGRAL_STEPS = 1024`.

**Steps in execution.**

1. **Contour Discretize** — Samples 1,024 equidistant points along path $z(t)$.
2. **Numerical Integral** — Computes $\sum f(z_k) \cdot \Delta z_k$ via trapezoidal rule.
3. **Enclosed Poles** — Tests enclosed singularities via Jordan winding number.
4. **Residue Theorem** — Verifies $\oint_C f(z) dz = 2\pi i \sum \text{Res}(f, z_k)$ and displays result.

**Questions.**

- ~~**Q-CA1** How is contour self-intersection handled?~~ ✓ Winding number is computed per topological region using ray casting (2026-02-08).

#### DY · Dynamic Plotting

**In one line.** Numerical ODE trajectory integrator and dynamic particle solver on the complex plane.

**What it does.** Simulates dynamical systems and differential equations on the complex plane, tracing particle orbits $z(t)$, phase portraits, and iterative recurrence sequences $z_{n+1} = g(z_n)$.

**How it's built.** Built in `js/analysis/dynamic-plotting.js` and rendered via `js/rendering/draw-dynamic-plotting.js`. Supports Runge-Kutta numerical integration and orbit color mapping.

**Steps in execution.**

1. **Seed Init** — Spawns test particles across grid or user probe coordinates.
2. **ODE Step** — Integrates differential step $z_{t+\Delta t} = z_t + f(z_t) \Delta t$.
3. **Trace Orbit** — Accumulates trajectory polyline buffer.
4. **Render Path** — Draws glow-trail paths on z-plane and w-plane.

#### TF · Integral Transforms

**In one line.** Continuous/discrete Fourier transforms and Laplace transforms with s-plane ROC analysis.

**What it does.** Analyzes frequency domain characteristics: Fourier transforms $F(\omega) = \int f(t) e^{-i\omega t} dt$ and Laplace transforms $F(s) = \int f(t) e^{-st} dt$, identifying poles, zeros, and Region of Convergence (ROC) on the complex s-plane.

**How it's built.** Implemented in `js/analysis/fourier-transform.js` and `js/analysis/laplace-transform.js`. Computes continuous winding integrals and generates 3D surface mesh data.

**Steps in execution.**

1. **Time Signal** — Discretizes source time-domain signal $f(t)$.
2. **Complex Exponential** — Multiplies by kernel $e^{-st} = e^{-(\sigma + i\omega)t}$.
3. **Integrate** — Computes cumulative complex sum over interval $[0, T]$.
4. **ROC Classification** — Determines convergence boundary $\text{Re}(s) > \sigma_0$.

**Questions.**

- ~~**Q-TF1** How are Laplace transform poles visualized in 3D?~~ ✓ Rendered as high-peak singular columns in Three.js |F(s)| heightfield (2026-02-12).

#### VF · Vector Fields & Streamlines

**In one line.** Complex potential flow analysis, Cauchy-Riemann velocity field mapping, and particle advection.

**What it does.** Treats the complex function as a 2D fluid velocity potential, converting derivative values $f'(z) = u - iv$ into velocity vector fields $\vec{V} = (u, -v)$ and animating thousands of flowing streamlines across the grid.

**How it's built.** Implemented in `js/analysis/streamline.js` and `js/rendering/draw-planar.js` (`drawStreamlinesOnZPlane`, `updateAndDrawParticles`). Uses fourth-order Runge-Kutta streamline tracing.

**Steps in execution.**

1. **Derivative Field** — Samples complex derivative $f'(z)$ at regular grid nodes.
2. **Velocity Vector** — Decomposes into flow components $v_x = \text{Re}(f'), v_y = -\text{Im}(f').$
3. **Streamline Trace** — Integrates forward and backward stream paths.
4. **Particle Advection** — Animates dynamic tracer particles along flow vectors.

#### TS · Tissot & Conformal

**In one line.** Tissot indicatrices visualizing conformal angle preservation and local scaling/rotation distortion.

**What it does.** Places tiny circles across the z-plane and maps them through $f(z)$ to the w-plane to demonstrate conformality: holomorphic maps preserve local orthogonality ($90^\circ$ angles) and scale circles into scaled/rotated circles, degenerating only at critical points.

**How it's built.** Built in `js/analysis/tissot.js` and rendered by `drawConformalIndicatrices()` in `draw-planar.js`. Computes singular value decomposition (SVD) of the Jacobian matrix.

**Steps in execution.**

1. **Circle Placement** — Deploys grid of infinitesimal test circles on z-plane.
2. **Jacobian Eval** — Computes local Jacobian $\begin{pmatrix} u_x & u_y \\ v_x & v_y \end{pmatrix}$ via Cauchy-Riemann equations.
3. **Ellipse Map** — Transforms circles to output ellipses on w-plane.
4. **Distortion Metrics** — Calculates area expansion factor $|f'(z)|^2$ and rotation $\arg(f'(z))$.

#### BC · Riemann Surfaces & Branching

**In one line.** Multi-sheet branch tracking, branch cut crossings, and Riemann surface mesh construction.

**What it does.** Handles multi-valued complex functions like $\log(z)$, $\sqrt{z}$, or $z^{1/n}$ by constructing multi-sheeted Riemann surfaces, tracking winding count around branch points and connecting adjacent sheets seamlessly.

**How it's built.** Implemented in `js/analysis/riemann-surface.js` and `js/analysis/branch-continuation.js`. Builds multi-layer 3D surface meshes for WebGL and Three.js rendering.

**Steps in execution.**

1. **Branch Point Check** — Locates branch points where multi-valued behavior originates.
2. **Sheet Indexing** — Assigns winding index $k \in \{0, 1, \dots, n-1\}$ based on path integration.
3. **Mesh Generation** — Constructs helical 3D surface geometry.
4. **Shader Pass** — Renders intersecting sheets with transparency and color-coded layers.

**Questions.**

- ~~**Q-BC1** How many sheets are generated for fractional power n = 1/3?~~ ✓ Constructs exactly 3 interlocking Riemann sheets with smooth phase boundary transitions (2026-02-14).

### 5. Multi-Tier Rendering Layer

#### AR · Application Renderer

**In one line.** Top-level frame coordinator orchestrating multi-pass rendering across planar, 3D, and transform views.

**What it does.** The conductor of the visual pipeline. On each animation frame, it triggers feature detection, updates Cauchy analysis, draws the 2D z-plane and w-plane, synchronizes optional 3D columns, and redraws Riemann spheres.

**How it's built.** Implemented in `js/rendering/application-renderer.js` (`renderApplicationFrame`). Calls `drawZPlaneContent()`, `drawWPlaneContent()`, `drawLaplace3DSurface()`, and `drawRealPlot()`.

**Steps in execution.**

1. **Frame Start** — Receives timestamp from requestAnimationFrame.
2. **Analysis Pass** — Runs feature detection (zeros, poles, critical points, Cauchy).
3. **Planar Pass** — Draws 2D canvas layers for z-plane and w-plane.
4. **3D & Transform Pass** — Renders active 3D Three.js surfaces and winding plots.

#### P2 · 2D Planar Canvas

**In one line.** High-DPI Canvas 2D renderer for input $z$-plane and output $w$-plane grids and shapes.

**What it does.** Renders the primary side-by-side interactive planes: Cartesian, polar, and hyperbolic grids, input shapes (circles, lines, polygons), transformed curves $f(C)$, Taylor series approximations, and hover probe markers.

**How it's built.** Built in `js/rendering/draw-planar.js` and `js/rendering/canvas-primitives.js`. Uses supersampled 2D context drawing with subpixel path rendering.

**Steps in execution.**

1. **Clear & Axes** — Clears canvas and draws axes, ticks, and grid lines.
2. **Input Shape** — Draws input geometric paths on z-plane.
3. **Transform Map** — Maps vertices through `activeMap.evaluate()` and draws deformed w-plane curves.
4. **Markers & Overlays** — Overlays zeros, poles, critical markers, and probe crosshairs.

#### DC · Domain Dynamics

**In one line.** Complex color wheel renderer mapping phase $\arg(w)$ to hue and magnitude $|w|$ to lightness.

**What it does.** Generates continuous domain coloring where every point in the complex plane is assigned a distinct color: phase angle $\theta = \arg(f(z))$ determines the hue (rainbow cycle), while magnitude $|f(z)|$ determines brightness with contour rings.

**How it's built.** Implemented in `js/rendering/domain-coloring.js` with native tile rendering in `domain-dynamics-worker.js`. The worker returns RGBA pixel buffers; the main thread wraps each tile in `ImageData` and commits it to a staging canvas.

**Steps in execution.**

1. **Worker Dispatch** — Sends viewport bounds, palette mode, and function config to web worker.
2. **Buffer Compute** — Worker computes a tile RGBA pixel buffer off the main thread.
3. **Post Message** — Transfers the tile `pixels.buffer` back to the main thread.
4. **Blit Canvas** — Wraps the buffer in `ImageData`, stages the tile, and commits the final canvas.

#### WG · WebGL Image Warper

**In one line.** GPU texture mesh deformation warping input images and video frames from $z$ to $w$.

**What it does.** Maps arbitrary user images or webcam video feeds onto the z-plane and deforms the entire quadrilateral mesh through complex function $w = f(z)$ in real-time WebGL vertex and fragment shaders.

**How it's built.** Built in `js/rendering/draw-image-webgl.js` and `webgl-shared.js`. Creates a $64 \times 64$ quadrilateral mesh with texture coordinates and evaluates transformations directly on the GPU.

**Steps in execution.**

1. **Texture Upload** — Uploads image or video frame to WebGL texture unit.
2. **Mesh Gen** — Builds subdivided grid geometry with normalized UVs.
3. **Vertex Transform** — Evaluates mapping function in vertex shader or CPU batch buffer.
4. **Rasterize** — Draws textured warped triangles with bilinear interpolation.

#### T3 · Three.js 3D Engine

**In one line.** 3D WebGL scene rendering stereographic Riemann spheres, Laplace $|F(s)|$ heightfields, and folded surfaces.

**What it does.** Renders rich 3D mathematical surfaces: the Riemann Sphere (compactification of $\mathbb{C} \cup \{\infty\}$ via stereographic projection), 3D $|F(s)|$ Laplace transform terrain, and folded modular surfaces $|f(z)|$.

**How it's built.** Implemented in `js/rendering/three-riemann-renderer.js`, `laplace-3d-surface.js`, and `draw-sphere.js`. Employs Three.js scene graphs, orbit controls, custom shader materials, and dynamic mesh rebuilds.

**Steps in execution.**

1. **Scene Setup** — Initializes Three.js perspective camera, ambient lighting, and orbit controls.
2. **Stereographic Map** — Projects planar points $z = x+iy$ onto sphere $(\xi, \eta, \zeta) = \left(\frac{2x}{|z|^2+1}, \frac{2y}{|z|^2+1}, \frac{|z|^2-1}{|z|^2+1}\right)$.
3. **Mesh Heightfield** — Generates 3D vertex elevations $z = \ln(1 + |F(s)|)$.
4. **Render Pass** — Draws shaded 3D mesh with interactive mouse rotation.

#### 3B · Transform Winders

**In one line.** 3Blue1Brown-style winding frequency animations and center-of-mass spectral visualizers.

**What it does.** Visualizes the intuitive geometric meaning of Fourier and Laplace transforms: wraps a signal $f(t)$ around the origin at varying rotational frequencies $\omega$, tracking the path and the dynamic center of mass (centroid) as $\omega$ sweeps.

**How it's built.** Built in `js/rendering/draw-fourier-winding.js` and `draw-laplace-winding-3b1b.js`. Animates winding spirals, center-of-mass indicator dots, and frequency spectrum graphs.

**Steps in execution.**

1. **Signal Sample** — Extracts time-domain signal $f(t)$ array.
2. **Winding Wrap** — Calculates wrapped trajectory $g(t) = f(t) e^{-i 2\pi \omega t}$.
3. **Centroid Calc** — Computes center of mass $\bar{z} = \frac{1}{T} \int_0^T g(t) dt$.
4. **Draw Animation** — Draws winding curve with trailing glow and centroid marker.

### 6. Subsystems & Presets

#### MB · Mandelbrot Perturbation

**In one line.** Deep perturbation fractal engine with arbitrary-precision fixed-point math and WebGPU acceleration.

**What it does.** A dedicated subsystem for extreme deep-zoom Mandelbrot fractals ($10^{-100}$ scale) using perturbation series expansion around reference points and arbitrary-precision fixed-point arithmetic (`fxp.mjs`), with WebGPU compute pipelines.

**How it's built.** Located in `bertbaron_mandelbrot/` (`fxp.mjs`, `mandelbrotPerturbation.mjs`, `mandelbrotWebGPU.mjs`). Employs multi-worker parallel tiling and WebGPU compute shaders.

**Steps in execution.**

1. **Reference Orbit** — Calculates high-precision reference orbit $Z_n$ via arbitrary-precision float.
2. **Perturbation Delta** — Computes pixel delta iterations $\delta_{n+1} = 2 Z_n \delta_n + \delta_n^2 + \Delta c$ in standard floats.
3. **Worker Tile Pool** — Dispatches square tiles across multi-worker thread pool or WebGPU.
4. **Palette Blit** — Maps iteration counts to custom cyclic palette.

**Questions.**

- ~~**Q-MB1** Is WebGPU automatically used when available?~~ ✓ Detects navigator.gpu and falls back to Web Workers when unsupported (2026-01-25).

## Flows (representative packets)

Payload shapes represent the real runtime contracts and state objects passed across modules.

### 1. Planar Transformation Flow (z to w)

| # | From → To | Packet | Representative payload |
|---|---|---|---|
| 1 | U → ST | parameter update | `{"action":"setFunction","currentFunction":"cos","circleR":1.5}` |
| 2 | ST → EV | state mutation | `{"key":"currentFunction","value":"cos"}` |
| 3 | EV → RS | schedule invalidation | `{"kind":"domain","domainDirty":true}` |
| 4 | RS → AR | trigger frame | `{"frameId":402,"plane":"both"}` |
| 5 | AR → AM | resolve evaluator | `{"functionKey":"cos","derivativeOrder":0}` |
| 6 | AM → CE | native point evaluation | `{"export":"ce_evaluate_points","pointCount":1024}` |
| 7 | CE → AM | values and validity | `{"sampleZ":{"re":1,"im":0.5},"sampleW":{"re":0.81,"im":-0.46},"valid":true}` |
| 8 | AM → P2 | draw transformed curves | `{"meshSize":[15,15],"stage":0}` |
| 9 | P2 → U | frame painted | `{"canvas":"w-plane"}` |

### 2. Cauchy Residue & Contour Flow

| # | From → To | Packet | Representative payload |
|---|---|---|---|
| 1 | U → VP | draw contour | `{"type":"circle","center":{"re":0,"im":0},"radius":1.2}` |
| 2 | VP → CA | contour coordinates | `{"stepCount":1024,"closed":true}` |
| 3 | CA → FD | query singularities | `{"region":[-1.2,1.2,-1.2,1.2]}` |
| 4 | FD → CA | enclosed poles | `{"poles":[{"re":0,"im":0,"order":1,"residue":{"re":1,"im":0}}]}` |
| 5 | CA → PR | integral result | `{"integral":{"re":6.283,"im":0},"windingNumber":1}` |
| 6 | PR → AR | render probe overlay | `{"overlay":"residue_balloon","active":true}` |

### 3. Web Worker Domain Coloring Flow

| # | From → To | Packet | Representative payload |
|---|---|---|---|
| 1 | ST → DC | snapshot inputs | `{"palette":"arctic-frost","viewport":[512,512]}` |
| 2 | DC → AR | native worker tile | `{"jobId":1,"tileSize":256,"pixelBuffer":"transferred"}` |
| 3 | AR → P2 | commit staging canvas | `{"targetCanvas":"zDomainColorCanvas"}` |

### 4. Spectral & Laplace 3D Flow

| # | From → To | Packet | Representative payload |
|---|---|---|---|
| 1 | U → TF | select transform | `{"type":"laplace","signal":"damped_sine","decay":0.5,"freq":2}` |
| 2 | TF → 3B | winding trajectory | `{"frequencies":[0.5,1,2],"centroid":{"x":0.05,"y":-0.12}}` |
| 3 | TF → T3 | 3D s-plane heightfield | `{"poles":[{"s":{"re":-0.5,"im":2}}],"roc":"Re(s) > -0.5"}` |
| 4 | T3 → AR | composite 3D scene | `{"container":"laplace_3d_container","cameraRot":[0.4,0.8]}` |

## Questions — index

Reference by ID. ✓ resolved · → routed · otherwise open.

- ~~**Q-U1**~~ (U) ✓ Parsed to numeric floats with fallback to 0.0 + 0.0i on invalid input (2026-02-10).
- **Q-U2** (U) Should we add a visual expression graph builder for chained transformations?
- ~~**Q-VP1**~~ (VP) ✓ Locks viewport height to width ratio based on canvas aspect ratio bounds (2026-01-18).
- ~~**Q-PR1**~~ (PR) ✓ Yes, uses raycasting to project cursor onto sphere surface coordinates (2026-02-04).
- **Q-ST1** (ST) → _State history deep dive_ (How are undo/redo states recorded?)
- ~~**Q-RS1**~~ (RS) ✓ The application renderer configures a 90ms delay and a 240ms max-wait ceiling.
- ~~**Q-EX1**~~ (EX) ✓ Supports z, c, time t, and indexed constants a0..an (2026-01-29).
- ~~**Q-CE1**~~ (CE) ✓ Throws explicit fatal error if wasm.ce_abi_version() !== 2 (2026-01-15).
- **Q-CE2** (CE) Can we enable WebAssembly SIMD-128 instructions in production builds?
- ~~**Q-AM1**~~ (AM) ✓ Evaluates sequentially: stage 0 output becomes stage 1 input up to chainCount - 1 (2026-02-01).
- ~~**Q-FD1**~~ (FD) ✓ Distance-factor clustering merges candidates within viewport-scaled epsilon (2026-01-30).
- ~~**Q-CA1**~~ (CA) ✓ Winding number is computed per topological region using ray casting (2026-02-08).
- ~~**Q-TF1**~~ (TF) ✓ Rendered as high-peak singular columns in Three.js |F(s)| heightfield (2026-02-12).
- ~~**Q-BC1**~~ (BC) ✓ Constructs exactly 3 interlocking Riemann sheets with smooth phase boundary transitions (2026-02-14).
- ~~**Q-MB1**~~ (MB) ✓ Detects navigator.gpu and falls back to Web Workers when unsupported (2026-01-25).

## What the platform gives vs what we own

**Platform gives:** Modern browser runtime (WebAssembly linear memory, WebGL 1.0/2.0 context, Web Workers, Canvas 2D contexts, Web Audio / Media Streams).

**We own:** Custom complex math JIT evaluator, C WASM numerical library, algebraic parser/compiler, multi-sheet Riemann surface tracer, Cauchy contour integrator, 3b1b winding animators, and Preact reactive bridge.

## Filesystem layout

```
complex-plane/
  ├── index.html                   # Entry point and multi-canvas layout
  ├── js/
  │   ├── main.js                  # App bootstrap and lifecycle wiring
  │   ├── navigation-plane.js      # Pan/zoom and coordinate interaction
  │   ├── store/                   # Reactive state, observable store, events
  │   │   ├── state.js             # Core reactive state parameters
  │   │   ├── observable-store.js  # Preact signal store bindings
  │   │   ├── events.js            # Central event bus
  │   │   └── runtime.js           # Runtime state and renderer references
  │   ├── math/                    # AST parser, GLSL generator, active map
  │   │   ├── active-map.js        # Active mapping pipeline dispatcher
  │   │   └── expression/          # Parser, evaluator, mathml, glsl compilers
  │   ├── native/                  # WebAssembly bridge and C engine glue
  │   │   ├── complex-engine.js    # WASM memory bridge & ABI v2 exports
  │   │   ├── map-runtime.js       # Runtime evaluator dispatcher
  │   │   └── domain-engine.js     # Native domain coloring buffer manager
  │   ├── analysis/                # Mathematical analysis algorithms
  │   │   ├── feature-detection.js # Roots, poles, critical points finder
  │   │   ├── cauchy.js            # Contour integration & residue theorem
  │   │   ├── dynamic-plotting.js  # ODE particle trajectory integration
  │   │   ├── fourier-transform.js # Spectral analysis & winding
  │   │   ├── laplace-transform.js # Laplace s-plane ROC & 3D poles
  │   │   ├── streamline.js        # Complex potential velocity fields
  │   │   ├── tissot.js            # Conformal indicatrix distortion
  │   │   └── riemann-surface.js   # Branch cut continuation & sheet tracing
  │   ├── rendering/               # Canvas 2D, WebGL, Three.js renderers
  │   │   ├── application-renderer.js # Top-level render loop coordinator
  │   │   ├── redraw-scheduler.js  # Coalescing RAF scheduler
  │   │   ├── renderer.js          # Planar z/w orchestration
  │   │   ├── draw-planar.js       # Canvas 2D grid/shape drawing
  │   │   ├── domain-coloring.js   # Phase/magnitude color wheel
  │   │   ├── draw-image-webgl.js  # GPU texture mesh warper
  │   │   ├── three-riemann-renderer.js # 3D Riemann sphere engine
  │   │   ├── laplace-3d-surface.js # 3D |F(s)| landscape
  │   │   └── draw-fourier-winding.js # 3b1b winding animation
  │   ├── frontend/                # Preact reactive UI components
  │   └── ui/                      # DOM controllers, event listeners, tooltips
  ├── native/                      # C source code for complex_engine.wasm
  │   ├── src/                     # Core complex arithmetic, roots, series
  │   └── build/complex_engine.wasm # Compiled WASM binary
  ├── bertbaron_mandelbrot/        # Deep perturbation fractal subsystem
  └── docs/                        # System Atlas, SYSTEM.md, CONTEXT.md
```

## How this file is maintained

Generated from `docs/atlas/data.mjs` by `node docs/atlas/build.mjs`, which also builds the interactive atlas (`atlas.html`). Edit the data file, rebuild, republish — never edit this file by hand.
