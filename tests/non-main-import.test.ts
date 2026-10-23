import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import sharp from 'sharp';
import {Db} from '../apps/server/src/db';
import {CatalogService} from '../apps/server/src/catalog';
import {GamesService} from '../apps/server/src/games';
import {GeneratedArtworks} from '../apps/server/src/generated-artworks';
import {Events} from '../apps/server/src/events';
import {migrate} from '../tools/migrate';
import {importAssets,Manifest} from '../tools/import-assets';

test('non-main import persists classification and produces usable hints without a chapter',{timeout:30000},async()=>{
  const admin=new Db(),previousUrl=process.env.DATABASE_URL!,schema=`nonmain_${randomUUID().replaceAll('-','')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);const url=new URL(previousUrl);url.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=url.toString();
  const db=new Db(),generated=new GeneratedArtworks(db),games=new GamesService(db,new CatalogService(db),new Events(),generated);
  const realNow=Date.now;let clock=realNow();Date.now=()=>clock;
  try{
    await migrate(db);const folder=resolve(process.env.TEST_ROOT!,'nonmain-fixture');await mkdir(folder,{recursive:true});
    await sharp({create:{width:64,height:36,channels:3,background:'#3475b8'}}).webp({lossless:true}).toFile(join(folder,'ez.webp'));
    const songId=randomUUID(),userId=randomUUID(),manifest={songId,title:'Removed non-main fixture',composer:'Fixture Composer',illustrator:'Fixture Illustrator',version:'non-main-v1',contentKind:'non-main',introducedVersion:'1.6.4',removed:true,original:'ez.webp',assets:{ez:'ez.webp'}};
    assert(!Manifest.safeParse({...manifest,introducedVersion:undefined}).success);
    assert(!Manifest.safeParse({...manifest,introducedVersion:'99.0.0'}).success);
    await db.query('INSERT INTO users(id,name) VALUES($1,$2)',[userId,'Non-main fixture']);
    const file=join(folder,'manifest.json');await writeFile(file,JSON.stringify(manifest));await importAssets(db,file);
    const row=(await db.query("SELECT a.content_kind,a.introduced_version,a.removed,s.chapter FROM artworks a JOIN songs s ON s.id=a.song_id WHERE s.id=$1 AND a.difficulty='hd'",[songId])).rows[0]!;
    assert.deepEqual(row,{content_kind:'non-main',introduced_version:'1.6.4',removed:true,chapter:null});
    const user={id:userId,name:'Non-main fixture'},match=await games.createSolo(user,{difficulty:'hd',rounds:1,roundSeconds:15,healthCapacity:0});clock=match.startsAt;
    const hint=(await games.hints(match.id,userId,0,0))[0]!;assert.match(hint.content,/^非主线 · v[\d.]+–v[\d.]+\n已删除$/);
    assert.deepEqual(await games.hints(match.id,userId,0,0),[hint]);
    assert.equal((await games.hints(match.id,userId,0,2)).find(h=>h.index===2)!.content,'曲师：Fixture Composer');
    await games.returnFromChallenge(match.id,userId);
    await writeFile(file,JSON.stringify({...manifest,contentKind:'april-fools',introducedVersion:undefined,version:'april-v2',variant:'april'}));await importAssets(db,file);
    assert.deepEqual((await db.query("SELECT DISTINCT content_kind FROM artworks WHERE song_id=$1 ORDER BY content_kind",[songId])).rows.map(r=>r.content_kind),['april-fools','non-main']);
    await db.query("UPDATE artworks SET active=false WHERE song_id=$1 AND variant='default'",[songId]);
    const april=await games.createSolo(user,{difficulty:'in',rounds:1,roundSeconds:15,healthCapacity:0});clock=april.startsAt;
    assert.equal((await games.hints(april.id,userId,0,0))[0]!.content,'愚人节曲目');
    assert.equal((await games.hints(april.id,userId,0,2)).find(h=>h.index===2)!.content,'曲师：Fixture Composer\n画师：Fixture Illustrator');
  }finally{
    Date.now=realNow;await games.onModuleDestroy();await generated.onModuleDestroy();await db.close();process.env.DATABASE_URL=previousUrl;await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.close();
  }
});
