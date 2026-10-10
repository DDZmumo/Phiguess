import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Db } from '../apps/server/src/db';
import { Manifest } from './import-assets';
import { migrate } from './migrate';

interface SongCredit {songId:string;providerId:string;composer?:string;illustrator?:string;[key:string]:unknown}
interface GroupCredit extends SongCredit {variant:string}

export async function syncCredits(db:Db){
  const raw=await readFile('data/providers/phi-plugin/info.csv','utf8');
  const provenance=JSON.parse(await readFile('data/providers/phi-plugin/provenance.json','utf8'));
  const hash=createHash('sha256').update(raw).digest('hex');
  if(hash!==provenance.files['info.csv'].sha256)throw new Error('Song metadata snapshot does not match its provenance');
  const lines=raw.replace(/^\uFEFF/,'').trim().split(/\r?\n/),headers=lines.shift()!.split('\t');
  const upstream=new Map(lines.map(line=>{const values=line.split('\t');return [values[headers.indexOf('id')]!,{composer:values[headers.indexOf('composer')]?.trim(),illustrator:values[headers.indexOf('illustrator')]?.trim()}] as const;}));
  const songs:SongCredit[]=JSON.parse(await readFile('data/catalog/songs.json','utf8'));
  const catalog=JSON.parse(await readFile('storage/corpus/catalog.json','utf8')) as {groups:GroupCredit[]};
  const manifests:Array<{path:string;manifest:ReturnType<typeof Manifest.parse>}> = [];
  const credits=(song:SongCredit)=>{
    const found=upstream.get(song.providerId);
    if(!found?.composer||!found.illustrator)throw new Error(`Missing composer/illustrator for ${song.providerId}`);
    return {composer:song.composer||found.composer,illustrator:song.illustrator||found.illustrator};
  };
  for(const song of songs)Object.assign(song,credits(song));
  const preparedRoot=resolve('storage/corpus/prepared');
  for(const group of catalog.groups){
    Object.assign(group,credits(group));
    const path=resolve(preparedRoot,group.songId,group.variant,'manifest.json');
    if(!path.startsWith(preparedRoot+sep))throw new Error('Manifest path escapes the prepared catalog');
    const original=Manifest.parse(JSON.parse(await readFile(path,'utf8')));
    manifests.push({path,manifest:Manifest.parse({...original,composer:original.composer||group.composer,illustrator:original.illustrator||group.illustrator})});
  }
  await migrate(db);
  await db.transaction(async sql=>{
    for(const song of songs)await sql.query("UPDATE songs SET composer=COALESCE(NULLIF(composer,''),$2) WHERE id=$1",[song.songId,song.composer]);
    for(const {manifest} of manifests)await sql.query("UPDATE artworks SET illustrator=COALESCE(NULLIF(illustrator,''),$4) WHERE song_id=$1 AND version=$2 AND variant=$3",[manifest.songId,manifest.version,manifest.variant,manifest.illustrator]);
    // Previously unlocked identity hints use the updated difficulty-specific format too.
    await sql.query(`UPDATE revealed_hints h SET content='曲师：'||s.composer||E'\n画师：'||a.illustrator
      FROM matches m JOIN match_rounds r ON r.match_id=m.id JOIN artworks a ON a.id=r.artwork_id JOIN songs s ON s.id=a.song_id
      WHERE h.match_id=m.id AND h.round=r.round AND h.hint_index=2 AND m.difficulty IN ('in','at')
      AND s.composer IS NOT NULL AND a.illustrator IS NOT NULL`);
  });
  await writeFile('data/catalog/songs.json',JSON.stringify(songs,null,2)+'\n');
  await writeFile('storage/corpus/catalog.json',JSON.stringify(catalog,null,2)+'\n');
  for(const {path,manifest} of manifests)await writeFile(path,JSON.stringify(manifest,null,2)+'\n');
  const coverage=(await db.query(`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE a.illustrator IS NULL OR btrim(a.illustrator)='')::int AS missing_illustrators,
    count(*) FILTER (WHERE s.composer IS NULL OR btrim(s.composer)='')::int AS missing_composers
    FROM artworks a JOIN songs s ON s.id=a.song_id WHERE a.active AND s.enabled`)).rows[0];
  const result={source:`${provenance.repository}/blob/${provenance.commit}/resources/info/info.csv`,sha256:hash,songs:songs.length,variants:manifests.length,coverage,at:new Date().toISOString()};
  await writeFile('data/providers/phi-plugin/credits-sync.json',JSON.stringify(result,null,2)+'\n');
  return result;
}
if(require.main===module){const db=new Db();void syncCredits(db).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>db.close());}
