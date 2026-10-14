import {noiseViewport} from './noise-viewport';
import {noiseBufferSize,noiseRenderPolicy,NOISE_RESOLUTION_SCALES} from './noise-render-policy';
import {isMobileScreen} from './landscape';
import {noiseDrawBounds,type NoiseRegion} from './noise-draw-bounds';
// One fullscreen compositing pass. The source stays clean; only the region is distorted.
const vertex=`attribute vec2 position;varying vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
const fragment=`precision highp float;
varying vec2 uv;uniform sampler2D source;uniform sampler2D noiseGrain;uniform vec2 grainTexel;uniform float time;uniform float enabled;uniform vec4 regions[24];uniform float phases[24];uniform float strengths[24];uniform float regionSkew;uniform int regionCount;
uniform vec4 pointer;uniform float interactionTime;uniform sampler2D contactAtlas;uniform vec2 viewSize;
uniform float wipeTop;uniform float wipeBottom;uniform float overlay;uniform float picking;uniform vec2 pickPoint;
// Keep the sine input bounded: large page-uptime offsets can collapse GPU sin()
// precision and turn the animated silhouette into a straight, displaced edge.
vec2 wrapNoise(vec2 p){return mod(p,vec2(251.,239.));}
float hash(vec2 p){return fract(sin(dot(wrapNoise(p),vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){return noise(p)*.58+noise(p*2.03+17.)*.27+noise(p*4.01+39.)*.15;}
float box(vec2 p,vec4 r){vec2 d=abs(p-(r.xy+r.zw)*.5)-(r.zw-r.xy)*.5;return max(d.x,d.y);}
vec2 regionPoint(vec2 p){return vec2(p.x+(p.y-360.)*regionSkew,p.y);}
float redDistance(vec2 p){float distance=100000.;for(int i=0;i<24;i++){if(i>=regionCount)break;if(phases[i]>1.5)distance=min(distance,box(regionPoint(p),regions[i]));}return max(distance,max(wipeTop-p.y,p.y-wipeBottom));}
float evolvingNoise(vec2 p,float tick){
 float frame=mod(floor(tick),4096.),blend=smoothstep(0.,1.,fract(tick));
 vec2 current=wrapNoise(frame*vec2(37.,71.)),next=wrapNoise(mod(frame+1.,4096.)*vec2(37.,71.));
 return mix(noise(p+current),noise(p+next),blend);
}
float grainSample(vec2 at){return texture2D(noiseGrain,fract(at)).r;}
vec3 grainLight(vec2 at){
 // Separate the bright grain core from a faint, local halo. All taps use the
 // same decoded source frame, preserving HL's density and flicker timing.
 float raw=grainSample(at);
 vec2 near=grainTexel*1.5,far=grainTexel*3.5;
 float soft=(grainSample(at+vec2(near.x,0.))+grainSample(at-vec2(near.x,0.))
  +grainSample(at+vec2(0.,near.y))+grainSample(at-vec2(0.,near.y)))*.18;
 soft+=(grainSample(at+far)+grainSample(at-far)
  +grainSample(at+vec2(far.x,-far.y))+grainSample(at+vec2(-far.x,far.y)))*.07;
 float core=max(0.,raw-1./255.);
 float hot=smoothstep(.10,.38,core);
 vec3 tint=mix(vec3(.86,.12,.22),vec3(1.,.60,.50),hot);
 return tint*min(.82,core*1.32)+vec3(.72,.12,.19)*max(0.,soft-1./255.)*.24;
}
float roughCell(vec2 cell,float tick){
 vec2 p=(cell+.5)*3.;
 // The same multi-scale field forms the silhouette and detached fragments.
 // Slow lobes persist across frames; small branches split and rejoin locally.
 float broad=evolvingNoise(p*.028,tick*1.7);
 float branch=evolvingNoise(p*.087+31.,tick*3.8);
 float fine=evolvingNoise(p*.235+87.,tick*7.1);
 float displacement=(broad-.5)*40.+(branch-.5)*22.+(fine-.5)*10.;
 // Displace the shared union so touching rectangles have no internal rim.
 return 1.-step(0.,redDistance(p+vec2(displacement,evolvingNoise(p*.043+19.,tick*2.1)*28.-14.)));
}
vec3 contactFrame(float frame,vec2 at){
 vec2 tile=vec2(mod(frame,8.),floor(frame/8.));
 vec2 uv=(tile*196.+vec2(2.5)+at*191.)/vec2(1568.,1764.);
 return texture2D(contactAtlas,uv).rgb;
}
vec3 contactLight(vec2 delta,float clock,float amount){
 // 72 consecutive 60 fps reference frames, background-separated offline.
 // Sample only the light pattern; hit testing, fade and illumination stay live.
 if(amount<.001)return vec3(0.);
 vec2 at=delta/(240.*(.45+.55*amount))+.5;
 if(min(at.x,at.y)<0.||max(at.x,at.y)>1.)return vec3(0.);
 float frame=mod(clock*60.,72.),index=floor(frame);
 return mix(contactFrame(index,at),contactFrame(mod(index+1.,72.),at),fract(frame))*amount;
}
void main(){
 if(picking>.5){float hit=redDistance(pickPoint)<36.?roughCell(floor(pickPoint/3.),time):0.;gl_FragColor=vec4(hit,0.,0.,1.);return;}
 vec2 sampleUV=vec2(uv.x,1.-uv.y);
 vec2 p=(sampleUV-.5)*viewSize+vec2(640.,360.);
 vec4 sourcePixel=texture2D(source,sampleUV);vec3 original=sourcePixel.rgb;vec3 color=original;float coverage=0.;
 if(enabled<.5){gl_FragColor=vec4(color,1.-overlay);return;}
 float contact=0.;
 if(pointer.z>.001||pointer.w>.001){
  if(redDistance(pointer.xy)<36.)contact=roughCell(floor(pointer.xy/3.),time);
 }
 for(int i=0;i<24;i++){
  if(i>=regionCount)break;
  if(phases[i]<.5||phases[i]>1.5)continue;
  float d=box(regionPoint(p),regions[i]);if(d>1.)continue;
  vec3 flecks=grainLight(p/vec2(1280.,960.)+vec2(0.,.125));
  float m=(1.-smoothstep(-.5,.5,d))*mix(1.,sourcePixel.a,overlay);
  coverage=max(coverage,m*mix(1.,strengths[i],overlay));
  // Pink is a transparent top layer, not another enlarged copy of the artwork.
  color=mix(mix(color,vec3(.95,.40,.61),m*strengths[i]),vec3(.95,.40,.61),overlay);
  color+=flecks*m*mix(strengths[i],1.,overlay)*.82;
 }
 float d=redDistance(p);
 if(d<36.){
  float strength=0.;for(int i=0;i<24;i++){if(i>=regionCount)break;if(phases[i]>1.5&&box(regionPoint(p),regions[i])<36.)strength=max(strength,strengths[i]);}vec3 flecks=grainLight(p/vec2(1280.,960.)+vec2(0.,.125));
  vec2 cell=floor(p/3.),local=mod(p,3.);float edgeTime=time;
  float mask=1.;vec4 neighbor=vec4(1.);
  if(d> -39.){
   mask=roughCell(cell,edgeTime);
   neighbor=vec4(roughCell(cell+vec2(-1,0),edgeTime),roughCell(cell+vec2(1,0),edgeTime),roughCell(cell+vec2(0,-1),edgeTime),roughCell(cell+vec2(0,1),edgeTime));
  }
  vec4 toEdge=vec4(local.x,3.-local.x,local.y,3.-local.y);
  vec4 boundary=abs(neighbor-vec4(mask))*(1.-smoothstep(vec4(.55),vec4(1.15),toEdge));
  float border=max(max(boundary.x,boundary.y),max(boundary.z,boundary.w));
  // Smooth turbulence plus independently quantized displacement, as in the AE reference.
  float t=floor(time*30.)/30.;vec2 blocks=floor(p/vec2(7.,5.));
  vec2 warp=vec2(noise(p*.038+wrapNoise(vec2(time*2.7))),noise(p*.031+wrapNoise(vec2(-time*3.1))))-.5;
  warp*=12.;warp+=vec2(hash(blocks+wrapNoise(vec2(floor(t*19.)))),hash(blocks+wrapNoise(vec2(floor(t*17.)+41.)))) * 7.-3.5;
  vec2 warped=clamp(sampleUV+warp/viewSize,0.,1.);
  vec3 distorted=texture2D(source,warped).rgb;
  float shading=fbm(p*vec2(.009,.016));
  vec3 red=vec3(.13,.009,.018)+vec3(.07,.009,.012)*shading;
  // Two views of the same current frame: a dim, unmoved base and a brighter
  // turbulent copy. No previous-frame feedback or synthetic temporal trail.
  float bright=smoothstep(.25,.85,max(distorted.r,max(distorted.g,distorted.b)));
  vec3 lower=original*.23+red;
  vec3 upper=distorted*(.12+bright*.48);
  vec3 inside=lower+upper;
  inside+=flecks;
  // Broad illumination is clipped by the domain's exact mask; hover is dimmer.
  vec2 fromPointer=p-pointer.xy;
  float illumination=exp(-dot(fromPointer,fromPointer)/36000.)*pointer.w*contact;
  inside=inside*(1.+illumination*.75)+vec3(.13,.009,.015)*illumination;
  coverage=max(coverage,mask*strength);color=mix(color,inside,mask);
  float halo=dot(abs(neighbor-vec4(mask)),vec4(.018));
  float flicker=.86+.14*evolvingNoise(p*.061,time*3.);
  if(overlay>.5){
   float rimAlpha=clamp((border*.72+halo)*strength*flicker,0.,1.);
   float combined=coverage+rimAlpha*(1.-coverage);
   vec3 rim=vec3(.95,.18,.32);
   color=(color*coverage*(1.-rimAlpha)+rim*rimAlpha)/max(combined,.001);
   coverage=combined;
  }else color+=vec3(.55,.15,.19)*(border*.72+halo)*strength*flicker;
  // Illuminate the existing rim; do not change its accepted geometry or motion.
  float reflection=exp(-dot(fromPointer,fromPointer)/18000.)*contact*pointer.z*(.95+.5*pointer.w);
  vec3 reflectionTint=mix(vec3(.95,.13,.23),vec3(1.,.42,.46),smoothstep(.35,1.3,reflection));
  color+=reflectionTint*(border*.95+halo*1.5)*reflection*mask*strength;
 }
 // The separate contact patch may cross the boundary, unlike illumination.
 vec3 patch=contactLight(p-pointer.xy,interactionTime,pointer.z)*contact;
 float light=max(patch.r,max(patch.g,patch.b));
 // Alpha-composite the red reference pattern; additive blending washes it out on white.
 vec3 tint=patch/max(light,.001);
 tint=vec3(tint.r,min(tint.g,.18),min(tint.b,.25));
 vec3 lit=mix(color,tint,clamp(light*1.5,0.,1.));
 float patchAlpha=clamp(light,0.,1.);
 float alpha=coverage+patchAlpha*(1.-coverage);
 // Straight-alpha output: do not multiply the pink layer by its opacity twice.
 vec3 composite=(lit*coverage+tint*patchAlpha*(1.-coverage))/max(alpha,.001);
 gl_FragColor=vec4(mix(lit,composite,overlay),mix(1.,alpha,overlay));
}`;

export type {NoiseRegion} from './noise-draw-bounds';
export function noiseRegions(time:number):NoiseRegion[]{
 const result:NoiseRegion[]=[];
 for(let n=0;n<8;n++){
  const active=.8+n*1.9,start=active-1.533,age=time-active;
  if(time<start||age>=1.9)continue;
  const upper=n%2===1,y=upper?242:372;
  let left=276,right=1004,phase:0|1|2=1,strength=.32;
  if(age<0){
   const grow=Math.min(1,(time-start)/1.1);
   if(upper)right=left+728*grow;else left=right-728*grow;
   // Bright/dim pulses on the solid pink region, followed by a whole-region state switch.
   if(age>-.53)strength=.34+.12*Math.pow(.5+.5*Math.cos((age+.53)*Math.PI*12),3);
  }else{
   phase=2;strength=1;
   const progress=Math.min(1,age/1.9);
   if(upper)left+=728*progress;else right-=728*progress;
  }
  result.push({rect:[left,y,right,y+145],phase,strength});
 }
 return result.slice(-2);
}

export class NoiseDomainRenderer{
 private readonly policy=noiseRenderPolicy(isMobileScreen());
 private gl:WebGLRenderingContext;private program:WebGLProgram;private texture:WebGLTexture;private grainTexture:WebGLTexture;private contactTexture:WebGLTexture;
 private pickTexture:WebGLTexture;private pickBuffer:WebGLFramebuffer;private pickPixel=new Uint8Array(4);
 private inputPoint:[number,number]|null=null;private contactPoint:[number,number]=[-1000,-1000];private pressed=false;private hovering=false;
 private hoverStrength=0;private pressStrength=0;private interactionStamp=performance.now();
 private reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 private locations:Record<string,WebGLUniformLocation|null>={};
 private rects=new Float32Array(96);private phases=new Float32Array(24);private strengths=new Float32Array(24);
 private sourceDirty=true;private sourceCanvas:HTMLCanvasElement|null=null;private sourceWidth=0;private sourceHeight=0;
 private grainDirty=true;private grainTime=-1;private videoFrameRequest:number|undefined;private disposed=false;
 private markGrainDirty=()=>{this.grainDirty=true;};
 private sizeDirty=true;private dpr=0;private observer:ResizeObserver;
 private wipeTop=-100000.;private wipeBottom=100000.;
 setWipeTop(top:number|null,bottom:number|null=null){this.wipeTop=top??-100000.;this.wipeBottom=bottom??100000.;}
 private overlay=false;
 setOverlay(value:boolean){this.overlay=value;}
 private viewportScale:number|undefined;
 setViewportScale(scale:number|undefined){if(this.viewportScale!==scale){this.viewportScale=scale;this.sizeDirty=true;}}
 private viewWidth=1280;private viewHeight=720;private regionSkew=0;
 setRegionSkew(value:number){this.regionSkew=value;}
 setReducedMotion(value:boolean){this.reduced=value;}
 private quality=0;private sampleMs=0;private frameSamples=0;private slowFrames=0;private healthyWindows=0;
 private draws=0;private sourceUploads=0;private videoUploads=0;private activeRegions=0;private shadedPixels=0;
 invalidateSource(){this.sourceDirty=true;}
 noteFrameInterval(ms:number){
  if(ms<=0||ms>1000)return;
  this.sampleMs+=Math.min(ms,250);this.frameSamples++;if(ms>this.policy.frameMs*1.2)this.slowFrames++;
  if(this.sampleMs<1500)return;
  const slow=this.slowFrames/this.frameSamples;
  if(slow>.2){const next=Math.min(NOISE_RESOLUTION_SCALES.length-1,this.quality+1);if(next!==this.quality){this.quality=next;this.sizeDirty=true;}this.healthyWindows=0;}
  else if(slow<.02){if(++this.healthyWindows>=6&&this.quality>0){this.quality--;this.sizeDirty=true;this.healthyWindows=0;}}
  else this.healthyWindows=0;
  this.sampleMs=0;this.frameSamples=0;this.slowFrames=0;
 }
 get resolutionScale(){return NOISE_RESOLUTION_SCALES[this.quality]!;}
 get performanceState(){return{draws:this.draws,sourceUploads:this.sourceUploads,videoUploads:this.videoUploads,activeRegions:this.activeRegions,shadedPixels:this.shadedPixels,resolutionScale:this.resolutionScale,width:this.canvas.width,height:this.canvas.height};}
 setPointer(x:number,y:number,pressed=false){this.inputPoint=[x,y];this.pressed=pressed;}
 clearPointer(){this.inputPoint=null;this.pressed=false;}
 get interactionActive(){return this.hovering||this.hoverStrength>.001||this.pressStrength>.001;}
 get interactionState(){return{position:this.contactPoint,strength:this.hoverStrength,illumination:this.pressStrength};}
 isRedAt(x:number,y:number){
  if(!this.draws||this.disposed)return false;
  const gl=this.gl;gl.useProgram(this.program);gl.bindFramebuffer(gl.FRAMEBUFFER,this.pickBuffer);gl.viewport(0,0,1,1);
  gl.uniform1f(this.locations.picking,1);gl.uniform2f(this.locations.pickPoint,x,y);gl.drawArrays(gl.TRIANGLES,0,6);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,this.pickPixel);
  gl.uniform1f(this.locations.picking,0);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.canvas.width,this.canvas.height);
  return this.pickPixel[0]>127;
 }
 constructor(private canvas:HTMLCanvasElement,private grainVideo:HTMLVideoElement,contactImage:HTMLImageElement,private requestDraw?:()=>void){
  const gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:false,antialias:false,preserveDrawingBuffer:true});if(!gl)throw Error('当前浏览器无法启用 WebGL');this.gl=gl;
  const compile=(kind:number,code:string)=>{const s=gl.createShader(kind)!;gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)||'Shader error');return s;};
  const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment),program=gl.createProgram()!;gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)||'Link error');this.program=program;gl.useProgram(program);
  const buffer=gl.createBuffer()!;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const attr=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
  this.texture=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  this.grainTexture=gl.createTexture()!;gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.grainTexture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
  this.contactTexture=gl.createTexture()!;gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.contactTexture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,contactImage);
  gl.uniform1i(gl.getUniformLocation(program,'source'),0);gl.uniform1i(gl.getUniformLocation(program,'noiseGrain'),1);gl.uniform1i(gl.getUniformLocation(program,'contactAtlas'),2);
  for(const name of ['time','enabled','pointer','interactionTime','grainTexel','viewSize','regions[0]','phases[0]','strengths[0]','regionCount','regionSkew','wipeTop','wipeBottom','overlay','picking','pickPoint'])this.locations[name]=gl.getUniformLocation(program,name);
  this.pickTexture=gl.createTexture()!;gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.pickTexture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  this.pickBuffer=gl.createFramebuffer()!;gl.bindFramebuffer(gl.FRAMEBUFFER,this.pickBuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.pickTexture,0);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  this.observer=new ResizeObserver(()=>{this.sizeDirty=true;this.requestDraw?.();});this.observer.observe(canvas);
  grainVideo.addEventListener('seeked',this.markGrainDirty);
  if(typeof grainVideo.requestVideoFrameCallback==='function'){
   const frame=()=>{if(this.disposed)return;this.grainDirty=true;this.videoFrameRequest=grainVideo.requestVideoFrameCallback(frame);};
   this.videoFrameRequest=grainVideo.requestVideoFrameCallback(frame);
  }
 }
 render(source:HTMLCanvasElement,time:number,enabled=true,regions=noiseRegions(time)){
  const gl=this.gl;
  if(this.sizeDirty||this.dpr!==devicePixelRatio){
   const rect=this.canvas.getBoundingClientRect(),quality=this.resolutionScale;
   const view=noiseViewport(rect.width,rect.height,this.viewportScale);this.viewWidth=view.width;this.viewHeight=view.height;
   const {width:w,height:h}=noiseBufferSize(rect.width,rect.height,devicePixelRatio,this.policy,quality);
   if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
   this.sizeDirty=false;this.dpr=devicePixelRatio;
  }
  const stamp=performance.now(),dt=Math.min(.05,Math.max(0,(stamp-this.interactionStamp)/1000));this.interactionStamp=stamp;
  // Broad-phase only; the shader tests the actual jagged mask at the pointer.
  const input=this.inputPoint;const hit=input?[input[0]+(input[1]-360)*this.regionSkew,input[1]]:null;
  this.hovering=Boolean(enabled&&hit&&regions.some(r=>r.phase===2&&hit[0]>=r.rect[0]-36&&hit[0]<=r.rect[2]+36&&hit[1]>=r.rect[1]-36&&hit[1]<=r.rect[3]+36));
  if(this.hovering&&input)this.contactPoint=input;
  this.hoverStrength=Math.max(0,Math.min(1,this.hoverStrength+dt*(this.hovering?1/.12:-1/.10)));
  const lightTarget=this.hovering?(this.pressed?1:.7):0,lightDelta=lightTarget-this.pressStrength;
  this.pressStrength+=Math.sign(lightDelta)*Math.min(Math.abs(lightDelta),dt/(lightDelta>0?.05:.22));
  gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.useProgram(this.program);
  if(this.sourceDirty||this.sourceCanvas!==source||this.sourceWidth!==source.width||this.sourceHeight!==source.height){
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
   this.sourceCanvas=source;this.sourceWidth=source.width;this.sourceHeight=source.height;this.sourceDirty=false;this.sourceUploads++;
  }
  const mediaTime=this.grainVideo.currentTime;
  const fallback=this.videoFrameRequest===undefined&&Math.floor(mediaTime*60)!==Math.floor(this.grainTime*60);
  if(enabled&&this.grainVideo.readyState>=2&&(this.grainDirty||fallback||Math.abs(mediaTime-this.grainTime)>.1)){
   gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.grainTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.grainVideo);
   this.grainDirty=false;this.grainTime=mediaTime;this.videoUploads++;
  }
  const u=this.locations;
  gl.uniform1f(u.wipeTop,this.wipeTop);gl.uniform1f(u.wipeBottom,this.wipeBottom);gl.uniform1f(u.overlay,this.overlay?1:0);gl.uniform1f(u.time,time);gl.uniform1f(u.enabled,enabled?1:0);
  gl.uniform2f(u.viewSize,this.viewWidth,this.viewHeight);gl.uniform1f(u.regionSkew,this.regionSkew);
  gl.uniform4f(u.pointer,...this.contactPoint,this.hoverStrength,this.pressStrength);
  gl.uniform1f(u.interactionTime,this.reduced?0:stamp/1000);
  gl.uniform2f(u.grainTexel,1/Math.max(1,this.grainVideo.videoWidth),1/Math.max(1,this.grainVideo.videoHeight));
  this.rects.fill(0);this.phases.fill(0);this.strengths.fill(0);
  this.activeRegions=Math.min(24,regions.length);gl.uniform1i(u.regionCount,this.activeRegions);
  for(let i=0;i<this.activeRegions;i++){this.rects.set(regions[i].rect,i*4);this.phases[i]=regions[i].phase;this.strengths[i]=regions[i].strength;}
  gl.uniform4fv(u['regions[0]'],this.rects);gl.uniform1fv(u['phases[0]'],this.phases);gl.uniform1fv(u['strengths[0]'],this.strengths);
  // Clear the old overlay, then shade only its occupied bounds. Picking stays unscissored.
  gl.disable(gl.SCISSOR_TEST);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
  this.shadedPixels=this.canvas.width*this.canvas.height;
  if(this.overlay&&enabled){
   const bounds=noiseDrawBounds(regions,this.regionSkew,this.contactPoint,this.hoverStrength);
   const x=(value:number)=>(value-(1280-this.viewWidth)/2)/this.viewWidth*this.canvas.width;
   const y=(value:number)=>(value-(720-this.viewHeight)/2)/this.viewHeight*this.canvas.height;
   const left=bounds?Math.max(0,Math.min(this.canvas.width,Math.floor(x(bounds.left)))):0;
   const right=bounds?Math.max(left,Math.min(this.canvas.width,Math.ceil(x(bounds.right)))):0;
   const top=bounds?Math.max(0,Math.min(this.canvas.height,Math.floor(y(bounds.top)))):0;
   const bottom=bounds?Math.max(top,Math.min(this.canvas.height,Math.ceil(y(bounds.bottom)))):0;
   gl.enable(gl.SCISSOR_TEST);gl.scissor(left,this.canvas.height-bottom,right-left,bottom-top);
   this.shadedPixels=(right-left)*(bottom-top);
  }
  gl.drawArrays(gl.TRIANGLES,0,6);gl.disable(gl.SCISSOR_TEST);this.draws++;
 }
 dispose(){this.disposed=true;this.observer.disconnect();this.grainVideo.removeEventListener('seeked',this.markGrainDirty);if(this.videoFrameRequest!==undefined)this.grainVideo.cancelVideoFrameCallback(this.videoFrameRequest);this.gl.deleteFramebuffer(this.pickBuffer);this.gl.deleteTexture(this.pickTexture);this.gl.deleteTexture(this.texture);this.gl.deleteTexture(this.grainTexture);this.gl.deleteTexture(this.contactTexture);this.gl.deleteProgram(this.program);/* Keep the reusable canvas context intact for reactivation. */}
}
