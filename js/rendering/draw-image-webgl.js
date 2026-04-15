import { state } from '../store/state.js';
import {
    createWebGLProgramShared,
    getWebGLDomainColorFunctionIdShared,
    GLSL_COMPLEX_INVERSE_LIBRARY,
    getGLSLComplexMathLibrary,
    collectAlgebraicUniformLocationsShared,
    getAlgebraicStructureSignatureShared
} from './webgl-shared.js';
import {
    getRasterSourceForShape,
    getRasterVersionTokenForShape,
    getRasterDisplayDimensions,
    getRasterOpacityForShape,
    isRasterInputShape
} from '../utils/raster-media.js';
import { getChainedStageTransformFunction } from '../math-utils.js';
import { ZETA_REFLECTION_POINT_RE } from '../constants/numerical.js';
import { DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE } from '../constants/domain-dynamics.js';

const MAX_POLY_DEGREE = 10;
const QUAD_VERTEX_COUNT = 4;
const DEFAULT_ALPHA_CUTOFF = 0.05;
const UINT16_VERTEX_LIMIT = 65535;
const EMPTY_ARRAY = Object.freeze([]);
const MAX_INVERSE_CHAIN_INDEX = 15;

const inverseMetadata = injectivity => Object.freeze({ injectivity });

const IMAGE_TRANSFORM_INVERSE_METADATA = Object.freeze({
    cos: inverseMetadata('no'),
    sin: inverseMetadata('no'),
    tan: inverseMetadata('no'),
    sec: inverseMetadata('no'),
    exp: inverseMetadata('no'),
    ln: inverseMetadata('yes'),
    reciprocal: inverseMetadata('yes'),
    mobius: inverseMetadata('conditional'),
    polynomial: inverseMetadata('conditional'),
    poincare: inverseMetadata('yes'),
    zeta: inverseMetadata('no'),
    sinh: inverseMetadata('no'),
    cosh: inverseMetadata('no'),
    tanh: inverseMetadata('no'),
    power: inverseMetadata('conditional'),
    algebraic_chaining: inverseMetadata('no'),
    dynamic_aggregate: inverseMetadata('no')
});

const CHAIN_MODE = Object.freeze({
    recursion: 1,
    zero_seed: 2
});

const webglImageSupport = {
    available: false,
    reason: 'not-initialized',
    renderer: null,
    lastAlgHash: ''
};

const glsl = (...lines) => lines.join('\n');

function hasUniform(location) {
    return location !== null && location !== undefined;
}

function setUniform1fIfPresent(gl, location, value) {
    if (hasUniform(location)) gl.uniform1f(location, value);
}

function finiteOr(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function complexPart(value, key) {
    return finiteOr(value && value[key], 0);
}

const SNAPSHOT_POLY_COEFFS = Array.from({ length: MAX_POLY_DEGREE + 1 }, () => ({ re: 0, im: 0 }));
const RENDER_SNAPSHOT = {
    currentInputShape: null,
    currentFunction: null,
    a0: 0,
    b0: 0,
    mobiusA: { re: 1, im: 0 },
    mobiusB: { re: 0, im: 0 },
    mobiusC: { re: 0, im: 0 },
    mobiusD: { re: 1, im: 0 },
    polynomialN: 0,
    polynomialCoeffs: SNAPSHOT_POLY_COEFFS,
    fractionalPowerN: 0.5,
    algebraicChainingTerms: EMPTY_ARRAY,
    algebraicChainingZExpr: 'z',
    chainingEnabled: false,
    chainCount: 0,
    chainingMode: null,
    navigationModeEnabled: false,
    zetaContinuationEnabled: false,
    gridDensity: 10,
    domainBrightness: 1
};

function writeComplex(out, value, fallbackRe, fallbackIm) {
    out.re = finiteOr(value && value.re, fallbackRe);
    out.im = finiteOr(value && value.im, fallbackIm);
    return out;
}

function writePolynomialCoeffs(target, coeffs) {
    const source = Array.isArray(coeffs) ? coeffs : EMPTY_ARRAY;

    for (let i = 0; i <= MAX_POLY_DEGREE; i++) {
        const coeff = source[i];
        target[i].re = finiteOr(coeff && coeff.re, 0);
        target[i].im = finiteOr(coeff && coeff.im, 0);
    }

    return target;
}

function cloneAlgebraicTerms(terms) {
    if (!Array.isArray(terms) || terms.length === 0) return EMPTY_ARRAY;

    return terms.map(term => {
        const coeff = term && term.coeff;
        const factors = Array.isArray(term && term.factors) ? term.factors : EMPTY_ARRAY;

        return {
            coeff: {
                re: finiteOr(coeff && coeff.re, 0),
                im: finiteOr(coeff && coeff.im, 0)
            },
            factors: factors.map(factor => ({
                func: factor && factor.func ? String(factor.func) : 'none',
                chainedFunc: factor && factor.chainedFunc ? String(factor.chainedFunc) : 'none',
                power: finiteOr(factor && factor.power, 1),
                reciprocal: Boolean(factor && factor.reciprocal),
                log: Boolean(factor && factor.log),
                exp: Boolean(factor && factor.exp)
            }))
        };
    });
}

/*
 * Render state is sampled into a stable, reusable frame capsule. The original
 * implementation deep-cloned UI state on every draw; this path keeps the same
 * public shape while avoiding broad structuredClone/JSON churn. Algebraic
 * shader terms are copied narrowly because shader source generation depends on
 * their nested values.
 */
function readRenderState() {
    const snapshot = RENDER_SNAPSHOT;

    snapshot.currentInputShape = state.currentInputShape;
    snapshot.currentFunction = state.currentFunction;

    snapshot.a0 = finiteOr(state.a0, 0);
    snapshot.b0 = finiteOr(state.b0, 0);

    writeComplex(snapshot.mobiusA, state.mobiusA, 1, 0);
    writeComplex(snapshot.mobiusB, state.mobiusB, 0, 0);
    writeComplex(snapshot.mobiusC, state.mobiusC, 0, 0);
    writeComplex(snapshot.mobiusD, state.mobiusD, 1, 0);

    snapshot.polynomialN = finiteOr(state.polynomialN, 0);
    writePolynomialCoeffs(snapshot.polynomialCoeffs, state.polynomialCoeffs);
    snapshot.fractionalPowerN = state.fractionalPowerN !== undefined ? finiteOr(state.fractionalPowerN, 0.5) : 0.5;

    snapshot.algebraicChainingTerms = cloneAlgebraicTerms(state.algebraicChainingTerms);
    snapshot.algebraicChainingZExpr = state.algebraicChainingZExpr || 'z';
    snapshot.chainingEnabled = Boolean(state.chainingEnabled);
    snapshot.chainCount = finiteOr(state.chainCount, 0);
    snapshot.chainingMode = state.chainingMode;
    snapshot.navigationModeEnabled = Boolean(state.navigationModeEnabled);

    snapshot.zetaContinuationEnabled = Boolean(state.zetaContinuationEnabled);

    snapshot.gridDensity = finiteOr(state.gridDensity, 10);
    snapshot.domainBrightness = finiteOr(state.domainBrightness, 1);

    return snapshot;
}

function getAlgebraicHash(snapshot) {
    return `${snapshot.algebraicChainingZExpr || 'z'}:${getAlgebraicStructureSignatureShared(snapshot.algebraicChainingTerms)}`;
}

function markSupportUnavailable(reason) {
    webglImageSupport.available = false;
    webglImageSupport.reason = reason;
}

function deleteImagePrograms(gl, programs) {
    if (!gl || !programs) return;
    if (programs.inverseProgram) gl.deleteProgram(programs.inverseProgram);
    if (programs.forwardProgram) gl.deleteProgram(programs.forwardProgram);
}

function replaceImagePrograms(renderer, snapshot) {
    if (!isContextUsable(renderer)) return false;

    const programs = createImagePrograms(renderer.gl, snapshot);
    if ((!programs.inverseProgram && renderer.inverseProgram) ||
        (!programs.forwardProgram && renderer.forwardProgram)) {
        deleteImagePrograms(renderer.gl, programs);
        return false;
    }

    const inverseLocs = getInverseLocs(renderer.gl, programs.inverseProgram, snapshot);
    const forwardLocs = getForwardLocs(renderer.gl, programs.forwardProgram, snapshot);
    const previousTopologyKey = renderer.forwardTopologyKey;
    const previousMesh = renderer.forwardMesh;
    deleteRendererVao(renderer, 'inverseVao');
    deleteRendererVao(renderer, 'forwardGpuVao');
    deleteRendererVao(renderer, 'forwardCpuVao');

    const previousPrograms = {
        inverseProgram: renderer.inverseProgram,
        forwardProgram: renderer.forwardProgram
    };
    renderer.inverseProgram = programs.inverseProgram;
    renderer.inverseLocs = inverseLocs;
    renderer.forwardProgram = programs.forwardProgram;
    renderer.forwardLocs = forwardLocs;
    renderer.forwardMeshKey = '';
    renderer.forwardTopologyKey = previousTopologyKey;
    renderer.forwardMesh = previousMesh;
    renderer.forwardMappedMesh = null;
    renderer.forwardIndexCount = 0;
    deleteImagePrograms(renderer.gl, previousPrograms);
    return true;
}

function invalidateImageRendererForDynamicAlgebra(snapshot) {
    if (snapshot.currentFunction !== 'algebraic_chaining') return;

    const hash = getAlgebraicHash(snapshot);
    if (webglImageSupport.lastAlgHash === hash) return;

    if (webglImageSupport.renderer && replaceImagePrograms(webglImageSupport.renderer, snapshot)) {
        webglImageSupport.lastAlgHash = hash;
        webglImageSupport.available = true;
        webglImageSupport.reason = 'ready';
        return;
    }

    if (!webglImageSupport.renderer) webglImageSupport.lastAlgHash = hash;

    markSupportUnavailable('algebraic_shader_recompile_failed');
}

function createRenderCanvas() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', {
        antialias: false,
        alpha: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance'
    });

    return gl ? { canvas, gl } : null;
}

