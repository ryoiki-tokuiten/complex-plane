import { state } from '../store/state.js';
import { ZETA_REFLECTION_POINT_RE } from '../constants/numerical.js';
import {
  DOMAIN_DYNAMICS_EXPONENT_MAX,
  DOMAIN_DYNAMICS_EXPONENT_MIN,
  DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE
} from '../constants/domain-dynamics.js';
import {
    buildDynamicAggregateGLSL,
    dynamicAggregateGLSLSignature,
    isDynamicAggregateGLSLActive,
    compileCustomExpressionToGLSL,
    GLSL_EXPRESSION_HELPERS
} from '../math/expression/glsl.js';
/**
 * Shared WebGL utility functions and common GLSL shaders for complex arithmetic.
 */

export const GLSL_COMPLEX_MATH_LIBRARY_BASE = `
uniform vec2 u_expBase;
uniform vec2 u_logBase;
uniform vec2 u_besselOrder;
uniform float u_branchCutAngle;
const float PI = 3.1415926535897932384626433832795;
const float TWO_PI = 6.283185307179586476925286766559;
const float LOG_TWO = 0.6931471805599453094172321214582;
const int ZETA_GPU_TERMS = 72;

float safeExp(float x) { return exp(clamp(x, ${DOMAIN_DYNAMICS_EXPONENT_MIN}.0, ${DOMAIN_DYNAMICS_EXPONENT_MAX})); }
float coshCompat(float x) { return 0.5 * (safeExp(x) + safeExp(-x)); }
float sinhCompat(float x) { return 0.5 * (safeExp(x) - safeExp(-x)); }
bool isFiniteFloatCompat(float value) { return (value == value) && abs(value) < ${DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE.toExponential(1)}; }
bool isFiniteVec2Compat(vec2 value) { return isFiniteFloatCompat(value.x) && isFiniteFloatCompat(value.y); }
vec2 complexAdd(vec2 a, vec2 b) { return a + b; }
vec2 complexMul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 complexDiv(vec2 num, vec2 den) { float denMagSq = max(dot(den, den), 1.0e-30); return vec2((num.x * den.x + num.y * den.y) / denMagSq, (num.y * den.x - num.x * den.y) / denMagSq); }
vec2 complexExp(vec2 z) { float e = safeExp(z.x); return vec2(e * cos(z.y), e * sin(z.y)); }
vec2 complexLn(vec2 z) { return vec2(log(length(z)), atan(z.y, z.x)); }
float activeBranchArgument(vec2 z) {
  float argument = atan(z.y, z.x);
  if (argument > u_branchCutAngle) argument -= TWO_PI;
  if (argument <= u_branchCutAngle - TWO_PI) argument += TWO_PI;
  return argument;
}
vec2 complexLnActive(vec2 z) { return vec2(log(length(z)), activeBranchArgument(z)); }
vec2 complexSin(vec2 z) { return vec2(sin(z.x) * coshCompat(z.y), cos(z.x) * sinhCompat(z.y)); }
vec2 complexCos(vec2 z) { return vec2(cos(z.x) * coshCompat(z.y), -sin(z.x) * sinhCompat(z.y)); }
vec2 complexSqrt(vec2 z) { float r = length(z); if (r < 1.0e-20) return vec2(0.0); float a = atan(z.y, z.x) * 0.5; float sr = sqrt(r); return vec2(sr * cos(a), sr * sin(a)); }
vec2 complexExpWithBase(vec2 z) {
  if (dot(u_expBase, u_expBase) < 1.0e-20) return vec2(1.0e31);
  return complexExp(complexMul(z, complexLn(u_expBase)));
}
vec2 complexLogWithBase(vec2 z) {
  vec2 denominator = complexLn(u_logBase);
  if (dot(denominator, denominator) < 1.0e-20) return vec2(1.0e31);
  return complexDiv(complexLnActive(z), denominator);
}
vec2 complexArcsin(vec2 z) { vec2 s = complexSqrt(vec2(1.0, 0.0) - complexMul(z, z)); vec2 lv = complexLn(vec2(-z.y, z.x) + s); return vec2(lv.y, -lv.x); }
vec2 complexArctan(vec2 z) { vec2 upper = complexLn(vec2(1.0 - z.y, z.x)); vec2 lower = complexLn(vec2(1.0 + z.y, -z.x)); vec2 d = upper - lower; return vec2(0.5 * d.y, -0.5 * d.x); }
vec2 complexLogGammaPositive(vec2 z) {
  vec2 zm = z - vec2(1.0, 0.0);
  vec2 x = vec2(0.99999999999980993, 0.0);
  x += complexDiv(vec2(676.5203681218851, 0.0), zm + vec2(1.0, 0.0));
  x += complexDiv(vec2(-1259.1392167224028, 0.0), zm + vec2(2.0, 0.0));
  x += complexDiv(vec2(771.3234287776531, 0.0), zm + vec2(3.0, 0.0));
  x += complexDiv(vec2(-176.6150291621406, 0.0), zm + vec2(4.0, 0.0));
  x += complexDiv(vec2(12.507343278686905, 0.0), zm + vec2(5.0, 0.0));
  x += complexDiv(vec2(-0.13857109526572012, 0.0), zm + vec2(6.0, 0.0));
  x += complexDiv(vec2(9.984369578019572e-6, 0.0), zm + vec2(7.0, 0.0));
  x += complexDiv(vec2(1.5056327351493116e-7, 0.0), zm + vec2(8.0, 0.0));
  vec2 t = z + vec2(6.5, 0.0);
  return vec2(0.9189385332046727, 0.0) + complexMul(z - vec2(0.5, 0.0), complexLn(t)) - t + complexLn(x);
}
vec2 complexLogGamma(vec2 z) {
  if (z.x < 0.5) return vec2(log(PI), 0.0) - complexLn(complexSin(PI * z)) - complexLogGammaPositive(vec2(1.0 - z.x, -z.y));
  return complexLogGammaPositive(z);
}
vec2 complexGamma(vec2 z) { return complexExp(complexLogGamma(z)); }
vec2 complexBesselJ(vec2 z, vec2 orderValue) {
  vec2 nu = orderValue;
  float signValue = 1.0;
  float nearest = floor(-nu.x + 0.5);
  if (abs(nu.y) < 1.0e-6 && nu.x < 0.0 && abs(-nu.x - nearest) < 1.0e-5) { nu.x = -nu.x; if (mod(nearest, 2.0) > 0.5) signValue = -1.0; }
  if (dot(z, z) < 1.0e-20) return abs(nu.x) < 1.0e-6 && abs(nu.y) < 1.0e-6 ? vec2(signValue, 0.0) : vec2(0.0);
  vec2 term = complexExp(complexMul(nu, complexLn(z * 0.5)) - complexLogGamma(nu + vec2(1.0, 0.0)));
  vec2 sum = term;
  vec2 stepValue = -0.25 * complexMul(z, z);
  for (int k = 0; k < 128; k++) {
    float kp = float(k + 1);
    term = complexDiv(complexMul(term, stepValue), complexMul(vec2(kp, 0.0), nu + vec2(kp, 0.0)));
    sum += term;
    if (length(term) <= 1.0e-6 * max(1.0, length(sum))) break;
  }
  return signValue * sum;
}
vec2 evalPolynomial(vec2 z, int degree, vec2 coeffs[11]) { vec2 acc = vec2(0.0, 0.0); vec2 zPow = vec2(1.0, 0.0); for (int i = 0; i <= 10; i++) { if (i <= degree) { acc = complexAdd(acc, complexMul(coeffs[i], zPow)); } zPow = complexMul(zPow, z); } return acc; }
vec2 complexPowPositiveRealBase(float positiveBase, vec2 exponent) { float lnBase = log(max(positiveBase, 1.0e-30)); float magnitude = safeExp(exponent.x * lnBase); float angle = exponent.y * lnBase; return vec2(magnitude * cos(angle), magnitude * sin(angle)); }
bool evaluateZeta(vec2 s, float contEnabled, float reflBoundary, out vec2 value) { if (abs(s.x - 1.0) < 1.0e-6 && abs(s.y) < 1.0e-6) return false; if (contEnabled < 0.5 && s.x <= reflBoundary) return false; vec2 etaSum = vec2(0.0, 0.0); vec2 negS = vec2(-s.x, -s.y); for (int n = 1; n <= ZETA_GPU_TERMS; n++) { vec2 nPowNegS = complexPowPositiveRealBase(float(n), negS); float alternatingSign = (mod(float(n), 2.0) < 0.5) ? -1.0 : 1.0; etaSum += nPowNegS * alternatingSign; } vec2 oneMinusS = vec2(1.0 - s.x, -s.y); vec2 twoPowOneMinusS = complexPowPositiveRealBase(2.0, oneMinusS); vec2 denominator = vec2(1.0, 0.0) - twoPowOneMinusS; if (dot(denominator, denominator) < 1.0e-18) return false; value = complexDiv(etaSum, denominator); return isFiniteVec2Compat(value); }

vec2 complexSinh(vec2 z) { return vec2(sinhCompat(z.x) * cos(z.y), coshCompat(z.x) * sin(z.y)); }
vec2 complexCosh(vec2 z) { return vec2(coshCompat(z.x) * cos(z.y), sinhCompat(z.x) * sin(z.y)); }
vec2 complexTanh(vec2 z) { vec2 den = complexCosh(z); if (dot(den,den) < 1.0e-18) return vec2(0.0); return complexDiv(complexSinh(z), den); }

bool evaluateBasicFuncShared(float fId, vec2 z, vec2 mA, vec2 mB, vec2 mC, vec2 mD, int polyDeg, vec2 polyCoeffs[11], float zetaCont, float zetaRefl, float fracPower, out vec2 mapped) {
  if (abs(fId - 1.0) < 0.5) { mapped = complexCos(z); return isFiniteVec2Compat(mapped); }
  if (abs(fId - 3.0) < 0.5) { vec2 denTan = complexCos(z); if (dot(denTan, denTan) < 1.0e-18) return false; mapped = complexDiv(complexSin(z), denTan); return isFiniteVec2Compat(mapped); }
  if (abs(fId - 4.0) < 0.5) { vec2 denSec = complexCos(z); if (dot(denSec, denSec) < 1.0e-18) return false; mapped = complexDiv(vec2(1.0, 0.0), denSec); return isFiniteVec2Compat(mapped); }
  if (abs(fId - 5.0) < 0.5) { mapped = complexExpWithBase(z); return isFiniteVec2Compat(mapped); }
  if (abs(fId - 6.0) < 0.5) { if (dot(z, z) < 1.0e-20) return false; mapped = complexLogWithBase(z); return isFiniteVec2Compat(mapped); }
  if (abs(fId - 8.0) < 0.5) { vec2 num = complexAdd(complexMul(mA, z), mB); vec2 den = complexAdd(complexMul(mC, z), mD); if (dot(den, den) < 1.0e-18) return false; mapped = complexDiv(num, den); return isFiniteVec2Compat(mapped); }
  if (abs(fId - 9.0) < 0.5) { mapped = evalPolynomial(z, polyDeg, polyCoeffs); return isFiniteVec2Compat(mapped); }
  if (abs(fId - 11.0) < 0.5) { return evaluateZeta(z, zetaCont, zetaRefl, mapped); }
  if (abs(fId - 12.0) < 0.5) { mapped = complexSinh(z); return isFiniteVec2Compat(mapped); }
  if (abs(fId - 14.0) < 0.5) { mapped = complexTanh(z); return isFiniteVec2Compat(mapped); }
  if (abs(fId - 15.0) < 0.5) { if (dot(z,z) < 1.0e-20) { mapped = vec2(0.0); return true; } vec2 lnZ = complexLnActive(z); mapped = complexExp(vec2(fracPower * lnZ.x, fracPower * lnZ.y)); return isFiniteVec2Compat(mapped); }
  if (abs(fId - 18.0) < 0.5) { mapped = complexArcsin(z); return isFiniteVec2Compat(mapped); }
  if (abs(fId - 19.0) < 0.5) { mapped = complexArctan(z); return isFiniteVec2Compat(mapped); }
  if (abs(fId - 20.0) < 0.5) { mapped = complexGamma(z); return isFiniteVec2Compat(mapped); }
  if (abs(fId - 21.0) < 0.5) { mapped = complexLogGamma(z); return isFiniteVec2Compat(mapped); }
  if (abs(fId - 22.0) < 0.5) { mapped = complexBesselJ(z, u_besselOrder); return isFiniteVec2Compat(mapped); }
  return false;
}
`;

