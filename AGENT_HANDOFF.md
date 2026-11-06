# Agent Handoff — Unified Bend-Proved Domain Coloring

## 0. Setup (mandatory, do first)
Bend is installed with its official installer. It provides a `bend` CLI (`bend update` upgrades it).
```bash
curl -fsSL https://bend-lang.com/install.sh | sh   # skip if `bend version` already works
bend version
npm install
npm run verify:bend       # must print ALL PROOFS CHECK (65 laws) and the harness summary
npm test                  # all tests pass
npm run build
```
Proofs were checked on Bend 2.0.39. After any Bend upgrade, re-run `npm run verify:bend`.

### First task: switch the repo from the vendored Bend runtime to the `bend` CLI
Currently `package.json` scripts, `benchmark_harness.mjs` and `scripts/setup-bend.sh` call `bun public/bend/bend2/main.ts <file>`, which relies on a copied runtime in `public/bend/` (git-ignored). Replace that with the installed CLI:
1. `package.json`: `verify:bend` → `bend public/bend_complex_plane/PROOF.bend && node benchmark_harness.mjs`; `build:bend` → same two commands with `bend <file> -o <out>` (keep the existing `-o` targets).
2. `benchmark_harness.mjs`: replace the `bun public/bend/bend2/main.ts public/bend_complex_plane/PROOF.bend` call (the `bunCmd`/`execSync` near the proof check) with `bend public/bend_complex_plane/PROOF.bend`.
3. `scripts/setup-bend.sh`: reduce to "install `bend` with the official installer if missing, then run the PROOF.bend check". Remove the clone/copy logic.
4. Delete `public/bend/` (and then its line in `.gitignore`). `.bend/` stays ignored.
5. Confirm `npm run verify:bend`, `npm run build:bend`, `npm test`, `npm run build` still pass and `js/rendering/bend_engine.mjs` regenerates without diff noise.

## 1. Codebase
Domain coloring is one unified WebGL2 pipeline. No fallback, no dual pipeline, no CPU path. Mandelbrot and Newton are ordinary uses of it (algebraic chaining + zero-seed/recursion + escape/attractor mode).
- `js/rendering/domain-coloring.js`: 96-bit quad-single (`cqs`) GLSL, AST→GLSL compiler (`astToGLSL`, `peelUnaryAndPowerStages`, `compileStateToUnifiedExpression`), single flat-loop compute shader (`buildComputeShader`), display shader, frame controller (`stepWorkstationFrame`), BigInt camera.
- `public/bend_complex_plane/{main,LAWS,PROOF}.bend`: Bend 2 model + 65 proved laws for the pipeline (UI state machine, batch cap, step counts, arithmetic). Compiled to `js/rendering/bend_engine.mjs` (`npm run build:bend`; commit the output).
- `js/rendering/{renderer,redraw-scheduler}.js`, `js/frontend/actions.js`, `js/analysis/fractal-presets.js`: integration, interaction, presets.
- `benchmark_harness.mjs`: proof check + static GLSL/UI audits + benchmarks.

Only the domain-coloring pipeline is proved in Bend. No UI changes are wanted.

## 2. Completed
- All functions compile and render in a headless render sweep: cos sin tan sec exp ln sinh tanh asin atan power mobius zeta bessel polynomial, Mandelbrot, Newton. (Gamma/loggamma: see below.)
- Progressive streaming of chained jobs: `fbos.hasDisplay` is true only when `remaining_steps === 0`; presenter shows the live compute buffer otherwise.
- Adaptive 120 FPS controller, one batch per frame, no `clientWaitSync`/`fenceSync`, immediate preempt on any camera/param change.
- Stage uniforms (`u_innerStageCounts/Pows`), constant-operand fast paths, fused SOS/diff-sq, single-branch `cds_zeta_ac`.
- Bend laws 1..65 proved, incl. 120 FPS budget and zero-recompile reconfiguration.

