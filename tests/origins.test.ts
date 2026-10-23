import test from 'node:test';
import assert from 'node:assert/strict';
import {isAllowedOrigin} from '../apps/server/src/origins';
test('preview permits same-port loopback aliases without broadening production origins',()=>{
 const configured='http://localhost:5174';
 for(const origin of ['http://localhost:5174','http://127.0.0.1:5174','http://[::1]:5174'])assert(isAllowedOrigin(origin,configured,'development'));
 for(const origin of ['http://127.0.0.1:5173','https://127.0.0.1:5174','http://evil.test:5174','http://localhost.evil.test:5174','null','http://localhost:5174/path'])assert(!isAllowedOrigin(origin,configured,'development'));
 assert(!isAllowedOrigin('http://127.0.0.1:5174',configured,'production'));
 assert(isAllowedOrigin(configured,configured,'production'));
 assert(!isAllowedOrigin('http://127.0.0.1:5174','http://example.com:5174','development'));
});
