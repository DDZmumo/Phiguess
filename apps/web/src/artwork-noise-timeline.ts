import type {NoiseRegion} from './noise-domain-renderer';
import {noiseViewport} from './noise-viewport';

const clamp=(v:number)=>Math.max(0,Math.min(1,v));
export function skipNoisePhase(age:number):{phase:1|2;strength:number}{
 return age>=.8?{phase:2,strength:1}:{phase:1,strength:.18+.30*Math.pow(.5+.5*Math.cos(Math.max(0,age)*Math.PI*18),3)};
}
/** Last 25 seconds: four slow sweeps, each followed by 0.8s of pink flashing. */
export function artworkNoiseRegions(elapsed:number,duration:number,width:number,height:number,skew:number,inset=0,topInset=inset,bottomInset=inset,skipAge?:number):NoiseRegion[]{
 if(elapsed<0||duration<0)return[];
 const view=noiseViewport(width,height),top=view.top+topInset,bottom=view.top+view.height-bottomInset;
 const left=view.left+view.height*skew/2+inset,right=view.left+view.width-view.height*skew/2-inset;
 if(skipAge!==undefined)return[{rect:[left,top,right,bottom],...skipNoisePhase(skipAge)}];
 // A skipped round can last less than the flashing interval (even zero).
 // Settled coverage must not depend on the duration of its growth animation.
 if(elapsed>=duration)return[{rect:[left,top,right,bottom],phase:2,strength:1}];
 if(elapsed===0)return[];
 const w=right-left,h=bottom-top,side=w*.17,band=h*.24;
 const start=Math.max(0,duration-25),stageSeconds=Math.min(duration,25)/4;
 const flashSeconds=.8,moveSeconds=stageSeconds-flashSeconds;
 const result:NoiseRegion[]=[];
 function add(stage:number,rect:(growth:number)=>Array<[number,number,number,number]>){
  const age=elapsed-start-stage*stageSeconds;if(age<=0)return;
  const growth=clamp(age/moveSeconds),phase=age>=stageSeconds?2:1;
  const flashAge=age-moveSeconds;
  const strength=phase===2?1:flashAge<0?.34:.18+.30*Math.pow(.5+.5*Math.cos(flashAge*Math.PI*18),3);
  for(const r of rect(growth))if(r[2]-r[0]>.001&&r[3]-r[1]>.001)result.push({rect:r,phase,strength});
 }
 add(0,g=>[[left,top,left+side,top+h*g]]);
 add(1,g=>[[right-side,bottom-h*g,right,bottom]]);
 add(2,g=>[[right-side-(w-2*side)*g,top,right-side,top+band],[left+side,bottom-band,left+side+(w-2*side)*g,bottom]]);
 add(3,g=>{
  const l=left+side,r=right-side,t=top+band,b=bottom-band,dx=(r-l)*g/2,dy=(b-t)*g/2;
  return [[l,t,l+dx,b],[r-dx,t,r,b],[l+dx,t,r-dx,t+dy],[l+dx,b-dy,r-dx,b]];
 });
 return result;
}
