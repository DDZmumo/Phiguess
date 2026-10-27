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
import {Events} from '../apps/server/src/events';
import {migrate} from '../tools/migrate';
import {RoomOptions,RULES_VERSION,type RoomRemovalNotice} from '../packages/contracts/src';

test('room moderation, ownership and song scopes',{timeout:90000},async t=>{
 const databaseUrl=process.env.DATABASE_URL!,admin=new Db(),schema=`room_manage_${randomUUID().replaceAll('-','')}`;await admin.query(`CREATE SCHEMA "${schema}"`);const isolated=new URL(databaseUrl);isolated.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=isolated.toString();
 const db=new Db(),realNow=Date.now,sockets:Socket[]=[];let app:INestApplication|undefined,clock=realNow();Date.now=()=>clock;
 try{
  await migrate(db);
  for(let index=0;index<5;index++){
   const song=randomUUID();await db.query('INSERT INTO songs(id,title,chapter,chapter_name,composer) VALUES($1,$2,1,$3,$4)',[song,`Management ${index}`,'Fixture','Composer']);
   for(const difficulty of ['hd','at']){
    const artwork=randomUUID();await db.query('INSERT INTO artworks(id,song_id,version,difficulty,storage_key,mime,bytes,illustrator,content_kind,removed,introduced_version) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10)',[artwork,song,'management-fixture',difficulty,artwork+'.svg','image/svg+xml','Illustrator',index===1?'non-main':index===3?'april-fools':'main',index===2,'1.0.0']);
   }
  }
  const module=await Test.createTestingModule({imports:[AppModule]}).compile();app=module.createNestApplication({logger:false,bodyParser:false});configureApp(app);await app.listen(0,'127.0.0.1');const base=await app.getUrl(),auth=app.get(AuthService),games=app.get(GamesService),rooms=app.get(RoomsService),events=app.get(Events);
  async function setup(){const users=await Promise.all(['Host','Guest','Third','Outsider'].map(name=>auth.createGuest(name))),room=await rooms.create(users[0]!.user,RoomOptions.parse({difficulty:'hd',rounds:1,healthCapacity:20}));await rooms.join(room.code,users[1]!.user);await rooms.join(room.code,users[2]!.user);return {users,code:room.code};}
  async function post(code:string,action:string,token:string,userId:string,extra={}){const response=await fetch(base+`/api/rooms/${code}/${action}`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({userId,...extra})});return {status:response.status,body:await response.json() as any};}
  async function connect(token:string,code:string){const socket=io(base,{auth:{token},transports:['websocket'],reconnection:false});sockets.push(socket);await new Promise<void>((resolve,reject)=>{socket.once('connect',()=>resolve());socket.once('connect_error',reject);});assert.equal((await socket.timeout(3000).emitWithAck('room:subscribe',{code})).ok,true);return socket;}
  await t.test('moderation endpoints validate host authority, membership, target and match phase',async()=>{
   const {users:[host,guest,third,outsider],code}=await setup();for(const action of ['kick','transfer-host']){assert.equal((await post(code,action,guest!.token,third!.user.id)).status,403);assert.equal((await post(code,action,outsider!.token,guest!.user.id)).status,403);assert.equal((await post(code,action,host!.token,host!.user.id)).status,400);assert.equal((await post(code,action,host!.token,randomUUID())).status,404);assert.equal((await post(code,action,host!.token,'invalid')).status,400);assert.equal((await post(code,action,host!.token,guest!.user.id,{unknown:true})).status,400);}
   for(const user of [host,guest,third])await rooms.ready(code,user!.user.id,true);await rooms.start(code,host!.user.id,true);for(const action of ['kick','transfer-host'])assert.equal((await post(code,action,host!.token,guest!.user.id)).status,409);
  });
  await t.test('kicking removes membership and immediately notifies and unsubscribes the removed player',async()=>{
   const {users:[host,guest,third],code}=await setup(),socket=await connect(guest!.token,code),states:unknown[]=[];socket.on('room:state',value=>states.push(value));const removed=new Promise<RoomRemovalNotice>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Kick notice missing')),3000);socket.once('room:removed',notice=>{clearTimeout(timer);resolve(notice);});});
   const response=await post(code,'kick',host!.token,guest!.user.id);assert.equal(response.status,201);assert.equal(response.body.players.length,2);assert.deepEqual(await removed,{code,reason:'kicked'});assert.throws(()=>rooms.snapshot(code,guest!.user.id));assert.equal((await socket.timeout(3000).emitWithAck('room:subscribe',{code})).ok,false);await rooms.ready(code,third!.user.id,true);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(states.length,0);assert.equal((await rooms.join(code,guest!.user)).players.length,3,'Kick must not silently create a permanent room ban');
  });
  await t.test('host transfer preserves roster and readiness and transfers actual start/force-start authority',async()=>{
   const {users:[host,guest,third],code}=await setup();assert.equal(rooms.snapshot(code,host!.user.id).hostChange,undefined);for(const user of [host,guest,third])await rooms.ready(code,user!.user.id,true);const response=await post(code,'transfer-host',host!.token,guest!.user.id);assert.equal(response.status,201);assert.equal(response.body.hostId,guest!.user.id);assert.deepEqual(response.body.hostChange,{eventId:response.body.hostChange.eventId,hostId:guest!.user.id,previousHostId:host!.user.id,reason:'transfer'});assert.match(response.body.hostChange.eventId,/^[0-9a-f-]{36}$/);assert.deepEqual(response.body.players.map((p:any)=>p.id),[host!.user.id,guest!.user.id,third!.user.id]);assert.ok(response.body.players.every((p:any)=>p.ready));assert.equal((await post(code,'kick',host!.token,third!.user.id)).status,403);assert.equal((await post(code,'kick',guest!.token,third!.user.id)).status,201);
   await assert.rejects(rooms.start(code,host!.user.id,true),/Only host/);const match=await rooms.start(code,guest!.user.id,true);assert.equal(match.hostId,guest!.user.id);await games.ready(match.id,guest!.user.id);clock=match.loadingForceStartAt!;await assert.rejects(games.forceStartLoading(match.id,host!.user.id),/Only host/);const playing=await games.forceStartLoading(match.id,guest!.user.id);assert.equal(playing.hostId,guest!.user.id);assert.equal(playing.players.length,1);
  });
  await t.test('a lobby host departure records a distinct handover notice for the new host',async()=>{
   const {users:[host,guest,third],code}=await setup();const transferred=await rooms.transferHost(code,host!.user.id,third!.user.id);await rooms.leave(code,third!.user.id);const after=rooms.snapshot(code,host!.user.id);assert.equal(after.hostId,host!.user.id);assert.deepEqual(after.hostChange,{eventId:after.hostChange!.eventId,hostId:host!.user.id,previousHostId:third!.user.id,reason:'leave'});assert.notEqual(after.hostChange!.eventId,transferred.hostChange!.eventId);assert.equal(after.players.length,2);assert.equal(rooms.snapshot(code,guest!.user.id).hostChange!.eventId,after.hostChange!.eventId);
  });
  await t.test('room badges choose each member best published Infinity across settings and follow the room difficulty',async()=>{
   const {users:[host,guest,third,outsider],code}=await setup();
   async function seed(userId:string,score:number,correct:number,options:{difficulty?:string;capacity?:number;seconds?:number;published?:boolean;mode?:string;rounds?:number;status?:string;rules?:string}={}){
    const id=randomUUID(),capacity=options.capacity??20;
    await db.query('INSERT INTO matches(id,mode,difficulty,status,rules_version,round_count,round_seconds,health_enabled,health_capacity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,options.mode??'practice',options.difficulty??'at',options.status??'finished',options.rules??RULES_VERSION,options.rounds??0,options.seconds??30,capacity>0,capacity]);
    await db.query('INSERT INTO match_players(match_id,user_id,score,correct,health,result_published) VALUES($1,$2,$3,$4,0,$5)',[id,userId,score,correct,options.published??true]);
   }
   await seed(host!.user.id,5900,2);await seed(host!.user.id,9000,3,{capacity:50});await seed(guest!.user.id,3000,1);await seed(host!.user.id,5000,3,{difficulty:'in',seconds:15});await seed(host!.user.id,12000,6,{difficulty:'in',capacity:50,seconds:60});
   for(const options of [{published:false},{mode:'room'},{rounds:5},{status:'interrupted'},{status:'active'},{rules:'legacy'},{capacity:0}])await seed(guest!.user.id,99999,50,options);
   await seed(outsider!.user.id,15000,5);
   const read=async(token:string)=>{const response=await fetch(base+`/api/rooms/${code}/performances`,{headers:{Authorization:'Bearer '+token}});return {status:response.status,body:await response.json() as any};};
   const at=await read(guest!.token);assert.equal(at.status,200);assert.deepEqual(at.body,{difficulty:'at',players:[{id:host!.user.id,best:{score:9000,correct:3}},{id:guest!.user.id,best:{score:3000,correct:1}},{id:third!.user.id,best:null}]});assert.equal((await read(outsider!.token)).status,403);
   await rooms.configure(code,host!.user.id,RoomOptions.parse({difficulty:'in',rounds:5}));const intermediate=await read(host!.token);assert.deepEqual(intermediate.body,{difficulty:'in',players:[{id:host!.user.id,best:{score:12000,correct:6}},{id:guest!.user.id,best:null},{id:third!.user.id,best:null}]});
   for(const difficulty of ['at','ez','hd'] as const){await rooms.configure(code,host!.user.id,RoomOptions.parse({difficulty}));assert.deepEqual((await read(host!.token)).body,at.body);}
   await rooms.kick(code,host!.user.id,guest!.user.id);assert.equal((await read(guest!.token)).status,403);assert.deepEqual((await read(host!.token)).body.players.map((player:any)=>player.id),[host!.user.id,third!.user.id]);
  });
  await t.test('scope-only changes reset readiness, synchronize and actually filter selected songs',async()=>{
   const {users:[host,guest,third],code}=await setup(),published:any[]=[];const observe=(view:any)=>{if(view.code===code)published.push(view);};events.on('room',observe);
   try{for(const user of [host,guest,third])await rooms.ready(code,user!.user.id,true);const initial=rooms.snapshot(code,host!.user.id),before=published.length;const same=await rooms.configure(code,host!.user.id,RoomOptions.parse({...initial.options,artworkScopes:['main','non-main','removed','april-fools']}));assert.ok(same.players.every(p=>p.ready));assert.equal(published.length,before);
    await assert.rejects(rooms.configure(code,guest!.user.id,RoomOptions.parse({...same.options,artworkScopes:['non-main']})),/Only host/);const updated=await rooms.configure(code,host!.user.id,RoomOptions.parse({...same.options,artworkScopes:['non-main']}));assert.deepEqual(updated.options.artworkScopes,['non-main']);assert.ok(updated.players.every(p=>!p.ready));assert.deepEqual(published.at(-1).options.artworkScopes,['non-main']);assert.equal(RoomOptions.safeParse({...updated.options,artworkScopes:['removed']}).success,false);
    for(const user of [host,guest,third])await rooms.ready(code,user!.user.id,true);const match=await rooms.start(code,host!.user.id);const artwork=(await db.query('SELECT a.content_kind,a.removed FROM match_rounds r JOIN artworks a ON a.id=r.artwork_id WHERE r.match_id=$1',[match.id])).rows[0]!;assert.equal(artwork.content_kind,'non-main');assert.equal(artwork.removed,false);
   }finally{events.off('room',observe);}
  });
 }finally{for(const socket of sockets)socket.disconnect();Date.now=realNow;if(app)await app.close();await db.close();process.env.DATABASE_URL=databaseUrl;await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.close();}
});
