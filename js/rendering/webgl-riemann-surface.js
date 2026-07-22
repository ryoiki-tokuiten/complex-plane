import { state, zPlaneParams } from '../store/state.js';
import { computeTaylorSeriesCoefficients } from '../math-utils.js';
import { ZETA_REFLECTION_POINT_RE } from '../constants/numerical.js';
import {
  GLSL_COMPLEX_MATH_LIBRARY_BASE,
  createWebGLProgramShared,
  getWebGLBackendInfoShared,
  getWebGLDomainColorFunctionIdShared
} from './webgl-shared.js';
import {
  buildDynamicAggregateGLSL,
  dynamicAggregateGLSLSignature,
  isDynamicAggregateGLSLActive,
  compileCustomExpressionToGLSL,
  GLSL_EXPRESSION_HELPERS
} from '../math/expression/glsl.js';
import {
  getBranchWindowLabel,
  getSurfaceComponentLabel,
  getVisibleBranchIndices,
  surfaceStageHasBranches
} from '../analysis/riemann-surface.js';
import { orbitColoringModeId } from '../constants/rendering.js';
import {
  createDomainPaletteGlslSource,
  getDomainPaletteShaderId
} from '../constants/domain-palettes.js';

const DEFAULT_CAMERA = Object.freeze({ rotX: -0.82, rotY: 0.62, distance: 3.8 });

const LIMITS = Object.freeze({
  minStage: 1,
  maxStage: 512,
  minResolution: 42,
  // WebGL1 UINT16 element indices top out at a 254x254 grid; renderers with
  // OES_element_index_uint lift the surface to a much denser 1024x1024 lattice.
  maxResolution: 1024,
  uint16MaxResolution: 254,
  resolutionBase: 256,
  resolutionScale: 16,
  minDistance: 0.001,
  maxDistance: 100,
  maxPixelRatio: 4,
  branchCutPixels: 0.8,
  minBranchCutWidth: 1.0e-7,
  minHeightClip: 1.0e-7
});

const CHAIN_MODE_IDS = Object.freeze({
  recursion: 1,
  zero_seed: 2
});

const SURFACE_COMPONENT_IDS = Object.freeze({
  real: 1,
  imaginary: 2,
  magnitude: 3,
  phase: 4
});

const POLYNOMIAL_FUNCTION_ID = getWebGLDomainColorFunctionIdShared('polynomial', true);
const MOBIUS_FUNCTION_ID = getWebGLDomainColorFunctionIdShared('mobius', true);
const ALGEBRAIC_C_FUNCTION_ID = -1;
const ALGEBRAIC_INVALID_FUNCTION_ID = -2;

const SURFACE_PALETTE_GLSL = createDomainPaletteGlslSource('surfacePaletteColor');

const UNIFORM_NAMES = Object.freeze({
  uViewBounds: 'u_viewBounds',
  uModelView: 'u_modelView',
  uProjection: 'u_projection',
  uFunctionParams: 'u_functionParams',
  uMobiusAB: 'u_mobiusAB',
  uMobiusCD: 'u_mobiusCD',
  uIntParams: 'u_intParams',
  uRenderParams: 'u_renderParams',
  uDomainParams: 'u_domainParams',
  uDomainIntParams: 'u_domainIntParams',
  uBranchParams: 'u_branchParams',
  uDomainStep: 'u_domainStep',
  uNormalizedStep: 'u_normalizedStep',
  uTaylorCenter: 'u_taylorCenter',
  uContourParams: 'u_contourParams'
});

const PACKED_SURFACE_UNIFORMS_GLSL = `uniform vec4 u_functionParams;
uniform vec4 u_mobiusAB;
uniform vec4 u_mobiusCD;
uniform vec4 u_intParams;
uniform vec4 u_renderParams;
uniform vec4 u_domainParams;
uniform vec4 u_domainIntParams;
uniform vec4 u_branchParams;
uniform vec4 u_contourParams;
uniform vec2 u_polyCoeffs[11];
uniform vec2 u_taylorCenter;
uniform vec2 u_taylorCoefficients[9];
#define u_functionId u_functionParams.x
#define u_zetaContinuationEnabled u_functionParams.y
#define u_zetaReflectionBoundary u_functionParams.z
#define u_fracPower u_functionParams.w
#define u_mobiusA u_mobiusAB.xy
#define u_mobiusB u_mobiusAB.zw
#define u_mobiusC u_mobiusCD.xy
#define u_mobiusD u_mobiusCD.zw
#define u_polyDegree int(u_intParams.x)
#define u_stage int(u_intParams.y)
#define u_chainMode int(u_intParams.z)
#define u_surfaceComponent int(u_intParams.w)
#define u_derivativeMode u_renderParams.x
#define u_heightScale u_renderParams.y
#define u_heightClip u_renderParams.z
#define u_useTaylor u_renderParams.w
#define u_domainBrightness u_domainParams.x
#define u_domainContrast u_domainParams.y
#define u_domainSaturation u_domainParams.z
#define u_domainLightnessCycles u_domainParams.w
#define u_domainPalette int(u_domainIntParams.x)
#define u_chainCount int(u_domainIntParams.y)
#define u_taylorOrder int(u_domainIntParams.z)
#define u_orbitColoringMode int(u_domainIntParams.w)
#define u_branchIndex u_branchParams.x
#define u_branchCutWidth u_branchParams.y
#define u_sheetTint u_branchParams.z
#define u_wirePass u_branchParams.w
#define u_contoursEnabled u_contourParams.x
#define u_contourInterval u_contourParams.y
#define u_contourThickness u_contourParams.z`;

const ARRAY_UNIFORMS = Object.freeze([
  { key: 'uPolyCoeffs', name: 'u_polyCoeffs', length: 11 },
  { key: 'uTaylorCoefficients', name: 'u_taylorCoefficients', length: 9 }
]);

// Immutable CPU-side mesh data is shared across renderers; GPU buffers remain renderer-owned.
const GRID_DATA_CACHE = new Map();

// Shader libraries are pure for a program signature. Caching avoids compiling vertex and fragment
// shaders from two independently regenerated copies of the same math code.
const SHADER_LIBRARY_CACHE = new Map();
const SHADER_LIBRARY_CACHE_LIMIT = 256;

const EMPTY_ARRAY = Object.freeze([]);
const ZERO_COMPLEX = Object.freeze({ re: 0, im: 0 });
const UINT16_INDEX_LIMIT = 0xffff;

function gridIndexArrayType(resolution) {
  const vertexCount = (resolution + 1) * (resolution + 1);
  return vertexCount > UINT16_INDEX_LIMIT ? Uint32Array : Uint16Array;
}

// Program signatures are control-plane data. Keep the signature canonical so
// in-place formula edits still rebuild shaders, while caching derived metadata
// such as function-uniform usage for unchanged signatures.
const PROGRAM_SIGNATURE_BY_STATE = new WeakMap();

// Dynamic aggregate validation is expensive because it emits GLSL. The result is
// purely determined by the program signature, so validate once per signature.
const DYNAMIC_VALIDATION_CACHE = new Map();
const DYNAMIC_VALIDATION_CACHE_LIMIT = 32;

// Branch windows have a tiny input domain in practice; caching the imported result
// keeps exact downstream semantics while avoiding per-frame Array.from allocation.
const BRANCH_INDICES_CACHE = new Map();
const BRANCH_INDICES_CACHE_LIMIT = 96;

const HUD_BRANCH_LABEL_CACHE = new Map();
const HUD_COMPONENT_LABEL_CACHE = new Map();
const SINGLE_BRANCH_LABEL_KEY = Object.freeze([]);
const CHAIN_STAGE_LABELS = Array.from({ length: LIMITS.maxStage + 1 }, (_, stage) => `chain ${Math.max(0, stage - 1)}`);

