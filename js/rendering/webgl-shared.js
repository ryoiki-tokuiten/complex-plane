import { state } from '../store/state.js';
import {
  DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE
} from '../constants/domain-dynamics.js';
import {
    isDynamicAggregateGLSLActive
} from '../math/expression/glsl.js';
/**
 * Shared WebGL utility functions and common GLSL shaders for complex arithmetic.
 */
export function buildComplexMathLibraryGLSL({ usedFids, useZeta, useGamma, useBessel, usePoly }) {
  return `
uniform vec2 u_expBase;
uniform vec2 u_logBase;
uniform vec2 u_besselOrder;
uniform float u_branchCutAngle;
const float PI = 3.1415926535897932384626433832795;
const float TWO_PI = 6.283185307179586476925286766559;
const float LOG_TWO = 0.6931471805599453094172321214582;
const int ZETA_GPU_TERMS = 72;

float safeExp(float x) { return exp(clamp(x, -87.0, 87.0)); }
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

${useGamma ? `vec2 complexLogGammaPositive(vec2 z) {
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
vec2 complexGamma(vec2 z) { return complexExp(complexLogGamma(z)); }` : `
vec2 complexLogGamma(vec2 z) { return vec2(0.0); }
vec2 complexGamma(vec2 z) { return vec2(0.0); }
`}

${useBessel ? `vec2 complexBesselJ(vec2 z, vec2 orderValue) {
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
}` : `vec2 complexBesselJ(vec2 z, vec2 orderValue) { return vec2(0.0); }`}

${usePoly ? `vec2 evalPolynomial(vec2 z, int degree, vec2 coeffs[11]) { vec2 acc = vec2(0.0, 0.0); vec2 zPow = vec2(1.0, 0.0); for (int i = 0; i <= 10; i++) { if (i <= degree) { acc = complexAdd(acc, complexMul(coeffs[i], zPow)); } zPow = complexMul(zPow, z); } return acc; }` : `vec2 evalPolynomial(vec2 z, int degree, vec2 coeffs[11]) { return vec2(0.0); }`}

vec2 complexPowPositiveRealBase(float positiveBase, vec2 exponent) { float lnBase = log(max(positiveBase, 1.0e-30)); float magnitude = safeExp(exponent.x * lnBase); float angle = exponent.y * lnBase; return vec2(magnitude * cos(angle), magnitude * sin(angle)); }

${useZeta ? `bool evaluateZeta(vec2 s, float contEnabled, float reflBoundary, out vec2 value) { if (abs(s.x - 1.0) < 1.0e-6 && abs(s.y) < 1.0e-6) return false; if (contEnabled < 0.5 && s.x <= reflBoundary) return false; vec2 etaSum = vec2(0.0, 0.0); vec2 negS = vec2(-s.x, -s.y); for (int n = 1; n <= ZETA_GPU_TERMS; n++) { vec2 nPowNegS = complexPowPositiveRealBase(float(n), negS); float alternatingSign = (mod(float(n), 2.0) < 0.5) ? -1.0 : 1.0; etaSum += nPowNegS * alternatingSign; } vec2 oneMinusS = vec2(1.0 - s.x, -s.y); vec2 twoPowOneMinusS = complexPowPositiveRealBase(2.0, oneMinusS); vec2 denominator = vec2(1.0, 0.0) - twoPowOneMinusS; if (dot(denominator, denominator) < 1.0e-18) return false; value = complexDiv(etaSum, denominator); return isFiniteVec2Compat(value); }` : `bool evaluateZeta(vec2 s, float contEnabled, float reflBoundary, out vec2 value) { value = vec2(0.0); return false; }`}

vec2 complexSinh(vec2 z) { return vec2(sinhCompat(z.x) * cos(z.y), coshCompat(z.x) * sin(z.y)); }
vec2 complexCosh(vec2 z) { return vec2(coshCompat(z.x) * cos(z.y), sinhCompat(z.x) * sin(z.y)); }
vec2 complexTanh(vec2 z) { vec2 den = complexCosh(z); if (dot(den,den) < 1.0e-18) return vec2(0.0); return complexDiv(complexSinh(z), den); }

bool evaluateBasicFuncShared(float fId, vec2 z, vec2 mA, vec2 mB, vec2 mC, vec2 mD, int polyDeg, vec2 polyCoeffs[11], float zetaCont, float zetaRefl, float fracPower, out vec2 mapped) {
  ${(!usedFids || usedFids.has(1)) ? `if (abs(fId - 1.0) < 0.5) { mapped = complexCos(z); return isFiniteVec2Compat(mapped); }` : ''}
  ${(!usedFids || usedFids.has(2)) ? `if (abs(fId - 2.0) < 0.5) { mapped = complexSin(z); return isFiniteVec2Compat(mapped); }` : ''}
  ${(!usedFids || usedFids.has(3)) ? `if (abs(fId - 3.0) < 0.5) { vec2 denTan = complexCos(z); if (dot(denTan, denTan) < 1.0e-18) return false; mapped = complexDiv(complexSin(z), denTan); return isFiniteVec2Compat(mapped); }` : ''}
  ${(!usedFids || usedFids.has(4)) ? `if (abs(fId - 4.0) < 0.5) { vec2 denSec = complexCos(z); if (dot(denSec, denSec) < 1.0e-18) return false; mapped = complexDiv(vec2(1.0, 0.0), denSec); return isFiniteVec2Compat(mapped); }` : ''}
  ${(!usedFids || usedFids.has(5)) ? `if (abs(fId - 5.0) < 0.5) { mapped = complexExpWithBase(z); return isFiniteVec2Compat(mapped); }` : ''}
  ${(!usedFids || usedFids.has(6)) ? `if (abs(fId - 6.0) < 0.5) { if (dot(z, z) < 1.0e-20) return false; mapped = complexLogWithBase(z); return isFiniteVec2Compat(mapped); }` : ''}
  ${(!usedFids || usedFids.has(8)) ? `if (abs(fId - 8.0) < 0.5) { vec2 num = complexAdd(complexMul(mA, z), mB); vec2 den = complexAdd(complexMul(mC, z), mD); if (dot(den, den) < 1.0e-18) return false; mapped = complexDiv(num, den); return isFiniteVec2Compat(mapped); }` : ''}
  ${(!usedFids || usedFids.has(9)) ? `if (abs(fId - 9.0) < 0.5) { mapped = evalPolynomial(z, polyDeg, polyCoeffs); return isFiniteVec2Compat(mapped); }` : ''}
  ${(!usedFids || usedFids.has(11)) ? `if (abs(fId - 11.0) < 0.5) { return evaluateZeta(z, zetaCont, zetaRefl, mapped); }` : ''}
  ${(!usedFids || usedFids.has(12)) ? `if (abs(fId - 12.0) < 0.5) { mapped = complexSinh(z); return isFiniteVec2Compat(mapped); }` : ''}
  ${(!usedFids || usedFids.has(14)) ? `if (abs(fId - 14.0) < 0.5) { mapped = complexTanh(z); return isFiniteVec2Compat(mapped); }` : ''}
  ${(!usedFids || usedFids.has(15)) ? `if (abs(fId - 15.0) < 0.5) { if (dot(z,z) < 1.0e-20) { mapped = vec2(0.0); return true; } vec2 lnZ = complexLnActive(z); mapped = complexExp(vec2(fracPower * lnZ.x, fracPower * lnZ.y)); return isFiniteVec2Compat(mapped); }` : ''}
  ${(!usedFids || usedFids.has(18)) ? `if (abs(fId - 18.0) < 0.5) { mapped = complexArcsin(z); return isFiniteVec2Compat(mapped); }` : ''}
  ${(!usedFids || usedFids.has(19)) ? `if (abs(fId - 19.0) < 0.5) { mapped = complexArctan(z); return isFiniteVec2Compat(mapped); }` : ''}
  ${(!usedFids || usedFids.has(20)) ? `if (abs(fId - 20.0) < 0.5) { mapped = complexGamma(z); return isFiniteVec2Compat(mapped); }` : ''}
  ${(!usedFids || usedFids.has(21)) ? `if (abs(fId - 21.0) < 0.5) { mapped = complexLogGamma(z); return isFiniteVec2Compat(mapped); }` : ''}
  ${(!usedFids || usedFids.has(22)) ? `if (abs(fId - 22.0) < 0.5) { mapped = complexBesselJ(z, u_besselOrder); return isFiniteVec2Compat(mapped); }` : ''}
  return false;
}
`;
};

function createWebGLShaderShared(gl, shaderType, source) {
    if (gl.isContextLost()) throw new Error('Cannot compile a shader after WebGL context loss.');
    const shader = gl.createShader(shaderType);
    if (!shader) throw new Error('WebGL failed to allocate a shader.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const detail = gl.getShaderInfoLog(shader) || 'No compiler diagnostic was provided.';
        gl.deleteShader(shader);
        throw new Error(`WebGL shader compile error: ${detail}`);
    }
    return shader;
}

export function createWebGLProgramShared(gl, vertexSource, fragmentSource) {
    if (gl.isContextLost()) throw new Error('Cannot link a program after WebGL context loss.');

    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!vertexShader || !fragmentShader) {
        if (vertexShader) gl.deleteShader(vertexShader);
        if (fragmentShader) gl.deleteShader(fragmentShader);
        throw new Error('WebGL failed to allocate shaders.');
    }

    gl.shaderSource(vertexShader, vertexSource);
    gl.shaderSource(fragmentShader, fragmentSource);

    // Launch both shader compilations simultaneously so driver compiles them in parallel
    gl.compileShader(vertexShader);
    gl.compileShader(fragmentShader);

    const program = gl.createProgram();
    if (!program) {
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        throw new Error('WebGL failed to allocate a program.');
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const vsOk = gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS);
        const fsOk = gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS);
        const vsLog = !vsOk ? (gl.getShaderInfoLog(vertexShader) || '') : '';
        const fsLog = !fsOk ? (gl.getShaderInfoLog(fragmentShader) || '') : '';
        const progLog = gl.getProgramInfoLog(program) || 'No linker diagnostic was provided.';
        gl.deleteProgram(program);
        const errorDetail = vsLog || fsLog || progLog;
        throw new Error(`WebGL shader/program error: ${errorDetail}`);
    }

    return program;
}

