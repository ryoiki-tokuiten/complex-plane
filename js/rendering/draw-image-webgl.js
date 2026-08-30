import { state } from '../store/state.js';
import { createWebGLProgramShared } from './webgl-shared.js';
import { buildNativeImageMesh, nativeMapOptions } from '../native/complex-engine.js';
import { nativeOptionsForActiveMap } from '../native/map-runtime.js';
import { requireVisibleViewport } from '../utils/viewport.js';

const DEFAULT_ALPHA_CUTOFF = 0.05;
const ADAPTIVE_BASE_RESOLUTION = 16;
const ADAPTIVE_MAX_DEPTH = 5;
const ADAPTIVE_MAX_CELLS = 8192;
const ADAPTIVE_MAX_VERTICES = 32768;
const ADAPTIVE_MAX_SAMPLES = 65536;

const webglImageSupport = { renderer: null };

function createRenderCanvas() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', {
        antialias: false,
        alpha: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance'
    });
    if (!gl) throw new Error('Native raster rendering requires WebGL.');
    return { canvas, gl };
}

function createVertexArrayRegistry(gl) {
    const extension = gl.getExtension('OES_vertex_array_object');
    if (!extension) throw new Error('Native raster rendering requires OES_vertex_array_object.');
    return {
        create: () => extension.createVertexArrayOES(),
        bind: vao => extension.bindVertexArrayOES(vao),
        delete: vao => { if (vao) extension.deleteVertexArrayOES(vao); }
    };
}

function createTexture(gl) {
    const texture = gl.createTexture();
    if (!texture) throw new Error('Unable to allocate the native raster texture.');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255])
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
    if (!anisotropy) throw new Error('Native raster rendering requires anisotropic texture filtering.');
    const maximum = gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    if (!Number.isFinite(maximum) || maximum < 1) {
        throw new Error('Native raster rendering received an invalid anisotropy limit.');
    }
    gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maximum));
    return texture;
}

function createBuffer(gl) {
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Unable to allocate native raster geometry buffers.');
    return buffer;
}

function vertexShader() {
    return [
        'attribute vec2 a_texCoord;',
        'attribute vec2 a_mappedPos;',
        'varying vec2 v_uv;',
        'void main() {',
        '  v_uv = a_texCoord;',
        '  gl_Position = vec4(a_mappedPos, 0.0, 1.0);',
        '}'
    ].join('\n');
}

function fragmentShader() {
    return [
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
    ].join('\n');
}

function createRenderer() {
    const { canvas, gl } = createRenderCanvas();
    const program = createWebGLProgramShared(gl, vertexShader(), fragmentShader());
    const renderer = {
        canvas,
        gl,
        program,
        locations: {
            texCoord: gl.getAttribLocation(program, 'a_texCoord'),
            mappedPosition: gl.getAttribLocation(program, 'a_mappedPos'),
            texture: gl.getUniformLocation(program, 'u_texture'),
            opacity: gl.getUniformLocation(program, 'u_opacity'),
            alphaCutoff: gl.getUniformLocation(program, 'u_alphaCutoff')
        },
        texture: createTexture(gl),
        textureCoordinates: createBuffer(gl),
        mappedPositions: createBuffer(gl),
        indices: createBuffer(gl),
        vao: createVertexArrayRegistry(gl),
        geometryVao: null,
        uploadedSource: null,
        uploadedSourceToken: -1,
        meshKey: '',
        mesh: null,
        indexCount: 0,
        contextLost: false,
        disposed: false
    };
    canvas.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        renderer.contextLost = true;
    });
    return renderer;
}

function renderer() {
    if (!webglImageSupport.renderer) webglImageSupport.renderer = createRenderer();
    const active = webglImageSupport.renderer;
    if (active.disposed || active.contextLost || active.gl.isContextLost()) {
        throw new Error('The native raster WebGL context is unavailable.');
    }
    return active;
}

function viewBounds(planeParams) {
    requireVisibleViewport(planeParams, 'Native raster viewport');
    const xRange = planeParams.currentVisXRange;
    const yRange = planeParams.currentVisYRange;
    return {
        x0: xRange[0], x1: xRange[1], y0: yRange[0], y1: yRange[1],
        xSpan: xRange[1] - xRange[0], ySpan: yRange[1] - yRange[0]
    };
}

export function getImageRenderStage(map) {
    if (!Number.isInteger(map?.stage) || map.stage < 0) {
        throw new Error('Native raster rendering requires a resolved non-negative map stage.');
    }
    return map.stage;
}

function rasterMapOptions(map, isWPlane) {
    if (!isWPlane) {
        return nativeMapOptions(state, {
            functionKey: 'identity',
            chainingEnabled: false,
            chainCount: 1,
            derivativeOrder: 0
        });
    }
    if (!map) throw new Error('Transformed raster rendering requires an active native map.');
    getImageRenderStage(map);
    return nativeOptionsForActiveMap(map);
}

function buildNativeRasterMesh({
    bounds,
    sourceCenter,
    sourceSize,
    mapOptions,
    pixelWidth,
    pixelHeight,
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
        baseResolution: ADAPTIVE_BASE_RESOLUTION,
        maxDepth: ADAPTIVE_MAX_DEPTH,
        maxCells: ADAPTIVE_MAX_CELLS,
        maxVertices: ADAPTIVE_MAX_VERTICES,
        maxSamples: ADAPTIVE_MAX_SAMPLES,
        buildFold,
        foldHeightScale,
        preciseViewport
    });
}

