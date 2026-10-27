import {useRef,useState,type RefObject} from 'react';
import {gsap,useGSAP} from './visual';

export function useSlidingTabs(root:RefObject<HTMLElement|null>,panels:RefObject<HTMLDivElement|null>[],index:number,reduced:boolean){
 const [phase,setPhase]=useState<'idle'|'sliding'>('idle'),previous=useRef(index);
 useGSAP(()=>{
  const elements=panels.map(panel=>panel.current);gsap.killTweensOf(elements);
  const travel=(root.current?.clientWidth??1)/(panels[0]?.current?.clientWidth||1)*100;
  const xPercent=(position:number)=>(position-index)*travel,changed=previous.current!==index;previous.current=index;
  if(!changed||reduced){gsap.set(elements,{xPercent,force3D:true});setPhase('idle');return;}
  setPhase('sliding');gsap.to(elements,{xPercent,force3D:true,duration:.26,ease:'power2.inOut',onComplete:()=>setPhase('idle')});
 },{scope:root,dependencies:[index,reduced]});
 return {phase,prepare:()=>{if(!reduced)setPhase('sliding');}};
}
