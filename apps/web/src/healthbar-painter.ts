import measured from './healthbar-reference.json';

const clamp=(n:number)=>Math.max(0,Math.min(1,n));
type PaintState={time:number;entry:number;flash:number;previous:number;blend:number;displayValue:number;viewportWidth?:number};

function glow(ctx:CanvasRenderingContext2D,width:number,strength:number){
 ctx.save();ctx.translate(640,0);ctx.scale(width/2,112);
 const halo=ctx.createRadialGradient(0,-.12,.03,0,-.12,1.12);
 halo.addColorStop(0,`rgba(245,0,0,${.7*strength})`);halo.addColorStop(.43,`rgba(208,0,0,${.48*strength})`);halo.addColorStop(1,'rgba(110,0,0,0)');
 ctx.fillStyle=halo;ctx.fillRect(-1.15,0,2.3,1.2);ctx.restore();
}

const random=(seed:number)=>{const n=Math.sin(seed*127.1+311.7)*43758.5453;return n-Math.floor(n);};

const boundaryWidths=[0,52,112,170,224,292,404,554,640,1000,1280];
function boundaryHalf(value:number,viewportWidth:number){
 const level=Math.max(0,Math.min(10,value)),low=Math.floor(level),high=Math.ceil(level);
 const width=(index:number)=>index===10?viewportWidth:Math.min(viewportWidth,boundaryWidths[index]!);
 return (width(low)+(width(high)-width(low))*(level-low))/2;
}

function boundaryLight(ctx:CanvasRenderingContext2D,half:number,value:number,opacity:number){
 const visibility=clamp((9-value)/6)*opacity;if(visibility<=0)return;
 ctx.save();ctx.globalAlpha=visibility;
 const red=ctx.createLinearGradient(0,0,0,116);
 red.addColorStop(0,'rgba(255,8,8,.85)');red.addColorStop(.42,'rgba(255,0,0,.55)');red.addColorStop(1,'rgba(220,0,0,0)');
 function edges(){for(const side of [-1,1]){ctx.beginPath();ctx.moveTo(640+side*half,0);ctx.lineTo(640+side*half*.76,120);ctx.stroke();}}
 // The boundary has its own steady red bloom, independent of the cycling interior spikes.
 ctx.strokeStyle=red;ctx.lineWidth=10;ctx.filter='blur(6px)';edges();
 ctx.lineWidth=4;ctx.filter='blur(2.5px)';edges();ctx.filter='none';
 const light=ctx.createLinearGradient(0,0,0,108);
 light.addColorStop(0,'rgba(255,220,216,.95)');light.addColorStop(.4,'rgba(255,150,148,.7)');light.addColorStop(1,'rgba(255,60,60,0)');
 ctx.strokeStyle=light;ctx.lineWidth=1.25;ctx.shadowColor='rgba(255,90,90,.8)';ctx.shadowBlur=2.5;
 edges();
 ctx.restore();
}