export function buildRasterSurfaceMesh(planeParams, map, raster) {
    const sourceSize = raster.size;
    if (!(sourceSize.width > 0) || !(sourceSize.height > 0)) {
        throw new Error('Native raster rendering requires positive media dimensions.');
    }
    const bounds = viewBounds(planeParams);
    const mesh = buildNativeRasterMesh({
        bounds,
        sourceCenter: raster.center,
        sourceSize,
        mapOptions: rasterMapOptions(map, true, null),
        pixelWidth: planeParams.width,
        pixelHeight: planeParams.height,
        buildFold: true,
        foldHeightScale: state.foldSurfaceHeightScale,
        preciseViewport: planeParams.preciseViewport
    });
    return {
        ...mesh,
        bounds,
        sourceCenter: raster.center,
        sourceSize
    };
}

function meshKey(planeParams, map, isWPlane, width, height, raster) {
    const bounds = viewBounds(planeParams);
    const sourceSize = raster.size;
    const precise = planeParams.preciseViewport;
    return [
        isWPlane ? map.signature : 'identity',
        isWPlane ? getImageRenderStage(map) : 0,
        raster.center.re, raster.center.im,
        precise?.centerRe ?? bounds.x0,
        precise?.centerIm ?? bounds.x1,
        precise?.zoomPower ?? bounds.y0,
        precise?.precisionBits ?? bounds.y1,
        sourceSize.width, sourceSize.height,
        width, height
    ].join('|');
}

function uploadMesh(active, mesh, key) {
    const gl = active.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, active.textureCoordinates);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, active.mappedPositions);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.mappedPositions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, active.indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    active.mesh = mesh;
    active.meshKey = key;
    active.indexCount = mesh.indices.length;
    if (active.geometryVao) {
        active.vao.delete(active.geometryVao);
        active.geometryVao = null;
    }
}

function ensureMesh(active, planeParams, map, isWPlane, width, height, raster) {
    const key = meshKey(planeParams, map, isWPlane, width, height, raster);
    if (active.meshKey === key && active.mesh) return;
    const mesh = buildNativeRasterMesh({
        bounds: viewBounds(planeParams),
        sourceCenter: raster.center,
        sourceSize: raster.size,
        mapOptions: rasterMapOptions(map, isWPlane),
        preciseViewport: planeParams.preciseViewport,
        pixelWidth: width,
        pixelHeight: height
    });
    uploadMesh(active, mesh, key);
}

function configureAttribute(gl, location, buffer) {
    if (location < 0) throw new Error('Native raster compositor is missing a geometry attribute.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
}

function bindGeometry(active) {
    const configure = () => {
        configureAttribute(active.gl, active.locations.texCoord, active.textureCoordinates);
        configureAttribute(active.gl, active.locations.mappedPosition, active.mappedPositions);
        active.gl.bindBuffer(active.gl.ELEMENT_ARRAY_BUFFER, active.indices);
    };
    if (!active.geometryVao) {
        active.geometryVao = active.vao.create();
        if (!active.geometryVao) throw new Error('Unable to allocate the native raster vertex array.');
        active.vao.bind(active.geometryVao);
        configure();
    } else active.vao.bind(active.geometryVao);
}

function uploadTexture(active, raster) {
    if (active.uploadedSource === raster.source && active.uploadedSourceToken === raster.token) return;
    const gl = active.gl;
    gl.bindTexture(gl.TEXTURE_2D, active.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, raster.source);
    active.uploadedSource = raster.source;
    active.uploadedSourceToken = raster.token;
}

export function drawRasterWithWebGL(targetCtx, planeParams, isWPlane, map, raster) {
    if (!raster) return false;
    if (typeof HTMLVideoElement !== 'undefined' && raster.source instanceof HTMLVideoElement &&
        (raster.source.readyState < 2 || !raster.source.videoWidth || !raster.source.videoHeight)) return false;
    if (!targetCtx?.canvas || typeof targetCtx.drawImage !== 'function') {
        throw new Error('Native raster rendering requires a drawable 2D target context.');
    }
    const active = renderer();
    const width = targetCtx.canvas.width;
    const height = targetCtx.canvas.height;
    if (!(width > 0) || !(height > 0)) throw new Error('Native raster rendering requires a positive target size.');
    if (active.canvas.width !== width) active.canvas.width = width;
    if (active.canvas.height !== height) active.canvas.height = height;

    uploadTexture(active, raster);
    ensureMesh(active, planeParams, map, Boolean(isWPlane), width, height, raster);

    const gl = active.gl;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, active.texture);
    gl.useProgram(active.program);
    bindGeometry(active);
    gl.uniform1i(active.locations.texture, 0);
    gl.uniform1f(active.locations.opacity, raster.opacity);
    gl.uniform1f(active.locations.alphaCutoff, DEFAULT_ALPHA_CUTOFF);
    if (active.indexCount) gl.drawElements(gl.TRIANGLES, active.indexCount, gl.UNSIGNED_SHORT, 0);
    active.vao.bind(null);
    targetCtx.drawImage(active.canvas, 0, 0, width, height);
    return true;
}
