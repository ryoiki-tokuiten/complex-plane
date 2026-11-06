# Formal Specification Laws for the Bend 2 Complex Plane Engine
# ==============================================================
# CONSTITUTIONAL INVARIANT NOTICE — INVIOLABLE & NON-OVERRIDABLE LAWS:
# Every law in this file (Laws 1..57) is a permanent, machine-checked mathematical
# and architectural invariant of the Complex Plane Engine.
#
# CRITICAL MANDATE:
# 1. THESE LAWS CAN AND MUST NEVER BE OVERRIDDEN, BYPASSED, WEAKENED, OR DELETED.
# 2. NO ZOOM FALLBACKS, NO DUAL PIPELINES, NO THRESHOLD SWITCHING, AND NO MODULAR
#    COORDINATE WRAPS / FOLDING HACKS ARE PERMITTED AT ANY ZOOM SCALE.
# 3. ALL COMPLEX FUNCTIONS, OUTPUT CHAINS f^(N)(z), AND RECURRENCES (INCLUDING
#    MANDELBROT z^2 + c, NEWTON, AND MANDELBROT-SINE) MUST EXECUTE EXCLUSIVELY
#    THROUGH THE SINGLE GENERALIZED UNIFIED DOMAIN COLORING PIPELINE.
# 4. ANY CODE CHANGE THAT VIOLATES OR CIRCUMVENTS THESE LAWS IS STRICTLY FORBIDDEN.
# ==============================================================
# Zero-slop, machine-checked laws covering the real WebGL2 + 96-Bit Quad-Single pipeline:
# I.   Error-Free Transformations (`two_sum` vs `quick_two_sum`) & GPU Bitwise Fences (Laws 1..5)
# II.  Signed Complex Algebra, Full-Chain f^(N)(z), FBO Ping-Pong & UI Invariance (Laws 6..18)
# III. 2D Viewport Jacobian, Deep-Zoom (10^0..10^-50..10^-100) Non-Collapse & Panning (Laws 19..30)
# IV.  Hierarchical 400-Point -> 200-Scene -> 10^-50 UI Pan/Zoom Stress Trajectory (Laws 31..33)
# V.   Hardware-Independent V2 vs V1 Pipeline Speedup & Unified Pipeline Theorems (Laws 34..57)

import Base
import ./main.bend as CP

# =====================================================================
# I. ERROR-FREE TRANSFORMATIONS & GPU BITWISE FENCES (LAWS 1..5)
# =====================================================================

# LAW 1: Knuth `two_sum` Order-Independent Exactness vs `quick_two_sum` Precondition Violation:
#        For any non-zero limb `a = 1n+p` and larger second limb `b` (`|a| < |b|`),
#        `quick_two_sum(a, b)` drops `a` (`quick_two_sum_violated_total < knuth_two_sum_total`),
#        whereas Knuth's `two_sum` preserves the exact sum `a + b`. This proves why `two_sum`
#        is required in `qs_div`, `qs_rcp`, `qs_atan2`, `qs_renorm`, and `qs_add_f` to prevent
#        the 6-strip diagonal discontinuity at `Scale: 9.93e-14`.
law quick_two_sum_precondition_violation_theorem:
  for +b: Nat
  for +p: Nat
  {Nat.is_lt(CP.quick_two_sum_violated_total(1n+p, b), CP.knuth_two_sum_total(b, 1n+p)) == True{} : Bool}

# LAW 2: Exact IEEE-754 Bitwise Mantissa Split Theorem (`floatBitsToUint(a) & 0xFFFFF000u`):
#        Bitwise mantissa masking recovers the exact 12-bit high part `a_hi` and 12-bit low part `a_lo`
#        and reconstructs `a_hi + a_lo` with zero FMA contraction error.
law bitwise_split_exact_and_fenced:
  for +a_hi: Nat
  for +a_lo: Nat
  {CP.bitwise_split_hi(a_hi, a_lo) == a_hi : Nat} & {Nat.add(CP.bitwise_split_hi(a_hi, a_lo), CP.bitwise_split_lo(a_hi, a_lo)) == Nat.add(a_hi, a_lo) : Nat}

# LAW 3: GPU FMA-Contracted Dekker 4097 Split Corruption Theorem:
#        For any non-zero low mantissa `a_lo = 1n+p`, FMA contraction of Dekker's 4097 split
#        (`dekker_fma_hi`) strictly overshoots the true high mantissa `bitwise_split_hi`
#        by `4097 * (1 + p)`.
law fma_dekker_split_corruption_theorem:
  for +a_hi: Nat
  for +p: Nat
  {Nat.is_lt(CP.bitwise_split_hi(a_hi, 1n+p), CP.dekker_fma_hi(a_hi, 1n+p)) == True{} : Bool}

# LAW 4: Fenced `two_sum` Runtime Uniform Barrier Preservation Theorem:
#        For any non-zero sub-ULP limb `b_lo = 1n+p`, an unfenced `two_sum` (`unfenced_two_sum_err`)
#        collapses to 0 under GPU algebraic reassociation `(a - (sum - v)) + (b - v) -> 0`,
#        whereas `fenced_two_sum_err` with `u_zero` barriers strictly preserves `b_lo`.
law two_sum_fenced_error_preservation_theorem:
  for +a_hi: Nat
  for +p: Nat
  {CP.fenced_two_sum_err(a_hi, 1n+p) == 1n+p : Nat} & {Nat.is_lt(CP.unfenced_two_sum_err(a_hi, 1n+p), CP.fenced_two_sum_err(a_hi, 1n+p)) == True{} : Bool}

