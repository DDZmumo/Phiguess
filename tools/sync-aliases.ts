import { createHash } from 'node:crypto';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as tls from 'node:tls';
import { Db } from '../apps/server/src/db';
import {configuration} from '../apps/server/src/config';
import {mergedAliases,parseAliasMap,type AliasSong} from './alias-data';

export interface AliasSnapshot {raw:string;commit:string;sourceUpdatedAt:string}
export async function applyAliasSnapshot(db:Db,snapshot:AliasSnapshot,metadata?:AliasSong[],options:{snapshotRoot?:string}={}) {
  if(!/^[a-f0-9]{40}$/.test(snapshot.commit)||!Number.isFinite(Date.parse(snapshot.sourceUpdatedAt)))throw new Error('Invalid alias source identity');
  const aliasMap=parseAliasMap(snapshot.raw),songs=metadata??JSON.parse(await readFile('data/catalog/songs.json','utf8')) as AliasSong[];
  let overrides:Record<string,string[]>={};try{overrides=JSON.parse(await readFile('data/catalog/aliases.local.json','utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  let updated=0,aliasCount=0;
  await db.transaction(async sql=>{for(const song of songs){const values=mergedAliases(song,aliasMap,overrides),result=await sql.query('UPDATE songs SET aliases=$2 WHERE id=$1 RETURNING id',[song.songId,JSON.stringify(values)]);if(result.rows.length){updated++;aliasCount+=values.length;}}});
  const result={repository:'https://github.com/Catrong/phi-plugin',commit:snapshot.commit,sha256:createHash('sha256').update(snapshot.raw).digest('hex'),updated,aliasCount,sourceUpdatedAt:new Date(snapshot.sourceUpdatedAt).toISOString(),at:new Date().toISOString()};
  const directory=resolve(options.snapshotRoot??resolve(configuration().GENERATED_ASSET_DIR,'../library/snapshots'),snapshot.commit);await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'nicklist.yaml'),snapshot.raw);await writeFile(resolve(directory,'sync.json'),JSON.stringify(result,null,2));
  const state=resolve(configuration().GENERATED_ASSET_DIR,'../library');await mkdir(state,{recursive:true});await writeFile(resolve(state,'aliases-state.json'),JSON.stringify(result,null,2));return result;
}

export async function refreshAliases(db:Db) {
  const ca=tls as typeof tls & {getCACertificates?:(kind:string)=>string[];setDefaultCACertificates?:(values:string[])=>void};
  if(ca.getCACertificates&&ca.setDefaultCACertificates)ca.setDefaultCACertificates([...tls.rootCertificates,...ca.getCACertificates('system')]);
  const api='https://api.github.com/repos/Catrong/phi-plugin';
  async function request(url:string){const r=await fetch(url,{signal:AbortSignal.timeout(20_000),headers:{'User-Agent':'Phiguess-catalog-sync'}});if(!r.ok)throw new Error(`Upstream returned ${r.status}`);return r;}
  const repo=await (await request(api)).json() as {default_branch:string};
  const commits=await (await request(`${api}/commits?sha=${encodeURIComponent(repo.default_branch)}&path=resources%2Finfo%2Fnicklist.yaml&per_page=1`)).json() as {sha:string;commit:{committer:{date:string}}}[];
  const commit=commits[0];if(!commit)throw new Error('No alias source revision');
  if(!/^[0-9a-f]{40}$/.test(commit.sha))throw new Error('Invalid upstream revision');
  const raw=await (await request(`https://raw.githubusercontent.com/Catrong/phi-plugin/${commit.sha}/resources/info/nicklist.yaml`)).text();
  if(raw.length>2_000_000)throw new Error('Alias file exceeds budget');
  return applyAliasSnapshot(db,{raw,commit:commit.sha,sourceUpdatedAt:commit.commit.committer.date});
}
if(require.main===module){const db=new Db();const work=process.argv.includes('--offline')?Promise.all([readFile('data/providers/phi-plugin/nicklist.yaml','utf8'),readFile('data/providers/phi-plugin/aliases-provenance.json','utf8')]).then(([raw,meta])=>{const source=JSON.parse(meta);if(createHash('sha256').update(raw).digest('hex')!==source.sha256)throw new Error('Pinned alias snapshot checksum mismatch');return applyAliasSnapshot(db,{raw,commit:source.commit,sourceUpdatedAt:source.sourceUpdatedAt});}):refreshAliases(db);void work.then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.close());}
