"""Read the supplied difficulty videos and create review sheets in ignored storage."""
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageStat

root=Path('storage/references/difficulty')
sources=json.loads((root/'sources.json').read_text(encoding='utf8'))
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',18)

def extract(record):
    source=record['path'];level=re.search(r'unlock(AT|IN|HD|EZ)',source).group(1).lower()
    folder=root/level;folder.mkdir(exist_ok=True)
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',source,'-vf','fps=2,scale=480:-1','-q:v','3',str(folder/'overview-%03d.jpg')],check=True)
    frames=sorted(folder.glob('overview-*.jpg'))
    sheet=Image.new('RGB',(4*360,((len(frames)+3)//4)*294),'#101010');draw=ImageDraw.Draw(sheet)
    for i,path in enumerate(frames):
        with Image.open(path) as frame:sheet.paste(frame.resize((360,270)),((i%4)*360,(i//4)*294))
        draw.text(((i%4)*360+7,(i//4)*294+272),f'{level.upper()}  {i*.5:.1f}s',font=font,fill='white')
    sheet.save(root/f'{level}-overview.jpg',quality=90)
    if '--full' in sys.argv:
        full=folder/'frames';full.mkdir(exist_ok=True)
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',source,'-vf','scale=720:-1','-q:v','4',str(full/'%04d.jpg')],check=True)
        metrics=[];ranges=[]
        for i,path in enumerate(sorted(full.glob('*.jpg'))):
            with Image.open(path) as frame:
                frame=frame.convert('L')
                corner=sum(ImageStat.Stat(frame.crop(box)).mean[0] for box in [(0,0,30,30),(690,0,720,30),(0,510,30,540),(690,510,720,540)])/4
                mean=ImageStat.Stat(frame).mean[0]
            metrics.append({'frame':i,'t':round(i/30,4),'mean':round(mean,2),'corners':round(corner,2)})
            if corner>80:
                if ranges and i==ranges[-1][1]+1:ranges[-1][1]=i
                else:ranges.append([i,i])
        (root/f'{level}-metrics.json').write_text(json.dumps(metrics),encoding='utf8')
        (root/f'{level}-timing.json').write_text(json.dumps({'fps':30,'frames':len(metrics),'inversionRanges':ranges,'firstFinalBlack':next((item['frame'] for item in metrics if item['frame']>420 and item['mean']<2),None)},indent=2),encoding='utf8')
    return level,len(frames)

with ThreadPoolExecutor(max_workers=4) as pool:
    for result in pool.map(extract,sources):print(*result)
