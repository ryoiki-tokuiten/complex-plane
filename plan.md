# High-Performance Universal Perturbation Engine & Domain Dynamics Architecture

## 1. Overview & System Objectives

This specification defines the architectural design, mathematical foundation, and implementation strategy for a high-performance **Universal Variational Perturbation Engine** in JavaScript.

### Key Objectives
1. **Unbounded Smooth Zooming ($10^0$ to $10^{100+}$)**:
   - Million-pixel frames evaluate using standard hardware 64-bit floating-point (`Float64Array`) registers by formulating pixel state as relative displacements $\delta$ and perturbation series $\varepsilon_n$.
   - The single central reference orbit supports arbitrary-precision centers via a lightweight multi-limb `BigInt` fixed-point accumulator, while all screen pixel evaluations run at hardware FP64 speeds.
2. **Generalized Function Support**:
   - Universal numerical differentiation for arbitrary single and composite functions $f(z) = (f_1 \circ f_2 \circ \dots \circ f_k)(z)$, algebraic term sums, dynamic aggregates, and zero-seed fractals (Mandelbrot).
3. **Rock-Solid Coordinate Synchronization**:
   - Single unified coordinate transformation pipeline eliminating visual drift, center slippage, or artificial rotation during panning and zooming.
4. **Immediate 60fps Rendering & Zero-Allocation Execution**:
   - Hierarchical progressive passes ($16\times \to 4\times \to 1\times$) with non-blocking Web Worker dispatch and reusable buffer pooling.

---

## 2. Floating-Point Limits & Numerical Precision Strategy

### 2.1 The IEEE 754 Float64 Precision Boundary
* Standard IEEE 754 Float64 provides 53 bits of significand ($\approx 15.95$ decimal digits) and an 11-bit exponent ($10^{-308}$ to $10^{+308}$).
* In naive direct evaluation, coordinates are stored as absolute numbers:
  $$x_{\text{pixel}} = x_{\text{center}} + \Delta x$$
  When $\text{zoom} \ge 10^{15}$, $\Delta x \le 10^{-16}$. In floating-point arithmetic:
  $$x_{\text{center}} + \Delta x == x_{\text{center}}$$
  The entire 53-bit mantissa is absorbed by $x_{\text{center}}$, producing pixelation and rendering failure.

### 2.2 The Perturbation Solution: Relative Coordinates
* Instead of storing absolute coordinates per pixel, pixels store the relative displacement $\delta = (\delta_x, \delta_y)$ from the viewport center $Z_0$:
  $$\delta_x = \left(\frac{X + 0.5}{\text{width}} - 0.5\right) \cdot \text{span}_x$$
  $$\delta_y = \left(0.5 - \frac{Y + 0.5}{\text{height}}\right) \cdot \text{span}_y$$
* Because $\delta$ is centered at zero ($0 \pm \delta$), its value (e.g. $10^{-50}$) uses the **full 53 bits of mantissa** and simply uses a smaller exponent.
* All millions of screen pixels compute relative perturbation $\varepsilon_n$ using standard fast Float64 arithmetic down to $10^{-300}$.

### 2.3 Arbitrary-Precision Reference Center ($10^{15}$ to $10^{100+}$)
* To place the reference center at an exact coordinate with $>16$ digits (e.g. $100$ decimal digits), only **one single orbit** ($Z_0 \to Z_N$) needs multi-precision arithmetic.
* **Pure JS Multi-Limb Implementation**:
  - A lightweight fixed-point limb vector using `BigInt` (each 64-bit integer representing a base-$2^{32}$ limb).
  - Computing 1 single orbit of length $N=200$ takes $< 1\text{ms}$ in JS.
  - The resulting reference orbit points $Z_0, Z_1, \dots, Z_N$ and derivatives $A_n, B_n, C_n$ are exported as standard `Float64Array` buffers to Web Workers.

---

## 3. Mathematical Formulation: Universal Variational Recurrence

### 3.1 The Iterative System
Consider a general complex dynamic iteration:
$$z_{n+1} = f(z_n, c)$$
where:
* $z_n \in \mathbb{C}$ is the dynamical state.
* $c \in \mathbb{C}$ is the parameter (for parameter planes $c = z_0$; for input planes $c$ is a constant/external parameter).

Let $Z_0$ be the center of the viewport, with reference orbit:
$$Z_{n+1} = f(Z_n, C_0)$$

For any pixel at $z_0 = Z_0 + \delta$ with parameter $c = C_0 + \delta_c$:
$$z_n = Z_n + \varepsilon_n$$

### 3.2 Taylor Series Variational Recurrence
Expanding $f(Z_n + \varepsilon_n, C_0 + \delta_c)$ in a 2D complex Taylor series around $(Z_n, C_0)$:
$$\varepsilon_{n+1} = A_n \varepsilon_n + B_n \delta_c + C_n \varepsilon_n^2 + D_n \varepsilon_n \delta_c + E_n \delta_c^2 + \mathcal{O}(\|\varepsilon\|^3)$$

