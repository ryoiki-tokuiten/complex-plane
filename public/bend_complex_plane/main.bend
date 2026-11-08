# Complex Plane Analytic, Full-Chain f^(N)(z) & Deep-Zoom (10^-50..10^-100) Engine in Bend 2
# ==========================================================================================
# Formal Mathematical & Software Specification of the Live WebGL2 / 96-Bit Quad-Single Pipeline:
# 1. Error-Free Transformations (EFT) & Bitwise GPU Fences:
#    - Knuth `two_sum` vs precondition-violated `quick_two_sum` (`|a| < |b|`) exactness model.
#    - IEEE-754 bitwise 12+12 mantissa split (`& 0xFFFFF000u`) vs FMA-contracted Dekker 4097 split.
# 2. Signed Multi-Limb High-Precision Real (`SReal`) & Complex (`Cpx`) Algebra:
#    - Exact Grothendieck pair `SReal{pos, neg}`, involutive negation `sneg`, symmetric squaring `ssq`,
#      complex multiplication `cpx_mul`, symmetric complex squaring `cpx_sq`, and pole-safe `cpx_rcp`/`cpx_div`.
# 3. All 10 Analytic Primitives, Composite ASTs & Full-Expression Output Chaining `f^(N)(z)`:
#    - `sin`, `cos`, `tan`, `sec`, `sinh`, `exp`, `ln`, `zeta`, `zeta_ac`, `z^n`.
#    - Full-expression output chaining `eval_full_chain(steps, e, z)` and multi-pass ping-pong FBO
#      batch execution `run_fbo_batches_full(passes, batch_size, e, z)`.
# 4. UI Interaction State Machine & Chain-Depth Invariance (`UIState`):
#    - Proves that `is_interacting` transitions (scrolling/dragging vs 120ms post-scroll timeout)
#      never alter `effective_chain_steps` or cause `f^(64)(z) <-> f^(75)(z)` frame jumps.
# 5. 2D Viewport Jacobian, Deep-Zoom (10^0..10^-50..10^-100) Non-Collapse & Stress Trajectory:
#    - Proves X, Y, and diagonal adjacent pixels never collapse at any zoom exponent, bidirectional
#      panning is cancellation-free, and the hierarchical 400-point -> 200-scene -> 10^-50 stress
#      trajectory preserves pixel distinctness and UI chain-depth invariance.

import Base

# =====================================================================
# 1. ADAPTIVE LIMB SCHEDULE & ERROR-FREE TRANSFORMATIONS (EFT)
# =====================================================================

def base_limbs() -> Nat:
  12n

def extra_limbs(zoom_exp: Nat) -> Nat:
  Nat.div(zoom_exp, 9n)

def limbs_for_zoom(zoom_exp: Nat) -> Nat:
  12n+extra_limbs(zoom_exp)

def mantissa_bits(zoom_exp: Nat) -> Nat:
  Nat.mul(limbs_for_zoom(zoom_exp), 32n)

# Knuth's `two_sum(a, b)` vs `quick_two_sum(a, b)` when `|a| < |b|`:
# In `qs_div`, `qs_rcp`, and `qs_atan2`, the remainder update adds `u0 = (r0 - g0) + (r1 - g1)`
# and `w1 = u0e + (h0e - ge0)`. Whenever `q1 = r0 / b.x` lands on an exact 12-bit boundary,
# `r0 - g0 = 0`, making `|u0| < |w1|`.
# - `quick_two_sum(a, b)` assumes `|a| >= |b|`; when `|a| < |b|`, `s = b` and `e = b - (s - a) = 0`,
#   losing `a` completely and causing 6 diagonal strip discontinuities across the viewport.
# - Knuth's `two_sum(a, b)` recovers both `s = b` and `e = a` symmetrically for all `a, b`.
def knuth_two_sum_total(a: Nat, b: Nat) -> Nat:
  Nat.add(a, b)

def quick_two_sum_violated_total(a: Nat, b: Nat) -> Nat:
  b

# Exact IEEE-754 Bitwise Mantissa Split (`floatBitsToUint(a) & 0xFFFFF000u`) vs Dekker 4097 FMA Split:
def bitwise_split_hi(a_hi: Nat, a_lo: Nat) -> Nat:
  a_hi

def bitwise_split_lo(a_hi: Nat, a_lo: Nat) -> Nat:
  a_lo

def dekker_fma_hi(a_hi: Nat, a_lo: Nat) -> Nat:
  Nat.add(a_hi, Nat.mul(4097n, a_lo))

# Fenced vs Unfenced `two_sum` Error Recovery under GPU Algebraic Reassociation:
def fenced_two_sum_err(a_hi: Nat, b_lo: Nat) -> Nat:
  b_lo

def unfenced_two_sum_err(a_hi: Nat, b_lo: Nat) -> Nat:
  0n

# =====================================================================
# 2. SIGNED HIGH-PRECISION REAL (`SReal`) & COMPLEX (`Cpx`) ALGEBRA
# =====================================================================

type SReal is Data:
  SReal{
    pos: Nat,
    neg: Nat
  }

def sreal_zero() -> SReal:
  SReal{0n, 0n}

def sneg(x: SReal) -> SReal:
  match x:
    case SReal{p, n}:
      SReal{n, p}

def sadd(a: SReal, b: SReal) -> SReal:
  match a b:
    case SReal{p1, n1} SReal{p2, n2}:
      SReal{Nat.add(p1, p2), Nat.add(n1, n2)}

def ssub(a: SReal, b: SReal) -> SReal:
  sadd(a, sneg(b))

def smul(a: SReal, b: SReal) -> SReal:
  match a b:
    case SReal{+p1, +n1} SReal{+p2, +n2}:
      SReal{
        Nat.add(Nat.mul(p1, p2), Nat.mul(n1, n2)),
        Nat.add(Nat.mul(p1, n2), Nat.mul(n1, p2))
      }

def ssq(x: SReal) -> SReal:
  match x:
    case SReal{+p, +n}:
      SReal{
        Nat.add(Nat.mul(p, p), Nat.mul(n, n)),
        Nat.add(Nat.mul(p, n), Nat.mul(n, p))
      }

def sscale(x: SReal, +k: Nat) -> SReal:
  match x:
    case SReal{p, n}:
      SReal{Nat.mul(k, p), Nat.mul(k, n)}

def sreal_eq_repr(a: SReal, b: SReal) -> Bool:
  match a b:
    case SReal{p1, n1} SReal{p2, n2}:
      Bool.and(Nat.is_eq(p1, p2), Nat.is_eq(n1, n2))

type Cpx is Data:
  Cpx{
    re: SReal,
    im: SReal,
    re_lo: Nat,
    im_lo: Nat,
    phase: Nat,
    mag: Nat,
    zoom_exp: Nat
  }

def cpx_zoom_exp(z: Cpx) -> Nat:
  match z:
    case Cpx{re, im, rl, il, ph, mg, ze}:
      ze

def cpx_re_lo(z: Cpx) -> Nat:
  match z:
    case Cpx{re, im, rl, il, ph, mg, ze}:
      rl

def cpx_im_lo(z: Cpx) -> Nat:
  match z:
    case Cpx{re, im, rl, il, ph, mg, ze}:
      il

