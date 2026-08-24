// Single source of truth for the Complex Function Analysis & Visualization Atlas.
// Build: node docs/atlas/build.mjs  → writes docs/SYSTEM.md and docs/atlas.html

export const META = {
  title: 'Complex Function Analysis',
  artifactUrl: '',
  sourcePath: 'docs/atlas/data.mjs',
  buildCmd: 'node docs/atlas/build.mjs',
  stats: [
    { k: 'Engine', v: 'WASM (ABI v2) + WebGL + Three.js' },
    { k: 'UI Stack', v: 'Preact + Signals + Vanilla JS' },
    { k: 'Arch', v: 'Full Client-Side Zero Backend' }
  ],
  intro: `_**This file is the living source of truth for the complex-plane architecture.** The interactive isometric atlas and SYSTEM.md are generated synchronously from this single dataset._`,
  onePara: `The Complex Function Analysis platform is a zero-backend, client-side web application for interactive exploration, mapping, and calculus of complex-valued functions $w = f(z)$. The system couples an AST expression compiler and WebAssembly C arithmetic core (ABI v2) to a hybrid multi-canvas renderer (Canvas 2D, WebGL shader warpers, and Three.js 3D scenes). It supports domain coloring, Cauchy contour integrals, Riemann sphere stereographic projections, vector streamline advection, Laplace s-plane surfaces, and 3Blue1Brown-style spectral winding visualizers.`,
  costModel: [
    '### Runtime Performance Model',
    '- **Planar Evaluation:** Ordinary planar geometry can use native point and line evaluators; timing is not recorded here.',
    '- **Domain Coloring:** `domain-dynamics-worker.js` renders viewport tiles and transfers RGBA pixel buffers; timing is not recorded here.',
    '- **WebGL Image Mesh Warper:** Image and video warping use WebGL mesh rendering; timing is not recorded here.',
    '- **Cauchy Contour Integration:** Contour analysis uses native contour and integration routines; timing is not recorded here.',
    '- **Memory Footprint:** Native bridge calls allocate temporary WASM buffers and free them after each call; no fixed runtime cap is stated here.'
  ],
  deepDive: `### Core Architecture Modules
- [js/native/complex-engine.js](file:///home/roshan/Documents/Projects/complex-plane/js/native/complex-engine.js) — WASM loader and memory-mapped C ABI bridge.
- [js/math/active-map.js](file:///home/roshan/Documents/Projects/complex-plane/js/math/active-map.js) — Mapping stage pipeline & derivative order dispatcher.
- [js/rendering/application-renderer.js](file:///home/roshan/Documents/Projects/complex-plane/js/rendering/application-renderer.js) — Multi-canvas lifecycle orchestrator.
- [js/analysis/cauchy.js](file:///home/roshan/Documents/Projects/complex-plane/js/analysis/cauchy.js) — Contour integration & winding number classification.
- [js/rendering/domain-dynamics-worker.js](file:///home/roshan/Documents/Projects/complex-plane/js/rendering/domain-dynamics-worker.js) — Offscreen worker domain coloring engine.`,
  platformGives: 'Modern browser runtime (WebAssembly linear memory, WebGL 1.0/2.0 context, Web Workers, Canvas 2D contexts, Web Audio / Media Streams).',
  weOwn: 'Custom complex math JIT evaluator, C WASM numerical library, algebraic parser/compiler, multi-sheet Riemann surface tracer, Cauchy contour integrator, 3b1b winding animators, and Preact reactive bridge.',
  filesystem: `complex-plane/
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
  └── docs/                        # System Atlas, SYSTEM.md, CONTEXT.md`
};

export const DECISIONS = [
  {
    axis: 'Compute Architecture',
    decision: 'Compile performance-critical math to **WebAssembly C core (ABI v2)** with linear memory buffers, falling back to JS AST compilation for dynamic user expressions.',
    adr: '[ADR-001] Native WASM Execution Bridge'
  },
  {
    axis: 'Rendering Strategy',
    decision: 'Adopt a **hybrid multi-tier canvas pipeline**: Canvas 2D for lightweight responsive grids/overlays, WebGL texture meshes for image warping, and Three.js for 3D Riemann spheres and Laplace surfaces.',
    adr: '[ADR-002] Multi-Context Hybrid Rendering'
  },
  {
    axis: 'State Reactivity',
    decision: 'Manage application parameters through **Preact Signals (`@preact/signals`)** and a centralized event bus, decoupled from DOM elements via a bidirectional sync controller.',
    adr: '[ADR-003] Preact Signal Observable Store'
  },
  {
    axis: 'Frame Scheduling',
    decision: 'Implement a **coalescing RAF redraw scheduler** (`redraw-scheduler.js`) with dirty-flag caching to batch rapid updates.',
    adr: '[ADR-004] RequestAnimationFrame Redraw Scheduler'
  },
  {
    axis: 'Domain Coloring Offloading',
    decision: 'Offload heavy pixel-by-pixel complex argument/magnitude computations to **dedicated Web Worker threads** (`domain-dynamics-worker.js`) so pixel work runs outside the main UI thread.',
    adr: '[ADR-005] Dedicated Web Worker Domain Coloring'
  },
  {
    axis: 'Analytic Continuation',
    decision: 'Resolve multi-valued functions ($\log z, z^{1/n}$) using **sheet-indexed Riemann surfaces** and branch ray tracking rather than arbitrary branch cuts.',
    adr: '[ADR-006] Riemann Sheet Branch Tracking'
  }
];

export const GROUPS = [
  { id: 'ui', title: '1. UI & Interaction Surface' },
  { id: 'state', title: '2. Reactive State & Runtime' },
  { id: 'math', title: '3. Math Engine & Compilation' },
  { id: 'analysis', title: '4. Analysis & Calculus Pipeline' },
  { id: 'render', title: '5. Multi-Tier Rendering Layer' },
  { id: 'sub', title: '6. Subsystems & Presets' }
];

