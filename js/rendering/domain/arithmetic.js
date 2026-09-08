// Compensated native FP32 pairs carry complex mantissas. An outward L1 error
// and a separate binary exponent preserve bounds and tiny deep-zoom deltas.
export const domainArithmetic = `
struct B { vec2 v; vec2 lo; float e; float r; };
B ball(vec2 v,float e,float r){return B(v,vec2(0.0),e,r);}
const float U=0.000000059604644775390625;
// WebGL lacks GLSL's precise qualifier. A runtime zero bit-mask makes each
// rounding point observable to the shader compiler, preventing reassociation
// from deleting the residual (s + e) - s. This uniform must always be zero.
uniform highp uint u_roundingBarrier;
float rounded(float v){return uintBitsToFloat(floatBitsToUint(v)^u_roundingBarrier);}
vec2 dsadd(vec2 a,vec2 b){
 float s=rounded(a.x+b.x),v=rounded(s-a.x);
 float e=rounded(rounded(a.x-rounded(s-v))+rounded(b.x-v));
 e=rounded(e+rounded(a.y+b.y));
 float h=rounded(s+e);return vec2(h,rounded(e-rounded(h-s)));
}
vec2 dsmul(vec2 a,vec2 b){
 float ah=uintBitsToFloat(floatBitsToUint(a.x)&0xfffff000u),al=rounded(a.x-ah);
 float bh=uintBitsToFloat(floatBitsToUint(b.x)&0xfffff000u),bl=rounded(b.x-bh);
 float p=rounded(a.x*b.x),e=rounded(rounded(ah*bh)-p);
 e=rounded(e+rounded(ah*bl));e=rounded(e+rounded(al*bh));e=rounded(e+rounded(al*bl));
 e=rounded(e+rounded(rounded(a.x*b.y)+rounded(a.y*b.x)));
 float h=rounded(p+e);return vec2(h,rounded(e-rounded(h-p)));
}
const float DU=128.0*U*U;
B bz(){return ball(vec2(0.0),0.0,0.0);}
B bi(){return ball(vec2(0.0),2000000.0,uintBitsToFloat(0x7f800000u));}
bool finiteB(B a){return !any(isnan(a.lo))&&!any(isinf(a.lo))&&abs(a.e)<=1000000.0&&a.r>=0.0&&!any(isnan(vec4(a.v,a.e,a.r)))&&!any(isinf(vec4(a.v,a.e,a.r)));}
bool zeroB(B a){return all(equal(a.v,vec2(0.0)))&&a.r==0.0&&all(equal(a.lo,vec2(0.0)));}
float norm1(vec2 v){return abs(v.x)+abs(v.y);}
B bn(B a){
 if(!finiteB(a))return bi();
 float m=max(max(abs(a.v.x),abs(a.v.y)),a.r);if(m==0.0)return bz();
 if(m<exp2(-120.0)){a.v*=exp2(120.0);a.lo*=exp2(120.0);a.r*=exp2(120.0);a.e-=120.0;m*=exp2(120.0);}
 if(m>exp2(120.0)){a.v*=exp2(-120.0);a.lo*=exp2(-120.0);a.r*=exp2(-120.0);a.e+=120.0;m*=exp2(-120.0);}
 int shift=int((floatBitsToUint(m)>>23u)&255u)-126;
 float scale=uintBitsToFloat(uint(127-shift)<<23u);
 a.v*=scale;a.lo*=scale;a.r*=scale;a.e+=float(shift);if(abs(a.e)>1000000.0)return bi();return a;
}
B bf(float x){return bn(ball(vec2(x,0.0),0.0,0.0));}
B bshift(B a,float bits){a.e+=bits;if(!finiteB(a))return bi();return a;}
B bneg(B a){a.v=-a.v;a.lo=-a.lo;return a;}
B bconj(B a){a.v.y=-a.v.y;a.lo.y=-a.lo.y;return a;}
B breal(B a){a.v.y=0.0;a.lo.y=0.0;return bn(a);}
B bimag(B a){a.v=vec2(a.v.y,0.0);a.lo=vec2(a.lo.y,0.0);return bn(a);}
float sizeB(B a){return (norm1(a.v)+norm1(a.lo))*(1.0+4.0*U);}
B alignB(B a,float e){
 if(zeroB(a))return a;
 float d=a.e-e;
 if(d < -120.0)return ball(vec2(0.0),e,(sizeB(a)+a.r)*exp2(-120.0)*(1.0+8.0*U));
 float scale=uintBitsToFloat(uint(127+int(d))<<23u);
 a.v*=scale;a.lo*=scale;a.r*=scale;a.e=e;return a;
}
B badd(B a,B b){
 if(zeroB(a))return b;if(zeroB(b))return a;
 float e=max(a.e,b.e);B x=alignB(a,e),y=alignB(b,e);
 vec2 re=dsadd(vec2(x.v.x,x.lo.x),vec2(y.v.x,y.lo.x));
 vec2 im=dsadd(vec2(x.v.y,x.lo.y),vec2(y.v.y,y.lo.y));
 float error=DU*(sizeB(x)+sizeB(y));
 return bn(B(vec2(re.x,im.x),vec2(re.y,im.y),e,(x.r+y.r+error)*(1.0+8.0*U)));
}
B bsub(B a,B b){return badd(a,bneg(b));}
B bmul(B a,B b){
 vec2 ar=vec2(a.v.x,a.lo.x),ai=vec2(a.v.y,a.lo.y),br=vec2(b.v.x,b.lo.x),bb=vec2(b.v.y,b.lo.y);
 vec2 re=dsadd(dsmul(ar,br),-dsmul(ai,bb)),im=dsadd(dsmul(ar,bb),dsmul(ai,br));
 float x=sizeB(a),y=sizeB(b),error=DU*x*y;
 return bn(B(vec2(re.x,im.x),vec2(re.y,im.y),a.e+b.e,(x*b.r+y*a.r+a.r*b.r+error)*(1.0+16.0*U)));
}
B bscale(B a,float s){return bmul(a,bf(s));}
B binv(B a){
 if(!finiteB(a))return bi();
 // One Newton correction of the FP32 inverse, performed with high/low pairs.
 B scaled=a;scaled.e=0.0;
 float m=max(abs(a.v.x),abs(a.v.y)),lower=m-norm1(a.lo)-a.r-4.0*U*m;
 if(lower<=0.0)return bi();
 B guess=ball(vec2(a.v.x,-a.v.y)/dot(a.v,a.v),0.0,0.0);
 B mid=scaled;mid.r=0.0;
 B correction=bmul(guess,bsub(bf(1.0),bmul(mid,guess)));
 B result=badd(guess,correction);
 // The remaining Newton error is quadratic in the initial inverse residual.
 float initialError=32.0*U;
 float bound=(a.r/(m*lower)+initialError*initialError*sizeB(result)*exp2(result.e))*(1.0+16.0*U);
 result=badd(result,ball(vec2(0.0),0.0,bound));
 return bshift(bn(result),-a.e);
}
B bdiv(B a,B b){return bmul(a,binv(b));}
B magnitudeUpper(B a){return bn(ball(vec2((length(a.v)+norm1(a.lo)+a.r)*(1.0+8.0*U),0.0),a.e,0.0));}
B upperB(B a){return bn(ball(vec2((sizeB(a)+a.r)*(1.0+8.0*U),0.0),a.e,0.0));}
bool upperLess(B a,B b){a=upperB(a);b=upperB(b);if(zeroB(a))return !zeroB(b);if(zeroB(b))return false;return a.e<b.e||(a.e==b.e&&a.v.x<b.v.x);}
B withError(B a,B error){error=upperB(error);return badd(a,ball(vec2(0.0),error.e,error.v.x));}
int truthB(B a){if(!finiteB(a))return -1;if(max(abs(a.v.x),abs(a.v.y))>a.r+norm1(a.lo))return 1;return zeroB(a)?0:-1;}
B testB(B a,B b,int kind){
 if(kind==42){if(!finiteB(a))return bi();return bf(1.0);}
 if(kind==16||kind==24){int t=truthB(a);if(t<0)return bi();return bf(float(kind==16?1-t:t));}
 B d=bsub(a,b);if(!finiteB(d))return bi();
 if(kind==18||kind==19){int t=truthB(d);if(t<0)return bi();return bf(float(kind==18?1-t:t));}
 if(a.v.y!=0.0||b.v.y!=0.0)return bi();
 int order=abs(d.v.x)>d.r+norm1(d.lo)?(d.v.x>0.0?1:-1):(zeroB(d)?0:2);if(order==2)return bi();
 return bf(float(kind==20?int(order<0):kind==21?int(order<=0):kind==22?int(order>0):int(order>=0)));
}
bool accurate(B a,float tolerance){return finiteB(a)&&(a.r==0.0||a.r<tolerance*(max(abs(a.v.x),abs(a.v.y))-norm1(a.lo)));}
float outward(float x,bool up){
 if(x==0.0){if(up)return exp2(-126.0);return -exp2(-126.0);}
 uint bits=floatBitsToUint(x);if((x>0.0)==up)bits++;else bits--;return uintBitsToFloat(bits);
}
B integerB(B a,B b,int kind){
 if(!finiteB(a)||a.v.y!=0.0||a.e>22.0)return bi();
 float scale=exp2(max(a.e,-120.0)),x=a.v.x*scale,r=a.r*scale;
 r+=norm1(a.lo)*scale;float lo=x,hi=x,v=0.0;if(r>0.0){lo=outward(x-r,false);hi=outward(x+r,true);}
 if(kind==28){if(floor(lo)!=floor(hi))return bi();v=floor(x);}
 else if(kind==29){if(ceil(lo)!=ceil(hi))return bi();v=ceil(x);}
 else if(kind==30){if(round(lo)!=round(hi))return bi();v=round(x);}
 else if(kind==31){if(trunc(lo)!=trunc(hi))return bi();v=trunc(x);}
 else if(kind==32){if(sign(lo)!=sign(hi))return bi();v=sign(x);}
 else if(kind==35){
   B q=bdiv(a,b);if(!finiteB(q)||q.v.y!=0.0||q.e>22.0)return bi();float s=exp2(max(q.e,-120.0));
   float qr=(q.r+norm1(q.lo))*s,qx=q.v.x*s,ql=qx,qh=qx;
   if(qr>0.0){ql=outward(qx-qr,false);qh=outward(qx+qr,true);}
   if(trunc(ql)!=trunc(qh))return bi();return bsub(a,bscale(b,trunc(qx)));
 }else{
   if(r!=0.0||x!=trunc(x))return bi();
   if(kind==17){if(x<0.0||x>10000.0)return bi();B result=bf(1.0);for(int j=2;j<=int(x);j++)result=bscale(result,float(j));return result;}
   if(kind==37){int n=int(x);bool prime=n>=2;for(int j=2;j*j<=n;j++)if(n%j==0){prime=false;break;}return bf(prime?1.0:0.0);}
   if(kind!=36||!finiteB(b)||b.v.y!=0.0||b.r!=0.0||any(notEqual(b.lo,vec2(0.0)))||b.e>22.0)return bi();float y=b.v.x*exp2(max(b.e,-120.0));if(y!=trunc(y))return bi();
   int aa=abs(int(x)),bb=abs(int(y));for(int j=0;j<48&&bb!=0;j++){int t=aa%bb;aa=bb;bb=t;}v=float(aa);
 }
 return bf(v);
}
`;
