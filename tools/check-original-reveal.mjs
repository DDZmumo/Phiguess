import assert from 'node:assert/strict';
import {chromium} from 'file:///C:/Users/16892/.codex/mcp-servers/node_modules/playwright/index.mjs';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage(),errors=[];let requests=0;page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/matches/ui-check/rounds/0/original',r=>{requests++;return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="seagreen"/></svg>'});});
 await page.goto('http://localhost:5174/@fs/E:/Project/Code/Phiguess/tools/difficulty-frame-review.html');
 await page.evaluate(async()=>{
  const refresh=await import('/@react-refresh');refresh.default.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
  const React=await import('/@fs/E:/Project/Code/Phiguess/node_modules/.vite/deps/react.js').catch(()=>import('/node_modules/.vite/deps/react.js'));
  window.__testReact=React.default??React;
 });
 const result=await page.evaluate(async()=>{
  const dom=await import('/node_modules/.vite/deps/react-dom_client.js');const {createRoot}=dom.default??dom;const React=window.__testReact;
  const {OriginalReveal}=await import('/src/OriginalReveal.tsx'),{useStore}=await import('/src/store.ts');
  await import('/src/game-alignment.css');useStore.getState().setSession({token:'mock',user:{id:'mock',name:'mock'},expiresAt:'2099'});
  const host=document.createElement('div');host.className='game-screen';host.style.cssText='position:fixed;inset:0;--art-cut:85.7437px';document.body.append(host);
  const root=createRoot(host),render=solved=>root.render(React.createElement(OriginalReveal,{id:'ui-check',round:0,solved},React.createElement('div',null,'abstract')));
  render(false);await new Promise(r=>setTimeout(r,150));window.__solve=()=>render(true);return true;
 });
 assert.equal(requests,0);await page.evaluate(()=>window.__solve());await page.waitForSelector('.art-original');
 const clips=await page.evaluate(async()=>{const values=[];for(let i=0;i<28;i++){const e=document.querySelector('.art-abstract-layer');values.push(getComputedStyle(e).clipPath);await new Promise(requestAnimationFrame);}return values;});
 await page.waitForTimeout(400);
 const final=await page.locator('.art-reveal-layer').evaluate(e=>getComputedStyle(e).getPropertyValue('--original-sweep'));
 assert.equal(requests,1);assert.equal(final,'100%');assert(new Set(clips).size>1);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({beforeAnswerRequests:0,afterAnswerRequests:requests,animatedClipSamples:new Set(clips).size,final,errors}));
}finally{await browser.close();}


