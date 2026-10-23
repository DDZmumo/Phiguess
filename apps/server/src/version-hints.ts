import {randomInt} from 'node:crypto';
import timeline from '../../../data/providers/phi-plugin/release-timeline.json';

export type ContentKind='main'|'non-main'|'april-fools';
export const RELEASE_VERSIONS=[...new Set(timeline.map(release=>release.version))];
export function nonMainHint(kind:ContentKind,introducedVersion?:string|null,removed=false){
  if(kind==='april-fools')return '愚人节曲目';
  const position=RELEASE_VERSIONS.indexOf(introducedVersion??'');
  if(position<0)throw new Error('Introduction version metadata unavailable');
  const count=randomInt(2,4);
  const first=randomInt(Math.max(0,position-count+1),Math.min(position,RELEASE_VERSIONS.length-count)+1);
  return `非主线 · v${RELEASE_VERSIONS[first]}–v${RELEASE_VERSIONS[first+count-1]}${removed?'\n已删除':''}`;
}
