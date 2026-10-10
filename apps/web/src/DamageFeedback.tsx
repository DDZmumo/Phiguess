import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {useReducedMotion} from './hooks';
import './damage-feedback.css';

export function DamageFeedback({health}:{health:number}){
 const previous=useRef(health),overlay=useRef<HTMLDivElement>(null),reduce=useReducedMotion();
 useEffect(()=>{
  const lost=previous.current-health;previous.current=health;
  if(lost<=0||document.hidden||!overlay.current)return;
  const opacity=Math.min(.9,.6+lost*.06),duration=reduce?220:480;
  const animations=[overlay.current.animate([{opacity:0},{opacity,offset:.12},{opacity:0}],{duration,easing:'ease-out'})];
  if(!reduce)for(const edge of overlay.current.querySelectorAll('.damage-edge-wave')){
   animations.push(edge.animate([{transform:'scale(1)',opacity:0},{transform:'scale(1.055)',opacity:.7,offset:.2},{transform:'scale(1.11)',opacity:0}],{duration,easing:'cubic-bezier(.15,.6,.3,1)'}));
  }
  const clear=()=>animations.forEach(animation=>animation.cancel());
  const visibility=()=>{if(document.hidden)clear();};document.addEventListener('visibilitychange',visibility);
  return()=>{clear();document.removeEventListener('visibilitychange',visibility);};
 },[health,reduce]);
 return createPortal(<div ref={overlay} className="damage-vignette" aria-hidden="true"><i className="damage-edge-wave damage-edge-left"/><i className="damage-edge-wave damage-edge-right"/></div>,document.body);
}
