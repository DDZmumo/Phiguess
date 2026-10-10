import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
const catalog=JSON.parse(await readFile('storage/corpus/catalog.json','utf8'));
await mkdir('output/assets',{recursive:true});
for(const [index,group] of catalog.groups.slice(0,3).entries()){
  const before=await sharp(resolve('storage/corpus/source',group.assets.hd)).resize(600,340,{fit:'contain',background:'#131720'}).png().toBuffer();
  const after=await sharp(resolve('storage/corpus/prepared',group.songId,group.variant,'hd.svg')).resize(600,340,{fit:'contain',background:'#131720'}).png().toBuffer();
  await sharp({create:{width:1200,height:340,channels:3,background:'#131720'}}).composite([{input:before,left:0,top:0},{input:after,left:600,top:0}]).png().toFile(`output/assets/trace-${index}.png`);
  console.log(index,group.title);
}
