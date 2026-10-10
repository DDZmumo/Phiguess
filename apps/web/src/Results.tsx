import {prepareResultMusic,startResultMusic,stopResultMusic} from './menu-music';
import {playSound} from './sound';
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {ArrowRight,Check,X} from 'lucide-react';
import type {MatchResultView,ResultRoundView} from '../../../packages/contracts/src';
import {RULES_VERSION} from '../../../packages/contracts/src';
import {performanceBadge} from '../../../packages/game-core/src';
import {api,errorMessage} from './api';
import {go,useReducedMotion,useResource} from './hooks';
import {useStore,type Session} from './store';
import {UserChip,gsap,useGSAP} from './visual';
import {RESULT_FPS,resultMotion as timing,resultRowEase,resultRowTracks} from './results-motion';
import {useResultScroll} from './use-result-scroll';
import {OriginalReveal} from './OriginalReveal';
import {AnswerTint} from './AnswerNotice';
import {performanceGradeNames} from './PerformanceBadge';
import {SongName,scrambleSongName} from './SongName';
import '@fontsource/saira/latin-400.css';
import './game-alignment.css';
import './song-rail.css';
import './results.css';

type Phase='intro'|'ready'|'opening-summary'|'summary'|'saving-summary'|'leaving';
type Preview={mode:'score'|'summary';frame:number};
type Timeline=ReturnType<typeof gsap.timeline>;

function ResultArtwork({matchId,round,eager,onReady,onRevealed,interactive}:{matchId:string;round:ResultRoundView;eager:boolean;onReady:(round:number,url:string)=>void;onRevealed:(round:number)=>void;interactive:boolean}){
 const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(eager),[inView,setInView]=useState(eager),[image,setImage]=useState<string|null>(null);
 const [revealInfo,setRevealInfo]=useState<{title:string;imageUrl:string}|null>(null),[revealedTitle,setRevealedTitle]=useState<string|null>(null),[busy,setBusy]=useState(false),[revealError,setRevealError]=useState(''),[scrambleFrame,setScrambleFrame]=useState(0);
 const revealRequest=useRef<AbortController|null>(null),reduce=useReducedMotion(),title=round.title??revealedTitle;
 const token=useStore(s=>s.session?.token);
 useEffect(()=>{
  const observer=new IntersectionObserver(entries=>{const active=entries.some(e=>e.isIntersecting);setInView(active);if(active)setVisible(true);});
  if(ref.current)observer.observe(ref.current);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  if(!inView||title||reduce)return;
  const timer=setInterval(()=>{if(!document.hidden)setScrambleFrame(frame=>(frame+1)%65536);},40);
  return()=>clearInterval(timer);
 },[inView,title,reduce]);
 useEffect(()=>()=>revealRequest.current?.abort(),[]);
 const originalReady=useCallback((_round:number,original:{url:string;ratio:number}|null)=>{
  if(original&&revealInfo){playSound('panel.open');setRevealedTitle(revealInfo.title);setBusy(false);revealRequest.current=null;onRevealed(round.round);}
 },[revealInfo,onRevealed,round.round]);
 const originalError=useCallback(()=>{setRevealInfo(null);setBusy(false);revealRequest.current=null;setRevealError('原图加载未完成，请点击重试。');},[]);
 async function reveal(){
  if(!interactive||round.correct||title||busy||revealRequest.current)return;
  const controller=new AbortController();revealRequest.current=controller;setBusy(true);setRevealError('');
  try{const result=await api<{title:string;imageUrl:string}>(`matches/${matchId}/rounds/${round.round}/result-reveal`,'GET',undefined,controller.signal);if(!controller.signal.aborted)setRevealInfo(result);}
  catch(error){if(!controller.signal.aborted){setBusy(false);revealRequest.current=null;setRevealError(errorMessage(error));}}
 }
 useEffect(()=>{
  if(!visible||!round.imageUrl)return;
  const controller=new AbortController();let alive=true,url:string|undefined;
  void fetch(round.imageUrl,{signal:controller.signal,headers:token?{Authorization:`Bearer ${token}`}:{}}).then(async response=>{
   if(!response.ok)throw new Error('Artwork unavailable');
   const blob=await response.blob();if(!alive)return;url=URL.createObjectURL(blob);
   const picture=new Image();picture.src=url;await picture.decode();if(alive){setImage(url);onReady(round.round,url);}
  }).catch(()=>{});
  return()=>{alive=false;controller.abort();if(url)URL.revokeObjectURL(url);};
 },[round.imageUrl,round.round,visible,token,onReady]);
 return <div ref={ref} className="result-artwork" data-revealed={Boolean(title)}>
  <OriginalReveal id={matchId} round={round.round} solved={Boolean(revealInfo)} originalUrl={revealInfo?.imageUrl} originalAlt="揭晓的正确曲绘" revealDelay={.45} onOriginalReady={originalReady} onOriginalError={originalError}>{image&&<img src={image} alt=""/>}</OriginalReveal>
  <div className="result-art-shade"/>
  <span className="result-song-title" title={title??'点击曲绘揭晓曲名'}><SongName title={title} scramble={scrambleSongName(round.round+5,scrambleFrame)} animate reduce={reduce}/></span>
  <span className="result-song-level">{round.difficulty.toUpperCase()}<small>#{String(round.round+1).padStart(2,'0')}</small></span>
  {!round.correct&&!title&&<button className="result-reveal-trigger" type="button" aria-label={`揭晓第 ${round.round+1} 首的正确曲绘和曲名`} title={busy?'正在读取原图':'点击揭晓正确曲绘和曲名'} disabled={!interactive||busy||!image} tabIndex={inView?0:-1} onClick={()=>void reveal()}/>}
  {revealError&&<span className="result-reveal-error" role="alert">{revealError}</span>}
 </div>;
}

