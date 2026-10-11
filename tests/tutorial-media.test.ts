import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TutorialRuntime} from '../apps/web/src/tutorial-runtime';
import {TutorialMedia} from '../apps/web/src/tutorial-media';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';

async function correctAnswerLesson(){
 const runtime=new TutorialRuntime(()=>{});
 await runtime.request('matches/practice','POST',{difficulty:'hd',healthCapacity:20});runtime.navigate('/play/tutorial-hd');
 runtime.event('zoom-close');runtime.tick(1200);await runtime.request('matches/tutorial-hd/rounds/0/hints/0','POST');runtime.tick(1200);runtime.tick(3000);
 await runtime.request('matches/tutorial-hd/guesses','POST',{round:0,answer:'wrong'});runtime.tick(1350);
 await runtime.request('matches/tutorial-hd/guesses','POST',{round:0,answer:'DS'});return runtime;
}

test('tutorial advances on its normal schedule without waiting on image downloads',async()=>{
 const runtime=await correctAnswerLesson();runtime.tick(1799);assert.equal(runtime.step,5);
 runtime.tick(1);assert.equal(runtime.step,6);assert.equal(runtime.snapshot()!.round,1);
});

test('tutorial lossless WebP originals preserve every decoded pixel at a smaller size',async()=>{
 for(const name of ['ds','mirage','chaos','8000']){
  const png=await readFile(`apps/web/public/tutorial/${name}-original.png`),webp=await readFile(`apps/web/public/tutorial/${name}-original.webp`);
  const source=await sharp(png).metadata(),preview=await sharp(webp).metadata();
  assert.equal(preview.width,source.width);assert.equal(preview.height,source.height);assert.equal(preview.format,'webp');assert.ok(webp.length<png.length,name);
  const sourcePixels=await sharp(png).ensureAlpha().raw().toBuffer(),previewPixels=await sharp(webp).ensureAlpha().raw().toBuffer();
  assert.ok(sourcePixels.equals(previewPixels),`${name}: decoded PNG and WebP pixels must match exactly`);
 }
});

test('tutorial original requests share one transfer when a view cancels or remounts',async()=>{
 const native=globalThis.fetch,calls:string[]=[];let release!:()=>void;
 const delayed=new Promise<void>(resolve=>{release=resolve;});
 globalThis.fetch=async(input,init)=>{
  calls.push(String(input));await delayed;
  if(init?.signal?.aborted)throw new DOMException('Aborted','AbortError');
  return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/webp'}});
 };
 try{
  const runtime=await correctAnswerLesson(),cancelled=new AbortController();
  const first=runtime.media('/api/matches/tutorial-hd/rounds/0/original',{signal:cancelled.signal});
  const cancellation=assert.rejects(first,{name:'AbortError'});
  const second=runtime.media('/api/matches/tutorial-hd/rounds/0/result-original');
  cancelled.abort();release();await cancellation;
  assert.deepEqual(new Uint8Array(await (await second).arrayBuffer()),new Uint8Array([1,2,3]));
  const cached=await runtime.media('/api/matches/tutorial-hd/rounds/0/original');
  assert.equal(cached.headers.get('Content-Type'),'image/webp');assert.equal((await cached.blob()).size,3);
  assert.deepEqual(calls,['/tutorial/ds-original.webp']);
 }finally{globalThis.fetch=native;}
});

test('failed image transfers can retry instead of caching the failure',async()=>{
 let attempts=0;const media=new TutorialMedia(async()=>++attempts===1?new Response('',{status:503}):new Response('ready',{headers:{'Content-Type':'image/png'}}));
 await assert.rejects(media.load('/tutorial/image.png'),/unavailable/);assert.equal(await (await media.load('/tutorial/image.png')).text(),'ready');assert.equal(attempts,2);media.dispose();
});
test('leaving the tutorial aborts its owned transfer and permits a later fresh request',async()=>{
 let attempts=0;const media=new TutorialMedia(async(_input,init)=>{
  attempts++;if(attempts>1)return new Response('ready');
  return new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
 });
 const pending=media.load('/tutorial/image.png'),cancelled=assert.rejects(pending,{name:'AbortError'});media.dispose();await cancelled;
 assert.equal(await (await media.load('/tutorial/image.png')).text(),'ready');media.dispose();
});
