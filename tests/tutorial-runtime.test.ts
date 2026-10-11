import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TutorialRuntime} from '../apps/web/src/tutorial-runtime';
import {tutorialScoreSlides,TUTORIAL_WRONG_ANSWER_REBUKE,TUTORIAL_SCORE_FAST_FADE_MS,TUTORIAL_SCORE_REDUCED_FADE_MS} from '../apps/web/src/tutorial-model';
import type {MatchView,MatchResultView} from '../packages/contracts/src';
import {tutorialSongs} from '../apps/web/src/tutorial-songs';
import {CHARACTER_TRANSITION_MS,CHARACTER_REVEAL_DELAY_MS,randomCharacterRanks,characterTransition} from '../apps/web/src/character-scramble';

async function reachWrongAnswerLesson(){
 const runtime=new TutorialRuntime(()=>{});
 const match=await runtime.request<MatchView>('matches/practice','POST',{difficulty:'hd',rounds:5,roundSeconds:30,healthCapacity:20});
 runtime.navigate(`/play/${match.id}`);runtime.event('zoom-close');runtime.tick(1200);
 await runtime.request(`matches/${match.id}/rounds/0/hints/0`,'POST');runtime.tick(1200);runtime.tick(3000);
 assert.equal(runtime.step,4);return runtime;
}

async function reachScoreRules(){
 const runtime=await reachWrongAnswerLesson(),path='matches/tutorial-hd';
 await runtime.request(`${path}/guesses`,'POST',{round:0,answer:'wrong'});runtime.tick(1350);
 await runtime.request(`${path}/guesses`,'POST',{round:0,answer:'DS'});runtime.tick(1800);
 await runtime.request(`${path}/guesses`,'POST',{round:1,answer:'米垃圾'});runtime.tick(1800);
 await runtime.request(`${path}/skip`,'POST',{round:2});runtime.tick(1350);runtime.tick(4000);runtime.tick(2000);runtime.tick(1350);
 for(const event of ['noise-click','noise-hover']){await runtime.request(`${path}/noise-hits`,'POST',{round:3});runtime.event(event);runtime.tick(1350);}
 await runtime.request(`${path}/return`,'POST');runtime.navigate('/results/tutorial-hd');runtime.event('result-revealed');runtime.tick(1200);
 assert.equal(runtime.step,13);return runtime;
}

test('clicking score rules fades to one next slide, resumes autoplay and preserves the result',async()=>{
 const runtime=await reachScoreRules(),result=await runtime.request('matches/tutorial-hd/result');
 runtime.advanceScorePage();assert.equal(runtime.captionDismissed,true);assert.equal(runtime.scoreFastForward,true);
 runtime.advanceScorePage();runtime.finishScoreAdvance();runtime.tick(TUTORIAL_SCORE_FAST_FADE_MS-1);
 assert.equal(runtime.scorePage,0);assert.equal(runtime.scoreFastForward,true);
 runtime.tick(1);assert.equal(runtime.scorePage,1);assert.equal(runtime.captionDismissed,false);
 runtime.advanceScorePage();assert.equal(runtime.scorePage,1);
 runtime.tick(TUTORIAL_SCORE_FAST_FADE_MS);runtime.finishScoreAdvance();assert.equal(runtime.scoreFastForward,false);
 runtime.tick(tutorialScoreSlides[1]!.seconds*1000-TUTORIAL_SCORE_FAST_FADE_MS-350);assert.equal(runtime.captionDismissed,true);
 // A click during the automatic fade accelerates the same transition.
 runtime.advanceScorePage();runtime.tick(TUTORIAL_SCORE_FAST_FADE_MS);assert.equal(runtime.scorePage,2);
 runtime.finishScoreAdvance();
 for(let page=2;page<tutorialScoreSlides.length;page++){
  assert.equal(runtime.scorePage,page);runtime.advanceScorePage();runtime.tick(TUTORIAL_SCORE_FAST_FADE_MS);runtime.finishScoreAdvance();
 }
 assert.equal(runtime.step,14);assert.equal(runtime.scorePage,tutorialScoreSlides.length-1);
 assert.equal(runtime.scoreFastForward,false);assert.strictEqual(await runtime.request('matches/tutorial-hd/result'),result);
 runtime.advanceScorePage();assert.equal(runtime.step,14);
});

