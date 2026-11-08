import bendEngine from './bend_engine.mjs';
import { state, context, subscribeState, zPlaneParams } from '../store/state.js';
import { domainPalettes, getDomainPaletteStops } from '../constants/domain-palettes.js';
import { parseExpression } from '../math/expression/parser.js';
import { computeTaylorSeriesCoefficients } from '../native/map-runtime.js';
import { requireFiniteNumber } from '../utils/numeric-contracts.js';
import { requestDomainRedraw } from './redraw-scheduler.js';

// ============================================================================
// 1. 384-BIT / 115-DIGIT DETACHED-EXPONENT BIGINT + 96-BIT QUAD-SINGLE CAMERA
// ============================================================================
const f32 = Math.fround;
export const BIG_DIGITS = 110;
const FIVE_POW_110 = 5n ** 110n;
const _f32Buf = new Float32Array(1);
const _u32Buf = new Uint32Array(_f32Buf.buffer);

export function numberToBigFixed(val, exp10Offset = 0) {
    if (!Number.isFinite(val) || val === 0) return 0n;
    const sign = val < 0 ? -1n : 1n;
    const abs = Math.abs(val);
    const log10 = Math.floor(Math.log10(abs));
    const norm = abs / Math.pow(10, log10); // [1, 10)
    const scaledMant = BigInt(Math.round(norm * 1e15));
    const totalShift = BIG_DIGITS + log10 + exp10Offset - 15;
    if (totalShift >= 0) {
        return sign * scaledMant * (10n ** BigInt(totalShift));
    } else {
        const divShift = -totalShift;
        if (divShift > BIG_DIGITS + 20) return 0n;
        return (sign * scaledMant) / (10n ** BigInt(divShift));
    }
}

export function float32ToBigFixed(val) {
    _f32Buf[0] = val;
    const bits = _u32Buf[0];
    const sign = bits >>> 31 ? -1n : 1n;
    const exp = (bits >>> 23) & 0xff;
    const mant = bits & 0x7fffff;
    if (exp === 0 && mant === 0) return 0n;
    const sig = exp === 0 ? BigInt(mant) : BigInt(mant | 0x800000);
    const e2 = (exp === 0 ? -126 : exp - 127) - 23;
    const shift2 = BIG_DIGITS + e2;
    if (shift2 >= 0) {
        return sign * sig * FIVE_POW_110 * (1n << BigInt(shift2));
    } else {
        const rshift = -shift2;
        if (rshift > 240) return 0n;
        return (sign * sig * FIVE_POW_110) >> BigInt(rshift);
    }
}

export function bigFixedToNumber(bigVal) {
    if (bigVal === 0n) return 0.0;
    const sign = bigVal < 0n ? -1.0 : 1.0;
    const absStr = (bigVal < 0n ? -bigVal : bigVal).toString();
    const len = absStr.length;
    const head = absStr.slice(0, Math.min(17, len));
    const headNum = Number(head);
    const exp10 = len - head.length - BIG_DIGITS;
    return sign * headNum * Math.pow(10, exp10);
}

export function bigFixedToString(bigVal, maxFracDigits = 36) {
    if (typeof bigVal !== 'bigint' || bigVal === 0n) return '0';
    const neg = bigVal < 0n;
    const absVal = neg ? -bigVal : bigVal;
    const raw = absVal.toString().padStart(BIG_DIGITS + 1, '0');
    const intPart = raw.slice(0, raw.length - BIG_DIGITS) || '0';
    let fracPart = raw.slice(raw.length - BIG_DIGITS, raw.length - BIG_DIGITS + Math.max(1, Math.min(BIG_DIGITS, maxFracDigits)));
    fracPart = fracPart.replace(/0+$/, '');
    const signPrefix = neg ? '-' : '';
    return fracPart.length > 0 ? `${signPrefix}${intPart}.${fracPart}` : `${signPrefix}${intPart}`;
}

export function stringToBigFixed(str) {
    if (typeof str !== 'string') return null;
    const s = str.trim();
    const m = s.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
    if (!m) return null;
    const sign = m[1] === '-' ? -1n : 1n;
    const intDigits = m[2] || '0';
    const fracDigits = m[3] !== undefined ? m[3] : (m[4] || '');
    const exp10 = m[5] ? parseInt(m[5], 10) : 0;
    if (!Number.isFinite(exp10) || Math.abs(exp10) > 300) return null;
    const combined = (intDigits + fracDigits).replace(/^0+/, '') || '0';
    if (combined === '0') return 0n;
    const shift = BIG_DIGITS - fracDigits.length + exp10;
    if (shift >= 0) {
        return sign * BigInt(combined) * (10n ** BigInt(shift));
    }
    const cut = -shift;
    if (cut >= combined.length) return 0n;
    return sign * BigInt(combined.slice(0, combined.length - cut));
}

// Law 55 & Law 57: Pure Monotonic 4-Limb IEEE-754 Extraction (Zero Fallbacks, Zero Modular Wraps)
export function bigFixedToQS(bigVal) {
    let rem = bigVal;
    const w0 = f32(bigFixedToNumber(rem));
    rem -= float32ToBigFixed(w0);
    const w1 = f32(bigFixedToNumber(rem));
    rem -= float32ToBigFixed(w1);
    const w2 = f32(bigFixedToNumber(rem));
    rem -= float32ToBigFixed(w2);
    const w3 = f32(bigFixedToNumber(rem));
    return new Float32Array([w0, w1, w2, w3]);
}

export function splitDoubleToQS(val) {
    const w0 = f32(val);
    const r1 = val - w0;
    const w1 = f32(r1);
    const r2 = r1 - w1;
    const w2 = f32(r2);
    const w3 = f32(r2 - w2);
    return new Float32Array([w0, w1, w2, w3]);
}

export function qsToNumber(a) {
    return a[0] + a[1] + a[2] + a[3];
}

export function glslFloat(v) {
    if (!Number.isFinite(v) || v === 0) return '0.0';
    const s = v.toString();
    return s.includes('.') || s.includes('e') || s.includes('E') ? s : `${s}.0`;
}

export function qsVec4Literal(val) {
    const q = splitDoubleToQS(val);
    return `vec4(${glslFloat(q[0])}, ${glslFloat(q[1])}, ${glslFloat(q[2])}, ${glslFloat(q[3])})`;
}

export function cqsRealLiteral(val) {
    return `cqs(${qsVec4Literal(val)}, vec4(0.0))`;
}

export function cqsComplexLiteral(re, im) {
    const qr = splitDoubleToQS(re);
    const qi = splitDoubleToQS(im);
    return `cqs(vec4(${glslFloat(qr[0])}, ${glslFloat(qr[1])}, ${glslFloat(qr[2])}, ${glslFloat(qr[3])}), vec4(${glslFloat(qi[0])}, ${glslFloat(qi[1])}, ${glslFloat(qi[2])}, ${glslFloat(qi[3])}))`;
}

const _splitBufF32 = new Float32Array(1);
const _splitBufU32 = new Uint32Array(_splitBufF32.buffer);
function preSplitVec3GLSL(v0, v1, v2) {
    const hs = [];
    const ls = [];
    for (const v of [v0, v1, v2]) {
        _splitBufF32[0] = v;
        const full = _splitBufF32[0];
        _splitBufU32[0] &= 0xfffff000;
        const h = _splitBufF32[0];
        _splitBufF32[0] = full - h;
        const l = _splitBufF32[0];
        hs.push(glslFloat(h));
        ls.push(glslFloat(l));
    }
    return { hi: `vec3(${hs.join(', ')})`, lo: `vec3(${ls.join(', ')})` };
}

const SPLIT_PIO2    = preSplitVec3GLSL(1.5707963705062866, -4.371138828673793e-8, -1.7288452101912154e-15);
const SPLIT_PI      = preSplitVec3GLSL(3.1415927410125732, -8.742277657347586e-8, -3.4576904203824307e-15);
const SPLIT_INV_TAU = preSplitVec3GLSL(0.15915493667125702, 6.420638562210615e-9, -2.454847080402997e-16);
const SPLIT_LN2     = preSplitVec3GLSL(0.6931471824645996, -1.904654323148236e-9, 2.3100868899665896e-17);
const SPLIT_LOG2E   = preSplitVec3GLSL(1.4426950216293335, 1.9259629911266175e-8, -1.0725792993241715e-16);
const SPLIT_LN2PI   = preSplitVec3GLSL(1.8378770351409912, 3.126272486539816e-8, -1.519465726557128e-15);
const SPLIT_LN3     = preSplitVec3GLSL(1.0986123085021973, -2.003646750830562e-8, 3.694922296286588e-17);
const SPLIT_LN5     = preSplitVec3GLSL(1.6094379425048828, -2.803797028436976e-8, -3.575870709480116e-16);
const SPLIT_LN7     = preSplitVec3GLSL(1.945910096168518, 5.288904569407645e-8, -1.2586684776049217e-15);

