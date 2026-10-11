import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OriginalImageCache,ORIGINAL_CACHE_LIMIT,type OriginalDecoder} from '../apps/web/src/original-image-cache';
import {OriginalImages} from '../apps/web/src/original-images';
import type {ResultRoundView} from '../packages/contracts/src';

function fixture(limit=32){
 const disposed:string[]=[];let serial=0;
 const decode:OriginalDecoder=async()=>{const url=`blob:${++serial}`;return {url,width:1,height:1,dispose:()=>disposed.push(url)};};
 const cache=new OriginalImageCache(limit,decode),load=async()=>new Blob(['1234']);
 return {cache,load,disposed};
}
test('original cache is FIFO, accounts decoded pixels and stays under its budget',async()=>{
 assert.equal(ORIGINAL_CACHE_LIMIT,32*1024*1024);
 const {cache,load,disposed}=fixture(16);
 const first=await cache.acquire('user','a',load);first.release();
 const second=await cache.acquire('user','b',load);second.release();
 (await cache.acquire('user','a',load)).release(); // Reading does not make it newest.
 (await cache.acquire('user','c',load)).release();
 assert.deepEqual(cache.cachedKeys,[JSON.stringify(['user','b']),JSON.stringify(['user','c'])]);
 assert.equal(cache.cachedBytes,16);assert.deepEqual(disposed,[first.url]);cache.clear();
 assert.equal(cache.cachedBytes,0);assert.equal(disposed.length,3);
});
test('eviction keeps displayed images alive until their lease is released',async()=>{
 const {cache,load,disposed}=fixture(8),shown=await cache.acquire('user','shown',load);
 (await cache.acquire('user','next',load)).release();assert.equal(cache.cachedBytes,8);assert.ok(!disposed.includes(shown.url));
 shown.release();assert.ok(disposed.includes(shown.url));shown.release();assert.equal(disposed.filter(url=>url===shown.url).length,1);cache.clear();
});
test('an oversized original is usable but never retained in the shared cache',async()=>{
 const {cache,load,disposed}=fixture(4),image=await cache.acquire('user','large',load);
 assert.equal(cache.cachedBytes,0);assert.deepEqual(disposed,[]);image.release();assert.deepEqual(disposed,[image.url]);
});
test('game and result originals share one authenticated transfer and decode',async()=>{
 const {cache}=fixture(),calls:string[]=[];let finish!:()=>void;
 const wait=new Promise<void>(resolve=>{finish=resolve;});
 const images=new OriginalImages('user:a',(id,round,result)=>`/${id}/${round}/${result?'result-original':'original'}`,'secret',cache,async(path,init)=>{
  assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer secret');calls.push(String(path));await wait;return new Response('1234');
 });
 const controller=new AbortController(),first=images.acquire('match',0,false,controller.signal),cancelled=assert.rejects(first,{name:'AbortError'});
 const result=images.acquire('match',0,true);controller.abort();finish();await cancelled;
 const ready=await result;ready.release();const again=await images.acquire('match',0,true);assert.equal(again.url,ready.url);again.release();
 assert.deepEqual(calls,['/match/0/original']);images.clear();
});
test('result prefetch is sequential, sorted, skips correct rows and does not reveal metadata',async()=>{
 const {cache}=fixture(64),calls:string[]=[],rounds=[4,2,1,3].map(round=>({round,correct:round===1}) as ResultRoundView);
 let concurrent=0,maxConcurrent=0;
 const images=new OriginalImages('tutorial',(_id,round)=>`/original/${round}`,undefined,cache,async path=>{
  concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);calls.push(String(path));await new Promise(resolve=>setTimeout(resolve,2));concurrent--;return new Response('1234');
 });
 await images.prefetchMissed({id:'match',rounds},new AbortController().signal);
 assert.deepEqual(calls,['/original/2','/original/3','/original/4']);assert.equal(maxConcurrent,1);
 (await images.acquire('match',2,true)).release();assert.equal(calls.length,3);images.clear();
});
test('sessions cannot share originals and clearing a session cancels its transfer',async()=>{
 const {cache,load}=fixture();(await cache.acquire('user:a','match:0',load)).release();
 const other=await cache.acquire('user:b','match:0',load);assert.equal(cache.cachedKeys.length,2);other.release();cache.clear('user:a');assert.equal(cache.cachedKeys.length,1);
 const pending=cache.acquire('user:a','pending',signal=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))));
 const aborted=assert.rejects(pending,{name:'AbortError'});cache.clear('user:a');await aborted;cache.clear();
});

test('leaving one result clears that match while retaining another match',async()=>{
 const {cache}=fixture(64),images=new OriginalImages('user',id=>`/${id}`,undefined,cache,async()=>new Response('1234'));
 const displayed=await images.acquire('first',0);(await images.acquire('second',0)).release();
 images.clearMatch('first');assert.deepEqual(cache.cachedKeys,[JSON.stringify(['user','second:0'])]);displayed.release();images.clear();
});
