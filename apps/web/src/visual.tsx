import {playSound} from './sound';
import { useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { CustomEase } from 'gsap/CustomEase';
import { ArrowLeft } from 'lucide-react';
import { useReducedMotion } from './hooks';
import { useStore,type Session } from './store';
import './player-chip.css';

gsap.registerPlugin(useGSAP,CustomEase);
// Motion anchors tracked from the supplied 60 fps clip, 3.533–4.333 seconds.
// The small overshoot is visible in the source and intentionally retained.
CustomEase.create('phigrosScroll','M0,0 L.0208,.125 .0833,.3438 .1458,.5938 .2083,.7188 .2708,.8125 .4167,.9375 .5417,1.0625 .6667,1.0938 .75,1.0938 .8333,1.0313 1,1');
CustomEase.create('phigrosArtwork','M0,0 L.0833,.34 .1667,.60 .3333,.86 .5,.95 .6667,.99 1,1');
CustomEase.create('phigrosFadeOut','M0,0 L.1,.14 .2,.28 .3,.39 .4,.50 .5,.59 .6,.73 .7,.80 .8,.90 .9,.96 1,1');
CustomEase.create('phigrosFadeIn','M0,0 L.06,.03 .12,.06 .24,.18 .36,.31 .48,.46 .60,.63 .72,.78 .84,.91 1,1');
export { gsap,useGSAP };
export const modeTransitionDuration=(reduced:boolean)=>reduced?.12:.7;
export const titleTransitionTiming=(reduced:boolean)=>({exit:reduced?.1:.4,pause:reduced?0:.3,enter:reduced?.1:.7});

export function Mesh() {
  return <svg className="mesh" viewBox="0 0 1210 834" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1">
    <path d="M0 125L214 212 419 37 588 245 817 71 1046 222 1210 117M0 393L214 212 386 425 588 245 742 457 1046 222 1210 412M0 660L173 582 386 425 498 678 742 457 934 637 1210 412M173 582L109 834M498 678L591 834M934 637L1032 834M0 125L0 393 173 582 214 212 419 37 386 425 588 245 498 678 934 637 1046 222 817 71 742 457 1210 700M0 660L498 678 109 834M591 834L934 637 1210 700M1210 117L1046 222 1210 412M173 582L498 678M817 71L588 245M934 637L1210 834"/>
    <path opacity=".45" d="M0 275L419 37M0 759L386 425M742 457L1210 117M591 834L742 457M214 212L498 678M0 393L498 678M817 71L934 637"/>
  </g></svg>;
}
export function Back({onClick,label='返回账号界面'}:{onClick:()=>void;label?:string}) {
  return <button className="back-button" aria-label={label} onClick={()=>{playSound('ui.back');onClick();}}><ArrowLeft size={38} strokeWidth={1.3}/></button>;
}
export function UserChip({user:providedUser,subtitle='PHIGUESS'}:{user?:Session['user'];subtitle?:string}={}) {
  const storedUser=useStore(s=>s.session?.user),user=providedUser??storedUser;
  return <div className="player-chip" aria-label="当前玩家"><div className="player-chip-avatar"><Avatar user={user}/></div><div className="player-chip-copy"><span className="player-chip-name" title={user?.name||'Guest'}>{user?.name||'Guest'}</span><small title={subtitle}>{subtitle}</small></div></div>;
}
export function Avatar({user}:{user?:{name:string;avatarUrl?:string|null}}) {
  return <span className="avatar-face">{user?.avatarUrl?<img src={user.avatarUrl} alt="玩家头像"/>:<span role="img" aria-label="默认玩家头像">{user?.name?.slice(0,1)||'φ'}</span>}</span>;
}
export function FadeScene({children,scene}:{children:ReactNode;scene:string}) {
  const ref=useRef<HTMLDivElement>(null),reduce=useReducedMotion();
  const previous=useRef('title');
  useGSAP(()=>{
    if(scene==='results'){previous.current=scene;gsap.set(ref.current,{opacity:1});return;}
    const entry=previous.current==='title'||(scene==='title'&&previous.current==='account'),play=scene==='play'&&(previous.current==='difficulty'||previous.current==='room'),modeTransition=(scene==='difficulty'&&previous.current==='account')||(scene==='account'&&previous.current==='difficulty');previous.current=scene;
    gsap.fromTo(ref.current,{opacity:0},{opacity:1,delay:play?.8:0,duration:modeTransition?modeTransitionDuration(reduce):play?(reduce?.15:.65):entry?titleTransitionTiming(reduce).enter:reduce?.1:.25,ease:play||entry||modeTransition?'phigrosFadeIn':'power2.out'});
  },{scope:ref,dependencies:[scene],revertOnUpdate:true});
  return <div key={scene} ref={ref} className="scene" style={{opacity:0}}>{children}</div>;
}
export {Settings} from './Settings';
