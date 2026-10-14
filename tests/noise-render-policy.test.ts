import test from 'node:test';
import assert from 'node:assert/strict';
import {noiseBufferSize,noiseRenderPolicy,NOISE_RESOLUTION_SCALES} from '../apps/web/src/noise-render-policy';

test('mobile noise keeps high-DPI phones and large touch screens within its pixel budget',()=>{
 const policy=noiseRenderPolicy(true);
 assert.ok(Math.abs(1000/policy.frameMs-60)<.001);
 for(const [width,height] of [[844,390],[1280,800],[2560,1440]] as const)for(const dpr of [1,2,3,4]){
  const size=noiseBufferSize(width,height,dpr,policy);
  assert.ok(size.width<=width&&size.height<=height);
  assert.ok(size.width*size.height<=policy.maxPixels);
 }
 assert.equal(noiseBufferSize(844,390,3,policy).width,844);
});
test('a struggling desktop can reduce the backing below the former 0.67 minimum while retaining the 60fps target',()=>{
 const policy=noiseRenderPolicy(false),quality=NOISE_RESOLUTION_SCALES.at(-1)!;
 assert.ok(Math.abs(1000/policy.frameMs-60)<.001);
 const current=noiseBufferSize(1920,1080,3,policy,quality),former=noiseBufferSize(1920,1080,3,policy,.67);
 assert.ok(current.width*current.height<former.width*former.height/3);
 assert.ok(current.width>0&&current.height>0);
});
test('desktop retains the existing 1.5 DPR and 1080p rendering ceilings',()=>{
 const policy=noiseRenderPolicy(false);
 assert.deepEqual(noiseBufferSize(844,390,3,policy),{width:1266,height:585});
 assert.deepEqual(noiseBufferSize(1920,1080,3,policy),{width:1920,height:1080});
});