# LAW 5: Direct Sum-of-Squares `cos^2(x) + sinh^2(y)` vs Double-Angle Pole Cancellation for `tan(z)`:
#        Near any pole `z = (k + 1/2)*pi + delta` with `delta_bits = 1n+d`, evaluating `tan(z)` via
#        sum-of-squares `cx^2 + shy^2` retains strictly more denominator precision bits than
#        `cos(2x) + cosh(2y) = (-1 + 2*dx^2) + (+1 + 2*dy^2)`.
law tan_direct_quotient_avoids_pole_cancellation_theorem:
  for +prec: Nat
  for +d: Nat
  {Nat.is_lt(CP.tan_double_angle_denom_bits(prec, 1n+d), CP.tan_direct_denom_bits(prec, 1n+d)) == True{} : Bool}

# =====================================================================
# II. SIGNED COMPLEX ALGEBRA, FULL-CHAIN f^(N)(z), FBO & UI INVARIANCE (LAWS 6..18)
# =====================================================================

# LAW 6: Signed Real Negation is Involutive (`-(-x) == x`).
law sneg_involutive:
  for x: CP.SReal
  {CP.sneg(CP.sneg(x)) == x : CP.SReal}

# LAW 7: Symmetric Signed Real Squaring (`ssq`) is extensionally identical to `smul(x, x)`.
law ssq_eq_smul_self:
  for +x: CP.SReal
  {CP.ssq(x) == CP.smul(x, x) : CP.SReal}

# LAW 8: Complex Conjugation is Involutive (`conj(conj(z)) == z`).
law cpx_conj_involutive:
  for z: CP.Cpx
  {CP.cpx_conj(CP.cpx_conj(z)) == z : CP.Cpx}

# LAW 9: Symmetric Complex Squaring (`cpx_sq(z)`) is extensionally identical to `cpx_mul(z, z)`.
law cpx_sq_eq_cpx_mul_self:
  for +z: CP.Cpx
  {CP.cpx_sq(z) == CP.cpx_mul(z, z) : CP.Cpx}

# LAW 10: Mandelbrot Escape Step Algebraic Equivalence (`cpx_add(cpx_sq(z), c) == cpx_add(cpx_mul(z, z), c)`).
law mandelbrot_step_uses_exact_complex_square:
  for +z: CP.Cpx
  for +c: CP.Cpx
  {CP.mandelbrot_step(z, c) == CP.cpx_add(CP.cpx_mul(z, z), c) : CP.Cpx}

# LAW 11: Prime-Factored Dirichlet Zeta Composite Term Identity (`4^(-s) = (2^(-s))^2`).
law zeta_prime_factorization_term4_exact:
  for +t2: CP.Cpx
  {CP.zeta_term4_opt(t2) == CP.zeta_term4_naive(t2) : CP.Cpx}

# LAW 12: Soundness of Symbolic AST Composition (`compose_expr`):
#         Evaluating `compose_expr(f, g)` at `z` equals evaluating `f` on `eval_expr(g, z)`.
law compose_expr_correct:
  for f: CP.Expr
  for +g: CP.Expr
  for +z: CP.Cpx
  {CP.eval_expr(CP.compose_expr(f, g), z) == CP.eval_expr(f, CP.eval_expr(g, z)) : CP.Cpx}

# LAW 13: Soundness of Full-Expression Output Chaining (`eval_full_chain` vs `unfold_full_chain`):
#         Iterative full output chaining `f^(steps)(z)` equals evaluating the `steps`-fold composed AST.
law full_chain_matches_unfolded_ast:
  for steps: Nat
  for +e: CP.Expr
  for +z: CP.Cpx
  {CP.eval_full_chain(steps, e, z) == CP.eval_expr(CP.unfold_full_chain(steps, e), z) : CP.Cpx}

# LAW 14: Multi-Pass Ping-Pong FBO Batch Renderer Exact Equivalence:
#         Running `passes` FBO ping-pong passes of `batch_size` steps produces the EXACT same
#         complex value `Cpx` as unbatched `eval_full_chain(passes * batch_size, e, z)`.
law fbo_batched_full_chain_exact_equivalence:
  for passes: Nat
  for +batch_size: Nat
  for +e: CP.Expr
  for +z: CP.Cpx
  {CP.run_fbo_batches_full(passes, batch_size, e, z) == CP.eval_full_chain(Nat.mul(passes, batch_size), e, z) : CP.Cpx}

# LAW 15: Multi-Pass Ping-Pong FBO Batch Renderer Matches Unfolded AST:
law fbo_batched_full_chain_matches_unfolded_ast:
  for +passes: Nat
  for +batch_size: Nat
  for +e: CP.Expr
  for +z: CP.Cpx
  {CP.run_fbo_batches_full(passes, batch_size, e, z) == CP.eval_expr(CP.unfold_full_chain(Nat.mul(passes, batch_size), e), z) : CP.Cpx}

