import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { INFINITY_ROUNDS, type Difficulty } from '../../../packages/contracts/src';
import { Db } from './db';

export interface Artwork { id: string; song_id: string; title: string; aliases: string[]; hints: string[]; storage_key: string; mime: string; difficulty: Difficulty; version:string; variant:string; chapter:number|null; chapter_name:string|null; composer:string|null; illustrator?:string|null }
function groupBySong(rows:Artwork[]) {const groups=new Map<string,Artwork[]>();for(const art of rows){if(!groups.has(art.song_id))groups.set(art.song_id,[]);groups.get(art.song_id)!.push(art);}return [...groups.values()];}
@Injectable()
export class CatalogService {
  constructor(private readonly db: Db) {}
  async search(q: string) {
    const escaped = q.replace(/[\\%_]/g, '\\$&');
    return (await this.db.query('SELECT id,title,aliases FROM songs WHERE enabled AND (title ILIKE $1 OR aliases::text ILIKE $1) ORDER BY title,id LIMIT 50', [`%${escaped}%`])).rows;
  }
  async choose(difficulty: Difficulty, count: number) {
    const { rows } = await this.db.query<Artwork>('SELECT a.*,s.title,s.aliases,s.hints,s.chapter,s.chapter_name,s.composer FROM artworks a JOIN songs s ON s.id=a.song_id WHERE a.active AND s.enabled AND a.difficulty=$1 ORDER BY a.id', [difficulty]);
    const choices=groupBySong(rows).map(group=>group[randomInt(group.length)]!);
    const limit=count===INFINITY_ROUNDS?choices.length:count;
    if (!choices.length||choices.length < limit) throw new ServiceUnavailableException(`Not enough published songs for ${count===INFINITY_ROUNDS?'Infinity':count} rounds`);
    for (let i = choices.length - 1; i > 0; i--) { const j = randomInt(i + 1); [choices[i], choices[j]] = [choices[j]!, choices[i]!]; }
    return choices.slice(0, limit);
  }
}
