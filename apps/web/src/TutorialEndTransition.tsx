import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {go,useReducedMotion} from './hooks';
import {gsap} from './visual';

// App owns this overlay so it can fade away after the tutorial route unmounts.
export function TutorialEndTransition({onFinished}:{onFinished:()=>void}){
 const shade=useRef<HTMLDivElement>(null),text=useRef<HTMLParagraphElement>(null),reduce=useReducedMotion();
 useEffect(()=>{
  const duration=reduce?.12:.65;
  const timeline=gsap.timeline({onComplete:onFinished})
   .to(shade.current,{opacity:1,duration,ease:'phigrosFadeOut'})
   .to(text.current,{opacity:1,duration,ease:'phigrosFadeIn'})
   .to(text.current,{opacity:0,duration:reduce?.12:.4,delay:1.4,ease:'phigrosFadeOut'})
   .call(()=>go('/account'))
   .to(shade.current,{opacity:0,duration,delay:.25,ease:'phigrosFadeIn'});
  return()=>{timeline.kill();};
 },[reduce,onFinished]);
 return createPortal(<div ref={shade} className="tutorial-ending" data-noise-safe><p ref={text} role="status">教学结束<br/><span>下一局，轮到你了。</span></p></div>,document.body);
}
