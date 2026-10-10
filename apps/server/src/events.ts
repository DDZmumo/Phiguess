import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { MatchView, RoomView } from '../../../packages/contracts/src';

@Injectable()
export class Events extends EventEmitter {
  match(view: MatchView) { this.emit('match', view); }
  room(view: RoomView) { this.emit('room', view); }
}
