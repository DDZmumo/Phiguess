import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Ack, MatchView, RoomView } from '../../../packages/contracts/src';
import { api, ApiError, errorMessage } from './api';
import { useStore } from './store';
import {usePlayApi,usePlayRuntime,usePlaySession} from './play-runtime';

export function go(path:string) {window.location.hash=path;}
export function useRoute() {
  const [route,setRoute]=useState(window.location.hash.slice(1)||'/');
  useEffect(()=>{const sync=()=>setRoute(window.location.hash.slice(1)||'/');window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync);},[]);
  return route;
}
export function useReducedMotion() {
  const enabled=useStore(s=>s.preferences.motion);
  const [system,setSystem]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setSystem(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  return !enabled||system;
}
export function useResource<T>(path:string|null,refresh=0) {
  const api=usePlayApi();
  const token=useStore(s=>s.session?.token),[data,setData]=useState<T|null>(null),[error,setError]=useState('');
  useEffect(()=>{setData(null);setError('');if(!path)return;const ctrl=new AbortController();void api<T>(path,'GET',undefined,ctrl.signal).then(setData).catch(e=>{if(!ctrl.signal.aborted)setError(errorMessage(e));});return()=>ctrl.abort();},[path,token,refresh,api]);
  return {data,error};
}
export function useLive<T extends MatchView|RoomView>(kind:'match'|'room',id:string) {
  const runtime=usePlayRuntime(),token=usePlaySession()?.token;
  const [data,setData]=useState<T|null>(null),[error,setError]=useState(''),[failure,setFailure]=useState<{kind:string;id:string;token:string;status:number|null}|null>(null),[connected,setConnected]=useState(false);
  useEffect(()=>{
    if(runtime){
      const update=()=>{setData(runtime.snapshot() as T|null);setError('');setFailure(null);setConnected(true);};
      update();return runtime.subscribe(update);
    }
    if(!token)return;setData(null);setError('');setFailure(null);let alive=true;
    const socket=io({auth:{token},transports:['websocket','polling'],autoConnect:false});
    const connectTimer=setTimeout(()=>socket.connect(),0);
    const update=(value:T)=>{if(alive){setData(previous=>previous&&'serverNow' in previous&&'serverNow' in value&&previous.serverNow>value.serverNow?previous:value);setError('');setFailure(null);}};
    const refresh=()=>{void api<T>(`${kind==='match'?'matches':'rooms'}/${id}`).then(update).catch(e=>{if(alive){setError(errorMessage(e));setFailure({kind,id,token,status:e instanceof ApiError?e.status:null});}});};
    socket.on(`${kind}:state`,update);
    socket.on('connect',()=>{
      setConnected(true);
      socket.timeout(5000).emit(`${kind}:subscribe`,kind==='match'?{id}:{code:id},(err:Error|null,ack:Ack<T>)=>{if(!alive)return;if(!err&&ack?.ok)update(ack.data);else refresh();});
    });
    socket.on('disconnect',()=>{if(alive)setConnected(false);});
    socket.on('connect_error',()=>{if(alive)setConnected(false);});
    refresh();const poll=setInterval(refresh,10_000);
    const onVisible=()=>{if(document.visibilityState==='visible')refresh();};document.addEventListener('visibilitychange',onVisible);
    return()=>{alive=false;clearTimeout(connectTimer);clearInterval(poll);document.removeEventListener('visibilitychange',onVisible);socket.disconnect();};
  },[kind,id,token,runtime]);
  return {data,setData,error,errorStatus:failure?.kind===kind&&failure.id===id&&failure.token===token?failure.status:null,connected};
}
export function useServerTime(match:MatchView|null) {
  const runtime=usePlayRuntime();
  const offset=useRef(0),[now,setNow]=useState(Date.now());
  useEffect(()=>{if(match)offset.current=match.serverNow-Date.now();},[match?.serverNow]);
  useEffect(()=>{if(runtime)return;const timer=setInterval(()=>setNow(Date.now()+offset.current),100);return()=>clearInterval(timer);},[runtime]);
  return runtime?match?.serverNow??0:now;
}
