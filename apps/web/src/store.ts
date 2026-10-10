import {configureMenuMusic} from './menu-music';
import {configureSound} from './sound';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { normalizeChallengeSettings, INFINITY_ROUNDS } from '../../../packages/contracts/src';

export interface Session { token: string; expiresAt: string; user: {id:string;name:string;avatarUrl?:string|null;accountType?:'guest'|'account'} }
export interface Preferences { motion:boolean; musicVolume?:number; sound:boolean; volume:number; brightness:number; difficulty:'ez'|'hd'|'in'|'at'; rounds:number; roundSeconds:number; healthEnabled?:boolean;healthCapacity?:0|20|50 }
interface State {
  session:Session|null; preferences:Preferences; matchId:string|null; roomCode:string|null;
  setSession:(session:Session|null)=>void;
  updatePreferences:(value:Partial<Preferences>)=>void;
  setMatch:(id:string|null)=>void;setRoom:(code:string|null)=>void;
}
export const useStore=create<State>()(persist((set)=>({
  session:null,matchId:null,roomCode:null,
  preferences:{motion:true,musicVolume:.3,sound:false,volume:0.3,brightness:0.9,difficulty:'ez',rounds:5,roundSeconds:30,healthEnabled:true,healthCapacity:20},
  setSession:session=>set(previous=>({session,...(!session||session.user.id!==previous.session?.user.id?{matchId:null,roomCode:null}:{})})),
  updatePreferences:value=>set(s=>{const next={...s.preferences,...value};if(next.difficulty==='in'&&next.rounds===INFINITY_ROUNDS){if(value.healthCapacity===0||value.healthEnabled===false)next.rounds=5;else{next.healthCapacity=next.healthCapacity===50?50:20;next.healthEnabled=true;}}return{preferences:{...next,...normalizeChallengeSettings(next.difficulty,next.rounds,next.roundSeconds)}};}),
  setMatch:matchId=>set({matchId}),setRoom:roomCode=>set({roomCode}),
}),{name:'phiguess-v1',merge:(persisted,current)=>{
  const saved=persisted as Partial<State>|undefined,preferences={...current.preferences,...saved?.preferences};
  if(preferences.difficulty==='in'&&preferences.rounds===INFINITY_ROUNDS){preferences.healthCapacity=preferences.healthCapacity===50?50:20;preferences.healthEnabled=true;}
  return {...current,...saved,preferences:{...preferences,...normalizeChallengeSettings(preferences.difficulty,preferences.rounds,preferences.roundSeconds)}};
}}));

configureSound(useStore.getState().preferences);
configureMenuMusic(useStore.getState().preferences.musicVolume??.3);
useStore.subscribe((state,previous)=>{
 if(state.preferences.musicVolume!==previous.preferences.musicVolume)configureMenuMusic(state.preferences.musicVolume??.3);
 if(state.preferences.sound!==previous.preferences.sound||state.preferences.volume!==previous.preferences.volume)configureSound(state.preferences);
});
