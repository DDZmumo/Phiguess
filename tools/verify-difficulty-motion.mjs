// Local browser verification; uses the installed Playwright package without downloading.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const packagePath=process.env.PLAYWRIGHT_PACKAGE??resolve(process.env.USERPROFILE,'.codex/mcp-servers/node_modules/playwright/index.mjs');
const {chromium}=await import(pathToFileURL(packagePath));
const origin='http://localhost:5174',output=resolve('output/playwright/difficulty-frame-review');
const entryOnly=process.argv.includes('--entry-only'),frameCount=entryOnly?111:522;
const review=`${origin}/@fs/${resolve('tools/difficulty-frame-review.html').replaceAll('\\','/')}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1460,height:760}}),page=await context.newPage(),errors=[],videoLabelRequests=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(/\/difficulty\/labels-/.test(request.url()))videoLabelRequests.push(request.url());});
 await page.goto(review);await page.waitForFunction(()=>window.reviewReady);
 const behavior=await page.evaluate(async()=>{
  const motion=await import('/src/difficulty-motion.ts'),{getDifficultyAtlas,GLYPH_CELL}=await import('/src/difficulty-atlas.ts'),{DifficultyPainter}=await import('/src/difficulty-painter.ts');
  const atlas=await getDifficultyAtlas(),scratch=document.createElement('canvas');scratch.width=scratch.height=384;
  const sc=scratch.getContext('2d',{willReadFrequently:true});let haloBorderAlpha=0;
  for(const glow of atlas.labelGlows.values()){
   sc.clearRect(0,0,384,384);sc.drawImage(glow,0,0);const p=sc.getImageData(0,0,384,384).data;
   for(let i=0;i<384;i++)for(const at of[i,383*384+i,i*384,i*384+383])haloBorderAlpha=Math.max(haloBorderAlpha,p[at*4+3]);
  }
  const derivative=(fn,t,dt=.0001)=>(fn(t+dt)-fn(t))/dt;
  const onset=[false,true].map(right=>derivative(t=>(right?motion.difficultyState(t).scroll:motion.difficultyState(t).leftScroll)*400,motion.DIFFICULTY_SCROLL_START));
  const edges=[600,720,960].map(width=>{
   let gap=Infinity,edge=0;for(let t=5.3;t<=15.2;t+=1/120){const l=motion.difficultyColumn(t,0,width),r=motion.difficultyColumn(t,1,width);gap=Math.min(gap,r.x-l.x);edge=Math.max(edge,r.x+120-width/2);}
   return{width,minColumnGap:+gap.toFixed(4),rightEdgeOverflow:+edge.toFixed(4),positionAfterStop:motion.difficultyColumn(14,1,width).x-motion.difficultyColumn(13,1,width).x};
  });
  let maxFadeStep=0,wordShear=0;const labelX=new Set();
  for(const level of['ez','hd','in','at']){
   let previous=motion.difficultyLabels(.5,level);
   const initial=previous;
   for(let t=.5+1/120;t<2.1;t+=1/120){
    const current=motion.difficultyLabels(t,level);labelX.add(current.find((v,i)=>Math.floor(i/4)===['ez','hd','in','at'].indexOf(level)).x.toFixed(5));
    for(let word=0;word<4;word++){
     if(['ez','hd','in','at'][word]===level)continue;
     const i=word*4;maxFadeStep=Math.max(maxFadeStep,Math.abs(current[i].alpha-previous[i].alpha));
     const change=[0,1,2,3].map(n=>current[i+n].x-initial[i+n].x);
     wordShear=Math.max(wordShear,Math.abs((change[1]-change[0])-(change[2]-change[1])),Math.abs((change[2]-change[1])-(change[3]-change[2])));
    }
    previous=current;
   }
  }
  const canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;left:0;top:0;width:720px;height:540px;z-index:998';document.body.append(canvas);
  const painter=await DifficultyPainter.create(canvas);painter.resize();const ctx=canvas.getContext('2d'),draw=ctx.drawImage,drawn=[];
  ctx.drawImage=function(...args){if(args[0]===atlas.normal&&args.length===9){const m=this.getTransform(),[,sx,sy,, ,x,y,w,h]=args;drawn.push({sx,sy,x:m.a*(x+w/2)+m.e,y:m.d*(y+h/2)+m.f,w:w*m.a});}return draw.apply(this,args);};
  painter.draw(motion.DIFFICULTY_SCROLL_START,'in');ctx.drawImage=draw;
  const observed=['龙','比'].map(char=>{const index=atlas.indices.get(char),sx=index%16*128,sy=Math.floor(index/16)*160;return drawn.filter(g=>g.sx===sx&&g.sy===sy).sort((a,b)=>Math.abs(a.y-270)-Math.abs(b.y-270))[0];});
  canvas.remove();
  const result={haloBorderAlpha,zeroStartPixelsPerSecond:onset,viewportChecks:edges,maxFadeStepAt120Hz:+maxFadeStep.toFixed(6),maxWordShear:+wordShear.toFixed(8),distinctTextPositions:labelX.size,observedInitialColumnCenters:observed.map(g=>g.x)};
  if(haloBorderAlpha!==0||onset.some(v=>v>.1)||edges.some(v=>v.minColumnGap<199.9||v.rightEdgeOverflow>.001||Math.abs(v.positionAfterStop)>.001)||maxFadeStep>.09||wordShear>.0001||observed[1].x-observed[0].x<199.9)throw Error(JSON.stringify(result));
  return result;
 });
 for(const level of['at','in','hd','ez']){
  const folder=resolve(output,level);await mkdir(folder,{recursive:true});
  for(let start=0;start<frameCount;start+=20){
   const frames=await page.evaluate(async({level,start,frameCount})=>{
    const result=[];
    for(let frame=start;frame<Math.min(frameCount,start+20);frame++){
     const state=await window.reviewFrame(level,frame,false);
     result.push({frame,state,png:document.querySelector('#render').toDataURL('image/png').slice(22)});
    }
    return result;
   },{level,start,frameCount});
   await Promise.all(frames.map(async({frame,state,png})=>{
    const stem=String(frame+1).padStart(4,'0');
    await writeFile(resolve(folder,`${stem}.png`),Buffer.from(png,'base64'));
    await writeFile(resolve(folder,`${stem}.json`),JSON.stringify({frame,time:frame/30,...state}));
   }));
  }
  console.log(JSON.stringify({captured:level,frames:frameCount}));
 }
 for(const frame of[30,35,38,73,75,77,82,105,159,160,167,180,225,270,300,330,360,390]){
  await page.evaluate(f=>window.reviewFrame('at',f),frame);
  await page.screenshot({path:resolve(output,`final-${frame}.png`)});
 }
 await page.setViewportSize({width:1920,height:1080});
 const cadence=entryOnly?null:await page.evaluate(async()=>{
  const {DifficultyPainter}=await import('/src/difficulty-painter.ts');
  const canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:999';document.body.append(canvas);
  const painter=await DifficultyPainter.create(canvas);painter.resize();painter.draw(.5,'at');
  const frames=[];let start,last=-1;
  await new Promise(done=>{function tick(now){start??=now;const t=Math.min(15.2,.5+(now-start)/1000),key=Math.floor(t*120);
   if(key!==last){painter.draw(t,'at');frames.push({at:now,reference:Math.floor(t*30)});last=key;}
   if(t<15.2)requestAnimationFrame(tick);else done();
  }requestAnimationFrame(tick);});
  function stats(from,to){const rows=frames.filter(f=>f.reference>=from&&f.reference<to),d=rows.slice(1).map((f,i)=>f.at-rows[i].at).sort((a,b)=>a-b);
   return{samples:rows.length,updatesPerSecond:Math.round((rows.length-1)*1000/(rows.at(-1).at-rows[0].at)),p95IntervalMs:+d[Math.floor(d.length*.95)].toFixed(2),maxIntervalMs:+d.at(-1).toFixed(2)};
  }
  canvas.remove();return{viewport:[1920,1080],all:stats(30,450),tail:stats(300,450)};
 });
 const result={capturedFrames:frameCount*4,cadence,behavior,videoLabelRequests,errors,scope:'Local source-frame export and drawing-call cadence; not display presentation timing'};
 await writeFile(resolve(output,entryOnly?'browser-entry-verification.json':'browser-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
