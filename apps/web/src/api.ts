import { useStore } from './store';

export class ApiError extends Error {
  constructor(public status:number,public payload:any) {super(typeof payload.message==='string'?payload.message:'请求未完成');}
}
export async function uploadAvatar(file:File):Promise<{avatarUrl:string}> {
  const token=useStore.getState().session?.token,form=new FormData();form.append('avatar',file);
  const response=await fetch('/api/me/avatar',{method:'POST',headers:token?{Authorization:`Bearer ${token}`}:{},body:form});
  const data=await response.json();if(!response.ok)throw new ApiError(response.status,data);return data;
}
export async function api<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T> {
  const token=useStore.getState().session?.token;
  const response=await fetch(`/api/${path}`,{method,signal,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok) {if(response.status===401&&!path.startsWith('auth/')&&useStore.getState().session?.token===token)useStore.getState().setSession(null);throw new ApiError(response.status,data);}
  return data;
}
export function errorMessage(error:unknown):string {
  if(error instanceof ApiError) {
    if(error.message==='Invalid player name or password')return '玩家名或密码不正确。';
    if(error.message==='Player name already registered')return '这个玩家名已注册，请换一个名字。';
    if(error.status===401)return '玩家身份已失效，请回到账号界面重新建立档案。';
    if(error.message.includes('Not enough')||error.message.includes('requires at least'))return '当前曲库不足以开始这组挑战，请减少题数或先导入曲绘。';
    if(error.message.includes('already solved'))return '本题已猜中，等待下一首。';
    if(error.message.includes('Already in')||error.message.includes('already in an active'))return '你还有进行中的挑战，请从账号界面继续。';
    if(error.message.includes('Leave your'))return '请先退出当前房间。';
    if(error.message.includes('Hint not provided'))return '这首歌还没有配置这条提示。';
    if(error.message.includes('Round is not'))return '本题已结束或尚未开始，请等待状态更新。';
    if(error.message.includes('Only completed Infinity results'))return '只有已结束的无尽挑战可以公布成绩。';
    if(error.status===403)return '当前状态下无法执行这个操作。';
    if(error.status===404)return '内容已失效或不存在，请返回账号界面。';
    if(error.status===429)return '操作太频繁，请稍后再试。';
    if(error.status===400)return '请检查输入内容。';
    if(error.status===413)return '图片超过 3MB，请选择更小的图片。';
    if(error.status>=500)return '服务暂时不可用，请稍后重试。';
    return error.message;
  }
  return '连接未完成，请检查网络后重试。';
}
export interface History {id:string;mode:string;difficulty:string;status:string;score:number;correct:number;created_at:string}
export interface Progress {round:number;correct:boolean;score:number;answer_text:string|null;title:string|null}
export interface Hint {index:number;content:string;kind:string;difficulty:'ez'|'hd'|'in'|'at'|null}
