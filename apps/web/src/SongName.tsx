import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { gsap, useGSAP } from './visual';

export function scrambleSongName(index:number,frame:number){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let seed=(Math.imul(index+1,0x45d9f3b)^Math.imul(frame+1,0x27d4eb2d))>>>0;
  return Array.from({length:8+(index%4)},()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return chars[(seed>>>0)%chars.length];}).join('');
}

export function SongName({title,scramble,animate,reduce}:{title:string|null;scramble:string;animate:boolean;reduce:boolean}){
  const root=useRef<HTMLSpanElement>(null),cover=useRef<HTMLSpanElement>(null),measure=useRef<HTMLSpanElement>(null);
  const committed=useRef(title),[shown,setShown]=useState(title),[frozen,setFrozen]=useState<string|null>(null);
  useGSAP(()=>{
    if(!title||committed.current===title)return;
    if(reduce||!animate){committed.current=title;setShown(title);setFrozen(null);return;}
    const element=root.current,bar=cover.current,probe=measure.current;
    if(!element||!bar||!probe)return;
    const available=element.parentElement!.clientWidth;
    const newWidth=Math.min(probe.offsetWidth,available),width=Math.max(element.offsetWidth,newWidth);
    setFrozen(scramble);
    gsap.set(element,{width});
    gsap.set(bar,{width,x:0,scaleX:0,transformOrigin:'0% 50%'});
    element.dataset.phase='covering';
    gsap.timeline()
      .to(bar,{scaleX:1,duration:.22,ease:'power3.inOut'})
      .call(()=>{
        committed.current=title;
        flushSync(()=>setShown(title));
        element.dataset.phase='revealing';
      })
      .set(bar,{transformOrigin:'100% 50%'})
      .to(bar,{x:newWidth-width,scaleX:0,duration:.2,ease:'power3.inOut',onComplete:()=>{
        gsap.set(element,{clearProps:'width'});element.dataset.phase='complete';setFrozen(null);
      }});
    return()=>{delete element.dataset.phase;};
  },{scope:root,dependencies:[title,reduce,animate],revertOnUpdate:true});
  return <span className="song-name" ref={root}>
    <span className="song-name-label" aria-live={shown?'polite':'off'}>{shown??frozen??scramble}</span>
    <span className="song-name-measure" ref={measure} aria-hidden="true">{title??''}</span>
    <span className="song-name-cover" ref={cover} aria-hidden="true"/>
  </span>;
}
