import {useStore} from './store';
import type {RoomRemovalNotice} from '../../../packages/contracts/src';

const key='phiguess-room-notice';
export const roomLoadingTimeoutMessage='曲绘加载超时，已退出房间。可以加入其他未开始的房间，原房间需本局结束后才能重新加入。';
export function readRoomNotice(){try{return sessionStorage.getItem(key)??'';}catch{return '';}}
export function clearRoomNotice(){try{sessionStorage.removeItem(key);}catch{}}
export function returnAfterRoomRemoval(reason:RoomRemovalNotice['reason'],matchId?:string,code?:string,roomEpoch?:number){
 const current=useStore.getState(),routeMatches=Boolean(matchId&&location.hash===`#/play/${matchId}`);
 if(roomEpoch!==undefined&&current.roomEpoch!==roomEpoch)return;
 if(matchId&&current.matchId&&current.matchId!==matchId&&!routeMatches)return;
 if(current.matchId!==matchId&&!routeMatches&&(!code||current.roomCode!==code))return;
 if(matchId&&current.matchId===matchId)current.setMatch(null);
 if(code?current.roomCode===code:current.matchId===matchId||routeMatches&&!current.matchId)current.setRoom(null);
 const message=reason==='loading-timeout'?roomLoadingTimeoutMessage:reason==='forced-start'?'房主已强制开始，未完成加载的玩家已退出房间。你可以加入其他未开始的房间。':reason==='kicked'?'你已被房主移出房间。':'';
 if(message){try{sessionStorage.setItem(key,message);}catch{}window.dispatchEvent(new CustomEvent('phiguess:room-removed',{detail:message}));}
 location.hash='/account';
}
