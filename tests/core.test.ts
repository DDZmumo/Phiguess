import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAnswer, performanceBadge, SerialQueue } from '../packages/game-core/src';
import { validateSvg } from '../tools/svg';

test('deduction scoring respects grace, wrong caps, and timeout',()=>{
 for(const [difficulty,base]of [['ez',500],['hd',1000],['in',2000],['at',3000]] as const){
  assert.equal(scoreAnswer(difficulty,0,30000),base);
  assert.equal(scoreAnswer(difficulty,5000,30000),base);
  assert.equal(scoreAnswer(difficulty,17500,30000),base*.75);
  assert.equal(scoreAnswer(difficulty,5000,30000,1),base*.9);
  assert.equal(scoreAnswer(difficulty,5000,30000,9),base*.5);
  assert.equal(scoreAnswer(difficulty,30000,30000),0);
  assert.equal(scoreAnswer(difficulty,10000,60000),base);
 }
 assert.equal(scoreAnswer('at',17500,30000,2),1650);
});
test('badges exclude missed rounds and use exact grade boundaries',()=>{
 for(const [score,grade]of [[0,'none'],[699,'none'],[700,'green'],[799,'green'],[800,'blue'],[899,'blue'],[900,'red'],[949,'red'],[950,'gold'],[999,'gold'],[1000,'rainbow']] as const){
  const badge=performanceBadge([{correct:true,score},{correct:false,score:0}],'hd');assert.equal(badge.grade,grade);assert.equal(badge.maximum,1000);assert.equal(badge.correct,1);
 }
 assert.equal(performanceBadge([],'at').grade,'none');
});
test('serial queue continues after rejected mutations',async()=>{
  const q=new SerialQueue(),order:number[]=[];
  await Promise.allSettled([q.run(async()=>{order.push(1);throw new Error('failure');}),q.run(async()=>{order.push(2);})]);
  assert.deepEqual(order,[1,2]);
});
test('SVG permits static paths and rejects active content, hidden metadata and external references',()=>{
  const wrap=(body:string)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`);
  assert.ok(validateSvg(wrap('<path d="M0 0L10 10" fill="#fff"/>')));
  for (const body of ['<script>alert(1)</script>','<path onclick="alert(1)"/>','<image href="https://example.com/a.png"/>','<path fill="url(https://example.com)"/>','<foreignObject/>','<title>answer</title>','<!-- answer -->','<style/>']) assert.throws(()=>validateSvg(wrap(body)));
  assert.throws(()=>validateSvg(Buffer.from('<!DOCTYPE svg [<!ENTITY answer "secret">]><svg/>')));
});
