import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/saira/latin-400.css';
import {HealthBar,healthReferenceState} from './HealthBar';
import reference from './healthbar-reference.json';
import './healthbar-review.css';

function Review(){
 const video=useRef<HTMLVideoElement>(null),original=useRef<HTMLCanvasElement>(null);
 const [frame,setFrame]=useState(400),[value,setValue]=useState(10),[manual,setManual]=useState(false),[playing,setPlaying]=useState(false),[ready,setReady]=useState(false);
 function paint(){const v=video.current!,c=original.current!;c.getContext('2d')!.drawImage(v,0,30,1280,130,0,0,1280,130);}
 function seek(next:number){const f=Math.max(0,Math.min(1219,next));video.current!.pause();setPlaying(false);setManual(false);setFrame(f);video.current!.currentTime=f/30+.001;}
 useEffect(()=>{
  const v=video.current!;let handle:number,initialized=false;
  const loaded=()=>{if(initialized)return;initialized=true;v.currentTime=400/30+.001;setReady(true);};
  const seeked=()=>paint();
  const tick=(_stamp:number,metadata:VideoFrameCallbackMetadata)=>{paint();if(!v.paused)setFrame(Math.round(metadata.mediaTime*30));handle=v.requestVideoFrameCallback(tick);};
  v.addEventListener('loadeddata',loaded);v.addEventListener('seeked',seeked);handle=v.requestVideoFrameCallback(tick);if(v.readyState>=2)loaded();
  return()=>{v.cancelVideoFrameCallback(handle);v.removeEventListener('loadeddata',loaded);v.removeEventListener('seeked',seeked);};
 },[]);
 const sample=healthReferenceState(frame);
 return <main>
  <header><strong>PHIGUESS / LIFE</strong><span>原片逐帧对照 · 仅视觉演示</span></header>
  <section className="review-controls">
   <button disabled={!ready} onClick={()=>seek(329)}>入场</button>
   <button disabled={!ready} onClick={()=>{setManual(false);if(playing)video.current!.pause();else void video.current!.play();setPlaying(!playing);}}>{playing?'暂停':'按原片播放'}</button>
   <button disabled={!ready} onClick={()=>seek(frame-1)}>上一帧</button><button disabled={!ready} onClick={()=>seek(frame+1)}>下一帧</button>
   <label>帧 <input aria-label="参考帧" type="number" min={0} max={1219} value={frame} onChange={e=>seek(+e.target.value)}/></label>
   <output>{(frame/30).toFixed(3)} 秒</output>
   <input className="frame-slider" aria-label="参考时间轴" type="range" min={0} max={1219} value={frame} onChange={e=>seek(+e.target.value)}/>
  </section>
  <h2>原片顶部</h2><div className="reference-panel"><canvas ref={original} width={1280} height={130}/></div>
  <h2>复刻叠层 <small>{manual?`交互状态：${value} LIFE`:`参考状态：${sample.value} LIFE`}</small></h2>
  <div className="replica-panel"><HealthBar value={manual?value:sample.value} referenceFrame={manual?undefined:frame} fullscreenFlash={manual}/></div>
  <section className="review-controls life-controls"><span>直接切换生命值</span>{Array.from({length:11},(_,i)=>10-i).map(hp=><button key={hp} onClick={()=>{video.current!.pause();setPlaying(false);setManual(true);setValue(hp);}}>{hp}</button>)}</section>
  <section className="event-controls"><span>受击关键帧</span>{reference.events.map(e=><button key={e.frame} onClick={()=>seek(e.frame)}>{e.value} LIFE · {e.frame}</button>)}</section>
  <p>逐帧按钮与时间轴读取原录屏帧号。尖条、泛光和数字均由程序实时绘制；视频仅用于左侧原片对照。此页保留原片的 10 LIFE 对照；正式游戏使用 20HP／50HP，并已接入扣血、回血和归零结束规则。</p>
  <video ref={video} src="/@fs/E:/Project/Code/Phiguess/output/playwright/healthbar-reference/reference.mp4" muted playsInline preload="auto" hidden/>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Review/>);
