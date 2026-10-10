import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {AppModule,configureApp} from '../apps/server/src/app';
import {Db} from '../apps/server/src/db';
import {AuthService} from '../apps/server/src/auth';
import {GamesService} from '../apps/server/src/games';
import {migrate} from '../tools/migrate';
import {GameOptions,resolveHealthCapacity,type MatchView} from '../packages/contracts/src';

test('health rules with PostgreSQL persistence and HTTP validation',{timeout:60000},async t=>{
 const admin=new Db(),databaseUrl=process.env.DATABASE_URL!,schema=`health_${randomUUID().replaceAll('-','')}`;
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const isolated=new URL(databaseUrl);isolated.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=isolated.toString();
 const db=new Db();let app:INestApplication|undefined;const realNow=Date.now;let clock=realNow();Date.now=()=>clock;
 try{
  await migrate(db);
  for(let i=0;i<5;i++){
   const song=randomUUID();await db.query('INSERT INTO songs(id,title,chapter,chapter_name,composer) VALUES($1,$2,1,$3,$4)',[song,`Health fixture ${i}`,'Fixture','Test composer']);
   for(const difficulty of ['ez','hd','in','at']){const artwork=randomUUID();await db.query('INSERT INTO artworks(id,song_id,version,difficulty,storage_key,mime,bytes) VALUES($1,$2,$3,$4,$5,$6,1)',[artwork,song,'health-fixture',difficulty,`${artwork}.svg`,'image/svg+xml']);}
  }
  const module=await Test.createTestingModule({imports:[AppModule]}).compile();app=module.createNestApplication({logger:false,bodyParser:false});configureApp(app);await app.listen(0,'127.0.0.1');
  const games=app.get(GamesService),auth=app.get(AuthService),base=await app.getUrl();
  const hp=(m:MatchView)=>m.players[0]!.health;
  async function begin(capacity:0|20|50=20,rounds=1,difficulty:'ez'|'hd'|'in'|'at'='hd'){
   const session=await auth.createGuest('HP fixture');const m=await games.createSolo(session.user,{difficulty,rounds,roundSeconds:30,healthCapacity:capacity});clock=m.startsAt+1;return {session,m};
  }
  const wrong=(id:string,user:string,round=0,requestId=randomUUID())=>games.guess(id,user,{round,requestId,answer:'definitely wrong'});
  async function correct(id:string,user:string,round=0){const song=(await db.query('SELECT a.song_id FROM match_rounds r JOIN artworks a ON a.id=r.artwork_id WHERE r.match_id=$1 AND r.round=$2',[id,round])).rows[0]!.song_id;return games.guess(id,user,{round,requestId:randomUUID(),songId:song});}
  await t.test('three options, legacy preferences, and difficulty restrictions',async()=>{
   assert(!GameOptions.safeParse({healthCapacity:10}).success);assert.equal(resolveHealthCapacity('hd',undefined,false),0);assert.equal(resolveHealthCapacity('at',0),20);assert.equal(resolveHealthCapacity('ez',50),0);
   for(const [difficulty,requested,expected]of [['ez',50,0],['at',0,20],['hd',0,0],['in',50,50]]as const){const {m}=await begin(requested,1,difficulty);assert.equal(m.healthCapacity,expected);assert.equal(hp(m),expected);}
  });
  await t.test('every wrong answer costs one; timeout floors at three and settles once',async()=>{
   for(const count of [0,1,2,4]){
    const {session,m}=await begin();for(let i=0;i<count;i++)await wrong(m.id,session.user.id);
    assert.equal(hp(await games.snapshot(m.id,session.user.id)),20-count);
    clock=m.deadline+1;const timed=await games.snapshot(m.id,session.user.id);assert.equal(hp(timed),20-count-Math.max(3,5-count));assert.equal(timed.status,'reveal');
    assert.equal(hp(await games.snapshot(m.id,session.user.id)),hp(timed));clock=timed.nextAt+1;await games.tick();
    (games as any).matches.delete(m.id);const restored=await games.snapshot(m.id,session.user.id);assert.equal(restored.status,'finished');assert.equal(hp(restored),hp(timed));
   }
  });
  await t.test('skip uses timeout costs once, persists early deadline, and rejects stale rounds',async()=>{
   for(const count of [0,1,2,4]){
    const {session,m}=await begin(20,2);for(let i=0;i<count;i++)await wrong(m.id,session.user.id);
    clock=m.startsAt+3000;const [state,retry]=await Promise.all([games.skipRound(m.id,session.user.id,0),games.skipRound(m.id,session.user.id,0)]);
    assert.equal(state.status,'reveal');assert.equal(state.deadline,clock);assert.equal(hp(state),20-count-Math.max(3,5-count));assert.equal(hp(retry),hp(state));
    const saved=(await db.query('SELECT deadline FROM match_rounds WHERE match_id=$1 AND round=0',[m.id])).rows[0];assert.equal(new Date(saved!.deadline).getTime(),clock);
    clock=state.nextAt+1;const next=await games.snapshot(m.id,session.user.id);await assert.rejects(games.skipRound(m.id,session.user.id,0));assert.equal(hp(await games.snapshot(m.id,session.user.id)),hp(next));
   }
   const off=await begin(0);assert.equal((await games.skipRound(off.m.id,off.session.user.id,0)).status,'reveal');
   const depleted=await begin();for(let i=0;i<17;i++)await wrong(depleted.m.id,depleted.session.user.id);const end=await games.skipRound(depleted.m.id,depleted.session.user.id,0);assert.equal(end.status,'finished');assert.equal(hp(end),0);
   const timed=await begin();clock=timed.m.deadline+1;assert.equal(hp(await games.skipRound(timed.m.id,timed.session.user.id,0)),15);
   const early=await begin();clock=early.m.startsAt-1;await assert.rejects(games.skipRound(early.m.id,early.session.user.id,0));
   clock=early.m.startsAt+1;const headers={Authorization:`Bearer ${early.session.token}`,'Content-Type':'application/json'},url=`${base}/api/matches/${early.m.id}/skip`;
   assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({round:-1})})).status,400);
   assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({round:0})})).status,201);
   assert.equal(hp(await games.snapshot(early.m.id,early.session.user.id)),15);
  });
  await t.test('correct answer persists new time and wrong deductions',async()=>{
   const {session,m}=await begin();await wrong(m.id,session.user.id);await wrong(m.id,session.user.id);
   clock=m.startsAt+17500;const outcome=await correct(m.id,session.user.id);assert.equal(outcome.score,550);
   assert.equal((await games.snapshot(m.id,session.user.id)).players[0]!.score,550);
   const saved=(await db.query('SELECT score FROM guesses WHERE match_id=$1 AND correct',[m.id])).rows[0]!;assert.equal(saved.score,550);
  });
  await t.test('return ends non-AT without extra damage; AT forms a domain instead',async()=>{
   const normal=await begin(20,5);await wrong(normal.m.id,normal.session.user.id);clock=normal.m.startsAt+4000;
   const end=await games.returnFromChallenge(normal.m.id,normal.session.user.id);assert.equal(end.status,'finished');assert.equal(hp(end),19);
   assert.equal(((await games.result(normal.m.id,normal.session.user.id)) as Record<string,unknown>).status,'interrupted');assert.equal((await games.returnFromChallenge(normal.m.id,normal.session.user.id)).status,'finished');await assert.rejects(wrong(normal.m.id,normal.session.user.id));
   (games as any).matches.delete(normal.m.id);assert.equal((await games.returnFromChallenge(normal.m.id,normal.session.user.id)).status,'finished');
   const at=await begin(20,5,'at');const blocked=await games.returnFromChallenge(at.m.id,at.session.user.id);assert.equal(blocked.status,'playing');assert.equal(blocked.returnBlocked,true);assert.equal(hp(blocked),20);
   await assert.rejects(games.noiseHit(at.m.id,at.session.user.id,{round:0,requestId:randomUUID()}));clock+=800;
   const hit=await games.noiseHit(at.m.id,at.session.user.id,{round:0,requestId:randomUUID()});assert.equal(hp(hit),19);
   assert.equal((await games.snapshot(at.m.id,at.session.user.id)).returnBlocked,true);
   const options=GameOptions.parse({difficulty:'in',rounds:0,healthCapacity:0});assert.equal(options.healthCapacity,20);assert.equal(options.healthEnabled,true);
  });
  await t.test('wrong retries are idempotent; correct answers heal by distinct hints',async()=>{
   for(const count of [0,1,2,3]){
    const {session,m}=await begin();const requestId=randomUUID();await Promise.all([wrong(m.id,session.user.id,0,requestId),wrong(m.id,session.user.id,0,requestId)]);
    assert.equal(hp(await games.snapshot(m.id,session.user.id)),19);
    for(let i=1;i<7;i++)await wrong(m.id,session.user.id);
    for(let i=0;i<count;i++)await games.hints(m.id,session.user.id,0,i);if(count)await games.hints(m.id,session.user.id,0,0);
    await correct(m.id,session.user.id);assert.equal(hp(await games.snapshot(m.id,session.user.id)),13+[5,3,2,1][count]!);
   }
   const {session,m}=await begin(50);assert.equal(hp(m),50);await wrong(m.id,session.user.id);await correct(m.id,session.user.id);assert.equal(hp(await games.snapshot(m.id,session.user.id)),50);
  });
  await t.test('formed noise costs one, rejects premature hits, and does not reduce timeout penalty',async()=>{
   const {session,m}=await begin();const hit={round:0,requestId:randomUUID()};await assert.rejects(games.noiseHit(m.id,session.user.id,hit));
   clock=m.startsAt+11251;await Promise.all([games.noiseHit(m.id,session.user.id,hit),games.noiseHit(m.id,session.user.id,hit)]);assert.equal(hp(await games.snapshot(m.id,session.user.id)),19);
   await assert.rejects(games.noiseHit(m.id,session.user.id,{...hit,round:1}));
   clock=m.deadline+1;assert.equal(hp(await games.snapshot(m.id,session.user.id)),14);
  });
  await t.test('past missed domains remain damaging and wrong count resets each round',async()=>{
   const {session,m}=await begin(20,2);await wrong(m.id,session.user.id);clock=m.deadline+1;let state=await games.snapshot(m.id,session.user.id);assert.equal(hp(state),15);
   clock=state.nextAt+1;state=await games.snapshot(m.id,session.user.id);assert.equal(state.round,1);
   await games.noiseHit(m.id,session.user.id,{round:1,requestId:randomUUID()});assert.equal(hp(await games.snapshot(m.id,session.user.id)),14);
   clock=state.deadline+1;assert.equal(hp(await games.snapshot(m.id,session.user.id)),9);
  });
  await t.test('zero ends the match, cannot heal or keep guessing, and survives eviction',async()=>{
   const {session,m}=await begin(20,5);for(let i=0;i<20;i++)await wrong(m.id,session.user.id);
   let state=await games.snapshot(m.id,session.user.id);assert.equal(hp(state),0);assert.equal(state.status,'finished');await assert.rejects(wrong(m.id,session.user.id));await assert.rejects(games.hints(m.id,session.user.id,0,0));
   (games as any).matches.delete(m.id);state=await games.snapshot(m.id,session.user.id);assert.equal(hp(state),0);assert.equal(state.totalRounds,5);assert.equal(state.round,0);
   const result=await games.result(m.id,session.user.id);assert.equal((result as Record<string,unknown>).health_capacity,20);assert.equal(result.players[0]!.health,0);
   assert(!(await games.leaderboard({difficulty:'in',healthCapacity:20,roundSeconds:30})).some(p=>p.id===session.user.id));
  });
  await t.test('timeout and noise can exhaust health; off mode does not eliminate',async()=>{
   const timeout=await begin(20,5);let state=timeout.m;
   for(let round=0;round<4;round++){clock=state.deadline+1;state=await games.snapshot(state.id,timeout.session.user.id);if(round<3){clock=state.nextAt+1;state=await games.snapshot(state.id,timeout.session.user.id);}}
   assert.equal(state.status,'finished');assert.equal(hp(state),0);assert.equal(state.round,3);
   const noise=await begin();for(let i=0;i<19;i++)await wrong(noise.m.id,noise.session.user.id);clock=noise.m.startsAt+11251;const hit=await games.noiseHit(noise.m.id,noise.session.user.id,{round:0,requestId:randomUUID()});assert.equal(hit.status,'finished');assert.equal(hp(hit),0);
   const off=await begin(0);for(let i=0;i<21;i++)await wrong(off.m.id,off.session.user.id);assert.equal((await games.snapshot(off.m.id,off.session.user.id)).status,'playing');
  });
  await t.test('HTTP accepts 50 HP and validates noise mutations',async()=>{
   const session=await auth.createGuest('HTTP HP');const headers={Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'};
   const created=await fetch(`${base}/api/matches/practice`,{method:'POST',headers,body:JSON.stringify({difficulty:'hd',rounds:1,roundSeconds:30,healthCapacity:50})});assert.equal(created.status,201);const m=await created.json() as MatchView;assert.equal(hp(m),50);
   const endpoint=`${base}/api/matches/${m.id}/noise-hits`,body=JSON.stringify({requestId:randomUUID(),round:0});
   assert.equal((await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body})).status,401);
   assert.equal((await fetch(endpoint,{method:'POST',headers,body})).status,409);clock=m.startsAt+11251;
   const result=await fetch(endpoint,{method:'POST',headers,body});assert.equal(result.status,201);assert.equal(hp(await result.json() as MatchView),49);
  });
 }finally{Date.now=realNow;if(app)await app.close();await db.close();process.env.DATABASE_URL=databaseUrl;await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.close();}
});