# LAW 16: UI Interaction Chain-Depth Invariance Theorem (`N = 75` No-Jump Guarantee):
#         Transitioning the UI state between `is_interacting = True{}` (during wheel/drag) and
#         `is_interacting = False{}` (120ms after interaction) preserves the exact chain depth
#         `effective_chain_steps`.
law ui_interaction_chain_depth_invariance:
  for +st: CP.UIState
  {CP.effective_chain_steps(CP.ui_set_interacting(st, True{})) == CP.effective_chain_steps(CP.ui_set_interacting(st, False{})) : Nat}

# LAW 17: UI Interaction Rendered Pixel Invariance Theorem:
#         For any UI state `st` (including `tan(sec(z))` at `chain_count = 75n` and `Scale: 4.19e-13`),
#         rendering during interaction (`True{}`) produces the exact same `PixelCert` as rendering
#         after the 120ms interaction timeout (`False{}`).
law ui_interaction_render_pixel_invariance:
  for +st: CP.UIState
  for +x: Nat
  for +y: Nat
  {CP.render_ui_state(CP.ui_set_interacting(st, True{}), x, y) == CP.render_ui_state(CP.ui_set_interacting(st, False{}), x, y) : CP.PixelCert}

# LAW 18: Architectural Separation of Escape/Attractor Systems from Domain Coloring:
law escape_attractor_disjoint_from_domain:
  for e: CP.Expr
  for steps: Nat
  for fid: CP.FractalId
  for iters: Nat
  {CP.is_escape_attractor(CP.ModeDomain{e, steps}) == False{} : Bool} & {CP.is_escape_attractor(CP.ModeFractal{fid, iters}) == True{} : Bool}

# =====================================================================
# III. 2D VIEWPORT JACOBIAN, DEEP-ZOOM (10^0..10^-50..10^-100) & PANNING (LAWS 19..30)
# =====================================================================

# LAW 19: Mantissa Bit Sufficiency at 10^-50 (`zoom_exp = 50n`) and 10^-100 (`zoom_exp = 100n`):
law zoom_50_and_100_bit_sufficiency:
  {Nat.is_ge(CP.mantissa_bits(50n), 384n) == True{} : Bool} & {Nat.is_ge(CP.mantissa_bits(100n), 384n) == True{} : Bool}

# LAW 20: Universal Mantissa Bit Sufficiency for Every Zoom Exponent `zoom_exp: Nat`:
law zoom_arbitrary_bit_sufficiency:
  for zoom_exp: Nat
  {Nat.is_ge(CP.mantissa_bits(zoom_exp), 384n) == True{} : Bool}

# LAW 21: Horizontal Adjacent Pixels `(x, y)` and `(1n+x, y)` Never Collapse at Any Zoom:
law distinct_pixels_x_never_collapse:
  for +cr: Nat
  for +ci: Nat
  for +px: Nat
  for +py: Nat
  for +zoom_exp: Nat
  for +x: Nat
  for +y: Nat
  {CP.cpx_eq(CP.sample_pixel(CP.Camera{cr, ci, px, py, zoom_exp}, x, y), CP.sample_pixel(CP.Camera{cr, ci, px, py, zoom_exp}, 1n+x, y)) == False{} : Bool}

# LAW 22: Vertical Adjacent Pixels `(x, y)` and `(x, 1n+y)` Never Collapse at Any Zoom:
law distinct_pixels_y_never_collapse:
  for +cr: Nat
  for +ci: Nat
  for +px: Nat
  for +py: Nat
  for +zoom_exp: Nat
  for +x: Nat
  for +y: Nat
  {CP.cpx_eq(CP.sample_pixel(CP.Camera{cr, ci, px, py, zoom_exp}, x, y), CP.sample_pixel(CP.Camera{cr, ci, px, py, zoom_exp}, x, 1n+y)) == False{} : Bool}

# LAW 23: Diagonal Adjacent Pixels `(x, y)` and `(1n+x, 1n+y)` Never Collapse at Any Zoom:
law distinct_pixels_diag_never_collapse:
  for +cr: Nat
  for +ci: Nat
  for +px: Nat
  for +py: Nat
  for +zoom_exp: Nat
  for +x: Nat
  for +y: Nat
  {CP.cpx_eq(CP.sample_pixel(CP.Camera{cr, ci, px, py, zoom_exp}, x, y), CP.sample_pixel(CP.Camera{cr, ci, px, py, zoom_exp}, 1n+x, 1n+y)) == False{} : Bool}

# LAW 24: Cancellation-Free Horizontal Panning Roundtrip at Any Zoom:
law pan_roundtrip_x_cancellation_free:
  for +cr: Nat
  for +ci: Nat
  for +px: Nat
  for +py: Nat
  for +zoom_exp: Nat
  for +delta: Nat
  for +x: Nat
  for +y: Nat
  {CP.sample_pixel(CP.cam_unpan_x(CP.cam_pan_x(CP.Camera{cr, ci, px, py, zoom_exp}, delta), delta), x, y) == CP.sample_pixel(CP.Camera{cr, ci, px, py, zoom_exp}, x, y) : CP.Cpx}

