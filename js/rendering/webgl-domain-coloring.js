import { state, context, subscribeState } from '../store/state.js';
import {
  createWebGLProgramShared,
  getWebGLDomainColorFunctionIdShared,
  getWebGLBackendInfoShared,
  setComplexFunctionUniformsShared,
  getGLSLComplexMathLibrary,
  collectAlgebraicUniformLocationsShared,
  getAlgebraicStructureSignatureShared
} from './webgl-shared.js';
import {
  buildDynamicAggregateGLSL,
  dynamicAggregateGLSLSignature,
  isDynamicAggregateGLSLActive
} from '../math/expression/glsl.js';
import {
  WEBGL_DOMAIN_COLOR_SUPERSAMPLE,
  WEBGL_DOMAIN_COLOR_STRESS_SCALE,
  SPHERE_LIGHT_DIRECTION_CAMERA,
  SPHERE_TEXTURE_AMBIENT_INTENSITY,
  SPHERE_TEXTURE_DIFFUSE_INTENSITY,
  SPHERE_TEXTURE_SPECULAR_INTENSITY,
  SPHERE_TEXTURE_SHININESS_FACTOR,
  orbitColoringModeId
} from '../constants/rendering.js';
import {
  createDomainPaletteGlslSource,
  getDomainPaletteShaderId
} from '../constants/domain-palettes.js';

const { webglDomainColorSupport } = context;

const CFG = Object.freeze({
  defaultSupersample: 1.75,
  defaultStressScale: 2.5,
  maxRenderScale: 3,
  maxDprBoost: 1.35,
  dprScaleFactor: 0.92,
  polyCoeffCount: 11,
  maxChainStepsGlsl: 512
});

const EMPTY_OPTIONS = Object.freeze({});
const PLANES = Object.freeze(['z', 'w']);
const PLANE_KEYS = new Set(PLANES);

const QUAD_VERTICES = new Float32Array([
  -1, -1,
  1, -1,
  -1, 1,
  1, 1
]);

const WEBGL_CONTEXT_ATTRIBUTES = Object.freeze({
  antialias: false,
  alpha: true,
  premultipliedAlpha: true,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance'
});

export const CHAIN_MODE_IDS = Object.freeze({
    recursion: 1,
    zero_seed: 2
});

const DOMAIN_FLOAT_UNIFORMS = Object.freeze([
  ['uDomainBrightness', 'domainBrightness', 1],
  ['uDomainContrast', 'domainContrast', 1],
  ['uDomainSaturation', 'domainSaturation', 1],
  ['uDomainLightnessCycles', 'domainLightnessCycles', 0]
]);

const UNIFORM_ALIASES = Object.freeze({
  uResolution: 'u_resolution',
  uViewCenter: 'u_viewCenter',
  uViewSpan: 'u_viewSpan',
  uDomainBrightness: 'u_domainBrightness',
  uDomainContrast: 'u_domainContrast',
  uDomainSaturation: 'u_domainSaturation',
  uDomainLightnessCycles: 'u_domainLightnessCycles',
  uDomainPalette: 'u_domainPalette',
  uUseSphere: 'u_useSphere',
  uSphereCenter: 'u_sphereCenter',
  uSphereRadius: 'u_sphereRadius',
  uRotX: 'u_rotX',
  uRotY: 'u_rotY',
  uLightDir: 'u_lightDir',
  uSphereLighting: 'u_sphereLighting',
  uIsWPlaneColoring: 'u_isWPlaneColoring',
  uFunctionId: 'u_functionId',
  uMobiusA: 'u_mobiusA',
  uMobiusB: 'u_mobiusB',
  uMobiusC: 'u_mobiusC',
  uMobiusD: 'u_mobiusD',
  uPolyDegree: 'u_polyDegree',
  uZetaCont: 'u_zetaContinuationEnabled',
  uZetaRefl: 'u_zetaReflectionBoundary',
  uFracPower: 'u_fracPower',
  uChainCount: 'u_chainCount',
  uChainMode: 'u_chainMode',
  uDerivativeMode: 'u_derivativeMode',
  uOrbitColoringMode: 'u_orbitColoringMode'
});

const DOMAIN_PALETTE_GLSL = createDomainPaletteGlslSource('getPaletteColor');

const VERTEX_SOURCE = lines(
  'attribute vec2 a_position;',
  'varying vec2 v_uv;',
  'void main() {',
  '  v_uv = (a_position + 1.0) * 0.5;',
  '  gl_Position = vec4(a_position, 0.0, 1.0);',
  '}'
);

const FRAGMENT_UNIFORMS = lines(
  'precision highp float;',
  'varying vec2 v_uv;',
  '',
  'uniform vec2 u_resolution;',
  'uniform vec2 u_viewCenter;',
  'uniform vec2 u_viewSpan;',
  'uniform float u_domainBrightness;',
  'uniform float u_domainContrast;',
  'uniform float u_domainSaturation;',
  'uniform float u_domainLightnessCycles;',
  'uniform int u_domainPalette;',
  '',
  'uniform float u_useSphere;',
  'uniform vec2 u_sphereCenter;',
  'uniform float u_sphereRadius;',
  'uniform float u_rotX;',
  'uniform float u_rotY;',
  'uniform vec3 u_lightDir;',
  'uniform vec4 u_sphereLighting;',
  '',
  'uniform float u_isWPlaneColoring;',
  'uniform float u_functionId;',
  'uniform vec2 u_mobiusA;',
  'uniform vec2 u_mobiusB;',
  'uniform vec2 u_mobiusC;',
  'uniform vec2 u_mobiusD;',
  'uniform int u_polyDegree;',
  `uniform vec2 u_polyCoeffs[${CFG.polyCoeffCount}];`,
  'uniform float u_zetaContinuationEnabled;',
  'uniform float u_zetaReflectionBoundary;',
  'uniform float u_fracPower;',
  'uniform int u_chainCount;',
  'uniform int u_chainMode;',
  'uniform float u_derivativeMode;',
  'uniform int u_orbitColoringMode;'
);

