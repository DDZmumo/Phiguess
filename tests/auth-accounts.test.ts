import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {AppModule,configureApp} from '../apps/server/src/app';
import {AuthService} from '../apps/server/src/auth';
import {GamesService} from '../apps/server/src/games';
import {Db} from '../apps/server/src/db';
import {migrate} from '../tools/migrate';
import {RULES_VERSION} from '../packages/contracts/src';

test('password accounts and guest leaderboard compatibility',{timeout:60000},async()=>{
 const admin=new Db(),url=process.env.DATABASE_URL!,schema=`accounts_${randomUUID().replaceAll('-','')}`;
 await admin.query(`CREATE SCHEMA "${schema}"`);const isolated=new URL(url);isolated.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=isolated.toString();
 const db=new Db();let app:INestApplication|undefined;
 try{
  await migrate(db);const module=await Test.createTestingModule({imports:[AppModule]}).compile();app=module.createNestApplication({logger:false,bodyParser:false});configureApp(app);await app.listen(0,'127.0.0.1');
  const auth=app.get(AuthService),games=app.get(GamesService),base=await app.getUrl();
  const login=(name:string,password:string)=>fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,password})});
  const guest=await auth.createGuest('Shared name');assert.equal((await auth.authenticate(guest.token)).accountType,'guest');
  const created=await login('Shared name','FixturePass123');assert.equal(created.status,201);const account=await created.json();assert.notEqual(account.user.id,guest.user.id);assert.equal(account.user.accountType,'account');assert(!JSON.stringify(account).includes('password_hash'));
  const again=await login('SHARED NAME','FixturePass123');assert.equal(again.status,201);const session=await again.json();assert.equal(session.user.id,account.user.id);assert.notEqual(session.token,account.token);
  assert.equal((await login('Shared name','Incorrect123')).status,401);assert.equal((await login('New name','short')).status,400);
  const users=(await db.query('SELECT password_hash FROM users WHERE login_name=$1',['shared name'])).rows;assert.equal(users.length,1);assert(users[0]!.password_hash.startsWith('scrypt$'));assert(!users[0]!.password_hash.includes('FixturePass123'));
  await auth.logout(account.token);await assert.rejects(auth.authenticate(account.token));assert.equal((await auth.authenticate(session.token)).id,account.user.id);assert.equal((await auth.authenticate(guest.token)).id,guest.user.id);
  const concurrent=await Promise.all([auth.login('Race','ParallelPass123'),auth.login('Race','ParallelPass123')]);assert.equal(concurrent[0]!.user.id,concurrent[1]!.user.id);
  const conflicting=await Promise.allSettled([auth.login('Race 2','PasswordOne123'),auth.login('Race 2','PasswordTwo123')]);assert.equal(conflicting.filter(r=>r.status==='fulfilled').length,1);
  const renamed=await auth.rename(account.user.id,'Renamed');assert.equal(renamed!.accountType,'account');assert.equal((await auth.login('Renamed','FixturePass123')).user.id,account.user.id);await assert.rejects(auth.rename(account.user.id,'Race'));
  const id=randomUUID();await db.query("INSERT INTO matches(id,mode,difficulty,status,rules_version,round_count,round_seconds,health_enabled,health_capacity) VALUES($1,'practice','in','finished',$2,0,30,true,20)",[id,RULES_VERSION]);await db.query('INSERT INTO match_players(match_id,user_id,score,correct,health,result_published) VALUES($1,$2,1900,1,0,true)',[id,guest.user.id]);
  const guestEntry=(await games.leaderboard({difficulty:'in',healthCapacity:20,roundSeconds:30})).find(p=>p.id===guest.user.id);assert.equal(guestEntry?.isGuest,true);
 }finally{if(app)await app.close();await db.close();process.env.DATABASE_URL=url;await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.close();}
});
