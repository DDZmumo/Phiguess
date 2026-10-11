export const CHARACTER_TRANSITION_MS=700;
export const CHARACTER_REVEAL_DELAY_MS=650;

export function randomCharacterRanks(count:number,random:()=>number=Math.random):number[]{
 const order=Array.from({length:count},(_,i)=>i),ranks:number[]=[];
 for(let i=order.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[order[i],order[j]]=[order[j]!,order[i]!];}
 order.forEach((index,rank)=>{ranks[index]=rank;});return ranks;
}
export function scrambledCharacters(text:string,frame:number,index=0):string{
 const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
 let seed=(Math.imul(index+1,0x45d9f3b)^Math.imul(frame+1,0x27d4eb2d))>>>0;
 return Array.from(text,()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return chars[(seed>>>0)%chars.length];}).join('');
}
export function characterTransition(text:string,ranks:readonly number[],count:number,frame:number,concealing=false):string{
 const noise=Array.from(scrambledCharacters(text,frame));
 return Array.from(text,(char,index)=>{
  const changed=ranks[index]!<count;
  const showNoise=concealing?changed:!changed;
  return showNoise?(noise[index]===char?'?':noise[index]!):char;
 }).join('');
}
