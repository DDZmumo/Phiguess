import { ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { resolveHealthCapacity, type GameOptions, type RoomView } from '../../../packages/contracts/src';
import { SerialQueue } from '../../../packages/game-core/src';
import type { User } from './auth';
import { Events } from './events';
import { GamesService } from './games';

interface Room extends RoomView { touchedAt: number }
@Injectable()
export class RoomsService implements OnModuleDestroy {
  private rooms = new Map<string, Room>();
  private queue = new SerialQueue();
  private timer = setInterval(() => this.sweep(), 60_000);
  constructor(private readonly games: GamesService, private readonly events: Events) { this.timer.unref(); }
  onModuleDestroy() { clearInterval(this.timer); }
  private sweep() {
    for (const [code,room] of this.rooms) if (Date.now()-room.touchedAt > 3*3600_000) this.rooms.delete(code);
  }
  private publish(room: Room): RoomView {
    room.touchedAt = Date.now();
    const view = this.view(room); this.events.room(view); return view;
  }
  private view(room: Room): RoomView { return { code: room.code,hostId: room.hostId,options: { ...room.options },matchId: room.matchId,players: room.players.map(p => ({ ...p })) }; }
  private find(code: string) { const room = this.rooms.get(code); if (!room) throw new NotFoundException('Room not found'); return room; }
  private member(code: string, userId: string) { const room = this.find(code); if (!room.players.some(p => p.id===userId)) throw new ForbiddenException(); return room; }
  snapshot(code: string, userId: string) { return this.view(this.member(code,userId)); }
  private ensureFree(userId: string) { if ([...this.rooms.values()].some(r => r.players.some(p => p.id === userId))) throw new ConflictException('Leave your existing room first'); }
  create(user: User, options: GameOptions) {
    return this.queue.run(async () => {
      this.sweep(); this.ensureFree(user.id);
      if (this.rooms.size >= 200) throw new ServiceUnavailableException('Room limit reached');
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code: string;
      do { code = Array.from({length:6},() => chars[randomInt(chars.length)]).join(''); } while (this.rooms.has(code));
      const capacity=resolveHealthCapacity(options.difficulty,options.healthCapacity,options.healthEnabled);
      const room: Room = { code,hostId:user.id,options:{...options,healthEnabled:capacity>0,healthCapacity:capacity},matchId:null,players:[{...user,ready:false}],touchedAt:Date.now() };
      this.rooms.set(code,room); return this.publish(room);
    });
  }
  join(code: string, user: User) {
    return this.queue.run(async () => {
      const room = this.find(code);
      if (room.players.some(p=>p.id===user.id)) return this.view(room);
      this.ensureFree(user.id);
      if (room.matchId) throw new ConflictException('Room has already started');
      if (room.players.length >= 8) throw new ConflictException('Room is full');
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
  configure(code: string, userId: string, options: GameOptions) {
    return this.queue.run(async () => {
      const room = this.member(code,userId);
      if (room.hostId!==userId) throw new ForbiddenException('Only host can change room options');
      if (room.matchId) throw new ConflictException('Match already started');
      const capacity=resolveHealthCapacity(options.difficulty,options.healthCapacity,options.healthEnabled);
      options={...options,healthEnabled:capacity>0,healthCapacity:capacity};
      if (room.options.difficulty===options.difficulty && room.options.rounds===options.rounds && room.options.roundSeconds===options.roundSeconds && room.options.healthCapacity===options.healthCapacity) return this.view(room);
      room.options={...options};
      for (const player of room.players) player.ready=false;
      return this.publish(room);
    });
  }
  start(code: string, userId: string) {
    return this.queue.run(async () => {
      const room = this.member(code,userId);
      if (room.hostId!==userId) throw new ForbiddenException('Only host can start');
      if (room.matchId) throw new ConflictException('Match already started');
      if (room.players.length<2 || room.players.some(p=>!p.ready)) throw new ConflictException('At least two ready players required');
      const match = await this.games.createRoom(room.players.map(({id,name})=>({id,name})),room.options);
      room.matchId=match.id; this.publish(room); return match;
    });
  }
  leave(code: string, userId: string) {
    return this.queue.run(async () => {
      const room = this.member(code,userId);
      // Leaving never cancels a match or removes its historical participants.
      room.players=room.players.filter(p=>p.id!==userId);
      if (!room.players.length) { this.rooms.delete(code); this.events.emit('room:empty',code); return { left:true }; }
      if (room.hostId===userId) room.hostId=room.players[0]!.id;
      this.publish(room); return { left:true };
    });
  }
}