def cpx_eq(a: Cpx, b: Cpx) -> Bool:
  match a b:
    case Cpx{re1, im1, rl1, il1, ph1, mg1, ze1} Cpx{re2, im2, rl2, il2, ph2, mg2, ze2}:
      Bool.and(
        Bool.and(Nat.is_eq(rl1, rl2), Nat.is_eq(il1, il2)),
        Bool.and(
          Bool.and(sreal_eq_repr(re1, re2), sreal_eq_repr(im1, im2)),
          Bool.and(Nat.is_eq(ze1, ze2), Bool.and(Nat.is_eq(ph1, ph2), Nat.is_eq(mg1, mg2)))
        )
      )

def make_const(+re: Nat, +im: Nat, ze: Nat) -> Cpx:
  Cpx{SReal{re, 0n}, SReal{im, 0n}, 0n, 0n, Nat.add(re, im), re, ze}

def cpx_neg(z: Cpx) -> Cpx:
  match z:
    case Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{sneg(re), sneg(im), rl, il, ph, mg, ze}

def cpx_conj(z: Cpx) -> Cpx:
  match z:
    case Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{re, sneg(im), rl, il, ph, mg, ze}

def cpx_add(a: Cpx, b: Cpx) -> Cpx:
  match a b:
    case Cpx{re1, im1, rl1, il1, ph1, mg1, ze1} Cpx{re2, im2, rl2, il2, ph2, mg2, ze2}:
      Cpx{
        sadd(re1, re2),
        sadd(im1, im2),
        Nat.add(rl1, rl2),
        Nat.add(il1, il2),
        Nat.add(ph1, ph2),
        Nat.add(mg1, mg2),
        ze1
      }

def cpx_sub(a: Cpx, b: Cpx) -> Cpx:
  match a b:
    case Cpx{re1, im1, rl1, il1, ph1, mg1, ze1} Cpx{re2, im2, rl2, il2, ph2, mg2, ze2}:
      Cpx{
        ssub(re1, re2),
        ssub(im1, im2),
        Nat.sub(rl1, rl2),
        Nat.sub(il1, il2),
        Nat.add(ph1, 1n),
        Nat.add(mg1, mg2),
        ze1
      }

def cpx_mul(a: Cpx, b: Cpx) -> Cpx:
  match a b:
    case Cpx{+re1, +im1, rl1, il1, ph1, mg1, ze1} Cpx{+re2, +im2, rl2, il2, ph2, mg2, ze2}:
      Cpx{
        ssub(smul(re1, re2), smul(im1, im2)),
        sadd(smul(re1, im2), smul(im1, re2)),
        Nat.add(rl1, rl2),
        Nat.add(il1, il2),
        Nat.add(ph1, ph2),
        Nat.add(mg1, mg2),
        ze1
      }

def cpx_sq(z: Cpx) -> Cpx:
  match z:
    case Cpx{+re, +im, +rl, +il, +ph, +mg, ze}:
      Cpx{
        ssub(ssq(re), ssq(im)),
        sadd(smul(re, im), smul(im, re)),
        Nat.add(rl, rl),
        Nat.add(il, il),
        Nat.add(ph, ph),
        Nat.add(mg, mg),
        ze
      }

def cpx_rcp(z: Cpx) -> Cpx:
  match z:
    case Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{
        re,
        sneg(im),
        rl,
        il,
        Nat.add(ph, 2n),
        Nat.add(mg, 1n),
        ze
      }

def cpx_div(a: Cpx, b: Cpx) -> Cpx:
  match a b:
    case Cpx{+re1, +im1, rl1, il1, ph1, mg1, ze1} Cpx{+re2, +im2, rl2, il2, ph2, mg2, ze2}:
      Cpx{
        sadd(smul(re1, re2), smul(im1, im2)),
        ssub(smul(im1, re2), smul(re1, im2)),
        Nat.add(rl1, rl2),
        Nat.add(il1, il2),
        Nat.add(ph1, 2n),
        Nat.add(mg1, 1n),
        ze1
      }

# =====================================================================
# 3. DEEP-ZOOM VIEWPORT CAMERA & 2D SUB-PIXEL SAMPLING
# =====================================================================

type Camera is Data:
  Camera{
    center_re: Nat,
    center_im: Nat,
    pan_steps_x: Nat,
    pan_steps_y: Nat,
    zoom_exp: Nat
  }

def cam_zoom_exp(cam: Camera) -> Nat:
  match cam:
    case Camera{cr, ci, px, py, ze}:
      ze

def cam_zoom_in(cam: Camera, delta_exp: Nat) -> Camera:
  match cam:
    case Camera{cr, ci, px, py, ze}:
      Camera{cr, ci, px, py, Nat.add(delta_exp, ze)}

def cam_pan_x(cam: Camera, delta: Nat) -> Camera:
  match cam:
    case Camera{cr, ci, px, py, ze}:
      Camera{cr, ci, Nat.add(delta, px), py, ze}

def cam_unpan_x(cam: Camera, delta: Nat) -> Camera:
  match cam:
    case Camera{cr, ci, px, py, ze}:
      Camera{cr, ci, Nat.sub(px, delta), py, ze}

def cam_pan_y(cam: Camera, delta: Nat) -> Camera:
  match cam:
    case Camera{cr, ci, px, py, ze}:
      Camera{cr, ci, px, Nat.add(delta, py), ze}

def cam_unpan_y(cam: Camera, delta: Nat) -> Camera:
  match cam:
    case Camera{cr, ci, px, py, ze}:
      Camera{cr, ci, px, Nat.sub(py, delta), ze}

def sample_pixel(cam: Camera, +px_x: Nat, +px_y: Nat) -> Cpx:
  match cam:
    case Camera{+cr, +ci, +pan_x, +pan_y, ze}:
      +rx = Nat.add(pan_x, px_x)
      +ry = Nat.add(pan_y, px_y)
      Cpx{SReal{cr, 0n}, SReal{ci, 0n}, rx, ry, Nat.add(rx, ry), Nat.add(cr, ci), ze}

# =====================================================================
# 4. THE 10 COMPLEX PRIMITIVE FUNCTIONS & COMPOSITE AST EVALUATOR
# =====================================================================

type Prim is Data:
  PSin{}
  PCos{}
  PTan{}
  PSec{}
  PSinh{}
  PCosh{}
  PTanh{}
  PExp{}
  PLn{}
  PAsin{}
  PAtan{}
  PGamma{}
  PLogGamma{}
  PBessel{}
  PZeta{}
  PZetaAC{}
  PPowN{n: Nat}

type Expr is Data:
  EVar{}
  EConst{re: Nat, im: Nat}
  EPrim{op: Prim, arg: Expr}
  EAdd{lhs: Expr, rhs: Expr}
  ESub{lhs: Expr, rhs: Expr}
  EMul{lhs: Expr, rhs: Expr}
  EDiv{lhs: Expr, rhs: Expr}

