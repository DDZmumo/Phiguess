export type ImagePriority=0|1|2; // visible, nearby, background original
interface Job{key:string;priority:ImagePriority;run:()=>Promise<unknown>;resolve:(value:unknown)=>void;reject:(reason:unknown)=>void;signal:AbortSignal;abort:()=>void}

/** Keep one of two transfer slots available when only background work is running. */
export class ImageDownloadQueue{
 private jobs:Job[]=[];private running=0;private scheduled=false;
 promote(key:string,priority:ImagePriority){for(const job of this.jobs)if(job.key===key)job.priority=Math.min(job.priority,priority) as ImagePriority;this.schedule();}
 run<T>(key:string,priority:ImagePriority,signal:AbortSignal,run:()=>Promise<T>):Promise<T>{
  if(signal.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
  return new Promise<T>((resolve,reject)=>{
   const job:Job={key,priority,signal,run,resolve:value=>resolve(value as T),reject,abort:()=>{this.jobs=this.jobs.filter(item=>item!==job);reject(new DOMException('Aborted','AbortError'));this.schedule();}};
   signal.addEventListener('abort',job.abort,{once:true});this.jobs.push(job);this.schedule();
  });
 }
 private schedule(){if(this.scheduled)return;this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;this.drain();});}
 private drain(){
  this.jobs.sort((a,b)=>a.priority-b.priority);
  while(this.running<2&&this.jobs.length){
   if(this.jobs[0]!.priority===2&&this.running>0)return;
   const job=this.jobs.shift()!;job.signal.removeEventListener('abort',job.abort);
   if(job.signal.aborted){job.reject(new DOMException('Aborted','AbortError'));continue;}
   this.running++;void Promise.resolve().then(job.run).then(job.resolve,job.reject).finally(()=>{this.running--;this.schedule();});
  }
 }
}
export const imageDownloads=new ImageDownloadQueue();
