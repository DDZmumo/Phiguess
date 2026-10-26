import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import sharp from 'sharp';
import { AppModule, configureApp } from '../apps/server/src/app';
import { Db } from '../apps/server/src/db';
import { GamesService } from '../apps/server/src/games';
import { CatalogService } from '../apps/server/src/catalog';
import { migrate } from '../tools/migrate';
import {DOWNGRADE_HINT_LABEL,RULES_VERSION} from '../packages/contracts/src';
import {scoreAnswer,performanceBadge} from '../packages/game-core/src';
import { importAssets } from '../tools/import-assets';

function once(socket: Socket,event: string): Promise<any[]> {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.off(event,onEvent);reject(new Error(`Timed out waiting for ${event}`));},5000);
    function onEvent(...args:any[]) {clearTimeout(timer);resolve(args);}
    socket.once(event,onEvent);
  });
}

test('real PostgreSQL + HTTP + Socket.IO integration', {timeout:90000}, async t=>{
  const db=new Db(); let app:INestApplication|undefined; const sockets:Socket[]=[];
  const realNow=Date.now;let offset=0;Date.now=()=>realNow()+offset;
  let base='',games:GamesService;
  const songs:string[]=Array.from({length:5},()=>randomUUID());
  let alice:any,bob:any,outsider:any;
  async function boot() {
    const module=await Test.createTestingModule({imports:[AppModule]}).compile();
    app=module.createNestApplication({logger:false,bodyParser:false});configureApp(app);
    await app.listen(0,'127.0.0.1');base=await app.getUrl();games=app.get(GamesService);
  }
  async function request(path:string,method='GET',token?:string,body?:unknown) {
    const r=await fetch(`${base}/api/${path}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,body:r.headers.get('content-type')?.includes('json') ? await r.json() as any : await r.text(),headers:r.headers};
  }
  async function step(ms:number) {offset+=ms;await games.tick();}
  async function answerFor(id:string,round:number) {return (await db.query('SELECT a.song_id FROM match_rounds r JOIN artworks a ON a.id=r.artwork_id WHERE r.match_id=$1 AND r.round=$2',[id,round])).rows[0]!.song_id as string;}
  async function socket(token:string) {
    const s=io(base,{auth:{token},transports:['websocket'],reconnection:false,timeout:3000});sockets.push(s);
    await once(s,'connect');return s;
  }
  try {
    await t.test('migrations are repeatable; import four assets with immutable versions',async()=>{
      await migrate(db);await migrate(db);
      const fixtures=resolve(process.env.TEST_ROOT!,'fixtures');await mkdir(fixtures,{recursive:true});
      await sharp({create:{width:16,height:16,channels:3,background:'#ff5500'}}).png().toFile(resolve(fixtures,'ez.png'));
      await writeFile(resolve(fixtures,'trace.svg'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0H16V16H0Z" fill="#ff5500"/></svg>');
      for (let i=0;i<songs.length;i++) {
        const file=resolve(fixtures,`${i}.json`);
        await writeFile(file,JSON.stringify({songId:songs[i],title:`Synthetic fixture ${i}`,aliases:[`test${i}`],chapter:i+1,chapterName:`Fixture chapter ${i+1}`,composer:'Fixture Composer',illustrator:'Fixture Illustrator',original:'ez.png',hints:['第一条合成提示','第二条合成提示','第三条合成提示'],version:'test-v1',assets:{ez:'ez.png',hd:'trace.svg',in:'trace.svg',at:'trace.svg'}}));
        const result=await importAssets(db,file);assert.equal(result.assets.length,4);
        if (i===0) await assert.rejects(()=>importAssets(db,file),/already published/);
      }
      assert.equal((await db.query('SELECT count(*)::int AS n FROM artworks')).rows[0]!.n,20);
      await boot();
    });
    await t.test('health, input validation, bearer authentication and catalog search',async()=>{
      assert.equal((await request('health/ready')).status,200);
      assert.equal((await request('me')).status,401);
      assert.equal((await request('auth/guest','POST',undefined,{name:'',admin:true})).status,400);
      alice=(await request('auth/guest','POST',undefined,{name:'Alice'})).body;
      bob=(await request('auth/guest','POST',undefined,{name:'Bob'})).body;
      outsider=(await request('auth/guest','POST',undefined,{name:'Outsider'})).body;
      assert.equal((await request('me','GET',alice.token)).body.id,alice.user.id);
      assert.equal((await request('songs?q=test0')).body.length,1);
      assert.equal((await request('leaderboards?rounds=999')).status,400);
      assert.equal((await request('leaderboards/daily')).status,404);
      assert.equal((await request('matches/daily','POST',alice.token)).status,404);
    });
    await t.test('public backgrounds use original previews without exposing song names or arbitrary assets',async()=>{
      const showcase=await request('showcase');assert.equal(showcase.status,200);assert.equal(showcase.body.length,5);
      assert.deepEqual(Object.keys(showcase.body[0]).sort(),['id','url']);
      const image=await fetch(`${base}${showcase.body[0].url}`);assert.equal(image.status,200);assert.match(image.headers.get('content-type')!,/image\/webp/);
      const hd=(await db.query("SELECT id FROM artworks WHERE difficulty='hd' LIMIT 1")).rows[0]!.id;
      assert.equal((await request(`showcase/${hd}/image`)).status,404);
    });
    await t.test('avatars require authentication, reject SVG and persist replacements as normalized WebP',async()=>{
      const picture=await sharp({create:{width:480,height:320,channels:3,background:'#538bbb'}}).png().toBuffer();
      async function upload(bytes:Buffer,token?:string,type='image/png'){
        const form=new FormData();form.append('avatar',new Blob([new Uint8Array(bytes)],{type}),'avatar.png');
        return fetch(`${base}/api/me/avatar`,{method:'POST',headers:token?{Authorization:`Bearer ${token}`}:{},body:form});
      }
      assert.equal((await upload(picture)).status,401);
      assert.equal((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),alice.token,'image/svg+xml')).status,400);
      const first=await upload(picture,alice.token);assert.equal(first.status,201);const saved=await first.json() as {avatarUrl:string};
      const downloaded=await fetch(`${base}${saved.avatarUrl}`);assert.equal(downloaded.status,200);
      const meta=await sharp(Buffer.from(await downloaded.arrayBuffer())).metadata();assert.equal(meta.format,'webp');assert.equal(meta.width,256);assert.equal(meta.height,256);
      const replacement=await upload(picture,alice.token);assert.equal(replacement.status,201);const updated=await replacement.json() as {avatarUrl:string};assert.notEqual(updated.avatarUrl,saved.avatarUrl);
      assert.equal((await request('me','GET',alice.token)).body.avatarUrl,updated.avatarUrl);
      assert.equal((await upload(Buffer.alloc(3*1024*1024+1),alice.token)).status,413);
    });
    await t.test('art variants retain separate originals but are sampled only once per song',async()=>{
      const folder=resolve(process.env.TEST_ROOT!,'fixtures'),manifest=JSON.parse(await readFile(resolve(folder,'0.json'),'utf8'));
      const path=resolve(folder,'variant.json');await writeFile(path,JSON.stringify({...manifest,variant:'alternate',original:'ez.png'}));
      await importAssets(db,path);
      const variants=(await db.query('SELECT variant,original_key FROM artworks WHERE song_id=$1 AND active',[songs[0]])).rows;
      assert.equal(variants.length,8);assert.ok(variants.filter(a=>a.variant==='alternate').every(a=>a.original_key));
      const selected=await new CatalogService(db).choose('hd',5);assert.equal(new Set(selected.map(a=>a.song_id)).size,5);
    });
    await t.test('practice protects current images, judges once and stores completed results',async()=>{
      const created=await request('matches/practice','POST',alice.token,{difficulty:'hd',rounds:1,roundSeconds:15});assert.equal(created.status,201);
      const m=created.body;assert.equal(m.answer,null);assert.ok(!JSON.stringify(m).includes('storage_key'));
      assert.equal((await request(`matches/${m.id}`,'GET',outsider.token)).status,403);
      const image=`matches/${m.id}/rounds/0/image`;
      assert.equal((await request(image,'GET',alice.token)).status,403);
      await step(3100);
      assert.equal((await request(`matches/${m.id}/rounds/1/image`,'GET',alice.token)).status,403);
      const art=await request(image,'GET',alice.token);assert.equal(art.status,200);assert.match(art.headers.get('content-type')!,/image\/svg/);assert.equal(art.headers.get('cache-control'),'private, no-store');
      assert.ok(!JSON.stringify(m).includes('合成提示'));
      assert.equal((await request(`matches/${m.id}/rounds/0/hints`,'GET',alice.token)).body.length,0);
      assert.equal((await request(`matches/${m.id}/rounds/0/hints/0`,'POST',outsider.token)).status,403);
      const hint=(await request(`matches/${m.id}/rounds/0/hints/0`,'POST',alice.token)).body;assert.equal(hint[0].kind,'range');assert.match(hint[0].content,/第 \d 章/);
      assert.equal((await request(`matches/${m.id}/rounds/0/hints/0`,'POST',alice.token)).body.length,1);
      const lower=(await request(`matches/${m.id}/rounds/0/hints/1`,'POST',alice.token)).body;assert.equal(lower.find((h:any)=>h.index===1).difficulty,'ez');
      assert.match((await request(image,'GET',alice.token)).headers.get('content-type')!,/image\/webp/);
      assert.equal((await request(`matches/${m.id}/rounds/0/hints/1`,'POST',alice.token)).body.length,2);
      const identity=(await request(`matches/${m.id}/rounds/0/hints/2`,'POST',alice.token)).body;assert.match(identity.find((h:any)=>h.index===2).content,/曲师：Fixture Composer/);
      const wrong={requestId:randomUUID(),round:0,answer:'not the song'};
      assert.equal((await request(`matches/${m.id}/guesses`,'POST',alice.token,wrong)).body.correct,false);
      assert.equal((await request(`matches/${m.id}`,'GET',alice.token)).body.players[0].answered,false);
      assert.equal((await request('me/active','GET',alice.token)).body.match.id,m.id);
      const guess={requestId:randomUUID(),round:0,songId:await answerFor(m.id,0)};
      const responses=await Promise.all([request(`matches/${m.id}/guesses`,'POST',alice.token,guess),request(`matches/${m.id}/guesses`,'POST',alice.token,guess)]);
      assert.equal(responses[0]!.status,201);assert.deepEqual(responses[0]!.body,responses[1]!.body);assert.equal(responses[0]!.body.correct,true);
      assert.equal((await request(`matches/${m.id}/guesses`,'POST',alice.token,{...guess,requestId:randomUUID()})).status,409);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM guesses WHERE match_id=$1',[m.id])).rows[0]!.n,2);
      assert.equal((await request(`matches/${m.id}/progress`,'GET',alice.token)).body[0].correct,true);
      const original=(await db.query('SELECT a.original_key,a.original_preview_key FROM match_rounds r JOIN artworks a ON a.id=r.artwork_id WHERE r.match_id=$1 AND r.round=0',[m.id])).rows[0]!;
      assert.notEqual(original.original_key,original.original_preview_key);
      assert.equal(await games.originalImage(m.id,0,alice.user.id),original.original_preview_key);
      await step(5100);
      const result=(await request(`matches/${m.id}/result`,'GET',alice.token)).body;assert.equal(result.status,'finished');assert.equal(result.players[0].correct,1);
      assert.deepEqual(await games.resultImage(m.id,0,alice.user.id),{key:original.original_preview_key,mime:'image/webp'});
      assert.equal((await games.revealResultArtwork(m.id,0,alice.user.id)).key,original.original_preview_key);
      assert.equal((await request('me/active','GET',alice.token)).body.match,null);
    });
    await t.test('third hint lowers earned-score ceiling but preserves original difficulty and settlement maximum',async()=>{
      for(const difficulty of ['hd','in','at'] as const){
        const user=(await request('auth/guest','POST',undefined,{name:`Downgrade-${difficulty}`})).body;
        const match=(await request('matches/practice','POST',user.token,{difficulty,rounds:2,roundSeconds:30,healthCapacity:0,healthEnabled:false})).body;
        await step(3100);
        assert.equal(match.difficulty,difficulty);assert.equal(match.rulesVersion,RULES_VERSION);
        for(const index of [0,2,1]){
          const hints=(await request(`matches/${match.id}/rounds/0/hints/${index}`,'POST',user.token)).body;
          if(index===1)assert.equal(hints.find((h:any)=>h.kind==='downgrade').content,DOWNGRADE_HINT_LABEL);
        }
        const guess={requestId:randomUUID(),round:0,songId:await answerFor(match.id,0)};
        const answer=(await request(`matches/${match.id}/guesses`,'POST',user.token,guess)).body;
        assert.equal(answer.correct,true);assert.equal(answer.score,scoreAnswer(difficulty,answer.elapsedMs,30000,0,true));
        assert.deepEqual((await request(`matches/${match.id}/guesses`,'POST',user.token,guess)).body,answer);
        const result=(await request(`matches/${match.id}/result`,'GET',user.token)).body;
        assert.equal(result.difficulty,difficulty);assert.equal(result.rounds[0].difficulty,difficulty);
        assert.equal(performanceBadge(result.rounds,difficulty).maximum,{hd:1000,in:2000,at:3000}[difficulty]);
        await step(2100);
        for(const index of [0,2])await request(`matches/${match.id}/rounds/1/hints/${index}`,'POST',user.token);
        const withoutDowngrade=(await request(`matches/${match.id}/guesses`,'POST',user.token,{requestId:randomUUID(),round:1,songId:await answerFor(match.id,1)})).body;
        assert.equal(withoutDowngrade.correct,true);assert.equal(withoutDowngrade.score,scoreAnswer(difficulty,withoutDowngrade.elapsedMs,30000));
        const settled=(await request(`matches/${match.id}/result`,'GET',user.token)).body;
        assert.equal(performanceBadge(settled.rounds,difficulty).maximum,2*{hd:1000,in:2000,at:3000}[difficulty]);
      }
    });
    await t.test('free text accepts normalized aliases, preserves idempotency and hides missed titles',async()=>{
      const match=(await request('matches/practice','POST',bob.token,{difficulty:'in',rounds:1,roundSeconds:15})).body;
      assert.equal((await request(`matches/${match.id}/progress`,'GET',bob.token)).body.length,0);
      await step(3100);const answerId=await answerFor(match.id,0),index=songs.indexOf(answerId);
      const guess={requestId:randomUUID(),round:0,answer:`  TEST${index}  `};
      const first=await request(`matches/${match.id}/guesses`,'POST',bob.token,guess);
      assert.equal(first.body.correct,true);
      assert.deepEqual((await request(`matches/${match.id}/guesses`,'POST',bob.token,guess)).body,first.body);
      const progress=(await request(`matches/${match.id}/progress`,'GET',bob.token)).body;
      assert.equal(progress[0].title,`Synthetic fixture ${index}`);
      await step(5100);
      const missed=(await request('matches/practice','POST',bob.token,{difficulty:'in',rounds:1,roundSeconds:15})).body;
      await step(3100);
      const wrong=await request(`matches/${missed.id}/guesses`,'POST',bob.token,{requestId:randomUUID(),round:0,answer:'this song does not exist'});
      assert.equal(wrong.body.correct,false);
      assert.equal((await request(`matches/${missed.id}/progress`,'GET',bob.token)).body[0].title,null);
      const retry=await request(`matches/${missed.id}/guesses`,'POST',bob.token,{requestId:randomUUID(),round:0,answer:'another wrong answer'});assert.equal(retry.status,201);assert.equal(retry.body.correct,false);
      await step(15100);
      await step(5100);
    });
    await t.test('fixed-count HD games do not enter Infinity leaderboards',async()=>{
      const options={difficulty:'hd',rounds:1,roundSeconds:30};
      const a=(await request('matches/practice','POST',alice.token,options)).body,b=(await request('matches/practice','POST',bob.token,options)).body;
       const route='leaderboards?difficulty=in&healthCapacity=20&roundSeconds=30';
       const realPlayers=async()=>((await request(route)).body as {isReference?:boolean}[]).filter(player=>!player.isReference);
       assert.equal((await realPlayers()).length,0);
      await step(3100);
      for(const [player,m] of [[alice,a],[bob,b]])assert.equal((await request(`matches/${m.id}/guesses`,'POST',player.token,{requestId:randomUUID(),round:0,songId:await answerFor(m.id,0)})).status,201);
       await step(5100);assert.equal((await realPlayers()).length,0);
      assert.equal((await request('leaderboards?difficulty=hd&rounds=1&roundSeconds=90&mode=practice')).status,400);
    });
    await t.test('EZ has two hints and cannot request a difficulty downgrade',async()=>{
      const m=(await request('matches/practice','POST',alice.token,{difficulty:'ez',rounds:1,roundSeconds:15})).body;
      await step(3100);
      assert.equal((await request(`matches/${m.id}/rounds/0/hints/1`,'POST',alice.token)).status,400);
      assert.equal((await request(`matches/${m.id}/rounds/0/hints/0`,'POST',alice.token)).status,201);
      const identity=await request(`matches/${m.id}/rounds/0/hints/2`,'POST',alice.token);assert.equal(identity.body.length,2);
      await request(`matches/${m.id}/guesses`,'POST',alice.token,{requestId:randomUUID(),round:0,songId:await answerFor(m.id,0)});await step(5100);
    });
    await t.test('next round skips another countdown and keeps the full answer duration',async()=>{
      const m=(await request('matches/practice','POST',alice.token,{difficulty:'hd',rounds:2,roundSeconds:15})).body;
      assert.ok(m.startsAt>m.serverNow);
      await step(3100);
      await request(`matches/${m.id}/guesses`,'POST',alice.token,{requestId:randomUUID(),round:0,songId:await answerFor(m.id,0)});
      const revealed=await games.snapshot(m.id,alice.user.id);
      assert.equal(revealed.status,'reveal');assert.ok(revealed.nextAt-revealed.serverNow<=2000);
      await step(2050);
      // Advancing the test clock does not accelerate the real CPU worker.
      let next=await games.snapshot(m.id,alice.user.id);
      for(let attempt=0;next.round===0&&attempt<100;attempt++){await new Promise(r=>setTimeout(r,10));await games.tick();next=await games.snapshot(m.id,alice.user.id);}
      assert.equal(next.round,1);assert.equal(next.status,'playing');assert.ok(next.startsAt<=next.serverNow);
      assert.equal(next.deadline-next.startsAt,15000);
      assert.equal((await request(`matches/${m.id}/rounds/1/image`,'GET',alice.token)).status,200);
      await step(15100);
      const timeout=await games.snapshot(m.id,alice.user.id);
      assert.equal(timeout.status,'reveal');assert.ok(timeout.nextAt-timeout.serverNow<=2000);
      await step(2050);assert.equal((await request(`matches/${m.id}/result`,'GET',alice.token)).body.status,'finished');
    });
    await t.test('two-player room broadcasts state, rejects spectators, reconnects and settles',async()=>{
      const r=(await request('rooms','POST',alice.token,{difficulty:'in',rounds:1,roundSeconds:15})).body;
      assert.equal((await request(`rooms/${r.code}/join`,'POST',bob.token)).status,201);
      const a=await socket(alice.token),b=await socket(bob.token),o=await socket(outsider.token);
      assert.equal((await a.timeout(3000).emitWithAck('room:subscribe',{code:r.code})).ok,true);
      assert.equal((await o.timeout(3000).emitWithAck('room:subscribe',{code:r.code})).ok,false);
      const updated=once(a,'room:state');
      await request(`rooms/${r.code}/ready`,'POST',alice.token,{ready:true});
      assert.equal((await updated)[0].players[0].ready,true);
      await request(`rooms/${r.code}/ready`,'POST',bob.token,{ready:true});
      assert.equal((await request(`rooms/${r.code}/start`,'POST',bob.token)).status,403);
      const m=(await request(`rooms/${r.code}/start`,'POST',alice.token)).body;
      assert.equal((await a.timeout(3000).emitWithAck('match:subscribe',{id:m.id})).ok,true);
      b.disconnect();const reconnected=await socket(bob.token);
      assert.equal((await reconnected.timeout(3000).emitWithAck('match:subscribe',{id:m.id})).data.id,m.id);
      await step(3100);
      const correct=await answerFor(m.id,0);
      await request(`matches/${m.id}/guesses`,'POST',alice.token,{requestId:randomUUID(),round:0,songId:correct});
      const wrong=songs.find(s=>s!==correct)!;
      const bad=await request(`matches/${m.id}/guesses`,'POST',bob.token,{requestId:randomUUID(),round:0,songId:wrong});assert.equal(bad.body.score,0);
      assert.equal((await request(`matches/${m.id}`,'GET',bob.token)).body.status,'playing');
      await request(`matches/${m.id}/guesses`,'POST',bob.token,{requestId:randomUUID(),round:0,songId:correct});
      await step(5100);
      assert.equal((await request(`matches/${m.id}/result`,'GET',alice.token)).body.status,'finished');
      await request(`rooms/${r.code}/leave`,'POST',alice.token);await request(`rooms/${r.code}/leave`,'POST',bob.token);
    });
    await t.test('deadline rejects late answers and restart interrupts unfinished matches',async()=>{
      const m=(await request('matches/practice','POST',outsider.token,{difficulty:'ez',rounds:2,roundSeconds:15})).body;
      await step(18100);
      assert.equal((await request(`matches/${m.id}/guesses`,'POST',outsider.token,{requestId:randomUUID(),round:0,songId:songs[0]})).status,409);
      sockets.forEach(s=>s.disconnect());await app!.close();app=undefined;await boot();
      assert.equal((await request(`matches/${m.id}/result`,'GET',outsider.token)).body.status,'interrupted');
      await request('auth/logout','POST',outsider.token);
      assert.equal((await request('me','GET',outsider.token)).status,401);
    });
  } finally {
    Date.now=realNow;sockets.forEach(s=>s.disconnect());if(app)await app.close();await db.close();
  }
});


