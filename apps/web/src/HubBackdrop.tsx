import { useLayoutEffect, useRef, type RefObject } from 'react';

/** A single backdrop-filter layer with a clear cut-out over the profile card.
 * Coordinates follow the rendered card, including viewport scaling. */
export function HubBackdrop({root,card,clearWindow,trackMovement=false}:{root:RefObject<HTMLElement|null>;card:RefObject<HTMLElement|null>;clearWindow:boolean;trackMovement?:boolean}) {
  const surface=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    let frame=0,movementFrame=0,scrollRoot:HTMLElement|null=null;
    const measure=()=>{
      const page=root.current;if(!page)return;
      const bounds=page.getBoundingClientRect(),style=getComputedStyle(page);
      const width=parseFloat(style.width),height=parseFloat(style.height);
      if(!width||!height||!bounds.width||!bounds.height)return;
      // Extend past the viewport to avoid an anti-aliased unshaded edge.
      let path=`M-2 -2H${width+2}V${height+2}H-2Z`;
      if(clearWindow&&card.current){
        const rect=card.current.getBoundingClientRect(),sx=bounds.width/width,sy=bounds.height/height;
        const x=(rect.left-bounds.left)/sx,y=(rect.top-bounds.top)/sy,w=rect.width/sx,h=rect.height/sy;
        const cut=parseFloat(getComputedStyle(card.current).getPropertyValue('--card-cut'))||0;
        // Cover the card's anti-aliased edge with one screen pixel of backdrop.
        // Matching translucent clip edges leave the bright page image exposed.
        const ix=1/sx,iy=1/sy;
        if(w>2*ix&&h>2*iy){
          const slope=cut/h,side=Math.hypot(ix,slope*iy);
          path+=` M${x+cut-slope*iy+side} ${y+iy}H${x+w-slope*iy-side}L${x+w-cut+slope*iy-side} ${y+h-iy}H${x+slope*iy+side}Z`;
        }
      }
      if(surface.current)surface.current.style.clipPath=`path(evenodd, "${path}")`;
    };
    const follow=()=>{measure();movementFrame=requestAnimationFrame(follow);};
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
    const observer=new ResizeObserver(schedule);
    // A sibling's DOM ref is not guaranteed to be attached during this child's
    // layout effect. Measure after the commit, then keep both boxes observed.
    measure();
    frame=requestAnimationFrame(()=>{
      if(root.current){scrollRoot=root.current;observer.observe(root.current);scrollRoot.addEventListener('scroll',schedule,true);}
      if(card.current)observer.observe(card.current);measure();
      if(trackMovement)movementFrame=requestAnimationFrame(follow);
    });
    window.addEventListener('resize',schedule);
    return()=>{observer.disconnect();cancelAnimationFrame(frame);cancelAnimationFrame(movementFrame);scrollRoot?.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);};
  },[root,card,clearWindow,trackMovement]);
  return <div ref={surface} className="hub-backdrop" aria-hidden="true"/>;
}
