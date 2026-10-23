import {Worker} from 'node:worker_threads';
import {resolve} from 'node:path';
export const ARTWORK_GENERATOR_VERSION='ez-regions-v1';
export type GeneratedDifficulty='hd'|'in'|'at';
export interface ArtworkJob{id:string;path:string;seed:number;version:string;difficulty:GeneratedDifficulty}
interface Queued{job:ArtworkJob;priority:number;resolve:(images:Record<string,Buffer>)=>void;reject:(error:Error)=>void}

/** One CPU worker; generation never runs in the game mutation queue or HTTP event loop. */
export class ArtworkWorker{
 private worker?:Worker;private queue:Queued[]=[];private current?:Queued;private timer?:NodeJS.Timeout;private closed=false;
 run(job:ArtworkJob,priority=0):Promise<Record<string,Buffer>>{
  if(this.closed)return Promise.reject(new Error('Artwork worker closed'));
  if(this.queue.length>=64)return Promise.reject(new Error('Artwork generation queue is full'));
  return new Promise((resolve,reject)=>{this.queue.push({job,priority,resolve,reject});this.pump();});
 }
 promote(id:string){for(const item of this.queue)if(item.job.id===id)item.priority=0;}
 private pump(){
  if(this.current||this.closed||!this.queue.length)return;
  if(!this.worker){
   const worker=this.worker=new Worker(resolve('packages/game-core/artwork/worker.mjs'),{resourceLimits:{maxOldGenerationSizeMb:256}});
   worker.on('message',(message:{id:string;images?:Record<string,Uint8Array>;error?:string})=>{
    if(this.worker!==worker||this.current?.job.id!==message.id)return;
    const item=this.current;this.current=undefined;clearTimeout(this.timer);
    if(message.error)item.reject(new Error(message.error));else item.resolve(Object.fromEntries(Object.entries(message.images??{}).map(([name,bytes])=>[name,Buffer.from(bytes)])));
    this.pump();
   });
   const failed=(error:Error)=>{if(this.worker!==worker)return;this.worker=undefined;clearTimeout(this.timer);this.current?.reject(error);this.current=undefined;void worker.terminate();this.pump();};
   worker.on('error',failed);worker.on('exit',code=>failed(new Error(`Artwork worker exited (${code})`)));
  }
  this.queue.sort((a,b)=>a.priority-b.priority);this.current=this.queue.shift()!;
  const worker=this.worker;this.timer=setTimeout(()=>{if(this.worker!==worker)return;this.worker=undefined;this.current?.reject(new Error('Artwork generation timed out'));this.current=undefined;void worker.terminate();this.pump();},15000);
  worker.postMessage(this.current.job);
 }
 async close(){this.closed=true;clearTimeout(this.timer);for(const item of this.queue)item.reject(new Error('Artwork worker closed'));this.queue=[];this.current?.reject(new Error('Artwork worker closed'));this.current=undefined;const worker=this.worker;this.worker=undefined;if(worker)await worker.terminate();}
}
