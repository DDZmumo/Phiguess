interface LandscapeEnvironment {
  mobile:boolean;
  fullscreen:boolean;
  enterFullscreen?:()=>Promise<void>;
  lock?:(orientation:'landscape')=>Promise<void>;
}

export function isMobileScreen():boolean {
  return window.matchMedia('(pointer: coarse) and (hover: none)').matches;
}

export async function requestMobileLandscape(environment?:LandscapeEnvironment):Promise<boolean> {
  const orientation=globalThis.screen?.orientation as (ScreenOrientation&{lock?:(value:'landscape')=>Promise<void>})|undefined;
  const env=environment??{
    mobile:isMobileScreen(),fullscreen:Boolean(document.fullscreenElement),
    enterFullscreen:typeof document.documentElement.requestFullscreen==='function'?()=>document.documentElement.requestFullscreen({navigationUI:'hide'}):undefined,
    lock:typeof orientation?.lock==='function'?(value:'landscape')=>orientation.lock!(value):undefined,
  };
  if(!env.mobile)return false;
  try{
    if(!env.fullscreen&&env.enterFullscreen)await env.enterFullscreen();
    if(!env.lock)return false;
    await env.lock('landscape');return true;
  }catch{return false;}
}
