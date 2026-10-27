export interface MobileViewport {width:number;height:number;keyboard:boolean;visibleHeight:number}

/** Keep the game canvas stable while the software keyboard covers its lower half. */
export function mobileViewport(previous:MobileViewport,current:{width:number;height:number;visibleHeight:number},editing:boolean,mobile:boolean):MobileViewport{
 const rotated=Math.abs(current.width-previous.width)>80;
 const keyboard=mobile&&!rotated&&(editing||previous.keyboard)&&previous.height-current.visibleHeight>Math.max(100,previous.height*.22);
 return {width:current.width,height:keyboard?previous.height:current.height,visibleHeight:current.visibleHeight,keyboard};
}

export function isTextEntry(element:Element|null):boolean{
 if(!element)return false;
 if(element instanceof HTMLTextAreaElement||element instanceof HTMLElement&&element.isContentEditable)return true;
 return element instanceof HTMLInputElement&&['text','password','search','email','tel','number','url'].includes(element.type);
}
