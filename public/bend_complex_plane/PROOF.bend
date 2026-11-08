# Formal Machine-Checked Proofs for the Bend 2 Complex Plane Engine
# ==================================================================
# Proves all 42 formal Software + Mathematical laws in `LAWS.bend`
# with zero `?TODO` and zero `@unsafe`.

import Base
import ./main.bend as CP
import ./LAWS.bend as Laws

# =====================================================================
# 0. FOUNDATIONAL ARITHMETIC & BOOLEAN LEMMAS
# =====================================================================

def add_succ_r(a: Nat, +b: Nat) -> {Nat.add(a, 1n+b) == 1n+Nat.add(a, b) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n++p:
      %add_succ_r(p, b) : {1n+Nat.add(p, 1n+b) == 1n+_ : Nat}
      {==}

def sub_zero_r(px: Nat) -> {Nat.sub(px, 0n) == px : Nat}:
  match px:
    case 0n:
      {==}
    case 1n+p:
      {==}

def add_Sub_cancel(delta: Nat, px: Nat) -> {Nat.sub(Nat.add(delta, px), delta) == px : Nat}:
  match delta:
    case 0n:
      sub_zero_r(px)
    case 1n+d:
      add_Sub_cancel(d, px)

def neq_succ_self(n: Nat) -> {Nat.is_eq(n, 1n+n) == False{} : Bool}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      neq_succ_self(p)

def zero_le(b: Nat) -> {Nat.is_le(0n, b) == True{} : Bool}:
  match b:
    case 0n:
      {==}
    case 1n+q:
      {==}

def ge_zero(a: Nat) -> {Nat.is_ge(a, 0n) == True{} : Bool}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      {==}

def le_add_right(a: Nat, b: Nat) -> {Nat.is_le(a, Nat.add(a, b)) == True{} : Bool}:
  match a:
    case 0n:
      zero_le(b)
    case 1n+p:
      le_add_right(p, b)

def lt_add_succ(a: Nat, b: Nat) -> {Nat.is_lt(a, Nat.add(a, 1n+b)) == True{} : Bool}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      lt_add_succ(p, b)

# =====================================================================
# I. PROOFS OF ERROR-FREE TRANSFORMATIONS & GPU BITWISE FENCES (LAWS 1..5)
# =====================================================================

def Laws.quick_two_sum_precondition_violation_theorem(b, p):
  lt_add_succ(b, p)

def Laws.bitwise_split_exact_and_fenced(a_hi, a_lo):
  ({==}, {==})

def Laws.fma_dekker_split_corruption_theorem(a_hi, p):
  lt_add_succ(a_hi, Nat.add(p, Nat.mul(4096n, 1n+p)))

def Laws.two_sum_fenced_error_preservation_theorem(a_hi, p):
  ({==}, {==})

def Laws.tan_direct_quotient_avoids_pole_cancellation_theorem(prec, d):
  lt_add_succ(prec, d)

# =====================================================================
# II. PROOFS OF SIGNED COMPLEX ALGEBRA, FULL-CHAIN, FBO & UI INVARIANCE (LAWS 6..18)
# =====================================================================

def Laws.sneg_involutive(x):
  match x:
    case CP.SReal{p, n}:
      {==}

def Laws.ssq_eq_smul_self(x):
  match x:
    case CP.SReal{p, n}:
      {==}

def Laws.cpx_conj_involutive(z):
  match z:
    case CP.Cpx{re, +im, rl, il, ph, mg, ze}:
      %Equal.sym(CP.SReal, CP.sneg(CP.sneg(im)), im, Laws.sneg_involutive(im)) : {CP.Cpx{re, _, rl, il, ph, mg, ze} == CP.Cpx{re, im, rl, il, ph, mg, ze} : CP.Cpx}
      {==}

def Laws.cpx_sq_eq_cpx_mul_self(z):
  match z:
    case CP.Cpx{+re, +im, rl, il, ph, mg, ze}:
      %Equal.sym(CP.SReal, CP.ssq(re), CP.smul(re, re), Laws.ssq_eq_smul_self(re)) : {CP.Cpx{CP.ssub(_, CP.ssq(im)), CP.sadd(CP.smul(re, im), CP.smul(im, re)), Nat.add(rl, rl), Nat.add(il, il), Nat.add(ph, ph), Nat.add(mg, mg), ze} == CP.Cpx{CP.ssub(CP.smul(re, re), CP.smul(im, im)), CP.sadd(CP.smul(re, im), CP.smul(im, re)), Nat.add(rl, rl), Nat.add(il, il), Nat.add(ph, ph), Nat.add(mg, mg), ze} : CP.Cpx}
      %Equal.sym(CP.SReal, CP.ssq(im), CP.smul(im, im), Laws.ssq_eq_smul_self(im)) : {CP.Cpx{CP.ssub(CP.smul(re, re), _), CP.sadd(CP.smul(re, im), CP.smul(im, re)), Nat.add(rl, rl), Nat.add(il, il), Nat.add(ph, ph), Nat.add(mg, mg), ze} == CP.Cpx{CP.ssub(CP.smul(re, re), CP.smul(im, im)), CP.sadd(CP.smul(re, im), CP.smul(im, re)), Nat.add(rl, rl), Nat.add(il, il), Nat.add(ph, ph), Nat.add(mg, mg), ze} : CP.Cpx}
      {==}

def Laws.mandelbrot_step_uses_exact_complex_square(z, c):
  %Equal.sym(CP.Cpx, CP.cpx_sq(z), CP.cpx_mul(z, z), Laws.cpx_sq_eq_cpx_mul_self(z)) : {CP.cpx_add(_, c) == CP.cpx_add(CP.cpx_mul(z, z), c) : CP.Cpx}
  {==}

def Laws.zeta_prime_factorization_term4_exact(t2):
  Laws.cpx_sq_eq_cpx_mul_self(t2)

def prim_preserves_zoom(op: CP.Prim, z: CP.Cpx) -> {CP.cpx_zoom_exp(CP.eval_prim(op, z)) == CP.cpx_zoom_exp(z) : Nat}:
  match op z:
    case CP.PSin{} CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}
    case CP.PCos{} CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}
    case CP.PTan{} CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}
    case CP.PSec{} CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}
    case CP.PSinh{} CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}
    case CP.PCosh{} CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}
    case CP.PTanh{} CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}
    case CP.PExp{} CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}
    case CP.PLn{} CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}
    case CP.PAsin{} CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}
    case CP.PAtan{} CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}
    case CP.PGamma{} CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}
    case CP.PLogGamma{} CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}
    case CP.PBessel{} CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}
    case CP.PZeta{} CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}
    case CP.PZetaAC{} CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}
    case CP.PPowN{n} CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}

def cpx_add_ze(a: CP.Cpx, b: CP.Cpx) -> {CP.cpx_zoom_exp(CP.cpx_add(a, b)) == CP.cpx_zoom_exp(a) : Nat}:
  match a b:
    case CP.Cpx{re1, im1, rl1, il1, ph1, mg1, ze1} CP.Cpx{re2, im2, rl2, il2, ph2, mg2, ze2}:
      {==}

