import {useLayoutEffect,type RefObject} from 'react';

/** Native input controls a fixed three-row range; visible cards can travel to the screen edges. */
export function useResultScroll(root:RefObject<HTMLElement|null>,enabled:boolean,portrait:boolean,count:number,reduced:boolean){
 useLayoutEffect(()=>{
  const scene=root.current,scroll=scene?.querySelector<HTMLElement>('.result-scroll'),track=scene?.querySelector<HTMLElement>('.result-rows-track'),surface=scene?.querySelector<HTMLElement>('.result-rows');
  if(!scene||!scroll||!track||!surface)return;
  const rows=[...track.querySelectorAll<HTMLElement>('.result-course-row')];
  let frame=0,offsets:{top:number;height:number}[]=[],touch:{id:number;y:number;scroll:number;dragged:boolean}|null=null,suppressClick=false;
  function paint(){
   frame=0;
   const offset=scroll!.scrollTop;
   track!.style.transform=`translateY(${-offset}px)`;
   if(!enabled){for(const row of rows)row.style.filter='none';return;}
   const bounds=scene!.getBoundingClientRect(),surfaceBounds=surface!.getBoundingClientRect(),scrollBounds=scroll!.getBoundingClientRect();
   const top=Math.max(0,bounds.top),bottom=Math.min(innerHeight,bounds.bottom);
   const scale=rows[0]&&offsets[0]?rows[0].getBoundingClientRect().height/offsets[0].height:1;
   const blurs=offsets.map(({top:rowTop,height})=>{
    const y=surfaceBounds.top+(rowTop-offset)*scale,h=height*scale;
    if(y+h<top||y>bottom)return 0;
    const above=Math.max(0,scrollBounds.top-y)/Math.max(1,scrollBounds.top-top);
    const below=Math.max(0,y+h-scrollBounds.bottom)/Math.max(1,bottom-scrollBounds.bottom);
    return Math.min(1,Math.max(above,below))*(reduced?5:10);
   });
   // Read geometry before updating filters; opacity remains unchanged throughout scrolling.
   rows.forEach((row,i)=>{row.style.filter=blurs[i]!>.01?`blur(${blurs[i]!.toFixed(2)}px)`:'none';});
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(paint);}
  function measure(){offsets=rows.map(row=>({top:row.offsetTop,height:row.offsetHeight}));schedule();}
  function wheel(event:WheelEvent){
   if(!enabled||event.ctrlKey||event.target instanceof Element&&event.target.closest('.result-summary'))return;
   const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?scroll!.clientHeight:1);
   event.preventDefault();scroll!.scrollTop+=delta;schedule();
  }
  function pointerDown(event:PointerEvent){
   suppressClick=false;
   if(!enabled||event.pointerType!=='touch'||!event.isPrimary||event.target instanceof Element&&event.target.closest('.result-summary,.result-nav'))return;
   touch={id:event.pointerId,y:event.clientY,scroll:scroll!.scrollTop,dragged:false};
  }
  function pointerMove(event:PointerEvent){
   if(!touch||event.pointerId!==touch.id)return;
   const delta=touch.y-event.clientY;if(!touch.dragged&&Math.abs(delta)<8)return;
   if(!touch.dragged){touch.dragged=true;scene!.setPointerCapture(event.pointerId);}
   suppressClick=true;if(event.cancelable)event.preventDefault();
   const scale=scroll!.getBoundingClientRect().height/Math.max(1,scroll!.clientHeight);
   scroll!.scrollTop=touch.scroll+delta/Math.max(.01,scale);schedule();
  }
  function pointerEnd(){touch=null;}
  function click(event:MouseEvent){if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;}}
  const observer=new ResizeObserver(measure);observer.observe(scroll);observer.observe(scene);
  measure();scroll.addEventListener('scroll',schedule,{passive:true});scene.addEventListener('wheel',wheel,{passive:false});
  scene.addEventListener('pointerdown',pointerDown);scene.addEventListener('pointermove',pointerMove,{passive:false});scene.addEventListener('pointerup',pointerEnd);scene.addEventListener('pointercancel',pointerEnd);scene.addEventListener('click',click,true);
  return()=>{cancelAnimationFrame(frame);observer.disconnect();scroll.removeEventListener('scroll',schedule);scene.removeEventListener('wheel',wheel);scene.removeEventListener('pointerdown',pointerDown);scene.removeEventListener('pointermove',pointerMove);scene.removeEventListener('pointerup',pointerEnd);scene.removeEventListener('pointercancel',pointerEnd);scene.removeEventListener('click',click,true);};
 },[root,enabled,portrait,count,reduced]);
}
