import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {io,type Socket} from 'socket.io-client';
import {AppModule,configureApp} from '../apps/server/src/app';
import {Db} from '../apps/server/src/db';
import {AuthService} from '../apps/server/src/auth';
import {GamesService} from '../apps/server/src/games';
import {RoomsService} from '../apps/server/src/rooms';
import {migrate} from '../tools/migrate';
import {RoomOptions,type MatchView} from '../packages/contracts/src';

test('multiplayer skipping, independent progress, timed survival and revival',{timeout:90000},async t=>{
 const admin=new Db(),databaseUrl=process.env.DATABASE_URL!,schema=`multiplayer_${randomUUID().replaceAll('-','')}`;
 await admin.query(`CREATE SCHEMA "${schema}"`);const isolated=new URL(databaseUrl);isolated.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=isolated.toString();
 const db=new Db(),realNow=Date.now,sockets:Socket[]=[];let app:INestApplication|undefined,clock=realNow();Date.now=()=>clock;
 try{
  await migrate(db);
  for(let index=0;index<5;index++){
   const song=randomUUID();await db.query('INSERT INTO songs(id,title,chapter,chapter_name,composer) VALUES($1,$2,1,$3,$4)',[song,`Room fixture ${index}`,'Fixture','Composer']);
   for(const difficulty of ['ez','hd','in','at']){const artwork=randomUUID();await db.query('INSERT INTO artworks(id,song_id,version,difficulty,storage_key,mime,bytes,illustrator) VALUES($1,$2,$3,$4,$5,$6,1,$7)',[artwork,song,'room-fixture',difficulty,artwork+'.svg','image/svg+xml','Illustrator']);}
  }
  const module=await Test.createTestingModule({imports:[AppModule]}).compile();app=module.createNestApplication({logger:false,bodyParser:false});configureApp(app);await app.listen(0,'127.0.0.1');
  const games=app.get(GamesService),rooms=app.get(RoomsService),auth=app.get(AuthService),base=await app.getUrl();
  async function begin(rounds=2,capacity:0|20|50=20,matchSeconds=120){
   const a=await auth.createGuest('Room A'),b=await auth.createGuest('Room B');
   const room=await rooms.create(a.user,RoomOptions.parse({difficulty:rounds===0?'in':'hd',rounds,roundSeconds:30,healthCapacity:capacity,maxPlayers:2,...(rounds===0?{matchSeconds}:{})}));
   await rooms.join(room.code,b.user);await rooms.ready(room.code,a.user.id,true);await rooms.ready(room.code,b.user.id,true);
   const match=await rooms.start(room.code,a.user.id);clock=match.startsAt+1;return {a,b,match,code:room.code};
  }
  const self=(view:MatchView,id:string)=>view.players.find(player=>player.id===id)!;
  const wrong=(id:string,user:string,round:number)=>games.guess(id,user,{round,requestId:randomUUID(),answer:'wrong fixture answer'});
  async function correct(id:string,user:string,round:number){const row=(await db.query('SELECT a.song_id FROM match_rounds r JOIN artworks a ON a.id=r.artwork_id WHERE r.match_id=$1 AND r.round=$2',[id,round])).rows[0]!;return games.guess(id,user,{round,requestId:randomUUID(),songId:row.song_id});}
  async function next(id:string,user:string){const state=await games.snapshot(id,user);clock=state.nextAt+1;await games.tick();return games.snapshot(id,user);}
  function connect(socket:Socket){return new Promise<void>((resolve,reject)=>{socket.once('connect',()=>resolve());socket.once('connect_error',reject);});}
  function stateWhen(socket:Socket,predicate:(view:MatchView)=>boolean){return new Promise<MatchView>((resolve,reject)=>{const timer=setTimeout(()=>{socket.off('match:state',listener);reject(new Error('Missing private snapshot'));},5000);const listener=(view:MatchView)=>{if(predicate(view)){clearTimeout(timer);socket.off('match:state',listener);resolve(view);}};socket.on('match:state',listener);});}
  await t.test('room time limits use five choices and remain mandatory after normalization',()=>{
   for(const matchSeconds of [120,180,300,600,1200])assert.equal(RoomOptions.parse({difficulty:'in',rounds:0,matchSeconds}).matchSeconds,matchSeconds);
   for(const matchSeconds of [60,240,'180',0])assert.equal(RoomOptions.safeParse({difficulty:'in',rounds:0,matchSeconds}).success,false);
   assert.equal(RoomOptions.parse({difficulty:'at'}).matchSeconds,180);
  });
  await t.test('fixed skip waits, charges once and advances only after every participant closes the song',async()=>{
   const {a,b,match}=await begin();
   const skipped=await games.skipRound(match.id,a.user.id,0);assert.equal(skipped.round,0);assert.equal(skipped.status,'playing');assert.equal(self(skipped,a.user.id).skipped,true);assert.equal(self(skipped,a.user.id).health,15);
   assert.equal(self(await games.skipRound(match.id,a.user.id,0),a.user.id).health,15);await assert.rejects(correct(match.id,a.user.id,0));
   await correct(match.id,b.user.id,0);assert.equal((await games.snapshot(match.id,a.user.id)).status,'reveal');
   const advanced=await next(match.id,a.user.id);assert.equal(advanced.round,1);assert.equal((await games.snapshot(match.id,b.user.id)).round,1);
   assert.equal(self(await games.skipRound(match.id,a.user.id,0),a.user.id).health,15);
   const saved=(await db.query('SELECT skipped,closed_at FROM match_player_rounds WHERE match_id=$1 AND round=0 AND user_id=$2',[match.id,a.user.id])).rows[0]!;assert.equal(saved.skipped,true);assert.ok(saved.closed_at);
  });
  await t.test('endless skip, reconnect and broadcasts preserve each participant own cursor',async()=>{
   const {a,b,match}=await begin(0);
   const sa=io(base,{auth:{token:a.token},transports:['websocket'],reconnection:false}),sb=io(base,{auth:{token:b.token},transports:['websocket'],reconnection:false});sockets.push(sa,sb);await Promise.all([connect(sa),connect(sb)]);
   await sa.timeout(3000).emitWithAck('match:subscribe',{id:match.id});await sb.timeout(3000).emitWithAck('match:subscribe',{id:match.id});
   const aState=stateWhen(sa,view=>view.round===1),bState=stateWhen(sb,view=>view.round===0);
   const skipped=await games.skipRound(match.id,a.user.id,0);assert.equal(skipped.round,1);assert.equal((await aState).round,1);assert.equal((await bState).round,0);
   assert.equal((await games.snapshot(match.id,b.user.id)).round,0);assert.equal((await games.snapshot(match.id,a.user.id)).round,1);await assert.rejects(games.hints(match.id,b.user.id,1,0));await assert.rejects(games.image(match.id,1,b.user.id));
   const retried=await games.skipRound(match.id,a.user.id,0);assert.equal(retried.round,1);assert.equal(self(retried,a.user.id).health,15);
   sb.disconnect();const connected=io(base,{auth:{token:b.token},transports:['websocket'],reconnection:false});sockets.push(connected);await connect(connected);assert.equal((await connected.timeout(3000).emitWithAck('match:subscribe',{id:match.id})).data.round,0);
  });
  await t.test('endless course cycles until its shared deadline and restores personal history after eviction',async()=>{
   const {a,b,match,code}=await begin(0);
   for(let round=0;round<7;round++)assert.equal((await games.skipRound(match.id,a.user.id,round)).round,round+1);
   assert.equal((await games.snapshot(match.id,b.user.id)).round,0);assert.equal((await games.snapshot(match.id,a.user.id)).status,'playing');
   clock=match.matchEndsAt!;await games.tick();assert.equal((await games.snapshot(match.id,a.user.id)).status,'finished');assert.equal((await games.snapshot(match.id,b.user.id)).status,'finished');
   assert.equal(rooms.snapshot(code,a.user.id).matchId,null);
   const resultA=await games.result(match.id,a.user.id),resultB=await games.result(match.id,b.user.id);assert.equal(resultA.rounds.length,8);assert.equal(resultB.rounds.length,1);assert.equal((resultA as Record<string,unknown>).match_seconds,120);
   (games as any).matches.delete(match.id);assert.equal((await games.snapshot(match.id,a.user.id)).round,7);assert.equal((await games.snapshot(match.id,b.user.id)).round,0);
  });
  await t.test('both capacities keep zero HP playable, latch death below ten and score the revival answer',async()=>{
   for(const capacity of [20,50] as const){
    const {a,b,match}=await begin(3,capacity);clock=match.startsAt+1000;
    for(let i=0;i<capacity-1;i++)await wrong(match.id,a.user.id,0);
    assert.equal(self(await games.snapshot(match.id,a.user.id),a.user.id).dead,false);
    await wrong(match.id,a.user.id,0);for(let i=0;i<capacity;i++)await wrong(match.id,b.user.id,0);
    const dead=await games.snapshot(match.id,a.user.id);assert.equal(dead.status,'playing');assert.equal(self(dead,a.user.id).health,0);assert.equal(self(dead,a.user.id).dead,true);
    assert.equal((await correct(match.id,a.user.id,0)).score,0);assert.equal(self(await games.snapshot(match.id,a.user.id),a.user.id).health,5);assert.equal(self(await games.snapshot(match.id,a.user.id),a.user.id).dead,true);
    await games.skipRound(match.id,b.user.id,0);await next(match.id,a.user.id);clock+=1000;
    assert.equal((await correct(match.id,a.user.id,1)).score,1000);const revived=await games.snapshot(match.id,a.user.id);assert.equal(self(revived,a.user.id).health,10);assert.equal(self(revived,a.user.id).dead,false);
    await games.skipRound(match.id,b.user.id,1);await next(match.id,a.user.id);clock+=1000;
    for(let i=0;i<10;i++)await wrong(match.id,a.user.id,2);assert.equal((await correct(match.id,a.user.id,2)).score,0);await games.skipRound(match.id,b.user.id,2);await next(match.id,a.user.id);
    const result=await games.result(match.id,a.user.id),player=result.players.find(value=>value.user_id===a.user.id)!;assert.equal(player.health,5);assert.equal(player.dead,true);assert.equal(player.score,1000);assert.ok(player.survivalMs>1000);
    (games as any).matches.delete(match.id);assert.equal(self(await games.snapshot(match.id,a.user.id),a.user.id).dead,true);
   }
  });
  await t.test('remaining below ten without touching zero is alive and continues scoring',async()=>{
   const {a,match}=await begin();for(let i=0;i<19;i++)await wrong(match.id,a.user.id,0);
   assert.equal((await correct(match.id,a.user.id,0)).score,500);const player=self(await games.snapshot(match.id,a.user.id),a.user.id);assert.equal(player.health,6);assert.equal(player.dead,false);
  });
  await t.test('endless ends early when everyone is dead, including a player healed below revival threshold',async()=>{
   const {a,b,match,code}=await begin(0);clock=match.startsAt+1000;
   for(let index=0;index<20;index++)await wrong(match.id,a.user.id,0);
   await correct(match.id,a.user.id,0);assert.equal(self(await games.snapshot(match.id,a.user.id),a.user.id).health,5);
   for(let index=0;index<20;index++)await wrong(match.id,b.user.id,0);
   assert.ok(clock<match.matchEndsAt!);assert.equal((await games.snapshot(match.id,a.user.id)).status,'finished');assert.equal((await games.snapshot(match.id,b.user.id)).status,'finished');
   const result=await games.result(match.id,a.user.id);assert.equal(result.players.length,2);assert.ok(result.players.every(player=>player.dead));assert.equal(rooms.snapshot(code,a.user.id).matchId,null);
  });
  await t.test('final standings retain dead high scorers below alive players and persist cumulative survival',async()=>{
   const {a,b,match}=await begin(0);await correct(match.id,a.user.id,0);await next(match.id,a.user.id);clock+=1000;
   for(let i=0;i<20;i++)await wrong(match.id,a.user.id,1);
   clock=match.matchEndsAt!;await games.tick();const result=await games.result(match.id,a.user.id);
   assert.equal(result.players.length,2);assert.equal(result.players[0]!.user_id,b.user.id);assert.equal(result.players[0]!.survivalMs,120000);assert.equal(result.players[1]!.dead,true);assert.ok(result.players[1]!.score>result.players[0]!.score);assert.ok(result.players[1]!.survivalMs<120000);
  });
 }finally{for(const socket of sockets)socket.disconnect();Date.now=realNow;if(app)await app.close();await db.close();process.env.DATABASE_URL=databaseUrl;await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.close();}
});
