import {playSound} from './sound';
import {useState} from 'react';
import {useResource} from './hooks';
import {useStore} from './store';
import {Avatar} from './visual';
import {performanceBadgeTotals} from '../../../packages/game-core/src';
import {PerformanceBadge} from './PerformanceBadge';

type Entry={id:string;name:string;avatarUrl?:string|null;rank:string;score:number;correct:number;totalRounds:number;isGuest:boolean;isReference?:boolean};
export function Leaderboard(){
 const session=useStore(s=>s.session),preferences=useStore(s=>s.preferences);
 const [difficulty,setDifficulty]=useState<'in'|'at'>(()=>preferences.difficulty==='in'?'in':'at');
 const [capacity,setCapacity]=useState<20|50>(()=>preferences.healthCapacity===50?50:20);
 const [inSeconds,setInSeconds]=useState<15|30|60>(()=>preferences.roundSeconds===15||preferences.roundSeconds===60?preferences.roundSeconds:30);
 const seconds=difficulty==='at'?30:inSeconds;
 const {data:board,error}=useResource<Entry[]>(`leaderboards?difficulty=${difficulty}&healthCapacity=${capacity}&roundSeconds=${seconds}`);
 return <section className="leaderboard-panel" aria-label="Infinity 排行榜">
  <header><h1>Infinity 排行榜<span className="hub-heading-english">LEADERBOARD</span></h1></header>
  <div className="leaderboard-filters" role="group" aria-label="排行榜筛选">
   <div className="leaderboard-choice-group"><small>难度</small><div className="difficulty-picker leaderboard-choices" role="group" aria-label="排行榜难度">{(['in','at'] as const).map(d=><button key={d} className={`difficulty ${d} ${difficulty===d?'chosen':''}`} aria-pressed={difficulty===d} onClick={()=>{if(difficulty!==d){setDifficulty(d);playSound('ui.select');}}}>{d.toUpperCase()}</button>)}</div></div>
   <div className="leaderboard-choice-group"><small>血量</small><div className="difficulty-picker leaderboard-choices" role="group" aria-label="排行榜血量">{([20,50] as const).map(hp=><button key={hp} className={`difficulty ${capacity===hp?'chosen':''}`} aria-pressed={capacity===hp} onClick={()=>{if(capacity!==hp){setCapacity(hp);playSound('ui.select');}}}>{hp}HP</button>)}</div></div>
   <div className="leaderboard-choice-group"><small>每题时限</small><div className="difficulty-picker leaderboard-choices" role="group" aria-label="排行榜时限">{(difficulty==='at'?[30] as const:[15,30,60] as const).map(s=><button key={s} className={`difficulty ${seconds===s?'chosen':''}`} aria-pressed={seconds===s} disabled={difficulty==='at'} title={difficulty==='at'?'AT 固定为每题 30 秒':undefined} onClick={()=>{if(seconds!==s){setInSeconds(s);playSound('ui.select');}}}>{s}s</button>)}</div></div>
  </div>
  <div className="table-head"><span>排名</span><span>综合成绩</span><span>玩家</span><span>应猜</span><span>猜对</span><span>得分</span></div>
  <div className="rank-list">{board?.map(p=><div className={`rank-row ${p.id===session?.user.id?'is-me':''}`} key={p.id}><strong>{String(p.rank).padStart(2,'0')}</strong><PerformanceBadge grade={performanceBadgeTotals(p.score,p.correct,difficulty).grade} correct={p.correct}/><span className="rank-player"><Avatar user={p}/><span className="rank-player-copy"><span className="rank-player-name" title={p.name}>{p.name}</span>{p.isGuest&&<small className="rank-player-guest">游客</small>}</span></span><span>{p.totalRounds??'—'}</span><span>{p.correct}</span><b>{p.score.toLocaleString()}</b></div>)}
   {board?.length===0&&<p className="empty-state">这个条件下还没有完成的 Infinity 挑战。<br/><small>挑战结束后，成绩将计入对应榜单。</small></p>}
   {error&&<p className="inline-error" role="alert">{error}</p>}{!board&&!error&&<p className="empty-state" role="status">读取榜单中…</p>}
  </div>
 </section>;
}
