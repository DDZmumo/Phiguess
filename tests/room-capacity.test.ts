import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RoomOptions,GameOptions} from '../packages/contracts/src';
import {RoomsService} from '../apps/server/src/rooms';
import {Events} from '../apps/server/src/events';
import type {GamesService} from '../apps/server/src/games';

test('room capacity is an optional integer from two through eight, isolated from solo options',()=>{
 for(const maxPlayers of [2,4,8])assert.equal(RoomOptions.parse({maxPlayers}).maxPlayers,maxPlayers);
 for(const maxPlayers of [1,9,2.5,'4',null])assert.equal(RoomOptions.safeParse({maxPlayers}).success,false);
 assert.equal(RoomOptions.parse({}).maxPlayers,undefined);
 assert.equal(RoomOptions.safeParse({maxPlayers:4,unknown:true}).success,false);
 assert.equal(GameOptions.safeParse({maxPlayers:4}).success,false);
 const at=RoomOptions.parse({maxPlayers:3,difficulty:'at',rounds:5,roundSeconds:60,healthCapacity:0});
 assert.equal(at.maxPlayers,3);assert.equal(at.rounds,0);assert.equal(at.roundSeconds,30);assert.equal(at.healthCapacity,20);
});

test('room capacity broadcasts, enforces joins and preserves current members',async()=>{
 const events=new Events(),broadcasts:any[]=[];events.on('room',view=>broadcasts.push(view));
 const rooms=new RoomsService({} as GamesService,events),host={id:randomUUID(),name:'Host'},guest={id:randomUUID(),name:'Guest'},third={id:randomUUID(),name:'Third'};
 try{
  const room=await rooms.create(host,RoomOptions.parse({maxPlayers:2}));
  await rooms.join(room.code,guest);
  await assert.rejects(rooms.join(room.code,third),/Room is full/);
  await assert.rejects(rooms.configure(room.code,guest.id,{...room.options,maxPlayers:8}),/Only host/);
  await rooms.ready(room.code,host.id,true);await rooms.ready(room.code,guest.id,true);
  const expanded=await rooms.configure(room.code,host.id,{...room.options,maxPlayers:8});
  assert.equal(expanded.options.maxPlayers,8);assert.ok(expanded.players.every(player=>!player.ready));
  assert.equal(broadcasts.at(-1).options.maxPlayers,8);
  await rooms.join(room.code,third);
  await assert.rejects(rooms.configure(room.code,host.id,{...room.options,maxPlayers:2}),/current players/);
  assert.equal(rooms.snapshot(room.code,host.id).players.length,3);
  const updated=await rooms.configure(room.code,host.id,{...room.options,maxPlayers:4});
  const legacy=await rooms.configure(room.code,host.id,GameOptions.parse({difficulty:'hd'}));
  assert.equal(updated.options.maxPlayers,4);assert.equal(legacy.options.maxPlayers,4);
 }finally{rooms.onModuleDestroy();events.removeAllListeners();}
});
