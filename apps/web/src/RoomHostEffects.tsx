const guides=[
  'M15 67H180L228 18H620',
  'M80 88L160 8H475L530 63H640',
  'M28 30H106L126 10H350',
  'M258 79H415L451 43H610',
];

export function RoomHostEffects({playerId}:{playerId:string}){
  const gradient=`room-host-guide-${playerId}`;
  return <div className="room-host-effects" aria-hidden="true">
    <svg viewBox="0 0 640 88" preserveAspectRatio="none">
      <defs><linearGradient id={gradient} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#addfff" stopOpacity="0"/>
        <stop offset=".3" stopColor="#addfff" stopOpacity="1"/>
        <stop offset=".8" stopColor="#addfff" stopOpacity=".6"/>
        <stop offset="1" stopColor="#addfff" stopOpacity="0"/>
      </linearGradient></defs>
      {guides.map((path,index)=><path key={path} stroke={`url(#${gradient})`} className={`room-host-line ${index>1?'detail':''}`} d={path}/>)}
      <path pathLength="1000" className="room-host-line-flow" d={guides[0]}/>
      <path pathLength="1000" className="room-host-line-flow secondary" d={guides[1]}/>
      <path pathLength="1000" className="room-host-line-flow detail" d={guides[3]}/>
    </svg>
    {Array.from({length:8},(_,particle)=><i className="room-host-particle" key={particle} style={{left:`${8+particle*11}%`,top:`${22+(particle*19)%54}%`,animationDelay:`${-particle*.825}s`}}/>)}
  </div>;
}