function createVertexArrayRegistry(gl) {
    const ext = gl.getExtension('OES_vertex_array_object');

    return {
        supported: Boolean(ext),
        create() {
            return ext ? ext.createVertexArrayOES() : null;
        },
        bind(vao) {
            if (ext) ext.bindVertexArrayOES(vao || null);
        },
        delete(vao) {
            if (ext && vao) ext.deleteVertexArrayOES(vao);
        }
    };
}

function deleteRendererVao(renderer, key) {
    if (!renderer || !renderer.vao || !renderer[key]) return;

    renderer.vao.delete(renderer[key]);
    renderer[key] = null;
}

function bindOrCreateVao(renderer, key, configure) {
    if (!renderer.vao.supported) return false;

    if (!renderer[key]) {
        const vao = renderer.vao.create();
        if (!vao) return false;

        renderer.vao.bind(vao);
        const configured = configure();
        renderer.vao.bind(null);

        if (!configured) {
            renderer.vao.delete(vao);
            return false;
        }

        renderer[key] = vao;
    }

    renderer.vao.bind(renderer[key]);
    return true;
}

function unbindVao(renderer) {
    if (renderer && renderer.vao && renderer.vao.supported) renderer.vao.bind(null);
}

function createTexture(gl) {
    const texture = gl.createTexture();
    if (!texture) return null;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([255, 255, 255, 255])
    );
    setTextureSampling(gl);
    return texture;
}

function getTextureAnisotropyExtension(gl) {
    if (Object.prototype.hasOwnProperty.call(gl, '__drawImageAnisotropyExt')) return gl.__drawImageAnisotropyExt;

    gl.__drawImageAnisotropyExt = gl.getExtension('EXT_texture_filter_anisotropic')
        || gl.getExtension('MOZ_EXT_texture_filter_anisotropic')
        || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic')
        || null;
    return gl.__drawImageAnisotropyExt;
}

function setTextureSampling(gl) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const anisotropy = getTextureAnisotropyExtension(gl);
    if (anisotropy && typeof gl.texParameterf === 'function' && typeof gl.getParameter === 'function') {
        const maxAnisotropy = gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
        gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxAnisotropy));
    }
}

function createStaticBuffer(gl, target, data) {
    const buffer = gl.createBuffer();
    if (!buffer) return null;

    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return buffer;
}

function createDynamicBuffer(gl) {
    return gl.createBuffer();
}

function createQuadBuffer(gl) {
    return createStaticBuffer(gl, gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
}

function attachContextLifecycle(renderer) {
    const canvas = renderer.canvas;

    renderer.onContextLost = event => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();

        markSupportUnavailable('context_lost');
        renderer.contextLost = true;
    };

    renderer.onContextRestored = () => {
        renderer.contextLost = false;

        if (webglImageSupport.renderer === renderer) {
            disposeWebGLRenderer(renderer);
            webglImageSupport.renderer = null;
            markSupportUnavailable('context_restored_reinitialization_required');
            initWebGLImageSupportIfNeeded();
        }
    };

    canvas.addEventListener('webglcontextlost', renderer.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', renderer.onContextRestored, false);
}

function isContextUsable(renderer) {
    if (!renderer || !renderer.gl || renderer.disposed || renderer.contextLost) return false;
    if (typeof renderer.gl.isContextLost === 'function' && renderer.gl.isContextLost()) {
        renderer.contextLost = true;
        markSupportUnavailable('context_lost');
        return false;
    }
    return true;
}

function resizeRendererCanvas(renderer, width, height) {
    if (!isContextUsable(renderer) || width <= 0 || height <= 0) return false;

    if (renderer.canvas.width !== width) renderer.canvas.width = width;
    if (renderer.canvas.height !== height) renderer.canvas.height = height;

    renderer.gl.viewport(0, 0, width, height);
    return true;
}

const TARGET_SIZE_SCRATCH = { width: 0, height: 0 };
const VIEW_BOUNDS_SCRATCH = { x0: 0, x1: 0, y0: 0, y1: 0, xSpan: 0, ySpan: 0 };

function getTargetSize(targetCtx, planeParams) {
    TARGET_SIZE_SCRATCH.width = (targetCtx && targetCtx.canvas && targetCtx.canvas.width) || (planeParams && planeParams.width) || 0;
    TARGET_SIZE_SCRATCH.height = (targetCtx && targetCtx.canvas && targetCtx.canvas.height) || (planeParams && planeParams.height) || 0;
    return TARGET_SIZE_SCRATCH;
}

function clearTransparent(gl) {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
}

function enablePremultipliedAlphaBlend(gl) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
}

function bindTextureUnit0(gl, texture) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
}

function compositeRendererCanvas(targetCtx, renderer) {
    targetCtx.save();
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.drawImage(renderer.canvas, 0, 0);
    targetCtx.restore();
}

function hasDrawableTargetContext(ctx) {
    return Boolean(ctx && ctx.canvas && typeof ctx.drawImage === 'function');
}

function isVideoAwaitingFrame(shape, source) {
    return shape === 'video' && source && source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA;
}

function getViewBounds(planeParams) {
    const xRange = planeParams.currentVisXRange || planeParams.xRange;
    const yRange = planeParams.currentVisYRange || planeParams.yRange;
    const bounds = VIEW_BOUNDS_SCRATCH;

    bounds.x0 = xRange[0];
    bounds.x1 = xRange[1];
    bounds.y0 = yRange[0];
    bounds.y1 = yRange[1];
    bounds.xSpan = bounds.x1 - bounds.x0;
    bounds.ySpan = bounds.y1 - bounds.y0;
    return bounds;
}

function hasUsableBounds(bounds) {
    return Number.isFinite(bounds.xSpan)
        && Number.isFinite(bounds.ySpan)
        && Math.abs(bounds.xSpan) > 0
        && Math.abs(bounds.ySpan) > 0;
}

function clampPolynomialDegree(value) {
    return Math.max(0, Math.min(MAX_POLY_DEGREE, Number.isFinite(value) ? value : 0));
}

function bindMobiusUniforms(gl, locs, snapshot) {
    gl.uniform2f(locs.uMobiusA, complexPart(snapshot.mobiusA, 're'), complexPart(snapshot.mobiusA, 'im'));
    gl.uniform2f(locs.uMobiusB, complexPart(snapshot.mobiusB, 're'), complexPart(snapshot.mobiusB, 'im'));
    gl.uniform2f(locs.uMobiusC, complexPart(snapshot.mobiusC, 're'), complexPart(snapshot.mobiusC, 'im'));
    gl.uniform2f(locs.uMobiusD, complexPart(snapshot.mobiusD, 're'), complexPart(snapshot.mobiusD, 'im'));
}

function bindPolynomialUniforms(gl, locs, snapshot) {
    gl.uniform1i(locs.uPolyDegree, clampPolynomialDegree(snapshot.polynomialN));

    for (let i = 0; i <= MAX_POLY_DEGREE; i++) {
        const coeff = snapshot.polynomialCoeffs[i];
        gl.uniform2f(locs.uPolyCoeffs[i], complexPart(coeff, 're'), complexPart(coeff, 'im'));
    }
}

function bindFractionalPowerUniform(gl, locs, snapshot) {
    setUniform1fIfPresent(gl, locs.uFracPower, snapshot.fractionalPowerN);
}

