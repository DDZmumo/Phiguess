import { gcm } from '@noble/ciphers/aes.js';

export async function decryptPreloadedArtwork(bytes:Uint8Array,key:string,mime:string):Promise<Blob> {
  if(bytes.length<28||!['image/svg+xml','image/webp'].includes(mime))throw new Error('Invalid preloaded artwork');
  const secret=Uint8Array.from(atob(key),char=>char.charCodeAt(0));
  const compressed=gcm(secret,bytes.subarray(0,12)).decrypt(bytes.subarray(12));
  // Use an owned buffer, including on TypeScript versions with typed ArrayBuffers.
  const stream=new Blob([new Uint8Array(compressed).buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Blob([await new Response(stream).arrayBuffer()],{type:mime});
}

export class ArtworkPreloader {
  private pending?: {round:number;controller:AbortController;promise:Promise<{bytes:Uint8Array;mime:string}>};
  constructor(private readonly fetcher:typeof fetch=(input,init)=>globalThis.fetch(input,init)) {}
  preload(id:string,round:number,token:string) {
    if(this.pending?.round===round)return;
    this.cancel();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    const promise=Promise.resolve().then(()=>this.fetcher(`/api/matches/${id}/rounds/${round}/preload`,{
      headers:{Authorization:`Bearer ${token}`},signal:controller.signal,priority:'low',
    })).then(async response=>{
      if(!response.ok)throw new Error('Preload unavailable');
      return {bytes:new Uint8Array(await response.arrayBuffer()),mime:response.headers.get('X-Artwork-Mime')??''};
    }).finally(()=>clearTimeout(timer));
    void promise.catch(()=>{});
    this.pending={round,controller,promise};
  }
  async take(round:number,key:string|undefined,signal:AbortSignal):Promise<Blob|undefined> {
    const pending=this.pending;
    if(!pending||pending.round!==round||!key)return;
    const abort=()=>pending.controller.abort();
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    try{const value=await pending.promise;if(signal.aborted)return;return await decryptPreloadedArtwork(value.bytes,key,value.mime);}
    catch{return undefined;}
    finally{signal.removeEventListener('abort',abort);if(this.pending===pending)this.pending=undefined;}
  }
  cancel(){this.pending?.controller.abort();this.pending=undefined;}
}
