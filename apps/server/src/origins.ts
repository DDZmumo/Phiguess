/** Local preview aliases are allowed only in development, on the same port. */
export function isAllowedOrigin(origin:string,configured:string,environment:string){
 if(origin===configured)return true;
 if(environment!=='development')return false;
 try{
  const actual=new URL(origin),expected=new URL(configured),loopback=new Set(['localhost','127.0.0.1','[::1]']);
  return actual.origin===origin&&loopback.has(actual.hostname)&&loopback.has(expected.hostname)&&actual.protocol===expected.protocol&&actual.port===expected.port;
 }catch{return false;}
}