function bindImageGeometryUniforms(gl, locs, planeParams, currentShape, isWP, snapshot) {
    const media = getRasterDisplayDimensions(currentShape);
    const bounds = getViewBounds(planeParams);

    gl.uniform2f(locs.uImageSize, media.width, media.height);
    gl.uniform2f(locs.uCenter, snapshot.a0, snapshot.b0);
    gl.uniform4f(locs.uViewBounds, bounds.x0, bounds.x1, bounds.y0, bounds.y1);
    gl.uniform1f(locs.uIsWPlane, isWP ? 1 : 0);
    gl.uniform1f(locs.uOpacity, getRasterOpacityForShape(currentShape));
    setUniform1fIfPresent(gl, locs.uAlphaCutoff, DEFAULT_ALPHA_CUTOFF);
}

function bindComplexImageUniforms(gl, locs, snapshot) {
    gl.uniform1f(locs.uFunctionId, getWebGLDomainColorFunctionIdShared(snapshot.currentFunction));
    bindMobiusUniforms(gl, locs, snapshot);
    bindPolynomialUniforms(gl, locs, snapshot);
    bindFractionalPowerUniform(gl, locs, snapshot);
}

function getCommonImageLocs(gl, program) {
    const locs = {
        uImageSize: gl.getUniformLocation(program, 'u_imageSize'),
        uCenter: gl.getUniformLocation(program, 'u_center'),
        uViewBounds: gl.getUniformLocation(program, 'u_viewBounds'),
        uIsWPlane: gl.getUniformLocation(program, 'u_isWPlane'),
        uFunctionId: gl.getUniformLocation(program, 'u_functionId'),
        uOpacity: gl.getUniformLocation(program, 'u_opacity'),
        uAlphaCutoff: gl.getUniformLocation(program, 'u_alphaCutoff'),
        uMobiusA: gl.getUniformLocation(program, 'u_mobiusA'),
        uMobiusB: gl.getUniformLocation(program, 'u_mobiusB'),
        uMobiusC: gl.getUniformLocation(program, 'u_mobiusC'),
        uMobiusD: gl.getUniformLocation(program, 'u_mobiusD'),
        uPolyDegree: gl.getUniformLocation(program, 'u_polyDegree'),
        uPolyCoeffs: [],
        uTexture: gl.getUniformLocation(program, 'u_texture')
    };

    for (let i = 0; i <= MAX_POLY_DEGREE; i++) {
        locs.uPolyCoeffs.push(gl.getUniformLocation(program, `u_polyCoeffs[${i}]`));
    }

    return locs;
}

function getInverseLocs(gl, program, snapshot) {
    if (!program) return null;

    const locs = Object.assign(getCommonImageLocs(gl, program), {
        aPosition: gl.getAttribLocation(program, 'a_position'),
        uResolution: gl.getUniformLocation(program, 'u_resolution'),
        uChainIndex: gl.getUniformLocation(program, 'u_chainIndex'),
        uChainMode: gl.getUniformLocation(program, 'u_chainMode'),
        uFracPower: gl.getUniformLocation(program, 'u_fracPower')
    });
    collectAlgebraicUniformLocationsShared(gl, program, snapshot, locs);
    return locs;
}

function getForwardLocs(gl, program, snapshot) {
    if (!program) return null;

    const locs = Object.assign(getCommonImageLocs(gl, program), {
        aTexCoord: gl.getAttribLocation(program, 'a_texCoord'),
        aMappedPos: gl.getAttribLocation(program, 'a_mappedPos'),
        uUseCpuEval: gl.getUniformLocation(program, 'u_useCpuEval'),
        uZetaContinuationEnabled: gl.getUniformLocation(program, 'u_zetaContinuationEnabled'),
        uZetaReflectionBoundary: gl.getUniformLocation(program, 'u_zetaReflectionBoundary'),
        uFracPower: gl.getUniformLocation(program, 'u_fracPower')
    });
    collectAlgebraicUniformLocationsShared(gl, program, snapshot, locs);
    return locs;
}

function createInverseVertexShader() {
    return glsl(
        'attribute vec2 a_position;',
        'varying vec2 v_uv;',
        'void main() {',
        '  v_uv = (a_position + 1.0) * 0.5;',
        '  gl_Position = vec4(a_position, 0.0, 1.0);',
        '}'
    );
}

function createInverseFragmentShader(snapshot) {
    return glsl(
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'varying vec2 v_uv;',
        'uniform sampler2D u_texture;',
        'uniform vec2 u_resolution;',
        'uniform vec4 u_viewBounds;',
        'uniform vec2 u_imageSize;',
        'uniform vec2 u_center;',
        'uniform float u_opacity;',
        'uniform float u_alphaCutoff;',
        'uniform float u_isWPlane;',
        'uniform float u_functionId;',
        'uniform vec2 u_mobiusA;',
        'uniform vec2 u_mobiusB;',
        'uniform vec2 u_mobiusC;',
        'uniform vec2 u_mobiusD;',
        'uniform int u_polyDegree;',
        'uniform vec2 u_polyCoeffs[11];',
        'uniform int u_chainIndex;',
        'uniform int u_chainMode;',
        'uniform float u_fracPower;',
        '',
        getGLSLComplexMathLibrary(snapshot),
        GLSL_COMPLEX_INVERSE_LIBRARY,
        '',
        'bool applyInverseChain(inout vec2 z) {',
        '  if (u_chainMode == 1) {',
        '    for (int i = 0; i < 16; i++) {',
        '      if (i > u_chainIndex) break;',
        '      vec2 p = z;',
        '      if (!evaluateInverseFunction(p, u_functionId, u_mobiusA, u_mobiusB, u_mobiusC, u_mobiusD, u_polyDegree, u_polyCoeffs, u_fracPower, z)) return false;',
        '    }',
        '    return true;',
        '  }',
        '',
        '  vec2 p = z;',
        '  return evaluateInverseFunction(p, u_functionId, u_mobiusA, u_mobiusB, u_mobiusC, u_mobiusD, u_polyDegree, u_polyCoeffs, u_fracPower, z);',
        '}',
        '',
        'void main() {',
        '  vec2 w = vec2(',
        '    mix(u_viewBounds.x, u_viewBounds.y, v_uv.x),',
        '    mix(u_viewBounds.w, u_viewBounds.z, 1.0 - v_uv.y)',
        '  );',
        '',
        '  vec2 z = w;',
        '  if (u_isWPlane > 0.5 && !applyInverseChain(z)) discard;',
        '',
        '  vec2 imgUV = vec2(',
        '    0.5 + (z.x - u_center.x) / u_imageSize.x,',
        '    0.5 - (z.y - u_center.y) / u_imageSize.y',
        '  );',
        '',
        '  if (imgUV.x < 0.0 || imgUV.x > 1.0 || imgUV.y < 0.0 || imgUV.y > 1.0) discard;',
        '',
        '  vec4 color = texture2D(u_texture, imgUV);',
        '  if (color.a < u_alphaCutoff) discard;',
        '  gl_FragColor = vec4(color.rgb * color.a, color.a) * u_opacity;',
        '}'
    );
}

function createForwardVertexShader(snapshot) {
    return glsl(
        'attribute vec2 a_texCoord;',
        'attribute vec2 a_mappedPos;',
        'varying vec2 v_uv;',
        'varying float v_valid;',
        '',
        'uniform vec2 u_imageSize;',
        'uniform vec2 u_center;',
        'uniform vec4 u_viewBounds;',
        'uniform float u_useCpuEval;',
        '',
        'uniform float u_isWPlane;',
        'uniform float u_functionId;',
        'uniform vec2 u_mobiusA;',
        'uniform vec2 u_mobiusB;',
        'uniform vec2 u_mobiusC;',
        'uniform vec2 u_mobiusD;',
        'uniform int u_polyDegree;',
        'uniform vec2 u_polyCoeffs[11];',
        'uniform float u_zetaContinuationEnabled;',
        'uniform float u_zetaReflectionBoundary;',
        'uniform float u_fracPower;',
        '',
        getGLSLComplexMathLibrary(snapshot),
        '',
        'void main() {',
        '  v_uv = a_texCoord;',
        '',
        '  if (u_useCpuEval > 0.5) {',
        '    v_valid = 1.0;',
        '    gl_Position = vec4(a_mappedPos, 0.0, 1.0);',
        '    return;',
        '  }',
        '',
        '  float nx = a_texCoord.x * 2.0 - 1.0;',
        '  float ny = -(a_texCoord.y * 2.0 - 1.0);',
        '  vec2 zInput = vec2(',
        '    u_center.x + nx * (u_imageSize.x / 2.0),',
        '    u_center.y + ny * (u_imageSize.y / 2.0)',
        '  );',
        '',
        '  vec2 mappedValue = vec2(0.0);',
        '  float isWP = (u_isWPlane > 0.5) ? 0.0 : 1.0;',
        '  bool ok = evaluateMappedValueBase(',
        '    zInput,',
        '    zInput,',
        '    isWP,',
        '    u_functionId,',
        '    u_mobiusA,',
        '    u_mobiusB,',
        '    u_mobiusC,',
        '    u_mobiusD,',
        '    u_polyDegree,',
        '    u_polyCoeffs,',
        '    u_zetaContinuationEnabled,',
        '    u_zetaReflectionBoundary,',
        '    u_fracPower,',
        '    mappedValue',
        '  );',
        '',
        '  if (!ok || !isFiniteVec2Compat(mappedValue)) {',
        '    v_valid = 0.0;',
        '    gl_Position = vec4(0.0, 0.0, 0.0, 0.0);',
        '    return;',
        '  }',
        '',
        '  v_valid = 1.0;',
        '  float clipX = (mappedValue.x - u_viewBounds.x) / (u_viewBounds.y - u_viewBounds.x) * 2.0 - 1.0;',
        '  float clipY = (mappedValue.y - u_viewBounds.z) / (u_viewBounds.w - u_viewBounds.z) * 2.0 - 1.0;',
        '  gl_Position = vec4(clipX, clipY, 0.0, 1.0);',
        '}'
    );
}

