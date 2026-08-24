# Repository Architecture & Performance Decisions

Concise log of architectural constraints, post-mortem learnings, and established patterns for the complex plane rendering engine.

---

### 1. Universal Domain Dynamics Pipeline (No Dual Viewports)
* **Decision**: All domain coloring and algebraic dynamics use a single unified MPFR-centered coordinate pipeline from $1\times$ to $10^{100}\times$ zoom.
* **Rule**: Never introduce dual viewports, zoom-level switching (`if zoom > 1e14`), or legacy fallback paths. Keep exactly one source of truth.

---

### 2. Exact Algebraic Delta Perturbation (No Truncated Taylor)
* **Decision**: Perturbation uses exact algebraic difference identities ($\delta z_{n+1} = \Delta f(Z_n, \delta z_n, \Delta c)$) such as $e^{Z+\delta z} - e^Z = e^Z \text{expm1}(\delta z)$.
* **Rule**: Never use truncated polynomial Taylor approximations; they diverge outside the unit disk when span is wide ($|\delta z| > 1$).

---

### 3. Pure Delta Iteration (No Hardcoded Fallbacks)
* **Decision**: Delta perturbation runs through the entire chain depth without artificial double-precision downgrades or hardcoded distance thresholds.
* **Rule**: Do not add heuristic fallback branches that drop perturbation early. Keep the inner loop pure, exact, and un-overengineered.

---

### 4. Escape Bailout Scoping
* **Decision**: Bailout radius checks ($|z| > 2.0$) apply strictly to escape-time fractals (`orbit_mode == 1u`).
* **Rule**: Continuous domain coloring (`orbit_mode == 0u`) must never bail out at magnitude 2.0; it iterates through the full chain depth.

---

### 5. Continuous Domain Coloring vs. Mariani-Silver
* **Decision**: Mariani-Silver quadtree / microblock skipping is prohibited for continuous phase domain coloring.
* **Rule**: Because phase wraps $2\pi$ (multiple distinct complex values map to identical palette stops), perimeter matching produces false block fills. Always use full scanline evaluation.

---

### 6. Thread-Safe WebAssembly Worker Memory
* **Decision**: All worker memory must be per-instance or per-call allocated (`calloc`/`malloc` freed in scope).
* **Rule**: Never declare `static` global buffers in WASM C code shared across concurrent Web Worker threads.

---

### 7. Zero Fake Upscaling or Canvas Blur
* **Decision**: Immediate canvas clearing on pan/zoom without progressive stretching or artificial debounce delays.
* **Rule**: Do not apply projective canvas blits or `setTimeout` interaction debounce. Clear the target canvas instantly on new job dispatch and commit native tiles directly.

### 8. Canvas Grid Coordinate Float Absorption
* **Decision**: Standard canvas primitive loops must include `if (val + step === val) break;` safeguards.
* **Rule**: When viewport scale drops near 64-bit float limits ($10^{-15}$), simple loop iterators (`val += step`) suffer from float absorption. Unchecked, they infinite-loop and permanently freeze the browser's UI thread.

### 9. 64-Bit UI Event Binding
* **Decision**: The browser UI event layer (mouse coordinates, pan offsets) inherently operates on 64-bit JS Numbers.
* **Rule**: Deep zoom engines rely on MPFR arbitrary precision, but the mouse delta inputs themselves become vanishingly small relative to the origin coordinate, requiring string-based `preciseViewport` coordination rather than direct 64-bit `origin.x` mutations at extreme zoom.
