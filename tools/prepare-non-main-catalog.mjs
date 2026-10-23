import {readFile,writeFile,readdir,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import YAML from 'yaml';
import sharp from 'sharp';
import {prepareManifests} from './prepare-manifests.mjs';

const source=resolve(process.argv.find(arg=>arg.startsWith('--source='))?.slice(9)??'E:/Project/PhiguessAs-NonMain-2026-10-22');
const apply=process.argv.includes('--apply'),root=resolve('storage/corpus');
const collection=JSON.parse(await readFile(resolve(source,'manifest.json'),'utf8'));
const shardDir=resolve('output/non-main-artwork/shards');
for(const file of await readdir(shardDir)){
 if(!file.endsWith('.json'))continue;
 for(const row of JSON.parse(await readFile(resolve(shardDir,file),'utf8'))){
  const item=collection.images[row.index];
  if(!item||item.id!==row.id||item.raw!==row.raw||item.ez!==row.ez)throw new Error(`Shard identity mismatch: ${file}/${row.index}`);
  for(const key of ['ezStatus','ezSha256','editSource','review','excludeFromGame','error'])if(row[key]!==undefined)item[key]=row[key];
 }
}
const pending=collection.images.filter(item=>item.ezStatus!=='blocked'&&(!['edited','reused'].includes(item.ezStatus)||/pending/i.test(item.review??'')));
const counts={total:collection.images.length,edited:collection.images.filter(item=>item.ezStatus==='edited').length,reused:collection.images.filter(item=>item.ezStatus==='reused').length,blocked:collection.images.filter(item=>item.ezStatus==='blocked').length,pending:pending.length};
console.log(JSON.stringify(counts));
if(!apply)process.exit(0);
if(pending.length)throw new Error(`EZ collection is incomplete: ${pending.length} images still pending`);

const digest=data=>createHash('sha256').update(data).digest('hex');
const stableId=value=>{const b=createHash('sha1').update(Buffer.from('6ba7b8119dad11d180b400c04fd430c8','hex')).update(value).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const normalize=value=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const aliases=YAML.parse(await readFile('data/providers/phi-plugin/nicklist.yaml','utf8'));
const catalog=JSON.parse(await readFile(resolve(root,'catalog.json'),'utf8'));
const rows=(await readFile('data/providers/phi-plugin/info.csv','utf8')).trim().split(/\r?\n/).slice(1).map(line=>line.split('\t'));
// Do the entire validation pass before changing the corpus or any import manifests.
const additions=[],excluded=[];
for(const item of collection.images){
 const rawPath=resolve(source,item.raw);
 if(item.ezStatus==='blocked'){
  if(digest(await readFile(rawPath))!==item.rawSha256)throw new Error(`Checksum mismatch: ${item.id}`);
  excluded.push({id:item.id,title:item.title,raw:`Raw/Non-main/Not-in-game/${basename(item.raw,'.webp')}.${item.rawSha256.slice(0,8)}.webp`,sourceRaw:rawPath,rawSha256:item.rawSha256,reason:'Image-model output safety review rejected this edit; no clean EZ was produced.'});continue;
 }
 const ezPath=resolve(source,item.ez),raw=await readFile(rawPath),ez=await readFile(ezPath);
 if(digest(raw)!==item.rawSha256||digest(ez)!==item.ezSha256)throw new Error(`Checksum mismatch: ${item.id}`);
 if(item.ezStatus==='reused'&&!raw.equals(ez))throw new Error(`Untouched EZ differs from Raw: ${item.id}`);
 if(item.ezStatus==='edited'){
  if(!item.editSource)throw new Error(`Missing model output provenance: ${item.id}`);
  const pngPixels=await sharp(item.editSource).ensureAlpha().raw().toBuffer(),webpPixels=await sharp(ez).ensureAlpha().raw().toBuffer();
  if(!pngPixels.equals(webpPixels))throw new Error(`Lossless WebP check failed: ${item.id}`);
 }
 const baseTitle=item.title.replace(/\(2024 April Fools' Day\)$/,'').trim();
 const lookup=item.id.startsWith('Revisit(')?'Retribution':baseTitle;
 const matched=rows.find(row=>row[0]===item.id)??rows.find(row=>normalize(row[1])===normalize(lookup));
 const special=item.contentKind==='april-fools',providerId=matched?.[0]??item.id,title=matched?.[1]??item.title;
 const variant=special?`april-${digest(Buffer.from(item.id)).slice(0,12)}`:'default';
 const rawRel=`Raw/Non-main/${item.chapter}/${basename(item.raw,'.webp')}.${item.rawSha256.slice(0,8)}.webp`;
 const ezRel=`Non-main/${item.chapter}/EZ/${basename(item.ez,'.webp')}.${item.ezSha256.slice(0,8)}.webp`;
 additions.push({item,rawPath,ezPath,group:{key:`non-main/${item.id}`,sourceTitle:item.title,providerId,title,songId:stableId(`https://github.com/Catrong/phi-plugin/song/${providerId}`),variant,assetVersion:`ez-clean-${item.ezSha256.slice(0,16)}`,chapter:item.chapter,contentKind:item.contentKind,introducedVersion:item.introducedVersion,removed:Boolean(item.removed),composer:item.composer,illustrator:item.illustrator,aliases:[...new Set([title,item.title,...(aliases[providerId]??aliases[title]??[])].filter(a=>typeof a==='string'&&a.trim()))],original:rawRel,assets:{ez:ezRel},provenance:{repository:item.sourceRepository??collection.repository,commit:item.sourceCommit??collection.commit,path:item.sourcePath,gitBlob:item.gitBlob,rawSha256:item.rawSha256,ezSha256:item.ezSha256,ezMethod:item.ezStatus}}});
}
for(const entry of additions){
 for(const [from,to]of [[entry.rawPath,entry.group.original],[entry.ezPath,entry.group.assets.ez]]){
  const dest=resolve(root,'source',to);await mkdir(dirname(dest),{recursive:true});
  try{await copyFile(from,dest,1);}catch(error){if(error.code!=='EEXIST')throw error;if(digest(await readFile(from))!==digest(await readFile(dest)))throw new Error(`Existing destination differs: ${dest}`);}
 }
 const index=catalog.groups.findIndex(group=>group.key===entry.group.key);
 if(index<0)catalog.groups.push(entry.group);else catalog.groups[index]=entry.group;
}
for(const item of excluded){
 const dest=resolve(root,'source',item.raw);await mkdir(dirname(dest),{recursive:true});
 try{await copyFile(item.sourceRaw,dest,1);}catch(error){if(error.code!=='EEXIST')throw error;if(digest(await readFile(dest))!==item.rawSha256)throw new Error(`Existing excluded Raw differs: ${item.id}`);}
 delete item.sourceRaw;
}
// The canonical song title and union of aliases remain shared across jacket variants.
for(const group of catalog.groups){const siblings=catalog.groups.filter(other=>other.songId===group.songId);group.aliases=[...new Set(siblings.flatMap(other=>other.aliases))];}
catalog.sourceHash=digest(Buffer.from(JSON.stringify(catalog.groups.map(group=>({key:group.key,original:group.original,ez:group.assets.ez,provenance:group.provenance??null})).sort((a,b)=>a.key.localeCompare(b.key)))));
await writeFile(resolve(source,'manifest.json'),JSON.stringify(collection,null,2));
await writeFile(resolve(root,'catalog.json'),JSON.stringify(catalog,null,2));
await writeFile(resolve('data/catalog/songs.json'),JSON.stringify([...new Map(catalog.groups.map(group=>[group.songId,{songId:group.songId,providerId:group.providerId,title:group.title,composer:group.composer,illustrator:group.illustrator,sourceTitles:catalog.groups.filter(other=>other.songId===group.songId).map(other=>other.sourceTitle)}])).values()],null,2));
await prepareManifests(root);
await writeFile(resolve(root,'non-main-import-source.json'),JSON.stringify({repository:collection.repository,commit:collection.commit,metadataCommit:collection.metadataCommit,counts,images:additions.map(entry=>({id:entry.item.id,key:entry.group.key,original:entry.group.original,ez:entry.group.assets.ez,...entry.group.provenance}))},null,2));
await writeFile(resolve(root,'non-main-excluded.json'),JSON.stringify(excluded,null,2));
console.log(JSON.stringify({added:additions.length,totalGroups:catalog.groups.length,songs:new Set(catalog.groups.map(group=>group.songId)).size}));
