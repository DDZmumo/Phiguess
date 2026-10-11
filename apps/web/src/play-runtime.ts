import {createContext,useContext,useSyncExternalStore} from 'react';
import {api} from './api';
import {useStore} from './store';
import type {PlayRuntime} from './runtime-types';

export const PlayRuntimeContext=createContext<PlayRuntime|null>(null);
export const usePlayRuntime=()=>useContext(PlayRuntimeContext);
const browserFetch:typeof fetch=(...args)=>fetch(...args);
const navigate=(path:string)=>{window.location.hash=path;};
const emptySubscribe=()=>()=>{};
export function usePlayApi(){return usePlayRuntime()?.request??api;}
export function usePlayMedia(){return usePlayRuntime()?.media??browserFetch;}
export function usePlayNavigation(){return usePlayRuntime()?.navigate??navigate;}
export function usePlaySession(){const runtime=usePlayRuntime(),session=useStore(s=>s.session);return runtime?.session??session;}
export function usePlayPreferences(){
 const runtime=usePlayRuntime(),saved=useStore(s=>s.preferences),update=useStore(s=>s.updatePreferences);
 const preferences=useSyncExternalStore(runtime?.subscribe??emptySubscribe,()=>runtime?.preferences??saved);
 return {preferences,updatePreferences:runtime?.updatePreferences??update};
}
