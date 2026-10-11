export const ORIGINAL_CACHE_LIMIT=32*1024*1024;
export interface DecodedOriginal{url:string;width:number;height:number;dispose:()=>void}
export interface OriginalLease{url:string;ratio:number;release:()=>void}
interface Transfer{controller:AbortController;users:number;promise:Promise<Entry>;entry?:Entry}
interface Entry{key:string;scope:string;asset:DecodedOriginal;bytes:number;leases:number;cached:boolean;disposed:boolean;transfer:Transfer}
export type OriginalDecoder=(blob:Blob)=>Promise<DecodedOriginal>;

export const decodeOriginal:OriginalDecoder=async blob=>{
 const url=URL.createObjectURL(blob),image=new Image();image.src=url;
 try{await image.decode();return {url,width:image.naturalWidth,height:image.naturalHeight,dispose:()=>{image.src='';URL.revokeObjectURL(url);}};}
 catch(error){URL.revokeObjectURL(url);throw error;}
};

/** FIFO budget includes the compressed body and an RGBA estimate of its decoded pixels. */
export class OriginalImageCache{
 private ready=new Map<string,Entry>();private pending=new Map<string,Transfer>();private bytes=0;
 constructor(readonly limit=ORIGINAL_CACHE_LIMIT,private decode:OriginalDecoder=decodeOriginal){}
 get cachedBytes(){return this.bytes;}
 get cachedKeys(){return [...this.ready.keys()];}
 private idle(entry:Entry){if(!entry.cached&&!entry.leases&&!entry.transfer.users&&!entry.disposed){entry.disposed=true;entry.asset.dispose();}}
 private evict(entry:Entry){if(!entry.cached)return;this.ready.delete(entry.key);this.bytes-=entry.bytes;entry.cached=false;this.idle(entry);}
 async acquire(scope:string,key:string,load:(signal:AbortSignal)=>Promise<Blob>,signal?:AbortSignal|null,refresh=false):Promise<OriginalLease>{
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const fullKey=JSON.stringify([scope,key]);
  if(refresh){const old=this.ready.get(fullKey);if(old)this.evict(old);this.pending.get(fullKey)?.controller.abort();this.pending.delete(fullKey);}
  const cached=this.ready.get(fullKey);
  if(cached)return this.lease(cached);
  let transfer=this.pending.get(fullKey);
  if(!transfer){
   const controller=new AbortController(),current={} as Transfer;
   current.controller=controller;current.users=0;
   const timer=setTimeout(()=>controller.abort(),60000);
   current.promise=(async()=>{
    const blob=await load(controller.signal),asset=await this.decode(blob);
    if(controller.signal.aborted){asset.dispose();throw new DOMException('Aborted','AbortError');}
    const entry:Entry={key:fullKey,scope,asset,bytes:blob.size+asset.width*asset.height*4,leases:0,cached:false,disposed:false,transfer:current};current.entry=entry;
    if(entry.bytes<=this.limit){
     while(this.bytes+entry.bytes>this.limit&&this.ready.size)this.evict(this.ready.values().next().value!);
     entry.cached=true;this.ready.set(fullKey,entry);this.bytes+=entry.bytes;
    }
    return entry;
   })().finally(()=>{clearTimeout(timer);if(this.pending.get(fullKey)===current)this.pending.delete(fullKey);if(current.entry)this.idle(current.entry);});
   transfer=current;this.pending.set(fullKey,current);
  }
  transfer.users++;
  try{
   const entry=await new Promise<Entry>((resolve,reject)=>{
    const abort=()=>reject(new DOMException('Aborted','AbortError'));signal?.addEventListener('abort',abort,{once:true});
    transfer!.promise.then(value=>{signal?.removeEventListener('abort',abort);if(signal?.aborted)abort();else resolve(value);},error=>{signal?.removeEventListener('abort',abort);reject(error);});
   });
   return this.lease(entry);
  }finally{transfer.users--;if(transfer.entry)this.idle(transfer.entry);}
 }
 private lease(entry:Entry):OriginalLease{
  entry.leases++;let released=false;
  return {url:entry.asset.url,ratio:entry.asset.width/entry.asset.height,release:()=>{if(released)return;released=true;entry.leases--;this.idle(entry);}};
 }
 clear(scope?:string,prefix?:string){
  const matches=(key:string)=>{const [owner,id]=JSON.parse(key) as [string,string];return (scope===undefined||owner===scope)&&(prefix===undefined||id.startsWith(prefix));};
  for(const [key,transfer] of this.pending)if(matches(key)){transfer.controller.abort();this.pending.delete(key);}
  for(const entry of [...this.ready.values()])if(matches(entry.key))this.evict(entry);
 }
}

export const sharedOriginalCache=new OriginalImageCache();
