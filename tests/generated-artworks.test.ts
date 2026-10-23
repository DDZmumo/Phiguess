import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,readdir,unlink,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {AppModule,configureApp} from '../apps/server/src/app';
import {AuthService} from '../apps/server/src/auth';
import {GamesService} from '../apps/server/src/games';
import {Db} from '../apps/server/src/db';
import {migrate} from '../tools/migrate';
import {importAssets} from '../tools/import-assets';
import {decryptPreloadedArtwork} from '../apps/web/src/artwork-preload';
import {validateSvg} from '../tools/svg';
import {retireLegacyArtworks} from '../tools/migrate-dynamic-artworks';
import {CatalogService} from '../apps/server/src/catalog';
import {GeneratedArtworks} from '../apps/server/src/generated-artworks';

test('EZ-only catalog generates paired private images, encrypted preloads and reproducible saved results',{timeout:60000},async()=>{
 const admin=new Db(),previousUrl=process.env.DATABASE_URL!,schema=`generated_${randomUUID().replaceAll('-','')}`;
 await admin.query(`CREATE SCHEMA "${schema}"`);const url=new URL(previousUrl);url.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=url.toString();
 const oldAssetDirectory=process.env.ASSET_DIR,oldGeneratedDirectory=process.env.GENERATED_ASSET_DIR;
 process.env.ASSET_DIR=resolve(process.env.TEST_ROOT!,'dynamic-assets');process.env.GENERATED_ASSET_DIR=resolve(process.env.TEST_ROOT!,'dynamic-cache');
 const db=new Db(),fixtures=resolve(process.env.TEST_ROOT!,'generated-fixtures');let app:INestApplication|undefined;const realNow=Date.now;let clock=realNow();Date.now=()=>clock;
 const generatedDirectory=process.env.GENERATED_ASSET_DIR!,assetDirectory=process.env.ASSET_DIR!;let base='',games:GamesService;
 async function boot(){const module=await Test.createTestingModule({imports:[AppModule]}).compile();app=module.createNestApplication({logger:false,bodyParser:false});configureApp(app);await app.listen(0,'127.0.0.1');base=await app.getUrl();games=app.get(GamesService);}
 const request=(path:string,token?:string)=>fetch(base+'/api/'+path,{headers:token?{Authorization:`Bearer ${token}`}:{}});
 try{
  await migrate(db);await mkdir(fixtures,{recursive:true});
  const raw=Buffer.alloc(128*72*3);for(let y=0;y<72;y++)for(let x=0;x<128;x++){const p=(y*128+x)*3;raw[p]=(x*5+y*3)%256;raw[p+1]=(x+y*7)%256;raw[p+2]=(x*2+y*2)%256;}
  const source=await sharp(raw,{raw:{width:128,height:72,channels:3}}).webp({lossless:true}).toBuffer();await writeFile(join(fixtures,'ez.webp'),source);
  for(const title of ['Desultory Signals','Generated fixture two']){const manifest=join(fixtures,randomUUID()+'.json');await writeFile(manifest,JSON.stringify({songId:randomUUID(),title,aliases:[],version:'source-v1',chapter:9,chapterName:'Fixture',composer:'Fixture',illustrator:'Fixture',original:'ez.webp',assets:{ez:'ez.webp'}}));await importAssets(db,manifest);}
  const high=(await db.query("SELECT * FROM artworks WHERE difficulty<>'ez'")).rows;assert.equal(high.length,6);assert(high.every(a=>a.storage_key===null&&a.source_artwork_id&&a.bytes===0));
  const legacyKey=randomUUID()+'.svg',legacy=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');await writeFile(join(assetDirectory,legacyKey),legacy);await db.query('UPDATE artworks SET storage_key=$2,bytes=$3 WHERE id=$1',[high[0]!.id,legacyKey,legacy.length]);
  assert((await retireLegacyArtworks(db,false)).files>=1);assert.deepEqual(await readFile(join(assetDirectory,legacyKey)),legacy);
  await retireLegacyArtworks(db,true);await assert.rejects(readFile(join(assetDirectory,legacyKey)),{code:'ENOENT'});assert.deepEqual(await readFile(join(fixtures,'ez.webp')),source);
  await boot();const auth=app!.get(AuthService),alice=await auth.createGuest('Dynamic A'),bob=await auth.createGuest('Dynamic B'),outsider=await auth.createGuest('Dynamic C');
  const match=await games!.createRoom([alice.user,bob.user],{difficulty:'at',rounds:2,roundSeconds:15,healthCapacity:20});
  assert.equal((await db.query('SELECT id FROM match_artwork_recipes WHERE match_id=$1',[match.id])).rows.length,2);
  assert(match.startsAt>clock);const recipe=(await db.query('SELECT * FROM match_artwork_recipes WHERE match_id=$1 AND round=0',[match.id])).rows[0]!;
  assert.deepEqual(Object.keys(recipe.images).sort(),['at','in']);assert.equal(recipe.algorithm,'ez-regions-v1');assert(!('seed' in match));
  assert.equal((await request(`matches/${match.id}/rounds/0/image`,alice.token)).status,403);
  clock=match.startsAt+10;await games!.tick();
  const path=`matches/${match.id}/rounds/0/image`,at=Buffer.from(await(await request(path,alice.token)).arrayBuffer());validateSvg(at);
  assert.deepEqual(Buffer.from(await(await request(path,bob.token)).arrayBuffer()),at);
  assert.equal((await request(path,outsider.token)).status,403);
  await games!.hints(match.id,alice.user.id,0,1);
  const hinted=Buffer.from(await(await request(path,alice.token)).arrayBuffer());assert.deepEqual(hinted,await readFile(join(generatedDirectory,match.id,recipe.images.in)));assert(!hinted.equals(at));
  assert.deepEqual(Buffer.from(await(await request(path,bob.token)).arrayBuffer()),at);
  const preload=await games!.preloadImage(match.id,1,alice.user.id);assert.equal(preload.mime,'image/svg+xml');assert.equal((await request(`matches/${match.id}/rounds/1/image`,alice.token)).status,403);
  clock=match.deadline+10;await games!.tick();clock+=2050;await games!.tick();
  const next=await games!.snapshot(match.id,alice.user.id);assert.equal(next.round,1);assert.equal(next.deadline-next.startsAt,15000);assert(next.imageKey);
  const nextImage=Buffer.from(await(await request(`matches/${match.id}/rounds/1/image`,alice.token)).arrayBuffer());
  assert.deepEqual(Buffer.from(await(await decryptPreloadedArtwork(new Uint8Array(preload.body),next.imageKey!,'image/svg+xml')).arrayBuffer()),nextImage);
  await app!.close();app=undefined;await boot();
  const resultPath=`matches/${match.id}/rounds/0/result-image`;assert.deepEqual(Buffer.from(await(await request(resultPath,alice.token)).arrayBuffer()),at);
  assert.equal((await request(resultPath,outsider.token)).status,404);
  // Disk eviction and a restart must recreate exactly the same question and hint.
  for(const key of Object.values(recipe.images) as string[])await unlink(join(generatedDirectory,match.id,key));
  const regenerated=await Promise.all([alice,bob].map(async user=>Buffer.from(await(await request(resultPath,user.token)).arrayBuffer())));for(const image of regenerated)assert.deepEqual(image,at);
  const restored=(await db.query('SELECT seed,images FROM match_artwork_recipes WHERE id=$1',[recipe.id])).rows[0]!;assert.equal(restored.seed,recipe.seed);
  assert.deepEqual(await readFile(join(generatedDirectory,match.id,restored.images.in)),hinted);
  const fresh=await games!.createSolo(alice.user,{difficulty:'at',rounds:1,roundSeconds:15,healthCapacity:20});
  const freshRecipe=(await db.query('SELECT seed FROM match_artwork_recipes WHERE match_id=$1 AND round=0',[fresh.id])).rows[0]!;assert.notEqual(freshRecipe.seed,recipe.seed);
  const hd=await games!.createSolo(bob.user,{difficulty:'hd',rounds:1,roundSeconds:15,healthCapacity:20});clock=hd.startsAt+10;
  const hdRecipe=(await db.query('SELECT * FROM match_artwork_recipes WHERE match_id=$1 AND round=0',[hd.id])).rows[0]!;assert.deepEqual(Object.keys(hdRecipe.images),['hd']);
  await games!.hints(hd.id,bob.user.id,0,1);const ezKey=(await db.query('SELECT storage_key FROM artworks WHERE id=$1',[hdRecipe.source_artwork_id])).rows[0]!.storage_key;
  assert.deepEqual(Buffer.from(await(await request(`matches/${hd.id}/rounds/0/image`,bob.token)).arrayBuffer()),await readFile(join(assetDirectory,ezKey)));
  await games!.returnFromChallenge(hd.id,bob.user.id);
  const ez=await games!.createSolo(bob.user,{difficulty:'ez',rounds:1,roundSeconds:15,healthCapacity:20});clock=ez.startsAt+10;
  const ezResponse=await request(`matches/${ez.id}/rounds/0/image`,bob.token);assert.equal(ezResponse.headers.get('content-type'),'image/webp');assert.equal((await db.query('SELECT id FROM match_artwork_recipes WHERE match_id=$1',[ez.id])).rows.length,0);
  const before=(await db.query('SELECT count(*) AS n FROM matches')).rows[0]!.n;
  const tutorial=await request('tutorial-art/ds/hd');assert.equal(tutorial.status,200);validateSvg(Buffer.from(await tutorial.arrayBuffer()));assert.equal((await db.query('SELECT count(*) AS n FROM matches')).rows[0]!.n,before);
  assert.equal((await request('tutorial-art/unknown/hd')).status,400);
  // A slow first render must not hold the mutation queue or allow answers before preparation finishes.
  const generator=app!.get(GeneratedArtworks),prepare=generator.prepare.bind(generator);let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);
  generator.prepare=async(...args)=>{entered();await gate;return prepare(...args);};
  const starting=games!.createSolo(outsider.user,{difficulty:'hd',rounds:1,roundSeconds:15,healthCapacity:20});
  await started;const preparing=(await db.query("SELECT m.id FROM matches m JOIN match_players p ON p.match_id=m.id WHERE p.user_id=$1 AND m.status='active'",[outsider.user.id])).rows[0]!;
  clock+=6000;const snapshot=await games!.snapshot(preparing.id,outsider.user.id);assert.equal(snapshot.status,'playing');
  await assert.rejects(games!.guess(preparing.id,outsider.user.id,{round:0,requestId:randomUUID(),answer:'test'}),/not accepting/);
  generator.prepare=prepare;release();const ready=await starting;assert.equal(ready.startsAt,clock+3000);
  await games!.returnFromChallenge(ready.id,outsider.user.id);
  const catalog=app!.get(CatalogService),choose=catalog.choose.bind(catalog);
  const sourceArt=(await choose('hd',1))[0]!;
  const calls:number[]=[];let releaseReserve!:()=>void;
  const reserveGate=new Promise<void>(resolve=>releaseReserve=resolve);
  catalog.choose=async()=>Array.from({length:25},()=>sourceArt);
  generator.prepare=async(_id,round)=>{calls.push(round);if(round===10)await reserveGate;};
  try{
   const buffered=await games!.createSolo(outsider.user,{difficulty:'hd',rounds:25,roundSeconds:15,healthCapacity:0},true);
   assert.deepEqual(calls.slice(0,10),Array.from({length:10},(_,i)=>i));
   assert.equal(buffered.awaitingReady,true);
   clock+=60000;await games!.tick();assert.equal((await games!.snapshot(buffered.id,outsider.user.id)).round,0);
   await assert.rejects(games!.guess(buffered.id,outsider.user.id,{round:0,requestId:randomUUID(),answer:'test'}),/not accepting/);
   releaseReserve();for(let i=0;i<100&&calls.length<20;i++)await new Promise(r=>setTimeout(r,5));
   assert.deepEqual(calls,Array.from({length:20},(_,i)=>i));
   const opened=await games!.ready(buffered.id,outsider.user.id);assert.equal(opened.startsAt,clock+3000);
   clock=opened.startsAt+1;await games!.skipRound(buffered.id,outsider.user.id,0);clock+=2100;await games!.tick();
   for(let i=0;i<100&&calls.length<21;i++)await new Promise(r=>setTimeout(r,5));
   assert.equal(calls.length,21);assert.equal(calls.at(-1),20);
   await games!.tick();assert.equal(calls.length,21);
   for(let round=1;round<7;round++){
    await games!.skipRound(buffered.id,outsider.user.id,round);clock+=2100;await games!.tick();
    for(let i=0;i<100&&calls.length<Math.min(25,round+21);i++)await new Promise(r=>setTimeout(r,5));
    assert.equal(calls.length,Math.min(25,round+21));
   }
   assert.equal(calls.at(-1),24);
   await games!.returnFromChallenge(buffered.id,outsider.user.id);
  }finally{releaseReserve();catalog.choose=choose;generator.prepare=prepare;}
  const created=await fetch(base+'/api/matches/practice',{method:'POST',headers:{Authorization:`Bearer ${outsider.token}`,'Content-Type':'application/json','X-Artwork-Ready':'1'},body:JSON.stringify({difficulty:'hd',rounds:1,roundSeconds:15,healthCapacity:0})});
  assert.equal(created.status,201);const waiting=await created.json() as {id:string;awaitingReady:boolean};assert.equal(waiting.awaitingReady,true);
  const initial=await request(`matches/${waiting.id}/rounds/0/image`,outsider.token);assert.equal(initial.status,200);validateSvg(Buffer.from(await initial.arrayBuffer()));
  const confirmed=await fetch(base+`/api/matches/${waiting.id}/ready`,{method:'POST',headers:{Authorization:`Bearer ${outsider.token}`}});assert.equal(confirmed.status,201);assert.equal((await confirmed.json() as {awaitingReady:boolean}).awaitingReady,false);
 }finally{Date.now=realNow;if(app)await app.close();await db.close();process.env.DATABASE_URL=previousUrl;if(oldAssetDirectory===undefined)delete process.env.ASSET_DIR;else process.env.ASSET_DIR=oldAssetDirectory;if(oldGeneratedDirectory===undefined)delete process.env.GENERATED_ASSET_DIR;else process.env.GENERATED_ASSET_DIR=oldGeneratedDirectory;await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.close();}
});