const DYNAMICS_COLOR_HELPERS = `
vec4 dynamicsInteriorColor() {
  return vec4(0.0, 0.0, 0.0, 1.0);
}

vec4 dynamicsEscapeColor(float smoothIteration, float brightnessFactor) {
  float count = max(float(u_chainCount), 1.0);
  float t = clamp(smoothIteration / count, 0.0, 1.0);
  vec3 baseColor = getPaletteColor(u_domainPalette, min(t, 0.9999));
  float lightnessBase = 0.22 + 0.58 * pow(t, 0.65);
  float lightnessContrasted = 0.5 + (lightnessBase - 0.5) * u_domainContrast;
  float lightnessFinal = clamp(lightnessContrasted * u_domainBrightness * brightnessFactor, 0.05, 0.95);
  return vec4(applyLightnessAndSaturation(baseColor, lightnessFinal, clamp(u_domainSaturation, 0.0, 1.0)), 1.0);
}

vec4 dynamicsPhaseEventColor(vec2 value, float intensity, float brightnessFactor) {
  float logMod = complexLogMagnitude(value);
  if (!isFiniteFloatCompat(logMod)) return dynamicsInteriorColor();
  float hue = fract(atan(value.y, value.x) / TWO_PI);
  vec3 baseColor = getPaletteColor(u_domainPalette, hue);
  float t = clamp(intensity, 0.0, 1.0);
  float lightnessBase = 0.24 + 0.58 * pow(t, 0.55);
  float lightnessContrasted = 0.5 + (lightnessBase - 0.5) * u_domainContrast;
  float lightnessFinal = clamp(lightnessContrasted * u_domainBrightness * brightnessFactor, 0.05, 0.95);
  return vec4(applyLightnessAndSaturation(baseColor, lightnessFinal, clamp(u_domainSaturation, 0.0, 1.0)), 1.0);
}

vec4 dynamicsValueColor(vec2 value, float brightnessFactor) {
  float phase = atan(value.y, value.x);
  float logMod = complexLogMagnitude(value);
  if (!isFiniteFloatCompat(logMod)) return dynamicsInteriorColor();
  float lightnessBase = magnitudeLightness(logMod, u_domainLightnessCycles);
  float lightnessContrasted = 0.5 + (lightnessBase - 0.5) * u_domainContrast;
  float lightnessFinal = clamp(lightnessContrasted * u_domainBrightness * brightnessFactor, 0.05, 0.95);
  vec3 baseColor = getPaletteColor(u_domainPalette, fract(phase / TWO_PI));
  return vec4(applyLightnessAndSaturation(baseColor, lightnessFinal, clamp(u_domainSaturation, 0.0, 1.0)), 1.0);
}

float convergenceIntensity(float iteration) {
  return 1.0 - clamp((iteration - 1.0) / max(float(u_chainCount), 1.0), 0.0, 1.0);
}

vec4 iteratedDynamicsColor(vec2 parameterValue, int chainMode, float brightnessFactor) {
  int orbitMode = u_orbitColoringMode;
  vec2 current = chainMode == 2 ? vec2(0.0) : parameterValue;
  vec2 lastFinite = current;
  vec2 eventValue = current;
  float escapeRadius = 64.0;
  float escapeRadiusSq = escapeRadius * escapeRadius;
  float convergenceEpsilonSq = 1.0e-14;
  float smoothIteration = float(u_chainCount);
  float eventIteration = float(u_chainCount);
  bool escaped = false;
  bool converged = false;

  for (int i = 0; i < ${CFG.maxChainStepsGlsl}; i++) {
    if (i >= u_chainCount) break;

    vec2 nextValue = vec2(0.0);
    bool ok = mapDomainValue(current, parameterValue, nextValue);
    float magSq = dot(nextValue, nextValue);

    if (!ok || !isFiniteVec2Compat(nextValue) || magSq > escapeRadiusSq || shouldStopDomainChain(nextValue)) {
      float magnitude = sqrt(max(magSq, escapeRadius));
      smoothIteration = float(i) + 1.0;

      if (ok && isFiniteFloatCompat(magnitude) && magnitude > 1.0001) {
        float smoothAdjust = log(max(log(magnitude) / log(escapeRadius), 1.0e-6)) / LOG_TWO;
        smoothIteration = clamp(smoothIteration - smoothAdjust, 0.0, float(u_chainCount));
      }

      escaped = true;
      eventValue = ok && isFiniteVec2Compat(nextValue) ? nextValue : lastFinite;
      eventIteration = float(i) + 1.0;
      break;
    }

    if ((orbitMode == 2 || orbitMode == 3) && dot(nextValue - current, nextValue - current) <= convergenceEpsilonSq * max(1.0, magSq)) {
      converged = true;
      eventValue = nextValue;
      eventIteration = float(i) + 1.0;
      break;
    }

    current = nextValue;
    lastFinite = current;
  }

  if (orbitMode == 1) return escaped
    ? dynamicsEscapeColor(smoothIteration, brightnessFactor)
    : dynamicsInteriorColor();

  if (orbitMode == 2) return converged
    ? dynamicsPhaseEventColor(eventValue, convergenceIntensity(eventIteration), brightnessFactor)
    : dynamicsInteriorColor();

  if (orbitMode == 3) {
    if (escaped) {
      return dynamicsPhaseEventColor(eventValue, 1.0 - clamp(smoothIteration / max(float(u_chainCount), 1.0), 0.0, 1.0), brightnessFactor);
    }
    if (converged) {
      return dynamicsPhaseEventColor(eventValue, convergenceIntensity(eventIteration), brightnessFactor);
    }
    return dynamicsValueColor(current, brightnessFactor);
  }

  return dynamicsValueColor(current, brightnessFactor);
}
`;

