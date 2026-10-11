import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {useReducedMotion} from './hooks';
import {gsap} from './visual';

export function TutorialBlackTransition({welcome=false,onCovered,onFinished}:{welcome?:boolean;onCovered:()=>void|Promise<void>;onFinished:()=>void}){
 const shade=useRef<HTMLDivElement>(null),text=useRef<HTMLDivElement>(null),invitation=useRef<HTMLParagraphElement>(null),reduce=useReducedMotion();
 useEffect(()=>{
  let alive=true;
  const duration=reduce?.12:.65;
  const timeline=gsap.timeline({paused:true}).to(shade.current,{opacity:1,duration,ease:'phigrosFadeOut'});
  if(welcome)timeline.to(text.current,{opacity:1,duration,ease:'phigrosFadeIn'})
   .to(text.current,{opacity:0,duration:reduce?.12:.4,delay:1.6,ease:'phigrosFadeOut'})
   .to(invitation.current,{opacity:1,duration,delay:.25,ease:'phigrosFadeIn'})
   .to(invitation.current,{opacity:0,duration:reduce?.12:.4,delay:1.6,ease:'phigrosFadeOut'});
  timeline.call(()=>{
   timeline.pause();
   void Promise.resolve(onCovered()).then(()=>{if(alive)timeline.resume();});
  }).to(shade.current,{opacity:0,duration,delay:.25,ease:'phigrosFadeIn'})
   .call(()=>{if(alive)onFinished();});
  timeline.play();
  return()=>{alive=false;timeline.kill();};
 },[welcome,reduce,onCovered,onFinished]);
 return createPortal(<div ref={shade} className={`tutorial-black-transition ${welcome?'tutorial-welcome':'tutorial-game-transition'}`} data-noise-safe>
  {welcome&&<><div ref={text} className="tutorial-welcome-text" role="status"><h1>Welcome to Phiguess</h1><p>二创Phigros猜曲绘小游戏</p></div><p ref={invitation} className="tutorial-welcome-invitation" role="status">现在，我将带你进入新手教程</p></>}
 </div>,document.body);
}
