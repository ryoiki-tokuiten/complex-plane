import { domainArithmetic } from './arithmetic.js';

export function stateInputs(state, lanes = 1) {
    const count = state * lanes / 4;
    return {
        declarations: Array.from({ length: count }, (_, i) => `layout(location=${i}) in vec4 input${i};`).join('\n') + `\nvec4 inputState[${count}];`,
        assign: Array.from({ length: count }, (_, i) => `inputState[${i}]=input${i};`).join('\n')
    };
}

// Allocate only simultaneously live SSA values. Reference addresses still identify
// the original nodes; reusing a delta register never changes the expression.
export function domainRegisters(nodes, output) {
    const count = nodes.length / 4, last = new Int32Array(count).fill(-1);
    const dependencies = Array.from({ length: count }, (_, i) => {
        const [op, a, b, aux] = nodes.subarray(i * 4, i * 4 + 4);
        const da = op >= 3 ? a : -1;
        const db = [3, 4, 5, 11, 12, 13].includes(op) || (op === 10 && aux === 7) ? b : -1;
        const dc = op === 11 ? aux : -1;
        for (const source of [da, db, dc]) if (source >= 0) last[source] = i;
        return [da, db, dc];
    });
    last[output] = count;
    const slots = new Int32Array(count), free = [], instructions = [];
    let registers = 0;
    for (let i = 0; i < count; i++) {
        const sources = dependencies[i];
        const operands = sources.map(source => source < 0 ? -1 : slots[source]);
        for (const source of new Set(sources)) if (source >= 0 && last[source] === i) free.push(slots[source]);
        slots[i] = free.length ? free.pop() : registers++;
        instructions.push([slots[i], ...operands]);
        if (last[i] < i) free.push(slots[i]);
    }
    return { count: registers, instructions, output: slots[output] };
}

export function domainLayout(nodes, terms, checkpoint = true) {
    let stride = 0;
    const offsets = Array.from({ length: nodes.length / 4 }, (_, i) => {
        const offset = stride;
        stride += 16 + (nodes[4 * i] === 10 && ![2, 8].includes(nodes[4 * i + 3]) ? terms * 8 + 20 : nodes[4 * i] === 11 ? 16 : 0);
        return offset;
    });
    return { ball: 8, metadata: 8, offsets, transitionOffset: stride, checkpointOffset: stride + 8, stride: stride + 16, state: checkpoint ? 24 : 12 };
}

