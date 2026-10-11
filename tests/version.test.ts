import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {APP_VERSION,APP_VERSION_LABEL} from '../packages/contracts/src';

test('release version agrees across packages, lockfile, display and documentation',()=>{
 const json=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
 const root=json('package.json'),lock=json('package-lock.json');
 assert.equal(APP_VERSION,'0.1.1-preview');assert.equal(APP_VERSION_LABEL,'0.1.1 Preview');
 assert.equal(root.version,APP_VERSION);assert.equal(lock.version,APP_VERSION);
 for(const path of ['','apps/server','apps/web','packages/contracts','packages/game-core']){
  assert.equal(json(path?`${path}/package.json`:'package.json').version,APP_VERSION,path);
  assert.equal(lock.packages[path].version,APP_VERSION,path);
 }
 assert.ok(readFileSync('README.md','utf8').includes(APP_VERSION_LABEL));
 assert.ok(readFileSync('docs/API.md','utf8').includes(`version: "${APP_VERSION}"`));
});
