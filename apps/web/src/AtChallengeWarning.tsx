import { useEffect, useRef, useState } from 'react';
import { SongName } from './SongName';
import {CHARACTER_TRANSITION_MS,CHARACTER_REVEAL_DELAY_MS,randomCharacterRanks,scrambledCharacters} from './character-scramble';

const parts=['AT难度下曲绘抽象程度极高','题数无穷 每题限时30秒','血条强制开启','20HP','你确定还要继续挑战吗？'];
const offsets=parts.map((_,index)=>parts.slice(0,index).join('').length),characterCount=parts.join('').length;

export function AtChallengeWarning({capacity,reduce,concealing,onChange,onReady,onConcealed}:{capacity:20|50;reduce:boolean;concealing:boolean;onChange:(capacity:20|50)=>void;onReady:(ready:boolean)=>void;onConcealed:()=>void}){
  const [ranks]=useState(()=>randomCharacterRanks(characterCount)),[settled,setSettled]=useState(0),[frame,setFrame]=useState(0),[changing,setChanging]=useState(false);
  const settledRef=useRef(settled);settledRef.current=settled;
  const revealed=settled===characterCount;
  useEffect(()=>{
    onReady(false);
    if(concealing){
      if(reduce){setSettled(0);onConcealed();return;}
      const initial=settledRef.current,started=performance.now();let notified=false;
      const timer=setInterval(()=>{
        const count=Math.max(0,initial-Math.floor((performance.now()-started)/CHARACTER_TRANSITION_MS*characterCount));
        setFrame(value=>(value+1)%65536);setSettled(count);
        if(count===0&&!notified){notified=true;onConcealed();}
      },40);
      return()=>clearInterval(timer);
    }
    if(reduce){setSettled(characterCount);onReady(true);return;}
    setSettled(0);const started=performance.now();
    const timer=setInterval(()=>{
      const count=Math.min(characterCount,Math.max(0,Math.floor((performance.now()-started-CHARACTER_REVEAL_DELAY_MS)/CHARACTER_TRANSITION_MS*characterCount)));
      setFrame(value=>(value+1)%65536);setSettled(count);
      if(count===characterCount){clearInterval(timer);onReady(true);}
    },40);
    return()=>clearInterval(timer);
  },[reduce,concealing,onReady,onConcealed]);
  useEffect(()=>{
    if(!changing)return;
    const timer=setTimeout(()=>setChanging(false),reduce?0:450);return()=>clearTimeout(timer);
  },[changing,reduce]);
  const text=(index:number,value=parts[index]!)=>{
    const noise=scrambledCharacters(value,frame,index);
    return <span className="at-warning-scramble" aria-label={value}>{Array.from(value,(char,position)=>{
      const done=ranks[offsets[index]!+position]!<settled;
      return <span className="at-warning-character" key={position} data-settled={done} aria-hidden="true"><span className="at-warning-character-size">{char}</span><span className="at-warning-character-glyph">{done?char:noise[position]===char?'?':noise[position]}</span></span>;
    })}</span>;
  };
  return <div className="at-warning-message" data-revealed={revealed} data-concealing={concealing}>
    <span className="at-warning-line">{text(0)}</span>
    <span className="at-warning-line">{text(1)}</span>
    <span className="at-warning-line at-warning-health-line">{text(2)}<button className="at-warning-health" type="button" aria-label={`切换血条容量，当前${capacity}HP`} disabled={!revealed||concealing||changing} onClick={()=>{setChanging(true);onChange(capacity===20?50:20);}}>{revealed&&!concealing?<SongName title={`${capacity}HP`} scramble={`${capacity}HP`} animate={true} reduce={reduce}/>:text(3,`${capacity}HP`)}</button></span>
    <span className="at-warning-line">{text(4)}</span>
  </div>;
}
