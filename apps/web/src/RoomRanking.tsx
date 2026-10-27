import {type RefObject} from 'react';
import type {MatchResultView} from '../../../packages/contracts/src';
import {Avatar} from './visual';
import {useResultScroll} from './use-result-scroll';

export function RoomRanking({root,result,userId,portrait,visible,interactive,reduced}:{root:RefObject<HTMLDivElement|null>;result:MatchResultView;userId:string;portrait:boolean;visible:boolean;interactive:boolean;reduced:boolean}){
 const isDead=(player:MatchResultView['players'][number])=>result.health_capacity>0&&Boolean(player.dead);
 const players=[...result.players].sort((a,b)=>Number(isDead(a))-Number(isDead(b))||b.score-a.score||a.user_id.localeCompare(b.user_id));
 let rank=0,lastKey:string|undefined;
 const ranked=players.map(player=>{const key=`${isDead(player)}:${player.score}`;if(key!==lastKey){rank++;lastKey=key;}return {...player,rank};});
 const survival=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
 useResultScroll(root,interactive,portrait,players.length,reduced);
 return <div ref={root} className="result-ranking-page result-secondary" aria-label="本场玩家排行榜" aria-hidden={!visible}>
  <h2 className="result-ranking-heading">玩家排行榜<span>ROOM RANKING</span></h2>
  <div className="result-scroll" role="region" aria-label="滚动玩家排行榜" tabIndex={interactive?0:-1}><div className="result-scroll-spacer" style={{height:Math.max(0,players.length*(portrait?142:106)-(portrait?18:16))}}/></div>
  <div className="result-rows"><div className="result-rows-track" role="list" aria-label="本场玩家成绩">
   {ranked.map(player=><article className={`result-course-row result-player-row ${player.user_id===userId?'is-self':''} ${isDead(player)?'is-dead':''}`} role="listitem" key={player.user_id} aria-label={`第 ${player.rank} 名，${player.name}，${player.score} 分`}>
    <div className="result-player-identity"><span className="result-player-rank">{String(player.rank).padStart(2,'0')}</span><div className="result-player-avatar"><Avatar user={{name:player.name,avatarUrl:player.avatarUrl}}/></div><div className="result-player-name"><strong title={player.name}>{player.name}</strong><small>{player.user_id===userId?'你 / YOU':'PLAYER'}{result.health_capacity>0&&<em className={isDead(player)?'player-dead':'player-alive'}>{isDead(player)?'死亡':'存活'}</em>}</small></div></div>
    <div className="result-course-data"><div className="game-score result-course-score"><span>SCORE</span><b>{player.score}</b></div><div className="result-song-stats"><span><small>答对曲目</small><b>{player.correct}<em>首</em></b></span>{result.endless?<span><small>存活时间</small><b>{survival(player.survivalMs??0)}</b></span>:result.health_capacity>0&&<span><small>剩余血量</small><b>{player.health}<em>HP</em></b></span>}</div></div>
   </article>)}
  </div></div>
 </div>;
}
