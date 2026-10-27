interface ClipboardAccess {
 writeText?: (text:string)=>Promise<void>;
 copySelection:(text:string)=>boolean;
}

function copySelection(text:string):boolean{
 const active=document.activeElement instanceof HTMLElement?document.activeElement:null;
 const selection=document.getSelection(),ranges:Range[]=[];
 if(selection)for(let index=0;index<selection.rangeCount;index++)ranges.push(selection.getRangeAt(index).cloneRange());
 const field=active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement?active:null;
 const start=field?.selectionStart,end=field?.selectionEnd,direction=field?.selectionDirection;
 const input=document.createElement('textarea');input.value=text;input.readOnly=true;input.tabIndex=-1;
 input.setAttribute('aria-hidden','true');
 input.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;font-size:16px;user-select:text;-webkit-user-select:text;';
 (active?.closest('dialog[open]')??document.body).append(input);
 try{
  input.focus({preventScroll:true});input.select();input.setSelectionRange(0,text.length);
  return typeof document.execCommand==='function'&&document.execCommand('copy');
 }finally{
  input.remove();
  // Copying must not disturb an existing draft, selection or scroll position.
  try{
   if(active?.isConnected)active.focus({preventScroll:true});
   if(field?.isConnected&&start!==null&&start!==undefined&&end!==null&&end!==undefined)field.setSelectionRange(start,end,direction??undefined);
   if(selection){selection.removeAllRanges();for(const range of ranges)selection.addRange(range);}
  }catch{/* A previously focused element may have been removed while copying. */}
 }
}

export async function copyText(text:string,access?:ClipboardAccess):Promise<void>{
 if(!access){
  let writeText:ClipboardAccess['writeText'];
  try{const clipboard=navigator.clipboard;if(typeof clipboard?.writeText==='function')writeText=value=>clipboard.writeText(value);}catch{/* Use selection copying if the Clipboard API is unavailable. */}
  access={writeText,copySelection};
 }
 if(access.writeText){try{await access.writeText(text);return;}catch{/* HTTP and denied permissions can require selection copying. */}}
 if(!access.copySelection(text))throw new Error('Clipboard copy was not accepted');
}