test('score fast-forward respects reduced motion and only operates in the scoring lesson',async()=>{
 const outside=await reachWrongAnswerLesson();outside.advanceScorePage();assert.equal(outside.step,4);assert.equal(outside.scoreFastForward,false);
 const runtime=await reachScoreRules();runtime.blackTransition=true;runtime.advanceScorePage();assert.equal(runtime.scoreFastForward,false);
 runtime.blackTransition=false;runtime.advanceScorePage(true);
 runtime.tick(TUTORIAL_SCORE_REDUCED_FADE_MS-1);assert.equal(runtime.scorePage,0);
 runtime.tick(1);assert.equal(runtime.scorePage,1);runtime.finishScoreAdvance();
 runtime.tick(tutorialScoreSlides[1]!.seconds*1000);assert.equal(runtime.scorePage,2);assert.equal(runtime.scoreFastForward,false);
});

test('wrong-answer lesson cannot be solved with the real title or aliases',async()=>{
 for(const answer of [tutorialSongs[0]!.title,...tutorialSongs[0]!.aliases,'  ｄｓ９  ']){
  const runtime=await reachWrongAnswerLesson();
  const result=await runtime.request<{correct:boolean;score:number}>('matches/tutorial-hd/guesses','POST',{round:0,answer,requestId:'wrong-lesson'});
  assert.equal(result.correct,false,answer);assert.equal(result.score,0);
  assert.equal(runtime.snapshot()!.players[0]!.health,11);assert.equal(runtime.snapshot()!.players[0]!.answered,false);
 }
});

test('character transitions use shuffled positions for both corruption and revelation',()=>{
 const text='ABCD',ranks=randomCharacterRanks(4,()=>0);
 assert.deepEqual(ranks,[3,0,1,2]);
 const corrupted=Array.from(characterTransition(text,ranks,1,0,true));
 assert.deepEqual(corrupted.flatMap((char,index)=>char!==text[index]?[index]:[]),[1]);
 const revealed=Array.from(characterTransition(text,ranks,1,0));
 assert.deepEqual(revealed.flatMap((char,index)=>char===text[index]?[index]:[]),[1]);
 assert.equal(characterTransition(text,ranks,4,0),text);
 assert.notEqual(characterTransition(text,ranks,0,0),characterTransition(text,ranks,0,1));
});

test('correct title and every alias are corrupted before the tutorial submits them',async()=>{
 for(const answer of [tutorialSongs[0]!.title,...tutorialSongs[0]!.aliases,'  ｄｓ９  ']){
  const runtime=await reachWrongAnswerLesson(),updates:string[]=[];
  let submitted=false;
  const preparation=runtime.prepareAnswer(answer,0,value=>updates.push(value),new AbortController().signal).then(value=>{submitted=true;return value;});
  runtime.tick(CHARACTER_TRANSITION_MS-1);await Promise.resolve();
  assert.equal(submitted,false,answer);assert.equal(runtime.snapshot()!.players[0]!.health,12);
  runtime.tick(1);const corrupted=await preparation;
  assert.notEqual(corrupted,answer);assert.equal(Array.from(corrupted).length,Array.from(answer).length);
  assert.equal(updates.at(-1),corrupted);
  const request={round:0,answer:corrupted,requestId:'corrupted-answer'};
  const result=await runtime.request<{correct:boolean;score:number}>('matches/tutorial-hd/guesses','POST',request);
  await runtime.request('matches/tutorial-hd/guesses','POST',request);
  assert.equal(result.correct,false);assert.equal(result.score,0);assert.equal(runtime.snapshot()!.players[0]!.health,11);
 }
});

test('red rebuke completes before the next lesson and correct answers then work normally',async()=>{
 const runtime=await reachWrongAnswerLesson(),original=tutorialSongs[0]!.title;
 let input:string=original;
 const preparation=runtime.prepareAnswer(original,0,value=>{input=value;},new AbortController().signal);
 assert.equal(runtime.answerCorrection!.settled,0);
 const initialCaption=characterTransition(TUTORIAL_WRONG_ANSWER_REBUKE,runtime.answerCorrection!.ranks,0,0);
 assert.notEqual(initialCaption,TUTORIAL_WRONG_ANSWER_REBUKE);
 runtime.tick(CHARACTER_TRANSITION_MS/2);
 assert.equal(Array.from(input).filter((char,index)=>char!==Array.from(original)[index]).length,Math.floor(Array.from(original).length/2));
 assert.equal(runtime.answerCorrection!.settled,0);assert.equal(runtime.completed,false);
 runtime.tick(CHARACTER_TRANSITION_MS/2);const corrupted=await preparation;
 await assert.rejects(async()=>runtime.prepareAnswer(original,0,()=>{},new AbortController().signal),/等待/);
 await runtime.request('matches/tutorial-hd/guesses','POST',{round:0,answer:corrupted,requestId:'rebuke'});
 assert.equal(runtime.feedback,TUTORIAL_WRONG_ANSWER_REBUKE);assert.equal(runtime.step,4);
 runtime.tick(CHARACTER_REVEAL_DELAY_MS);
 const correction=runtime.answerCorrection!;
 assert.equal(correction.running,false);
 assert.equal(characterTransition(TUTORIAL_WRONG_ANSWER_REBUKE,correction.ranks,correction.settled,correction.frame),TUTORIAL_WRONG_ANSWER_REBUKE);
 runtime.tick(1499);assert.equal(runtime.step,4);assert.equal(runtime.captionDismissed,true);
 runtime.tick(1);assert.equal(runtime.step,5);assert.equal(runtime.answerCorrection,undefined);assert.equal(input,'');
 const normal=await runtime.prepareAnswer(original,0,()=>assert.fail('normal correct answers must not be changed'),new AbortController().signal);
 const result=await runtime.request<{correct:boolean;score:number}>('matches/tutorial-hd/guesses','POST',{round:0,answer:normal,requestId:'normal-correct'});
 assert.equal(result.correct,true);assert.equal(result.score,900);assert.equal(runtime.snapshot()!.players[0]!.health,14);
});

