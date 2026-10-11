import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import type { Db, Sql } from '../apps/server/src/db';
import { importAssets } from '../tools/import-assets';

test('lossless WebP sources retain PNG pixels and import with the original lossy resize strategy',async()=>{
  const root=await mkdtemp(join(tmpdir(),'phiguess-lossless-'));
  const oldAssetDir=process.env.ASSET_DIR,oldDatabase=process.env.DATABASE_URL;
  process.env.ASSET_DIR=join(root,'assets');process.env.DATABASE_URL='postgres://unused:unused@localhost/unused';
  try {
    const width=2048,height=7,rgba=Buffer.alloc(width*height*4);
    for(let index=0;index<width*height;index++){
      rgba[index*4]=index%251;rgba[index*4+1]=(index*7)%256;rgba[index*4+2]=(index*31)%256;
      rgba[index*4+3]=index%3===0?0:index%3===1?127:255;
    }
    const png=await sharp(rgba,{raw:{width,height,channels:4}}).png().toBuffer();
    const webp=await sharp(png).webp({lossless:true,effort:6,exact:true}).toBuffer();
    assert.deepEqual(await sharp(webp).ensureAlpha().raw().toBuffer(),rgba);
    await writeFile(join(root,'original.png'),png);await writeFile(join(root,'original.webp'),webp);await writeFile(join(root,'ez.webp'),webp);
    await writeFile(join(root,'trace.svg'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0H16V16H0Z" fill="#ff5500"/></svg>');
    const manifest=join(root,'manifest.json');
    await writeFile(manifest,JSON.stringify({songId:'f9e9cfbf-a28f-42cf-93b2-e81a9b06402c',title:'Lossless fixture',version:'lossless-source-v2',original:'original.webp',assets:{ez:'ez.webp',hd:'trace.svg',in:'trace.svg',at:'trace.svg'}}));
    const statements:{text:string;values:any[]}[]=[],artworks:any[][]=[];
    let published=false;
    const sql:Sql={async query(text,values=[]){
      statements.push({text,values});
      if(text.startsWith('SELECT id FROM artworks'))return {rows:published?[{id:'published'}]:[]} as any;
      if(text.startsWith('INSERT INTO artworks'))artworks.push(values);
      return {rows:[]};
    }};
    const db={transaction:async(fn:(sql:Sql)=>Promise<unknown>)=>fn(sql)} as Db;
    await mkdir(process.env.ASSET_DIR,{recursive:true});
    await writeFile(join(process.env.ASSET_DIR,'prior-version.webp'),webp);
    await importAssets(db,manifest);
    const ez=artworks.find(row=>row[3]==='ez')!;
    assert.ok(ez);assert.notEqual(ez[8],ez[9]);
    // WebP was already accepted by the old importer. Lock its four established
    // size/quality settings while the new source container stays pixel-exact.
    const expectedEz=await sharp(webp,{limitInputPixels:16_000_000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer();
    const expectedOriginal=await sharp(webp,{limitInputPixels:16_000_000}).rotate().resize({width:1920,height:1920,fit:'inside',withoutEnlargement:true}).webp({quality:92}).toBuffer();
    assert.ok((await readFile(join(process.env.ASSET_DIR,ez[4]))).equals(expectedEz),'EZ keeps 1600 / quality 88');
    assert.ok((await readFile(join(process.env.ASSET_DIR,ez[8]))).equals(expectedOriginal),'Original keeps 1920 / quality 92');
    assert.equal((await sharp(expectedEz).metadata()).width,1600);
    assert.equal((await sharp(expectedOriginal).metadata()).width,1920);
    const expectedOriginalPreview=await sharp(expectedOriginal).resize({width:1280,height:880,fit:'inside',withoutEnlargement:true}).webp({quality:80}).toBuffer();
    assert.ok((await readFile(join(process.env.ASSET_DIR,ez[9]))).equals(expectedOriginalPreview),'Original preview keeps 1280x880 / quality 80');
    assert.equal((await sharp(expectedOriginalPreview).metadata()).width,1280);
    const previewKey=statements.find(statement=>statement.text.startsWith('UPDATE artworks SET preview_key'))!.values[1];
    const expectedEzPreview=await sharp(expectedEz).resize({width:960,height:660,fit:'inside',withoutEnlargement:true}).webp({quality:72}).toBuffer();
    assert.ok((await readFile(join(process.env.ASSET_DIR,previewKey))).equals(expectedEzPreview),'EZ preview keeps 960x660 / quality 72');
    assert.equal((await sharp(expectedEzPreview).metadata()).width,960);
    for(const output of [expectedEz,expectedOriginal,expectedEzPreview,expectedOriginalPreview])assert.ok(output.includes(Buffer.from('VP8 ')),'Runtime output uses lossy WebP');
    assert.deepEqual(await readFile(join(root,'original.png')),png);
    assert.deepEqual(await readFile(join(root,'original.webp')),webp);
    assert.deepEqual(await readFile(join(process.env.ASSET_DIR,'prior-version.webp')),webp);
    const files=await readdir(process.env.ASSET_DIR);published=true;
    await assert.rejects(()=>importAssets(db,manifest),/already published/);
    assert.deepEqual(await readdir(process.env.ASSET_DIR),files);
  }finally{
    if(oldAssetDir===undefined)delete process.env.ASSET_DIR;else process.env.ASSET_DIR=oldAssetDir;
    if(oldDatabase===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldDatabase;
    if(resolve(root).startsWith(resolve(tmpdir())+'\\')||resolve(root).startsWith(resolve(tmpdir())+'/'))await rm(root,{recursive:true,force:true});
  }
});
