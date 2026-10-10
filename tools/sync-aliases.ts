import { createHash } from 'node:crypto';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import YAML from 'yaml';
import * as tls from 'node:tls';
import { Db } from '../apps/server/src/db';

export async function refreshAliases(db:Db) {
  const ca=tls as typeof tls & {getCACertificates?:(kind:string)=>string[];setDefaultCACertificates?:(values:string[])=>void};
  if(ca.getCACertificates&&ca.setDefaultCACertificates)ca.setDefaultCACertificates([...tls.rootCertificates,...ca.getCACertificates('system')]);
  const api='https://api.github.com/repos/Catrong/phi-plugin';
  async function request(url:string){const r=await fetch(url,{signal:AbortSignal.timeout(20_000),headers:{'User-Agent':'Phiguess-catalog-sync'}});if(!r.ok)throw new Error(`Upstream returned ${r.status}`);return r;}
  const repo=await (await request(api)).json() as {default_branch:string};
  const commit=await (await request(`${api}/commits/${encodeURIComponent(repo.default_branch)}`)).json() as {sha:string};
  if(!/^[0-9a-f]{40}$/.test(commit.sha))throw new Error('Invalid upstream revision');
  const raw=await (await request(`https://raw.githubusercontent.com/Catrong/phi-plugin/${commit.sha}/resources/info/nicklist.yaml`)).text();
  if(raw.length>2_000_000)throw new Error('Alias file exceeds budget');
  const aliasMap=YAML.parse(raw) as Record<string,unknown>;
  const songs=JSON.parse(await readFile('data/catalog/songs.json','utf8')) as {songId:string;providerId:string;title:string;sourceTitles?:string[]}[];
  let overrides:Record<string,string[]>={};try{overrides=JSON.parse(await readFile('data/catalog/aliases.local.json','utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  let updated=0,aliasCount=0;
  await db.transaction(async sql=>{
    for(const song of songs){
      const remote=aliasMap[song.providerId]??aliasMap[song.title]??[];
      if(!Array.isArray(remote)||remote.some(a=>typeof a!=='string'))throw new Error(`Invalid aliases for ${song.providerId}`);
      const local=overrides[song.providerId]??[];if(!Array.isArray(local)||local.some(a=>typeof a!=='string'))throw new Error('Invalid local alias overrides');
      const values=[...new Set([song.title,...(song.sourceTitles??[]),...remote,...local].map(a=>a.trim()).filter(a=>a&&a.length<=200))];
      await sql.query('UPDATE songs SET aliases=$2 WHERE id=$1',[song.songId,JSON.stringify(values)]);updated++;aliasCount+=values.length;
    }
  });
  const directory=resolve('data/providers/phi-plugin/snapshots',commit.sha);await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'nicklist.yaml'),raw);
  const result={repository:'https://github.com/Catrong/phi-plugin',commit:commit.sha,sha256:createHash('sha256').update(raw).digest('hex'),updated,aliasCount,at:new Date().toISOString()};
  await writeFile(resolve(directory,'sync.json'),JSON.stringify(result,null,2));return result;
}
if(require.main===module){const db=new Db();void refreshAliases(db).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.close());}
