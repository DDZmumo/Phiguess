import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TutorialRuntime} from '../apps/web/src/tutorial-runtime';
import {parseTutorialCheckpoint,readTutorialRefresh,writeTutorialRefresh,clearTutorialRefresh,tutorialStartupRoute,TUTORIAL_REFRESH_KEY} from '../apps/web/src/tutorial-refresh';
import {tutorialScoreSlides,TUTORIAL_SCORE_FAST_FADE_MS} from '../apps/web/src/tutorial-model';
import type {MatchView,MatchResultView} from '../packages/contracts/src';

function temporaryStorage(){
 const values=new Map<string,string>([['unrelated','keep']]);
 return {values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
}
function reload(runtime:TutorialRuntime){
 const storage=temporaryStorage();writeTutorialRefresh(runtime.exportCheckpoint(),storage);
 const checkpoint=readTutorialRefresh(storage);assert.ok(checkpoint,'every checkpoint must be readable');
 // React StrictMode reads the initializer twice, before the effect clears the temporary key.
 assert.deepEqual(readTutorialRefresh(storage),checkpoint);
 const restored=new TutorialRuntime(()=>{},checkpoint);assert.equal(restored.resumed,true);return restored;
}
async function wrongLesson(){
 const runtime=new TutorialRuntime(()=>{});
 await runtime.request('matches/practice','POST',{difficulty:'hd',healthCapacity:20});runtime.navigate('/play/tutorial-hd');
 runtime.event('zoom-close');runtime.tick(1200);await runtime.request('matches/tutorial-hd/rounds/0/hints/0','POST');runtime.tick(1200);runtime.tick(3000);
 return runtime;
}

test('refresh restores settings, draft, hints, answers and the remaining teaching countdown',async()=>{
 let runtime=new TutorialRuntime(()=>{});runtime.event('welcome-finished');runtime.event('challenge-settings');
 runtime.updatePreferences({volume:.2});runtime=reload(runtime);
 assert.equal(runtime.step,1);assert.equal(runtime.welcomeSeen,true);assert.equal(runtime.challengeSettingsOpen,true);assert.equal(runtime.preferences.volume,.2);
 await runtime.request<MatchView>('matches/practice','POST',{difficulty:'hd',healthCapacity:20});
 // Refresh between creating the local match and finishing the black transition.
 runtime=reload(runtime);assert.equal(runtime.scene,'game');assert.equal(runtime.step,2);
 runtime.event('zoom-open');runtime=reload(runtime);assert.equal(runtime.zoomOpen,false);
 runtime.event('zoom-close');runtime.tick(450);runtime=reload(runtime);runtime.tick(749);assert.equal(runtime.step,2);runtime.tick(1);assert.equal(runtime.step,3);
 await runtime.request('matches/tutorial-hd/rounds/0/hints/0','POST');runtime.tick(1200);runtime.tick(500);
 runtime=reload(runtime);assert.equal(runtime.hintLocation,true);assert.equal((await runtime.request<unknown[]>('matches/tutorial-hd/rounds/0/hints')).length,1);
 runtime.tick(2500);assert.equal(runtime.step,4);runtime.updateAnswerDraft('试试看');runtime=reload(runtime);assert.equal(runtime.answerDraft,'试试看');
 const request={round:0,answer:'试试看',requestId:'wrong-once'};
 await runtime.request('matches/tutorial-hd/guesses','POST',request);runtime.tick(400);runtime=reload(runtime);
 const snapshot=runtime.snapshot()!;assert.equal(snapshot.players[0]!.health,11);assert.equal(snapshot.players[0]!.score,0);
 assert.deepEqual(runtime.wrongAttemptsByRound,[[0,1]]);
 await runtime.request('matches/tutorial-hd/guesses','POST',request);assert.equal(runtime.snapshot()!.players[0]!.health,11);
 runtime.tick(950);assert.equal(runtime.step,5);
 await runtime.request('matches/tutorial-hd/guesses','POST',{round:0,answer:'DS',requestId:'correct'});runtime=reload(runtime);
 assert.equal(runtime.snapshot()!.players[0]!.answered,true);assert.equal(runtime.snapshot()!.players[0]!.health,14);assert.equal(runtime.snapshot()!.players[0]!.score,900);
 runtime.tick(1800);assert.equal(runtime.aliasLesson,true);assert.equal(runtime.snapshot()!.round,1);assert.equal(runtime.answerDraft,'');
});

test('refresh continues later rounds, timeout, result reveals, scoring slides and summary',async()=>{
 let runtime=await wrongLesson();const path='matches/tutorial-hd';
 await runtime.request(`${path}/guesses`,'POST',{round:0,answer:'wrong'});runtime.tick(1350);
 await runtime.request(`${path}/guesses`,'POST',{round:0,answer:'DS'});runtime.tick(1800);
 await runtime.request(`${path}/guesses`,'POST',{round:1,answer:'米垃圾'});runtime.tick(1800);runtime=reload(runtime);
 assert.equal(runtime.step,6);assert.equal(runtime.aliasLesson,false);assert.equal(runtime.snapshot()!.round,2);
 await runtime.request(`${path}/skip`,'POST',{round:2});runtime=reload(runtime);assert.equal(runtime.snapshot()!.players[0]!.health,14);
 runtime.tick(1350);runtime.tick(4000);runtime.tick(800);const frozen=runtime.snapshot()!.serverNow;runtime=reload(runtime);
 assert.equal(runtime.step,8);assert.equal(runtime.snapshot()!.serverNow,frozen);runtime.tick(1200);assert.equal(runtime.snapshot()!.players[0]!.health,9);
 runtime.tick(1350);
 for(const event of ['noise-click','noise-hover']){
  await runtime.request(`${path}/noise-hits`,'POST',{round:3,requestId:event});runtime.event(event);runtime=reload(runtime);
  const health=runtime.snapshot()!.players[0]!.health;await runtime.request(`${path}/noise-hits`,'POST',{round:3,requestId:event});assert.equal(runtime.snapshot()!.players[0]!.health,health);runtime.tick(1350);
 }
 await runtime.request(`${path}/return`,'POST');runtime=reload(runtime);assert.equal(runtime.scene,'results');assert.equal(runtime.step,12);
 await runtime.request(`${path}/rounds/2/result-reveal`);runtime.event('result-revealed');runtime.updateResultScroll(136);runtime.tick(1200);
 const result=await runtime.request<MatchResultView>(`${path}/result`);runtime=reload(runtime);
 assert.equal(runtime.restoredResult,true);assert.equal(runtime.step,13);assert.equal(runtime.resultScrollTop,136);
 assert.deepEqual(runtime.revealedRounds,[2]);assert.equal(runtime.resultReveal(2)!.title,'Entrance to the Chaos');assert.deepEqual(await runtime.request(`${path}/result`),result);
 runtime.advanceScorePage();runtime.tick(50);runtime=reload(runtime);assert.equal(runtime.scoreFastForward,false);
 runtime.tick(TUTORIAL_SCORE_FAST_FADE_MS-50);assert.equal(runtime.scorePage,1);
 runtime.tick(1200);runtime=reload(runtime);assert.equal(runtime.scorePage,1);runtime.tick(tutorialScoreSlides[1]!.seconds*1000-1200);assert.equal(runtime.scorePage,2);
 for(let page=2;page<tutorialScoreSlides.length;page++)runtime.tick(tutorialScoreSlides[page]!.seconds*1000);
 runtime.event('summary-opened');runtime=reload(runtime);assert.equal(runtime.step,14);assert.equal(runtime.summaryOpen,true);
 runtime.navigate('/account');runtime=reload(runtime);assert.equal(runtime.scene,'done');assert.equal(runtime.step,15);
});

test('refresh during answer corruption neither duplicates damage nor restores a pending promise',async()=>{
 const runtime=await wrongLesson(),controller=new AbortController();runtime.updateAnswerDraft('DS');
 const pending=runtime.prepareAnswer('DS',0,value=>runtime.updateAnswerDraft(value),controller.signal);runtime.tick(350);
 const restored=reload(runtime);assert.equal(restored.answerDraft,'DS');assert.equal(restored.answerCorrection,undefined);assert.equal(restored.snapshot()!.players[0]!.health,12);
 const rejected=assert.rejects(pending,{name:'AbortError'});controller.abort();await rejected;
 const retry=restored.prepareAnswer('DS',0,value=>restored.updateAnswerDraft(value),new AbortController().signal);restored.tick(700);
 await restored.request('matches/tutorial-hd/guesses','POST',{round:0,answer:await retry,requestId:'correction'});
 const after=reload(restored);after.cancelAnswerCorrection(true);assert.equal(after.answerCorrection!.running,false);assert.equal(after.snapshot()!.players[0]!.health,11);
 after.tick(1500);assert.equal(after.step,5);assert.equal(after.answerDraft,'');assert.equal(after.snapshot()!.players[0]!.health,11);
});

test('fresh visits and reopened tutorial URLs go to the hub instead of resuming',()=>{
 assert.equal(tutorialStartupRoute('#/tutorial','reload'),'#/tutorial');
 for(const type of ['navigate','back_forward','prerender'])assert.equal(tutorialStartupRoute('#/tutorial',type),'#/account');
 assert.equal(tutorialStartupRoute('#/account','reload'),'#/account');assert.equal(tutorialStartupRoute('','navigate'),'');
 const storage=temporaryStorage();writeTutorialRefresh(new TutorialRuntime(()=>{}).exportCheckpoint(),storage);
 clearTutorialRefresh(storage);assert.equal(readTutorialRefresh(storage),null);assert.equal(storage.values.get('unrelated'),'keep');
 assert.equal(readTutorialRefresh(temporaryStorage()),null);
});

test('invalid or unavailable temporary storage safely starts a fresh tutorial',()=>{
 const valid=new TutorialRuntime(()=>{}).exportCheckpoint(),storage=temporaryStorage();
 for(const raw of ['{broken',JSON.stringify({...valid,version:'old'}),JSON.stringify({...valid,step:8}),JSON.stringify({...valid,scene:'results',step:13}),JSON.stringify({...valid,scorePage:100})]){
  storage.setItem(TUTORIAL_REFRESH_KEY,raw);assert.equal(readTutorialRefresh(storage),null);assert.equal(storage.values.has(TUTORIAL_REFRESH_KEY),false);
 }
 assert.equal(parseTutorialCheckpoint({...valid,view:{id:'live-match'}}),null);
 const blocked={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}};
 assert.equal(readTutorialRefresh(blocked),null);assert.doesNotThrow(()=>writeTutorialRefresh(valid,blocked));assert.doesNotThrow(()=>clearTutorialRefresh(blocked));
 const fresh=new TutorialRuntime(()=>{},{});assert.equal(fresh.step,0);assert.equal(fresh.resumed,false);
});
