import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {AppModule,configureApp} from '../apps/server/src/app';
import {Db} from '../apps/server/src/db';
import {AuthService} from '../apps/server/src/auth';
import {GamesService} from '../apps/server/src/games';
import {migrate} from '../tools/migrate';

test('result rows, statistics and protected artwork use actual played rounds',{timeout:30000},async()=>{
 const admin=new Db(),baseUrl=process.env.DATABASE_URL!,schema=`results_${randomUUID().replaceAll('-','')}`;
 await admin.query(`CREATE SCHEMA "${schema}"`);const isolated=new URL(baseUrl);isolated.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=isolated.toString();
 const db=new Db();let app:INestApplication|undefined;
 try{
  await migrate(db);const module=await Test.createTestingModule({imports:[AppModule]}).compile();app=module.createNestApplication({logger:false,bodyParser:false});configureApp(app);await app.listen(0,'127.0.0.1');
  const auth=app.get(AuthService),games=app.get(GamesService),base=await app.getUrl();const alice=await auth.createGuest('Result A'),bob=await auth.createGuest('Result B'),outsider=await auth.createGuest('Outside');
  const id=randomUUID();await db.query("INSERT INTO matches(id,mode,difficulty,status,rules_version,health_enabled,health_capacity,round_count,round_seconds) VALUES($1,'room','hd','finished','v2-timed',true,20,5,30)",[id]);
  for(const p of [alice,bob])await db.query('INSERT INTO match_players(match_id,user_id,score,correct,health) VALUES($1,$2,$3,$4,12)',[id,p.user.id,p===alice?1234:0,p===alice?1:0]);
  const directory=process.env.ASSET_DIR!;await mkdir(directory,{recursive:true});
  for(let round=0;round<3;round++){
   const song=randomUUID(),art=randomUUID(),original=`${randomUUID()}.webp`,abstract=`${randomUUID()}.svg`;
   await db.query('INSERT INTO songs(id,title) VALUES($1,$2)',[song,`Secret ${round}`]);
   await db.query("INSERT INTO artworks(id,song_id,version,difficulty,storage_key,mime,bytes,original_preview_key) VALUES($1,$2,'results','hd',$3,'image/svg+xml',100,$4)",[art,song,abstract,original]);
   await writeFile(resolve(directory,abstract),'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="M0 0H10V10H0Z" fill="red"/></svg>');
   await sharp({create:{width:10,height:10,channels:3,background:'#123456'}}).webp().toFile(resolve(directory,original));
   await db.query('INSERT INTO match_rounds(match_id,round,artwork_id,starts_at,deadline) VALUES($1,$2,$3,now(),now()+interval \'30 seconds\')',[id,round,art]);
   if(round<2)for(let attempt=0;attempt<(round===0?3:1);attempt++)await db.query('INSERT INTO guesses(match_id,round,user_id,request_id,song_id,answer_text,correct,score,elapsed_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,round,alice.user.id,randomUUID(),attempt===2?song:null,attempt===2?'correct':'wrong',attempt===2,attempt===2?1234:0,attempt===2?5000:1000]);
  }
  for(const index of [0,1])await db.query('INSERT INTO revealed_hints(match_id,round,user_id,hint_index,content) VALUES($1,0,$2,$3,$4)',[id,alice.user.id,index,'hint']);
  await db.query('INSERT INTO noise_hits(match_id,round,user_id,request_id,health_after) VALUES($1,0,$2,$3,12)',[id,alice.user.id,randomUUID()]);
  const result=await games.result(id,alice.user.id);assert.equal(result.rounds.length,3);assert.equal(result.endless,false);
  assert.deepEqual(result.rounds.map(r=>[r.title,r.score,r.correct,r.attempts,r.wrongAttempts,r.hintsUsed,r.noiseHits,r.elapsedMs]),[['Secret 0',1234,true,3,2,2,1,5000],[null,0,false,1,1,0,0,30000],[null,0,false,0,0,0,0,30000]]);
  const other=await games.result(id,bob.user.id);assert(other.rounds.every(r=>r.title===null&&r.hintsUsed===0&&r.noiseHits===0));
  const fetchImage=(round:number,token=alice.token)=>fetch(`${base}/api/matches/${id}/rounds/${round}/result-image`,{headers:{Authorization:`Bearer ${token}`}});
  assert.equal((await fetchImage(0)).headers.get('content-type'),'image/webp');assert.equal((await fetchImage(1)).headers.get('content-type'),'image/svg+xml');assert.equal((await fetchImage(0,bob.token)).headers.get('content-type'),'image/svg+xml');
  assert.equal((await fetchImage(3)).status,404);assert.equal((await fetchImage(0,outsider.token)).status,404);await assert.rejects(games.result(id,outsider.user.id));
  const revealUrl=`${base}/api/matches/${id}/rounds/1/result-reveal`;
  const revealed=await fetch(revealUrl,{headers:{Authorization:`Bearer ${alice.token}`}});assert.equal(revealed.status,200);const revealedBody=await revealed.json() as {title:string;imageUrl:string};assert.equal(revealedBody.title,'Secret 1');
  const original=await fetch(`${base}${revealedBody.imageUrl}`,{headers:{Authorization:`Bearer ${alice.token}`}});assert.equal(original.status,200);assert.equal(original.headers.get('content-type'),'image/webp');
  assert.equal((await fetch(revealUrl,{headers:{Authorization:`Bearer ${outsider.token}`}})).status,404);assert.equal((await fetch(revealUrl)).status,401);
  const afterReveal=await games.result(id,alice.user.id);assert.equal(afterReveal.rounds[1]!.title,null);assert.equal(afterReveal.rounds[1]!.correct,false);assert.equal(afterReveal.rounds[1]!.score,0);assert.deepEqual(afterReveal.players,result.players);assert.equal(afterReveal.published,false);
  await assert.rejects(games.originalImage(id,1,alice.user.id));assert.equal((await fetchImage(1)).headers.get('content-type'),'image/svg+xml');
  await db.query("UPDATE matches SET status='active' WHERE id=$1",[id]);assert.equal((await fetchImage(0)).status,404);assert((await games.result(id,alice.user.id)).rounds.every(r=>r.imageUrl===null));
  assert.equal((await fetch(revealUrl,{headers:{Authorization:`Bearer ${alice.token}`}})).status,404);assert.equal((await fetch(`${base}${revealedBody.imageUrl}`,{headers:{Authorization:`Bearer ${alice.token}`}})).status,404);
  await db.query("UPDATE matches SET status='interrupted',round_count=0,finished_at=(SELECT starts_at FROM match_rounds WHERE match_id=$1 AND round=1)+interval '12 seconds' WHERE id=$1",[id]);const interrupted=await games.result(id,alice.user.id);assert.equal(interrupted.endless,true);assert.equal(interrupted.rounds[1]!.elapsedMs,12000);assert.equal((await fetchImage(0)).status,200);
 }finally{if(app)await app.close();await db.close();process.env.DATABASE_URL=baseUrl;await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.close();}
});
