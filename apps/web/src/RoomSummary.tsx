import {useLayoutEffect,useRef,useState} from 'react';
import {INFINITY_ROUNDS,type RoomOptions} from '../../../packages/contracts/src';

function SummaryValue({part,value,difficulty,index,reduced}:{part:string;value:string;difficulty:string;index:number;reduced:boolean}){
  const label=useRef<HTMLSpanElement>(null),previous=useRef<{value:string;difficulty:string}|null>(null);
  const [retained,setRetained]=useState(value),shown=value||retained;
  useLayoutEffect(()=>{
    const before=previous.current;previous.current={value,difficulty};
    const node=label.current;
    if(!node)return;
    const delay=before&&before.difficulty!==difficulty?index*55:0;
    if(value)setRetained(value);
    if(!value){
      if(!retained)return;
      if(reduced){setRetained('');return;}
      const leave=node.animate([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:'translateX(12px)'}],{duration:150,delay,easing:'cubic-bezier(.4,0,1,1)',fill:'both'});
      leave.onfinish=()=>setRetained('');
      return()=>leave.cancel();
    }
    if(!before||reduced||before.value===value&&before.difficulty===difficulty)return;
    const outgoing=node.cloneNode(true) as HTMLSpanElement;
    outgoing.textContent=before.value;outgoing.classList.add('room-summary-outgoing');outgoing.setAttribute('aria-hidden','true');
    node.parentElement!.append(outgoing);
    const leave=outgoing.animate([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:'translateX(12px)'}],{duration:150,delay,easing:'cubic-bezier(.4,0,1,1)',fill:'both'});
    const enter=node.animate([{opacity:0,transform:'translateX(-12px)'},{opacity:1,transform:'translateX(0)'}],{duration:240,delay:delay+90,easing:'cubic-bezier(.2,.7,.3,1)',fill:'backwards'});
    leave.onfinish=()=>outgoing.remove();
    return()=>{leave.cancel();enter.cancel();outgoing.remove();};
  },[value,difficulty,index,reduced]);
  return <span className="room-summary-token" data-summary-part={part} style={shown?undefined:{display:'none'}} aria-hidden={!value}><span ref={label} className="room-summary-value">{shown}</span></span>;
}

export function RoomSummary({options,reduced}:{options?:RoomOptions;reduced:boolean}){
  if(!options)return null;
  const endless=options.rounds===INFINITY_ROUNDS;
  const items=[['difficulty',options.difficulty.toUpperCase()],['rounds',endless?'Infinity':`${options.rounds} 题`],['roundSeconds',`${options.roundSeconds} 秒`],['matchSeconds',endless?`${(options.matchSeconds??180)/60} 分钟`:'']];
  return <>{items.map(([part,value],index)=><SummaryValue key={part} part={part!} value={value!} difficulty={options.difficulty} index={index} reduced={reduced}/>)}</>;
}
