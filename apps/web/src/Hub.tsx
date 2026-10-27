import {playSound} from './sound';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, LogOut, Settings, X } from 'lucide-react';
import { type RoomView } from '../../../packages/contracts/src';
import { api, ApiError, errorMessage, uploadAvatar } from './api';
import { go, useReducedMotion } from './hooks';
import {setMenuMusicActive} from './menu-music';
import { useStore, type Session } from './store';
import { Avatar, gsap, modeTransitionDuration, titleTransitionTiming, useGSAP } from './visual';
import { useCover } from './Showcase';
import { HubBackdrop } from './HubBackdrop';
import {SettingsPanel,SettingSwitch} from './Settings';
import { Leaderboard } from './Leaderboard';
import {useSlidingTabs} from './use-sliding-tabs';
import {useRoomNavigationFade} from './use-room-navigation-fade';
import {AnswerTint} from './AnswerNotice';
import {clearRoomNotice,readRoomNotice} from './room-removal';

const labels={practice:'单人游戏',room:'多人房间'};
export const MULTIPLAYER_ENABLED=import.meta.env.VITE_MULTIPLAYER_ENABLED!=='false';
type HubTab='game'|'board'|'settings';
export function Hub({route='/account'}:{route?:string}) {
  const session=useStore(s=>s.session),setSession=useStore(s=>s.setSession),preferences=useStore(s=>s.preferences);
  const setMatch=useStore(s=>s.setMatch),setRoom=useStore(s=>s.setRoom),matchId=useStore(s=>s.matchId),roomCode=useStore(s=>s.roomCode);
  const inRoom=MULTIPLAYER_ENABLED&&Boolean(session&&roomCode);
  const tab:HubTab=route==='/account/leaderboard'?'board':route==='/account/settings'?'settings':'game';
  const [mode,setMode]=useState<'practice'|'room'>(inRoom?'room':'practice');
  const [contentExpanded,setContentExpanded]=useState(false),[scopeExpanded,setScopeExpanded]=useState(false);
  const [roomArtworkSelected,setRoomArtworkSelected]=useState(false),[createArmed,setCreateArmed]=useState(false),[joinPhase,setJoinPhase]=useState<'idle'|'sweeping'|'input'|'returning'>('idle'),[joinCode,setJoinCode]=useState('');
  const roomContentSelected=inRoom||roomArtworkSelected;
  const roomActionsExpanded=contentExpanded&&mode==='room'&&roomContentSelected;
  const [roomAbandonArmed,setRoomAbandonArmed]=useState(false),roomAbandonButton=useRef<HTMLButtonElement>(null);
  const joinInput=useRef<HTMLInputElement>(null),joinButton=useRef<HTMLButtonElement>(null),createButton=useRef<HTMLButtonElement>(null);
  const joinEntry=useRef<HTMLDivElement>(null),joinAnimations=useRef<Animation[]>([]),joinIntent=useRef(false),joinRestoreFocus=useRef(false);
  const scopeChoices=[['main','主线'],['non-main','非主线'],['removed','已删除'],['april-fools','愚人节']] as const;
  const savedScopes=preferences.artworkScopes??scopeChoices.map(([key])=>key);
  const scopes=savedScopes.some(key=>key==='main'||key==='non-main')?savedScopes:[...savedScopes,'main' as const];
  useEffect(()=>{if(preferences.artworkScopes&&!preferences.artworkScopes.some(key=>key==='main'||key==='non-main'))useStore.getState().updatePreferences({artworkScopes:[...preferences.artworkScopes,'main']});},[preferences.artworkScopes]);
  const [boardVisited,setBoardVisited]=useState(tab==='board');
  const [footerExpanded,setFooterExpanded]=useState(false),[footerActivity,setFooterActivity]=useState(0);
  const [returningTitle,setReturningTitle]=useState(false);
  const [name,setName]=useState(session?.user.name||''),[editing,setEditing]=useState(!session),[pending,setPending]=useState(false),[error,setError]=useState(readRoomNotice);
  useEffect(()=>{
    clearRoomNotice();const notice=(event:Event)=>{setError((event as CustomEvent<string>).detail);clearRoomNotice();};
    window.addEventListener('phiguess:room-removed',notice);return()=>window.removeEventListener('phiguess:room-removed',notice);
  },[]);
  const [authMode,setAuthMode]=useState<'guest'|'login'>('guest'),[password,setPassword]=useState(''),[loginOpen,setLoginOpen]=useState(false);
  const showAuth=!session||loginOpen;
  const avatarInput=useRef<HTMLInputElement>(null);
  const root=useRef<HTMLElement>(null),card=useRef<HTMLElement>(null),gamePanel=useRef<HTMLDivElement>(null),boardPanel=useRef<HTMLDivElement>(null),settingsPanel=useRef<HTMLDivElement>(null);
  const launchShade=useRef<HTMLDivElement>(null),launchLocked=useRef(false);
  const [launchPhase,setLaunchPhase]=useState<'idle'|'armed'|'leaving'>('idle'),reduce=useReducedMotion();
  const roomFade=useRoomNavigationFade(reduce);
  const cover=useCover(),[checkingActive,setCheckingActive]=useState(Boolean(session));
  useEffect(()=>{
    if(!footerExpanded)return;
    const timer=setTimeout(()=>setFooterExpanded(false),5000);
    return()=>clearTimeout(timer);
  },[footerExpanded,footerActivity]);
  const {phase:tabPhase,prepare:prepareTab}=useSlidingTabs(root,[gamePanel,boardPanel,settingsPanel],tab==='game'?0:tab==='board'?1:2,reduce);
  const {contextSafe}=useGSAP({scope:root});
  const returnTitle=contextSafe(()=>{
    if(launchLocked.current)return;
    launchLocked.current=true;setReturningTitle(true);playSound('ui.back');
    const timing=titleTransitionTiming(reduce);
    gsap.timeline().to(root.current!.closest('.scene'),{opacity:0,duration:timing.exit,ease:'phigrosFadeOut'}).call(()=>go('/'),undefined,`+=${timing.pause}`);
  });
  useEffect(()=>{if(tab==='board')setBoardVisited(true);},[tab]);
  function switchTab(next:HubTab){
    if(next===tab||launchLocked.current)return;playSound('ui.select');
    setRoomAbandonArmed(false);
    if(next==='board')setBoardVisited(true);
    prepareTab();
    go(next==='game'?'/account':next==='board'?'/account/leaderboard':'/account/settings');
  }
  useEffect(()=>{if(!session)setEditing(true);},[session]);
  useEffect(()=>{
    if(!session){setCheckingActive(false);return;}let alive=true;setCheckingActive(true);
    const refresh=()=>void api<{match:{id:string;mode:string}|null}>('me/active').then(active=>{if(alive){setMatch(active.match?.id??null);setCheckingActive(false);}}).catch(()=>{if(alive)setCheckingActive(true);});
    refresh();const timer=setInterval(refresh,5000);return()=>{alive=false;clearInterval(timer);};
  },[session?.token,setMatch]);
  useEffect(()=>{
    if(!MULTIPLAYER_ENABLED||!roomCode||!session)return;
    const token=session.token,roomEpoch=useStore.getState().roomEpoch,ctrl=new AbortController();
    void api<RoomView>(`rooms/${roomCode}`,'GET',undefined,ctrl.signal).catch(e=>{
      if(ctrl.signal.aborted)return;
      const current=useStore.getState();
      if(e instanceof ApiError&&[403,404].includes(e.status)&&current.roomCode===roomCode&&current.roomEpoch===roomEpoch&&current.session?.token===token)setRoom(null);
    });
    return()=>ctrl.abort();
  },[roomCode,session?.token,setRoom]);
  useEffect(()=>{
    setRoomAbandonArmed(false);
    if(!inRoom)return;
    setMode('room');setRoomArtworkSelected(true);setCreateArmed(false);cancelJoin();setScopeExpanded(false);setLaunchPhase('idle');
  },[inRoom,roomCode,session?.token]);
  useEffect(()=>{
    if(!roomAbandonArmed||pending)return;
    const dismiss=(event:PointerEvent)=>{if(event.target instanceof Node&&!roomAbandonButton.current?.contains(event.target))setRoomAbandonArmed(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setRoomAbandonArmed(false);};
    document.addEventListener('pointerdown',dismiss,true);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',dismiss,true);document.removeEventListener('keydown',escape);};
  },[roomAbandonArmed,pending]);
  useEffect(()=>{
    if(launchPhase!=='leaving'||!launchShade.current)return;
    const fade=gsap.to(launchShade.current,{opacity:1,duration:modeTransitionDuration(reduce),ease:'phigrosFadeIn',onComplete:()=>{
      if(useStore.getState().session?.token===session?.token&&window.location.hash==='#/account')go('/difficulty');
    }});
    return()=>{fade.kill();};
  },[launchPhase,reduce,session?.token]);
  useEffect(()=>{
    if(launchPhase!=='armed')return;
    const dismiss=(event:PointerEvent)=>{
      if(launchLocked.current)return;
      if(event.target instanceof Node&&!root.current?.querySelector('.hub-artwork-option')?.contains(event.target)&&!root.current?.querySelector('#hub-artwork-scopes')?.contains(event.target)){setLaunchPhase('idle');setScopeExpanded(false);}
    };
    document.addEventListener('pointerdown',dismiss,true);
    return()=>document.removeEventListener('pointerdown',dismiss,true);
  },[launchPhase]);
  useEffect(()=>{
    if(!createArmed||pending)return;
    const dismiss=(event:PointerEvent)=>{if(event.target instanceof Node&&!createButton.current?.contains(event.target))setCreateArmed(false);};
    document.addEventListener('pointerdown',dismiss,true);return()=>document.removeEventListener('pointerdown',dismiss,true);
  },[createArmed,pending]);
  useEffect(()=>{if(joinPhase==='input'&&roomActionsExpanded)joinInput.current?.focus({preventScroll:true});},[joinPhase,roomActionsExpanded]);
  useLayoutEffect(()=>{
    const stop=()=>{for(const animation of joinAnimations.current)animation.cancel();joinAnimations.current=[];};
    const finish=(open:boolean)=>{
      if(joinIntent.current!==open)return;
      setJoinPhase(open?'input':'idle');
      if(!open&&joinRestoreFocus.current){joinRestoreFocus.current=false;requestAnimationFrame(()=>joinButton.current?.focus({preventScroll:true}));}
    };
    if(joinPhase==='idle'||joinPhase==='input'||reduce){
      stop();
      if(reduce&&(joinPhase==='sweeping'||joinPhase==='returning'))finish(joinIntent.current);
      return;
    }
    const entry=joinEntry.current;if(!entry)return;
    const form=entry.querySelector<HTMLElement>('.hub-room-join-form'),trigger=joinButton.current,tint=entry.querySelector<HTMLElement>('.input-answer-reveal'),line=entry.querySelector<HTMLElement>('.input-answer-sweep');
    if(!form||!trigger||!tint||!line)return;
    const open=joinIntent.current;
    // Read the visible position before cancelling: eased time is not distance.
    const style=getComputedStyle(line),width=parseFloat(style.width);
    const current=joinAnimations.current.length&&width>0?Math.max(0,Math.min(1,1+new DOMMatrixReadOnly(style.transform).m41/width)):(open?0:1);
    stop();
    const target=open?1:0,distance=Math.abs(target-current);
    if(distance<.0001){finish(open);return;}
    const duration=480*distance;
    const options:KeyframeAnimationOptions={duration,easing:'cubic-bezier(.77,0,.175,1)',direction:open?'normal':'reverse',fill:'both'};
    const positions=open?[current,target]:[target,current];
    const reveal=positions.map(progress=>({clipPath:`inset(0 ${(1-progress)*100}% 0 0)`}));
    const animations=[form.animate(reveal,options),trigger.animate(positions.map(progress=>({clipPath:`inset(0 0 0 ${progress*100}%)`})),options),tint.animate(reveal,options),line.animate(positions.map(progress=>({transform:`translateX(${(progress-1)*100}%)`})),options)];
    animations.forEach((animation,index)=>{animation.id=`join-sweep-${index}`;animation.pause();animation.currentTime=0;});
    joinAnimations.current=animations;
    const master=animations[0]!;
    master.onfinish=()=>{if(joinAnimations.current[0]===master)finish(open);};
    for(const animation of animations)animation.play();
  },[joinPhase,reduce]);
  useEffect(()=>()=>{for(const animation of joinAnimations.current)animation.cancel();joinAnimations.current=[];},[]);
  useEffect(()=>{
    if(joinPhase==='idle'||pending)return;
    const dismiss=(event:PointerEvent)=>{if(event.target instanceof Node&&!joinEntry.current?.contains(event.target))cancelJoin();};
    document.addEventListener('pointerdown',dismiss,true);return()=>document.removeEventListener('pointerdown',dismiss,true);
  },[joinPhase,pending,reduce]);
  function cancelJoin(restoreFocus=false){
    if(!joinIntent.current)return;
    joinIntent.current=false;joinRestoreFocus.current=restoreFocus;
    if(document.activeElement===joinInput.current)joinInput.current?.blur();
    setJoinPhase(reduce?'idle':'returning');
    if(reduce&&restoreFocus)requestAnimationFrame(()=>joinButton.current?.focus({preventScroll:true}));
  }
  function resetRoomActions(){setCreateArmed(false);setRoomAbandonArmed(false);cancelJoin();}
  function beginJoin(){
    if(pending||inRoom)return;
    if(joinIntent.current){cancelJoin();playSound('ui.select');return;}
    joinIntent.current=true;joinRestoreFocus.current=false;setCreateArmed(false);setError('');setJoinPhase(reduce?'input':'sweeping');playSound('ui.select');
  }
  function chooseMode(nextMode:'practice'|'room'){
    if(nextMode==='room'&&!MULTIPLAYER_ENABLED)return;
    if(nextMode==='practice'&&inRoom)return;
    setContentExpanded(mode===nextMode?!contentExpanded:true);setMode(nextMode);
    setRoomArtworkSelected(nextMode==='room'&&inRoom);resetRoomActions();setScopeExpanded(false);setLaunchPhase('idle');setError('');playSound('ui.select');
  }
  async function profile(e:FormEvent) {
    e.preventDefault();if(!name.trim()||pending)return;
    if(showAuth&&authMode==='login'&&(password.length<8||password.length>128)){setError('密码需为 8–128 个字符。');return;}
    setPending(true);setError('');
    try {
      if(showAuth){
        if(authMode==='login')setSession(await api<Session>('auth/login','POST',{name:name.trim(),password}));
        else if(!session)setSession(await api<Session>('auth/guest','POST',{name:name.trim()}));
        setLoginOpen(false);setPassword('');
      }else if(session){const user=await api<Session['user']>('me/name','POST',{name:name.trim()});setSession({...session,user});}
      setEditing(false);playSound(showAuth?'ui.notice':'ui.confirm');
    }catch(e){setError(errorMessage(e));}finally{setPending(false);}
  }
  async function enterJoinedRoom(code:string){
    const token=session?.token,current=useStore.getState();
    if(!token||current.session?.token!==token||current.roomCode&&current.roomCode!==code)return;
    setRoom(code);
    if(await roomFade.cover()){
      const latest=useStore.getState();
      if(latest.session?.token===token&&latest.roomCode===code)go(`/room/${code}`);
      else await roomFade.reveal();
    }
  }
  async function start(nextMode:'practice'|'room'=mode) {
    if(nextMode==='room'&&!MULTIPLAYER_ENABLED)return;
    if(inRoom){if(nextMode==='room')await returnRoom();return;}
    if(!session){setEditing(true);setError('先填写昵称，建立你的玩家档案。');return;}
    if(pending||checkingActive||matchId||launchLocked.current)return;
    if(nextMode==='practice'){
      if(launchPhase==='idle'){setLaunchPhase('armed');playSound('ui.select');return;}
      launchLocked.current=true;setMenuMusicActive(false);setLaunchPhase('leaving');playSound('ui.confirm');return;
    }
    setPending(true);setError('');
    try {
      const room=await api<RoomView>('rooms','POST',{difficulty:preferences.difficulty,artworkScopes:preferences.artworkScopes,rounds:preferences.rounds,roundSeconds:preferences.roundSeconds,healthEnabled:preferences.healthEnabled??true,healthCapacity:preferences.healthCapacity});
      playSound('ui.confirm');await enterJoinedRoom(room.code);
    }catch(e){if(e instanceof ApiError&&e.payload.matchId)setMatch(e.payload.matchId);setError(errorMessage(e));}finally{setPending(false);}
  }
  async function joinRoom(event:FormEvent){
    event.preventDefault();
    if(!MULTIPLAYER_ENABLED||inRoom||joinPhase!=='input'||pending||checkingActive||matchId||launchLocked.current)return;
    if(!session){setEditing(true);setError('先填写昵称，建立你的玩家档案。');return;}
    const code=joinCode.trim().toUpperCase();if(!/^[A-Z2-9]{6}$/.test(code))return;
    setPending(true);setError('');
    try{
      const room=await api<RoomView>(`rooms/${code}/join`,'POST');
      playSound('ui.confirm');await enterJoinedRoom(room.code);
    }catch(e){setError(e instanceof ApiError&&e.status===404?'房间不存在或已关闭，请检查房间码。':errorMessage(e));}finally{setPending(false);}
  }
  async function returnRoom() {
    if(!MULTIPLAYER_ENABLED||!session||!roomCode||pending)return;setPending(true);setError('');
    const roomEpoch=useStore.getState().roomEpoch;
    try{
      await api<RoomView>(`rooms/${roomCode}`);
      const current=useStore.getState();
      if(current.roomCode===roomCode&&current.roomEpoch===roomEpoch&&current.session?.token===session.token)await enterJoinedRoom(roomCode);
    }catch(e){
      const current=useStore.getState();
      if(e instanceof ApiError&&[403,404].includes(e.status)){
        if(current.roomCode===roomCode&&current.roomEpoch===roomEpoch&&current.session?.token===session.token)setRoom(null);
      }else setError(errorMessage(e));
    }finally{setPending(false);}
  }
  async function abandonRoom(){
    if(!inRoom||!session||!roomCode||pending)return;
    if(!roomAbandonArmed){setRoomAbandonArmed(true);playSound('ui.select');return;}
    const roomEpoch=useStore.getState().roomEpoch;
    setPending(true);setError('');
    try{
      try{await api(`rooms/${roomCode}/leave`,'POST');}
      catch(e){if(!(e instanceof ApiError&&[403,404].includes(e.status)))throw e;}
      if(await roomFade.cover()){
        const current=useStore.getState();
        if(current.roomCode===roomCode&&current.roomEpoch===roomEpoch&&current.session?.token===session.token)setRoom(null);
        setRoomAbandonArmed(false);setCreateArmed(false);playSound('ui.back');await roomFade.reveal();
      }
    }catch(e){setError(errorMessage(e));}finally{setPending(false);}
  }
  async function avatar(file:File|undefined) {
    if(!file||!session)return;
    if(file.size>3*1024*1024){setError('头像图片不能超过 3MB。');return;}
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){setError('请选择 PNG、JPEG 或 WebP 图片。');return;}
    setPending(true);setError('');
    try{const result=await uploadAvatar(file);setSession({...session,user:{...session.user,...result}});}catch(e){setError(errorMessage(e));}finally{setPending(false);}
  }
  const navIndex=tab==='settings'?2:tab==='board'?1:0;
  return <section ref={root} className="account-screen account-refresh" data-room-member={inRoom} data-launch-phase={launchPhase} data-returning-title={returningTitle} data-tab={tab} data-tab-transition={tabPhase} aria-label="账号主界面" style={cover?{backgroundImage:`url("${cover.url}")`}:undefined}>
    <HubBackdrop root={root} card={card} clearWindow={tab==='game'||tabPhase==='sliding'} trackMovement={tabPhase==='sliding'}/>
    <nav className="hub-nav" aria-label="主界面导航">
      <button className={tab==='game'?'active':''} aria-current={tab==='game'?'page':undefined} onClick={()=>switchTab('game')}><span>游戏</span></button>
      <button className={tab==='board'?'active':''} aria-current={tab==='board'?'page':undefined} onClick={()=>switchTab('board')}><span>排行榜</span></button>
      <button className={tab==='settings'?'active':''} aria-current={tab==='settings'?'page':undefined} onClick={()=>switchTab('settings')}><span>设置</span></button>
      <div className="hub-nav-active" aria-hidden="true" style={{clipPath:`inset(0 ${(2-navIndex)*100/3}% 0 ${navIndex*100/3}%)`}}><span>游戏</span><span>排行榜</span><span>设置</span></div>
    </nav>
    <div className="hub-content">
      <div ref={gamePanel} className="hub-tab-panel" aria-hidden={tab!=='game'} inert={tab!=='game'||tabPhase!=='idle'}>
        <header className="hub-section-heading"><h1>玩家信息<span className="hub-heading-english">PLAYER INFO</span></h1><div className="hub-profile-actions">{session&&session.user.accountType!=='account'&&!loginOpen&&<button className="slant white small" onClick={()=>{playSound('ui.select');setAuthMode('login');setLoginOpen(true);setPassword('');setError('');}}><span>登录账号</span></button>}<button className="slant white small" onClick={()=>{playSound('ui.select');setName(session?.user.name||'');setEditing(true);}}><span>{session?'编辑资料':'建立档案'}</span></button></div></header>
        <section ref={card} className={`hub-profile ${showAuth?'hub-profile-auth':''}`} aria-label="玩家资料卡片">
          <div className="hub-profile-main">
            <button className="hub-avatar" aria-label="上传玩家头像" disabled={!session||pending} onClick={()=>avatarInput.current?.click()} title={session?'上传或更换头像':'先建立玩家档案'}><Avatar user={session?.user}/><span className="hub-avatar-label">更换</span></button>
            <input ref={avatarInput} hidden aria-label="头像图片文件" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{void avatar(e.target.files?.[0]);e.target.value='';}}/>
            <div className="hub-identity">
              <span className="hub-player-kind">{session&&!loginOpen?(session.user.accountType==='account'?'PLAYER / 已登录':'PLAYER / 游客'):'WELCOME / 玩家身份'}</span>
              {showAuth?<form className={`hub-auth-form ${authMode==='guest'?'guest-mode':''}`} onSubmit={profile}>
                <div className="hub-auth-modes" role="group" aria-label="身份方式"><button type="button" aria-pressed={authMode==='guest'} disabled={pending} onClick={()=>{if(authMode!=='guest')playSound('ui.select');setAuthMode('guest');setPassword('');setError('');}}>游客</button><button type="button" aria-pressed={authMode==='login'} disabled={pending} onClick={()=>{if(authMode!=='login')playSound('ui.select');setAuthMode('login');setError('');}}>登录</button></div>
                <div className="hub-auth-fields"><input aria-label="玩家名" placeholder="玩家名" autoComplete="username" maxLength={24} required value={name} disabled={pending} onChange={e=>setName(e.target.value)}/>{authMode==='login'&&<input aria-label="密码" placeholder="密码（8–128 位）" type="password" autoComplete="current-password" minLength={8} maxLength={128} required value={password} disabled={pending} onChange={e=>setPassword(e.target.value)}/>}<button type="submit" className="hub-auth-submit" disabled={pending||!name.trim()||(authMode==='login'&&password.length<8)}>{pending?'请稍候':authMode==='login'?'登录 / 注册':'游客进入'}</button>{session&&<button type="button" disabled={pending} onClick={()=>{playSound('ui.back');setLoginOpen(false);setPassword('');setError('');}}>取消</button>}</div>
                <small className="hub-auth-help">{authMode==='login'?'未注册的玩家名将自动注册，已注册则验证密码登录。':'游客也可参加排行榜，身份保存在当前浏览器。'}</small>
              </form>:editing?<form onSubmit={profile}><input aria-label="玩家昵称" placeholder="输入玩家昵称" maxLength={24} value={name} onChange={e=>setName(e.target.value)}/><button type="submit" aria-label="保存玩家昵称" disabled={pending||!name.trim()}><Check size={24}/></button></form>:<strong>{session?.user.name}</strong>}
              <span className="hub-player-id">{session&&!loginOpen?`ID  ${session.user.id.slice(0,12)}`:''}</span>
            </div>
            {session&&!loginOpen&&<button type="button" className="hub-signout" onClick={async()=>{try{await api('auth/logout','POST');playSound('ui.back');setSession(null);setName('');setPassword('');setLoginOpen(false);}catch(e){setError(errorMessage(e));}}} aria-label="退出当前玩家身份"><span className="hub-profile-action-label"><LogOut size={17}/><span>登出</span></span></button>}
            <div className="hub-tutorial-actions">
              <SettingSwitch className="hub-skip-transition" label="跳过难度选择过场" checked={preferences.skipDifficultyTransition??false} onChange={skipDifficultyTransition=>useStore.getState().updatePreferences({skipDifficultyTransition})}/>
              <button type="button" className="hub-tutorial-entry" onClick={()=>go('/tutorial')} aria-label="新手教程"><span className="hub-profile-action-label">新手教程<ArrowRight size={18} aria-hidden="true"/></span></button>
            </div>
          </div>
        </section>
        <div className="hub-play-area hub-play-centered">
          <section className="hub-mode-column"><h2>选择模式<span>MODE</span></h2><div className="hub-mode-list" aria-label="选择游戏模式">
            {(['practice','room'] as const).map((m,i)=>{
              const expanded=contentExpanded&&mode===m;
              return <button key={m} className={`hub-mode ${expanded?'selected is-armed is-mode-chosen':''} ${(m==='room'&&!MULTIPLAYER_ENABLED)||(m==='practice'&&inRoom)?'unavailable':''}`} aria-pressed={expanded} aria-expanded={expanded} aria-controls="hub-content-options" disabled={(m==='room'&&!MULTIPLAYER_ENABLED)||(m==='practice'&&inRoom)||pending||(!(m==='room'&&inRoom)&&(checkingActive||Boolean(matchId)))||launchPhase==='leaving'} onClick={()=>chooseMode(m)}>
                <span className="hub-mode-index">0{i+1}</span><span className="hub-mode-name"><strong>{m==='room'&&!MULTIPLAYER_ENABLED?'多人房间（待开发）':labels[m]}</strong><small>{m==='room'&&!MULTIPLAYER_ENABLED?'正在绝赞开发中... ...':inRoom?(m==='practice'?'退出房间后可游玩':`已加入房间 ${roomCode}`):'选择游玩内容'}</small></span>
                <span className="hub-mode-arrow has-start" aria-hidden="true"><span className="hub-mode-start-sweep"><span className="hub-mode-start-label">选中</span>{expanded?<Check size={25}/>:<ArrowRight size={25}/>}</span></span>
              </button>;
            })}
          </div>
          <div id="hub-content-options" className="hub-solo-options" data-expanded={contentExpanded} aria-hidden={!contentExpanded} inert={!contentExpanded}>
            <div className="hub-solo-clip"><div className="hub-mode-list" aria-label={mode==='practice'?'选择单人游戏内容':'选择多人游戏内容'}>
              <div className={`hub-artwork-option ${mode==='practice'?'has-settings':''}`}>
                <button className={`hub-mode hub-artwork-mode selected ${(mode==='practice'?launchPhase!=='idle':roomContentSelected)?'is-armed is-mode-chosen':''}`} aria-label={mode==='practice'&&launchPhase!=='idle'?'曲绘，开始':'曲绘'} aria-expanded={mode==='room'?roomContentSelected:undefined} aria-pressed={mode==='room'?roomContentSelected:undefined} aria-controls={mode==='room'?'hub-room-actions':undefined} disabled={pending||(!inRoom&&(checkingActive||Boolean(matchId)))||launchPhase==='leaving'} onClick={()=>{
                  setError('');if(mode==='practice'){void start('practice');return;}
                  setRoomArtworkSelected(v=>inRoom||!v);resetRoomActions();playSound('ui.select');
                }}>
                  <span className="hub-mode-name"><strong>曲绘</strong><small>{mode==='practice'?'选择难度，开始猜曲':'创建或加入猜曲房间'}</small></span>
                  <span className="hub-mode-arrow has-start" aria-hidden="true"><span className="hub-mode-start-sweep"><span className="hub-mode-start-label">{mode==='practice'?'开始':'选中'}</span>{mode==='room'&&roomContentSelected?<Check size={20}/>:<ArrowRight size={20}/>}</span></span>
                </button>
                {mode==='practice'&&<span className="hub-settings-reveal" data-visible={launchPhase!=='idle'} aria-hidden={launchPhase==='idle'} inert={launchPhase==='idle'}><button type="button" className="hub-mode-settings" aria-label="曲绘范围设置" title="曲绘范围" aria-expanded={scopeExpanded} aria-controls="hub-artwork-scopes" disabled={launchPhase!=='armed'||pending} onClick={()=>{setScopeExpanded(v=>!v);playSound('ui.select');}}><Settings size={17}/></button></span>}
              </div>
              <button className="hub-mode unavailable" disabled><span className="hub-mode-name"><strong>谱面</strong><small>待开发</small></span><span className="hub-mode-arrow" aria-hidden="true"><ArrowRight size={25}/></span></button>
            </div>
            <div id="hub-artwork-scopes" className="hub-scope-reveal" data-expanded={mode==='practice'&&scopeExpanded} aria-hidden={mode!=='practice'||!scopeExpanded} inert={mode!=='practice'||!scopeExpanded}>
              <div className="hub-scope-clip"><div className="hub-scope-panel"><span>曲绘范围</span><div role="group" aria-label="曲绘范围">{scopeChoices.map(([key,label])=><button type="button" key={key} className="slant" data-scope-glow={(key==='main'||key==='non-main')&&scopes.includes(key)?(scopes.includes('main')&&scopes.includes('non-main')?'orange':'red'):undefined} aria-pressed={scopes.includes(key)} disabled={(key==='main'||key==='non-main')&&scopes.includes(key)&&scopes.filter(s=>s==='main'||s==='non-main').length===1} onClick={()=>{useStore.getState().updatePreferences({artworkScopes:scopes.includes(key)?scopes.filter(s=>s!==key):[...scopes,key]});playSound('ui.select');}}><span>{label}<span className="hub-scope-check" aria-hidden="true"><Check size={13}/></span></span></button>)}</div><p className="hub-scope-help">主线：九个主线章节；非主线：支线、联动及单曲等。<br/>已删除、愚人节曲目单独选择。主线与非主线至少保留一项。<br/>橙色描边表示两项均选；红色描边表示唯一保留项，不能取消。</p>
            </div></div></div>
            <div id="hub-room-actions" className="hub-room-reveal" data-expanded={roomActionsExpanded} aria-hidden={!roomActionsExpanded} inert={!roomActionsExpanded}>
              <div className="hub-room-clip"><div className="hub-room-panel">
                <div className="hub-mode-list hub-room-action-list" aria-label="多人房间操作">
                  <div className="hub-room-return-entry">
                  <button ref={createButton} className={`hub-mode selected ${inRoom||createArmed?'is-armed is-mode-chosen':''}`} aria-label={inRoom?'返回房间':createArmed?'创建房间，创建':'创建房间'} aria-pressed={inRoom||createArmed} disabled={pending||(!inRoom&&(checkingActive||Boolean(matchId)))} onKeyDown={event=>{if(event.key==='Escape'&&!pending)setCreateArmed(false);}} onClick={()=>{
                    setError('');if(inRoom){void returnRoom();return;}if(createArmed){void start('room');return;}
                    resetRoomActions();setCreateArmed(true);playSound('ui.select');
                  }}><span className="hub-mode-name"><strong>{inRoom?'返回房间':'创建房间'}</strong><small>{inRoom?`房间 ${roomCode}`:'建立房间，邀请好友'}</small></span><span className="hub-mode-arrow has-start" aria-hidden="true"><span className="hub-mode-start-sweep"><span className="hub-mode-start-label">{inRoom?'返回':'创建'}</span><ArrowRight size={20}/></span></span></button>
                  {inRoom&&<button ref={roomAbandonButton} type="button" className={`hub-room-abandon ${roomAbandonArmed?'is-armed':''}`} aria-label={roomAbandonArmed?'确认退出房间':'退出房间'} aria-expanded={roomAbandonArmed} disabled={pending} onClick={()=>void abandonRoom()}><span aria-hidden={!roomAbandonArmed}>放弃？</span><X size={18} aria-hidden="true"/></button>}
                  </div>
                  <div ref={joinEntry} id="hub-room-join" className="hub-room-join-entry" data-unavailable={inRoom} data-join-phase={joinPhase} data-join-direction={joinPhase==='returning'?'backward':'forward'} onClick={event=>{if(event.target===event.currentTarget&&(joinPhase==='sweeping'||joinPhase==='returning'))beginJoin();}} onKeyDown={event=>{if(event.key==='Escape'&&!pending&&joinPhase!=='idle'){event.preventDefault();cancelJoin(true);}}}>
                    {joinPhase!=='idle'&&<form className="hub-mode selected is-armed is-mode-chosen hub-room-join-form" aria-label="加入房间" aria-hidden={joinPhase!=='input'} inert={joinPhase!=='input'} onSubmit={joinRoom}>
                      <input ref={joinInput} aria-label="房间码" placeholder="输入 6 位房间码" autoComplete="off" autoCapitalize="characters" spellCheck={false} pattern="[A-Z2-9]{6}" maxLength={6} value={joinCode} disabled={pending||inRoom} onChange={event=>setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g,''))}/>
                      <button type="submit" className="hub-room-submit" aria-label="加入" disabled={pending||inRoom||joinCode.length!==6}><span className="hub-mode-arrow has-start" aria-hidden="true"><span className="hub-mode-start-sweep"><span className="hub-mode-start-label">加入</span><ArrowRight size={20}/></span></span></button>
                    </form>}
                    <button ref={joinButton} className={`hub-mode selected hub-room-join-trigger ${inRoom?'unavailable':''} ${joinPhase!=='idle'?'is-armed is-mode-chosen':''}`} aria-hidden={joinPhase==='input'} inert={joinPhase==='input'} aria-busy={joinPhase==='sweeping'||joinPhase==='returning'} disabled={inRoom||pending||checkingActive||Boolean(matchId)} onClick={beginJoin}>
                      <span className="hub-mode-name"><strong>加入房间</strong><small>输入房间码，同场猜曲</small></span><span className="hub-mode-arrow has-start" aria-hidden="true"><span className="hub-mode-start-sweep"><span className="hub-mode-start-label">选中</span><ArrowRight size={20}/></span></span>
                    </button>
                    {joinPhase!=='idle'&&<span className="hub-room-join-effect" aria-hidden="true"><AnswerTint kind="good" persistent/></span>}
                  </div>
                </div>
              </div></div>
            </div>
            </div></div>
          {matchId&&<div className="hub-actions"><button className="slant white continue-challenge" onClick={()=>go(`/play/${matchId}`)}><span>继续上次挑战<ArrowRight size={23}/></span></button></div>}

          </section>
        </div>
      {error&&<p className="hub-notice" role="alert">{error}</p>}
      </div>
      <div ref={boardPanel} className="hub-tab-panel hub-board-panel" aria-hidden={tab!=='board'} inert={tab!=='board'||tabPhase!=='idle'}>{boardVisited&&<Leaderboard/>}</div>
      <div ref={settingsPanel} className="hub-tab-panel hub-settings-panel" aria-hidden={tab!=='settings'} inert={tab!=='settings'||tabPhase!=='idle'}><SettingsPanel/></div>
    </div>
    <div className="hub-bottom-line"><div className="hub-footer-actions" data-expanded={footerExpanded} onClickCapture={()=>{if(footerExpanded)setFooterActivity(n=>n+1);}}>
      <a className="hub-footer-home" href="#/" aria-label={footerExpanded?'返回开屏页':'Phiguess'} aria-expanded={footerExpanded} aria-controls="hub-github-link" onClick={event=>{event.preventDefault();if(launchLocked.current)return;if(!footerExpanded)setFooterExpanded(true);else returnTitle();}}><span aria-hidden="true">Phiguess</span><span aria-hidden="true">返回开屏页</span></a>
      <a id="hub-github-link" className="hub-footer-github" href="https://github.com/DDZmumo/Phiguess" target="_blank" rel="noopener noreferrer" tabIndex={footerExpanded?0:-1} aria-hidden={!footerExpanded}>前往 Github</a>
    </div></div>
    <div ref={launchShade} className="hub-launch-shade" aria-hidden="true"/>
    <div ref={roomFade.shade} className="room-navigation-shade" data-active={roomFade.active} aria-hidden="true"/>
  </section>;
}