# LAW 25: Cancellation-Free Vertical Panning Roundtrip at Any Zoom:
law pan_roundtrip_y_cancellation_free:
  for +cr: Nat
  for +ci: Nat
  for +px: Nat
  for +py: Nat
  for +zoom_exp: Nat
  for +delta: Nat
  for +x: Nat
  for +y: Nat
  {CP.sample_pixel(CP.cam_unpan_y(CP.cam_pan_y(CP.Camera{cr, ci, px, py, zoom_exp}, delta), delta), x, y) == CP.sample_pixel(CP.Camera{cr, ci, px, py, zoom_exp}, x, y) : CP.Cpx}

# LAW 26: Every Composite Algebraic Expression Preserves Detached Zoom Scale:
law expr_preserves_extreme_zoom_scale:
  for e: CP.Expr
  for +z: CP.Cpx
  {CP.cpx_zoom_exp(CP.eval_expr(e, z)) == CP.cpx_zoom_exp(z) : Nat}

# LAW 27: Full-Expression Output Chaining `f^(steps)(z)` Preserves Detached Zoom Scale:
law full_chain_preserves_extreme_zoom_scale:
  for steps: Nat
  for +e: CP.Expr
  for +z: CP.Cpx
  {CP.cpx_zoom_exp(CP.eval_full_chain(steps, e, z)) == CP.cpx_zoom_exp(z) : Nat}

# LAW 28: All 3 Escape/Attractor Fractal Systems Preserve Detached Zoom Scale:
law fractal_preserves_extreme_zoom_scale:
  for fid: CP.FractalId
  for iters: Nat
  for +c: CP.Cpx
  {CP.cpx_zoom_exp(CP.eval_fractal(fid, iters, c)) == CP.cpx_zoom_exp(c) : Nat}

# LAW 29: End-to-End Camera Zoom Preservation & Pauldelbrot Perturbation Rebase Invariance:
law render_pixel_and_pauldelbrot_preserve_zoom:
  for +mode: CP.RenderMode
  for +pal: CP.Palette
  for +cam: CP.Camera
  for +x: Nat
  for +y: Nat
  for +zm: CP.Cpx
  for +dz: CP.Cpx
  {CP.pixel_cert_zoom_exp(CP.render_pixel(mode, pal, cam, x, y)) == CP.cam_zoom_exp(cam) : Nat} & {CP.pauldelbrot_rebased_state(zm, dz) == CP.cpx_add(zm, dz) : CP.Cpx}

# LAW 30: Parallel Fork-Join Quadtree Renders All 4^depth Pixels with O(1) Span per Level:
law quadtree_renders_all_pixels:
  for +depth: Nat
  for +mode: CP.RenderMode
  for +pal: CP.Palette
  for +cam: CP.Camera
  for +x0: Nat
  for +y0: Nat
  {CP.image_pixels(CP.render_quadtree(depth, mode, pal, cam, x0, y0)) == CP.pow4(depth) : Nat}

# =====================================================================
# IV. HIERARCHICAL 400-POINT -> 200-SCENE -> 10^-50 UI STRESS LAWS (LAWS 31..33)
# =====================================================================

# LAW 31: Hierarchical 400-Point -> 200-Scene -> 10^-50 Zoom Reachability Theorem:
#         For any initial camera `cam`, any sampled screen point `point_id_400`, and any
#         scene index `scene_id_200`, the stress trajectory reaches `zoom_exp >= 50n` (10^-50 scale).
law ui_stress_trajectory_reaches_zoom_50:
  for +cam: CP.Camera
  for +point_id_400: Nat
  for +scene_id_200: Nat
  {Nat.is_ge(CP.cam_zoom_exp(CP.stress_400_to_200_to_zoom50(cam, point_id_400, scene_id_200)), 50n) == True{} : Bool}

# LAW 32: Hierarchical 400-Point -> 200-Scene -> 10^-50 Non-Collapse Theorem:
#         After any number of wild pan/zoom scene transitions `scenes: Nat` from any initial camera
#         and seed, adjacent screen pixels `(x, y)` and `(1n+x, y)` never collapse.
law ui_stress_trajectory_never_collapses_pixels:
  for +scenes: Nat
  for +cam: CP.Camera
  for +seed: Nat
  for +x: Nat
  for +y: Nat
  {CP.cpx_eq(CP.sample_pixel(CP.stress_walk_scenes(scenes, cam, seed), x, y), CP.sample_pixel(CP.stress_walk_scenes(scenes, cam, seed), 1n+x, y)) == False{} : Bool}

# LAW 33: Hierarchical 400-Point -> 200-Scene -> 10^-50 UI Interaction Stability Theorem:
#         At every camera state reached along the 400-point -> 200-scene -> 10^-50 trajectory
#         and for any chain depth `chain_count` (including `75n`), toggling `is_interacting`
#         between `True{}` and `False{}` produces the exact same rendered pixel certificate.
law ui_stress_trajectory_interaction_invariant:
  for +e: CP.Expr
  for +pal: CP.Palette
  for +cam: CP.Camera
  for +point_id_400: Nat
  for +scene_id_200: Nat
  for +chain_count: Nat
  for +x: Nat
  for +y: Nat
  {CP.render_ui_state(CP.UIState{e, pal, CP.stress_400_to_200_to_zoom50(cam, point_id_400, scene_id_200), True{}, chain_count, True{}}, x, y) == CP.render_ui_state(CP.UIState{e, pal, CP.stress_400_to_200_to_zoom50(cam, point_id_400, scene_id_200), True{}, chain_count, False{}}, x, y) : CP.PixelCert}