const FRAGMENT_HELPERS = `
vec3 inverseRotate3DCompat(vec3 p, float rotX, float rotY) {
  float cY = cos(-rotY);
  float sY = sin(-rotY);
  float cX = cos(-rotX);
  float sX = sin(-rotX);
  float x1 = p.x;
  float y1 = p.y * cX - p.z * sX;
  float z1 = p.y * sX + p.z * cX;
  return vec3(x1 * cY + z1 * sY, y1, -x1 * sY + z1 * cY);
}

vec3 safeNormalize3(vec3 value, vec3 fallbackValue) {
  float mag = length(value);
  return mag > 1.0e-7 ? value / mag : fallbackValue;
}

${DOMAIN_PALETTE_GLSL}

vec3 applyLightnessAndSaturation(vec3 rgb, float lightness, float saturation) {
  vec3 lit = lightness < 0.5
    ? rgb * (lightness / 0.5)
    : mix(rgb, vec3(1.0), (lightness - 0.5) / 0.5);

  float gray = dot(lit, vec3(0.299, 0.587, 0.114));
  return mix(vec3(gray), lit, saturation);
}

float magnitudeLightness(float logMod, float cycles) {
  if (cycles <= 0.0001) return 0.5;
  float detail = max(0.05, cycles);
  float tone = atan(logMod * (0.72 + detail * 0.28)) / 1.5707963267948966;
  return mix(0.34, 0.72, clamp(tone, 0.0, 1.0));
}

float complexLogMagnitude(vec2 value) {
  float scale = max(abs(value.x), abs(value.y));
  if (scale <= 0.0) return 0.0;
  return log(scale) + log(length(value / scale));
}

vec4 invalidDomainColor() {
  return vec4(0.0, 0.0, 0.0, u_useSphere > 0.5 ? 0.0 : 1.0);
}

bool shouldStopDomainChain(vec2 value) {
  return max(abs(value.x), abs(value.y)) >= 1.0e18;
}

bool mapDomainValue(vec2 inputValue, vec2 parameterValue, out vec2 outputValue) {
  return evaluateMappedValueBase(
    inputValue,
    parameterValue,
    u_isWPlaneColoring,
    u_functionId,
    u_mobiusA,
    u_mobiusB,
    u_mobiusC,
    u_mobiusD,
    u_polyDegree,
    u_polyCoeffs,
    u_zetaContinuationEnabled,
    u_zetaReflectionBoundary,
    u_fracPower,
    outputValue
  );
}

void projectPlanarPixel(vec2 pixel, vec2 resolutionSafe, out vec2 zInput) {
  vec2 unit = pixel / resolutionSafe - vec2(0.5);
  zInput = vec2(
    u_viewCenter.x + unit.x * u_viewSpan.x,
    u_viewCenter.y - unit.y * u_viewSpan.y
  );
}

bool projectSpherePixel(vec2 pixel, out vec2 zInput, out float brightnessFactor) {
  brightnessFactor = 1.0;
  if (u_sphereRadius <= 0.0) return false;

  float nx = (pixel.x - u_sphereCenter.x) / u_sphereRadius;
  float ny = -(pixel.y - u_sphereCenter.y) / u_sphereRadius;
  float radialSq = nx * nx + ny * ny;
  if (radialSq > 1.0) return false;

  float pz = sqrt(max(0.0, 1.0 - radialSq));
  vec3 normalCam = vec3(nx, ny, pz);
  vec3 pointOnSphere = inverseRotate3DCompat(normalCam, u_rotX, u_rotY);

  float den = 1.0 - pointOnSphere.z;
  if (abs(den) < 1.0e-6) return false;

  zInput = vec2(pointOnSphere.x / den, pointOnSphere.y / den);

  vec3 lightDir = safeNormalize3(u_lightDir, vec3(0.0, 0.0, 1.0));
  float nDotL = dot(normalCam, lightDir);
  float diffuseFactor = max(0.0, nDotL);
  float specularFactor = 0.0;

  if (nDotL > 0.0) {
    vec3 reflected = 2.0 * nDotL * normalCam - lightDir;
    specularFactor = pow(max(0.0, reflected.z), max(1.0, u_sphereLighting.w));
  }

  float lightIntensity =
    u_sphereLighting.x +
    u_sphereLighting.y * diffuseFactor +
    u_sphereLighting.z * specularFactor;

  brightnessFactor = clamp(lightIntensity, 0.1, 1.75);
  return true;
}

bool projectPixelToDomain(vec2 pixel, vec2 resolutionSafe, out vec2 zInput, out float brightnessFactor) {
  brightnessFactor = 1.0;
  if (u_useSphere > 0.5) return projectSpherePixel(pixel, zInput, brightnessFactor);
  projectPlanarPixel(pixel, resolutionSafe, zInput);
  return true;
}

bool applyConfiguredChain(inout vec2 mappedValue, vec2 parameterValue) {
  if (u_isWPlaneColoring >= 0.5 || u_chainCount <= 1) return true;

  if (shouldStopDomainChain(mappedValue)) return true;

  for (int i = 1; i < ${CFG.maxChainStepsGlsl}; i++) {
    if (i >= u_chainCount) break;

    vec2 nextValue = mappedValue;
    if (!mapDomainValue(mappedValue, parameterValue, nextValue)) return true;
    if (!isFiniteVec2Compat(nextValue)) return true;

    mappedValue = nextValue;
    if (shouldStopDomainChain(mappedValue)) return true;
  }

  return true;
}

bool evaluateZeroSeedChain(vec2 parameterValue, out vec2 mappedValue) {
  vec2 current = vec2(0.0);
  vec2 lastFinite = vec2(0.0);
  bool hasLastFinite = false;

  for (int i = 0; i < ${CFG.maxChainStepsGlsl}; i++) {
    if (i >= u_chainCount) break;
    vec2 nextValue = vec2(0.0);
    if (!mapDomainValue(current, parameterValue, nextValue)) {
      if (hasLastFinite) {
        mappedValue = lastFinite;
        return true;
      }
      return false;
    }
    if (!isFiniteVec2Compat(nextValue)) {
      if (hasLastFinite) {
        mappedValue = lastFinite;
        return true;
      }
      return false;
    }

    current = nextValue;
    lastFinite = current;
    hasLastFinite = true;
    if (shouldStopDomainChain(current)) {
      mappedValue = current;
      return true;
    }
  }

  mappedValue = current;
  return true;
}

bool evaluateConfiguredMap(vec2 inputValue, out vec2 mappedValue) {
  if (u_isWPlaneColoring >= 0.5) {
    mappedValue = inputValue;
    return true;
  }

  if (u_chainMode == 2) {
    return evaluateZeroSeedChain(inputValue, mappedValue);
  }

  if (!mapDomainValue(inputValue, inputValue, mappedValue) || !isFiniteVec2Compat(mappedValue)) {
    return false;
  }

  return applyConfiguredChain(mappedValue, inputValue) && isFiniteVec2Compat(mappedValue);
}

bool evaluateActiveMap(vec2 inputValue, out vec2 mappedValue) {
  if (u_derivativeMode < 0.5 || u_isWPlaneColoring >= 0.5) {
    return evaluateConfiguredMap(inputValue, mappedValue);
  }

  float h = 1.0e-6 * max(1.0, max(abs(inputValue.x), abs(inputValue.y)));
  vec2 rightValue = vec2(0.0);
  vec2 leftValue = vec2(0.0);
  if (!evaluateConfiguredMap(inputValue + vec2(h, 0.0), rightValue)) return false;
  if (!evaluateConfiguredMap(inputValue - vec2(h, 0.0), leftValue)) return false;
  mappedValue = (rightValue - leftValue) / (2.0 * h);
  return isFiniteVec2Compat(mappedValue);
}

${DYNAMICS_COLOR_HELPERS}

vec4 domainColorForValue(vec2 value, float brightnessFactor) {
  float phase = atan(value.y, value.x);
  float logMod = complexLogMagnitude(value);
  if (!isFiniteFloatCompat(logMod)) return vec4(0.0);

  float lightnessBase = magnitudeLightness(logMod, u_domainLightnessCycles);
  float lightnessContrasted = 0.5 + (lightnessBase - 0.5) * u_domainContrast;
  float lightnessFinal = clamp(lightnessContrasted * u_domainBrightness * brightnessFactor, 0.05, 0.95);
  float saturationFinal = clamp(u_domainSaturation, 0.0, 1.0);
  float hue = fract(phase / TWO_PI);

  vec3 baseColor = getPaletteColor(u_domainPalette, hue);
  return vec4(applyLightnessAndSaturation(baseColor, lightnessFinal, saturationFinal), 1.0);
}
`;

const FRAGMENT_MAIN = `
void main() {
  vec2 resolutionSafe = max(u_resolution, vec2(1.0, 1.0));
  vec2 pixel = vec2(v_uv.x * resolutionSafe.x, (1.0 - v_uv.y) * resolutionSafe.y);

  vec2 zInput = vec2(0.0);
  float brightnessFactor = 1.0;

  if (!projectPixelToDomain(pixel, resolutionSafe, zInput, brightnessFactor)) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 mappedValue = vec2(0.0);
  if (u_derivativeMode < 0.5 && u_orbitColoringMode != 0 && u_isWPlaneColoring < 0.5 && u_chainCount > 1 && (u_chainMode == 1 || u_chainMode == 2)) {
    gl_FragColor = iteratedDynamicsColor(zInput, u_chainMode, brightnessFactor);
    return;
  }

  if (!evaluateActiveMap(zInput, mappedValue)) {
    gl_FragColor = invalidDomainColor();
    return;
  }

  gl_FragColor = domainColorForValue(mappedValue, brightnessFactor);
}
`;