export const NODES = [
  // Group 1: UI & Interaction
  {
    id: 'U',
    code: 'U',
    name: 'UI & Controls',
    short: 'CONTROLS',
    group: 'ui',
    gx: 1.0,
    gy: 2.0,
    w: 2.5,
    d: 2.5,
    h: 44,
    kind: 'screen',
    one: 'Hybrid Preact and legacy-DOM control surface for function selection, parameters, and display modes.',
    what: 'The main user interface sidebar and top bar where you select mathematical functions ($w = \\cos(z)$, polynomials, Möbius transforms), drag parameter sliders ($a_0, b_0, r$), customize polynomial coefficients, and toggle visualization overlays.',
    how: 'Built from Preact islands in `js/frontend/` plus legacy DOM handlers in `js/ui/event-listeners.js`. Both write the signal-backed store; `ui-sync-controller.js` synchronizes selected state back to DOM controls.',
    steps: [
      ['Input Event', 'User interacts with a Preact control or a legacy DOM control.'],
      ['State Mutation', 'Updates a top-level signal-backed value or uses `mutateState` for nested data.'],
      ['UI Sync', 'State subscriptions update the relevant DOM controls and titles.'],
      ['Redraw Request', 'Routes a UI or domain invalidation through the redraw scheduler.'],
      ['UI Reflect', 'Reflects current mathematical expression in MathML / LaTeX display.']
    ],
    cond: [
      { q: 'How are polynomial coefficient inputs validated?', r: 'Parsed to numeric floats with fallback to 0.0 + 0.0i on invalid input (2026-02-10).' },
      'Should we add a visual expression graph builder for chained transformations?'
    ]
  },
  {
    id: 'VP',
    code: 'VP',
    name: 'Viewport & Nav',
    short: 'VIEWPORT',
    group: 'ui',
    gx: 4.5,
    gy: 2.0,
    w: 2.0,
    d: 2.0,
    h: 36,
    kind: 'box',
    one: 'Bidirectional coordinate transformation engine bridging screen pixels and complex plane coordinates.',
    what: 'Translates mouse/touch gestures (panning, scrolling, pinch-to-zoom) on the canvas into complex plane windows $[x_{min}, x_{max}] \\times [y_{min}, y_{max}]$, maintaining strict aspect ratios and precision.',
    how: 'Implemented in `js/navigation-plane.js` and `js/utils/canvas-utils.js`. Provides `mapCanvasToWorldCoords()` and `mapToCanvasCoords()` with high-precision sub-pixel scaling for both z-plane and w-plane.',
    steps: [
      ['Pointer Event', 'Captures wheel or drag delta on Canvas context.'],
      ['Transform Calc', 'Recomputes `currentVisXRange` and `currentVisYRange`.'],
      ['Grid Refit', 'Calculates optimal tick spacing and axis offsets.'],
      ['Notify Scheduler', 'Routes a UI or domain redraw request through the centralized scheduler.']
    ],
    cond: [
      { q: 'How is aspect ratio preserved during canvas resize?', r: 'Locks viewport height to width ratio based on canvas aspect ratio bounds (2026-01-18).' }
    ]
  },
  {
    id: 'PR',
    code: 'PR',
    name: 'Hover Probe & Tooltip',
    short: 'PROBE',
    group: 'ui',
    gx: 1.0,
    gy: 6.0,
    w: 2.0,
    d: 2.0,
    h: 32,
    kind: 'box',
    one: 'Interactive cursor probe sampling local neighborhood, derivative $f\'(z)$, and singularity proximity.',
    what: 'A magnifying probe that tracks your cursor over the complex plane, displaying the exact input $z = x+iy$, mapped output $w = f(z)$, local derivative $f\'(z)$, conformal magnification $|f\'(z)|$, rotation angle $\\arg(f\'(z))$, and nearby singularities.',
    how: 'Managed in `js/ui/tooltip.js` and `js/main.js` (`setupCanvasTooltipEvents`). Queries `resolveActiveMap()` and `findNearestDynamicSample()` to format live mathematical tooltips.',
    steps: [
      ['Cursor Move', 'Receives cursor position on z-plane or w-plane.'],
      ['World Map', 'Converts pixel coordinate to complex number $z = x+iy$.'],
      ['Neighborhood Eval', 'Evaluates $f(z)$, $f\'(z)$, and checks proximity to poles/zeros.'],
      ['Render Overlay', 'Draws circular probe ring and formatted tooltip balloon.']
    ],
    cond: [
      { q: 'Is probe active during 3D Riemann sphere viewing?', r: 'Yes, uses raycasting to project cursor onto sphere surface coordinates (2026-02-04).' }
    ]
  },

  // Group 2: Reactive State & Runtime
  {
    id: 'ST',
    code: 'ST',
    name: 'Observable Store',
    short: 'STORE',
    group: 'state',
    gx: 7.5,
    gy: 2.0,
    w: 2.5,
    d: 2.5,
    h: 36,
    kind: 'store',
    one: 'Central reactive state tree containing mathematical parameters, active modes, and cache keys.',
    what: 'The single source of runtime truth holding parameters ($a_0, b_0, circleR, mobiusA\\dots D$), selected function name, chaining mode, active display views (Fourier, Laplace, Split, Sphere), and analytical caches.',
    how: 'Defined in `js/store/state.js` and wrapped by `createObservableStore()` using `@preact/signals`. Top-level keys are signal-backed; nested changes use explicit `mutateState`/`touch` notifications.',
    steps: [
      ['State Read', 'Components read reactive signals directly.'],
      ['State Write', 'Top-level writes update signals; nested writes use `mutateState`.'],
      ['Redraw Invalidation', 'Rendering callers explicitly request UI or domain invalidation.'],
      ['Cache Invalidation', 'Rebuilds parameter signature keys.']
    ],
    cond: [
      { q: 'How are undo/redo states recorded?', to: 'State history deep dive' }
    ]
  },
  {
    id: 'EV',
    code: 'EV',
    name: 'Event Bus & Sync',
    short: 'EVENT BUS',
    group: 'state',
    gx: 4.5,
    gy: 5.5,
    w: 2.0,
    d: 2.0,
    h: 30,
    kind: 'gate',
    one: 'Decoupled pub/sub event router coordinating UI components and rendering controllers.',
    what: 'Bridges legacy DOM event listeners, Preact signals, and animation loops without tight coupling, dispatching events when functions change, parameters shift, or viewports resize.',
    how: 'Implemented in `js/store/events.js` (`eventBus`) and `js/frontend/controllers/ui-sync-controller.js`. The bus carries redraw signals such as `redraw:all` and `redraw:domain`; state subscriptions handle UI and cache synchronization.',
    steps: [
      ['Event Emit', 'Controller emits typed event payload.'],
      ['Listener Dispatch', 'Invokes registered listener callbacks synchronously.'],
      ['State Reconciliation', 'Synchronizes DOM input elements with reactive state.'],
      ['Trigger Redraw', 'Notifies redraw scheduler of visual changes.']
    ],
    cond: []
  },
  {
    id: 'RS',
    code: 'RS',
    name: 'Redraw Scheduler',
    short: 'SCHEDULER',
    group: 'state',
    gx: 4.5,
    gy: 9.0,
    w: 2.0,
    d: 2.0,
    h: 34,
    kind: 'job',
    one: 'RAF-based coalescing render scheduler that prevents duplicate frame requests.',
    what: 'Batches multiple incoming UI or domain invalidations into a single `requestAnimationFrame` render pass and carries a domain-color dirty bit across queued frames.',
    how: 'Implemented in `js/rendering/redraw-scheduler.js`. Configured with `renderApplicationFrame` and exposes `requestUiRedraw()`, `requestDomainRedraw()`, and the lower-level `requestRedrawAll()`.',
    steps: [
      ['Redraw Request', 'State-changing modules call the centralized UI or domain request entry point.'],
      ['RAF Batching', 'Schedules single `requestAnimationFrame` callback if idle.'],
      ['Frame Exec', 'Executes `renderApplicationFrame(timestamp)`.'],
      ['Surface Delay', 'Schedules debounced 90ms deferred redraw for heavy 3D surfaces.']
    ],
    cond: [
      { q: 'What is the surface redraw debounce threshold?', r: 'The application renderer configures a 90ms delay and a 240ms max-wait ceiling.' }
    ]
  },

  // Group 3: Math Engine & Compilation
  {
    id: 'EX',
    code: 'EX',
    name: 'Expression Compiler',
    short: 'PARSER',
    group: 'math',
    gx: 11.0,
    gy: 1.5,
    w: 2.5,
    d: 2.5,
    h: 40,
    kind: 'cards',
    one: 'Custom AST tokenizer and compiler generating JIT JavaScript, GLSL shader code, and native expression programs.',
    what: 'Parses mathematical formula strings (e.g. `sin(z) + z^2 - 1/z`), tokenizing expressions into an Abstract Syntax Tree (AST) that compiles into JavaScript functions, WebGL GLSL shaders, MathML markup, or native expression programs.',
    how: 'Located in `js/math/expression/` (`parser.js`, `evaluator.js`, `glsl.js`, `mathml.js`, `product-term.js`). Supports complex arithmetic operator precedence, transcendental functions, and product series.',
    steps: [
      ['Tokenize', 'Lexes expression string into numeric, variable, and operator tokens.'],
      ['Parse AST', 'Constructs recursive AST node hierarchy.'],
      ['Type Check', 'Validates complex operations and branch constraints.'],
      ['Codegen', 'Emits optimized JavaScript evaluator or GLSL shader code string.']
    ],
    cond: [
      { q: 'Does the parser support arbitrary user variables?', r: 'Supports z, c, time t, and indexed constants a0..an (2026-01-29).' }
    ]
  },
  {
    id: 'CE',
    code: 'CE',
    name: 'Native WASM Engine',
    short: 'WASM CORE',
    group: 'math',
    gx: 14.5,
    gy: 1.5,
    w: 3.0,
    d: 3.0,
    h: 64,
    kind: 'tall',
    one: 'WebAssembly C core (ABI v2) computing complex arithmetic, transcendental functions, and series.',
    what: 'The compiled C calculation engine for point evaluations, complex polynomials, Riemann Zeta analytic continuation, Bessel functions, gamma functions, and Durand-Kerner polynomial root-finding.',
    how: 'Built from `native/src/` into `native/build/complex_engine.wasm` (ABI v2). Loaded via `js/native/complex-engine.js` with direct linear memory buffer access.',
    steps: [
      ['Memory Alloc', 'Allocates input, output, and validity buffers in WASM linear memory.'],
      ['Configure Map', 'Populates C `MapConfig` struct with active function parameters.'],
      ['Native Exec', 'Calls the point-evaluation export (`ce_evaluate_points`).'],
      ['Read Results', 'Copies output complex values and validity flags into JavaScript values.']
    ],
    cond: [
      { q: 'What happens when ABI version mismatches?', r: 'Throws explicit fatal error if wasm.ce_abi_version() !== 2 (2026-01-15).' },
      'Can we enable WebAssembly SIMD-128 instructions in production builds?'
    ]
  },
  {
    id: 'AM',
    code: 'AM',
    name: 'Active Map Engine',
    short: 'ACTIVE MAP',
    group: 'math',
    gx: 11.0,
    gy: 5.5,
    w: 3.0,
    d: 3.0,
    h: 56,
    kind: 'tall',
    one: 'Active mapping dispatcher resolving transformation pipelines, derivative orders, and algebraic chaining.',
    what: 'The mathematical traffic controller. It takes the current function setting (single function, algebraic sum, chained composition $f(g(z))$, or derivative presentation $f\'(z)$) and constructs the active evaluator pipeline.',
    how: 'Implemented in `js/math/active-map.js` and `js/native/map-runtime.js`. Exposes `resolveActiveMap()`, returning cached evaluators for $f(z)$, first derivative $f\'(z)$, and second derivative $f\'\'(z)$.',
    steps: [
      ['Resolve Stage', 'Identifies active function type, parameters, and derivative order.'],
      ['Signature Check', 'Compares source signature with cached evaluator.'],
      ['Instantiate', 'Constructs native or JIT evaluator wrapper.'],
      ['Return Dispatcher', 'Returns `{ evaluate, evaluateBatch, derivative, signature }`.']
    ],
    cond: [
      { q: 'How are chained stages composed?', r: 'Evaluates sequentially: stage 0 output becomes stage 1 input up to chainCount - 1 (2026-02-01).' }
    ]
  },

  // Group 4: Analysis & Calculus Pipeline
  {
    id: 'FD',
    code: 'FD',
    name: 'Feature Detection',
    short: 'ROOTS & POLES',
    group: 'analysis',
    gx: 8.0,
    gy: 9.5,
    w: 2.2,
    d: 2.2,
    h: 34,
    kind: 'box',
    one: 'Grid sampling algorithms locating zeros (roots), poles (singularities), and critical points ($f\'(z)=0$).',
    what: 'Scans the visible complex plane grid to locate mathematical features: roots where $f(z) = 0$, poles where $|f(z)| \\to \\infty$, branch cuts, and critical points where derivative $f\'(z) = 0$, clustering duplicate detections into discrete points.',
    how: 'Implemented in `js/analysis/feature-detection.js`. Uses native root-finding algorithms from `complex-engine.js` with adaptive grid search and viewport-based distance threshold clustering.',
    steps: [
      ['Grid Sampling', 'Generates 2D sampling grid across visible viewport ranges.'],
      ['Gradient Check', 'Identifies local minima of $|f(z)|$ and $|f\'(z)|$, and maxima of $|f(z)|$.'],
      ['Newton Refine', 'Applies Newton-Raphson iterations to converge on precise root coordinates.'],
      ['Cluster & Classify', 'Merges nearby points within tolerance and assigns multiplicity/order.']
    ],
    cond: [
      { q: 'How are duplicate poles merged across grid boundaries?', r: 'Distance-factor clustering merges candidates within viewport-scaled epsilon (2026-01-30).' }
    ]
  },
  {
    id: 'CA',
    code: 'CA',
    name: 'Cauchy & Contours',
    short: 'CAUCHY RESIDUE',
    group: 'analysis',
    gx: 11.0,
    gy: 9.5,
    w: 2.2,
    d: 2.2,
    h: 34,
    kind: 'box',
    one: 'Contour integration $\\oint_C f(z)dz$, Cauchy residue calculation, and winding number classification.',
    what: 'Calculates path integrals $\\oint_C f(z) dz$ along user-drawn contours or standard geometric shapes (circles, ellipses), evaluating Cauchy\'s Integral Formula, computing residues at enclosed poles, and displaying the topological winding number.',
    how: 'Built in `js/analysis/cauchy.js` and `js/analysis/contours.js`. Uses `analyzeNativeContour()` and `classifyNativeContourSingularities()` in WASM with `NUM_INTEGRAL_STEPS = 1024`.',
    steps: [
      ['Contour Discretize', 'Samples 1,024 equidistant points along path $z(t)$.'],
      ['Numerical Integral', 'Computes $\\sum f(z_k) \\cdot \\Delta z_k$ via trapezoidal rule.'],
      ['Enclosed Poles', 'Tests enclosed singularities via Jordan winding number.'],
      ['Residue Theorem', 'Verifies $\\oint_C f(z) dz = 2\\pi i \\sum \\text{Res}(f, z_k)$ and displays result.']
    ],
    cond: [
      { q: 'How is contour self-intersection handled?', r: 'Winding number is computed per topological region using ray casting (2026-02-08).' }
    ]
  },
  {
    id: 'DY',
    code: 'DY',
    name: 'Dynamic Plotting',
    short: 'DYNAMICS',
    group: 'analysis',
    gx: 8.0,
    gy: 13.0,
    w: 2.2,
    d: 2.2,
    h: 32,
    kind: 'box',
    one: 'Numerical ODE trajectory integrator and dynamic particle solver on the complex plane.',
    what: 'Simulates dynamical systems and differential equations on the complex plane, tracing particle orbits $z(t)$, phase portraits, and iterative recurrence sequences $z_{n+1} = g(z_n)$.',
    how: 'Built in `js/analysis/dynamic-plotting.js` and rendered via `js/rendering/draw-dynamic-plotting.js`. Supports Runge-Kutta numerical integration and orbit color mapping.',
    steps: [
      ['Seed Init', 'Spawns test particles across grid or user probe coordinates.'],
      ['ODE Step', 'Integrates differential step $z_{t+\\Delta t} = z_t + f(z_t) \\Delta t$.'],
      ['Trace Orbit', 'Accumulates trajectory polyline buffer.'],
      ['Render Path', 'Draws glow-trail paths on z-plane and w-plane.']
    ],
    cond: []
  },
  {
    id: 'TF',
    code: 'TF',
    name: 'Integral Transforms',
    short: 'TRANSFORMS',
    group: 'analysis',
    gx: 11.0,
    gy: 13.0,
    w: 2.2,
    d: 2.2,
    h: 34,
    kind: 'box',
    one: 'Continuous/discrete Fourier transforms and Laplace transforms with s-plane ROC analysis.',
    what: 'Analyzes frequency domain characteristics: Fourier transforms $F(\\omega) = \\int f(t) e^{-i\\omega t} dt$ and Laplace transforms $F(s) = \\int f(t) e^{-st} dt$, identifying poles, zeros, and Region of Convergence (ROC) on the complex s-plane.',
    how: 'Implemented in `js/analysis/fourier-transform.js` and `js/analysis/laplace-transform.js`. Computes continuous winding integrals and generates 3D surface mesh data.',
    steps: [
      ['Time Signal', 'Discretizes source time-domain signal $f(t)$.'],
      ['Complex Exponential', 'Multiplies by kernel $e^{-st} = e^{-(\\sigma + i\\omega)t}$.'],
      ['Integrate', 'Computes cumulative complex sum over interval $[0, T]$.'],
      ['ROC Classification', 'Determines convergence boundary $\\text{Re}(s) > \\sigma_0$.']
    ],
    cond: [
      { q: 'How are Laplace transform poles visualized in 3D?', r: 'Rendered as high-peak singular columns in Three.js |F(s)| heightfield (2026-02-12).' }
    ]
  },
  {
    id: 'VF',
    code: 'VF',
    name: 'Vector Fields & Streamlines',
    short: 'STREAMLINES',
    group: 'analysis',
    gx: 14.0,
    gy: 9.5,
    w: 2.2,
    d: 2.2,
    h: 32,
    kind: 'box',
    one: 'Complex potential flow analysis, Cauchy-Riemann velocity field mapping, and particle advection.',
    what: 'Treats the complex function as a 2D fluid velocity potential, converting derivative values $f\'(z) = u - iv$ into velocity vector fields $\\vec{V} = (u, -v)$ and animating thousands of flowing streamlines across the grid.',
    how: 'Implemented in `js/analysis/streamline.js` and `js/rendering/draw-planar.js` (`drawStreamlinesOnZPlane`, `updateAndDrawParticles`). Uses fourth-order Runge-Kutta streamline tracing.',
    steps: [
      ['Derivative Field', 'Samples complex derivative $f\'(z)$ at regular grid nodes.'],
      ['Velocity Vector', 'Decomposes into flow components $v_x = \\text{Re}(f\'), v_y = -\\text{Im}(f\').$'],
      ['Streamline Trace', 'Integrates forward and backward stream paths.'],
      ['Particle Advection', 'Animates dynamic tracer particles along flow vectors.']
    ],
    cond: []
  },
  {
    id: 'TS',
    code: 'TS',
    name: 'Tissot & Conformal',
    short: 'CONFORMAL',
    group: 'analysis',
    gx: 14.0,
    gy: 13.0,
    w: 2.0,
    d: 2.0,
    h: 28,
    kind: 'box',
    one: 'Tissot indicatrices visualizing conformal angle preservation and local scaling/rotation distortion.',
    what: 'Places tiny circles across the z-plane and maps them through $f(z)$ to the w-plane to demonstrate conformality: holomorphic maps preserve local orthogonality ($90^\\circ$ angles) and scale circles into scaled/rotated circles, degenerating only at critical points.',
    how: 'Built in `js/analysis/tissot.js` and rendered by `drawConformalIndicatrices()` in `draw-planar.js`. Computes singular value decomposition (SVD) of the Jacobian matrix.',
    steps: [
      ['Circle Placement', 'Deploys grid of infinitesimal test circles on z-plane.'],
      ['Jacobian Eval', 'Computes local Jacobian $\\begin{pmatrix} u_x & u_y \\\\ v_x & v_y \\end{pmatrix}$ via Cauchy-Riemann equations.'],
      ['Ellipse Map', 'Transforms circles to output ellipses on w-plane.'],
      ['Distortion Metrics', 'Calculates area expansion factor $|f\'(z)|^2$ and rotation $\\arg(f\'(z))$.']
    ],
    cond: []
  },
  {
    id: 'BC',
    code: 'BC',
    name: 'Riemann Surfaces & Branching',
    short: 'BRANCH CUTS',
    group: 'analysis',
    gx: 17.0,
    gy: 9.5,
    w: 2.2,
    d: 2.2,
    h: 34,
    kind: 'box',
    one: 'Multi-sheet branch tracking, branch cut crossings, and Riemann surface mesh construction.',
    what: 'Handles multi-valued complex functions like $\\log(z)$, $\\sqrt{z}$, or $z^{1/n}$ by constructing multi-sheeted Riemann surfaces, tracking winding count around branch points and connecting adjacent sheets seamlessly.',
    how: 'Implemented in `js/analysis/riemann-surface.js` and `js/analysis/branch-continuation.js`. Builds multi-layer 3D surface meshes for WebGL and Three.js rendering.',
    steps: [
      ['Branch Point Check', 'Locates branch points where multi-valued behavior originates.'],
      ['Sheet Indexing', 'Assigns winding index $k \\in \\{0, 1, \\dots, n-1\\}$ based on path integration.'],
      ['Mesh Generation', 'Constructs helical 3D surface geometry.'],
      ['Shader Pass', 'Renders intersecting sheets with transparency and color-coded layers.']
    ],
    cond: [
      { q: 'How many sheets are generated for fractional power n = 1/3?', r: 'Constructs exactly 3 interlocking Riemann sheets with smooth phase boundary transitions (2026-02-14).' }
    ]
  },

  // Group 5: Rendering Layer
  {
    id: 'AR',
    code: 'AR',
    name: 'Application Renderer',
    short: 'RENDER LOOP',
    group: 'render',
    gx: 7.5,
    gy: 6.0,
    w: 2.5,
    d: 2.5,
    h: 52,
    kind: 'tall',
    one: 'Top-level frame coordinator orchestrating multi-pass rendering across planar, 3D, and transform views.',
    what: 'The conductor of the visual pipeline. On each animation frame, it triggers feature detection, updates Cauchy analysis, draws the 2D z-plane and w-plane, synchronizes optional 3D columns, and redraws Riemann spheres.',
    how: 'Implemented in `js/rendering/application-renderer.js` (`renderApplicationFrame`). Calls `drawZPlaneContent()`, `drawWPlaneContent()`, `drawLaplace3DSurface()`, and `drawRealPlot()`.',
    steps: [
      ['Frame Start', 'Receives timestamp from requestAnimationFrame.'],
      ['Analysis Pass', 'Runs feature detection (zeros, poles, critical points, Cauchy).'],
      ['Planar Pass', 'Draws 2D canvas layers for z-plane and w-plane.'],
      ['3D & Transform Pass', 'Renders active 3D Three.js surfaces and winding plots.']
    ],
    cond: []
  },
  {
    id: 'P2',
    code: 'P2',
    name: '2D Planar Canvas',
    short: 'PLANAR 2D',
    group: 'render',
    gx: 18.0,
    gy: 1.5,
    w: 3.0,
    d: 3.0,
    h: 26,
    kind: 'slab',
    one: 'High-DPI Canvas 2D renderer for input $z$-plane and output $w$-plane grids and shapes.',
    what: 'Renders the primary side-by-side interactive planes: Cartesian, polar, and hyperbolic grids, input shapes (circles, lines, polygons), transformed curves $f(C)$, Taylor series approximations, and hover probe markers.',
    how: 'Built in `js/rendering/draw-planar.js` and `js/rendering/canvas-primitives.js`. Uses supersampled 2D context drawing with subpixel path rendering.',
    steps: [
      ['Clear & Axes', 'Clears canvas and draws axes, ticks, and grid lines.'],
      ['Input Shape', 'Draws input geometric paths on z-plane.'],
      ['Transform Map', 'Maps vertices through `activeMap.evaluate()` and draws deformed w-plane curves.'],
      ['Markers & Overlays', 'Overlays zeros, poles, critical markers, and probe crosshairs.']
    ],
    cond: []
  },
  {
    id: 'DC',
    code: 'DC',
    name: 'Domain Dynamics',
    short: 'DOMAIN COLOR',
    group: 'render',
    gx: 18.0,
    gy: 5.5,
    w: 3.0,
    d: 3.0,
    h: 26,
    kind: 'slab',
    one: 'Complex color wheel renderer mapping phase $\\arg(w)$ to hue and magnitude $|w|$ to lightness.',
    what: 'Generates continuous domain coloring where every point in the complex plane is assigned a distinct color: phase angle $\\theta = \\arg(f(z))$ determines the hue (rainbow cycle), while magnitude $|f(z)|$ determines brightness with contour rings.',
    how: 'Implemented in `js/rendering/domain-coloring.js` with native tile rendering in `domain-dynamics-worker.js`. The worker returns RGBA pixel buffers; the main thread wraps each tile in `ImageData` and commits it to a staging canvas.',
    steps: [
      ['Worker Dispatch', 'Sends viewport bounds, palette mode, and function config to web worker.'],
      ['Buffer Compute', 'Worker computes a tile RGBA pixel buffer off the main thread.'],
      ['Post Message', 'Transfers the tile `pixels.buffer` back to the main thread.'],
      ['Blit Canvas', 'Wraps the buffer in `ImageData`, stages the tile, and commits the final canvas.']
    ],
    cond: []
  },
  {
    id: 'WG',
    code: 'WG',
    name: 'WebGL Image Warper',
    short: 'WEBGL WARPER',
    group: 'render',
    gx: 18.0,
    gy: 13.0,
    w: 3.0,
    d: 3.0,
    h: 26,
    kind: 'slab',
    one: 'GPU texture mesh deformation warping input images and video frames from $z$ to $w$.',
    what: 'Maps arbitrary user images or webcam video feeds onto the z-plane and deforms the entire quadrilateral mesh through complex function $w = f(z)$ in real-time WebGL vertex and fragment shaders.',
    how: 'Built in `js/rendering/draw-image-webgl.js` and `webgl-shared.js`. Creates a $64 \\times 64$ quadrilateral mesh with texture coordinates and evaluates transformations directly on the GPU.',
    steps: [
      ['Texture Upload', 'Uploads image or video frame to WebGL texture unit.'],
      ['Mesh Gen', 'Builds subdivided grid geometry with normalized UVs.'],
      ['Vertex Transform', 'Evaluates mapping function in vertex shader or CPU batch buffer.'],
      ['Rasterize', 'Draws textured warped triangles with bilinear interpolation.']
    ],
    cond: []
  },
  {
    id: 'T3',
    code: 'T3',
    name: 'Three.js 3D Engine',
    short: 'THREE.JS 3D',
    group: 'render',
    gx: 21.5,
    gy: 5.5,
    w: 3.0,
    d: 3.0,
    h: 26,
    kind: 'slab',
    one: '3D WebGL scene rendering stereographic Riemann spheres, Laplace $|F(s)|$ heightfields, and folded surfaces.',
    what: 'Renders rich 3D mathematical surfaces: the Riemann Sphere (compactification of $\\mathbb{C} \\cup \\{\\infty\\}$ via stereographic projection), 3D $|F(s)|$ Laplace transform terrain, and folded modular surfaces $|f(z)|$.',
    how: 'Implemented in `js/rendering/three-riemann-renderer.js`, `laplace-3d-surface.js`, and `draw-sphere.js`. Employs Three.js scene graphs, orbit controls, custom shader materials, and dynamic mesh rebuilds.',
    steps: [
      ['Scene Setup', 'Initializes Three.js perspective camera, ambient lighting, and orbit controls.'],
      ['Stereographic Map', 'Projects planar points $z = x+iy$ onto sphere $(\\xi, \\eta, \\zeta) = \\left(\\frac{2x}{|z|^2+1}, \\frac{2y}{|z|^2+1}, \\frac{|z|^2-1}{|z|^2+1}\\right)$.'],
      ['Mesh Heightfield', 'Generates 3D vertex elevations $z = \\ln(1 + |F(s)|)$.'],
      ['Render Pass', 'Draws shaded 3D mesh with interactive mouse rotation.']
    ],
    cond: []
  },
  {
    id: '3B',
    code: '3B',
    name: 'Transform Winders',
    short: '3B1B WINDERS',
    group: 'render',
    gx: 21.5,
    gy: 9.5,
    w: 2.2,
    d: 2.2,
    h: 30,
    kind: 'box',
    one: '3Blue1Brown-style winding frequency animations and center-of-mass spectral visualizers.',
    what: 'Visualizes the intuitive geometric meaning of Fourier and Laplace transforms: wraps a signal $f(t)$ around the origin at varying rotational frequencies $\\omega$, tracking the path and the dynamic center of mass (centroid) as $\\omega$ sweeps.',
    how: 'Built in `js/rendering/draw-fourier-winding.js` and `draw-laplace-winding-3b1b.js`. Animates winding spirals, center-of-mass indicator dots, and frequency spectrum graphs.',
    steps: [
      ['Signal Sample', 'Extracts time-domain signal $f(t)$ array.'],
      ['Winding Wrap', 'Calculates wrapped trajectory $g(t) = f(t) e^{-i 2\\pi \\omega t}$.'],
      ['Centroid Calc', 'Computes center of mass $\\bar{z} = \\frac{1}{T} \\int_0^T g(t) dt$.'],
      ['Draw Animation', 'Draws winding curve with trailing glow and centroid marker.']
    ],
    cond: []
  },

  // Group 6: Subsystems & Presets
  {
    id: 'MB',
    code: 'MB',
    name: 'Mandelbrot Perturbation',
    short: 'PERTURBATION',
    group: 'sub',
    gx: 1.0,
    gy: 10.5,
    w: 2.5,
    d: 2.5,
    h: 32,
    kind: 'box',
    one: 'Deep perturbation fractal engine with arbitrary-precision fixed-point math and WebGPU acceleration.',
    what: 'A dedicated subsystem for extreme deep-zoom Mandelbrot fractals ($10^{-100}$ scale) using perturbation series expansion around reference points and arbitrary-precision fixed-point arithmetic (`fxp.mjs`), with WebGPU compute pipelines.',
    how: 'Located in `bertbaron_mandelbrot/` (`fxp.mjs`, `mandelbrotPerturbation.mjs`, `mandelbrotWebGPU.mjs`). Employs multi-worker parallel tiling and WebGPU compute shaders.',
    steps: [
      ['Reference Orbit', 'Calculates high-precision reference orbit $Z_n$ via arbitrary-precision float.'],
      ['Perturbation Delta', 'Computes pixel delta iterations $\\delta_{n+1} = 2 Z_n \\delta_n + \\delta_n^2 + \\Delta c$ in standard floats.'],
      ['Worker Tile Pool', 'Dispatches square tiles across multi-worker thread pool or WebGPU.'],
      ['Palette Blit', 'Maps iteration counts to custom cyclic palette.']
    ],
    cond: [
      { q: 'Is WebGPU automatically used when available?', r: 'Detects navigator.gpu and falls back to Web Workers when unsupported (2026-01-25).' }
    ]
  }
];

