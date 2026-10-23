import {readFile,writeFile,realpath,unlink,mkdir,rmdir,readdir} from 'node:fs/promises';
import {resolve,sep,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareManifests} from './prepare-manifests.mjs';

const root=resolve('storage/corpus'),source=resolve(root,'source'),prepared=resolve(root,'prepared'),tutorial=resolve('apps/web/public/tutorial');
const catalog=JSON.parse(await readFile(resolve(root,'catalog.json'),'utf8')),hash=data=>createHash('sha256').update(data).digest('hex');
const protectedFiles=[],targets=[],targetPaths=new Set();
async function within(base,name){const file=resolve(base,name);if(!file.startsWith(base+sep))throw new Error('Path escapes artwork directory');const actual=await realpath(file);if(actual!==file)throw new Error('Artwork links require manual review');return file;}
async function keep(base,name){const path=await within(base,name);protectedFiles.push({path,sha256:hash(await readFile(path))});}
async function candidate(base,name){try{const path=await within(base,name);if(targetPaths.has(path))return;const data=await readFile(path);targetPaths.add(path);targets.push({path,sha256:hash(data),bytes:data.length});}catch(error){if(error.code!=='ENOENT')throw error;}}
for(const group of catalog.groups){
 await keep(source,group.original);await keep(source,group.assets.ez);
 if(!/^[a-f0-9-]{36}$/.test(group.songId)||!/^[a-z0-9._-]+$/i.test(group.variant))throw new Error('Unexpected catalog identifier');
 for(const difficulty of ['hd','in','at']){
  const old=group.assets[difficulty];if(old){if(!new RegExp(`/${difficulty}/[^/]+\\.(png|webp)$`,'i').test(old))throw new Error('Unexpected source category');await candidate(source,old);}
  const relativeFolder=dirname(group.assets.ez)+'/../'+difficulty.toUpperCase();
  try{const folder=await within(source,relativeFolder);for(const name of await readdir(folder))if(/\.(png|webp)$/i.test(name))await candidate(source,relativeFolder+'/'+name);}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const suffix of ['svg','clean.png','trace.json'])await candidate(prepared,`${group.songId}/${group.variant}/${difficulty}.${suffix}`);
 }
}
for(const slug of ['ds','mirage','chaos','8000']){
 for(const name of [`${slug}-ez.png`,`${slug}-original.png`,`${slug}-original.webp`])await keep(tutorial,name);
 for(const difficulty of ['hd','in','at'])await candidate(tutorial,`${slug}-${difficulty}.svg`);
}
const apply=process.argv.includes('--apply'),report={apply,protected:protectedFiles.length,files:targets.length,bytes:targets.reduce((n,x)=>n+x.bytes,0)};
if(apply){
 await mkdir('output',{recursive:true});await writeFile(resolve('output',`retired-static-corpus-${Date.now()}.json`),JSON.stringify({report,protectedFiles,targets},null,2));
 for(const group of catalog.groups)group.assets={ez:group.assets.ez};
 await writeFile(resolve(root,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');await prepareManifests(root);
 for(const item of targets){if(hash(await readFile(item.path))!==item.sha256)throw new Error('Source changed after inventory');await unlink(item.path);}
 for(const group of catalog.groups)for(const difficulty of ['HD','IN','AT']){
  const folder=resolve(source,dirname(group.assets.ez),'..',difficulty);
  if(!folder.startsWith(source+sep))throw new Error('Folder escapes source');
  try{if(await realpath(folder)!==folder)throw new Error('Unexpected source link');await rmdir(folder);}catch(error){if(!['ENOENT','ENOTEMPTY'].includes(error.code))throw error;}
 }
 for(const item of protectedFiles)if(hash(await readFile(item.path))!==item.sha256)throw new Error('Protected original/EZ changed');
}
console.log(JSON.stringify(report,null,2));
