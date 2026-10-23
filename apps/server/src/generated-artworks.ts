import {Injectable,OnModuleDestroy,ServiceUnavailableException} from '@nestjs/common';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,readdir,rename,stat,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Db} from './db';
import {configuration} from './config';
import {ArtworkWorker,ARTWORK_GENERATOR_VERSION,type GeneratedDifficulty} from './artwork-worker';
import type {Artwork} from './catalog';

interface Recipe{id:string;match_id:string;round:number;source_artwork_id:string;difficulty:GeneratedDifficulty;seed:string|number;algorithm:string;images:Record<string,string>;source_key:string}
export interface ServedArtwork{key:string;mime:string;body?:Buffer}
const levels={hd:['hd'],in:['hd','in'],at:['in','at']} as const;
const generatedKey=/^[a-f0-9-]{36}\.svg$/;
const sourceKey=/^[a-f0-9-]{36}\.(webp|png|jpe?g)$/;

@Injectable()
export class GeneratedArtworks implements OnModuleDestroy{
 private worker=new ArtworkWorker();private pending=new Map<string,Promise<Record<string,Buffer>>>();private pruning?:Promise<void>;private nextPrune=0;
 constructor(private db:Db){}
 async createSession(matchId:string){if(!/^[a-f0-9-]{36}$/.test(matchId))throw new Error('Invalid match ID');await mkdir(join(configuration().GENERATED_ASSET_DIR,matchId),{recursive:true});}
 async onModuleDestroy(){await this.worker.close();await Promise.allSettled([...this.pending.values()]);await this.pruning;}
 isGenerated(art:Artwork){return art.difficulty!=='ez'&&Boolean(art.source_artwork_id);}
 async tutorial(slug:string,difficulty:GeneratedDifficulty):Promise<Buffer>{
  const titles:Record<string,string>={ds:'Desultory Signals',mirage:'Exoplanetary Mirage',chaos:'Entrance to the Chaos','8000':'ハテ'};
  if(!titles[slug]||!levels[difficulty])throw new ServiceUnavailableException('Unknown tutorial artwork');
  const source=(await this.db.query(`SELECT a.id,COALESCE(a.generation_source_key,a.storage_key) AS source_key FROM artworks a JOIN songs s ON s.id=a.song_id
   WHERE a.active AND a.difficulty='ez' AND a.variant='default' AND s.title=$1 ORDER BY a.id LIMIT 1`,[titles[slug]])).rows[0];
  if(!source||!sourceKey.test(source.source_key))throw new ServiceUnavailableException('Tutorial EZ source unavailable');
  const directory=join(configuration().GENERATED_ASSET_DIR,'tutorial');
  const key=(level:string)=>{const h=createHash('sha256').update(`tutorial:${source.id}:${ARTWORK_GENERATOR_VERSION}:${level}`).digest('hex').slice(0,32);return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}.svg`;};
  try{return await readFile(join(directory,key(difficulty)));}catch{}
  const id=`tutorial:${source.id}:${difficulty}`,pending=this.pending.get(id);
  if(pending)return (await pending)[difficulty]!;
  const work=(async()=>{
   const seed=createHash('sha256').update(`tutorial:${slug}`).digest().readUInt32BE();
   const images=await this.worker.run({id,path:join(configuration().ASSET_DIR,source.source_key),seed,version:ARTWORK_GENERATOR_VERSION,difficulty},1);
   await mkdir(directory,{recursive:true});
   for(const [level,body] of Object.entries(images)){const temporary=join(directory,randomUUID()+'.tmp');await writeFile(temporary,body,{flag:'wx'});await rename(temporary,join(directory,key(level)));}
   return images;
  })();
  this.pending.set(id,work);try{return (await work)[difficulty]!;}finally{this.pending.delete(id);}
 }
 private async recipe(matchId:string,round:number,art:Artwork):Promise<Recipe>{
  if(!art.source_artwork_id||art.difficulty==='ez')throw new Error('Generated artwork requires an EZ source');
  await this.db.query(`INSERT INTO match_artwork_recipes(id,match_id,round,source_artwork_id,difficulty,seed,algorithm,source_key)
   SELECT $1,$2,$3,$4,$5,$6,$7,COALESCE(generation_source_key,storage_key) FROM artworks WHERE id=$4 ON CONFLICT(match_id,round) DO NOTHING`,[randomUUID(),matchId,round,art.source_artwork_id,art.difficulty,randomBytes(4).readUInt32BE(),ARTWORK_GENERATOR_VERSION]);
  const row=(await this.db.query<Recipe>(`SELECT r.* FROM match_artwork_recipes r WHERE r.match_id=$1 AND r.round=$2`,[matchId,round])).rows[0];
  if(!row||row.source_artwork_id!==art.source_artwork_id||row.difficulty!==art.difficulty)throw new Error('Artwork recipe does not match the round');
  return row;
 }
 async prepare(matchId:string,round:number,art:Artwork,priority=1){
  if(!this.isGenerated(art))return;
  const recipe=await this.recipe(matchId,round,art);await this.bundle(recipe,priority);
 }
 async render(matchId:string,round:number,art:Artwork,difficulty=art.difficulty,priority=0):Promise<ServedArtwork>{
  if(!this.isGenerated(art)){
   if(!art.storage_key)throw new ServiceUnavailableException('Artwork file unavailable');
   return {key:art.storage_key,mime:art.mime};
  }
  const recipe=await this.recipe(matchId,round,art);
  if(difficulty==='ez'){
   const source=(await this.db.query('SELECT storage_key,mime FROM artworks WHERE id=$1 AND difficulty=\'ez\'',[recipe.source_artwork_id])).rows[0];
   if(!source?.storage_key)throw new ServiceUnavailableException('EZ artwork unavailable');
   return {key:source.storage_key,mime:source.mime};
  }
  if(!(levels[recipe.difficulty] as readonly string[]).includes(difficulty))throw new ServiceUnavailableException('Invalid generated difficulty');
  try{const images=await this.bundle(recipe,priority);return {key:recipe.images[difficulty]??'',mime:'image/svg+xml',body:images[difficulty]!};}
  catch{throw new ServiceUnavailableException('Artwork is being prepared; please retry');}
 }
 private async bundle(recipe:Recipe,priority:number):Promise<Record<string,Buffer>>{
  if(priority===0)this.worker.promote(recipe.id);
  const existing=this.pending.get(recipe.id);if(existing)return existing;
  const work=this.loadOrGenerate(recipe,priority);this.pending.set(recipe.id,work);
  try{return await work;}finally{if(this.pending.get(recipe.id)===work)this.pending.delete(recipe.id);}
 }
 private async loadOrGenerate(recipe:Recipe,priority:number){
  const directory=join(configuration().GENERATED_ASSET_DIR,recipe.match_id),required=levels[recipe.difficulty];
  try{
   const cached:Record<string,Buffer>={};
   for(const level of required){const key=recipe.images[level];if(!key||!generatedKey.test(key))throw new Error('Generated cache miss');cached[level]=await readFile(join(directory,key));}
   return cached;
  }catch{/* A deleted cache entry can be regenerated from its persistent recipe. */}
  if(!sourceKey.test(recipe.source_key))throw new Error('Invalid EZ source key');
  const images=await this.worker.run({id:recipe.id,path:join(configuration().ASSET_DIR,recipe.source_key),seed:Number(recipe.seed),version:recipe.algorithm,difficulty:recipe.difficulty},priority);
  await mkdir(directory,{recursive:true});const keys={...recipe.images};
  for(const level of required){
   const body=images[level];if(!body||body.length>2*1024*1024)throw new Error('Generated image exceeds budget');
   const key=keys[level]&&generatedKey.test(keys[level]!)?keys[level]!:randomUUID()+'.svg',temporary=join(directory,randomUUID()+'.tmp');
   await writeFile(temporary,body,{flag:'wx'});await rename(temporary,join(directory,key));keys[level]=key;
  }
  await this.db.query('UPDATE match_artwork_recipes SET images=$2 WHERE id=$1',[recipe.id,JSON.stringify(keys)]);recipe.images=keys;
  if(Date.now()>=this.nextPrune&&!this.pruning){this.nextPrune=Date.now()+60000;this.pruning=this.prune(configuration().GENERATED_ASSET_DIR,new Set(Object.values(keys).map(key=>join(directory,key)))).catch(()=>{}).finally(()=>{this.pruning=undefined;});}
  return images;
 }
 private async prune(directory:string,keep:Set<string>){
  const files=[];let bytes=0;
  for(const folder of await readdir(directory,{withFileTypes:true})){
   if(!folder.isDirectory()||!(folder.name==='tutorial'||/^[a-f0-9-]{36}$/.test(folder.name)))continue;
   const sub=join(directory,folder.name);
   for(const name of await readdir(sub)){if(!generatedKey.test(name))continue;try{const path=join(sub,name),info=await stat(path);if(!info.isFile())continue;files.push({name:path,bytes:info.size,time:info.mtimeMs});bytes+=info.size;}catch{}}
  }
  const limit=configuration().GENERATED_CACHE_MIB*1024*1024;
  for(const file of files.sort((a,b)=>a.time-b.time)){if(bytes<=limit)break;if(keep.has(file.name))continue;try{await unlink(file.name);bytes-=file.bytes;}catch{}}
 }
}