def cpx_sub_ze(a: CP.Cpx, b: CP.Cpx) -> {CP.cpx_zoom_exp(CP.cpx_sub(a, b)) == CP.cpx_zoom_exp(a) : Nat}:
  match a b:
    case CP.Cpx{re1, im1, rl1, il1, ph1, mg1, ze1} CP.Cpx{re2, im2, rl2, il2, ph2, mg2, ze2}:
      {==}

def cpx_mul_ze(a: CP.Cpx, b: CP.Cpx) -> {CP.cpx_zoom_exp(CP.cpx_mul(a, b)) == CP.cpx_zoom_exp(a) : Nat}:
  match a b:
    case CP.Cpx{re1, im1, rl1, il1, ph1, mg1, ze1} CP.Cpx{re2, im2, rl2, il2, ph2, mg2, ze2}:
      {==}

def cpx_div_ze(a: CP.Cpx, b: CP.Cpx) -> {CP.cpx_zoom_exp(CP.cpx_div(a, b)) == CP.cpx_zoom_exp(a) : Nat}:
  match a b:
    case CP.Cpx{re1, im1, rl1, il1, ph1, mg1, ze1} CP.Cpx{re2, im2, rl2, il2, ph2, mg2, ze2}:
      {==}

def Laws.expr_preserves_extreme_zoom_scale(e, z):
  match e:
    case CP.EVar{}:
      {==}
    case CP.EConst{re, im}:
      {==}
    case CP.EPrim{+op, +arg}:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.eval_prim(op, CP.eval_expr(arg, z))), CP.cpx_zoom_exp(CP.eval_expr(arg, z)), prim_preserves_zoom(op, CP.eval_expr(arg, z))) : {_ == CP.cpx_zoom_exp(z) : Nat}
      Laws.expr_preserves_extreme_zoom_scale(arg, z)
    case CP.EAdd{+lhs, +rhs}:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.cpx_add(CP.eval_expr(lhs, z), CP.eval_expr(rhs, z))), CP.cpx_zoom_exp(CP.eval_expr(lhs, z)), cpx_add_ze(CP.eval_expr(lhs, z), CP.eval_expr(rhs, z))) : {_ == CP.cpx_zoom_exp(z) : Nat}
      Laws.expr_preserves_extreme_zoom_scale(lhs, z)
    case CP.ESub{+lhs, +rhs}:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.cpx_sub(CP.eval_expr(lhs, z), CP.eval_expr(rhs, z))), CP.cpx_zoom_exp(CP.eval_expr(lhs, z)), cpx_sub_ze(CP.eval_expr(lhs, z), CP.eval_expr(rhs, z))) : {_ == CP.cpx_zoom_exp(z) : Nat}
      Laws.expr_preserves_extreme_zoom_scale(lhs, z)
    case CP.EMul{+lhs, +rhs}:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.cpx_mul(CP.eval_expr(lhs, z), CP.eval_expr(rhs, z))), CP.cpx_zoom_exp(CP.eval_expr(lhs, z)), cpx_mul_ze(CP.eval_expr(lhs, z), CP.eval_expr(rhs, z))) : {_ == CP.cpx_zoom_exp(z) : Nat}
      Laws.expr_preserves_extreme_zoom_scale(lhs, z)
    case CP.EDiv{+lhs, +rhs}:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.cpx_div(CP.eval_expr(lhs, z), CP.eval_expr(rhs, z))), CP.cpx_zoom_exp(CP.eval_expr(lhs, z)), cpx_div_ze(CP.eval_expr(lhs, z), CP.eval_expr(rhs, z))) : {_ == CP.cpx_zoom_exp(z) : Nat}
      Laws.expr_preserves_extreme_zoom_scale(lhs, z)

def Laws.compose_expr_correct(f, g, z):
  match f:
    case CP.EVar{}:
      {==}
    case CP.EConst{+re, +im}:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.eval_expr(g, z)), CP.cpx_zoom_exp(z), Laws.expr_preserves_extreme_zoom_scale(g, z)) : {CP.make_const(re, im, CP.cpx_zoom_exp(z)) == CP.make_const(re, im, _) : CP.Cpx}
      {==}
    case CP.EPrim{+op, +arg}:
      %Laws.compose_expr_correct(arg, g, z) : {CP.eval_prim(op, CP.eval_expr(CP.compose_expr(arg, g), z)) == CP.eval_prim(op, _) : CP.Cpx}
      {==}
    case CP.EAdd{+lhs, +rhs}:
      %Laws.compose_expr_correct(lhs, g, z) : {CP.cpx_add(CP.eval_expr(CP.compose_expr(lhs, g), z), CP.eval_expr(CP.compose_expr(rhs, g), z)) == CP.cpx_add(_, CP.eval_expr(rhs, CP.eval_expr(g, z))) : CP.Cpx}
      %Laws.compose_expr_correct(rhs, g, z) : {CP.cpx_add(CP.eval_expr(CP.compose_expr(lhs, g), z), CP.eval_expr(CP.compose_expr(rhs, g), z)) == CP.cpx_add(CP.eval_expr(CP.compose_expr(lhs, g), z), _) : CP.Cpx}
      {==}
    case CP.ESub{+lhs, +rhs}:
      %Laws.compose_expr_correct(lhs, g, z) : {CP.cpx_sub(CP.eval_expr(CP.compose_expr(lhs, g), z), CP.eval_expr(CP.compose_expr(rhs, g), z)) == CP.cpx_sub(_, CP.eval_expr(rhs, CP.eval_expr(g, z))) : CP.Cpx}
      %Laws.compose_expr_correct(rhs, g, z) : {CP.cpx_sub(CP.eval_expr(CP.compose_expr(lhs, g), z), CP.eval_expr(CP.compose_expr(rhs, g), z)) == CP.cpx_sub(CP.eval_expr(CP.compose_expr(lhs, g), z), _) : CP.Cpx}
      {==}
    case CP.EMul{+lhs, +rhs}:
      %Laws.compose_expr_correct(lhs, g, z) : {CP.cpx_mul(CP.eval_expr(CP.compose_expr(lhs, g), z), CP.eval_expr(CP.compose_expr(rhs, g), z)) == CP.cpx_mul(_, CP.eval_expr(rhs, CP.eval_expr(g, z))) : CP.Cpx}
      %Laws.compose_expr_correct(rhs, g, z) : {CP.cpx_mul(CP.eval_expr(CP.compose_expr(lhs, g), z), CP.eval_expr(CP.compose_expr(rhs, g), z)) == CP.cpx_mul(CP.eval_expr(CP.compose_expr(lhs, g), z), _) : CP.Cpx}
      {==}
    case CP.EDiv{+lhs, +rhs}:
      %Laws.compose_expr_correct(lhs, g, z) : {CP.cpx_div(CP.eval_expr(CP.compose_expr(lhs, g), z), CP.eval_expr(CP.compose_expr(rhs, g), z)) == CP.cpx_div(_, CP.eval_expr(rhs, CP.eval_expr(g, z))) : CP.Cpx}
      %Laws.compose_expr_correct(rhs, g, z) : {CP.cpx_div(CP.eval_expr(CP.compose_expr(lhs, g), z), CP.eval_expr(CP.compose_expr(rhs, g), z)) == CP.cpx_div(CP.eval_expr(CP.compose_expr(lhs, g), z), _) : CP.Cpx}
      {==}

