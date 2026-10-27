import { domainFragment } from './domain-observer.js';

const VERTEX = `#version 300 es
precision highp float;
void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const SAMPLE_VERTEX = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uSize;
void main() {
    ivec2 pixel=ivec2(gl_VertexID%int(uSize.x),gl_VertexID/int(uSize.x));
    gl_Position=vec4((vec2(pixel)+0.5)/uSize*2.0-1.0,0.0,1.0);
    gl_PointSize=1.0;
}`;

const RESOLVE = `
uniform sampler2D uCenter,uAA0,uAA1,uAA2,uAA3;
uniform ivec2 uSize;
vec4 resolved(ivec2 p) {
    vec4 center=texelFetch(uCenter,p,0);
    if(center.a!=1.0) return center;
    bool edge=false;
    for(int i=0;i<4;i++) {
        ivec2 d=i==0 ? ivec2(-1,0) : i==1 ? ivec2(1,0) : i==2 ? ivec2(0,-1) : ivec2(0,1),q=p+d;
        if(any(lessThan(q,ivec2(0))) || any(greaterThanEqual(q,uSize))) continue;
        vec4 neighbor=texelFetch(uCenter,q,0);
        if(neighbor.a!=1.0) return neighbor;
        edge=edge || any(greaterThanEqual(abs(center.rgb-neighbor.rgb),vec3(79.5/255.0)));
    }
    if(!edge) return center;
    vec4 a=texelFetch(uAA0,p,0),b=texelFetch(uAA1,p,0),c=texelFetch(uAA2,p,0),d=texelFetch(uAA3,p,0);
    if(a.a!=1.0) return a; if(b.a!=1.0) return b; if(c.a!=1.0) return c; if(d.a!=1.0) return d;
    return vec4((a.rgb+b.rgb+c.rgb+d.rgb)*0.25,1.0);
}`;
const PRESENT = `#version 300 es
precision highp float;
precision highp int;
${RESOLVE}
out vec4 outColor;
void main(){ vec4 color=resolved(ivec2(gl_FragCoord.xy)); outColor=color.a==1.0 ? color : vec4(0.0); }
`;
const ACCEPTED = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uImage;
out float accepted;
void main(){ accepted=texelFetch(uImage,ivec2(gl_FragCoord.xy),0).a==1.0 ? 1.0 : 0.0; }
`;
const REDUCE = `#version 300 es
precision highp float;
precision highp int;
${RESOLVE}
uniform highp usampler2D uPrevious;
uniform ivec2 uPreviousSize;
uniform bool uFirst;
out uvec4 outStatus;
void main(){
    ivec2 start=ivec2(gl_FragCoord.xy)*4; uvec2 count=uvec2(0u);
    for(int y=0;y<4;y++) for(int x=0;x<4;x++) {
        ivec2 p=start+ivec2(x,y); if(any(greaterThanEqual(p,uPreviousSize))) continue;
        if(uFirst) { float a=resolved(p).a; count+=uvec2(a!=1.0 ? 1u : 0u,a>0.0 && a<1.0 ? 1u : 0u); }
        else count+=texelFetch(uPrevious,p,0).xy;
    }
    outStatus=uvec4(count,0u,0u);
}`;
function beginProgram(gl, fragment, vertex = VERTEX) {
    const shaders = []; let handle = null;
    try {
        for (const [kind, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
            const shader = gl.createShader(kind); shaders.push(shader);
            gl.shaderSource(shader, source); gl.compileShader(shader);
        }
        handle = gl.createProgram(); shaders.forEach(shader => gl.attachShader(handle, shader));
        gl.linkProgram(handle);
        return { handle, shaders };
    } catch (error) {
        if (handle) gl.deleteProgram(handle);
        shaders.forEach(shader => gl.deleteShader(shader));
        throw error;
    }
}
function finishProgram(gl, compilation) {
    const { handle, shaders } = compilation;
    try {
        if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
            throw new Error(shaders.map(shader => gl.getShaderInfoLog(shader)).filter(Boolean).join('\n') || gl.getProgramInfoLog(handle));
        }
        return handle;
    } catch(error) { gl.deleteProgram(handle); throw error; }
    finally { shaders.forEach(shader => gl.deleteShader(shader)); }
}
function program(gl, fragment, vertex = VERTEX) {
    return finishProgram(gl, beginProgram(gl, fragment, vertex));
}

export class DomainWebGL {
    constructor(canvas) {
        this.canvas = canvas;
        const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
        if (!gl) throw new Error('Planar domain coloring requires WebGL 2.');
        this.gl = gl;
        if(gl.isContextLost()) throw new Error('The domain-coloring GPU context is unavailable.');
        this.textureLimit=gl.getParameter(gl.MAX_TEXTURE_SIZE);
        this.viewportLimit=gl.getParameter(gl.MAX_VIEWPORT_DIMS);
        if(!this.textureLimit || !this.viewportLimit) throw new Error('The domain-coloring GPU context is unavailable.');
        const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
        if (!precision || precision.precision < 23 || precision.rangeMax < 127) throw new Error('Domain rendering requires high-precision shader arithmetic.');
        this.parallelCompile = gl.getExtension('KHR_parallel_shader_compile');
        this.programs = []; this.evaluators = new Map(); this.textures = [];
        this.framebuffers = new Map();
        this.readback = null;
        try {
            this.programs.push(null);
            this.programs.push(program(gl, PRESENT));
            this.programs.push(program(gl, REDUCE));
            this.programs.push(program(gl, ACCEPTED));
            this.locations = this.programs.map(() => new Map());
            this.vao = gl.createVertexArray();
            gl.bindVertexArray(this.vao); gl.disable(gl.DITHER); gl.disable(gl.BLEND);
        } catch (error) { this.dispose(); throw error; }
    }
    uniform(index, name) {
        const cache = this.locations[index];
        if (!cache.has(name)) cache.set(name, this.gl.getUniformLocation(this.programs[index], name));
        return cache.get(name);
    }
    texture(width, height, internal, format, type, data = null) {
        const gl = this.gl, texture = gl.createTexture();
        this.textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data);
        return texture;
    }
    target(texture, width, height) {
        const gl = this.gl;
        if (!texture) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        else {
            let framebuffer = this.framebuffers.get(texture);
            if (!framebuffer) {
                framebuffer = gl.createFramebuffer(); this.framebuffers.set(texture, framebuffer);
                gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            } else gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        }
        gl.viewport(0, 0, width, height);
    }
    deleteTexture(texture) {
        if(!texture) return;
        this.gl.deleteFramebuffer(this.framebuffers.get(texture) ?? null); this.framebuffers.delete(texture);
        this.gl.deleteTexture(texture); this.textures.splice(this.textures.indexOf(texture),1);
    }
    reset(snapshot) {
        this.cancelReadback();
        const gl = this.gl;
        if(gl.isContextLost()) throw new Error('The domain-coloring GPU context is lost; rendering can resume after it is restored.');
        const resized=this.width!==snapshot.viewport.width || this.height!==snapshot.viewport.height;
        if(resized) {
            this.textures.forEach(texture => gl.deleteTexture(texture)); this.textures.length = 0;
            this.framebuffers.forEach(framebuffer => gl.deleteFramebuffer(framebuffer)); this.framebuffers.clear();
            this.samples=null; this.accepted=null; this.coverageLevels=null; this.palette=null; this.numbers=null; this.instructionTexture=null;
        }
        this.snapshot = snapshot;
        this.width = snapshot.viewport.width; this.height = snapshot.viewport.height;
        const limit = this.textureLimit, viewport = this.viewportLimit;
        if (this.width > Math.min(limit, viewport[0]) || this.height > Math.min(limit, viewport[1])) throw new Error('The requested full resolution exceeds this GPU’s texture or viewport limit.');
        if(resized) { this.canvas.width = this.width; this.canvas.height = this.height; }
        this.samples ??= Array.from({ length: 5 }, () => this.texture(this.width,this.height,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE));
        this.accepted ??= Array.from({ length: 5 }, () => this.texture(this.width,this.height,gl.R8,gl.RED,gl.UNSIGNED_BYTE));
        this.samples.forEach(texture => {
            this.target(texture,this.width,this.height);
            gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
        });
        this.accepted.forEach(texture => {
            this.target(texture,this.width,this.height);
            gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
        });
        const stops = snapshot.paletteStops, colors=Float32Array.from(stops.flatMap(stop => [...stop,1]));
        if(!this.palette || this.paletteLength!==stops.length) {
            this.deleteTexture(this.palette);
            this.palette=this.texture(stops.length,1,gl.RGBA32F,gl.RGBA,gl.FLOAT,colors);
            this.paletteLength=stops.length;
        } else {
            gl.bindTexture(gl.TEXTURE_2D,this.palette);
            gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,stops.length,1,gl.RGBA,gl.FLOAT,colors);
        }
        this.paletteSlope = Math.max(...stops.slice(1).flatMap((stop, i) => stop.map((v, c) => Math.abs(v - stops[i][c])))) * (stops.length - 1);
        this.paletteSeam = Math.max(...stops[0].map((v, c) => Math.abs(v - stops.at(-1)[c])));
        // Fixed 4x4 reductions keep the status work parallel at every screen
        // size. Only the final (single-pixel) level crosses back to the CPU.
        if(!this.coverageLevels) {
            this.coverageLevels = [];
            let width = this.width, height = this.height;
            do {
                width = Math.ceil(width / 4); height = Math.ceil(height / 4);
                const texture = this.texture(width, height, gl.RGBA32UI, gl.RGBA_INTEGER, gl.UNSIGNED_INT);
                this.target(texture, width, height);
                gl.clearBufferuiv(gl.COLOR, 0, new Uint32Array(4));
                this.coverageLevels.push({ texture, width, height });
            } while (width > 1 || height > 1);
            this.statusWidth = width; this.statusHeight = height;
            this.coveragePlaceholder = this.texture(1, 1, gl.RGBA32UI, gl.RGBA_INTEGER, gl.UNSIGNED_INT, new Uint32Array(4));
        }
        this.present();
    }
    prepare(compiled) {
        const gl=this.gl;
        gl.useProgram(this.programs[3]); gl.bindVertexArray(this.vao);
        gl.activeTexture(gl.TEXTURE0); gl.uniform1i(this.uniform(3,'uImage'),0);
        this.accepted.forEach((texture,sample) => {
            this.target(texture,this.width,this.height);
            gl.bindTexture(gl.TEXTURE_2D,this.samples[sample]); gl.drawArrays(gl.TRIANGLES,0,3);
        });
        this.numberWidth=Math.ceil((compiled.words+4)/4);
        this.words=compiled.words;
        this.programUniforms=compiled.uniforms;
        this.instructionCount=compiled.instructionCount;
        const limit=this.textureLimit;
        this.numberRows=Math.min(limit,compiled.numbers.length);
        const width=this.numberWidth*Math.ceil(compiled.numbers.length/this.numberRows);
        if(width>limit) throw new Error('The expression’s numerical data exceeds this GPU’s texture capacity.');
        if(!this.numbers || this.numberTextureWidth!==width || this.numberTextureHeight!==this.numberRows) {
            this.deleteTexture(this.numbers);
            this.numbers=this.texture(width,this.numberRows,gl.RGBA32UI,gl.RGBA_INTEGER,gl.UNSIGNED_INT);
            this.numberTextureWidth=width; this.numberTextureHeight=this.numberRows;
            // Initialize on the GPU once, before workers upload independent rows.
            this.target(this.numbers,width,this.numberRows);
            gl.clearBufferuiv(gl.COLOR,0,new Uint32Array(4));
        }
        const records=compiled.instructions.length/4;
        const programWidth=Math.min(limit,2**Math.ceil(Math.log2(records)));
        const programHeight=Math.ceil(records/programWidth);
        if(programHeight>limit) throw new Error('The expression exceeds this GPU’s instruction texture capacity.');
        const data=new Int32Array(programWidth*programHeight*4); data.set(compiled.instructions);
        if(!this.instructionTexture || this.instructionWidth!==programWidth || this.instructionHeight!==programHeight) {
            this.deleteTexture(this.instructionTexture);
            this.instructionTexture=this.texture(programWidth,programHeight,gl.RGBA32I,gl.RGBA_INTEGER,gl.INT,data);
            this.instructionWidth=programWidth; this.instructionHeight=programHeight;
        } else {
            gl.bindTexture(gl.TEXTURE_2D,this.instructionTexture);
            gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,programWidth,programHeight,gl.RGBA_INTEGER,gl.INT,data);
        }
        this.evaluatorKey=compiled.words+':'+Number(!!this.snapshot.derivativeOrder);
    }
    ready() {
        const gl=this.gl,key=this.evaluatorKey;
        let cached=this.evaluators.get(key);
        if(!cached) {
            const source=domainFragment(this.words,!!this.snapshot.derivativeOrder);
            const compilation=beginProgram(gl,source,SAMPLE_VERTEX);
            cached={compilation,handle:null,locations:new Map(),attempts:0};
            this.evaluators.set(key,cached);
        }
        if(!cached.handle) {
            if(this.parallelCompile) {
                const complete=gl.getProgramParameter(cached.compilation.handle,this.parallelCompile.COMPLETION_STATUS_KHR);
                if(!complete) return false;
            } else {
                if(++cached.attempts < 4) return false;
            }
            cached.handle=finishProgram(gl,cached.compilation);
            cached.compilation=null;
        }
        this.programs[0]=cached.handle; this.locations[0]=cached.locations;
        return true;
    }
    uploadNumbers(start,values) {
        if(!values.length) return;
        const gl=this.gl; gl.bindTexture(gl.TEXTURE_2D,this.numbers);
        const stride=4*this.numberWidth,rows=values.length/stride;
        for(let offset=0;offset<rows;) {
            const position=start+offset,y=position%this.numberRows,count=Math.min(rows-offset,this.numberRows-y);
            gl.texSubImage2D(gl.TEXTURE_2D,0,Math.floor(position/this.numberRows)*this.numberWidth,y,this.numberWidth,count,
                gl.RGBA_INTEGER,gl.UNSIGNED_INT,values.subarray(offset*stride,(offset+count)*stride));
            offset+=count;
        }
    }
    draw(start=0,count=this.width*this.height,stage=-1) {
        const gl=this.gl,index=0,loc=name=>this.uniform(index,name);
        gl.useProgram(this.programs[0]); gl.bindVertexArray(this.vao);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,this.numbers); gl.uniform1i(loc('uNumbers'),0);
        gl.uniform1i(loc('uNumberRows'),this.numberRows);
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D,this.instructionTexture);
        gl.uniform1i(loc('uProgram'),4);
        gl.uniform1i(loc('uProgramWidth'),this.instructionWidth);
        gl.uniform1i(loc('uInstructionCount'),this.instructionCount);
        for(const [name,value] of Object.entries(this.programUniforms)) gl.uniform1i(loc(name),value);
        gl.uniform1i(loc('uWords'),this.words);
        gl.uniform1i(loc('uComponents'),2);
        gl.uniform1i(loc('uNewtonSteps'),Math.ceil(Math.log2(this.words*15/20))+1);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.palette); gl.uniform1i(loc('uPalette'), 1);
        gl.uniform2f(loc('uSize'), this.width, this.height);
        gl.uniform1f(loc('uPaletteSlope'), this.paletteSlope); gl.uniform1f(loc('uPaletteSeam'), this.paletteSeam);
        const { style } = this.snapshot;
        gl.uniform4f(loc('uStyle'), style.brightness, style.contrast, style.saturation, style.lightnessCycles);
        for (const [name, value] of Object.entries({
            uCount: this.snapshot.chainingEnabled ? this.snapshot.chainCount : 1,
            uMode: this.snapshot.derivativeOrder ? 0 : ({ value: 0, escape: 1, attractor: 2 })[this.snapshot.orbitColoringMode],
            uZeroSeed: this.snapshot.chainingEnabled && this.snapshot.chainMode === 'zero_seed' ? 1 : 0,
            uPrincipalCut: this.snapshot.branchCutAngle===Math.PI ? 1 : 0,
            uPaletteCount: this.snapshot.paletteStops.length })) gl.uniform1i(loc(name), value);
        const offsets = [[0, 0], [-0.375, -0.125], [0.125, -0.375], [0.375, 0.125], [-0.125, 0.375]];
        const sampleIndices = stage === 0 ? [0] : stage === 1 ? [1, 2, 3, 4] : [0, 1, 2, 3, 4];
        sampleIndices.forEach(sample => {
            const texture = this.samples[sample];
            this.target(texture, this.width, this.height);
            gl.uniform2f(loc('uOffset'), ...offsets[sample]);
            gl.uniform1i(loc('uAA'), sample === 0 ? 0 : 1);
            gl.activeTexture(gl.TEXTURE2);
            // Bind a different texture while writing centers: no framebuffer feedback.
            gl.bindTexture(gl.TEXTURE_2D, sample === 0 ? this.palette : this.samples[0]);
            gl.uniform1i(loc('uCenter'), 2);
            gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D,this.accepted[sample]);
            gl.uniform1i(loc('uAccepted'),3);
            gl.drawArrays(gl.POINTS,start,count);
        });
        this.drawFence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
        if(!this.drawFence) throw new Error('Domain GPU evaluation could not be submitted.');
        gl.flush();
    }
    pollDraw() {
        if(!this.drawFence) return true;
        const gl=this.gl,status=gl.clientWaitSync(this.drawFence,0,0);
        if(status===gl.TIMEOUT_EXPIRED) return false;
        gl.deleteSync(this.drawFence); this.drawFence=null;
        if(status===gl.WAIT_FAILED || gl.getError()!==gl.NO_ERROR) throw new Error('Domain GPU evaluation failed.');
        return true;
    }
    bindSamples(index) {
        const gl = this.gl;
        gl.useProgram(this.programs[index]); gl.bindVertexArray(this.vao);
        ['uCenter', 'uAA0', 'uAA1', 'uAA2', 'uAA3'].forEach((name, unit) => {
            gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, this.samples[unit]);
            gl.uniform1i(this.uniform(index, name), unit);
        });
        gl.uniform2i(this.uniform(index, 'uSize'), this.width, this.height);
    }
    present() {
        this.bindSamples(1); this.target(null, this.width, this.height);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    }
    requestCoverage() {
        if (this.readback) return;
        const gl = this.gl;
        this.bindSamples(2);
        let previous = { texture: this.coveragePlaceholder }, width = this.width, height = this.height;
        // The unused integer sampler still needs a type-compatible texture.
        // A separate level (or a one-pixel placeholder for a tiny frame) avoids
        // framebuffer feedback even when the first branch does not fetch it.
        for (let i = 0; i < this.coverageLevels.length; ++i) {
            const level = this.coverageLevels[i];
            this.target(level.texture, level.width, level.height);
            gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, previous.texture);
            gl.uniform1i(this.uniform(2, 'uPrevious'), 5);
            gl.uniform2i(this.uniform(2, 'uPreviousSize'), width, height);
            gl.uniform1i(this.uniform(2, 'uFirst'), i === 0 ? 1 : 0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            previous = level; width = level.width; height = level.height;
        }
        const buffer = gl.createBuffer(), bytes = this.statusWidth * this.statusHeight * 16;
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer); gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
        gl.readPixels(0, 0, this.statusWidth, this.statusHeight, gl.RGBA_INTEGER, gl.UNSIGNED_INT, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        this.readback = { buffer, fence: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), bytes };
        if (!this.readback.fence) {
            this.cancelReadback();
            throw new Error('Domain GPU evaluation or coverage reduction failed.');
        }
        gl.flush();
    }
    pollCoverage() {
        if (!this.readback) return null;
        const gl = this.gl, { buffer, fence, bytes } = this.readback;
        const status = gl.clientWaitSync(fence, 0, 0);
        if (status === gl.TIMEOUT_EXPIRED) return null;
        if (status === gl.WAIT_FAILED) throw new Error('Domain GPU coverage synchronization failed.');
        if (gl.getError() !== gl.NO_ERROR) throw new Error('Domain GPU evaluation or coverage reduction failed.');
        const data = new Uint32Array(bytes / 4);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); this.cancelReadback();
        return { remaining: data[0], resource: data[1] };
    }

    cancelReadback() {
        if (!this.readback) return;
        this.gl.deleteSync(this.readback.fence); this.gl.deleteBuffer(this.readback.buffer); this.readback = null;
    }
    dispose() {
        if(this.drawFence) { this.gl.deleteSync(this.drawFence); this.drawFence=null; }
        this.cancelReadback();
        this.textures.forEach(texture => this.gl.deleteTexture(texture));
        this.programs.slice(1).forEach(p => this.gl.deleteProgram(p));
        this.evaluators.forEach(p => {
            if(p.handle) this.gl.deleteProgram(p.handle);
            if(p.compilation) {
                this.gl.deleteProgram(p.compilation.handle);
                p.compilation.shaders.forEach(s => this.gl.deleteShader(s));
            }
        });
        this.evaluators.clear();
        this.framebuffers.forEach(framebuffer => this.gl.deleteFramebuffer(framebuffer));
        this.gl.deleteVertexArray(this.vao ?? null);
    }
}
