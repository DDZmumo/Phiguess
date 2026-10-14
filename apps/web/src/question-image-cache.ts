export const QUESTION_CACHE_LIMIT=16*1024*1024;
interface Transfer{controller:AbortController;promise:Promise<Blob>}

/** Retain encoded question bodies, including decrypted next-round preloads, across screens. */
export class QuestionImageCache{
 private ready=new Map<string,Blob>();private pending=new Map<string,Transfer>();private bytes=0;
 constructor(readonly limit=QUESTION_CACHE_LIMIT){}
 get cachedBytes(){return this.bytes;}
 key(scope:string,id:string,round:number,difficulty:string){return JSON.stringify([scope,id,round,difficulty]);}
 get(key:string){return this.ready.get(key);}
 remember(key:string,blob:Blob){
  const old=this.ready.get(key);if(old){this.bytes-=old.size;this.ready.delete(key);}
  if(blob.size>this.limit)return;
  while(this.bytes+blob.size>this.limit&&this.ready.size){const first=this.ready.keys().next().value!;this.bytes-=this.ready.get(first)!.size;this.ready.delete(first);}
  this.ready.set(key,blob);this.bytes+=blob.size;
 }
 async load(key:string,load:(signal:AbortSignal)=>Promise<Blob>,signal?:AbortSignal,refresh=false){
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  if(refresh){const old=this.ready.get(key);if(old){this.bytes-=old.size;this.ready.delete(key);}this.pending.get(key)?.controller.abort();this.pending.delete(key);}
  const cached=this.ready.get(key);if(cached)return cached;
  let transfer=this.pending.get(key);
  if(!transfer){
   const controller=new AbortController(),entry={} as Transfer,timer=setTimeout(()=>controller.abort(),60000);entry.controller=controller;
   entry.promise=Promise.resolve().then(()=>load(controller.signal)).then(blob=>{if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');this.remember(key,blob);return blob;}).finally(()=>{clearTimeout(timer);if(this.pending.get(key)===entry)this.pending.delete(key);});
   transfer=entry;this.pending.set(key,entry);
  }
  return new Promise<Blob>((resolve,reject)=>{
   const abort=()=>reject(new DOMException('Aborted','AbortError'));signal?.addEventListener('abort',abort,{once:true});
   transfer!.promise.then(blob=>{signal?.removeEventListener('abort',abort);if(signal?.aborted)abort();else resolve(blob);},error=>{signal?.removeEventListener('abort',abort);reject(error);});
  });
 }
 clear(scope?:string,id?:string){
  const matches=(key:string)=>{const [owner,match]=JSON.parse(key) as string[];return (scope===undefined||owner===scope)&&(id===undefined||match===id);};
  for(const [key,blob] of this.ready)if(matches(key)){this.ready.delete(key);this.bytes-=blob.size;}
  for(const [key,entry] of this.pending)if(matches(key)){entry.controller.abort();this.pending.delete(key);}
 }
}
export const sharedQuestionCache=new QuestionImageCache();
