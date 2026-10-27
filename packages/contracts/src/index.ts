import { z } from 'zod';
export {APP_VERSION,APP_VERSION_LABEL} from './version';

export const Difficulty = z.enum(['ez', 'hd', 'in', 'at']);
export type Difficulty = z.infer<typeof Difficulty>;
// Zero is a JSON-safe request for every available song, rather than a fixed count.
export const INFINITY_ROUNDS=0;
export function roundCountChoices(difficulty:Difficulty):number[] {
  return difficulty==='at'?[INFINITY_ROUNDS]:difficulty==='in'?[5,10,20,INFINITY_ROUNDS]:[5,10,20];
}
export function roundTimeChoices(difficulty:Difficulty):number[] {
  return difficulty==='at'?[30]:difficulty==='in'?[15,30,60]:[30,60,90];
}
export function normalizeChallengeSettings(difficulty:Difficulty,rounds:number,roundSeconds:number) {
  return {rounds:roundCountChoices(difficulty).includes(rounds)?rounds:difficulty==='at'?INFINITY_ROUNDS:5,roundSeconds:roundTimeChoices(difficulty).includes(roundSeconds)?roundSeconds:30};
}
export const RoundIndex=z.number().int().min(0).max(2147483647);
export const UUID = z.string().uuid();
export const GuestInput = z.object({ name: z.string().trim().min(1).max(24) }).strict();
export const LoginInput=z.object({name:z.string().trim().transform(v=>v.normalize('NFKC')).pipe(z.string().min(1).max(24)),password:z.string().min(8).max(128)}).strict();
export const ArtworkScope=z.enum(['main','non-main','removed','april-fools']);
export type ArtworkScope=z.infer<typeof ArtworkScope>;
export const GameOptions = z.object({
  artworkScopes:z.array(ArtworkScope).min(1).max(4).refine(scopes=>scopes.includes('main')||scopes.includes('non-main'),{message:'主线和非主线至少选择一个'}).optional(),
  difficulty: Difficulty.default('ez'),
  rounds: z.number().int().min(0).max(20).default(5),
  roundSeconds: z.number().int().min(15).max(90).default(30),
  healthEnabled: z.boolean().optional(),
  healthCapacity: z.union([z.literal(0),z.literal(20),z.literal(50)]).optional(),
}).strict().refine(v=>v.rounds!==INFINITY_ROUNDS||v.difficulty==='in'||v.difficulty==='at',{path:['rounds'],message:'Infinity is only available in IN and AT'}).transform(v=>v.difficulty==='in'&&v.rounds===INFINITY_ROUNDS?{...v,healthEnabled:true,healthCapacity:(v.healthCapacity===50?50:20) as 20|50}:v.difficulty==='at'?{...v,artworkScopes:undefined,rounds:INFINITY_ROUNDS,roundSeconds:30,healthEnabled:true,healthCapacity:(v.healthCapacity===50?50:20) as 20|50}:v);
export type GameOptions = z.infer<typeof GameOptions>;
export const ROOM_MATCH_SECONDS=[120,180,300,600,1200] as const;
export const ROOM_RULES_VERSION='room-v1-survival';
export const ROOM_LOADING_TIMEOUT_MS=90_000;
export const ROOM_LOADING_FORCE_START_MS=60_000;
export type RoomOptions=GameOptions&{maxPlayers?:number;matchSeconds?:number};
export const RoomOptions=z.object({maxPlayers:z.number().int().min(2).max(8).optional(),matchSeconds:z.union([z.literal(120),z.literal(180),z.literal(300),z.literal(600),z.literal(1200)]).optional()}).passthrough().transform((input,context):RoomOptions=>{
  const {maxPlayers,matchSeconds,...game}=input,parsed=GameOptions.safeParse(game);
  if(!parsed.success){for(const issue of parsed.error.issues)context.addIssue({code:'custom',path:issue.path,message:issue.message});return z.NEVER;}
  return {...parsed.data,...(maxPlayers===undefined?{}:{maxPlayers}),...(matchSeconds!==undefined?{matchSeconds}:parsed.data.rounds===INFINITY_ROUNDS?{matchSeconds:180}:{})};
});
export const InfinityLeaderboardOptions=z.object({
  difficulty:z.enum(['in','at']).default('at'),
  healthCapacity:z.coerce.number().pipe(z.union([z.literal(20),z.literal(50)])).default(20),
  roundSeconds:z.coerce.number().pipe(z.union([z.literal(15),z.literal(30),z.literal(60)])).default(30),
}).strict().refine(v=>v.difficulty!=='at'||v.roundSeconds===30,{path:['roundSeconds'],message:'AT leaderboards use 30 seconds'});
export type InfinityLeaderboardOptions=z.infer<typeof InfinityLeaderboardOptions>;
export function healthBarEnabled(difficulty:Difficulty,optional=true):boolean {
  return difficulty==='at'||(difficulty!=='ez'&&optional);
}
export function resolveHealthCapacity(difficulty:Difficulty,capacity?:0|20|50,enabled=true):0|20|50 {
  if(difficulty==='ez')return 0;
  const selected=capacity??(enabled?20:0);
  return difficulty==='at'&&selected===0?20:selected;
}
export const timeoutHealthCost=(wrongAttempts:number)=>Math.max(3,5-wrongAttempts);
export const correctHealthGain=(hintCount:number)=>[5,3,2,1][Math.min(3,Math.max(0,hintCount))]!;
export const NoiseHitInput=z.object({requestId:UUID,round:RoundIndex}).strict();
export type NoiseHitInput=z.infer<typeof NoiseHitInput>;
export const ResultPublicationInput=z.object({published:z.boolean()}).strict();
export const GuessInput = z.object({ requestId: UUID, round: RoundIndex, songId: UUID.optional(), answer: z.string().trim().min(1).max(200).optional() }).strict().refine(v => Boolean(v.songId) !== Boolean(v.answer), 'Provide songId or answer, but not both');
export type GuessInput = z.infer<typeof GuessInput>;
export const RoomCode = z.string().regex(/^[A-Z2-9]{6}$/);
export const JoinInput = z.object({ code: RoomCode }).strict();
export const ReadyInput = z.object({ ready: z.boolean() }).strict();
export const RoomPlayerInput=z.object({userId:UUID}).strict();
export const RULES_VERSION = 'v5-hint85';
export const DOWNGRADE_HINT_LABEL = '得分减少，难度下降';