const SUPPORT_DEFAULTS = Object.freeze({
  available: false,
  reason: 'disabled-or-unavailable',
  warnedRuntimeFallback: false
});

const LIGHTING_UNIFORM_VALUES = Object.freeze([
  SPHERE_TEXTURE_AMBIENT_INTENSITY,
  SPHERE_TEXTURE_DIFFUSE_INTENSITY,
  SPHERE_TEXTURE_SPECULAR_INTENSITY,
  SPHERE_TEXTURE_SHININESS_FACTOR
]);

const HAS_OWN = Function.call.bind(Object.prototype.hasOwnProperty);

function lines(...parts) {
  return parts.join('\n');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stateNumber(key, fallback) {
  return finite(state?.[key], fallback);
}

function enumId(table, key, fallback) {
  return HAS_OWN(table, key) ? table[key] : fallback;
}

function positivePixelSize(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.max(1, Math.round(number)) : 0;
}

function uniformInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function recordFromPlanes(factory) {
  return Object.fromEntries(PLANES.map((plane) => [plane, factory(plane)]));
}

function firstTruthyPlaneValue(record) {
  return PLANES.map((plane) => record?.[plane]).find(Boolean) || null;
}

function ensureRecord(owner, key) {
  if (!owner[key] || typeof owner[key] !== 'object') owner[key] = {};
  return owner[key];
}

function assignPlaneRecord(target, source) {
  for (const plane of PLANES) target[plane] = source?.[plane] || null;
  return target;
}

function createFragmentSource() {
  return lines(
    FRAGMENT_UNIFORMS,
    '',
    getGLSLComplexMathLibrary(state),
    '',
    FRAGMENT_HELPERS,
    '',
    FRAGMENT_MAIN
  );
}

function createCanvasAndWebGLContext() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', WEBGL_CONTEXT_ATTRIBUTES);
  return gl ? { canvas, gl } : null;
}

function createQuadBuffer(gl) {
  const buffer = gl.createBuffer();
  if (!buffer) return null;

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);
  return buffer;
}

function deleteRenderer(renderer) {
  const gl = renderer?.gl;
  if (!gl) return;

  if (renderer.quadBuffer) gl.deleteBuffer(renderer.quadBuffer);

  const cache = renderer.programCache;
  if (cache?.forEach) {
    cache.forEach(record => {
      if (record?.program) gl.deleteProgram(record.program);
    });
    cache.clear();
  } else if (renderer.program) {
    gl.deleteProgram(renderer.program);
  }
}

function deletePlaneRenderers(renderers) {
  for (const plane of PLANES) deleteRenderer(renderers?.[plane]);
}

function collectUniformLocations(gl, program) {
  const locations = {};

  for (const [publicName, shaderName] of Object.entries(UNIFORM_ALIASES)) {
    const location = gl.getUniformLocation(program, shaderName);
    if (location === null) return null;
    locations[publicName] = location;
  }

  locations.uPolyCoeffs = Array.from(
    { length: CFG.polyCoeffCount },
    (_unused, index) => gl.getUniformLocation(program, `u_polyCoeffs[${index}]`)
  );

  return locations;
}

const UNIFORM_KIND_1F = 1;
const UNIFORM_KIND_1I = 2;
const UNIFORM_KIND_2F = 3;
const UNIFORM_KIND_3F = 4;
const UNIFORM_KIND_4F = 5;
const UNIFORM_COMPONENT_STRIDE = 4;

function sameNumber(a, b) {
  return a === b || (a !== a && b !== b);
}

function registerUniformSlot(slots, location, slot) {
  if (location === null || location === undefined) return;
  try {
    slots.set(location, slot);
  } catch {
    // Host WebGLUniformLocation objects are normally WeakMap-compatible; this
    // fallback keeps unusual test doubles functional without changing output.
  }
}

function createUniformCommitter(gl, uniforms) {
  const slots = new WeakMap();
  let slotCount = 0;

  for (const publicName of Object.keys(UNIFORM_ALIASES)) {
    registerUniformSlot(slots, uniforms[publicName], slotCount++);
  }
  for (let i = 0; i < CFG.polyCoeffCount; i++) {
    registerUniformSlot(slots, uniforms.uPolyCoeffs?.[i], slotCount++);
  }

  const valid = new Uint8Array(slotCount);
  const kind = new Uint8Array(slotCount);
  const values = new Float64Array(slotCount * UNIFORM_COMPONENT_STRIDE);

  const slotOf = (location) => {
    const slot = slots.get(location);
    return slot === undefined ? -1 : slot;
  };

  const facade = {
    uniform1f(location, x) {
      const slot = slotOf(location);
      if (slot < 0) {
        gl.uniform1f(location, x);
        return;
      }

      const offset = slot * UNIFORM_COMPONENT_STRIDE;
      if (valid[slot] && kind[slot] === UNIFORM_KIND_1F && sameNumber(values[offset], x)) return;

      valid[slot] = 1;
      kind[slot] = UNIFORM_KIND_1F;
      values[offset] = x;
      gl.uniform1f(location, x);
    },

    uniform1i(location, x) {
      const slot = slotOf(location);
      if (slot < 0) {
        gl.uniform1i(location, x);
        return;
      }

      const offset = slot * UNIFORM_COMPONENT_STRIDE;
      if (valid[slot] && kind[slot] === UNIFORM_KIND_1I && values[offset] === x) return;

      valid[slot] = 1;
      kind[slot] = UNIFORM_KIND_1I;
      values[offset] = x;
      gl.uniform1i(location, x);
    },

    uniform2f(location, x, y) {
      const slot = slotOf(location);
      if (slot < 0) {
        gl.uniform2f(location, x, y);
        return;
      }

      const offset = slot * UNIFORM_COMPONENT_STRIDE;
      if (
        valid[slot]
        && kind[slot] === UNIFORM_KIND_2F
        && sameNumber(values[offset], x)
        && sameNumber(values[offset + 1], y)
      ) return;

      valid[slot] = 1;
      kind[slot] = UNIFORM_KIND_2F;
      values[offset] = x;
      values[offset + 1] = y;
      gl.uniform2f(location, x, y);
    },

    uniform3f(location, x, y, z) {
      const slot = slotOf(location);
      if (slot < 0) {
        gl.uniform3f(location, x, y, z);
        return;
      }

      const offset = slot * UNIFORM_COMPONENT_STRIDE;
      if (
        valid[slot]
        && kind[slot] === UNIFORM_KIND_3F
        && sameNumber(values[offset], x)
        && sameNumber(values[offset + 1], y)
        && sameNumber(values[offset + 2], z)
      ) return;

      valid[slot] = 1;
      kind[slot] = UNIFORM_KIND_3F;
      values[offset] = x;
      values[offset + 1] = y;
      values[offset + 2] = z;
      gl.uniform3f(location, x, y, z);
    },

    uniform4f(location, x, y, z, w) {
      const slot = slotOf(location);
      if (slot < 0) {
        gl.uniform4f(location, x, y, z, w);
        return;
      }

      const offset = slot * UNIFORM_COMPONENT_STRIDE;
      if (
        valid[slot]
        && kind[slot] === UNIFORM_KIND_4F
        && sameNumber(values[offset], x)
        && sameNumber(values[offset + 1], y)
        && sameNumber(values[offset + 2], z)
        && sameNumber(values[offset + 3], w)
      ) return;

      valid[slot] = 1;
      kind[slot] = UNIFORM_KIND_4F;
      values[offset] = x;
      values[offset + 1] = y;
      values[offset + 2] = z;
      values[offset + 3] = w;
      gl.uniform4f(location, x, y, z, w);
    },

    uniform1fv(location, data) {
      if (data && data.length === 1) {
        this.uniform1f(location, data[0]);
        return;
      }
      gl.uniform1fv(location, data);
    },

    uniform1iv(location, data) {
      if (data && data.length === 1) {
        this.uniform1i(location, data[0]);
        return;
      }
      gl.uniform1iv(location, data);
    },

    uniform2fv(location, data) {
      if (data && data.length === 2) {
        this.uniform2f(location, data[0], data[1]);
        return;
      }
      gl.uniform2fv(location, data);
    },

    uniform3fv(location, data) {
      if (data && data.length === 3) {
        this.uniform3f(location, data[0], data[1], data[2]);
        return;
      }
      gl.uniform3fv(location, data);
    },

    uniform4fv(location, data) {
      if (data && data.length === 4) {
        this.uniform4f(location, data[0], data[1], data[2], data[3]);
        return;
      }
      gl.uniform4fv(location, data);
    },

    uniformMatrix2fv(location, transpose, data) {
      gl.uniformMatrix2fv(location, transpose, data);
    },

    uniformMatrix3fv(location, transpose, data) {
      gl.uniformMatrix3fv(location, transpose, data);
    },

    uniformMatrix4fv(location, transpose, data) {
      gl.uniformMatrix4fv(location, transpose, data);
    }
  };

  return {
    gl: facade,
    invalidate() {
      valid.fill(0);
    }
  };
}