For single-parameter iterations, the second-order system is:
$$\varepsilon_{n+1} = A_n \varepsilon_n + B_n \delta + C_n \varepsilon_n^2$$
where the Taylor coefficients along the reference orbit are:
$$A_n = \frac{\partial f}{\partial z}(Z_n, C_0) \approx \frac{f(Z_n + h, C_0) - f(Z_n - h, C_0)}{2h}$$
$$B_n = \frac{\partial f}{\partial c}(Z_n, C_0) \approx \frac{f(Z_n, C_0 + h) - f(Z_n, C_0 - h)}{2h}$$
$$C_n = \frac{1}{2} \frac{\partial^2 f}{\partial z^2}(Z_n, C_0) \approx \frac{f(Z_n + h, C_0) - 2f(Z_n, C_0) + f(Z_n - h, C_0)}{2h^2}$$
$$(h = 10^{-7} \cdot \max(1.0, |Z_n|))$$

---

## 4. Comprehensive Edge-Case Handling

### 4.1 State Initialization: Input Space vs. Parameter Space
* **Zero-Seed / Parameter Plane (e.g. Mandelbrot)**:
  - Both the center and the pixel start at initial state $z_0 = 0 \implies \varepsilon_0 = 0$.
  - The parameter is $c = \text{point} = C_0 + \delta \implies \delta_c = \delta$.
  - Recurrence: $\varepsilon_0 = 0, \quad \varepsilon_1 = B_0 \delta$.
* **Non-Zero Seed / Input State Plane (e.g. $w = \tan(\sec(z))$, $w = \cos(z)$, polynomials)**:
  - The pixel's starting coordinate is $z_0 = \text{center} + \delta \implies \varepsilon_0 = \delta$.
  - The function is autonomous ($B_n = 0$).
  - Recurrence: $\varepsilon_0 = \delta, \quad \varepsilon_1 = A_0 \delta + C_0 \delta^2$.

```javascript
// Rule: Perturbation seed selection
const ezRe = isZeroSeed ? 0.0 : deltaRe;
const ezIm = isZeroSeed ? 0.0 : deltaIm;
```

---

### 4.2 Viewport Span Thresholding (Direct vs. Perturbation)
* **The Constraint**: Perturbation Taylor expansions are only valid when $|\varepsilon_n| \ll 1$.
* **Wide Viewport ($\text{span} \ge 10^{-4}$ / $\text{zoom} < 10^4$)**:
  - $\delta$ is large ($10^{-3}$ to $10^{1}$).
  - Perturbation Taylor series introduces truncation error if evaluated over wide bounds.
  - **Strategy**: Evaluate every pixel **directly** ($z_{n+1} = f(z_n)$). Direct evaluation takes $< 10\text{ms}$ per tile in JS TypedArrays and is 100% exact with zero center bias.
* **Deep Zoom Viewport ($\text{span} < 10^{-4}$ / $\text{zoom} \ge 10^4$)**:
  - $\delta$ is microscopic ($< 10^{-4}$).
  - Taylor series expansion is mathematically exact and avoids FP64 subtraction cancellation.
  - **Strategy**: Evaluate pixels via the variational recurrence $\varepsilon_{n+1} = A_n \varepsilon_n + B_n \delta + C_n \varepsilon_n^2$.

---

### 4.3 Composite Factor Chaining Pipeline
When composing sub-functions (e.g. $f(z) = \tan(\sec(z))$ where Factor = $\tan$, Chain = $[\sec]$):
1. The inner chain pipeline transforms the input: $u = \sec(z)$.
2. The outer factor function is evaluated on the transformed result: $w = \tan(u)$.
3. If $f$ is raised to a power $p$: $w = w^p$.
4. If reciprocal, logarithm, or exponential flags are set: apply sequentially.

```javascript
function evaluateFactor(factor, z, c) {
    let argument = z;
    if (Array.isArray(factor.chain) && factor.chain.length > 0) {
        for (const step of factor.chain) {
            argument = evaluateBaseFunction(step, argument, c);
        }
    }
    let value = evaluateBaseFunction(factor.func, argument, c);
    if (factor.power !== 1.0) value = complexPow(value, factor.power);
    if (factor.reciprocal) value = complexReciprocal(value);
    if (factor.log) value = complexLog(value);
    if (factor.exp) value = complexExp(value);
    return value;
}
```

---

### 4.4 Singularity, Pole & Bailout Management
* **Finite Checks**: Verify `Number.isFinite(re) && Number.isFinite(im)` on every step.
* **Gradient Bounding**: If $|A_n|^2 > 10^{20}$, mark the reference orbit as bailed out at step $n$ and fallback to direct pixel iteration for residual steps.
* **Escape Bailout**: If $|z|^2 \ge \text{BAILOUT\_RADIUS}^2$ ($10^{12}$), stop iteration and calculate smooth continuous escape index:
  $$\nu = n + 1 - \frac{\ln(\ln(|z|))}{\ln(2)}$$