const EMPTY_DYNAMIC_AGGREGATE_GLSL = `bool evaluateDynamicAggregate(
  vec2 s,
  vec2 c,
  vec2 mA,
  vec2 mB,
  vec2 mC,
  vec2 mD,
  int polyDeg,
  vec2 polyCoeffs[11],
  float zetaCont,
  float zetaRefl,
  float fracPower,
  out vec2 mapped
) {
  mapped = vec2(0.0);
  return false;
}
bool evaluateDynamicAggregateOnSheet(
  vec2 s,
  vec2 c,
  float branchIndex,
  float branchCutWidth,
  vec2 mA,
  vec2 mB,
  vec2 mC,
  vec2 mD,
  int polyDeg,
  vec2 polyCoeffs[11],
  float zetaCont,
  float zetaRefl,
  float fracPower,
  out vec2 mapped
) {
  mapped = vec2(0.0);
  return false;
}`;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function finiteInteger(value, fallback = 0) {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function normalizeStage(stage) {
  return clamp(finiteInteger(stage, LIMITS.minStage), LIMITS.minStage, LIMITS.maxStage);
}

function normalizeResolution(gridDensity) {
  const requested = LIMITS.resolutionBase + finiteInteger(gridDensity, 15) * LIMITS.resolutionScale;
  return clamp(requested, LIMITS.minResolution, LIMITS.maxResolution);
}

function normalizeRendererResolution(gridDensity, supportsUint32Indices) {
  const resolution = normalizeResolution(gridDensity);
  return supportsUint32Indices ? resolution : Math.min(resolution, LIMITS.uint16MaxResolution);
}

function rememberBounded(cache, key, value, limit) {
  if (cache.size >= limit) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
  return value;
}

function complexRe(value) {
  return value && typeof value === 'object' ? (+value.re || 0) : 0;
}

function complexIm(value) {
  return value && typeof value === 'object' ? (+value.im || 0) : 0;
}

function algebraicTermsArray(appState) {
  return Array.isArray(appState && appState.algebraicChainingTerms)
    ? appState.algebraicChainingTerms
    : EMPTY_ARRAY;
}

const algebraicTermCoeffUniformName = termIndex => `u_algTermCoeff_${termIndex}`;
const algebraicFactorInfoUniformName = (termIndex, factorIndex) => `u_algFactorInfo_${termIndex}_${factorIndex}`;

function algebraicFunctionUniformId(functionName) {
  if (!functionName || functionName === 'none') return 0;
  if (functionName === 'c') return ALGEBRAIC_C_FUNCTION_ID;
  const functionId = getWebGLDomainColorFunctionIdShared(functionName, true);
  return functionId || ALGEBRAIC_INVALID_FUNCTION_ID;
}

function algebraicFactorFlags(factor) {
  return (factor?.reciprocal ? 1 : 0)
    + (factor?.log ? 2 : 0)
    + (factor?.exp ? 4 : 0);
}

function emitAlgebraicFactor(factor, termIndex, factorIndex) {
  if (!factor || !factor.func || factor.func === 'none') return '';

  const infoUniform = algebraicFactorInfoUniformName(termIndex, factorIndex);

  const steps = [
    '      {',
    '        vec2 factorValue = z;',
    '        vec2 tempValue = vec2(0.0);',
    `        vec4 factorInfo = ${infoUniform};`,
    '        float factorFlags = floor(factorInfo.w + 0.5);',
    '        if (abs(factorInfo.y) > 0.5) {',
    '          if (factorInfo.y < -1.5) return false;',
    '          if (factorInfo.y < -0.5) {',
    '            factorValue = c;',
    '          } else {',
    '            if (!evaluateBasicOnSheet(factorInfo.y, factorValue, branchIndex, branchCutWidth, mA, mB, mC, mD, polyDeg, polyCoeffs, zetaCont, zetaRefl, fracPower, tempValue)) return false;',
    '            factorValue = tempValue;',
    '          }',
    '        }',
    '        if (factorInfo.x < -1.5) return false;',
    '        if (factorInfo.x < -0.5) {',
    '          factorValue = c;',
    '        } else {',
    '          if (!evaluateBasicOnSheet(factorInfo.x, factorValue, branchIndex, branchCutWidth, mA, mB, mC, mD, polyDeg, polyCoeffs, zetaCont, zetaRefl, fracPower, tempValue)) return false;',
    '          factorValue = tempValue;',
    '        }'
  ];

  steps.push(
    '        if (abs(factorInfo.z - 1.0) >= 1.0e-9) {',
    '          float nearestPowerInteger = floor(factorInfo.z + 0.5);',
    '          bool powerIsInteger = abs(factorInfo.z - nearestPowerInteger) < 1.0e-9;',
    '          if (!complexPowRealOnSheet(factorValue, factorInfo.z, powerIsInteger ? 0.0 : branchIndex, powerIsInteger ? 0.0 : branchCutWidth, tempValue)) return false;',
    '          factorValue = tempValue;',
    '        }'
  );

  steps.push(
    '        if (mod(factorFlags, 2.0) >= 0.5) {',
    '          if (dot(factorValue, factorValue) < 1.0e-20) return false;',
    '          factorValue = complexDiv(vec2(1.0, 0.0), factorValue);',
    '        }',
    '        if (mod(floor(factorFlags / 2.0), 2.0) >= 0.5) {',
    '          if (!complexLnOnSheet(factorValue, branchIndex, branchCutWidth, tempValue)) return false;',
    '          factorValue = tempValue;',
    '        }',
    '        if (mod(floor(factorFlags / 4.0), 2.0) >= 0.5) factorValue = complexExp(factorValue);'
  );

  steps.push('        termValue = complexMul(termValue, factorValue);', '      }');
  return steps.join('\n');
}

function emitAlgebraicTerm(term, termIndex) {
  const factors = Array.isArray(term && term.factors) ? term.factors : [];
  const factorBody = factors
    .map((factor, factorIndex) => emitAlgebraicFactor(factor, termIndex, factorIndex))
    .filter(Boolean)
    .join('\n');

  return `    {
      vec2 termValue = ${algebraicTermCoeffUniformName(termIndex)};
${factorBody}
      sum = complexAdd(sum, termValue);
    }
    // algebraic term ${termIndex + 1}`;
}

function buildAlgebraicUniformDeclarations(appState) {
  const declarations = [];
  algebraicTermsArray(appState).forEach((term, termIndex) => {
    declarations.push(`uniform vec2 ${algebraicTermCoeffUniformName(termIndex)};`);
    const factors = Array.isArray(term && term.factors) ? term.factors : EMPTY_ARRAY;
    factors.forEach((factor, factorIndex) => {
      if (factor && factor.func && factor.func !== 'none') {
        declarations.push(`uniform vec4 ${algebraicFactorInfoUniformName(termIndex, factorIndex)};`);
      }
    });
  });
  return declarations.join('\n');
}

function buildAlgebraicBranchBody(appState) {
  const terms = algebraicTermsArray(appState);
  const zExpr = appState?.algebraicChainingZExpr || 'z';
  const steps = [];

  if (zExpr !== 'z') {
    const zCustomExprGLSL = compileCustomExpressionToGLSL(
      zExpr,
      functionName => getWebGLDomainColorFunctionIdShared(functionName, true)
    );
    if (!zCustomExprGLSL) {
      steps.push('    mapped = vec2(0.0);', '    return false;');
    } else if (zCustomExprGLSL !== 'z') {
      steps.push(`    z = ${zCustomExprGLSL};`);
    }
  }

  steps.push(
    '    vec2 sum = vec2(0.0);',
    ...terms.map(emitAlgebraicTerm),
    '    mapped = sum;',
    '    return isFiniteVec2Compat(mapped);'
  );

  return steps.join('\n');
}

/**
 * Shader functions are authored as dependency-aware modules rather than opaque
 * slabs. This keeps GLSL ES 1.00 compatibility while making assembly auditable:
 * callers request entry points and receive the minimum topologically ordered set.
 */
function assembleGlslModules(modules, entries, context = {}) {
  const emitted = [];
  const visiting = new Set();
  const visited = new Set();

  const visit = name => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`cyclic GLSL dependency: ${name}`);
    }

    const module = modules[name];
    if (!module) {
      throw new Error(`unknown GLSL module: ${name}`);
    }

    visiting.add(name);

    const dependencies = typeof module.deps === 'function'
      ? module.deps(context)
      : module.deps || [];

    dependencies.forEach(visit);
    visiting.delete(name);
    visited.add(name);

    emitted.push(typeof module.source === 'function'
      ? module.source(context)
      : module.source);
  };

  entries.forEach(visit);
  return emitted.join('\n\n');
}

const SURFACE_MATH_GLSL = Object.freeze({
  complexLnOnSheet: {
    deps: [],
    source: `bool complexLnOnSheet(vec2 z, float branchIndex, float branchCutWidth, out vec2 value) {
  float magnitude = length(z);
  if (magnitude < 1.0e-20) return false;
  if (branchCutWidth > 0.0 && z.x < 0.0 && abs(z.y) < branchCutWidth) return false;
  value = complexLn(z);
  value.y += branchIndex * TWO_PI;
  return isFiniteVec2Compat(value);
}`
  },

  complexPowRealOnSheet: {
    deps: ['complexLnOnSheet'],
    source: `bool complexPowRealOnSheet(vec2 z, float exponent, float branchIndex, float branchCutWidth, out vec2 value) {
  if (dot(z, z) < 1.0e-20) {
    if (exponent > 0.0) { value = vec2(0.0); return true; }
    return false;
  }
  vec2 logarithm = vec2(0.0);
  if (!complexLnOnSheet(z, branchIndex, branchCutWidth, logarithm)) return false;
  value = complexExp(vec2(exponent * logarithm.x, exponent * logarithm.y));
  return isFiniteVec2Compat(value);
}`
  },

  evaluateBasicOnSheet: {
    deps: ['complexLnOnSheet', 'complexPowRealOnSheet'],
    source: `bool evaluateBasicOnSheet(
  float functionId,
  vec2 z,
  float branchIndex,
  float branchCutWidth,
  vec2 mA,
  vec2 mB,
  vec2 mC,
  vec2 mD,
  int polyDeg,
  vec2 polyCoeffs[11],
  float zetaCont,
  float zetaRefl,
  float fracPower,
  out vec2 mapped
) {
  float fId = floor(functionId + 0.5);
  if (abs(fId - 6.0) < 0.5) {
    return complexLnOnSheet(z, branchIndex, branchCutWidth, mapped);
  }
  if (abs(fId - 15.0) < 0.5) {
    float nearestInteger = floor(fracPower + 0.5);
    bool isIntegerPower = abs(fracPower - nearestInteger) < 1.0e-5;
    return complexPowRealOnSheet(
      z,
      fracPower,
      isIntegerPower ? 0.0 : branchIndex,
      isIntegerPower ? 0.0 : branchCutWidth,
      mapped
    );
  }
  return evaluateBasicFuncShared(
    fId, z, mA, mB, mC, mD, polyDeg, polyCoeffs, zetaCont, zetaRefl, fracPower, mapped
  );
}`
  },

  evaluateTaylorSurface: {
    deps: [],
    source: `vec2 evaluateTaylorSurface(vec2 z, vec2 center, int order, vec2 coefficients[9]) {
  vec2 delta = z - center;
  vec2 power = vec2(1.0, 0.0);
  vec2 sum = vec2(0.0);
  for (int i = 0; i <= 8; i++) {
    if (i <= order) sum += complexMul(coefficients[i], power);
    power = complexMul(power, delta);
  }
  return sum;
}`
  },

  evaluateSurfaceBase: {
    deps: ['evaluateTaylorSurface', 'evaluateBasicOnSheet'],
    source: ({ appState }) => `bool evaluateSurfaceBase(
  vec2 z,
  vec2 c,
  float functionId,
  float branchIndex,
  float branchCutWidth,
  vec2 mA,
  vec2 mB,
  vec2 mC,
  vec2 mD,
  int polyDeg,
  vec2 polyCoeffs[11],
  float zetaCont,
  float zetaRefl,
  float fracPower,
  float useTaylor,
  vec2 taylorCenter,
  int taylorOrder,
  vec2 taylorCoefficients[9],
  out vec2 mapped
) {
  if (useTaylor > 0.5) {
    mapped = evaluateTaylorSurface(z, taylorCenter, taylorOrder, taylorCoefficients);
    return isFiniteVec2Compat(mapped);
  }
  float fId = floor(functionId + 0.5);
  if (abs(fId - 17.0) < 0.5) {
    return evaluateDynamicAggregateOnSheet(
      z, c, branchIndex, branchCutWidth, mA, mB, mC, mD,
      polyDeg, polyCoeffs, zetaCont, zetaRefl, fracPower, mapped
    );
  }
  if (abs(fId - 16.0) < 0.5) {
${buildAlgebraicBranchBody(appState)}
  }
  return evaluateBasicOnSheet(
    fId, z, branchIndex, branchCutWidth, mA, mB, mC, mD,
    polyDeg, polyCoeffs, zetaCont, zetaRefl, fracPower, mapped
  );
}`
  },

  evaluateSurfaceStage: {
    deps: ['evaluateSurfaceBase'],
    source: `bool evaluateSurfaceStage(
  vec2 z,
  vec2 c,
  int stage,
  int chainMode,
  float functionId,
  float branchIndex,
  float branchCutWidth,
  vec2 mA,
  vec2 mB,
  vec2 mC,
  vec2 mD,
  int polyDeg,
  vec2 polyCoeffs[11],
  float zetaCont,
  float zetaRefl,
  float fracPower,
  float useTaylor,
  vec2 taylorCenter,
  int taylorOrder,
  vec2 taylorCoefficients[9],
  out vec2 mapped
) {
  if (chainMode == 2) {
    mapped = vec2(0.0);
    for (int i = 0; i < 512; i++) {
      if (i >= stage) break;
      bool seedOk = evaluateSurfaceBase(
        mapped, c, functionId, branchIndex, branchCutWidth, mA, mB, mC, mD,
        polyDeg, polyCoeffs, zetaCont, zetaRefl, fracPower,
        useTaylor, taylorCenter, taylorOrder, taylorCoefficients, mapped
      );
      if (!seedOk || !isFiniteVec2Compat(mapped)) return false;
    }
    return isFiniteVec2Compat(mapped);
  }

  bool ok = evaluateSurfaceBase(
    z, c, functionId, branchIndex, branchCutWidth, mA, mB, mC, mD,
    polyDeg, polyCoeffs, zetaCont, zetaRefl, fracPower,
    useTaylor, taylorCenter, taylorOrder, taylorCoefficients, mapped
  );
  if (!ok) return false;
  for (int i = 1; i < 512; i++) {
    if (i >= stage) break;
    ok = evaluateSurfaceBase(
      mapped, c, functionId, branchIndex, branchCutWidth, mA, mB, mC, mD,
      polyDeg, polyCoeffs, zetaCont, zetaRefl, fracPower,
      useTaylor, taylorCenter, taylorOrder, taylorCoefficients, mapped
    );
    if (!ok || !isFiniteVec2Compat(mapped)) return false;
  }
  return isFiniteVec2Compat(mapped);
}`
  }
});

