import YAML from 'yaml';
export interface AliasSong {songId:string;providerId:string;title:string;sourceTitles?:string[]}
export function parseAliasMap(raw:string):Record<string,string[]>{
 // Failsafe preserves numeric nicknames such as the literal alias "7".
 const parsed=YAML.parse(raw,{schema:'failsafe'}) as unknown;
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Invalid alias map');
 const result:Record<string,string[]>={};
 for(const [key,value] of Object.entries(parsed)){
  if(!Array.isArray(value)||value.some(alias=>typeof alias!=='string'))throw new Error(`Invalid aliases for ${key}`);
  result[key]=value as string[];
 }
 return result;
}
export function mergedAliases(song:AliasSong,map:Record<string,string[]>,overrides:Record<string,string[]>) {
 const local=overrides[song.providerId]??[];if(!Array.isArray(local)||local.some(alias=>typeof alias!=='string'))throw new Error('Invalid local alias overrides');
 return [...new Set([song.title,...song.sourceTitles??[],...map[song.providerId]??map[song.title]??[],...local].map(alias=>alias.trim()).filter(alias=>alias&&alias.length<=200))];
}
