import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { configuration } from './config';
import type { GameOptions, GuessInput, InfinityLeaderboardOptions, MatchView, NoiseHitInput, ResultRoundView } from '../../../packages/contracts/src';
import { correctHealthGain, INFINITY_ROUNDS, resolveHealthCapacity, timeoutHealthCost, RULES_VERSION } from '../../../packages/contracts/src';
import { scoreAnswer, SerialQueue } from '../../../packages/game-core/src';
import type { User } from './auth';
import { Artwork, CatalogService } from './catalog';
import { Db } from './db';
import { Events } from './events';
import {withReferencePlayer,type LeaderboardEntry} from './leaderboard-reference';
const compressArtwork=promisify(gzip);

interface Match {
  id: string; mode: MatchView['mode']; options: GameOptions; artworks: Artwork[];
  users: User[]; scores: Map<string, number>; answered: Set<string>;
  health:Map<string,number>; wrongAttempts:Map<string,number>;
  round: number; startsAt: number; deadline: number; nextAt: number;
  status: MatchView['status']; touchedAt: number; returnBlocked?:boolean; returnBlockedAt?:number;
  preloadedImage?: {round:number;key:Buffer;mime:string;body:Promise<Buffer>};
  currentImageKey?: Buffer;
}
@Injectable()
export class GamesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GamesService.name);
  private readonly matches = new Map<string, Match>();
  private readonly queue = new SerialQueue();
  private timer?: NodeJS.Timeout;
  private ticking = false;
  constructor(private readonly db: Db, private readonly catalog: CatalogService, private readonly events: Events) {}
  async onModuleInit() {
    // This application is deliberately single-instance. Never run two replicas.
    await this.db.query("UPDATE matches SET status='interrupted',finished_at=now() WHERE status='active'");
    this.timer = setInterval(() => {
      if (this.ticking) return;
      this.ticking = true;
      void this.tick().catch(e => this.logger.error('Game tick failed', e instanceof Error ? e.stack : undefined)).finally(() => { this.ticking = false; });
    }, 250);
    this.timer.unref();
  }
  async onModuleDestroy() { if (this.timer) clearInterval(this.timer); await this.queue.run(async () => undefined); }
  async createSolo(user: User, options: GameOptions) {
    return this.queue.run(async () => {
      const active = [...this.matches.values()].find(m => ['playing','reveal'].includes(m.status) && m.users.some(u => u.id === user.id));
      if (active) throw new ConflictException({ message: 'Already in an active match', matchId: active.id });
      return this.view(await this.create('practice',[user],options,await this.catalog.choose(options.difficulty,options.rounds)));
    });
  }
  async createRoom(users: User[], options: GameOptions) {
    return this.queue.run(async () => {
      if ([...this.matches.values()].some(m => ['playing','reveal'].includes(m.status) && users.some(u => m.users.some(p => p.id === u.id)))) throw new ConflictException('A player is already in an active match');
      return this.view(await this.create('room', users, options, await this.catalog.choose(options.difficulty, options.rounds)));
    });
  }
  private async create(mode: MatchView['mode'], users: User[], options: GameOptions, artworks: Artwork[]) {
    const capacity=options.difficulty==='in'&&options.rounds===INFINITY_ROUNDS?(options.healthCapacity===50?50:20):resolveHealthCapacity(options.difficulty,options.healthCapacity,options.healthEnabled);
    options={...options,healthEnabled:capacity>0,healthCapacity:capacity};
    if ([...this.matches.values()].filter(m => ['playing','reveal'].includes(m.status)).length >= 100) throw new ServiceUnavailableException('Active match limit reached');
    const startsAt = Date.now() + 3000;
    const m: Match = { id: randomUUID(), mode, options, artworks, users, scores: new Map(users.map(u => [u.id,0])), answered: new Set(), round: 0,
      health:new Map(users.map(u=>[u.id,capacity])),wrongAttempts:new Map(),
      startsAt, deadline: startsAt + options.roundSeconds * 1000, nextAt: 0, status: 'playing', touchedAt: Date.now() };
    await this.db.transaction(async sql => {
      await sql.query("INSERT INTO matches(id,mode,difficulty,status,rules_version,round_count,round_seconds,health_enabled,health_capacity) VALUES($1,$2,$3,'active',$4,$5,$6,$7,$8)",[m.id,mode,options.difficulty,RULES_VERSION,options.rounds,options.roundSeconds,options.healthEnabled,capacity]);
      for (const user of users) {
        await sql.query('INSERT INTO match_players(match_id,user_id,health) VALUES($1,$2,$3)', [m.id,user.id,capacity]);
      }
      await sql.query('INSERT INTO match_rounds(match_id,round,artwork_id,starts_at,deadline) VALUES($1,0,$2,$3,$4)', [m.id,artworks[0]!.id,new Date(m.startsAt),new Date(m.deadline)]);
    });
    this.matches.set(m.id,m);
    return m;
  }
  private require(id: string, userId: string) {
    const m = this.matches.get(id);
    if (!m) throw new NotFoundException('Match not in memory; query saved result');
    if (!m.users.some(u => u.id === userId)) throw new ForbiddenException();
    return m;
  }
  private async restoreFinished(id:string,userId:string) {
    if(this.matches.has(id))return;
    const saved=(await this.db.query(`SELECT m.* FROM matches m JOIN match_players p ON p.match_id=m.id
      WHERE m.id=$1 AND p.user_id=$2 AND m.status IN ('finished','interrupted') AND m.mode IN ('practice','room')`,[id,userId])).rows[0];
    if(!saved)throw new NotFoundException('Match not available');
    const rounds=(await this.db.query(`SELECT a.*,s.title,s.aliases,s.hints,s.chapter,s.chapter_name,s.composer,r.round,r.starts_at,r.deadline
      FROM match_rounds r JOIN artworks a ON a.id=r.artwork_id JOIN songs s ON s.id=a.song_id
      WHERE r.match_id=$1 ORDER BY r.round`,[id])).rows;
    const last=rounds.at(-1);if(!last)throw new NotFoundException('Match has no rounds');
    const players=(await this.db.query(`SELECT u.id,u.name,u.avatar_key,p.score,p.health FROM match_players p JOIN users u ON u.id=p.user_id WHERE p.match_id=$1`,[id])).rows;
    const correct=(await this.db.query('SELECT DISTINCT user_id FROM guesses WHERE match_id=$1 AND round=$2 AND correct',[id,last.round])).rows;
    this.matches.set(id,{id,mode:saved.mode,status:'finished',options:{difficulty:saved.difficulty,rounds:saved.round_count??rounds.length,roundSeconds:saved.round_seconds??30,healthEnabled:saved.health_capacity>0,healthCapacity:saved.health_capacity},
      artworks:rounds as Artwork[],users:players.map(p=>({id:p.id,name:p.name,avatarUrl:p.avatar_key?`/api/users/${p.id}/avatar`:null})),
      scores:new Map(players.map(p=>[p.id,p.score])),health:new Map(players.map(p=>[p.id,p.health])),wrongAttempts:new Map(),answered:new Set(correct.map(p=>p.user_id)),round:last.round,
      startsAt:new Date(last.starts_at).getTime(),deadline:new Date(last.deadline).getTime(),nextAt:new Date(last.deadline).getTime()+2000,touchedAt:Date.now()});
  }
  snapshot(id: string, userId: string) {
    return this.queue.run(async () => { await this.restoreFinished(id,userId);const m = this.require(id,userId); await this.advance(m,Date.now()); return this.view(m); });
  }
  async originalImage(id: string, round: number, userId: string) {
    const row=(await this.db.query(`SELECT a.original_preview_key AS key FROM match_rounds r
      JOIN artworks a ON a.id=r.artwork_id JOIN match_players p ON p.match_id=r.match_id AND p.user_id=$3
      WHERE r.match_id=$1 AND r.round=$2 AND EXISTS
      (SELECT 1 FROM guesses g WHERE g.match_id=r.match_id AND g.round=r.round AND g.user_id=$3 AND g.correct)`,[id,round,userId])).rows[0];
    if(!row?.key)throw new ForbiddenException('Original artwork is not available');
    return row.key as string;
  }
  image(id: string, round: number, userId: string) {
    return this.queue.run(async () => {
      await this.restoreFinished(id,userId);
      const m = this.require(id,userId); await this.advance(m,Date.now());
      if (m.round !== round || Date.now() < m.startsAt) throw new ForbiddenException('Image is not available for this round');
      const hint=(await this.db.query('SELECT artwork_id FROM revealed_hints WHERE match_id=$1 AND round=$2 AND user_id=$3 AND hint_index=1',[id,round,userId])).rows[0];
      if(hint?.artwork_id)return (await this.db.query<Artwork>('SELECT * FROM artworks WHERE id=$1',[hint.artwork_id])).rows[0]!;
      return m.artworks[round]!;
    });
  }
  async preloadImage(id:string,round:number,userId:string) {
    const preload=await this.queue.run(async()=>{
      const m=this.require(id,userId);await this.advance(m,Date.now());
      if(!['playing','reveal'].includes(m.status)||Date.now()<m.startsAt||round!==m.round+1||round>=m.artworks.length)
        throw new ForbiddenException('Only the next artwork can be preloaded');
      if(!m.preloadedImage){
        const art=m.artworks[round]!;
        if(!/^[a-f0-9-]{36}\.(svg|webp)$/.test(art.storage_key))throw new ServiceUnavailableException('Invalid asset key');
        const key=randomBytes(32),nonce=randomBytes(12);
        const body=readFile(join(configuration().ASSET_DIR,art.storage_key)).then(bytes=>compressArtwork(bytes)).then(bytes=>{
          const cipher=createCipheriv('aes-256-gcm',key,nonce);
          return Buffer.concat([nonce,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);
        });
        // Disk I/O and encryption must not hold the shared game mutation queue.
        void body.catch(()=>{});
        m.preloadedImage={round,key,mime:art.mime,body};
      }
      return m.preloadedImage;
    });
    try{return {body:await preload.body,mime:preload.mime};}
    catch{await this.queue.run(async()=>{const m=this.matches.get(id);if(m?.preloadedImage===preload)m.preloadedImage=undefined;});throw new ServiceUnavailableException('Artwork file unavailable');}
  }
  guess(id: string, userId: string, input: GuessInput) {
    const receivedAt = Date.now();
    return this.queue.run(async () => {
      const m = this.require(id,userId);
      // A retry returns its original outcome, even after the round has advanced.
      const old = (await this.db.query('SELECT match_id,round,song_id,answer_text,correct,score,elapsed_ms FROM guesses WHERE user_id=$1 AND request_id=$2', [userId,input.requestId])).rows[0];
      if (old) {
        if (old.match_id !== id || old.round !== input.round || (input.answer !== undefined ? old.answer_text !== input.answer : old.song_id !== input.songId || old.answer_text !== null)) throw new ConflictException('Request ID reused with different input');
        return { correct: old.correct, score: old.score, elapsedMs: old.elapsed_ms };
      }
      await this.advance(m,receivedAt);
      if (m.status !== 'playing' || input.round !== m.round || receivedAt < m.startsAt || receivedAt >= m.deadline) throw new ConflictException('Round is not accepting answers');
      if (m.answered.has(userId)) throw new ConflictException('This round is already solved');
      if(m.options.healthCapacity&&m.health.get(userId)===0)throw new ConflictException('No health remaining');
      if (input.songId && !(await this.db.query('SELECT id FROM songs WHERE id=$1 AND enabled', [input.songId])).rows[0]) throw new BadRequestException('Unknown song');
      const elapsedMs = receivedAt - m.startsAt;
      const artwork=m.artworks[m.round]!;
      const normalize=(s:string)=>s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
      const correct = input.answer !== undefined ? [artwork.title,...artwork.aliases].some(s=>normalize(s)===normalize(input.answer!)) : input.songId === artwork.song_id;
      const score = correct ? scoreAnswer(m.options.difficulty,elapsedMs,m.options.roundSeconds*1000,m.wrongAttempts.get(userId)??0) : 0;
      const capacity=m.options.healthCapacity??0;
      const hintCount=correct&&capacity?(await this.db.query('SELECT count(*)::int AS count FROM revealed_hints WHERE match_id=$1 AND round=$2 AND user_id=$3',[id,m.round,userId])).rows[0]!.count:0;
      const health=capacity?Math.max(0,Math.min(capacity,m.health.get(userId)!+(correct?correctHealthGain(hintCount):-1))):0;
      const depleted=Boolean(capacity&&m.users.every(u=>(u.id===userId?health:m.health.get(u.id))===0));
      await this.db.transaction(async sql => {
        await sql.query('INSERT INTO guesses(match_id,round,user_id,request_id,song_id,correct,score,elapsed_ms,answer_text) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id,m.round,userId,input.requestId,input.songId ?? (correct ? artwork.song_id : null),correct,score,elapsedMs,input.answer ?? null]);
        await sql.query('UPDATE match_players SET score=score+$3,correct=correct+$4,health=$5 WHERE match_id=$1 AND user_id=$2', [id,userId,score,correct ? 1 : 0,health]);
        if(depleted)await sql.query("UPDATE matches SET status='finished',finished_at=now() WHERE id=$1 AND status='active'",[id]);
      });
      if(correct)m.answered.add(userId); m.scores.set(userId,m.scores.get(userId)!+score);
      m.health.set(userId,health);
      if(!correct)m.wrongAttempts.set(userId,(m.wrongAttempts.get(userId)??0)+1);
      if(depleted){m.status='finished';m.touchedAt=Date.now();}
      await this.advance(m,Date.now());
      this.events.match(this.view(m));
      return { correct, score, elapsedMs };
    });
  }
  returnFromChallenge(id:string,userId:string){
    return this.queue.run(async()=>{
      await this.restoreFinished(id,userId);
      const m=this.require(id,userId);
      if(m.mode!=='practice')throw new ForbiddenException('Only solo challenges support this action');
      if(m.status==='finished')return this.view(m);
      if(m.options.difficulty==='at'){
        m.returnBlocked=true;m.returnBlockedAt??=Date.now();const view=this.view(m);this.events.match(view);return view;
      }
      const now=Date.now();
      await this.db.query("UPDATE matches SET status='interrupted',finished_at=$2 WHERE id=$1 AND status='active'",[id,new Date(now)]);
      m.status='finished';m.touchedAt=now;
      const view=this.view(m);this.events.match(view);return view;
    });
  }
  skipRound(id:string,userId:string,round:number){
    const receivedAt=Date.now();
    return this.queue.run(async()=>{
      const m=this.require(id,userId);
      if(m.mode!=='practice')throw new ForbiddenException('Only solo rounds can be skipped');
      await this.advance(m,receivedAt);
      if(round!==m.round||receivedAt<m.startsAt||m.answered.has(userId))throw new ConflictException('Round cannot be skipped');
      // Retrying a settled round must never charge health again.
      if(m.status==='reveal'||m.status==='finished')return this.view(m);
      await this.advance(m,receivedAt,true);
      return this.view(m);
    });
  }
  noiseHit(id:string,userId:string,input:NoiseHitInput){
    const receivedAt=Date.now();
    return this.queue.run(async()=>{
      const m=this.require(id,userId);
      const old=(await this.db.query('SELECT match_id,round,health_after FROM noise_hits WHERE user_id=$1 AND request_id=$2',[userId,input.requestId])).rows[0];
      if(old){
        if(old.match_id!==id||old.round!==input.round)throw new ConflictException('Request ID reused with different input');
        return this.view(m);
      }
      await this.advance(m,receivedAt);
      if(!m.options.healthCapacity||m.health.get(userId)===0||!['playing','reveal'].includes(m.status)||input.round!==m.round)throw new ConflictException('Noise damage is not available');
      const duration=m.deadline-m.startsAt;
      const currentRed=Boolean(m.returnBlocked&&receivedAt>=(m.returnBlockedAt??0)+800)||!m.answered.has(userId)&&receivedAt>=m.startsAt+Math.max(0,duration-25000)+Math.min(duration,25000)/4;
      const pastRed=currentRed?true:(await this.db.query(`SELECT 1 FROM match_rounds r WHERE r.match_id=$1 AND r.round<$2 AND NOT EXISTS
        (SELECT 1 FROM guesses g WHERE g.match_id=r.match_id AND g.round=r.round AND g.user_id=$3 AND g.correct) LIMIT 1`,[id,m.round,userId])).rows.length>0;
      if(!pastRed)throw new ConflictException('No formed noise domain');
      const health=Math.max(0,m.health.get(userId)!-1),depleted=m.users.every(u=>(u.id===userId?health:m.health.get(u.id))===0);
      await this.db.transaction(async sql=>{
        await sql.query('INSERT INTO noise_hits(match_id,round,user_id,request_id,health_after) VALUES($1,$2,$3,$4,$5)',[id,m.round,userId,input.requestId,health]);
        await sql.query('UPDATE match_players SET health=$3 WHERE match_id=$1 AND user_id=$2',[id,userId,health]);
        if(depleted)await sql.query("UPDATE matches SET status='finished',finished_at=now() WHERE id=$1 AND status='active'",[id]);
      });
      m.health.set(userId,health);
      if(depleted){m.status='finished';m.touchedAt=receivedAt;}else await this.advance(m,Date.now());
      const view=this.view(m);this.events.match(view);return view;
    });
  }
  progress(id: string,userId: string) {
    return this.queue.run(async()=>{
      await this.restoreFinished(id,userId);
      this.require(id,userId);
      // Only this user's solved titles are returned; no future or missed answers.
      return (await this.db.query(`SELECT DISTINCT ON(g.round) g.round,g.correct,g.score,g.answer_text,
        CASE WHEN g.correct THEN s.title ELSE NULL END AS title
        FROM guesses g LEFT JOIN songs s ON s.id=g.song_id WHERE g.match_id=$1 AND g.user_id=$2 ORDER BY g.round,g.correct DESC,g.submitted_at DESC`,[id,userId])).rows;
    });
  }
  hints(id: string,userId: string,round: number,index?:number) {
    return this.queue.run(async()=>{
      const m=this.require(id,userId);await this.advance(m,Date.now());
      if (round!==m.round || Date.now()<m.startsAt || m.status==='finished') throw new ForbiddenException('Hints are not available for this round');
      if(index!==undefined) {
        if(m.status!=='playing')throw new ConflictException('Round is not accepting hints');
        if(m.answered.has(userId)||(m.options.healthCapacity&&m.health.get(userId)===0))throw new ConflictException('Player is not accepting hints');
        const art=m.artworks[round]!;
        let content:string,kind:string,difficulty:string|null=null,artworkId:string|null=null;
        if(index===0){
          if(!art.chapter)throw new NotFoundException('Chapter metadata unavailable');
          const known=(await this.db.query('SELECT max(chapter)::int AS chapter FROM songs')).rows[0]?.chapter;
          const lastChapter=Math.max(art.chapter,known??art.chapter),count=Math.min(lastChapter,randomInt(3,5));
          const first=randomInt(Math.max(1,art.chapter-count+1),Math.min(art.chapter,lastChapter-count+1)+1);
          content=`第 ${first} 章-第 ${first+count-1} 章`;kind='range';
        }else if(index===1){
          const levels=['ez','hd','in','at'],position=levels.indexOf(m.options.difficulty);
          if(position===0)throw new BadRequestException('EZ has only two hints');
          difficulty=levels[position-1]!;
          const lower=(await this.db.query('SELECT id FROM artworks WHERE song_id=$1 AND version=$2 AND variant=$3 AND difficulty=$4',[art.song_id,art.version,art.variant,difficulty])).rows[0];
          if(!lower)throw new NotFoundException('Lower difficulty artwork unavailable');
          artworkId=lower.id;kind='downgrade';content=`${m.options.difficulty.toUpperCase()} → ${difficulty.toUpperCase()}`;
        }else{
          if(!art.composer)throw new NotFoundException('Composer metadata unavailable');
          if(m.options.difficulty==='ez'||m.options.difficulty==='hd'){
            if(!art.chapter)throw new NotFoundException('Chapter metadata unavailable');
            content=`第 ${art.chapter} 章${art.chapter_name?` · ${art.chapter_name}`:''}\n曲师：${art.composer}`;
          }else{
            const illustrator=art.illustrator??(await this.db.query('SELECT illustrator FROM artworks WHERE id=$1',[art.id])).rows[0]?.illustrator;
            if(!illustrator)throw new NotFoundException('Illustrator metadata unavailable');
            art.illustrator=illustrator;content=`曲师：${art.composer}\n画师：${illustrator}`;
          }
          kind='identity';
        }
        await this.db.query('INSERT INTO revealed_hints(match_id,round,user_id,hint_index,content,kind,difficulty,artwork_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[id,round,userId,index,content,kind,difficulty,artworkId]);
      }
      return (await this.db.query('SELECT hint_index AS index,content,kind,difficulty FROM revealed_hints WHERE match_id=$1 AND round=$2 AND user_id=$3 ORDER BY hint_index',[id,round,userId])).rows;
    });
  }
  private async advance(m: Match, now: number, forceTimeout=false) {
    if (m.status === 'playing' && (forceTimeout || now >= m.deadline || m.users.every(u=>m.answered.has(u.id)||(m.options.healthCapacity&&m.health.get(u.id)===0)))) {
      const health=new Map(m.health);
      if((forceTimeout||now>=m.deadline)&&m.options.healthCapacity)for(const u of m.users)if(!m.answered.has(u.id))health.set(u.id,Math.max(0,health.get(u.id)!-timeoutHealthCost(m.wrongAttempts.get(u.id)??0)));
      const depleted=Boolean(m.options.healthCapacity&&m.users.every(u=>health.get(u.id)===0));
      await this.db.transaction(async sql=>{
        if(forceTimeout)await sql.query('UPDATE match_rounds SET deadline=$3 WHERE match_id=$1 AND round=$2',[m.id,m.round,new Date(now)]);
        for(const [userId,value]of health)if(value!==m.health.get(userId))await sql.query('UPDATE match_players SET health=$3 WHERE match_id=$1 AND user_id=$2',[m.id,userId,value]);
        if(depleted)await sql.query("UPDATE matches SET status='finished',finished_at=now() WHERE id=$1 AND status='active'",[m.id]);
      });
      if(forceTimeout)m.deadline=now;
      m.health=health;m.status = depleted?'finished':'reveal'; m.nextAt = now + 2000; m.touchedAt = now;
      this.events.match(this.view(m));
    } else if (m.status === 'reveal' && now >= m.nextAt) {
      if (m.round + 1 >= m.artworks.length) {
        await this.db.query("UPDATE matches SET status='finished',finished_at=now() WHERE id=$1 AND status='active'", [m.id]);
        m.status = 'finished'; m.touchedAt = now;
      } else {
        const next = m.round + 1, startsAt = now, deadline = startsAt + m.options.roundSeconds*1000;
        await this.db.query('INSERT INTO match_rounds(match_id,round,artwork_id,starts_at,deadline) VALUES($1,$2,$3,$4,$5)', [m.id,next,m.artworks[next]!.id,new Date(startsAt),new Date(deadline)]);
        Object.assign(m,{ round: next, startsAt, deadline, nextAt: 0, status: 'playing', answered: new Set(),wrongAttempts:new Map(), touchedAt: now,
          currentImageKey:m.preloadedImage?.round===next?m.preloadedImage.key:undefined,preloadedImage:undefined });
      }
      this.events.match(this.view(m));
    }
  }
  private view(m: Match): MatchView {
    const artwork = m.artworks[m.round]!;
    return { id: m.id, mode: m.mode, returnBlocked:Boolean(m.returnBlocked),returnBlockedAt:m.returnBlockedAt, healthEnabled:Boolean(m.options.healthCapacity),healthCapacity:m.options.healthCapacity, status: m.status, difficulty: m.options.difficulty, round: m.round, totalRounds: m.options.rounds===INFINITY_ROUNDS?m.artworks.length:m.options.rounds,endless:m.options.rounds===INFINITY_ROUNDS,
      serverNow: Date.now(), startsAt: m.startsAt, deadline: m.deadline, nextAt: m.nextAt,
      imageUrl: `/api/matches/${m.id}/rounds/${m.round}/image`,
      ...(m.currentImageKey&&Date.now()>=m.startsAt?{imageKey:m.currentImageKey.toString('base64')}:{}),
      answer: ['reveal','finished'].includes(m.status) ? { id: artwork.song_id,title: artwork.title } : null,
      players: m.users.map(u => ({ ...u,score: m.scores.get(u.id)!,answered: m.answered.has(u.id),health:m.health.get(u.id)! })), rulesVersion: RULES_VERSION };
  }
  async tick() {
    await this.queue.run(async () => {
      for (const [id,m] of this.matches) {
        await this.advance(m,Date.now());
        if (m.status === 'finished' && Date.now()-m.touchedAt > 3600_000) this.matches.delete(id);
      }
    });
  }
  async result(id: string, userId: string) {
    const { rows } = await this.db.query('SELECT m.id,m.mode,m.difficulty,m.status,m.rules_version,m.created_at,m.finished_at,m.health_capacity,m.round_count,m.round_seconds,p.result_published AS published FROM matches m JOIN match_players p ON p.match_id=m.id WHERE m.id=$1 AND p.user_id=$2', [id,userId]);
    if (!rows[0]) throw new NotFoundException();
    const players = (await this.db.query('SELECT p.user_id,u.name,p.score,p.correct,p.health FROM match_players p JOIN users u ON u.id=p.user_id WHERE p.match_id=$1 ORDER BY p.score DESC,p.user_id', [id])).rows;
    const rounds=(await this.db.query<Omit<ResultRoundView,'imageUrl'>>(`SELECT r.round,a.difficulty,
      CASE WHEN g.correct THEN s.title ELSE NULL END AS title,
      COALESCE(g.correct,false) AS correct,COALESCE(g.score,0)::int AS score,
      COALESCE(g.attempts,0)::int AS attempts,COALESCE(g.wrong_attempts,0)::int AS "wrongAttempts",
      CASE WHEN g.correct THEN g.elapsed_ms ELSE GREATEST(0,EXTRACT(EPOCH FROM(LEAST(r.deadline,COALESCE(m.finished_at,CASE WHEN m.status='active' THEN now() ELSE r.deadline END))-r.starts_at))*1000)::int END AS "elapsedMs",
      (SELECT count(*)::int FROM revealed_hints h WHERE h.match_id=r.match_id AND h.round=r.round AND h.user_id=$2) AS "hintsUsed",
      (SELECT count(*)::int FROM noise_hits n WHERE n.match_id=r.match_id AND n.round=r.round AND n.user_id=$2) AS "noiseHits"
      FROM match_rounds r JOIN matches m ON m.id=r.match_id JOIN artworks a ON a.id=r.artwork_id JOIN songs s ON s.id=a.song_id
      LEFT JOIN LATERAL (SELECT bool_or(correct) AS correct,sum(score) AS score,
        count(*) AS attempts,count(*) FILTER(WHERE NOT correct) AS wrong_attempts,min(elapsed_ms) FILTER(WHERE correct) AS elapsed_ms
        FROM guesses WHERE match_id=r.match_id AND round=r.round AND user_id=$2) g ON true
      WHERE r.match_id=$1 ORDER BY r.round`,[id,userId])).rows;
    const settled=['finished','interrupted'].includes(rows[0].status);
    return { ...rows[0],players,published:Boolean(rows[0].published),endless:rows[0].round_count===INFINITY_ROUNDS,rounds:rounds.map(r=>({...r,imageUrl:settled?`/api/matches/${id}/rounds/${r.round}/result-image`:null})) };
  }
  async resultImage(id:string,round:number,userId:string){
    const row=(await this.db.query(`SELECT
      CASE WHEN a.original_preview_key IS NOT NULL AND EXISTS(SELECT 1 FROM guesses g WHERE g.match_id=r.match_id AND g.round=r.round AND g.user_id=$3 AND g.correct)
        THEN a.original_preview_key ELSE a.storage_key END AS key,
      CASE WHEN a.original_preview_key IS NOT NULL AND EXISTS(SELECT 1 FROM guesses g WHERE g.match_id=r.match_id AND g.round=r.round AND g.user_id=$3 AND g.correct)
        THEN 'image/webp' ELSE a.mime END AS mime
      FROM match_rounds r JOIN matches m ON m.id=r.match_id JOIN match_players p ON p.match_id=m.id AND p.user_id=$3
      JOIN artworks a ON a.id=r.artwork_id WHERE m.id=$1 AND r.round=$2 AND m.status IN ('finished','interrupted')`,[id,round,userId])).rows[0];
    if(!row)throw new NotFoundException('Result artwork is not available');
    return row as {key:string;mime:string};
  }
  async setResultPublication(id:string,userId:string,published:boolean){
    return this.db.transaction(async sql=>{
      const match=(await sql.query('SELECT m.* FROM matches m JOIN match_players p ON p.match_id=m.id WHERE m.id=$1 AND p.user_id=$2 FOR UPDATE OF p',[id,userId])).rows[0];
      if(!match)throw new NotFoundException('Result not available');
      if(published&&(match.status!=='finished'||match.mode!=='practice'||match.round_count!==INFINITY_ROUNDS||!['in','at'].includes(match.difficulty)||!match.health_enabled||![20,50].includes(match.health_capacity)||match.rules_version!==RULES_VERSION))throw new ConflictException('Only completed Infinity results can be published');
      await sql.query('UPDATE match_players SET result_published=$3 WHERE match_id=$1 AND user_id=$2',[id,userId,published]);
      return {published};
    });
  }
  async revealResultArtwork(id:string,round:number,userId:string){
    const row=(await this.db.query(`SELECT s.title,a.original_preview_key AS key FROM match_rounds r
      JOIN matches m ON m.id=r.match_id JOIN match_players p ON p.match_id=m.id AND p.user_id=$3
      JOIN artworks a ON a.id=r.artwork_id JOIN songs s ON s.id=a.song_id
      WHERE m.id=$1 AND r.round=$2 AND m.status IN ('finished','interrupted')`,[id,round,userId])).rows[0];
    if(!row?.key)throw new NotFoundException('Result original is not available');
    return row as {title:string;key:string};
  }
  async active(userId:string){
    return this.queue.run(async()=>{for(const m of this.matches.values())if(m.users.some(u=>u.id===userId)){await this.advance(m,Date.now());if(m.status==='playing'||m.status==='reveal')return {id:m.id,mode:m.mode};}return null;});
  }
  async leaderboard(options:InfinityLeaderboardOptions) {
    const entries=(await this.db.query<LeaderboardEntry>(`WITH best AS (
      SELECT DISTINCT ON(p.user_id) p.user_id,p.score,p.correct,m.id AS match_id FROM match_players p JOIN matches m ON m.id=p.match_id
      WHERE p.result_published AND m.status='finished' AND m.health_enabled AND m.health_capacity=$4 AND m.difficulty=$1 AND m.mode='practice' AND m.round_count=$2 AND m.round_seconds=$3 AND m.rules_version=$5
      ORDER BY p.user_id,p.score DESC,p.correct DESC
    ) SELECT dense_rank() OVER(ORDER BY b.score DESC) AS rank,u.id,u.name,u.password_hash IS NULL AS "isGuest",
      CASE WHEN u.avatar_key IS NOT NULL THEN '/api/users/'||u.id||'/avatar?v='||u.avatar_key END AS "avatarUrl",b.score,b.correct,
      (SELECT count(*)::int FROM match_rounds r WHERE r.match_id=b.match_id) AS "totalRounds"
    FROM best b JOIN users u ON u.id=b.user_id ORDER BY b.score DESC,u.id LIMIT 100`,[options.difficulty,INFINITY_ROUNDS,options.roundSeconds,options.healthCapacity,RULES_VERSION])).rows;
    return withReferencePlayer(entries,options.difficulty);
  }
}