function spikes(ctx:CanvasRenderingContext2D,value:number,time:number,opacity:number,viewportWidth:number,half:number){
 if(value<=0||opacity<=0)return;
 // Keep the same family of spikes: low life contracts their positions instead of removing them.
 const core=measured.rays['10'];
 const rays=core.map(ray=>({...ray,peripheral:false}));
 const screenHalf=viewportWidth/2,coreEdge=Math.max(...core.map(ray=>Math.abs(ray.x-640)));
 const count=Math.max(1,Math.min(6,Math.floor((screenHalf-coreEdge)/35)));
 for(let j=0;j<count;j++){
  const distance=count===1?screenHalf-2:coreEdge+36+(screenHalf-2-coreEdge-36)*j/(count-1);
  for(const side of [-1,1])rays.push({x:640+side*distance,width:7,length:100,strength:.7,peripheral:true});
 }
 const compression=half/screenHalf;
 ctx.save();ctx.globalAlpha=opacity;
 // This is the life envelope. Blurred edges and highlights cannot escape it.
 const taper=.76+.24*clamp((compression-.9)/.1);
 ctx.beginPath();ctx.moveTo(640-half,-4);ctx.lineTo(640+half,-4);ctx.lineTo(640+half*taper,120);ctx.lineTo(640-half*taper,120);ctx.closePath();ctx.clip();
 glow(ctx,half*2*(1-.07*clamp((compression-.85)/.15)),1);
 for(let i=0;i<rays.length;i++){
  const ray=rays[i]!,lifetime=.65+random(i+2)*.65,clock=time/lifetime+random(i+41),cycle=Math.floor(clock),phase=(clock-cycle)/.88;
  if(phase>=1)continue;
  const appear=clamp(phase/.11),disappear=1-clamp((phase-.24)/.76),pulse=appear*Math.pow(disappear,1.35);
  if(pulse<.002)continue;
  const seed=i*37+cycle*13,jitter=(random(seed+4)-.5)*Math.min(8,half*.035);
  const reach=.89+.11*clamp((compression-.8)/.2);
  const base=640+(ray.x-640)*compression*reach;
  const x=base+jitter,screenEdge=clamp((Math.abs(x-640)/screenHalf-.70)/.30);
  const peripheral=ray.peripheral&&screenEdge>0;
  // Tiny tips belong only to the actual screen edges, never to a low-life boundary.
  const grown=.75+.25*(1-Math.pow(1-clamp(phase/.45),3));
  const length=(peripheral?4+96*Math.pow(1-screenEdge,1.55):Math.max(94,ray.length+17)+(random(seed+8)-.5)*8)*grown;
  const tip=640+(x-640)*(1-length/650),width=ray.width*1.1*(.62+.38*Math.sqrt(compression))*(.9+.2*random(seed+12));
  const intensity=ray.strength*pulse,softness=peripheral?1+5*screenEdge*screenEdge:0;
  const fill=ctx.createLinearGradient(x,0,tip,length);
  fill.addColorStop(0,`rgba(255,25,25,${intensity})`);fill.addColorStop(.35,`rgba(255,3,3,${intensity*.95})`);
  fill.addColorStop(.78,`rgba(239,0,0,${intensity*.38})`);fill.addColorStop(1,'rgba(170,0,0,0)');
  ctx.fillStyle=fill;ctx.shadowColor='rgba(255,0,0,.72)';ctx.shadowBlur=9;ctx.filter=softness?`blur(${softness}px)`:'none';
  ctx.beginPath();ctx.moveTo(x-width/2,-3);ctx.lineTo(x+width/2,-3);ctx.lineTo(tip+.3,length);ctx.lineTo(tip-.3,length);ctx.closePath();ctx.fill();
  ctx.shadowBlur=0;
  ctx.filter='none';
 }
 glow(ctx,Math.min(92,half*2),.7);
 ctx.restore();
}

/** Runtime rendering uses only paths, gradients and live text. No image/video textures. */
export function paintHealthBar(ctx:CanvasRenderingContext2D,value:number,state:PaintState){
 const viewportWidth=state.viewportWidth??1280;
 ctx.save();ctx.translate((viewportWidth-1280)/2,0);ctx.globalAlpha=clamp(state.entry);
 const currentHalf=boundaryHalf(value,viewportWidth),previousHalf=boundaryHalf(state.previous,viewportWidth);
 const half=previousHalf+(currentHalf-previousHalf)*state.blend;
 spikes(ctx,value,state.time,state.entry,viewportWidth,half);
 const stable=state.entry===1&&state.flash===0&&state.blend===1;
 if(stable){
  const transform=ctx.getTransform(),key=[value,state.displayValue,viewportWidth,ctx.canvas.width,ctx.canvas.height,transform.a,transform.b,transform.c,transform.d,transform.e,transform.f].join(':');
  let cached=foregroundCache.get(ctx);
  if(!cached||cached.key!==key){
   const layer=cached?.canvas??document.createElement('canvas');layer.width=ctx.canvas.width;layer.height=ctx.canvas.height;
   const painter=layer.getContext('2d')!;painter.setTransform(transform);
   paintForeground(painter,value,half,state);cached={key,canvas:layer};foregroundCache.set(ctx,cached);
  }
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.drawImage(cached.canvas,0,0);ctx.restore();
 }else paintForeground(ctx,value,half,state);
 ctx.restore();
}

// One replaceable layer per HUD; resizing/value changes invalidate it without retaining old sizes.
const foregroundCache=new WeakMap<CanvasRenderingContext2D,{key:string;canvas:HTMLCanvasElement}>();
function paintForeground(ctx:CanvasRenderingContext2D,value:number,half:number,state:PaintState){
 // The pale boundary is fixed for a given life value; only damage moves it inward.
 boundaryLight(ctx,half,value,state.entry);
 const flash=state.flash,tone=Math.round(flash*255);
 ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.font='400 40px Saira';
 ctx.shadowColor=`rgba(255,70,70,${.6+flash*.4})`;ctx.shadowBlur=2+flash*10;
 ctx.fillStyle=`rgb(${tone} ${tone} ${tone})`;ctx.strokeStyle=`rgba(255,110,110,${.65+flash*.35})`;ctx.lineWidth=.9;
 ctx.strokeText(String(state.displayValue),640,42);ctx.fillText(String(state.displayValue),640,42);
 ctx.font='400 14px Saira';ctx.shadowBlur=2+flash*5;ctx.lineWidth=.4;ctx.strokeText('LIFE',640,59);ctx.fillText('LIFE',640,59);
}