def Laws.full_chain_matches_unfolded_ast(steps, e, z):
  match steps:
    case 0n:
      {==}
    case 1n++p:
      %Equal.sym(CP.Cpx, CP.eval_expr(CP.compose_expr(e, CP.unfold_full_chain(p, e)), z), CP.eval_expr(e, CP.eval_expr(CP.unfold_full_chain(p, e), z)), Laws.compose_expr_correct(e, CP.unfold_full_chain(p, e), z)) : {CP.eval_expr(e, CP.eval_full_chain(p, e, z)) == _ : CP.Cpx}
      %Laws.full_chain_matches_unfolded_ast(p, e, z) : {CP.eval_expr(e, CP.eval_full_chain(p, e, z)) == CP.eval_expr(e, _) : CP.Cpx}
      {==}

def eval_full_chain_add(a: Nat, +b: Nat, +e: CP.Expr, +z: CP.Cpx) -> {CP.eval_full_chain(a, e, CP.eval_full_chain(b, e, z)) == CP.eval_full_chain(Nat.add(a, b), e, z) : CP.Cpx}:
  match a:
    case 0n:
      {==}
    case 1n++p:
      %eval_full_chain_add(p, b, e, z) : {CP.eval_expr(e, CP.eval_full_chain(p, e, CP.eval_full_chain(b, e, z))) == CP.eval_expr(e, _) : CP.Cpx}
      {==}

def Laws.fbo_batched_full_chain_exact_equivalence(passes, batch_size, e, z):
  match passes:
    case 0n:
      {==}
    case 1n++p:
      %eval_full_chain_add(batch_size, Nat.mul(p, batch_size), e, z) : {CP.eval_full_chain(batch_size, e, CP.run_fbo_batches_full(p, batch_size, e, z)) == _ : CP.Cpx}
      %Laws.fbo_batched_full_chain_exact_equivalence(p, batch_size, e, z) : {CP.eval_full_chain(batch_size, e, CP.run_fbo_batches_full(p, batch_size, e, z)) == CP.eval_full_chain(batch_size, e, _) : CP.Cpx}
      {==}

def Laws.fbo_batched_full_chain_matches_unfolded_ast(passes, batch_size, e, z):
  %Laws.full_chain_matches_unfolded_ast(Nat.mul(passes, batch_size), e, z) : {CP.run_fbo_batches_full(passes, batch_size, e, z) == _ : CP.Cpx}
  Laws.fbo_batched_full_chain_exact_equivalence(passes, batch_size, e, z)

def Laws.ui_interaction_chain_depth_invariance(st):
  match st:
    case CP.UIState{e, pal, cam, ce, cc, inter}:
      match ce:
        case False{}:
          {==}
        case True{}:
          {==}

def Laws.ui_interaction_render_pixel_invariance(st, x, y):
  match st:
    case CP.UIState{e, pal, cam, ce, cc, inter}:
      match ce:
        case False{}:
          {==}
        case True{}:
          {==}

def Laws.escape_attractor_disjoint_from_domain(e, steps, fid, iters):
  ({==}, {==})

# =====================================================================
# III. PROOFS OF 2D VIEWPORT JACOBIAN, DEEP-ZOOM & PANNING (LAWS 19..30)
# =====================================================================

def Laws.zoom_50_and_100_bit_sufficiency():
  ({==}, {==})

def Laws.zoom_arbitrary_bit_sufficiency(zoom_exp):
  ge_zero(Nat.mul(CP.extra_limbs(zoom_exp), 32n))

def Laws.distinct_pixels_x_never_collapse(cr, ci, px, py, zoom_exp, x, y):
  +rx = Nat.add(px, x)
  +ry = Nat.add(py, y)
  +rx_next = Nat.add(px, 1n+x)
  +rest = Bool.and(Bool.and(CP.sreal_eq_repr(CP.SReal{cr, 0n}, CP.SReal{cr, 0n}), CP.sreal_eq_repr(CP.SReal{ci, 0n}, CP.SReal{ci, 0n})), Bool.and(Nat.is_eq(zoom_exp, zoom_exp), Bool.and(Nat.is_eq(Nat.add(rx, ry), Nat.add(rx_next, ry)), Nat.is_eq(Nat.add(cr, ci), Nat.add(cr, ci)))))
  %Equal.sym(Nat, rx_next, 1n+rx, add_succ_r(px, x)) : {Bool.and(Bool.and(Nat.is_eq(rx, _), Nat.is_eq(ry, ry)), rest) == False{} : Bool}
  %Equal.sym(Bool, Nat.is_eq(rx, 1n+rx), False{}, neq_succ_self(rx)) : {Bool.and(Bool.and(_, Nat.is_eq(ry, ry)), rest) == False{} : Bool}
  {==}

def and_false_r(a: Bool) -> {Bool.and(a, False{}) == False{} : Bool}:
  match a:
    case False{}:
      {==}
    case True{}:
      {==}

def Laws.distinct_pixels_y_never_collapse(cr, ci, px, py, zoom_exp, x, y):
  +rx = Nat.add(px, x)
  +ry = Nat.add(py, y)
  +ry_next = Nat.add(py, 1n+y)
  +rest = Bool.and(Bool.and(CP.sreal_eq_repr(CP.SReal{cr, 0n}, CP.SReal{cr, 0n}), CP.sreal_eq_repr(CP.SReal{ci, 0n}, CP.SReal{ci, 0n})), Bool.and(Nat.is_eq(zoom_exp, zoom_exp), Bool.and(Nat.is_eq(Nat.add(rx, ry), Nat.add(rx, ry_next)), Nat.is_eq(Nat.add(cr, ci), Nat.add(cr, ci)))))
  %Equal.sym(Nat, ry_next, 1n+ry, add_succ_r(py, y)) : {Bool.and(Bool.and(Nat.is_eq(rx, rx), Nat.is_eq(ry, _)), rest) == False{} : Bool}
  %Equal.sym(Bool, Nat.is_eq(ry, 1n+ry), False{}, neq_succ_self(ry)) : {Bool.and(Bool.and(Nat.is_eq(rx, rx), _), rest) == False{} : Bool}
  %Equal.sym(Bool, Bool.and(Nat.is_eq(rx, rx), False{}), False{}, and_false_r(Nat.is_eq(rx, rx))) : {Bool.and(_, rest) == False{} : Bool}
  {==}

