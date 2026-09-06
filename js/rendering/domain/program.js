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
        const db = [3, 4, 5, 11, 12, 13, 15].includes(op) || (op === 10 && aux === 7) ? b : -1;
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
        stride += 16 + (nodes[4 * i] === 10 && [9, 10].includes(nodes[4 * i + 3]) ? 8 : nodes[4 * i] === 10 && ![2, 8].includes(nodes[4 * i + 3]) ? terms * 8 + 20 : nodes[4 * i] === 11 ? 16 : 0);
        return offset;
    });
    return { ball: 8, metadata: 8, offsets, transitionOffset: stride, checkpointOffset: stride + 8, stride: stride + 16, state: checkpoint ? 24 : 12 };
}

export function generateDomainNodesGLSL(nodes, layout, registers, seriesKinds) {
    const lines = [];
    const count = nodes.length / 4;
    for (let i = 0; i < count; i++) {
        const op = nodes[4 * i];
        const a = nodes[4 * i + 1];
        const b = nodes[4 * i + 2];
        const aux = nodes[4 * i + 3];
        const [dest, da, db, daux] = registers.instructions[i];
        const offset = layout.offsets[i];

        const daStr = da >= 0 ? `deltas[${da}]` : `bz()`;
        const dbStr = db >= 0 ? `deltas[${db}]` : `bz()`;
        const arStr = `loadB(u_reference,base+${layout.offsets[a]})`;
        const brStr = `loadB(u_reference,base+${layout.offsets[b]})`;
        const refStr = `loadB(u_reference,base+${offset})`;
        const defectStr = `loadB(u_reference,base+${offset + 8})`;

        let code = '';
        switch (op) {
            case 0: code = `deltas[${dest}]=delta;`; break;
            case 1: code = `deltas[${dest}]=dc;`; break;
            case 2: code = `deltas[${dest}]=${defectStr};`; break;
            case 3: code = `deltas[${dest}]=badd(badd(${daStr},${dbStr}),${defectStr});`; break;
            case 4:
                code = a === b
                    ? `deltas[${dest}]=finiteB(${daStr})?${defectStr}:badd(bsub(${daStr},${dbStr}),${defectStr});`
                    : `deltas[${dest}]=badd(bsub(${daStr},${dbStr}),${defectStr});`;
                break;
            case 5:
                if (a === b) {
                    code = `deltas[${dest}]=badd(bmul(${daStr},badd(bshift(${arStr},1.0),${daStr})),${defectStr});`;
                } else {
                    code = `deltas[${dest}]=badd(badd(bmul(${arStr},${dbStr}),bmul(badd(${brStr},${dbStr}),${daStr})),${defectStr});`;
                }
                break;
            case 6: code = `deltas[${dest}]=bneg(${daStr});`; break;
            case 7: code = `deltas[${dest}]=bconj(${daStr});`; break;
            case 8: code = `deltas[${dest}]=breal(${daStr});`; break;
            case 9: code = `deltas[${dest}]=bimag(${daStr});`; break;
            case 10:
                if (aux === 8) {
                    code = `deltas[${dest}]=badd(bdiv(bneg(${daStr}),bmul(${arStr},badd(${arStr},${daStr}))),${defectStr});`;
                } else {
                    const kindArg = seriesKinds.length === 1 ? seriesKinds[0] : aux;
                    code = `deltas[${dest}]=analyticDelta(${daStr},base+${offset + 16},${defectStr},${kindArg},${refStr});`;
                    if (aux === 7) code += `if(!zeroB(${dbStr}))deltas[${dest}]=bi();`;
                }
                break;
            case 11:
                code = `deltas[${dest}]=chooseDelta(badd(${arStr},${daStr}),${dbStr},deltas[${daux}],loadB(u_reference,base+${offset + 16}),loadB(u_reference,base+${offset + 24}));`;
                break;
            case 12:
                code = `deltas[${dest}]=(zeroB(${daStr})&&zeroB(${dbStr}))?${defectStr}:bsub(testB(badd(${arStr},${daStr}),badd(${brStr},${dbStr}),${aux}),${refStr});`;
                break;
            case 13:
                code = `deltas[${dest}]=(zeroB(${daStr})&&zeroB(${dbStr}))?${defectStr}:bsub(integerB(badd(${arStr},${daStr}),badd(${brStr},${dbStr}),${aux}),${refStr});`;
                break;
            case 14: {
                const shift = (aux >> 2) - 1074;
                if ((aux & 1) === 0 && (aux & 2) === 0) {
                    code = `deltas[${dest}]=bshift(${daStr},float(${shift}));`;
                } else {
                    let st = `{B t=bshift(${daStr},float(${shift}));`;
                    if ((aux & 1) !== 0) st += `t.v=vec2(-t.v.y,t.v.x);t.lo=vec2(-t.lo.y,t.lo.x);`;
                    if ((aux & 2) !== 0) st += `t=bneg(t);`;
                    st += `deltas[${dest}]=t;}`;
                    code = st;
                }
                break;
            }
            case 15:
                code = `deltas[${dest}]=badd(bdiv(bsub(bmul(${brStr},${daStr}),bmul(${arStr},${dbStr})),bmul(${brStr},badd(${brStr},${dbStr}))),${defectStr});`;
                break;
            default:
                code = `deltas[${dest}]=bi();`;
                break;
        }
        lines.push(code);
    }
    return lines.join('\n    ');
}

