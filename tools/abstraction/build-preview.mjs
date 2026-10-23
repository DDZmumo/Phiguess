import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import sharp from 'sharp';
import {generateAbstractions,recipe} from './generator.mjs';

export const previewRoot=resolve('output/ez-abstraction-preview');
export async function buildPreview(){
 const catalog=JSON.parse(await readFile('storage/corpus/catalog.json','utf8'));
 const featured=['Desultory Signals','Exoplanetary Mirage','Entrance to the Chaos'],seeds=[12345,54321,90210],songs=[];
 const groups=catalog.groups.filter(g=>/^09\s/.test(g.chapter));
 groups.sort((a,b)=>(featured.indexOf(a.title)<0?99:featured.indexOf(a.title))-(featured.indexOf(b.title)<0?99:featured.indexOf(b.title)));
 const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
 const require=createRequire(import.meta.url),{validateSvg}=require('../../dist/tools/svg.js');
 await mkdir(resolve(previewRoot,'assets'),{recursive:true});
 for(let index=0;index<groups.length;index++){
  const group=groups[index];
  const input=await readFile(resolve('storage/corpus/source',group.assets.ez)),ez=`assets/song-${index}-ez.webp`;await writeFile(resolve(previewRoot,ez),input);
  if(hash(input)!==hash(await readFile(resolve(previewRoot,ez))))throw new Error('EZ preview changed source bytes');
  const samples=[];
  for(const seed of seeds){
   const generated=await generateAbstractions(input,seed),variants={};
   for(const [level,value] of Object.entries(generated.variants)){
    validateSvg(value.svg);const url=`assets/song-${index}-${seed}-${level}.svg`;await writeFile(resolve(previewRoot,url),value.svg);
    variants[level]={url,regions:value.regions,colors:value.colors,bytes:value.bytes,gzipBytes:value.gzipBytes,sha256:hash(value.svg)};
   }
   if(!(variants.hd.regions>variants.in.regions&&variants.in.regions>variants.at.regions))throw new Error('Non-monotonic complexity');
   samples.push({seed,milliseconds:generated.milliseconds,variants});
  }
  const repeat=await generateAbstractions(input,seeds[0]);
  for(const level of ['hd','in','at']){
   if(hash(repeat.variants[level].svg)!==samples[0].variants[level].sha256)throw new Error('Seed not reproducible');
   if(new Set(samples.map(s=>s.variants[level].sha256)).size!==seeds.length)throw new Error('Seeds do not change the generated artwork');
  }
  const displayTitle=group.variant==='default'?group.title:`${group.title} · ${group.variant.replace('illustration-','').toUpperCase()} 曲绘`;
  songs.push({title:group.title,displayTitle,variant:group.variant,chapter:group.chapter,ez,sourceSha256:hash(input),samples});
  console.log(`${group.title}: three seeds verified, EZ unchanged`);
 }
 const manifest={recipe,songs};await writeFile(resolve(previewRoot,'manifest.json'),JSON.stringify(manifest,null,2));
 await copyFile('tools/abstraction/preview.html',resolve(previewRoot,'index.html'));
 const cell=388,imageHeight=205,rowHeight=248,height=72+songs.length*rowHeight,composites=[];
 let labels=`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${height}"><style>text{font-family:Arial,sans-serif;fill:#dbe8f4}</style>`;
 for(const [i,name] of ['EZ - unchanged','HD','IN','AT'].entries())labels+=`<text x="${14+i*400}" y="32" font-size="21">${name}</text>`;
 labels+=`<text x="14" y="56" font-size="12">Chapter 09 / seed ${seeds[0]} / ${recipe.version}</text>`;
 for(const [row,song] of songs.entries()){
  const y=72+row*rowHeight,title=(song.title+(song.variant==='default'?'':` / ${song.variant}`)).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');labels+=`<text x="14" y="${y+17}" font-size="16">${title}</text>`;
  for(const [col,file] of [song.ez,...['hd','in','at'].map(level=>song.samples[0].variants[level].url)].entries()){
   const input=await sharp(await readFile(resolve(previewRoot,file))).resize(cell,imageHeight,{fit:'contain',background:'#10151d'}).png().toBuffer();composites.push({input,left:6+col*400,top:y+27});
  }
 }
 composites.push({input:Buffer.from(labels+'</svg>'),left:0,top:0});
 await sharp({create:{width:1600,height,channels:3,background:'#10151d'}}).composite(composites).png().toFile(resolve(previewRoot,'chapter-nine-comparison.png'));
 console.log(JSON.stringify({songs:songs.length,generatedImages:songs.length*seeds.length*3,minMs:Math.min(...songs.flatMap(s=>s.samples.map(x=>x.milliseconds))),maxMs:Math.max(...songs.flatMap(s=>s.samples.map(x=>x.milliseconds)))}));
 return manifest;
}