// ============================================================================
// 2. 96-BIT QUAD-SINGLE (FP96 EMULATED) SIMD COMPLEX & TRANSCENDENTAL ENGINE
// ============================================================================
export const VS_QUAD = `#version 300 es
  layout(location = 0) in vec2 a_pos;
  void main() {
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

export const GLSL_CDS_CORE = `
  const float PI = 3.14159265358979323846;
  const float TAU = 6.28318530717958647692;
  uniform float u_zero;

  const vec4 QS_ONE       = vec4(1.0, 0.0, 0.0, 0.0);
  const vec4 QS_PIO2      = vec4(1.5707963705062866, -4.371138828673793e-8, -1.7288452101912154e-15, -2.21341947e-23);
  const vec3 QS_PIO2_H    = ${SPLIT_PIO2.hi};
  const vec3 QS_PIO2_L    = ${SPLIT_PIO2.lo};
  const vec4 QS_PI        = vec4(3.1415927410125732, -8.742277657347586e-8, -3.4576904203824307e-15, -4.42683894e-23);
  const vec3 QS_PI_H      = ${SPLIT_PI.hi};
  const vec3 QS_PI_L      = ${SPLIT_PI.lo};
  const vec4 QS_TAU       = vec4(6.2831854820251465, -1.7484555314695172e-7, -6.9153808407648614e-15, -8.85367788e-23);
  const vec4 QS_INV_TAU   = vec4(0.15915493667125702, 6.420638562210615e-9, -2.454847080402997e-16, 7.979728e-24);
  const vec3 QS_INV_TAU_H = ${SPLIT_INV_TAU.hi};
  const vec3 QS_INV_TAU_L = ${SPLIT_INV_TAU.lo};
  const vec4 QS_E         = vec4(2.7182817459106445, 8.254840370311029e-8, -2.639619450691032e-16, -2.1494225e-24);
  const vec4 QS_LN2       = vec4(0.6931471824645996, -1.904654323148236e-9, 2.3100868899665896e-17, -1.36050424e-25);
  const vec3 QS_LN2_H     = ${SPLIT_LN2.hi};
  const vec3 QS_LN2_L     = ${SPLIT_LN2.lo};
  const vec4 QS_LOG2E     = vec4(1.4426950216293335, 1.9259629911266175e-8, -1.0725792993241715e-16, -7.83513946e-25);
  const vec3 QS_LOG2E_H   = ${SPLIT_LOG2E.hi};
  const vec3 QS_LOG2E_L   = ${SPLIT_LOG2E.lo};
  const vec4 QS_LN2PI     = vec4(1.8378770351409912, 3.126272486539816e-8, -1.519465726557128e-15, -1.0872797e-22);
  const vec3 QS_LN2PI_H   = ${SPLIT_LN2PI.hi};
  const vec3 QS_LN2PI_L   = ${SPLIT_LN2PI.lo};

  const vec4 QS_LN3 = vec4(1.0986123085021973, -2.003646750830562e-8, 3.694922296286588e-17, -1.87266564e-24);
  const vec3 QS_LN3_H = ${SPLIT_LN3.hi};
  const vec3 QS_LN3_L = ${SPLIT_LN3.lo};
  const vec4 QS_LN5 = vec4(1.6094379425048828, -2.803797028436976e-8, -3.575870709480116e-16, -1.02821985e-23);
  const vec3 QS_LN5_H = ${SPLIT_LN5.hi};
  const vec3 QS_LN5_L = ${SPLIT_LN5.lo};
  const vec4 QS_LN7 = vec4(1.945910096168518, 5.288904569407645e-8, -1.2586684776049217e-15, 7.6251986e-23);
  const vec3 QS_LN7_H = ${SPLIT_LN7.hi};
  const vec3 QS_LN7_L = ${SPLIT_LN7.lo};

  const float BORWEIN_W[8] = float[8](
    0.99609375, -0.96484375, 0.85546875, -0.63671875,
    0.36328125, -0.14453125, 0.03515625, -0.00390625
  );

  struct cqs {
    vec4 re;
    vec4 im;
  };

  bool cds_invalid(cqs z) {
    return isnan(z.re.x) || isnan(z.im.x) || isinf(z.re.x) || isinf(z.im.x) ||
           isnan(z.re.y) || isnan(z.im.y) || isnan(z.re.z) || isnan(z.im.z) ||
           isnan(z.re.w) || isnan(z.im.w);
  }

  float fence1(float x) {
    return x + u_zero;
  }

  vec3 fence3(vec3 x) {
    return x + u_zero;
  }

  void two_sum(float a, float b, out float s, out float e) {
    s = fence1(a + b);
    float v = fence1(s - a);
    e = (a - fence1(s - v)) + (b - v);
  }

  void split1(float a, out float hi, out float lo) {
    hi = uintBitsToFloat(floatBitsToUint(a) & 0xFFFFF000u);
    lo = fence1(a - hi);
  }

  void split3(vec3 a, out vec3 hi, out vec3 lo) {
    hi = uintBitsToFloat(floatBitsToUint(a) & uvec3(0xFFFFF000u));
    lo = fence3(a - hi);
  }

  void tp_fast(float a, float ah, float al, float b, float bh, float bl, out float p, out float err) {
    p = fence1(a * b);
    float e1 = fence1(fence1(ah * bh) - p);
    float e2 = fence1(e1 + ah * bl);
    float e3 = fence1(e2 + al * bh);
    err = e3 + al * bl;
  }

  void two_prod(float a, float b, out float p, out float err) {
    float ah, al, bh, bl;
    split1(a, ah, al);
    split1(b, bh, bl);
    tp_fast(a, ah, al, b, bh, bl, p, err);
  }

  // Law 45: 6-Pass Zero-Hole-Safe Knuth-Exact Hida-Li-Bailey 4-Limb Renormalization
  vec4 qs_renorm(vec4 c) {
    float s2, t3, s1, t2, r0, t1;
    two_sum(c.z, c.w, s2, t3);
    two_sum(c.y, s2, s1, t2);
    two_sum(c.x, s1, r0, t1);

    float u1, e2, u2, e3, r1, d2;
    two_sum(t1, t2, u1, e2);
    two_sum(e2, t3, u2, e3);
    two_sum(u1, u2, r1, d2);
    float r2 = fence1(d2 + e3);
    float r3 = e3 - fence1(r2 - d2);
    return vec4(r0, r1, r2, r3);
  }

  // Fast 2-Pass Pre-Ordered Limb Renormalization (10 ops vs 14 ops when |c0| >= |c1| >= |c2| >= |c3|)
  vec4 qs_renorm_fast(float c0, float c1, float c2, float c3) {
    float s2, t3, s1, t2, r0, t1, u1, e2, u2, e3, r1, d2;
    two_sum(c2, c3, s2, t3);
    two_sum(c1, s2, s1, t2);
    two_sum(c0, s1, r0, t1);
    two_sum(t1, t2, u1, e2);
    two_sum(e2, t3, u2, e3);
    two_sum(u1, u2, r1, d2);
    float r2 = fence1(d2 + e3);
    float r3 = e3 - fence1(r2 - d2);
    return vec4(r0, r1, r2, r3);
  }

  vec4 qs_set(float a) { return vec4(a, 0.0, 0.0, 0.0); }
  vec4 qs_neg(vec4 a)  { return -a; }

  vec4 qs_add(vec4 a, vec4 b) {
    float s0, e0, s1, e1, s2, e2;
    two_sum(a.x, b.x, s0, e0);
    two_sum(a.y, b.y, s1, e1);
    two_sum(a.z, b.z, s2, e2);
    float t1, c1, ce1, ce1_err, t2, c2;
    two_sum(s1, e0, t1, c1);
    two_sum(c1, e1, ce1, ce1_err);
    two_sum(s2, ce1, t2, c2);
    float t3 = a.w + b.w + e2 + c2 + ce1_err;
    return qs_renorm_fast(s0, t1, t2, t3);
  }

  vec4 qs_sub(vec4 a, vec4 b) {
    return qs_add(a, -b);
  }

  void qs_add_sub(vec4 a, vec4 b, out vec4 sum_ab, out vec4 diff_ab) {
    sum_ab = qs_add(a, b);
    diff_ab = qs_add(a, -b);
  }

  vec4 qs_add_f(float a, vec4 b) {
    float s0, e0, s1, e1, s2, e2;
    two_sum(a, b.x, s0, e0);
    two_sum(b.y, e0, s1, e1);
    two_sum(b.z, e1, s2, e2);
    float s3 = b.w + e2;
    return qs_renorm_fast(s0, s1, s2, s3);
  }

  vec4 qs_mul_presplit_both(vec4 a, vec3 ah, vec3 al, vec4 b, vec3 bh, vec3 bl) {
    float p00, e00, p01, e01, p10, e10;
    tp_fast(a.x, ah.x, al.x, b.x, bh.x, bl.x, p00, e00);
    tp_fast(a.x, ah.x, al.x, b.y, bh.y, bl.y, p01, e01);
    tp_fast(a.y, ah.y, al.y, b.x, bh.x, bl.x, p10, e10);

    float t1a, c1a, t1, c1b;
    two_sum(p01, p10, t1a, c1a);
    two_sum(t1a, e00, t1, c1b);

    float p02, e02, p11, e11, p20, e20;
    tp_fast(a.x, ah.x, al.x, b.z, bh.z, bl.z, p02, e02);
    tp_fast(a.y, ah.y, al.y, b.y, bh.y, bl.y, p11, e11);
    tp_fast(a.z, ah.z, al.z, b.x, bh.x, bl.x, p20, e20);

    float t2a, c2a, t2b, c2b, ec0, err_e1, ec1, err_c1, e1s, c2d, t2, c2c;
    two_sum(p02, p11, t2a, c2a);
    two_sum(t2a, p20, t2b, c2b);
    two_sum(e01, e10, ec0, err_e1);
    two_sum(c1a, c1b, ec1, err_c1);
    two_sum(ec0, ec1, e1s, c2d);
    two_sum(t2b, e1s, t2, c2c);

    float t3 = a.x * b.w + a.y * b.z + a.z * b.y + a.w * b.x + e02 + e11 + e20 + c2a + c2b + c2c + c2d + err_e1 + err_c1;
    return qs_renorm_fast(p00, t1, t2, t3);
  }

  vec4 qs_mul_presplit_lhs(vec4 a, vec3 ah, vec3 al, vec4 b) {
    vec3 bh, bl;
    split3(b.xyz, bh, bl);
    return qs_mul_presplit_both(a, ah, al, b, bh, bl);
  }

  vec4 qs_mul(vec4 a, vec4 b) {
    vec3 ah, al, bh, bl;
    split3(a.xyz, ah, al);
    split3(b.xyz, bh, bl);
    return qs_mul_presplit_both(a, ah, al, b, bh, bl);
  }

  vec4 qs_add_mul_tail2_presplit(vec4 c, vec4 u, float uxh, float uxl, vec4 p) {
    float pxh, pxl, p0, e0;
    split1(p.x, pxh, pxl);
    tp_fast(u.x, uxh, uxl, p.x, pxh, pxl, p0, e0);
    float p1 = u.x * p.y + u.y * p.x + e0;
    float s0, ce0, r0, r1;
    two_sum(c.x, p0, s0, ce0);
    float t1 = c.y + p1 + ce0;
    two_sum(s0, t1, r0, r1);
    return vec4(r0, r1, 0.0, 0.0);
  }

  vec4 qs_add_mul_tail3_presplit(vec4 c, vec4 u, float uxh, float uxl, float uyh, float uyl, vec4 p) {
    float pxh, pxl, pyh, pyl;
    split1(p.x, pxh, pxl);
    split1(p.y, pyh, pyl);
    float p00, e00, p01, e01, p10, e10;
    tp_fast(u.x, uxh, uxl, p.x, pxh, pxl, p00, e00);
    tp_fast(u.x, uxh, uxl, p.y, pyh, pyl, p01, e01);
    tp_fast(u.y, uyh, uyl, p.x, pxh, pxl, p10, e10);
    float t1a, c1a, t1, c1b;
    two_sum(p01, p10, t1a, c1a);
    two_sum(t1a, e00, t1, c1b);
    float t2 = u.x * p.z + u.y * p.y + u.z * p.x + e01 + e10 + c1a + c1b;

    float s0, ce0, s1, ce1, m1, mc1, r0, e_0, r1, r2;
    two_sum(c.x, p00, s0, ce0);
    two_sum(c.y, t1, s1, ce1);
    two_sum(s1, ce0, m1, mc1);
    float m2 = c.z + t2 + ce1 + mc1;
    two_sum(s0, m1, r0, e_0);
    two_sum(e_0, m2, r1, r2);
    return vec4(r0, r1, r2, 0.0);
  }

  vec4 qs_add_mul_presplit4(vec4 c, vec4 u, vec3 uh, vec3 ul, vec4 p) {
    vec3 ph, pl;
    split3(p.xyz, ph, pl);

    float p00, e00, p01, e01, p10, e10;
    tp_fast(u.x, uh.x, ul.x, p.x, ph.x, pl.x, p00, e00);
    tp_fast(u.x, uh.x, ul.x, p.y, ph.y, pl.y, p01, e01);
    tp_fast(u.y, uh.y, ul.y, p.x, ph.x, pl.x, p10, e10);

    float t1a, c1a, t1, c1b;
    two_sum(p01, p10, t1a, c1a);
    two_sum(t1a, e00, t1, c1b);

    float p02, e02, p11, e11, p20, e20;
    tp_fast(u.x, uh.x, ul.x, p.z, ph.z, pl.z, p02, e02);
    tp_fast(u.y, uh.y, ul.y, p.y, ph.y, pl.y, p11, e11);
    tp_fast(u.z, uh.z, ul.z, p.x, ph.x, pl.x, p20, e20);

    float t2a, c2a, t2b, c2b, ec0, err_e1, ec1, err_c1, e1s, c2d, t2, c2c;
    two_sum(p02, p11, t2a, c2a);
    two_sum(t2a, p20, t2b, c2b);
    two_sum(e01, e10, ec0, err_e1);
    two_sum(c1a, c1b, ec1, err_c1);
    two_sum(ec0, ec1, e1s, c2d);
    two_sum(t2b, e1s, t2, c2c);

    float t3 = u.x * p.w + u.y * p.z + u.z * p.y + u.w * p.x + e02 + e11 + e20 + c2a + c2b + c2c + c2d + err_e1 + err_c1;

    float s0, ce0, s1, ce1, s2, ce2, m1, mc1, mce, mce_err, m2, mc2;
    two_sum(c.x, p00, s0, ce0);
    two_sum(c.y, t1, s1, ce1);
    two_sum(c.z, t2, s2, ce2);
    two_sum(s1, ce0, m1, mc1);
    two_sum(mc1, ce1, mce, mce_err);
    two_sum(s2, mce, m2, mc2);
    float m3 = c.w + t3 + ce2 + mc2 + mce_err;
    return qs_renorm_fast(s0, m1, m2, m3);
  }

  vec4 qs_sq_presplit(vec4 a, vec3 ah, vec3 al) {
    float p00, e00, p01, e01, p02, e02, p11, e11;
    tp_fast(a.x, ah.x, al.x, a.x, ah.x, al.x, p00, e00);
    tp_fast(a.x, ah.x, al.x, a.y, ah.y, al.y, p01, e01);
    tp_fast(a.x, ah.x, al.x, a.z, ah.z, al.z, p02, e02);
    tp_fast(a.y, ah.y, al.y, a.y, ah.y, al.y, p11, e11);

    float t1, c1, t2a, c2a, e1s, err_e1, t2, c2b;
    two_sum(2.0 * p01, e00, t1, c1);
    two_sum(2.0 * p02, p11, t2a, c2a);
    two_sum(2.0 * e01, c1, e1s, err_e1);
    two_sum(t2a, e1s, t2, c2b);

    float t3 = 2.0 * (a.x * a.w + a.y * a.z + e02) + e11 + c2a + c2b + err_e1;
    return qs_renorm_fast(p00, t1, t2, t3);
  }

  vec4 qs_sq(vec4 a) {
    vec3 ah, al;
    split3(a.xyz, ah, al);
    return qs_sq_presplit(a, ah, al);
  }

  // Law 64: Fused Single-Renorm Sum-of-Squares & Difference-of-Squares (qs_sum_sq_presplit / qs_diff_sq_presplit)
  vec4 qs_sum_sq_presplit(vec4 a, vec3 ah, vec3 al, vec4 b, vec3 bh, vec3 bl) {
    float a00, ae00, a01, ae01, a02, ae02, a11, ae11;
    tp_fast(a.x, ah.x, al.x, a.x, ah.x, al.x, a00, ae00);
    tp_fast(a.x, ah.x, al.x, a.y, ah.y, al.y, a01, ae01);
    tp_fast(a.x, ah.x, al.x, a.z, ah.z, al.z, a02, ae02);
    tp_fast(a.y, ah.y, al.y, a.y, ah.y, al.y, a11, ae11);

    float b00, be00, b01, be01, b02, be02, b11, be11;
    tp_fast(b.x, bh.x, bl.x, b.x, bh.x, bl.x, b00, be00);
    tp_fast(b.x, bh.x, bl.x, b.y, bh.y, bl.y, b01, be01);
    tp_fast(b.x, bh.x, bl.x, b.z, bh.z, bl.z, b02, be02);
    tp_fast(b.y, bh.y, bl.y, b.y, bh.y, bl.y, b11, be11);

    float s0, e0, u1a, c1a, u1b, c1b, u1c, c1c, t1, c1d;
    two_sum(a00, b00, s0, e0);
    two_sum(2.0 * a01, 2.0 * b01, u1a, c1a);
    two_sum(ae00, be00, u1b, c1b);
    two_sum(u1a, u1b, u1c, c1c);
    two_sum(u1c, e0, t1, c1d);

    float u2a, c2a, u2b, c2b, u2c, c2c, c1s1, ec1s1, c1s2, ec1s2, c1all, ec1all, m2a, em2a, m2b, em2b, t2, em2c;
    two_sum(2.0 * a02, 2.0 * b02, u2a, c2a);
    two_sum(a11, b11, u2b, c2b);
    two_sum(2.0 * ae01, 2.0 * be01, u2c, c2c);
    two_sum(c1a, c1b, c1s1, ec1s1);
    two_sum(c1c, c1d, c1s2, ec1s2);
    two_sum(c1s1, c1s2, c1all, ec1all);
    two_sum(u2a, u2b, m2a, em2a);
    two_sum(u2c, c1all, m2b, em2b);
    two_sum(m2a, m2b, t2, em2c);

    float t3 = 2.0 * (a.x * a.w + a.y * a.z + ae02 + b.x * b.w + b.y * b.z + be02) + ae11 + be11 + c2a + c2b + c2c + ec1s1 + ec1s2 + ec1all + em2a + em2b + em2c;
    return qs_renorm_fast(s0, t1, t2, t3);
  }

  vec4 qs_sum_sq(vec4 a, vec4 b) {
    vec3 ah, al, bh, bl;
    split3(a.xyz, ah, al);
    split3(b.xyz, bh, bl);
    return qs_sum_sq_presplit(a, ah, al, b, bh, bl);
  }

  vec4 qs_diff_sq_presplit(vec4 a, vec3 ah, vec3 al, vec4 b, vec3 bh, vec3 bl) {
    float a00, ae00, a01, ae01, a02, ae02, a11, ae11;
    tp_fast(a.x, ah.x, al.x, a.x, ah.x, al.x, a00, ae00);
    tp_fast(a.x, ah.x, al.x, a.y, ah.y, al.y, a01, ae01);
    tp_fast(a.x, ah.x, al.x, a.z, ah.z, al.z, a02, ae02);
    tp_fast(a.y, ah.y, al.y, a.y, ah.y, al.y, a11, ae11);

    float b00, be00, b01, be01, b02, be02, b11, be11;
    tp_fast(b.x, bh.x, bl.x, b.x, bh.x, bl.x, b00, be00);
    tp_fast(b.x, bh.x, bl.x, b.y, bh.y, bl.y, b01, be01);
    tp_fast(b.x, bh.x, bl.x, b.z, bh.z, bl.z, b02, be02);
    tp_fast(b.y, bh.y, bl.y, b.y, bh.y, bl.y, b11, be11);

    float s0, e0, u1a, c1a, u1b, c1b, u1c, c1c, t1, c1d;
    two_sum(a00, -b00, s0, e0);
    two_sum(2.0 * a01, -2.0 * b01, u1a, c1a);
    two_sum(ae00, -be00, u1b, c1b);
    two_sum(u1a, u1b, u1c, c1c);
    two_sum(u1c, e0, t1, c1d);

    float u2a, c2a, u2b, c2b, u2c, c2c, c1s1, ec1s1, c1s2, ec1s2, c1all, ec1all, m2a, em2a, m2b, em2b, t2, em2c;
    two_sum(2.0 * a02, -2.0 * b02, u2a, c2a);
    two_sum(a11, -b11, u2b, c2b);
    two_sum(2.0 * ae01, -2.0 * be01, u2c, c2c);
    two_sum(c1a, c1b, c1s1, ec1s1);
    two_sum(c1c, c1d, c1s2, ec1s2);
    two_sum(c1s1, c1s2, c1all, ec1all);
    two_sum(u2a, u2b, m2a, em2a);
    two_sum(u2c, c1all, m2b, em2b);
    two_sum(m2a, m2b, t2, em2c);

    float t3 = 2.0 * (a.x * a.w + a.y * a.z + ae02 - b.x * b.w - b.y * b.z - be02) + ae11 - be11 + c2a + c2b + c2c + ec1s1 + ec1s2 + ec1all + em2a + em2b + em2c;
    return qs_renorm_fast(s0, t1, t2, t3);
  }

  vec4 qs_mul_f_presplit(vec4 a, vec3 ah, vec3 al, float b) {
    float bh, bl;
    split1(b, bh, bl);
    float p0, e0, p1, e1, p2, e2;
    tp_fast(a.x, ah.x, al.x, b, bh, bl, p0, e0);
    tp_fast(a.y, ah.y, al.y, b, bh, bl, p1, e1);
    tp_fast(a.z, ah.z, al.z, b, bh, bl, p2, e2);
    float t1, c1, ec1, err_ec1, t2, c2;
    two_sum(p1, e0, t1, c1);
    two_sum(e1, c1, ec1, err_ec1);
    two_sum(p2, ec1, t2, c2);
    float t3 = a.w * b + e2 + c2 + err_ec1;
    return qs_renorm_fast(p0, t1, t2, t3);
  }

  vec4 qs_mul_f(vec4 a, float b) {
    vec3 ah, al;
    split3(a.xyz, ah, al);
    return qs_mul_f_presplit(a, ah, al, b);
  }

  vec4 qs_div(vec4 a, vec4 b) {
    float yn = 1.0 / b.x;
    vec3 bh, bl;
    split3(b.xyz, bh, bl);
    float q0 = a.x * yn;
    float q0h, q0l, p0, e0, p1, e1, p2, e2;
    split1(q0, q0h, q0l);
    tp_fast(b.x, bh.x, bl.x, q0, q0h, q0l, p0, e0);
    tp_fast(b.y, bh.y, bl.y, q0, q0h, q0l, p1, e1);
    tp_fast(b.z, bh.z, bl.z, q0, q0h, q0l, p2, e2);

    float d0 = fence1(a.x - p0);
    float d1, d1e, d2, d2e;
    two_sum(a.y, -p1, d1, d1e);
    two_sum(a.z, -p2, d2, d2e);
    float m1, m1e, m2, m2e, n1, n1e, m2s, m2se, r0a, r1a, r1b, r2a, r0, rt1, r1, r2;
    two_sum(d1, -e0, m1, m1e);
    two_sum(d0, m1, r0a, r1a);
    two_sum(d2, -e1, m2, m2e);
    two_sum(d1e, m1e, n1, n1e);
    two_sum(m2, n1, m2s, m2se);
    two_sum(r1a, m2s, r1b, r2a);
    float r2b = r2a + (a.w - b.w * q0 - e2 + d2e + m2e + n1e + m2se);
    two_sum(r0a, r1b, r0, rt1);
    two_sum(rt1, r2b, r1, r2);

    float q1 = r0 * yn;
    float q1h, q1l, g0, ge0, g1, ge1;
    split1(q1, q1h, q1l);
    tp_fast(b.x, bh.x, bl.x, q1, q1h, q1l, g0, ge0);
    tp_fast(b.y, bh.y, bl.y, q1, q1h, q1l, g1, ge1);
    float h0 = fence1(r0 - g0);
    float s1, s1e, u0, u0e, r1_0a, r1_1a, r1_0, r1_1;
    two_sum(r1, -g1, s1, s1e);
    two_sum(h0, s1, u0, u0e);
    two_sum(u0, -ge0, r1_0a, r1_1a);
    float r1_1b = r1_1a + (r2 - b.z * q1 + s1e - ge1 + u0e);
    two_sum(r1_0a, r1_1b, r1_0, r1_1);

    float q2 = r1_0 * yn;
    float q2h, q2l, m0, me0;
    split1(q2, q2h, q2l);
    tp_fast(b.x, bh.x, bl.x, q2, q2h, q2l, m0, me0);
    float k0 = fence1(r1_0 - m0);
    float r2_top = k0 + (r1_1 - b.y * q2 - me0);
    float q3 = r2_top * yn;
    return qs_renorm_fast(q0, q1, q2, q3);
  }

  vec4 qs_rcp(vec4 b) {
    float yn = 1.0 / b.x;
    vec3 bh, bl;
    split3(b.xyz, bh, bl);
    float q0 = yn;
    float q0h, q0l, p0, e0, p1, e1, p2, e2;
    split1(q0, q0h, q0l);
    tp_fast(b.x, bh.x, bl.x, q0, q0h, q0l, p0, e0);
    tp_fast(b.y, bh.y, bl.y, q0, q0h, q0l, p1, e1);
    tp_fast(b.z, bh.z, bl.z, q0, q0h, q0l, p2, e2);
    float t1, c1, ec1, err_ec1, t2, c2;
    two_sum(p1, e0, t1, c1);
    two_sum(e1, c1, ec1, err_ec1);
    two_sum(p2, ec1, t2, c2);
    float t3 = b.w * q0 + e2 + c2 + err_ec1;

    float d0 = fence1(1.0 - p0);
    float r0a, r1a, r1b, r2a, r0, rt1, r1, r2;
    two_sum(d0, -t1, r0a, r1a);
    two_sum(r1a, -t2, r1b, r2a);
    float r2b = r2a - t3;
    two_sum(r0a, r1b, r0, rt1);
    two_sum(rt1, r2b, r1, r2);

    float q1 = r0 * yn;
    float q1h, q1l, g0, ge0, g1, ge1;
    split1(q1, q1h, q1l);
    tp_fast(b.x, bh.x, bl.x, q1, q1h, q1l, g0, ge0);
    tp_fast(b.y, bh.y, bl.y, q1, q1h, q1l, g1, ge1);
    float h0 = fence1(r0 - g0);
    float s1, s1e, u0, u0e, r1_0a, r1_1a, r1_0, r1_1;
    two_sum(r1, -g1, s1, s1e);
    two_sum(h0, s1, u0, u0e);
    two_sum(u0, -ge0, r1_0a, r1_1a);
    float r1_1b = r1_1a + (r2 - b.z * q1 + s1e - ge1 + u0e);
    two_sum(r1_0a, r1_1b, r1_0, r1_1);

    float q2 = r1_0 * yn;
    float q2h, q2l, m0, me0;
    split1(q2, q2h, q2l);
    tp_fast(b.x, bh.x, bl.x, q2, q2h, q2l, m0, me0);
    float k0 = fence1(r1_0 - m0);
    float r2_top = k0 + (r1_1 - b.y * q2 - me0);
    float q3 = r2_top * yn;
    return qs_renorm_fast(q0, q1, q2, q3);
  }

  // Law 46: V2 Incremental Limb-by-Limb Remainder qs_sqrt (single qs_renorm)
  vec4 qs_sqrt(vec4 a) {
    if (a.x <= 0.0) return vec4(0.0);
    float q0 = sqrt(a.x);
    float inv2q0 = 0.5 / q0;
    float q0h, q0l, p0, e0, d0, d0e;
    split1(q0, q0h, q0l);
    tp_fast(q0, q0h, q0l, q0, q0h, q0l, p0, e0);
    two_sum(a.x, -p0, d0, d0e);
    float u0, u0e, v0, v0e, r0, r1a, r1, r2a;
    two_sum(d0, a.y, u0, u0e);
    two_sum(u0, d0e - e0, r0, r1a);
    two_sum(u0e, a.z, v0, v0e);
    two_sum(r1a, v0, r1, r2a);
    float r2 = r2a + v0e + a.w;

    float q1 = r0 * inv2q0;
    float b0 = 2.0 * q0, b0h = 2.0 * q0h, b0l = 2.0 * q0l;
    float q1h, q1l, m0, me0, s1, se1;
    split1(q1, q1h, q1l);
    tp_fast(b0, b0h, b0l, q1, q1h, q1l, m0, me0);
    tp_fast(q1, q1h, q1l, q1, q1h, q1l, s1, se1);
    float k0, ke0, w0, w0e, n0, n0e, c1, c1e, r1_0, r1_1a;
    two_sum(r0, -m0, k0, ke0);
    two_sum(r1, -me0, w0, w0e);
    two_sum(k0, w0, n0, n0e);
    two_sum(ke0, -s1, c1, c1e);
    two_sum(n0, c1, r1_0, r1_1a);
    float r1_1 = r1_1a + (r2 + n0e + w0e + c1e - se1);

    float q2 = r1_0 * inv2q0;
    float q2h, q2l, g0, ge0, h0, he0;
    split1(q2, q2h, q2l);
    tp_fast(b0, b0h, b0l, q2, q2h, q2l, g0, ge0);
    two_sum(r1_0, -g0, h0, he0);
    float r2_top = h0 + (r1_1 + he0 - ge0 - 2.0 * q1 * q2);
    float q3 = r2_top * inv2q0;
    return qs_renorm_fast(q0, q1, q2, q3);
  }

  vec4 qs_hypot(vec4 x, vec4 y) {
    float m = max(abs(x.x), abs(y.x));
    if (m == 0.0) return vec4(0.0);
    uint expBits = clamp(floatBitsToUint(m) & 0x7F800000u, 0x00800000u, 0x7E800000u);
    float scale = uintBitsToFloat(expBits);
    float invScale = uintBitsToFloat(0x7F000000u - expBits);
    vec4 xs = x * invScale;
    vec4 ys = y * invScale;
    return qs_sqrt(qs_sum_sq(xs, ys)) * scale;
  }

  cqs cds_neg(cqs z)  { return cqs(-z.re, -z.im); }
  cqs cds_conj(cqs z) { return cqs(z.re, -z.im); }
  cqs cds_scale(cqs z, float s) { return cqs(z.re * s, z.im * s); }

  cqs cds_add(cqs a, cqs b) {
    return cqs(qs_add(a.re, b.re), qs_add(a.im, b.im));
  }

  cqs cds_sub(cqs a, cqs b) {
    return cqs(qs_sub(a.re, b.re), qs_sub(a.im, b.im));
  }

  cqs cds_add_f(cqs z, float a) {
    return cqs(qs_add_f(a, z.re), z.im);
  }

  cqs cds_add_re(cqs z, vec4 a) {
    return cqs(qs_add(z.re, a), z.im);
  }

  cqs cds_mul(cqs a, cqs b) {
    vec3 arh, arl, aih, ail, brh, brl, bih, bil;
    split3(a.re.xyz, arh, arl);
    split3(a.im.xyz, aih, ail);
    split3(b.re.xyz, brh, brl);
    split3(b.im.xyz, bih, bil);
    return cqs(
      qs_sub(qs_mul_presplit_both(a.re, arh, arl, b.re, brh, brl), qs_mul_presplit_both(a.im, aih, ail, b.im, bih, bil)),
      qs_add(qs_mul_presplit_both(a.re, arh, arl, b.im, bih, bil), qs_mul_presplit_both(a.im, aih, ail, b.re, brh, brl))
    );
  }

  cqs cds_mul_presplit_lhs(cqs a, vec3 arh, vec3 arl, vec3 aih, vec3 ail, cqs b) {
    vec3 brh, brl, bih, bil;
    split3(b.re.xyz, brh, brl);
    split3(b.im.xyz, bih, bil);
    return cqs(
      qs_sub(qs_mul_presplit_both(a.re, arh, arl, b.re, brh, brl), qs_mul_presplit_both(a.im, aih, ail, b.im, bih, bil)),
      qs_add(qs_mul_presplit_both(a.re, arh, arl, b.im, bih, bil), qs_mul_presplit_both(a.im, aih, ail, b.re, brh, brl))
    );
  }

  cqs cds_sq_presplit(cqs z, vec3 xh, vec3 xl, vec3 yh, vec3 yl) {
    return cqs(
      qs_diff_sq_presplit(z.re, xh, xl, z.im, yh, yl),
      qs_mul_presplit_both(z.re, xh, xl, z.im, yh, yl) * 2.0
    );
  }

  cqs cds_sq(cqs z) {
    vec3 xh, xl, yh, yl;
    split3(z.re.xyz, xh, xl);
    split3(z.im.xyz, yh, yl);
    return cds_sq_presplit(z, xh, xl, yh, yl);
  }

  cqs cds_mul_f(cqs a, float s) {
    return cqs(qs_mul_f(a.re, s), qs_mul_f(a.im, s));
  }

  cqs cds_mul_qs_presplit(cqs a, vec4 s, vec3 sh, vec3 sl) {
    return cqs(qs_mul_presplit_lhs(s, sh, sl, a.re), qs_mul_presplit_lhs(s, sh, sl, a.im));
  }

  cqs cds_mul_qs(cqs a, vec4 s) {
    vec3 sh, sl;
    split3(s.xyz, sh, sl);
    return cds_mul_qs_presplit(a, s, sh, sl);
  }

  // Law 64: Pre-Split Exponent-Scaled Fused Sum-of-Squares Complex Reciprocal & Division
  cqs cds_rcp(cqs b) {
    float m = max(abs(b.re.x), abs(b.im.x));
    if (m == 0.0) return cqs(vec4(1.0 / u_zero, 0.0, 0.0, 0.0), vec4(0.0));
    uint expBits = clamp(floatBitsToUint(m) & 0x7F800000u, 0x00800000u, 0x7E800000u);
    float invScale = uintBitsToFloat(0x7F000000u - expBits);
    vec4 br = b.re * invScale;
    vec4 bi = b.im * invScale;
    vec3 brh, brl, bih, bil, dh, dl;
    split3(br.xyz, brh, brl);
    split3(bi.xyz, bih, bil);
    vec4 invD = qs_rcp(qs_sum_sq_presplit(br, brh, brl, bi, bih, bil)) * invScale;
    split3(invD.xyz, dh, dl);
    return cqs(
      qs_mul_presplit_both(br, brh, brl, invD, dh, dl),
      -qs_mul_presplit_both(bi, bih, bil, invD, dh, dl)
    );
  }

  cqs cds_div(cqs a, cqs b) {
    return cds_mul(a, cds_rcp(b));
  }

  cqs cds_pow_int(cqs z, int n) {
    if (n == 0) return cqs(QS_ONE, vec4(0.0));
    if (n == 1) return z;
    int p = min(abs(n), 64);
    int bitLim = 7 + int(u_zero);
    cqs res = cqs(QS_ONE, vec4(0.0)), base = z;
    for (int bit = 0; bit < bitLim; bit++) {
      if (p <= 0) break;
      if ((p & 1) == 1) res = cds_mul(res, base);
      p >>= 1;
      if (p > 0) base = cds_sq(base);
    }
    if (n < 0) return cds_rcp(res);
    return res;
  }

  cqs cds_sqrt(cqs z) {
    vec4 r = qs_hypot(z.re, z.im);
    if (r.x == 0.0) return cqs(vec4(0.0), vec4(0.0));
    vec4 re = qs_sqrt(qs_add(r, z.re) * 0.5);
    vec4 im = qs_sqrt(qs_sub(r, z.re) * 0.5);
    if (z.im.x < 0.0) im = -im;
    return cqs(re, im);
  }

  cqs cds_mask_radius(cqs val, cqs z, float cx, float cy, float r2) {
    float dx = z.re.x + z.re.y - cx;
    float dy = z.im.x + z.im.y - cy;
    if (dx * dx + dy * dy > r2) return cqs(vec4(0.0 / u_zero), vec4(0.0 / u_zero));
    return val;
  }
`;

export const GLSL_QS_SINCOS = `
  // V2 Single-Branch 1-Doubling qs_sincos (zero multi-branch AST duplication)
  void qs_sincos(vec4 x, out vec4 s, out vec4 c) {
    if (abs(x.x) <= 1.7763568e-15) {
      s = x;
      c = QS_ONE;
      return;
    }
    float k = round(x.x * 0.6366197723675814);
    vec4 r = (k == 0.0) ? x : qs_sub(x, qs_mul_f_presplit(QS_PIO2, QS_PIO2_H, QS_PIO2_L, k));

    const vec4 C_S3  = vec4(-0.1666666716337204, 4.967053731316521e-9, -1.6540909695999414e-16, -5.51363656e-24);
    const vec4 C_S5  = vec4(0.008333333767950535, -4.346172013191982e-10, -7.236773284266308e-18, -2.41225776e-25);
    const vec4 C_S7  = vec4(-1.9841270113829523e-4, 2.7202538808100994e-12, 1.03382475e-19, 1.6626067e-27);
    const vec4 C_S9  = vec4(2.7557318844628753e-6, 3.793571393238459e-14, 2.0273377e-21, -7.4508615e-29);
    const vec4 C_S11 = vec4(-2.505210838544172e-8, -5.527079e-16, 2.8698508e-23, 8.704229e-31);
    const vec4 C_S13 = vec4(1.6059043836821613e-10, 4.3982297e-18, -3.5974616e-26, -1.9467698e-33);
    const vec4 C_S15 = vec4(-7.647163731819816e-13, -2.3587857e-20, 4.0005166e-28, -2.189715e-35);

    vec4 sr, cr;
    if (abs(r.x) <= 1.7763568e-15) {
      sr = r;
      cr = QS_ONE;
    } else {
      vec4 u = r * 0.5;
      vec3 uh, ul, u2h, u2l;
      split3(u.xyz, uh, ul);
      vec4 u2 = qs_sq_presplit(u, uh, ul);
      split3(u2.xyz, u2h, u2l);

      float s17_tail = 2.81145725e-15 + u2.x * (-8.22063525e-18 + 1.9572941e-20 * u2.x);
      float ds15 = C_S15.y + u2.x * s17_tail;
      float s15_0, s15_1;
      two_sum(C_S15.x, ds15, s15_0, s15_1);
      vec4 ps13 = qs_add_mul_tail2_presplit(C_S13, u2, u2h.x, u2l.x, vec4(s15_0, s15_1, 0.0, 0.0));
      vec4 ps11 = qs_add_mul_tail3_presplit(C_S11, u2, u2h.x, u2l.x, u2h.y, u2l.y, ps13);
      vec4 ps9  = qs_add_mul_tail3_presplit(C_S9,  u2, u2h.x, u2l.x, u2h.y, u2l.y, ps11);
      vec4 ps7  = qs_add_mul_tail3_presplit(C_S7,  u2, u2h.x, u2l.x, u2h.y, u2l.y, ps9);
      vec4 ps5  = qs_add_mul_presplit4(C_S5, u2, u2h, u2l, ps7);
      vec4 ps3  = qs_add_mul_presplit4(C_S3, u2, u2h, u2l, ps5);
      vec4 t_poly = qs_mul_presplit_lhs(u2, u2h, u2l, ps3);
      vec4 su   = qs_add(u, qs_mul_presplit_lhs(u, uh, ul, t_poly));

      vec3 suh, sul;
      split3(su.xyz, suh, sul);
      vec4 s2 = qs_sq_presplit(su, suh, sul);
      cr = qs_add_f(1.0, s2 * -2.0);
      vec4 cu = qs_sqrt(qs_add_f(1.0, -s2));
      sr = qs_mul_presplit_lhs(su, suh, sul, cu) * 2.0;
    }

    int q = int(k) & 3;
    if (q == 0)      { s = sr;  c = cr; }
    else if (q == 1) { s = cr;  c = -sr; }
    else if (q == 2) { s = -sr; c = -cr; }
    else             { s = -cr; c = sr; }
  }
