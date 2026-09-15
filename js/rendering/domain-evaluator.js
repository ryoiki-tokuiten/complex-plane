import { domainArithmetic } from './domain-arithmetic.js';
import { domainFunctions } from './domain-functions.js';
import { DOMAIN_OP as OP, DOMAIN_REGISTERS } from './domain-program.js';

// Shader source depends only on arithmetic storage and derivative presentation.
// Map structure, coefficients, branch settings and series tables are GPU data.
export function domainEvaluator(words, derivative) {
    return domainArithmetic(words, derivative) + domainFunctions() + `
uniform highp isampler2D uProgram;
uniform int uProgramWidth,uInstructionCount,uSourceCount,uBranchAngle,uPrincipalCut;
const int SCALAR_VECTORS=(W+3)/4+1;
const int COMPONENT_SCALARS=${derivative ? 2 : 1};
const int REGISTER_VECTORS=2*COMPONENT_SCALARS*SCALAR_VECTORS;
uvec4 registerData[${DOMAIN_REGISTERS}*REGISTER_VECTORS];
F loadScalar(int offset) {
    uvec4 header=registerData[offset];
    F value; value.s=int(header.x); value.e=int(header.y); value.error=uintBitsToFloat(header.z);
    for(int i=0;i<(uWords+3)/4;i++) value.d[i]=registerData[offset+i+1];
    return value;
}
C loadRegister(int address) {
    C result=cfloat(0.0);
    for(int i=0;i<uComponents;i++) {
        int offset=address*REGISTER_VECTORS+i*COMPONENT_SCALARS*SCALAR_VECTORS;
        R value=realNumber(loadScalar(offset));
        ${derivative ? 'value.d=loadScalar(offset+SCALAR_VECTORS); value.dependent=registerData[offset].w!=0u;' : ''}
        if(i==0) result.re=value; else result.im=value;
    }
    return result;
}
void storeRegister(int address,C value) {
    for(int i=0;i<uComponents;i++) {
        R part=component(value,i);
        for(int j=0;j<COMPONENT_SCALARS;j++) {
            F scalar=rv(part); ${derivative ? 'if(j==1) scalar=rd(part);' : ''}
            int offset=address*REGISTER_VECTORS+(i*COMPONENT_SCALARS+j)*SCALAR_VECTORS;
            registerData[offset]=uvec4(uint(scalar.s),uint(scalar.e),floatBitsToUint(scalar.error),rdependent(part) ? 1u : 0u);
            for(int k=0;k<(uWords+3)/4;k++) registerData[offset+k+1]=scalar.d[k];
        }
    }
}
ivec4 instruction(int pc) { return texelFetch(uProgram,ivec2(pc%uProgramWidth,pc/uProgramWidth),0); }
C operand(int address) {
    if(address>=0) return loadRegister(address);
    int row=-address-1; return cconstant(row,row+1);
}
R configuredArgument(R value) {
    if(uPrincipalCut!=0) return value;
    R angle=rconstant(uBranchAngle),period=rscale(rconstant(0),1);
    F turns=integerRound(fdiv(rv(rsub(value,angle)),rv(period)),29);
    value=rsub(value,rmul(realNumber(turns),period));
    R distance=rsub(value,angle);
    if(rv(distance).error!=EXACT && flower(rv(distance))==EXACT) numericFail(1);
    R lower=radd(distance,period);
    if(rv(lower).error!=EXACT && flower(rv(lower))==EXACT) numericFail(1);
    return value;
}
C evaluateMap(C inputValue,C parameter) {
    for(int i=0;i<uComponents;i++) {
        C initial=inputValue; if(i==1) initial=parameter;
        storeRegister(i,initial);
    }
    int pc=0,source=0,skipUndefined=-1; bool anyValue=false;
    while(pc<uInstructionCount && numericStatus==0) {
        ivec4 command=instruction(pc++);
        int op=command.x;
        if(op==27) { pc=command.w; continue; }
        if(op==${OP.loop}) { if(source>=uSourceCount) pc=command.w; continue; }
        if(op==${OP.next}) { source++; skipUndefined=-1; pc=command.w; continue; }
        if(op==${OP.skipUndefined}) { skipUndefined=command.w; continue; }
        if(op==${OP.accepted}) { anyValue=true; continue; }
        if(op==${OP.requireValue}) { if(!anyValue) numericFail(2); continue; }
        int address=command.z;
        if(op==${OP.source}) address=-(command.z+source*command.w)-1;
        bool binary=(op>=3 && op<=7) || (op>=18 && op<=23) || (op>=33 && op<=36) || op==38 || op==${OP.radius} || op==${OP.gammaError} || op==${OP.zetaError} || op==${OP.zeroPower} || op==${OP.divideReal} || op==${OP.jet};
        ivec4 extra=ivec4(0);
        if(op==${OP.besselError}) extra=instruction(command.w);
        int operandCount=binary ? 2 : 1;
        if(op==${OP.gammaError} || op==${OP.zetaError}) operandCount=3;
        if(op==${OP.besselError}) operandCount=5;
        C a=cfloat(0.0),b=a,c=a,d=a,e=a;
        // One fetch body for every instruction, including primitive bounds.
        // Large register arrays must not be expanded at each operand call site.
        for(int i=0;i<operandCount;i++) {
            int sourceAddress=address;
            if(i==1) sourceAddress=command.w;
            if(i==2) sourceAddress=command.y;
            if(op==${OP.besselError} && i>0) sourceAddress=extra[i-1];
            C fetched=operand(sourceAddress);
            if(i==0) a=fetched; else if(i==1) b=fetched; else if(i==2) c=fetched; else if(i==3) d=fetched; else e=fetched;
        }
        C value=a;
        switch(op) {
            case 0: case ${OP.source}: break;
            case 3: value=cadd(a,b); break;
            case 4: value=csub(a,b); break;
            case 5: value=cmul(a,b); break;
            case 8: value=cneg(a); break;
            case 10: value=C(a.re,rneg(a.im)); break;
            case 13: value=C(a.re,rfloat(0.0)); break;
            case 14: value=C(a.im,rfloat(0.0)); break;
            case 16: value=cbool(!ctruth(a)); break;
            case 17: value=cfactorial(a); break;
            case 18: case 19: case 20: case 21: case 22: case 23: value=ccompare(a,b,op); break;
            case 24: value=cbool(ctruth(a)); break;
            case 25: case 26:
                if(ctruth(a)==(op==26)) pc=command.w;
                break;
            case 28: case 29: case 30: case 31: case 32: value=cround(a,op); break;
            case 33: case 34: {
                int comparison=realCompare(creal(b),creal(a));
                if(op==33 ? comparison<0 : comparison>0) value=b;
                break;
            }
            case 35: value=cmod(a,b); break;
            case 36: value=cgcd(a,b); break;
            case 37: value=cprime(a); break;
            case 38: value=C(creal(a),creal(b)); break;
            case ${OP.divideSmall}:
                if(command.w<0) a=cneg(a);
                value=cdivideSmall(a,uint(abs(command.w))); break;
            case ${OP.branchArgument}: value=C(configuredArgument(a.re),rfloat(0.0)); break;
            case ${OP.value}: value=C(realNumber(rv(a.re)),realNumber(rv(a.im))); break;
            case ${OP.derivative}: value=C(realNumber(rd(a.re)),realNumber(rd(a.im))); break;
            case ${OP.jet}:
                value=C(a.re,rfloat(0.0));
                ${derivative ? 'value.re.d=rv(a.im); value.re.dependent=rdependent(b.re);' : ''}
                break;
            case ${OP.logScale}: {
                F x=rv(a.re);
                if(x.s<=0 || flower(x)==EXACT) { numericFail(x.s<=0 && x.error==EXACT ? 2 : 1); break; }
                int k=int(floor(flog(x))); value=C(realNumber(fscale(x,-k)),rfloat(float(k))); break;
            }
            case ${OP.oddSeries}: value=C(realNumber(foddSeries(rv(a.re),command.w)),rfloat(0.0)); break;
            case ${OP.argumentCheck}:
                if(rv(a.re).s==0 && rv(a.im).s==0) numericFail(rv(a.re).error==EXACT && rv(a.im).error==EXACT ? 2 : 1);
                if(rv(a.re).s<0 && rv(a.im).error!=EXACT && flower(rv(a.im))==EXACT) numericFail(1);
                break;
            case ${OP.realExp}: value=C(rexp(a.re),rfloat(0.0)); break;
            case ${OP.realSqrt}: value=C(rsqrt(a.re),rfloat(0.0)); break;
            case ${OP.checkRadial}:
                if(rv(a.re).s==0 && rv(a.im).s==0 && (rdependent(a.re) || rdependent(a.im)))
                    numericFail(rv(a.re).error==EXACT && rv(a.im).error==EXACT ? 2 : 1);
                if(command.w==1 && rv(a.re).s<0 && rv(a.im).error!=EXACT && flower(rv(a.im))==EXACT) numericFail(1);
                break;
            case ${OP.sincos}: case ${OP.sinhcosh}:
                rtrigonometric(a.re,op==${OP.sinhcosh},value.re,value.im); break;
            case ${OP.result}: return a;
            case ${OP.radius}: if(realCompare(cnormSquared(a),rmul(b.re,b.re))>0) numericFail(2); break;
            case ${OP.rotate}: value=C(rneg(a.im),a.re); break;
            case ${OP.predicate}: value=numericPredicate(a,command.w); break;
            case ${OP.gammaShift}: value=gammaShift(a); break;
            case ${OP.zetaLength}: value=zetaLength(a); break;
            case ${OP.gammaError}: value=gammaError(c,a,b); break;
            case ${OP.zetaError}: value=zetaError(c,a,b); break;
            case ${OP.besselError}: value=besselError(b,c,d,e,a); break;
            case ${OP.fail}: numericFail(command.w); break;
            case ${OP.seriesConstant}: {
                int row=(command.w==0 ? uBernoulli : uStirling)+int(fsmall(rv(a.re)))-1;
                value=C(rconstant(row),rfloat(0.0)); break;
            }
            case ${OP.zeroPower}: value=czeroPower(a,b); break;
            case ${OP.normSquared}: value=C(cnormSquared(a),rfloat(0.0)); break;
            case ${OP.divideReal}:
                for(int i=0;i<uComponents;i++) {
                    R part=rdiv(component(a,i),b.re);
                    if(i==0) value.re=part; else value.im=part;
                }
                break;
            case ${OP.parity}: value=cfloat(float(abs(fmod4(rv(a.re)))&1)); break;
            case ${OP.scale}: value=cscale(a,command.w); break;
            default: numericFail(3); break;
        }
        if(numericStatus==2 && skipUndefined>=0) { numericStatus=0; pc=skipUndefined; continue; }
        // Control instructions have no destination. In particular a branch
        // must never overwrite the immutable input in register zero.
        if(op!=25 && op!=26) {
            int count=op==${OP.besselError} ? 2 : 1;
            for(int i=0;i<count;i++) {
                int target=command.y; C result=value;
                if(i==1) { target=extra.w; result=e; }
                storeRegister(target,result);
            }
        }
    }
    return cfloat(0.0);
}
`;
}
