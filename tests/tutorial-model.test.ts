import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readTutorialDone,markTutorialDone,timeoutDamage,tutorialSteps,TUTORIAL_VERSION,tutorialImageDifficulty,TUTORIAL_HEALTH_CAPACITY,TUTORIAL_START_HEALTH} from '../apps/web/src/tutorial-model';
import {resolveHealthCapacity} from '../packages/contracts/src';

test('tutorial timeout demonstration matches live timeout rule',()=>{
 for(let wrong=0;wrong<10;wrong++)assert.equal(timeoutDamage(wrong),Math.max(3,5-wrong));
});
test('tutorial uses a supported health capacity and a visible recovery example',()=>{
 assert.equal(resolveHealthCapacity('hd',TUTORIAL_HEALTH_CAPACITY),TUTORIAL_HEALTH_CAPACITY);
 assert.ok(TUTORIAL_START_HEALTH-1+3<TUTORIAL_HEALTH_CAPACITY);
 assert.ok(TUTORIAL_START_HEALTH-1+3-5-1-1>0);
});
test('only the third non-EZ hint lowers the displayed difficulty by one tier',()=>{
 for(const [difficulty,lower] of [['ez','ez'],['hd','ez'],['in','hd'],['at','in']] as const){
  for(const count of [0,1,2])assert.equal(tutorialImageDifficulty(difficulty,count),difficulty);
  assert.equal(tutorialImageDifficulty(difficulty,3),lower);
 }
});
test('tutorial completion is optional and isolated from match storage',()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 try{
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('Storage blocked');}});
  assert.equal(readTutorialDone(),false);assert.doesNotThrow(markTutorialDone);
  const values=new Map<string,string>([['phiguess-store','unchanged']]);
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});
  assert.equal(readTutorialDone(),false);markTutorialDone();assert.equal(readTutorialDone(),true);
  assert.equal(values.get('phiguess-store'),'unchanged');assert.equal(values.get(TUTORIAL_VERSION),'complete');
 }finally{if(original)Object.defineProperty(globalThis,'localStorage',original);else Reflect.deleteProperty(globalThis,'localStorage');}
});
test('tutorial mounts shared screens through its scoped runtime',()=>{
 const source=readFileSync('apps/web/src/Tutorial.tsx','utf8');
 for(const component of ['DifficultySelect','Game','Results','PlayRuntimeContext.Provider'])assert.ok(source.includes(`<${component}`));
 assert.doesNotMatch(source,/\b(?:setMatch|setRoom|setSession|fetch)\s*\(/);
 assert.equal(tutorialSteps.length,16);
});
