import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type RefObject} from 'react';
import {useReducedMotion} from '../hooks';
import {copyText} from '../clipboard';
import {usePanelMotion} from './motion';
import {SongDocument} from './SongDocument';
import {api} from '../api';
import type {LibrarySong as Song,LibraryChapter as Chapter,LibraryCatalog as Catalog} from '../../../../packages/contracts/src';
import './library.css';
import {useSceneSwap} from './use-scene-swap';
import {fadeWindowPaint} from './window-paint';
import {libraryDate} from './date';

const img=(path:string)=>path.startsWith('/')?path:'/library/'+path.replace(/^assets\//,'');
const normalize=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[\s'’`]/g,'');
function matchingSongs(catalog:Catalog|null,chapter:string,query:string){
 const text=normalize(query);
 return (catalog?.songs??[]).filter(song=>chapter==='*'||chapter==='@collab'&&song.chapter.startsWith('Chapter EX')||song.chapter===chapter).filter(song=>!text||[song.title,...song.aliases].some(alias=>normalize(alias).includes(text)));
}
const curve='cubic-bezier(.349072516,.352504606,0,.998208084)';
function useWindow(ref:RefObject<HTMLElement|null>,open:boolean,reduced:boolean){
 useLayoutEffect(()=>{
  const el=ref.current;if(!el)return;
  el.dataset.windowOpen=String(open);el.style.opacity='1';
  const transform=open?'translateZ(0px)':'translateZ(-100px)';
  const cancelPaint=fadeWindowPaint(el,open&&el.closest<HTMLElement>('.spatial-scene')?.dataset.sceneVisible!=='false',reduced?0:300);
  el.style.visibility='visible';
  const animation=el.animate([{transform:getComputedStyle(el).transform},{transform}],{duration:reduced?0:300,easing:curve,fill:'forwards'});
  animation.onfinish=()=>{el.style.transform=transform;el.style.visibility=open?'visible':'hidden';animation.cancel();};
  return()=>{el.style.transform=getComputedStyle(el).transform;animation.cancel();cancelPaint();};
 },[open,reduced,ref]);
}
function title(chapter:string){return chapter.replace(/^\d+\s/,'').replace(/^Chapter EX-/,'').replace(/ 精选集$/,'').replace(/^Side Story \d+ /,'').replace(/^Extra Story Chapter\s*/,'');}
function Cover({chapter,catalog}:{chapter:Chapter;catalog:Catalog}){
 let source=chapter.cover;
 if(/^0[1-3] /.test(chapter.id))source=catalog.songs.filter(s=>s.chapter===chapter.id).at(-1)?.image??source;
 return <img src={img(source)} alt=""/>;
}
function FileRow({song,current,onClick}:{song:Song;current:boolean;onClick:()=>void}){
 const ref=useRef<HTMLButtonElement>(null);
 useLayoutEffect(()=>{let alive=true;const fit=()=>{if(!alive||!ref.current)return;const ctx=document.createElement('canvas').getContext('2d');if(!ctx)return;ctx.font='28px PhigrosNative';ref.current.style.fontSize=`${Math.min(28,Math.max(2,28*(ref.current.clientWidth-40)/Math.max(1,ctx.measureText(song.title).width)))}px`;};fit();void document.fonts.ready.then(fit);return()=>{alive=false;};},[song.title]);
 return <button ref={ref} className="native-file" data-active={current} aria-label={`打开 ${song.title} 的别名档案`} aria-current={current} title={song.title} onClick={onClick}><span className="native-file-base">{song.title}</span><span className="native-file-overlay">{song.title}</span></button>;
}
function Entry({chapter,catalog,current,onClick}:{chapter:Chapter;catalog:Catalog;current:boolean;onClick:()=>void}){
 const name=useRef<HTMLElement>(null);
 useLayoutEffect(()=>{let alive=true;const fit=()=>{const el=name.current;if(!el||!alive)return;const ctx=document.createElement('canvas').getContext('2d');if(!ctx)return;ctx.font='26px PhigrosNative';el.style.fontSize=`${Math.min(26,Math.max(12,26*el.clientWidth/Math.max(1,ctx.measureText(title(chapter.name)).width)))}px`;};const observer=new ResizeObserver(fit);if(name.current)observer.observe(name.current);fit();void document.fonts.ready.then(fit);return()=>{alive=false;observer.disconnect();};},[chapter.name]);
 const count=catalog.songs.filter(s=>s.chapter===chapter.id&&s.aliases.length).length;
 const label=chapter.group==='main'?`Chapter ${chapter.id.slice(0,2).replace(/^0/,'')}`:chapter.group==='side'?'Side story':'Collection';
 return <button className="native-chapter" aria-label={`选择曲包 ${chapter.name}`} aria-current={current} onClick={onClick}>
  <Cover chapter={chapter} catalog={catalog}/><span className="chapter-darken"/><span className="native-chapter-copy"><small>{label}</small><strong ref={name}>{title(chapter.name)}</strong></span>
  <span className="native-chapter-progress"><i style={{width:`${count/chapter.count*100}%`}}/><small>别名收录 {count}/{chapter.count}</small></span>
 </button>;
}
export function AliasLibrary({active,pageSelected}:{active:boolean;pageSelected:boolean}){
 const reduce=useReducedMotion(),[catalog,setCatalog]=useState<Catalog|null>(null),[chapter,setChapter]=useState('*'),[query,setQuery]=useState(''),[selected,setSelected]=useState<string|null>(null),[displayed,setDisplayed]=useState<Song|null>(null),[opened,setOpened]=useState(false),[entered,setEntered]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState('');
 const [dialogPage,setDialogPage]=useState<'main'|'collab'>('main'),[packsOpen,setPacksOpen]=useState(false);
 const viewport=useRef<HTMLDivElement>(null),folder=useRef<HTMLDivElement>(null),detail=useRef<HTMLDivElement>(null),songScene=useRef<HTMLDivElement>(null),packScene=useRef<HTMLDivElement>(null),packClose=useRef<HTMLButtonElement>(null),list=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null),detailTitle=useRef<HTMLHeadingElement>(null),content=useRef<HTMLDivElement>(null),closeTimer=useRef<number>(0),copyTimer=useRef<number>(0);
 const [layout,setLayout]=useState({scale:1,width:1920,x:0,y:0});
 const trigger=useRef<HTMLElement|null>(null),returnToFile=useRef(false),isActive=useRef(active);isActive.current=active;
 const motion=usePanelMotion(active,reduce);
 useEffect(()=>{let alive=true;void api<Catalog>('library').then((data:Catalog)=>{if(!alive)return;setCatalog(data);const first=data.songs[0];setSelected(first?.id??null);setDisplayed(first??null);setOpened(Boolean(first));}).catch(()=>{if(alive)setError('档案暂未读取完成。');});return()=>{alive=false;clearTimeout(closeTimer.current);clearTimeout(copyTimer.current);};},[]);
 useEffect(()=>{if(active)setEntered(true);},[active]);
 useLayoutEffect(()=>{const el=viewport.current;if(!el)return;const measure=()=>{const w=el.clientWidth,h=el.clientHeight,s=Math.min(w/1920,h/1080);setLayout({scale:s,width:w/s,x:0,y:(h-1080*s)/2});};const observer=new ResizeObserver(measure);observer.observe(el);measure();window.addEventListener('resize',measure);return()=>{observer.disconnect();window.removeEventListener('resize',measure);};},[]);
 useWindow(folder,entered,reduce||!pageSelected);useWindow(detail,entered&&opened,reduce||!pageSelected);
 const spacePhase=useSceneSwap(songScene,packScene,packsOpen,reduce||!active,()=>{
  if(!isActive.current)return;
  if(packsOpen)packClose.current?.focus({preventScroll:true});
  else if(returnToFile.current)list.current?.querySelector<HTMLButtonElement>('[data-active=true]')?.focus({preventScroll:true});
  else trigger.current?.focus({preventScroll:true});
 });
 const songs=useMemo(()=>matchingSongs(catalog,chapter,query),[catalog,chapter,query]);
 const currentChapter=catalog?.chapters.find(c=>c.id===chapter),folderTitle=query?'搜索结果':chapter==='*'?'全部歌曲':chapter==='@collab'?'联动章节':title(chapter);
 const choose=useCallback((song:Song)=>{clearTimeout(closeTimer.current);setSelected(song.id);setDisplayed(song);setOpened(true);setCopied('');if(content.current)content.current.scrollTop=0;},[]);
 useLayoutEffect(()=>{if(!detailTitle.current||!displayed)return;const el=detailTitle.current;const fit=()=>{el.style.fontSize='60px';let size=60;while(size>28&&el.scrollWidth>el.clientWidth){size-=2;el.style.fontSize=`${size}px`;}};fit();void document.fonts.ready.then(fit);},[displayed,layout]);
 const openPacks=()=>{trigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;returnToFile.current=false;setDialogPage('main');setPacksOpen(true);};
 const closePacks=()=>{returnToFile.current=false;setPacksOpen(false);};
 const switchChapter=(id:string)=>{setChapter(id);setQuery('');const first=catalog?.songs.find(s=>id==='*'||id==='@collab'&&s.chapter.startsWith('Chapter EX')||s.chapter===id);if(first)choose(first);if(list.current)list.current.scrollTop=0;returnToFile.current=true;setPacksOpen(false);};
 const wasSelected=useRef(pageSelected);
 useLayoutEffect(()=>{
  if(!pageSelected){wasSelected.current=false;return;}
  if(!catalog||wasSelected.current)return;
  wasSelected.current=true;clearTimeout(closeTimer.current);setChapter('*');setQuery('');setDialogPage('main');setPacksOpen(false);setCopied('');setSelected(catalog.songs[0]?.id??null);setDisplayed(catalog.songs[0]??null);setOpened(Boolean(catalog.songs[0]));
  if(list.current)list.current.scrollTop=0;if(content.current)content.current.scrollTop=0;
 },[pageSelected,catalog]);
 const closeFile=()=>{setSelected(null);setOpened(false);clearTimeout(closeTimer.current);closeTimer.current=window.setTimeout(()=>setDisplayed(null),reduce?0:300);};
 const copy=async(alias:string,label=alias)=>{try{await copyText(alias);setCopied(label);clearTimeout(copyTimer.current);copyTimer.current=window.setTimeout(()=>setCopied(''),1500);}catch{setCopied('复制未完成');}};
 useEffect(()=>{if(!active)return;const key=(event:KeyboardEvent)=>{if(packsOpen){if(event.key==='Escape'){event.preventDefault();closePacks();}return;}if(event.key==='/'&&document.activeElement?.tagName!=='INPUT'){event.preventDefault();search.current?.focus();}if(event.key==='Escape'&&query){setQuery('');search.current?.blur();}if(document.activeElement?.tagName==='INPUT')return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const i=songs.findIndex(s=>s.id===selected),next=songs[Math.max(0,Math.min(songs.length-1,i+(event.key==='ArrowDown'?1:-1)))];if(next)choose(next);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[active,songs,selected,query,choose,packsOpen]);
 const updateQuery=(value:string)=>{setQuery(value);const results=matchingSongs(catalog,chapter,value);if(!results.some(song=>song.id===selected)){if(results[0])choose(results[0]);else closeFile();}};
 return <section className="alias-page" aria-label="别名库" data-space-view={packsOpen?'packs':'song'} data-space-transition={spacePhase}>
  <header className="hub-section-heading alias-heading"><h1>别名库<span className="hub-heading-english">COLLECTION</span></h1><div className="alias-tools">{!packsOpen&&<label><input ref={search} value={query} disabled={packsOpen} onChange={e=>updateQuery(e.target.value)} placeholder="搜索曲名 / 别名" aria-label="搜索曲名或别名"/></label>}{motion.mobile?<button onClick={()=>void motion.enable()}>{motion.sensor?'陀螺仪已启用':'启用陀螺仪'}</button>:<button title="移动指针模拟陀螺仪；点击回正" onClick={motion.center}>姿态复位</button>}</div></header>
  {motion.permission&&<p className="alias-sensor-note" role="status">{motion.permission}</p>}
  <div ref={viewport} className="saturn-viewport" data-active={active}>
   <div className="saturn-fit" style={{width:layout.width,height:1080,transform:`translate(${layout.x}px,${layout.y}px) scale(${layout.scale})`}}><div className="saturn-camera"><div className="saturn-space">
   {/* Release scene inertness with the main panel, after its slide settles. */}
   <div ref={songScene} className="spatial-scene song-scene" aria-hidden={packsOpen} inert={!active||packsOpen}>
    <div className="folder-pose"><div ref={folder} className="native-canvas native-folder" data-window style={{pointerEvents:entered?'auto':'none'}}>
     <div className="native-window-surface" data-window-paint/><div className="native-folder-base" data-window-paint/>
     <header className="native-folder-header" data-window-paint>FOLDER_INFORMATION</header>
     <button className="native-folder-cover" data-window-paint disabled={!catalog} onClick={openPacks} aria-label="切换曲包">{currentChapter&&catalog?<Cover chapter={currentChapter} catalog={catalog}/>:<img src="/library/covers/AllSong.webp" alt=""/>}<span className="native-cover-shade"/><div><small>{currentChapter?.group==='main'?'主线章节':'曲包目录'}</small><strong>{folderTitle}</strong></div><span className="native-cover-progress"><i/><small>{songs.length} 首歌曲</small></span></button>
     <div className="native-content-label" data-window-paint><span>CONTENT</span></div>
     <div ref={list} className="native-file-list" data-window-paint aria-label="歌曲文件列表">{songs.map(song=><FileRow key={song.id} song={song} current={song.id===selected} onClick={()=>choose(song)}/>)}{catalog&&songs.length===0&&<p className="native-no-files">当前曲包没有匹配的歌曲</p>}</div>
     <div className="native-current-file" data-window-paint>{selected?Math.max(1,songs.findIndex(s=>s.id===selected)+1):0}/{songs.length}</div>
     <button className="native-back" data-window-paint disabled={!catalog} aria-label="打开曲包菜单" onClick={openPacks}>&lt;MENU</button>
    </div></div>
    <div className="detail-pose"><div ref={detail} className="native-canvas native-detail" data-window aria-label="歌曲别名详情" style={{pointerEvents:opened?'auto':'none'}}>
     <div className="native-window-surface" data-window-paint/>
     <header className="native-path" data-window-paint><span>FILE_CONTENT</span><small role="status">{copied==='复制未完成'?copied:copied?`COPIED: ${copied}`:'ANALYSIS COMPLETED.'}</small><button aria-label="关闭歌曲档案" onClick={closeFile}>×</button></header>
     {displayed&&<SongDocument song={displayed} copied={copied} onCopy={copy} titleRef={detailTitle} contentRef={content}/>}
    </div></div>
   </div>
   <div ref={packScene} className="spatial-scene pack-scene" aria-hidden={!packsOpen} inert={!active||!packsOpen}><section className="native-canvas native-collection" data-window role="dialog" aria-modal="false" aria-label="曲包目录">
   <div className="native-window-surface" data-window-paint/><header className="native-path" data-window-paint><span>选择曲包</span>{dialogPage==='collab'&&<button className="native-popup-back" onClick={()=>setDialogPage('main')}>← 返回分类</button>}<button ref={packClose} aria-label="关闭曲包目录" onClick={closePacks}>×</button></header>
   {catalog&&<><div className="collection-body" data-window-paint>{dialogPage==='main'?<div className="collection-columns"><section className="collection-main"><div className="collection-all-section"><h2><span>ALL_SONGS</span></h2><button className="native-chapter native-all-songs" aria-label="选择全部歌曲" aria-current={chapter==='*'} onClick={()=>switchChapter('*')}><img src="/library/covers/AllSong.webp" alt=""/><span className="chapter-darken"/><span className="native-chapter-copy"><small>All songs</small><strong>全部歌曲</strong></span><span className="native-chapter-progress"><i style={{width:'100%'}}/><small>已收录 {catalog.songs.length} 首歌曲</small></span></button></div><div className="collection-main-area"><h2><span>MAIN_STORY</span></h2><div className="collection-main-grid">{catalog.chapters.filter(c=>c.group==='main').map(c=><Entry key={c.id} chapter={c} catalog={catalog} current={c.id===chapter} onClick={()=>switchChapter(c.id)}/>)}</div></div></section><section className="collection-side"><h2><span>SIDE_STORY</span></h2><div>{catalog.chapters.filter(c=>c.id.startsWith('Side Story')).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})).map(c=><Entry key={c.id} chapter={c} catalog={catalog} current={c.id===chapter} onClick={()=>switchChapter(c.id)}/>)}</div></section><section className="collection-misc"><h2><span>MISC.</span></h2><div><button className="native-chapter" onClick={()=>setDialogPage('collab')}><img src="/library/covers/Single.webp" alt=""/><span className="chapter-darken"/><span className="native-chapter-copy"><small>Chapter EX</small><strong>联动曲包</strong></span><span className="native-chapter-progress"><i/><small>{catalog.chapters.filter(c=>c.group==='collab').length} 个曲包</small></span></button>{catalog.chapters.filter(c=>c.group==='other'||c.id.startsWith('Extra Story')).map(c=><Entry key={c.id} chapter={c} catalog={catalog} current={c.id===chapter} onClick={()=>switchChapter(c.id)}/>)}</div></section></div>:<div className="collection-collab"><h2><span>COLLABORATION</span></h2><div>{catalog.chapters.filter(c=>c.group==='collab').map(c=><Entry key={c.id} chapter={c} catalog={catalog} current={c.id===chapter} onClick={()=>switchChapter(c.id)}/>)}</div></div>}
   </div><footer className="collection-total" data-window-paint><span>别名库更新时间</span><div><img src="/library/ui/progress.png" alt=""/><time className="library-updated" dateTime={catalog.updatedAt??undefined}>{libraryDate(catalog.updatedAt)}</time><strong>{catalog.songs.length}<small> SONGS</small></strong></div></footer></>}
  </section></div>
   </div></div></div>
  </div>
  {error&&<p role="alert">{error}</p>}

 </section>;
}
