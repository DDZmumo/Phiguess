// Project-scoped PostgreSQL binaries supplied by the embedded-postgres dependency.
// Use pg_ctl for a graceful Windows shutdown (the package's default uses taskkill).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
const exec=promisify(execFile);

export default class LocalPostgres {
  constructor(options) { this.options=options;this.started=false; }
  async binaries() {
    const platform=process.platform==='win32'?'windows':process.platform;
    return import(`@embedded-postgres/${platform}-${process.arch}`);
  }
  async initialise() {
    const {databaseDir,user,password}=this.options;
    try {await access(resolve(databaseDir,'PG_VERSION'));return;} catch(error) {if(error.code!=='ENOENT')throw error;}
    await mkdir(dirname(databaseDir),{recursive:true});
    const passwordFile=resolve(dirname(databaseDir),'init-password.tmp');
    await writeFile(passwordFile,`${password}\n`,{flag:'wx',mode:0o600});
    try {
      const {initdb}=await this.binaries();
      await exec(initdb,['-D',databaseDir,'-U',user,'--auth=scram-sha-256',`--pwfile=${passwordFile}`,'--encoding=UTF8','--locale=C'],{windowsHide:true,timeout:30000});
    } finally {await unlink(passwordFile);}
  }
  async start() {
    const {pg_ctl}=await this.binaries();
    await exec(pg_ctl,['-D',this.options.databaseDir,'-l',resolve(dirname(this.options.databaseDir),'postgres.log'),'-o',`-h 127.0.0.1 -p ${this.options.port}`,'-w','-t','20','start'],{windowsHide:true,timeout:30000});
    this.started=true;
  }
  async stop() {
    if(!this.started)return;
    const {pg_ctl}=await this.binaries();
    await exec(pg_ctl,['-D',this.options.databaseDir,'-m','fast','-w','-t','20','stop'],{windowsHide:true,timeout:30000});
    this.started=false;
  }
  getPgClient(database='postgres') {
    const {user,password,port}=this.options;
    return new pg.Client({host:'127.0.0.1',user,password,port,database});
  }
  async createDatabase(name) {
    const client=this.getPgClient();await client.connect();
    try {await client.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);} finally {await client.end();}
  }
}
