import { domainArithmetic } from './arithmetic.js';
import { domainLayout, domainVertex, domainFragment, stateInputs, domainRegisters } from './program.js';

const fullscreenVertex = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`;
const resolveFragment = `#version 300 es
precision highp float;
uniform sampler2D u_color,u_done;
uniform int u_width,u_height;
out vec4 color;
void main(){ivec2 p=ivec2(gl_FragCoord.xy);p.y=u_height-1-p.y;int id=(p.y*u_width+p.x)*4;int w=textureSize(u_color,0).x;vec3 sum=vec3(0.0);float valid=0.0;for(int s=0;s<4;s++){ivec2 q=ivec2((id+s)%w,(id+s)/w);if(texelFetch(u_done,q,0).r>=0.5){sum+=texelFetch(u_color,q,0).rgb;valid+=1.0;}}if(valid<0.5){color=vec4(0.0);}else{color=vec4(sum/valid,1.0);}}`;
export function domainColorVertex(layout, paletteCount, derivative) {
    const { state } = layout;
    const inputs = stateInputs(state, derivative ? 2 : 1);
    return `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_header;
uniform ivec2 u_sampleSize;
uniform float u_tolerance;
${inputs.declarations}
layout(location=${state*(derivative ? 2 : 1)/4}) in highp uvec2 inputSampleInfo;
${domainArithmetic}
uniform int u_mode,u_depth;
uniform vec3 u_palette[${paletteCount}];
uniform vec4 u_style;
out vec4 color;
B stateB(int at){vec4 v=inputState[at/4];return B(v.xy,inputState[at/4+1].xy,v.z,v.w);}
B headerB(int at){int w=textureSize(u_header,0).x;vec4 v=texelFetch(u_header,ivec2(at%w,at/w),0);vec4 low=texelFetch(u_header,ivec2((at+1)%w,(at+1)/w),0);return B(v.xy,low.xy,v.z,v.w);}
void main(){
 ${inputs.assign}
 gl_Position=vec4(2.0,2.0,0.0,1.0);gl_PointSize=1.0;color=vec4(0.0);
 int id=int(inputSampleInfo.x)/${derivative ? 2 : 1};if(inputState[2].y!=1.0)return;
 B value=stateB(0);
 ${derivative ? `
 if(inputState[${state/4+2}].y!=1.0)return;
 value=bmul(bsub(stateB(${state}),value),headerB(int(inputState[2].z)*13+10));
 if(!accurate(value,u_tolerance))return;` : ''}
 vec2 z=value.v+value.lo;
 gl_Position=vec4((vec2(id%u_sampleSize.x,id/u_sampleSize.x)+0.5)/vec2(u_sampleSize)*2.0-1.0,0.0,1.0);
 float arg=all(equal(z,vec2(0.0)))?0.0:atan(z.y,z.x);
 float lm=length(z)==0.0?-1.0e30:log(length(z))+value.e*0.6931471805599453;
 float event=inputState[2].w;
 if((u_mode==1&&event<=0.0)||(u_mode==2&&event>=0.0)){color=vec4(0.0,0.0,0.0,1.0);return;}
 float hue=fract(arg/6.283185307179586);
 if(event>0.0&&u_mode!=0)hue=clamp(event/float(u_depth),0.0,1.0);
 if(event<0.0&&u_mode!=0)hue=fract(-event*0.618033988749895);
 float position=hue*float(${paletteCount - 1});int index=min(${paletteCount - 2},int(floor(position)));
 vec3 rgb=mix(u_palette[index],u_palette[index+1],position-float(index));
 float lightness=u_style.w<=0.0001?0.5:0.34+0.38*clamp(0.5+(clamp((lm+69.07755278982137)/138.15510557964274,0.0,1.0)-0.5)*max(0.05,u_style.w),0.0,1.0);
 if(event!=0.0&&u_mode!=0)lightness=0.22+0.58*pow(clamp(abs(event)/float(u_depth),0.0,1.0),0.65);
 lightness=clamp((0.5+(lightness-0.5)*u_style.y)*u_style.x,0.05,0.95);
 rgb=mix(vec3(dot(rgb,vec3(0.299,0.587,0.114))),rgb,clamp(u_style.z,0.0,1.0));
 rgb=lightness<0.5?rgb*(2.0*lightness):mix(rgb,vec3(1.0),(lightness-0.5)*2.0);
 color=vec4(rgb,1.0);
}`;
}

const colorFragment = `#version 300 es
precision highp float;
in vec4 color;
layout(location=0) out vec4 outColor;
layout(location=1) out vec4 done;
void main(){outColor=color;done=vec4(1.0);}`;

export class DomainGpu {
    constructor(canvas) {
        this.canvas = canvas;
        const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false, preserveDrawingBuffer: false });
        if (!gl) throw new Error('Domain coloring requires WebGL2.');
        this.gl = gl;
        this.resources = [];
        this.textureSizes = new WeakMap();
        this.uniformLocations = new WeakMap();
        this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        this.maxAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
        this.inputVaos = [this.own('VertexArray'), this.own('VertexArray')];
        this.feedback = this.own('TransformFeedback');
        this.emptyVao = this.own('VertexArray');
        this.stateBuffers = [this.own('Buffer'), this.own('Buffer')];
        this.sampleIdBuffer = this.own('Buffer');
        this.bufferCapacity = 0;
        this.attributeCounts = [0, 0];
        this.readIndex = 0;
        this.framebuffer = this.own('Framebuffer');
        this.resolve = this.program(fullscreenVertex, resolveFragment);
    }
    begin(snapshot) {
        const gl = this.gl;
        if (gl.isContextLost()) throw new Error('Domain GPU context was lost.');
        this.snapshot = snapshot;
        this.width = snapshot.viewport.width;
        this.height = snapshot.viewport.height;
        this.lanes = snapshot.derivativeOrder ? 2 : 1;
        this.logicalSamples = this.width * this.height * 4;
        this.samples = this.logicalSamples * this.lanes;
        this.pendingSamples = null;
        const width = Math.min(this.maxTexture, Math.max(4, this.width * 2));
        const height = Math.ceil(this.logicalSamples / width);
        if (this.width > this.maxTexture || this.height > this.maxTexture || height > this.maxTexture) throw new Error('Requested domain resolution exceeds GPU limits.');
        if (this.canvas.width !== this.width) this.canvas.width = this.width;
        if (this.canvas.height !== this.height) this.canvas.height = this.height;
        if (this.sampleWidth !== width || this.sampleHeight !== height) {
            this.release(this.color); this.release(this.done);
            this.color = this.texture(width, height, gl.RGBA8);
            this.done = this.texture(width, height, gl.RGBA8);
            this.sampleWidth = width; this.sampleHeight = height;
            this.statusBytes = new Uint8Array(width * height * 4);
            this.statusWords = new Uint32Array(this.statusBytes.buffer);
            this.pendingStorage = new Uint32Array(width * height);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.color, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.done, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Domain framebuffer is incomplete.');
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    release(object) {
        if (!object) return;
        const index = this.resources.findIndex(entry => entry[1] === object);
        if (index < 0) return;
        const [[kind]] = this.resources.splice(index, 1);
        this.gl[`delete${kind}`](object);
    }
    own(kind) {
        const object = this.gl[`create${kind}`]();
        if (!object) throw new Error(`Domain GPU could not allocate ${kind}.`);
        this.resources.push([kind, object]);
        return object;
    }
    texture(width, height, format, data = null) {
        const gl = this.gl, texture = this.own('Texture');
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, gl.RGBA, format === gl.RGBA8 ? gl.UNSIGNED_BYTE : gl.FLOAT, data);
        return texture;
    }
    program(vertex, fragment, feedback = false) {
        const gl = this.gl, program = this.own('Program');
        for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source); gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader);
                throw new Error(`Domain shader compilation failed: ${message}`);
            }
            gl.attachShader(program, shader); gl.deleteShader(shader);
        }
        if (feedback) gl.transformFeedbackVaryings(program, Array.from({length: feedback}, (_, i) => `state${i}`), gl.INTERLEAVED_ATTRIBS);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Domain shader link failed: ${gl.getProgramInfoLog(program)}`);
        return program;
    }
    bind(program, name, texture, unit) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(this.uniform(program, name), unit);
    }
    uniform(program, name) {
        let locations = this.uniformLocations.get(program);
        if (!locations) { locations = new Map(); this.uniformLocations.set(program, locations); }
        if (!locations.has(name)) locations.set(name, this.gl.getUniformLocation(program, name));
        return locations.get(name);
    }
    floats(data, previous = null) {
        const gl = this.gl, width = Math.min(this.maxTexture, Math.max(1, Math.ceil(data.length / 4)));
        const height = Math.ceil(data.length / (4 * width));
        if (height > this.maxTexture) throw new Error('Domain reference data exceeds GPU texture limits.');
        const padded = data.length === width * height * 4 ? data : new Float32Array(width * height * 4);
        if (padded !== data) padded.set(data);
        const texture = previous ?? this.own('Texture');
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        const size = this.textureSizes.get(texture);
        if (size?.width === width && size.height === height) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.FLOAT, padded);
        else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, padded);
            this.textureSizes.set(texture, { width, height });
        }
        return texture;
    }
    prepare(program, terms, header, coefficients, activeSamples = null, activeRefIndices = null) {
        const gl = this.gl;
        const mode = this.lanes === 2 ? 0 : ['value','escape','attractor','hybrid'].indexOf(this.snapshot.orbitColoringMode);
        const graphKey = JSON.stringify([Array.from(program.nodes), program.output, mode, this.snapshot.paletteStops.length, this.lanes]);
        if (this.graphKey !== graphKey) {
            if (this.variant) {
                this.release(this.variant.program); this.release(this.variant.colorProgram); this.release(this.variant.nodes);
            }
            this.variant = null; this.graphKey = graphKey;
        }
        let variant = this.variant;
        if (!variant) {
            const layout = domainLayout(program.nodes, terms, mode === 2 || mode === 3);
            if (layout.state > gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS) || layout.state * this.lanes / 4 + 1 > this.maxAttributes) throw new Error('Requested domain precision exceeds GPU attribute limits.');
            variant = {
                ...layout, terms: null, mode,
                program: this.program(domainVertex(program, terms, mode, this.lanes === 2), domainFragment, layout.state / 4),
                colorProgram: this.program(domainColorVertex(layout, this.snapshot.paletteStops.length, this.lanes === 2), colorFragment)
            };
        }
        if (variant.terms !== terms) {
            Object.assign(variant, domainLayout(program.nodes, terms, mode === 2 || mode === 3), { terms });
            const registers = domainRegisters(program.nodes, program.output);
            const metadata = new Float32Array(program.nodes.length * 3);
            for (let i = 0; i < program.nodes.length / 4; i++) {
                metadata.set(program.nodes.subarray(i * 4, i * 4 + 4), i * 12);
                const [destination, a, b, aux] = registers.instructions[i];
                metadata.set([variant.offsets[i], destination, a, b, aux], i * 12 + 4);
            }
            variant.nodes = this.floats(metadata, variant.nodes);
            variant.nodesCount = program.nodes.length / 4;
        }
        this.activeLogicalSamples = activeSamples ? activeSamples.length : (this.pendingSamples?.length ?? this.logicalSamples);
        this.activeSamples = this.activeLogicalSamples * this.lanes;
        const ids = new Uint32Array(this.activeSamples * 2);
        for (let i = 0; i < this.activeLogicalSamples; i++) {
            const logical = activeSamples ? activeSamples[i] : (this.pendingSamples ? this.pendingSamples[i] : i);
            const ref = activeRefIndices ? activeRefIndices[i] : 0;
            for (let lane = 0; lane < this.lanes; lane++) {
                ids[(i * this.lanes + lane) * 2] = logical * this.lanes + lane;
                ids[(i * this.lanes + lane) * 2 + 1] = ref;
            }
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sampleIdBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW);
        const bytes = this.activeSamples * variant.state * 4;
        if (bytes > this.bufferCapacity) {
            for (const buffer of this.stateBuffers) {
                gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_COPY);
            }
            this.bufferCapacity = bytes;
        }
        this.variant = variant;
        this.header = this.floats(header, this.header);
        this.coefficients = this.floats(coefficients, this.coefficients);
        this.referenceCount = header.length / 52;
        this.tolerance = Math.min(2 ** -16, 1 / (64 * Math.max(this.width, this.height)));
    }
    inputs(buffer, components, lanes = 1) {
        const gl = this.gl;
        const index = this.stateBuffers.indexOf(buffer);
        gl.bindVertexArray(this.inputVaos[index]);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        for (let i = 0; i < components / 4; i++) {
            gl.enableVertexAttribArray(i);
            gl.vertexAttribPointer(i, 4, gl.FLOAT, false, components * 4, i * 16);
        }
        const idLocation = components / 4;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sampleIdBuffer);
        gl.enableVertexAttribArray(idLocation);
        gl.vertexAttribIPointer(idLocation, 2, gl.UNSIGNED_INT, lanes * 8, 0);
        for (let i = idLocation + 1; i < this.attributeCounts[index]; i++) gl.disableVertexAttribArray(i);
        this.attributeCounts[index] = idLocation + 1;
    }
    async batch(data, { initial, iteration, count, depth, publish }) {
        const gl = this.gl, v = this.variant, p = v.program;
        this.reference = this.floats(data, this.reference);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.width, this.height);
        gl.useProgram(p);
        gl.uniform1ui(this.uniform(p, 'u_roundingBarrier'), 0);
        this.bind(p, 'u_reference', this.reference, 0); this.bind(p, 'u_header', this.header, 1);
        this.bind(p, 'u_nodes', v.nodes, 4); this.bind(p, 'u_coefficients', this.coefficients, 3);
        for (const [key, value] of Object.entries({ u_batch: count, u_nodesCount: v.nodesCount, u_references: this.referenceCount, u_activeCount: this.activeLogicalSamples, TERMS: v.terms, u_stride: v.stride, u_iteration: iteration, u_depth: depth, u_width: this.width, u_initial: initial ? 1 : 0, u_zeroSeed: this.snapshot.chainingEnabled && this.snapshot.chainMode === 'zero_seed' ? 1 : 0 })) gl.uniform1i(this.uniform(p, key), value);
        gl.uniform1f(this.uniform(p, 'u_tolerance'), this.tolerance);
        this.inputs(this.stateBuffers[this.readIndex], v.state);
        const outputIndex = 1 - this.readIndex;
        this.check('prepare evaluation');
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.feedback);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.stateBuffers[outputIndex]);
        gl.enable(gl.RASTERIZER_DISCARD); gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, this.activeSamples); gl.endTransformFeedback(); gl.disable(gl.RASTERIZER_DISCARD);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
        this.check('evaluate samples');
        this.readIndex = outputIndex;
        if (publish) {
            const cp = v.colorProgram; gl.useProgram(cp);
            gl.uniform1ui(this.uniform(cp, 'u_roundingBarrier'), 0);
            this.inputs(this.stateBuffers[this.readIndex], v.state * this.lanes, this.lanes);
            this.bind(cp, 'u_header', this.header, 1);
            gl.uniform1f(this.uniform(cp, 'u_tolerance'), this.tolerance);
            gl.uniform2i(this.uniform(cp, 'u_sampleSize'), this.sampleWidth, this.sampleHeight);
            gl.uniform1i(this.uniform(cp, 'u_mode'), v.mode); gl.uniform1i(this.uniform(cp, 'u_depth'), depth);
            gl.uniform3fv(this.uniform(cp, 'u_palette[0]'), this.snapshot.paletteStops.flat());
            const s = this.snapshot.style; gl.uniform4f(this.uniform(cp, 'u_style'), s.brightness, s.contrast, s.saturation, s.lightnessCycles);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer); gl.viewport(0, 0, this.sampleWidth, this.sampleHeight); gl.drawArrays(gl.POINTS, 0, this.activeLogicalSamples);
        }
        this.check('color samples');
        if (!publish) return;
        gl.flush();
        if (gl.isContextLost()) throw new Error('Domain GPU context was lost.');
    }
    check(operation) {
        const error = this.gl.getError();
        if (error !== this.gl.NO_ERROR) throw new Error(`Domain GPU failed to ${operation} (${error}).`);
    }
    progress() {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer); gl.readBuffer(gl.COLOR_ATTACHMENT1);
        gl.readPixels(0, 0, this.sampleWidth, this.sampleHeight, gl.RGBA, gl.UNSIGNED_BYTE, this.statusBytes);
        let completed = 0;
        let pendingCount = 0;
        const words = this.statusWords;
        const storage = this.pendingStorage;
        const total = this.logicalSamples;
        const lanes = this.lanes;
        for (let i = 0; i < total; i++) {
            if (words[i] !== 0) completed += lanes;
            else storage[pendingCount++] = i;
        }
        this.pendingSamples = storage.subarray(0, pendingCount);
        return { completedSamples: completed, totalSamples: this.samples };
    }

    present() {
        const gl = this.gl, p = this.resolve;
        gl.bindVertexArray(this.emptyVao);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.width, this.height); gl.useProgram(p);
        gl.uniform1ui(this.uniform(p, 'u_roundingBarrier'), 0);
        this.bind(p, 'u_color', this.color, 0); this.bind(p, 'u_done', this.done, 1);
        gl.uniform1i(this.uniform(p, 'u_width'), this.width); gl.uniform1i(this.uniform(p, 'u_height'), this.height); gl.drawArrays(gl.TRIANGLES, 0, 3);
        return this.canvas.transferToImageBitmap();
    }
    dispose() {
        for (const [kind, object] of this.resources.reverse()) this.gl[`delete${kind}`](object);
        this.resources.length = 0;
        this.variant = null;
    }
}