export const FLOWS = [
  {
    id: 'planar_mapping',
    name: '1. Planar Transformation Flow (z to w)',
    hops: [
      ['U', 'ST', 'parameter update', { action: 'setFunction', currentFunction: 'cos', circleR: 1.5 }, 'yx'],
      ['ST', 'EV', 'state mutation', { key: 'currentFunction', value: 'cos' }, 'xy'],
      ['EV', 'RS', 'schedule invalidation', { kind: 'domain', domainDirty: true }, 'yx'],
      ['RS', 'AR', 'trigger frame', { frameId: 402, plane: 'both' }, 'xy'],
      ['AR', 'AM', 'resolve evaluator', { functionKey: 'cos', derivativeOrder: 0 }, 'yx'],
      ['AM', 'CE', 'native point evaluation', { export: 'ce_evaluate_points', pointCount: 1024 }, 'xy'],
      ['CE', 'AM', 'values and validity', { sampleZ: { re: 1.0, im: 0.5 }, sampleW: { re: 0.81, im: -0.46 }, valid: true }, 'xy'],
      ['AM', 'P2', 'draw transformed curves', { meshSize: [15, 15], stage: 0 }, 'yx'],
      ['P2', 'U', 'frame painted', { canvas: 'w-plane' }, 'yx']
    ]
  },
  {
    id: 'cauchy_analysis',
    name: '2. Cauchy Residue & Contour Flow',
    hops: [
      ['U', 'VP', 'draw contour', { type: 'circle', center: { re: 0, im: 0 }, radius: 1.2 }, 'yx'],
      ['VP', 'CA', 'contour coordinates', { stepCount: 1024, closed: true }, 'xy'],
      ['CA', 'FD', 'query singularities', { region: [-1.2, 1.2, -1.2, 1.2] }, 'xy'],
      ['FD', 'CA', 'enclosed poles', { poles: [{ re: 0, im: 0, order: 1, residue: { re: 1, im: 0 } }] }, 'yx'],
      ['CA', 'PR', 'integral result', { integral: { re: 6.283, im: 0 }, windingNumber: 1 }, 'yx'],
      ['PR', 'AR', 'render probe overlay', { overlay: 'residue_balloon', active: true }, 'xy']
    ]
  },
  {
    id: 'domain_dynamics',
    name: '3. Web Worker Domain Coloring Flow',
    hops: [
      ['ST', 'DC', 'snapshot inputs', { palette: 'arctic-frost', viewport: [512, 512] }, 'xy'],
      ['DC', 'AR', 'native worker tile', { jobId: 1, tileSize: 256, pixelBuffer: 'transferred' }, 'yx'],
      ['AR', 'P2', 'commit staging canvas', { targetCanvas: 'zDomainColorCanvas' }, 'yx']
    ]
  },
  {
    id: 'spectral_laplace',
    name: '4. Spectral & Laplace 3D Flow',
    hops: [
      ['U', 'TF', 'select transform', { type: 'laplace', signal: 'damped_sine', decay: 0.5, freq: 2.0 }, 'yx'],
      ['TF', '3B', 'winding trajectory', { frequencies: [0.5, 1.0, 2.0], centroid: { x: 0.05, y: -0.12 } }, 'xy'],
      ['TF', 'T3', '3D s-plane heightfield', { poles: [{ s: { re: -0.5, im: 2.0 } }], roc: 'Re(s) > -0.5' }, 'xy'],
      ['T3', 'AR', 'composite 3D scene', { container: 'laplace_3d_container', cameraRot: [0.4, 0.8] }, 'yx']
    ]
  }
];

