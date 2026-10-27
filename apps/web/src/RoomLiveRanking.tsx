import {useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import type {MatchView} from '../../../packages/contracts/src';
import {useReducedMotion} from './hooks';
import {Avatar} from './visual';
import {RANKING_ROW_STEP,useRankingMotion} from './use-ranking-motion';
import './room-live-ranking.css';

function RankingName({name}:{name:string}){
 const text=useRef<HTMLSpanElement>(null);
 useLayoutEffect(()=>{
  const element=text.current;if(!element)return;let alive=true;
  const fit=()=>{
   let size=13;element.style.fontSize=`${size}px`;
   while(size>9&&(element.scrollWidth>element.clientWidth||element.scrollHeight>element.clientHeight)){
    size-=.5;element.style.fontSize=`${size}px`;
   }
  };
  fit();const observer=new ResizeObserver(fit);observer.observe(element);void document.fonts.ready.then(()=>{if(alive)fit();});
  return()=>{alive=false;observer.disconnect();};
 },[name]);
 return <span ref={text} className="room-live-name" title={name}>{name}</span>;
}

export function RoomLiveRanking({match,userId,capacity}:{match:MatchView;userId:string;capacity:number}){
 const reduce=useReducedMotion(),[showScores,setShowScores]=useState(false),list=useRef<HTMLOListElement>(null);
 const isDead=(player:MatchView['players'][number])=>capacity>0&&Boolean(player.dead);
 const players=[...match.players].sort((a,b)=>Number(isDead(a))-Number(isDead(b))||b.score-a.score||a.id.localeCompare(b.id));
 let rank=0,lastKey:string|undefined;
 const ranked=players.map(player=>{const key=`${isDead(player)}:${player.score}`;if(key!==lastKey){rank++;lastKey=key;}return {...player,rank};});
 const ownIndex=ranked.findIndex(player=>player.id===userId);
 const indices=ownIndex<=1?[0,1,2]:[0,ownIndex-1,ownIndex,ownIndex+1];
 const visible=indices.filter(index=>index<ranked.length).map(index=>ranked[index]!);
 const visibleIds=visible.map(player=>player.id),selected=new Set(visibleIds);
 useRankingMotion(list,ranked.map(player=>player.id),visibleIds,ownIndex>=3,userId,reduce);
 return <aside className="room-live-ranking" aria-label="实时排行榜" data-reduced-motion={reduce} data-show-scores={showScores} data-visible-count={visible.length} data-pinned-leader={ownIndex>=3} style={{'--ranking-max-inset':`${Math.max(0,visible.length-1)*RANKING_ROW_STEP*Math.tan(Math.PI/12)}px`} as CSSProperties}>
   <header><span>实时排名</span><small>{showScores?'SCORE':'LIVE'}</small></header>
   <ol ref={list} aria-label="玩家实时排名" aria-live="polite" aria-relevant="additions text">
    {ranked.map(player=><li key={player.id} className={`room-live-slot ${player.id===userId?'is-self':''} ${isDead(player)?'is-dead':''}`} data-player-id={player.id} aria-hidden={!selected.has(player.id)} inert={!selected.has(player.id)} aria-label={`第 ${player.rank} 名，${player.name}${isDead(player)?'，死亡':''}${player.id===userId?'，你':''}`}>
     <div className={`room-live-row ${player.id===userId?'is-self':''} ${isDead(player)?'is-dead':''}`}>
     <button type="button" aria-pressed={showScores} aria-label={`${player.name}，${showScores?`${player.score} 分，点击收起分数`:'点击显示分数'}`} onClick={()=>setShowScores(value=>!value)} title={showScores?'点击收起分数':'点击显示分数'}>
      <span className="room-live-rank">{String(player.rank).padStart(2,'0')}</span>
      <span className="room-live-avatar"><Avatar user={player}/></span>
      <span className="room-live-copy"><RankingName name={player.name}/>{isDead(player)&&<small>死亡</small>}</span>
      <b className="room-live-score" style={player.score>=1000000?{fontSize:11}:player.score>=100000?{fontSize:12}:undefined} aria-hidden={!showScores}>{player.score.toLocaleString()}</b>
     </button>
     </div>
    </li>)}
   </ol>
 </aside>;
}
