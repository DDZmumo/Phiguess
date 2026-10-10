// Local, temporary export sink for the developer frame-review page.
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=resolve('output/playwright/difficulty-frame-review');
await mkdir(output,{recursive:true});
const allowed=new Set(['at','in','hd','ez']);let written=0;
const server=createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','http://localhost:5174');
 res.setHeader('Access-Control-Allow-Headers','Content-Type');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 if(req.method!=='POST'||req.url!=='/frame'){res.writeHead(404);res.end();return;}
 try{
  let raw='',bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>2*1024*1024)throw Error('Frame body too large');raw+=chunk;}
  const {level,frame,state,png}=JSON.parse(raw);
  if(!allowed.has(level)||!Number.isInteger(frame)||frame<0||frame>521||typeof png!=='string'||!png.startsWith('data:image/png;base64,'))throw Error('Invalid frame');
  const folder=resolve(output,level),stem=String(frame+1).padStart(4,'0');await mkdir(folder,{recursive:true});
  await writeFile(resolve(folder,`${stem}.png`),Buffer.from(png.slice(22),'base64'));
  await writeFile(resolve(folder,`${stem}.json`),JSON.stringify({frame,time:frame/30,...state}));
  written++;res.writeHead(200);res.end('ok');
 }catch(error){res.writeHead(400);res.end(error.message);}
});
server.listen(5190,'127.0.0.1',()=>console.log(`Frame export ready: 5190 -> ${output}`));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
setInterval(()=>console.log(`Exported frames: ${written}`),30000).unref();