export const GLSL_COMPLEX_INVERSE_LIBRARY = `
vec2 complexArccos(vec2 w) {
  vec2 wSq = complexMul(w, w);
  vec2 s = complexSqrt(vec2(1.0 - wSq.x, -wSq.y));
  vec2 lv = complexLn(complexAdd(w, vec2(-s.y, s.x)));
  return vec2(lv.y, -lv.x);
}
vec2 complexArcsinh(vec2 w) {
  vec2 wSq = complexMul(w, w);
  vec2 s = complexSqrt(complexAdd(wSq, vec2(1.0, 0.0)));
  return complexLn(complexAdd(w, s));
}
vec2 complexArctanh(vec2 w) {
  vec2 one = vec2(1.0, 0.0);
  vec2 num = complexAdd(one, w);
  vec2 den = complexAdd(one, -w);
  if (dot(den,den) < 1.0e-18) return vec2(0.0);
  return complexMul(vec2(0.5, 0.0), complexLn(complexDiv(num, den)));
}
bool evaluateInverseFunction(vec2 w, float functionId, vec2 mA, vec2 mB, vec2 mC, vec2 mD, int polyDeg, vec2 polyCoeffs[11], float fracPower, out vec2 z) {
  float fId = floor(functionId + 0.5);
  if (abs(fId - 1.0) < 0.5) { z = complexArccos(w); return isFiniteVec2Compat(z); }
  if (abs(fId - 3.0) < 0.5) { z = complexArctan(w); return isFiniteVec2Compat(z); }
  if (abs(fId - 4.0) < 0.5) { if (dot(w,w) < 1.0e-18) return false; z = complexArccos(complexDiv(vec2(1.0,0.0), w)); return isFiniteVec2Compat(z); }
  if (abs(fId - 5.0) < 0.5) { if (dot(w,w) < 1.0e-20) return false; z = complexLn(w); return isFiniteVec2Compat(z); }
  if (abs(fId - 6.0) < 0.5) {
    if (w.y <= -PI || w.y > PI) return false;
    z = complexExp(w);
    return isFiniteVec2Compat(z);
  }
  if (abs(fId - 8.0) < 0.5) { vec2 num = complexAdd(complexMul(mD, w), -mB); vec2 den = complexAdd(-complexMul(mC, w), mA); if (dot(den,den) < 1.0e-18) return false; z = complexDiv(num, den); return isFiniteVec2Compat(z); }
  if (abs(fId - 9.0) < 0.5) {
    if (polyDeg == 1) { vec2 den = polyCoeffs[1]; if (dot(den,den) < 1.0e-18) return false; z = complexDiv(w - polyCoeffs[0], den); return isFiniteVec2Compat(z); }
    if (polyDeg == 2) { vec2 a=polyCoeffs[2]; vec2 b=polyCoeffs[1]; vec2 c=polyCoeffs[0]-w; vec2 disc=complexMul(b,b)-4.0*complexMul(a,c); vec2 sd=complexSqrt(disc); vec2 den=2.0*a; if(dot(den,den)<1.0e-18) return false; z=complexDiv(-b+sd,den); return isFiniteVec2Compat(z); }
    return false;
  }
  if (abs(fId - 12.0) < 0.5) { z = complexArcsinh(w); return isFiniteVec2Compat(z); }
  if (abs(fId - 14.0) < 0.5) { z = complexArctanh(w); return isFiniteVec2Compat(z); }
  if (abs(fId - 15.0) < 0.5) { 
    if (abs(fracPower) < 1.0e-6) return false;
    if (dot(w,w) < 1.0e-20) { z = vec2(0.0); return true; }
    vec2 lnW = complexLn(w);
    float invPower = 1.0 / fracPower;
    z = complexExp(vec2(invPower * lnW.x, invPower * lnW.y));
    return isFiniteVec2Compat(z);
  }
  return false;
}
`;


