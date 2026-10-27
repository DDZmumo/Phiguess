import {installMenuMusic,setMenuMusicActive} from './menu-music';
import {APP_VERSION_LABEL} from '../../../packages/contracts/src';
import {installSoundLifecycle,playSound} from './sound';
import { useCallback, useEffect, useLayoutEffect, useRef, useState,type CSSProperties } from 'react';
import { Maximize } from 'lucide-react';
import { useStore } from './store';
import { go, useReducedMotion, useRoute } from './hooks';
import { FadeScene, gsap, Mesh, titleTransitionTiming, useGSAP } from './visual';
import { Hub, MULTIPLAYER_ENABLED } from './Hub';
import { Game } from './Game';
import { Tutorial } from './Tutorial';
import {TutorialEndTransition} from './TutorialEndTransition';
import { Room } from './Room';
import { Results } from './Results';
import { api } from './api';
import { Showcase,useCover } from './Showcase';
import {MobileBackgroundContext} from './mobile-background';
import { DifficultySelect } from './DifficultySelect';
import {MobileLandscape,useMobileDevice,useMobilePortrait} from './MobileLandscape';
import {requestMobileLandscape} from './landscape';
import {useAppViewport} from './use-app-viewport';

function Title() {
  const ref=useRef<HTMLDivElement>(null),busy=useRef(false),reduce=useReducedMotion();
  const {contextSafe}=useGSAP({scope:ref});
  const enter=contextSafe(()=>{
    if(busy.current)return;busy.current=true;playSound('ui.start');void requestMobileLandscape();
    const timing=titleTransitionTiming(reduce);
    gsap.timeline().to(ref.current?.closest('.scene')??ref.current,{opacity:0,duration:timing.exit,ease:'phigrosFadeOut'}).call(()=>go('/account'),undefined,`+=${timing.pause}`);
  });
  return <div ref={ref} className="title-screen">
    <Showcase/><div className="title-shade"/><Mesh/>
    <div className="title-dust" aria-hidden="true">{Array.from({length:24},(_,i)=><i key={i} style={{left:`${48+(i*19)%49}%`,top:`${(i*31)%100}%`,animationDelay:`${-i*.67}s`}}/>)}</div>
    <button className="title-hitbox" onClick={enter} aria-label="点击屏幕开始"/>
    <div className="title-enter" aria-hidden="true"><small>Version : {APP_VERSION_LABEL}</small><strong>Phiguess</strong><span>点击屏幕开始</span></div>
  </div>;
}