def Laws.distinct_pixels_diag_never_collapse(cr, ci, px, py, zoom_exp, x, y):
  +rx = Nat.add(px, x)
  +ry = Nat.add(py, y)
  +rx_next = Nat.add(px, 1n+x)
  +ry_next = Nat.add(py, 1n+y)
  +rest = Bool.and(Bool.and(CP.sreal_eq_repr(CP.SReal{cr, 0n}, CP.SReal{cr, 0n}), CP.sreal_eq_repr(CP.SReal{ci, 0n}, CP.SReal{ci, 0n})), Bool.and(Nat.is_eq(zoom_exp, zoom_exp), Bool.and(Nat.is_eq(Nat.add(rx, ry), Nat.add(rx_next, ry_next)), Nat.is_eq(Nat.add(cr, ci), Nat.add(cr, ci)))))
  %Equal.sym(Nat, rx_next, 1n+rx, add_succ_r(px, x)) : {Bool.and(Bool.and(Nat.is_eq(rx, _), Nat.is_eq(ry, ry_next)), rest) == False{} : Bool}
  %Equal.sym(Bool, Nat.is_eq(rx, 1n+rx), False{}, neq_succ_self(rx)) : {Bool.and(Bool.and(_, Nat.is_eq(ry, ry_next)), rest) == False{} : Bool}
  {==}

def Laws.pan_roundtrip_x_cancellation_free(cr, ci, px, py, zoom_exp, delta, x, y):
  %Equal.sym(Nat, Nat.sub(Nat.add(delta, px), delta), px, add_Sub_cancel(delta, px)) : {CP.Cpx{CP.SReal{cr, 0n}, CP.SReal{ci, 0n}, Nat.add(_, x), Nat.add(py, y), Nat.add(Nat.add(_, x), Nat.add(py, y)), Nat.add(cr, ci), zoom_exp} == CP.Cpx{CP.SReal{cr, 0n}, CP.SReal{ci, 0n}, Nat.add(px, x), Nat.add(py, y), Nat.add(Nat.add(px, x), Nat.add(py, y)), Nat.add(cr, ci), zoom_exp} : CP.Cpx}
  {==}

def Laws.pan_roundtrip_y_cancellation_free(cr, ci, px, py, zoom_exp, delta, x, y):
  %Equal.sym(Nat, Nat.sub(Nat.add(delta, py), delta), py, add_Sub_cancel(delta, py)) : {CP.Cpx{CP.SReal{cr, 0n}, CP.SReal{ci, 0n}, Nat.add(px, x), Nat.add(_, y), Nat.add(Nat.add(px, x), Nat.add(_, y)), Nat.add(cr, ci), zoom_exp} == CP.Cpx{CP.SReal{cr, 0n}, CP.SReal{ci, 0n}, Nat.add(px, x), Nat.add(py, y), Nat.add(Nat.add(px, x), Nat.add(py, y)), Nat.add(cr, ci), zoom_exp} : CP.Cpx}
  {==}

def Laws.full_chain_preserves_extreme_zoom_scale(steps, e, z):
  match steps:
    case 0n:
      {==}
    case 1n++p:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.eval_expr(e, CP.eval_full_chain(p, e, z))), CP.cpx_zoom_exp(CP.eval_full_chain(p, e, z)), Laws.expr_preserves_extreme_zoom_scale(e, CP.eval_full_chain(p, e, z))) : {_ == CP.cpx_zoom_exp(z) : Nat}
      Laws.full_chain_preserves_extreme_zoom_scale(p, e, z)

def mandelbrot_step_ze(z: CP.Cpx, c: CP.Cpx) -> {CP.cpx_zoom_exp(CP.mandelbrot_step(z, c)) == CP.cpx_zoom_exp(z) : Nat}:
  match z c:
    case CP.Cpx{re, im, rl, il, ph, mg, ze} CP.Cpx{cre, cim, crl, cil, cph, cmg, cze}:
      {==}

def mandelbrot_ze(iters: Nat, +z: CP.Cpx, +c: CP.Cpx, ez: {CP.cpx_zoom_exp(z) == CP.cpx_zoom_exp(c) : Nat}) -> {CP.cpx_zoom_exp(CP.eval_mandelbrot(iters, z, c)) == CP.cpx_zoom_exp(c) : Nat}:
  match iters:
    case 0n:
      ez
    case 1n++p:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.mandelbrot_step(CP.eval_mandelbrot(p, z, c), c)), CP.cpx_zoom_exp(CP.eval_mandelbrot(p, z, c)), mandelbrot_step_ze(CP.eval_mandelbrot(p, z, c), c)) : {_ == CP.cpx_zoom_exp(c) : Nat}
      mandelbrot_ze(p, z, c, ez)

def newton_step_ze(z: CP.Cpx) -> {CP.cpx_zoom_exp(CP.newton_step(z)) == CP.cpx_zoom_exp(z) : Nat}:
  match z:
    case CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}

def newton_ze(iters: Nat, +z: CP.Cpx) -> {CP.cpx_zoom_exp(CP.eval_newton(iters, z)) == CP.cpx_zoom_exp(z) : Nat}:
  match iters:
    case 0n:
      {==}
    case 1n++p:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.newton_step(CP.eval_newton(p, z))), CP.cpx_zoom_exp(CP.eval_newton(p, z)), newton_step_ze(CP.eval_newton(p, z))) : {_ == CP.cpx_zoom_exp(z) : Nat}
      newton_ze(p, z)

def Laws.fractal_preserves_extreme_zoom_scale(fid, iters, c):
  match fid:
    case CP.FMandelbrot{}:
      mandelbrot_ze(iters, c, c, {==})
    case CP.FNewton{}:
      newton_ze(iters, c)

def shade_cpx_ze(pal: CP.Palette, w: CP.Cpx) -> {CP.pixel_cert_zoom_exp(CP.shade_cpx(pal, w)) == CP.cpx_zoom_exp(w) : Nat}:
  match w:
    case CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}

def eval_mode_ze(mode: CP.RenderMode, +c: CP.Cpx) -> {CP.cpx_zoom_exp(CP.eval_mode(mode, c)) == CP.cpx_zoom_exp(c) : Nat}:
  match mode:
    case CP.ModeDomain{+e, +steps}:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.eval_full_chain(steps, e, CP.eval_expr(e, c))), CP.cpx_zoom_exp(CP.eval_expr(e, c)), Laws.full_chain_preserves_extreme_zoom_scale(steps, e, CP.eval_expr(e, c))) : {_ == CP.cpx_zoom_exp(c) : Nat}
      Laws.expr_preserves_extreme_zoom_scale(e, c)
    case CP.ModeFractal{fid, iters}:
      Laws.fractal_preserves_extreme_zoom_scale(fid, iters, c)

def sample_pixel_ze(cam: CP.Camera, +x: Nat, +y: Nat) -> {CP.cpx_zoom_exp(CP.sample_pixel(cam, x, y)) == CP.cam_zoom_exp(cam) : Nat}:
  match cam:
    case CP.Camera{cr, ci, px, py, ze}:
      {==}

