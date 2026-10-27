import {playSound} from './sound';
import {useEffect,useId,useRef,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Check,Minus,Plus} from 'lucide-react';
import {useStore} from './store';
import {isMobileScreen} from './landscape';
import './settings.css';

function SettingRange({label,value,min=0,max=1,increment=.05,unit='%',onChange}:{label:string;value:number;min?:number;max?:number;increment?:number;unit?:string;onChange:(value:number)=>void}){
 const id=useId(),interactionStart=useRef(value);
 const preview=()=>{if(interactionStart.current!==value){playSound('ui.select');interactionStart.current=value;}};
 const step=(direction:number)=>{onChange(Math.max(min,Math.min(max,Math.round((value+direction*increment)*100)/100)));playSound('ui.select');};
 return <div className="setting-row setting-range">
  <div className="setting-heading"><label htmlFor={id}>{label}</label><output htmlFor={id}>{Math.round(value*(unit==='%'?100:1))}<small>{unit}</small></output></div>
  <div className="setting-slider">
   <button type="button" aria-label={`降低${label}`} disabled={value<=min} onClick={()=>step(-1)}><Minus size={18}/></button>
   <input id={id} aria-label={label} aria-valuetext={`${Math.round(value*(unit==='%'?100:1))}${unit}`} type="range" min={min} max={max} step={increment} value={value} onPointerDown={()=>{interactionStart.current=value;}} onPointerUp={preview} onKeyDown={e=>{if(!e.repeat)interactionStart.current=value;}} onKeyUp={preview} onChange={e=>onChange(+e.target.value)}/>
   <button type="button" aria-label={`提高${label}`} disabled={value>=max} onClick={()=>step(1)}><Plus size={18}/></button>
  </div>
 </div>;
}
export function SettingSwitch({label,description,checked,onChange,className=''}:{label:string;description?:string;checked:boolean;onChange:(checked:boolean)=>void;className?:string}){
 const id=useId();
 return <div className={`setting-row setting-toggle ${className}`}>
  <div className="setting-heading"><label htmlFor={id}>{label}</label><span className="setting-switch">
   <input id={id} type="checkbox" role="switch" checked={checked} onChange={e=>{onChange(e.target.checked);playSound('ui.toggle',e.target.checked&&label==='交互音效');}}/>
   <span className="setting-switch-track" aria-hidden="true"><Check size={20}/><i/></span>
  </span></div>
  {description&&<p>{description}</p>}
 </div>;
}
export function SettingsPanel({headerAction}:{headerAction?:ReactNode}){
 const settings=useStore(s=>s.preferences),update=useStore(s=>s.updatePreferences);
 return <section className="settings-page" aria-label="游玩设置">
  <div className="settings-form">
   <header className="settings-heading"><h1>游玩设置</h1><span>SETTINGS</span>{headerAction}</header>
   <SettingRange label="背景亮度" value={settings.brightness} min={.3} onChange={brightness=>update({brightness})}/>
   {isMobileScreen()&&<SettingRange label="手机安全区" value={settings.mobileEdgePadding??0} max={128} increment={2} unit="px" onChange={mobileEdgePadding=>update({mobileEdgePadding})}/>}
   <SettingSwitch label="界面动效" description="同时遵循系统的减少动态效果设置" checked={settings.motion} onChange={motion=>update({motion})}/>
   <SettingSwitch label="交互音效" description="菜单与按钮的短提示音" checked={settings.sound} onChange={sound=>update({sound})}/>
   <SettingRange label="音乐音量" value={settings.musicVolume??.3} onChange={musicVolume=>update({musicVolume})}/>
   <SettingRange label="音效音量" value={settings.volume} onChange={volume=>update({volume})}/>
  </div>
 </section>;
}

// In-game access keeps the running challenge mounted while showing the same full-page controls.
export function Settings({open,onClose}:{open:boolean;onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 const close=()=>{playSound('ui.back');onClose();};
 useEffect(()=>{if(open&&!ref.current?.open)ref.current?.showModal();else if(!open&&ref.current?.open)ref.current.close();},[open]);
 return createPortal(<dialog className="settings-fullscreen" ref={ref} aria-label="设置" onCancel={e=>{e.preventDefault();close();}}>
  <header className="settings-fullscreen-header"><span>设置</span><button type="button" onClick={close}>继续游戏</button></header>
  <SettingsPanel/>
 </dialog>,document.body);
}
