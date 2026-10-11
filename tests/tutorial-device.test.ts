import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shouldSkipTutorialHover} from '../apps/web/src/tutorial-device';
import {TutorialRuntime} from '../apps/web/src/tutorial-runtime';

async function noiseLesson(skipHoverLesson:boolean){
 const runtime=new TutorialRuntime(()=>{},undefined,{skipHoverLesson}),path='matches/tutorial-hd';
 await runtime.request('matches/practice','POST',{difficulty:'hd',healthCapacity:20});runtime.navigate('/play/tutorial-hd');
 runtime.event('zoom-close');runtime.tick(1200);await runtime.request(`${path}/rounds/0/hints/0`,'POST');runtime.tick(1200);runtime.tick(3000);
 await runtime.request(`${path}/guesses`,'POST',{round:0,answer:'wrong'});runtime.tick(1350);
 await runtime.request(`${path}/guesses`,'POST',{round:0,answer:'DS'});runtime.tick(1800);
 await runtime.request(`${path}/guesses`,'POST',{round:1,answer:'米垃圾'});runtime.tick(1800);
 await runtime.request(`${path}/skip`,'POST',{round:2});runtime.tick(1350);runtime.tick(4000);runtime.tick(2000);runtime.tick(1350);
 assert.equal(runtime.step,9);return runtime;
}
test('tutorial detects mobile user agents, iPad desktop mode and touch input',()=>{
 for(const userAgent of ['Mozilla/5.0 (iPhone; CPU iPhone OS 18) Mobile Safari','Mozilla/5.0 (Linux; Android 15) Chrome Mobile','Mozilla/5.0 (iPad) Safari'])assert.equal(shouldSkipTutorialHover({userAgent,coarsePointer:false}),true);
 assert.equal(shouldSkipTutorialHover({userAgent:'Mozilla/5.0 Macintosh',platform:'MacIntel',touchPoints:5,coarsePointer:false}),true);
 assert.equal(shouldSkipTutorialHover({userAgent:'unknown',mobileHint:true,coarsePointer:false}),true);
 assert.equal(shouldSkipTutorialHover({userAgent:'unknown',coarsePointer:true}),true);
 assert.equal(shouldSkipTutorialHover({userAgent:'Mozilla/5.0 Windows NT 10.0',touchPoints:10,coarsePointer:false}),false);
});
test('mobile skips hover teaching without inventing a hover health penalty',async()=>{
 const mobile=await noiseLesson(true);await mobile.request('matches/tutorial-hd/noise-hits','POST',{round:3});mobile.event('noise-click');mobile.tick(1350);
 assert.equal(mobile.step,11);assert.equal(mobile.snapshot()!.players[0]!.health,8);
 const desktop=await noiseLesson(false);await desktop.request('matches/tutorial-hd/noise-hits','POST',{round:3});desktop.event('noise-click');desktop.tick(1350);
 assert.equal(desktop.step,10);const restored=new TutorialRuntime(()=>{},JSON.parse(JSON.stringify(desktop.exportCheckpoint())),{skipHoverLesson:true});
 assert.equal(restored.step,11);assert.equal(restored.snapshot()!.players[0]!.health,8);
 await desktop.request('matches/tutorial-hd/noise-hits','POST',{round:3});desktop.event('noise-hover');desktop.tick(1350);
 assert.equal(desktop.step,11);assert.equal(desktop.snapshot()!.players[0]!.health,7);
});
