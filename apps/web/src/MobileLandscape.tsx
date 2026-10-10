import {useEffect,useRef,useState} from 'react';
import {Smartphone} from 'lucide-react';
import {requestMobileLandscape} from './landscape';
import './mobile-landscape.css';

const query='(pointer: coarse) and (hover: none) and (max-aspect-ratio: 1/1)';
export function useMobilePortrait(){
  const [portrait,setPortrait]=useState(()=>window.matchMedia(query).matches);
  useEffect(()=>{
    const media=window.matchMedia(query),update=()=>setPortrait(media.matches);
    update();media.addEventListener('change',update);
    return()=>media.removeEventListener('change',update);
  },[]);
  return portrait;
}

export function MobileLandscape({required}:{required:boolean}){
  const dialog=useRef<HTMLDialogElement>(null),[pending,setPending]=useState(false),[manual,setManual]=useState(false);
  useEffect(()=>{
    if(required&&!dialog.current?.open){dialog.current?.showModal();setManual(false);}
    else if(!required&&dialog.current?.open)dialog.current.close();
  },[required]);
  return <dialog ref={dialog} className="mobile-landscape" aria-labelledby="landscape-heading" onCancel={event=>event.preventDefault()}>
    <Smartphone size={72} aria-hidden="true"/>
    <h1 id="landscape-heading">请横屏游玩</h1>
    <p>{manual?'当前浏览器无法自动锁定横屏，请手动将手机横放；若未旋转，请打开系统自动旋转。':'将手机横放，或点击下方按钮尝试自动进入横屏。'}</p>
    <button type="button" disabled={pending} onClick={()=>{
      setPending(true);void requestMobileLandscape().then(locked=>setManual(!locked)).finally(()=>setPending(false));
    }}>{pending?'正在切换…':'横屏开始'}</button>
  </dialog>;
}
