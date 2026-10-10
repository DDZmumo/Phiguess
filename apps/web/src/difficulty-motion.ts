import type { Difficulty } from '../../../packages/contracts/src';
import reference from './difficulty-reference.json';

export const DIFFICULTIES = [
  {id:'ez',name:'区区',x:-153},
  {id:'hd',name:'人类',x:-51},
  {id:'in',name:'龙比',x:51},
  {id:'at',name:'外挂',x:153},
] as const;

// All four 30fps source videos have these exact inversion intervals.
const INVERT_FRAMES=[[74,76],[79,80],[86,94],[417,419],[422,423],[429,434],[436,454]];
export const DIFFICULTY_END=456/30;
export const DIFFICULTY_RENDER_FPS=120;
export const DIFFICULTY_REEL_PITCH=400;
export const DIFFICULTY_ROLL_START=167/30;
export const DIFFICULTY_SCROLL_START=reference.dynamics.start;
// Positions measured at each source frame. High-speed, indistinct tail anchors are
// retained only after the last reliably tracked frame (280).
const SCROLL_RIGHT=[...reference.travel.map(([frame,,y])=>[frame/30,y/DIFFICULTY_REEL_PITCH]),[9.5,16],[10,40],[10.5,72],[11,136],[12,310],[13,720],[14,1380],[15.2,2600]];
const SCROLL_LEFT=[...reference.travel.map(([frame,y])=>[frame/30,y/DIFFICULTY_REEL_PITCH]),[9.5,9.8],[10,22],[10.5,44],[11,85],[12,190],[13,370],[14,850],[15.2,1400]];
const ENTRY_LEFT=reference.entry.map(([frame,y])=>[frame/30,y]);
const ENTRY_RIGHT=reference.entry.map(([frame,,y])=>[frame/30,y]);
const ENTRY_OPACITY=reference.projection.map(([frame,,opacity])=>[frame/30,opacity??1]);
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const smooth=(n:number)=>{const p=clamp(n);return p*p*(3-2*p);};
const smoother=(n:number)=>{const p=clamp(n);return p*p*p*(10-15*p+6*p*p);};
function sample(points:number[][],t:number){
  if(t<=points[0][0])return points[0][1];
  for(let i=1;i<points.length;i++)if(t<points[i][0]){
    const a=points[i-1],b=points[i],p=(t-a[0])/(b[0]-a[0]);return a[1]+(b[1]-a[1])*p;
  }
  return points.at(-1)![1];
}
export function difficultyState(t:number){
  const frame=Math.floor(t*30+1e-5);
  const outward=reference.outwardCoefficient*Math.pow(Math.max(0,t-DIFFICULTY_ROLL_START),4);
  return {frame,center:smooth((t-.8)/.75),split:sample([[2.1,0],[2.3,.28],[2.5,.66],[2.7,.92],[3,1]],t),outward,drift:difficultyDrift(t),rawDrift:outward*2/3,
    titleVisible:frame>=75,projection:sample(reference.projection,t*30),projectionOpacity:sample(ENTRY_OPACITY,t),entryLeft:scrollPosition(ENTRY_LEFT,t),entryRight:scrollPosition(ENTRY_RIGHT,t),
    flat:reference.flatFrames.find(([at])=>at===frame)?.slice(1),inversionColor:reference.background[Math.min(frame,455)],
    scroll:reelScroll(t,true),leftScroll:reelScroll(t,false),smear:sample([[6.08,0],[8,1],[9.5,7],[11,34],[12.5,80],[14.8,180]],t),
    zoom:sample([[0,1],[280/30,1],[11,1.4],[12,1.65],[14.8,2.7]],t),
    inverted:INVERT_FRAMES.some(([start,end])=>frame>=start&&frame<=end),black:frame>=456};
}

function nativeSeries(values:number[],at:number){
  const i=Math.floor(at),p=at-i,read=(n:number)=>values[Math.max(0,Math.min(values.length-1,n))];
  const a=read(i-1),b=read(i),c=read(i+1),d=read(i+2),s=c-b;
  const m0=(b-a)*s>0?2*(b-a)*s/(b-a+s):0,m1=s*(d-c)>0?2*s*(d-c)/(s+d-c):0;
  return (2*p*p*p-3*p*p+1)*b+(p*p*p-2*p*p+p)*m0+(-2*p*p*p+3*p*p)*c+(p*p*p-p*p)*m1;
}

const LABEL_MODELS=Object.fromEntries(DIFFICULTIES.map(({id},selected)=>{
  const frames=reference.nativeLabels[id],initial=frames[0].map(([x])=>x),base=selected*4;
  const groups=DIFFICULTIES.map((_,word)=>{
    const start=word*4;
    return {shift:frames.map(row=>[0,1,2,3].reduce((sum,i)=>sum+row[start+i][0]-initial[start+i],0)/4),
      spacing:frames.map(row=>[0,1,2,3].reduce((sum,i)=>sum+(i-1.5)*(row[start+i][0]-initial[start+i]),0)/5),
      opacity:frames.map(row=>row[start][1])};
  });
  const chosenShift=frames.map(row=>[0,1,2].reduce((sum,i)=>sum+row[base+i][0]-initial[base+i],0)/3),arrow=frames.map(row=>row[base+3][0]);
  const caption=[0,1,2].map(i=>initial[base+i]+chosenShift.at(-1)!);caption.push(arrow.at(-1)!);
  return [id,{initial,groups,chosenShift,arrow,caption,selected}];
}));

