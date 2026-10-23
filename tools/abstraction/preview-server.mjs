import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {gzipSync} from 'node:zlib';
import {buildPreview,previewRoot} from './build-preview.mjs';

await buildPreview();
const server=createServer(async(req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  const path=new URL(req.url,'http://localhost').pathname;
  if(!['/','/index.html','/manifest.json'].includes(path)&&!/^\/assets\/[a-z0-9-]+\.(svg|webp)$/.test(path)){res.writeHead(404);res.end();return;}
  const file=resolve(previewRoot,path==='/'?'index.html':path.slice(1));let body=await readFile(file);
  const type={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp'}[extname(file)];
  const headers={'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Accept-Encoding'};
  if(extname(file)!=='.webp'&&/\bgzip\b/.test(req.headers['accept-encoding']??'')){body=gzipSync(body);headers['Content-Encoding']='gzip';}
  headers['Content-Length']=body.length;res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:body);
 }catch{res.writeHead(500);res.end('Preview unavailable');}
});
server.listen(5177,'127.0.0.1',()=>console.log('Abstraction preview: http://127.0.0.1:5177'));