export const CH = [
  {
    id: 'core_map',
    title: '1. The Core Mapping (z to w)',
    reveal: ['U', 'VP', 'AM', 'P2'],
    lede: `Input complex numbers on the z-plane, evaluate $w = f(z)$, and render transformed grids on the w-plane.`,
    story: `<p>Strip everything away and this is the core engine: you select a function or drag coordinates on the <b>z-plane</b>, the <mark>Active Map Engine</mark> calculates the mapping, and the <b>2D Planar Canvas</b> renders the deformed grid lines on the <b>w-plane</b>.</p>`,
    flow: [
      ['U', 'VP', 'pointer coordinates', { x: 1.0, y: 0.5 }],
      ['VP', 'AM', 'evaluate z', { z: { re: 1.0, im: 0.5 } }],
      ['AM', 'P2', 'render w', { w: { re: 0.81, im: -0.46 } }],
      ['P2', 'U', 'display update', { canvas: 'w-plane' }]
    ]
  },
  {
    id: 'reactive_state',
    title: '2. Reactive State & Frame Cycle',
    reveal: ['ST', 'EV', 'RS', 'AR'],
    lede: `Preact signals and a central event bus synchronize parameter mutations into batched RAF frame updates.`,
    story: `<p>Parameter changes from sliders or expressions flow into the <mark>Observable Store</mark>. The <b>Redraw Scheduler</b> batches rapid updates into a single <code>requestAnimationFrame</code> render pass, driving the <b>Application Renderer</b>.</p>`,
    flow: [
      ['U', 'ST', 'slider delta', { circleR: 1.5 }],
      ['ST', 'EV', 'state mutation', { key: 'circleR', value: 1.5 }],
      ['EV', 'RS', 'request redraw', { dirty: true }],
      ['RS', 'AR', 'render frame', { frame: 1 }]
    ]
  },
  {
    id: 'native_wasm',
    title: '3. The Native WASM Core',
    reveal: ['EX', 'CE'],
    lede: `Custom expressions parse to ASTs and evaluate through the WebAssembly C core.`,
    story: `<p>Equations entered by the user are parsed into an AST by the <b>Expression Compiler</b> and evaluated through the <mark>Native WASM Engine</mark> (ABI v2). The bridge allocates linear-memory buffers, calls native exports, and copies results back into JavaScript values.</p>`,
    flow: [
      ['U', 'EX', 'parse formula', { expr: 'sin(z) + z^2' }],
      ['EX', 'CE', 'compiled struct', { terms: 2 }],
      ['CE', 'AM', 'native point result', { points: 1024, validityFlags: true }]
    ]
  },
  {
    id: 'cauchy_features',
    title: '4. Roots, Poles & Cauchy Residues',
    reveal: ['FD', 'CA', 'PR'],
    lede: `Automated root-finding and contour integration reveal poles, critical points, residues, and winding numbers.`,
    story: `<p>The <b>Feature Detection</b> module samples grids to locate zeros and singularities. The <b>Cauchy & Contours</b> engine calculates closed path integrals <mark>$\\oint_C f(z) dz = 2\\pi i \\sum \\text{Res}$</mark>, while the <b>Hover Probe</b> provides live neighborhood inspection.</p>`,
    flow: [
      ['AM', 'FD', 'scan viewport', { xRange: [-3.5, 3.5] }],
      ['FD', 'CA', 'classified poles', { count: 2 }],
      ['CA', 'PR', 'path residue', { winding: 1, res: 1.0 }],
      ['PR', 'AR', 'probe balloon', { active: true }]
    ]
  },
  {
    id: 'flows_conformal',
    title: '5. Continuous Flows & Dynamics',
    reveal: ['DY', 'VF', 'TS'],
    lede: `Complex derivatives model fluid velocity fields, particle trajectories, and conformal distortions.`,
    story: `<p>The engine interprets complex derivatives $f'(z)$ as fluid velocities $\\vec{V} = (u, -v)$, generating animated <mark>Streamlines</mark> across the z-plane, while <b>Tissot Indicatrices</b> demonstrate local conformal angle preservation and Jacobian scaling.</p>`,
    flow: [
      ['AM', 'VF', 'derivative field', { f_prime: 'cos(z)' }],
      ['VF', 'DY', 'advect particles', { count: 200 }],
      ['DY', 'TS', 'conformal ellipses', { svd: [1.2, 1.2] }],
      ['TS', 'P2', 'draw overlays', { layer: 'streamlines' }]
    ]
  },
  {
    id: 'domain_gpu',
    title: '6. Domain Coloring & Texture Warping',
    reveal: ['DC', 'WG'],
    lede: `Native worker tiles and GPU texture meshes provide two separate dense-visualization paths.`,
    story: `<p><b>Domain Dynamics</b> delegates pixel-level complex color calculations to <mark>dedicated Web Workers</mark>. Separately, the <b>WebGL Image Warper</b> deforms images and video feeds through a GPU mesh pipeline.</p>`,
    flow: [
      ['U', 'DC', 'domain-color request', { palette: 'arctic-frost' }],
      ['DC', 'U', 'domain canvas update', { targetCanvas: 'zDomainColorCanvas' }],
      ['U', 'WG', 'image or video input', { source: 'media element' }],
      ['WG', 'U', 'warped canvas update', { targetCanvas: 'w-plane' }]
    ]
  },
  {
    id: 'riemann_3d',
    title: '7. 3D Geometry & Riemann Sheets',
    reveal: ['T3', 'BC'],
    lede: `Multi-valued functions and stereographic projections expand into 3D Riemann spheres and multi-sheet surfaces.`,
    story: `<p>Multi-valued functions (like $\\log z$ or $\\sqrt{z}$) are tracked across interlocking sheets via <b>Riemann Surfaces & Branching</b>. The <mark>Three.js 3D Engine</mark> renders interactive stereographic Riemann spheres and 3D terrain landscapes.</p>`,
    flow: [
      ['AM', 'BC', 'trace branch cuts', { branches: 2 }],
      ['BC', 'T3', 'build 3D mesh', { vertices: 4096 }],
      ['T3', 'AR', 'render 3D scene', { rotX: 0.35 }]
    ]
  },
  {
    id: 'spectral_winders',
    title: '8. Spectral Transforms & 3b1b Winders',
    reveal: ['TF', '3B'],
    lede: `Fourier and Laplace transforms unroll into winding frequency animations and 3D s-plane convergence surfaces.`,
    story: `<p><b>Integral Transforms</b> computes continuous Fourier and Laplace transforms, while <mark>Transform Winders</mark> animates 3Blue1Brown-style rotational winding frequency trajectories, tracking the moving center of mass.</p>`,
    flow: [
      ['U', 'TF', 'transform input', { freq: 2.5 }],
      ['TF', '3B', 'winding spiral', { omega: 2.5 }],
      ['3B', 'T3', 's-plane surface', { roc: 'Re(s) > 0' }],
      ['T3', 'AR', 'render transform tab', { view: 'laplace-3d' }]
    ]
  },
  {
    id: 'fractal_subs',
    title: '9. Deep Fractals & Perturbation',
    reveal: ['MB'],
    lede: `Dedicated deep-zoom perturbation algorithms and WebGPU compute explore infinite fractal boundaries.`,
    story: `<p>The <b>Mandelbrot Perturbation</b> subsystem uses arbitrary-precision fixed-point math (<code>fxp.mjs</code>) and <mark>WebGPU compute pipelines</mark> to explore deep fractal depths ($10^{-100}$) without precision breakdown.</p>`,
    flow: [
      ['U', 'MB', 'deep zoom target', { depth: '1e-45' }],
      ['MB', 'WG', 'compute perturbation', { gpu: true }],
      ['WG', 'AR', 'present tile', { tileId: 12 }]
    ]
  },
  {
    id: 'whole_system',
    title: '10. The Whole System',
    reveal: [],
    lede: `All 18 structures unified in one explorable interactive architecture diagram.`,
    story: `<p>Choose which data flow runs using the picker at the bottom left. Hover any box for a quick summary; click to pin; double click or press <mark>→</mark> to go inside and inspect execution steps. Click any moving data packet to inspect its live JSON payload.</p>`,
    flow: null
  }
];

