import type {RefObject} from 'react';
import type {LibrarySong as Song} from '../../../../packages/contracts/src';
const CopyIcon=()=> <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h12v13H8zM4 17H2V2h14v2"/></svg>;
const packTitle=(value:string)=>value.replace(/^\d+\s/,'').replace(/^Chapter EX-/,'').replace(/ 精选集$/,'').replace(/^Side Story \d+ /,'').replace(/^Extra Story Chapter\s*/,'');
export function SongDocument({song,copied,onCopy,titleRef,contentRef}:{song:Song;copied:string;onCopy:(text:string,label?:string)=>Promise<void>;titleRef:RefObject<HTMLHeadingElement|null>;contentRef:RefObject<HTMLDivElement|null>}){
 return <div ref={contentRef} className="rich-detail-content" data-window-paint aria-label="别名正文"><article className="rich-detail-document">
  <div className="rich-record-path">// COLLECTION / {song.chapter} / {song.title}</div>
  <div className="rich-record-top"><div><p className="rich-record-index">SONG RECORD</p><h2 ref={titleRef}>{song.title}</h2><div className="rich-composer"><small>COMPOSER</small>{song.composer}</div></div><div className="rich-artwork">{song.image?<img src={song.image} alt={`${song.title} 曲绘`}/>:<div className="library-no-image">曲绘暂未导入</div>}<small><span>ARTWORK_ARCHIVE</span><span>◆</span></small></div></div>
  <dl className="rich-record-properties"><div><dt>CATEGORY / 所属曲包</dt><dd title={song.chapter}>{packTitle(song.chapter)}</dd></div><div><dt>ILLUSTRATOR / 曲绘作者</dt><dd title={song.illustrator}>{song.illustrator||'—'}</dd></div><div><dt>ALIASES / 收录别名</dt><dd>{song.aliases.length} 个</dd></div></dl>
  <div className="rich-alias-section"><header className="rich-aliases-heading"><div><h3>收录别名</h3><small>KNOWN ALIASES</small></div><button className="rich-copy-all" aria-label="复制全部别名" disabled={!song.aliases.length} onClick={()=>void onCopy(song.aliases.join('\n'),'全部别名')}><CopyIcon/>复制全部</button></header>
  <p className="rich-aliases-help">以下名称均可用于答题。点击任意别名即可复制。</p>
  <div className="rich-alias-grid">{song.aliases.map((alias,index)=><button key={index} data-copied={copied===alias} aria-label={`复制别名 ${alias}`} onClick={()=>void onCopy(alias)}><small>{String(index+1).padStart(2,'0')}</small><span>{alias}</span><CopyIcon/></button>)}</div>{!song.aliases.length&&<p className="rich-aliases-help">这首歌暂未收录其他别名，可使用正式曲名答题。</p>}
  <div className="rich-standard-name"><small>STANDARD NAME</small><span>{song.title}</span></div></div>
  <footer className="rich-record-footer"><span>END OF RECORD</span><span>PHIGUESS · ALIAS ARCHIVE</span></footer>
 </article></div>;
}
