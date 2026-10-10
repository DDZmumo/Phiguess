import { Logger, OnModuleDestroy } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { MatchView, RoomCode, RoomView, UUID } from '../../../packages/contracts/src';
import { AuthService, User } from './auth';
import { configuration } from './config';
import { Events } from './events';
import { GamesService } from './games';
import { RoomsService } from './rooms';

@WebSocketGateway({ maxHttpBufferSize: 8192, transports:['websocket','polling'] })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private logger = new Logger(RealtimeGateway.name);
  private onMatch = (view: MatchView) => this.server.to(`match:${view.id}`).emit('match:state',view);
  private onRoom = (view: RoomView) => {
    // Departed members must stop receiving subsequent room snapshots.
    for (const socket of this.server.sockets.sockets.values()) {
      if (socket.rooms.has(`room:${view.code}`) && !view.players.some(p=>p.id===socket.data.user?.id)) socket.leave(`room:${view.code}`);
    }
    this.server.to(`room:${view.code}`).emit('room:state',view);
  };
  private onEmpty = (code: string) => this.server.in(`room:${code}`).socketsLeave(`room:${code}`);
  constructor(private readonly auth: AuthService, private readonly rooms: RoomsService, private readonly games: GamesService, private readonly events: Events) {}
  afterInit(server: Server) {
    server.use(async (socket,next) => {
      try {
        const origin = socket.handshake.headers.origin;
        if (origin && origin!==configuration().PUBLIC_ORIGIN) throw new Error('Origin rejected');
        socket.data.user=await this.auth.authenticate(socket.handshake.auth.token);
        const existing = [...server.sockets.sockets.values()].filter(s=>s.data.user?.id===socket.data.user.id).length;
        if (existing>=3) throw new Error('Too many connections');
        next();
      } catch { next(new Error('Connection rejected')); }
    });
    this.events.on('match',this.onMatch); this.events.on('room',this.onRoom); this.events.on('room:empty',this.onEmpty);
  }
  handleConnection(socket: Socket) {
    // Revalidate sessions periodically so expiry/logout also revokes broadcasts.
    const timer = setInterval(() => { void this.auth.authenticate(socket.handshake.auth.token).catch(()=>socket.disconnect(true)); },30_000);
    timer.unref(); socket.once('disconnect',()=>clearInterval(timer));
  }
  private async checked<T>(socket: Socket, fn: (user: User)=>Promise<T>|T) {
    try {
      const now=Date.now();
      if (now-(socket.data.windowAt ?? 0)>60_000) { socket.data.windowAt=now; socket.data.requests=0; }
      if ((socket.data.requests=(socket.data.requests ?? 0)+1)>60) return {ok:false,error:'Rate limit exceeded'};
      const user=await this.auth.authenticate(socket.handshake.auth.token);
      return {ok:true,data:await fn(user)};
    } catch (error) {
      this.logger.debug('Rejected socket subscription');
      return {ok:false,error:error instanceof Error ? error.message : 'Invalid request'};
    }
  }
  @SubscribeMessage('room:subscribe') subscribeRoom(@ConnectedSocket() socket: Socket,@MessageBody() body: unknown) {
    return this.checked(socket,async user => {
      const {code}=z.object({code:RoomCode}).strict().parse(body);
      const view=this.rooms.snapshot(code,user.id);
      for (const room of socket.rooms) if (room.startsWith('room:')) await socket.leave(room);
      await socket.join(`room:${code}`); return view;
    });
  }
  @SubscribeMessage('match:subscribe') subscribeMatch(@ConnectedSocket() socket: Socket,@MessageBody() body: unknown) {
    return this.checked(socket,async user => {
      const {id}=z.object({id:UUID}).strict().parse(body);
      const view=await this.games.snapshot(id,user.id);
      for (const room of socket.rooms) if (room.startsWith('match:')) await socket.leave(room);
      await socket.join(`match:${id}`); return view;
    });
  }
  onModuleDestroy() { this.events.off('match',this.onMatch); this.events.off('room',this.onRoom); this.events.off('room:empty',this.onEmpty); }
}
