// Numerical primitives compose through C/R/F arithmetic, including derivatives.
// These are library algorithms, independent of maps, observers and viewports.
export function domainFunctions() {
    return `
uniform int uBernoulli,uStirling,uContinuation;
bool definitelySmall(F x,float limit) {
    if(fupper(x)<limit) return true;
    if(flower(x)<=limit) numericFail(1);
    return false;
}
R creal(C a) {
    if(!definitelySmall(rv(a.im),-39.86313713864835)) numericFail(flower(rv(a.im))>-39.86313713864835 ? 2 : 1);
    return a.re;
}
bool ctruth(C a) {
    const float threshold=-39.86313713864835;
    if(flower(rv(a.re))>threshold || flower(rv(a.im))>threshold) return true;
    if(fupper(rv(a.re))<=threshold && fupper(rv(a.im))<=threshold) return false;
    numericFail(1); return false;
}
C cbool(bool x) { return cfloat(x ? 1.0 : 0.0); }
int realCompare(R a,R b) {
    F difference=fsub(rv(a),rv(b));
    if(difference.s==0 && difference.error==EXACT) return 0;
    if(flower(difference)==EXACT) numericFail(1);
    return difference.s;
}
C ccompare(C a,C b,int op) {
    if(op==18 || op==19) { bool equal=!ctruth(csub(a,b)); return cbool(op==18 ? equal : !equal); }
    int c=realCompare(creal(a),creal(b));
    return cbool(op==20 ? c<0 : op==21 ? c<=0 : op==22 ? c>0 : c>=0);
}
F integerRound(F x,int op) {
    if(op==32) return ffloat(float(x.s));
    if(op==30) { x=fadd(x,ffloat(0.5)); op=28; }
    F integer=ftruncated(x);
    if(op==28 && fcompare(x,integer)<0) integer=fsub(integer,ffloat(1.0));
    if(op==29 && fcompare(x,integer)>0) integer=fadd(integer,ffloat(1.0));
    return integer;
}
C cround(C a,int op) {
    F x=rv(creal(a)),center=x; center.error=EXACT;
    F value=integerRound(center,op);
    if(rdependent(a.re)) {
        F boundary=center; if(op==30) boundary=fadd(boundary,ffloat(0.5));
        if((op==32 && center.s==0) || (op!=32 && exactInteger(boundary) && (op!=31 || center.s!=0))) numericFail(2);
    }
    if(x.error!=EXACT) {
        F radius=fscale(ffloat(1.0),int(ceil(x.error)));
        if(fcompare(integerRound(fsub(center,radius),op),integerRound(fadd(center,radius),op))!=0) numericFail(1);
    }
    return C(realNumber(value),rfloat(0.0));
}
F cinteger(C a) {
    F x=rv(creal(a));
    if(!exactInteger(x)) {
        F difference=fsub(x,fnearest(x));
        numericFail(flower(difference)==EXACT ? 1 : 2);
    }
    if(flog(x)>53.0) numericFail(2);
    return x;
}
C cmod(C a,C b) {
    R x=creal(a),y=creal(b); F q=ftruncated(fdiv(rv(x),rv(y)));
    return C(rsub(x,rmul(realNumber(q),y)),rfloat(0.0));
}
C cgcd(C a,C b) {
    F x=fabsval(cinteger(a)),y=fabsval(cinteger(b));
    for(int i=0;i<128 && y.s!=0 && numericStatus==0;i++) {
        F quotient=ftruncated(fdiv(x,y));
        F remainder=fsub(x,fmul(quotient,y));
        // Correct a quotient rounded across an integer boundary using exact
        // integer comparisons; input integers fit the declared 53-bit range.
        if(remainder.s<0) remainder=fadd(remainder,y);
        if(fcompare(remainder,y)>=0) remainder=fsub(remainder,y);
        if(remainder.error!=EXACT) { numericFail(1); break; }
        x=y; y=remainder;
    }
    return C(realNumber(x),rfloat(0.0));
}
C cfactorial(C a) {
    F x=cinteger(a); float n=fsmall(x);
    if(n<0.0 || n>170.0) { numericFail(2); return cfloat(0.0); }
    R value=rfloat(1.0); for(int k=2;k<=int(n);k++) value=rmul(value,rfloat(float(k)));
    return C(value,rfloat(0.0));
}
C cprime(C a) {
    F x=cinteger(a);
    if(fcompare(x,ffloat(2.0))<0) return cfloat(0.0);
    for(int k=2;k<1000000 && numericStatus==0;k++) {
        F divisor=ffloat(float(k));
        if(fcompare(fmul(divisor,divisor),x)>0) return cfloat(1.0);
        F q=ftruncated(fdiv(x,divisor)),r=fsub(x,fmul(q,divisor));
        if(r.s<0) r=fadd(r,divisor);
        if(fcompare(r,divisor)>=0) r=fsub(r,divisor);
        if(r.error!=EXACT) { numericFail(1); return cfloat(0.0); }
        if(r.s==0) return cfloat(0.0);
    }
    numericFail(3); return cfloat(0.0);
}

// The expression tape calls these small bound/classification kernels. The
// numerical recurrences themselves use the same arithmetic instructions as AC.
C numericPredicate(C a,int kind) {
    bool zero=rv(a.re).s==0 && rv(a.im).s==0 && rv(a.re).error==EXACT && rv(a.im).error==EXACT;
    bool integer=rv(a.im).s==0 && rv(a.im).error==EXACT && exactInteger(rv(a.re));
    if(kind==0) return cbool(zero);
    if(kind==1) return cbool(integer);
    if(kind==2) return cbool(rv(a.re).s<0);
    if(kind==3) return cbool(fcompare(rv(a.re),ffloat(1.0))==0);
    if(kind==6) return cbool(fcompareMagnitude(rv(a.re),rv(a.im))>=0);
    if(kind==4) {
        if(integer && rv(a.re).s<=0) numericFail(2);
        return cbool(fcompare(rv(a.re),ffloat(0.5))<0);
    }
    return cbool(integer && flog(rv(a.re))<30.0 && !rdependent(a.re) && !rdependent(a.im));
}
C gammaShift(C z) {
    int terms=(15*(uWords-1)+3)/4+8;
    float distance=max(0.0,ceil(float(terms)-fsmall(rv(z.re))));
    if(distance>4096.0) { numericFail(3); return cfloat(0.0); }
    return cfloat(distance);
}
C gammaError(C sum,C w,C z) {
    int terms=(15*(uWords-1)+3)/4+8;
    float lower=flower(rv(w.re));
    if(lower==EXACT || rv(w.re).s<=0) { numericFail(1); return sum; }
    float tail=up(fupper(fconstant(uStirling+terms-1))-float(2*terms-1)*lower);
    float slope=cderivative(z)==EXACT ? EXACT : up(tail+log2(float(2*terms-1))-lower+cderivative(z));
    return cerror(sum,tail,slope);
}
C zetaLength(C z) {
    int terms=(15*(uWords-1)+3)/4+8;
    float sigma=fsmall(rv(z.re)),imaginary=abs(fsmall(rv(z.im)));
    if(uContinuation==0 && realCompare(z.re,rfloat(1.0))<=0) numericFail(2);
    if(sigma+float(2*terms-1)<=0.5) numericFail(1);
    if(imaginary>float(4096-terms-8)) { numericFail(3); return cfloat(0.0); }
    return cfloat(float(terms+8)+ceil(imaginary));
}
C zetaError(C sum,C z,C n) {
    int terms=(15*(uWords-1)+3)/4+8;
    float sigma=fsmall(rv(z.re)),tail=fupper(fconstant(uBernoulli+terms-1));
    for(int j=0;j<2*terms;j++) tail=up(tail+errorSum(cupper(cadd(z,cfloat(float(j)))),-2.0));
    float lowerSigma=sigma-max(0.0001,abs(sigma)*0.000001)-0.25;
    float denominator=lowerSigma+float(2*terms-1);
    tail=up(tail-denominator*log2(fsmall(rv(n.re)))-log2(denominator));
    if(rv(z.re).error> -20.0 || rv(z.im).error> -20.0) { numericFail(1); return sum; }
    return cerror(sum,tail,cderivative(z)==EXACT ? EXACT : up(tail+2.0+cderivative(z)));
}
C besselError(C order,C step,C term,inout C sum,C index) {
    float k=fsmall(rv(index.re));
    float sigma=fsmall(rv(order.re))-max(0.0001,abs(fsmall(rv(order.re)))*0.000001),stepBound=cupper(step);
    if(rv(order.re).error> -20.0) { numericFail(1); return cfloat(0.0); }
    float denominator=(k+1.0)*(sigma+k+1.0);
    if(denominator>0.0) {
        float ratio=exp2(clamp(up(stepBound-log2(denominator)),-126.0,126.0));
        if(ratio<0.5) {
            float tail=up(cupper(term)-log2(1.0-ratio));
            if(tail<max(0.0,cupper(sum))-float(BITS)+12.0) {
                float qDerivative=errorSum(cderivative(step)==EXACT ? EXACT : up(cderivative(step)-log2(denominator)),
                    cderivative(order)==EXACT ? EXACT : up(stepBound+cderivative(order)-log2(denominator)-log2(sigma+k+1.0)));
                float slope=errorSum(cderivative(term)==EXACT ? EXACT : up(cderivative(term)-log2(1.0-ratio)),
                    qDerivative==EXACT ? EXACT : up(cupper(term)+qDerivative-2.0*log2(1.0-ratio)));
                sum=cerror(sum,tail,slope); return cfloat(1.0);
            }
        }
    }
    return cfloat(0.0);
}
`;
}

