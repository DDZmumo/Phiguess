import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { Db } from '../apps/server/src/db';
import { importAssets } from './import-assets';
import { backfillShowcase,backfillOriginalPreviews } from './backfill-showcase';

// Original synthetic illustrations, never advertised as Phigros songs or user assets.
export async function seedDemo(db:Db,directory:string) {
  if(process.env.PHIGUESS_DEMO!=='1')throw new Error('Synthetic catalog requires PHIGUESS_DEMO=1');
  const entries=[
    {title:'零度视界',alias:'Zero Horizon',color:'#a0def0',dark:'#233857',hints:['题目与温度有关','曲名共四个汉字','前两个字是“零度”']},
    {title:'深空回声',alias:'Deep Echo',color:'#d0b6ff',dark:'#30224e',hints:['题目描写宇宙','曲名共四个汉字','前两个字是“深空”']},
    {title:'浮光航线',alias:'Luminous Route',color:'#f2bc7c',dark:'#473443',hints:['题目与航行有关','曲名共四个汉字','前两个字是“浮光”']},
    {title:'引力花园',alias:'Gravity Garden',color:'#a5e3c4',dark:'#173e42',hints:['物理概念与植物的组合','曲名共四个汉字','前两个字是“引力”']},
    {title:'终末微光',alias:'Last Glimmer',color:'#e2a6c7',dark:'#402438',hints:['题目描写最后的光','曲名共四个汉字','前两个字是“终末”']},
  ];
  await mkdir(directory,{recursive:true});
  for(const [index,e] of entries.entries()) {
    const songId=`6d3f04ef-3e41-4d62-a12a-${String(index+1).padStart(12,'0')}`;
    if((await db.query('SELECT id FROM songs WHERE id=$1',[songId])).rows.length){
      await db.query('UPDATE songs SET chapter=$2,chapter_name=$3,composer=$4 WHERE id=$1',[songId,index+1,`合成章节 ${index+1}`,'Phiguess Demo']);
      await db.query("UPDATE artworks SET illustrator=COALESCE(illustrator,'Phiguess Demo') WHERE song_id=$1",[songId]);
      await db.query("UPDATE artworks SET original_key=COALESCE(original_key,(SELECT storage_key FROM artworks WHERE song_id=$1 AND difficulty='ez' LIMIT 1)) WHERE song_id=$1",[songId]);continue;
    }
    const shapes=Array.from({length:12},(_,i)=>`<path d="M${i*75-180} 540 L${230+i*43} ${55+index*12} L${620+i*35} 540Z" fill="${e.color}" opacity="${.03+i*.007}"/>`).join('');
    const orb=`<circle cx="${460+index*30}" cy="230" r="142" fill="none" stroke="${e.color}" stroke-width="2"/><circle cx="${460+index*30}" cy="230" r="113" fill="none" stroke="${e.color}" stroke-width="1" opacity=".5"/><path d="M0 410L300 270 487 450 700 280 960 420V540H0Z" fill="${e.dark}"/><path d="M0 410L300 270 487 450 700 280 960 420" fill="none" stroke="${e.color}" stroke-width="1" opacity=".6"/>`;
    const svg=(level:number)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${e.dark}"/><stop offset="1" stop-color="#0d101a"/></linearGradient></defs><path fill="url(#bg)" d="M0 0H960V540H0Z"/>${shapes}<g transform="translate(${level*27} ${level*9}) rotate(${level*12} 480 270)">${orb}</g><path d="M70 50H230M70 50V180M890 490H730M890 490V360" fill="none" stroke="${e.color}" stroke-width="2" opacity=".5"/>${level>1?`<path d="M340 0H405V540H340ZM660 0H720V540H660Z" fill="${e.dark}" opacity=".7"/>`:''}</svg>`;
    const root=resolve(directory,String(index));await mkdir(root,{recursive:true});
    await sharp(Buffer.from(svg(0))).png().toFile(resolve(root,'ez.png'));
    for(const [j,difficulty] of ['hd','in','at'].entries())await writeFile(resolve(root,`${difficulty}.svg`),svg(j+1));
    const path=resolve(root,'manifest.json');
    await writeFile(path,JSON.stringify({songId,title:e.title,aliases:[e.alias],version:'synthetic-v1',chapter:index+1,chapterName:`合成章节 ${index+1}`,composer:'Phiguess Demo',illustrator:'Phiguess Demo',original:'ez.png',hints:e.hints,assets:{ez:'ez.png',hd:'hd.svg',in:'in.svg',at:'at.svg'}}));
    await importAssets(db,path);
  }
  await backfillShowcase(db);
  await backfillOriginalPreviews(db);
}
