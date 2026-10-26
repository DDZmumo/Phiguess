import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {InfinityLeaderboardOptions,RULES_VERSION} from '../packages/contracts/src';
import {Db} from '../apps/server/src/db';
import {GamesService} from '../apps/server/src/games';
import {PublicController} from '../apps/server/src/http';
import type {AuthService} from '../apps/server/src/auth';
import type {CatalogService} from '../apps/server/src/catalog';
import type {Events} from '../apps/server/src/events';
import type {MediaService} from '../apps/server/src/media';
import {migrate} from '../tools/migrate';
import {withReferencePlayer} from '../apps/server/src/leaderboard-reference';
import {performanceBadgeTotals} from '../packages/game-core/src';

test('reference character has 325 perfect answers and a rainbow badge on every board',()=>{
 for(const difficulty of ['in','at'] as const){const [entry]=withReferencePlayer([],difficulty);assert.equal(entry!.name,'HATE_GEOPELIA');assert.equal(entry!.totalRounds,325);assert.equal(entry!.correct,325);assert.equal(entry!.score,difficulty==='at'?975000:650000);assert.equal(entry!.rank,'1');assert.equal(performanceBadgeTotals(entry!.score,entry!.correct,difficulty).grade,'rainbow');}
 const tied=withReferencePlayer([{id:'fixture',name:'Tie',avatarUrl:null,rank:'1',score:975000,correct:325,totalRounds:325,isGuest:true}],'at');assert(tied.every(p=>p.rank==='1'));assert.equal(tied.find(p=>p.isReference)?.isGuest,false);
});

test('Infinity leaderboard query validation',()=>{
 assert.deepEqual(InfinityLeaderboardOptions.parse({}),{difficulty:'at',healthCapacity:20,roundSeconds:30});
 assert.deepEqual(InfinityLeaderboardOptions.parse({difficulty:'in',healthCapacity:'50',roundSeconds:'15'}),{difficulty:'in',healthCapacity:50,roundSeconds:15});
 for(const value of [{difficulty:'ez'},{difficulty:'hd'},{healthCapacity:0},{healthCapacity:10},{roundSeconds:90},{difficulty:'at',roundSeconds:15},{rounds:5},{mode:'room'},{healthEnabled:false}])assert.equal(InfinityLeaderboardOptions.safeParse(value).success,false);
});

