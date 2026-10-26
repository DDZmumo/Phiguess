import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GameOptions, GuessInput, INFINITY_ROUNDS, NoiseHitInput, normalizeChallengeSettings, roundCountChoices, roundTimeChoices } from '../packages/contracts/src';
import { CatalogService, type Artwork } from '../apps/server/src/catalog';
import { GamesService } from '../apps/server/src/games';
import type { Db } from '../apps/server/src/db';
import type { Events } from '../apps/server/src/events';
import {nonMainHint,RELEASE_VERSIONS} from '../apps/server/src/version-hints';

function catalogRows(count:number):Artwork[] {
  return Array.from({length:count},(_,i)=>{
    const song_id=randomUUID();
    return [0,1].map(variant=>({id:randomUUID(),song_id,title:`Fixture ${i}`,aliases:[],hints:[],storage_key:'fixture.svg',mime:'image/svg+xml',difficulty:'in' as const,version:'test',variant:String(variant),chapter:null,chapter_name:null,composer:null}));
  }).flat();
}
function fixture(count:number,maxChapter=9) {
  const rows=catalogRows(count),queries:Array<{sql:string;values:any[]}> = [],rounds:Array<{round:number;artworkId:string}> = [];
  const hints=new Map<string,{index:number;content:string;kind:string;difficulty:null}>();
  const db={
    async query(sql:string,values:any[]=[]){
      queries.push({sql,values});
      if(sql.startsWith('SELECT a.*,s.title'))return {rows};
      if(sql.startsWith('SELECT max(chapter)'))return {rows:[{chapter:maxChapter}]};
      if(sql.startsWith('SELECT count(*)::int AS count FROM revealed_hints'))return {rows:[{count:0}]};
      if(sql.startsWith('INSERT INTO revealed_hints')){const key=values.slice(0,4).join('/');if(!hints.has(key))hints.set(key,{index:values[3],content:values[4],kind:values[5],difficulty:null});}
      if(sql.startsWith('SELECT hint_index AS index'))return {rows:[...hints.entries()].filter(([key])=>key.startsWith(values.slice(0,3).join('/')+'/')).map(([,hint])=>hint)};
      if(sql.startsWith('INSERT INTO match_rounds'))rounds.push({round:sql.includes('VALUES($1,0,')?0:values[1],artworkId:sql.includes('VALUES($1,0,')?values[1]:values[2]});
      return {rows:[]};
    },
    async transaction<T>(fn:(sql:any)=>Promise<T>){return fn(this);},
  };
  const catalog=new CatalogService(db as unknown as Db),games=new GamesService(db as unknown as Db,catalog,{match(){}} as unknown as Events);
  return {rows,queries,rounds,catalog,games};
}

test('challenge choices and normalization follow the selected difficulty',()=>{
  for(const level of ['ez','hd','in','at'] as const){
    const advanced=level==='in'||level==='at';
    assert.deepEqual(roundCountChoices(level),level==='at'?[INFINITY_ROUNDS]:advanced?[5,10,20,INFINITY_ROUNDS]:[5,10,20]);
    assert.deepEqual(roundTimeChoices(level),level==='at'?[30]:advanced?[15,30,60]:[30,60,90]);
    assert(GameOptions.safeParse({difficulty:level,rounds:20}).success);
    assert.equal(GameOptions.safeParse({difficulty:level,rounds:INFINITY_ROUNDS}).success,advanced);
  }
  assert.deepEqual(normalizeChallengeSettings('ez',INFINITY_ROUNDS,15),{rounds:5,roundSeconds:30});
  assert.deepEqual(normalizeChallengeSettings('in',3,90),{rounds:5,roundSeconds:30});
  assert.deepEqual(normalizeChallengeSettings('at',20,15),{rounds:INFINITY_ROUNDS,roundSeconds:30});
  const fixed=GameOptions.parse({difficulty:'at',rounds:20,roundSeconds:15,healthCapacity:0,healthEnabled:false});
  assert.equal(fixed.rounds,INFINITY_ROUNDS);assert.equal(fixed.roundSeconds,30);assert.equal(fixed.healthCapacity,20);assert.equal(fixed.healthEnabled,true);
  assert(GuessInput.safeParse({requestId:randomUUID(),round:20,answer:'fixture'}).success);
  assert(NoiseHitInput.safeParse({requestId:randomUUID(),round:20}).success);
  assert(!GuessInput.safeParse({requestId:randomUUID(),round:-1,answer:'fixture'}).success);
});

