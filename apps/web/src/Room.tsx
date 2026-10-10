import { useEffect, useState } from 'react';
import { Check, Copy, ArrowRight, Settings2 } from 'lucide-react';
import { INFINITY_ROUNDS, normalizeChallengeSettings, resolveHealthCapacity, roundCountChoices, roundTimeChoices, type Difficulty, type GameOptions, type MatchView, type RoomView } from '../../../packages/contracts/src';
import { api, ApiError, errorMessage } from './api';
import { go, useLive } from './hooks';
import { useStore } from './store';
import { Back, Settings, UserChip } from './visual';
import './room-options.css';

function returnFromMissingRoom(code:string) {
  const current=useStore.getState();
  if(current.roomCode===code)current.setRoom(null);
  if(window.location.hash===`#/room/${code}`)go('/account');
}

export function Room({code}:{code:string}) {
  const {data:room,error:loadError,errorStatus,connected}=useLive<RoomView>('room',code),session=useStore(s=>s.session)!;
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[settings,setSettings]=useState(false),[copied,setCopied]=useState(false);
  useEffect(()=>{if(errorStatus===404)returnFromMissingRoom(code);},[errorStatus,code]);
  function handleError(e:unknown){
    if(e instanceof ApiError&&e.status===404)returnFromMissingRoom(code);
    else setError(errorMessage(e));
  }
  async function changeOptions(options:Partial<GameOptions>){
    if(!room||busy||room.matchId||room.hostId!==session.user.id)return;
    setBusy(true);setError('');
    try{const next={...room.options,...options},normalized={...next,...normalizeChallengeSettings(next.difficulty,next.rounds,next.roundSeconds)};await api<RoomView>(`rooms/${code}/options`,'POST',normalized);useStore.getState().updatePreferences(normalized);}
    catch(e){handleError(e);}finally{setBusy(false);}
  }
  async function action(kind:'ready'|'start'|'leave') {
    if(busy)return;setBusy(true);setError('');
    try {
      if(kind==='start') {const match=await api<MatchView>(`rooms/${code}/start`,'POST');useStore.getState().setMatch(match.id);go(`/play/${match.id}`);}
      else if(kind==='leave') {await api(`rooms/${code}/leave`,'POST');useStore.getState().setRoom(null);go('/account');}
      else await api(`rooms/${code}/ready`,'POST',{ready:!room?.players.find(p=>p.id===session.user.id)?.ready});
    }catch(e){handleError(e);}finally{setBusy(false);}
  }
  return <section className="room-screen"><Back onClick={()=>go('/account')}/><UserChip/>
    <header className="room-heading"><small>MULTIPLAYER</small><h1>多人房间</h1><p>{connected?'等待所有玩家准备':'连接房间中…'}</p></header>
    <div className="room-code"><small>房间码</small><strong>{code}</strong><button aria-label="复制房间码" onClick={()=>{void navigator.clipboard.writeText(code).then(()=>setCopied(true)).catch(()=>setError('复制失败，请手动复制房间码。'));}}>{copied?<Check size={21}/>:<Copy size={21}/>}</button></div>
    <div className="room-players">{Array.from({length:8},(_,i)=>{const p=room?.players[i];return <div className={`room-player ${p?'occupied':''}`} key={i}><span className="slot-number">0{i+1}</span><div>{p?<><strong>{p.name}{p.id===session.user.id?' / 你':''}</strong><small>{p.id===room?.hostId?'房主':'玩家'}</small></>:<span>等待加入</span>}</div>{p&&<span className={`ready-status ${p.ready?'ready':''}`}>{p.ready?'已准备':'未准备'}</span>}</div>;})}</div>
    <div className="room-controls"><div className="room-option-summary"><label>难度<select aria-label="房间难度" value={room?.options.difficulty??'ez'} disabled={!room||busy||Boolean(room.matchId)||room.hostId!==session.user.id} onChange={e=>void changeOptions({difficulty:e.target.value as Difficulty})}>{(['ez','hd','in','at'] as const).map(d=><option key={d} value={d}>{d.toUpperCase()}</option>)}</select></label><label>题数<select aria-label="房间题数" value={room?.options.rounds??5} disabled={!room||busy||Boolean(room.matchId)||room.hostId!==session.user.id} onChange={e=>void changeOptions({rounds:+e.target.value})}>{roundCountChoices(room?.options.difficulty??'ez').map(n=><option key={n} value={n}>{n===INFINITY_ROUNDS?'Infinity':`${n} 首`}</option>)}</select></label><label>每题时长<select aria-label="房间每题时长" value={room?.options.roundSeconds??30} disabled={!room||busy||Boolean(room.matchId)||room.hostId!==session.user.id} onChange={e=>void changeOptions({roundSeconds:+e.target.value})}>{roundTimeChoices(room?.options.difficulty??'ez').map(n=><option key={n} value={n}>{n} 秒</option>)}</select></label>{room&&room.options.difficulty!=='ez'&&<label>血条<select aria-label="房间血条" value={resolveHealthCapacity(room.options.difficulty,room.options.healthCapacity,room.options.healthEnabled)} disabled={busy||Boolean(room.matchId)||room.hostId!==session.user.id} onChange={e=>void changeOptions({healthCapacity:Number(e.target.value) as 0|20|50,healthEnabled:Number(e.target.value)>0})}>{([0,20,50] as const).map(hp=><option key={hp} value={hp} disabled={room.options.difficulty==='at'&&hp===0}>{hp===0?'关闭':hp+'HP'}</option>)}</select></label>}{room&&!room.matchId&&<small>{room.hostId===session.user.id?'修改设置后，所有人需重新准备':'由房主调整设置'}</small>}</div><button onClick={()=>setSettings(true)} aria-label="房间设置"><Settings2 size={24}/></button></div>
    <div className="room-actions"><button className="slant dark" disabled={busy||!room} onClick={()=>void action('leave')}><span>退出房间</span></button>
      {room?.matchId?<button className="slant white" onClick={()=>{useStore.getState().setMatch(room.matchId);go(`/play/${room.matchId}`);}}><span>进入挑战<ArrowRight size={23}/></span></button>:<><button className="slant white" disabled={busy||!room} onClick={()=>void action('ready')}><span>{room?.players.find(p=>p.id===session.user.id)?.ready?'取消准备':'准备'}</span></button>{room?.hostId===session.user.id&&<button className="slant white" disabled={busy||room.players.length<2||room.players.some(p=>!p.ready)} onClick={()=>void action('start')}><span>开始挑战<ArrowRight size={23}/></span></button>}</>}
    </div>
    {(error||loadError)&&<p className="hub-error" role="alert">{error||loadError}</p>}
    <Settings open={settings} onClose={()=>setSettings(false)}/>
  </section>;
}

