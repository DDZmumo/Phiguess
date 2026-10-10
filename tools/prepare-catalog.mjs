import { readFile,writeFile,mkdir,readdir,copyFile,stat } from 'node:fs/promises';
import { resolve,relative,dirname,join,basename,sep } from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';

const source=resolve(process.argv[2]||'E:/Project/PhiguessAs'),root=resolve('storage/corpus');
const normalize=s=>s.normalize('NFKC').toLowerCase().replace(/\s+/g,'');
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
function stableId(value){const bytes=createHash('sha1').update(Buffer.from('6ba7b8119dad11d180b400c04fd430c8','hex')).update(value).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
async function walk(path){const files=[];for(const entry of await readdir(path,{withFileTypes:true})){if(entry.isSymbolicLink())throw new Error(`Symlink in source: ${entry.name}`);const full=join(path,entry.name);if(entry.isDirectory())files.push(...await walk(full));else if(entry.isFile())files.push(full);}return files;}
const infoText=await readFile('data/providers/phi-plugin/info.csv','utf8');
const rows=infoText.replace(/^\uFEFF/,'').trim().split(/\r?\n/).slice(1).map(line=>{const [id,title,composer,illustrator]=line.split('\t');return {id,title,composer,illustrator};});
const aliases=YAML.parse(await readFile('data/providers/phi-plugin/nicklist.yaml','utf8'));
const files=(await walk(source)).filter(file=>/\.png$/i.test(file)).sort();
const groups=new Map(),raw=new Map(),inventory=[];
for(const file of files){
  const rel=relative(source,file).split(sep).join('/'),parts=rel.split('/'),data=await readFile(file);
  inventory.push({path:rel,bytes:data.length,sha256:digest(data)});
  if(parts[0]==='Raw'){raw.set(parts.slice(1).join('/').replace(/\.png$/i,''),rel);continue;}
  const difficulty=parts.at(-2)?.toLowerCase();if(!['ez','hd','in','at'].includes(difficulty))throw new Error(`Unknown difficulty: ${rel}`);
  const title=basename(file,'.png').replace(new RegExp(`-${difficulty}$`,'i'),'');
  const chapter=parts.slice(0,-2).join('/'),key=`${chapter}/${title}`;
  if(!groups.has(key))groups.set(key,{key,sourceTitle:title,chapter,assets:{}});
  if(groups.get(key).assets[difficulty])throw new Error(`Duplicate source: ${key}/${difficulty}`);
  groups.get(key).assets[difficulty]=rel;
}
const unknown=[];
for(const group of groups.values()){
  let candidates=rows.filter(row=>normalize(row.title)===normalize(group.sourceTitle)),variant='default';
  if(!candidates.length&&/-(EZ|HD|IN|AT)$/i.test(group.sourceTitle)){
    const stripped=group.sourceTitle.replace(/-(EZ|HD|IN|AT)$/i,'');candidates=rows.filter(row=>normalize(row.title)===normalize(stripped));variant=`illustration-${group.sourceTitle.match(/-(EZ|HD|IN|AT)$/i)[1].toLowerCase()}`;
  }
  if(candidates.length!==1){unknown.push({source:group.key,candidates:candidates.map(r=>r.title)});continue;}
  const song=candidates[0];
  Object.assign(group,{songId:stableId(`https://github.com/Catrong/phi-plugin/song/${song.id}`),providerId:song.id,title:song.title,composer:song.composer,illustrator:song.illustrator,variant,
    aliases:[...new Set([group.sourceTitle,song.title,...(aliases[song.id]||aliases[song.title]||[])].filter(a=>typeof a==='string'&&a.trim()).map(a=>a.trim()))],
    original:raw.get(group.key),hints:[`所属章节：${group.chapter.replace(/^\d+\s*/, '').replace('/Part',' · Part')}`,`曲师：${song.composer}`,`标准曲名包含 ${[...song.title.replace(/\s/g,'')].length} 个非空白字符。`]});
  if(!group.original)throw new Error(`Missing original: ${group.key}`);
  for(const difficulty of ['ez','hd','in','at'])if(!group.assets[difficulty])throw new Error(`Missing ${difficulty}: ${group.key}`);
}
await mkdir(root,{recursive:true});await writeFile(join(root,'inventory.json'),JSON.stringify({source,files:inventory,groups:[...groups.values()],unknown},null,2));
if(unknown.length){console.log(JSON.stringify({unknown},null,2));process.exitCode=1;}else{
  let copied=0;
  for(const item of inventory){
    const dest=join(root,'source',item.path);await mkdir(dirname(dest),{recursive:true});
    try{const existing=await readFile(dest);if(digest(existing)!==item.sha256)throw new Error(`Source changed; preserve existing copy: ${item.path}`);}catch(error){if(error.code!=='ENOENT')throw error;await copyFile(join(source,item.path),dest);copied++;}
    if(digest(await readFile(dest))!==item.sha256)throw new Error(`Copy verification failed: ${item.path}`);
  }
  const catalog={version:1,sourceHash:digest(Buffer.from(JSON.stringify(inventory))),groups:[...groups.values()]};
  const sharedAliases=new Map();for(const group of catalog.groups){if(!sharedAliases.has(group.songId))sharedAliases.set(group.songId,new Set());for(const alias of group.aliases)sharedAliases.get(group.songId).add(alias);}for(const group of catalog.groups)group.aliases=[...sharedAliases.get(group.songId)];
  await writeFile(join(root,'catalog.json'),JSON.stringify(catalog,null,2));
  await mkdir('data/catalog',{recursive:true});
  await writeFile('data/catalog/songs.json',JSON.stringify([...new Map(catalog.groups.map(g=>[g.songId,{songId:g.songId,providerId:g.providerId,title:g.title,composer:g.composer,illustrator:g.illustrator,sourceTitles:catalog.groups.filter(other=>other.songId===g.songId).map(other=>other.sourceTitle)}])).values()],null,2));
  const upstream=JSON.parse((await readFile(join(root,'upstream-commit.json'),'utf8')).replace(/^\uFEFF/,''));
  const provenance={repository:'https://github.com/Catrong/phi-plugin',commit:upstream.sha,retrievedAt:new Date().toISOString(),license:'GPL-3.0; see LICENSE',files:{}};
  for(const name of ['info.csv','nicklist.yaml','LICENSE'])provenance.files[name]={sha256:digest(await readFile(join('data/providers/phi-plugin',name)))};
  await writeFile('data/providers/phi-plugin/provenance.json',JSON.stringify(provenance,null,2));
  console.log(JSON.stringify({files:inventory.length,copied,groups:groups.size,songs:new Set([...groups.values()].map(g=>g.songId)).size,aliases:[...groups.values()].reduce((n,g)=>n+g.aliases.length,0),originals:raw.size,bytes:inventory.reduce((n,f)=>n+f.bytes,0)},null,2));
}
