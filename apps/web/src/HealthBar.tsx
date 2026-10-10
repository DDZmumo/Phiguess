import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import reference from './healthbar-reference.json';
import {useReducedMotion} from './hooks';
import './healthbar.css';
import {paintHealthBar} from './healthbar-painter';

export function healthReferenceState(frame:number){
 let value=10,flash=0;
 for(const event of reference.events){
  if(frame>=event.digitFrame)value=event.value;
  if(frame>=event.frame&&frame<event.frame+4)flash=Math.pow(1-(frame-event.frame)/4,1.5);
 }
 return {value,flash};
}

/** Visual component only. The caller owns life totals and gameplay consequences. */
export function HealthBar({value=10,maxValue=10,referenceFrame,fullscreenFlash=false}:{value?:number;maxValue?:number;referenceFrame?:number;fullscreenFlash?:boolean}){
 const canvas=useRef<HTMLCanvasElement>(null),flashLayer=useRef<HTMLDivElement>(null),reduce=useReducedMotion();
 const latest=useRef({value,maxValue,referenceFrame,reduce,fullscreenFlash});latest.current={value,maxValue,referenceFrame,reduce,fullscreenFlash};
 const animation=useRef({value,previous:value,changedAt:performance.now(),enteredAt:performance.now()});
 const wake=useRef(()=>{});
 useEffect(()=>{const a=animation.current;if(value!==a.value){a.previous=a.value;a.value=value;a.changedAt=performance.now();}},[value]);
 useEffect(()=>{wake.current();},[value,maxValue,referenceFrame,reduce,fullscreenFlash]);
 useEffect(()=>{
  let raf=0,last=0,alive=true,fontsReady=false;
  const node=canvas.current!,ctx=node.getContext('2d')!;
  function schedule(){if(alive&&fontsReady&&!document.hidden&&!raf)raf=requestAnimationFrame(tick);}
  function invalidate(){last=0;schedule();}
  function visibility(){if(document.hidden){cancelAnimationFrame(raf);raf=0;}else invalidate();}
  wake.current=invalidate;
  const observer=new ResizeObserver(invalidate);observer.observe(node);
  window.addEventListener('resize',invalidate);document.addEventListener('visibilitychange',visibility);
  function tick(stamp:number){
   raf=0;if(!alive||document.hidden)return;
   if(stamp-last<1000/60-.2){schedule();return;}last=stamp;
   const state=latest.current,a=animation.current,age=(stamp-a.changedAt)/1000,entry=(stamp-a.enteredAt)/1000;
   const maximum=Math.max(1,state.maxValue);
   let hp=Math.max(0,Math.min(maximum,Math.round(state.value))),frame=state.referenceFrame??reference.firstFrame+entry*30,flash=0,displayValue=hp;
   let previous=a.previous,blend=1,time=state.reduce?0:entry,entrance=state.reduce?1:Math.min(1,entry/.8);
   if(state.referenceFrame!==undefined){
    const sample=healthReferenceState(frame);hp=displayValue=sample.value;flash=sample.flash;
    const keyFrames:Record<number,number>={10:400,9:680,8:695,7:707,6:714,5:760,4:815,3:848,2:853,1:875};
    time=state.reduce?0:(frame-(keyFrames[hp]??400))/30;entrance=Math.min(1,Math.max(0,(frame-reference.firstFrame)/24));
    const event=reference.events.filter(e=>frame>=e.digitFrame).at(-1);
    previous=event?Math.min(10,event.value+1):hp;blend=event?1-Math.pow(1-Math.min(1,(frame-event.digitFrame)/5.4),3):1;
   }else if(a.previous!==hp&&age<.3){
    flash=a.previous>hp?Math.pow(Math.max(0,1-age/(4/30)),1.5):0;blend=1-Math.pow(1-Math.min(1,age/.18),3);
    if(age<1/30)displayValue=a.previous;
   }
   const deathAge=state.referenceFrame===undefined?age:(state.referenceFrame-900)/30;
   // Reference frames are externally driven. Static/reduced and empty HUDs sleep until invalidated.
   if(state.referenceFrame===undefined&&((hp>0&&(!state.reduce||(a.previous!==hp&&age<.3)))||
      (hp===0&&deathAge<.8&&!state.reduce&&state.fullscreenFlash)))schedule();
   if(flashLayer.current){
    const death=hp===0&&(state.referenceFrame!==undefined||a.previous>0)&&deathAge>=0&&deathAge<.8&&!state.reduce&&state.fullscreenFlash;
    const index=Math.min(24,Math.floor(deathAge*30));
    flashLayer.current.style.opacity=death?String(reference.deathColors[Math.max(0,index)]![0]!/186):'0';
   }
   node.dataset.value=String(hp);node.dataset.referenceFrame=String(Math.floor(frame));node.dataset.flash=String(flash);
   if(hp===0||(state.referenceFrame!==undefined&&(frame<reference.firstFrame||frame>reference.lastFrame))){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,node.width,node.height);return;}
   const rect=node.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,1.5),width=Math.max(1,Math.round(rect.width*ratio)),height=Math.max(1,Math.round(rect.height*ratio));
   if(node.width!==width||node.height!==height){node.width=width;node.height=height;}
   const scale=height/130,viewportWidth=width/scale;
   ctx.setTransform(scale,0,0,scale,0,0);ctx.clearRect(0,0,viewportWidth,130);
   const factor=state.referenceFrame===undefined?10/maximum:1;
   paintHealthBar(ctx,hp*factor,{time,entry:entrance,flash,previous:previous*factor,blend,displayValue,viewportWidth});
  }
  void document.fonts.load('400 40px Saira').then(()=>{fontsReady=true;schedule();});
  return()=>{alive=false;wake.current=()=>{};cancelAnimationFrame(raf);observer.disconnect();window.removeEventListener('resize',invalidate);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 return <><div className="health-hud" role="meter" aria-label="生命值" aria-valuemin={0} aria-valuemax={maxValue} aria-valuenow={value}>
  <canvas ref={canvas} aria-hidden="true"/>
 </div>{fullscreenFlash&&createPortal(<div ref={flashLayer} className="health-failure-flash" aria-hidden="true"/>,document.body)}</>;
}
