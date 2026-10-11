import {playSound} from './sound';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, LogOut } from 'lucide-react';
import { type RoomView } from '../../../packages/contracts/src';
import { api, ApiError, errorMessage, uploadAvatar } from './api';
import { go, useReducedMotion } from './hooks';
import {setMenuMusicActive} from './menu-music';
import { useStore, type Session } from './store';
import { Avatar, gsap, modeTransitionDuration, titleTransitionTiming, useGSAP } from './visual';
import { useCover } from './Showcase';
import { HubBackdrop } from './HubBackdrop';
import {SettingsPanel} from './Settings';
import { Leaderboard } from './Leaderboard';

const labels={practice:'单人游戏',room:'多人房间'};
export const MULTIPLAYER_ENABLED=false;
type HubTab='game'|'board'|'settings';
export function Hub({route='/account'}:{route?:string}) {
  const session=useStore(s=>s.session),setSession=useStore(s=>s.setSession),preferences=useStore(s=>s.preferences);
  const setMatch=useStore(s=>s.setMatch),setRoom=useStore(s=>s.setRoom),matchId=useStore(s=>s.matchId),roomCode=useStore(s=>s.roomCode);
  const tab:HubTab=route==='/account/leaderboard'?'board':route==='/account/settings'?'settings':'game';
  const [mode,setMode]=useState<'practice'|'room'>('practice');
  const [boardVisited,setBoardVisited]=useState(tab==='board'),[tabPhase,setTabPhase]=useState<'idle'|'sliding'>('idle');
  const [footerExpanded,setFooterExpanded]=useState(false),[footerActivity,setFooterActivity]=useState(0);
  const [returningTitle,setReturningTitle]=useState(false);
  const previousTab=useRef<HubTab>(tab);
  const [name,setName]=useState(session?.user.name||''),[editing,setEditing]=useState(!session),[pending,setPending]=useState(false),[error,setError]=useState('');
  const [authMode,setAuthMode]=useState<'guest'|'login'>('guest'),[password,setPassword]=useState(''),[loginOpen,setLoginOpen]=useState(false);
  const showAuth=!session||loginOpen;
  const avatarInput=useRef<HTMLInputElement>(null);
  const root=useRef<HTMLElement>(null),card=useRef<HTMLElement>(null),gamePanel=useRef<HTMLDivElement>(null),boardPanel=useRef<HTMLDivElement>(null),settingsPanel=useRef<HTMLDivElement>(null);
  const launchShade=useRef<HTMLDivElement>(null),launchLocked=useRef(false);
  const [launchPhase,setLaunchPhase]=useState<'idle'|'armed'|'leaving'>('idle'),reduce=useReducedMotion();
  const cover=useCover(),[checkingActive,setCheckingActive]=useState(Boolean(session));
  const [confirmedRoom,setConfirmedRoom]=useState<{code:string;token:string}|null>(null);
  useEffect(()=>{
    if(!footerExpanded)return;
    const timer=setTimeout(()=>setFooterExpanded(false),5000);
    return()=>clearTimeout(timer);
  },[footerExpanded,footerActivity]);
  const {contextSafe}=useGSAP(()=>{
    const panels=[gamePanel.current,boardPanel.current,settingsPanel.current];
    gsap.killTweensOf(panels);
    const travel=(root.current?.clientWidth??1)/(gamePanel.current?.clientWidth||1)*100;
    const xPercent=(index:number)=>(index-(['game','board','settings'] as const).indexOf(tab))*travel;
    const changed=previousTab.current!==tab;previousTab.current=tab;
    if(!changed||reduce){gsap.set(panels,{xPercent,force3D:true});setTabPhase('idle');return;}
    setTabPhase('sliding');
    gsap.to(panels,{xPercent,force3D:true,duration:.26,ease:'power2.inOut',onComplete:()=>setTabPhase('idle')});
  },{scope:root,dependencies:[tab,reduce]});
  const returnTitle=contextSafe(()=>{
    if(launchLocked.current)return;
    launchLocked.current=true;setReturningTitle(true);playSound('ui.back');
    const timing=titleTransitionTiming(reduce);
    gsap.timeline().to(root.current!.closest('.scene'),{opacity:0,duration:timing.exit,ease:'phigrosFadeOut'}).call(()=>go('/'),undefined,`+=${timing.pause}`);
  });
  useEffect(()=>{if(tab==='board')setBoardVisited(true);},[tab]);
  function switchTab(next:HubTab){
    if(next===tab||launchLocked.current)return;playSound('ui.select');
    if(next==='board')setBoardVisited(true);
    if(!reduce)setTabPhase('sliding');
    go(next==='game'?'/account':next==='board'?'/account/leaderboard':'/account/settings');
  }
  useEffect(()=>{if(!session)setEditing(true);},[session]);
  useEffect(()=>{
    if(!session){setCheckingActive(false);return;}let alive=true;setCheckingActive(true);
    const refresh=()=>void api<{match:{id:string;mode:string}|null}>('me/active').then(active=>{if(alive){setMatch(active.match?.id??null);setCheckingActive(false);}}).catch(()=>{if(alive)setCheckingActive(true);});
    refresh();const timer=setInterval(refresh,5000);return()=>{alive=false;clearInterval(timer);};
  },[session?.token,setMatch]);
  useEffect(()=>{
    setConfirmedRoom(null);if(!MULTIPLAYER_ENABLED||!roomCode||!session)return;
    const token=session.token,ctrl=new AbortController();
    void api<RoomView>(`rooms/${roomCode}`,'GET',undefined,ctrl.signal).then(()=>{
      if(!ctrl.signal.aborted)setConfirmedRoom({code:roomCode,token});
    }).catch(e=>{
      if(ctrl.signal.aborted)return;
      const current=useStore.getState();
      if(e instanceof ApiError&&e.status===404&&current.roomCode===roomCode&&current.session?.token===token)setRoom(null);
    });
    return()=>ctrl.abort();
  },[roomCode,session?.token,setRoom]);
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
      if(event.target instanceof Node&&!root.current?.querySelector('.hub-mode:first-child')?.contains(event.target))setLaunchPhase('idle');
    };
    document.addEventListener('pointerdown',dismiss,true);
    return()=>document.removeEventListener('pointerdown',dismiss,true);
  },[launchPhase]);
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
  async function start(nextMode:'practice'|'room'=mode) {
    if(nextMode==='room'&&!MULTIPLAYER_ENABLED)return;
    if(!session){setEditing(true);setError('先填写昵称，建立你的玩家档案。');return;}
    if(pending||checkingActive||matchId||launchLocked.current)return;
    if(nextMode==='practice'){
      if(launchPhase==='idle'){setLaunchPhase('armed');playSound('ui.select');return;}
      launchLocked.current=true;setMenuMusicActive(false);setLaunchPhase('leaving');playSound('ui.confirm');return;
    }
    setPending(true);setError('');
    try {
      if(roomCode){
        try{await api(`rooms/${roomCode}/leave`,'POST');}
        catch(e){if(!(e instanceof ApiError&&e.status===404))throw e;}
        if(useStore.getState().roomCode===roomCode)setRoom(null);
      }
      const room=await api<RoomView>('rooms','POST',{difficulty:preferences.difficulty,rounds:preferences.rounds,roundSeconds:preferences.roundSeconds,healthEnabled:preferences.healthEnabled??true,healthCapacity:preferences.healthCapacity});
      setRoom(room.code);go(`/room/${room.code}`);
    }catch(e){if(e instanceof ApiError&&e.payload.matchId)setMatch(e.payload.matchId);setError(errorMessage(e));}finally{setPending(false);}
  }
  async function returnRoom() {
    if(!MULTIPLAYER_ENABLED||!session||!roomCode||pending)return;setPending(true);setError('');
    try{
      await api<RoomView>(`rooms/${roomCode}`);
      const current=useStore.getState();
      if(current.roomCode===roomCode&&current.session?.token===session.token)go(`/room/${roomCode}`);
    }catch(e){
      const current=useStore.getState();
      if(e instanceof ApiError&&e.status===404){
        setConfirmedRoom(null);
        if(current.roomCode===roomCode&&current.session?.token===session.token)setRoom(null);
      }else setError(errorMessage(e));
    }finally{setPending(false);}
  }
  async function avatar(file:File|undefined) {
    if(!file||!session)return;
    if(file.size>3*1024*1024){setError('头像图片不能超过 3MB。');return;}
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){setError('请选择 PNG、JPEG 或 WebP 图片。');return;}
    setPending(true);setError('');
    try{const result=await uploadAvatar(file);setSession({...session,user:{...session.user,...result}});}catch(e){setError(errorMessage(e));}finally{setPending(false);}
  }
  const navIndex=tab==='settings'?2:tab==='board'?1:0;
  return <section ref={root} className="account-screen account-refresh" data-launch-phase={launchPhase} data-returning-title={returningTitle} data-tab={tab} data-tab-transition={tabPhase} aria-label="账号主界面" style={cover?{backgroundImage:`url("${cover.url}")`}:undefined}>
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
            <button type="button" className="hub-tutorial-entry" onClick={()=>go('/tutorial')} aria-label="新手教程"><span className="hub-profile-action-label">新手教程<ArrowRight size={18} aria-hidden="true"/></span></button>
          </div>
        </section>
        <div className="hub-play-area hub-play-centered">
          <section className="hub-mode-column"><h2>选择模式<span>MODE</span></h2><div className="hub-mode-list" aria-label="选择游戏模式">
            {(['practice','room'] as const).map((m,i)=><button key={m} className={`hub-mode ${mode===m?'selected':''} ${m==='practice'&&launchPhase!=='idle'?'is-armed':''} ${m==='room'&&!MULTIPLAYER_ENABLED?'unavailable':''}`} aria-pressed={mode===m} aria-label={m==='practice'&&launchPhase!=='idle'?'单人游戏，开始':undefined} disabled={(m==='room'&&!MULTIPLAYER_ENABLED)||pending||checkingActive||Boolean(matchId)||launchPhase==='leaving'} onClick={()=>{setMode(m);setError('');void start(m);}}><span className="hub-mode-index">0{i+1}</span><span className="hub-mode-name"><strong>{m==='room'&&!MULTIPLAYER_ENABLED?'多人房间（待开发）':labels[m]}</strong><small>{m==='practice'?'选择难度，开始猜曲':MULTIPLAYER_ENABLED?'邀请好友，同场猜图':'正在绝赞开发中... ...'}</small></span><span className={`hub-mode-arrow ${m==='practice'?'has-start':''}`} aria-hidden="true">{m==='practice'?<span className="hub-mode-start-sweep"><span className="hub-mode-start-label">开始</span><ArrowRight size={25}/></span>:<ArrowRight size={25}/>}</span></button>)}
          </div>
          {matchId&&<div className="hub-actions"><button className="slant white continue-challenge" onClick={()=>go(`/play/${matchId}`)}><span>继续上次挑战<ArrowRight size={23}/></span></button></div>}
          {roomCode&&confirmedRoom?.code===roomCode&&confirmedRoom.token===session?.token&&<button className="hub-return-room" disabled={!MULTIPLAYER_ENABLED||pending} onClick={()=>void returnRoom()}>返回房间 {roomCode}<ArrowRight size={16}/></button>}

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
  </section>;
}
