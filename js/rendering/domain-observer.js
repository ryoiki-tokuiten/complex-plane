import { domainEvaluator } from './domain-evaluator.js';

const MATH = `
const float EPS = 1.1920928955078125e-7;
const float LN2 = 0.6931471805599453;
const float PI = 3.141592653589793;
float normUpper(vec2 z) {
    float s=max(abs(z.x),abs(z.y));
    return s==0.0 ? 0.0 : s*length(z/s)*(1.0+8.0*EPS);
}
float splitExponent(float x, out int exponent) {
    uint bits=floatBitsToUint(x);
    exponent=int((bits>>23u)&255u)-126;
    return uintBitsToFloat((bits&8388607u)|1056964608u);
}
// Range reduction keeps both series uniformly convergent. This avoids relying
// on implementation-dependent GLSL transcendental accuracy for certification.
float logarithm(float x) {
    int e; float m = splitExponent(x, e) * 2.0;
    float t = (m-1.0)/(m+1.0), q = t*t, s = 1.0/17.0;
    for (int k=7; k>=0; --k) s = 1.0/float(2*k+1)+q*s;
    return 2.0*t*s+float(e-1)*LN2;
}
float exponential(float x) {
    int e = int(floor(x/LN2+0.5));
    float t = x-float(e)*LN2, s = 1.0;
    for (int k=9; k>=1; --k) s = 1.0+t*s/float(k);
    return s*uintBitsToFloat(uint(e+127)<<23u);
}
float positivePower(float x, float p) { return x<=0.0 ? 0.0 : exponential(p*logarithm(x)); }
float argument(vec2 z) {
    if (z == vec2(0.0)) return 0.0;
    vec2 a=abs(z); float r=min(a.x,a.y)/max(a.x,a.y), offset=0.0;
    if (r>0.414213562373095) { r=(r-1.0)/(r+1.0); offset=PI*0.25; }
    float q=r*r, s=1.0/21.0;
    for (int k=9; k>=0; --k) s=1.0/float(2*k+1)-q*s;
    float angle=offset+r*s;
    if (a.y>a.x) angle=PI*0.5-angle;
    if (z.x<0.0) angle=PI-angle;
    return z.y<0.0 ? -angle : angle;
}
`;

