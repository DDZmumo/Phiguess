import sharp from 'sharp';
import {gzipSync} from 'node:zlib';

// Versioned CPU generator. Persist this version and the seed with every round.
export const recipe={version:'ez-regions-v1',maxSide:384,superpixels:1100,compactness:12,seedSpread:.8,mergeNoise:1.3,localBias:.45,
  levels:[{name:'hd',regions:60,colors:14,simplify:1.2},{name:'in',regions:18,colors:7,simplify:5},{name:'at',regions:6,colors:4,simplify:9}]};
function random(seed){let state=seed>>>0;return()=>{state+=0x6D2B79F5;let n=state;n=Math.imul(n^(n>>>15),n|1);n^=n+Math.imul(n^(n>>>7),n|61);return ((n^(n>>>14))>>>0)/4294967296;};}
class Heap{
 data=[];
 push(item){let i=this.data.length;this.data.push(item);while(i){const p=(i-1)>>1;if(this.data[p].d<=item.d)break;this.data[i]=this.data[p];i=p;}this.data[i]=item;}
 pop(){const first=this.data[0],last=this.data.pop();if(this.data.length){let i=0;while(i*2+1<this.data.length){let child=i*2+1;if(child+1<this.data.length&&this.data[child+1].d<this.data[child].d)child++;if(this.data[child].d>=last.d)break;this.data[i]=this.data[child];i=child;}this.data[i]=last;}return first;}
 get size(){return this.data.length;}
}
const linear=Float64Array.from({length:256},(_,n)=>{const s=n/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;});
function labs(data){
 const values=new Float32Array(data.length);
 for(let p=0;p<data.length;p+=3){const r=linear[data[p]],g=linear[data[p+1]],b=linear[data[p+2]],l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  values[p]=100*(.2104542553*l+.793617785*m-.0040720468*s);values[p+1]=100*(1.9779984951*l-2.428592205*m+.4505937099*s);values[p+2]=100*(.0259040371*l+.7827717662*m-.808675766*s);
 }return values;
}
function partition(data,width,height,seed){
 const count=width*height,lab=labs(data),labels=new Int32Array(count).fill(-1),heap=new Heap(),regions=[],rng=random(seed);
 const step=Math.sqrt(count/Math.min(recipe.superpixels,count)),spatial=(recipe.compactness*(.9+.2*rng())/step)**2;
 for(let cy=step/2;cy<height;cy+=step)for(let cx=step/2;cx<width;cx+=step){
  const x=Math.max(0,Math.min(width-1,Math.round(cx+(rng()-.5)*step*recipe.seedSpread))),y=Math.max(0,Math.min(height-1,Math.round(cy+(rng()-.5)*step*recipe.seedSpread)));
  const id=regions.length;regions.push({n:0,x:0,y:0,l:0,a:0,b:0,r:0,g:0,blue:0});heap.push({p:y*width+x,id,d:0});
 }
 const offer=(p,id)=>{if(labels[p]!==-1)return;const c=regions[id],x=p%width,y=(p/width)|0,i=p*3;
  const d=(lab[i]-c.l/c.n)**2+(lab[i+1]-c.a/c.n)**2+(lab[i+2]-c.b/c.n)**2+spatial*((x-c.x/c.n)**2+(y-c.y/c.n)**2);heap.push({p,id,d});};
 while(heap.size){const {p,id}=heap.pop();if(labels[p]!==-1)continue;labels[p]=id;const c=regions[id],x=p%width,y=(p/width)|0,i=p*3;
  c.n++;c.x+=x;c.y+=y;c.l+=lab[i];c.a+=lab[i+1];c.b+=lab[i+2];c.r+=data[i];c.g+=data[i+1];c.blue+=data[i+2];
  if(x)offer(p-1,id);if(x+1<width)offer(p+1,id);if(y)offer(p-width,id);if(y+1<height)offer(p+width,id);
 }
 return {labels,regions};
}
function hierarchy(labels,regions,width,height,seed,levels){
 const parent=Int32Array.from(regions,(_,i)=>i),revision=new Uint32Array(regions.length),adjacent=regions.map(()=>new Set()),heap=new Heap();
 const rng=random(seed^0x9e3779b9),field=Float64Array.from({length:16},()=>rng()*2-1);
 // A smooth seeded field changes where detail is retained, not the image's colors or position.
 const localWeight=(x,y)=>{const fx=Math.min(2.999999,Math.max(0,x*3)),fy=Math.min(2.999999,Math.max(0,y*3)),ix=Math.floor(fx),iy=Math.floor(fy),u=fx-ix,v=fy-iy;
  return Math.exp(recipe.localBias*((field[iy*4+ix]*(1-u)+field[iy*4+ix+1]*u)*(1-v)+(field[(iy+1)*4+ix]*(1-u)+field[(iy+1)*4+ix+1]*u)*v));};
 const root=i=>{let r=i;while(parent[r]!==r)r=parent[r];while(parent[i]!==i){const next=parent[i];parent[i]=r;i=next;}return r;};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*width+x,a=labels[p];for(const b of [x+1<width?labels[p+1]:a,y+1<height?labels[p+width]:a])if(a!==b){adjacent[a].add(b);adjacent[b].add(a);}}
 const offer=(a,b)=>{const x=regions[a],y=regions[b];if(!x.n||!y.n)return;
  const color=(x.l/x.n-y.l/y.n)**2+(x.a/x.n-y.a/y.n)**2+(x.b/x.n-y.b/y.n)**2;
  const space=((x.x/x.n-y.x/y.n)**2+(x.y/x.n-y.y/y.n)**2)/(width*height)*80;
  let h=(seed^Math.imul(Math.min(a,b)+1,73856093)^Math.imul(Math.max(a,b)+1,19349663))>>>0;h=Math.imul(h^(h>>>16),2246822507)>>>0;
  const jitter=Math.exp((h/4294967296-.5)*recipe.mergeNoise),bias=localWeight((x.x+y.x)/(x.n+y.n)/width,(x.y+y.y)/(x.n+y.n)/height);
  const d=(color+space+.01)*(x.n*y.n/(x.n+y.n))**.65*jitter*bias;
  heap.push({a,b,va:revision[a],vb:revision[b],d});
 };
 for(let a=0;a<regions.length;a++)for(const b of adjacent[a])if(a<b)offer(a,b);
 let remaining=regions.filter(r=>r.n).length;const results=[];
 for(const level of levels){
  while(remaining>level.regions&&heap.size){let {a,b,va,vb}=heap.pop();if(root(a)!==a||root(b)!==b||revision[a]!==va||revision[b]!==vb)continue;
   if(regions[a].n<regions[b].n)[a,b]=[b,a];parent[b]=a;revision[a]++;revision[b]++;
   for(const k of ['n','x','y','l','a','b','r','g','blue'])regions[a][k]+=regions[b][k];regions[b].n=0;
   const neighbors=new Set([...adjacent[a],...adjacent[b]].map(root));neighbors.delete(a);neighbors.delete(b);adjacent[a]=neighbors;adjacent[b].clear();
   for(const n of neighbors){adjacent[n].delete(b);adjacent[n].add(a);offer(a,n);}remaining--;
  }
  const ids=new Map(),colors=[];
  const snapshot=Int32Array.from(labels,label=>{const id=root(label);if(!ids.has(id)){ids.set(id,ids.size);const r=regions[id];colors.push({n:r.n,lab:[r.l/r.n,r.a/r.n,r.b/r.n],rgb:[r.r/r.n,r.g/r.n,r.blue/r.n]});}return ids.get(id);});
  results.push({level,labels:snapshot,colors});
 }
 return results;
}
function palette(regions,limit,seed){
 const rng=random(seed),distance=(a,b)=>a.reduce((sum,x,i)=>sum+(x-b[i])**2,0),centers=[regions[Math.floor(rng()*regions.length)].lab.slice()];
 while(centers.length<Math.min(limit,regions.length)){
  const weights=regions.map(r=>Math.min(...centers.map(c=>distance(r.lab,c)))*Math.sqrt(r.n));let ticket=rng()*weights.reduce((a,b)=>a+b,0),index=weights.length-1;
  for(let i=0;i<weights.length;i++){ticket-=weights[i];if(ticket<=0){index=i;break;}}centers.push(regions[index].lab.slice());
 }
 const assignments=new Uint16Array(regions.length);let sums;
 for(let iteration=0;iteration<8;iteration++){
  sums=centers.map(()=>({n:0,lab:[0,0,0],rgb:[0,0,0]}));
  for(let i=0;i<regions.length;i++){const r=regions[i];let best=0,min=Infinity;for(let j=0;j<centers.length;j++){const d=distance(r.lab,centers[j]);if(d<min){min=d;best=j;}}assignments[i]=best;const s=sums[best];s.n+=r.n;for(let c=0;c<3;c++){s.lab[c]+=r.lab[c]*r.n;s.rgb[c]+=r.rgb[c]*r.n;}}
  for(let j=0;j<centers.length;j++)if(sums[j].n)centers[j]=sums[j].lab.map(v=>v/sums[j].n);
 }
 return [...assignments].map(id=>'#'+sums[id].rgb.map(v=>Math.max(0,Math.min(255,Math.round(v/sums[id].n))).toString(16).padStart(2,'0')).join(''));
}
function simplify(points,epsilon){
 if(points.length<4)return points;
 const open=arr=>{const keep=new Uint8Array(arr.length);keep[0]=keep[arr.length-1]=1;const stack=[[0,arr.length-1]];
  while(stack.length){const [lo,hi]=stack.pop(),[x,y]=arr[lo],[ex,ey]=arr[hi],dx=ex-x,dy=ey-y,length=dx*dx+dy*dy;let best=-1,max=epsilon*epsilon;
   for(let i=lo+1;i<hi;i++){const [px,py]=arr[i],t=length?Math.max(0,Math.min(1,((px-x)*dx+(py-y)*dy)/length)):0,d=(px-x-t*dx)**2+(py-y-t*dy)**2;if(d>max){max=d;best=i;}}
   if(best>=0){keep[best]=1;stack.push([lo,best],[best,hi]);}
  }return arr.filter((_,i)=>keep[i]);};
 let split=1,max=0;for(let i=1;i<points.length;i++){const d=(points[i][0]-points[0][0])**2+(points[i][1]-points[0][1])**2;if(d>max){max=d;split=i;}}
 const result=[...open(points.slice(0,split+1)).slice(0,-1),...open([...points.slice(split),points[0]]).slice(0,-1)];
 if(result.length>=3)return result;
 if(epsilon<5)return points;
 // Simplify tiny/narrow contours instead of restoring all their jagged vertices.
 const [x,y]=points[0],dx=points[split][0]-x,dy=points[split][1]-y;let third=1,area=-1;
 for(let i=1;i<points.length;i++){const cross=Math.abs(dx*(points[i][1]-y)-dy*(points[i][0]-x));if(cross>area){area=cross;third=i;}}
 return third<split?[points[0],points[third],points[split]]:[points[0],points[split],points[third]];
}
function vectorize(labels,colors,width,height,epsilon){
 const edges=colors.map(()=>new Map()),stride=width+1;
 const add=(id,x,y,d)=>{const key=y*stride+x,map=edges[id];map.set(key,(map.get(key)??0)|(1<<d));};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*width+x,id=labels[p];
  if(!y||labels[p-width]!==id)add(id,x,y,0);if(x+1===width||labels[p+1]!==id)add(id,x+1,y,1);
  if(y+1===height||labels[p+width]!==id)add(id,x+1,y+1,2);if(!x||labels[p-1]!==id)add(id,x,y+1,3);
 }
 const shifts=[1,stride,-1,-stride],paths=[];
 for(let id=0;id<edges.length;id++){const map=edges[id];let d='';
  for(const [start] of map){while(map.get(start)){
   let p=start,dir=Math.log2(map.get(start)&-map.get(start)),guard=0;const points=[];
   do{points.push([p%stride,Math.floor(p/stride)]);map.set(p,map.get(p)&~(1<<dir));p+=shifts[dir];if(p===start)break;
    const mask=map.get(p)??0;const next=[(dir+1)%4,dir,(dir+3)%4,(dir+2)%4].find(n=>mask&(1<<n));if(next===undefined)throw new Error('Open generated contour');dir=next;
    if(++guard>width*height*4)throw new Error('Contour budget exceeded');
   }while(true);
   if(points.length>=3){const polygon=simplify(points,epsilon);d+='M'+polygon.map(([x,y])=>`${x},${y}`).join('L')+'Z';}
  }}
  if(d)paths.push(`<path fill="${colors[id]}" stroke="${colors[id]}" stroke-width="${epsilon*1.15}" stroke-linejoin="round" fill-rule="evenodd" d="${d}"/>`);
 }
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${colors[0]}"/>${paths.join('')}</svg>`;
}
export function neededLevels(difficulty){
 const pairs={hd:['hd'],in:['hd','in'],at:['in','at']};
 if(!pairs[difficulty])throw new Error('Only HD, IN and AT are generated');
 return pairs[difficulty];
}
export async function generateAbstractions(input,seed=1,difficulty){
 const start=performance.now();
 const {data,info}=await sharp(input,{limitInputPixels:16_000_000}).rotate().resize({width:recipe.maxSide,height:recipe.maxSide,fit:'inside',withoutEnlargement:true}).flatten({background:'#10131a'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
 if(info.channels!==3)throw new Error('Expected RGB image');
 const levels=difficulty?recipe.levels.filter(level=>neededLevels(difficulty).includes(level.name)):recipe.levels;
 const {labels,regions}=partition(data,info.width,info.height,seed>>>0),stages=hierarchy(labels,regions,info.width,info.height,seed>>>0,levels),variants={};
 for(const stage of stages){const colors=palette(stage.colors,stage.level.colors,seed>>>0),svg=Buffer.from(vectorize(stage.labels,colors,info.width,info.height,stage.level.simplify));
  variants[stage.level.name]={svg,regions:stage.colors.length,colors:new Set(colors).size,bytes:svg.length,gzipBytes:gzipSync(svg).length};
 }
 return {variants,width:info.width,height:info.height,seed:seed>>>0,milliseconds:Math.round(performance.now()-start),version:recipe.version};
}
