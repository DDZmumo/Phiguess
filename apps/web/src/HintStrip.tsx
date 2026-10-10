import { useLayoutEffect, useRef } from 'react';
import { Lightbulb } from 'lucide-react';
import type { Hint } from './api';

function HintContent({content}:{content:string}){
  const text=useRef<HTMLSpanElement>(null);
  useLayoutEffect(()=>{
    const element=text.current;if(!element)return;
    const fit=()=>{
      const style=getComputedStyle(element),maximum=parseFloat(style.getPropertyValue('--hint-font-max')),minimum=parseFloat(style.getPropertyValue('--hint-font-min'));
      let size=maximum;element.style.fontSize=`${size}px`;
      while(size>minimum&&(element.scrollHeight>element.clientHeight+1||element.scrollWidth>element.clientWidth+1)){
        size=Math.max(minimum,size-.5);element.style.fontSize=`${size}px`;
      }
    };
    fit();const observer=new ResizeObserver(fit);observer.observe(element);return()=>observer.disconnect();
  },[content]);
  return <span ref={text} className="hint-text" aria-live="polite">{content}</span>;
}

export function HintStrip({indices,hints}:{indices:number[];hints:Hint[]}){
  return <div className="hint-strip" role="group" aria-label={indices.length===2?'两个提示':'三个提示'}>
    <div className="hint-emblem" aria-hidden="true"><Lightbulb size={27}/></div>
    {indices.map((index,order)=>{
      const hint=hints.find(value=>value.index===index);
      return <div key={index} className={`hint-cell ${hint?'revealed':''}`} aria-label={`第 ${order+1} 个提示${hint?'已解锁':'未解锁'}`}>
        <div className="hint-inner">{hint?<HintContent content={hint.content}/>:<span className="hint-order">{['1st','2nd','3rd'][order]}</span>}</div>
      </div>;
    })}
  </div>;
}
