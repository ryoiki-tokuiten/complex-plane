import { compileDomainProgram, domainPrecision } from './domain-program.js';
import { DomainWebGL } from './domain-webgl.js';

class DomainRenderer {
    constructor(canvas, onStatus, workerCount = navigator.hardwareConcurrency) {
        if (!Number.isInteger(workerCount) || workerCount < 1) throw new Error('Domain rendering requires a CPU worker count.');
        this.canvas = canvas; this.onStatus = onStatus; this.workerCount = workerCount;
        this.workers = []; this.generation = 0; this.frame = null; this.job = null;
        this.gpu = new DomainWebGL(canvas);
        this.onLost = event => { event.preventDefault(); this.fail('The domain-coloring GPU context was lost; recovering...'); };
        this.onRestored = () => {
            try {
                this.gpu = new DomainWebGL(this.canvas);
                const snapshot = this.requestedSnapshot;
                if (snapshot) this.render(snapshot);
            } catch (error) { this.fail(error.message); }
        };
        canvas.addEventListener('webglcontextlost', this.onLost);
        canvas.addEventListener('webglcontextrestored', this.onRestored);
    }
    report(state, message = null) {
        const job = this.job;
        this.onStatus(Object.freeze({ state, message, jobId: this.generation,
            width: job?.snapshot.viewport.width, height: job?.snapshot.viewport.height,
            precisionBits: job ? 15 * (job.words - 1) : 0, remainingPixels: job?.remaining,
            workerMilliseconds: job?.workerMilliseconds ?? 0,
            wallMilliseconds: job ? performance.now() - job.startedAt : 0 }));
    }
    render(snapshot) {
        this.cancel();
        this.requestedSnapshot=snapshot;
        if(this.gpu.gl.isContextLost()) {
            try {
                this.gpu = new DomainWebGL(this.canvas);
            } catch(e) {
                this.report('failed','The domain-coloring GPU context is lost; rendering can resume after it is restored.');
                return;
            }
        }
        this.gpu.reset(snapshot);
        // Coordinate spacing sets an initial precision, never a renderer choice.
        const v = snapshot.viewport;
        const decimalExponent = text => {
            const match = String(text).match(/^[-+]?([\d.]+)(?:e([-+]?\d+))?$/i);
            if (!match) throw new Error('Invalid precise viewport number.');
            const digits = match[1].replace('.', ''), first = digits.search(/[1-9]/);
            return first < 0 ? -Infinity : (Number(match[2]) || 0) + (match[1].includes('.') ? match[1].indexOf('.') : digits.length) - first - 1;
        };
        const maxCoordExp = Math.max(decimalExponent(v.centerRe), decimalExponent(v.centerIm), decimalExponent(v.xSpan), decimalExponent(v.ySpan));
        const minSpanExp = Math.min(decimalExponent(v.xSpan), decimalExponent(v.ySpan));
        const scaleBits = Math.max(0, (maxCoordExp - minSpanExp) * Math.LOG2E * Math.LN10);
        const integerBits = Math.max(0, Math.ceil(maxCoordExp * Math.LOG2E * Math.LN10));
        const stops=snapshot.paletteStops;
        const slope=Math.max(...stops.slice(1).flatMap((stop,i)=>stop.map((value,c)=>Math.abs(value-stops[i][c]))))*(stops.length-1);
        const colorBits=Math.ceil(Math.log2(255*Math.max(1,slope)/0.49))+6;
        const count = snapshot.chainingEnabled ? snapshot.chainCount : 1;
        const iterationBits = count > 1 ? Math.ceil(Math.log2(count)) : 0;
        const words = domainPrecision(Math.max(3, Math.ceil((scaleBits + integerBits + Math.log2(Math.max(v.width,v.height)) + colorBits + iterationBits) / 15) + 1));
        this.job = { snapshot, words, done: false, startedAt: performance.now(), workerMilliseconds: 0, remaining: v.width * v.height };
        this.prepare();
    }
    prepare() {
        const job = this.job;
        if (job.words > 274) { this.fail('The requested calculation exceeds the supported 4096-bit precision.'); return; }
        const generation = ++this.generation;
        job.program = compileDomainProgram(job.snapshot, job.words);
        job.submitted = false;
        job.cursor=0;
        job.stage=0;
        job.lastPresent=0;
        job.batchStart=0;
        const chainDepth = job.snapshot.chainingEnabled ? Math.max(1, job.snapshot.chainCount) : 1;
        job.batchSize = Math.max(2048, Math.min(32768, Math.floor(2000000 / chainDepth)));
        this.gpu.prepare(job.program);
        const count = Math.min(this.workerCount, job.program.numbers.length);
        while (this.workers.length < count) {
            const worker = new Worker(new URL('./domain-worker.js', import.meta.url), { type: 'module' });
            const entry = { worker, ready: false, busy: false, request: null };
            worker.onmessage = ({ data }) => {
                if(data.type==='ready') entry.ready=true;
                else { entry.busy=false; this.receive(data); }
                this.dispatch(entry);
            };
            const failed = message => {
                worker.terminate(); this.workers.splice(this.workers.indexOf(entry),1);
                this.fail(message);
            };
            worker.onerror = event => failed(`Domain worker failed: ${event.message}`);
            worker.onmessageerror = () => failed('Domain numeric data could not be transferred.');
            this.workers.push(entry);
        }
        job.pending = count;
        for (let i = 0; i < count; i++) {
            const entry=this.workers[i];
            const start=Math.floor(i*job.program.numbers.length/count),end=Math.floor((i+1)*job.program.numbers.length/count);
            entry.request={generation,words:job.words,start,numbers:job.program.numbers.slice(start,end)};
            this.dispatch(entry);
        }
        this.report('rendering');
        this.schedule(0);
    }
    dispatch(entry) {
        if(!entry.ready || entry.busy || !entry.request) return;
        entry.busy=true;
        entry.worker.postMessage(entry.request); entry.request=null;
    }
    receive(data) {
        const job = this.job;
        if (!job || job.done || data.generation !== this.generation) return;
        try {
            if (data.error) { this.fail(data.error); return; }
            this.gpu.uploadNumbers(data.start, data.values);
            job.workerMilliseconds += data.milliseconds;
            if (--job.pending === 0) this.schedule(0);
        } catch (error) { this.fail(error.message); }
    }
    schedule(delay = 0) {
        if (this.frame !== null) return;
        this.frame = setTimeout(() => {
            this.frame = null;
            this.step();
        }, delay);
    }
    step() {
        if (!this.job || this.job.done) return;
        const job = this.job;
        const total = job.snapshot.viewport.width * job.snapshot.viewport.height;
        const sliceStart = performance.now();

        try {
            if (!job.submitted) {
                if (job.pending) return; // receive() will schedule step when numbers are ready
                if (!this.gpu.ready()) {
                    if (!this.gpu.programs[0]) this.report('rendering', 'Compiling high-precision domain shader...');
                    this.schedule(16);
                    return;
                }

                while (!job.submitted && (job.stage === 0 || job.stage === 1)) {
                    // 1. If a GPU batch is currently in-flight, wait for it to complete.
                    if (this.gpu.drawFence) {
                        if (!this.gpu.pollDraw()) {
                            this.schedule(2);
                            return;
                        }
                    }

                    if (job.cursor >= total) {
                        this.gpu.present();
                        job.lastPresent = performance.now();
                        if (job.stage === 0) {
                            this.gpu.requestCoverage();
                            job.submitted = true;
                            this.schedule(2);
                            return;
                        }
                        if (job.stage === 1) {
                            this.job.done = true;
                            this.report('complete');
                            return;
                        }
                    }

                    if (performance.now() - job.lastPresent >= 60) {
                        this.gpu.present();
                        job.lastPresent = performance.now();
                    }

                    // 2. Submit the next bounded batch to the GPU.
                    const count = Math.min(job.batchSize, total - job.cursor);
                    job.batchStartTime = performance.now();
                    this.gpu.draw(job.cursor, count, job.stage, false);
                    job.cursor += count;
                    this.gpu.syncDraw();

                    // Yield to event loop if we've spent more than 16ms in this JS slice
                    if (performance.now() - sliceStart >= 16) {
                        this.schedule(0);
                        return;
                    }

                    // If the batch completed immediately, loop to next batch; otherwise wait
                    if (!this.gpu.pollDraw()) {
                        this.schedule(2);
                        return;
                    }
                }
            }

            // 3. Waiting for coverage reduction
            const status = this.gpu.pollCoverage();
            if (!status) {
                this.schedule(2);
                return;
            }
            console.log(`[COVERAGE POLL] remaining=${status.remaining}, resource=${status.resource} in ${Math.round(performance.now() - job.startedAt)}ms`);
            this.job.remaining = status.remaining;
            if (!status.remaining) {
                this.gpu.clearAA();
                job.stage = 1;
                job.cursor = 0;
                job.submitted = false;
                job.batchSize = Math.max(1024, Math.min(16384, Math.floor(2000000 / (4 * (job.snapshot.chainingEnabled ? Math.max(1, job.snapshot.chainCount) : 1)))));
                this.schedule(0);
                return;
            }
            if (status.resource) {
                this.fail('Some samples exceed the numerical operation or exponent limit.');
                return;
            }
            if (this.job.words === 274) {
                this.fail('Some samples need more than the supported 4096-bit precision.');
                return;
            }
            console.log(`[PRECISION RETRY] doubling words from ${this.job.words} to ${Math.min(274, this.job.words * 2)}`);
            this.job.words = Math.min(274, this.job.words * 2);
            this.prepare();
        } catch (error) {
            this.fail(error.message);
        }
    }
    cancel() {
        ++this.generation;
        if (this.frame !== null) clearTimeout(this.frame);
        this.frame = null;
        try { this.gpu?.cancelReadback(); } catch(e) {}
        this.workers.forEach(entry => { entry.request=null; });
        if (this.job) this.job.done = true;
    }
    fail(message) {
        const snapshot=this.requestedSnapshot;
        this.cancel(); this.requestedSnapshot=snapshot; this.report('failed', message);
    }
    exportImage() {
        if (!this.job?.done || this.job.remaining) throw new Error('Domain coloring must finish before exporting.');
        this.gpu.present();
        const image=this.canvas.transferToImageBitmap();
        // Export transfers the drawing buffer. Restore the visible canvas
        // from its existing GPU textures before yielding to the compositor.
        this.gpu.present();
        return image;
    }
}

