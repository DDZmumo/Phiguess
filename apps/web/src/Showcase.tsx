import { createContext,useContext,useEffect,useState,type ReactNode } from 'react';
import { api } from './api';
const CoverContext=createContext<{id:string;url:string}|null>(null);
export const useCover=()=>useContext(CoverContext);
export function ShowcaseProvider({children}:{children:ReactNode}){
  const [cover,setCover]=useState<{id:string;url:string}|null>(null);
  useEffect(()=>{
    let alive=true;
    const ctrl=new AbortController();
    void api<{id:string;url:string}[]>('showcase','GET',undefined,ctrl.signal).then(async entries=>{
      if(!alive||!entries.length)return;
      let previous:string|null=null;try{previous=localStorage.getItem('phiguess-last-cover');}catch{}
      const options=entries.filter(e=>e.id!==previous),pool=options.length?options:entries,entry=pool[Math.floor(Math.random()*pool.length)]!;
      const image=new Image();image.src=entry.url;await image.decode();if(!alive)return;
      setCover(entry);try{localStorage.setItem('phiguess-last-cover',entry.id);}catch{}
    }).catch(()=>{});
    return()=>{alive=false;ctrl.abort();};
  },[]);
  return <CoverContext.Provider value={cover}>{children}</CoverContext.Provider>;
}
export function Showcase(){
  const cover=useCover();
  return <div className="title-art" aria-label="原图库背景">{cover&&<img className="showcase-current" src={cover.url} alt=""/>}</div>;
}
