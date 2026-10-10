"""Subset the open Source Han Sans font for local UI/catalog glyphs."""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

text=''.join(p.read_text('utf8') for p in Path('apps/web/src').glob('*.tsx'))
text+=Path('data/providers/phi-plugin/info.csv').read_text('utf8')
text+=Path('data/providers/phi-plugin/nicklist.yaml').read_text('utf8')
font=TTFont('storage/fonts/SourceHanSansSC-Regular.otf')
options=subset.Options();options.flavor='woff2';options.desubroutinize=True
subsetter=subset.Subsetter(options=options);subsetter.populate(text=text);subsetter.subset(font)
for record in font['name'].names:
    if record.nameID in (1,4,6):
        value='Phiguess CJK' if record.nameID in (1,4) else 'PhiguessCJK-Regular'
        record.string=value.encode(record.getEncoding())
if 'CFF ' in font:
    font['CFF '].cff.fontNames=['PhiguessCJK-Regular']
    font['CFF '].cff.topDictIndex[0].FullName='Phiguess CJK'
    font['CFF '].cff.topDictIndex[0].FamilyName='Phiguess CJK'
font.flavor='woff2';target=Path('apps/web/public/fonts/phiguess-cjk.woff2');font.save(target)
print('CJK subset bytes:',target.stat().st_size)
