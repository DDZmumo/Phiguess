import LocalPostgres from './postgres.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdir, readdir, rm } from 'node:fs/promises';

const reservation=createServer();
await new Promise(r=>reservation.listen(0,'127.0.0.1',r));
const port=reservation.address().port;
await new Promise(r=>reservation.close(r));
const testRoot=resolve('storage/tests',randomUUID());
await mkdir(testRoot,{recursive:true});
const password=randomBytes(24).toString('hex');
const logs=[];
const pg=new LocalPostgres({databaseDir:resolve(testRoot,'postgres'),user:'phiguess_test',password,port,
  authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:m=>logs.push(String(m)),onError:m=>logs.push(String(m))});
try {
  await pg.initialise(); await pg.start(); await pg.createDatabase('phiguess_test');
  console.log(`Temporary PostgreSQL started on 127.0.0.1:${port}`);
  const requested=process.argv.slice(2),available=(await readdir('dist/tests')).filter(f=>f.endsWith('.test.js'));
  if(requested.some(name=>!available.includes(name)))throw new Error('Unknown test file');
  const files=available.filter(name=>!requested.length||requested.includes(name)).map(f=>`dist/tests/${f}`);
  const child=spawn(process.execPath,['--test','--test-concurrency=1',...files],{stdio:'inherit',env:{...process.env,
    NODE_ENV:'test',DATABASE_URL:`postgres://phiguess_test:${password}@127.0.0.1:${port}/phiguess_test`,
    ASSET_DIR:resolve(testRoot,'assets'),AVATAR_DIR:resolve(testRoot,'avatars'),GENERATED_ASSET_DIR:resolve(testRoot,'generated'),TEST_ROOT:testRoot,
    PUBLIC_ORIGIN:'http://localhost:3000',TRUST_PROXY:'0'}});
  process.exitCode=await new Promise((r,j)=>{child.on('error',j);child.on('exit',code=>r(code ?? 1));});
} catch(error) {
  console.error(error); console.error(logs.slice(-20).join('\n')); process.exitCode=1;
} finally {
  await pg.stop(); console.log('Temporary PostgreSQL stopped');
  // Only remove this invocation's generated directory, after the server has stopped.
  const parent=resolve('storage/tests');
  if (testRoot.startsWith(parent + (process.platform==='win32'?'\\':'/'))) await rm(testRoot,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