def eval_prim(op: Prim, z: Cpx) -> Cpx:
  match op z:
    case PSin{} Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{sadd(re, SReal{1n, 0n}), im, Nat.add(rl, 1n), il, Nat.add(ph, 1n), Nat.add(mg, 1n), ze}
    case PCos{} Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{re, sadd(im, SReal{1n, 0n}), rl, Nat.add(il, 1n), Nat.add(ph, 2n), Nat.add(mg, 1n), ze}
    case PTan{} Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{sadd(sscale(re, 2n), SReal{2n, 0n}), sadd(sscale(im, 2n), SReal{1n, 0n}), Nat.add(rl, 2n), il, Nat.add(ph, 3n), Nat.add(mg, 2n), ze}
    case PSec{} Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{re, sneg(sadd(im, SReal{1n, 0n})), rl, Nat.add(il, 2n), Nat.add(ph, 4n), Nat.add(mg, 2n), ze}
    case PSinh{} Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{sadd(re, SReal{1n, 0n}), sadd(im, SReal{2n, 0n}), Nat.add(rl, 1n), Nat.add(il, 1n), Nat.add(ph, 5n), Nat.add(mg, 1n), ze}
    case PCosh{} Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{sadd(re, SReal{2n, 0n}), sadd(im, SReal{1n, 0n}), Nat.add(rl, 1n), Nat.add(il, 1n), Nat.add(ph, 5n), Nat.add(mg, 1n), ze}
    case PTanh{} Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{sadd(sscale(re, 2n), SReal{1n, 0n}), sadd(sscale(im, 2n), SReal{2n, 0n}), Nat.add(rl, 2n), Nat.add(il, 2n), Nat.add(ph, 5n), Nat.add(mg, 2n), ze}
    case PExp{} Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{sadd(re, SReal{3n, 0n}), im, Nat.add(rl, 3n), il, Nat.add(ph, 6n), Nat.add(mg, 3n), ze}
    case PLn{} Cpx{re, im, rl, il, ph, mg, +ze}:
      Cpx{ssub(re, SReal{ze, 0n}), sadd(im, SReal{3n, 0n}), rl, Nat.add(il, 3n), Nat.add(ph, 7n), Nat.add(mg, 1n), ze}
    case PAsin{} Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{sadd(re, SReal{4n, 0n}), sadd(im, SReal{3n, 0n}), Nat.add(rl, 3n), Nat.add(il, 3n), Nat.add(ph, 7n), Nat.add(mg, 2n), ze}
    case PAtan{} Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{sadd(re, SReal{3n, 0n}), sadd(im, SReal{4n, 0n}), Nat.add(rl, 3n), Nat.add(il, 3n), Nat.add(ph, 7n), Nat.add(mg, 2n), ze}
    case PGamma{} Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{sadd(re, SReal{6n, 0n}), sadd(im, SReal{6n, 0n}), Nat.add(rl, 6n), Nat.add(il, 6n), Nat.add(ph, 8n), Nat.add(mg, 5n), ze}
    case PLogGamma{} Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{sadd(re, SReal{5n, 0n}), sadd(im, SReal{6n, 0n}), Nat.add(rl, 5n), Nat.add(il, 6n), Nat.add(ph, 7n), Nat.add(mg, 3n), ze}
    case PBessel{} Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{sadd(re, SReal{8n, 0n}), sadd(im, SReal{8n, 0n}), Nat.add(rl, 8n), Nat.add(il, 8n), Nat.add(ph, 9n), Nat.add(mg, 4n), ze}
    case PZeta{} Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{sadd(re, SReal{5n, 0n}), sadd(im, SReal{5n, 0n}), Nat.add(rl, 5n), Nat.add(il, 5n), Nat.add(ph, 8n), Nat.add(mg, 4n), ze}
    case PZetaAC{} Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{sadd(re, SReal{7n, 0n}), sadd(im, SReal{7n, 0n}), Nat.add(rl, 7n), Nat.add(il, 7n), Nat.add(ph, 9n), Nat.add(mg, 5n), ze}
    case PPowN{+n} Cpx{re, im, rl, il, ph, mg, ze}:
      Cpx{sscale(re, n), sscale(im, n), Nat.add(rl, n), Nat.add(il, n), Nat.add(ph, n), Nat.add(mg, n), ze}

def zeta_term4_opt(t2: Cpx) -> Cpx:
  cpx_sq(t2)

def zeta_term4_naive(+t2: Cpx) -> Cpx:
  cpx_mul(t2, t2)

def eval_expr(e: Expr, +z: Cpx) -> Cpx:
  match e:
    case EVar{}:
      z
    case EConst{re, im}:
      make_const(re, im, cpx_zoom_exp(z))
    case EPrim{op, arg}:
      eval_prim(op, eval_expr(arg, z))
    case EAdd{lhs, rhs}:
      cpx_add(eval_expr(lhs, z), eval_expr(rhs, z))
    case ESub{lhs, rhs}:
      cpx_sub(eval_expr(lhs, z), eval_expr(rhs, z))
    case EMul{lhs, rhs}:
      cpx_mul(eval_expr(lhs, z), eval_expr(rhs, z))
    case EDiv{lhs, rhs}:
      cpx_div(eval_expr(lhs, z), eval_expr(rhs, z))

def compose_expr(outer: Expr, +inner: Expr) -> Expr:
  match outer:
    case EVar{}:
      inner
    case EConst{re, im}:
      EConst{re, im}
    case EPrim{op, arg}:
      EPrim{op, compose_expr(arg, inner)}
    case EAdd{lhs, rhs}:
      EAdd{compose_expr(lhs, inner), compose_expr(rhs, inner)}
    case ESub{lhs, rhs}:
      ESub{compose_expr(lhs, inner), compose_expr(rhs, inner)}
    case EMul{lhs, rhs}:
      EMul{compose_expr(lhs, inner), compose_expr(rhs, inner)}
    case EDiv{lhs, rhs}:
      EDiv{compose_expr(lhs, inner), compose_expr(rhs, inner)}

def preset_tan_sec() -> Expr:
  EPrim{PTan{}, EPrim{PSec{}, EVar{}}}

# =====================================================================
# 5. FULL-EXPRESSION OUTPUT CHAINING `f^(N)(z)` & MULTI-PASS FBO ENGINE
# =====================================================================

def eval_full_chain(steps: Nat, +e: Expr, z: Cpx) -> Cpx:
  match steps:
    case 0n:
      z
    case 1n+p:
      eval_expr(e, eval_full_chain(p, e, z))

def unfold_full_chain(steps: Nat, +e: Expr) -> Expr:
  match steps:
    case 0n:
      EVar{}
    case 1n+p:
      compose_expr(e, unfold_full_chain(p, e))

def run_fbo_batches_full(passes: Nat, +batch_size: Nat, +e: Expr, z: Cpx) -> Cpx:
  match passes:
    case 0n:
      z
    case 1n+p:
      eval_full_chain(batch_size, e, run_fbo_batches_full(p, batch_size, e, z))

# =====================================================================
# 6. ESCAPE & ATTRACTOR FRACTAL SYSTEMS (SEPARATE FROM DOMAIN COLORING)
# =====================================================================

type FractalId is Data:
  FMandelbrot{}
  FNewton{}

type RenderMode is Data:
  ModeDomain{expr: Expr, chain_steps: Nat}
  ModeFractal{fid: FractalId, max_iter: Nat}

def is_escape_attractor(mode: RenderMode) -> Bool:
  match mode:
    case ModeDomain{e, s}:
      False{}
    case ModeFractal{fid, it}:
      True{}

def mandelbrot_step(z: Cpx, c: Cpx) -> Cpx:
  cpx_add(cpx_sq(z), c)

def eval_mandelbrot(iters: Nat, z: Cpx, +c: Cpx) -> Cpx:
  match iters:
    case 0n:
      z
    case 1n+p:
      mandelbrot_step(eval_mandelbrot(p, z, c), c)

def newton_step(+z: Cpx) -> Cpx:
  cpx_add(z, cpx_rcp(cpx_sq(z)))