function createPipelineState() {
  return {
    viewportWidth: -1,
    viewportHeight: -1,
    program: null,
    arrayBuffer: null,
    attribPosition: -1,
    vertexAttribPointerPosition: -1,
    depthTestDisabled: false,
    blendDisabled: false,
    clearColorValid: false
  };
}

function createRendererScratch(renderer) {
  return {
    targetCtx: null,
    renderer,
    targetWidth: 0,
    targetHeight: 0,
    origin: null,
    scale: null,
    x0: 0,
    x1: 0,
    y0: 0,
    y1: 0,
    isWPlaneColoring: false,
    sphereParams: null,
    map: null,
    metrics: {
      internalWidth: 1,
      internalHeight: 1,
      scaleX: 1,
      scaleY: 1,
      uniformScale: 1
    },
    view: new Float64Array(4),
    sphere: new Float64Array(6),
    light: new Float64Array(3)
  };
}

function createProgramRecord(gl, fragmentSource) {
  const program = createWebGLProgramShared(gl, VERTEX_SOURCE, fragmentSource);
  if (!program) return null;

  const aPosition = gl.getAttribLocation(program, 'a_position');
  const uniforms = collectUniformLocations(gl, program);
  if (aPosition < 0 || !uniforms) {
    gl.deleteProgram(program);
    return null;
  }

  collectAlgebraicUniformLocationsShared(gl, program, state, uniforms);

  return {
    program,
    aPosition,
    uniforms,
    uniformCommitter: createUniformCommitter(gl, uniforms)
  };
}

function adoptProgramRecord(renderer, key, record) {
  renderer.programKey = key;
  renderer.program = record.program;
  renderer.aPosition = record.aPosition;
  renderer.uniformCommitter = record.uniformCommitter;
  renderer.uniformGL = record.uniformCommitter.gl;

  for (const publicName of Object.keys(UNIFORM_ALIASES)) {
    renderer[publicName] = record.uniforms[publicName];
  }
  renderer.uPolyCoeffs = record.uniforms.uPolyCoeffs;
  renderer.algebraicTerms = record.uniforms.algebraicTerms;

  if (renderer.pipelineState) {
    renderer.pipelineState.program = null;
    renderer.pipelineState.attribPosition = -1;
    renderer.pipelineState.vertexAttribPointerPosition = -1;
  }
}

function buildRenderer(canvas, gl, quadBuffer, key, record) {
  const renderer = {
    canvas,
    gl,
    program: null,
    programKey: '',
    programCache: new Map(),
    quadBuffer,
    aPosition: -1,
    pipelineState: createPipelineState(),
    uniformCommitter: null,
    uniformGL: null,
    uPolyCoeffs: null
  };

  renderer.programCache.set(key, record);
  adoptProgramRecord(renderer, key, record);
  renderer.scratch = createRendererScratch(renderer);
  return renderer;
}

function ensureRendererProgram(renderer, key, fragmentSource) {
  if (!renderer || renderer.programKey === key) return !!renderer;

  let record = renderer.programCache.get(key);
  if (!record) {
    record = createProgramRecord(renderer.gl, fragmentSource);
    if (!record) return false;
    renderer.programCache.set(key, record);
  }

  adoptProgramRecord(renderer, key, record);
  return true;
}

function switchDomainRendererPrograms(key, fragmentSource) {
  const renderers = webglDomainColorSupport?.renderers;
  if (!renderers) return false;

  let available = false;
  for (const plane of PLANES) {
    const renderer = renderers[plane];
    if (!renderer || !liveContext(renderer.gl)) continue;
    if (!ensureRendererProgram(renderer, key, fragmentSource)) return false;
    available = true;
  }
  return available;
}

function liveContext(gl) {
  return !!gl && (typeof gl.isContextLost !== 'function' || !gl.isContextLost());
}

function canvas2DTarget(targetCtx) {
  return !!targetCtx
    && typeof targetCtx.save === 'function'
    && typeof targetCtx.restore === 'function'
    && typeof targetCtx.setTransform === 'function'
    && typeof targetCtx.clearRect === 'function'
    && typeof targetCtx.drawImage === 'function';
}

function resetSupportObject(support) {
  const renderers = ensureRecord(support, 'renderers');

  deletePlaneRenderers(renderers);
  Object.assign(support, SUPPORT_DEFAULTS);

  assignPlaneRecord(renderers, null);
  assignPlaneRecord(ensureRecord(support, 'diagnostics'), null);

  if (support.warnedFunctionFallbacks?.clear) support.warnedFunctionFallbacks.clear();
}

function installSupportRenderers(support, renderers, diagnostics) {
  assignPlaneRecord(ensureRecord(support, 'renderers'), renderers);
  assignPlaneRecord(ensureRecord(support, 'diagnostics'), diagnostics);

  support.available = true;
  support.reason = renderers.z && renderers.w ? 'ready' : 'partial-ready';
}

