interface TutorialDevice{userAgent:string;mobileHint?:boolean;platform?:string;touchPoints?:number;coarsePointer:boolean}
export function shouldSkipTutorialHover(device:TutorialDevice):boolean{
 return Boolean(device.mobileHint)||/Android|iPhone|iPad|iPod|Mobile/i.test(device.userAgent)||(device.platform==='MacIntel'&&(device.touchPoints??0)>1)||device.coarsePointer;
}