function createForwardFragmentShader() {
    return glsl(
        '#ifdef GL_FRAGMENT_PRECISION_HIGH',
        'precision highp float;',
        '#else',
        'precision mediump float;',
        '#endif',
        'varying vec2 v_uv;',
        'varying float v_valid;',
        'uniform sampler2D u_texture;',
        'uniform float u_opacity;',
        'uniform float u_alphaCutoff;',
        'void main() {',
        '  if (v_valid < 0.99) discard;',
        '  vec4 color = texture2D(u_texture, v_uv);',
        '  if (color.a < u_alphaCutoff) discard;',
        '  gl_FragColor = vec4(color.rgb * color.a, color.a) * u_opacity;',
        '}'
    );
}

function createImagePrograms(gl, snapshot) {
    return {
        inverseProgram: createWebGLProgramShared(gl, createInverseVertexShader(), createInverseFragmentShader(snapshot)),
        forwardProgram: createWebGLProgramShared(gl, createForwardVertexShader(snapshot), createForwardFragmentShader())
    };
}

function createRendererResources(gl) {
    const resources = {
        texture: createTexture(gl),
        quadBuffer: createQuadBuffer(gl),
        forwardVertexBuffer: createDynamicBuffer(gl),
        forwardIndexBuffer: createDynamicBuffer(gl),
        forwardMappedBuffer: createDynamicBuffer(gl)
    };

    if (!resources.texture || !resources.quadBuffer || !resources.forwardVertexBuffer ||
        !resources.forwardIndexBuffer || !resources.forwardMappedBuffer) {
        deleteRendererResources(gl, resources);
        return null;
    }

    return resources;
}

function deleteRendererResources(gl, resources) {
    if (!gl || !resources) return;
    if (resources.texture) gl.deleteTexture(resources.texture);
    if (resources.quadBuffer) gl.deleteBuffer(resources.quadBuffer);
    if (resources.forwardVertexBuffer) gl.deleteBuffer(resources.forwardVertexBuffer);
    if (resources.forwardIndexBuffer) gl.deleteBuffer(resources.forwardIndexBuffer);
    if (resources.forwardMappedBuffer) gl.deleteBuffer(resources.forwardMappedBuffer);
}

const ADAPTIVE_BASE_RESOLUTION = 16;
const ADAPTIVE_MAX_DEPTH = 5;
const ADAPTIVE_MAX_CELLS = 8192;
const ADAPTIVE_EDGE_ERROR_PIXELS = 0.5;
const ADAPTIVE_DISCONTINUITY_RATIO = 0.2;
const ADAPTIVE_MIN_MAPPED_SPAN = 1e-12;
const ADAPTIVE_MAX_VERTICES = 32768;
const ADAPTIVE_MAX_SAMPLES = 65536;
const ADAPTIVE_REUSE_VALIDATION_SAMPLES = 4096;

function getAdaptiveEdgeError(pixelWidth, pixelHeight) {
    const width = Math.max(1, finiteOr(pixelWidth, 1024));
    const height = Math.max(1, finiteOr(pixelHeight, 1024));
    return ADAPTIVE_EDGE_ERROR_PIXELS * Math.min(2 / width, 2 / height);
}

function pointError(point, expectedX, expectedY) {
    const dx = point.x - expectedX;
    const dy = point.y - expectedY;
    return Math.hypot(dx, dy);
}

function relativePointError(point, expectedX, expectedY, first, second) {
    const mappedSpan = Math.max(
        Math.hypot(first.x - second.x, first.y - second.y),
        ADAPTIVE_MIN_MAPPED_SPAN
    );
    return pointError(point, expectedX, expectedY) / mappedSpan;
}

function isMappedCellOutsideViewport(samples, errorMargin) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of samples) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
    }
    return maxX + errorMargin < -1 || minX - errorMargin > 1 ||
        maxY + errorMargin < -1 || minY - errorMargin > 1;
}