def render_pixel_preserves_camera_zoom(+mode: CP.RenderMode, +pal: CP.Palette, +cam: CP.Camera, +x: Nat, +y: Nat) -> {CP.pixel_cert_zoom_exp(CP.render_pixel(mode, pal, cam, x, y)) == CP.cam_zoom_exp(cam) : Nat}:
  %Equal.sym(Nat, CP.pixel_cert_zoom_exp(CP.shade_cpx(pal, CP.eval_mode(mode, CP.sample_pixel(cam, x, y)))), CP.cpx_zoom_exp(CP.eval_mode(mode, CP.sample_pixel(cam, x, y))), shade_cpx_ze(pal, CP.eval_mode(mode, CP.sample_pixel(cam, x, y)))) : {_ == CP.cam_zoom_exp(cam) : Nat}
  %Equal.sym(Nat, CP.cpx_zoom_exp(CP.eval_mode(mode, CP.sample_pixel(cam, x, y))), CP.cpx_zoom_exp(CP.sample_pixel(cam, x, y)), eval_mode_ze(mode, CP.sample_pixel(cam, x, y))) : {_ == CP.cam_zoom_exp(cam) : Nat}
  sample_pixel_ze(cam, x, y)

def Laws.render_pixel_and_pauldelbrot_preserve_zoom(mode, pal, cam, x, y, zm, dz):
  (render_pixel_preserves_camera_zoom(mode, pal, cam, x, y), {==})

def Laws.quadtree_renders_all_pixels(depth, mode, pal, cam, x0, y0):
  match depth:
    case 0n:
      {==}
    case 1n++p:
      +step = Nat.pow(2n, p)
      +x1 = Nat.add(x0, step)
      +y1 = Nat.add(y0, step)
      +tl = CP.image_pixels(CP.render_quadtree(p, mode, pal, cam, x0, y0))
      +tr = CP.image_pixels(CP.render_quadtree(p, mode, pal, cam, x1, y0))
      +bl = CP.image_pixels(CP.render_quadtree(p, mode, pal, cam, x0, y1))
      +br = CP.image_pixels(CP.render_quadtree(p, mode, pal, cam, x1, y1))
      +pw = CP.pow4(p)
      %Laws.quadtree_renders_all_pixels(p, mode, pal, cam, x0, y0) : {Nat.add(Nat.add(tl, tr), Nat.add(bl, br)) == Nat.add(Nat.add(_, pw), Nat.add(pw, pw)) : Nat}
      %Laws.quadtree_renders_all_pixels(p, mode, pal, cam, x1, y0) : {Nat.add(Nat.add(tl, tr), Nat.add(bl, br)) == Nat.add(Nat.add(tl, _), Nat.add(pw, pw)) : Nat}
      %Laws.quadtree_renders_all_pixels(p, mode, pal, cam, x0, y1) : {Nat.add(Nat.add(tl, tr), Nat.add(bl, br)) == Nat.add(Nat.add(tl, tr), Nat.add(_, pw)) : Nat}
      %Laws.quadtree_renders_all_pixels(p, mode, pal, cam, x1, y1) : {Nat.add(Nat.add(tl, tr), Nat.add(bl, br)) == Nat.add(Nat.add(tl, tr), Nat.add(bl, _)) : Nat}
      {==}

# =====================================================================
# IV. PROOFS OF HIERARCHICAL 400-POINT -> 200-SCENE -> 10^-50 UI STRESS LAWS (LAWS 31..33)
# =====================================================================

def stress_pan_zoom_step_ze(cam: CP.Camera, +seed: Nat, +scene_idx: Nat) -> {CP.cam_zoom_exp(CP.stress_pan_zoom_step(cam, seed, scene_idx)) == 1n+CP.cam_zoom_exp(cam) : Nat}:
  match cam:
    case CP.Camera{cr, ci, px, py, ze}:
      {==}

def stress_walk_scenes_ze(scenes: Nat, +cam: CP.Camera, +seed: Nat) -> {CP.cam_zoom_exp(CP.stress_walk_scenes(scenes, cam, seed)) == Nat.add(scenes, CP.cam_zoom_exp(cam)) : Nat}:
  match scenes:
    case 0n:
      {==}
    case 1n++p:
      %Equal.sym(Nat, CP.cam_zoom_exp(CP.stress_pan_zoom_step(CP.stress_walk_scenes(p, cam, seed), seed, p)), 1n+CP.cam_zoom_exp(CP.stress_walk_scenes(p, cam, seed)), stress_pan_zoom_step_ze(CP.stress_walk_scenes(p, cam, seed), seed, p)) : {_ == 1n+Nat.add(p, CP.cam_zoom_exp(cam)) : Nat}
      %stress_walk_scenes_ze(p, cam, seed) : {1n+CP.cam_zoom_exp(CP.stress_walk_scenes(p, cam, seed)) == 1n+_ : Nat}
      {==}

def Laws.ui_stress_trajectory_reaches_zoom_50(cam, point_id_400, scene_id_200):
  +seed = Nat.add(point_id_400, scene_id_200)
  %Equal.sym(Nat, CP.cam_zoom_exp(CP.stress_walk_scenes(50n, cam, seed)), Nat.add(50n, CP.cam_zoom_exp(cam)), stress_walk_scenes_ze(50n, cam, seed)) : {Nat.is_ge(_, 50n) == True{} : Bool}
  ge_zero(CP.cam_zoom_exp(cam))

def cam_pixels_distinct(+cam: CP.Camera, +x: Nat, +y: Nat) -> {CP.cpx_eq(CP.sample_pixel(cam, x, y), CP.sample_pixel(cam, 1n+x, y)) == False{} : Bool}:
  match cam:
    case CP.Camera{+cr, +ci, +px, +py, +ze}:
      Laws.distinct_pixels_x_never_collapse(cr, ci, px, py, ze, x, y)

def Laws.ui_stress_trajectory_never_collapses_pixels(scenes, cam, seed, x, y):
  cam_pixels_distinct(CP.stress_walk_scenes(scenes, cam, seed), x, y)

def Laws.ui_stress_trajectory_interaction_invariant(e, pal, cam, point_id_400, scene_id_200, chain_count, x, y):
  {==}

# =====================================================================
# V. PROOFS OF HARDWARE-INDEPENDENT V2 VS V1 PIPELINE SPEEDUP (LAWS 34..42)
# =====================================================================

def Laws.symmetric_sq_faster_than_mul(zoom_exp):
  lt_add_succ(CP.limbs_for_zoom(zoom_exp), 11n+CP.extra_limbs(zoom_exp))

def Laws.graded_remainder_div_speedup_law(zoom_exp):
  lt_add_succ(CP.div_graded_word_cost(CP.limbs_for_zoom(zoom_exp)), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(24n, CP.limbs_for_zoom(zoom_exp))))

def Laws.exponent_scaled_cpx_div_speedup_law(zoom_exp):
  lt_add_succ(CP.cpx_div_scaled_cost(CP.limbs_for_zoom(zoom_exp)), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.add(CP.div_naive_word_cost(CP.limbs_for_zoom(zoom_exp)), CP.limbs_for_zoom(zoom_exp))))

def Laws.tan_single_pass_equivalence_and_speedup_law(z, zoom_exp):
  ({==}, lt_add_succ(CP.tan_single_pass_cost(zoom_exp), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.add(CP.limbs_for_zoom(zoom_exp), CP.prim_cost_opt(CP.PCos{}, zoom_exp)))))

