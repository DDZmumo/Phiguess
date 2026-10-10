"""Measure geometry from the supplied 30 fps frames, without modifying the sources."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

SOURCE=Path('storage/references/difficulty')
OUT=Path('output/playwright/difficulty-frame-review')
OUT.mkdir(parents=True,exist_ok=True)

def read(level,frame):
    rgb=np.array(Image.open(SOURCE/level/'frames'/f'{frame+1:04d}.jpg').convert('RGB'),dtype=np.float32)
    edge=np.concatenate([rgb[:20,:20].reshape(-1,3),rgb[-20:,-20:].reshape(-1,3)])
    bg=np.median(edge,axis=0)
    gray=rgb.mean(2)
    signal=np.maximum((bg.mean()-gray) if bg.mean()>80 else gray-bg.mean(),0)
    return signal,rgb,bg

def correlate(a,b):
    """Normalized 2D template correlation at every valid top-left position."""
    h,w=b.shape;H,W=a.shape
    convolution=np.fft.irfft2(np.fft.rfft2(a)*np.conj(np.fft.rfft2(b,s=a.shape)),s=a.shape)[:H-h+1,:W-w+1]
    integral=np.pad(np.cumsum(np.cumsum(a*a,0),1),((1,0),(1,0)))
    energy=integral[h:,w:]-integral[:-h,w:]-integral[h:,:-w]+integral[:-h,:-w]
    return convolution/np.sqrt(np.maximum(energy,1)*max(float(np.sum(b*b)),1))

def label_location(a,template,x_bounds,y=273,scales=(1,)):
    best=(-1,0,1)
    for scale in scales:
        h=max(8,round(template.shape[0]*scale));w=max(8,round(template.shape[1]*scale))
        b=np.asarray(Image.fromarray(template).resize((w,h),Image.Resampling.BILINEAR))
        top=round(y-h/2);lo=max(0,round(x_bounds[0]-w/2));hi=min(720,round(x_bounds[1]+w/2))
        if hi-lo<w:continue
        scores=correlate(a[top:top+h,lo:hi],b)[0]
        index=int(np.argmax(scores));score=float(scores[index])
        if score>best[0]:best=(score,lo+index+w/2,scale)
    return best

selected={};diagnostics={}
origins={'ez':207,'hd':309,'in':411,'at':513}
for level in ['at','in','hd','ez']:
    initial=read(level,15)[0];origin=origins[level]
    template=initial[245:301,origin-44:origin+44]
    centres=[];previous=origin
    for f in range(15,72):
        a,_,_=read(level,f);score,x,_=label_location(a,template,(previous-30,previous+30))
        centres.append(round(x-360,3));previous=x
    selected[level]=centres
    diagnostics[level]={'selectedX':centres}

# Left and right captions remain separate from the large glyphs after the split.
caption=[];scale_points=[]
stable=read('at',110)[0];template=stable[245:301,78:160]
for f in range(72,111):
    a,rgb,bg=read('at',f)
    if rgb.std()<6:continue
    score,x,scale=label_location(a,template,(90,350),scales=np.arange(.62,1.021,.01))
    if score>.78:caption.append([f,round(x-360,3)]);scale_points.append([f,round(float(scale),3)])

def interpolate(points,frame):return float(np.interp(frame,[p[0] for p in points],[p[1] for p in points]))

# Follow the selected two digits, including their partial visibility at the bottom.
entry=[]
templates=[stable[132:414,170:350],stable[130:416,346:574]]
for f in range(75,111):
    a,rgb,bg=read('at',f)
    if rgb.std()<6:continue
    scale=interpolate(scale_points,f);positions=[];scores=[]
    for col,base in enumerate(templates):
        h=round(base.shape[0]*scale);w=round(base.shape[1]*scale)
        b=np.asarray(Image.fromarray(base).resize((w,h),Image.Resampling.BILINEAR))
        lo,hi=(145,370) if col==0 else (325,595)
        patch=np.pad(a[:,lo:hi],((0,220),(0,0)))
        score=correlate(patch,b)
        min_y=round(260-h/2);max_y=min(score.shape[0],round((450 if col==0 else 625)-h/2))
        region=score[max(0,min_y):max_y]
        y,x=np.unravel_index(np.argmax(region),region.shape);y+=max(0,min_y)
        positions.append(round(y+h/2-273,3));scores.append(round(float(score[y,x]),4))
    entry.append({'frame':f,'scale':round(scale,3),'left':positions[0],'right':positions[1],'scores':scores})

# Between neighbouring frames, maximize correlation of the vertical column profiles.
# Only use the clean accelerating passage; compression/glitch frames are not measurements.
travel=[];previous=None;displacement=[0.,0.]
for f in range(167,281):
    a,_,_=read('at',f)
    profiles=[a[:,190:310].mean(1),a[:,395:545].mean(1)]
    if previous is not None:
        for col,(old,new) in enumerate(zip(previous,profiles)):
            candidates=[]
            for dy in range(0,161):
                x=old[dy:];y=new[:540-dy]
                x=x-x.mean();y=y-y.mean()
                candidates.append(float(np.dot(x,y)/max(np.linalg.norm(x)*np.linalg.norm(y),1)))
            dy=int(np.argmax(candidates));displacement[col]+=dy
    travel.append([f,round(displacement[0],3),round(displacement[1],3)])
    previous=profiles

flats=[]
for f in range(72,456):
    _,rgb,bg=read('at',f)
    if rgb.mean()>70 and rgb.std()<6:flats.append([f,*np.round(rgb.mean((0,1))).astype(int).tolist()])
result={'fps':30,'selectedStart':15,'selected':selected,'caption':caption,'entry':entry,'travel':travel,'flatFrames':flats}
(OUT/'measured-motion.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps({'selectedEveryThird':{level:values[::3] for level,values in selected.items()},'caption':caption,'entry':entry,'travelEveryThird':travel[::3],'flatFrames':flats},indent=2))