function backendLabel(diagnostics) {
  const diag = firstTruthyPlaneValue(diagnostics);
  if (!diag) return null;

  return {
    software: !!diag.softwareBackend,
    vendor: diag.unmaskedVendor || diag.vendor || 'unknown vendor',
    renderer: diag.unmaskedRenderer || diag.renderer || 'unknown renderer'
  };
}

function announceBackend(diagnostics) {
  const label = backendLabel(diagnostics);

  if (!label) {
    console.info('GPU domain coloring enabled.');
    return;
  }

  const message = `GPU domain coloring ${label.software ? 'is running on a software WebGL backend' : 'enabled on'} ${label.vendor} | ${label.renderer}.`;
  (label.software ? console.warn : console.info)(message);
}

function createCacheStringifier() {
  const seen = new WeakSet();

  return (_key, value) => {
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'function') return `[Function:${value.name || 'anonymous'}]`;

    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }

    return value;
  };
}

function serializeProgramMathForCache() {
  try {
    const dynamicActive = isDynamicAggregateGLSLActive(state);
    const algebraicActive = state?.currentFunction === 'algebraic_chaining';
    return JSON.stringify({
      mode: dynamicActive ? 'dynamic' : (algebraicActive ? 'algebraic' : 'base'),
      algebraic: algebraicActive ? getAlgebraicStructureSignatureShared(state?.algebraicChainingTerms) : null,
      algebraicZ: algebraicActive ? state?.algebraicChainingZExpr || 'z' : null,
      dynamic: dynamicActive ? dynamicAggregateGLSLSignature(state) : null
    }, createCacheStringifier());
  } catch (error) {
    return `unserializable:${error?.message || String(error)}`;
  }
}

let mathRendererHashCached = '';
let mathRendererHashDirty = true;

subscribeState(() => {
  mathRendererHashDirty = true;
}, [
  'currentFunction', 'mapPresentation', 'algebraicChainingEnabled',
  'algebraicChainingZExpr', 'algebraicChainingTerms', 'dynamicPlotting',
  'chainingEnabled', 'chainingMode', 'chainCount', 'taylorSeriesEnabled',
  'taylorSeriesOrder', 'zetaContinuationEnabled', 'fractionalPowerN'
]);

function refreshMathRendererIfNeeded() {
  if (!webglDomainColorSupport) return false;

  if (mathRendererHashDirty) {
    mathRendererHashCached = serializeProgramMathForCache();
    mathRendererHashDirty = false;
  }

  const hash = mathRendererHashCached;
  if (webglDomainColorSupport.lastAlgHash === hash) return true;

  if (!domainRenderersAvailable(webglDomainColorSupport.renderers)) {
    initializeWebGLDomainColoringSupport();
    webglDomainColorSupport.lastAlgHash = hash;
    return !!webglDomainColorSupport.available;
  }

  const fragmentSource = createFragmentSource();
  if (!switchDomainRendererPrograms(hash, fragmentSource)) return false;

  webglDomainColorSupport.lastAlgHash = hash;
  webglDomainColorSupport.available = true;
  webglDomainColorSupport.reason = webglDomainColorSupport.renderers?.z && webglDomainColorSupport.renderers?.w
    ? 'ready'
    : 'partial-ready';
  return true;
}

function readRangeEndpoints(primary, fallback, job, axis) {
  const primaryOk = Array.isArray(primary) && primary.length >= 2;
  const candidate = primaryOk ? primary : fallback;
  if (!Array.isArray(candidate) || candidate.length < 2) return false;

  const start = Number(candidate[0]);
  const end = Number(candidate[1]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;

  if (axis === 0) {
    job.x0 = start;
    job.x1 = end;
  } else {
    job.y0 = start;
    job.y1 = end;
  }
  return true;
}

function renderOptions(options) {
  return options && typeof options === 'object' ? options : EMPTY_OPTIONS;
}

function resolveRenderJob(targetCtx, planeParams, options) {
  if (!canvas2DTarget(targetCtx)) return null;

  const opts = renderOptions(options);
  const planeKey = inferDomainColorPlaneKey(targetCtx, opts.planeKey);
  const renderer = getWebGLDomainColorRenderer(planeKey);
  if (!renderer || !liveContext(renderer.gl)) return null;

  const width = positivePixelSize(planeParams?.width);
  const height = positivePixelSize(planeParams?.height);
  if (!width || !height) return null;

  const job = renderer.scratch;
  if (!readRangeEndpoints(planeParams?.currentVisXRange, planeParams?.xRange, job, 0)) return null;
  if (!readRangeEndpoints(planeParams?.currentVisYRange, planeParams?.yRange, job, 1)) return null;

  job.targetCtx = targetCtx;
  job.renderer = renderer;
  job.targetWidth = width;
  job.targetHeight = height;
  job.origin = planeParams.origin || null;
  job.scale = planeParams.scale || null;
  job.isWPlaneColoring = !!opts.isWPlaneColoring;
  job.sphereParams = opts.sphereParams || null;
  job.map = opts.map || null;
  return job;
}

function writeRenderMetrics(metrics, targetWidth, targetHeight) {
  const scale = getWebGLDomainColorRenderScale();
  const internalWidth = Math.max(1, Math.round(targetWidth * scale));
  const internalHeight = Math.max(1, Math.round(targetHeight * scale));
  const scaleX = internalWidth / targetWidth;
  const scaleY = internalHeight / targetHeight;

  metrics.internalWidth = internalWidth;
  metrics.internalHeight = internalHeight;
  metrics.scaleX = scaleX;
  metrics.scaleY = scaleY;
  metrics.uniformScale = Math.min(scaleX, scaleY);
  return metrics;
}

function bindPipeline(gl, renderer) {
  const pipeline = renderer.pipelineState;
  const width = renderer.canvas.width;
  const height = renderer.canvas.height;

  if (pipeline.viewportWidth !== width || pipeline.viewportHeight !== height) {
    gl.viewport(0, 0, width, height);
    pipeline.viewportWidth = width;
    pipeline.viewportHeight = height;
  }

  if (pipeline.program !== renderer.program) {
    gl.useProgram(renderer.program);
    pipeline.program = renderer.program;
    renderer.uniformCommitter.invalidate();
  }

  if (pipeline.arrayBuffer !== renderer.quadBuffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.quadBuffer);
    pipeline.arrayBuffer = renderer.quadBuffer;
    pipeline.vertexAttribPointerPosition = -1;
  }

  if (pipeline.attribPosition !== renderer.aPosition) {
    gl.enableVertexAttribArray(renderer.aPosition);
    pipeline.attribPosition = renderer.aPosition;
    pipeline.vertexAttribPointerPosition = -1;
  }

  if (pipeline.vertexAttribPointerPosition !== renderer.aPosition) {
    gl.vertexAttribPointer(renderer.aPosition, 2, gl.FLOAT, false, 0, 0);
    pipeline.vertexAttribPointerPosition = renderer.aPosition;
  }
}

