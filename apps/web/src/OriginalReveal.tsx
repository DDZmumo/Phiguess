import {useOriginalImages,usePlaySession} from './play-runtime';
import type {OriginalLease} from './original-image-cache';
import {useEffect,useRef,useState} from 'react';
import {gsap,useGSAP} from './visual';
import {useReducedMotion} from './hooks';

// Both live correct answers and explicit post-game reveals are authorized by their endpoint.
export function OriginalReveal({id,round,solved,children,revealDelay=0,preloadOriginal=false,onOriginalReady,originalUrl,onOriginalError,originalAlt='答对后揭晓的原版曲绘'}:{id:string;round:number;solved:boolean;children:React.ReactNode;revealDelay?:number;preloadOriginal?:boolean;onOriginalReady?:(round:number,original:{url:string;ratio:number}|null)=>void;originalUrl?:string;onOriginalError?:()=>void;originalAlt?:string}){
  const originals=useOriginalImages(),token=usePlaySession()?.token,root=useRef<HTMLDivElement>(null),reduce=useReducedMotion();
  const [original,setOriginal]=useState<{url:string;ratio:number}|null>(null),[loadError,setLoadError]=useState(false),[retry,setRetry]=useState(0);
  const enabled=preloadOriginal||solved,errorCallback=useRef(onOriginalError);errorCallback.current=onOriginalError;
  useEffect(()=>{
    if(!enabled||!token)return;
    setOriginal(null);setLoadError(false);
    const abort=new AbortController();let alive=true,lease:OriginalLease|undefined;
    void originals.acquire(id,round,Boolean(originalUrl?.endsWith('/result-original')),abort.signal,retry>0)
      .then(value=>{
        if(!alive){value.release();return;}lease=value;setOriginal({url:value.url,ratio:value.ratio});
      }).catch(()=>{if(alive&&!abort.signal.aborted){setLoadError(true);errorCallback.current?.();}});
    return()=>{alive=false;abort.abort();lease?.release();};
  },[id,round,enabled,token,originals,originalUrl,retry]);
  useEffect(()=>{if(!solved||!original)return;onOriginalReady?.(round,original);return()=>onOriginalReady?.(round,null);},[round,solved,original,onOriginalReady]);
  useGSAP(()=>{
    if(!original||!solved)return;
    gsap.fromTo(root.current,{'--original-sweep':'0%'},{'--original-sweep':'100%',delay:reduce?0:revealDelay,duration:reduce?.05:.35,ease:'power2.inOut'});
  },{scope:root,dependencies:[original,solved,reduce,revealDelay],revertOnUpdate:true});
  return <div className="art-reveal-layer" ref={root}>
    {original&&solved&&<img className="art-original" src={original.url} alt={originalAlt}/>}
    <div className="art-abstract-layer">{children}</div>
    {!original&&solved&&loadError&&<button className="art-original-retry" type="button" onClick={()=>setRetry(value=>value+1)}>原图加载未完成，点击重试</button>}
  </div>;
}
