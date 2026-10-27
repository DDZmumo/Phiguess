import {useLayoutEffect,useRef,type RefObject} from 'react';

export const RANKING_ROW_STEP=54;
const VIEWPORT_HEIGHT=RANKING_ROW_STEP*4,SLOPE=Math.tan(Math.PI/12);
type Region='all'|'leader'|'neighbors';
interface Layout{order:string[];visible:string[];pinned:boolean}
interface RowMotion{visible:boolean;exiting:boolean;slot:number;generation:number}
function place(node:HTMLElement,y:number,opacity:number){
 node.style.transform=`translateY(${y}px)`;node.style.opacity=String(opacity);node.style.visibility=opacity?'visible':'hidden';
}

/** Keep every participant mounted so interrupted moves and exits retain their current position. */
export function useRankingMotion(root:RefObject<HTMLOListElement|null>,order:string[],visible:string[],pinned:boolean,userId:string,reduced:boolean){
 const previous=useRef<Layout|null>(null),motions=useRef(new Map<string,RowMotion>()),animations=useRef(new Map<HTMLElement,Animation>());
 const layoutKey=JSON.stringify([order,visible]);
 useLayoutEffect(()=>{
  const list=root.current;if(!list)return;
  const old=previous.current,slots=new Map(visible.map((id,index)=>[id,index]));
  const next:Layout={order:[...order],visible:[...visible],pinned};
  const regionFor=(slot:number):Region=>pinned?(slot===0?'leader':'neighbors'):'all';
  const oldStart=old?.order.indexOf(old.visible[old.pinned?1:0]??'')??0;
  const oldEnd=old?Math.max(...old.visible.map(id=>old.order.indexOf(id))):0;
  const nextStart=order.indexOf(visible[pinned?1:0]??'');
  const move=(node:HTMLElement,y:number,opacity:number,duration:number,finish:()=>void)=>{
   const current=getComputedStyle(node),from={transform:current.transform,opacity:current.opacity};
   animations.current.get(node)?.cancel();
   place(node,y,opacity);node.style.visibility='visible';
   const animation=node.animate([from,{transform:`translateY(${y}px)`,opacity}],{duration,easing:'cubic-bezier(.23,1,.32,1)'});
   animations.current.set(node,animation);
   animation.onfinish=()=>{
    if(animations.current.get(node)!==animation)return;
    animations.current.delete(node);node.style.visibility=opacity?'visible':'hidden';finish();
   };
  };
  for(const lane of list.querySelectorAll<HTMLLIElement>('.room-live-slot')){
   const id=lane.dataset.playerId!,node=lane.querySelector<HTMLDivElement>('.room-live-row')!;
   const slot=slots.get(id)??-1,selected=slot>=0;
   let state=motions.current.get(id);
   if(!state){state={visible:false,exiting:false,slot:-1,generation:0};motions.current.set(id,state);}
   if(!old||reduced){
    animations.current.get(node)?.cancel();animations.current.delete(node);state.generation++;state.visible=selected;state.exiting=false;state.slot=slot;
    node.style.setProperty('--ranking-inset',`${Math.max(0,slot)*RANKING_ROW_STEP*SLOPE}px`);
    lane.dataset.motionRegion=regionFor(slot);lane.dataset.motionPhase=selected?'settled':'hidden';
    lane.style.zIndex=id===userId?'3':'1';
    place(node,selected?slot*RANKING_ROW_STEP:VIEWPORT_HEIGHT,selected?1:0);
    continue;
   }
   if(selected){
    const wasVisible=state.visible,wasExiting=state.exiting,oldSlot=state.slot,target=slot*RANKING_ROW_STEP;
    const region=regionFor(slot),crossesRegions=wasVisible&&(old.pinned!==pinned||(oldSlot===0)!==(slot===0));
    node.style.setProperty('--ranking-inset',`${slot*RANKING_ROW_STEP*SLOPE}px`);
    if(wasVisible&&oldSlot===slot&&!wasExiting){
     // Score-only updates and offscreen swaps must not restart a running animation.
     if(lane.dataset.motionPhase==='settled')lane.dataset.motionRegion=region;
     continue;
    }
    lane.dataset.motionRegion=crossesRegions?'all':region;
    const transform=getComputedStyle(node).transform,currentY=transform==='none'?0:new DOMMatrixReadOnly(transform).m42;
    if(!wasVisible&&!wasExiting){
     const formerIndex=old.order.indexOf(id);
     const fromAbove=formerIndex>=0&&formerIndex<oldStart;
     const fromBelow=formerIndex>oldEnd||formerIndex<0;
     const enteringFromAbove=fromAbove||(!fromBelow&&formerIndex<order.indexOf(id));
     const start=pinned&&slot===0?RANKING_ROW_STEP:enteringFromAbove?(pinned?0:-RANKING_ROW_STEP):VIEWPORT_HEIGHT;
     animations.current.get(node)?.cancel();animations.current.delete(node);place(node,start,0);
    }
    state.visible=true;state.exiting=false;state.slot=slot;
    const generation=++state.generation;
    lane.dataset.motionPhase=wasVisible?'moving':'entering';
    lane.style.zIndex=id===userId?'3':target<currentY?'2':'1';
    move(node,target,1,260,()=>{
     if(state!.generation!==generation)return;
     const latest=previous.current,latestSlot=latest?.visible.indexOf(id)??slot;
     lane.dataset.motionPhase='settled';lane.dataset.motionRegion=latest?.pinned?(latestSlot===0?'leader':'neighbors'):'all';lane.style.zIndex=id===userId?'3':'1';
    });
   }else if(state.visible){
    const leaderExit=pinned&&state.slot===0;
    const newIndex=order.indexOf(id),above=newIndex>=0&&newIndex<nextStart;
    const region:Region=leaderExit?'leader':state.slot>0&&(old.pinned||pinned)?'neighbors':'all';
    const target=leaderExit?-RANKING_ROW_STEP:above?(pinned?0:-RANKING_ROW_STEP):VIEWPORT_HEIGHT;
    state.visible=false;state.exiting=true;
    const generation=++state.generation;
    lane.dataset.motionRegion=region;lane.dataset.motionPhase='exiting';lane.style.zIndex='0';
    move(node,target,0,220,()=>{
     if(state!.generation!==generation)return;
     state!.exiting=false;lane.dataset.motionPhase='hidden';
    });
   }
   // Already exiting rows finish on their original timeline, even during rapid updates.
  }
  previous.current=next;
 },[layoutKey,pinned,userId,reduced]);
 useLayoutEffect(()=>{
  const list=root.current;
  return()=>{
   if(list){
    const nodes=list.querySelectorAll<HTMLElement>('.room-live-row'),layout=previous.current;
    for(const animation of animations.current.values())animation.cancel();animations.current.clear();
    // Fast Refresh can retain the DOM while rerunning effects. Settle canceled moves first.
    for(const node of nodes){
     const lane=node.closest<HTMLLIElement>('.room-live-slot')!,slot=layout?.visible.indexOf(lane.dataset.playerId!)??-1;
     place(node,slot<0?VIEWPORT_HEIGHT:slot*RANKING_ROW_STEP,slot<0?0:1);
     lane.dataset.motionPhase=slot<0?'hidden':'settled';
    }
   }
   previous.current=null;motions.current.clear();
  };
 },[]);
}