function writeSphereUniforms(scratch, sphereParams, job, metrics) {
  const sphere = scratch.sphere;

  if (!sphereParams) {
    sphere[0] = 0;
    sphere[1] = metrics.internalWidth * 0.5;
    sphere[2] = metrics.internalHeight * 0.5;
    sphere[3] = 0;
    sphere[4] = 0;
    sphere[5] = 0;
    return sphere;
  }

  const centerX = finite(sphereParams.centerX, job.targetWidth * 0.5);
  const centerY = finite(sphereParams.centerY, job.targetHeight * 0.5);
  const radius = finite(sphereParams.radius, 0);

  sphere[0] = 1;
  sphere[1] = centerX * metrics.scaleX;
  sphere[2] = centerY * metrics.scaleY;
  sphere[3] = Math.max(0, radius) * metrics.uniformScale;
  sphere[4] = finite(sphereParams.rotX, 0);
  sphere[5] = finite(sphereParams.rotY, 0);
  return sphere;
}

function writePlanarView(scratch, job) {
  const view = scratch.view;
  const scaleX = finiteNumber(job.scale?.x, 0);
  const scaleY = finiteNumber(job.scale?.y, 0);
  const originX = finiteNumber(job.origin?.x, NaN);
  const originY = finiteNumber(job.origin?.y, NaN);

  if (scaleX > 0 && scaleY > 0 && Number.isFinite(originX) && Number.isFinite(originY)) {
    view[0] = (job.targetWidth * 0.5 - originX) / scaleX;
    view[1] = (originY - job.targetHeight * 0.5) / scaleY;
    view[2] = job.targetWidth / scaleX;
    view[3] = job.targetHeight / scaleY;
    return view;
  }

  view[0] = (job.x0 + job.x1) * 0.5;
  view[1] = (job.y0 + job.y1) * 0.5;
  view[2] = job.x1 - job.x0;
  view[3] = job.y1 - job.y0;
  return view;
}

function uploadFrameUniforms(uniformGL, renderer, job) {
  const view = writePlanarView(renderer.scratch, job);

  uniformGL.uniform2f(renderer.uResolution, renderer.canvas.width, renderer.canvas.height);
  uniformGL.uniform2f(renderer.uViewCenter, view[0], view[1]);
  uniformGL.uniform2f(renderer.uViewSpan, view[2], view[3]);
}

function uploadDomainStyleUniforms(uniformGL, renderer) {
  for (let i = 0; i < DOMAIN_FLOAT_UNIFORMS.length; i++) {
    const spec = DOMAIN_FLOAT_UNIFORMS[i];
    uniformGL.uniform1f(renderer[spec[0]], stateNumber(spec[1], spec[2]));
  }

  uniformGL.uniform1i(renderer.uDomainPalette, getDomainPaletteShaderId(state?.domainPalette));
}

function uploadSphereUniforms(uniformGL, renderer, job, metrics) {
  const sphere = writeSphereUniforms(renderer.scratch, job.sphereParams, job, metrics);

  uniformGL.uniform1f(renderer.uUseSphere, sphere[0]);
  uniformGL.uniform2f(renderer.uSphereCenter, sphere[1], sphere[2]);
  uniformGL.uniform1f(renderer.uSphereRadius, sphere[3]);
  uniformGL.uniform1f(renderer.uRotX, sphere[4]);
  uniformGL.uniform1f(renderer.uRotY, sphere[5]);
  return sphere[0] > 0;
}

function writeNormalizedSphereLightDirection(out) {
  const lx = finiteNumber(SPHERE_LIGHT_DIRECTION_CAMERA?.x, 0);
  const ly = finiteNumber(SPHERE_LIGHT_DIRECTION_CAMERA?.y, 0);
  const lz = finiteNumber(SPHERE_LIGHT_DIRECTION_CAMERA?.z, 1);
  const magnitude = Math.hypot(lx, ly, lz);

  if (Number.isFinite(magnitude) && magnitude >= 1e-9) {
    out[0] = lx / magnitude;
    out[1] = ly / magnitude;
    out[2] = lz / magnitude;
    return out;
  }

  out[0] = 0;
  out[1] = 0;
  out[2] = 1;
  return out;
}

function uploadLightingUniforms(uniformGL, renderer) {
  const light = writeNormalizedSphereLightDirection(renderer.scratch.light);

  uniformGL.uniform3f(renderer.uLightDir, light[0], light[1], light[2]);
  uniformGL.uniform4f(
    renderer.uSphereLighting,
    finiteNumber(LIGHTING_UNIFORM_VALUES[0], 0),
    finiteNumber(LIGHTING_UNIFORM_VALUES[1], 0),
    finiteNumber(LIGHTING_UNIFORM_VALUES[2], 0),
    finiteNumber(LIGHTING_UNIFORM_VALUES[3], 1)
  );
}

function uploadChainingUniforms(uniformGL, renderer) {
  const enabled = !!state?.chainingEnabled;
  const chainCount = enabled
    ? Math.max(1, Math.min(CFG.maxChainStepsGlsl, uniformInt(state.chainCount, 1)))
    : 1;
  const chainMode = enabled ? enumId(CHAIN_MODE_IDS, state.chainingMode, 1) : 0;

  uniformGL.uniform1i(renderer.uChainCount, chainCount);
  uniformGL.uniform1i(renderer.uChainMode, chainMode);
  uniformGL.uniform1i(renderer.uOrbitColoringMode, enabled
    ? orbitColoringModeId(state?.orbitColoringMode)
    : 0
  );
}

function uploadRenderUniforms(renderer, job, metrics) {
  const uniformGL = renderer.uniformGL;

  uploadFrameUniforms(uniformGL, renderer, job);
  uploadDomainStyleUniforms(uniformGL, renderer);
  if (uploadSphereUniforms(uniformGL, renderer, job, metrics)) {
    uploadLightingUniforms(uniformGL, renderer);
  }
  uniformGL.uniform1f(renderer.uIsWPlaneColoring, job.isWPlaneColoring ? 1 : 0);
  uniformGL.uniform1f(renderer.uDerivativeMode, job.map?.presentation === 'derivative' ? 1 : 0);
  setComplexFunctionUniformsShared(uniformGL, renderer, state);
  uploadChainingUniforms(uniformGL, renderer);
}

function draw(gl, renderer) {
  const pipeline = renderer.pipelineState;

  if (!pipeline.depthTestDisabled) {
    gl.disable(gl.DEPTH_TEST);
    pipeline.depthTestDisabled = true;
  }
  if (!pipeline.blendDisabled) {
    gl.disable(gl.BLEND);
    pipeline.blendDisabled = true;
  }
  if (!pipeline.clearColorValid) {
    gl.clearColor(0, 0, 0, 0);
    pipeline.clearColorValid = true;
  }

  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function copyToTarget(renderer, job) {
  const ctx = job.targetCtx;

  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, job.targetWidth, job.targetHeight);
    ctx.drawImage(
      renderer.canvas,
      0, 0, renderer.canvas.width, renderer.canvas.height,
      0, 0, job.targetWidth, job.targetHeight
    );
  } finally {
    ctx.restore();
  }
}