export function domainVertex(program, terms, mode, derivative = false) {
    const { nodes, output } = program;
    const checkpointNeeded = !derivative && (mode === 2 || mode === 3);
    const { state } = domainLayout(nodes, terms, checkpointNeeded);
    const inputs = stateInputs(state);
    const registers = domainRegisters(nodes, output);
    const used = new Set(Array.from({length: nodes.length / 4}, (_, i) => nodes[4 * i]));
    const operations = {
        0: 'value=delta;', 1: 'value=dc;', 2: 'value=defect;',
        3: 'value=badd(badd(da,db),defect);',
        4: 'if(a==b&&finiteB(da))value=defect;else value=badd(bsub(da,db),defect);',
        5: 'value=badd(badd(badd(bmul(ar,db),bmul(br,da)),bmul(da,db)),defect);',
        6: 'value=bneg(da);', 7: 'value=bconj(da);', 8: 'value=breal(da);', 9: 'value=bimag(da);',
        10: 'if(aux==8)value=badd(bdiv(bneg(da),bmul(ar,badd(ar,da))),defect);else value=analyticDelta(da,offset+16,defect,aux,reference);if(aux==7&&!zeroB(db))value=bi();',
        11: 'value=chooseDelta(badd(ar,da),db,deltas[int(registersExtra.x)],loadB(u_reference,offset+16),loadB(u_reference,offset+24));',
        12: 'if(zeroB(da)&&zeroB(db))value=defect;else value=bsub(testB(badd(ar,da),badd(br,db),aux),reference);',
        13: 'if(zeroB(da)&&zeroB(db))value=defect;else value=bsub(integerB(badd(ar,da),badd(br,db),aux),reference);'
    };
    const cases = [...used].map(op => `case ${op}: ${operations[op]} break;`).join('\n');
    return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${domainArithmetic}
const int STATE=${state};
uniform int TERMS,u_stride;
uniform sampler2D u_reference,u_header,u_nodes,u_coefficients;
uniform int u_batch,u_iteration,u_depth,u_width,u_nodesCount,u_references;
uniform float u_tolerance;
uniform bool u_initial,u_zeroSeed;
${Array.from({length: state / 4}, (_, i) => `out vec4 state${i};`).join('\n')}
vec4 v_state[${state / 4}];
${inputs.declarations}
layout(location=${state/4}) in highp uint inputSampleId;
vec4 texel(sampler2D tex,int at){int w=textureSize(tex,0).x;return texelFetch(tex,ivec2(at%w,at/w),0);}
B loadB(sampler2D tex,int at){vec4 v=texel(tex,at/4);return B(v.xy,texel(tex,at/4+1).xy,v.z,v.w);}
B stateB(int at){vec4 v=inputState[at/4];return B(v.xy,inputState[at/4+1].xy,v.z,v.w);}
vec4 nodeData(int at){return texel(u_nodes,at);}
B nodeReference(int base,int node){return loadB(u_reference,base+int(nodeData(node*3+1).x));}
B chooseDelta(B c,B ad,B bd,B ar,B br){int t=truthB(c);if(t<0)return bi();if(t==1)return badd(ar,ad);return badd(br,bd);}
B seriesCoefficient(int at,int k,int kind){if(kind==2)return loadB(u_coefficients,k*8);return loadB(u_reference,at+k*8);}
B analyticDelta(B delta,int at,B defect,int kind,B reference){
 if(!finiteB(delta))return bi();if(zeroB(delta))return defect;
 B inverse=bf(1.0),bound=bf(3.0);
 if(kind!=2){
   if(texel(u_reference,(at+TERMS*8+16)/4).x<0.5)return bi();
   inverse=loadB(u_reference,at+TERMS*8);bound=loadB(u_reference,at+TERMS*8+8);
 }
 int doubles=0;B q;
 if(kind==2){B size=upperB(delta);doubles=max(0,int(size.e)+4);if(doubles>32)return bi();q=bshift(delta,-float(doubles));}
 else q=bmul(delta,inverse);
 B size=magnitudeUpper(q);if(!upperLess(size,bf(1.0)))return bi();
 float qUpper=size.v.x*exp2(max(size.e,-120.0));
 float denominator=1.0-qUpper-4.0*U;if(denominator<=0.0)return bi();
 B majorant=bscale(bound,(1.0+8.0*U)/denominator);
 B tail=bi();int degree=TERMS;
 float seriesBudget=u_tolerance/(64.0*float(u_depth)*float(u_nodesCount)*exp2(float(doubles)));
 // Degree selection is a scalar estimate; the retained Cauchy tail below
 // supplies the actual bound. Do not evaluate the series twice per sample.
 B coefficient=upperB(seriesCoefficient(at,0,kind)),majorantSize=upperB(majorant);
 float logQ=log2(size.v.x)+size.e;
 if(!zeroB(coefficient)&&logQ<0.0){
   float logRatio=log2(majorantSize.v.x)+majorantSize.e-log2(coefficient.v.x)-coefficient.e-log2(seriesBudget);
   degree=int(clamp(ceil(logRatio/-logQ),1.0,float(TERMS)));
 }
 B power=bf(1.0),factor=size;int exponent=degree+1;
 for(int bit=0;exponent>0;bit++){
   if((exponent&1)!=0)power=bmul(power,factor);
   exponent>>=1;if(exponent>0)factor=bmul(factor,factor);
 }
 tail=bmul(majorant,power);
 B sum=seriesCoefficient(at,degree-1,kind);
 for(int k=degree-2;k>=0;k--)sum=badd(seriesCoefficient(at,k,kind),bmul(q,sum));
 sum=withError(bmul(q,sum),tail);
 if(kind==2){for(int k=0;k<doubles;k++)sum=bmul(sum,badd(bf(2.0),sum));return badd(bmul(reference,sum),bmul(defect,badd(bf(1.0),sum)));}
 return badd(sum,defect);
}
void storeB(int at,B b){v_state[at/4]=vec4(b.v,b.e,b.r);v_state[at/4+1]=vec4(b.lo,0.0,0.0);}
void finish(){
 ${Array.from({length: state / 4}, (_, i) => `state${i}=v_state[${i}];`).join('\n')}
 gl_Position=vec4(0.0,0.0,0.0,1.0);
}
void main(){
 ${inputs.assign}
 for(int i=0;i<STATE/4;i++)v_state[i]=inputState[i];
 if(!u_initial && inputState[2].y!=0.0){finish();return;}
 int sampleId=int(inputSampleId),sampleIndex=sampleId/${derivative ? 2 : 1},pixel=sampleIndex/4,sub=sampleIndex%4;
 const vec2 jitter[4]=vec2[4](vec2(-0.375,-0.125),vec2(0.125,-0.375),vec2(0.375,0.125),vec2(-0.125,0.375));
 vec2 position=vec2(pixel%u_width,pixel/u_width)+jitter[sub];
 int refIndex=int(inputState[2].z);
 if(u_initial){float nearest=1.0e30;refIndex=0;for(int r=0;r<u_references;r++){vec2 d=position-texel(u_header,r*13+12).xy;float dist=dot(d,d);if(dist<nearest){nearest=dist;refIndex=r;}}}
 vec2 referencePixel=texel(u_header,refIndex*13+12).xy;
 position.x+=${derivative ? '(sampleId%2==0?-0.25:0.25)' : '0.0'};
 int header=refIndex*52;
 B sx=loadB(u_header,header+16),sy=loadB(u_header,header+24);
 B dc=badd(loadB(u_header,header+8),badd(bscale(sx,position.x-referencePixel.x),bscale(sy,position.y-referencePixel.y)));
 B delta,checkpoint=bz();float status=0.0,eventAt=0.0;int power=1,age=0,iteration=u_iteration;
 if(u_initial){
   B spacing=upperB(sy);if(upperLess(sx,sy))spacing=upperB(sx);
   if(!finiteB(dc)||!upperLess(ball(vec2(dc.r,0.0),dc.e,0.0),bscale(spacing,0.015625)))status=2.0;
   delta=dc;if(u_zeroSeed)delta=bz();checkpoint=delta;
 }else{
   delta=stateB(0);iteration=int(inputState[2].x);status=inputState[2].y;eventAt=inputState[2].w;
   ${checkpointNeeded ? 'checkpoint=stateB(12);power=int(inputState[5].x);age=int(inputState[5].y);' : ''}
 }
 for(int step=0;step<u_batch;step++){
   if(status!=0.0||iteration>=u_depth)break;
   int base=(refIndex*u_batch+step)*u_stride;
   B deltas[${registers.count}];
   for(int node=0;node<u_nodesCount;node++){
     vec4 instruction=nodeData(node*3),registers=nodeData(node*3+1),registersExtra=nodeData(node*3+2);
     int op=int(instruction.x),a=int(instruction.y),b=int(instruction.z),aux=int(instruction.w),offset=base+int(registers.x);
     B da=bz(),db=bz(),ar=bz(),br=bz();
     if(registers.z>=0.0)da=deltas[int(registers.z)];if(registers.w>=0.0)db=deltas[int(registers.w)];
     if(op==5||op>=10){ar=nodeReference(base,a);br=nodeReference(base,b);}
     B reference=loadB(u_reference,offset),defect=loadB(u_reference,offset+8),value=bi();
     switch(op){${cases}}
     deltas[int(registers.y)]=value;
   }
   delta=deltas[${registers.output}];B actual=badd(nodeReference(base,${output}),delta);
   if(!finiteB(actual)){status=2.0;break;}iteration++;
   ${mode === 1 || mode === 3 ? `
   int escaped=truthB(testB(breal(bmul(actual,bconj(actual))),bf(100000000.0),22));
   if(escaped<0){status=2.0;break;}
   if(escaped==1){if(!accurate(actual,u_tolerance)){status=2.0;break;}delta=actual;status=1.0;eventAt=float(iteration);break;}` : ''}
   delta=badd(delta,loadB(u_reference,base+u_stride-16));
   ${checkpointNeeded ? `
   age++;
   B change=badd(loadB(u_reference,base+u_stride-8),bsub(delta,checkpoint));
   B distance=breal(bmul(change,bconj(change))),normSquared=breal(bmul(actual,bconj(actual)));
   // max(1, normSquared) only changes the tolerance; ambiguous comparisons use 1.
   int above=truthB(testB(normSquared,bf(1.0),22));
   B threshold=bf(1.0);if(above==1)threshold=normSquared;threshold=bscale(threshold,1.0e-14);
   int attracted=truthB(testB(distance,threshold,21));
   if(attracted<0){status=2.0;break;}
   if(attracted==1&&iteration>=2){if(!accurate(actual,u_tolerance)){status=2.0;break;}delta=actual;status=1.0;eventAt=-float(age);break;}
   if(age==power){checkpoint=delta;power*=2;age=0;}` : ''}
   if(iteration==u_depth){${derivative ? '' : 'if(!accurate(actual,u_tolerance)){status=2.0;break;}delta=actual;'}status=1.0;}
 }
 storeB(0,delta);v_state[2]=vec4(float(iteration),status,float(refIndex),eventAt);
 ${checkpointNeeded ? 'storeB(12,checkpoint);v_state[5]=vec4(float(power),float(age),0.0,0.0);' : ''}
 finish();
}`;
}

export const domainFragment = `#version 300 es
precision highp float;
out vec4 color;
void main(){color=vec4(0.0);}`;
