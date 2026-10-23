import {parentPort} from 'node:worker_threads';
import {readFile,stat} from 'node:fs/promises';
import sharp from 'sharp';
import {generateAbstractions,recipe} from './engine.mjs';
sharp.concurrency(1);
parentPort.on('message',async job=>{
 try{
  if(job.version!==recipe.version)throw new Error('Unsupported artwork generator version');
  if((await stat(job.path)).size>20*1024*1024)throw new Error('EZ source exceeds image budget');
  const result=await generateAbstractions(await readFile(job.path),job.seed,job.difficulty);
  parentPort.postMessage({id:job.id,images:Object.fromEntries(Object.entries(result.variants).map(([level,image])=>[level,image.svg]))});
 }catch(error){parentPort.postMessage({id:job.id,error:error instanceof Error?error.message:'Artwork generation failed'});}
});
