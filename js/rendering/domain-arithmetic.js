// One radix-2^15 evaluator at every precision. Integer products and carries
// fit uint32 exactly; truncation and analytic tails carry absolute error bounds.
export function domainArithmetic(words, derivative) {
    return `
#define W ${words}
#define BITS ${15 * (words - 1)}
const float EXACT=-1.0e30;
const uint RADIX=32768u, MASK=32767u;
int numericStatus=0; // 1: more precision, 2: undefined input, 3: resource limit
void numericFail(int code) { if(numericStatus==0) numericStatus=code; }
#define word(a,i) a[(i)>>2][(i)&3]
struct F { uvec4 d[(W+3)/4]; int e; int s; float error; };
uniform highp usampler2D uNumbers;
// Dynamic loop bounds keep drivers from expanding every limb operation into
// thousands of instructions at high precision. W only sizes the storage.
uniform int uNumberRows,uWords,uNewtonSteps,uComponents;
float up(float x) { return x+max(0.00002,abs(x)*0.000001); }
float errorSum(float a,float b) {
    if(a==EXACT) return b; if(b==EXACT) return a;
    float m=max(a,b);
    float d=min(a,b)-m;
    if(d < -24.0) return up(m);
    return up(m+log2(1.0+exp2(max(-126.0,d))));
}
F fzero() { F a; for(int i=0;i<(uWords+3)/4;i++) a.d[i]=uvec4(0u); a.e=0; a.s=0; a.error=EXACT; return a; }
F fconstant(int row) {
    int column=(row/uNumberRows)*((W+7)/4); row%=uNumberRows;
    uvec4 h=texelFetch(uNumbers,ivec2(column,row),0); F a=fzero();
    a.s=int(h.x); a.e=int(h.y); a.error=uintBitsToFloat(h.z);
    for(int i=0;i<(uWords+3)/4;i++) a.d[i]=texelFetch(uNumbers,ivec2(column+1+i,row),0);
    return a;
}
F fnormal(F a) {
    int n=0; for(int i=0;i<uWords;i++) { if(word(a.d,i)!=0u) break; n++; }
    if(n==W) { a.s=0; a.e=0; return a; }
    if(n>0) { for(int i=0;i<uWords;i++) word(a.d,i)=i+n<uWords ? word(a.d,i+n) : 0u; a.e-=n; }
    if(abs(a.e)>1000000) numericFail(3);
    return a;
}
float flog(F a) {
    if(a.s==0) return EXACT;
    return float(15*a.e)+log2(float(word(a.d,0))+float(word(a.d,1))/32768.0+float(word(a.d,2))/1073741824.0);
}
float fupper(F a) { return errorSum(a.s==0 ? EXACT : up(flog(a)),a.error); }
float flower(F a) {
    if(a.s==0) return EXACT;
    float magnitude=flog(a),m=magnitude-max(0.00002,abs(magnitude)*0.000001);
    if(a.error>=m) return EXACT;
    return m+log2(1.0-exp2(max(-126.0,a.error-m)))-0.00002;
}
F ffloat(float x) {
    F a=fzero(); uint bits=floatBitsToUint(x),exponent=(bits>>23)&255u,mantissa=bits&8388607u;
    if(exponent==255u) { numericFail(3); return a; }
    if(exponent==0u && mantissa==0u) return a;
    a.s=(bits>>31)==0u ? 1 : -1;
    int power=exponent==0u ? -149 : int(exponent)-150;
    if(exponent!=0u) mantissa|=8388608u;
    int q=power/15,r=power-q*15; if(r<0) { q--; r+=15; }
    uint low=(mantissa&MASK)<<uint(r),high=((mantissa>>15)<<uint(r))+(low>>15);
    a.e=q+2; word(a.d,0)=high>>15; word(a.d,1)=high&MASK; word(a.d,2)=low&MASK;
    return fnormal(a);
}
F fneg(F a) { a.s=-a.s; return a; }
F fabsval(F a) { a.s=abs(a.s); return a; }
int fcompareMagnitude(F a,F b) {
    if(a.s==0 || b.s==0) return a.s==0 ? (b.s==0 ? 0 : -1) : 1;
    if(a.e!=b.e) return a.e<b.e ? -1 : 1;
    for(int i=0;i<uWords;i++) if(word(a.d,i)!=word(b.d,i)) return word(a.d,i)<word(b.d,i) ? -1 : 1;
    return 0;
}
int fcompare(F a,F b) {
    if(a.s!=b.s) return a.s<b.s ? -1 : 1;
    return a.s*fcompareMagnitude(a,b);
}
F fadd(F a,F b) {
    if(a.s==0) { b.error=errorSum(a.error,b.error); return b; }
    if(b.s==0) { a.error=errorSum(a.error,b.error); return a; }
    if(fcompareMagnitude(a,b)<0) { F t=a; a=b; b=t; }
    F c=fzero(); c.s=a.s; c.e=a.e; c.error=errorSum(a.error,b.error);
    int shift=a.e-b.e; uvec4 t[(W+4)/4]; int carry=0;
    for(int i=uWords;i>=0;i--) {
        int j=i-shift;
        int x=i<W ? int(word(a.d,i)) : 0;
        int y=j>=0 && j<W ? int(word(b.d,j)) : 0;
        int v=x+(a.s==b.s ? y : -y)+carry;
        carry=v<0 ? -1 : v>=32768 ? 1 : 0;
        word(t,i)=uint(v-carry*32768);
    }
    for(int j=0;j<uWords;j++) if(j+shift>W && word(b.d,j)!=0u) {
        c.error=errorSum(c.error,float(15*(c.e-W))); break;
    }
    if(carry>0) {
        if(word(t,W)!=0u || word(t,W-1)!=0u) c.error=errorSum(c.error,float(15*(c.e-W+2)));
        c.e++; word(c.d,0)=uint(carry); for(int i=1;i<uWords;i++) word(c.d,i)=word(t,i-1);
    } else {
        int start=0; for(int i=0;i<uWords+1;i++) { if(word(t,i)!=0u) break; start++; }
        if(start==W+1) { c.s=0; c.e=0; return c; }
        c.e-=start;
        for(int i=0;i<uWords;i++) word(c.d,i)=i+start<=W ? word(t,i+start) : 0u;
        if(start==0 && word(t,W)!=0u) c.error=errorSum(c.error,float(15*(c.e-W+1)));
    }
    return fnormal(c);
}
F fsub(F a,F b) { return fadd(a,fneg(b)); }
F fmul(F a,F b) {
    F c=fzero();
    if(a.error==EXACT && b.error==EXACT) {
        c.error=EXACT;
    } else {
        c.error=errorSum(a.error==EXACT || b.s==0 ? EXACT : a.error+up(flog(b)),
            b.error==EXACT || a.s==0 ? EXACT : b.error+up(flog(a)));
        c.error=errorSum(c.error,a.error==EXACT || b.error==EXACT ? EXACT : up(a.error+b.error));
    }
    if(a.s==0 || b.s==0) return c;
    uvec4 t[(2*W+3)/4]; for(int i=0;i<(2*uWords+3)/4;i++) t[i]=uvec4(0u);
    for(int i=uWords-1;i>=0;i--) {
        if(word(a.d,i)==0u) continue;
        uint carry=0u;
        for(int j=uWords-1;j>=0;j--) {
            uint v=word(a.d,i)*word(b.d,j)+word(t,i+j+1)+carry;
            word(t,i+j+1)=v&MASK; carry=v>>15;
        }
        word(t,i)=carry;
    }
    int start=word(t,0)==0u ? 1 : 0;
    c.s=a.s*b.s; c.e=a.e+b.e+1-start;
    for(int i=0;i<uWords;i++) word(c.d,i)=word(t,i+start);
    for(int i=uWords+start;i<2*uWords;i++) if(word(t,i)!=0u) {
        c.error=errorSum(c.error,float(15*(c.e-W+1))); break;
    }
    return fnormal(c);
}
F fscale(F a,int bits) {
    int q=bits/15,r=bits-q*15; if(r<0) { q--; r+=15; }
    a.e+=q; if(a.error!=EXACT) a.error=up(a.error+float(bits));
    uint carry=0u;
    for(int i=uWords-1;i>=0;i--) { uint v=(word(a.d,i)<<uint(r))+carry; word(a.d,i)=v&MASK; carry=v>>15; }
    if(carry!=0u) {
        if(word(a.d,W-1)!=0u) a.error=errorSum(a.error,float(15*(a.e-W+2)));
        for(int i=uWords-1;i>0;i--) word(a.d,i)=word(a.d,i-1); word(a.d,0)=carry; a.e++;
    }
    return fnormal(a);
}
float fsmall(F a) {
    if(a.s==0) return 0.0;
    return float(a.s)*(float(word(a.d,0))+float(word(a.d,1))/32768.0)*exp2(clamp(float(15*a.e),-126.0,126.0));
}
F fdivideSmall(F a,uint divisor) {
    if(divisor==0u) { numericFail(2); return fzero(); }
    uvec4 digits[(W+5)/4]; uint carry=0u;
    for(int i=0;i<uWords+2;i++) {
        uint value=carry*RADIX+(i<W ? word(a.d,i) : 0u);
        word(digits,i)=value/divisor; carry=value%divisor;
    }
    F result=fzero(); result.s=a.s;
    int start=0; for(int i=0;i<2;i++) { if(word(digits,i)!=0u) break; start++; }
    result.e=a.e-start;
    for(int i=0;i<uWords;i++) word(result.d,i)=word(digits,start+i);
    result.error=a.error==EXACT ? EXACT : up(a.error-log2(float(divisor)));
    bool rounded=carry!=0u;
    for(int i=uWords+start;i<uWords+2;i++) rounded=rounded || word(digits,i)!=0u;
    if(rounded) result.error=errorSum(result.error,float(15*(result.e-W+1)));
    return fnormal(result);
}
F fdiv(F a,F b) {
    F zero=fzero(); float lower=flower(b);
    if(lower==EXACT) { numericFail(b.s==0 && b.error==EXACT ? 2 : 1); return zero; }
    if(a.s==0 && a.error==EXACT) return zero;
    if(b.error==EXACT && b.e>=0 && b.e<=1) {
        bool integer=true; for(int i=2;i<uWords;i++) integer=integer && word(b.d,i)==0u;
        integer=integer && (b.e==1 || word(b.d,1)==0u);
        uint divisor=b.e==0 ? word(b.d,0) : word(b.d,0)*RADIX+word(b.d,1);
        if(integer && divisor<65536u) { F quotient=fdivideSmall(a,divisor); quotient.s*=b.s; return quotient; }
    }
    F result=fzero();
    if(a.s!=0) {
        // Normalized radix long division (Knuth D). Each quotient estimate
        // uses two limbs; normalization bounds correction to two decrements.
        // All products stay below 2^30, including their carries.
        uvec4 denominator[(W+3)/4],remainder[(W+4)/4],quotient[(W+4)/4];
        int shift=0; uint top=word(b.d,0);
        for(int s=0;s<15 && top>0u && top<16384u;s++) { top<<=1; shift++; }
        uint ac=0u,bc=0u;
        for(int i=uWords-1;i>=0;i--) {
            uint av=(word(a.d,i)<<uint(shift))+ac,bv=(word(b.d,i)<<uint(shift))+bc;
            word(remainder,i+1)=av&MASK; ac=av>>15;
            word(denominator,i)=bv&MASK; bc=bv>>15;
        }
        word(remainder,0)=ac;
        for(int digit=0;digit<=uWords;digit++) {
            uint head=word(remainder,0)*RADIX+word(remainder,1);
            uint q=min(MASK,head/word(denominator,0)),r=head-q*word(denominator,0);
            for(int step=0;step<2 && r<RADIX && q*word(denominator,1)>r*RADIX+word(remainder,2);step++) {
                q--; r+=word(denominator,0);
            }
            uint carry=0u; int borrow=0;
            for(int i=uWords-1;i>=0;i--) {
                uint product=q*word(denominator,i)+carry; carry=product>>15;
                int difference=int(word(remainder,i+1))-int(product&MASK)-borrow;
                borrow=difference<0 ? 1 : 0;
                word(remainder,i+1)=uint(difference+borrow*32768);
            }
            int high=int(word(remainder,0))-int(carry)-borrow;
            if(high<0) {
                q--; carry=0u;
                for(int i=uWords-1;i>=0;i--) {
                    uint sum=word(remainder,i+1)+word(denominator,i)+carry;
                    word(remainder,i+1)=sum&MASK; carry=sum>>15;
                }
                high+=int(carry);
            }
            word(remainder,0)=uint(high); word(quotient,digit)=q;
            if(digit<uWords) {
                for(int i=0;i<uWords;i++) word(remainder,i)=word(remainder,i+1);
                word(remainder,uWords)=0u;
            }
        }
        int start=word(quotient,0)==0u ? 1 : 0;
        result.s=a.s*b.s; result.e=a.e-b.e-start;
        for(int i=0;i<uWords;i++) word(result.d,i)=word(quotient,i+start);
        bool rounded=start==0 && word(quotient,uWords)!=0u;
        for(int i=0;i<=uWords;i++) rounded=rounded || word(remainder,i)!=0u;
        if(rounded) result.error=up(float(15*(result.e-W+1))+up(flog(b))-lower);
    }
    float inputError=a.error;
    if(b.error!=EXACT && result.s!=0) inputError=errorSum(inputError,up(b.error+flog(result)));
    if(inputError!=EXACT) result.error=errorSum(result.error,up(inputError-lower));
    return result;
}
F fsqrt(F x) {
    if(x.s==0 && x.error==EXACT) return x;
    if(x.s<0 || flower(x)==EXACT) { numericFail(x.s<0 && flower(x)!=EXACT ? 2 : 1); return fzero(); }
    int exponent=int(floor(flog(x)/2.0));
    F scaled=fscale(x,-2*exponent);
    F y=fscale(ffloat(sqrt(fsmall(scaled))),exponent),exact=x; exact.error=EXACT;
    for(int k=0;k<uNewtonSteps;k++) {
        y=fscale(fadd(y,fdiv(exact,y)),-1); y.error=EXACT;
    }
    F residual=fsub(exact,fmul(y,y));
    float e=errorSum(fupper(residual),x.error);
    y.error=e==EXACT ? EXACT : up(e-flower(y)); return y;
}
// An integer chosen for argument reduction is exact data. Its choice need not
// be the nearest integer: the reconstructed remainder retains the input error.
F ftruncated(F a) {
    a.error=EXACT;
    if(a.e<0) return fzero();
    for(int i=0;i<uWords;i++) if(i>a.e) word(a.d,i)=0u;
    return fnormal(a);
}
int fmod4(F a) { int i=a.e; return i>=0 && i<W ? int(word(a.d,i)&3u)*a.s : 0; }
F fnearest(F a) { return ftruncated(fadd(a,ffloat(a.s<0 ? -0.5 : 0.5))); }
${derivative ? `
struct R { F v; F d; bool dependent; };
R realNumber(F x) { return R(x,fzero(),false); }
F rv(R x) { return x.v; }
F rd(R x) { return x.d; }
F jetComponent(R x,int i) { if(i==0) return x.v; return x.d; }
R radd(R a,R b) {
    R result; result.dependent=a.dependent || b.dependent;
    for(int i=0;i<uComponents;i++) {
        F value=fadd(jetComponent(a,i),jetComponent(b,i));
        if(i==0) result.v=value; else result.d=value;
    }
    return result;
}
R rneg(R a) { return R(fneg(a.v),fneg(a.d),a.dependent); }
R rmul(R a,R b) {
    R result; result.dependent=a.dependent || b.dependent;
    for(int i=0;i<uComponents;i++) {
        F value=fzero();
        for(int j=0;j<=i;j++) value=fadd(value,fmul(jetComponent(a,j),jetComponent(b,i-j)));
        if(i==0) result.v=value; else result.d=value;
    }
    return result;
}
R rdiv(R a,R b) {
    R result; result.dependent=a.dependent || b.dependent;
    for(int i=0;i<uComponents;i++) {
        F numerator=jetComponent(a,i);
        if(i==1) numerator=fsub(numerator,fmul(result.v,b.d));
        F value=fdiv(numerator,b.v);
        if(i==0) result.v=value; else result.d=value;
    }
    return result;
}
R rsqrt(R a) { F v=fsqrt(a.v); if(v.s==0 && a.d.s==0 && a.d.error==EXACT) return R(v,fzero(),a.dependent); return R(v,fdiv(a.d,fscale(v,1)),a.dependent); }
R rscale(R a,int k) { return R(fscale(a.v,k),fscale(a.d,k),a.dependent); }
R rdivideSmall(R a,uint n) { return R(fdivideSmall(a.v,n),fdivideSmall(a.d,n),a.dependent); }
R rerrors(R a,float value,float slope) { a.v.error=errorSum(a.v.error,value); a.d.error=errorSum(a.d.error,slope); return a; }
bool rdependent(R a) { return a.dependent; }
R rseed(R a) { a.d=ffloat(1.0); a.dependent=true; return a; }
` : `
#define R F
#define realNumber(x) (x)
#define rv(x) (x)
#define rd(x) fzero()
#define radd fadd
#define rneg fneg
#define rmul fmul
#define rdiv fdiv
#define rsqrt fsqrt
#define rscale fscale
#define rdivideSmall fdivideSmall
R rerrors(R a,float value,float slope) { a.error=errorSum(a.error,value); return a; }
#define rdependent(x) false
#define rseed(x) (x)
`}
${derivative ? `R rfloat(float x) { return realNumber(ffloat(x)); }
R rconstant(int i) { return realNumber(fconstant(i)); }` : `#define rfloat ffloat
#define rconstant fconstant`}
R rsub(R a,R b) { return radd(a,rneg(b)); }
F fseriesTail(F sum,F next,float factor) {
    float bound=fupper(next);
    if(bound!=EXACT) sum.error=errorSum(sum.error,up(bound+factor));
    return sum;
}
bool fseriesSmall(F term,F sum) { return fupper(term)<max(0.0,flog(sum))-float(BITS)+8.0; }
F foddSeries(F t,int sign) {
    F q=fmul(t,t); if(sign<0) q=fneg(q);
    F power=t,sum=t;
    if(fupper(q)>=-1.0) { numericFail(1); return sum; }
    for(int n=1;n<8*uWords+32 && numericStatus==0;n++) {
        power=fmul(power,q); F term=fdivideSmall(power,uint(2*n+1));
        if(fseriesSmall(term,sum)) return fseriesTail(sum,term,1.0);
        sum=fadd(sum,term);
    }
    numericFail(1); return sum;
}
F fexpValue(F x) {
    F integer=fnearest(fmul(x,fconstant(3)));
    if(flog(integer)>23.0) { numericFail(3); return ffloat(0.0); }
    int k=int(fsmall(integer)); F r=fsub(x,fmul(integer,fconstant(1)));
    if(fupper(r)>0.0) { numericFail(1); return r; }
    F sum=ffloat(1.0),term=sum;
    for(int n=1;n<2*uWords+32 && numericStatus==0;n++) {
        term=fdivideSmall(fmul(term,r),uint(n));
        if(fseriesSmall(term,sum)) return fscale(fseriesTail(sum,term,1.0),k);
        sum=fadd(sum,term);
    }
    numericFail(1); return sum;
}
void fsincos(F x,out F sine,out F cosine) {
    F integer=fnearest(fmul(x,fconstant(2)));
    F r=fsub(x,fmul(integer,fscale(fconstant(0),-1)));
    if(fupper(r)>0.0) { numericFail(1); sine=ffloat(0.0); cosine=sine; return; }
    F q=fneg(fmul(r,r)),s=r,c=ffloat(1.0),st=s,ct=c;
    bool finished=false;
    for(int n=1;n<2*uWords+32 && numericStatus==0;n++) {
        st=fdivideSmall(fdivideSmall(fmul(st,q),uint(2*n)),uint(2*n+1));
        ct=fdivideSmall(fdivideSmall(fmul(ct,q),uint(2*n-1)),uint(2*n));
        if(fseriesSmall(st,s) && fseriesSmall(ct,c)) { s=fseriesTail(s,st,1.0); c=fseriesTail(c,ct,1.0); finished=true; break; }
        s=fadd(s,st); c=fadd(c,ct);
    }
    if(!finished) numericFail(1);
    int quadrant=(fmod4(integer)+4)%4;
    if(quadrant==0) { sine=s; cosine=c; }
    else if(quadrant==1) { sine=c; cosine=fneg(s); }
    else if(quadrant==2) { sine=fneg(s); cosine=fneg(c); }
    else { sine=fneg(c); cosine=s; }
}
void fsinhcosh(F x,out F sine,out F cosine) {
    // Reduce by powers of two, then double back. The odd series preserves
    // tiny sinh(x) directly; subtracting exp(x)-exp(-x) would erase it.
    int k=int(max(0.0,ceil(flog(x))));
    if(k>23) { numericFail(3); sine=ffloat(0.0); cosine=sine; return; }
    F r=fscale(x,-k),q=fmul(r,r),s=r,c=ffloat(1.0),st=s,ct=c;
    if(fupper(r)>1.0) { numericFail(1); sine=r; cosine=r; return; }
    bool finished=false;
    for(int n=1;n<2*uWords+32 && numericStatus==0;n++) {
        st=fdivideSmall(fdivideSmall(fmul(st,q),uint(2*n)),uint(2*n+1));
        ct=fdivideSmall(fdivideSmall(fmul(ct,q),uint(2*n-1)),uint(2*n));
        if(fseriesSmall(st,s) && fseriesSmall(ct,c)) { s=fseriesTail(s,st,1.0); c=fseriesTail(c,ct,1.0); finished=true; break; }
        s=fadd(s,st); c=fadd(c,ct);
    }
    if(!finished) numericFail(1);
    for(int j=0;j<k && numericStatus==0;j++) {
        F next=fscale(fmul(s,c),1); c=fadd(fmul(c,c),fmul(s,s)); s=next;
    }
    sine=s; cosine=c;
}
// Evaluate the bounded value series once. First derivatives use its analytic
// derivative and the same bounded scalar operations, rather than differentiating
// every term and every argument-reduction step of the numerical algorithm.
${derivative ? `
R rexp(R x) { F value=fexpValue(x.v); return R(value,fmul(value,x.d),x.dependent); }
void rtrigonometric(R x,bool hyperbolic,out R sine,out R cosine) {
    F s,c;
    if(hyperbolic) fsinhcosh(x.v,s,c); else fsincos(x.v,s,c);
    for(int i=0;i<uComponents;i++) {
        F value=s,slope=c;
        if(i==1) { value=c; slope=s; if(!hyperbolic) slope=fneg(slope); }
        R result=R(value,fmul(slope,x.d),x.dependent);
        if(i==0) sine=result; else cosine=result;
    }
}
` : `
#define rexp fexpValue
void rtrigonometric(R x,bool hyperbolic,out R sine,out R cosine) {
    if(hyperbolic) fsinhcosh(x,sine,cosine); else fsincos(x,sine,cosine);
}
`}
struct C { R re; R im; };
R component(C a,int i) { if(i==0) return a.re; return a.im; }
C cfloat(float x) { return C(rfloat(x),rfloat(0.0)); }
C cconstant(int re,int im) { return C(rconstant(re),rconstant(im)); }
C cadd(C a,C b) {
    C result;
    for(int i=0;i<uComponents;i++) {
        R value=radd(component(a,i),component(b,i));
        if(i==0) result.re=value; else result.im=value;
    }
    return result;
}
C cneg(C a) { return C(rneg(a.re),rneg(a.im)); }
C csub(C a,C b) { return cadd(a,cneg(b)); }
C cmul(C a,C b) {
    C result;
    // Share one limb-product body across the four real products. Runtime
    // component bounds prevent driver inlining from replicating its loops.
    for(int i=0;i<uComponents;i++) {
        R value=rfloat(0.0);
        for(int j=0;j<uComponents;j++) {
            R product=rmul(component(a,j),component(b,i^j));
            if(i==0 && j==1) product=rneg(product);
            value=radd(value,product);
        }
        if(i==0) result.re=value; else result.im=value;
    }
    return result;
}
C cscale(C a,int k) {
    C result;
    for(int i=0;i<uComponents;i++) {
        R value=rscale(component(a,i),k);
        if(i==0) result.re=value; else result.im=value;
    }
    return result;
}
C cdivideSmall(C a,uint n) {
    C result;
    for(int i=0;i<uComponents;i++) {
        R value=rdivideSmall(component(a,i),n);
        if(i==0) result.re=value; else result.im=value;
    }
    return result;
}
R cnormSquared(C a) {
    R result=rfloat(0.0);
    for(int i=0;i<uComponents;i++) { R x=component(a,i); result=radd(result,rmul(x,x)); }
    return result;
}
float cupper(C a) { return errorSum(fupper(rv(a.re)),fupper(rv(a.im))); }
float cderivative(C a) { return errorSum(fupper(rd(a.re)),fupper(rd(a.im))); }
C cerror(C a,float value,float slope) { a.re=rerrors(a.re,value,slope); a.im=rerrors(a.im,value,slope); return a; }
bool exactInteger(F a) { return a.error==EXACT && fcompare(a,ftruncated(a))==0; }
C czeroPower(C a,C b) {
    if(rv(b.im).s==0 && rv(b.im).error==EXACT && rv(b.re).s>0 && flower(rv(b.re))!=EXACT) {
        if((rdependent(a.re) || rdependent(a.im)) && fcompare(rv(b.re),ffloat(1.0))<=0) numericFail(2);
        return cfloat(0.0);
    }
    numericFail(2); return cfloat(0.0);
}

`;
}
