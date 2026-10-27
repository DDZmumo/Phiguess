import {setNoiseMuffled} from './audio-output';
import {NoiseDomainRenderer,type NoiseRegion} from './noise-domain-renderer';
import {noiseViewport} from './noise-viewport';
import {noiseBufferSize,noiseRenderPolicy} from './noise-render-policy';
import {isMobileScreen} from './landscape';

let stage:NoiseStage|undefined;
export function isNoiseRedAt(x:number,y:number){return stage?.isRedAt(x,y)??false;}
const hitListeners=new Set<(kind:'click'|'hover')=>void>();
export function subscribeNoiseHits(listener:(kind:'click'|'hover')=>void){hitListeners.add(listener);return()=>{hitListeners.delete(listener);};}
let media:{video:HTMLVideoElement;ready:Promise<void>}|undefined;
export function noiseVideo(){
 if(!media){
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.loop=true;video.preload='auto';video.src='/effects/noise-domain/hl-noise-60.mp4';
  const ready=new Promise<void>((resolve,reject)=>{video.addEventListener('loadeddata',()=>resolve(),{once:true});video.addEventListener('error',()=>reject(new Error('Noise material unavailable')),{once:true});video.load();});
  media={video,ready};
 }
 return media;
}

/** A lightweight contribution to the page's single WebGL noise stage. */
export class NoiseLayer {
 source?:HTMLCanvasElement;regions:NoiseRegion[]=[];revision=0;skew=0;reduced=false;
 scale:number|undefined;top=-100000;bottom=100000;
 update?:((stamp:number)=>void);
 readonly owner:NoiseStage;
 constructor(readonly canvas:HTMLCanvasElement,video:HTMLVideoElement,atlas:HTMLImageElement,_requestDraw?:()=>void){
  this.owner=stage??=new NoiseStage(video,atlas);this.owner.layers.add(this);
 }
 setOverlay(_enabled:boolean){}
 setFrameCallback(update:(stamp:number)=>void){this.update=update;}
 setRegionSkew(value:number){this.skew=value;}
 setReducedMotion(value:boolean){this.reduced=value;}
 setViewportScale(value:number|undefined){this.scale=value;}
 setWipeTop(top:number|null,bottom:number|null=null){this.top=top??-100000;this.bottom=bottom??100000;}
 invalidateSource(){this.revision++;}
 noteFrameInterval(_ms:number){}
 render(source:HTMLCanvasElement,_time:number,enabled=true,regions:NoiseRegion[]=[]){
  this.source=source;this.regions=enabled?regions:[];
  const r=this.canvas.getBoundingClientRect(),{width:w,height:h}=noiseBufferSize(r.width,r.height,devicePixelRatio,this.owner.policy,this.owner.resolutionScale);
  if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
 }
 setPointer(_x:number,_y:number,_pressed=false){} // Pointer mapping is owned by the shared stage.
 clearPointer(){}
 isRedAt(x:number,y:number){const r=this.canvas.getBoundingClientRect(),v=noiseViewport(r.width,r.height,this.scale);return this.owner.isRedAt(r.left+(x-v.left)*v.scale,r.top+(y-v.top)*v.scale);}
 capture(target:HTMLCanvasElement){this.owner.capture(this,target);}
 dispose(){this.owner.layers.delete(this);if(!this.owner.layers.size){this.owner.dispose();stage=undefined;}}
}