test('cancelling the correction leaves the lesson and health unchanged',async()=>{
 const runtime=await reachWrongAnswerLesson(),controller=new AbortController(),updates:string[]=[];
 const preparation=runtime.prepareAnswer('DS',0,value=>updates.push(value),controller.signal);
 const rejected=assert.rejects(preparation,{name:'AbortError'});
 runtime.tick(350);controller.abort();await rejected;
 const count=updates.length;runtime.tick(5000);
 assert.equal(updates.length,count);assert.equal(runtime.answerCorrection,undefined);assert.equal(runtime.step,4);
 assert.equal(runtime.completed,false);assert.equal(runtime.snapshot()!.players[0]!.health,12);
 assert.deepEqual(await runtime.request('matches/tutorial-hd/progress'),[]);
 const alreadyAborted=new AbortController();alreadyAborted.abort();
 await assert.rejects(runtime.prepareAnswer('DS',0,()=>{},alreadyAborted.signal),{name:'AbortError'});
 const retry=runtime.prepareAnswer('DS',0,()=>{},new AbortController().signal);runtime.tick(700);
 assert.notEqual(await retry,'DS');runtime.cancelAnswerCorrection();
});

test('ordinary wrong answers and reduced motion both continue the tutorial',async()=>{
 const ordinary=await reachWrongAnswerLesson();
 const answer=await ordinary.prepareAnswer('试试看',0,()=>assert.fail('ordinary wrong answer should stay intact'),new AbortController().signal);
 assert.equal(answer,'试试看');assert.equal(ordinary.answerCorrection,undefined);
 await ordinary.request('matches/tutorial-hd/guesses','POST',{round:0,answer,requestId:'ordinary'});
 ordinary.tick(1350);assert.equal(ordinary.step,5);
 const reduced=await reachWrongAnswerLesson();let input='DS';
 const corrupted=await reduced.prepareAnswer(input,0,value=>{input=value;},new AbortController().signal,true);
 assert.equal(input,corrupted);assert.notEqual(input,'DS');
 const correction=reduced.answerCorrection!;
 assert.equal(correction.running,false);assert.equal(correction.settled,Array.from(TUTORIAL_WRONG_ANSWER_REBUKE).length);
 const result=await reduced.request<{correct:boolean}>('matches/tutorial-hd/guesses','POST',{round:0,answer:corrupted,requestId:'reduced'});
 assert.equal(result.correct,false);assert.equal(reduced.snapshot()!.players[0]!.health,11);
 reduced.tick(1500);assert.equal(reduced.step,5);assert.equal(input,'');
});

test('black transition holds automatic lessons until the covered action and fade finish',async()=>{
 const runtime=new TutorialRuntime(()=>{});let covered=false;
 await runtime.request('matches/practice','POST',{difficulty:'hd',rounds:5,roundSeconds:30,healthCapacity:20});
 runtime.navigate('/play/tutorial-hd');runtime.event('zoom-close');
 runtime.beginBlackTransition(async()=>{covered=true;});runtime.tick(2000);
 assert.equal(runtime.step,2);assert.equal(covered,false);assert.equal(runtime.blackTransition,true);
 const pending=runtime.coverBlackTransition();assert.equal(covered,true);runtime.tick(2000);assert.equal(runtime.step,2);
 runtime.event('game-ready');await pending;
 runtime.finishBlackTransition();runtime.tick(1200);assert.equal(runtime.step,3);assert.equal(runtime.blackTransition,false);
});