test('Infinity draws each available song once, while fixed 20 still draws 20',async()=>{
  const {catalog}=fixture(23),all=await catalog.choose('in',INFINITY_ROUNDS),fixed=await catalog.choose('in',20);
  assert.equal(all.length,23);assert.equal(new Set(all.map(a=>a.song_id)).size,23);
  assert.equal(fixed.length,20);assert.equal(new Set(fixed.map(a=>a.song_id)).size,20);
  await assert.rejects(()=>fixture(0).catalog.choose('in',INFINITY_ROUNDS),/Not enough published songs/);
});

test('Infinity accepts answers beyond round 10 and ends when the deck is exhausted',async()=>{
  const {games,rows,rounds,queries}=fixture(23),user={id:randomUUID(),name:'fixture'},realNow=Date.now;
  let now=realNow();Date.now=()=>now;
  try{
    const match=await games.createSolo(user,GameOptions.parse({difficulty:'in',rounds:INFINITY_ROUNDS,roundSeconds:30,healthCapacity:0}));
    assert.equal(match.endless,true);assert.equal(match.totalRounds,23);now=match.startsAt;
    for(let round=0;round<23;round++){
      const current=await games.snapshot(match.id,user.id);assert.equal(current.round,round);assert.equal(current.status,'playing');
      const art=rows.find(a=>a.id===rounds[round]!.artworkId)!;
      const answer=await games.guess(match.id,user.id,GuessInput.parse({requestId:randomUUID(),round,answer:art.title}));assert.equal(answer.correct,true);
      now=(await games.snapshot(match.id,user.id)).nextAt;await games.tick();
    }
    const final=await games.snapshot(match.id,user.id);assert.equal(final.status,'finished');assert.equal(final.round,22);assert.equal(rounds.length,23);
    assert.equal(new Set(rounds.map(r=>rows.find(a=>a.id===r.artworkId)!.song_id)).size,23);
    const saved=queries.find(q=>q.sql.startsWith('INSERT INTO matches'))!;assert.equal(saved.values[4],INFINITY_ROUNDS);
  }finally{Date.now=realNow;await games.onModuleDestroy();}
});

test('Infinity still ends immediately when the existing health rules deplete health',async()=>{
  const {games,rounds}=fixture(23),user={id:randomUUID(),name:'fixture'},realNow=Date.now;
  let now=realNow();Date.now=()=>now;
  try{
    const match=await games.createSolo(user,GameOptions.parse({difficulty:'at',rounds:INFINITY_ROUNDS,roundSeconds:15,healthCapacity:20}));
    let current=match;
    for(let i=0;i<4;i++){
      now=current.deadline;current=await games.snapshot(match.id,user.id);
      if(i<3){assert.equal(current.status,'reveal');now=current.nextAt;current=await games.snapshot(match.id,user.id);}
    }
    assert.equal(current.status,'finished');assert.equal(current.players[0]!.health,0);assert.equal(rounds.length,4);
  }finally{Date.now=realNow;await games.onModuleDestroy();}
});

test('chapter range includes 3 or 4 chapters, contains the answer and survives repeat requests',async()=>{
  const realNow=Date.now;let now=realNow();Date.now=()=>now;
  try{
    for(const chapter of [1,2,5,8,9]){
      const {games,rows}=fixture(1),user={id:randomUUID(),name:'fixture'};rows.forEach(row=>{row.chapter=chapter;});
      try{
        const match=await games.createSolo(user,GameOptions.parse({difficulty:'in',rounds:1,roundSeconds:30,healthCapacity:0}));now=match.startsAt;
        const hint=(await games.hints(match.id,user.id,0,0))[0]!,range=/^第 (\d+) 章-第 (\d+) 章$/.exec(hint.content)!;
        assert(range);const first=Number(range[1]),last=Number(range[2]);
        assert([3,4].includes(last-first+1));assert(first<=chapter&&chapter<=last);assert(first>=1&&last<=9);
        assert.deepEqual(await games.hints(match.id,user.id,0,0),[hint]);
      }finally{await games.onModuleDestroy();}
    }
  }finally{Date.now=realNow;}
});