`;

export const GLSL_CDS_TRIG_EXP = `
  // V2 Direct Unhalved Hyperbolic Core qs_sinh_cosh_unit (single-branch AST, direct chr)
  void qs_sinh_cosh_unit(vec4 r, out vec4 shr, out vec4 chr) {
    if (abs(r.x) <= 1.7763568e-15) {
      shr = r;
      chr = QS_ONE;
      return;
    }
    const vec4 C_E3  = vec4(0.1666666716337204, -4.967053731316521e-9, 1.6540909695999414e-16, 5.51363656e-24);
    const vec4 C_E5  = vec4(0.008333333767950535, -4.346172013191982e-10, -7.236773284266308e-18, -2.41225776e-25);
    const vec4 C_E7  = vec4(1.9841270113829523e-4, -2.7202538808100994e-12, -1.03382475e-19, -1.6626067e-27);
    const vec4 C_E9  = vec4(2.7557318844628753e-6, 3.793571393238459e-14, 2.0273377e-21, -7.4508615e-29);
    const vec4 C_E11 = vec4(2.505210838544172e-8, 5.527079e-16, -2.8698508e-23, -8.704229e-31);
    const vec4 C_E13 = vec4(1.6059043836821613e-10, 4.3982297e-18, -3.5974616e-26, -1.9467698e-33);
    const vec4 C_E15 = vec4(7.647163731819816e-13, 2.3587857e-20, -4.0005166e-28, 2.189715e-35);

    vec3 rh, rl, r2h, r2l;
    split3(r.xyz, rh, rl);
    vec4 r2 = qs_sq_presplit(r, rh, rl);
    split3(r2.xyz, r2h, r2l);

    float e17_tail = 2.81145725e-15 + r2.x * (8.22063525e-18 + 1.9572941e-20 * r2.x);
    float de15 = C_E15.y + r2.x * e17_tail;
    float e15_0, e15_1;
    two_sum(C_E15.x, de15, e15_0, e15_1);
    vec4 ps13 = qs_add_mul_tail2_presplit(C_E13, r2, r2h.x, r2l.x, vec4(e15_0, e15_1, 0.0, 0.0));
    vec4 ps11 = qs_add_mul_tail3_presplit(C_E11, r2, r2h.x, r2l.x, r2h.y, r2l.y, ps13);
    vec4 ps9  = qs_add_mul_tail3_presplit(C_E9,  r2, r2h.x, r2l.x, r2h.y, r2l.y, ps11);
    vec4 ps7  = qs_add_mul_tail3_presplit(C_E7,  r2, r2h.x, r2l.x, r2h.y, r2l.y, ps9);
    vec4 ps5  = qs_add_mul_presplit4(C_E5, r2, r2h, r2l, ps7);
    vec4 ps3  = qs_add_mul_presplit4(C_E3, r2, r2h, r2l, ps5);
    vec4 t_poly = qs_mul_presplit_lhs(r2, r2h, r2l, ps3);
    shr = qs_add(r, qs_mul_presplit_lhs(r, rh, rl, t_poly));
    chr = qs_sqrt(qs_add_f(1.0, qs_sq(shr)));
  }

  vec4 qs_exp(vec4 x) {
    if (x.x == 0.0) return QS_ONE;
    if (x.x > 88.0) return vec4(3.402823e38, 0.0, 0.0, 0.0);
    if (x.x < -87.0) return vec4(0.0);
    float k = clamp(round(x.x * 1.4426950408889634), -125.0, 125.0);
    vec4 r = (k == 0.0) ? x : qs_sub(x, qs_mul_f_presplit(QS_LN2, QS_LN2_H, QS_LN2_L, k));
    vec4 shr, chr;
    qs_sinh_cosh_unit(r, shr, chr);
    return qs_add(chr, shr) * exp2(k);
  }

  // V2 Division-Free qs_sinh_cosh with direct chr (Law 64)
  void qs_sinh_cosh(vec4 x, out vec4 sh, out vec4 ch) {
    if (abs(x.x) <= 1.7763568e-15) {
      sh = x;
      ch = QS_ONE;
      return;
    }
    float k = clamp(round(x.x * 1.4426950408889634), -125.0, 125.0);
    vec4 r = (k == 0.0) ? x : qs_sub(x, qs_mul_f_presplit(QS_LN2, QS_LN2_H, QS_LN2_L, k));
    vec4 shr, chr;
    qs_sinh_cosh_unit(r, shr, chr);
    if (k == 0.0) {
      sh = shr;
      ch = chr;
    } else {
      vec4 ep, em;
      qs_add_sub(chr, shr, ep, em);
      ep *= exp2(k);
      em *= exp2(-k);
      vec4 s2, d2;
      qs_add_sub(ep, em, s2, d2);
      sh = d2 * 0.5;
      ch = s2 * 0.5;
    }
  }

  cqs cds_exp(cqs z) {
    vec4 r = qs_exp(z.re);
    vec4 sy, cy;
    qs_sincos(z.im, sy, cy);
    vec3 rh, rl;
    split3(r.xyz, rh, rl);
    return cqs(qs_mul_presplit_lhs(r, rh, rl, cy), qs_mul_presplit_lhs(r, rh, rl, sy));
  }

  cqs cds_sin(cqs z) {
    vec4 sx, cx, shy, chy;
    qs_sincos(z.re, sx, cx);
    qs_sinh_cosh(z.im, shy, chy);
    return cqs(qs_mul(sx, chy), qs_mul(cx, shy));
  }

  cqs cds_cos(cqs z) {
    vec4 sx, cx, shy, chy;
    qs_sincos(z.re, sx, cx);
    qs_sinh_cosh(z.im, shy, chy);
    return cqs(qs_mul(cx, chy), -qs_mul(sx, shy));
  }

  // Law 49 & Law 64: Direct Fused Sum-of-Squares Single-Pass cds_sec (cos^2(x) + sinh^2(y))
  cqs cds_sec(cqs z) {
    if (abs(z.im.x) > 85.0) {
      return cqs(vec4(0.0), vec4(0.0));
    }
    vec4 sx, cx, shy, chy;
    qs_sincos(z.re, sx, cx);
    qs_sinh_cosh(z.im, shy, chy);
    float m = max(abs(cx.x), abs(shy.x));
    if (m == 0.0) return cqs(vec4(1.0 / u_zero, 0.0, 0.0, 0.0), vec4(0.0));
    uint expBits = clamp(floatBitsToUint(m) & 0x7F800000u, 0x00800000u, 0x7E800000u);
    float invScale = uintBitsToFloat(0x7F000000u - expBits);
    vec4 cxs = cx * invScale;
    vec4 shys = shy * invScale;
    vec3 cxsh, cxsl, shysh, shysl, dh, dl;
    split3(cxs.xyz, cxsh, cxsl);
    split3(shys.xyz, shysh, shysl);
    vec4 invD = qs_rcp(qs_sum_sq_presplit(cxs, cxsh, cxsl, shys, shysh, shysl)) * invScale;
    split3(invD.xyz, dh, dl);
    vec4 cxsInvD = qs_mul_presplit_both(cxs, cxsh, cxsl, invD, dh, dl);
    vec4 shysInvD = qs_mul_presplit_both(shys, shysh, shysl, invD, dh, dl);
    return cqs(qs_mul(chy, cxsInvD), qs_mul(sx, shysInvD));
  }

  // Law 64: V2 Pre-Split Pole-Exact Fused Sum-of-Squares Single-Pass cds_tan
  cqs cds_tan(cqs z) {
    if (abs(z.im.x) > 28.0) {
      return cqs(vec4(0.0), vec4(sign(z.im.x), 0.0, 0.0, 0.0));
    }
    vec4 sx, cx, shy, chy;
    qs_sincos(z.re, sx, cx);
    qs_sinh_cosh(z.im, shy, chy);
    float m = max(abs(cx.x), abs(shy.x));
    if (m == 0.0) return cqs(vec4(1.0 / u_zero, 0.0, 0.0, 0.0), vec4(0.0));
    uint expBits = clamp(floatBitsToUint(m) & 0x7F800000u, 0x00800000u, 0x7E800000u);
    float invScale = uintBitsToFloat(0x7F000000u - expBits);
    vec4 cxs = cx * invScale;
    vec4 shys = shy * invScale;
    vec3 cxsh, cxsl, shysh, shysl, dh, dl;
    split3(cxs.xyz, cxsh, cxsl);
    split3(shys.xyz, shysh, shysl);
    vec4 invD = qs_rcp(qs_sum_sq_presplit(cxs, cxsh, cxsl, shys, shysh, shysl)) * invScale;
    split3(invD.xyz, dh, dl);
    vec4 cxsInvD = qs_mul_presplit_both(cxs, cxsh, cxsl, invD, dh, dl);
    vec4 shysInvD = qs_mul_presplit_both(shys, shysh, shysl, invD, dh, dl);
    return cqs(qs_mul(sx, cxsInvD), qs_mul(chy, shysInvD));
  }

  cqs cds_sinh(cqs z) {
    cqs w = cds_sin(cqs(-z.im, z.re));
    return cqs(w.im, -w.re);
  }

  cqs cds_cosh(cqs z) {
    return cds_cos(cqs(-z.im, z.re));
  }

  cqs cds_tanh(cqs z) {
    if (abs(z.re.x) > 28.0) {
      return cqs(vec4(sign(z.re.x), 0.0, 0.0, 0.0), vec4(0.0));
    }
    cqs w = cds_tan(cqs(-z.im, z.re));
    return cqs(w.im, -w.re);
  }
`;

export const GLSL_CDS_LN_POW = `
  // Fast Unhalved Scalar-Seeded qs_exp_scalar for qs_ln (seed has limbs 1..3 == 0, |r0| <= 0.3466)
  vec4 qs_exp_scalar(float r0) {
    if (r0 == 0.0) return QS_ONE;
    float r0h, r0l, p0, e0, e0h, e0l;
    split1(r0, r0h, r0l);
    tp_fast(r0, r0h, r0l, r0, r0h, r0l, p0, e0);
    split1(e0, e0h, e0l);
    vec4 r2 = vec4(p0, e0, 0.0, 0.0);
    vec3 r2h = vec3(0.0, e0h, 0.0);
    vec3 r2l = vec3(0.0, e0l, 0.0);
    split1(p0, r2h.x, r2l.x);

    const vec4 C_E3  = vec4(0.1666666716337204, -4.967053731316521e-9, 1.6540909695999414e-16, 5.51363656e-24);
    const vec4 C_E5  = vec4(0.008333333767950535, -4.346172013191982e-10, -7.236773284266308e-18, -2.41225776e-25);
    const vec4 C_E7  = vec4(1.9841270113829523e-4, -2.7202538808100994e-12, -1.03382475e-19, -1.6626067e-27);
    const vec4 C_E9  = vec4(2.7557318844628753e-6, 3.793571393238459e-14, 2.0273377e-21, -7.4508615e-29);
    const vec4 C_E11 = vec4(2.505210838544172e-8, 5.527079e-16, -2.8698508e-23, -8.704229e-31);
    const vec4 C_E13 = vec4(1.6059043836821613e-10, 4.3982297e-18, -3.5974616e-26, -1.9467698e-33);
    const vec4 C_E15 = vec4(7.647163731819816e-13, 2.3587857e-20, -4.0005166e-28, 2.189715e-35);

    float e17_tail = 2.81145725e-15 + p0 * (8.22063525e-18 + 1.9572941e-20 * p0);
    float de15 = C_E15.y + p0 * e17_tail;
    float e15_0, e15_1;
    two_sum(C_E15.x, de15, e15_0, e15_1);
    vec4 ps13 = qs_add_mul_tail2_presplit(C_E13, r2, r2h.x, r2l.x, vec4(e15_0, e15_1, 0.0, 0.0));
    vec4 ps11 = qs_add_mul_tail3_presplit(C_E11, r2, r2h.x, r2l.x, r2h.y, r2l.y, ps13);
    vec4 ps9  = qs_add_mul_tail3_presplit(C_E9,  r2, r2h.x, r2l.x, r2h.y, r2l.y, ps11);
    vec4 ps7  = qs_add_mul_tail3_presplit(C_E7,  r2, r2h.x, r2l.x, r2h.y, r2l.y, ps9);
    vec4 ps5  = qs_add_mul_presplit4(C_E5, r2, r2h, r2l, ps7);
    vec4 ps3  = qs_add_mul_presplit4(C_E3, r2, r2h, r2l, ps5);
    vec4 t_poly = qs_mul_presplit_lhs(r2, r2h, r2l, ps3);
    vec4 shr = qs_add_f(r0, qs_mul_f(t_poly, r0));
    vec4 chr = qs_sqrt(qs_add_f(1.0, qs_sq(shr)));
    return qs_add(chr, shr);
  }

  // V2 Division-Free Scalar-Seeded 95-Bit qs_ln
  vec4 qs_ln(vec4 x) {
    if (x.x <= 0.0) return vec4(-1.0 / u_zero, 0.0, 0.0, 0.0);
    uint bits = floatBitsToUint(x.x);
    int exp2 = int((bits >> 23u) & 0xFFu) - 127;
    uint mantBits = (bits & 0x007FFFFFu) | 0x3F800000u;
    float mScale = uintBitsToFloat(uint(clamp(127 - exp2, 1, 254)) << 23u);
    if (uintBitsToFloat(mantBits) > 1.41421356) {
      exp2 += 1;
      mScale *= 0.5;
    }
    vec4 m = x * mScale;
    float y0 = log(m.x);
    if (y0 == 0.0 && m.y == 0.0 && m.z == 0.0 && m.w == 0.0) {
      return (exp2 == 0) ? vec4(0.0) : qs_mul_f_presplit(QS_LN2, QS_LN2_H, QS_LN2_L, float(exp2));
    }
    vec4 em = qs_exp_scalar(-y0);
    vec4 w = qs_add_f(-1.0, qs_mul(m, em));
    float w0h, w0l, p0, e0;
    split1(w.x, w0h, w0l);
    tp_fast(w.x, w0h, w0l, w.x, w0h, w0l, p0, e0);
    float c3 = w.x * p0 * 0.3333333432674408;
    float t1, t1e, w2_1, w2_2;
    two_sum(-0.5 * e0, -w.x * w.y, t1, t1e);
    two_sum(t1, c3, w2_1, w2_2);
    vec4 corr = qs_add(w, vec4(-0.5 * p0, w2_1, w2_2 + t1e - w.x * w.z - 0.5 * w.y * w.y, 0.0));
    vec4 lnM = qs_add_f(y0, corr);
    return (exp2 == 0) ? lnM : qs_add(lnM, qs_mul_f_presplit(QS_LN2, QS_LN2_H, QS_LN2_L, float(exp2)));
  }

  // V2 Fast Pre-Split 3-Limb Residual qs_atan2 (Knuth two_sum invariant)
  vec4 qs_atan2(vec4 y, vec4 x) {
    if (y.x == 0.0) return (x.x >= 0.0) ? vec4(0.0) : QS_PI;
    if (x.x == 0.0) return (y.x > 0.0) ? QS_PIO2 : -QS_PIO2;
    float m = max(abs(x.x), abs(y.x));
    uint expBits = clamp(floatBitsToUint(m) & 0x7F800000u, 0x00800000u, 0x7E800000u);
    float invScale = uintBitsToFloat(0x7F000000u - expBits);
    vec4 xs = x * invScale;
    vec4 ys = y * invScale;
    float a0 = atan(ys.x, xs.x);
    vec4 s0, c0;
    qs_sincos(vec4(a0, 0.0, 0.0, 0.0), s0, c0);
    vec3 xsh, xsl, ysh, ysl, s0h, s0l, c0h, c0l;
    split3(xs.xyz, xsh, xsl);
    split3(ys.xyz, ysh, ysl);
    split3(s0.xyz, s0h, s0l);
    split3(c0.xyz, c0h, c0l);
    vec4 u = qs_sub(qs_mul_presplit_both(ys, ysh, ysl, c0, c0h, c0l), qs_mul_presplit_both(xs, xsh, xsl, s0, s0h, s0l));
    vec4 v = qs_add(qs_mul_presplit_both(xs, xsh, xsl, c0, c0h, c0l), qs_mul_presplit_both(ys, ysh, ysl, s0, s0h, s0l));

    float yn = 1.0 / v.x;
    float v0h, v0l, v1h, v1l, q0h, q0l, p0, e0, p1, e1;
    split1(v.x, v0h, v0l);
    split1(v.y, v1h, v1l);
    float q0 = u.x * yn;
    split1(q0, q0h, q0l);
    tp_fast(v.x, v0h, v0l, q0, q0h, q0l, p0, e0);
    tp_fast(v.y, v1h, v1l, q0, q0h, q0l, p1, e1);
    float d0, d0e, s1, s1e, u0, u0e, v1, v1e, w1, w1e, r1_0, r1_1a;
    two_sum(u.x, -p0, d0, d0e);
    two_sum(u.y, -p1, s1, s1e);
    two_sum(d0, s1, u0, u0e);
    two_sum(d0e, -e0, v1, v1e);
    two_sum(u0e, v1, w1, w1e);
    two_sum(u0, w1, r1_0, r1_1a);
    float r1_1 = r1_1a + (u.z - v.z * q0 + s1e - e1 + v1e + w1e);

    float q1 = r1_0 * yn;
    float q1h, q1l, m0, me0, k0, ke0;
    split1(q1, q1h, q1l);
    tp_fast(v.x, v0h, v0l, q1, q1h, q1l, m0, me0);
    two_sum(r1_0, -m0, k0, ke0);
    float r2_top = k0 + (r1_1 - v.y * q1 + ke0 - me0);
    float t3 = q0 * q0 * q0 * 0.33333334;
    float q2 = (r2_top * yn) - t3;
    vec4 corr = qs_renorm_fast(q0, q1, q2, 0.0);
    return qs_add_f(a0, corr);
  }

  // V2 Direct Half-Log Fused Norm-Squared cds_ln (eliminates qs_sqrt from cds_ln, Law 64)
  cqs cds_ln(cqs z) {
    float m = max(abs(z.re.x), abs(z.im.x));
    if (m == 0.0) return cqs(vec4(-1.0 / u_zero, 0.0, 0.0, 0.0), vec4(0.0));
    uint expBits = clamp(floatBitsToUint(m) & 0x7F800000u, 0x00800000u, 0x7E800000u);
    int exp2 = int((expBits >> 23u) & 0xFFu) - 127;
    float invScale = uintBitsToFloat(0x7F000000u - expBits);
    vec4 xs = z.re * invScale;
    vec4 ys = z.im * invScale;
    vec4 norm2 = qs_sum_sq(xs, ys);
    vec4 lnNorm = qs_add(qs_ln(norm2) * 0.5, qs_mul_f_presplit(QS_LN2, QS_LN2_H, QS_LN2_L, float(exp2)));
    return cqs(lnNorm, qs_atan2(z.im, z.re));
  }

  cqs cds_ln_branch(cqs z, float branchAngle) {
    cqs w = cds_ln(z);
    float arg = w.im.x;
    float shift = 0.0;
    if (arg > branchAngle) {
      shift = -ceil((arg - branchAngle) / TAU);
    } else if (arg <= branchAngle - TAU) {
      shift = floor((branchAngle - arg) / TAU);
    }
    if (shift != 0.0) {
      w.im = qs_add(w.im, qs_mul_f(QS_TAU, shift));
    }
    return w;
  }

  cqs cds_asin(cqs z) {
    cqs root = cds_sqrt(cds_sub(cqs(QS_ONE, vec4(0.0)), cds_sq(z)));
    cqs lg = cds_ln(cqs(qs_sub(root.re, z.im), qs_add(root.im, z.re)));
    return cqs(lg.im, -lg.re);
  }

  // Law 66: Single-Log Fused Half-Angle cds_atan (cuts inlined qs_ln and qs_atan2 calls from 2 to 1)
  cqs cds_atan(cqs z) {
    vec4 x2 = qs_sq(z.re);
    vec4 y2 = qs_sq(z.im);
    vec4 ypo = qs_add_f(1.0, z.im);
    vec4 ymo = qs_add_f(1.0, -z.im);
    vec4 dp = qs_add(qs_sq(ypo), x2);
    vec4 dm = qs_add(qs_sq(ymo), x2);
    vec4 re = qs_atan2(z.re * -2.0, qs_sub(qs_add_f(1.0, -y2), x2)) * -0.5;
    vec4 im = qs_ln(qs_div(dp, dm)) * 0.25;
    return cqs(re, im);
  }

  // Law 66: 96-Bit 4-Limb Complex Logarithm, Exponential & Modulo-1 Reflection Sine Helpers
  cqs cds_ln_fast(cqs z) {
    return cds_ln(z);
  }

  cqs cds_exp_fast(cqs z) {
    return cds_exp(z);
  }

  cqs cds_sin_pi_fast(cqs z) {
    float k = round(z.re.x);
    float parity = (abs(k) < 16777216.0 && mod(abs(k), 2.0) == 1.0) ? -1.0 : 1.0;
    vec4 x_red = qs_add_f(-k, z.re);
    vec4 px = qs_mul_presplit_lhs(QS_PI, QS_PI_H, QS_PI_L, x_red);
    vec4 py = qs_mul_presplit_lhs(QS_PI, QS_PI_H, QS_PI_L, z.im);
    vec4 sx, cx, shy, chy;
    qs_sincos(px, sx, cx);
    qs_sinh_cosh(py, shy, chy);
    return cqs(qs_mul(sx, chy) * parity, qs_mul(cx, shy) * parity);
  }
`;

export const GLSL_CDS_POW_FN = `
  cqs cds_pow(cqs z, cqs w) {
    if (z.re.x == 0.0 && z.im.x == 0.0) {
      if (w.re.x > 0.0) return cqs(vec4(0.0), vec4(0.0));
      if (w.re.x == 0.0 && w.im.x == 0.0) return cqs(QS_ONE, vec4(0.0));
      return cqs(vec4(1.0 / u_zero, 0.0, 0.0, 0.0), vec4(0.0));
    }
    return cds_exp(cds_mul(w, cds_ln(z)));
  }
`;

export const GLSL_CDS_LOGGAMMA_CORE = `
  const vec4 QS_HALF_LN2PI_G = vec4(0.9189385175704956, 1.563136243269908e-8, -7.59732863278564e-16, 0.0);
  const vec4 QS_LNPI_G = vec4(1.1447298526763916, 3.3167379188546396e-8, -1.542566595456794e-15, 0.0);
  const float LANCZOS_C[8] = float[8](
    676.5203857421875,
    -1259.13916015625,
    771.3234252929688,
    -176.6150360107422,
    12.507343292236328,
    -0.138571098446846,
    9.984369514859281e-6,
    1.5056327154708997e-7
  );

  // Law 65 & Law 66: Unified Single-Branch 96-Bit Lanczos LogGamma Core (Hoisted Im^2 & Unroll-Guarded Loop)
  cqs cds_loggamma_rhp(cqs z) {
    vec4 im2 = qs_sq(z.im);
    vec4 sumRe = QS_ONE;
    vec4 sumW = vec4(0.0);
    int kLim = 8 + int(u_zero);
    for (int k = 0; k < kLim; k++) {
      vec4 dx = qs_add_f(float(k), z.re);
      vec4 d2 = qs_add(qs_sq(dx), im2);
      vec4 w = qs_mul_f(qs_rcp(d2), LANCZOS_C[k]);
      sumRe = qs_add(sumRe, qs_mul(w, dx));
      sumW = qs_add(sumW, w);
    }
    vec4 sumIm = -qs_mul(z.im, sumW);
    cqs t = cds_add_f(z, 6.5);
    cqs log_t = cds_ln_fast(t);
    cqs log_sum = cds_ln_fast(cqs(sumRe, sumIm));
    cqs product = cds_mul(cds_add_f(z, -0.5), log_t);
    return cds_add(cds_sub(cds_add_re(product, QS_HALF_LN2PI_G), t), log_sum);
  }

  cqs cds_loggamma(cqs z) {
    bool reflect = (z.re.x < 0.5);
    cqs z_eval;
    if (reflect) {
      z_eval = cds_add_f(cds_neg(z), 1.0);
    } else {
      z_eval = z;
    }
    cqs lg_rhp = cds_loggamma_rhp(z_eval);
    if (!reflect) return lg_rhp;
    cqs sine_log = cds_ln_fast(cds_sin_pi_fast(z));
    return cqs(qs_sub(qs_sub(QS_LNPI_G, sine_log.re), lg_rhp.re), -qs_add(sine_log.im, lg_rhp.im));
  }
`;

export const GLSL_CDS_GAMMA_FN = `
  cqs cds_gamma(cqs z) {
    bool reflect = (z.re.x < 0.5);
    cqs z_eval;
    if (reflect) {
      z_eval = cds_add_f(cds_neg(z), 1.0);
    } else {
      z_eval = z;
    }
    cqs g_rhp = cds_exp_fast(cds_loggamma_rhp(z_eval));
    if (!reflect) return g_rhp;
    cqs sine = cds_sin_pi_fast(z);
    return cds_div(cqs(QS_PI, vec4(0.0)), cds_mul(sine, g_rhp));
  }
