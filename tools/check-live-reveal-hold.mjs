import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{Db}=require('../dist/apps/server/src/db.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const base='http://127.0.0.1:3000/api/';let token;
async function api(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(`${path}: ${r.status}`);return r.json();}
for(let i=0;i<60;i++){try{await api('health/ready');break;}catch{await sleep(500);}}
const guest=await api('auth/guest',{name:'停留时间验证'});token=guest.token;
const db=new Db();
try{for(const mode of ['correct','timeout']){
 const match=await api('matches/practice',{difficulty:'ez',rounds:1,roundSeconds:15});
 await sleep(Math.max(0,match.startsAt-Date.now()+80));
 if(mode==='correct'){
 const row=(await db.query('SELECT a.song_id FROM match_rounds r JOIN artworks a ON a.id=r.artwork_id WHERE r.match_id=$1 AND r.round=0',[match.id])).rows[0];
 await api(`matches/${match.id}/guesses`,{requestId:crypto.randomUUID(),round:0,songId:row.song_id});
 }else await sleep(Math.max(0,match.deadline-Date.now()+50));
 const first=await api(`matches/${match.id}`);assert.equal(first.status,'reveal');
 const remaining=first.nextAt-first.serverNow;assert(remaining>1700&&remaining<=2000,`${mode}: ${remaining}`);
 await sleep(1200);const held=await api(`matches/${match.id}`);assert.equal(held.status,'reveal');
 await sleep(Math.max(0,first.nextAt-Date.now()+80));const final=await api(`matches/${match.id}`);assert.equal(final.status,'finished');
 console.log(JSON.stringify({mode,remainingMs:remaining,stillRevealAfter1200ms:true,finishedAfter2000ms:true}));
}}finally{await db.close();}