export function ResultScene({result,user,onExit,onPublication,preview}:{result:MatchResultView;user:Session['user'];onExit:()=>void;onPublication:(published:boolean)=>Promise<void>;preview?:Preview}){
 useEffect(()=>{if(preview)return;prepareResultMusic(result.difficulty);return()=>stopResultMusic(result.id);},[result.id,result.difficulty,Boolean(preview)]);
 const root=useRef<HTMLElement>(null),intro=useRef<Timeline|null>(null),transition=useRef<Timeline|null>(null);
 const [phase,setPhase]=useState<Phase>('intro'),[background,setBackground]=useState<string|null>(null),[layout,setLayout]=useState({scale:1,portrait:false,ready:false});
 const [publicationError,setPublicationError]=useState(''),mounted=useRef(true);
 const [revealedRounds,setRevealedRounds]=useState(()=>new Set<number>());
 const markRevealed=useCallback((round:number)=>setRevealedRounds(previous=>previous.has(round)?previous:new Set(previous).add(round)),[]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const phaseRef=useRef<Phase>('intro');phaseRef.current=phase;
 const reduce=useReducedMotion(),self=result.players.find(p=>p.user_id===user.id),score=self?.score??0,correct=self?.correct??0;
 const badge=performanceBadge(result.rounds,result.difficulty),legacy=result.rules_version!==RULES_VERSION;
 const grade=legacy?'none':badge.grade;
 const gradeName=performanceGradeNames[grade];
 const failed=Boolean(result.health_capacity&&self?.health===0),interrupted=result.status==='interrupted';
 const scrollEnabled=preview?preview.mode==='score'&&preview.frame>=143:layout.ready&&(phase==='intro'||phase==='ready');
 useResultScroll(root,scrollEnabled,layout.portrait,result.rounds.length,reduce);
 const artworkReady=useCallback((round:number,url:string)=>{if(round===result.rounds[0]?.round)setBackground(url);},[result.id,result.rounds[0]?.round]);
 useLayoutEffect(()=>{
  const measure=()=>{const element=root.current!;const portrait=element.clientWidth<element.clientHeight;
   setLayout({portrait,ready:true,scale:Math.min(element.clientWidth/(portrait?810:1280),element.clientHeight/(portrait?1200:576))});
  };const observer=new ResizeObserver(measure);if(root.current){measure();observer.observe(root.current);}return()=>observer.disconnect();
 },[]);
 function summaryTimeline(paused=false){
  const node=root.current!,s=timing.summary,q=(selector:string)=>node.querySelector(selector);
  const tl=gsap.timeline({paused,onUpdate:()=>{node.dataset.referenceFrame=String(200+Math.round(tl.time()*RESULT_FPS));},onComplete:()=>{if(!preview)setPhase('summary');}});
  const d=(value:number)=>reduce?Math.min(.12,value):value,p=(value:number)=>reduce?value*.08:value;
  tl.to([q('.result-score-page'),q('.result-user'),q('.result-continue-nav')],{opacity:0,duration:d(s.fade),ease:'phigrosFadeOut'},0)
   .to(q('.result-summary-dim'),{opacity:.5,duration:d(s.fade),ease:'phigrosFadeIn'},0)
   .set(q('.result-summary'),{visibility:'visible'},0)
   .fromTo(q('.result-endless-count'),{opacity:0,scale:reduce?1:1.75},{opacity:1,duration:d(s.numberFade),ease:'phigrosFadeIn'},p(s.numberStart))
   .to(q('.result-endless-count'),{scale:1,duration:d(s.shrinkDuration),ease:'power3.out'},p(s.shrinkStart))
   .fromTo(q('.result-performance-base'),{opacity:0},{opacity:1,duration:d(s.baseDuration),ease:'phigrosFadeIn'},p(s.baseStart))
   .fromTo(q('.result-summary-cancel'),{opacity:0},{opacity:1,duration:d(s.controlDuration),ease:'phigrosFadeIn'},p(s.cancelStart))
   .fromTo(q('.result-summary-confirm'),{opacity:0},{opacity:1,duration:d(s.controlDuration),ease:'phigrosFadeIn'},p(s.confirmStart));
  return tl;
 }
 useGSAP(()=>{
  if(!layout.ready)return;
  const node=root.current!,rows=[...node.querySelectorAll<HTMLElement>('.result-course-row')],q=(selector:string)=>node.querySelector(selector);
  setPhase('intro');gsap.set([q('.result-score-page'),q('.result-user'),q('.result-continue-nav')],{opacity:1});gsap.set(q('.result-summary'),{visibility:'hidden'});gsap.set(q('.result-summary-dim'),{opacity:0});
  const tl=gsap.timeline({paused:Boolean(preview),onUpdate:()=>{node.dataset.referenceFrame=String(Math.round(tl.time()*RESULT_FPS));},onComplete:()=>{if(!preview)setPhase('ready');}});intro.current=tl;
  if(reduce&&!preview){
   gsap.set(q('.result-intro-black'),{opacity:0});startResultMusic(result.difficulty,result.id);
   gsap.set([...rows,q('.result-total'),q('.result-user'),...node.querySelectorAll('.result-nav')],{x:0,y:0,opacity:1,scale:1});setPhase('ready');
  }else{
   if(!preview)tl.call(()=>startResultMusic(result.difficulty,result.id),undefined,timing.background[0]);
   tl.fromTo(q('.result-intro-black'),{opacity:1},{opacity:0,duration:timing.background[1],ease:'phigrosFadeIn'},timing.background[0]);
   const bounds=node.getBoundingClientRect(),top=Math.max(0,bounds.top),bottom=Math.min(innerHeight,bounds.bottom);
   const visible=rows.map(row=>{const rect=row.getBoundingClientRect(),scale=rect.height/Math.max(1,row.offsetHeight);return {row,rect,startX:Math.ceil((innerWidth-rect.left)/Math.max(.01,scale))+48};}).filter(({rect})=>rect.bottom>top&&rect.top<bottom);
   const stagger=Math.min(8/RESULT_FPS,(timing.controlsStart-1-timing.rowStarts[0])/Math.max(1,visible.length-1));
   visible.forEach(({row,startX},i)=>{const sample=Math.min(i,2),track=resultRowTracks[sample]!;tl.fromTo(row,{x:startX},{x:0,duration:(track.at(-1)![0]-track[0]![0])/RESULT_FPS,ease:resultRowEase(sample)},timing.rowStarts[0]+i*stagger);});
   tl.fromTo(q('.result-total'),{x:900},{x:0,duration:timing.totalDuration,ease:'power4.out'},timing.totalStart)
    .fromTo(q('.result-user'),{x:220},{x:0,duration:timing.playerDuration,ease:'power3.out'},timing.playerStart)
    .fromTo(node.querySelectorAll('.result-nav'),{opacity:0,y:32},{opacity:1,y:0,duration:timing.controlsDuration,ease:'power3.out'},timing.controlsStart);
  }
  if(preview?.mode==='summary'){tl.progress(1);transition.current=summaryTimeline(true);transition.current.time(preview.frame/RESULT_FPS);}
  else if(preview)tl.time(preview.frame/RESULT_FPS);
  return()=>{transition.current?.kill();transition.current=null;};
 },{scope:root,dependencies:[result.id,result.rounds.length,layout.ready,reduce,preview?.mode],revertOnUpdate:true});
 useLayoutEffect(()=>{if(preview)(preview.mode==='summary'?transition.current:intro.current)?.pause().time(preview.frame/RESULT_FPS);},[preview?.frame,preview?.mode]);
 const leave=()=>{
  if(preview||!['ready','summary','saving-summary'].includes(phaseRef.current))return;setPhase('leaving');phaseRef.current='leaving';transition.current?.kill();stopResultMusic(result.id);
  transition.current=gsap.timeline().to(root.current!.querySelector('.result-exit-black'),{opacity:1,duration:reduce?.12:timing.summary.exitDuration,ease:'phigrosFadeIn'}).call(onExit);
 };
 const openSummary=()=>{
  if(preview||phaseRef.current!=='ready')return;playSound('ui.confirm');
  if(!result.endless||result.status==='interrupted'){leave();return;}setPhase('opening-summary');phaseRef.current='opening-summary';transition.current?.kill();transition.current=summaryTimeline();
 };
 const decidePublication=async(published:boolean)=>{
  if(preview||phaseRef.current!=='summary')return;
  setPublicationError('');phaseRef.current='saving-summary';setPhase('saving-summary');
  try{await onPublication(published);if(mounted.current){playSound(published?'ui.complete':'ui.back');leave();}}
  catch(error){if(mounted.current){phaseRef.current='summary';setPhase('summary');setPublicationError(errorMessage(error));}}
 };
 useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){if(phaseRef.current==='summary')void decidePublication(false);else if(phaseRef.current==='ready'){playSound('ui.back');leave();}}};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);});
 const status=interrupted?'挑战已中断':failed?'血量耗尽，挑战结束':'挑战完成';
 return <section ref={root} className={`result-scene ${layout.portrait?'result-portrait':''}`} data-phase={preview?(preview.mode==='score'&&preview.frame>=143?'ready':preview.mode):phase} aria-label="最终得分结算" style={{'--result-scale':layout.scale} as CSSProperties}>
  <div className="result-background" style={background?{backgroundImage:`url("${background}")`}:undefined}/><div className="result-background-tint"/>
  <div className="result-summary-dim"/>
  <div className={`result-board ${layout.portrait?'is-portrait':''}`}>
   <div className="result-score-page" aria-hidden={!preview&&['opening-summary','summary','saving-summary'].includes(phase)}>
    <h1 className="result-sr-only">{status}，总分 {score}，答对 {correct} 首</h1>
    <div className="result-scroll" role="region" aria-label="滚动曲目成绩" tabIndex={scrollEnabled?0:-1}><div className="result-scroll-spacer" style={{height:Math.max(0,result.rounds.length*(layout.portrait?184:136)-(layout.portrait?24:21))}}/></div>
    <div className="result-rows"><div className="result-rows-track" role="list" aria-label={`本场 ${result.rounds.length} 首曲目成绩`}>
     {result.rounds.map((round,index)=><article className="result-course-row" role="listitem" key={round.round} aria-label={`第 ${round.round+1} 首，${round.correct?'已猜中':'未猜出'}，${round.score} 分`}>
      {revealedRounds.has(round.round)&&<><div className="result-course-tint" aria-hidden="true"><AnswerTint kind="bad" persistent/></div><span className="input-answer-notice bad result-course-border" aria-hidden="true"/></>}
      <ResultArtwork matchId={result.id} round={round} eager={index<3} onReady={artworkReady} onRevealed={markRevealed} interactive={!preview&&(phase==='intro'||phase==='ready')}/>
      <div className="result-course-data"><div className="game-score result-course-score"><span>SCORE</span><b>{round.score}</b></div>
       <div className="result-song-stats">
        <span><small>猜测次数</small><b>{round.attempts??round.wrongAttempts+(round.correct?1:0)}<em>次</em></b></span>
        <span><small>消耗时长</small><b>{!round.correct&&round.elapsedMs!==null&&result.round_seconds!==null&&round.elapsedMs>=result.round_seconds*1000?'超时':<>{round.elapsedMs===null?'—':(round.elapsedMs/1000).toFixed(1)}<em>秒</em></>}</b></span>
       </div>
      </div>
     </article>)}
    </div></div>
    <div className="result-total" aria-label={`总得分 ${score}`}><div className="game-score"><span>TOTAL SCORE</span><b>{score}</b></div></div>
   </div>
   <div className="result-summary" data-grade={grade} role="group" aria-label="无尽模式综合成绩" aria-busy={phase==='saving-summary'} aria-hidden={preview?preview.mode!=='summary':!['opening-summary','summary','saving-summary'].includes(phase)}>
    <div className="result-performance-base performance-badge" data-grade={grade} aria-hidden="true"/>
    <strong className="result-endless-count" aria-label={`共答对 ${correct} 首，${gradeName}`}>{correct}</strong>
    <button className="result-summary-cancel" aria-label="不公布成绩并返回主界面" title="不公布成绩并返回主界面" disabled={Boolean(preview)||phase!=='summary'} onClick={()=>void decidePublication(false)}><X size={48} strokeWidth={1.5}/></button>
    <button className="result-summary-confirm" aria-label="公布成绩并返回主界面" title="公布成绩并返回主界面" disabled={Boolean(preview)||phase!=='summary'} onClick={()=>void decidePublication(true)}><Check size={56} strokeWidth={1.5}/></button>
    <p className="result-grade-description">{legacy?'旧版计分 · 不参与新定级':grade==='none'?'未获得成绩牌':''}<span className="result-sr-only">{gradeName}，综合得分率 {(badge.ratio*100).toFixed(2)}%</span></p>
    {publicationError&&<p className="result-publication-error" role="alert">{publicationError}</p>}
   </div>
  </div>
  <button className="result-nav result-continue-nav" aria-label={result.endless&&result.status!=='interrupted'?'查看无尽综合成绩':'完成结算，返回主界面'} disabled={Boolean(preview)||phase!=='ready'} onClick={openSummary}><small>NEXT</small><ArrowRight size={48} strokeWidth={1}/></button>
  <div className="result-user"><UserChip user={user} subtitle={`${result.difficulty.toUpperCase()} · ${result.endless?'Infinity':`${result.round_count??result.rounds.length}题`}`}/></div>
  <div className="result-intro-black"/><div className={`result-exit-black ${phase==='leaving'?'active':''}`}/>
 </section>;
}

export function Results({id}:{id:string}){
 const [retry,setRetry]=useState(0),{data:result,error}=useResource<MatchResultView>(`matches/${id}/result`,retry),user=useStore(s=>s.session!.user);
 useEffect(()=>{if(result&&['finished','interrupted'].includes(result.status)&&useStore.getState().matchId===id)useStore.getState().setMatch(null);},[id,result?.status]);
 if(!result||!Array.isArray(result.rounds))return <section className="result-loading" aria-label="读取结算" aria-busy={!error&&!result}>{(error||result)&&<><p role="alert">{error||'成绩记录暂未完整加载'}</p><button onClick={()=>setRetry(n=>n+1)}>重试</button><button onClick={()=>go('/account')}>返回主界面</button></>}</section>;
 return <ResultScene key={id} result={result} user={user} onExit={()=>go('/account')} onPublication={async published=>{await api(`matches/${id}/publication`,'POST',{published});}}/>;
}
