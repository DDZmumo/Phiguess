import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, SlidersHorizontal } from 'lucide-react';
import type { MatchView } from '../../../packages/contracts/src';
import type { Progress } from './api';
import { useReducedMotion } from './hooks';
import { gsap, useGSAP } from './visual';
import { SongName,scrambleSongName } from './SongName';
import { SongRailNoise } from './SongRailNoise';
import './song-rail.css';

// One reference coordinate space, measured at half the supplied screenshot size.
const SLOPE=Math.tan(Math.PI/12),HEIGHT=834;
const plane=`193,0 613.75,0 ${613.75-HEIGHT*SLOPE},${HEIGHT} ${193-HEIGHT*SLOPE},${HEIGHT}`;
function position(index:number,round:number){
  const distance=round-index,offset=distance*64+(distance>0?13.25:distance<0?-10.25:0);
  return {x:125-offset*SLOPE,y:319.5+offset};
}
type Props={noiseClock:{skipFlashAt?:number;round:number;startsAt:number;deadline:number;now:number};match:MatchView;progress:Progress[];hintDisabled:boolean;onHint:()=>void;onSettings:()=>void};

export function SongRail({match,noiseClock,progress,hintDisabled,onHint,onSettings}:Props){
  const root=useRef<HTMLDivElement>(null),initialRound=useRef(match.round),reduce=useReducedMotion();
  const origins=useRef(new Map<number,{x:number;y:number;active:boolean}>());
  // Keep an Infinity deck from mounting hundreds of offscreen rows.
  const first=match.endless?Math.max(0,match.round-9):0,last=match.endless?Math.min(match.totalRounds,match.round+6):match.totalRounds;
  useEffect(()=>{for(const index of origins.current.keys())if(index<first||index>=last)origins.current.delete(index);},[first,last]);
  const [scrambleFrame,setScrambleFrame]=useState(0);
  useEffect(()=>{
    if(reduce)return;
    const timer=setInterval(()=>{if(!document.hidden)setScrambleFrame(value=>(value+1)%65536);},40);
    return()=>clearInterval(timer);
  },[reduce]);
  useGSAP(()=>{
    const motion={duration:reduce?0:.8,ease:'phigrosScroll',overwrite:true};
    root.current?.querySelectorAll<HTMLElement>('.song-rail-row').forEach(row=>{
      const index=Number(row.dataset.index),active=index===match.round;
      gsap.to(row,{...position(index,match.round),'--noise-compact':active?0:1,...motion});
      gsap.to(row.querySelector('.song-rail-title'),{x:active?-11.5:0,y:active?-10:.5,...motion});
      gsap.to(row.querySelector('.song-rail-status'),{opacity:active?1:0,duration:reduce?0:.2,overwrite:true});
    });
  },{scope:root,dependencies:[match.round,reduce,position]});
  return <div className="song-rail-viewport">
    <div className="song-rail" ref={root} data-round={match.round}>
      <svg className="song-rail-surface" viewBox="0 0 640 834" aria-hidden="true">
        <polygon className="song-rail-plane" points={plane}/>
        <polygon className="song-rail-selection" points="101.5,304.5 544.5,304.5 520.25,395 77.25,395"/>
      </svg>
      <div className="song-rail-rows" role="list" aria-label="歌曲猜测进度">
        {Array.from({length:last-first},(_,offset)=>{
          const index=first+offset,entry=progress.find(p=>p.round===index),active=index===match.round;
          let start=origins.current.get(index);
          if(!start){const round=match.endless?match.round:initialRound.current;start={...position(index,round),active:index===round};origins.current.set(index,start);}
          return <div key={index} role="listitem" data-index={index} aria-current={active?'step':undefined} className={`song-rail-row ${active?'current':''} ${entry?.correct?'solved':''}`} style={{transform:`translate(${start.x}px,${start.y}px)`,'--noise-compact':start.active?0:1} as CSSProperties}>
            <div className="song-rail-copy">
              <span className="song-rail-title" style={{transform:`translate(${start.active?-11.5:0}px,${start.active?-10:.5}px)`}}><SongName title={entry?.correct?entry.title:null} scramble={scrambleSongName(index+5,scrambleFrame)} animate={active&&match.status!=='finished'&&match.status!=='interrupted'} reduce={reduce}/></span>
              <small className="song-rail-status" aria-hidden={!active} style={{opacity:start.active?1:0}}>{entry?.correct?'已猜中':match.status!=='playing'?'未猜出':'正在猜测'}</small>
            </div>
            <span className="song-rail-number" aria-hidden={active}>{String(index+1).padStart(2,'0')}</span>
          </div>;
        })}
      </div>
      <SongRailNoise rail={root} clock={noiseClock} progress={progress} reduce={reduce}/>
      <div className="song-rail-badge">
        <svg viewBox="0 0 120.5 99" aria-hidden="true"><polygon points="26.5,0 120.5,0 94,99 0,99"/></svg>
        <strong>{String(match.round+1).padStart(2,'0')}</strong><small>{match.difficulty.toUpperCase()}</small>
      </div>
      <div className="song-rail-toolbar">
        <div className="song-rail-progress"><small>猜测进度</small><span><ArrowDown size={20}/>{String(match.round+1).padStart(2,'0')} / {match.endless?'Infinity':String(match.totalRounds).padStart(2,'0')} 首</span></div>
        <button className="song-rail-hint" disabled={hintDisabled} onClick={onHint}><span className="song-rail-hint-symbol" aria-hidden="true">‹?›</span><span>提示</span></button>
        <i aria-hidden="true"/>
        <button className="song-rail-settings" onClick={onSettings}><SlidersHorizontal size={27} strokeWidth={1.1}/><span>设置</span></button>
      </div>
    </div>
  </div>;
}
