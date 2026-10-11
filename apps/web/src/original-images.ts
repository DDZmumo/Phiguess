import type {MatchResultView} from '../../../packages/contracts/src';
import {OriginalImageCache,sharedOriginalCache,type OriginalLease} from './original-image-cache';

export class OriginalImages{
 constructor(private scope:string,private resolve:(id:string,round:number,result:boolean)=>string,private token?:string,private cache:OriginalImageCache=sharedOriginalCache,private transport:typeof fetch=(...args)=>fetch(...args)){}
 acquire(id:string,round:number,result=false,signal?:AbortSignal|null,refresh=false):Promise<OriginalLease>{
  return this.cache.acquire(this.scope,`${id}:${round}`,async ownedSignal=>{
   const response=await this.transport(this.resolve(id,round,result),{signal:ownedSignal,cache:refresh?'reload':'default',headers:this.token?{Authorization:`Bearer ${this.token}`}:{}});
   if(!response.ok)throw new Error('Original image unavailable');return response.blob();
  },signal,refresh);
 }
 async prefetchMissed(result:Pick<MatchResultView,'id'|'rounds'>,signal:AbortSignal){
  for(const round of [...result.rounds].filter(row=>!row.correct).sort((a,b)=>a.round-b.round)){
   if(signal.aborted)return;
   try{const image=await this.acquire(result.id,round.round,true,signal);image.release();}catch{if(signal.aborted)return;}
  }
 }
 clear(){this.cache.clear(this.scope);}
 clearMatch(id:string){this.cache.clear(this.scope,`${id}:`);}
}
export const liveOriginalImages=(token:string)=>new OriginalImages(`live:${token}`,(id,round,result)=>`/api/matches/${id}/rounds/${round}/${result?'result-original':'original'}`,token);
