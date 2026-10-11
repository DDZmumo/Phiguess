import {z} from 'zod';
import {Difficulty,RULES_VERSION} from '../../../packages/contracts/src';
import {TUTORIAL_VERSION,tutorialScoreSlides,TUTORIAL_WRONG_ANSWER_REBUKE} from './tutorial-model';

export const TUTORIAL_REFRESH_KEY='phiguess-tutorial-refresh-v1';
type TemporaryStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const count=z.number().int().min(0),round=count.max(3),time=z.number().min(0);
const resultRow=z.object({round,title:z.string().max(200).nullable(),difficulty:Difficulty,score:count.max(3000),correct:z.boolean(),attempts:count,wrongAttempts:count,hintsUsed:count.max(3),noiseHits:count,elapsedMs:time.nullable(),imageUrl:z.string().regex(/^\/api\/matches\/tutorial-hd\/rounds\/[0-3]\/result-image$/).nullable()});
const result=z.object({id:z.literal('tutorial-hd'),mode:z.literal('practice'),difficulty:z.literal('hd'),status:z.literal('interrupted'),rules_version:z.literal(RULES_VERSION),created_at:z.string(),finished_at:z.string().nullable(),health_capacity:z.literal(20),round_count:z.literal(5),round_seconds:z.literal(30),endless:z.literal(false),published:z.boolean(),rounds:z.array(resultRow).min(1).max(4),players:z.array(z.object({user_id:z.literal('tutorial-player'),name:z.string(),score:count,correct:count.max(4),health:count.max(20)})).length(1)});
const checkpoint=z.object({
 version:z.literal(TUTORIAL_VERSION),rulesVersion:z.literal(RULES_VERSION),
 scene:z.enum(['difficulty','game','results','done']),step:count.max(15),welcomeSeen:z.boolean(),completed:z.boolean(),captionDismissed:z.boolean(),
 scorePage:count.max(tutorialScoreSlides.length-1),summaryOpen:z.boolean(),hintLocation:z.boolean(),aliasLesson:z.boolean(),feedback:z.string().max(500),
 preferences:z.object({motion:z.boolean(),sound:z.boolean(),volume:z.number().min(0).max(1),musicVolume:z.number().min(0).max(1).optional(),brightness:z.number().min(0).max(1),difficulty:Difficulty,rounds:count.max(20),roundSeconds:count.max(90),healthEnabled:z.boolean().optional(),healthCapacity:z.union([z.literal(0),z.literal(20),z.literal(50)]).optional()}),
 clock:time,runRemaining:time.max(2000),autoStep:z.number().int().min(-1).max(15),autoRemaining:time.max(30000),
 answerDraft:z.string().max(200),resultScrollTop:time.max(10000),published:z.boolean(),
 view:z.object({id:z.literal('tutorial-hd'),mode:z.literal('practice'),difficulty:z.literal('hd'),healthCapacity:z.literal(20),healthEnabled:z.literal(true),status:z.enum(['playing','reveal','finished']),round,totalRounds:z.literal(5),endless:z.literal(false),serverNow:time,startsAt:time,deadline:time,nextAt:time,imageUrl:z.null(),answer:z.null(),players:z.array(z.object({id:z.literal('tutorial-player'),name:z.string(),health:count.min(1).max(20),score:count,answered:z.boolean()})).length(1),rulesVersion:z.literal(RULES_VERSION)}).nullable(),
 rows:z.array(resultRow).max(4),hints:z.array(z.object({index:count.max(2),content:z.string().max(400),kind:z.enum(['range','identity','downgrade']),difficulty:Difficulty.nullable()})).max(3),
 result:result.nullable(),seen:z.array(z.tuple([z.string().max(200),z.unknown()])).max(64),
 revealedRounds:z.array(round).max(4),
 answerCorrection:z.object({elapsed:time.max(1350),frame:count,settled:count,ranks:z.array(count).length(Array.from(TUTORIAL_WRONG_ANSWER_REBUKE).length),running:z.boolean()}).nullable(),
}).refine(value=>{
 if(value.rows.some((row,index)=>row.round!==index))return false;
 if(value.view&&(value.rows.length!==value.view.round+1||value.clock!==value.view.serverNow))return false;
 if(value.scene==='difficulty')return value.step<=1;
 if(!value.view)return false;
 if(value.scene==='game')return value.step>=2&&value.step<=11;
 return Boolean(value.result)&&value.step>=(value.scene==='done'?15:12)&&value.step<=(value.scene==='done'?15:14);
});
export type TutorialCheckpoint=z.infer<typeof checkpoint>;
export function parseTutorialCheckpoint(value:unknown):TutorialCheckpoint|null{
 const parsed=checkpoint.safeParse(value);return parsed.success?parsed.data:null;
}
function browserStorage():TemporaryStorage|undefined{try{return typeof window==='undefined'?undefined:window.sessionStorage;}catch{return undefined;}}
export function clearTutorialRefresh(storage:TemporaryStorage|undefined=browserStorage()){try{storage?.removeItem(TUTORIAL_REFRESH_KEY);}catch{}}
export function readTutorialRefresh(storage:TemporaryStorage|undefined=browserStorage()):TutorialCheckpoint|null{
 try{
  const raw=storage?.getItem(TUTORIAL_REFRESH_KEY);if(!raw)return null;
  const parsed=raw.length<=100000?parseTutorialCheckpoint(JSON.parse(raw)):null;
  if(!parsed)clearTutorialRefresh(storage);return parsed;
 }catch{clearTutorialRefresh(storage);return null;}
}
export function writeTutorialRefresh(value:unknown,storage:TemporaryStorage|undefined=browserStorage()){
 try{storage?.setItem(TUTORIAL_REFRESH_KEY,JSON.stringify(value));}catch{}
}
export function tutorialStartupRoute(hash:string,navigationType:string){return hash==='#/tutorial'&&navigationType!=='reload'?'#/account':hash;}
/** New visits start at the hub; only a real reload can consume this tab's checkpoint. */
export function prepareTutorialStartup(){
 const navigation=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming|undefined;
 const hash=window.location.hash,target=tutorialStartupRoute(hash,navigation?.type??'navigate');
 if(target!==hash||hash!=='#/tutorial')clearTutorialRefresh();
 if(target!==hash)window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search+target);
}
