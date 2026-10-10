"""Package the difficulty titles and the shared random Hanzi pool."""
import json
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

font=TTFont('storage/fonts/SourceHanSansSC-Heavy.otf')
options=subset.Options();options.flavor='woff2';options.desubroutinize=True
characters=json.loads(Path('apps/web/src/difficulty-characters.json').read_text(encoding='utf8'))
worker=subset.Subsetter(options=options);worker.populate(text=characters+'外挂龙比人类区');worker.subset(font)
for record in font['name'].names:
    if record.nameID in (1,4,6):
        record.string=('Phiguess Difficulty' if record.nameID in (1,4) else 'PhiguessDifficulty-Heavy').encode(record.getEncoding())
if 'CFF ' in font:
    font['CFF '].cff.fontNames=['PhiguessDifficulty-Heavy']
    font['CFF '].cff.topDictIndex[0].FullName='Phiguess Difficulty'
    font['CFF '].cff.topDictIndex[0].FamilyName='Phiguess Difficulty'
font.flavor='woff2';target=Path('apps/web/public/fonts/phiguess-difficulty-hanzi.woff2');font.save(target)
print('Difficulty font glyphs:',len(set(characters)),'bytes:',target.stat().st_size)