export function buildAdaptiveImageMesh({
    bounds,
    sample,
    baseResolution = ADAPTIVE_BASE_RESOLUTION,
    maxDepth = ADAPTIVE_MAX_DEPTH,
    maxCells = ADAPTIVE_MAX_CELLS,
    pixelWidth = 1024,
    pixelHeight = 1024,
    maxVertices = ADAPTIVE_MAX_VERTICES,
    maxSamples = ADAPTIVE_MAX_SAMPLES
} = {}) {
    if (typeof sample !== 'function' || !bounds ||
        !Number.isFinite(bounds.xSpan) || !Number.isFinite(bounds.ySpan) ||
        Math.abs(bounds.xSpan) <= 0 || Math.abs(bounds.ySpan) <= 0) {
        return { vertices: new Float32Array(0), indices: new Uint16Array(0), mappedPositions: new Float32Array(0) };
    }

    const pointRows = new Map();
    const vertices = [];
    const mappedPositions = [];
    const indices = [];
    const leafCells = [];
    const safeMaxDepth = Math.max(0, Math.floor(Number.isFinite(Number(maxDepth)) ? maxDepth : ADAPTIVE_MAX_DEPTH));
    const requestedMaxCells = Number(maxCells);
    const safeMaxCells = Math.max(1, Math.min(
        Number.isFinite(requestedMaxCells) ? Math.floor(requestedMaxCells) : ADAPTIVE_MAX_CELLS,
        Math.floor(UINT16_VERTEX_LIMIT / 4)
    ));
    const safeBaseResolution = Math.max(1, Math.min(
        Math.floor(Math.sqrt(UINT16_VERTEX_LIMIT / 4)),
        Math.floor(Number.isFinite(Number(baseResolution)) ? baseResolution : ADAPTIVE_BASE_RESOLUTION),
        Math.floor(Math.sqrt(safeMaxCells))
    ));
    const safeMaxVertices = Math.max(1, Math.min(
        UINT16_VERTEX_LIMIT,
        Math.floor(Number.isFinite(Number(maxVertices)) ? maxVertices : ADAPTIVE_MAX_VERTICES)
    ));
    const safeMaxSamples = Math.max(1, Math.floor(
        Number.isFinite(Number(maxSamples)) ? maxSamples : ADAPTIVE_MAX_SAMPLES
    ));
    const safeEdgeError = getAdaptiveEdgeError(pixelWidth, pixelHeight);
    let sampleCount = 0;
    let sampleBudgetExceeded = false;

    function sampleAt(u, v) {
        let row = pointRows.get(u);
        const cached = row?.get(v);
        if (cached) return cached;

        if (sampleCount >= safeMaxSamples) {
            sampleBudgetExceeded = true;
            const point = { u, v, valid: false, x: NaN, y: NaN };
            if (!row) {
                row = new Map();
                pointRows.set(u, row);
            }
            row.set(v, point);
            return point;
        }

        let value = null;
        try {
            value = sample(u, v);
        } catch {
            value = null;
        }

        const re = Number(value?.re);
        const im = Number(value?.im);
        const validValue = Number.isFinite(re) && Number.isFinite(im) &&
            Math.abs(re) < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE && Math.abs(im) < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE;
        const point = validValue ? {
            u,
            v,
            valid: true,
            x: (re - bounds.x0) * (2 / bounds.xSpan) - 1,
            y: (im - bounds.y0) * (2 / bounds.ySpan) - 1
        } : { u, v, valid: false, x: NaN, y: NaN };

        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) point.valid = false;
        if (!row) {
            row = new Map();
            pointRows.set(u, row);
        }
        row.set(v, point);
        sampleCount += 1;
        return point;
    }

    function appendLeaf(u0, v0, u1, v1) {
        if (leafCells.length >= safeMaxCells) return;
        leafCells.push({ u0, v0, u1, v1 });
    }

    let frontier = [];
    let processedCellCount = 0;

    function appendCell(target, u0, v0, u1, v1, depth) {
        target.push({ u0, v0, u1, v1, depth });
    }

    function appendChildren(target, cell) {
        const { u0, v0, u1, v1, depth } = cell;
        const centerU = (u0 + u1) * 0.5;
        const centerV = (v0 + v1) * 0.5;
        const childDepth = depth + 1;
        appendCell(target, u0, v0, centerU, centerV, childDepth);
        appendCell(target, centerU, v0, u1, centerV, childDepth);
        appendCell(target, u0, centerV, centerU, v1, childDepth);
        appendCell(target, centerU, centerV, u1, v1, childDepth);
    }

    for (let y = 0; y < safeBaseResolution; y += 1) {
        for (let x = 0; x < safeBaseResolution; x += 1) {
            appendCell(
                frontier,
                x / safeBaseResolution,
                y / safeBaseResolution,
                (x + 1) / safeBaseResolution,
                (y + 1) / safeBaseResolution,
                0
            );
        }
    }

    while (frontier.length > 0) {
        const priorityCandidates = [];
        const deferredCandidates = [];
        processedCellCount += frontier.length;

        for (const cell of frontier) {
            const { u0, v0, u1, v1 } = cell;
            const centerU = (u0 + u1) * 0.5;
            const centerV = (v0 + v1) * 0.5;
            const topLeft = sampleAt(u0, v0);
            const topRight = sampleAt(u1, v0);
            const bottomLeft = sampleAt(u0, v1);
            const bottomRight = sampleAt(u1, v1);
            const top = sampleAt(centerU, v0);
            const right = sampleAt(u1, centerV);
            const bottom = sampleAt(centerU, v1);
            const left = sampleAt(u0, centerV);
            const center = sampleAt(centerU, centerV);
            const samples = [topLeft, topRight, bottomLeft, bottomRight, top, right, bottom, left, center];
            let validCount = 0;
            for (const point of samples) {
                if (point.valid) validCount += 1;
            }

            if (validCount !== samples.length) {
                const candidate = { cell, maxRelativeError: Infinity };
                (validCount > 0 ? priorityCandidates : deferredCandidates).push(candidate);
                continue;
            }

            const edgeChecks = [
                [top, topLeft, topRight],
                [right, topRight, bottomRight],
                [bottom, bottomLeft, bottomRight],
                [left, topLeft, bottomLeft]
            ];
            let maxError = 0;
            let maxRelativeError = 0;
            for (const [midpoint, first, second] of edgeChecks) {
                const expectedX = (first.x + second.x) * 0.5;
                const expectedY = (first.y + second.y) * 0.5;
                const error = pointError(midpoint, expectedX, expectedY);
                maxError = Math.max(maxError, error);
                maxRelativeError = Math.max(
                    maxRelativeError,
                    relativePointError(midpoint, expectedX, expectedY, first, second)
                );
            }

            const expectedCenterX = (topLeft.x + topRight.x + bottomLeft.x + bottomRight.x) * 0.25;
            const expectedCenterY = (topLeft.y + topRight.y + bottomLeft.y + bottomRight.y) * 0.25;
            const centerError = pointError(center, expectedCenterX, expectedCenterY);
            const cornerMappedSpan = Math.max(
                Math.hypot(topLeft.x - topRight.x, topLeft.y - topRight.y),
                Math.hypot(topLeft.x - bottomLeft.x, topLeft.y - bottomLeft.y),
                Math.hypot(topRight.x - bottomRight.x, topRight.y - bottomRight.y),
                Math.hypot(bottomLeft.x - bottomRight.x, bottomLeft.y - bottomRight.y),
                Math.hypot(topLeft.x - bottomRight.x, topLeft.y - bottomRight.y),
                Math.hypot(topRight.x - bottomLeft.x, topRight.y - bottomLeft.y),
                ADAPTIVE_MIN_MAPPED_SPAN
            );
            maxError = Math.max(maxError, centerError);
            maxRelativeError = Math.max(maxRelativeError, centerError / cornerMappedSpan);

            const outsideViewport = isMappedCellOutsideViewport(samples, maxError);
            const needsSubdivision = maxError > safeEdgeError || maxRelativeError > ADAPTIVE_DISCONTINUITY_RATIO;
            if (needsSubdivision) {
                priorityCandidates.push({ cell, maxRelativeError, outsideViewport });
            } else if (!outsideViewport) {
                appendLeaf(u0, v0, u1, v1);
            }
        }

        const candidates = priorityCandidates.concat(deferredCandidates);
        const remainingCellBudget = Math.max(0, safeMaxCells - processedCellCount);
        const expansionCount = !sampleBudgetExceeded && frontier[0].depth < safeMaxDepth
            ? Math.min(candidates.length, Math.floor(remainingCellBudget / 4))
            : 0;
        const nextFrontier = [];

        for (let index = 0; index < expansionCount; index += 1) {
            appendChildren(nextFrontier, candidates[index].cell);
        }
        for (let index = expansionCount; index < priorityCandidates.length; index += 1) {
            const candidate = priorityCandidates[index];
            if (!candidate.outsideViewport && candidate.maxRelativeError <= ADAPTIVE_DISCONTINUITY_RATIO) {
                const { u0, v0, u1, v1 } = candidate.cell;
                appendLeaf(u0, v0, u1, v1);
            }
        }

        frontier = nextFrontier;
    }

    const gridSize = safeBaseResolution * (2 ** safeMaxDepth);
    const toGrid = value => Math.round(value * gridSize);
    const pointCache = new Map();
    const edgeMaps = {
        top: new Map(),
        right: new Map(),
        bottom: new Map(),
        left: new Map()
    };

    function edgeMapEntry(map, boundary, start, end) {
        const entries = map.get(boundary) || [];
        entries.push({ start, end });
        map.set(boundary, entries);
    }

    for (const leaf of leafCells) {
        leaf.grid = {
            x0: toGrid(leaf.u0),
            y0: toGrid(leaf.v0),
            x1: toGrid(leaf.u1),
            y1: toGrid(leaf.v1)
        };
        const { x0, y0, x1, y1 } = leaf.grid;
        edgeMapEntry(edgeMaps.top, y0, x0, x1);
        edgeMapEntry(edgeMaps.right, x1, y0, y1);
        edgeMapEntry(edgeMaps.bottom, y1, x0, x1);
        edgeMapEntry(edgeMaps.left, x0, y0, y1);
    }

    function pointAtGrid(x, y) {
        const key = `${x},${y}`;
        const cached = pointCache.get(key);
        if (cached) return cached;
        const point = sampleAt(x / gridSize, y / gridSize);
        pointCache.set(key, point);
        return point;
    }

    function getEdgeBreaks(map, boundary, start, end) {
        const positions = new Set([start, end]);
        for (const entry of map.get(boundary) || []) {
            if (entry.start >= end || entry.end <= start) continue;
            positions.add(Math.max(start, entry.start));
            positions.add(Math.min(end, entry.end));
        }
        return [...positions].sort((a, b) => a - b);
    }

    function appendBoundaryPoint(boundary, x, y) {
        const previous = boundary[boundary.length - 1];
        if (!previous || previous[0] !== x || previous[1] !== y) boundary.push([x, y]);
    }

    function getLeafBoundary(leaf) {
        const { x0, y0, x1, y1 } = leaf.grid;
        const boundary = [];

        for (const x of getEdgeBreaks(edgeMaps.bottom, y0, x0, x1)) appendBoundaryPoint(boundary, x, y0);
        for (const y of getEdgeBreaks(edgeMaps.left, x1, y0, y1)) appendBoundaryPoint(boundary, x1, y);
        for (const x of getEdgeBreaks(edgeMaps.top, y1, x0, x1).reverse()) appendBoundaryPoint(boundary, x, y1);
        for (const y of getEdgeBreaks(edgeMaps.right, x0, y0, y1).reverse()) appendBoundaryPoint(boundary, x0, y);

        const last = boundary[boundary.length - 1];
        if (boundary.length > 1 &&
            boundary[0][0] === last[0] &&
            boundary[0][1] === last[1]) {
            boundary.pop();
        }
        return boundary;
    }

    const vertexMap = new Map();
    function getVertex(x, y) {
        const key = `${x},${y}`;
        const cached = vertexMap.get(key);
        if (cached !== undefined) return cached;

        const point = pointAtGrid(x, y);
        if (!point.valid || vertices.length / 2 >= safeMaxVertices) {
            return -1;
        }

        const index = vertices.length / 2;
        vertices.push(point.u, point.v);
        mappedPositions.push(point.x, point.y);
        vertexMap.set(key, index);
        return index;
    }

    for (const leaf of leafCells) {
        const { x0, y0, x1, y1 } = leaf.grid;
        const boundary = getLeafBoundary(leaf);
        if (boundary.length === 4) {
            const topLeft = getVertex(x0, y0);
            const bottomLeft = getVertex(x0, y1);
            const topRight = getVertex(x1, y0);
            const bottomRight = getVertex(x1, y1);
            if ([topLeft, bottomLeft, topRight, bottomRight].some(index => index < 0)) continue;
            indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
            continue;
        }

        const center = getVertex((x0 + x1) / 2, (y0 + y1) / 2);
        const boundaryVertices = boundary.map(([x, y]) => getVertex(x, y));
        if (center < 0 || boundaryVertices.some(index => index < 0)) continue;
        for (let index = 0; index < boundaryVertices.length; index += 1) {
            const current = boundaryVertices[index];
            const next = boundaryVertices[(index + 1) % boundaryVertices.length];
            indices.push(center, next, current);
        }
    }

    return {
        vertices: Float32Array.from(vertices),
        indices: Uint16Array.from(indices),
        mappedPositions: Float32Array.from(mappedPositions),
        cellCount: leafCells.length,
        sampleCount
    };
}

