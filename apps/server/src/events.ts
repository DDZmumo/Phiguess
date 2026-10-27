import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { MatchView, RoomRemovalNotice, RoomView } from '../../../packages/contracts/src';

export interface RoomLoadingRemoval {matchId:string;code?:string;userIds:string[];reason:RoomRemovalNotice['reason']}
export interface RoomMemberRemoval {code:string;userIds:string[];reason:'kicked'}

@Injectable()
export class Events extends EventEmitter {
  match(view: MatchView,userId?:string) { this.emit('match', view,userId); }
  room(view: RoomView) { this.emit('room', view); }
}
