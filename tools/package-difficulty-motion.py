"""Package numerical reference measurements. Never ship or replay video frames."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

root=Path.cwd().resolve();audit=root/'output/playwright/difficulty-frame-review'
measured=json.loads((audit/'measured-motion.json').read_text())
projection=json.loads((audit/'projection-check.json').read_text())
native=json.loads((audit/'native-label-motion.json').read_text())
dynamics=json.loads((audit/'roll-dynamics.json').read_text())
entry=[[75,109.5,275],[77,106.5,275],[78,95,245]]
entry.extend([[r['frame'],r['left'],r['right']] for r in measured['entry'] if r['frame']>=82 and min(r['scores'])>.95])
background=[]
for frame in range(456):
    path=root/'storage/references/difficulty/at/frames'/f'{frame+1:04d}.jpg'
    a=np.asarray(Image.open(path).convert('RGB'),dtype=np.float32)
    background.append(np.round(np.median(np.concatenate([a[:20,:20].reshape(-1,3),a[-20:,-20:].reshape(-1,3)]),axis=0)).astype(int).tolist())
data={'fps':30,'selectedStart':15,'selected':measured['selected'],'entry':entry,'travel':measured['travel'],
      'projection':[[r['frame'],r['scale'] if r['frame']<82 else 1,r['opacity']] for r in projection if r['score']>.97],
      'flatFrames':measured['flatFrames'],'background':background,'labelStart':15,'labelEnd':110,'dynamics':dynamics,**native}
destination=root/'apps/web/src/difficulty-reference.json'
destination.write_text(json.dumps(data,separators=(',',':')),encoding='utf8')
# Preserve the rejected experiment outside the shipped application.
old=(root/'apps/web/public/difficulty').resolve()
archive=(root/'output/difficulty-performance/rejected-video-labels').resolve()
assert old.is_relative_to(root) and archive.is_relative_to(root)
if old.exists():
    if archive.exists():raise RuntimeError('Reference label archive already exists; refusing to replace it')
    archive.parent.mkdir(parents=True,exist_ok=True);old.replace(archive)
print(json.dumps({'dataBytes':destination.stat().st_size,'videoImagesInRuntime':0,'outwardCoefficient':native['outwardCoefficient'],'archivedRasterLabels':archive.exists()}))
