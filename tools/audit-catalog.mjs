import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
process.loadEnvFile('storage/preview/runtime.env');
const require=createRequire(import.meta.url),{Db}=require('../dist/apps/server/src/db.js'),{validateSvg}=require('../dist/tools/svg.js'),{configuration}=require('../dist/apps/server/src/config.js');
const db=new Db();
try {
 const inventory=JSON.parse(await readFile('storage/corpus/inventory.json','utf8'));
 for(const item of inventory.files){const content=await readFile(resolve('storage/corpus/source',item.path));if(createHash('sha256').update(content).digest('hex')!==item.sha256)throw new Error(`Source copy mismatch: ${item.path}`);}
 const artifacts=(await db.query('SELECT * FROM artworks WHERE active')).rows;
 let svgCount=0,bytes=0;const originals=new Set();
 for(const art of artifacts){const data=await readFile(resolve(configuration().ASSET_DIR,art.storage_key));if(data.length!==art.bytes)throw new Error('Asset size mismatch');if(art.difficulty!=='ez'){validateSvg(data);svgCount++;}if(art.original_key){await readFile(resolve(configuration().ASSET_DIR,art.original_key));originals.add(art.original_key);}bytes+=data.length;}
 const songs=(await db.query('SELECT id,title,aliases FROM songs WHERE enabled ORDER BY title')).rows;
 const checks=[['Glaciaxion','冰封世界'],["Rrhar'il",'猫娘'],['Igallta','姐姐']].map(([title,alias])=>({title,alias,accepted:songs.find(s=>s.title===title)?.aliases.includes(alias)===true}));
 if(checks.some(c=>!c.accepted))throw new Error('Known alias mapping failed');
 const report={at:new Date().toISOString(),copiedOriginalFiles:inventory.files.length,sourceHashesVerified:true,songs:songs.length,activeAssets:artifacts.length,svgCount,storedOriginals:originals.size,playableBytes:bytes,aliases:songs.reduce((n,s)=>n+s.aliases.length,0),knownAliasChecks:checks};
 await writeFile('storage/corpus/verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await db.close();}
