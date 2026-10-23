import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function prepareManifests(root=resolve('storage/corpus')){
 const catalog=JSON.parse(await readFile(resolve(root,'catalog.json'),'utf8'));
 for(const group of catalog.groups){
  const folder=resolve(root,'prepared',group.songId,group.variant);await mkdir(folder,{recursive:true});
  const path=name=>relative(folder,resolve(root,'source',name)).split(sep).join('/');
  const main=(group.contentKind??'main')==='main';
  const manifest={songId:group.songId,title:group.title,aliases:group.aliases,version:group.assetVersion??`clean64-v2-lossless-${group.variant}`,variant:group.variant,...(group.hints?{hints:group.hints}:{}),...(main?{chapter:Number(group.chapter.match(/^\d+/)[0])}:{}),chapterName:group.chapter.replace(/^\d+\s*/,'').replace('/Part',' · Part'),contentKind:group.contentKind??'main',...(group.introducedVersion?{introducedVersion:group.introducedVersion}:{}),removed:Boolean(group.removed),composer:group.composer,...(group.illustrator?{illustrator:group.illustrator}:{}),original:path(group.original),assets:{ez:path(group.assets.ez)}};
  await writeFile(resolve(folder,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 }
 console.log(`Prepared ${catalog.groups.length} original/EZ manifests`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await prepareManifests();
