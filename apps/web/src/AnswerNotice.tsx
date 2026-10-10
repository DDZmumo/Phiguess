import './answer-notice.css';

export interface AnswerNoticeEvent {kind:'perfect'|'good'|'bad'|'miss';serial:number}
function NoticeSurface({text}:{text?:string}){
  return <><span className="input-answer-reveal" aria-hidden="true">{text&&<span className="input-answer-letters">{text}</span>}</span><span className="input-answer-sweep" aria-hidden="true"/></>;
}
export function AnswerTint({kind,persistent=false}:{kind:AnswerNoticeEvent['kind'];persistent?:boolean}){
  return <span className={`input-answer-notice ${kind} ${persistent?'persistent':''}`} aria-hidden="true"><NoticeSurface/></span>;
}
export function AnswerNotice({event,onEnd}:{event:AnswerNoticeEvent|null;onEnd:(serial:number)=>void}){
  if(!event)return null;
  const text={perfect:'PERFECT',good:'GOOD',bad:'BAD',miss:'MISS'}[event.kind];
  return <span key={event.serial} className={`input-answer-notice ${event.kind}`} role="status" aria-label={text}
    onAnimationEnd={e=>{if(e.target===e.currentTarget&&e.animationName==='answer-notice-life')onEnd(event.serial);}}>
    <NoticeSurface text={text}/>
  </span>;
}
