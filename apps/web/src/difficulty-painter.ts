import type { Difficulty } from '../../../packages/contracts/src';
import { DIFFICULTIES, DIFFICULTY_REEL_PITCH, DIFFICULTY_SCROLL_START, difficultyColumn, difficultyDrift, difficultyLabels, difficultyState } from './difficulty-motion';
import { getDifficultyAtlas, GLYPH_CELL, HEAVY_CELL, ROLLING_HANZI, type DifficultyAtlas } from './difficulty-atlas';
import { DifficultyGlitch } from './difficulty-glitch';

const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const smooth=(n:number)=>{const p=clamp(n);return p*p*(3-2*p);};
const mixHash=(n:number)=>{n=Math.imul(n^(n>>>16),0x45d9f3b);n=Math.imul(n^(n>>>16),0x45d9f3b);return(n^(n>>>16))>>>0;};
const HERO_SIZE=216,GLYPH_SCALE=HERO_SIZE/96,PITCH=DIFFICULTY_REEL_PITCH;

export class DifficultyPainter{
  private ctx:CanvasRenderingContext2D;
  private background:HTMLCanvasElement;
  private backgroundReady=false;
  private faults=new DifficultyGlitch();
  private heavyColumns=Array.from({length:8},()=>{const c=document.createElement('canvas');c.width=64;c.height=384;return c;});
  private seed=crypto.getRandomValues(new Uint32Array(1))[0];
  static async create(canvas:HTMLCanvasElement){return new DifficultyPainter(canvas,await getDifficultyAtlas());}
  private constructor(private canvas:HTMLCanvasElement,private atlas:DifficultyAtlas){
    this.ctx=canvas.getContext('2d',{alpha:false})!;this.background=document.createElement('canvas');
  }
  resize(){
    const r=this.canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.5,Math.sqrt(1920*1080/Math.max(1,r.width*r.height)));
    const w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));
    if(this.backgroundReady&&this.canvas.width===w&&this.canvas.height===h&&this.background.width===w&&this.background.height===h)return;
    this.canvas.width=w;this.canvas.height=h;this.background.width=w;this.background.height=h;
    const b=this.background.getContext('2d',{alpha:false})!;b.fillStyle='#010401';b.fillRect(0,0,w,h);b.globalAlpha=.18;b.fillStyle=b.createPattern(this.atlas.grain,'repeat')!;b.fillRect(0,0,w,h);b.globalAlpha=1;
    this.backgroundReady=true;
  }
  private character(name:string,column:number,step:number){
    if(column<2&&step===0)return name[column];
    return ROLLING_HANZI[mixHash(this.seed^Math.imul(column+1,0x27d4eb2d)^Math.imul(step+4096,0x85ebca6b))%ROLLING_HANZI.length];
  }
  private sharpGlyph(char:string,x:number,y:number,projection=1){
    const c=this.ctx;c.save();c.translate(x,y);c.scale(.94*projection,projection);
    c.font='900 216px "Phiguess Difficulty"';c.textAlign='center';c.textBaseline='middle';c.fillStyle='#cbd0c9';
    c.shadowColor='#e9f1e3';c.shadowBlur=13.5*Math.abs(c.getTransform().a)/.94;
    c.fillText(char,0,-4.5);c.restore();
  }
  private liveLabels(t:number,level:Difficulty){
    const c=this.ctx;c.save();c.font='500 24px Saira';c.textAlign='center';c.textBaseline='middle';c.fillStyle='#d7ddd3';
    for(const {char,x,alpha}of difficultyLabels(t,level)){
      if(alpha<.0001)continue;
      c.globalAlpha=Math.pow(alpha,.8)*.8;c.drawImage(this.atlas.labelGlows.get(char)!,x-48,3-48,96,96);
      c.globalAlpha=alpha*.9;c.fillText(char,x,3);
    }
    c.restore();
  }
  draw(time:number|null,selected:Difficulty|null,hovered:Difficulty|null=null,reduced=false){
    const c=this.ctx,w=this.canvas.width,h=this.canvas.height,u=w<h?w/600:h/540,t=time??.5,state=difficultyState(t);
    c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.globalCompositeOperation='source-over';
    if(time!==null&&state.black){c.fillStyle='#000';c.fillRect(0,0,w,h);return;}
    if(time!==null&&!reduced&&state.flat){c.fillStyle=`rgb(${state.flat.join(',')})`;c.fillRect(0,0,w,h);return;}
    c.drawImage(this.background,0,0);
    c.save();c.translate(w/2,h/2);c.scale(u,u);
    if(time===null)this.liveLabels(.5,'at');
    else if(selected){
      const choice=DIFFICULTIES.find(d=>d.id===selected)!;
      this.liveLabels(t,selected);
      if(state.titleVisible)this.reels(t,choice.name,state,w/u,h/u);
    }
    c.restore();
    if(!reduced&&time!==null&&state.inverted){c.globalCompositeOperation='difference';c.fillStyle=`rgb(${state.inversionColor.join(',')})`;c.fillRect(0,0,w,h);c.globalCompositeOperation='source-over';}
    if(!reduced&&time!==null){
      const wash=clamp((t-11.5)/3.7)*.32,base=[1,4,1].map((v,i)=>v*(1-wash)+[205,211,201][i]*wash);
      const background=state.inverted?base.map((v,i)=>Math.abs(state.inversionColor[i]-v)):base;
      this.faults.apply(this.canvas,c,state.frame,u,background);
    }
  }
  private reels(t:number,name:string,state:ReturnType<typeof difficultyState>,viewWidth:number,viewHeight:number){
    const c=this.ctx;
    if(t<DIFFICULTY_SCROLL_START){
      c.globalAlpha=state.projectionOpacity;
      for(let col=0;col<2;col++){
        const projection=state.projection,tileW=GLYPH_CELL.width*GLYPH_SCALE*.94*projection,tileH=GLYPH_CELL.height*GLYPH_SCALE*projection,x=(col-.5)*200;
        const offset=col===0?state.entryLeft:state.entryRight;
        for(let row=-1;row<=1;row++){
          const y=3+offset+row*PITCH*projection;if(y-tileH/2>viewHeight/2||y+tileH/2< -viewHeight/2)continue;
          this.sharpGlyph(this.character(name,col,row),x,y,projection);
        }
      }
      c.globalAlpha=1;return;
    }
    const pitch=PITCH,halfW=viewWidth/2,tileW=GLYPH_CELL.width*GLYPH_SCALE*.94,tileH=GLYPH_CELL.height*GLYPH_SCALE;
    const lastColumn=Math.ceil((difficultyDrift(t,viewWidth)+halfW+tileW/2)/200)+1,streakMix=smooth((t-12)/2.8);
    for(let col=0;col<=lastColumn;col++){
      const column=difficultyColumn(t,col,viewWidth),x=column.x,opacity=column.alpha;
      if(opacity<.001)continue;
      if(x+tileW/2< -halfW||x-tileW/2>halfW)continue;
      const zoomY=column.zoom,halfH=viewHeight/(2*zoomY),blurMix=clamp(column.smear/10),heavyMix=Math.max(smooth((column.clock-9.7)/2.2),smooth((t-12)/2.2));
      const scroll=column.scroll,base=Math.floor(scroll),fraction=scroll-base,origin=column.origin;
      c.save();c.scale(1,zoomY);
      if(streakMix>.001){
        const at=(t-12)*1.5,step=Math.floor(at),blend=smooth(at-step);
        for(let i=0;i<2;i++){
          const slot=this.atlas.indices.get(this.character(name,col,1000+step+i))!;
          c.globalAlpha=opacity*streakMix*(i?blend:1-blend);
          c.drawImage(this.atlas.streaks,0,slot*2,GLYPH_CELL.width,2,x-tileW/2,-halfH-1,tileW,halfH*2+2);
        }
      }
      const glyphOpacity=opacity*(1-streakMix);if(glyphOpacity<.001){c.restore();continue;}
      if(heavyMix>.001){
        // Composite the entire blurred wheel at low resolution before one bounded blit.
        const buffer=this.heavyColumns[col%this.heavyColumns.length],bc=buffer.getContext('2d')!,heavyH=HEAVY_CELL.height*GLYPH_SCALE*2,scale=buffer.height/(halfH*2);
        bc.clearRect(0,0,buffer.width,buffer.height);
        const first=Math.ceil(fraction+(-halfH-heavyH/2-origin)/pitch),last=Math.floor(fraction+(halfH+heavyH/2-origin)/pitch);
        for(let row=first;row<=last;row++){
          const slot=this.atlas.indices.get(this.character(name,col,base+row))!,y=origin+(row-fraction)*pitch;
          bc.drawImage(this.atlas.heavy,slot%16*64,Math.floor(slot/16)*224,64,224,0,(y-heavyH/2+halfH)*scale,64,heavyH*scale);
        }
        c.globalAlpha=glyphOpacity*heavyMix;c.drawImage(buffer,x-tileW/2,-halfH,tileW,halfH*2);
      }
      if(heavyMix>=.999){c.restore();continue;}
      const first=Math.ceil(fraction+(-halfH-tileH/2-origin)/pitch),last=Math.floor(fraction+(halfH+tileH/2-origin)/pitch);
      for(let row=first;row<=last;row++){
        const char=this.character(name,col,base+row),slot=this.atlas.indices.get(char)!,sx=slot%GLYPH_CELL.columns*GLYPH_CELL.width,sy=Math.floor(slot/GLYPH_CELL.columns)*GLYPH_CELL.height,y=origin+(row-fraction)*pitch;
        if(blurMix<.999&&heavyMix<.999){c.globalAlpha=glyphOpacity*(1-blurMix)*(1-heavyMix);this.sharpGlyph(char,x,y);}
        if(blurMix>.001&&heavyMix<.999){c.globalAlpha=glyphOpacity*blurMix*(1-heavyMix);c.drawImage(this.atlas.motion,sx,sy,GLYPH_CELL.width,GLYPH_CELL.height,x-tileW/2,y-tileH/2,tileW,tileH);}
      }
      c.restore();
    }
    c.globalAlpha=1;
    const wash=clamp((t-11.5)/3.7)*.32;if(wash){c.fillStyle=`rgba(205,211,201,${wash})`;c.fillRect(-viewWidth/2,-viewHeight/2,viewWidth,viewHeight);}
  }
}
