import {usePlayRuntime} from './play-runtime';
import {useEffect,useRef,useState,type CSSProperties,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import type {NoiseRegion} from './noise-domain-renderer';
import {NoiseLayer as NoiseDomainRenderer,noiseVideo} from './noise-stage';
import {noiseViewport} from './noise-viewport';
import {artworkNoiseRegions,skipNoisePhase} from './artwork-noise-timeline';
import {useReducedMotion} from './hooks';
import {gsap} from './visual';
import './noise-artwork.css';

let atlas:Promise<HTMLImageElement>|undefined;
export function contactAtlas(){return atlas??=(()=>{const image=new Image();image.src='/effects/noise-domain/contact-atlas.webp';return image.decode().then(()=>image);})().catch(e=>{atlas=undefined;throw e;});}
interface Props{skipFlashAt?:number;src:string;alt:string;startsAt:number;deadline:number;now:number;active:boolean;solved:boolean;suspended?:boolean;image?:HTMLImageElement;showImage?:boolean;mode?:'submit'|'return';target?:RefObject<HTMLButtonElement|null>;fadeOut?:boolean;transitionStart?:{current:{startedAt:number;progress:number;update?:((progress:number)=>void)}};skew?:number;style?:CSSProperties}
interface Particle{x:number;y:number;size:number;height:number;vx:number;vy:number;seed:number}

export function NoiseArtwork(props:Props){
 const runtime=usePlayRuntime();
 const root=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),exitCanvas=useRef<HTMLCanvasElement>(null),reduce=useReducedMotion();
 const [ready,setReady]=useState(false);
 useEffect(()=>{if(canvas.current){canvas.current.style.transition='opacity .35s ease-out';canvas.current.style.opacity=props.fadeOut?'0':'1';}},[props.fadeOut]);
 const latest=useRef({...props,reduce,anchor:performance.now()});
 latest.current={...props,reduce,anchor:props.now===latest.current.now?latest.current.anchor:performance.now()};
 const decoded=useRef<{src:string;image:HTMLImageElement}|null>(null);
 useEffect(()=>{
  if(props.image){decoded.current={src:props.src,image:props.image};return;}
  let alive=true;const image=new Image();image.src=props.src;
  void image.decode().then(()=>{if(alive)decoded.current={src:props.src,image};}).catch(()=>{});
  return()=>{alive=false;};
 },[props.src,props.image]);
 useEffect(()=>{
  if(!props.active){setReady(false);if(canvas.current)canvas.current.style.visibility='hidden';if(exitCanvas.current)exitCanvas.current.style.visibility='hidden';return;}
  let alive=true,renderer:NoiseDomainRenderer|undefined,observer:ResizeObserver|undefined;
  let last=performance.now(),lastPaint=0,sourceDirty=true,exitAt:number|null=null,finished=false;
  let previousSolved=latest.current.solved,snapshot:HTMLCanvasElement|undefined,particles:Particle[]=[],pink:NoiseRegion[]=[];
  let currentSrc=props.src,currentStart=props.startsAt,sourcePicture:HTMLImageElement|undefined;
  let wipeAt:number|null=null,wipeTime=0,wipeRegions:NoiseRegion[]=[];
  const wipeEase=gsap.parseEase('phigrosArtwork');
  let logicalView=noiseViewport(1280,720),lastRegions:NoiseRegion[]=[];
  const {video:media,ready:loaded}=noiseVideo();
  const source=document.createElement('canvas'),context=source.getContext('2d')!;
  const host=document;
 const frame=props.target?.current??root.current!.closest('.art-frame')??root.current!;
 function viewOf(width:number,height:number){
  const artwork=Boolean(props.mode)?frame.closest('.game-screen')?.querySelector('.art-frame')?.getBoundingClientRect():undefined;
  return noiseViewport(width,height,artwork?noiseViewport(artwork.width+96,artwork.height+96).scale:undefined);
 }
 function position(){if(!canvas.current||!exitCanvas.current)return;const r=frame.getBoundingClientRect();for(const c of [canvas.current!,exitCanvas.current!]){c.style.left=`${r.left-48}px`;const lift=c===exitCanvas.current?160:0;c.style.top=`${r.top-48-lift}px`;c.style.width=`${r.width+96}px`;c.style.height=`${r.height+96+lift}px`;}sourceDirty=true;}
 function syncGeometry(){
  const bounds=frame.getBoundingClientRect(),c=canvas.current!;
  if(Math.abs(parseFloat(c.style.left)-(bounds.left-48))>.1||Math.abs(parseFloat(c.style.top)-(bounds.top-48))>.1||Math.abs(parseFloat(c.style.width)-(bounds.width+96))>.1||Math.abs(parseFloat(c.style.height)-(bounds.height+96))>.1)position();
  logicalView=viewOf(bounds.width+96,bounds.height+96);
 }
 position();
  function applyWipe(progress:number){
   if(wipeAt===null||latest.current.suspended||!renderer||!canvas.current)return;
   if(progress>=1){canvas.current!.style.visibility='hidden';return;}
   syncGeometry();
   const rect=canvas.current!.getBoundingClientRect(),view=viewOf(rect.width,rect.height);
   // Move the domain's signed boundary so its jagged silhouette and glow survive the wipe.
   renderer.setWipeTop(
    view.top+(48+(rect.height-96)*progress)/view.scale,
    view.top+(rect.height-48+20*(1-progress))/view.scale,
   );
   renderer.setViewportScale(Boolean(props.mode)?view.scale:undefined);
   renderer.render(source,wipeTime+(performance.now()-wipeAt)/1000,true,wipeRegions);
   canvas.current!.style.visibility='visible';
  }
  if(props.transitionStart)props.transitionStart.current.update=applyWipe;
  function point(event:Event){if(event.target instanceof Element&&event.target.closest('[data-noise-safe]')){renderer?.clearPointer();return;}const e=event as PointerEvent,r=canvas.current!.getBoundingClientRect(),v=viewOf(r.width,r.height);renderer?.setPointer((e.clientX-r.left)/v.scale+v.left,(e.clientY-r.top)/v.scale+v.top,Boolean(e.buttons&1));}
  function leave(){renderer?.clearPointer();}
  function click(event:Event){
   if(event.target instanceof Element&&event.target.closest('[data-noise-safe]'))return;
   if(latest.current.solved||latest.current.suspended||!lastRegions.length||wipeAt!==null||!renderer)return;
   const e=event as MouseEvent,r=canvas.current!.getBoundingClientRect(),v=viewOf(r.width,r.height);
   if(renderer.isRedAt((e.clientX-r.left)/v.scale+v.left,(e.clientY-r.top)/v.scale+v.top)){e.preventDefault();e.stopPropagation();}
  }
  function visibility(){if(document.hidden){leave();}else{last=performance.now();}}
  function drawSource(){
   const picture=decoded.current!.image;sourcePicture=picture;
   const r=canvas.current!.getBoundingClientRect();logicalView=viewOf(r.width,r.height);
   source.width=Math.max(1,Math.round(Math.min(1280,r.width*(devicePixelRatio||1))));source.height=Math.max(1,Math.round(source.width*r.height/Math.max(1,r.width)));
   const pad=48*source.width/r.width;const scale=Math.max((source.width-2*pad)/picture.naturalWidth,(source.height-2*pad)/picture.naturalHeight),w=picture.naturalWidth*scale,h=picture.naturalHeight*scale;
   // The effect may overscan, but its artwork source keeps the original frame crop.
   const cut=(source.height-2*pad)*(latest.current.skew??0);
   context.save();context.beginPath();context.moveTo(pad+cut,pad);context.lineTo(source.width-pad,pad);
   context.lineTo(source.width-pad-cut,source.height-pad);context.lineTo(pad,source.height-pad);context.closePath();context.clip();
   if(Boolean(props.mode)){
    context.fillStyle=props.mode==='return'?'#000':'#ddd';context.fillRect(0,0,source.width,source.height);
    const label=frame.querySelector('span')!,style=getComputedStyle(label),labelRect=label.getBoundingClientRect(),ratio=source.width/r.width;
    context.fillStyle=props.mode==='return'?'#fff':'#222';context.font=`${style.fontWeight} ${labelRect.height*.7*ratio}px ${style.fontFamily}`;
    context.textAlign='center';context.textBaseline='middle';context.fillText(props.mode==='return'?'←':label.textContent??'提交',source.width/2,source.height/2);
   }else context.drawImage(picture,(source.width-w)/2,(source.height-h)/2,w,h);
   context.restore();renderer!.invalidateSource();sourceDirty=false;
  }
  function beginExit(stamp:number){
   exitAt=stamp;renderer?.clearPointer();pink=lastRegions.filter(r=>r.phase===1);
   snapshot=document.createElement('canvas');snapshot.width=canvas.current!.width;snapshot.height=canvas.current!.height;
   renderer!.capture(snapshot);
   const w=snapshot.width,h=snapshot.height,cell=Math.max(9,Math.sqrt(w*h/360)),skew=latest.current.skew??0;
   for(let y=cell/2;y<h;y+=cell)for(let x=cell/2;x<w;x+=cell){
    const py=logicalView.top+y/h*logicalView.height,px=logicalView.left+x/w*logicalView.width+(py-360)*skew;
    if(!lastRegions.some(r=>r.phase===2&&px>=r.rect[0]&&px<=r.rect[2]&&py>=r.rect[1]&&py<=r.rect[3]))continue;
    const size=cell*(.18+Math.random()*.8);
    particles.push({x,y,size,height:size*(.5+Math.random()*.8),vx:(Math.random()-.5)*w*.045,vy:-h*(.10+Math.random()*.25),seed:Math.random()*100});
   }
   exitCanvas.current!.width=w;exitCanvas.current!.height=h+Math.round(160*h/canvas.current!.getBoundingClientRect().height);
   canvas.current!.style.visibility='hidden';exitCanvas.current!.style.visibility='visible';
  }
  function paintExit(stamp:number){
   const c=exitCanvas.current!.getContext('2d')!,w=snapshot!.width,h=snapshot!.height,t=(stamp-exitAt!)/1000,duration=latest.current.reduce?.12:.85;
   c.clearRect(0,0,w,exitCanvas.current!.height);
   if(t>=duration){finished=true;exitCanvas.current!.style.visibility='hidden';return;}
   c.save();c.translate(0,exitCanvas.current!.height-h);
   if(t<.10){
    const pad=48*w/canvas.current!.getBoundingClientRect().width,cut=(h-2*pad)*(latest.current.skew??0);
    c.save();c.beginPath();c.moveTo(pad+cut,pad);c.lineTo(w-pad,pad);c.lineTo(w-pad-cut,h-pad);c.lineTo(pad,h-pad);c.closePath();c.clip();
    c.fillStyle=`rgba(255,255,255,${1-t/.10})`;
    const skew=latest.current.skew??0;
    for(const r of pink){c.beginPath();for(const [i,[x,y]]of [[r.rect[0],r.rect[1]],[r.rect[2],r.rect[1]],[r.rect[2],r.rect[3]],[r.rect[0],r.rect[3]]].entries()){const px=(x-(y-360)*skew-logicalView.left)/logicalView.width*w,py=(y-logicalView.top)/logicalView.height*h;if(i===0)c.moveTo(px,py);else c.lineTo(px,py);}c.closePath();c.fill();}
    c.restore();
   }
   // Keep each fragment alive: sample the animated domain, not a frozen screenshot.
   renderer!.render(source,latest.current.reduce?0:(stamp-latest.current.anchor+latest.current.now-latest.current.startsAt)/1000,true,lastRegions.filter(r=>r.phase===2));
   renderer!.capture(snapshot!);
   for(const p of particles){
    const age=t/duration,shrink=1-age*.45,pw=p.size*shrink,ph=p.height*shrink;
    const pulse=.76+.24*Math.sin(Math.floor(t*24)+p.seed);
    c.globalAlpha=Math.pow(1-age,1.2)*pulse;c.save();
    c.translate(p.x+(latest.current.reduce?0:p.vx*t+Math.sin(t*6+p.seed)*w*.002),p.y+(latest.current.reduce?0:p.vy*t*(.6+age)));
    // Stepped changing silhouettes make small noise domains rather than rotating confetti.
    const step=Math.max(1,pw*.16),bite=step*(1+Math.floor((Math.sin(Math.floor(t*18)+p.seed)+1)*1.4));
    c.beginPath();c.moveTo(-pw/2+step,-ph/2);c.lineTo(pw/2,-ph/2);c.lineTo(pw/2,ph/2-step);c.lineTo(pw/2-bite,ph/2-step);c.lineTo(pw/2-bite,ph/2);c.lineTo(-pw/2,ph/2);c.lineTo(-pw/2,-ph/2+step);c.lineTo(-pw/2+step,-ph/2+step);c.closePath();c.clip();
    c.drawImage(snapshot!,p.x-p.size/2,p.y-p.height/2,p.size,p.height,-pw/2,-ph/2,pw,ph);c.restore();
   }
   c.restore();c.globalAlpha=1;
  }
  function tick(stamp:number){
   if(!alive||!canvas.current||!exitCanvas.current)return;
   const dt=stamp-last;last=stamp;
   const state=latest.current;
   if(state.src!==currentSrc||state.startsAt!==currentStart){
    if(state.src!==currentSrc&&state.startsAt!==currentStart&&sourcePicture&&lastRegions.length&&!previousSolved){
     wipeAt=state.transitionStart?.current.startedAt??stamp;wipeTime=(state.now-currentStart)/1000;wipeRegions=lastRegions;
    }else{wipeAt=null;renderer?.setWipeTop(null);}
    currentSrc=state.src;currentStart=state.startsAt;sourceDirty=true;finished=false;exitAt=null;
    previousSolved=state.solved;particles=[];pink=[];lastRegions=[];
    canvas.current!.style.visibility='hidden';exitCanvas.current!.style.visibility='hidden';
   }
   if(state.suspended||finished||decoded.current?.src!==state.src){
    canvas.current!.style.visibility='hidden';exitCanvas.current!.style.visibility='hidden';
    renderer?.clearPointer();
    return;
   }
   syncGeometry();
   if(!document.hidden&&stamp-lastPaint>=1000/60-.2){
    lastPaint=stamp-Math.max(0,stamp-lastPaint-1000/60)%(1000/60);
    if(wipeAt!==null){
     const duration=state.reduce?.1:.8,age=(stamp-wipeAt)/1000;
     if(age<duration){
      const progress=state.transitionStart?.current.progress??wipeEase(Math.max(0,age/duration));
      applyWipe(progress);return;
     }
     wipeAt=null;renderer!.setWipeTop(null);canvas.current!.style.visibility='hidden';
    }
    if(state.solved&&!previousSolved){
     if(lastRegions.length)beginExit(stamp);else{finished=true;}
     previousSolved=true;
    }
    if(exitAt!==null)paintExit(stamp);
    else if(!state.solved){
     const now=state.now+(runtime?.clockPaused?0:stamp-state.anchor),elapsed=Math.max(0,(now-state.startsAt)/1000),duration=(state.deadline-state.startsAt)/1000;
     if(sourceDirty||sourcePicture!==decoded.current.image)drawSource();
     const rect=canvas.current!.getBoundingClientRect();lastRegions=artworkNoiseRegions(elapsed,duration,rect.width,rect.height,state.skew??0,(16-48*(state.skew??0))/logicalView.scale,28/logicalView.scale,28/logicalView.scale,state.skipFlashAt===undefined?undefined:(stamp-state.skipFlashAt)/1000);
     if(Boolean(state.mode)){
      const skip=state.skipFlashAt===undefined?undefined:skipNoisePhase((stamp-state.skipFlashAt)/1000);
      const view=viewOf(rect.width,rect.height),red=skip?skip.phase===2:now>=state.deadline,skew=state.skew??0;
      const top=view.top+48/view.scale,shear=(top-360)*skew;
      const left=view.left+(48+(rect.height-96)*skew)/view.scale+shear,right=view.left+(rect.width-48)/view.scale+shear;
      const age=(now-(state.deadline-800))/1000,strength=red?1:age<0?.34:.18+.30*Math.pow(.5+.5*Math.cos(age*Math.PI*18),3);
      let redTop=top-20/view.scale;
      const artwork=props.mode==='submit'?frame.closest('.game-screen')?.querySelector('.art-frame')?.getBoundingClientRect():undefined;
      // The gap between the artwork and button scales with the UI. Join their
      // settled masks with an overlap in noise coordinates, rather than a fixed
      // 20px overscan which leaves two rims on larger screens.
      if(red&&artwork)redTop=Math.min(redTop,view.top+(artwork.bottom+48-60*view.scale-rect.top)/view.scale);
      lastRegions=skip||now>=state.deadline-5000?[{rect:[left-(red?32:0)/view.scale,red?redTop:top,right+(red?32:0)/view.scale,view.top+(rect.height-48+(red?20:0))/view.scale],phase:red?2:1,strength:skip?.strength??strength}]:[];
     }
     if(!lastRegions.length){canvas.current!.style.visibility='hidden';return;}
     renderer!.setViewportScale(Boolean(state.mode)?viewOf(rect.width,rect.height).scale:undefined);
     renderer!.setRegionSkew(state.skew??0);renderer!.setReducedMotion(state.reduce);renderer!.noteFrameInterval(dt);
     
     
     renderer!.render(source,state.reduce?0:elapsed,true,lastRegions);canvas.current!.style.visibility='visible';
    }else canvas.current!.style.visibility='hidden';
   }
  }

  void Promise.all([loaded,contactAtlas()]).then(([,contact])=>{
   if(!alive)return;
   renderer=new NoiseDomainRenderer(canvas.current!,media,contact,()=>{sourceDirty=true;});renderer.setOverlay(true);observer=new ResizeObserver(position);observer.observe(frame);
   host.addEventListener('pointermove',point,{passive:true});host.addEventListener('pointerdown',point,{passive:true});host.addEventListener('pointerup',point,{passive:true});host.addEventListener('pointerleave',leave);host.addEventListener('pointercancel',leave);host.addEventListener('click',click,true);document.addEventListener('visibilitychange',visibility);
   setReady(true);last=performance.now();renderer.setFrameCallback(tick);
  }).catch(()=>{if(alive)setReady(false);});
  return()=>{alive=false;if(props.transitionStart?.current.update===applyWipe)props.transitionStart.current.update=undefined;observer?.disconnect();host.removeEventListener('pointermove',point);host.removeEventListener('pointerdown',point);host.removeEventListener('pointerup',point);host.removeEventListener('pointerleave',leave);host.removeEventListener('pointercancel',leave);host.removeEventListener('click',click,true);document.removeEventListener('visibilitychange',visibility);renderer?.dispose();if(canvas.current)canvas.current.style.visibility='hidden';if(exitCanvas.current)exitCanvas.current.style.visibility='hidden';};
 },[props.active]);
 return <div className="noise-artwork" ref={root} style={props.style} data-noise-ready={ready}>
  {props.showImage!==false&&<img src={props.src} alt={props.alt}/>} {createPortal(<><canvas ref={canvas} className={Boolean(props.mode)?'submit-noise-canvas':'artwork-noise-canvas'} aria-hidden="true"/><canvas ref={exitCanvas} className={Boolean(props.mode)?'submit-noise-exit':'artwork-noise-exit'} aria-hidden="true"/></>,document.body)}
 </div>;
}