test('identity hint shows chapter/composer in EZ/HD and composer/illustrator in IN/AT',async()=>{
  const realNow=Date.now;let now=realNow();Date.now=()=>now;
  try{
    for(const difficulty of ['ez','hd','in','at'] as const){
      const {games,rows}=fixture(1),user={id:randomUUID(),name:'fixture'},advanced=difficulty==='in'||difficulty==='at';
      rows.forEach(row=>{row.chapter=advanced?null:5;row.chapter_name='Fixture chapter';row.composer='Fixture Composer';row.illustrator='Fixture Illustrator';});
      try{
        const match=await games.createSolo(user,GameOptions.parse({difficulty,rounds:1,roundSeconds:30,healthCapacity:0}));now=match.startsAt;
        const hint=(await games.hints(match.id,user.id,0,2))[0]!;assert.equal(hint.kind,'identity');
        assert.equal(hint.content,advanced?'曲师：Fixture Composer\n画师：Fixture Illustrator':'第 5 章 · Fixture chapter\n曲师：Fixture Composer');
      }finally{await games.onModuleDestroy();}
    }
  }finally{Date.now=realNow;}
});

test('non-main version ranges contain two or three actual releases including the introduction',()=>{
  for(const introduced of RELEASE_VERSIONS)for(let attempt=0;attempt<12;attempt++){
    const content=nonMainHint('non-main',introduced),range=/^非主线 · v([\d.]+)–v([\d.]+)$/.exec(content)!;
    assert(range);const first=RELEASE_VERSIONS.indexOf(range[1]!),last=RELEASE_VERSIONS.indexOf(range[2]!),position=RELEASE_VERSIONS.indexOf(introduced);
    assert([2,3].includes(last-first+1));assert(first<=position&&position<=last);
  }
  assert.match(nonMainHint('non-main','1.6.4',true),/\n已删除$/);
  assert.equal(nonMainHint('april-fools',null,true),'愚人节曲目/特殊曲绘');
  assert.throws(()=>nonMainHint('non-main','99.0.0'),/metadata unavailable/);
});

test('non-main hints persist their version range; April Fools displays the special artwork label',async()=>{
  const realNow=Date.now;let now=realNow();Date.now=()=>now;
  try{
    for(const kind of ['non-main','april-fools'] as const){
      const {games,rows}=fixture(1),user={id:randomUUID(),name:'fixture'};
      rows.forEach(row=>{row.content_kind=kind;row.introduced_version='1.6.4';row.removed=true;row.composer='Fixture Composer';});
      try{
        const match=await games.createSolo(user,GameOptions.parse({difficulty:'hd',rounds:1,roundSeconds:30,healthCapacity:0}));now=match.startsAt;
        const first=(await games.hints(match.id,user.id,0,0))[0]!;
        if(kind==='april-fools')assert.equal(first.content,'愚人节曲目/特殊曲绘');else assert.match(first.content,/^非主线 · v[\d.]+–v[\d.]+\n已删除$/);
        assert.deepEqual(await games.hints(match.id,user.id,0,0),[first]);
        const identity=(await games.hints(match.id,user.id,0,2)).find(h=>h.index===2)!;
        assert.equal(identity.content,'曲师：Fixture Composer');
      }finally{await games.onModuleDestroy();}
    }
  }finally{Date.now=realNow;}
});

test('artwork scopes filter variants before sampling and AT always uses the full catalog',async()=>{
 const rows=catalogRows(4).filter((_,i)=>i%2===0);
 rows[0]!.content_kind='main';rows[1]!.content_kind='non-main';rows[2]!.content_kind='non-main';rows[2]!.removed=true;rows[3]!.content_kind='april-fools';rows[3]!.removed=true;
 const catalog=new CatalogService({query:async()=>({rows})} as unknown as Db);
 assert.deepEqual((await catalog.choose('in',1,['main'])).map(a=>a.id),[rows[0]!.id]);
 assert.equal((await catalog.choose('in',INFINITY_ROUNDS,['non-main'])).length,1);
 assert.equal((await catalog.choose('in',INFINITY_ROUNDS,['main','removed'])).length,2);
 assert.equal((await catalog.choose('at',INFINITY_ROUNDS,['main'])).length,4);
 assert.equal(GameOptions.safeParse({difficulty:'hd',artworkScopes:['removed']}).success,false);
 assert.equal(GameOptions.parse({difficulty:'at',artworkScopes:['main']}).artworkScopes,undefined);
});
