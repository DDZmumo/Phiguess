import {DamageFeedback} from './DamageFeedback';
import {prepareResultMusic,prepareGameMusic,startGameMusic,stopGameMusic} from './menu-music';
import {playSound} from './sound';
import {createRequestId} from './request-id';
import {ArtworkPreloader} from './artwork-preload';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import {createPortal} from 'react-dom';
import { X, SkipForward, ArrowLeft } from 'lucide-react';
import { api, ApiError, errorMessage, type Hint, type Progress } from './api';
import { go, useLive, useReducedMotion, useServerTime } from './hooks';
import { useStore } from './store';
import { Back, gsap, Settings, useGSAP, UserChip } from './visual';
import { resolveHealthCapacity, type MatchView } from '../../../packages/contracts/src';
import { SongRail } from './SongRail';
import { HintStrip } from './HintStrip';
import { OriginalReveal } from './OriginalReveal';
import { NoiseArtwork } from './NoiseArtwork';
import { AnswerNotice, type AnswerNoticeEvent } from './AnswerNotice';
import { HealthBar } from './HealthBar';
import { subscribeNoiseHits } from './noise-stage';
import './game-results-transition.css';

function Artwork({skipFlashAt,id,round,started,complete,difficulty,onReady,progress,startsAt,deadline,now,answered,imageKey,totalRounds}:{skipFlashAt?:number;id:string;round:number;started:boolean;complete:boolean;difficulty:string;onReady:(round:number,url:string)=>void;progress:Progress[];startsAt:number;deadline:number;now:number;answered:boolean;imageKey?:string;totalRounds:number}) {
  const [images,setImages]=useState<{url:string;round:number;difficulty:string;ratio:number;decoded:HTMLImageElement;startsAt:number;deadline:number}[]>([]),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [originals,setOriginals]=useState<Map<number,{url:string;ratio:number}>>(()=>new Map());
  const [zoomOpen,setZoomOpen]=useState(false),zoom=useRef<HTMLDialogElement>(null);
  const transitionStart=useRef({startedAt:0,progress:0,update:undefined as ((progress:number)=>void)|undefined}),urls=useRef(new Set<string>()),ref=useRef<HTMLDivElement>(null),reduce=useReducedMotion();
  const noiseFlashes=useRef(new Map<number,number>());if(skipFlashAt!==undefined)noiseFlashes.current.set(round,skipFlashAt);else noiseFlashes.current.delete(round);
  const noiseDeadlines=useRef(new Map<number,number>());noiseDeadlines.current.set(round,deadline);
  const token=useStore(s=>s.session?.token);
  const [preloader]=useState(()=>new ArtworkPreloader());
  useEffect(()=>()=>preloader.cancel(),[preloader,id,token]);
  const onOriginalReady=useCallback((originalRound:number,original:{url:string;ratio:number}|null)=>setOriginals(previous=>{
    const next=new Map(previous);if(original)next.set(originalRound,original);else next.delete(originalRound);return next;
  }),[]);
  useLayoutEffect(()=>{
    if(zoom.current?.open)zoom.current.close();
    setZoomOpen(false);
  },[round,difficulty]);
  useEffect(()=>{if(zoomOpen&&!zoom.current?.open)zoom.current?.showModal();else if(!zoomOpen&&zoom.current?.open)zoom.current.close();},[zoomOpen]);
  useEffect(()=>{
    if(!started||!token)return;
    const ctrl=new AbortController();let alive=true;setError('');
    const timeout=setTimeout(()=>ctrl.abort(),30000);
    void (async()=>{
      let blob=await preloader.take(round,imageKey,ctrl.signal);
      if(!blob){
        const response=await fetch(`/api/matches/${id}/rounds/${round}/image`,{headers:{Authorization:`Bearer ${token}`},signal:ctrl.signal});
        if(!response.ok)throw new Error('Image unavailable');
        blob=await response.blob();
      }
      if(!alive)return;
      const url=URL.createObjectURL(blob);urls.current.add(url);
      const decoded=new Image();decoded.src=url;await decoded.decode();if(!alive)return;
      setImages(previous=>[...previous.slice(-1),{url,round,difficulty,ratio:decoded.naturalWidth/decoded.naturalHeight,decoded,startsAt,deadline}]);onReady(round,url);
    })().catch(()=>{if(alive)setError('题图加载未完成');}).finally(()=>clearTimeout(timeout));
    return()=>{alive=false;ctrl.abort();clearTimeout(timeout);};
  },[id,round,started,token,retry,onReady,difficulty,imageKey,preloader]);
  useEffect(()=>{
    if(complete){preloader.cancel();return;}
    // The visible image gets the bandwidth first. Keep only the next ciphertext.
    if(started&&token&&round+1<totalRounds&&images.at(-1)?.round===round)
      preloader.preload(id,round+1,token);
  },[preloader,id,round,started,complete,token,totalRounds,images]);
  useEffect(()=>()=>{for(const url of urls.current)URL.revokeObjectURL(url);urls.current.clear();},[]);
  useGSAP(()=>{
    transitionStart.current.startedAt=performance.now();transitionStart.current.progress=0;
    const current=ref.current?.querySelector('.art-new'),old=ref.current?.querySelector('.art-old');
    const previous=images.at(-2),next=images.at(-1);
    const downgrade=previous&&next&&previous.round===next.round&&previous.difficulty!==next.difficulty;
    if(downgrade){
      if(current)gsap.set(current,{yPercent:0});
      if(old)gsap.fromTo(old,{yPercent:0,opacity:1,'--artwork-sweep':'0%'},{'--artwork-sweep':'100%',duration:reduce?.05:.35,ease:'power2.inOut'});
    }else{
      if(current)gsap.fromTo(current,{yPercent:reduce?0:-100},{yPercent:0,duration:reduce?.1:.8,ease:'phigrosArtwork'});
      if(old)gsap.to(old,{yPercent:reduce?0:100,opacity:reduce?0:1,duration:reduce?.1:.8,ease:'phigrosArtwork',onUpdate:()=>{const progress=reduce?1:Number(gsap.getProperty(old,'yPercent'))/100;transitionStart.current.progress=progress;transitionStart.current.update?.(progress);}});
    }
    const retained=new Set(images.map(i=>i.url));
    for(const url of urls.current)if(!retained.has(url)){URL.revokeObjectURL(url);urls.current.delete(url);}
  },{scope:ref,dependencies:[images,reduce],revertOnUpdate:true});
  const ready=images.at(-1)?.round===round&&images.at(-1)?.difficulty===difficulty;
  const solvedCurrent=progress.some(p=>p.round===round&&p.correct)||answered,originalCurrent=originals.get(round);
  return <><div className="art-frame" ref={ref}>
    {images.map((image,i)=>{const solved=progress.some(p=>p.round===image.round&&p.correct)||(image.round===round&&answered);const cover=i===images.length-2&&image.round===images.at(-1)?.round&&image.difficulty!==images.at(-1)?.difficulty;return <div key={image.url} className={`art-slide ${i===images.length-1?'art-new':'art-old'} ${cover?'art-downgrade-cover':''}`}><OriginalReveal id={id} round={image.round} solved={solved} revealDelay={.45} onOriginalReady={onOriginalReady}><img src={image.url} alt={i===images.length-1?'当前难度的猜测曲绘':''}/></OriginalReveal></div>;})}
    {images.length>0&&<NoiseArtwork skipFlashAt={noiseFlashes.current.get(images.at(-1)!.round)} src={images.at(-1)!.url} image={images.at(-1)!.decoded} showImage={false} alt="" startsAt={images.at(-1)!.startsAt} deadline={noiseDeadlines.current.get(images.at(-1)!.round)??images.at(-1)!.deadline} now={now} solved={progress.some(p=>p.round===images.at(-1)!.round&&p.correct)||(images.at(-1)!.round===round&&answered)} active={true} suspended={zoomOpen} transitionStart={transitionStart} skew={.2679491924}/>}
    <button className="art-zoom-trigger" aria-label="放大查看曲绘" title={solvedCurrent&&!originalCurrent?'正在读取原图':'点击放大查看'} disabled={!ready||(solvedCurrent&&!originalCurrent)} onClick={()=>{setZoomOpen(true);playSound('panel.open');}}/>
    {!ready&&(started||complete)&&<div className={`art-placeholder ${images.length?'over-old':''}`}><strong>{complete?'φ':'…'}</strong><span>{complete?'挑战结束':'正在读取曲绘'}</span></div>}
    {error&&<div className="art-error"><span>{error}</span><button onClick={()=>setRetry(n=>n+1)}>重试</button></div>}
  </div><dialog className="art-zoom-dialog" ref={zoom} aria-label="放大曲绘" onCancel={e=>{e.preventDefault();setZoomOpen(false);playSound('panel.close');}} onClose={()=>setZoomOpen(false)} onClick={e=>{if(e.target===e.currentTarget){setZoomOpen(false);playSound('panel.close');}}}>
    <button className="art-zoom-close" aria-label="关闭放大曲绘" autoFocus onClick={()=>{setZoomOpen(false);playSound('panel.close');}}><X size={27}/></button>
    {zoomOpen&&originalCurrent?<img src={originalCurrent.url} alt="当前曲绘的原图" style={{width:`min(100%, calc((92svh - 82px) * ${originalCurrent.ratio}))`}}/>:zoomOpen&&images.at(-1)&&<img src={images.at(-1)!.url} style={{width:`min(100%, calc((92svh - 82px) * ${images.at(-1)!.ratio}))`}} alt="当前曲绘的完整放大图"/>}
    <p>计时继续 · Esc 或点击空白处关闭</p>
  </dialog></>;
}

