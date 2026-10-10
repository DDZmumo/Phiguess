import {audioOutput} from './audio-output';
export const SOUND_FILES={
 'answer.correct':'answer-correct.wav','answer.wrong':'challenge-start.wav',
 'ui.confirm':'Tap1.wav','ui.back':'Tap2.wav','ui.select':'Tap3.wav',
 'round.skip':'panel-close.wav','round.next':'Tap5.wav','ui.toggle':'Tap4.wav','ui.notice':'Tap5.wav','ui.complete':'Tap6.wav','ui.start':'Tap7.wav',
 'ds.select':'ds-select-air.wav','ds.transition':'ds-transition-clean.wav',
 'panel.open':'panel-open.wav','panel.close':'panel-close.wav','challenge.start':'challenge-start.wav',
} as const;
export type SoundEvent=keyof typeof SOUND_FILES;
let enabled=false,volume=.3,context:AudioContext|undefined,master:GainNode|undefined,epoch=0;
const buffers=new Map<string,Promise<AudioBuffer>>(),lastPlayed=new Map<SoundEvent,number>();
const voices=new Set<{source:AudioBufferSourceNode;gain:GainNode;group:string}>();
const groupTickets=new Map<string,number>();
function audio(){
 if(!context){const bus=audioOutput();context=bus.context;master=context.createGain();master.gain.value=enabled?volume:0;master.connect(bus.input);}
 return context;
}
function load(file:string){
 let pending=buffers.get(file);
 if(!pending){pending=fetch(`/audio/phigros-4.0.1/${file}`).then(r=>{if(!r.ok)throw new Error('Audio unavailable');return r.arrayBuffer();}).then(bytes=>audio().decodeAudioData(bytes)).catch(error=>{buffers.delete(file);throw error;});buffers.set(file,pending);}
 return pending;
}
function stopVoice(voice:typeof voices extends Set<infer V>?V:never){
 if(!context)return;
 const now=context.currentTime;voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setTargetAtTime(0,now,.008);
 try{voice.source.stop(now+.035);}catch{/* Already ended. */}voices.delete(voice);
}
export function stopSounds(){epoch++;for(const voice of voices)stopVoice(voice);}
export function stopDifficultySound(){
 groupTickets.set('ds',(groupTickets.get('ds')??0)+1);
 for(const voice of voices)if(voice.group==='ds')stopVoice(voice);
}
export function configureSound(settings:{sound:boolean;volume:number}){
 enabled=settings.sound;volume=Math.max(0,Math.min(1,settings.volume));
 if(context&&master){master.gain.cancelScheduledValues(context.currentTime);master.gain.setTargetAtTime(enabled?volume:0,context.currentTime,.012);}
 if(!enabled||volume===0)stopSounds();
}
export function prepareSound(){
 if(!enabled||volume===0||document.hidden)return;
 try{const ctx=audio();if(ctx.state==='suspended')void ctx.resume().catch(()=>{});for(const file of Object.values(SOUND_FILES))void load(file).catch(()=>{});}catch{/* Sound must never block navigation. */}
}
export function playSound(event:SoundEvent,preview=false){
 if(!enabled||volume===0||document.hidden)return;
 const issued=performance.now();if(issued-(lastPlayed.get(event)??-Infinity)<80)return;
 lastPlayed.set(event,issued);
 const generation=epoch,group=event.startsWith('answer.')?'answer':event.startsWith('ds.')?'ds':event.startsWith('panel.')?'panel':event==='challenge.start'?'transition':'ui';
 const ticket=(groupTickets.get(group)??0)+1;groupTickets.set(group,ticket);
 try{
  const ctx=audio(),resumed=ctx.state==='suspended'?ctx.resume():Promise.resolve();
  void Promise.all([load(SOUND_FILES[event]),resumed]).then(([buffer])=>{
   // Discard stale clicks instead of replaying a queue after loading or unmuting.
   if(generation!==epoch||!enabled||volume===0||document.hidden||ctx.state!=='running'||performance.now()-issued>(preview?1000:220)||((preview||group!=='ui')&&groupTickets.get(group)!==ticket))return;
   const current=[...voices].filter(v=>v.group===group),limit=group==='ui'?2:1;
   for(const voice of current.slice(0,Math.max(0,current.length-limit+1)))stopVoice(voice);
   const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;source.playbackRate.value=1;gain.gain.value=event==='answer.correct'?8:1;source.connect(gain);gain.connect(master!);
   const voice={source,gain,group};voices.add(voice);source.onended=()=>{voices.delete(voice);source.disconnect();gain.disconnect();};source.start(0,group==='ds'?Math.min(buffer.duration,Math.max(0,(performance.now()-issued)/1000)):0);
  }).catch(()=>{});
 }catch{/* Muted or unavailable audio never prevents the action. */}
}
export function installSoundLifecycle(){
 const key=(event:KeyboardEvent)=>{if(!event.repeat&&(event.key==='Enter'||event.key===' '))prepareSound();};
 const visibility=()=>{if(document.hidden){stopSounds();if(context)void context.suspend().catch(()=>{});}};
 document.addEventListener('pointerdown',prepareSound,true);document.addEventListener('keydown',key,true);document.addEventListener('visibilitychange',visibility);
 return()=>{document.removeEventListener('pointerdown',prepareSound,true);document.removeEventListener('keydown',key,true);document.removeEventListener('visibilitychange',visibility);stopSounds();};
}
