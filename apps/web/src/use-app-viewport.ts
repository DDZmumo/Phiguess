import {useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {isTextEntry,mobileViewport,type MobileViewport} from './mobile-viewport';

export function useAppViewport(root:RefObject<HTMLElement|null>,mobile:boolean,account:boolean){
 const stable=useRef<MobileViewport>({width:innerWidth,height:innerHeight,visibleHeight:innerHeight,keyboard:false});
 const [size,setSize]=useState({width:innerWidth,height:innerHeight,visibleHeight:innerHeight,scale:innerHeight/834,keyboard:false});
 useLayoutEffect(()=>{
  let frame=0;
  const measure=()=>{
   frame=0;const element=root.current;if(!element)return;
   const style=getComputedStyle(element),px=(value:string)=>parseFloat(value)||0;
   const width=Math.max(1,element.clientWidth-px(style.paddingLeft)-px(style.paddingRight));
   const height=Math.max(1,element.clientHeight-px(style.paddingTop)-px(style.paddingBottom));
   const visibleHeight=Math.max(1,Math.min(height,(window.visualViewport?.height??height)+(window.visualViewport?.offsetTop??0)-element.getBoundingClientRect().top-px(style.paddingTop)));
   const viewport=mobileViewport(stable.current,{width,height,visibleHeight},isTextEntry(document.activeElement),mobile);stable.current=viewport;
   const portrait=width<viewport.height,scale=portrait?width/810:viewport.height/834;
   const next={width,height:portrait&&!account?Math.max(viewport.height,scale*1500):viewport.height,visibleHeight,scale,keyboard:viewport.keyboard};
   setSize(before=>Object.keys(next).every(key=>before[key as keyof typeof before]===next[key as keyof typeof next])?before:next);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
  const observer=new ResizeObserver(schedule);if(root.current)observer.observe(root.current);
  measure();window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
  document.addEventListener('focusin',schedule);document.addEventListener('focusout',schedule);
  return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);document.removeEventListener('focusin',schedule);document.removeEventListener('focusout',schedule);};
 },[root,mobile,account]);
 return size;
}
