const running=new WeakMap<HTMLElement,Animation>();
const easing='cubic-bezier(.349072516,.352504606,0,.998208084)';

export function windowPaint(window:HTMLElement){
 return [...window.querySelectorAll<HTMLElement>('[data-window-paint]')].filter(el=>el.closest('[data-window]')===window);
}
export function fadeWindowPaint(window:HTMLElement,visible:boolean,duration=300){
 const owned:Array<{el:HTMLElement;animation:Animation}>=[];
 for(const el of windowPaint(window)){
  const current=getComputedStyle(el).opacity,previous=running.get(el);
  el.style.opacity=current;if(previous){previous.cancel();running.delete(el);}
  const opacity=visible?'1':'0';
  if(!duration){el.style.opacity=opacity;continue;}
  const animation=el.animate([{opacity:current},{opacity}],{duration,easing,fill:'forwards'});
  running.set(el,animation);owned.push({el,animation});
  void animation.finished.then(()=>{if(running.get(el)!==animation)return;el.style.opacity=opacity;running.delete(el);animation.cancel();}).catch(()=>{});
 }
 return ()=>{for(const {el,animation} of owned){if(running.get(el)!==animation)continue;el.style.opacity=getComputedStyle(el).opacity;running.delete(el);animation.cancel();}};
}
