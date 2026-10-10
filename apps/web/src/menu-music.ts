import {connectMusicOutput} from './audio-output';
import type {Difficulty} from '../../../packages/contracts/src';
const MENU='ChapterSelect0.wav',GAME='game-ambience.wav';
const RESULT:Record<Difficulty,string>={ez:'EZ_LevelOver0.wav',hd:'HD_LevelOver1.wav',in:'IN_LevelOver2.wav',at:'AT_LevelOver3.wav'};
const players=new Map<string,HTMLAudioElement>(),frames=new Map<string,number>();
let menuActive=false,gameId:string|null=null,resultTrack:string|null=null,resultId:string|null=null,volume=.3;
function player(file:string){
 let audio=players.get(file);
 if(!audio){audio=new Audio(`/audio/phigros-4.0.1/${file}`);audio.loop=true;audio.preload='auto';audio.volume=0;players.set(file,audio);}
 return audio;
}
function sync(){
 for(const frame of frames.values())cancelAnimationFrame(frame);frames.clear();
 if(document.hidden){for(const audio of players.values())audio.pause();return;}
 const selected=resultTrack??(gameId?GAME:menuActive?MENU:null);
 if(selected&&volume>0)player(selected);
 for(const [file,audio]of players){
  const target=file===selected?volume:0;
  if(target>0)connectMusicOutput(audio);
  if(target>0&&audio.paused)void audio.play().catch(()=>{/* Retry on a user gesture. */});
  const from=audio.volume,start=performance.now();
  const fade=(now:number)=>{
   const progress=Math.max(0,Math.min(1,(now-start)/350));audio.volume=Math.max(0,Math.min(1,from+(target-from)*progress));
   if(file===MENU&&target>0&&Number.isFinite(audio.duration)&&audio.duration>0){
    // Ease both sides of the loop seam while keeping the scene fade intact.
    const edge=Math.min(1,audio.duration/4),distance=Math.min(audio.currentTime,audio.duration-audio.currentTime);
    const position=Math.max(0,Math.min(1,distance/edge)),gain=position*position*(3-2*position);
    audio.volume*=gain;
   }
   if(progress<1||(file===MENU&&target>0))frames.set(file,requestAnimationFrame(fade));else{frames.delete(file);if(target===0)audio.pause();}
  };
  frames.set(file,requestAnimationFrame(fade));
 }
}
export function configureMenuMusic(value:number){volume=Number.isFinite(value)?Math.max(0,Math.min(1,value)):.3;sync();}
export function setMenuMusicActive(value:boolean){if(menuActive===value)return;menuActive=value;sync();}
export function prepareGameMusic(){player(GAME);}
export function startGameMusic(id:string){if(gameId===id)return;gameId=id;player(GAME).currentTime=0;sync();}
export function stopGameMusic(id:string){if(gameId!==id)return;gameId=null;sync();}
export function prepareResultMusic(difficulty:Difficulty){player(RESULT[difficulty]);}
export function startResultMusic(difficulty:Difficulty,id:string){
 const file=RESULT[difficulty];if(resultTrack===file&&resultId===id)return;
 resultTrack=file;resultId=id;player(file).currentTime=0;sync();
}
export function stopResultMusic(id:string){if(resultId!==id)return;resultTrack=null;resultId=null;sync();}
export function installMenuMusic(){
 const gesture=()=>{const selected=resultTrack??(gameId?GAME:menuActive?MENU:null);if(selected&&volume>0){const audio=player(selected);connectMusicOutput(audio);if(audio.paused)sync();}};
 const keyboard=(event:KeyboardEvent)=>{if(!event.repeat)gesture();};
 document.addEventListener('pointerdown',gesture,true);document.addEventListener('keydown',keyboard,true);document.addEventListener('visibilitychange',sync);
 return()=>{document.removeEventListener('pointerdown',gesture,true);document.removeEventListener('keydown',keyboard,true);document.removeEventListener('visibilitychange',sync);for(const frame of frames.values())cancelAnimationFrame(frame);frames.clear();for(const audio of players.values())audio.pause();menuActive=false;gameId=null;resultTrack=null;resultId=null;};
}
