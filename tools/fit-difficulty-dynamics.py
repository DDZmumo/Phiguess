"""Fit a zero-velocity roll onset and inspect the source's right edge."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

out=Path('output/playwright/difficulty-frame-review')
data=json.loads((out/'measured-motion.json').read_text())
rows=np.array([r for r in data['travel'] if 173<=r[0]<=220],dtype=float)
start=5.3;observed_start=167/30;u=rows[:,0]/30-start;u0=observed_start-start
best=None
for tau in np.linspace(.2,2,181):
    f=u+tau*np.expm1(-u/tau);f0=u0+tau*np.expm1(-u0/tau);z=f-f0
    velocity=float(np.dot(z,rows[:,1])/np.dot(z,z))
    rms=float(np.sqrt(np.mean((velocity*z-rows[:,1])**2)))
    if best is None or rms<best[0]:best=(rms,float(tau),velocity)
design=np.stack([u*u-u0*u0,u*u*u-u0*u0*u0],axis=1)
a,b=np.linalg.lstsq(design,rows[:,2],rcond=None)[0]
assert a>0 and b>=0
right_rms=float(np.sqrt(np.mean((design@np.array([a,b])-rows[:,2])**2)))
edge=[]
for frame in [270,300,330,360,390]:
    samples=[]
    for f in range(frame-3,frame+4):
        image=np.asarray(Image.open(Path('storage/references/difficulty/at/frames')/f'{f+1:04d}.jpg').convert('L'),dtype=float)
        profile=np.r_[image[:235],image[310:]].mean(0)
        foreground=np.flatnonzero(profile>profile.max()*.12)
        samples.append(int(foreground[-1]))
    edge.append([frame,round(float(np.median(samples)),2)])
result={'start':start,'observedStart':observed_start,'leftTau':round(best[1],6),'leftVelocity':round(best[2],6),
        'rightQuadratic':round(float(a),6),'rightCubic':round(float(b),6),
        'leftFitRmsPixels':round(best[0],3),'rightFitRmsPixels':round(right_rms,3),'sourceRightEdge':edge}
(out/'roll-dynamics.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
