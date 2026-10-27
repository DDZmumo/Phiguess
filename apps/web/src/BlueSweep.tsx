import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {AnswerTint} from './AnswerNotice';
import {useReducedMotion} from './hooks';
import './blue-sweep.css';

export function BlueSweep({active,before,after,className=''}:{active:boolean;before:ReactNode;after:ReactNode;className?:string}){
 const root=useRef<HTMLSpanElement>(null),animations=useRef<Animation[]>([]),previous=useRef(active),mounted=useRef(false);
 const [direction,setDirection]=useState<'idle'|'forward'|'backward'>('idle'),reduce=useReducedMotion();
 useLayoutEffect(()=>{
  const element=root.current;if(!element)return;
  const first=element.querySelector<HTMLElement>('.blue-sweep-before'),last=element.querySelector<HTMLElement>('.blue-sweep-after'),tint=element.querySelector<HTMLElement>('.input-answer-reveal'),line=element.querySelector<HTMLElement>('.input-answer-sweep');
  if(!first||!last||!tint||!line)return;
  const style=getComputedStyle(line),width=parseFloat(style.width);
  const current=animations.current.length&&width>0?Math.max(0,Math.min(1,1+new DOMMatrixReadOnly(style.transform).m41/width)):(previous.current?1:0);
  for(const animation of animations.current)animation.cancel();animations.current=[];
  const target=active?1:0,place=(progress:number)=>{
   last.style.clipPath=progress>=1?'none':`inset(0 ${(1-progress)*100}% 0 0)`;
   first.style.clipPath=progress<=0?'none':`inset(0 0 0 ${progress*100}%)`;
   tint.style.clipPath=last.style.clipPath;line.style.transform=`translateX(${(progress-1)*100}%)`;
  };
  const initial=!mounted.current;mounted.current=true;previous.current=active;
  const distance=Math.abs(target-current);
  if(initial||reduce||distance<.0001){place(target);setDirection('idle');return;}
  setDirection(active?'forward':'backward');
  const options:KeyframeAnimationOptions={duration:480*distance,easing:'cubic-bezier(.77,0,.175,1)',direction:active?'normal':'reverse',fill:'both'},positions=active?[current,target]:[target,current];
  const reveal=positions.map(progress=>({clipPath:`inset(0 ${(1-progress)*100}% 0 0)`}));
  const running=[last.animate(reveal,options),first.animate(positions.map(progress=>({clipPath:`inset(0 0 0 ${progress*100}%)`})),options),tint.animate(reveal,options),line.animate(positions.map(progress=>({transform:`translateX(${(progress-1)*100}%)`})),options)];
  animations.current=running;
  running[0]!.onfinish=()=>{if(animations.current[0]!==running[0])return;place(target);for(const animation of running)animation.cancel();animations.current=[];setDirection('idle');};
 },[active,reduce]);
 useEffect(()=>()=>{for(const animation of animations.current)animation.cancel();animations.current=[];},[]);
 return <span ref={root} className={`blue-sweep ${className}`} data-active={active} data-direction={direction}>
  <span className="blue-sweep-face blue-sweep-before" aria-hidden={active}>{before}</span>
  <span className="blue-sweep-face blue-sweep-after" aria-hidden={!active}>{after}</span>
  <span className="blue-sweep-effect" aria-hidden="true"><AnswerTint kind="good" persistent/></span>
 </span>;
}
