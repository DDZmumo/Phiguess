import assert from 'node:assert/strict';
import test from 'node:test';
import {requestMobileLandscape} from '../apps/web/src/landscape';

test('mobile enters fullscreen before locking landscape',async()=>{
  const calls:string[]=[];
  assert(await requestMobileLandscape({mobile:true,fullscreen:false,enterFullscreen:async()=>{calls.push('fullscreen');},lock:async value=>{calls.push(value);}}));
  assert.deepEqual(calls,['fullscreen','landscape']);
});
test('already-fullscreen mobile only locks orientation',async()=>{
  const calls:string[]=[];
  assert(await requestMobileLandscape({mobile:true,fullscreen:true,enterFullscreen:async()=>{throw Error('Unexpected fullscreen request');},lock:async value=>{calls.push(value);}}));
  assert.deepEqual(calls,['landscape']);
});
test('unsupported or denied locking falls back without throwing',async()=>{
  assert.equal(await requestMobileLandscape({mobile:true,fullscreen:false}),false);
  let entered=false;
  assert.equal(await requestMobileLandscape({mobile:true,fullscreen:false,enterFullscreen:async()=>{entered=true;}}),false);
  assert(entered,'Fullscreen remains available even without orientation locking');
  assert.equal(await requestMobileLandscape({mobile:true,fullscreen:false,lock:async()=>{throw Error('Not supported');}}),false);
  assert.equal(await requestMobileLandscape({mobile:true,fullscreen:false,enterFullscreen:async()=>{throw Error('Denied');},lock:async()=>{throw Error('Should not run');}}),false);
});
test('desktop does not automatically enter fullscreen or lock orientation',async()=>{
  assert.equal(await requestMobileLandscape({mobile:false,fullscreen:false,enterFullscreen:async()=>{throw Error('Unexpected fullscreen request');},lock:async()=>{throw Error('Unexpected lock');}}),false);
});