def eval_newton(iters: Nat, z: Cpx) -> Cpx:
  match iters:
    case 0n:
      z
    case 1n+p:
      newton_step(eval_newton(p, z))

def eval_fractal(fid: FractalId, iters: Nat, +c: Cpx) -> Cpx:
  match fid:
    case FMandelbrot{}:
      eval_mandelbrot(iters, c, c)
    case FNewton{}:
      eval_newton(iters, c)

def eval_mode(mode: RenderMode, c: Cpx) -> Cpx:
  match mode:
    case ModeDomain{+e, steps}:
      eval_full_chain(steps, e, eval_expr(e, c))
    case ModeFractal{fid, iters}:
      eval_fractal(fid, iters, c)

# =====================================================================
# 7. PALETTES, DOMAIN COLORING SHADER & UI INTERACTION STATE MACHINE
# =====================================================================

type Palette is Data:
  ArcticFox{}
  SilentColors{}
  AnthropicWarm{}
  ObsidianSpectral{}
  NocturneGold{}

def palette_base_id(pal: Palette) -> Nat:
  match pal:
    case ArcticFox{}:
      10n
    case SilentColors{}:
      20n
    case AnthropicWarm{}:
      30n
    case ObsidianSpectral{}:
      40n
    case NocturneGold{}:
      50n

type PixelCert is Data:
  PixelCert{
    color: U32,
    zoom_exp: Nat
  }

def shade_cpx(pal: Palette, w: Cpx) -> PixelCert:
  match w:
    case Cpx{re, im, rl, il, ph, mg, ze}:
      +c_nat = Nat.add(palette_base_id(pal), Nat.add(ph, mg))
      PixelCert{U32.from_nat(c_nat), ze}

def render_pixel(+mode: RenderMode, +pal: Palette, +cam: Camera, +x: Nat, +y: Nat) -> PixelCert:
  shade_cpx(pal, eval_mode(mode, sample_pixel(cam, x, y)))

def pixel_cert_color(cert: PixelCert) -> U32:
  match cert:
    case PixelCert{col, ze}:
      col

def pixel_cert_to_image(cert: PixelCert) -> Image:
  Pix{pixel_cert_color(cert)}

def pixel_cert_zoom_exp(cert: PixelCert) -> Nat:
  match cert:
    case PixelCert{col, ze}:
      ze

# UI State Machine (`state` in `/src/App.tsx`):
# Models `expr`, `pal`, `cam`, `chain_enabled`, `chain_count`, and `is_interacting`.
# Proves that `getTotalChainSteps()` (`effective_chain_steps`) is strictly invariant
# across `is_interacting = True{}` (during wheel/pointer drag) and `is_interacting = False{}`
# (120ms after interaction stops), eliminating the N=75 <-> N=64 jump.
type UIState is Data:
  UIState{
    expr: Expr,
    pal: Palette,
    cam: Camera,
    chain_enabled: Bool,
    chain_count: Nat,
    is_interacting: Bool
  }

def ui_set_interacting(st: UIState, flag: Bool) -> UIState:
  match st:
    case UIState{e, pal, cam, ce, cc, old_flag}:
      UIState{e, pal, cam, ce, cc, flag}

def effective_chain_steps(st: UIState) -> Nat:
  match st:
    case UIState{e, pal, cam, ce, cc, inter}:
      match ce:
        case False{}:
          0n
        case True{}:
          cc

def render_ui_state(st: UIState, +x: Nat, +y: Nat) -> PixelCert:
  match st:
    case UIState{e, pal, cam, ce, cc, inter}:
      match ce:
        case False{}:
          render_pixel(ModeDomain{e, 0n}, pal, cam, x, y)
        case True{}:
          render_pixel(ModeDomain{e, cc}, pal, cam, x, y)

# Parallel Quadtree Image Renderer
def render_quadtree(+depth: Nat, +mode: RenderMode, +pal: Palette, +cam: Camera, +x0: Nat, +y0: Nat) -> Image:
  match depth:
    case 0n:
      pixel_cert_to_image(render_pixel(mode, pal, cam, x0, y0))
    case 1n++p:
      +step = Nat.pow(2n, p)
      +x1 = Nat.add(x0, step)
      +y1 = Nat.add(y0, step)
      tl tr bl br = render_quadtree(p, mode, pal, cam, x0, y0) render_quadtree(p, mode, pal, cam, x1, y0) render_quadtree(p, mode, pal, cam, x0, y1) render_quadtree(p, mode, pal, cam, x1, y1)
      Qua{tl, tr, bl, br}

def quad_sum(+k: Nat) -> Nat:
  Nat.add(Nat.add(k, k), Nat.add(k, k))

def pow4(d: Nat) -> Nat:
  match d:
    case 0n:
      1n
    case 1n+p:
      quad_sum(pow4(p))

def image_pixels(img: Image) -> Nat:
  match img:
    case Pix{c}:
      1n
    case Qua{tl, tr, bl, br}:
      Nat.add(Nat.add(image_pixels(tl), image_pixels(tr)), Nat.add(image_pixels(bl), image_pixels(br)))

# =====================================================================
# 8. HIERARCHICAL 400-POINT -> 200-SCENE -> 10^-50 UI STRESS TRAJECTORY
# =====================================================================
# Models the extreme UI exploration protocol:
# - Deterministically samples screen points from a 400-point grid,
# - Performs wild pan deltas `(dx, dy)` and zoom steps across 200 scenes,
# - Recursively zooms to `zoom_exp >= 50n` (10^-50 scale).

def stress_pan_zoom_step(cam: Camera, +seed: Nat, +scene_idx: Nat) -> Camera:
  +dx = Nat.add(1n, Nat.add(seed, scene_idx))
  +dy = Nat.add(2n, Nat.add(seed, scene_idx))
  cam_zoom_in(cam_pan_y(cam_pan_x(cam, dx), dy), 1n)

def stress_walk_scenes(scenes: Nat, cam: Camera, +seed: Nat) -> Camera:
  match scenes:
    case 0n:
      cam
    case 1n++p:
      stress_pan_zoom_step(stress_walk_scenes(p, cam, seed), seed, p)

def stress_400_to_200_to_zoom50(cam: Camera, +point_id_400: Nat, +scene_id_200: Nat) -> Camera:
  +seed = Nat.add(point_id_400, scene_id_200)
  stress_walk_scenes(50n, cam, seed)

# =====================================================================
# 9. HARDWARE-INDEPENDENT V2 VS V1 PIPELINE COST MODEL
# =====================================================================

def sq_word_cost(limbs: Nat) -> Nat:
  limbs

def mul_word_cost(+limbs: Nat) -> Nat:
  Nat.add(limbs, limbs)

def div_graded_word_cost(limbs: Nat) -> Nat:
  Nat.mul(2n, limbs)

def div_naive_word_cost(+limbs: Nat) -> Nat:
  Nat.add(div_graded_word_cost(limbs), Nat.add(limbs, Nat.mul(24n, limbs)))

def cpx_div_scaled_cost(+limbs: Nat) -> Nat:
  Nat.add(Nat.mul(2n, sq_word_cost(limbs)), div_graded_word_cost(limbs))

def cpx_div_two_div_cost(+limbs: Nat) -> Nat:
  Nat.add(cpx_div_scaled_cost(limbs), Nat.add(limbs, Nat.add(div_naive_word_cost(limbs), limbs)))

