import LocalPostgres from './postgres.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const root=resolve('storage/local-db');
await mkdir(root,{recursive:true});
const configPath=resolve(root,'connection.json');
let config;
try { config=JSON.parse(await readFile(configPath,'utf8')); }
catch(error) {
  if (error.code!=='ENOENT') throw error;
  config={user:'phiguess',password:randomBytes(24).toString('hex'),port:55432};
  await writeFile(configPath,JSON.stringify(config),{flag:'wx',mode:0o600});
}
const pg=new LocalPostgres({...config,databaseDir:resolve(root,'data')});
let stopped=false;
async function stop() { if(stopped)return;stopped=true;await pg.stop();process.exit(0); }
process.on('SIGINT',()=>void stop()); process.on('SIGTERM',()=>void stop());
await pg.initialise(); await pg.start();
const client=pg.getPgClient();await client.connect();
if (!(await client.query("SELECT 1 FROM pg_database WHERE datname='phiguess'")).rows.length) await pg.createDatabase('phiguess');
await client.end();
// Credentials stay in an ignored local file, never in logs.
await writeFile(resolve(root,'database.env'),`DATABASE_URL=postgres://${config.user}:${config.password}@127.0.0.1:${config.port}/phiguess\n`,{mode:0o600});
console.log(`PostgreSQL listening at 127.0.0.1:${config.port}. Copy DATABASE_URL from storage/local-db/database.env into .env. Ctrl+C stops it; data is retained.`);
// Keep this terminal alive until Ctrl+C. No Windows service or startup entry.
setInterval(()=>{},60_000);