const VERTEX_SURFACE_GLSL = Object.freeze({
  surfacePaletteColor: {
    deps: [],
    source: () => SURFACE_PALETTE_GLSL
  },

  surfaceHeight: {
    deps: [],
    source: `float surfaceHeight(vec2 value) {
  if (u_surfaceComponent == 1) return value.x;
  if (u_surfaceComponent == 3) return length(value);
  if (u_surfaceComponent == 4) return atan(value.y, value.x);
  return value.y;
}`
  },

  surfaceColor: {
    deps: ['surfacePaletteColor'],
    source: `vec3 surfaceColor(vec2 value) {
  float phase = atan(value.y, value.x);
  float hue = fract(phase / TWO_PI + u_sheetTint);
  float logMagnitude = log(1.0 + length(value));
  float detail = max(0.05, u_domainLightnessCycles);
  float tone = atan(logMagnitude * (0.72 + detail * 0.28)) / 1.5707963267948966;
  float magnitudeLightness = u_domainLightnessCycles <= 0.0001
    ? 0.5
    : mix(0.34, 0.72, clamp(tone, 0.0, 1.0));
  float lightness = clamp(
    (0.5 + (magnitudeLightness - 0.5) * u_domainContrast) * u_domainBrightness,
    0.08,
    0.92
  );
  vec3 color = surfacePaletteColor(u_domainPalette, hue);
  if (lightness < 0.5) color *= lightness / 0.5;
  else color = mix(color, vec3(1.0), (lightness - 0.5) / 0.5);
  float gray = dot(color, vec3(0.299, 0.587, 0.114));
  return mix(vec3(gray), color, clamp(u_domainSaturation, 0.0, 1.0));
}`
  },

  mapSurfacePoint: {
    deps: ['surfaceHeight'],
    source: `bool mapSurfacePoint(vec2 z, out vec2 mapped, out float height) {
  bool ok;
  if (u_derivativeMode > 0.5) {
    float h = 1.0e-6 * max(1.0, max(abs(z.x), abs(z.y)));
    vec2 rightValue = vec2(0.0);
    vec2 leftValue = vec2(0.0);
    bool rightOk = evaluateSurfaceStage(
      z + vec2(h, 0.0), z + vec2(h, 0.0), u_stage, u_chainMode, u_functionId, u_branchIndex, u_branchCutWidth,
      u_mobiusA, u_mobiusB, u_mobiusC, u_mobiusD, u_polyDegree, u_polyCoeffs,
      u_zetaContinuationEnabled, u_zetaReflectionBoundary, u_fracPower,
      u_useTaylor, u_taylorCenter, u_taylorOrder, u_taylorCoefficients, rightValue
    );
    bool leftOk = evaluateSurfaceStage(
      z - vec2(h, 0.0), z - vec2(h, 0.0), u_stage, u_chainMode, u_functionId, u_branchIndex, u_branchCutWidth,
      u_mobiusA, u_mobiusB, u_mobiusC, u_mobiusD, u_polyDegree, u_polyCoeffs,
      u_zetaContinuationEnabled, u_zetaReflectionBoundary, u_fracPower,
      u_useTaylor, u_taylorCenter, u_taylorOrder, u_taylorCoefficients, leftValue
    );
    ok = rightOk && leftOk;
    mapped = (rightValue - leftValue) / (2.0 * h);
  } else {
    ok = evaluateSurfaceStage(
      z, z, u_stage, u_chainMode, u_functionId, u_branchIndex, u_branchCutWidth,
      u_mobiusA, u_mobiusB, u_mobiusC, u_mobiusD, u_polyDegree, u_polyCoeffs,
      u_zetaContinuationEnabled, u_zetaReflectionBoundary, u_fracPower,
      u_useTaylor, u_taylorCenter, u_taylorOrder, u_taylorCoefficients, mapped
    );
  }
  if (!ok) return false;
  height = clamp(surfaceHeight(mapped) / max(u_heightClip, 1.0e-4), -1.0, 1.0) * u_heightScale;
  return isFiniteFloatCompat(height);
}`
  },

  main: {
    deps: ['mapSurfacePoint', 'surfaceColor'],
    source: `void main() {
  vec2 z = vec2(
    mix(u_viewBounds.x, u_viewBounds.y, a_grid.x),
    mix(u_viewBounds.z, u_viewBounds.w, a_grid.y)
  );
  v_z = z;
  vec2 mapped = vec2(0.0);
  float height = 0.0;
  bool ok = mapSurfacePoint(z, mapped, height);
  float nx = mix(-1.18, 1.18, a_grid.x);
  float nz = mix(-1.0, 1.0, a_grid.y);
  vec3 localPosition = vec3(nx, height, nz);

  // Normal reconstruction is deferred to fragment derivatives. This removes
  // two extra complex-surface evaluations per vertex while preserving a stable
  // orientation vector for face-forwarding the geometric normal.
  vec3 localNormal = vec3(0.0, 1.0, 0.0);

  vec4 viewPosition = u_modelView * vec4(localPosition, 1.0);
  v_viewPosition = viewPosition.xyz;
  v_normal = normalize(mat3(u_modelView) * localNormal);
  v_color = surfaceColor(mapped);
  v_valid = ok ? 1.0 : 0.0;
  v_heightVal = ok ? surfaceHeight(mapped) : 0.0;
  gl_Position = u_projection * viewPosition;
}`
  }
});