test('Infinity leaderboards isolate difficulty, HP and time and count exhausted health',async()=>{
 const db=new Db();try{
  await migrate(db);const a=randomUUID(),b=randomUUID();await db.query('INSERT INTO users(id,name,avatar_key) VALUES($1,$2,$5),($3,$4,NULL)',[a,'Infinity A',b,'Infinity B','fixture-avatar.webp']);
  const song=randomUUID(),artwork=randomUUID();await db.query('INSERT INTO songs(id,title) VALUES($1,$2)',[song,'Leaderboard fixture']);await db.query("INSERT INTO artworks(id,song_id,version,difficulty,storage_key,mime,bytes) VALUES($1,$2,'fixture','at',$3,'image/svg+xml',1)",[artwork,song,`${artwork}.svg`]);
  const games=new GamesService(db,{} as CatalogService,{} as Events),controller=new PublicController(db,{} as AuthService,{} as CatalogService,games,{} as MediaService);
  async function seed(user:string,score:number,options:{difficulty?:string;capacity?:number;seconds?:number;rounds?:number;status?:string;mode?:string;enabled?:boolean;rules?:string;health?:number;published?:boolean;total?:number}={}){
   const id=randomUUID(),capacity=options.capacity??20;
   await db.query('INSERT INTO matches(id,mode,difficulty,status,rules_version,round_count,round_seconds,health_enabled,health_capacity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,options.mode??'practice',options.difficulty??'at',options.status??'finished',options.rules??RULES_VERSION,options.rounds??0,options.seconds??30,options.enabled??capacity>0,capacity]);
   await db.query('INSERT INTO match_players(match_id,user_id,score,correct,health,result_published) VALUES($1,$2,$3,3,$4,$5)',[id,user,score,options.health??0,options.published??true]);
   await db.query("INSERT INTO match_rounds(match_id,round,artwork_id,starts_at,deadline) SELECT $1,n,$2,now(),now()+interval '30 seconds' FROM generate_series(0,$3::int-1) n",[id,artwork,options.total??4]);
  }
  await seed(a,120,{total:10});await seed(a,250,{total:8});await seed(b,180,{health:4});await seed(a,900,{capacity:50});
  await seed(b,999999,{published:false});
  await seed(a,220,{difficulty:'in',seconds:15});await seed(a,330,{difficulty:'in'});await seed(a,660,{difficulty:'in',capacity:50,seconds:60});
  for(const options of [{capacity:0},{enabled:false},{difficulty:'hd'},{difficulty:'in',rounds:5},{status:'active'},{status:'interrupted'},{mode:'room'},{rules:'legacy'}])await seed(b,99999,options);
  const at20=await controller.leaderboard({difficulty:'at',healthCapacity:'20',roundSeconds:'30'});
  assert.deepEqual(at20.filter(p=>p.id===a||p.id===b).map(p=>[p.id,p.score]),[[a,250],[b,180]]);
  assert.equal(at20.find(p=>p.id===a)?.avatarUrl,`/api/users/${a}/avatar?v=fixture-avatar.webp`);assert.equal(at20.find(p=>p.id===b)?.avatarUrl,null);
  assert.equal(at20.find(p=>p.id===a)?.isGuest,true);assert.equal(at20.find(p=>p.id===b)?.isGuest,true);
  assert.equal(at20.find(p=>p.id===a)?.totalRounds,8);assert.equal(at20.find(p=>p.id===b)?.totalRounds,4);
  for(const [difficulty,capacity,seconds,score]of [['at',50,30,900],['in',20,15,220],['in',20,30,330],['in',50,60,660]] as const){
   const board=await controller.leaderboard({difficulty,healthCapacity:String(capacity),roundSeconds:String(seconds)});assert.equal(board.find(p=>p.id===a)?.score,score);assert(!board.some(p=>p.id===b));
   const reference=board.find(p=>p.isReference);assert.equal(reference?.score,difficulty==='at'?975000:650000);assert.equal(reference?.avatarUrl,'/characters/hate-geopelia.png');
  }
  for(const query of [{difficulty:'hd'},{healthCapacity:'0'},{difficulty:'at',roundSeconds:'60'},{rounds:'5'},{mode:'room'}])assert.throws(()=>controller.leaderboard(query),e=>(e as {getStatus():number}).getStatus()===400);
 }finally{await db.close();}
});


test('legacy scores remain unranked on the same board and do not change the 325 reference',()=>{
 const rows=withReferencePlayer([
  {id:'legacy',name:'Legacy',avatarUrl:null,rank:'1',score:9999999,correct:1,totalRounds:1,isGuest:false,isLegacy:true},
  {id:'current-a',name:'Current A',avatarUrl:null,rank:'2',score:1000,correct:1,totalRounds:1,isGuest:false},
  {id:'current-b',name:'Current B',avatarUrl:null,rank:'3',score:1000,correct:1,totalRounds:1,isGuest:false},
 ],'at');
 assert.equal(rows[0]!.isReference,true);assert.equal(rows[0]!.rank,'1');assert.equal(rows[0]!.score,975000);assert.equal(rows[0]!.correct,325);assert.equal(rows[0]!.totalRounds,325);
 assert.deepEqual(rows.slice(1).map(row=>[row.id,row.rank]),[['current-a','2'],['current-b','2'],['legacy','--']]);
});

test('publishing a current score replaces only that player legacy entry for the same board',async()=>{
 const db=new Db();try{
  await migrate(db);const user=randomUUID();await db.query('INSERT INTO users(id,name) VALUES($1,$2)',[user,'Legacy replacement']);
  const games=new GamesService(db,{} as CatalogService,{} as Events);
  const seed=async(rules:string,score:number,published:boolean,capacity=20)=>{
   const id=randomUUID();await db.query("INSERT INTO matches(id,mode,difficulty,status,rules_version,health_enabled,health_capacity,round_count,round_seconds) VALUES($1,'practice','at','finished',$2,true,$3,0,30)",[id,rules,capacity]);
   await db.query('INSERT INTO match_players(match_id,user_id,score,correct,health,result_published) VALUES($1,$2,$3,1,0,$4)',[id,user,score,published]);return id;
  };
  const old=await seed('v4-downgrade',3000,true),otherBoard=await seed('v3-deduction',3000,true,50),current=await seed(RULES_VERSION,1000,false);
  const options={difficulty:'at' as const,healthCapacity:20 as const,roundSeconds:30 as const};
  const before=(await games.leaderboard(options)).find(row=>row.id===user)!;assert.equal(before.rank,'--');assert.equal(before.score,3000);
  await games.setResultPublication(current,user,true);
  const after=(await games.leaderboard(options)).find(row=>row.id===user)!;assert.notEqual(after.rank,'--');assert.equal(after.score,1000);assert.equal(after.isLegacy,false);
  const flags=(await db.query('SELECT match_id,result_published FROM match_players WHERE user_id=$1',[user])).rows;
  assert.equal(flags.find(row=>row.match_id===old)!.result_published,false);assert.equal(flags.find(row=>row.match_id===otherBoard)!.result_published,true);
  await games.setResultPublication(current,user,false);assert.equal((await games.leaderboard(options)).some(row=>row.id===user),false);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM matches WHERE id=$1',[old])).rows[0]!.count,1);
 }finally{await db.close();}
});
