import {Injectable} from '@nestjs/common';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {LibraryCatalog,LibraryChapter,LibrarySong} from '../../../packages/contracts/src';
import {Db} from './db';
import {configuration} from './config';

type Group={songId:string;chapter:string;variant?:string};
type Row={id:string;title:string;aliases:string[];composer:string|null;chapter:number|null;chapter_name:string|null;illustrator:string|null;artwork_id:string|null;original_preview_key:string|null};
export function libraryChapterGroup(chapter:string):LibraryChapter['group']{
 if(/^\d/.test(chapter))return 'main';if(chapter.startsWith('Side Story'))return 'side';if(chapter.startsWith('Chapter EX'))return 'collab';return 'other';
}
export function libraryChapterCover(chapter:string){
 if(/^0[1-3] /.test(chapter))return 'MainStoryLegacy';if(/^0[4-7] /.test(chapter))return `MainStory${chapter[1]}`;
 if(chapter.startsWith('08'))return 'MainStory8_2';if(chapter.startsWith('09'))return 'MainStory9';
 const side=chapter.match(/^Side Story (\d)/);if(side)return `SideStory${side[1]}`;
 const covers:Record<string,string>={KALPA:'KALPA',EGTS:'EGTS',OverRapid:'OverRapid',CYTUS:'Cytus2',Rotaeno:'Rotaeno','Rising Sun':'RST',Lanota:'Lanota',Paradigm:'ParadigmReboot',GOOD:'Good',Liminality:'Liminality',WAVEAT:'WAVEAT',maimai:'Maimai',CHUNITHM:'CHUNITHM',HyuN:'HyuN','Muse Dash':'MUSEDASH','姜米條':'JMT','节奏大师':'RhythmMaster','茶鸣拾贰律':'TEA12','Immaculée':'ImmaculeeSekai',TAKUMI:'TAKUMI3',SHINOBI:'SHINOBISLASH','オンゲキ':'Ongeki'};
 for(const [key,value] of Object.entries(covers))if(chapter.includes(key))return value;return 'Single';
}
@Injectable()
export class LibraryService {
 constructor(private readonly db:Db){}
 private async chapterMetadata(){
  const map=new Map<string,{chapter:string;order:number;priority:number}>();
  try{const data=JSON.parse(await readFile(resolve('storage/corpus/catalog.json'),'utf8')) as {groups:Group[]};
   for(const [order,g] of data.groups.entries()){
    const priority=g.variant==='default'||!g.variant?0:g.variant==='illustration-in'?1:2;
    const previous=map.get(g.songId);if(!previous||priority<previous.priority)map.set(g.songId,{chapter:g.chapter,order:previous?.order??order,priority});
   }
  }catch{}
  return map;
 }
 private async updatedAt(){
  for(const path of [resolve(configuration().GENERATED_ASSET_DIR,'../library/aliases-state.json'),resolve('data/providers/phi-plugin/aliases-provenance.json')]){
   try{const data=JSON.parse(await readFile(path,'utf8'));const value=data.sourceUpdatedAt??data.updatedAt;if(typeof value==='string'&&Number.isFinite(Date.parse(value)))return new Date(value).toISOString();}catch{}
  }
  return null;
 }
 async catalog():Promise<LibraryCatalog>{
  const [rows,metadata,updatedAt]=await Promise.all([
   this.db.query<Row>(`SELECT s.id,s.title,s.aliases,s.composer,s.chapter,s.chapter_name,a.illustrator,a.id AS artwork_id,a.original_preview_key
    FROM songs s LEFT JOIN LATERAL (SELECT id,illustrator,original_preview_key FROM artworks
     WHERE song_id=s.id AND active AND difficulty='ez'
     ORDER BY (original_preview_key IS NULL),CASE variant WHEN 'default' THEN 0 WHEN 'illustration-in' THEN 1 ELSE 2 END,id LIMIT 1) a ON true
    WHERE s.enabled`),this.chapterMetadata(),this.updatedAt()]);
  const songs:LibrarySong[]=rows.rows.sort((a,b)=>(metadata.get(a.id)?.order??Number.MAX_SAFE_INTEGER)-(metadata.get(b.id)?.order??Number.MAX_SAFE_INTEGER)||a.title.localeCompare(b.title)).map(row=>{
   const title=row.title.trim(),chapter=metadata.get(row.id)?.chapter??row.chapter_name??(row.chapter?`${String(row.chapter).padStart(2,'0')} 主线章节`:'其他歌曲');
   return {id:row.id,title,composer:row.composer??'',illustrator:row.illustrator??'',chapter,aliases:[...new Set((row.aliases??[]).filter(a=>typeof a==='string').map(a=>a.trim()).filter(a=>a&&a!==title))],image:row.artwork_id&&row.original_preview_key?`/api/showcase/${row.artwork_id}/image`:null};
  });
  const chapters:LibraryChapter[]=[];for(const song of songs){let chapter=chapters.find(c=>c.id===song.chapter);if(!chapter){const group=libraryChapterGroup(song.chapter);chapter={id:song.chapter,name:song.chapter,group,cover:group==='other'&&song.image?song.image:`/library/covers/${libraryChapterCover(song.chapter)}.webp`,count:0};chapters.push(chapter);}chapter.count++;}
  return {songs,chapters,updatedAt};
 }
}
