import {useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {fadeWindowPaint} from './window-paint';

const duration=300;
const easing='cubic-bezier(.349072516,.352504606,0,.998208084)';
const front='translate3d(0px,0px,0px)';
const receded='translate3d(0px,0px,-260px)';

/** Exchange two views in the same camera, preserving their current pose on reversal. */
export function useSceneSwap(songs:RefObject<HTMLElement|null>,packs:RefObject<HTMLElement|null>,showPacks:boolean,reduced:boolean,onSettled:()=>void){
 const [phase,setPhase]=useState<'idle'|'switching'>('idle'),initialized=useRef(false),settled=useRef(onSettled);settled.current=onSettled;
 useLayoutEffect(()=>{
  const elements=[songs.current,packs.current];if(elements.some(el=>!el))return;
  const targets=elements.map((el,index)=>({el:el!,visible:index===1?showPacks:!showPacks,windows:[...el!.querySelectorAll<HTMLElement>('[data-window]')]}));
  for(const {el,visible} of targets)el.dataset.sceneVisible=String(visible);
  // Keep every 3D ancestor opaque. Only already-flat paint surfaces fade.
  const apply=()=>{for(const {el,visible} of targets){el.style.opacity='1';el.style.transform=visible?front:receded;el.style.visibility=visible?'visible':'hidden';}};
  const paint=(ms:number)=>targets.flatMap(({visible,windows})=>windows.map(window=>fadeWindowPaint(window,visible&&window.dataset.windowOpen!=='false',ms)));
  if(!initialized.current){initialized.current=true;apply();paint(0);return;}
  if(reduced){apply();paint(0);setPhase('idle');settled.current();return;}
  let cancelled=false;setPhase('switching');
  const cancelPaint=paint(duration);
  const animations=targets.map(({el,visible})=>{
   const current=getComputedStyle(el);
   el.style.visibility='visible';
   el.style.opacity='1';
   return el.animate([{transform:current.transform},{transform:visible?front:receded}],{duration,easing,fill:'forwards'});
  });
  void Promise.all(animations.map(animation=>animation.finished)).then(()=>{
   if(cancelled)return;apply();for(const animation of animations)animation.cancel();setPhase('idle');settled.current();
  }).catch(()=>{});
  return()=>{
   cancelled=true;
   // Commit computed values before cancellation so fast Back/return keeps continuity.
   const current=targets.map(({el})=>getComputedStyle(el).transform);
   targets.forEach(({el},index)=>{el.style.opacity='1';el.style.transform=current[index];});
   for(const cancel of cancelPaint)cancel();
   for(const animation of animations)animation.cancel();
  };
 },[songs,packs,showPacks,reduced]);
 return phase;
}
