"""Check whether the first visible large glyph really changes size in the source."""
from pathlib import Path
import json
import numpy as np
from PIL import Image
root=Path('storage/references/difficulty/at/frames')
def read(f):
    a=np.asarray(Image.open(root/f'{f+1:04d}.jpg').convert('L'),dtype=np.float32)
    bg=np.median(np.r_[a[:20,:20].ravel(),a[-20:,-20:].ravel()])
    return np.maximum(bg-a if bg>80 else a-bg,0)
def correlation(a,b):
    h,w=b.shape;H,W=a.shape
    conv=np.fft.irfft2(np.fft.rfft2(a)*np.conj(np.fft.rfft2(b,s=a.shape)),s=a.shape)[:H-h+1,:W-w+1]
    z=np.pad(np.cumsum(np.cumsum(a*a,0),1),((1,0),(1,0)))
    e=z[h:,w:]-z[:-h,w:]-z[h:,:-w]+z[:-h,:-w]
    return conv/np.sqrt(np.maximum(e,1)*np.sum(b*b))
base=read(110)[132:414,170:350];results=[]
for f in [75,77,78,82,83,84,85,91,95,105]:
    a=read(f)[:,145:370];best=(-1,0,0,1)
    for scale in np.arange(.60,1.041,.01):
        h=round(282*scale);w=round(180*scale)
        b=np.asarray(Image.fromarray(base).resize((w,h),Image.Resampling.BILINEAR))
        scores=correlation(a,b);lo=max(0,round(270-h/2));hi=min(scores.shape[0],round(420-h/2))
        cut=scores[lo:hi];y,x=np.unravel_index(np.argmax(cut),cut.shape);y+=lo
        score=float(scores[y,x])
        if score>best[0]:
            opacity=float(np.sum(a[y:y+h,x:x+w]*b)/np.sum(b*b))
            best=(score,float(scale),y+h/2-273,max(0,min(1,opacity)))
    results.append({'frame':f,'score':round(best[0],4),'scale':round(best[1],3),'y':round(best[2],3),'opacity':round(best[3],4)})
Path('output/playwright/difficulty-frame-review/projection-check.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