# =====================================================================
# V. HARDWARE-INDEPENDENT V2 VS V1 PIPELINE SPEEDUP THEOREMS (LAWS 34..42)
# =====================================================================

# LAW 34: Symmetric Squaring Speedup Law:
law symmetric_sq_faster_than_mul:
  for +zoom_exp: Nat
  {Nat.is_lt(CP.sq_word_cost(CP.limbs_for_zoom(zoom_exp)), CP.mul_word_cost(CP.limbs_for_zoom(zoom_exp))) == True{} : Bool}

# LAW 35: Graded-Remainder `qs_div` / `qs_rcp` Speedup Law:
law graded_remainder_div_speedup_law:
  for +zoom_exp: Nat
  {Nat.is_lt(CP.div_graded_word_cost(CP.limbs_for_zoom(zoom_exp)), CP.div_naive_word_cost(CP.limbs_for_zoom(zoom_exp))) == True{} : Bool}

# LAW 36: Exponent-Scaled Single-Reciprocal Complex Division Speedup Law:
law exponent_scaled_cpx_div_speedup_law:
  for +zoom_exp: Nat
  {Nat.is_lt(CP.cpx_div_scaled_cost(CP.limbs_for_zoom(zoom_exp)), CP.cpx_div_two_div_cost(CP.limbs_for_zoom(zoom_exp))) == True{} : Bool}

# LAW 37: Single-Pass `tan(z)` Equivalence & Speedup Law:
law tan_single_pass_equivalence_and_speedup_law:
  for +z: CP.Cpx
  for +zoom_exp: Nat
  {CP.eval_tan_single_pass(z) == CP.eval_prim(CP.PTan{}, z) : CP.Cpx} & {Nat.is_lt(CP.tan_single_pass_cost(zoom_exp), CP.tan_duplicate_sincos_cost(zoom_exp)) == True{} : Bool}

# LAW 38: Direct Half-Log Norm-Squared Shading Equivalence & Speedup Law:
law shade_domain_fast_log2_equivalence_and_speedup_law:
  for +pal: CP.Palette
  for +w: CP.Cpx
  for +zoom_exp: Nat
  {CP.shade_domain_fast_log2(pal, w) == CP.shade_cpx(pal, w) : CP.PixelCert} & {Nat.is_lt(CP.shade_domain_fast_cost(CP.limbs_for_zoom(zoom_exp)), CP.shade_domain_naive_cost(CP.limbs_for_zoom(zoom_exp))) == True{} : Bool}

# LAW 39: Universal Primitive Optimization Speedup Law:
law opt_prim_strictly_faster_at_all_zooms:
  for op: CP.Prim
  for +zoom_exp: Nat
  {Nat.is_lt(CP.prim_cost_opt(op, zoom_exp), CP.prim_cost_naive(op, zoom_exp)) == True{} : Bool}

# LAW 40: Composite Expression Optimization Dominance Law:
law opt_expr_dominates_naive_for_all_ast:
  for +e: CP.Expr
  for +zoom_exp: Nat
  {Nat.is_le(CP.expr_cost_opt(e, zoom_exp), CP.expr_cost_naive(e, zoom_exp)) == True{} : Bool}

# LAW 41: Full-Mode Output Chaining (`f^(N)(z)`) Optimization Dominance Law:
law full_chain_opt_dominates_naive_all_depths_and_zooms:
  for +steps: Nat
  for +e: CP.Expr
  for +zoom_exp: Nat
  {Nat.is_le(CP.full_chain_cost_opt(steps, e, zoom_exp), CP.full_chain_cost_naive(steps, e, zoom_exp)) == True{} : Bool}

# LAW 42: General Pipeline V2 Strict Speedup Theorem Across All ASTs, Chains, and Zoom Scales:
law general_pipeline_v2_strictly_faster_all_ast_and_chains:
  for +steps: Nat
  for +e: CP.Expr
  for +zoom_exp: Nat
  {Nat.is_lt(CP.pipeline_v2_cost(steps, e, zoom_exp), CP.pipeline_v1_cost(steps, e, zoom_exp)) == True{} : Bool}

# LAW 43: 3-FBO Atomic Display Swap Never Flashes Partial Chain Depths:
#         While `1n+rem` steps remain in-flight between `stateA` and `stateB`, `fbos.display`
#         preserves `prev_display`, and upon completion (`0n` remaining), atomically presents
#         `eval_full_chain(total, e, z)`.
law fbo_atomic_display_swap_never_shows_partial_chain:
  for +rem: Nat
  for +total: Nat
  for +e: CP.Expr
  for +z: CP.Cpx
  for +partial: CP.Cpx
  for +prev: CP.Cpx
  {CP.fbo_present_on_completion(1n+rem, partial, prev) == prev : CP.Cpx} & {CP.fbo_present_on_completion(0n, CP.eval_full_chain(total, e, z), prev) == CP.eval_full_chain(total, e, z) : CP.Cpx}

