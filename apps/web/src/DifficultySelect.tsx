import {usePlayRuntime,usePlayApi,usePlayPreferences,usePlayNavigation} from './play-runtime';
import {playSound,stopDifficultySound} from './sound';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft } from 'lucide-react';
import '@fontsource/saira/latin-500.css';
import { INFINITY_ROUNDS, normalizeChallengeSettings, resolveHealthCapacity, roundCountChoices, roundTimeChoices, type Difficulty, type MatchView } from '../../../packages/contracts/src';
import { ApiError, errorMessage } from './api';
import { useReducedMotion, useResource } from './hooks';
import { useStore } from './store';
import { gsap, modeTransitionDuration, useGSAP } from './visual';
import { DIFFICULTIES, DIFFICULTY_END, DIFFICULTY_RENDER_FPS } from './difficulty-motion';
import { DifficultyPainter } from './difficulty-painter';
import { AtChallengeWarning } from './AtChallengeWarning';
import { ROLLING_HANZI } from './difficulty-atlas';
import './difficulty-select.css';

const SETTINGS_TIME=2;
type Phase='choosing'|'centering'|'configuring'|'fading-settings'|'scrambling-return'|'returning-settings'|'returning-labels'|'transition'|'starting'|'leaving-hub'|'error';

export function DifficultySelect(){
  const runtime=usePlayRuntime(),api=usePlayApi(),go=usePlayNavigation();
  const resumeSettings=Boolean(runtime?.challengeSettingsOpen);
  const root=useRef<HTMLElement>(null),canvas=useRef<HTMLCanvasElement>(null),painter=useRef<DifficultyPainter|null>(null);
  const clock=useRef({time:resumeSettings?SETTINGS_TIME:.5}),selectedRef=useRef<Difficulty|null>(resumeSettings?'hd':null),hovered=useRef<Difficulty|null>(null),alive=useRef(true),locked=useRef(resumeSettings),requestBusy=useRef(false);
  const [unit,setUnit]=useState(1.5),[ready,setReady]=useState(false),[selected,setSelected]=useState<Difficulty|null>(resumeSettings?'hd':null);
  const [phase,setPhase]=useState<Phase>(resumeSettings?'configuring':'choosing'),[error,setError]=useState('');
  const [atWarningReady,setAtWarningReady]=useState(false);
  const phaseRef=useRef<Phase>('choosing');phaseRef.current=phase;
  const warningConcealed=useCallback(()=>{if(phaseRef.current==='scrambling-return')setPhase('returning-settings');},[]);
  const settingsPanel=useRef<HTMLFormElement>(null),returnFrom=useRef(SETTINGS_TIME);
  const exitShade=useRef<HTMLDivElement>(null);
  const {preferences,updatePreferences}=usePlayPreferences();
  useEffect(()=>{if(phase==='configuring')runtime?.event('challenge-settings');},[phase,runtime]);
  const reduce=useReducedMotion();
  useEffect(()=>{
    if(phase!=='leaving-hub'||!exitShade.current)return;
    const fade=gsap.to(exitShade.current,{opacity:1,duration:modeTransitionDuration(reduce),ease:'phigrosFadeIn',onComplete:()=>{
      if(runtime||window.location.hash==='#/difficulty')go('/account');
    }});
    return()=>{fade.kill();};
  },[phase,reduce]);
  const {data:active,error:activeError}=useResource<{match:{id:string;mode:string}|null}>('me/active');
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    let mounted=true,resizeFrame=0,observer:ResizeObserver|undefined;
    const resize=()=>{
      if(!root.current||!painter.current)return;
      const {clientWidth:w,clientHeight:h}=root.current;setUnit(w<h?w/600:h/540);
      painter.current.resize();painter.current.draw(requestBusy.current?DIFFICULTY_END:selectedRef.current?clock.current.time:null,selectedRef.current,hovered.current,reduce);
    };
    const onResize=()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(resize);};
    void Promise.all([document.fonts.load('900 216px "Phiguess Difficulty"',ROLLING_HANZI.join('')),document.fonts.load('500 24px Saira')]).then(async()=>{
      if(!mounted||!canvas.current)return;
      const prepared=await DifficultyPainter.create(canvas.current);if(!mounted)return;
      painter.current=prepared;resize();observer=new ResizeObserver(onResize);observer.observe(root.current!);window.addEventListener('resize',onResize);setReady(true);
    }).catch(()=>{if(mounted){setError('难度界面加载未完成，请重试。');setPhase('error');}});
    return()=>{mounted=false;cancelAnimationFrame(resizeFrame);observer?.disconnect();window.removeEventListener('resize',onResize);painter.current=null;};
  },[]);
  useEffect(()=>{
    if(phase==='centering')playSound('ds.select');
    else if(phase==='transition')playSound('ds.transition');
    else if(phase!=='configuring'&&phase!=='fading-settings')stopDifficultySound();
  },[phase]);
  useEffect(()=>stopDifficultySound,[]);
  const start=useCallback(async()=>{
    if(!selected||requestBusy.current)return;
    requestBusy.current=true;
    if(!runtime)painter.current?.draw(DIFFICULTY_END,selected,null,reduce);
    setPhase('starting');setError('');
    try{
      const state=runtime?{preferences:runtime.preferences,updatePreferences:runtime.updatePreferences,setMatch:(_id:string)=>{}}:useStore.getState(),capacity=resolveHealthCapacity(selected,state.preferences.healthCapacity,state.preferences.healthEnabled),options={difficulty:selected,...normalizeChallengeSettings(selected,state.preferences.rounds,state.preferences.roundSeconds),healthEnabled:capacity>0,healthCapacity:capacity};
      state.updatePreferences({difficulty:selected});
      const match=await api<MatchView>('matches/practice','POST',options);if(!alive.current)return;
      playSound(runtime?'ui.confirm':'challenge.start');state.setMatch(match.id);go(`/play/${match.id}`);
    }catch(e){
      if(!alive.current)return;
      if(!runtime&&e instanceof ApiError&&e.payload.matchId){useStore.getState().setMatch(e.payload.matchId);go(`/play/${e.payload.matchId}`);return;}
      setError(errorMessage(e));setPhase('error');
    }finally{requestBusy.current=false;}
  },[selected,reduce]);
  useGSAP(()=>{
    if(!ready||!painter.current)return;
    if(phase==='choosing'){clock.current.time=0;painter.current.draw(null,null,null,reduce);return;}
    if(!selected)return;
    if(phase==='configuring'||phase==='fading-settings'||phase==='scrambling-return'||phase==='returning-settings'){
      clock.current.time=SETTINGS_TIME;painter.current.draw(SETTINGS_TIME,selected,null,reduce);
      if(root.current)root.current.dataset.referenceFrame=String(SETTINGS_TIME*30);
      return;
    }
    if(phase!=='centering'&&phase!=='transition'&&phase!=='returning-labels')return;
    const from=phase==='centering'?0:phase==='returning-labels'?Math.max(.5,returnFrom.current):SETTINGS_TIME,to=phase==='centering'?SETTINGS_TIME:phase==='returning-labels'?.5:DIFFICULTY_END;
    clock.current.time=from;let last=-1;
    const paint=()=>{
      // Cleanup must not rewind the centered label or repaint a finished transition.
      if(requestBusy.current||phaseRef.current!==phase)return;
      const frame=Math.floor(clock.current.time*DIFFICULTY_RENDER_FPS);if(frame===last)return;last=frame;
      if(root.current)root.current.dataset.referenceFrame=String(Math.floor(clock.current.time*30));
      painter.current?.draw(clock.current.time,selected,null,reduce);
    };
    const done=()=>{if(phaseRef.current!==phase)return;if(phase==='centering')setPhase('configuring');else if(phase==='returning-labels'){locked.current=false;selectedRef.current=null;setSelected(null);setPhase('choosing');}else void start();};
    if(reduce){clock.current.time=to;painter.current.draw(to,selected,null,true);gsap.delayedCall(.12,done);return;}
    gsap.fromTo(clock.current,{time:from},{time:to,duration:Math.abs(to-from),ease:'none',onUpdate:paint,onComplete:done});paint();
  },{scope:root,dependencies:[ready,selected,phase,reduce,start],revertOnUpdate:true});
  useGSAP(()=>{
    const backButton=root.current?.querySelector('.difficulty-back');
    if(phase==='choosing'){gsap.fromTo(backButton??null,{opacity:0},{opacity:.48,duration:reduce?.12:.3,ease:'power2.out'});return;}
    if(phase==='returning-labels'){gsap.set(backButton??null,{opacity:0});return;}
    if(phase==='centering'){gsap.to(backButton??null,{opacity:0,duration:reduce?.12:.3,ease:'power2.in'});return;}
    if(phase==='configuring')gsap.fromTo(backButton??null,{opacity:0},{opacity:.48,duration:reduce?.12:.65,ease:'power2.out'});
    const panel=settingsPanel.current;if(!panel)return;
    if(phase==='scrambling-return'){
      gsap.set(panel,{opacity:1,y:0,filter:'blur(0px)'});gsap.set(backButton??null,{opacity:.48});
    }else if(phase==='configuring'){
      gsap.fromTo(panel,{opacity:0,y:8,filter:'blur(8px)'},{opacity:1,y:0,filter:'blur(0px)',duration:reduce?.12:.65,ease:'power2.out'});
    }else if(phase==='fading-settings'||phase==='returning-settings'){
      const fade=gsap.timeline().fromTo(panel,{opacity:1,y:0,filter:'blur(0px)'},{opacity:0,y:0,filter:'blur(10px)',duration:reduce?.12:.45,ease:'power2.in'});
      fade.to(root.current!.querySelector('.difficulty-back'),{opacity:0,duration:reduce?.12:.45,ease:'power2.in'},0);
      fade.call(()=>{
        if(phaseRef.current!==phase)return;
        if(phase==='fading-settings'&&runtime){if(runtime.beginBlackTransition)runtime.beginBlackTransition(start);else void start();}
        else setPhase(phase==='fading-settings'?'transition':'returning-labels');
      },undefined,phase==='fading-settings'&&!runtime?'+=0.5':'>');
    }
  },{scope:root,dependencies:[phase,reduce,start],revertOnUpdate:true});
  const back=useCallback(()=>{
    if(['starting','transition','fading-settings','scrambling-return','returning-settings','returning-labels','leaving-hub'].includes(phase))return;
    playSound('ui.back');
    if(selected){setError('');returnFrom.current=phase==='centering'?clock.current.time:SETTINGS_TIME;setPhase(phase==='configuring'?(selected==='at'?'scrambling-return':'returning-settings'):'returning-labels');}
    else setPhase('leaving-hub');
  },[phase,selected]);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')back();};
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[back]);
  function choose(level:Difficulty){
    if((runtime&&level!=='hd')||phase!=='choosing'||locked.current||!ready||!active||active.match||activeError)return;
    updatePreferences({difficulty:level,...(level==='at'?{healthCapacity:20 as const,healthEnabled:true}:{})});setAtWarningReady(false);
    locked.current=true;selectedRef.current=level;setSelected(level);setPhase('centering');runtime?.event('caption-dismiss');
  }
  function hover(level:Difficulty|null){hovered.current=level;if(phase==='choosing')painter.current?.draw(null,null,level,reduce);}
  const blocked=!ready||!active||Boolean(active.match)||Boolean(activeError)||phase!=='choosing';
  return <section className="difficulty-screen" ref={root} aria-label="剧情难度选择" data-phase={phase} data-difficulty={selected??''} style={{'--du':`${unit}px`} as CSSProperties}>
    <canvas ref={canvas} className="difficulty-canvas" aria-hidden="true"/>
    <h1 className="difficulty-sr-only">选择难度</h1>
    <div className="difficulty-options" role="group" aria-label="选择挑战难度" hidden={phase!=='choosing'&&phase!=='leaving-hub'}>
      {DIFFICULTIES.map(d=><button key={d.id} style={{left:`calc(50% + ${d.x*unit}px)`}} aria-label={`${d.id.toUpperCase()} ${d.name}`} disabled={blocked||Boolean(runtime&&d.id!=='hd')} onPointerEnter={()=>hover(d.id)} onPointerLeave={()=>hover(null)} onFocus={()=>hover(d.id)} onBlur={()=>hover(null)} onClick={()=>choose(d.id)}><span className="difficulty-sr-only">{d.id.toUpperCase()} · {d.name}</span></button>)}
    </div>
    {selected&&(phase==='configuring'||phase==='fading-settings'||phase==='scrambling-return'||phase==='returning-settings')&&<form ref={settingsPanel} className={`difficulty-challenge-settings ${selected==='at'?'at-challenge-warning':''}`} aria-label={selected==='at'?'AT挑战警告':'挑战设置'} onSubmit={e=>{e.preventDefault();if(phase==='configuring'&&(selected!=='at'||atWarningReady)){runtime?.event('caption-dismiss');setPhase('fading-settings');}}}>
      <h2>{selected==='at'?'警告':'挑战设置'}</h2>
      <fieldset disabled={phase!=='configuring'}>
        {selected==='at'?<AtChallengeWarning capacity={preferences.healthCapacity===50?50:20} reduce={reduce} concealing={phase==='scrambling-return'||phase==='returning-settings'} onReady={setAtWarningReady} onConcealed={warningConcealed} onChange={capacity=>{if(capacity!==preferences.healthCapacity){updatePreferences({healthCapacity:capacity,healthEnabled:true});playSound('ui.select');}}}/>:<>
        <div className="difficulty-setting-row"><span>题数</span><div className="difficulty-setting-values" role="group" aria-label="题数">{roundCountChoices(selected).map(n=><button type="button" key={n} disabled={Boolean(runtime&&n!==5)} aria-pressed={preferences.rounds===n} onClick={()=>{if(preferences.rounds!==n){updatePreferences({rounds:n});playSound('ui.select');}}}>{n===INFINITY_ROUNDS?'Infinity':`${n} 题`}</button>)}</div></div>
        <div className="difficulty-setting-row"><span>每题时长</span><div className="difficulty-setting-values" role="group" aria-label="每题时长">{roundTimeChoices(selected).map(n=><button type="button" key={n} disabled={Boolean(runtime&&n!==30)} aria-pressed={preferences.roundSeconds===n} onClick={()=>{if(preferences.roundSeconds!==n){updatePreferences({roundSeconds:n});playSound('ui.select');}}}>{n} 秒</button>)}</div></div>
        {selected!=='ez'&&<div className="difficulty-setting-row"><span>血条</span><div className="difficulty-setting-values" role="group" aria-label="血条">{([0,20,50] as const).map(capacity=><button type="button" key={capacity} disabled={Boolean(runtime&&capacity!==20)} aria-pressed={resolveHealthCapacity(selected,preferences.healthCapacity,preferences.healthEnabled)===capacity} onClick={()=>{if(resolveHealthCapacity(selected,preferences.healthCapacity,preferences.healthEnabled)!==capacity){updatePreferences({healthCapacity:capacity,healthEnabled:capacity>0});playSound('ui.select');}}}>{capacity===0?'关闭':`${capacity}HP`}</button>)}</div></div>}
        </>}
        <div className="difficulty-setting-actions"><button type="submit" disabled={selected==='at'&&!atWarningReady}>确认并开始</button></div>
      </fieldset>
    </form>}
    <button className="difficulty-back" aria-label={selected?'返回难度选择':'返回游戏'} disabled={['centering','starting','transition','fading-settings','scrambling-return','returning-settings','returning-labels','leaving-hub'].includes(phase)} onClick={back}><ArrowLeft size={28} strokeWidth={1.3}/></button>
    <span className="difficulty-sr-only" role="status">{selected?`${DIFFICULTIES.find(d=>d.id===selected)!.name} · ${selected.toUpperCase()}，${phase==='starting'?'正在进入挑战':'难度已选择'}`:'请选择一个难度'}</span>
    {(error||activeError||active?.match)&&<div className="difficulty-notice" role="alert">
      <p>{error||activeError||'你还有未完成的挑战。'}</p>
      {active?.match?<button onClick={()=>go(`/play/${active.match!.id}`)}>继续上次挑战</button>:<button onClick={()=>{if(selected)void start();else location.reload();}}>重试</button>}
    </div>}
    <div ref={exitShade} className="difficulty-exit-shade" aria-hidden="true"/>
  </section>;
}
