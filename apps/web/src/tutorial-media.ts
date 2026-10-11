interface ImageTransfer{controller:AbortController;body:Promise<Blob>}

/** One tutorial owns immutable image bodies across game and result views. */
export class TutorialMedia {
 private images=new Map<string,ImageTransfer>();
 constructor(private transport:typeof fetch=(...args)=>fetch(...args),private timeout=60000){}
 async load(path:string,signal?:AbortSignal|null,refresh=false):Promise<Response>{
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  if(refresh){this.images.get(path)?.controller.abort();this.images.delete(path);}
  let transfer=this.images.get(path);
  if(!transfer){
   const controller=new AbortController(),entry={} as ImageTransfer;
   const timer=setTimeout(()=>controller.abort(),this.timeout);
   entry.controller=controller;
   entry.body=(async()=>{
    const response=await this.transport(path,{signal:controller.signal,cache:refresh?'reload':'default'});
    if(!response.ok)throw new Error('Tutorial image unavailable');
    return response.blob();
   })().catch(error=>{if(this.images.get(path)===entry)this.images.delete(path);throw error;}).finally(()=>clearTimeout(timer));
   transfer=entry;this.images.set(path,entry);
  }
  const body=await new Promise<Blob>((resolve,reject)=>{
   const abort=()=>reject(new DOMException('Aborted','AbortError'));
   signal?.addEventListener('abort',abort,{once:true});
   transfer!.body.then(blob=>{signal?.removeEventListener('abort',abort);if(signal?.aborted)abort();else resolve(blob);},error=>{signal?.removeEventListener('abort',abort);reject(error);});
  });
  return new Response(body,{headers:{'Content-Type':body.type||'application/octet-stream'}});
 }
 dispose(){for(const image of this.images.values())image.controller.abort();this.images.clear();}
}
