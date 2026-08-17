import { state } from '../store/state.js';
import {
    createWebGLProgramShared,
    getWebGLFunctionIdShared,
    GLSL_COMPLEX_INVERSE_LIBRARY,
    getGLSLComplexMathLibrary,
    collectAlgebraicUniformLocationsShared
} from './webgl-shared.js';
import {
    getRasterSourceForShape,
    getRasterVersionTokenForShape,
    getRasterDisplayDimensions,
    getRasterOpacityForShape,
    isRasterInputShape
} from '../utils/raster-media.js';
import { MAX_POLY_DEGREE } from '../constants/numerical.js';
import { buildNativeImageMesh, nativeMapOptions } from '../native/complex-engine.js';

const QUAD_VERTEX_COUNT = 4;
const DEFAULT_ALPHA_CUTOFF = 0.05;
const UINT16_VERTEX_LIMIT = 65535;
const EMPTY_ARRAY = Object.freeze([]);
const MAX_INVERSE_CHAIN_INDEX = 15;

const IMAGE_INVERSE_FUNCTIONS = new Set([
    'exp',
    'ln',
    'reciprocal',
    'mobius',
    'polynomial',
    'poincare',
    'power'
]);

const CHAIN_MODE = Object.freeze({
    recursion: 1,
    zero_seed: 2
});

const webglImageSupport = {
    available: false,
    reason: 'not-initialized',
    renderer: null
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
    expBase: { re: Math.E, im: 0 },
    logBase: { re: Math.E, im: 0 },
    besselOrder: { re: 0, im: 0 },
    algebraicChainingTerms: EMPTY_ARRAY,
    algebraicChainingZExpr: 'z',
    chainingEnabled: false,
    chainCount: 0,
    chainingMode: null,
    navigationModeEnabled: false,
    branchCutAngle: Math.PI,
    zetaContinuationEnabled: false
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
    writeComplex(snapshot.expBase, state.expBase, Math.E, 0);
    writeComplex(snapshot.logBase, state.logBase, Math.E, 0);
    writeComplex(snapshot.besselOrder, state.besselOrder, 0, 0);

    snapshot.algebraicChainingTerms = cloneAlgebraicTerms(state.algebraicChainingTerms);
    snapshot.algebraicChainingZExpr = state.algebraicChainingZExpr || 'z';
    snapshot.chainingEnabled = Boolean(state.chainingEnabled);
    snapshot.chainCount = finiteOr(state.chainCount, 0);
    snapshot.chainingMode = state.chainingMode;
    snapshot.navigationModeEnabled = Boolean(state.navigationModeEnabled);
    snapshot.branchCutAngle = state.branchCutType === 'ray' && Number.isFinite(state.branchCutAngle)
        ? state.branchCutAngle
        : Math.PI;

    snapshot.zetaContinuationEnabled = Boolean(state.zetaContinuationEnabled);

    return snapshot;
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
    gl.uniform1f(locs.uFunctionId, getWebGLFunctionIdShared(snapshot.currentFunction));
    bindMobiusUniforms(gl, locs, snapshot);
    bindPolynomialUniforms(gl, locs, snapshot);
    bindFractionalPowerUniform(gl, locs, snapshot);
    const expBase = snapshot.expBase || { re: Math.E, im: 0 };
    const logBase = snapshot.logBase || { re: Math.E, im: 0 };
    const besselOrder = snapshot.besselOrder || { re: 0, im: 0 };
    if (locs.uExpBase) gl.uniform2f(locs.uExpBase, expBase.re, expBase.im);
    if (locs.uLogBase) gl.uniform2f(locs.uLogBase, logBase.re, logBase.im);
    if (locs.uBesselOrder) gl.uniform2f(locs.uBesselOrder, besselOrder.re, besselOrder.im);
    if (locs.uBranchCutAngle) gl.uniform1f(locs.uBranchCutAngle, snapshot.branchCutAngle);
}

