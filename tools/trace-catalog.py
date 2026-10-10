"""Offline denoise + color-faithful tracing. All source PNGs remain intact."""
import argparse, json, re, time, hashlib, gzip, os
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
from xml.etree import ElementTree as ET
from PIL import Image, ImageFilter
import vtracer

ROOT=Path('storage/corpus').resolve()
PRESET={'max_side':1280,'palette_colors':64,'quantizer':'maxcoverage','color_refinements':3,'median_size':3,'color_precision':8,'layer_difference':1,'filter_speckle':10,'max_iterations':3,'path_precision':1}

def trace(task):
    group,difficulty=task
    source=ROOT/'source'/group['assets'][difficulty]
    folder=ROOT/'prepared'/group['songId']/group['variant'];folder.mkdir(parents=True,exist_ok=True)
    target=folder/f'{difficulty}.svg';clean=folder/f'{difficulty}.clean.png';metadata=folder/f'{difficulty}.trace.json'
    fingerprint=hashlib.sha256(source.read_bytes()+json.dumps(PRESET,sort_keys=True).encode()).hexdigest()
    if metadata.exists() and target.exists():
        previous=json.loads(metadata.read_text('utf8'))
        if previous.get('fingerprint')==fingerprint:return previous
    start=time.monotonic()
    image=Image.open(source).convert('RGB');image.thumbnail((PRESET['max_side'],PRESET['max_side']),Image.Resampling.LANCZOS)
    # Remove isolated generated speckles while retaining the major source colors.
    image=image.filter(ImageFilter.MedianFilter(PRESET['median_size']))
    image=image.quantize(colors=PRESET['palette_colors'],method=Image.Quantize.MAXCOVERAGE,kmeans=PRESET['color_refinements'],dither=Image.Dither.NONE).convert('RGB');image.save(clean)
    vtracer.convert_image_to_svg_py(str(clean),str(target),colormode='color',hierarchical='stacked',mode='spline',filter_speckle=PRESET['filter_speckle'],color_precision=PRESET['color_precision'],layer_difference=PRESET['layer_difference'],corner_threshold=60,length_threshold=4,max_iterations=PRESET['max_iterations'],splice_threshold=45,path_precision=PRESET['path_precision'])
    ET.register_namespace('','http://www.w3.org/2000/svg');tree=ET.parse(target);svg=tree.getroot();svg.set('viewBox',f'0 0 {image.width} {image.height}')
    # Parsing discards generator comments and unused namespace declarations.
    tree.write(target,encoding='utf-8',xml_declaration=False)
    data=target.read_bytes();paths=len(svg.findall('{http://www.w3.org/2000/svg}path'))
    if len(data)>2*1024*1024 or paths>14900:raise RuntimeError(f'SVG budget exceeded: {group["sourceTitle"]}/{difficulty}: {len(data)} bytes, {paths} paths')
    report={'song':group['title'],'variant':group['variant'],'difficulty':difficulty,'fingerprint':fingerprint,'preset':PRESET,'size':[image.width,image.height],'bytes':len(data),'gzipBytes':len(gzip.compress(data)),'paths':paths,'seconds':round(time.monotonic()-start,2)}
    metadata.write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf8');return report

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--sample',type=int,default=0);parser.add_argument('--workers',type=int,default=2);args=parser.parse_args()
    catalog=json.loads((ROOT/'catalog.json').read_text('utf8'));groups=catalog['groups'][:args.sample] if args.sample else catalog['groups']
    tasks=[(group,d) for group in groups for d in ['hd','in','at']];reports=[]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures=[pool.submit(trace,t) for t in tasks]
        for future in as_completed(futures):
            report=future.result();reports.append(report)
            if len(reports)%10==0 or len(reports)==len(tasks):print(f'Traced {len(reports)}/{len(tasks)}; latest={report["song"]}/{report["difficulty"]}; {report["bytes"]} bytes',flush=True)
    for group in groups:
        folder=ROOT/'prepared'/group['songId']/group['variant'];version=f'clean64-v1-{group["variant"]}'
        manifest={'songId':group['songId'],'title':group['title'],'aliases':group['aliases'],'version':version,'variant':group['variant'],'hints':group['hints'],'chapter':int(re.match(r'\d+',group['chapter']).group()),'chapterName':re.sub(r'^\d+\s*','',group['chapter']),'composer':group['composer'],'original':os.path.relpath(ROOT/'source'/group['original'],folder).replace(os.sep,'/'),
          'assets':{'ez':os.path.relpath(ROOT/'source'/group['assets']['ez'],folder).replace(os.sep,'/'),'hd':'hd.svg','in':'in.svg','at':'at.svg'}}
        if group.get('illustrator'): manifest['illustrator']=group['illustrator']
        (folder/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),'utf8')
    summary={'sample':bool(args.sample),'groups':len(groups),'svgCount':len(reports),'totalBytes':sum(r['bytes'] for r in reports),'gzipBytes':sum(r['gzipBytes'] for r in reports),'maxBytes':max(r['bytes'] for r in reports),'maxPaths':max(r['paths'] for r in reports),'preset':PRESET,'files':reports}
    (ROOT/('trace-sample.json' if args.sample else 'trace-report.json')).write_text(json.dumps(summary,ensure_ascii=False,indent=2),'utf8')
    print(json.dumps({k:v for k,v in summary.items() if k!='files'},ensure_ascii=False),flush=True)

if __name__=='__main__':main()
