"""Build local-only library media from explicitly supplied extracted resources."""
from argparse import ArgumentParser
from pathlib import Path
import hashlib,json,shutil
from PIL import Image
from fontTools.ttLib import TTFont
from fontTools import subset

parser=ArgumentParser()
parser.add_argument('--covers',type=Path,required=True)
parser.add_argument('--fonts',type=Path,required=True)
parser.add_argument('--ui',type=Path,required=True)
parser.add_argument('--output',type=Path,default=Path('apps/web/public/library'))
args=parser.parse_args()
for directory in ['covers','fonts','ui']:(args.output/directory).mkdir(parents=True,exist_ok=True)
for source in args.covers.glob('*.png'):
    if any(token in source.stem for token in ['Blur','Locked']) or source.stem.startswith('MainStory') and source.stem.endswith('S'):continue
    target=args.output/'covers'/(source.stem+'.webp')
    with Image.open(source) as image:image.convert('RGB').save(target,'WEBP',quality=82)
sources={
 'regular':'sharedassets0.assets_50_Source_Han_Sans___Saira_Hybrid-Regular.ttf',
 'labels':'sharedassets6.assets_41_SourceHanSansCN___SairaCondensed_Hybrid_Medium.ttf',
}
text=''.join(chr(code) for code in range(32,127))+'◆←×年月日'
for path in [Path('data/catalog/songs.json'),Path('data/providers/phi-plugin/nicklist.yaml'),Path('storage/corpus/catalog.json'),*Path('apps/web/src/library').glob('*.tsx')]:
    if path.is_file():text+=path.read_text(encoding='utf-8')
for name,filename in sources.items():
    font=TTFont(args.fonts/filename)
    options=subset.Options();options.flavor='woff2';options.desubroutinize=True
    worker=subset.Subsetter(options=options);worker.populate(text=text);worker.subset(font)
    family='Phiguess Archive '+('Body' if name=='regular' else 'Labels')
    for record in font['name'].names:
        if record.nameID in (1,4,6,16,21):record.string=(family.replace(' ','') if record.nameID==6 else family).encode(record.getEncoding())
    if 'CFF ' in font:
        font['CFF '].cff.fontNames=[family.replace(' ','')];font['CFF '].cff.topDictIndex[0].FullName=family;font['CFF '].cff.topDictIndex[0].FamilyName=family
    font.flavor='woff2';font.save(args.output/'fonts'/(name+'.woff2'))
shutil.copy2(args.ui/'sharedassets22.assets_3.png',args.output/'ui/progress.png')
files={str(path.relative_to(args.output)).replace('\\','/'):{'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()} for path in args.output.rglob('*') if path.is_file() and path.name!='media-manifest.json'}
(args.output/'media-manifest.json').write_text(json.dumps(files,indent=2),encoding='utf-8')
print(json.dumps({'files':len(files),'bytes':sum(item['bytes'] for item in files.values())}))