// Build primitive recurrences into the map's instruction tape. They share its
// arithmetic dispatch; GLSL does not inline a second copy of the arithmetic
// library for every call site inside Gamma, zeta and Bessel.
export function domainSpecial({ emit, branch, repeat, predicate, constant, descriptor, operands, zero, one, op, words }) {
    const add=(a,b)=>emit(3,a,b), sub=(a,b)=>emit(4,a,b), mul=(a,b)=>emit(5,a,b), div=(a,b)=>emit(6,a,b);
    const neg=a=>emit(8,a), log=a=>emit(op.naturalLog,a), exp=a=>emit(op.exp,a);
    const scale=(a,k)=>emit(op.scale,a,zero,k), copy=a=>emit(0,a);
    const set=(to,value)=>emit(0,value,zero,0,to);
    const compare=(a,b,kind=20)=>emit(kind,a,b);
    const when=(test,body)=>branch(test,()=>{ body(); return zero; },()=>zero);
    let termCount;
    const terms=()=>termCount ??= constant(Math.ceil(15*(words-1)/4)+8);
    const logarithmicPower=(a,b)=>exp(mul(b,log(a)));
    const logGamma=z=>{
        const shift=emit(op.gammaShift,z),w=add(z,shift),inverse=div(one,w);
        const power=copy(inverse),sum=copy(sub(descriptor('',5),w));
        repeat(0,k=>compare(k,shift,21),k=>{
            const logarithm=log(add(z,k));
            set(sum,branch(compare(k,shift,18),
                ()=>add(sum,mul(sub(w,constant(0.5)),logarithm)),()=>sub(sum,logarithm)));
        });
        const square=mul(inverse,inverse);
        repeat(1,k=>compare(k,terms()),k=>{
            set(sum,add(sum,mul(emit(op.seriesConstant,k,zero,1),power)));
            set(power,mul(power,square));
        });
        return emit(op.gammaError,w,z,0,sum);
    };
    const gamma=z=>{
        const reflected=predicate(z,4);
        const argument=branch(reflected,()=>sub(one,z),()=>z);
        const value=exp(logGamma(argument));
        return branch(reflected,()=>{
            const pi=descriptor('',1);
            return div(pi,mul(emit(op.sin,mul(pi,z)),value));
        },()=>value);
    };
    const zeta=z=>{
        const n=emit(op.zetaLength,z),exponent=neg(z),sum=copy(zero);
        repeat(1,j=>compare(j,n),j=>set(sum,add(sum,logarithmicPower(j,exponent))));
        const power=copy(logarithmicPower(n,exponent));
        set(sum,add(sum,add(scale(power,-1),div(mul(n,power),sub(z,one)))));
        const rising=copy(z); set(power,div(power,n));
        repeat(1,k=>compare(k,terms(),21),k=>{
            set(sum,add(sum,mul(mul(emit(op.seriesConstant,k,zero,0),rising),power)));
            when(compare(k,terms()),()=>{
                const twice=scale(k,1);
                set(rising,mul(rising,mul(add(z,sub(twice,one)),add(z,twice))));
                set(power,div(power,mul(n,n)));
            });
        });
        return emit(op.zetaError,z,n,0,sum);
    };
    const bessel=(z,initialOrder)=>{
        const integer=predicate(initialOrder,1),reflected=mul(integer,predicate(initialOrder,2));
        const sign=branch(reflected,()=>sub(one,scale(emit(op.parity,initialOrder),1)),()=>one);
        const order=branch(reflected,()=>neg(initialOrder),()=>initialOrder);
        return branch(predicate(z,0),()=>branch(integer,
            ()=>branch(predicate(order,3),()=>mul(scale(sign,-1),z),()=>branch(predicate(order,0),()=>one,()=>zero)),
            ()=>emit(op.zeroPower,z,order)),()=>{
            const term=copy(exp(sub(mul(order,emit(op.log,scale(z,-1))),logGamma(add(order,one))))),sum=copy(term);
            const step=neg(scale(mul(z,z),-2)),converged=copy(zero);
            repeat(1,k=>mul(compare(k,constant(4096)),emit(16,converged)),k=>{
                set(term,div(mul(term,step),mul(k,add(order,k))));
                const accepted=emit(op.besselError,k,zero,operands([order,step,term,sum]));
                when(accepted,()=>set(converged,one));
                when(emit(16,accepted),()=>set(sum,add(sum,term)));
            });
            when(emit(16,converged),()=>emit(op.fail,zero,zero,1));
            return mul(sign,sum);
        });
    };
    return (name,z,order)=>({ gamma, loggamma:logGamma, zeta, bessel })[name](z,order);
}
