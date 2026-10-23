import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { UUID } from '../packages/contracts/src';
import { configuration } from '../apps/server/src/config';
import { Db } from '../apps/server/src/db';
import {RELEASE_VERSIONS} from '../apps/server/src/version-hints';

export const Manifest=z.object({
  songId:UUID,title:z.string().trim().min(1).max(200),aliases:z.array(z.string().trim().min(1).max(200)).max(200).default([]),
  version:z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  hints:z.array(z.string().trim().min(1).max(240)).length(3).optional(),
  variant:z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).default('default'),
  original:z.string().optional(),
  chapter:z.number().int().min(1).max(99).optional(),
  chapterName:z.string().max(160).optional(),
  contentKind:z.enum(['main','non-main','april-fools']).default('main'),
  introducedVersion:z.string().refine(version=>RELEASE_VERSIONS.includes(version),'Unknown Phigros release version').optional(),
  removed:z.boolean().default(false),
  composer:z.string().max(240).optional(),
  illustrator:z.string().trim().min(1).max(240).optional(),
  assets:z.object({ez:z.string(),hd:z.string().optional(),in:z.string().optional(),at:z.string().optional()}).strict(),
}).strict().refine(manifest=>manifest.contentKind!=='non-main'||Boolean(manifest.introducedVersion),{message:'Non-main songs require introducedVersion',path:['introducedVersion']});

export async function importAssets(db: Db, manifestPath: string) {
  const manifest=Manifest.parse(JSON.parse(await readFile(manifestPath,'utf8')));
  const directory=configuration().ASSET_DIR;
  const prepared: { id:string; difficulty:string; mime:string; data:Buffer; key:string|null; preview?:Buffer; previewKey?:string }[]=[];
  const ezSource=resolve(dirname(manifestPath),manifest.assets.ez);
  if((await stat(ezSource)).size>20*1024*1024)throw new Error('EZ source exceeds 20 MiB');
  const ezInput=await readFile(ezSource),ezMeta=await sharp(ezInput,{limitInputPixels:16_000_000}).metadata();
  if(!['png','jpeg','webp'].includes(ezMeta.format??''))throw new Error('EZ must be PNG, JPEG or WebP');
  const generationSourceKey=`${randomUUID()}.${ezMeta.format}`;
  for (const difficulty of ['ez','hd','in','at'] as const) {
    let data: Buffer;
    if (difficulty==='ez') {
      data=await sharp(ezInput,{limitInputPixels:16_000_000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer();
    } else { data=Buffer.alloc(0); }
    const id=randomUUID(),mime=difficulty==='ez'?'image/webp':'image/svg+xml';
    const preview=difficulty==='ez'?await sharp(data).resize({width:960,height:660,fit:'inside',withoutEnlargement:true}).webp({quality:72}).toBuffer():undefined;
    prepared.push({id,difficulty,mime,data,key:difficulty==='ez'?`${randomUUID()}.webp`:null,preview,previewKey:preview?`${randomUUID()}.webp`:undefined});
  }
  // Only originals and EZ are imported; harder levels reference the same immutable EZ source.
  let original:Buffer|undefined,originalKey:string|undefined,originalPreview:Buffer|undefined,originalPreviewKey:string|undefined;
  if(manifest.original){
    const source=resolve(dirname(manifestPath),manifest.original);
    if((await stat(source)).size>20*1024*1024)throw new Error('Original exceeds 20 MiB');
    original=await sharp(await readFile(source),{limitInputPixels:16_000_000}).rotate().resize({width:1920,height:1920,fit:'inside',withoutEnlargement:true}).webp({quality:92}).toBuffer();
    originalKey=`${randomUUID()}.webp`;
    originalPreview=await sharp(original).resize({width:1280,height:880,fit:'inside',withoutEnlargement:true}).webp({quality:80}).toBuffer();originalPreviewKey=`${randomUUID()}.webp`;
  }
  await mkdir(directory,{recursive:true});
  await db.transaction(async sql=>{
    await sql.query('SELECT pg_advisory_xact_lock(71830422)');
    if ((await sql.query('SELECT id FROM artworks WHERE song_id=$1 AND version=$2 AND variant=$3',[manifest.songId,manifest.version,manifest.variant])).rows.length) throw new Error('Version already published; use a new version');
    await sql.query('INSERT INTO songs(id,title,aliases) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET title=excluded.title,aliases=excluded.aliases',[manifest.songId,manifest.title,JSON.stringify(manifest.aliases)]);
    if (manifest.hints) await sql.query('UPDATE songs SET hints=$2 WHERE id=$1',[manifest.songId,JSON.stringify(manifest.hints)]);
    await sql.query('UPDATE songs SET chapter=COALESCE($2,chapter),chapter_name=COALESCE($3,chapter_name),composer=COALESCE($4,composer) WHERE id=$1',[manifest.songId,manifest.chapter??null,manifest.chapterName??null,manifest.composer??null]);
    await sql.query('UPDATE artworks SET active=false WHERE song_id=$1 AND variant=$2',[manifest.songId,manifest.variant]);
    if(original&&originalKey)await writeFile(resolve(directory,originalKey),original,{flag:'wx'});
    if(originalPreview&&originalPreviewKey)await writeFile(resolve(directory,originalPreviewKey),originalPreview,{flag:'wx'});
    await writeFile(resolve(directory,generationSourceKey),ezInput,{flag:'wx'});
    for (const asset of prepared) {
      // An interrupted import may leave unreferenced files; it cannot corrupt prior files.
      if(asset.key)await writeFile(resolve(directory,asset.key),asset.data,{flag:'wx'});
      await sql.query('INSERT INTO artworks(id,song_id,version,difficulty,storage_key,mime,bytes,variant,original_key,original_preview_key,illustrator,source_artwork_id,generation_source_key,content_kind,introduced_version,removed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',[asset.id,manifest.songId,manifest.version,asset.difficulty,asset.key,asset.mime,asset.data.length,manifest.variant,originalKey??null,originalPreviewKey??null,manifest.illustrator??null,asset.difficulty==='ez'?null:prepared[0]!.id,asset.difficulty==='ez'?generationSourceKey:null,manifest.contentKind,manifest.introducedVersion??null,manifest.removed]);
      if(asset.preview&&asset.previewKey){await writeFile(resolve(directory,asset.previewKey),asset.preview,{flag:'wx'});await sql.query('UPDATE artworks SET preview_key=$2,preview_bytes=$3 WHERE id=$1',[asset.id,asset.previewKey,asset.preview.length]);}
    }
  });
  return {songId:manifest.songId,version:manifest.version,assets:prepared.map(a=>({difficulty:a.difficulty,bytes:a.data.length}))};
}
if (require.main===module) {
  const db=new Db();
  const path=process.argv[2];
  void (path ? importAssets(db,resolve(path)) : Promise.reject(new Error('Usage: npm run assets:import -- path/to/manifest.json')))
    .then(result=>console.log(JSON.stringify(result,null,2))).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.close());
}
