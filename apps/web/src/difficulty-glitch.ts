import reference from './difficulty-glitch-reference.json';

const surface=()=>{const canvas=document.createElement('canvas');return{canvas,ctx:canvas.getContext('2d',{alpha:false})!};};
const clamp=(n:number)=>Math.max(0,Math.min(1,n));

/** Post-process the current live drawing. No recorded frames, filters or pixel readback. */
export class DifficultyGlitch{
  private source=surface();
  private channels=[surface(),surface(),surface()];
  private ink=document.createElement('canvas');
  private dust=document.createElement('canvas');
  constructor(){
    this.ink.width=this.ink.height=this.dust.width=this.dust.height=512;
    const ink=this.ink.getContext('2d')!,dust=this.dust.getContext('2d')!;
    let seed=0x506869;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    ink.fillStyle='#fff';ink.fillRect(0,0,512,512);
    for(let y=0;y<512;y+=3){ink.fillStyle='#eeeeee';ink.fillRect(0,y,512,1);}
    for(let i=0;i<1900;i++){
      const x=Math.floor(random()*512),y=Math.floor(random()*512),w=1+Math.floor(random()*9),h=1+Math.floor(random()*5);
      const value=Math.round(i%29===0?90+random()*50:180+random()*72);
      ink.fillStyle=`rgb(${value},${value},${value})`;ink.fillRect(x,y,w,h);
    }
    const colors=['142,50,66','38,148,167','90,151,75','133,75,173'];
    for(let i=0;i<210;i++){
      const x=Math.floor(random()*512),y=Math.floor(random()*512),w=1+Math.floor(random()*7),h=1+Math.floor(random()*4);
      dust.fillStyle=`rgba(${colors[i%colors.length]},${.08+random()*.24})`;dust.fillRect(x,y,w,h);
      if(i%5===0){dust.fillRect(x,y+6,w,1);dust.fillRect(x,y+9,w*.65,1);}
    }
  }
  private prepare(width:number,height:number){
    const scale=Math.min(1,Math.sqrt(1280*720/(width*height))),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
    for(const buffer of[this.source,...this.channels])if(buffer.canvas.width!==w||buffer.canvas.height!==h){buffer.canvas.width=w;buffer.canvas.height=h;}
    return{w,h,scale};
  }
  apply(canvas:HTMLCanvasElement,c:CanvasRenderingContext2D,frame:number,unit:number,background:number[]){
    const effect=reference.frames[frame];if(!effect)return;
    const width=canvas.width,height=canvas.height,{w,h,scale}=this.prepare(width,height);
    const source=this.source.ctx;source.setTransform(1,0,0,1,0,0);source.globalCompositeOperation='copy';source.drawImage(canvas,0,0,w,h);
    c.save();c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;
    const shifts=[
      [effect.warp[0]+effect.r[0],effect.warp[1]+effect.r[1]],
      effect.warp,
      [effect.warp[0]+effect.b[0],effect.warp[1]+effect.b[1]],
    ];
    const strength=clamp(Math.max(...shifts.flat().map(Math.abs))/60);
    if(strength>0){
      c.globalCompositeOperation='source-over';c.fillStyle='#000';c.fillRect(0,0,width,height);
      c.globalAlpha=strength*.16;c.drawImage(this.source.canvas,0,0,width,height);c.globalAlpha=1;c.globalCompositeOperation='lighter';
      for(let i=0;i<3;i++){
        const b=this.channels[i].ctx;b.setTransform(1,0,0,1,0,0);b.globalCompositeOperation='copy';b.fillStyle=`rgb(${background.join(',')})`;b.fillRect(0,0,w,h);
        b.globalCompositeOperation='source-over';b.setTransform(1,0,0,1,shifts[i][0]*unit*scale,shifts[i][1]*unit*scale);b.drawImage(this.source.canvas,0,0);
        b.setTransform(1,0,0,1,0,0);b.globalCompositeOperation='multiply';b.fillStyle=['#f00','#0f0','#00f'][i];b.fillRect(0,0,w,h);b.globalCompositeOperation='source-over';
        c.drawImage(this.channels[i].canvas,0,0,width,height);
      }
    }
    c.save();const ox=(frame*53)%512,oy=(frame*97)%512;c.setTransform(unit,0,0,unit,-ox*unit,-oy*unit);
    if(effect.grain>.01){c.globalCompositeOperation='multiply';c.globalAlpha=Math.min(.42,effect.grain*.4+effect.dust*.06);c.fillStyle=c.createPattern(this.ink,'repeat')!;c.fillRect(ox,oy,width/unit,height/unit);}
    if(effect.dust>.01){c.globalCompositeOperation='screen';c.globalAlpha=effect.dust*.7;c.fillStyle=c.createPattern(this.dust,'repeat')!;c.fillRect(ox,oy,width/unit,height/unit);}
    c.restore();c.globalAlpha=1;c.globalCompositeOperation='source-over';
    if(effect.bands.length){
      source.setTransform(1,0,0,1,0,0);source.globalCompositeOperation='copy';source.drawImage(canvas,0,0,w,h);
      for(const [rx,ry,rw,rh,shift,solid,r,g,b]of effect.bands){
        const x=rx/720*width,y=ry/540*height,bw=rw/720*width,bh=rh/540*height;
        if(!solid){
          c.drawImage(this.source.canvas,(rx-shift)/720*w,ry/540*h,rw/720*w,rh/540*h,x,y,bw,bh);
          c.globalCompositeOperation='difference';
        }
        c.fillStyle=`rgb(${r},${g},${b})`;c.fillRect(x,y,bw,bh);c.globalCompositeOperation='source-over';
        const edge=Math.max(1,unit*.65);c.fillStyle='rgba(160,110,228,.66)';c.fillRect(x,y-edge,bw,edge);
        c.fillStyle='rgba(168,203,79,.68)';c.fillRect(x,y+bh,bw,edge);
      }
    }
    if(frame===455){c.globalAlpha=.985;c.fillStyle='#000';c.fillRect(0,0,width,height);}
    c.restore();
  }
}
