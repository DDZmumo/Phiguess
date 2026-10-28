import {useEffect,useRef,useState} from 'react';
type RotationRate={alpha:number|null;beta:number|null;gamma:number|null};
type PermissionMotion=typeof DeviceMotionEvent&{requestPermission?:()=>Promise<string>};
export function usePanelMotion(active:boolean,reduced:boolean){
 const pose=useRef({x:0,y:0,z:0}),rate=useRef<RotationRate|null>(null),wake=useRef(()=>{});
 const [sensor,setSensor]=useState(false),[permission,setPermission]=useState('');
 const mobile=/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
 const enable=async()=>{try{if(!window.isSecureContext){setPermission('请使用安全连接启用陀螺仪');return;}const cls=window.DeviceMotionEvent as PermissionMotion|undefined;if(!cls)throw Error();if(cls.requestPermission&&await cls.requestPermission()!=='granted'){setPermission('未获得陀螺仪权限');return;}setSensor(true);setPermission('');}catch{setPermission('当前浏览器未提供陀螺仪');}};
 useEffect(()=>{
  if(!active||reduced)return;
  let frame=0,last=0,lastPointer:{x:number;y:number}|null=null;
  const elastic=(value:number,limit:number)=>Math.abs(value)<=limit?value:Math.sign(value)*(limit+1-1/(1+Math.abs(value)-limit));
  const paint=(stamp:number)=>{frame=0;const dt=Math.min(.05,last?(stamp-last)/1000:1/60);last=stamp;
   if(sensor&&rate.current){const r=rate.current;let x=(r.beta??0)*Math.PI/180,y=(r.gamma??0)*Math.PI/180,z=(r.alpha??0)*Math.PI/180;const angle=screen.orientation?.angle??0;if(Math.abs(angle)===90)[x,y]=[y*Math.sign(angle),-x*Math.sign(angle)];if(Math.hypot(x,y,z)>.13){pose.current.x+=x*.18*dt*60;pose.current.y+=y*.18*dt*60;pose.current.z-=z*.18*dt*60;}}
   const p=pose.current;p.x=elastic(p.x,10)*(1-dt*.3);p.y=elastic(p.y,20)*(1-dt*.3);p.z=elastic(p.z,5)*(1-dt*.3);
   const style=document.documentElement.style;style.setProperty('--saturn-rx',`${p.x}deg`);style.setProperty('--saturn-ry',`${-p.y}deg`);style.setProperty('--saturn-rz',`${-p.z}deg`);
   if(sensor||Math.abs(p.x)+Math.abs(p.y)+Math.abs(p.z)>.003)frame=requestAnimationFrame(paint);
  };
  const start=()=>{if(!frame){last=0;frame=requestAnimationFrame(paint);}};wake.current=start;
  const pointer=(event:PointerEvent)=>{if(event.pointerType==='touch'||sensor)return;if(lastPointer){pose.current.y+=(event.clientX-lastPointer.x)*.006;pose.current.x-=(event.clientY-lastPointer.y)*.004;start();}lastPointer={x:event.clientX,y:event.clientY};};
  const motion=(event:DeviceMotionEvent)=>{rate.current=event.rotationRate;start();};
  window.addEventListener('pointermove',pointer,{passive:true});if(sensor)window.addEventListener('devicemotion',motion,{passive:true});
  return()=>{cancelAnimationFrame(frame);window.removeEventListener('pointermove',pointer);window.removeEventListener('devicemotion',motion);for(const k of ['--saturn-rx','--saturn-ry','--saturn-rz'])document.documentElement.style.removeProperty(k);};
 },[active,sensor,reduced]);
 return {mobile,sensor,permission,enable,center:()=>{pose.current={x:0,y:0,z:0};wake.current();}};
}
