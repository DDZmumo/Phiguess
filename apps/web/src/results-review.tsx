import {useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {MatchResultView} from '../../../packages/contracts/src';
import {ResultScene} from './Results';
import './style.css';
import './results-review.css';

function Review(){
 const [mode,setMode]=useState<'score'|'summary'>('score'),[frame,setFrame]=useState(143),[playing,setPlaying]=useState(false),[count,setCount]=useState(3),[covers,setCovers]=useState<string[]>([]);
 useEffect(()=>{void fetch('/api/showcase').then(r=>r.json()).then((rows:{url:string}[])=>setCovers(rows.map(r=>r.url))).catch(()=>{});},[]);
 useEffect(()=>{if(!playing)return;const start=performance.now()-frame/30*1000,limit=mode==='score'?143:96;let handle=0;const tick=()=>{const next=Math.min(limit,Math.floor((performance.now()-start)/1000*30));setFrame(next);if(next<limit)handle=requestAnimationFrame(tick);else setPlaying(false);};handle=requestAnimationFrame(tick);return()=>cancelAnimationFrame(handle);},[playing,mode]);
 const result=useMemo<MatchResultView>(()=>({id:'reference-layout',mode:'practice',difficulty:'in',status:'finished',rules_version:'review-only',created_at:'',finished_at:'',health_capacity:50,round_count:0,round_seconds:30,endless:true,published:false,
  players:[{user_id:'review',name:'结算预览',score:2908328,correct:49,health:20}],
  rounds:Array.from({length:count},(_,i)=>({round:i,title:['Desultory Signals','Exoplanetary Mirage','Entrance to the Chaos'][i%3],difficulty:'in',score:[974492,977202,956634][i%3],correct:true,attempts:i+1,wrongAttempts:i,hintsUsed:i%3,noiseHits:0,elapsedMs:5000+i*700,imageUrl:covers.length?covers[i%covers.length]:null})),
 }),[covers,count]);
 return <main className="result-review"><header><strong>PHIGUESS · 结算动效对照</strong><span>样例数字与曲名用于排版检查；图片来自项目曲库，未使用视频像素。</span></header>
  <nav><button onClick={()=>{setMode('score');setPlaying(false);setFrame(0);}}>逐曲结算</button><button onClick={()=>{setMode('summary');setPlaying(false);setFrame(0);}}>无尽综合</button><button onClick={()=>{setFrame(0);setPlaying(true);}}>播放</button><button onClick={()=>setPlaying(false)}>暂停</button><button onClick={()=>{setPlaying(false);setFrame(v=>Math.max(0,v-1));}}>上一帧</button><button onClick={()=>{setPlaying(false);setFrame(v=>Math.min(mode==='score'?143:96,v+1));}}>下一帧</button><label>曲目数 <select value={count} onChange={e=>setCount(+e.target.value)}>{[3,5,20,49].map(n=><option key={n}>{n}</option>)}</select></label><output>{frame} 帧 · {(frame/30).toFixed(3)} 秒</output></nav>
  <input aria-label="结算时间轴" type="range" min={0} max={mode==='score'?143:96} value={frame} onChange={e=>{setPlaying(false);setFrame(+e.target.value);}}/>
  <div className="result-review-stage"><ResultScene result={result} user={{id:'review',name:'结算预览'}} onExit={()=>{}} onPublication={async()=>{}} preview={{mode,frame}}/></div>
  <p>卡片 26 / 34 / 42 帧入场，总分条 59 帧，继续按钮 131 帧。每首显示实际得分、猜测次数与消耗时长。无尽面板从按下继续时重新计时；橙色仅为参考外观，综合表现规则待接入。</p>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Review/>);