const FRAGMENT_GLSL = Object.freeze({
  highQualityNormal: {
    deps: [],
    source: `vec3 highQualityNormal(vec3 interpolatedNormal, vec3 viewPosition) {
  vec3 geometricNormal = normalize(cross(dFdx(viewPosition), dFdy(viewPosition)));
  if (dot(geometricNormal, interpolatedNormal) < 0.0) geometricNormal = -geometricNormal;
  return geometricNormal;
}`
  },

  shadeSurface: {
    deps: [],
    source: `vec3 shadeSurface(vec3 color, vec3 normal, vec3 viewPosition) {
  // Decode sRGB to Linear for physically accurate math
  vec3 albedo = pow(max(color, vec3(0.0)), vec3(2.2));
  
  vec3 viewDir = normalize(-viewPosition);
  float ndotv = max(dot(normal, viewDir), 1e-4);
  
  // Glossy glass/ceramic material properties
  float roughness = 0.15;
  float metallic = 0.02;
  vec3 f0 = mix(vec3(0.04), albedo, metallic);
  
  // Schlick's Fresnel
  vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - ndotv, 5.0);
  
  // Energy conservation for diffuse
  vec3 kD = (1.0 - fresnel) * (1.0 - metallic);
  
  vec3 totalLight = vec3(0.0);
  
  // Light 1: Main Key Light (Warm, sharp specular)
  vec3 l1Dir = normalize(vec3(0.8, 1.0, 0.6));
  vec3 l1Col = vec3(1.3, 1.15, 1.0) * 1.8;
  vec3 h1 = normalize(l1Dir + viewDir);
  float diff1 = max(dot(normal, l1Dir), 0.0);
  float spec1 = pow(max(dot(normal, h1), 0.0), 128.0) * ((128.0 + 8.0) / (8.0 * 3.14159));
  totalLight += (kD * albedo / 3.14159 + fresnel * spec1) * l1Col * diff1;
  
  // Fake Subsurface glow from Key Light
  float sss = pow(max(dot(viewDir, -l1Dir), 0.0), 8.0) * 0.4;
  totalLight += albedo * sss * l1Col;
  
  // Light 2: Soft Fill Light (Cool, broad specular)
  vec3 l2Dir = normalize(vec3(-0.6, 0.2, -0.8));
  vec3 l2Col = vec3(0.2, 0.35, 0.6) * 1.2;
  vec3 h2 = normalize(l2Dir + viewDir);
  float diff2 = max(dot(normal, l2Dir), 0.0);
  float spec2 = pow(max(dot(normal, h2), 0.0), 32.0) * ((32.0 + 8.0) / (8.0 * 3.14159));
  totalLight += (kD * albedo / 3.14159 + fresnel * spec2) * l2Col * diff2;
  
  // Light 3: Rim / Backlight
  vec3 l3Dir = normalize(vec3(0.0, 0.9, -0.6));
  vec3 l3Col = vec3(0.7, 0.5, 0.9) * 2.0;
  float rim = smoothstep(0.4, 1.0, 1.0 - ndotv) * max(dot(normal, l3Dir), 0.0);
  totalLight += albedo * rim * l3Col;
  
  // Fake Studio Environment Map Reflection
  vec3 reflectDir = reflect(-viewDir, normal);
  float envMask = smoothstep(-0.3, 1.0, reflectDir.y);
  vec3 envColor = mix(vec3(0.02, 0.03, 0.05), vec3(0.5, 0.7, 1.0), envMask);
  // Add some fake rectangular area lights to the reflection
  envColor += vec3(1.0) * smoothstep(0.95, 0.98, max(dot(reflectDir, normalize(vec3(1.0, 0.8, 0.5))), 0.0));
  envColor += vec3(1.0) * smoothstep(0.96, 0.99, max(dot(reflectDir, normalize(vec3(-1.0, 0.4, -0.2))), 0.0));
  
  // Base ambient
  vec3 ambient = albedo * vec3(0.03, 0.04, 0.05);
  totalLight += ambient + fresnel * envColor * 1.5;
  
  // Horizon-weighted contact shadowing gives the mathematical sheet real mass without textures.
  float horizonOcclusion = mix(0.72, 1.0, smoothstep(-0.2, 0.85, normal.y));
  totalLight *= horizonOcclusion;

  // ACES Film Tonemapping
  vec3 x = totalLight;
  vec3 mapped = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  
  // Gamma Correction back to sRGB
  return pow(max(mapped, vec3(0.0)), vec3(1.0 / 2.2));
}`
  },

  iteratedDynamicsColor: {
    deps: [],
    source: `vec4 dynamicsEscapeColor(float smoothIteration, float brightnessFactor) {
  float count = max(float(u_chainCount), 1.0);
  float t = clamp(smoothIteration / count, 0.0, 1.0);
  vec3 baseColor = surfacePaletteColor(u_domainPalette, min(t, 0.9999));
  float lightnessBase = 0.22 + 0.58 * pow(t, 0.65);
  float lightnessContrasted = 0.5 + (lightnessBase - 0.5) * u_domainContrast;
  float lightnessFinal = clamp(lightnessContrasted * u_domainBrightness * brightnessFactor, 0.05, 0.95);
  vec3 lit = lightnessFinal < 0.5 ? baseColor * (lightnessFinal / 0.5) : mix(baseColor, vec3(1.0), (lightnessFinal - 0.5) / 0.5);
  float gray = dot(lit, vec3(0.299, 0.587, 0.114));
  return vec4(mix(vec3(gray), lit, clamp(u_domainSaturation, 0.0, 1.0)), 1.0);
}

vec4 dynamicsPhaseEventColor(vec2 value, float intensity, float brightnessFactor) {
  float hue = fract(atan(value.y, value.x) / TWO_PI);
  vec3 baseColor = surfacePaletteColor(u_domainPalette, hue);
  float t = clamp(intensity, 0.0, 1.0);
  float lightnessBase = 0.24 + 0.58 * pow(t, 0.55);
  float lightnessContrasted = 0.5 + (lightnessBase - 0.5) * u_domainContrast;
  float lightnessFinal = clamp(lightnessContrasted * u_domainBrightness * brightnessFactor, 0.05, 0.95);
  vec3 lit = lightnessFinal < 0.5 ? baseColor * (lightnessFinal / 0.5) : mix(baseColor, vec3(1.0), (lightnessFinal - 0.5) / 0.5);
  float gray = dot(lit, vec3(0.299, 0.587, 0.114));
  return vec4(mix(vec3(gray), lit, clamp(u_domainSaturation, 0.0, 1.0)), 1.0);
}

vec4 dynamicsValueColor(vec2 value, float brightnessFactor) {
  float phase = atan(value.y, value.x);
  float logMagnitude = log(1.0 + length(value));
  float detail = max(0.05, u_domainLightnessCycles);
  float tone = atan(logMagnitude * (0.72 + detail * 0.28)) / 1.5707963267948966;
  float lightnessBase = u_domainLightnessCycles <= 0.0001
    ? 0.5
    : mix(0.34, 0.72, clamp(tone, 0.0, 1.0));
  float lightnessContrasted = 0.5 + (lightnessBase - 0.5) * u_domainContrast;
  float lightnessFinal = clamp(lightnessContrasted * u_domainBrightness * brightnessFactor, 0.05, 0.95);
  vec3 baseColor = surfacePaletteColor(u_domainPalette, fract(phase / TWO_PI));
  vec3 lit = lightnessFinal < 0.5 ? baseColor * (lightnessFinal / 0.5) : mix(baseColor, vec3(1.0), (lightnessFinal - 0.5) / 0.5);
  float gray = dot(lit, vec3(0.299, 0.587, 0.114));
  return vec4(mix(vec3(gray), lit, clamp(u_domainSaturation, 0.0, 1.0)), 1.0);
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

  for (int i = 0; i < 512; i++) {
    if (i >= u_chainCount) break;

    vec2 nextValue = vec2(0.0);
    bool ok = evaluateSurfaceBase(
      current, parameterValue, u_functionId, u_branchIndex, u_branchCutWidth,
      u_mobiusA, u_mobiusB, u_mobiusC, u_mobiusD, u_polyDegree, u_polyCoeffs,
      u_zetaContinuationEnabled, u_zetaReflectionBoundary, u_fracPower,
      u_useTaylor, u_taylorCenter, u_taylorOrder, u_taylorCoefficients, nextValue
    );

    float magSq = dot(nextValue, nextValue);

    if (!ok || !isFiniteVec2Compat(nextValue) || magSq > escapeRadiusSq || max(abs(nextValue.x), abs(nextValue.y)) >= 1.0e18) {
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
    : vec4(0.0, 0.0, 0.0, 1.0);

  if (orbitMode == 2) return converged
    ? dynamicsPhaseEventColor(eventValue, convergenceIntensity(eventIteration), brightnessFactor)
    : vec4(0.0, 0.0, 0.0, 1.0);

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
}`
  },

  main: {
    deps: ['highQualityNormal', 'shadeSurface', 'iteratedDynamicsColor'],
    source: `void main() {
  if (v_valid < 0.995) discard;
  if (u_wirePass > 0.5) {
    gl_FragColor = vec4(mix(v_color, vec3(0.92, 0.88, 1.0), 0.7), 0.42);
    return;
  }
  
  vec3 baseColor = v_color;

  if (u_orbitColoringMode != 0 && u_chainCount > 1 && (u_chainMode == 1 || u_chainMode == 2)) {
    baseColor = iteratedDynamicsColor(v_z, u_chainMode, 1.0).rgb;
  }

  vec3 shadingNormal = highQualityNormal(normalize(v_normal), v_viewPosition);
  vec3 finalColor = shadeSurface(baseColor, shadingNormal, v_viewPosition);
  if (u_contoursEnabled > 0.5) {
    float valDeriv = length(vec2(dFdx(v_heightVal), dFdy(v_heightVal)));
    if (valDeriv > 1.0e-6) {
      float safeInterval = max(u_contourInterval, 1.0e-6);
      float contourCoord = v_heightVal / safeInterval;
      float distToContour = abs(contourCoord - floor(contourCoord + 0.5)) * safeInterval;
      float pixelDist = distToContour / valDeriv;
      float lineIntensity = 1.0 - smoothstep(max(0.0, u_contourThickness - 0.75), u_contourThickness + 0.75, pixelDist);
      finalColor = mix(finalColor, vec3(0.06), lineIntensity * 0.55);
    }
  }
  gl_FragColor = vec4(finalColor, 0.88);
}`
  }
});

function buildRiemannSurfaceMathLibraryUncached(appState) {
  const dynamic = buildDynamicAggregateGLSL(
    appState,
    functionName => getWebGLDomainColorFunctionIdShared(functionName, true)
  );
  const dynamicSource = dynamic.source || EMPTY_DYNAMIC_AGGREGATE_GLSL;
  return `${GLSL_COMPLEX_MATH_LIBRARY_BASE}
${GLSL_EXPRESSION_HELPERS}
${buildAlgebraicUniformDeclarations(appState)}
${dynamicSource}
${assembleGlslModules(SURFACE_MATH_GLSL, ['evaluateSurfaceStage'], { appState })}
`;
}

function buildCachedRiemannSurfaceMathLibrary(appState, signature) {
  const cached = SHADER_LIBRARY_CACHE.get(signature);
  return cached || rememberBounded(
    SHADER_LIBRARY_CACHE,
    signature,
    buildRiemannSurfaceMathLibraryUncached(appState),
    SHADER_LIBRARY_CACHE_LIMIT
  );
}

export function buildRiemannSurfaceMathLibrary(appState) {
  return buildCachedRiemannSurfaceMathLibrary(appState, getProgramSignature(appState));
}

