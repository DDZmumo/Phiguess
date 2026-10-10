import {NoiseDomainRenderer,noiseRegions} from './noise-domain-renderer';
import {noiseViewport} from './noise-viewport';
const canvas=document.querySelector<HTMLCanvasElement>('#screen')!,source=document.createElement('canvas');source.width=1280;source.height=720;const c=source.getContext('2d')!;
const play=document.querySelector<HTMLButtonElement>('#play')!,seek=document.querySelector<HTMLInputElement>('#seek')!,enabled=document.querySelector<HTMLInputElement>('#enabled')!;
let time=0,playing=!matchMedia('(prefers-reduced-motion: reduce)').matches,last=performance.now(),raf=0;
function backdrop(){
 c.fillStyle='#090e1d';c.fillRect(0,0,1280,720);
 const g=c.createRadialGradient(620,380,30,620,380,680);g.addColorStop(0,'#222333');g.addColorStop(.65,'#101b2d');g.addColorStop(1,'#070c13');c.fillStyle=g;c.fillRect(0,0,1280,720);
 if(document.querySelector<HTMLInputElement>('#grid')!.checked){
  c.strokeStyle='#a5bdcd';c.lineWidth=1.5;c.beginPath();
  const r=canvas.getBoundingClientRect(),v=noiseViewport(r.width,r.height);
  const stepX=24/v.width*1280,stepY=24/v.height*720;
  const startX=(((-v.left/v.width*1280)%stepX)+stepX)%stepX,startY=(((-v.top/v.height*720)%stepY)+stepY)%stepY;
  for(let x=startX;x<1280;x+=stepX){c.moveTo(x,0);c.lineTo(x,720);}for(let y=startY;y<720;y+=stepY){c.moveTo(0,y);c.lineTo(1280,y);}c.stroke();
 }
}
backdrop();
async function start(){
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.loop=true;video.preload='auto';video.src='/effects/noise-domain/hl-noise-60.mp4';
 document.querySelector('#state')!.textContent='正在加载噪点素材';
 await new Promise<void>((resolve,reject)=>{
  const timeout=setTimeout(()=>finish(new Error('噪点素材加载超时，请刷新重试')),20000);
  const loaded=()=>finish(),failed=()=>finish(new Error('噪点素材无法解码'));
  function finish(error?:Error){clearTimeout(timeout);video.removeEventListener('loadeddata',loaded);video.removeEventListener('error',failed);error?reject(error):resolve();}
  video.addEventListener('loadeddata',loaded);video.addEventListener('error',failed);video.load();
 });
 const contactImage=new Image();contactImage.src='/effects/noise-domain/contact-atlas.webp';await contactImage.decode();
 const renderer=new NoiseDomainRenderer(canvas,video,contactImage,()=>{backdrop();renderer.invalidateSource();renderer.clearPointer();draw();});let seekSerial=0;
 const frameMs=1000/60;let dirty=true,lastPaint=-1,lastUi=0,forceUi=true;
 let waitingDraws:Array<()=>void>=[];
 function schedule(){if(!raf&&!document.hidden)raf=requestAnimationFrame(tick);}
 function draw(){dirty=true;forceUi=true;schedule();}
 function flushDraw(){return new Promise<void>(resolve=>{waitingDraws.push(resolve);draw();});}
 function controls(now:number){
  if(!forceUi&&now-lastUi<100)return;forceUi=false;lastUi=now;
  seek.value=String(time);document.querySelector('#time')!.textContent=`${time.toFixed(2)}s`;
  const state=noiseRegions(time).some(v=>v.phase===2)?'红区 · 噪域激活':'粉区 · 未激活';
  const label=document.querySelector('#state')!;if(label.textContent!==state)label.textContent=state;
  const action=playing?'暂停':'播放';if(play.textContent!==action)play.textContent=action;
 }

 async function seekTo(value:number){
  const serial=++seekSerial;playing=false;video.pause();time=Math.max(0,Math.min(13.4,value));
  const target=time%video.duration;
  if(Math.abs(video.currentTime-target)>.0001||video.seeking)await new Promise<void>((resolve,reject)=>{
   const timeout=setTimeout(()=>finish(new Error('噪点素材定位超时')),5000);
   const done=()=>finish();function finish(error?:Error){clearTimeout(timeout);video.removeEventListener('seeked',done);error?reject(error):resolve();}
   video.addEventListener('seeked',done);video.currentTime=target;
  });
  if(serial===seekSerial)await flushDraw();
 }
 function fail(error:unknown){document.querySelector('#error')!.textContent=String(error);}
 async function resume(){try{if(enabled.checked)await video.play();last=performance.now();playing=true;draw();}catch{playing=false;draw();}}
 function tick(now:number){
  raf=0;const elapsed=now-last;last=now;
  if(document.hidden)return;
  if(enabled.checked&&(playing||renderer.interactionActive))renderer.noteFrameInterval(elapsed);
  if(playing){time=(time+Math.min(.1,elapsed/1000))%13.4;if(enabled.checked&&!video.seeking&&Math.abs(video.currentTime-time%video.duration)>.12)video.currentTime=time%video.duration;}
  const needsPaint=dirty||(enabled.checked&&(playing||renderer.interactionActive));
  if(needsPaint&&(lastPaint<0||now-lastPaint>=frameMs-.2)){
   renderer.render(source,time,enabled.checked);dirty=false;
   lastPaint=lastPaint<0?now:now-(Math.max(0,now-lastPaint-frameMs)%frameMs);
   const ready=waitingDraws;waitingDraws=[];for(const resolve of ready)resolve();
  }
  controls(now);
  if(playing||(enabled.checked&&renderer.interactionActive)||dirty)schedule();
 }
 await flushDraw();
 play.onclick=()=>{if(playing){playing=false;video.pause();draw();}else void resume();};enabled.onchange=()=>{if(!enabled.checked)video.pause();else if(playing){video.currentTime=time%video.duration;void resume();}draw();};window.addEventListener('resize',draw);document.querySelector<HTMLButtonElement>('#restart')!.onclick=()=>{void seekTo(0).then(resume).catch(fail);};seek.oninput=()=>{void seekTo(+seek.value).catch(fail);};document.querySelector<HTMLButtonElement>('#frame')!.onclick=()=>{void seekTo((Math.floor(time*60+.001)+1)/60).catch(fail);};
 document.querySelector<HTMLInputElement>('#grid')!.onchange=()=>{backdrop();renderer.invalidateSource();draw();};
 function point(event:PointerEvent){const r=canvas.getBoundingClientRect(),v=noiseViewport(r.width,r.height);renderer.setPointer((event.clientX-r.left)/v.scale+v.left,(event.clientY-r.top)/v.scale+v.top,Boolean(event.buttons&1));draw();}
 function leave(){renderer.clearPointer();draw();}
 canvas.addEventListener('pointermove',point,{passive:true});canvas.addEventListener('pointerdown',point,{passive:true});canvas.addEventListener('pointerup',event=>{if(event.pointerType==='touch')leave();else point(event);},{passive:true});canvas.addEventListener('pointerleave',leave);canvas.addEventListener('pointercancel',leave);window.addEventListener('blur',leave);
 document.addEventListener('visibilitychange',()=>{last=performance.now();if(document.hidden){cancelAnimationFrame(raf);raf=0;video.pause();renderer.clearPointer();dirty=true;}else if(playing)void resume();else draw();});window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);video.pause();video.removeAttribute('src');video.load();renderer.dispose();},{once:true});
 // Local inspection only: deterministic seeking avoids real-time capture ambiguity.
 Object.assign(window,{noiseDemo:{seek:seekTo,state:()=>({time,playing,grainTime:video.currentTime,grainReady:video.readyState>=2,regions:noiseRegions(time),interaction:renderer.interactionState,performance:renderer.performanceState})}});
 if(playing)await resume();
}
void start().catch(e=>{document.querySelector('#error')!.textContent=String(e);});