export function buildRasterSurfaceMesh(planeParams, map = null) {
    const snapshot = readRenderState();
    const media = getRasterDisplayDimensions(snapshot.currentInputShape);
    const bounds = { ...getViewBounds(planeParams) };
    if (!hasUsableBounds(bounds) || media.width <= 0 || media.height <= 0) return null;

    const transform = getForwardTransform(true, map);
    const mesh = buildAdaptiveImageMesh({
        bounds,
        pixelWidth: planeParams.width,
        pixelHeight: planeParams.height,
        sample: (u, v) => transform(
            snapshot.a0 + (u * 2 - 1) * media.width * 0.5,
            snapshot.b0 - (v * 2 - 1) * media.height * 0.5
        )
    });

    return {
        ...mesh,
        bounds,
        sourceCenter: { re: snapshot.a0, im: snapshot.b0 },
        sourceSize: media
    };
}

function getMeshKey(currentShape, planeParams, isWP, snapshot, map, pixelWidth, pixelHeight, chainIndex = null) {
    const bounds = getViewBounds(planeParams);
    const media = getRasterDisplayDimensions(currentShape);
    const renderStage = getRasterRenderStage(map, chainIndex);
    const transformSignature = map?.signature || JSON.stringify({
        function: snapshot.currentFunction,
        stage: renderStage,
        chainCount: snapshot.chainCount,
        chainMode: snapshot.chainingMode,
        algebraicTerms: snapshot.algebraicChainingTerms,
        algebraicZExpr: snapshot.algebraicChainingZExpr,
        mobius: [snapshot.mobiusA, snapshot.mobiusB, snapshot.mobiusC, snapshot.mobiusD],
        polynomial: [snapshot.polynomialN, snapshot.polynomialCoeffs],
        fractionalPower: snapshot.fractionalPowerN
    });
    return [
        currentShape,
        isWP ? 1 : 0,
        snapshot.a0,
        snapshot.b0,
        bounds.x0,
        bounds.x1,
        bounds.y0,
        bounds.y1,
        media.width,
        media.height,
        pixelWidth,
        pixelHeight,
        snapshot.zetaContinuationEnabled ? 1 : 0,
        transformSignature
    ].join('|');
}

function getMeshTopologyKey(currentShape, planeParams, isWP, snapshot, map, pixelWidth, pixelHeight, chainIndex = null) {
    const bounds = getViewBounds(planeParams);
    const media = getRasterDisplayDimensions(currentShape);
    const renderStage = getRasterRenderStage(map, chainIndex);
    const algebraicStructure = Array.isArray(snapshot.algebraicChainingTerms)
        ? snapshot.algebraicChainingTerms.map(term => (
            Array.isArray(term?.factors)
                ? term.factors.map(factor => [
                    factor?.func,
                    factor?.chainedFunc,
                    factor?.power,
                    factor?.reciprocal ? 1 : 0,
                    factor?.log ? 1 : 0,
                    factor?.exp ? 1 : 0
                ].join(':')).join(';')
                : ''
        )).join('|')
        : '';

    return [
        currentShape,
        isWP ? 1 : 0,
        snapshot.a0,
        snapshot.b0,
        bounds.x0,
        bounds.x1,
        bounds.y0,
        bounds.y1,
        media.width,
        media.height,
        pixelWidth,
        pixelHeight,
        snapshot.currentFunction,
        snapshot.zetaContinuationEnabled ? 1 : 0,
        map?.presentation || 'function',
        map?.stage ?? renderStage,
        snapshot.chainingEnabled ? 1 : 0,
        snapshot.chainCount,
        snapshot.chainingMode,
        snapshot.polynomialN,
        snapshot.fractionalPowerN,
        snapshot.algebraicChainingZExpr,
        algebraicStructure
    ].join('|');
}

function normalizedImageMappedPoint(value, u, v, bounds) {
    const re = Number(value?.re);
    const im = Number(value?.im);
    if (!Number.isFinite(re) || !Number.isFinite(im) ||
        Math.abs(re) >= DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE ||
        Math.abs(im) >= DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE) {
        return null;
    }

    const x = (re - bounds.x0) * (2 / bounds.xSpan) - 1;
    const y = (im - bounds.y0) * (2 / bounds.ySpan) - 1;
    return Number.isFinite(x) && Number.isFinite(y) ? { u, v, x, y } : null;
}

function reuseAdaptiveImageMesh(mesh, bounds, sample, useCpuEval, edgeError) {
    if (!mesh?.vertices?.length || !mesh.indices?.length) return null;
    const vertexCount = mesh.vertices.length / 2;

    const mapped = useCpuEval ? new Float32Array(mesh.mappedPositions.length) : null;
    const points = new Array(vertexCount);
    for (let index = 0; index < vertexCount; index += 1) {
        const u = mesh.vertices[index * 2];
        const v = mesh.vertices[index * 2 + 1];
        let point = null;
        try {
            point = normalizedImageMappedPoint(sample(u, v), u, v, bounds);
        } catch {
            point = null;
        }
        if (!point) return null;
        points[index] = point;
        if (mapped) {
            mapped[index * 2] = point.x;
            mapped[index * 2 + 1] = point.y;
        }
    }

    const triangleCount = mesh.indices.length / 3;
    const checkedTriangles = Math.min(triangleCount, ADAPTIVE_REUSE_VALIDATION_SAMPLES);
    for (let check = 0; check < checkedTriangles; check += 1) {
        const triangleOffset = Math.floor(check * triangleCount / checkedTriangles) * 3;
        const a = points[mesh.indices[triangleOffset]];
        const b = points[mesh.indices[triangleOffset + 1]];
        const c = points[mesh.indices[triangleOffset + 2]];
        const u = (a.u + b.u + c.u) / 3;
        const v = (a.v + b.v + c.v) / 3;
        let center = null;
        try {
            center = normalizedImageMappedPoint(sample(u, v), u, v, bounds);
        } catch {
            center = null;
        }
        if (!center) return null;

        const expectedX = (a.x + b.x + c.x) / 3;
        const expectedY = (a.y + b.y + c.y) / 3;
        if (Math.hypot(center.x - expectedX, center.y - expectedY) > edgeError) {
            return null;
        }
    }

    return mapped ? { ...mesh, mappedPositions: mapped } : mesh;
}

