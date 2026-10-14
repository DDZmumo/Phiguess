import type {MatchResultView} from '../../../packages/contracts/src';
import {OriginalImageCache,sharedOriginalCache,type OriginalLease} from './original-image-cache';
import {imageDownloads,type ImagePriority} from './image-download-queue';
import {sharedQuestionCache} from './question-image-cache';

export class OriginalImages{
 constructor(private scope:string,private resolve:(id:string,round:number,result:boolean)=>string,private token?:string,private cache:OriginalImageCache=sharedOriginalCache,private transport:typeof fetch=(...args)=>fetch(...args)){}
 private originalKey(id:string,round:number){return JSON.stringify([this.scope,id,round,'original']);}
 prioritize(id:string,round:number,difficulty?:string){imageDownloads.promote(difficulty?sharedQuestionCache.key(this.scope,id,round,difficulty):this.originalKey(id,round),0);}
 rememberQuestion(id:string,round:number,difficulty:string,blob:Blob){sharedQuestionCache.remember(sharedQuestionCache.key(this.scope,id,round,difficulty),blob);}
 question(id:string,round:number,difficulty:string,url:string,transport:typeof fetch,signal:AbortSignal,refresh=false,priority:ImagePriority=0){
  const key=sharedQuestionCache.key(this.scope,id,round,difficulty);imageDownloads.promote(key,priority);
  return sharedQuestionCache.load(key,ownedSignal=>imageDownloads.run(key,priority,ownedSignal,async()=>{
   const response=await transport(url,{signal:ownedSignal,cache:refresh?'reload':'default',headers:this.token?{Authorization:`Bearer ${this.token}`}:{}});
   if(!response.ok)throw new Error('Question image unavailable');return response.blob();
  }),signal,refresh);
 }
 acquire(id:string,round:number,result=false,signal?:AbortSignal|null,refresh=false,priority:ImagePriority=0):Promise<OriginalLease>{
  const key=this.originalKey(id,round);imageDownloads.promote(key,priority);
  return this.cache.acquire(this.scope,`${id}:${round}`,ownedSignal=>imageDownloads.run(key,priority,ownedSignal,async()=>{
   const response=await this.transport(this.resolve(id,round,result),{signal:ownedSignal,cache:refresh?'reload':'default',headers:this.token?{Authorization:`Bearer ${this.token}`}:{}});
   if(!response.ok)throw new Error('Original image unavailable');return response.blob();
  }),signal,refresh);
 }
 async prefetchMissed(result:Pick<MatchResultView,'id'|'rounds'>,signal:AbortSignal){
  for(const round of [...result.rounds].filter(row=>!row.correct).sort((a,b)=>a.round-b.round)){
   if(signal.aborted)return;
   try{const image=await this.acquire(result.id,round.round,true,signal,false,2);image.release();}catch{if(signal.aborted)return;}
  }
 }
 clear(){this.cache.clear(this.scope);sharedQuestionCache.clear(this.scope);}
 clearMatch(id:string){this.cache.clear(this.scope,`${id}:`);sharedQuestionCache.clear(this.scope,id);}
}
export const liveOriginalImages=(token:string)=>new OriginalImages(`live:${token}`,(id,round,result)=>`/api/matches/${id}/rounds/${round}/${result?'result-original':'original'}`,token);