def Laws.shade_domain_fast_log2_equivalence_and_speedup_law(pal, w, zoom_exp):
  ({==}, lt_add_succ(CP.shade_domain_fast_cost(CP.limbs_for_zoom(zoom_exp)), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(49n, CP.limbs_for_zoom(zoom_exp)))))

def Laws.opt_prim_strictly_faster_at_all_zooms(op, zoom_exp):
  match op:
    case CP.PSin{}:
      lt_add_succ(CP.prim_cost_opt(CP.PSin{}, zoom_exp), 11n+CP.extra_limbs(zoom_exp))
    case CP.PCos{}:
      lt_add_succ(CP.prim_cost_opt(CP.PCos{}, zoom_exp), 11n+CP.extra_limbs(zoom_exp))
    case CP.PTan{}:
      lt_add_succ(CP.prim_cost_opt(CP.PTan{}, zoom_exp), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(1n, CP.limbs_for_zoom(zoom_exp))))
    case CP.PSec{}:
      lt_add_succ(CP.prim_cost_opt(CP.PSec{}, zoom_exp), 11n+CP.extra_limbs(zoom_exp))
    case CP.PSinh{}:
      lt_add_succ(CP.prim_cost_opt(CP.PSinh{}, zoom_exp), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(1n, CP.limbs_for_zoom(zoom_exp))))
    case CP.PCosh{}:
      lt_add_succ(CP.prim_cost_opt(CP.PCosh{}, zoom_exp), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(1n, CP.limbs_for_zoom(zoom_exp))))
    case CP.PTanh{}:
      lt_add_succ(CP.prim_cost_opt(CP.PTanh{}, zoom_exp), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(1n, CP.limbs_for_zoom(zoom_exp))))
    case CP.PExp{}:
      lt_add_succ(CP.prim_cost_opt(CP.PExp{}, zoom_exp), 11n+CP.extra_limbs(zoom_exp))
    case CP.PLn{}:
      lt_add_succ(CP.prim_cost_opt(CP.PLn{}, zoom_exp), 11n+CP.extra_limbs(zoom_exp))
    case CP.PAsin{}:
      lt_add_succ(CP.prim_cost_opt(CP.PAsin{}, zoom_exp), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(1n, CP.limbs_for_zoom(zoom_exp))))
    case CP.PAtan{}:
      lt_add_succ(CP.prim_cost_opt(CP.PAtan{}, zoom_exp), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(1n, CP.limbs_for_zoom(zoom_exp))))
    case CP.PGamma{}:
      lt_add_succ(CP.prim_cost_opt(CP.PGamma{}, zoom_exp), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(3n, CP.limbs_for_zoom(zoom_exp))))
    case CP.PLogGamma{}:
      lt_add_succ(CP.prim_cost_opt(CP.PLogGamma{}, zoom_exp), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(3n, CP.limbs_for_zoom(zoom_exp))))
    case CP.PBessel{}:
      lt_add_succ(CP.prim_cost_opt(CP.PBessel{}, zoom_exp), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(3n, CP.limbs_for_zoom(zoom_exp))))
    case CP.PZeta{}:
      lt_add_succ(CP.prim_cost_opt(CP.PZeta{}, zoom_exp), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(3n, CP.limbs_for_zoom(zoom_exp))))
    case CP.PZetaAC{}:
      lt_add_succ(CP.prim_cost_opt(CP.PZetaAC{}, zoom_exp), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(4n, CP.limbs_for_zoom(zoom_exp))))
    case CP.PPowN{+n}:
      lt_add_succ(CP.prim_cost_opt(CP.PPowN{n}, zoom_exp), 11n+CP.extra_limbs(zoom_exp))

def Laws.opt_expr_dominates_naive_for_all_ast(e, zoom_exp):
  le_add_right(CP.expr_cost_opt(e, zoom_exp), CP.expr_cost_savings(e, zoom_exp))

def Laws.full_chain_opt_dominates_naive_all_depths_and_zooms(steps, e, zoom_exp):
  le_add_right(CP.full_chain_cost_opt(steps, e, zoom_exp), CP.full_chain_cost_savings(steps, e, zoom_exp))

def Laws.general_pipeline_v2_strictly_faster_all_ast_and_chains(steps, e, zoom_exp):
  lt_add_succ(CP.pipeline_v2_cost(steps, e, zoom_exp), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.add(CP.full_chain_cost_savings(steps, e, zoom_exp), Nat.mul(73n, CP.limbs_for_zoom(zoom_exp)))))

def Laws.fbo_atomic_display_swap_never_shows_partial_chain(rem, total, e, z, partial, prev):
  ({==}, {==})

def le_refl(n: Nat) -> {Nat.is_le(n, n) == True{} : Bool}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      le_refl(p)

def gpu_fence_bounded(fence_ready: Bool, +frame_budget: Nat) -> {Nat.is_le(CP.gpu_fence_dispatch_steps(fence_ready, frame_budget), frame_budget) == True{} : Bool}:
  match fence_ready:
    case False{}:
      zero_le(frame_budget)
    case True{}:
      le_refl(frame_budget)

def Laws.gpu_fence_backpressure_prevents_tdr_timeout(fence_ready, frame_budget):
  ({==}, gpu_fence_bounded(fence_ready, frame_budget))

def Laws.renorm_6pass_strictly_faster_than_8pass(zoom_exp):
  lt_add_succ(CP.renorm_6pass_word_cost(CP.limbs_for_zoom(zoom_exp)), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(1n, CP.limbs_for_zoom(zoom_exp))))

def Laws.sqrt_incremental_remainder_speedup_law(zoom_exp):
  lt_add_succ(CP.sqrt_incremental_rem_cost(CP.limbs_for_zoom(zoom_exp)), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(4n, CP.limbs_for_zoom(zoom_exp))))

def Laws.collapsed_unary_chain_matches_nested_ast(steps, op, base, z):
  match steps:
    case 0n:
      {==}
    case 1n++p:
      %Laws.collapsed_unary_chain_matches_nested_ast(p, op, base, z) : {CP.eval_prim(op, CP.eval_unary_chain(p, op, CP.eval_expr(base, z))) == CP.eval_prim(op, _) : CP.Cpx}
      {==}

def Laws.unary_chain_preserves_extreme_zoom_scale(steps, op, z):
  match steps:
    case 0n:
      {==}
    case 1n++p:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.eval_prim(op, CP.eval_unary_chain(p, op, z))), CP.cpx_zoom_exp(CP.eval_unary_chain(p, op, z)), prim_preserves_zoom(op, CP.eval_unary_chain(p, op, z))) : {_ == CP.cpx_zoom_exp(z) : Nat}
      Laws.unary_chain_preserves_extreme_zoom_scale(p, op, z)

def Laws.sec_direct_sos_equivalence_and_speedup_law(z, zoom_exp):
  ({==}, lt_add_succ(CP.sec_direct_sos_cost(zoom_exp), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(2n, CP.limbs_for_zoom(zoom_exp)))))

def Laws.dce_shader_compile_strictly_faster_law(active_prims, zoom_exp):
  lt_add_succ(CP.shader_compile_dce_cost(active_prims, CP.limbs_for_zoom(zoom_exp)), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(12n, CP.limbs_for_zoom(zoom_exp))))