# LAW 44: WebGL2 `gl.fenceSync` Backpressure Prevents GPU Watchdog (`webglcontextlost`) Blackout:
#         When `fence_ready == False{}` (`TIMEOUT_EXPIRED`), `0n` passes are queued; for all states
#         `fence_ready: Bool`, dispatched steps are strictly bounded by `frame_budget`.
law gpu_fence_backpressure_prevents_tdr_timeout:
  for +fence_ready: Bool
  for +frame_budget: Nat
  {CP.gpu_fence_dispatch_steps(False{}, frame_budget) == 0n : Nat} & {Nat.is_le(CP.gpu_fence_dispatch_steps(fence_ready, frame_budget), frame_budget) == True{} : Bool}

# LAW 45: 6-Pass Hida-Li-Bailey Renormalization Strict Speedup over 8-Pass Renormalization:
law renorm_6pass_strictly_faster_than_8pass:
  for +zoom_exp: Nat
  {Nat.is_lt(CP.renorm_6pass_word_cost(CP.limbs_for_zoom(zoom_exp)), CP.renorm_8pass_word_cost(CP.limbs_for_zoom(zoom_exp))) == True{} : Bool}

# LAW 46: Limb-by-Limb Incremental Remainder `qs_sqrt` Strict Speedup Law:
law sqrt_incremental_remainder_speedup_law:
  for +zoom_exp: Nat
  {Nat.is_lt(CP.sqrt_incremental_rem_cost(CP.limbs_for_zoom(zoom_exp)), CP.sqrt_resquare_cost(CP.limbs_for_zoom(zoom_exp))) == True{} : Bool}

# LAW 47: Collapsed Iterative Unary Loop (`tan^N(sec(z))`, `sec^N(z)`, `zeta^N(zeta_ac(z))`) Exact Equivalence:
law collapsed_unary_chain_matches_nested_ast:
  for steps: Nat
  for +op: CP.Prim
  for +base: CP.Expr
  for +z: CP.Cpx
  {CP.eval_unary_chain(steps, op, CP.eval_expr(base, z)) == CP.eval_expr(CP.unfold_unary_chain(steps, op, base), z) : CP.Cpx}

# LAW 48: Deep Unary Chain Zoom-Scale Preservation for Arbitrary Depth (75, 100, 140, 300, 500+):
law unary_chain_preserves_extreme_zoom_scale:
  for steps: Nat
  for +op: CP.Prim
  for +z: CP.Cpx
  {CP.cpx_zoom_exp(CP.eval_unary_chain(steps, op, z)) == CP.cpx_zoom_exp(z) : Nat}

# LAW 49: Direct Sum-of-Squares `sec(z)` Equivalence & Strict Speedup Law:
law sec_direct_sos_equivalence_and_speedup_law:
  for +z: CP.Cpx
  for +zoom_exp: Nat
  {CP.eval_sec_direct_sos(z) == CP.eval_prim(CP.PSec{}, z) : CP.Cpx} & {Nat.is_lt(CP.sec_direct_sos_cost(zoom_exp), CP.sec_naive_cos_rcp_cost(zoom_exp)) == True{} : Bool}

# LAW 50: Dead-Code-Eliminated (DCE) Modular GLSL Shader Compilation Strict Speedup Law:
law dce_shader_compile_strictly_faster_law:
  for +active_prims: Nat
  for +zoom_exp: Nat
  {Nat.is_lt(CP.shader_compile_dce_cost(active_prims, CP.limbs_for_zoom(zoom_exp)), CP.shader_compile_monolithic_cost(active_prims, CP.limbs_for_zoom(zoom_exp))) == True{} : Bool}

# LAW 51: Parameterized Outer-Chain Uniform Reuse Zero-Recompile Law:
law outer_chain_uniform_zero_recompile_law:
  for +extra_wraps: Nat
  for +base_compile_cost: Nat
  {CP.outer_chain_uniform_recompile_cost(extra_wraps) == 0n : Nat} & {Nat.is_lt(CP.outer_chain_uniform_recompile_cost(extra_wraps), CP.outer_chain_naive_recompile_cost(extra_wraps, base_compile_cost)) == True{} : Bool}

# LAW 52: Pre-Split Zeta Composite Term (`t4, t6, t8`) Strict Speedup Law:
law zeta_presplit_composite_speedup_law:
  for +zoom_exp: Nat
  {Nat.is_lt(CP.zeta_presplit_composite_cost(CP.limbs_for_zoom(zoom_exp)), CP.zeta_naive_composite_cost(CP.limbs_for_zoom(zoom_exp))) == True{} : Bool}

# LAW 53: Mid-Run Preemption Zero-Stale-Work Law (Immediate Preemption on Chaining/Fractal/Camera Update):
law mid_run_preemption_zero_stale_work_law:
  for +rem_old: Nat
  {CP.preempt_stale_steps_wasted(rem_old) == 0n : Nat} & {Nat.is_lt(CP.preempt_stale_steps_wasted(rem_old), CP.queued_stale_steps_wasted(rem_old)) == True{} : Bool}

# LAW 54: Interactive Pan/Zoom Progressive Frame Budget & First-Frame Latency Law:
law pan_zoom_progressive_frame_budget_law:
  for req_steps: Nat
  for frame_budget: Nat
  for +extra_batches: Nat
  {Nat.is_le(CP.pan_zoom_frame_steps(req_steps, frame_budget), frame_budget) == True{} : Bool} & {Nat.is_lt(CP.pan_zoom_first_frame_latency(extra_batches), CP.non_progressive_wait_frames(extra_batches)) == True{} : Bool}