`;

export const GLSL_CDS_BESSEL_FN = `
  // Law 66: Pre-Split 96-Bit Bessel J_nu(z) with Order-Zero Fast-Path & Unroll-Guarded Loop
  cqs cds_bessel(cqs z, cqs order) {
    float signFactor = 1.0;
    cqs nu = order;
    if (abs(nu.im.x) < 1e-14 && floor(nu.re.x) == nu.re.x && nu.re.x < 0.0) {
      if (mod(abs(nu.re.x), 2.0) != 0.0) signFactor = -1.0;
      nu = cds_neg(nu);
    }
    if (z.re.x == 0.0 && z.im.x == 0.0) {
      if (nu.re.x == 0.0 && nu.im.x == 0.0) return cqs(QS_ONE * signFactor, vec4(0.0));
      if (nu.re.x > 0.0) return cqs(vec4(0.0), vec4(0.0));
      return cqs(vec4(1.0 / u_zero, 0.0, 0.0, 0.0), vec4(0.0));
    }
    cqs term;
    if (nu.re.x == 0.0 && nu.im.x == 0.0 && nu.re.y == 0.0 && nu.im.y == 0.0) {
      term = cqs(QS_ONE, vec4(0.0));
    } else {
      cqs half_log = cds_ln_fast(cds_scale(z, 0.5));
      cqs lg = cds_loggamma(cds_add_f(nu, 1.0));
      term = cds_exp_fast(cds_sub(cds_mul(nu, half_log), lg));
    }
    cqs sum = term;
    cqs step = cds_scale(cds_neg(cds_sq(z)), 0.25);
    vec3 srh, srl, sih, sil;
    split3(step.re.xyz, srh, srl);
    split3(step.im.xyz, sih, sil);
    bool realOrder = (nu.im.x == 0.0 && nu.im.y == 0.0 && nu.im.z == 0.0 && nu.im.w == 0.0);
    int kLim = 28 + int(u_zero);
    for (int k = 0; k < kLim; k++) {
      float k1 = float(k + 1);
      term = cds_mul_presplit_lhs(step, srh, srl, sih, sil, term);
      if (realOrder) {
        vec4 denom = qs_mul_f(qs_add_f(k1, nu.re), k1);
        vec4 invD = qs_rcp(denom);
        vec3 dh, dl;
        split3(invD.xyz, dh, dl);
        term = cqs(qs_mul_presplit_lhs(invD, dh, dl, term.re), qs_mul_presplit_lhs(invD, dh, dl, term.im));
      } else {
        cqs denom = cds_mul_f(cds_add_f(nu, k1), k1);
        term = cds_div(term, denom);
      }
      sum = cds_add(sum, term);
      float tm = max(abs(term.re.x), abs(term.im.x));
      float sm = max(1.0, max(abs(sum.re.x), abs(sum.im.x)));
      if (tm <= 1e-29 * sm) break;
    }
    return cds_scale(sum, signFactor);
  }
`;

export const GLSL_CDS_GAMMA_BESSEL = `${GLSL_CDS_LOGGAMMA_CORE}\n${GLSL_CDS_GAMMA_FN}\n${GLSL_CDS_BESSEL_FN}`;

export const GLSL_CDS_ZETA_PRIME_POW = `
  cqs cds_prime_pow_presplit(cqs neg_s, vec3 nrh, vec3 nrl, vec3 nih, vec3 nil, vec4 ln_p, vec3 lph, vec3 lpl) {
    vec4 re = qs_mul_presplit_both(neg_s.re, nrh, nrl, ln_p, lph, lpl);
    vec4 im = qs_mul_presplit_both(neg_s.im, nih, nil, ln_p, lph, lpl);
    return cds_exp_fast(cqs(re, im));
  }
`;

export const GLSL_CDS_ZETA_BASE = `
  // Law 52: Pre-Split t2 Reuse across Composite Terms t4 = t2^2, t6 = t2*t3, t8 = t2*t4
  cqs cds_zeta(cqs s) {
    cqs neg_s = cds_neg(s);
    vec3 nrh, nrl, nih, nil, t2rh, t2rl, t2ih, t2il;
    split3(neg_s.re.xyz, nrh, nrl);
    split3(neg_s.im.xyz, nih, nil);
    cqs t2 = cds_prime_pow_presplit(neg_s, nrh, nrl, nih, nil, QS_LN2, QS_LN2_H, QS_LN2_L);
    split3(t2.re.xyz, t2rh, t2rl);
    split3(t2.im.xyz, t2ih, t2il);
    cqs t3 = cds_prime_pow_presplit(neg_s, nrh, nrl, nih, nil, QS_LN3, QS_LN3_H, QS_LN3_L);
    cqs t4 = cds_sq_presplit(t2, t2rh, t2rl, t2ih, t2il);
    cqs t5 = cds_prime_pow_presplit(neg_s, nrh, nrl, nih, nil, QS_LN5, QS_LN5_H, QS_LN5_L);
    cqs t6 = cds_mul_presplit_lhs(t2, t2rh, t2rl, t2ih, t2il, t3);
    cqs t7 = cds_prime_pow_presplit(neg_s, nrh, nrl, nih, nil, QS_LN7, QS_LN7_H, QS_LN7_L);
    cqs t8 = cds_mul_presplit_lhs(t2, t2rh, t2rl, t2ih, t2il, t4);

    cqs sum = cds_add_f(cds_add(cds_add(t2, t3), cds_add(cds_add(t4, t5), cds_add(t6, cds_add(t7, t8)))), 1.0);
    cqs n1s = cds_scale(t8, 8.0);
    cqs tail = cds_div(n1s, cds_add_f(s, -1.0));
    return cds_sub(cds_add(sum, tail), cds_scale(n1s, 0.0625));
  }
`;

export const GLSL_CDS_ZETA_AC = `
  cqs cds_zeta_rhp(cqs s) {
    cqs neg_s = cds_neg(s);
    vec3 nrh, nrl, nih, nil, t2rh, t2rl, t2ih, t2il;
    split3(neg_s.re.xyz, nrh, nrl);
    split3(neg_s.im.xyz, nih, nil);
    cqs t2 = cds_prime_pow_presplit(neg_s, nrh, nrl, nih, nil, QS_LN2, QS_LN2_H, QS_LN2_L);
    split3(t2.re.xyz, t2rh, t2rl);
    split3(t2.im.xyz, t2ih, t2il);
    cqs t3 = cds_prime_pow_presplit(neg_s, nrh, nrl, nih, nil, QS_LN3, QS_LN3_H, QS_LN3_L);
    cqs t4 = cds_sq_presplit(t2, t2rh, t2rl, t2ih, t2il);
    cqs t5 = cds_prime_pow_presplit(neg_s, nrh, nrl, nih, nil, QS_LN5, QS_LN5_H, QS_LN5_L);
    cqs t6 = cds_mul_presplit_lhs(t2, t2rh, t2rl, t2ih, t2il, t3);
    cqs t7 = cds_prime_pow_presplit(neg_s, nrh, nrl, nih, nil, QS_LN7, QS_LN7_H, QS_LN7_L);
    cqs t8 = cds_mul_presplit_lhs(t2, t2rh, t2rl, t2ih, t2il, t4);

    cqs eta = cds_add_f(cds_mul_f(t2, BORWEIN_W[1]), BORWEIN_W[0]);
    eta = cds_add(eta, cds_mul_f(t3, BORWEIN_W[2]));
    eta = cds_add(eta, cds_mul_f(t4, BORWEIN_W[3]));
    eta = cds_add(eta, cds_mul_f(t5, BORWEIN_W[4]));
    eta = cds_add(eta, cds_mul_f(t6, BORWEIN_W[5]));
    eta = cds_add(eta, cds_mul_f(t7, BORWEIN_W[6]));
    eta = cds_add(eta, cds_scale(t8, BORWEIN_W[7]));

    cqs denom = cds_add_f(cds_scale(t2, -2.0), 1.0);
    return cds_div(eta, denom);
  }

  // Law 65 & Law 66: Unified Single-Branch 96-Bit cds_zeta_ac with 4-Limb Stirling Reflection
  cqs cds_zeta_ac(cqs s) {
    bool reflect = (s.re.x < 0.45);
    cqs oms = cds_add_f(cds_neg(s), 1.0);
    cqs s_eval;
    if (reflect) {
      s_eval = oms;
    } else {
      s_eval = s;
    }
    cqs z_rhp = cds_zeta_rhp(s_eval);
    if (!reflect) return z_rhp;

    cqs zs = cds_add_f(oms, 4.0);
    cqs invZs = cds_rcp(zs);
    cqs invZs2 = cds_sq(invZs);
    const vec4 QS_HALF_LN2PI = vec4(0.9189385175704956, 1.563136243269908e-8, -7.59732863278564e-16, 0.0);
    const vec4 QS_INV12 = vec4(0.0833333358168602, -2.4835268656582607e-9, 8.270454847999707e-17, 2.75681828e-24);
    const vec4 QS_INV360 = vec4(0.0027777778450399637, -6.726218534625204e-11, -1.07855606e-18, 0.0);
    cqs stirling = cds_add_re(cds_mul(invZs, cds_add_re(cds_mul_qs(invZs2, -QS_INV360), QS_INV12)), QS_HALF_LN2PI);

    cqs logG = cds_add(
      cds_sub(cds_mul(cds_add_f(zs, -0.5), cds_ln_fast(zs)), zs),
      stirling
    );
    cqs combinedExp = cds_exp_fast(cds_add(cds_add_re(cds_mul_qs_presplit(cds_neg(oms), QS_LN2PI, QS_LN2PI_H, QS_LN2PI_L), QS_LN2), logG));

    // Euler quartic identity: oms*(oms+1)*(oms+2)*(oms+3) = (oms^2 + 3*oms + 1)^2 - 1
    cqs q = cds_add_f(cds_add(cds_sq(oms), cds_mul_f(oms, 3.0)), 1.0);
    cqs p = cds_add_f(cds_sq(q), -1.0);
    cqs sinHalfPiS = cds_sin_pi_fast(cds_scale(s, 0.5));
    return cds_mul(cds_div(combinedExp, p), cds_mul(sinHalfPiS, z_rhp));
  }
`;

export const GLSL_CDS_ZETA = `${GLSL_CDS_ZETA_PRIME_POW}\n${GLSL_CDS_ZETA_BASE}\n${GLSL_CDS_ZETA_AC}`;

export const GLSL_CDS_CHAIN_MACRO = `
  // Law 47: Collapsed Unary Chain Loop Evaluators with Fixed-Point / Cycle-2 / NaN Early Exit (Single-Inlined OP)
  #define DEFINE_CDS_CHAIN(NAME, OP) \\
  cqs NAME(cqs z, int n) { \\
    if (n <= 0) return z; \\
    int lim = min(n, 128); \\
    cqs w = z; \\
    cqs prev = cqs(vec4(1e38), vec4(1e38)); \\
    for (int i = 0; i < lim; i++) { \\
      if (cds_invalid(w)) break; \\
      cqs wn = OP(w); \\
      if (wn.re == w.re && wn.im == w.im) { w = wn; break; } \\
      if (wn.re == prev.re && wn.im == prev.im) { \\
        if (((lim - 1 - i) & 1) == 0) w = wn; \\
        break; \\
      } \\
      prev = w; \\
      w = wn; \\
    } \\
    return w; \\
  }

  cqs cds_conj_chain(cqs z, int n) {
    if ((n & 1) == 1) return cds_conj(z);
    return z;
  }
`;

export const CHAINABLE_OPS = [
    'cds_sin',
    'cds_cos',
    'cds_tan',
    'cds_sec',
    'cds_sinh',
    'cds_cosh',
    'cds_tanh',
    'cds_exp',
    'cds_ln',
    'cds_asin',
    'cds_atan',
    'cds_gamma',
    'cds_loggamma',
    'cds_sqrt',
    'cds_zeta',
    'cds_zeta_ac'
];

// Law 50, Law 51, Law 63 & Law 66: Dead-Code-Eliminated (DCE) Flat Single-Loop GLSL Compute Shader Builder with Stage Uniforms
export function buildComputeShader(compiled) {
    const innerExpr = compiled.innerGLSL || compiled.fullGLSL || 'z';
    const exprScan = `${innerExpr} ${compiled.outerChainFn || ''}`;
    const needsCCoord = /\bc_coord\b/.test(innerExpr);
    const needsZetaAc = /\bcds_zeta_ac\b/.test(exprScan);
    const needsZetaFn = /\bcds_zeta\b/.test(exprScan);
    const needsZeta = Boolean(compiled.isZeta) || needsZetaFn || needsZetaAc;
    const needsGamma = /\bcds_gamma\b/.test(exprScan);
    const needsBessel = /\bcds_bessel\b/.test(exprScan);
    const needsLogGamma = /\bcds_loggamma\b/.test(exprScan) || needsGamma || needsBessel;
    const needsPow = /\bcds_pow\b/.test(exprScan);
    const needsLn = /\bcds_(ln|ln_branch|asin|atan)\b/.test(exprScan) || needsPow || needsLogGamma || needsZeta;
    const needsTrigExp = /\bcds_(sin|cos|tan|sec|sinh|cosh|tanh|exp)\b/.test(exprScan) || needsPow || needsLogGamma || needsZeta;
    const needsSincos = needsTrigExp || needsLn;

    const activeChains = [];
    for (const op of CHAINABLE_OPS) {
        if (innerExpr.includes(`${op}_chain`)) {
            activeChains.push(`DEFINE_CDS_CHAIN(${op}_chain, ${op})`);
        }
    }

    const baseBody = compiled.outerChainFn
        ? innerExpr === 'z'
            ? `cqs w0 = ${compiled.outerChainFn}(z);
      if (u_outerPowExp != 1 && stepInCycle == u_outerChainCount - 1) return cds_pow_int(w0, u_outerPowExp);
      return w0;`
            : `cqs arg;
      if (stepInCycle == 0) {
        arg = ${innerExpr};
      } else {
        arg = z;
      }
      cqs w0 = ${compiled.outerChainFn}(arg);
      if (u_outerPowExp != 1 && stepInCycle == u_outerChainCount - 1) return cds_pow_int(w0, u_outerPowExp);
      return w0;`
        : `cqs w0 = ${innerExpr};
      if (u_outerPowExp != 1) return cds_pow_int(w0, u_outerPowExp);
      return w0;`;

    const evalBody = compiled.isDerivative
        ? `const float h = 0.0000152587890625;
      const float inv2h = 32768.0;
      cqs wp = eval_base(cds_add_f(z, h), c_coord, stepInCycle);
      cqs wm = eval_base(cds_add_f(z, -h), c_coord, stepInCycle);
      return cds_scale(cds_sub(wp, wm), inv2h);`
        : `return eval_base(z, c_coord, stepInCycle);`;

    return `#version 300 es
    precision highp float;
    precision highp int;
    layout(location = 0) out vec4 outRe;
    layout(location = 1) out vec4 outIm;

    uniform sampler2D u_prevRe;
    uniform sampler2D u_prevIm;
    uniform vec2 u_resolution;
    uniform vec4 u_centerReQS;
    uniform vec4 u_centerImQS;
    uniform vec4 u_scaleQS;
    uniform int u_passIndex;
    uniform int u_batchSteps;
    uniform int u_completedSteps;
    uniform int u_totalSteps;
    uniform int u_recurrenceMode;
    uniform int u_outerChainCount;
    uniform int u_outerPowExp;
    uniform int u_innerStageCounts[8];
    uniform int u_innerStagePows[8];
    uniform int u_useChainSeed;
    uniform vec4 u_chainSeedReQS;
    uniform vec4 u_chainSeedImQS;
    uniform float u_branchCutAngle;
    uniform vec4 u_expBaseLnReQS;
    uniform vec4 u_expBaseLnImQS;
    uniform vec4 u_logBaseInvLnReQS;
    uniform vec4 u_logBaseInvLnImQS;
    uniform vec4 u_besselOrderReQS;
    uniform vec4 u_besselOrderImQS;
    uniform vec4 u_powerExpReQS;
    uniform vec4 u_mobiusAReQS;
    uniform vec4 u_mobiusAImQS;
    uniform vec4 u_mobiusBReQS;
    uniform vec4 u_mobiusBImQS;
    uniform vec4 u_mobiusCReQS;
    uniform vec4 u_mobiusCImQS;
    uniform vec4 u_mobiusDReQS;
    uniform vec4 u_mobiusDImQS;

    ${GLSL_CDS_CORE}
    ${needsSincos ? GLSL_QS_SINCOS : ''}
    ${needsTrigExp ? GLSL_CDS_TRIG_EXP : ''}
    ${needsLn ? GLSL_CDS_LN_POW : ''}
    ${needsPow ? GLSL_CDS_POW_FN : ''}
    ${needsLogGamma ? GLSL_CDS_LOGGAMMA_CORE : ''}
    ${needsGamma ? GLSL_CDS_GAMMA_FN : ''}
    ${needsBessel ? GLSL_CDS_BESSEL_FN : ''}
    ${needsZeta ? GLSL_CDS_ZETA_PRIME_POW : ''}
    ${needsZetaFn ? GLSL_CDS_ZETA_BASE : ''}
    ${needsZetaAc ? GLSL_CDS_ZETA_AC : ''}
    ${activeChains.length > 0 ? GLSL_CDS_CHAIN_MACRO : ''}
    ${activeChains.join('\n    ')}

    cqs eval_base(cqs z, cqs c_coord, int stepInCycle) {
      ${baseBody}
    }

    cqs eval_full(cqs z, cqs c_coord, int stepInCycle) {
      ${evalBody}
    }

    void main() {
      cqs w;
      cqs c_coord = cqs(vec4(0.0), vec4(0.0));
      if (u_passIndex > 0) {
        ivec2 px = ivec2(gl_FragCoord.xy);
        w = cqs(texelFetch(u_prevRe, px, 0), texelFetch(u_prevIm, px, 0));
        // Law 60: Unified Cross-Pass Settled Sentinel (1e30 in limb 3, ignored by FS_DISPLAY's 2-limb domain_metrics).
        // Checked BEFORE any coordinate math so settled pixels exit in 1 texture fetch.
        if (w.re.w == 1e30) {
          outRe = w.re;
          outIm = w.im;
          return;
        }
        ${
            needsCCoord
                ? `vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
        vec3 scH, scL;
        split3(u_scaleQS.xyz, scH, scL);
        vec4 dx = qs_mul_f_presplit(u_scaleQS, scH, scL, uv.x * 2.0);
        vec4 dy = qs_mul_f_presplit(u_scaleQS, scH, scL, uv.y * 2.0);
        c_coord = cqs(qs_add(u_centerReQS, dx), qs_add(u_centerImQS, dy));`
                : ''
        }
      } else {
        vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
        vec3 scH, scL;
        split3(u_scaleQS.xyz, scH, scL);
        vec4 dx = qs_mul_f_presplit(u_scaleQS, scH, scL, uv.x * 2.0);
        vec4 dy = qs_mul_f_presplit(u_scaleQS, scH, scL, uv.y * 2.0);
        c_coord = cqs(qs_add(u_centerReQS, dx), qs_add(u_centerImQS, dy));
        if (u_useChainSeed == 1) {
          w = cqs(u_chainSeedReQS, u_chainSeedImQS);
        } else if (u_recurrenceMode == 3) {
          w = cqs(QS_PIO2, vec4(0.0));
        } else {
          w = c_coord;
        }
      }

      float prevDiff2 = 1.0;
      cqs prevW = cqs(vec4(1e38), vec4(1e38));
      for (int i = 0; i < u_batchSteps; i++) {
        if (cds_invalid(w)) break;
        int globalStep = u_completedSteps + i;
        int stepInCycle = (u_outerChainCount > 1) ? (globalStep % u_outerChainCount) : 0;
        float mag2 = w.re.x * w.re.x + w.im.x * w.im.x;
        if (u_recurrenceMode == 0 && stepInCycle == 0 && (u_passIndex > 0 || i > 0) && mag2 > 1e16) {
          w.re.w = 1e30;
          break;
        }
        cqs wNext = eval_full(w, c_coord, stepInCycle);
        if (u_recurrenceMode == 0 && (i > 0 || u_passIndex > 0) && cds_invalid(wNext)) {
          w.re.w = 1e30;
          break;
        }

        if (u_recurrenceMode == 1 || u_recurrenceMode == 3) {
          // Smooth Escape-Time Iteration Potential:
          // Pure iteration-potential coloring (zero final-value escAngle radial slices, zero modulus sawtooth jumps)
          float mag2Next = wNext.re.x * wNext.re.x + wNext.im.x * wNext.im.x;
          if (cds_invalid(wNext) || mag2Next > 65536.0) {
            float stepNum = float(globalStep + 1);
            float safeMag2 = cds_invalid(wNext) ? max(mag2 * mag2, 65536.001) : max(mag2Next, 65536.001);
            float log2Zn = 0.5 * log2(safeMag2);
            float nu = max(0.0, stepNum + 4.0 - log2(max(1.0, log2Zn)));
            float phaseTurn = fract(0.22 * log2(nu + 1.0));
            float phi = phaseTurn * TAU - PI;
            float R = 5.6568542;
            w = cqs(vec4(R * cos(phi), 0.0, 0.0, 1e30), vec4(R * sin(phi), 0.0, 0.0, 0.0));
            break;
          }
          w = wNext;
        } else if (u_recurrenceMode == 2) {
          // Smooth Attractor Convergence Iteration Potential
          float dRe = wNext.re.x - w.re.x;
          float dIm = wNext.im.x - w.im.x;
          float diff2 = dRe * dRe + dIm * dIm;
          if (diff2 < 1e-8) {
            float stepNum = float(globalStep + 1);
            float logPrev = 0.5 * log(max(1e-20, prevDiff2));
            float logCur = 0.5 * log(max(1e-24, diff2));
            float frac = clamp((-9.21034 - logPrev) / min(-1e-4, logCur - logPrev), 0.0, 1.0);
            float nu = max(0.0, stepNum - 1.0 + frac);
            float rootAngle = atan(wNext.im.x, wNext.re.x);
            float phi = rootAngle + 0.55 * sin(nu * 0.32);
            float R = 5.6568542;
            w = cqs(vec4(R * cos(phi), 0.0, 0.0, 1e30), vec4(R * sin(phi), 0.0, 0.0, 0.0));
            break;
          }
          prevDiff2 = max(1e-20, diff2);
          w = wNext;
        } else {
          bool homStep = (u_outerChainCount == 1) || (stepInCycle > 0 && u_totalSteps == u_outerChainCount && u_outerPowExp == 1);
          if (homStep) {
            if (wNext.re == w.re && wNext.im == w.im) {
              w = wNext;
              w.re.w = 1e30;
              break;
            }
            if (wNext.re == prevW.re && wNext.im == prevW.im) {
              int remAfter = u_totalSteps - 1 - globalStep;
              if ((remAfter & 1) == 0) w = wNext;
              w.re.w = 1e30;
              break;
            }
            prevW = w;
          } else {
            prevW = cqs(vec4(1e38), vec4(1e38));
          }
          w = wNext;
        }
      }

      // On the final pass of an escape/attractor recurrence, map non-escaped interior orbits to pure zero (dark basin, zero final-value bleed)
      if (u_recurrenceMode > 0 && w.re.w != 1e30 && (u_completedSteps + u_batchSteps >= u_totalSteps)) {
        w = cqs(vec4(0.0, 0.0, 0.0, 1e30), vec4(0.0));
      }

      outRe = w.re;
      outIm = w.im;
    }
  `;
}

export const GLSL_DISPLAY_CORE = `
  ${GLSL_CDS_CORE}
  ${GLSL_QS_SINCOS}
  ${GLSL_CDS_TRIG_EXP}
  ${GLSL_CDS_LN_POW}
