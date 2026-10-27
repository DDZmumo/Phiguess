import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

function fixture(){
 const location={hash:'#/play/old-match'},notices:unknown[]=[],state={session:{token:'same-player'},roomCode:'ABCDEF' as string|null,matchId:'old-match' as string|null,roomEpoch:1,setRoom(code:string|null){if(this.roomCode!==code)this.roomEpoch++;this.roomCode=code;},setMatch(id:string|null){this.matchId=id;},setSession(){this.session.token='signed-out';}};
 const modules=new Map<string,any>(),window={dispatchEvent:(event:unknown)=>notices.push(event)},sessionStorage={getItem:()=>null,removeItem:()=>{},setItem:()=>{}};
 let respond!:(value:any)=>void;
 const fetch=()=>new Promise(resolve=>{respond=resolve;});
 function load(name:string){if(modules.has(name))return modules.get(name);if(name==='store')return {useStore:{getState:()=>state}};const module={exports:{}};modules.set(name,module.exports);const code=ts.transpileModule(readFileSync(`apps/web/src/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;runInNewContext(code,{module,exports:module.exports,require:(path:string)=>load(path.replace('./','')),location,window,sessionStorage,fetch,CustomEvent:class {constructor(public type:string,public detail:unknown){}}});return module.exports;}
 return {state,location,notices,load,respond:()=>respond({ok:false,status:410,json:async()=>({code:'ROOM_LOADING_REMOVED',reason:'loading-timeout',matchId:'old-match',roomCode:'ABCDEF'})})};
}

test('a delayed loading removal cannot remove a later membership in the same room',async()=>{
 const f=fixture(),pending=f.load('api').api('matches/old-match/ready','POST');
 f.state.setMatch(null);f.state.setRoom(null);f.state.setRoom('ABCDEF');f.state.setMatch('new-match');f.location.hash='#/play/new-match';
 f.respond();await assert.rejects(pending);assert.equal(f.state.roomCode,'ABCDEF');assert.equal(f.state.matchId,'new-match');assert.equal(f.location.hash,'#/play/new-match');assert.equal(f.notices.length,0);
});
test('a delayed removal cannot clear a newly joined lobby even before its next match starts',async()=>{
 const f=fixture(),pending=f.load('api').api('matches/old-match');f.state.setMatch(null);f.state.setRoom(null);f.state.setRoom('ABCDEF');f.location.hash='#/room/ABCDEF';f.respond();await assert.rejects(pending);assert.equal(f.state.roomCode,'ABCDEF');assert.equal(f.location.hash,'#/room/ABCDEF');assert.equal(f.notices.length,0);
});
test('a current loading removal still clears membership, returns home and shows its notice once',async()=>{
 const f=fixture(),pending=f.load('api').api('matches/old-match');f.respond();await assert.rejects(pending);assert.equal(f.state.roomCode,null);assert.equal(f.state.matchId,null);assert.equal(f.location.hash,'/account');assert.equal(f.notices.length,1);f.load('room-removal').returnAfterRoomRemoval('loading-timeout','old-match','ABCDEF',1);assert.equal(f.notices.length,1);
});
test('an old match notice never redirects a player already playing another match',()=>{
 const f=fixture();f.state.matchId='new-match';f.location.hash='#/play/new-match';f.load('room-removal').returnAfterRoomRemoval('loading-timeout','old-match','ABCDEF');assert.equal(f.state.roomCode,'ABCDEF');assert.equal(f.location.hash,'#/play/new-match');
});