function uploadForwardMesh(renderer, mesh, topologyReused = false) {
    const gl = renderer.gl;

    if (!topologyReused) {
        gl.bindBuffer(gl.ARRAY_BUFFER, renderer.forwardVertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, renderer.forwardIndexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    }

    renderer.forwardIndexCount = mesh.indices.length;
    renderer.forwardIndexType = gl.UNSIGNED_SHORT;
    renderer.forwardMesh = mesh;
    renderer.forwardMappedMesh = null;
}

function shouldUseCpuForwardEvaluation(isWP, snapshot, map) {
    if (!isWP) return false;
    return snapshot.currentFunction === 'algebraic_chaining' || map?.presentation === 'derivative' || Boolean(snapshot.chainingEnabled && (
        snapshot.chainCount > 1 ||
        snapshot.chainingMode === 'zero_seed'
    ));
}

function getRasterRenderStage(map, chainIndex = null) {
    if (Number.isFinite(map?.stage) || Number.isFinite(chainIndex)) {
        return getImageRenderChainIndex(Number.isFinite(chainIndex) ? chainIndex : 0, map);
    }

    return state.chainingEnabled
        ? normalizeChainIndex((state.chainCount || 1) - 1)
        : 0;
}

function getForwardTransform(isWP, map, chainIndex = null) {
    if (!isWP) return (re, im) => ({ re, im });
    if (typeof map?.evaluate === 'function') return map.evaluate;

    return getChainedStageTransformFunction(state.currentFunction, getRasterRenderStage(map, chainIndex));
}

function configureAttribute(gl, location, size, buffer) {
    if (location < 0 || !buffer) return false;

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    return true;
}

function disableAttribute(gl, location) {
    if (location >= 0) gl.disableVertexAttribArray(location);
}

function bindInverseGeometry(renderer, locs) {
    const gl = renderer.gl;

    const vaoBound = bindOrCreateVao(renderer, 'inverseVao', () => {
        return configureAttribute(gl, locs.aPosition, 2, renderer.quadBuffer);
    });

    return vaoBound || configureAttribute(gl, locs.aPosition, 2, renderer.quadBuffer);
}

function uploadCpuMappedPositions(renderer) {
    const mesh = renderer.forwardMesh;
    if (!mesh) return false;
    if (renderer.forwardMappedMesh === mesh) return true;

    const gl = renderer.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.forwardMappedBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.mappedPositions, gl.STATIC_DRAW);
    renderer.forwardMappedMesh = mesh;
    return true;
}

function configureForwardGeometry(renderer, locs, useCpuEval) {
    const gl = renderer.gl;
    if (!configureAttribute(gl, locs.aTexCoord, 2, renderer.forwardVertexBuffer)) return false;

    if (useCpuEval) {
        if (!configureAttribute(gl, locs.aMappedPos, 2, renderer.forwardMappedBuffer)) return false;
    } else {
        disableAttribute(gl, locs.aMappedPos);
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, renderer.forwardIndexBuffer);
    return true;
}

function bindForwardGeometry(renderer, locs, useCpuEval) {
    const vaoKey = useCpuEval ? 'forwardCpuVao' : 'forwardGpuVao';
    return bindOrCreateVao(
        renderer,
        vaoKey,
        () => configureForwardGeometry(renderer, locs, useCpuEval)
    ) || configureForwardGeometry(renderer, locs, useCpuEval);
}

function prepareForwardGeometry(renderer, locs, useCpuEval) {
    const gl = renderer.gl;

    setUniform1fIfPresent(gl, locs.uUseCpuEval, useCpuEval ? 1.0 : 0.0);
    if (useCpuEval && !uploadCpuMappedPositions(renderer)) return false;

    return bindForwardGeometry(renderer, locs, useCpuEval);
}

function bindForwardSpecialUniforms(gl, locs, snapshot) {
    setUniform1fIfPresent(gl, locs.uZetaContinuationEnabled, snapshot.zetaContinuationEnabled ? 1 : 0);
    setUniform1fIfPresent(
        gl,
        locs.uZetaReflectionBoundary,
        typeof ZETA_REFLECTION_POINT_RE !== 'undefined' ? ZETA_REFLECTION_POINT_RE : 0.5
    );
}

function getInverseChainMode(chainIndex, snapshot) {
    return chainIndex > 0 && snapshot.chainingEnabled
        ? CHAIN_MODE[snapshot.chainingMode] || CHAIN_MODE.recursion
        : 0;
}

function normalizeChainIndex(value) {
    return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

export function getImageRenderChainIndex(chainIndex = 0, map = null) {
    return normalizeChainIndex(Number.isFinite(map?.stage) ? map.stage : chainIndex);
}

function setImageUniformsForSnapshot(gl, locs, planeParams, isWP, currentShape, snapshot) {
    if (!gl || !locs || !planeParams) return;

    bindImageGeometryUniforms(gl, locs, planeParams, currentShape, isWP, snapshot);
    if (isWP) bindComplexImageUniforms(gl, locs, snapshot);
}

function drawInverseImagePath(renderer, planeParams, isWP, currentShape, chainIndex, width, height, snapshot) {
    if (!renderer.inverseProgram || !renderer.inverseLocs) return false;

    const gl = renderer.gl;
    const locs = renderer.inverseLocs;

    gl.useProgram(renderer.inverseProgram);
    if (!bindInverseGeometry(renderer, locs)) return false;

    gl.uniform2f(locs.uResolution, width, height);
    setImageUniformsForSnapshot(gl, locs, planeParams, isWP, currentShape, snapshot);

    if (hasUniform(locs.uTexture)) gl.uniform1i(locs.uTexture, 0);

    gl.uniform1i(locs.uChainIndex, chainIndex);
    gl.uniform1i(locs.uChainMode, getInverseChainMode(chainIndex, snapshot));

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, QUAD_VERTEX_COUNT);
    unbindVao(renderer);
    return true;
}

function drawForwardImagePath(renderer, planeParams, isWP, currentShape, snapshot, map, chainIndex) {
    if (!renderer.forwardProgram || !renderer.forwardLocs) return false;

    const useCpuEval = shouldUseCpuForwardEvaluation(isWP, snapshot, map);
    const meshReady = ensureForwardMesh(renderer, planeParams, isWP, currentShape, snapshot, map, useCpuEval, chainIndex);
    if (!meshReady) return false;
    if (!renderer.forwardIndexCount) return true;

    const gl = renderer.gl;
    const locs = renderer.forwardLocs;

    gl.useProgram(renderer.forwardProgram);
    if (!prepareForwardGeometry(renderer, locs, useCpuEval)) {
        unbindVao(renderer);
        return false;
    }

    setImageUniformsForSnapshot(gl, locs, planeParams, isWP, currentShape, snapshot);

    if (hasUniform(locs.uTexture)) gl.uniform1i(locs.uTexture, 0);

    bindForwardSpecialUniforms(gl, locs, snapshot);
    gl.drawElements(gl.TRIANGLES, renderer.forwardIndexCount, renderer.forwardIndexType, 0);

    unbindVao(renderer);
    return true;
}

function isInverseImageRenderSupportedForSnapshot(snapshot) {
    if (!snapshot) return false;
    if (snapshot.chainingMode === 'zero_seed') return false;
    const metadata = IMAGE_TRANSFORM_INVERSE_METADATA[snapshot.currentFunction];
    if (!metadata || metadata.injectivity === 'no') return false;

    if (snapshot.currentFunction === 'mobius') {
        const a = snapshot.mobiusA || {};
        const b = snapshot.mobiusB || {};
        const c = snapshot.mobiusC || {};
        const d = snapshot.mobiusD || {};
        const determinantRe = complexPart(a, 're') * complexPart(d, 're') -
            complexPart(a, 'im') * complexPart(d, 'im') -
            complexPart(b, 're') * complexPart(c, 're') +
            complexPart(b, 'im') * complexPart(c, 'im');
        const determinantIm = complexPart(a, 're') * complexPart(d, 'im') +
            complexPart(a, 'im') * complexPart(d, 're') -
            complexPart(b, 're') * complexPart(c, 'im') -
            complexPart(b, 'im') * complexPart(c, 're');
        return Number.isFinite(determinantRe) && Number.isFinite(determinantIm) &&
            determinantRe * determinantRe + determinantIm * determinantIm > 1e-18;
    }

    if (snapshot.currentFunction === 'polynomial') {
        const degree = Math.max(0, Math.floor(Number(snapshot.polynomialN) || 0));
        const leading = snapshot.polynomialCoeffs?.[degree];
        const leadingRe = complexPart(leading, 're');
        const leadingIm = complexPart(leading, 'im');
        return degree === 1 && leadingRe * leadingRe + leadingIm * leadingIm > 1e-18;
    }

    if (snapshot.currentFunction === 'power') {
        return Number(snapshot.fractionalPowerN) === 1;
    }

    return true;
}

export function shouldUseInverseImagePath(isWP, snapshot, chainIndex = 0) {
    if (!isWP) return true;
    if (normalizeChainIndex(chainIndex) > MAX_INVERSE_CHAIN_INDEX) return false;
    return isInverseImageRenderSupportedForSnapshot(snapshot) && !snapshot.navigationModeEnabled;
}

function getDrawableRasterSource(snapshot) {
    const currentShape = snapshot.currentInputShape;
    const source = getRasterSourceForShape(currentShape);

    if (!isRasterInputShape(currentShape) || !source || isVideoAwaitingFrame(currentShape, source)) return null;

    return { currentShape, source };
}

