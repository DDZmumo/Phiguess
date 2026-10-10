import assert from 'node:assert/strict';
import {chromium} from 'file:///C:/Users/16892/.codex/mcp-servers/node_modules/playwright/index.mjs';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5174/@fs/E:/Project/Code/Phiguess/tools/difficulty-frame-review.html');
 const result=await page.evaluate(async()=>{
  const refresh=await import('/@react-refresh');refresh.default.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
  const react=await import('/node_modules/.vite/deps/react.js'),React=react.default??react;
  const dom=await import('/node_modules/.vite/deps/react-dom_client.js'),{createRoot}=dom.default??dom;
  const {AnswerNotice}=await import('/src/AnswerNotice.tsx');
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);let ended=0;
  root.render(React.createElement('div',{className:'game-screen'},...['correct','timeout','wrong'].map((kind,i)=>React.createElement('div',{className:'song-input',style:{position:'relative',width:350,height:54,margin:20}},React.createElement(AnswerNotice,{event:{kind,serial:i+1},onEnd:()=>ended++})))));
  const wait=t=>new Promise(r=>setTimeout(r,t));await wait(80);
  const read=()=>[...host.querySelectorAll('.input-answer-notice')].map(e=>({color:getComputedStyle(e).color,letters:[...e.querySelectorAll('.input-answer-letters>span')].map(n=>+getComputedStyle(n).opacity),opacity:+getComputedStyle(e).opacity}));
  const initial=read();await wait(500);const revealed=read();await wait(1250);const faded=read();root.unmount();return{initial,revealed,faded,ended};
 });
 assert(result.initial.every(s=>s.letters.every(n=>n===0)));assert(result.revealed.every(s=>s.letters.every(n=>n===1)));assert(result.faded.every(s=>s.opacity===0));assert.equal(result.ended,3);assert.equal(new Set(result.initial.map(s=>s.color)).size,3);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({statuses:3,lettersRevealed:true,faded:true,errors}));
}finally{await browser.close();}