test('four-song tutorial accepts aliases, extends its flash and preserves the result during scoring',async()=>{
 let exited=false;const runtime=new TutorialRuntime(()=>{exited=true;});
 await assert.rejects(runtime.request('auth/login','POST',{name:'someone',password:'not-sent'}));
 await assert.rejects(runtime.request('matches/real-match/guesses','POST',{}));
 assert.deepEqual(await runtime.request('me/active'),{match:null});
 const match=await runtime.request<MatchView>('matches/practice','POST',{difficulty:'hd',rounds:5,roundSeconds:30,healthCapacity:20});
 runtime.navigate(`/play/${match.id}`);assert.equal(runtime.step,2);assert.equal(runtime.snapshot()!.players[0]!.health,12);
 runtime.event('zoom-open');runtime.event('zoom-close');runtime.tick(1200);assert.equal(runtime.step,3);
 await runtime.request(`matches/${match.id}/rounds/0/hints/0`,'POST');runtime.tick(1200);assert.equal(runtime.hintLocation,true);
 runtime.tick(3000);assert.equal(runtime.step,4);
 const wrong={round:0,answer:'wrong',requestId:'wrong-1'};await runtime.request(`matches/${match.id}/guesses`,'POST',wrong);await runtime.request(`matches/${match.id}/guesses`,'POST',wrong);
 assert.equal(runtime.snapshot()!.players[0]!.health,11);runtime.tick(999);assert.equal(runtime.captionDismissed,false);runtime.tick(1);assert.equal(runtime.captionDismissed,true);runtime.tick(350);assert.equal(runtime.step,5);
 const correct=await runtime.request<{score:number;correct:boolean}>(`matches/${match.id}/guesses`,'POST',{round:0,answer:' Desultory Signals ',requestId:'correct-1'});assert.equal(correct.correct,true);assert.equal(correct.score,900);assert.equal(runtime.snapshot()!.players[0]!.health,14);
 runtime.tick(1800);assert.equal(runtime.snapshot()!.round,1);assert.equal(runtime.aliasLesson,true);
 const alias=await runtime.request<{correct:boolean;score:number}>(`matches/${match.id}/guesses`,'POST',{round:1,answer:'米垃圾',requestId:'alias'});assert.equal(alias.correct,true);assert.equal(alias.score,1000);assert.equal(runtime.snapshot()!.players[0]!.health,19);
 runtime.tick(1800);assert.equal(runtime.aliasLesson,false);assert.equal(runtime.snapshot()!.round,2);await runtime.request(`matches/${match.id}/skip`,'POST',{round:2});assert.equal(runtime.snapshot()!.players[0]!.health,14);
 runtime.tick(1350);assert.equal(runtime.step,7);assert.equal(runtime.snapshot()!.round,3);runtime.tick(4000);assert.equal(runtime.step,8);runtime.tick(1999);assert.equal(runtime.snapshot()!.status,'playing');runtime.tick(1);assert.equal(runtime.snapshot()!.status,'reveal');assert.equal(runtime.snapshot()!.players[0]!.health,9);
 runtime.tick(1350);assert.equal(runtime.step,9);await runtime.request(`matches/${match.id}/noise-hits`,'POST',{round:3,requestId:'click'});runtime.event('noise-click');runtime.tick(1350);await runtime.request(`matches/${match.id}/noise-hits`,'POST',{round:3,requestId:'hover'});runtime.event('noise-hover');runtime.tick(1350);assert.equal(runtime.step,11);
 await runtime.request(`matches/${match.id}/return`,'POST');const result=await runtime.request<MatchResultView>(`matches/${match.id}/result`);assert.equal(result.rounds.length,4);assert.equal(result.players[0]!.score,1900);assert.equal(result.players[0]!.correct,2);assert.equal(result.players[0]!.health,7);
 assert.deepEqual(result.rounds.slice(0,2).map(r=>r.title),['Desultory Signals','Exoplanetary Mirage']);
 runtime.navigate(`/results/${match.id}`);const reveal=await runtime.request<{title:string}>(`matches/${match.id}/rounds/2/result-reveal`);assert.equal(reveal.title,'Entrance to the Chaos');runtime.event('result-revealed');runtime.tick(1200);assert.equal(runtime.step,13);assert.equal(runtime.scene,'results');assert.equal(exited,false);
 assert.equal(runtime.resultId,match.id);assert.strictEqual(await runtime.request(`matches/${match.id}/result`),result);assert.equal(runtime.canNavigate('/account'),false);
 for(let page=0;page<tutorialScoreSlides.length;page++){
  assert.equal(runtime.scorePage,page);runtime.tick(tutorialScoreSlides[page]!.seconds*1000-350);assert.equal(runtime.captionDismissed,true);runtime.tick(350);
 }
 assert.equal(runtime.step,14);assert.equal(runtime.canNavigate('/account'),true);assert.equal(runtime.resultId,match.id);
 runtime.navigate('/account');assert.equal(runtime.step,15);assert.equal(runtime.scene,'done');
});