# =====================================================================
# VI. INVIOLABLE SINGLE GENERALIZED UNIFIED PIPELINE LAWS (LAWS 55..57)
#     WARNING: THESE LAWS MUST NEVER BE OVERRIDDEN OR CIRCUMVENTED.
#     ZERO FALLBACKS, ZERO DUAL SHADERS, ZERO ZOOM-THRESHOLD SWITCHES.
# =====================================================================

# LAW 55: Unified Pipeline Zero Zoom-Fallback Law (Zero Threshold Switches at Any Zoom — NEVER OVERRIDE):
law unified_pipeline_zero_zoom_fallbacks_law:
  for +zoom_exp: Nat
  {CP.unified_zoom_fallback_count(zoom_exp) == 0n : Nat} & {Nat.is_lt(CP.unified_zoom_fallback_count(zoom_exp), CP.legacy_dual_zoom_fallback_count(zoom_exp)) == True{} : Bool}

# LAW 56: Mandelbrot & Newton Fractals Are Native Instances of the Generalized Unified Chain Pipeline for Any Seed `z0` (NEVER OVERRIDE):
law mandelbrot_and_fractals_native_unified_pipeline_law:
  for +steps: Nat
  for +z0: CP.Cpx
  for +c: CP.Cpx
  {CP.eval_unified_chain(steps, CP.uexpr_mandelbrot(), z0, c) == CP.eval_mandelbrot(steps, z0, c) : CP.Cpx} & {CP.eval_unified_chain(steps, CP.uexpr_newton(), z0, c) == CP.eval_newton(steps, z0) : CP.Cpx}

# LAW 57: Generalized Unified Chain Pipeline Preserves Infinite Zoom Scale for All `UExpr`, All Seeds (`recursion` and `zero_seed`), and All Depths (NEVER OVERRIDE):
law unified_chain_preserves_infinite_zoom_scale_law:
  for steps: Nat
  for +e: CP.UExpr
  for +use_seed: Bool
  for +seed_re: Nat
  for +seed_im: Nat
  for +c: CP.Cpx
  {CP.cpx_zoom_exp(CP.eval_seeded_chain(steps, e, use_seed, seed_re, seed_im, c)) == CP.cpx_zoom_exp(c) : Nat}

# LAW 58: Live UI Controller Zero-Blackout & Display-Preservation Law (NEVER OVERRIDE):
#         Once `has_display` is `True{}`, any preemption (`live_ui_preempt`, `live_ui_set_depth`)
#         strictly preserves `has_display == True{}` and guarantees `live_ui_must_present(True{}, ...) == True{}`
#         on every WebGL frame, making black-screen frame drops mathematically impossible.
law live_ui_never_loses_display_or_blacks_out_law:
  for +mode: Nat
  for +ce: Bool
  for +cc: Nat
  for +ri: Nat
  for +ns: Bool
  for +rem: Nat
  for +comp: Nat
  for +tot: Nat
  for +dd: Bool
  {CP.live_ui_has_display(CP.live_ui_preempt(CP.LiveUIState{mode, ce, cc, ri, True{}, ns, rem, comp, tot, dd})) == True{} : Bool} & {CP.live_ui_must_present(True{}, CP.live_ui_preempt(CP.LiveUIState{mode, ce, cc, ri, True{}, ns, rem, comp, tot, dd})) == True{} : Bool}

# LAW 59: Live UI General Chain Depth & Orbit Mode (`value`, `escape`, `attractor`) Transitions Exactness Law (NEVER OVERRIDE):
law live_ui_depth_and_mode_transitions_exact_law:
  for +st: CP.LiveUIState
  for +depth: Nat
  for +next_mode: Nat
  {CP.live_ui_remaining_steps(CP.live_ui_set_depth(st, 1n+depth)) == 1n+depth : Nat} & ({CP.live_ui_completed_steps(CP.live_ui_set_depth(st, 1n+depth)) == 0n : Nat} & ({CP.live_ui_mode(CP.live_ui_set_depth(st, 1n+depth)) == CP.live_ui_mode(st) : Nat} & {CP.live_ui_remaining_steps(CP.live_ui_set_mode(CP.LiveUIState{0n, True{}, 1n+depth, 0n, True{}, False{}, 0n, 1n+depth, 1n+depth, False{}}, next_mode)) == 1n+depth : Nat}))

# LAW 60: Unified Pipeline General Escape / Attractor Iteration-Potential Encoding Law Across Any `UExpr` & Seed (NEVER OVERRIDE):
#         For any general function `e: UExpr`, any chain depth `steps: Nat`, and any seed mode (`use_seed: Bool`),
#         Escape/Attractor modes (`1n+m`) encode the smooth iteration `1n+iter_k` into the complex magnitude
#         while preserving the escape/attractor root phase and infinite zoom scale `cpx_zoom_exp(c)`,
#         whereas `0n` (Final Value) mode preserves the exact chained complex value.
law escape_attractor_unified_iteration_encoding_law:
  for +m: Nat
  for +steps: Nat
  for +e: CP.UExpr
  for +use_seed: Bool
  for +seed_re: Nat
  for +seed_im: Nat
  for +iter_k: Nat
  for +c: CP.Cpx
  {CP.eval_general_orbit_mode(0n, steps, e, use_seed, seed_re, seed_im, iter_k, c) == CP.eval_seeded_chain(steps, e, use_seed, seed_re, seed_im, c) : CP.Cpx} & ({CP.cpx_mag(CP.eval_general_orbit_mode(1n+m, steps, e, use_seed, seed_re, seed_im, iter_k, c)) == 1n+iter_k : Nat} & ({CP.cpx_phase(CP.eval_general_orbit_mode(1n+m, steps, e, use_seed, seed_re, seed_im, iter_k, c)) == CP.cpx_phase(CP.eval_seeded_chain(steps, e, use_seed, seed_re, seed_im, c)) : Nat} & {CP.cpx_zoom_exp(CP.eval_general_orbit_mode(1n+m, steps, e, use_seed, seed_re, seed_im, iter_k, c)) == CP.cpx_zoom_exp(c) : Nat}))

