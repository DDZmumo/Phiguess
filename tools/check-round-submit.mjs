import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_PACKAGE??resolve(process.env.USERPROFILE,'.codex/mcp-servers/node_modules/playwright/index.mjs')));
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const out='output/playwright/round-submit';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${process.env.PHIGUESS_PREVIEW_ORIGIN??'http://127.0.0.1:5174'}/@fs/${resolve('tools/difficulty-frame-review.html').replaceAll('\\','/')}`);
 await page.evaluate(async()=>{
  const refresh=await import('/@react-refresh');refresh.default.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
  await import('/src/style.css');
  const react=await import('/node_modules/.vite/deps/react.js'),React=react.default??react;
  const dom=await import('/node_modules/.vite/deps/react-dom_client.js'),{createRoot}=dom.default??dom;
  const {PlayRuntimeContext}=await import('/src/play-runtime.ts'),{Game}=await import('/src/Game.tsx'),{useStore}=await import('/src/store.ts'),{OriginalImages}=await import('/src/original-images.ts');
  useStore.getState().updatePreferences({sound:false,musicVolume:0,motion:false});
  const id='00000000-0000-4000-8000-000000000001',user={id:'fixture-player',name:'延迟回归检查'},listeners=new Set();
  let match={id,mode:'practice',status:'playing',difficulty:'at',round:3,totalRounds:20,endless:true,serverNow:Date.now(),startsAt:Date.now()-1000,deadline:Date.now()+29000,nextAt:0,imageUrl:'fixture',answer:null,healthEnabled:true,healthCapacity:20,players:[{...user,score:0,answered:false,health:20}],rulesVersion:'v3-deduction'};
  const followups=[],guesses=[],pendingGuesses=[];
  let holdFollowups=false,holdGuess=false;
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><path fill="#8799be" d="M0 0H800V450H0Z"/><path fill="#dddcc9" d="M300 100H700V350H300Z"/></svg>';
  const media=async()=>new Response(svg,{headers:{'Content-Type':'image/svg+xml'}});
  const progress=()=>guesses.map((g,i)=>({round:g.round,correct:g.correct,score:g.correct?700:0,answer_text:'fixture',title:g.correct?'Fixture':null}));
  const runtime={session:{token:'fixture-token',user,expiresAt:'2099-01-01'},preferences:useStore.getState().preferences,clockPaused:false,media,originalImages:new OriginalImages('round-submit-fixture',()=>'/fixture',undefined,undefined,media),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},snapshot:()=>match,navigate:()=>{},updatePreferences:()=>{},event:()=>{}};
  const publish=(round)=>{match={...match,round,serverNow:Date.now(),startsAt:Date.now()-100,deadline:Date.now()+29900,players:[{...user,score:700,answered:false,health:20}]};listeners.forEach(fn=>fn());};
  runtime.request=async(path,method='GET',body)=>{
   if(path.endsWith('/guesses')){
    const correct=body.answer==='right';guesses.push({round:body.round,correct});
    if(holdGuess)return new Promise(resolve=>pendingGuesses.push(()=>resolve({correct,score:correct?700:0})));
    holdFollowups=correct;return {correct,score:correct?700:0};
   }
   if(path.endsWith('/progress')){const result=progress();if(holdFollowups&&match.round===3)return new Promise(resolve=>followups.push(()=>resolve(result)));return result;}
   if(path===`matches/${id}`){const result=structuredClone(match);if(holdFollowups&&match.round===3)return new Promise(resolve=>followups.push(()=>resolve(result)));return result;}
   if(path.includes('/hints'))return [];
   return match;
  };
  const host=document.createElement('div');host.className='stage';host.style.cssText='width:1440px;height:1000px;position:relative';document.body.replaceChildren(host);
  const root=createRoot(host);root.render(React.createElement(PlayRuntimeContext.Provider,{value:runtime},React.createElement(Game,{id})));
  window.repro={publishNext:()=>publish(match.round+1),releaseFollowups:()=>followups.splice(0).forEach(fn=>fn()),setHoldGuess:()=>{holdGuess=true},releaseGuesses:()=>pendingGuesses.splice(0).forEach(fn=>fn()),counts:()=>({guesses:guesses.length,followups:followups.length,pendingGuesses:pendingGuesses.length}),unmount:()=>{root.unmount();runtime.originalImages.clear()}};
 });
 const input=page.getByRole('textbox',{name:'输入歌名'}),submit=page.locator('.submit-answer');
 await input.waitFor();
 for(let i=0;i<3;i++){await input.fill('wrong'+i);await submit.click();await page.waitForFunction(()=>!document.querySelector('.song-input input').disabled);}
 await input.fill('right');await submit.click();
 await page.waitForFunction(()=>window.repro.counts().followups>=2);
 await page.evaluate(()=>window.repro.publishNext());
 await page.waitForFunction(()=>document.querySelector('.song-rail')?.dataset.round==='4');
 const blocked=await input.isDisabled(),text=await submit.innerText();
 await page.screenshot({path:out+(process.argv.includes('--repro')?'/before.png':'/after.png')});
 console.log(JSON.stringify({nextRound:5,inputBlocked:blocked,submitText:text,counts:await page.evaluate(()=>window.repro.counts()),errors}));
 if(process.argv.includes('--repro')){assert.equal(blocked,true);assert.equal(text.trim(),'提交中');}else{
 assert.equal(blocked,false,'A previous round follow-up must not disable the next round');
 // Late completion of the previous round must not clear the new round submission lock or draft.
 await input.fill('next-round');await page.evaluate(()=>window.repro.setHoldGuess());await submit.click();
 await page.waitForFunction(()=>window.repro.counts().pendingGuesses===1);
 await page.evaluate(()=>window.repro.releaseFollowups());
 assert.equal(await input.isDisabled(),true,'Late previous completion cleared the new round lock');
 assert.equal(await input.inputValue(),'next-round');
 await page.evaluate(()=>window.repro.releaseGuesses());await page.waitForFunction(()=>!document.querySelector('.song-input input').disabled);
 assert.deepEqual(errors,[]);
 // A delayed guess response itself must not touch a later round's draft or notice.
 await input.fill('late-answer');await submit.click();await page.waitForFunction(()=>window.repro.counts().pendingGuesses===1);
 await page.evaluate(()=>window.repro.publishNext());await page.waitForFunction(()=>document.querySelector('.song-rail')?.dataset.round==='5');
 assert.equal(await input.isDisabled(),false);await input.fill('draft-kept');await page.evaluate(()=>window.repro.releaseGuesses());
 await page.waitForFunction(()=>!document.querySelector('.song-input input').disabled);
 assert.equal(await input.inputValue(),'draft-kept');
 assert.deepEqual(errors,[]);await page.evaluate(()=>window.repro.unmount());
 await writeFile(out+'/verification.json',JSON.stringify({nextRoundInputEnabled:true,oldCompletionCannotUnlockNewSubmission:true,lateGuessCannotChangeNewDraft:true,errors},null,2));
 console.log('ROUND_SUBMIT_REGRESSION_OK');}
}finally{await browser.close()}