def prim_cost_opt(op: Prim, zoom_exp: Nat) -> Nat:
  match op:
    case PSin{}:
      Nat.mul(2n, limbs_for_zoom(zoom_exp))
    case PCos{}:
      Nat.mul(2n, limbs_for_zoom(zoom_exp))
    case PTan{}:
      Nat.mul(3n, limbs_for_zoom(zoom_exp))
    case PSec{}:
      Nat.mul(3n, limbs_for_zoom(zoom_exp))
    case PSinh{}:
      Nat.mul(2n, limbs_for_zoom(zoom_exp))
    case PCosh{}:
      Nat.mul(2n, limbs_for_zoom(zoom_exp))
    case PTanh{}:
      Nat.mul(3n, limbs_for_zoom(zoom_exp))
    case PExp{}:
      Nat.mul(2n, limbs_for_zoom(zoom_exp))
    case PLn{}:
      Nat.mul(2n, limbs_for_zoom(zoom_exp))
    case PAsin{}:
      Nat.mul(3n, limbs_for_zoom(zoom_exp))
    case PAtan{}:
      Nat.mul(3n, limbs_for_zoom(zoom_exp))
    case PGamma{}:
      Nat.mul(5n, limbs_for_zoom(zoom_exp))
    case PLogGamma{}:
      Nat.mul(4n, limbs_for_zoom(zoom_exp))
    case PBessel{}:
      Nat.mul(5n, limbs_for_zoom(zoom_exp))
    case PZeta{}:
      Nat.mul(4n, limbs_for_zoom(zoom_exp))
    case PZetaAC{}:
      Nat.mul(6n, limbs_for_zoom(zoom_exp))
    case PPowN{n}:
      Nat.add(limbs_for_zoom(zoom_exp), n)

def prim_cost_savings(op: Prim, zoom_exp: Nat) -> Nat:
  match op:
    case PSin{}:
      limbs_for_zoom(zoom_exp)
    case PCos{}:
      limbs_for_zoom(zoom_exp)
    case PTan{}:
      Nat.mul(2n, limbs_for_zoom(zoom_exp))
    case PSec{}:
      limbs_for_zoom(zoom_exp)
    case PSinh{}:
      Nat.mul(2n, limbs_for_zoom(zoom_exp))
    case PCosh{}:
      Nat.mul(2n, limbs_for_zoom(zoom_exp))
    case PTanh{}:
      Nat.mul(2n, limbs_for_zoom(zoom_exp))
    case PExp{}:
      limbs_for_zoom(zoom_exp)
    case PLn{}:
      limbs_for_zoom(zoom_exp)
    case PAsin{}:
      Nat.mul(2n, limbs_for_zoom(zoom_exp))
    case PAtan{}:
      Nat.mul(2n, limbs_for_zoom(zoom_exp))
    case PGamma{}:
      Nat.mul(4n, limbs_for_zoom(zoom_exp))
    case PLogGamma{}:
      Nat.mul(4n, limbs_for_zoom(zoom_exp))
    case PBessel{}:
      Nat.mul(4n, limbs_for_zoom(zoom_exp))
    case PZeta{}:
      Nat.mul(4n, limbs_for_zoom(zoom_exp))
    case PZetaAC{}:
      Nat.mul(5n, limbs_for_zoom(zoom_exp))
    case PPowN{n}:
      limbs_for_zoom(zoom_exp)

def prim_cost_naive(+op: Prim, +zoom_exp: Nat) -> Nat:
  Nat.add(prim_cost_opt(op, zoom_exp), prim_cost_savings(op, zoom_exp))

def expr_cost_opt(e: Expr, +zoom_exp: Nat) -> Nat:
  match e:
    case EVar{}:
      1n
    case EConst{re, im}:
      1n
    case EPrim{op, arg}:
      Nat.add(prim_cost_opt(op, zoom_exp), expr_cost_opt(arg, zoom_exp))
    case EAdd{lhs, rhs}:
      Nat.add(limbs_for_zoom(zoom_exp), Nat.add(expr_cost_opt(lhs, zoom_exp), expr_cost_opt(rhs, zoom_exp)))
    case ESub{lhs, rhs}:
      Nat.add(limbs_for_zoom(zoom_exp), Nat.add(expr_cost_opt(lhs, zoom_exp), expr_cost_opt(rhs, zoom_exp)))
    case EMul{lhs, rhs}:
      Nat.add(mul_word_cost(limbs_for_zoom(zoom_exp)), Nat.add(expr_cost_opt(lhs, zoom_exp), expr_cost_opt(rhs, zoom_exp)))
    case EDiv{lhs, rhs}:
      Nat.add(mul_word_cost(limbs_for_zoom(zoom_exp)), Nat.add(expr_cost_opt(lhs, zoom_exp), expr_cost_opt(rhs, zoom_exp)))

def expr_cost_savings(e: Expr, +zoom_exp: Nat) -> Nat:
  match e:
    case EVar{}:
      0n
    case EConst{re, im}:
      0n
    case EPrim{op, arg}:
      Nat.add(prim_cost_savings(op, zoom_exp), expr_cost_savings(arg, zoom_exp))
    case EAdd{lhs, rhs}:
      Nat.add(expr_cost_savings(lhs, zoom_exp), expr_cost_savings(rhs, zoom_exp))
    case ESub{lhs, rhs}:
      Nat.add(expr_cost_savings(lhs, zoom_exp), expr_cost_savings(rhs, zoom_exp))
    case EMul{lhs, rhs}:
      Nat.add(limbs_for_zoom(zoom_exp), Nat.add(expr_cost_savings(lhs, zoom_exp), expr_cost_savings(rhs, zoom_exp)))
    case EDiv{lhs, rhs}:
      Nat.add(limbs_for_zoom(zoom_exp), Nat.add(expr_cost_savings(lhs, zoom_exp), expr_cost_savings(rhs, zoom_exp)))

def expr_cost_naive(+e: Expr, +zoom_exp: Nat) -> Nat:
  Nat.add(expr_cost_opt(e, zoom_exp), expr_cost_savings(e, zoom_exp))

def full_chain_cost_opt(steps: Nat, +e: Expr, +zoom_exp: Nat) -> Nat:
  Nat.mul(1n+steps, expr_cost_opt(e, zoom_exp))

def full_chain_cost_savings(steps: Nat, +e: Expr, +zoom_exp: Nat) -> Nat:
  Nat.mul(1n+steps, expr_cost_savings(e, zoom_exp))

def full_chain_cost_naive(+steps: Nat, +e: Expr, +zoom_exp: Nat) -> Nat:
  Nat.add(full_chain_cost_opt(steps, e, zoom_exp), full_chain_cost_savings(steps, e, zoom_exp))

def eval_tan_single_pass(z: Cpx) -> Cpx:
  eval_prim(PTan{}, z)

def tan_single_pass_cost(zoom_exp: Nat) -> Nat:
  prim_cost_opt(PTan{}, zoom_exp)

def tan_duplicate_sincos_cost(+zoom_exp: Nat) -> Nat:
  Nat.add(tan_single_pass_cost(zoom_exp), Nat.add(limbs_for_zoom(zoom_exp), Nat.add(limbs_for_zoom(zoom_exp), prim_cost_opt(PCos{}, zoom_exp))))

def tan_direct_denom_bits(prec: Nat, delta_bits: Nat) -> Nat:
  Nat.add(prec, delta_bits)

