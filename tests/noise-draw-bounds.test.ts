import test from 'node:test';
import assert from 'node:assert/strict';
import {noiseDrawBounds} from '../apps/web/src/noise-draw-bounds';

test('red bounds retain the displaced rim while inactive regions do not force a full-screen draw',()=>{
 assert.deepEqual(noiseDrawBounds([{rect:[100,200,300,400],phase:2,strength:1}],0,[0,0],0),{left:60,top:160,right:340,bottom:440});
 assert.equal(noiseDrawBounds([{rect:[0,0,1280,720],phase:0,strength:1}],0,[0,0],0),null);
});
test('both slant directions enclose every expanded rectangle corner',()=>{
 for(const skew of [.2679491924,-.2679491924]){
  const bounds=noiseDrawBounds([{rect:[100,200,300,400],phase:2,strength:1}],skew,[0,0],0)!;
  for(const y of [160,440])for(const x of [60,340]){
   const position=x-(y-360)*skew;
   assert.ok(position>=bounds.left&&position<=bounds.right);
   assert.ok(y>=bounds.top&&y<=bounds.bottom);
  }
 }
});
test('a fading contact patch can extend beyond the red zone without being cut off',()=>{
 const bounds=noiseDrawBounds([{rect:[100,200,300,400],phase:2,strength:1}],0,[350,180],1)!;
 assert.ok(bounds.right>=470&&bounds.top<=60);
});
test('drawing bounds use the same 24-region limit as the shader',()=>{
 const regions=Array.from({length:24},()=>({rect:[0,0,0,0] as [number,number,number,number],phase:0 as const,strength:0}));
 assert.equal(noiseDrawBounds([...regions,{rect:[0,0,1280,720],phase:2,strength:1}],0,[0,0],0),null);
});
