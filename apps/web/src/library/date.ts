export function libraryDate(value:string|null|undefined){
 if(!value||!Number.isFinite(Date.parse(value)))return '—';
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
 const part=(type:string)=>parts.find(p=>p.type===type)?.value??'';
 return `${part('year')}/${part('month')}/${part('day')}`;
}
