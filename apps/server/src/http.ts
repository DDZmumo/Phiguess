import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res, ServiceUnavailableException, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Response } from 'express';
import { z } from 'zod';
import { GameOptions, GuestInput, LoginInput, GuessInput, InfinityLeaderboardOptions, NoiseHitInput, ReadyInput, ResultPublicationInput, RoomCode, RoomOptions, RoomPlayerInput, RoundIndex, UUID } from '../../../packages/contracts/src';
import { AuthGuard, AuthRequest, AuthService } from './auth';
import { CatalogService } from './catalog';
import {APP_VERSION} from '../../../packages/contracts/src';
import { configuration } from './config';
import { Db } from './db';
import { GamesService } from './games';
import { RoomsService } from './rooms';
import { MediaService } from './media';
import {GeneratedArtworks} from './generated-artworks';
import {LibraryService} from './library';

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.issues.map(e=>({path:e.path,message:e.message})));
  return result.data;
}
@Controller('api')
export class PublicController {
  constructor(private readonly db: Db, private readonly auth: AuthService, private readonly catalog: CatalogService, private readonly games: GamesService, private readonly media:MediaService,private readonly generated:GeneratedArtworks=new GeneratedArtworks(db),private readonly library:LibraryService=new LibraryService(db)) {}
  @Get('library') async aliasLibrary(@Res({passthrough:true}) res:Response){res.setHeader('Cache-Control','no-store');return this.library.catalog();}
  @Get('tutorial-art/:slug/:difficulty') async tutorialArt(@Param('slug') slug:string,@Param('difficulty') difficulty:string,@Res({passthrough:true}) res:Response){
    const name=parse(z.enum(['ds','mirage','chaos','8000']),slug),level=parse(z.enum(['hd','in','at']),difficulty);
    const body=await this.generated.tutorial(name,level);res.setHeader('Cache-Control','public, max-age=3600');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'none'; sandbox");
    return new StreamableFile(body,{type:'image/svg+xml'});
  }
  @Get('health/live') live() { return { status:'ok',service:'phiguess',version:APP_VERSION }; }
  @Get('health/ready') async ready() {
    try { await this.db.query('SELECT 1 FROM matches LIMIT 1'); return {status:'ok'}; }
    catch { throw new ServiceUnavailableException('Database unavailable or migrations missing'); }
  }
  @Post('auth/guest') guest(@Body() body: unknown) { return this.auth.createGuest(parse(GuestInput,body).name); }
  @Post('auth/login') login(@Body() body:unknown){const input=parse(LoginInput,body);return this.auth.login(input.name,input.password);}
  @Get('songs') songs(@Query('q') q: unknown) { return this.catalog.search(parse(z.string().max(100).default(''),q)); }
  @Get('showcase') showcase() {return this.media.showcase();}
  @Get('showcase/:id/image') async cover(@Param('id') id:string,@Res({passthrough:true}) res:Response) {
    const stream=await this.media.stream('showcase',parse(UUID,id));res.setHeader('Cache-Control','public, max-age=86400');return new StreamableFile(stream,{type:'image/webp'});
  }
  @Get('users/:id/avatar') async avatar(@Param('id') id:string,@Res({passthrough:true}) res:Response) {
    const stream=await this.media.stream('avatar',parse(UUID,id));res.setHeader('Cache-Control','public, max-age=86400');return new StreamableFile(stream,{type:'image/webp'});
  }
  @Get('leaderboards') leaderboard(@Query() query:Record<string,unknown>) {
    return this.games.leaderboard(parse(InfinityLeaderboardOptions,query));
  }
}
@Controller('api')
@UseGuards(AuthGuard)
export class GameController {
  constructor(private readonly auth: AuthService, private readonly games: GamesService, private readonly rooms: RoomsService, private readonly db: Db, private readonly media:MediaService) {}
  @Get('me') me(@Req() req: AuthRequest) { return req.user; }
  @Get('me/active') async active(@Req() req:AuthRequest){return {match:await this.games.active(req.user.id)};}
  @Post('me/name') name(@Req() req: AuthRequest,@Body() body:unknown) {return this.auth.rename(req.user.id,parse(GuestInput,body).name);}
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('avatar',{limits:{fileSize:3*1024*1024,files:1,fields:0}}))
  uploadAvatar(@Req() req:AuthRequest,@UploadedFile() file:{buffer:Buffer}|undefined){return this.media.uploadAvatar(req.user.id,file);}
  @Post('auth/logout') async logout(@Req() req: AuthRequest) { await this.auth.logout(req.headers.authorization!.slice(7)); return {ok:true}; }
  @Get('me/history') async history(@Req() req: AuthRequest) {
    return (await this.db.query('SELECT m.id,m.mode,m.difficulty,m.status,m.created_at,p.score,p.correct FROM match_players p JOIN matches m ON m.id=p.match_id WHERE p.user_id=$1 ORDER BY m.created_at DESC LIMIT 50',[req.user.id])).rows;
  }
  @Post('matches/practice') practice(@Req() req: AuthRequest,@Body() body: unknown) { return this.games.createSolo(req.user,parse(GameOptions,body),req.headers['x-artwork-ready']==='1'); }
  @Post('matches/:id/ready') matchReady(@Req() req:AuthRequest,@Param('id') id:string){return this.games.ready(parse(UUID,id),req.user.id);}
  @Post('matches/:id/force-start') forceStart(@Req() req:AuthRequest,@Param('id') id:string){return this.games.forceStartLoading(parse(UUID,id),req.user.id);}
  @Get('matches/:id') snapshot(@Req() req: AuthRequest,@Param('id') id: string) { return this.games.snapshot(parse(UUID,id),req.user.id); }
  @Get('matches/:id/rounds/:round/preload')
  async preloadImage(@Req() req:AuthRequest,@Res({passthrough:true}) res:Response,@Param('id') id:string,@Param('round') round:string){
    const image=await this.games.preloadImage(parse(UUID,id),parse(RoundIndex,Number(round)),req.user.id);
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Artwork-Mime',image.mime);
    return new StreamableFile(image.body,{type:'application/octet-stream'});
  }
  @Get('matches/:id/result') result(@Req() req: AuthRequest,@Param('id') id: string) { return this.games.result(parse(UUID,id),req.user.id); }
  @Post('matches/:id/publication') publication(@Req() req:AuthRequest,@Param('id') id:string,@Body() body:unknown){return this.games.setResultPublication(parse(UUID,id),req.user.id,parse(ResultPublicationInput,body).published);}
  @Get('matches/:id/rounds/:round/result-reveal') async revealResult(@Req() req:AuthRequest,@Param('id') id:string,@Param('round') round:string){
    const matchId=parse(UUID,id),index=parse(RoundIndex,Number(round)),original=await this.games.revealResultArtwork(matchId,index,req.user.id);
    return {title:original.title,imageUrl:`/api/matches/${matchId}/rounds/${index}/result-original`};
  }
  @Get('matches/:id/rounds/:round/result-original') async resultOriginal(@Req() req:AuthRequest,@Res({passthrough:true}) res:Response,@Param('id') id:string,@Param('round') round:string){
    const original=await this.games.revealResultArtwork(parse(UUID,id),parse(RoundIndex,Number(round)),req.user.id);
    if(!/^[a-f0-9-]{36}\.webp$/.test(original.key))throw new ServiceUnavailableException('Invalid asset key');
    const path=join(configuration().ASSET_DIR,original.key);try{await stat(path);}catch{throw new ServiceUnavailableException('Artwork file missing');}
    res.setHeader('Cache-Control','private, no-store');return new StreamableFile(createReadStream(path),{type:'image/webp'});
  }
  @Get('matches/:id/rounds/:round/result-image') async resultImage(@Req() req:AuthRequest,@Res({passthrough:true}) res:Response,@Param('id') id:string,@Param('round') round:string){
    const image=await this.games.resultImage(parse(UUID,id),parse(RoundIndex,Number(round)),req.user.id);
    if(image.body){res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'none'; sandbox");return new StreamableFile(image.body,{type:image.mime});}
    if(!/^[a-f0-9-]{36}\.(svg|webp)$/.test(image.key))throw new ServiceUnavailableException('Invalid asset key');
    const path=join(configuration().ASSET_DIR,image.key);try{await stat(path);}catch{throw new ServiceUnavailableException('Artwork file missing');}
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'none'; sandbox");
    return new StreamableFile(createReadStream(path),{type:image.mime});
  }
  @Post('matches/:id/guesses') guess(@Req() req: AuthRequest,@Param('id') id: string,@Body() body: unknown) { return this.games.guess(parse(UUID,id),req.user.id,parse(GuessInput,body)); }
  @Post('matches/:id/return') returnFromChallenge(@Req() req:AuthRequest,@Param('id') id:string){return this.games.returnFromChallenge(parse(UUID,id),req.user.id);}
  @Post('matches/:id/skip') skip(@Req() req:AuthRequest,@Param('id') id:string,@Body() body:unknown){return this.games.skipRound(parse(UUID,id),req.user.id,parse(z.object({round:RoundIndex}).strict(),body).round);}
  @Post('matches/:id/noise-hits') noiseHit(@Req() req:AuthRequest,@Param('id') id:string,@Body() body:unknown){return this.games.noiseHit(parse(UUID,id),req.user.id,parse(NoiseHitInput,body));}
  @Get('matches/:id/progress') progress(@Req() req: AuthRequest,@Param('id') id: string) { return this.games.progress(parse(UUID,id),req.user.id); }
  @Get('matches/:id/rounds/:round/hints') hints(@Req() req: AuthRequest,@Param('id') id: string,@Param('round') round: string) { return this.games.hints(parse(UUID,id),req.user.id,parse(RoundIndex,Number(round))); }
  @Post('matches/:id/rounds/:round/hints/:index') hint(@Req() req: AuthRequest,@Param('id') id: string,@Param('round') round: string,@Param('index') index: string) { return this.games.hints(parse(UUID,id),req.user.id,parse(RoundIndex,Number(round)),parse(z.coerce.number().int().min(0).max(2),index)); }
  @Get('matches/:id/rounds/:round/original') async original(@Req() req: AuthRequest,@Res({passthrough:true}) res: Response,@Param('id') id: string,@Param('round') round: string) {
    const key=await this.games.originalImage(parse(UUID,id),parse(RoundIndex,Number(round)),req.user.id);
    if(!/^[a-f0-9-]{36}\.webp$/.test(key))throw new ServiceUnavailableException('Invalid asset key');
    const path=join(configuration().ASSET_DIR,key);
    try{await stat(path);}catch{throw new ServiceUnavailableException('Artwork file missing');}
    res.setHeader('Cache-Control','private, no-store');
    return new StreamableFile(createReadStream(path),{type:'image/webp'});
  }
  @Get('matches/:id/rounds/:round/image') async image(@Req() req: AuthRequest,@Res({passthrough:true}) res: Response,@Param('id') id: string,@Param('round') round: string) {
    const art = await this.games.image(parse(UUID,id),parse(RoundIndex,Number(round)),req.user.id);
    if(art.body){res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'none'; sandbox");return new StreamableFile(art.body,{type:art.mime});}
    if (!/^[a-f0-9-]+\.(svg|webp)$/.test(art.storage_key)) throw new ServiceUnavailableException('Invalid asset key');
    const path = join(configuration().ASSET_DIR,art.storage_key);
    try { await stat(path); } catch { throw new ServiceUnavailableException('Artwork file missing'); }
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'none'; sandbox");
    return new StreamableFile(createReadStream(path),{type:art.mime});
  }
  @Post('rooms') createRoom(@Req() req: AuthRequest,@Body() body: unknown) { return this.rooms.create(req.user,parse(RoomOptions,body)); }
  @Post('rooms/:code/join') join(@Req() req: AuthRequest,@Param('code') code: string) { return this.rooms.join(parse(RoomCode,code),req.user); }
  @Get('rooms/:code') room(@Req() req: AuthRequest,@Param('code') code: string) { return this.rooms.snapshot(parse(RoomCode,code),req.user.id); }
  @Get('rooms/:code/performances') roomPerformances(@Req() req:AuthRequest,@Param('code') code:string){return this.rooms.performances(parse(RoomCode,code),req.user.id);}
  @Post('rooms/:code/ready') ready(@Req() req: AuthRequest,@Param('code') code: string,@Body() body: unknown) { return this.rooms.ready(parse(RoomCode,code),req.user.id,parse(ReadyInput,body).ready); }
  @Post('rooms/:code/options') roomOptions(@Req() req: AuthRequest,@Param('code') code: string,@Body() body: unknown) { return this.rooms.configure(parse(RoomCode,code),req.user.id,parse(RoomOptions,body)); }
  @Post('rooms/:code/start') start(@Req() req: AuthRequest,@Param('code') code: string) { return this.rooms.start(parse(RoomCode,code),req.user.id,req.headers['x-artwork-ready']==='1'); }
  @Post('rooms/:code/leave') leave(@Req() req: AuthRequest,@Param('code') code: string) { return this.rooms.leave(parse(RoomCode,code),req.user.id); }
  @Post('rooms/:code/kick') kick(@Req() req:AuthRequest,@Param('code') code:string,@Body() body:unknown){return this.rooms.kick(parse(RoomCode,code),req.user.id,parse(RoomPlayerInput,body).userId);}
  @Post('rooms/:code/transfer-host') transferHost(@Req() req:AuthRequest,@Param('code') code:string,@Body() body:unknown){return this.rooms.transferHost(parse(RoomCode,code),req.user.id,parse(RoomPlayerInput,body).userId);}
}
