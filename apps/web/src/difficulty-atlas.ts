import characterSource from './difficulty-characters.json';

export const ROLLING_HANZI=[...new Set([...characterSource])];
export const GLYPH_CELL={width:128,height:160,columns:16};
export const HEAVY_CELL={width:64,height:224,columns:16};
type Sprite=HTMLCanvasElement|ImageBitmap;
export interface DifficultyAtlas{
  normal:Sprite;motion:Sprite;heavy:Sprite;streaks:Sprite;
  indices:Map<string,number>;labelGlows:Map<string,Sprite>;grain:HTMLCanvasElement;
}
let shared:Promise<DifficultyAtlas>|undefined;
const promote=(canvas:HTMLCanvasElement):Promise<Sprite>=>typeof createImageBitmap==='function'?createImageBitmap(canvas):Promise.resolve(canvas);
function surface(width:number,height:number,read=false){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  return {canvas,ctx:canvas.getContext('2d',{willReadFrequently:read})!};
}
export function getDifficultyAtlas(){return shared??=build().catch(error=>{shared=undefined;throw error;});}

async function build():Promise<DifficultyAtlas>{
  const {width:cw,height:ch,columns}=GLYPH_CELL,rows=Math.ceil(ROLLING_HANZI.length/columns);
  const normal=surface(cw*columns,ch*rows,true),indices=new Map<string,number>();
  normal.ctx.font='900 96px "Phiguess Difficulty"';normal.ctx.textAlign='center';normal.ctx.textBaseline='middle';
  normal.ctx.fillStyle='#cbd0c9';normal.ctx.shadowColor='#e9f1e3';
  for(const [index,char]of ROLLING_HANZI.entries()){
    const x=(index%columns)*cw+cw/2,y=Math.floor(index/columns)*ch+ch/2-2;
    normal.ctx.shadowBlur=6;normal.ctx.fillText(char,x,y);normal.ctx.shadowBlur=0;normal.ctx.fillText(char,x,y);indices.set(char,index);
  }
  // Cache a continuous vertical blur; discrete shifted copies leave stepped outlines.
  const pixels=normal.ctx.getImageData(0,0,normal.canvas.width,normal.canvas.height).data;
  const motion=surface(normal.canvas.width,normal.canvas.height),motionPixels=motion.ctx.createImageData(normal.canvas.width,normal.canvas.height);
  const motionRadius=24;
  for(let x=0;x<normal.canvas.width;x++)for(let block=0;block<rows;block++){
    const top=block*ch;let sum=0;
    for(let y=0;y<=motionRadius;y++)sum+=pixels[((top+y)*normal.canvas.width+x)*4+3];
    for(let y=0;y<ch;y++){
      const at=((top+y)*normal.canvas.width+x)*4;
      motionPixels.data[at]=203;motionPixels.data[at+1]=208;motionPixels.data[at+2]=201;motionPixels.data[at+3]=sum/(motionRadius*2+1);
      if(y-motionRadius>=0)sum-=pixels[((top+y-motionRadius)*normal.canvas.width+x)*4+3];
      if(y+motionRadius+1<ch)sum+=pixels[((top+y+motionRadius+1)*normal.canvas.width+x)*4+3];
    }
  }
  motion.ctx.putImageData(motionPixels,0,0);
  const heavy=surface(HEAVY_CELL.width*columns,HEAVY_CELL.height*rows,true);
  for(let index=0;index<ROLLING_HANZI.length;index++){
    heavy.ctx.drawImage(normal.canvas,index%columns*cw,Math.floor(index/columns)*ch,cw,ch,index%columns*64,Math.floor(index/columns)*224+72,64,80);
  }
  const heavyPixels=heavy.ctx.getImageData(0,0,heavy.canvas.width,heavy.canvas.height),sourceAlpha=new Uint8Array(heavy.canvas.height);
  for(let x=0;x<heavy.canvas.width;x++){
    for(let y=0;y<heavy.canvas.height;y++)sourceAlpha[y]=heavyPixels.data[(y*heavy.canvas.width+x)*4+3];
    for(let block=0;block<rows;block++){
      const top=block*224;let sum=0;
      for(let y=0;y<=42;y++)sum+=sourceAlpha[top+y];
      for(let y=0;y<224;y++){
        const at=((top+y)*heavy.canvas.width+x)*4;
        heavyPixels.data[at]=203;heavyPixels.data[at+1]=208;heavyPixels.data[at+2]=201;heavyPixels.data[at+3]=sum/85;
        if(y-42>=0)sum-=sourceAlpha[top+y-42];
        if(y+43<224)sum+=sourceAlpha[top+y+43];
      }
    }
  }
  heavy.ctx.putImageData(heavyPixels,0,0);
  // The final vertical streak is an averaged alpha profile, not a giant blurred layer.
  const streaks=surface(cw,ROLLING_HANZI.length*2),profiles=streaks.ctx.createImageData(cw,ROLLING_HANZI.length*2);
  for(let index=0;index<ROLLING_HANZI.length;index++){
    const sx=index%columns*cw,sy=Math.floor(index/columns)*ch,alpha=new Float32Array(cw);
    for(let x=0;x<cw;x++){let sum=0;for(let y=16;y<ch-16;y++)sum+=pixels[((sy+y)*normal.canvas.width+sx+x)*4+3];alpha[x]=Math.min(255,sum/(ch-32)*1.9);}
    for(let x=0;x<cw;x++){
      let sum=0;for(let dx=-3;dx<=3;dx++)sum+=alpha[Math.max(0,Math.min(cw-1,x+dx))];
      for(let row=0;row<2;row++){const at=((index*2+row)*cw+x)*4;profiles.data[at]=211;profiles.data[at+1]=217;profiles.data[at+2]=207;profiles.data[at+3]=sum/7;}
    }
  }
  streaks.ctx.putImageData(profiles,0,0);
  const labelGlows=new Map<string,Sprite>();
  for(const char of new Set([...'<>EZHDINAT'])){
    // Cache only a procedural halo. The sharp glyph itself is drawn as live text.
    // 36 logical pixels of padding keep every halo edge fully transparent.
    const glow=surface(384,384),g=glow.ctx;g.scale(4,4);g.font='500 24px Saira';g.textAlign='center';g.textBaseline='middle';
    g.fillStyle='#d7ddd3';g.shadowColor='#d8e6d0';g.shadowBlur=32;g.fillText(char,48,48);
    g.shadowBlur=0;g.globalCompositeOperation='destination-out';g.fillText(char,48,48);
    labelGlows.set(char,await promote(glow.canvas));
  }
  const grain=surface(128,96),noise=grain.ctx.createImageData(128,96);
  for(let y=0;y<96;y++)for(let x=0;x<128;x++){const at=(y*128+x)*4,n=(Math.imul(at+13,1103515245)>>>18)&255;noise.data[at]=n;noise.data[at+1]=n;noise.data[at+2]=n;noise.data[at+3]=y%3===0?10:3;}
  grain.ctx.putImageData(noise,0,0);
  return{normal:await promote(normal.canvas),motion:await promote(motion.canvas),heavy:await promote(heavy.canvas),streaks:await promote(streaks.canvas),indices,labelGlows,grain:grain.canvas};
}