class NoiseStage {
 readonly layers=new Set<NoiseLayer>();
 readonly policy=noiseRenderPolicy(isMobileScreen());
 get resolutionScale(){return this.renderer.resolutionScale;}
 private canvas=document.createElement('canvas');private source=document.createElement('canvas');
 private renderer:NoiseDomainRenderer;private raf=0;private signature='';private geometry='';private last=0;private contextLost=false;
 private frameAt=0;private updateAt=0;
 private pointer:PointerEvent|null=null;
 private nextHoverDamage=0;
 private hoverRegions:NoiseRegion[]=[];private hoverHit=false;private nextHoverPick=0;
 private tutorial=document.querySelector<HTMLElement>('.tutorial-real-screen');
 private updateHover(){
  const now=performance.now(),pointer=this.pointer;
  let eligible=Boolean(pointer&&pointer.pointerType!=='touch'&&!(pointer.target instanceof Element&&pointer.target.closest('[data-noise-safe]'))&&!document.hidden&&!document.querySelector('dialog[open]')&&this.canvas.style.visibility==='visible');
  if(eligible&&pointer){
   const v=this.view(),y=v.top+pointer.clientY/v.scale,x=v.left+pointer.clientX/v.scale+(y-360)*.2679491924;
   eligible=this.hoverRegions.some(r=>r.phase===2&&r.strength>.01&&x>=r.rect[0]-40&&x<=r.rect[2]+40&&y>=r.rect[1]-40&&y<=r.rect[3]+40);
  }
  if(!eligible){this.hoverHit=false;this.nextHoverPick=0;}
  else if(now>=this.nextHoverPick){this.hoverHit=this.isRedAt(pointer!.clientX,pointer!.clientY);this.nextHoverPick=now+100;}
  const inside=eligible&&this.hoverHit;
  setNoiseMuffled(inside);
  // Tutorial restrictions gate damage, while hovering still changes the audio.
  const damageAllowed=!this.tutorial?.isConnected||!this.tutorial.inert&&this.tutorial.dataset.tutorialStep==='10'&&Boolean(pointer?.target instanceof Element&&pointer.target.closest('.art-frame'));
  if(!inside||!damageAllowed){this.nextHoverDamage=0;return;}
  if(!this.nextHoverDamage)this.nextHoverDamage=now+2000;
  else if(now>=this.nextHoverDamage){
   // Recheck the actual edge before charging; never charge from a stale hover sample.
   if(!this.isRedAt(pointer!.clientX,pointer!.clientY)){this.hoverHit=false;this.nextHoverDamage=0;setNoiseMuffled(false);return;}
   this.nextHoverDamage=now+2000;for(const listener of hitListeners)listener('hover');
  }
 }