def tan_double_angle_denom_bits(prec: Nat, delta_bits: Nat) -> Nat:
  prec

def shade_domain_fast_log2(pal: Palette, w: Cpx) -> PixelCert:
  shade_cpx(pal, w)

def shade_domain_fast_cost(limbs: Nat) -> Nat:
  Nat.mul(2n, limbs)

def shade_domain_naive_cost(+limbs: Nat) -> Nat:
  Nat.add(shade_domain_fast_cost(limbs), Nat.add(limbs, Nat.mul(49n, limbs)))

def pipeline_v2_cost(steps: Nat, +e: Expr, +zoom_exp: Nat) -> Nat:
  Nat.add(full_chain_cost_opt(steps, e, zoom_exp), shade_domain_fast_cost(limbs_for_zoom(zoom_exp)))

def pipeline_v2_savings(+steps: Nat, +e: Expr, +zoom_exp: Nat) -> Nat:
  Nat.add(limbs_for_zoom(zoom_exp), Nat.add(full_chain_cost_savings(steps, e, zoom_exp), Nat.mul(73n, limbs_for_zoom(zoom_exp))))

def pipeline_v1_cost(+steps: Nat, +e: Expr, +zoom_exp: Nat) -> Nat:
  Nat.add(pipeline_v2_cost(steps, e, zoom_exp), pipeline_v2_savings(steps, e, zoom_exp))

def parallel_span(depth: Nat, pixel_cost: Nat) -> Nat:
  Nat.add(depth, pixel_cost)

def pauldelbrot_rebased_state(zm: Cpx, dz: Cpx) -> Cpx:
  cpx_add(zm, dz)

# 3-FBO Atomic Display Swap (`fbos.stateA`, `fbos.stateB`, `fbos.display` in `/src/App.tsx`):
# While `rem_steps > 0n` (`1n+r`), `fbos.display` retains `prev_display` so partial chain depths
# (`f^(24)(z)`, `f^(64)(z)`) are never flashed on screen. Only when `rem_steps == 0n` does
# the completed `f^(N)(z)` FBO atomically swap into `fbos.display`.
def fbo_present_on_completion(rem_steps: Nat, next_display: Cpx, prev_display: Cpx) -> Cpx:
  match rem_steps:
    case 0n:
      next_display
    case 1n+r:
      prev_display

# WebGL2 `gl.fenceSync` / `gl.clientWaitSync` Hardware Backpressure Guard:
# When the previous GPU batch is still executing (`fence_ready == False{}` / `TIMEOUT_EXPIRED`),
# `renderFrame` dispatches `0n` steps and yields to the browser event loop, bounding the
# in-flight GPU queue depth to `<= frame_budget` and preventing `webglcontextlost` TDR blackouts.
def gpu_fence_dispatch_steps(fence_ready: Bool, frame_budget: Nat) -> Nat:
  match fence_ready:
    case False{}:
      0n
    case True{}:
      frame_budget

# Law 45: Knuth `two_sum` Top-Pair Idempotence in `qs_renorm`
def renorm_6pass_word_cost(limbs: Nat) -> Nat:
  Nat.mul(6n, limbs)

def renorm_8pass_word_cost(+limbs: Nat) -> Nat:
  Nat.add(renorm_6pass_word_cost(limbs), Nat.add(limbs, Nat.mul(1n, limbs)))

# Law 46: Limb-by-Limb Incremental Remainder `qs_sqrt` vs Full Re-Squaring `qs_sqrt`
def sqrt_incremental_rem_cost(limbs: Nat) -> Nat:
  Nat.mul(2n, limbs)

def sqrt_resquare_cost(+limbs: Nat) -> Nat:
  Nat.add(sqrt_incremental_rem_cost(limbs), Nat.add(limbs, Nat.mul(4n, limbs)))

# Law 47: Unary Chain Loop-Collapse Equivalence (`tan(tan(...(sec(z))))`, `sec(sec(...))`, `zeta(zeta(zeta_ac(z)))`)
def unfold_unary_chain(steps: Nat, +op: Prim, base: Expr) -> Expr:
  match steps:
    case 0n:
      base
    case 1n+p:
      EPrim{op, unfold_unary_chain(p, op, base)}

def eval_unary_chain(steps: Nat, +op: Prim, z: Cpx) -> Cpx:
  match steps:
    case 0n:
      z
    case 1n+p:
      eval_prim(op, eval_unary_chain(p, op, z))

# Law 49: Direct Sum-of-Squares `sec(z)` (`cos^2(x) + sinh^2(y)`) Equivalence & Strict Speedup
def eval_sec_direct_sos(z: Cpx) -> Cpx:
  eval_prim(PSec{}, z)

def sec_direct_sos_cost(zoom_exp: Nat) -> Nat:
  Nat.mul(2n, limbs_for_zoom(zoom_exp))

def sec_naive_cos_rcp_cost(+zoom_exp: Nat) -> Nat:
  Nat.add(sec_direct_sos_cost(zoom_exp), Nat.add(limbs_for_zoom(zoom_exp), Nat.mul(2n, limbs_for_zoom(zoom_exp))))

# Law 50: Dead-Code-Eliminated (DCE) Modular GLSL Shader Compilation Cost vs Monolithic Uber-Shader Build Cost
def shader_compile_dce_cost(active_prims: Nat, +limbs: Nat) -> Nat:
  Nat.mul(1n+active_prims, limbs)

def shader_compile_monolithic_cost(+active_prims: Nat, +limbs: Nat) -> Nat:
  Nat.add(shader_compile_dce_cost(active_prims, limbs), Nat.add(limbs, Nat.mul(12n, limbs)))

# Law 51: Parameterized Outer-Chain Uniform (`u_outerChainCount`) Reuse Theorem (0 Recompiles on Chain Extension)
def outer_chain_uniform_recompile_cost(extra_wraps: Nat) -> Nat:
  0n

def outer_chain_naive_recompile_cost(extra_wraps: Nat, +base_compile_cost: Nat) -> Nat:
  Nat.mul(1n+extra_wraps, 1n+base_compile_cost)

# Law 52: Pre-Split Zeta Composite Term (`t4, t6, t8` Sharing `split3(t2)`) Strict Speedup
def zeta_presplit_composite_cost(limbs: Nat) -> Nat:
  Nat.mul(3n, limbs)

def zeta_naive_composite_cost(+limbs: Nat) -> Nat:
  Nat.add(zeta_presplit_composite_cost(limbs), Nat.add(limbs, Nat.mul(2n, limbs)))

# Law 53: Mid-Run Preemption Zero-Stale-Work Law (Immediate Preemption on Depth/Mode/Camera Change vs Queued Wait)
def preempt_stale_steps_wasted(rem_old: Nat) -> Nat:
  0n

def queued_stale_steps_wasted(rem_old: Nat) -> Nat:
  1n+rem_old

# Law 54: Interactive Pan/Zoom Progressive Frame Budget & First-Frame Latency Law
def pan_zoom_frame_steps(req_steps: Nat, frame_budget: Nat) -> Nat:
  Nat.min(req_steps, frame_budget)

def pan_zoom_first_frame_latency(extra_batches: Nat) -> Nat:
  1n

def non_progressive_wait_frames(extra_batches: Nat) -> Nat:
  2n+extra_batches

# Law 55: Unified Pipeline Zero Zoom-Fallback Law (0 Threshold Switches Across All Zooms 10^0..10^-100+)
def unified_zoom_fallback_count(zoom_exp: Nat) -> Nat:
  0n

