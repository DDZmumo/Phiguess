import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,readdir,stat,unlink,writeFile} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {Db} from '../apps/server/src/db';
import {configuration} from '../apps/server/src/config';

/** Attach the lossless EZ base to every retained version without changing displayed EZ/originals. */
export async function backfillDynamicSources(db:Db,catalogPath=resolve('storage/corpus/catalog.json')){
 const catalog=JSON.parse(await readFile(catalogPath,'utf8')) as {groups:{songId:string;variant:string;assets:{ez:string}}[]};
 const directory=configuration().ASSET_DIR;await mkdir(directory,{recursive:true});let attached=0;
 for(const group of catalog.groups){
  const rows=(await db.query("SELECT id,generation_source_key FROM artworks WHERE song_id=$1 AND variant=$2 AND difficulty='ez'",[group.songId,group.variant])).rows;
  if(!rows.length)continue;
  let key=rows.find(r=>r.generation_source_key)?.generation_source_key as string|undefined;
  if(!key){
   const base=resolve('storage/corpus/source'),source=resolve(base,group.assets.ez);
   if(!source.startsWith(base+sep)||!source.endsWith('.webp'))throw new Error('Unexpected EZ source path');
   const bytes=await readFile(source);if(bytes.length>20*1024*1024)throw new Error('EZ source exceeds budget');key=randomUUID()+'.webp';await writeFile(join(directory,key),bytes,{flag:'wx'});
  }
  if(!/^[a-f0-9-]{36}\.(webp|png|jpeg)$/.test(key))throw new Error('Invalid generation source key');await stat(join(directory,key));
  await db.query("UPDATE artworks SET generation_source_key=$3 WHERE song_id=$1 AND variant=$2 AND difficulty='ez' AND generation_source_key IS NULL",[group.songId,group.variant,key]);
  attached+=rows.filter(r=>!r.generation_source_key).length;
 }
 await db.query(`UPDATE artworks a SET source_artwork_id=e.id FROM artworks e WHERE a.difficulty IN ('hd','in','at') AND e.difficulty='ez'
  AND a.song_id=e.song_id AND a.version=e.version AND a.variant=e.variant AND a.source_artwork_id IS NULL`);
 return {attached};
}

/** Only retire static harder artwork files after their EZ replacement has been verified. */
export async function retireLegacyArtworks(db:Db,apply=false){
 const directory=configuration().ASSET_DIR;
 const candidates=(await db.query(`SELECT a.id,a.storage_key,COALESCE(e.generation_source_key,e.storage_key) AS source_key
  FROM artworks a JOIN artworks e ON e.id=a.source_artwork_id WHERE a.difficulty<>'ez' AND a.storage_key IS NOT NULL`)).rows;
 const targets:{id:string|null;key:string;bytes:number;sha256:string|null}[]=[];
 for(const row of candidates){
  if(!/^[a-f0-9-]{36}\.svg$/.test(row.storage_key))throw new Error('Unexpected legacy artwork file');
  if(!/^[a-f0-9-]{36}\.(webp|png|jpeg)$/.test(row.source_key??''))throw new Error('Missing EZ replacement');
  await stat(join(directory,row.source_key));const path=join(directory,row.storage_key);let bytes:Buffer|undefined;
  try{bytes=await readFile(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  targets.push({id:row.id,key:row.storage_key,bytes:bytes?.length??0,sha256:bytes?createHash('sha256').update(bytes).digest('hex'):null});
 }
 const known=new Set(targets.map(item=>item.key));
 for(const key of await readdir(directory)){
  if(known.has(key)||!/^[a-f0-9-]{36}\.svg$/.test(key))continue;
  const referenced=(await db.query('SELECT 1 FROM artworks WHERE storage_key=$1 OR preview_key=$1 OR original_key=$1 OR original_preview_key=$1 OR generation_source_key=$1 LIMIT 1',[key])).rows.length;
  if(referenced)continue;const bytes=await readFile(join(directory,key));targets.push({id:null,key,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 const unmapped=(await db.query("SELECT count(*)::int AS count FROM artworks WHERE difficulty<>'ez' AND source_artwork_id IS NULL")).rows[0]!.count;
 if(apply){
  await mkdir('output',{recursive:true});await writeFile(resolve('output',`retired-artworks-${Date.now()}.json`),JSON.stringify({directory,targets,unmapped},null,2));
  await db.transaction(async sql=>{for(const target of targets)if(target.id)await sql.query('UPDATE artworks SET storage_key=NULL,bytes=0 WHERE id=$1 AND storage_key=$2',[target.id,target.key]);});
  for(const target of targets){
   const referenced=(await db.query('SELECT 1 FROM artworks WHERE storage_key=$1 OR preview_key=$1 OR original_key=$1 OR original_preview_key=$1 OR generation_source_key=$1 LIMIT 1',[target.key])).rows.length;
   if(referenced)continue;
   try{const path=join(directory,target.key),bytes=await readFile(path);if(createHash('sha256').update(bytes).digest('hex')!==target.sha256)throw new Error('Legacy file changed during cleanup');await unlink(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
 }
 return {apply,files:targets.length,bytes:targets.reduce((sum,x)=>sum+x.bytes,0),unmapped};
}
if(require.main===module){const db=new Db();void (async()=>{const apply=process.argv.includes('--apply'),attached=apply?await backfillDynamicSources(db):{};console.log(JSON.stringify({...attached,...await retireLegacyArtworks(db,apply)},null,2));})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>db.close());}