## 3. Remaining work (priority order)
1. **Gamma / loggamma render blank** in headless software GL (browser also hangs). Verify on a real GPU. If broken, debug `cds_gamma` / `cds_loggamma_rhp` and `needsGammaBessel` in `buildComputeShader`; check shader cost (`isHeavy` → batch size).
2. **Fractal interaction parity**: `updateProbe` / `handleCanvasMoveNow` in `js/frontend/actions.js` disable the hover probe whenever `state.chainingEnabled`. Pan, zoom, probe and axes must behave identically for every function. Audit `renderer.js` / `view-model.js` for other chaining- or fractal-specific canvas branches and `empty_grid` handling in `fractal-presets.js`.
3. **Continuous streaming loop**: frames are currently driven by `requestDomainRedraw` plus `scheduleWorkstationFrame`. Make rendering one continuous rAF loop that always presents the latest compute buffer; confirm the scheduler's `domainColoringDirty` handling never starves compute.
4. **WebGL lifecycle**: context loss/restore (clear `shaderCache`, null FBOs, recompile) and explicit deletion of programs, FBO textures, palette texture, VAO/VBO on canvas change or dispose.
5. **Function and mode audit**: every function × {value, escape, attractor} × chain depth × derivative × Taylor × multi-term algebraic × custom z-expression × branch cut / exp-log base / zeta continuation. Known limit: in `emitAlgebraicChainingDecomposed`, nested multi-step chaining applies only in recurrence mode 0 and not for derivative.
6. **Deep zoom and caps**: verify zoom/pan to ~1e-100 through `centerBigX/Y`, `scaleMant/Exp10`; check chain-depth limits in `js/constants/domain-dynamics.js` and `js/native/complex-engine.js` (≤3000).
7. Remove any leftover legacy or fallback code (`grep -ri "fallback\|legacy"`).

## 4. Do not break
- `npm run verify:bend`, `npm test`, `npm run build` stay green. After editing any `.bend` file run `npm run build:bend` and commit the new `bend_engine.mjs`.
- `benchmark_harness.mjs` greps `domain-coloring.js`. Keep: `qs_sum_sq_presplit`, `qs_diff_sq_presplit`, `qs_renorm_fast`, `qs_exp_scalar`, `u_innerStageCounts`, `live_ui_120fps_batch_cap`, `adaptiveBatchScale`, `peelUnaryAndPowerStages`, exactly two `cds_zeta_rhp(`; and the snippets `bendEngine.live_ui_step_batch(liveUI, batchCap)`, `live_ui_set_depth(liveUI, nextCount)`, `live_ui_must_present(didGlWork, liveUI)`, `const stateFbo = fbos.hasDisplay ? fbos.display : latestComputeFbo`. Never add `clientWaitSync`, `fenceSync`, `shade_mandelbrot`, `shade_newton`, `quick_two_sum`, `FOLD_PRIME`, `u_usePerturb`, `refOrbitTex`.
- GLSL: `fence1(x) = x + u_zero` barriers in two_sum/split/tp_fast; 3-FBO atomic swap on completion; `preserveDrawingBuffer: true`; no SSAA or batch switching during interaction.
- Pinned tests: Mandelbrot `batchSize` = 24; `eval_full(cqs z, cqs c_coord, int stepInCycle)`; shaderKey `outer::[stageSig::]inner`.
- Total steps = Bend `live_ui_total_steps` × `outerChainCount`.
- `domain-coloring.js` uses CRLF line endings; preserve them. Make surgical edits, don't rewrite files.

## 5. How to verify your work
1. `npm run verify:bend && npm test && npm run build`.
2. `npm run dev -- --host 127.0.0.1 --port 4173` (base path `/complex-plane/`). Headless Chromium needs `--use-angle=swiftshader --enable-unsafe-swiftshader` (slow for heavy shaders).
3. Render check per function: set `state.domainColoringEnabled = true` (`import('./js/store/state.js')`), click `#select_<fn>_btn` (fn: cos sin tan sec exp ln sinh tanh asin atan power mobius zeta gamma loggamma bessel polynomial mandelbrot newton_fractal), wait, then draw `#z_plane_domain_canvas` onto a 2D canvas and read pixels (not uniform, not all dark). Also fail on any console error ("GLSL compile error").
4. Streaming check for Mandelbrot/Newton: sample canvas pixels every few seconds while `completedSteps < activeTotalSteps`; colour must appear before completion.
5. Interaction: pan/zoom on a fractal and on `cos`; behaviour and probe must match.
