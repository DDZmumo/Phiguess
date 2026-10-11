import {usePlayMedia,usePlaySession} from './play-runtime';
import {useEffect,useRef,useState} from 'react';
import {gsap,useGSAP} from './visual';
import {useReducedMotion} from './hooks';

// Both live correct answers and explicit post-game reveals are authorized by their endpoint.
export function OriginalReveal({id,round,solved,children,revealDelay=0,onOriginalReady,originalUrl,onOriginalError,originalAlt='答对后揭晓的原版曲绘'}:{id:string;round:number;solved:boolean;children:React.ReactNode;revealDelay?:number;onOriginalReady?:(round:number,original:{url:string;ratio:number}|null)=>void;originalUrl?:string;onOriginalError?:()=>void;originalAlt?:string}){
  const fetch=usePlayMedia(),token=usePlaySession()?.token,root=useRef<HTMLDivElement>(null),reduce=useReducedMotion();
  const [original,setOriginal]=useState<string|null>(null);
  useEffect(()=>{
    if(!solved||!token)return;
    const abort=new AbortController();let alive=true,url:string|undefined;
    void fetch(originalUrl??`/api/matches/${id}/rounds/${round}/original`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:abort.signal})
      .then(async response=>{
        if(!response.ok)throw new Error('Original unavailable');
        const blob=await response.blob();if(!alive)return;
        url=URL.createObjectURL(blob);const image=new Image();image.src=url;await image.decode();
        if(alive){setOriginal(url);onOriginalReady?.(round,{url,ratio:image.naturalWidth/image.naturalHeight});}
      }).catch(()=>{if(alive&&!abort.signal.aborted)onOriginalError?.();});
    return()=>{alive=false;abort.abort();onOriginalReady?.(round,null);if(url)URL.revokeObjectURL(url);};
  },[id,round,solved,token,onOriginalReady,originalUrl,onOriginalError]);
  useGSAP(()=>{
    if(!original)return;
    gsap.fromTo(root.current,{'--original-sweep':'0%'},{'--original-sweep':'100%',delay:reduce?0:revealDelay,duration:reduce?.05:.35,ease:'power2.inOut'});
  },{scope:root,dependencies:[original,reduce,revealDelay],revertOnUpdate:true});
  return <div className="art-reveal-layer" ref={root}>
    {original&&<img className="art-original" src={original} alt={originalAlt}/>}
    <div className="art-abstract-layer">{children}</div>
  </div>;
}