`;

// Law 55 & Law 56: Single Unified Domain Coloring Display Shader (Zero Dual Fractal Pipelines or Fallbacks)
export const FS_DISPLAY = `#version 300 es
  precision highp float;
  precision highp int;
  out vec4 fragColor;

  uniform sampler2D u_stateReTex;
  uniform sampler2D u_stateImTex;
  uniform sampler2D u_paletteLUT;
  uniform vec2 u_resolution;
  uniform vec2 u_fboResolution;
  uniform int u_palette;
  uniform int u_paletteCount;
  uniform int u_showModulus;
  uniform int u_showPhase;
  uniform int u_recurrenceMode;
  uniform float u_ssaa;
  uniform vec3 u_bcs;

  ${GLSL_DISPLAY_CORE}

  vec3 lut(float t) {
    float v = (float(u_palette) + 0.5) / float(max(1, u_paletteCount));
    return texture(u_paletteLUT, vec2(fract(t), v)).rgb;
  }

  cqs sanitize_settled(cqs w) {
    float rw3 = (w.re.w == 1e30) ? 0.0 : w.re.w;
    return cqs(vec4(w.re.xyz, rw3), w.im);
  }

  // Law 54 & Law 55: 96-Bit 4-Limb Exponent-Scaled Display Metrics with Sub-Ring Exact Distance
  void domain_metrics(cqs wRaw, out float normPhase, out float fracMag, out float log2Mag, out float magApprox, out float distToRing, out float distToRay) {
    if (u_recurrenceMode > 0 && wRaw.re.w != 1e30) {
      if (u_recurrenceMode == 2 && (wRaw.re.x != 0.0 || wRaw.im.x != 0.0)) {
        float phase = atan(wRaw.im.x, wRaw.re.x);
        normPhase = fract((phase + PI) / TAU);
        fracMag = 0.5;
        log2Mag = 2.5;
        magApprox = 5.6568542;
        distToRing = 0.5;
        distToRay = 0.5;
        return;
      }
      normPhase = 0.0;
      fracMag = 0.0;
      log2Mag = -126.0;
      magApprox = 0.0;
      distToRing = 0.5;
      distToRay = 0.5;
      return;
    }
    cqs w = sanitize_settled(wRaw);
    float m = max(abs(w.re.x), abs(w.im.x));
    if (m == 0.0) {
      normPhase = 0.0;
      fracMag = 0.0;
      log2Mag = -126.0;
      magApprox = 0.0;
      distToRing = 0.5;
      distToRay = 0.5;
      return;
    }
    uint expBits = clamp(floatBitsToUint(m) & 0x7F800000u, 0x00800000u, 0x7E800000u);
    float exp2 = float(int(expBits >> 23u) - 127);
    float invScale = uintBitsToFloat(0x7F000000u - expBits);
    vec4 xs = w.re * invScale;
    vec4 ys = w.im * invScale;

    vec4 ph = qs_atan2(ys, xs);
    vec4 npQS = qs_mul_presplit_lhs(QS_INV_TAU, QS_INV_TAU_H, QS_INV_TAU_L, qs_add(ph, QS_PI));
    vec4 npPos = qs_add_f(-floor(npQS.x), npQS);
    normPhase = fract(fence1(npPos.x - floor(npPos.x)) + ((npPos.y + npPos.z) + npPos.w));
    vec4 np12 = npQS * 12.0;
    vec4 dRayQS = qs_add_f(-round(np12.x), np12);
    distToRay = min(0.5, abs(dRayQS.x + dRayQS.y));

    vec4 norm2 = qs_sum_sq(xs, ys);
    vec4 lg2 = qs_mul_presplit_lhs(QS_LOG2E, QS_LOG2E_H, QS_LOG2E_L, qs_ln(norm2)) * 0.5;
    vec4 lg2Pos = qs_add_f(-floor(lg2.x), lg2);
    float l0 = lg2Pos.x;
    float l1 = (lg2Pos.y + lg2Pos.z) + lg2Pos.w;
    float fl = floor(l0);
    fracMag = fract(fence1(l0 - fl) + l1);
    vec4 dRingQS = qs_add_f(-round(lg2.x), lg2);
    distToRing = min(0.5, abs(dRingQS.x + dRingQS.y));
    log2Mag = lg2.x + exp2;
    magApprox = (exp2 >= 6.0) ? 64.0 : ((exp2 <= -20.0) ? 0.0 : sqrt(max(0.0, norm2.x)) * uintBitsToFloat(expBits));
  }

  vec3 shade_from_metrics(float normPhase, float fracMag, float log2Mag, float magApprox, float distToRing, float distToRay, float fwMod, float fwPhase) {
    if (log2Mag <= -125.0) return vec3(0.03, 0.03, 0.04);

    vec3 col = lut(normPhase);

    if (u_showModulus == 1) {
      float nyquistFade = 1.0 - smoothstep(0.16, 0.45, fwMod);
      float ringLine = 1.0 - (1.0 - smoothstep(0.0, 1.35, distToRing / max(fwMod, 1e-30))) * nyquistFade;

      float octaveSaw = fracMag - 0.5;
      float harmonicWave = sin(TAU * fracMag);
      float bandShade = 1.0 + 0.16 * octaveSaw * (0.42 + 0.58 * nyquistFade) - 0.09 * harmonicWave * (0.35 + 0.65 * nyquistFade);
      col *= mix(1.0, 0.66, 1.0 - ringLine) * bandShade;
    }

    if (u_showPhase == 1) {
      float nyquistFadeP = 1.0 - smoothstep(0.16, 0.45, fwPhase);
      float rayLine = 1.0 - (1.0 - smoothstep(0.0, 1.35, distToRay / max(fwPhase, 1e-30))) * nyquistFadeP;
      col *= mix(1.0, 0.72, 1.0 - rayLine);
    }

    float zeroDark = 1.0 - 0.86 * exp(-magApprox * 1.85);
    float poleGlow = smoothstep(4.0, 10.5, log2Mag);
    col *= zeroDark;
    return mix(col, vec3(0.97, 0.96, 0.93), poleGlow * 0.34);
  }

  vec3 shade_domain_point(cqs w, float fwMod, float fwPhase) {
    if (cds_invalid(w)) {
      return vec3(0.95, 0.94, 0.91);
    }
    float normPhase, fracMag, log2Mag, magApprox, distToRing, distToRay;
    domain_metrics(w, normPhase, fracMag, log2Mag, magApprox, distToRing, distToRay);
    return shade_from_metrics(normPhase, fracMag, log2Mag, magApprox, distToRing, distToRay, fwMod, fwPhase);
  }

  cqs fetch_state_clamped(ivec2 px) {
    ivec2 cpx = clamp(px, ivec2(0), ivec2(u_fboResolution) - ivec2(1));
    return cqs(texelFetch(u_stateReTex, cpx, 0), texelFetch(u_stateImTex, cpx, 0));
  }

  vec3 shade_domain_ssaa(vec2 fragxy) {
    vec2 ratio = u_fboResolution / u_resolution;
    vec2 fboCoord = fragxy * ratio - vec2(0.5);
    ivec2 p00 = ivec2(floor(fboCoord));
    vec2 f = fract(fboCoord);

    cqs w00 = fetch_state_clamped(p00);
    cqs w10 = fetch_state_clamped(p00 + ivec2(1, 0));
    cqs w01 = fetch_state_clamped(p00 + ivec2(0, 1));

    bool inv10 = cds_invalid(w10);
    bool inv01 = cds_invalid(w01);

    cqs w00s = sanitize_settled(w00);
    cqs w10s = w00s;
    if (!inv10) w10s = sanitize_settled(w10);
    cqs w01s = w00s;
    if (!inv01) w01s = sanitize_settled(w01);
    vec4 dwReX = qs_sub(w10s.re, w00s.re);
    vec4 dwImX = qs_sub(w10s.im, w00s.im);
    vec4 dwReY = qs_sub(w01s.re, w00s.re);
    vec4 dwImY = qs_sub(w01s.im, w00s.im);
    float dWx = length(vec2(dwReX.x + dwReX.y, dwImX.x + dwImX.y)) * ratio.x;
    float dWy = length(vec2(dwReY.x + dwReY.y, dwImY.x + dwImY.y)) * ratio.y;
    float wMag = max(1e-30, length(vec2(w00s.re.x, w00s.im.x)));
    float dLnW = max(1e-30, length(vec2(dWx, dWy)) / wMag);

    float fwMod = clamp(dLnW * 1.4426950408889634, 1e-30, 1.0);
    float fwPhase = clamp(dLnW * (12.0 / TAU), 1e-30, 1.0);

    vec3 c00 = shade_domain_point(w00, fwMod, fwPhase);
    if (u_ssaa <= 1.05 || ratio.x <= 1.05) {
      return c00;
    }

    vec3 c10 = c00, c01 = c00, c11 = c00, ringAcc = vec3(0.0);
    int extraTaps = (u_ssaa <= 2.1) ? min(3, u_showModulus + 3) : min(7, u_showModulus + 7);
    for (int tap = 0; tap < extraTaps; ++tap) {
      ivec2 off = (tap == 0) ? ivec2(1, 0) : ((tap == 1) ? ivec2(0, 1) : ((tap == 2) ? ivec2(1, 1) :
                  ((tap == 3) ? ivec2(-1, 0) : ((tap == 4) ? ivec2(2, 0) : ((tap == 5) ? ivec2(0, -1) : ivec2(0, 2))))));
      cqs wt = w10;
      if (tap == 1) wt = w01;
      else if (tap >= 2) wt = fetch_state_clamped(p00 + off);
      vec3 ct = shade_domain_point(wt, fwMod, fwPhase);
      if (tap == 0) c10 = ct;
      else if (tap == 1) c01 = ct;
      else if (tap == 2) c11 = ct;
      else ringAcc += ct;
    }
    vec3 bilinearCol = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
    return (u_ssaa <= 2.1) ? bilinearCol : mix(bilinearCol, ringAcc * 0.25, 0.35);
  }

  vec3 apply_bcs(vec3 col) {
    col += u_bcs.x;
    col = (col - 0.5) * u_bcs.y + 0.5;
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(luma), col, u_bcs.z);
    return clamp(col, 0.0, 1.0);
  }

  void main() {
    vec3 col = shade_domain_ssaa(gl_FragCoord.xy);
    fragColor = vec4(apply_bcs(col), 1.0);
  }