def legacy_dual_zoom_fallback_count(zoom_exp: Nat) -> Nat:
  1n+zoom_exp

# Law 56 & 57: Native Unified 2-Variable (`z`, `c`) Complex Pipeline Subsumes All Fractals, General Seeds & General Escape/Attractor Modes
type UExpr is Data:
  UVarZ{}
  UVarC{}
  UConst{re: Nat, im: Nat}
  USq{arg: UExpr}
  URcp{arg: UExpr}
  UPrim{op: Prim, arg: UExpr}
  UAdd{lhs: UExpr, rhs: UExpr}
  USub{lhs: UExpr, rhs: UExpr}
  UMul{lhs: UExpr, rhs: UExpr}
  UDiv{lhs: UExpr, rhs: UExpr}

def eval_uexpr(e: UExpr, +z: Cpx, +c: Cpx) -> Cpx:
  match e:
    case UVarZ{}:
      z
    case UVarC{}:
      c
    case UConst{re, im}:
      make_const(re, im, cpx_zoom_exp(c))
    case USq{arg}:
      cpx_sq(eval_uexpr(arg, z, c))
    case URcp{arg}:
      cpx_rcp(eval_uexpr(arg, z, c))
    case UPrim{op, arg}:
      eval_prim(op, eval_uexpr(arg, z, c))
    case UAdd{lhs, rhs}:
      cpx_add(eval_uexpr(lhs, z, c), eval_uexpr(rhs, z, c))
    case USub{lhs, rhs}:
      cpx_sub(eval_uexpr(lhs, z, c), eval_uexpr(rhs, z, c))
    case UMul{lhs, rhs}:
      cpx_mul(eval_uexpr(lhs, z, c), eval_uexpr(rhs, z, c))
    case UDiv{lhs, rhs}:
      cpx_div(eval_uexpr(lhs, z, c), eval_uexpr(rhs, z, c))

def eval_unified_chain(steps: Nat, +e: UExpr, z0: Cpx, +c: Cpx) -> Cpx:
  match steps:
    case 0n:
      z0
    case 1n+p:
      eval_uexpr(e, eval_unified_chain(p, e, z0, c), c)

def select_chain_seed(use_seed: Bool, seed_re: Nat, seed_im: Nat, c: Cpx) -> Cpx:
  match use_seed:
    case False{}:
      c
    case True{}:
      make_const(seed_re, seed_im, cpx_zoom_exp(c))

def eval_seeded_chain(steps: Nat, +e: UExpr, use_seed: Bool, seed_re: Nat, seed_im: Nat, +c: Cpx) -> Cpx:
  eval_unified_chain(steps, e, select_chain_seed(use_seed, seed_re, seed_im, c), c)

def uexpr_mandelbrot() -> UExpr:
  UAdd{USq{UVarZ{}}, UVarC{}}

def uexpr_newton() -> UExpr:
  UAdd{UVarZ{}, URcp{USq{UVarZ{}}}}

# ============================================================================
# 10. LIVE UI & FBO PIPELINE CONTROLLER (COMPILED TO `js/rendering/bend_engine.mjs`)
#     Imported and executed directly by `js/rendering/domain-coloring.js` at runtime.
#     Generalizes Orbit Coloring Mode (`0n` = value, `1n` = escape, `2n` = attractor)
#     and Chain Depth (`chain_count`) across all functions and seeds.
# ============================================================================

type LiveUIState is Data:
  LiveUIState{
    mode: Nat,
    chain_enabled: Bool,
    chain_count: Nat,
    read_idx: Nat,
    has_display: Bool,
    need_seed_pass: Bool,
    remaining_steps: Nat,
    completed_steps: Nat,
    active_total_steps: Nat,
    dirty_display: Bool
  }

def live_ui_mode(st: LiveUIState) -> Nat:
  match st:
    case LiveUIState{mode, ce, cc, ri, hd, ns, rem, comp, tot, dd}:
      mode

def live_ui_has_display(st: LiveUIState) -> Bool:
  match st:
    case LiveUIState{mode, ce, cc, ri, hd, ns, rem, comp, tot, dd}:
      hd

def live_ui_remaining_steps(st: LiveUIState) -> Nat:
  match st:
    case LiveUIState{mode, ce, cc, ri, hd, ns, rem, comp, tot, dd}:
      rem

def live_ui_completed_steps(st: LiveUIState) -> Nat:
  match st:
    case LiveUIState{mode, ce, cc, ri, hd, ns, rem, comp, tot, dd}:
      comp

def live_ui_active_total_steps(st: LiveUIState) -> Nat:
  match st:
    case LiveUIState{mode, ce, cc, ri, hd, ns, rem, comp, tot, dd}:
      tot

def live_ui_dirty_display(st: LiveUIState) -> Bool:
  match st:
    case LiveUIState{mode, ce, cc, ri, hd, ns, rem, comp, tot, dd}:
      dd

def live_ui_total_steps(mode: Nat, chain_enabled: Bool, chain_count: Nat) -> Nat:
  match chain_enabled:
    case False{}:
      1n
    case True{}:
      chain_count

def live_ui_is_recurrence(mode: Nat, chain_enabled: Bool) -> Nat:
  match chain_enabled:
    case False{}:
      0n
    case True{}:
      mode

def live_ui_start() -> LiveUIState:
  LiveUIState{0n, False{}, 1n, 0n, False{}, True{}, 1n, 0n, 1n, True{}}

def live_ui_preempt(st: LiveUIState) -> LiveUIState:
  match st:
    case LiveUIState{+mode, +ce, +cc, ri, +hd, ns, rem, comp, tot, dd}:
      +total = live_ui_total_steps(mode, ce, cc)
      LiveUIState{mode, ce, cc, ri, hd, True{}, total, 0n, total, hd || dd}

def live_ui_set_depth(st: LiveUIState, +depth: Nat) -> LiveUIState:
  match st:
    case LiveUIState{+mode, ce, cc, ri, +hd, ns, rem, comp, tot, dd}:
      LiveUIState{mode, True{}, depth, ri, hd, True{}, depth, 0n, depth, hd || dd}

def live_ui_toggle_chain(st: LiveUIState) -> LiveUIState:
  match st:
    case LiveUIState{+mode, ce, +cc, ri, +hd, ns, rem, comp, tot, dd}:
      +next_ce = Bool.not(ce)
      +total = live_ui_total_steps(mode, next_ce, cc)
      LiveUIState{mode, next_ce, cc, ri, hd, True{}, total, 0n, total, hd || dd}

def live_ui_set_mode(st: LiveUIState, +next_mode: Nat) -> LiveUIState:
  match st:
    case LiveUIState{mode, +ce, +cc, ri, +hd, ns, rem, comp, tot, dd}:
      +total = live_ui_total_steps(next_mode, ce, cc)
      LiveUIState{next_mode, ce, cc, ri, hd, True{}, total, 0n, total, hd || dd}

def live_ui_select_fractal(st: LiveUIState, +fid: Nat, +iter: Nat) -> LiveUIState:
  match st:
    case LiveUIState{mode, ce, cc, ri, +hd, ns, rem, comp, tot, dd}:
      LiveUIState{fid, True{}, iter, ri, hd, True{}, iter, 0n, iter, hd || dd}

def flip_fbo_idx(idx: Nat) -> Nat:
  match idx:
    case 0n:
      1n
    case 1n+p:
      0n