export function domainVertex(program, terms, mode, derivative = false) {
    const { nodes, output } = program;
    const checkpointNeeded = !derivative && (mode === 2 || mode === 3);
    const layout = domainLayout(nodes, terms, checkpointNeeded);
    const { state } = layout;
    const inputs = stateInputs(state);
    const registers = domainRegisters(nodes, output);
    const analyticKinds = new Set(Array.from({length: nodes.length / 4}, (_, i) => i).filter(i => nodes[4 * i] === 10).map(i => nodes[4 * i + 3]));
    const seriesKinds = [...analyticKinds].filter(kind => kind !== 8);
    const hasTrig = analyticKinds.has(9) || analyticKinds.has(10);
    const onlyTrig = seriesKinds.length > 0 && seriesKinds.every(kind => kind === 9 || kind === 10);
    const universalOnly = seriesKinds.every(kind => kind === 2 || kind === 9 || kind === 10);
    const generatedNodes = generateDomainNodesGLSL(nodes, layout, registers, seriesKinds);
    return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${domainArithmetic}
const int STATE=${state};
uniform int TERMS,u_stride;
uniform sampler2D u_reference,u_header,u_nodes,u_coefficients;
uniform int u_batch,u_iteration,u_depth,u_width,u_nodesCount,u_references,u_activeCount;
uniform float u_tolerance;
uniform bool u_initial,u_zeroSeed;
${Array.from({length: state / 4}, (_, i) => `out vec4 state${i};`).join('\n')}
vec4 v_state[${state / 4}];
${inputs.declarations}
layout(location=${state/4}) in highp uvec2 inputSampleInfo;
vec4 texel(sampler2D tex,int at){int w=textureSize(tex,0).x;return texelFetch(tex,ivec2(at%w,at/w),0);}
B loadB(sampler2D tex,int at){vec4 v=texel(tex,at/4);return B(v.xy,texel(tex,at/4+1).xy,v.z,v.w);}
B stateB(int at){vec4 v=inputState[at/4];return B(v.xy,inputState[at/4+1].xy,v.z,v.w);}
B chooseDelta(B c,B ad,B bd,B ar,B br){int t=truthB(c);if(t<0)return bi();if(t==1)return badd(ar,ad);return badd(br,bd);}
B seriesCoefficient(int at,int k,int kind){if(kind==2)return loadB(u_coefficients,k*8);return loadB(u_reference,at+k*8);}
B scaledCoefficient(int at,int k,int kind,float exponent){
 B c=alignB(seriesCoefficient(at,k,kind),exponent);c.e=0.0;return c;
}
B trigCoefficient(int k,bool cosine){
 int index=2*k;if(cosine)index++;
 B c=scaledCoefficient(0,index,2,1.0);
 if(((k+int(cosine))&1)!=0)c=bneg(c);return c;
}
B trigPolynomial(B qSquared,int count,bool cosine){
 B sum=trigCoefficient(count-1,cosine);
 for(int k=count-2;k>=0;k--)sum=hornerStep(qSquared,sum,trigCoefficient(k,cosine));
 sum.e=1.0;return bn(sum);
}
B analyticDelta(B delta,int at,B defect,int kind,B reference){
 if(!finiteB(delta))return bi();if(zeroB(delta))return defect;
 bool trig=${onlyTrig ? 'true' : hasTrig ? 'kind==9||kind==10' : 'false'};
 bool universal=${universalOnly ? 'true' : analyticKinds.has(2) ? 'kind==2||trig' : 'trig'};
 B inverse=bf(1.0),bound=bf(3.0);
 if(!universal){
   if(texel(u_reference,(at+TERMS*8+16)/4).x<0.5)return bi();
   inverse=loadB(u_reference,at+TERMS*8);bound=loadB(u_reference,at+TERMS*8+8);
 }
 int doubles=0;B q;
 if(universal){B size=upperB(delta);doubles=max(0,int(size.e)+4);if(doubles>32)return bi();q=bshift(delta,-float(doubles));}
 else q=bmul(delta,inverse);
 B size=magnitudeUpper(q);if(!upperLess(size,bf(1.0)))return bi();
 float qUpper=size.v.x*exp2(max(size.e,-120.0));
 float denominator=1.0-qUpper-4.0*U;if(denominator<=0.0)return bi();
 B majorant=upperProduct(upperB(bound),bf((1.0+8.0*U)/denominator));
 B tail=bi();int degree=TERMS;
 float seriesBudget=u_tolerance/(64.0*float(u_depth)*float(u_nodesCount)*exp2(float(doubles)));
 // Degree selection is a scalar estimate; the retained Cauchy tail below
 // supplies the actual bound. Do not evaluate the series twice per sample.
 B coefficient=upperB(seriesCoefficient(at,0,universal?2:kind)),majorantSize=upperB(majorant);
 float logQ=log2(size.v.x)+size.e;
 if(!zeroB(coefficient)&&logQ<0.0){
   float logRatio=log2(majorantSize.v.x)+majorantSize.e-log2(coefficient.v.x)-coefficient.e-log2(seriesBudget);
   degree=int(clamp(ceil(logRatio/-logQ),1.0,float(TERMS)));
 }
 if(trig)degree=min(TERMS,max(2,degree+1));
 B power=bf(1.0),factor=size;int exponent=degree+1;if(trig)exponent=degree;
 for(int bit=0;exponent>0;bit++){
   if((exponent&1)!=0)power=upperProduct(power,factor);
   exponent>>=1;if(exponent>0)factor=upperProduct(factor,factor);
 }
 tail=upperProduct(majorant,power);
 if(trig){
   // Odd/even series preserve the first-order difference directly. Subtracting
   // two exponentials loses that correlation in long trigonometric chains.
   B qSquared=bmul(q,q),mantissaQ=alignB(qSquared,0.0);mantissaQ.e=0.0;
   B sine=withError(bmul(q,trigPolynomial(mantissaQ,(degree+1)/2,false)),tail);
   B cosineMinusOne=withError(bmul(qSquared,trigPolynomial(mantissaQ,degree/2,true)),tail);
   for(int k=0;k<doubles;k++){
     B nextCosine=bneg(bshift(bmul(sine,sine),1.0));
     sine=bshift(bmul(sine,badd(bf(1.0),cosineMinusOne)),1.0);cosineMinusOne=nextCosine;
   }
   return badd(badd(bmul(reference,cosineMinusOne),bmul(loadB(u_reference,at),sine)),bmul(defect,badd(bf(1.0),cosineMinusOne)));
 }
 float coefficientExponent=1.0;
 if(kind!=2)coefficientExponent=texel(u_reference,(at+(degree-1)*8)/4+1).z;
 B sum=scaledCoefficient(at,degree-1,kind,coefficientExponent);
 B mantissaQ=alignB(q,0.0);mantissaQ.e=0.0;
 for(int k=degree-2;k>=0;k--)sum=hornerStep(mantissaQ,sum,scaledCoefficient(at,k,kind,coefficientExponent));
 sum.e=coefficientExponent;
 sum=withError(bmul(q,bn(sum)),tail);
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
 int sampleId=int(inputSampleInfo.x),sampleIndex=sampleId/${derivative ? 2 : 1},pixel=sampleIndex/4,sub=sampleIndex%4;
 const vec2 jitter[4]=vec2[4](vec2(-0.375,-0.125),vec2(0.125,-0.375),vec2(0.375,0.125),vec2(-0.125,0.375));
 vec2 position=vec2(pixel%u_width,pixel/u_width)+jitter[sub];
 int refIndex=int(inputState[2].z);
 if(u_initial){
   refIndex=int(inputSampleInfo.y);
 }
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
   ${generatedNodes}
   delta=deltas[${registers.output}];B actual=badd(loadB(u_reference,base+${layout.offsets[output]}),delta);
   ${mode === 1 || mode === 3 ? `
    float centerMag=length(actual.v+actual.lo);
    float lowerBound=centerMag-actual.r;
    float logLower=log(max(1.0e-30,lowerBound))+actual.e*0.6931471805599453;
    bool escaped=finiteB(actual)&&lowerBound>0.0&&logLower>=9.210340371976184;
    if(escaped){
      float logMag=log(max(1.0e-30,centerMag))+actual.e*0.6931471805599453;
      float adj=log(max(logMag,9.210340371976184)/9.210340371976184)*1.4426950408889634;
      delta=actual;status=1.0;iteration++;
      eventAt=max(1.0,float(iteration)-clamp(adj,0.0,1.0));break;
    }` : ''}
   if(!finiteB(actual)){status=2.0;break;}iteration++;
   delta=badd(delta,loadB(u_reference,base+u_stride-16));
   ${checkpointNeeded ? `
   age++;
   B change=badd(loadB(u_reference,base+u_stride-8),bsub(delta,checkpoint));
   B distance=breal(bmul(change,bconj(change))),normSquared=breal(bmul(actual,bconj(actual)));
   // max(1, normSquared) only changes the tolerance; ambiguous comparisons use 1.
   int above=truthB(testB(normSquared,bf(1.0),22));
   B threshold=bf(1.0);if(above==1)threshold=normSquared;threshold=bscale(threshold,1.0e-14);
   int attracted=truthB(testB(distance,threshold,21));
   if(attracted==1&&iteration>=2){delta=actual;status=1.0;eventAt=-float(age);break;}
   if(age==power){checkpoint=delta;power*=2;age=0;}` : ''}
   if(iteration==u_depth){
     ${derivative ? '' : mode === 1 ? `
     float centerMag=length(actual.v+actual.lo);
     float upperBound=centerMag+actual.r;
     float logUpper=log(max(1.0e-30,upperBound))+actual.e*0.6931471805599453;
     if(logUpper>=9.210340371976184){status=2.0;break;}
     ` : mode === 2 ? '' : 'if(!accurate(actual,u_tolerance)){status=2.0;break;}'}
     delta=actual;status=1.0;
   }
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
