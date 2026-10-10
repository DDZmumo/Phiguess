"""Create local video-review contact sheets; never alters the supplied recordings."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageStat

root=Path('storage/references')
for name,rate,start,step in [('entry',120,13,10),('select',60,3,6)]:
    frames=sorted((root/f'{name}-frames').glob('*.png'))
    chosen=frames[::step]
    sheet=Image.new('RGB',(5*363,((len(chosen)+4)//5)*274),'#121212')
    draw=ImageDraw.Draw(sheet)
    samples=[]
    for i,p in enumerate(frames):
        with Image.open(p) as im:
            samples.append((round(start+i/rate,4),round(sum(ImageStat.Stat(im.convert('L')).mean),3)))
    for i,p in enumerate(chosen):
        im=Image.open(p).convert('RGB').resize((363,250))
        x,y=(i%5)*363,(i//5)*274
        sheet.paste(im,(x,y));draw.text((x+6,y+253),f'{start+i*step/rate:.3f}s  frame {int(p.stem)}',fill='white')
    sheet.save(root/f'{name}-timing.jpg',quality=90)
    (root/f'{name}-luminance.csv').write_text('seconds,luminance\n'+'\n'.join(f'{t},{v}' for t,v in samples),encoding='utf8')
    print(name,'frames',len(frames),'minimum brightness',min(samples,key=lambda x:x[1]))