export function difficultyLabels(t:number,level:Difficulty){
  const frame=t*30;
  // The selected label dims in source frames 1–9 and returns to full light by 12.
  const pulse=frame<12?nativeSeries([1,.88,.63,.17,.17,.17,.17,.17,.17,.17,.63,.88,1],Math.max(0,frame)):1;
  const model=LABEL_MODELS[level];
  if(frame<=reference.labelEnd){
    const at=Math.max(0,frame-reference.labelStart),dim=1-(1-reference.captionOpacity[level])*smooth((frame-71)/4);
    return model.groups.flatMap((group,word)=>{
      const chosen=word===model.selected,shift=nativeSeries(chosen?model.chosenShift:group.shift,at),spacing=chosen?0:nativeSeries(group.spacing,at);
      const alpha=chosen?dim*pulse:clamp(nativeSeries(group.opacity,at));
      return [0,1,2,3].map(i=>{const glyph=word*4+i;return{char:reference.labelGlyphs[glyph],
        x:chosen&&i===3?nativeSeries(model.arrow,at):model.initial[glyph]+shift+(i-1.5)*spacing,alpha};});
    });
  }
  const outward=reference.outwardCoefficient*Math.pow(Math.max(0,t-DIFFICULTY_ROLL_START),4),chars=[...`<${level.toUpperCase()}>`];
  const alpha=reference.captionOpacity[level]*(1-smooth((t-9.8)/1.15));
  return chars.map((char,i)=>({char,x:model.caption[i]+(i===3?outward:-outward),alpha}));
}

function onsetDistance(t:number,right:boolean){
  const u=Math.max(0,t-DIFFICULTY_SCROLL_START),d=reference.dynamics;
  return right?d.rightQuadratic*u*u+d.rightCubic*u*u*u:d.leftVelocity*(u+d.leftTau*Math.expm1(-u/d.leftTau));
}

function reelScroll(t:number,right:boolean){
  const onset=onsetDistance(t,right)/DIFFICULTY_REEL_PITCH;
  if(t<=7.2)return onset;
  const tracked=scrollPosition(right?SCROLL_RIGHT:SCROLL_LEFT,t)+onsetDistance(DIFFICULTY_ROLL_START,right)/DIFFICULTY_REEL_PITCH;
  const blend=smoother((t-7.2)/.4);return onset*(1-blend)+tracked*blend;
}

export function difficultyDrift(t:number,viewWidth=720){
  const raw=reference.outwardCoefficient*Math.pow(Math.max(0,t-DIFFICULTY_ROLL_START),4)*2/3;
  const referenceDock=140,brake=referenceDock*.65,remaining=referenceDock-brake,p=clamp((raw-brake)/(2*remaining));
  // Integrating a smooth speed ramp gives continuous position, speed and acceleration
  // at both ends of braking, followed by a real stop instead of sliding off screen.
  const travel=raw<brake?raw:brake+remaining*(2*p-2*p*p*p+p*p*p*p);
  return travel/referenceDock*Math.max(0,viewWidth/2-205);
}

export function difficultyColumn(t:number,column:number,viewWidth=720){
  const global=difficultyState(t),born=column<2?DIFFICULTY_SCROLL_START:8.05+3.3*Math.log1p((column-2)/1.6),age=t-born;
  const clock=column<2?t:DIFFICULTY_SCROLL_START+Math.max(0,age)*1.46+(DIFFICULTY_ROLL_START-DIFFICULTY_SCROLL_START)*smooth(age/.8),local=column<2?global:difficultyState(clock);
  return {x:(column<2?column-.5:.5-column)*200+difficultyDrift(t,viewWidth),age,
    alpha:column<2?1:smooth((age-.55)/.4),origin:column<2?3:363,
    scroll:column===1?local.scroll:local.leftScroll,zoom:local.zoom,smear:local.smear,clock};
}

// Monotone cubic interpolation keeps velocity continuous at the speed anchors.
function scrollPosition(SCROLL:number[][],t:number){
  if(t<=SCROLL[0][0])return SCROLL[0][1];
  for(let i=1;i<SCROLL.length;i++)if(t<SCROLL[i][0]){
    const a=SCROLL[i-1],b=SCROLL[i],h=b[0]-a[0],p=(t-a[0])/h,d=(b[1]-a[1])/h;
    const previous=i>1?(a[1]-SCROLL[i-2][1])/(a[0]-SCROLL[i-2][0]):0;
    const next=i+1<SCROLL.length?(SCROLL[i+1][1]-b[1])/(SCROLL[i+1][0]-b[0]):d;
    const m0=previous*d>0?2*previous*d/(previous+d):0,m1=d*next>0?2*d*next/(d+next):0;
    return (2*p*p*p-3*p*p+1)*a[1]+(p*p*p-2*p*p+p)*h*m0+(-2*p*p*p+3*p*p)*b[1]+(p*p*p-p*p)*h*m1;
  }
  return SCROLL.at(-1)![1];
}
