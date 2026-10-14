import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ImageDownloadQueue} from '../apps/web/src/image-download-queue';
import {QuestionImageCache} from '../apps/web/src/question-image-cache';
import {OriginalImages} from '../apps/web/src/original-images';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('background originals leave a slot free for visible images',async()=>{
 const queue=new ImageDownloadQueue(),signal=new AbortController().signal,started:string[]=[];let release!:()=>void;
 const first=queue.run('first',2,signal,async()=>{started.push('first');await new Promise<void>(resolve=>release=resolve);});
 await tick();const background=queue.run('background',2,signal,async()=>{started.push('background');});
 const visible=queue.run('visible',0,signal,async()=>{started.push('visible');});
 await visible;assert.deepEqual(started,['first','visible']);release();await Promise.all([first,background]);assert.equal(started.at(-1),'background');
});
test('visible requests and promoted nearby requests precede queued background work',async()=>{
 const queue=new ImageDownloadQueue(),signal=new AbortController().signal,order:string[]=[];
 const tasks=[queue.run('background',2,signal,async()=>{order.push('background');}),queue.run('nearby',1,signal,async()=>{order.push('nearby');}),queue.run('visible',0,signal,async()=>{order.push('visible');})];
 queue.promote('nearby',0);await Promise.all(tasks);assert.deepEqual(order,['nearby','visible','background']);
});
test('cancelled queued work does not start a transfer',async()=>{
 const queue=new ImageDownloadQueue(),abort=new AbortController();let started=false;
 const job=queue.run('cancelled',1,abort.signal,async()=>{started=true;});abort.abort();await assert.rejects(job,{name:'AbortError'});await tick();assert.equal(started,false);
});
test('encoded question cache enforces FIFO bytes and isolates match, session and hint difficulty',()=>{
 const cache=new QuestionImageCache(6),a=cache.key('one','match',0,'at'),b=cache.key('one','match',0,'in'),c=cache.key('two','match',0,'at');
 const first=new Blob(['aaa']);cache.remember(a,first);cache.remember(b,new Blob(['bbb']));assert.equal(cache.get(a),first);
 cache.remember(c,new Blob(['ccc']));assert.equal(cache.get(a),undefined);assert.equal(cache.cachedBytes,6);
 cache.clear('one','match');assert.equal(cache.get(b),undefined);assert.ok(cache.get(c));assert.equal(cache.cachedBytes,3);
});
test('result question reuses a gameplay body without a second request and clears on exit',async()=>{
 const images=new OriginalImages('question-reuse',()=>'', 'session-token');const blob=new Blob(['played question'],{type:'image/svg+xml'});let requests=0;
 const fetcher:typeof fetch=async(_url,init)=>{requests++;assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer session-token');return new Response('downloaded question');};
 const signal=new AbortController().signal;
 images.rememberQuestion('match',4,'at',blob);
 assert.equal(await images.question('match',4,'at','/result-image',fetcher,signal),blob);assert.equal(requests,0);
 await images.question('match',4,'in','/result-image',fetcher,signal);assert.equal(requests,1);
 images.clearMatch('match');await images.question('match',4,'at','/result-image',fetcher,signal);assert.equal(requests,2);images.clear();
});
test('one cancelled question subscriber does not cancel the other subscriber',async()=>{
 const cache=new QuestionImageCache(),abort=new AbortController();let finish!:(blob:Blob)=>void,calls=0;
 const load=()=>{calls++;return new Promise<Blob>(resolve=>finish=resolve);};
 const first=cache.load('key',load,abort.signal),second=cache.load('key',load);abort.abort();await assert.rejects(first,{name:'AbortError'});await tick();
 const body=new Blob(['shared']);finish(body);assert.equal(await second,body);assert.equal(calls,1);
});
