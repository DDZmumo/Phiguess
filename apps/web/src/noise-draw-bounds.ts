export interface NoiseRegion {rect:[number,number,number,number];phase:0|1|2;strength:number}

/** Logical bounds include the displaced rim and the fading contact light. */
export function noiseDrawBounds(regions:readonly NoiseRegion[],skew:number,pointer:readonly [number,number],contactAmount:number){
 let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
 for(let i=0;i<Math.min(24,regions.length);i++){
  const region=regions[i]!;
  if(!region.phase)continue;
  const pad=region.phase===2?40:1;
  const [l,t,r,b]=region.rect,y0=t-pad,y1=b+pad;
  left=Math.min(left,l-pad-(y0-360)*skew,l-pad-(y1-360)*skew);
  right=Math.max(right,r+pad-(y0-360)*skew,r+pad-(y1-360)*skew);
  top=Math.min(top,y0);bottom=Math.max(bottom,y1);
 }
 if(contactAmount>0){
  const radius=120*(.45+.55*contactAmount);
  left=Math.min(left,pointer[0]-radius);right=Math.max(right,pointer[0]+radius);
  top=Math.min(top,pointer[1]-radius);bottom=Math.max(bottom,pointer[1]+radius);
 }
 return left<right&&top<bottom?{left,top,right,bottom}:null;
}
