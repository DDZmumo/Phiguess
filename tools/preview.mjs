import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import LocalPostgres from './postgres.mjs';

const {values}=parseArgs({options:{port:{type:'string'},demo:{type:'boolean',default:false}}});
const webPort=Number(values.port??process.env.PHIGUESS_PREVIEW_PORT??5174);
if(!Number.isInteger(webPort)||webPort<1||webPort>65535)throw new Error('Preview port must be an integer from 1 to 65535');
const publicOrigin=`http://127.0.0.1:${webPort}`;
const root=resolve('storage/preview');await mkdir(root,{recursive:true});
const realCatalog=existsSync('storage/corpus/catalog.json')&&!values.demo;
const database=realCatalog?'phiguess_local':'phiguess_preview';
let config;
try{config=JSON.parse(await readFile(resolve(root,'config.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;config={password:randomBytes(24).toString('hex'),secret:randomBytes(32).toString('hex')};await writeFile(resolve(root,'config.json'),JSON.stringify(config),{flag:'wx',mode:0o600});}
const environment={NODE_ENV:'development',PORT:'3000',DATABASE_URL:`postgres://phiguess:${config.password}@127.0.0.1:55433/${database}`,ASSET_DIR:realCatalog?resolve('storage/assets'):resolve(root,'assets'),AVATAR_DIR:realCatalog?resolve('storage/avatars'):resolve(root,'avatars'),GENERATED_ASSET_DIR:resolve(root,'generated'),PUBLIC_ORIGIN:publicOrigin,PHIGUESS_PREVIEW_PORT:String(webPort),TRUST_PROXY:'0',PHIGUESS_DEMO:realCatalog?'0':'1',VITE_DEMO_CATALOG:realCatalog?'false':'true'};
Object.assign(process.env,environment);
await writeFile(resolve(root,'runtime.env'),Object.entries(environment).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n'),{mode:0o600});
const pg=new LocalPostgres({databaseDir:resolve(root,'db'),user:'phiguess',password:config.password,port:55433});
const children=[];let stopping=false;
async function stop(code=0){if(stopping)return;stopping=true;for(const child of children){child.kill();await new Promise(r=>{if(child.exitCode!==null)return r();child.once('exit',r);setTimeout(r,3000).unref();});}await pg.stop();process.exit(code);}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
try {
  await pg.initialise();await pg.start();const client=pg.getPgClient();await client.connect();
  if(!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rows.length)await pg.createDatabase(database);
  await client.end();
  const require=createRequire(import.meta.url),{Db}=require('../dist/apps/server/src/db.js'),{migrate}=require('../dist/tools/migrate.js'),{seedDemo}=require('../dist/tools/demo-catalog.js'),{importCatalog}=require('../dist/tools/import-catalog.js');
  const db=new Db();try{await migrate(db);if(realCatalog)console.log(await importCatalog(db));else await seedDemo(db,resolve(root,'fixtures'));}finally{await db.close();}
  for(const args of [['dist/apps/server/src/main.js'],['node_modules/vite/bin/vite.js','--config','apps/web/vite.config.ts','--port',String(webPort),'apps/web']]) {
    const child=spawn(process.execPath,args,{stdio:'inherit',env:process.env,windowsHide:true});children.push(child);
    child.on('exit',code=>{if(!stopping)void stop(code??1);});
    if(args[0]==='dist/apps/server/src/main.js'){
      let ready=false;
      for(let attempt=0;attempt<50;attempt++){try{ready=(await fetch('http://127.0.0.1:3000/api/health/ready')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100));}
      if(!ready)throw new Error('Backend did not become ready');
    }
  }
  console.log(`Phiguess preview: ${publicOrigin} — ${realCatalog?'local Phigros artwork catalog':'synthetic catalog'}, isolated database. Ctrl+C stops all preview processes.`);
}catch(e){console.error(e);await stop(1);}