function buildVertexShader(appState, signature = getProgramSignature(appState)) {
  return `
precision highp float;
precision highp int;
attribute vec2 a_grid;
uniform vec4 u_viewBounds;
uniform mat4 u_modelView;
uniform mat4 u_projection;
uniform vec2 u_domainStep;
uniform vec2 u_normalizedStep;
${PACKED_SURFACE_UNIFORMS_GLSL}
varying vec3 v_color;
varying vec3 v_normal;
varying vec3 v_viewPosition;
varying float v_valid;
varying vec2 v_z;
varying float v_heightVal;
${buildCachedRiemannSurfaceMathLibrary(appState, signature)}
${assembleGlslModules(VERTEX_SURFACE_GLSL, ['main'])}
`;
}

function buildFragmentShader(appState, signature = getProgramSignature(appState)) {
  return `
#extension GL_OES_standard_derivatives : enable
precision highp float;
precision highp int;
${PACKED_SURFACE_UNIFORMS_GLSL}

varying vec3 v_color;
varying vec3 v_normal;
varying vec3 v_viewPosition;
varying float v_valid;
varying vec2 v_z;
varying float v_heightVal;

${buildCachedRiemannSurfaceMathLibrary(appState, signature)}
${assembleGlslModules(VERTEX_SURFACE_GLSL, ['surfaceColor'])}
${assembleGlslModules(FRAGMENT_GLSL, ['main'])}
`;
}

/**
 * Writes T * Rx * Ry directly into a caller-owned column-major matrix.
 * The old path allocated five Float32Arrays per frame; this is allocation-free.
 */
function writeModelViewMatrix(out, camera) {
  const cx = Math.cos(camera.rotX);
  const sx = Math.sin(camera.rotX);
  const cy = Math.cos(camera.rotY);
  const sy = Math.sin(camera.rotY);

  out[0] = cy;
  out[1] = sx * sy;
  out[2] = -cx * sy;
  out[3] = 0;
  out[4] = 0;
  out[5] = cx;
  out[6] = sx;
  out[7] = 0;
  out[8] = sy;
  out[9] = -sx * cy;
  out[10] = cx * cy;
  out[11] = 0;
  out[12] = 0;
  out[13] = -0.08;
  out[14] = -camera.distance;
  out[15] = 1;
  return out;
}

function writeProjectionMatrix(out, canvas) {
  const f = 1 / Math.tan(Math.PI / 8);
  const aspect = Math.max(canvas.width / Math.max(1, canvas.height), 1.0e-6);
  const near = 0.1;
  const far = 30;
  const rangeInv = 1 / (near - far);

  out[0] = f / aspect;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = f;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = (near + far) * rangeInv;
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = near * far * 2 * rangeInv;
  out[15] = 0;
  return out;
}

function createGridVertices(resolution) {
  const side = resolution + 1;
  const rowLength = side * 2;
  const vertices = new Float32Array(side * rowLength);
  const rowTemplate = new Float32Array(rowLength);
  const invResolution = 1 / resolution;

  for (let x = 0, offset = 0; x <= resolution; x++) {
    rowTemplate[offset] = x * invResolution;
    offset += 2;
  }

  for (let y = 0, rowOffset = 0; y <= resolution; y++, rowOffset += rowLength) {
    vertices.set(rowTemplate, rowOffset);
    const v = y * invResolution;
    for (let offset = rowOffset + 1, end = rowOffset + rowLength; offset < end; offset += 2) {
      vertices[offset] = v;
    }
  }

  return vertices;
}

function createGridTriangles(resolution) {
  const side = resolution + 1;
  const triangles = new (gridIndexArrayType(resolution))(resolution * resolution * 6);
  let offset = 0;
  let rowTop = 0;

  for (let y = 0; y < resolution; y++, rowTop += side) {
    let topLeft = rowTop;
    let bottomLeft = rowTop + side;
    for (let x = 0; x < resolution; x++, topLeft++, bottomLeft++) {
      const topRight = topLeft + 1;
      const bottomRight = bottomLeft + 1;
      triangles[offset] = topLeft;
      triangles[offset + 1] = bottomLeft;
      triangles[offset + 2] = topRight;
      triangles[offset + 3] = topRight;
      triangles[offset + 4] = bottomLeft;
      triangles[offset + 5] = bottomRight;
      offset += 6;
    }
  }

  return triangles;
}

function createGridLines(resolution) {
  const side = resolution + 1;
  const stride = Math.max(1, Math.round(resolution / 18));
  const lineColumns = Math.floor(resolution / stride) + 1;
  const lineRows = Math.floor(resolution / stride) + 1;
  const indices = new (gridIndexArrayType(resolution))((lineColumns + lineRows) * resolution * 2);
  let offset = 0;

  for (let x = 0; x <= resolution; x += stride) {
    let top = x;
    for (let y = 0; y < resolution; y++, top += side) {
      indices[offset] = top;
      indices[offset + 1] = top + side;
      offset += 2;
    }
  }

  for (let y = 0, row = 0; y <= resolution; y += stride, row = y * side) {
    for (let x = 0; x < resolution; x++) {
      const left = row + x;
      indices[offset] = left;
      indices[offset + 1] = left + 1;
      offset += 2;
    }
  }

  return indices;
}

/**
 * Builds the high-resolution lattice once per resolution. Reusing immutable typed arrays
 * removes repeated O(n²) JS allocation when users scrub grid density interactively.
 */
function getGridData(resolution) {
  let data = GRID_DATA_CACHE.get(resolution);
  if (data) return data;

  data = Object.freeze({
    vertices: createGridVertices(resolution),
    triangles: createGridTriangles(resolution),
    lines: createGridLines(resolution)
  });
  GRID_DATA_CACHE.set(resolution, data);
  return data;
}

export function getRiemannSurfaceGridData(resolution = LIMITS.resolutionBase) {
  const normalized = Math.max(
    LIMITS.minResolution,
    Math.min(LIMITS.maxResolution, Math.floor(Number(resolution) || LIMITS.resolutionBase))
  );
  return getGridData(normalized);
}

function uploadBuffer(gl, target, data) {
  const buffer = gl.createBuffer();

  if (!buffer) return null;

  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, gl.STATIC_DRAW);
  return buffer;
}

function createGridMesh(gl, resolution) {
  const { vertices, triangles, lines } = getGridData(resolution);

  const vertexBuffer = uploadBuffer(gl, gl.ARRAY_BUFFER, vertices);
  const triangleBuffer = uploadBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, triangles);
  const lineBuffer = uploadBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, lines);

  if (!vertexBuffer || !triangleBuffer || !lineBuffer) {
    gl.deleteBuffer(vertexBuffer);
    gl.deleteBuffer(triangleBuffer);
    gl.deleteBuffer(lineBuffer);
    return null;
  }

  return {
    resolution,
    invResolution: 1 / resolution,
    vertexBuffer,
    triangleBuffer,
    triangleCount: triangles.length,
    triangleIndexType: triangles instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
    lineBuffer,
    lineCount: lines.length,
    lineIndexType: lines instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
  };
}

function disposeMesh(gl, mesh) {
  if (!mesh) return;

  gl.deleteBuffer(mesh.vertexBuffer);
  gl.deleteBuffer(mesh.triangleBuffer);
  gl.deleteBuffer(mesh.lineBuffer);
}

function disposeMeshCache(gl, meshCache) {
  if (!meshCache) return;

  meshCache.forEach(mesh => disposeMesh(gl, mesh));
  meshCache.clear();
}

function algebraicStructureSignature(algebraicTerms) {
  const terms = Array.isArray(algebraicTerms) ? algebraicTerms : EMPTY_ARRAY;
  let signature = '[';

  for (let termIndex = 0; termIndex < terms.length; termIndex++) {
    if (termIndex) signature += ',';
    signature += '{"factors":[';

    const term = terms[termIndex];
    const factors = Array.isArray(term && term.factors) ? term.factors : EMPTY_ARRAY;
    for (let factorIndex = 0; factorIndex < factors.length; factorIndex++) {
      if (factorIndex) signature += ',';
      const factor = factors[factorIndex];
      signature += factor && factor.func && factor.func !== 'none'
        ? '{"active":true}'
        : '{"func":"none"}';
    }

    signature += ']}';
  }

  return signature + ']';
}

function getProgramSignature(appState) {
  if (!appState || typeof appState !== 'object') {
    return 'az:z|a:[]|d:';
  }

  const algebraic = algebraicTermsArray(appState);
  const algebraicZ = appState.algebraicChainingZExpr || 'z';
  const dynamicActive = isDynamicAggregateGLSLActive(appState);
  const algebraicSignature = algebraicStructureSignature(algebraic);
  const dynamicSignature = dynamicActive
    ? dynamicAggregateGLSLSignature(appState)
    : '';
  const signature = `az:${algebraicZ}|a:${algebraicSignature}|d:${dynamicSignature}`;
  const cached = PROGRAM_SIGNATURE_BY_STATE.get(appState);

  if (cached
    && cached.algebraicZ === algebraicZ
    && cached.dynamicActive === dynamicActive
    && cached.algebraicSignature === algebraicSignature
    && cached.dynamicSignature === dynamicSignature) {
    return cached.signature;
  }

  PROGRAM_SIGNATURE_BY_STATE.set(appState, {
    algebraicZ,
    dynamicActive,
    algebraicSignature,
    dynamicSignature,
    signature
  });

  return signature;
}


export function getRiemannSurfaceProgramSignature(appState) {
  return getProgramSignature(appState);
}

function validateDynamicAggregate(appState, signature) {
  if (!isDynamicAggregateGLSLActive(appState)) return true;

  const cached = DYNAMIC_VALIDATION_CACHE.get(signature);
  if (cached !== undefined) return cached;

  const dynamic = buildDynamicAggregateGLSL(
    appState,
    functionName => getWebGLDomainColorFunctionIdShared(functionName, true)
  );
  const valid = Boolean(dynamic.source && !dynamic.error);
  rememberBounded(DYNAMIC_VALIDATION_CACHE, signature, valid, DYNAMIC_VALIDATION_CACHE_LIMIT);
  return valid;
}

