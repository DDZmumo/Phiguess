"""Measure a stable text label's translation in the supplied 60 fps clip."""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageFilter
from numpy.lib.stride_tricks import sliding_window_view

root=Path('storage/references/select-frames')
def edges(path):
    image=Image.open(path).convert('L')
    return np.asarray(image,dtype=np.float32)-np.asarray(image.filter(ImageFilter.GaussianBlur(1.2)),dtype=np.float32)
template=edges(root/'0031.png')[207:224,51:118]
template-=template.mean()
measurements=[]
for n in range(25,96):
    source=edges(root/f'{n:04d}.png')[200:279,28:138]
    windows=sliding_window_view(source,template.shape)
    sums=(windows*template).sum(axis=(-2,-1))
    norms=np.sqrt((windows**2).sum(axis=(-2,-1))*(template**2).sum())
    scores=sums/np.maximum(norms,1)
    y,x=np.unravel_index(np.argmax(scores),scores.shape)
    measurements.append({'frame':n,'time':round(3+(n-1)/60,4),'x':int(x+28),'y':int(y+200),'correlation':round(float(scores[y,x]),4)})
Path('storage/references/scroll-measurements.json').write_text(json.dumps(measurements,indent=2),encoding='utf8')
print(json.dumps(measurements[::4],indent=2))
