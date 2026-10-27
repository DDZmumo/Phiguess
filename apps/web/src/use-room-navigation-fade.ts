import {useCallback,useEffect,useRef,useState} from 'react';
import {gsap,modeTransitionDuration} from './visual';

export function useRoomNavigationFade(reduced:boolean){
 const shade=useRef<HTMLDivElement>(null),mounted=useRef(true),tween=useRef<ReturnType<typeof gsap.to>|null>(null);
 const [active,setActive]=useState(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;tween.current?.kill();};},[]);
 const fade=useCallback((opacity:0|1)=>new Promise<boolean>(resolve=>{
  if(!mounted.current||!shade.current){resolve(false);return;}
  tween.current?.kill();if(opacity)setActive(true);
  tween.current=gsap.to(shade.current,{opacity,duration:modeTransitionDuration(reduced),ease:opacity?'phigrosFadeIn':'phigrosFadeOut',onComplete:()=>{if(mounted.current&&!opacity)setActive(false);resolve(mounted.current);},onInterrupt:()=>resolve(false)});
 }),[reduced]);
 return {shade,active,cover:()=>fade(1),reveal:()=>fade(0)};
}
