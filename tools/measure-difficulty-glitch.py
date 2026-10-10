"""Read the supplied difficulty clip and export only procedural fault parameters."""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageFilter

source=Path('storage/references/difficulty/at/frames')
def read(frame):
    image=Image.open(source/f'{frame+1:04d}.jpg').convert('RGB')
    rgb=np.asarray(image,dtype=np.float32)
    bg=np.median(np.r_[rgb[:20,:20].reshape(-1,3),rgb[-20:,-20:].reshape(-1,3)],axis=0)
    foreground=np.maximum(bg-rgb if bg.mean()>80 else rgb-bg,0)
    return image,rgb,bg,foreground

def offset(reference,current,limit):
    best=(-2,0)
    for shift in range(-limit,limit+1):
        a=reference[max(0,-shift):min(len(reference),len(reference)-shift)]
        b=current[max(0,shift):min(len(current),len(current)+shift)]
        a=a-a.mean();b=b-b.mean()
        score=float(np.dot(a,b)/max(1,np.linalg.norm(a)*np.linalg.norm(b)))-abs(shift)*.00005
        if score>best[0]:best=(score,shift)
    return best[1] if best[0]>.65 else 0

def runs(indices,gap=2):
    result=[]
    for i in indices:
        if result and i-result[-1][-1]<=gap:result[-1].append(int(i))
        else:result.append([int(i)])
    return result

clean=read(161)[3][70:460,150:580,1]
frames=[];active=[];rgb_frames=[]
for frame in range(456):
    image,rgb,bg,fg=read(frame);gray=rgb.mean(2)
    if frame<74 or (gray.mean()>70 and gray.std()<6):frames.append(None);continue
    chroma=rgb.max(2)-rgb.min(2)
    crop=fg[70:460,150:580];red=[0,0];blue=[0,0];warp=[0,0]
    if np.percentile(chroma,99)>17:
        green=crop[:,:,1]
        red=[offset(green.mean(0),crop[:,:,0].mean(0),24),offset(green.mean(1),crop[:,:,0].mean(1),72)]
        blue=[offset(green.mean(0),crop[:,:,2].mean(0),24),offset(green.mean(1),crop[:,:,2].mean(1),72)]
        if 160<=frame<=166:warp=[offset(clean.mean(0),green.mean(0),32),offset(clean.mean(1),green.mean(1),110)]
    blurred=np.asarray(image.convert('L').filter(ImageFilter.GaussianBlur(1)),dtype=np.float32)
    interior=np.asarray(Image.fromarray(np.clip(fg.mean(2),0,255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)))>60
    detail=float(np.abs(gray-blurred)[interior].mean()) if interior.any() else 0
    grain=float(np.clip((detail-.85)/4,0,1))
    dust=float(np.clip(np.mean((fg.mean(2)<28)&(chroma>18))/.006,0,1))
    # True horizontal cuts have a sharp edge over a wide span; ordinary glyph
    # outlines are blurred and do not pass this threshold.
    row_difference=np.abs(np.diff(gray,axis=0))
    edges=[int(round(np.mean(group))) for group in runs(np.flatnonzero((row_difference.mean(1)>9)&((row_difference>25).mean(1)>.12)))]
    bands=[]
    for top,bottom in zip(edges[::2],edges[1::2]):
        height=bottom-top
        if not 2<=height<=115:continue
        inside=rgb[top+1:bottom+1].mean(0)
        before=rgb[max(0,top-8):max(1,top-2)].mean(0)
        after=rgb[min(539,bottom+2):min(540,bottom+8)].mean(0)
        delta=np.abs(inside-(before+after)*.5).mean(1)
        areas=runs(np.flatnonzero(delta>24),12)
        for area in sorted(areas,key=len,reverse=True)[:4]:
            x=area[0];width=area[-1]-x+1
            if width<24:continue
            sample=rgb[top+1:bottom+1,x:x+width];tone=np.median(sample.reshape(-1,3),axis=0)
            solid=bool(sample.mean(2).std()<34)
            # The amount comes from the observed cut width, not an arbitrary
            # full-screen shake. The current live image supplies the torn pixels.
            shift=round(min(80,width*.22))*(1 if (frame+top)%2 else -1)
            bands.append([x,top+1,width,height,shift,int(solid),*np.round(tone).astype(int).tolist()])
    bands=sorted(bands,key=lambda b:b[2]*b[3],reverse=True)[:12]
    chromatic=max(abs(v) for v in red+blue+warp)
    if chromatic:rgb_frames.append(frame)
    if not bands and chromatic==0 and grain<.16 and dust<.12 and frame!=455:frames.append(None);continue
    record={'r':red,'b':blue,'warp':warp,'grain':round(grain,3),'dust':round(dust,3),'bands':bands}
    frames.append(record);active.append(frame)

destination=Path('apps/web/src/difficulty-glitch-reference.json')
destination.write_text(json.dumps({'fps':30,'frames':frames},separators=(',',':')))
report={'activeFrames':len(active),'rgbFrames':rgb_frames,'dataBytes':destination.stat().st_size,
        'samples':{frame:frames[frame] for frame in [78,135,143,163,164,165,422,455]}}
Path('output/playwright/difficulty-frame-review/glitch-measurements.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
