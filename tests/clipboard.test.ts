import test from 'node:test';
import assert from 'node:assert/strict';
import {copyText} from '../apps/web/src/clipboard';

test('copy uses the modern clipboard without invoking the selection fallback',async()=>{
 const values:string[]=[];await copyText('ABCDEF',{writeText:async text=>{values.push(text);},copySelection:()=>{throw Error('Unexpected fallback');}});assert.deepEqual(values,['ABCDEF']);
});
test('copy works when the HTTP page has no Clipboard API',async()=>{
 const values:string[]=[];await copyText('ABCDEF',{copySelection:text=>{values.push(text);return true;}});assert.deepEqual(values,['ABCDEF']);
});
test('a denied clipboard write falls back to copying the same text',async()=>{
 let copied='';await copyText('ABCDEF',{writeText:async()=>{throw Error('Permission denied');},copySelection:text=>{copied=text;return true;}});assert.equal(copied,'ABCDEF');
});
test('a synchronously throwing clipboard implementation also uses the fallback',async()=>{
 await copyText('ABCDEF',{writeText:()=>{throw Error('Unavailable');},copySelection:text=>text==='ABCDEF'});
});
test('a refused fallback rejects instead of reporting successful copying',async()=>{
 await assert.rejects(copyText('ABCDEF',{copySelection:()=>false}),/not accepted/);
});