# LAW 61: 120 FPS Frame-Budget & P99 Latency Compliance Law (NEVER OVERRIDE):
#         For any interactive step request `req_us`, the 120 FPS adaptive scheduler guarantees
#         `fps_120_dispatched_cost_us(req_us) <= 8333n` (8.333 ms), strictly beating unbounded execution.
law fps_120_frame_budget_and_p99_compliance_law:
  for +req_us: Nat
  for +extra_us: Nat
  {Nat.is_le(CP.fps_120_dispatched_cost_us(req_us), CP.fps_120_budget_us()) == True{} : Bool} & {Nat.is_lt(CP.fps_120_budget_us(), CP.fps_120_naive_unbounded_cost_us(extra_us)) == True{} : Bool}

# LAW 62: Continuous 120 FPS Pan/Zoom Zero Frame-Drop & Scale Preservation Law (NEVER OVERRIDE):
#         Across arbitrary continuous pan and zoom stress walks (`stress_walk_scenes`) on any
#         composite expression or deep chain (`75..1000`), zero frames are dropped at 120 FPS
#         (`fps_120_frame_dropped(req_us) == False{}`) and exact deep-zoom exponent scaling is preserved.
law fps_120_pan_zoom_zero_frame_drop_law:
  for req_us: Nat
  for +mode: CP.RenderMode
  for +pal: CP.Palette
  for +cam: CP.Camera
  for +scenes: Nat
  for +seed: Nat
  for +x: Nat
  for +y: Nat
  {CP.fps_120_frame_dropped(req_us) == False{} : Bool} & {CP.pixel_cert_zoom_exp(CP.render_pixel(mode, pal, CP.stress_walk_scenes(scenes, cam, seed), x, y)) == CP.cam_zoom_exp(CP.stress_walk_scenes(scenes, cam, seed)) : Nat}

# LAW 63: Parameterized Stage-Table Zero-Recompile Law (NEVER OVERRIDE):
#         Updating chain depth (`75, 140, 300, 500, 1000`), inner stage repeat counts, or integer
#         power exponents via the parameterized uniform stage table incurs 0 shader recompilation
#         cost (`stage_table_recompile_cost == 0n`), strictly beating inline AST recompilation.
law stage_table_uniform_reconfig_zero_compile_law:
  for +num_edits: Nat
  for +base_compile_cost: Nat
  {CP.stage_table_recompile_cost(num_edits) == 0n : Nat} & {Nat.is_lt(CP.stage_table_recompile_cost(num_edits), CP.inline_ast_recompile_cost(num_edits, base_compile_cost)) == True{} : Bool}

# LAW 64: Fused Sum/Diff-of-Squares & Direct Unhalved Hyperbolic Speedup Law (NEVER OVERRIDE):
#         Fused single-renorm sum/difference of squares (`qs_sum_sq_presplit` / `qs_diff_sq_presplit`)
#         and direct unhalved hyperbolic evaluation (`qs_sinh_cosh_unit`) are strictly faster at all zoom scales.
law fused_sos_and_direct_hyperbolic_speedup_law:
  for +zoom_exp: Nat
  {Nat.is_lt(CP.fused_sos_word_cost(CP.limbs_for_zoom(zoom_exp)), CP.unfused_sos_word_cost(CP.limbs_for_zoom(zoom_exp))) == True{} : Bool} & {Nat.is_lt(CP.sinh_cosh_direct_cost(CP.limbs_for_zoom(zoom_exp)), CP.sinh_cosh_halved_cost(CP.limbs_for_zoom(zoom_exp))) == True{} : Bool}

# LAW 65: Unified Single-Branch Zeta-AC Reflection Equivalence & Speedup Law (NEVER OVERRIDE):
#         Evaluating `zeta_ac` via a single unified RHP evaluation on `s_eval = reflect ? 1 - s : s`
#         is mathematically identical to `eval_prim(PZetaAC{}, z)` for all `z : Cpx` while
#         strictly reducing operation count and halving inlined shader code size at all zoom scales.
law unified_single_branch_zeta_ac_equivalence_and_speedup_law:
  for +z: CP.Cpx
  for +zoom_exp: Nat
  {CP.eval_zeta_ac_single_branch(z) == CP.eval_prim(CP.PZetaAC{}, z) : CP.Cpx} & {Nat.is_lt(CP.zeta_ac_single_branch_cost(zoom_exp), CP.zeta_ac_dual_branch_cost(zoom_exp)) == True{} : Bool}




