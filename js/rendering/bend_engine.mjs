function word_to_u32(w) {
  let x = 0;
  for (let i = 0; w.$ === "WCon"; i++) {
    x |= Number(w.head) << i;
    w = w.tail;
  }
  return x >>> 0;
}

function u32_to_word(x) {
  let w = {$: "WNil"};
  for (let i = 31; i >= 0; i--) {
    w = {$: "WCon", head: ((x >>> i) & 1) === 1, tail: w};
  }
  return w;
}

function cmp_new(a, b) {
  return {$: a < b ? "LT" : a === b ? "EQ" : "GT"};
}

function nat_divmod(a, b) {
  return b === 0 ? {$: "Tuple", fst: 0, snd: a}
    : {$: "Tuple", fst: Math.trunc(a / b), snd: a % b};
}

function nat_chk(n) {
  if (n > 281474976710655) {
    throw "bend: a Nat past the largest immediate 2^48-1";
  }
  return n;
}

function nat_in(n) {
  if (!Number.isInteger(n) || n < 0 || n > 2 ** 53) {
    throw "bend: expected a Nat host number: an integer from 0 to 2^53";
  }
  return n;
}

function f32_show(x) {
  let s = "nan";
  for (let p = 1; x === x && p <= 9 && f32_round(s) !== x; p += 1) {
    s = String(Number(x.toExponential(p - 1)));
  }
  return (Object.is(x, -0) ? "-0" : s).replace("Infinity", "inf");
}

function f32_bits(x) {
  return new Uint32Array(new Float32Array([x]).buffer)[0];
}

function f32_from_bits(u) {
  return new Float32Array(new Uint32Array([u]).buffer)[0];
}

function f32_read(s) {
  const re = /^[\t\n\v\f\r ]*[+-]?((\d+(?:\.\d*)?|\.\d+)(e[+-]?\d+)?|inf(inity)?|nan)$/i;
  const v = f32_round(s.replace(/inf\w*/i, "Infinity"));
  return re.test(s) ? {$: "Some", value: v} : {$: "None"};
}

