import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ArrowLeft, ArrowRight, Plus, Minus, X, Crown } from 'lucide-react';
import { INFINITY_ROUNDS, ROOM_MATCH_SECONDS, normalizeChallengeSettings, resolveHealthCapacity, roundCountChoices, roundTimeChoices, type Difficulty, type RoomOptions, type MatchView, type RoomView, type RoomPerformanceView } from '../../../packages/contracts/src';
import {performanceBadgeTotals} from '../../../packages/game-core/src';
import { api, ApiError, errorMessage } from './api';
import { go, useLive, useReducedMotion } from './hooks';
import { useStore } from './store';
import { Avatar,gsap,modeTransitionDuration } from './visual';
import {useSlidingTabs} from './use-sliding-tabs';
import {SettingsPanel} from './Settings';
import {BlueSweep} from './BlueSweep';
import {PerformanceBadge} from './PerformanceBadge';
import {RoomHostEffects} from './RoomHostEffects';
import {RoomSummary} from './RoomSummary';
import {useRoomNavigationFade} from './use-room-navigation-fade';
import {useCover} from './Showcase';
import {playSound} from './sound';
import {copyText} from './clipboard';
import './room-options.css';

function returnFromMissingRoom(code:string,roomEpoch:number,token:string) {
  const current=useStore.getState();
  if(current.roomEpoch!==roomEpoch||current.session?.token!==token)return;
  if(current.roomCode===code)current.setRoom(null);
  if(window.location.hash===`#/room/${code}`)go('/account');
}

function RoomCodeDisplay({code,copied,onCopy}:{code:string;copied:boolean;onCopy:()=>void}){
  return <div className={`room-code ${copied?'is-copied':''}`}>
    <div className="room-code-label"><small>房间码</small><span>ROOM CODE</span></div>
    <strong>{code}</strong>
    <button type="button" aria-label="复制房间码" title={copied?'已复制':'复制房间码'} onClick={onCopy}>{copied?<Check size={20}/>:<Copy size={20}/>}</button>
    <span className="room-copy-feedback" role="status">{copied?'已复制':''}</span>
  </div>;
}

