import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {Db} from '../apps/server/src/db';
import {LibraryService} from '../apps/server/src/library';
import {configuration} from '../apps/server/src/config';
import {migrate} from '../tools/migrate';
import {importAssets} from '../tools/import-assets';
import {applyAliasSnapshot} from '../tools/sync-aliases';
import {mergedAliases,parseAliasMap} from '../tools/alias-data';
import {libraryDate} from '../apps/web/src/library/date';

test('alias source preserves numeric strings and rejects structured values',()=>{
 const map=parseAliasMap('song:\n  - 7\n  - 007\n  - true\n  - nickname\n');assert.deepEqual(map.song,['7','007','true','nickname']);
 assert.deepEqual(mergedAliases({songId:'s',providerId:'song',title:' Title ',sourceTitles:['Title','filename']},map,{song:[' local ','7']}),['Title','filename','7','007','true','nickname','local']);
 assert.throws(()=>parseAliasMap('song:\n  - {nested: value}\n'),/Invalid aliases/);
});
test('library dates have fixed YYYY/MM/DD format in Shanghai',()=>{
 assert.equal(libraryDate('2026-10-19T11:24:15Z'),'2026/10/19');assert.equal(libraryDate('2026-10-19T23:30:00Z'),'2026/10/20');assert.equal(libraryDate(null),'—');
});
test('library deduplicates alternate illustrations and reflects applied aliases',async()=>{
 const db=new Db(),id=randomUUID(),directory=resolve(process.env.TEST_ROOT!,'library-fixture');
 try{
  await migrate(db);await mkdir(directory,{recursive:true});await sharp({create:{width:24,height:16,channels:3,background:'#325878'}}).webp().toFile(resolve(directory,'source.webp'));
  for(const variant of ['illustration-at','illustration-in']){const file=resolve(directory,variant+'.json');await writeFile(file,JSON.stringify({songId:id,title:'Library fixture',aliases:[' old '],chapter:7,chapterName:'Library fixture chapter',composer:'Composer',illustrator:'Artist',variant,version:'library-fixture',original:'source.webp',hints:['one','two','three'],assets:{ez:'source.webp'}}));await importAssets(db,file);}
  const plain=randomUUID();await db.query('INSERT INTO songs(id,title,aliases) VALUES($1,$2,$3)',[plain,'Without artwork',JSON.stringify(['Without artwork','nickname'])]);
  const service=new LibraryService(db),before=await service.catalog();assert.equal(before.songs.filter(song=>song.id===id).length,1);const row=before.songs.find(song=>song.id===id)!;assert.match(row.image!,/^\/api\/showcase\//);assert.equal(row.chapter,'Library fixture chapter');assert.equal(before.songs.find(song=>song.id===plain)?.image,null);
  const result=await applyAliasSnapshot(db,{raw:'provider:\n  - 7\n  - latest alias\n',commit:'1'.repeat(40),sourceUpdatedAt:'2026-10-19T11:24:15Z'},[{songId:id,providerId:'provider',title:'Library fixture'}],{snapshotRoot:resolve(directory,'snapshots')});assert.equal(result.updated,1);
  const after=await service.catalog();assert.deepEqual(after.songs.find(song=>song.id===id)?.aliases,['7','latest alias']);assert.equal(after.updatedAt,'2026-10-19T11:24:15.000Z');assert.ok(after.chapters.some(chapter=>chapter.id==='Library fixture chapter'&&chapter.count===1));
 }finally{await db.close();}
});