function collectArrayUniformLocations(gl, program, name, length) {
  const locations = new Array(length);
  for (let index = 0; index < length; index++) {
    locations[index] = gl.getUniformLocation(program, `${name}[${index}]`);
  }
  locations.base = locations[0];
  return locations;
}

function uploadComplexUniformArray(gl, locations, data) {
  if (locations.base) {
    gl.uniform2fv(locations.base, data);
    return;
  }

  for (let i = 0; i < locations.length; i++) {
    gl.uniform2f(locations[i], data[i * 2], data[i * 2 + 1]);
  }
}

function collectAlgebraicUniformLocations(gl, program, appState) {
  return algebraicTermsArray(appState).map((term, termIndex) => {
    const factors = Array.isArray(term && term.factors) ? term.factors : EMPTY_ARRAY;
    return {
      coeff: gl.getUniformLocation(program, algebraicTermCoeffUniformName(termIndex)),
      factors: factors.map((factor, factorIndex) => {
        if (!factor || !factor.func || factor.func === 'none') return null;
        return {
          info: gl.getUniformLocation(program, algebraicFactorInfoUniformName(termIndex, factorIndex))
        };
      })
    };
  });
}

function uploadAlgebraicUniforms(gl, locations, appState) {
  const terms = algebraicTermsArray(appState);
  const termLocations = locations.algebraicTerms || EMPTY_ARRAY;
  for (let termIndex = 0; termIndex < termLocations.length; termIndex++) {
    const term = terms[termIndex];
    const termLocation = termLocations[termIndex];
    const coeff = term && term.coeff;
    if (termLocation.coeff) {
      gl.uniform2f(termLocation.coeff, finiteNumber(coeff?.re), finiteNumber(coeff?.im));
    }

    const factors = Array.isArray(term && term.factors) ? term.factors : EMPTY_ARRAY;
    for (let factorIndex = 0; factorIndex < termLocation.factors.length; factorIndex++) {
      const factorLocation = termLocation.factors[factorIndex];
      if (!factorLocation) continue;

      const factor = factors[factorIndex];
      if (factorLocation.info) {
        gl.uniform4f(
          factorLocation.info,
          algebraicFunctionUniformId(factor?.func),
          algebraicFunctionUniformId(factor?.chainedFunc),
          finiteNumber(factor?.power, 1),
          algebraicFactorFlags(factor)
        );
      }
    }
  }
}

function collectUniformLocations(gl, program, appState) {
  const locations = {
    aGrid: gl.getAttribLocation(program, 'a_grid')
  };

  for (const [key, uniformName] of Object.entries(UNIFORM_NAMES)) {
    locations[key] = gl.getUniformLocation(program, uniformName);
  }

  for (const descriptor of ARRAY_UNIFORMS) {
    locations[descriptor.key] = collectArrayUniformLocations(
      gl,
      program,
      descriptor.name,
      descriptor.length
    );
  }

  locations.algebraicTerms = collectAlgebraicUniformLocations(gl, program, appState);

  return locations;
}

function rebuildProgram(renderer, signature = getProgramSignature(state)) {
  const { gl } = renderer;
  if (renderer.contextLost || gl.isContextLost?.()) {
    renderer.contextLost = true;
    return false;
  }

  const program = createWebGLProgramShared(
    gl,
    buildVertexShader(state, signature),
    buildFragmentShader(state, signature)
  );

  if (!program) {
    return false;
  }

  if (renderer.program) gl.deleteProgram(renderer.program);

  renderer.program = program;
  renderer.locations = collectUniformLocations(gl, program, state);
  renderer.programSignature = signature;
  // Uniform buffers are always resident in the packed shader interface.
  // Uploading the small polynomial/Möbius blocks unconditionally avoids an
  // O(formula-size) dependency scan on every animation frame and remains safe
  // when formulas mutate in place without forcing a program rebuild.
  renderer.formulaUsesPolynomial = true;
  renderer.formulaUsesMobius = true;
  renderer.forceUniformRefresh = true;
  renderer.modelViewDirty = true;
  renderer.projectionDirty = true;
  renderer.boundGridMesh = null;
  renderer.boundGridProgram = null;
  renderer.activeProgram = null;
  renderer.previousPolyDegree = -1;
  renderer.previousTaylorOrder = -1;
  return true;
}

function addDisposableListener(target, type, listener, options) {
  target.addEventListener(type, listener, options);
  return () => target.removeEventListener(type, listener, options);
}