 private onPointer=(event:PointerEvent)=>{if(event.pointerType==='touch'&&event.type==='pointerup'){this.onLeave();return;}this.pointer=event;this.updateHover();};
 private onLeave=()=>{this.pointer=null;this.renderer.clearPointer();this.nextHoverDamage=0;this.hoverHit=false;this.nextHoverPick=0;setNoiseMuffled(false);};
 private onHit=(event:PointerEvent)=>{
  if(event.target instanceof Element&&event.target.closest('[data-noise-safe]'))return;
  if(event.button!==0||!event.isPrimary||document.querySelector('dialog[open]')||this.canvas.style.visibility==='hidden'||!this.isRedAt(event.clientX,event.clientY))return;
  event.preventDefault();event.stopImmediatePropagation();this.pointer=event;
  for(const listener of hitListeners)listener('click');
 };
 private onClick=(event:MouseEvent)=>{
  if(event.target instanceof Element&&event.target.closest('[data-noise-safe]'))return;
  // Keyboard/implicit form activation has no pointer coordinates; Game handles Enter separately.
  if(event.detail===0)return;
  if(document.querySelector('dialog[open]')||this.canvas.style.visibility==='hidden'||!this.isRedAt(event.clientX,event.clientY))return;
  event.preventDefault();event.stopImmediatePropagation();
 };
 private onContextLost=(event:Event)=>{event.preventDefault();this.contextLost=true;this.canvas.style.visibility='hidden';this.video.pause();this.onLeave();};
 private onContextRestored=()=>{
  this.renderer.dispose();this.renderer=this.createRenderer();this.signature='';this.geometry='';this.last=0;this.contextLost=false;
 };
 private createRenderer(){const renderer=new NoiseDomainRenderer(this.canvas,this.video,this.atlas);renderer.setOverlay(true);renderer.setRegionSkew(.2679491924);return renderer;}
 private tick=(stamp:number)=>{
   this.raf=0;if(this.paused())return;
   this.raf=requestAnimationFrame(this.tick);
   const interval=this.frameAt?stamp-this.frameAt:0;this.frameAt=stamp;
   if(this.canvas.style.visibility==='visible')this.renderer.noteFrameInterval(interval);
   if(stamp-this.updateAt>=this.policy.frameMs-.2){
    this.updateAt=stamp-Math.max(0,stamp-this.updateAt-this.policy.frameMs)%this.policy.frameMs;
    for(const layer of this.layers)layer.update?.(stamp);
    this.paint();
   }
   this.updateHover();
 };
 private modalObserver:MutationObserver;
 private modalOpen=false;
 private paused(){return document.hidden||this.modalOpen;}
 private onVisibility=()=>{
  this.modalOpen=Boolean(document.querySelector('dialog[open]'));
  if(this.paused()){cancelAnimationFrame(this.raf);this.raf=0;this.video.pause();this.onLeave();}
  else if(!this.raf){this.frameAt=0;this.updateAt=0;this.raf=requestAnimationFrame(this.tick);}
 };
 constructor(private video:HTMLVideoElement,private atlas:HTMLImageElement){
  this.canvas.className='shared-noise-stage';this.canvas.setAttribute('aria-hidden','true');
  Object.assign(this.canvas.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh',pointerEvents:'none',zIndex:'2147483645'});
  document.body.append(this.canvas);this.renderer=this.createRenderer();
  document.addEventListener('pointerdown',this.onHit,true);document.addEventListener('click',this.onClick,true);
  this.canvas.addEventListener('webglcontextlost',this.onContextLost);this.canvas.addEventListener('webglcontextrestored',this.onContextRestored);
  document.addEventListener('pointermove',this.onPointer,{passive:true});document.addEventListener('pointerdown',this.onPointer,{passive:true});document.addEventListener('pointerup',this.onPointer,{passive:true});document.addEventListener('pointerleave',this.onLeave);window.addEventListener('blur',this.onLeave);
  document.addEventListener('pointercancel',this.onLeave);document.addEventListener('visibilitychange',this.onVisibility);
  this.modalObserver=new MutationObserver(this.onVisibility);this.modalObserver.observe(document.body,{attributes:true,subtree:true,attributeFilter:['open']});
  this.onVisibility();
 }
 private view(){const art=document.querySelector('.art-frame')?.getBoundingClientRect();return noiseViewport(innerWidth,innerHeight,art&&art.width?noiseViewport(art.width+96,art.height+96).scale:undefined);}
 isRedAt(x:number,y:number){if(this.contextLost||this.canvas.style.visibility!=='visible')return false;const v=this.view();return this.renderer.isRedAt(v.left+x/v.scale,v.top+y/v.scale);}
 private paint(force?:NoiseLayer){
  if(this.contextLost)return;
  const items=[...this.layers].filter(l=>l.source&&l.canvas.isConnected&&(l===force||l.canvas.style.visibility==='visible')&&l.regions.length);
  items.sort((a,b)=>this.order(a)-this.order(b));
  if(!items.length){this.hoverRegions=[];this.canvas.style.visibility='hidden';this.video.pause();return;}
  const v=this.view();
  const regions:NoiseRegion[]=[],parts:string[]=[];
  const {width:w,height:h}=noiseBufferSize(innerWidth,innerHeight,1,this.policy,this.resolutionScale);
  if(this.source.width!==w||this.source.height!==h){this.source.width=w;this.source.height=h;this.signature='';}
  for(const layer of items){
   const r=layer.canvas.getBoundingClientRect(),local=noiseViewport(r.width,r.height,layer.scale),s=layer.skew;
   const opacity=Number(getComputedStyle(layer.canvas).opacity);
   parts.push(`${layer.revision}:${r.x}:${r.y}:${r.width}:${r.height}:${layer.source!.width}:${layer.source!.height}:${this.order(layer)}`);
   for(const region of layer.regions){
    let [left,top,right,bottom]=region.rect;top=Math.max(top,layer.top);bottom=Math.min(bottom,layer.bottom);if(top>=bottom)continue;
    if(region.phase===1&&layer.canvas.classList.contains('artwork-noise-canvas')){
     const py=local.top+48/local.scale,cut=(r.height-96)*s;
     left=Math.max(left,local.left+(48+cut)/local.scale+(py-360)*s);right=Math.min(right,local.left+(r.width-48)/local.scale+(py-360)*s);
     top=Math.max(top,py);bottom=Math.min(bottom,local.top+(r.height-48)/local.scale);
    }
    if(left>=right||top>=bottom)continue;
    const mapX=(x:number)=>v.left+(r.left+s*r.top+local.scale*(x-local.left-(local.top-360)*s))/v.scale+(v.top-360)*s;
    regions.push({rect:[mapX(left),v.top+(r.top+(top-local.top)*local.scale)/v.scale,mapX(right),v.top+(r.top+(bottom-local.top)*local.scale)/v.scale],phase:region.phase,strength:region.strength*opacity});
   }
  }
  // Adjacent pink regions share one opacity, including during the warning flash.
  for(let pass=0;pass<regions.length;pass++)for(let i=0;i<regions.length;i++)for(let j=i+1;j<regions.length;j++){
   const a=regions[i],b=regions[j];if(a.phase!==1||b.phase!==1)continue;
   if(a.rect[0]<=b.rect[2]+1&&b.rect[0]<=a.rect[2]+1&&a.rect[1]<=b.rect[3]+1&&b.rect[1]<=a.rect[3]+1)a.strength=b.strength=Math.max(a.strength,b.strength);
  }
  this.hoverRegions=regions;
  const signature=parts.join('|'),geometry=signature+JSON.stringify(regions),stamp=performance.now();
  if(!force&&geometry===this.geometry&&stamp-this.last<1000/60-.2)return;
  this.last=stamp;this.geometry=geometry;
  if(signature!==this.signature){
   const c=this.source.getContext('2d')!;c.clearRect(0,0,w,h);
   for(const layer of items){const r=layer.canvas.getBoundingClientRect();c.drawImage(layer.source!,r.left*w/innerWidth,r.top*h/innerHeight,r.width*w/innerWidth,r.height*h/innerHeight);}
   this.signature=signature;this.renderer.invalidateSource();
  }
  this.renderer.setViewportScale(v.scale);this.renderer.setReducedMotion(items.every(l=>l.reduced));
  if(this.pointer)this.renderer.setPointer(v.left+this.pointer.clientX/v.scale,v.top+this.pointer.clientY/v.scale,Boolean(this.pointer.buttons&1));
  if(items.every(l=>l.reduced))this.video.pause();else if(this.video.paused)void this.video.play().catch(()=>{});
  this.renderer.render(this.source,items.every(l=>l.reduced)?0:performance.now()/1000,true,regions);this.canvas.style.visibility='visible';
 }
 private order(layer:NoiseLayer){return layer.canvas.classList.contains('song-rail-noise')?0:layer.canvas.classList.contains('submit-noise-canvas')?2:1;}
 capture(layer:NoiseLayer,target:HTMLCanvasElement){
  if(this.contextLost){target.getContext('2d')!.clearRect(0,0,target.width,target.height);return;}
  this.paint(layer);const r=layer.canvas.getBoundingClientRect(),c=target.getContext('2d')!;
  c.clearRect(0,0,target.width,target.height);c.drawImage(this.canvas,r.left/innerWidth*this.canvas.width,r.top/innerHeight*this.canvas.height,r.width/innerWidth*this.canvas.width,r.height/innerHeight*this.canvas.height,0,0,target.width,target.height);this.paint();
 }
 dispose(){this.onLeave();this.modalObserver.disconnect();document.removeEventListener('visibilitychange',this.onVisibility);document.removeEventListener('pointercancel',this.onLeave);window.removeEventListener('blur',this.onLeave);cancelAnimationFrame(this.raf);document.removeEventListener('pointerdown',this.onHit,true);document.removeEventListener('click',this.onClick,true);this.canvas.removeEventListener('webglcontextlost',this.onContextLost);this.canvas.removeEventListener('webglcontextrestored',this.onContextRestored);this.renderer.dispose();this.canvas.remove();this.video.pause();document.removeEventListener('pointermove',this.onPointer);document.removeEventListener('pointerdown',this.onPointer);document.removeEventListener('pointerup',this.onPointer);document.removeEventListener('pointerleave',this.onLeave);}
}