export function getWebGLBackendInfoShared(gl) {
    if (!gl) throw new Error('WebGL backend inspection requires a context.');
    const info = {
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        unmaskedVendor: null,
        unmaskedRenderer: null,
        softwareBackend: false
    };

    if (typeof info.renderer !== 'string' || !info.renderer) {
        throw new Error('WebGL did not report a renderer.');
    }
    const rendererString = info.renderer.toLowerCase();
    info.softwareBackend =
        rendererString.includes('swiftshader') ||
        rendererString.includes('llvmpipe') ||
        rendererString.includes('softpipe') ||
        rendererString.includes('software');
    return info;
}

export function getWebGLFunctionIdShared(functionName, ignoreDynamic = false) {
    if (!ignoreDynamic && isDynamicAggregateGLSLActive(state)) return 17;
    switch (functionName) {
        case 'sin': return 2;
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
        default: throw new Error(`Unsupported WebGL complex function: ${functionName}.`);
    }
}

const algebraicSignatureMemo = new WeakMap();

function requireAlgebraicTerms(terms) {
    if (!Array.isArray(terms)) throw new Error('WebGL algebraic terms must be an array.');
    terms.forEach((term, termIndex) => {
        if (!Array.isArray(term?.factors)) {
            throw new Error(`WebGL algebraic term ${termIndex} requires factors.`);
        }
        term.factors.forEach((factor, factorIndex) => {
            if (!factor || typeof factor.func !== 'string' || typeof factor.chainedFunc !== 'string') {
                throw new Error(`WebGL algebraic factor ${termIndex}:${factorIndex} is malformed.`);
            }
        });
    });
    return terms;
}