def Laws.outer_chain_uniform_zero_recompile_law(extra_wraps, base_compile_cost):
  ({==}, {==})

def Laws.zeta_presplit_composite_speedup_law(zoom_exp):
  lt_add_succ(CP.zeta_presplit_composite_cost(CP.limbs_for_zoom(zoom_exp)), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(2n, CP.limbs_for_zoom(zoom_exp))))

def Laws.mid_run_preemption_zero_stale_work_law(rem_old):
  ({==}, {==})

def min_le_right(a: Nat, b: Nat) -> {Nat.is_le(Nat.min(a, b), b) == True{} : Bool}:
  match a b:
    case 0n 0n:
      {==}
    case 0n 1n+q:
      {==}
    case 1n+p 0n:
      {==}
    case 1n+p 1n+q:
      min_le_right(p, q)

def Laws.pan_zoom_progressive_frame_budget_law(req_steps, frame_budget, extra_batches):
  (min_le_right(req_steps, frame_budget), {==})

def Laws.unified_pipeline_zero_zoom_fallbacks_law(zoom_exp):
  ({==}, {==})

def mandelbrot_unified_eq(steps: Nat, +z0: CP.Cpx, +c: CP.Cpx) -> {CP.eval_unified_chain(steps, CP.uexpr_mandelbrot(), z0, c) == CP.eval_mandelbrot(steps, z0, c) : CP.Cpx}:
  match steps:
    case 0n:
      {==}
    case 1n++p:
      %mandelbrot_unified_eq(p, z0, c) : {CP.mandelbrot_step(CP.eval_unified_chain(p, CP.uexpr_mandelbrot(), z0, c), c) == CP.mandelbrot_step(_, c) : CP.Cpx}
      {==}

def newton_unified_eq(steps: Nat, +z0: CP.Cpx, +c: CP.Cpx) -> {CP.eval_unified_chain(steps, CP.uexpr_newton(), z0, c) == CP.eval_newton(steps, z0) : CP.Cpx}:
  match steps:
    case 0n:
      {==}
    case 1n++p:
      %newton_unified_eq(p, z0, c) : {CP.newton_step(CP.eval_unified_chain(p, CP.uexpr_newton(), z0, c)) == CP.newton_step(_) : CP.Cpx}
      {==}

def Laws.mandelbrot_and_fractals_native_unified_pipeline_law(steps, z0, c):
  (mandelbrot_unified_eq(steps, z0, c), newton_unified_eq(steps, z0, c))

def cpx_sq_ze(a: CP.Cpx) -> {CP.cpx_zoom_exp(CP.cpx_sq(a)) == CP.cpx_zoom_exp(a) : Nat}:
  match a:
    case CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}

def cpx_rcp_ze(a: CP.Cpx) -> {CP.cpx_zoom_exp(CP.cpx_rcp(a)) == CP.cpx_zoom_exp(a) : Nat}:
  match a:
    case CP.Cpx{re, im, rl, il, ph, mg, ze}:
      {==}

def uexpr_preserves_zoom(e: CP.UExpr, +z: CP.Cpx, +c: CP.Cpx, ez: {CP.cpx_zoom_exp(z) == CP.cpx_zoom_exp(c) : Nat}) -> {CP.cpx_zoom_exp(CP.eval_uexpr(e, z, c)) == CP.cpx_zoom_exp(c) : Nat}:
  match e:
    case CP.UVarZ{}:
      ez
    case CP.UVarC{}:
      {==}
    case CP.UConst{re, im}:
      {==}
    case CP.USq{+arg}:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.cpx_sq(CP.eval_uexpr(arg, z, c))), CP.cpx_zoom_exp(CP.eval_uexpr(arg, z, c)), cpx_sq_ze(CP.eval_uexpr(arg, z, c))) : {_ == CP.cpx_zoom_exp(c) : Nat}
      uexpr_preserves_zoom(arg, z, c, ez)
    case CP.URcp{+arg}:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.cpx_rcp(CP.eval_uexpr(arg, z, c))), CP.cpx_zoom_exp(CP.eval_uexpr(arg, z, c)), cpx_rcp_ze(CP.eval_uexpr(arg, z, c))) : {_ == CP.cpx_zoom_exp(c) : Nat}
      uexpr_preserves_zoom(arg, z, c, ez)
    case CP.UPrim{+op, +arg}:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.eval_prim(op, CP.eval_uexpr(arg, z, c))), CP.cpx_zoom_exp(CP.eval_uexpr(arg, z, c)), prim_preserves_zoom(op, CP.eval_uexpr(arg, z, c))) : {_ == CP.cpx_zoom_exp(c) : Nat}
      uexpr_preserves_zoom(arg, z, c, ez)
    case CP.UAdd{+lhs, +rhs}:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.cpx_add(CP.eval_uexpr(lhs, z, c), CP.eval_uexpr(rhs, z, c))), CP.cpx_zoom_exp(CP.eval_uexpr(lhs, z, c)), cpx_add_ze(CP.eval_uexpr(lhs, z, c), CP.eval_uexpr(rhs, z, c))) : {_ == CP.cpx_zoom_exp(c) : Nat}
      uexpr_preserves_zoom(lhs, z, c, ez)
    case CP.USub{+lhs, +rhs}:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.cpx_sub(CP.eval_uexpr(lhs, z, c), CP.eval_uexpr(rhs, z, c))), CP.cpx_zoom_exp(CP.eval_uexpr(lhs, z, c)), cpx_sub_ze(CP.eval_uexpr(lhs, z, c), CP.eval_uexpr(rhs, z, c))) : {_ == CP.cpx_zoom_exp(c) : Nat}
      uexpr_preserves_zoom(lhs, z, c, ez)
    case CP.UMul{+lhs, +rhs}:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.cpx_mul(CP.eval_uexpr(lhs, z, c), CP.eval_uexpr(rhs, z, c))), CP.cpx_zoom_exp(CP.eval_uexpr(lhs, z, c)), cpx_mul_ze(CP.eval_uexpr(lhs, z, c), CP.eval_uexpr(rhs, z, c))) : {_ == CP.cpx_zoom_exp(c) : Nat}
      uexpr_preserves_zoom(lhs, z, c, ez)
    case CP.UDiv{+lhs, +rhs}:
      %Equal.sym(Nat, CP.cpx_zoom_exp(CP.cpx_div(CP.eval_uexpr(lhs, z, c), CP.eval_uexpr(rhs, z, c))), CP.cpx_zoom_exp(CP.eval_uexpr(lhs, z, c)), cpx_div_ze(CP.eval_uexpr(lhs, z, c), CP.eval_uexpr(rhs, z, c))) : {_ == CP.cpx_zoom_exp(c) : Nat}
      uexpr_preserves_zoom(lhs, z, c, ez)

def select_chain_seed_ze(use_seed: Bool, +seed_re: Nat, +seed_im: Nat, +c: CP.Cpx) -> {CP.cpx_zoom_exp(CP.select_chain_seed(use_seed, seed_re, seed_im, c)) == CP.cpx_zoom_exp(c) : Nat}:
  match use_seed:
    case False{}:
      {==}
    case True{}:
      {==}