function getCommonImageLocs(gl, program) {
    const locs = {
        uImageSize: gl.getUniformLocation(program, 'u_imageSize'),
        uCenter: gl.getUniformLocation(program, 'u_center'),
        uViewBounds: gl.getUniformLocation(program, 'u_viewBounds'),
        uIsWPlane: gl.getUniformLocation(program, 'u_isWPlane'),
        uFunctionId: gl.getUniformLocation(program, 'u_functionId'),
        uBranchCutAngle: gl.getUniformLocation(program, 'u_branchCutAngle'),
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

function getForwardLocs(gl, program) {
    if (!program) return null;
    return {
        aTexCoord: gl.getAttribLocation(program, 'a_texCoord'),
        aMappedPos: gl.getAttribLocation(program, 'a_mappedPos'),
        uTexture: gl.getUniformLocation(program, 'u_texture'),
        uOpacity: gl.getUniformLocation(program, 'u_opacity'),
        uAlphaCutoff: gl.getUniformLocation(program, 'u_alphaCutoff')
    };
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

function createForwardVertexShader() {
    return glsl(
        'attribute vec2 a_texCoord;',
        'attribute vec2 a_mappedPos;',
        'varying vec2 v_uv;',
        '',
        'void main() {',
        '  v_uv = a_texCoord;',
        '  gl_Position = vec4(a_mappedPos, 0.0, 1.0);',
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
        'uniform sampler2D u_texture;',
        'uniform float u_opacity;',
        'uniform float u_alphaCutoff;',
        'void main() {',
        '  vec4 color = texture2D(u_texture, v_uv);',
        '  if (color.a < u_alphaCutoff) discard;',
        '  gl_FragColor = vec4(color.rgb * color.a, color.a) * u_opacity;',
        '}'
    );
}

function createImagePrograms(gl, snapshot) {
    return {
        inverseProgram: createWebGLProgramShared(gl, createInverseVertexShader(), createInverseFragmentShader(snapshot)),
        forwardProgram: createWebGLProgramShared(gl, createForwardVertexShader(), createForwardFragmentShader())
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
const ADAPTIVE_MAX_VERTICES = 32768;
const ADAPTIVE_MAX_SAMPLES = 65536;

function nativeImageMap(snapshot, map, isWP, chainIndex = null) {
    if (!isWP) return nativeMapOptions(state, {
        functionKey: 'identity',
        chainingEnabled: false,
        chainCount: 1,
        derivativeMode: false
    });
    return nativeMapOptions(state, {
        stage: getRasterRenderStage(map, chainIndex),
        derivativeMode: map?.presentation === 'derivative',
        ...(map?.evaluate?.nativeMapOptions || map?.nativeMapOptions || {})
    });
}

function buildNativeRasterMesh({
    bounds,
    sourceCenter,
    sourceSize,
    mapOptions,
    pixelWidth,
    pixelHeight,
    baseResolution = ADAPTIVE_BASE_RESOLUTION,
    maxDepth = ADAPTIVE_MAX_DEPTH,
    maxCells = ADAPTIVE_MAX_CELLS,
    maxVertices = ADAPTIVE_MAX_VERTICES,
    maxSamples = ADAPTIVE_MAX_SAMPLES,
    buildFold = false,
    foldHeightScale = 1,
    preciseViewport = null
}) {
    return buildNativeImageMesh({
        mapOptions,
        bounds,
        sourceCenter,
        sourceSize,
        pixelWidth,
        pixelHeight,
        baseResolution,
        maxDepth,
        maxCells,
        maxVertices,
        maxSamples,
        buildFold,
        foldHeightScale,
        preciseViewport
    });
}

export function buildRasterSurfaceMesh(planeParams, map = null) {
    const snapshot = readRenderState();
    const media = getRasterDisplayDimensions(snapshot.currentInputShape);
    const bounds = { ...getViewBounds(planeParams) };
    if (!hasUsableBounds(bounds) || media.width <= 0 || media.height <= 0) return null;

    const mesh = buildNativeRasterMesh({
        bounds,
        sourceCenter: { re: snapshot.a0, im: snapshot.b0 },
        sourceSize: media,
        mapOptions: nativeImageMap(snapshot, map, true),
        pixelWidth: planeParams.width,
        pixelHeight: planeParams.height,
        buildFold: true,
        foldHeightScale: state.foldSurfaceHeightScale
    });

    return {
        ...mesh,
        bounds,
        sourceCenter: { re: snapshot.a0, im: snapshot.b0 },
        sourceSize: media
    };
}

function getMeshKeys(currentShape, planeParams, isWP, snapshot, map, pixelWidth, pixelHeight, chainIndex = null) {
    const bounds = getViewBounds(planeParams);
    const precise = planeParams.preciseViewport;
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
    const common = [
        currentShape,
        isWP ? 1 : 0,
        snapshot.a0,
        snapshot.b0,
        precise?.centerRe ?? bounds.x0,
        precise?.centerIm ?? bounds.x1,
        precise?.zoomPower ?? bounds.y0,
        precise?.precisionBits ?? bounds.y1,
        media.width,
        media.height,
        pixelWidth,
        pixelHeight
    ];

    const meshKey = [
        ...common,
        snapshot.zetaContinuationEnabled ? 1 : 0,
        transformSignature
    ].join('|');
    return meshKey;
}

function uploadForwardMesh(renderer, mesh) {
    const gl = renderer.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.forwardVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.forwardMappedBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.mappedPositions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, renderer.forwardIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    renderer.forwardIndexCount = mesh.indices.length;
    renderer.forwardIndexType = gl.UNSIGNED_SHORT;
    renderer.forwardMesh = mesh;
}

function getRasterRenderStage(map, chainIndex = null) {
    if (Number.isFinite(map?.stage) || Number.isFinite(chainIndex)) {
        return getImageRenderChainIndex(Number.isFinite(chainIndex) ? chainIndex : 0, map);
    }

    return state.chainingEnabled
        ? normalizeChainIndex((state.chainCount || 1) - 1)
        : 0;
}

function configureAttribute(gl, location, size, buffer) {
    if (location < 0 || !buffer) return false;

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    return true;
}

function bindInverseGeometry(renderer, locs) {
    const gl = renderer.gl;

    const vaoBound = bindOrCreateVao(renderer, 'inverseVao', () => {
        return configureAttribute(gl, locs.aPosition, 2, renderer.quadBuffer);
    });

    return vaoBound || configureAttribute(gl, locs.aPosition, 2, renderer.quadBuffer);
}

function configureForwardGeometry(renderer, locs) {
    const gl = renderer.gl;
    if (!configureAttribute(gl, locs.aTexCoord, 2, renderer.forwardVertexBuffer)) return false;
    if (!configureAttribute(gl, locs.aMappedPos, 2, renderer.forwardMappedBuffer)) return false;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, renderer.forwardIndexBuffer);
    return true;
}

function bindForwardGeometry(renderer, locs) {
    return bindOrCreateVao(
        renderer,
        'forwardVao',
        () => configureForwardGeometry(renderer, locs)
    ) || configureForwardGeometry(renderer, locs);
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

    const meshReady = ensureForwardMesh(renderer, planeParams, isWP, currentShape, snapshot, map, chainIndex);
    if (!meshReady) return false;
    if (!renderer.forwardIndexCount) return true;

    const gl = renderer.gl;
    const locs = renderer.forwardLocs;

    gl.useProgram(renderer.forwardProgram);
    if (!bindForwardGeometry(renderer, locs)) {
        unbindVao(renderer);
        return false;
    }

    if (hasUniform(locs.uTexture)) gl.uniform1i(locs.uTexture, 0);
    gl.uniform1f(locs.uOpacity, getRasterOpacityForShape(currentShape));
    gl.uniform1f(locs.uAlphaCutoff, DEFAULT_ALPHA_CUTOFF);

    gl.drawElements(gl.TRIANGLES, renderer.forwardIndexCount, renderer.forwardIndexType, 0);

    unbindVao(renderer);
    return true;
}

function isInverseImageRenderSupportedForSnapshot(snapshot) {
    if (!snapshot) return false;
    if (snapshot.chainingMode === 'zero_seed') return false;
    if (!IMAGE_INVERSE_FUNCTIONS.has(snapshot.currentFunction)) return false;
    const naturalBase = value => Math.abs((value?.re ?? Math.E) - Math.E) < 1e-12 && Math.abs(value?.im || 0) < 1e-12;
    if (snapshot.currentFunction === 'exp' && !naturalBase(snapshot.expBase)) return false;
    if (snapshot.currentFunction === 'ln' && !naturalBase(snapshot.logBase)) return false;

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
        forwardLocs: getForwardLocs(gl, programs.forwardProgram),
        forwardVertexBuffer: resources.forwardVertexBuffer,
        forwardIndexBuffer: resources.forwardIndexBuffer,
        forwardMappedBuffer: resources.forwardMappedBuffer,
        forwardVao: null,

        uploadedSource: null,
        uploadedSourceToken: -1,

        forwardIndexCount: 0,
        forwardIndexType: gl.UNSIGNED_SHORT,
        forwardMeshKey: '',
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
        deleteRendererVao(renderer, 'forwardVao');

        deleteRendererResources(gl, renderer);
        deleteImagePrograms(gl, renderer);
    }

    renderer.texture = null;
    renderer.quadBuffer = null;
    renderer.forwardVertexBuffer = null;
    renderer.forwardIndexBuffer = null;
    renderer.forwardMappedBuffer = null;
    renderer.inverseProgram = null;
    renderer.forwardProgram = null;
    renderer.inverseLocs = null;
    renderer.forwardLocs = null;
    renderer.uploadedSource = null;
    renderer.uploadedSourceToken = -1;
    renderer.forwardIndexCount = 0;
    renderer.forwardMesh = null;
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

export function ensureForwardMesh(renderer, planeParams, isWP, currentShape, snapshot, map, chainIndex = null) {
    if (!isContextUsable(renderer)) return false;
    if (!planeParams) return false;

    const frame = snapshot || readRenderState();
    const shape = currentShape ?? frame.currentInputShape;
    const pixelWidth = Math.max(1, renderer.canvas.width || planeParams.width || 1024);
    const pixelHeight = Math.max(1, renderer.canvas.height || planeParams.height || 1024);
    const meshKey = getMeshKeys(
        shape, planeParams, Boolean(isWP), frame, map, pixelWidth, pixelHeight, chainIndex
    );

    if (renderer.forwardMeshKey === meshKey && renderer.forwardMesh) return true;

    const bounds = getViewBounds(planeParams);
    if (!planeParams.preciseViewport && !hasUsableBounds(bounds)) return false;

    const media = getRasterDisplayDimensions(shape);
    const mesh = buildNativeRasterMesh({
        bounds: { ...bounds },
        sourceCenter: { re: frame.a0, im: frame.b0 },
        sourceSize: media,
        mapOptions: nativeImageMap(frame, map, Boolean(isWP), chainIndex),
        preciseViewport: planeParams.preciseViewport,
        pixelWidth,
        pixelHeight,
        maxVertices: ADAPTIVE_MAX_VERTICES,
        maxCells: ADAPTIVE_MAX_CELLS
    });

    uploadForwardMesh(renderer, mesh);
    renderer.forwardMeshKey = meshKey;
    return true;
}

export function drawImageWithWebGL(targetCtx, planeParams, isWP, chainIndex, map = null) {
    const snapshot = readRenderState();
    const effectiveChainIndex = getImageRenderChainIndex(chainIndex, map);

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

    const rendered = !planeParams.preciseViewport && map?.presentation !== 'derivative' &&
        shouldUseInverseImagePath(isWP, snapshot, effectiveChainIndex)
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
