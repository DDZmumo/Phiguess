import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{Db}=require('../dist/apps/server/src/db.js'),{GamesService}=require('../dist/apps/server/src/games.js');
const db=new Db(),games=new GamesService(db,null,null);
try{
 const row=(await db.query('SELECT g.match_id,g.round,g.user_id FROM guesses g JOIN match_rounds r ON r.match_id=g.match_id AND r.round=g.round JOIN artworks a ON a.id=r.artwork_id WHERE g.correct AND a.original_preview_key IS NOT NULL LIMIT 1')).rows[0];
 assert(row);assert.match(await games.originalImage(row.match_id,row.round,row.user_id),/\.webp$/);
 await assert.rejects(games.originalImage(row.match_id,row.round,'00000000-0000-4000-8000-000000000000'),e=>e.getStatus()===403);
 await assert.rejects(games.originalImage(row.match_id,99,row.user_id),e=>e.getStatus()===403);
 const unsolved=(await db.query('SELECT r.match_id,r.round,p.user_id FROM match_rounds r JOIN match_players p ON p.match_id=r.match_id WHERE NOT EXISTS(SELECT 1 FROM guesses g WHERE g.match_id=r.match_id AND g.round=r.round AND g.user_id=p.user_id AND g.correct) LIMIT 1')).rows[0];
 assert(unsolved);await assert.rejects(games.originalImage(unsolved.match_id,unsolved.round,unsolved.user_id),e=>e.getStatus()===403);
 console.log('Original access: solved allowed; outsider, unsolved and wrong round denied. Read-only verification.');
}finally{await db.close();}
