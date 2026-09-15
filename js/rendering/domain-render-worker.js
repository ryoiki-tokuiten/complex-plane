import { compileDomainProgram, domainPrecision } from './domain-program.js';
import { DomainWebGL } from './domain-webgl.js';

class DomainRenderer {
    constructor(canvas, onStatus, workerCount = navigator.hardwareConcurrency) {
        if (!Number.isInteger(workerCount) || workerCount < 1) throw new Error('Domain rendering requires a CPU worker count.');
        this.canvas = canvas; this.onStatus = onStatus; this.workerCount = workerCount;
        this.workers = []; this.generation = 0; this.frame = null; this.job = null;
        this.channel = new MessageChannel();
        this.scheduledImmediate = false;
        this.channel.port1.onmessage = () => {
            this.scheduledImmediate = false;
            this.step();
        };
        this.gpu = new DomainWebGL(canvas);
        this.onLost = event => { event.preventDefault(); this.fail('The domain-coloring GPU context was lost.'); };
        this.onRestored = () => {
            try {
                const snapshot = this.requestedSnapshot;
                this.gpu = new DomainWebGL(canvas);
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
            this.report('failed','The domain-coloring GPU context is lost; rendering can resume after it is restored.');
            return;
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
        const scaleBits = Math.max(0, (Math.max(decimalExponent(v.centerRe), decimalExponent(v.centerIm)) - Math.min(decimalExponent(v.xSpan), decimalExponent(v.ySpan))) * Math.LOG2E * Math.LN10);
        const stops=snapshot.paletteStops;
        const slope=Math.max(...stops.slice(1).flatMap((stop,i)=>stop.map((value,c)=>Math.abs(value-stops[i][c]))))*(stops.length-1);
        const colorBits=Math.ceil(Math.log2(255*Math.max(1,slope)/0.49))+6;
        const words = domainPrecision(Math.max(3, Math.ceil((scaleBits + Math.log2(Math.max(v.width,v.height)) + colorBits) / 15) + 1));
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
        job.batchSize=4096;
        job.batchStart=0;
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
        this.schedule();
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
            if (--job.pending === 0) this.schedule();
        } catch (error) { this.fail(error.message); }
    }
    schedule(delay=0) {
        if (this.frame !== null || this.scheduledImmediate) return;
        if (delay > 0) {
            this.frame = setTimeout(() => {
                this.frame = null;
                this.step();
            }, delay);
        } else {
            this.scheduledImmediate = true;
            this.channel.port2.postMessage(null);
        }
    }
    step() {
        if (!this.job || this.job.done) return;
        try {
            if(!this.job.submitted) {
                if(!this.gpu.ready() || this.job.pending) {
                    if(!this.gpu.programs[0]) this.report('rendering', 'Compiling high-precision domain shader...');
                    this.schedule(16);
                    return;
                }
                const job=this.job,total=job.snapshot.viewport.width*job.snapshot.viewport.height;
                if(this.gpu.drawFence) {
                    if(!this.gpu.pollDraw()) { this.schedule(1); return; }
                    if(job.batchStart) {
                        const duration = performance.now() - job.batchStart;
                        if(duration > 35) job.batchSize = Math.max(512, Math.floor(job.batchSize * 0.6));
                        else if(duration < 12) job.batchSize = Math.min(16384, Math.floor(job.batchSize * 1.4));
                    }
                }
                if(job.stage===0) {
                    if(job.cursor<total) {
                        const count=Math.min(job.batchSize,total-job.cursor);
                        job.batchStart = performance.now();
                        this.gpu.draw(job.cursor,count,0); job.cursor+=count;
                        if(performance.now()-job.lastPresent>=16) {
                            this.gpu.present(); job.lastPresent=performance.now();
                        }
                        this.schedule(0); return;
                    }
                    this.gpu.present(); job.lastPresent=performance.now();
                    job.stage=1; job.cursor=0;
                    this.schedule(0); return;
                }
                if(job.stage===1) {
                    if(job.cursor<total) {
                        const count=Math.min(job.batchSize,total-job.cursor);
                        job.batchStart = performance.now();
                        this.gpu.draw(job.cursor,count,1); job.cursor+=count;
                        if(performance.now()-job.lastPresent>=16) {
                            this.gpu.present(); job.lastPresent=performance.now();
                        }
                        this.schedule(0); return;
                    }
                    this.gpu.present(); job.lastPresent=performance.now();
                    this.gpu.requestCoverage(); job.submitted=true;
                }
            }
            const status = this.gpu.pollCoverage();
            if (!status) { this.schedule(1); return; }
            this.job.remaining = status.remaining;
            if (!status.remaining) { this.job.done = true; this.report('complete'); return; }
            if (status.resource) { this.fail('Some samples exceed the numerical operation or exponent limit.'); return; }
            if (this.job.words === 274) { this.fail('Some samples need more than the supported 4096-bit precision.'); return; }
            this.job.words = Math.min(274, this.job.words * 2); this.prepare();
        } catch (error) { this.fail(error.message); }
    }
    cancel() {
        ++this.generation;
        this.requestedSnapshot=null;
        if (this.frame !== null) clearTimeout(this.frame);
        this.frame = null;
        this.scheduledImmediate = false;
        this.gpu.cancelReadback();
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
                        // A cancelled draw is still running on the GPU. Retain
                        // its fence and coalesce requests until that bounded
                        // command completes, before resetting its attachments.
                        if(!renderer.gpu.pollDraw()) { pendingRender=setTimeout(start,4); return; }
                        renderer.render(data.snapshot);
                    } catch(error) { renderer.fail(error.message); }
                };
                pendingRender=setTimeout(start,0);
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
