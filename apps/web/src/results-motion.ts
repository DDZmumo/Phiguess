// Frame anchors read from the user's 30fps reference. Only numeric timing is retained.
export const RESULT_FPS=30;
export const resultMotion={
  background:[10/30,20/30],
  rowStarts:[26/30,34/30,42/30],
  totalStart:59/30,totalDuration:28/30,
  playerStart:71/30,playerDuration:22/30,
  controlsStart:131/30,controlsDuration:12/30,
  summary:{fade:10/30,numberStart:18/30,numberFade:22/30,shrinkStart:41/30,shrinkDuration:10/30,baseStart:41/30,baseDuration:11/30,cancelStart:66/30,confirmStart:76/30,controlDuration:10/30,exitDuration:13/30},
} as const;
// Horizontal offsets in the 1280px reference space, tracked against each settled artwork.
export const resultRowTracks:ReadonlyArray<ReadonlyArray<readonly [number,number]>>=[
 [[26,1000],[27,906],[28,818],[29,738],[30,662],[31,592],[32,528],[33,468],[34,412],[35,362],[36,314],[37,272],[38,234],[39,200],[40,168],[41,140],[42,116],[43,96],[44,60],[45,46],[46,36],[47,26],[48,18],[51,4],[54,0]],
 [[34,1034],[35,936],[36,846],[37,762],[38,686],[39,614],[40,548],[41,486],[42,428],[43,376],[44,284],[45,244],[46,210],[47,176],[48,148],[51,82],[54,44],[57,18],[60,4],[63,0]],
 [[42,1068],[43,968],[44,792],[45,712],[46,640],[47,570],[48,508],[51,346],[54,240],[57,146],[60,80],[63,44],[66,14],[69,4],[72,0]],
];
export function resultRowEase(index:number){
 const track=resultRowTracks[index]!,first=track[0]!,last=track.at(-1)!;
 return (progress:number)=>{
  const frame=first[0]+(last[0]-first[0])*progress;
  for(let i=1;i<track.length;i++){const a=track[i-1]!,b=track[i]!;if(frame<=b[0])return 1-(a[1]+(b[1]-a[1])*(frame-a[0])/(b[0]-a[0]))/first[1];}
  return 1;
 };
}