`;
// ============================================================================
// 3. STRICT AST & CORE STATE TO 96-BIT QUAD-SINGLE (cqs) GLSL COMPILER
// ============================================================================
export const FN_MAP = {
    sin: 'cds_sin',
    cos: 'cds_cos',
    tan: 'cds_tan',
    sec: 'cds_sec',
    sinh: 'cds_sinh',
    cosh: 'cds_cosh',
    tanh: 'cds_tanh',
    exp: 'cds_exp',
    ln: 'cds_ln',
    log: 'cds_ln',
    asin: 'cds_asin',
    atan: 'cds_atan',
    gamma: 'cds_gamma',
    loggamma: 'cds_loggamma',
    zeta: 'cds_zeta',
    zeta_ac: 'cds_zeta_ac',
    sqrt: 'cds_sqrt',
    conj: 'cds_conj'
};

export function preprocessNotation(raw) {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s) throw new Error('Expression cannot be empty');

    let depth = 0;
    for (const ch of s) {
        if (ch === '(') depth++;
        else if (ch === ')') {
            depth--;
            if (depth < 0) throw new Error("Unmatched closing parenthesis ')'");
        }
    }
    if (depth !== 0) throw new Error(`Missing ${depth} closing parenthesis ')'`);

    let out = s
        .replace(/zeta-ac/g, 'zeta_ac')
        .replace(/\b(sin|cos|tan|sec|sinh|cosh|tanh|ln|log|asin|atan|gamma|loggamma|zeta_ac|zeta)\s*\^\s*([0-9]+)\s*\(/g, '($1#$2)(');

    while (out.includes('#')) {
        const idx = out.indexOf('#');
        const start = out.lastIndexOf('(', idx);
        const closeFn = out.indexOf(')', idx);
        const fn = out.slice(start + 1, idx);
        const pow = out.slice(idx + 1, closeFn);
        let d = 0,
            endArg = closeFn + 1;
        for (; endArg < out.length; endArg++) {
            if (out[endArg] === '(') d++;
            else if (out[endArg] === ')' && --d === 0) break;
        }
        const arg = out.slice(closeFn + 2, endArg);
        out = `${out.slice(0, start)}(${fn}(${arg})^${pow})${out.slice(endArg + 1)}`;
    }
    return out;
}

function unwrapGroupNode(node) {
    let cur = node;
    while (cur && (cur.type === 'ParenthesisNode' || cur.type === 'group')) {
        cur = cur.content || cur.expression;
    }
    return cur;
}

function getCallFnName(node) {
    if (!node) return null;
    if (node.type === 'FunctionNode') return node.fn?.name;
    if (node.type === 'call') return node.name;
    return null;
}

function extractRealConst(node) {
    const n = unwrapGroupNode(node);
    if (!n) return null;
    if (n.type === 'ConstantNode') {
        const v = Number(n.value);
        return Number.isFinite(v) ? v : null;
    }
    if (n.type === 'literal') {
        if (typeof n.value === 'object') {
            const re = Number(n.value.re);
            const im = Number(n.value.im) || 0;
            return im === 0 && Number.isFinite(re) ? re : null;
        }
        const v = Number(n.value);
        return Number.isFinite(v) ? v : null;
    }
    if ((n.type === 'OperatorNode' && n.isUnary() && n.op === '-') || (n.type === 'unary' && n.op === '-')) {
        const inner = extractRealConst(n.type === 'OperatorNode' ? n.args[0] : n.argument);
        return inner !== null ? -inner : null;
    }
    return null;
}

function isExactPowerOfTwo(v) {
    if (!Number.isFinite(v) || v === 0) return false;
    const a = Math.abs(v);
    const e = Math.log2(a);
    return Number.isInteger(e) && e >= -64 && e <= 64 && Math.pow(2, e) === a;
}

function emitMulByRealConst(exprGLSL, rv) {
    if (rv === 0) return 'cqs(vec4(0.0), vec4(0.0))';
    if (rv === 1) return exprGLSL;
    if (rv === -1) return `cds_neg(${exprGLSL})`;
    if (isExactPowerOfTwo(rv)) return `cds_scale(${exprGLSL}, ${glslFloat(rv)})`;
    return `cds_mul_qs(${exprGLSL}, ${qsVec4Literal(rv)})`;
}

function emitAddRealConst(exprGLSL, rv) {
    if (rv === 0) return exprGLSL;
    return `cds_add_re(${exprGLSL}, ${qsVec4Literal(rv)})`;
}

export function astToGLSL(node, varSym = 'z', stateConfig = null) {
    const n = unwrapGroupNode(node);
    switch (n.type) {
        case 'ConstantNode': {
            const v = Number(n.value);
            if (!Number.isFinite(v)) throw new Error('Invalid numeric constant');
            return cqsRealLiteral(v);
        }
        case 'literal': {
            const re = typeof n.value === 'object' ? Number(n.value.re) : Number(n.value);
            const im = typeof n.value === 'object' ? Number(n.value.im) : 0;
            return im === 0 ? cqsRealLiteral(re) : cqsComplexLiteral(re, im);
        }
        case 'SymbolNode':
        case 'variable':
            if (n.name === 'z') return varSym;
            if (n.name === 'c') return 'c_coord';
            if (n.name === 'i') return 'cqs(vec4(0.0), vec4(1.0, 0.0, 0.0, 0.0))';
            if (n.name === 'e') return 'cqs(QS_E, vec4(0.0))';
            if (n.name === 'pi') return 'cqs(QS_PI, vec4(0.0))';
            throw new Error(`Unknown symbol '${n.name}'`);
        case 'unary': {
            const a = astToGLSL(n.argument, varSym, stateConfig);
            if (n.op === '-') return `cds_neg(${a})`;
            if (n.op === '+') return a;
            throw new Error(`Unsupported unary operator '${n.op}'`);
        }
        case 'OperatorNode':
        case 'binary': {
            if (n.type === 'OperatorNode' && n.isUnary()) {
                const a = astToGLSL(n.args[0], varSym, stateConfig);
                if (n.op === '-') return `cds_neg(${a})`;
                if (n.op === '+') return a;
                throw new Error(`Unsupported unary operator '${n.op}'`);
            }
            const leftNode = unwrapGroupNode(n.type === 'OperatorNode' ? n.args[0] : n.left);
            const rightNode = unwrapGroupNode(n.type === 'OperatorNode' ? n.args[1] : n.right);
            const lv = extractRealConst(leftNode);
            const rv = extractRealConst(rightNode);
            if (n.op === '+') {
                if (lv !== null) return emitAddRealConst(astToGLSL(rightNode, varSym, stateConfig), lv);
                if (rv !== null) return emitAddRealConst(astToGLSL(leftNode, varSym, stateConfig), rv);
                return `cds_add(${astToGLSL(leftNode, varSym, stateConfig)}, ${astToGLSL(rightNode, varSym, stateConfig)})`;
            }
            if (n.op === '-') {
                if (rv !== null) return emitAddRealConst(astToGLSL(leftNode, varSym, stateConfig), -rv);
                return `cds_sub(${astToGLSL(leftNode, varSym, stateConfig)}, ${astToGLSL(rightNode, varSym, stateConfig)})`;
            }
            if (n.op === '*') {
                if (lv !== null) return emitMulByRealConst(astToGLSL(rightNode, varSym, stateConfig), lv);
                if (rv !== null) return emitMulByRealConst(astToGLSL(leftNode, varSym, stateConfig), rv);
                return `cds_mul(${astToGLSL(leftNode, varSym, stateConfig)}, ${astToGLSL(rightNode, varSym, stateConfig)})`;
            }
            if (n.op === '/') {
                if (rv !== null && rv !== 0) {
                    if (isExactPowerOfTwo(rv)) return `cds_scale(${astToGLSL(leftNode, varSym, stateConfig)}, ${glslFloat(1 / rv)})`;
                    return `cds_mul_qs(${astToGLSL(leftNode, varSym, stateConfig)}, ${qsVec4Literal(1 / rv)})`;
                }
                return `cds_div(${astToGLSL(leftNode, varSym, stateConfig)}, ${astToGLSL(rightNode, varSym, stateConfig)})`;
            }
            if (n.op === '^') {
                const L = astToGLSL(leftNode, varSym, stateConfig);
                if ((leftNode.type === 'SymbolNode' || leftNode.type === 'variable') && leftNode.name === 'e') {
                    return `cds_exp(${astToGLSL(rightNode, varSym, stateConfig)})`;
                }
                if (rv !== null && Number.isInteger(rv)) {
                    if (rv === 0) return 'cqs(QS_ONE, vec4(0.0))';
                    if (rv === 1) return L;
                    if (rv === 2) return `cds_sq(${L})`;
                    if (rv === -1) return `cds_rcp(${L})`;
                    if (rv === -2) return `cds_rcp(cds_sq(${L}))`;
                    if (rv >= -64 && rv <= 64) {
                        return `cds_pow_int(${L}, ${rv})`;
                    }
                }
                return `cds_pow(${L}, ${astToGLSL(rightNode, varSym, stateConfig)})`;
            }
            throw new Error(`Unsupported operator '${n.op}'`);
        }
        case 'FunctionNode':
        case 'call': {
            const rawName = getCallFnName(n);
            const args = n.args || [];
            if (rawName === 'bessel') {
                const argGLSL = astToGLSL(args[0], varSym, stateConfig);
                const order = stateConfig?.besselOrder ?? { re: 0, im: 0 };
                return `cds_bessel(${argGLSL}, ${cqsComplexLiteral(order.re, order.im)})`;
            }
            if (rawName === 'mobius' || rawName === 'polynomial' || rawName === 'power') {
                const argGLSL = astToGLSL(args[0], varSym, stateConfig);
                return emitCoreFunctionGLSL(rawName, argGLSL, 'c_coord', stateConfig || state);
            }
            if (rawName === 'abs') {
                const argGLSL = astToGLSL(args[0], varSym, stateConfig);
                return `cqs(qs_hypot((${argGLSL}).re, (${argGLSL}).im), vec4(0.0))`;
            }
            if (rawName === 'arg') {
                const argGLSL = astToGLSL(args[0], varSym, stateConfig);
                return `cqs(qs_atan2((${argGLSL}).im, (${argGLSL}).re), vec4(0.0))`;
            }
            if (rawName === 're') {
                const argGLSL = astToGLSL(args[0], varSym, stateConfig);
                return `cqs((${argGLSL}).re, vec4(0.0))`;
            }
            if (rawName === 'im') {
                const argGLSL = astToGLSL(args[0], varSym, stateConfig);
                return `cqs((${argGLSL}).im, vec4(0.0))`;
            }
            const fn = FN_MAP[rawName];
            if (!fn) throw new Error(`Unknown function '${rawName}'`);
            if (args.length !== 1) throw new Error(`'${rawName}' requires 1 argument`);
            let count = 1;
            let cur = args[0];
            while (cur) {
                cur = unwrapGroupNode(cur);
                const curName = getCallFnName(cur);
                if (curName && FN_MAP[curName] === fn && (cur.args?.length === 1)) {
                    count++;
                    cur = cur.args[0];
                } else {
                    break;
                }
            }
            const inner = astToGLSL(cur, varSym, stateConfig);
            return count === 1 ? `${fn}(${inner})` : `${fn}_chain(${inner}, ${count})`;
        }
        default:
            throw new Error(`Unsupported syntax node '${n.type}'`);
    }
}

const LANCZOS_CPU = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
];

function cpxMulCPU(a, b) {
    return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function cpxDivCPU(a, b) {
    const d = b.re * b.re + b.im * b.im;
    return d === 0
        ? { re: Infinity, im: Infinity }
        : { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

function cpxExpCPU(a) {
    const ex = Math.exp(a.re);
    return { re: ex * Math.cos(a.im), im: ex * Math.sin(a.im) };
}

function cpxLnCPU(a) {
    return { re: Math.log(Math.hypot(a.re, a.im)), im: Math.atan2(a.im, a.re) };
}

function evalLogGammaRhpCPU(z) {
    const zm = { re: z.re - 1, im: z.im };
    let sr = LANCZOS_CPU[0], si = 0;
    for (let k = 1; k < LANCZOS_CPU.length; k++) {
        const dr = zm.re + k, di = zm.im;
        const dd = dr * dr + di * di;
        sr += (LANCZOS_CPU[k] * dr) / dd;
        si -= (LANCZOS_CPU[k] * di) / dd;
    }
    const t = { re: z.re + 6.5, im: z.im };
    const logT = cpxLnCPU(t);
    const logSum = cpxLnCPU({ re: sr, im: si });
    const prod = cpxMulCPU({ re: z.re - 0.5, im: z.im }, logT);
    const halfLn2Pi = 0.9189385332046727;
    return {
        re: halfLn2Pi + prod.re - t.re + logSum.re,
        im: prod.im - t.im + logSum.im
    };
}

export function evalSinglePrimCPU(fnName, a, stateConfig = null) {
    const x = a.re, y = a.im;
    switch (fnName) {
        case 'sin': return { re: Math.sin(x) * Math.cosh(y), im: Math.cos(x) * Math.sinh(y) };
        case 'cos': return { re: Math.cos(x) * Math.cosh(y), im: -Math.sin(x) * Math.sinh(y) };
        case 'tan': {
            if (Math.abs(y) > 28.0) return { re: 0, im: Math.sign(y) };
            const d = Math.cos(2 * x) + Math.cosh(2 * y);
            return d === 0 ? { re: Infinity, im: Infinity } : { re: Math.sin(2 * x) / d, im: Math.sinh(2 * y) / d };
        }
        case 'sec': {
            if (Math.abs(y) > 85.0) return { re: 0, im: 0 };
            const cx = Math.cos(x), sx = Math.sin(x), chy = Math.cosh(y), shy = Math.sinh(y);
            const d = cx * cx + shy * shy;
            return d === 0 ? { re: Infinity, im: Infinity } : { re: (cx * chy) / d, im: (sx * shy) / d };
        }
        case 'sinh': return { re: Math.sinh(x) * Math.cos(y), im: Math.cosh(x) * Math.sin(y) };
        case 'cosh': return { re: Math.cosh(x) * Math.cos(y), im: Math.sinh(x) * Math.sin(y) };
        case 'tanh': {
            if (Math.abs(x) > 28.0) return { re: Math.sign(x), im: 0 };
            const d = Math.cosh(2 * x) + Math.cos(2 * y);
            return d === 0 ? { re: Infinity, im: Infinity } : { re: Math.sinh(2 * x) / d, im: Math.sin(2 * y) / d };
        }
        case 'exp': {
            const ex = Math.exp(x);
            return { re: ex * Math.cos(y), im: ex * Math.sin(y) };
        }
        case 'ln':
        case 'log':
            return { re: Math.log(Math.hypot(x, y)), im: Math.atan2(y, x) };
        case 'sqrt': {
            const r = Math.hypot(x, y);
            return { re: Math.sqrt(Math.max(0, (r + x) * 0.5)), im: (y < 0 ? -1 : 1) * Math.sqrt(Math.max(0, (r - x) * 0.5)) };
        }
        case 'asin': {
            const sq = { re: 1 - (x * x - y * y), im: -2 * x * y };
            const root = evalSinglePrimCPU('sqrt', sq);
            const lg = cpxLnCPU({ re: -y + root.re, im: x + root.im });
            return { re: lg.im, im: -lg.re };
        }
        case 'atan': {
            const upper = cpxLnCPU({ re: 1 - y, im: x });
            const lower = cpxLnCPU({ re: 1 + y, im: -x });
            return { re: (upper.im - lower.im) * 0.5, im: -(upper.re - lower.re) * 0.5 };
        }
        case 'loggamma': {
            if (x < 0.5) {
                const refl = evalLogGammaRhpCPU({ re: 1 - x, im: -y });
                const sn = evalSinglePrimCPU('sin', { re: Math.PI * x, im: Math.PI * y });
                const snLog = cpxLnCPU(sn);
                return { re: Math.log(Math.PI) - snLog.re - refl.re, im: -snLog.im - refl.im };
            }
            return evalLogGammaRhpCPU(a);
        }
        case 'gamma': {
            if (x < 0.5) {
                const refl = cpxExpCPU(evalLogGammaRhpCPU({ re: 1 - x, im: -y }));
                const sn = evalSinglePrimCPU('sin', { re: Math.PI * x, im: Math.PI * y });
                return cpxDivCPU({ re: Math.PI, im: 0 }, cpxMulCPU(sn, refl));
            }
            return cpxExpCPU(evalLogGammaRhpCPU(a));
        }
        case 'bessel': {
            const order = stateConfig?.besselOrder ?? { re: 0, im: 0 };
            let sign = 1;
            let nu = { re: Number(order.re) || 0, im: Number(order.im) || 0 };
            if (Math.abs(nu.im) < 1e-14 && Math.floor(nu.re) === nu.re && nu.re < 0) {
                if (Math.abs(nu.re) % 2 !== 0) sign = -1;
                nu = { re: -nu.re, im: 0 };
            }
            if (x === 0 && y === 0) {
                if (nu.re === 0 && nu.im === 0) return { re: sign, im: 0 };
                return nu.re > 0 ? { re: 0, im: 0 } : { re: NaN, im: NaN };
            }
            const halfLog = cpxLnCPU({ re: x * 0.5, im: y * 0.5 });
            const lg = evalSinglePrimCPU('loggamma', { re: nu.re + 1, im: nu.im });
            const nuh = cpxMulCPU(nu, halfLog);
            let term = cpxExpCPU({ re: nuh.re - lg.re, im: nuh.im - lg.im });
            let sum = { ...term };
            const step = { re: -(x * x - y * y) * 0.25, im: -x * y * 0.5 };
            for (let k = 0; k < 48; k++) {
                const k1 = k + 1;
                const denom = { re: k1 * (k1 + nu.re), im: k1 * nu.im };
                term = cpxDivCPU(cpxMulCPU(term, step), denom);
                sum = { re: sum.re + term.re, im: sum.im + term.im };
                if (Math.hypot(term.re, term.im) <= 1e-14 * Math.max(1, Math.hypot(sum.re, sum.im))) break;
            }
            return { re: sum.re * sign, im: sum.im * sign };
        }
        case 'conj':
            return { re: x, im: -y };
        case 'zeta':
        case 'zeta_ac': {
            const W = [0.99609375, -0.96484375, 0.85546875, -0.63671875, 0.36328125, -0.14453125, 0.03515625, -0.00390625];
            let er = 0, ei = 0;
            for (let k = 1; k <= 8; k++) {
                const lk = Math.log(k);
                const m = W[k - 1] * Math.exp(-x * lk);
                er += m * Math.cos(-y * lk);
                ei += m * Math.sin(-y * lk);
            }
            const l2 = Math.LN2;
            const m2 = 2 * Math.exp((1 - x) * l2);
            const dr = 1 - m2 * Math.cos(-y * l2);
            const di = -m2 * Math.sin(-y * l2);
            const dd = dr * dr + di * di;
            return dd === 0 ? { re: Infinity, im: Infinity } : { re: (er * dr + ei * di) / dd, im: (ei * dr - er * di) / dd };
        }
        default:
            return a;
    }
}

export function evalAstCPU(node, z, c = z, stateConfig = null) {
    const n = unwrapGroupNode(node);
    switch (n.type) {
        case 'ConstantNode':
            return { re: Number(n.value), im: 0 };
        case 'literal':
            return typeof n.value === 'object'
                ? { re: Number(n.value.re), im: Number(n.value.im) }
                : { re: Number(n.value), im: 0 };
        case 'SymbolNode':
        case 'variable':
            if (n.name === 'z') return z;
            if (n.name === 'c') return c;
            if (n.name === 'i') return { re: 0, im: 1 };
            if (n.name === 'e') return { re: Math.E, im: 0 };
            if (n.name === 'pi') return { re: Math.PI, im: 0 };
            return { re: 0, im: 0 };
        case 'unary': {
            const a = evalAstCPU(n.argument, z, c, stateConfig);
            return n.op === '-' ? { re: -a.re, im: -a.im } : a;
        }
        case 'OperatorNode':
        case 'binary': {
            if (n.type === 'OperatorNode' && n.isUnary()) {
                const a = evalAstCPU(n.args[0], z, c, stateConfig);
                return n.op === '-' ? { re: -a.re, im: -a.im } : a;
            }
            const L = evalAstCPU(n.type === 'OperatorNode' ? n.args[0] : n.left, z, c, stateConfig);
            const R = evalAstCPU(n.type === 'OperatorNode' ? n.args[1] : n.right, z, c, stateConfig);
            if (n.op === '+') return { re: L.re + R.re, im: L.im + R.im };
            if (n.op === '-') return { re: L.re - R.re, im: L.im - R.im };
            if (n.op === '*') return cpxMulCPU(L, R);
            if (n.op === '/') return cpxDivCPU(L, R);
            if (n.op === '^') {
                const r = Math.hypot(L.re, L.im);
                if (r === 0) return R.re === 0 && R.im === 0 ? { re: 1, im: 0 } : R.re > 0 ? { re: 0, im: 0 } : { re: Infinity, im: Infinity };
                const lnR = Math.log(r);
                const th = Math.atan2(L.im, L.re);
                const u = R.re * lnR - R.im * th;
                const v = R.re * th + R.im * lnR;
                const eu = Math.exp(u);
                return { re: eu * Math.cos(v), im: eu * Math.sin(v) };
            }
            return { re: 0, im: 0 };
        }
        case 'FunctionNode':
        case 'call': {
            const fnName = getCallFnName(n);
            const fn = FN_MAP[fnName];
            const args = n.args || [];
            let count = 1;
            let cur = args[0];
            while (cur && fn) {
                cur = unwrapGroupNode(cur);
                const curName = getCallFnName(cur);
                if (curName && FN_MAP[curName] === fn && cur.args?.length === 1) {
                    count++;
                    cur = cur.args[0];
                } else {
                    break;
                }
            }
            let w = evalAstCPU(cur, z, c, stateConfig);
            for (let i = 0; i < count; i++) {
                if (!Number.isFinite(w.re) || !Number.isFinite(w.im)) break;
                const wn = evalSinglePrimCPU(fnName, w, stateConfig);
                if (wn.re === w.re && wn.im === w.im) {
                    w = wn;
                    break;
                }
                w = wn;
            }
            return w;
        }
        default:
            return z;
    }
}

// Law 61 & Law 62: Formally verified 120 FPS batch cap from Bend 2 proof engine
function compute120FpsBatchSize(opCostClass, avgStepWeight) {
    const cap = Number(bendEngine.live_ui_120fps_batch_cap(1, opCostClass));
    return opCostClass
        ? Math.max(1, Math.min(2, Math.floor(cap / Math.max(1, avgStepWeight * 0.5))))
        : Math.max(1, Math.min(cap, Math.round(cap / Math.max(1, avgStepWeight))));
}

// Law 51, Law 56 & Law 63: Multi-Stage Peel Decomposition for 0ms Uniform Re-Use Across Arbitrary Nesting
function peelUnaryAndPowerStages(node) {
    const stages = [];
    let cur = unwrapGroupNode(node);

    while (stages.length < 8) {
        cur = unwrapGroupNode(cur);
        let powExp = 1;

        const isBinaryPow =
            (cur.type === 'OperatorNode' && !cur.isUnary() && cur.op === '^') ||
            (cur.type === 'binary' && cur.op === '^');
        if (isBinaryPow) {
            const lhs = unwrapGroupNode(cur.type === 'OperatorNode' ? cur.args[0] : cur.left);
            const rhs = unwrapGroupNode(cur.type === 'OperatorNode' ? cur.args[1] : cur.right);
            const isBaseE = (lhs.type === 'SymbolNode' || lhs.type === 'variable') && lhs.name === 'e';
            const nVal = extractRealConst(rhs);
            if (!isBaseE && nVal !== null && Number.isInteger(nVal) && nVal !== 0 && nVal >= -64 && nVal <= 64) {
                powExp = nVal;
                cur = lhs;
            }
        }

        const topFnName = getCallFnName(cur);
        if (topFnName && FN_MAP[topFnName] && cur.args?.length === 1) {
            const fn = FN_MAP[topFnName];
            let count = 1;
            let innerNode = cur.args[0];
            while (innerNode) {
                innerNode = unwrapGroupNode(innerNode);
                const innerName = getCallFnName(innerNode);
                if (innerName && FN_MAP[innerName] === fn && innerNode.args?.length === 1) {
                    count++;
                    innerNode = innerNode.args[0];
                } else {
                    break;
                }
            }
            stages.push({ fn, count, powExp });
            cur = innerNode;
            continue;
        }

        if (powExp !== 1) {
            stages.push({ fn: null, count: 1, powExp });
            continue;
        }

        break;
    }

    return { stages, coreNode: cur };
}

export function compileMathExpression(rawExpr, stateConfig = null) {
    const normalized = preprocessNotation(rawExpr);
    const root = unwrapGroupNode(
        typeof window !== 'undefined' && window.math?.parse
            ? window.math.parse(normalized)
            : parseExpression(normalized)
    );

    const { stages, coreNode } = peelUnaryAndPowerStages(root);
    const outerStage = stages.length > 0 ? stages[0] : { fn: null, count: 1, powExp: 1 };
    const outerChainFn = outerStage.fn;
    const outerChainCount = outerStage.count;
    const outerPowExp = outerStage.powExp;

    // Inner stages [1..k] execute bottom-up (from stages[stages.length - 1] up to stages[1])
    const innerStages = stages.slice(1).reverse();
    const innerStageCounts = new Array(8).fill(1);
    const innerStagePows = new Array(8).fill(1);

    let innerGLSL = astToGLSL(coreNode, 'z', stateConfig);
    const stageSigParts = [];
    for (let s = 0; s < innerStages.length; s++) {
        const st = innerStages[s];
        innerStageCounts[s] = st.count;
        innerStagePows[s] = st.powExp;
        stageSigParts.push(st.fn || 'pow');
        if (st.fn) {
            innerGLSL = `${st.fn}_chain(${innerGLSL}, u_innerStageCounts[${s}])`;
        }
        innerGLSL = `cds_pow_int(${innerGLSL}, u_innerStagePows[${s}])`;
    }

    const fullGLSL = astToGLSL(root, 'z', stateConfig);
    const shaderKey = `${outerChainFn || 'none'}::${stageSigParts.join('>')}::${innerGLSL}`;
    const isZeta = /\bcds_(zeta|zeta_ac|gamma|loggamma|bessel)\b/.test(fullGLSL);
    const baseWeight = isZeta ? 4 : 1;
    const totalPrimWeight = stages.reduce((acc, st) => acc + (st.fn ? st.count : 0), 0);
    const astWeight = baseWeight * Math.max(1, Math.min(totalPrimWeight || 1, 32));
    // Law 61 & Law 62: Formally verified 120 FPS batch cap from Bend 2 proof engine
    const batchSize = compute120FpsBatchSize(isZeta ? 1 : 0, astWeight);
    const evalCPU = (re, im, steps, mode = 0) => {
        const c0 = { re, im };
        let w = c0;
        let settledIter = steps;
        for (let i = 0; i < steps; i++) {
            const wn = evalAstCPU(root, w, c0, stateConfig);
            if (!Number.isFinite(wn.re) || !Number.isFinite(wn.im)) {
                w = wn;
                settledIter = i + 1;
                break;
            }
            const mag2 = wn.re * wn.re + wn.im * wn.im;
            if (mode === 1 || mode === 3) {
                if (mag2 > 65536.0) {
                    w = wn;
                    settledIter = i + 1;
                    break;
                }
            } else if (mode === 2) {
                const dx = wn.re - w.re;
                const dy = wn.im - w.im;
                if (dx * dx + dy * dy < 1e-6 || mag2 > 32.0) {
                    w = wn;
                    settledIter = i + 1;
                    break;
                }
            } else if ((wn.re === w.re && wn.im === w.im) || mag2 > 1e16) {
                w = wn;
                settledIter = i + 1;
                break;
            }
            w = wn;
        }
        return { re: w.re, im: w.im, iter: settledIter };
    };
    return {
        fullGLSL,
        innerGLSL,
        outerChainFn,
        outerChainCount,
        outerPowExp,
        innerStageCounts,
        innerStagePows,
        isDerivative: false,
        shaderKey,
        batchSize,
        evalCPU
    };
}
function isComplexBaseE(base) {
    if (!base) return true;
    const re = Number(base.re);
    const im = Number(base.im);
    return Math.abs(re - Math.E) < 1e-12 && Math.abs(im) < 1e-14;
}

function hasCustomBranchCut(runtimeState) {
    const branchAngle = Number(runtimeState?.branchCutAngle);
    return Number.isFinite(branchAngle) && Math.abs(branchAngle - Math.PI) > 1e-7;
}

function isStandardChainablePrim(fnKey, runtimeState) {
    if (!fnKey || !FN_MAP[fnKey]) return false;
    if (fnKey === 'exp') return isComplexBaseE(runtimeState?.expBase);
    if (fnKey === 'ln' || fnKey === 'log') {
        return !hasCustomBranchCut(runtimeState) && isComplexBaseE(runtimeState?.logBase);
    }
    return true;
}

function resolveChainableOp(fnKey, runtimeState) {
    if (fnKey === 'zeta' && runtimeState?.zetaContinuationEnabled) return 'cds_zeta_ac';
    return FN_MAP[fnKey] || null;
}

function emitLnWithConfigGLSL(argGLSL, runtimeState) {
    const customBranch = hasCustomBranchCut(runtimeState);
    const rawLn = customBranch
        ? `cds_ln_branch(${argGLSL}, u_branchCutAngle)`
        : `cds_ln(${argGLSL})`;
    const logBase = runtimeState?.logBase;
    if (isComplexBaseE(logBase)) return rawLn;
    const br = Number(logBase.re) || 0;
    const bi = Number(logBase.im) || 0;
    const lnRe = Math.log(Math.hypot(br, bi));
    const lnIm = Math.atan2(bi, br);
    const d = lnRe * lnRe + lnIm * lnIm;
    if (!Number.isFinite(d) || d === 0) return `cqs(vec4(0.0 / u_zero), vec4(0.0 / u_zero))`;
    return `cds_mul(${rawLn}, cqs(u_logBaseInvLnReQS, u_logBaseInvLnImQS))`;
}

function emitExpWithConfigGLSL(argGLSL, runtimeState) {
    const expBase = runtimeState?.expBase;
    if (isComplexBaseE(expBase)) return `cds_exp(${argGLSL})`;
    const br = Number(expBase.re) || 0;
    const bi = Number(expBase.im) || 0;
    if (br === 0 && bi === 0) return `cqs(vec4(0.0 / u_zero), vec4(0.0 / u_zero))`;
    return `cds_exp(cds_mul(${argGLSL}, cqs(u_expBaseLnReQS, u_expBaseLnImQS)))`;
}

function emitPolynomialGLSL(argGLSL, runtimeState) {
    const n = Math.max(0, Math.min(32, Math.floor(Number(runtimeState?.polynomialN ?? 0))));
    const coeffs = runtimeState?.polynomialCoeffs || [];
    let highest = -1;
    for (let k = n; k >= 0; k--) {
        const c = coeffs[k];
        if (c && (Number(c.re) !== 0 || Number(c.im) !== 0)) {
            highest = k;
            break;
        }
    }
    if (highest < 0) return `cqs(vec4(0.0), vec4(0.0))`;
    if (highest === 0) {
        const c0 = coeffs[0] || { re: 0, im: 0 };
        return cqsComplexLiteral(Number(c0.re) || 0, Number(c0.im) || 0);
    }
    if (
        highest === 1 &&
        (Number(coeffs[0]?.re) || 0) === 0 &&
        (Number(coeffs[0]?.im) || 0) === 0 &&
        Number(coeffs[1]?.re) === 1 &&
        (Number(coeffs[1]?.im) || 0) === 0
    ) {
        return argGLSL;
    }
    if (
        highest === 2 &&
        (Number(coeffs[0]?.re) || 0) === 0 &&
        (Number(coeffs[0]?.im) || 0) === 0 &&
        (Number(coeffs[1]?.re) || 0) === 0 &&
        (Number(coeffs[1]?.im) || 0) === 0 &&
        Number(coeffs[2]?.re) === 1 &&
        (Number(coeffs[2]?.im) || 0) === 0
    ) {
        return `cds_sq(${argGLSL})`;
    }
    const ckTop = coeffs[highest] || { re: 0, im: 0 };
    let acc = cqsComplexLiteral(Number(ckTop.re) || 0, Number(ckTop.im) || 0);
    for (let k = highest - 1; k >= 0; k--) {
        const ck = coeffs[k] || { re: 0, im: 0 };
        const cr = Number(ck.re) || 0;
        const ci = Number(ck.im) || 0;
        const prod = `cds_mul(${acc}, ${argGLSL})`;
        if (cr === 0 && ci === 0) {
            acc = prod;
        } else if (ci === 0) {
            acc = `cds_add_re(${prod}, ${cqsRealLiteral(cr)}.re)`;
        } else {
            acc = `cds_add(${prod}, ${cqsComplexLiteral(cr, ci)})`;
        }
    }
    return acc;
}

export function emitCoreFunctionGLSL(fnKey, argGLSL, cSym, runtimeState) {
    switch (fnKey) {
        case 'identity':
            return argGLSL;
        case 'c':
            return cSym;
        case 'sin':
            return `cds_sin(${argGLSL})`;
        case 'cos':
            return `cds_cos(${argGLSL})`;
        case 'tan':
            return `cds_tan(${argGLSL})`;
        case 'sec':
            return `cds_sec(${argGLSL})`;
        case 'sinh':
            return `cds_sinh(${argGLSL})`;
        case 'cosh':
            return `cds_cosh(${argGLSL})`;
        case 'tanh':
            return `cds_tanh(${argGLSL})`;
        case 'asin':
            return `cds_asin(${argGLSL})`;
        case 'atan':
            return `cds_atan(${argGLSL})`;
        case 'gamma':
            return `cds_gamma(${argGLSL})`;
        case 'loggamma':
            return `cds_loggamma(${argGLSL})`;
        case 'bessel':
            return `cds_bessel(${argGLSL}, cqs(u_besselOrderReQS, u_besselOrderImQS))`;
        case 'exp':
            return emitExpWithConfigGLSL(argGLSL, runtimeState);
        case 'ln':
        case 'log':
            return emitLnWithConfigGLSL(argGLSL, runtimeState);
        case 'power': {
            const p = Number(runtimeState?.fractionalPowerN ?? 1);
            if (Number.isInteger(p) && p === 2) return `cds_sq(${argGLSL})`;
            if (Number.isInteger(p) && p >= -64 && p <= 64) return `cds_pow_int(${argGLSL}, ${p})`;
            if (Math.abs(p - 0.5) < 1e-12 && !hasCustomBranchCut(runtimeState) && isComplexBaseE(runtimeState?.logBase)) {
                return `cds_sqrt(${argGLSL})`;
            }
            const lnZ = emitLnWithConfigGLSL(argGLSL, runtimeState);
            return `cds_exp(cds_mul(cqs(u_powerExpReQS, vec4(0.0)), ${lnZ}))`;
        }
        case 'mobius': {
            const num = `cds_add(cds_mul(cqs(u_mobiusAReQS, u_mobiusAImQS), ${argGLSL}), cqs(u_mobiusBReQS, u_mobiusBImQS))`;
            const den = `cds_add(cds_mul(cqs(u_mobiusCReQS, u_mobiusCImQS), ${argGLSL}), cqs(u_mobiusDReQS, u_mobiusDImQS))`;
            return `cds_div(${num}, ${den})`;
        }
        case 'polynomial':
            return emitPolynomialGLSL(argGLSL, runtimeState);
        case 'zeta':
            if (runtimeState?.zetaContinuationEnabled) {
                return `cds_zeta_ac(${argGLSL})`;
            }
            return `cds_zeta(${argGLSL})`;
        case 'zeta_ac':
            return `cds_zeta_ac(${argGLSL})`;
        default:
            return argGLSL;
    }
}

function emitAlgebraicChainingDecomposed(runtimeState) {
    const zExprRaw = String(runtimeState?.algebraicChainingZExpr ?? 'z').trim() || 'z';
    let zTransformed = 'z';
    if (zExprRaw !== 'z') {
        const normalizedZ = preprocessNotation(zExprRaw);
        const parsedZ =
            typeof window !== 'undefined' && window.math?.parse
                ? window.math.parse(normalizedZ)
                : parseExpression(normalizedZ);
        zTransformed = astToGLSL(parsedZ, 'z', runtimeState);
    }

    const innerStageCounts = new Array(8).fill(1);
    const innerStagePows = new Array(8).fill(1);

    const terms = Array.isArray(runtimeState?.algebraicChainingTerms)
        ? runtimeState.algebraicChainingTerms
        : [];
    if (terms.length === 0) {
        const zero = 'cqs(vec4(0.0), vec4(0.0))';
        return {
            fullGLSL: zero,
            innerGLSL: zero,
            outerChainFn: null,
            outerChainCount: 1,
            outerPowExp: 1,
            innerStageCounts,
            innerStagePows,
            stageSig: ''
        };
    }

    const nonZeroTerms = terms.filter(t => Number(t?.coeff?.re ?? 1) !== 0 || Number(t?.coeff?.im ?? 0) !== 0);

    // Law 47, Law 51 & Law 63: Decompose single-term chainable outer primitive, inner stages, and integer power
    if (nonZeroTerms.length === 1) {
        const singleTerm = nonZeroTerms[0];
        const coeffRe = Number(singleTerm?.coeff?.re ?? 1);
        const coeffIm = Number(singleTerm?.coeff?.im ?? 0);
        const factors = Array.isArray(singleTerm?.factors) ? singleTerm.factors : [];
        if (coeffRe === 1 && coeffIm === 0 && factors.length === 1) {
            const f = factors[0];
            const funcKey = f.func || 'identity';
            const pow = Number(f.power ?? 1);
            const isIntPow = Number.isInteger(pow) && pow !== 0 && pow >= -64 && pow <= 64;
            if (
                funcKey === 'identity' &&
                pow === 1 &&
                !f.reciprocal &&
                !f.log &&
                !f.exp &&
                (!f.chainedFunc || f.chainedFunc === 'none') &&
                zExprRaw !== 'z'
            ) {
                const compiledZ = compileMathExpression(zExprRaw, runtimeState);
                return {
                    fullGLSL: compiledZ.fullGLSL,
                    innerGLSL: compiledZ.innerGLSL,
                    outerChainFn: compiledZ.outerChainFn,
                    outerChainCount: compiledZ.outerChainCount,
                    outerPowExp: compiledZ.outerPowExp,
                    innerStageCounts: compiledZ.innerStageCounts,
                    innerStagePows: compiledZ.innerStagePows,
                    stageSig: compiledZ.shaderKey.split('::')[1] || ''
                };
            }
            if (!f.log && !f.exp && isIntPow && isStandardChainablePrim(funcKey, runtimeState)) {
                const outerChainFn = resolveChainableOp(funcKey, runtimeState);
                const allowMultiStep =
                    getBendRecurrenceMode(runtimeState) === 0 && runtimeState?.mapPresentation !== 'derivative';
                const sameNested = allowMultiStep && f.chainedFunc === funcKey;
                const outerChainCount = sameNested ? 2 : 1;
                const outerPowExp = f.reciprocal ? -pow : pow;
                const innerGLSL =
                    !sameNested && f.chainedFunc && f.chainedFunc !== 'none'
                        ? emitCoreFunctionGLSL(f.chainedFunc, zTransformed, 'c_coord', runtimeState)
                        : zTransformed;
                let fullGLSL = outerChainCount === 1
                    ? `${outerChainFn}(${innerGLSL})`
                    : `${outerChainFn}_chain(${innerGLSL}, ${outerChainCount})`;
                if (outerPowExp === 2) {
                    fullGLSL = `cds_sq(${fullGLSL})`;
                } else if (outerPowExp !== 1) {
                    fullGLSL = `cds_pow_int(${fullGLSL}, ${outerPowExp})`;
                }
                return {
                    fullGLSL,
                    innerGLSL,
                    outerChainFn,
                    outerChainCount,
                    outerPowExp,
                    innerStageCounts,
                    innerStagePows,
                    stageSig: ''
                };
            }
        }
    }

    const termGLSLs = [];
    for (const term of nonZeroTerms) {
        const coeffRe = Number(term?.coeff?.re ?? 1);
        const coeffIm = Number(term?.coeff?.im ?? 0);
        const factors = Array.isArray(term?.factors) ? term.factors : [];
        let termVal = null;
        const isCoeffOne = coeffRe === 1 && coeffIm === 0;
        const coeffLit = coeffIm === 0 ? cqsRealLiteral(coeffRe) : cqsComplexLiteral(coeffRe, coeffIm);

        if (factors.length === 0) {
            termVal = coeffLit;
        } else {
            for (let i = 0; i < factors.length; i++) {
                const f = factors[i];
                const funcKey = f.func || 'identity';
                let fVal;
                if (
                    f.chainedFunc &&
                    f.chainedFunc === funcKey &&
                    isStandardChainablePrim(funcKey, runtimeState)
                ) {
                    // Law 47: Collapse identical nested unary chain into bounded loop macro
                    const op = resolveChainableOp(funcKey, runtimeState);
                    fVal = `${op}_chain(${zTransformed}, 2)`;
                } else {
                    let arg = zTransformed;
                    if (f.chainedFunc && f.chainedFunc !== 'none') {
                        arg = emitCoreFunctionGLSL(f.chainedFunc, arg, 'c_coord', runtimeState);
                    }
                    fVal = emitCoreFunctionGLSL(funcKey, arg, 'c_coord', runtimeState);
                }
                const pow = Number(f.power ?? 1);
                if (pow !== 1) {
                    if (Number.isInteger(pow) && pow === 2) {
                        fVal = `cds_sq(${fVal})`;
                    } else if (Number.isInteger(pow) && pow >= -64 && pow <= 64) {
                        fVal = `cds_pow_int(${fVal}, ${pow})`;
                    } else {
                        fVal = `cds_pow(${fVal}, ${cqsRealLiteral(pow)})`;
                    }
                }
                if (f.reciprocal) {
                    fVal = `cds_rcp(${fVal})`;
                }
                if (f.log) {
                    fVal = emitLnWithConfigGLSL(fVal, runtimeState);
                }
                if (f.exp) {
                    fVal = emitExpWithConfigGLSL(fVal, runtimeState);
                }
                if (termVal === null) {
                    termVal = isCoeffOne ? fVal : `cds_mul(${coeffLit}, ${fVal})`;
                } else {
                    termVal = `cds_mul(${termVal}, ${fVal})`;
                }
            }
        }
        if (termVal) termGLSLs.push(termVal);
    }

    if (termGLSLs.length === 0) {
        const zero = 'cqs(vec4(0.0), vec4(0.0))';
        return {
            fullGLSL: zero,
            innerGLSL: zero,
            outerChainFn: null,
            outerChainCount: 1,
            outerPowExp: 1,
            innerStageCounts,
            innerStagePows,
            stageSig: ''
        };
    }
    let sum = termGLSLs[0];
    for (let i = 1; i < termGLSLs.length; i++) {
        sum = `cds_add(${sum}, ${termGLSLs[i]})`;
    }
    return {
        fullGLSL: sum,
        innerGLSL: sum,
        outerChainFn: null,
        outerChainCount: 1,
        outerPowExp: 1,
        innerStageCounts,
        innerStagePows,
        stageSig: ''
    };
}

function emitTaylorApproximationGLSL(runtimeState) {
    const fnKey = runtimeState?.currentFunction || 'cos';
    const center = runtimeState?.taylorSeriesCenter ?? { re: 0, im: 0 };
    const order = Math.max(0, Math.min(32, Math.floor(Number(runtimeState?.taylorSeriesOrder ?? 3))));
    let coeffs = null;
    try {
        coeffs = computeTaylorSeriesCoefficients(fnKey, center, order);
    } catch (_err) {
        coeffs = null;
    }
    if (!Array.isArray(coeffs) || coeffs.length === 0) {
        return emitCoreFunctionGLSL(fnKey, 'z', 'c_coord', runtimeState);
    }
    const z0Re = Number(center.re) || 0;
    const z0Im = Number(center.im) || 0;
    const dz = z0Re === 0 && z0Im === 0 ? 'z' : `cds_sub(z, ${cqsComplexLiteral(z0Re, z0Im)})`;
    let acc = cqsComplexLiteral(Number(coeffs[coeffs.length - 1]?.re) || 0, Number(coeffs[coeffs.length - 1]?.im) || 0);
    for (let k = coeffs.length - 2; k >= 0; k--) {
        const ck = coeffs[k] || { re: 0, im: 0 };
        acc = `cds_add(cds_mul(${acc}, ${dz}), ${cqsComplexLiteral(Number(ck.re) || 0, Number(ck.im) || 0)})`;
    }
    const radius = Number(runtimeState?.taylorSeriesConvergenceRadius);
    if (Number.isFinite(radius) && radius > 0) {
        const r2 = glslFloat(radius * radius);
        return `cds_mask_radius(${acc}, z, ${glslFloat(z0Re)}, ${glslFloat(z0Im)}, ${r2})`;
    }
    return acc;
}

export function compileStateToUnifiedExpression(runtimeState = state) {
    const fnKey = runtimeState?.currentFunction || 'cos';
    const isDerivative = runtimeState?.mapPresentation === 'derivative';
    let fullGLSL;
    let innerGLSL;
    let outerChainFn = null;
    let outerChainCount = 1;
    let outerPowExp = 1;
    let innerStageCounts = new Array(8).fill(1);
    let innerStagePows = new Array(8).fill(1);
    let stageSig = '';

    if (runtimeState?.taylorSeriesEnabled) {
        fullGLSL = emitTaylorApproximationGLSL(runtimeState);
        innerGLSL = fullGLSL;
    } else if (fnKey === 'algebraic_chaining') {
        const decomposed = emitAlgebraicChainingDecomposed(runtimeState);
        fullGLSL = decomposed.fullGLSL;
        innerGLSL = decomposed.innerGLSL;
        outerChainFn = decomposed.outerChainFn;
        outerChainCount = decomposed.outerChainCount;
        outerPowExp = decomposed.outerPowExp;
        innerStageCounts = decomposed.innerStageCounts;
        innerStagePows = decomposed.innerStagePows;
        stageSig = decomposed.stageSig;
    } else if (isStandardChainablePrim(fnKey, runtimeState)) {
        outerChainFn = resolveChainableOp(fnKey, runtimeState);
        outerChainCount = 1;
        outerPowExp = 1;
        innerGLSL = 'z';
        fullGLSL = `${outerChainFn}(z)`;
    } else if (fnKey === 'power') {
        const p = Number(runtimeState?.fractionalPowerN ?? 1);
        fullGLSL = emitCoreFunctionGLSL('power', 'z', 'c_coord', runtimeState);
        if (Number.isInteger(p) && p !== 0 && p >= -64 && p <= 64) {
            innerGLSL = 'z';
            outerPowExp = p;
        } else {
            innerGLSL = fullGLSL;
        }
    } else {
        fullGLSL = emitCoreFunctionGLSL(fnKey, 'z', 'c_coord', runtimeState);
        innerGLSL = fullGLSL;
    }

    const shaderKey = `${isDerivative ? 'deriv::' : ''}${outerChainFn || 'none'}::${stageSig ? `${stageSig}::` : ''}${innerGLSL}`;
    const isHeavy = /\bcds_(zeta|zeta_ac|gamma|loggamma|bessel)\b/.test(fullGLSL);
    const baseWeight = isHeavy ? 4 : 1;
    const astWeight = baseWeight * Math.max(1, Math.min(outerChainCount, 32));
    // Law 61 & Law 62: Formally verified 120 FPS batch cap from Bend 2 proof engine
    const batchSize = compute120FpsBatchSize(isHeavy ? 1 : 0, astWeight);

    return {
        fullGLSL,
        innerGLSL,
        outerChainFn,
        outerChainCount,
        outerPowExp,
        innerStageCounts,
        innerStagePows,
        isDerivative,
        shaderKey,
        batchSize
    };
}

// ============================================================================
// 4. WEBGL2 3-FBO + 120 FPS ADAPTIVE BEND 2 LIVE UI WORKSTATION CONTROLLER
// ============================================================================
function createProgramInfo(gl, [vsSrc, fsSrc]) {
    const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const vsOk = gl.getShaderParameter(vs, gl.COMPILE_STATUS);
        const fsOk = gl.getShaderParameter(fs, gl.COMPILE_STATUS);
        const shaderErr = !vsOk ? gl.getShaderInfoLog(vs) : !fsOk ? gl.getShaderInfoLog(fs) : null;
        const linkErr = gl.getProgramInfoLog(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        gl.deleteProgram(program);
        if (shaderErr !== null) {
            throw new Error(`GLSL compile error: ${shaderErr}`);
        }
        throw new Error(`GLSL link error: ${linkErr}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    const uniformLocations = new Map();
    const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < numUniforms; i++) {
        const info = gl.getActiveUniform(program, i);
        if (!info) continue;
        const name = info.name.replace(/\[0\]$/, '');
        uniformLocations.set(name, {
            loc: gl.getUniformLocation(program, info.name),
            type: info.type
        });
    }
    return { program, uniformLocations };
}

