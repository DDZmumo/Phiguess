import {chromium} from 'file:///C:/Users/16892/.codex/mcp-servers/node_modules/playwright/index.mjs';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('phiguess-v1',JSON.stringify({state:{session:{token:'local-ui-check',user:{id:'ui-check',name:'过渡检查'},expiresAt:'2099-01-01'},preferences:{motion:true,sound:false,volume:0,brightness:1,difficulty:'ez',rounds:1,roundSeconds:15},matchId:null,roomCode:null},version:0})));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/matches/practice'){await new Promise(r=>setTimeout(r,1800));await route.fulfill({json:{id:'ui-transition-check'}});return;}
  await route.fulfill({json:path==='/api/me'?{id:'ui-check',name:'过渡检查'}:path==='/api/me/active'?{match:null}:[]});
 });
 await page.goto('http://localhost:5174/#/difficulty');await page.getByRole('button',{name:'EZ 区区',exact:true}).click();
 await page.waitForSelector('[data-phase="starting"]',{timeout:22000});
 const samples=await page.evaluate(async()=>{const results=[];for(let i=0;i<35;i++){const root=document.querySelector('.difficulty-screen');if(!root)break;const c=root.querySelector('canvas'),ctx=c.getContext('2d'),pixel=ctx.getImageData(c.width/2,c.height/2,1,1).data;results.push({background:getComputedStyle(root).backgroundColor,visibility:getComputedStyle(c).visibility,pixel:[...pixel]});await new Promise(requestAnimationFrame);}return results;});
 if(!samples.length||samples.some(s=>s.background!=='rgb(0, 0, 0)'||s.visibility!=='hidden'||s.pixel.slice(0,3).some(Boolean)))throw Error(JSON.stringify(samples));
 console.log(JSON.stringify({blackHoldSamples:samples.length,errors}));if(errors.length)process.exitCode=1;
}finally{await browser.close();}