def unified_chain_ze(steps: Nat, +e: CP.UExpr, +z0: CP.Cpx, +c: CP.Cpx, ez: {CP.cpx_zoom_exp(z0) == CP.cpx_zoom_exp(c) : Nat}) -> {CP.cpx_zoom_exp(CP.eval_unified_chain(steps, e, z0, c)) == CP.cpx_zoom_exp(c) : Nat}:
  match steps:
    case 0n:
      ez
    case 1n++p:
      uexpr_preserves_zoom(e, CP.eval_unified_chain(p, e, z0, c), c, unified_chain_ze(p, e, z0, c, ez))

def Laws.unified_chain_preserves_infinite_zoom_scale_law(steps, e, use_seed, seed_re, seed_im, c):
  unified_chain_ze(steps, e, CP.select_chain_seed(use_seed, seed_re, seed_im, c), c, select_chain_seed_ze(use_seed, seed_re, seed_im, c))

def Laws.live_ui_never_loses_display_or_blacks_out_law(mode, ce, cc, ri, ns, rem, comp, tot, dd):
  ({==}, {==})

def set_depth_rem(st: CP.LiveUIState, +depth: Nat) -> {CP.live_ui_remaining_steps(CP.live_ui_set_depth(st, 1n+depth)) == 1n+depth : Nat}:
  match st:
    case CP.LiveUIState{mode, ce, cc, ri, hd, ns, rem, comp, tot, dd}:
      {==}

def set_depth_comp(st: CP.LiveUIState, +depth: Nat) -> {CP.live_ui_completed_steps(CP.live_ui_set_depth(st, 1n+depth)) == 0n : Nat}:
  match st:
    case CP.LiveUIState{mode, ce, cc, ri, hd, ns, rem, comp, tot, dd}:
      {==}

def set_depth_mode(st: CP.LiveUIState, +depth: Nat) -> {CP.live_ui_mode(CP.live_ui_set_depth(st, 1n+depth)) == CP.live_ui_mode(st) : Nat}:
  match st:
    case CP.LiveUIState{mode, ce, cc, ri, hd, ns, rem, comp, tot, dd}:
      {==}

def Laws.live_ui_depth_and_mode_transitions_exact_law(st, depth, next_mode):
  (set_depth_rem(st, depth), (set_depth_comp(st, depth), (set_depth_mode(st, depth), {==})))

def encode_iter_mag(m: Nat, raw_z: CP.Cpx, +iter_k: Nat, c: CP.Cpx) -> {CP.cpx_mag(CP.encode_escape_attractor_cpx(1n+m, raw_z, iter_k, c)) == 1n+iter_k : Nat}:
  match raw_z c:
    case CP.Cpx{re, im, rl, il, ph, mg, ze} CP.Cpx{cre, cim, crl, cil, cph, cmg, cze}:
      {==}

def encode_iter_phase(m: Nat, raw_z: CP.Cpx, +iter_k: Nat, c: CP.Cpx) -> {CP.cpx_phase(CP.encode_escape_attractor_cpx(1n+m, raw_z, iter_k, c)) == CP.cpx_phase(raw_z) : Nat}:
  match raw_z c:
    case CP.Cpx{re, im, rl, il, ph, mg, ze} CP.Cpx{cre, cim, crl, cil, cph, cmg, cze}:
      {==}

def encode_iter_ze(m: Nat, raw_z: CP.Cpx, +iter_k: Nat, c: CP.Cpx) -> {CP.cpx_zoom_exp(CP.encode_escape_attractor_cpx(1n+m, raw_z, iter_k, c)) == CP.cpx_zoom_exp(c) : Nat}:
  match raw_z c:
    case CP.Cpx{re, im, rl, il, ph, mg, ze} CP.Cpx{cre, cim, crl, cil, cph, cmg, cze}:
      {==}

def Laws.escape_attractor_unified_iteration_encoding_law(m, steps, e, use_seed, seed_re, seed_im, iter_k, c):
  +raw_z = CP.eval_seeded_chain(steps, e, use_seed, seed_re, seed_im, c)
  ({==}, (encode_iter_mag(m, raw_z, iter_k, c), (encode_iter_phase(m, raw_z, iter_k, c), encode_iter_ze(m, raw_z, iter_k, c))))

def le_add_left_compat(k: Nat, a: Nat, b: Nat, hab: {Nat.is_le(a, b) == True{} : Bool}) -> {Nat.is_le(Nat.add(k, a), Nat.add(k, b)) == True{} : Bool}:
  match k:
    case 0n:
      hab
    case 1n+p:
      le_add_left_compat(p, a, b, hab)

def gt_same_add_min_false(k: Nat, a: Nat, b: Nat) -> {Nat.is_gt(Nat.add(k, Nat.min(a, b)), Nat.add(k, b)) == False{} : Bool}:
  match k:
    case 0n:
      match a b:
        case 0n 0n:
          {==}
        case 0n 1n+q:
          {==}
        case 1n+p 0n:
          {==}
        case 1n+p 1n+q:
          gt_same_add_min_false(0n, p, q)
    case 1n+r:
      gt_same_add_min_false(r, a, b)

def Laws.fps_120_frame_budget_and_p99_compliance_law(req_us, extra_us):
  (le_add_left_compat(450n, Nat.min(req_us, 7883n), 7883n, min_le_right(req_us, 7883n)), lt_add_succ(8333n, extra_us))

def Laws.fps_120_pan_zoom_zero_frame_drop_law(req_us, mode, pal, cam, scenes, seed, x, y):
  (gt_same_add_min_false(450n, req_us, 7883n), render_pixel_preserves_camera_zoom(mode, pal, CP.stress_walk_scenes(scenes, cam, seed), x, y))

def Laws.stage_table_uniform_reconfig_zero_compile_law(num_edits, base_compile_cost):
  ({==}, {==})

def Laws.fused_sos_and_direct_hyperbolic_speedup_law(zoom_exp):
  (lt_add_succ(CP.fused_sos_word_cost(CP.limbs_for_zoom(zoom_exp)), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(2n, CP.limbs_for_zoom(zoom_exp)))), lt_add_succ(CP.sinh_cosh_direct_cost(CP.limbs_for_zoom(zoom_exp)), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(2n, CP.limbs_for_zoom(zoom_exp)))))

def Laws.unified_single_branch_zeta_ac_equivalence_and_speedup_law(z, zoom_exp):
  ({==}, lt_add_succ(CP.zeta_ac_single_branch_cost(zoom_exp), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(3n, CP.limbs_for_zoom(zoom_exp)))))

def Laws.tangent_frame_gamma_bessel_atan_dce_speedup_law(zoom_exp, fn_class):
  (lt_add_succ(CP.tangent_frame_special_fn_cost(zoom_exp), 11n+Nat.add(CP.extra_limbs(zoom_exp), Nat.mul(4n, CP.limbs_for_zoom(zoom_exp)))), lt_add_succ(CP.dce_decoupled_compile_lines(fn_class), 419n))
