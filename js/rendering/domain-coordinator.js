// The UI owns requests; one persistent worker owns the canvas and all WebGL
// calls. Shader compilation never runs on the application event loop.
export class DomainCoordinator {
    constructor(canvas,onStatus,workerCount=navigator.hardwareConcurrency) {
        if(!Number.isInteger(workerCount) || workerCount<1) throw new Error('Domain rendering requires a CPU worker count.');
        this.canvas=canvas; this.onStatus=onStatus; this.revision=0; this.ready=false;
        this.status={state:'idle'}; this.pending=null; this.exportRequest=null; this.exportId=0;
        this.worker=new Worker(new URL('./domain-render-worker.js',import.meta.url),{type:'module'});
        let offscreen;
        try { offscreen=canvas.transferControlToOffscreen(); }
        catch(error) { this.worker.terminate(); throw error; }
        this.worker.onmessage=({data})=>{
            if(data.type==='ready') {
                this.worker.postMessage({type:'init',canvas:offscreen,workerCount},[offscreen]);
                offscreen=null; this.ready=true;
                if(this.pending) this.worker.postMessage(this.pending);
                this.pending=null;
            } else if(data.type==='status' && data.revision===this.revision) {
                this.report({...data.status,jobId:this.revision});
            } else if(data.type==='error') this.fail(data.message);
            else if(data.type==='export') {
                const request=this.exportRequest;
                if(!request || request.id!==data.requestId) { data.image?.close(); return; }
                this.exportRequest=null;
                if(data.error) request.reject(new Error(data.error)); else request.resolve(data.image);
            }
        };
        this.worker.onerror=event=>this.fail(`Domain render worker failed: ${event.message}`);
        this.worker.onmessageerror=()=>this.fail('Domain render worker data could not be transferred.');
    }
    report(status) { this.status=Object.freeze(status); this.onStatus(this.status); }
    send(message) {
        if(this.ready) this.worker.postMessage(message); else this.pending=message;
    }
    rejectExport(message) {
        if(!this.exportRequest) return;
        this.exportRequest.reject(new Error(message)); this.exportRequest=null;
    }
    render(snapshot) {
        this.rejectExport('The domain view changed before export completed.');
        const revision=++this.revision;
        this.report({state:'rendering',message:null,jobId:revision,width:snapshot.viewport.width,height:snapshot.viewport.height,
            precisionBits:0,remainingPixels:snapshot.viewport.width*snapshot.viewport.height,workerMilliseconds:0,wallMilliseconds:0});
        this.workerError = null;
        this.send({type:'render',revision,snapshot});
    }
    cancel() {
        this.rejectExport('Domain rendering was canceled before export completed.');
        this.send({type:'cancel',revision:++this.revision});
        this.status={state:'idle'};
    }
    fail(message) {
        this.workerError=message;
        this.rejectExport(message);
        this.report({...this.status,state:'failed',message});
    }
    exportImage() {
        if(this.status.state!=='complete') return Promise.reject(new Error('Domain coloring must finish before exporting.'));
        if(this.exportRequest) return this.exportRequest.promise;
        const id=++this.exportId;
        let resolve,reject;
        const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
        this.exportRequest={id,promise,resolve,reject};
        this.send({type:'export',revision:this.revision,requestId:id});
        return promise;
    }
    dispose() {
        this.rejectExport('Domain rendering was disposed before export completed.');
        this.worker.terminate(); this.pending=null;
    }
}
