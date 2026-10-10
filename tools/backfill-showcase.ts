import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { Db } from '../apps/server/src/db';
import { configuration } from '../apps/server/src/config';

export async function backfillShowcase(db:Db) {
  const rows=(await db.query("SELECT id,storage_key FROM artworks WHERE difficulty='ez' AND preview_key IS NULL")).rows;
  for(const row of rows) {
    if(!/^[-a-f0-9]{36}\.webp$/.test(row.storage_key))throw new Error('Invalid EZ storage key');
    const input=await readFile(join(configuration().ASSET_DIR,row.storage_key));
    const output=await sharp(input).resize({width:960,height:660,fit:'inside',withoutEnlargement:true}).webp({quality:72}).toBuffer(),key=`${randomUUID()}.webp`;
    await writeFile(join(configuration().ASSET_DIR,key),output,{flag:'wx'});
    await db.query('UPDATE artworks SET preview_key=$2,preview_bytes=$3 WHERE id=$1 AND preview_key IS NULL',[row.id,key,output.length]);
  }
  return rows.length;
}
export async function backfillOriginalPreviews(db:Db) {
  const rows=(await db.query('SELECT DISTINCT original_key FROM artworks WHERE original_key IS NOT NULL AND original_preview_key IS NULL')).rows;
  for(const row of rows){
    if(!/^[-a-f0-9]{36}\.webp$/.test(row.original_key))throw new Error('Invalid original key');
    const output=await sharp(await readFile(join(configuration().ASSET_DIR,row.original_key))).resize({width:1280,height:880,fit:'inside',withoutEnlargement:true}).webp({quality:80}).toBuffer();
    const key=`${randomUUID()}.webp`;await writeFile(join(configuration().ASSET_DIR,key),output,{flag:'wx'});
    await db.query('UPDATE artworks SET original_preview_key=$2 WHERE original_key=$1',[row.original_key,key]);
  }
  return rows.length;
}
if(require.main===module){const db=new Db();void backfillShowcase(db).then(n=>console.log(`Prepared ${n} EZ previews`)).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.close());}