function installInteraction(renderer) {
  const { canvas } = renderer;
  const disposers = [];
  const redraw = () => drawRenderer(renderer);

  const endDrag = event => {
    renderer.dragging = false;

    if (event && canvas.hasPointerCapture && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  disposers.push(
    addDisposableListener(canvas, 'pointerdown', event => {
      renderer.dragging = true;
      renderer.lastPointerX = event.clientX;
      renderer.lastPointerY = event.clientY;

      if (canvas.setPointerCapture) {
        canvas.setPointerCapture(event.pointerId);
      }
    }),
    addDisposableListener(canvas, 'pointermove', event => {
      if (!renderer.dragging) return;

      const dx = event.clientX - renderer.lastPointerX;
      const dy = event.clientY - renderer.lastPointerY;

      renderer.camera.rotY += dx * 0.008;
      renderer.camera.rotX += dy * 0.008;
      renderer.modelViewDirty = true;
      renderer.lastPointerX = event.clientX;
      renderer.lastPointerY = event.clientY;
      redraw();
    }),
    addDisposableListener(canvas, 'pointerup', endDrag),
    addDisposableListener(canvas, 'pointercancel', endDrag),
    addDisposableListener(canvas, 'wheel', event => {
      event.preventDefault();
      renderer.camera.distance = clamp(
        renderer.camera.distance * Math.exp(event.deltaY * 0.001),
        LIMITS.minDistance,
        LIMITS.maxDistance
      );
      renderer.modelViewDirty = true;
      redraw();
    }, { passive: false }),
    addDisposableListener(canvas, 'dblclick', () => {
      resetRendererCamera(renderer);
      redraw();
    })
  );

  renderer.disposeInteraction = () => {
    while (disposers.length) disposers.pop()();
  };
}

function resetRendererGpuState(renderer) {
  renderer.meshCache.clear();
  Object.assign(renderer, {
    program: null,
    locations: null,
    mesh: null,
    drawStateConfigured: false,
    activeProgram: null,
    boundGridMesh: null,
    boundGridProgram: null,
    matrixProgram: null,
    projectionProgram: null,
    programSignature: null,
    forceUniformRefresh: true,
    modelViewDirty: true,
    projectionDirty: true
  });
}

function installContextRecovery(renderer) {
  const disposers = [];
  disposers.push(
    addDisposableListener(renderer.canvas, 'webglcontextlost', event => {
      event.preventDefault();
      renderer.contextLost = true;
      hideRenderer(renderer);
    }),
    addDisposableListener(renderer.canvas, 'webglcontextrestored', () => {
      renderer.contextLost = false;
      renderer.gl.getExtension('OES_standard_derivatives');
      renderer.uint32ElementIndices = Boolean(renderer.gl.getExtension('OES_element_index_uint'));
      const backendInfo = getWebGLBackendInfoShared(renderer.gl);
      renderer.backendLabel = backendInfo.unmaskedRenderer || backendInfo.renderer || 'WebGL';
      resetRendererGpuState(renderer);
      if (state.riemannSurfaceEnabled && renderer.lastOptions) {
        showRenderer(renderer);
        if (!drawRenderer(renderer)) hideRenderer(renderer);
      }
    })
  );

  const disposeInteraction = renderer.disposeInteraction;
  renderer.disposeInteraction = () => {
    disposeInteraction?.();
    while (disposers.length) disposers.pop()();
  };
}

function createOverlayCanvas() {
  const canvas = document.createElement('canvas');
  canvas.className = 'riemann-surface-canvas hidden';
  canvas.setAttribute('aria-label', 'Interactive GPU Riemann surface');
  return canvas;
}

function createHud() {
  const hud = document.createElement('div');
  hud.className = 'riemann-surface-hud hidden';
  return hud;
}

function getWebGLContext(canvas) {
  const gl = canvas.getContext('webgl', {
    antialias: true,
    alpha: false,
    depth: true,
    premultipliedAlpha: false,
    powerPreference: 'high-performance'
  });
  if (gl) {
    gl.getExtension('OES_standard_derivatives');
    gl.getExtension('OES_element_index_uint');
  }
  return gl;
}

function resizeRenderer(renderer) {
  const parent = renderer.canvas.parentElement;
  if (!parent) return false;

  const cssWidth = Math.max(1, parent.clientWidth || renderer.baseCanvas.width || 1);
  const cssHeight = Math.max(1, parent.clientHeight || renderer.baseCanvas.height || 1);
  const dpr = clamp(window.devicePixelRatio || 1, 1, LIMITS.maxPixelRatio);
  const width = Math.max(1, Math.round(cssWidth * dpr));
  const height = Math.max(1, Math.round(cssHeight * dpr));

  if (renderer.canvas.width !== width || renderer.canvas.height !== height) {
    renderer.canvas.width = width;
    renderer.canvas.height = height;
    renderer.gl.viewport(0, 0, width, height);
    renderer.viewportWidth = width;
    renderer.viewportHeight = height;
    renderer.projectionDirty = true;
    return true;
  }

  if (renderer.viewportWidth !== width || renderer.viewportHeight !== height) {
    renderer.gl.viewport(0, 0, width, height);
    renderer.viewportWidth = width;
    renderer.viewportHeight = height;
  }
  return true;
}

function getTaylorCoefficients(order) {
  if (!state.taylorSeriesEnabled || isDynamicAggregateGLSLActive(state)) return null;

  const coefficients = computeTaylorSeriesCoefficients(
    state.currentFunction,
    state.taylorSeriesCenter,
    order
  );

  return Array.isArray(coefficients) && coefficients.length > 0 ? coefficients : null;
}

function setTaylorUniforms(renderer) {
  const { gl, locations } = renderer;
  const order = clamp(finiteInteger(state.taylorSeriesOrder, 0), 0, 8);
  const coefficients = getTaylorCoefficients(order);
  const useTaylor = Boolean(coefficients);
  const center = state.taylorSeriesCenter;

  renderer.currentTaylorUse = useTaylor ? 1 : 0;
  renderer.currentTaylorOrder = useTaylor ? order : 0;

  if (!useTaylor) {
    renderer.previousTaylorOrder = -1;
    return false;
  }

  const centerRe = center && typeof center === 'object' ? finiteNumber(center.re) : 0;
  const centerIm = center && typeof center === 'object' ? finiteNumber(center.im) : 0;
  gl.uniform2f(locations.uTaylorCenter, centerRe, centerIm);

  const packed = renderer.taylorCoeffUniformData;
  for (let i = 0, offset = 0; i <= 8; i++, offset += 2) {
    const coefficient = i <= order ? coefficients[i] : ZERO_COMPLEX;
    packed[offset] = coefficient && typeof coefficient === 'object' ? finiteNumber(coefficient.re) : 0;
    packed[offset + 1] = coefficient && typeof coefficient === 'object' ? finiteNumber(coefficient.im) : 0;
  }
  uploadComplexUniformArray(gl, locations.uTaylorCoefficients, packed);

  renderer.previousTaylorOrder = order;
  return true;
}


function uploadComplexFunctionUniforms(gl, locations, appState, renderer) {
  const functionId = getWebGLDomainColorFunctionIdShared(appState.currentFunction);
  gl.uniform4f(
    locations.uFunctionParams,
    functionId,
    appState.zetaContinuationEnabled ? 1 : 0,
    typeof ZETA_REFLECTION_POINT_RE !== 'undefined' ? ZETA_REFLECTION_POINT_RE : 0.5,
    +appState.fractionalPowerN || 0.5
  );

  if (renderer.formulaUsesMobius || functionId === MOBIUS_FUNCTION_ID || appState.currentFunction === 'mobius') {
    const mobiusA = appState.mobiusA || ZERO_COMPLEX;
    const mobiusB = appState.mobiusB || ZERO_COMPLEX;
    const mobiusC = appState.mobiusC || ZERO_COMPLEX;
    const mobiusD = appState.mobiusD || ZERO_COMPLEX;
    gl.uniform4f(
      locations.uMobiusAB,
      complexRe(mobiusA), complexIm(mobiusA),
      complexRe(mobiusB), complexIm(mobiusB)
    );
    gl.uniform4f(
      locations.uMobiusCD,
      complexRe(mobiusC), complexIm(mobiusC),
      complexRe(mobiusD), complexIm(mobiusD)
    );
  }

  if (!(renderer.formulaUsesPolynomial || functionId === POLYNOMIAL_FUNCTION_ID || appState.currentFunction === 'polynomial')) {
    renderer.previousPolyDegree = -1;
    return 0;
  }

  const poly = appState.polynomialCoeffs || EMPTY_ARRAY;
  const degree = Math.min(10, Math.max(0, (poly.length | 0) - 1));
  const packed = renderer.polyCoeffUniformData;
  for (let i = 0, offset = 0; i <= 10; i++, offset += 2) {
    const coeff = i <= degree ? (poly[i] || ZERO_COMPLEX) : ZERO_COMPLEX;
    packed[offset] = complexRe(coeff);
    packed[offset + 1] = complexIm(coeff);
  }
  uploadComplexUniformArray(gl, locations.uPolyCoeffs, packed);
  renderer.previousPolyDegree = degree;
  return degree;
}

function uploadMatrices(renderer) {
  const { gl, locations } = renderer;

  if (renderer.forceUniformRefresh
    || renderer.modelViewDirty
    || renderer.matrixProgram !== renderer.program
    || renderer.lastRotX !== renderer.camera.rotX
    || renderer.lastRotY !== renderer.camera.rotY
    || renderer.lastDistance !== renderer.camera.distance) {
    gl.uniformMatrix4fv(locations.uModelView, false, writeModelViewMatrix(renderer.modelViewMatrix, renderer.camera));
    renderer.lastRotX = renderer.camera.rotX;
    renderer.lastRotY = renderer.camera.rotY;
    renderer.lastDistance = renderer.camera.distance;
    renderer.modelViewDirty = false;
    renderer.matrixProgram = renderer.program;
  }

  if (renderer.forceUniformRefresh || renderer.projectionDirty || renderer.projectionProgram !== renderer.program) {
    gl.uniformMatrix4fv(locations.uProjection, false, writeProjectionMatrix(renderer.projectionMatrix, renderer.canvas));
    renderer.projectionDirty = false;
    renderer.projectionProgram = renderer.program;
  }
}

function setCommonUniforms(renderer, options) {
  const { gl, locations, mesh } = renderer;
  const xRange = zPlaneParams.currentVisXRange;
  const yRange = zPlaneParams.currentVisYRange;
  let xMin = xRange ? +xRange[0] : -2;
  let xMax = xRange ? +xRange[1] : 2;
  let yMin = yRange ? +yRange[0] : -2;
  let yMax = yRange ? +yRange[1] : 2;
  if (!Number.isFinite(xMin)) xMin = -2;
  if (!Number.isFinite(xMax)) xMax = 2;
  if (!Number.isFinite(yMin)) yMin = -2;
  if (!Number.isFinite(yMax)) yMax = 2;

  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;
  const invResolution = mesh.invResolution;

  renderer.branchCutScale = Math.min(Math.abs(xSpan), Math.abs(ySpan)) * invResolution * LIMITS.branchCutPixels;

  gl.uniform4f(locations.uViewBounds, xMin, xMax, yMin, yMax);
  uploadMatrices(renderer);

  const polyDegree = uploadComplexFunctionUniforms(gl, locations, state, renderer);
  uploadAlgebraicUniforms(gl, locations, state);
  setTaylorUniforms(renderer);

  let heightScale = +state.riemannSurfaceHeightScale;
  let heightClip = +state.riemannSurfaceHeightClip;
  let brightness = +state.domainBrightness;
  let contrast = +state.domainContrast;
  let saturation = +state.domainSaturation;
  let lightnessCycles = +state.domainLightnessCycles;
  const chainingEnabled = !!state.chainingEnabled;
  const chainCount = chainingEnabled ? (state.chainCount | 0 || 1) : 1;
  const chainMode = chainingEnabled ? (CHAIN_MODE_IDS[state.chainingMode] || 1) : 0;
  const orbitMode = chainingEnabled
    ? orbitColoringModeId(state.orbitColoringMode)
    : 0;
  if (!Number.isFinite(heightScale)) heightScale = 1;
  if (!Number.isFinite(heightClip)) heightClip = 1;
  if (!Number.isFinite(brightness)) brightness = 1;
  if (!Number.isFinite(contrast)) contrast = 1;
  if (!Number.isFinite(saturation)) saturation = 1;
  if (!Number.isFinite(lightnessCycles)) lightnessCycles = 0;

  gl.uniform4f(
    locations.uIntParams,
    polyDegree,
    options.stage,
    chainMode,
    SURFACE_COMPONENT_IDS[state.riemannSurfaceComponent] || 2
  );
  gl.uniform4f(
    locations.uRenderParams,
    options.derivativeMode,
    heightScale,
    Math.max(LIMITS.minHeightClip, heightClip),
    renderer.currentTaylorUse
  );
  gl.uniform2f(locations.uDomainStep, xSpan * invResolution, ySpan * invResolution);
  gl.uniform2f(locations.uNormalizedStep, 2.36 * invResolution, 2 * invResolution);
  gl.uniform4f(locations.uDomainParams, brightness, contrast, saturation, lightnessCycles);
  gl.uniform4f(
    locations.uDomainIntParams,
    getDomainPaletteShaderId(state.domainPalette),
    chainCount,
    renderer.currentTaylorOrder,
    orbitMode
  );
  gl.uniform4f(
    locations.uContourParams,
    state.contoursEnabled ? 1.0 : 0.0,
    state.contourInterval !== undefined ? +state.contourInterval : 0.5,
    state.contourThickness !== undefined ? +state.contourThickness : 1.5,
    0.0
  );
}

function updateHud(renderer, branchIndices, hasBranches, stage) {
  const backendLabel = renderer.backendLabel;
  const component = state.riemannSurfaceComponent;
  let componentLabel = HUD_COMPONENT_LABEL_CACHE.get(component);
  if (!componentLabel) {
    componentLabel = getSurfaceComponentLabel(component);
    HUD_COMPONENT_LABEL_CACHE.set(component, componentLabel);
  }

  const branchKey = hasBranches ? branchIndices : SINGLE_BRANCH_LABEL_KEY;
  let branchLabel = HUD_BRANCH_LABEL_CACHE.get(branchKey);
  if (!branchLabel) {
    branchLabel = hasBranches ? getBranchWindowLabel(branchIndices) : 'single-valued sheet';
    rememberBounded(HUD_BRANCH_LABEL_CACHE, branchKey, branchLabel, BRANCH_INDICES_CACHE_LIMIT);
  }

  const stageLabel = state.chainingEnabled ? (CHAIN_STAGE_LABELS[stage] || `chain ${Math.max(0, stage - 1)}`) : 'output';
  const text = `${stageLabel} | ${componentLabel} | ${branchLabel} | GPU: ${backendLabel}`;
  if (renderer.hud.textContent !== text) renderer.hud.textContent = text;
}

function ensureCurrentProgram(renderer, signature = getProgramSignature(state)) {
  return renderer.programSignature === signature || rebuildProgram(renderer, signature);
}

/**
 * Keeps a renderer-local GPU mesh pool. Switching resolution now becomes an O(1) lookup
 * after first use instead of deleting and reallocating three large WebGL buffers.
 */
function ensureMesh(renderer) {
  const resolution = normalizeRendererResolution(state.riemannSurfaceResolution, renderer.uint32ElementIndices);

  if (renderer.mesh && renderer.mesh.resolution === resolution) {
    return true;
  }

  let mesh = renderer.meshCache.get(resolution);
  if (!mesh) {
    mesh = createGridMesh(renderer.gl, resolution);
    if (!mesh) return false;
    renderer.meshCache.set(resolution, mesh);
  }

  renderer.mesh = mesh;
  return true;
}

function configureDrawState(renderer) {
  const { gl } = renderer;
  if (!renderer.drawStateConfigured) {
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.027, 0.031, 0.063, 1);
    renderer.drawStateConfigured = true;
  }
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
}

function useRendererProgram(renderer) {
  if (renderer.activeProgram !== renderer.program) {
    renderer.gl.useProgram(renderer.program);
    renderer.activeProgram = renderer.program;
  }
}

function bindGridAttribute(renderer) {
  const { gl, locations, mesh, program } = renderer;
  if (renderer.boundGridMesh === mesh && renderer.boundGridProgram === program) return;

  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertexBuffer);
  gl.enableVertexAttribArray(locations.aGrid);
  gl.vertexAttribPointer(locations.aGrid, 2, gl.FLOAT, false, 0, 0);
  renderer.boundGridMesh = mesh;
  renderer.boundGridProgram = program;
}