export function Room({code}:{code:string}) {
  const {data:room,setData:setRoomView,error:loadError,errorStatus,connected}=useLive<RoomView>('room',code),session=useStore(s=>s.session)!,membershipEpoch=useStore(s=>s.roomEpoch);
  const cover=useCover(),isHost=room?.hostId===session.user.id;
  const ownReady=room?.players.find(player=>player.id===session.user.id)?.ready??false;
  const playerCount=room?.players.length??0,readyCount=room?.players.filter(player=>player.ready).length??0;
  const allReady=playerCount>=2&&readyCount===playerCount,maxPlayers=room?.options.maxPlayers??8;
  const [playerLimit,setPlayerLimit]=useState(maxPlayers),capacityDragging=useRef(false);
  useEffect(()=>{if(!capacityDragging.current)setPlayerLimit(maxPlayers);},[maxPlayers]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  const [tab,setTab]=useState<'room'|'challenge'|'settings'>('room'),[leaveArmed,setLeaveArmed]=useState(false);
  const [managedPlayer,setManagedPlayer]=useState<string|null>(null);
  const [hostNotice,setHostNotice]=useState<string|null>(null),[pageVisible,setPageVisible]=useState(()=>!document.hidden);
  const [performances,setPerformances]=useState<RoomPerformanceView|null>(null),[performanceFailed,setPerformanceFailed]=useState(false);
  const performanceDifficulty=room?.options.difficulty==='in'?'in':'at',performanceRoster=room?.players.map(player=>player.id).join(',')??'';
  useEffect(()=>{
    setPerformances(null);setPerformanceFailed(false);
    if(!performanceRoster||!connected||room?.matchId)return;
    const controller=new AbortController();
    void api<RoomPerformanceView>(`rooms/${code}/performances`,'GET',undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setPerformances(value);}).catch(()=>{if(!controller.signal.aborted)setPerformanceFailed(true);});
    return()=>controller.abort();
  },[code,performanceDifficulty,performanceRoster,connected,room?.matchId]);
  const scopeChoices=[['main','主线'],['non-main','非主线'],['removed','已删除'],['april-fools','愚人节']] as const;
  const selectedScopes=room?.options.difficulty==='at'?scopeChoices.map(([key])=>key):room?.options.artworkScopes??scopeChoices.map(([key])=>key);
  const root=useRef<HTMLElement>(null),roomPanel=useRef<HTMLDivElement>(null),challengePanel=useRef<HTMLDivElement>(null),settingsPanel=useRef<HTMLDivElement>(null),leaveButton=useRef<HTMLButtonElement>(null);
  const reduce=useReducedMotion(),navIndex=tab==='room'?0:tab==='challenge'?1:2;
  const roomFade=useRoomNavigationFade(reduce);
  const [launchPhase,setLaunchPhase]=useState<'idle'|'fading'|'loading'>('idle'),launchShade=useRef<HTMLDivElement>(null);
  const [activeMatchId,setActiveMatchId]=useState<string|null>(null);
  const {phase:tabPhase,prepare:prepareTab}=useSlidingTabs(root,[roomPanel,challengePanel,settingsPanel],navIndex,reduce);
  useEffect(()=>{
    const id=room?.matchId;setActiveMatchId(null);if(!id)return;
    const controller=new AbortController();
    void api<MatchView>(`matches/${id}`,'GET',undefined,controller.signal).then(match=>{
      if(controller.signal.aborted)return;
      if(['playing','reveal'].includes(match.status))setActiveMatchId(id);
      else{
        setRoomView(current=>current?.matchId===id?{...current,matchId:null,starting:false,players:current.players.map(player=>({...player,ready:false}))}:current);
        if(useStore.getState().matchId===id)useStore.getState().setMatch(null);
        setLaunchPhase('idle');if(launchShade.current)gsap.set(launchShade.current,{opacity:0});
      }
    }).catch(error=>{if(!controller.signal.aborted)setError(errorMessage(error));});
    return()=>controller.abort();
  },[room?.matchId]);
  useEffect(()=>{
    if((room?.starting||activeMatchId)&&launchPhase==='idle'){setLaunchPhase('fading');playSound('challenge.start');}
    else if(room?.startError&&!room.starting&&!room.matchId){setError(room.startError);setLaunchPhase('idle');if(launchShade.current)gsap.to(launchShade.current,{opacity:0,duration:modeTransitionDuration(reduce)});}
  },[room?.starting,activeMatchId,room?.startError,launchPhase,reduce]);
  useEffect(()=>{
    if(launchPhase!=='fading'||!launchShade.current)return;
    const fade=gsap.to(launchShade.current,{opacity:1,duration:modeTransitionDuration(reduce),ease:'phigrosFadeIn',onComplete:()=>setLaunchPhase('loading')});
    return()=>{fade.kill();};
  },[launchPhase,reduce]);
  useEffect(()=>{
    if(launchPhase!=='loading'||!activeMatchId)return;
    const matchId=activeMatchId,frame=requestAnimationFrame(()=>{useStore.getState().setMatch(matchId);go(`/play/${matchId}`);});
    return()=>cancelAnimationFrame(frame);
  },[launchPhase,activeMatchId]);
  useEffect(()=>{
    if(!leaveArmed||busy)return;
    const dismiss=(event:PointerEvent)=>{if(event.target instanceof Node&&!leaveButton.current?.contains(event.target))setLeaveArmed(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setLeaveArmed(false);};
    document.addEventListener('pointerdown',dismiss,true);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',dismiss,true);document.removeEventListener('keydown',escape);};
  },[leaveArmed,busy]);
  useEffect(()=>{
    if(managedPlayer&&(!isHost||room?.matchId||room?.starting||tab!=='room'||!room?.players.some(player=>player.id===managedPlayer)))setManagedPlayer(null);
  },[managedPlayer,isHost,room,tab]);
  useEffect(()=>{
    if(!managedPlayer)return;
    const card=()=>Array.from(root.current?.querySelectorAll<HTMLElement>('.room-player')??[]).find(node=>node.dataset.playerId===managedPlayer);
    const dismiss=(event:PointerEvent)=>{if(event.target instanceof Node&&!card()?.contains(event.target))setManagedPlayer(null);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setManagedPlayer(null);card()?.querySelector<HTMLButtonElement>('.room-player-manage-trigger')?.focus({preventScroll:true});}};
    document.addEventListener('pointerdown',dismiss,true);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',dismiss,true);document.removeEventListener('keydown',escape);};
  },[managedPlayer]);
  useEffect(()=>{
    const visibility=()=>setPageVisible(!document.hidden);document.addEventListener('visibilitychange',visibility);return()=>document.removeEventListener('visibilitychange',visibility);
  },[]);
  useEffect(()=>{
    if(!isHost||room?.matchId||room?.starting||tab!=='room'){setHostNotice(null);return;}
    const notice=room?.hostChange;if(!notice||notice.hostId!==session.user.id)return;
    const key=`phiguess-host-notice:${code}:${session.user.id}`;
    try{if(sessionStorage.getItem(key)===notice.eventId)return;sessionStorage.setItem(key,notice.eventId);}catch{}
    setHostNotice(notice.eventId);
  },[room?.hostChange?.eventId,room?.matchId,room?.starting,isHost,tab,code,session.user.id]);
  useEffect(()=>{if(!hostNotice)return;const timer=setTimeout(()=>setHostNotice(null),4500);return()=>clearTimeout(timer);},[hostNotice]);
  function switchTab(next:typeof tab){if(next===tab)return;setTab(next);prepareTab();playSound('ui.select');}
  useEffect(()=>{if(errorStatus===404||errorStatus===403)returnFromMissingRoom(code,membershipEpoch,session.token);},[errorStatus,code,membershipEpoch,session.token]);
  useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),1800);return()=>clearTimeout(timer);},[copied]);
  function handleError(e:unknown){
    if(e instanceof ApiError&&e.status===404)returnFromMissingRoom(code,membershipEpoch,session.token);
    else setError(errorMessage(e));
  }
  async function changeOptions(options:Partial<RoomOptions>){
    if(!room||busy||room.matchId||room.hostId!==session.user.id)return;
    setBusy(true);setError('');
    try{const next={...room.options,...options},normalized={...next,...normalizeChallengeSettings(next.difficulty,next.rounds,next.roundSeconds)};await api<RoomView>(`rooms/${code}/options`,'POST',normalized);const {maxPlayers:limit,matchSeconds:duration,...preferences}=normalized;useStore.getState().updatePreferences(preferences);playSound('ui.select');}
    catch(e){handleError(e);}finally{setBusy(false);}
  }
  function commitPlayerLimit(value:number){
    capacityDragging.current=false;if(busy||!isHost)return;
    const next=Math.max(2,playerCount,Math.min(8,Math.round(value)));setPlayerLimit(next);
    if(next!==maxPlayers)void changeOptions({maxPlayers:next});
  }
  async function action(kind:'ready'|'start'|'leave') {
    if(busy)return;setBusy(true);setError('');
    const roomEpoch=useStore.getState().roomEpoch;
    try {
      if(kind==='start') {const match=await api<MatchView>(`rooms/${code}/start`,'POST');setRoomView(current=>current?{...current,matchId:match.id,starting:false}:current);}
      else if(kind==='leave') {if(!await roomFade.cover())return;await api(`rooms/${code}/leave`,'POST');const current=useStore.getState();if(current.roomCode===code&&current.roomEpoch===roomEpoch&&current.session?.token===session.token){current.setRoom(null);go('/account');}else void roomFade.reveal();}
      else {await api(`rooms/${code}/ready`,'POST',{ready:!ownReady});playSound('ui.confirm');}
    }catch(e){handleError(e);if(kind==='leave')void roomFade.reveal();}finally{setBusy(false);}
  }
  async function managePlayer(kind:'kick'|'transfer-host',userId:string){
    if(!room||!isHost||room.matchId||room.starting||busy||userId===session.user.id)return;
    setBusy(true);setError('');
    try{const updated=await api<RoomView>(`rooms/${code}/${kind}`,'POST',{userId});setRoomView(updated);setManagedPlayer(null);playSound(kind==='kick'?'ui.back':'ui.confirm');}
    catch(error){if(error instanceof ApiError&&error.message==='Room not found')returnFromMissingRoom(code,membershipEpoch,session.token);else setError(errorMessage(error));}finally{setBusy(false);}
  }
  const roomCode=<RoomCodeDisplay code={code} copied={copied} onCopy={()=>{setCopied(false);setError('');void copyText(code).then(()=>{setCopied(true);playSound('ui.confirm');}).catch(()=>setError('复制失败，请手动复制房间码。'));}}/>;
  return <section ref={root} className="room-screen room-lobby account-refresh" aria-label="多人房间" data-room-tab={tab} data-tab-transition={tabPhase} data-host-effects-paused={reduce||!pageVisible||tab!=='room'} data-reduced-motion={reduce} style={cover?{backgroundImage:`url("${cover.url}")`}:undefined}>
    <div className="room-lobby-backdrop" aria-hidden="true"/>
    <button ref={leaveButton} className={`back-button room-leave ${leaveArmed?'leave-armed':''}`} type="button" aria-label={leaveArmed?'确认离开房间':'离开房间'} aria-expanded={leaveArmed} disabled={busy||!room} onClick={()=>{if(!leaveArmed){setLeaveArmed(true);playSound('ui.select');return;}playSound('ui.back');void action('leave');}}><ArrowLeft size={38} strokeWidth={1.3}/><span className="room-leave-label">离开？</span></button>
    <nav className="hub-nav room-nav" aria-label="房间导航">
      {(['room','challenge','settings'] as const).map((value,index)=><button key={value} className={tab===value?'active':''} aria-current={tab===value?'page':undefined} onClick={()=>switchTab(value)}><span>{['房间','房间设置','游玩设置'][index]}</span></button>)}
      <div className="hub-nav-active" aria-hidden="true" style={{clipPath:`inset(0 ${(2-navIndex)*100/3}% 0 ${navIndex*100/3}%)`}}><span>房间</span><span>房间设置</span><span>游玩设置</span></div>
    </nav>
    <div className="hub-content room-lobby-layout">
        <div ref={roomPanel} className="hub-tab-panel room-tab-panel" aria-hidden={tab!=='room'} inert={tab!=='room'||tabPhase!=='idle'}>
      <div className="room-topline">
        <header className="room-heading">
          <h1>多人房间<span>MULTIPLAYER</span></h1>
          <p role="status"><i className={connected?'connected':''} aria-hidden="true"/>{!connected?'正在连接房间…':room?.matchId?'挑战已开始':allReady?'所有玩家已准备就绪':'等待玩家准备'}</p>
        </header>
        {roomCode}
      </div>

        <section className="room-player-panel" aria-label="玩家席位">
          <header className="room-section-title"><h2>房间成员<span>PLAYERS</span></h2><div className="room-member-count"><strong>{String(playerCount).padStart(2,'0')}</strong><span>/ {String(maxPlayers).padStart(2,'0')}</span></div></header>
          <div className="room-players" role="list" aria-label="房间成员列表">
            {Array.from({length:maxPlayers},(_,index)=>{
              const player=room?.players[index],self=player?.id===session.user.id,manageable=Boolean(player&&isHost&&!self&&!room?.matchId&&!room?.starting),managing=manageable&&managedPlayer===player?.id;
              const performance=performances?.difficulty===performanceDifficulty?performances.players.find(item=>item.id===player?.id):undefined,best=performance?.best;
              return <div className={`room-player ${player?'occupied':'empty'} ${self?'is-self':''} ${player?.ready?'is-ready':''} ${manageable?'can-manage':''} ${managing?'is-managing':''}`} data-player-id={player?.id} role="listitem" key={player?.id??`empty-${index}`}>
                {player&&player.id===room?.hostId&&<RoomHostEffects playerId={player.id}/>}
                <span className="slot-number">{String(index+1).padStart(2,'0')}</span>
                {player?<>
                  <div className="room-player-avatar"><Avatar user={player}/></div>
                  <div className="room-player-identity"><strong title={player.name}>{player.name}</strong><small>{player.id===room?.hostId?'房主 / HOST':'玩家 / PLAYER'}{self&&<em>你</em>}</small></div>
                  <div className="room-player-performance" data-difficulty={performanceDifficulty} data-state={best?'ready':performance?'empty':performanceFailed?'unavailable':'loading'} role="group" aria-label={`${performanceDifficulty.toUpperCase()} Infinity 综合评分`} title={best?`已公布最好成绩：${best.score.toLocaleString()} 分` :performance?'暂无已公布的 Infinity 成绩':performanceFailed?'暂时无法获取成绩':'正在读取成绩'}>
                    {best?<PerformanceBadge grade={performanceBadgeTotals(best.score,best.correct,performanceDifficulty).grade} correct={best.correct}/>:<span className="room-performance-empty" aria-label={performance?'暂无已公布成绩':performanceFailed?'成绩暂不可用':'正在读取成绩'}>—</span>}
                    <span className="room-performance-difficulty"><b>{performanceDifficulty.toUpperCase()}</b><span>INF</span></span>
                  </div>
                  <BlueSweep className="room-player-state" active={player.ready} before={<span className="ready-status"><i aria-hidden="true"/><span>未准备</span></span>} after={<span className="ready-status ready"><Check size={17}/><span>已准备</span></span>}/>
                  {manageable&&<><button className="room-player-manage-trigger" type="button" aria-label={`管理玩家 ${player.name}`} aria-expanded={managing} aria-controls={`room-player-actions-${player.id}`} disabled={busy} onClick={()=>{setManagedPlayer(current=>current===player.id?null:player.id);playSound('ui.select');}}/><div id={`room-player-actions-${player.id}`} className="room-player-admin" role="group" aria-label={`${player.name} 的玩家操作`} aria-hidden={!managing} inert={!managing}><button type="button" className="room-player-kick" aria-label={`踢出 ${player.name}`} disabled={busy} onClick={()=>void managePlayer('kick',player.id)}><X size={20}/><span>踢出</span></button><button type="button" className="room-player-transfer" aria-label={`将房主转交给 ${player.name}`} disabled={busy} onClick={()=>void managePlayer('transfer-host',player.id)}><Crown size={20}/><span>转交房主</span></button></div></>}
                </>:<div className="room-empty-slot"><Plus size={20} aria-hidden="true"/><span>等待加入<small>WAITING FOR PLAYER</small></span></div>}
              </div>;
            })}
          </div>
          <p className="room-seat-note"><span><b>{readyCount}</b> / {playerCount} 已准备</span><span>房间人数上限 {maxPlayers} 人</span></p>
        </section>
        </div>
        <div ref={challengePanel} className="hub-tab-panel room-tab-panel" aria-hidden={tab!=='challenge'} inert={tab!=='challenge'||tabPhase!=='idle'}>
          <section className="room-challenge-page" aria-label="房间设置">
            <header className="settings-heading"><h1>房间设置</h1><span>ROOM SETTINGS</span>{roomCode}</header>
            <fieldset disabled={!room||busy||Boolean(room.matchId)||!isHost}>
              <div className="setting-row setting-range room-capacity-setting">
                <div className="setting-heading"><label htmlFor="room-player-limit">游玩人数</label><output htmlFor="room-player-limit">{playerLimit}<small>人</small></output></div>
                <div className="setting-slider">
                  <button type="button" aria-label="减少游玩人数" disabled={playerLimit<=Math.max(2,playerCount)} onClick={()=>commitPlayerLimit(playerLimit-1)}><Minus size={18}/></button>
                  <input id="room-player-limit" aria-label="游玩人数" aria-valuetext={`${playerLimit} 人`} type="range" min="2" max="8" step="1" value={playerLimit} onPointerDown={()=>{capacityDragging.current=true;}} onPointerUp={event=>commitPlayerLimit(Number(event.currentTarget.value))} onPointerCancel={()=>{capacityDragging.current=false;setPlayerLimit(maxPlayers);}} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))capacityDragging.current=true;}} onKeyUp={event=>{if(capacityDragging.current)commitPlayerLimit(Number(event.currentTarget.value));}} onBlur={event=>{if(capacityDragging.current)commitPlayerLimit(Number(event.currentTarget.value));}} onChange={event=>setPlayerLimit(Number(event.target.value))}/>
                  <button type="button" aria-label="增加游玩人数" disabled={playerLimit>=8} onClick={()=>commitPlayerLimit(playerLimit+1)}><Plus size={18}/></button>
                </div>
                <p>2～8 人 · 当前已加入 {playerCount} 人</p>
              </div>
              <div className="room-challenge-row"><span>难度<small>DIFFICULTY</small></span><div role="group" aria-label="房间难度">{(['ez','hd','in','at'] as const).map(difficulty=><button type="button" key={difficulty} data-difficulty={difficulty} aria-pressed={room?.options.difficulty===difficulty} onClick={()=>void changeOptions({difficulty})}>{difficulty.toUpperCase()}</button>)}</div></div>
              <div className="room-challenge-row room-scopes-row"><span>曲目范围<small>SONG POOL</small></span><div role="group" aria-label="房间曲目范围">{scopeChoices.map(([key,label])=><button type="button" key={key} aria-pressed={selectedScopes.includes(key)} disabled={room?.options.difficulty==='at'||(key==='main'||key==='non-main')&&selectedScopes.includes(key)&&selectedScopes.filter(scope=>scope==='main'||scope==='non-main').length===1} onClick={()=>void changeOptions({artworkScopes:selectedScopes.includes(key)?selectedScopes.filter(scope=>scope!==key):[...selectedScopes,key]})}>{label}{selectedScopes.includes(key)&&<Check size={13} aria-hidden="true"/>}</button>)}</div></div>
              {room?.options.difficulty==='at'&&<p className="room-scopes-note">AT 固定使用全部曲目。</p>}
              <div className="room-challenge-row"><span>题数<small>ROUNDS</small></span><div role="group" aria-label="房间题数">{roundCountChoices(room?.options.difficulty??'ez').map(rounds=><button type="button" key={rounds} aria-pressed={room?.options.rounds===rounds} onClick={()=>void changeOptions({rounds})}>{rounds===INFINITY_ROUNDS?'Infinity':`${rounds} 题`}</button>)}</div></div>
              {room?.options.rounds===INFINITY_ROUNDS&&<div className="room-challenge-row"><span>游戏时限<small>MATCH TIME</small></span><div role="group" aria-label="房间游戏时限">{ROOM_MATCH_SECONDS.map(matchSeconds=><button type="button" key={matchSeconds} aria-pressed={(room.options.matchSeconds??180)===matchSeconds} onClick={()=>void changeOptions({matchSeconds})}>{matchSeconds/60} 分钟</button>)}</div></div>}
              <div className="room-challenge-row"><span>每题时长<small>TIME LIMIT</small></span><div role="group" aria-label="房间每题时长">{roundTimeChoices(room?.options.difficulty??'ez').map(roundSeconds=><button type="button" key={roundSeconds} aria-pressed={room?.options.roundSeconds===roundSeconds} onClick={()=>void changeOptions({roundSeconds})}>{roundSeconds} 秒</button>)}</div></div>
              {room&&room.options.difficulty!=='ez'&&<div className="room-challenge-row"><span>血条<small>HEALTH</small></span><div role="group" aria-label="房间血条">{([0,20,50] as const).map(healthCapacity=><button type="button" key={healthCapacity} aria-pressed={resolveHealthCapacity(room.options.difficulty,room.options.healthCapacity,room.options.healthEnabled)===healthCapacity} disabled={(room.options.difficulty==='at'||room.options.rounds===INFINITY_ROUNDS)&&healthCapacity===0} onClick={()=>void changeOptions({healthCapacity,healthEnabled:healthCapacity>0})}>{healthCapacity===0?'关闭':healthCapacity+'HP'}</button>)}</div></div>}
            </fieldset>
            <p className="room-challenge-note">{room?.matchId?'本场房间设置已锁定':isHost?'修改设置后，所有玩家需重新准备。':'由房主统一调整房间设置。'}</p>
          </section>
        </div>
        <div ref={settingsPanel} className="hub-tab-panel room-tab-panel room-settings-panel" aria-hidden={tab!=='settings'} inert={tab!=='settings'||tabPhase!=='idle'}><SettingsPanel headerAction={roomCode}/></div>
      {(error||loadError)&&<p className="room-notice" role="alert">{error||loadError}</p>}
    </div>
    <p className={`room-host-notice ${hostNotice&&tab==='room'?'is-visible':''}`} role="status" aria-hidden={!hostNotice||tab!=='room'}>你已成为房主</p>
      <footer className="room-lobby-footer room-shared-footer">
        <button className="room-footer-summary" onClick={()=>switchTab('challenge')} aria-label="查看房间设置"><RoomSummary options={room?.options} reduced={reduce}/></button>
        <div className="room-actions">
          {room?.matchId?<button className="slant white room-start" onClick={()=>setLaunchPhase('fading')}><span>进入挑战<ArrowRight size={22}/></span></button>:<>
            <button className={`slant room-ready ${ownReady?'room-action-selected':'white'}`} aria-pressed={ownReady} disabled={busy||!room} onClick={()=>void action('ready')}><BlueSweep className="room-ready-sweep" active={ownReady} before={<span>准备</span>} after={<><Check size={18}/><span>取消准备</span></>}/></button>
            {isHost&&<button className="slant white room-start" disabled={busy||!allReady} onClick={()=>void action('start')}><span>开始挑战<ArrowRight size={22}/></span></button>}
          </>}
        </div>
      </footer>
    <div ref={launchShade} className="room-start-overlay" data-phase={launchPhase} aria-hidden={launchPhase==='idle'}>{launchPhase==='loading'&&<div role="status"><strong>正在准备题目…</strong><p>正在进入房间挑战，请稍候</p></div>}</div>
    <div ref={roomFade.shade} className="room-navigation-shade" data-active={roomFade.active} aria-hidden="true"/>
  </section>;
}
