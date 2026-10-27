import {createContext,useContext,useLayoutEffect} from 'react';

// Share only the scene's background image, without duplicating game UI or canvases.
export const MobileBackgroundContext=createContext<(image:string|null)=>void>(()=>{});
export function useMobileBackground(image:string|null){
 const update=useContext(MobileBackgroundContext);
 useLayoutEffect(()=>{update(image);return()=>update(null);},[image,update]);
}