export function App() {
  useEffect(installSoundLifecycle,[]);
  useEffect(installMenuMusic,[]);
  const route=useRoute(),outer=useRef<HTMLDivElement>(null),stageWindow=useRef<HTMLDivElement>(null);
  const session=useStore(s=>s.session),brightness=useStore(s=>s.preferences.brightness),reduce=useReducedMotion();
  const mobile=useMobileDevice(),mobilePortrait=useMobilePortrait();
  const cover=useCover(),[sceneBackground,setSceneBackground]=useState<string|null>(null);
  const parts=route.split('/'),screen=parts[1]||'title',accountScreen=screen==='account';
  const sharedBackground=mobile&&['account','room','play','results'].includes(screen);
  const background=screen==='title'||screen==='account'||screen==='room'?cover?.url:sceneBackground;
  useLayoutEffect(()=>{
    const style=document.documentElement.style;
    if(background)style.setProperty('--mobile-safe-background',`url("${background}")`);
    else style.removeProperty('--mobile-safe-background');
    return()=>{style.removeProperty('--mobile-safe-background');};
  },[background]);
  const edgePadding=useStore(s=>s.preferences.mobileEdgePadding??0);
  useLayoutEffect(()=>{
    const value=Number.isFinite(edgePadding)?Math.max(0,Math.min(128,edgePadding)):0;
    document.documentElement.style.setProperty('--mobile-edge-padding',`${value}px`);
    return()=>{document.documentElement.style.removeProperty('--mobile-edge-padding');};
  },[edgePadding]);
  const size=useAppViewport(outer,mobile,accountScreen);
  useLayoutEffect(()=>{
    if(!size.keyboard){stageWindow.current?.scrollTo(0,0);return;}
    document.activeElement?.scrollIntoView({block:'nearest',inline:'nearest'});
  },[size.keyboard,size.visibleHeight,route]);
  useEffect(()=>{if(route==='/difficulty/room'||(!MULTIPLAYER_ENABLED&&route.startsWith('/room/')))go('/account');else if(route!=='/'&&!session&&route!=='/account'&&route!=='/tutorial')go('/account');},[route,session]);
  useEffect(()=>{if(session)void api<NonNullable<typeof session>['user']>('me').then(user=>{const current=useStore.getState().session;if(current?.token===session.token)useStore.getState().setSession({...current,user});}).catch(()=>{});},[session?.token]);
  const menuMusic=screen==='account'||screen==='room';
  useEffect(()=>{
    if(!menuMusic){setMenuMusicActive(false);return;}
    const timer=window.setTimeout(()=>setMenuMusicActive(true),500);
    return()=>{window.clearTimeout(timer);setMenuMusicActive(false);};
  },[menuMusic]);
  const [fullscreenError,setFullscreenError]=useState('');
  const [tutorialEnding,setTutorialEnding]=useState(false);
  const finishTutorial=useCallback(()=>setTutorialEnding(true),[]),clearTutorialEnding=useCallback(()=>setTutorialEnding(false),[]);
  return <MobileBackgroundContext.Provider value={setSceneBackground}><main className={`app-shell ${accountScreen?'account-shell ':''}${reduce?'reduced-motion':''}`} ref={outer} data-mobile={mobile} data-shared-background={sharedBackground} data-keyboard-open={size.keyboard} style={{'--stage-scale':size.scale} as CSSProperties}>
    {sharedBackground?<div className="mobile-shared-background" data-scene={screen} aria-hidden="true" style={{opacity:brightness}}>
      <div className="mobile-shared-image" style={{backgroundImage:background?`url("${background}")`:undefined}}/>
      <div className="mobile-shared-shade"/><Mesh/><div className="mobile-safe-areas"/>
    </div>:mobile&&edgePadding>0&&<div className="mobile-safe-backdrop" aria-hidden="true" style={{backgroundImage:background?`url("${background}")`:undefined,opacity:brightness}}/>}
    <div ref={stageWindow} className="stage-window" style={{width:size.width,height:size.keyboard?size.visibleHeight:size.height}}>
    <div className="stage-holder" inert={mobilePortrait} style={{width:size.width,height:size.height}}>
      <div className="stage" style={{width:size.width/size.scale,height:size.height/size.scale,transform:`scale(${size.scale})`}}>
        <FadeScene scene={screen}>
          {screen!=='title'&&screen!=='difficulty'&&<><div className="ambient-background" style={{opacity:brightness}}/><Mesh/></>}
          {screen==='tutorial'?<Tutorial onComplete={finishTutorial}/>:screen==='title'?<Title/>:screen==='difficulty'&&session?<DifficultySelect/>:screen==='play'&&session?<Game key={parts[2]} id={parts[2]}/>:screen==='room'&&MULTIPLAYER_ENABLED&&session?<Room code={parts[2]}/>:screen==='results'&&session?<Results key={parts[2]} id={parts[2]}/>:<Hub route={route}/>}
        {import.meta.env.VITE_DEMO_CATALOG==='true'&&<div className="demo-label">本地演示 · 合成题图</div>}
        {!mobile&&<button className="fullscreen" aria-label="切换全屏" onClick={()=>{
          if(!document.fullscreenElement&&typeof document.documentElement.requestFullscreen!=='function'){setFullscreenError('当前浏览器不支持全屏');return;}
          const result=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();
          void result.catch(()=>setFullscreenError('当前浏览器不支持全屏'));
        }}><Maximize size={18}/></button>}
        {fullscreenError&&<span className="fullscreen-error" role="status">{fullscreenError}</span>}
        </FadeScene>
      </div>
    </div>
    </div>
    <MobileLandscape required={mobilePortrait}/>
    {tutorialEnding&&<TutorialEndTransition onFinished={clearTutorialEnding}/>}
  </main></MobileBackgroundContext.Provider>;
}