---

## 5. Viewport & Coordinate Architecture: Preventing Drift and Rotation

To guarantee that the Cartesian grid, axes, labels, mouse probes, and domain coloring stay locked pixel-for-pixel:

### 5.1 Single Authoritative Coordinate Frame
Maintain one single source of truth for the plane:
* `origin.x`, `origin.y`: Canvas pixel position of $(0, 0)$.
* `scale.x`, `scale.y`: Pixels per mathematical unit.
* `width`, `height`: Canvas buffer dimensions.

```javascript
export function updatePlaneViewportRanges(planeParams) {
    const { origin, scale, width, height } = planeParams;
    planeParams.xRange[0] = (0 - origin.x) / scale.x;
    planeParams.xRange[1] = (width - origin.x) / scale.x;
    planeParams.yRange[0] = (origin.y - height) / scale.y;
    planeParams.yRange[1] = (origin.y - 0) / scale.y;
}

export function mapCanvasToWorld(cX, cY, planeParams) {
    return {
        x: (cX - planeParams.origin.x) / planeParams.scale.x,
        y: (planeParams.origin.y - cY) / planeParams.scale.y
    };
}
```

### 5.2 Cursor-Anchored Interaction
* **Panning**:
  $$\text{origin.x} = \text{origin}_{\text{start}}.x + \Delta X$$
  $$\text{origin.y} = \text{origin}_{\text{start}}.y + \Delta Y$$
* **Zooming (Anchored to Cursor Position $(P_x, P_y)$)**:
  1. Determine cursor mathematical position: $W = \text{mapCanvasToWorld}(P_x, P_y)$.
  2. Scale the pixel density: $\text{scale}' = \text{scale} \cdot \text{factor}$.
  3. Recompute origin so $W$ stays under $(P_x, P_y)$:
     $$\text{origin.x} = P_x - W_x \cdot \text{scale}'.x$$
     $$\text{origin.y} = P_y + W_y \cdot \text{scale}'.y$$
  4. Call `updatePlaneViewportRanges(planeParams)`.

---

## 6. Immediate 60fps Rendering Pipeline

```
[User Pan / Zoom Event]
       │
       ▼
[Update origin & scale] ──► [Immediate Scaled Canvas Blit (0ms Latency)]
       │
       ▼
[Pass 1: 16x Coarse Pass (~2ms)] ──► [Draw scaled pass to canvas]
       │
       ▼
[Pass 2: 4x Medium Pass (~8ms)] ───► [Draw scaled pass to canvas]
       │
       ▼
[Pass 3: 1x Full Resolution Pass (~25ms)] ──► [Draw crisp pixels to canvas]
       │
       ▼
[Deferred Quality Refinement Pass (Subpixel Anti-Aliasing on Edges)]
```

### 6.1 Buffer Pooling & Zero GC
* Pre-allocate reusable `OffscreenCanvas` objects for Pass 16x, Pass 4x, and Pass 1x.
* Pre-allocate `Uint32Array` pixel buffers and reuse them across tiles to eliminate garbage collection pauses during continuous interaction.
* When a new frame starts, cancel pending worker queues and overwrite buffers in-place without allocating new typed arrays.

### 6.2 Seamless Compositing
* Never clear the target canvas between progressive passes.
* Draw the active pass scaled up using bilinear interpolation (`ctx.imageSmoothingEnabled = true`) until the higher-resolution pass finishes, guaranteeing uninterrupted visual continuity.

---

## 7. Implementation Plan & File Structure

### Module 1: `js/engine/perturbation-core.js`
- **Data Structures**:
  - `ReferenceOrbit`: Pre-allocated `Float64Array` arrays (`zRe`, `zIm`, `aRe`, `aIm`, `bRe`, `bIm`, `cRe`, `cIm`, `valid`).
- **Core Functions**:
  - `computeReferenceOrbit(config, centerRe, centerIm, depth)`
  - `evaluateVariationalStep(orbit, step, ezRe, ezIm, deltaRe, deltaIm)`
  - `computeNumericJacobian(fn, z, c)`

### Module 2: `js/rendering/domain-dynamics-worker.js`
- Web Worker execution loop:
  - Receives tile coordinates, resolution scale, and orbit data.
  - If `xSpan >= 1e-4`: Runs direct evaluation loop across tile pixels.
  - If `xSpan < 1e-4`: Runs variational recurrence loop.
  - Colors pixels using precomputed palette LUT and transfers `ArrayBuffer` back to main thread.

### Module 3: `js/rendering/domain-dynamics.js`
- Coordinates multi-pass scheduler ($16\times \to 4\times \to 1\times$).
- Manages canvas buffer pooling and pass compositing.

### Module 4: `js/ui/event-listeners.js` & `js/utils/canvas-utils.js`
- Unified interaction handlers ensuring `origin`, `scale`, and viewport bounds remain synchronized across all visual layers.
