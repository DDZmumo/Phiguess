import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {AppModule,configureApp} from '../apps/server/src/app';
import {AuthService} from '../apps/server/src/auth';
import {Db} from '../apps/server/src/db';
import {GamesService} from '../apps/server/src/games';
import {RULES_VERSION} from '../packages/contracts/src';
import {migrate} from '../tools/migrate';

test('Infinity results require explicit publication and retain private history',{timeout:30000},async()=>{
 const admin=new Db(),databaseUrl=process.env.DATABASE_URL!,schema=`publication_${randomUUID().replaceAll('-','')}`;
 await admin.query(`CREATE SCHEMA "${schema}"`);const isolated=new URL(databaseUrl);isolated.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=isolated.toString();
 const db=new Db();let app:INestApplication|undefined;
 try{
  await migrate(db);const module=await Test.createTestingModule({imports:[AppModule]}).compile();app=module.createNestApplication({logger:false,bodyParser:false});configureApp(app);await app.listen(0,'127.0.0.1');
  const games=app.get(GamesService),auth=app.get(AuthService),base=await app.getUrl(),user=await auth.createGuest('Publication'),other=await auth.createGuest('Other');
  async function seed(score:number,status='finished',rounds=0){const id=randomUUID();await db.query("INSERT INTO matches(id,mode,difficulty,status,rules_version,health_capacity,health_enabled,round_count,round_seconds) VALUES($1,'practice','in',$2,$3,20,true,$4,30)",[id,status,RULES_VERSION,rounds]);await db.query('INSERT INTO match_players(match_id,user_id,score,correct,health) VALUES($1,$2,$3,2,0)',[id,user.user.id,score]);return id;}
  const board=async()=>(await games.leaderboard({difficulty:'in',healthCapacity:20,roundSeconds:30})).filter(player=>!player.isReference);
  async function action(id:string,body:unknown,token:string|undefined=user.token){const response=await fetch(`${base}/api/matches/${id}/publication`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});return {status:response.status,body:await response.json() as any};}
  const first=await seed(100),second=await seed(200);assert.deepEqual(await board(),[]);
  assert.equal((await db.query('SELECT result_published FROM match_players WHERE match_id=$1',[second])).rows[0]!.result_published,false);
  assert.equal((await action(second,{published:false})).status,201);assert.deepEqual(await board(),[]);
  assert.equal((await action(first,{published:true})).status,201);assert.equal((await board())[0]!.score,100);
  assert.equal((await action(second,{published:false})).status,201);assert.equal((await board())[0]!.score,100);
  assert.equal((await action(second,{published:true})).status,201);assert.equal((await action(second,{published:true})).status,201);assert.equal((await board()).length,1);assert.equal((await board())[0]!.score,200);
  assert.equal((await db.query('SELECT result_published FROM match_players WHERE match_id=$1',[second])).rows[0]!.result_published,true);
  assert.equal((await action(second,{published:false})).status,201);assert.equal((await board())[0]!.score,100);assert.equal((await games.result(second,user.user.id)).published,false);
  assert.equal((await db.query('SELECT score FROM match_players WHERE match_id=$1',[second])).rows[0]!.score,200);
  assert.equal((await action(second,{published:true},other.token)).status,404);
  assert.equal((await action(second,{published:true},'')).status,401);
  assert.equal((await action(second,{published:true,score:999999})).status,400);
  assert.equal((await action(await seed(1000,'active'),{published:true})).status,409);
  assert.equal((await action(await seed(1000,'interrupted'),{published:true})).status,409);
  assert.equal((await action(await seed(1000,'finished',5),{published:true})).status,409);
 }finally{if(app)await app.close();await db.close();process.env.DATABASE_URL=databaseUrl;await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.close();}
});
