import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { randomInt,randomUUID } from 'node:crypto';
import { resolveHealthCapacity, type MatchView, type RoomOptions, type RoomView } from '../../../packages/contracts/src';
import { SerialQueue } from '../../../packages/game-core/src';
import type { User } from './auth';
import { Events,type RoomLoadingRemoval } from './events';
import { GamesService } from './games';

interface Room extends RoomView { touchedAt: number }
const scopeKey=(scopes:RoomOptions['artworkScopes'])=>[...new Set(scopes??['main','non-main','removed','april-fools'])].sort().join('|');
@Injectable()
export class RoomsService implements OnModuleDestroy {
  private rooms = new Map<string, Room>();
  private queue = new SerialQueue();
  private timer = setInterval(() => this.sweep(), 60_000);
  constructor(private readonly games: GamesService, private readonly events: Events) { this.timer.unref();this.events.on('match',this.onMatch);this.events.on('room:loading-removed',this.onLoadingRemoved); }
  private onLoadingRemoved=(notice:RoomLoadingRemoval)=>{
    void this.queue.run(async()=>{
      for(const room of this.rooms.values())if(room.matchId===notice.matchId){
        room.players=room.players.filter(player=>!notice.userIds.includes(player.id));
        if(!room.players.length){this.rooms.delete(room.code);this.events.emit('room:empty',room.code);}
        else{if(!room.players.some(player=>player.id===room.hostId))this.assignHost(room,room.players[0]!.id,'loading');this.publish(room);}
      }
    });
  };
  private onMatch=(match:MatchView)=>{
    if(!['finished','interrupted'].includes(match.status))return;
    void this.queue.run(async()=>{for(const room of this.rooms.values())if(room.matchId===match.id){room.matchId=null;room.starting=false;for(const player of room.players)player.ready=false;this.publish(room);}});
  };
  onModuleDestroy() { clearInterval(this.timer);this.events.off('match',this.onMatch);this.events.off('room:loading-removed',this.onLoadingRemoved); }
  private sweep() {
    for (const [code,room] of this.rooms) if (Date.now()-room.touchedAt > 3*3600_000) this.rooms.delete(code);
  }
  private publish(room: Room): RoomView {
    room.touchedAt = Date.now();
    const view = this.view(room); this.events.room(view); return view;
  }
  private view(room: Room): RoomView { return { code: room.code,hostId: room.hostId,...(room.hostChange?{hostChange:{...room.hostChange}}:{}),options: { ...room.options },matchId: room.matchId,starting:Boolean(room.starting),startError:room.startError??null,players: room.players.map(p => ({ ...p })) }; }
  private assignHost(room:Room,hostId:string,reason:NonNullable<RoomView['hostChange']>['reason']){
    room.hostChange={eventId:randomUUID(),hostId,previousHostId:room.hostId,...(room.matchId?{matchId:room.matchId}:{}),reason};room.hostId=hostId;
  }
  private find(code: string) { const room = this.rooms.get(code); if (!room) throw new NotFoundException('Room not found'); return room; }
  private member(code: string, userId: string) { const room = this.find(code),reason=room.matchId?this.games.loadingRemovalReason(room.matchId,userId):undefined;if(reason)throw new GoneException({message:'Room loading timed out',code:'ROOM_LOADING_REMOVED',matchId:room.matchId,roomCode:code,reason});if(!room.players.some(p=>p.id===userId))throw new ForbiddenException();return room; }
  snapshot(code: string, userId: string) { return this.view(this.member(code,userId)); }
  performances(code:string,userId:string){
    const room=this.member(code,userId);
    return this.games.roomPerformances(room.players.map(player=>player.id),room.options.difficulty==='in'?'in':'at');
  }
  private ensureFree(userId: string) { if ([...this.rooms.values()].some(r => r.players.some(p => p.id === userId))) throw new ConflictException('Leave your existing room first'); }
  create(user: User, options: RoomOptions) {
    return this.queue.run(async () => {
      this.sweep();this.ensureFree(user.id);
      if (this.rooms.size >= 200) throw new ServiceUnavailableException('Room limit reached');
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code: string;
      do { code = Array.from({length:6},() => chars[randomInt(chars.length)]).join(''); } while (this.rooms.has(code));
      const capacity=resolveHealthCapacity(options.difficulty,options.healthCapacity,options.healthEnabled);
      const room: Room = { code,hostId:user.id,options:{...options,maxPlayers:options.maxPlayers??8,healthEnabled:capacity>0,healthCapacity:capacity},matchId:null,players:[{...user,ready:false}],touchedAt:Date.now() };
      this.rooms.set(code,room); return this.publish(room);
    });
  }
  join(code: string, user: User) {
    return this.queue.run(async () => {
      const room = this.find(code);
      if (room.players.some(p=>p.id===user.id)) return this.view(room);
      this.ensureFree(user.id);
      if (room.matchId) throw new ConflictException('Room has already started');
      if (room.players.length >= (room.options.maxPlayers??8)) throw new ConflictException('Room is full');
      room.players.push({...user,ready:false}); return this.publish(room);
    });
  }
  ready(code: string, userId: string, ready: boolean) {
    return this.queue.run(async () => {
      const room = this.member(code,userId);
      if (room.matchId) throw new ConflictException('Match already started');
      room.players.find(p=>p.id===userId)!.ready=ready; return this.publish(room);
    });
  }
  configure(code: string, userId: string, options: RoomOptions) {
    return this.queue.run(async () => {
      const room = this.member(code,userId);
      if (room.hostId!==userId) throw new ForbiddenException('Only host can change room options');
      if (room.matchId) throw new ConflictException('Match already started');
      const maxPlayers=options.maxPlayers??room.options.maxPlayers??8;
      if(maxPlayers<room.players.length)throw new ConflictException('Player limit cannot be less than current players');
      const capacity=resolveHealthCapacity(options.difficulty,options.healthCapacity,options.healthEnabled);
      options={...options,maxPlayers,matchSeconds:options.matchSeconds??room.options.matchSeconds??180,healthEnabled:capacity>0,healthCapacity:capacity};
      if (room.options.difficulty===options.difficulty && room.options.rounds===options.rounds && room.options.roundSeconds===options.roundSeconds && room.options.healthCapacity===options.healthCapacity&&room.options.maxPlayers===maxPlayers&&(room.options.matchSeconds??180)===options.matchSeconds&&scopeKey(room.options.artworkScopes)===scopeKey(options.artworkScopes)) return this.view(room);
      room.options={...options};
      for (const player of room.players) player.ready=false;
      return this.publish(room);
    });
  }
  private manageablePlayer(code:string,hostId:string,userId:string){
    const room=this.member(code,hostId);
    if(room.hostId!==hostId)throw new ForbiddenException('Only host can manage players');
    if(room.matchId||room.starting)throw new ConflictException('Match already started');
    if(userId===hostId)throw new BadRequestException('Cannot manage yourself');
    if(!room.players.some(player=>player.id===userId))throw new NotFoundException('Player is not in room');
    return room;
  }
  kick(code:string,hostId:string,userId:string){
    return this.queue.run(async()=>{
      const room=this.manageablePlayer(code,hostId,userId);room.players=room.players.filter(player=>player.id!==userId);
      this.events.emit('room:member-removed',{code,userIds:[userId],reason:'kicked'});
      return this.publish(room);
    });
  }
  transferHost(code:string,hostId:string,userId:string){
    return this.queue.run(async()=>{const room=this.manageablePlayer(code,hostId,userId);this.assignHost(room,userId,'transfer');return this.publish(room);});
  }
  start(code: string, userId: string,waitForReady=false) {
    return this.queue.run(async () => {
      const room = this.member(code,userId);
      if (room.hostId!==userId) throw new ForbiddenException('Only host can start');
      if (room.matchId) throw new ConflictException('Match already started');
      if (room.players.length<2 || room.players.some(p=>!p.ready)) throw new ConflictException('At least two ready players required');
      room.starting=true;room.startError=null;this.publish(room);
      try{
        const {maxPlayers,...options}=room.options;
        const participants=[room.players.find(player=>player.id===room.hostId)!,...room.players.filter(player=>player.id!==room.hostId)];
        const match=await this.games.createRoom(participants.map(({id,name,avatarUrl})=>({id,name,avatarUrl})),options,waitForReady,room.code);
        room.matchId=match.id;room.starting=false;this.publish(room);return match;
      }catch(error){room.starting=false;room.startError='题目准备失败，请重新准备后重试。';for(const player of room.players)player.ready=false;this.publish(room);throw error;}
    });
  }
  leave(code: string, userId: string) {
    return this.queue.run(async () => {
      const room = this.member(code,userId);
      // Loading departures do not block others; once play starts, history is preserved.
      room.players=room.players.filter(p=>p.id!==userId);
      if(room.matchId)await this.games.leaveLoadingRoom(room.matchId,userId);
      if (!room.players.length) { this.rooms.delete(code); this.events.emit('room:empty',code); return { left:true }; }
      if (room.hostId===userId) this.assignHost(room,room.players[0]!.id,'leave');
      this.publish(room); return { left:true };
    });
  }
}