function setProgramUniforms(gl, progInfo, uniforms) {
    let texUnit = 0;
    for (const [name, val] of Object.entries(uniforms)) {
        const entry = progInfo.uniformLocations.get(name);
        if (!entry || entry.loc === null || val === undefined) continue;
        const { loc, type } = entry;
        if (type === gl.SAMPLER_2D) {
            gl.activeTexture(gl.TEXTURE0 + texUnit);
            gl.bindTexture(gl.TEXTURE_2D, val);
            gl.uniform1i(loc, texUnit);
            texUnit++;
        } else if (type === gl.FLOAT) {
            gl.uniform1f(loc, Number(val));
        } else if ((type === gl.INT || type === gl.BOOL) && Array.isArray(val)) {
            gl.uniform1iv(loc, val);
        } else if (type === gl.INT || type === gl.BOOL) {
            gl.uniform1i(loc, Number(val));
        } else if (type === gl.FLOAT_VEC2) {
            gl.uniform2fv(loc, val);
        } else if (type === gl.FLOAT_VEC3) {
            gl.uniform3fv(loc, val);
        } else if (type === gl.FLOAT_VEC4) {
            gl.uniform4fv(loc, val);
        }
    }
}

function createFBO2Attachments(gl, w, h) {
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const attachments = [];
    for (let i = 0; i < 2; i++) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
        attachments.push(tex);
    }
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { framebuffer, attachments, width: w, height: h };
}

