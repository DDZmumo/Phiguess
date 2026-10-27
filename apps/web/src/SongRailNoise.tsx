import {usePlayRuntime} from './play-runtime';
import {useEffect,useRef,type RefObject} from 'react';
import type {NoiseRegion} from './noise-domain-renderer';
import {NoiseLayer as NoiseDomainRenderer,noiseVideo} from './noise-stage';
import {contactAtlas} from './NoiseArtwork';
import {skipNoisePhase} from './artwork-noise-timeline';
import {noiseViewport} from './noise-viewport';
import type {Progress} from './api';

type Clock={skipFlashAt?:number;round:number;startsAt:number;deadline:number;now:number};
type Props={rail:RefObject<HTMLDivElement|null>;clock:Clock;progress:Progress[];reduce:boolean};

// One renderer and one union mask for every visible song name, including old rows.
export function SongRailNoise(props:Props){
 const training=Boolean(usePlayRuntime()?.clockPaused);
 const canvas=useRef<HTMLCanvasElement>(null),latest=useRef(props);
 const anchor=useRef({now:props.clock.now,stamp:performance.now()});
 if(anchor.current.now!==props.clock.now)anchor.current={now:props.clock.now,stamp:performance.now()};
 latest.current=props;
 const rounds=useRef(new Map<number,Pick<Clock,'startsAt'|'deadline'>>());
 useEffect(()=>{rounds.current.set(props.clock.round,{startsAt:props.clock.startsAt,deadline:props.clock.deadline});},[props.clock.round,props.clock.startsAt,props.clock.deadline]);
 useEffect(()=>{
  const surface=canvas.current!,root=props.rail.current!;
  let alive=true,renderer:NoiseDomainRenderer|undefined,lastDraw=0,lastSignature='';
  const source=document.createElement('canvas');source.width=640;source.height=834;
  const context=source.getContext('2d')!;
  const {video,ready:loaded}=noiseVideo();
  const visibleRows=new Set<HTMLElement>(),observed=new Set<HTMLElement>();
  const rowsObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting)visibleRows.add(entry.target as HTMLElement);else visibleRows.delete(entry.target as HTMLElement);}},{root,rootMargin:'100px'});
  const observeRows=()=>{for(const row of observed)if(!row.isConnected||!root.contains(row)){rowsObserver.unobserve(row);observed.delete(row);visibleRows.delete(row);}for(const row of root.querySelectorAll<HTMLElement>('.song-rail-row'))if(!observed.has(row)){observed.add(row);visibleRows.add(row);rowsObserver.observe(row);}};
  observeRows();const rowsChanges=new MutationObserver(observeRows),rowsRoot=root.querySelector('.song-rail-rows');if(rowsRoot)rowsChanges.observe(rowsRoot,{childList:true});
  function drawText(element:HTMLElement,color:string,center=false){
   const bounds=root.getBoundingClientRect(),scale=bounds.width/640,r=element.getBoundingClientRect(),style=getComputedStyle(element);
   const x=(r.left-bounds.left)/scale,y=(r.top-bounds.top)/scale,w=r.width/scale,h=r.height/scale;
   context.save();context.beginPath();context.rect(x,y,w,h);context.clip();context.fillStyle=color;context.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
   context.textBaseline='middle';context.textAlign=center?'center':'left';context.fillText(element.textContent??'',x+(center?w/2:0),y+h/2);context.restore();
  }
  function tick(stamp:number){
   if(!alive)return;
   if(document.hidden){return;}
   const state=latest.current;let bounds:DOMRect|undefined,scale=0;
   const view=noiseViewport(640,834),regions:NoiseRegion[]=[];
   const labels:Array<{text:string;x:number;y:number;width:number;height:number;font:string;spacing:string;left:number;top:number;frameHeight:number;status:HTMLElement|null;number:HTMLElement|null}>=[];
   for(const row of [...visibleRows].sort((a,b)=>Number(a.dataset.index)-Number(b.dataset.index))){
    if(!row.isConnected)continue;
    const index=Number(row.dataset.index),past=index<state.clock.round,clock=index===state.clock.round?state.clock:rounds.current.get(index);
    if((!past&&!clock)||state.progress.some(p=>p.round===index&&p.correct))continue;
    // Past unanswered rounds are already red, including after a fresh page load.
    const duration=clock?(clock.deadline-clock.startsAt)/1000:30;
    const elapsed=clock?(state.clock.now+(training?0:stamp-anchor.current.stamp)-clock.startsAt)/1000:duration;
    const skip=!past&&state.clock.skipFlashAt!==undefined?skipNoisePhase((stamp-state.clock.skipFlashAt)/1000):undefined;
    const settled=past||elapsed>=duration;
    const age=past?Math.min(duration,25):elapsed-Math.max(0,duration-25);
    if(!skip&&!settled&&age<=0)continue;
    if(!bounds){bounds=root.getBoundingClientRect();scale=bounds.width/640;if(!scale)return;}
    const title=row.querySelector<HTMLElement>('.song-rail-title')!,label=title.querySelector<HTMLElement>('.song-name-label')!;
    const rect=title.getBoundingClientRect(),x=(rect.left-bounds.left)/scale,y=(rect.top-bounds.top)/scale;
    const width=rect.width/scale,height=rect.height/scale;
    if(y+height<0||y>834)continue;
    const moveSeconds=Math.min(duration,25)-.8,growth=skip||settled?1:Math.max(0,Math.min(1,age/Math.max(.001,moveSeconds))),flash=age-moveSeconds;
    const phase=skip?.phase??(settled?2:1),strength=skip?.strength??(phase===2?1:flash<0?.34:.18+.30*Math.pow(.5+.5*Math.cos(flash*Math.PI*18),3));
    const slope=.2679491924,rowRect=row.getBoundingClientRect(),compact=Math.max(0,Math.min(1,parseFloat(getComputedStyle(row).getPropertyValue('--noise-compact'))||0));
    // Compact rows lower the top by 19.5px; follow the same 15-degree edge to the left.
    const left=(rowRect.left-bounds.left)/scale-125+102.705771-19.5*compact*slope,top=(rowRect.top-bounds.top)/scale-19.5*(1-compact),frameHeight=99-39*compact;
    const side=phase===2?32/scale*(1-compact):0,vertical=phase===2?20/scale*(1-compact)+2*compact:0;
    // Both side overhangs retract together as old rows compact.
    const leftSide=side;
    const shear=(view.top+top/view.scale-360)*slope;
    const regionLeft=view.left+(left-leftSide)/view.scale+shear;
    regions.push({rect:[regionLeft,view.top+(top-vertical)/view.scale,regionLeft+(443+leftSide+side)*growth/view.scale,view.top+(top+frameHeight+vertical)/view.scale],phase,strength});
    const style=getComputedStyle(title);
    labels.push({text:label.textContent??'',x,y,width,height,font:`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,spacing:style.letterSpacing,left,top,frameHeight,status:row.classList.contains('current')?row.querySelector<HTMLElement>('.song-rail-status'):null,number:row.classList.contains('current')?null:row.querySelector<HTMLElement>('.song-rail-number')});
   }
   if(!regions.length||!bounds){surface.style.visibility='hidden';return;}
   // DOM positions follow the same GSAP transforms as the text, even on high refresh displays.
   const signature=JSON.stringify(labels.map(({status,number,...label})=>({...label,status:status?.textContent,number:number?.textContent}))),changed=signature!==lastSignature;
   if(!changed&&stamp-lastDraw<1000/60-.2)return;
   lastDraw=stamp;
   if(changed){
    // A continuous backing avoids transparent gaps becoming dark seams inside a merged domain.
    context.fillStyle='#101015';context.fillRect(0,0,640,834);
    for(const label of labels){
     context.save();context.beginPath();context.rect(label.x,label.y,label.width,label.height);context.clip();
     context.font=label.font;context.letterSpacing=label.spacing==='normal'?'0px':label.spacing;
     context.fillStyle='#fff';context.textBaseline='middle';context.fillText(label.text,label.x,label.y+label.height/2);context.restore();
     if(label.status)drawText(label.status,'#eee');if(label.number)drawText(label.number,'#fff',true);
    }
    const badge=root.querySelector<HTMLElement>('.song-rail-badge')!,r=badge.getBoundingClientRect(),bx=(r.left-bounds.left)/scale,by=(r.top-bounds.top)/scale;
    context.fillStyle='#fff';context.beginPath();context.moveTo(bx+26.5,by);context.lineTo(bx+120.5,by);context.lineTo(bx+94,by+99);context.lineTo(bx,by+99);context.closePath();context.fill();
    drawText(badge.querySelector<HTMLElement>('strong')!,'#333',true);drawText(badge.querySelector<HTMLElement>('small')!,'#333',true);
    lastSignature=signature;renderer!.invalidateSource();
   }
   renderer!.setReducedMotion(state.reduce);
   
   renderer!.render(source,state.reduce?0:stamp/1000,true,regions.slice(-8));surface.style.visibility='visible';
  }
  void Promise.all([loaded,contactAtlas()]).then(([,atlas])=>{
   if(!alive)return;renderer=new NoiseDomainRenderer(surface,video,atlas);renderer.setOverlay(true);renderer.setRegionSkew(.2679491924);renderer.setFrameCallback(tick);
  }).catch(()=>{surface.style.visibility='hidden';});
  return()=>{alive=false;rowsObserver.disconnect();rowsChanges.disconnect();renderer?.dispose();};
 },[]);
 return <canvas ref={canvas} className="song-rail-noise" aria-hidden="true"/>;
}