function snapshotAlgebraicTerms(terms) {
    const list = requireAlgebraicTerms(terms);
    const snapshot = [list.length];
    for (let termIndex = 0; termIndex < list.length; termIndex++) {
        const term = list[termIndex];
        const factors = term.factors;
        snapshot.push(factors.length);
        for (let factorIndex = 0; factorIndex < factors.length; factorIndex++) {
            const factor = factors[factorIndex];
            const active = factor.func !== 'none';
            snapshot.push(active);
            if (active) {
                snapshot.push(factor.func, factor.chainedFunc, !!factor.reciprocal, !!factor.log, !!factor.exp);
            }
        }
    }
    return snapshot;
}

function algebraicSnapshotMatches(terms, snapshot) {
    const list = requireAlgebraicTerms(terms);
    if (!snapshot || snapshot[0] !== list.length) return false;
    let cursor = 1;
    for (let termIndex = 0; termIndex < list.length; termIndex++) {
        const term = list[termIndex];
        const factors = term.factors;
        if (snapshot[cursor++] !== factors.length) return false;
        for (let factorIndex = 0; factorIndex < factors.length; factorIndex++) {
            const factor = factors[factorIndex];
            const active = factor.func !== 'none';
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
    const list = requireAlgebraicTerms(terms);
    if (list.length) {
        const memo = algebraicSignatureMemo.get(list);
        if (memo && algebraicSnapshotMatches(list, memo.snapshot)) return memo.signature;
    }
    const signature = JSON.stringify(list.map(term => {
        const factors = term.factors;
        return {
            factors: factors.map(factor => (
                factor.func !== 'none'
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
