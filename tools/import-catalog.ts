import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Db } from '../apps/server/src/db';
import { importAssets,Manifest } from './import-assets';
import { backfillOriginalPreviews } from './backfill-showcase';

export async function importCatalog(db:Db,catalogPath=resolve('storage/corpus/catalog.json')) {
  const catalog=JSON.parse(await readFile(catalogPath,'utf8')) as {groups:{songId:string;variant:string}[]};
  let imported=0,skipped=0;
  for(const group of catalog.groups){
    const path=resolve('storage/corpus/prepared',group.songId,group.variant,'manifest.json'),manifest=Manifest.parse(JSON.parse(await readFile(path,'utf8')));
    const exists=(await db.query('SELECT id FROM artworks WHERE song_id=$1 AND version=$2 AND variant=$3',[manifest.songId,manifest.version,manifest.variant])).rows;
    if(exists.length===4){
      // Preserve later alias synchronization and operator-authored hints on restart.
      skipped++;
    }else{await importAssets(db,path);imported++;}
    await db.query('UPDATE songs SET chapter=COALESCE($2,chapter),chapter_name=COALESCE($3,chapter_name),composer=COALESCE($4,composer) WHERE id=$1',[manifest.songId,manifest.chapter??null,manifest.chapterName??null,manifest.composer??null]);
    if(manifest.illustrator)await db.query('UPDATE artworks SET illustrator=COALESCE(NULLIF(illustrator,\'\'),$4) WHERE song_id=$1 AND version=$2 AND variant=$3',[manifest.songId,manifest.version,manifest.variant,manifest.illustrator]);
  }
  await backfillOriginalPreviews(db);
  const counts=(await db.query("SELECT difficulty,count(*)::int AS count,sum(bytes)::bigint AS bytes FROM artworks WHERE active GROUP BY difficulty ORDER BY difficulty")).rows;
  const result={imported,skipped,songs:(await db.query('SELECT count(*)::int AS n FROM songs WHERE enabled')).rows[0]!.n,artworks:counts};
  await mkdir('storage/corpus',{recursive:true});await writeFile('storage/corpus/import-report.json',JSON.stringify(result,null,2));return result;
}
if(require.main===module){const db=new Db();void importCatalog(db).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.close());}
