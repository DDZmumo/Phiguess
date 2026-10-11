import type {MatchView} from '../../../packages/contracts/src';
import type {Preferences,Session} from './store';

/** A scoped local runtime for the real screens. Unknown operations must never fall through to HTTP. */
export interface PlayRuntime {
 session:Session;
 preferences:Preferences;
 clockPaused:boolean;
 request:<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
 media:typeof fetch;
 subscribe:(listener:()=>void)=>()=>void;
 snapshot:()=>MatchView|null;
 navigate:(path:string)=>void;
 canNavigate?:(path:string)=>boolean;
 updatePreferences:(value:Partial<Preferences>)=>void;
 event:(name:string)=>void;
 beginBlackTransition?:(onCovered:()=>Promise<void>)=>void;
 challengeSettingsOpen?:boolean;
 restoredResult?:boolean;
 summaryOpen?:boolean;
 revealedRounds?:readonly number[];
 resultReveal?:(round:number)=>{title:string;imageUrl:string}|null;
 answerDraft?:string;
 wrongAttemptsByRound?:readonly (readonly [number,number])[];
 updateAnswerDraft?:(value:string)=>void;
 resultScrollTop?:number;
 updateResultScroll?:(value:number)=>void;
 prepareAnswer?:(answer:string,round:number,update:(value:string)=>void,signal:AbortSignal,reduce:boolean)=>Promise<string>;
}