let renderer=null,revision=0,pendingRender=null;
self.onmessage=({data})=>{
    try {
        if(data.type==='init') {
            renderer=new DomainRenderer(data.canvas,status=>self.postMessage({type:'status',revision,status}),data.workerCount);
        } else if(data.type==='render' || data.type==='cancel') {
            if(!renderer) return; // Initialization already reported its failure.
            revision=data.revision;
            if(pendingRender!==null) clearTimeout(pendingRender);
            pendingRender=null;
            renderer.cancel();
            if(data.type==='render') {
                renderer.requestedSnapshot=data.snapshot;
                const start=()=>{
                    pendingRender=null;
                    try {
                        if(renderer.gpu?.gl.isContextLost()) {
                            try { renderer.gpu = new DomainWebGL(renderer.canvas); } catch(e) {}
                        }
                        if(!renderer.gpu?.gl.isContextLost() && !renderer.gpu.pollDraw()) { pendingRender=setTimeout(start,8); return; }
                        renderer.render(data.snapshot);
                    } catch(error) { renderer.fail(error.message); }
                };
                pendingRender=setTimeout(start,24);
            }
        } else if(data.type==='export') {
            if(data.revision!==revision || pendingRender!==null) throw new Error('The domain view changed before export completed.');
            const image=renderer.exportImage();
            self.postMessage({type:'export',requestId:data.requestId,image},[image]);
        }
    } catch(error) {
        if(data.type==='export') self.postMessage({type:'export',requestId:data.requestId,error:error.message});
        else if(renderer) renderer.fail(error.message);
        else self.postMessage({type:'error',message:error.message});
    }
};
self.postMessage({type:'ready'});
