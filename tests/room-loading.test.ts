import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {gzipSync,brotliCompressSync} from 'node:zlib';
import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {io,type Socket} from 'socket.io-client';
import {AppModule,configureApp} from '../apps/server/src/app';
import {Db} from '../apps/server/src/db';
import {AuthService} from '../apps/server/src/auth';
import {GamesService} from '../apps/server/src/games';
import {RoomsService} from '../apps/server/src/rooms';
import {migrate} from '../tools/migrate';
import {ROOM_LOADING_TIMEOUT_MS,ROOM_LOADING_FORCE_START_MS,RoomOptions,type RoomRemovalNotice} from '../packages/contracts/src';

test('room loading cutoff, removal and room admission',{timeout:90000},async t=>{
 const admin=new Db(),databaseUrl=process.env.DATABASE_URL!,schema=`loading_${randomUUID().replaceAll('-','')}`;
 await admin.query(`CREATE SCHEMA "${schema}"`);const isolated=new URL(databaseUrl);isolated.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=isolated.toString();
 const db=new Db(),realNow=Date.now,sockets:Socket[]=[];let app:INestApplication|undefined,clock=realNow();Date.now=()=>clock;
 try{
  await migrate(db);
  for(let index=0;index<5;index++){const song=randomUUID();await db.query('INSERT INTO songs(id,title,chapter,chapter_name,composer) VALUES($1,$2,1,$3,$4)',[song,`Loading ${index}`,'Fixture','Composer']);for(const difficulty of ['hd','in']){const artwork=randomUUID();await db.query('INSERT INTO artworks(id,song_id,version,difficulty,storage_key,mime,bytes,illustrator) VALUES($1,$2,$3,$4,$5,$6,1,$7)',[artwork,song,'loading-fixture',difficulty,artwork+'.svg','image/svg+xml','Illustrator']);}}
  const module=await Test.createTestingModule({imports:[AppModule]}).compile();app=module.createNestApplication({logger:false,bodyParser:false});configureApp(app);await app.listen(0,'127.0.0.1');
  const games=app.get(GamesService),rooms=app.get(RoomsService),auth=app.get(AuthService),base=await app.getUrl();
  async function begin(endless=false,count=3){const users=await Promise.all(Array.from({length:count},(_,index)=>auth.createGuest(`Loading ${index}`)));const room=await rooms.create(users[0]!.user,RoomOptions.parse({difficulty:endless?'in':'hd',rounds:endless?0:1,roundSeconds:30,healthCapacity:20,maxPlayers:8,...(endless?{matchSeconds:120}:{})}));for(const user of users.slice(1))await rooms.join(room.code,user.user);for(const user of users)await rooms.ready(room.code,user.user.id,true);const match=await rooms.start(room.code,users[0]!.user.id,true);assert.equal(match.loadingDeadlineAt,clock+ROOM_LOADING_TIMEOUT_MS);return {users,code:room.code,match};}
  async function socket(token:string){const connection=io(base,{auth:{token},transports:['websocket'],reconnection:false});sockets.push(connection);await new Promise<void>((resolve,reject)=>{connection.once('connect',()=>resolve());connection.once('connect_error',reject);});return connection;}
  const gone=(error:any)=>error.getStatus?.()===410&&error.getResponse().code==='ROOM_LOADING_REMOVED';
  await t.test('only loaded players start after the cutoff, with host transfer and no result for excluded players',async()=>{
   const {users:[a,b,c],code,match}=await begin(true);await games.ready(match.id,b!.user.id);await games.ready(match.id,c!.user.id);
   const timedOut=await socket(a!.token),states:unknown[]=[];await timedOut.timeout(3000).emitWithAck('room:subscribe',{code});await timedOut.timeout(3000).emitWithAck('match:subscribe',{id:match.id});timedOut.on('match:state',view=>states.push(view));
   const removed=new Promise<RoomRemovalNotice>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('No room removal notice')),4000);timedOut.once('room:removed',notice=>{clearTimeout(timer);resolve(notice);});});
   clock=match.loadingDeadlineAt!;await games.tick();assert.deepEqual(await removed,{code,matchId:match.id,reason:'loading-timeout'});
   const playing=await games.snapshot(match.id,b!.user.id);assert.equal(playing.awaitingReady,false);assert.equal(playing.players.length,2);assert.equal(playing.startsAt,clock+3000);assert.equal(playing.matchEndsAt,playing.startsAt+120000);const handover=rooms.snapshot(code,b!.user.id).hostChange!;assert.equal(rooms.snapshot(code,b!.user.id).hostId,b!.user.id);assert.deepEqual(handover,{eventId:handover.eventId,previousHostId:a!.user.id,hostId:b!.user.id,matchId:match.id,reason:'loading'});
   await assert.rejects(games.snapshot(match.id,a!.user.id),gone);await assert.rejects(games.ready(match.id,a!.user.id),gone);await assert.rejects(games.image(match.id,0,a!.user.id),gone);assert.equal(await games.active(a!.user.id),null);assert.equal((await db.query('SELECT count(*)::int AS n FROM match_players WHERE match_id=$1',[match.id])).rows[0]!.n,2);
   const response=await fetch(base+'/api/matches/'+match.id,{headers:{Authorization:'Bearer '+a!.token}});assert.equal(response.status,410);assert.equal((await response.json() as any).roomCode,code);
   await assert.rejects(rooms.join(code,a!.user),/already started/);const d=await auth.createGuest('Other host'),other=await rooms.create(d.user,RoomOptions.parse({difficulty:'hd'}));assert.equal((await rooms.join(other.code,a!.user)).players.length,2);
   clock=playing.startsAt+1;await games.skipRound(match.id,b!.user.id,0);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(states.length,0,'Excluded socket must not receive future match states');
   clock=playing.matchEndsAt!;await games.tick();assert.equal((await games.result(match.id,b!.user.id)).players.length,2);assert.equal(rooms.snapshot(code,b!.user.id).matchId,null);assert.deepEqual(rooms.snapshot(code,b!.user.id).hostChange,handover,'Deferred handover must survive until the new host returns to the room');await rooms.leave(other.code,a!.user.id);assert.equal((await rooms.join(code,a!.user)).players.length,3);
  });
  await t.test('a ready request at the cutoff cannot admit a late player',async()=>{
   const {users:[a,b],code,match}=await begin(false,2);await games.ready(match.id,a!.user.id);clock=match.loadingDeadlineAt!;await assert.rejects(games.ready(match.id,b!.user.id),gone);const playing=await games.snapshot(match.id,a!.user.id);assert.equal(playing.awaitingReady,false);assert.equal(playing.players.length,1);assert.equal(rooms.snapshot(code,a!.user.id).players.length,1);clock=playing.startsAt+1;await games.skipRound(match.id,a!.user.id,0);clock+=2001;await games.tick();assert.equal((await games.snapshot(match.id,a!.user.id)).status,'finished');
  });
  await t.test('only the host can force start after sixty seconds and only ready users are admitted',async()=>{
   const {users:[a,b,c],code,match}=await begin();await games.ready(match.id,a!.user.id);await games.ready(match.id,b!.user.id);
   assert.equal(match.loadingForceStartAt,match.loadingDeadlineAt!-ROOM_LOADING_TIMEOUT_MS+ROOM_LOADING_FORCE_START_MS);clock=match.loadingForceStartAt!-1;await assert.rejects(games.forceStartLoading(match.id,a!.user.id),/not available yet/);clock++;
   const denied=await fetch(base+'/api/matches/'+match.id+'/force-start',{method:'POST',headers:{Authorization:'Bearer '+b!.token}});assert.equal(denied.status,403);
   const response=await fetch(base+'/api/matches/'+match.id+'/force-start',{method:'POST',headers:{Authorization:'Bearer '+a!.token}});assert.equal(response.status,201);const playing=await response.json() as any;assert.equal(playing.awaitingReady,false);assert.equal(playing.players.length,2);assert.equal(playing.startsAt,clock+3000);await assert.rejects(games.ready(match.id,c!.user.id),error=>gone(error)&&(error as any).getResponse().reason==='forced-start');assert.equal(rooms.snapshot(code,a!.user.id).players.length,2);
  });
  await t.test('a host that has not loaded is also removed when forcing start',async()=>{
   const {users:[a,b,c],code,match}=await begin();await games.ready(match.id,b!.user.id);await games.ready(match.id,c!.user.id);clock=match.loadingForceStartAt!;await assert.rejects(games.forceStartLoading(match.id,a!.user.id),gone);assert.equal(rooms.snapshot(code,b!.user.id).hostId,b!.user.id);assert.equal((await games.snapshot(match.id,b!.user.id)).hostId,b!.user.id);assert.equal(await games.active(a!.user.id),null);
  });
  await t.test('fixed-round sockets are revoked immediately even while the room queue is blocked',async()=>{
   const {users:[a,b],code,match}=await begin(false,2);await games.ready(match.id,a!.user.id);const removedSocket=await socket(b!.token);await removedSocket.timeout(3000).emitWithAck('match:subscribe',{id:match.id});
   const states:unknown[]=[];removedSocket.on('match:state',view=>states.push(view));const notice=new Promise<void>(resolve=>removedSocket.once('room:removed',()=>resolve()));
   let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),blocked=(rooms as any).queue.run(async()=>gate);
   try{clock=match.loadingDeadlineAt!;await games.tick();await Promise.race([notice,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Removal waited for room queue')),1000))]);assert.throws(()=>rooms.snapshot(code,b!.user.id),gone);const playing=await games.snapshot(match.id,a!.user.id);clock=playing.startsAt+1;await games.skipRound(match.id,a!.user.id,0);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(states.length,0,'Removed fixed-round player received a match state or answer');}
   finally{release();await blocked;await (rooms as any).queue.run(async()=>undefined);}
  });
  await t.test('leaving during loading stops blocking the already-loaded participants',async()=>{
   const {users:[a,b],code,match}=await begin(false,2);await games.ready(match.id,b!.user.id);await rooms.leave(code,a!.user.id);const playing=await games.snapshot(match.id,b!.user.id);assert.equal(playing.awaitingReady,false);assert.equal(playing.players.length,1);assert.equal(rooms.snapshot(code,b!.user.id).hostId,b!.user.id);await assert.rejects(games.snapshot(match.id,a!.user.id),gone);
  });
  await t.test('all participants timing out finishes the abandoned match and releases them',async()=>{
   const {users:[a,b],code,match}=await begin(true,2);clock=match.loadingDeadlineAt!+1;await games.tick();assert.equal(await games.active(a!.user.id),null);assert.equal(await games.active(b!.user.id),null);await assert.rejects(games.snapshot(match.id,a!.user.id),gone);assert.throws(()=>rooms.snapshot(code,a!.user.id));assert.equal((await db.query('SELECT status FROM matches WHERE id=$1',[match.id])).rows[0]!.status,'interrupted');const fresh=await rooms.create(a!.user,RoomOptions.parse({difficulty:'hd'}));assert.equal((await rooms.join(fresh.code,b!.user)).players.length,2);
  });
  await t.test('compressed JSON is rejected before decompression and the service remains healthy',async()=>{
   const body=Buffer.from(JSON.stringify({name:'Compressed'}));for(const [encoding,compressed]of [['gzip',gzipSync(body)],['br',brotliCompressSync(body)]] as const){const response=await fetch(base+'/api/auth/guest',{method:'POST',headers:{'Content-Type':'application/json','Content-Encoding':encoding},body:compressed});assert.equal(response.status,415);assert.equal((await fetch(base+'/api/health/ready')).status,200);}
  });
 }finally{for(const connection of sockets)connection.disconnect();Date.now=realNow;if(app)await app.close();await db.close();process.env.DATABASE_URL=databaseUrl;await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.close();}
});
