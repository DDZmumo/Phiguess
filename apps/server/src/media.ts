import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';
import { Db } from './db';
import { configuration } from './config';

@Injectable()
export class MediaService {
  constructor(private readonly db:Db){}
  async uploadAvatar(userId:string,file:{buffer:Buffer}|undefined) {
    if(!file?.buffer?.length)throw new BadRequestException('Choose an avatar image');
    let data:Buffer;
    try {
      const metadata=await sharp(file.buffer,{limitInputPixels:16_000_000}).metadata();
      if(!['png','jpeg','webp'].includes(metadata.format??'')||(metadata.pages??1)>1)throw new Error('Unsupported avatar');
      data=await sharp(file.buffer,{limitInputPixels:16_000_000}).rotate().resize(256,256,{fit:'cover',position:'centre'}).webp({quality:88}).toBuffer();
    }catch {throw new BadRequestException('Avatar must be a valid PNG, JPEG or WebP image');}
    const key=`${randomUUID()}.webp`,directory=configuration().AVATAR_DIR;
    await mkdir(directory,{recursive:true});await writeFile(join(directory,key),data,{flag:'wx'});
    await this.db.query('UPDATE users SET avatar_key=$2 WHERE id=$1',[userId,key]);
    return {avatarUrl:`/api/users/${userId}/avatar?v=${key}`};
  }
  async showcase() {
    return (await this.db.query(`SELECT a.id FROM artworks a JOIN songs s ON s.id=a.song_id
      WHERE a.active AND s.enabled AND a.difficulty='ez' AND a.original_preview_key IS NOT NULL ORDER BY random() LIMIT 12`)).rows.map(r=>({id:r.id,url:`/api/showcase/${r.id}/image`}));
  }
  async stream(kind:'avatar'|'showcase',id:string) {
    const row=kind==='avatar'?(await this.db.query('SELECT avatar_key AS key FROM users WHERE id=$1',[id])).rows[0]
      :(await this.db.query(`SELECT a.original_preview_key AS key FROM artworks a JOIN songs s ON s.id=a.song_id WHERE a.id=$1 AND a.difficulty='ez' AND a.active AND s.enabled`,[id])).rows[0];
    if(!row?.key||!/^[-a-f0-9]{36}\.webp$/.test(row.key))throw new NotFoundException();
    const path=join(kind==='avatar'?configuration().AVATAR_DIR:configuration().ASSET_DIR,row.key);
    try{await stat(path);}catch{throw new NotFoundException();}
    return createReadStream(path);
  }
}