export function Game({id}:{id:string}) {
  const {data:match,setData:setMatchView,error:loadError,errorStatus}=useLive<MatchView>('match',id),now=useServerTime(match),session=useStore(s=>s.session)!;
  const endingBlack=useRef<HTMLDivElement>(null),wasActive=useRef(false),reduce=useReducedMotion();
  const [settings,setSettings]=useState(false),[answer,setAnswer]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [progress,setProgress]=useState<Progress[]>([]),[hints,setHints]=useState<Hint[]>([]),[hintBusy,setHintBusy]=useState(false);
  const [submitNoise,setSubmitNoise]=useState<{round:number;leaving:boolean;startsAt:number;deadline:number}|null>(null);
  const [notice,setNotice]=useState<AnswerNoticeEvent|null>(null),noticeSerial=useRef(0),noticed=useRef(new Set<string>());
  const [skipNoise,setSkipNoise]=useState<{round:number;at:number;red?:boolean}|null>(null);
  const [skipArmed,setSkipArmed]=useState(false),[skipBusy,setSkipBusy]=useState(false),skipPending=useRef(false),skipButton=useRef<HTMLButtonElement>(null);
  const [abandonArmed,setAbandonArmed]=useState(false),[returnNoiseAt,setReturnNoiseAt]=useState<number|null>(null),[returnBusy,setReturnBusy]=useState(false),returnPending=useRef(false),returnButton=useRef<HTMLButtonElement>(null);
  const submitButton=useRef<HTMLButtonElement>(null);
  const noiseDamagePending=useRef(0),noiseDeathSounded=useRef(false);
  const wrongAttempts=useRef(new Map<number,number>());
  const showNotice=useCallback((kind:AnswerNoticeEvent['kind'],round:number)=>{
    const key=`${round}:${kind}`;
    if(kind!=='bad'&&noticed.current.has(key))return;
    noticed.current.add(key);setNotice({kind,serial:++noticeSerial.current});
  },[]);
  const [visualRound,setVisualRound]=useState<number|null>(null),[background,setBackground]=useState<string|null>(null);
  const lastArtRound=useRef<number|null>(null);
  const onArtReady=useCallback((round:number,url:string)=>{if(lastArtRound.current!==null&&round>lastArtRound.current)playSound('round.next');lastArtRound.current=round;setVisualRound(round);setBackground(url);},[]);
  const pending=useRef<{round:number;answer:string;requestId:string}|null>(null);
  const round=match?.round??0,answered=match?.players.find(p=>p.id===session.user.id)?.answered??false;
  const capacity=match?resolveHealthCapacity(match.difficulty,match.healthCapacity,match.healthEnabled):0;
  const health=match?.players.find(p=>p.id===session.user.id)?.health??capacity,failed=capacity>0&&health===0;
  const complete=match?.status==='finished';
  useEffect(()=>{if(match&&['playing','reveal'].includes(match.status))wasActive.current=true;},[match?.status]);
  useLayoutEffect(()=>{
    if(!complete||!endingBlack.current)return;
    if(match)prepareResultMusic(match.difficulty);
    for(const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]'))dialog.close();
    const instant=failed||!wasActive.current;
    const timeline=gsap.timeline().to(endingBlack.current,{opacity:1,duration:instant?0:reduce?.12:.7,ease:'phigrosFadeIn'});
    timeline.call(()=>{
      if(useStore.getState().matchId===id)useStore.getState().setMatch(null);
      if(window.location.hash===`#/play/${id}`)go(`/results/${id}`);
    },undefined,instant?(failed&&wasActive.current&&!reduce?.8:.12):'>');
    return()=>{timeline.kill();};
  },[complete,failed,id,reduce]);
  useEffect(()=>{
    if(errorStatus!==404)return;
    const controller=new AbortController();
    void api<{status:string}>(`matches/${id}/result`,'GET',undefined,controller.signal).then(saved=>{
      if(!controller.signal.aborted&&['finished','interrupted'].includes(saved.status))go(`/results/${id}`);
    }).catch(()=>{});return()=>controller.abort();
  },[id,errorStatus]);
  const applySnapshot=useCallback((value:MatchView)=>setMatchView(previous=>previous&&previous.id===value.id&&previous.serverNow>value.serverNow?previous:value),[setMatchView]);
  const started=Boolean(match&&now>=match.startsAt),playing=Boolean(match&&match.status==='playing'&&started&&now<match.deadline&&!answered&&!failed);
  useEffect(()=>{if(match)prepareGameMusic();},[Boolean(match)]);
  useEffect(()=>{
    if(complete)stopGameMusic(id);else if(started)startGameMusic(id);
  },[id,started,complete]);
  useEffect(()=>()=>stopGameMusic(id),[id]);
  const noiseNow=match&&!answered&&['reveal','finished'].includes(match.status)?Math.max(now,match.deadline):now;
  const skipFlashAt=skipNoise?.round===round?skipNoise.at:undefined;
  const skipPink=skipFlashAt!==undefined&&!skipNoise?.red;
  useEffect(()=>{
    if(skipFlashAt===undefined)return;
    const timer=setTimeout(()=>setSkipNoise(current=>current?.at===skipFlashAt?{...current,red:true}:current),Math.max(0,skipFlashAt+800-performance.now()));
    return()=>clearTimeout(timer);
  },[skipFlashAt]);
  const canSkip=playing&&match?.mode==='practice'&&!busy&&!skipBusy;
  useEffect(()=>{setSkipArmed(false);},[round,match?.status]);
  useEffect(()=>{
    if(!skipArmed)return;
    const outside=(event:PointerEvent)=>{if(!skipButton.current?.contains(event.target as Node))setSkipArmed(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setSkipArmed(false);};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[skipArmed]);
  async function skip(){
    if(!canSkip||skipPending.current)return;
    if(!skipArmed){setSkipArmed(true);playSound('ui.select');return;}
    skipPending.current=true;setSkipBusy(true);setError('');setSkipNoise({round,at:performance.now()});
    try{applySnapshot(await api<MatchView>(`matches/${id}/skip`,'POST',{round}));setSkipArmed(false);playSound('round.skip');}
    catch(e){setSkipNoise(null);setError(errorMessage(e));}
    finally{skipPending.current=false;setSkipBusy(false);}
  }
  useEffect(()=>{
    if(!abandonArmed)return;
    const outside=(e:PointerEvent)=>{if(!returnButton.current?.contains(e.target as Node))setAbandonArmed(false);};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setAbandonArmed(false);};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[abandonArmed]);
  async function returnChallenge(){
    if(!match||complete||returnPending.current||match.returnBlocked||returnNoiseAt!==null)return;
    if(match.difficulty!=='at'&&!abandonArmed){setAbandonArmed(true);playSound('ui.select');return;}
    returnPending.current=true;setReturnBusy(true);setError('');
    if(match.difficulty==='at')setReturnNoiseAt(now);
    try{applySnapshot(await api<MatchView>(`matches/${id}/return`,'POST'));if(match.difficulty!=='at')playSound('ui.back');}
    catch(e){
      setReturnNoiseAt(null);
      if(e instanceof ApiError&&e.status===404){
        try{
          const saved=await api<{status:string}>(`matches/${id}/result`);
          if(['finished','interrupted'].includes(saved.status)){applySnapshot({...match,status:'finished',serverNow:Date.now()});setError('');return;}
        }catch{/* Keep the challenge visible so the user can retry. */}
        setError('暂时无法结束挑战，请稍后重试。');
      }else setError(errorMessage(e));
    }
    finally{returnPending.current=false;setReturnBusy(false);}
  }
  const returnCovered=returnNoiseAt!==null||Boolean(match?.returnBlocked);
  const returnDeadline=(returnNoiseAt??match?.returnBlockedAt??0)+800;
  const returnPink=returnCovered&&now<returnDeadline;
  const submitStarts=Boolean(started&&!answered&&match&&match.deadline-noiseNow<=5000);
  const submitCovered=skipFlashAt!==undefined||Boolean(submitNoise)||submitStarts;
  const submitRed=!skipPink&&Boolean(submitCovered&&match&&noiseNow>=(submitNoise?.round===round?match.deadline:submitNoise?.deadline??match.deadline));
  const submitFlashing=skipPink||Boolean(playing&&submitCovered&&!submitNoise?.leaving&&match&&match.deadline-now<=800);
  useEffect(()=>{
    if(!match||!capacity||failed||!['playing','reveal'].includes(match.status))return;
    let alive=true;
    const damage=()=>{
      let request:{requestId:string;round:number};
      try{request={requestId:createRequestId(),round};}catch(e){if(alive)setError(errorMessage(e));return;}
      noiseDamagePending.current++;
      const send=()=>api<MatchView>(`matches/${id}/noise-hits`,'POST',request);
      void send().catch(e=>{if(e instanceof ApiError)throw e;return send();}).then(value=>{if((alive||endingBlack.current)&&value.players.find(p=>p.id===session.user.id)?.health===0&&!noiseDeathSounded.current){noiseDeathSounded.current=true;playSound('answer.wrong');}if(alive)applySnapshot(value);}).catch(e=>{if(alive&&!(e instanceof ApiError&&e.status===409))setError(errorMessage(e));}).finally(()=>{noiseDamagePending.current--;});
    };
    const unsubscribe=subscribeNoiseHits(damage);
    const onEnter=(event:KeyboardEvent)=>{
      if(!submitRed||event.key!=='Enter'||event.isComposing||event.keyCode===229||event.ctrlKey||event.altKey||event.metaKey||document.querySelector('dialog[open]'))return;
      const control=event.target instanceof Element?event.target.closest('button,a,input,select,textarea,[contenteditable="true"]'):null;
      if(control&&!control.matches('.submit-answer,.song-input input'))return;
      event.preventDefault();event.stopImmediatePropagation();
      if(!event.repeat)damage();
    };
    document.addEventListener('keydown',onEnter,true);
    return()=>{alive=false;unsubscribe();document.removeEventListener('keydown',onEnter,true);};
  },[id,round,match?.status,capacity,failed,submitRed,applySnapshot]);
  useEffect(()=>{if(submitStarts&&match)setSubmitNoise(previous=>({round,leaving:previous?.round===round?previous.leaving:false,startsAt:match.startsAt,deadline:match.deadline}));},[submitStarts,round,match?.startsAt,match?.deadline]);
  useEffect(()=>{
    if(!submitNoise||visualRound===null||visualRound===submitNoise.round)return;
    setSubmitNoise(previous=>previous?{...previous,leaving:true}:null);
    const timer=setTimeout(()=>setSubmitNoise(null),350);return()=>clearTimeout(timer);
  },[visualRound,submitNoise?.round]);
  useEffect(()=>{if(failed&&noiseDamagePending.current>0&&!noiseDeathSounded.current){noiseDeathSounded.current=true;playSound('answer.wrong');}},[failed]);
  const previousTimeoutSnapshot=useRef<MatchView|null>(null),soundedTimeouts=useRef(new Set<number>());
  useEffect(()=>{
    if(!match)return;
    const previous=previousTimeoutSnapshot.current;previousTimeoutSnapshot.current=match;
    if(previous?.round===match.round&&previous.status==='playing'&&['reveal','finished'].includes(match.status)&&!answered&&match.serverNow>=previous.deadline&&!soundedTimeouts.current.has(match.round)){
      soundedTimeouts.current.add(match.round);playSound('answer.wrong');
    }
  },[match,answered]);
  const current=progress.find(p=>p.round===round);
  useEffect(()=>{
    if(!answered&&!current?.correct&&(match?.status==='reveal'||match?.status==='finished'))showNotice('miss',round);
  },[answered,current?.correct,match?.status,round,showNotice]);
  useEffect(()=>{useStore.getState().setMatch(id);},[id]);
  useEffect(()=>{setAnswer('');setError('');setHints([]);pending.current=null;},[round]);
  useEffect(()=>{
    let alive=true;void api<Progress[]>(`matches/${id}/progress`).then(v=>{if(alive)setProgress(v);}).catch(()=>{});return()=>{alive=false;};
  },[id,round,answered,match?.status]);
  useEffect(()=>{
    if(!started||match?.status==='finished')return;let alive=true;
    void api<Hint[]>(`matches/${id}/rounds/${round}/hints`).then(v=>{if(alive)setHints(v);}).catch(()=>{});return()=>{alive=false;};
  },[id,round,started]);
  async function submit(e:FormEvent) {
    e.preventDefault();if(!playing||submitRed||busy||!answer.trim())return;setBusy(true);setError('');
    try {
      if(!pending.current)playSound('ui.confirm');
      const request=pending.current??{round,answer:answer.trim(),requestId:createRequestId()};pending.current=request;
      const result=await api<{correct:boolean;score:number}>(`matches/${id}/guesses`,'POST',request);
      pending.current=null;
      if(result.correct){if(!noticed.current.has(`${request.round}:perfect`)&&!noticed.current.has(`${request.round}:good`))playSound('answer.correct');showNotice((wrongAttempts.current.get(request.round)??0)===0?'perfect':'good',request.round);}
      else{playSound('answer.wrong');wrongAttempts.current.set(request.round,(wrongAttempts.current.get(request.round)??0)+1);showNotice('bad',request.round);}
      const [savedProgress,snapshot]=await Promise.all([api<Progress[]>(`matches/${id}/progress`),api<MatchView>(`matches/${id}`)]);
      setProgress(savedProgress);applySnapshot(snapshot);
      setError('');
    }catch(e){if(e instanceof ApiError)pending.current=null;setError(errorMessage(e));}finally{setBusy(false);}
  }
  async function reveal(index:number) {
    if(!playing||hintBusy||hints.some(h=>h.index===index))return;
    setHintBusy(true);setError('');
    try{setHints(await api<Hint[]>(`matches/${id}/rounds/${round}/hints/${index}`,'POST'));playSound('ui.select');}catch(e){setError(errorMessage(e));}finally{setHintBusy(false);}
  }
  const visibleHints=match?.difficulty==='ez'?[0,2]:[0,2,1];
  const imageDifficulty=hints.find(h=>h.kind==='downgrade')?.difficulty??match?.difficulty??'ez';
  const seconds=match?Math.max(0,Math.ceil(((match.status==='reveal'?match.nextAt:started?match.deadline:match.startsAt)-now)/1000)):0;
  if(!match)return <section className="loading-scene"><Back onClick={()=>go('/account')}/><p role="status">{loadError||'正在连接挑战…'}</p></section>;
  return <section className="game-screen" aria-label="曲绘猜测">
    {capacity>0&&<><HealthBar key={id} value={health} maxValue={capacity} fullscreenFlash/><DamageFeedback health={health}/></>}
    {background&&<div className="game-art-backdrop" style={{backgroundImage:`url("${background}")`}}/>}
    <button ref={returnButton} className={`back-button challenge-return ${abandonArmed?'abandon-armed':''} ${returnPink?'return-pink':''}`} type="button" disabled={complete||returnBusy||returnCovered} onClick={()=>void returnChallenge()} aria-label={match.difficulty==='at'?'尝试退出挑战':abandonArmed?'确认放弃挑战':'放弃挑战'} aria-expanded={abandonArmed}>
      <ArrowLeft size={38} strokeWidth={1.3}/><span className="abandon-label">放弃？</span>
      {match.difficulty==='at'&&<NoiseArtwork mode="return" target={returnButton} src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E" alt="" showImage={false} startsAt={returnDeadline-800} deadline={returnDeadline} now={now} solved={false} active suspended={!returnCovered} skew={.2679491924}/>}
    </button>
    <SongRail noiseClock={{skipFlashAt,round:match.round,startsAt:match.startsAt,deadline:match.deadline,now:noiseNow}} match={{...match,round:visualRound??match.round,difficulty:imageDifficulty}} progress={progress}
      hintDisabled={!playing||hintBusy||visibleHints.every(i=>hints.some(h=>h.index===i))}
      onHint={()=>void reveal(visibleHints.find(i=>!hints.some(h=>h.index===i))??0)} onSettings={()=>{setSettings(true);playSound('ui.confirm');}}/>
    <div className="game-player-header"><div className="game-score" aria-label="当前分数"><span>SCORE</span><b>{(match.players.find(p=>p.id===session.user.id)?.score??0).toLocaleString()}</b></div><UserChip/></div>
    <Artwork skipFlashAt={skipFlashAt} id={id} round={round} started={started} complete={complete} difficulty={imageDifficulty} onReady={onArtReady} progress={progress} startsAt={match.startsAt} deadline={match.deadline} now={noiseNow} answered={answered} imageKey={imageDifficulty===match.difficulty?match.imageKey:undefined} totalRounds={match.totalRounds}/>
    {round===0&&!started&&!complete&&<div className="round-countdown" aria-live="polite" aria-label={`倒计时 ${seconds}`}>{seconds}</div>}
    <form className="guess-input-row" onSubmit={submit}>
      <div className={`current-difficulty ${imageDifficulty}`}><span>{imageDifficulty.toUpperCase()}</span></div>
      <div className={`song-input ${notice?'has-answer-notice':''}`}><input aria-label="输入歌名" placeholder="输入歌名或别名" maxLength={200} autoComplete="off" disabled={!playing||busy||Boolean(pending.current)} value={answer} onChange={e=>setAnswer(e.target.value)}/><AnswerNotice event={notice} onEnd={serial=>setNotice(current=>current?.serial===serial?null:current)}/></div>
      <button ref={submitButton} className={`submit-answer ${submitCovered?'submit-covered':''} ${submitFlashing?'submit-flashing':''} ${submitNoise?.leaving?'submit-dissolving':''} ${submitRed?'submit-red':''}`} disabled={!playing||submitRed||busy||!answer.trim()}><span>{busy?'提交中':answered?'已提交':'提交'}</span><NoiseArtwork skipFlashAt={skipFlashAt} mode="submit" target={submitButton} src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E" alt="" showImage={false} startsAt={submitNoise?.startsAt??match.startsAt} deadline={submitNoise?.round===round?match.deadline:submitNoise?.deadline??match.deadline} now={noiseNow} solved={false} active={true} suspended={!submitCovered} fadeOut={submitNoise?.leaving} skew={.2679491924} style={{pointerEvents:'none'}}/></button>
    </form>
    <HintStrip indices={visibleHints} hints={hints}/>
    {(error||loadError)&&<p className="game-error" role="alert">{error||loadError}</p>}
    <button ref={skipButton} type="button" className={`round-status ${skipArmed?'skip-armed':''}`} disabled={!canSkip} onClick={()=>void skip()} aria-label={skipArmed?'确认跳过本题，按超时规则扣血':'跳过本题'}><small>{skipArmed?'SKIP?':complete?(failed?'CHALLENGE FAILED':'CHALLENGE COMPLETE'):match.status==='reveal'?'NEXT':started?'TIME LEFT':'READY'}</small>{skipArmed?<SkipForward className="skip-icon"/>:!complete&&<strong>{String(seconds).padStart(2,'0')}<span>s</span></strong>}</button>
    {match.mode==='room'&&<div className="game-bottom"><span>{match.players.filter(p=>p.answered).length} / {match.players.length} 已猜中</span></div>}
    {complete&&createPortal(<div ref={endingBlack} className="game-results-blackout" style={{opacity:failed||!wasActive.current?1:0}} aria-hidden="true"/>,document.body)}
    <Settings open={settings} onClose={()=>setSettings(false)}/>
  </section>;
}
