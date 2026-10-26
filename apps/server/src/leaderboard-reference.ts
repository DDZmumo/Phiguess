import {SONG_MAX_SCORE} from '../../../packages/game-core/src';

export interface LeaderboardEntry{
 id:string;name:string;avatarUrl:string|null;rank:string;score:number;correct:number;totalRounds:number;isGuest:boolean;isReference?:boolean;isLegacy?:boolean;
}
export function withReferencePlayer(entries:LeaderboardEntry[],difficulty:'in'|'at'){
 const reference:LeaderboardEntry={id:'reference-hate-geopelia',name:'HATE_GEOPELIA',avatarUrl:'/characters/hate-geopelia.png',rank:'0',score:325*SONG_MAX_SCORE[difficulty],correct:325,totalRounds:325,isGuest:false,isReference:true};
 const byScore=(a:LeaderboardEntry,b:LeaderboardEntry)=>b.score-a.score||a.id.localeCompare(b.id);
 const sorted=[...entries.filter(entry=>!entry.isLegacy),reference].sort(byScore);
 const legacy=entries.filter(entry=>entry.isLegacy).sort(byScore).map(entry=>({...entry,rank:'--'}));
 let rank=0,previous:number|undefined;
 return [...sorted.map(entry=>{if(entry.score!==previous){rank++;previous=entry.score;}return {...entry,rank:String(rank)};}),...legacy].slice(0,100);
}