function resizeFBO2Attachments(gl, fbo, w, h) {
    for (let i = 0; i < 2; i++) {
        gl.bindTexture(gl.TEXTURE_2D, fbo.attachments[i]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    }
    fbo.width = w;
    fbo.height = h;
}

function catmullRomSpline(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return (
        0.5 *
        (2.0 * p1 +
            (-p0 + p2) * t +
            (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 +
            (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3)
    );
}

function buildPaletteLUTTexture(gl) {
    const W = 1024;
    const H = domainPalettes.length;
    const data = new Float32Array(W * H * 4);

    domainPalettes.forEach((p, row) => {
        const stops = getDomainPaletteStops(p.id);
        const rgbs = stops.length > 1 &&
            stops[0][0] === stops[stops.length - 1][0] &&
            stops[0][1] === stops[stops.length - 1][1] &&
            stops[0][2] === stops[stops.length - 1][2]
            ? stops.slice(0, -1)
            : stops;
        const N = rgbs.length;
        for (let x = 0; x < W; x++) {
            const u = (x / W) * N;
            const i = Math.floor(u) % N;
            const t = u - Math.floor(u);
            const p0 = rgbs[(i - 1 + N) % N];
            const p1 = rgbs[i];
            const p2 = rgbs[(i + 1) % N];
            const p3 = rgbs[(i + 2) % N];
            const idx = (row * W + x) * 4;
            for (let c = 0; c < 3; c++) {
                data[idx + c] = Math.max(0.0, Math.min(1.0, catmullRomSpline(p0[c], p1[c], p2[c], p3[c], t)));
            }
            data[idx + 3] = 1.0;
        }
    });

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const hasLinearFloat = !!gl.getExtension('OES_texture_float_linear');
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, hasLinearFloat ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, hasLinearFloat ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, data);
    return tex;
}

function getPaletteRowIndex(paletteId) {
    const idx = domainPalettes.findIndex(p => p.id === paletteId);
    return idx >= 0 ? idx : 0;
}

function getBendRecurrenceMode(runtimeState) {
    if (!runtimeState?.chainingEnabled) return 0;
    const mode = runtimeState.orbitColoringMode;
    if (mode === 'escape') return 1;
    if (mode === 'attractor') return 2;
    return 0;
}

// Synchronizes 110-digit BigInt camera state with zPlaneParams
export function syncBigIntCameraFromPlaneParams(planeParams, forceFromFloat = false) {
    if (!planeParams) return { centerReQS: splitDoubleToQS(0), centerImQS: splitDoubleToQS(0), scaleQS: splitDoubleToQS(2.4) };
    const w = Math.max(1, planeParams.width || 800);
    const h = Math.max(1, planeParams.height || 600);
    const minDim = Math.min(w, h);
    const scalePx = Number(planeParams.scale?.x) || 100;
    const rawScale = (0.5 * minDim) / scalePx;
    const originX = Number(planeParams.origin?.x) || 0;
    const originY = Number(planeParams.origin?.y) || 0;

    const floatGeometryUnchanged =
        planeParams._lastSyncedOriginX === originX &&
        planeParams._lastSyncedOriginY === originY &&
        planeParams._lastSyncedScaleX === scalePx &&
        planeParams._lastSyncedWidth === w &&
        planeParams._lastSyncedHeight === h;

    const hasBigCamera =
        typeof planeParams.centerBigX === 'bigint' &&
        typeof planeParams.centerBigY === 'bigint' &&
        Number.isFinite(planeParams.scaleMant) &&
        Number.isFinite(planeParams.scaleExp10);

    const isDeepZoom =
        (hasBigCamera && planeParams.scaleExp10 <= -7) ||
        scalePx >= 1e9 ||
        Math.abs(originX) >= 1e12 ||
        Math.abs(originY) >= 1e12;

    if (!forceFromFloat && hasBigCamera && (floatGeometryUnchanged || isDeepZoom)) {
        if (!floatGeometryUnchanged) {
            planeParams._lastSyncedOriginX = originX;
            planeParams._lastSyncedOriginY = originY;
            planeParams._lastSyncedScaleX = scalePx;
            planeParams._lastSyncedWidth = w;
            planeParams._lastSyncedHeight = h;
        }
        const scaleBig = numberToBigFixed(planeParams.scaleMant, planeParams.scaleExp10);
        return {
            centerReQS: bigFixedToQS(planeParams.centerBigX),
            centerImQS: bigFixedToQS(planeParams.centerBigY),
            scaleQS: bigFixedToQS(scaleBig)
        };
    }

    const centerRe = (0.5 * w - originX) / scalePx;
    const centerIm = (originY - 0.5 * h) / scalePx;
    const centerBigX = numberToBigFixed(centerRe);
    const centerBigY = numberToBigFixed(centerIm);
    const exp10 = rawScale > 0 && Number.isFinite(rawScale) ? Math.floor(Math.log10(rawScale)) : 0;
    const scaleMant = rawScale > 0 && Number.isFinite(rawScale) ? rawScale / Math.pow(10, exp10) : 2.4;

    planeParams.centerBigX = centerBigX;
    planeParams.centerBigY = centerBigY;
    planeParams.scaleMant = scaleMant;
    planeParams.scaleExp10 = exp10;
    planeParams._lastSyncedOriginX = originX;
    planeParams._lastSyncedOriginY = originY;
    planeParams._lastSyncedScaleX = scalePx;
    planeParams._lastSyncedWidth = w;
    planeParams._lastSyncedHeight = h;

    const scaleBig = numberToBigFixed(scaleMant, exp10);
    return {
        centerReQS: bigFixedToQS(centerBigX),
        centerImQS: bigFixedToQS(centerBigY),
        scaleQS: bigFixedToQS(scaleBig)
    };
}

// Workstation state driving the unified compute/display pipeline
export const workstationState = {
    expr: 'cos(z)',
    mode: 0,
    palette: 0,
    chainEnabled: false,
    chainCount: 1,
    showModulus: true,
    showPhase: false,
    resScale: 1.5,
    brightness: 0.0,
    contrast: 1.0,
    saturation: 1.0,
    centerBigX: 0n,
    centerBigY: 0n,
    scaleMant: 2.4,
    scaleExp10: 0
};

let ws = null;
let expressionDirty = true;

function getTotalChainSteps() {
    const state = workstationState;
    const baseSteps = Number(
        bendEngine.live_ui_total_steps(state.mode, state.chainEnabled, state.chainCount)
    );
    const outerMul = Math.max(1, ws?.compiled?.outerChainCount ?? 1);
    return baseSteps * outerMul;
}

function syncFromBendUI(w, nextUI) {
    w.liveUI = nextUI;
    w.fbos.readIdx = Number(nextUI.read_idx);
    w.fbos.hasDisplay = Number(nextUI.remaining_steps) === 0 && Boolean(nextUI.has_display);
    w.needSeedPass = Boolean(nextUI.need_seed_pass);
    w.remainingSteps = Number(nextUI.remaining_steps);
    w.completedSteps = Number(nextUI.completed_steps);
    w.activeTotalSteps = Number(nextUI.active_total_steps);
    w.dirtyDisplay = Boolean(nextUI.dirty_display);
}

function syncWorkstationStateFromCore(w, runtimeState = state) {
    const nextMode = getBendRecurrenceMode(runtimeState);
    const nextChainEnabled = Boolean(runtimeState.chainingEnabled);
    const nextCount = Math.max(1, Math.floor(Number(runtimeState.chainCount) || 1));

    workstationState.palette = getPaletteRowIndex(runtimeState.domainPalette);
    workstationState.brightness = (Number(runtimeState.domainBrightness) || 1.0) - 1.0;
    workstationState.contrast = Number(runtimeState.domainContrast) || 1.0;
    workstationState.saturation = Number.isFinite(Number(runtimeState.domainSaturation))
        ? Number(runtimeState.domainSaturation)
        : 1.0;
    workstationState.resScale =
        Number.isFinite(Number(runtimeState.domainResScale)) && Number(runtimeState.domainResScale) > 0
            ? Number(runtimeState.domainResScale)
            : 1.5;
    workstationState.showModulus =
        runtimeState.domainShowModulus !== undefined
            ? Boolean(runtimeState.domainShowModulus)
            : (Number(runtimeState.domainLightnessCycles) || 0) > 0.0001;
    workstationState.showPhase = Boolean(runtimeState.domainShowPhase);

    if (!w) {
        workstationState.mode = nextMode;
        workstationState.chainEnabled = nextChainEnabled;
        workstationState.chainCount = nextCount;
        return;
    }

    const liveUI = w.liveUI;
    liveUI.read_idx = w.fbos.readIdx;
    liveUI.has_display = Boolean(w.fbos.hasDisplay);

    if (nextMode !== workstationState.mode) {
        workstationState.mode = nextMode;
        workstationState.chainEnabled = nextChainEnabled;
        workstationState.chainCount = nextCount;
        liveUI.chain_enabled = nextChainEnabled;
        liveUI.chain_count = nextCount;
        syncFromBendUI(w, bendEngine.live_ui_set_mode(liveUI, nextMode));
    } else if (nextChainEnabled !== workstationState.chainEnabled) {
        workstationState.chainEnabled = nextChainEnabled;
        workstationState.chainCount = nextCount;
        liveUI.chain_count = nextCount;
        syncFromBendUI(w, bendEngine.live_ui_toggle_chain(liveUI));
    } else if (nextCount !== workstationState.chainCount) {
        workstationState.chainCount = nextCount;
        syncFromBendUI(w, bendEngine.live_ui_set_depth(liveUI, nextCount));
    }
}

function deleteFBO2Attachments(gl, fbo) {
    if (!gl || !fbo) return;
    if (Array.isArray(fbo.attachments)) {
        for (const tex of fbo.attachments) {
            if (tex) gl.deleteTexture(tex);
        }
    }
    if (fbo.framebuffer) {
        gl.deleteFramebuffer(fbo.framebuffer);
    }
}

function disposeWorkstationResources(w) {
    if (!w) return;
    if (w.rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(w.rafId);
        w.rafId = null;
    }
    const gl = w.gl;
    if (gl && typeof gl.isContextLost === 'function' && !gl.isContextLost()) {
        if (w.shaderCache) {
            for (const entry of w.shaderCache.values()) {
                if (entry?.prog?.program) {
                    gl.deleteProgram(entry.prog.program);
                }
            }
        }
        if (w.displayProg?.program) {
            gl.deleteProgram(w.displayProg.program);
        }
        if (w.fbos) {
            deleteFBO2Attachments(gl, w.fbos.stateA);
            deleteFBO2Attachments(gl, w.fbos.stateB);
            deleteFBO2Attachments(gl, w.fbos.display);
        }
        if (w.paletteTex) {
            gl.deleteTexture(w.paletteTex);
        }
        if (w.vbo) {
            gl.deleteBuffer(w.vbo);
        }
        if (w.vao) {
            gl.deleteVertexArray(w.vao);
        }
    }
    w.shaderCache?.clear();
    w.computeProg = null;
    w.displayProg = null;
    w.paletteTex = null;
    w.vbo = null;
    w.vao = null;
    if (w.fbos) {
        w.fbos.stateA = null;
        w.fbos.stateB = null;
        w.fbos.display = null;
        w.fbos.hasDisplay = false;
        w.fbos.w = 0;
        w.fbos.h = 0;
    }
}

export function disposePlanarDomainColoring() {
    if (ws) {
        disposeWorkstationResources(ws);
        ws = null;
    }
    expressionDirty = true;
}

function ensureWorkstation(targetCanvas) {
    if (ws && ws.canvas === targetCanvas && ws.gl && !ws.gl.isContextLost()) {
        return ws;
    }
    if (ws && ws.canvas !== targetCanvas) {
        disposeWorkstationResources(ws);
        ws = null;
    }
    if (!targetCanvas || typeof targetCanvas.getContext !== 'function') {
        return null;
    }
    let gl = null;
    try {
        gl = targetCanvas.getContext('webgl2', {
            alpha: false,
            antialias: false,
            depth: false,
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance'
        });
    } catch (_err) {
        gl = null;
    }
    if (!gl) return null;

    const floatExt = gl.getExtension('EXT_color_buffer_float');
    if (!floatExt) return null;
    gl.getExtension('OES_texture_float_linear');

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const paletteTex = buildPaletteLUTTexture(gl);
    const displayProg = createProgramInfo(gl, [VS_QUAD, FS_DISPLAY]);

    const liveUI = bendEngine.live_ui_start();
    ws = {
        canvas: targetCanvas,
        gl,
        vao,
        vbo,
        paletteTex,
        displayProg,
        computeProg: null,
        compiled: null,
        shaderCache: new Map(),
        fbos: {
            stateA: null,
            stateB: null,
            display: null,
            hasDisplay: false,
            w: 0,
            h: 0,
            readIdx: 0
        },
        rafId: null,
        adaptiveBatchScale: 1.0,
        lastComputeFrameTime: 0.0,
        didComputePrevFrame: false,
        liveUI,
        remainingSteps: Number(liveUI.remaining_steps),
        completedSteps: Number(liveUI.completed_steps),
        activeTotalSteps: Number(liveUI.active_total_steps),
        needSeedPass: Boolean(liveUI.need_seed_pass),
        pendingCompute: false,
        dirtyDisplay: Boolean(liveUI.dirty_display),
        activeComputeCam: null,
        lastComputeSignature: '',
        lastCamSignature: '',
        lastStyleSignature: ''
    };
    expressionDirty = true;

    if (!targetCanvas.__domainContextListenersAttached) {
        targetCanvas.__domainContextListenersAttached = true;
        targetCanvas.addEventListener?.(
            'webglcontextlost',
            e => {
                e.preventDefault();
                if (ws) {
                    if (ws.rafId !== null && typeof cancelAnimationFrame === 'function') {
                        cancelAnimationFrame(ws.rafId);
                        ws.rafId = null;
                    }
                    ws.shaderCache?.clear();
                    ws.computeProg = null;
                    ws.displayProg = null;
                    ws.paletteTex = null;
                    ws.vao = null;
                    ws.vbo = null;
                    if (ws.fbos) {
                        ws.fbos.stateA = null;
                        ws.fbos.stateB = null;
                        ws.fbos.display = null;
                        ws.fbos.hasDisplay = false;
                        ws.fbos.w = 0;
                        ws.fbos.h = 0;
                    }
                    if (ws.liveUI) {
                        ws.liveUI.has_display = false;
                    }
                }
            },
            false
        );
        targetCanvas.addEventListener?.(
            'webglcontextrestored',
            () => {
                ws = null;
                expressionDirty = true;
                requestDomainRedraw(true);
            },
            false
        );
    }

    return ws;
}

function ensureWorkstationFBOs(w, fboW, fboH) {
    const { gl, fbos } = w;
    if (fbos.w === fboW && fbos.h === fboH && fbos.stateA && fbos.stateB && fbos.display) return;
    if (fbos.stateA && fbos.stateB && fbos.display) {
        resizeFBO2Attachments(gl, fbos.stateA, fboW, fboH);
        resizeFBO2Attachments(gl, fbos.stateB, fboW, fboH);
        resizeFBO2Attachments(gl, fbos.display, fboW, fboH);
    } else {
        fbos.stateA = createFBO2Attachments(gl, fboW, fboH);
        fbos.stateB = createFBO2Attachments(gl, fboW, fboH);
        fbos.display = createFBO2Attachments(gl, fboW, fboH);
    }
    fbos.hasDisplay = false;
    fbos.readIdx = 0;
    w.liveUI.has_display = false;
    w.liveUI.read_idx = 0;
    fbos.w = fboW;
    fbos.h = fboH;
}

function startWorkstationComputeJob(w, runtimeState, planeParams) {
    syncWorkstationStateFromCore(w, runtimeState);
    w.liveUI.mode = workstationState.mode;
    w.liveUI.chain_enabled = workstationState.chainEnabled;
    w.liveUI.chain_count = workstationState.chainCount;
    w.liveUI.read_idx = w.fbos.readIdx;
    w.liveUI.has_display = true;
    const nextUI = bendEngine.live_ui_preempt(w.liveUI);
    const outerMul = Math.max(1, w.compiled?.outerChainCount ?? 1);
    if (outerMul > 1) {
        nextUI.remaining_steps = Number(nextUI.remaining_steps) * outerMul;
        nextUI.active_total_steps = Number(nextUI.active_total_steps) * outerMul;
    }
    syncFromBendUI(w, nextUI);
    w.fbos.hasDisplay = Number(nextUI.remaining_steps) === 0 && Boolean(nextUI.has_display);
    w.pendingCompute = false;
    w.activeComputeCam = syncBigIntCameraFromPlaneParams(planeParams);
    workstationState.centerBigX = planeParams?.centerBigX ?? 0n;
    workstationState.centerBigY = planeParams?.centerBigY ?? 0n;
    workstationState.scaleMant = planeParams?.scaleMant ?? 2.4;
    workstationState.scaleExp10 = planeParams?.scaleExp10 ?? 0;
}

// Law 53, Law 54 & Law 58: immediate preemption on every camera/parameter update (zero stale work)
function invalidateWorkstationCompute(w, runtimeState, planeParams) {
    syncWorkstationStateFromCore(w, runtimeState);
    startWorkstationComputeJob(w, runtimeState, planeParams);
}

function computeParameterUniforms(runtimeState) {
    const expBase = runtimeState?.expBase ?? { re: Math.E, im: 0 };
    const expBr = Number(expBase.re) || 0;
    const expBi = Number(expBase.im) || 0;
    const expLnRe = expBr === 0 && expBi === 0 ? 0 : Math.log(Math.hypot(expBr, expBi));
    const expLnIm = expBr === 0 && expBi === 0 ? 0 : Math.atan2(expBi, expBr);

    const logBase = runtimeState?.logBase ?? { re: Math.E, im: 0 };
    const logBr = Number(logBase.re) || 0;
    const logBi = Number(logBase.im) || 0;
    const logLnRe = Math.log(Math.hypot(logBr, logBi));
    const logLnIm = Math.atan2(logBi, logBr);
    const logDen = logLnRe * logLnRe + logLnIm * logLnIm;
    const invLogLnRe = Number.isFinite(logDen) && logDen > 0 ? logLnRe / logDen : 1.0;
    const invLogLnIm = Number.isFinite(logDen) && logDen > 0 ? -logLnIm / logDen : 0.0;

    const besselOrder = runtimeState?.besselOrder ?? { re: 0, im: 0 };
    const powerExp = Number(runtimeState?.fractionalPowerN ?? 1);
    const branchAngle = Number.isFinite(Number(runtimeState?.branchCutAngle))
        ? Number(runtimeState.branchCutAngle)
        : Math.PI;

    const mA = runtimeState?.mobiusA ?? { re: 1, im: 0 };
    const mB = runtimeState?.mobiusB ?? { re: 0, im: 0 };
    const mC = runtimeState?.mobiusC ?? { re: 0, im: 0 };
    const mD = runtimeState?.mobiusD ?? { re: 1, im: 0 };

    return {
        u_branchCutAngle: branchAngle,
        u_expBaseLnReQS: splitDoubleToQS(expLnRe),
        u_expBaseLnImQS: splitDoubleToQS(expLnIm),
        u_logBaseInvLnReQS: splitDoubleToQS(invLogLnRe),
        u_logBaseInvLnImQS: splitDoubleToQS(invLogLnIm),
        u_besselOrderReQS: splitDoubleToQS(Number(besselOrder.re) || 0),
        u_besselOrderImQS: splitDoubleToQS(Number(besselOrder.im) || 0),
        u_powerExpReQS: splitDoubleToQS(powerExp),
        u_mobiusAReQS: splitDoubleToQS(Number(mA.re) || 0),
        u_mobiusAImQS: splitDoubleToQS(Number(mA.im) || 0),
        u_mobiusBReQS: splitDoubleToQS(Number(mB.re) || 0),
        u_mobiusBImQS: splitDoubleToQS(Number(mB.im) || 0),
        u_mobiusCReQS: splitDoubleToQS(Number(mC.re) || 0),
        u_mobiusCImQS: splitDoubleToQS(Number(mC.im) || 0),
        u_mobiusDReQS: splitDoubleToQS(Number(mD.re) || 0),
        u_mobiusDImQS: splitDoubleToQS(Number(mD.im) || 0)
    };
}

function runWorkstationComputePass(w, passIndex, batchSteps, doneBeforePass, totalStepsForJob, camUniforms, runtimeState) {
    const { gl, fbos, computeProg, vao } = w;
    const readFbo = fbos.readIdx === 0 ? fbos.stateA : fbos.stateB;
    const writeFbo = fbos.readIdx === 0 ? fbos.stateB : fbos.stateA;
    const useChainSeed = runtimeState.chainingEnabled && runtimeState.chainingMode === 'zero_seed' ? 1 : 0;
    const seedRe = Number(runtimeState.chainSeed?.re) || 0;
    const seedIm = Number(runtimeState.chainSeed?.im) || 0;
    const paramUniforms = computeParameterUniforms(runtimeState);

    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo.framebuffer);
    gl.viewport(0, 0, fbos.w, fbos.h);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.useProgram(computeProg.program);
    gl.bindVertexArray(vao);
    setProgramUniforms(gl, computeProg, {
        u_prevRe: readFbo.attachments[0],
        u_prevIm: readFbo.attachments[1],
        u_resolution: [fbos.w, fbos.h],
        u_centerReQS: camUniforms.centerReQS,
        u_centerImQS: camUniforms.centerImQS,
        u_scaleQS: camUniforms.scaleQS,
        u_zero: 0.0,
        u_passIndex: passIndex,
        u_batchSteps: batchSteps,
        u_completedSteps: doneBeforePass,
        u_totalSteps: totalStepsForJob,
        u_recurrenceMode: Number(bendEngine.live_ui_is_recurrence(workstationState.mode, workstationState.chainEnabled)),
        u_outerChainCount: w.compiled?.outerChainCount ?? 1,
        u_outerPowExp: w.compiled?.outerPowExp ?? 1,
        u_innerStageCounts: w.compiled?.innerStageCounts ?? [1, 1, 1, 1, 1, 1, 1, 1],
        u_innerStagePows: w.compiled?.innerStagePows ?? [1, 1, 1, 1, 1, 1, 1, 1],
        u_useChainSeed: useChainSeed,
        u_chainSeedReQS: splitDoubleToQS(seedRe),
        u_chainSeedImQS: splitDoubleToQS(seedIm),
        ...paramUniforms
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
}

function buildComputeStateSignature(compiled, runtimeState) {
    const mode = getBendRecurrenceMode(runtimeState);
    const chainEnabled = Boolean(runtimeState.chainingEnabled);
    const chainCount = chainEnabled ? Math.max(1, Math.floor(Number(runtimeState.chainCount) || 1)) : 1;
    const seedMode = chainEnabled ? runtimeState.chainingMode : 'recursion';
    const seedRe = seedMode === 'zero_seed' ? Number(runtimeState.chainSeed?.re) || 0 : 0;
    const seedIm = seedMode === 'zero_seed' ? Number(runtimeState.chainSeed?.im) || 0 : 0;
    const expRe = Number(runtimeState.expBase?.re) || 0;
    const expIm = Number(runtimeState.expBase?.im) || 0;
    const logRe = Number(runtimeState.logBase?.re) || 0;
    const logIm = Number(runtimeState.logBase?.im) || 0;
    const besRe = Number(runtimeState.besselOrder?.re) || 0;
    const besIm = Number(runtimeState.besselOrder?.im) || 0;
    const powN = Number(runtimeState.fractionalPowerN ?? 1);
    const branch = Number(runtimeState.branchCutAngle ?? Math.PI);
    const mob = `${runtimeState.mobiusA?.re},${runtimeState.mobiusA?.im},${runtimeState.mobiusB?.re},${runtimeState.mobiusB?.im},${runtimeState.mobiusC?.re},${runtimeState.mobiusC?.im},${runtimeState.mobiusD?.re},${runtimeState.mobiusD?.im}`;
    return `${compiled.shaderKey}|oc:${compiled.outerChainCount}|op:${compiled.outerPowExp}|m:${mode}|ce:${chainEnabled ? 1 : 0}|cc:${chainCount}|sm:${seedMode}|sr:${seedRe}|si:${seedIm}|eb:${expRe},${expIm}|lb:${logRe},${logIm}|bo:${besRe},${besIm}|pn:${powN}|br:${branch}|mb:${mob}`;
}

function buildCameraSignature(planeParams) {
    const flt = `flt:${planeParams?.origin?.x}:${planeParams?.origin?.y}:${planeParams?.scale?.x}:${planeParams?.width}x${planeParams?.height}`;
    if (
        typeof planeParams?.centerBigX === 'bigint' &&
        typeof planeParams?.centerBigY === 'bigint' &&
        Number.isFinite(planeParams?.scaleMant) &&
        Number.isFinite(planeParams?.scaleExp10)
    ) {
        return `big:${planeParams.centerBigX}:${planeParams.centerBigY}:${planeParams.scaleMant}:${planeParams.scaleExp10}|${flt}`;
    }
    return flt;
}

function buildStyleSignature(runtimeState) {
    return `${runtimeState.domainPalette}|${runtimeState.domainBrightness}|${runtimeState.domainContrast}|${runtimeState.domainSaturation}|${runtimeState.domainLightnessCycles}|${runtimeState.domainResScale}|${runtimeState.domainShowModulus}|${runtimeState.domainShowPhase}`;
}

export function synchronizePlanarDomainVisibility() {
    const canvas = context.zDomainColorCanvas || context.controls?.zPlaneDomainCanvas;
    if (!canvas) return false;
    const visible = Boolean(
        state.domainColoringEnabled &&
        !state.laplaceModeEnabled &&
        !state.realPlotsEnabled &&
        !state.manifoldTransformationEnabled
    );
    if (canvas.hidden === visible) {
        canvas.hidden = !visible;
    }
    if (!visible) {
        cancelPlanarDomainColoring();
    }
    return visible;
}

export function hasPlanarDomainDisplay() {
    return Boolean(ws && ws.fbos && ws.fbos.hasDisplay);
}

export function cancelPlanarDomainColoring() {
    if (ws) {
        if (ws.rafId !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(ws.rafId);
            ws.rafId = null;
        }
    }
}

subscribeState(() => {
    expressionDirty = true;
    context.domainColoringDirty = true;
    requestDomainRedraw(true);
    if (ws && state.domainColoringEnabled) scheduleWorkstationFrame(ws, zPlaneParams);
}, [
    'currentFunction',
    'mapPresentation',
    'expBase',
    'logBase',
    'besselOrder',
    'mobiusA',
    'mobiusB',
    'mobiusC',
    'mobiusD',
    'algebraicChainingEnabled',
    'algebraicChainingZExpr',
    'algebraicChainingTerms',
    'polynomialN',
    'polynomialCoeffs',
    'fractionalPowerN',
    'branchCutAngle',
    'zetaContinuationEnabled',
    'taylorSeriesEnabled',
    'taylorSeriesOrder',
    'taylorSeriesCenter',
    'taylorSeriesConvergenceRadius'
]);

subscribeState(() => {
    context.domainColoringDirty = true;
    requestDomainRedraw(true);
    if (ws && state.domainColoringEnabled) scheduleWorkstationFrame(ws, zPlaneParams);
}, [
    'chainingEnabled',
    'chainingMode',
    'chainSeed',
    'chainCount',
    'orbitColoringMode',
    'dynamicPlotting',
    'domainBrightness',
    'domainContrast',
    'domainSaturation',
    'domainLightnessCycles',
    'domainResScale',
    'domainShowModulus',
    'domainShowPhase',
    'domainPalette'
]);

subscribeState(({ value }) => {
    context.domainColoringDirty = true;
    synchronizePlanarDomainVisibility();
    requestDomainRedraw(true);
    if (!value) cancelPlanarDomainColoring();
    else if (ws) scheduleWorkstationFrame(ws, zPlaneParams);
}, 'domainColoringEnabled');

subscribeState(() => {
    synchronizePlanarDomainVisibility();
    requestDomainRedraw(true);
    if (ws && state.domainColoringEnabled) scheduleWorkstationFrame(ws, zPlaneParams);
}, ['laplaceModeEnabled', 'realPlotsEnabled', 'manifoldTransformationEnabled']);

function scheduleWorkstationFrame(w, pP) {
    if (!w || w.rafId !== null || typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
    w.rafId = requestAnimationFrame(() => {
        w.rafId = null;
        if (!state.domainColoringEnabled || !w.canvas || w.canvas.hidden) {
            return;
        }
        stepWorkstationFrame(w, pP || zPlaneParams);
    });
}

function stepWorkstationFrame(w, pP = zPlaneParams) {
    const { gl, fbos } = w;
    if (!gl || gl.isContextLost()) return false;
    if (w.rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(w.rafId);
        w.rafId = null;
    }

    // 120 FPS adaptive batch controller (Laws 61 & 62): scale the per-frame batch from the measured frame delta
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (w.didComputePrevFrame && w.lastComputeFrameTime > 0) {
        const frameDt = now - w.lastComputeFrameTime;
        if (frameDt > 14.0) {
            w.adaptiveBatchScale = Math.max(0.15, w.adaptiveBatchScale * (10.0 / Math.min(frameDt, 80.0)));
        } else if (frameDt < 7.5) {
            w.adaptiveBatchScale = Math.min(1.5, w.adaptiveBatchScale * 1.12);
        }
    }
    w.lastComputeFrameTime = now;
    w.didComputePrevFrame = false;

    const cssW = Math.max(1, Math.floor(pP?.width || w.canvas.clientWidth || 0));
    const cssH = Math.max(1, Math.floor(pP?.height || w.canvas.clientHeight || 0));
    if (cssW === 0 || cssH === 0) return false;

    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
    const dispW = Math.max(1, Math.floor(cssW * dpr));
    const dispH = Math.max(1, Math.floor(cssH * dpr));

    if (!w.computeProg || !w.compiled || expressionDirty) {
        const compiled = compileStateToUnifiedExpression(state);
        workstationState.expr = compiled.fullGLSL;
        if (!w.computeProg || w.compiled?.shaderKey !== compiled.shaderKey) {
            const cached = w.shaderCache.get(compiled.shaderKey);
            if (cached) {
                w.computeProg = cached.prog;
                w.compiled = compiled;
            } else {
                const fsSrc = buildComputeShader(compiled);
                const newProg = createProgramInfo(gl, [VS_QUAD, fsSrc]);
                w.shaderCache.set(compiled.shaderKey, { prog: newProg, compiled });
                w.computeProg = newProg;
                w.compiled = compiled;
            }
        } else {
            w.compiled = compiled;
        }
        expressionDirty = false;
    }

    if (w.canvas.width !== dispW || w.canvas.height !== dispH) {
        w.canvas.width = dispW;
        w.canvas.height = dispH;
        w.lastComputeSignature = '';
    }

    const maxTex = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2560, 2560);
    const fboScaleCap = Math.min(workstationState.resScale, maxTex / Math.max(1, dispW, dispH));
    const fboW = Math.max(1, Math.floor(dispW * fboScaleCap));
    const fboH = Math.max(1, Math.floor(dispH * fboScaleCap));
    if (fbos.w !== fboW || fbos.h !== fboH || !fbos.stateA) {
        ensureWorkstationFBOs(w, fboW, fboH);
        w.lastComputeSignature = '';
    }

    const computeSig = buildComputeStateSignature(w.compiled, state);
    const camSig = buildCameraSignature(pP);
    const styleSig = buildStyleSignature(state);

    if (computeSig !== w.lastComputeSignature) {
        w.lastComputeSignature = computeSig;
        w.lastCamSignature = camSig;
        invalidateWorkstationCompute(w, state, pP);
    } else if (camSig !== w.lastCamSignature) {
        w.lastCamSignature = camSig;
        invalidateWorkstationCompute(w, state, pP);
    }

    if (styleSig !== w.lastStyleSignature) {
        w.lastStyleSignature = styleSig;
        syncWorkstationStateFromCore(w, state);
        w.dirtyDisplay = true;
        w.liveUI.dirty_display = true;
    }

    if (!w.needSeedPass && w.remainingSteps <= 0 && w.pendingCompute) {
        startWorkstationComputeJob(w, state, pP);
    }

    const isBusyCompute = w.needSeedPass || w.remainingSteps > 0;
    let didGlWork = false;

    if (isBusyCompute && w.computeProg && w.compiled) {
        // Law 44, Law 54, Law 61 & Law 62: adaptive non-blocking progressive batch (1 batch per frame, immediate presentation)
        const baseBatch = w.compiled.batchSize;
        const batchCap = w.needSeedPass
            ? Math.max(1, Math.min(8, Math.ceil(baseBatch * 0.5 * w.adaptiveBatchScale)))
            : Math.max(1, Math.round(baseBatch * w.adaptiveBatchScale));
        const passIdx = w.needSeedPass ? 0 : 1;
        const chunk = Math.min(w.remainingSteps, batchCap);
        runWorkstationComputePass(
            w,
            passIdx,
            chunk,
            w.completedSteps,
            w.activeTotalSteps,
            w.activeComputeCam || syncBigIntCameraFromPlaneParams(pP),
            state
        );
        const liveUI = w.liveUI;
        syncFromBendUI(w, bendEngine.live_ui_step_batch(liveUI, batchCap));
        didGlWork = true;
        w.didComputePrevFrame = true;

        if (w.remainingSteps <= 0) {
            // Law 13 & Law 43: atomic swap of the completed f^(N)(z) FBO into fbos.display
            if (fbos.readIdx === 1) {
                const tmp = fbos.display;
                fbos.display = fbos.stateB;
                fbos.stateB = tmp;
            } else {
                const tmp = fbos.display;
                fbos.display = fbos.stateA;
                fbos.stateA = tmp;
            }
            fbos.hasDisplay = true;
            w.liveUI.has_display = true;
            w.dirtyDisplay = true;
            w.liveUI.dirty_display = true;

            if (w.pendingCompute) {
                startWorkstationComputeJob(w, state, pP);
            }
        }
    }

    // Law 58: Bend-verified zero-blackout display presentation guard
    const liveUI = w.liveUI;
    const mustPresent = Boolean(bendEngine.live_ui_must_present(didGlWork, liveUI));
    if (mustPresent && (fbos.hasDisplay || w.completedSteps > 0)) {
        w.dirtyDisplay = false;
        liveUI.dirty_display = false;
        const latestComputeFbo = fbos.readIdx === 1 ? fbos.stateB : fbos.stateA;
        const stateFbo = fbos.hasDisplay ? fbos.display : latestComputeFbo;
        const state = workstationState;
        const activeSsaa = state.resScale;

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, dispW, dispH);
        gl.useProgram(w.displayProg.program);
        gl.bindVertexArray(w.vao);

        setProgramUniforms(gl, w.displayProg, {
            u_stateReTex: stateFbo.attachments[0],
            u_stateImTex: stateFbo.attachments[1],
            u_paletteLUT: w.paletteTex,
            u_resolution: [dispW, dispH],
            u_fboResolution: [fbos.w, fbos.h],
            u_zero: 0.0,
            u_recurrenceMode: Number(bendEngine.live_ui_is_recurrence(workstationState.mode, workstationState.chainEnabled)),
            u_palette: workstationState.palette,
            u_paletteCount: domainPalettes.length,
            u_showModulus: workstationState.showModulus ? 1 : 0,
            u_showPhase: workstationState.showPhase ? 1 : 0,
            u_ssaa: activeSsaa,
            u_bcs: [workstationState.brightness, workstationState.contrast, workstationState.saturation]
        });
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
    }

    const stillRunning = w.needSeedPass || w.remainingSteps > 0 || w.pendingCompute || w.dirtyDisplay;
    if (stillRunning) {
        scheduleWorkstationFrame(w, pP);
    }

    return true;
}

export function renderPlanarDomainColoring(tCtxOrCanvas, pP = zPlaneParams) {
    synchronizePlanarDomainVisibility();
    const targetCanvas =
        tCtxOrCanvas && typeof tCtxOrCanvas.getContext === 'function'
            ? tCtxOrCanvas
            : tCtxOrCanvas?.canvas || context.zDomainColorCanvas;

    const w = ensureWorkstation(targetCanvas);
    if (!w) return false;
    return stepWorkstationFrame(w, pP);
}

// ============================================================================
// 5. UNIFIED CATMULL-ROM + FS_DISPLAY COLOR EVALUATOR (FOR PALETTE GUIDE & WHEEL)
// ============================================================================
function glslSmoothstep(edge0, edge1, x) {
    const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3.0 - 2.0 * t);
}

function evaluateCatmullRomPalette(paletteId, normPhase) {
    const stops = getDomainPaletteStops(paletteId);
    const rgbs = stops.length > 1 &&
        stops[0][0] === stops[stops.length - 1][0] &&
        stops[0][1] === stops[stops.length - 1][1] &&
        stops[0][2] === stops[stops.length - 1][2]
        ? stops.slice(0, -1)
        : stops;
    const N = rgbs.length;
    const wrapped = ((normPhase % 1.0) + 1.0) % 1.0;
    const u = wrapped * N;
    const i = Math.floor(u) % N;
    const t = u - Math.floor(u);
    const p0 = rgbs[(i - 1 + N) % N];
    const p1 = rgbs[i];
    const p2 = rgbs[(i + 1) % N];
    const p3 = rgbs[(i + 2) % N];
    return [
        Math.max(0.0, Math.min(1.0, catmullRomSpline(p0[0], p1[0], p2[0], p3[0], t))),
        Math.max(0.0, Math.min(1.0, catmullRomSpline(p0[1], p1[1], p2[1], p3[1], t))),
        Math.max(0.0, Math.min(1.0, catmullRomSpline(p0[2], p1[2], p2[2], p3[2], t)))
    ];
}

export function domainColorForValue(re, im, runtimeState) {
    requireFiniteNumber(re, 'Domain-color real value');
    requireFiniteNumber(im, 'Domain-color imaginary value');
    if (!runtimeState || typeof runtimeState !== 'object') {
        throw new Error('Domain coloring requires explicit style state.');
    }
    const cycles = requireFiniteNumber(runtimeState.domainLightnessCycles, 'Domain lightness detail');
    const contrast = requireFiniteNumber(runtimeState.domainContrast, 'Domain contrast');
    const brightness = requireFiniteNumber(runtimeState.domainBrightness, 'Domain brightness');
    const saturation = requireFiniteNumber(runtimeState.domainSaturation, 'Domain saturation');
    if (typeof runtimeState.domainPalette !== 'string' || !runtimeState.domainPalette) {
        throw new Error('Domain coloring requires an explicit palette.');
    }

    const magApprox = Math.hypot(re, im);
    const log2Mag = magApprox === 0 ? -126.0 : Math.log2(magApprox);
    let col;

    if (log2Mag <= -125.0) {
        col = [0.03, 0.03, 0.04];
    } else {
        const phase = Math.atan2(im, re);
        const normPhase = (((phase + Math.PI) / (2.0 * Math.PI)) % 1.0 + 1.0) % 1.0;
        const fracMag = log2Mag - Math.floor(log2Mag);
        col = evaluateCatmullRomPalette(runtimeState.domainPalette, normPhase);

        if (cycles > 0.0001) {
            const fwMod = 0.02;
            const nyquistFade = 1.0 - glslSmoothstep(0.16, 0.45, fwMod);
            const distToRing = Math.min(fracMag, 1.0 - fracMag);
            const ringLine = 1.0 - (1.0 - glslSmoothstep(0.0, 1.35, distToRing / Math.max(fwMod, 1e-4))) * nyquistFade;
            const octaveSaw = fracMag - 0.5;
            const harmonicWave = Math.sin(2.0 * Math.PI * fracMag);
            const bandShade = 1.0 + 0.16 * octaveSaw * (0.42 + 0.58 * nyquistFade) - 0.09 * harmonicWave * (0.35 + 0.65 * nyquistFade);
            const modGain = (1.0 * ringLine + 0.66 * (1.0 - ringLine)) * bandShade;
            col = [col[0] * modGain, col[1] * modGain, col[2] * modGain];
        }

        const zeroDark = 1.0 - 0.86 * Math.exp(-magApprox * 1.85);
        const poleGlow = glslSmoothstep(4.0, 10.5, log2Mag);
        const poleColor = [0.97, 0.96, 0.93];
        const poleMix = poleGlow * 0.34;
        col = [
            col[0] * zeroDark * (1.0 - poleMix) + poleColor[0] * poleMix,
            col[1] * zeroDark * (1.0 - poleMix) + poleColor[1] * poleMix,
            col[2] * zeroDark * (1.0 - poleMix) + poleColor[2] * poleMix
        ];
    }

    const bOffset = brightness - 1.0;
    const c0 = [
        (col[0] + bOffset - 0.5) * contrast + 0.5,
        (col[1] + bOffset - 0.5) * contrast + 0.5,
        (col[2] + bOffset - 0.5) * contrast + 0.5
    ];
    const luma = 0.2126 * c0[0] + 0.7152 * c0[1] + 0.0722 * c0[2];
    return [
        Math.min(255, Math.max(0, Math.round((luma * (1.0 - saturation) + c0[0] * saturation) * 255))),
        Math.min(255, Math.max(0, Math.round((luma * (1.0 - saturation) + c0[1] * saturation) * 255))),
        Math.min(255, Math.max(0, Math.round((luma * (1.0 - saturation) + c0[2] * saturation) * 255)))
    ];
}