export function domainFragment(words, derivative) {
    return `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uCenter,uPalette,uAccepted;
uniform int uAA,uMode,uCount,uPaletteCount,uZeroSeed,uSeed,uAttractorTolerance;
uniform vec2 uSize,uOffset;
uniform float uPaletteSlope,uPaletteSeam;
uniform vec4 uStyle;
out vec4 outColor;
${MATH}
${domainEvaluator(words, derivative)}
struct Value { vec2 z; float error; float exponent; int escapeClass; };
Value observed(C z) {
    F x=${derivative ? 'rd' : 'rv'}(z.re),y=${derivative ? 'rd' : 'rv'}(z.im);
    float exponent=max(flog(x),flog(y)); if(exponent==EXACT) exponent=0.0;
    exponent=floor(exponent);
    vec2 value=vec2(0.0); float error=errorSum(x.error,y.error);
    for(int i=0;i<2;i++) {
        F a=x; if(i==1) a=y;
        if(a.s==0) continue;
        float scale=float(15*a.e)-exponent;
        if(scale< -126.0) { error=errorSum(error,up(flog(a))); continue; }
        value[i]=float(a.s)*(float(word(a.d,0))+float(word(a.d,1))/32768.0+float(word(a.d,2))/1073741824.0)*exp2(scale);
    }
    float relative=error==EXACT ? 0.0 : exp2(clamp(up(error-exponent),-126.0,126.0));
    relative+=16.0*EPS*length(value);
    return Value(value,relative,exponent,y.s==0 && y.error==EXACT ? 64 : 0);
}
void magnitudeBounds(Value v, out float lower, out float upper) {
    float scale=max(abs(v.z.x),abs(v.z.y));
    float m=scale==0.0 ? 0.0 : scale*length(v.z/scale);
    float e=v.error+16.0*EPS*m;
    lower=max(0.0,m-e); upper=m+e;
}
vec3 palette(float hue) {
    float position=clamp(hue,0.0,1.0)*float(uPaletteCount-1);
    int i=min(uPaletteCount-2,int(floor(position)));
    return mix(texelFetch(uPalette,ivec2(i,0),0).rgb,
               texelFetch(uPalette,ivec2(i+1,0),0).rgb,position-float(i));
}
bool color(Value v, int iteration, out vec3 rgb) {
    float lower,upper; magnitudeBounds(v,lower,upper);
    bool zero=upper==0.0;
    float relative=zero || lower==0.0 ? 0.0 : v.error/lower;
    float phaseError=(v.escapeClass&64)!=0 ? 0.0 : relative/PI+8.0e-6;
    float hue=fract(argument(v.z)/(2.0*PI)+1.0);
    float logMod=zero ? -69.07755278982137 : logarithm(max(abs(v.z.x),abs(v.z.y)))
        +0.5*logarithm(dot(v.z/max(abs(v.z.x),abs(v.z.y)),v.z/max(abs(v.z.x),abs(v.z.y))))+v.exponent*LN2;
    float logError=2.0*relative+8.0e-6*(1.0+abs(logMod));
    float lightness, lightnessError;
    if (uMode==0) {
        float detail=max(0.05,uStyle.w);
        float tone=clamp(0.5+clamp(logMod/138.15510557964274,-0.5,0.5)*detail,0.0,1.0);
        lightness=uStyle.w<=0.0001 ? 0.5 : 0.34+0.38*tone;
        lightnessError=uStyle.w<=0.0001 ? 0.0 : 0.38*detail*logError/138.15510557964274;
        if (abs(logMod)-logError>69.07755278982137) lightnessError=0.0;
    } else if (uMode==1) {
        float smoothIteration=float(iteration)-logarithm(max(logMod/9.210340371976184,1.0e-6))/LN2;
        float intensity=clamp(smoothIteration/float(uCount),0.0,1.0);
        float intensityError=logError/(max(9.210340371976184,logMod-logError)*LN2*float(uCount))+8.0e-6;
        hue=min(0.9999,intensity); phaseError=intensityError;
        lightness=0.22+0.58*positivePower(intensity,0.65);
        lightnessError=0.58*(positivePower(min(1.0,intensity+intensityError),0.65)
            -positivePower(max(0.0,intensity-intensityError),0.65))+8.0e-6;
    } else {
        float intensity=1.0-float(iteration-1)/float(uCount);
        lightness=0.24+0.58*positivePower(intensity,0.55);
        lightnessError=8.0e-6;
    }
    float l=clamp((0.5+(lightness-0.5)*uStyle.y)*uStyle.x,0.05,0.95);
    vec3 base=palette(hue);
    base=l<0.5 ? base*(2.0*l) : mix(base,vec3(1.0),2.0*l-1.0);
    rgb=clamp(mix(vec3(dot(base,vec3(0.299,0.587,0.114))),base,clamp(uStyle.z,0.0,1.0)),0.0,1.0);
    return true;
}

void finishFailure() { outColor=vec4(0.0,0.0,0.0,1.0); }
F eventDistance(C z,C checkpoint) {
    F magnitude=fzero(),separation=fzero();
    // Both observers use squared Euclidean distances. Share their limb
    // operations; the mode selects operands and the comparison threshold.
    for(int metric=0;metric<(uMode==2 ? 2 : 1);metric++) {
        F sum=fzero();
        for(int i=0;i<uComponents;i++) {
            F x=rv(component(z,i));
            if(metric==1) x=fsub(x,rv(component(checkpoint,i)));
            sum=fadd(sum,fmul(x,x));
        }
        if(metric==0) magnitude=sum; else separation=sum;
    }
    F left=magnitude,right=ffloat(100000000.0);
    if(uMode==2) {
        if(fcompare(magnitude,ffloat(1.0))<0) { F one=ffloat(1.0); one.error=magnitude.error; magnitude=one; }
        left=separation; right=fmul(magnitude,fconstant(uAttractorTolerance));
    }
    return fsub(left,right);
}
void main() {
    // A shader that discards can make stencil rejection late on some drivers.
    // Check the immutable completion mask before doing numerical work.
    if(texelFetch(uAccepted,ivec2(gl_FragCoord.xy),0).r!=0.0) discard;
    if(uAA!=0) {
        ivec2 pixel=ivec2(gl_FragCoord.xy); vec4 center=texelFetch(uCenter,pixel,0);
        bool complete=center.a==1.0,edge=false;
        for(int i=0;i<4;i++) {
            ivec2 d=i==0 ? ivec2(-1,0) : i==1 ? ivec2(1,0) : i==2 ? ivec2(0,-1) : ivec2(0,1),p=pixel+d;
            if(any(lessThan(p,ivec2(0))) || any(greaterThanEqual(p,ivec2(uSize)))) continue;
            vec4 neighbor=texelFetch(uCenter,p,0); complete=complete && neighbor.a==1.0;
            edge=edge || any(greaterThanEqual(abs(center.rgb-neighbor.rgb),vec3(79.5/255.0)));
        }
        if(complete && !edge) discard;
    }
    vec2 pixel=vec2(gl_FragCoord.x,uSize.y-gl_FragCoord.y)+uOffset;
    R x=radd(rconstant(4),rmul(rconstant(6),rdivideSmall(rfloat(pixel.x-uSize.x*0.5),uint(uSize.x))));
    R y=radd(rconstant(5),rmul(rconstant(7),rdivideSmall(rfloat(uSize.y*0.5-pixel.y),uint(uSize.y))));
    C parameter=C(rseed(x),y),z=parameter; if(uZeroSeed!=0) z=cconstant(uSeed,uSeed+1); C checkpoint=z;
    int checkpointPower=1;
    for(int iteration=1;iteration<=uCount;iteration++) {
        z=evaluateMap(z,parameter);
        if(numericStatus!=0) { finishFailure(); return; }
        bool event=uMode==0 && iteration==uCount;
        if(uMode==1 || (uMode==2 && iteration>=2)) {
            F distance=eventDistance(z,checkpoint);
            if(distance.error!=EXACT && flower(distance)==EXACT) { numericFail(1); finishFailure(); return; }
            event=uMode==1 ? distance.s>0 : distance.s<=0;
        }
        if(event) {
            vec3 rgb;
            if(!color(observed(z),iteration,rgb)) { outColor=vec4(0.0,0.0,0.0,1.0); return; }
            outColor=vec4(rgb,1.0); return;
        }
        if(iteration>=2 && iteration-1==checkpointPower) { checkpoint=z; checkpointPower*=2; }
    }
    outColor=vec4(0.0,0.0,0.0,1.0);
}`;
}