export function createWebGLShaderShared(gl, shaderType, source) {
    if (gl.isContextLost?.()) return null;
    const shader = gl.createShader(shaderType);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        if (!gl.isContextLost?.()) {
            console.warn('WebGL shader compile error:', gl.getShaderInfoLog(shader));
        }
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

export function createWebGLProgramShared(gl, vertexSource, fragmentSource) {
    if (gl.isContextLost?.()) return null;
    const vertexShader = createWebGLShaderShared(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = createWebGLShaderShared(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertexShader || !fragmentShader) {
        if (vertexShader) gl.deleteShader(vertexShader);
        if (fragmentShader) gl.deleteShader(fragmentShader);
        return null;
    }

    const program = gl.createProgram();
    if (!program) {
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        return null;
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        if (!gl.isContextLost?.()) {
            console.warn('WebGL program link error:', gl.getProgramInfoLog(program));
        }
        gl.deleteProgram(program);
        return null;
    }

    return program;
}

export function getWebGLBackendInfoShared(gl) {
    if (!gl) return null;
    const info = {
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        unmaskedVendor: null,
        unmaskedRenderer: null,
        softwareBackend: false
    };

    const rendererString = `${info.renderer || ''}`.toLowerCase();
    info.softwareBackend =
        rendererString.includes('swiftshader') ||
        rendererString.includes('llvmpipe') ||
        rendererString.includes('softpipe') ||
        rendererString.includes('software');
    return info;
}

const ALGEBRAIC_GLSL_MACROS = `#define EVAL_COS(V,O) O = complexCos(V); if (!isFiniteVec2Compat(O)) return false;
#define EVAL_TAN(V,O) { vec2 den = complexCos(V); if (dot(den, den) < 1.0e-18) return false; O = complexDiv(complexSin(V), den); if (!isFiniteVec2Compat(O)) return false; }
#define EVAL_SEC(V,O) { vec2 den = complexCos(V); if (dot(den, den) < 1.0e-18) return false; O = complexDiv(vec2(1.0, 0.0), den); if (!isFiniteVec2Compat(O)) return false; }
#define EVAL_EXP(V,O) O = complexExpWithBase(V); if (!isFiniteVec2Compat(O)) return false;
#define EVAL_LN(V,O) if (dot(V, V) < 1.0e-20) return false; O = complexLogWithBase(V); if (!isFiniteVec2Compat(O)) return false;
#define EVAL_MOBIUS(V,O) { vec2 num = complexAdd(complexMul(mA, V), mB); vec2 den = complexAdd(complexMul(mC, V), mD); if (dot(den, den) < 1.0e-18) return false; O = complexDiv(num, den); if (!isFiniteVec2Compat(O)) return false; }
#define EVAL_POLY(V,O) O = evalPolynomial(V, polyDeg, polyCoeffs); if (!isFiniteVec2Compat(O)) return false;
#define EVAL_ZETA(V,O) if (!evaluateZeta(V, zetaCont, zetaRefl, O)) return false;
#define EVAL_SINH(V,O) O = complexSinh(V); if (!isFiniteVec2Compat(O)) return false;
#define EVAL_TANH(V,O) O = complexTanh(V); if (!isFiniteVec2Compat(O)) return false;
#define EVAL_ASIN(V,O) O = complexArcsin(V); if (!isFiniteVec2Compat(O)) return false;
#define EVAL_ATAN(V,O) O = complexArctan(V); if (!isFiniteVec2Compat(O)) return false;
#define EVAL_GAMMA(V,O) O = complexGamma(V); if (!isFiniteVec2Compat(O)) return false;
#define EVAL_LOGGAMMA(V,O) O = complexLogGamma(V); if (!isFiniteVec2Compat(O)) return false;
#define EVAL_BESSEL(V,O) O = complexBesselJ(V, u_besselOrder); if (!isFiniteVec2Compat(O)) return false;
#define EVAL_POWER(V,O) { if (dot(V, V) < 1.0e-20) { O = vec2(0.0); } else { vec2 lnZ = complexLnActive(V); O = complexExp(vec2(fracPower * lnZ.x, fracPower * lnZ.y)); } if (!isFiniteVec2Compat(O)) return false; }
#define ALG_FACTOR_BEGIN { vec2 argZ = z; vec2 temp = vec2(0.0);
#define ALG_FACTOR_POWER(P) { float fPower = P; if (abs(fPower - 1.0) >= 1.0e-9) { if (dot(argZ, argZ) < 1.0e-20) { argZ = vec2(0.0); } else { vec2 lnZ = complexLnActive(argZ); argZ = complexExp(vec2(fPower * lnZ.x, fPower * lnZ.y)); } } }
#define ALG_FACTOR_RECIP if (dot(argZ, argZ) < 1.0e-18) return false; argZ = complexDiv(vec2(1.0, 0.0), argZ);
#define ALG_FACTOR_LOG if (dot(argZ, argZ) < 1.0e-20) return false; argZ = complexLogWithBase(argZ);
#define ALG_FACTOR_EXP argZ = complexExpWithBase(argZ);
#define ALG_FACTOR_END termVal = complexMul(termVal, argZ); }
`;

function generateAlgebraicDirectEvaluationGLSL(funcName, valVar, outVar) {
    switch (funcName) {
        case 'cos': return `        EVAL_COS(${valVar}, ${outVar})\n`;
        case 'tan': return `        EVAL_TAN(${valVar}, ${outVar})\n`;
        case 'sec': return `        EVAL_SEC(${valVar}, ${outVar})\n`;
        case 'exp': return `        EVAL_EXP(${valVar}, ${outVar})\n`;
        case 'ln': return `        EVAL_LN(${valVar}, ${outVar})\n`;
        case 'mobius': return `        EVAL_MOBIUS(${valVar}, ${outVar})\n`;
        case 'polynomial': return `        EVAL_POLY(${valVar}, ${outVar})\n`;
        case 'zeta': return `        EVAL_ZETA(${valVar}, ${outVar})\n`;
        case 'sinh': return `        EVAL_SINH(${valVar}, ${outVar})\n`;
        case 'tanh': return `        EVAL_TANH(${valVar}, ${outVar})\n`;
        case 'asin': return `        EVAL_ASIN(${valVar}, ${outVar})\n`;
        case 'atan': return `        EVAL_ATAN(${valVar}, ${outVar})\n`;
        case 'gamma': return `        EVAL_GAMMA(${valVar}, ${outVar})\n`;
        case 'loggamma': return `        EVAL_LOGGAMMA(${valVar}, ${outVar})\n`;
        case 'bessel': return `        EVAL_BESSEL(${valVar}, ${outVar})\n`;
        case 'power': return `        EVAL_POWER(${valVar}, ${outVar})\n`;
        default: return '';
    }
}

export function getWebGLFunctionIdShared(functionName, ignoreDynamic = false) {
    if (!ignoreDynamic && isDynamicAggregateGLSLActive(state)) return 17;
    switch (functionName) {
        case 'cos': return 1;
        case 'tan': return 3;
        case 'sec': return 4;
        case 'exp': return 5;
        case 'ln': return 6;
        case 'mobius': return 8;
        case 'polynomial': return 9;
        case 'zeta': return 11;
        case 'sinh': return 12;
        case 'tanh': return 14;
        case 'power': return 15;
        case 'asin': return 18;
        case 'atan': return 19;
        case 'gamma': return 20;
        case 'loggamma': return 21;
        case 'bessel': return 22;
        case 'algebraic_chaining': return 16;
        case 'dynamic_aggregate': return 17;
        default: return 0;
    }
}

export function setComplexFunctionUniformsShared(gl, locs, state) {
    if (locs.uFunctionId !== undefined && locs.uFunctionId !== null) {
        gl.uniform1f(locs.uFunctionId, getWebGLFunctionIdShared(state.currentFunction));
    }

    const a = state.mobiusA || { re: 1, im: 0 }, b = state.mobiusB || { re: 0, im: 0 };
    const c = state.mobiusC || { re: 0, im: 0 }, d = state.mobiusD || { re: 1, im: 0 };
    if (locs.uMobiusA !== undefined && locs.uMobiusA !== null) gl.uniform2f(locs.uMobiusA, a.re || 0, a.im || 0);
    if (locs.uMobiusB !== undefined && locs.uMobiusB !== null) gl.uniform2f(locs.uMobiusB, b.re || 0, b.im || 0);
    if (locs.uMobiusC !== undefined && locs.uMobiusC !== null) gl.uniform2f(locs.uMobiusC, c.re || 0, c.im || 0);
    if (locs.uMobiusD !== undefined && locs.uMobiusD !== null) gl.uniform2f(locs.uMobiusD, d.re || 0, d.im || 0);

    const deg = Math.max(0, Math.min(10, Number.isFinite(state.polynomialN) ? state.polynomialN : 0));
    if (locs.uPolyDegree !== undefined && locs.uPolyDegree !== null) gl.uniform1i(locs.uPolyDegree, deg);
    if (locs.uPolyCoeffs) {
        for (let i = 0; i <= 10; i++) {
            if (locs.uPolyCoeffs[i] !== undefined && locs.uPolyCoeffs[i] !== null) {
                const co = (state.polynomialCoeffs && state.polynomialCoeffs[i]) || null;
                gl.uniform2f(locs.uPolyCoeffs[i], co ? (co.re || 0) : 0, co ? (co.im || 0) : 0);
            }
        }
    }

    if (locs.uZetaCont !== undefined && locs.uZetaCont !== null) gl.uniform1f(locs.uZetaCont, state.zetaContinuationEnabled ? 1 : 0);
    if (locs.uZetaRefl !== undefined && locs.uZetaRefl !== null) gl.uniform1f(locs.uZetaRefl, typeof ZETA_REFLECTION_POINT_RE !== 'undefined' ? ZETA_REFLECTION_POINT_RE : 0.5);
    if (locs.uFracPower !== undefined && locs.uFracPower !== null) gl.uniform1f(locs.uFracPower, state.fractionalPowerN !== undefined ? state.fractionalPowerN : 0.5);
    const expBase = state.expBase || { re: Math.E, im: 0 };
    const logBase = state.logBase || { re: Math.E, im: 0 };
    const besselOrder = state.besselOrder || { re: 0, im: 0 };
    if (locs.uExpBase !== undefined && locs.uExpBase !== null) gl.uniform2f(locs.uExpBase, expBase.re, expBase.im);
    if (locs.uLogBase !== undefined && locs.uLogBase !== null) gl.uniform2f(locs.uLogBase, logBase.re, logBase.im);
    if (locs.uBesselOrder !== undefined && locs.uBesselOrder !== null) gl.uniform2f(locs.uBesselOrder, besselOrder.re, besselOrder.im);
    if (locs.uBranchCutAngle !== undefined && locs.uBranchCutAngle !== null) {
        gl.uniform1f(locs.uBranchCutAngle,
            state.branchCutType === 'ray' && Number.isFinite(state.branchCutAngle)
                ? state.branchCutAngle
                : Math.PI
        );
    }

    const algebraicLocs = locs.algebraicTerms;
    if (algebraicLocs) {
        const terms = state.algebraicChainingTerms || [];
        for (let termIndex = 0; termIndex < terms.length; termIndex++) {
            const term = terms[termIndex];
            const tLoc = algebraicLocs[termIndex];
            if (!tLoc) continue;
            if (tLoc.coeff !== undefined && tLoc.coeff !== null) {
                gl.uniform2f(tLoc.coeff, term?.coeff?.re || 0, term?.coeff?.im || 0);
            }
            const factors = term?.factors || [];
            const factorLocs = tLoc.factors;
            if (!factorLocs) continue;
            for (let factorIndex = 0; factorIndex < factors.length; factorIndex++) {
                const fLoc = factorLocs[factorIndex];
                if (fLoc && fLoc.power !== undefined && fLoc.power !== null) {
                    const f = factors[factorIndex];
                    gl.uniform1f(fLoc.power, f?.power !== undefined ? f.power : 1.0);
                }
            }
        }
    }
}

const hasOwn = Object.prototype.hasOwnProperty;

export function collectAlgebraicUniformLocationsShared(gl, program, appState, locs) {
    if (!appState) return;
    locs.uExpBase = gl.getUniformLocation(program, 'u_expBase');
    locs.uLogBase = gl.getUniformLocation(program, 'u_logBase');
    locs.uBesselOrder = gl.getUniformLocation(program, 'u_besselOrder');
    locs.uBranchCutAngle = gl.getUniformLocation(program, 'u_branchCutAngle');
    const terms = appState.algebraicChainingTerms || [];
    const algebraicTerms = new Array(terms.length);
    for (let termIndex = 0; termIndex < terms.length; termIndex++) {
        const term = terms[termIndex];
        const factors = (term && term.factors) || [];
        const factorLocs = new Array(factors.length);
        for (let factorIndex = 0; factorIndex < factors.length; factorIndex++) {
            factorLocs[factorIndex] = {
                power: gl.getUniformLocation(program, `u_algFactorPower_${termIndex}_${factorIndex}`)
            };
        }
        algebraicTerms[termIndex] = {
            coeff: gl.getUniformLocation(program, `u_algTermCoeff_${termIndex}`),
            factors: factorLocs
        };
    }
    locs.algebraicTerms = algebraicTerms;
}



const algebraicSignatureMemo = new WeakMap();
const appStateLibraryMemo = new WeakMap();
const WEBGL_SHARED_LIBRARY_CACHE_LIMIT = 512;
const webglSharedLibraryCache = new Map();

function snapshotAlgebraicTerms(terms) {
    const list = Array.isArray(terms) ? terms : [];
    const snapshot = [list.length];
    for (let termIndex = 0; termIndex < list.length; termIndex++) {
        const termPresent = hasOwn.call(list, termIndex);
        snapshot.push(termPresent);
        if (!termPresent) continue;
        const term = list[termIndex];
        const factors = Array.isArray(term && term.factors) ? term.factors : [];
        snapshot.push(factors.length);
        for (let factorIndex = 0; factorIndex < factors.length; factorIndex++) {
            const factorPresent = hasOwn.call(factors, factorIndex);
            snapshot.push(factorPresent);
            if (!factorPresent) continue;
            const factor = factors[factorIndex];
            const active = !!(factor && factor.func && factor.func !== 'none');
            snapshot.push(active);
            if (active) {
                snapshot.push(factor.func, factor.chainedFunc, !!factor.reciprocal, !!factor.log, !!factor.exp);
            }
        }
    }
    return snapshot;
}

function algebraicSnapshotMatches(terms, snapshot) {
    const list = Array.isArray(terms) ? terms : [];
    if (!snapshot || snapshot[0] !== list.length) return false;
    let cursor = 1;
    for (let termIndex = 0; termIndex < list.length; termIndex++) {
        const termPresent = hasOwn.call(list, termIndex);
        if (snapshot[cursor++] !== termPresent) return false;
        if (!termPresent) continue;
        const term = list[termIndex];
        const factors = Array.isArray(term && term.factors) ? term.factors : [];
        if (snapshot[cursor++] !== factors.length) return false;
        for (let factorIndex = 0; factorIndex < factors.length; factorIndex++) {
            const factorPresent = hasOwn.call(factors, factorIndex);
            if (snapshot[cursor++] !== factorPresent) return false;
            if (!factorPresent) continue;
            const factor = factors[factorIndex];
            const active = !!(factor && factor.func && factor.func !== 'none');
            if (snapshot[cursor++] !== active) return false;
            if (active) {
                if (snapshot[cursor++] !== factor.func) return false;
                if (snapshot[cursor++] !== factor.chainedFunc) return false;
                if (snapshot[cursor++] !== !!factor.reciprocal) return false;
                if (snapshot[cursor++] !== !!factor.log) return false;
                if (snapshot[cursor++] !== !!factor.exp) return false;
            }
        }
    }
    return cursor === snapshot.length;
}

export function getAlgebraicStructureSignatureShared(terms) {
    const list = Array.isArray(terms) ? terms : [];
    if (list.length) {
        const memo = algebraicSignatureMemo.get(list);
        if (memo && algebraicSnapshotMatches(list, memo.snapshot)) return memo.signature;
    }
    const signature = JSON.stringify(list.map(term => {
        const factors = Array.isArray(term && term.factors) ? term.factors : [];
        return {
            factors: factors.map(factor => (
                factor && factor.func && factor.func !== 'none'
                    ? {
                        func: factor.func,
                        chainedFunc: factor.chainedFunc,
                        reciprocal: !!factor.reciprocal,
                        log: !!factor.log,
                        exp: !!factor.exp
                    }
                    : { func: 'none' }
            ))
        };
    }));
    if (list.length) {
        algebraicSignatureMemo.set(list, { signature, snapshot: snapshotAlgebraicTerms(list) });
    }
    return signature;
}

function appStateMemoMatches(appState, memo, dynamicActive, dynamicSignature, zExpr) {
    return memo &&
        memo.dynamicActive === dynamicActive &&
        memo.dynamicSignature === dynamicSignature &&
        memo.zExpr === zExpr &&
        algebraicSnapshotMatches(appState.algebraicChainingTerms, memo.algebraicTerms);
}

function rememberAppStateLibrary(appState, dynamicActive, dynamicSignature, zExpr, cacheKey, source) {
    if (appState && (typeof appState === 'object' || typeof appState === 'function')) {
        appStateLibraryMemo.set(appState, {
            dynamicActive,
            dynamicSignature,
            zExpr,
            cacheKey,
            source,
            algebraicTerms: algebraicSignatureMemo.get(appState.algebraicChainingTerms)?.snapshot ?? snapshotAlgebraicTerms(appState.algebraicChainingTerms)
        });
    }
}

function getGLSLComplexMathLibraryCacheKey(appState, dynamicActive, dynamicSignature, zExpr) {
    if (!appState) return '';
    try {
        const algebraicSig = getAlgebraicStructureSignatureShared(appState.algebraicChainingTerms);
        return `d:${dynamicActive ? 1 : 0}:${dynamicSignature}|z:${zExpr}|a:${algebraicSig}`;
    } catch {
        return null;
    }
}

function buildGLSLComplexMathLibraryUncached(appState) {
    const dynamic = buildDynamicAggregateGLSL(
        appState,
        functionName => getWebGLFunctionIdShared(functionName, true)
    );
    const hasCustomZExpr = !!(appState?.algebraicChainingZExpr && appState.algebraicChainingZExpr !== 'z');
    const zCustomExprGLSL = hasCustomZExpr
        ? compileCustomExpressionToGLSL(
            appState.algebraicChainingZExpr,
            functionName => getWebGLFunctionIdShared(functionName, true)
        )
        : 'z';

    let uniformDecls = '';
    const algebraicTerms = appState && appState.algebraicChainingTerms;
    if (algebraicTerms) {
        for (let termIndex = 0; termIndex < algebraicTerms.length; termIndex++) {
            if (!hasOwn.call(algebraicTerms, termIndex)) continue;
            const term = algebraicTerms[termIndex];
            uniformDecls += `uniform vec2 u_algTermCoeff_${termIndex};\n`;
            const factors = term && term.factors;
            if (!factors) continue;
            for (let factorIndex = 0; factorIndex < factors.length; factorIndex++) {
                if (!hasOwn.call(factors, factorIndex)) continue;
                const f = factors[factorIndex];
                if (f.func && f.func !== 'none') {
                    uniformDecls += `uniform float u_algFactorPower_${termIndex}_${factorIndex};\n`;
                }
            }
        }
    }

    let algStr = uniformDecls + ALGEBRAIC_GLSL_MACROS + `bool evaluateMappedValueBase(vec2 z, vec2 c, float isWPlane, float functionId, vec2 mA, vec2 mB, vec2 mC, vec2 mD, int polyDeg, vec2 polyCoeffs[11], float zetaCont, float zetaRefl, float fracPower, out vec2 mapped) {\n`;
    algStr += `  if (isWPlane > 0.5 || isWPlane < 0.0) { mapped = z; return isFiniteVec2Compat(mapped); }\n`;
    algStr += `  float fId = floor(functionId + 0.5);\n`;
    if (dynamic.source && !dynamic.error) {
        algStr += `  if (abs(fId - 17.0) < 0.5) return evaluateDynamicAggregate(z, c, mA, mB, mC, mD, polyDeg, polyCoeffs, zetaCont, zetaRefl, fracPower, mapped);\n`;
    }
    algStr += `  if (abs(fId - 16.0) < 0.5) {\n`;
    if (hasCustomZExpr && !zCustomExprGLSL) {
        algStr += `    mapped = vec2(0.0); return false;\n`;
    } else if (zCustomExprGLSL && zCustomExprGLSL !== 'z') {
        algStr += `    z = ${zCustomExprGLSL};\n`;
    }
    algStr += `    vec2 sum = vec2(0.0);\n`;

    if (algebraicTerms && algebraicTerms.length > 0) {
        for (let termIndex = 0; termIndex < algebraicTerms.length; termIndex++) {
            if (!hasOwn.call(algebraicTerms, termIndex)) continue;
            const term = algebraicTerms[termIndex];
            algStr += `    {\n`;
            algStr += `      vec2 termVal = u_algTermCoeff_${termIndex};\n`;
            const factors = term && term.factors;
            if (factors) {
                for (let factorIndex = 0; factorIndex < factors.length; factorIndex++) {
                    if (!hasOwn.call(factors, factorIndex)) continue;
                    const f = factors[factorIndex];
                    if (!f.func || f.func === 'none') continue;
                    algStr += `      ALG_FACTOR_BEGIN\n`;
                    if (f.chainedFunc && f.chainedFunc !== 'none') {
                        if (f.chainedFunc === 'c') {
                            algStr += `        argZ = c;\n`;
                        } else {
                            algStr += generateAlgebraicDirectEvaluationGLSL(f.chainedFunc, 'argZ', 'temp');
                            algStr += `        argZ = temp;\n`;
                        }
                    }
                    if (f.func === 'c') {
                        algStr += `        argZ = c;\n`;
                    } else {
                        algStr += generateAlgebraicDirectEvaluationGLSL(f.func, 'argZ', 'temp');
                        algStr += `        argZ = temp;\n`;
                    }

                    algStr += `        ALG_FACTOR_POWER(u_algFactorPower_${termIndex}_${factorIndex})\n`;

                    if (f.reciprocal) {
                        algStr += `        ALG_FACTOR_RECIP\n`;
                    }
                    if (f.log) {
                        algStr += `        ALG_FACTOR_LOG\n`;
                    }
                    if (f.exp) {
                        algStr += `        ALG_FACTOR_EXP\n`;
                    }
                    algStr += `        ALG_FACTOR_END\n`;
                }
            }
            algStr += `      sum = complexAdd(sum, termVal);\n`;
            algStr += `    }\n`;
        }
    }

    algStr += `    mapped = sum;\n`;
    algStr += `    return isFiniteVec2Compat(mapped);\n`;
    algStr += `  }\n`;
    algStr += `  return evaluateBasicFuncShared(fId, z, mA, mB, mC, mD, polyDeg, polyCoeffs, zetaCont, zetaRefl, fracPower, mapped);\n`;
    algStr += `}\n`;

    return GLSL_COMPLEX_MATH_LIBRARY_BASE + GLSL_EXPRESSION_HELPERS + (dynamic.source || '') + algStr;
}

export function getGLSLComplexMathLibrary(appState) {
    let dynamicActive = false;
    let dynamicSignature = '';
    let zExpr = 'z';

    if (appState && (typeof appState === 'object' || typeof appState === 'function')) {
        try {
            dynamicActive = isDynamicAggregateGLSLActive(appState);
            dynamicSignature = dynamicActive ? dynamicAggregateGLSLSignature(appState) : '';
            zExpr = appState.algebraicChainingZExpr || 'z';
            const memo = appStateLibraryMemo.get(appState);
            if (appStateMemoMatches(appState, memo, dynamicActive, dynamicSignature, zExpr)) {
                return memo.source;
            }
        } catch {
            // Malformed state falls through to an uncached build.
        }
    }

    const cacheKey = getGLSLComplexMathLibraryCacheKey(appState, dynamicActive, dynamicSignature, zExpr);
    if (cacheKey !== null && cacheKey !== '') {
        const cached = webglSharedLibraryCache.get(cacheKey);
        if (cached !== undefined) {
            rememberAppStateLibrary(appState, dynamicActive, dynamicSignature, zExpr, cacheKey, cached);
            return cached;
        }
    }

    const source = buildGLSLComplexMathLibraryUncached(appState);
    if (cacheKey !== null && cacheKey !== '') {
        if (webglSharedLibraryCache.size >= WEBGL_SHARED_LIBRARY_CACHE_LIMIT) {
            webglSharedLibraryCache.clear();
        }
        webglSharedLibraryCache.set(cacheKey, source);
        rememberAppStateLibrary(appState, dynamicActive, dynamicSignature, zExpr, cacheKey, source);
    }
    return source;
}
