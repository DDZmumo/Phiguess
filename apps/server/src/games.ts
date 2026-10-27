import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { configuration } from './config';
import type { GameOptions, GuessInput, InfinityLeaderboardOptions, MatchView, NoiseHitInput, ResultRoundView, RoomOptions, RoomPerformanceView } from '../../../packages/contracts/src';
import { correctHealthGain, DOWNGRADE_HINT_LABEL, INFINITY_ROUNDS, resolveHealthCapacity, timeoutHealthCost, RULES_VERSION,ROOM_RULES_VERSION,ROOM_LOADING_TIMEOUT_MS,ROOM_LOADING_FORCE_START_MS,type RoomRemovalNotice } from '../../../packages/contracts/src';
import { scoreAnswer, SerialQueue } from '../../../packages/game-core/src';
import type { User } from './auth';
import { Artwork, CatalogService } from './catalog';
import { Db,type Sql } from './db';
import { Events } from './events';
import {withReferencePlayer,type LeaderboardEntry} from './leaderboard-reference';
import {GeneratedArtworks,type ServedArtwork} from './generated-artworks';
import {nonMainHint} from './version-hints';
const compressArtwork=promisify(gzip);

interface Match {
  rulesVersion:string;
  master?:Match;
  lanes?:Map<string,Match>;
  skipped?:Set<string>;
  dead?:Map<string,boolean>;
  survivalMs?:Map<string,number>;
  aliveSince?:Map<string,number|null>;
  roomStartedAt?:number;
  matchEndsAt?:number;
  initialArtworks?:Artwork[];
  id: string; mode: MatchView['mode']; options: RoomOptions; artworks: Artwork[];
  users: User[]; scores: Map<string, number>; answered: Set<string>;
  health:Map<string,number>; wrongAttempts:Map<string,number>;
  round: number; startsAt: number; deadline: number; nextAt: number;
  status: MatchView['status']; touchedAt: number; returnBlocked?:boolean; returnBlockedAt?:number;
  preloadedImage?: {round:number;key:Buffer;mime:string;body:Promise<Buffer>};
  currentImageKey?: Buffer;
  preparing?:boolean;
  awaitingReady?:boolean;
  readyUsers?:Set<string>;
  loadingDeadlineAt?:number;
  roomCode?:string;
  removedUsers?:Map<string,RoomRemovalNotice['reason']>;
  preparedRounds?:Set<number>;
  filling?:boolean;
  preparedNext?:{round:number;ready:boolean;failures:number;retryAt:number};
}
interface LifeState{dead:boolean;survivalMs:number;aliveSince:number|null}
@Injectable()
export class GamesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GamesService.name);
  private readonly matches = new Map<string, Match>();
  private readonly queue = new SerialQueue();
  private timer?: NodeJS.Timeout;
  private ticking = false;
  constructor(private readonly db: Db, private readonly catalog: CatalogService, private readonly events: Events,private readonly generated:GeneratedArtworks=new GeneratedArtworks(db)) {}
  async onModuleInit() {
    // This application is deliberately single-instance. Never run two replicas.
    await this.db.query(`UPDATE match_players p SET survival_ms=p.survival_ms+GREATEST(0,EXTRACT(EPOCH FROM(LEAST(now(),COALESCE(m.match_started_at+m.match_seconds*interval '1 second',now()))-p.alive_since))*1000)::int,alive_since=NULL FROM matches m WHERE p.match_id=m.id AND m.mode='room' AND m.status='active' AND p.alive_since IS NOT NULL`);
    await this.db.query("UPDATE matches SET status='interrupted',finished_at=now() WHERE status='active'");
    this.timer = setInterval(() => {
      if (this.ticking) return;
      this.ticking = true;
      void this.tick().catch(e => this.logger.error('Game tick failed', e instanceof Error ? e.stack : undefined)).finally(() => { this.ticking = false; });
    }, 250);
    this.timer.unref();
  }
  async onModuleDestroy() { if (this.timer) clearInterval(this.timer); await this.queue.run(async () => undefined); }
  async createSolo(user: User, options: GameOptions,waitForReady=false) {
    const match=await this.queue.run(async () => {
      const active = [...this.matches.values()].find(m => ['playing','reveal'].includes(m.status) && m.users.some(u => u.id === user.id));
      if (active) throw new ConflictException({ message: 'Already in an active match', matchId: active.id });
      return this.create('practice',[user],options,await this.catalog.choose(options.difficulty,options.rounds,options.artworkScopes),waitForReady);
    });
    match.awaitingReady=waitForReady;return this.startPrepared(match);
  }
  async createRoom(users: User[], options: RoomOptions,waitForReady=false,roomCode?:string) {
    const match=await this.queue.run(async () => {
      if ([...this.matches.values()].some(m => ['playing','reveal'].includes(m.status) && users.some(u => m.users.some(p => p.id === u.id)))) throw new ConflictException('A player is already in an active match');
      return this.create('room', users, options, await this.catalog.choose(options.difficulty, options.rounds,options.artworkScopes),waitForReady);
    });
    match.roomCode=roomCode;if(waitForReady)match.readyUsers=new Set();
    await this.startPrepared(match);
    if(waitForReady)match.loadingDeadlineAt=Date.now()+ROOM_LOADING_TIMEOUT_MS;
    if(match.options.rounds===INFINITY_ROUNDS)this.createLanes(match);
    if(!waitForReady)await this.startRoomClock(match,match.startsAt);
    return this.view(match);
  }
  private async startPrepared(m:Match){
    await this.generated.createSession(m.id);
    if(m.preparing){
      try{m.preparedRounds=new Set();for(let round=0;round<Math.min(10,m.artworks.length);round++){if(m.status!=='playing')throw new Error('Cancelled');await this.generated.prepare(m.id,round,m.artworks[round]!,0);m.preparedRounds.add(round);}}
      catch{await this.queue.run(async()=>{m.preparing=false;m.status='finished';await this.db.query("UPDATE matches SET status='interrupted',finished_at=now() WHERE id=$1",[m.id]);});this.logger.warn('Initial artwork generation failed');throw new ServiceUnavailableException('Artwork preparation failed; please retry');}
      await this.queue.run(async()=>{m.preparing=false;if(m.status!=='playing')throw new ConflictException('Match preparation was cancelled');m.startsAt=Date.now()+3000;m.deadline=m.startsAt+m.options.roundSeconds*1000;await this.db.query('UPDATE match_rounds SET starts_at=$2,deadline=$3 WHERE match_id=$1 AND round=0',[m.id,new Date(m.startsAt),new Date(m.deadline)]);});
    }
    this.warmNext(m);return this.view(m);
  }
  private warmNext(m:Match){
    if(m.preparing||!['playing','reveal'].includes(m.status))return;
    if(m.master)this.extendRoomArtworks(m,m.round+19);
    const round=m.round+1,art=m.artworks[round];
    if(art&&(!this.generated.isGenerated(art)||m.preparedRounds?.has(round)))m.preparedNext={round,ready:true,failures:0,retryAt:0};
    if(m.filling)return;
    const old=m.preparedNext;
    if(old&&!old.ready&&(old.failures>=3||Date.now()<old.retryAt))return;
    m.filling=true;
    void (async()=>{
      // Current question counts toward the twenty-question reserve.
      while(['playing','reveal'].includes(m.status)){
        const end=Math.min(m.artworks.length,m.round+20);
        let next=m.round+1;
        while(next<end&&m.preparedRounds?.has(next))next++;
        if(next>=end)break;
        const state={round:next,ready:false,failures:old?.round===next?old.failures:0,retryAt:0};
        if(next===m.round+1)m.preparedNext=state;
        try{await this.generated.prepare(m.id,next,m.artworks[next]!,1);(m.preparedRounds??=new Set()).add(next);state.ready=true;if(next===m.round+1)m.preparedNext=state;}
        catch{state.failures++;state.retryAt=Date.now()+1000;m.preparedNext=state;this.logger.warn('Artwork reserve preparation failed; retry scheduled');break;}
      }
    })().finally(()=>{m.filling=false;});
  }
  async ready(id:string,userId:string){
    return this.queue.run(async()=>{
      const m=this.shared(id,userId);
      if(m.preparing)throw new ConflictException('Artwork preparation is not complete');
      if(m.mode==='room'&&m.awaitingReady&&m.loadingDeadlineAt!==undefined&&Date.now()>=m.loadingDeadlineAt){await this.resolveRoomLoading(m,Date.now());return this.view(this.require(id,userId));}
      if(m.awaitingReady&&m.status==='playing'){
        if(m.mode==='room'){
          (m.readyUsers??=new Set()).add(userId);
          if(m.users.some(user=>!m.readyUsers!.has(user.id))){this.broadcast(m);return this.view(this.require(id,userId));}
        }
        await this.startLoadedMatch(m,Date.now());
      }
      return this.view(this.require(id,userId));
    });
  }
  loadingRemovalReason(id:string,userId:string){return this.matches.get(id)?.removedUsers?.get(userId);}
  private async startLoadedMatch(m:Match,now:number){
    m.awaitingReady=false;m.loadingDeadlineAt=undefined;m.startsAt=now+3000;m.deadline=m.startsAt+m.options.roundSeconds*1000;
    await this.db.query('UPDATE match_rounds SET starts_at=$2,deadline=$3 WHERE match_id=$1 AND round=0',[m.id,new Date(m.startsAt),new Date(m.deadline)]);
    if(m.mode==='room')await this.startRoomClock(m,m.startsAt);this.broadcast(m);
  }
  private async removeLoadingPlayers(m:Match,userIds:string[],reason:RoomRemovalNotice['reason']){
    if(!userIds.length)return;
    await this.db.transaction(async sql=>{
      await sql.query('DELETE FROM match_player_rounds WHERE match_id=$1 AND user_id=ANY($2::uuid[])',[m.id,userIds]);
      await sql.query('DELETE FROM match_players WHERE match_id=$1 AND user_id=ANY($2::uuid[])',[m.id,userIds]);
    });
    const removed=new Set(userIds);m.users=m.users.filter(user=>!removed.has(user.id));
    for(const userId of userIds){
      (m.removedUsers??=new Map()).set(userId,reason);
      const lane=m.lanes?.get(userId);if(lane)lane.status='finished';m.lanes?.delete(userId);
      m.readyUsers?.delete(userId);m.scores.delete(userId);m.health.delete(userId);m.dead?.delete(userId);m.aliveSince?.delete(userId);m.survivalMs?.delete(userId);
    }
    this.events.emit('room:loading-removed',{matchId:m.id,code:m.roomCode,userIds,reason});
  }
  private async resolveRoomLoading(m:Match,now:number,reason:RoomRemovalNotice['reason']='loading-timeout'){
    const missing=m.users.filter(user=>!m.readyUsers?.has(user.id)).map(user=>user.id);
    await this.removeLoadingPlayers(m,missing,reason);
    if(!m.users.length){await this.finishRoom(m,now,'interrupted');return;}
    await this.startLoadedMatch(m,now);
  }
  async forceStartLoading(id:string,userId:string){
    return this.queue.run(async()=>{
      const m=this.shared(id,userId),now=Date.now();
      if(m.mode!=='room'||m.users[0]?.id!==userId)throw new ForbiddenException('Only host can force start');
      if(!m.awaitingReady||m.loadingDeadlineAt===undefined||now<m.loadingDeadlineAt-ROOM_LOADING_TIMEOUT_MS+ROOM_LOADING_FORCE_START_MS)throw new ConflictException('Loading force-start is not available yet');
      await this.resolveRoomLoading(m,now,'forced-start');return this.view(this.require(id,userId));
    });
  }
  async leaveLoadingRoom(id:string,userId:string){
    await this.queue.run(async()=>{
      const m=this.matches.get(id);if(!m||m.mode!=='room'||!m.awaitingReady||!m.users.some(user=>user.id===userId))return;
      await this.removeLoadingPlayers(m,[userId],'left-loading');
      if(!m.users.length)await this.finishRoom(m,Date.now(),'interrupted');
      else if(m.users.every(user=>m.readyUsers?.has(user.id)))await this.startLoadedMatch(m,Date.now());
      else this.broadcast(m);
    });
  }
  private async create(mode: MatchView['mode'], users: User[], options: RoomOptions, artworks: Artwork[],waitForReady=false) {
    const capacity=options.difficulty==='in'&&options.rounds===INFINITY_ROUNDS?(options.healthCapacity===50?50:20):resolveHealthCapacity(options.difficulty,options.healthCapacity,options.healthEnabled);
    options={...options,healthEnabled:capacity>0,healthCapacity:capacity};
    if ([...this.matches.values()].filter(m => ['playing','reveal'].includes(m.status)).length >= 100) throw new ServiceUnavailableException('Active match limit reached');
    const startsAt = Date.now() + 3000;
    const m: Match = { rulesVersion:mode==='room'?ROOM_RULES_VERSION:RULES_VERSION,id: randomUUID(), mode, options, artworks, users, scores: new Map(users.map(u => [u.id,0])), answered: new Set(), round: 0,
      health:new Map(users.map(u=>[u.id,capacity])),wrongAttempts:new Map(),skipped:new Set(),awaitingReady:waitForReady,
      ...(mode==='room'?{dead:new Map(users.map(u=>[u.id,false])),survivalMs:new Map(users.map(u=>[u.id,0])),aliveSince:new Map(users.map(u=>[u.id,null]))}:{}),
      startsAt, deadline: startsAt + options.roundSeconds * 1000, nextAt: 0, status: 'playing', touchedAt: Date.now(),preparing:this.generated.isGenerated(artworks[0]!) };
    await this.db.transaction(async sql => {
      await sql.query("INSERT INTO matches(id,mode,difficulty,status,rules_version,round_count,round_seconds,health_enabled,health_capacity) VALUES($1,$2,$3,'active',$4,$5,$6,$7,$8)",[m.id,mode,options.difficulty,m.rulesVersion,options.rounds,options.roundSeconds,options.healthEnabled,capacity]);
      for (const user of users) {
        await sql.query('INSERT INTO match_players(match_id,user_id,health) VALUES($1,$2,$3)', [m.id,user.id,capacity]);
      }
      await sql.query('INSERT INTO match_rounds(match_id,round,artwork_id,starts_at,deadline) VALUES($1,0,$2,$3,$4)', [m.id,artworks[0]!.id,new Date(m.startsAt),new Date(m.deadline)]);
      if(mode==='room'){
        if(options.rounds===INFINITY_ROUNDS)await sql.query('UPDATE matches SET match_seconds=$2 WHERE id=$1',[m.id,options.matchSeconds??180]);
        for(const user of users)await sql.query('INSERT INTO match_player_rounds(match_id,round,user_id,starts_at,deadline) VALUES($1,0,$2,$3,$4)',[m.id,user.id,new Date(m.startsAt),new Date(m.deadline)]);
      }
    });
    this.matches.set(m.id,m);
    return m;
  }
  private require(id: string, userId: string) {
    const m = this.matches.get(id);
    if (!m) throw new NotFoundException('Match not in memory; query saved result');
    if(m.removedUsers?.has(userId))throw new GoneException({message:'Room loading timed out',code:'ROOM_LOADING_REMOVED',matchId:id,roomCode:m.roomCode,reason:m.removedUsers.get(userId)});
    if (!m.users.some(u => u.id === userId)) throw new ForbiddenException();
    return m.lanes?.get(userId)??m;
  }
  private shared(id:string,userId:string){
    const match=this.matches.get(id);if(!match)throw new NotFoundException('Match not in memory; query saved result');
    if(match.removedUsers?.has(userId))throw new GoneException({message:'Room loading timed out',code:'ROOM_LOADING_REMOVED',matchId:id,roomCode:match.roomCode,reason:match.removedUsers.get(userId)});
    if(!match.users.some(user=>user.id===userId))throw new ForbiddenException();return match;
  }
  private createLanes(match:Match){
    match.initialArtworks??=[...match.artworks];match.preparedRounds??=new Set();
    match.lanes=new Map(match.users.map(user=>[user.id,{...match,master:match,lanes:undefined,users:[user],answered:new Set<string>(),wrongAttempts:new Map<string,number>(),skipped:new Set<string>(),filling:false,preparedNext:undefined,preloadedImage:undefined,currentImageKey:undefined}]));
  }
  private broadcast(match:Match){
    const shared=match.master??match;
    if(shared.lanes){for(const [userId,lane]of shared.lanes)this.events.match(this.view(lane),userId);}
    else this.events.match(this.view(shared));
  }
  private async startRoomClock(match:Match,startsAt:number){
    match.roomStartedAt=startsAt;match.matchEndsAt=match.options.rounds===INFINITY_ROUNDS?startsAt+(match.options.matchSeconds??180)*1000:undefined;
    await this.db.transaction(async sql=>{
      await sql.query('UPDATE matches SET match_started_at=$2 WHERE id=$1',[match.id,new Date(startsAt)]);
      await sql.query('UPDATE match_players SET alive_since=$2 WHERE match_id=$1',[match.id,new Date(startsAt)]);
      await sql.query('UPDATE match_player_rounds SET starts_at=$2,deadline=$3 WHERE match_id=$1 AND round=0',[match.id,new Date(startsAt),new Date(match.deadline)]);
    });
    for(const user of match.users)match.aliveSince?.set(user.id,startsAt);
    for(const lane of match.lanes?.values()??[]){lane.startsAt=startsAt;lane.deadline=match.deadline;lane.awaitingReady=false;}
  }
  private lifeChange(match:Match,userId:string,health:number,now:number):LifeState|null{
    if(match.mode!=='room')return null;
    const shared=match.master??match,wasDead=shared.dead?.get(userId)??false;
    const dead=Boolean(shared.options.healthCapacity&&(health===0||wasDead&&health<10));
    let survivalMs=shared.survivalMs?.get(userId)??0,aliveSince=shared.aliveSince?.get(userId)??null;
    if(dead&&!wasDead){if(aliveSince!==null)survivalMs+=Math.max(0,now-aliveSince);aliveSince=null;}
    if(!dead&&wasDead)aliveSince=now;
    return {dead,survivalMs,aliveSince};
  }
  private async writeLife(sql:Sql,match:Match,userId:string,life:LifeState|null){
    if(!life)return;
    await sql.query('UPDATE match_players SET dead=$3,survival_ms=$4,alive_since=$5 WHERE match_id=$1 AND user_id=$2',[match.id,userId,life.dead,life.survivalMs,life.aliveSince===null?null:new Date(life.aliveSince)]);
  }
  private applyLife(match:Match,userId:string,health:number,life:LifeState|null){
    match.health.set(userId,health);if(!life)return;
    const shared=match.master??match;shared.dead?.set(userId,life.dead);shared.survivalMs?.set(userId,life.survivalMs);shared.aliveSince?.set(userId,life.aliveSince);
  }
  private async closePlayerRound(sql:Sql,match:Match,userId:string,now:number,skipped=false){
    if(match.mode!=='room')return;
    await sql.query('UPDATE match_player_rounds SET closed_at=COALESCE(closed_at,$4),skipped=skipped OR $5 WHERE match_id=$1 AND round=$2 AND user_id=$3',[match.id,match.round,userId,new Date(now),skipped]);
  }
  private extendRoomArtworks(match:Match,index:number){
    const shared=match.master??match;if(!shared.lanes)return;
    while(shared.artworks.length<=index){const cycle=[...(shared.initialArtworks??shared.artworks)];for(let i=cycle.length-1;i>0;i--){const j=randomInt(i+1);[cycle[i],cycle[j]]=[cycle[j]!,cycle[i]!];}shared.artworks.push(...cycle);}
  }
  private async finishRoom(match:Match,now:number,status:'finished'|'interrupted'='finished'){
    const shared=match.master??match;if(shared.status==='finished')return;
    const totals=shared.users.map(user=>{const since=shared.aliveSince?.get(user.id)??null;return {id:user.id,survivalMs:(shared.survivalMs?.get(user.id)??0)+(since===null?0:Math.max(0,now-since))};});
    await this.db.transaction(async sql=>{
      await sql.query('UPDATE matches SET status=$2,finished_at=$3 WHERE id=$1 AND status=\'active\'',[shared.id,status,new Date(now)]);
      for(const total of totals)await sql.query('UPDATE match_players SET survival_ms=$3,alive_since=NULL WHERE match_id=$1 AND user_id=$2',[shared.id,total.id,total.survivalMs]);
      await sql.query('UPDATE match_player_rounds SET closed_at=COALESCE(closed_at,LEAST(deadline,$2)) WHERE match_id=$1',[shared.id,new Date(now)]);
    });
    for(const total of totals){shared.survivalMs?.set(total.id,total.survivalMs);shared.aliveSince?.set(total.id,null);}
    shared.status='finished';shared.touchedAt=now;for(const lane of shared.lanes?.values()??[]){lane.status='finished';lane.touchedAt=now;}
    this.broadcast(shared);
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
    const players=(await this.db.query(`SELECT u.id,u.name,u.avatar_key,p.score,p.health,p.dead,p.survival_ms,p.alive_since FROM match_players p JOIN users u ON u.id=p.user_id WHERE p.match_id=$1`,[id])).rows;
    const correct=(await this.db.query('SELECT DISTINCT user_id FROM guesses WHERE match_id=$1 AND round=$2 AND correct',[id,last.round])).rows;
    this.matches.set(id,{id,rulesVersion:saved.rules_version,mode:saved.mode,status:'finished',options:{difficulty:saved.difficulty,rounds:saved.round_count??rounds.length,roundSeconds:saved.round_seconds??30,healthEnabled:saved.health_capacity>0,healthCapacity:saved.health_capacity,...(saved.match_seconds?{matchSeconds:saved.match_seconds}:{})},
      artworks:rounds as Artwork[],users:players.map(p=>({id:p.id,name:p.name,avatarUrl:p.avatar_key?`/api/users/${p.id}/avatar`:null})),
      scores:new Map(players.map(p=>[p.id,p.score])),health:new Map(players.map(p=>[p.id,p.health])),wrongAttempts:new Map(),answered:new Set(correct.map(p=>p.user_id)),round:last.round,
      startsAt:new Date(last.starts_at).getTime(),deadline:new Date(last.deadline).getTime(),nextAt:new Date(last.deadline).getTime()+2000,touchedAt:Date.now()});
    const restored=this.matches.get(id)!;
    if(saved.mode==='room'){
      restored.dead=new Map(players.map(player=>[player.id,Boolean(player.dead)]));restored.survivalMs=new Map(players.map(player=>[player.id,Number(player.survival_ms??0)]));restored.aliveSince=new Map(players.map(player=>[player.id,null]));
      restored.roomStartedAt=saved.match_started_at?new Date(saved.match_started_at).getTime():undefined;restored.matchEndsAt=restored.roomStartedAt&&saved.match_seconds?restored.roomStartedAt+saved.match_seconds*1000:undefined;
      const personal=(await this.db.query('SELECT DISTINCT ON(user_id) * FROM match_player_rounds WHERE match_id=$1 ORDER BY user_id,round DESC',[id])).rows;
      if(saved.round_count===INFINITY_ROUNDS){
        this.createLanes(restored);
        const solved=(await this.db.query('SELECT user_id,round FROM guesses WHERE match_id=$1 AND correct',[id])).rows;
        for(const [userId,lane]of restored.lanes!){const row=personal.find(value=>value.user_id===userId);if(!row)continue;lane.round=row.round;lane.startsAt=new Date(row.starts_at).getTime();lane.deadline=new Date(row.deadline).getTime();lane.skipped=new Set(row.skipped?[userId]:[]);lane.answered=new Set(row.skipped||solved.some(value=>value.user_id===userId&&value.round===row.round)?[userId]:[]);}
      }else{restored.skipped=new Set(personal.filter(row=>row.round===restored.round&&row.skipped).map(row=>row.user_id));for(const userId of restored.skipped)restored.answered.add(userId);}
    }
  }
  snapshot(id: string, userId: string) {
    return this.queue.run(async () => { await this.restoreFinished(id,userId);const m = this.require(id,userId); await this.advance(m,Date.now()); return this.view(this.require(id,userId)); });
  }
  async originalImage(id: string, round: number, userId: string) {
    const row=(await this.db.query(`SELECT a.original_preview_key AS key FROM match_rounds r
      JOIN artworks a ON a.id=r.artwork_id JOIN match_players p ON p.match_id=r.match_id AND p.user_id=$3
      WHERE r.match_id=$1 AND r.round=$2 AND EXISTS
      (SELECT 1 FROM guesses g WHERE g.match_id=r.match_id AND g.round=r.round AND g.user_id=$3 AND g.correct)`,[id,round,userId])).rows[0];
    if(!row?.key)throw new ForbiddenException('Original artwork is not available');
    return row.key as string;
  }
  async image(id: string, round: number, userId: string) {
    const selected=await this.queue.run(async () => {
      await this.restoreFinished(id,userId);
      const m = this.require(id,userId); await this.advance(m,Date.now());this.require(id,userId);
      if (m.preparing||m.round !== round || (!m.awaitingReady&&Date.now() < m.startsAt)) throw new ForbiddenException('Image is not available for this round');
      const hint=(await this.db.query('SELECT artwork_id FROM revealed_hints WHERE match_id=$1 AND round=$2 AND user_id=$3 AND hint_index=1',[id,round,userId])).rows[0];
      const base=m.artworks[round]!,art=hint?.artwork_id?(await this.db.query<Artwork>('SELECT * FROM artworks WHERE id=$1',[hint.artwork_id])).rows[0]!:base;
      return {base,art};
    });
    const image=await this.generated.render(id,round,this.generated.isGenerated(selected.base)?selected.base:selected.art,selected.art.difficulty);
    return {...selected.art,storage_key:image.key,mime:image.mime,body:image.body};
  }
  async preloadImage(id:string,round:number,userId:string) {
    const preload=await this.queue.run(async()=>{
      const m=this.require(id,userId);await this.advance(m,Date.now());this.require(id,userId);
      if(m.preparing||m.awaitingReady||!['playing','reveal'].includes(m.status)||Date.now()<m.startsAt||round!==m.round+1||round>=m.artworks.length)
        throw new ForbiddenException('Only the next artwork can be preloaded');
      if(!m.preloadedImage){
        const art=m.artworks[round]!;
        const key=randomBytes(32),nonce=randomBytes(12);
        const body=this.generated.render(id,round,art,art.difficulty,1).then(image=>{
          if(image.body)return image.body;
          if(!/^[a-f0-9-]{36}\.(svg|webp)$/.test(image.key))throw new ServiceUnavailableException('Invalid asset key');
          return readFile(join(configuration().ASSET_DIR,image.key));
        }).then(bytes=>compressArtwork(bytes)).then(bytes=>{
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
    catch{await this.queue.run(async()=>{const shared=this.matches.get(id),m=shared?.lanes?.get(userId)??shared;if(m?.preloadedImage===preload)m.preloadedImage=undefined;});throw new ServiceUnavailableException('Artwork file unavailable');}
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
      this.require(id,userId);
      if (m.preparing||m.awaitingReady||m.status !== 'playing' || input.round !== m.round || receivedAt < m.startsAt || receivedAt >= m.deadline) throw new ConflictException('Round is not accepting answers');
      if (m.answered.has(userId)) throw new ConflictException('This round is already solved');
      if(m.mode!=='room'&&m.options.healthCapacity&&m.health.get(userId)===0)throw new ConflictException('No health remaining');
      if (input.songId && !(await this.db.query('SELECT id FROM songs WHERE id=$1 AND enabled', [input.songId])).rows[0]) throw new BadRequestException('Unknown song');
      const elapsedMs = receivedAt - m.startsAt;
      const artwork=m.artworks[m.round]!;
      const normalize=(s:string)=>s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
      const correct = input.answer !== undefined ? [artwork.title,...artwork.aliases].some(s=>normalize(s)===normalize(input.answer!)) : input.songId === artwork.song_id;
      const capacity=m.options.healthCapacity??0;
      const hintSummary=correct?(await this.db.query("SELECT count(*)::int AS count,COALESCE(bool_or(kind='downgrade'),false) AS downgraded FROM revealed_hints WHERE match_id=$1 AND round=$2 AND user_id=$3",[id,m.round,userId])).rows[0]!:{count:0,downgraded:false};
      const hintCount=hintSummary.count;
      const earned = correct ? scoreAnswer(m.options.difficulty,elapsedMs,m.options.roundSeconds*1000,m.wrongAttempts.get(userId)??0,[RULES_VERSION,ROOM_RULES_VERSION].includes(m.rulesVersion)&&hintSummary.downgraded) : 0;
      const health=capacity?Math.max(0,Math.min(capacity,m.health.get(userId)!+(correct?correctHealthGain(hintCount):-1))):0;
      const life=this.lifeChange(m,userId,health,receivedAt),score=life?.dead?0:earned;
      const depleted=Boolean(m.mode!=='room'&&capacity&&m.users.every(u=>(u.id===userId?health:m.health.get(u.id))===0));
      await this.db.transaction(async sql => {
        await sql.query('INSERT INTO guesses(match_id,round,user_id,request_id,song_id,correct,score,elapsed_ms,answer_text) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id,m.round,userId,input.requestId,input.songId ?? (correct ? artwork.song_id : null),correct,score,elapsedMs,input.answer ?? null]);
        await sql.query('UPDATE match_players SET score=score+$3,correct=correct+$4,health=$5 WHERE match_id=$1 AND user_id=$2', [id,userId,score,correct ? 1 : 0,health]);
        await this.writeLife(sql,m,userId,life);if(correct)await this.closePlayerRound(sql,m,userId,receivedAt);
        if(depleted)await sql.query("UPDATE matches SET status='finished',finished_at=now() WHERE id=$1 AND status='active'",[id]);
      });
      if(correct)m.answered.add(userId); m.scores.set(userId,m.scores.get(userId)!+score);
      this.applyLife(m,userId,health,life);
      if(!correct)m.wrongAttempts.set(userId,(m.wrongAttempts.get(userId)??0)+1);
      if(depleted){m.status='finished';m.touchedAt=Date.now();}
      await this.advance(m,Date.now());
      this.broadcast(m);
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
        m.returnBlocked=true;m.returnBlockedAt??=Date.now();const view=this.view(m);this.broadcast(m);return view;
      }
      const now=Date.now();
      await this.db.query("UPDATE matches SET status='interrupted',finished_at=$2 WHERE id=$1 AND status='active'",[id,new Date(now)]);
      m.status='finished';m.touchedAt=now;
      const view=this.view(m);this.broadcast(m);return view;
    });
  }
  skipRound(id:string,userId:string,round:number){
    const receivedAt=Date.now();
    return this.queue.run(async()=>{
      const m=this.require(id,userId);
      await this.advance(m,receivedAt);
      this.require(id,userId);
      if(m.mode==='room'){
        if(m.status==='finished')return this.view(m);
        if(round<m.round){const old=(await this.db.query('SELECT skipped FROM match_player_rounds WHERE match_id=$1 AND round=$2 AND user_id=$3',[id,round,userId])).rows[0];if(old?.skipped)return this.view(m);}
        if(round===m.round&&m.skipped?.has(userId))return this.view(m);
        if(m.preparing||m.awaitingReady||round!==m.round||receivedAt<m.startsAt||m.status!=='playing'||m.answered.has(userId))throw new ConflictException('Round cannot be skipped');
        const health=m.options.healthCapacity?Math.max(0,m.health.get(userId)!-timeoutHealthCost(m.wrongAttempts.get(userId)??0)):0,life=this.lifeChange(m,userId,health,receivedAt);
        await this.db.transaction(async sql=>{await sql.query('UPDATE match_players SET health=$3 WHERE match_id=$1 AND user_id=$2',[id,userId,health]);await this.writeLife(sql,m,userId,life);await this.closePlayerRound(sql,m,userId,receivedAt,true);});
        this.applyLife(m,userId,health,life);(m.skipped??=new Set()).add(userId);m.answered.add(userId);
        await this.advance(m,receivedAt);if(m.master&&this.view(m).status==='reveal'){m.nextAt=receivedAt;await this.advance(m,receivedAt);}
        this.broadcast(m);return this.view(m);
      }
      if(m.preparing||m.awaitingReady||round!==m.round||receivedAt<m.startsAt||m.answered.has(userId))throw new ConflictException('Round cannot be skipped');
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
      this.require(id,userId);
      if(m.preparing||m.awaitingReady||!m.options.healthCapacity||(m.mode!=='room'&&m.health.get(userId)===0)||!['playing','reveal'].includes(m.status)||input.round!==m.round)throw new ConflictException('Noise damage is not available');
      const duration=m.deadline-m.startsAt;
      const currentRed=Boolean(m.returnBlocked&&receivedAt>=(m.returnBlockedAt??0)+800)||!m.answered.has(userId)&&receivedAt>=m.startsAt+Math.max(0,duration-25000)+Math.min(duration,25000)/4;
      const pastRed=currentRed?true:(await this.db.query(`SELECT 1 FROM match_rounds r WHERE r.match_id=$1 AND r.round<$2 AND NOT EXISTS
        (SELECT 1 FROM guesses g WHERE g.match_id=r.match_id AND g.round=r.round AND g.user_id=$3 AND g.correct) LIMIT 1`,[id,m.round,userId])).rows.length>0;
      if(!pastRed)throw new ConflictException('No formed noise domain');
      const health=Math.max(0,m.health.get(userId)!-1),depleted=m.mode!=='room'&&m.users.every(u=>(u.id===userId?health:m.health.get(u.id))===0);
      const life=this.lifeChange(m,userId,health,receivedAt);
      await this.db.transaction(async sql=>{
        await sql.query('INSERT INTO noise_hits(match_id,round,user_id,request_id,health_after) VALUES($1,$2,$3,$4,$5)',[id,m.round,userId,input.requestId,health]);
        await sql.query('UPDATE match_players SET health=$3 WHERE match_id=$1 AND user_id=$2',[id,userId,health]);await this.writeLife(sql,m,userId,life);
        if(depleted)await sql.query("UPDATE matches SET status='finished',finished_at=now() WHERE id=$1 AND status='active'",[id]);
      });
      this.applyLife(m,userId,health,life);
      if(depleted){m.status='finished';m.touchedAt=receivedAt;}else await this.advance(m,Date.now());
      const view=this.view(m);this.broadcast(m);return view;
    });
  }
  progress(id: string,userId: string) {
    return this.queue.run(async()=>{
      await this.restoreFinished(id,userId);
      const match=this.require(id,userId);
      if(match.mode==='room')return (await this.db.query(`SELECT r.round,COALESCE(g.correct,false) AS correct,COALESCE(g.score,0) AS score,g.answer_text,
        CASE WHEN g.correct THEN s.title ELSE NULL END AS title,r.skipped
        FROM match_player_rounds r LEFT JOIN LATERAL (SELECT * FROM guesses WHERE match_id=r.match_id AND round=r.round AND user_id=r.user_id ORDER BY correct DESC,submitted_at DESC LIMIT 1) g ON true
        LEFT JOIN songs s ON s.id=g.song_id WHERE r.match_id=$1 AND r.user_id=$2 ORDER BY r.round`,[id,userId])).rows;
      // Only this user's solved titles are returned; no future or missed answers.
      return (await this.db.query(`SELECT DISTINCT ON(g.round) g.round,g.correct,g.score,g.answer_text,
        CASE WHEN g.correct THEN s.title ELSE NULL END AS title
        FROM guesses g LEFT JOIN songs s ON s.id=g.song_id WHERE g.match_id=$1 AND g.user_id=$2 ORDER BY g.round,g.correct DESC,g.submitted_at DESC`,[id,userId])).rows;
    });
  }
  hints(id: string,userId: string,round: number,index?:number) {
    return this.queue.run(async()=>{
      const m=this.require(id,userId);await this.advance(m,Date.now());this.require(id,userId);
      if (m.preparing||m.awaitingReady||round!==m.round || Date.now()<m.startsAt || m.status==='finished') throw new ForbiddenException('Hints are not available for this round');
      if(index!==undefined) {
        if(m.status!=='playing')throw new ConflictException('Round is not accepting hints');
        if(m.answered.has(userId)||(m.mode!=='room'&&m.options.healthCapacity&&m.health.get(userId)===0))throw new ConflictException('Player is not accepting hints');
        const art=m.artworks[round]!;
        let content:string,kind:string,difficulty:string|null=null,artworkId:string|null=null;
        if(index===0){
          if(art.content_kind&&art.content_kind!=='main'){
            content=nonMainHint(art.content_kind,art.introduced_version,art.removed);kind='range';
          }else{
            if(!art.chapter)throw new NotFoundException('Chapter metadata unavailable');
            const known=(await this.db.query('SELECT max(chapter)::int AS chapter FROM songs')).rows[0]?.chapter;
            const lastChapter=Math.max(art.chapter,known??art.chapter),count=Math.min(lastChapter,randomInt(3,5));
            const first=randomInt(Math.max(1,art.chapter-count+1),Math.min(art.chapter,lastChapter-count+1)+1);
            content=`第 ${first} 章-第 ${first+count-1} 章`;kind='range';
          }
        }else if(index===1){
          const levels=['ez','hd','in','at'],position=levels.indexOf(m.options.difficulty);
          if(position===0)throw new BadRequestException('EZ has only two hints');
          difficulty=levels[position-1]!;
          const lower=(await this.db.query('SELECT id FROM artworks WHERE song_id=$1 AND version=$2 AND variant=$3 AND difficulty=$4',[art.song_id,art.version,art.variant,difficulty])).rows[0];
          if(!lower)throw new NotFoundException('Lower difficulty artwork unavailable');
          artworkId=lower.id;kind='downgrade';content=DOWNGRADE_HINT_LABEL;
        }else{
          if(!art.composer)throw new NotFoundException('Composer metadata unavailable');
          if(m.options.difficulty==='ez'||m.options.difficulty==='hd'){
            if(art.content_kind&&art.content_kind!=='main')content=`曲师：${art.composer}`;
            else{
              if(!art.chapter)throw new NotFoundException('Chapter metadata unavailable');
              content=`第 ${art.chapter} 章${art.chapter_name?` · ${art.chapter_name}`:''}\n曲师：${art.composer}`;
            }
          }else{
            const illustrator=art.illustrator??(await this.db.query('SELECT illustrator FROM artworks WHERE id=$1',[art.id])).rows[0]?.illustrator;
            if(!illustrator&&(!art.content_kind||art.content_kind==='main'))throw new NotFoundException('Illustrator metadata unavailable');
            art.illustrator=illustrator;content=`曲师：${art.composer}\n画师：${illustrator||'未收录'}`;
          }
          kind='identity';
        }
        await this.db.query('INSERT INTO revealed_hints(match_id,round,user_id,hint_index,content,kind,difficulty,artwork_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[id,round,userId,index,content,kind,difficulty,artworkId]);
      }
      return (await this.db.query('SELECT hint_index AS index,content,kind,difficulty FROM revealed_hints WHERE match_id=$1 AND round=$2 AND user_id=$3 ORDER BY hint_index',[id,round,userId])).rows.map(hint=>hint.kind==='downgrade'?{...hint,content:DOWNGRADE_HINT_LABEL}:hint);
    });
  }
  private async advance(m:Match,now:number,forceTimeout=false){
    const shared=m.master??m;
    if(m.mode==='room'){
      if(shared.status==='finished'){m.status='finished';return;}
      if(shared.awaitingReady&&shared.loadingDeadlineAt!==undefined&&now>=shared.loadingDeadlineAt){await this.resolveRoomLoading(shared,now);return;}
      if(shared.options.rounds===INFINITY_ROUNDS&&shared.options.healthCapacity&&shared.users.every(user=>shared.dead?.get(user.id))){await this.finishRoom(shared,now);return;}
      if(shared.matchEndsAt!==undefined&&now>=shared.matchEndsAt){await this.finishRoom(shared,shared.matchEndsAt);return;}
    }
    if(m.preparing||m.awaitingReady)return;
    if(m.status==='playing'&&(forceTimeout||now>=m.deadline||m.users.every(user=>m.answered.has(user.id)||(m.mode!=='room'&&m.options.healthCapacity&&m.health.get(user.id)===0)))){
      const health=new Map(m.health),changes=new Map<string,LifeState|null>();
      if((forceTimeout||now>=m.deadline)&&m.options.healthCapacity)for(const user of m.users)if(!m.answered.has(user.id)){
        const next=Math.max(0,health.get(user.id)!-timeoutHealthCost(m.wrongAttempts.get(user.id)??0));health.set(user.id,next);changes.set(user.id,this.lifeChange(m,user.id,next,Math.min(now,m.deadline)));
      }
      const depleted=Boolean(m.mode!=='room'&&m.options.healthCapacity&&m.users.every(user=>health.get(user.id)===0));
      await this.db.transaction(async sql=>{
        if(forceTimeout)await sql.query('UPDATE match_rounds SET deadline=$3 WHERE match_id=$1 AND round=$2',[m.id,m.round,new Date(now)]);
        for(const [userId,value]of health)if(value!==m.health.get(userId)){await sql.query('UPDATE match_players SET health=$3 WHERE match_id=$1 AND user_id=$2',[m.id,userId,value]);await this.writeLife(sql,m,userId,changes.get(userId)??null);}
        if(m.mode==='room')for(const user of m.users)await this.closePlayerRound(sql,m,user.id,Math.min(now,m.deadline));
        if(depleted)await sql.query("UPDATE matches SET status='finished',finished_at=now() WHERE id=$1 AND status='active'",[m.id]);
      });
      if(forceTimeout)m.deadline=now;
      for(const [userId,value]of health)this.applyLife(m,userId,value,changes.get(userId)??null);
      m.status=depleted?'finished':'reveal';m.nextAt=now+2000;m.touchedAt=now;this.broadcast(m);
    }else if(m.status==='reveal'&&now>=m.nextAt){
      if(m.master)this.extendRoomArtworks(m,m.round+20);
      if(m.round+1>=m.artworks.length){
        if(m.mode==='room'){await this.finishRoom(m,now);return;}
        await this.db.query("UPDATE matches SET status='finished',finished_at=now() WHERE id=$1 AND status='active'",[m.id]);m.status='finished';m.touchedAt=now;
      }else{
        const following=m.artworks[m.round+1]!;
        if(this.generated.isGenerated(following)){
          this.warmNext(m);
          if(!m.preparedNext?.ready){
            if((m.preparedNext?.failures??0)>=3){
              if(m.mode==='room'){await this.finishRoom(m,now,'interrupted');return;}
              await this.db.query("UPDATE matches SET status='interrupted',finished_at=now() WHERE id=$1 AND status='active'",[m.id]);m.status='finished';m.touchedAt=now;this.broadcast(m);
            }
            return;
          }
        }
        const next=m.round+1,startsAt=now,deadline=startsAt+m.options.roundSeconds*1000;
        await this.db.transaction(async sql=>{
          await sql.query('INSERT INTO match_rounds(match_id,round,artwork_id,starts_at,deadline) VALUES($1,$2,$3,$4,$5)'+(m.mode==='room'?' ON CONFLICT(match_id,round) DO NOTHING':''),[m.id,next,m.artworks[next]!.id,new Date(startsAt),new Date(deadline)]);
          if(m.mode==='room')for(const user of m.users)await sql.query('INSERT INTO match_player_rounds(match_id,round,user_id,starts_at,deadline) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[m.id,next,user.id,new Date(startsAt),new Date(deadline)]);
        });
        Object.assign(m,{round:next,startsAt,deadline,nextAt:0,status:'playing',answered:new Set(),wrongAttempts:new Map(),skipped:new Set(),touchedAt:now,currentImageKey:m.preloadedImage?.round===next?m.preloadedImage.key:undefined,preloadedImage:undefined,preparedNext:undefined});this.warmNext(m);
      }
      this.broadcast(m);
    }
  }
  private view(m:Match):MatchView{
    const shared=m.master??m,artwork=m.artworks[m.round]!,now=Date.now();
    return {id:m.id,mode:m.mode,returnBlocked:Boolean(m.returnBlocked),returnBlockedAt:m.returnBlockedAt,healthEnabled:Boolean(m.options.healthCapacity),healthCapacity:m.options.healthCapacity,status:shared.status==='finished'?'finished':m.status,difficulty:m.options.difficulty,round:m.round,totalRounds:m.options.rounds===INFINITY_ROUNDS?m.artworks.length:m.options.rounds,endless:m.options.rounds===INFINITY_ROUNDS,
      awaitingReady:Boolean(m.awaitingReady),loadingDeadlineAt:shared.loadingDeadlineAt,loadingForceStartAt:shared.loadingDeadlineAt===undefined?undefined:shared.loadingDeadlineAt-ROOM_LOADING_TIMEOUT_MS+ROOM_LOADING_FORCE_START_MS,...(m.mode==='room'?{hostId:shared.users[0]?.id,roomCode:shared.roomCode}:{}),loadedPlayers:shared.readyUsers?.size??(m.awaitingReady?0:shared.users.length),matchEndsAt:shared.matchEndsAt,matchSeconds:shared.options.matchSeconds,skipped:m.users.length===1?Boolean(m.skipped?.has(m.users[0]!.id)):undefined,
      serverNow:now,startsAt:m.startsAt,deadline:m.deadline,nextAt:m.nextAt,imageUrl:`/api/matches/${m.id}/rounds/${m.round}/image`,...(m.currentImageKey&&now>=m.startsAt?{imageKey:m.currentImageKey.toString('base64')}:{}),answer:['reveal','finished'].includes(m.status)?{id:artwork.song_id,title:artwork.title}:null,
      players:shared.users.map(user=>{const lane=shared.lanes?.get(user.id)??m,since=shared.aliveSince?.get(user.id)??null;return {...user,score:shared.scores.get(user.id)!,answered:lane.answered.has(user.id),health:shared.health.get(user.id)!,round:lane.round,skipped:Boolean(lane.skipped?.has(user.id)),...(m.mode==='room'?{dead:shared.dead?.get(user.id)??false,survivalMs:(shared.survivalMs?.get(user.id)??0)+(since===null?0:Math.max(0,Math.min(now,shared.matchEndsAt??now)-since))}:{})};}),rulesVersion:m.rulesVersion};
  }
  async tick(){
    await this.queue.run(async()=>{for(const [id,m]of this.matches){
      if(m.lanes){for(const lane of m.lanes.values()){await this.advance(lane,Date.now());if(m.status!=='finished')this.warmNext(lane);}}
      else{await this.advance(m,Date.now());this.warmNext(m);}
      if(m.status==='finished'&&Date.now()-m.touchedAt>3600_000)this.matches.delete(id);
    }});
  }
  async result(id: string, userId: string) {
    const { rows } = await this.db.query('SELECT m.id,m.mode,m.difficulty,m.status,m.rules_version,m.created_at,m.finished_at,m.health_capacity,m.round_count,m.round_seconds,m.match_seconds,p.result_published AS published FROM matches m JOIN match_players p ON p.match_id=m.id WHERE m.id=$1 AND p.user_id=$2', [id,userId]);
    if (!rows[0]) throw new NotFoundException();
    const players=(await this.db.query(`SELECT p.user_id,u.name,p.score,p.correct,p.health,p.dead,
      (p.survival_ms+CASE WHEN p.alive_since IS NULL THEN 0 ELSE GREATEST(0,EXTRACT(EPOCH FROM(LEAST(COALESCE(m.finished_at,now()),COALESCE(m.match_started_at+m.match_seconds*interval '1 second',now()))-p.alive_since))*1000)::int END) AS "survivalMs",
      CASE WHEN u.avatar_key IS NOT NULL THEN '/api/users/'||u.id||'/avatar?v='||u.avatar_key END AS "avatarUrl"
      FROM match_players p JOIN users u ON u.id=p.user_id JOIN matches m ON m.id=p.match_id WHERE p.match_id=$1 ORDER BY p.dead,p.score DESC,p.user_id`,[id])).rows;
    const rounds=(await this.db.query<Omit<ResultRoundView,'imageUrl'>>(`SELECT r.round,a.difficulty,
      CASE WHEN g.correct THEN s.title ELSE NULL END AS title,
      COALESCE(g.correct,false) AS correct,COALESCE(g.score,0)::int AS score,
      COALESCE(g.attempts,0)::int AS attempts,COALESCE(g.wrong_attempts,0)::int AS "wrongAttempts",
      CASE WHEN g.correct THEN g.elapsed_ms ELSE GREATEST(0,EXTRACT(EPOCH FROM(LEAST(COALESCE(pr.closed_at,pr.deadline,r.deadline),COALESCE(m.finished_at,CASE WHEN m.status='active' THEN now() ELSE COALESCE(pr.deadline,r.deadline) END))-COALESCE(pr.starts_at,r.starts_at)))*1000)::int END AS "elapsedMs",
      (SELECT count(*)::int FROM revealed_hints h WHERE h.match_id=r.match_id AND h.round=r.round AND h.user_id=$2) AS "hintsUsed",
      (SELECT count(*)::int FROM noise_hits n WHERE n.match_id=r.match_id AND n.round=r.round AND n.user_id=$2) AS "noiseHits"
      FROM match_rounds r JOIN matches m ON m.id=r.match_id JOIN artworks a ON a.id=r.artwork_id JOIN songs s ON s.id=a.song_id
      LEFT JOIN match_player_rounds pr ON pr.match_id=r.match_id AND pr.round=r.round AND pr.user_id=$2
      LEFT JOIN LATERAL (SELECT bool_or(correct) AS correct,sum(score) AS score,
        count(*) AS attempts,count(*) FILTER(WHERE NOT correct) AS wrong_attempts,min(elapsed_ms) FILTER(WHERE correct) AS elapsed_ms
        FROM guesses WHERE match_id=r.match_id AND round=r.round AND user_id=$2) g ON true
      WHERE r.match_id=$1 AND (m.mode<>'room' OR m.rules_version<>$3 OR pr.user_id IS NOT NULL) ORDER BY r.round`,[id,userId,ROOM_RULES_VERSION])).rows;
    const settled=['finished','interrupted'].includes(rows[0].status);
    return { ...rows[0],players,published:Boolean(rows[0].published),endless:rows[0].round_count===INFINITY_ROUNDS,rounds:rounds.map(r=>({...r,imageUrl:settled?`/api/matches/${id}/rounds/${r.round}/result-image`:null})) };
  }
  async resultImage(id:string,round:number,userId:string){
    const row=(await this.db.query(`SELECT a.*,
      CASE WHEN a.original_preview_key IS NOT NULL AND EXISTS(SELECT 1 FROM guesses g WHERE g.match_id=r.match_id AND g.round=r.round AND g.user_id=$3 AND g.correct)
        THEN a.original_preview_key ELSE a.storage_key END AS key,
      CASE WHEN a.original_preview_key IS NOT NULL AND EXISTS(SELECT 1 FROM guesses g WHERE g.match_id=r.match_id AND g.round=r.round AND g.user_id=$3 AND g.correct)
        THEN 'image/webp' ELSE a.mime END AS served_mime,
      EXISTS(SELECT 1 FROM guesses g WHERE g.match_id=r.match_id AND g.round=r.round AND g.user_id=$3 AND g.correct) AND a.original_preview_key IS NOT NULL AS original
      FROM match_rounds r JOIN matches m ON m.id=r.match_id JOIN match_players p ON p.match_id=m.id AND p.user_id=$3
      JOIN artworks a ON a.id=r.artwork_id WHERE m.id=$1 AND r.round=$2 AND m.status IN ('finished','interrupted')`,[id,round,userId])).rows[0];
    if(!row)throw new NotFoundException('Result artwork is not available');
    if(row.original)return {key:row.key as string,mime:row.served_mime as string} as ServedArtwork;
    return this.generated.render(id,round,row as Artwork);
  }
  async setResultPublication(id:string,userId:string,published:boolean){
    return this.db.transaction(async sql=>{
      const match=(await sql.query('SELECT m.* FROM matches m JOIN match_players p ON p.match_id=m.id WHERE m.id=$1 AND p.user_id=$2 FOR UPDATE OF p',[id,userId])).rows[0];
      if(!match)throw new NotFoundException('Result not available');
      if(published&&(match.status!=='finished'||match.mode!=='practice'||match.round_count!==INFINITY_ROUNDS||!['in','at'].includes(match.difficulty)||!match.health_enabled||![20,50].includes(match.health_capacity)||match.rules_version!==RULES_VERSION))throw new ConflictException('Only completed Infinity results can be published');
      await sql.query('UPDATE match_players SET result_published=$3 WHERE match_id=$1 AND user_id=$2',[id,userId,published]);
      if(published)await sql.query(`UPDATE match_players p SET result_published=false FROM matches previous_match
        WHERE p.match_id=previous_match.id AND p.user_id=$1 AND p.result_published AND previous_match.rules_version<>$2
        AND previous_match.mode='practice' AND previous_match.round_count=$3 AND previous_match.difficulty=$4
        AND previous_match.health_capacity=$5 AND previous_match.round_seconds=$6`,[userId,RULES_VERSION,INFINITY_ROUNDS,match.difficulty,match.health_capacity,match.round_seconds]);
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
    return this.queue.run(async()=>{for(const m of this.matches.values())if(m.users.some(u=>u.id===userId)){const personal=m.lanes?.get(userId)??m;await this.advance(personal,Date.now());if(m.users.some(u=>u.id===userId)&&(personal.status==='playing'||personal.status==='reveal'))return {id:m.id,mode:m.mode};}return null;});
  }
  async roomPerformances(userIds:string[],difficulty:RoomPerformanceView['difficulty']):Promise<RoomPerformanceView> {
    const best=(await this.db.query<{id:string;score:number;correct:number}>(`SELECT DISTINCT ON(p.user_id) p.user_id AS id,p.score,p.correct
      FROM match_players p JOIN matches m ON m.id=p.match_id
      WHERE p.user_id=ANY($1::uuid[]) AND p.result_published AND m.status='finished' AND m.mode='practice'
        AND m.rules_version=$3 AND m.round_count=$4 AND m.difficulty=$2 AND m.health_enabled AND m.health_capacity IN(20,50)
      ORDER BY p.user_id,p.score DESC,p.correct DESC,m.created_at DESC,m.id`,[userIds,difficulty,RULES_VERSION,INFINITY_ROUNDS])).rows;
    const byUser=new Map(best.map(({id,...result})=>[id,result]));
    return {difficulty,players:userIds.map(id=>({id,best:byUser.get(id)??null}))};
  }
  async leaderboard(options:InfinityLeaderboardOptions) {
    const entries=(await this.db.query<LeaderboardEntry>(`WITH best AS (
      SELECT DISTINCT ON(p.user_id) p.user_id,p.score,p.correct,m.id AS match_id,m.rules_version<>$5 AS "isLegacy" FROM match_players p JOIN matches m ON m.id=p.match_id
      WHERE p.result_published AND m.status='finished' AND m.health_enabled AND m.health_capacity=$4 AND m.difficulty=$1 AND m.mode='practice' AND m.round_count=$2 AND m.round_seconds=$3
      ORDER BY p.user_id,(m.rules_version=$5) DESC,p.score DESC,p.correct DESC,m.created_at DESC,m.id
    ) SELECT '0'::text AS rank,u.id,u.name,u.password_hash IS NULL AS "isGuest",b."isLegacy",
      CASE WHEN u.avatar_key IS NOT NULL THEN '/api/users/'||u.id||'/avatar?v='||u.avatar_key END AS "avatarUrl",b.score,b.correct,
      (SELECT count(*)::int FROM match_rounds r WHERE r.match_id=b.match_id) AS "totalRounds"
    FROM best b JOIN users u ON u.id=b.user_id ORDER BY b."isLegacy",b.score DESC,u.id LIMIT 100`,[options.difficulty,INFINITY_ROUNDS,options.roundSeconds,options.healthCapacity,RULES_VERSION])).rows;
    return withReferencePlayer(entries,options.difficulty);
  }
}