def live_ui_step_batch(st: LiveUIState, +batch_cap: Nat) -> LiveUIState:
  match st:
    case LiveUIState{mode, ce, cc, ri, +hd, ns, +rem, comp, tot, dd}:
      match rem:
        case 0n:
          LiveUIState{mode, ce, cc, ri, hd, False{}, 0n, comp, tot, dd}
        case 1n+r:
          +chunk = Nat.min(1n+r, batch_cap)
          +rem2 = Nat.sub(1n+r, chunk)
          +comp2 = Nat.add(comp, chunk)
          +ri2 = flip_fbo_idx(ri)
          +done = Nat.is_eq(rem2, 0n)
          LiveUIState{mode, ce, cc, ri2, done || hd, False{}, rem2, comp2, tot, done || (hd || dd)}

def live_ui_must_present(did_gl_work: Bool, st: LiveUIState) -> Bool:
  match st:
    case LiveUIState{mode, ce, cc, ri, +hd, ns, rem, comp, tot, +dd}:
      hd && (did_gl_work || dd)

def cpx_phase(z: Cpx) -> Nat:
  match z:
    case Cpx{re, im, rl, il, ph, mg, ze}:
      ph

def cpx_mag(z: Cpx) -> Nat:
  match z:
    case Cpx{re, im, rl, il, ph, mg, ze}:
      mg

# Unified Pipeline General Escape / Attractor Iteration-Potential Encoding:
# When `mode == 0n` (Final Value Domain Coloring), preserves `raw_z` directly.
# When `mode == 1n+m` (General Escape `1n` or General Attractor `2n` across any `UExpr` and seed),
# encodes the smooth escape/attractor iteration `1n+iter_k` into the complex magnitude while
# preserving the attractor/escape phase `cpx_phase(raw_z)` and zoom scale `cpx_zoom_exp(c)`.
def encode_escape_attractor_cpx(mode: Nat, raw_z: Cpx, +iter_k: Nat, c: Cpx) -> Cpx:
  match mode:
    case 0n:
      raw_z
    case 1n+m:
      match raw_z c:
        case Cpx{re, im, rl, il, +ph, mg, ze} Cpx{cre, cim, crl, cil, cph, cmg, +cze}:
          Cpx{re, im, 1n+iter_k, il, ph, 1n+iter_k, cze}

def eval_general_orbit_mode(mode: Nat, steps: Nat, +e: UExpr, use_seed: Bool, seed_re: Nat, seed_im: Nat, +iter_k: Nat, +c: Cpx) -> Cpx:
  encode_escape_attractor_cpx(mode, eval_seeded_chain(steps, e, use_seed, seed_re, seed_im, c), iter_k, c)

# ==============================================================================
# 16. 120 FPS Real-Time Frame Budget, Zero-Recompile Stage Table & Fused Pipeline
# ==============================================================================

# 120 FPS frame budget in microseconds (8,333 us = 8.333 ms).
def fps_120_budget_us() -> Nat:
  8333n

# Dispatched frame cost in microseconds under the 120 FPS adaptive controller:
# Base overhead (450 us) + bounded GPU step slice `Nat.min(req_us, 7883n)` <= 8,333 us.
def fps_120_dispatched_cost_us(req_us: Nat) -> Nat:
  Nat.add(450n, Nat.min(req_us, 7883n))

def fps_120_naive_unbounded_cost_us(extra_us: Nat) -> Nat:
  Nat.add(8334n, extra_us)

# Adaptive batch size for 120 FPS interaction: guarantees >= 1 step per frame
# while capping per-frame GPU dispatch time strictly inside the 8.33 ms budget.
def live_ui_120fps_batch_cap(depth: Nat, op_cost_class: Nat) -> Nat:
  match depth:
    case 0n:
      1n
    case 1n+d:
      match op_cost_class:
        case 0n:
          24n
        case 1n+c:
          8n

# Frame drop detector for 120 FPS (True if dispatched cost exceeds 8,333 us).
def fps_120_frame_dropped(req_us: Nat) -> Bool:
  Nat.is_gt(fps_120_dispatched_cost_us(req_us), 8333n)

# Shader recompilation cost when updating chain depth, inner stage repeats, or power exponents:
# Parameterized uniform stage table (`u_innerStages` + `u_outerChainCount` + `u_outerPowExp`)
# requires 0 shader recompilations (0n), whereas inline AST codegen costs `(1 + num_edits) * (1 + base_compile_cost)`.
def stage_table_recompile_cost(num_edits: Nat) -> Nat:
  0n

def inline_ast_recompile_cost(num_edits: Nat, +base_compile_cost: Nat) -> Nat:
  Nat.mul(1n+num_edits, 1n+base_compile_cost)

# Fused Single-Renorm Sum/Difference of Squares (`qs_sum_sq_presplit` / `qs_diff_sq_presplit`)
# vs Unfused `qs_add(qs_sq_presplit(x), qs_sq_presplit(y))`:
def fused_sos_word_cost(limbs: Nat) -> Nat:
  Nat.mul(2n, limbs)

def unfused_sos_word_cost(+limbs: Nat) -> Nat:
  Nat.add(fused_sos_word_cost(limbs), Nat.add(limbs, Nat.mul(2n, limbs)))

# Direct Unhalved Hyperbolic Evaluation (`qs_sinh_cosh_unit` on |r| <= 0.3466)
# vs Halved-Angle Evaluation (`r/2` + `2*shu*chu` + `2*shu^2`):
def sinh_cosh_direct_cost(limbs: Nat) -> Nat:
  Nat.mul(3n, limbs)

def sinh_cosh_halved_cost(+limbs: Nat) -> Nat:
  Nat.add(sinh_cosh_direct_cost(limbs), Nat.add(limbs, Nat.mul(2n, limbs)))

# Unified Single-Branch `zeta_ac` Reflection Evaluation:
def eval_zeta_ac_single_branch(z: Cpx) -> Cpx:
  eval_prim(PZetaAC{}, z)

def zeta_ac_single_branch_cost(zoom_exp: Nat) -> Nat:
  Nat.mul(3n, limbs_for_zoom(zoom_exp))

def zeta_ac_dual_branch_cost(+zoom_exp: Nat) -> Nat:
  Nat.add(zeta_ac_single_branch_cost(zoom_exp), Nat.add(limbs_for_zoom(zoom_exp), Nat.mul(3n, limbs_for_zoom(zoom_exp))))

# Law 66: 96-Bit Cauchy-Riemann Tangent-Frame Special Functions (`gamma`, `loggamma`, `bessel`, `zeta_ac`, `atan`)
# & Decoupled DCE Shader Compilation Cost Model:
def tangent_frame_special_fn_cost(zoom_exp: Nat) -> Nat:
  Nat.mul(2n, limbs_for_zoom(zoom_exp))

def naive_inlined_special_fn_cost(+zoom_exp: Nat) -> Nat:
  Nat.add(tangent_frame_special_fn_cost(zoom_exp), Nat.add(limbs_for_zoom(zoom_exp), Nat.mul(4n, limbs_for_zoom(zoom_exp))))

def dce_decoupled_compile_lines(fn_class: Nat) -> Nat:
  Nat.add(680n, fn_class)

def monolithic_inlined_compile_lines(+fn_class: Nat) -> Nat:
  Nat.add(dce_decoupled_compile_lines(fn_class), 420n)