export function createWebGLImageRenderer() {
    const snapshot = readRenderState();
    const context = createRenderCanvas();

    if (!context) return null;

    const gl = context.gl;
    const programs = createImagePrograms(gl, snapshot);
    const resources = createRendererResources(gl);

    if ((!programs.inverseProgram && !programs.forwardProgram) || !resources) {
        deleteImagePrograms(gl, programs);
        deleteRendererResources(gl, resources);
        return null;
    }

    const renderer = {
        canvas: context.canvas,
        gl,
        vao: createVertexArrayRegistry(gl),

        texture: resources.texture,
        quadBuffer: resources.quadBuffer,

        inverseProgram: programs.inverseProgram,
        inverseLocs: getInverseLocs(gl, programs.inverseProgram, snapshot),
        inverseVao: null,

        forwardProgram: programs.forwardProgram,
        forwardLocs: getForwardLocs(gl, programs.forwardProgram, snapshot),
        forwardVertexBuffer: resources.forwardVertexBuffer,
        forwardIndexBuffer: resources.forwardIndexBuffer,
        forwardMappedBuffer: resources.forwardMappedBuffer,
        forwardMappedMesh: null,
        forwardGpuVao: null,
        forwardCpuVao: null,

        uploadedSource: null,
        uploadedSourceToken: -1,

        forwardIndexCount: 0,
        forwardIndexType: gl.UNSIGNED_SHORT,
        forwardMeshKey: '',
        forwardTopologyKey: '',
        forwardMesh: null,

        contextLost: false,
        disposed: false,
        onContextLost: null,
        onContextRestored: null
    };

    attachContextLifecycle(renderer);
    return renderer;
}

export function disposeWebGLRenderer(renderer) {
    if (!renderer || renderer.disposed) return;

    const gl = renderer.gl;

    if (renderer.canvas) {
        if (renderer.onContextLost) {
            renderer.canvas.removeEventListener('webglcontextlost', renderer.onContextLost, false);
        }
        if (renderer.onContextRestored) {
            renderer.canvas.removeEventListener('webglcontextrestored', renderer.onContextRestored, false);
        }
    }

    if (gl && !(typeof gl.isContextLost === 'function' && gl.isContextLost())) {
        unbindVao(renderer);

        deleteRendererVao(renderer, 'inverseVao');
        deleteRendererVao(renderer, 'forwardGpuVao');
        deleteRendererVao(renderer, 'forwardCpuVao');

        if (renderer.texture) gl.deleteTexture(renderer.texture);
        if (renderer.quadBuffer) gl.deleteBuffer(renderer.quadBuffer);
        if (renderer.forwardVertexBuffer) gl.deleteBuffer(renderer.forwardVertexBuffer);
        if (renderer.forwardIndexBuffer) gl.deleteBuffer(renderer.forwardIndexBuffer);
        if (renderer.forwardMappedBuffer) gl.deleteBuffer(renderer.forwardMappedBuffer);
        if (renderer.inverseProgram) gl.deleteProgram(renderer.inverseProgram);
        if (renderer.forwardProgram) gl.deleteProgram(renderer.forwardProgram);
    }

    renderer.texture = null;
    renderer.quadBuffer = null;
    renderer.forwardVertexBuffer = null;
    renderer.forwardIndexBuffer = null;
    renderer.forwardMappedBuffer = null;
    renderer.forwardMappedMesh = null;
    renderer.inverseProgram = null;
    renderer.forwardProgram = null;
    renderer.inverseLocs = null;
    renderer.forwardLocs = null;
    renderer.uploadedSource = null;
    renderer.uploadedSourceToken = -1;
    renderer.forwardIndexCount = 0;
    renderer.forwardMesh = null;
    renderer.forwardTopologyKey = '';
    renderer.disposed = true;

    if (webglImageSupport.renderer === renderer) {
        webglImageSupport.renderer = null;
        markSupportUnavailable('disposed');
    }
}

export function initWebGLImageSupportIfNeeded() {
    if (webglImageSupport.renderer && isContextUsable(webglImageSupport.renderer)) return;

    if (webglImageSupport.renderer) {
        disposeWebGLRenderer(webglImageSupport.renderer);
        webglImageSupport.renderer = null;
    }

    const renderer = createWebGLImageRenderer();

    webglImageSupport.renderer = renderer;
    webglImageSupport.available = Boolean(renderer);
    webglImageSupport.reason = renderer ? 'ready' : 'failed_to_initialize';
}

export function updateImageTexture(renderer) {
    if (!isContextUsable(renderer) || !renderer.texture) return false;

    const snapshot = readRenderState();
    const gl = renderer.gl;
    const currentShape = snapshot.currentInputShape;
    const source = getRasterSourceForShape(currentShape);
    const sourceToken = getRasterVersionTokenForShape(currentShape);

    if (!source) {
        renderer.uploadedSource = null;
        renderer.uploadedSourceToken = -1;
        return false;
    }

    if (isVideoAwaitingFrame(currentShape, source)) return false;

    if (renderer.uploadedSource === source && renderer.uploadedSourceToken === sourceToken) return true;

    renderer.uploadedSource = source;
    renderer.uploadedSourceToken = sourceToken;

    gl.bindTexture(gl.TEXTURE_2D, renderer.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return true;
}

export function ensureForwardMesh(renderer, planeParams, isWP, currentShape, snapshot, map, useCpuEval = false, chainIndex = null) {
    if (!isContextUsable(renderer)) return false;
    if (!planeParams) return false;

    const frame = snapshot || readRenderState();
    const shape = currentShape ?? frame.currentInputShape;
    const pixelWidth = Math.max(1, renderer.canvas.width || planeParams.width || 1024);
    const pixelHeight = Math.max(1, renderer.canvas.height || planeParams.height || 1024);
    const meshKey = getMeshKey(shape, planeParams, Boolean(isWP), frame, map, pixelWidth, pixelHeight, chainIndex);
    const topologyKey = getMeshTopologyKey(shape, planeParams, Boolean(isWP), frame, map, pixelWidth, pixelHeight, chainIndex);

    if (renderer.forwardMeshKey === meshKey && renderer.forwardMesh) return true;

    const bounds = getViewBounds(planeParams);
    if (!hasUsableBounds(bounds)) return false;

    const edgeError = getAdaptiveEdgeError(pixelWidth, pixelHeight);
    const media = getRasterDisplayDimensions(shape);
    const transform = getForwardTransform(Boolean(isWP), map, chainIndex);
    if (renderer.forwardTopologyKey === topologyKey && renderer.forwardMesh) {
        const reusedMesh = reuseAdaptiveImageMesh(
            renderer.forwardMesh,
            bounds,
            (u, v) => transform(
                frame.a0 + (u * 2 - 1) * media.width * 0.5,
                frame.b0 - (v * 2 - 1) * media.height * 0.5
            ),
            useCpuEval,
            edgeError
        );
        if (reusedMesh) {
            uploadForwardMesh(renderer, reusedMesh, true);
            renderer.forwardMeshKey = meshKey;
            return true;
        }
    }

    const mesh = buildAdaptiveImageMesh({
        bounds: { ...bounds },
        pixelWidth,
        pixelHeight,
        maxVertices: ADAPTIVE_MAX_VERTICES,
        maxCells: ADAPTIVE_MAX_CELLS,
        sample: (u, v) => transform(
            frame.a0 + (u * 2 - 1) * media.width * 0.5,
            frame.b0 - (v * 2 - 1) * media.height * 0.5
        )
    });

    uploadForwardMesh(renderer, mesh);
    renderer.forwardMeshKey = meshKey;
    renderer.forwardTopologyKey = topologyKey;
    return true;
}

export function drawImageWithWebGL(targetCtx, planeParams, isWP, chainIndex, map = null) {
    const snapshot = readRenderState();
    const effectiveChainIndex = getImageRenderChainIndex(chainIndex, map);

    invalidateImageRendererForDynamicAlgebra(snapshot);
    initWebGLImageSupportIfNeeded();

    const raster = getDrawableRasterSource(snapshot);
    if (!webglImageSupport.available || !raster || !hasDrawableTargetContext(targetCtx)) return false;

    const renderer = webglImageSupport.renderer;
    if (!isContextUsable(renderer)) return false;

    const gl = renderer.gl;
    const size = getTargetSize(targetCtx, planeParams);

    if (!resizeRendererCanvas(renderer, size.width, size.height)) return false;
    if (!updateImageTexture(renderer)) return false;

    clearTransparent(gl);
    enablePremultipliedAlphaBlend(gl);
    bindTextureUnit0(gl, renderer.texture);

    const rendered = map?.presentation !== 'derivative' && shouldUseInverseImagePath(isWP, snapshot, effectiveChainIndex)
        ? drawInverseImagePath(
            renderer,
            planeParams,
            isWP,
            raster.currentShape,
            effectiveChainIndex,
            size.width,
            size.height,
            snapshot
        )
        : drawForwardImagePath(renderer, planeParams, isWP, raster.currentShape, snapshot, map, effectiveChainIndex);

    if (!rendered) return false;

    compositeRendererCanvas(targetCtx, renderer);
    return true;
}