export interface PlayerView { id: string; name: string; avatarUrl?:string|null; score: number; answered: boolean; health?:number;dead?:boolean;survivalMs?:number;round?:number;skipped?:boolean }
export interface MatchView {
  loadingDeadlineAt?:number;
  loadingForceStartAt?:number;
  hostId?:string;
  roomCode?:string;
  awaitingReady?:boolean;
  loadedPlayers?:number;
  matchEndsAt?:number;
  matchSeconds?:number;
  skipped?:boolean;
  returnBlocked?:boolean;
  returnBlockedAt?:number;
  id: string; mode: 'practice' | 'room';
  healthEnabled?: boolean;
  healthCapacity?:0|20|50;
  status: 'playing' | 'reveal' | 'finished' | 'interrupted';
  difficulty: Difficulty; round: number; totalRounds: number;
  endless?:boolean;
  serverNow: number; startsAt: number; deadline: number; nextAt: number;
  imageUrl: string | null; answer: { id: string; title: string } | null;
  imageKey?: string;
  players: PlayerView[]; rulesVersion: string;
}
export interface RoomView {
  hostChange?:RoomHostChangeNotice;
  starting?:boolean;
  startError?:string|null;
  code: string; hostId: string; options: RoomOptions; matchId: string | null;
  players: { id: string; name: string; ready: boolean;avatarUrl?:string|null }[];
}
export interface RoomHostChangeNotice {eventId:string;hostId:string;previousHostId:string;matchId?:string;reason:'transfer'|'leave'|'loading'}
export interface RoomPerformanceView {
  difficulty:'in'|'at';
  players:{id:string;best:{score:number;correct:number}|null}[];
}
export interface ResultRoundView {
  round:number; title:string|null; difficulty:Difficulty; score:number; correct:boolean;
  attempts:number;wrongAttempts:number; hintsUsed:number; noiseHits:number; elapsedMs:number|null; imageUrl:string|null;
}
export interface MatchResultView {
  id:string;mode:string;difficulty:Difficulty;status:string;rules_version:string;
  created_at:string;finished_at:string|null;health_capacity:number;round_count:number|null;round_seconds:number|null;
  endless:boolean;published:boolean;rounds:ResultRoundView[];
  match_seconds?:number|null;
  players:{user_id:string;name:string;score:number;correct:number;health:number;avatarUrl?:string|null;dead?:boolean;survivalMs?:number}[];
}
export type Ack<T> = { ok: true; data: T } | { ok: false; error: string };
export interface ServerToClientEvents {
  'room:removed': (notice: RoomRemovalNotice) => void;
  'room:state': (room: RoomView) => void;
  'match:state': (match: MatchView) => void;
}
export interface RoomRemovalNotice {code:string;matchId?:string;reason:'loading-timeout'|'forced-start'|'left-loading'|'kicked'}
// Mutations use authenticated HTTP; sockets subscribe to state updates only.
export interface ClientToServerEvents {
  'room:subscribe': (input: { code: string }, ack: (result: Ack<RoomView>) => void) => void;
  'match:subscribe': (input: { id: string }, ack: (result: Ack<MatchView>) => void) => void;
}
