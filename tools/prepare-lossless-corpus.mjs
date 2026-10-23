import { readFile, writeFile, stat, rm } from 'node:fs/promises';
import { resolve, relative, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const encoding={lossless:true,effort:6,exact:true};
const sha256=data=>createHash('sha256').update(data).digest('hex');
const posix=path=>path.split(sep).join('/');
const webpPath=path=>path.replace(/\.(png|webp)$/i,'.webp');
const pngPath=path=>path.replace(/\.(png|webp)$/i,'.png');
const version=group=>`clean64-v2-lossless-${group.variant}`;

/** Offline only: supports WebP-only sources; published database/files stay untouched. */
export async function prepareLosslessCorpus({root=resolve('storage/corpus'),verifyOnly=false}={}) {
  const catalogPath=resolve(root,'catalog.json');
  const sourceRoot=resolve(root,'source');
  const catalog=JSON.parse(await readFile(catalogPath,'utf8'));
  let previous;
  try { previous=JSON.parse(await readFile(resolve(root,'lossless-webp-report.json'),'utf8')); } catch(error) { if(error.code!=='ENOENT')throw error; }
  const inputs=[...new Set(catalog.groups.flatMap(group=>[pngPath(group.original),pngPath(group.assets.ez)]))].sort();
  if(inputs.some(path=>!/^Raw\/.+\.png$/i.test(path)&&!/^.+\/EZ\/[^/]+\.png$/i.test(path)))throw new Error('Unexpected raster outside Raw/EZ');
  for(const path of inputs){
    for(const name of [path,webpPath(path)]){
      const absolute=resolve(sourceRoot,name);
      if(!absolute.startsWith(sourceRoot+sep))throw new Error(`Raster escapes source directory: ${name}`);
    }
  }
  const files=[];
  for(const path of inputs){
    const source=resolve(root,'source',path),target=resolve(root,'source',webpPath(path));
    let png;
    try { png=await readFile(source); } catch(error) { if(error.code!=='ENOENT')throw error; }
    const recorded=previous?.files.find(file=>file.source===path);
    let webp;
    try { webp=await readFile(target); } catch(error) {
      if(error.code!=='ENOENT'||verifyOnly||!png)throw error;
      webp=await sharp(png,{limitInputPixels:16_000_000}).webp(encoding).toBuffer();
    }
    const after=await sharp(webp).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const before=png?await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true}):after;
    if(png){
      if(before.info.width!==after.info.width||before.info.height!==after.info.height||!before.data.equals(after.data))throw new Error(`RGBA mismatch: ${path}`);
    }else if(!recorded||recorded.webpSha256!==sha256(webp)||recorded.rgbaSha256!==sha256(after.data)||recorded.width!==after.info.width||recorded.height!==after.info.height){
      throw new Error(`WebP does not match verified conversion report: ${path}`);
    }
    if((await sharp(webp).metadata()).format!=='webp')throw new Error(`Not WebP: ${target}`);
    if(!verifyOnly){
      try { await stat(target); } catch(error) {
        if(error.code!=='ENOENT')throw error;
        await writeFile(target,webp,{flag:'wx'});
      }
    }
    files.push({source:path,target:webpPath(path),category:path.startsWith('Raw/')?'original':'ez',width:before.info.width,height:before.info.height,pngBytes:png?.length??recorded.pngBytes,webpBytes:webp.length,pngSha256:png?sha256(png):recorded.pngSha256,webpSha256:sha256(webp),rgbaSha256:sha256(before.data),rgbaEqual:true});
    if(files.length%10===0)console.log(`Verified ${files.length}/${inputs.length} Raw/EZ images`);
  }
  // Validate every existing manifest before changing any reference/version.
  const manifests=[];
  for(const group of catalog.groups){
    const path=resolve(root,'prepared',group.songId,group.variant,'manifest.json');
    let manifest;
    try { manifest=JSON.parse(await readFile(path,'utf8')); } catch(error) {if(error.code==='ENOENT'&&!verifyOnly)continue;throw error;}
    const expectedOriginal=posix(relative(dirname(path),resolve(root,'source',webpPath(group.original))));
    const expectedEz=posix(relative(dirname(path),resolve(root,'source',webpPath(group.assets.ez))));
    if(verifyOnly){
      if(manifest.original!==expectedOriginal||manifest.assets.ez!==expectedEz||manifest.version!==version(group))throw new Error(`Stale lossless manifest: ${path}`);
    }else{
      if(![`clean64-v1-${group.variant}`,version(group)].includes(manifest.version))throw new Error(`Unmanaged manifest version; review manually: ${path}`);
      manifests.push({path,manifest:{...manifest,original:expectedOriginal,assets:{...manifest.assets,ez:expectedEz},version:version(group)}});
    }
  }
  for(const group of catalog.groups){
    if(verifyOnly&&(!group.original.endsWith('.webp')||!group.assets.ez.endsWith('.webp')))throw new Error(`Stale catalog: ${group.key}`);
    group.original=webpPath(group.original);group.assets.ez=webpPath(group.assets.ez);
  }
  const totals=category=>files.filter(file=>!category||file.category===category).reduce((sum,file)=>({files:sum.files+1,pngBytes:sum.pngBytes+file.pngBytes,webpBytes:sum.webpBytes+file.webpBytes}),{files:0,pngBytes:0,webpBytes:0});
  const report={encoding,scope:'Raw originals and EZ question images; WebP-only sources supported with verified PNG conversion hashes; HD/IN/AT are generated at runtime',dimensionsAndRgbaEqual:true,totals:totals(),originals:totals('original'),ez:totals('ez'),manifestVersion:'clean64-v2-lossless-{variant}',databaseModified:false,files};
  if(!verifyOnly){
    for(const {path,manifest} of manifests){
      const content=JSON.stringify(manifest,null,2)+'\n';
      if(await readFile(path,'utf8')!==content)await writeFile(path,content);
    }
    await writeFile(catalogPath,JSON.stringify(catalog,null,2)+'\n');
    await writeFile(resolve(root,'lossless-webp-report.json'),JSON.stringify(report,null,2)+'\n');
    // All images and references have been verified before removing source PNGs.
    for(const path of inputs)await rm(resolve(sourceRoot,path),{force:true});
  }
  console.log(JSON.stringify({verified:files.length,verifyOnly,...report.totals,originals:report.originals,ez:report.ez,databaseModified:false},null,2));
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=='--verify-only'))throw new Error('Usage: node tools/prepare-lossless-corpus.mjs [--verify-only]');
  await prepareLosslessCorpus({verifyOnly:args.includes('--verify-only')});
}