function executeRenderJob(job) {
  const { renderer } = job;
  const { gl } = renderer;
  const metrics = writeRenderMetrics(renderer.scratch.metrics, job.targetWidth, job.targetHeight);

  resizeWebGLDomainColorRenderer(renderer, metrics.internalWidth, metrics.internalHeight);
  bindPipeline(gl, renderer);
  uploadRenderUniforms(renderer, job, metrics);
  draw(gl, renderer);
  copyToTarget(renderer, job);

  return true;
}

function domainRenderersAvailable(renderers) {
  return PLANES.some((plane) => !!renderers[plane]);
}

function currentFunctionSupported(functionName, isWPlaneColoring) {
  if (isWebGLDomainColoringFunctionSupported(functionName, isWPlaneColoring)) return true;

  warnWebGLDomainFunctionFallback(functionName);
  return false;
}

export function getWebGLDomainColorRenderScale() {

  const baseScale = finite(WEBGL_DOMAIN_COLOR_SUPERSAMPLE, CFG.defaultSupersample);
  const stressScale = finite(WEBGL_DOMAIN_COLOR_STRESS_SCALE, CFG.defaultStressScale);
  const requestedScale = state?.webglGpuStressMode ? Math.max(baseScale, stressScale) : baseScale;
  const dpr = finite(typeof window === 'undefined' ? 1 : window.devicePixelRatio, 1);
  const dprBoost = clamp(dpr * CFG.dprScaleFactor, 1, CFG.maxDprBoost);

  return clamp(requestedScale * dprBoost, 1, CFG.maxRenderScale);
}

export function createWebGLDomainColorRenderer() {
  const contextBundle = createCanvasAndWebGLContext();
  if (!contextBundle) return null;

  const { canvas, gl } = contextBundle;
  const fragmentSource = createFragmentSource();
  const key = serializeProgramMathForCache();
  const record = createProgramRecord(gl, fragmentSource);
  if (!record) return null;

  const quadBuffer = createQuadBuffer(gl);
  if (!quadBuffer) {
    gl.deleteProgram(record.program);
    return null;
  }

  return buildRenderer(canvas, gl, quadBuffer, key, record);
}

export function isWebGLDomainColoringFunctionSupported(functionName, isWPlaneColoring = false) {
  if (!isWPlaneColoring && isDynamicAggregateGLSLActive(state)) {
    const compiled = buildDynamicAggregateGLSL(
      state,
      name => getWebGLDomainColorFunctionIdShared(name, true)
    );
    return Boolean(compiled.source && !compiled.error);
  }
  return !!isWPlaneColoring || getWebGLDomainColorFunctionIdShared(functionName) !== 0;
}

export function resizeWebGLDomainColorRenderer(renderer, width, height) {
  if (!renderer?.canvas) return;

  const nextWidth = positivePixelSize(width);
  const nextHeight = positivePixelSize(height);
  if (!nextWidth || !nextHeight) return;

  if (renderer.canvas.width !== nextWidth || renderer.canvas.height !== nextHeight) {
    renderer.canvas.width = nextWidth;
    renderer.canvas.height = nextHeight;
    if (renderer.pipelineState) {
      renderer.pipelineState.viewportWidth = -1;
      renderer.pipelineState.viewportHeight = -1;
    }
  }
}

export function getNormalizedSphereLightDirection() {
  const lx = finiteNumber(SPHERE_LIGHT_DIRECTION_CAMERA?.x, 0);
  const ly = finiteNumber(SPHERE_LIGHT_DIRECTION_CAMERA?.y, 0);
  const lz = finiteNumber(SPHERE_LIGHT_DIRECTION_CAMERA?.z, 1);
  const magnitude = Math.hypot(lx, ly, lz);

  return Number.isFinite(magnitude) && magnitude >= 1e-9
    ? { x: lx / magnitude, y: ly / magnitude, z: lz / magnitude }
    : { x: 0, y: 0, z: 1 };
}

export function initializeWebGLDomainColoringSupport() {
  if (!webglDomainColorSupport) return;

  resetSupportObject(webglDomainColorSupport);

  if (!state?.webglDomainColoringEnabled) {
    webglDomainColorSupport.reason = 'disabled';
    return;
  }

  const renderers = recordFromPlanes(createWebGLDomainColorRenderer);
  if (!domainRenderersAvailable(renderers)) {
    webglDomainColorSupport.reason = 'context-or-program-init-failed';
    console.info('GPU domain coloring unavailable, using CPU fallback.');
    return;
  }

  const diagnostics = recordFromPlanes((plane) => (
    renderers[plane] ? getWebGLBackendInfoShared(renderers[plane].gl) : null
  ));

  installSupportRenderers(webglDomainColorSupport, renderers, diagnostics);
  if (mathRendererHashDirty) {
    mathRendererHashCached = serializeProgramMathForCache();
    mathRendererHashDirty = false;
  }
  webglDomainColorSupport.lastAlgHash = mathRendererHashCached;
  announceBackend(diagnostics);
}

export function getWebGLDomainColorRenderer(planeKey) {
  return PLANE_KEYS.has(planeKey) ? webglDomainColorSupport?.renderers?.[planeKey] || null : null;
}

export function inferDomainColorPlaneKey(targetCtx, planeKeyHint) {
  if (planeKeyHint === 'z' || planeKeyHint === 'w') return planeKeyHint;
  if (targetCtx === context.zDomainColorCtx) return 'z';
  if (targetCtx === context.wDomainColorCtx) return 'w';
  return 'z';
}

export function warnWebGLDomainFunctionFallback(functionName) {
  const warned = webglDomainColorSupport?.warnedFunctionFallbacks;
  if (!warned?.has || !warned?.add || warned.has(functionName)) return;

  warned.add(functionName);
  console.info(`GPU domain coloring not available for "${functionName}", using CPU fallback.`);
}

export function renderDomainColoringWithWebGL(targetCtx, planeParams, options = null) {
  if (!targetCtx || !planeParams || !webglDomainColorSupport?.available) return false;
  if (!state?.webglDomainColoringEnabled) return false;
  if (!refreshMathRendererIfNeeded()) return false;

  const job = resolveRenderJob(targetCtx, planeParams, options);
  if (!job) return false;
  if (!currentFunctionSupported(state.currentFunction, job.isWPlaneColoring)) return false;

  return executeRenderJob(job);
}

export function getGPUBackendStatus() {
  const lineDiag = context.webglSupport || null;
  const domainDiag = context.webglDomainColorSupport || null;
  const currentFunctionName = state?.currentFunction || null;

  return {
    lineRendering: lineDiag ? {
      available: !!lineDiag.available,
      reason: lineDiag.reason,
      diagnostics: lineDiag.diagnostics || null
    } : null,
    domainColoring: domainDiag ? {
      available: !!domainDiag.available,
      reason: domainDiag.reason,
      diagnostics: domainDiag.diagnostics || null,
      currentFunction: currentFunctionName,
      currentFunctionSupported: currentFunctionName
        ? isWebGLDomainColoringFunctionSupported(currentFunctionName, false)
        : null,
      zetaContinuationEnabled: !!state?.zetaContinuationEnabled
    } : null
  };
}

if (typeof window !== 'undefined') {
  window.getGPUBackendStatus = getGPUBackendStatus;
}
