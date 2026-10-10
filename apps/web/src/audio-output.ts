let context:AudioContext|undefined,input:GainNode|undefined,filter:BiquadFilterNode|undefined,level:GainNode|undefined,muffled=false;
export function audioOutput(){
 if(!context){
  context=new AudioContext();input=context.createGain();filter=context.createBiquadFilter();level=context.createGain();
  filter.type='lowpass';filter.Q.value=.65;filter.frequency.value=muffled?700:20000;level.gain.value=muffled?.72:1;
  input.connect(filter);filter.connect(level);level.connect(context.destination);
 }
 return {context,input:input!};
}
export function setNoiseMuffled(value:boolean){
 if(muffled===value)return;muffled=value;
 if(!context||!filter||!level)return;
 const now=context.currentTime;
 filter.frequency.cancelScheduledValues(now);filter.frequency.setTargetAtTime(value?700:20000,now,.07);
 level.gain.cancelScheduledValues(now);level.gain.setTargetAtTime(value?.72:1,now,.07);
}
const musicSources=new WeakMap<HTMLMediaElement,MediaElementAudioSourceNode>();
export function connectMusicOutput(element:HTMLMediaElement){
 const bus=audioOutput();
 if(!musicSources.has(element)){const source=bus.context.createMediaElementSource(element);source.connect(bus.input);musicSources.set(element,source);}
 if(bus.context.state==='suspended')void bus.context.resume().catch(()=>{});
}