function getBranchCutWidth(renderer, hasBranches) {
  return hasBranches ? Math.max(LIMITS.minBranchCutWidth, renderer.branchCutScale) : 0;
}

function getCachedBranchIndices(sheets, center, hasBranches) {
  const sheetCount = finiteInteger(sheets, 1);
  const branchCenter = finiteInteger(center, 0);
  const key = (hasBranches ? 0x10000 : 0) | ((sheetCount & 0xff) << 8) | ((branchCenter + 128) & 0xff);
  const cached = BRANCH_INDICES_CACHE.get(key);
  if (cached) return cached;

  return rememberBounded(
    BRANCH_INDICES_CACHE,
    key,
    getVisibleBranchIndices(sheetCount, branchCenter, hasBranches),
    BRANCH_INDICES_CACHE_LIMIT
  );
}

function drawSurfaceSheet(renderer, branchIndex, sheetIndex, tintStep, cutWidth, wireframe) {
  const { gl, locations, mesh } = renderer;

  gl.uniform4f(locations.uBranchParams, branchIndex, cutWidth, sheetIndex * tintStep, 0);
  gl.drawElements(gl.TRIANGLES, mesh.triangleCount, mesh.triangleIndexType, 0);

  if (!wireframe) return;

  gl.uniform4f(locations.uBranchParams, branchIndex, cutWidth, sheetIndex * tintStep, 1);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.lineBuffer);
  gl.drawElements(gl.LINES, mesh.lineCount, mesh.lineIndexType, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.triangleBuffer);
}

function prepareRendererFrame(renderer, options, signature = getProgramSignature(state)) {
  if (!renderer || !options || !renderer.visible) return false;
  if (renderer.contextLost || renderer.gl.isContextLost?.()) {
    renderer.contextLost = true;
    return false;
  }
  renderer.lastOptions = options;

  return resizeRenderer(renderer) && ensureCurrentProgram(renderer, signature) && ensureMesh(renderer);
}

function drawRenderer(renderer, options = renderer.lastOptions, signature = getProgramSignature(state)) {
  if (!prepareRendererFrame(renderer, options, signature)) return false;

  const { gl, mesh } = renderer;

  useRendererProgram(renderer);
  configureDrawState(renderer);
  bindGridAttribute(renderer);
  setCommonUniforms(renderer, options);

  const hasBranches = surfaceStageHasBranches(state, options.stage);
  const branchIndices = getCachedBranchIndices(
    state.riemannSurfaceSheets,
    state.riemannSurfaceBranchCenter,
    hasBranches
  );
  const branchCount = branchIndices.length;
  const cutWidth = getBranchCutWidth(renderer, hasBranches);
  const tintStep = branchCount > 1 ? 0.12 / branchCount : 0;
  const wireframe = Boolean(state.riemannSurfaceWireframe);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.triangleBuffer);
  for (let sheetIndex = 0; sheetIndex < branchCount; sheetIndex++) {
    drawSurfaceSheet(renderer, branchIndices[sheetIndex], sheetIndex, tintStep, cutWidth, wireframe);
  }

  renderer.forceUniformRefresh = false;
  updateHud(renderer, branchIndices, hasBranches, options.stage);
  return true;
}

function showRenderer(renderer) {
  if (renderer.visible) return;
  renderer.visible = true;
  renderer.canvas.classList.remove('hidden');
  renderer.hud.classList.remove('hidden');
}

function hideRenderer(renderer) {
  if (!renderer.visible) return;
  renderer.visible = false;
  renderer.canvas.classList.add('hidden');
  renderer.hud.classList.add('hidden');
}

function resetRendererCamera(renderer) {
  renderer.camera.rotX = DEFAULT_CAMERA.rotX;
  renderer.camera.rotY = DEFAULT_CAMERA.rotY;
  renderer.camera.distance = DEFAULT_CAMERA.distance;
  renderer.modelViewDirty = true;
}

/**
 * Owns renderer identity and lifetime. The exported API stays function-based,
 * but all mutable renderer registries live behind this private factory boundary.
 */
class RiemannSurfaceRendererFactory {
  #rendererByBaseCanvas = new WeakMap();
  #activeRenderers = new Set();

  render(baseCanvas, options = {}, signature = getProgramSignature(state)) {
    if (!baseCanvas) return false;

    const renderer = this.#ensure(baseCanvas);
    if (!renderer) return false;

    showRenderer(renderer);
    const frameOptions = renderer.frameOptions;
    frameOptions.stage = normalizeStage(options.stage);
    frameOptions.map = options.map || null;
    frameOptions.derivativeMode = frameOptions.map && frameOptions.map.presentation === 'derivative' ? 1 : 0;
    renderer.lastOptions = frameOptions;

    const rendered = drawRenderer(renderer, frameOptions, signature);

    if (!rendered) {
      hideRenderer(renderer);
    }

    return rendered;
  }

  hide(baseCanvas) {
    const renderer = baseCanvas ? this.#rendererByBaseCanvas.get(baseCanvas) : null;
    if (!renderer) return;

    hideRenderer(renderer);
  }

  dispose(baseCanvas) {
    const renderer = baseCanvas ? this.#rendererByBaseCanvas.get(baseCanvas) : null;
    if (!renderer) return;

    const { gl } = renderer;

    if (renderer.disposeInteraction) {
      renderer.disposeInteraction();
    }

    disposeMeshCache(gl, renderer.meshCache);

    if (renderer.program) {
      gl.deleteProgram(renderer.program);
    }

    renderer.canvas.remove();
    renderer.hud.remove();
    this.#activeRenderers.delete(renderer);
    this.#rendererByBaseCanvas.delete(baseCanvas);
  }

  canvasFor(baseCanvas) {
    const renderer = baseCanvas ? this.#rendererByBaseCanvas.get(baseCanvas) : null;
    return renderer ? renderer.canvas : null;
  }

  resetViews() {
    this.#activeRenderers.forEach(renderer => {
      resetRendererCamera(renderer);
      drawRenderer(renderer);
    });
  }

  #ensure(baseCanvas) {
    return this.#rendererByBaseCanvas.get(baseCanvas) || this.#create(baseCanvas);
  }

  #create(baseCanvas) {
    const parent = baseCanvas && baseCanvas.parentElement;
    if (!parent) return null;

    const canvas = createOverlayCanvas();
    const gl = getWebGLContext(canvas);
    if (!gl) return null;

    const hud = createHud();
    parent.appendChild(canvas);
    parent.appendChild(hud);

    const renderer = {
      baseCanvas,
      canvas,
      hud,
      gl,
      program: null,
      programSignature: null,
      locations: null,
      mesh: null,
      meshCache: new Map(),
      modelViewMatrix: new Float32Array(16),
      projectionMatrix: new Float32Array(16),
      polyCoeffUniformData: new Float32Array(22),
      taylorCoeffUniformData: new Float32Array(18),
      frameOptions: { stage: 1, map: null, derivativeMode: 0 },
      camera: { ...DEFAULT_CAMERA },
      visible: false,
      drawStateConfigured: false,
      activeProgram: null,
      boundGridMesh: null,
      boundGridProgram: null,
      modelViewDirty: true,
      projectionDirty: true,
      matrixProgram: null,
      projectionProgram: null,
      lastRotX: NaN,
      lastRotY: NaN,
      lastDistance: NaN,
      viewportWidth: 0,
      viewportHeight: 0,
      branchCutScale: 0,
      previousPolyDegree: -1,
      previousTaylorOrder: -1,
      currentTaylorUse: 0,
      currentTaylorOrder: 0,
      formulaUsesPolynomial: true,
      formulaUsesMobius: true,
      forceUniformRefresh: true,
      backendLabel: '',
      dragging: false,
      lastPointerX: 0,
      lastPointerY: 0,
      lastOptions: null,
      uint32ElementIndices: Boolean(gl.getExtension('OES_element_index_uint')),
      contextLost: false,
      disposeInteraction: null
    };

    const backendInfo = getWebGLBackendInfoShared(gl);
    renderer.backendLabel = backendInfo.unmaskedRenderer || backendInfo.renderer || 'WebGL';

    installInteraction(renderer);
    installContextRecovery(renderer);

    if (!rebuildProgram(renderer)) {
      renderer.disposeInteraction();
      canvas.remove();
      hud.remove();
      return null;
    }

    this.#rendererByBaseCanvas.set(baseCanvas, renderer);
    this.#activeRenderers.add(renderer);
    return renderer;
  }
}

const rendererFactory = new RiemannSurfaceRendererFactory();

export function renderRiemannSurface(baseCanvas, options = {}) {
  const signature = getProgramSignature(state);
  if (!validateDynamicAggregate(state, signature)) return false;
  return rendererFactory.render(baseCanvas, options, signature);
}

export function hideRiemannSurface(baseCanvas) {
  rendererFactory.hide(baseCanvas);
}

export function disposeRiemannSurface(baseCanvas) {
  rendererFactory.dispose(baseCanvas);
}

export function getRiemannSurfaceCanvas(baseCanvas) {
  return rendererFactory.canvasFor(baseCanvas);
}

export function resetRiemannSurfaceViews() {
  rendererFactory.resetViews();
}
