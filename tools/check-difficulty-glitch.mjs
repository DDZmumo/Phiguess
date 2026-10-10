// Narrow check: this animation only, a few fault frames and a sub-second stress sample.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(process.env.USERPROFILE,'.codex/mcp-servers/node_modules/playwright/index.mjs')));
const output=resolve('output/playwright/difficulty-glitch');await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1460,height:760}}),errors=[],oldFrameRequests=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(/\/difficulty\/labels-/.test(request.url()))oldFrameRequests.push(request.url());});
 await page.goto('http://localhost:5174/@fs/E:/Project/Code/Phiguess/tools/difficulty-frame-review.html');await page.waitForFunction(()=>window.reviewReady);
 for(const [level,frame]of[['in',110],['at',78],['at',143],['at',164],['at',422]]){
  await page.evaluate(({level,frame})=>window.reviewFrame(level,frame),{level,frame});
  await page.screenshot({path:resolve(output,`${level}-${frame}.png`)});
 }
 const behavior=await page.evaluate(async()=>{
  const m=await import('/src/difficulty-motion.ts'),{getDifficultyAtlas}=await import('/src/difficulty-atlas.ts');
  const atlas=await getDifficultyAtlas(),temp=document.createElement('canvas');temp.width=temp.height=384;const c=temp.getContext('2d',{willReadFrequently:true});let border=0;
  for(const halo of atlas.labelGlows.values()){
   c.clearRect(0,0,384,384);c.drawImage(halo,0,0);const p=c.getImageData(0,0,384,384).data;
   for(let i=0;i<384;i++)for(const n of[i,383*384+i,i*384,i*384+383])border=Math.max(border,p[n*4+3]);
  }
  const result={columnGap:m.difficultyColumn(6,1).x-m.difficultyColumn(6,0).x,
   stoppedDisplacement:m.difficultyColumn(14,1).x-m.difficultyColumn(13,1).x,haloBorderAlpha:border};
  if(result.columnGap<199.9||result.stoppedDisplacement!==0||border!==0)throw Error(JSON.stringify(result));return result;
 });
 await page.setViewportSize({width:1920,height:1080});
 const timing=await page.evaluate(async()=>{
  const {DifficultyPainter}=await import('/src/difficulty-painter.ts');
  const canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:999';document.body.append(canvas);
  const painter=await DifficultyPainter.create(canvas);painter.resize();painter.draw(164/30,'at');const frames=[];let start;
  await new Promise(done=>{function tick(now){start??=now;painter.draw(164/30+((now-start)%25)/1000,'at');frames.push(now);if(now-start<800)requestAnimationFrame(tick);else done();}requestAnimationFrame(tick);});
  const intervals=frames.slice(1).map((n,i)=>n-frames[i]).sort((a,b)=>a-b);canvas.remove();
  return{sampleMs:Math.round(frames.at(-1)-frames[0]),draws:frames.length,p95IntervalMs:+intervals[Math.floor(intervals.length*.95)].toFixed(2),maxIntervalMs:+intervals.at(-1).toFixed(2)};
 });
 const result={checkedFrames:5,behavior,timing,errors,oldFrameRequests};
 await writeFile(resolve(output,'check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 if(errors.length||oldFrameRequests.length)process.exitCode=1;
}finally{await browser.close();}
