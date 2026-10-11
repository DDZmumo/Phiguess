import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {go,useReducedMotion} from './hooks';
import {gsap} from './visual';
import {DifficultySelect} from './DifficultySelect';
import {Game} from './Game';
import {Results} from './Results';
import {TutorialScoreRules} from './TutorialScoreRules';
import {TutorialBlackTransition} from './TutorialBlackTransition';
import {PlayRuntimeContext} from './play-runtime';
import {TutorialRuntime,type TutorialAnswerCorrection} from './tutorial-runtime';
import {tutorialSteps,tutorialDamageSteps,TUTORIAL_WRONG_ANSWER_REBUKE,TUTORIAL_SCORE_FAST_FADE_MS,TUTORIAL_SCORE_REDUCED_FADE_MS} from './tutorial-model';
import {characterTransition} from './character-scramble';
import {isNoiseRedAt} from './noise-stage';
import {readTutorialRefresh,writeTutorialRefresh,clearTutorialRefresh} from './tutorial-refresh';
import './tutorial.css';

const targets=['.difficulty-options button[aria-label^="HD"]','.difficulty-setting-actions button','.art-zoom-trigger','.song-rail-hint','.guess-input-row input','.guess-input-row input','.round-status','.submit-answer','.submit-answer','.submit-answer','.art-frame','.challenge-return','.result-reveal-trigger','','.result-continue-nav,.result-summary-confirm',''];
function visibleControls(root:HTMLElement|null,selector:string){
 return root?[...root.querySelectorAll<HTMLElement>(selector)].filter(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity)>.1&&r.width>0&&r.left<innerWidth&&r.right>0&&r.top<innerHeight&&r.bottom>0;}):[];
}
function TutorialSubtitle({step,page,summaryOpen,hintLocation,aliasLesson,dismissed,correction,fastForward,onVisible}:{step:number;page:number;summaryOpen:boolean;hintLocation:boolean;aliasLesson:boolean;dismissed:boolean;correction?:TutorialAnswerCorrection;fastForward:boolean;onVisible:()=>void}){
 const [displayed,setDisplayed]=useState({step,page,summaryOpen,hintLocation,aliasLesson}),copy=useRef<HTMLDivElement>(null),clickHint=useRef<HTMLParagraphElement>(null),reduce=useReducedMotion();
 const [hintHost,setHintHost]=useState<Element|null>(null);
 useEffect(()=>{setHintHost(copy.current?.closest('.tutorial-guide-layer')??null);},[]);
 useEffect(()=>{
  const node=copy.current;if(!node)return;
  const changed=step!==displayed.step||page!==displayed.page||summaryOpen!==displayed.summaryOpen||hintLocation!==displayed.hintLocation||aliasLesson!==displayed.aliasLesson;
  if(changed&&Number(getComputedStyle(node).opacity)<=.01){setDisplayed({step,page,summaryOpen,hintLocation,aliasLesson});return;}
  const duration=fastForward?(reduce?TUTORIAL_SCORE_REDUCED_FADE_MS:TUTORIAL_SCORE_FAST_FADE_MS)/1000:reduce?.08:changed||dismissed?.25:.35;
  const fade=gsap.to(clickHint.current?[node,clickHint.current]:node,{opacity:changed||dismissed?0:1,duration,ease:changed||dismissed?'phigrosFadeOut':'phigrosFadeIn',onComplete:()=>{if(changed)setDisplayed({step,page,summaryOpen,hintLocation,aliasLesson});else if(!dismissed)onVisible();}});
  return()=>{fade.kill();};
 },[step,page,summaryOpen,hintLocation,aliasLesson,displayed,dismissed,reduce,fastForward,onVisible,hintHost]);
 const correctionText=correction?Array.from(characterTransition(TUTORIAL_WRONG_ANSWER_REBUKE,correction.ranks,correction.settled,correction.frame)):[];
 return <><div ref={copy} className="tutorial-subtitle">
  {correction?<p className="tutorial-answer-rebuke" role="status" aria-label={TUTORIAL_WRONG_ANSWER_REBUKE}>{Array.from(TUTORIAL_WRONG_ANSWER_REBUKE,(char,index)=>{
    return <span className="at-warning-character" key={index} aria-hidden="true"><span className="at-warning-character-size">{char}</span><span className="at-warning-character-glyph">{correctionText[index]}</span></span>;
  })}</p>:displayed.step===13?<TutorialScoreRules page={displayed.page}/>:displayed.hintLocation?<><h2>提示显示在这里</h2><p role="status">解锁的提示会显示在这条栏中，按照 1st、2nd、3rd 的顺序排列。</p></>:displayed.aliasLesson?<><h2>也可以输入别名</h2><p role="status">这一首是 Exoplanetary Mirage。<br/>输入「米垃圾」并提交，别名也能正常答对。</p></>:<><h2>{tutorialSteps[displayed.step]![0]}</h2><p role="status">{displayed.step===14&&displayed.summaryOpen?"× 不公布，✓ 公布。两种选择都会返回主界面。":tutorialSteps[displayed.step]![1]}</p></>}
 </div>
 {hintHost&&displayed.step===13&&displayed.page===0&&createPortal(<p ref={clickHint} className="tutorial-score-click-hint">点击可加快显示</p>,hintHost)}
 </>;
}
export function Tutorial({onComplete}:{onComplete:()=>void}){
 const [runtime]=useState(()=>new TutorialRuntime(()=>go('/account'),readTutorialRefresh()));
 const [welcome,setWelcome]=useState(!runtime.welcomeSeen),[welcomeCovered,setWelcomeCovered]=useState(runtime.welcomeSeen);
 const coverWelcome=useCallback(()=>setWelcomeCovered(true),[]),finishWelcome=useCallback(()=>{runtime.event('welcome-finished');setWelcome(false);},[runtime]);
 useSyncExternalStore(runtime.subscribe,runtime.version);
 const cue=useRef<SVGCircleElement>(null),screen=useRef<HTMLDivElement>(null),reduce=useReducedMotion();
 const coarse=matchMedia('(pointer: coarse)').matches;
 const guideHidden=welcome||runtime.blackTransition;
 const correctionRunning=Boolean(runtime.answerCorrection?.running);
 useEffect(()=>()=>runtime.cancelAnswerCorrection(true),[runtime]);
 useEffect(()=>{
  // Read without consuming in the initializer so StrictMode's second initializer restores too.
  clearTutorialRefresh();const save=()=>writeTutorialRefresh(runtime.exportCheckpoint());
  window.addEventListener('beforeunload',save);window.addEventListener('pagehide',save);
  return()=>{window.removeEventListener('beforeunload',save);window.removeEventListener('pagehide',save);clearTutorialRefresh();};
 },[runtime]);
 const hintLocation=runtime.step===3&&runtime.hintLocation;
 const damageComplete=runtime.completed&&tutorialDamageSteps.includes(runtime.step);
 const dismissed=runtime.captionDismissed||runtime.completed&&!hintLocation&&!damageComplete&&![7,13].includes(runtime.step);
 useEffect(()=>{
  if(!hintLocation)return;
  const bar=screen.current?.querySelector('.hint-strip');bar?.classList.add('tutorial-hint-location');
  return()=>{bar?.classList.remove('tutorial-hint-location');};
 },[hintLocation]);
 useEffect(()=>{
  const bar=screen.current?.querySelector<HTMLElement>('.hint-strip');
  if(bar)bar.style.setProperty('--tutorial-glow-opacity',runtime.captionDismissed?'0':'1');
 },[hintLocation,runtime.captionDismissed]);
 useEffect(()=>{if(runtime.scene==='done')onComplete();},[runtime.scene,onComplete]);
 useEffect(()=>{const interval=correctionRunning||runtime.scoreFastForward?40:100;const timer=setInterval(()=>{if(!document.hidden)runtime.tick(interval);},interval);return()=>clearInterval(timer);},[runtime,correctionRunning,runtime.scoreFastForward]);
 useEffect(()=>{
  if(runtime.step===14&&!guideHidden)return;
  const allowed=()=>{
   if(screen.current?.inert||runtime.blackTransition||runtime.completed||runtime.hintLocation||runtime.answerCorrection?.running)return [];
   if(runtime.zoomOpen)return visibleControls(screen.current,'.art-zoom-close');
   if([4,5].includes(runtime.step)||(runtime.step===6&&runtime.aliasLesson))return visibleControls(screen.current,'.song-input input,.submit-answer');
   if([0,1,2,3,6,9,11,12].includes(runtime.step))return visibleControls(screen.current,targets[runtime.step]!).slice(0,1);
   return [];
  };
  const permitted=(target:EventTarget|null)=>target instanceof Element&&(Boolean(target.closest('.tutorial-exit,.mobile-landscape'))||(runtime.step===13&&Boolean(target.closest('.tutorial-rules-advance')))||allowed().some(control=>control.contains(target)));
  const stop=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();};
  const pointer=(event:Event)=>{
   // Let the shared noise stage handle red pixels, including outside the cue.
   if(runtime.step===9&&!runtime.completed&&!screen.current?.inert&&!runtime.blackTransition&&!runtime.zoomOpen&&event instanceof MouseEvent&&event.button===0&&(event.type==='pointerdown'||event.detail>0)&&!(event.target instanceof Element&&event.target.closest('[data-noise-safe]'))&&isNoiseRedAt(event.clientX,event.clientY))return;
   if(!permitted(event.target))stop(event);
  };
  const keyboard=(event:KeyboardEvent)=>{
   if(event.target instanceof Element&&event.target.closest('.tutorial-exit,.mobile-landscape'))return;
   if(event.ctrlKey||event.altKey||event.metaKey||event.key==='Tab'||/^F\d+$/.test(event.key))return;
   if(event.key==='Escape'){
    if(runtime.zoomOpen||(runtime.step===6&&!runtime.aliasLesson&&screen.current?.querySelector('.skip-armed'))||(runtime.step===11&&screen.current?.querySelector('.abandon-armed')))return;
    stop(event);return;
   }
   if(event.key==='Enter'&&runtime.step===9&&!runtime.completed&&!screen.current?.inert)return;
   if(!permitted(event.target))stop(event);
  };
  const focus=()=>{const active=document.activeElement;if(active instanceof HTMLElement&&active.matches('button,input,textarea,select,a,[contenteditable]')&&!permitted(active))active.blur();};
  const wheel=(event:WheelEvent)=>{if(runtime.step!==12)stop(event);};
  // Window capture runs before the noise stage's document capture listeners.
  window.addEventListener('pointerdown',pointer,true);window.addEventListener('click',pointer,true);window.addEventListener('keydown',keyboard,true);window.addEventListener('focusin',focus,true);window.addEventListener('wheel',wheel,{capture:true,passive:false});
  focus();
  return()=>{window.removeEventListener('pointerdown',pointer,true);window.removeEventListener('click',pointer,true);window.removeEventListener('keydown',keyboard,true);window.removeEventListener('focusin',focus,true);window.removeEventListener('wheel',wheel,true);};
 },[runtime,runtime.step,runtime.completed,runtime.zoomOpen,runtime.aliasLesson,runtime.hintLocation,runtime.summaryOpen,guideHidden,correctionRunning]);
 useEffect(()=>{
  if(runtime.step!==10||!coarse||runtime.completed)return;
  const timer=setTimeout(()=>runtime.event('noise-hover'),2500);return()=>clearTimeout(timer);
 },[runtime,runtime.step,runtime.completed,coarse]);
 useEffect(()=>{
  let motion:ReturnType<typeof gsap.to>|undefined,pulse:ReturnType<typeof gsap.to>|undefined,started=false,lastElement:HTMLElement|undefined;
  const locate=()=>{
   const node=cue.current;if(!node)return;
   if(guideHidden||hintLocation||damageComplete||correctionRunning||dismissed||runtime.zoomOpen||runtime.scene==='done'){
    if(!started){gsap.set(node,{opacity:0});started=true;}return;
   }
   const selector=runtime.step===6&&runtime.aliasLesson?'.guess-input-row input':targets[runtime.step];
   const element=selector?visibleControls(screen.current,selector)[0]:undefined;
   if(!element){motion?.kill();pulse?.kill();started=false;lastElement=undefined;gsap.set(node,{opacity:0});return;}if(element!==lastElement){motion?.kill();pulse?.kill();started=false;lastElement=element;}
   const r=element.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
   node.setAttribute('cx',String(x));node.setAttribute('cy',String(y));
   if(started)return;started=true;
   const radius=Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y))+40;
   motion=gsap.fromTo(node,{attr:{r:reduce?18:radius},opacity:reduce?0:.8},{attr:{r:18},opacity:1,duration:reduce?.1:.85,ease:'power3.inOut',onComplete:()=>{
    if(!reduce)pulse=gsap.to(node,{opacity:.25,duration:.55,repeat:-1,yoyo:true,ease:'sine.inOut'});
   }});
  };
  const node=cue.current;if(node&&dismissed){motion=gsap.to(node,{opacity:0,duration:reduce?.08:.3});started=true;}else locate();
  const timer=setInterval(locate,80);return()=>{clearInterval(timer);motion?.kill();pulse?.kill();};
 },[runtime,runtime.step,runtime.zoomOpen,runtime.scene,dismissed,reduce,guideHidden,hintLocation,damageComplete,runtime.aliasLesson,correctionRunning]);
 return <PlayRuntimeContext.Provider value={runtime}>
  <div ref={screen} className="tutorial-real-screen" data-tutorial-step={runtime.step} data-tutorial-phase={hintLocation?'hint-location':runtime.step===6&&runtime.aliasLesson?'alias':'action'} inert={guideHidden}>
   {welcomeCovered&&(runtime.scene==='difficulty'?<DifficultySelect/>:runtime.scene==='game'?<Game key={runtime.snapshot()!.id} id={runtime.snapshot()!.id}/>:<Results key={runtime.resultId} id={runtime.resultId}/>)}
  </div>
  {createPortal(<div className={`tutorial-guide-layer ${runtime.step===13?'tutorial-rule-shade':''}`} style={{visibility:guideHidden?'hidden':undefined}} data-noise-safe>
   {runtime.step===13&&<button type="button" className="tutorial-rules-advance" aria-label="快速显示下一段计分说明" disabled={runtime.scoreFastForward} onClick={()=>runtime.advanceScorePage(reduce)}/>}
   <svg className="tutorial-guide-circle" aria-hidden="true"><circle ref={cue} r="0" opacity="0"/></svg>
   {runtime.scene!=='done'&&<button className="tutorial-exit" aria-label="退出教程" onClick={()=>go('/account')}><X size={22}/></button>}
   {!guideHidden&&!runtime.zoomOpen&&runtime.scene!=='done'&&<aside className={`tutorial-live-coach ${runtime.step===1?'tutorial-top-coach':''} ${runtime.step===13?'tutorial-rules-coach':''}`} aria-label="教学指引">
    <TutorialSubtitle step={runtime.step} page={runtime.scorePage} summaryOpen={runtime.summaryOpen} hintLocation={hintLocation} aliasLesson={runtime.step===6&&runtime.aliasLesson} dismissed={dismissed} correction={runtime.answerCorrection} fastForward={runtime.scoreFastForward} onVisible={runtime.finishScoreAdvance}/>
   </aside>}
  </div>,document.body)}
  {welcome&&<TutorialBlackTransition welcome onCovered={coverWelcome} onFinished={finishWelcome}/>}
  {runtime.blackTransition&&<TutorialBlackTransition onCovered={runtime.coverBlackTransition} onFinished={runtime.finishBlackTransition}/>}
 </PlayRuntimeContext.Provider>;
}
