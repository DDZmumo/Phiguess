import {correctHealthGain,timeoutHealthCost,RULES_VERSION,type MatchView,type MatchResultView,type ResultRoundView,type GameOptions} from '../../../packages/contracts/src';
import {scoreAnswer} from '../../../packages/game-core/src';
import type {PlayRuntime} from './runtime-types';
import type {Preferences,Session} from './store';
import type {Hint} from './api';
import {markTutorialDone,tutorialScoreSlides,tutorialDamageSteps,TUTORIAL_VERSION,TUTORIAL_WRONG_ANSWER_REBUKE,TUTORIAL_SCORE_FAST_FADE_MS,TUTORIAL_SCORE_REDUCED_FADE_MS} from './tutorial-model';
import {parseTutorialCheckpoint} from './tutorial-refresh';
import {CHARACTER_TRANSITION_MS,CHARACTER_REVEAL_DELAY_MS,randomCharacterRanks,characterTransition} from './character-scramble';
import {tutorialSongs} from './tutorial-songs';

export type TutorialScene='difficulty'|'game'|'results'|'done';
export interface TutorialAnswerCorrection{elapsed:number;frame:number;settled:number;ranks:number[];running:boolean}
interface PendingAnswerCorrection{original:string;ranks:number[];update:(value:string)=>void;resolve:(value:string)=>void;reject:(reason?:unknown)=>void;signal:AbortSignal;abort:()=>void}
const REBUKE_DURATION=CHARACTER_REVEAL_DELAY_MS+CHARACTER_TRANSITION_MS,REBUKE_HOLD_MS=1500;
const user={id:'tutorial-player',name:'教学练习',accountType:'guest' as const};
export class TutorialRuntime implements PlayRuntime {
 session:Session={token:'local-tutorial-only',expiresAt:'2099-01-01',user};
 preferences:Preferences={motion:true,sound:true,volume:.3,brightness:.9,difficulty:'hd',rounds:5,roundSeconds:30,healthCapacity:20,healthEnabled:true};
 clockPaused=true;
 scene:TutorialScene='difficulty';step=0;completed=false;captionDismissed=false;zoomOpen=false;revision=0;
 resumed=false;restoredResult=false;welcomeSeen=false;answerDraft='';resultScrollTop=0;
 scorePage=0;scoreFastForward=false;summaryOpen=false;hintLocation=false;aliasLesson=false;private autoStep=-1;private autoRemaining=0;
 blackTransition=false;private coveredAction:(()=>Promise<void>)|undefined;
 private gameReady=false;private resolveGameReady:(()=>void)|undefined;
 feedback='请选择 HD，进入正式的挑战设置界面。';
 answerCorrection:TutorialAnswerCorrection|undefined;
 private correctionInput:PendingAnswerCorrection|undefined;
 private resetCorrectedInput:(()=>void)|undefined;
 private listeners=new Set<()=>void>();private view:MatchView|null=null;
 private clock=Date.now();private runRemaining=0;private rows:ResultRoundView[]=[];private hints:Hint[]=[];
 private results=new Map<string,MatchResultView>();private seen=new Map<string,unknown>();
 private resultReveals=new Set<number>();
 resultId='tutorial-hd';private published=false;
 constructor(private exit:()=>void,checkpoint?:unknown){
  const saved=parseTutorialCheckpoint(checkpoint);if(!saved)return;
  this.resumed=true;this.scene=saved.scene;this.step=saved.step;this.completed=saved.completed;
  this.welcomeSeen=saved.welcomeSeen||saved.step>0||Boolean(saved.view);this.preferences=saved.preferences;
  this.scorePage=saved.scorePage;this.summaryOpen=saved.summaryOpen;this.hintLocation=saved.hintLocation;this.aliasLesson=saved.aliasLesson;this.feedback=saved.feedback;
  this.clock=saved.clock;this.runRemaining=saved.runRemaining;this.autoStep=saved.autoStep;this.autoRemaining=saved.autoRemaining;
  this.view=saved.view;this.rows=saved.rows;this.hints=saved.hints;this.seen=new Map(saved.seen);this.resultReveals=new Set(saved.revealedRounds);
  this.answerDraft=saved.answerDraft;this.resultScrollTop=saved.resultScrollTop;this.published=saved.published;
  if(saved.result)this.results.set(saved.result.id,saved.result);
  // Promises, modal focus and animation callbacks belong to the discarded page.
  if(saved.answerCorrection){this.answerCorrection={...saved.answerCorrection,elapsed:REBUKE_DURATION,settled:saved.answerCorrection.ranks.length,running:false};this.autoRemaining=Math.min(this.autoRemaining,REBUKE_HOLD_MS);}
  if(this.scene==='difficulty'&&this.view){this.scene='game';this.step=2;this.completed=false;this.captionDismissed=false;this.autoStep=-1;this.autoRemaining=0;}
  if(this.scene==='game'&&this.view?.status==='finished'&&saved.result){this.scene='results';this.step=12;this.completed=false;this.captionDismissed=false;this.autoStep=-1;this.autoRemaining=0;}
  this.restoredResult=this.scene==='results'||this.scene==='done';
 }
 get challengeSettingsOpen(){return this.scene==='difficulty'&&this.step===1;}
 get revealedRounds(){return [...this.resultReveals];}
 get wrongAttemptsByRound(){return this.rows.map(row=>[row.round,row.wrongAttempts] as const);}
 resultReveal=(round:number)=>this.resultReveals.has(round)?{title:this.song(round).title,imageUrl:`/api/matches/tutorial-hd/rounds/${round}/result-original`}:null;
 updateAnswerDraft=(value:string)=>{this.answerDraft=value;};
 updateResultScroll=(value:number)=>{this.resultScrollTop=value;};
 exportCheckpoint=()=>({
  version:TUTORIAL_VERSION,rulesVersion:RULES_VERSION,scene:this.scene,step:this.step,welcomeSeen:this.welcomeSeen,completed:this.completed,captionDismissed:this.captionDismissed,
  scorePage:this.scorePage,summaryOpen:this.summaryOpen,hintLocation:this.hintLocation,aliasLesson:this.aliasLesson,feedback:this.feedback,preferences:this.preferences,
  clock:this.clock,runRemaining:this.runRemaining,autoStep:this.autoStep,autoRemaining:this.autoRemaining,view:this.view,rows:this.rows,hints:this.hints,
  answerDraft:this.correctionInput?.original??this.answerDraft,resultScrollTop:this.resultScrollTop,published:this.published,result:this.results.get(this.resultId)??null,
  seen:[...this.seen].slice(-64),revealedRounds:this.revealedRounds,answerCorrection:this.completed?this.answerCorrection??null:null,
 });
 private isCorrectAnswer(answer:string){
  const normalized=answer.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  return [this.song().title,...this.song().aliases].some(alias=>alias.normalize('NFKC').replace(/\s+/g,'').toLowerCase()===normalized);
 }
 prepareAnswer=(answer:string,round:number,update:(value:string)=>void,signal:AbortSignal,reduce=false):Promise<string>=>{
  if(signal.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
  if(this.step!==4||round!==this.view?.round||!this.isCorrectAnswer(answer))return Promise.resolve(answer);
  if(this.answerCorrection||this.completed)this.fail('请等待当前教学反馈完成。');
  const ranks=randomCharacterRanks(Array.from(answer).length),captionRanks=randomCharacterRanks(Array.from(TUTORIAL_WRONG_ANSWER_REBUKE).length);
  this.answerCorrection={elapsed:reduce?REBUKE_DURATION:0,frame:0,settled:reduce?captionRanks.length:0,ranks:captionRanks,running:!reduce};
  this.resetCorrectedInput=()=>update('');
  if(reduce){const scrambled=this.correctedAnswer(answer,ranks,0);update(scrambled);this.notify();return Promise.resolve(scrambled);}
  return new Promise((resolve,reject)=>{
   const job:PendingAnswerCorrection={original:answer,ranks,update,resolve,reject,signal,abort:()=>{}};
   job.abort=()=>{if(this.correctionInput===job)this.cancelAnswerCorrection();};
   this.correctionInput=job;signal.addEventListener('abort',job.abort,{once:true});this.notify();
  });
 };
 private correctedAnswer(answer:string,ranks:number[],frame:number){
  const value=characterTransition(answer,ranks,ranks.length,frame,true);
  return this.isCorrectAnswer(value)?'?'+Array.from(value).slice(1).join(''):value;
 }
 cancelAnswerCorrection=(onlyPending=false)=>{
  if(onlyPending&&!this.correctionInput)return;
  const job=this.correctionInput;this.correctionInput=undefined;
  if(job){job.signal.removeEventListener('abort',job.abort);job.reject(new DOMException('Aborted','AbortError'));}
  this.answerCorrection=undefined;this.resetCorrectedInput=undefined;
 };
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 version=()=>this.revision;
 beginBlackTransition=(onCovered:()=>Promise<void>)=>{this.coveredAction=onCovered;this.blackTransition=true;this.gameReady=false;this.notify();};
 coverBlackTransition=async()=>{await this.coveredAction?.();if(this.scene==='game'&&!this.gameReady)await new Promise<void>(resolve=>{this.resolveGameReady=resolve;});};
 finishBlackTransition=()=>{this.resolveGameReady?.();this.resolveGameReady=undefined;this.coveredAction=undefined;this.blackTransition=false;this.notify();};
 snapshot=()=>this.view;
 canNavigate=(_path:string)=>this.step!==12&&this.step!==13;
 advanceScorePage=(reduce=false)=>{
  if(this.step!==13||this.scene!=='results'||!this.completed||this.blackTransition||this.scoreFastForward)return;
  this.scoreFastForward=true;this.captionDismissed=true;
  this.autoRemaining=reduce?TUTORIAL_SCORE_REDUCED_FADE_MS:TUTORIAL_SCORE_FAST_FADE_MS;
  this.notify();
 };
 finishScoreAdvance=()=>{
  if(!this.scoreFastForward||this.captionDismissed)return;
  this.scoreFastForward=false;this.notify();
 };
 private notify(){
  if(this.completed&&[2,3,4,5,6,7,8,9,10,12,13].includes(this.step)){
   if(this.autoStep!==this.step){this.autoStep=this.step;this.autoRemaining=this.step===4&&this.answerCorrection?Math.max(0,REBUKE_DURATION-this.answerCorrection.elapsed)+REBUKE_HOLD_MS:this.step===3&&this.hintLocation?3000:this.step===7?4000:this.step===13?tutorialScoreSlides[this.scorePage]!.seconds*1000:this.step===5||(this.step===6&&this.aliasLesson)?1800:tutorialDamageSteps.includes(this.step)?1350:1200;}
  }else{this.autoStep=-1;this.autoRemaining=0;}
  if(this.view)this.view={...this.view,serverNow:this.clock,players:this.view.players.map(p=>({...p}))};this.revision++;for(const listener of this.listeners)listener();
 }
 private fail(message:string):never{const error=new Error(message);error.name='TutorialActionError';throw error;}
 updatePreferences=(value:Partial<Preferences>)=>{this.preferences={...this.preferences,...value};this.notify();};
 private record(){return this.rows[this.view!.round]!;}
 private song(round=this.view!.round){return tutorialSongs[Math.min(round,tutorialSongs.length-1)]!;}
 private begin(){
  this.hints=[];this.rows=[];this.seen.clear();this.clock=Date.now();
  this.view={id:'tutorial-hd',mode:'practice',difficulty:'hd',healthCapacity:20,healthEnabled:true,status:'playing',round:0,totalRounds:5,endless:false,serverNow:this.clock,startsAt:this.clock-5000,deadline:this.clock+25000,nextAt:0,imageUrl:null,answer:null,players:[{...user,health:12,score:0,answered:false}],rulesVersion:RULES_VERSION};
  this.addRow();
 }
 private addRow(){const m=this.view!;this.rows.push({round:m.round,title:null,difficulty:m.difficulty,score:0,correct:false,attempts:0,wrongAttempts:0,hintsUsed:0,noiseHits:0,elapsedMs:null,imageUrl:`/api/matches/${m.id}/rounds/${m.round}/result-image`});}
 private nextRound(){const m=this.view!;m.round++;m.status='playing';m.startsAt=this.clock-5000;m.deadline=m.startsAt+30000;m.players[0]!.answered=false;m.answer=null;this.answerDraft='';this.hints=[];this.addRow();}
 private elapsed(ms:number){const m=this.view!;this.clock=m.startsAt+ms;}
 private finishResult(){
  const m=this.view!,row=this.record();if(row.elapsedMs===null)row.elapsedMs=Math.max(0,Math.min(30000,this.clock-m.startsAt));
  this.resultId=m.id;
  this.results.set(m.id,{id:m.id,mode:'practice',difficulty:m.difficulty,status:'interrupted',rules_version:RULES_VERSION,created_at:new Date().toISOString(),finished_at:new Date().toISOString(),health_capacity:20,round_count:5,round_seconds:30,endless:false,published:false,players:[{user_id:user.id,name:user.name,score:m.players[0]!.score,correct:this.rows.filter(r=>r.correct).length,health:m.players[0]!.health!}],rounds:this.rows.map(r=>({...r}))});
 }
 navigate=(path:string)=>{
  this.captionDismissed=false;
  if(path.startsWith('/play/tutorial-')){this.scene='game';this.step=2;this.completed=false;this.feedback='点击曲绘放大，再使用原界面的关闭按钮返回。';}
  else if(path.startsWith('/results/tutorial-')){this.scene='results';this.step=12;this.completed=false;this.feedback='这是正式结算组件。点击未猜出曲目的抽象曲绘，揭晓原图与曲名。';}
  else if(path==='/account'&&this.step===12&&this.completed){this.next();return;}
  else if(path==='/account'&&this.step===14){markTutorialDone();this.scene='done';this.step=15;this.completed=true;}
  else if(path==='/account')this.exit();
  else this.fail('教程内无法打开这个页面。');
  this.notify();
 };
 event=(name:string)=>{
  if(name==='welcome-finished')this.welcomeSeen=true;
  if(name==='game-ready'){this.gameReady=true;this.resolveGameReady?.();this.resolveGameReady=undefined;return;}
  if(name==='caption-dismiss')this.captionDismissed=true;
  if(name==='summary-opened'&&this.step===14){this.summaryOpen=true;this.captionDismissed=false;}
  if(name==='settings')this.feedback='教程沿用当前音量与动效设置。如需调整，可退出教程，到主界面的设置页修改。';
  if(name==='challenge-settings'&&this.step===0){this.step=1;this.captionDismissed=false;this.feedback='保持 5 题、30 秒、20HP，点击原界面的「确认并开始」。';}
  if(name==='zoom-open')this.zoomOpen=true;
  if(name==='zoom-close'){this.zoomOpen=false;if(this.step===2){this.completed=true;this.feedback='大图查看完成。正式挑战中，放大不会暂停计时。';}}
  if((this.step===9&&name==='noise-click')||(this.step===10&&name==='noise-hover')){this.completed=true;this.feedback=this.step===9?'红区命中扣 1HP，提交被覆盖时也只扣血，不提交答案。':'持续悬停满 2 秒扣 1HP；移出清零计时，声音恢复。';}
  if(name==='result-revealed'&&this.step===12){this.completed=true;this.feedback='正确答案已揭晓，接下来了解计分规则。';}
  this.notify();
 };
 next=()=>{
  if(!this.completed)return;
  if(this.step===4&&this.answerCorrection){this.answerDraft='';this.resetCorrectedInput?.();this.cancelAnswerCorrection();}
  if(this.step===6&&this.aliasLesson){this.aliasLesson=false;this.completed=false;this.captionDismissed=false;this.nextRound();this.notify();return;}
  this.completed=false;this.captionDismissed=false;this.hintLocation=false;this.step++;
  if(this.step===6){this.aliasLesson=true;this.nextRound();}
  if(this.step===7)this.nextRound();
  if(this.step===7){this.elapsed(27000);this.completed=true;}
  if(this.step===8){if(this.view!.players[0]!.answered)this.nextRound();this.elapsed(29200);this.runRemaining=2000;}
  if(this.step===11)this.feedback='使用左上角原有返回按钮：第一次展开「放弃？」，第二次确认，观察黑屏到结算。';
  else this.feedback='操作高亮控件完成当前步骤。';
  if(this.step===13)this.showFinalResult();
  if(this.step===14)this.feedback='点击 NEXT 查看综合牌，选择是否公布。教学不会上传成绩。';
  this.notify();
 };
 private showFinalResult(){
  // Keep the existing result, reveal state and scroll position throughout the lessons.
  this.completed=true;this.feedback='计分规则直接展示在当前结算中。阅读后继续查看综合成绩牌。';
 }
 tick=(delta:number)=>{
  if(this.zoomOpen||this.blackTransition)return;
  let changed=false;
  const correction=this.answerCorrection;
  if(correction?.running){
   correction.elapsed=Math.min(REBUKE_DURATION,correction.elapsed+delta);correction.frame++;
   correction.settled=Math.min(correction.ranks.length,Math.max(0,Math.floor((correction.elapsed-CHARACTER_REVEAL_DELAY_MS)/CHARACTER_TRANSITION_MS*correction.ranks.length)));
   const job=this.correctionInput;
   if(job){
    const count=Math.min(job.ranks.length,Math.floor(correction.elapsed/CHARACTER_TRANSITION_MS*job.ranks.length));
    const value=correction.elapsed>=CHARACTER_TRANSITION_MS?this.correctedAnswer(job.original,job.ranks,correction.frame):characterTransition(job.original,job.ranks,count,correction.frame,true);
    job.update(value);
    if(correction.elapsed>=CHARACTER_TRANSITION_MS){this.correctionInput=undefined;job.signal.removeEventListener('abort',job.abort);job.resolve(value);}
   }
   if(correction.elapsed===REBUKE_DURATION)correction.running=false;
   changed=true;
  }
  if(this.runRemaining){
   const step=Math.min(delta,this.runRemaining);this.clock+=step*(this.step===8?.4:1);this.runRemaining-=step;changed=true;
   if(!this.runRemaining){
   if(this.step===8){const m=this.view!,row=this.record();m.status='reveal';m.nextAt=this.clock+2000;row.elapsedMs=30000;const cost=timeoutHealthCost(row.wrongAttempts);m.players[0]!.health=Math.max(1,m.players[0]!.health!-cost);this.feedback=`粉区完成 2 秒教学闪烁，转为噪域。本题超时扣 ${cost}HP。`;}
   this.completed=true;
   }
  }
  if(this.autoRemaining>0){
   this.autoRemaining=Math.max(0,this.autoRemaining-delta);
   if(this.autoRemaining<=350&&!this.captionDismissed){this.captionDismissed=true;changed=true;}
   if(!this.autoRemaining){
    if(this.step===3&&!this.hintLocation){this.hintLocation=true;this.captionDismissed=false;this.autoStep=-1;this.notify();}
    else if(this.step===13&&this.scorePage<tutorialScoreSlides.length-1){this.scorePage++;this.captionDismissed=false;this.autoStep=-1;this.notify();}
    else this.next();
    return;
   }
  }
  if(changed)this.notify();
 };
 request=async<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>=>{
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const input=(body??{}) as Record<string,any>;let response:unknown;
  if(path==='me/active')return {match:null} as T;
  if(path==='matches/practice'&&method==='POST'){
   const options=input as GameOptions;if(options.difficulty!=='hd'||options.healthCapacity!==20)this.fail('这次教学请使用 HD 和 20HP。');
   this.begin();this.notify();return this.view as T;
  }
  const match=path.match(/^matches\/(tutorial-(?:hd|at|summary))(?:\/(.*))?$/);
  if(!match)this.fail('教学请求已隔离，不能访问正式账号或比赛。');
  const [,id,operation='']=match;
  if(operation==='result'){const result=this.results.get(id!);if(!result)this.fail('教学结算尚未生成。');return result as T;}
  if(operation.match(/^rounds\/\d+\/result-reveal$/)){const round=Number(operation.split('/')[1]);this.resultReveals.add(round);return this.resultReveal(round) as T;}
  if(operation==='publication'){this.published=Boolean(input.published);return {published:this.published} as T;}
  if(!this.view||id!==this.view.id)this.fail('该教学场次尚未开始。');
  const m=this.view!,row=this.record();
  if(!operation)return m as T;
  if(operation==='progress')return this.rows.filter(r=>r.attempts>0).map(r=>({round:r.round,correct:r.correct,title:r.correct?this.song(r.round).title:null,score:r.score,answer_text:r.correct?this.song(r.round).title:'练习错误答案'})) as T;
  if(operation.match(/^rounds\/\d+\/hints$/))return [...this.hints] as T;
  if(input.requestId&&this.seen.has(input.requestId))return this.seen.get(input.requestId) as T;
  if(operation.match(/^rounds\/\d+\/hints\/\d$/)){
   if(this.step!==3)this.fail('先完成当前教学步骤，再使用提示。');
   const index=Number(operation.at(-1));if(!this.hints.some(h=>h.index===index))this.hints.push({index,content:index===2?'HD → EZ':this.song().hints[index]!,kind:index===2?'downgrade':index===0?'range':'identity',difficulty:index===2?'ez':null});
   row.hintsUsed=this.hints.length;this.completed=true;this.feedback='第一条是章节范围。提示本身不减分，但影响答对回血；第三条才降低题图难度。';response=[...this.hints];
  }else if(operation==='guesses'){
   if((![4,5,7].includes(this.step)&&!(this.step===6&&this.aliasLesson))||m.players[0]!.answered)this.fail('请跟随当前教学步骤操作。');
   if(this.correctionInput||(this.step===4&&this.completed))this.fail('请等待当前教学反馈完成。');
   const correct=this.step!==4&&this.isCorrectAnswer(String(input.answer??''));
   row.attempts++;row.elapsedMs=this.clock-m.startsAt;
   if(correct){row.correct=true;row.title=this.song().title;row.score=scoreAnswer(m.difficulty,row.elapsedMs,30000,row.wrongAttempts);m.players[0]!.score+=row.score;m.players[0]!.health=Math.min(20,m.players[0]!.health!+correctHealthGain(this.hints.length));m.players[0]!.answered=true;m.status='reveal';m.nextAt=this.clock+2000;if(this.step===7)this.feedback='粉区没有拦截提交，已正常答对。';else if(this.step===6&&this.aliasLesson)this.feedback='别名也能判定答对，正常计分与回血。';else{this.step=5;this.feedback='答对后已揭晓原图。这次用过 1 条提示，因此回复 3HP。';}this.completed=true;}
   else{row.wrongAttempts++;m.players[0]!.health=Math.max(1,m.players[0]!.health!-1);if(this.step===4)this.completed=true;this.feedback=this.answerCorrection?TUTORIAL_WRONG_ANSWER_REBUKE:'答错扣 1HP，接下来输入正确曲名。';}
   response={correct,score:correct?row.score:0,elapsedMs:row.elapsedMs};
  }else if(operation==='skip'){
   if(this.step!==6||this.aliasLesson)this.fail('跳过会结束当前题。请先完成当前教学。');
   if(m.status==='playing'){m.players[0]!.health=Math.max(1,m.players[0]!.health!-timeoutHealthCost(row.wrongAttempts));m.deadline=this.clock;m.status='reveal';m.nextAt=this.clock+2000;row.elapsedMs=this.clock-m.startsAt;}
   this.completed=true;this.feedback='二次确认跳过成功，未答错时按超时规则扣 5HP。粉区闪烁后会覆盖为红区。';response=m;
  }else if(operation==='noise-hits'){
   if(![9,10].includes(this.step)||this.completed)response=m;
   else{m.players[0]!.health=Math.max(1,m.players[0]!.health!-1);row.noiseHits++;response=m;}
  }else if(operation==='return'){
   if(this.step===11){m.status='finished';this.finishResult();response=m;}
   else this.fail('这一步先完成当前练习；随时可以使用教程的退出按钮。');
  }else this.fail('教学模式不支持这个请求。');
  this.notify();if(response===m)response=this.view;
  if(input.requestId)this.seen.set(input.requestId,response);
  return response as T;
 };
 media:typeof fetch=async(input,init)=>{
  const path=String(input),match=path.match(/^\/api\/matches\/(tutorial-(?:hd|at|summary))\/rounds\/(\d+)\/(image|original|result-image|result-original)$/);
  if(!match)throw new Error('Teaching media cannot access a live match');
  const [,id,index,kind]=match;const saved=this.results.get(id!);
  const original=kind!.includes('original')||(kind==='result-image'&&saved?.rounds[Number(index)]?.correct);
  const difficulty=kind==='image'?(this.hints.find(h=>h.kind==='downgrade')?.difficulty??this.view?.difficulty??'hd'):saved?.difficulty??'hd';
  const song=this.song(Number(index));
  return fetch(original?song.images.original:song.images[difficulty],{signal:init?.signal});
 };
}
