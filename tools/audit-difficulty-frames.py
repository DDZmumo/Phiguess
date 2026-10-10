"""Audit every source/render frame; pixel comparisons exclude changed title glyphs."""
import csv
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

root=Path('output/playwright/difficulty-frame-review')
reference=Path('storage/references/difficulty')
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',15)
corner_boxes=[(0,0,30,30),(690,0,720,30),(0,510,30,540),(690,510,720,540)]

def read(path):
    with Image.open(path) as image:return np.array(image.convert('L'),dtype=float)

def corners(a):return float(np.mean([a[y0:y1,x0:x1].mean() for x0,y0,x1,y1 in corner_boxes]))

def groups(values):
    ranges=[]
    for value in values:
        if ranges and value==ranges[-1][1]+1:ranges[-1][1]=value
        else:ranges.append([value,value])
    return ranges

def label_groups(a):
    # At rest the labels occupy a narrow horizontal band. Use connected x spans.
    p=np.max(a[258:287],axis=0)>65
    spans=[];inside=False
    for x,active in enumerate(p):
        if active and not inside:start=x;inside=True
        if inside and (not active or x==719):
            end=x if active else x-1;inside=False
            if end-start>=2:spans.append([start,end])
    merged=[]
    for start,end in spans:
        if merged and start-merged[-1][1]<=8:merged[-1][1]=end
        else:merged.append([start,end])
    return [[a,b,round((a+b)/2,2)] for a,b in merged]

reports={}
for level in ['at','in','hd','ez']:
    rows=[]
    for frame in range(522):
        stem=f'{frame+1:04d}'
        source=read(reference/level/'frames'/f'{stem}.jpg')
        render=read(root/level/f'{stem}.png')
        state=json.loads((root/level/f'{stem}.json').read_text())
        sc,rc=corners(source),corners(render)
        source_black=frame>=420 and source.mean()<2
        render_black=frame>=420 and render.max()==0
        rows.append({'frame':frame,'time':round(frame/30,6),'source_corner':round(sc,3),'render_corner':round(rc,3),
                     'source_inverted':sc>80,'render_inverted':state['inverted'],'render_corner_high':rc>80,'source_black':source_black,'render_black':render_black,
                     'source_mean':round(source.mean(),3),'render_mean':round(render.mean(),3),
                     'left_scroll':state['leftScroll'],'right_scroll':state['scroll'],'split':state['split'],
                     'scope':'static-entry' if frame<15 else 'playback' if frame<456 else 'black-tail'})
    with (root/f'{level}-audit.csv').open('w',newline='',encoding='utf8') as stream:
        writer=csv.DictWriter(stream,fieldnames=rows[0].keys());writer.writeheader();writer.writerows(rows)
    source_inverts=groups([r['frame'] for r in rows if r['source_inverted']])
    render_inverts=groups([r['frame'] for r in rows if r['render_inverted']])
    label_errors=[]
    for frame in range(15,74):
        source=read(reference/level/'frames'/f'{frame+1:04d}.jpg')[245:301]
        rendered=read(root/level/f'{frame+1:04d}.png')[245:301]
        core=source>65
        label_errors.append(float(np.mean(np.abs(source[core]-rendered[core]))))
    reports[level]={'frames':len(rows),'sourceInversion':source_inverts,'renderInversion':render_inverts,
      'openingLabelCoreMAE':round(float(np.mean(label_errors)),3),
      'inversionMismatches':[r['frame'] for r in rows if r['source_inverted']!=r['render_inverted']],
      'sourceFirstBlack':next(r['frame'] for r in rows if r['source_black']),
      'renderFirstBlack':next(r['frame'] for r in rows if r['render_black']),
      'blackMismatches':[r['frame'] for r in rows if r['source_black']!=r['render_black']],
      'sourceIdleLabels':label_groups(read(reference/level/'frames'/'0016.jpg')),
      'renderIdleLabels':label_groups(read(root/level/'0016.png'))}

(root/'audit-summary.json').write_text(json.dumps(reports,indent=2),encoding='utf8')
# Every AT frame, paired with the renderer; the four variants also get detailed entrance sheets.
def sheet(level,frames,name,width=240,cols=4):
    height=width*3//4;cell_h=height*2+22
    out=Image.new('RGB',(cols*width,((len(frames)+cols-1)//cols)*cell_h),'#161616');draw=ImageDraw.Draw(out)
    for cell,frame in enumerate(frames):
        x=cell%cols*width;y=cell//cols*cell_h
        for row,path in enumerate([reference/level/'frames'/f'{frame+1:04d}.jpg',root/level/f'{frame+1:04d}.png']):
            with Image.open(path) as image:out.paste(image.convert('RGB').resize((width,height)),(x,y+22+row*height))
        draw.text((x+4,y+3),f'{level.upper()} {frame:03d} {frame/30:.3f}s ref/web',fill='white',font=font)
    out.save(root/f'{name}.jpg',quality=92)

for start in range(0,522,20):sheet('at',list(range(start,min(start+20,522))),f'at-all-{start:03d}')
for level in ['in','hd','ez']:
    for start in [15,35,55,75,175]:sheet(level,list(range(start,start+20)),f'{level}-detail-{start:03d}')
print(json.dumps({level:{'frames':r['frames'],'inversionMismatches':len(r['inversionMismatches']),
 'blackMismatches':len(r['blackMismatches']),'firstBlack':r['renderFirstBlack'],
 'openingLabelCoreMAE':r['openingLabelCoreMAE']}for level,r in reports.items()},indent=2))
