import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {AppModule,configureApp} from '../apps/server/src/app';
import {Db} from '../apps/server/src/db';
import {AuthService} from '../apps/server/src/auth';
import {GamesService} from '../apps/server/src/games';
import {migrate} from '../tools/migrate';
import {GameOptions} from '../packages/contracts/src';
import {ArtworkPreloader,decryptPreloadedArtwork} from '../apps/web/src/artwork-preload';

test('encrypted next artwork is reusable only after opening the round',{timeout:30000},async()=>{
  const admin=new Db(),url=process.env.DATABASE_URL!,assetDir=process.env.ASSET_DIR;
  const schema=`preload_${randomUUID().replaceAll('-','')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const isolated=new URL(url);isolated.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=isolated.toString();
  process.env.ASSET_DIR=resolve(process.env.TEST_ROOT!,'preload-assets');
  const db=new Db(),realNow=Date.now;let clock=realNow(),app:INestApplication|undefined;
  Date.now=()=>clock;
  try{
    await migrate(db);await mkdir(process.env.ASSET_DIR,{recursive:true});
    const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M0 0H20V20H0Z"/></svg>';
    for(let i=0;i<2;i++){
      const song=randomUUID(),art=randomUUID(),key=`${art}.svg`;
      await db.query('INSERT INTO songs(id,title) VALUES($1,$2)',[song,`Preload fixture ${i}`]);
      await db.query("INSERT INTO artworks(id,song_id,version,difficulty,storage_key,mime,bytes) VALUES($1,$2,'preload-test','hd',$3,'image/svg+xml',$4)",[art,song,key,Buffer.byteLength(svg)]);
      await writeFile(resolve(process.env.ASSET_DIR,key),svg);
    }
    const module=await Test.createTestingModule({imports:[AppModule]}).compile();
    app=module.createNestApplication({logger:false,bodyParser:false});configureApp(app);await app.listen(0,'127.0.0.1');
    const games=app.get(GamesService),auth=app.get(AuthService),base=await app.getUrl();
    const user=await auth.createGuest('Preload player'),outsider=await auth.createGuest('Preload outsider');
    const m=await games.createSolo(user.user,GameOptions.parse({difficulty:'hd',rounds:2,roundSeconds:30,healthCapacity:0}));
    const path=`/api/matches/${m.id}/rounds/1/preload`,headers={Authorization:`Bearer ${user.token}`};
    assert.equal((await fetch(base+path,{headers})).status,403);
    clock=m.startsAt+1;
    assert.equal((await fetch(base+path)).status,401);
    assert.equal((await fetch(base+path,{headers:{Authorization:`Bearer ${outsider.token}`}})).status,403);
    assert.equal((await fetch(base+path.replace('/1/','/2/'),{headers})).status,403);
    assert.equal((await fetch(base+path.replace('/preload','/image'),{headers})).status,403);
    const response=await fetch(base+path,{headers});assert.equal(response.status,200);
    assert.equal(response.headers.get('content-type'),'application/octet-stream');
    const bytes=new Uint8Array(await response.arrayBuffer());assert.equal(bytes.length,gzipSync(svg).length+28);
    assert(!Buffer.from(bytes).includes(Buffer.from('<svg')));
    assert.deepEqual(new Uint8Array(await(await fetch(base+path,{headers})).arrayBuffer()),bytes);
    assert.equal((await games.snapshot(m.id,user.user.id)).imageKey,undefined);
    await games.skipRound(m.id,user.user.id,0);clock+=3000;await games.tick();
    const next=await games.snapshot(m.id,user.user.id);assert.equal(next.round,1);assert(next.imageKey);
    assert.equal(await(await decryptPreloadedArtwork(bytes,next.imageKey,'image/svg+xml')).text(),svg);
    await assert.rejects(()=>decryptPreloadedArtwork(bytes,Buffer.alloc(32).toString('base64'),'image/svg+xml'));
    const tampered=bytes.slice();tampered[12]=tampered[12]!^1;
    await assert.rejects(()=>decryptPreloadedArtwork(tampered,next.imageKey!,'image/svg+xml'));
    assert.equal((await fetch(base+path,{headers})).status,403);

    let downloads=0,priority:string|undefined;
    const fetcher:typeof fetch=async(_input,init)=>{downloads++;priority=init?.priority;return new Response(bytes,{headers:{'X-Artwork-Mime':'image/svg+xml'}});};
    const loader=new ArtworkPreloader(fetcher);loader.preload(m.id,1,user.token);loader.preload(m.id,1,user.token);
    assert.equal(await loader.take(0,undefined,new AbortController().signal),undefined);
    const blob=await loader.take(1,next.imageKey,new AbortController().signal);assert.equal(await blob!.text(),svg);
    assert.equal(downloads,1);assert.equal(priority,'low');
    const originalFetch=globalThis.fetch;
    globalThis.fetch=function(this:unknown){assert.equal(this,globalThis,'Native fetch needs its browser receiver');return Promise.resolve(new Response(bytes,{headers:{'X-Artwork-Mime':'image/svg+xml'}}));};
    try{
      const nativeLoader=new ArtworkPreloader();nativeLoader.preload(m.id,1,user.token);
      const nativeBlob=await nativeLoader.take(1,next.imageKey,new AbortController().signal);
      assert.equal(await nativeBlob?.text(),svg);nativeLoader.cancel();
    }finally{globalThis.fetch=originalFetch;}
    const failed=new ArtworkPreloader(async()=>new Response('',{status:503}));failed.preload(m.id,1,user.token);
    assert.equal(await failed.take(1,next.imageKey,new AbortController().signal),undefined);
    loader.cancel();failed.cancel();
  }finally{
    Date.now=realNow;if(app)await app.close();await db.close();process.env.DATABASE_URL=url;
    if(assetDir===undefined)delete process.env.ASSET_DIR;else process.env.ASSET_DIR=assetDir;
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.close();
  }
});
