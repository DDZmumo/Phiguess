import type { Difficulty } from '../../contracts/src';

export const SONG_MAX_SCORE:Record<Difficulty,number>={ez:500,hd:1000,in:2000,at:3000};
const LOWER_DIFFICULTY:Record<Difficulty,Difficulty>={ez:'ez',hd:'ez',in:'hd',at:'in'};
export function scoreAnswer(difficulty:Difficulty,elapsedMs:number,durationMs:number,wrongAttempts=0,downgraded=false):number{
  if(durationMs<=0||elapsedMs>=durationMs)return 0;
  const timeLoss=Math.max(0,Math.min(1,(elapsedMs-durationMs/6)/(durationMs*5/6)))*.5;
  const wrongLoss=Math.min(.5,Math.max(0,Math.floor(wrongAttempts))*.1);
  const scoringDifficulty=downgraded?LOWER_DIFFICULTY[difficulty]:difficulty;
  return Math.round(SONG_MAX_SCORE[scoringDifficulty]*Math.max(0,1-timeLoss-wrongLoss));
}
export type PerformanceGrade='none'|'green'|'blue'|'red'|'gold'|'rainbow';
export function performanceBadge(rounds:ReadonlyArray<{correct:boolean;score:number}>,difficulty:Difficulty){
  const solved=rounds.filter(r=>r.correct);
  const score=solved.reduce((sum,r)=>sum+r.score,0);
  return performanceBadgeTotals(score,solved.length,difficulty);
}
export function performanceBadgeTotals(score:number,correct:number,difficulty:Difficulty){
  const maximum=correct*SONG_MAX_SCORE[difficulty];
  const ratio=maximum?Math.max(0,Math.min(1,score/maximum)):0;
  const grade:PerformanceGrade=!maximum?'none':score>=maximum?'rainbow':score*100>=maximum*95?'gold':score*100>=maximum*90?'red':score*100>=maximum*80?'blue':score*100>=maximum*70?'green':'none';
  return {grade,ratio,correct,maximum,score};
}

export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