export const HOW_HTML = `<div class="eyebrow">Complex Function Analysis · Architecture</div>
<h1 class="t">How it's built</h1>
<div class="sub">hybrid client-side mathematical visualization engine</div>

<p>The system is built as a zero-backend, pure client-side web application leveraging WebAssembly, WebGL, Three.js, Canvas 2D, and Preact Signals.</p>

<h3 class="sec">Engine Architecture</h3>
<ul>
  <li><b>WASM C Core:</b> Compiled C library (<code>complex_engine.wasm</code>, ABI v2) providing native complex arithmetic, Durand-Kerner polynomial root-finding, and Riemann Zeta reflection continuations.</li>
  <li><b>Multi-Context Rendering:</b> Canvas 2D for interactive grids and vector streamlines, WebGL for image deformation meshes, and Three.js for stereographic Riemann spheres and 3D Laplace $|F(s)|$ heightfields.</li>
  <li><b>Reactive State Bridge:</b> Top-level Preact Signals wrapped in an observable store, with explicit nested mutations and a redraw scheduler for canvas invalidation.</li>
  <li><b>Worker Thread Domain Coloring:</b> Dedicated workers render native phase-magnitude tiles and transfer RGBA buffers back for canvas staging.</li>
</ul>

<h3 class="sec">Filesystem Layout</h3>
<pre>complex-plane/
  ├── js/
  │   ├── main.js                  # Bootstrap & event wiring
  │   ├── store/                   # State, signals, event bus
  │   ├── math/                    # AST parser, GLSL generator, active map
  │   ├── native/                  # WebAssembly bridge & memory manager
  │   ├── analysis/                # Feature detection, Cauchy, transforms
  │   ├── rendering/               # Multi-canvas renderers & schedulers
  │   └── frontend/                # Preact reactive UI components
  ├── native/src/                  # C source code for complex_engine.wasm
  └── docs/                        # System Atlas & text twin</pre>`;