const f32_round = function f32_round(s) {
  const d = Number(s), a = Math.abs(d), f = Math.fround(a), g = 2 * a - Math.min(f, 340282366920938500000000000000000000000);
  if (g === f || Math.fround(g) !== g || g === 1 / 0)
    return Math.sign(d) * f;
  let k = 0;
  while (a * 2 ** k % 1 !== 0)
    k += 1;
  const [, i, r, e] = /(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i.exec(s), n = Number(e ?? 0) - r.length, x = BigInt(i + r) * 2n ** BigInt(k) * 10n ** BigInt(Math.max(n, 0)), y = BigInt(a * 2 ** k) * 10n ** BigInt(Math.max(-n, 0));
  return Math.sign(d) * (x === y || x > y !== g > f ? f : g);
};

const char_new = function char_new(c) {
  return c < 55296 || c >= 57344 && c <= 1114111 ? String.fromCodePoint(c) : String.fromCharCode(56320, c >>> 22, c >>> 11 & 2047, c & 2047);
};

function char_len(s, at = 0) {
  return s[at] === "\uDC00" ? 4 : s.codePointAt(at) > 0xFFFF ? 2 : 1;
}

function char_code(s) {
  return s.length < 4 ? s.codePointAt(0)
    : (s.charCodeAt(1) << 22 | s.charCodeAt(2) << 11 | s.charCodeAt(3)) >>> 0;
}

function string_contains(s, p) {
  // A match must start at a Char boundary, not inside a packed U32 code.
  for (let at = 0; at <= s.length; at += char_len(s, at)) {
    if (s.startsWith(p, at)) {
      return true;
    }
  }
  return false;
}

function str_out(s) {
  return s.replace(/\uDC00[^]{3}/gu, "\uFFFD");
}

function str_in(s) {
  return s.replace(/\p{Cs}/gu, "\uFFFD");
}

// Array
// =====

function array_new(d, v) {
  if (d > 31) {
    throw "bend: an array past the deepest block class 31";
  }
  return Array(2 ** d).fill(v);
}

function array_node(a, b) {
  if (a.length !== b.length) {
    throw "bend: runtime fail-stop";
  }
  return a.concat(b);
}

function array_rmw(a, i, f) {
  const at = i % a.length;
  const old = a[at];
  a[at] = f(old);
  return {$: "Tuple", fst: a, snd: old};
}

// Run
// ===

function run_tail(f, x) {
  return {$: "$JMP", f: f.j?.f === f ? f.j : f, x};
}

function run_clo(j) {
  const f = (x) => run_loop(j(x));
  f.j = j;
  j.f = f;
  return f;
}

function run_loop(r) {
  while (r !== null && typeof r === "object" && r.$ === "$JMP") {
    r = r.f(r.x);
  }
  return r;
}

function run_lib(f, n) {
  return (...a) => a.length < n ? run_lib((...b) => f(...a, ...b), n - a.length)
    : run_loop(f(...a));
}

// Effect
// ======

const $0eff = Object.create(null);

function io_eff(k, run) {
  if (arguments.length > 2) {
    throw new Error("bend: " + k + " takes no need: an effect that waits parks itself");
  }
  if (k in $0eff) {
    throw new Error("bend: two effects register " + k);
  }
  $0eff[k] = run;
}
// Program
// =======

function $base_limbs() {
  return 12;
}

function $extra_limbs(_zoom_exp_0) {
  return $Nat_div(_zoom_exp_0, 9);
}

function $limbs_for_zoom(_zoom_exp_0) {
  return nat_chk(($extra_limbs(_zoom_exp_0)) + 12);
}

function $mantissa_bits(_zoom_exp_0) {
  const _x_0 = ($limbs_for_zoom(_zoom_exp_0));
  return nat_chk(_x_0 * 32);
}

function $knuth_two_sum_total(_a_0, _b_0) {
  return nat_chk(_a_0 + _b_0);
}

function $quick_two_sum_violated_total(_a_0, _b_0) {
  return _b_0;
}

function $bitwise_split_hi(_a_hi_0, _a_lo_0) {
  return _a_hi_0;
}

function $bitwise_split_lo(_a_hi_0, _a_lo_0) {
  return _a_lo_0;
}

function $dekker_fma_hi(_a_hi_0, _a_lo_0) {
  const _x_0 = nat_chk(4097 * _a_lo_0);
  return nat_chk(_a_hi_0 + _x_0);
}

function $fenced_two_sum_err(_a_hi_0, _b_lo_0) {
  return _b_lo_0;
}

function $unfenced_two_sum_err(_a_hi_0, _b_lo_0) {
  return 0;
}

function $sreal_zero() {
  return {$: "SReal", "pos": 0, "neg": 0};
}

function $sneg(_x_0) {
  const _p_0 = _x_0["pos"];
  const _n_0 = _x_0["neg"];
  return {$: "SReal", "pos": _n_0, "neg": _p_0};
}

function $sadd(_a_0, _b_0) {
  const _p1_0 = _a_0["pos"];
  const _n1_0 = _a_0["neg"];
  const _p2_0 = _b_0["pos"];
  const _n2_0 = _b_0["neg"];
  return {$: "SReal", "pos": nat_chk(_p1_0 + _p2_0), "neg": nat_chk(_n1_0 + _n2_0)};
}

function $ssub(_a_0, _b_0) {
  return $sadd(_a_0, ($sneg(_b_0)));
}

function $smul(_a_0, _b_0) {
  const _p1_0 = _a_0["pos"];
  const _n1_0 = _a_0["neg"];
  const _p2_0 = _b_0["pos"];
  const _n2_0 = _b_0["neg"];
  const _x_0 = nat_chk(_p1_0 * _p2_0);
  const _x_1 = nat_chk(_n1_0 * _n2_0);
  const _x_2 = nat_chk(_p1_0 * _n2_0);
  const _x_3 = nat_chk(_n1_0 * _p2_0);
  return {$: "SReal", "pos": nat_chk(_x_0 + _x_1), "neg": nat_chk(_x_2 + _x_3)};
}

function $ssq(_x_0) {
  const _p_0 = _x_0["pos"];
  const _n_0 = _x_0["neg"];
  const _x_1 = nat_chk(_p_0 * _p_0);
  const _x_2 = nat_chk(_n_0 * _n_0);
  const _x_3 = nat_chk(_p_0 * _n_0);
  const _x_4 = nat_chk(_n_0 * _p_0);
  return {$: "SReal", "pos": nat_chk(_x_1 + _x_2), "neg": nat_chk(_x_3 + _x_4)};
}

function $sscale(_x_0, _k_0) {
  const _p_0 = _x_0["pos"];
  const _n_0 = _x_0["neg"];
  return {$: "SReal", "pos": nat_chk(_k_0 * _p_0), "neg": nat_chk(_k_0 * _n_0)};
}

function $sreal_eq_repr(_a_0, _b_0) {
  const _p1_0 = _a_0["pos"];
  const _n1_0 = _a_0["neg"];
  const _p2_0 = _b_0["pos"];
  const _n2_0 = _b_0["neg"];
  return $Bool_and(($Nat_is_eq(_p1_0, _p2_0)), ($Nat_is_eq(_n1_0, _n2_0)));
}

function $cpx_zoom_exp(_z_0) {
  const _ze_0 = _z_0["zoom_exp"];
  return _ze_0;
}

function $cpx_re_lo(_z_0) {
  const _rl_0 = _z_0["re_lo"];
  return _rl_0;
}

function $cpx_im_lo(_z_0) {
  const _il_0 = _z_0["im_lo"];
  return _il_0;
}

function $cpx_eq(_a_0, _b_0) {
  const _re1_0 = _a_0["re"];
  const _im1_0 = _a_0["im"];
  const _rl1_0 = _a_0["re_lo"];
  const _il1_0 = _a_0["im_lo"];
  const _ph1_0 = _a_0["phase"];
  const _mg1_0 = _a_0["mag"];
  const _ze1_0 = _a_0["zoom_exp"];
  const _re2_0 = _b_0["re"];
  const _im2_0 = _b_0["im"];
  const _rl2_0 = _b_0["re_lo"];
  const _il2_0 = _b_0["im_lo"];
  const _ph2_0 = _b_0["phase"];
  const _mg2_0 = _b_0["mag"];
  const _ze2_0 = _b_0["zoom_exp"];
  return $Bool_and(($Bool_and(($Nat_is_eq(_rl1_0, _rl2_0)), ($Nat_is_eq(_il1_0, _il2_0)))), ($Bool_and(($Bool_and(($sreal_eq_repr(_re1_0, _re2_0)), ($sreal_eq_repr(_im1_0, _im2_0)))), ($Bool_and(($Nat_is_eq(_ze1_0, _ze2_0)), ($Bool_and(($Nat_is_eq(_ph1_0, _ph2_0)), ($Nat_is_eq(_mg1_0, _mg2_0)))))))));
}

function $make_const(_re_0, _im_0, _ze_0) {
  return {$: "Cpx", "re": {$: "SReal", "pos": _re_0, "neg": 0}, "im": {$: "SReal", "pos": _im_0, "neg": 0}, "re_lo": 0, "im_lo": 0, "phase": nat_chk(_re_0 + _im_0), "mag": _re_0, "zoom_exp": _ze_0};
}

function $cpx_neg(_z_0) {
  const _re_0 = _z_0["re"];
  const _im_0 = _z_0["im"];
  const _rl_0 = _z_0["re_lo"];
  const _il_0 = _z_0["im_lo"];
  const _ph_0 = _z_0["phase"];
  const _mg_0 = _z_0["mag"];
  const _ze_0 = _z_0["zoom_exp"];
  return {$: "Cpx", "re": ($sneg(_re_0)), "im": ($sneg(_im_0)), "re_lo": _rl_0, "im_lo": _il_0, "phase": _ph_0, "mag": _mg_0, "zoom_exp": _ze_0};
}

function $cpx_conj(_z_0) {
  const _re_0 = _z_0["re"];
  const _im_0 = _z_0["im"];
  const _rl_0 = _z_0["re_lo"];
  const _il_0 = _z_0["im_lo"];
  const _ph_0 = _z_0["phase"];
  const _mg_0 = _z_0["mag"];
  const _ze_0 = _z_0["zoom_exp"];
  return {$: "Cpx", "re": _re_0, "im": ($sneg(_im_0)), "re_lo": _rl_0, "im_lo": _il_0, "phase": _ph_0, "mag": _mg_0, "zoom_exp": _ze_0};
}

function $cpx_add(_a_0, _b_0) {
  const _re1_0 = _a_0["re"];
  const _im1_0 = _a_0["im"];
  const _rl1_0 = _a_0["re_lo"];
  const _il1_0 = _a_0["im_lo"];
  const _ph1_0 = _a_0["phase"];
  const _mg1_0 = _a_0["mag"];
  const _ze1_0 = _a_0["zoom_exp"];
  const _re2_0 = _b_0["re"];
  const _im2_0 = _b_0["im"];
  const _rl2_0 = _b_0["re_lo"];
  const _il2_0 = _b_0["im_lo"];
  const _ph2_0 = _b_0["phase"];
  const _mg2_0 = _b_0["mag"];
  return {$: "Cpx", "re": ($sadd(_re1_0, _re2_0)), "im": ($sadd(_im1_0, _im2_0)), "re_lo": nat_chk(_rl1_0 + _rl2_0), "im_lo": nat_chk(_il1_0 + _il2_0), "phase": nat_chk(_ph1_0 + _ph2_0), "mag": nat_chk(_mg1_0 + _mg2_0), "zoom_exp": _ze1_0};
}

function $cpx_sub(_a_0, _b_0) {
  const _re1_0 = _a_0["re"];
  const _im1_0 = _a_0["im"];
  const _rl1_0 = _a_0["re_lo"];
  const _il1_0 = _a_0["im_lo"];
  const _ph1_0 = _a_0["phase"];
  const _mg1_0 = _a_0["mag"];
  const _ze1_0 = _a_0["zoom_exp"];
  const _re2_0 = _b_0["re"];
  const _im2_0 = _b_0["im"];
  const _rl2_0 = _b_0["re_lo"];
  const _il2_0 = _b_0["im_lo"];
  const _mg2_0 = _b_0["mag"];
  return {$: "Cpx", "re": ($ssub(_re1_0, _re2_0)), "im": ($ssub(_im1_0, _im2_0)), "re_lo": (_rl1_0 < _rl2_0 ? 0 : _rl1_0 - _rl2_0), "im_lo": (_il1_0 < _il2_0 ? 0 : _il1_0 - _il2_0), "phase": nat_chk(_ph1_0 + 1), "mag": nat_chk(_mg1_0 + _mg2_0), "zoom_exp": _ze1_0};
}

function $cpx_mul(_a_0, _b_0) {
  const _re1_0 = _a_0["re"];
  const _im1_0 = _a_0["im"];
  const _rl1_0 = _a_0["re_lo"];
  const _il1_0 = _a_0["im_lo"];
  const _ph1_0 = _a_0["phase"];
  const _mg1_0 = _a_0["mag"];
  const _ze1_0 = _a_0["zoom_exp"];
  const _re2_0 = _b_0["re"];
  const _im2_0 = _b_0["im"];
  const _rl2_0 = _b_0["re_lo"];
  const _il2_0 = _b_0["im_lo"];
  const _ph2_0 = _b_0["phase"];
  const _mg2_0 = _b_0["mag"];
  return {$: "Cpx", "re": ($ssub(($smul(_re1_0, _re2_0)), ($smul(_im1_0, _im2_0)))), "im": ($sadd(($smul(_re1_0, _im2_0)), ($smul(_im1_0, _re2_0)))), "re_lo": nat_chk(_rl1_0 + _rl2_0), "im_lo": nat_chk(_il1_0 + _il2_0), "phase": nat_chk(_ph1_0 + _ph2_0), "mag": nat_chk(_mg1_0 + _mg2_0), "zoom_exp": _ze1_0};
}

function $cpx_sq(_z_0) {
  const _re_0 = _z_0["re"];
  const _im_0 = _z_0["im"];
  const _rl_0 = _z_0["re_lo"];
  const _il_0 = _z_0["im_lo"];
  const _ph_0 = _z_0["phase"];
  const _mg_0 = _z_0["mag"];
  const _ze_0 = _z_0["zoom_exp"];
  return {$: "Cpx", "re": ($ssub(($ssq(_re_0)), ($ssq(_im_0)))), "im": ($sadd(($smul(_re_0, _im_0)), ($smul(_im_0, _re_0)))), "re_lo": nat_chk(_rl_0 + _rl_0), "im_lo": nat_chk(_il_0 + _il_0), "phase": nat_chk(_ph_0 + _ph_0), "mag": nat_chk(_mg_0 + _mg_0), "zoom_exp": _ze_0};
}

function $cpx_rcp(_z_0) {
  const _re_0 = _z_0["re"];
  const _im_0 = _z_0["im"];
  const _rl_0 = _z_0["re_lo"];
  const _il_0 = _z_0["im_lo"];
  const _ph_0 = _z_0["phase"];
  const _mg_0 = _z_0["mag"];
  const _ze_0 = _z_0["zoom_exp"];
  return {$: "Cpx", "re": _re_0, "im": ($sneg(_im_0)), "re_lo": _rl_0, "im_lo": _il_0, "phase": nat_chk(_ph_0 + 2), "mag": nat_chk(_mg_0 + 1), "zoom_exp": _ze_0};
}

function $cpx_div(_a_0, _b_0) {
  const _re1_0 = _a_0["re"];
  const _im1_0 = _a_0["im"];
  const _rl1_0 = _a_0["re_lo"];
  const _il1_0 = _a_0["im_lo"];
  const _ph1_0 = _a_0["phase"];
  const _mg1_0 = _a_0["mag"];
  const _ze1_0 = _a_0["zoom_exp"];
  const _re2_0 = _b_0["re"];
  const _im2_0 = _b_0["im"];
  const _rl2_0 = _b_0["re_lo"];
  const _il2_0 = _b_0["im_lo"];
  return {$: "Cpx", "re": ($sadd(($smul(_re1_0, _re2_0)), ($smul(_im1_0, _im2_0)))), "im": ($ssub(($smul(_im1_0, _re2_0)), ($smul(_re1_0, _im2_0)))), "re_lo": nat_chk(_rl1_0 + _rl2_0), "im_lo": nat_chk(_il1_0 + _il2_0), "phase": nat_chk(_ph1_0 + 2), "mag": nat_chk(_mg1_0 + 1), "zoom_exp": _ze1_0};
}

function $cam_zoom_exp(_cam_0) {
  const _ze_0 = _cam_0["zoom_exp"];
  return _ze_0;
}

function $cam_zoom_in(_cam_0, _delta_exp_0) {
  const _cr_0 = _cam_0["center_re"];
  const _ci_0 = _cam_0["center_im"];
  const _px_0 = _cam_0["pan_steps_x"];
  const _py_0 = _cam_0["pan_steps_y"];
  const _ze_0 = _cam_0["zoom_exp"];
  return {$: "Camera", "center_re": _cr_0, "center_im": _ci_0, "pan_steps_x": _px_0, "pan_steps_y": _py_0, "zoom_exp": nat_chk(_delta_exp_0 + _ze_0)};
}

function $cam_pan_x(_cam_0, _delta_0) {
  const _cr_0 = _cam_0["center_re"];
  const _ci_0 = _cam_0["center_im"];
  const _px_0 = _cam_0["pan_steps_x"];
  const _py_0 = _cam_0["pan_steps_y"];
  const _ze_0 = _cam_0["zoom_exp"];
  return {$: "Camera", "center_re": _cr_0, "center_im": _ci_0, "pan_steps_x": nat_chk(_delta_0 + _px_0), "pan_steps_y": _py_0, "zoom_exp": _ze_0};
}

function $cam_unpan_x(_cam_0, _delta_0) {
  const _cr_0 = _cam_0["center_re"];
  const _ci_0 = _cam_0["center_im"];
  const _px_0 = _cam_0["pan_steps_x"];
  const _py_0 = _cam_0["pan_steps_y"];
  const _ze_0 = _cam_0["zoom_exp"];
  return {$: "Camera", "center_re": _cr_0, "center_im": _ci_0, "pan_steps_x": (_px_0 < _delta_0 ? 0 : _px_0 - _delta_0), "pan_steps_y": _py_0, "zoom_exp": _ze_0};
}

function $cam_pan_y(_cam_0, _delta_0) {
  const _cr_0 = _cam_0["center_re"];
  const _ci_0 = _cam_0["center_im"];
  const _px_0 = _cam_0["pan_steps_x"];
  const _py_0 = _cam_0["pan_steps_y"];
  const _ze_0 = _cam_0["zoom_exp"];
  return {$: "Camera", "center_re": _cr_0, "center_im": _ci_0, "pan_steps_x": _px_0, "pan_steps_y": nat_chk(_delta_0 + _py_0), "zoom_exp": _ze_0};
}

function $cam_unpan_y(_cam_0, _delta_0) {
  const _cr_0 = _cam_0["center_re"];
  const _ci_0 = _cam_0["center_im"];
  const _px_0 = _cam_0["pan_steps_x"];
  const _py_0 = _cam_0["pan_steps_y"];
  const _ze_0 = _cam_0["zoom_exp"];
  return {$: "Camera", "center_re": _cr_0, "center_im": _ci_0, "pan_steps_x": _px_0, "pan_steps_y": (_py_0 < _delta_0 ? 0 : _py_0 - _delta_0), "zoom_exp": _ze_0};
}

function $sample_pixel(_cam_0, _px_x_0, _px_y_0) {
  const _cr_0 = _cam_0["center_re"];
  const _ci_0 = _cam_0["center_im"];
  const _pan_x_0 = _cam_0["pan_steps_x"];
  const _pan_y_0 = _cam_0["pan_steps_y"];
  const _ze_0 = _cam_0["zoom_exp"];
  const _rx_0 = nat_chk(_pan_x_0 + _px_x_0);
  const _ry_0 = nat_chk(_pan_y_0 + _px_y_0);
  return {$: "Cpx", "re": {$: "SReal", "pos": _cr_0, "neg": 0}, "im": {$: "SReal", "pos": _ci_0, "neg": 0}, "re_lo": _rx_0, "im_lo": _ry_0, "phase": nat_chk(_rx_0 + _ry_0), "mag": nat_chk(_cr_0 + _ci_0), "zoom_exp": _ze_0};
}

function $eval_prim(_op_0, _z_0) {
  if (_op_0.$ === "PSin") {
    const _re_0 = _z_0["re"];
    const _im_0 = _z_0["im"];
    const _rl_0 = _z_0["re_lo"];
    const _il_0 = _z_0["im_lo"];
    const _ph_0 = _z_0["phase"];
    const _mg_0 = _z_0["mag"];
    const _ze_0 = _z_0["zoom_exp"];
    return {$: "Cpx", "re": ($sadd(_re_0, {$: "SReal", "pos": 1, "neg": 0})), "im": _im_0, "re_lo": nat_chk(_rl_0 + 1), "im_lo": _il_0, "phase": nat_chk(_ph_0 + 1), "mag": nat_chk(_mg_0 + 1), "zoom_exp": _ze_0};
  } else if (_op_0.$ === "PCos") {
    const _re_1 = _z_0["re"];
    const _im_1 = _z_0["im"];
    const _rl_1 = _z_0["re_lo"];
    const _il_1 = _z_0["im_lo"];
    const _ph_1 = _z_0["phase"];
    const _mg_1 = _z_0["mag"];
    const _ze_1 = _z_0["zoom_exp"];
    return {$: "Cpx", "re": _re_1, "im": ($sadd(_im_1, {$: "SReal", "pos": 1, "neg": 0})), "re_lo": _rl_1, "im_lo": nat_chk(_il_1 + 1), "phase": nat_chk(_ph_1 + 2), "mag": nat_chk(_mg_1 + 1), "zoom_exp": _ze_1};
  } else if (_op_0.$ === "PTan") {
    const _re_2 = _z_0["re"];
    const _im_2 = _z_0["im"];
    const _rl_2 = _z_0["re_lo"];
    const _il_2 = _z_0["im_lo"];
    const _ph_2 = _z_0["phase"];
    const _mg_2 = _z_0["mag"];
    const _ze_2 = _z_0["zoom_exp"];
    return {$: "Cpx", "re": ($sadd(($sscale(_re_2, 2)), {$: "SReal", "pos": 2, "neg": 0})), "im": ($sadd(($sscale(_im_2, 2)), {$: "SReal", "pos": 1, "neg": 0})), "re_lo": nat_chk(_rl_2 + 2), "im_lo": _il_2, "phase": nat_chk(_ph_2 + 3), "mag": nat_chk(_mg_2 + 2), "zoom_exp": _ze_2};
  } else if (_op_0.$ === "PSec") {
    const _re_3 = _z_0["re"];
    const _im_3 = _z_0["im"];
    const _rl_3 = _z_0["re_lo"];
    const _il_3 = _z_0["im_lo"];
    const _ph_3 = _z_0["phase"];
    const _mg_3 = _z_0["mag"];
    const _ze_3 = _z_0["zoom_exp"];
    return {$: "Cpx", "re": _re_3, "im": ($sneg(($sadd(_im_3, {$: "SReal", "pos": 1, "neg": 0})))), "re_lo": _rl_3, "im_lo": nat_chk(_il_3 + 2), "phase": nat_chk(_ph_3 + 4), "mag": nat_chk(_mg_3 + 2), "zoom_exp": _ze_3};
  } else if (_op_0.$ === "PSinh") {
    const _re_4 = _z_0["re"];
    const _im_4 = _z_0["im"];
    const _rl_4 = _z_0["re_lo"];
    const _il_4 = _z_0["im_lo"];
    const _ph_4 = _z_0["phase"];
    const _mg_4 = _z_0["mag"];
    const _ze_4 = _z_0["zoom_exp"];
    return {$: "Cpx", "re": ($sadd(_re_4, {$: "SReal", "pos": 1, "neg": 0})), "im": ($sadd(_im_4, {$: "SReal", "pos": 2, "neg": 0})), "re_lo": nat_chk(_rl_4 + 1), "im_lo": nat_chk(_il_4 + 1), "phase": nat_chk(_ph_4 + 5), "mag": nat_chk(_mg_4 + 1), "zoom_exp": _ze_4};
  } else if (_op_0.$ === "PCosh") {
    const _re_5 = _z_0["re"];
    const _im_5 = _z_0["im"];
    const _rl_5 = _z_0["re_lo"];
    const _il_5 = _z_0["im_lo"];
    const _ph_5 = _z_0["phase"];
    const _mg_5 = _z_0["mag"];
    const _ze_5 = _z_0["zoom_exp"];
    return {$: "Cpx", "re": ($sadd(_re_5, {$: "SReal", "pos": 2, "neg": 0})), "im": ($sadd(_im_5, {$: "SReal", "pos": 1, "neg": 0})), "re_lo": nat_chk(_rl_5 + 1), "im_lo": nat_chk(_il_5 + 1), "phase": nat_chk(_ph_5 + 5), "mag": nat_chk(_mg_5 + 1), "zoom_exp": _ze_5};
  } else if (_op_0.$ === "PTanh") {
    const _re_6 = _z_0["re"];
    const _im_6 = _z_0["im"];
    const _rl_6 = _z_0["re_lo"];
    const _il_6 = _z_0["im_lo"];
    const _ph_6 = _z_0["phase"];
    const _mg_6 = _z_0["mag"];
    const _ze_6 = _z_0["zoom_exp"];
    return {$: "Cpx", "re": ($sadd(($sscale(_re_6, 2)), {$: "SReal", "pos": 1, "neg": 0})), "im": ($sadd(($sscale(_im_6, 2)), {$: "SReal", "pos": 2, "neg": 0})), "re_lo": nat_chk(_rl_6 + 2), "im_lo": nat_chk(_il_6 + 2), "phase": nat_chk(_ph_6 + 5), "mag": nat_chk(_mg_6 + 2), "zoom_exp": _ze_6};
  } else if (_op_0.$ === "PExp") {
    const _re_7 = _z_0["re"];
    const _im_7 = _z_0["im"];
    const _rl_7 = _z_0["re_lo"];
    const _il_7 = _z_0["im_lo"];
    const _ph_7 = _z_0["phase"];
    const _mg_7 = _z_0["mag"];
    const _ze_7 = _z_0["zoom_exp"];
    return {$: "Cpx", "re": ($sadd(_re_7, {$: "SReal", "pos": 3, "neg": 0})), "im": _im_7, "re_lo": nat_chk(_rl_7 + 3), "im_lo": _il_7, "phase": nat_chk(_ph_7 + 6), "mag": nat_chk(_mg_7 + 3), "zoom_exp": _ze_7};
  } else if (_op_0.$ === "PLn") {
    const _re_8 = _z_0["re"];
    const _im_8 = _z_0["im"];
    const _rl_8 = _z_0["re_lo"];
    const _il_8 = _z_0["im_lo"];
    const _ph_8 = _z_0["phase"];
    const _mg_8 = _z_0["mag"];
    const _ze_8 = _z_0["zoom_exp"];
    return {$: "Cpx", "re": ($ssub(_re_8, {$: "SReal", "pos": _ze_8, "neg": 0})), "im": ($sadd(_im_8, {$: "SReal", "pos": 3, "neg": 0})), "re_lo": _rl_8, "im_lo": nat_chk(_il_8 + 3), "phase": nat_chk(_ph_8 + 7), "mag": nat_chk(_mg_8 + 1), "zoom_exp": _ze_8};
  } else if (_op_0.$ === "PAsin") {
    const _re_9 = _z_0["re"];
    const _im_9 = _z_0["im"];
    const _rl_9 = _z_0["re_lo"];
    const _il_9 = _z_0["im_lo"];
    const _ph_9 = _z_0["phase"];
    const _mg_9 = _z_0["mag"];
    const _ze_9 = _z_0["zoom_exp"];
    return {$: "Cpx", "re": ($sadd(_re_9, {$: "SReal", "pos": 4, "neg": 0})), "im": ($sadd(_im_9, {$: "SReal", "pos": 3, "neg": 0})), "re_lo": nat_chk(_rl_9 + 3), "im_lo": nat_chk(_il_9 + 3), "phase": nat_chk(_ph_9 + 7), "mag": nat_chk(_mg_9 + 2), "zoom_exp": _ze_9};
  } else if (_op_0.$ === "PAtan") {
    const _re_10 = _z_0["re"];
    const _im_10 = _z_0["im"];
    const _rl_10 = _z_0["re_lo"];
    const _il_10 = _z_0["im_lo"];
    const _ph_10 = _z_0["phase"];
    const _mg_10 = _z_0["mag"];
    const _ze_10 = _z_0["zoom_exp"];
    return {$: "Cpx", "re": ($sadd(_re_10, {$: "SReal", "pos": 3, "neg": 0})), "im": ($sadd(_im_10, {$: "SReal", "pos": 4, "neg": 0})), "re_lo": nat_chk(_rl_10 + 3), "im_lo": nat_chk(_il_10 + 3), "phase": nat_chk(_ph_10 + 7), "mag": nat_chk(_mg_10 + 2), "zoom_exp": _ze_10};
  } else if (_op_0.$ === "PGamma") {
    const _re_11 = _z_0["re"];
    const _im_11 = _z_0["im"];
    const _rl_11 = _z_0["re_lo"];
    const _il_11 = _z_0["im_lo"];
    const _ph_11 = _z_0["phase"];
    const _mg_11 = _z_0["mag"];
    const _ze_11 = _z_0["zoom_exp"];
    return {$: "Cpx", "re": ($sadd(_re_11, {$: "SReal", "pos": 6, "neg": 0})), "im": ($sadd(_im_11, {$: "SReal", "pos": 6, "neg": 0})), "re_lo": nat_chk(_rl_11 + 6), "im_lo": nat_chk(_il_11 + 6), "phase": nat_chk(_ph_11 + 8), "mag": nat_chk(_mg_11 + 5), "zoom_exp": _ze_11};
  } else if (_op_0.$ === "PLogGamma") {
    const _re_12 = _z_0["re"];
    const _im_12 = _z_0["im"];
    const _rl_12 = _z_0["re_lo"];
    const _il_12 = _z_0["im_lo"];
    const _ph_12 = _z_0["phase"];
    const _mg_12 = _z_0["mag"];
    const _ze_12 = _z_0["zoom_exp"];
    return {$: "Cpx", "re": ($sadd(_re_12, {$: "SReal", "pos": 5, "neg": 0})), "im": ($sadd(_im_12, {$: "SReal", "pos": 6, "neg": 0})), "re_lo": nat_chk(_rl_12 + 5), "im_lo": nat_chk(_il_12 + 6), "phase": nat_chk(_ph_12 + 7), "mag": nat_chk(_mg_12 + 3), "zoom_exp": _ze_12};
  } else if (_op_0.$ === "PBessel") {
    const _re_13 = _z_0["re"];
    const _im_13 = _z_0["im"];
    const _rl_13 = _z_0["re_lo"];
    const _il_13 = _z_0["im_lo"];
    const _ph_13 = _z_0["phase"];
    const _mg_13 = _z_0["mag"];
    const _ze_13 = _z_0["zoom_exp"];
    return {$: "Cpx", "re": ($sadd(_re_13, {$: "SReal", "pos": 8, "neg": 0})), "im": ($sadd(_im_13, {$: "SReal", "pos": 8, "neg": 0})), "re_lo": nat_chk(_rl_13 + 8), "im_lo": nat_chk(_il_13 + 8), "phase": nat_chk(_ph_13 + 9), "mag": nat_chk(_mg_13 + 4), "zoom_exp": _ze_13};
  } else if (_op_0.$ === "PZeta") {
    const _re_14 = _z_0["re"];
    const _im_14 = _z_0["im"];
    const _rl_14 = _z_0["re_lo"];
    const _il_14 = _z_0["im_lo"];
    const _ph_14 = _z_0["phase"];
    const _mg_14 = _z_0["mag"];
    const _ze_14 = _z_0["zoom_exp"];
    return {$: "Cpx", "re": ($sadd(_re_14, {$: "SReal", "pos": 5, "neg": 0})), "im": ($sadd(_im_14, {$: "SReal", "pos": 5, "neg": 0})), "re_lo": nat_chk(_rl_14 + 5), "im_lo": nat_chk(_il_14 + 5), "phase": nat_chk(_ph_14 + 8), "mag": nat_chk(_mg_14 + 4), "zoom_exp": _ze_14};
  } else if (_op_0.$ === "PZetaAC") {
    const _re_15 = _z_0["re"];
    const _im_15 = _z_0["im"];
    const _rl_15 = _z_0["re_lo"];
    const _il_15 = _z_0["im_lo"];
    const _ph_15 = _z_0["phase"];
    const _mg_15 = _z_0["mag"];
    const _ze_15 = _z_0["zoom_exp"];
    return {$: "Cpx", "re": ($sadd(_re_15, {$: "SReal", "pos": 7, "neg": 0})), "im": ($sadd(_im_15, {$: "SReal", "pos": 7, "neg": 0})), "re_lo": nat_chk(_rl_15 + 7), "im_lo": nat_chk(_il_15 + 7), "phase": nat_chk(_ph_15 + 9), "mag": nat_chk(_mg_15 + 5), "zoom_exp": _ze_15};
  } else {
    const _n_0 = _op_0["n"];
    const _re_16 = _z_0["re"];
    const _im_16 = _z_0["im"];
    const _rl_16 = _z_0["re_lo"];
    const _il_16 = _z_0["im_lo"];
    const _ph_16 = _z_0["phase"];
    const _mg_16 = _z_0["mag"];
    const _ze_16 = _z_0["zoom_exp"];
    return {$: "Cpx", "re": ($sscale(_re_16, _n_0)), "im": ($sscale(_im_16, _n_0)), "re_lo": nat_chk(_rl_16 + _n_0), "im_lo": nat_chk(_il_16 + _n_0), "phase": nat_chk(_ph_16 + _n_0), "mag": nat_chk(_mg_16 + _n_0), "zoom_exp": _ze_16};
  }
}

function $zeta_term4_opt(_t2_0) {
  return $cpx_sq(_t2_0);
}

function $zeta_term4_naive(_t2_0) {
  return $cpx_mul(_t2_0, _t2_0);
}

function $eval_expr(_e_0, _z_0) {
  if (_e_0.$ === "EVar") {
    return _z_0;
  } else if (_e_0.$ === "EConst") {
    const _re_0 = _e_0["re"];
    const _im_0 = _e_0["im"];
    return $make_const(_re_0, _im_0, ($cpx_zoom_exp(_z_0)));
  } else if (_e_0.$ === "EPrim") {
    const _op_0 = _e_0["op"];
    const _arg_0 = _e_0["arg"];
    return $eval_prim(_op_0, ($eval_expr(_arg_0, _z_0)));
  } else if (_e_0.$ === "EAdd") {
    const _lhs_0 = _e_0["lhs"];
    const _rhs_0 = _e_0["rhs"];
    return $cpx_add(($eval_expr(_lhs_0, _z_0)), ($eval_expr(_rhs_0, _z_0)));
  } else if (_e_0.$ === "ESub") {
    const _lhs_1 = _e_0["lhs"];
    const _rhs_1 = _e_0["rhs"];
    return $cpx_sub(($eval_expr(_lhs_1, _z_0)), ($eval_expr(_rhs_1, _z_0)));
  } else if (_e_0.$ === "EMul") {
    const _lhs_2 = _e_0["lhs"];
    const _rhs_2 = _e_0["rhs"];
    return $cpx_mul(($eval_expr(_lhs_2, _z_0)), ($eval_expr(_rhs_2, _z_0)));
  } else {
    const _lhs_3 = _e_0["lhs"];
    const _rhs_3 = _e_0["rhs"];
    return $cpx_div(($eval_expr(_lhs_3, _z_0)), ($eval_expr(_rhs_3, _z_0)));
  }
}

function $compose_expr(_outer_0, _inner_0) {
  if (_outer_0.$ === "EVar") {
    return _inner_0;
  } else if (_outer_0.$ === "EConst") {
    const _re_0 = _outer_0["re"];
    const _im_0 = _outer_0["im"];
    return {$: "EConst", "re": _re_0, "im": _im_0};
  } else if (_outer_0.$ === "EPrim") {
    const _op_0 = _outer_0["op"];
    const _arg_0 = _outer_0["arg"];
    return {$: "EPrim", "op": _op_0, "arg": ($compose_expr(_arg_0, _inner_0))};
  } else if (_outer_0.$ === "EAdd") {
    const _lhs_0 = _outer_0["lhs"];
    const _rhs_0 = _outer_0["rhs"];
    return {$: "EAdd", "lhs": ($compose_expr(_lhs_0, _inner_0)), "rhs": ($compose_expr(_rhs_0, _inner_0))};
  } else if (_outer_0.$ === "ESub") {
    const _lhs_1 = _outer_0["lhs"];
    const _rhs_1 = _outer_0["rhs"];
    return {$: "ESub", "lhs": ($compose_expr(_lhs_1, _inner_0)), "rhs": ($compose_expr(_rhs_1, _inner_0))};
  } else if (_outer_0.$ === "EMul") {
    const _lhs_2 = _outer_0["lhs"];
    const _rhs_2 = _outer_0["rhs"];
    return {$: "EMul", "lhs": ($compose_expr(_lhs_2, _inner_0)), "rhs": ($compose_expr(_rhs_2, _inner_0))};
  } else {
    const _lhs_3 = _outer_0["lhs"];
    const _rhs_3 = _outer_0["rhs"];
    return {$: "EDiv", "lhs": ($compose_expr(_lhs_3, _inner_0)), "rhs": ($compose_expr(_rhs_3, _inner_0))};
  }
}

function $preset_tan_sec() {
  return {$: "EPrim", "op": {$: "PTan"}, "arg": {$: "EPrim", "op": {$: "PSec"}, "arg": {$: "EVar"}}};
}

function $eval_full_chain(_steps_0, _e_0, _z_0) {
  if (_steps_0 === 0) {
    return _z_0;
  } else {
    const _p_0 = (_steps_0 - 1);
    return $eval_expr(_e_0, ($eval_full_chain(_p_0, _e_0, _z_0)));
  }
}

function $unfold_full_chain(_steps_0, _e_0) {
  if (_steps_0 === 0) {
    return {$: "EVar"};
  } else {
    const _p_0 = (_steps_0 - 1);
    return $compose_expr(_e_0, ($unfold_full_chain(_p_0, _e_0)));
  }
}

function $run_fbo_batches_full(_passes_0, _batch_size_0, _e_0, _z_0) {
  if (_passes_0 === 0) {
    return _z_0;
  } else {
    const _p_0 = (_passes_0 - 1);
    return $eval_full_chain(_batch_size_0, _e_0, ($run_fbo_batches_full(_p_0, _batch_size_0, _e_0, _z_0)));
  }
}

function $is_escape_attractor(_mode_0) {
  if (_mode_0.$ === "ModeDomain") {
    return false;
  } else {
    return true;
  }
}

function $mandelbrot_step(_z_0, _c_0) {
  return $cpx_add(($cpx_sq(_z_0)), _c_0);
}

function $eval_mandelbrot(_iters_0, _z_0, _c_0) {
  if (_iters_0 === 0) {
    return _z_0;
  } else {
    const _p_0 = (_iters_0 - 1);
    return $mandelbrot_step(($eval_mandelbrot(_p_0, _z_0, _c_0)), _c_0);
  }
}

function $newton_step(_z_0) {
  return $cpx_add(_z_0, ($cpx_rcp(($cpx_sq(_z_0)))));
}

function $eval_newton(_iters_0, _z_0) {
  if (_iters_0 === 0) {
    return _z_0;
  } else {
    const _p_0 = (_iters_0 - 1);
    return $newton_step(($eval_newton(_p_0, _z_0)));
  }
}

function $eval_fractal(_fid_0, _iters_0, _c_0) {
  if (_fid_0.$ === "FMandelbrot") {
    return $eval_mandelbrot(_iters_0, _c_0, _c_0);
  } else {
    return $eval_newton(_iters_0, _c_0);
  }
}

function $eval_mode(_mode_0, _c_0) {
  if (_mode_0.$ === "ModeDomain") {
    const _e_0 = _mode_0["expr"];
    const _steps_0 = _mode_0["chain_steps"];
    return $eval_full_chain(_steps_0, _e_0, ($eval_expr(_e_0, _c_0)));
  } else {
    const _fid_0 = _mode_0["fid"];
    const _iters_0 = _mode_0["max_iter"];
    return $eval_fractal(_fid_0, _iters_0, _c_0);
  }
}

function $palette_base_id(_pal_0) {
  if (_pal_0.$ === "ArcticFox") {
    return 10;
  } else if (_pal_0.$ === "SilentColors") {
    return 20;
  } else if (_pal_0.$ === "AnthropicWarm") {
    return 30;
  } else if (_pal_0.$ === "ObsidianSpectral") {
    return 40;
  } else {
    return 50;
  }
}

function $shade_cpx(_pal_0, _w_0) {
  const _ph_0 = _w_0["phase"];
  const _mg_0 = _w_0["mag"];
  const _ze_0 = _w_0["zoom_exp"];
  const _x_0 = ($palette_base_id(_pal_0));
  const _x_1 = nat_chk(_ph_0 + _mg_0);
  const _c_nat_0 = nat_chk(_x_0 + _x_1);
  return {$: "PixelCert", "color": (_c_nat_0 >>> 0), "zoom_exp": _ze_0};
}

function $render_pixel(_mode_0, _pal_0, _cam_0, _x_0, _y_0) {
  return $shade_cpx(_pal_0, ($eval_mode(_mode_0, ($sample_pixel(_cam_0, _x_0, _y_0)))));
}

function $pixel_cert_color(_cert_0) {
  const _col_0 = _cert_0["color"];
  return _col_0;
}

function $pixel_cert_to_image(_cert_0) {
  return {$: "Pix", "color": ($pixel_cert_color(_cert_0))};
}

function $pixel_cert_zoom_exp(_cert_0) {
  const _ze_0 = _cert_0["zoom_exp"];
  return _ze_0;
}

function $ui_set_interacting(_st_0, _flag_0) {
  const _e_0 = _st_0["expr"];
  const _pal_0 = _st_0["pal"];
  const _cam_0 = _st_0["cam"];
  const _ce_0 = _st_0["chain_enabled"];
  const _cc_0 = _st_0["chain_count"];
  return {$: "UIState", "expr": _e_0, "pal": _pal_0, "cam": _cam_0, "chain_enabled": _ce_0, "chain_count": _cc_0, "is_interacting": _flag_0};
}

function $effective_chain_steps(_st_0) {
  const _t_0 = _st_0["chain_enabled"];
  if (!_t_0) {
    return 0;
  } else {
    const _cc_1 = _st_0["chain_count"];
    return _cc_1;
  }
}

function $render_ui_state(_st_0, _x_0, _y_0) {
  const _e_0 = _st_0["expr"];
  const _pal_0 = _st_0["pal"];
  const _cam_0 = _st_0["cam"];
  const _t_0 = _st_0["chain_enabled"];
  if (!_t_0) {
    return $render_pixel({$: "ModeDomain", "expr": _e_0, "chain_steps": 0}, _pal_0, _cam_0, _x_0, _y_0);
  } else {
    const _cc_1 = _st_0["chain_count"];
    return $render_pixel({$: "ModeDomain", "expr": _e_0, "chain_steps": _cc_1}, _pal_0, _cam_0, _x_0, _y_0);
  }
}

function $render_quadtree(_depth_0, _mode_0, _pal_0, _cam_0, _x0_0, _y0_0) {
  if (_depth_0 === 0) {
    return $pixel_cert_to_image(($render_pixel(_mode_0, _pal_0, _cam_0, _x0_0, _y0_0)));
  } else {
    const _p_0 = (_depth_0 - 1);
    const _step_0 = ($Nat_pow(2, _p_0));
    const _x1_0 = nat_chk(_x0_0 + _step_0);
    const _y1_0 = nat_chk(_y0_0 + _step_0);
    const _tl_0 = ($render_quadtree(_p_0, _mode_0, _pal_0, _cam_0, _x0_0, _y0_0));
    const _tr_0 = ($render_quadtree(_p_0, _mode_0, _pal_0, _cam_0, _x1_0, _y0_0));
    const _bl_0 = ($render_quadtree(_p_0, _mode_0, _pal_0, _cam_0, _x0_0, _y1_0));
    const _br_0 = ($render_quadtree(_p_0, _mode_0, _pal_0, _cam_0, _x1_0, _y1_0));
    return {$: "Qua", "tl": _tl_0, "tr": _tr_0, "bl": _bl_0, "br": _br_0};
  }
}

function $quad_sum(_k_0) {
  const _x_0 = nat_chk(_k_0 + _k_0);
  const _x_1 = nat_chk(_k_0 + _k_0);
  return nat_chk(_x_0 + _x_1);
}

function $pow4(_d_0) {
  if (_d_0 === 0) {
    return 1;
  } else {
    const _p_0 = (_d_0 - 1);
    return $quad_sum(($pow4(_p_0)));
  }
}

function $image_pixels(_img_0) {
  if (_img_0.$ === "Pix") {
    return 1;
  } else {
    const _tl_0 = _img_0["tl"];
    const _tr_0 = _img_0["tr"];
    const _bl_0 = _img_0["bl"];
    const _br_0 = _img_0["br"];
    const _x_0 = ($image_pixels(_tl_0));
    const _x_1 = ($image_pixels(_tr_0));
    const _x_2 = ($image_pixels(_bl_0));
    const _x_3 = ($image_pixels(_br_0));
    const _x_4 = nat_chk(_x_0 + _x_1);
    const _x_5 = nat_chk(_x_2 + _x_3);
    return nat_chk(_x_4 + _x_5);
  }
}

function $stress_pan_zoom_step(_cam_0, _seed_0, _scene_idx_0) {
  const _x_0 = nat_chk(_seed_0 + _scene_idx_0);
  const _dx_0 = nat_chk(1 + _x_0);
  const _x_1 = nat_chk(_seed_0 + _scene_idx_0);
  const _dy_0 = nat_chk(2 + _x_1);
  return $cam_zoom_in(($cam_pan_y(($cam_pan_x(_cam_0, _dx_0)), _dy_0)), 1);
}

function $stress_walk_scenes(_scenes_0, _cam_0, _seed_0) {
  if (_scenes_0 === 0) {
    return _cam_0;
  } else {
    const _p_0 = (_scenes_0 - 1);
    return $stress_pan_zoom_step(($stress_walk_scenes(_p_0, _cam_0, _seed_0)), _seed_0, _p_0);
  }
}

function $stress_400_to_200_to_zoom50(_cam_0, _point_id_400_0, _scene_id_200_0) {
  const _seed_0 = nat_chk(_point_id_400_0 + _scene_id_200_0);
  return $stress_walk_scenes(50, _cam_0, _seed_0);
}

function $sq_word_cost(_limbs_0) {
  return _limbs_0;
}

function $mul_word_cost(_limbs_0) {
  return nat_chk(_limbs_0 + _limbs_0);
}

function $div_graded_word_cost(_limbs_0) {
  return nat_chk(2 * _limbs_0);
}

function $div_naive_word_cost(_limbs_0) {
  const _x_0 = nat_chk(24 * _limbs_0);
  const _x_1 = ($div_graded_word_cost(_limbs_0));
  const _x_2 = nat_chk(_limbs_0 + _x_0);
  return nat_chk(_x_1 + _x_2);
}

function $cpx_div_scaled_cost(_limbs_0) {
  const _x_0 = ($sq_word_cost(_limbs_0));
  const _x_1 = nat_chk(2 * _x_0);
  const _x_2 = ($div_graded_word_cost(_limbs_0));
  return nat_chk(_x_1 + _x_2);
}

function $cpx_div_two_div_cost(_limbs_0) {
  const _x_0 = ($div_naive_word_cost(_limbs_0));
  const _x_1 = nat_chk(_x_0 + _limbs_0);
  const _x_2 = ($cpx_div_scaled_cost(_limbs_0));
  const _x_3 = nat_chk(_limbs_0 + _x_1);
  return nat_chk(_x_2 + _x_3);
}

function $prim_cost_opt(_op_0, _zoom_exp_0) {
  if (_op_0.$ === "PSin") {
    const _x_0 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(2 * _x_0);
  } else if (_op_0.$ === "PCos") {
    const _x_1 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(2 * _x_1);
  } else if (_op_0.$ === "PTan") {
    const _x_2 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(3 * _x_2);
  } else if (_op_0.$ === "PSec") {
    const _x_3 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(3 * _x_3);
  } else if (_op_0.$ === "PSinh") {
    const _x_4 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(2 * _x_4);
  } else if (_op_0.$ === "PCosh") {
    const _x_5 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(2 * _x_5);
  } else if (_op_0.$ === "PTanh") {
    const _x_6 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(3 * _x_6);
  } else if (_op_0.$ === "PExp") {
    const _x_7 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(2 * _x_7);
  } else if (_op_0.$ === "PLn") {
    const _x_8 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(2 * _x_8);
  } else if (_op_0.$ === "PAsin") {
    const _x_9 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(3 * _x_9);
  } else if (_op_0.$ === "PAtan") {
    const _x_10 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(3 * _x_10);
  } else if (_op_0.$ === "PGamma") {
    const _x_11 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(5 * _x_11);
  } else if (_op_0.$ === "PLogGamma") {
    const _x_12 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(4 * _x_12);
  } else if (_op_0.$ === "PBessel") {
    const _x_13 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(5 * _x_13);
  } else if (_op_0.$ === "PZeta") {
    const _x_14 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(4 * _x_14);
  } else if (_op_0.$ === "PZetaAC") {
    const _x_15 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(6 * _x_15);
  } else {
    const _n_0 = _op_0["n"];
    const _x_16 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(_x_16 + _n_0);
  }
}

function $prim_cost_savings(_op_0, _zoom_exp_0) {
  if (_op_0.$ === "PSin") {
    return $limbs_for_zoom(_zoom_exp_0);
  } else if (_op_0.$ === "PCos") {
    return $limbs_for_zoom(_zoom_exp_0);
  } else if (_op_0.$ === "PTan") {
    const _x_0 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(2 * _x_0);
  } else if (_op_0.$ === "PSec") {
    return $limbs_for_zoom(_zoom_exp_0);
  } else if (_op_0.$ === "PSinh") {
    const _x_1 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(2 * _x_1);
  } else if (_op_0.$ === "PCosh") {
    const _x_2 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(2 * _x_2);
  } else if (_op_0.$ === "PTanh") {
    const _x_3 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(2 * _x_3);
  } else if (_op_0.$ === "PExp") {
    return $limbs_for_zoom(_zoom_exp_0);
  } else if (_op_0.$ === "PLn") {
    return $limbs_for_zoom(_zoom_exp_0);
  } else if (_op_0.$ === "PAsin") {
    const _x_4 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(2 * _x_4);
  } else if (_op_0.$ === "PAtan") {
    const _x_5 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(2 * _x_5);
  } else if (_op_0.$ === "PGamma") {
    const _x_6 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(4 * _x_6);
  } else if (_op_0.$ === "PLogGamma") {
    const _x_7 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(4 * _x_7);
  } else if (_op_0.$ === "PBessel") {
    const _x_8 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(4 * _x_8);
  } else if (_op_0.$ === "PZeta") {
    const _x_9 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(4 * _x_9);
  } else if (_op_0.$ === "PZetaAC") {
    const _x_10 = ($limbs_for_zoom(_zoom_exp_0));
    return nat_chk(5 * _x_10);
  } else {
    return $limbs_for_zoom(_zoom_exp_0);
  }
}

function $prim_cost_naive(_op_0, _zoom_exp_0) {
  const _x_0 = ($prim_cost_opt(_op_0, _zoom_exp_0));
  const _x_1 = ($prim_cost_savings(_op_0, _zoom_exp_0));
  return nat_chk(_x_0 + _x_1);
}

function $expr_cost_opt(_e_0, _zoom_exp_0) {
  if (_e_0.$ === "EVar") {
    return 1;
  } else if (_e_0.$ === "EConst") {
    return 1;
  } else if (_e_0.$ === "EPrim") {
    const _op_0 = _e_0["op"];
    const _arg_0 = _e_0["arg"];
    const _x_0 = ($prim_cost_opt(_op_0, _zoom_exp_0));
    const _x_1 = ($expr_cost_opt(_arg_0, _zoom_exp_0));
    return nat_chk(_x_0 + _x_1);
  } else if (_e_0.$ === "EAdd") {
    const _lhs_0 = _e_0["lhs"];
    const _rhs_0 = _e_0["rhs"];
    const _x_2 = ($expr_cost_opt(_lhs_0, _zoom_exp_0));
    const _x_3 = ($expr_cost_opt(_rhs_0, _zoom_exp_0));
    const _x_4 = ($limbs_for_zoom(_zoom_exp_0));
    const _x_5 = nat_chk(_x_2 + _x_3);
    return nat_chk(_x_4 + _x_5);
  } else if (_e_0.$ === "ESub") {
    const _lhs_1 = _e_0["lhs"];
    const _rhs_1 = _e_0["rhs"];
    const _x_6 = ($expr_cost_opt(_lhs_1, _zoom_exp_0));
    const _x_7 = ($expr_cost_opt(_rhs_1, _zoom_exp_0));
    const _x_8 = ($limbs_for_zoom(_zoom_exp_0));
    const _x_9 = nat_chk(_x_6 + _x_7);
    return nat_chk(_x_8 + _x_9);
  } else if (_e_0.$ === "EMul") {
    const _lhs_2 = _e_0["lhs"];
    const _rhs_2 = _e_0["rhs"];
    const _x_10 = ($expr_cost_opt(_lhs_2, _zoom_exp_0));
    const _x_11 = ($expr_cost_opt(_rhs_2, _zoom_exp_0));
    const _x_12 = ($mul_word_cost(($limbs_for_zoom(_zoom_exp_0))));
    const _x_13 = nat_chk(_x_10 + _x_11);
    return nat_chk(_x_12 + _x_13);
  } else {
    const _lhs_3 = _e_0["lhs"];
    const _rhs_3 = _e_0["rhs"];
    const _x_14 = ($expr_cost_opt(_lhs_3, _zoom_exp_0));
    const _x_15 = ($expr_cost_opt(_rhs_3, _zoom_exp_0));
    const _x_16 = ($mul_word_cost(($limbs_for_zoom(_zoom_exp_0))));
    const _x_17 = nat_chk(_x_14 + _x_15);
    return nat_chk(_x_16 + _x_17);
  }
}

function $expr_cost_savings(_e_0, _zoom_exp_0) {
  if (_e_0.$ === "EVar") {
    return 0;
  } else if (_e_0.$ === "EConst") {
    return 0;
  } else if (_e_0.$ === "EPrim") {
    const _op_0 = _e_0["op"];
    const _arg_0 = _e_0["arg"];
    const _x_0 = ($prim_cost_savings(_op_0, _zoom_exp_0));
    const _x_1 = ($expr_cost_savings(_arg_0, _zoom_exp_0));
    return nat_chk(_x_0 + _x_1);
  } else if (_e_0.$ === "EAdd") {
    const _lhs_0 = _e_0["lhs"];
    const _rhs_0 = _e_0["rhs"];
    const _x_2 = ($expr_cost_savings(_lhs_0, _zoom_exp_0));
    const _x_3 = ($expr_cost_savings(_rhs_0, _zoom_exp_0));
    return nat_chk(_x_2 + _x_3);
  } else if (_e_0.$ === "ESub") {
    const _lhs_1 = _e_0["lhs"];
    const _rhs_1 = _e_0["rhs"];
    const _x_4 = ($expr_cost_savings(_lhs_1, _zoom_exp_0));
    const _x_5 = ($expr_cost_savings(_rhs_1, _zoom_exp_0));
    return nat_chk(_x_4 + _x_5);
  } else if (_e_0.$ === "EMul") {
    const _lhs_2 = _e_0["lhs"];
    const _rhs_2 = _e_0["rhs"];
    const _x_6 = ($expr_cost_savings(_lhs_2, _zoom_exp_0));
    const _x_7 = ($expr_cost_savings(_rhs_2, _zoom_exp_0));
    const _x_8 = ($limbs_for_zoom(_zoom_exp_0));
    const _x_9 = nat_chk(_x_6 + _x_7);
    return nat_chk(_x_8 + _x_9);
  } else {
    const _lhs_3 = _e_0["lhs"];
    const _rhs_3 = _e_0["rhs"];
    const _x_10 = ($expr_cost_savings(_lhs_3, _zoom_exp_0));
    const _x_11 = ($expr_cost_savings(_rhs_3, _zoom_exp_0));
    const _x_12 = ($limbs_for_zoom(_zoom_exp_0));
    const _x_13 = nat_chk(_x_10 + _x_11);
    return nat_chk(_x_12 + _x_13);
  }
}

function $expr_cost_naive(_e_0, _zoom_exp_0) {
  const _x_0 = ($expr_cost_opt(_e_0, _zoom_exp_0));
  const _x_1 = ($expr_cost_savings(_e_0, _zoom_exp_0));
  return nat_chk(_x_0 + _x_1);
}

function $full_chain_cost_opt(_steps_0, _e_0, _zoom_exp_0) {
  const _x_0 = nat_chk(_steps_0 + 1);
  const _x_1 = ($expr_cost_opt(_e_0, _zoom_exp_0));
  return nat_chk(_x_0 * _x_1);
}

function $full_chain_cost_savings(_steps_0, _e_0, _zoom_exp_0) {
  const _x_0 = nat_chk(_steps_0 + 1);
  const _x_1 = ($expr_cost_savings(_e_0, _zoom_exp_0));
  return nat_chk(_x_0 * _x_1);
}

function $full_chain_cost_naive(_steps_0, _e_0, _zoom_exp_0) {
  const _x_0 = ($full_chain_cost_opt(_steps_0, _e_0, _zoom_exp_0));
  const _x_1 = ($full_chain_cost_savings(_steps_0, _e_0, _zoom_exp_0));
  return nat_chk(_x_0 + _x_1);
}

function $eval_tan_single_pass(_z_0) {
  return $eval_prim({$: "PTan"}, _z_0);
}

function $tan_single_pass_cost(_zoom_exp_0) {
  return $prim_cost_opt({$: "PTan"}, _zoom_exp_0);
}

function $tan_duplicate_sincos_cost(_zoom_exp_0) {
  const _x_0 = ($limbs_for_zoom(_zoom_exp_0));
  const _x_1 = ($prim_cost_opt({$: "PCos"}, _zoom_exp_0));
  const _x_2 = ($limbs_for_zoom(_zoom_exp_0));
  const _x_3 = nat_chk(_x_0 + _x_1);
  const _x_4 = ($tan_single_pass_cost(_zoom_exp_0));
  const _x_5 = nat_chk(_x_2 + _x_3);
  return nat_chk(_x_4 + _x_5);
}

function $tan_direct_denom_bits(_prec_0, _delta_bits_0) {
  return nat_chk(_prec_0 + _delta_bits_0);
}

function $tan_double_angle_denom_bits(_prec_0, _delta_bits_0) {
  return _prec_0;
}

function $shade_domain_fast_log2(_pal_0, _w_0) {
  return $shade_cpx(_pal_0, _w_0);
}

function $shade_domain_fast_cost(_limbs_0) {
  return nat_chk(2 * _limbs_0);
}

function $shade_domain_naive_cost(_limbs_0) {
  const _x_0 = nat_chk(49 * _limbs_0);
  const _x_1 = ($shade_domain_fast_cost(_limbs_0));
  const _x_2 = nat_chk(_limbs_0 + _x_0);
  return nat_chk(_x_1 + _x_2);
}

function $pipeline_v2_cost(_steps_0, _e_0, _zoom_exp_0) {
  const _x_0 = ($full_chain_cost_opt(_steps_0, _e_0, _zoom_exp_0));
  const _x_1 = ($shade_domain_fast_cost(($limbs_for_zoom(_zoom_exp_0))));
  return nat_chk(_x_0 + _x_1);
}

function $pipeline_v2_savings(_steps_0, _e_0, _zoom_exp_0) {
  const _x_0 = ($limbs_for_zoom(_zoom_exp_0));
  const _x_1 = ($full_chain_cost_savings(_steps_0, _e_0, _zoom_exp_0));
  const _x_2 = nat_chk(73 * _x_0);
  const _x_3 = ($limbs_for_zoom(_zoom_exp_0));
  const _x_4 = nat_chk(_x_1 + _x_2);
  return nat_chk(_x_3 + _x_4);
}

function $pipeline_v1_cost(_steps_0, _e_0, _zoom_exp_0) {
  const _x_0 = ($pipeline_v2_cost(_steps_0, _e_0, _zoom_exp_0));
  const _x_1 = ($pipeline_v2_savings(_steps_0, _e_0, _zoom_exp_0));
  return nat_chk(_x_0 + _x_1);
}

function $parallel_span(_depth_0, _pixel_cost_0) {
  return nat_chk(_depth_0 + _pixel_cost_0);
}

function $pauldelbrot_rebased_state(_zm_0, _dz_0) {
  return $cpx_add(_zm_0, _dz_0);
}

function $fbo_present_on_completion(_rem_steps_0, _next_display_0, _prev_display_0) {
  if (_rem_steps_0 === 0) {
    return _next_display_0;
  } else {
    return _prev_display_0;
  }
}

function $gpu_fence_dispatch_steps(_fence_ready_0, _frame_budget_0) {
  if (!_fence_ready_0) {
    return 0;
  } else {
    return _frame_budget_0;
  }
}

function $renorm_6pass_word_cost(_limbs_0) {
  return nat_chk(6 * _limbs_0);
}

function $renorm_8pass_word_cost(_limbs_0) {
  const _x_0 = nat_chk(1 * _limbs_0);
  const _x_1 = ($renorm_6pass_word_cost(_limbs_0));
  const _x_2 = nat_chk(_limbs_0 + _x_0);
  return nat_chk(_x_1 + _x_2);
}

function $sqrt_incremental_rem_cost(_limbs_0) {
  return nat_chk(2 * _limbs_0);
}

function $sqrt_resquare_cost(_limbs_0) {
  const _x_0 = nat_chk(4 * _limbs_0);
  const _x_1 = ($sqrt_incremental_rem_cost(_limbs_0));
  const _x_2 = nat_chk(_limbs_0 + _x_0);
  return nat_chk(_x_1 + _x_2);
}

function $unfold_unary_chain(_steps_0, _op_0, _base_0) {
  if (_steps_0 === 0) {
    return _base_0;
  } else {
    const _p_0 = (_steps_0 - 1);
    return {$: "EPrim", "op": _op_0, "arg": ($unfold_unary_chain(_p_0, _op_0, _base_0))};
  }
}

function $eval_unary_chain(_steps_0, _op_0, _z_0) {
  if (_steps_0 === 0) {
    return _z_0;
  } else {
    const _p_0 = (_steps_0 - 1);
    return $eval_prim(_op_0, ($eval_unary_chain(_p_0, _op_0, _z_0)));
  }
}

function $eval_sec_direct_sos(_z_0) {
  return $eval_prim({$: "PSec"}, _z_0);
}

function $sec_direct_sos_cost(_zoom_exp_0) {
  const _x_0 = ($limbs_for_zoom(_zoom_exp_0));
  return nat_chk(2 * _x_0);
}

function $sec_naive_cos_rcp_cost(_zoom_exp_0) {
  const _x_0 = ($limbs_for_zoom(_zoom_exp_0));
  const _x_1 = ($limbs_for_zoom(_zoom_exp_0));
  const _x_2 = nat_chk(2 * _x_0);
  const _x_3 = ($sec_direct_sos_cost(_zoom_exp_0));
  const _x_4 = nat_chk(_x_1 + _x_2);
  return nat_chk(_x_3 + _x_4);
}

function $shader_compile_dce_cost(_active_prims_0, _limbs_0) {
  const _x_0 = nat_chk(_active_prims_0 + 1);
  return nat_chk(_x_0 * _limbs_0);
}

function $shader_compile_monolithic_cost(_active_prims_0, _limbs_0) {
  const _x_0 = nat_chk(12 * _limbs_0);
  const _x_1 = ($shader_compile_dce_cost(_active_prims_0, _limbs_0));
  const _x_2 = nat_chk(_limbs_0 + _x_0);
  return nat_chk(_x_1 + _x_2);
}

function $outer_chain_uniform_recompile_cost(_extra_wraps_0) {
  return 0;
}

function $outer_chain_naive_recompile_cost(_extra_wraps_0, _base_compile_cost_0) {
  const _x_0 = nat_chk(_extra_wraps_0 + 1);
  const _x_1 = nat_chk(_base_compile_cost_0 + 1);
  return nat_chk(_x_0 * _x_1);
}

function $zeta_presplit_composite_cost(_limbs_0) {
  return nat_chk(3 * _limbs_0);
}

function $zeta_naive_composite_cost(_limbs_0) {
  const _x_0 = nat_chk(2 * _limbs_0);
  const _x_1 = ($zeta_presplit_composite_cost(_limbs_0));
  const _x_2 = nat_chk(_limbs_0 + _x_0);
  return nat_chk(_x_1 + _x_2);
}

function $preempt_stale_steps_wasted(_rem_old_0) {
  return 0;
}

function $queued_stale_steps_wasted(_rem_old_0) {
  return nat_chk(_rem_old_0 + 1);
}

function $pan_zoom_frame_steps(_req_steps_0, _frame_budget_0) {
  return (_req_steps_0 < _frame_budget_0 ? _req_steps_0 : _frame_budget_0);
}

function $pan_zoom_first_frame_latency(_extra_batches_0) {
  return 1;
}

function $non_progressive_wait_frames(_extra_batches_0) {
  return nat_chk(_extra_batches_0 + 2);
}

function $unified_zoom_fallback_count(_zoom_exp_0) {
  return 0;
}

function $legacy_dual_zoom_fallback_count(_zoom_exp_0) {
  return nat_chk(_zoom_exp_0 + 1);
}

function $eval_uexpr(_e_0, _z_0, _c_0) {
  if (_e_0.$ === "UVarZ") {
    return _z_0;
  } else if (_e_0.$ === "UVarC") {
    return _c_0;
  } else if (_e_0.$ === "UConst") {
    const _re_0 = _e_0["re"];
    const _im_0 = _e_0["im"];
    return $make_const(_re_0, _im_0, ($cpx_zoom_exp(_c_0)));
  } else if (_e_0.$ === "USq") {
    const _arg_0 = _e_0["arg"];
    return $cpx_sq(($eval_uexpr(_arg_0, _z_0, _c_0)));
  } else if (_e_0.$ === "URcp") {
    const _arg_1 = _e_0["arg"];
    return $cpx_rcp(($eval_uexpr(_arg_1, _z_0, _c_0)));
  } else if (_e_0.$ === "UPrim") {
    const _op_0 = _e_0["op"];
    const _arg_2 = _e_0["arg"];
    return $eval_prim(_op_0, ($eval_uexpr(_arg_2, _z_0, _c_0)));
  } else if (_e_0.$ === "UAdd") {
    const _lhs_0 = _e_0["lhs"];
    const _rhs_0 = _e_0["rhs"];
    return $cpx_add(($eval_uexpr(_lhs_0, _z_0, _c_0)), ($eval_uexpr(_rhs_0, _z_0, _c_0)));
  } else if (_e_0.$ === "USub") {
    const _lhs_1 = _e_0["lhs"];
    const _rhs_1 = _e_0["rhs"];
    return $cpx_sub(($eval_uexpr(_lhs_1, _z_0, _c_0)), ($eval_uexpr(_rhs_1, _z_0, _c_0)));
  } else if (_e_0.$ === "UMul") {
    const _lhs_2 = _e_0["lhs"];
    const _rhs_2 = _e_0["rhs"];
    return $cpx_mul(($eval_uexpr(_lhs_2, _z_0, _c_0)), ($eval_uexpr(_rhs_2, _z_0, _c_0)));
  } else {
    const _lhs_3 = _e_0["lhs"];
    const _rhs_3 = _e_0["rhs"];
    return $cpx_div(($eval_uexpr(_lhs_3, _z_0, _c_0)), ($eval_uexpr(_rhs_3, _z_0, _c_0)));
  }
}

function $eval_unified_chain(_steps_0, _e_0, _z0_0, _c_0) {
  if (_steps_0 === 0) {
    return _z0_0;
  } else {
    const _p_0 = (_steps_0 - 1);
    return $eval_uexpr(_e_0, ($eval_unified_chain(_p_0, _e_0, _z0_0, _c_0)), _c_0);
  }
}

function $select_chain_seed(_use_seed_0, _seed_re_0, _seed_im_0, _c_0) {
  if (!_use_seed_0) {
    return _c_0;
  } else {
    return $make_const(_seed_re_0, _seed_im_0, ($cpx_zoom_exp(_c_0)));
  }
}

function $eval_seeded_chain(_steps_0, _e_0, _use_seed_0, _seed_re_0, _seed_im_0, _c_0) {
  return $eval_unified_chain(_steps_0, _e_0, ($select_chain_seed(_use_seed_0, _seed_re_0, _seed_im_0, _c_0)), _c_0);
}

function $uexpr_mandelbrot() {
  return {$: "UAdd", "lhs": {$: "USq", "arg": {$: "UVarZ"}}, "rhs": {$: "UVarC"}};
}

function $uexpr_newton() {
  return {$: "UAdd", "lhs": {$: "UVarZ"}, "rhs": {$: "URcp", "arg": {$: "USq", "arg": {$: "UVarZ"}}}};
}

function $live_ui_mode(_st_0) {
  const _mode_0 = _st_0["mode"];
  return _mode_0;
}

function $live_ui_has_display(_st_0) {
  const _hd_0 = _st_0["has_display"];
  return _hd_0;
}

function $live_ui_remaining_steps(_st_0) {
  const _rem_0 = _st_0["remaining_steps"];
  return _rem_0;
}

function $live_ui_completed_steps(_st_0) {
  const _comp_0 = _st_0["completed_steps"];
  return _comp_0;
}

function $live_ui_active_total_steps(_st_0) {
  const _tot_0 = _st_0["active_total_steps"];
  return _tot_0;
}

function $live_ui_dirty_display(_st_0) {
  const _dd_0 = _st_0["dirty_display"];
  return _dd_0;
}

function $live_ui_total_steps(_mode_0, _chain_enabled_0, _chain_count_0) {
  if (!_chain_enabled_0) {
    return 1;
  } else {
    return _chain_count_0;
  }
}

function $live_ui_is_recurrence(_mode_0, _chain_enabled_0) {
  if (!_chain_enabled_0) {
    return 0;
  } else {
    return _mode_0;
  }
}

function $live_ui_start() {
  return {$: "LiveUIState", "mode": 0, "chain_enabled": false, "chain_count": 1, "read_idx": 0, "has_display": false, "need_seed_pass": true, "remaining_steps": 1, "completed_steps": 0, "active_total_steps": 1, "dirty_display": true};
}

function $live_ui_preempt(_st_0) {
  const _mode_0 = _st_0["mode"];
  const _ce_0 = _st_0["chain_enabled"];
  const _cc_0 = _st_0["chain_count"];
  const _ri_0 = _st_0["read_idx"];
  const _hd_0 = _st_0["has_display"];
  const _dd_0 = _st_0["dirty_display"];
  const _total_0 = ($live_ui_total_steps(_mode_0, _ce_0, _cc_0));
  return {$: "LiveUIState", "mode": _mode_0, "chain_enabled": _ce_0, "chain_count": _cc_0, "read_idx": _ri_0, "has_display": _hd_0, "need_seed_pass": true, "remaining_steps": _total_0, "completed_steps": 0, "active_total_steps": _total_0, "dirty_display": (_hd_0 || _dd_0)};
}

function $live_ui_set_depth(_st_0, _depth_0) {
  const _mode_0 = _st_0["mode"];
  const _ri_0 = _st_0["read_idx"];
  const _hd_0 = _st_0["has_display"];
  const _dd_0 = _st_0["dirty_display"];
  return {$: "LiveUIState", "mode": _mode_0, "chain_enabled": true, "chain_count": _depth_0, "read_idx": _ri_0, "has_display": _hd_0, "need_seed_pass": true, "remaining_steps": _depth_0, "completed_steps": 0, "active_total_steps": _depth_0, "dirty_display": (_hd_0 || _dd_0)};
}

function $live_ui_toggle_chain(_st_0) {
  const _mode_0 = _st_0["mode"];
  const _ce_0 = _st_0["chain_enabled"];
  const _cc_0 = _st_0["chain_count"];
  const _ri_0 = _st_0["read_idx"];
  const _hd_0 = _st_0["has_display"];
  const _dd_0 = _st_0["dirty_display"];
  const _next_ce_0 = ($Bool_not(_ce_0));
  const _total_0 = ($live_ui_total_steps(_mode_0, _next_ce_0, _cc_0));
  return {$: "LiveUIState", "mode": _mode_0, "chain_enabled": _next_ce_0, "chain_count": _cc_0, "read_idx": _ri_0, "has_display": _hd_0, "need_seed_pass": true, "remaining_steps": _total_0, "completed_steps": 0, "active_total_steps": _total_0, "dirty_display": (_hd_0 || _dd_0)};
}

function $live_ui_set_mode(_st_0, _next_mode_0) {
  const _mode_0 = _st_0["mode"];
  const _ce_0 = _st_0["chain_enabled"];
  const _cc_0 = _st_0["chain_count"];
  const _ri_0 = _st_0["read_idx"];
  const _hd_0 = _st_0["has_display"];
  const _dd_0 = _st_0["dirty_display"];
  const _total_0 = ($live_ui_total_steps(_next_mode_0, _ce_0, _cc_0));
  return {$: "LiveUIState", "mode": _next_mode_0, "chain_enabled": _ce_0, "chain_count": _cc_0, "read_idx": _ri_0, "has_display": _hd_0, "need_seed_pass": true, "remaining_steps": _total_0, "completed_steps": 0, "active_total_steps": _total_0, "dirty_display": (_hd_0 || _dd_0)};
}

function $live_ui_select_fractal(_st_0, _fid_0, _iter_0) {
  const _ri_0 = _st_0["read_idx"];
  const _hd_0 = _st_0["has_display"];
  const _dd_0 = _st_0["dirty_display"];
  return {$: "LiveUIState", "mode": _fid_0, "chain_enabled": true, "chain_count": _iter_0, "read_idx": _ri_0, "has_display": _hd_0, "need_seed_pass": true, "remaining_steps": _iter_0, "completed_steps": 0, "active_total_steps": _iter_0, "dirty_display": (_hd_0 || _dd_0)};
}

function $flip_fbo_idx(_idx_0) {
  return TAB_0[Math.min(_idx_0, 1)];
}

function $live_ui_step_batch(_st_0, _batch_cap_0) {
  const _mode_0 = _st_0["mode"];
  const _ce_0 = _st_0["chain_enabled"];
  const _cc_0 = _st_0["chain_count"];
  const _ri_0 = _st_0["read_idx"];
  const _hd_0 = _st_0["has_display"];
  const _t_0 = _st_0["remaining_steps"];
  if (_t_0 === 0) {
    const _comp_0 = _st_0["completed_steps"];
    const _tot_0 = _st_0["active_total_steps"];
    const _dd_0 = _st_0["dirty_display"];
    return {$: "LiveUIState", "mode": _mode_0, "chain_enabled": _ce_0, "chain_count": _cc_0, "read_idx": _ri_0, "has_display": _hd_0, "need_seed_pass": false, "remaining_steps": 0, "completed_steps": _comp_0, "active_total_steps": _tot_0, "dirty_display": _dd_0};
  } else {
    const _r_0 = (_t_0 - 1);
    const _comp_1 = _st_0["completed_steps"];
    const _tot_1 = _st_0["active_total_steps"];
    const _dd_1 = _st_0["dirty_display"];
    const _x_0 = nat_chk(_r_0 + 1);
    const _chunk_0 = (_x_0 < _batch_cap_0 ? _x_0 : _batch_cap_0);
    const _x_1 = nat_chk(_r_0 + 1);
    const _rem2_0 = (_x_1 < _chunk_0 ? 0 : _x_1 - _chunk_0);
    const _comp2_0 = nat_chk(_comp_1 + _chunk_0);
    const _ri2_0 = ($flip_fbo_idx(_ri_0));
    const _done_0 = ($Nat_is_eq(_rem2_0, 0));
    const _x_2 = (_hd_0 || _dd_1);
    return {$: "LiveUIState", "mode": _mode_0, "chain_enabled": _ce_0, "chain_count": _cc_0, "read_idx": _ri2_0, "has_display": (_done_0 || _hd_0), "need_seed_pass": false, "remaining_steps": _rem2_0, "completed_steps": _comp2_0, "active_total_steps": _tot_1, "dirty_display": (_done_0 || _x_2)};
  }
}

function $live_ui_must_present(_did_gl_work_0, _st_0) {
  const _hd_0 = _st_0["has_display"];
  const _dd_0 = _st_0["dirty_display"];
  return $Bool_and(_hd_0, (_did_gl_work_0 || _dd_0));
}

function $cpx_phase(_z_0) {
  const _ph_0 = _z_0["phase"];
  return _ph_0;
}

function $cpx_mag(_z_0) {
  const _mg_0 = _z_0["mag"];
  return _mg_0;
}

function $encode_escape_attractor_cpx(_mode_0, _raw_z_0, _iter_k_0, _c_0) {
  if (_mode_0 === 0) {
    return _raw_z_0;
  } else {
    const _re_0 = _raw_z_0["re"];
    const _im_0 = _raw_z_0["im"];
    const _il_0 = _raw_z_0["im_lo"];
    const _ph_0 = _raw_z_0["phase"];
    const _cze_0 = _c_0["zoom_exp"];
    return {$: "Cpx", "re": _re_0, "im": _im_0, "re_lo": nat_chk(_iter_k_0 + 1), "im_lo": _il_0, "phase": _ph_0, "mag": nat_chk(_iter_k_0 + 1), "zoom_exp": _cze_0};
  }
}

function $eval_general_orbit_mode(_mode_0, _steps_0, _e_0, _use_seed_0, _seed_re_0, _seed_im_0, _iter_k_0, _c_0) {
  return $encode_escape_attractor_cpx(_mode_0, ($eval_seeded_chain(_steps_0, _e_0, _use_seed_0, _seed_re_0, _seed_im_0, _c_0)), _iter_k_0, _c_0);
}

function $fps_120_budget_us() {
  return 8333;
}

function $fps_120_dispatched_cost_us(_req_us_0) {
  const _x_0 = (_req_us_0 < 7883 ? _req_us_0 : 7883);
  return nat_chk(450 + _x_0);
}

function $fps_120_naive_unbounded_cost_us(_extra_us_0) {
  return nat_chk(8334 + _extra_us_0);
}

function $live_ui_120fps_batch_cap(_depth_0, _op_cost_class_0) {
  if (_depth_0 === 0) {
    return 1;
  } else {
    return TAB_1[Math.min(_op_cost_class_0, 1)];
  }
}

function $fps_120_frame_dropped(_req_us_0) {
  return $Nat_is_gt(($fps_120_dispatched_cost_us(_req_us_0)), 8333);
}

function $stage_table_recompile_cost(_num_edits_0) {
  return 0;
}

function $inline_ast_recompile_cost(_num_edits_0, _base_compile_cost_0) {
  const _x_0 = nat_chk(_num_edits_0 + 1);
  const _x_1 = nat_chk(_base_compile_cost_0 + 1);
  return nat_chk(_x_0 * _x_1);
}

function $fused_sos_word_cost(_limbs_0) {
  return nat_chk(2 * _limbs_0);
}

function $unfused_sos_word_cost(_limbs_0) {
  const _x_0 = nat_chk(2 * _limbs_0);
  const _x_1 = ($fused_sos_word_cost(_limbs_0));
  const _x_2 = nat_chk(_limbs_0 + _x_0);
  return nat_chk(_x_1 + _x_2);
}

function $sinh_cosh_direct_cost(_limbs_0) {
  return nat_chk(3 * _limbs_0);
}

function $sinh_cosh_halved_cost(_limbs_0) {
  const _x_0 = nat_chk(2 * _limbs_0);
  const _x_1 = ($sinh_cosh_direct_cost(_limbs_0));
  const _x_2 = nat_chk(_limbs_0 + _x_0);
  return nat_chk(_x_1 + _x_2);
}

function $eval_zeta_ac_single_branch(_z_0) {
  return $eval_prim({$: "PZetaAC"}, _z_0);
}

function $zeta_ac_single_branch_cost(_zoom_exp_0) {
  const _x_0 = ($limbs_for_zoom(_zoom_exp_0));
  return nat_chk(3 * _x_0);
}

function $zeta_ac_dual_branch_cost(_zoom_exp_0) {
  const _x_0 = ($limbs_for_zoom(_zoom_exp_0));
  const _x_1 = ($limbs_for_zoom(_zoom_exp_0));
  const _x_2 = nat_chk(3 * _x_0);
  const _x_3 = ($zeta_ac_single_branch_cost(_zoom_exp_0));
  const _x_4 = nat_chk(_x_1 + _x_2);
  return nat_chk(_x_3 + _x_4);
}

function $Nat_div(_a_0, _b_0) {
  return $Pair_fst(nat_divmod(_a_0, _b_0));
}

function $Bool_and(_a_0, _b_0) {
  if (!_a_0) {
    return false;
  } else {
    return _b_0;
  }
}

function $Nat_is_eq(_a_0, _b_0) {
  return $Cmp_is_eq(cmp_new(_a_0, _b_0));
}

function $Nat_pow(_a_0, _b_0) {
  if (_b_0 === 0) {
    return 1;
  } else {
    const _p_0 = (_b_0 - 1);
    const _x_0 = ($Nat_pow(_a_0, _p_0));
    return nat_chk(_a_0 * _x_0);
  }
}

function $Bool_not(_b_0) {
  if (!_b_0) {
    return true;
  } else {
    return false;
  }
}

function $Nat_is_gt(_a_0, _b_0) {
  return $Cmp_is_gt(cmp_new(_a_0, _b_0));
}

function $Pair_fst(_p_0) {
  const _a_0 = _p_0["fst"];
  return _a_0;
}

function $Cmp_is_eq(_c_0) {
  if (_c_0.$ === "EQ") {
    return true;
  } else {
    return false;
  }
}

function $Cmp_is_gt(_c_0) {
  if (_c_0.$ === "GT") {
    return true;
  } else {
    return false;
  }
}

const TAB_0 = [1, 0];
const TAB_1 = [24, 8];export default {
  "base_limbs": run_lib(() => run_loop($base_limbs()), 0),
  "extra_limbs": run_lib((a0) => run_loop($extra_limbs(nat_in(a0))), 1),
  "limbs_for_zoom": run_lib((a0) => run_loop($limbs_for_zoom(nat_in(a0))), 1),
  "mantissa_bits": run_lib((a0) => run_loop($mantissa_bits(nat_in(a0))), 1),
  "knuth_two_sum_total": run_lib((a0,a1) => run_loop($knuth_two_sum_total(nat_in(a0),nat_in(a1))), 2),
  "quick_two_sum_violated_total": run_lib((a0,a1) => run_loop($quick_two_sum_violated_total(nat_in(a0),nat_in(a1))), 2),
  "bitwise_split_hi": run_lib((a0,a1) => run_loop($bitwise_split_hi(nat_in(a0),nat_in(a1))), 2),
  "bitwise_split_lo": run_lib((a0,a1) => run_loop($bitwise_split_lo(nat_in(a0),nat_in(a1))), 2),
  "dekker_fma_hi": run_lib((a0,a1) => run_loop($dekker_fma_hi(nat_in(a0),nat_in(a1))), 2),
  "fenced_two_sum_err": run_lib((a0,a1) => run_loop($fenced_two_sum_err(nat_in(a0),nat_in(a1))), 2),
  "unfenced_two_sum_err": run_lib((a0,a1) => run_loop($unfenced_two_sum_err(nat_in(a0),nat_in(a1))), 2),
  "sreal_zero": run_lib(() => run_loop($sreal_zero()), 0),
  "sneg": run_lib((a0) => run_loop($sneg(a0)), 1),
  "sadd": run_lib((a0,a1) => run_loop($sadd(a0,a1)), 2),
  "ssub": run_lib((a0,a1) => run_loop($ssub(a0,a1)), 2),
  "smul": run_lib((a0,a1) => run_loop($smul(a0,a1)), 2),
  "ssq": run_lib((a0) => run_loop($ssq(a0)), 1),
  "sscale": run_lib((a0,a1) => run_loop($sscale(a0,nat_in(a1))), 2),
  "sreal_eq_repr": run_lib((a0,a1) => run_loop($sreal_eq_repr(a0,a1)), 2),
  "cpx_zoom_exp": run_lib((a0) => run_loop($cpx_zoom_exp(a0)), 1),
  "cpx_re_lo": run_lib((a0) => run_loop($cpx_re_lo(a0)), 1),
  "cpx_im_lo": run_lib((a0) => run_loop($cpx_im_lo(a0)), 1),
  "cpx_eq": run_lib((a0,a1) => run_loop($cpx_eq(a0,a1)), 2),
  "make_const": run_lib((a0,a1,a2) => run_loop($make_const(nat_in(a0),nat_in(a1),nat_in(a2))), 3),
  "cpx_neg": run_lib((a0) => run_loop($cpx_neg(a0)), 1),
  "cpx_conj": run_lib((a0) => run_loop($cpx_conj(a0)), 1),
  "cpx_add": run_lib((a0,a1) => run_loop($cpx_add(a0,a1)), 2),
  "cpx_sub": run_lib((a0,a1) => run_loop($cpx_sub(a0,a1)), 2),
  "cpx_mul": run_lib((a0,a1) => run_loop($cpx_mul(a0,a1)), 2),
  "cpx_sq": run_lib((a0) => run_loop($cpx_sq(a0)), 1),
  "cpx_rcp": run_lib((a0) => run_loop($cpx_rcp(a0)), 1),
  "cpx_div": run_lib((a0,a1) => run_loop($cpx_div(a0,a1)), 2),
  "cam_zoom_exp": run_lib((a0) => run_loop($cam_zoom_exp(a0)), 1),
  "cam_zoom_in": run_lib((a0,a1) => run_loop($cam_zoom_in(a0,nat_in(a1))), 2),
  "cam_pan_x": run_lib((a0,a1) => run_loop($cam_pan_x(a0,nat_in(a1))), 2),
  "cam_unpan_x": run_lib((a0,a1) => run_loop($cam_unpan_x(a0,nat_in(a1))), 2),
  "cam_pan_y": run_lib((a0,a1) => run_loop($cam_pan_y(a0,nat_in(a1))), 2),
  "cam_unpan_y": run_lib((a0,a1) => run_loop($cam_unpan_y(a0,nat_in(a1))), 2),
  "sample_pixel": run_lib((a0,a1,a2) => run_loop($sample_pixel(a0,nat_in(a1),nat_in(a2))), 3),
  "eval_prim": run_lib((a0,a1) => run_loop($eval_prim(a0,a1)), 2),
  "zeta_term4_opt": run_lib((a0) => run_loop($zeta_term4_opt(a0)), 1),
  "zeta_term4_naive": run_lib((a0) => run_loop($zeta_term4_naive(a0)), 1),
  "eval_expr": run_lib((a0,a1) => run_loop($eval_expr(a0,a1)), 2),
  "compose_expr": run_lib((a0,a1) => run_loop($compose_expr(a0,a1)), 2),
  "preset_tan_sec": run_lib(() => run_loop($preset_tan_sec()), 0),
  "eval_full_chain": run_lib((a0,a1,a2) => run_loop($eval_full_chain(nat_in(a0),a1,a2)), 3),
  "unfold_full_chain": run_lib((a0,a1) => run_loop($unfold_full_chain(nat_in(a0),a1)), 2),
  "run_fbo_batches_full": run_lib((a0,a1,a2,a3) => run_loop($run_fbo_batches_full(nat_in(a0),nat_in(a1),a2,a3)), 4),
  "is_escape_attractor": run_lib((a0) => run_loop($is_escape_attractor(a0)), 1),
  "mandelbrot_step": run_lib((a0,a1) => run_loop($mandelbrot_step(a0,a1)), 2),
  "eval_mandelbrot": run_lib((a0,a1,a2) => run_loop($eval_mandelbrot(nat_in(a0),a1,a2)), 3),
  "newton_step": run_lib((a0) => run_loop($newton_step(a0)), 1),
  "eval_newton": run_lib((a0,a1) => run_loop($eval_newton(nat_in(a0),a1)), 2),
  "eval_fractal": run_lib((a0,a1,a2) => run_loop($eval_fractal(a0,nat_in(a1),a2)), 3),
  "eval_mode": run_lib((a0,a1) => run_loop($eval_mode(a0,a1)), 2),
  "palette_base_id": run_lib((a0) => run_loop($palette_base_id(a0)), 1),
  "shade_cpx": run_lib((a0,a1) => run_loop($shade_cpx(a0,a1)), 2),
  "render_pixel": run_lib((a0,a1,a2,a3,a4) => run_loop($render_pixel(a0,a1,a2,nat_in(a3),nat_in(a4))), 5),
  "pixel_cert_color": run_lib((a0) => run_loop($pixel_cert_color(a0)), 1),
  "pixel_cert_to_image": run_lib((a0) => run_loop($pixel_cert_to_image(a0)), 1),
  "pixel_cert_zoom_exp": run_lib((a0) => run_loop($pixel_cert_zoom_exp(a0)), 1),
  "ui_set_interacting": run_lib((a0,a1) => run_loop($ui_set_interacting(a0,a1)), 2),
  "effective_chain_steps": run_lib((a0) => run_loop($effective_chain_steps(a0)), 1),
  "render_ui_state": run_lib((a0,a1,a2) => run_loop($render_ui_state(a0,nat_in(a1),nat_in(a2))), 3),
  "render_quadtree": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($render_quadtree(nat_in(a0),a1,a2,a3,nat_in(a4),nat_in(a5))), 6),
  "quad_sum": run_lib((a0) => run_loop($quad_sum(nat_in(a0))), 1),
  "pow4": run_lib((a0) => run_loop($pow4(nat_in(a0))), 1),
  "image_pixels": run_lib((a0) => run_loop($image_pixels(a0)), 1),
  "stress_pan_zoom_step": run_lib((a0,a1,a2) => run_loop($stress_pan_zoom_step(a0,nat_in(a1),nat_in(a2))), 3),
  "stress_walk_scenes": run_lib((a0,a1,a2) => run_loop($stress_walk_scenes(nat_in(a0),a1,nat_in(a2))), 3),
  "stress_400_to_200_to_zoom50": run_lib((a0,a1,a2) => run_loop($stress_400_to_200_to_zoom50(a0,nat_in(a1),nat_in(a2))), 3),
  "sq_word_cost": run_lib((a0) => run_loop($sq_word_cost(nat_in(a0))), 1),
  "mul_word_cost": run_lib((a0) => run_loop($mul_word_cost(nat_in(a0))), 1),
  "div_graded_word_cost": run_lib((a0) => run_loop($div_graded_word_cost(nat_in(a0))), 1),
  "div_naive_word_cost": run_lib((a0) => run_loop($div_naive_word_cost(nat_in(a0))), 1),
  "cpx_div_scaled_cost": run_lib((a0) => run_loop($cpx_div_scaled_cost(nat_in(a0))), 1),
  "cpx_div_two_div_cost": run_lib((a0) => run_loop($cpx_div_two_div_cost(nat_in(a0))), 1),
  "prim_cost_opt": run_lib((a0,a1) => run_loop($prim_cost_opt(a0,nat_in(a1))), 2),
  "prim_cost_savings": run_lib((a0,a1) => run_loop($prim_cost_savings(a0,nat_in(a1))), 2),
  "prim_cost_naive": run_lib((a0,a1) => run_loop($prim_cost_naive(a0,nat_in(a1))), 2),
  "expr_cost_opt": run_lib((a0,a1) => run_loop($expr_cost_opt(a0,nat_in(a1))), 2),
  "expr_cost_savings": run_lib((a0,a1) => run_loop($expr_cost_savings(a0,nat_in(a1))), 2),
  "expr_cost_naive": run_lib((a0,a1) => run_loop($expr_cost_naive(a0,nat_in(a1))), 2),
  "full_chain_cost_opt": run_lib((a0,a1,a2) => run_loop($full_chain_cost_opt(nat_in(a0),a1,nat_in(a2))), 3),
  "full_chain_cost_savings": run_lib((a0,a1,a2) => run_loop($full_chain_cost_savings(nat_in(a0),a1,nat_in(a2))), 3),
  "full_chain_cost_naive": run_lib((a0,a1,a2) => run_loop($full_chain_cost_naive(nat_in(a0),a1,nat_in(a2))), 3),
  "eval_tan_single_pass": run_lib((a0) => run_loop($eval_tan_single_pass(a0)), 1),
  "tan_single_pass_cost": run_lib((a0) => run_loop($tan_single_pass_cost(nat_in(a0))), 1),
  "tan_duplicate_sincos_cost": run_lib((a0) => run_loop($tan_duplicate_sincos_cost(nat_in(a0))), 1),
  "tan_direct_denom_bits": run_lib((a0,a1) => run_loop($tan_direct_denom_bits(nat_in(a0),nat_in(a1))), 2),
  "tan_double_angle_denom_bits": run_lib((a0,a1) => run_loop($tan_double_angle_denom_bits(nat_in(a0),nat_in(a1))), 2),
  "shade_domain_fast_log2": run_lib((a0,a1) => run_loop($shade_domain_fast_log2(a0,a1)), 2),
  "shade_domain_fast_cost": run_lib((a0) => run_loop($shade_domain_fast_cost(nat_in(a0))), 1),
  "shade_domain_naive_cost": run_lib((a0) => run_loop($shade_domain_naive_cost(nat_in(a0))), 1),
  "pipeline_v2_cost": run_lib((a0,a1,a2) => run_loop($pipeline_v2_cost(nat_in(a0),a1,nat_in(a2))), 3),
  "pipeline_v2_savings": run_lib((a0,a1,a2) => run_loop($pipeline_v2_savings(nat_in(a0),a1,nat_in(a2))), 3),
  "pipeline_v1_cost": run_lib((a0,a1,a2) => run_loop($pipeline_v1_cost(nat_in(a0),a1,nat_in(a2))), 3),
  "parallel_span": run_lib((a0,a1) => run_loop($parallel_span(nat_in(a0),nat_in(a1))), 2),
  "pauldelbrot_rebased_state": run_lib((a0,a1) => run_loop($pauldelbrot_rebased_state(a0,a1)), 2),
  "fbo_present_on_completion": run_lib((a0,a1,a2) => run_loop($fbo_present_on_completion(nat_in(a0),a1,a2)), 3),
  "gpu_fence_dispatch_steps": run_lib((a0,a1) => run_loop($gpu_fence_dispatch_steps(a0,nat_in(a1))), 2),
  "renorm_6pass_word_cost": run_lib((a0) => run_loop($renorm_6pass_word_cost(nat_in(a0))), 1),
  "renorm_8pass_word_cost": run_lib((a0) => run_loop($renorm_8pass_word_cost(nat_in(a0))), 1),
  "sqrt_incremental_rem_cost": run_lib((a0) => run_loop($sqrt_incremental_rem_cost(nat_in(a0))), 1),
  "sqrt_resquare_cost": run_lib((a0) => run_loop($sqrt_resquare_cost(nat_in(a0))), 1),
  "unfold_unary_chain": run_lib((a0,a1,a2) => run_loop($unfold_unary_chain(nat_in(a0),a1,a2)), 3),
  "eval_unary_chain": run_lib((a0,a1,a2) => run_loop($eval_unary_chain(nat_in(a0),a1,a2)), 3),
  "eval_sec_direct_sos": run_lib((a0) => run_loop($eval_sec_direct_sos(a0)), 1),
  "sec_direct_sos_cost": run_lib((a0) => run_loop($sec_direct_sos_cost(nat_in(a0))), 1),
  "sec_naive_cos_rcp_cost": run_lib((a0) => run_loop($sec_naive_cos_rcp_cost(nat_in(a0))), 1),
  "shader_compile_dce_cost": run_lib((a0,a1) => run_loop($shader_compile_dce_cost(nat_in(a0),nat_in(a1))), 2),
  "shader_compile_monolithic_cost": run_lib((a0,a1) => run_loop($shader_compile_monolithic_cost(nat_in(a0),nat_in(a1))), 2),
  "outer_chain_uniform_recompile_cost": run_lib((a0) => run_loop($outer_chain_uniform_recompile_cost(nat_in(a0))), 1),
  "outer_chain_naive_recompile_cost": run_lib((a0,a1) => run_loop($outer_chain_naive_recompile_cost(nat_in(a0),nat_in(a1))), 2),
  "zeta_presplit_composite_cost": run_lib((a0) => run_loop($zeta_presplit_composite_cost(nat_in(a0))), 1),
  "zeta_naive_composite_cost": run_lib((a0) => run_loop($zeta_naive_composite_cost(nat_in(a0))), 1),
  "preempt_stale_steps_wasted": run_lib((a0) => run_loop($preempt_stale_steps_wasted(nat_in(a0))), 1),
  "queued_stale_steps_wasted": run_lib((a0) => run_loop($queued_stale_steps_wasted(nat_in(a0))), 1),
  "pan_zoom_frame_steps": run_lib((a0,a1) => run_loop($pan_zoom_frame_steps(nat_in(a0),nat_in(a1))), 2),
  "pan_zoom_first_frame_latency": run_lib((a0) => run_loop($pan_zoom_first_frame_latency(nat_in(a0))), 1),
  "non_progressive_wait_frames": run_lib((a0) => run_loop($non_progressive_wait_frames(nat_in(a0))), 1),
  "unified_zoom_fallback_count": run_lib((a0) => run_loop($unified_zoom_fallback_count(nat_in(a0))), 1),
  "legacy_dual_zoom_fallback_count": run_lib((a0) => run_loop($legacy_dual_zoom_fallback_count(nat_in(a0))), 1),
  "eval_uexpr": run_lib((a0,a1,a2) => run_loop($eval_uexpr(a0,a1,a2)), 3),
  "eval_unified_chain": run_lib((a0,a1,a2,a3) => run_loop($eval_unified_chain(nat_in(a0),a1,a2,a3)), 4),
  "select_chain_seed": run_lib((a0,a1,a2,a3) => run_loop($select_chain_seed(a0,nat_in(a1),nat_in(a2),a3)), 4),
  "eval_seeded_chain": run_lib((a0,a1,a2,a3,a4,a5) => run_loop($eval_seeded_chain(nat_in(a0),a1,a2,nat_in(a3),nat_in(a4),a5)), 6),
  "uexpr_mandelbrot": run_lib(() => run_loop($uexpr_mandelbrot()), 0),
  "uexpr_newton": run_lib(() => run_loop($uexpr_newton()), 0),
  "live_ui_mode": run_lib((a0) => run_loop($live_ui_mode(a0)), 1),
  "live_ui_has_display": run_lib((a0) => run_loop($live_ui_has_display(a0)), 1),
  "live_ui_remaining_steps": run_lib((a0) => run_loop($live_ui_remaining_steps(a0)), 1),
  "live_ui_completed_steps": run_lib((a0) => run_loop($live_ui_completed_steps(a0)), 1),
  "live_ui_active_total_steps": run_lib((a0) => run_loop($live_ui_active_total_steps(a0)), 1),
  "live_ui_dirty_display": run_lib((a0) => run_loop($live_ui_dirty_display(a0)), 1),
  "live_ui_total_steps": run_lib((a0,a1,a2) => run_loop($live_ui_total_steps(nat_in(a0),a1,nat_in(a2))), 3),
  "live_ui_is_recurrence": run_lib((a0,a1) => run_loop($live_ui_is_recurrence(nat_in(a0),a1)), 2),
  "live_ui_start": run_lib(() => run_loop($live_ui_start()), 0),
  "live_ui_preempt": run_lib((a0) => run_loop($live_ui_preempt(a0)), 1),
  "live_ui_set_depth": run_lib((a0,a1) => run_loop($live_ui_set_depth(a0,nat_in(a1))), 2),
  "live_ui_toggle_chain": run_lib((a0) => run_loop($live_ui_toggle_chain(a0)), 1),
  "live_ui_set_mode": run_lib((a0,a1) => run_loop($live_ui_set_mode(a0,nat_in(a1))), 2),
  "live_ui_select_fractal": run_lib((a0,a1,a2) => run_loop($live_ui_select_fractal(a0,nat_in(a1),nat_in(a2))), 3),
  "flip_fbo_idx": run_lib((a0) => run_loop($flip_fbo_idx(nat_in(a0))), 1),
  "live_ui_step_batch": run_lib((a0,a1) => run_loop($live_ui_step_batch(a0,nat_in(a1))), 2),
  "live_ui_must_present": run_lib((a0,a1) => run_loop($live_ui_must_present(a0,a1)), 2),
  "cpx_phase": run_lib((a0) => run_loop($cpx_phase(a0)), 1),
  "cpx_mag": run_lib((a0) => run_loop($cpx_mag(a0)), 1),
  "encode_escape_attractor_cpx": run_lib((a0,a1,a2,a3) => run_loop($encode_escape_attractor_cpx(nat_in(a0),a1,nat_in(a2),a3)), 4),
  "eval_general_orbit_mode": run_lib((a0,a1,a2,a3,a4,a5,a6,a7) => run_loop($eval_general_orbit_mode(nat_in(a0),nat_in(a1),a2,a3,nat_in(a4),nat_in(a5),nat_in(a6),a7)), 8),
  "fps_120_budget_us": run_lib(() => run_loop($fps_120_budget_us()), 0),
  "fps_120_dispatched_cost_us": run_lib((a0) => run_loop($fps_120_dispatched_cost_us(nat_in(a0))), 1),
  "fps_120_naive_unbounded_cost_us": run_lib((a0) => run_loop($fps_120_naive_unbounded_cost_us(nat_in(a0))), 1),
  "live_ui_120fps_batch_cap": run_lib((a0,a1) => run_loop($live_ui_120fps_batch_cap(nat_in(a0),nat_in(a1))), 2),
  "fps_120_frame_dropped": run_lib((a0) => run_loop($fps_120_frame_dropped(nat_in(a0))), 1),
  "stage_table_recompile_cost": run_lib((a0) => run_loop($stage_table_recompile_cost(nat_in(a0))), 1),
  "inline_ast_recompile_cost": run_lib((a0,a1) => run_loop($inline_ast_recompile_cost(nat_in(a0),nat_in(a1))), 2),
  "fused_sos_word_cost": run_lib((a0) => run_loop($fused_sos_word_cost(nat_in(a0))), 1),
  "unfused_sos_word_cost": run_lib((a0) => run_loop($unfused_sos_word_cost(nat_in(a0))), 1),
  "sinh_cosh_direct_cost": run_lib((a0) => run_loop($sinh_cosh_direct_cost(nat_in(a0))), 1),
  "sinh_cosh_halved_cost": run_lib((a0) => run_loop($sinh_cosh_halved_cost(nat_in(a0))), 1),
  "eval_zeta_ac_single_branch": run_lib((a0) => run_loop($eval_zeta_ac_single_branch(a0)), 1),
  "zeta_ac_single_branch_cost": run_lib((a0) => run_loop($zeta_ac_single_branch_cost(nat_in(a0))), 1),
  "zeta_ac_dual_branch_cost": run_lib((a0) => run_loop($zeta_ac_dual_branch_cost(nat_in(a0))), 1),
};
